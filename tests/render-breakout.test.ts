// T-411 破框層的純數學（src/render/breakout.ts）、鏡頭取景（fit.ts 的 cameraDistance reach）、
// 擷取裁切包住超出卡片的部分（pick.ts 的 captureFrame／turntableFrame）。裁切拿 three.js 核心的鏡頭當對照組。
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { ASPECT_HEIGHT } from '../src/model/types';
import { describe, expect, it } from 'vitest';
import { MAX_PARALLAX, parallaxOffset } from '../src/interact/parallax';
import {
  alphaMaskFromRgba,
  BREAKOUT_FADE,
  breakoutFade,
  contentBox,
  expandBox,
  framingReach,
  layerLift,
  layerUv,
  LAYER_LIFT,
  maskAlphaAt,
  maskContent,
  maxOffset,
  outsideAlphaAt,
  outsideLook,
  RING_GRID,
  ringBounds,
  type Box,
} from '../src/render/breakout';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline } from '../src/render/fit';
import { viewDirection } from '../src/render/holo';
import { captureFrame, turntableFrame, type CaptureFrame, type FaceBox, type PickScene } from '../src/render/pick';

const RAD = Math.PI / 180;
const FOV = 30;

describe('和 interact 的視差公式一致', () => {
  it('浮起高度＝MAX_PARALLAX；任何角度的位移都不超過 maxOffset(depth)', () => {
    expect(LAYER_LIFT).toBe(MAX_PARALLAX);
    for (const depth of [1, 30, 80, 100])
      for (let yaw = -180; yaw <= 180; yaw += 7.5)
        for (const pitch of [-60, -20, 0, 35, 60])
          for (const face of ['front', 'back'] as const) {
            const o = parallaxOffset(face, yaw, pitch, depth);
            expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(maxOffset(depth) + 1e-12);
          }
    expect(layerLift(80)).toBeCloseTo(0.12, 12);
    expect(maxOffset(NaN)).toBe(0);
    expect(maxOffset(200)).toBeCloseTo(0.3, 12);
  });
});

describe('alpha 遮罩：內容範圍、取 alpha', () => {
  /** 8×4 的圖：只有 (x 2～4, y 1～2) 不透明。 */
  function mask() {
    const rgba = new Uint8Array(8 * 4 * 4);
    for (let y = 1; y <= 2; y++) for (let x = 2; x <= 4; x++) rgba[(y * 8 + x) * 4 + 3] = 255;
    rgba[(3 * 8 + 7) * 4 + 3] = 8; // alpha 8 不算
    return alphaMaskFromRgba(rgba, 8, 4);
  }

  it('外框四邊各多留一格（u 往右、v 往下）', () => {
    expect(maskContent(mask())).toEqual({ u0: 1 / 8, v0: 0, u1: 6 / 8, v1: 1 });
    expect(maskContent(alphaMaskFromRgba(new Uint8Array(16), 2, 2))).toBeNull();
  });

  it('maskAlphaAt：圖片 uv 對到的那一格；圖外＝0', () => {
    const m = mask();
    expect(maskAlphaAt(m, 2.5 / 8, 1.5 / 4)).toBe(255);
    expect(maskAlphaAt(m, 0.5 / 8, 0.5 / 4)).toBe(0);
    expect(maskAlphaAt(m, -0.01, 0.5)).toBe(0);
    expect(maskAlphaAt(m, 0.5, 1)).toBe(0);
  });

  it('layerUv 與 contentBox 互為反向：方框四角的 uv 就是內容範圍', () => {
    const center = { x: 0.2, y: -0.1 };
    const size = { w: 1.5, h: 2.1 };
    const uv = { u0: 0.1, v0: 0.05, u1: 0.9, v1: 0.8 };
    const b = contentBox(center, size, uv);
    expect(b.top).toBeGreaterThan(b.bottom);
    expect(layerUv(b.left, b.top, center, size).u).toBeCloseTo(0.1, 12);
    expect(layerUv(b.left, b.top, center, size).v).toBeCloseTo(0.05, 12);
    expect(layerUv(b.right, b.bottom, center, size).u).toBeCloseTo(0.9, 12);
    expect(layerUv(b.right, b.bottom, center, size).v).toBeCloseTo(0.8, 12);
  });
});

