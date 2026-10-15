// T-409：T-404 審查找到的資料安全問題（審查員的重現測試搬進來改寫）＋換卡時序的保護。
// 原則（DESIGN §7）：東西永遠不會不見——舊版不能蓋掉新版、換卡前一定存到最新版、解不開的卡不留在卡片庫。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutoSaver, LAST_OPENED_KEY, THUMBNAIL_IDLE_MS, THUMBNAIL_TIMEOUT_MS } from '../src/app/autosave';
import { createSession, type SessionDeps } from '../src/app/session';
import { guardWrites } from '../src/app/tab-lock';
import type { ImportHolocard } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import type { CardStore } from '../src/storage/types';

const T0 = '2026-10-13T00:00:00.000Z';
const T2 = '2026-10-13T02:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

function cardWith(id: string, nums: number[], updatedAt = T0): Card {
  let card = newCard('standard', id, T0);
  nums.forEach((n, i) => {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${i}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  });
  return { ...card, updatedAt };
}

async function seed(store: CardStore, card: Card, thumb?: Blob) {
  for (const l of [...card.front.layers, ...card.back.layers]) await store.saveImage(image(parseInt(l.image, 16)));
  await store.save(card, thumb);
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** 讓排著的 promise 都跑一輪（fake-indexeddb 的要求是用 setImmediate／setTimeout 排的）。 */
const tick = () => new Promise((r) => setTimeout(r, 15));

function harness(store: CardStore | null, overrides: Partial<SessionDeps> = {}) {
  const registry = new Map<string, StoredImage>();
  const state = { current: null as Card | null, shown: [] as Card[] };
  const session = createSession({
    store,
    images: {
      add: async (img) => void registry.set(img.hash, img),
      get: (h) => registry.get(h),
      retain: (keep) => {
        for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
      },
    },
    current: () => state.current,
    show: (c) => {
      state.current = c;
      state.shown.push(c);
    },
    thumbnail: async () => new Blob([`thumb-${state.current?.id}-${state.current?.name}`], { type: 'image/webp' }),
    settle: async () => {},
    onStatus: () => {},
    onStorageLow: () => {},
    ...overrides,
  });
  return { session, registry, state };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---- ① 只補縮圖不能把整張卡寫回去 ----

describe('R1 只補縮圖：只寫縮圖，不重寫卡片', () => {
  it('卡片早就存好、縮圖等太久沒拿到：什麼都不寫（不再整張卡重寫一次）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const writes: string[] = [];
    const current: Card = cardWith('c1', [1]);
    const saver = createAutoSaver({
      store: {
        save: async (c, t) => void writes.push(`save:${c.name}${t ? '+thumb' : ''}`),
        saveThumbnail: async (id) => {
          writes.push(`thumb:${id}`);
          return true;
        },
        saveImage: async () => {},
        setMeta: async () => {},
        estimate: async () => null,
      },
      current: () => current,
      image: (h) => (h === hashOf(1) ? image(1) : undefined),
      thumbnail: () => new Promise(() => {}),
      onStatus: () => {},
      onStorageLow: () => {},
    });
    await saver.flush();
    const p = saver.flush({ thumbnail: true });
    await vi.advanceTimersByTimeAsync(THUMBNAIL_TIMEOUT_MS);
    expect(await p).toBe(true);
    expect(writes).toEqual(['save:未命名卡片']);
  });

  it('兩個分頁開同一張：舊分頁停手 2 秒的「補縮圖」不會把新分頁剛存的版本蓋回舊版', async () => {
    const factory = new IDBFactory();
    const storeA = await openCardStore(factory);
    const storeB = await openCardStore(factory);
    await seed(storeA, cardWith('a', [1]));
    // 分頁 B（舊）先開
    const tabB = harness(storeB);
    await tabB.session.openStart((await tabB.session.chooseStart())!.card);
    // 分頁 A 開同一張、改名、存
    const tabA = harness(storeA);
    await tabA.session.openStart((await tabA.session.chooseStart())!.card);
    tabA.state.current = updateCard(tabA.state.current!, { name: '分頁A的新名字' });
    expect(await tabA.session.saver.flush()).toBe(true);
    // 分頁 B 的縮圖計時器（停手 2 秒）到了
    await tabB.session.saver.flush({ thumbnail: true });
    expect((await storeA.load('a'))!.name).toBe('分頁A的新名字');
  });

  it('版本換了（updatedAt 不同）：舊分頁的縮圖也不寫進去', async () => {
    const factory = new IDBFactory();
    const storeA = await openCardStore(factory);
    const storeB = await openCardStore(factory);
    await seed(storeA, cardWith('a', [1]), new Blob(['原本的縮圖']));
    const tabB = harness(storeB);
    await tabB.session.openStart((await tabB.session.chooseStart())!.card);
    const tabA = harness(storeA);
    await tabA.session.openStart((await tabA.session.chooseStart())!.card);
    tabA.state.current = { ...updateCard(tabA.state.current!, { name: '新版' }), updatedAt: T2 };
    expect(await tabA.session.saver.flush({ thumbnail: true })).toBe(true);
    await tabB.session.saver.flush({ thumbnail: true });
    const [summary] = await storeA.list();
    expect(summary!.name).toBe('新版');
    expect(await summary!.thumbnail!.text()).toBe('thumb-a-新版');
  });
});

// ---- ③ 匯入：先解碼再存 ----

describe('R2 匯入：圖解不開就不留下打不開的卡', () => {
  it('images.add 失敗 → 回「卡片檔壞掉了」（bad-image），卡片庫不多一張、目前這張不動', async () => {
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('cur', [1]));
    const registry = new Map<string, StoredImage>();
    const h = harness(store, {
      images: {
        add: async (img) => {
          if (img.hash === hashOf(5)) throw new Error('decode failed');
          registry.set(img.hash, img);
        },
        get: (hh) => registry.get(hh),
        retain: () => {},
      },
    });
    await h.session.openStart((await h.session.chooseStart())!.card);
    const before = h.state.current;
    const importer: ImportHolocard = async (_f, o) => ({
      ok: true,
      card: { ...cardWith('x', [5]), id: o.newId(), createdAt: o.now(), updatedAt: o.now() },
      images: [image(5)],
    });
    const out = await h.session.importFile(new Blob(['z']), importer, { newId: () => 'imp', now: () => T2 });
    expect(out).toEqual({ ok: false, reason: 'bad-image' });
    expect((await store.list()).map((c) => c.id)).toEqual(['cur']);
    expect(await store.loadImage(hashOf(5))).toBeUndefined();
    expect(h.state.current).toBe(before);
  });
});

