// T-805 雙圖光柵的變身圖（SCHEMA §1 Layer.alt?、§1.1 驗證）：驗證規則、cardImages 算進去（換卡 retain、卡片檔打包、
// 複製、圖片回收都靠它）、updateLayer 加／換／拿掉、混合模式兩張一起看、16 張圖上限、破框層不能有；
// 其他動作（交換深度、換圖、一鍵風格、刪層、寫出前整理）不會弄壞或弄丟它。
import { describe, expect, it } from 'vitest';
import {
  altBlocked,
  blendAllowed,
  layerAlt,
  omitCardDefaults,
  omitLayerDefaults,
  removeLayer,
  replaceLayerImage,
  swapDepth,
  updateLayer,
} from '../../src/model/actions';
import { cardImages } from '../../src/model/foil';
import { MAX_CARD_IMAGES } from '../../src/model/limits';
import { applyCardStyle } from '../../src/model/styles';
import type { Card, Layer, TextSpec } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const TEXT: TextSpec = { content: '星晶龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
const ALT = { image: hash(20), hasAlpha: true } as const;
const OPAQUE_ALT = { image: hash(21), hasAlpha: false } as const;

/** 正面：底圖 b、立體層 a(50)、沒有透明的加深層 ink(60)、文字層 t(70)；背面：立體層 d。 */
function sample(): Card {
  return cardWith(
    [
      baseLayer({ id: 'b', image: hash(1) }),
      depthLayer({ id: 'a', depth: 50, image: hash(2) }),
      depthLayer({ id: 'ink', depth: 60, image: hash(3), hasAlpha: false, blend: 'multiply' }),
      depthLayer({ id: 't', depth: 70, image: hash(5), text: TEXT }),
    ],
    [depthLayer({ id: 'd', depth: 50, image: hash(4) })],
  );
}

function withAltOn(id: string, alt: Layer['alt'] = ALT): Card {
  const c = sample();
  return { ...c, front: { layers: c.front.layers.map((l) => (l.id === id ? { ...l, alt } : l)) } };
}

function paths(value: unknown, has: (h: string) => boolean = anyImage): string[] {
  return validateCard(value, has).map((e) => e.split('：')[0]!);
}

const find = (c: Card, id: string): Layer => [...c.front.layers, ...c.back.layers].find((l) => l.id === id)!;

describe('validateCard：alt（SCHEMA §1.1）', () => {
  it('舊卡（沒有 alt）照樣合格', () => {
    const c = sample();
    for (const l of [...c.front.layers, ...c.back.layers]) expect('alt' in l).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('立體層有透明的變身圖合格；沒有透明的變身圖放在加深層合格', () => {
    expect(validateCard(withAltOn('a'), anyImage)).toEqual([]);
    expect(validateCard(withAltOn('ink', OPAQUE_ALT), anyImage)).toEqual([]);
    expect(validateCard(withAltOn('ink', ALT), anyImage)).toEqual([]);
  });

  it.each([
    ['不是物件', 'x', 'front.layers[1].alt'],
    ['null', null, 'front.layers[1].alt'],
    ['陣列', [], 'front.layers[1].alt'],
    ['雜湊格式不對', { image: 'ABC', hasAlpha: true }, 'front.layers[1].alt.image'],
    ['hasAlpha 不是 boolean', { image: hash(20), hasAlpha: 1 }, 'front.layers[1].alt.hasAlpha'],
    ['少 hasAlpha', { image: hash(20) }, 'front.layers[1].alt.hasAlpha'],
    ['多一個欄位', { image: hash(20), hasAlpha: true, x: 1 }, 'front.layers[1].alt.x'],
  ])('%s → 只錯在 alt', (_label, alt, path) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[1].alt = alt;
    expect(paths(c)).toEqual([path]);
  });

  it('變身圖要在卡片裡（找不到 → alt.image）', () => {
    const c = withAltOn('a');
    expect(paths(c, (h) => h !== ALT.image)).toEqual(['front.layers[1].alt.image']);
  });

  it('底圖、文字層、破框層不能有（連空的、不合格的也不行）', () => {
    for (const alt of [ALT, {}]) {
      const base: Raw = structuredClone(sample());
      base.front.layers[0].alt = alt;
      expect(paths(base)).toContain('front.layers[0].alt');
      const text: Raw = structuredClone(sample());
      text.front.layers[3].alt = alt;
      expect(paths(text)).toContain('front.layers[3].alt');
      const breakout: Raw = structuredClone(sample());
      breakout.front.layers[1].breakout = true;
      breakout.front.layers[1].alt = alt;
      expect(paths(breakout)).toContain('front.layers[1].alt');
    }
    const ok: Raw = structuredClone(withAltOn('a'));
    ok.front.layers[1].breakout = false;
    expect(validateCard(ok, anyImage)).toEqual([]);
  });

  it('沒有透明的變身圖：這層的混合模式要是加深／發光／強光（同本來的圖）', () => {
    expect(paths(withAltOn('a', OPAQUE_ALT))).toEqual(['front.layers[1].alt.hasAlpha']);
    const screen: Raw = structuredClone(withAltOn('a', OPAQUE_ALT));
    screen.front.layers[1].blend = 'screen';
    expect(validateCard(screen, anyImage)).toEqual([]);
  });

  it('變身圖算進每張卡最多 16 張圖', () => {
    const layers = Array.from({ length: 8 }, (_, i) => depthLayer({ id: `f${i}`, depth: 10 + i, image: hash(100 + i), alt: { image: hash(200 + i), hasAlpha: true } }));
    const ok = cardWith(layers);
    expect(cardImages(ok)).toHaveLength(16);
    expect(validateCard(ok, anyImage)).toEqual([]);
    const over = cardWith(layers, [depthLayer({ id: 'x', image: hash(300) })]);
    expect(validateCard(over, anyImage).some((e) => e.startsWith('卡片：圖片最多 16 張'))).toBe(true);
  });

  it('JSON 來回（存檔、卡片檔的格式）仍合格、欄位不變', () => {
    const back = JSON.parse(JSON.stringify(withAltOn('ink', OPAQUE_ALT)));
    expect(validateCard(back, anyImage)).toEqual([]);
    expect(back.front.layers[2].alt).toEqual(OPAQUE_ALT);
  });
});

describe('cardImages：變身圖也算「有在用」', () => {
  it('接在它那一層的圖後面；同一張圖只算一次', () => {
    expect(cardImages(withAltOn('a'))).toEqual([hash(1), hash(2), ALT.image, hash(3), hash(5), hash(4)]);
    expect(cardImages(withAltOn('a', { image: hash(3), hasAlpha: true }))).toEqual([hash(1), hash(2), hash(3), hash(5), hash(4)]);
  });

  it('刪掉那一層 → 變身圖不再算', () => {
    expect(cardImages(removeLayer(withAltOn('a'), 'front', 'a'))).not.toContain(ALT.image);
  });
});

describe('blendAllowed：兩張圖一起看', () => {
  it('變身圖沒有透明 → 只能用加深／發光／強光', () => {
    const l = { role: 'depth', hasAlpha: true, alt: OPAQUE_ALT } as const;
    expect(blendAllowed(l, 'normal')).toBe(false);
    expect(blendAllowed(l, 'overlay')).toBe(false);
    expect(blendAllowed(l, 'multiply')).toBe(true);
    expect(blendAllowed({ ...l, alt: ALT }, 'normal')).toBe(true);
  });
});

describe('layerAlt／altBlocked', () => {
  it('省略＝null；立體層可以加，底圖、文字層、破框層不行', () => {
    expect(layerAlt(depthLayer())).toBeNull();
    expect(layerAlt(depthLayer({ alt: ALT }))).toEqual(ALT);
    const c = sample();
    expect(altBlocked(find(c, 'a'))).toBeNull();
    expect(altBlocked(find(c, 'ink'))).toBeNull();
    expect(altBlocked(find(c, 'b'))).toBe('base');
    expect(altBlocked(find(c, 't'))).toBe('text');
    expect(altBlocked({ ...find(c, 'a'), breakout: true })).toBe('breakout');
  });
});

describe('updateLayer：加、換、拿掉變身圖', () => {
  it('加上 → { image, hasAlpha }（不多存別的欄位）、合格；拿掉（null）→ 和原本一模一樣', () => {
    const card = deepFreeze(sample());
    const on = updateLayer(card, 'front', 'a', { alt: { ...ALT, extra: 1 } as never });
    expect(find(on, 'a').alt).toEqual(ALT);
    expect(validateCard(on, anyImage)).toEqual([]);
    const off = updateLayer(on, 'front', 'a', { alt: null });
    expect('alt' in find(off, 'a')).toBe(false);
    expect(off.front.layers[1]).toEqual(card.front.layers[1]);
  });

  it('換一張 → 換掉；和現在一樣 → 回原卡（同一個物件）；沒有變身圖時拿掉 → 回原卡', () => {
    const on = deepFreeze(updateLayer(sample(), 'front', 'a', { alt: ALT }));
    expect(updateLayer(on, 'front', 'a', { alt: { ...ALT } })).toBe(on);
    expect(find(updateLayer(on, 'front', 'a', { alt: { image: hash(22), hasAlpha: true } }), 'a').alt).toEqual({ image: hash(22), hasAlpha: true });
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'a', { alt: null })).toBe(card);
  });

  it('底圖、文字層、破框層不能加（回原卡）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'b', { alt: ALT })).toBe(card);
    expect(updateLayer(card, 'front', 't', { alt: ALT })).toBe(card);
    const breakout = deepFreeze(updateLayer(sample(), 'front', 'a', { breakout: true }));
    expect(updateLayer(breakout, 'front', 'a', { alt: ALT })).toBe(breakout);
  });

  it.each([
    ['雜湊格式不對', { image: 'nothex', hasAlpha: true }],
    ['hasAlpha 不是 boolean', { image: hash(20), hasAlpha: 'yes' }],
    ['不是物件', 'x'],
    ['陣列', []],
  ])('不合格的值（%s）→ 忽略', (_label, alt) => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'a', { alt: alt as never })).toBe(card);
  });

  it('沒有透明的變身圖：正常模式的層不能加；加深層可以', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'a', { alt: OPAQUE_ALT })).toBe(card);
    expect(find(updateLayer(card, 'front', 'ink', { alt: OPAQUE_ALT }), 'ink').alt).toEqual(OPAQUE_ALT);
  });

  it('換混合模式也看變身圖：變身圖沒有透明時不能換成正常、可以換成發光', () => {
    const card = deepFreeze(updateLayer(sample(), 'front', 'ink', { alt: OPAQUE_ALT }));
    // ink 本來的圖也沒有透明，先換一個有透明的本來的圖，才看得出是變身圖在擋
    const transparentA = deepFreeze(replaceLayerImage(card, 'front', 'ink', { image: hash(9), hasAlpha: true }));
    expect(find(transparentA, 'ink').hasAlpha).toBe(true);
    expect(updateLayer(transparentA, 'front', 'ink', { blend: 'normal' })).toBe(transparentA);
    expect(find(updateLayer(transparentA, 'front', 'ink', { blend: 'screen' }), 'ink').blend).toBe('screen');
  });

  it('擋下變身圖時，同一次的其他欄位照樣改', () => {
    const next = updateLayer(sample(), 'front', 'a', { x: 0.3, alt: OPAQUE_ALT });
    expect(find(next, 'a').x).toBe(0.3);
    expect('alt' in find(next, 'a')).toBe(false);
  });

  it('有變身圖的層不能打開衝出卡片（SCHEMA：破框層不能有變身圖）；拿掉變身圖之後可以', () => {
    const on = deepFreeze(updateLayer(sample(), 'front', 'a', { alt: ALT }));
    expect(updateLayer(on, 'front', 'a', { breakout: true })).toBe(on);
    const both = updateLayer(on, 'front', 'a', { alt: null, breakout: true });
    expect(find(both, 'a')).toMatchObject({ breakout: true });
    expect('alt' in find(both, 'a')).toBe(false);
    expect(validateCard(both, anyImage)).toEqual([]);
  });

  it('會超過每張卡 16 張圖 → 不加；用已經在卡上的圖 → 可以', () => {
    const layers = Array.from({ length: 8 }, (_, i) => depthLayer({ id: `f${i}`, depth: 10 + i, image: hash(100 + i) }));
    const back = Array.from({ length: 8 }, (_, i) => depthLayer({ id: `k${i}`, depth: 10 + i, image: hash(200 + i) }));
    const full = deepFreeze(cardWith(layers, back));
    expect(cardImages(full)).toHaveLength(MAX_CARD_IMAGES);
    expect(updateLayer(full, 'front', 'f0', { alt: { image: hash(999), hasAlpha: true } })).toBe(full);
    expect(find(updateLayer(full, 'front', 'f0', { alt: { image: hash(201), hasAlpha: true } }), 'f0').alt).toEqual({ image: hash(201), hasAlpha: true });
  });
});

