// AI 推論 Worker（T-702／T-702c）：onnxruntime-web 在這裡跑，前後處理（含去背成品、拆層）也在這裡，主執行緒不卡。
// 執行時不連外（AGENTS.md 硬邊界 1）：所有檔案（模型、onnxruntime 的 mjs／wasm）都由這裡用同源、不跟隨轉址的 fetch 讀，
// 再把執行檔直接交給 onnxruntime（wasmBinary＋blob: 的 mjs），onnxruntime 自己不發任何請求。
// 核心邏輯是 createAiWorker（Node 測試用假的 onnxruntime 測）；檔案最後幾行只在真的 Worker 裡才接上 self.onmessage。

// 用 onnxruntime-web/webgpu（新的 WebGPU 後端，wasm 檔是 ort-wasm-simd-threaded.asyncify.*），不用預設的 JSEP 版：
// T-702 實測 JSEP 的 WebGPU 不支援 IS-Net 用到的 MaxPool ceil_mode（去背只能退 WASM，一張 70 秒），
// 而且一個 session 在 WebGPU 跑失敗後，同一個 Worker 裡別的 WebGPU session 也會跟著壞。新版兩個模型都能在 WebGPU 跑，WASM 後端也還在。
import * as ort from 'onnxruntime-web/webgpu';
import { depthToImage, prepareDepthInput, splitByDepth } from './depth';
import { applyAlpha, matteToAlpha, prepareMatteInput, refineAlpha } from './matte';
import { validateSamples } from './image-ops';
import type { AiErrorCode, AiModel, AiProgress, AiRunInfo, GrayImage, Letterbox, RefineOptions, SplitOptions } from './types';

type Backend = AiRunInfo['backend'];
type Stage = Parameters<AiProgress>[0];

/** onnxruntime-web/webgpu 的執行檔（`npm run fetch-models` 複製到 public/ort/）。 */
export const RUNTIME_FILES = {
  mjs: 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: 'ort-wasm-simd-threaded.asyncify.wasm',
} as const;

export interface AiWorkerConfig {
  /** 各模型的完整網址（同源）。 */
  modelUrls: Record<AiModel, string>;
  /** onnxruntime 執行檔資料夾的完整網址（同源，結尾 /）。 */
  ortBase: string;
  /** 強制後端；省略＝先試 WebGPU、不行用 WASM。 */
  backend?: Backend;
}

/** 要做什麼：matte／depth＝只給 0～1 的圖；cutout＝去背成品；layers＝依深度拆層。 */
export type AiTask =
  | { kind: 'matte' }
  | { kind: 'depth' }
  | { kind: 'cutout'; refine: RefineOptions }
  | { kind: 'layers'; split: SplitOptions };

export type AiWorkerRequest =
  | { type: 'init'; config: AiWorkerConfig }
  /** data：RGBA 位元組（transfer 過來）。 */
  | { type: 'run'; id: number; task: AiTask; width: number; height: number; data: ArrayBuffer }
  | { type: 'cancel'; id: number };

/** 結果（所有 ArrayBuffer 都 transfer 回去）。 */
export type AiResultPayload =
  /** Float32 的 0～1 圖（遮罩或深度）。 */
  | { kind: 'gray'; data: ArrayBuffer }
  /** 去背後的 RGBA；coverage＝修好的遮罩平均值。 */
  | { kind: 'cutout'; data: ArrayBuffer; coverage: number }
  /** 由遠到近的幾段 RGBA。 */
  | { kind: 'layers'; bands: { depth: number; data: ArrayBuffer }[] };

/** 給測試頁看的細節（不在 AiRunInfo 契約裡）。 */
export interface AiDebugInfo {
  model: AiModel;
  inputName: string;
  outputName: string;
  inputDims: number[];
  outputDims: number[];
  /** 模型原始輸出的最小、最大值。 */
  rawMin: number;
  rawMax: number;
  /** 去背輸出超出 0～1 的個數（少量會夾回 0～1；太多就是 bad-output）。 */
  outOfRange: number;
  /** 前處理、純推論的毫秒數（兩個加起來＝AiRunInfo.runMs）。 */
  prepMs: number;
  inferMs: number;
  /** WebGPU 失敗、改用 WASM 的原因。 */
  fallback?: string;
  /** 這個 Worker 到目前為止發出的所有請求網址（Resource Timing；確認都是同源）。 */
  requests?: string[];
}

