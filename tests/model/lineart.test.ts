// T-802 線稿高光（SCHEMA §1 Layer.lineart?、§1.1 驗證）：驗證規則、updateLayer 開關、欄位可省略（舊卡照讀）、
// false 不寫出（omitLayerDefaults，和 breakout 同一個做法）；底圖與文字層不能有。
import { describe, expect, it } from 'vitest';
import { layerLineart, omitCardDefaults, omitLayerDefaults, replaceLayerImage, swapDepth, updateLayer } from '../../src/model/actions';
import type { Card, TextSpec } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const TEXT: TextSpec = { content: '星晶龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };

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

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]);
}

describe('validateCard：lineart（SCHEMA §1.1）', () => {
  it('舊卡（沒有 lineart 欄位）照樣合格', () => {
    const c = sample();
    for (const l of [...c.front.layers, ...c.back.layers]) expect('lineart' in l).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each([true, false])('立體層 lineart %s 合格（沒有透明的加深層、破框層也可以）', (v) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[1].lineart = v;
    c.front.layers[2].lineart = v;
    c.back.layers[0].lineart = v;
    c.back.layers[0].breakout = true;
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each(['true', 1, 0, null, {}, [], undefined])('lineart 不是 boolean（%s）只錯在 lineart', (v) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[1].lineart = v;
    expect(paths(c)).toEqual(['front.layers[1].lineart']);
  });

  it('底圖不能有 lineart（連 false 也不行）', () => {
    for (const v of [true, false]) {
      const c: Raw = structuredClone(sample());
      c.front.layers[0].lineart = v;
      expect(paths(c)).toEqual(['front.layers[0].lineart']);
    }
  });

  it('文字層不能有 lineart（連 false 也不行）', () => {
    for (const v of [true, false]) {
      const c: Raw = structuredClone(sample());
      c.front.layers[3].lineart = v;
      expect(paths(c)).toEqual(['front.layers[3].lineart']);
    }
  });

  it('JSON 來回（存檔、卡片檔的格式）仍合格、欄位不變', () => {
    const c: Raw = structuredClone(sample());
    c.front.layers[2].lineart = true;
    const back = JSON.parse(JSON.stringify(c));
    expect(validateCard(back, anyImage)).toEqual([]);
    expect(back.front.layers[2].lineart).toBe(true);
  });
});

describe('layerLineart', () => {
  it('省略＝false；只有 true 才算', () => {
    expect(layerLineart(depthLayer())).toBe(false);
    expect(layerLineart(depthLayer({ lineart: false }))).toBe(false);
    expect(layerLineart(depthLayer({ lineart: true }))).toBe(true);
  });
});

describe('updateLayer：lineart 開關', () => {
  it('打開 → 寫 true；關掉 → 欄位拿掉（預設值不寫出），和原本的圖層一模一樣', () => {
    const card = deepFreeze(sample());
    const on = updateLayer(card, 'front', 'ink', { lineart: true });
    expect(on.front.layers[2]).toMatchObject({ id: 'ink', lineart: true });
    expect(validateCard(on, anyImage)).toEqual([]);
    const off = updateLayer(on, 'front', 'ink', { lineart: false });
    expect('lineart' in off.front.layers[2]!).toBe(false);
    expect(off.front.layers[2]).toEqual(card.front.layers[2]);
  });

  it('和現在一樣 → 回原卡（同一個物件）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'ink', { lineart: false })).toBe(card);
    const on = deepFreeze(updateLayer(card, 'front', 'ink', { lineart: true }));
    expect(updateLayer(on, 'front', 'ink', { lineart: true })).toBe(on);
  });

  it('底圖、文字層不能開（回原卡）；不是 boolean → 忽略', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'b', { lineart: true })).toBe(card);
    expect(updateLayer(card, 'front', 't', { lineart: true })).toBe(card);
    for (const v of ['true', 1, null] as never[]) expect(updateLayer(card, 'front', 'a', { lineart: v })).toBe(card);
  });

  it('破框層也能開（存著；畫的時候破框層不發光）', () => {
    const card = deepFreeze(updateLayer(sample(), 'front', 'a', { breakout: true }));
    expect(updateLayer(card, 'front', 'a', { lineart: true }).front.layers[1]).toMatchObject({ breakout: true, lineart: true });
  });

  it('和其他欄位一起改：一次全部套用；不影響 opacity／blend／breakout', () => {
    const card = deepFreeze(updateLayer(sample(), 'front', 'a', { opacity: 40, blend: 'multiply', breakout: true }));
    const next = updateLayer(card, 'front', 'a', { lineart: true, x: 0.3 });
    expect(next.front.layers[1]).toMatchObject({ id: 'a', lineart: true, x: 0.3, opacity: 40, blend: 'multiply', breakout: true });
  });

  it('交換深度、換圖（自動去背）時 lineart 跟著自己的圖層', () => {
    const card = updateLayer(sample(), 'front', 'a', { lineart: true });
    const swapped = swapDepth(card, 'front', 'a', 'ink');
    expect(swapped.front.layers.find((l) => l.id === 'a')).toMatchObject({ lineart: true, depth: 60 });
    expect('lineart' in swapped.front.layers.find((l) => l.id === 'ink')!).toBe(false);
    const replaced = replaceLayerImage(card, 'front', 'a', { image: hash(9), hasAlpha: true });
    expect(replaced.front.layers[1]).toMatchObject({ id: 'a', image: hash(9), lineart: true });
  });
});

describe('omitLayerDefaults：明寫的 lineart: false 寫出時省略', () => {
  it('false 拿掉、true 留著；其他欄位不動', () => {
    const r: Raw = structuredClone(sample());
    r.front.layers[1].lineart = false;
    r.front.layers[2].lineart = true;
    r.back.layers[0].lineart = false;
    r.back.layers[0].breakout = false;
    const input = deepFreeze(r) as Card;
    expect(validateCard(input, anyImage)).toEqual([]);
    const out = omitLayerDefaults(input);
    expect('lineart' in out.front.layers[1]!).toBe(false);
    expect(out.front.layers[1]).toEqual(sample().front.layers[1]);
    expect(out.front.layers[2]).toMatchObject({ id: 'ink', lineart: true, blend: 'multiply' });
    expect('lineart' in out.back.layers[0]!).toBe(false);
    expect('breakout' in out.back.layers[0]!).toBe(false);
    expect(omitCardDefaults(input).front.layers[1]).toEqual(sample().front.layers[1]);
  });

  it('只有 lineart: true → 回原卡（同一個物件）', () => {
    const card = deepFreeze(updateLayer(sample(), 'front', 'ink', { lineart: true }));
    expect(omitLayerDefaults(card)).toBe(card);
  });
});
