// T-408 混合模式的參考函式（src/render/blend.ts）：公式照 SCHEMA §1「混合模式」（W3C Compositing and Blending Level 1，
// 在 sRGB 數值 0～1 上算）。代表值是照 W3C 公式手算的；shader（blend-nodes.ts）照這些函式實作。
import { describe, expect, it } from 'vitest';
import { BLEND_MODES, OPAQUE_LAYER_BLENDS, type BlendMode } from '../src/model/types';
import {
  blendColor,
  blendHoloMask,
  clipColor,
  compositeColor,
  linearToSrgb,
  lum,
  opacityFactor,
  premultiplyRows,
  setLum,
  srgbToLinear,
} from '../src/render/blend';
import { castsShadow } from '../src/render/shadow';
import type { Rgb } from '../src/render/frame';

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

function expectRgb(actual: Rgb, expected: Rgb, digits = 9): void {
  expect(actual.r).toBeCloseTo(expected.r, digits);
  expect(actual.g).toBeCloseTo(expected.g, digits);
  expect(actual.b).toBeCloseTo(expected.b, digits);
}

/** 固定種子亂數（mulberry32）。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CB = rgb(0.2, 0.5, 0.8);
const CS = rgb(0.6, 0.3, 0.9);

describe('B(Cb, Cs)：七種模式的代表值（W3C 公式手算）', () => {
  const cases: [BlendMode, Rgb][] = [
    ['normal', rgb(0.6, 0.3, 0.9)],
    ['multiply', rgb(0.12, 0.15, 0.72)],
    ['screen', rgb(0.68, 0.65, 0.98)],
    ['add', rgb(0.8, 0.8, 1)],
    // overlay＝hard-light(Cs, Cb)：Cb ≤ 0.5 → 2·Cb·Cs；否則 screen(Cs, 2·Cb − 1)
    ['overlay', rgb(0.24, 0.3, 0.96)],
    // soft-light：r：Cs > 0.5、Cb ≤ 0.25 → D＝((16Cb − 12)Cb + 4)Cb＝0.448；g：Cs ≤ 0.5；b：D＝√0.8
    ['soft-light', rgb(0.2496, 0.4, 0.8 + 0.8 * (Math.sqrt(0.8) - 0.8))],
    // color＝SetLum(Cs, Lum(Cb))：Lum(Cb) 0.443、Lum(Cs) 0.456 → 每個通道 −0.013，不用夾
    ['color', rgb(0.587, 0.287, 0.887)],
  ];
  it.each(cases)('%s', (mode, expected) => {
    expectRgb(blendColor(mode, CB, CS), expected);
  });

  it('七種模式在同一組顏色上結果都不一樣（看得出差別）', () => {
    const results = BLEND_MODES.map((m) => blendColor(m, CB, CS)).map((c) => `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}`);
    expect(new Set(results).size).toBe(BLEND_MODES.length);
  });
});

describe('中性色：疊上去不改變後面', () => {
  const backs = [rgb(0, 0, 0), rgb(1, 1, 1), CB, rgb(0.33, 0.66, 0.1)];
  it('加深＋白色、發光＋黑色、強光＋黑色 → 等於後面（所以白底線稿、黑底光效不用去背）', () => {
    for (const cb of backs) {
      expectRgb(blendColor('multiply', cb, rgb(1, 1, 1)), cb);
      expectRgb(blendColor('screen', cb, rgb(0, 0, 0)), cb);
      expectRgb(blendColor('add', cb, rgb(0, 0, 0)), cb);
    }
  });

  it('疊色、柔光＋50% 灰 → 等於後面', () => {
    for (const cb of backs) {
      expectRgb(blendColor('overlay', cb, rgb(0.5, 0.5, 0.5)), cb);
      expectRgb(blendColor('soft-light', cb, rgb(0.5, 0.5, 0.5)), cb);
    }
  });
});

describe('結果都在 0～1、分段處連續', () => {
  it('隨機 2000 組顏色：每種模式的結果都在 0～1', () => {
    const r = makeRng(408);
    // 每種模式記最小、最大值，最後一次比（一格一個 expect 太慢）
    const lo = new Map(BLEND_MODES.map((m) => [m, Infinity]));
    const hi = new Map(BLEND_MODES.map((m) => [m, -Infinity]));
    for (let i = 0; i < 2000; i++) {
      const cb = rgb(r(), r(), r());
      const cs = rgb(r(), r(), r());
      for (const m of BLEND_MODES) {
        const c = blendColor(m, cb, cs);
        lo.set(m, Math.min(lo.get(m)!, c.r, c.g, c.b));
        hi.set(m, Math.max(hi.get(m)!, c.r, c.g, c.b));
      }
    }
    // 換色（color）的 ClipColor 有浮點誤差（−5e−17 這種），容許 1e−12
    for (const m of BLEND_MODES) {
      expect(lo.get(m), m).toBeGreaterThanOrEqual(-1e-12);
      expect(hi.get(m), m).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('疊色在 Cb＝0.5、柔光在 Cs＝0.5 與 Cb＝0.25 的兩邊接得起來', () => {
    const e = 1e-7;
    for (const cs of [0, 0.3, 0.7, 1]) {
      expect(blendColor('overlay', rgb(0.5 - e, 0, 0), rgb(cs, 0, 0)).r).toBeCloseTo(blendColor('overlay', rgb(0.5 + e, 0, 0), rgb(cs, 0, 0)).r, 5);
    }
    for (const cb of [0, 0.2, 0.25, 0.6, 1]) {
      expect(blendColor('soft-light', rgb(cb, 0, 0), rgb(0.5 - e, 0, 0)).r).toBeCloseTo(blendColor('soft-light', rgb(cb, 0, 0), rgb(0.5 + e, 0, 0)).r, 5);
    }
    for (const cs of [0.6, 0.9, 1]) {
      expect(blendColor('soft-light', rgb(0.25 - e, 0, 0), rgb(cs, 0, 0)).r).toBeCloseTo(blendColor('soft-light', rgb(0.25 + e, 0, 0), rgb(cs, 0, 0)).r, 5);
    }
  });
});

describe('換色（color）：非分離式，保留後面的明暗', () => {
  it('Lum 係數 0.3／0.59／0.11', () => {
    expect(lum(rgb(1, 0, 0))).toBeCloseTo(0.3, 12);
    expect(lum(rgb(0, 1, 0))).toBeCloseTo(0.59, 12);
    expect(lum(rgb(0, 0, 1))).toBeCloseTo(0.11, 12);
  });

  it('超過 1 → ClipColor 往亮度拉回（手算：亮灰底＋純紅）', () => {
    // SetLum((1,0,0), 0.9)＝(1.6, 0.6, 0.6) → x＝1.6 > 1 → L＋(C − L)(1 − L)/(x − L)
    expectRgb(blendColor('color', rgb(0.9, 0.9, 0.9), rgb(1, 0, 0)), rgb(1, 0.9 - 0.3 / 7, 0.9 - 0.3 / 7));
  });

  it('小於 0 → ClipColor 往亮度拉回（手算：很暗的底＋純藍）', () => {
    // SetLum((0,0,1), 0.05)＝(−0.06, −0.06, 0.94) → n＝−0.06 < 0 → L＋(C − L)·L/(L − n)
    expectRgb(blendColor('color', rgb(0.05, 0.05, 0.05), rgb(0, 0, 1)), rgb(0, 0, 0.05 + 0.89 * (0.05 / 0.11)));
  });

  it('隨機 2000 組：結果的亮度＝後面的亮度、在 0～1', () => {
    const r = makeRng(7);
    let lumError = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const cb = rgb(r(), r(), r());
      const cs = rgb(r(), r(), r());
      const c = blendColor('color', cb, cs);
      lumError = Math.max(lumError, Math.abs(lum(c) - lum(cb)));
      lo = Math.min(lo, c.r, c.g, c.b);
      hi = Math.max(hi, c.r, c.g, c.b);
    }
    expect(lumError).toBeLessThan(1e-9);
    expect(lo).toBeGreaterThanOrEqual(-1e-12);
    expect(hi).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('setLum／clipColor 在範圍內不改顏色', () => {
    expectRgb(clipColor(rgb(0.1, 0.5, 0.9)), rgb(0.1, 0.5, 0.9));
    expectRgb(setLum(rgb(0.2, 0.4, 0.6), lum(rgb(0.2, 0.4, 0.6))), rgb(0.2, 0.4, 0.6));
  });
});

describe('合成：(1 − αs)·Cb＋αs·B(Cb, Cs)', () => {
  it('αs 0 → 後面不變；αs 1 → B；αs 0.5 → 一半', () => {
    for (const m of BLEND_MODES) {
      expectRgb(compositeColor(m, CB, CS, 0), CB);
      expectRgb(compositeColor(m, CB, CS, 1), blendColor(m, CB, CS));
      const b = blendColor(m, CB, CS);
      expectRgb(compositeColor(m, CB, CS, 0.5), rgb((CB.r + b.r) / 2, (CB.g + b.g) / 2, (CB.b + b.b) / 2));
    }
  });

  it('正常模式在 sRGB 數值上混（和 Photoshop 一樣）：黑底＋白色 50% → 0.5（不是線性空間的 0.735）', () => {
    expectRgb(compositeColor('normal', rgb(0, 0, 0), rgb(1, 1, 1), 0.5), rgb(0.5, 0.5, 0.5));
  });
});

describe('opacityFactor：0～100 → 0～1', () => {
  it('省略＝1（100）；0 → 0（看不見）；50 → 0.5；超出夾回；不是有限數字當 1', () => {
    expect(opacityFactor(undefined)).toBe(1);
    expect(opacityFactor(100)).toBe(1);
    expect(opacityFactor(0)).toBe(0);
    expect(opacityFactor(50)).toBe(0.5);
    expect(opacityFactor(-5)).toBe(0);
    expect(opacityFactor(140)).toBe(1);
    expect(opacityFactor(NaN)).toBe(1);
    expect(opacityFactor(Infinity)).toBe(1);
  });
});

describe('blendHoloMask：鐳射只套在「看得到」的地方', () => {
  it('發光／強光：黑色 0、越亮越多；加深：白色 0、越暗越多；其他模式都是 1', () => {
    for (const m of ['screen', 'add'] as const) {
      expect(blendHoloMask(m, rgb(0, 0, 0))).toBe(0);
      expect(blendHoloMask(m, rgb(1, 0.2, 0))).toBe(1);
      expect(blendHoloMask(m, rgb(0.4, 0.1, 0.2))).toBeCloseTo(0.4, 12);
    }
    expect(blendHoloMask('multiply', rgb(1, 1, 1))).toBe(0);
    expect(blendHoloMask('multiply', rgb(0, 0.5, 1))).toBe(1);
    expect(blendHoloMask('multiply', rgb(0.7, 0.9, 0.8))).toBeCloseTo(0.3, 12);
    for (const m of ['normal', 'overlay', 'soft-light', 'color'] as const) {
      expect(blendHoloMask(m, rgb(0, 0, 0))).toBe(1);
      expect(blendHoloMask(m, rgb(1, 1, 1))).toBe(1);
    }
  });

  it('沒有透明的圖能用的三種，中性色都不會反光（黑底、白底不會露出方框）', () => {
    for (const m of OPAQUE_LAYER_BLENDS) {
      const neutral = m === 'multiply' ? rgb(1, 1, 1) : rgb(0, 0, 0);
      expect(blendHoloMask(m, neutral)).toBe(0);
    }
  });
});

describe('castsShadow：只有正常模式的立體層投景深陰影', () => {
  it('立體層正常（含省略）→ 投；非正常 → 不投；底圖 → 不投', () => {
    expect(castsShadow({ role: 'depth' })).toBe(true);
    expect(castsShadow({ role: 'depth', blend: 'normal' })).toBe(true);
    for (const m of BLEND_MODES.filter((x) => x !== 'normal')) expect(castsShadow({ role: 'depth', blend: m })).toBe(false);
    expect(castsShadow({ role: 'base' })).toBe(false);
  });
});

describe('背景超過 1（鐳射的光帶、閃星）：中性色也完全不改變後面（T-413）', () => {
  const NEUTRAL: Array<[BlendMode, Rgb]> = [
    ['multiply', rgb(1, 1, 1)],
    ['screen', rgb(0, 0, 0)],
    ['add', rgb(0, 0, 0)],
    ['overlay', rgb(0.5, 0.5, 0.5)],
    ['soft-light', rgb(0.5, 0.5, 0.5)],
  ];
  const over = (c: Rgb, layers: Array<[BlendMode, Rgb, number]>): Rgb => layers.reduce((cb, [m, cs, a]) => compositeColor(m, cb, cs, a), c);

  it('審查的例子：背景 1.4 → 不透明純黑發光 → 50% 黑：有沒有發光層都是 0.7（以前有發光層是 0.5）', () => {
    const bg = rgb(1.4, 1.4, 1.4);
    const black = rgb(0, 0, 0);
    const without = over(bg, [['normal', black, 0.5]]);
    const withScreen = over(bg, [
      ['screen', black, 1],
      ['normal', black, 0.5],
    ]);
    expectRgb(without, rgb(0.7, 0.7, 0.7));
    expectRgb(withScreen, rgb(0.7, 0.7, 0.7));
  });

  it('五種中性色疊在 0～2 的背景上（任意 αs）：結果＝背景，連疊好幾層也一樣', () => {
    const rand = makeRng(413);
    for (let i = 0; i < 2000; i++) {
      const bg = rgb(rand() * 2, rand() * 2, rand() * 2);
      const [mode, cs] = NEUTRAL[i % NEUTRAL.length]!;
      expectRgb(compositeColor(mode, bg, cs, rand()), bg);
      const stack = NEUTRAL.map(([m, c]) => [m, c, rand()] as [BlendMode, Rgb, number]);
      expectRgb(over(bg, stack), bg);
    }
  });

  it('背景在 0～1 內：和 (1 − αs)·Cb＋αs·B(Cb, Cs) 一樣（以前的式子）', () => {
    const rand = makeRng(7);
    for (let i = 0; i < 2000; i++) {
      const cb = rgb(rand(), rand(), rand());
      const cs = rgb(rand() * 1.3, rand() * 1.3, rand() * 1.3);
      const a = rand();
      for (const m of BLEND_MODES) {
        const b = blendColor(m, cb, cs);
        expectRgb(compositeColor(m, cb, cs, a), rgb(cb.r + (b.r - cb.r) * a, cb.g + (b.g - cb.g) * a, cb.b + (b.b - cb.b) * a));
      }
    }
  });

  it('背景 1.4 上不透明的純黑加深＝0（墨擋住鐳射的亮光），純白發光＝1（不會超過 1）', () => {
    const bright = rgb(1.4, 1.4, 1.4);
    expectRgb(compositeColor('multiply', bright, rgb(0, 0, 0), 1), rgb(0, 0, 0));
    expectRgb(compositeColor('screen', bright, rgb(1, 1, 1), 1), rgb(1, 1, 1));
    // 再蓋 50% 黑：墨的地方仍是 0，不會透出亮光
    expectRgb(compositeColor('normal', compositeColor('multiply', bright, rgb(0, 0, 0), 1), rgb(0, 0, 0), 0.5), rgb(0, 0, 0));
    const rand = makeRng(1413);
    for (let i = 0; i < 2000; i++) {
      const cb = rgb(rand() * 2, rand() * 2, rand() * 2);
      expectRgb(compositeColor('multiply', cb, rgb(0, 0, 0), 1), rgb(0, 0, 0));
      expectRgb(compositeColor('screen', cb, rgb(1, 1, 1), 1), rgb(1, 1, 1));
    }
  });

  it('加深、發光在背景超過 1 時＝直接用沒夾的 Cb 套公式（Cb·Cs、Cb＋Cs − Cb·Cs）；其他模式超出的部分原樣加回', () => {
    const rand = makeRng(2413);
    for (let i = 0; i < 2000; i++) {
      const cb = rgb(rand() * 2, rand() * 2, rand() * 2);
      const cs = rgb(rand(), rand(), rand());
      const a = rand();
      const mixed = (target: Rgb) => rgb(cb.r + (target.r - cb.r) * a, cb.g + (target.g - cb.g) * a, cb.b + (target.b - cb.b) * a);
      const each = (f: (b: number, s: number) => number) => rgb(f(cb.r, cs.r), f(cb.g, cs.g), f(cb.b, cs.b));
      expectRgb(compositeColor('multiply', cb, cs, a), mixed(each((b, s) => b * s)));
      expectRgb(compositeColor('screen', cb, cs, a), mixed(each((b, s) => b + s - b * s)));
    }
    // 疊色、背景 1.4 上不透明的 0.2 灰：B(1, 0.2)＝1（Cb＝1 時 hard-light 的亮段），超出的 0.4 原樣加回 → 1.4
    expectRgb(compositeColor('overlay', rgb(1.4, 1.4, 1.4), rgb(0.2, 0.2, 0.2), 1), rgb(1.4, 1.4, 1.4));
    // 50% 的發光＋0.4 灰、背景 (1.2, 0.5, 0)：R：0.5·1.2＋0.5·(1＋0.6·0.2)＝1.16；G：0.5＋0.5·(0.7 − 0.5)＝0.6；B：0.5·0.4＝0.2
    expectRgb(compositeColor('screen', rgb(1.2, 0.5, 0), rgb(0.4, 0.4, 0.4), 0.5), rgb(1.16, 0.6, 0.2));
  });

  it('正常模式不透明時完全蓋住後面（背景超過 1 也一樣），半透明照 (1 − αs)·Cb＋αs·Cs', () => {
    expectRgb(compositeColor('normal', rgb(1.6, 1.2, 0.3), CS, 1), CS);
    expectRgb(compositeColor('normal', rgb(1.6, 1.2, 0.3), rgb(0, 0, 0), 0.5), rgb(0.8, 0.6, 0.15));
  });
});

describe('premultiplyRows：圖層貼圖在線性空間預乘 alpha（T-413）', () => {
  const byte = (v: number) => Math.round(v * 255);
  /** 一個像素（直通）→ 預乘後的位元組。 */
  const one = (r: number, g: number, b: number, a: number) => Array.from(premultiplyRows(new Uint8ClampedArray([r, g, b, a]), 1, 1));

  it('sRGB ↔ 線性：0、1 是端點，互為反函數，同 three.js 的公式（0.5 → 0.214）', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6);
    for (let v = 0; v <= 1; v += 1 / 64) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 9);
  });

  it('不透明原樣；完全透明變 0（不管原本的 RGB 是黑是白）；alpha 不變', () => {
    expect(one(12, 200, 255, 255)).toEqual([12, 200, 255, 255]);
    expect(one(255, 255, 255, 0)).toEqual([0, 0, 0, 0]);
    expect(one(0, 0, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('半透明：在線性空間乘 alpha 再編回 sRGB（不是 sRGB 數值直接乘 alpha）', () => {
    const [r, g, b, a] = one(128, 200, 30, 77);
    expect(a).toBe(77);
    expect(r).toBe(byte(linearToSrgb((77 / 255) * srgbToLinear(128 / 255))));
    expect(g).toBe(byte(linearToSrgb((77 / 255) * srgbToLinear(200 / 255))));
    expect(b).toBe(byte(linearToSrgb((77 / 255) * srgbToLinear(30 / 255))));
    expect(r).not.toBe(Math.round((128 * 77) / 255));
  });

  it('列上下顛倒（貼圖 v＝0 在圖的下緣），每一列內的順序不變', () => {
    const src = new Uint8ClampedArray([
      1, 2, 3, 255, 4, 5, 6, 255, // 第 0 列
      7, 8, 9, 255, 10, 11, 12, 255, // 第 1 列
    ]);
    expect(Array.from(premultiplyRows(src, 2, 2))).toEqual([7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('模擬 GPU 內插：不透明白＋透明黑各一半，在亮底上合成不會變暗（直通 alpha 會暗一圈）', () => {
    const white = one(255, 255, 255, 255);
    const clear = one(0, 0, 0, 0);
    // sRGB 格式的貼圖：取樣時每個像素先解碼成線性，再內插
    const lin = (px: number[]) => srgbToLinear(px[0]! / 255);
    const alpha = (white[3]! + clear[3]!) / 2 / 255;
    const premultiplied = (lin(white) + lin(clear)) / 2;
    const own = linearToSrgb(premultiplied / alpha); // shader：除回 alpha
    const bg = 0.9;
    expect(bg + (own - bg) * alpha).toBeCloseTo(0.95, 6);
    // 對照：直通 alpha 的貼圖（透明處 RGB 黑），RGB 和 alpha 分開內插 → 0.5 線性＝0.735，合成後比底色暗
    const straight = linearToSrgb((1 + 0) / 2);
    expect(bg + (straight - bg) * alpha).toBeLessThan(bg - 10 / 255);
  });
});
