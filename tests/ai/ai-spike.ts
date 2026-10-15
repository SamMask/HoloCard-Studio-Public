// AI 推論實測頁（T-702／T-702c）：開發伺服器上打開 /tests/ai/ai-spike.html。只在開發時用，不打包進工坊。
// 用工坊會用的 API：removeBackground（去背成品）、splitLayers（拆層），前後處理全在 Worker。
// 量：去背對不對（範例角色圖本來就去背過 → 疊到底圖上當不透明的題目，原本的 alpha 當標準答案）、拆成三段、
// 各階段毫秒數、WebGPU／WASM、主執行緒卡不卡（long task）、記憶體、請求是不是全部同源（Worker 沒回報請求紀錄＝未確認）。
// 網址參數：?backend=webgpu|wasm（預設自動）、?images=1,2（只跑哪幾張，1 起算）、?three=1（同時跑 three.js 動畫）、?auto=0（不自動開始）、
// ?ortBase=/node_modules/onnxruntime-web/dist/（onnxruntime 的 wasm 從別的同源資料夾讀；預設 /ort/）。
// 結果寫在 DOM：<body data-state（done／error：任一張失敗就是 error） data-backend data-same-origin（true／false／unconfirmed）
// data-summary（JSON）>、每張圖的 <section data-*>；也放在 window.__aiSpike。

import { Mesh, MeshNormalMaterial, PerspectiveCamera, Scene, TorusKnotGeometry, WebGPURenderer } from 'three/webgpu';
import { AiError, createDebugAiRunner } from '../../src/ai/runner';
import type { AiRunInfo, AiRunner, GrayImage, RgbaImage } from '../../src/ai/types';
import type { AiDebugInfo } from '../../src/ai/worker';

type Backend = AiRunInfo['backend'];

interface Sample {
  id: string;
  label: string;
  /** 不透明的底。 */
  base: string;
  /** 已去背的角色圖（疊在底上當題目；它的 alpha 當標準答案）。省略＝整張就是題目、沒有標準答案。 */
  hero?: string;
}

const ART = '/.art-tmp/samples-v2';
const SAMPLES: Sample[] = [
  { id: 'card1', label: '卡 1 角色（破框版）疊底圖', base: `${ART}/card1/base.webp`, hero: `${ART}/card1/hero-breakout.webp` },
  { id: 'card2', label: '卡 2 角色疊底圖', base: `${ART}/card2/base.webp`, hero: `${ART}/card2/hero.webp` },
  { id: 'card3', label: '卡 3 角色疊底圖', base: `${ART}/card3/base.webp`, hero: `${ART}/card3/hero.webp` },
  { id: 'card4', label: '卡 4 角色疊底圖', base: `${ART}/card4/base.webp`, hero: `${ART}/card4/hero.webp` },
  { id: 'scene3', label: '卡 3 背景（不透明插圖、沒有角色）', base: `${ART}/card3/base.webp` },
  { id: 'preview2', label: '卡 2 成品預覽（不透明、整張卡）', base: `${ART}/card2/preview.png` },
];

interface CutResult {
  info: AiRunInfo;
  debug?: AiDebugInfo;
  /** 修好的遮罩平均值（< 0.005＝找不到主角）。 */
  coverage: number;
  /** 和標準答案比：去背結果 alpha > 0.5 的交集／聯集。 */
  iou?: number;
  /** 和標準答案比：平均絕對差（0～1）。 */
  mae?: number;
}

interface LayerResult {
  info: AiRunInfo;
  debug?: AiDebugInfo;
  bands: { depth: number; coverage: number }[];
  /** 有標準答案時：最近那一段在角色範圍、背景範圍的平均不透明度（角色應該高、背景應該低）。 */
  heroInNear?: number;
  backInNear?: number;
}

interface ImageResult {
  id: string;
  width: number;
  height: number;
  cut?: CutResult;
  layers?: LayerResult;
  error?: string;
}

interface Summary {
  requestedBackend: Backend | 'auto';
  backend?: Backend;
  /** hasFastBackend() 的答案。 */
  fast?: boolean;
  available?: { matte: boolean; depth: boolean };
  images: ImageResult[];
  totalMs?: number;
  /** 等推論的期間，主執行緒的 long task（> 50 ms）。 */
  longTasks: { count: number; maxMs: number };
  /** 開了 three.js 動畫時：等推論期間的畫面間隔。 */
  frames?: { backend: string; count: number; maxGapMs: number; p95GapMs: number; over50: number };
  cancel?: { name: string; ms: number; afterwardOk: boolean };
  memory?: { usedMB: number; totalMB: number; limitMB: number };
  /** sameOrigin：Worker 沒有回報請求紀錄時是 'unconfirmed'。 */
  requests: { page: string[]; worker: string[]; sameOrigin: boolean | 'unconfirmed' };
  /** 失敗的件數（任一張圖或取消測試）。 */
  failed: number;
  error?: string;
}

