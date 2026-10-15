import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LAST_OPENED_KEY } from '../src/app/autosave';
import { copyName, createSession, openOrderAfterDelete, type SessionDeps } from '../src/app/session';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import type { CardStore, StorageEstimate } from '../src/storage/types';

// 卡片庫面板（T-407，DESIGN 7.2）的資料流：清單＋容量、改名、複製一份、匯出不用先打開、刪除（含刪開著的那張）。

const T0 = '2026-10-13T00:00:00.000Z';
const T1 = '2026-10-13T01:00:00.000Z';
const T2 = '2026-10-13T02:00:00.000Z';
const T3 = '2026-10-13T03:00:00.000Z';
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
      return new Blob([`thumb-${state.current?.id}-${state.current?.name}`], { type: 'image/webp' });
    },
    settle: async () => {},
    onStatus: () => {},
    onStorageLow: () => {},
    ...overrides,
  });
  return { session, registry, state };
}

/** 開著 id 這張（已存），其他卡照給的順序先存進去。 */
async function openWith(store: CardStore, open: Card, others: Card[] = []) {
  for (const c of others) await seed(store, c);
  await seed(store, open);
  await store.setMeta(LAST_OPENED_KEY, open.id);
  const h = harness(store);
  const choice = await h.session.chooseStart();
  await h.session.openStart(choice!.card);
  return h;
}

const ids = (n = 'copy-id', now = T3) => ({ newId: () => n, now: () => now });

// ---- 純函式 ----

describe('複製一份的卡名', () => {
  it('卡名後面加「（副本）」', () => {
    expect(copyName('月夜海景之卡')).toBe('月夜海景之卡（副本）');
  });

  it('加了之後超過 60 字：先截前面，總長剛好 60 字（以 Unicode 字元計）', () => {
    const long = '星'.repeat(60);
    const out = copyName(long);
    expect(Array.from(out)).toHaveLength(60);
    expect(out.endsWith('（副本）')).toBe(true);
    const emoji = '🌙'.repeat(59);
    expect(Array.from(copyName(emoji))).toHaveLength(60);
  });

  it('前後空白去掉；空的用「未命名卡片」', () => {
    expect(copyName('  卡  ')).toBe('卡（副本）');
    expect(copyName('   ')).toBe('未命名卡片（副本）');
  });
});

describe('刪掉開著的那張之後要開哪一張', () => {
  const s = (id: string, updatedAt: string) => ({ id, updatedAt });

  it('其他卡依最近編輯排序（刪掉的那張不算）', () => {
    expect(openOrderAfterDelete([s('a', T1), s('b', T3), s('c', T2)], 'b')).toEqual(['c', 'a']);
  });

  it('沒有別張 → 空的（由呼叫端建一張空白標準卡）', () => {
    expect(openOrderAfterDelete([s('a', T1)], 'a')).toEqual([]);
    expect(openOrderAfterDelete([], 'a')).toEqual([]);
  });

  it('日期壞掉的排最後，不會讓排序亂掉', () => {
    expect(openOrderAfterDelete([s('bad', 'nope'), s('a', T1), s('x', T0)], 'zzz')).toEqual(['a', 'x', 'bad']);
  });
});

// ---- 清單 ----

