// T-805 變身圖（Layer.alt?）在卡片檔 `.holocard`（SCHEMA §4）：匯出把變身圖一起打包、匯入照驗證（圖要附、
// 底圖／文字層／破框層不能有、雜湊格式）；來回一致；舊卡（沒有 alt）照讀。
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import type { Card, Layer, TextSpec } from '../src/model/types';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const NOW = '2026-10-14T00:00:00.000Z';
const LATER = '2026-10-14T08:30:00.000Z';
const OPTS = { newId: () => 'imported-id', now: () => LATER };
const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });

interface Fixture {
  card: Card;
  images: Map<string, StoredImage>;
  files: Record<string, Uint8Array>;
  altHash: string;
}

/** 正面：底圖＋立體層（有變身圖）；背面：同一張底圖。 */
async function fixture(): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 1 });
  const heroBytes = makeWebp({ kind: 'extended', width: 800, height: 1200, alpha: true, seed: 2 });
  const altBytes = makeWebp({ kind: 'extended', width: 900, height: 1000, alpha: true, seed: 3 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1400, false);
  const hero = await stored(heroBytes, 'image/webp', 800, 1200, true);
  const alt = await stored(altBytes, 'image/webp', 900, 1000, true);
  const baseLayer: Layer = { id: 'base', name: '底圖', role: 'base', image: base.hash, visible: true, depth: 0, x: 0, y: 0, scale: 1.4, holo: false, hasAlpha: false };
  const heroLayer: Layer = {
    id: 'hero',
    name: '星晶龍',
    role: 'depth',
    image: hero.hash,
    visible: true,
    depth: 50,
    x: 0.1,
    y: -0.2,
    scale: 0.9,
    holo: true,
    hasAlpha: true,
    alt: { image: alt.hash, hasAlpha: true },
  };
  const card: Card = { ...newCard('standard', 'card-1', NOW), name: '光柵卡', front: { layers: [baseLayer, heroLayer] }, back: { layers: [{ ...baseLayer, id: 'back-base' }] } };
  return {
    card,
    images: new Map([base, hero, alt].map((s) => [s.hash, s] as const)),
    files: { [`images/${base.hash}.webp`]: baseBytes, [`images/${hero.hash}.webp`]: heroBytes, [`images/${alt.hash}.webp`]: altBytes },
    altHash: alt.hash,
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

describe('卡片檔：變身圖（T-805）', () => {
  it('匯出：變身圖一起打包（只問用到的圖）、card.json 裡有 alt', async () => {
    const fx = await fixture();
    const files = unzipSync(new Uint8Array(await (await exportOf(fx)).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    expect(files[`images/${fx.altHash}.webp`]).toEqual(fx.files[`images/${fx.altHash}.webp`]);
    const json = JSON.parse(strFromU8(files['card.json']!));
    expect(json.front.layers[1].alt).toEqual({ image: fx.altHash, hasAlpha: true });
  });

  it('匯出時找不到變身圖 → 丟錯（不會匯出一個打不開的檔）', async () => {
    const fx = await fixture();
    await expect(exportHolocard(fx.card, async (h) => (h === fx.altHash ? undefined : fx.images.get(h)), new Blob([PREVIEW], { type: 'image/png' }))).rejects.toThrow(
      fx.altHash,
    );
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣、變身圖也在回傳的圖裡', async () => {
    const fx = await fixture();
    const result = await importOf(await exportOf(fx));
    expect(reason(result)).toBe('ok');
    if (!result.ok) return;
    expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    expect(result.images.map((i) => i.hash)).toContain(fx.altHash);
  });

  it('匯入：用到的變身圖沒有附 → missing-image', async () => {
    const fx = await fixture();
    const { [`images/${fx.altHash}.webp`]: _gone, ...rest } = fx.files;
    const result = await importOf(holocard(fx.card, rest));
    expect(reason(result)).toBe('missing-image');
    expect(!result.ok && result.detail).toContain(fx.altHash);
  });

  it('匯入壞值：雜湊格式不對、hasAlpha 不是 boolean、多欄位 → invalid-card', async () => {
    const fx = await fixture();
    for (const alt of [{ image: 'ABC', hasAlpha: true }, { image: fx.altHash, hasAlpha: 'yes' }, { image: fx.altHash, hasAlpha: true, run: 'x' }, null]) {
      const hero = { ...fx.card.front.layers[1]!, alt };
      const result = await importOf(holocard({ ...fx.card, front: { layers: [fx.card.front.layers[0], hero] } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/alt/);
    }
  });

  it('匯入：底圖、文字層、破框層帶 alt → invalid-card', async () => {
    const fx = await fixture();
    const [base, hero] = fx.card.front.layers as [Layer, Layer];
    const alt = hero.alt!;
    const text: TextSpec = { content: '龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
    const cases: Layer[][] = [
      [{ ...base, alt }, { ...hero }],
      [base, { ...hero, text }],
      [base, { ...hero, breakout: true }],
    ];
    for (const layers of cases) {
      const result = await importOf(holocard({ ...fx.card, front: { layers } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/alt/);
    }
  });

  it('舊卡（沒有 alt）照讀；沒用到的圖照樣檢查但不匯入', async () => {
    const fx = await fixture();
    const { alt: _alt, ...plain } = fx.card.front.layers[1]!;
    const old = { ...fx.card, front: { layers: [fx.card.front.layers[0], plain] } };
    const result = await importOf(holocard(old, fx.files));
    expect(reason(result)).toBe('ok');
    if (result.ok) {
      expect('alt' in result.card.front.layers[1]!).toBe(false);
      expect(result.images.map((i) => i.hash)).not.toContain(fx.altHash);
    }
  });
});
