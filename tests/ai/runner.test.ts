// T-702／T-702c：推論執行器。Node 沒有 GPU、也不跑真的模型：
// - 主執行緒那半（runner）用假 Worker 測：取消、錯誤一律 AiError＋code、transferable、只建一個 Worker、去背成品／拆層的回傳、hasFastBackend。
// - Worker 那半（createAiWorker）用假的 onnxruntime 測：模型只載入一次、WebGPU 失敗退 WASM、取消丟結果、輸出形狀與數值檢查、
//   所有請求都同源且不跟隨轉址（onnxruntime 自己不連網：執行檔由我們讀好交給它）。
// - 最後一組把兩半接起來（structuredClone＋transfer，跟瀏覽器一樣會把傳出去的 ArrayBuffer 拆掉）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, createAiRunner, createDebugAiRunner, MODEL_FILES } from '../../src/ai/runner';
import type { AiModel, RgbaImage } from '../../src/ai/types';
import {
  createAiWorker, RUNTIME_FILES, type AiResultPayload, type AiTask, type AiWorkerConfig, type AiWorkerRequest,
  type AiWorkerResponse, type OrtLike,
} from '../../src/ai/worker';

const ORIGIN = 'http://127.0.0.1:5190';
const SAME_ORIGIN = { mode: 'same-origin', redirect: 'error' };

function rgba(width: number, height: number, fill = 200): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(fill);
  return { width, height, data };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------- 主執行緒（runner）

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<AiWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  /** 收到的訊息（已經過 structuredClone＋transfer，像真的 Worker 收到的一樣）。 */
  received: AiWorkerRequest[] = [];
  transfers: Transferable[][] = [];
  postMessage = vi.fn((message: AiWorkerRequest, transfer: Transferable[] = []) => {
    this.transfers.push(transfer);
    this.received.push(structuredClone(message, { transfer }));
  });
  constructor(readonly url: URL, readonly options: WorkerOptions) { FakeWorker.instances.push(this); }
  emit(data: AiWorkerResponse, transfer: Transferable[] = []) {
    this.onmessage?.({ data: structuredClone(data, { transfer }) } as MessageEvent<AiWorkerResponse>);
  }
  runs() { return this.received.filter((m): m is Extract<AiWorkerRequest, { type: 'run' }> => m.type === 'run'); }
}

const INFO = { backend: 'webgpu' as const, loadMs: 1, runMs: 2, postMs: 3 };

function payloadTransfers(payload: AiResultPayload): ArrayBuffer[] {
  return payload.kind === 'layers' ? payload.bands.map((band) => band.data) : [payload.data];
}

function emitResult(worker: FakeWorker, id: number, width: number, height: number, payload: AiResultPayload) {
  worker.emit({ type: 'result', id, width, height, payload, info: INFO }, payloadTransfers(payload));
}

function reply(worker: FakeWorker, id: number, width: number, height: number, value = 0.5) {
  emitResult(worker, id, width, height, { kind: 'gray', data: new Float32Array(width * height).fill(value).buffer });
}

/** 依 AiError 的樣子比對：name、code，英文原因在 cause、不在 message。 */
async function expectAiError(promise: Promise<unknown>, code: string, cause?: RegExp) {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(AiError);
  expect(error).toMatchObject({ name: 'AiError', code });
  if (cause) {
    expect(String((error as Error).cause instanceof Error ? ((error as Error).cause as Error).message : (error as Error).cause)).toMatch(cause);
    expect((error as Error).message).not.toMatch(cause);
  }
  return error as AiError;
}

beforeEach(() => {
  vi.stubGlobal('location', new URL(`${ORIGIN}/`));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWorker.instances = [];
});

