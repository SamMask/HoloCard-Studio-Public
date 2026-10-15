// CD 光碟（T-810，SCHEMA Card.kind?、DESIGN「CD 光碟」）在 model 的部分：
// kind 可以省略（＝卡片，舊卡照讀）；光碟一律正方形、不能有自訂寬高、背面一定沒有圖層（資料面）；
// 建立後不能換比例；所有會往背面加圖層的動作都擋掉（回「放不下」face-full／卡片不變）；寫出時明寫的 'card' 拿掉。
import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addTextLayer,
  DEFAULT_TEXT,
  omitCardDefaults,
  replaceBase,
  sleeveOn,
  updateCard,
  updateFoil,
  type NewLayerInput,
} from '../../src/model/actions';
import { isDisc } from '../../src/model/aspect';
import { newCard, newDisc } from '../../src/model/create';
import { applyCardStyle } from '../../src/model/styles';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { splitIntoCard } from '../../src/ui/editor';
import { anyImage, baseLayer, depthLayer, hash, NOW } from './helpers';

/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const disc = (): Card => newDisc('d1', NOW);
const raw = (card: Card): Record<string, unknown> => plain(card) as unknown as Record<string, unknown>;

const png = (id: string, hasAlpha: boolean, n = 7): NewLayerInput => ({ id, name: id, image: hash(n), hasAlpha, width: 1000, height: 1000 });

describe('建立光碟', () => {
  it('newDisc：kind disc、正方形、沒有自訂寬高、兩面都沒有圖層，驗證通過', () => {
    const d = disc();
    expect(d.kind).toBe('disc');
    expect(d.aspect).toBe('square');
    expect(own(d, 'customAspect')).toBe(false);
    expect(d.front.layers).toEqual([]);
    expect(d.back.layers).toEqual([]);
    expect(d.id).toBe('d1');
    expect(d.createdAt).toBe(NOW);
    expect(d.updatedAt).toBe(NOW);
    expect(validateCard(plain(d), anyImage)).toEqual([]);
  });

  it('除了 kind 和比例，其他預設值和新卡片一樣', () => {
    const { kind: _k, aspect: _a, ...rest } = disc();
    const { aspect: _b, ...card } = newCard('square', 'd1', NOW);
    expect(rest).toEqual(card);
  });

  it('isDisc：只有 kind disc 算光碟（省略、card 都是卡片）', () => {
    expect(isDisc(disc())).toBe(true);
    expect(isDisc(newCard('square', 'c', NOW))).toBe(false);
    expect(isDisc({ ...newCard('square', 'c', NOW), kind: 'card' })).toBe(false);
  });
});

describe('驗證：Card.kind?', () => {
  it('新卡片沒有 kind（舊卡照讀）；明寫 card 也合格', () => {
    const c = raw(newCard('standard', 'c', NOW));
    expect(own(c, 'kind')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
    expect(validateCard({ ...c, kind: 'card' }, anyImage)).toEqual([]);
  });

  it('不認得的值不合格，錯誤指到 kind', () => {
    for (const bad of ['cd', 'Disc', '', 1, null, true, ['disc'], { kind: 'disc' }]) {
      const errors = validateCard({ ...raw(disc()), kind: bad }, anyImage);
      expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(errors[0], JSON.stringify(bad)).toMatch(/^kind/);
    }
  });

  it('光碟的比例一定是正方形', () => {
    for (const aspect of ['standard', 'tarot', 'postcard'] as const) {
      const errors = validateCard({ ...raw(disc()), aspect }, anyImage);
      expect(errors, aspect).toHaveLength(1);
      expect(errors[0]).toMatch(/^aspect：.*光碟/);
    }
  });

  it('光碟不能是自訂比例、不能有自訂寬高', () => {
    const custom = validateCard({ ...raw(disc()), aspect: 'custom', customAspect: { width: 1, height: 1 } }, anyImage);
    expect(custom.some((e) => /^aspect：.*光碟/.test(e))).toBe(true);
    const extra = validateCard({ ...raw(disc()), customAspect: { width: 1, height: 1 } }, anyImage);
    expect(extra.some((e) => e.startsWith('customAspect'))).toBe(true);
  });

  it('光碟背面不能有圖層（資料面）', () => {
    const d = raw(disc());
    const errors = validateCard({ ...d, back: { layers: [baseLayer()] } }, anyImage);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^back\.layers：.*光碟/);
  });

  it('光碟正面照常放圖層；背面的反光層設定照收（畫面不用）', () => {
    const d = raw(disc());
    const ok = { ...d, front: { layers: [baseLayer(), depthLayer()] }, back: { layers: [], foil: { shape: 'none', frame: true } } };
    expect(validateCard(ok, anyImage)).toEqual([]);
  });

  it('卡片（不是光碟）照舊：背面可以放圖、比例隨意', () => {
    const c = raw({ ...newCard('tarot', 'c', NOW), back: { layers: [baseLayer()] } });
    expect(validateCard({ ...c, kind: 'card' }, anyImage)).toEqual([]);
  });
});

