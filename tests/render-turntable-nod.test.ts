// T-812：匯出的上下仰角（點頭）。純數學：turntablePose（第 i 格的左右＋上下角度）、turntableFrame 帶 nodDeg 時整段取景。
// 取景拿 three.js 核心的鏡頭當對照組，逐格（含兩格之間）檢查卡片 8 個角與破框方框 4 個角都在輸出圖裡。
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TURNTABLE } from '../src/app/files';
import { parallaxOffset } from '../src/interact/parallax';
import type { Box } from '../src/render/breakout';
import { BREAKOUT_FADE } from '../src/render/breakout';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline } from '../src/render/fit';
import { viewDirection } from '../src/render/holo';
import { turntableFrame, turntablePose, type CaptureFrame, type FaceBox, type PickScene } from '../src/render/pick';
import { ASPECT_HEIGHT } from '../src/model/types';
import { discBox, discOutline, DISC_THICKNESS } from '../src/render/disc';
import { sleeveBounds } from '../src/render/sleeve';

const RAD = Math.PI / 180;
const FRAMES = TURNTABLE.frames;
const BASE = TURNTABLE.pitchDeg;

describe('turntablePose：第 i 格的左右＋上下角度', () => {
  it('上下 0 度：左右、上下都和 T-812 以前的公式逐格完全一樣（轉一圈、左右擺動）', () => {
    for (const swing of [5, 30, 32, 60]) {
      for (let i = 0; i < FRAMES; i++) {
        const turn = turntablePose('turn', swing, 0, BASE, i, FRAMES);
        expect(turn.yawDeg).toBe(i * 360 / FRAMES);
        expect(turn.pitchDeg).toBe(BASE);
        const sw = turntablePose('swing', swing, 0, BASE, i, FRAMES);
        expect(sw.yawDeg).toBe(-swing * Math.sin(2 * Math.PI * i / FRAMES));
        expect(sw.pitchDeg).toBe(BASE);
      }
    }
    // 基準俯仰角是 0 或正的也一樣（不能多出 −0 之類）
    expect(turntablePose('turn', 30, 0, 0, 7, FRAMES).pitchDeg).toBe(0);
    expect(turntablePose('turn', 30, 0, 17, 7, FRAMES).pitchDeg).toBe(17);
  });

  it('上下 25 度：第 0 格最低（−8−25＝−33°）、半圈最高（−8+25＝+17°）、四分之一與四分之三回到 −8°', () => {
    for (const motion of ['turn', 'swing'] as const) {
      const p = (i: number) => turntablePose(motion, 30, 25, BASE, i, FRAMES).pitchDeg;
      expect(p(0)).toBeCloseTo(-33, 12);
      expect(p(FRAMES / 2)).toBeCloseTo(17, 12);
      expect(p(FRAMES / 4)).toBeCloseTo(-8, 12);
      expect(p(3 * FRAMES / 4)).toBeCloseTo(-8, 12);
      // 整段裡最小、最大就是這兩格
      const all = Array.from({ length: FRAMES }, (_, i) => p(i));
      expect(Math.min(...all)).toBeCloseTo(-33, 12);
      expect(Math.max(...all)).toBeCloseTo(17, 12);
    }
  });

  it('頭尾接得上：第 frames 格（＝下一個循環的第 0 格）和第 0 格同一個姿勢（轉一圈的左右差一整圈 360°）', () => {
    for (const nod of [0, 1, 10, 25]) {
      for (const swing of [5, 30, 60]) {
        const first = turntablePose('turn', swing, nod, BASE, 0, FRAMES);
        const next = turntablePose('turn', swing, nod, BASE, FRAMES, FRAMES);
        expect(next.yawDeg - first.yawDeg).toBe(360);
        expect(next.pitchDeg).toBeCloseTo(first.pitchDeg, 12);
        const a = turntablePose('swing', swing, nod, BASE, 0, FRAMES);
        const b = turntablePose('swing', swing, nod, BASE, FRAMES, FRAMES);
        expect(b.yawDeg).toBeCloseTo(a.yawDeg, 12);
        expect(b.pitchDeg).toBeCloseTo(a.pitchDeg, 12);
      }
    }
  });

  it('每格的間隔一樣：最後一格到下一個第 0 格的上下變化，和第 0 格到第 1 格的一樣大小、方向相反（左右對稱，沒有重複或跳格）', () => {
    const p = (i: number) => turntablePose('turn', 30, 25, BASE, i, FRAMES).pitchDeg;
    expect(p(FRAMES) - p(FRAMES - 1)).toBeCloseTo(-(p(1) - p(0)), 12);
    expect(p(FRAMES - 1)).not.toBe(p(FRAMES));
  });

  it('GIF 試編的 8 格（frames＝8）剛好是 80 格裡每隔 10 格取一格的同樣角度', () => {
    for (const motion of ['turn', 'swing'] as const) {
      for (let k = 0; k < 8; k++) {
        const few = turntablePose(motion, 30, 17, BASE, k, 8);
        const all = turntablePose(motion, 30, 17, BASE, k * 10, FRAMES);
        expect(few.yawDeg).toBeCloseTo(all.yawDeg, 9);
        expect(few.pitchDeg).toBeCloseTo(all.pitchDeg, 9);
      }
    }
  });
});

