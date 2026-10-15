// 鐳射的純函式：設定 → shader 數值、範圍 → 每層要不要反光、卡片姿態 → 觀看方向。
import { Vector3 } from 'three';
import { uniform, vec2, vec3 } from 'three/tsl';
import { describe, expect, it, vi } from 'vitest';
import { holoSurface, type HoloUniforms } from '../src/render/holo-nodes';
import { HOLO_PALETTES, type Card, type Foil, type Holo, type HoloPalette, type Layer } from '../src/model/types';
import type { Rgb } from '../src/render/frame';
import {
  FOIL_FLASH_SECONDS,
  foilFlashLevel,
  hexToRgb,
  holoPaletteColors,
  holoSpectrum,
  holoTargets,
  holoUniformValues,
  MATTE_LOOK,
  matteLift,
  matteSheen,
  maskCoverage,
  maskUv,
  MAX_SPARKLE_DENSITY,
  SPECTRUM_STOPS,
  SPARKLE_PERIOD,
  viewDirection,
} from '../src/render/holo';

it('閃星週期與 shader 實際時間相位倍率一致，維持原效果速度', () => {
  const time = uniform(0);
  const mul = vi.fn((rate: number) => time.mul(rate));
  const color = uniform(new Vector3());
  holoSurface(vec2(0), vec3(0), {
    foil: uniform(1), freq: uniform(1), sparkleCut: uniform(0.9), matte: uniform(0.35),
    time: { mul } as unknown as HoloUniforms['time'], palette: [color, color, color, color],
  });
  expect(mul).toHaveBeenCalledTimes(1);
  const rate = mul.mock.calls[0]![0];
  expect(rate).toBe(1.8);
  expect(SPARKLE_PERIOD).toBeCloseTo(2 * Math.PI / rate, 12);
});

const holo = (patch: Partial<Holo> = {}): Holo => ({
  strength: 40,
  bandWidth: 1,
  sparkle: 30,
  palette: 'warm',
  colors: [...HOLO_PALETTES.warm],
  ...patch,
});

function layer(id: string, depth: number, on: boolean): Layer {
  const base = depth === 0;
  return { id, name: id, role: base ? 'base' : 'depth', image: '0123456789abcdef', visible: true, depth, x: 0, y: 0, scale: 1, holo: on, hasAlpha: !base };
}

function card(patch: Partial<Card> = {}): Card {
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [layer('base', 0, false), layer('hero', 50, true), layer('fore', 90, false)] },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: holo(),
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...patch,
  };
}

describe('鐳射設定 → shader 數值', () => {
  it('強度 0～100 → 0～1（0＝全關，閃星也跟著乘 0）', () => {
    expect(holoUniformValues(holo({ strength: 0 })).foil).toBe(0);
    expect(holoUniformValues(holo({ strength: 40 })).foil).toBeCloseTo(0.4, 12);
    expect(holoUniformValues(holo({ strength: 100 })).foil).toBe(1);
  });

  it('色帶寬度 1＝原演算法的頻率；越寬頻率越低（頻率＝1／寬度）', () => {
    expect(holoUniformValues(holo({ bandWidth: 1 })).freq).toBe(1);
    expect(holoUniformValues(holo({ bandWidth: 2 })).freq).toBeCloseTo(0.5, 12);
    expect(holoUniformValues(holo({ bandWidth: 0.1 })).freq).toBeCloseTo(10, 12);
    expect(holoUniformValues(holo({ bandWidth: 1.5 })).freq).toBeLessThan(holoUniformValues(holo({ bandWidth: 1.2 })).freq);
  });

  it('閃星 0＝門檻 1（亂數永遠到不了，沒有閃星）；越多門檻越低；預設 30＝原演算法的 0.9', () => {
    expect(holoUniformValues(holo({ sparkle: 0 })).sparkleCut).toBe(1);
    expect(holoUniformValues(holo({ sparkle: 30 })).sparkleCut).toBeCloseTo(0.9, 12);
    expect(holoUniformValues(holo({ sparkle: 100 })).sparkleCut).toBeCloseTo(1 - MAX_SPARKLE_DENSITY, 12);
    expect(holoUniformValues(holo({ sparkle: 80 })).sparkleCut).toBeLessThan(holoUniformValues(holo({ sparkle: 50 })).sparkleCut);
  });

  it('超出範圍或不是數字 → 夾回範圍，不會讓 shader 拿到 NaN', () => {
    const v = holoUniformValues(holo({ strength: 250, bandWidth: 0, sparkle: -5, matte: 300 }));
    expect(v).toEqual({ foil: 1, freq: 10, sparkleCut: 1, matte: 1 });
    const n = holoUniformValues(holo({ strength: NaN, bandWidth: NaN, sparkle: NaN, matte: NaN }));
    for (const x of Object.values(n)) expect(Number.isFinite(x)).toBe(true);
    expect(n.foil).toBe(0);
    expect(n.freq).toBe(1);
    expect(n.sparkleCut).toBe(1);
    expect(n.matte).toBe(0);
  });

  it('霧光（T-417）：0～100 → 0～1；省略＝35；強度 0 時霧光也關（兩種都關）', () => {
    expect(holoUniformValues(holo()).matte).toBeCloseTo(0.35, 12);
    expect(holoUniformValues(holo({ matte: 0 })).matte).toBe(0);
    expect(holoUniformValues(holo({ matte: 100 })).matte).toBe(1);
    expect(holoUniformValues(holo({ matte: 80, strength: 0 })).matte).toBe(0);
    expect(holoUniformValues(holo({ matte: 80, strength: 1 })).matte).toBeCloseTo(0.8, 12);
  });
});

