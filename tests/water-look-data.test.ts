// 水鏡的水面樣子（T-825，view.waterLook?）的資料流：存檔讀得回、複製一份帶著；卡片檔匯出時〔夜色〕省略、其他照寫，
// 匯入照 SCHEMA §4 驗（6 個 0～100 的整數＋2 個 #rrggbb）；來回一致；舊卡（沒有 waterLook）照讀。
import { strFromU8, unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LAST_OPENED_KEY } from '../src/app/autosave';
import { createSession } from '../src/app/session';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { DEFAULT_WATER_LOOK, MIST_WATER_LOOK } from '../src/model/limits';
import type { Card, WaterLook } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const T0 = '2026-10-15T00:00:00.000Z';
const LATER = '2026-10-15T08:30:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');
const LOOK: WaterLook = { ...MIST_WATER_LOOK, glint: 12, glintColor: '#aabbcc' };

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: true };
}

describe('資料庫', () => {
  it('存好讀得回', async () => {
    const store = await openCardStore(new IDBFactory());
    await store.saveImage(image(2));
    const added = addLayer(newCard('standard', 'a', T0), 'front', { id: 'a-l', name: '龍', image: hashOf(2), hasAlpha: true, width: 64, height: 96 });
    if (!added.ok) throw new Error(added.reason);
    const card = updateCard(added.card, { view: { stage: 'water', waterLook: LOOK } });
    expect(card.view.waterLook).toEqual(LOOK);
    await store.save(card);
    expect(await store.load('a')).toEqual(card);
  });
});

