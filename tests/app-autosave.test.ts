import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITY_CHECK_EVERY,
  cardImageHashes,
  createAutoSaver,
  LAST_OPENED_KEY,
  storageNearlyFull,
  TEXT_SAVE_DELAY_MS,
  THUMBNAIL_IDLE_MS,
  THUMBNAIL_TIMEOUT_MS,
  type AutoSaverDeps,
} from '../src/app/autosave';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import type { StorageEstimate } from '../src/storage/types';
import type { SaveStatus } from '../src/ui/types';

// ---- 小工具 ----

const T0 = '2026-10-13T00:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

/** 正面依序加圖（奇數＝底圖、偶數＝立體層）。 */
function cardWith(id: string, imageNumbers: number[]): Card {
  let card = newCard('standard', id, T0);
  imageNumbers.forEach((n, i) => {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${i}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  });
  return card;
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 記錄每個呼叫的假存檔；可以讓下一次 save 失敗、或卡住等放行。 */
function fakeStore() {
  const log: string[] = [];
  const saved = new Map<string, { card: Card; thumbnail?: Blob }>();
  const meta = new Map<string, string>();
  let running = 0;
  const s = {
    log,
    saved,
    meta,
    maxRunning: 0,
    failSaves: 0,
    gate: null as Promise<void> | null,
    estimateValue: { usage: 10, quota: 100 } as StorageEstimate | null,
    estimateCalls: 0,
    async saveImage(img: StoredImage) {
      log.push(`image:${img.hash}`);
    },
    async save(card: Card, thumbnail?: Blob) {
      running++;
      s.maxRunning = Math.max(s.maxRunning, running);
      try {
        log.push(`save:${card.id}:${card.name}${thumbnail ? '+thumb' : ''}`);
        if (s.gate) await s.gate;
        if (s.failSaves > 0) {
          s.failSaves--;
          throw new Error('磁碟滿了');
        }
        saved.set(card.id, { card: structuredClone(card), thumbnail: thumbnail ?? saved.get(card.id)?.thumbnail });
      } finally {
        running--;
      }
    },
    failThumbs: 0,
    async saveThumbnail(id: string, updatedAt: string, thumbnail: Blob) {
      log.push(`thumb:${id}`);
      if (s.failThumbs > 0) {
        s.failThumbs--;
        throw new Error('磁碟滿了');
      }
      const record = saved.get(id);
      if (!record || record.card.updatedAt !== updatedAt) return false;
      record.thumbnail = thumbnail;
      return true;
    },
    async setMeta(key: string, value: string) {
      log.push(`meta:${key}=${value}`);
      meta.set(key, value);
    },
    async estimate() {
      s.estimateCalls++;
      return s.estimateValue;
    },
  };
  return s;
}

function setup(card: Card | null, overrides: Partial<AutoSaverDeps> = {}) {
  const store = fakeStore();
  const images = new Map([1, 2, 3, 4, 5, 6].map((n) => [hashOf(n), image(n)]));
  const statuses: SaveStatus[] = [];
  let current = card;
  let thumbs = 0;
  let lowWarnings = 0;
  const saver = createAutoSaver({
    store,
    current: () => current,
    image: (h) => images.get(h),
    thumbnail: async () => {
      thumbs++;
      return new Blob(['thumb'], { type: 'image/png' });
    },
    onStatus: (s) => statuses.push(s),
    onStorageLow: () => lowWarnings++,
    ...overrides,
  });
  return {
    store,
    saver,
    statuses,
    get card() {
      return current!;
    },
    set card(c: Card) {
      current = c;
    },
    thumbs: () => thumbs,
    lowWarnings: () => lowWarnings,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---- 測試 ----

describe('卡片用到的圖', () => {
  it('兩面的圖、不重複', () => {
    let card = cardWith('c', [1, 2, 2]);
    const r = addLayer(card, 'back', { id: 'b', name: 'b', image: hashOf(3), hasAlpha: false, width: 64, height: 96 });
    if (r.ok) card = r.card;
    expect(cardImageHashes(card)).toEqual([hashOf(1), hashOf(2), hashOf(3)]);
  });
});

describe('存一次（SCHEMA §3）', () => {
  it('先存這張卡用到的每張圖，再存卡片，存完更新 lastOpenedId', async () => {
    const t = setup(cardWith('c1', [1, 2]));
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.log).toEqual([`image:${hashOf(1)}`, `image:${hashOf(2)}`, 'save:c1:未命名卡片', `meta:${LAST_OPENED_KEY}=c1`]);
    expect(t.store.saved.get('c1')!.card).toEqual(t.card);
  });

  it('狀態：儲存中… → 已儲存', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.flush();
    expect(t.statuses).toEqual(['saving', 'saved']);
    expect(t.saver.status()).toBe('saved');
  });

  it('沒有改變就不再寫一次', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.flush();
    t.store.log.length = 0;
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.log).toEqual([]);
  });

  it('lastOpenedId 只在換了卡才寫', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.flush();
    t.card = updateCard(t.card, { name: '第二版' });
    await t.saver.flush();
    expect(t.store.log.filter((l) => l.startsWith('meta:'))).toEqual([`meta:${LAST_OPENED_KEY}=c1`]);
  });

  it('記憶體裡找不到某張圖：不寫卡片（存了會是壞卡）、回報失敗', async () => {
    const t = setup(cardWith('c1', [1, 10])); // 10 號圖不在記憶體裡
    expect(await t.saver.flush()).toBe(false);
    expect(t.store.saved.size).toBe(0);
    expect(t.saver.status()).toBe('error');
  });

  it('沒有卡（還沒開好）：不用存、算成功', async () => {
    const t = setup(null);
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.log).toEqual([]);
  });

  it('存檔不能用（store 是 null）：沒存到', async () => {
    const t = setup(cardWith('c1', [1]), { store: null });
    expect(await t.saver.flush()).toBe(false);
    expect(t.saver.status()).toBe('error');
  });
});

