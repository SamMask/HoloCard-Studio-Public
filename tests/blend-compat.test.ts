// T-408：Layer.opacity?／blend? 可省略（省略＝100／normal），不升 formatVersion。
// 舊卡（沒有這兩個欄位）與有新欄位的卡，存讀（IndexedDB）與卡片檔匯出入都要原樣來回。
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { StoredImage } from '../src/images/types';
import { updateLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, Layer } from '../src/model/types';
import { validateCard } from '../src/model/validate';
import { openCardStore } from '../src/storage/store';
import { makePng, makeWebp, stored } from './file-fixtures';

const NOW = '2026-10-13T00:00:00.000Z';
const LATER = '2026-10-14T08:30:00.000Z';

interface Fixture {
  /** 舊卡：照 T-408 以前的格式（圖層沒有 opacity／blend）。 */
  old: Card;
  /** 有新欄位：半透明的立體層、沒有透明的發光層、疊色的文字層。 */
  fresh: Card;
  images: Map<string, StoredImage>;
}

async function fixture(): Promise<Fixture> {
  const base = await stored(makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 1 }), 'image/webp', 1000, 1400, false);
  const hero = await stored(makeWebp({ kind: 'extended', width: 800, height: 1200, alpha: true, seed: 2 }), 'image/webp', 800, 1200, true);
  const glow = await stored(makeWebp({ kind: 'lossy', width: 600, height: 600, seed: 3 }), 'image/webp', 600, 600, false);
  const title = await stored(makePng({ width: 8, height: 4, colorType: 6, seed: 4 }), 'image/png', 8, 4, true);
  const layer = (over: Partial<Layer> & Pick<Layer, 'id' | 'image'>): Layer => ({
    name: over.id,
    role: 'depth',
    visible: true,
    depth: 50,
    x: 0,
    y: 0,
    scale: 1,
    holo: true,
    hasAlpha: true,
    ...over,
  });
  const old: Card = {
    ...newCard('standard', 'old-card', NOW),
    name: '舊卡',
    front: {
      layers: [
        layer({ id: 'base', image: base.hash, role: 'base', depth: 0, hasAlpha: false, holo: false, scale: 1.4 }),
        layer({ id: 'hero', image: hero.hash, depth: 40 }),
        layer({
          id: 'title',
          image: title.hash,
          depth: 80,
          text: { content: '月夜', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' },
        }),
      ],
    },
    back: { layers: [layer({ id: 'back-hero', image: hero.hash })] },
  };
  let fresh: Card = {
    ...old,
    id: 'new-card',
    front: { layers: [...old.front.layers, layer({ id: 'glow', image: glow.hash, depth: 90, hasAlpha: false, blend: 'screen' })] },
  };
  fresh = updateLayer(fresh, 'front', 'hero', { opacity: 45 });
  fresh = updateLayer(fresh, 'front', 'title', { blend: 'overlay', opacity: 80 });
  fresh = updateLayer(fresh, 'front', 'glow', { opacity: 70 });
  return { old, fresh, images: new Map([base, hero, glow, title].map((img) => [img.hash, img])) };
}

const allLayers = (c: Card) => [...c.front.layers, ...c.back.layers];

describe('T-408 欄位可省略：舊卡照讀', () => {
  it('測試資料：舊卡沒有新欄位、新卡每一種都有，兩張都合格', async () => {
    const { old, fresh, images } = await fixture();
    for (const l of allLayers(old)) {
      expect('opacity' in l).toBe(false);
      expect('blend' in l).toBe(false);
    }
    expect(fresh.front.layers.map((l) => [l.id, l.opacity, l.blend])).toEqual([
      ['base', undefined, undefined],
      ['hero', 45, undefined],
      ['title', 80, 'overlay'],
      ['glow', 70, 'screen'],
    ]);
    expect(validateCard(old, (h) => images.has(h))).toEqual([]);
    expect(validateCard(fresh, (h) => images.has(h))).toEqual([]);
  });

  it('存讀（IndexedDB）：舊卡讀回來一模一樣、沒有多出欄位；新欄位原樣存讀', async () => {
    const { old, fresh, images } = await fixture();
    const store = await openCardStore(new IDBFactory());
    for (const img of images.values()) await store.saveImage(img);
    await store.save(old);
    await store.save(fresh);
    const oldBack = await store.load(old.id);
    const freshBack = await store.load(fresh.id);
    expect(oldBack).toEqual(old);
    for (const l of allLayers(oldBack!)) {
      expect('opacity' in l).toBe(false);
      expect('blend' in l).toBe(false);
    }
    expect(freshBack).toEqual(fresh);
  });

  it('存檔裡壞掉的新欄位（底圖有 blend、沒有透明的層用 overlay）→ 讀不出來（當成壞資料）', async () => {
    const { fresh, images } = await fixture();
    const store = await openCardStore(new IDBFactory());
    for (const img of images.values()) await store.saveImage(img);
    const badBase = structuredClone(fresh) as Card;
    badBase.front.layers[0]!.blend = 'normal';
    await expect(store.save(badBase)).rejects.toThrow();
    const badGlow = structuredClone(fresh) as Card;
    badGlow.front.layers[3]!.blend = 'overlay';
    await expect(store.save(badGlow)).rejects.toThrow();
  });

  it('卡片檔：舊卡匯出再匯入，圖層一模一樣（不會多出 opacity／blend）', async () => {
    const { old, images } = await fixture();
    const blob = await exportHolocard(old, async (h) => images.get(h), new Blob([makePng({ width: 8, height: 8, seed: 99 })], { type: 'image/png' }));
    const r = await importHolocard(blob, { newId: () => 'imported', now: () => LATER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.card.front).toEqual(old.front);
    expect(r.card.back).toEqual(old.back);
    for (const l of allLayers(r.card)) {
      expect('opacity' in l).toBe(false);
      expect('blend' in l).toBe(false);
    }
  });

  it('卡片檔：新欄位匯出再匯入原樣保留（formatVersion 仍是 1）', async () => {
    const { fresh, images } = await fixture();
    const blob = await exportHolocard(fresh, async (h) => images.get(h), new Blob([makePng({ width: 8, height: 8, seed: 99 })], { type: 'image/png' }));
    const r = await importHolocard(blob, { newId: () => 'imported', now: () => LATER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.card.formatVersion).toBe(1);
    expect(r.card.front).toEqual(fresh.front);
    expect(r.card.back).toEqual(fresh.back);
  });

  // T-413：exportHolocard 寫出前用 model/actions 的 omitLayerDefaults 整理
  it('卡片檔：匯入明寫預設值（opacity: 100、blend: normal）的卡 → 再匯出 → 卡片檔裡沒有這兩個欄位（T-413）', async () => {
    const { old, images } = await fixture();
    const explicit = structuredClone(old);
    Object.assign(explicit.front.layers[1]!, { opacity: 100, blend: 'normal' });
    Object.assign(explicit.back.layers[0]!, { opacity: 100 });
    const preview = () => new Blob([makePng({ width: 8, height: 8, seed: 99 })], { type: 'image/png' });
    const first = await exportHolocard(explicit, async (h) => images.get(h), preview());
    const imported = await importHolocard(first, { newId: () => 'imported', now: () => LATER });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const again = await exportHolocard(imported.card, async (h) => images.get(h), preview());
    const reread = await importHolocard(again, { newId: () => 'again', now: () => LATER });
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    for (const l of allLayers(reread.card)) {
      expect('opacity' in l).toBe(false);
      expect('blend' in l).toBe(false);
    }
    expect(reread.card.front).toEqual(old.front);
    expect(reread.card.back).toEqual(old.back);
  });
});
