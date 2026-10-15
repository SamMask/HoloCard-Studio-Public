// 水鏡遠景（T-815，view.waterScene?）的資料流：存檔讀得回、複製一份帶著；卡片檔匯出時 'lake' 省略、其他照寫，
// 匯入照 SCHEMA §4 驗（三選一）；來回一致；舊卡（沒有 waterScene）照讀。圖在 public/stages/，不進卡片檔。
import { strFromU8, unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createSession } from '../src/app/session';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, WaterScene } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const T0 = '2026-10-15T00:00:00.000Z';
const LATER = '2026-10-15T08:30:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: true };
}

/** 正面一個立體層（圖 layerImage），舞台水鏡、遠景 scene。 */
function waterCard(id: string, layerImage: number, scene: WaterScene): Card {
  const added = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-l`, name: '龍', image: hashOf(layerImage), hasAlpha: true, width: 64, height: 96 });
  if (!added.ok) throw new Error(added.reason);
  return updateCard(added.card, { view: { stage: 'water', waterScene: scene } });
}

describe('資料庫與複製', () => {
  it('存好讀得回；複製一份也帶著遠景', async () => {
    const store = await openCardStore(new IDBFactory());
    await store.saveImage(image(2));
    const card = waterCard('a', 2, 'fuji');
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
    expect(copy.ok && copy.card.view.waterScene).toBe('fuji');
  });
});

describe('卡片檔 .holocard', () => {
  const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
  const preview = () => new Blob([PREVIEW], { type: 'image/png' });
  const opts = { newId: () => 'imported', now: () => LATER };
  const reason = (r: ImportResult) => (r.ok ? 'ok' : r.reason);

  async function fixture(scene: WaterScene) {
    const heroBytes = makeWebp({ kind: 'extended', width: 80, height: 120, alpha: true, seed: 2 });
    const hero = await stored(heroBytes, 'image/webp', 80, 120, true);
    const added = addLayer(newCard('standard', 'card-1', T0), 'front', { id: 'hero', name: '星晶龍', image: hero.hash, hasAlpha: true, width: 80, height: 120 });
    if (!added.ok) throw new Error(added.reason);
    const card = updateCard(added.card, { view: { stage: 'water', waterScene: scene } });
    const images = new Map([[hero.hash, hero] as const]);
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

  it('匯出：水墨山、富士山寫進 card.json；湖光山峰省略；遠景的圖不打包', async () => {
    for (const scene of ['ink', 'fuji'] as const) {
      const fx = await fixture(scene);
      const blob = await exportHolocard(fx.card, async (h) => fx.images.get(h), preview());
      expect((await cardJson(blob)).view.waterScene).toBe(scene);
      const names = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())));
      expect(names.sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    }
    const lake = await fixture('lake');
    const explicit = { ...lake.card, view: { ...lake.card.view, waterScene: 'lake' as const } };
    const json = await cardJson(await exportHolocard(explicit, async (h) => lake.images.get(h), preview()));
    expect('waterScene' in json.view).toBe(false);
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣', async () => {
    const fx = await fixture('fuji');
    const result = await importHolocard(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()), opts);
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...fx.card, id: 'imported', createdAt: LATER, updatedAt: LATER });
  });

  it('匯入明寫 lake 的卡片檔照讀', async () => {
    const fx = await fixture('lake');
    const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, waterScene: 'lake' } }, fx.files), opts);
    expect(reason(result)).toBe('ok');
  });

  it('匯入壞值 → invalid-card（指到 view.waterScene）', async () => {
    const fx = await fixture('ink');
    for (const bad of ['sea', 3, null, { scene: 'ink' }]) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, waterScene: bad } }, fx.files), opts);
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/view\.waterScene/);
    }
  });

  it('舊卡（沒有 waterScene）照讀，讀進來也沒有這個欄位', async () => {
    const fx = await fixture('ink');
    const { waterScene: _w, ...view } = fx.card.view;
    const result = await importHolocard(holocard({ ...fx.card, view }, fx.files), opts);
    expect(reason(result)).toBe('ok');
    if (result.ok) expect('waterScene' in result.card.view).toBe(false);
  });
});
