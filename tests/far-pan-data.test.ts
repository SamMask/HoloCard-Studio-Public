// 遠景的位置與大小（T-822，view.farPan?）的資料流：存檔讀得回、複製一份帶著；卡片檔匯出時 {0,0,1} 省略、其他照寫，
// 匯入照 SCHEMA §4 驗（三個有限數字、在範圍裡）；來回一致；舊卡（沒有 farPan）照讀。
import { strFromU8, unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createSession } from '../src/app/session';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, FarPan } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const T0 = '2026-10-15T00:00:00.000Z';
const LATER = '2026-10-15T08:30:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');
const PAN: FarPan = { x: 0.62, y: -0.3, zoom: 1.75 };

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: true };
}

/** 正面一個立體層（圖 layerImage），舞台水鏡＋富士山、遠景位置 pan。 */
function pannedCard(id: string, layerImage: number, pan: Partial<FarPan>): Card {
  const added = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-l`, name: '龍', image: hashOf(layerImage), hasAlpha: true, width: 64, height: 96 });
  if (!added.ok) throw new Error(added.reason);
  return updateCard(added.card, { view: { stage: 'water', waterScene: 'fuji', farPan: pan } });
}

describe('資料庫與複製', () => {
  it('存好讀得回；複製一份也帶著位置', async () => {
    const store = await openCardStore(new IDBFactory());
    await store.saveImage(image(2));
    const card = pannedCard('a', 2, PAN);
    expect(card.view.farPan).toEqual(PAN);
    await store.save(card);
    expect(await store.load('a')).toEqual(card);
    const registry = new Map<string, StoredImage>();
    let current: Card | null = null;
    const session = createSession({
      store,
      images: {
        add: async (img) => void registry.set(img.hash, img),
        get: (h) => registry.get(h),
        retain: (keep) => {
          for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
        },
      },
      current: () => current,
      show: (c) => void (current = c),
      thumbnail: async () => null,
      settle: async () => {},
      onStatus: () => {},
      onStorageLow: () => {},
    });
    const choice = await session.chooseStart();
    await session.openStart(choice!.card);
    const copy = await session.duplicate('a', { newId: () => 'a2', now: () => LATER });
    expect(copy.ok && copy.card.view.farPan).toEqual(PAN);
  });
});

describe('卡片檔 .holocard', () => {
  const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
  const preview = () => new Blob([PREVIEW], { type: 'image/png' });
  const opts = { newId: () => 'imported', now: () => LATER };
  const reason = (r: ImportResult) => (r.ok ? 'ok' : r.reason);

  async function fixture(pan: Partial<FarPan>, withBackdrop = false) {
    const heroBytes = makeWebp({ kind: 'extended', width: 80, height: 120, alpha: true, seed: 2 });
    const hero = await stored(heroBytes, 'image/webp', 80, 120, true);
    const bdBytes = makeWebp({ kind: 'extended', width: 160, height: 90, alpha: false, seed: 5 });
    const bd = await stored(bdBytes, 'image/webp', 160, 90, false);
    const added = addLayer(newCard('standard', 'card-1', T0), 'front', { id: 'hero', name: '星晶龍', image: hero.hash, hasAlpha: true, width: 80, height: 120 });
    if (!added.ok) throw new Error(added.reason);
    let card = updateCard(added.card, { view: { farPan: pan } });
    if (withBackdrop) card = setBackdrop(card, bd.hash);
    const images = new Map([
      [hero.hash, hero],
      [bd.hash, bd],
    ] as const);
    const files: Record<string, Uint8Array> = { [`images/${hero.hash}.webp`]: heroBytes };
    if (withBackdrop) files[`images/${bd.hash}.webp`] = bdBytes;
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

  it('匯出：調過的位置寫進 card.json；{0,0,1}（明寫的也一樣）省略', async () => {
    const fx = await fixture(PAN);
    expect((await cardJson(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()))).view.farPan).toEqual(PAN);
    const plain = await fixture({});
    const explicit = { ...plain.card, view: { ...plain.card.view, farPan: { x: 0, y: 0, zoom: 1 } } };
    const json = await cardJson(await exportHolocard(explicit, async (h) => plain.images.get(h), preview()));
    expect('farPan' in json.view).toBe(false);
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣（有背景圖、沒有背景圖都是）', async () => {
    for (const withBackdrop of [false, true]) {
      const fx = await fixture(PAN, withBackdrop);
      const result = await importHolocard(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()), opts);
      if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
      expect(result.card).toEqual({ ...fx.card, id: 'imported', createdAt: LATER, updatedAt: LATER });
      expect(result.card.view.farPan).toEqual(PAN);
    }
  });

  it('匯入明寫 {0,0,1}、沒四捨五入的小數照讀', async () => {
    const fx = await fixture({});
    for (const pan of [
      { x: 0, y: 0, zoom: 1 },
      { x: 0.123456, y: -0.987, zoom: 2.9999 },
    ]) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, farPan: pan } }, fx.files), opts);
      expect(reason(result), JSON.stringify(pan)).toBe('ok');
    }
  });

  it('匯入壞值 → invalid-card（指到 view.farPan）', async () => {
    const fx = await fixture({});
    const bads: unknown[] = [{ x: 2, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 0.5 }, { x: 0, y: 0 }, { x: '0', y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1, r: 1 }, null, 'center', [0, 0, 1]];
    for (const bad of bads) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, farPan: bad } }, fx.files), opts);
      expect(reason(result), JSON.stringify(bad)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/view\.farPan/);
    }
  });

  it('舊卡（沒有 farPan）照讀，讀進來也沒有這個欄位', async () => {
    const fx = await fixture(PAN);
    const { farPan: _p, ...view } = fx.card.view;
    const result = await importHolocard(holocard({ ...fx.card, view }, fx.files), opts);
    expect(reason(result)).toBe('ok');
    if (result.ok) expect('farPan' in result.card.view).toBe(false);
  });
});