describe('卡片庫的內容（library）', () => {
  it('先存好目前這張（記憶體裡的最新改動＋縮圖）再讀清單：清單上是最新的名字與縮圖', async () => {
    const store = await freshStore();
    const h = await openWith(store, cardWith('cur', [1], T2), [cardWith('other', [3], T1)]);
    h.state.current = updateCard(h.state.current!, { name: '剛改的名字' });
    const data = await h.session.library();
    expect(data.cards.map((c) => c.id)).toEqual(['cur', 'other']);
    expect(data.cards[0]!.name).toBe('剛改的名字');
    expect(await data.cards[0]!.thumbnail!.text()).toBe('thumb-cur-剛改的名字');
  });

  it('沒有縮圖的卡附上卡身顏色（畫照比例的卡片外形）', async () => {
    const store = await freshStore();
    const colored = { ...cardWith('plain', [3], T1), bodyColor: '#334455' };
    await seed(store, colored);
    await seed(store, cardWith('withThumb', [5], T0), new Blob(['t'], { type: 'image/webp' }));
    const h = harness(store);
    const data = await h.session.library();
    expect(data.cards.find((c) => c.id === 'plain')!.bodyColor).toBe('#334455');
    expect(data.cards.find((c) => c.id === 'withThumb')!.thumbnail).toBeInstanceOf(Blob);
  });

  it('容量剩不到 10% → storageLow；查不到容量 → 不提醒', async () => {
    const store = await freshStore();
    await seed(store, cardWith('a', [1]));
    const low: CardStore = { ...store, estimate: async (): Promise<StorageEstimate> => ({ usage: 95, quota: 100 }) };
    expect((await harness(low).session.library()).storageLow).toBe(true);
    const fine: CardStore = { ...store, estimate: async (): Promise<StorageEstimate> => ({ usage: 50, quota: 100 }) };
    expect((await harness(fine).session.library()).storageLow).toBe(false);
    const unknown: CardStore = { ...store, estimate: async () => Promise.reject(new Error('不支援')) };
    expect((await harness(unknown).session.library()).storageLow).toBe(false);
  });

  it('存檔不能用 → 空清單', async () => {
    expect(await harness(null).session.library()).toEqual({ cards: [], storageLow: false });
  });
});

// ---- 改名 ----

describe('在卡片庫改名（不用打開那張卡）', () => {
  it('別張：存進去；排序不變（updatedAt 不動，格子不會跳走）；縮圖還在', async () => {
    const store = await freshStore();
    const thumb = new Blob(['other-thumb'], { type: 'image/webp' });
    await seed(store, cardWith('other', [3], T1), thumb);
    const h = await openWith(store, cardWith('cur', [1], T2));
    expect(await h.session.rename('other', '  新名字  ')).toBe('renamed');
    const saved = (await store.load('other'))!;
    expect(saved.name).toBe('新名字');
    expect(saved.updatedAt).toBe(T1);
    expect(await (await store.list()).find((c) => c.id === 'other')!.thumbnail!.text()).toBe('other-thumb');
  });

  it('開著的那張：is-open（由畫面走 editCard，可以復原）', async () => {
    const store = await freshStore();
    const h = await openWith(store, cardWith('cur', [1]));
    expect(await h.session.rename('cur', '別的')).toBe('is-open');
    expect((await store.load('cur'))!.name).toBe('未命名卡片');
  });

  it('空白名字：不改；卡不見了：missing', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3], T1));
    const h = await openWith(store, cardWith('cur', [1], T2));
    expect(await h.session.rename('other', '   ')).toBe('renamed');
    expect((await store.load('other'))!.name).toBe('未命名卡片');
    expect(await h.session.rename('nope', '名字')).toBe('missing');
  });
});

// ---- 複製一份 ----

