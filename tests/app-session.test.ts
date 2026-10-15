import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LAST_OPENED_KEY } from '../src/app/autosave';
import { createSession, type SessionDeps } from '../src/app/session';
import type { ImportHolocard } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import type { CardStore } from '../src/storage/types';

// ---- 小工具 ----

const T0 = '2026-10-13T00:00:00.000Z';
const T1 = '2026-10-13T01:00:00.000Z';
const T2 = '2026-10-13T02:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

function cardWith(id: string, imageNumbers: number[], updatedAt = T0): Card {
  let card = newCard('standard', id, T0);
  imageNumbers.forEach((n, i) => {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${i}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  });
  return { ...card, updatedAt };
}

async function seed(store: CardStore, card: Card, thumbnail?: Blob): Promise<void> {
  for (const l of [...card.front.layers, ...card.back.layers]) await store.saveImage(image(parseInt(l.image, 16)));
  await store.save(card, thumbnail);
}

const freshStore = () => openCardStore(new IDBFactory());

/** 假的組裝端：記憶體裡的圖片登記簿、目前的卡、畫面顯示過哪些卡。 */
function harness(store: CardStore | null, overrides: Partial<SessionDeps> = {}) {
  const registry = new Map<string, StoredImage>();
  const state = { current: null as Card | null, shown: [] as Card[], thumbnails: 0 };
  const session = createSession({
    store,
    images: {
      add: async (img) => {
        registry.set(img.hash, img);
      },
      get: (h) => registry.get(h),
      retain: (keep) => {
        for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
      },
    },
    current: () => state.current,
    show: (card) => {
      state.current = card;
      state.shown.push(card);
    },
    thumbnail: async () => {
      state.thumbnails++;
      return new Blob([`thumb-${state.current?.id}`], { type: 'image/png' });
    },
    settle: async () => {},
    onStatus: () => {},
    onStorageLow: () => {},
    ...overrides,
  });
  return { session, registry, state };
}

/** 開著 card（已存）並在記憶體裡把它改了一下（還沒存）。 */
async function openAndEdit(store: CardStore, card: Card) {
  await seed(store, card);
  const h = harness(store);
  const choice = await h.session.chooseStart();
  await h.session.openStart(choice!.card);
  h.state.current = updateCard(h.state.current!, { name: '記憶體裡改過的' });
  return h;
}

// ---- 開啟工坊（DESIGN 7.4） ----

/** 直接刪掉資料庫裡的一張圖（模擬存檔壞掉：卡片紀錄還在，但缺圖，儲存層的 list／load 會略過它）。 */
async function deleteRawImage(factory: IDBFactory, hash: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open('holocard-studio', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').delete(hash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('開啟工坊：有卡但一張都讀不出來，不是第一次使用（T-605c）', () => {
  it('卡片紀錄還在但缺圖（list 是空的）→ 丟錯（組裝端當成讀不到存檔），不會被當成第一次使用、再匯入範例', async () => {
    const factory = new IDBFactory();
    const store = await openCardStore(factory);
    await seed(store, cardWith('a', [1]));
    await deleteRawImage(factory, hashOf(1));
    expect(await store.list()).toEqual([]);
    await expect(harness(store).session.chooseStart()).rejects.toThrow();
  });

  it('卡真的都刪光了（上次編輯的卡還記著）→ 還是 null：卡片庫是空的', async () => {
    const store = await freshStore();
    await seed(store, cardWith('a', [1]));
    await store.setMeta(LAST_OPENED_KEY, 'a');
    await store.remove('a');
    expect(await harness(store).session.chooseStart()).toBeNull();
  });

  it('清單裡有卡、但每一張都讀不出來 → 也丟錯', async () => {
    const store = await freshStore();
    await seed(store, cardWith('a', [1]));
    const broken: CardStore = { ...store, load: async () => undefined };
    await expect(harness(broken).session.chooseStart()).rejects.toThrow();
  });

  it('真的沒有任何卡、也沒用過（沒有上次編輯的卡）→ null（第一次使用）', async () => {
    expect(await harness(await freshStore()).session.chooseStart()).toBeNull();
  });

  it('接手後重新讀（reload）碰到同樣的情況 → unreadable（給不存進去的空白卡），不是 empty', async () => {
    const factory = new IDBFactory();
    const store = await openCardStore(factory);
    await seed(store, cardWith('a', [1]));
    await deleteRawImage(factory, hashOf(1));
    const h = harness(store);
    const outcome = await h.session.reload(() => newCard('standard', 'blank', T2), { newId: () => 'x', now: () => T2 });
    expect(outcome.result).toBe('unreadable');
    expect(await store.load('blank')).toBeUndefined();
  });
});

