// AI 推論執行器（T-702／T-702c）的主執行緒那半：只負責開 Worker、傳圖、收結果；模型、onnxruntime、前後處理都在 worker.ts。
// 模型與執行檔一律同源、不跟隨轉址（AGENTS.md 硬邊界 1：執行時不連外）。
// 錯誤一律 AiError（name 'AiError'＋code，英文原因在 cause）；取消一律 AbortError。

import { validateSamples } from './image-ops';
import type {
  AiErrorCode, AiModel, AiProgress, AiRunInfo, AiRunner, AiRunnerOptions, CreateAiRunner, DepthBand, GrayImage, RgbaImage,
} from './types';
import type { AiDebugInfo, AiResultPayload, AiTask, AiWorkerConfig, AiWorkerRequest, AiWorkerResponse } from './worker';

/** `public/models/` 裡的檔名（npm run fetch-models 下載）。 */
export const MODEL_FILES: Record<AiModel, string> = {
  matte: 'isnet-anime.onnx',
  depth: 'depth-anything-v2-small.onnx',
};

/** runner 丟出的錯誤：介面依 code 顯示白話；cause 是原始原因（英文），只給 console。 */
export class AiError extends Error {
  override readonly name = 'AiError';
  constructor(readonly code: AiErrorCode, cause: unknown) {
    super(code, { cause });
  }
}

export interface AiRunnerDebugOptions extends AiRunnerOptions {
  /** 每次成功推論的細節（輸入輸出名稱與形狀、原始輸出範圍、純推論毫秒數…），給測試頁用。 */
  onDebug?: (debug: AiDebugInfo) => void;
  /** Worker 到目前為止發出的所有請求網址（成功、失敗都會送），給測試頁確認同源。 */
  onRequests?: (urls: string[]) => void;
}

type Kind = AiResultPayload['kind'];
type PayloadOf<K extends Kind> = Extract<AiResultPayload, { kind: K }>;

interface Reply<K extends Kind> {
  payload: PayloadOf<K>;
  width: number;
  height: number;
  info: AiRunInfo;
}

interface Pending {
  kind: Kind;
  width: number;
  height: number;
  resolve: (value: Reply<Kind>) => void;
  reject: (error: unknown) => void;
  onProgress?: AiProgress;
  signal?: AbortSignal;
  abort: () => void;
}

const abortError = (message = 'Aborted') => new DOMException(message, 'AbortError');

function sameOrigin(base: string, what: string): string {
  const url = new URL(base, location.href);
  if (url.origin !== location.origin) throw new RangeError(`AI ${what} must be on the same origin as the page: ${url.href}`);
  return url.href;
}

/** 回來的結果要和要的一樣：種類、大小、buffer 長度、數值範圍。 */
function checkPayload(payload: AiResultPayload, kind: Kind, width: number, height: number): void {
  const count = width * height;
  if (payload.kind !== kind) throw new RangeError(`AI result is ${payload.kind}, expected ${kind}.`);
  switch (payload.kind) {
    case 'gray':
      if (payload.data.byteLength !== count * 4) throw new RangeError('AI gray result has the wrong length.');
      break;
    case 'cutout':
      if (payload.data.byteLength !== count * 4) throw new RangeError('AI cut-out result has the wrong length.');
      if (!(payload.coverage >= 0 && payload.coverage <= 1)) throw new RangeError(`AI coverage ${payload.coverage} is outside 0..1.`);
      break;
    case 'layers':
      if (payload.bands.length < 1 || payload.bands.length > 4) throw new RangeError(`AI returned ${payload.bands.length} layers.`);
      for (const band of payload.bands) {
        if (band.data.byteLength !== count * 4) throw new RangeError('AI layer has the wrong length.');
        if (!Number.isInteger(band.depth) || band.depth < 0 || band.depth > 100) throw new RangeError(`AI layer depth ${band.depth} is invalid.`);
      }
      break;
  }
}

export const createAiRunner: CreateAiRunner = (options) => createDebugAiRunner(options);