describe('存檔排隊：同時只跑一個，存的過程中又有變動就存完再存最新的', () => {
  it('第一次還沒存完又改了：不會同時存兩次，最後存的是最新的', async () => {
    const t = setup(cardWith('c1', [1]));
    const gate = deferred();
    t.store.gate = gate.promise;
    const first = t.saver.flush();
    await vi.waitFor(() => expect(t.store.log).toContain('save:c1:未命名卡片'));
    t.card = updateCard(t.card, { name: '改了' });
    const second = t.saver.flush();
    t.card = updateCard(t.card, { name: '又改了' });
    const third = t.saver.flush();
    gate.resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await third).toBe(true);
    expect(t.store.maxRunning).toBe(1);
    // 排隊中的兩次合成一次，存的是當下最新的
    expect(t.store.log.filter((l) => l.startsWith('save:'))).toEqual(['save:c1:未命名卡片', 'save:c1:又改了']);
    expect(t.store.saved.get('c1')!.card.name).toBe('又改了');
  });

  it('其他寫入（匯入、刪卡）用 exclusive 排進同一條隊伍，不和存檔同時跑', async () => {
    const t = setup(cardWith('c1', [1]));
    const gate = deferred();
    t.store.gate = gate.promise;
    const save = t.saver.flush();
    let ran = false;
    const task = t.saver.exclusive(async () => {
      ran = true;
      return 42;
    });
    await Promise.resolve();
    expect(ran).toBe(false);
    gate.resolve();
    await save;
    expect(await task).toBe(42);
    expect(ran).toBe(true);
  });

  it('exclusive 的工作出錯：錯誤丟給呼叫端，隊伍照常往下跑', async () => {
    const t = setup(cardWith('c1', [1]));
    await expect(t.saver.exclusive(async () => Promise.reject(new Error('壞了')))).rejects.toThrow('壞了');
    expect(await t.saver.flush()).toBe(true);
  });
});