const out = document.getElementById('out')!;
const results = document.getElementById('results')!;
const params = new URLSearchParams(location.search);

function log(line: string): void {
  out.textContent += `${line}\n`;
}

const ms = (value: number) => `${Math.round(value)} ms`;

// ---- 圖 ----

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`找不到測試圖 ${url}`);
  return createImageBitmap(await response.blob());
}

function pixels(canvas: HTMLCanvasElement): RgbaImage {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data };
}

/** 題目（不透明）與標準答案（角色的 alpha，0～1）。 */
async function buildSample(sample: Sample): Promise<{ image: RgbaImage; truth?: GrayImage }> {
  const base = await loadBitmap(sample.base);
  const hero = sample.hero ? await loadBitmap(sample.hero) : undefined;
  const width = hero?.width ?? base.width;
  const height = hero?.height ?? base.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // 底圖「填滿」畫布（卡 4 的角色圖比底圖高，有出血）。
  const scale = Math.max(width / base.width, height / base.height);
  ctx.drawImage(base, (width - base.width * scale) / 2, (height - base.height * scale) / 2, base.width * scale, base.height * scale);
  let truth: GrayImage | undefined;
  if (hero) {
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = width;
    alphaCanvas.height = height;
    alphaCanvas.getContext('2d')!.drawImage(hero, 0, 0);
    const heroPixels = pixels(alphaCanvas).data;
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = heroPixels[i * 4 + 3]! / 255;
    truth = { width, height, data };
    ctx.drawImage(hero, 0, 0);
  }
  base.close();
  hero?.close();
  return { image: pixels(canvas), truth };
}

// ---- 顯示 ----

const THUMB = 240;

function thumb(image: RgbaImage, alpha = false): HTMLCanvasElement {
  const full = document.createElement('canvas');
  full.width = image.width;
  full.height = image.height;
  full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const small = document.createElement('canvas');
  small.width = THUMB * 2;
  small.height = Math.round((image.height / image.width) * THUMB * 2);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, small.width, small.height);
  if (alpha) small.className = 'alpha';
  return small;
}

function grayToRgba(gray: GrayImage): RgbaImage {
  const data = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0; i < gray.data.length; i++) {
    const v = Math.round(gray.data[i]! * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: gray.width, height: gray.height, data };
}

function figure(row: HTMLElement, canvas: HTMLCanvasElement, caption: string): void {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(canvas, cap);
  row.append(fig);
}

// ---- 量測 ----

/** 等推論的時間窗（之後拿來篩 long task 與畫面間隔）。 */
const waits: [number, number][] = [];
const longTasks: PerformanceEntry[] = [];
try {
  new PerformanceObserver((list) => longTasks.push(...list.getEntries())).observe({ type: 'longtask', buffered: true });
} catch { /* 不支援就算了 */ }

async function timed<T>(promise: Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await promise;
  } finally {
    waits.push([start, performance.now()]);
  }
}

const inWaits = (start: number, end = start) => waits.some(([a, b]) => start < b && end > a);
/**
 * 整個落在等推論期間裡的工作。收到結果的那個工作會接著跑頁面自己的 refine／切段／縮圖（時間窗的結尾就記在它中間），
 * 它和呼叫 ai.matte() 的那一段都是頁面自己的工作，不算推論造成的卡頓。
 */
const withinWaits = (start: number, end: number) => waits.some(([a, b]) => start > a && end <= b);

function memory(): Summary['memory'] {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!m) return undefined;
  const mb = (bytes: number) => Math.round(bytes / 1048576);
  return { usedMB: mb(m.usedJSHeapSize), totalMB: mb(m.totalJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) };
}

/** 去背結果（RGBA）的 alpha 和標準答案比。題目是不透明的，所以結果的 alpha＝修好的遮罩。 */
function compare(cut: RgbaImage, truth: GrayImage): { iou: number; mae: number } {
  let inter = 0;
  let union = 0;
  let abs = 0;
  for (let i = 0; i < truth.data.length; i++) {
    const alpha = cut.data[i * 4 + 3]! / 255;
    const a = alpha > 0.5;
    const t = truth.data[i]! > 0.5;
    if (a && t) inter++;
    if (a || t) union++;
    abs += Math.abs(alpha - truth.data[i]!);
  }
  return { iou: union ? inter / union : 1, mae: abs / truth.data.length };
}

