// 舞台背景圖（T-814，SCHEMA 的 view.backdrop?、DESIGN §5「舞台背景圖」）：可以省略（舊卡照讀）、有的話是合格雜湊而且圖要存在、
// 算進每張卡最多 16 張圖；加、換、拿掉各記一步（拿掉時拿掉欄位）；複製、套風格、換比例、光碟都保留它；「用到的圖」含背景圖。
import { describe, expect, it } from 'vitest';
import { addLayer, omitCardDefaults, setBackdrop, updateCard, updateFoil, updateLayer } from '../../src/model/actions';
import { newCard, newDisc } from '../../src/model/create';
import { cardImages } from '../../src/model/foil';
import { apply, createHistory, undo } from '../../src/model/history';
import { MAX_CARD_IMAGES } from '../../src/model/limits';
import { applyCardStyle } from '../../src/model/styles';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, depthLayer, hash, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const withBackdrop = (backdrop: unknown, card: Card = fresh()): unknown => {
  const c = plain(card) as unknown as { view: Record<string, unknown> };
  c.view.backdrop = backdrop;
  return c;
};

/** 正面放 n 張不同的立體層圖（分成兩面，每面最多 8 層）。 */
function cardWithImages(n: number): Card {
  let card = fresh();
  for (let i = 0; i < n; i++) {
    const face = i < 8 ? 'front' : 'back';
    const r = addLayer(card, face, { id: `l${i}`, name: `圖${i}`, image: hash(100 + i), hasAlpha: true, width: 10, height: 10 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  }
  return card;
}

describe('驗證：view.backdrop 可以省略，有的話是合格雜湊、圖要存在', () => {
  it('新卡沒有這個欄位；舊卡（沒有 backdrop）照讀', () => {
    const c = plain(fresh());
    expect(own(c.view, 'backdrop')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('合格雜湊、圖存在 → 合格', () => {
    expect(validateCard(withBackdrop(hash(7)), anyImage)).toEqual([]);
    expect(validateCard(withBackdrop(hash(7)), (h) => h === hash(7))).toEqual([]);
  });

  it('格式不對都不合格，錯誤指到 view.backdrop', () => {
    for (const bad of ['ABCDEF0123456789', 'abc', '', 7, null, true, [hash(7)], { image: hash(7) }]) {
      const errors = validateCard(withBackdrop(bad), anyImage);
      expect(errors, JSON.stringify(bad)).toHaveLength(1);
      expect(errors[0]).toMatch(/^view\.backdrop/);
    }
  });

  it('圖不存在 → 不合格（找不到這張圖片）', () => {
    const errors = validateCard(withBackdrop(hash(7)), (h) => h !== hash(7));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^view\.backdrop.*找不到/);
  });

  it('算進每張卡最多 16 張圖：16 張圖層＋背景圖 → 不合格；背景圖和圖層同一張不重複算', () => {
    const full = cardWithImages(MAX_CARD_IMAGES);
    expect(validateCard(plain(full), anyImage)).toEqual([]);
    const over = validateCard(withBackdrop(hash(7), full), anyImage);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatch(/圖片最多 16 張/);
    expect(over[0]).toContain('背景圖');
    expect(validateCard(withBackdrop(hash(100), full), anyImage)).toEqual([]);
  });
});

describe('「用到的圖」含背景圖（存檔、卡片檔、圖片回收、複製都靠它）', () => {
  it('cardImages：背景圖排在最後；和圖層同一張不重複', () => {
    const card = setBackdrop(cardWithImages(2), hash(7));
    expect(cardImages(card)).toEqual([hash(100), hash(101), hash(7)]);
    expect(cardImages(setBackdrop(cardWithImages(2), hash(100)))).toEqual([hash(100), hash(101)]);
    expect(cardImages(cardWithImages(2))).toEqual([hash(100), hash(101)]);
  });
});

describe('動作：setBackdrop（加、換、拿掉）', () => {
  it('加上：回新卡，view.backdrop＝那張，其他欄位不變；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const next = setBackdrop(card, hash(7));
    expect(next).not.toBe(card);
    expect(next.view).toEqual({ ...card.view, backdrop: hash(7) });
    expect(card).toEqual(before);
  });

  it('換一張、拿掉（null）：拿掉時拿掉欄位（不寫 undefined）', () => {
    const a = setBackdrop(fresh(), hash(7));
    const b = setBackdrop(a, hash(8));
    expect(b.view.backdrop).toBe(hash(8));
    const off = setBackdrop(b, null);
    expect(own(off.view, 'backdrop')).toBe(false);
    expect(off.view).toEqual(fresh().view);
  });

  it('沒有改變回原卡（同一個物件）：同一張再設一次、沒有時再拿掉', () => {
    const card = fresh();
    expect(setBackdrop(card, null)).toBe(card);
    const on = setBackdrop(card, hash(7));
    expect(setBackdrop(on, hash(7))).toBe(on);
  });

  it('不合格的雜湊不改（回原卡）', () => {
    const card = fresh();
    for (const bad of ['ABC', '', 'zzzzzzzzzzzzzzzz', 7 as unknown as string]) expect(setBackdrop(card, bad)).toBe(card);
  });

  it('會超過每張卡 16 張圖 → 不改；換成卡上已經有的圖可以', () => {
    const full = cardWithImages(MAX_CARD_IMAGES);
    expect(setBackdrop(full, hash(7))).toBe(full);
    expect(setBackdrop(full, hash(103)).view.backdrop).toBe(hash(103));
  });

  it('滿了以後換背景圖（不多一張）可以；已經有背景圖時加第 16 張圖層會被擋', () => {
    const fifteen = setBackdrop(cardWithImages(MAX_CARD_IMAGES - 1), hash(7));
    expect(cardImages(fifteen)).toHaveLength(MAX_CARD_IMAGES);
    expect(setBackdrop(fifteen, hash(8)).view.backdrop).toBe(hash(8));
    const more = addLayer(fifteen, 'back', { id: 'extra', name: '多的', image: hash(999), hasAlpha: true, width: 10, height: 10 });
    expect(more).toEqual({ ok: false, reason: 'too-many-images' });
  });

  it('記一步：復原回到沒有背景圖', () => {
    const card = fresh();
    let h = createHistory(card);
    h = apply(h, setBackdrop(card, hash(7)));
    expect(h.present.view.backdrop).toBe(hash(7));
    expect(own(undo(h).present.view, 'backdrop')).toBe(false);
  });

  it('updateCard 的 view 不會動到背景圖（只能用 setBackdrop 改）', () => {
    const on = setBackdrop(fresh(), hash(7));
    const next = updateCard(on, { view: { stage: 'water', backdrop: hash(8) } });
    expect(next.view).toEqual({ ...on.view, stage: 'water' });
    expect(updateCard(on, { view: { backdrop: hash(8) } })).toBe(on);
  });
});

describe('其他動作都保留背景圖', () => {
  const on = () => setBackdrop(fresh(), hash(7));

  it('套風格（T-801）、換比例（T-807）、改舞台與卡套、改圖層、反光層', () => {
    expect(applyCardStyle(on(), 'gold').view.backdrop).toBe(hash(7));
    expect(updateCard(on(), { aspect: 'tarot' }).view.backdrop).toBe(hash(7));
    expect(updateCard(on(), { aspect: 'custom', customAspect: { width: 3, height: 2 } }).view.backdrop).toBe(hash(7));
    expect(updateCard(on(), { view: { stage: 'none', sleeve: true } }).view.backdrop).toBe(hash(7));
    const added = addLayer(on(), 'front', { id: 'x', name: 'x', image: hash(1), hasAlpha: true, width: 10, height: 10 });
    if (!added.ok) throw new Error(added.reason);
    expect(updateLayer(added.card, 'front', 'x', { depth: 80 }).view.backdrop).toBe(hash(7));
    expect(updateFoil(on(), 'front', { shape: 'none' }).view.backdrop).toBe(hash(7));
  });

  it('光碟（T-810）也能有背景圖、照樣驗證合格', () => {
    const disc = setBackdrop(newDisc('d1', NOW), hash(7));
    expect(disc.view.backdrop).toBe(hash(7));
    expect(validateCard(plain(disc), anyImage)).toEqual([]);
  });

  it('寫出時：有背景圖照寫；欄位在但是 undefined 時拿掉', () => {
    expect(omitCardDefaults(on()).view.backdrop).toBe(hash(7));
    const odd = { ...fresh(), view: { ...fresh().view, backdrop: undefined } } as Card;
    expect(own(omitCardDefaults(odd).view, 'backdrop')).toBe(false);
  });

  it('沒有背景圖的卡＋立體層照舊合格（不多出任何欄位）', () => {
    const card = { ...fresh(), front: { layers: [depthLayer()] } };
    expect(validateCard(plain(card), anyImage)).toEqual([]);
    expect(own(card.view, 'backdrop')).toBe(false);
  });
});