// ---- ② 換卡時序：存到最新版才換、等上傳／畫字做完才換 ----

describe('換卡時序', () => {
  it('等新卡的圖解碼時舊卡又被改：先存到最新版才換', async () => {
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('other', [3]));
    await seed(store, cardWith('cur', [1], T2));
    const gate = deferred();
    const registry = new Map<string, StoredImage>();
    const h = harness(store, {
      images: {
        add: async (img) => {
          if (img.hash === hashOf(3)) await gate.promise;
          registry.set(img.hash, img);
        },
        get: (hh) => registry.get(hh),
        retain: (keep) => {
          for (const k of [...registry.keys()]) if (!keep.has(k)) registry.delete(k);
        },
      },
    });
    await h.session.openStart((await h.session.chooseStart())!.card);
    const opening = h.session.open('other');
    await tick();
    expect(h.state.current!.id).toBe('cur'); // 還在等解碼
    h.state.current = updateCard(h.state.current!, { name: '解碼中改的' });
    gate.resolve();
    expect(await opening).toBe('opened');
    expect((await store.load('cur'))!.name).toBe('解碼中改的');
  });

  it('上面那次補存的途中又改了：再存一次，存到真的最新版才換（要一直存到沒有新改動）', async () => {
    const base = await openCardStore(new IDBFactory());
    await seed(base, cardWith('other', [3]));
    await seed(base, cardWith('cur', [1], T2));
    const decode = deferred();
    const saveGate = deferred();
    let holdNext = false;
    const store: CardStore = {
      ...base,
      save: async (c, t) => {
        if (holdNext && c.id === 'cur') {
          holdNext = false;
          await saveGate.promise;
        }
        return base.save(c, t);
      },
    };
    const registry = new Map<string, StoredImage>();
    const h = harness(store, {
      images: {
        add: async (img) => {
          if (img.hash === hashOf(3)) await decode.promise;
          registry.set(img.hash, img);
        },
        get: (hh) => registry.get(hh),
        retain: () => {},
      },
    });
    await h.session.openStart((await h.session.chooseStart())!.card);
    const opening = h.session.open('other');
    await tick();
    // 解碼中改了（v2），解碼完要補存 v2；補存卡住的時候又改了（v3）
    h.state.current = updateCard(h.state.current!, { name: 'v2' });
    holdNext = true;
    decode.resolve();
    await tick();
    expect(h.state.current!.name).toBe('v2'); // 正在存 v2，還沒換
    h.state.current = updateCard(h.state.current!, { name: 'v3' });
    saveGate.resolve();
    expect(await opening).toBe('opened');
    expect((await base.load('cur'))!.name).toBe('v3');
  });

  it('換卡前先等上傳／畫字做完：放行前不存、不換；放行後存的是做完的那一版', async () => {
    const base = await openCardStore(new IDBFactory());
    await seed(base, cardWith('other', [3]));
    await seed(base, cardWith('cur', [1], T2));
    const settle = deferred();
    const saves: string[] = [];
    const store: CardStore = {
      ...base,
      save: async (c, t) => {
        saves.push(c.name);
        return base.save(c, t);
      },
    };
    const h = harness(store, { settle: () => settle.promise });
    await h.session.openStart((await h.session.chooseStart())!.card);
    const shownBefore = h.state.shown.length;
    const opening = h.session.open('other');
    await tick();
    expect(saves).toEqual([]);
    expect(h.state.shown.length).toBe(shownBefore);
    // 上傳做完：圖層加到舊卡上
    h.state.current = updateCard(h.state.current!, { name: '上傳做完的' });
    settle.resolve();
    expect(await opening).toBe('opened');
    expect(saves[0]).toBe('上傳做完的');
    expect((await base.load('cur'))!.name).toBe('上傳做完的');
    expect(h.state.current!.id).toBe('other');
  });

  it('新卡（adopt）也一樣：放行前不存、不換', async () => {
    const base = await openCardStore(new IDBFactory());
    await seed(base, cardWith('cur', [1], T2));
    const settle = deferred();
    const saves: string[] = [];
    const store: CardStore = {
      ...base,
      save: async (c, t) => {
        saves.push(c.id);
        return base.save(c, t);
      },
    };
    const h = harness(store, { settle: () => settle.promise });
    await h.session.openStart((await h.session.chooseStart())!.card);
    h.state.current = updateCard(h.state.current!, { name: '改過' });
    const adopting = h.session.adopt(newCard('standard', 'new', T2), []);
    await tick();
    expect(saves).toEqual([]);
    expect(h.state.current!.id).toBe('cur');
    settle.resolve();
    expect(await adopting).toBe('opened');
    expect(saves).toEqual(['cur', 'new']);
  });
});

