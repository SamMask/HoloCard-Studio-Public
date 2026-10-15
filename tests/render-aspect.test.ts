// T-807 卡片比例在 render 的純數學（fit.ts、舞台位置）：網格輪廓照卡高；鏡頭距離用外接球塞進寬、高比較緊的那一邊，
// 所以橫式卡在窄的預覽區、直式卡在寬的預覽區，任何角度 8 個角都在畫面裡；開著透明卡套時照卡套的盒子退（T-806 留下的加做）。
import { describe, expect, it } from 'vitest';
import { aspectHeight } from '../src/model/aspect';
import { ASPECT_HEIGHT } from '../src/model/types';
import { boundingRadius, cameraDistance, CARD_THICKNESS, cardBox, cardOutline, DEFAULT_CARD_H, fitDistance, type FrameBox } from '../src/render/fit';
import { GALLERY_GAP, galleryReach, galleryY } from '../src/render/gallery-layout';
import { magicY, MAGIC_GAP } from '../src/render/magic-layout';
import { nebulaHaloY, NEBULA_HALO } from '../src/render/nebula-layout';
import { sleeveBounds } from '../src/render/sleeve';
import { STAGE_GAP, stageY } from '../src/render/stage-motion';
import { WATER_GAP, waterReach, waterY } from '../src/render/water-layout';

const RAD = Math.PI / 180;
const FOV = 30;
/** 卡高：標準卡、塔羅牌、正方形、明信片、橫式 3:2、最扁 2:1、最長 1:2。 */
const HEIGHTS = [ASPECT_HEIGHT.standard, ASPECT_HEIGHT.tarot, 1, 1.48, 2 / 3, 0.5, 2];

/** 盒子 8 個角在這個角度下投影到 NDC（−1～1 就在畫面裡）；同 render/pick.ts 的旋轉（先 yaw 再 pitch）。 */
function cornersNdc(box: FrameBox, yawDeg: number, pitchDeg: number, cameraZ: number, viewAspect: number): { x: number; y: number }[] {
  const tanV = Math.tan((FOV / 2) * RAD);
  const out: { x: number; y: number }[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * box.halfW;
        const y = sy * box.halfH;
        const z = (sz * box.thickness) / 2;
        const cy = Math.cos(yawDeg * RAD);
        const syw = Math.sin(yawDeg * RAD);
        const x1 = x * cy + z * syw;
        const z1 = -x * syw + z * cy;
        const cp = Math.cos(pitchDeg * RAD);
        const sp = Math.sin(pitchDeg * RAD);
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const depth = cameraZ - z2;
        out.push({ x: x1 / depth / (tanV * viewAspect), y: y2 / depth / tanV });
      }
  return out;
}

const ANGLES: [number, number][] = [];
for (let yaw = -90; yaw <= 90; yaw += 15) for (const pitch of [-60, -30, 0, 30, 60]) ANGLES.push([yaw, pitch]);

describe('卡片輪廓照卡高（aspectHeight）', () => {
  it('正方形、明信片、橫式自訂：半寬 0.5、半高＝卡高／2；圓角照舊', () => {
    expect(cardOutline(1, 0.05)).toEqual({ halfW: 0.5, halfH: 0.5, r: 0.05 });
    expect(cardOutline(1.48, 0.12)).toEqual({ halfW: 0.5, halfH: 0.74, r: 0.12 });
    expect(cardOutline(aspectHeight({ aspect: 'custom', customAspect: { width: 3, height: 2 } }), 0).halfH).toBeCloseTo(1 / 3, 12);
  });

  it('卡片盒子＝輪廓＋卡身厚度；還沒有卡片時用標準卡', () => {
    expect(cardBox(2 / 3)).toEqual({ halfW: 0.5, halfH: 1 / 3, thickness: CARD_THICKNESS });
    expect(DEFAULT_CARD_H).toBe(88 / 63);
  });
});

