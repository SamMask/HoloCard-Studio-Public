// 水鏡的水面樣子（T-825，SCHEMA 的 view.waterLook?、DESIGN §5「水面樣子」）：可以省略（舊卡照讀、省略＝〔夜色〕預設＝T-825 以前的水鏡）；
// 有的話六個 0～100 的整數（霧、倒影拉長、閃光、波紋、卡片高度、地平線）＋兩個 #rrggbb（霧色、閃光色）；
// 改它走 updateCard 的 view（只給要改的欄位、夾範圍、四捨五入成整數、顏色存小寫；回到預設時拿掉欄位）；
// 快速套用〔夜色〕〔霧白〕＝整組換掉（一步）；寫出時等於預設就省略；換舞台、換遠景、背景圖、套風格、換比例、光碟都保留它。
import { describe, expect, it } from 'vitest';
import { omitCardDefaults, setBackdrop, updateCard, waterLookOf } from '../../src/model/actions';
import { newCard, newDisc } from '../../src/model/create';
import { apply, commit, createHistory, preview, undo } from '../../src/model/history';
import { DEFAULT_WATER_LOOK, MIST_WATER_LOOK, RANGE, WATER_LOOK_PRESETS } from '../../src/model/limits';
import { applyCardStyle } from '../../src/model/styles';
import type { Card, WaterLook } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, hash, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const withLook = (look: unknown, card: Card = fresh()): unknown => {
  const c = plain(card) as unknown as { view: Record<string, unknown> };
  c.view.waterLook = look;
  return c;
};
const look = (p: Partial<WaterLook>, card: Card = fresh()): Card => updateCard(card, { view: { waterLook: p } });
const NUMBERS = ['mist', 'streak', 'glint', 'ripple', 'lift', 'horizon'] as const;
const COLORS = ['mistColor', 'glintColor'] as const;

