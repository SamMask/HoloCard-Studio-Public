// 存檔模組的實作（SCHEMA.md §3）：卡片與圖片只存在使用者自己瀏覽器的 IndexedDB，不上傳任何地方（硬邊界 1）。
// 只用瀏覽器內建的 IndexedDB 介面；每個動作一個交易（transaction），出錯就 reject、不吞掉。
//
// 資料庫 `holocard-studio` 版本 1：
//   cards  key＝card.id        值＝{ card, thumbnail? }
//   images key＝圖片雜湊        值＝{ blob, type, width, height, hasAlpha }
//   meta   key＝字串            值＝字串
import type { StoredImage, StoredImageType } from '../images/types';
import { alignClipDepths } from '../model/actions';
import { migrateCard } from '../model/foil';
import { IMAGE_HASH, isFiniteNumber } from '../model/limits';
import type { Card } from '../model/types';
import { validateCard } from '../model/validate';
import {
  DB_NAME,
  DB_VERSION,
  type CardStore,
  type CardSummary,
  type OpenCardStore,
  type StorageEstimate,
} from './types';

const CARDS = 'cards';
const IMAGES = 'images';
const META = 'meta';

/** 存卡被擋時，錯誤訊息最多列幾條原因。 */
const MAX_REPORTED_ERRORS = 5;
const IMAGE_TYPES: readonly StoredImageType[] = ['image/webp', 'image/png'];

// ---- IndexedDB 的 Promise 包裝 ----

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 要求失敗'));
  });
}

/** 交易完成才算數（oncomplete）；被中止或出錯就 reject。 */
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 交易失敗'));
    tx.onabort = () => reject(tx.error ?? new DOMException('IndexedDB 交易被中止', 'AbortError'));
  });
}

/**
 * 開一個交易、跑 work、等交易真的寫完才回傳。work 丟錯就中止交易（什麼都不寫）再把錯丟出去。
 * work 裡面只能等 IndexedDB 的要求（request），不能等別的事（例如 fetch），否則交易會先結束。
 */
async function run<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = finished(tx);
  done.catch(() => {}); // work 先出錯的話這裡不會有人等；錯誤由 work 的那一條丟出去
  let result: T;
  try {
    result = await work(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // 交易已經結束或中止了
    }
    await done.catch(() => {});
    throw error;
  }
  await done;
  return result;
}

// ---- 資料庫裡的紀錄 ----

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 一筆紀錄用到的圖片雜湊：兩面的圖層、圖層的變身圖（T-805）＋反光層的黑白圖（T-417）＋舞台背景圖（T-814）＋前景圖（T-830；
 * 黑白圖、變身圖、背景圖、前景圖也算有在用，刪卡、清圖時不能收掉）。資料壞掉也盡量讀：壞紀錄指到的圖寧可留著，不替使用者丟掉。
 */
function imageHashes(value: unknown): string[] {
  const hashes = new Set<string>();
  const add = (image: unknown) => {
    if (typeof image === 'string' && IMAGE_HASH.test(image)) hashes.add(image);
  };
  const card = isObject(value) ? value.card : undefined;
  const view = isObject(card) ? card.view : undefined;
  add(isObject(view) ? view.backdrop : undefined);
  add(isObject(view) && isObject(view.foreground) ? view.foreground.image : undefined);
  for (const face of [isObject(card) ? card.front : undefined, isObject(card) ? card.back : undefined]) {
    if (!isObject(face)) continue;
    const layers = face.layers;
    if (Array.isArray(layers)) {
      for (const layer of layers) {
        if (!isObject(layer)) continue;
        add(layer.image);
        add(isObject(layer.alt) ? layer.alt.image : undefined);
      }
    }
    add(isObject(face.foil) ? face.foil.mask : undefined);
  }
  return Array.from(hashes);
}

/**
 * 資料庫裡的卡片紀錄能不能用：卡片資料合格（含圖片都在）而且 key 和 card.id 對得上。
 * T-417 以前存的卡（holo.scope）先轉成反光層再驗（model/foil.ts 的 migrateCard），回傳的是轉好的卡；下次存檔就是新格式。
 */