describe('卡外實際畫出來的 alpha（點選用，T-411c）', () => {
  /** 2×1 的圖：左邊一格、右邊一格。 */
  const mask = (left: number[], right: number[]) => alphaMaskFromRgba(new Uint8Array([...left, ...right]), 2, 1);
  const L = 0.25;
  const R = 0.75;

  it('不透明黑色：發光／強光＝0（卡外畫不出來）、正常與加深＝1', () => {
    const m = mask([0, 0, 0, 255], [255, 255, 255, 255]);
    expect(outsideAlphaAt(m, L, 0.5, 'screen', 100)).toBe(0);
    expect(outsideAlphaAt(m, L, 0.5, 'add', 100)).toBe(0);
    expect(outsideAlphaAt(m, L, 0.5, 'normal', 100)).toBe(1);
    expect(outsideAlphaAt(m, L, 0.5, 'multiply', 100)).toBe(1);
  });

  it('不透明白色：加深＝0、發光＝1', () => {
    const m = mask([0, 0, 0, 255], [255, 255, 255, 255]);
    expect(outsideAlphaAt(m, R, 0.5, 'multiply', 100)).toBe(0);
    expect(outsideAlphaAt(m, R, 0.5, 'screen', 100)).toBe(1);
  });

  it('乘上圖的 alpha 與不透明度；圖外＝0', () => {
    const m = mask([128, 128, 128, 128], [0, 0, 0, 0]);
    expect(outsideAlphaAt(m, L, 0.5, 'normal', 50)).toBeCloseTo((128 / 255) * 0.5, 9);
    expect(outsideAlphaAt(m, L, 0.5, 'screen', 100)).toBeCloseTo((128 / 255) * (128 / 255), 9);
    expect(outsideAlphaAt(m, R, 0.5, 'normal', 100)).toBe(0);
    expect(outsideAlphaAt(m, -0.1, 0.5, 'normal', 100)).toBe(0);
    expect(outsideAlphaAt(m, L, 0.5, 'normal', undefined)).toBeCloseTo(128 / 255, 9);
  });
});

describe('卡外網格的外框', () => {
  it('包住卡片與每個方框，四邊對齊格子', () => {
    const outline = cardOutline(ASPECT_HEIGHT.standard, 0.05);
    const boxes: Box[] = [expandBox({ left: -0.62, right: 0.61, bottom: -0.63, top: 0.98 }, maxOffset(80))];
    const r = ringBounds(outline, boxes);
    for (const v of [r.left, r.right, r.bottom, r.top]) expect(Math.abs(v / RING_GRID - Math.round(v / RING_GRID))).toBeLessThan(1e-9);
    expect(r.left).toBeLessThanOrEqual(-0.62 - 0.24);
    expect(r.right).toBeGreaterThanOrEqual(0.61 + 0.24);
    expect(r.top).toBeGreaterThanOrEqual(0.98 + 0.24);
    expect(r.bottom).toBeLessThanOrEqual(-outline.halfH);
    // 只動一點點（拖曳中）外框不變 → 不用重建網格
    expect(ringBounds(outline, [expandBox({ left: -0.6, right: 0.6, bottom: -0.63, top: 0.97 }, 0.24)])).toEqual(r);
  });
});

