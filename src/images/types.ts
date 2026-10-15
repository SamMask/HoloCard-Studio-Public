// 圖片模組對其他模組的契約（SCHEMA.md §2、§3 的 images 表）。

export type StoredImageType = 'image/webp' | 'image/png';

/** 上傳處理完、可以存起來的一張圖。 */
export interface StoredImage {
  /** SHA-256（編碼後內容）前 16 碼小寫十六進位。 */
  hash: string;
  blob: Blob;
  type: StoredImageType;
  width: number;
  height: number;
  /** 任一像素 alpha < 250 即為 true。 */
  hasAlpha: boolean;
}

export type IngestError = 'too-large' | 'not-image' | 'decode-failed';

export type IngestResult = { ok: true; image: StoredImage; name: string } | { ok: false; reason: IngestError; name: string };

/** 解碼前檢查的檔案大小上限。 */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** 最長邊超過就等比縮到這個長度。 */
export const MAX_EDGE_PX = 2048;
/** 接受的上傳格式。 */
export const ACCEPTED_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const;

/** 記憶體裡的圖片登記簿：雜湊 → 圖與已解碼的 <img>。render 透過 main 注入的 getImage 取圖。 */
export interface ImageRegistry {
  /** 加入並解碼（同一個雜湊只存一份）。 */
  add(image: StoredImage): Promise<void>;
  has(hash: string): boolean;
  get(hash: string): StoredImage | undefined;
  /** 已解碼、可直接當貼圖的圖；沒有就回 undefined。 */
  element(hash: string): HTMLImageElement | undefined;
  /** 給縮圖用的 object URL（同一張圖重複呼叫回同一個網址）。 */
  url(hash: string): string | undefined;
}
