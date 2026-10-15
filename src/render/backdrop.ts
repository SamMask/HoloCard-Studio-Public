// 舞台背景圖（T-814，SCHEMA view.backdrop?、DESIGN §5「舞台背景圖」）的共用數學與 2D 鋪圖：
//   - coverRect：cover（保持長寬比、蓋滿、多的裁掉）要從原圖取哪一塊——匯出（PNG、影片、GIF 每一格）照匯出畫面的比例置中裁，
//     水鏡的遠景（water-fx.ts）下緣貼水平線、從上面裁；純函式，node 測試。
//   - farPanRect（T-822，SCHEMA view.farPan?、DESIGN §5「遠景位置」）：cover 再加上使用者調的位置與大小。
//     預覽區 CSS 那層（farPanCss，ui/stage.ts）、水鏡的遠景平面（water-fx.ts）、匯出合成（paintCover）三處共用這一個算法：
//       s0＝cover 的倍數 max(畫面寬／圖寬, 畫面高／圖高)，s＝s0 × zoom；取的那一塊 sw＝畫面寬／s、sh＝畫面高／s；
//       sx＝(圖寬 − sw) × (x＋1)／2、sy＝(圖高 − sh) × (y＋1)／2（水鏡：sy＝圖高 − sh，下緣貼水平線、y 不用）。
//     x、y 是「cover 之後多出來的部分」的比例，所以任何畫面寬高比、任何 zoom 都完全在原圖裡（不露空白、移到邊就停）；
//     {0,0,1}＝coverRect 一模一樣（沒有 farPan 的卡畫面不變）。
//   - paintCover：在 2D 畫布上整張鋪背景圖（匯出用，card-view.ts 的 captureCard／captureTurntable；照背景圖帶的 pan 裁）。
//   - 前景圖（T-830，SCHEMA view.foreground?、DESIGN §5「前景圖」）：foregroundRect 是預覽 CSS 那層（foregroundCss，ui/stage.ts）與
//     匯出合成（paintForeground，card-view.ts 在卡片之後畫）共用的算法，照 farPanRect 的想法用「畫面寬高的比例」擺，任何畫面比例都是同一個焦點：
//       圖的中心 cx＝畫面寬 × (1＋x)／2、cy＝畫面高 × (1－y)／2（y 往上是正的）；長邊＝畫面高 × FOREGROUND_BASE × scale（保持長寬比）；
//       模糊＝blur ÷ 100 × FOREGROUND_MAX_BLUR × 畫面高（像素；預覽用 CSS filter: blur()、匯出用 ctx.filter）。
//     轉卡時預覽那層往反方向微動（foregroundDrift，最多畫面寬 FOREGROUND_DRIFT %；減少動態時 main 不給）；匯出不動（照存的位置）。
// 預覽區的亮度與暗角：CSS 那層（ui/stage.ts、style.css）約 85% 亮度；水鏡的 3D 遠景用同樣的亮度（PREVIEW_DIM_LINEAR）。
// 匯出不壓暗（照原圖畫，DESIGN 只寫預覽要壓暗）。前景圖預覽、匯出都不壓暗。

import { DEFAULT_FOREGROUND, RANGE } from '../model/limits';
import type { FarPan, Foreground } from '../model/types';

/** 背景圖（已經解碼好的圖＋原圖寬高）：工坊預覽與匯出都用這個（main 從圖片登記簿拿 <img>）。 */
export interface BackdropImage {
  readonly image: HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /**
   * 遠景的位置與大小（T-822，卡片的 view.farPan）：匯出的「畫上背景」照它裁（paintCover）；省略＝置中蓋滿（和 T-814 一樣）。
   * 預覽不看這個（card-view 的 setBackdrop 只拿圖建貼圖；水鏡的位置走 setFarPan、CSS 那層走 farPanCss）。
   */
  readonly pan?: FarPan;
}

/** 從原圖取的一塊（像素，左上角為原點）。 */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** 遠景怎麼對齊：'center' 預覽 CSS 那層與匯出（x、y 都用）；'bottom' 水鏡（下緣貼水平線、y 不用、放大以下緣為基準）。 */
export type FarAnchor = 'center' | 'bottom';

/** 預覽區的背景圖亮度（DESIGN：約 85%，CSS 的 brightness(0.85)）。 */
export const PREVIEW_DIM = 0.85;
/** 同一個亮度換到線性空間（3D 著色程式在線性空間算：sRGB 值 × 0.85 ≈ 線性值 × 0.85^2.2）。 */
export const PREVIEW_DIM_LINEAR = Math.pow(PREVIEW_DIM, 2.2);

const valid = (n: number) => Number.isFinite(n) && n > 0;