describe('複製一份', () => {
  it('別張：新 id、卡名加（副本）、新時間、圖共用、縮圖一起複製；不切換過去', async () => {
    const store = await freshStore();
    const thumb = new Blob(['other-thumb'], { type: 'image/webp' });
    await seed(store, { ...cardWith('other', [3, 4], T1), name: '夜庭' }, thumb);
    const h = await openWith(store, cardWith('cur', [1], T2));
    const out = await h.session.duplicate('other', ids());
    expect(out).toMatchObject({ ok: true });
    const copy = (await store.load('copy-id'))!;
    expect(copy.name).toBe('夜庭（副本）');
    expect(copy.createdAt).toBe(T3);
    expect(copy.updatedAt).toBe(T3);
    expect(copy.front.layers.map((l) => l.image)).toEqual([hashOf(3), hashOf(4)]);
    const list = await store.list();
    expect(list[0]!.id).toBe('copy-id'); // 最新的排最前面
    expect(await list[0]!.thumbnail!.text()).toBe('other-thumb');
    expect(h.state.current!.id).toBe('cur');
    // 原本那張不動
    expect((await store.load('other'))!.name).toBe('夜庭');
  });

  it('開著的那張：先存好記憶體裡的最新版，複製的是最新版；還是停在原本這張', async () => {
    const store = await freshStore();
    const h = await openWith(store, cardWith('cur', [1], T2));
    h.state.current = updateCard(h.state.current!, { name: '剛改的' });
    const out = await h.session.duplicate('cur', ids());
    expect(out).toMatchObject({ ok: true });
    expect((await store.load('copy-id'))!.name).toBe('剛改的（副本）');
    expect((await store.load('cur'))!.name).toBe('剛改的');
    expect(await (await store.list()).find((c) => c.id === 'copy-id')!.thumbnail!.text()).toBe('thumb-cur-剛改的');
    expect(h.state.current!.id).toBe('cur');
  });

  it('卡片故事（T-804）跟著複製：別張與開著的那張都一樣；存檔讀回也還在', async () => {
    const story = { text: '一輪明月照星海\n龍鱗映出遠古的光', font: 'huninn' as const };
    const store = await freshStore();
    await seed(store, { ...cardWith('other', [3], T1), story });
    const h = await openWith(store, cardWith('cur', [1], T2));
    expect((await store.load('other'))!.story).toEqual(story);
    await h.session.duplicate('other', ids('copy-other'));
    expect((await store.load('copy-other'))!.story).toEqual(story);

    h.state.current = updateCard(h.state.current!, { story: { text: '星海', font: 'iansui' } });
    await h.session.duplicate('cur', ids('copy-cur'));
    expect((await store.load('copy-cur'))!.story).toEqual({ text: '星海', font: 'iansui' });
  });

  it('刪掉原本那張，副本的圖還在（圖是共用的，只清沒人用的）', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3], T1));
    const h = await openWith(store, cardWith('cur', [1], T2));
    await h.session.duplicate('other', ids());
    expect(await h.session.remove('other')).toBe('removed');
    expect(await store.loadImage(hashOf(3))).toBeDefined();
    expect((await store.load('copy-id'))!.front.layers[0]!.image).toBe(hashOf(3));
  });

  it('那張卡不見了：missing；開著的那張存不起來：not-saved（不複製）', async () => {
    const store = await freshStore();
    const h = await openWith(store, cardWith('cur', [1], T2));
    expect(await h.session.duplicate('nope', ids())).toEqual({ ok: false, reason: 'missing' });

    const store2 = await freshStore();
    await seed(store2, cardWith('cur', [1], T2));
    const failing: CardStore = { ...store2, save: async () => Promise.reject(new Error('磁碟滿了')) };
    const f = harness(failing);
    await f.session.openStart((await f.session.chooseStart())!.card);
    f.state.current = updateCard(f.state.current!, { name: '沒存到' });
    expect(await f.session.duplicate('cur', ids())).toEqual({ ok: false, reason: 'not-saved' });
    expect(await store2.load('copy-id')).toBeUndefined();
  });
});

// ---- 匯出不用先打開 ----

describe('匯出卡片檔要用的資料（不用先打開那張卡）', () => {
  it('卡片、用到的每張圖、縮圖；不會換卡、不動登記簿', async () => {
    const store = await freshStore();
    const thumb = new Blob(['other-thumb'], { type: 'image/webp' });
    await seed(store, cardWith('other', [3, 4], T1), thumb);
    const h = await openWith(store, cardWith('cur', [1], T2));
    const data = (await h.session.cardForExport('other'))!;
    expect(data.card.id).toBe('other');
    expect(data.images.map((i) => i.hash).sort()).toEqual([hashOf(3), hashOf(4)]);
    expect(await data.thumbnail!.text()).toBe('other-thumb');
    expect(h.state.current!.id).toBe('cur');
    expect([...h.registry.keys()]).toEqual([hashOf(1)]);
  });

  it('卡不見了或缺圖 → null', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3], T1));
    const h = await openWith(store, cardWith('cur', [1], T2));
    expect(await h.session.cardForExport('nope')).toBeNull();
    const broken = harness({ ...store, loadImage: async () => undefined });
    expect(await broken.session.cardForExport('other')).toBeNull();
  });
});

// ---- 刪除 ----

