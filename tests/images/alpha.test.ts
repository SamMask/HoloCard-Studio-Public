import { describe, expect, it } from 'vitest';
import { hasTransparency } from '../../src/images/alpha';

/** 做一個 n 個像素、全部 RGBA 都是同一個 alpha 的陣列。 */
function pixels(n: number, alpha: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4).fill(255);
  for (let i = 0; i < n; i++) data[i * 4 + 3] = alpha;
  return data;
}

describe('hasTransparency', () => {
  it('全部不透明（alpha 255）→ false', () => {
    expect(hasTransparency(pixels(16, 255))).toBe(false);
  });

  it('有一個像素 alpha 249 → true', () => {
    const data = pixels(16, 255);
    data[7 * 4 + 3] = 249;
    expect(hasTransparency(data)).toBe(true);
  });

  it('alpha 剛好 250 算不透明 → false', () => {
    expect(hasTransparency(pixels(16, 250))).toBe(false);
  });

  it('全透明（alpha 0）→ true', () => {
    expect(hasTransparency(pixels(4, 0))).toBe(true);
  });

  it('空陣列 → false', () => {
    expect(hasTransparency(new Uint8ClampedArray(0))).toBe(false);
  });

  it('只看每 4 個位元組的第 4 個（R、G、B 很小不算透明）', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 1, 2, 3, 255]);
    expect(hasTransparency(data)).toBe(false);
  });

  it('接受 Uint8Array', () => {
    expect(hasTransparency(new Uint8Array([10, 20, 30, 249]))).toBe(true);
    expect(hasTransparency(new Uint8Array([10, 20, 30, 250]))).toBe(false);
  });

  it('透明像素在最後一個也找得到', () => {
    const data = pixels(1000, 255);
    data[999 * 4 + 3] = 0;
    expect(hasTransparency(data)).toBe(true);
  });
});