function readCard(key: unknown, value: unknown, imageKeys: ReadonlySet<string>): Card | undefined {
  if (!isObject(value)) return undefined;
  const card = migrateCard(value.card);
  if (validateCard(card, (hash) => imageKeys.has(hash)).length > 0) return undefined;
  // 剪裁層的 depth 對齊下面那層（T-803b）：沒有要改的回同一個物件
  return (card as Card).id === key ? alignClipDepths(card as Card) : undefined;
}

function readThumbnail(value: unknown): Blob | undefined {
  const thumbnail = isObject(value) ? value.thumbnail : undefined;
  return thumbnail instanceof Blob ? thumbnail : undefined;
}

function isImageRecord(v: unknown): v is Omit<StoredImage, 'hash'> {
  return (
    isObject(v) &&
    v.blob instanceof Blob &&
    IMAGE_TYPES.includes(v.type as StoredImageType) &&
    isFiniteNumber(v.width) &&
    v.width > 0 &&
    isFiniteNumber(v.height) &&
    v.height > 0 &&
    typeof v.hasAlpha === 'boolean'
  );
}

async function imageKeySet(tx: IDBTransaction): Promise<Set<string>> {
  const keys = await request(tx.objectStore(IMAGES).getAllKeys());
  return new Set(keys.map(String));
}

/** 所有卡片紀錄（不管好壞）用到的圖片雜湊。 */
async function usedHashes(tx: IDBTransaction): Promise<Set<string>> {
  const records = await request(tx.objectStore(CARDS).getAll());
  const used = new Set<string>();
  for (const record of records) for (const hash of imageHashes(record)) used.add(hash);
  return used;
}

// ---- 開啟 ----

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // 之後升版本時，在這裡照 oldVersion 往上加遷移。
      if (event.oldVersion < 1) {
        db.createObjectStore(CARDS);
        db.createObjectStore(IMAGES);
        db.createObjectStore(META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打不開資料庫'));
  });
}

