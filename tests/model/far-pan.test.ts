// 遠景位置與大小（T-822，SCHEMA 的 view.farPan?、DESIGN §5「遠景位置」）：可以省略（舊卡照讀、省略＝{0,0,1}）；
// 有的話三個有限數字（x、y −1～1，zoom 1～3）；改它走 updateCard 的 view（只給要改的欄位、夾範圍、照 0.01 四捨五入；
// 回到 {0,0,1} 時拿掉欄位）；寫出時 {0,0,1} 省略；換舞台、換背景圖、換遠景、套風格、換比例、複製、光碟都保留它。
import { describe, expect, it } from 'vitest';
import { addLayer, farPanOf, omitCardDefaults, setBackdrop, updateCard, updateFoil, updateLayer } from '../../src/model/actions';
import { newCard, newDisc } from '../../src/model/create';
import { apply, commit, createHistory, preview, undo } from '../../src/model/history';
import { DEFAULT_FAR_PAN, RANGE } from '../../src/model/limits';
import { applyCardStyle } from '../../src/model/styles';
import type { Card, FarPan } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, hash, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const withPan = (pan: unknown, card: Card = fresh()): unknown => {
  const c = plain(card) as unknown as { view: Record<string, unknown> };
  c.view.farPan = pan;
  return c;
};
const pan = (p: Partial<FarPan>, card: Card = fresh()): Card => updateCard(card, { view: { farPan: p } });

describe('預設值與範圍', () => {
  it('省略＝置中、剛好蓋滿（{0,0,1}）；x、y −1～1，zoom 1～3', () => {
    expect(DEFAULT_FAR_PAN).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(RANGE.farPan).toEqual({ min: -1, max: 1 });
    expect(RANGE.farZoom).toEqual({ min: 1, max: 3 });
  });
});

