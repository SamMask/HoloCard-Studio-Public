// 把 readRenderTargetPixelsAsync 讀回的 RGBA 整理成緊密排列、由上到下的列。
// WebGPU：每列補齊到 256 位元組（最後一列不補）、列由上到下；WebGL2：緊密排列、列由下到上（要翻）。

export function packRows(
  data: ArrayLike<number>, width: number, height: number, flipY: boolean,
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(width * height * 4),
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4;
  const stride = height > 1 ? (data.length - rowBytes) / (height - 1) : rowBytes;
  if (!Number.isInteger(stride) || stride < rowBytes) throw new Error('讀回的像素大小不對');
  if (out.length !== rowBytes * height) throw new Error('輸出像素暫存大小不對');
  // 讀回的通常是位元組陣列：整列一次複製（1500 寬的匯出圖逐位元組搬要幾十毫秒）
  const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : null;
  for (let row = 0; row < height; row++) {
    const src = (flipY ? height - 1 - row : row) * stride;
    const dst = row * rowBytes;
    if (bytes) out.set(bytes.subarray(src, src + rowBytes), dst);
    else for (let i = 0; i < rowBytes; i++) out[dst + i] = data[src + i]!;
  }
  return out;
}

/** sRGB 位元組（0～255）→ 線性（0～1）。 */
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

function linearToSrgbByte(l: number): number {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, v) * 255);
}

/**
 * 透明底清空、卡片不透明，多重取樣平均後卡片邊緣的像素＝卡片顏色 × 覆蓋率（預乘 alpha，在線性空間混，再編成 sRGB）。
 * PNG／ImageData 要的是沒預乘的顏色：半透明的像素在線性空間除回覆蓋率（原地改）。不改的話邊緣會多一圈暗邊。
 */
export function unpremultiply(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a === 0 || a === 255) continue;
    const k = 255 / a;
    for (let c = 0; c < 3; c++) pixels[i + c] = linearToSrgbByte(SRGB_TO_LINEAR[pixels[i + c]!]! * k);
  }
}

/**
 * 連舞台一起錄（T-850）：3D 畫布讀回的畫格（預乘 alpha；舞台的光是相加的，顏色可以比 alpha 亮）疊到不透明的底（CSS 那層）上，
 * 和瀏覽器把透明畫布疊在 CSS 背景上一樣：out＝上＋底 ×（1 − 上的 alpha），alpha 一律 255（超過 255 夾住）。
 * 不先還原預乘（unpremultiply 會把相加的光夾掉），所以和預覽看到的一樣。三個陣列一樣大（out 可以重用）；不一樣大丟錯。
 */
export function composeOver(top: ArrayLike<number>, base: ArrayLike<number>, out: Uint8ClampedArray): void {
  if (top.length !== out.length || base.length !== out.length || out.length % 4 !== 0) throw new Error('合成的畫格大小不對');
  for (let i = 0; i < out.length; i += 4) {
    const k = (255 - top[i + 3]!) / 255;
    out[i] = top[i]! + base[i]! * k;
    out[i + 1] = top[i + 1]! + base[i + 1]! * k;
    out[i + 2] = top[i + 2]! + base[i + 2]! * k;
    out[i + 3] = 255;
  }
}