export type AiWorkerResponse =
  | { type: 'progress'; id: number; stage: Stage; done: number; total: number }
  | { type: 'result'; id: number; width: number; height: number; payload: AiResultPayload; info: AiRunInfo; debug?: AiDebugInfo }
  /**
   * message：英文原因（主執行緒放進 AiError.cause）。restart：Worker 狀態不可靠（GPU 記憶體放不掉），請主執行緒終止、下次重開。
   * requests：同 AiDebugInfo.requests（失敗時也要能確認有沒有連外）。
   */
  | { type: 'error'; id: number; code: AiErrorCode; message: string; restart?: boolean; requests?: string[] };

// ---- onnxruntime 用到的最小介面（測試換成假的）----

export interface OrtTensorLike {
  data: unknown;
  dims: readonly number[];
}

export interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release(): Promise<void>;
}

export interface OrtLike {
  env: { wasm: { wasmPaths?: unknown; wasmBinary?: unknown; numThreads?: number; proxy?: boolean } };
  InferenceSession: {
    create(model: Uint8Array, options: {
      executionProviders: Backend[]; graphOptimizationLevel?: 'all'; logSeverityLevel?: 0 | 1 | 2 | 3 | 4;
    }): Promise<OrtSessionLike>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}

export interface AiWorkerDeps {
  ort: OrtLike;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  post: (message: AiWorkerResponse, transfer?: Transferable[]) => void;
  now?: () => number;
}

interface Loaded {
  session: OrtSessionLike;
  backend: Backend;
  /** WebGPU 失敗、改用 WASM 的原因。 */
  fallback?: string;
}

/** 帶 AiErrorCode 的失敗（英文 message 只進 AiError.cause）。 */
class StageError extends Error {
  constructor(readonly code: AiErrorCode, message: string, readonly restart = false) {
    super(message);
  }
}

/** 工作已取消：什麼都不送。 */
class Canceled extends Error {}

/** 下載進度最少變化這麼多才送（避免 176 MB 的模型送幾千則訊息）。 */
const PROGRESS_STEP = 0.01;
/** 所有請求：只准同源、不跟隨轉址（同源網址轉到外站時直接失敗，不會連出去）。 */
const SAME_ORIGIN: RequestInit = { mode: 'same-origin', redirect: 'error', credentials: 'same-origin' };
/** 去背輸出（照模型契約是 0～1）超出這個範圍的算「超出」；超出的比例大於 MAX_OUT_OF_RANGE 就是 bad-output。 */
const RANGE_SLACK = 0.01;
const MAX_OUT_OF_RANGE = 0.001;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function requestLog(): string[] {
  try {
    return performance.getEntriesByType('resource').map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function createAiWorker(deps: AiWorkerDeps) {
  const { ort, post } = deps;
  const now = deps.now ?? (() => performance.now());
  let config: AiWorkerConfig | undefined;
  let runtime: Promise<void> | undefined;
  const sessions = new Map<AiModel, Promise<Loaded>>();
  /** 在 WebGPU 跑失敗過的模型：之後直接用 WASM。 */
  const preferWasm = new Set<AiModel>();
  /** 已送進來、還沒做完的工作。 */
  const active = new Set<number>();
  const canceled = new Set<number>();
  // 一次只做一件：同一個 session 不能同時 run，兩個模型同時跑也只會互搶 GPU／記憶體。
  let queue: Promise<void> = Promise.resolve();

  async function download(url: string, onProgress?: (ratio: number) => void): Promise<Uint8Array<ArrayBuffer>> {
    let response: Response;
    try {
      response = await deps.fetch(url, SAME_ORIGIN);
    } catch (error) {
      throw new StageError('load-failed', `Cannot fetch ${url} (same-origin, no redirects): ${errorText(error)}`);
    }
    const type = response.headers.get('content-type') ?? '';
    // 開發伺服器找不到檔案時回 200＋index.html，要當成「沒有檔案」。
    if (!response.ok || type.includes('text/html')) {
      throw new StageError('model-missing', `File is missing: ${url} (HTTP ${response.status}${type ? `, ${type}` : ''})`);
    }
    try {
      const total = Number(response.headers.get('content-length')) || 0;
      let bytes: Uint8Array<ArrayBuffer>;
      let received = 0;
      if (!response.body || total <= 0) {
        bytes = new Uint8Array(await response.arrayBuffer());
        received = bytes.length;
      } else {
        bytes = new Uint8Array(total);
        let reported = 0;
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (received + value.length > bytes.length) { // 長度標錯（例如壓縮過）：放大
            const grown = new Uint8Array(Math.max(bytes.length * 2, received + value.length));
            grown.set(bytes.subarray(0, received));
            bytes = grown;
          }
          bytes.set(value, received);
          received += value.length;
          const ratio = Math.min(1, received / total);
          if (onProgress && ratio - reported >= PROGRESS_STEP) { reported = ratio; onProgress(ratio); }
        }
      }
      if (received === 0) throw new Error('empty file');
      return received === bytes.length ? bytes : bytes.slice(0, received);
    } catch (error) {
      throw new StageError('load-failed', `Cannot read ${url}: ${errorText(error)}`);
    }
  }

  /**
   * onnxruntime 的執行檔由我們用同源 fetch 讀好再交給它：wasm 給 wasmBinary、mjs 包成 blob: 網址。
   * 不設資料夾前綴、也不給 wasm 網址 → onnxruntime 沒有任何網址可以自己去抓（也就不會跟著轉址連外）。
   */
  function ensureRuntime(cfg: AiWorkerConfig): Promise<void> {
    if (!runtime) {
      const pending = Promise.all([download(cfg.ortBase + RUNTIME_FILES.mjs), download(cfg.ortBase + RUNTIME_FILES.wasm)])
        .then(([mjs, wasm]) => {
          ort.env.wasm.wasmBinary = wasm;
          ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([mjs], { type: 'text/javascript' })) };
        });
      runtime = pending;
      pending.catch(() => { if (runtime === pending) runtime = undefined; });
    }
    return runtime;
  }

