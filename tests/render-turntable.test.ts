import { Group, PerspectiveCamera, Vector3 } from 'three';
import { ASPECT_HEIGHT } from '../src/model/types';
import { describe, expect, it } from 'vitest';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline } from '../src/render/fit';
import { CAPTURE_MARGIN, turntableFrame, type CaptureFrame, type PickScene } from '../src/render/pick';
import { packRows } from '../src/render/pixels';

function scene(pitchDeg: number, aspect: 'standard' | 'tarot' = 'standard'): PickScene {
  return {
    vFovDeg: 30, viewAspect: 1.6, cameraZ: cameraDistance(30, 1.6, 1, cardBox(ASPECT_HEIGHT[aspect])),
    yawDeg: 37, pitchDeg, outline: cardOutline(ASPECT_HEIGHT[aspect], 0.05), thickness: CARD_THICKNESS,
  };
}

function corners(s: PickScene, f: CaptureFrame, yaw: number) {
  const camera = new PerspectiveCamera(s.vFovDeg, s.viewAspect, 0.05, 100);
  camera.position.z = s.cameraZ;
  const v = f.viewOffset;
  camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  camera.updateMatrixWorld();
  const group = new Group();
  group.rotation.set(s.pitchDeg * Math.PI / 180, yaw * Math.PI / 180, 0);
  group.updateMatrixWorld();
  const points: { x: number; y: number }[] = [];
  for (const x of [-s.outline.halfW, s.outline.halfW])
    for (const y of [-s.outline.halfH, s.outline.halfH])
      for (const z of [-s.thickness / 2, s.thickness / 2]) {
        const p = new Vector3(x, y, z).applyMatrix4(group.matrixWorld).project(camera);
        points.push({ x: (p.x + 1) * f.width / 2, y: (1 - p.y) * f.height / 2 });
      }
  return points;
}

describe('整圈固定外框', () => {
  it.each([5, 30, 32, 60])('擺動 ±%d°：裁切寬度較小且包住兩端、正面與中間每個角度', swingDeg => {
    for (const pitch of [0, 17, -60, 90]) {
      for (const aspect of ['standard', 'tarot'] as const) {
        const s = scene(pitch, aspect), width = 480;
        const turn = turntableFrame(s, width), swing = turntableFrame(s, width, swingDeg);
        // 相同輸出寬度時 fullWidth 越大，代表裁切的投影外框越窄。
        if (pitch === 0 || pitch === 17) expect(swing.viewOffset.fullWidth).toBeGreaterThan(turn.viewOffset.fullWidth);
        else expect(swing.viewOffset.fullWidth).toBeGreaterThanOrEqual(turn.viewOffset.fullWidth);
        expect(swing.width).toBe(width);
        expect(swing.height % 2).toBe(0);
        for (let yaw = -swingDeg; yaw <= swingDeg; yaw += 0.25) {
          for (const p of corners(s, swing, yaw)) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(width);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(swing.height);
          }
        }
      }
    }
  });

  it('非整數幅度聯集只取每 5°、兩端與正面，留邊與高度規則不變', () => {
    const s = scene(17), f = turntableFrame(s, 480, 32.5);
    const angles = [-32.5, -30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 32.5];
    const pts = angles.flatMap(yaw => corners(s, f, yaw));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const margin = CAPTURE_MARGIN * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    expect(Math.min(...xs)).toBeCloseTo(margin, 8);
    expect(f.width - Math.max(...xs)).toBeCloseTo(margin, 8);
    const rounded = Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys) + 2 * margin));
    expect(f.height).toBe(rounded + rounded % 2);
    expect(Math.min(...ys)).toBeCloseTo(f.height - Math.max(...ys), 10);
  });

  it('標準卡同寬 480、俯仰 17° 時，30° 擺動輸出高度較小', () => {
    const s = scene(17);
    const turn = turntableFrame(s, 480), swing = turntableFrame(s, 480, 30);
    expect(swing.height).toBeLessThan(turn.height);
  });

  it.each([0, 4.9, 60.1, NaN, Infinity])('拒絕無效擺動範圍 %s', swingDeg => {
    expect(() => turntableFrame(scene(0), 480, swingDeg)).toThrow();
  });

  it.each([0, 25, -60, 90])('pitch %d°：標準卡與塔羅卡包含所有 5° 取樣及取樣之間的角度', (pitch) => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const s = scene(pitch, aspect);
      const f = turntableFrame(s, 480);
      expect(f.width).toBe(480);
      expect(f.viewOffset.fullWidth / f.viewOffset.fullHeight).toBeCloseTo(s.viewAspect, 12);
      const sampled = Array.from({ length: 72 }, (_, i) => corners(s, f, i * 5)).flat();
      const xs = sampled.map(p => p.x), ys = sampled.map(p => p.y);
      const margin = CAPTURE_MARGIN * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      expect(Math.min(...xs)).toBeCloseTo(margin, 8);
      expect(f.width - Math.max(...xs)).toBeCloseTo(margin, 8);
      expect(Math.abs(Math.min(...ys) - margin)).toBeLessThanOrEqual(1);
      expect(Math.abs(f.height - Math.max(...ys) - margin)).toBeLessThanOrEqual(1);
      expect(f.height % 2).toBe(0);
      for (let yaw = 0; yaw < 360; yaw += 0.5) {
        for (const p of corners(s, f, yaw)) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(f.width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(f.height);
        }
      }
    }
  });

  it.each([1, 478, 479, 480])('寬度 %d 原樣保留，高度四捨五入後只在奇數時加 1、上下對稱留邊', width => {
    const s = scene(17);
    const f = turntableFrame(s, width);
    const pts = Array.from({ length: 72 }, (_, i) => corners(s, f, i * 5)).flat();
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const margin = CAPTURE_MARGIN * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const rounded = Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys) + 2 * margin));
    expect(f.width).toBe(width);
    expect(f.height).toBe(rounded + rounded % 2);
    expect(f.viewOffset.height).toBe(f.height);
    expect(Math.min(...ys)).toBeCloseTo(f.height - Math.max(...ys), 10);
  });

  it('正對正面／背面置中，固定外框不依起始 yaw 改變', () => {
    const s = scene(0);
    const f = turntableFrame(s, 720);
    expect(turntableFrame({ ...s, yawDeg: 171 }, 720)).toEqual(f);
    for (const yaw of [0, 180]) {
      const pts = corners(s, f, yaw);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(f.width / 2, 10);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(f.height / 2, 10);
    }
  });

  it.each([0, -1, 1.5, NaN, Infinity])('拒絕無效寬度 %s', width => {
    expect(() => turntableFrame(scene(0), width)).toThrow(/寬度/);
  });
});

describe('整圈重用像素整理暫存', () => {
  it('指定輸出暫存時沿用陣列，保留翻列與去除 WebGPU 補齊的行為', () => {
    const raw = new Uint8Array(264);
    raw.set([10, 20, 30, 255, 40, 50, 60, 255]);
    raw.set([70, 80, 90, 255, 100, 110, 120, 255], 256);
    const out = new Uint8ClampedArray(16);
    expect(packRows(raw, 2, 2, false, out)).toBe(out);
    expect([...out]).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    packRows(raw, 2, 2, true, out);
    expect([...out]).toEqual([70, 80, 90, 255, 100, 110, 120, 255, 10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('拒絕尺寸不合的輸出暫存', () => {
    expect(() => packRows(new Uint8Array(8), 2, 1, false, new Uint8ClampedArray(4))).toThrow(/大小/);
  });
});
