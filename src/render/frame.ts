// 卡框金屬質感的純數學（T-303）：常數、框色 → 高光色、斜面亮度、內緣暗線、隨視角流動的高光、整個卡框某一點的顏色。
// 不 import three.js（方便在 node 測）；著色程式在 frame-nodes.ts，算式和這裡一一對應（改一邊要改另一邊）。
//
// 想像卡框是一條圓弧斷面的金屬條：
// - 斜面：中間（稜線）亮、靠內外兩邊稍暗；光從左上來（同景深陰影 shadow.ts），朝光那段框的外半邊再亮一點、背光的相反。
// - 內緣暗線：框和圖之間一條細細的暗線，把框和圖分開。
// - 流動高光：一條斜的亮帶（窄的亮核心＋淡光暈）掃過卡面、只在框上看得到；位置隨觀看方向移動，轉卡時沿框滑過。
//   高光色＝框色往白偏（黑框 → 淡灰、金框 → 淡金白），最亮也只蓋過底色 highlightMax，框不會整個洗白。
//   同一條亮帶也決定框的整體明暗（環境明暗 env）：離亮帶越遠越暗，轉動時明暗跟著流動。
// - 拉絲紋：沿框方向的細紋（亮度很淡地起伏；雜訊在 shader 裡算，這裡只收它的 −1～1 值）。
// 金屬質感是框本身的，和鐳射無關（反光層「卡框也反光」時，鐳射再疊在這個顏色上；不反光時疊霧光）。
// 光澤（T-310，frame.shine 0～100 → 倍數 shine 0～2，50＝1＝上面這些原本的效果）：
// - 0～1：斜面、環境明暗、拉絲紋、內緣暗線的深淺與高光一起從「素色」（0：整圈就是框色）漸變到原本的效果。
// - 1～2：高光（亮帶、光暈、沿稜線的光澤）再加強到兩倍（更亮、更明顯），明暗起伏維持原本的；
//   高光最多仍只蓋過底色 highlightMax，所以不會洗白。
// 雕花邊角（T-416，frame.style 'ornate'）：四角疊一張灰階浮雕花紋（public/textures/frame-corner.webp，左上角一張、
// 程式鏡射成四角；素材 (0,0) 對齊卡片的角），蓋在卡框與圖層上面。灰階亮度 → 框色：主體中灰＝框色、凹縫往黑、
// 斜面亮邊往高光色；再加和卡框同一條亮帶（同一道光、同一個觀看方向）的流動高光，亮邊吃得多、主體少；
// 光澤 0 時浮雕明暗照舊（花紋的形狀）、沒有隨角度的高光與環境明暗。
// 顏色都是 0～1 的 sRGB 數值（同鐳射，在 sRGB 數值上算）；座標是卡面座標（卡寬單位、看著這一面 +x 右 +y 上，背面不鏡像）。

import { roundedRectSdf, type RoundedRect } from './fit';
import { SHADOW_DIRECTION } from './shadow';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 卡框金屬質感的參數（全部集中在這裡；shader 也讀這一份）。 */
export const FRAME_METAL = {
  /** 高光色＝框色往白偏幾成。 */
  highlightWhiten: 0.7,
  /** 高光最亮時蓋過底色幾成（< 1，框不會整個變成高光色）。 */
  highlightMax: 0.85,
  /** 斜面：內外兩邊比中間暗幾成。 */
  bevelDepth: 0.3,
  /** 斜面受光：朝光那段框的外半邊最多亮幾成（背光的暗幾成）。 */
  bevelLight: 0.1,
  /** 光的方向（卡面座標、從卡片往光）：左上，同景深陰影（影子往右下）。 */
  light: { x: -SHADOW_DIRECTION.x, y: -SHADOW_DIRECTION.y },
  /** 內緣暗線：寬（卡寬單位；至少一個像素、最多框寬的 innerLineMax）、壓暗幾成。 */
  innerLineWidth: 0.004,
  innerLineMax: 0.3,
  innerLineDark: 0.6,
  /**
   * 亮帶：法線方向（亮帶本身是「/」斜線）、觀看方向每變 1 亮帶移多遠、多遠重複一條、正面看時離卡片中心多遠（往左上）。
   * 重複間隔比卡片在法線方向的長度（約 1.6）短，所以任何角度框上都至少有一條、偶爾兩條。
   */
  sweepDir: { x: 0.8, y: -0.6 },
  sweepView: { x: 1.6, y: 0.9 },
  sweepPeriod: 1.4,
  sweepOffset: -0.62,
  /** 亮帶的窄核心（次方越大越窄）與淡光暈。 */
  glintSharpness: 90,
  haloSharpness: 6,
  haloGain: 0.3,
  /** 高光集中在稜線上：框的內外兩邊只剩幾成。 */
  glintEdge: 0.35,
  /** 環境明暗：離亮帶最遠處比亮帶旁暗幾成。 */
  envDepth: 0.25,
  /** 淡淡的光澤（沿稜線、靠近亮帶處；讓黑框也看得出是圓弧的金屬條）。 */
  sheen: 0.18,
  /** 拉絲紋：每卡寬幾條、底色亮度起伏幾成（高光處起伏兩倍）。 */
  brushFreq: 160,
  brushAmount: 0.04,
} as const;

