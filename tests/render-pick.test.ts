// 「點到卡上哪裡」與「卡上某點在螢幕哪裡」的數學（src/render/pick.ts）。
// 除了語意測試，也拿 three.js 核心（不需要 WebGPU）的矩陣、投影、射線當對照組，
// 確保純數學和實際畫面用的 Euler 角度、鏡頭設定一致。
import { Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Plane, Raycaster, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import { ASPECT_HEIGHT } from '../src/model/types';
import { describe, expect, it } from 'vitest';
import { CARD_THICKNESS, cardOutline, type RoundedRect, roundedRectSdf } from '../src/render/fit';
import { clientToNdc, ndcToClient, pickCard, planePoint, projectCardPoint, type PickScene } from '../src/render/pick';

const RAD = Math.PI / 180;
const FOV = 30;
const VIEW_ASPECT = 1.6;
const CAMERA_Z = 3.2;

function scene(yawDeg: number, pitchDeg: number, outline: RoundedRect = cardOutline(ASPECT_HEIGHT.standard, 0.05)): PickScene {
  return { vFovDeg: FOV, viewAspect: VIEW_ASPECT, cameraZ: CAMERA_Z, yawDeg, pitchDeg, outline, thickness: CARD_THICKNESS };
}

/** 和 card-view／card-mesh 一樣的 three.js 場景（只有幾何、不畫）。 */
function threeScene(yawDeg: number, pitchDeg: number, outline: RoundedRect) {
  const camera = new PerspectiveCamera(FOV, VIEW_ASPECT, 0.05, 100);
  camera.position.set(0, 0, CAMERA_Z);
  camera.updateMatrixWorld();

  const { halfW: hw, halfH: hh, r } = outline;
  const s = new Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  const geometry = new ShapeGeometry(s, 64);
  const material = new MeshBasicMaterial(); // 預設只有正面能被射線打到，和畫面一樣

  const front = new Mesh(geometry, material);
  front.position.z = CARD_THICKNESS / 2;
  const back = new Mesh(geometry, material);
  back.position.z = -CARD_THICKNESS / 2;
  back.rotation.y = Math.PI;

  const group = new Group();
  group.add(front, back);
  group.rotation.set(pitchDeg * RAD, yawDeg * RAD, 0);
  group.updateMatrixWorld(true);
  return { camera, front, back };
}

function project3(obj: Object3D, x: number, y: number, camera: PerspectiveCamera): { x: number; y: number } {
  const v = new Vector3(x, y, 0).applyMatrix4(obj.matrixWorld).project(camera);
  return { x: v.x, y: v.y };
}

const ANGLES: [number, number][] = [
  [0, 0],
  [30, 0],
  [-40, 20],
  [75, -15],
  [-75, 30],
  [150, 10],
  [180, 0],
  [210, -45],
  [-120, 60],
];

describe('螢幕座標 ↔ NDC（−1～1，+y 向上）', () => {
  const rect = { left: 100, top: 50, width: 800, height: 500 };

  it('畫布中心＝(0,0)、左上角＝(−1, 1)、右下角＝(1, −1)', () => {
    expect(clientToNdc(500, 300, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToNdc(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(clientToNdc(900, 550, rect)).toEqual({ x: 1, y: -1 });
  });

  it('來回轉換不變', () => {
    const p = ndcToClient(clientToNdc(321, 123, rect), rect);
    expect(p.x).toBeCloseTo(321, 10);
    expect(p.y).toBeCloseTo(123, 10);
  });
});

describe('hitTest：射線打到卡面', () => {
  it('正面朝鏡頭：畫面中心＝正面中心；往右 +x、往上 +y', () => {
    expect(pickCard(0, 0, scene(0, 0))).toEqual({ face: 'front', x: 0, y: 0 });
    const right = pickCard(0.1, 0, scene(0, 0))!;
    expect(right.face).toBe('front');
    expect(right.x).toBeGreaterThan(0);
    expect(Math.abs(right.y)).toBeLessThan(1e-12);
    const up = pickCard(0, 0.1, scene(0, 0))!;
    expect(up.y).toBeGreaterThan(0);
  });

  it('背面朝鏡頭：打到背面；畫面往右＝背面的 +x（不鏡像）', () => {
    const center = pickCard(0, 0, scene(180, 0))!;
    expect(center.face).toBe('back');
    expect(Math.abs(center.x)).toBeLessThan(1e-12);
    expect(Math.abs(center.y)).toBeLessThan(1e-12);
    const right = pickCard(0.1, 0, scene(180, 0))!;
    expect(right.face).toBe('back');
    expect(right.x).toBeGreaterThan(0);
    const up = pickCard(0, 0.1, scene(180, 0))!;
    expect(up.y).toBeGreaterThan(0);
  });

  it('沒打到卡片 → null', () => {
    expect(pickCard(0.95, 0.95, scene(0, 0))).toBeNull();
    expect(pickCard(-0.9, 0, scene(30, 10))).toBeNull();
  });

  it('剛好側面朝鏡頭（yaw 90）→ 打不到卡面', () => {
    expect(pickCard(0, 0, scene(90, 0))).toBeNull();
  });

  it('圓角切掉的角落打不到；圓角 0 時打得到', () => {
    const round = cardOutline(ASPECT_HEIGHT.standard, 0.12);
    const corner = projectCardPoint('front', 0.499, round.halfH - 0.001, scene(0, 0, round))!;
    expect(pickCard(corner.x, corner.y, scene(0, 0, round))).toBeNull();
    const square = cardOutline(ASPECT_HEIGHT.standard, 0);
    const hit = pickCard(corner.x, corner.y, scene(0, 0, square))!;
    expect(hit.face).toBe('front');
    expect(hit.x).toBeCloseTo(0.499, 9);
  });

  it('塔羅比例：上緣附近打得到（標準卡打不到）', () => {
    const tarot = cardOutline(ASPECT_HEIGHT.tarot, 0.05);
    const p = projectCardPoint('front', 0, 0.8, scene(0, 0, tarot))!;
    expect(pickCard(p.x, p.y, scene(0, 0, tarot))!.y).toBeCloseTo(0.8, 9);
    expect(pickCard(p.x, p.y, scene(0, 0))).toBeNull();
  });

  it('和 three.js 的射線（只打正對鏡頭的三角形）結果一樣', () => {
    const outline = cardOutline(ASPECT_HEIGHT.standard, 0.08);
    const raycaster = new Raycaster();
    for (const [yaw, pitch] of ANGLES) {
      const { camera, front, back } = threeScene(yaw, pitch, outline);
      for (let i = -6; i <= 6; i++) {
        for (let j = -6; j <= 6; j++) {
          const ndc = new Vector2(i / 7, j / 7);
          raycaster.setFromCamera(ndc, camera);
          const hits = raycaster.intersectObjects([front, back], false);
          const mine = pickCard(ndc.x, ndc.y, scene(yaw, pitch, outline));
          const first = hits[0];
          if (!first) {
            // three.js 的圓弧是多邊形近似（略小一點）：只容許剛好落在輪廓邊上的點
            if (mine) expect(roundedRectSdf(mine.x, mine.y, outline)).toBeGreaterThan(-1e-4);
            continue;
          }
          expect(mine, `yaw ${yaw} pitch ${pitch} ndc ${ndc.x},${ndc.y}`).not.toBeNull();
          const local = first.object.worldToLocal(first.point.clone());
          expect(mine!.face).toBe(first.object === front ? 'front' : 'back');
          expect(mine!.x).toBeCloseTo(local.x, 9);
          expect(mine!.y).toBeCloseTo(local.y, 9);
        }
      }
    }
  });
});

describe('projectCardPoint：卡面上一點 → 螢幕', () => {
  it('和 three.js 的矩陣投影結果一樣（正面、背面、各種角度）', () => {
    const outline = cardOutline(ASPECT_HEIGHT.tarot, 0.05);
    for (const [yaw, pitch] of ANGLES) {
      const { camera, front, back } = threeScene(yaw, pitch, outline);
      for (const [x, y] of [[0, 0], [0.5, 0.85], [-0.5, -0.85], [0.3, -0.2], [1.2, 0.4]] as const) {
        const f = projectCardPoint('front', x, y, scene(yaw, pitch, outline));
        const b = projectCardPoint('back', x, y, scene(yaw, pitch, outline));
        const ef = project3(front, x, y, camera);
        const eb = project3(back, x, y, camera);
        if (f) {
          expect(f.x).toBeCloseTo(ef.x, 9);
          expect(f.y).toBeCloseTo(ef.y, 9);
        }
        if (b) {
          expect(b.x).toBeCloseTo(eb.x, 9);
          expect(b.y).toBeCloseTo(eb.y, 9);
        }
        // 兩面不會同時看得到、也不會同時看不到（除非剛好側對）
        expect(Boolean(f) !== Boolean(b)).toBe(true);
      }
    }
  });

  it('那一面背對鏡頭 → null', () => {
    expect(projectCardPoint('front', 0, 0, scene(180, 0))).toBeNull();
    expect(projectCardPoint('back', 0, 0, scene(0, 0))).toBeNull();
    expect(projectCardPoint('back', 0, 0, scene(180, 0))).not.toBeNull();
    expect(projectCardPoint('front', 0, 0, scene(-60, 40))).not.toBeNull();
  });

  it('yaw +30：卡片右緣往後退，右緣在螢幕上離中心比左緣近', () => {
    const r = projectCardPoint('front', 0.5, 0, scene(30, 0))!;
    const l = projectCardPoint('front', -0.5, 0, scene(30, 0))!;
    expect(r.x).toBeGreaterThan(0);
    expect(l.x).toBeLessThan(0);
    expect(r.x).toBeLessThan(-l.x);
  });

  it('來回：投影到螢幕再打回卡面，得到同一面、同一點', () => {
    for (const [yaw, pitch] of ANGLES) {
      for (const face of ['front', 'back'] as const) {
        for (const [x, y] of [[0, 0], [0.4, 0.6], [-0.45, -0.3], [0.2, -0.65]] as const) {
          const p = projectCardPoint(face, x, y, scene(yaw, pitch));
          if (!p) continue;
          const hit = pickCard(p.x, p.y, scene(yaw, pitch))!;
          expect(hit, `${face} yaw ${yaw} pitch ${pitch}`).not.toBeNull();
          expect(hit.face).toBe(face);
          expect(hit.x).toBeCloseTo(x, 9);
          expect(hit.y).toBeCloseTo(y, 9);
        }
      }
    }
  });
});

describe('planePoint：射線打到某一面所在的無限平面（拖曳圖層用，不限卡片範圍）', () => {
  it('卡片上的點：和 pickCard 一樣（正面、背面、各種角度）', () => {
    for (const [yaw, pitch] of ANGLES) {
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          const hit = pickCard(i / 5, j / 5, scene(yaw, pitch));
          if (!hit) continue;
          const p = planePoint(hit.face, i / 5, j / 5, scene(yaw, pitch))!;
          expect(p, `yaw ${yaw} pitch ${pitch}`).not.toBeNull();
          expect(p.x).toBeCloseTo(hit.x, 9);
          expect(p.y).toBeCloseTo(hit.y, 9);
        }
      }
    }
  });

  it('卡片外面也打得到：正面朝鏡頭時畫面右邊很遠＝很大的 +x', () => {
    expect(pickCard(0.9, 0, scene(0, 0))).toBeNull();
    const p = planePoint('front', 0.9, 0, scene(0, 0))!;
    expect(p.x).toBeGreaterThan(0.5);
    expect(Math.abs(p.y)).toBeLessThan(1e-12);
    // 投影回螢幕是同一點
    const back = projectCardPoint('front', p.x, p.y, scene(0, 0))!;
    expect(back.x).toBeCloseTo(0.9, 9);
    expect(back.y).toBeCloseTo(0, 9);
  });

  it('背面朝鏡頭：畫面往右＝背面的 +x、往上＝+y（不鏡像）', () => {
    const c = planePoint('back', 0, 0, scene(180, 0))!;
    const r = planePoint('back', 0.3, 0, scene(180, 0))!;
    const u = planePoint('back', 0, 0.3, scene(180, 0))!;
    expect(r.x - c.x).toBeGreaterThan(0.1);
    expect(u.y - c.y).toBeGreaterThan(0.1);
  });

  it('那一面背對鏡頭 → null', () => {
    expect(planePoint('front', 0, 0, scene(180, 0))).toBeNull();
    expect(planePoint('back', 0, 0, scene(0, 0))).toBeNull();
    expect(planePoint('front', 0, 0, scene(100, 0))).toBeNull();
  });

  it('射線和平面平行、或往反方向（打不到）→ null', () => {
    // 上緣朝觀看者傾 60°：往畫面下方很遠的射線會和卡面平行，再往下就打不到
    const s = scene(0, 60);
    const tanV = Math.tan(15 * RAD);
    const parallelY = -Math.tan(30 * RAD) / tanV; // 射線方向 (0, −tan30, −1) 和卡面平行
    expect(planePoint('front', 0, parallelY, s)).toBeNull();
    expect(planePoint('front', 0, parallelY * 1.5, s)).toBeNull();
    expect(planePoint('front', 0, parallelY * 0.5, s)).not.toBeNull();
  });

  it('和 three.js 的射線打平面結果一樣（畫面內外、正面背面、各種角度）', () => {
    const outline = cardOutline(ASPECT_HEIGHT.standard, 0.05);
    const raycaster = new Raycaster();
    for (const [yaw, pitch] of ANGLES) {
      const { camera, front, back } = threeScene(yaw, pitch, outline);
      for (const face of ['front', 'back'] as const) {
        const mesh = face === 'front' ? front : back;
        const facing = projectCardPoint(face, 0, 0, scene(yaw, pitch, outline)) !== null;
        const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3().setFromMatrixPosition(mesh.matrixWorld));
        for (let i = -6; i <= 6; i++) {
          for (let j = -6; j <= 6; j++) {
            const ndc = new Vector2(i / 3, j / 3); // −2～2：包含畫面外
            const mine = planePoint(face, ndc.x, ndc.y, scene(yaw, pitch, outline));
            if (!facing) {
              expect(mine).toBeNull();
              continue;
            }
            raycaster.setFromCamera(ndc, camera);
            const hit = raycaster.ray.intersectPlane(plane, new Vector3());
            if (!hit) {
              expect(mine, `yaw ${yaw} pitch ${pitch} ${face} ndc ${ndc.x},${ndc.y}`).toBeNull();
              continue;
            }
            const local = mesh.worldToLocal(hit.clone());
            expect(mine, `yaw ${yaw} pitch ${pitch} ${face} ndc ${ndc.x},${ndc.y}`).not.toBeNull();
            const tol = 1e-7 * Math.max(1, Math.abs(local.x), Math.abs(local.y));
            expect(Math.abs(mine!.x - local.x)).toBeLessThan(tol);
            expect(Math.abs(mine!.y - local.y)).toBeLessThan(tol);
          }
        }
      }
    }
  });
});
