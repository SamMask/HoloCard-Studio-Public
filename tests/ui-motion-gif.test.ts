import { describe, expect, it } from 'vitest';
import { GIF_ESTIMATE, TURNTABLE } from '../src/app/files';
import { encodeGifFrames } from '../src/file/gif-encode';
import { GIF_MAX_WIDTH } from '../src/file/types';
import { NOD_RANGE } from '../src/render/pick';
import {
  clampNodDeg,
  clampSwingDeg,
  DEFAULT_GIF_SIZE,
  estimateGifBytes,
  fileSizeText,
  GIF_ESTIMATE_NOTE,
  GIF_ESTIMATING_TEXT,
  GIF_FRAMES,
  GIF_SIZES,
  gifSizeLabel,
  gifWidth,
  motionLabel,
  MOTIONS,
  NOD_DEG,
  NOD_NOTE_TEXT,
  SWING_DEG,
  SWING_NOTE_TEXT,
  videoLengthOption,
} from '../src/ui/logic';

// T-512：動作（轉一圈／左右擺動、擺動角度）與 GIF 大小、預估檔案大小的純邏輯

describe('動作：轉一圈／左右擺動', () => {
  it('兩個選項與名字', () => {
    expect(MOTIONS).toEqual(['turn', 'swing']);
    expect(motionLabel('turn')).toBe('轉一圈');
    expect(motionLabel('swing')).toBe('左右擺動');
  });

  it('影片長度按鈕：轉一圈寫「轉 n 圈」、擺動寫「擺 n 次」（秒數一樣）', () => {
    expect(videoLengthOption(1, 'turn')).toEqual({ label: '4 秒', detail: '轉 1 圈' });
    expect(videoLengthOption(2, 'swing')).toEqual({ label: '8 秒', detail: '擺 2 次' });
    expect(videoLengthOption(3, 'swing')).toEqual({ label: '12 秒', detail: '擺 3 次' });
    // 沒給動作＝轉一圈（和以前一樣）
    expect(videoLengthOption(3)).toEqual({ label: '12 秒', detail: '轉 3 圈' });
  });

  it('擺動角度 5～60 度、整數、預設 30（render 契約的範圍）', () => {
    expect(SWING_DEG).toEqual({ min: 5, max: 60, default: 30 });
    expect(clampSwingDeg(30)).toBe(30);
    expect(clampSwingDeg(12.4)).toBe(12);
    expect(clampSwingDeg(12.6)).toBe(13);
    expect(clampSwingDeg(3)).toBe(5);
    expect(clampSwingDeg(-20)).toBe(5);
    expect(clampSwingDeg(75)).toBe(60);
    expect(clampSwingDeg(Number.NaN)).toBe(30);
    expect(clampSwingDeg(Number.POSITIVE_INFINITY)).toBe(30);
  });

  it('角度旁的小字', () => {
    expect(SWING_NOTE_TEXT).toBe('左右各轉幾度');
  });
});

describe('上下點頭（T-812）', () => {
  it('上下角度 0～25 度、整數、預設 10（和 render 的 captureTurntable 契約同一個範圍；ui 不 import render，這裡核對）', () => {
    expect(NOD_DEG).toEqual({ min: 0, max: 25, default: 10 });
    expect(NOD_DEG.min).toBe(NOD_RANGE.min);
    expect(NOD_DEG.max).toBe(NOD_RANGE.max);
    expect(TURNTABLE.pitchDeg - NOD_DEG.max).toBeGreaterThan(-90);
  });

  it('clampNodDeg：取整數、夾在 0～25；不合格（NaN、無限大）用預設 10', () => {
    expect(clampNodDeg(10)).toBe(10);
    expect(clampNodDeg(0)).toBe(0);
    expect(clampNodDeg(25)).toBe(25);
    expect(clampNodDeg(12.4)).toBe(12);
    expect(clampNodDeg(12.6)).toBe(13);
    expect(clampNodDeg(-3)).toBe(0);
    expect(clampNodDeg(26)).toBe(25);
    expect(clampNodDeg(99)).toBe(25);
    expect(clampNodDeg(Number.NaN)).toBe(10);
    expect(clampNodDeg(Number.POSITIVE_INFINITY)).toBe(10);
    expect(Object.is(clampNodDeg(-0.2), 0)).toBe(true);
  });

  it('角度旁的小字', () => {
    expect(NOD_NOTE_TEXT).toBe('轉的時候卡片上下點頭幾度（0＝只有左右）');
    expect(NOD_NOTE_TEXT).not.toMatch(/pitch|yaw|俯仰|仰角/i);
  });
});

