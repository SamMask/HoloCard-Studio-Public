// 前景圖（T-830，SCHEMA 的 view.foreground?、DESIGN §5「前景圖」）：可以省略（舊卡照讀、省略＝沒有）；有的話
// { image, x, y, scale, blur }：image 是合格雜湊而且圖要存在、算進每張卡最多 16 張圖；x、y −1～1、scale 0.5～3（有限數字），
// blur 0～100 的整數；不能多欄位。加、換、拿掉走 setForeground（各一步；剛加上擺在左下角、模糊 40；換一張沿用位置；拿掉時拿掉欄位）；
// 位置、大小、模糊走 updateCard 的 view.foreground（只給要改的欄位、夾範圍、x／y／scale 照 0.01 四捨五入、blur 取整數；image 不理；
// 沒有前景圖時不做事）；寫出時欄位在但是 undefined 拿掉；「用到的圖」含前景圖。
import { describe, expect, it } from 'vitest';
import { addLayer, foregroundOf, omitCardDefaults, setBackdrop, setForeground, updateCard, updateFoil } from '../../src/model/actions';
import { newCard, newDisc } from '../../src/model/create';
import { cardImages } from '../../src/model/foil';
import { apply, commit, createHistory, preview, undo } from '../../src/model/history';
import { DEFAULT_FOREGROUND, MAX_CARD_IMAGES, RANGE } from '../../src/model/limits';
import { applyCardStyle } from '../../src/model/styles';
import type { Card, Foreground } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, hash, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const FG = hash(0xf0);
const withFg = (fg: unknown, card: Card = fresh()): unknown => {
  const c = plain(card) as unknown as { view: Record<string, unknown> };
  c.view.foreground = fg;
  return c;
};
const ok = (over: Partial<Foreground> = {}): Foreground => ({ image: FG, x: -0.7, y: -0.6, scale: 1, blur: 40, ...over });
const added = (card: Card = fresh(), image = FG): Card => setForeground(card, image);
const move = (p: Partial<Omit<Foreground, 'image'>>, card: Card = added()): Card => updateCard(card, { view: { foreground: p } });

/** n 張不同的立體層圖（分成兩面，每面最多 8 層）。 */
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

describe('預設值與範圍', () => {
  it('x、y −1～1，scale 0.5～3，blur 0～100；剛加上＝左下角（−0.7, −0.6）、大小 1、模糊 40', () => {
    expect(RANGE.foregroundPos).toEqual({ min: -1, max: 1 });
    expect(RANGE.foregroundScale).toEqual({ min: 0.5, max: 3 });
    expect(RANGE.foregroundBlur).toEqual({ min: 0, max: 100 });
    expect(DEFAULT_FOREGROUND).toEqual({ x: -0.7, y: -0.6, scale: 1, blur: 40 });
  });
});

