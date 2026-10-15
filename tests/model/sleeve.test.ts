// 透明卡套（T-806，SCHEMA 的 view.sleeve?、DESIGN「透明卡套」）：可以省略（舊卡照讀）、有的話是布林、
// 打開記一步（可復原）、關掉時拿掉欄位（寫出時省略）、明寫 false 寫出時拿掉。
import { describe, expect, it } from 'vitest';
import { omitCardDefaults, sleeveOn, updateCard } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { apply, createHistory, undo } from '../../src/model/history';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const withSleeve = (sleeve: unknown): unknown => {
  const c = plain(fresh()) as unknown as { view: Record<string, unknown> };
  c.view.sleeve = sleeve;
  return c;
};

describe('驗證：view.sleeve 可以省略，有的話是布林', () => {
  it('新卡沒有這個欄位（預設關）；舊卡（沒有 sleeve）照讀', () => {
    const c = plain(fresh());
    expect(own(c.view, 'sleeve')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
    expect(sleeveOn(c)).toBe(false);
  });

  it('true、false 都合格', () => {
    expect(validateCard(withSleeve(true), anyImage)).toEqual([]);
    expect(validateCard(withSleeve(false), anyImage)).toEqual([]);
  });

  it('其他值都不合格，錯誤指到 view.sleeve', () => {
    for (const bad of [1, 0, 'true', '', null, [true], { on: true }]) {
      const errors = validateCard(withSleeve(bad), anyImage);
      expect(errors, JSON.stringify(bad)).toHaveLength(1);
      expect(errors[0]).toMatch(/^view\.sleeve/);
    }
  });

  it('view 裡不認得的欄位照樣報錯（不是什麼都收）', () => {
    const c = plain(fresh()) as unknown as { view: Record<string, unknown> };
    c.view.case = true;
    expect(validateCard(c, anyImage).some((e) => e.startsWith('view.case'))).toBe(true);
  });

  it('sleeveOn：只有 true 算開（省略、false 都是關）', () => {
    expect(sleeveOn(fresh())).toBe(false);
    expect(sleeveOn(withSleeve(true) as Card)).toBe(true);
    expect(sleeveOn(withSleeve(false) as Card)).toBe(false);
  });
});

describe('動作：開關卡套', () => {
  it('打開：回新卡，view.sleeve＝true，其他欄位不變；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const next = updateCard(card, { view: { sleeve: true } });
    expect(next).not.toBe(card);
    expect(next.view).toEqual({ ...card.view, sleeve: true });
    expect(card).toEqual(before);
  });

  it('關掉：拿掉欄位（等於預設值不寫，存進資料庫才不會有 undefined）', () => {
    const on = updateCard(fresh(), { view: { sleeve: true } });
    const off = updateCard(on, { view: { sleeve: false } });
    expect(off).not.toBe(on);
    expect(own(off.view, 'sleeve')).toBe(false);
    expect(off.view).toEqual(fresh().view);
  });

  it('沒有改變回原卡（同一個物件）：省略時再關、已經開了再開', () => {
    const card = fresh();
    expect(updateCard(card, { view: { sleeve: false } })).toBe(card);
    const on = updateCard(card, { view: { sleeve: true } });
    expect(updateCard(on, { view: { sleeve: true } })).toBe(on);
  });

  it('不合格的值忽略', () => {
    const card = fresh();
    for (const bad of [1, 'true', null, undefined]) {
      expect(updateCard(card, { view: { sleeve: bad as never } })).toBe(card);
    }
  });

  it('開關記一步，可以復原、復原後是原本的卡', () => {
    const card = fresh();
    let h = createHistory(card);
    h = apply(h, updateCard(h.present, { view: { sleeve: true } }));
    expect(h.present.view.sleeve).toBe(true);
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(card);
  });

  it('改其他 view 欄位（舞台、展示擺動、回正）時卡套留著', () => {
    const on = updateCard(fresh(), { view: { sleeve: true } });
    const next = updateCard(on, { view: { stage: 'gallery', showcase: true, returnToFront: false } });
    expect(next.view).toEqual({ stage: 'gallery', showcase: true, returnToFront: false, sleeve: true });
  });

  it('明寫 false 的卡（匯入的）再關：沒有改變、回原卡', () => {
    const explicit = withSleeve(false) as Card;
    expect(updateCard(explicit, { view: { sleeve: false } })).toBe(explicit);
  });
});

describe('寫出時省略（omitCardDefaults）', () => {
  it('明寫的 false 拿掉，其他不變；不改輸入', () => {
    const explicit = withSleeve(false) as Card;
    const before = plain(explicit);
    const out = omitCardDefaults(explicit);
    expect(own(out.view, 'sleeve')).toBe(false);
    expect(out.view).toEqual(fresh().view);
    expect(explicit).toEqual(before);
  });

  it('true 留著；沒有要拿掉的回原卡', () => {
    const on = withSleeve(true) as Card;
    expect(omitCardDefaults(on)).toBe(on);
    const card = fresh();
    expect(omitCardDefaults(card)).toBe(card);
  });
});
