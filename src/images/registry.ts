// 記憶體裡的圖片登記簿：雜湊 → 圖、object URL、已解碼的 <img>。
// object URL 只指向本機記憶體裡的 Blob，不是網路請求。
// T-404 新增：retain（換卡時只留新卡的圖，其他的收回 object URL、丟掉 <img>）、
// inkBox（文字圖層的圖裡字在哪：從 alpha 算、算一次就記住，選取框與縮圖只框住字；存檔載入的卡也一樣準）。
// T-512 新增：hold（轉動影片／GIF 匯出期間暫時保留副本用到的圖：換卡時 retain 先不收，匯出收尾放開才收）。
// T-704c 新增：discard（AI 的結果沒用上時立刻收掉那幾張；還被 hold 著的等放開才收）。

import type { ImageRegistry, StoredImage } from './types';

/** 字的範圍（以圖中心對稱的比例，1＝整張圖寬或高）。 */
export interface InkBox {
  w: number;
  h: number;
}

/** alpha 大於這個值才算有東西（和美術流程「alpha ≤ 8 清零」同一條線，壓縮雜點不算字）。 */
const INK_ALPHA = 8;
/** 算字的範圍時先把圖縮到長邊這麼大（只要比例，不用每個像素）。 */
const INK_SAMPLE_EDGE = 512;

/**
 * RGBA 陣列 → 字的範圍：找出 alpha > 8 的外框，再以圖中心對稱（取離中心比較遠的那一邊），
 * 所以框的中心永遠是圖層中心（選取框、移動、縮放都以圖層中心為準）。整張透明或長寬不合理回 undefined。
 */
export function inkBoxFromAlpha(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): InkBox | undefined {
  if (!(width >= 1 && height >= 1) || rgba.length < width * height * 4) return undefined;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3]! > INK_ALPHA) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return undefined;
  const half = (lo: number, hi: number, size: number) => Math.max(size / 2 - lo, hi + 1 - size / 2);
  return { w: Math.min(1, (2 * half(x0, x1, width)) / width), h: Math.min(1, (2 * half(y0, y1, height)) / height) };
}

/** 從已解碼的圖算字的範圍（只在瀏覽器）。畫不出來就 undefined。 */
function measureInk(el: HTMLImageElement): InkBox | undefined {
  const scale = Math.min(1, INK_SAMPLE_EDGE / Math.max(el.naturalWidth, el.naturalHeight));
  const w = Math.max(1, Math.round(el.naturalWidth * scale));
  const h = Math.max(1, Math.round(el.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(el, 0, 0, w, h);
  return inkBoxFromAlpha(ctx.getImageData(0, 0, w, h).data, w, h);
}

export interface ManagedImageRegistry extends ImageRegistry {
  /** 換卡時：只留下 keep 裡的圖，其他的收回 object URL、丟掉 <img> 與資料（render 的貼圖在換卡時已經自己釋放）。 */
  retain(keep: ReadonlySet<string>): void;
  /** 文字圖層的字在圖裡佔多少（從 alpha 算，第一次用到時算、之後記住）；沒有這張圖或整張透明回 undefined。 */
  inkBox(hash: string): InkBox | undefined;
  /**
   * 暫時保留這些圖（T-512，匯出期間：3D 預覽與擷取畫的是開始時複製的那份卡，換卡也不能收掉它的圖）。
   * hold 著的圖遇到 retain 不在 keep 裡時先不收、記下來；回傳的函式放開（呼叫多次只算一次），
   * 放開後沒有人 hold 的圖才照「最後一次 retain 本來要收」收掉——之後又被 retain 留下、或重新 add（目前的卡在用）的就不收。
   */
  hold(hashes: Iterable<string>): () => void;
  /**
   * 立刻收掉這幾張（T-704c：AI 的結果沒用上，不等下次換卡）。呼叫端要先確定目前的卡、復原歷史都沒在用；
   * 還被別人 hold 著的先不收、記下來，全部放開時才收（同 retain）。之後又被 add 的不收。
   */
  discard(hashes: Iterable<string>): void;
}

export function createImageRegistry(): ManagedImageRegistry {
  const images = new Map<string, StoredImage>();
  const urls = new Map<string, string>();
  const elements = new Map<string, HTMLImageElement>();
  const inks = new Map<string, InkBox | undefined>();
  /** 正在解碼的圖：同一個雜湊同時加入多次，共用同一次解碼。 */
  const pending = new Map<string, Promise<void>>();
  /** 被 hold 幾次（匯出中）。 */
  const holds = new Map<string, number>();
  /** retain 本來要收、但還被 hold 著的圖：放開時才收。 */
  const dropLater = new Set<string>();

  const drop = (hash: string) => {
    const url = urls.get(hash);
    if (url) URL.revokeObjectURL(url);
    urls.delete(hash);
    elements.delete(hash);
    images.delete(hash);
    inks.delete(hash);
    dropLater.delete(hash);
  };

  async function load(image: StoredImage): Promise<void> {
    const url = URL.createObjectURL(image.blob);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      images.set(image.hash, image);
      urls.set(image.hash, url);
      elements.set(image.hash, el);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  return {
    async add(image) {
      // 又有人要用（例如目前的卡上傳了一樣的圖）：放開 hold 時不能收
      dropLater.delete(image.hash);
      if (images.has(image.hash)) return;
      let task = pending.get(image.hash);
      if (!task) {
        task = load(image).finally(() => pending.delete(image.hash));
        pending.set(image.hash, task);
      }
      await task;
    },
    has: (hash) => images.has(hash),
    get: (hash) => images.get(hash),
    element: (hash) => elements.get(hash),
    url: (hash) => urls.get(hash),

    retain(keep) {
      for (const hash of [...images.keys()]) {
        if (keep.has(hash)) dropLater.delete(hash);
        else if (holds.has(hash)) dropLater.add(hash);
        else drop(hash);
      }
    },

    hold(hashes) {
      const held = [...new Set(hashes)];
      for (const hash of held) holds.set(hash, (holds.get(hash) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const hash of held) {
          const left = (holds.get(hash) ?? 1) - 1;
          if (left > 0) {
            holds.set(hash, left);
            continue;
          }
          holds.delete(hash);
          if (dropLater.has(hash)) drop(hash);
        }
      };
    },

    discard(hashes) {
      for (const hash of new Set(hashes)) {
        if (!images.has(hash)) continue;
        if (holds.has(hash)) dropLater.add(hash);
        else drop(hash);
      }
    },

    inkBox(hash) {
      if (inks.has(hash)) return inks.get(hash);
      const el = elements.get(hash);
      if (!el) return undefined;
      let box: InkBox | undefined;
      try {
        box = measureInk(el);
      } catch {
        box = undefined;
      }
      inks.set(hash, box);
      return box;
    },
  };
}
