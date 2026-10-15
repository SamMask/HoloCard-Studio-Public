// 舞台主題「魔法陣」（T-415，DESIGN §5「舞台」）的尺寸、位置與「每影格怎麼動」：純數學，不 import three.js（方便在 node 測試）。
//
// 卡片下方地面一個發光的魔法陣（平放在地上，從鏡頭看是扁扁的橢圓）：
//   - 多層同心細環（青藍與淡金）；
//   - 兩個星形多邊形：七芒星 {7/2}（邊剛好貼著內側那圈環）與裡面更尖的 {7/3}，頂點有小光點；
//   - 一圈原創抽象符紋：每格由菱形、小圓、點、短弧、短橫線拼成（由格子編號的亂數決定），不是任何文字或字母，
//     也不照任何既有作品的魔法陣；格與格之間一個小點；
//   - 外圈一圈細點、幾顆淡金菱形標記；
//   - 內圈（星形、內側的環）和外圈（符紋帶、細點、菱形、外側的環）反方向慢轉；
//   - 少量光點從陣上往上飄（一個 Sprite、instancing）。
// 拖曳反應：轉速 → 能量（stage-motion.ts 同一套）：轉卡越快轉越快、越亮；停手慢慢恢復。減少動態效果時靜止、光點不畫。
//
// 座標：卡寬＝1；魔法陣整組的原點＝陣的中心（在卡片下緣再往下 MAGIC_GAP），+y 上、+z 朝鏡頭。
// 大小：預設縮放下最外圈的最前緣還在預覽區裡（測試卡住），陣的後半圈在卡片下緣後面（被卡片蓋住）。


const TAU = Math.PI * 2;

/** 陣面在卡片下緣再往下多少（卡寬）：比全息光環（0.1）貼近一點，陣才能畫大（最前緣還在預覽區裡）。 */
export const MAGIC_GAP = 0.07;

/** 陣的中心（地面）的高度：卡片中心是 0。 */
export function magicY(cardH: number): number {
  return -(cardH / 2 + MAGIC_GAP);
}

export type MagicTint = 'cyan' | 'gold';
/** 跟著哪一圈轉：inner＝內圈、outer＝外圈（兩圈反方向）。 */
export type MagicGroup = 'inner' | 'outer';

/** 一圈細環：半徑、線的半寬（卡寬）、顏色、跟著哪一圈轉、沿圓周分成幾段明暗（整數；轉起來看得出在轉）。 */
export interface MagicRing {
  radius: number;
  width: number;
  tint: MagicTint;
  group: MagicGroup;
  segments: number;
}

/** 由內到外。最外圈 0.95：預設縮放下最前緣（連菱形）還在預覽區裡（見 magic 測試）。 */
export const MAGIC_RINGS: readonly MagicRing[] = [
  { radius: 0.125, width: 0.0035, tint: 'gold', group: 'inner', segments: 0 },
  { radius: 0.34, width: 0.004, tint: 'cyan', group: 'inner', segments: 7 },
  { radius: 0.54, width: 0.005, tint: 'gold', group: 'inner', segments: 0 },
  { radius: 0.655, width: 0.004, tint: 'cyan', group: 'outer', segments: 0 },
  { radius: 0.835, width: 0.004, tint: 'cyan', group: 'outer', segments: 5 },
  { radius: 0.95, width: 0.0055, tint: 'gold', group: 'outer', segments: 0 },
];

/** 星形多邊形 {points/skip}：頂點在半徑 radius 的圓上；phase＝第一個頂點的角度（弧度）。 */
export interface MagicStar {
  points: number;
  skip: number;
  radius: number;
  width: number;
  tint: MagicTint;
  group: MagicGroup;
  phase: number;
}

export const MAGIC_STARS: readonly MagicStar[] = [
  { points: 7, skip: 2, radius: 0.54, width: 0.004, tint: 'cyan', group: 'inner', phase: 0 },
  { points: 7, skip: 3, radius: 0.34, width: 0.0035, tint: 'gold', group: 'inner', phase: Math.PI / 7 },
];

/** 星形的邊離中心多遠（每條邊都一樣）：R × cos(π × skip ÷ points)。 */
export function starEdgeDistance(star: MagicStar): number {
  return star.radius * Math.cos((Math.PI * star.skip) / star.points);
}

