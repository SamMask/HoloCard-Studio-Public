import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredImage } from '../src/images/types';
import { addLayer, addTextLayer, updateTextLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, TextSpec } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { DB_NAME, DB_VERSION, type CardStore } from '../src/storage/types';

// ---- 小工具 ----

const T0 = '2026-10-13T00:00:00.000Z';

/** 合格的圖片雜湊（16 碼小寫十六進位）。 */
function hashOf(n: number): string {
  return n.toString(16).padStart(16, '0');
}

/** 第 n 號測試圖：偶數有透明（立體層）、奇數不透明（底圖）；內容是 `img-n`，方便比對讀回來的是哪一張。 */
function image(n: number, content = `img-${n}`): StoredImage {
  return {
    hash: hashOf(n),
    blob: new Blob([content], { type: 'image/webp' }),
    type: 'image/webp',
    width: 64,
    height: 96,
    hasAlpha: n % 2 === 0,
  };
}

/** 用 newCard＋addLayer 組一張卡：每張圖加到正面（不透明的當底圖，有透明的當立體層）。 */
function cardWith(id: string, imageNumbers: number[], updatedAt = T0): Card {
  let card = newCard('standard', id, T0);
  imageNumbers.forEach((n, i) => {
    const img = image(n);
    const result = addLayer(card, 'front', {
      id: `${id}-layer-${i}`,
      name: `圖 ${n}`,
      image: img.hash,
      hasAlpha: img.hasAlpha,
      width: img.width,
      height: img.height,
    });
    if (!result.ok) throw new Error(`測試資料組不起來：${result.reason}`);
    card = result.card;
  });
  return { ...card, updatedAt };
}

/** 正面：一張底圖（第 1 號圖）加一個文字圖層（圖是 textImage 號，要有透明＝偶數）。 */
function cardWithText(id: string, text: TextSpec, textImage = 2): Card {
  const base = image(1);
  const tImg = image(textImage);
  const withBase = addLayer(newCard('standard', id, T0), 'front', {
    id: `${id}-base`,
    name: '底圖',
    image: base.hash,
    hasAlpha: false,
    width: base.width,
    height: base.height,
  });
  if (!withBase.ok) throw new Error(`測試資料組不起來：${withBase.reason}`);
  const result = addTextLayer(withBase.card, 'front', { id: `${id}-text`, image: tImg.hash, text, width: tImg.width, height: tImg.height });
  if (!result.ok) throw new Error(`測試資料組不起來：${result.reason}`);
  return result.card;
}

/** 先把卡用到的圖都存好（呼叫端的責任），再存卡。 */
async function saveWithImages(store: CardStore, card: Card, imageNumbers: number[], thumbnail?: Blob): Promise<void> {
  for (const n of imageNumbers) await store.saveImage(image(n));
  await store.save(card, thumbnail);
}

function png(content: string): Blob {
  return new Blob([content], { type: 'image/png' });
}

async function open(factory = new IDBFactory()): Promise<{ store: CardStore; factory: IDBFactory }> {
  return { store: await openCardStore(factory), factory };
}

// 直接用瀏覽器的 IndexedDB 介面讀寫（繞過 store），用來造壞資料、檢查「資料庫真的沒變」。
function rawOpen(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rawPut(factory: IDBFactory, storeName: string, key: string, value: unknown): Promise<void> {
  const db = await rawOpen(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function rawGet(factory: IDBFactory, storeName: string, key: string): Promise<unknown> {
  const db = await rawOpen(factory);
  const value = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function rawKeys(factory: IDBFactory, storeName: string): Promise<string[]> {
  const db = await rawOpen(factory);
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return keys.map(String).sort();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- 資料庫 ----

describe('openCardStore：資料庫結構', () => {
  it('建立 holocard-studio 版本 1，有 cards／images／meta 三個 store', async () => {
    const { factory } = await open();
    const db = await rawOpen(factory);
    expect(db.name).toBe('holocard-studio');
    expect(db.version).toBe(1);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['cards', 'images', 'meta']);
    db.close();
  });

  it('同一個 factory 再開一次：之前存的卡、圖、設定都還在', async () => {
    const { store, factory } = await open();
    const card = cardWith('a', [1, 2]);
    await saveWithImages(store, card, [1, 2], png('縮圖'));
    await store.setMeta('lastOpenedId', 'a');

    const again = await openCardStore(factory);
    expect(await again.load('a')).toEqual(card);
    expect((await again.loadImage(hashOf(1)))?.hash).toBe(hashOf(1));
    expect(await again.getMeta('lastOpenedId')).toBe('a');
    expect((await again.list()).map((s) => s.id)).toEqual(['a']);
  });

  it('沒傳 factory 時用全域 indexedDB', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const store = await openCardStore();
    await store.setMeta('k', 'v');
    expect(await store.getMeta('k')).toBe('v');
  });

  it('瀏覽器沒有 IndexedDB → 丟出看得懂的錯，不是 undefined 錯誤', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(openCardStore()).rejects.toThrow(/IndexedDB/);
  });

  it('資料庫版本比程式新（降版本）→ 開啟失敗並 reject', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION + 1);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    await expect(openCardStore(factory)).rejects.toBeTruthy();
  });
});

