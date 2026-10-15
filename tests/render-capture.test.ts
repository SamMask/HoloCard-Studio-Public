// 擷取卡片（PNG 匯出、卡片庫縮圖）的純數學：裁切範圍＋鏡頭 view offset（src/render/pick.ts 的 captureFrame）、
// 讀回像素的預乘 alpha 還原（src/render/pixels.ts 的 unpremultiply）。
// 裁切拿 three.js 核心（不需要 WebGPU）的 PerspectiveCamera.setViewOffset 當對照組：照算出來的參數設鏡頭，
// 把卡片 8 個角（含厚度）投影到輸出圖上，每個角都要在圖裡、四邊留的邊照規則。
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT, type PresetAspect } from '../src/model/types';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline } from '../src/render/fit';
import { CAPTURE_MARGIN, captureFrame, type CaptureFrame, type PickScene } from '../src/render/pick';
import { packRows, unpremultiply } from '../src/render/pixels';

const RAD = Math.PI / 180;
const FOV = 30;
const VIEW_ASPECT = 1.6;

function scene(yawDeg: number, pitchDeg: number, aspect: PresetAspect = 'standard', viewAspect = VIEW_ASPECT, zoom = 1): PickScene {
  return {
    vFovDeg: FOV,
    viewAspect,
    cameraZ: cameraDistance(FOV, viewAspect, zoom, cardBox(ASPECT_HEIGHT[aspect])),
    yawDeg,
    pitchDeg,
    outline: cardOutline(ASPECT_HEIGHT[aspect], 0.05),
    thickness: CARD_THICKNESS,
  };
}

/** 照 captureFrame 的參數設 three.js 鏡頭，回傳 8 個角在輸出圖上的像素座標（x 右、y 下）。 */
function projectedCorners(s: PickScene, frame: CaptureFrame): { x: number; y: number }[] {
  const camera = new PerspectiveCamera(FOV, s.viewAspect, 0.05, 100);
  camera.position.set(0, 0, s.cameraZ);
  const v = frame.viewOffset;
  camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  camera.updateMatrixWorld();

  const group = new Group();
  group.rotation.set(s.pitchDeg * RAD, s.yawDeg * RAD, 0);
  group.updateMatrixWorld(true);

  const { halfW, halfH } = s.outline;
  const out: { x: number; y: number }[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = new Vector3(sx * halfW, sy * halfH, (sz * s.thickness) / 2).applyMatrix4(group.matrixWorld).project(camera);
        out.push({ x: ((p.x + 1) / 2) * frame.width, y: ((1 - p.y) / 2) * frame.height });
      }
  return out;
}

/** 8 個角的外框（像素）與四邊留下的空白。 */
function gaps(s: PickScene, frame: CaptureFrame) {
  const pts = projectedCorners(s, frame);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    contentW: maxX - minX,
    contentH: maxY - minY,
    left: minX,
    right: frame.width - maxX,
    top: minY,
    bottom: frame.height - maxY,
  };
}

const ANGLES: [number, number][] = [
  [0, 0],
  [35, 0],
  [-35, 0],
  [0, 35],
  [-40, 20],
  [75, -15],
  [150, 10],
  [180, 0],
  [-120, 60],
];

