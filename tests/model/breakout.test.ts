// T-411 破框層（SCHEMA §1 Layer.breakout?、§1.1 驗證）：驗證規則、updateLayer 開關、欄位可省略（舊卡照讀）、
// false 不寫出（omitLayerDefaults，和 opacity／blend 同一個做法）。
import { describe, expect, it } from 'vitest';
import { layerBreakout, omitLayerDefaults, swapDepth, updateLayer } from '../../src/model/actions';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** 正面：底圖 b、立體層 a(50)、c(70)；背面：立體層 d。 */
function sample(): Card {
  return cardWith(
    [baseLayer({ id: 'b', image: hash(1) }), depthLayer({ id: 'a', depth: 50, image: hash(2) }), depthLayer({ id: 'c', depth: 70, image: hash(3) })],
    [depthLayer({ id: 'd', depth: 50, image: hash(4) })],
  );
}

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]);
}

describe('validateCard：breakout（SCHEMA §1.1）', () => {
  it('舊卡（沒有 breakout 欄位）照樣合格', () => {
    const c = sample();
    for (const l of [...c.front.layers, ...c.back.layers]) expect('breakout' in l).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each([true, false])('立體層 breakout %s 合格（文字圖層也可以）', (v) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[2].breakout = v;
    c.back.layers[0].breakout = v;
    c.back.layers[0].text = { content: '星晶龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each(['true', 1, 0, null, {}, [], undefined])('breakout 不是 boolean（%s）只錯在 breakout', (v) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[1].breakout = v;
    expect(paths(c)).toEqual(['front.layers[1].breakout']);
  });

  it('底圖不能有 breakout（連 false 也不行）', () => {
    for (const v of [true, false]) {
      const c: Raw = structuredClone(sample());
      c.front.layers[0].breakout = v;
      expect(paths(c)).toEqual(['front.layers[0].breakout']);
    }
  });

  it('JSON 來回（存檔、卡片檔的格式）仍合格、欄位不變', () => {
    const c: Raw = structuredClone(sample());
    c.front.layers[2].breakout = true;
    const back = JSON.parse(JSON.stringify(c));
    expect(validateCard(back, anyImage)).toEqual([]);
    expect(back.front.layers[2].breakout).toBe(true);
  });
});

describe('layerBreakout', () => {
  it('省略＝false；只有 true 才算', () => {
    expect(layerBreakout(depthLayer())).toBe(false);
    expect(layerBreakout(depthLayer({ breakout: false }))).toBe(false);
    expect(layerBreakout(depthLayer({ breakout: true }))).toBe(true);
  });
});

describe('updateLayer：breakout 開關', () => {
  it('打開 → 寫 true；關掉 → 欄位拿掉（預設值不寫出），和原本的圖層一模一樣', () => {
    const card = deepFreeze(sample());
    const on = updateLayer(card, 'front', 'c', { breakout: true });
    expect(on.front.layers[2]).toMatchObject({ id: 'c', breakout: true });
    expect(validateCard(on, anyImage)).toEqual([]);
    const off = updateLayer(on, 'front', 'c', { breakout: false });
    expect('breakout' in off.front.layers[2]!).toBe(false);
    expect(off.front.layers[2]).toEqual(card.front.layers[2]);
  });

  it('和現在一樣 → 回原卡（同一個物件）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'c', { breakout: false })).toBe(card);
    const on = deepFreeze(updateLayer(card, 'front', 'c', { breakout: true }));
    expect(updateLayer(on, 'front', 'c', { breakout: true })).toBe(on);
  });

  it('底圖不能破框（回原卡）；不是 boolean → 忽略', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'b', { breakout: true })).toBe(card);
    for (const v of ['true', 1, null] as never[]) expect(updateLayer(card, 'front', 'c', { breakout: v })).toBe(card);
  });

  it('和其他欄位一起改：一次全部套用；不影響 opacity／blend', () => {
    const card = deepFreeze(updateLayer(sample(), 'front', 'a', { opacity: 40, blend: 'screen' }));
    const next = updateLayer(card, 'front', 'a', { breakout: true, x: 0.3 });
    expect(next.front.layers[1]).toMatchObject({ id: 'a', breakout: true, x: 0.3, opacity: 40, blend: 'screen' });
  });

  it('交換深度時 breakout 跟著自己的圖層', () => {
    const card = updateLayer(sample(), 'front', 'a', { breakout: true });
    const swapped = swapDepth(card, 'front', 'a', 'c');
    expect(swapped.front.layers.find((l) => l.id === 'a')).toMatchObject({ breakout: true, depth: 70 });
    expect('breakout' in swapped.front.layers.find((l) => l.id === 'c')!).toBe(false);
  });
});

describe('omitLayerDefaults：明寫的 breakout: false 寫出時省略', () => {
  it('false 拿掉、true 留著；其他欄位不動', () => {
    const r: Raw = structuredClone(sample());
    r.front.layers[1].breakout = false;
    r.front.layers[2].breakout = true;
    r.back.layers[0].breakout = false;
    r.back.layers[0].opacity = 100;
    const input = deepFreeze(r) as Card;
    expect(validateCard(input, anyImage)).toEqual([]);
    const out = omitLayerDefaults(input);
    expect('breakout' in out.front.layers[1]!).toBe(false);
    expect(out.front.layers[1]).toEqual(sample().front.layers[1]);
    expect(out.front.layers[2]).toMatchObject({ id: 'c', breakout: true });
    expect('breakout' in out.back.layers[0]!).toBe(false);
    expect('opacity' in out.back.layers[0]!).toBe(false);
  });

  it('只有 breakout: true → 回原卡（同一個物件）', () => {
    const card = deepFreeze(updateLayer(sample(), 'front', 'c', { breakout: true }));
    expect(omitLayerDefaults(card)).toBe(card);
  });
});