/** 星形每條邊的法線方向（弧度）：頂點 j 與 j＋skip 連線的垂直平分線方向。 */
export function starEdgeAngles(star: MagicStar): number[] {
  return Array.from({ length: star.points }, (_, j) => star.phase + (TAU * (j + star.skip / 2)) / star.points);
}

/** 符紋帶：夾在兩圈環之間，分成 cells 格（整數，繞一圈接得起來），每格一個符紋。 */
export const GLYPH_BAND = { inner: 0.655, outer: 0.835, cells: 24 } as const;
/** 符紋的線半寬（卡寬）。 */
export const GLYPH_LINE = 0.0032;
/** 一個符紋（相對格子中心）最多伸到多遠：沿圓周 GLYPH_EXTENT.along、沿半徑 GLYPH_EXTENT.across（卡寬）。 */
export const GLYPH_EXTENT = { along: 0.07, across: 0.055 } as const;

export function glyphBandCenter(): number {
  return (GLYPH_BAND.inner + GLYPH_BAND.outer) / 2;
}

/** 一格沿圓周多長（卡寬，在符紋帶中線上量）。 */
export function glyphCellLength(): number {
  return (TAU * glyphBandCenter()) / GLYPH_BAND.cells;
}

/** 外圈細點：半徑、幾顆（整數）、點的半徑（卡寬）。 */
export const MAGIC_DOTS = { radius: 0.893, count: 60, size: 0.006 } as const;
/** 淡金菱形標記：在最外圈上、幾顆、半對角線（沿圓周、沿半徑）。 */
export const MAGIC_DIAMONDS = { radius: 0.95, count: 8, along: 0.032, across: 0.036 } as const;

/** 平常的轉速（弧度／秒）：內圈 50 秒一圈、外圈反方向 80 秒一圈；能量 1 時 1＋MAGIC_SPIN_BOOST 倍。 */
export const MAGIC_SPIN = { inner: TAU / 50, outer: -TAU / 80 } as const;
export const MAGIC_SPIN_BOOST = 3;

/** 亮度：慢慢呼吸（週期 MAGIC_BREATH 秒，MAGIC_BREATH_MIN～1）× 拖曳反應（能量 1 時 1＋MAGIC_GLOW_BOOST 倍）；減少動態效果時固定 MAGIC_STILL。 */
export const MAGIC_BREATH = 6.5;
export const MAGIC_BREATH_MIN = 0.72;
export const MAGIC_GLOW_BOOST = 0.75;
export const MAGIC_STILL = 0.86;

/** 往上飄的光點：顆數、出生的半徑範圍（卡寬）、往上飄多高、一生幾秒、大小（卡寬）。 */
export const MOTE_COUNT = 26;
export const MOTE_RADIUS = [0.45, 1.0] as const;
export const MOTE_RISE = 1.35;
export const MOTE_LIFE = [5, 9] as const;
export const MOTE_SIZE = [0.012, 0.024] as const;

export interface MagicMotion {
  /** 內圈、外圈目前的轉角（弧度，0～2π）。 */
  inner: number;
  outer: number;
  /** 目前的亮度倍數。 */
  glow: number;
}

export function initialMagicMotion(): MagicMotion {
  return { inner: 0, outer: 0, glow: MAGIC_STILL };
}

function wrapAngle(a: number): number {
  const w = a % TAU;
  return w < 0 ? w + TAU : w;
}

/** 呼吸亮度（MAGIC_BREATH_MIN～1）。 */
export function magicBreath(time: number): number {
  const wave = 0.5 + 0.5 * Math.sin((TAU * time) / MAGIC_BREATH);
  return MAGIC_BREATH_MIN + (1 - MAGIC_BREATH_MIN) * wave;
}

/**
 * 走一格（改 m 本身）：time＝舞台時間（stage-motion 的，減少動態效果時停住）、energy＝拖曳反應 0～1、dt＝這一格秒數。
 * 減少動態效果：不轉、亮度固定。
 */
export function stepMagic(m: MagicMotion, time: number, energy: number, dt: number, reduced: boolean): void {
  if (reduced) {
    m.glow = MAGIC_STILL;
    return;
  }
  if (dt > 0) {
    const up = 1 + MAGIC_SPIN_BOOST * energy;
    m.inner = wrapAngle(m.inner + MAGIC_SPIN.inner * up * dt);
    m.outer = wrapAngle(m.outer + MAGIC_SPIN.outer * up * dt);
  }
  m.glow = magicBreath(time) * (1 + MAGIC_GLOW_BOOST * energy);
}