describe('GIF 大小：小 320／中 400／大 480', () => {
  it('三種大小、名字與寬度', () => {
    expect(GIF_SIZES.map((s) => [s.size, s.width])).toEqual([
      ['small', 320],
      ['medium', 400],
      ['large', 480],
    ]);
    expect(gifSizeLabel('small')).toBe('小（寬 320）');
    expect(gifSizeLabel('medium')).toBe('中（寬 400）');
    expect(gifSizeLabel('large')).toBe('大（寬 480）');
    expect(gifWidth('large')).toBe(480);
    expect(DEFAULT_GIF_SIZE).toBe('medium');
  });

  it('都不超過 GIF 的寬度上限；格數和組裝用的一樣（ui 不 import app，這裡核對）', () => {
    for (const s of GIF_SIZES) expect(s.width).toBeLessThanOrEqual(GIF_MAX_WIDTH);
    expect(GIF_FRAMES).toBe(TURNTABLE.frames);
  });
});

describe('GIF 預估檔案大小（T-512b）：兩種寬度的試編 → 照寬度內插每格大小 × 80 格', () => {
  const sample = { bytes: 8 * 320 * 448 * 0.5, frames: 8, width: 320, height: 448 };

  it('只有一種寬度：照像素數等比例推（高度照試編的比例）', () => {
    expect(estimateGifBytes([sample], 320)).toBeCloseTo(80 * 320 * 448 * 0.5, 6);
    // 480 寬 → 高 672（照 320×448 的比例）
    expect(estimateGifBytes([sample], 480)).toBeCloseTo(80 * 480 * 672 * 0.5, 6);
    expect(estimateGifBytes([sample], 400)!).toBeGreaterThan(estimateGifBytes([sample], 320)!);
  });

  it('兩種寬度：試編過的寬度就是那個大小 × 10；中間照「每格大小 ∝ 寬^k」內插（k 由兩筆算）', () => {
    // 320 每格 30000、480 每格 54000 → k＝ln(1.8)/ln(1.5)
    const small = { bytes: 8 * 30000, frames: 8, width: 320, height: 448 };
    const large = { bytes: 8 * 54000, frames: 8, width: 480, height: 672 };
    const k = Math.log(1.8) / Math.log(1.5);
    expect(estimateGifBytes([small, large], 320)).toBeCloseTo(80 * 30000, 6);
    expect(estimateGifBytes([small, large], 480)).toBeCloseTo(80 * 54000, 6);
    expect(estimateGifBytes([small, large], 400)).toBeCloseTo(80 * 30000 * (400 / 320) ** k, 6);
    // 順序不影響；同寬度重複的取後面那筆
    expect(estimateGifBytes([large, small], 400)).toBeCloseTo(estimateGifBytes([small, large], 400)!, 6);
    expect(estimateGifBytes([{ ...small, bytes: 1 }, small, large], 400)).toBeCloseTo(estimateGifBytes([small, large], 400)!, 6);
    // 超出試編範圍：用最近的兩筆外插
    expect(estimateGifBytes([small, large], 560)).toBeCloseTo(80 * 54000 * (560 / 480) ** k, 6);
  });

  it('試編的結果不合格：略過那一筆；都不合格就不估（null，畫面不顯示數字）', () => {
    const large = { bytes: 8 * 54000, frames: 8, width: 480, height: 672 };
    expect(estimateGifBytes([{ ...sample, bytes: 0 }], 400)).toBeNull();
    expect(estimateGifBytes([{ ...sample, frames: 0 }], 400)).toBeNull();
    expect(estimateGifBytes([{ ...sample, width: 0 }], 400)).toBeNull();
    expect(estimateGifBytes([{ ...sample, height: Number.NaN }], 400)).toBeNull();
    expect(estimateGifBytes([], 400)).toBeNull();
    expect(estimateGifBytes([{ ...sample, bytes: Number.NaN }, large], 480)).toBeCloseTo(80 * 54000, 6);
    expect(estimateGifBytes([sample, large], 0)).toBeNull();
  });

  it('T-512c：輸入都是正的有限數，但算出來溢位（Infinity）或變成 0 → null（不能顯示成「約 1 KB」）', () => {
    const large = { bytes: 8 * 54000, frames: 8, width: 480, height: 672 };
    // 每格大小溢位：bytes ÷ frames＝Infinity
    expect(estimateGifBytes([{ ...sample, bytes: Number.MAX_VALUE, frames: 1e-10 }], 320)).toBeNull();
    expect(estimateGifBytes([{ ...sample, bytes: Number.MAX_VALUE, frames: 1e-10 }, large], 400)).toBeNull();
    // 只有一筆：每像素大小溢位（高度極小）
    expect(estimateGifBytes([{ ...sample, bytes: 1e300, frames: 1, height: 1e-300 }], 320)).toBeNull();
    // 兩筆：每格大小差太多，k＝Infinity
    expect(estimateGifBytes([{ ...sample, bytes: 1e-300, frames: 1 }, { ...large, bytes: 1e300, frames: 1 }], 400)).toBeNull();
    // 每格大小、k 都正常，最後乘上去才溢位
    expect(estimateGifBytes([sample, large], 400, 1e305)).toBeNull();
    expect(estimateGifBytes([sample], 400, 1e305)).toBeNull();
    // 每格大小太小變成 0（下溢）
    expect(estimateGifBytes([{ ...sample, bytes: Number.MIN_VALUE, frames: 1e10 }], 320)).toBeNull();
    // 正常的輸入照舊（負的 k＝越大越省，不算錯）
    expect(estimateGifBytes([sample, { ...large, bytes: 8 * 1000 }], 400)).toBeGreaterThan(0);
  });

  // 審查中②：純色、漸層的卡越大越省，照像素數推會高估 33～50%。用真的 GIF 編碼器核對（±25%）：
  // 「實際」＝每格稍微不一樣的 16 格（像轉動中的卡），試編其中隔一格取的 8 格（同 80 格裡每隔 10 格取 8 格），預估照格數換算。
  // （實際 80 格在 node 編太久；GIF 每格分開壓縮，格數只是乘上去，核對的重點是寬度。）
  describe('低細節的畫面用真的編碼器核對（±25%）', () => {
    const FRAMES = 16;
    /** 第 i 格：卡片比例的畫面；kind＝純色或斜向漸層（每格亮度稍微變，像轉動中）。 */
    function frame(kind: 'solid' | 'gradient', width: number, height: number, i: number): Uint8ClampedArray {
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0, p = 0; y < height; y++) {
        for (let x = 0; x < width; x++, p += 4) {
          const t = kind === 'solid' ? 0.4 : (x / width + y / height) / 2;
          rgba[p] = 30 + 180 * t + 4 * i;
          rgba[p + 1] = 40 + 90 * t;
          rgba[p + 2] = 100 + 120 * (1 - t);
          rgba[p + 3] = 255;
        }
      }
      return rgba;
    }
    const encode = (frames: Uint8ClampedArray[], width: number, height: number) =>
      encodeGifFrames(frames, { width, height, delayMs: 50 }).byteLength;

    for (const kind of ['solid', 'gradient'] as const) {
      for (const ratio of [88 / 63, 120 / 70]) {
        it(`${kind === 'solid' ? '純色' : '漸層'}、${ratio > 1.5 ? '塔羅牌' : '標準卡'}比例`, { timeout: 30_000 }, () => {
          const heightOf = (w: number) => Math.round((w * ratio) / 2) * 2;
          const all = new Map(GIF_SIZES.map((s) => [s.width, Array.from({ length: FRAMES }, (_, i) => frame(kind, s.width, heightOf(s.width), i))]));
          const trials = GIF_ESTIMATE.widths.map((w) => {
            const frames = all.get(w)!.filter((_, i) => i % 2 === 0);
            return { bytes: encode(frames, w, heightOf(w)), frames: frames.length, width: w, height: heightOf(w) };
          });
          for (const s of GIF_SIZES) {
            const actual = encode(all.get(s.width)!, s.width, heightOf(s.width));
            const estimate = estimateGifBytes(trials, s.width, FRAMES)!;
            expect(Math.abs(estimate / actual - 1)).toBeLessThan(0.25);
          }
        });
      }
    }
  });

  it('顯示：約 X.X MB（1 MB＝1024×1024）', () => {
    expect(fileSizeText(4.9 * 1024 * 1024)).toBe('約 4.9 MB');
    expect(fileSizeText(12.34 * 1024 * 1024)).toBe('約 12.3 MB');
    expect(fileSizeText(0.25 * 1024 * 1024)).toBe('約 0.3 MB');
    // 很小的檔：用 KB
    expect(fileSizeText(40 * 1024)).toBe('約 40 KB');
  });

  it('估算中與說明', () => {
    expect(GIF_ESTIMATING_TEXT).toBe('估算中…');
    expect(GIF_ESTIMATE_NOTE).toContain('估');
  });

  it('畫面上的字沒有技術名詞', () => {
    const texts = [
      ...MOTIONS.map(motionLabel),
      SWING_NOTE_TEXT,
      NOD_NOTE_TEXT,
      ...GIF_SIZES.map((s) => gifSizeLabel(s.size)),
      GIF_ESTIMATING_TEXT,
      GIF_ESTIMATE_NOTE,
      ...[1, 2, 3].flatMap((n) => Object.values(videoLengthOption(n as 1 | 2 | 3, 'swing'))),
    ];
    for (const t of texts) expect(t).not.toMatch(/swing|yaw|編碼|像素|位元組|bytes|sample|LZW|調色盤/i);
  });
});
