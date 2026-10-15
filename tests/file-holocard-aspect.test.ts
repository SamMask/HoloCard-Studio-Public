// T-807 卡片比例在卡片檔 `.holocard`（SCHEMA §1、§4）：正方形、明信片、自訂（customAspect）匯出入來回一致；
// 舊卡（標準卡、塔羅牌，沒有 customAspect）照讀、不用升 formatVersion；自訂沒有寬高、寬高太扁太長 → 擋下。
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import type { Aspect, Card, CustomAspect, Layer } from '../src/model/types';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const NOW = '2026-10-14T00:00:00.000Z';
const LATER = '2026-10-14T08:30:00.000Z';
const OPTS = { newId: () => 'imported-id', now: () => LATER };
const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });

interface Fixture {
  card: Card;
  images: Map<string, StoredImage>;
  files: Record<string, Uint8Array>;
}

async function fixture(aspect: Aspect, custom?: CustomAspect): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 1 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1400, false);
  const baseLayer: Layer = { id: 'base', name: '底圖', role: 'base', image: base.hash, visible: true, depth: 0, x: 0.1, y: -0.2, scale: 1.4, holo: false, hasAlpha: false };
  const c = newCard(aspect, 'card-1', NOW, custom);
  return {
    card: { ...c, name: '比例卡', front: { layers: [baseLayer] } },
    images: new Map([[base.hash, base] as const]),
    files: { [`images/${base.hash}.webp`]: baseBytes },
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
const cardJson = async (fx: Fixture) => JSON.parse(strFromU8(unzipSync(new Uint8Array(await (await exportOf(fx)).arrayBuffer()))['card.json']!));

describe('卡片檔：卡片比例（T-807）', () => {
  it('匯出：自訂寫 customAspect；其他比例不寫；formatVersion 照舊是 1', async () => {
    const custom = await cardJson(await fixture('custom', { width: 3, height: 2 }));
    expect(custom.aspect).toBe('custom');
    expect(custom.customAspect).toEqual({ width: 3, height: 2 });
    expect(custom.formatVersion).toBe(1);
    for (const aspect of ['standard', 'tarot', 'square', 'postcard'] as const) {
      const json = await cardJson(await fixture(aspect));
      expect(json.aspect).toBe(aspect);
      expect('customAspect' in json).toBe(false);
    }
  });

  it('來回一致：五種比例匯出再匯入，卡片（除了新 id 與時間）一樣，圖層位置不變', async () => {
    for (const [aspect, custom] of [
      ['standard', undefined],
      ['tarot', undefined],
      ['square', undefined],
      ['postcard', undefined],
      ['custom', { width: 3, height: 2 }],
      ['custom', { width: 500, height: 999 }],
    ] as [Aspect, CustomAspect | undefined][]) {
      const fx = await fixture(aspect, custom);
      const result = await importOf(await exportOf(fx));
      expect(reason(result), aspect).toBe('ok');
      if (!result.ok) continue;
      expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    }
  });

  it('舊卡（標準卡、塔羅牌，沒有 customAspect）照樣匯入', async () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const fx = await fixture(aspect);
      const result = await importOf(holocard(fx.card, fx.files));
      expect(reason(result)).toBe('ok');
      expect(result.ok && !('customAspect' in result.card)).toBe(true);
    }
  });

  it('匯入壞值：自訂沒有寬高、寬高太扁太長或不是整數、不是自訂卻有寬高 → invalid-card，原因指到 customAspect', async () => {
    const fx = await fixture('custom', { width: 3, height: 2 });
    const { customAspect: _c, ...noSize } = fx.card;
    const bad: unknown[] = [
      noSize,
      { ...fx.card, customAspect: { width: 1, height: 3 } },
      { ...fx.card, customAspect: { width: 1.5, height: 2 } },
      { ...fx.card, customAspect: { width: 0, height: 2 } },
      { ...fx.card, customAspect: '3:2' },
      { ...fx.card, aspect: 'square' },
    ];
    for (const card of bad) {
      const result = await importOf(holocard(card, fx.files));
      expect(reason(result), JSON.stringify(card).slice(0, 120)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/customAspect/);
    }
  });
});
