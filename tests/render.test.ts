import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT } from '../src/model/types';
import { boundingRadius, cameraDistance, cardBox, cardOutline, coverUv, fitDistance, frameInner, layerSize, roundedRectSdf } from '../src/render/fit';
import { packRows } from '../src/render/pixels';

const rad = (deg: number) => (deg * Math.PI) / 180;
const STANDARD_H = 88 / 63;
const TAROT_H = 120 / 70;

describe('鏡頭距離：卡片永遠完整可見', () => {
  it('寬畫面由垂直視角決定', () => {
    expect(fitDistance(30, 16 / 9, 1)).toBeCloseTo(1 / Math.sin(rad(15)), 10);
  });

  it('窄畫面由水平視角決定，所以要退更遠', () => {
    expect(fitDistance(30, 0.5, 1)).toBeGreaterThan(fitDistance(30, 2, 1));
    const halfH = Math.atan(Math.tan(rad(15)) * 0.5);
    expect(fitDistance(30, 0.5, 1)).toBeCloseTo(1 / Math.sin(halfH), 10);
  });

  it('最近（zoom 1）時，包住卡片的球剛好在畫面內；zoom 越小越遠', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const near = cameraDistance(30, 1.5, 1, cardBox(ASPECT_HEIGHT[aspect]));
      expect(Math.asin(boundingRadius(cardBox(ASPECT_HEIGHT[aspect])) / near)).toBeLessThanOrEqual(rad(15) + 1e-12);
      expect(cameraDistance(30, 1.5, 0.5, cardBox(ASPECT_HEIGHT[aspect]))).toBeCloseTo(near * 2, 10);
    }
  });

  it('塔羅比例比較高，鏡頭要退得比標準卡遠', () => {
    expect(boundingRadius(cardBox(ASPECT_HEIGHT.tarot))).toBeGreaterThan(boundingRadius(cardBox(ASPECT_HEIGHT.standard)));
    expect(cameraDistance(30, 1.5, 1, cardBox(ASPECT_HEIGHT.tarot))).toBeGreaterThan(cameraDistance(30, 1.5, 1, cardBox(ASPECT_HEIGHT.standard)));
  });
});

describe('卡片尺寸（以卡寬為 1）', () => {
  it('標準卡 63:88、塔羅 70:120', () => {
    expect(ASPECT_HEIGHT.standard).toBeCloseTo(STANDARD_H, 12);
    expect(ASPECT_HEIGHT.tarot).toBeCloseTo(TAROT_H, 12);
  });

  it('包住卡片的球半徑含厚度', () => {
    expect(boundingRadius(cardBox(ASPECT_HEIGHT.tarot))).toBeCloseTo(Math.hypot(0.5, TAROT_H / 2, 0.015 / 2), 12);
  });

  it('卡片輪廓：半寬 0.5、半高照比例、圓角照設定', () => {
    expect(cardOutline(ASPECT_HEIGHT.tarot, 0.12)).toEqual({ halfW: 0.5, halfH: TAROT_H / 2, r: 0.12 });
    expect(cardOutline(ASPECT_HEIGHT.standard, 0)).toEqual({ halfW: 0.5, halfH: STANDARD_H / 2, r: 0 });
  });

  it('圓角超出 0～0.12 時夾回範圍（壞資料不讓網格變形）', () => {
    expect(cardOutline(ASPECT_HEIGHT.standard, 0.5).r).toBe(0.12);
    expect(cardOutline(ASPECT_HEIGHT.standard, -1).r).toBe(0);
  });
});

describe('圓角矩形距離（卡片輪廓、卡框內緣都用這個）', () => {
  const rect = { halfW: 0.5, halfH: 0.7, r: 0.1 };

  it('裡面是負的、外面是正的、邊上是 0', () => {
    expect(roundedRectSdf(0, 0, rect)).toBeLessThan(0);
    expect(roundedRectSdf(0.5, 0, rect)).toBeCloseTo(0, 12);
    expect(roundedRectSdf(0, 0.7, rect)).toBeCloseTo(0, 12);
    expect(roundedRectSdf(0.6, 0, rect)).toBeCloseTo(0.1, 12);
  });

  it('角落被圓角切掉：方角的頂點在外面，圓弧上剛好是 0', () => {
    expect(roundedRectSdf(0.5, 0.7, rect)).toBeGreaterThan(0);
    const c = Math.SQRT1_2 * 0.1;
    expect(roundedRectSdf(0.4 + c, 0.6 + c, rect)).toBeCloseTo(0, 12);
  });

  it('圓角 0：方角頂點剛好在邊上', () => {
    expect(roundedRectSdf(0.5, 0.7, { ...rect, r: 0 })).toBeCloseTo(0, 12);
  });
});