describe('資料流交給畫面之前改的卡也會存（T-605c：第一次開啟時，第一張開好、其他範例還在讀）', () => {
  it('開好之後、saveIfChanged 之前改了（組裝端那時還沒排存檔）→ saveIfChanged 補排存檔，存檔是最新版、狀態不會一直說已儲存', async () => {
    const store = await freshStore();
    const statuses: string[] = [];
    const h = harness(store, { onStatus: (s) => void statuses.push(s) });
    expect(await h.session.adopt(cardWith('first', [1]), [image(1)])).toBe('opened');
    // 組裝端還沒把資料流交給畫面：改了卡、但沒有呼叫 saver.changed
    h.state.current = updateCard(h.state.current!, { name: '開卡途中改的' });
    expect(h.session.saver.isSaved(h.state.current)).toBe(false);
    expect((await store.load('first'))!.name).not.toBe('開卡途中改的');
    h.session.saveIfChanged();
    expect(h.session.saver.status()).toBe('saving');
    await h.session.saver.flush();
    expect((await store.load('first'))!.name).toBe('開卡途中改的');
    expect(h.session.saver.status()).toBe('saved');
  });

  it('沒改過：saveIfChanged 什麼都不做（不顯示儲存中、不寫存檔）', async () => {
    const store = await freshStore();
    const saves: string[] = [];
    const counting: CardStore = { ...store, save: async (card, thumb) => void (saves.push(card.id), await store.save(card, thumb)) };
    const h = harness(counting);
    await h.session.adopt(cardWith('first', [1]), [image(1)]);
    saves.length = 0;
    h.session.saveIfChanged();
    expect(h.session.saver.status()).toBe('saved');
    await h.session.saver.flush();
    expect(saves).toEqual([]);
  });
});

describe('開啟工坊：要開哪張卡', () => {
  it('卡片庫是空的 → null（由組裝端建立第一張範例卡的副本）', async () => {
    const h = harness(await freshStore());
    expect(await h.session.chooseStart()).toBeNull();
  });

  it('有 lastOpenedId → 開那張（附上存好的縮圖，3D 好之前先顯示）', async () => {
    const store = await freshStore();
    const thumb = new Blob(['a-thumb'], { type: 'image/png' });
    await seed(store, cardWith('a', [1], T1), thumb);
    await seed(store, cardWith('b', [3], T2));
    await store.setMeta(LAST_OPENED_KEY, 'a');
    const choice = await harness(store).session.chooseStart();
    expect(choice!.card.id).toBe('a');
    expect(await choice!.thumbnail!.text()).toBe('a-thumb');
  });

  it('lastOpenedId 指到的卡不見了 → 開最近編輯的那張', async () => {
    const store = await freshStore();
    await seed(store, cardWith('old', [1], T1));
    await seed(store, cardWith('recent', [3], T2));
    await store.setMeta(LAST_OPENED_KEY, 'deleted');
    expect((await harness(store).session.chooseStart())!.card.id).toBe('recent');
  });

  it('啟動時清一次沒人用的圖（cleanupImages）', async () => {
    const store = await freshStore();
    await seed(store, cardWith('a', [1]));
    await store.saveImage(image(5)); // 沒有卡用它
    await harness(store).session.chooseStart();
    expect(await store.loadImage(hashOf(5))).toBeUndefined();
    expect(await store.loadImage(hashOf(1))).toBeDefined();
  });

  it('openStart：圖從存檔載入登記簿、顯示、記成已儲存、更新 lastOpenedId', async () => {
    const store = await freshStore();
    await seed(store, cardWith('a', [1, 2], T1));
    const h = harness(store);
    const choice = await h.session.chooseStart();
    await h.session.openStart(choice!.card);
    expect(h.state.current).toEqual(cardWith('a', [1, 2], T1));
    expect([...h.registry.keys()].sort()).toEqual([hashOf(1), hashOf(2)]);
    expect(h.session.saver.isSaved(h.state.current)).toBe(true);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('a');
  });

  it('openStart：存檔裡缺圖 → 丟錯（組裝端改開空白卡）', async () => {
    const store = await freshStore();
    await seed(store, cardWith('a', [1]));
    const broken: CardStore = { ...store, loadImage: async () => undefined };
    const h = harness(broken);
    const choice = await h.session.chooseStart();
    await expect(h.session.openStart(choice!.card)).rejects.toThrow();
    expect(h.state.current).toBeNull();
  });
});