describe('存失敗不能弄丟記憶體裡的卡', () => {
  it('失敗：回 false、狀態沒存到；記憶體裡的卡原封不動；下一次存得到最新的', async () => {
    const t = setup(cardWith('c1', [1]));
    const before = t.card;
    const snapshot = structuredClone(before);
    t.store.failSaves = 1;
    expect(await t.saver.flush()).toBe(false);
    expect(t.saver.status()).toBe('error');
    expect(t.statuses.at(-1)).toBe('error');
    expect(t.card).toBe(before);
    expect(t.card).toEqual(snapshot);
    expect(t.saver.isSaved(t.card)).toBe(false);
    // 恢復後：沒有新的改動也會重存（上次沒存到）
    expect(await t.saver.flush()).toBe(true);
    expect(t.saver.status()).toBe('saved');
    expect(t.store.saved.get('c1')!.card).toEqual(snapshot);
  });

  it('失敗之後繼續改：下一次存的是最新的', async () => {
    const t = setup(cardWith('c1', [1]));
    t.store.failSaves = 1;
    await t.saver.flush();
    t.card = updateCard(t.card, { name: '失敗後改的' });
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.saved.get('c1')!.card.name).toBe('失敗後改的');
  });
});

describe('什麼時候存（SCHEMA §3）', () => {
  it('一個動作完成：馬上（同一輪的好幾個改變合成一次）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    t.saver.changed();
    t.saver.changed();
    t.saver.changed();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(t.saver.status()).toBe('saved'));
    expect(t.store.log.filter((l) => l.startsWith('save:'))).toHaveLength(1);
  });

  it('文字輸入：停手後才存（文字框停 0.6 秒才送＋這裡 0.4 秒＝停手 1 秒）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(TEXT_SAVE_DELAY_MS).toBe(400);
    const t = setup(cardWith('c1', [1]));
    t.saver.changed(TEXT_SAVE_DELAY_MS);
    await vi.advanceTimersByTimeAsync(TEXT_SAVE_DELAY_MS - 1);
    expect(t.store.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(t.store.log.some((l) => l.startsWith('save:'))).toBe(true));
  });
});

describe('縮圖：不用每次都產生', () => {
  it('flush({ thumbnail: true })：產生一張跟著存；沒改變就不再產生', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.flush({ thumbnail: true });
    expect(t.thumbs()).toBe(1);
    expect(t.store.saved.get('c1')!.thumbnail).toBeInstanceOf(Blob);
    await t.saver.flush({ thumbnail: true });
    expect(t.thumbs()).toBe(1);
  });

  it('一般存檔不產生縮圖', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.flush();
    expect(t.thumbs()).toBe(0);
    expect(t.store.log).toContain('save:c1:未命名卡片');
  });

  it('停手約 2 秒後補一張縮圖', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    t.saver.changed();
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS - 10);
    expect(t.thumbs()).toBe(0);
    t.saver.changed(); // 又動了：重新計時
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS - 10);
    expect(t.thumbs()).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(t.store.saved.get('c1')?.thumbnail).toBeInstanceOf(Blob));
    expect(t.thumbs()).toBe(1);
  });

  it('縮圖失敗：卡片照樣存（縮圖下次再補）', async () => {
    const t = setup(cardWith('c1', [1]), { thumbnail: () => Promise.reject(new Error('GPU 忙')) });
    expect(await t.saver.flush({ thumbnail: true })).toBe(true);
    expect(t.store.saved.get('c1')!.thumbnail).toBeUndefined();
    expect(t.saver.status()).toBe('saved');
  });

  it('縮圖一直不回來（例如分頁在背景）：等一下就放棄，卡片照樣存，隊伍不會卡死', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]), { thumbnail: () => new Promise<Blob | null>(() => {}) });
    const done = t.saver.flush({ thumbnail: true });
    await vi.advanceTimersByTimeAsync(THUMBNAIL_TIMEOUT_MS);
    expect(await done).toBe(true);
    expect(t.store.saved.get('c1')!.card.id).toBe('c1');
  });

  it('只補縮圖（卡片早就存好了）：不顯示「儲存中…」；縮圖存失敗也不算沒存到', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.flush();
    t.statuses.length = 0;
    expect(await t.saver.flush({ thumbnail: true })).toBe(true);
    expect(t.statuses).toEqual([]);
    expect(t.store.saved.get('c1')!.thumbnail).toBeInstanceOf(Blob);
    // 卡片又改了：補縮圖失敗前先要存卡片，這次照常顯示
    t.card = updateCard(t.card, { name: '改了' });
    await t.saver.flush();
    t.statuses.length = 0;
    // 同一個版本，只差縮圖（上一張縮圖是改之前的），這次寫入失敗
    t.store.failThumbs = 1;
    expect(await t.saver.flush({ thumbnail: true })).toBe(true);
    expect(t.statuses).toEqual([]);
    expect(t.saver.status()).toBe('saved');
  });

  it('3D 還沒好（thumbnail 回 null）：卡片照樣存', async () => {
    const t = setup(cardWith('c1', [1]), { thumbnail: async () => null });
    expect(await t.saver.flush({ thumbnail: true })).toBe(true);
    expect(t.store.saved.get('c1')!.thumbnail).toBeUndefined();
  });
});