/** 有限數字夾範圍（model/limits 的 RANGE.farPan、RANGE.farZoom；render 自己再夾一次，壞資料也不露空白），不然用 fallback。 */
function fit(v: number | undefined, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** 位置 −1～1 → 多出來的部分的比例 0～1（0＝置中＝0.5）。 */
function panFraction(v: number | undefined): number {
  return (fit(v, RANGE.farPan.min, RANGE.farPan.max, 0) + 1) / 2;
}

function panZoom(pan: FarPan | undefined): number {
  return fit(pan?.zoom, RANGE.farZoom.min, RANGE.farZoom.max, 1);
}

/**
 * cover：原圖 srcW×srcH 保持長寬比、蓋滿 dstW×dstH，多的裁掉；回要取原圖的哪一塊（畫到整個目的地）。
 * 左右一律置中；上下照 alignY（0＝貼上緣、0.5＝置中、1＝貼下緣，只在原圖比目的地「高」時有差）。
 * 任何一個尺寸不合理（≤ 0、NaN、無限大）→ 整張原圖（不裁）。
 */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number, alignY = 0.5): SourceRect {
  if (!valid(srcW) || !valid(srcH) || !valid(dstW) || !valid(dstH)) return { sx: 0, sy: 0, sw: valid(srcW) ? srcW : 0, sh: valid(srcH) ? srcH : 0 };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = Math.min(srcW, dstW / scale);
  const sh = Math.min(srcH, dstH / scale);
  const a = Number.isFinite(alignY) ? Math.min(1, Math.max(0, alignY)) : 0.5;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) * a, sw, sh };
}

/**
 * 遠景的位置與大小（T-822）→ 從原圖取哪一塊（畫滿整個 dstW×dstH）。算法見檔頭；pan 省略＝{0,0,1}；
 * 超出範圍的值夾回來、NaN 與無限大當預設值；尺寸不合理同 coverRect（整張原圖）。
 * {0,0,1} 的結果和 coverRect（置中）／coverRect(…, 1)（bottom）逐位元相同。
 */
export function farPanRect(srcW: number, srcH: number, dstW: number, dstH: number, pan: FarPan | undefined, anchor: FarAnchor = 'center'): SourceRect {
  if (!valid(srcW) || !valid(srcH) || !valid(dstW) || !valid(dstH)) return coverRect(srcW, srcH, dstW, dstH);
  const scale = Math.max(dstW / srcW, dstH / srcH) * panZoom(pan);
  const sw = Math.min(srcW, dstW / scale);
  const sh = Math.min(srcH, dstH / scale);
  const sx = (srcW - sw) * panFraction(pan?.x);
  const sy = anchor === 'bottom' ? srcH - sh : (srcH - sh) * panFraction(pan?.y);
  return { sx, sy, sw, sh };
}

/** 百分比字串（最多 4 位小數，不出現 1e-7 這種寫法）。 */
function percent(fraction: number): string {
  return `${Math.round(fraction * 1e6) / 1e4}%`;
}

/**
 * 預覽區 CSS 那層的擺法（T-822）：<img> 鋪滿預覽區、object-fit: cover，再
 *   object-position: position；transform: scale(scale)；transform-origin: position。
 * cover＋object-position p% 讓「多出來的部分」的 p 落在畫面左邊外面（＝farPanRect 的 sx），再以同一點為原點放大 zoom 倍：
 * 看得到的那一塊正好是 farPanRect（置中那種）——tests/render-far-pan.test.ts 照瀏覽器的算法逐一比對。
 */
export function farPanCss(pan: FarPan | undefined): { position: string; scale: string } {
  return { position: `${percent(panFraction(pan?.x))} ${percent(panFraction(pan?.y))}`, scale: String(panZoom(pan)) };
}

/** 匯出用：背景圖帶上這張卡的遠景位置（沒有位置或 {0,0,1}＝回原本的物件，和 T-814 一模一樣）。 */
export function withFarPan(backdrop: BackdropImage, pan: FarPan | undefined): BackdropImage {
  if (!pan || (pan.x === 0 && pan.y === 0 && pan.zoom === 1)) return backdrop;
  return { ...backdrop, pan };
}

/** 在 2D 畫布上整張鋪背景圖（cover，照畫布的比例與背景圖帶的位置 pan 裁；沒有 pan＝置中）。不壓暗。 */
export function paintCover(ctx: Pick<CanvasRenderingContext2D, 'drawImage'>, backdrop: BackdropImage, width: number, height: number): void {
  const r = farPanRect(backdrop.width, backdrop.height, width, height, backdrop.pan);
  ctx.drawImage(backdrop.image, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height);
}

// ---- 前景圖（T-830）----

/** 前景圖的位置、大小、模糊（卡片 view.foreground 去掉 image）。 */
export type ForegroundPlace = Omit<Foreground, 'image'>;

/** 前景圖（已經解碼好的圖＋原圖寬高＋這張卡的位置）：匯出的「畫上背景」用（main 從圖片登記簿拿 <img>）。 */
export interface ForegroundImage {
  readonly image: HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly place: ForegroundPlace;
}

/** 前景圖大小 1 時，圖的長邊是畫面高的幾倍。 */
export const FOREGROUND_BASE = 0.6;
/** 前景圖模糊 100 時的模糊半徑是畫面高的幾倍（40＝1.6%，預覽區高 700 px 約 11 px）。 */
export const FOREGROUND_MAX_BLUR = 0.04;
/** 轉卡時前景圖最多移動畫面寬的幾 %（DESIGN：約 2%）。 */
export const FOREGROUND_DRIFT = 2;

