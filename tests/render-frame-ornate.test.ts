// 卡框雕花邊角（T-416）的純函式：花紋大小（隨框寬微調）、四角鏡射的素材座標（標準卡與塔羅牌）、
// 灰階浮雕 → 框色上色＋和卡框同一道光的流動高光（光澤 0＝不隨角度變、轉動時高光會動）。
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT } from '../src/model/types';
import { cardOutline } from '../src/render/fit';
import {
  FRAME_METAL,
  FRAME_ORNATE,
  frameGlare,
  frameHighlightColor,
  ornateHighlightAmount,
  ornateMetal,
  ornateSize,
  ornateUv,
  type Rgb,
} from '../src/render/frame';
import { viewDirection } from '../src/render/holo';

const hex = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});
const luma = (c: Rgb) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// 介面的四個預設框色（src/ui/inspector.ts）
const COLORS: [string, Rgb][] = [
  ['銀', hex('#d8dbe2')],
  ['金', hex('#d4af37')],
  ['白', hex('#ffffff')],
  ['黑', hex('#16161a')],
];
const GOLD = COLORS[1]![1];

const STANDARD = cardOutline(ASPECT_HEIGHT.standard, 0.05);
const TAROT = cardOutline(ASPECT_HEIGHT.tarot, 0.05);

describe('花紋大小（卡寬單位）', () => {
  it('預設框寬 0.03 時約卡寬 0.2（使用者 2026-10-14 從 0.28 調小）', () => {
    expect(ornateSize(0.03, STANDARD)).toBeCloseTo(0.2, 12);
  });

  it('框越粗花紋越大，但只是微調：框寬 0.01～0.08 時在 0.17～0.27 之間', () => {
    let last = -Infinity;
    for (let w = 0.01; w <= 0.0800001; w += 0.005) {
      const s = ornateSize(w, STANDARD);
      expect(s).toBeGreaterThan(last);
      expect(s).toBeGreaterThanOrEqual(0.17);
      expect(s).toBeLessThanOrEqual(0.27);
      last = s;
    }
  });

  it('塔羅牌一樣大（以卡寬為準，不跟著卡高拉長）', () => {
    for (const w of [0.01, 0.03, 0.08]) expect(ornateSize(w, TAROT)).toBe(ornateSize(w, STANDARD));
  });

  it('不超過半個卡寬（左右兩個角不會在中間疊在一起）；壞數字當預設框寬', () => {
    expect(ornateSize(5, STANDARD)).toBeLessThanOrEqual(STANDARD.halfW);
    expect(ornateSize(NaN, STANDARD)).toBeCloseTo(0.2, 12);
    expect(ornateSize(Infinity, STANDARD)).toBeCloseTo(0.2, 12);
    expect(ornateSize(-1, STANDARD)).toBeGreaterThan(0);
  });
});