describe('預設值（〔夜色〕＝T-825 以前的水鏡）與〔霧白〕', () => {
  it('六個滑桿 0～100；夜色：沒有霧、清楚鏡面、沒有閃光、波紋中間值、卡片高度中間偏低、地平線 100', () => {
    expect(RANGE.waterLook).toEqual({ min: 0, max: 100 });
    expect(DEFAULT_WATER_LOOK).toEqual({
      mist: 0,
      mistColor: DEFAULT_WATER_LOOK.mistColor,
      streak: 0,
      glint: 0,
      glintColor: DEFAULT_WATER_LOOK.glintColor,
      ripple: 50,
      lift: 30,
      horizon: 100,
    });
    expect(Object.keys(DEFAULT_WATER_LOOK)).toEqual(['mist', 'mistColor', 'streak', 'glint', 'glintColor', 'ripple', 'lift', 'horizon']);
    for (const c of COLORS) expect(DEFAULT_WATER_LOOK[c]).toMatch(/^#[0-9a-f]{6}$/);
    expect(Object.isFrozen(DEFAULT_WATER_LOOK)).toBe(true);
  });

  it('霧白：霧濃、霧色淡（亮）、倒影拉長、閃光暖色、卡片站在水上、地平線低；欄位齊全、值合格', () => {
    const m = MIST_WATER_LOOK;
    expect(Object.keys(m)).toEqual(Object.keys(DEFAULT_WATER_LOOK));
    for (const k of NUMBERS) {
      expect(Number.isInteger(m[k]), k).toBe(true);
      expect(m[k], k).toBeGreaterThanOrEqual(0);
      expect(m[k], k).toBeLessThanOrEqual(100);
    }
    // T-825c：霧約 85～90（遠景只剩淡淡的影子）
    expect(m.mist).toBeGreaterThanOrEqual(85);
    expect(m.mist).toBeLessThanOrEqual(90);
    expect(m.streak).toBeGreaterThan(30);
    expect(m.glint).toBeGreaterThan(20);
    expect(m.lift).toBe(0);
    expect(m.horizon).toBeLessThanOrEqual(10);
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
    const [mr, mg, mb] = rgb(m.mistColor);
    expect(Math.min(mr, mg, mb)).toBeGreaterThan(170); // 淡灰白
    const [gr, , gb] = rgb(m.glintColor);
    expect(gr).toBeGreaterThan(gb + 60); // 暖金
    expect(validateCard(withLook(m), anyImage)).toEqual([]);
    expect(WATER_LOOK_PRESETS).toEqual({ night: DEFAULT_WATER_LOOK, mist: MIST_WATER_LOOK });
  });
});

describe('驗證：view.waterLook 可以省略，有的話 6 個 0～100 的整數＋2 個顏色', () => {
  it('新卡沒有這個欄位；舊卡（沒有 waterLook）照讀', () => {
    const c = plain(fresh());
    expect(own(c.view, 'waterLook')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('合格：預設值（明寫也收）、兩端、大寫顏色', () => {
    for (const ok of [
      { ...DEFAULT_WATER_LOOK },
      { mist: 100, mistColor: '#FFFFFF', streak: 100, glint: 100, glintColor: '#000000', ripple: 0, lift: 100, horizon: 0 },
      { mist: 0, mistColor: '#abcdef', streak: 0, glint: 0, glintColor: '#12ab9F', ripple: 100, lift: 0, horizon: 100 },
    ]) {
      expect(validateCard(withLook(ok), anyImage), JSON.stringify(ok)).toEqual([]);
    }
  });

  it('不合格：超出範圍、小數、不是數字、壞顏色、少欄位、多欄位、不是物件；錯誤指到 view.waterLook', () => {
    const d = { ...DEFAULT_WATER_LOOK };
    const bad: unknown[] = [
      { ...d, mist: 101 },
      { ...d, streak: -1 },
      { ...d, glint: 50.5 },
      { ...d, ripple: '50' },
      { ...d, lift: null },
      { ...d, horizon: Number.NaN },
      { ...d, mistColor: 'white' },
      { ...d, glintColor: '#fff' },
      { ...d, mistColor: '#12345g' },
      (({ mist: _m, ...rest }) => rest)(d),
      (({ glintColor: _g, ...rest }) => rest)(d),
      { ...d, fog: 3 },
      null,
      0,
      'mist',
      [0, 0],
    ];
    for (const b of bad) {
      const errors = validateCard(withLook(b), anyImage);
      expect(errors.length, JSON.stringify(b)).toBeGreaterThan(0);
      for (const e of errors) expect(e, JSON.stringify(b)).toMatch(/^view\.waterLook/);
    }
  });

  it('光碟、任何舞台都能有（不是水鏡就照存不畫）', () => {
    expect(validateCard(withLook(MIST_WATER_LOOK, newDisc('d1', NOW)), anyImage)).toEqual([]);
    for (const stage of ['halo', 'gallery', 'magic', 'water', 'nebula', 'none'] as const) {
      expect(validateCard(withLook(MIST_WATER_LOOK, updateCard(fresh(), { view: { stage } })), anyImage), stage).toEqual([]);
    }
  });
});

describe('waterLookOf：這張卡的水面樣子', () => {
  it('省略＝夜色；有的話照它；回的是新物件（改它不會改到預設）', () => {
    const d = waterLookOf(fresh());
    expect(d).toEqual(DEFAULT_WATER_LOOK);
    expect(d).not.toBe(DEFAULT_WATER_LOOK);
    expect(waterLookOf(look(MIST_WATER_LOOK))).toEqual(MIST_WATER_LOOK);
  });

  it('壞資料（不該發生，驗證會擋）：每個欄位各自夾範圍、取整或用預設值，不丟錯', () => {
    const odd = (p: unknown) => ({ ...fresh(), view: { ...fresh().view, waterLook: p } }) as unknown as Card;
    expect(waterLookOf(odd({ mist: 500, streak: -3, glint: 12.6, ripple: 'x', lift: Number.NaN, horizon: null, mistColor: 'red', glintColor: '#ABCDEF' }))).toEqual({
      ...DEFAULT_WATER_LOOK,
      mist: 100,
      streak: 0,
      glint: 13,
      glintColor: '#abcdef',
    });
    expect(waterLookOf(odd(null))).toEqual(DEFAULT_WATER_LOOK);
    expect(waterLookOf(odd('mist'))).toEqual(DEFAULT_WATER_LOOK);
    expect(waterLookOf(odd([1, 2]))).toEqual(DEFAULT_WATER_LOOK);
  });
});

describe('動作：updateCard 的 view.waterLook', () => {
  it('只給一個欄位：其他照舊（沒有欄位時從夜色開始）；存整組；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const a = look({ mist: 40 }, card);
    expect(a.view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 40 });
    const b = look({ horizon: 0 }, a);
    expect(b.view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 40, horizon: 0 });
    const c = look({ glintColor: '#FFAA00' }, b);
    expect(c.view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 40, horizon: 0, glintColor: '#ffaa00' });
    expect(card).toEqual(before);
    expect(a.view).toEqual({ ...card.view, waterLook: { ...DEFAULT_WATER_LOOK, mist: 40 } });
  });

  it('夾範圍、四捨五入成整數', () => {
    expect(look({ mist: 300, streak: -20, glint: 33.4, ripple: 66.5, lift: 0.4, horizon: 99.6 }).view.waterLook).toEqual({
      ...DEFAULT_WATER_LOOK,
      mist: 100,
      streak: 0,
      glint: 33,
      ripple: 67,
      lift: 0,
      horizon: 100,
    });
  });

  it('快速套用：整組換掉（一次 updateCard）；回到夜色＝拿掉欄位（不寫 undefined）', () => {
    const misty = look(MIST_WATER_LOOK);
    expect(misty.view.waterLook).toEqual(MIST_WATER_LOOK);
    expect(misty.view.waterLook).not.toBe(MIST_WATER_LOOK);
    const back = look(DEFAULT_WATER_LOOK, misty);
    expect(own(back.view, 'waterLook')).toBe(false);
    expect(back.view).toEqual(fresh().view);
    // 一個一個拉回預設值也一樣
    let c = look({ mist: 10 });
    c = look({ mist: 0 }, c);
    expect(own(c.view, 'waterLook')).toBe(false);
  });

  it('沒有改變回原卡（同一個物件）：沒有欄位時給預設值、同一組再給一次、四捨五入後一樣、顏色大小寫不同', () => {
    const card = fresh();
    expect(look({ ...DEFAULT_WATER_LOOK }, card)).toBe(card);
    expect(look({}, card)).toBe(card);
    const a = look({ glint: 40, glintColor: '#ffaa00' }, card);
    expect(look({ glint: 40 }, a)).toBe(a);
    expect(look({ glint: 40.2, glintColor: '#FFAA00' }, a)).toBe(a);
    // 明寫預設值的舊卡（別的程式寫的）給預設值也不改
    const explicit = { ...card, view: { ...card.view, waterLook: { ...DEFAULT_WATER_LOOK } } };
    expect(look({ mist: 0 }, explicit)).toBe(explicit);
  });

  it('不合格的值（NaN、無限大、不是數字、壞顏色）那個欄位不改', () => {
    const a = look({ mist: 30, glintColor: '#123456' });
    for (const bad of [Number.NaN, Infinity, -Infinity, '50', null, undefined] as unknown as number[]) {
      expect(look({ mist: bad }, a), String(bad)).toBe(a);
      expect(look({ horizon: bad }, a), String(bad)).toBe(a);
    }
    for (const bad of ['red', '#fff', '#12345g', 3, null] as unknown as string[]) expect(look({ glintColor: bad }, a), String(bad)).toBe(a);
    expect(look({ mist: Number.NaN, streak: 20 }, a).view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 30, glintColor: '#123456', streak: 20 });
    for (const bad of [null, 'mist', 3, [1]] as unknown as Partial<WaterLook>[]) expect(look(bad, a)).toBe(a);
  });

  it('拖滑桿：預覽中不記步、放開記一步；快速套用一步；復原回到之前', () => {
    let h = createHistory(fresh());
    h = preview(h, look({ streak: 10 }, h.previewBase ?? h.present));
    h = preview(h, look({ streak: 45 }, h.previewBase ?? h.present));
    h = commit(h);
    expect(waterLookOf(h.present).streak).toBe(45);
    h = apply(h, look(MIST_WATER_LOOK, h.present));
    expect(waterLookOf(h.present)).toEqual(MIST_WATER_LOOK);
    h = undo(h);
    expect(waterLookOf(h.present)).toEqual({ ...DEFAULT_WATER_LOOK, streak: 45 });
    h = undo(h);
    expect(own(h.present.view, 'waterLook')).toBe(false);
  });

  it('和其他 view 欄位一起改也可以；只改別的欄位不動水面樣子', () => {
    const both = updateCard(fresh(), { view: { stage: 'water', waterScene: 'ink', farPan: { zoom: 2 }, waterLook: { mist: 70 } } });
    expect(both.view.stage).toBe('water');
    expect(both.view.waterScene).toBe('ink');
    expect(both.view.farPan).toEqual({ x: 0, y: 0, zoom: 2 });
    expect(both.view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 70 });
    expect(updateCard(both, { view: { stage: 'halo' } }).view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 70 });
    expect(updateCard(both, { view: { farPan: { x: 0.2 } } }).view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 70 });
  });
});