describe('createAiRunner（主執行緒）', () => {
  it('does not start a Worker until the first run, then reuses one module Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    expect(FakeWorker.instances).toHaveLength(0);
    const first = runner.matte(rgba(4, 3));
    const second = runner.depth(rgba(4, 3));
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.options).toEqual({ type: 'module' });
    expect(String(worker.url)).toMatch(/worker\.ts$/);
    const [init] = worker.received;
    expect(init).toEqual({
      type: 'init',
      config: {
        modelUrls: { matte: `${ORIGIN}/models/${MODEL_FILES.matte}`, depth: `${ORIGIN}/models/${MODEL_FILES.depth}` },
        ortBase: `${ORIGIN}/ort/`,
      },
    });
    const [a, b] = worker.runs();
    expect([a.task, b.task]).toEqual([{ kind: 'matte' }, { kind: 'depth' }]);
    expect(a.id).not.toBe(b.id);
    reply(worker, b.id, 4, 3, 0.25);
    reply(worker, a.id, 4, 3, 0.75);
    const [m, d] = await Promise.all([first, second]);
    expect(m.alpha.data[0]).toBe(0.75);
    expect(d.depth.data[0]).toBe(0.25);
    expect(m.info).toEqual(INFO);
    runner.dispose();
  });

  it('resolves model and ort bases against the page and passes a forced backend', () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('location', new URL(`${ORIGIN}/sub/page.html`));
    const runner = createAiRunner({ modelBase: 'm/', ortBase: '/x/ort/', backend: 'wasm' });
    void runner.matte(rgba(1, 1)).catch(() => {});
    expect(FakeWorker.instances[0].received[0]).toEqual({
      type: 'init',
      config: {
        modelUrls: { matte: `${ORIGIN}/sub/m/${MODEL_FILES.matte}`, depth: `${ORIGIN}/sub/m/${MODEL_FILES.depth}` },
        ortBase: `${ORIGIN}/x/ort/`,
        backend: 'wasm',
      },
    });
    runner.dispose();
  });

  it('refuses model or ort locations on another origin（執行時不准連外）', () => {
    expect(() => createAiRunner({ modelBase: 'https://example.com/models/' })).toThrow(/same origin/i);
    expect(() => createAiRunner({ ortBase: 'https://cdn.example.com/ort/' })).toThrow(/same origin/i);
  });

  it('transfers an exact-sized copy of the image and leaves the caller’s pixels intact', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const backing = new Uint8ClampedArray(4 + 2 * 2 * 4 + 4).fill(9);
    const image: RgbaImage = { width: 2, height: 2, data: backing.subarray(4, 4 + 16) };
    const promise = runner.matte(image);
    const worker = FakeWorker.instances[0];
    const run = worker.runs()[0];
    const transfer = worker.transfers[worker.received.indexOf(run)];
    expect(transfer).toHaveLength(1);
    expect((transfer[0] as ArrayBuffer).byteLength).toBe(0); // 傳出去就被拆掉＝真的是 transfer，不是複製
    expect(run.data.byteLength).toBe(16);
    expect([run.width, run.height]).toEqual([2, 2]);
    expect(image.data.byteLength).toBe(16); // 呼叫端的圖還在
    expect(Array.from(image.data)).toEqual(new Array(16).fill(9));
    reply(worker, run.id, 2, 2);
    await promise;
    runner.dispose();
  });

  it('rejects an invalid image with AiError before posting anything', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    await expectAiError(runner.matte({ width: 3, height: 3, data: new Uint8ClampedArray(4) }), 'run-failed', /length/i);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('forwards progress and rejects (and cancels) when the progress callback throws', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const progress = vi.fn();
    const ok = runner.matte(rgba(1, 1), undefined, progress);
    const worker = FakeWorker.instances[0];
    const id = worker.runs()[0].id;
    worker.emit({ type: 'progress', id, stage: 'load', done: 0.5, total: 1 });
    worker.emit({ type: 'progress', id, stage: 'run', done: 0, total: 1 });
    reply(worker, id, 1, 1);
    await ok;
    expect(progress.mock.calls).toEqual([['load', 0.5, 1], ['run', 0, 1]]);

    const boom = new Error('callback broke');
    const bad = runner.depth(rgba(1, 1), undefined, () => { throw boom; });
    const badId = worker.runs()[1].id;
    worker.emit({ type: 'progress', id: badId, stage: 'load', done: 0, total: 1 });
    await expect(bad).rejects.toBe(boom); // 呼叫端自己的錯誤原樣丟回
    expect(worker.received.at(-1)).toEqual({ type: 'cancel', id: badId });
    runner.dispose();
  });

  it('rejects an already-aborted signal without starting a Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const controller = new AbortController();
    controller.abort();
    await expect(runner.matte(rgba(1, 1), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runner.removeBackground(rgba(1, 1), { feather: 1 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('abort rejects at once with AbortError, tells the Worker to drop the job and ignores its late result', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const controller = new AbortController();
    const progress = vi.fn();
    const canceled = runner.matte(rgba(2, 2), controller.signal, progress);
    const other = runner.matte(rgba(2, 2));
    const worker = FakeWorker.instances[0];
    const [a, b] = worker.runs();
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.received.at(-1)).toEqual({ type: 'cancel', id: a.id });
    // Worker 那邊推論中斷不了，跑完才丟；萬一結果還是送回來，主執行緒也要忽略、不影響別的工作。
    worker.emit({ type: 'progress', id: a.id, stage: 'post', done: 0, total: 1 });
    reply(worker, a.id, 2, 2);
    expect(progress).not.toHaveBeenCalled();
    reply(worker, b.id, 2, 2, 1);
    expect((await other).alpha.data[0]).toBe(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    runner.dispose();
  });

  it.each(['model-missing', 'load-failed', 'run-failed', 'bad-output'] as const)(
    'turns a Worker %s error into AiError (English only in cause) and keeps the Worker', async (code) => {
      vi.stubGlobal('Worker', FakeWorker);
      const runner = createAiRunner();
      const failed = runner.depth(rgba(1, 1));
      const worker = FakeWorker.instances[0];
      worker.emit({ type: 'error', id: worker.runs()[0].id, code, message: 'Model file is missing: depth' });
      await expectAiError(failed, code, /Model file is missing/);
      const next = runner.depth(rgba(1, 1));
      expect(FakeWorker.instances).toHaveLength(1);
      reply(worker, worker.runs()[1].id, 1, 1);
      await next;
      runner.dispose();
    },
  );

  it('terminates the Worker when it asks for a restart (GPU memory could not be released), then starts a fresh one', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const a = runner.matte(rgba(1, 1));
    const b = runner.depth(rgba(1, 1));
    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'error', id: worker.runs()[0].id, code: 'run-failed', message: 'release failed', restart: true });
    await expectAiError(a, 'run-failed', /release failed/);
    await expectAiError(b, 'run-failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const c = runner.matte(rgba(1, 1));
    expect(FakeWorker.instances).toHaveLength(2);
    const fresh = FakeWorker.instances[1];
    reply(fresh, fresh.runs()[0].id, 1, 1);
    await c;
    runner.dispose();
  });

  it('rejects everything pending when the Worker crashes, then starts a fresh Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const a = runner.matte(rgba(1, 1));
    const b = runner.depth(rgba(1, 1));
    const worker = FakeWorker.instances[0];
    const preventDefault = vi.fn();
    worker.onerror?.({ message: 'out of memory', preventDefault } as unknown as ErrorEvent);
    await expectAiError(a, 'run-failed', /out of memory/);
    await expectAiError(b, 'run-failed', /out of memory/);
    expect(preventDefault).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const c = runner.matte(rgba(1, 1));
    expect(FakeWorker.instances).toHaveLength(2);
    const fresh = FakeWorker.instances[1];
    expect(fresh.received[0].type).toBe('init');
    reply(fresh, fresh.runs()[0].id, 1, 1);
    await c;
    runner.dispose();
  });

  it('rejects with AiError when a reply cannot be decoded or the Worker cannot start', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const a = runner.matte(rgba(1, 1));
    FakeWorker.instances[0].onmessageerror?.({} as MessageEvent);
    await expectAiError(a, 'run-failed', /decode/i);
    runner.dispose();
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Cannot start'); } });
    await expectAiError(createAiRunner().matte(rgba(1, 1)), 'load-failed', /Cannot start/);
  });

  it.each([
    ['wrong size', 3, 3, { kind: 'gray', data: new Float32Array(9).buffer }],
    ['wrong payload kind', 2, 2, { kind: 'cutout', data: new Uint8ClampedArray(16).buffer, coverage: 1 }],
    ['short buffer', 2, 2, { kind: 'gray', data: new Float32Array(3).buffer }],
  ] as const)('rejects a result with %s as bad-output', async (_name, width, height, payload) => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const a = runner.matte(rgba(2, 2));
    const worker = FakeWorker.instances[0];
    emitResult(worker, worker.runs()[0].id, width, height, structuredClone(payload) as AiResultPayload);
    await expectAiError(a, 'bad-output');
    runner.dispose();
  });

  it('dispose terminates the Worker and rejects pending runs with AbortError', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const a = runner.matte(rgba(1, 1));
    const worker = FakeWorker.instances[0];
    runner.dispose();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    runner.dispose(); // 第二次沒事
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('passes debug details and request lists (also from errors) to the debug hooks（只給測試頁）', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onDebug = vi.fn();
    const onRequests = vi.fn();
    const runner = createDebugAiRunner({ onDebug, onRequests });
    const a = runner.matte(rgba(1, 1));
    const worker = FakeWorker.instances[0];
    const id = worker.runs()[0].id;
    const debug = { model: 'matte' as const, inputName: 'img', outputName: 'mask', inputDims: [1, 3, 1024, 1024],
      outputDims: [1, 1, 1024, 1024], rawMin: 0, rawMax: 1, outOfRange: 0, prepMs: 1, inferMs: 2, requests: [`${ORIGIN}/models/x`] };
    const data = new Float32Array(1);
    worker.emit({ type: 'result', id, width: 1, height: 1, payload: { kind: 'gray', data: data.buffer }, info: INFO, debug }, [data.buffer]);
    await a;
    expect(onDebug).toHaveBeenCalledWith(debug);
    expect(onRequests).toHaveBeenLastCalledWith([`${ORIGIN}/models/x`]);
    const b = runner.depth(rgba(1, 1));
    worker.emit({ type: 'error', id: worker.runs()[1].id, code: 'load-failed', message: 'x', requests: [`${ORIGIN}/ort/y`] });
    await expectAiError(b, 'load-failed');
    expect(onRequests).toHaveBeenLastCalledWith([`${ORIGIN}/ort/y`]);
    runner.dispose();
  });
});