/** 照範圍夾好的位置、大小、模糊（壞值用 DEFAULT_FOREGROUND；render 自己再夾一次）。 */
function cleanPlace(p: ForegroundPlace): ForegroundPlace {
  const d = DEFAULT_FOREGROUND;
  return {
    x: fit(p.x, RANGE.foregroundPos.min, RANGE.foregroundPos.max, d.x),
    y: fit(p.y, RANGE.foregroundPos.min, RANGE.foregroundPos.max, d.y),
    scale: fit(p.scale, RANGE.foregroundScale.min, RANGE.foregroundScale.max, d.scale),
    blur: fit(p.blur, RANGE.foregroundBlur.min, RANGE.foregroundBlur.max, d.blur),
  };
}

/** 畫面上畫在哪裡（像素，左上角為原點；畫整張原圖）。 */
export interface DestRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * 前景圖畫在 dstW×dstH 畫面的哪裡（算法見檔頭）。超出範圍的值夾回來、NaN 與無限大用預設值；
 * 任何一個尺寸不合理（≤ 0、NaN、無限大）→ null（不畫）。
 */
export function foregroundRect(srcW: number, srcH: number, dstW: number, dstH: number, place: ForegroundPlace): DestRect | null {
  if (!valid(srcW) || !valid(srcH) || !valid(dstW) || !valid(dstH)) return null;
  const p = cleanPlace(place);
  const k = (dstH * FOREGROUND_BASE * p.scale) / Math.max(srcW, srcH);
  const dw = srcW * k;
  const dh = srcH * k;
  return { dx: (dstW * (1 + p.x)) / 2 - dw / 2, dy: (dstH * (1 - p.y)) / 2 - dh / 2, dw, dh };
}

/** 前景圖的模糊半徑（像素）：blur ÷ 100 × FOREGROUND_MAX_BLUR × 畫面高。 */
export function foregroundBlurPx(place: ForegroundPlace, dstH: number): number {
  return (cleanPlace(place).blur / 100) * FOREGROUND_MAX_BLUR * dstH;
}

/** 數字字串（最多 4 位小數，不出現 1e-7 這種寫法；沒有 −0）。 */
function short(v: number): string {
  return String(Math.round(v * 1e4) / 1e4 + 0);
}

/**
 * 預覽區 CSS 那層的擺法（T-830）：<img> 是 size×size 的方框、object-fit: contain，中心在 (left, top)（translate −50%），
 * filter: blur(blur)。單位是預覽區（.stage-view，容器查詢）的 cqw／cqh，所以預覽區多大都不用重算——
 * 看到的圖正好是 foregroundRect、模糊正好是 foregroundBlurPx（tests/render-foreground.test.ts 照瀏覽器的算法比對）。
 */
export function foregroundCss(place: ForegroundPlace): { left: string; top: string; size: string; blur: string } {
  const p = cleanPlace(place);
  return {
    left: `${short(((1 + p.x) / 2) * 100)}cqw`,
    top: `${short(((1 - p.y) / 2) * 100)}cqh`,
    size: `${short(FOREGROUND_BASE * p.scale * 100)}cqh`,
    blur: `${short((p.blur / 100) * FOREGROUND_MAX_BLUR * 100)}cqh`,
  };
}

/**
 * 轉卡時前景圖的微動（T-830，單位：畫面寬的 %＝cqw；y 往下是正的，同 CSS）：往卡片轉的反方向——往右拖（yaw 變大）往左移、
 * 往下拖（pitch 變大）往上移；x＝−FOREGROUND_DRIFT × sin(yaw)、y＝−FOREGROUND_DRIFT × sin(pitch)，最多 2%、轉一整圈回到原位。
 * 壞值＝不動。
 */
export function foregroundDrift(yawDeg: number, pitchDeg: number): { x: number; y: number } {
  const at = (deg: number) => (Number.isFinite(deg) ? -FOREGROUND_DRIFT * Math.sin((deg * Math.PI) / 180) + 0 : 0);
  return { x: at(yawDeg), y: at(pitchDeg) };
}

/**
 * 在 2D 畫布上畫前景圖（匯出的「畫上背景」，卡片之後畫）：照 foregroundRect 擺、ctx.filter 模糊（模糊 0 不設），畫完 filter 還原。
 * 尺寸不合理不畫。不壓暗。
 */
export function paintForeground(ctx: Pick<CanvasRenderingContext2D, 'drawImage' | 'filter'>, fg: ForegroundImage, width: number, height: number): void {
  const r = foregroundRect(fg.width, fg.height, width, height, fg.place);
  if (!r) return;
  const blur = foregroundBlurPx(fg.place, height);
  const before = ctx.filter;
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  try {
    ctx.drawImage(fg.image, r.dx, r.dy, r.dw, r.dh);
  } finally {
    ctx.filter = before;
  }
}