describe('其他動作都保留水面樣子', () => {
  const looked = () => look(MIST_WATER_LOOK);

  it('背景圖、換遠景、換舞台、卡套、套風格、換比例、光碟', () => {
    expect(setBackdrop(looked(), hash(7)).view.waterLook).toEqual(MIST_WATER_LOOK);
    expect(updateCard(looked(), { view: { waterScene: 'fuji' } }).view.waterLook).toEqual(MIST_WATER_LOOK);
    expect(updateCard(looked(), { view: { stage: 'nebula' } }).view.waterLook).toEqual(MIST_WATER_LOOK);
    expect(updateCard(looked(), { view: { sleeve: true } }).view.waterLook).toEqual(MIST_WATER_LOOK);
    expect(applyCardStyle(looked(), 'gold').view.waterLook).toEqual(MIST_WATER_LOOK);
    expect(updateCard(looked(), { aspect: 'tarot' }).view.waterLook).toEqual(MIST_WATER_LOOK);
    const disc = look({ horizon: 20 }, newDisc('d1', NOW));
    expect(disc.view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, horizon: 20 });
    expect(validateCard(plain(disc), anyImage)).toEqual([]);
  });
});

describe('寫出時（卡片檔）', () => {
  it('不是預設值照寫；明寫預設值、欄位在但是 undefined 都拿掉', () => {
    expect(omitCardDefaults(look({ mist: 5 })).view.waterLook).toEqual({ ...DEFAULT_WATER_LOOK, mist: 5 });
    const explicit = { ...fresh(), view: { ...fresh().view, waterLook: { ...DEFAULT_WATER_LOOK } } };
    expect(own(omitCardDefaults(explicit).view, 'waterLook')).toBe(false);
    const upper = { ...fresh(), view: { ...fresh().view, waterLook: { ...DEFAULT_WATER_LOOK, mistColor: DEFAULT_WATER_LOOK.mistColor.toUpperCase() } } };
    expect(own(omitCardDefaults(upper).view, 'waterLook')).toBe(false);
    const odd = { ...fresh(), view: { ...fresh().view, waterLook: undefined } } as Card;
    expect(own(omitCardDefaults(odd).view, 'waterLook')).toBe(false);
  });

  it('沒有要拿掉的回原卡', () => {
    const card = fresh();
    expect(omitCardDefaults(card)).toBe(card);
    const m = look(MIST_WATER_LOOK);
    expect(omitCardDefaults(m)).toBe(m);
  });
});