// ---- 卡片 ----

describe('save／load', () => {
  it('存好再讀回一樣（含縮圖）', async () => {
    const { store } = await open();
    const card = cardWith('a', [1, 2]);
    await saveWithImages(store, card, [1, 2], png('縮圖 a'));

    expect(await store.load('a')).toEqual(card);
    const [summary] = await store.list();
    expect(summary.thumbnail).toBeInstanceOf(Blob);
    expect(await summary.thumbnail?.text()).toBe('縮圖 a');
    expect(summary.thumbnail?.type).toBe('image/png');
  });

  it('文字圖層存好再讀回一樣：直排、換行、表情符號、改過的字型顏色都在，text 還是剛好六個欄位', async () => {
    const { store } = await open();
    const text: TextSpec = { content: '第一行\n月夜 😀', font: 'huninn', color: '#c8322b', align: 'end', vertical: true, style: 'seal' };
    const card = cardWithText('t', text);
    await saveWithImages(store, card, [1, 2]);

    const back = await store.load('t');
    expect(back).toEqual(card);
    const layer = back!.front.layers.find((l) => l.id === 't-text')!;
    expect(layer.text).toEqual(text);
    expect(Object.keys(layer.text!).sort()).toEqual(['align', 'color', 'content', 'font', 'style', 'vertical']);
    expect(layer.name).toBe('第一行 月夜 😀');
  });

  it('改文字（新設定＋新圖）後再存、再讀：讀回來是改好的那張', async () => {
    const { store } = await open();
    const v1 = cardWithText('t', { content: '卡片名稱', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' });
    await saveWithImages(store, v1, [1, 2]);

    const newText: TextSpec = { content: '月夜', font: 'iansui', color: '#00aaff', align: 'start', vertical: true, style: 'plain' };
    await store.saveImage(image(4));
    const v2 = updateTextLayer(v1, 'front', 't-text', { text: newText, image: image(4).hash });
    expect(v2).not.toBe(v1);
    await store.save({ ...v2, updatedAt: '2026-10-14T00:00:00.000Z' });

    const back = await store.load('t');
    const layer = back!.front.layers.find((l) => l.id === 't-text')!;
    expect(layer.text).toEqual(newText);
    expect(layer.image).toBe(image(4).hash);
    expect(layer.name).toBe('月夜');
    expect(await store.list()).toHaveLength(1);
  });

  it('匯入的卡有大寫顏色：存什麼讀什麼（store 不整理資料）', async () => {
    const { store } = await open();
    const card = cardWithText('t', { content: '標題', font: 'wenkai', color: '#ABCDEF', align: 'center', vertical: false, style: 'outline' });
    // addTextLayer 會把顏色轉小寫；這裡直接改回大寫，模擬別的程式寫出來的卡片檔
    const imported = structuredClone(card);
    imported.front.layers.find((l) => l.id === 't-text')!.text!.color = '#ABCDEF';
    await saveWithImages(store, imported, [1, 2]);
    expect((await store.load('t'))?.front.layers.find((l) => l.id === 't-text')?.text?.color).toBe('#ABCDEF');
  });

  it('text: undefined（有欄位、值是 undefined）的圖層存不進去，錯誤指到 text，資料庫沒變；沒有文字的圖層不能留 text 欄位', async () => {
    const { store, factory } = await open();
    const card = cardWithText('t', { content: '標題', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' });
    await store.saveImage(image(1));
    await store.saveImage(image(2));
    const bad = structuredClone(card);
    bad.front.layers.find((l) => l.id === 't-text')!.text = undefined;
    await expect(store.save(bad)).rejects.toThrow(/text/);
    expect(await rawKeys(factory, 'cards')).toEqual([]);

    const noText = structuredClone(card);
    delete noText.front.layers.find((l) => l.id === 't-text')!.text; // 拿掉整個欄位＝一般立體層，才存得進去
    await store.save(noText);
    expect('text' in noText.front.layers[1]!).toBe(false);
    expect(await store.load('t')).toEqual(noText);
  });

  it('load 不存在的 id → undefined', async () => {
    const { store } = await open();
    expect(await store.load('不存在')).toBeUndefined();
  });

  it('覆蓋同一張卡：內容換成新的，不會變成兩張', async () => {
    const { store } = await open();
    const v1 = cardWith('a', [1]);
    await saveWithImages(store, v1, [1]);
    const v2 = { ...v1, name: '改過的名字', updatedAt: '2026-10-14T00:00:00.000Z' };
    await store.save(v2);

    expect((await store.load('a'))?.name).toBe('改過的名字');
    expect(await store.list()).toHaveLength(1);
  });

  it('thumbnail 沒給就保留舊的；給了就換成新的', async () => {
    const { store } = await open();
    const card = cardWith('a', [1]);
    await saveWithImages(store, card, [1], png('舊縮圖'));

    await store.save({ ...card, name: '第二版' });
    expect(await (await store.list())[0].thumbnail?.text()).toBe('舊縮圖');

    await store.save({ ...card, name: '第三版' }, png('新縮圖'));
    expect(await (await store.list())[0].thumbnail?.text()).toBe('新縮圖');
  });

  it('沒有縮圖的卡：list 的摘要沒有 thumbnail 欄位', async () => {
    const { store } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);
    const [summary] = await store.list();
    expect('thumbnail' in summary).toBe(false);
  });

  it('存壞卡被擋：丟錯、錯誤訊息有原因、資料庫沒變', async () => {
    const { store, factory } = await open();
    const bad = { ...cardWith('a', []), name: '' };
    await expect(store.save(bad)).rejects.toThrow(/name/);
    expect(await rawKeys(factory, 'cards')).toEqual([]);

    const nan = { ...cardWith('b', []), cornerRadius: Number.NaN };
    await expect(store.save(nan)).rejects.toThrow();
    await expect(store.save({ formatVersion: 2 } as unknown as Card)).rejects.toThrow();
    await expect(store.save(null as unknown as Card)).rejects.toThrow();
    expect(await rawKeys(factory, 'cards')).toEqual([]);
  });

  it('縮圖不是 Blob → 被擋、資料庫沒變', async () => {
    const { store, factory } = await open();
    const card = cardWith('a', []);
    await expect(store.save(card, 'x' as unknown as Blob)).rejects.toThrow(/縮圖/);
    expect(await rawKeys(factory, 'cards')).toEqual([]);
  });

  it('卡片用到還沒存的圖 → 被擋（呼叫端要先 saveImage）', async () => {
    const { store, factory } = await open();
    await expect(store.save(cardWith('a', [1]))).rejects.toThrow(/圖片/);
    expect(await rawKeys(factory, 'cards')).toEqual([]);
  });

  it('覆蓋時被擋：舊的那版原封不動', async () => {
    const { store } = await open();
    const good = cardWith('a', [1]);
    await saveWithImages(store, good, [1], png('縮圖'));

    await expect(store.save({ ...good, name: '', updatedAt: '2026-10-14T00:00:00.000Z' }, png('新縮圖'))).rejects.toThrow();

    expect(await store.load('a')).toEqual(good);
    expect(await (await store.list())[0].thumbnail?.text()).toBe('縮圖');
  });

  it('存進去的是快照：存完再改原物件，不影響資料庫裡的', async () => {
    const { store } = await open();
    const card = cardWith('a', [1]);
    await saveWithImages(store, card, [1]);
    card.name = '事後亂改';
    expect((await store.load('a'))?.name).toBe('未命名卡片');
  });

  it('資料壞掉的紀錄：load 回 undefined，不丟錯', async () => {
    const { store, factory } = await open();
    const good = cardWith('a', [1]);
    await saveWithImages(store, good, [1]);
    await rawPut(factory, 'cards', 'broken', { card: { ...good, id: 'broken', cornerRadius: 99 } });
    await rawPut(factory, 'cards', 'garbage', 'not an object');
    await rawPut(factory, 'cards', 'null', null);
    await rawPut(factory, 'cards', 'mismatch', { card: good }); // key 和 card.id 對不上

    expect(await store.load('broken')).toBeUndefined();
    expect(await store.load('garbage')).toBeUndefined();
    expect(await store.load('null')).toBeUndefined();
    expect(await store.load('mismatch')).toBeUndefined();
    expect(await store.load('a')).toEqual(good);
  });

  it('圖被弄丟的卡：load 回 undefined', async () => {
    const { store, factory } = await open();
    await rawPut(factory, 'cards', 'a', { card: cardWith('a', [1]) }); // 圖 1 從來沒存
    expect(await store.load('a')).toBeUndefined();
  });
});

describe('saveThumbnail：只更新縮圖，不重寫卡片（T-409）', () => {
  const T1 = '2026-10-14T01:00:00.000Z';

  it('版本（updatedAt）對得上才寫：回 true，縮圖換新，卡片內容一個位元組都不變', async () => {
    const { store, factory } = await open();
    const card = cardWith('a', [1], T1);
    await saveWithImages(store, card, [1], png('舊縮圖'));
    const before = JSON.stringify((await rawGet(factory, 'cards', 'a') as { card: unknown }).card);

    expect(await store.saveThumbnail('a', T1, png('新縮圖'))).toBe(true);

    const record = (await rawGet(factory, 'cards', 'a')) as { card: unknown; thumbnail: Blob };
    expect(JSON.stringify(record.card)).toBe(before);
    expect(await record.thumbnail.text()).toBe('新縮圖');
    expect(await store.load('a')).toEqual(card);
  });

  it('版本對不上（別的分頁已經存了新版）：回 false，什麼都不動', async () => {
    const { store, factory } = await open();
    const newer = { ...cardWith('a', [1], T1), name: '另一個分頁的新名字' };
    await saveWithImages(store, newer, [1], png('新版的縮圖'));
    const before = await rawGet(factory, 'cards', 'a');

    expect(await store.saveThumbnail('a', T0, png('舊版的縮圖'))).toBe(false);

    const after = (await rawGet(factory, 'cards', 'a')) as { card: Card; thumbnail: Blob };
    expect(after.card).toEqual((before as { card: Card }).card);
    expect(after.card.name).toBe('另一個分頁的新名字');
    expect(await after.thumbnail.text()).toBe('新版的縮圖');
  });

  it('卡不在了（被刪掉）：回 false，不會多出一張只有縮圖的卡', async () => {
    const { store, factory } = await open();
    expect(await store.saveThumbnail('gone', T0, png('x'))).toBe(false);
    expect(await rawKeys(factory, 'cards')).toEqual([]);
  });

  it('資料壞掉的紀錄：回 false、不動它', async () => {
    const { store, factory } = await open();
    await rawPut(factory, 'cards', 'garbage', 'not an object');
    await rawPut(factory, 'cards', 'no-card', { thumbnail: png('x') });
    expect(await store.saveThumbnail('garbage', T0, png('y'))).toBe(false);
    expect(await store.saveThumbnail('no-card', T0, png('y'))).toBe(false);
    expect(await rawGet(factory, 'cards', 'garbage')).toBe('not an object');
  });

  it('縮圖不是 Blob → 丟錯、資料庫沒變', async () => {
    const { store, factory } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1], png('舊縮圖'));
    await expect(store.saveThumbnail('a', T0, 'not a blob' as unknown as Blob)).rejects.toThrow();
    expect(await ((await rawGet(factory, 'cards', 'a')) as { thumbnail: Blob }).thumbnail.text()).toBe('舊縮圖');
  });

  // T-412 ⑥：兩個寫入同時送出、交易交錯。讀、比對、寫要在同一個交易，晚到的縮圖才不會把中間存進來的新版蓋回舊版
  it('晚到的舊版縮圖和新版存檔同時送出（縮圖先）：卡片是新版，不會被蓋回舊版', async () => {
    const { store } = await open();
    await saveWithImages(store, cardWith('a', [1], T0), [1], png('舊縮圖'));
    const newer = { ...cardWith('a', [1], T1), name: '新版' };
    const late = store.saveThumbnail('a', T0, png('晚到的舊版縮圖'));
    const save = store.save(newer);
    await Promise.all([late, save]);
    expect(await store.load('a')).toEqual(newer);
  });

  it('新版存檔先送出、晚到的舊版縮圖緊接著送出：縮圖不寫（回 false），新版和它的縮圖都不動', async () => {
    const { store } = await open();
    await saveWithImages(store, cardWith('a', [1], T0), [1], png('舊縮圖'));
    const newer = { ...cardWith('a', [1], T1), name: '新版' };
    const save = store.save(newer, png('新版的縮圖'));
    const late = store.saveThumbnail('a', T0, png('晚到的舊版縮圖'));
    expect((await Promise.all([save, late]))[1]).toBe(false);
    expect(await store.load('a')).toEqual(newer);
    const [summary] = await store.list();
    expect(await summary!.thumbnail!.text()).toBe('新版的縮圖');
  });

  it('同一版本的兩張縮圖同時送出：都寫得進去（後送的留著），卡片內容不變', async () => {
    const { store } = await open();
    const card = cardWith('a', [1], T1);
    await saveWithImages(store, card, [1]);
    const first = store.saveThumbnail('a', T1, png('第一張'));
    const second = store.saveThumbnail('a', T1, png('第二張'));
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(await store.load('a')).toEqual(card);
    const [summary] = await store.list();
    expect(await summary!.thumbnail!.text()).toBe('第二張');
  });
});

describe('list', () => {
  it('依 updatedAt 由新到舊（時區不同也照真正的時間比）', async () => {
    const { store } = await open();
    const stamps: Record<string, string> = {
      older: '2026-10-12T00:00:00.000Z',
      newest: '2026-10-14T08:00:00.000Z',
      // 這個字串照字母排比 newest 大，但換算成 UTC 其實是 10-14 01:00，比 newest（08:00）早
      tz: '2026-10-14T09:00:00+08:00',
    };
    for (const [id, updatedAt] of Object.entries(stamps)) {
      await store.save(cardWith(id, [], updatedAt));
    }
    expect((await store.list()).map((s) => s.id)).toEqual(['newest', 'tz', 'older']);
  });

  it('摘要欄位：id、name、aspect、createdAt、updatedAt', async () => {
    const { store } = await open();
    const card = { ...cardWith('a', []), name: '我的卡', aspect: 'tarot' as const, updatedAt: '2026-10-14T00:00:00.000Z' };
    await store.save(card);
    expect(await store.list()).toEqual([
      { id: 'a', name: '我的卡', aspect: 'tarot', createdAt: T0, updatedAt: '2026-10-14T00:00:00.000Z' },
    ]);
  });

  it('空資料庫 → 空陣列', async () => {
    const { store } = await open();
    expect(await store.list()).toEqual([]);
  });

  it('壞掉的紀錄略過，其他卡照常列出', async () => {
    const { store, factory } = await open();
    const good = cardWith('good', [1]);
    await saveWithImages(store, good, [1]);
    await rawPut(factory, 'cards', 'bad-field', { card: { ...good, id: 'bad-field', bodyColor: 'red' } });
    await rawPut(factory, 'cards', 'garbage', 42);
    await rawPut(factory, 'cards', 'no-card', { thumbnail: png('x') });
    await rawPut(factory, 'cards', 'mismatch', { card: good });
    await rawPut(factory, 'cards', 'lost-image', { card: cardWith('lost-image', [3]) }); // 圖 3 沒存

    expect((await store.list()).map((s) => s.id)).toEqual(['good']);
  });
});

describe('hasCards：有沒有任何一筆卡片紀錄（T-605c：和「有卡但讀不出來」分開）', () => {
  it('空資料庫 → false；有合格的卡 → true', async () => {
    const { store } = await open();
    expect(await store.hasCards()).toBe(false);
    await saveWithImages(store, cardWith('a', [1]), [1]);
    expect(await store.hasCards()).toBe(true);
  });

  it('紀錄全都讀不出來（缺圖、壞掉）也算有：list 是空的，hasCards 是 true', async () => {
    const { store, factory } = await open();
    await rawPut(factory, 'cards', 'lost-image', { card: cardWith('lost-image', [3]) }); // 圖 3 沒存
    await rawPut(factory, 'cards', 'garbage', 42);
    expect(await store.list()).toEqual([]);
    expect(await store.hasCards()).toBe(true);
  });

  it('刪光了 → false（meta 留著也一樣）', async () => {
    const { store } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);
    await store.setMeta('lastOpenedId', 'a');
    await store.remove('a');
    expect(await store.hasCards()).toBe(false);
  });
});

