// 反光層（T-417，SCHEMA §1「反光層」）：Face.foil、holo.matte、拿掉 holo.scope（讀舊卡時轉換）。
import { describe, expect, it } from 'vitest';
import { addLayer, omitCardDefaults, updateCard, updateFoil } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { cardImages, DEFAULT_FOIL, faceFoil, holoMatte, migrateCard } from '../../src/model/foil';
import { DEFAULT_MATTE, MAX_CARD_IMAGES, RANGE } from '../../src/model/limits';
import type { Card, Foil } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash, NOW } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** 舊版（T-417 以前）存的卡：holo 有 scope、兩面都沒有 foil。 */
function legacy(scope: unknown): Raw {
  const c: Raw = structuredClone(cardWith([baseLayer({ id: 'b', image: hash(1) }), depthLayer({ id: 'd', image: hash(2) })]));
  c.holo.scope = scope;
  return c;
}

function sample(): Card {
  return cardWith(
    [baseLayer({ id: 'b', image: hash(1) }), depthLayer({ id: 'd', image: hash(2) })],
    [depthLayer({ id: 'e', image: hash(3) })],
  );
}

describe('預設值', () => {
  it('新卡沒有 scope、沒有 foil、沒有 matte（＝整面反光、卡框也反光、霧光 35）', () => {
    const c = newCard('standard', 'x', NOW);
    expect('scope' in c.holo).toBe(false);
    expect('matte' in c.holo).toBe(false);
    expect('foil' in c.front).toBe(false);
    expect('foil' in c.back).toBe(false);
    expect(faceFoil(c.front)).toEqual({ shape: 'full', frame: true });
    expect(DEFAULT_FOIL).toEqual({ shape: 'full', frame: true });
    expect(holoMatte(c.holo)).toBe(35);
    expect(DEFAULT_MATTE).toBe(35);
    expect(RANGE.holoMatte).toEqual({ min: 0, max: 100 });
    expect(MAX_CARD_IMAGES).toBe(16);
  });
});

describe('舊卡轉換（SCHEMA §1「舊卡轉換」）', () => {
  it("'all' → 兩面整面反光＋卡框也反光（＝預設，所以不寫出 foil）；scope 拿掉", () => {
    const out: Raw = migrateCard(legacy('all'));
    expect('scope' in out.holo).toBe(false);
    expect(faceFoil(out.front)).toEqual({ shape: 'full', frame: true });
    expect(faceFoil(out.back)).toEqual({ shape: 'full', frame: true });
    expect('foil' in out.front).toBe(false);
    expect(validateCard(out, anyImage)).toEqual([]);
  });

  it("'layers' → 兩面用圖層形狀、卡框不反光", () => {
    const out: Raw = migrateCard(legacy('layers'));
    expect('scope' in out.holo).toBe(false);
    expect(out.front.foil).toEqual({ shape: 'layers', frame: false });
    expect(out.back.foil).toEqual({ shape: 'layers', frame: false });
    expect(validateCard(out, anyImage)).toEqual([]);
  });

  it("'frame' → 兩面整面霧光、卡框反光", () => {
    const out: Raw = migrateCard(legacy('frame'));
    expect('scope' in out.holo).toBe(false);
    expect(out.front.foil).toEqual({ shape: 'none', frame: true });
    expect(out.back.foil).toEqual({ shape: 'none', frame: true });
    expect(validateCard(out, anyImage)).toEqual([]);
  });

  it('不改輸入（凍結的物件照樣轉）；其他欄位原樣', () => {
    const input = deepFreeze(legacy('layers'));
    const out: Raw = migrateCard(input);
    expect(out).not.toBe(input);
    expect(input.holo.scope).toBe('layers');
    expect(out.front.layers).toEqual(input.front.layers);
    expect(out.holo.strength).toBe(input.holo.strength);
  });

  it('已經有 foil 的面：不再依 scope 給，只拿掉 scope', () => {
    const c = legacy('frame');
    c.front.foil = { shape: 'layers', frame: true };
    const out: Raw = migrateCard(c);
    expect('scope' in out.holo).toBe(false);
    expect(out.front.foil).toEqual({ shape: 'layers', frame: true });
    expect('foil' in out.back).toBe(false);
  });

  it('沒有 scope 的新卡：原樣回傳（同一個物件）', () => {
    const c = sample();
    expect(migrateCard(c)).toBe(c);
  });

  it('不認得的 scope 不轉：留給驗證報錯', () => {
    const out = migrateCard(legacy('none'));
    expect(validateCard(out, anyImage).some((e) => e.startsWith('holo.scope'))).toBe(true);
  });

  it('壞資料不丟例外', () => {
    for (const v of [null, 1, 'x', [], { holo: null }, { holo: { scope: 'all' }, front: 5, back: null }]) {
      expect(() => migrateCard(v)).not.toThrow();
    }
  });

  it('轉換後的舊卡不能再有 scope：寫回 scope 就驗不過', () => {
    const c: Raw = structuredClone(sample());
    c.holo.scope = 'all';
    expect(validateCard(c, anyImage).some((e) => e.startsWith('holo.scope'))).toBe(true);
  });
});