describe('刪除（確認框之後）', () => {
  const blank = () => newCard('standard', 'blank-id', T3);

  it('別張：直接刪（和它獨用的圖），開著的那張不動', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3], T1));
    const h = await openWith(store, cardWith('cur', [1], T2));
    await h.session.deleteCard('other', blank);
    expect(await store.load('other')).toBeUndefined();
    expect(await store.loadImage(hashOf(3))).toBeUndefined();
    expect(h.state.current!.id).toBe('cur');
  });

  it('開著的那張：先開最近編輯的另一張，再刪；重新整理會開到新開的那張', async () => {
    const store = await freshStore();
    await seed(store, cardWith('older', [5], T0));
    await seed(store, cardWith('recent', [3], T1));
    const h = await openWith(store, cardWith('cur', [1], T2));
    h.state.current = updateCard(h.state.current!, { name: '要刪的卡、改到一半' });
    await h.session.deleteCard('cur', blank);
    expect(h.state.current!.id).toBe('recent');
    expect([...h.registry.keys()]).toEqual([hashOf(3)]);
    expect(await store.load('cur')).toBeUndefined();
    expect(await store.loadImage(hashOf(1))).toBeUndefined();
    expect((await store.list()).map((c) => c.id)).toEqual(['recent', 'older']);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('recent');
    expect(h.session.saver.isSaved(h.state.current)).toBe(true);
    // 重新整理
    const again = harness(store);
    expect((await again.session.chooseStart())!.card.id).toBe('recent');
  });

  it('開著的那張而且沒有別張：建一張空白標準卡（存進卡片庫）再刪', async () => {
    const store = await freshStore();
    const h = await openWith(store, cardWith('only', [1], T2));
    await h.session.deleteCard('only', blank);
    expect(h.state.current!.id).toBe('blank-id');
    expect(h.state.current!.aspect).toBe('standard');
    expect((await store.list()).map((c) => c.id)).toEqual(['blank-id']);
    expect(await store.loadImage(hashOf(1))).toBeUndefined();
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe('blank-id');
  });

  it('最近的那張讀不到（壞掉）：跳過，開下一張', async () => {
    const store = await freshStore();
    await seed(store, cardWith('fine', [5], T0));
    await seed(store, cardWith('broken', [3], T1));
    const h0 = await openWith(store, cardWith('cur', [1], T2));
    const picky: CardStore = { ...store, loadImage: async (hash) => (hash === hashOf(3) ? undefined : store.loadImage(hash)) };
    const h = harness(picky);
    await h.session.openStart(h0.state.current!);
    await h.session.deleteCard('cur', blank);
    expect(h.state.current!.id).toBe('fine');
    expect(await store.load('cur')).toBeUndefined();
  });

  it('連點兩次刪除同一張：第二次什麼都不會壞', async () => {
    const store = await freshStore();
    await seed(store, cardWith('other', [3], T1));
    const h = await openWith(store, cardWith('cur', [1], T2));
    await Promise.all([h.session.deleteCard('cur', blank), h.session.deleteCard('cur', blank)]);
    expect(h.state.current!.id).toBe('other');
    expect((await store.list()).map((c) => c.id)).toEqual(['other']);
  });
});

describe('卡片比例（T-807）：卡片庫的格子照比例', () => {
  it('自訂比例的卡附上寬高（有縮圖也附）；其他比例不附', async () => {
    const store = await freshStore();
    const wide = { ...cardWith('wide', [3], T2), aspect: 'custom' as const, customAspect: { width: 3, height: 2 } };
    await seed(store, wide, new Blob(['t'], { type: 'image/webp' }));
    await seed(store, { ...cardWith('square', [5], T1), aspect: 'square' as const }, new Blob(['s'], { type: 'image/webp' }));
    const data = await harness(store).session.library();
    const byId = (id: string) => data.cards.find((c) => c.id === id)!;
    expect(byId('wide').customAspect).toEqual({ width: 3, height: 2 });
    expect(byId('wide').aspect).toBe('custom');
    expect(byId('wide').thumbnail).toBeInstanceOf(Blob);
    expect(byId('square').aspect).toBe('square');
    expect('customAspect' in byId('square')).toBe(false);
  });

  it('複製一份：自訂比例的寬高跟著複製', async () => {
    const store = await freshStore();
    await seed(store, { ...cardWith('other', [3], T1), aspect: 'custom' as const, customAspect: { width: 4, height: 3 } });
    const h = await openWith(store, cardWith('cur', [1], T2));
    expect(await h.session.duplicate('other', ids())).toMatchObject({ ok: true });
    const copy = (await store.load('copy-id'))!;
    expect(copy.aspect).toBe('custom');
    expect(copy.customAspect).toEqual({ width: 4, height: 3 });
  });
});