// ---- 圖片 ----

describe('saveImage／loadImage', () => {
  it('存好讀回一樣：含雜湊、內容、格式、長寬、透明', async () => {
    const { store } = await open();
    const img = image(2);
    await store.saveImage(img);

    const back = await store.loadImage(img.hash);
    expect(back).toMatchObject({ hash: img.hash, type: 'image/webp', width: 64, height: 96, hasAlpha: true });
    expect(await back?.blob.text()).toBe('img-2');
    expect(back?.blob.type).toBe('image/webp');
  });

  it('沒有的圖 → undefined', async () => {
    const { store } = await open();
    expect(await store.loadImage(hashOf(9))).toBeUndefined();
  });

  it('同雜湊只存一份：第二次不重寫（舊內容留著）', async () => {
    const { store, factory } = await open();
    await store.saveImage(image(2, '第一次'));
    await store.saveImage(image(2, '第二次'));
    await store.saveImage(image(2, '第三次'));

    expect(await rawKeys(factory, 'images')).toEqual([hashOf(2)]);
    expect(await (await store.loadImage(hashOf(2)))?.blob.text()).toBe('第一次');
  });

  it('壞資料不寫進去：雜湊格式不對、不是 Blob、格式或長寬不合理', async () => {
    const { store, factory } = await open();
    const good = image(2);
    const bad: StoredImage[] = [
      { ...good, hash: 'ABC' },
      { ...good, hash: '../../etc/passwd' },
      { ...good, blob: 'x' as unknown as Blob },
      { ...good, type: 'image/svg+xml' as unknown as StoredImage['type'] },
      { ...good, width: 0 },
      { ...good, height: Number.NaN },
      { ...good, hasAlpha: 'yes' as unknown as boolean },
    ];
    for (const img of bad) await expect(store.saveImage(img)).rejects.toThrow();
    expect(await rawKeys(factory, 'images')).toEqual([]);
  });

  it('資料庫裡形狀不對的圖紀錄 → loadImage 回 undefined', async () => {
    const { store, factory } = await open();
    await rawPut(factory, 'images', hashOf(5), { blob: 'not a blob', type: 'image/webp', width: 1, height: 1, hasAlpha: false });
    await rawPut(factory, 'images', hashOf(6), 'garbage');
    expect(await store.loadImage(hashOf(5))).toBeUndefined();
    expect(await store.loadImage(hashOf(6))).toBeUndefined();
  });
});

