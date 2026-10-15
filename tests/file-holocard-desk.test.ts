// 工作桌舞台（view.stage: 'desk'，T-832）在卡片檔 `.holocard`（SCHEMA §1、§4）的來回（T-832c，T-832b 審查的低）：
// 工作桌的卡匯出再匯入，舞台還是工作桌、其他欄位（鐳射、卡框、view 的其他開關）與圖片位元組一樣；
// 新卡片（預設就是工作桌）也一樣；已經有的卡（全息光環）不變；formatVersion 照舊是 1（只是 view.stage 多一個值，不升版）。
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import type { Card, Layer, StageStyle } from '../src/model/types';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const NOW = '2026-10-15T00:00:00.000Z';
const LATER = '2026-10-15T08:30:00.000Z';
const OPTS = { newId: () => 'imported-id', now: () => LATER };
const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });

interface Fixture {
  card: Card;
  images: Map<string, StoredImage>;
  files: Record<string, Uint8Array>;
}

/** 有底圖、有立體層、背面也有圖，鐳射、卡框、view 的其他開關都不是預設值：來回之後哪個欄位被吃掉都看得出來。 */
async function fixture(stage?: StageStyle): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 11 });
  const heroBytes = makeWebp({ kind: 'extended', width: 800, height: 1200, alpha: true, seed: 12 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1400, false);
  const hero = await stored(heroBytes, 'image/webp', 800, 1200, true);
  const baseLayer = (image: string, id: string): Layer => ({ id, name: '底圖', role: 'base', image, visible: true, depth: 0, x: 0, y: 0, scale: 1.4, holo: false, hasAlpha: false });
  const heroLayer: Layer = { id: 'hero', name: '角色', role: 'depth', image: hero.hash, visible: true, depth: 60, x: 0.1, y: -0.2, scale: 0.9, holo: true, hasAlpha: true };
  const c = newCard('standard', 'card-1', NOW);
  const card: Card = {
    ...c,
    name: '工作桌卡',
    bodyColor: '#223344',
    cornerRadius: 0.08,
    front: { layers: [baseLayer(base.hash, 'base'), heroLayer] },
    back: { layers: [baseLayer(base.hash, 'back-base')] },
    frame: { enabled: true, width: 0.04, color: '#c0a060', shine: 70 },
    holo: { strength: 80, bandWidth: 1.5, sparkle: 55, palette: 'custom', colors: ['#6bd3ff', '#9f7bff', '#ff6bd6', '#e8f4ff'] },
    shadow: { strength: 30, distance: 70 },
    view: { returnToFront: false, showcase: true, stage: stage ?? c.view.stage, sleeve: true },
  };
  return {
    card,
    images: new Map([
      [base.hash, base],
      [hero.hash, hero],
    ]),
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
const exportOf = (fx: Fixture) => exportHolocard(fx.card, async (h) => fx.images.get(h), new Blob([PREVIEW], { type: 'image/png' }));
const cardJson = async (fx: Fixture) => JSON.parse(strFromU8(unzipSync(new Uint8Array(await (await exportOf(fx)).arrayBuffer()))['card.json']!));
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('卡片檔：工作桌舞台（T-832c）', () => {
  it('匯出：card.json 的 view.stage 是 desk；formatVersion 照舊是 1', async () => {
    const json = await cardJson(await fixture('desk'));
    expect(json.view).toEqual({ returnToFront: false, showcase: true, stage: 'desk', sleeve: true });
    expect(json.formatVersion).toBe(1);
  });

  it('來回一致：工作桌的卡匯出再匯入，舞台還是工作桌、其他欄位（除了新 id 與時間）全部一樣、圖片位元組一樣', async () => {
    const fx = await fixture('desk');
    const result = await importOf(await exportOf(fx));
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card.view.stage).toBe('desk');
    expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    expect(result.images.map((i) => i.hash).sort()).toEqual([...fx.images.keys()].sort());
    for (const image of result.images) {
      const original = fx.images.get(image.hash)!;
      expect({ ...image, blob: undefined }).toEqual({ ...original, blob: undefined });
      expect(await bytesOf(image.blob)).toEqual(await bytesOf(original.blob));
    }
  });

  it('什麼都不改的新卡片（預設舞台就是工作桌）也能來回', async () => {
    const fx = await fixture();
    expect(fx.card.view.stage).toBe('desk');
    const result = await importOf(await exportOf(fx));
    expect(result.ok && result.card.view.stage).toBe('desk');
  });

  it('已經有的卡（全息光環）不變：匯出入來回還是 halo，不會被換成工作桌', async () => {
    const fx = await fixture('halo');
    expect((await cardJson(fx)).view.stage).toBe('halo');
    const result = await importOf(await exportOf(fx));
    expect(result.ok && result.card.view.stage).toBe('halo');
    // 直接把舊卡的 card.json（halo）塞進檔裡匯入也一樣
    const direct = await importOf(holocard(fx.card, fx.files));
    expect(direct.ok && direct.card.view.stage).toBe('halo');
  });

  it('其他舞台的卡不受影響（七種舞台來回都保留）', async () => {
    for (const stage of ['halo', 'gallery', 'magic', 'water', 'nebula', 'desk', 'none'] as const) {
      const fx = await fixture(stage);
      const result = await importOf(await exportOf(fx));
      expect(result.ok && result.card.view.stage, stage).toBe(stage);
    }
  });
});
