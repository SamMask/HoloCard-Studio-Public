// 水鏡的水面樣子（T-825，SCHEMA view.waterLook?、DESIGN §5「水面樣子」）的 render 部分：
//   - 滑桿 → 畫面數字的換算（water-layout.ts）：〔夜色〕預設＝T-825 以前（波紋倍數 1、WATER_GAP、鏡頭在卡片中間高度、沒有霧）；
//   - 地平線：鏡頭往下移＋lens shift（view offset），卡片所在的平面（含倒影）在畫面上的位置與大小不變、地平線落在鏡頭高度
//     （地平線 0＝卡片腳邊）；遠景平面跟著蓋滿水平線以上；
//   - 霧：遠處水面一路淡到遠景平面的下緣，兩邊在接縫上一樣濃（霧 100 時看不到地平線那條線）；
//   - T-825c〔霧白〕調美：霧 100 遠景整片融進霧色、天空卡片後面亮四周暗、水面越往下越暗、閃光集中在倒影那一條、波紋 0 完全平靜；
//   - water-fx 的 setLook：uniform、水面高度（卡片高度）跟著變，〔夜色〕＝以前的數字；stage-switch 只交給水鏡、新建的水鏡一建好就收到。
import { Color, Group, Mesh, Object3D, PerspectiveCamera, Vector3, type Material } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WATER_LOOK, MIST_WATER_LOOK } from '../src/model/limits';
import { ASPECT_HEIGHT, type WaterLook } from '../src/model/types';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline } from '../src/render/fit';
import { pickCard, projectCardPoint, type PickScene } from '../src/render/pick';
import { createStageSwitch, type GalleryPart, type StagePart, type WaterPart } from '../src/render/stage-switch';
import { createWaterFx } from '../src/render/water-fx';
import {
  farMist,
  glintBoost,
  glintDensity,
  HORIZON_MIN_HEIGHT,
  horizonCameraY,
  horizonShift,
  horizonViewOffset,
  mistHorizon,
  mistSky,
  needsLookShader,
  reflectedX,
  rippleScale,
  screenToFarU,
  WATER_BACKDROP,
  WATER_GAP,
  WATER_GLINT,
  WATER_STREAK,
  waterBackdropPlane,
  waterFlow,
  waterFog,
  waterGap,
  waterLookUniforms,
  waterReach,
  waterWet,
  waterY,
} from '../src/render/water-layout';

const FOV = 30;
const RAD = Math.PI / 180;
const T = Math.tan((FOV / 2) * RAD);
const CARDS = [ASPECT_HEIGHT.standard, ASPECT_HEIGHT.tarot, 1, 2 / 3] as const;

/** three.js 鏡頭照 card-view 的做法擺好（地平線：往下移 cameraY、setViewOffset 往上平移）。 */
function camera(aspect: number, cameraZ: number, cameraY: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(FOV, aspect, 0.05, 100);
  cam.position.set(0, cameraY, cameraZ);
  if (cameraY !== 0) {
    const v = horizonViewOffset(horizonShift(cameraY, cameraZ, FOV), aspect);
    cam.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  }
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}
const ndc = (cam: PerspectiveCamera, x: number, y: number, z: number) => new Vector3(x, y, z).project(cam);