const TAU = Math.PI * 2;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 光澤 0～100 → 金屬效果倍數 0～2（50＝1＝原本的效果）；超出夾回，不是有限數字當 50。 */
export function frameShineFactor(shine: number): number {
  return Number.isFinite(shine) ? Math.min(100, Math.max(0, shine)) / 50 : 1;
}

/** 高光色：框色（sRGB 0～1，超出夾回）往白偏 highlightWhiten。 */
export function frameHighlightColor(c: Rgb): Rgb {
  const w = FRAME_METAL.highlightWhiten;
  return { r: mix(clamp01(c.r), 1, w), g: mix(clamp01(c.g), 1, w), b: mix(clamp01(c.b), 1, w) };
}

/**
 * 斜面亮度（乘在框色上）。t：0＝內緣、1＝外緣（超出夾回）；facing：這段框朝外的方向和光的方向的內積（−1～1）。
 * 中間＝1、兩邊暗 bevelDepth；朝光那段外半邊亮、內半邊暗（背光相反），最多 bevelLight。
 */
export function frameBevel(t: number, facing: number): number {
  const s = 2 * clamp01(t) - 1;
  return 1 - FRAME_METAL.bevelDepth * s * s + FRAME_METAL.bevelLight * facing * s;
}

/** 內緣暗線（乘數）。d：到內緣的距離；width：這裡的框寬；pixel：一個像素多寬（都是卡寬單位）。 */
export function frameInnerLine(d: number, width: number, pixel: number): number {
  const px = Math.max(pixel, 1e-6);
  const line = Math.min(Math.max(FRAME_METAL.innerLineWidth, px), width * FRAME_METAL.innerLineMax);
  return 1 - FRAME_METAL.innerLineDark * (1 - smoothstep(line, line + px, d));
}

/**
 * 卡面上 (x, y) 被亮帶照到多少。vx、vy：觀看方向（holo.ts 的 viewDirection，那一面自己的座標）。
 * glint：窄核心＋淡光暈（0～1）；env：環境明暗（亮帶上 1、離最遠 0）。
 */
export function frameGlare(x: number, y: number, vx: number, vy: number): { glint: number; env: number } {
  const m = FRAME_METAL;
  const u = x * m.sweepDir.x + y * m.sweepDir.y + vx * m.sweepView.x + vy * m.sweepView.y - m.sweepOffset;
  const c = Math.cos((u / m.sweepPeriod) * TAU);
  const pos = Math.max(c, 0);
  return {
    glint: Math.min(1, pos ** m.glintSharpness + m.haloGain * pos ** m.haloSharpness),
    env: 0.5 + 0.5 * c,
  };
}

