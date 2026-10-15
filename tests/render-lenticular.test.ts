// T-805 雙圖光柵的純數學（render/lenticular.ts）：固定參數、切換比例 t（正面＝本來的圖、±20°＝變身圖、
// 約 7° 時條紋交錯、從一邊掃到另一邊）、切換中間的暗度、哪些層要畫變身圖。著色程式（lenticular-nodes.ts）是同一個式子，
// GPU 上的結果在 tests/gpu/blend-gpu.ts 第 10 段對照。
import { describe, expect, it } from 'vitest';
import { viewDirection } from '../src/render/holo';
import { altOn, lensAngle, lensDim, lensMix, LENTICULAR } from '../src/render/lenticular';
import type { Layer } from '../src/model/types';

const view = (yaw: number, face: 'front' | 'back' = 'front') => viewDirection(face, yaw, 0);
const mixAt = (yaw: number, u: number, face: 'front' | 'back' = 'front') => {
  const v = view(yaw, face);
  return lensMix(v.x, v.z, u);
};
/** 卡寬上 1200 個點（每條條紋 10 個點）。 */
const us = Array.from({ length: 1201 }, (_, i) => i / 1200);

describe('固定參數（DESIGN：參考專案的預設，不給使用者調）', () => {
  it('切換角度 14°、柔和度 0.22、條紋 120 條、條紋強度 0.35、掃過 6°', () => {
    expect(LENTICULAR).toMatchObject({ flipAngle: 14, softness: 0.22, pitch: 120, stripe: 0.35, sweep: 6 });
  });
});

describe('lensAngle：看這一面的角度＋橫向位置的偏移', () => {
  it('正面看、卡片中間＝0；往右轉 yaw 度＝−yaw（帶正負）；兩邊各差 sweep/2', () => {
    expect(lensAngle(0, 1, 0.5)).toBeCloseTo(0, 9);
    const v = view(10);
    expect(lensAngle(v.x, v.z, 0.5)).toBeCloseTo(-10, 6);
    expect(lensAngle(v.x, v.z, 0) - lensAngle(v.x, v.z, 1)).toBeCloseTo(-LENTICULAR.sweep, 6);
  });

  it('俯仰不影響（只看左右轉）', () => {
    const v = viewDirection('front', 12, -25);
    expect(lensAngle(v.x, v.z, 0.5)).toBeCloseTo(-12, 6);
  });
});

describe('lensMix：0＝本來的圖、1＝變身圖', () => {
  it('正對著看：卡片中間完全是本來的圖，整張卡最多 1% 混到變身圖', () => {
    expect(mixAt(0, 0.5)).toBe(0);
    expect(Math.max(...us.map((u) => mixAt(0, u)))).toBeLessThan(0.01);
  });

  it('往左或往右轉 20°：整張都是變身圖', () => {
    for (const yaw of [20, -20, 35]) expect(Math.min(...us.map((u) => mixAt(yaw, u)))).toBe(1);
  });

  it('約 7°（切換角度的一半）：同一張卡上兩張都有，而且是細條紋交錯（不是只有一條分界線）', () => {
    for (const yaw of [7, -7]) {
      const t = us.map((u) => mixAt(yaw, u));
      expect(Math.min(...t)).toBeLessThan(0.05);
      expect(Math.max(...t)).toBeGreaterThan(0.95);
      // 由 A 為主換到 B 為主（或反過來）的次數：條紋讓它來回好幾次
      let flips = 0;
      for (let i = 1; i < t.length; i++) if (t[i - 1]! < 0.5 !== t[i]! < 0.5) flips++;
      expect(flips).toBeGreaterThan(10);
    }
  });

  it('換的那一下從一邊掃到另一邊：往右轉 6° 時左邊已經大半換了、右邊還是本來的圖', () => {
    const left = us.filter((u) => u < 0.1).map((u) => mixAt(6, u));
    const right = us.filter((u) => u > 0.9).map((u) => mixAt(6, u));
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(left)).toBeGreaterThan(0.6);
    expect(mean(right)).toBeLessThan(0.15);
  });

  it('往右轉：角度越大、換得越多（卡片左邊、中間、右邊各取一點）', () => {
    for (const u of [0.13, 0.5, 0.871]) {
      let last = -1;
      for (let yaw = 0; yaw <= 20; yaw += 0.5) {
        const t = mixAt(yaw, u);
        expect(t).toBeGreaterThanOrEqual(last - 1e-12);
        last = t;
      }
    }
  });

  it('背面照背面那一面的角度算：正對背面＝本來的圖、背面左右轉 20°＝變身圖', () => {
    expect(mixAt(180, 0.5, 'back')).toBe(0);
    expect(mixAt(160, 0.5, 'back')).toBe(1);
    expect(mixAt(200, 0.5, 'back')).toBe(1);
  });

  it('看到側面以後（z ≤ 0.05）照 0.05 算，不會除以 0', () => {
    expect(mixAt(90, 0.5)).toBe(1);
    expect(Number.isFinite(lensMix(0, 0, 0.5))).toBe(true);
  });
});

describe('lensDim：切換中間稍微變暗', () => {
  it('兩端 0、中間最暗（＝dim）、不刺眼（< 0.1）', () => {
    expect(lensDim(0)).toBe(0);
    expect(lensDim(1)).toBe(0);
    expect(lensDim(0.5)).toBeCloseTo(LENTICULAR.dim, 12);
    expect(lensDim(0.25)).toBeLessThan(lensDim(0.5));
    // 照參考專案原式的三角形 (1 − |2·mix − 1|) × dim（T-805 審查：不換成平滑曲線）
    expect(lensDim(0.25)).toBeCloseTo(LENTICULAR.dim * 0.5, 12);
    expect(lensDim(0.75)).toBeCloseTo(LENTICULAR.dim * 0.5, 12);
    expect(lensDim(0.1)).toBeCloseTo(LENTICULAR.dim * 0.2, 12);
    expect(LENTICULAR.dim).toBeGreaterThan(0);
    expect(LENTICULAR.dim).toBeLessThan(0.1);
  });
});

describe('altOn：哪些層要畫變身圖', () => {
  const layer = (over: Partial<Layer>): Layer => ({
    id: 'l',
    name: 'l',
    role: 'depth',
    image: '0000000000000001',
    visible: true,
    depth: 50,
    x: 0,
    y: 0,
    scale: 1,
    holo: true,
    hasAlpha: true,
    ...over,
  });
  const alt = { image: '0000000000000002', hasAlpha: true };
  it('立體層有變身圖才畫；沒有、底圖、文字層、破框層不畫', () => {
    expect(altOn(layer({ alt }))).toBe(true);
    expect(altOn(layer({}))).toBe(false);
    expect(altOn(layer({ alt, role: 'base' }))).toBe(false);
    expect(altOn(layer({ alt, breakout: true }))).toBe(false);
    expect(altOn(layer({ alt, text: { content: 'a', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'plain' } }))).toBe(false);
  });
});