// ---- 新卡（空白卡、範例副本） ----

describe('存進卡片庫但不打開（T-605b：第一次開啟時其他的範例）', () => {
  it('圖先存、再存卡；不換卡、不改 lastOpenedId；開著的那張不受影響', async () => {
    const store = await freshStore();
    const h = harness(store);
    expect(await h.session.adopt(cardWith('first', [1]), [image(1)])).toBe('opened');
    expect(await h.session.addToLibrary(cardWith('second', [2, 3], T1), [image(2), image(3)])).toBe(true);
    expect(h.state.current!.id).toBe('first');
    expect(h.state.shown.map((c) => c.id)).toEqual(['first']);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('first');
    expect((await store.load('second'))!.id).toBe('second');
    expect(await store.loadImage(hashOf(2))).toBeDefined();
    expect(await store.loadImage(hashOf(3))).toBeDefined();
    // 圖不放進登記簿（沒打開，不用解碼）
    expect(h.registry.has(hashOf(2))).toBe(false);
    expect((await store.list()).map((c) => c.id).sort()).toEqual(['first', 'second']);
  });

  it('可以帶縮圖一起存（範例卡片檔裡的 preview.png，T-808 驗收時發現）', async () => {
    const store = await freshStore();
    const h = harness(store);
    expect(await h.session.adopt(cardWith('first', [1]), [image(1)])).toBe('opened');
    const thumb = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await h.session.addToLibrary(cardWith('second', [2], T1), [image(2)], thumb)).toBe(true);
    const summary = (await store.list()).find((s) => s.id === 'second')!;
    expect(summary.thumbnail).toBeInstanceOf(Blob);
    expect(summary.thumbnail!.size).toBe(3);
  });

  it('存不進去（缺圖、存檔出錯、存檔不能用）→ false，卡片沒存進去（多存的圖下次啟動清掉）', async () => {
    const store = await freshStore();
    const h = harness(store);
    // 卡用到的圖沒給：store.save 用真的圖片清單驗，不合格
    expect(await h.session.addToLibrary(cardWith('broken', [4]), [])).toBe(false);
    expect(await store.load('broken')).toBeUndefined();
    const failing: CardStore = { ...store, save: async () => Promise.reject(new Error('disk full')) };
    expect(await harness(failing).session.addToLibrary(cardWith('x', [5]), [image(5)])).toBe(false);
    expect(await harness(null).session.addToLibrary(cardWith('y', [6]), [image(6)])).toBe(false);
  });
});