/** 卡面上一點相對卡框的位置（shader 同算式）。 */
export interface FramePoint {
  x: number;
  y: number;
  /** 到內緣的帶號距離（框上 ≥ 0、圖上 < 0）。 */
  d: number;
  /** 這裡的框寬（到內緣＋到外緣；直邊上＝設定的寬）。 */
  width: number;
  /** 0＝內緣、1＝外緣。 */
  t: number;
  /** 框在這裡朝外的方向（內緣距離的梯度）和光的方向的內積，−1～1。 */
  facing: number;
}

export function framePoint(x: number, y: number, outline: RoundedRect, inner: RoundedRect): FramePoint {
  const d = roundedRectSdf(x, y, inner);
  const width = Math.max(d - roundedRectSdf(x, y, outline), 1e-5);
  // 朝外方向＝sign(p) × normalize(max(|p| − (半寬 − 圓角), 0))（框上一定不是零向量；圖上不用）
  const qx = Math.max(Math.abs(x) - (inner.halfW - inner.r), 0);
  const qy = Math.max(Math.abs(y) - (inner.halfH - inner.r), 0);
  const len = Math.max(Math.hypot(qx, qy), 1e-6);
  const nx = (Math.sign(x) * qx) / len;
  const ny = (Math.sign(y) * qy) / len;
  return { x, y, d, width, t: clamp01(d / width), facing: nx * FRAME_METAL.light.x + ny * FRAME_METAL.light.y };
}

/**
 * 高光蓋過底色幾成（0～highlightMax）：亮帶集中在稜線上，加上沿稜線的淡光澤；brush：拉絲紋雜訊 −1～1；
 * shine：光澤倍數 0～2（frameShineFactor；0＝沒有高光、1＝原本、2＝兩倍）。
 */
export function frameHighlightAmount(p: FramePoint, vx: number, vy: number, brush = 0, shine = 1): number {
  const m = FRAME_METAL;
  const s = 2 * p.t - 1;
  const crest = 1 - s * s;
  const { glint, env } = frameGlare(p.x, p.y, vx, vy);
  const raw = (glint * mix(m.glintEdge, 1, crest) + m.sheen * env * env * crest) * (1 + 2 * m.brushAmount * brush);
  return m.highlightMax * clamp01(raw * shine);
}

/**
 * 卡框上一點的顏色（sRGB 0～1）。color：框色；pixel：一個像素多寬；brush：拉絲紋雜訊 −1～1；
 * shine：光澤倍數 0～2（0＝素色：整圈就是框色；1＝原本的效果；超過 1 只加強高光）。
 */
export function frameMetal(color: Rgb, p: FramePoint, vx: number, vy: number, pixel: number, brush = 0, shine = 1): Rgb {
  const m = FRAME_METAL;
  // 明暗起伏（斜面、環境、拉絲紋、內緣暗線）：relief 0＝沒有（乘 1）、1＝原本的（最多到原本的）
  const relief = clamp01(shine);
  const fade = (v: number) => v * relief + (1 - relief);
  const { env } = frameGlare(p.x, p.y, vx, vy);
  const shade = fade(frameBevel(p.t, p.facing) * (1 - m.envDepth * (1 - env)) * (1 + m.brushAmount * brush));
  const amount = frameHighlightAmount(p, vx, vy, brush, shine);
  const hl = frameHighlightColor(color);
  const line = fade(frameInnerLine(p.d, p.width, pixel));
  const ch = (c: number, h: number) => clamp01(mix(clamp01(c) * shade, h, amount) * line);
  return { r: ch(color.r, hl.r), g: ch(color.g, hl.g), b: ch(color.b, hl.b) };
}

// ---- 雕花邊角（T-416） ----

/** 雕花邊角的參數（shader 也讀這一份）。 */
export const FRAME_ORNATE = {
  /** 預設框寬（新卡的 0.03）時花紋的邊長（卡寬單位；正方形，塔羅牌一樣大）。 */
  size: 0.2,
  /** 框寬每多 0.01，邊長多 0.012（框寬 0.01～0.08 → 邊長約 0.256～0.34，只是微調）。 */
  sizePerWidth: 1.2,
  baseWidth: 0.03,
  /** 浮雕主體的灰（sRGB 數值，素材不透明處亮度的中位數約 0.47）：這個亮度＝框色。 */
  midGray: 0.47,
  /** 流動高光：主體（中灰以下）只吃到幾成，斜面亮邊（最亮）吃滿。 */
  glintBody: 0.35,
} as const;

