// 上傳一張圖 → 檢查、解碼、縮圖、偵測透明、編碼、算雜湊（SCHEMA.md §2）。
// 全程只在瀏覽器本機處理，不對外請求（AGENTS.md 硬邊界 1）。
// 「判斷」寫成純函式（checkFile、layerNameFromFile）可在 node 測；解碼與畫布只在 ingestFile 裡。

import { S } from '../i18n';
import { hasTransparency } from './alpha';
import { fitWithin } from './fit';
import { hashBytes } from './hash';
import {
  ACCEPTED_TYPES,
  MAX_EDGE_PX,
  MAX_UPLOAD_BYTES,
  type IngestError,
  type IngestResult,
  type StoredImage,
  type StoredImageType,
} from './types';

/** 圖層名稱最多幾個字。 */
const MAX_NAME_CHARS = 60;
/** 檔名拿不到有意義的名字時用的預設圖層名。 */
const DEFAULT_LAYER_NAME = S.defaults.layerName;
/** WebP 編碼品質（SCHEMA.md §2：q≈0.92）。 */
const WEBP_QUALITY = 0.92;

/**
 * 解碼前的檢查。通過回 null，否則回錯誤原因。
 * 大小先檢查（太大就不解碼）；type 有值但不在接受清單 → not-image；type 是空的就放行，交給解碼判斷。
 */
export function checkFile(size: number, type: string): IngestError | null {
  if (size > MAX_UPLOAD_BYTES) return 'too-large';
  if (type !== '' && !(ACCEPTED_TYPES as readonly string[]).includes(type)) return 'not-image';
  return null;
}

/** 檔名 → 圖層名：去掉最後一段副檔名、前後空白，最多 60 字；空的用「圖層」。 */
export function layerNameFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
  const name = Array.from(base.trim()).slice(0, MAX_NAME_CHARS).join('').trim();
  return name === '' ? DEFAULT_LAYER_NAME : name;
}

/** 把一個上傳的檔案處理成可存的圖。任何情況都不丟例外，一律回 IngestResult。 */
export async function ingestFile(file: File): Promise<IngestResult> {
  const name = layerNameFromFile(file.name);

  const rejected = checkFile(file.size, file.type);
  if (rejected) return { ok: false, reason: rejected, name };

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width < 1 || bitmap.height < 1) return { ok: false, reason: 'decode-failed', name };

    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE_PX);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'decode-failed', name };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    return { ok: true, name, image: await storeCanvas(canvas, ctx) };
  } catch {
    return { ok: false, reason: 'decode-failed', name };
  } finally {
    bitmap?.close();
  }
}

/**
 * 畫好的畫布 → 可存的圖：偵測透明 → 編碼 WebP（不行就 PNG）→ 算雜湊。
 * 上傳（ingestFile）和文字圖層（text.ts）共用這一份。失敗會丟例外，由呼叫端接住。
 */
export async function storeCanvas(canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D): Promise<StoredImage> {
  const { width, height } = canvas;
  const hasAlpha = hasTransparency(ctx.getImageData(0, 0, width, height).data);

  let type: StoredImageType = 'image/webp';
  let blob = await canvas.convertToBlob({ type, quality: WEBP_QUALITY });
  if (blob.type !== 'image/webp') {
    // 瀏覽器編不出 WebP（會靜默退回別的格式）→ 改存 PNG。
    type = 'image/png';
    blob = await canvas.convertToBlob({ type });
  }

  const hash = await hashBytes(await blob.arrayBuffer());
  return { hash, blob, type, width, height, hasAlpha };
}
