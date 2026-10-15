// 卡框樣式（T-416，SCHEMA 的 Frame.style、DESIGN「卡框樣式」）：有的話必須二選一、改樣式算一步（可復原）、
// 'simple' 寫出時省略、舊卡（沒有 style）照讀。
import { describe, expect, it } from 'vitest';
import { frameStyle, omitCardDefaults, updateCard } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { apply, createHistory, undo } from '../../src/model/history';
import { FRAME_STYLES } from '../../src/model/limits';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const withStyle = (style: unknown): unknown => {
  const c = plain(fresh()) as unknown as { frame: Record<string, unknown> };
  c.frame.style = style;
  return c;
};

describe('驗證：frame.style 可以省略，有的話二選一', () => {
  it('兩個選項：簡約、雕花邊角', () => {
    expect(FRAME_STYLES).toEqual(['simple', 'ornate']);
  });

  it('舊卡（沒有 style）照讀', () => {
    const c = plain(fresh());
    expect(Object.prototype.hasOwnProperty.call(c.frame, 'style')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it("'simple'、'ornate' 都合格", () => {
    expect(validateCard(withStyle('simple'), anyImage)).toEqual([]);
    expect(validateCard(withStyle('ornate'), anyImage)).toEqual([]);
  });

  it('其他值都不合格，錯誤指到 frame.style', () => {
    for (const bad of ['fancy', 'Ornate', '', 1, true, null, ['ornate'], { v: 'ornate' }]) {
      const errors = validateCard(withStyle(bad), anyImage);
      expect(errors, String(bad)).toHaveLength(1);
      expect(errors[0]).toMatch(/^frame\.style/);
    }
  });

  it('沒有 style 時讀到的樣式是簡約', () => {
    expect(frameStyle(fresh().frame)).toBe('simple');
    expect(frameStyle({ style: 'ornate' })).toBe('ornate');
    expect(frameStyle({ style: 'simple' })).toBe('simple');
  });
});

describe('動作：改樣式', () => {
  it('換成雕花邊角：回新卡，其他欄位不變；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const next = updateCard(card, { frame: { style: 'ornate' } });
    expect(next).not.toBe(card);
    expect(next.frame).toEqual({ ...card.frame, style: 'ornate' });
    expect(card).toEqual(before);
  });

  it('換回簡約：拿掉欄位（等於預設值不寫，存進資料庫才不會有 undefined）', () => {
    const ornate = updateCard(fresh(), { frame: { style: 'ornate' } });
    const simple = updateCard(ornate, { frame: { style: 'simple' } });
    expect(simple).not.toBe(ornate);
    expect(Object.prototype.hasOwnProperty.call(simple.frame, 'style')).toBe(false);
    expect(simple.frame).toEqual(fresh().frame);
  });

  it('沒有改變回原卡（同一個物件）：省略時再選簡約、已經是雕花再選雕花', () => {
    const card = fresh();
    expect(updateCard(card, { frame: { style: 'simple' } })).toBe(card);
    const ornate = updateCard(card, { frame: { style: 'ornate' } });
    expect(updateCard(ornate, { frame: { style: 'ornate' } })).toBe(ornate);
  });

  it('不合格的值忽略', () => {
    const card = fresh();
    for (const bad of ['fancy', 1, null, undefined]) {
      expect(updateCard(card, { frame: { style: bad as never } })).toBe(card);
    }
  });

  it('和打開卡框一起送（介面的按鈕）：一次改兩個欄位', () => {
    const next = updateCard(fresh(), { frame: { style: 'ornate', enabled: true } });
    expect(next.frame.enabled).toBe(true);
    expect(next.frame.style).toBe('ornate');
  });

  it('改樣式算一步，可以復原、復原後是原本的卡', () => {
    const card = fresh();
    let h = createHistory(card);
    h = apply(h, updateCard(h.present, { frame: { style: 'ornate' } }));
    expect(h.present.frame.style).toBe('ornate');
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(card);
    expect(frameStyle(h.present.frame)).toBe('simple');
  });

  it('改其他卡框欄位時樣式留著', () => {
    const ornate = updateCard(fresh(), { frame: { style: 'ornate' } });
    const wider = updateCard(ornate, { frame: { width: 0.05, color: '#d4af37', shine: 80, enabled: true } });
    expect(wider.frame.style).toBe('ornate');
  });
});

describe('寫出時省略（omitCardDefaults）', () => {
  it("明寫的 'simple' 拿掉，其他不變；不改輸入", () => {
    const explicit = withStyle('simple') as Card;
    const before = plain(explicit);
    const out = omitCardDefaults(explicit);
    expect(Object.prototype.hasOwnProperty.call(out.frame, 'style')).toBe(false);
    expect(out.frame).toEqual(fresh().frame);
    expect(explicit).toEqual(before);
  });

  it("'ornate' 留著；沒有要拿掉的回原卡", () => {
    const ornate = withStyle('ornate') as Card;
    expect(omitCardDefaults(ornate)).toBe(ornate);
    const card = fresh();
    expect(omitCardDefaults(card)).toBe(card);
  });
});