// ---- 刪卡與清圖 ----

describe('remove', () => {
  it('刪卡：卡不見了，其他卡不受影響', async () => {
    const { store } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);
    await saveWithImages(store, cardWith('b', [3]), [3]);

    await store.remove('a');

    expect(await store.load('a')).toBeUndefined();
    expect((await store.list()).map((s) => s.id)).toEqual(['b']);
    expect(await store.load('b')).not.toBeUndefined();
  });

  it('共用的圖還在、只有這張卡用的圖被清掉', async () => {
    const { store, factory } = await open();
    // 圖 1 兩張卡共用；圖 2 只有 a 用；圖 4 只有 b 用
    const a = cardWith('a', [1, 2]);
    const b = cardWith('b', [1, 4]);
    await store.saveImage(image(1));
    await store.saveImage(image(2));
    await store.saveImage(image(4));
    await store.save(a);
    await store.save(b);

    await store.remove('a');

    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1), hashOf(4)]);
    expect(await store.load('b')).toEqual(b); // b 還打得開（圖都在）
    expect(await store.loadImage(hashOf(1))).not.toBeUndefined();
    expect(await store.loadImage(hashOf(2))).toBeUndefined();

    await store.remove('b');
    expect(await rawKeys(factory, 'images')).toEqual([]);
  });

  it('正面和背面都用同一張圖，也只算一張、不會出錯', async () => {
    const { store, factory } = await open();
    let card = cardWith('a', [2]);
    const back = addLayer(card, 'back', {
      id: 'a-back',
      name: '背面',
      image: hashOf(2),
      hasAlpha: true,
      width: 64,
      height: 96,
    });
    if (!back.ok) throw new Error(back.reason);
    card = back.card;
    await saveWithImages(store, card, [2]);

    await store.remove('a');
    expect(await rawKeys(factory, 'images')).toEqual([]);
    expect(await rawKeys(factory, 'cards')).toEqual([]);
  });

  it('只清這張卡用過的圖：本來就沒人用的孤兒圖留著（那是啟動時 cleanupImages 的事）', async () => {
    const { store, factory } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);
    await store.saveImage(image(7)); // 孤兒

    await store.remove('a');

    expect(await rawKeys(factory, 'images')).toEqual([hashOf(7)]);
  });

  it('刪不存在的卡：不丟錯、什麼都不動', async () => {
    const { store, factory } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);
    await store.remove('不存在');
    expect(await rawKeys(factory, 'cards')).toEqual(['a']);
    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1)]);
  });

  it('壞掉的紀錄用到的圖也算「有人用」：刪別張卡時不會被誤清', async () => {
    const { store, factory } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);
    // b 這筆資料有問題（顏色壞掉），但它指著圖 1：圖 1 先留著，不替使用者做主丟掉
    await rawPut(factory, 'cards', 'b', { card: { ...cardWith('b', [1]), bodyColor: 'red' } });

    await store.remove('a');

    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1)]);
  });
});