  async function open(model: AiModel, backends: Backend[], bytes: Uint8Array): Promise<Loaded> {
    let fallback: string | undefined;
    for (const backend of backends) {
      try {
        // logSeverityLevel 3＝只印錯誤：不然每次建 session 都在 console 印「有些節點分給 CPU」的警告（紅字，但無害）。
        const session = await ort.InferenceSession.create(bytes, {
          executionProviders: [backend], graphOptimizationLevel: 'all', logSeverityLevel: 3,
        });
        return { session, backend, fallback };
      } catch (error) {
        if (backend === backends.at(-1)) {
          throw new StageError('load-failed',
            `Cannot load the ${model} model on ${backend}: ${errorText(error)}${fallback ? ` (after ${fallback})` : ''}`);
        }
        fallback = `${backend}: ${errorText(error)}`;
      }
    }
    throw new StageError('load-failed', 'No backend to try.');
  }

  function backendsFor(cfg: AiWorkerConfig, model: AiModel): Backend[] {
    if (cfg.backend) return [cfg.backend];
    return preferWasm.has(model) ? ['wasm'] : ['webgpu', 'wasm'];
  }

  /** 模型第一次用時才下載、建 session，之後重用；失敗就不留，下次重試。 */
  function load(cfg: AiWorkerConfig, model: AiModel, onProgress: (ratio: number) => void): Promise<Loaded> {
    let pending = sessions.get(model);
    if (!pending) {
      pending = ensureRuntime(cfg)
        .then(() => download(cfg.modelUrls[model], onProgress))
        .then((bytes) => open(model, backendsFor(cfg, model), bytes));
      sessions.set(model, pending);
      const mine = pending;
      pending.catch(() => { if (sessions.get(model) === mine) sessions.delete(model); });
    }
    return pending;
  }

  /**
   * 跑一次。WebGPU 建得起來但跑的時候丟錯（記憶體不夠、運算子不支援）→ 放掉 GPU session、換 WASM 重跑一次，之後這個模型都用 WASM。
   * - GPU session 放不掉：不再建 WASM（兩份模型會同時佔記憶體），回報 restart，讓主執行緒終止這個 Worker。
   * - 取消了：重新下載、建 session、重跑之前都先檢查，取消就停。
   */
  async function infer(
    cfg: AiWorkerConfig, model: AiModel, loaded: Loaded, tensor: Float32Array, dims: number[], stopped: () => boolean,
  ): Promise<{ loaded: Loaded; outputs: Record<string, OrtTensorLike> }> {
    const run = (session: OrtSessionLike) => session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', tensor, dims) });
    try {
      return { loaded, outputs: await run(loaded.session) };
    } catch (error) {
      if (loaded.backend !== 'webgpu' || cfg.backend) throw new StageError('run-failed', `${loaded.backend} run: ${errorText(error)}`);
      const reason = `webgpu run: ${errorText(error)}`;
      // 工作一件一件做，這裡換 session 不會和別的工作撞。
      sessions.delete(model);
      preferWasm.add(model);
      try {
        await loaded.session.release();
      } catch (releaseError) {
        throw new StageError('run-failed', `${reason}; the WebGPU session could not be released: ${errorText(releaseError)}`, true);
      }
      if (stopped()) throw new Canceled();
      // 模型位元組沒有留著（176 MB），重新讀一次（多半走快取）。
      const bytes = await download(cfg.modelUrls[model]);
      if (stopped()) throw new Canceled();
      const next: Loaded = { ...(await open(model, ['wasm'], bytes)), fallback: reason };
      sessions.set(model, Promise.resolve(next));
      if (stopped()) throw new Canceled();
      try {
        return { loaded: next, outputs: await run(next.session) };
      } catch (wasmError) {
        throw new StageError('run-failed', `wasm run: ${errorText(wasmError)} (after ${reason})`);
      }
    }
  }