function alphaOf(image: RgbaImage): GrayImage {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) data[i] = image.data[i * 4 + 3]! / 255;
  return { width: image.width, height: image.height, data };
}

const describeError = (error: unknown) => (error instanceof AiError
  ? `AiError ${error.code}: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`
  : error instanceof Error ? `${error.name}: ${error.message}` : String(error));

// ---- three.js（同時用 WebGPU 會不會卡）----

const frameTimes: number[] = [];
let threeBackend = '';
let threeRenderer: WebGPURenderer | undefined;

async function startThree(): Promise<void> {
  if (threeRenderer) return;
  const canvas = document.getElementById('three') as HTMLCanvasElement;
  canvas.style.display = 'block';
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  threeBackend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 100);
  camera.position.z = 6;
  const mesh = new Mesh(new TorusKnotGeometry(1.2, 0.4, 200, 32), new MeshNormalMaterial());
  scene.add(mesh);
  renderer.setAnimationLoop((time) => {
    frameTimes.push(performance.now());
    mesh.rotation.set(time / 1300, time / 900, 0);
    void renderer.render(scene, camera);
  });
  threeRenderer = renderer;
}

function frameStats(): Summary['frames'] {
  if (!threeRenderer) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < frameTimes.length; i++) {
    if (inWaits(frameTimes[i - 1]!, frameTimes[i]!)) gaps.push(frameTimes[i]! - frameTimes[i - 1]!);
  }
  gaps.sort((a, b) => a - b);
  return {
    backend: threeBackend,
    count: gaps.length,
    maxGapMs: Math.round(gaps.at(-1) ?? 0),
    p95GapMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
    over50: gaps.filter((gap) => gap > 50).length,
  };
}

// ---- 主流程 ----

let runner: AiRunner | undefined;
let running = false;

function selectedSamples(): Sample[] {
  const list = params.get('images');
  if (!list) return SAMPLES;
  const picks = list.split(',').map((n) => Number(n) - 1);
  return SAMPLES.filter((_, i) => picks.includes(i));
}