describe('側面淡出', () => {
  it('正對＝1、側面 90°＝0、中間單調', () => {
    expect(breakoutFade(1)).toBe(1);
    expect(breakoutFade(0)).toBe(0);
    expect(breakoutFade(BREAKOUT_FADE.from)).toBe(0);
    expect(breakoutFade(BREAKOUT_FADE.to)).toBe(1);
    let last = -1;
    for (let yaw = 90; yaw >= 0; yaw -= 1) {
      const f = breakoutFade(viewDirection('front', yaw, 0).z);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(breakoutFade(viewDirection('back', 0, 0).z)).toBe(0);
    expect(breakoutFade(viewDirection('back', 180, 0).z)).toBe(1);
  });
});

describe('卡外的顏色：沒有後面的顏色可以混，換成一般疊法', () => {
  const over = (c: { r: number }, a: number, bg: number) => c.r * a + bg * (1 - a);

  it('正常（與疊色、柔光、換色）照原樣', () => {
    for (const mode of ['normal', 'overlay', 'soft-light', 'color'] as const) {
      expect(outsideLook(mode, { r: 0.2, g: 0.5, b: 0.9 }, 0.7)).toEqual({ color: { r: 0.2, g: 0.5, b: 0.9 }, alpha: 0.7 });
    }
  });

  it('發光／強光：灰色疊在任何底色上＝濾色；黑色完全透明', () => {
    for (const mode of ['screen', 'add'] as const) {
      for (const g of [0, 0.25, 0.6, 1])
        for (const bg of [0, 0.3, 0.9]) {
          const look = outsideLook(mode, { r: g, g, b: g }, 1);
          expect(over(look.color, look.alpha, bg)).toBeCloseTo(1 - (1 - g) * (1 - bg), 6);
        }
      expect(outsideLook(mode, { r: 0, g: 0, b: 0 }, 1).alpha).toBe(0);
    }
  });

  it('加深：灰色疊在任何底色上＝色彩增值；白色完全透明', () => {
    for (const g of [0, 0.25, 0.6, 1])
      for (const bg of [0, 0.3, 0.9]) {
        const look = outsideLook('multiply', { r: g, g, b: g }, 1);
        expect(over(look.color, look.alpha, bg)).toBeCloseTo(g * bg, 6);
      }
    expect(outsideLook('multiply', { r: 1, g: 1, b: 1 }, 1).alpha).toBe(0);
  });
});

describe('鏡頭取景（cameraDistance 的 reach）', () => {
  it('沒有破框層＝和以前一樣；有就退遠一點，正面看時超出的部分在畫面裡', () => {
    for (const viewAspect of [0.8, 1.6, 2.4]) {
      const plain = cameraDistance(FOV, viewAspect, 0.85, cardBox(ASPECT_HEIGHT.standard));
      expect(cameraDistance(FOV, viewAspect, 0.85, cardBox(ASPECT_HEIGHT.standard), null)).toBe(plain);
      // 在卡片範圍內 → 不用退
      expect(cameraDistance(FOV, viewAspect, 0.85, cardBox(ASPECT_HEIGHT.standard), { x: 0.3, y: 0.5 })).toBe(plain);
      const reach = framingReach([expandBox({ left: -0.62, right: 0.61, bottom: -0.63, top: 0.98 }, layerLift(80))])!;
      const d = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT.standard), reach);
      expect(d).toBeGreaterThan(cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT.standard)));
      const tanV = Math.tan((FOV / 2) * RAD);
      expect(reach.y / d).toBeLessThanOrEqual(tanV);
      expect(reach.x / d).toBeLessThanOrEqual(tanV * viewAspect);
    }
  });
});

function scene(yawDeg: number, pitchDeg: number, viewAspect = 1.6): PickScene {
  return {
    vFovDeg: FOV,
    viewAspect,
    cameraZ: cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT.standard)),
    yawDeg,
    pitchDeg,
    outline: cardOutline(ASPECT_HEIGHT.standard, 0.05),
    thickness: CARD_THICKNESS,
  };
}

