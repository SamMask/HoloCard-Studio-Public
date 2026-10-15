// T-409：一次只有一個分頁能編輯（Web Locks＋BroadcastChannel 用假的注入）。
// 後開的分頁接手：舊分頁先存好、停住寫入、放掉鎖，新分頁才讀卡片庫；舊分頁按〔在這裡繼續〕＝反過來接手、重新讀卡片庫。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAST_OPENED_KEY, THUMBNAIL_IDLE_MS } from '../src/app/autosave';
import { createSession, type Session } from '../src/app/session';
import { createTabLock, guardWrites, type ChannelLike, type LockManagerLike, type TabLock } from '../src/app/tab-lock';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import type { CardStore } from '../src/storage/types';

// ---- 假的瀏覽器介面 ----

/** 只有一把鎖的假 Web Locks：一次一個人拿；ifAvailable 拿不到就給 null；其他排隊。 */
function fakeLocks() {
  let busy = false;
  const queue: (() => void)[] = [];
  const next = () => {
    busy = false;
    queue.shift()?.();
  };
  const manager: LockManagerLike & { held(): boolean; waiting(): number } = {
    request(_name, options, callback) {
      return new Promise((resolve, reject) => {
        const grant = () => {
          busy = true;
          Promise.resolve()
            .then(() => callback({}))
            .then(
              (v) => {
                next();
                resolve(v);
              },
              (e) => {
                next();
                reject(e);
              },
            );
        };
        if (!busy && queue.length === 0) grant();
        else if (options.ifAvailable) Promise.resolve().then(() => callback(null)).then(resolve, reject);
        else queue.push(grant);
      });
    },
    held: () => busy,
    waiting: () => queue.length,
  };
  return manager;
}