describe('四角鏡射：卡面座標 → 素材座標（u 從左右邊往內、v 從上下邊往內；素材 (0,0)＝左上角）', () => {
  for (const [name, outline] of [
    ['標準卡', STANDARD],
    ['塔羅牌', TAROT],
  ] as const) {
    it(`${name}：四個角離各自的角落一樣遠的點，對到素材的同一點`, () => {
      const s = ornateSize(0.03, outline);
      const { halfW, halfH } = outline;
      const a = 0.05;
      const b = 0.12;
      const expected = { u: a / s, v: b / s };
      const corners = [
        [-halfW + a, halfH - b], // 左上（原圖）
        [halfW - a, halfH - b], // 右上（左右鏡射）
        [-halfW + a, -halfH + b], // 左下（上下鏡射）
        [halfW - a, -halfH + b], // 右下（兩個都鏡射）
      ] as const;
      for (const [x, y] of corners) {
        const uv = ornateUv(x, y, outline, s);
        expect(uv).not.toBeNull();
        expect(uv!.u).toBeCloseTo(expected.u, 12);
        expect(uv!.v).toBeCloseTo(expected.v, 12);
      }
    });

    it(`${name}：角落本身＝(0, 0)；離角落一個花紋邊長＝(1, 1)`, () => {
      const s = ornateSize(0.03, outline);
      const { halfW, halfH } = outline;
      expect(ornateUv(-halfW, halfH, outline, s)).toEqual({ u: 0, v: 0 });
      // 剛好在邊界上會因浮點誤差落在 1 的外面（例如 1.0000000000000002），所以往裡挪一點點
      const inset = s * (1 - 1e-9);
      const far = ornateUv(-halfW + inset, halfH - inset, outline, s)!;
      expect(far.u).toBeCloseTo(1, 6);
      expect(far.v).toBeCloseTo(1, 6);
    });

    it(`${name}：卡片中間、上下邊的正中間、左右邊的正中間都沒有花紋`, () => {
      const s = ornateSize(0.08, outline);
      const { halfW, halfH } = outline;
      expect(ornateUv(0, 0, outline, s)).toBeNull();
      expect(ornateUv(0, halfH - 0.01, outline, s)).toBeNull();
      expect(ornateUv(-halfW + 0.01, 0, outline, s)).toBeNull();
      // 只要有一邊離角落超過花紋邊長就沒有
      expect(ornateUv(-halfW + s * 1.01, halfH - 0.01, outline, s)).toBeNull();
      expect(ornateUv(-halfW + 0.01, halfH - s * 1.01, outline, s)).toBeNull();
    });
  }

  it('塔羅牌的下面兩個角在塔羅牌的下緣（不是標準卡的下緣）', () => {
    const s = ornateSize(0.03, TAROT);
    expect(ornateUv(0.45, -TAROT.halfH + 0.02, TAROT, s)).not.toBeNull();
    // 離塔羅牌下緣 0.3 的點：塔羅牌上已經在花紋外面；同一點在標準卡上離下緣只有 0.14，還在花紋裡
    const y = -TAROT.halfH + 0.3;
    expect(ornateUv(0.45, y, TAROT, s)).toBeNull();
    expect(ornateUv(0.45, y, STANDARD, s)).not.toBeNull();
  });
});

describe('上色：灰階浮雕 → 框色（光澤 0 時沒有隨角度的高光）', () => {
  const m = FRAME_ORNATE;
  const at = { x: -0.4, y: 0.6 };

  it('主體的中灰＝框色；最暗（凹縫）＝黑；最亮（斜面亮邊）＝高光色（框色往白偏）', () => {
    for (const [name, c] of COLORS) {
      const mid = ornateMetal(c, m.midGray, at.x, at.y, 0, 0, 0);
      const dark = ornateMetal(c, 0, at.x, at.y, 0, 0, 0);
      const bright = ornateMetal(c, 1, at.x, at.y, 0, 0, 0);
      const hl = frameHighlightColor(c);
      for (const k of ['r', 'g', 'b'] as const) {
        expect(mid[k], name).toBeCloseTo(c[k], 9);
        expect(dark[k], name).toBeCloseTo(0, 9);
        expect(bright[k], name).toBeCloseTo(hl[k], 9);
      }
    }
  });

  it('亮度只會跟著灰階往上（看得出浮雕）；顏色都在 0～1', () => {
    for (const [name, c] of COLORS) {
      for (const shine of [0, 1, 2]) {
        for (const yaw of [-40, 0, 25]) {
          const v = viewDirection('front', yaw, 10);
          let last = -Infinity;
          for (let lum = 0; lum <= 1.0001; lum += 0.05) {
            const out = ornateMetal(c, lum, at.x, at.y, v.x, v.y, shine);
            for (const k of ['r', 'g', 'b'] as const) {
              expect(out[k]).toBeGreaterThanOrEqual(0);
              expect(out[k]).toBeLessThanOrEqual(1);
            }
            expect(luma(out), `${name} 光澤 ${shine} yaw ${yaw} 灰 ${lum.toFixed(2)}`).toBeGreaterThanOrEqual(last - 1e-12);
            last = luma(out);
          }
        }
      }
    }
  });

  it('金框的花紋仍是金色調：紅 ≥ 綠 ≥ 藍（任何灰階、角度、光澤）', () => {
    for (const shine of [0, 1, 2]) {
      for (const yaw of [-50, -20, 0, 20, 50]) {
        const v = viewDirection('front', yaw, -8);
        for (let lum = 0.05; lum <= 1.0001; lum += 0.05) {
          const out = ornateMetal(GOLD, lum, at.x, at.y, v.x, v.y, shine);
          expect(out.r).toBeGreaterThanOrEqual(out.g - 1e-9);
          expect(out.g).toBeGreaterThanOrEqual(out.b - 1e-9);
        }
      }
    }
  });

  it('超出 0～1 的灰階夾回', () => {
    expect(ornateMetal(GOLD, -1, at.x, at.y, 0, 0, 1)).toEqual(ornateMetal(GOLD, 0, at.x, at.y, 0, 0, 1));
    expect(ornateMetal(GOLD, 3, at.x, at.y, 0, 0, 1)).toEqual(ornateMetal(GOLD, 1, at.x, at.y, 0, 0, 1));
  });
});