describe('〔夜色〕預設＝T-825 以前', () => {
  it('波紋 50＝1 倍（以前的漣漪與細波紋）、0＝完全平靜、100＝2 倍', () => {
    expect(rippleScale(DEFAULT_WATER_LOOK.ripple)).toBe(1);
    expect(rippleScale(0)).toBe(0);
    expect(rippleScale(100)).toBe(2);
  });

  it('卡片高度 30＝WATER_GAP（逐位元相同）；0＝貼著水面；越大越高、100 也只離水面一點（< 0.25 卡寬）', () => {
    expect(Object.is(waterGap(DEFAULT_WATER_LOOK.lift), WATER_GAP)).toBe(true);
    expect(waterGap(0)).toBe(0);
    let last = -1;
    for (let lift = 0; lift <= 100; lift += 5) {
      expect(waterGap(lift)).toBeGreaterThan(last);
      last = waterGap(lift);
    }
    expect(waterGap(100)).toBeLessThan(0.25);
    for (const h of CARDS) {
      expect(Object.is(waterY(h, waterGap(DEFAULT_WATER_LOOK.lift)), waterY(h))).toBe(true);
      expect(waterY(h, 0)).toBe(-h / 2);
    }
  });

  it('地平線 100＝鏡頭在卡片中心高度（0，沒有 lens shift）', () => {
    for (const h of CARDS) for (const lift of [0, 30, 100]) expect(Object.is(horizonCameraY(h, waterGap(lift), 100), 0)).toBe(true);
    expect(horizonShift(0, 5, FOV)).toBe(0);
  });

  it('uniform 的換算：夜色＝沒有霧、沒有拉長、沒有閃光、波紋 1 倍；霧白照比例', () => {
    expect(waterLookUniforms(DEFAULT_WATER_LOOK)).toEqual({ mist: 0, streak: 0, glint: 0, ripple: 1 });
    const m = waterLookUniforms(MIST_WATER_LOOK);
    expect(m.mist).toBeCloseTo(MIST_WATER_LOOK.mist / 100, 12);
    expect(m.streak).toBeCloseTo(MIST_WATER_LOOK.streak / 100, 12);
    expect(m.glint).toBeCloseTo(MIST_WATER_LOOK.glint / 100, 12);
    expect(m.ripple).toBeCloseTo(MIST_WATER_LOOK.ripple / 50, 12);
  });
});

describe('地平線：鏡頭往下移＋lens shift，卡片在畫面上的位置與大小不變', () => {
  it('地平線 0：鏡頭在卡片下緣（腳邊）的高度；卡片貼著水面時至少離水面 HORIZON_MIN_HEIGHT；中間線性、越小越低', () => {
    for (const h of CARDS) {
      expect(horizonCameraY(h, WATER_GAP, 0)).toBeCloseTo(-h / 2, 12);
      expect(horizonCameraY(h, 0, 0)).toBeCloseTo(-h / 2 + HORIZON_MIN_HEIGHT, 12);
      expect(horizonCameraY(h, 0, 0) - waterY(h, 0)).toBeGreaterThanOrEqual(HORIZON_MIN_HEIGHT - 1e-12);
      expect(horizonCameraY(h, WATER_GAP, 50)).toBeCloseTo(-h / 4, 12);
      let last = -Infinity;
      for (let hz = 0; hz <= 100; hz += 10) {
        const y = horizonCameraY(h, WATER_GAP, hz);
        expect(y).toBeGreaterThan(last);
        last = y;
      }
    }
    expect(HORIZON_MIN_HEIGHT).toBeGreaterThan(0);
    expect(HORIZON_MIN_HEIGHT).toBeLessThan(0.15);
  });

  it('卡片所在的平面（z＝0）上任何一點、它在水裡的倒影，投影到畫面上和地平線 100 時一模一樣；鏡頭沒有歪（只往下移）', () => {
    for (const h of CARDS) {
      for (const aspect of [0.8, 1.33, 2.2]) {
        const z = cameraDistance(FOV, aspect, 0.9, cardBox(h), waterReach(h));
        const plain = camera(aspect, z, 0);
        for (const horizon of [0, 35, 80]) {
          const gap = waterGap(horizon === 0 ? 0 : 30);
          const cy = horizonCameraY(h, gap, horizon);
          const low = camera(aspect, z, cy);
          expect(low.quaternion.toArray()).toEqual([0, 0, 0, 1]);
          const water = waterY(h, gap);
          for (const [x, y] of [
            [0, 0],
            [0.5, h / 2],
            [-0.5, -h / 2],
            [0.3, -0.2],
            [-0.5, 2 * water + h / 2], // 卡片下緣的倒影
            [0.5, 2 * water - h / 2], // 卡片上緣的倒影
          ] as const) {
            const a = ndc(plain, x, y, 0);
            const b = ndc(low, x, y, 0);
            expect(b.x, `${h} ${aspect} ${horizon} (${x},${y})`).toBeCloseTo(a.x, 9);
            expect(b.y, `${h} ${aspect} ${horizon} (${x},${y})`).toBeCloseTo(a.y, 9);
          }
        }
      }
    }
  });

  it('地平線（很遠的水面）落在鏡頭高度：畫面上＝卡片平面上 y＝鏡頭高度的那一點；地平線 0 時就在卡片腳邊', () => {
    for (const h of CARDS) {
      const aspect = 1.4;
      const z = cameraDistance(FOV, aspect, 0.9, cardBox(h), waterReach(h));
      const cy = horizonCameraY(h, WATER_GAP, 0);
      const low = camera(aspect, z, cy);
      const far = ndc(low, 0, waterY(h), -5000);
      const foot = ndc(low, 0, -h / 2, 0);
      expect(far.y).toBeCloseTo(foot.y, 2);
      expect(far.y).toBeCloseTo(horizonShift(cy, z, FOV), 2);
      // 地平線 100：地平線在畫面正中間（卡片中心高度）
      expect(ndc(camera(aspect, z, 0), 0, waterY(h), -5000).y).toBeCloseTo(0, 2);
    }
  });

  it('lens shift＝鏡頭高度 ÷（鏡頭距離 × tan 半視角）；view offset 不改畫面寬高比', () => {
    expect(horizonShift(-0.7, 5, FOV)).toBeCloseTo(-0.7 / (5 * T), 12);
    const v = horizonViewOffset(-0.3, 1.6);
    expect(v.fullWidth / v.fullHeight).toBeCloseTo(1.6, 12);
    expect(v.width).toBe(v.fullWidth);
    expect(v.height).toBe(v.fullHeight);
    expect(v.x).toBe(0);
  });
});