// ---- 取景：整段每個姿勢都在輸出圖裡 ----

function scene(pitchDeg: number, aspect: 'standard' | 'tarot' = 'standard'): PickScene {
  return {
    vFovDeg: 30,
    viewAspect: 1.6,
    cameraZ: cameraDistance(30, 1.6, 1, cardBox(ASPECT_HEIGHT[aspect])),
    yawDeg: 37,
    pitchDeg,
    outline: cardOutline(ASPECT_HEIGHT[aspect], 0.05),
    thickness: CARD_THICKNESS,
  };
}

/** 照裁切參數設 three.js 鏡頭，把卡面上的點（看著那一面）投影到輸出圖上（像素，y 往下）。 */
function project(s: PickScene, f: CaptureFrame, yaw: number, pitch: number, local: [number, number, number]) {
  const camera = new PerspectiveCamera(s.vFovDeg, s.viewAspect, 0.05, 100);
  camera.position.z = s.cameraZ;
  const v = f.viewOffset;
  camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  camera.updateMatrixWorld();
  const group = new Group();
  group.rotation.set(pitch * RAD, yaw * RAD, 0);
  group.updateMatrixWorld();
  const p = new Vector3(...local).applyMatrix4(group.matrixWorld).project(camera);
  return { x: ((p.x + 1) * f.width) / 2, y: ((1 - p.y) * f.height) / 2 };
}

function cardCorners(s: PickScene, f: CaptureFrame, yaw: number, pitch: number) {
  const out: { x: number; y: number }[] = [];
  for (const x of [-s.outline.halfW, s.outline.halfW])
    for (const y of [-s.outline.halfH, s.outline.halfH])
      for (const z of [-s.thickness / 2, s.thickness / 2]) out.push(project(s, f, yaw, pitch, [x, y, z]));
  return out;
}

function expectInside(points: { x: number; y: number }[], f: CaptureFrame) {
  for (const p of points) {
    expect(p.x).toBeGreaterThanOrEqual(-1e-6);
    expect(p.x).toBeLessThanOrEqual(f.width + 1e-6);
    expect(p.y).toBeGreaterThanOrEqual(-1e-6);
    expect(p.y).toBeLessThanOrEqual(f.height + 1e-6);
  }
}