describe('剛打開的卡', () => {
  it('opened(card, true)：算已經存好，不再寫一次；停手 2 秒後補縮圖', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    t.saver.opened(t.card, true);
    expect(t.saver.isSaved(t.card)).toBe(true);
    expect(t.saver.status()).toBe('saved');
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.log.filter((l) => l.startsWith('save:'))).toEqual([]);
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS);
    await vi.waitFor(() => expect(t.thumbs()).toBe(1));
  });

  it('opened(card, false)（新卡沒存進去）：下一次 flush 會存', async () => {
    const t = setup(cardWith('c1', [1]));
    t.saver.opened(t.card, false);
    expect(t.saver.isSaved(t.card)).toBe(false);
    expect(t.saver.status()).toBe('error');
    await t.saver.flush();
    expect(t.store.saved.has('c1')).toBe(true);
  });
});

describe('容量提醒（剩不到 10%）', () => {
  it('判斷：剩不到 10% 才算快滿；查不到就不算', () => {
    expect(storageNearlyFull({ usage: 91, quota: 100 })).toBe(true);
    expect(storageNearlyFull({ usage: 90, quota: 100 })).toBe(false);
    expect(storageNearlyFull({ usage: 10, quota: 100 })).toBe(false);
    expect(storageNearlyFull({ usage: 0, quota: 0 })).toBe(false);
    expect(storageNearlyFull(null)).toBe(false);
  });

  it('checkCapacity：快滿了提醒一次；同一次開啟不重複提醒', async () => {
    const t = setup(cardWith('c1', [1]));
    t.store.estimateValue = { usage: 95, quota: 100 };
    await t.saver.checkCapacity();
    await t.saver.checkCapacity();
    expect(t.lowWarnings()).toBe(1);
  });

  it(`不是每次存都查：每存 ${CAPACITY_CHECK_EVERY} 次查一次`, async () => {
    const t = setup(cardWith('c1', [1]));
    for (let i = 0; i < CAPACITY_CHECK_EVERY * 2; i++) {
      t.card = updateCard(t.card, { name: `第 ${i} 版` });
      await t.saver.flush();
    }
    expect(t.store.estimateCalls).toBe(2);
  });
});

