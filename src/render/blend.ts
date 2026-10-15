// 圖層混合模式的純數學（T-408，SCHEMA §1「混合模式」）：公式照 W3C Compositing and Blending Level 1
// （和 Photoshop 一致），在 sRGB 數值（0～1）上算。不 import three.js（方便在 node 測）；
// 著色程式在 blend-nodes.ts，算式一一對應（改一邊要改另一邊）。
//
// 合成：Cb＝這一層後面已經合成好的顏色、Cs＝這一層的顏色、αs＝這一層的 alpha × opacity/100；
// 正常模式：結果＝(1 − αs)·Cb＋αs·Cs（在 sRGB 數值上混，半透明邊緣和 Photoshop、瀏覽器一樣）。
// 其他模式（T-413）：結果＝(1 − αs)·Cb＋αs·(B(夾(Cb), Cs)＋k·(Cb − 夾(Cb)))，夾＝夾在 0～1；
// k＝超出 1 的部分透過來多少（每個通道）：加深 k＝夾(Cs)、發光 k＝1 − 夾(Cs)、其他模式 k＝1。
// Cb 在 0～1 時沒有超出的部分，就是 (1 − αs)·Cb＋αs·B(Cb, Cs)。鐳射的光帶、閃星會讓 Cb 超過 1，B 只定義在 0～1，
// 所以 B 用夾過的 Cb 算、超出的部分照 k 加回：
// - 中性色（加深＋白、發光／強光＋黑、疊色／柔光＋50% 灰）的 B(夾(Cb), Cs)＝夾(Cb)、k＝1，結果＝Cb，完全不改變後面
//   （以前先夾再混，會把後面超過 1 的亮光截掉，之後的半透明層或影子會讓圖片的方框露出來）；
// - 加深＝Cb·Cs、發光＝Cb＋Cs − Cb·Cs 直接用沒夾的 Cb 算的結果：純黑的墨擋住亮光（0）、純白的發光是 1，不會更亮。

import type { BlendMode, Layer } from '../model/types';
import type { Rgb } from './frame';

/** 非分離式模式（color）的亮度係數（W3C）。 */
export const LUM_WEIGHTS = { r: 0.3, g: 0.59, b: 0.11 } as const;
/** ClipColor 的分母下限：避免除以 0（shader 同一個值）。 */
export const CLIP_EPSILON = 1e-6;

const sat = (v: number): number => Math.min(1, Math.max(0, v));
const satRgb = (c: Rgb): Rgb => ({ r: sat(c.r), g: sat(c.g), b: sat(c.b) });
const map = (c: Rgb, f: (v: number) => number): Rgb => ({ r: f(c.r), g: f(c.g), b: f(c.b) });
const zip = (a: Rgb, b: Rgb, f: (x: number, y: number) => number): Rgb => ({ r: f(a.r, b.r), g: f(a.g, b.g), b: f(a.b, b.b) });

export function lum(c: Rgb): number {
  return LUM_WEIGHTS.r * c.r + LUM_WEIGHTS.g * c.g + LUM_WEIGHTS.b * c.b;
}

/**
 * W3C ClipColor：超出 0～1 的顏色往自己的亮度拉回（亮度不變）。
 * n、x 用原本的顏色算（照 W3C 的順序：先處理小於 0、再處理大於 1）。
 */
export function clipColor(c: Rgb): Rgb {
  const l = lum(c);
  const n = Math.min(c.r, c.g, c.b);
  const x = Math.max(c.r, c.g, c.b);
  let out = c;
  if (n < 0) out = map(out, (v) => l + ((v - l) * l) / Math.max(l - n, CLIP_EPSILON));
  if (x > 1) out = map(out, (v) => l + ((v - l) * (1 - l)) / Math.max(x - l, CLIP_EPSILON));
  return out;
}

/** W3C SetLum：把顏色的亮度換成 l（色相與飽和度盡量不變）。 */
export function setLum(c: Rgb, l: number): Rgb {
  const d = l - lum(c);
  return clipColor(map(c, (v) => v + d));
}