describe('其他動作不會弄壞變身圖', () => {
  it('交換深度：變身圖跟著自己的圖層', () => {
    const swapped = swapDepth(withAltOn('a'), 'front', 'a', 'ink');
    expect(find(swapped, 'a')).toMatchObject({ depth: 60, alt: ALT });
    expect('alt' in find(swapped, 'ink')).toBe(false);
  });

  it('換圖（自動去背，T-703b）只換本來的圖，變身圖留著', () => {
    const replaced = replaceLayerImage(withAltOn('ink', OPAQUE_ALT), 'front', 'ink', { image: hash(9), hasAlpha: true });
    expect(find(replaced, 'ink')).toMatchObject({ image: hash(9), hasAlpha: true, alt: OPAQUE_ALT });
  });

  it('換圖時混合模式也看變身圖：正常模式的層、變身圖有透明 → 本來的圖可以換成有透明的', () => {
    const c = withAltOn('a');
    expect(find(replaceLayerImage(c, 'front', 'a', { image: hash(9), hasAlpha: true }), 'a')).toMatchObject({ image: hash(9), alt: ALT });
    // 本來的圖換成沒有透明 → 正常模式不准（同 T-703b）
    expect(replaceLayerImage(c, 'front', 'a', { image: hash(9), hasAlpha: false })).toBe(c);
  });

  it('一鍵風格不動圖層：變身圖留著', () => {
    const styled = applyCardStyle(withAltOn('a'), 'gold');
    expect(find(styled, 'a').alt).toEqual(ALT);
  });

  it('寫出前整理：變身圖留著（不是預設值）；只有變身圖 → 回原卡', () => {
    const card = deepFreeze(withAltOn('a'));
    expect(omitLayerDefaults(card)).toBe(card);
    expect(find(omitCardDefaults(card), 'a').alt).toEqual(ALT);
    const r: Raw = structuredClone(withAltOn('a'));
    r.front.layers[1].lineart = false;
    expect(find(omitLayerDefaults(r), 'a')).toMatchObject({ alt: ALT });
    expect('lineart' in find(omitLayerDefaults(r), 'a')).toBe(false);
  });

  it('寫出前整理：記憶體裡的 alt: undefined（不該出現，存進資料庫會被擋）拿掉', () => {
    const r: Raw = sample();
    r.front.layers[1] = { ...r.front.layers[1], alt: undefined };
    const out = omitLayerDefaults(r);
    expect('alt' in find(out, 'a')).toBe(false);
    expect(find(out, 'a')).toEqual(sample().front.layers[1]);
  });
});