describe('驗證（SCHEMA §1「反光層」）', () => {
  const ok = (foil: unknown, card: Raw = structuredClone(sample())) => {
    card.front.foil = foil;
    return validateCard(card, anyImage);
  };

  it('四種形狀、卡框 true／false、mask 形狀有圖：都合格', () => {
    expect(ok({ shape: 'full', frame: true })).toEqual([]);
    expect(ok({ shape: 'layers', frame: false })).toEqual([]);
    expect(ok({ shape: 'none', frame: true })).toEqual([]);
    expect(ok({ shape: 'mask', mask: hash(9), frame: false })).toEqual([]);
    // 其他形狀可以保留 mask（切回 mask 還在）
    expect(ok({ shape: 'full', mask: hash(9), frame: true })).toEqual([]);
  });

  it('壞形狀、卡框不是布林、不認得的欄位、不是物件 → 報在 foil 上', () => {
    const paths = (foil: unknown) => ok(foil).map((e) => e.split('：')[0]);
    expect(paths({ shape: 'half', frame: true })).toEqual(['front.foil.shape']);
    expect(paths({ shape: 'toString', frame: true })).toEqual(['front.foil.shape']);
    expect(paths({ shape: 'full', frame: 'yes' })).toEqual(['front.foil.frame']);
    expect(paths({ shape: 'full' })).toEqual(['front.foil.frame']);
    expect(paths({ frame: true })).toEqual(['front.foil.shape']);
    expect(paths({ shape: 'full', frame: true, glow: 1 })).toEqual(['front.foil.glow']);
    expect(paths(null)).toEqual(['front.foil']);
    expect(paths([])).toEqual(['front.foil']);
  });

  it('mask 形狀沒有圖、雜湊格式不對、找不到圖 → 拒絕', () => {
    expect(ok({ shape: 'mask', frame: true }).map((e) => e.split('：')[0])).toEqual(['front.foil.mask']);
    expect(ok({ shape: 'mask', mask: 'ABC', frame: true }).map((e) => e.split('：')[0])).toEqual(['front.foil.mask']);
    const card: Raw = structuredClone(sample());
    card.back.foil = { shape: 'mask', mask: hash(9), frame: true };
    const errors = validateCard(card, (h) => h !== hash(9));
    expect(errors.map((e) => e.split('：')[0])).toEqual(['back.foil.mask']);
    // hasImage 丟例外也只是「找不到」
    expect(validateCard(card, (h) => {
      if (h === hash(9)) throw new Error('boom');
      return true;
    }).map((e) => e.split('：')[0])).toEqual(['back.foil.mask']);
  });

  it('matte：0～100 的有限數字；超出、NaN、字串都拒絕', () => {
    const withMatte = (matte: unknown) => {
      const c: Raw = structuredClone(sample());
      c.holo.matte = matte;
      return validateCard(c, anyImage).map((e) => e.split('：')[0]);
    };
    expect(withMatte(0)).toEqual([]);
    expect(withMatte(100)).toEqual([]);
    expect(withMatte(35)).toEqual([]);
    expect(withMatte(-1)).toEqual(['holo.matte']);
    expect(withMatte(101)).toEqual(['holo.matte']);
    expect(withMatte(Number.NaN)).toEqual(['holo.matte']);
    expect(withMatte('35')).toEqual(['holo.matte']);
    expect(withMatte(null)).toEqual(['holo.matte']);
  });

  it('mask 也算在每張卡最多 16 張圖裡：16 張合格、17 張拒絕', () => {
    const layers = (start: number) => [
      baseLayer({ id: `b${start}`, image: hash(start) }),
      ...Array.from({ length: 7 }, (_, i) => depthLayer({ id: `d${start + i}`, depth: 10 + i * 10, image: hash(start + 1 + i) })),
    ];
    const c: Raw = structuredClone(cardWith(layers(1), layers(9))); // 16 張不同的圖
    expect(validateCard(c, anyImage)).toEqual([]);
    c.front.foil = { shape: 'mask', mask: hash(1), frame: true }; // 和底圖同一張：還是 16 張
    expect(validateCard(c, anyImage)).toEqual([]);
    c.back.foil = { shape: 'full', mask: hash(99), frame: true }; // 第 17 張（就算形狀不是 mask 也算）
    const errors = validateCard(c, anyImage);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^卡片：.*16/);
  });
});

