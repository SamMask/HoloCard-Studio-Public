import { describe, expect, it } from 'vitest';
import { fitWithin } from '../../src/images/fit';

describe('fitWithin', () => {
  it('最長邊剛好等於上限 → 原樣', () => {
    expect(fitWithin(2048, 1024, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitWithin(1024, 2048, 2048)).toEqual({ width: 1024, height: 2048 });
    expect(fitWithin(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it('最長邊多 1（2049）→ 縮到 2048', () => {
    expect(fitWithin(2049, 2049, 2048)).toEqual({ width: 2048, height: 2048 });
    const r = fitWithin(2049, 1000, 2048);
    expect(r.width).toBe(2048);
    expect(r.height).toBe(Math.round((1000 * 2048) / 2049));
  });

  it('橫圖：寬是最長邊，等比縮', () => {
    expect(fitWithin(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitWithin(3000, 2000, 2048)).toEqual({ width: 2048, height: 1365 });
  });

  it('直圖：高是最長邊，等比縮', () => {
    expect(fitWithin(2048, 4096, 2048)).toEqual({ width: 1024, height: 2048 });
    expect(fitWithin(2000, 3000, 2048)).toEqual({ width: 1365, height: 2048 });
  });

  it('很小的圖不放大', () => {
    expect(fitWithin(10, 20, 2048)).toEqual({ width: 10, height: 20 });
    expect(fitWithin(1, 1, 2048)).toEqual({ width: 1, height: 1 });
  });

  it('極端細長：縮完短邊至少 1', () => {
    expect(fitWithin(10000, 1, 2048)).toEqual({ width: 2048, height: 1 });
    expect(fitWithin(1, 10000, 2048)).toEqual({ width: 1, height: 2048 });
  });

  it('結果一律是整數', () => {
    const r = fitWithin(3333, 777, 2048);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
  });
});
