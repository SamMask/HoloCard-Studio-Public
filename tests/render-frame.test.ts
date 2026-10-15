// 卡框金屬質感的純函式（T-303）：框色 → 高光色、斜面亮度曲線、內緣暗線、隨視角流動的高光、整個卡框的合成。
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT } from '../src/model/types';
import { cardOutline, frameInner } from '../src/render/fit';
import {
  FRAME_METAL,
  frameBevel,
  frameGlare,
  frameHighlightAmount,
  frameHighlightColor,
  frameInnerLine,
  frameMetal,
  framePoint,
  frameShineFactor,
  type FramePoint,
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
const SILVER = hex('#d8dbe2');
const GOLD = hex('#d4af37');
const WHITE = hex('#ffffff');
const BLACK = hex('#16161a');
const COLORS: [string, Rgb][] = [
  ['銀', SILVER],
  ['金', GOLD],
  ['白', WHITE],
  ['黑', BLACK],
];

/** 約 500 像素寬的卡上，一個像素多寬（卡寬單位）。 */
const PIXEL = 0.002;

const channels = (c: Rgb) => [c.r, c.g, c.b];

describe('框色 → 高光色（往白偏，不超過 1）', () => {
  it('黑框的高光是淡灰：三色一樣、不黑也不白', () => {
    const h = frameHighlightColor(BLACK);
    expect(h.r).toBeCloseTo(h.g, 1);
    expect(h.g).toBeCloseTo(h.b, 1);
    expect(h.r).toBeGreaterThan(0.4);
    expect(h.r).toBeLessThan(0.8);
  });

  it('白框的高光就是白，不超過 1', () => {
    for (const v of channels(frameHighlightColor(WHITE))) expect(v).toBeCloseTo(1, 12);
  });

  it('每種顏色：高光每個色版都 ≥ 框色、≤ 1，而且整體比框色亮', () => {
    for (const [, c] of [...COLORS, ['紅', hex('#c0392b')] as [string, Rgb], ['藍', hex('#1d4e89')] as [string, Rgb]]) {
      const h = frameHighlightColor(c);
      const base = channels(c);
      channels(h).forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(base[i]!);
        expect(v).toBeLessThanOrEqual(1);
      });
      if (luma(c) < 0.99) expect(luma(h)).toBeGreaterThan(luma(c));
    }
  });

  it('金框的高光仍是金色調（淡金白）：紅 ≥ 綠 ≥ 藍，藍明顯比紅低', () => {
    const h = frameHighlightColor(GOLD);
    expect(h.r).toBeGreaterThanOrEqual(h.g);
    expect(h.g).toBeGreaterThanOrEqual(h.b);
    expect(h.r - h.b).toBeGreaterThan(0.15);
  });

  it('銀框的高光比銀亮、但不是純白（框不會洗成一片白）', () => {
    const h = frameHighlightColor(SILVER);
    expect(luma(h)).toBeGreaterThan(luma(SILVER));
    expect(luma(h)).toBeLessThan(1);
  });

  it('超出 0～1 的輸入夾回', () => {
    const h = frameHighlightColor({ r: 2, g: -1, b: 0.5 });
    for (const v of channels(h)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('斜面亮度曲線（t：0＝內緣、1＝外緣；facing：這段框朝光的程度）', () => {
  it('中間最亮、兩邊稍暗：任何朝光方向都一樣', () => {
    for (const facing of [-1, -0.6, 0, 0.6, 1]) {
      const mid = frameBevel(0.5, facing);
      expect(mid).toBeCloseTo(1, 12);
      expect(mid).toBeGreaterThan(frameBevel(0, facing));
      expect(mid).toBeGreaterThan(frameBevel(1, facing));
      // 「稍暗」：兩邊不會暗到看不見
      expect(frameBevel(0, facing)).toBeGreaterThan(0.5);
      expect(frameBevel(1, facing)).toBeGreaterThan(0.5);
    }
  });

  it('朝光的那段框外半邊比內半邊亮，背光的相反（看得出立體斜面）', () => {
    expect(frameBevel(0.85, 1)).toBeGreaterThan(frameBevel(0.15, 1));
    expect(frameBevel(0.85, -1)).toBeLessThan(frameBevel(0.15, -1));
    expect(frameBevel(0, 0)).toBeCloseTo(frameBevel(1, 0), 12);
  });

  it('t 超出 0～1 夾回', () => {
    expect(frameBevel(-3, 0.5)).toBeCloseTo(frameBevel(0, 0.5), 12);
    expect(frameBevel(7, 0.5)).toBeCloseTo(frameBevel(1, 0.5), 12);
  });
});

describe('內緣暗線（把框和圖分開）', () => {
  it('內緣明顯壓暗，離開暗線就完全不壓', () => {
    expect(frameInnerLine(0, 0.03, PIXEL)).toBeLessThan(0.5);
    expect(frameInnerLine(0.015, 0.03, PIXEL)).toBe(1);
    expect(frameInnerLine(0.03, 0.03, PIXEL)).toBe(1);
  });

  it('由內往外只會變亮（只有一條線）', () => {
    let prev = frameInnerLine(0, 0.05, PIXEL);
    for (let d = 0.0005; d <= 0.05; d += 0.0005) {
      const v = frameInnerLine(d, 0.05, PIXEL);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('暗線至少一個像素寬；細框（0.01）時最多佔框寬的 3 成多一個像素，框不會整條變暗', () => {
    const coarse = 0.006; // 很遠、一個像素很寬時
    expect(frameInnerLine(coarse * 0.9, 0.08, coarse)).toBeLessThan(0.5);
    const thin = 0.01;
    expect(frameInnerLine(thin * FRAME_METAL.innerLineMax + PIXEL + 1e-9, thin, PIXEL)).toBe(1);
  });
});

// 標準卡、圓角 0.05（新卡片預設）
const OUTLINE = cardOutline(ASPECT_HEIGHT.standard, 0.05);

/** 框上一圈取樣點（步距 step）。 */
function ringPoints(width: number, step = 0.004): FramePoint[] {
  const inner = frameInner(OUTLINE, width);
  const out: FramePoint[] = [];
  for (let x = -OUTLINE.halfW; x <= OUTLINE.halfW; x += step) {
    for (let y = -OUTLINE.halfH; y <= OUTLINE.halfH; y += step) {
      const p = framePoint(x, y, OUTLINE, inner);
      if (p.d >= 0 && p.t < 1) out.push(p);
    }
  }
  return out;
}

/** 上框（或左框）中線上，高光最亮的位置。 */
function brightestAlong(edge: 'top' | 'left', yawDeg: number, pitchDeg: number, width = 0.03): number {
  const inner = frameInner(OUTLINE, width);
  const v = viewDirection('front', yawDeg, pitchDeg);
  let best = -Infinity;
  let at = 0;
  for (let s = -0.4; s <= 0.4; s += 0.002) {
    const p =
      edge === 'top'
        ? framePoint(s, OUTLINE.halfH - width / 2, OUTLINE, inner)
        : framePoint(-OUTLINE.halfW + width / 2, s, OUTLINE, inner);
    const a = frameHighlightAmount(p, v.x, v.y);
    if (a > best) {
      best = a;
      at = s;
    }
  }
  return at;
}

describe('流動高光（位置隨觀看方向移動）', () => {
  it('正面看時高光在左上那半圈（和景深陰影同一道光：光從左上來）', () => {
    const v = viewDirection('front', 0, 0);
    let upperLeft = 0;
    let lowerRight = 0;
    for (const p of ringPoints(0.03)) {
      const a = frameHighlightAmount(p, v.x, v.y);
      if (p.x * 0.6 - p.y * 0.8 < 0) upperLeft += a;
      else lowerRight += a;
    }
    expect(upperLeft).toBeGreaterThan(lowerRight * 1.5);
  });

  /** 先找「高光剛好在這段框正中間」的角度，再看前後轉 ±6° 時高光的位置：一路往同一個方向、都還在這段框上、滑得夠遠。 */
  function expectSlides(edge: 'top' | 'left', turn: (deg: number) => [number, number]) {
    let center = 0;
    let best = -Infinity;
    for (let deg = -25; deg <= 25; deg += 0.5) {
      const [yaw, pitch] = turn(deg);
      const v = viewDirection('front', yaw, pitch);
      const inner = frameInner(OUTLINE, 0.03);
      const mid = edge === 'top' ? framePoint(0, OUTLINE.halfH - 0.015, OUTLINE, inner) : framePoint(-OUTLINE.halfW + 0.015, 0, OUTLINE, inner);
      const a = frameHighlightAmount(mid, v.x, v.y);
      if (a > best) {
        best = a;
        center = deg;
      }
    }
    const at = [-6, -3, 0, 3, 6].map((d) => brightestAlong(edge, ...turn(center + d)));
    const dir = Math.sign(at[4]! - at[0]!);
    expect(dir).not.toBe(0);
    for (let i = 1; i < at.length; i++) expect(Math.sign(at[i]! - at[i - 1]!)).toBe(dir);
    for (const s of at) expect(Math.abs(s)).toBeLessThan(0.39); // 沒有滑出搜尋範圍
    expect(Math.abs(at[4]! - at[0]!)).toBeGreaterThan(0.15);
  }

  it('左右轉卡時，高光沿著上框滑動', () => {
    expectSlides('top', (deg) => [deg, 0]);
  });

  it('上下轉卡時，高光沿著左框滑動', () => {
    expectSlides('left', (deg) => [0, deg]);
  });

  it('背面不鏡像：轉到背面的同一個相對角度，背面框上同一點的高光和正面一樣', () => {
    for (const [yaw, pitch] of [
      [10, 0],
      [-20, 8],
      [25, -12],
    ] as const) {
      const f = viewDirection('front', yaw, pitch);
      const b = viewDirection('back', 180 + yaw, pitch);
      for (const [x, y] of [
        [-0.4, 0.6],
        [0.45, -0.2],
        [0.1, 0.68],
      ] as const) {
        const gf = frameGlare(x, y, f.x, f.y);
        const gb = frameGlare(x, y, b.x, b.y);
        expect(gb.glint).toBeCloseTo(gf.glint, 9);
        expect(gb.env).toBeCloseTo(gf.env, 9);
      }
    }
  });

  it('高光強度 0～1、環境明暗 0～1', () => {
    for (let u = -2; u <= 2; u += 0.01) {
      const g = frameGlare(u, -u * 0.5, 0.3, -0.2);
      expect(g.glint).toBeGreaterThanOrEqual(0);
      expect(g.glint).toBeLessThanOrEqual(1);
      expect(g.env).toBeGreaterThanOrEqual(0);
      expect(g.env).toBeLessThanOrEqual(1);
    }
  });
});

describe('整個卡框：四種顏色轉動時都有金屬高光、不刺眼、不洗白', () => {
  const ANGLES: [number, number][] = [];
  for (let yaw = -25; yaw <= 25; yaw += 5) for (const pitch of [-10, 0, 10]) ANGLES.push([yaw, pitch]);

  for (const width of [0.01, 0.03, 0.08]) {
    // 框寬方向至少取 4～8 點
    const ring = ringPoints(width, Math.max(0.0025, width / 8));

    it(`框寬 ${width}：顏色都在 0～1；每個角度都有一段明顯較亮的高光；高光蓋過底色的部分不到兩成`, () => {
      let lo = Infinity;
      let hi = -Infinity;
      let maxAmount = 0;
      const brushHi = (v: number) => {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      };
      for (const [name, color] of COLORS) {
        for (const [yaw, pitch] of ANGLES) {
          const v = viewDirection('front', yaw, pitch);
          const lumas: number[] = [];
          let strong = 0;
          for (const p of ring) {
            const c = frameMetal(color, p, v.x, v.y, PIXEL);
            channels(c).forEach(brushHi);
            lumas.push(luma(c));
            const a = frameHighlightAmount(p, v.x, v.y);
            maxAmount = Math.max(maxAmount, a);
            if (a > 0.5) strong++;
          }
          lumas.sort((a, b) => a - b);
          const median = lumas[Math.floor(lumas.length / 2)]!;
          const max = lumas[lumas.length - 1]!;
          // 有高光（黑框是淡灰的亮帶，其他顏色是往白偏的亮帶）
          expect(max - median, `${name} ${yaw}°/${pitch}°`).toBeGreaterThan(name === '黑' ? 0.2 : 0.08);
          // 不洗白：高光只是一小段
          expect(strong / ring.length, `${name} ${yaw}°/${pitch}°`).toBeLessThan(0.2);
        }
        // 拉絲紋最強的起伏也不會超出 0～1
        const v = viewDirection('front', 10, 5);
        for (const p of ring) for (const brush of [-1, 1]) channels(frameMetal(color, p, v.x, v.y, PIXEL, brush)).forEach(brushHi);
      }
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(maxAmount).toBeLessThanOrEqual(FRAME_METAL.highlightMax);
    });
  }

  it('框和圖之間有清楚分界：內緣比框中間暗（黑框除外，本來就最暗）', () => {
    const inner = frameInner(OUTLINE, 0.03);
    const v = viewDirection('front', 0, 0);
    for (const [name, color] of COLORS) {
      if (name === '黑') continue;
      for (const x of [-0.3, 0, 0.3]) {
        const edge = luma(frameMetal(color, framePoint(x, inner.halfH, OUTLINE, inner), v.x, v.y, PIXEL));
        const mid = luma(frameMetal(color, framePoint(x, inner.halfH + 0.015, OUTLINE, inner), v.x, v.y, PIXEL));
        expect(edge, `${name} x=${x}`).toBeLessThan(mid * 0.6);
      }
    }
  });

  it('框上的點：t 從內緣 0 到外緣 1，直邊上的框寬就是設定的寬，朝光程度在 −1～1', () => {
    const inner = frameInner(OUTLINE, 0.05);
    const topIn = framePoint(0, inner.halfH, OUTLINE, inner);
    const topOut = framePoint(0, OUTLINE.halfH, OUTLINE, inner);
    expect(topIn.t).toBeCloseTo(0, 9);
    expect(topOut.t).toBeCloseTo(1, 9);
    expect(topIn.width).toBeCloseTo(0.05, 9);
    // 上框朝上、左框朝左：光從左上來，兩段都朝光；下框、右框背光
    expect(framePoint(0, OUTLINE.halfH - 0.02, OUTLINE, inner).facing).toBeGreaterThan(0);
    expect(framePoint(-OUTLINE.halfW + 0.02, 0, OUTLINE, inner).facing).toBeGreaterThan(0);
    expect(framePoint(0, -OUTLINE.halfH + 0.02, OUTLINE, inner).facing).toBeLessThan(0);
    expect(framePoint(OUTLINE.halfW - 0.02, 0, OUTLINE, inner).facing).toBeLessThan(0);
    for (const p of ringPoints(0.05)) {
      expect(p.facing).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(p.facing).toBeLessThanOrEqual(1 + 1e-9);
      expect(Number.isFinite(p.t)).toBe(true);
    }
  });
});

describe('卡框光澤（T-310）：0～100 → 金屬效果倍數，0＝素色、50＝原本、100＝更亮更明顯', () => {
  it('光澤 0～100 線性對到 0～2；超出夾回、不是數字當 50（原本的效果）', () => {
    expect(frameShineFactor(0)).toBe(0);
    expect(frameShineFactor(50)).toBe(1);
    expect(frameShineFactor(100)).toBe(2);
    expect(frameShineFactor(25)).toBeCloseTo(0.5, 12);
    expect(frameShineFactor(-10)).toBe(0);
    expect(frameShineFactor(250)).toBe(2);
    expect(frameShineFactor(Number.NaN)).toBe(1);
  });

  const ring = ringPoints(0.03, 0.006);
  const ANGLES: [number, number][] = [
    [0, 0],
    [-20, 8],
    [15, -10],
    [25, 5],
  ];

  /** 每個顏色 × 角度 × 框上每一點都跑一次 fn。 */
  function each(fn: (name: string, color: Rgb, p: FramePoint, vx: number, vy: number) => void) {
    for (const [name, color] of COLORS) {
      for (const [yaw, pitch] of ANGLES) {
        const v = viewDirection('front', yaw, pitch);
        for (const p of ring) fn(name, color, p, v.x, v.y);
      }
    }
  }

  it('倍數 1＝原本 T-303 的效果（和不給一樣）', () => {
    let same = true;
    each((_n, color, p, vx, vy) => {
      for (const brush of [-1, 0, 0.5]) {
        const a = frameMetal(color, p, vx, vy, PIXEL, brush, 1);
        const b = frameMetal(color, p, vx, vy, PIXEL, brush);
        same &&= a.r === b.r && a.g === b.g && a.b === b.b;
        same &&= frameHighlightAmount(p, vx, vy, brush, 1) === frameHighlightAmount(p, vx, vy, brush);
      }
    });
    expect(same).toBe(true);
  });

  it('倍數 0＝素色：框上每一點都正好是框色（沒有斜面、暗線、高光、拉絲紋）', () => {
    let worst = 0;
    let maxAmount = 0;
    each((_n, color, p, vx, vy) => {
      for (const brush of [-1, 0, 1]) {
        const c = frameMetal(color, p, vx, vy, PIXEL, brush, 0);
        worst = Math.max(worst, Math.abs(c.r - color.r), Math.abs(c.g - color.g), Math.abs(c.b - color.b));
        maxAmount = Math.max(maxAmount, frameHighlightAmount(p, vx, vy, brush, 0));
      }
    });
    expect(worst).toBeLessThan(1e-12);
    expect(maxAmount).toBe(0);
  });

  /** 一圈框的平均亮度、亮度起伏（最亮 − 最暗）、平均高光、高光很強（蓋過 5 成以上）的比例。 */
  function stats(color: Rgb, shine: number, yaw: number, pitch: number) {
    const v = viewDirection('front', yaw, pitch);
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let amount = 0;
    let strong = 0;
    for (const p of ring) {
      const l = luma(frameMetal(color, p, v.x, v.y, PIXEL, 0, shine));
      sum += l;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
      const a = frameHighlightAmount(p, v.x, v.y, 0, shine);
      amount += a;
      if (a > 0.5) strong++;
    }
    const n = ring.length;
    return { mean: sum / n, spread: hi - lo, amount: amount / n, strong: strong / n, max: hi };
  }

  it('倍數 0 → 0.5 → 1：金屬感（亮度起伏）一路變明顯', () => {
    for (const [name, color] of COLORS) {
      for (const [yaw, pitch] of ANGLES) {
        const spreads = [0, 0.5, 1].map((k) => stats(color, k, yaw, pitch).spread);
        expect(spreads[0], `${name} ${yaw}°/${pitch}°`).toBeCloseTo(0, 12);
        expect(spreads[1]!, `${name} ${yaw}°/${pitch}°`).toBeGreaterThan(spreads[0]!);
        expect(spreads[2]!, `${name} ${yaw}°/${pitch}°`).toBeGreaterThan(spreads[1]!);
      }
    }
  });

  it('倍數 2：比原本亮、高光更多，但不洗白（顏色在 0～1、很強的高光只佔一小段）', () => {
    for (const [name, color] of COLORS) {
      for (const [yaw, pitch] of ANGLES) {
        const normal = stats(color, 1, yaw, pitch);
        const shiny = stats(color, 2, yaw, pitch);
        expect(shiny.mean, `${name} ${yaw}°/${pitch}°`).toBeGreaterThan(normal.mean);
        expect(shiny.amount, `${name} ${yaw}°/${pitch}°`).toBeGreaterThan(normal.amount * 1.5);
        expect(shiny.strong, `${name} ${yaw}°/${pitch}°`).toBeLessThan(0.3);
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    let maxAmount = 0;
    each((_n, color, p, vx, vy) => {
      for (const brush of [-1, 1]) {
        for (const ch of channels(frameMetal(color, p, vx, vy, PIXEL, brush, 2))) {
          lo = Math.min(lo, ch);
          hi = Math.max(hi, ch);
        }
        maxAmount = Math.max(maxAmount, frameHighlightAmount(p, vx, vy, brush, 2));
      }
    });
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(maxAmount).toBeLessThanOrEqual(FRAME_METAL.highlightMax);
  });
});