describe('動作：光碟背面不能加圖層', () => {
  it('上傳（addLayer）：背面一律 face-full、卡不變；正面照常', () => {
    const d = disc();
    for (const input of [png('a', true), png('b', false), { ...png('c', false), blend: 'screen' as const }]) {
      expect(addLayer(d, 'back', input)).toEqual({ ok: false, reason: 'face-full' });
    }
    const front = addLayer(d, 'front', png('a', true));
    expect(front.ok).toBe(true);
    if (front.ok) expect(front.card.front.layers).toHaveLength(1);
  });

  it('不合格的輸入照樣先回 invalid-input（和卡片一樣的優先順序）', () => {
    expect(addLayer(disc(), 'back', { ...png('a', true), image: 'bad' })).toEqual({ ok: false, reason: 'invalid-input' });
  });

  it('加文字（addTextLayer）：背面 face-full；正面照常', () => {
    const input = { id: 't', image: hash(9), text: { ...DEFAULT_TEXT }, width: 400, height: 120 };
    expect(addTextLayer(disc(), 'back', input)).toEqual({ ok: false, reason: 'face-full' });
    expect(addTextLayer(disc(), 'front', input).ok).toBe(true);
  });

  it('取代底圖（replaceBase）：背面卡不變（同一個物件）；正面照常', () => {
    const d = disc();
    expect(replaceBase(d, 'back', png('b', false))).toBe(d);
    expect(replaceBase(d, 'front', png('b', false)).front.layers).toHaveLength(1);
  });

  it('AI 拆成立體層（splitIntoCard）：背面放不進去、卡不變；正面照常', () => {
    const parts = [
      { ...png('s0', false, 1), depth: 0 },
      { ...png('s1', true, 2), depth: 50 },
    ];
    expect('problem' in splitIntoCard(disc(), 'back', parts)).toBe(true);
    const front = splitIntoCard(disc(), 'front', parts);
    expect('card' in front && front.card.front.layers.length).toBe(2);
  });

  it('卡片的背面照常可以加（只擋光碟）', () => {
    expect(addLayer(newCard('square', 'c', NOW), 'back', png('a', true)).ok).toBe(true);
  });
});

describe('動作：光碟不能換比例、其他照常', () => {
  it('換比例（含自訂）：比例不變、沒有自訂寬高；同一次的其他欄位照改', () => {
    const d = disc();
    for (const patch of [{ aspect: 'standard' as const }, { aspect: 'custom' as const, customAspect: { width: 3, height: 2 } }]) {
      const next = updateCard(d, patch);
      expect(next, JSON.stringify(patch)).toBe(d);
    }
    const named = updateCard(d, { aspect: 'tarot', name: '星海' });
    expect(named.aspect).toBe('square');
    expect(named.name).toBe('星海');
    expect(named.kind).toBe('disc');
  });

  it('改其他設定時 kind 留著', () => {
    const next = updateCard(disc(), { bodyColor: '#123456', holo: { strength: 30 }, cornerRadius: 0.1, frame: { enabled: true } });
    expect(next.kind).toBe('disc');
    expect(validateCard(plain(next), anyImage)).toEqual([]);
  });

  it('一鍵風格（T-801）：kind 留著、背面還是沒有圖層、驗證通過', () => {
    const next = applyCardStyle(disc(), 'gold');
    expect(next.kind).toBe('disc');
    expect(next.back.layers).toEqual([]);
    expect(validateCard(plain(next), anyImage)).toEqual([]);
  });

  it('反光層（背面也能設，畫面不用）：kind 留著', () => {
    expect(updateFoil(disc(), 'back', { shape: 'none' }).kind).toBe('disc');
  });

  it('透明卡套對光碟不算開（sleeveOn false）', () => {
    const d = { ...disc(), view: { ...disc().view, sleeve: true } };
    expect(sleeveOn(d)).toBe(false);
    expect(sleeveOn({ ...newCard('standard', 'c', NOW), view: { ...disc().view, sleeve: true } })).toBe(true);
  });
});

describe('寫出前整理：omitCardDefaults', () => {
  it('明寫 kind card 拿掉（預設值省略）；光碟留著', () => {
    const c = { ...newCard('standard', 'c', NOW), kind: 'card' as const };
    const out = omitCardDefaults(c);
    expect(own(out, 'kind')).toBe(false);
    expect(c.kind).toBe('card'); // 不改輸入
    expect(omitCardDefaults(disc()).kind).toBe('disc');
  });

  it('沒有要拿掉的回原卡（同一個物件）', () => {
    const d = disc();
    expect(omitCardDefaults(d)).toBe(d);
  });
});
