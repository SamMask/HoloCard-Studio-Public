// T-835（DESIGN §5.2「預覽區下方工具列」）：〔−〕{縮放比例}〔＋〕的純函式。
// 縮放比例和滾輪是同一個值（view.zoom，0.45～1、預設 0.85）；顯示成「預設大小＝100%」的整數百分比；
// 每按一下 10%（照百分比換算回 zoom、夾範圍）；到上下限那顆按鈕變淡。
import { describe, expect, it } from 'vitest';
import {
  canZoomStep,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_PERCENT,
  zoomByKey,
  zoomByStep,
  zoomByWheel,
  zoomPercent,
} from '../src/interact/view';

describe('縮放比例：預設大小＝100%（T-835）', () => {
  it('預設 0.85 → 100%；整數', () => {
    expect(zoomPercent(ZOOM_DEFAULT)).toBe(100);
    expect(zoomPercent(0.765)).toBe(90);
    expect(Number.isInteger(zoomPercent(0.8123))).toBe(true);
  });

  it('上下限：最遠 0.45 → 53%、最近 1 → 118%', () => {
    expect(zoomPercent(ZOOM_MIN)).toBe(53);
    expect(zoomPercent(ZOOM_MAX)).toBe(118);
  });

  it('滾輪改的值也照同一個換算（滾輪與按鈕同一個值）', () => {
    const z = zoomByWheel(ZOOM_DEFAULT, -100);
    expect(z).toBeGreaterThan(ZOOM_DEFAULT);
    expect(zoomPercent(z)).toBe(Math.round((z / ZOOM_DEFAULT) * 100));
  });
});

describe('按一下 10%（T-835）', () => {
  it('從 100% 往上：110% → 到最近（118%）停住', () => {
    expect(ZOOM_STEP_PERCENT).toBe(10);
    const a = zoomByStep(ZOOM_DEFAULT, 1);
    expect(zoomPercent(a)).toBe(110);
    expect(a).toBeCloseTo(ZOOM_DEFAULT * 1.1, 10);
    const b = zoomByStep(a, 1);
    expect(b).toBe(ZOOM_MAX);
    expect(zoomByStep(b, 1)).toBe(ZOOM_MAX);
  });

  it('從 100% 往下：90、80、70、60 → 到最遠（53%）停住', () => {
    let z = ZOOM_DEFAULT;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      z = zoomByStep(z, -1);
      seen.push(zoomPercent(z));
    }
    expect(seen).toEqual([90, 80, 70, 60, 53, 53]);
    expect(z).toBe(ZOOM_MIN);
  });

  it('滾輪調到不是整十的數（例如 87%）：按〔＋〕到 90%、按〔−〕到 80%（停在整十上）', () => {
    const z = (87 / 100) * ZOOM_DEFAULT;
    expect(zoomPercent(zoomByStep(z, 1))).toBe(90);
    expect(zoomPercent(zoomByStep(z, -1))).toBe(80);
  });

  it('最遠 53% 按〔＋〕到 60%；最近 118% 按〔−〕到 110%', () => {
    expect(zoomPercent(zoomByStep(ZOOM_MIN, 1))).toBe(60);
    expect(zoomPercent(zoomByStep(ZOOM_MAX, -1))).toBe(110);
  });

  it('來回按會回到原本的整十（浮點誤差不會讓 90% 變 89%）', () => {
    let z = ZOOM_DEFAULT;
    for (let i = 0; i < 4; i++) z = zoomByStep(z, -1);
    for (let i = 0; i < 4; i++) z = zoomByStep(z, 1);
    expect(zoomPercent(z)).toBe(100);
    expect(z).toBeCloseTo(ZOOM_DEFAULT, 10);
  });

  it('一律夾在 ZOOM_MIN～ZOOM_MAX', () => {
    for (let p = 40; p <= 130; p += 3) {
      const z = (p / 100) * ZOOM_DEFAULT;
      for (const dir of [1, -1] as const) {
        const next = zoomByStep(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)), dir);
        expect(next).toBeGreaterThanOrEqual(ZOOM_MIN);
        expect(next).toBeLessThanOrEqual(ZOOM_MAX);
      }
    }
  });
});

describe('到上下限那顆按鈕變淡（T-835）', () => {
  it('最近：〔＋〕不能按、〔−〕可以；最遠：反過來；中間都可以', () => {
    expect(canZoomStep(ZOOM_MAX, 1)).toBe(false);
    expect(canZoomStep(ZOOM_MAX, -1)).toBe(true);
    expect(canZoomStep(ZOOM_MIN, -1)).toBe(false);
    expect(canZoomStep(ZOOM_MIN, 1)).toBe(true);
    expect(canZoomStep(ZOOM_DEFAULT, 1)).toBe(true);
    expect(canZoomStep(ZOOM_DEFAULT, -1)).toBe(true);
  });

  it('鍵盤縮到底（zoomByKey）也算到了上限', () => {
    let z = ZOOM_DEFAULT;
    for (let i = 0; i < 20; i++) z = zoomByKey(z, 1);
    expect(canZoomStep(z, 1)).toBe(false);
    for (let i = 0; i < 40; i++) z = zoomByKey(z, -1);
    expect(canZoomStep(z, -1)).toBe(false);
  });
});