/** 疊色（overlay）＝hard-light(Cs, Cb)：Cb ≤ 0.5 → 2·Cb·Cs；否則 screen(Cs, 2·Cb − 1)。 */
function overlayChannel(cb: number, cs: number): number {
  if (cb <= 0.5) return 2 * cb * cs;
  const t = 2 * cb - 1;
  return cs + t - cs * t;
}

/** 柔光（soft-light，W3C）。 */
function softLightChannel(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

/**
 * B(Cb, Cs)：混合公式（sRGB 數值）。
 * 正常模式直接回 Cs；其他模式先把 Cb、Cs 夾在 0～1（鐳射的光帶與閃星可能讓顏色超過 1，公式只定義在 0～1；
 * Cb 超過 1 的部分由 compositeColor 另外保留）。
 */
export function blendColor(mode: BlendMode, cbIn: Rgb, csIn: Rgb): Rgb {
  if (mode === 'normal') return csIn;
  const cb = satRgb(cbIn);
  const cs = satRgb(csIn);
  switch (mode) {
    case 'multiply':
      return zip(cb, cs, (b, s) => b * s);
    case 'screen':
      return zip(cb, cs, (b, s) => b + s - b * s);
    case 'add':
      return zip(cb, cs, (b, s) => Math.min(1, b + s));
    case 'overlay':
      return zip(cb, cs, overlayChannel);
    case 'soft-light':
      return zip(cb, cs, softLightChannel);
    case 'color':
      return setLum(cs, lum(cb));
  }
}

/** 後面超出 0～1 的部分透過這一層多少（見檔頭的 k）：加深＝夾(Cs)、發光＝1 − 夾(Cs)、其他模式＝1。 */
export function excessPass(mode: BlendMode, cs: Rgb): Rgb {
  const c = satRgb(cs);
  if (mode === 'multiply') return c;
  if (mode === 'screen') return map(c, (v) => 1 - v);
  return { r: 1, g: 1, b: 1 };
}

/**
 * 合成一層（見檔頭）。alpha＝這一層的 alpha × opacity/100。
 * 正常：(1 − αs)·Cb＋αs·Cs；其他模式：(1 − αs)·Cb＋αs·(B(夾(Cb), Cs)＋k·(Cb − 夾(Cb)))。
 */
export function compositeColor(mode: BlendMode, cb: Rgb, cs: Rgb, alpha: number): Rgb {
  if (mode === 'normal') return zip(cb, cs, (x, y) => x + (y - x) * alpha);
  const clamped = satRgb(cb);
  const b = blendColor(mode, clamped, cs);
  const k = excessPass(mode, cs);
  const target: Rgb = {
    r: b.r + k.r * (cb.r - clamped.r),
    g: b.g + k.g * (cb.g - clamped.g),
    b: b.b + k.b * (cb.b - clamped.b),
  };
  return zip(cb, target, (x, y) => x + (y - x) * alpha);
}

/** Layer.opacity（0～100，省略＝100）→ shader 用的 0～1。超出範圍夾回、不是有限數字當 100，shader 永遠拿不到 NaN。 */
export function opacityFactor(opacity: number | undefined): number {
  if (opacity === undefined || !Number.isFinite(opacity)) return 1;
  return sat(opacity / 100);
}

/** 圖層的混合模式（省略＝normal）。 */
export function blendOf(layer: Pick<Layer, 'blend'>): BlendMode {
  return layer.blend ?? 'normal';
}

/**
 * 鐳射在這一層的多少（0～1，乘在鐳射效果上）：中性色疊上去本來就看不見，鐳射也不該出現，
 * 不然黑底光效、白底線稿整張圖的方框會在光帶掃過時露出來。
 * 發光／強光：黑色是中性色 → 取 Cs 最亮的通道；加深：白色是中性色 → 1 − 最暗的通道；其他模式 1（用 alpha 當遮罩，照舊）。
 */
export function blendHoloMask(mode: BlendMode, cs: Rgb): number {
  if (mode === 'screen' || mode === 'add') return sat(Math.max(cs.r, cs.g, cs.b));
  if (mode === 'multiply') return sat(1 - Math.min(cs.r, cs.g, cs.b));
  return 1;
}

/**
 * 這一層對「表面」的實際覆蓋率（0～1，還沒乘 alpha；T-417b）：疊上去之後，這一點最上面的表面有幾成換成這一層
 * （反光層的亮面／霧光比例跟著換，card-mesh 的 blendSurfaceNode 同算式）。中性色疊上去顏色不變，表面也不算換掉：
 * 加深＝1 − 最暗的通道（白色＝0）；發光／強光＝最亮的通道（黑色＝0）；疊色／柔光＝離 50% 灰最遠的通道 × 2（50% 灰＝0）；
 * 正常、換色＝1（換色沒有中性色：灰色也會把後面的顏色換掉）。
 */
export function surfaceWeight(mode: BlendMode, cs: Rgb): number {
  if (mode === 'overlay' || mode === 'soft-light') {
    const c = satRgb(cs);
    return sat(2 * Math.max(Math.abs(c.r - 0.5), Math.abs(c.g - 0.5), Math.abs(c.b - 0.5)));
  }
  return mode === 'normal' || mode === 'color' ? 1 : blendHoloMask(mode, cs);
}

// ---- 圖層貼圖的預乘 alpha（T-413）----
// 貼圖若是直通 alpha（RGB 與 alpha 分開內插），縮小、斜看、mipmap 取樣時透明像素的 RGB（通常是黑色）會混進邊緣變成暗邊。
// 所以上傳前先「在線性空間乘上 alpha、再編回 sRGB」，貼圖用 sRGB 格式：GPU 取樣時先解碼成線性再內插，
// 內插的是 (alpha × 線性顏色, alpha)——濾波仍在線性空間（和以前一樣，縮小時細節亮度不變），透明處乘 0 不會混進來；
// shader 除回 alpha 得到直通顏色（card-mesh）。不能在 sRGB 數值上預乘（瀏覽器上傳時的 premultiplyAlpha 就是這樣）：
// sRGB 格式的貼圖會把 alpha × 數值當成一個顏色解碼，半透明的地方就錯了。

/** sRGB 數值 → 線性（IEC 61966-2-1，同 three.js 的 sRGBTransferEOTF）。 */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** 線性 → sRGB 數值（同 three.js 的 sRGBTransferOETF）。 */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

let premultiplyLookup: Uint8Array | null = null;

/** 查表 [alpha × 256 ＋ e]：sRGB 位元組 e、alpha 位元組 → 線性空間乘上 alpha 再編回 sRGB 的位元組（第一次用到才建）。 */
function premultiplyTable(): Uint8Array {
  if (!premultiplyLookup) {
    const table = new Uint8Array(256 * 256);
    for (let a = 0; a < 256; a++) {
      for (let e = 0; e < 256; e++) table[a * 256 + e] = Math.round(linearToSrgb((a / 255) * srgbToLinear(e / 255)) * 255);
    }
    premultiplyLookup = table;
  }
  return premultiplyLookup;
}

/**
 * 直通 alpha 的 RGBA（由上到下，canvas getImageData 的格式）→ 線性空間預乘 alpha 再編回 sRGB 的 RGBA，alpha 不變。
 * 列順序上下顛倒（由下到上）：貼圖 uv 的 v＝0 是圖的下緣（同 three.js 圖片貼圖的 flipY）。
 * 整列先原樣複製，再只改不是完全不透明的像素（完全透明的查表得 0）。
 */
export function premultiplyRows(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const table = premultiplyTable();
  const rowBytes = width * 4;
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const from = y * rowBytes;
    const to = (height - 1 - y) * rowBytes;
    out.set(rgba.subarray(from, from + rowBytes), to);
    for (let i = to, end = to + rowBytes; i < end; i += 4) {
      const a = out[i + 3]!;
      if (a === 255) continue;
      const row = a << 8;
      out[i] = table[row | out[i]!]!;
      out[i + 1] = table[row | out[i + 1]!]!;
      out[i + 2] = table[row | out[i + 2]!]!;
    }
  }
  return out;
}