describe('霧光的樣子（T-417）：沒有彩虹，很淡的白色寬光帶隨視角慢慢滑過', () => {
  const front = { x: 0, y: 0, z: 1 };

  it('光帶亮度在 haze～1 之間（沒有光帶的地方也有一點點霧）', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x <= 1; x += 0.05)
      for (let y = 0; y <= 1.5; y += 0.05) {
        const v = matteSheen(x, y, front);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    expect(lo).toBeGreaterThanOrEqual(MATTE_LOOK.haze - 1e-9);
    expect(hi).toBeLessThanOrEqual(1 + 1e-9);
    expect(hi).toBeGreaterThan(0.95); // 正面看時光帶在卡面上
    expect(lo).toBeLessThan(MATTE_LOOK.haze + 0.05);
  });

  it('光帶是寬的：沿光帶垂直方向，亮度過半的寬度約 0.25～0.5 卡寬', () => {
    // 沿對角線走（光帶的法線方向），量亮度 > 一半的距離
    const n = Math.hypot(MATTE_LOOK.dir.x, MATTE_LOOK.dir.y);
    const ux = MATTE_LOOK.dir.x / n;
    const uy = MATTE_LOOK.dir.y / n;
    let inside = 0;
    const step = 0.002;
    for (let t = -1; t <= 2; t += step) {
      const v = matteSheen(0.5 + ux * (t - 0.5), 0.7 + uy * (t - 0.5), front);
      if ((v - MATTE_LOOK.haze) / (1 - MATTE_LOOK.haze) > 0.5) inside += step;
    }
    expect(inside).toBeGreaterThan(0.25);
    expect(inside).toBeLessThan(0.5);
  });

  it('隨視角滑過：轉 20° 光帶移動，但比鐳射的光帶慢（視角係數小）', () => {
    const tilt = viewDirection('front', 20, 0);
    const at = (v: { x: number; y: number; z: number }) => {
      // 找卡面中線上最亮的位置
      let best = -1;
      let where = 0;
      for (let x = -1; x <= 2; x += 0.001) {
        const s = matteSheen(x, 0.7, v);
        if (s > best) {
          best = s;
          where = x;
        }
      }
      return where;
    };
    const moved = Math.abs(at(tilt) - at(front));
    expect(moved).toBeGreaterThan(0.1);
    expect(MATTE_LOOK.view.x).toBeLessThan(1.8); // 鐳射光帶的視角係數是 1.8
  });

  it('加多亮：霧光 × 係數 × 光帶；霧光 0 或強度 0（uniform 0）時是 0', () => {
    expect(matteLift(0, 1)).toBe(0);
    expect(matteLift(1, 1)).toBeCloseTo(MATTE_LOOK.gain, 12);
    expect(matteLift(0.35, 0.5)).toBeCloseTo(0.35 * MATTE_LOOK.gain * 0.5, 12);
    // 預設 35 時最亮的地方也只加一點（不搶畫面）
    expect(matteLift(0.35, 1)).toBeLessThan(0.15);
    expect(matteLift(0.35, 1)).toBeGreaterThan(0.05);
  });
});