/** 花紋的邊長（卡寬單位）：預設框寬時 0.2（使用者 2026-10-14 從 0.28 調小），框越粗略大；不超過半個卡寬／卡高（左右兩角不會疊在一起）。壞數字當預設框寬。 */
export function ornateSize(frameWidth: number, outline: Pick<RoundedRect, 'halfW' | 'halfH'>): number {
  const o = FRAME_ORNATE;
  const w = Number.isFinite(frameWidth) ? frameWidth : o.baseWidth;
  const s = o.size + o.sizePerWidth * (w - o.baseWidth);
  return Math.min(Math.max(s, 0.01), outline.halfW, outline.halfH);
}

/**
 * 卡面上 (x, y) 在花紋素材上的位置（四角鏡射，shader 同算式）：u＝離最近的左右邊多遠、v＝離最近的上下邊多遠，
 * 都除以花紋邊長；素材 (0,0)＝左上角（u 往右、v 往下）。兩個都在 0～1 才在花紋裡，不然回 null。
 * 貼圖的 v 是由下往上（同 three.js 圖片貼圖的 flipY），取樣用 (u, 1 − v)。
 */
export function ornateUv(x: number, y: number, outline: Pick<RoundedRect, 'halfW' | 'halfH'>, size: number): { u: number; v: number } | null {
  const u = (outline.halfW - Math.abs(x)) / size;
  const v = (outline.halfH - Math.abs(y)) / size;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
}

/** 亮邊程度 0～1：中灰以下 0、最亮 1。 */
function ornateRaise(lum: number): number {
  const m = FRAME_ORNATE.midGray;
  return clamp01((clamp01(lum) - m) / (1 - m));
}

/**
 * 花紋上一點的高光蓋過底色幾成（0～highlightMax）：卡框的亮帶（frameGlare，同一道光）＋沿亮帶的淡光澤，
 * 亮邊吃滿、主體只吃 glintBody；lum：素材灰階（sRGB 數值 0～1）；shine：光澤倍數 0～2（0＝沒有高光）。
 */
export function ornateHighlightAmount(lum: number, x: number, y: number, vx: number, vy: number, shine = 1): number {
  const m = FRAME_METAL;
  const raise = ornateRaise(lum);
  const { glint, env } = frameGlare(x, y, vx, vy);
  const raw = glint * mix(FRAME_ORNATE.glintBody, 1, raise) + m.sheen * env * env * raise;
  return m.highlightMax * clamp01(raw * shine);
}

/**
 * 花紋上一點的顏色（sRGB 0～1）。color：框色；lum：素材灰階（sRGB 數值，超出夾回）；vx、vy：觀看方向；
 * shine：光澤倍數 0～2。浮雕：中灰＝框色、0＝黑、1＝高光色（框色往白偏，同 frameHighlightColor）；
 * 環境明暗（離亮帶越遠越暗）乘 min(shine, 1)；再往高光色蓋 ornateHighlightAmount。
 */
export function ornateMetal(color: Rgb, lum: number, x: number, y: number, vx: number, vy: number, shine = 1): Rgb {
  const m = FRAME_METAL;
  const l = clamp01(lum);
  const low = Math.min(l / FRAME_ORNATE.midGray, 1);
  const raise = ornateRaise(l);
  const relief = clamp01(shine);
  const { env } = frameGlare(x, y, vx, vy);
  const shade = (1 - m.envDepth * (1 - env)) * relief + (1 - relief);
  const amount = ornateHighlightAmount(l, x, y, vx, vy, shine);
  const hl = frameHighlightColor(color);
  const ch = (c: number, h: number) => clamp01(mix(mix(clamp01(c) * low, h, raise) * shade, h, amount));
  return { r: ch(color.r, hl.r), g: ch(color.g, hl.g), b: ch(color.b, hl.b) };
}