export const openCardStore: OpenCardStore = async (factory = globalThis.indexedDB) => {
  if (!factory) throw new Error('這個瀏覽器不支援 IndexedDB，沒辦法存卡片');
  const db = await openDatabase(factory);

  return {
    async list() {
      const [keys, records, imageKeys] = await run(db, [CARDS, IMAGES], 'readonly', async (tx) => {
        const cards = tx.objectStore(CARDS);
        return Promise.all([request(cards.getAllKeys()), request(cards.getAll()), imageKeySet(tx)]);
      });
      const summaries: CardSummary[] = [];
      records.forEach((record, i) => {
        const card = readCard(keys[i], record, imageKeys);
        if (!card) return;
        const summary: CardSummary = {
          id: card.id,
          name: card.name,
          aspect: card.aspect,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        };
        if (card.kind === 'disc') summary.kind = 'disc';
        const thumbnail = readThumbnail(record);
        if (thumbnail) summary.thumbnail = thumbnail;
        summaries.push(summary);
      });
      return summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    async hasCards() {
      const count = await run(db, [CARDS], 'readonly', (tx) => request(tx.objectStore(CARDS).count()));
      return count > 0;
    },

    async load(id) {
      return run(db, [CARDS, IMAGES], 'readonly', async (tx) => {
        const [record, imageKeys] = await Promise.all([request(tx.objectStore(CARDS).get(id)), imageKeySet(tx)]);
        return readCard(id, record, imageKeys);
      });
    },

    async save(card, thumbnail) {
      if (thumbnail !== undefined && !(thumbnail instanceof Blob)) throw new Error('縮圖要是 Blob，沒有存');
      // 先拍快照再驗再存：驗的和存的是同一份資料，之後呼叫端再改原物件也不影響。
      let snapshot: Card;
      try {
        snapshot = structuredClone(card);
      } catch {
        throw new Error('卡片資料不是單純的資料，沒有存');
      }
      await run(db, [CARDS, IMAGES], 'readwrite', async (tx) => {
        const imageKeys = await imageKeySet(tx);
        const errors = validateCard(snapshot, (hash) => imageKeys.has(hash));
        if (errors.length > 0) {
          const shown = errors.slice(0, MAX_REPORTED_ERRORS).join('；');
          const more = errors.length > MAX_REPORTED_ERRORS ? `（共 ${errors.length} 條）` : '';
          throw new Error(`卡片資料不合格，沒有存：${shown}${more}`);
        }
        const cards = tx.objectStore(CARDS);
        const kept = thumbnail ?? readThumbnail(await request(cards.get(snapshot.id)));
        await request(cards.put(kept ? { card: snapshot, thumbnail: kept } : { card: snapshot }, snapshot.id));
      });
    },

    async saveThumbnail(id, updatedAt, thumbnail) {
      if (!(thumbnail instanceof Blob)) throw new Error('縮圖要是 Blob，沒有存');
      // 同一個交易裡讀、比對、寫：中間不會被別的分頁插進來。卡片內容原樣放回去，只換縮圖。
      return run(db, [CARDS], 'readwrite', async (tx) => {
        const cards = tx.objectStore(CARDS);
        const record: unknown = await request(cards.get(id));
        const card = isObject(record) ? record.card : undefined;
        if (!isObject(record) || !isObject(card) || card.id !== id || card.updatedAt !== updatedAt) return false;
        await request(cards.put({ ...record, thumbnail }, id));
        return true;
      });
    },

    async remove(id) {
      await run(db, [CARDS, IMAGES], 'readwrite', async (tx) => {
        const cards = tx.objectStore(CARDS);
        const record = await request(cards.get(id));
        if (record === undefined) return;
        await request(cards.delete(id));
        // 這張卡用過的圖裡，沒有別張卡還在用的才刪（別張卡共用的要留著）。
        const stillUsed = await usedHashes(tx);
        const images = tx.objectStore(IMAGES);
        for (const hash of imageHashes(record)) {
          if (!stillUsed.has(hash)) await request(images.delete(hash));
        }
      });
    },

    async saveImage(image) {
      if (!isObject(image) || typeof image.hash !== 'string' || !IMAGE_HASH.test(image.hash) || !isImageRecord(image)) {
        throw new Error('圖片資料不合格，沒有存');
      }
      const { hash, blob, type, width, height, hasAlpha } = image;
      await run(db, [IMAGES], 'readwrite', async (tx) => {
        const images = tx.objectStore(IMAGES);
        if ((await request(images.getKey(hash))) !== undefined) return; // 同雜湊只存一份
        await request(images.put({ blob, type, width, height, hasAlpha }, hash));
      });
    },

    async loadImage(hash) {
      const record = await run(db, [IMAGES], 'readonly', (tx) => request(tx.objectStore(IMAGES).get(hash)));
      if (!isImageRecord(record)) return undefined;
      const { blob, type, width, height, hasAlpha } = record;
      return { hash, blob, type, width, height, hasAlpha };
    },

    async cleanupImages() {
      return run(db, [CARDS, IMAGES], 'readwrite', async (tx) => {
        const used = await usedHashes(tx);
        const images = tx.objectStore(IMAGES);
        const unused = (await request(images.getAllKeys())).filter((key) => !used.has(String(key)));
        for (const key of unused) await request(images.delete(key));
        return unused.length;
      });
    },

    async getMeta(key) {
      const value = await run(db, [META], 'readonly', (tx) => request(tx.objectStore(META).get(key)));
      return typeof value === 'string' ? value : undefined;
    },

    async setMeta(key, value) {
      await run(db, [META], 'readwrite', (tx) => request(tx.objectStore(META).put(value, key)));
    },

    async updateMeta(key, update) {
      // 讀和寫在同一個 readwrite 交易：IndexedDB 讓範圍重疊的 readwrite 交易一個一個來，中間不會被別的改動插進來
      await run(db, [META], 'readwrite', async (tx) => {
        const meta = tx.objectStore(META);
        const old: unknown = await request(meta.get(key));
        await request(meta.put(update(typeof old === 'string' ? old : undefined), key));
      });
    },

    async estimate(): Promise<StorageEstimate | null> {
      try {
        const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
        if (!storage || typeof storage.estimate !== 'function') return null;
        const { usage, quota } = await storage.estimate();
        return isFiniteNumber(usage) && isFiniteNumber(quota) ? { usage, quota } : null;
      } catch {
        return null;
      }
    },
  };
};