describe('cardImages：卡片用到的圖（含反光層的黑白圖）', () => {
  it('先正面（圖層、黑白圖）後背面，不重複', () => {
    const c = sample();
    const withMasks: Card = {
      ...c,
      front: { ...c.front, foil: { shape: 'mask', mask: hash(7), frame: true } },
      back: { ...c.back, foil: { shape: 'full', mask: hash(2), frame: true } },
    };
    expect(cardImages(c)).toEqual([hash(1), hash(2), hash(3)]);
    expect(cardImages(withMasks)).toEqual([hash(1), hash(2), hash(7), hash(3)]);
  });
});

describe('updateFoil：改反光層（每個改動都是新卡、不改輸入）', () => {
  const card = () => deepFreeze(sample());
  const foilOf = (c: Card, face: 'front' | 'back' = 'front'): Foil => faceFoil(c[face]);

  it('改形狀、卡框也反光', () => {
    const c = card();
    const layers = updateFoil(c, 'front', { shape: 'layers' });
    expect(layers.front.foil).toEqual({ shape: 'layers', frame: true });
    expect(layers.back).toBe(c.back);
    const noFrame = updateFoil(layers, 'front', { frame: false });
    expect(noFrame.front.foil).toEqual({ shape: 'layers', frame: false });
    const none = updateFoil(noFrame, 'front', { shape: 'none' });
    expect(foilOf(none)).toEqual({ shape: 'none', frame: false });
  });

  it('改回預設（整面＋卡框也反光、沒有黑白圖）→ 拿掉 foil 欄位', () => {
    const c = updateFoil(card(), 'back', { shape: 'none' });
    expect(c.back.foil).toEqual({ shape: 'none', frame: true });
    const back = updateFoil(c, 'back', { shape: 'full' });
    expect('foil' in back.back).toBe(false);
  });

  it('沒有黑白圖不能選「上傳黑白圖」；給了圖就換上並切過去；換別的形狀時圖留著、切回來還在', () => {
    const c = card();
    expect(updateFoil(c, 'front', { shape: 'mask' })).toBe(c);
    const masked = updateFoil(c, 'front', { shape: 'mask', mask: hash(8) });
    expect(masked.front.foil).toEqual({ shape: 'mask', mask: hash(8), frame: true });
    const full = updateFoil(masked, 'front', { shape: 'full' });
    expect(full.front.foil).toEqual({ shape: 'full', mask: hash(8), frame: true });
    expect(updateFoil(full, 'front', { shape: 'mask' }).front.foil).toEqual({ shape: 'mask', mask: hash(8), frame: true });
    // 換圖
    expect(updateFoil(masked, 'front', { mask: hash(9) }).front.foil).toEqual({ shape: 'mask', mask: hash(9), frame: true });
  });

  it('不合格的值不改；沒變回原卡', () => {
    const c = card();
    expect(updateFoil(c, 'front', {})).toBe(c);
    expect(updateFoil(c, 'front', { shape: 'half' as never })).toBe(c);
    expect(updateFoil(c, 'front', { frame: 'no' as never })).toBe(c);
    expect(updateFoil(c, 'front', { shape: 'mask', mask: 'BAD' })).toBe(c);
    expect(updateFoil(c, 'front', { shape: 'full', frame: true })).toBe(c);
  });

  it('黑白圖會超過 16 張圖 → 不改', () => {
    const layers = (start: number) => [
      baseLayer({ id: `b${start}`, image: hash(start) }),
      ...Array.from({ length: 7 }, (_, i) => depthLayer({ id: `d${start + i}`, depth: 10 + i * 10, image: hash(start + 1 + i) })),
    ];
    const full = cardWith(layers(1), layers(9));
    expect(updateFoil(full, 'front', { shape: 'mask', mask: hash(99) })).toBe(full);
    // 用卡上已經有的圖當黑白圖：不會多一張
    expect(updateFoil(full, 'front', { shape: 'mask', mask: hash(3) }).front.foil).toEqual({ shape: 'mask', mask: hash(3), frame: true });
  });

  it('結果都通過驗證', () => {
    let c: Card = card();
    c = updateFoil(c, 'front', { shape: 'mask', mask: hash(8), frame: false });
    c = updateFoil(c, 'back', { shape: 'layers' });
    expect(validateCard(c, anyImage)).toEqual([]);
  });
});