describe('開新卡不會讓舊卡不見', () => {
  it('第一次使用：範例副本存進卡片庫並打開', async () => {
    const store = await freshStore();
    const h = harness(store);
    expect(await h.session.adopt(cardWith('sample-copy', [1, 2]), [image(1), image(2)])).toBe('opened');
    expect(h.state.current!.id).toBe('sample-copy');
    expect((await store.load('sample-copy'))!.id).toBe('sample-copy');
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('sample-copy');
  });

  it('開空白新卡：舊卡（含記憶體裡最新的改動與縮圖）先存好、新卡也馬上存進卡片庫', async () => {
    const store = await freshStore();
    const h = await openAndEdit(store, cardWith('old', [1, 2]));
    const blank = newCard('tarot', 'new', T2);
    expect(await h.session.adopt(blank, [])).toBe('opened');
    expect(h.state.current).toBe(blank);
    expect((await store.load('old'))!.name).toBe('記憶體裡改過的');
    expect((await store.list()).find((c) => c.id === 'old')!.thumbnail).toBeInstanceOf(Blob);
    expect(await store.load('new')).toEqual(blank);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('new');
    // 舊卡的圖不在登記簿了（換卡釋放），但存檔裡還在
    expect(h.registry.size).toBe(0);
    expect(await store.loadImage(hashOf(1))).toBeDefined();
  });

  it('舊卡存不起來：不換卡（記憶體裡的舊卡原封不動），新卡也不存', async () => {
    const store = await freshStore();
    await seed(store, cardWith('old', [1]));
    const failing: CardStore = { ...store, save: async () => Promise.reject(new Error('磁碟滿了')) };
    const h = harness(failing);
    await h.session.openStart((await h.session.chooseStart())!.card);
    const edited = updateCard(h.state.current!, { name: '沒存到的改動' });
    h.state.current = edited;
    expect(await h.session.adopt(newCard('standard', 'new', T2), [])).toBe('not-saved');
    expect(h.state.current).toBe(edited);
    expect(await store.load('new')).toBeUndefined();
    expect(h.session.saver.status()).toBe('error');
  });

  it('新卡本身存不進去（舊卡已存好）：照樣打開，狀態是沒存到，之後自動重試', async () => {
    const store = await freshStore();
    await seed(store, cardWith('old', [1]));
    let refuseNew = true;
    const picky: CardStore = { ...store, save: (card, thumb) => (refuseNew && card.id === 'new' ? Promise.reject(new Error('滿了')) : store.save(card, thumb)) };
    const h = harness(picky);
    await h.session.openStart((await h.session.chooseStart())!.card);
    expect(await h.session.adopt(newCard('standard', 'new', T2), [])).toBe('opened');
    expect(h.state.current!.id).toBe('new');
    expect(h.session.saver.status()).toBe('error');
    refuseNew = false;
    expect(await h.session.saver.flush()).toBe(true);
    expect((await store.load('new'))!.id).toBe('new');
  });
});

// ---- 切換卡片（給 T-407） ----

describe('切換卡片', () => {
  it('先存好目前這張（含縮圖）→ 載入另一張與它的圖 → 只留新卡的圖', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3, 4], T0));
    const h = await openAndEdit(store, cardWith('cur', [1, 2], T1));
    expect(await h.session.open('other')).toBe('opened');
    expect(h.state.current!.id).toBe('other');
    expect([...h.registry.keys()].sort()).toEqual([hashOf(3), hashOf(4)]);
    expect((await store.load('cur'))!.name).toBe('記憶體裡改過的');
    expect((await store.list()).find((c) => c.id === 'cur')!.thumbnail).toBeInstanceOf(Blob);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('other');
    expect(h.session.saver.isSaved(h.state.current)).toBe(true);
  });

  it('開的就是目前這張：什麼都不做', async () => {
    const store = await freshStore();
    const h = await openAndEdit(store, cardWith('cur', [1]));
    const shown = h.state.shown.length;
    expect(await h.session.open('cur')).toBe('opened');
    expect(h.state.shown.length).toBe(shown);
  });

  it('那張卡不存在（或壞掉）：missing，目前這張不動', async () => {
    const store = await freshStore();
    const h = await openAndEdit(store, cardWith('cur', [1]));
    const before = h.state.current;
    expect(await h.session.open('nope')).toBe('missing');
    expect(h.state.current).toBe(before);
    expect(h.registry.has(hashOf(1))).toBe(true);
  });

  it('目前這張存不起來：not-saved，不換、不丟', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3]));
    await seed(store, cardWith('cur', [1], T2));
    const failing: CardStore = { ...store, save: async () => Promise.reject(new Error('磁碟滿了')) };
    const h = harness(failing);
    await h.session.openStart((await h.session.chooseStart())!.card);
    const edited = updateCard(h.state.current!, { name: '還沒存' });
    h.state.current = edited;
    expect(await h.session.open('other')).toBe('not-saved');
    expect(h.state.current).toBe(edited);
  });

  it('連續快速切換：依序完成，最後停在最後一張', async () => {
    const store = await freshStore();
    await seed(store, cardWith('b', [3]));
    await seed(store, cardWith('c', [5]));
    const h = await openAndEdit(store, cardWith('a', [1], T2));
    const results = await Promise.all([h.session.open('b'), h.session.open('c')]);
    expect(results).toEqual(['opened', 'opened']);
    expect(h.state.current!.id).toBe('c');
    expect([...h.registry.keys()]).toEqual([hashOf(5)]);
  });

  it('換卡前先等進行中的上傳／畫字做完', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3]));
    await seed(store, cardWith('cur', [1], T2));
    const order: string[] = [];
    const h = harness(store, {
      settle: async () => {
        order.push('settled');
      },
    });
    await h.session.openStart((await h.session.chooseStart())!.card);
    await h.session.open('other');
    expect(order).toEqual(['settled']);
  });
});