describe('cleanupImages', () => {
  it('刪掉沒有任何卡片用到的圖，回傳刪了幾張；被用到的留著', async () => {
    const { store, factory } = await open();
    await saveWithImages(store, cardWith('a', [1, 2]), [1, 2]);
    await store.saveImage(image(5));
    await store.saveImage(image(6));
    await store.saveImage(image(8));

    expect(await store.cleanupImages()).toBe(3);
    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1), hashOf(2)]);
    expect(await store.cleanupImages()).toBe(0);
  });

  it('沒有任何圖／卡 → 回傳 0', async () => {
    const { store } = await open();
    expect(await store.cleanupImages()).toBe(0);
  });

  it('沒有任何卡片時，所有圖都算沒人用', async () => {
    const { store, factory } = await open();
    await store.saveImage(image(1));
    await store.saveImage(image(2));
    expect(await store.cleanupImages()).toBe(2);
    expect(await rawKeys(factory, 'images')).toEqual([]);
  });

  it('存檔時不清圖：卡改掉不再用某張圖，那張圖仍在，直到 cleanupImages', async () => {
    const { store, factory } = await open();
    const v1 = cardWith('a', [1, 2]);
    await saveWithImages(store, v1, [1, 2]);
    const v2 = cardWith('a', [1]); // 拿掉圖 2（復原堆疊可能還指著它）
    await store.save(v2);

    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1), hashOf(2)]);
    expect(await store.cleanupImages()).toBe(1);
    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1)]);
  });
});