describe('驗證：view.foreground 可以省略，有的話五個欄位都要對', () => {
  it('新卡沒有這個欄位；舊卡（沒有 foreground）照讀', () => {
    const c = plain(fresh());
    expect(own(c.view, 'foreground')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('合格：預設、兩端、小數（沒四捨五入的也收）；光碟、任何舞台也能有', () => {
    for (const f of [ok(), ok({ x: -1, y: 1, scale: 0.5, blur: 0 }), ok({ x: 1, y: -1, scale: 3, blur: 100 }), ok({ x: 0.123456, scale: 1.0001 })]) {
      expect(validateCard(withFg(f), anyImage), JSON.stringify(f)).toEqual([]);
    }
    expect(validateCard(withFg(ok(), newDisc('d1', NOW)), anyImage)).toEqual([]);
    for (const stage of ['halo', 'gallery', 'magic', 'water', 'nebula', 'none'] as const) {
      expect(validateCard(withFg(ok(), updateCard(fresh(), { view: { stage } })), anyImage), stage).toEqual([]);
    }
  });

  it('不合格：超出範圍、blur 不是整數、不是數字、雜湊格式、少欄位、多欄位、不是物件；錯誤都指到 view.foreground', () => {
    const bad: unknown[] = [
      ok({ x: 1.01 }),
      ok({ y: -1.5 }),
      ok({ scale: 0.49 }),
      ok({ scale: 3.2 }),
      ok({ blur: -1 }),
      ok({ blur: 101 }),
      ok({ blur: 40.5 }),
      { ...ok(), x: '0' },
      { ...ok(), blur: null },
      { ...ok(), image: 'ABCDEF0123456789' },
      { ...ok(), image: 7 },
      { x: 0, y: 0, scale: 1, blur: 40 },
      { image: FG, x: 0, y: 0, scale: 1 },
      { ...ok(), rotate: 5 },
      null,
      FG,
      [FG],
    ];
    for (const b of bad) {
      const errors = validateCard(withFg(b), anyImage);
      expect(errors.length, JSON.stringify(b)).toBeGreaterThan(0);
      for (const e of errors) expect(e, JSON.stringify(b)).toMatch(/^view\.foreground/);
    }
  });

  it('無限大、NaN 不合格（JSON 讀不出來，但程式裡的資料也要擋）', () => {
    for (const b of [ok({ x: Infinity }), ok({ y: Number.NaN }), ok({ scale: -Infinity })]) {
      const errors = validateCard(withFg(b), anyImage);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/^view\.foreground\./);
    }
  });

  it('圖不存在 → 不合格（找不到這張圖片）', () => {
    const errors = validateCard(withFg(ok()), (h) => h !== FG);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^view\.foreground\.image.*找不到/);
  });

  it('算進每張卡最多 16 張圖：16 張圖層＋前景圖 → 不合格；和圖層、背景圖同一張不重複算', () => {
    const full = cardWithImages(MAX_CARD_IMAGES);
    const over = validateCard(withFg(ok(), full), anyImage);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatch(/圖片最多 16 張/);
    expect(over[0]).toContain('前景圖');
    expect(validateCard(withFg(ok({ image: hash(100) }), full), anyImage)).toEqual([]);
    const fifteen = setBackdrop(cardWithImages(MAX_CARD_IMAGES - 1), hash(7));
    expect(validateCard(withFg(ok({ image: hash(7) }), fifteen), anyImage)).toEqual([]);
    expect(validateCard(withFg(ok({ image: hash(8) }), fifteen), anyImage)).toHaveLength(1);
  });
});

describe('setForeground：加上、換一張、拿掉', () => {
  it('加上：擺在左下角、大小 1、模糊 40；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const a = added(card);
    expect(a.view.foreground).toEqual({ image: FG, ...DEFAULT_FOREGROUND });
    expect(card).toEqual(before);
    expect(validateCard(plain(a), anyImage)).toEqual([]);
  });

  it('換一張：位置、大小、模糊照舊（不回到左下角）', () => {
    const moved = move({ x: 0.4, y: 0.2, scale: 2, blur: 70 });
    const changed = setForeground(moved, hash(0xf1));
    expect(changed.view.foreground).toEqual({ image: hash(0xf1), x: 0.4, y: 0.2, scale: 2, blur: 70 });
  });

  it('拿掉：拿掉欄位（不寫 undefined）；沒有時拿掉、同一張再設、不合格雜湊 → 回原卡', () => {
    const removed = setForeground(added(), null);
    expect(own(removed.view, 'foreground')).toBe(false);
    expect(removed.view).toEqual(fresh().view);
    const card = fresh();
    expect(setForeground(card, null)).toBe(card);
    const a = added();
    expect(setForeground(a, FG)).toBe(a);
    for (const bad of ['ABCDEF0123456789', 'abc', '', 7, undefined] as unknown as string[]) expect(setForeground(card, bad), String(bad)).toBe(card);
  });

  it('會超過 16 張圖 → 不改；圖已經在卡片裡（同一張圖層）不多算', () => {
    const full = cardWithImages(MAX_CARD_IMAGES);
    expect(setForeground(full, FG)).toBe(full);
    expect(setForeground(full, hash(100)).view.foreground?.image).toBe(hash(100));
    // 前景圖和背景圖算兩張
    const fifteen = cardWithImages(MAX_CARD_IMAGES - 1);
    const withBd = setBackdrop(fifteen, hash(7));
    expect(setForeground(withBd, FG)).toBe(withBd);
    expect(setBackdrop(added(fifteen), hash(7)).view.backdrop).toBeUndefined();
  });

  it('復原：加、換、拿掉各一步', () => {
    let h = createHistory(fresh());
    h = apply(h, setForeground(h.present, FG));
    h = apply(h, setForeground(h.present, hash(0xf1)));
    h = apply(h, setForeground(h.present, null));
    expect(own(h.present.view, 'foreground')).toBe(false);
    h = undo(h);
    expect(h.present.view.foreground?.image).toBe(hash(0xf1));
    h = undo(h);
    expect(h.present.view.foreground?.image).toBe(FG);
    h = undo(h);
    expect(own(h.present.view, 'foreground')).toBe(false);
  });
});