  /** 輸出要是 float32、形狀照模型契約、沒有 NaN／無限大。 */
  function checkedOutput(model: AiModel, output: OrtTensorLike | undefined, expected: number[][]): Float32Array {
    if (!output || !(output.data instanceof Float32Array)) throw new StageError('bad-output', `The ${model} model returned no float32 output.`);
    const dims = [...output.dims];
    if (!expected.some((shape) => shape.length === dims.length && shape.every((size, i) => size === dims[i]))) {
      throw new StageError('bad-output', `Unexpected ${model} output shape [${dims.join(', ')}], expected ${expected.map((s) => `[${s.join(', ')}]`).join(' or ')}.`);
    }
    if (output.data.length !== dims.reduce((a, b) => a * b, 1)) throw new StageError('bad-output', `The ${model} output length does not match its shape.`);
    return output.data;
  }

  async function runJob(job: Extract<AiWorkerRequest, { type: 'run' }>): Promise<void> {
    const { id, task, width, height } = job;
    const model: AiModel = task.kind === 'matte' || task.kind === 'cutout' ? 'matte' : 'depth';
    const stopped = () => canceled.has(id);
    const progress = (stage: Stage, done: number) => { if (!stopped()) post({ type: 'progress', id, stage, done, total: 1 }); };
    try {
      if (stopped()) return;
      const cfg = config;
      if (!cfg) throw new StageError('run-failed', 'AI worker received a run before init.');
      const image = { width, height, data: new Uint8ClampedArray(job.data) };
      try {
        validateSamples(image.data, width, height, 4); // 圖不對就別白載模型
      } catch (error) {
        throw new StageError('run-failed', `Bad input image: ${errorText(error)}`);
      }

      progress('load', 0);
      const loadStart = now();
      let loaded = await load(cfg, model, (ratio) => progress('load', ratio));
      const loadMs = now() - loadStart;
      progress('load', 1);
      if (stopped()) return;

      progress('run', 0);
      const prepStart = now();
      let tensor: Float32Array;
      let dims: number[];
      let box: Letterbox | undefined;
      try {
        if (model === 'matte') {
          const p = prepareMatteInput(image);
          ({ tensor, box } = p);
          dims = [1, 3, p.box.size, p.box.size];
        } else {
          const p = prepareDepthInput(image);
          tensor = p.tensor;
          dims = [1, 3, p.height, p.width];
        }
      } catch (error) {
        throw new StageError('run-failed', `Pre-processing failed: ${errorText(error)}`);
      }
      const prepMs = now() - prepStart;
      const inferStart = now();
      const ran = await infer(cfg, model, loaded, tensor, dims, stopped);
      loaded = ran.loaded;
      const inferMs = now() - inferStart;
      progress('run', 1);
      if (stopped()) return; // 推論中斷不了：跑完才丟

      progress('post', 0);
      const postStart = now();
      const outputName = loaded.session.outputNames[0]!;
      const output = ran.outputs[outputName];
      const expected = box
        ? [[1, 1, box.size, box.size], [1, box.size, box.size]]
        : [[1, dims[2]!, dims[3]!]];
      const raw = checkedOutput(model, output, expected);
      let rawMin = Infinity;
      let rawMax = -Infinity;
      let outOfRange = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i]!;
        if (!Number.isFinite(v)) throw new StageError('bad-output', `The ${model} model produced NaN or infinite values.`);
        if (v < rawMin) rawMin = v;
        if (v > rawMax) rawMax = v;
        if (v < -RANGE_SLACK || v > 1 + RANGE_SLACK) outOfRange++;
      }
      if (model === 'depth') outOfRange = 0; // 深度是相對值，沒有固定範圍
      // 去背模型的契約是 0～1（T-702 實測確認）：少量浮點誤差夾回去（matteToAlpha 會夾），大量超出代表模型或後端壞了。
      if (outOfRange > raw.length * MAX_OUT_OF_RANGE) {
        throw new StageError('bad-output', `${outOfRange} of ${raw.length} matte values are outside 0..1 (min ${rawMin}, max ${rawMax}).`);
      }