describe('遠景平面跟著地平線', () => {
  it('沒有地平線平移時和以前的算式逐位元相同', () => {
    for (const [z, aspect, planeY] of [
      [5.2, 1.33, -0.76],
      [12, 0.7, -1.06],
      [3.9, 2.4, -0.56],
    ] as const) {
      const d = z + WATER_BACKDROP.distance;
      const halfH = d * Math.tan(((FOV / 2) * Math.PI) / 180);
      const grow = 1 + WATER_BACKDROP.margin;
      expect(waterBackdropPlane(z, FOV, aspect, planeY)).toStrictEqual({ z: -WATER_BACKDROP.distance, width: 2 * halfH * aspect * grow, height: halfH * grow - planeY });
      expect(waterBackdropPlane(z, FOV, aspect, planeY, 0, 0)).toStrictEqual(waterBackdropPlane(z, FOV, aspect, planeY));
    }
  });

  it('地平線低：平面的下緣在水面、上緣在畫面頂上面、左右在畫面外（蓋滿水平線以上）', () => {
    for (const h of CARDS) {
      for (const aspect of [0.8, 1.33, 2.2]) {
        for (const horizon of [0, 40]) {
          const gap = waterGap(horizon === 0 ? 0 : 30);
          const zCam = cameraDistance(FOV, aspect, 0.7, cardBox(h), waterReach(h));
          const cy = horizonCameraY(h, gap, horizon);
          const shift = horizonShift(cy, zCam, FOV);
          const water = waterY(h, gap);
          const plane = waterBackdropPlane(zCam, FOV, aspect, water, cy, shift);
          const cam = camera(aspect, zCam, cy);
          const top = ndc(cam, 0, water + plane.height, plane.z);
          const bottom = ndc(cam, 0, water, plane.z);
          const side = ndc(cam, plane.width / 2, water + plane.height / 2, plane.z);
          expect(top.y).toBeGreaterThan(1);
          expect(bottom.y).toBeLessThan(1);
          expect(side.x).toBeGreaterThan(1);
        }
      }
    }
  });
});