async function runAll(backend?: Backend): Promise<void> {
  if (running) return;
  running = true;
  document.body.dataset.state = 'running';
  out.textContent = '';
  results.textContent = '';
  waits.length = 0;
  longTasks.length = 0;
  frameTimes.length = 0;
  runner?.dispose();
  const debugs: AiDebugInfo[] = [];
  let workerRequests: string[] | undefined;
  const ortBase = params.get('ortBase');
  const ai = createDebugAiRunner({
    ...(backend ? { backend } : {}), ...(ortBase ? { ortBase } : {}),
    onDebug: (debug) => { debugs.push(debug); },
    onRequests: (urls) => { workerRequests = urls; },
  });
  runner = ai;
  const summary: Summary = {
    requestedBackend: backend ?? 'auto', images: [], longTasks: { count: 0, maxMs: 0 },
    requests: { page: [], worker: [], sameOrigin: 'unconfirmed' }, failed: 0,
  };
  (window as unknown as { __aiSpike: Summary }).__aiSpike = summary;
  const started = performance.now();
  try {
    if ((document.getElementById('use-three') as HTMLInputElement).checked) await startThree();
    summary.fast = await ai.hasFastBackend();
    summary.available = { matte: await ai.available('matte'), depth: await ai.available('depth') };
    log(`有 WebGPU：${summary.fast}；模型在不在：去背 ${summary.available.matte}、深度 ${summary.available.depth}`);
    if (!summary.available.matte || !summary.available.depth) throw new Error('模型檔不在 public/models/（npm run fetch-models）');

    for (const sample of selectedSamples()) {
      const section = document.createElement('section');
      section.dataset.image = sample.id;
      const title = document.createElement('h2');
      title.textContent = sample.label;
      const stats = document.createElement('div');
      stats.className = 'stats';
      const matteRow = document.createElement('div');
      matteRow.className = 'row';
      const depthRow = document.createElement('div');
      depthRow.className = 'row';
      section.append(title, stats, matteRow, depthRow);
      results.append(section);

      const { image, truth } = await buildSample(sample);
      const result: ImageResult = { id: sample.id, width: image.width, height: image.height };
      summary.images.push(result);
      section.dataset.size = `${image.width}x${image.height}`;
      try {
        // 去背成品（推論＋修邊＋套 alpha 都在 Worker）
        log(`${sample.id}：去背中…`);
        debugs.length = 0;
        const feather = Math.max(1, Math.round(Math.max(image.width, image.height) * 0.002));
        const cut = await timed(ai.removeBackground(image, { feather }, undefined, (stage, done) => {
          if (stage === 'load' && done > 0 && done < 1 && Math.round(done * 100) % 10 === 0) log(`  載入去背模型 ${Math.round(done * 100)}%`);
        }));
        const c: CutResult = { info: cut.info, debug: debugs.pop(), coverage: cut.coverage };
        if (truth) Object.assign(c, compare(cut.image, truth));
        result.cut = c;
        summary.backend = cut.info.backend;
        figure(matteRow, thumb(image), `題目 ${image.width}×${image.height}`);
        figure(matteRow, thumb(grayToRgba(alphaOf(cut.image))), `遮罩（修好後；涵蓋 ${(c.coverage * 100).toFixed(1)}%${c.coverage < 0.005 ? '＝找不到主角' : ''}）`);
        figure(matteRow, thumb(cut.image, true), `去背結果${c.iou !== undefined ? ` IoU ${c.iou.toFixed(3)}、平均差 ${c.mae!.toFixed(3)}` : ''}`);
        if (truth) figure(matteRow, thumb(grayToRgba(truth)), '標準答案（原本的 alpha）');

        // 拆層（推論＋正規化＋切段都在 Worker）
        log(`${sample.id}：拆層中…`);
        debugs.length = 0;
        const layers = await timed(ai.splitLayers(image, {}));
        const l: LayerResult = { info: layers.info, debug: debugs.pop(), bands: [] };
        l.bands = layers.bands.map((band) => {
          let covered = 0;
          for (let i = 3; i < band.image.data.length; i += 4) covered += band.image.data[i]! / 255;
          return { depth: band.depth, coverage: covered / (image.width * image.height) };
        });
        const near = layers.bands.at(-1);
        if (truth && near && layers.bands.length > 1) {
          let hero = 0, heroN = 0, back = 0, backN = 0;
          for (let i = 0; i < truth.data.length; i++) {
            const a = near.image.data[i * 4 + 3]! / 255;
            if (truth.data[i]! > 0.9) { hero += a; heroN++; } else if (truth.data[i]! < 0.1) { back += a; backN++; }
          }
          if (heroN && backN) { l.heroInNear = hero / heroN; l.backInNear = back / backN; }
        }
        result.layers = l;
        layers.bands.forEach((band, i) => figure(depthRow, thumb(band.image, true),
          `第 ${i} 段 深度 ${band.depth}（${Math.round(l.bands[i]!.coverage * 100)}%）${i === layers.bands.length - 1 && l.heroInNear !== undefined
            ? ` 角色 ${(l.heroInNear * 100).toFixed(0)}%／背景 ${(l.backInNear! * 100).toFixed(0)}%` : ''}`));

        const line = (name: string, info: AiRunInfo, debug?: AiDebugInfo) => `${name}[${info.backend}] 載入 ${ms(info.loadMs)}／前處理＋推論 ${ms(info.runMs)}`
          + `${debug ? `（推論 ${ms(debug.inferMs)}，輸入 ${debug.inputName} [${debug.inputDims}] → ${debug.outputName} [${debug.outputDims}]，原始值 ${debug.rawMin.toFixed(3)}～${debug.rawMax.toFixed(3)}、超出 0～1 ${debug.outOfRange}）` : ''}`
          + `／後處理（Worker）${ms(info.postMs)}${debug?.fallback ? `／退回原因：${debug.fallback}` : ''}`;
        stats.textContent = `${line('去背', c.info, c.debug)}\n${line('拆層', l.info, l.debug)}`;
        Object.assign(section.dataset, {
          backend: c.info.backend,
          cutLoadMs: String(Math.round(c.info.loadMs)), cutRunMs: String(Math.round(c.info.runMs)), cutPostMs: String(Math.round(c.info.postMs)),
          cutInferMs: String(Math.round(c.debug?.inferMs ?? -1)), coverage: c.coverage.toFixed(4),
          matteRaw: `${c.debug?.rawMin}..${c.debug?.rawMax}`, outOfRange: String(c.debug?.outOfRange ?? ''),
          iou: c.iou?.toFixed(4) ?? '', mae: c.mae?.toFixed(4) ?? '',
          layersLoadMs: String(Math.round(l.info.loadMs)), layersRunMs: String(Math.round(l.info.runMs)), layersPostMs: String(Math.round(l.info.postMs)),
          layersInferMs: String(Math.round(l.debug?.inferMs ?? -1)), depthDims: String(l.debug?.inputDims ?? ''),
          bands: l.bands.map((b) => `${b.depth}:${b.coverage.toFixed(2)}`).join(' '),
          heroInNear: l.heroInNear?.toFixed(3) ?? '', backInNear: l.backInNear?.toFixed(3) ?? '',
        });
      } catch (error) {
        result.error = describeError(error);
        summary.failed++;
        section.dataset.error = result.error;
        log(`${sample.id} 失敗：${result.error}`);
      }
      summary.memory = memory();
    }

    // 取消：開始後 30 ms 取消 → 要很快拿到 AbortError；之後下一件照常。
    const first = selectedSamples()[0];
    if (first) {
      const { image } = await buildSample(first);
      const controller = new AbortController();
      const t0 = performance.now();
      const pending = ai.removeBackground(image, { feather: 2 }, controller.signal);
      setTimeout(() => controller.abort(), 30);
      let name = 'not aborted';
      try { await pending; } catch (error) { name = error instanceof Error ? error.name : String(error); }
      const cancelMs = performance.now() - t0;
      let afterwardOk = false;
      try { afterwardOk = (await timed(ai.splitLayers(image, {}))).bands.length > 0; } catch { /* 留 false */ }
      summary.cancel = { name, ms: Math.round(cancelMs), afterwardOk };
      log(`取消測試：${name}（${ms(cancelMs)}），之後再跑${afterwardOk ? '正常' : '失敗'}`);
      if (name !== 'AbortError' || !afterwardOk) summary.failed++;
    }
  } catch (error) {
    summary.error = describeError(error);
    log(`失敗：${summary.error}`);
  } finally {
    summary.totalMs = Math.round(performance.now() - started);
    const during = longTasks.filter((task) => withinWaits(task.startTime, task.startTime + task.duration));
    summary.longTasks = { count: during.length, maxMs: Math.round(Math.max(0, ...during.map((task) => task.duration))) };
    summary.frames = frameStats();
    summary.memory = memory();
    summary.requests.page = performance.getEntriesByType('resource').map((entry) => entry.name);
    summary.requests.worker = workerRequests ?? [];
    const sameOrigin = [...summary.requests.page, ...summary.requests.worker]
      .every((url) => new URL(url, location.href).origin === location.origin);
    // Worker 沒有回報請求紀錄（例如 Worker 起不來）就不能說「全部同源」。
    summary.requests.sameOrigin = !sameOrigin ? false : workerRequests && workerRequests.length > 0 ? true : 'unconfirmed';
    log(`後端：${summary.backend ?? '—'}（要求 ${summary.requestedBackend}）；總共 ${ms(summary.totalMs)}；失敗 ${summary.failed} 件`);
    log(`等推論時主執行緒 long task：${summary.longTasks.count} 個，最長 ${summary.longTasks.maxMs} ms`);
    if (summary.frames) log(`three.js（${summary.frames.backend}）等推論時：${summary.frames.count} 格，最大間隔 ${summary.frames.maxGapMs} ms、p95 ${summary.frames.p95GapMs} ms、> 50 ms 的 ${summary.frames.over50} 格`);
    if (summary.memory) log(`主執行緒 JS 記憶體：${summary.memory.usedMB}／${summary.memory.totalMB} MB（上限 ${summary.memory.limitMB}；Worker 與 GPU 的記憶體看不到）`);
    log(`請求全部同源：${summary.requests.sameOrigin === 'unconfirmed' ? '未確認（Worker 沒有回報請求紀錄）' : summary.requests.sameOrigin}（頁面 ${summary.requests.page.length} 個、Worker ${summary.requests.worker.length} 個）`);
    for (const url of summary.requests.worker) log(`  Worker 請求：${url}`);
    Object.assign(document.body.dataset, {
      state: summary.error || summary.failed > 0 ? 'error' : 'done',
      backend: summary.backend ?? '',
      sameOrigin: String(summary.requests.sameOrigin),
      summary: JSON.stringify(summary),
    });
    running = false;
  }
}

const backendParam = params.get('backend');
const initial = backendParam === 'webgpu' || backendParam === 'wasm' ? backendParam : undefined;
(document.getElementById('use-three') as HTMLInputElement).checked = params.get('three') === '1';
document.getElementById('auto')!.addEventListener('click', () => void runAll());
document.getElementById('webgpu')!.addEventListener('click', () => void runAll('webgpu'));
document.getElementById('wasm')!.addEventListener('click', () => void runAll('wasm'));
if (params.get('auto') !== '0') void runAll(initial);