/** 照裁切參數設 three.js 鏡頭，把卡面上的點（看著那一面）投影到輸出圖上（像素，y 往下）。 */
function project(s: PickScene, frame: CaptureFrame, face: 'front' | 'back', x: number, y: number, yawDeg = s.yawDeg) {
  const camera = new PerspectiveCamera(FOV, s.viewAspect, 0.05, 100);
  camera.position.set(0, 0, s.cameraZ);
  const v = frame.viewOffset;
  camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  camera.updateMatrixWorld();
  const group = new Group();
  group.rotation.set(s.pitchDeg * RAD, yawDeg * RAD, 0);
  group.updateMatrixWorld(true);
  const local = face === 'front' ? new Vector3(x, y, CARD_THICKNESS / 2) : new Vector3(-x, y, -CARD_THICKNESS / 2);
  const p = local.applyMatrix4(group.matrixWorld).project(camera);
  return { x: ((p.x + 1) / 2) * frame.width, y: ((1 - p.y) / 2) * frame.height };
}

const HEAD: Box = { left: -0.4, right: 0.5, bottom: 0.2, top: 1.1 };

describe('擷取裁切包住超出卡片的部分', () => {
  it.each([
    [0, 0],
    [30, -10],
    [-50, 15],
    [70, 0],
  ])('正面朝鏡頭（yaw %d、pitch %d）：方框四角都在輸出圖裡', (yaw, pitch) => {
    const s = scene(yaw, pitch);
    const plain = captureFrame(s, 1500);
    const frame = captureFrame(s, 1500, [{ face: 'front', box: HEAD }]);
    expect(frame.height).toBeGreaterThan(plain.height);
    for (const x of [HEAD.left, HEAD.right])
      for (const y of [HEAD.bottom, HEAD.top]) {
        const p = project(s, frame, 'front', x, y);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(frame.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(frame.height);
      }
  });

  it('那一面背對鏡頭、或接近 90°（卡外部分不畫）→ 不算進去', () => {
    for (const [yaw, face] of [
      [180, 'front'],
      [0, 'back'],
      [88, 'front'],
    ] as const) {
      const s = scene(yaw, 0);
      expect(captureFrame(s, 1500, [{ face, box: HEAD }])).toEqual(captureFrame(s, 1500));
    }
  });

  it('背面朝鏡頭時，背面的方框（看著背面的座標）也包進去', () => {
    const s = scene(180, 0);
    const frame = captureFrame(s, 1500, [{ face: 'back', box: HEAD }]);
    expect(frame.height).toBeGreaterThan(captureFrame(s, 1500).height);
    const p = project(s, frame, 'back', HEAD.right, HEAD.top);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(frame.width);
  });

  it('整圈外框：每個角度（位移照那個角度）的方框都包進去；高度仍是偶數', () => {
    const s = scene(0, -8);
    const boxesAt = (yaw: number): FaceBox[] => {
      const o = parallaxOffset('front', yaw, -8, 80);
      return [{ face: 'front', box: { left: HEAD.left + o.x, right: HEAD.right + o.x, bottom: HEAD.bottom + o.y, top: HEAD.top + o.y } }];
    };
    for (const swing of [undefined, 30]) {
      const frame = turntableFrame(s, 480, swing, boxesAt);
      expect(frame.height % 2).toBe(0);
      expect(frame.height).toBeGreaterThan(turntableFrame(s, 480, swing).height);
      const yaws = swing === undefined ? [0, 20, 45, 60, -30, -65] : [-30, -15, 0, 15, 30];
      for (const yaw of yaws) {
        const box = boxesAt(yaw)[0]!.box;
        for (const x of [box.left, box.right])
          for (const y of [box.bottom, box.top]) {
            const p = project(s, frame, 'front', x, y, yaw);
            expect(p.x).toBeGreaterThanOrEqual(-1);
            expect(p.x).toBeLessThanOrEqual(frame.width + 1);
            expect(p.y).toBeGreaterThanOrEqual(-1);
            expect(p.y).toBeLessThanOrEqual(frame.height + 1);
          }
      }
    }
  });
});
