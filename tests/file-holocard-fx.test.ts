// T-811 動態特效（Layer.fx?）在卡片檔 `.holocard`（SCHEMA §4）：匯出時 card.json 帶著 fx、來回一致；
// 匯入照驗證（壞值、破框層帶 fx、一面超過 2 層 → invalid-card）；舊卡（沒有 fx）照讀。fx 沒有圖，不影響打包的圖。
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import type { Card, Layer, LayerFx } from '../src/model/types';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const NOW = '2026-10-15T00:00:00.000Z';
const LATER = '2026-10-15T08:30:00.000Z';
const OPTS = { newId: () => 'imported-id', now: () => LATER };
const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
const FIRE: LayerFx = { kind: 'fire', color: '#ff6a1f', strength: 70, speed: 50 };
const WATER: LayerFx = { kind: 'water', color: '#a8f0ff', strength: 35, speed: 10 };

interface Fixture {
  card: Card;
  images: Map<string, StoredImage>;
  files: Record<string, Uint8Array>;
}

/** 正面：底圖（水波）＋立體層（火焰）＋立體層；背面：同一張底圖。 */
async function fixture(): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 1 });
  const heroBytes = makeWebp({ kind: 'extended', width: 800, height: 1200, alpha: true, seed: 2 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1400, false);
  const hero = await stored(heroBytes, 'image/webp', 800, 1200, true);
  const baseLayer: Layer = { id: 'base', name: '底圖', role: 'base', image: base.hash, visible: true, depth: 0, x: 0, y: 0, scale: 1.4, holo: false, hasAlpha: false, fx: WATER };
  const heroLayer: Layer = { id: 'hero', name: '星晶龍', role: 'depth', image: hero.hash, visible: true, depth: 50, x: 0.1, y: -0.2, scale: 0.9, holo: true, hasAlpha: true, fx: FIRE };
  const { fx: _heroFx, ...plainHero } = heroLayer;
  const sideLayer: Layer = { ...plainHero, id: 'side', name: '側邊', depth: 70 };
  const card: Card = { ...newCard('standard', 'card-1', NOW), name: '火焰卡', front: { layers: [baseLayer, heroLayer, sideLayer] }, back: { layers: [{ ...baseLayer, id: 'back-base' }] } };
  return {
    card,
    images: new Map([base, hero].map((s) => [s.hash, s] as const)),
    files: { [`images/${base.hash}.webp`]: baseBytes, [`images/${hero.hash}.webp`]: heroBytes },
  };
}

function holocard(card: unknown, files: Record<string, Uint8Array>): Blob {
  const items: ZipItem[] = [{ name: 'card.json', data: utf8(JSON.stringify(card)) }];
  for (const [name, data] of Object.entries(files)) items.push({ name, data, method: 0 });
  items.push({ name: 'preview.png', data: PREVIEW, method: 0 });
  return new Blob([buildZip(items)]);
}

const importOf = (file: Blob): Promise<ImportResult> => importHolocard(file, OPTS);
const reason = (r: ImportResult) => (r.ok ? 'ok' : r.reason);
const exportOf = (fx: Fixture) => exportHolocard(fx.card, async (h) => fx.images.get(h), new Blob([PREVIEW], { type: 'image/png' }));

describe('卡片檔：動態特效（T-811）', () => {
  it('匯出：card.json 裡有 fx；打包的圖不變（fx 沒有圖）', async () => {
    const fx = await fixture();
    const files = unzipSync(new Uint8Array(await (await exportOf(fx)).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    const json = JSON.parse(strFromU8(files['card.json']!));
    expect(json.front.layers[0].fx).toEqual(WATER);
    expect(json.front.layers[1].fx).toEqual(FIRE);
    expect('fx' in json.front.layers[2]).toBe(false);
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣', async () => {
    const fx = await fixture();
    const result = await importOf(await exportOf(fx));
    expect(reason(result)).toBe('ok');
    if (!result.ok) return;
    expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
  });

  it('匯入壞值（種類、顏色、小數強度、超出範圍的速度、多欄位、null）→ invalid-card', async () => {
    const fx = await fixture();
    const bad: unknown[] = [
      { ...FIRE, kind: 'smoke' },
      { ...FIRE, color: 'orange' },
      { ...FIRE, strength: 12.5 },
      { ...FIRE, speed: 120 },
      { ...FIRE, run: 'alert(1)' },
      null,
    ];
    for (const value of bad) {
      const hero = { ...fx.card.front.layers[1]!, fx: value };
      const result = await importOf(holocard({ ...fx.card, front: { layers: [fx.card.front.layers[0], hero, fx.card.front.layers[2]] } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/fx/);
    }
  });

  it('匯入：破框層帶 fx、一面 3 層有 fx → invalid-card', async () => {
    const fx = await fixture();
    const [base, hero, side] = fx.card.front.layers as [Layer, Layer, Layer];
    const cases: Layer[][] = [
      [base, { ...hero, breakout: true }, side],
      [base, hero, { ...side, fx: FIRE }],
    ];
    for (const layers of cases) {
      const result = await importOf(holocard({ ...fx.card, front: { layers } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
    }
  });

  it('舊卡（沒有 fx）照讀', async () => {
    const fx = await fixture();
    const strip = (l: Layer): Layer => {
      const { fx: _fx, ...rest } = l;
      return rest;
    };
    const old = { ...fx.card, front: { layers: fx.card.front.layers.map(strip) }, back: { layers: fx.card.back.layers.map(strip) } };
    const result = await importOf(holocard(old, fx.files));
    expect(reason(result)).toBe('ok');
    if (result.ok) for (const l of result.card.front.layers) expect('fx' in l).toBe(false);
  });
});