describe('turntableFrame 帶上下角度：整段取景', () => {
  // 由 scratchpad 的 node 腳本執行 a7c81cc^ 的 pick.ts 與依賴取得；
  // 固定輸入：scene(-8, 'standard')、寬 480、正面 HEAD 與 depth 80 視差。
  it.each([
    ['轉一圈', undefined, false, { width: 480, height: 718, viewOffset: { fullWidth: 1165.0400458821898, fullHeight: 728.1500286763686, x: 342.5200229410949, y: -16.97975554873698, width: 480, height: 718 } }],
    ['擺動 30°', 30, false, { width: 480, height: 668, viewOffset: { fullWidth: 1175.0747368941536, fullHeight: 734.4217105588459, x: 347.53736844707674, y: 27.050574031669743, width: 480, height: 668 } }],
    ['正面破框轉一圈', undefined, true, { width: 480, height: 846, viewOffset: { fullWidth: 1139.1884142969936, fullHeight: 711.992758935621, x: 329.5942071484968, y: -155.13744344555116, width: 480, height: 846 } }],
  ] as const)('上下 0°：%s 與 T-812 父提交的固定取景完全相等', (_label, swing, breakout, expected) => {
    const boxesAt = (yaw: number, pitch: number): FaceBox[] => {
      const o = parallaxOffset('front', yaw, pitch, 80);
      return [{ face: 'front', box: { left: -0.4 + o.x, right: 0.5 + o.x, bottom: 0.2 + o.y, top: 1.1 + o.y } }];
    };
    expect(turntableFrame(scene(-8), 480, swing, breakout ? boxesAt : undefined, 0)).toEqual(expected);
  });

  it.each([
    ['卡片', 'turn', undefined], ['卡片', 'swing', 30],
    ['卡套', 'turn', undefined], ['卡套', 'swing', 30],
    ['光碟', 'turn', undefined], ['光碟', 'swing', 30],
    ['背面破框', 'turn', undefined],
  ] as const)('%s、%s：上下 25° 的實際 80 格全部在取景內', (kind, motion, swing) => {
    expect(FRAMES).toBe(80);
    let s = scene(BASE);
    if (kind === '卡套') s = { ...s, bounds: sleeveBounds(s.outline) };
    if (kind === '光碟') s = { ...s, outline: discOutline(), thickness: DISC_THICKNESS, bounds: discBox() };
    const boxesAt = (yaw: number, pitch: number): FaceBox[] => {
      const o = parallaxOffset('back', yaw, pitch, 100);
      return [{ face: 'back', box: { left: -0.9 + o.x, right: 0.3 + o.x, bottom: -1.2 + o.y, top: 0.4 + o.y } }];
    };
    const f = turntableFrame(s, 480, swing, kind === '背面破框' ? boxesAt : undefined, 25);
    const bounds = s.bounds ?? { ...s.outline, thickness: s.thickness };
    let backFrames = 0;
    for (let i = 0; i < 80; i++) {
      // 4.5° 相位；奇數格不在取景函式的 3° 取樣上。
      const { yawDeg, pitchDeg } = turntablePose(motion, swing ?? 30, 25, BASE, i, 80);
      const points = [-bounds.halfW, bounds.halfW].flatMap(x =>
        [-bounds.halfH, bounds.halfH].flatMap(y =>
          [-bounds.thickness / 2, bounds.thickness / 2].map(z => project(s, f, yawDeg, pitchDeg, [x, y, z]))));
      expectInside(points, f);
      if (kind === '背面破框' && viewDirection('back', yawDeg, pitchDeg).z > BREAKOUT_FADE.from) {
        backFrames++;
        const { box } = boxesAt(yawDeg, pitchDeg)[0]!;
        expectInside([box.left, box.right].flatMap(x => [box.bottom, box.top].map(y =>
          project(s, f, yawDeg, pitchDeg, [-x, y, -s.thickness / 2]))), f);
      }
    }
    if (kind === '背面破框') expect(backFrames).toBeGreaterThan(20);
  });

  it('上下 0 度（或沒給）：和以前的取景完全一樣', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const s = scene(BASE, aspect);
      for (const swing of [undefined, 5, 30, 60]) {
        expect(turntableFrame(s, 480, swing, undefined, 0)).toEqual(turntableFrame(s, 480, swing));
      }
    }
  });

  it('有上下點頭：取景比沒有的大（同樣輸出寬時 fullWidth 較小＝裁切範圍較大）；輸出寬度不變、高度仍是偶數', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const s = scene(BASE, aspect);
      for (const swing of [undefined, 30]) {
        const plain = turntableFrame(s, 480, swing);
        for (const nod of [5, 10, 25]) {
          const f = turntableFrame(s, 480, swing, undefined, nod);
          expect(f.width).toBe(480);
          expect(f.height % 2).toBe(0);
          expect(f.viewOffset.fullWidth).toBeLessThan(plain.viewOffset.fullWidth);
        }
      }
    }
  });

  it.each([
    ['turn', undefined],
    ['swing', 30],
    ['swing', 60],
    ['swing', 5],
  ] as const)('%s（擺動 %s）、上下 25 度：整段每一格（含兩格之間）卡片 8 個角都在輸出圖裡', (motion, swing) => {
    for (const aspect of ['standard', 'tarot'] as const) {
      for (const nod of [10, 25]) {
        const s = scene(BASE, aspect);
        const f = turntableFrame(s, 480, swing, undefined, nod);
        for (let i = 0; i < 360; i++) {
          const pose = turntablePose(motion, swing ?? 30, nod, BASE, i, 360);
          expectInside(cardCorners(s, f, pose.yawDeg, pose.pitchDeg), f);
        }
      }
    }
  });

  it('上下 25 度：整段（含最低 −33°、最高 +17°）貼著邊，不會留一大片空白', () => {
    const s = scene(BASE);
    const f = turntableFrame(s, 480, undefined, undefined, 25);
    const pts = Array.from({ length: 360 }, (_, i) => {
      const pose = turntablePose('turn', 30, 25, BASE, i, 360);
      return cardCorners(s, f, pose.yawDeg, pose.pitchDeg);
    }).flat();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const margin = Math.min(...xs);
    // 左右留邊＝外框的 4%（和沒有上下角度時同一個規則）
    expect(f.width - Math.max(...xs)).toBeCloseTo(margin, 0);
    expect(margin).toBeGreaterThan(0);
    // 上下兩邊也離邊界不遠（約 1 個留邊；不是白白多出一大塊）
    expect(Math.min(...ys)).toBeLessThan(margin * 3);
    expect(f.height - Math.max(...ys)).toBeLessThan(margin * 3);
  });

  describe('破框層', () => {
    const HEAD: Box = { left: -0.4, right: 0.5, bottom: 0.2, top: 1.1 };
    /** 位移照那個角度（左右＋上下）算的破框方框。 */
    const boxesAt = (yaw: number, pitch: number): FaceBox[] => {
      const o = parallaxOffset('front', yaw, pitch, 80);
      return [{ face: 'front', box: { left: HEAD.left + o.x, right: HEAD.right + o.x, bottom: HEAD.bottom + o.y, top: HEAD.top + o.y } }];
    };

    it('boxesAt 拿到的是整段實際會有的（左右、上下）姿勢，不是只有固定俯仰角', () => {
      const s = scene(BASE);
      const seen: [number, number][] = [];
      turntableFrame(s, 480, 30, (yaw, pitch) => {
        seen.push([yaw, pitch]);
        return [];
      }, 25);
      const pitches = seen.map((p) => p[1]);
      expect(Math.min(...pitches)).toBeCloseTo(-33, 9);
      expect(Math.max(...pitches)).toBeCloseTo(17, 9);
      const yaws = seen.map((p) => p[0]);
      expect(Math.min(...yaws)).toBeCloseTo(-30, 9);
      expect(Math.max(...yaws)).toBeCloseTo(30, 9);
      // 每一筆都落在 turntablePose 畫出的橢圓上
      for (const [yaw, pitch] of seen) {
        const phase = Math.asin(Math.max(-1, Math.min(1, -yaw / 30)));
        expect(Math.abs(pitch - (BASE - 25 * Math.cos(phase))) < 1e-6 || Math.abs(pitch - (BASE + 25 * Math.cos(phase))) < 1e-6).toBe(true);
      }
    });

    it.each([
      ['turn', undefined],
      ['swing', 30],
    ] as const)('%s、上下 25 度：整段每一格正面看得到的破框方框 4 個角都在輸出圖裡（不被切到）', (motion, swing) => {
      const s = scene(BASE);
      const f = turntableFrame(s, 480, swing, boxesAt, 25);
      expect(f.height).toBeGreaterThan(turntableFrame(s, 480, swing, undefined, 25).height);
      let checked = 0;
      for (let i = 0; i < 360; i++) {
        const { yawDeg, pitchDeg } = turntablePose(motion, swing ?? 30, 25, BASE, i, 360);
        // 那一面接近側面（卡外部分不畫）的角度不算（和 pick.ts 的規則一樣）
        if (viewDirection('front', yawDeg, pitchDeg).z <= BREAKOUT_FADE.from) continue;
        checked++;
        const { box } = boxesAt(yawDeg, pitchDeg)[0]!;
        const z = CARD_THICKNESS / 2;
        expectInside(
          [box.left, box.right].flatMap((x) => [box.bottom, box.top].map((y) => project(s, f, yawDeg, pitchDeg, [x, y, z]))),
          f,
        );
      }
      expect(checked).toBeGreaterThan(100);
    });
  });

  it.each([-1, 25.1, 26, NaN, Infinity])('上下角度 %s 不合法：拒絕', (nod) => {
    expect(() => turntableFrame(scene(BASE), 480, undefined, undefined, nod)).toThrow();
  });
});
