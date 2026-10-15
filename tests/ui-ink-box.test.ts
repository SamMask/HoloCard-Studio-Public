import { describe, expect, it } from 'vitest';
import { inkBoxFromAlpha } from '../src/images/registry';

/** w×h 的 RGBA 圖：rects 裡的範圍 alpha＝a，其他透明。 */
function image(w: number, h: number, rects: { x0: number; y0: number; x1: number; y1: number; a?: number }[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) data[(y * w + x) * 4 + 3] = r.a ?? 255;
    }
  }
  return data;
}

describe('文字圖層的字在圖裡佔多少（從 alpha 算，以圖中心對稱的比例）', () => {
  it('字在正中間：寬高比例就是字的範圍', () => {
    // 100×20 的圖，字在 x 40～60、y 0～20
    const box = inkBoxFromAlpha(image(100, 20, [{ x0: 40, y0: 0, x1: 60, y1: 20 }]), 100, 20);
    expect(box).toEqual({ w: 0.2, h: 1 });
  });

  it('字偏一邊：框以圖中心對稱，取比較遠的那一邊（才不會切到字）', () => {
    // x 30～55：左邊離中心 20、右邊 5 → 寬＝2×20/100
    const box = inkBoxFromAlpha(image(100, 10, [{ x0: 30, y0: 2, x1: 55, y1: 8 }]), 100, 10);
    expect(box!.w).toBeCloseTo(0.4);
    expect(box!.h).toBeCloseTo(0.6);
  });

  it('幾乎透明的雜點（alpha ≤ 8）不算字', () => {
    const box = inkBoxFromAlpha(
      image(100, 10, [
        { x0: 0, y0: 0, x1: 100, y1: 10, a: 8 },
        { x0: 45, y0: 0, x1: 55, y1: 10 },
      ]),
      100,
      10,
    );
    expect(box).toEqual({ w: 0.1, h: 1 });
  });

  it('整張透明：undefined（交給呼叫端用整張圖的框）', () => {
    expect(inkBoxFromAlpha(image(10, 10, []), 10, 10)).toBeUndefined();
  });

  it('長寬不合理：undefined', () => {
    expect(inkBoxFromAlpha(new Uint8ClampedArray(0), 0, 0)).toBeUndefined();
  });
});