describe('霧', () => {
  const MISTS = [0.1, 0.3, 0.5, 0.7, 0.85, 0.9, 1] as const;

  it('〔霧〕0＝完全沒有（遠景平面、水面都混 0，逐位元）；100＝遠景平面整片都是霧色（最上面也是，T-825c）', () => {
    for (let v = 0; v <= 1.0001; v += 0.05) {
      expect(Object.is(farMist(v, 0), 0)).toBe(true);
      expect(farMist(v, 1)).toBe(1);
    }
    expect(Object.is(mistHorizon(0), 0)).toBe(true);
    expect(mistHorizon(1)).toBe(1);
  });

  it('遠景平面：水平線那一帶比上面濃（地平線融進霧）；霧越大越濃；霧 85～90 時最上面也 ≥ 0.8（遠景只剩淡淡的影子）', () => {
    for (const m of MISTS) {
      let last = 2;
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const a = farMist(v, m);
        expect(a).toBeLessThanOrEqual(last + 1e-12);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        last = a;
      }
      expect(farMist(0, m)).toBeGreaterThanOrEqual(m);
      expect(farMist(0, m)).toBeCloseTo(mistHorizon(m), 12);
    }
    for (let v = 0; v <= 1.0001; v += 0.1) {
      let last = -1;
      for (let m = 0; m <= 1.0001; m += 0.05) {
        expect(farMist(v, m)).toBeGreaterThanOrEqual(last - 1e-12);
        last = farMist(v, m);
      }
    }
    for (const m of [0.85, 0.9]) {
      expect(farMist(1, m)).toBeGreaterThanOrEqual(0.8);
      expect(farMist(0, m)).toBeGreaterThan(0.97);
    }
  });

  it('水面：離鏡頭越遠越濃、到遠景平面＝1（接縫上和遠景平面的下緣一樣濃）；靠看的人（畫面下方）幾乎沒有霧；貼著水平線那一條也是霧', () => {
    for (const cameraZ of [4, 6.5, 11]) {
      for (const camH of [0.05, 0.4, 0.76]) {
        expect(waterFog(-WATER_BACKDROP.distance, cameraZ, camH)).toBeCloseTo(1, 12);
        let last = 2;
        for (let z = -WATER_BACKDROP.distance; z < cameraZ - 0.05; z += 0.25) {
          const f = waterFog(z, cameraZ, camH);
          expect(f).toBeLessThanOrEqual(last + 1e-12);
          expect(f).toBeGreaterThanOrEqual(0);
          last = f;
        }
        // 鏡頭腳下（畫面最下面那一帶）
        expect(waterFog(cameraZ - camH * 3, cameraZ, camH)).toBeLessThan(0.05);
      }
      // 地平線 0（鏡頭貼近水面）：卡片腳邊（z＝0）往下看的角度很小 → 貼著水平線的那條霧
      expect(waterFog(0, cameraZ, 0.05)).toBeGreaterThan(0.5);
      // 地平線 100（鏡頭在卡片中間高度）：卡片前面只有一點霧
      expect(waterFog(1, cameraZ, 0.76)).toBeLessThan(0.3);
    }
    for (const m of MISTS) expect(mistHorizon(m) * waterFog(-WATER_BACKDROP.distance, 6, 0.05)).toBeCloseTo(farMist(0, m), 12);
  });

  it('天空的明暗（霧色乘這個）：卡片後面（中間偏下）最亮、上面與四角偏暗偏冷；水平線那一帶整條接近霧色（霧 100 看不到線）；左右對稱', () => {
    const lum = (c: readonly number[]) => (c[0]! + c[1]! + c[2]!) / 3;
    const center = mistSky(0.5, 0.22);
    let brightest = { u: 0, v: 0, l: -1 };
    for (let u = 0; u <= 1.0001; u += 0.05) {
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const c = mistSky(u, v);
        const l = lum(c);
        if (l > brightest.l) brightest = { u, v, l };
        const mirror = mistSky(1 - u, v);
        for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(mirror[i]!, 9);
        for (const x of c) expect(x).toBeGreaterThan(0.3);
      }
    }
    expect(Math.abs(brightest.u - 0.5)).toBeLessThan(0.11);
    expect(brightest.v).toBeLessThan(0.45);
    expect(lum(center)).toBeGreaterThanOrEqual(1);
    // 水平線那一帶（下面幾成）：兩邊（卡片後面以外）每個顏色都在霧色的 ±7% 內、中間最多亮 15%（霧 100 看不到線：水面的霧色取同一條直線上的這個顏色）
    for (let u = 0; u <= 1.0001; u += 0.05) {
      for (const v of [0, 0.02, 0.04]) {
        for (const x of mistSky(u, v)) {
          if (Math.abs(u - 0.5) >= 0.24) expect(Math.abs(x - 1), `${u} ${v}`).toBeLessThan(0.07);
          expect(x).toBeGreaterThan(0.93);
          expect(x).toBeLessThan(1.15);
        }
      }
    }
    // 上面與四角暗、偏冷（藍多於紅）
    for (const u of [0, 1]) {
      const corner = mistSky(u, 1);
      expect(lum(corner)).toBeLessThan(0.62);
      expect(corner[2]! / corner[0]!).toBeGreaterThan(1.08);
    }
    expect(lum(mistSky(0.5, 1))).toBeLessThan(0.8);
    expect(lum(mistSky(0.5, 1))).toBeGreaterThan(lum(mistSky(0, 1)));
  });

  it('水面的霧色：螢幕 x → 遠景平面的 u（平面比畫面寬 WATER_BACKDROP.margin，置中）', () => {
    expect(screenToFarU(0.5)).toBe(0.5);
    expect(screenToFarU(0)).toBeCloseTo(0.5 - 0.5 / (1 + WATER_BACKDROP.margin), 12);
    expect(screenToFarU(1)).toBeCloseTo(0.5 + 0.5 / (1 + WATER_BACKDROP.margin), 12);
  });

  it('倒影拉長的取樣數 ≤ 12（含原本的 5 點）；閃光的格子比卡片小很多', () => {
    expect(WATER_STREAK.taps + 5).toBeLessThanOrEqual(12);
    expect(WATER_GLINT.cell[0]).toBeLessThan(0.1);
    expect(WATER_GLINT.cell[1]).toBeLessThan(0.1);
  });
});