describe('foregroundOf：這張卡的前景圖', () => {
  it('省略＝null；有的話照它', () => {
    expect(foregroundOf(fresh())).toBeNull();
    expect(foregroundOf(move({ x: 0.3 }))).toEqual({ image: FG, x: 0.3, y: -0.6, scale: 1, blur: 40 });
  });

  it('壞資料（不該發生，驗證會擋）：雜湊不對＝null；數字欄位各自夾範圍或用預設值，不丟錯', () => {
    const odd = (f: unknown) => ({ ...fresh(), view: { ...fresh().view, foreground: f } }) as unknown as Card;
    expect(foregroundOf(odd({ image: FG, x: 5, y: -5, scale: 9, blur: 300 }))).toEqual({ image: FG, x: 1, y: -1, scale: 3, blur: 100 });
    expect(foregroundOf(odd({ image: FG, x: Number.NaN, y: 'a', scale: 0, blur: 40.6 }))).toEqual({ image: FG, x: -0.7, y: -0.6, scale: 0.5, blur: 41 });
    expect(foregroundOf(odd({ image: 'nope', x: 0, y: 0, scale: 1, blur: 0 }))).toBeNull();
    expect(foregroundOf(odd(null))).toBeNull();
    expect(foregroundOf(odd(FG))).toBeNull();
  });
});