describe('驗證：view.farPan 可以省略，有的話三個有限數字、在範圍裡', () => {
  it('新卡沒有這個欄位；舊卡（沒有 farPan）照讀', () => {
    const c = plain(fresh());
    expect(own(c.view, 'farPan')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('合格：預設值、兩端、小數（沒四捨五入的也收）', () => {
    for (const ok of [
      { x: 0, y: 0, zoom: 1 },
      { x: -1, y: 1, zoom: 3 },
      { x: 1, y: -1, zoom: 1 },
      { x: 0.35, y: -0.2, zoom: 1.5 },
      { x: 0.123456, y: 0, zoom: 2.0001 },
    ]) {
      expect(validateCard(withPan(ok), anyImage), JSON.stringify(ok)).toEqual([]);
    }
  });

  it('不合格：超出範圍、不是數字、少欄位、多欄位、不是物件；錯誤指到 view.farPan', () => {
    const bad: unknown[] = [
      { x: 1.01, y: 0, zoom: 1 },
      { x: 0, y: -1.5, zoom: 1 },
      { x: 0, y: 0, zoom: 0.99 },
      { x: 0, y: 0, zoom: 3.5 },
      { x: '0', y: 0, zoom: 1 },
      { x: 0, y: null, zoom: 1 },
      { x: 0, y: 0 },
      { x: 0, zoom: 1 },
      { x: 0, y: 0, zoom: 1, rotate: 5 },
      null,
      0,
      'center',
      [0, 0, 1],
    ];
    for (const b of bad) {
      const errors = validateCard(withPan(b), anyImage);
      expect(errors.length, JSON.stringify(b)).toBeGreaterThan(0);
      for (const e of errors) expect(e, JSON.stringify(b)).toMatch(/^view\.farPan/);
    }
  });

  it('無限大、NaN 不合格（JSON 讀不出來，但程式裡的資料也要擋）', () => {
    for (const b of [{ x: Infinity, y: 0, zoom: 1 }, { x: 0, y: Number.NaN, zoom: 1 }, { x: 0, y: 0, zoom: -Infinity }]) {
      const c = plain(fresh()) as unknown as { view: Record<string, unknown> };
      c.view.farPan = b;
      const errors = validateCard(c, anyImage);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/^view\.farPan\./);
    }
  });

  it('光碟、任何舞台、沒有背景圖也能有（看不到就不畫，照存）', () => {
    expect(validateCard(withPan({ x: 0.5, y: 0, zoom: 2 }, newDisc('d1', NOW)), anyImage)).toEqual([]);
    for (const stage of ['halo', 'gallery', 'magic', 'water', 'nebula', 'none'] as const) {
      expect(validateCard(withPan({ x: -0.5, y: 0.5, zoom: 1.2 }, updateCard(fresh(), { view: { stage } })), anyImage), stage).toEqual([]);
    }
  });
});

describe('farPanOf：這張卡的遠景位置', () => {
  it('省略＝{0,0,1}；有的話照它', () => {
    expect(farPanOf(fresh())).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(farPanOf(pan({ x: 0.4, y: -0.3, zoom: 2 }))).toEqual({ x: 0.4, y: -0.3, zoom: 2 });
  });

  it('壞資料（不該發生，驗證會擋）：每個欄位各自夾範圍或用預設值，不丟錯', () => {
    const odd = (p: unknown) => ({ ...fresh(), view: { ...fresh().view, farPan: p } }) as unknown as Card;
    expect(farPanOf(odd({ x: 5, y: -5, zoom: 9 }))).toEqual({ x: 1, y: -1, zoom: 3 });
    expect(farPanOf(odd({ x: Number.NaN, y: 'a', zoom: 0 }))).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(farPanOf(odd(null))).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(farPanOf(odd('center'))).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('動作：updateCard 的 view.farPan', () => {
  it('只給一個欄位：其他照舊（沒有欄位時從 {0,0,1} 開始）；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const a = pan({ x: 0.5 }, card);
    expect(a.view.farPan).toEqual({ x: 0.5, y: 0, zoom: 1 });
    const b = pan({ zoom: 1.8 }, a);
    expect(b.view.farPan).toEqual({ x: 0.5, y: 0, zoom: 1.8 });
    const c = pan({ y: -0.25 }, b);
    expect(c.view.farPan).toEqual({ x: 0.5, y: -0.25, zoom: 1.8 });
    expect(card).toEqual(before);
    expect(a.view).toEqual({ ...card.view, farPan: { x: 0.5, y: 0, zoom: 1 } });
  });

  it('夾範圍、照 0.01 四捨五入（不會有 -0）', () => {
    expect(pan({ x: 3, y: -2, zoom: 7 }).view.farPan).toEqual({ x: 1, y: -1, zoom: 3 });
    expect(pan({ x: -3, y: 2, zoom: 0.2 }).view.farPan).toEqual({ x: -1, y: 1, zoom: 1 });
    expect(pan({ x: 0.123, y: -0.456, zoom: 1.2345 }).view.farPan).toEqual({ x: 0.12, y: -0.46, zoom: 1.23 });
    // 浮點：滑桿的 35 / 100 之類
    expect(pan({ x: 35 / 100, zoom: 157 / 100 }).view.farPan).toEqual({ x: 0.35, y: 0, zoom: 1.57 });
    const tiny = pan({ x: 0.5, y: -0.004 });
    expect(Object.is(tiny.view.farPan!.y, 0)).toBe(true);
  });

  it('回到 {0,0,1}：拿掉欄位（不寫 undefined）', () => {
    const back = pan({ x: 0, y: 0, zoom: 1 }, pan({ x: 0.4, y: 0.2, zoom: 2 }));
    expect(own(back.view, 'farPan')).toBe(false);
    expect(back.view).toEqual(fresh().view);
    // 四捨五入後是預設值也算
    expect(own(pan({ x: 0.001, y: -0.003, zoom: 1.004 }).view, 'farPan')).toBe(false);
  });

  it('沒有改變回原卡（同一個物件）：沒有欄位時給預設值、同一組再給一次、四捨五入後一樣', () => {
    const card = fresh();
    expect(pan({ x: 0, y: 0, zoom: 1 }, card)).toBe(card);
    expect(pan({}, card)).toBe(card);
    const a = pan({ x: 0.3, zoom: 1.5 }, card);
    expect(pan({ x: 0.3 }, a)).toBe(a);
    expect(pan({ x: 0.301, zoom: 1.499 }, a)).toBe(a);
    // 明寫 {0,0,1} 的舊卡（別的程式寫的）給預設值也不改
    const explicit = { ...card, view: { ...card.view, farPan: { x: 0, y: 0, zoom: 1 } } };
    expect(pan({ x: 0 }, explicit)).toBe(explicit);
  });

  it('不合格的值（NaN、無限大、不是數字）那個欄位不改', () => {
    const a = pan({ x: 0.3, y: 0.1, zoom: 1.5 });
    for (const bad of [Number.NaN, Infinity, -Infinity, '0.5', null, undefined] as unknown as number[]) {
      expect(pan({ x: bad }, a), String(bad)).toBe(a);
      expect(pan({ zoom: bad }, a), String(bad)).toBe(a);
    }
    expect(pan({ x: Number.NaN, zoom: 2 }, a).view.farPan).toEqual({ x: 0.3, y: 0.1, zoom: 2 });
    for (const bad of [null, 'center', 3, [0.5]] as unknown as Partial<FarPan>[]) expect(pan(bad, a)).toBe(a);
  });

  it('拖滑桿：預覽中不記步、放開記一步；復原回到拖之前', () => {
    let h = createHistory(fresh());
    h = preview(h, pan({ x: 0.1 }, h.previewBase ?? h.present));
    h = preview(h, pan({ x: 0.4 }, h.previewBase ?? h.present));
    h = preview(h, pan({ x: 0.6 }, h.previewBase ?? h.present));
    h = commit(h);
    expect(farPanOf(h.present)).toEqual({ x: 0.6, y: 0, zoom: 1 });
    h = apply(h, pan({ x: 0, y: 0 }, h.present));
    expect(own(h.present.view, 'farPan')).toBe(false);
    h = undo(h);
    expect(farPanOf(h.present)).toEqual({ x: 0.6, y: 0, zoom: 1 });
    h = undo(h);
    expect(own(h.present.view, 'farPan')).toBe(false);
  });

  it('和其他 view 欄位一起改也可以；只改別的欄位不動位置', () => {
    const both = updateCard(fresh(), { view: { stage: 'water', waterScene: 'fuji', farPan: { x: 0.7, zoom: 1.5 } } });
    expect(both.view.stage).toBe('water');
    expect(both.view.waterScene).toBe('fuji');
    expect(both.view.farPan).toEqual({ x: 0.7, y: 0, zoom: 1.5 });
    expect(updateCard(both, { view: { stage: 'halo' } }).view.farPan).toEqual({ x: 0.7, y: 0, zoom: 1.5 });
    expect(updateCard(both, { view: { waterScene: 'ink' } }).view.farPan).toEqual({ x: 0.7, y: 0, zoom: 1.5 });
  });
});

describe('其他動作都保留位置（換背景圖、換遠景時不歸零）', () => {
  const panned = () => pan({ x: -0.4, y: 0.3, zoom: 2.2 });
  const want = { x: -0.4, y: 0.3, zoom: 2.2 };

  it('背景圖加、換、拿掉；換遠景；換舞台；卡套', () => {
    const bd = setBackdrop(panned(), hash(7));
    expect(bd.view.farPan).toEqual(want);
    expect(setBackdrop(bd, hash(8)).view.farPan).toEqual(want);
    expect(setBackdrop(bd, null).view.farPan).toEqual(want);
    expect(updateCard(panned(), { view: { waterScene: 'fuji' } }).view.farPan).toEqual(want);
    expect(updateCard(panned(), { view: { stage: 'nebula' } }).view.farPan).toEqual(want);
    expect(updateCard(panned(), { view: { sleeve: true } }).view.farPan).toEqual(want);
  });

  it('套風格（T-801）、換比例（T-807）、圖層、反光層', () => {
    expect(applyCardStyle(panned(), 'gold').view.farPan).toEqual(want);
    expect(updateCard(panned(), { aspect: 'tarot' }).view.farPan).toEqual(want);
    expect(updateCard(panned(), { aspect: 'custom', customAspect: { width: 3, height: 2 } }).view.farPan).toEqual(want);
    const added = addLayer(panned(), 'front', { id: 'x', name: 'x', image: hash(1), hasAlpha: true, width: 10, height: 10 });
    if (!added.ok) throw new Error(added.reason);
    expect(updateLayer(added.card, 'front', 'x', { depth: 80 }).view.farPan).toEqual(want);
    expect(updateFoil(panned(), 'front', { shape: 'none' }).view.farPan).toEqual(want);
  });

  it('光碟（T-810）也能調、驗證照過', () => {
    const disc = pan({ x: 0.2, zoom: 1.4 }, newDisc('d1', NOW));
    expect(disc.view.farPan).toEqual({ x: 0.2, y: 0, zoom: 1.4 });
    expect(validateCard(plain(disc), anyImage)).toEqual([]);
  });
});

describe('寫出時（卡片檔）', () => {
  it('不是預設值照寫；明寫 {0,0,1}、欄位在但是 undefined 都拿掉', () => {
    expect(omitCardDefaults(pan({ x: 0.5 })).view.farPan).toEqual({ x: 0.5, y: 0, zoom: 1 });
    const explicit = { ...fresh(), view: { ...fresh().view, farPan: { x: 0, y: 0, zoom: 1 } } };
    expect(own(omitCardDefaults(explicit).view, 'farPan')).toBe(false);
    const odd = { ...fresh(), view: { ...fresh().view, farPan: undefined } } as Card;
    expect(own(omitCardDefaults(odd).view, 'farPan')).toBe(false);
  });

  it('沒有要拿掉的回原卡', () => {
    const card = fresh();
    expect(omitCardDefaults(card)).toBe(card);
    const p = pan({ zoom: 2 });
    expect(omitCardDefaults(p)).toBe(p);
  });
});

describe('四捨五入的半格（T-822 審查）', () => {
  it('剛好一半時照十進位四捨五入、正負對稱（1.005→1.01、0.125→0.13、−0.125→−0.13），浮點誤差不會把它捨掉', () => {
    const c = newCard('standard', 'c', NOW);
    expect(updateCard(c, { view: { farPan: { zoom: 1.005 } } }).view.farPan).toEqual({ x: 0, y: 0, zoom: 1.01 });
    expect(updateCard(c, { view: { farPan: { x: 0.125 } } }).view.farPan).toEqual({ x: 0.13, y: 0, zoom: 1 });
    expect(updateCard(c, { view: { farPan: { x: -0.125 } } }).view.farPan).toEqual({ x: -0.13, y: 0, zoom: 1 });
    expect(updateCard(c, { view: { farPan: { y: 0.004 } } }).view.farPan).toBeUndefined();
    expect(Object.is(updateCard(c, { view: { farPan: { x: -0.004, zoom: 2 } } }).view.farPan!.x, 0)).toBe(true);
  });
});
