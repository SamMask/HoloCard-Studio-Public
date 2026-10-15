// 卡片庫縮圖的格式（T-407，SCHEMA §3）：render 拍出來的是 320 寬的透明 PNG（約 285 KB），改存 WebP（保留透明）縮小檔案。
// 瀏覽器編不出 WebP（例如某些 Safari 會靜默退回 PNG）就照舊存 PNG（同 SCHEMA §2 上傳圖的做法）。
// 卡片檔的 preview.png 一律是 PNG（SCHEMA §4）：匯出不用先打開的卡時，從存著的縮圖轉回 PNG。
// 只在本機記憶體裡轉檔，不對外請求（硬邊界 1）。判斷寫成純函式（preferWebp），畫布只在瀏覽器裡用。

import { fitWithin } from '../images/fit';
import { aspectHeight, isDisc, type CardShape } from '../model/aspect';
import { DISC } from '../render/disc';
import { PREVIEW_MAX_SIDE } from './files';

/** 縮圖 WebP 的品質。 */
export const THUMBNAIL_WEBP_QUALITY = 0.85;

/** encode 編出來的是 WebP 就用它；編不出來（type 不是 image/webp）或出錯就留原本的 PNG。 */
export async function preferWebp(png: Blob, encode: () => Promise<Blob>): Promise<Blob> {
  try {
    const webp = await encode();
    return webp.type === 'image/webp' ? webp : png;
  } catch (err) {
    console.error(err);
    return png;
  }
}

async function drawBlob(blob: Blob, maxSide = Infinity): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('沒有 2D 畫布');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** 瀏覽器：PNG 縮圖 → WebP（保留透明）；編不出 WebP 就回原本的 PNG。 */
export function thumbnailToWebp(png: Blob): Promise<Blob> {
  return preferWebp(png, async () => (await drawBlob(png)).convertToBlob({ type: 'image/webp', quality: THUMBNAIL_WEBP_QUALITY }));
}

/** 瀏覽器：存著的縮圖（WebP 或 PNG）→ 卡片檔的 preview.png（最長邊不超過 512）。 */
export async function thumbnailToPreviewPng(thumbnail: Blob): Promise<Blob> {
  return (await drawBlob(thumbnail, PREVIEW_MAX_SIDE)).convertToBlob({ type: 'image/png' });
}

/**
 * 瀏覽器：沒有縮圖的卡的 preview.png——照比例的圓角卡片外形、卡身顏色（透明底）；長邊 512（橫式卡寬是長邊，T-807）。
 * CD 光碟（T-810）：圓形、中間挖掉透明圈與孔（印刷面圓環＝卡身顏色）。
 */
export async function plainPreviewPng(shape: CardShape, bodyColor: string): Promise<Blob> {
  if (isDisc(shape)) {
    const side = PREVIEW_MAX_SIDE;
    const canvas = new OffscreenCanvas(side, side);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('沒有 2D 畫布');
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(side / 2, side / 2, side * DISC.printOuter, 0, Math.PI * 2);
    ctx.arc(side / 2, side / 2, side * DISC.printInner, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const cardH = aspectHeight(shape);
  const height = cardH >= 1 ? PREVIEW_MAX_SIDE : Math.max(1, Math.round(PREVIEW_MAX_SIDE * cardH));
  const width = cardH >= 1 ? Math.max(1, Math.round(PREVIEW_MAX_SIDE / cardH)) : PREVIEW_MAX_SIDE;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('沒有 2D 畫布');
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, width * 0.05);
  ctx.fill();
  return canvas.convertToBlob({ type: 'image/png' });
}