// ---- 設定 ----

describe('getMeta／setMeta', () => {
  it('沒設過 → undefined；設了讀得回；再設會覆蓋', async () => {
    const { store } = await open();
    expect(await store.getMeta('lastOpenedId')).toBeUndefined();
    await store.setMeta('lastOpenedId', 'a');
    expect(await store.getMeta('lastOpenedId')).toBe('a');
    await store.setMeta('lastOpenedId', 'b');
    expect(await store.getMeta('lastOpenedId')).toBe('b');
    expect(await store.getMeta('other')).toBeUndefined();
  });

  it('空字串也是合法的值', async () => {
    const { store } = await open();
    await store.setMeta('k', '');
    expect(await store.getMeta('k')).toBe('');
  });

  it('資料庫裡不是字串的值 → 當作沒有', async () => {
    const { store, factory } = await open();
    await rawPut(factory, 'meta', 'weird', { evil: true });
    expect(await store.getMeta('weird')).toBeUndefined();
  });
});

describe('updateMeta：原子地改一筆 meta（T-829c）', () => {
  /** 在 JSON 物件裡加一個鍵（舊值壞掉當成空的）。 */
  const addKey = (name: string) => (old: string | undefined) => {
    let value: Record<string, number> = {};
    try {
      value = JSON.parse(old ?? '{}') as Record<string, number>;
    } catch {
      // 壞值當沒有
    }
    return JSON.stringify({ ...value, [name]: 1 });
  };

  it('讀舊值 → 寫新值；沒設過、不是字串的舊值給 undefined', async () => {
    const { store, factory } = await open();
    const seen: (string | undefined)[] = [];
    await store.updateMeta('k', (old) => (seen.push(old), 'a'));
    await store.updateMeta('k', (old) => (seen.push(old), `${old}b`));
    await rawPut(factory, 'meta', 'weird', { evil: true });
    await store.updateMeta('weird', (old) => (seen.push(old), 'fixed'));
    expect(seen).toEqual([undefined, 'a', undefined]);
    expect(await store.getMeta('k')).toBe('ab');
    expect(await store.getMeta('weird')).toBe('fixed');
  });

  it('同時改同一個 key 很多次：一個一個來，每一次的改動都留著（分開讀寫會互相蓋掉）', async () => {
    const { store } = await open();
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    await Promise.all(names.map((name) => store.updateMeta('samplesAdded', addKey(name))));
    expect(Object.keys(JSON.parse((await store.getMeta('samplesAdded'))!) as object).sort()).toEqual(names);
  });

  it('update 丟錯：什麼都不寫、錯丟出去', async () => {
    const { store } = await open();
    await store.setMeta('k', '原本的');
    await expect(
      store.updateMeta('k', () => {
        throw new Error('算不出來');
      }),
    ).rejects.toThrow('算不出來');
    expect(await store.getMeta('k')).toBe('原本的');
  });
});