// ---- 匯入（DESIGN 7.5） ----

describe('匯入卡片檔', () => {
  const imported = cardWith('imported-id', [5, 6]);
  const okImporter: ImportHolocard = async (_file, opts) => ({
    ok: true,
    card: { ...imported, id: opts.newId(), createdAt: opts.now(), updatedAt: opts.now() },
    images: [image(5), image(6)],
  });
  const ids = { newId: () => 'fresh-id', now: () => T2 };

  it('成功：每張圖存進去 → 卡片存進去 → 打開它', async () => {
    const store = await freshStore();
    const h = await openAndEdit(store, cardWith('cur', [1]));
    const outcome = await h.session.importFile(new Blob(['zip']), okImporter, ids);
    expect(outcome).toMatchObject({ ok: true, result: 'opened' });
    expect(h.state.current!.id).toBe('fresh-id');
    expect((await store.load('fresh-id'))!.createdAt).toBe(T2);
    expect(await store.loadImage(hashOf(5))).toBeDefined();
    expect((await store.load('cur'))!.name).toBe('記憶體裡改過的');
  });

  it('失敗：回原因、卡片庫與目前的卡都不動', async () => {
    const store = await freshStore();
    const h = await openAndEdit(store, cardWith('cur', [1]));
    const before = h.state.current;
    const outcome = await h.session.importFile(new Blob(['not a zip']), async () => ({ ok: false, reason: 'bad-zip' }), ids);
    expect(outcome).toEqual({ ok: false, reason: 'bad-zip' });
    expect(h.state.current).toBe(before);
    expect((await store.list()).map((c) => c.id)).toEqual(['cur']);
  });

  it('檢查程式自己出錯（丟例外）：當成壞掉的卡片檔', async () => {
    const store = await freshStore();
    const h = harness(store);
    const outcome = await h.session.importFile(new Blob(['x']), async () => Promise.reject(new Error('bug')), ids);
    expect(outcome).toEqual({ ok: false, reason: 'invalid-card' });
  });
});

// ---- 卡片庫清單、刪除（給 T-407） ----

describe('卡片庫清單與刪除', () => {
  it('list：依最近編輯排序；存檔不能用 → 空清單', async () => {
    const store = await freshStore();
    await seed(store, cardWith('old', [1], T0));
    await seed(store, cardWith('new', [3], T2));
    expect((await harness(store).session.list()).map((c) => c.id)).toEqual(['new', 'old']);
    expect(await harness(null).session.list()).toEqual([]);
  });

  it('remove：開著的那張不能刪（要先開別張）；別張刪掉', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3]));
    const h = await openAndEdit(store, cardWith('cur', [1], T2));
    expect(await h.session.remove('cur')).toBe('is-open');
    expect(await h.session.remove('other')).toBe('removed');
    expect(await store.load('other')).toBeUndefined();
    expect(await store.load('cur')).toBeDefined();
  });
});

describe('存檔不能用（瀏覽器不給 IndexedDB）', () => {
  it('新卡：照樣打開（只在記憶體），狀態是沒存到', async () => {
    const h = harness(null);
    expect(await h.session.adopt(newCard('standard', 'mem', T0), [])).toBe('opened');
    expect(h.state.current!.id).toBe('mem');
    expect(h.session.saver.status()).toBe('error');
  });

  it('再開新卡也照樣換（反正什麼都存不了；擋住的話就永遠開不了新卡）', async () => {
    const h = harness(null);
    await h.session.adopt(newCard('standard', 'mem1', T0), []);
    expect(await h.session.adopt(newCard('standard', 'mem2', T0), [])).toBe('opened');
    expect(h.state.current!.id).toBe('mem2');
  });
});
