// 破框層（T-411，SCHEMA §1 Layer.breakout）的純數學（不 import three.js，方便在 node 測試）：
// 圖的 alpha 遮罩與內容範圍、卡外那一圈網格要多大、鏡頭取景要多留多少、側面接近 90° 時淡出、卡外的顏色怎麼疊。
//
// 做法（card-mesh）：卡片範圍內照舊在卡面網格的 shader 裡合成（破框層在卡框處再疊到卡框上面）；
// 卡片範圍外是另一片「中間挖掉卡片輪廓」的網格（和卡面同一個輪廓頂點，MSAA 邊緣剛好互補、不會有縫），
// 只畫破框層自己、同一個位移公式，所以卡內卡外在任何角度都接得上。
// 座標：卡面座標＝卡寬單位、卡片中心為 0、看著那一面 +x 右 +y 上；圖片 uv＝u 往右、v 往下（0～1，圖的左上角是 0,0）。

import type { BlendMode } from '../model/types';
import type { RoundedRect } from './fit';

/** depth 100 的層浮多高（卡寬單位）：同 interact/parallax 的 MAX_PARALLAX（render 不 import interact；測試核對兩邊一樣）。 */
export const LAYER_LIFT = 0.15;
/** 視差位移最多是浮起高度的幾倍（parallax：視線夾角超過 60° 後分母固定在 cos 60° ＝ 0.5）。 */
export const MAX_OFFSET_RATIO = 2;
/** alpha 大於這個值才算有東西（和美術流程「alpha ≤ 8 清零」同一條線）。 */
export const CONTENT_ALPHA = 8;
/**
 * 點選卡外的破框層：卡外實際畫出來的 alpha（outsideAlphaAt × 側面淡出，0～255 的刻度）大於這個值才算點到
 * （半透明的光暈、發光層的黑底、加深層的白底都不算，點空白處照樣是取消選取）。
 */
export const HIT_ALPHA = 64;
/** alpha 遮罩（內容範圍、點選用）先把圖縮到長邊這麼大。 */
export const MASK_EDGE = 256;
/** 卡外網格的外框對齊到這個格子（卡寬單位）：拖曳時不用每格重建網格。 */
export const RING_GRID = 0.25;
/**
 * 側面淡出：卡外的部分在「這一面朝鏡頭的程度」（holo.ts 的 viewDirection 的 z，＝cos 視線夾角）
 * 低於 to 開始變淡、低於 from 完全不畫——接近 90° 時那一片會變成細細一條薄片，不畫才不奇怪、不閃。
 */
export const BREAKOUT_FADE = { from: 0.12, to: 0.3 } as const;

/** 圖縮小後的像素（由上到下）：alpha 每像素一個位元組；rgba＝原本的 RGBA（直通 alpha、sRGB 位元組），點選換算混合模式用。 */
export interface AlphaMask {
  width: number;
  height: number;
  alpha: Uint8Array;
  rgba: ArrayLike<number>;
}

/** 圖片 uv 的範圍（u 往右、v 往下，0～1）。 */
export interface UvBox {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** 卡面座標的方框（+y 上）。 */
export interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** 整張圖。 */
export const FULL_UV: Readonly<UvBox> = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

/** RGBA 陣列 → 遮罩（alpha 另外拿出來；RGBA 留著給 outsideAlphaAt）。 */
export function alphaMaskFromRgba(rgba: ArrayLike<number>, width: number, height: number): AlphaMask {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
  return { width, height, alpha, rgba };
}

/**
 * 遮罩裡 alpha > CONTENT_ALPHA 的外框（圖片 uv），四邊各多留一格（縮圖時細的東西可能被平均掉一點）；
 * 整張透明回 null。
 */
export function maskContent(mask: AlphaMask): UvBox | null {
  const { width, height, alpha } = mask;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x]! > CONTENT_ALPHA) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return {
    u0: Math.max(0, (x0 - 1) / width),
    v0: Math.max(0, (y0 - 1) / height),
    u1: Math.min(1, (x1 + 2) / width),
    v1: Math.min(1, (y1 + 2) / height),
  };
}

/** 圖片 uv 那一點的 alpha（0～255，最近的一格）；圖外面＝0。 */
export function maskAlphaAt(mask: AlphaMask, u: number, v: number): number {
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return 0;
  const x = Math.min(mask.width - 1, Math.floor(u * mask.width));
  const y = Math.min(mask.height - 1, Math.floor(v * mask.height));
  return mask.alpha[y * mask.width + x]!;
}

/**
 * 卡外那一點實際畫出來的 alpha（0～1）：圖的顏色與 alpha 照 outsideLook 換算混合模式，再乘不透明度（省略＝100）；圖外＝0。
 * 和卡外網格的 shader 同一個算式（不含側面淡出，呼叫端另外乘 breakoutFade）。
 */