describe('鏡頭距離（cameraDistance）', () => {
  it('標準卡、塔羅牌和以前一樣（外接球半徑 hypot(0.5, 卡高/2, 厚度/2)）', () => {
    for (const h of [ASPECT_HEIGHT.standard, ASPECT_HEIGHT.tarot]) {
      for (const viewAspect of [0.7, 1.6]) {
        const old = fitDistance(FOV, viewAspect, Math.hypot(0.5, h / 2, CARD_THICKNESS / 2)) / 0.85;
        expect(cameraDistance(FOV, viewAspect, 0.85, cardBox(h))).toBe(old);
      }
    }
  });

  it('五種比例（含橫式 3:2、2:1 與最長 1:2）在寬、窄、方的預覽區，最近縮放時任何角度 8 個角都在畫面裡', () => {
    for (const h of HEIGHTS) {
      for (const viewAspect of [0.55, 1, 1.6, 2.6]) {
        const box = cardBox(h);
        const z = cameraDistance(FOV, viewAspect, 1, box);
        let worst = 0;
        for (const [yaw, pitch] of ANGLES) for (const p of cornersNdc(box, yaw, pitch, z, viewAspect)) worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
        expect(worst, `卡高 ${h.toFixed(3)} 畫面 ${viewAspect}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('橫式卡在窄的預覽區照寬退（正面看左右剛好塞得進、上下有空）', () => {
    const viewAspect = 0.6;
    const box = cardBox(0.5);
    const z = cameraDistance(FOV, viewAspect, 1, box);
    const front = cornersNdc(box, 0, 0, z, viewAspect);
    const maxX = Math.max(...front.map((p) => Math.abs(p.x)));
    const maxY = Math.max(...front.map((p) => Math.abs(p.y)));
    expect(maxX).toBeGreaterThan(0.75);
    expect(maxX).toBeLessThanOrEqual(1);
    expect(maxY).toBeLessThan(maxX);
  });

  it('T-806 加做：開著卡套時照卡套的盒子退——每種比例、最近縮放、斜到 ±90° 卡套四角也不碰畫布邊', () => {
    for (const h of HEIGHTS) {
      for (const r of [0, 0.12]) {
        for (const viewAspect of [0.55, 1.6]) {
          const sleeve = sleeveBounds(cardOutline(h, r));
          const z = cameraDistance(FOV, viewAspect, 1, sleeve);
          let worst = 0;
          for (const [yaw, pitch] of ANGLES) for (const p of cornersNdc(sleeve, yaw, pitch, z, viewAspect)) worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
          expect(worst, `卡高 ${h.toFixed(3)} 圓角 ${r} 畫面 ${viewAspect}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('T-806 加做：卡套的鏡頭比沒有卡套多退約 5%（標準卡）；橫式也多退', () => {
    const viewAspect = 1.6;
    const card = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT.standard));
    const sleeve = cameraDistance(FOV, viewAspect, 1, sleeveBounds(cardOutline(ASPECT_HEIGHT.standard, 0.05)));
    expect(sleeve / card).toBeGreaterThan(1.03);
    expect(sleeve / card).toBeLessThan(1.07);
    expect(boundingRadius(sleeveBounds(cardOutline(2 / 3, 0.05)))).toBeGreaterThan(boundingRadius(cardBox(2 / 3)));
  });
});

describe('舞台位置照卡高（卡片下緣再往下）', () => {
  it('全息光環、展示廳、魔法陣、水鏡、星雲：橫式卡（卡高 2/3）的舞台比標準卡高', () => {
    const h = 2 / 3;
    expect(stageY(h)).toBeCloseTo(-(h / 2 + STAGE_GAP), 12);
    expect(galleryY(h)).toBeCloseTo(-(h / 2 + GALLERY_GAP), 12);
    expect(magicY(h)).toBeCloseTo(-(h / 2 + MAGIC_GAP), 12);
    expect(waterY(h)).toBeCloseTo(-(h / 2 + WATER_GAP), 12);
    expect(nebulaHaloY(h)).toBeCloseTo(-(h / 2 + NEBULA_HALO.gap), 12);
    expect(stageY(h)).toBeGreaterThan(stageY(ASPECT_HEIGHT.standard));
  });

  it('展示廳、水鏡的取景退後量照卡片外接球（橫式、正方形也一樣算）', () => {
    for (const h of [1, 2 / 3]) {
      const r = boundingRadius(cardBox(h));
      expect(galleryReach(h).x).toBeCloseTo(galleryReach(h).y, 12);
      expect(galleryReach(h).x).toBeGreaterThan(r);
      expect(waterReach(h).x).toBeCloseTo(r, 12);
      expect(waterReach(h).y).toBeGreaterThan(r);
    }
  });
});