describe('T-825c：濕暗的水面、集中的閃光、拉長的倒影、完全平靜', () => {
  it('越往畫面下方（倒影裡越高）水面越暗：水平線那裡不暗、往下很快變暗；倒影拉長 0＝不暗（逐位元 1）', () => {
    expect(waterWet(0, 1)).toBe(1);
    let last = 2;
    for (let h = 0; h <= 1.5; h += 0.05) {
      const w = waterWet(h, 1);
      expect(w).toBeLessThanOrEqual(last + 1e-12);
      last = w;
      expect(Object.is(waterWet(h, 0), 1)).toBe(true);
    }
    // 倒影裡一半卡高的地方已經暗了一大半；最下面最多暗到 1 − wet
    expect(waterWet(0.5, 1)).toBeLessThan(0.45);
    expect(waterWet(1.5, 1)).toBeCloseTo(1 - WATER_STREAK.wet, 9);
    expect(1 - WATER_STREAK.wet).toBeLessThan(0.25);
  });

  it('倒影比 T-825 拉得長（同一個高度多拉 ≥ 40%）、橫紋對比高（最暗 ≤ 0.5、最亮 ≥ 1.2）', () => {
    const t825 = (h: number) => 0.02 + 0.11 * h;
    for (const h of [0.2, 0.6, 1.2]) expect(WATER_STREAK.base + WATER_STREAK.perHeight * h).toBeGreaterThan(t825(h) * 1.4);
    expect(WATER_STREAK.floor).toBeLessThanOrEqual(0.5);
    expect(WATER_STREAK.peak).toBeGreaterThanOrEqual(1.2);
  });

  it('倒影在卡片平面上的 x：卡片正下方（z＝0）就是 x；越靠鏡頭，同一個螢幕位置的水面 x 越小（換回來越大）', () => {
    for (const camZ of [4, 6, 10]) {
      expect(reflectedX(0.3, 0, camZ)).toBeCloseTo(0.3, 12);
      // 鏡頭腳下水面 x＝0.03 的那一點：從鏡頭看出去和卡片平面上 x＝0.03 × camZ ÷ (camZ − z) 在同一條線上
      const z = camZ - 0.4;
      expect(reflectedX(0.03, z, camZ)).toBeCloseTo((0.03 * camZ) / 0.4, 12);
      expect(Math.abs(reflectedX(-0.2, 2, camZ))).toBeGreaterThan(0.2);
    }
  });

  it('閃光集中在卡片倒影那一條（左右約 1～1.5 卡寬內）：外面沒有；靠腳邊最多、往下很快變稀疏；靠腳邊大一點、亮一點', () => {
    const [inner, outer] = WATER_GLINT.column;
    expect(outer).toBeGreaterThanOrEqual(0.5);
    expect(outer).toBeLessThanOrEqual(0.75);
    expect(glintDensity(0, 0)).toBeCloseTo(1, 12);
    for (const h of [0, 0.3, 1]) {
      expect(glintDensity(outer, h)).toBe(0);
      expect(glintDensity(-outer - 0.2, h)).toBe(0);
      expect(glintDensity(inner * 0.9, h)).toBeCloseTo(glintDensity(0, h), 12);
      let last = 2;
      for (let x = 0; x <= 1; x += 0.05) {
        expect(glintDensity(x, h)).toBeLessThanOrEqual(last + 1e-12);
        last = glintDensity(x, h);
      }
    }
    let last = 2;
    for (let h = 0; h <= 1.5; h += 0.05) {
      expect(glintDensity(0, h)).toBeLessThanOrEqual(last + 1e-12);
      last = glintDensity(0, h);
    }
    expect(glintDensity(0, 1)).toBeLessThan(0.3);
    expect(glintDensity(0, 1)).toBeGreaterThan(0);
    const feet = glintBoost(0);
    const far = glintBoost(1.2);
    expect(feet.size).toBeGreaterThanOrEqual(far.size * 1.8);
    expect(feet.gain).toBeGreaterThanOrEqual(far.gain * 1.5);
    expect(far.size).toBeGreaterThanOrEqual(1);
  });

  it('〔波紋〕0＝完全平靜：水面流動的時間（月光微光、橫紋）不走；50＝跟著舞台時間；100＝兩倍', () => {
    expect(waterFlow(3.25, 0.5, 0)).toBe(3.25);
    expect(waterFlow(3.25, 0.5, 1)).toBe(3.75);
    expect(waterFlow(3.25, 0.5, 2)).toBe(4.25);
    expect(waterFlow(3.25, 0, 2)).toBe(3.25);
  });

  it('哪些樣子要換成「水面樣子」那份著色程式：霧、倒影拉長、閃光大於 0 或波紋不是 50；夜色、只改卡片高度／地平線／顏色＝平常那份', () => {
    expect(needsLookShader(waterLookUniforms(DEFAULT_WATER_LOOK))).toBe(false);
    for (const change of [{ lift: 0 }, { lift: 100 }, { horizon: 0 }, { mistColor: '#ffffff' }, { glintColor: '#ffffff' }] as Partial<WaterLook>[])
      expect(needsLookShader(waterLookUniforms({ ...DEFAULT_WATER_LOOK, ...change })), JSON.stringify(change)).toBe(false);
    for (const change of [{ mist: 1 }, { streak: 1 }, { glint: 1 }, { ripple: 0 }, { ripple: 49 }, { ripple: 100 }] as Partial<WaterLook>[])
      expect(needsLookShader(waterLookUniforms({ ...DEFAULT_WATER_LOOK, ...change })), JSON.stringify(change)).toBe(true);
    expect(needsLookShader(waterLookUniforms(MIST_WATER_LOOK))).toBe(true);
  });
});