describe('擷取的裁切範圍（緊貼卡片外框、四邊留外框長邊 4% 的邊）', () => {
  it('留邊比例是 4%', () => {
    expect(CAPTURE_MARGIN).toBe(0.04);
  });

  it.each(['standard', 'tarot'] as const)('正面 0°（%s）：外框比例＝卡片比例，輸出寬＝指定寬、高照外框加邊的比例', (aspect) => {
    const s = scene(0, 0, aspect);
    const frame = captureFrame(s, 1500);
    const g = gaps(s, frame);
    expect(g.contentH / g.contentW).toBeCloseTo(ASPECT_HEIGHT[aspect], 9);
    expect(frame.width).toBe(1500);
    const m = CAPTURE_MARGIN * ASPECT_HEIGHT[aspect]; // 高比寬大，邊以高為準（卡寬單位）
    expect(frame.height).toBe(Math.round((1500 * (ASPECT_HEIGHT[aspect] + 2 * m)) / (1 + 2 * m)));
  });

  it('標準卡 63:88、塔羅 70:120：0° 時輸出比例照卡片比例加邊', () => {
    expect(captureFrame(scene(0, 0, 'standard'), 630).height).toBe(Math.round((630 * (88 / 63) * 1.08) / (1 + 0.08 * (88 / 63))));
    expect(captureFrame(scene(0, 0, 'tarot'), 700).height).toBe(Math.round((700 * (120 / 70) * 1.08) / (1 + 0.08 * (120 / 70))));
  });

  it.each(ANGLES)('yaw %d°、pitch %d°：8 個角都在圖裡，左右各留外框長邊 4%、上下也是（高度取整誤差 ≤ 0.5 px）', (yaw, pitch) => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const s = scene(yaw, pitch, aspect);
      const frame = captureFrame(s, 1500);
      const g = gaps(s, frame);
      const margin = CAPTURE_MARGIN * Math.max(g.contentW, g.contentH);
      expect(g.left).toBeCloseTo(margin, 6);
      expect(g.right).toBeCloseTo(margin, 6);
      expect(Math.abs(g.top - margin)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(g.bottom - margin)).toBeLessThanOrEqual(0.5);
      expect(g.top).toBeGreaterThan(0);
      expect(g.bottom).toBeGreaterThan(0);
    }
  });

  it('左右轉 35°：卡片側過去變窄、近的那一邊變高 → 輸出比 0° 瘦長；上下轉 35° → 比 0° 寬扁', () => {
    const ratio = (yaw: number, pitch: number) => {
      const f = captureFrame(scene(yaw, pitch), 1000);
      return f.height / f.width;
    };
    expect(ratio(35, 0)).toBeGreaterThan(ratio(0, 0) + 0.1);
    expect(ratio(-35, 0)).toBeCloseTo(ratio(35, 0), 2);
    expect(ratio(0, 35)).toBeLessThan(ratio(0, 0) - 0.1);
  });

  it('正面 0° 的輸出大小和視窗比例、縮放無關（縮圖每次都一樣）', () => {
    const a = captureFrame(scene(0, 0, 'standard', 1.6, 1), 320);
    for (const [viewAspect, zoom] of [
      [0.7, 1],
      [2.4, 0.5],
      [1, 0.8],
    ] as const) {
      const b = captureFrame(scene(0, 0, 'standard', viewAspect, zoom), 320);
      expect(b.width).toBe(a.width);
      expect(b.height).toBe(a.height);
    }
  });

  it('view offset 的 fullWidth／fullHeight＝原本的畫面比例（鏡頭 aspect 不變），區塊大小＝輸出大小', () => {
    for (const [yaw, pitch] of ANGLES) {
      const s = scene(yaw, pitch);
      const f = captureFrame(s, 777);
      expect(f.viewOffset.fullWidth / f.viewOffset.fullHeight).toBeCloseTo(VIEW_ASPECT, 12);
      expect(f.viewOffset.width).toBe(f.width);
      expect(f.viewOffset.height).toBe(f.height);
    }
  });

  it('寬度很小也至少 1×1', () => {
    const f = captureFrame(scene(0, 90), 1);
    expect(f.width).toBe(1);
    expect(f.height).toBeGreaterThanOrEqual(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('寬度 %s 不是 ≥ 1 的整數 → 丟錯', (w) => {
    expect(() => captureFrame(scene(0, 0), w)).toThrow(/寬度/);
  });
});

describe('讀回像素的預乘 alpha 還原（PNG 要的是沒預乘的顏色，不然卡片邊緣會多一圈暗邊）', () => {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = (l: number) => Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055) * 255);
  /** 模擬 GPU：在線性空間把顏色乘上覆蓋率（多重取樣平均時和透明底混），再編碼成 sRGB。 */
  const premultiplied = (r: number, g: number, b: number, a: number) => [
    toSrgb(toLinear(r) * (a / 255)),
    toSrgb(toLinear(g) * (a / 255)),
    toSrgb(toLinear(b) * (a / 255)),
    a,
  ];

  it('全不透明與全透明的像素不變', () => {
    const px = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0, 200, 100, 50, 255]);
    unpremultiply(px);
    expect(Array.from(px)).toEqual([10, 20, 30, 255, 0, 0, 0, 0, 200, 100, 50, 255]);
  });

  it.each([
    [200, 100, 50, 128],
    [255, 255, 255, 64],
    [30, 160, 240, 200],
    [90, 90, 90, 32],
  ])('半透明的邊：(%d, %d, %d) 覆蓋 %d → 還原成原本的顏色（誤差 ≤ 2）', (r, g, b, a) => {
    const px = new Uint8ClampedArray(premultiplied(r, g, b, a));
    unpremultiply(px);
    expect(Math.abs(px[0]! - r)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[1]! - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[2]! - b)).toBeLessThanOrEqual(2);
    expect(px[3]).toBe(a);
  });

  it('顏色比覆蓋率還亮的壞值 → 夾在 255，不溢位', () => {
    const px = new Uint8ClampedArray([255, 128, 0, 10]);
    unpremultiply(px);
    expect(px[0]).toBe(255);
    expect(px[3]).toBe(10);
  });
});

describe('讀回像素整理：位元組陣列整列複製，結果和逐位元組搬一樣', () => {
  it('WebGPU 補齊的列、WebGL2 翻轉：Uint8Array 和一般陣列結果相同', () => {
    const width = 3;
    const height = 4;
    const stride = 256;
    const raw = Array.from({ length: stride * (height - 1) + width * 4 }, (_, i) => (i * 37) % 256);
    for (const flip of [false, true]) {
      expect(Array.from(packRows(Uint8Array.from(raw), width, height, flip))).toEqual(Array.from(packRows(raw, width, height, flip)));
    }
    expect(Array.from(packRows(raw, width, height, false).subarray(width * 4, width * 8))).toEqual(raw.slice(stride, stride + width * 4));
  });
});
