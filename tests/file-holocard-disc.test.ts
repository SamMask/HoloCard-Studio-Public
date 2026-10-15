// T-810 CD 光碟（Card.kind?）在卡片檔 `.holocard`（SCHEMA §1、§4）：光碟寫 kind: 'disc'、卡片不寫（明寫 'card' 也拿掉）；
// 匯出入來回一致；舊卡（沒有 kind）照讀、不用升 formatVersion；壞值、背面有圖層、不是正方形的光碟擋下。
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { newCard, newDisc } from '../src/model/create';
import type { Card, Layer } from '../src/model/types';
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

async function fixture(make: () => Card): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1000, seed: 3 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1000, false);
  const baseLayer: Layer = { id: 'base', name: '底圖', role: 'base', image: base.hash, visible: true, depth: 0, x: 0, y: 0, scale: 1, holo: false, hasAlpha: false };
  return {
    card: { ...make(), name: '光碟', front: { layers: [baseLayer] } },
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

describe('卡片檔：CD 光碟（T-810）', () => {
  it('匯出：光碟寫 kind: disc；卡片不寫（明寫 card 也拿掉）；formatVersion 照舊是 1', async () => {
    const d = await cardJson(await fixture(() => newDisc('d', NOW)));
    expect(d.kind).toBe('disc');
    expect(d.aspect).toBe('square');
    expect(d.formatVersion).toBe(1);
    expect('kind' in (await cardJson(await fixture(() => newCard('standard', 'c', NOW))))).toBe(false);
    expect('kind' in (await cardJson(await fixture(() => ({ ...newCard('standard', 'c', NOW), kind: 'card' }))))).toBe(false);
  });

  it('來回一致：光碟匯出再匯入，卡片（除了新 id 與時間）一樣', async () => {
    const fx = await fixture(() => newDisc('d', NOW));
    const result = await importOf(await exportOf(fx));
    expect(reason(result)).toBe('ok');
    if (!result.ok) return;
    expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    expect(result.card.kind).toBe('disc');
  });

  it('舊卡（沒有 kind）照樣匯入、匯入後也沒有', async () => {
    const old = await fixture(() => newCard('standard', 'c', NOW));
    const a = await importOf(holocard(old.card, old.files));
    expect(a.ok && !('kind' in a.card)).toBe(true);
  });

  it('匯入壞值：kind 不認得、光碟不是正方形、光碟背面有圖層 → invalid-card，原因說得出是哪裡', async () => {
    const fx = await fixture(() => newDisc('d', NOW));
    const bad = await importOf(holocard({ ...fx.card, kind: 'vinyl' }, fx.files));
    expect(reason(bad)).toBe('invalid-card');
    expect(!bad.ok && bad.detail).toMatch(/kind/);
    const tall = await importOf(holocard({ ...fx.card, aspect: 'tarot' }, fx.files));
    expect(reason(tall)).toBe('invalid-card');
    expect(!tall.ok && tall.detail).toMatch(/光碟/);
    const back = await importOf(holocard({ ...fx.card, back: { layers: [{ ...fx.card.front.layers[0]!, id: 'b2' }] } }, fx.files));
    expect(reason(back)).toBe('invalid-card');
    expect(!back.ok && back.detail).toMatch(/光碟/);
  });
});