// ---- ③ 啟動：讀不到卡片庫 ≠ 沒有卡 ----

describe('啟動時讀不到卡片庫', () => {
  it('清單讀不到 → chooseStart 丟錯（不是回 null：null 會被當成第一次使用、多建一張範例）', async () => {
    const base = await openCardStore(new IDBFactory());
    await seed(base, cardWith('cur', [1]));
    const store: CardStore = { ...base, list: async () => Promise.reject(new Error('暫時讀不到')) };
    await expect(harness(store).session.chooseStart()).rejects.toThrow();
  });

  it('讀卡丟錯 → 一樣丟錯', async () => {
    const base = await openCardStore(new IDBFactory());
    await seed(base, cardWith('cur', [1]));
    const store: CardStore = { ...base, load: async () => Promise.reject(new Error('暫時讀不到')) };
    await expect(harness(store).session.chooseStart()).rejects.toThrow();
  });

  it('讀不到時開一張不存進卡片庫的空白卡（adopt 的 save: false）：卡片庫不多一張，狀態是沒存到', async () => {
    const store = await openCardStore(new IDBFactory());
    const statuses: string[] = [];
    const h = harness(store, { onStatus: (s) => statuses.push(s) });
    expect(await h.session.adopt(newCard('standard', 'blank', T0), [], { save: false })).toBe('opened');
    expect(h.state.current!.id).toBe('blank');
    expect(await store.list()).toEqual([]);
    expect(h.session.saver.status()).toBe('error');
  });

  it('存檔整個打不開（openCardStore 失敗，store 是 null）→ chooseStart 也丟錯：組裝端說明讀不到存檔，不當成第一次使用去建範例（T-412 ④A）', async () => {
    await expect(harness(null).session.chooseStart()).rejects.toThrow();
  });

  it('只在記憶體的備援空白卡：停手 2 秒的縮圖工作跑完也不會順便存進卡片庫、不改 lastOpenedId；使用者改了它才照常存（T-412 ④B）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('cur', [1]));
    await store.setMeta(LAST_OPENED_KEY, 'cur');
    const h = harness(store);
    expect(await h.session.adopt(newCard('standard', 'blank', T0), [], { save: false })).toBe('opened');
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS * 2);
    // 等縮圖工作（如果有）做完；換卡、離開前的存檔也一樣不存它
    expect(await h.session.saver.flush({ thumbnail: true })).toBe(true);
    expect((await store.list()).map((c) => c.id)).toEqual(['cur']);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('cur');
    expect(h.session.saver.status()).toBe('error');
    // 換到別張不用擋（沒有東西要存）
    expect(await h.session.open('cur')).toBe('opened');
    expect((await store.list()).map((c) => c.id)).toEqual(['cur']);
  });

  it('備援空白卡被使用者改了：那就是使用者的東西，照常存', async () => {
    const store = await openCardStore(new IDBFactory());
    const h = harness(store);
    await h.session.adopt(newCard('standard', 'blank', T0), [], { save: false });
    h.state.current = updateCard(h.state.current!, { name: '在備援卡上改的' });
    expect(await h.session.saver.flush()).toBe(true);
    expect((await store.load('blank'))!.name).toBe('在備援卡上改的');
    expect(h.session.saver.status()).toBe('saved');
  });

  it('備援空白卡存好之後就是一般卡：復原回最初的空白狀態也要存（T-412 Codex 複查）', async () => {
    const store = await openCardStore(new IDBFactory());
    const h = harness(store);
    await h.session.adopt(newCard('standard', 'blank', T0), [], { save: false });
    const original = h.state.current!;
    h.state.current = updateCard(original, { name: '在備援卡上改的' });
    expect(await h.session.saver.flush()).toBe(true);
    // 復原＝拿回最初那個物件
    h.state.current = original;
    expect(h.session.saver.isSaved(original)).toBe(false);
    expect(await h.session.saver.flush()).toBe(true);
    expect((await store.load('blank'))!.name).toBe(original.name);
  });
});