describe('有黑白圖時加圖層也不能超過 16 張圖', () => {
  it('addLayer 回 too-many-images', () => {
    const layers = (start: number, n: number) => [
      baseLayer({ id: `b${start}`, image: hash(start) }),
      ...Array.from({ length: n - 1 }, (_, i) => depthLayer({ id: `d${start + i}`, depth: 10 + i * 10, image: hash(start + 1 + i) })),
    ];
    let c = cardWith(layers(1, 8), layers(9, 7)); // 15 張
    c = updateFoil(c, 'front', { shape: 'mask', mask: hash(50) }); // 16 張
    const input = { id: 'new', name: 'new', image: hash(60), hasAlpha: true, width: 100, height: 100 };
    expect(addLayer(c, 'back', input)).toEqual({ ok: false, reason: 'too-many-images' });
    // 用已經有的圖照樣能加
    expect(addLayer(c, 'back', { ...input, image: hash(2) }).ok).toBe(true);
  });
});

describe('霧光 holo.matte', () => {
  it('夾在 0～100；等於 35 時拿掉欄位；NaN 不改', () => {
    const c = deepFreeze(newCard('standard', 'x', NOW));
    const a = updateCard(c, { holo: { matte: 70 } });
    expect(a.holo.matte).toBe(70);
    expect(updateCard(a, { holo: { matte: 200 } }).holo.matte).toBe(100);
    expect(updateCard(a, { holo: { matte: -5 } }).holo.matte).toBe(0);
    const back = updateCard(a, { holo: { matte: 35 } });
    expect('matte' in back.holo).toBe(false);
    expect(updateCard(c, { holo: { matte: Number.NaN } })).toBe(c);
    expect(updateCard(c, { holo: { matte: 35 } })).toBe(c);
  });
});

describe('寫出時省略預設值（omitCardDefaults）', () => {
  it('明寫的 { full, frame: true } 與 matte 35 拿掉；其他照留；沒有要拿掉的回原卡', () => {
    const c = sample();
    expect(omitCardDefaults(c)).toBe(c);
    const explicit: Card = {
      ...c,
      holo: { ...c.holo, matte: DEFAULT_MATTE },
      front: { ...c.front, foil: { shape: 'full', frame: true } },
      back: { ...c.back, foil: { shape: 'layers', frame: true } },
    };
    const out = omitCardDefaults(deepFreeze(explicit));
    expect('matte' in out.holo).toBe(false);
    expect('foil' in out.front).toBe(false);
    expect(out.back.foil).toEqual({ shape: 'layers', frame: true });
    // 保留著黑白圖的整面不是預設
    const kept: Card = { ...c, front: { ...c.front, foil: { shape: 'full', mask: hash(5), frame: true } } };
    expect(omitCardDefaults(kept)).toBe(kept);
    // 圖層的預設值照舊也拿掉
    const layerDefault: Card = { ...c, front: { layers: [c.front.layers[0]!, { ...c.front.layers[1]!, opacity: 100 }] } };
    expect('opacity' in omitCardDefaults(layerDefault).front.layers[1]!).toBe(false);
  });
});