describe('water-fx 的 setLook', () => {
  const cam = () => new PerspectiveCamera(30, 1, 0.05, 100);
  const linear = (hex: string) => new Color(hex);

  it('建好時＝〔夜色〕：uniform 和以前一樣（沒有霧、拉長、閃光，波紋 1 倍）、水面在 WATER_GAP', () => {
    const fx = createWaterFx({ camera: cam() });
    fx.setCardHeight(ASPECT_HEIGHT.standard);
    expect(fx.look.mist.value).toBe(0);
    expect(fx.look.streak.value).toBe(0);
    expect(fx.look.glint.value).toBe(0);
    expect(fx.look.ripple.value).toBe(1);
    expect(Object.is(fx.group.position.y, waterY(ASPECT_HEIGHT.standard))).toBe(true);
    fx.dispose();
  });

  it('改樣子：uniform 跟著變（顏色換成線性）、卡片高度改水面高度（倒影跟著）；回到夜色＝以前的數字', () => {
    const fx = createWaterFx({ camera: cam() });
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    const look: WaterLook = { ...MIST_WATER_LOOK, mistColor: '#808080', glintColor: '#ff0000' };
    fx.setLook(look);
    expect(fx.look.mist.value).toBeCloseTo(look.mist / 100, 12);
    expect(fx.look.streak.value).toBeCloseTo(look.streak / 100, 12);
    expect(fx.look.glint.value).toBeCloseTo(look.glint / 100, 12);
    expect(fx.look.ripple.value).toBeCloseTo(look.ripple / 50, 12);
    expect(fx.look.mistColor.value.x).toBeCloseTo(linear('#808080').r, 9);
    expect(fx.look.glintColor.value.toArray()).toEqual(linear('#ff0000').toArray());
    expect(fx.group.position.y).toBeCloseTo(waterY(ASPECT_HEIGHT.tarot, 0), 12);
    expect(fx.uniforms.planeY.value).toBeCloseTo(waterY(ASPECT_HEIGHT.tarot, 0), 12);
    // 換比例：照新的卡高、同一個卡片高度
    fx.setCardHeight(ASPECT_HEIGHT.standard);
    expect(fx.group.position.y).toBeCloseTo(waterY(ASPECT_HEIGHT.standard, 0), 12);
    fx.setLook(DEFAULT_WATER_LOOK);
    expect([fx.look.mist.value, fx.look.streak.value, fx.look.glint.value, fx.look.ripple.value]).toEqual([0, 0, 0, 1]);
    expect(Object.is(fx.group.position.y, waterY(ASPECT_HEIGHT.standard))).toBe(true);
    fx.dispose();
  });

  it('水面流動的時間（T-825c）：波紋 0 時不走（舞台時間照走：閃光照閃）、50 跟著舞台時間、100 兩倍；減少動態一樣停住；改波紋不跳', () => {
    const fx = createWaterFx({ camera: cam() });
    fx.update(0);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    expect(fx.uniforms.flow.value).toBeCloseTo(fx.uniforms.time.value, 9);
    fx.setLook({ ...MIST_WATER_LOOK, ripple: 0 });
    const still = fx.uniforms.flow.value;
    const t0 = fx.uniforms.time.value;
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(fx.uniforms.flow.value).toBe(still);
    expect(fx.uniforms.time.value).toBeGreaterThan(t0 + 0.9);
    // 改成 100：從停住的地方接著走（不跳）、兩倍快
    fx.setLook({ ...MIST_WATER_LOOK, ripple: 100 });
    expect(fx.uniforms.flow.value).toBe(still);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    expect(fx.uniforms.flow.value).toBeCloseTo(still + 1, 6);
    // 減少動態：停住
    fx.setReducedMotion(true);
    fx.update(1 / 60);
    const frozen = fx.uniforms.flow.value;
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    expect(fx.uniforms.flow.value).toBe(frozen);
    fx.dispose();
  });
});