/** 同 createAiRunner，多 onDebug／onRequests（測試頁用）。 */
export function createDebugAiRunner(options: AiRunnerDebugOptions = {}): AiRunner {
  const modelBase = sameOrigin(options.modelBase ?? `${import.meta.env.BASE_URL}models/`, 'models');
  const ortBase = sameOrigin(options.ortBase ?? `${import.meta.env.BASE_URL}ort/`, 'runtime');
  const config: AiWorkerConfig = {
    modelUrls: { matte: modelBase + MODEL_FILES.matte, depth: modelBase + MODEL_FILES.depth },
    ortBase,
    ...(options.backend ? { backend: options.backend } : {}),
  };
  let worker: Worker | undefined;
  let nextId = 1;
  let fast: Promise<boolean> | undefined;
  const pending = new Map<number, Pending>();

  function settle(id: number): Pending | undefined {
    const job = pending.get(id);
    if (!job) return undefined;
    pending.delete(id);
    job.signal?.removeEventListener('abort', job.abort);
    return job;
  }

  /** 收掉 Worker（連同裡面的模型與 GPU 記憶體），還在等的全部 reject。下次用到再開新的。 */
  function shutdown(error: () => unknown): void {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    }
    for (const id of [...pending.keys()]) settle(id)?.reject(error());
  }

  function onMessage({ data }: MessageEvent<AiWorkerResponse>): void {
    if (data.type !== 'progress') {
      const requests = data.type === 'error' ? data.requests : data.debug?.requests;
      if (requests) options.onRequests?.(requests);
    }
    const job = pending.get(data.id);
    if (!job) return; // 已取消：Worker 跑完送回來的也丟掉
    if (data.type === 'progress') {
      try {
        job.onProgress?.(data.stage, data.done, data.total);
      } catch (error) {
        settle(data.id);
        post({ type: 'cancel', id: data.id });
        job.reject(error); // 呼叫端自己的錯誤原樣丟回
      }
      return;
    }
    settle(data.id);
    if (data.type === 'error') {
      job.reject(new AiError(data.code, new Error(data.message)));
      // GPU 記憶體放不掉：這個 Worker 不可靠了，整個收掉，下次重開。
      if (data.restart) shutdown(() => new AiError('run-failed', new Error('AI worker restarted after a failed GPU release')));
      return;
    }
    try {
      if (data.width !== job.width || data.height !== job.height) {
        throw new RangeError(`AI result is ${data.width}×${data.height}, expected ${job.width}×${job.height}.`);
      }
      checkPayload(data.payload, job.kind, data.width, data.height);
    } catch (error) {
      job.reject(new AiError('bad-output', error));
      return;
    }
    if (data.debug) options.onDebug?.(data.debug);
    job.resolve({ payload: data.payload, width: data.width, height: data.height, info: data.info });
  }

  function start(): Worker {
    if (worker) return worker;
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = onMessage;
    created.onerror = (event) => {
      event.preventDefault();
      shutdown(() => new AiError('run-failed', new Error(event.message || 'AI worker failed')));
    };
    created.onmessageerror = () => shutdown(() => new AiError('run-failed', new Error('AI worker reply could not be decoded')));
    worker = created;
    post({ type: 'init', config });
    return created;
  }

  function post(message: AiWorkerRequest, transfer: Transferable[] = []): void {
    (worker ?? start()).postMessage(message, transfer);
  }

  function request<K extends Kind>(task: AiTask, kind: K, image: RgbaImage, signal?: AbortSignal, onProgress?: AiProgress) {
    return new Promise<Reply<K>>((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      try {
        validateSamples(image.data, image.width, image.height, 4);
      } catch (error) {
        reject(new AiError('run-failed', error));
        return;
      }
      const id = nextId++;
      const abort = () => {
        if (!settle(id)) return;
        // 推論本身中斷不了：Worker 跑完會自己丟掉結果；這裡先讓呼叫端拿到 AbortError。
        if (worker) worker.postMessage({ type: 'cancel', id } satisfies AiWorkerRequest);
        reject(abortError());
      };
      pending.set(id, {
        kind, width: image.width, height: image.height, onProgress, signal, abort, reject,
        resolve: (value) => resolve(value as unknown as Reply<K>), // 種類已由 checkPayload 檢查過
      });
      signal?.addEventListener('abort', abort, { once: true });
      // 呼叫端的圖之後還要用，不能把它的 buffer 拆走：複製一份剛好大小的，transfer 給 Worker（不再被結構化複製一次）。
      const bytes = image.data.slice().buffer;
      try {
        post({ type: 'run', id, task, width: image.width, height: image.height, data: bytes }, [bytes]);
      } catch (error) {
        settle(id);
        reject(new AiError(worker ? 'run-failed' : 'load-failed', error));
      }
    });
  }

  const grayImage = ({ payload, width, height }: Reply<'gray'>): GrayImage => ({ width, height, data: new Float32Array(payload.data) });

  return {
    async available(model) {
      try {
        const response = await fetch(modelBase + MODEL_FILES[model], {
          method: 'HEAD', mode: 'same-origin', redirect: 'error', cache: 'no-store', credentials: 'same-origin',
        });
        const type = response.headers.get('content-type') ?? '';
        const length = response.headers.get('content-length');
        // 開發伺服器找不到檔案時回 200＋index.html（SPA fallback）。
        return response.ok && !type.includes('text/html') && length !== '0';
      } catch {
        return false; // 包括轉址（redirect: 'error'）
      }
    },
    async matte(image, signal, onProgress) {
      const reply = await request({ kind: 'matte' }, 'gray', image, signal, onProgress);
      return { alpha: grayImage(reply), info: reply.info };
    },
    async depth(image, signal, onProgress) {
      const reply = await request({ kind: 'depth' }, 'gray', image, signal, onProgress);
      return { depth: grayImage(reply), info: reply.info };
    },
    async removeBackground(image, refine, signal, onProgress) {
      const task: AiTask = { kind: 'cutout', refine: { feather: refine.feather, ...(refine.clip !== undefined ? { clip: refine.clip } : {}) } };
      const { payload, width, height, info } = await request(task, 'cutout', image, signal, onProgress);
      return { image: { width, height, data: new Uint8ClampedArray(payload.data) }, coverage: payload.coverage, info };
    },
    async splitLayers(image, split, signal, onProgress) {
      const task: AiTask = {
        kind: 'layers',
        split: { ...(split.bands !== undefined ? { bands: split.bands } : {}), ...(split.feather !== undefined ? { feather: split.feather } : {}) },
      };
      const { payload, width, height, info } = await request(task, 'layers', image, signal, onProgress);
      const bands: DepthBand[] = payload.bands.map((band) => ({ depth: band.depth, image: { width, height, data: new Uint8ClampedArray(band.data) } }));
      return { bands, info };
    },
    hasFastBackend() {
      fast ??= (async () => {
        if (options.backend === 'wasm') return false;
        try {
          // 只問有沒有 WebGPU 轉接器，不載入模型；有轉接器不保證模型一定跑得動，但當作「快」。
          const gpu = (globalThis.navigator as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
          return Boolean(gpu && await gpu.requestAdapter());
        } catch {
          return false;
        }
      })();
      return fast;
    },
    dispose() {
      shutdown(() => abortError('AI runner disposed'));
    },
  };
}