/** 假的 BroadcastChannel：送給同一個 hub 裡的其他頻道（非同步，和瀏覽器一樣不會送給自己）。 */
function fakeHub() {
  const members: ((m: unknown) => void)[][] = [];
  return {
    channel(): ChannelLike & { posted: unknown[] } {
      const handlers: ((m: unknown) => void)[] = [];
      members.push(handlers);
      const posted: unknown[] = [];
      return {
        posted,
        post(message) {
          posted.push(message);
          for (const other of members) {
            if (other === handlers) continue;
            for (const handler of other) setTimeout(() => handler(structuredClone(message)), 0);
          }
        },
        listen(handler) {
          handlers.push(handler);
        },
      };
    },
    /** 從外面（例如別的程式）塞一則訊息給所有人。 */
    broadcast(message: unknown) {
      for (const handlers of members) for (const handler of handlers) setTimeout(() => handler(message), 0);
    },
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

/** 等 promise 有結果（有就回 true）；最多等 ms。 */
async function settled(p: Promise<unknown>, ms = 30): Promise<boolean> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  await tick(ms);
  return done;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---- 鎖本身 ----

describe('編輯鎖（tab-lock）', () => {
  it('瀏覽器沒有 Web Locks 或 BroadcastChannel：不擋，馬上可以寫（照以前）', async () => {
    const noLocks = createTabLock({ locks: null, channel: fakeHub().channel(), onYield: async () => {} });
    const noChannel = createTabLock({ locks: fakeLocks(), channel: null, onYield: async () => {} });
    for (const lock of [noLocks, noChannel]) {
      expect(lock.supported).toBe(false);
      expect(lock.holding()).toBe(true);
      await lock.acquire();
      expect(lock.holding()).toBe(true);
    }
  });

  it('第一個分頁：馬上拿到，不用請別人交出來', async () => {
    const hub = fakeHub();
    const channel = hub.channel();
    const lock = createTabLock({ locks: fakeLocks(), channel, onYield: async () => {} });
    expect(lock.holding()).toBe(false);
    await lock.acquire();
    expect(lock.holding()).toBe(true);
    expect(channel.posted).toEqual([]);
  });

  it('後開的分頁接手：舊分頁 onYield 做完才放掉鎖，新分頁這時才拿到；舊分頁不能再寫', async () => {
    const locks = fakeLocks();
    const hub = fakeHub();
    const yieldGate = deferred();
    let yields = 0;
    const a = createTabLock({
      locks,
      channel: hub.channel(),
      id: 'A',
      onYield: () => {
        yields++;
        return yieldGate.promise;
      },
    });
    const b = createTabLock({ locks, channel: hub.channel(), id: 'B', onYield: async () => {} });
    await a.acquire();
    const bGot = b.acquire();
    await tick();
    expect(yields).toBe(1);
    expect(await settled(bGot)).toBe(false); // A 還在存
    expect(a.holding()).toBe(true); // 交出去的途中還能把卡存好
    yieldGate.resolve();
    await bGot;
    expect(b.holding()).toBe(true);
    expect(a.holding()).toBe(false);
  });

  it('被接手的分頁按〔在這裡繼續〕：反過來接手', async () => {
    const locks = fakeLocks();
    const hub = fakeHub();
    const yielded: string[] = [];
    const a = createTabLock({ locks, channel: hub.channel(), id: 'A', onYield: async () => void yielded.push('A') });
    const b = createTabLock({ locks, channel: hub.channel(), id: 'B', onYield: async () => void yielded.push('B') });
    await a.acquire();
    await b.acquire();
    await a.acquire();
    expect(yielded).toEqual(['A', 'B']);
    expect(a.holding()).toBe(true);
    expect(b.holding()).toBe(false);
  });

  it('onYield 出錯也會放掉鎖（不然另一個分頁永遠等不到）', async () => {
    const locks = fakeLocks();
    const hub = fakeHub();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (e: unknown) => void errors.push(e);
    try {
      const a = createTabLock({ locks, channel: hub.channel(), onYield: () => Promise.reject(new Error('存檔壞了')) });
      const b = createTabLock({ locks, channel: hub.channel(), onYield: async () => {} });
      await a.acquire();
      await b.acquire();
      expect(a.holding()).toBe(false);
      expect(b.holding()).toBe(true);
      expect(errors).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  it('自己送的、形狀不對的訊息都不理', async () => {
    const hub = fakeHub();
    let yields = 0;
    const a = createTabLock({ locks: fakeLocks(), channel: hub.channel(), id: 'A', onYield: async () => void yields++ });
    await a.acquire();
    hub.broadcast({ type: 'takeover', from: 'A' });
    hub.broadcast({ type: 'takeover' });
    hub.broadcast({ type: 'hello', from: 'X' });
    hub.broadcast('takeover');
    hub.broadcast(null);
    await tick();
    expect(yields).toBe(0);
    expect(a.holding()).toBe(true);
  });

  it('正在交出去時又按〔在這裡繼續〕：等交完再重新排隊拿，不會以為自己還拿著', async () => {
    const locks = fakeLocks();
    const hub = fakeHub();
    const yieldGate = deferred();
    const a = createTabLock({ locks, channel: hub.channel(), id: 'A', onYield: () => yieldGate.promise });
    const b = createTabLock({ locks, channel: hub.channel(), id: 'B', onYield: async () => {} });
    await a.acquire();
    const bGot = b.acquire();
    await tick();
    const aAgain = a.acquire(); // A 還在交出去
    expect(await settled(aAgain)).toBe(false);
    yieldGate.resolve();
    await bGot;
    await aAgain;
    expect(a.holding()).toBe(true);
    expect(b.holding()).toBe(false);
  });

  it('三個分頁（T-412）：A 交接中 C 又要接手，C 的通知被 A（交接中）和 B（還沒拿到）忽略 → C 會再請一次，最後一定拿得到', async () => {
    const locks = fakeLocks();
    const hub = fakeHub();
    const yieldGate = deferred();
    const a = createTabLock({ locks, channel: hub.channel(), id: 'A', onYield: () => yieldGate.promise, retryMs: 20 });
    const b = createTabLock({ locks, channel: hub.channel(), id: 'B', onYield: async () => {}, retryMs: 20 });
    const c = createTabLock({ locks, channel: hub.channel(), id: 'C', onYield: async () => {}, retryMs: 20 });
    await a.acquire();
    const bGot = b.acquire();
    await tick(); // A 開始交出去（卡在 yieldGate）
    const cGot = c.acquire();
    await tick(50); // C 的通知（含重送）：A 正在交出去、B 還沒拿著 → 都不理
    expect(await settled(cGot, 5)).toBe(false);
    yieldGate.resolve();
    await bGot;
    // B 拿到之後，C 再請一次 → B 交出來
    expect(await settled(cGot, 300)).toBe(true);
    expect(c.holding()).toBe(true);
    expect(b.holding()).toBe(false);
    expect(a.holding()).toBe(false);
  });

  it('要等別的分頁交出來時叫 onWait（畫面顯示「正在等另一個分頁存好…」）；馬上拿到就不叫', async () => {
    const locks = fakeLocks();
    const hub = fakeHub();
    const waits: string[] = [];
    const a = createTabLock({ locks, channel: hub.channel(), id: 'A', onYield: async () => {}, onWait: () => void waits.push('A') });
    const b = createTabLock({ locks, channel: hub.channel(), id: 'B', onYield: async () => {}, onWait: () => void waits.push('B') });
    await a.acquire();
    expect(waits).toEqual([]);
    await b.acquire();
    expect(waits).toEqual(['B']);
  });
});

describe('guardWrites：沒拿著鎖就不能寫', () => {
  it('寫入一律拒絕、而且不會碰到資料庫；讀照常', async () => {
    const store = await openCardStore(new IDBFactory());
    await store.setMeta('k', '原本的');
    let can = false;
    const guarded = guardWrites(store, () => can);
    const card = newCard('standard', 'c', '2026-10-13T00:00:00.000Z');
    await expect(guarded.save(card)).rejects.toThrow();
    await expect(guarded.saveThumbnail('c', card.updatedAt, new Blob(['t']))).rejects.toThrow();
    await expect(guarded.remove('c')).rejects.toThrow();
    await expect(guarded.saveImage(image(1))).rejects.toThrow();
    await expect(guarded.cleanupImages()).rejects.toThrow();
    await expect(guarded.setMeta('k', '被蓋掉')).rejects.toThrow();
    await expect(guarded.updateMeta('k', () => '被改掉')).rejects.toThrow();
    expect(await guarded.getMeta('k')).toBe('原本的');
    expect(await guarded.list()).toEqual([]);
    expect(await guarded.hasCards()).toBe(false);
    can = true;
    await guarded.save(card);
    expect(await guarded.load('c')).toEqual(card);
  });
});

// ---- 兩個分頁開同一個卡片庫（session＋鎖＋同一個 fake-indexeddb） ----

const T0 = '2026-10-13T00:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

function cardWith(id: string, nums: number[]): Card {
  let card = newCard('standard', id, T0);
  nums.forEach((n, i) => {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${i}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  });
  return card;
}

interface Tab {
  lock: TabLock;
  session: Session;
  state: { current: Card | null; yielded: number; handedOff: boolean | null };
  raw: CardStore;
  /** 這個分頁的圖片登記簿（記憶體裡的圖）。 */
  registry: Map<string, StoredImage>;
  /** 讓這個分頁的存檔壞掉：save＝存卡、存圖都失敗（例如空間滿了）；list＝卡片庫清單讀不到。 */
  fail: { save: boolean; list: boolean };
  /** 換掉這個分頁拍縮圖的方式（例如 GPU 卡住，一直不回來）。 */
  hooks: { thumbnail(): Promise<Blob | null> };
}

/** 模擬一個分頁的組裝端（main 的 T-409 接線）：寫入經過 guardWrites；被接手時 handOff。 */
async function openTab(factory: IDBFactory, locks: LockManagerLike, hub: ReturnType<typeof fakeHub>): Promise<Tab> {
  const raw = await openCardStore(factory);
  const fail = { save: false, list: false };
  const broken = () => Promise.reject(new Error('磁碟滿了'));
  const flaky: CardStore = {
    ...raw,
    list: () => (fail.list ? broken() : raw.list()),
    save: (card, thumbnail) => (fail.save ? broken() : raw.save(card, thumbnail)),
    saveImage: (img) => (fail.save ? broken() : raw.saveImage(img)),
  };
  const registry = new Map<string, StoredImage>();
  const state = { current: null as Card | null, yielded: 0, handedOff: null as boolean | null };
  const hooks = { thumbnail: async (): Promise<Blob | null> => new Blob([`thumb-${state.current?.name}`], { type: 'image/webp' }) };
  let session!: Session;
  const lock = createTabLock({
    locks,
    channel: hub.channel(),
    retryMs: 20,
    onYield: async () => {
      state.yielded++;
      state.handedOff = await session.handOff();
    },
  });
  session = createSession({
    store: guardWrites(flaky, () => lock.holding()),
    images: {
      add: async (img) => void registry.set(img.hash, img),
      get: (h) => registry.get(h),
      retain: (keep) => {
        for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
      },
    },
    current: () => state.current,
    show: (c) => (state.current = c),
    thumbnail: () => hooks.thumbnail(),
    settle: async () => {},
    onStatus: () => {},
    onStorageLow: () => {},
  });
  // 開啟工坊：先拿鎖，才讀卡片庫
  await lock.acquire();
  const choice = await session.chooseStart();
  await session.openStart(choice!.card);
  return { lock, session, state, raw, registry, fail, hooks };
}

const T1 = '2026-10-14T01:00:00.000Z';
let idCount = 0;
/** reload 另存「沒存到的版本」用的新 id 與時間。 */
const ids = { newId: () => `rescue-${++idCount}`, now: () => T1 };

/** 卡片正面多加一張圖（第 n 號），並改名。 */
function withImage(card: Card, n: number, name: string): Card {
  const img = image(n);
  const r = addLayer(card, 'front', { id: `${card.id}-extra-${n}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
  if (!r.ok) throw new Error(r.reason);
  return updateCard(r.card, { name });
}

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

/** 卡片庫裡找名字是 name 的卡（讀得出來＝圖也都在）。 */
async function findByName(store: CardStore, name: string): Promise<Card | undefined> {
  const summary = (await store.list()).find((s) => s.name === name);
  return summary && (await store.load(summary.id));
}

describe('兩個分頁：後開的接手、先開的變灰、資料不會被蓋掉', () => {
  async function setup() {
    const factory = new IDBFactory();
    const seedStore = await openCardStore(factory);
    const card = cardWith('a', [1]);
    await seedStore.saveImage(image(1));
    await seedStore.save(card);
    await seedStore.setMeta(LAST_OPENED_KEY, 'a');
    return { factory, locks: fakeLocks(), hub: fakeHub() };
  }

  it('A 改名還沒存 → 開 B：A 先存好才交出去，B 看到 A 的新名字；A 之後的寫入全部被擋', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    a.state.current = updateCard(a.state.current!, { name: 'A 的新名字' }); // 還沒存（改名的計時器還沒到）
    const b = await openTab(factory, locks, hub);
    expect(a.state.yielded).toBe(1);
    expect(a.state.handedOff).toBe(true);
    expect(b.state.current!.name).toBe('A 的新名字');
    // A 被接手後：自動存、縮圖、meta 都不寫
    a.state.current = updateCard(a.state.current!, { name: 'A 被接手後亂改' });
    a.session.saver.changed();
    expect(await a.session.saver.flush({ thumbnail: true })).toBe(false);
    await expect(a.raw.load('a')).resolves.toMatchObject({ name: 'A 的新名字' });
    await tick(30);
    expect((await a.raw.load('a'))!.name).toBe('A 的新名字');
  });

  it('B 改了東西 → A 按〔在這裡繼續〕：B 先存好、A 重新讀卡片庫看到 B 的改動（不是記憶體裡的舊版），B 變成被接手', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    const b = await openTab(factory, locks, hub);
    b.state.current = updateCard(b.state.current!, { name: 'B 改的' });
    b.session.saver.changed(); // 還沒存
    // A 記憶體裡的是舊版
    expect(a.state.current!.name).toBe('未命名卡片');
    await a.lock.acquire();
    expect(b.state.yielded).toBe(1);
    expect(await a.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'opened' });
    expect(a.state.current!.name).toBe('B 改的');
    expect((await a.raw.load('a'))!.name).toBe('B 改的');
    // A 接手後照常存
    a.state.current = updateCard(a.state.current!, { name: 'A 接手後改的' });
    expect(await a.session.saver.flush()).toBe(true);
    expect((await a.raw.load('a'))!.name).toBe('A 接手後改的');
    expect(b.lock.holding()).toBe(false);
  });

  it('接手後 A 記憶體裡交出去前的舊版不會被寫回去（就算 A 交出去時有沒存到的改動）：寫回去的不是原本那張，是另存的一張', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    const b = await openTab(factory, locks, hub);
    // A 被接手後，記憶體裡被改成別的（例如 B 還沒接手前的舊復原堆疊）
    a.state.current = updateCard(a.state.current!, { name: 'A 記憶體裡的舊版' });
    b.state.current = updateCard(b.state.current!, { name: 'B 的新版' });
    expect(await b.session.saver.flush()).toBe(true);
    await a.lock.acquire();
    expect(await a.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'opened', rescued: 'A 記憶體裡的舊版（沒存到的版本）' });
    expect(a.state.current!.name).toBe('B 的新版');
    expect((await a.raw.load('a'))!.name).toBe('B 的新版');
    expect(await findByName(a.raw, 'A 記憶體裡的舊版（沒存到的版本）')).toBeDefined();
  });

  it('接手時卡片庫是空的（另一個分頁把卡都刪了）：開一張新的空白卡存進去', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    const b = await openTab(factory, locks, hub);
    await b.raw.remove('a');
    await a.lock.acquire();
    expect(await a.session.reload(() => newCard('tarot', 'blank', T0), ids)).toEqual({ result: 'empty' });
    expect(a.state.current!.id).toBe('blank');
    expect((await a.raw.list()).map((c) => c.id)).toEqual(['blank']);
  });

  it('接手時讀不到卡片庫：開一張空白卡但不存進去（不多一張）；停手 2 秒的縮圖工作跑完也一樣，lastOpenedId 不變', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    await openTab(factory, locks, hub);
    a.fail.list = true;
    await a.lock.acquire();
    // 縮圖計時器用假的（鎖已經拿到，之後不用再傳話）
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await quietly(async () => {
        expect(await a.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'unreadable' });
        await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS * 2);
        // 等縮圖工作（如果有）做完
        expect(await a.session.saver.flush({ thumbnail: true })).toBe(true);
      });
    } finally {
      vi.useRealTimers();
      a.fail.list = false;
    }
    expect(a.state.current!.id).toBe('blank');
    expect(a.session.saver.status()).toBe('error');
    expect((await a.raw.list()).map((c) => c.id)).toEqual(['a']);
    expect(await a.raw.getMeta(LAST_OPENED_KEY)).toBe('a');
  });

  // ---- T-412 ①：存檔失敗後被接手、再接手，沒存到的版本（含圖）一定找得到 ----

  /** A 加了第 2 號圖、改了名，但存檔壞了（存不進去）。 */
  async function unsavedA(a: Tab) {
    a.fail.save = true;
    a.registry.set(hashOf(2), image(2));
    a.state.current = withImage(a.state.current!, 2, 'A 沒存到的');
    expect(await quietly(() => a.session.saver.flush())).toBe(false);
  }

  it('A 存不進去 → B 接手並改了同一張 → A 存檔好了、按〔在這裡繼續〕：沒存到的版本另存成「卡名（沒存到的版本）」（含圖），再打開最新版', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    await unsavedA(a);
    const b = await quietly(() => openTab(factory, locks, hub));
    expect(a.state.handedOff).toBe(false);
    b.state.current = updateCard(b.state.current!, { name: 'B 的新版' });
    expect(await b.session.saver.flush()).toBe(true);
    a.fail.save = false;
    await a.lock.acquire();
    expect(await a.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'opened', rescued: 'A 沒存到的（沒存到的版本）' });
    // 打開的是最新版（B 存的），B 的那張沒被蓋掉
    expect(a.state.current!.name).toBe('B 的新版');
    expect((await a.raw.load('a'))!.name).toBe('B 的新版');
    expect(await a.raw.getMeta(LAST_OPENED_KEY)).toBe('a');
    // 沒存到的版本找得到：內容、圖都在
    const rescued = await findByName(a.raw, 'A 沒存到的（沒存到的版本）');
    expect(rescued!.id).not.toBe('a');
    expect(rescued!.front.layers.map((l) => l.image)).toEqual([hashOf(1), hashOf(2)]);
    expect(await a.raw.loadImage(hashOf(2))).toBeDefined();
  });

  it('A 再接手時還是存不進去：不重新讀、不收回圖，留在畫面上（換成另存的那一張，不會蓋掉 B 存的）；存檔好了自動存成新的一張', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    await unsavedA(a);
    const b = await quietly(() => openTab(factory, locks, hub));
    b.state.current = updateCard(b.state.current!, { name: 'B 的新版' });
    expect(await b.session.saver.flush()).toBe(true);
    await a.lock.acquire();
    expect(await quietly(() => a.session.reload(() => newCard('standard', 'blank', T0), ids))).toEqual({
      result: 'kept',
      rescued: 'A 沒存到的（沒存到的版本）',
    });
    const kept = a.state.current!;
    expect(kept.id).not.toBe('a');
    expect(kept.name).toBe('A 沒存到的（沒存到的版本）');
    expect(kept.front.layers.map((l) => l.image)).toEqual([hashOf(1), hashOf(2)]);
    expect(a.registry.has(hashOf(2))).toBe(true);
    expect(a.session.saver.status()).toBe('error');
    expect(a.session.saver.isSaved(kept)).toBe(false);
    expect((await a.raw.load('a'))!.name).toBe('B 的新版');
    // 存檔好了：下一次存檔存成新的一張，B 的那張不動
    a.fail.save = false;
    expect(await a.session.saver.flush()).toBe(true);
    expect((await a.raw.load('a'))!.name).toBe('B 的新版');
    expect((await a.raw.load(kept.id))!.front.layers.map((l) => l.image)).toEqual([hashOf(1), hashOf(2)]);
  });

  it('任何接手順序都找得到：A 存不進去 → B 接手 → C 接手 → A 接手（還是存不進去）→ B 接手 → A 接手（存檔好了）', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    await unsavedA(a);
    const b = await quietly(() => openTab(factory, locks, hub));
    const c = await openTab(factory, locks, hub);
    expect(b.state.yielded).toBe(1);
    await a.lock.acquire();
    expect((await quietly(() => a.session.reload(() => newCard('standard', 'blank', T0), ids))).result).toBe('kept');
    expect(c.state.yielded).toBe(1);
    await quietly(() => b.lock.acquire());
    expect(a.state.handedOff).toBe(false);
    expect(await b.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'opened' });
    a.fail.save = false;
    await a.lock.acquire();
    // 已經是「（沒存到的版本）」的卡不會再加一次
    expect(await a.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'opened', rescued: 'A 沒存到的（沒存到的版本）' });
    const rescued = await findByName(a.raw, 'A 沒存到的（沒存到的版本）');
    expect(rescued!.front.layers.map((l) => l.image)).toEqual([hashOf(1), hashOf(2)]);
    expect(await a.raw.loadImage(hashOf(2))).toBeDefined();
    expect((await a.raw.list()).map((s) => s.name).sort()).toEqual(['A 沒存到的（沒存到的版本）', '未命名卡片']);
  });

  it('交出去時存好了（沒有沒存到的版本）：再接手不另存，卡片庫不多一張', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    a.state.current = updateCard(a.state.current!, { name: 'A 存好的' });
    await openTab(factory, locks, hub);
    expect(a.state.handedOff).toBe(true);
    await a.lock.acquire();
    expect(await a.session.reload(() => newCard('standard', 'blank', T0), ids)).toEqual({ result: 'opened' });
    expect((await a.raw.list()).map((s) => s.id)).toEqual(['a']);
  });

  it('交接不等縮圖（T-412 ③）：A 的縮圖一直拍不好（GPU 卡住）時，B 照樣很快接手', async () => {
    const { factory, locks, hub } = await setup();
    const a = await openTab(factory, locks, hub);
    a.hooks.thumbnail = () => new Promise(() => {});
    a.state.current = updateCard(a.state.current!, { name: 'A 改的' });
    const thumbJob = a.session.saver.flush({ thumbnail: true }); // 卡片存好之後卡在拍縮圖
    await tick();
    const bOpening = openTab(factory, locks, hub);
    expect(await settled(bOpening, 500)).toBe(true);
    const b = await bOpening;
    expect(b.state.current!.name).toBe('A 改的');
    expect(await settled(thumbJob, 5)).toBe(true);
  });

  it('handOff 會等進行中的上傳／畫字做完才存（上傳做完的圖層也要交出去）', async () => {
    const factory = new IDBFactory();
    const store = await openCardStore(factory);
    await store.saveImage(image(1));
    await store.save(cardWith('a', [1]));
    const settle = deferred();
    const state = { current: null as Card | null };
    const session = createSession({
      store,
      images: { add: async () => {}, get: (h) => (h === hashOf(1) ? image(1) : undefined), retain: () => {} },
      current: () => state.current,
      show: (c) => (state.current = c),
      thumbnail: async () => null,
      settle: () => settle.promise,
      onStatus: () => {},
      onStorageLow: () => {},
    });
    await session.openStart((await session.chooseStart())!.card);
    const handing = session.handOff();
    await tick();
    state.current = updateCard(state.current!, { name: '上傳做完的' });
    settle.resolve();
    expect(await handing).toBe(true);
    expect((await store.load('a'))!.name).toBe('上傳做完的');
  });

  it('handOff 存不起來：回 false（畫面提醒先匯出備份），照樣停住', async () => {
    const factory = new IDBFactory();
    const base = await openCardStore(factory);
    await base.saveImage(image(1));
    await base.save(cardWith('a', [1]));
    const store: CardStore = { ...base, save: () => Promise.reject(new Error('滿了')) };
    const state = { current: null as Card | null };
    const session = createSession({
      store,
      images: { add: async () => {}, get: (h) => (h === hashOf(1) ? image(1) : undefined), retain: () => {} },
      current: () => state.current,
      show: (c) => (state.current = c),
      thumbnail: async () => null,
      settle: async () => {},
      onStatus: () => {},
      onStorageLow: () => {},
    });
    await session.openStart((await session.chooseStart())!.card);
    state.current = updateCard(state.current!, { name: '存不進去的' });
    const original = console.error;
    console.error = () => {};
    try {
      expect(await session.handOff()).toBe(false);
    } finally {
      console.error = original;
    }
    await expect(session.saver.exclusive(async () => 1)).rejects.toThrow();
  });
});