describe('removeBackground／splitLayers（T-702c：後處理也在 Worker）', () => {
  it('removeBackground sends refine options and returns the cut-out RGBA image with its coverage', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const promise = runner.removeBackground(rgba(2, 2), { feather: 3, clip: 0.1 });
    const worker = FakeWorker.instances[0];
    const run = worker.runs()[0];
    expect(run.task).toEqual({ kind: 'cutout', refine: { feather: 3, clip: 0.1 } });
    const pixels = new Uint8ClampedArray(16).fill(7);
    emitResult(worker, run.id, 2, 2, { kind: 'cutout', data: pixels.buffer, coverage: 0.25 });
    const result = await promise;
    expect(result.image.width).toBe(2);
    expect(result.image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(result.image.data)).toEqual(new Array(16).fill(7));
    expect(result.coverage).toBe(0.25);
    expect(result.info).toEqual(INFO);
    runner.dispose();
  });

  it('splitLayers sends split options and returns bands far to near', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const promise = runner.splitLayers(rgba(2, 1), { bands: 3, feather: 0.05 });
    const worker = FakeWorker.instances[0];
    const run = worker.runs()[0];
    expect(run.task).toEqual({ kind: 'layers', split: { bands: 3, feather: 0.05 } });
    const bands = [0, 50, 100].map((depth) => ({ depth, data: new Uint8ClampedArray(8).fill(depth).buffer }));
    emitResult(worker, run.id, 2, 1, { kind: 'layers', bands });
    const result = await promise;
    expect(result.bands.map((band) => band.depth)).toEqual([0, 50, 100]);
    expect(result.bands[2].image).toMatchObject({ width: 2, height: 1 });
    expect(result.bands[2].image.data[0]).toBe(100);
    runner.dispose();
  });

  it('rejects malformed cut-out or layer results as bad-output', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    const a = runner.removeBackground(rgba(1, 1), { feather: 0 });
    const b = runner.splitLayers(rgba(1, 1), {});
    const worker = FakeWorker.instances[0];
    const [ra, rb] = worker.runs();
    emitResult(worker, ra.id, 1, 1, { kind: 'cutout', data: new Uint8ClampedArray(4).buffer, coverage: 2 });
    emitResult(worker, rb.id, 1, 1, { kind: 'layers', bands: [{ depth: 0, data: new Uint8ClampedArray(3).buffer }] });
    await expectAiError(a, 'bad-output');
    await expectAiError(b, 'bad-output');
    runner.dispose();
  });
});

