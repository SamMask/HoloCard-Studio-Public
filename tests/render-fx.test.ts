// T-811 局部動態特效的 CPU 部分（render/fx-nodes.ts）：速度 → 每 4 秒幾個週期（整數，週期是 4 秒的整數分之一）、
// 時間 → 迴圈位置與相位（4 秒後回到原點，4／8／12 秒影片與 4 秒 GIF 頭尾接得上）、強度 → 倍數、顏色 → sRGB 數值、
// 哪些層要畫（破框層不畫）、預覽時間（減少動態時停在固定一格）。
import { describe, expect, it } from 'vitest';
import {
  EFFECT_STILL_TIME,
  effectClock,
  FX_LOOP_SECONDS,
  FX_MAX_CYCLES,
  fxCycles,
  fxGain,
  fxLoop,
  fxOn,
  fxPeriod,
  fxPhase,
  fxRgb,
  turntableFxTime,
} from '../src/render/fx-nodes';
import type { Layer } from '../src/model/types';

const FIRE = { kind: 'fire', color: '#ff6a1f', strength: 70, speed: 50 } as const;

describe('週期：一律是 4 秒的整數分之一', () => {
  it('速度 0～100 → 1～8 個週期（整數、越快越多、不會倒退）', () => {
    expect(FX_LOOP_SECONDS).toBe(4);
    expect(fxCycles(0)).toBe(1);
    expect(fxCycles(100)).toBe(FX_MAX_CYCLES);
    let last = 0;
    for (let s = 0; s <= 100; s++) {
      const n = fxCycles(s);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
      expect(FX_LOOP_SECONDS / fxPeriod(s)).toBeCloseTo(n, 12);
    }
  });

  it('速度超出範圍夾回、不是數字用預設速度（不會給出 0 或 NaN 個週期）', () => {
    expect(fxCycles(-10)).toBe(1);
    expect(fxCycles(500)).toBe(FX_MAX_CYCLES);
    expect(fxCycles(Number.NaN)).toBe(fxCycles(50));
  });

  it('預設速度 50 的週期不整除 1 秒（時間 0 與 1 秒的畫面才會不同）', () => {
    const p = fxPeriod(50);
    expect(1 / p).not.toBeCloseTo(Math.round(1 / p), 6);
  });
});

describe('迴圈位置與相位', () => {
  it('fxLoop 在 [0, 週期數)、整數部分＝4 秒裡的第幾個週期、小數＝相位', () => {
    for (const speed of [0, 30, 50, 100]) {
      const n = fxCycles(speed);
      for (let t = 0; t < 12; t += 0.37) {
        const L = fxLoop(t, speed);
        expect(L).toBeGreaterThanOrEqual(0);
        expect(L).toBeLessThan(n);
        expect(fxPhase(t, speed)).toBeCloseTo(L - Math.floor(L), 12);
      }
    }
  });

  it('時間 0、4、8、12 秒都在原點（剛好 0，不是 0.9999…）；影片每一格（0.05 秒）和 4 秒後那一格一樣', () => {
    for (let speed = 0; speed <= 100; speed++) {
      for (const t of [0, 4, 8, 12, 400]) expect(fxLoop(t, speed)).toBe(0);
      for (let i = 0; i < 80; i++) {
        const t = (i * 4) / 80;
        expect(fxLoop(t + 4, speed)).toBeCloseTo(fxLoop(t, speed), 9);
        expect(fxLoop(t + 8, speed)).toBeCloseTo(fxLoop(t, speed), 9);
      }
    }
  });

  it('週期內連續前進：相位每過一個週期回到 0', () => {
    const speed = 50;
    const p = fxPeriod(speed);
    expect(fxPhase(p * 0.25, speed)).toBeCloseTo(0.25, 9);
    expect(fxPhase(p * 1.5, speed)).toBeCloseTo(0.5, 9);
    expect(fxPhase(p * 3, speed)).toBe(0);
  });

  it('不是有限數字的時間 → 0（shader 拿不到 NaN）', () => {
    expect(fxLoop(Number.NaN, 50)).toBe(0);
    expect(fxLoop(Number.POSITIVE_INFINITY, 50)).toBe(0);
  });
});

describe('強度、顏色、要不要畫', () => {
  it('強度 0 → 0（沒有光）；越強越亮；超出範圍夾回', () => {
    expect(fxGain(0)).toBe(0);
    expect(fxGain(100)).toBeGreaterThan(fxGain(50));
    expect(fxGain(50)).toBeGreaterThan(0);
    expect(fxGain(200)).toBe(fxGain(100));
    expect(fxGain(Number.NaN)).toBe(0);
  });

  it('顏色 #rrggbb → sRGB 數值 0～1；不合格 → 白色', () => {
    expect(fxRgb('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(fxRgb('#FF8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(fxRgb('red')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('fxOn：有 fx 而且不是破框層', () => {
    const l = { role: 'depth', breakout: undefined, fx: FIRE } as unknown as Layer;
    expect(fxOn(l)).toBe(true);
    expect(fxOn({ ...l, breakout: true })).toBe(false);
    expect(fxOn({ ...l, fx: undefined })).toBe(false);
    expect(fxOn({ ...l, role: 'base' })).toBe(true);
  });
});

describe('轉動匯出：特效用影片時間', () => {
  it('第 i 格＝i × 一圈秒數／格數（4 秒 80 格＝每格 0.05 秒；GIF 預估 8 格＝每格 0.5 秒）', () => {
    expect(turntableFxTime(0, 80, 4)).toBe(0);
    expect(turntableFxTime(1, 80, 4)).toBeCloseTo(0.05, 12);
    expect(turntableFxTime(79, 80, 4)).toBeCloseTo(3.95, 12);
    expect(turntableFxTime(3, 8, 4)).toBeCloseTo(1.5, 12);
  });

  it('頭尾接得上：最後一格的下一格（第 80 格）和第 0 格的迴圈位置一樣；每一格前進一樣多（含跨圈：每圈都從 0 開始）', () => {
    for (let speed = 0; speed <= 100; speed += 5) {
      const n = fxCycles(speed);
      const loopAt = (i: number) => fxLoop(turntableFxTime(i, 80, 4), speed);
      expect(fxLoop(turntableFxTime(80, 80, 4), speed)).toBe(loopAt(0));
      const step = (n * 4) / 80 / 4; // 每格前進的迴圈位置
      for (let i = 0; i < 80; i++) {
        // 79 → 下一圈的第 0 格：前進量和其他格一樣（mod n）
        const next = i === 79 ? loopAt(0) + n : loopAt(i + 1);
        expect(next - loopAt(i)).toBeCloseTo(step, 9);
      }
    }
  });
});

describe('預覽時間（減少動態）', () => {
  it('平常＝影格時間；減少動態＝固定一刻（不管時間走到哪）', () => {
    expect(effectClock(12.5, false)).toBe(12.5);
    expect(effectClock(0, true)).toBe(EFFECT_STILL_TIME);
    expect(effectClock(12.5, true)).toBe(EFFECT_STILL_TIME);
  });
});
