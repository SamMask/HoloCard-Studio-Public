// T-806 透明卡套（view.sleeve?）在卡片檔 `.holocard`（SCHEMA §1、§4）：開著時寫 true、關著（或明寫 false）不寫；
// 匯出入來回一致；舊卡（沒有 sleeve）照讀、不用升 formatVersion；壞值擋下。
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import type { Card, Layer } from '../src/model/types';
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

async function fixture(sleeve?: boolean): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 1 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1400, false);
  const baseLayer: Layer = { id: 'base', name: '底圖', role: 'base', image: base.hash, visible: true, depth: 0, x: 0, y: 0, scale: 1.4, holo: false, hasAlpha: false };
  const c = newCard('standard', 'card-1', NOW);
  const view = sleeve === undefined ? c.view : { ...c.view, sleeve };
  return {
    card: { ...c, name: '卡套卡', view, front: { layers: [baseLayer] } },
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

describe('卡片檔：透明卡套（T-806）', () => {
  it('匯出：開著寫 sleeve: true；沒開（省略或明寫 false）不寫這個欄位；formatVersion 照舊是 1', async () => {
    const on = await cardJson(await fixture(true));
    expect(on.view.sleeve).toBe(true);
    expect(on.formatVersion).toBe(1);
    expect('sleeve' in (await cardJson(await fixture())).view).toBe(false);
    expect('sleeve' in (await cardJson(await fixture(false))).view).toBe(false);
  });

  it('來回一致：開著的卡匯出再匯入，卡片（除了新 id 與時間）一樣', async () => {
    const fx = await fixture(true);
    const result = await importOf(await exportOf(fx));
    expect(reason(result)).toBe('ok');
    if (!result.ok) return;
    expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    expect(result.card.view.sleeve).toBe(true);
  });

  it('舊卡（沒有 sleeve）照樣匯入、匯入後也沒有；明寫 false 也收', async () => {
    const old = await fixture();
    const a = await importOf(holocard(old.card, old.files));
    expect(a.ok && !('sleeve' in a.card.view)).toBe(true);
    const explicit = await fixture(false);
    expect(reason(await importOf(holocard(explicit.card, explicit.files)))).toBe('ok');
  });

  it('匯入壞值：不是布林 → invalid-card，原因指到 sleeve', async () => {
    const fx = await fixture();
    for (const sleeve of [1, 'true', null, { on: true }, [true]]) {
      const result = await importOf(holocard({ ...fx.card, view: { ...fx.card.view, sleeve } }, fx.files));
      expect(reason(result), JSON.stringify(sleeve)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/sleeve/);
    }
  });
});