describe('一改動就顯示「儲存中…」（T-409）', () => {
  it('文字輸入要停手才存：改了就先顯示儲存中，存好才回到已儲存', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    t.saver.opened(t.card, true);
    t.statuses.length = 0;
    t.card = updateCard(t.card, { name: '打字中' });
    t.saver.changed(TEXT_SAVE_DELAY_MS);
    expect(t.saver.status()).toBe('saving');
    expect(t.store.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(TEXT_SAVE_DELAY_MS);
    await vi.waitFor(() => expect(t.saver.status()).toBe('saved'));
    expect(t.statuses).toEqual(['saving', 'saved']);
  });

  it('改了又復原回存好的版本：存檔時發現不用存，也回到已儲存（不會卡在儲存中）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    const saved = t.card;
    t.saver.opened(saved, true);
    t.card = updateCard(saved, { name: '改一下' });
    t.saver.changed(TEXT_SAVE_DELAY_MS);
    expect(t.saver.status()).toBe('saving');
    t.card = saved; // 復原
    await vi.advanceTimersByTimeAsync(TEXT_SAVE_DELAY_MS);
    await vi.waitFor(() => expect(t.saver.status()).toBe('saved'));
    expect(t.store.log.filter((l) => l.startsWith('save:'))).toEqual([]);
  });

  it('存的途中又改了（下一次存檔已經排著）：中間不閃回「已儲存」', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    const gate = deferred();
    t.store.gate = gate.promise;
    t.saver.changed();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(t.store.log).toContain('save:c1:未命名卡片'));
    t.card = updateCard(t.card, { name: '又改了' });
    t.saver.changed(TEXT_SAVE_DELAY_MS);
    t.store.gate = null;
    gate.resolve();
    await vi.waitFor(() => expect(t.store.saved.get('c1')?.card.name).toBe('未命名卡片'));
    expect(t.saver.status()).toBe('saving');
    await vi.advanceTimersByTimeAsync(TEXT_SAVE_DELAY_MS);
    await vi.waitFor(() => expect(t.saver.status()).toBe('saved'));
    expect(t.statuses).toEqual(['saving', 'saved']);
  });
});

describe('存檔隊伍不會卡住（T-409）', () => {
  it('exclusive 的工作同步丟錯：錯誤丟給呼叫端，之後的存檔照常跑', async () => {
    const t = setup(cardWith('c1', [1]));
    const syncThrow = (() => {
      throw new Error('同步丟錯');
    }) as unknown as () => Promise<void>;
    await expect(t.saver.exclusive(syncThrow)).rejects.toThrow('同步丟錯');
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.saved.has('c1')).toBe(true);
  });

  it('存檔程式自己出錯（例如畫狀態時丟錯）：等著的人一定會收到結果，不會一直等', async () => {
    let broken = true;
    const t = setup(cardWith('c1', [1]), {
      onStatus: () => {
        if (broken) throw new Error('畫面壞了');
      },
    });
    expect(await t.saver.flush()).toBe(false);
    broken = false;
    expect(await t.saver.flush()).toBe(true);
  });
});

describe('交出編輯權（另一個分頁接手，T-409）', () => {
  it('suspend：等正在跑的存檔做完才回；之後改動、flush、補縮圖都不寫，exclusive 被拒絕', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    const gate = deferred();
    t.store.gate = gate.promise;
    const saving = t.saver.flush();
    let suspended = false;
    const suspending = t.saver.suspend().then(() => (suspended = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(suspended).toBe(false); // 存檔還在跑
    t.store.gate = null;
    gate.resolve();
    await saving;
    await suspending;
    t.store.log.length = 0;
    t.card = updateCard(t.card, { name: '交出去之後改的' });
    t.saver.changed();
    expect(await t.saver.flush({ thumbnail: true })).toBe(false);
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS * 2);
    expect(t.store.log).toEqual([]);
    await expect(t.saver.exclusive(async () => 1)).rejects.toThrow();
  });

  it('suspend 取消已經排定的存檔與縮圖', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(cardWith('c1', [1]));
    t.saver.changed(TEXT_SAVE_DELAY_MS);
    await t.saver.suspend();
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS * 2);
    expect(t.store.log).toEqual([]);
    expect(t.thumbs()).toBe(0);
  });

  it('resume：記憶體裡交出去之前的那一版不再寫回去；換成重新讀進來的卡之後照常存', async () => {
    const t = setup(cardWith('c1', [1]));
    await t.saver.suspend();
    const stale = updateCard(t.card, { name: '交出去前沒存到的舊版' });
    t.card = stale;
    t.saver.resume();
    expect(await t.saver.flush({ thumbnail: true })).toBe(true);
    expect(t.store.log).toEqual([]);
    expect(t.thumbs()).toBe(0);
    // 重新讀進來的卡
    const fresh = cardWith('c2', [3]);
    t.card = fresh;
    t.saver.opened(fresh, true);
    t.card = updateCard(fresh, { name: '接手後改的' });
    expect(await t.saver.flush()).toBe(true);
    expect(t.store.saved.get('c2')!.card.name).toBe('接手後改的');
  });
});