describe('updateCard 的 view.foreground：位置、大小、模糊', () => {
  it('只給一個欄位：其他照舊；不改輸入', () => {
    const a = added();
    const before = plain(a);
    const b = move({ x: 0.5 }, a);
    expect(b.view.foreground).toEqual({ image: FG, x: 0.5, y: -0.6, scale: 1, blur: 40 });
    const c = move({ blur: 75 }, b);
    expect(c.view.foreground).toEqual({ image: FG, x: 0.5, y: -0.6, scale: 1, blur: 75 });
    const d = move({ scale: 2.5, y: 0.1 }, c);
    expect(d.view.foreground).toEqual({ image: FG, x: 0.5, y: 0.1, scale: 2.5, blur: 75 });
    expect(a).toEqual(before);
  });

  it('夾範圍；x、y、scale 照 0.01 四捨五入（不會有 −0），blur 取整數', () => {
    expect(move({ x: 3, y: -2, scale: 7, blur: 300 }).view.foreground).toEqual({ image: FG, x: 1, y: -1, scale: 3, blur: 100 });
    expect(move({ x: -3, y: 2, scale: 0.1, blur: -5 }).view.foreground).toEqual({ image: FG, x: -1, y: 1, scale: 0.5, blur: 0 });
    expect(move({ x: 0.123, y: -0.456, scale: 1.2345, blur: 33.5 }).view.foreground).toEqual({ image: FG, x: 0.12, y: -0.46, scale: 1.23, blur: 34 });
    expect(move({ x: 35 / 100, scale: 157 / 100 }).view.foreground).toMatchObject({ x: 0.35, scale: 1.57 });
    expect(Object.is(move({ x: -0.004 }).view.foreground!.x, 0)).toBe(true);
    expect(Object.is(move({ blur: -0.2 }).view.foreground!.blur, 0)).toBe(true);
  });

  it('image 不理（換圖用 setForeground）；沒有前景圖時不做事', () => {
    const a = added();
    expect(updateCard(a, { view: { foreground: { image: hash(0xf1) } as Partial<Foreground> } })).toBe(a);
    const card = fresh();
    expect(move({ x: 0.5 }, card)).toBe(card);
    expect(own(move({ x: 0.5 }, card).view, 'foreground')).toBe(false);
  });

  it('沒有改變回原卡；不合格的值（NaN、無限大、不是數字）那個欄位不改', () => {
    const a = move({ x: 0.3, blur: 50 });
    expect(move({ x: 0.3 }, a)).toBe(a);
    expect(move({ x: 0.301, blur: 50.2 }, a)).toBe(a);
    expect(move({}, a)).toBe(a);
    for (const bad of [Number.NaN, Infinity, -Infinity, '0.5', null, undefined] as unknown as number[]) {
      expect(move({ x: bad }, a), String(bad)).toBe(a);
      expect(move({ blur: bad }, a), String(bad)).toBe(a);
    }
    expect(move({ x: Number.NaN, scale: 2 }, a).view.foreground).toEqual({ image: FG, x: 0.3, y: -0.6, scale: 2, blur: 50 });
    for (const bad of [null, 'center', 3, [0.5]] as unknown as Partial<Foreground>[]) expect(updateCard(a, { view: { foreground: bad } })).toBe(a);
  });

  it('置中只給 x、y（大小、模糊不變）；回到 0 也留著欄位（前景圖沒有「預設＝省略」）', () => {
    const c = move({ x: 0, y: 0 }, move({ x: 0.5, y: 0.5, scale: 2, blur: 10 }));
    expect(c.view.foreground).toEqual({ image: FG, x: 0, y: 0, scale: 2, blur: 10 });
  });

  it('拖滑桿：預覽中不記步、放開記一步；復原回到拖之前', () => {
    let h = createHistory(added());
    h = preview(h, move({ blur: 50 }, h.previewBase ?? h.present));
    h = preview(h, move({ blur: 80 }, h.previewBase ?? h.present));
    h = commit(h);
    expect(foregroundOf(h.present)?.blur).toBe(80);
    h = undo(h);
    expect(foregroundOf(h.present)?.blur).toBe(40);
  });

  it('和其他 view 欄位一起改也可以；只改別的欄位、換背景圖、套風格、換比例都不動前景圖', () => {
    const a = move({ x: 0.2 });
    const want = a.view.foreground;
    const both = updateCard(a, { view: { stage: 'water', foreground: { blur: 10 } } });
    expect(both.view.stage).toBe('water');
    expect(both.view.foreground).toEqual({ ...want, blur: 10 });
    expect(updateCard(a, { view: { stage: 'halo', farPan: { x: 0.5 } } }).view.foreground).toEqual(want);
    expect(setBackdrop(a, hash(7)).view.foreground).toEqual(want);
    expect(applyCardStyle(a, 'gold').view.foreground).toEqual(want);
    expect(updateCard(a, { aspect: 'tarot' }).view.foreground).toEqual(want);
    expect(updateFoil(a, 'front', { shape: 'none' }).view.foreground).toEqual(want);
  });
});

describe('「用到的圖」與寫出', () => {
  it('cardImages：前景圖排在背景圖後面；和圖層、背景圖同一張不重複', () => {
    const two = cardWithImages(2);
    expect(cardImages(added(setBackdrop(two, hash(7))))).toEqual([hash(100), hash(101), hash(7), FG]);
    expect(cardImages(added(setBackdrop(two, hash(7)), hash(7)))).toEqual([hash(100), hash(101), hash(7)]);
    expect(cardImages(added(two, hash(100)))).toEqual([hash(100), hash(101)]);
  });

  it('omitCardDefaults：照寫；欄位在但是 undefined 拿掉；沒有要拿掉的回原卡', () => {
    const a = added();
    expect(omitCardDefaults(a)).toBe(a);
    const odd = { ...fresh(), view: { ...fresh().view, foreground: undefined } } as Card;
    expect(own(omitCardDefaults(odd).view, 'foreground')).toBe(false);
  });
});