// ---- T-412 ③ 交接不能被縮圖拖住 ----

/** 等 promise 有結果（有就回 true）；最多等 ms。 */
async function settled(p: Promise<unknown>, ms = 30): Promise<boolean> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((r) => setTimeout(r, ms));
  return done;
}

describe('交接（handOff）只等資料存好，不等縮圖（T-412 ③）', () => {
  it('縮圖一直不回來（GPU 卡住）：正在等縮圖的存檔不擋交接，handOff 很快做完、卡片是最新版', async () => {
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('a', [1]));
    const h = harness(store, { thumbnail: () => new Promise<Blob | null>(() => {}) });
    await h.session.openStart((await h.session.chooseStart())!.card);
    h.state.current = updateCard(h.state.current!, { name: '改了' });
    const thumbJob = h.session.saver.flush({ thumbnail: true }); // 卡片存好之後卡在拍縮圖
    await tick();
    h.state.current = updateCard(h.state.current!, { name: '又改了' }); // 交接前最後一筆
    const handing = h.session.handOff();
    expect(await settled(handing, 300)).toBe(true);
    expect(await handing).toBe(true);
    expect(await settled(thumbJob, 5)).toBe(true);
    expect((await store.load('a'))!.name).toBe('又改了');
  });

  it('換卡卡在拍舊卡的縮圖時被接手：一樣不等縮圖（換卡做完就交出去）', async () => {
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('other', [3]));
    await seed(store, cardWith('a', [1], T2));
    const h = harness(store, { thumbnail: () => new Promise<Blob | null>(() => {}) });
    await h.session.openStart((await h.session.chooseStart())!.card);
    const opening = h.session.open('other');
    await tick();
    const handing = h.session.handOff();
    expect(await settled(handing, 300)).toBe(true);
    expect(await opening).toBe('opened');
    expect(h.state.current!.id).toBe('other');
  });

  it('交出去之後再拿回來（reload）：縮圖照常補', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('a', [1]));
    await store.setMeta(LAST_OPENED_KEY, 'a');
    const h = harness(store);
    await h.session.openStart((await h.session.chooseStart())!.card);
    expect(await h.session.handOff()).toBe(true);
    expect(await h.session.reload(() => newCard('standard', 'blank', T0), { newId: () => 'x', now: () => T2 })).toEqual({ result: 'opened' });
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS);
    expect(await h.session.saver.flush({ thumbnail: true })).toBe(true);
    expect(await (await store.list())[0]!.thumbnail!.text()).toBe('thumb-a-未命名卡片');
  });
});

// ---- T-412 ⑤ 交出編輯權之後，進行中的匯入／建立範例不能再換卡 ----

