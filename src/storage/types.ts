// 存檔模組（storage）對其他模組的契約（SCHEMA.md §3）。實作在 `src/storage/store.ts`。
// 只存在使用者自己的瀏覽器（IndexedDB），不上傳任何地方（硬邊界 1）。

import type { StoredImage } from '../images/types';
import type { Aspect, Card, CardKind } from '../model/types';

/** 卡片庫列表用的摘要（不含圖層細節）。 */
export interface CardSummary {
  id: string;
  name: string;
  aspect: Aspect;
  /** 物件種類（T-810b）：光碟才有（'disc'），卡片庫的格子要畫成圓的；一般卡沒有這個欄位。 */
  kind?: CardKind;
  createdAt: string;
  updatedAt: string;
  /** 正面小縮圖（WebP，瀏覽器編不出 WebP 才是 PNG；T-407），沒有就 undefined（例如還沒來得及產生）。 */
  thumbnail?: Blob;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export interface CardStore {
  /** 依 updatedAt 由新到舊。 */
  list(): Promise<CardSummary[]>;
  /**
   * 資料庫裡有沒有任何一筆卡片紀錄（讀不出來的也算，T-605c）：list 會略過缺圖、不合格的紀錄，
   * 開啟工坊時要靠這個分辨「第一次使用（一筆都沒有）」和「有卡但讀不出來」。
   */
  hasCards(): Promise<boolean>;
  /** 讀一張卡；不存在或資料壞掉（validateCard 不過）回 undefined。 */
  load(id: string): Promise<Card | undefined>;
  /** 存一張卡（新增或覆蓋）。存之前用 validateCard 檢查，不合格就丟錯、不寫入。thumbnail 沒給就保留舊的。 */
  save(card: Card, thumbnail?: Blob): Promise<void>;
  /**
   * 只更新縮圖（T-409）：資料庫裡那張卡存在、而且它的 updatedAt 等於給的值才寫，回有沒有寫。
   * 不重寫卡片內容——避免另一個分頁或晚到的縮圖把舊版卡片蓋回去。
   */
  saveThumbnail(id: string, updatedAt: string, thumbnail: Blob): Promise<boolean>;
  /** 刪一張卡，並清掉不再被任何卡片用到的圖（SCHEMA §3）。 */
  remove(id: string): Promise<void>;
  /** 存一張圖（同雜湊只存一份）。 */
  saveImage(image: StoredImage): Promise<void>;
  loadImage(hash: string): Promise<StoredImage | undefined>;
  /** 程式啟動時呼叫：刪掉沒有任何卡片用到的圖，回傳刪了幾張。 */
  cleanupImages(): Promise<number>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  /**
   * 原子地改一筆 meta（T-829c）：同一個交易裡讀舊值（沒有或不是字串＝undefined）→ update 算出新值 → 寫回。
   * update 要是同步的純函式（交易裡不能等別的事）；update 丟錯就什麼都不寫、把錯丟出去。
   * 同時改同一個 key 的兩次會一前一後做，不會蓋掉對方的改動（分開 getMeta、setMeta 會）。
   */
  updateMeta(key: string, update: (old: string | undefined) => string): Promise<void>;
  /** navigator.storage.estimate() 的結果；瀏覽器不支援就 null。 */
  estimate(): Promise<StorageEstimate | null>;
}

/** 資料庫名與版本（SCHEMA §3）。升版本要寫遷移與測試。 */
export const DB_NAME = 'holocard-studio';
export const DB_VERSION = 1;

/** 開啟（或建立）資料庫。factory 預設用瀏覽器的 indexedDB，測試時傳 fake-indexeddb。 */
export type OpenCardStore = (factory?: IDBFactory) => Promise<CardStore>;