describe('water-fx：著色程式兩份（〔夜色〕＝以前那份）', () => {
  const cam = () => new PerspectiveCamera(30, 1, 0.05, 100);
  const waterMesh = (fx: ReturnType<typeof createWaterFx>) => fx.group.children.find((o) => o instanceof Mesh) as Mesh;

  it('霧、倒影拉長、閃光大於 0 或波紋不是 50 才換成「水面樣子」那份材質（第一次才建、之後重用）；回到夜色換回原本那份；卡片高度、地平線、顏色不用換', () => {
    const fx = createWaterFx({ camera: cam() });
    const water = waterMesh(fx);
    const plain = water.material;
    for (const change of [{ lift: 100 }, { horizon: 0 }, { mistColor: '#ffffff' }, { glintColor: '#ffffff' }] as Partial<WaterLook>[]) {
      fx.setLook({ ...DEFAULT_WATER_LOOK, ...change });
      expect(water.material, JSON.stringify(change)).toBe(plain);
    }
    fx.setLook({ ...DEFAULT_WATER_LOOK, streak: 1 });
    const full = water.material;
    expect(full).not.toBe(plain);
    for (const change of [{ glint: 40 }, { mist: 90 }, { ripple: 0 }, { ripple: 100 }] as Partial<WaterLook>[]) {
      fx.setLook({ ...DEFAULT_WATER_LOOK, ...change });
      expect(water.material, JSON.stringify(change)).toBe(full);
    }
    fx.setLook(DEFAULT_WATER_LOOK);
    expect(water.material).toBe(plain);
    fx.setLook(MIST_WATER_LOOK);
    expect(water.material).toBe(full);
    // dispose：兩份都釋放
    const freed = new Set<unknown>();
    for (const m of [plain, full] as Material[]) m.addEventListener('dispose', () => freed.add(m));
    fx.dispose();
    expect(freed.size).toBe(2);
  });
});