// ---- 容量 ----

describe('estimate', () => {
  it('瀏覽器沒有 navigator.storage → null', async () => {
    vi.stubGlobal('navigator', {});
    const { store } = await open();
    expect(await store.estimate()).toBeNull();
  });

  it('完全沒有 navigator → null', async () => {
    vi.stubGlobal('navigator', undefined);
    const { store } = await open();
    expect(await store.estimate()).toBeNull();
  });

  it('有 navigator.storage.estimate → 回 usage 和 quota', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1234, quota: 5000, extra: 'x' }) } });
    const { store } = await open();
    expect(await store.estimate()).toEqual({ usage: 1234, quota: 5000 });
  });

  it('estimate 丟錯或回傳怪東西 → null，不丟錯', async () => {
    const { store } = await open();
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => {
          throw new Error('不給查');
        },
      },
    });
    expect(await store.estimate()).toBeNull();

    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } });
    expect(await store.estimate()).toBeNull();
  });
});

// ---- 交易出錯 ----

describe('交易出錯要 reject，不能吞掉', () => {
  it('寫入途中交易被中止（例如空間不夠）→ save reject，而且什麼都沒存', async () => {
    const { store, factory } = await open();
    const card = cardWith('a', [1]);
    await store.saveImage(image(1));

    const realPut = FakeObjectStore.prototype.put;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = realPut.apply(this, args);
      this.transaction.abort(); // 模擬寫到一半失敗
      return request;
    });

    await expect(store.save(card)).rejects.toBeTruthy();
    await expect(store.setMeta('k', 'v')).rejects.toBeTruthy();
    await expect(store.saveImage(image(3))).rejects.toBeTruthy();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
    expect(await rawKeys(factory, 'cards')).toEqual([]);
    expect(await rawKeys(factory, 'meta')).toEqual([]);
    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1)]);
  });

  it('所有要求都成功了、提交時才失敗（交易被中止）→ 一樣 reject', async () => {
    const { store, factory } = await open();
    await store.saveImage(image(1));

    const realPut = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = realPut.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort()); // put 本身成功，之後才中止
      return request;
    });

    await expect(store.save(cardWith('a', [1]))).rejects.toBeTruthy();
    await expect(store.setMeta('k', 'v')).rejects.toBeTruthy();
    await expect(store.saveImage(image(3))).rejects.toBeTruthy();

    vi.restoreAllMocks();
    expect(await rawKeys(factory, 'cards')).toEqual([]);
    expect(await rawKeys(factory, 'meta')).toEqual([]);
    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1)]);
  });

  it('刪卡途中交易被中止 → remove reject，卡和圖都還在', async () => {
    const { store, factory } = await open();
    await saveWithImages(store, cardWith('a', [1]), [1]);

    const realDelete = FakeObjectStore.prototype.delete;
    vi.spyOn(FakeObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = realDelete.apply(this, args);
      this.transaction.abort();
      return request;
    });

    await expect(store.remove('a')).rejects.toBeTruthy();
    vi.restoreAllMocks();
    expect(await rawKeys(factory, 'cards')).toEqual(['a']);
    expect(await rawKeys(factory, 'images')).toEqual([hashOf(1)]);
  });
});