      let payload: AiResultPayload;
      const transfer: ArrayBuffer[] = [];
      const own = (data: Float32Array | Uint8ClampedArray): ArrayBuffer => {
        const buffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? data.buffer as ArrayBuffer
          : data.slice().buffer as ArrayBuffer;
        transfer.push(buffer);
        return buffer;
      };
      try {
        if (box) {
          const alpha = matteToAlpha({ width: box.size, height: box.size, data: raw }, box);
          if (task.kind === 'cutout') {
            const refined = refineAlpha(alpha, task.refine);
            let sum = 0;
            for (let i = 0; i < refined.data.length; i++) sum += refined.data[i]!;
            const cut = applyAlpha(image, refined);
            payload = { kind: 'cutout', data: own(cut.data), coverage: sum / refined.data.length };
          } else {
            payload = { kind: 'gray', data: own(alpha.data) };
          }
        } else {
          const depth: GrayImage = depthToImage(raw, dims[3]!, dims[2]!, width, height);
          if (task.kind === 'layers') {
            const bands = splitByDepth(image, depth, task.split);
            payload = { kind: 'layers', bands: bands.map((band) => ({ depth: band.depth, data: own(band.image.data) })) };
          } else {
            payload = { kind: 'gray', data: own(depth.data) };
          }
        }
      } catch (error) {
        throw new StageError('run-failed', `Post-processing failed: ${errorText(error)}`);
      }
      const postMs = now() - postStart;
      progress('post', 1);
      if (stopped()) return;

      const info: AiRunInfo = { backend: loaded.backend, loadMs, runMs: prepMs + inferMs, postMs };
      const debug: AiDebugInfo = {
        model, inputName: loaded.session.inputNames[0]!, outputName, inputDims: dims, outputDims: [...output!.dims],
        rawMin, rawMax, outOfRange, prepMs, inferMs, ...(loaded.fallback ? { fallback: loaded.fallback } : {}),
        requests: requestLog(),
      };
      post({ type: 'result', id, width, height, payload, info, debug }, transfer);
    } catch (error) {
      if (error instanceof Canceled || stopped()) return;
      const failure = error instanceof StageError ? error : new StageError('run-failed', errorText(error));
      post({
        type: 'error', id, code: failure.code, message: failure.message, requests: requestLog(),
        ...(failure.restart ? { restart: true } : {}),
      });
    } finally {
      active.delete(id);
      canceled.delete(id);
    }
  }

  function handle(message: AiWorkerRequest): void {
    switch (message.type) {
      case 'init':
        config = message.config;
        // 沒有 COOP／COEP 標頭就沒有 SharedArrayBuffer，多執行緒用不了；明講單執行緒，免得 onnxruntime 每次印警告。
        ort.env.wasm.numThreads = 1;
        // 已經在 Worker 裡，不要再開一層代理 Worker。
        ort.env.wasm.proxy = false;
        break;
      case 'cancel':
        if (active.has(message.id)) canceled.add(message.id);
        break;
      case 'run':
        active.add(message.id);
        queue = queue.then(() => runJob(message));
        break;
    }
  }

  return {
    handle,
    /** 目前排進去的工作都做完（測試用）。 */
    idle: () => queue,
  };
}

// ---- 真的 Worker 才接上（Node 測試 import 這個檔時不會）----

if ('WorkerGlobalScope' in globalThis) {
  // 專案只帶 DOM 型別、沒有 WebWorker 型別：只描述用到的部分（同 src/file/gif-worker.ts）。
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<AiWorkerRequest>) => void) | null;
    postMessage(message: AiWorkerResponse, transfer?: Transferable[]): void;
  };
  const worker = createAiWorker({
    ort: ort as unknown as OrtLike,
    fetch: (url, init) => fetch(url, init),
    post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  });
  scope.onmessage = ({ data }) => worker.handle(data);
}