export function outsideAlphaAt(mask: AlphaMask, u: number, v: number, mode: BlendMode, opacity: number | undefined): number {
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return 0;
  const x = Math.min(mask.width - 1, Math.floor(u * mask.width));
  const y = Math.min(mask.height - 1, Math.floor(v * mask.height));
  const i = (y * mask.width + x) * 4;
  const o = opacity === undefined || !Number.isFinite(opacity) ? 1 : Math.min(1, Math.max(0, opacity / 100));
  const c = { r: mask.rgba[i]! / 255, g: mask.rgba[i + 1]! / 255, b: mask.rgba[i + 2]! / 255 };
  return outsideLook(mode, c, (mask.rgba[i + 3]! / 255) * o).alpha;
}

/** 卡面上的點 → 圖層的圖片 uv（center＝圖層中心＋目前的位移；size＝render 的 layerSize）。和 shader 的取樣一致。 */
export function layerUv(px: number, py: number, center: { x: number; y: number }, size: { w: number; h: number }): { u: number; v: number } {
  return { u: (px - center.x) / size.w + 0.5, v: 0.5 - (py - center.y) / size.h };
}

/** 圖層的內容範圍在卡面上的方框。 */
export function contentBox(center: { x: number; y: number }, size: { w: number; h: number }, uv: UvBox): Box {
  return {
    left: center.x + (uv.u0 - 0.5) * size.w,
    right: center.x + (uv.u1 - 0.5) * size.w,
    top: center.y - (uv.v0 - 0.5) * size.h,
    bottom: center.y - (uv.v1 - 0.5) * size.h,
  };
}

export function expandBox(b: Box, m: number): Box {
  return { left: b.left - m, right: b.right + m, bottom: b.bottom - m, top: b.top + m };
}

/** 這個深度的層，視差位移最多多遠（卡寬單位）。 */
export function maxOffset(depth: number): number {
  const d = Number.isFinite(depth) ? Math.min(100, Math.max(0, depth)) : 0;
  return (d / 100) * LAYER_LIFT * MAX_OFFSET_RATIO;
}

/** 這個深度的層浮多高（卡寬單位）：轉動時在畫面上看起來最多偏這麼多。 */
export function layerLift(depth: number): number {
  return maxOffset(depth) / MAX_OFFSET_RATIO;
}

/**
 * 卡外網格的外框：卡片輪廓（多留一格）和每個破框層「內容範圍＋最大位移」的聯集，四邊往外對齊到 RING_GRID。
 * boxes 是位移 0 時的內容範圍、已經各自加上最大位移（expandBox(box, maxOffset(depth))）。
 */
export function ringBounds(outline: RoundedRect, boxes: readonly Box[]): Box {
  let left = -outline.halfW - RING_GRID;
  let right = outline.halfW + RING_GRID;
  let bottom = -outline.halfH - RING_GRID;
  let top = outline.halfH + RING_GRID;
  for (const b of boxes) {
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
    bottom = Math.min(bottom, b.bottom);
    top = Math.max(top, b.top);
  }
  const down = (v: number) => Math.floor(v / RING_GRID) * RING_GRID;
  const up = (v: number) => Math.ceil(v / RING_GRID) * RING_GRID;
  return { left: down(left), right: up(right), bottom: down(bottom), top: up(top) };
}

/**
 * 鏡頭取景要放得下的範圍（以卡片中心為準的半寬、半高，卡寬單位）：每個破框層「內容範圍＋浮起高度」
 * （轉動時在畫面上最多偏浮起高度那麼多）離中心最遠到哪。沒有破框層回 null。
 */
export function framingReach(boxes: readonly Box[]): { x: number; y: number } | null {
  if (boxes.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const b of boxes) {
    x = Math.max(x, Math.abs(b.left), Math.abs(b.right));
    y = Math.max(y, Math.abs(b.top), Math.abs(b.bottom));
  }
  return { x, y };
}

/** 卡外部分的淡出（0～1）：viewZ＝這一面朝鏡頭的程度（viewDirection 的 z）。和 shader 的 smoothstep 一樣。 */
export function breakoutFade(viewZ: number): number {
  const { from, to } = BREAKOUT_FADE;
  const t = Math.min(1, Math.max(0, (viewZ - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

type Rgb = { r: number; g: number; b: number };

/**
 * 卡片範圍外沒有「後面的顏色」可以混：把這一層換成「一般的半透明疊法」的顏色與 alpha（sRGB 數值 0～1），疊在舞台上
 * 看起來接近原本的模式——發光／強光：黑色變透明（alpha＝最亮的通道；灰色時和濾色完全一樣）；
 * 加深：白色變透明（alpha＝1 − 最暗的通道；灰色時和色彩增值完全一樣）；其他模式照一般疊。
 */
export function outsideLook(mode: BlendMode, c: Rgb, alpha: number): { color: Rgb; alpha: number } {
  if (mode === 'screen' || mode === 'add') {
    const m = Math.max(c.r, c.g, c.b);
    const k = 1 / Math.max(m, 1e-4);
    return { color: { r: c.r * k, g: c.g * k, b: c.b * k }, alpha: alpha * m };
  }
  if (mode === 'multiply') {
    const n = 1 - Math.min(c.r, c.g, c.b);
    const k = 1 / Math.max(n, 1e-4);
    return { color: { r: (c.r - (1 - n)) * k, g: (c.g - (1 - n)) * k, b: (c.b - (1 - n)) * k }, alpha: alpha * n };
  }
  return { color: c, alpha };
}