describe('黑白遮罩（T-417 反光層「上傳黑白圖」）', () => {
  it('反光程度＝亮度 × alpha：白 1、黑 0、灰約一半、透明 0', () => {
    expect(maskCoverage(1, 1, 1, 1)).toBeCloseTo(1, 12);
    expect(maskCoverage(0, 0, 0, 1)).toBe(0);
    expect(maskCoverage(0.5, 0.5, 0.5, 1)).toBeCloseTo(0.5, 12);
    expect(maskCoverage(1, 1, 1, 0)).toBe(0);
    expect(maskCoverage(1, 0, 0, 1)).toBeGreaterThan(0);
    expect(maskCoverage(1, 0, 0, 1)).toBeLessThan(0.5);
  });

  it('cover、置中、不跟視差：卡面座標 → 圖的 uv（v 往上，和 three.js 的貼圖一樣）', () => {
    // 卡面 1 × 1.4；圖和卡面同比例 → 剛好貼滿
    const same = maskUv(0, 0, 1, 1.4, 100, 140);
    expect(same.u).toBeCloseTo(0.5, 12);
    expect(same.v).toBeCloseTo(0.5, 12);
    const corner = maskUv(-0.5, 0.7, 1, 1.4, 100, 140);
    expect(corner.u).toBeCloseTo(0, 12);
    expect(corner.v).toBeCloseTo(1, 12);
    // 正方形的圖：上下貼滿、左右裁掉
    const square = maskUv(-0.5, -0.7, 1, 1.4, 100, 100);
    expect(square.v).toBeCloseTo(0, 12);
    expect(square.u).toBeGreaterThan(0);
    expect(square.u).toBeCloseTo((1 - 1 / 1.4) / 2, 12);
  });
});