describe('點選與投影（pick.ts）照移過的鏡頭算：和 three.js 的鏡頭對得上', () => {
  it('轉著的卡片上一點：projectCardPoint（cameraY、shiftY）＝three.js 投影；pickCard 打回同一點', () => {
    const h = ASPECT_HEIGHT.standard;
    const aspect = 1.5;
    const z = cameraDistance(FOV, aspect, 0.9, cardBox(h), waterReach(h));
    const cy = horizonCameraY(h, 0, 0);
    const cam = camera(aspect, z, cy);
    const s: PickScene = {
      vFovDeg: FOV,
      viewAspect: aspect,
      cameraZ: z,
      yawDeg: 28,
      pitchDeg: -9,
      outline: cardOutline(h, 0.05),
      thickness: CARD_THICKNESS,
      cameraY: cy,
      shiftY: horizonShift(cy, z, FOV),
    };
    const obj = new Object3D();
    obj.rotation.set(s.pitchDeg * RAD, s.yawDeg * RAD, 0);
    obj.updateMatrixWorld(true);
    for (const [x, y] of [
      [0, 0],
      [0.4, 0.6],
      [-0.3, -0.65],
    ] as const) {
      const world = new Vector3(x, y, CARD_THICKNESS / 2).applyMatrix4(obj.matrixWorld).project(cam);
      const mine = projectCardPoint('front', x, y, s)!;
      expect(mine.x).toBeCloseTo(world.x, 9);
      expect(mine.y).toBeCloseTo(world.y, 9);
      const hit = pickCard(mine.x, mine.y, s)!;
      expect(hit.face).toBe('front');
      expect(hit.x).toBeCloseTo(x, 9);
      expect(hit.y).toBeCloseTo(y, 9);
    }
    // 省略 cameraY、shiftY＝以前（逐位元相同）
    const { cameraY: _y, shiftY: _s, ...plain } = s;
    expect(projectCardPoint('front', 0.2, 0.3, { ...plain, cameraY: 0, shiftY: 0 })).toStrictEqual(projectCardPoint('front', 0.2, 0.3, plain));
  });
});

describe('stage-switch：水面樣子只交給水鏡', () => {
  it('記住、交給目前的水鏡；換到水鏡時新建的一建好就收到；其他舞台收不到；一樣的值不做事', () => {
    const looks: WaterLook[] = [];
    const part = (): StagePart => ({
      group: new Group(),
      setCardHeight() {},
      setReducedMotion() {},
      setPose() {},
      update() {},
      dispose() {},
    });
    const water = (): WaterPart => ({ ...part(), setScene() {}, setFarPan() {}, setLook: (l) => void looks.push({ ...l }) });
    const sw = createStageSwitch<never>({
      halo: part,
      gallery: () => ({ ...part(), setThumbs() {} }) as GalleryPart<never>,
      magic: part,
      water,
      nebula: part,
      desk: part,
    });
    expect(sw.waterLook()).toEqual(DEFAULT_WATER_LOOK);
    sw.setStyle('halo');
    sw.setWaterLook(MIST_WATER_LOOK);
    expect(looks).toEqual([]);
    expect(sw.waterLook()).toEqual(MIST_WATER_LOOK);
    sw.setStyle('water');
    expect(looks).toEqual([MIST_WATER_LOOK]);
    sw.setWaterLook({ ...MIST_WATER_LOOK });
    expect(looks).toHaveLength(1);
    sw.setWaterLook({ ...MIST_WATER_LOOK, horizon: 40 });
    expect(looks).toEqual([MIST_WATER_LOOK, { ...MIST_WATER_LOOK, horizon: 40 }]);
  });

  it('沒設過＝夜色：換到水鏡時也交一次（新建的水鏡本來就是夜色，交了不變）', () => {
    const looks: WaterLook[] = [];
    const part = (): StagePart => ({ group: new Group(), setCardHeight() {}, setReducedMotion() {}, setPose() {}, update() {}, dispose() {} });
    const sw = createStageSwitch<never>({
      halo: part,
      gallery: () => ({ ...part(), setThumbs() {} }) as GalleryPart<never>,
      magic: part,
      water: () => ({ ...part(), setScene() {}, setFarPan() {}, setLook: (l) => void looks.push({ ...l }) }),
      nebula: part,
      desk: part,
    });
    sw.setStyle('water');
    expect(looks).toEqual([DEFAULT_WATER_LOOK]);
  });
});