describe('交出編輯權時進行中的匯入（T-412 ⑤）', () => {
  it('匯入進行中被接手：交接等匯入做完（新卡存進卡片庫、換過去、記成上次編輯）才交出去', async () => {
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('cur', [1]));
    let imports: Promise<unknown> = Promise.resolve();
    const h = harness(store, { settleWork: () => imports.then(() => {}) });
    await h.session.openStart((await h.session.chooseStart())!.card);
    const gate = deferred();
    const importer: ImportHolocard = async (_f, o) => {
      await gate.promise;
      return { ok: true, card: { ...cardWith('x', [5]), id: o.newId(), createdAt: o.now(), updatedAt: o.now() }, images: [image(5)] };
    };
    const importing = h.session.importFile(new Blob(['z']), importer, { newId: () => 'imp', now: () => T2 });
    imports = importing;
    await tick();
    const handing = h.session.handOff();
    expect(await settled(handing)).toBe(false); // 匯入還沒做完
    gate.resolve();
    expect(await importing).toMatchObject({ ok: true, result: 'opened' });
    expect(await handing).toBe(true);
    expect(h.state.current!.id).toBe('imp');
    expect((await store.load('imp'))!.id).toBe('imp');
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('imp');
  });

  it('交出去之後才到的換卡（保險）：寫入被拒絕不能當成一般存檔失敗照樣換卡 → 回 away、不換', async () => {
    const store = await openCardStore(new IDBFactory());
    await seed(store, cardWith('cur', [1]));
    const h = harness(store);
    await h.session.openStart((await h.session.chooseStart())!.card);
    expect(await h.session.handOff()).toBe(true);
    const before = h.state.current;
    const out = await h.session.importFile(new Blob(['z']), async () => ({ ok: true, card: cardWith('late', [5]), images: [image(5)] }), {
      newId: () => 'late',
      now: () => T2,
    });
    expect(out).toMatchObject({ ok: true, result: 'away' });
    expect(h.state.current).toBe(before);
    expect(await store.load('late')).toBeUndefined();
  });

  it('沒拿著編輯鎖（寫入被 guardWrites 擋下）：新卡一樣不換過去', async () => {
    const base = await openCardStore(new IDBFactory());
    await seed(base, cardWith('cur', [1]));
    let canWrite = true;
    const h = harness(guardWrites(base, () => canWrite));
    await h.session.openStart((await h.session.chooseStart())!.card);
    const before = h.state.current;
    canWrite = false;
    expect(await quietly(() => h.session.adopt(newCard('standard', 'new', T2), []))).toBe('away');
    expect(h.state.current).toBe(before);
  });
});

/** 存檔失敗會 console.error：測試裡不印出來。 */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
}

// ---- ③ 變成隱藏：先單獨存卡，縮圖另外排 ----

describe('R5 分頁變成隱藏時剛好有存檔在跑', () => {
  it('最新版先存，不用等縮圖拍完', async () => {
    const log: string[] = [];
    const gate = deferred();
    let first = true;
    let current: Card = newCard('standard', 'c', T0);
    const thumbGate = deferred<Blob | null>();
    const saver = createAutoSaver({
      store: {
        save: async (c, t) => {
          log.push(`save:${c.name}${t ? '+thumb' : ''}`);
          if (first) {
            first = false;
            await gate.promise;
          }
        },
        saveThumbnail: async () => {
          log.push('thumb');
          return true;
        },
        saveImage: async () => {},
        setMeta: async () => {},
        estimate: async () => null,
      },
      current: () => current,
      image: () => undefined,
      thumbnail: () => {
        log.push('thumbnail-start');
        return thumbGate.promise;
      },
      onStatus: () => {},
      onStorageLow: () => {},
    });
    const running = saver.flush(); // 動作完成的存檔正在跑
    await Promise.resolve();
    current = updateCard(current, { name: '最後一筆' });
    // 分頁變隱藏（main 的 visibilitychange）
    let cardSaved = false;
    const a = saver.flush().then((ok) => (cardSaved = ok));
    const b = saver.flush({ thumbnail: true });
    gate.resolve();
    await running;
    await tick();
    // 縮圖還沒拍好，最新版已經存了，卡片那一次也已經回報存好
    expect(log).toEqual(['save:未命名卡片', 'save:最後一筆', 'thumbnail-start']);
    expect(cardSaved).toBe(true);
    thumbGate.resolve(new Blob(['t']));
    await a;
    expect(await b).toBe(true);
    expect(log).toEqual(['save:未命名卡片', 'save:最後一筆', 'thumbnail-start', 'thumb']);
  });
});
