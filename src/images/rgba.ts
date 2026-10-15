// 圖 ↔ RGBA 像素（T-703：AI 去背的輸入與輸出）。只在瀏覽器（createImageBitmap、OffscreenCanvas），全程在本機，不對外請求。
// 去背好的 RGBA 走和上傳一樣的 storeCanvas（偵測透明 → WebP〔不行就 PNG〕→ 雜湊，SCHEMA §2）。

import { storeCanvas } from './ingest';
import type { StoredImage } from './types';

/** RGBA 像素（直通 alpha，0～255），列優先。和 src/ai/types.ts 的 RgbaImage 同形（images 不依賴 ai）。 */
export interface RgbaPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 已經存好的圖（WebP／PNG Blob）→ RGBA。解不開就丟錯。 */
export async function decodeToRgba(blob: Blob): Promise<RgbaPixels> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available');
    ctx.drawImage(bitmap, 0, 0);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

/** RGBA → 可存的圖（storeCanvas：偵測透明、WebP、雜湊）。畫不出來或編碼失敗就丟錯。 */
export async function encodeRgba(pixels: RgbaPixels): Promise<StoredImage> {
  const { width, height, data } = pixels;
  if (!(width >= 1 && height >= 1) || data.length !== width * height * 4) throw new RangeError(`Bad RGBA image ${width}×${height}`);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return storeCanvas(canvas, ctx);
}