describe('卡框內緣', () => {
  it('外緣＝卡片輪廓、往內縮 width；內緣圓角＝圓角 − width', () => {
    const inner = frameInner(cardOutline(ASPECT_HEIGHT.standard, 0.05), 0.03);
    expect(inner.halfW).toBeCloseTo(0.47, 12);
    expect(inner.halfH).toBeCloseTo(STANDARD_H / 2 - 0.03, 12);
    expect(inner.r).toBeCloseTo(0.02, 12);
  });

  it('寬度比圓角大時內緣是方角（不會是負的圓角）', () => {
    expect(frameInner(cardOutline(ASPECT_HEIGHT.standard, 0.02), 0.05).r).toBe(0);
    expect(frameInner(cardOutline(ASPECT_HEIGHT.standard, 0), 0.08).r).toBe(0);
  });

  it('卡框寬度處處相同：直邊和圓角的地方都剛好寬 width', () => {
    const outline = cardOutline(ASPECT_HEIGHT.tarot, 0.12);
    const inner = frameInner(outline, 0.04);
    // 右邊中點往內 0.04 剛好在內緣上
    expect(roundedRectSdf(0.5 - 0.04, 0, inner)).toBeCloseTo(0, 12);
    // 45° 角：外緣圓弧上的點往圓心方向 0.04 也剛好在內緣上
    const cx = outline.halfW - outline.r;
    const cy = outline.halfH - outline.r;
    const d = Math.SQRT1_2 * (outline.r - 0.04);
    expect(roundedRectSdf(cx + d, cy + d, inner)).toBeCloseTo(0, 12);
  });
});

describe('cover 貼圖（素色卡背紋樣貼滿卡面）', () => {
  it('同比例：不裁', () => {
    const uv = coverUv(1008, 1408, 1, 1408 / 1008);
    expect(uv.scaleX).toBeCloseTo(1, 12);
    expect(uv.scaleY).toBeCloseTo(1, 12);
    expect(uv.offsetX).toBeCloseTo(0, 12);
    expect(uv.offsetY).toBeCloseTo(0, 12);
  });

  it('卡面比圖瘦長（塔羅）：上下貼滿、左右裁掉，保持長寬比、置中', () => {
    const uv = coverUv(1008, 1408, 1, TAROT_H);
    expect(uv.scaleY).toBe(1);
    expect(uv.scaleX).toBeLessThan(1);
    // 卡面看到的圖區域長寬比＝卡面長寬比
    expect((uv.scaleY * 1408) / (uv.scaleX * 1008)).toBeCloseTo(TAROT_H, 12);
    expect(uv.offsetX).toBeCloseTo((1 - uv.scaleX) / 2, 12);
    expect(uv.offsetY).toBe(0);
  });

  it('橫的圖：上下貼滿、左右裁；比卡面瘦高的圖：左右貼滿、上下裁', () => {
    const wide = coverUv(1000, 400, 1, STANDARD_H);
    expect(wide.scaleY).toBe(1);
    expect(wide.scaleX).toBeLessThan(1);
    const tall = coverUv(400, 1000, 1, 1);
    expect(tall.scaleX).toBe(1);
    expect(tall.scaleY).toBeCloseTo(0.4, 12);
    expect(tall.offsetY).toBeCloseTo(0.3, 12);
  });
});

describe('擷取畫面的像素整理', () => {
  // 2×2：第 0 列紅、綠；第 1 列藍、白
  const tight = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);

  it('緊密排列、不翻轉 → 原樣', () => {
    expect(Array.from(packRows(tight, 2, 2, false))).toEqual(Array.from(tight));
  });

  it('翻轉 → 列順序上下顛倒', () => {
    expect(Array.from(packRows(tight, 2, 2, true))).toEqual([
      0, 0, 255, 255, 255, 255, 255, 255,
      255, 0, 0, 255, 0, 255, 0, 255,
    ]);
  });

  it('WebGPU 每列補齊到 256 位元組 → 去掉補的部分', () => {
    const stride = 256;
    const padded = new Uint8Array(stride + 8); // 最後一列不補
    padded.set(tight.subarray(0, 8), 0);
    padded.set(tight.subarray(8, 16), stride);
    expect(Array.from(packRows(padded, 2, 2, false))).toEqual(Array.from(tight));
  });
});

describe('圖層大小（卡寬單位）', () => {
  it('scale 1：圖寬等於卡寬，高度照圖片比例', () => {
    const size = layerSize(1008, 1408);
    expect(size.w).toBe(1);
    expect(size.h).toBeCloseTo(STANDARD_H, 10);
  });

  it('有出血的圖（四邊各多 61px）用 scale 放大後，中央剛好對齊卡片', () => {
    const size = layerSize(1130, 1530, 1130 / 1008);
    expect(size.w).toBeCloseTo(1130 / 1008, 10);
    expect(size.h).toBeCloseTo(1530 / 1008, 10);
    // 上下各多出 61px（以 1008px＝卡寬換算）
    expect((size.h - STANDARD_H) / 2).toBeCloseTo(61 / 1008, 10);
  });

  it('scale 0.5：寬高都減半', () => {
    expect(layerSize(800, 400, 0.5)).toEqual({ w: 0.5, h: 0.25 });
  });
});