describe('選中反光層時的斜線（約 1 秒）', () => {
  it('從 0 亮起、中間 1、約 1 秒後回到 0；之前與之後都是 0', () => {
    expect(FOIL_FLASH_SECONDS).toBeGreaterThanOrEqual(0.8);
    expect(FOIL_FLASH_SECONDS).toBeLessThanOrEqual(1.2);
    expect(foilFlashLevel(-0.1)).toBe(0);
    expect(foilFlashLevel(0)).toBe(0);
    expect(foilFlashLevel(FOIL_FLASH_SECONDS * 0.4)).toBe(1);
    expect(foilFlashLevel(FOIL_FLASH_SECONDS)).toBe(0);
    expect(foilFlashLevel(5)).toBe(0);
    expect(foilFlashLevel(Number.NaN)).toBe(0);
    for (let t = 0; t <= FOIL_FLASH_SECONDS; t += 0.01) {
      const v = foilFlashLevel(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

/** T-310 以前固定的色譜（原演算法 holo-card-studio 的 spectrum：粉 → 金 → 藍 → 白），用來確認「經典彩虹」和以前一樣。 */
function originalSpectrum(t0: number): Rgb {
  const t = t0 - Math.floor(t0);
  const sat = (v: number) => Math.min(1, Math.max(0, v));
  const mix = (a: Rgb, b: Rgb, k: number): Rgb => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
  const pink = mix({ r: 1, g: 0.32, b: 0.62 }, { r: 1, g: 0.85, b: 0.32 }, sat(t / 0.35));
  const blue = mix(pink, { r: 0.22, g: 0.62, b: 1 }, sat((t - 0.35) / 0.35));
  return mix(blue, { r: 1, g: 1, b: 1 }, sat((t - 0.7) / 0.3));
}

const PALETTES: HoloPalette[] = ['warm', 'classic', 'silver', 'gold', 'aurora', 'galaxy'];

describe('鐳射色彩（T-310）：4 個色票 → 色譜', () => {
  it('色碼 → 0～1 的 sRGB 數值；大小寫都行，不合格回 null', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(hexToRgb('#FF8000')).toEqual(hexToRgb('#ff8000'));
    for (const bad of ['#fff', 'ff8000', '#ff80001', '#gg0000', '', 'red']) expect(hexToRgb(bad)).toBeNull();
  });

  it('預設色彩用色票表；自訂用卡片自己的 4 色', () => {
    for (const p of PALETTES) {
      expect(holoPaletteColors(holo({ palette: p }))).toEqual(HOLO_PALETTES[p as Exclude<HoloPalette, 'custom'>].map(hexToRgb));
    }
    const colors = ['#112233', '#445566', '#778899', '#aabbcc'];
    expect(holoPaletteColors(holo({ palette: 'custom', colors }))).toEqual(colors.map(hexToRgb));
    // 不是自訂時，卡片自己的 colors 不影響畫面
    expect(holoPaletteColors(holo({ palette: 'gold', colors }))).toEqual(HOLO_PALETTES.gold.map(hexToRgb));
  });

  it('壞資料（自訂色彩不是 4 個合格顏色、色彩選項不認得）→ 用暖陽，shader 永遠拿到 4 個合格顏色', () => {
    const warm = HOLO_PALETTES.warm.map(hexToRgb);
    expect(holoPaletteColors(holo({ palette: 'custom', colors: ['#112233'] }))).toEqual(warm);
    expect(holoPaletteColors(holo({ palette: 'custom', colors: ['#112233', '#445566', 'blue', '#aabbcc'] }))).toEqual(warm);
    expect(holoPaletteColors(holo({ palette: 'neon' as never }))).toEqual(warm);
    expect(holoPaletteColors(holo({ palette: 'toString' as never }))).toEqual(warm);
  });

  it('色譜：第 1 色 → 第 2 色（0.35）→ 第 3 色（0.7）→ 第 4 色（1），超過 1 回到第 1 色', () => {
    expect(SPECTRUM_STOPS).toEqual([0, 0.35, 0.7, 1]);
    const stops: Rgb[] = [
      { r: 1, g: 0, b: 0 },
      { r: 0, g: 1, b: 0 },
      { r: 0, g: 0, b: 1 },
      { r: 1, g: 1, b: 1 },
    ];
    expect(holoSpectrum(stops, 0)).toEqual(stops[0]);
    expect(holoSpectrum(stops, 0.35)).toEqual(stops[1]);
    expect(holoSpectrum(stops, 0.7)).toEqual(stops[2]);
    const end = holoSpectrum(stops, 0.999999);
    expect(end.r).toBeCloseTo(1, 4);
    expect(end.g).toBeCloseTo(1, 4);
    expect(end.b).toBeCloseTo(1, 4);
    expect(holoSpectrum(stops, 1)).toEqual(stops[0]);
    const again = holoSpectrum(stops, 1.35);
    expect(again.r).toBeCloseTo(0, 9);
    expect(again.g).toBeCloseTo(1, 9);
    expect(again.b).toBeCloseTo(0, 9);
    // 兩個色票中間是線性漸變
    const mid = holoSpectrum(stops, 0.175);
    expect(mid.r).toBeCloseTo(0.5, 12);
    expect(mid.g).toBeCloseTo(0.5, 12);
    expect(mid.b).toBe(0);
  });

  it('經典彩虹＝以前固定的色譜：色票是原本數值最接近的 8 位元色碼，整條色譜差不到半格（< 0.5/255）', () => {
    const classic = holoPaletteColors(holo({ palette: 'classic' }));
    const original = [0, 0.35, 0.7, 0.9999999].map(originalSpectrum);
    classic.forEach((c, i) => {
      for (const ch of ['r', 'g', 'b'] as const) expect(Math.round(original[i]![ch] * 255)).toBe(Math.round(c[ch] * 255));
    });
    let worst = 0;
    for (let t = 0; t < 1; t += 0.001) {
      const a = holoSpectrum(classic, t);
      const b = originalSpectrum(t);
      worst = Math.max(worst, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
    }
    expect(worst).toBeLessThan(0.5 / 255);
  });

  it('七種色彩的色譜彼此都看得出不同', () => {
    const custom = holo({ palette: 'custom', colors: ['#202020', '#00ffaa', '#ff2020', '#2040ff'] });
    const all = [...PALETTES.map((p) => holoPaletteColors(holo({ palette: p }))), holoPaletteColors(custom)];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        let diff = 0;
        for (let t = 0; t < 0.92; t += 0.02) {
          const a = holoSpectrum(all[i]!, t);
          const b = holoSpectrum(all[j]!, t);
          diff += Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
        }
        expect(diff / 46, `${i} vs ${j}`).toBeGreaterThan(0.1);
      }
    }
  });
});

describe('反光層 → 每層要不要套亮面鐳射、哪裡是霧光（T-417）', () => {
  const withFoil = (front: Foil | undefined, back?: Foil, patch: Partial<Card> = {}) => {
    const c = card(patch);
    return { ...c, front: front ? { ...c.front, foil: front } : c.front, back: back ? { ...c.back, foil: back } : c.back };
  };

  it('整面（預設）：所有圖層＋卡框；有底圖時卡身被蓋住不用套；沒有霧光（＝以前的「全卡」）', () => {
    expect(holoTargets(card(), 'front')).toEqual({ body: false, frame: true, layers: [true, true, true], mask: null, matte: false });
  });

  it('整面：沒有底圖的面（含素色卡背）卡身也套，空白卡也會閃', () => {
    expect(holoTargets(card(), 'back')).toEqual({ body: true, frame: true, layers: [], mask: null, matte: false });
    const noBase = card({ front: { layers: [layer('hero', 50, false)] } });
    expect(holoTargets(noBase, 'front')).toEqual({ body: true, frame: true, layers: [true], mask: null, matte: false });
  });

  it('用圖層形狀：只有勾了的層（Layer.holo）；卡身不套；其他地方是霧光（＝以前的「指定圖層」＋霧光）', () => {
    const c = withFoil({ shape: 'layers', frame: false }, { shape: 'layers', frame: false });
    expect(holoTargets(c, 'front')).toEqual({ body: false, frame: false, layers: [false, true, false], mask: null, matte: true });
    expect(holoTargets(c, 'back')).toEqual({ body: false, frame: false, layers: [], mask: null, matte: true });
  });

  it('上傳黑白圖：所有圖層＋卡身照「整面」的規則套，再乘黑白圖；有霧光', () => {
    const c = withFoil({ shape: 'mask', mask: 'abcdefabcdefabcd', frame: true });
    expect(holoTargets(c, 'front')).toEqual({ body: false, frame: true, layers: [true, true, true], mask: 'abcdefabcdefabcd', matte: true });
    // 形狀是黑白圖卻沒有圖（壞資料，驗證會擋）：當成整面霧光
    const broken = withFoil({ shape: 'mask', frame: true });
    expect(holoTargets(broken, 'front')).toEqual({ body: false, frame: true, layers: [false, false, false], mask: null, matte: true });
  });

  it('關（整面霧光）：沒有任何亮面；卡框照「卡框也反光」（＝以前的「只在卡框」）', () => {
    const c = withFoil({ shape: 'none', frame: true }, { shape: 'none', frame: false });
    expect(holoTargets(c, 'front')).toEqual({ body: false, frame: true, layers: [false, false, false], mask: null, matte: true });
    expect(holoTargets(c, 'back')).toEqual({ body: false, frame: false, layers: [], mask: null, matte: true });
  });

  it('其他形狀時保留的黑白圖不影響畫面', () => {
    const c = withFoil({ shape: 'full', mask: 'abcdefabcdefabcd', frame: true });
    expect(holoTargets(c, 'front')).toEqual(holoTargets(card(), 'front'));
  });

  it('卡框關著：卡框不套', () => {
    const off = { enabled: false, width: 0.03, color: '#d8dbe2', shine: 50 };
    expect(holoTargets(card({ frame: off }), 'front')).toEqual({ body: false, frame: false, layers: [true, true, true], mask: null, matte: false });
    const none = withFoil({ shape: 'none', frame: true }, undefined, { frame: off });
    expect(holoTargets(none, 'front').frame).toBe(false);
  });

  it('兩面各自的反光層', () => {
    const c = withFoil({ shape: 'none', frame: true });
    expect(holoTargets(c, 'front').matte).toBe(true);
    expect(holoTargets(c, 'back').matte).toBe(false);
  });

  it('破框層（T-411）：不管哪種形狀，整層都不套亮面（卡內也不套，卡邊才接得上）；關掉破框照舊', () => {
    const base = card();
    const [b, hero, fx] = base.front.layers as [Layer, Layer, Layer];
    const withBreakout = (on: boolean, foil?: Foil) =>
      withFoil(foil, undefined, { front: { layers: [b, { ...hero, holo: true, breakout: on }, fx] } });
    expect(holoTargets(withBreakout(true), 'front').layers).toEqual([true, false, true]);
    expect(holoTargets(withBreakout(true, { shape: 'layers', frame: false }), 'front').layers).toEqual([false, false, false]);
    expect(holoTargets(withBreakout(true, { shape: 'mask', mask: 'abcdefabcdefabcd', frame: false }), 'front').layers).toEqual([true, false, true]);
    expect(holoTargets(withBreakout(true, { shape: 'none', frame: true }), 'front').layers).toEqual([false, false, false]);
    expect(holoTargets(withBreakout(false), 'front').layers).toEqual([true, true, true]);
    expect(holoTargets(withBreakout(false, { shape: 'layers', frame: false }), 'front').layers).toEqual([false, true, false]);
    // 底圖就算帶了 breakout 也不算破框層（照舊套）
    const baseFlag = card({ front: { layers: [{ ...b, breakout: true }, hero, fx] } });
    expect(holoTargets(baseFlag, 'front').layers).toEqual([true, true, true]);
  });
});

describe('觀看方向（卡片自己的座標：看著那一面 +x 右、+y 上、+z 朝外）', () => {
  const close = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 10);
    expect(v.y).toBeCloseTo(y, 10);
    expect(v.z).toBeCloseTo(z, 10);
  };

  it('正對正面時＝(0, 0, 1)；正對背面（yaw 180）時背面也是 (0, 0, 1)', () => {
    close(viewDirection('front', 0, 0), 0, 0, 1);
    close(viewDirection('back', 180, 0), 0, 0, 1);
  });

  it('一定是單位向量', () => {
    for (const [yaw, pitch] of [
      [35, 0],
      [-35, 20],
      [123, -45],
    ] as const) {
      for (const face of ['front', 'back'] as const) {
        const v = viewDirection(face, yaw, pitch);
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
      }
    }
  });

  it('yaw +35（卡片右緣往後退）→ 鏡頭偏到卡片的左邊（x 為負）', () => {
    const r = (35 * Math.PI) / 180;
    close(viewDirection('front', 35, 0), -Math.sin(r), 0, Math.cos(r));
    close(viewDirection('front', -35, 0), Math.sin(r), 0, Math.cos(r));
  });

  it('pitch +30（上緣朝觀看者）→ 鏡頭在卡片上方（y 為正）', () => {
    const r = (30 * Math.PI) / 180;
    close(viewDirection('front', 0, 30), 0, Math.sin(r), Math.cos(r));
  });

  it('背面用自己的方向、不鏡像：yaw 215＝背面轉了 +35，和正面 yaw 35 一樣', () => {
    const front = viewDirection('front', 35, 10);
    close(viewDirection('back', 215, 10), front.x, front.y, front.z);
  });

  it('背對鏡頭的那一面 z 為負', () => {
    expect(viewDirection('back', 0, 0).z).toBeCloseTo(-1, 12);
    expect(viewDirection('front', 180, 0).z).toBeCloseTo(-1, 12);
  });
});