// 卡片庫的〔複製一份〕走真的 session.duplicate（別張從存檔讀、開著的那張用記憶體裡最新的）：waterLook 要跟著帶過去
describe('複製一份（session.duplicate）', () => {
  const withLook = (id: string, imageNumber: number, look: WaterLook): Card => {
    const added = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-l`, name: '龍', image: hashOf(imageNumber), hasAlpha: true, width: 64, height: 96 });
    if (!added.ok) throw new Error(added.reason);
    return updateCard(added.card, { view: { stage: 'water', waterLook: look } });
  };

  async function openWith(open: Card, others: Card[]) {
    const store = await openCardStore(new IDBFactory());
    for (const c of [...others, open]) {
      await store.saveImage(image(parseInt(c.front.layers[0]!.image, 16)));
      await store.save(c);
    }
    await store.setMeta(LAST_OPENED_KEY, open.id);
    const registry = new Map<string, StoredImage>();
    const state = { current: null as Card | null };
    const session = createSession({
      store,
      images: {
        add: async (img) => void registry.set(img.hash, img),
        get: (h) => registry.get(h),
        retain: () => {},
      },
      current: () => state.current,
      show: (card) => void (state.current = card),
      thumbnail: async () => new Blob(['thumb'], { type: 'image/png' }),
      settle: async () => {},
      onStatus: () => {},
      onStorageLow: () => {},
    });
    const choice = await session.chooseStart();
    await session.openStart(choice!.card);
    return { store, session, state };
  }
  const ids = (newId: string) => ({ newId: () => newId, now: () => LATER });

  it('別張（從存檔讀）與開著的那張（記憶體裡改過的）：副本都帶著原本的 waterLook，存檔讀回也一樣；原卡不變', async () => {
    const other = withLook('other', 3, LOOK);
    const h = await openWith(withLook('cur', 1, DEFAULT_WATER_LOOK), [other]);
    expect(await h.session.duplicate('other', ids('copy-other'))).toMatchObject({ ok: true });
    expect((await h.store.load('copy-other'))!.view.waterLook).toEqual(LOOK);

    const changed = { ...LOOK, mist: 77, glintColor: '#112233' };
    h.state.current = updateCard(h.state.current!, { view: { waterLook: changed } });
    expect(await h.session.duplicate('cur', ids('copy-cur'))).toMatchObject({ ok: true });
    expect((await h.store.load('copy-cur'))!.view.waterLook).toEqual(changed);
    expect((await h.store.load('other'))!.view.waterLook).toEqual(LOOK);
  });

  it('〔夜色〕（沒調過）的卡複製後也還是沒有 waterLook 欄位', async () => {
    const plain = updateCard(withLook('plain', 3, LOOK), { view: { waterLook: DEFAULT_WATER_LOOK } });
    expect('waterLook' in plain.view).toBe(false);
    const h = await openWith(withLook('cur', 1, LOOK), [plain]);
    expect(await h.session.duplicate('plain', ids('copy-plain'))).toMatchObject({ ok: true });
    expect('waterLook' in (await h.store.load('copy-plain'))!.view).toBe(false);
  });
});

describe('卡片檔 .holocard', () => {
  const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
  const preview = () => new Blob([PREVIEW], { type: 'image/png' });
  const opts = { newId: () => 'imported', now: () => LATER };
  const reason = (r: ImportResult) => (r.ok ? 'ok' : r.reason);

  async function fixture(look: Partial<WaterLook>) {
    const heroBytes = makeWebp({ kind: 'extended', width: 80, height: 120, alpha: true, seed: 2 });
    const hero = await stored(heroBytes, 'image/webp', 80, 120, true);
    const added = addLayer(newCard('standard', 'card-1', T0), 'front', { id: 'hero', name: '星晶龍', image: hero.hash, hasAlpha: true, width: 80, height: 120 });
    if (!added.ok) throw new Error(added.reason);
    const card: Card = updateCard(added.card, { view: { stage: 'water', waterLook: look } });
    const images = new Map([[hero.hash, hero]] as const);
    const files: Record<string, Uint8Array> = { [`images/${hero.hash}.webp`]: heroBytes };
    return { card, images, files };
  }
  const holocard = (card: unknown, files: Record<string, Uint8Array>) => {
    const items: ZipItem[] = [{ name: 'card.json', data: utf8(JSON.stringify(card)) }];
    for (const [name, data] of Object.entries(files)) items.push({ name, data, method: 0 });
    items.push({ name: 'preview.png', data: PREVIEW, method: 0 });
    return new Blob([buildZip(items)]);
  };
  const cardJson = async (blob: Blob) => {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    return JSON.parse(strFromU8(files['card.json']!)) as { view: Record<string, unknown> };
  };

  it('匯出：調過的寫進 card.json；〔夜色〕（明寫的也一樣）省略', async () => {
    const fx = await fixture(LOOK);
    expect((await cardJson(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()))).view.waterLook).toEqual(LOOK);
    const plain = await fixture({});
    const explicit = { ...plain.card, view: { ...plain.card.view, waterLook: { ...DEFAULT_WATER_LOOK } } };
    const json = await cardJson(await exportHolocard(explicit, async (h) => plain.images.get(h), preview()));
    expect('waterLook' in json.view).toBe(false);
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣', async () => {
    const fx = await fixture(LOOK);
    const result = await importHolocard(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()), opts);
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...fx.card, id: 'imported', createdAt: LATER, updatedAt: LATER });
    expect(result.card.view.waterLook).toEqual(LOOK);
  });

  it('匯入明寫〔夜色〕、大寫顏色照讀', async () => {
    const fx = await fixture({});
    for (const look of [{ ...DEFAULT_WATER_LOOK }, { ...LOOK, mistColor: '#D3D8CF' }]) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, waterLook: look } }, fx.files), opts);
      expect(reason(result), JSON.stringify(look)).toBe('ok');
    }
  });

  it('匯入壞值 → invalid-card（指到 view.waterLook）', async () => {
    const fx = await fixture({});
    const bads: unknown[] = [{ ...LOOK, mist: 101 }, { ...LOOK, horizon: 1.5 }, { ...LOOK, glintColor: 'gold' }, { ...LOOK, extra: 1 }, (({ lift: _l, ...r }) => r)(LOOK), null, 'mist', [1]];
    for (const bad of bads) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, waterLook: bad } }, fx.files), opts);
      expect(reason(result), JSON.stringify(bad)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/view\.waterLook/);
    }
  });

  it('舊卡（沒有 waterLook）照讀，讀進來也沒有這個欄位', async () => {
    const fx = await fixture(LOOK);
    const { waterLook: _l, ...view } = fx.card.view;
    const result = await importHolocard(holocard({ ...fx.card, view }, fx.files), opts);
    expect(reason(result)).toBe('ok');
    if (result.ok) expect('waterLook' in result.card.view).toBe(false);
  });
});
