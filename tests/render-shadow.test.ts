// 景深陰影的純函式：depth → 影子偏移、柔邊、濃度；柔邊寬度 → 貼圖模糊等級。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHADOW_FACTORS,
  layerShadow,
  shadowFactors,
  SHADOW_DIRECTION,
  SHADOW_MAX_BLUR,
  SHADOW_MAX_OFFSET,
  SHADOW_MAX_STRENGTH,
  shadowMipLevel,
} from '../src/render/shadow';

const len = (x: number, y: number) => Math.hypot(x, y);

describe('depth → 影子', () => {
  it('depth 0（底圖）沒有影子', () => {
    const s = layerShadow(0);
    expect(s.strength).toBe(0);
    expect(len(s.offsetX, s.offsetY)).toBe(0);
  });

  it('壞資料（負數、NaN、無限大）不會讓 shader 拿到 NaN 或超出範圍', () => {
    for (const d of [-20, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const s = layerShadow(d);
      expect(s.strength).toBe(0);
      expect(len(s.offsetX, s.offsetY)).toBe(0);
    }
    const big = layerShadow(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(big.blur)).toBe(true);
    expect(big.strength).toBeLessThanOrEqual(SHADOW_MAX_STRENGTH);
  });

  it('越深 → 離得越遠、越散、越濃（越大越多）', () => {
    let prev = layerShadow(1);
    expect(prev.strength).toBeGreaterThan(0);
    for (let d = 2; d <= 100; d++) {
      const s = layerShadow(d);
      expect(len(s.offsetX, s.offsetY)).toBeGreaterThan(len(prev.offsetX, prev.offsetY));
      expect(s.blur).toBeGreaterThan(prev.blur);
      expect(s.strength).toBeGreaterThanOrEqual(prev.strength);
      prev = s;
    }
    expect(layerShadow(90).strength).toBeGreaterThan(layerShadow(30).strength);
  });

  it('上限：depth 100 剛好到上限，超過 100 也不再增加；最深處壓暗 25～35%', () => {
    const top = layerShadow(100);
    expect(len(top.offsetX, top.offsetY)).toBeCloseTo(SHADOW_MAX_OFFSET, 12);
    expect(top.blur).toBeCloseTo(SHADOW_MAX_BLUR, 12);
    expect(top.strength).toBeCloseTo(SHADOW_MAX_STRENGTH, 12);
    expect(layerShadow(250)).toEqual(top);
    expect(SHADOW_MAX_STRENGTH).toBeGreaterThanOrEqual(0.25);
    expect(SHADOW_MAX_STRENGTH).toBeLessThanOrEqual(0.35);
  });

  it('偏移和 depth 成正比（shader 用這點換算「影子落在後面那一層」的位置）', () => {
    const a = layerShadow(20);
    const b = layerShadow(80);
    expect(b.offsetX).toBeCloseTo(a.offsetX * 4, 12);
    expect(b.offsetY).toBeCloseTo(a.offsetY * 4, 12);
  });
});

describe('使用者調的陰影（T-310）：濃淡、距離 0～100 → 倍數 0～2，50＝原本的效果', () => {
  it('50／50＝倍數 1，和不給一樣（原本 T-302 的效果）', () => {
    expect(shadowFactors({ strength: 50, distance: 50 })).toEqual({ strength: 1, distance: 1 });
    expect(DEFAULT_SHADOW_FACTORS).toEqual({ strength: 1, distance: 1 });
    for (const d of [1, 20, 50, 90, 100]) expect(layerShadow(d, shadowFactors({ strength: 50, distance: 50 }))).toEqual(layerShadow(d));
  });

  it('0～100 線性對到 0～2；超出範圍夾回、不是數字當 50（原本的效果）', () => {
    expect(shadowFactors({ strength: 0, distance: 100 })).toEqual({ strength: 0, distance: 2 });
    expect(shadowFactors({ strength: 100, distance: 0 })).toEqual({ strength: 2, distance: 0 });
    expect(shadowFactors({ strength: 25, distance: 75 })).toEqual({ strength: 0.5, distance: 1.5 });
    expect(shadowFactors({ strength: 300, distance: -5 })).toEqual({ strength: 2, distance: 0 });
    expect(shadowFactors({ strength: Number.NaN, distance: Number.POSITIVE_INFINITY })).toEqual({ strength: 1, distance: 1 });
  });

  it('濃淡 0＝完全沒有影子（任何深度），只影響濃度、不影響位置與柔邊', () => {
    const none = shadowFactors({ strength: 0, distance: 50 });
    for (const d of [1, 50, 100]) {
      const s = layerShadow(d, none);
      expect(s.strength).toBe(0);
      expect(s.offsetX).toBeCloseTo(layerShadow(d).offsetX, 12);
      expect(s.blur).toBeCloseTo(layerShadow(d).blur, 12);
    }
  });

  it('濃淡 100＝兩倍濃（最深處壓暗 60%，還不到全黑）', () => {
    const top = layerShadow(100, shadowFactors({ strength: 100, distance: 50 }));
    expect(top.strength).toBeCloseTo(SHADOW_MAX_STRENGTH * 2, 12);
    expect(top.strength).toBeLessThan(0.7);
    expect(layerShadow(30, shadowFactors({ strength: 100, distance: 50 })).strength).toBeCloseTo(layerShadow(30).strength * 2, 12);
  });

  it('距離 0＝影子貼在圖層正下方（不偏移、不散開）；100＝偏移與柔邊都是兩倍', () => {
    const near = layerShadow(80, shadowFactors({ strength: 50, distance: 0 }));
    expect(near.offsetX).toBe(0);
    expect(near.offsetY).toBe(0);
    expect(near.blur).toBe(0);
    expect(near.strength).toBeCloseTo(layerShadow(80).strength, 12);
    const far = layerShadow(80, shadowFactors({ strength: 50, distance: 100 }));
    expect(far.offsetX).toBeCloseTo(layerShadow(80).offsetX * 2, 12);
    expect(far.offsetY).toBeCloseTo(layerShadow(80).offsetY * 2, 12);
    expect(far.blur).toBeCloseTo(layerShadow(80).blur * 2, 12);
  });

  it('調了距離，偏移仍和 depth 成正比、方向不變（card-mesh 依賴這點）', () => {
    const k = shadowFactors({ strength: 70, distance: 85 });
    const a = layerShadow(20, k);
    const b = layerShadow(80, k);
    expect(b.offsetX).toBeCloseTo(a.offsetX * 4, 12);
    expect(b.offsetY).toBeCloseTo(a.offsetY * 4, 12);
    const l = len(b.offsetX, b.offsetY);
    expect(b.offsetX / l).toBeCloseTo(SHADOW_DIRECTION.x, 12);
  });
});

describe('影子方向固定（卡面座標：光從左上來 → 影子往右下）', () => {
  it('方向是單位向量，朝右（+x）朝下（−y）', () => {
    expect(len(SHADOW_DIRECTION.x, SHADOW_DIRECTION.y)).toBeCloseTo(1, 12);
    expect(SHADOW_DIRECTION.x).toBeGreaterThan(0);
    expect(SHADOW_DIRECTION.y).toBeLessThan(0);
  });

  it('不管多深，偏移方向都一樣', () => {
    for (const d of [1, 13, 50, 77, 100]) {
      const s = layerShadow(d);
      const l = len(s.offsetX, s.offsetY);
      expect(s.offsetX / l).toBeCloseTo(SHADOW_DIRECTION.x, 12);
      expect(s.offsetY / l).toBeCloseTo(SHADOW_DIRECTION.y, 12);
    }
  });
});

describe('柔邊寬度 → 貼圖模糊等級（mip level）', () => {
  it('柔邊不到一個像素 → 0（原圖）', () => {
    expect(shadowMipLevel(0, 1000, 1)).toBe(0);
    expect(shadowMipLevel(0.0005, 1000, 1)).toBe(0);
  });

  it('等級＝log2(柔邊寬度佔幾個像素)：同樣的卡面寬度，圖越大等級越高', () => {
    expect(shadowMipLevel(0.016, 1000, 1)).toBeCloseTo(4, 12); // 16 像素
    expect(shadowMipLevel(0.016, 2000, 1)).toBeCloseTo(5, 12);
    // 圖層放大 2 倍 → 卡面上同樣寬度只佔一半的像素
    expect(shadowMipLevel(0.016, 1000, 2)).toBeCloseTo(3, 12);
  });

  it('壞數字回 0', () => {
    expect(shadowMipLevel(0.02, 0, 1)).toBe(0);
    expect(shadowMipLevel(0.02, 1000, 0)).toBe(0);
    expect(shadowMipLevel(Number.NaN, 1000, 1)).toBe(0);
  });
});
