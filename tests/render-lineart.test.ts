// T-802 線稿高光的純數學（render/lineart.ts；shader 在 holo-nodes.ts 的 lineWeightNode／lineGlowNode，同算式）：
// 哪些層會發光、線條強度＝(1−亮度)×alpha、混入比例（淺色不亮、越黑越亮）、線條的光、混進合成好的顏色。
import { describe, expect, it } from 'vitest';
import type { Layer } from '../src/model/types';
import { LINEART_LOOK, lineartMix, lineartOn, lineFoil, lineGlow, lineStrength, lineWeight } from '../src/render/lineart';

const layer = (over: Partial<Layer>): Layer => ({
  id: 'x', name: 'x', role: 'depth', image: '0123456789abcdef', visible: true, depth: 50, x: 0, y: 0, scale: 1, holo: true, hasAlpha: true, ...over,
});

describe('lineartOn：哪些層畫的時候沿線條發光', () => {
  it('立體層明寫 true 才算；省略、false 不算', () => {
    expect(lineartOn(layer({ lineart: true }))).toBe(true);
    expect(lineartOn(layer({ lineart: false }))).toBe(false);
    expect(lineartOn(layer({}))).toBe(false);
  });

  it('底圖、文字層（就算資料帶了 true）、破框層不發光', () => {
    expect(lineartOn(layer({ role: 'base', depth: 0, lineart: true }))).toBe(false);
    const text = { content: 'a', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
    expect(lineartOn(layer({ text, lineart: true }))).toBe(false);
    expect(lineartOn(layer({ breakout: true, lineart: true }))).toBe(false);
    expect(lineartOn(layer({ breakout: false, lineart: true }))).toBe(true);
  });
});

describe('lineStrength：線條強度＝(1−亮度)×alpha（SCHEMA §1）', () => {
  it('黑＝1、白＝0、50% 灰＝0.5；亮度用 Lum 權重（純紅 0.3 → 0.7）', () => {
    expect(lineStrength({ r: 0, g: 0, b: 0 }, 1)).toBe(1);
    expect(lineStrength({ r: 1, g: 1, b: 1 }, 1)).toBeCloseTo(0, 12);
    expect(lineStrength({ r: 0.5, g: 0.5, b: 0.5 }, 1)).toBeCloseTo(0.5, 12);
    expect(lineStrength({ r: 1, g: 0, b: 0 }, 1)).toBeCloseTo(0.7, 12);
  });

  it('乘 alpha：透明的地方 0、半透明一半', () => {
    expect(lineStrength({ r: 0, g: 0, b: 0 }, 0)).toBe(0);
    expect(lineStrength({ r: 0, g: 0, b: 0 }, 0.5)).toBe(0.5);
  });

  it('超出 0～1 的輸入夾回（不會變負的、不會超過 1）', () => {
    expect(lineStrength({ r: 1.4, g: 1.2, b: 1.1 }, 1)).toBeCloseTo(0, 12);
    expect(lineStrength({ r: -0.2, g: 0, b: 0 }, 2)).toBe(1);
  });
});

describe('lineWeight：混入比例（淺色不亮、越黑越亮）', () => {
  it('0 → 0、1 → 1；淺色（強度 ≤ from）完全不亮', () => {
    expect(lineWeight(0)).toBe(0);
    expect(lineWeight(1)).toBe(1);
    expect(lineWeight(LINEART_LOOK.from)).toBe(0);
    // 淺灰（亮度 0.85）、米白紙（0.92）都不亮
    expect(lineWeight(lineStrength({ r: 0.85, g: 0.85, b: 0.85 }, 1))).toBe(0);
    expect(lineWeight(lineStrength({ r: 0.92, g: 0.9, b: 0.86 }, 1))).toBe(0);
  });

  it('越黑越亮（單調遞增），to 以上全亮', () => {
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const w = lineWeight(s);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(lineWeight(LINEART_LOOK.to)).toBe(1);
  });
});

describe('lineGlow／lineartMix：線條的光、混進合成好的顏色', () => {
  it('光＝彩虹色 ×（base＋sweep × 光帶）：光帶掃過時更亮', () => {
    const foil = { r: 1, g: 0.5, b: 0.25 };
    const dim = lineGlow(foil, 0);
    const lit = lineGlow(foil, 1);
    expect(dim.r).toBeCloseTo(LINEART_LOOK.base, 12);
    expect(dim.g).toBeCloseTo(0.5 * LINEART_LOOK.base, 12);
    expect(lit.r).toBeCloseTo(LINEART_LOOK.base + LINEART_LOOK.sweep, 12);
  });

  it('比例 0：後面的顏色原封不動（白底、鐳射強度 0、看不見的層）；比例 1：整個換成光', () => {
    const cb = { r: 0.123, g: 0.456, b: 1.37 };
    const glow = { r: 1.2, g: 0.6, b: 0.3 };
    expect(lineartMix(cb, glow, 0)).toEqual(cb);
    expect(lineartMix(cb, glow, 1)).toEqual(glow);
    const half = lineartMix({ r: 0, g: 0, b: 0 }, glow, 0.5);
    expect(half.r).toBeCloseTo(0.6, 12);
  });

  it('鐳射強度的倍數：0＝不亮（只看鐳射強度）；越強越多、到 1 為止；預設強度 65 時整條換成光', () => {
    expect(lineFoil(0)).toBe(0);
    expect(lineFoil(0.4)).toBeCloseTo(0.4 * LINEART_LOOK.gain, 12);
    expect(lineFoil(0.65)).toBe(1);
    expect(lineFoil(1)).toBe(1);
    expect(lineFoil(0.2)).toBeLessThan(lineFoil(0.4));
  });

  it('黑線（加深模式合成完是 0）變成亮線：比例＝混入比例 × 鐳射強度倍數', () => {
    const k = lineWeight(lineStrength({ r: 0, g: 0, b: 0 }, 1)) * lineFoil(0.65);
    const out = lineartMix({ r: 0, g: 0, b: 0 }, lineGlow({ r: 1, g: 0.42, b: 0.62 }, 0), k);
    expect(out.r).toBeGreaterThan(0.5);
  });
});