describe('hasFastBackend()', () => {
  it('asks for a WebGPU adapter once (no Worker, no model) and caches the answer', async () => {
    const requestAdapter = vi.fn(async () => ({}));
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createAiRunner();
    expect(await runner.hasFastBackend()).toBe(true);
    expect(await runner.hasFastBackend()).toBe(true);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each([
    ['no navigator.gpu', {}],
    ['no adapter', { gpu: { requestAdapter: async () => null } }],
    ['adapter request fails', { gpu: { requestAdapter: async () => { throw new Error('blocked'); } } }],
  ])('is false with %s', async (_name, nav) => {
    vi.stubGlobal('navigator', nav);
    expect(await createAiRunner().hasFastBackend()).toBe(false);
  });

  it('is false when WASM is forced, without asking the GPU', async () => {
    const requestAdapter = vi.fn(async () => ({}));
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    expect(await createAiRunner({ backend: 'wasm' }).hasFastBackend()).toBe(false);
    expect(requestAdapter).not.toHaveBeenCalled();
  });
});

describe('available()（同源 HEAD）', () => {
  it('asks the same-origin model URL with HEAD, no redirects, and accepts only a real file', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, {
      status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '176069933' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const runner = createAiRunner();
    expect(await runner.available('matte')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/models/${MODEL_FILES.matte}`, expect.objectContaining({ method: 'HEAD', ...SAME_ORIGIN }));
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each([
    ['404', new Response(null, { status: 404 })],
    // Vite 開發伺服器找不到檔案時回 200＋index.html（SPA fallback），不能當成模型在。
    ['HTML fallback', new Response(null, { status: 200, headers: { 'content-type': 'text/html' } })],
    ['empty file', new Response(null, { status: 200, headers: { 'content-length': '0' } })],
  ])('returns false for %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    expect(await createAiRunner().available('depth')).toBe(false);
  });

  it('returns false when the request itself fails (for example a redirect)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await createAiRunner().available('depth')).toBe(false);
  });
});

// ---------------------------------------------------------------- Worker 那半（假 onnxruntime）

interface FakeOptions {
  /** 這些後端建 session 會失敗。 */
  failCreate?: string[];
  /** 這些後端跑推論會失敗。 */
  failRun?: string[];
  /** 這些後端的 session 釋放會失敗。 */
  failRelease?: string[];
  /** 去背輸出的值。 */
  matteValue?: (index: number) => number;
  /** 去背輸出的形狀（預設 [1, 1, 1024, 1024]）。 */
  matteDims?: number[];
  /** 深度輸出的形狀（預設 [1, H, W]）；給函式可以依輸入改。 */
  depthDims?: (h: number, w: number) => number[];
  /** 讓推論卡住，直到測試放行。 */
  gate?: () => Promise<void>;
  /** 這些後端算出 NaN。 */
  nanOn?: string[];
}

const MODEL_BYTES: Record<AiModel, Uint8Array> = {
  matte: new TextEncoder().encode('matte-model'),
  depth: new TextEncoder().encode('depth-model'),
};
const RUNTIME_MJS = new TextEncoder().encode('export default function factory() {}');
const RUNTIME_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

function fakeOrt(options: FakeOptions = {}) {
  const creates: { model: string; providers: string[] }[] = [];
  const createOptions: Record<string, unknown>[] = [];
  const runs: { model: string; backend: string; feeds: Record<string, { type: string; data: Float32Array; dims: number[] }> }[] = [];
  const released: string[] = [];
  let running = 0;
  let maxRunning = 0;
  class Tensor {
    constructor(readonly type: string, readonly data: Float32Array, readonly dims: readonly number[]) {}
  }
  const ort = {
    env: { wasm: {} as Record<string, unknown> },
    Tensor,
    InferenceSession: {
      async create(bytes: Uint8Array, sessionOptions: { executionProviders: string[] }) {
        const model = new TextDecoder().decode(bytes).replace('-model', '');
        const backend = sessionOptions.executionProviders[0];
        creates.push({ model, providers: [...sessionOptions.executionProviders] });
        createOptions.push(sessionOptions);
        if (options.failCreate?.includes(backend)) throw new Error(`no ${backend} here`);
        const matte = model === 'matte';
        return {
          inputNames: [matte ? 'img' : 'pixel_values'],
          outputNames: [matte ? 'mask' : 'predicted_depth'],
          async release() {
            if (options.failRelease?.includes(backend)) throw new Error(`${backend} device lost`);
            released.push(`${model}:${backend}`);
          },
          async run(feeds: Record<string, Tensor>) {
            running++;
            maxRunning = Math.max(maxRunning, running);
            try {
              runs.push({ model, backend, feeds: feeds as never });
              if (options.gate) await options.gate();
              if (options.failRun?.includes(backend)) throw new Error(`${backend} ran out of memory`);
              const input = Object.values(feeds)[0];
              if (matte) {
                const data = new Float32Array(1024 * 1024);
                for (let i = 0; i < data.length; i++) data[i] = options.matteValue?.(i) ?? 0.5;
                if (options.nanOn?.includes(backend)) data[1] = NaN;
                return { mask: { data, dims: options.matteDims ?? [1, 1, 1024, 1024] } };
              }
              const [, , h, w] = input.dims;
              const data = new Float32Array(h * w);
              for (let i = 0; i < data.length; i++) data[i] = i % w; // 左遠右近
              if (options.nanOn?.includes(backend)) data[1] = NaN;
              return { predicted_depth: { data, dims: options.depthDims?.(h, w) ?? [1, h, w] } };
            } finally { running--; }
          },
        };
      },
    },
  };
  return { ort: ort as unknown as OrtLike, creates, createOptions, runs, released, maxRunning: () => maxRunning };
}

const CONFIG: AiWorkerConfig = {
  modelUrls: { matte: `${ORIGIN}/models/isnet-anime.onnx`, depth: `${ORIGIN}/models/depth-anything-v2-small.onnx` },
  ortBase: `${ORIGIN}/ort/`,
};

function serve(bytes: Uint8Array) {
  return new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } });
}

/** 同源伺服器：模型與 onnxruntime 執行檔。 */
function defaultServer(config: AiWorkerConfig) {
  return async (url: string): Promise<Response> => {
    if (url === config.ortBase + RUNTIME_FILES.mjs) return serve(RUNTIME_MJS);
    if (url === config.ortBase + RUNTIME_FILES.wasm) return serve(RUNTIME_WASM);
    const model = (Object.keys(config.modelUrls) as AiModel[]).find((m) => config.modelUrls[m] === url);
    if (!model) return new Response(null, { status: 404 });
    return serve(MODEL_BYTES[model]);
  };
}

type Kind = AiTask['kind'];
const TASKS: Record<Kind, AiTask> = {
  matte: { kind: 'matte' },
  depth: { kind: 'depth' },
  cutout: { kind: 'cutout', refine: { feather: 1 } },
  layers: { kind: 'layers', split: { bands: 3 } },
};

function setup(
  options: FakeOptions = {}, config: AiWorkerConfig = CONFIG,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const fake = fakeOrt(options);
  const posted: { message: AiWorkerResponse; transfer: Transferable[] }[] = [];
  const server = defaultServer(config);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (fetchImpl ? fetchImpl(url, init) : server(url)));
  const worker = createAiWorker({
    ort: fake.ort,
    fetch: fetchMock,
    post: (message, transfer = []) => posted.push({ message, transfer }),
  });
  worker.handle({ type: 'init', config });
  let nextId = 1;
  const run = (task: Kind | AiTask, image = rgba(8, 6)) => {
    const id = nextId++;
    const data = image.data.slice().buffer;
    worker.handle({ type: 'run', id, task: typeof task === 'string' ? TASKS[task] : task, width: image.width, height: image.height, data });
    return id;
  };
  const messages = (id?: number) => posted.map((p) => p.message).filter((m) => id === undefined || m.id === id);
  const result = (id: number) => {
    const found = messages(id).find((m) => m.type === 'result' || m.type === 'error');
    if (!found) throw new Error(`no result for ${id}`);
    return found;
  };
  const ok = (id: number) => {
    const found = result(id);
    if (found.type !== 'result') throw new Error(`${found.code}: ${found.message}`);
    return found;
  };
  const modelFetches = () => fetchMock.mock.calls.filter(([url]) => !url.startsWith(config.ortBase)).length;
  return { ...fake, worker, posted, fetchMock, run, messages, result, ok, modelFetches };
}

const gray = (payload: AiResultPayload) => {
  if (payload.kind !== 'gray') throw new Error(`expected gray, got ${payload.kind}`);
  return new Float32Array(payload.data);
};

describe('createAiWorker（Worker 那半）', () => {
  it('runs onnxruntime single-threaded without a proxy Worker', () => {
    const { ort } = setup();
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(ort.env.wasm.proxy).toBe(false);
  });

  it('fetches every file same-origin without following redirects, and hands onnxruntime the runtime itself（它自己不連網）', async () => {
    const t = setup();
    t.run('matte');
    t.run('depth');
    await t.worker.idle();
    const urls = t.fetchMock.mock.calls.map(([url]) => url);
    expect(urls.sort()).toEqual([
      CONFIG.modelUrls.depth, CONFIG.modelUrls.matte, CONFIG.ortBase + RUNTIME_FILES.mjs, CONFIG.ortBase + RUNTIME_FILES.wasm,
    ].sort()); // 執行檔只讀一次
    for (const [, init] of t.fetchMock.mock.calls) expect(init).toMatchObject(SAME_ORIGIN);
    const wasm = t.ort.env.wasm as { wasmBinary?: Uint8Array; wasmPaths?: unknown };
    expect(Array.from(wasm.wasmBinary!)).toEqual(Array.from(RUNTIME_WASM));
    // 只給 mjs 的 blob: 網址（內容是我們讀好的）；不給資料夾前綴或 wasm 網址，onnxruntime 就沒有東西可以自己去抓。
    expect(wasm.wasmPaths).toEqual({ mjs: expect.stringMatching(/^blob:/) });
    const blob = await (await fetch((wasm.wasmPaths as { mjs: string }).mjs)).text();
    expect(blob).toBe(new TextDecoder().decode(RUNTIME_MJS));
  });

  it('a redirect or network failure is load-failed; a missing runtime is model-missing', async () => {
    const redirected = setup({}, CONFIG, async () => { throw new TypeError('Failed to fetch (redirect)'); });
    const a = redirected.run('matte');
    await redirected.worker.idle();
    expect(redirected.result(a)).toMatchObject({ type: 'error', code: 'load-failed', message: expect.stringMatching(/redirect/) });

    const server = defaultServer(CONFIG);
    const noRuntime = setup({}, CONFIG, async (url) => (url.endsWith('.mjs') ? new Response(null, { status: 404 }) : server(url)));
    const b = noRuntime.run('matte');
    await noRuntime.worker.idle();
    expect(noRuntime.result(b)).toMatchObject({ type: 'error', code: 'model-missing' });
    expect(noRuntime.creates).toHaveLength(0);
  });

  it('runs matte on WebGPU, reports stages and transfers the original-size alpha back', async () => {
    const t = setup();
    const id = t.run('matte');
    await t.worker.idle();
    const result = t.ok(id);
    expect([result.width, result.height]).toEqual([8, 6]);
    const alpha = gray(result.payload);
    expect(alpha).toHaveLength(48);
    expect(alpha[0]).toBeCloseTo(0.5);
    expect(result.info.backend).toBe('webgpu');
    for (const key of ['loadMs', 'runMs', 'postMs'] as const) expect(result.info[key]).toBeGreaterThanOrEqual(0);
    const transfer = t.posted.find((p) => p.message === result)!.transfer;
    expect(transfer).toEqual(payloadTransfers(result.payload));
    expect(t.creates).toEqual([{ model: 'matte', providers: ['webgpu'] }]);
    expect(t.createOptions[0]).toMatchObject({ logSeverityLevel: 3 }); // console 不印無害的警告
    const feed = t.runs[0].feeds.img;
    expect(feed.type).toBe('float32');
    expect(feed.dims).toEqual([1, 3, 1024, 1024]);
    const stages = t.messages(id).filter((m) => m.type === 'progress').map((m) => m.type === 'progress' && m.stage);
    expect(stages[0]).toBe('load');
    expect(stages).toContain('run');
    expect(stages.at(-1)).toBe('post');
    expect(result.debug).toMatchObject({ model: 'matte', inputName: 'img', outputName: 'mask', outOfRange: 0 });
    expect(result.debug?.requests).toEqual(expect.any(Array));
  });

  it('clamps a few slightly out-of-range matte values instead of reinterpreting the whole mask（不再猜 logit）', async () => {
    const t = setup({ matteValue: (i) => (i === 0 ? 1.002 : i === 1 ? 1.5 : 0) }); // 1.002 在容許誤差內，1.5 算超出
    const id = t.run('matte', rgba(4, 4));
    await t.worker.idle();
    const result = t.ok(id);
    const alpha = gray(result.payload);
    expect(Math.max(...alpha)).toBeLessThanOrEqual(1);
    expect(alpha[15]).toBe(0); // 以前會整張套 sigmoid 變成 0.5
    expect(result.debug).toMatchObject({ outOfRange: 1 });
  });

  it.each([
    ['many values out of 0～1', { matteValue: (i: number) => (i % 2 ? 3 : -3) }],
    ['NaN on WebGPU', { nanOn: ['webgpu'] }],
  ])('matte output with %s is bad-output (no WASM retry)', async (_name, options) => {
    const t = setup(options);
    const id = t.run('matte');
    await t.worker.idle();
    expect(t.result(id)).toMatchObject({ type: 'error', code: 'bad-output' });
    expect(t.runs.map((r) => r.backend)).toEqual(['webgpu']);
  });

  it('accepts the matte shapes [1,1,1024,1024] and [1,1024,1024] only', async () => {
    const flat = setup({ matteDims: [1, 1024, 1024] });
    const a = flat.run('matte');
    await flat.worker.idle();
    expect(flat.result(a).type).toBe('result');
    for (const dims of [[1, 1024, 1024, 1], [1024, 1, 1024, 1], [1, 1, 512, 2048], [1, 1048576]]) {
      const t = setup({ matteDims: dims });
      const id = t.run('matte');
      await t.worker.idle();
      expect(t.result(id), `dims ${dims}`).toMatchObject({ type: 'error', code: 'bad-output' });
    }
  });

  it('accepts depth output [1,H,W] only; a transposed [1,W,H] or extra axes is bad-output', async () => {
    for (const [name, depthDims] of [
      ['transposed', (h: number, w: number) => [1, w, h]],
      ['4-D', (h: number, w: number) => [1, 1, h, w]],
      ['flat', (h: number, w: number) => [1, h * w]],
    ] as const) {
      const t = setup({ depthDims });
      const id = t.run('depth', rgba(30, 20));
      await t.worker.idle();
      expect(t.result(id), name).toMatchObject({ type: 'error', code: 'bad-output' });
    }
  });

  it('depth with NaN is bad-output', async () => {
    const t = setup({ nanOn: ['webgpu'] });
    const id = t.run('depth');
    await t.worker.idle();
    expect(t.result(id)).toMatchObject({ type: 'error', code: 'bad-output' });
  });

  it('runs depth with patch-sized input and maps the model output back to the image size (1 = near)', async () => {
    const t = setup();
    const id = t.run('depth', rgba(30, 20));
    await t.worker.idle();
    const result = t.ok(id);
    expect([result.width, result.height]).toEqual([30, 20]);
    const depth = gray(result.payload);
    expect(depth[0]).toBeLessThan(0.05);
    expect(depth[29]).toBeGreaterThan(0.95);
    const dims = t.runs[0].feeds.pixel_values.dims;
    expect(dims.slice(0, 2)).toEqual([1, 3]);
    expect(Math.min(dims[2], dims[3])).toBe(518);
    expect(dims[2] % 14).toBe(0);
    expect(dims[3] % 14).toBe(0);
  });

  it('cutout refines and applies the mask in the Worker and reports coverage', async () => {
    const t = setup({ matteValue: (i) => ((i % 1024) < 512 ? 1 : 0) }); // 左半是主角
    const id = t.run({ kind: 'cutout', refine: { feather: 0 } }, rgba(8, 8, 200));
    await t.worker.idle();
    const result = t.ok(id);
    expect(result.payload.kind).toBe('cutout');
    if (result.payload.kind !== 'cutout') return;
    const pixels = new Uint8ClampedArray(result.payload.data);
    expect(pixels).toHaveLength(8 * 8 * 4);
    expect(pixels[3]).toBe(200); // 左上：保留（原 alpha 200 × 1）
    expect(Array.from(pixels.subarray(7 * 4, 8 * 4))).toEqual([0, 0, 0, 0]); // 右上：去掉，顏色清 0
    expect(result.payload.coverage).toBeCloseTo(0.5, 1);
    expect(t.posted.find((p) => p.message === result)!.transfer).toEqual([result.payload.data]);
  });

  it('cutout of an image without a subject has coverage near 0', async () => {
    const t = setup({ matteValue: () => 0.001 });
    const id = t.run('cutout');
    await t.worker.idle();
    const result = t.ok(id);
    if (result.payload.kind !== 'cutout') throw new Error('expected cutout');
    expect(result.payload.coverage).toBeLessThan(0.005);
  });

  it('layers splits by depth in the Worker and transfers every band', async () => {
    const t = setup();
    const id = t.run({ kind: 'layers', split: { bands: 3 } }, rgba(30, 20));
    await t.worker.idle();
    const result = t.ok(id);
    if (result.payload.kind !== 'layers') throw new Error('expected layers');
    expect(result.payload.bands.map((band) => band.depth)).toEqual([0, 50, 100]);
    for (const band of result.payload.bands) expect(band.data.byteLength).toBe(30 * 20 * 4);
    expect(t.posted.find((p) => p.message === result)!.transfer).toEqual(result.payload.bands.map((band) => band.data));
  });

  it('bad refine or split options are run-failed', async () => {
    const t = setup();
    const a = t.run({ kind: 'cutout', refine: { feather: -1 } });
    const b = t.run({ kind: 'layers', split: { bands: 9 } });
    await t.worker.idle();
    expect(t.result(a)).toMatchObject({ type: 'error', code: 'run-failed' });
    expect(t.result(b)).toMatchObject({ type: 'error', code: 'run-failed' });
  });

  it('loads each model only once and reuses the session', async () => {
    const t = setup();
    const ids = [t.run('matte'), t.run('depth'), t.run('cutout'), t.run('layers')];
    await t.worker.idle();
    expect(ids.map((id) => t.result(id).type)).toEqual(['result', 'result', 'result', 'result']);
    expect(t.modelFetches()).toBe(2);
    expect(t.creates.map((c) => c.model)).toEqual(['matte', 'depth']);
    expect(t.runs).toHaveLength(4);
  });

  it('runs jobs one at a time (never two session.run at once)', async () => {
    let release!: () => void;
    const gate = () => new Promise<void>((resolve) => { release = resolve; });
    const t = setup({ gate });
    const a = t.run('depth');
    const b = t.run('depth');
    for (let i = 0; i < 20 && t.runs.length === 0; i++) await tick();
    expect(t.runs).toHaveLength(1);
    release();
    for (let i = 0; i < 20 && t.runs.length < 2; i++) await tick();
    release();
    await t.worker.idle();
    expect(t.maxRunning()).toBe(1);
    expect([t.result(a).type, t.result(b).type]).toEqual(['result', 'result']);
  });

  it('falls back to WASM when the WebGPU session cannot be created', async () => {
    const t = setup({ failCreate: ['webgpu'] });
    const id = t.run('matte');
    await t.worker.idle();
    const result = t.ok(id);
    expect(result.info.backend).toBe('wasm');
    expect(t.creates.map((c) => c.providers)).toEqual([['webgpu'], ['wasm']]);
    expect(t.modelFetches()).toBe(1);
    expect(result.debug?.fallback).toMatch(/no webgpu here/);
  });

  it('falls back to WASM when WebGPU fails while running, and keeps using WASM afterwards', async () => {
    const t = setup({ failRun: ['webgpu'] });
    const first = t.run('depth');
    const second = t.run('depth');
    await t.worker.idle();
    const a = t.ok(first);
    const b = t.ok(second);
    expect([a.info.backend, b.info.backend]).toEqual(['wasm', 'wasm']);
    expect(t.runs.map((r) => r.backend)).toEqual(['webgpu', 'wasm', 'wasm']);
    expect(t.released).toEqual(['depth:webgpu']);
    expect(a.debug?.fallback).toMatch(/ran out of memory/);
  });

  it('if the failed WebGPU session cannot be released, stops (no WASM copy) and asks for a Worker restart', async () => {
    const t = setup({ failRun: ['webgpu'], failRelease: ['webgpu'] });
    const id = t.run('depth');
    await t.worker.idle();
    expect(t.result(id)).toMatchObject({ type: 'error', code: 'run-failed', restart: true, message: expect.stringMatching(/device lost/) });
    expect(t.creates.map((c) => c.providers)).toEqual([['webgpu']]); // 沒有再建 WASM session
    expect(t.modelFetches()).toBe(1);
  });

  it('a job canceled while the WebGPU run fails does not re-download, rebuild or rerun on WASM', async () => {
    let release!: () => void;
    const gate = () => new Promise<void>((resolve) => { release = resolve; });
    const t = setup({ gate, failRun: ['webgpu'] });
    const id = t.run('depth');
    for (let i = 0; i < 20 && t.runs.length === 0; i++) await tick();
    t.worker.handle({ type: 'cancel', id });
    release();
    await t.worker.idle();
    expect(t.messages(id).some((m) => m.type === 'result' || m.type === 'error')).toBe(false);
    expect(t.modelFetches()).toBe(1);
    expect(t.creates.map((c) => c.providers)).toEqual([['webgpu']]);
    expect(t.runs).toHaveLength(1);
    expect(t.released).toEqual(['depth:webgpu']); // GPU 記憶體還是要放掉
    // 下一件直接用 WASM（這個模型在 WebGPU 跑不動）
    const next = t.run('depth');
    for (let i = 0; i < 20 && t.runs.length < 2; i++) await tick();
    release();
    await t.worker.idle();
    expect(t.ok(next).info.backend).toBe('wasm');
  });

  it('a forced backend is the only one tried', async () => {
    const wasm = setup({}, { ...CONFIG, backend: 'wasm' });
    const id = wasm.run('matte');
    await wasm.worker.idle();
    expect(wasm.creates.map((c) => c.providers)).toEqual([['wasm']]);
    expect(wasm.result(id)).toMatchObject({ info: { backend: 'wasm' } });

    const gpu = setup({ failCreate: ['webgpu'] }, { ...CONFIG, backend: 'webgpu' });
    const failed = gpu.run('matte');
    await gpu.worker.idle();
    expect(gpu.creates.map((c) => c.providers)).toEqual([['webgpu']]);
    expect(gpu.result(failed)).toMatchObject({ type: 'error', code: 'load-failed', message: expect.stringMatching(/no webgpu here/) });

    const gpuRun = setup({ failRun: ['webgpu'] }, { ...CONFIG, backend: 'webgpu' });
    const runFailed = gpuRun.run('matte');
    await gpuRun.worker.idle();
    expect(gpuRun.result(runFailed)).toMatchObject({ type: 'error', code: 'run-failed' });
  });

  it('reports a missing model (404 or HTML fallback) as model-missing and retries the download next time', async () => {
    let missing = true;
    const server = defaultServer(CONFIG);
    const t = setup({}, CONFIG, async (url) => (missing && url === CONFIG.modelUrls.matte
      ? new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
      : server(url)));
    const first = t.run('matte');
    await t.worker.idle();
    expect(t.result(first)).toMatchObject({ type: 'error', code: 'model-missing', requests: expect.any(Array) });
    missing = false;
    const second = t.run('matte');
    await t.worker.idle();
    expect(t.result(second).type).toBe('result');
    expect(t.modelFetches()).toBe(2);
  });

  it('reports download progress as a 0～1 ratio', async () => {
    const big = new Uint8Array(300_000);
    big.set(MODEL_BYTES.depth);
    const server = defaultServer(CONFIG);
    const t = setup({}, CONFIG, async (url) => (url !== CONFIG.modelUrls.depth ? server(url) : new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < big.length; i += 100_000) controller.enqueue(big.slice(i, i + 100_000));
        controller.close();
      },
    }), { headers: { 'content-length': String(big.length) } })));
    const id = t.run('depth');
    await t.worker.idle();
    const loads = t.messages(id).flatMap((m) => (m.type === 'progress' && m.stage === 'load' ? [[m.done, m.total]] : []));
    expect(loads.every(([, total]) => total === 1)).toBe(true);
    expect(loads.map(([done]) => done)).toEqual([...loads.map(([done]) => done)].sort((x, y) => x - y));
    expect(loads.some(([done]) => done > 0 && done < 1)).toBe(true);
    expect(loads.at(-1)).toEqual([1, 1]);
  });

  it('turns bad input into run-failed instead of crashing', async () => {
    const t = setup();
    t.worker.handle({ type: 'run', id: 99, task: { kind: 'matte' }, width: 3, height: 3, data: new ArrayBuffer(4) });
    await t.worker.idle();
    expect(t.result(99)).toMatchObject({ type: 'error', code: 'run-failed' });
    expect(t.runs).toHaveLength(0);
  });

  it('skips a job canceled before it starts, and drops the result of a job canceled mid-run', async () => {
    let release!: () => void;
    const gate = () => new Promise<void>((resolve) => { release = resolve; });
    const t = setup({ gate });
    const running = t.run('matte');
    const queued = t.run('matte');
    for (let i = 0; i < 20 && t.runs.length === 0; i++) await tick();
    t.worker.handle({ type: 'cancel', id: running });
    t.worker.handle({ type: 'cancel', id: queued });
    release();
    await t.worker.idle();
    expect(t.runs).toHaveLength(1); // 排隊中的那個沒跑
    expect(t.messages(running).some((m) => m.type === 'result' || m.type === 'error')).toBe(false);
    expect(t.messages(running).some((m) => m.type === 'progress' && m.stage === 'post')).toBe(false);
    expect(t.messages(queued)).toEqual([]);
    // 之後的工作照常
    const later = t.run('matte');
    for (let i = 0; i < 20 && t.runs.length < 2; i++) await tick();
    release();
    await t.worker.idle();
    expect(t.result(later).type).toBe('result');
  });

  it('a run before init is run-failed', async () => {
    const fake = fakeOrt();
    const posted: AiWorkerResponse[] = [];
    const worker = createAiWorker({ ort: fake.ort, fetch: vi.fn(), post: (m) => posted.push(m) });
    worker.handle({ type: 'run', id: 1, task: { kind: 'matte' }, width: 1, height: 1, data: new ArrayBuffer(4) });
    await worker.idle();
    expect(posted).toEqual([expect.objectContaining({ type: 'error', id: 1, code: 'run-failed', message: expect.stringMatching(/init/i) })]);
  });
});

// ---------------------------------------------------------------- 兩半接起來

describe('runner ↔ worker（接起來）', () => {
  it('every task round-trips through structured clone with transfers, and abort drops the result', async () => {
    const fake = fakeOrt({ matteValue: (i) => ((i % 1024) < 512 ? 1 : 0) });
    const server = defaultServer({ ...CONFIG });
    class BridgeWorker extends FakeWorker {
      core = createAiWorker({
        ort: fake.ort,
        fetch: async (url: string) => server(url),
        post: (message, transfer = []) => queueMicrotask(() => this.emit(message, transfer)),
      });
      constructor(url: URL, options: WorkerOptions) {
        super(url, options);
        this.postMessage.mockImplementation((message: AiWorkerRequest, transfer: Transferable[] = []) => {
          this.transfers.push(transfer);
          const cloned = structuredClone(message, { transfer });
          this.received.push(cloned);
          this.core.handle(cloned);
        });
      }
    }
    vi.stubGlobal('Worker', BridgeWorker);
    const runner = createAiRunner();
    const image = rgba(16, 12);
    const progress = vi.fn();
    const matte = await runner.matte(image, undefined, progress);
    expect([matte.alpha.width, matte.alpha.height, matte.alpha.data.length]).toEqual([16, 12, 192]);
    expect(matte.info.backend).toBe('webgpu');
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual(expect.arrayContaining(['load', 'run', 'post']));
    const depth = await runner.depth(image);
    expect(depth.depth.data[0]).toBeLessThan(0.05); // 左遠
    expect(depth.depth.data[15]).toBeGreaterThan(0.95); // 右近
    const cut = await runner.removeBackground(image, { feather: 0 });
    expect(cut.image.data[3]).toBe(200);
    expect(cut.image.data[15 * 4 + 3]).toBe(0);
    expect(cut.coverage).toBeCloseTo(0.5, 1);
    const layers = await runner.splitLayers(image, { bands: 2 });
    expect(layers.bands.map((band) => band.depth)).toEqual([0, 100]);
    expect(image.data.byteLength).toBe(16 * 12 * 4);

    const controller = new AbortController();
    const aborted = runner.matte(image, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    const after = await runner.depth(image);
    expect(after.depth.width).toBe(16);
    expect(fake.creates).toHaveLength(2); // 模型各只載入一次
    runner.dispose();
  });
});