describe('金屬高光：和卡框同一道光、跟著光澤、轉動時會動', () => {
  const m = FRAME_ORNATE;
  // 左上角花紋上的一點（主體中灰、和斜面亮邊）
  const p = { x: -0.42, y: 0.62 };
  const sweep = (lum: number, shine: number) =>
    Array.from({ length: 41 }, (_, i) => {
      const yaw = -60 + i * 3;
      const v = viewDirection('front', yaw, 0);
      return { yaw, c: ornateMetal(GOLD, lum, p.x, p.y, v.x, v.y, shine), glint: frameGlare(p.x, p.y, v.x, v.y).glint };
    });

  it('光澤 0：任何角度都一樣（素色，只有浮雕本身的明暗）', () => {
    for (const lum of [0.2, m.midGray, 0.9]) {
      const s = sweep(lum, 0);
      for (const { c } of s) expect(c).toEqual(s[0]!.c);
    }
  });

  it('光澤 50（倍數 1）：轉動時同一點的亮度會變（高光滑過），最亮的角度＝卡框亮帶掃過這一點的角度', () => {
    for (const lum of [m.midGray, 0.85]) {
      const s = sweep(lum, 1);
      const lums = s.map((e) => luma(e.c));
      const max = Math.max(...lums);
      const min = Math.min(...lums);
      expect(max - min, `灰 ${lum}`).toBeGreaterThan(0.08);
      const brightest = s[lums.indexOf(max)]!;
      const peakGlint = Math.max(...s.map((e) => e.glint));
      expect(brightest.glint).toBeGreaterThan(peakGlint * 0.9);
    }
  });

  it('斜面亮邊比主體更吃高光：亮帶掃過時，亮邊被高光色蓋過的比例比主體多；凹縫最少', () => {
    const v = viewDirection('front', 0, 0);
    // 找亮帶正好掃過 p 的角度
    let best = { yaw: 0, glint: -1 };
    for (let yaw = -60; yaw <= 60; yaw += 0.5) {
      const w = viewDirection('front', yaw, 0);
      const g = frameGlare(p.x, p.y, w.x, w.y).glint;
      if (g > best.glint) best = { yaw, glint: g };
    }
    const w = viewDirection('front', best.yaw, 0);
    const crevice = ornateHighlightAmount(0.1, p.x, p.y, w.x, w.y, 1);
    const body = ornateHighlightAmount(m.midGray, p.x, p.y, w.x, w.y, 1);
    const ridge = ornateHighlightAmount(0.9, p.x, p.y, w.x, w.y, 1);
    expect(ridge).toBeGreaterThan(body + 0.2);
    expect(body).toBeGreaterThanOrEqual(crevice);
    expect(ridge).toBeLessThanOrEqual(FRAME_METAL.highlightMax);
    // 光澤 0 沒有高光
    expect(ornateHighlightAmount(0.9, p.x, p.y, v.x, v.y, 0)).toBe(0);
  });

  it('光澤越高高光越明顯（0 → 1 → 2），但不洗白：高光最多只蓋過底色 highlightMax', () => {
    const range = (shine: number) => {
      const lums = sweep(m.midGray, shine).map((e) => luma(e.c));
      return Math.max(...lums) - Math.min(...lums);
    };
    expect(range(0)).toBe(0);
    expect(range(1)).toBeGreaterThan(range(0));
    expect(range(2)).toBeGreaterThan(range(1));
    for (const { c } of sweep(m.midGray, 2)) expect(luma(c)).toBeLessThan(luma(frameHighlightColor(GOLD)) + 1e-9);
  });
});
