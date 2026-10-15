// 舞台主題「水鏡」（T-415，DESIGN §5「舞台」）：水面位置、只在水鏡把鏡頭退一點（倒影看得到）、漣漪週期、波紋越往下越明顯、
// 倒影映得比展示廳遠；three.js 物件不擋卡片、只在舞台那一層（不映自己）、減少動態效果時停住、dispose 連倒影一起釋放。只建物件、不畫。
import { Group, Mesh, PerspectiveCamera, Sprite, type Material, type Object3D } from 'three/webgpu';
import { ASPECT_HEIGHT } from '../src/model/types';
import { describe, expect, it } from 'vitest';
import { ZOOM_DEFAULT } from '../src/interact/view';
import { createCardObject } from '../src/render/card-mesh';
import { boundingRadius, cameraDistance, cardBox } from '../src/render/fit';
import { CARD_LAYER, REFLECTION_FADE, STAGE_LAYER } from '../src/render/reflection';
import { createWaterFx } from '../src/render/water-fx';
import {
  WATER_FADE,
  WATER_GAP,
  WATER_PULLBACK,
  WATER_REFLECTION,
  WATER_RIPPLE,
  WATER_SIZE,
  waterReach,
  waterRipple,
  waterY,
  waveletAmplitude,
  WAVELETS,
} from '../src/render/water-layout';

const FOV = 30;
const RAD = Math.PI / 180;

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

function drawables(root: Object3D): (Mesh | Sprite)[] {
  const out: (Mesh | Sprite)[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Sprite) out.push(o);
  });
  return out;
}

describe('水面與取景', () => {
  it('水面在卡片下緣再往下一點點（卡片像浮在水上）；塔羅牌比較高，水面跟著低', () => {
    expect(waterY(ASPECT_HEIGHT.standard)).toBeCloseTo(-(ASPECT_HEIGHT.standard / 2 + WATER_GAP), 12);
    expect(waterY(ASPECT_HEIGHT.tarot)).toBeLessThan(waterY(ASPECT_HEIGHT.standard));
    expect(WATER_GAP).toBeGreaterThan(0);
    expect(WATER_GAP).toBeLessThan(0.1);
  });

  it('寬的預覽區：鏡頭剛好退 WATER_PULLBACK 倍；窄的本來上下就有空，退得比較少（不會更多）', () => {
    expect(WATER_PULLBACK).toBeGreaterThan(1.1);
    expect(WATER_PULLBACK).toBeLessThanOrEqual(1.4); // 只退「一點」，卡片還是主角
    for (const cardAspect of ['standard', 'tarot'] as const) {
      for (const viewAspect of [1.05, 1.3, 1.6, 2.2]) {
        const plain = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT[cardAspect]));
        expect(cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT[cardAspect]), waterReach(ASPECT_HEIGHT[cardAspect])) / plain).toBeCloseTo(WATER_PULLBACK, 9);
      }
      for (const viewAspect of [0.6, 0.8]) {
        const plain = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT[cardAspect]));
        const water = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT[cardAspect]), waterReach(ASPECT_HEIGHT[cardAspect]));
        expect(water / plain).toBeGreaterThanOrEqual(1);
        expect(water / plain).toBeLessThan(WATER_PULLBACK);
      }
      expect(waterReach(ASPECT_HEIGHT[cardAspect]).x).toBeCloseTo(boundingRadius(cardBox(ASPECT_HEIGHT[cardAspect])), 12);
    }
  });

  it('預設縮放下看得到倒影：卡片下緣的倒影以下至少還有卡片高的 30%在畫面裡', () => {
    const t = Math.tan((FOV / 2) * RAD);
    for (const cardAspect of ['standard', 'tarot'] as const) {
      const h = ASPECT_HEIGHT[cardAspect];
      // 鏡頭在 (0,0,D)：卡片 z≈0 的平面上，下緣的倒影在 2 × 水面 − 卡片下緣
      const reflectionTop = 2 * waterY(ASPECT_HEIGHT[cardAspect]) + h / 2;
      for (const viewAspect of [1.05, 1.6, 2.2]) {
        const d = cameraDistance(FOV, viewAspect, ZOOM_DEFAULT, cardBox(ASPECT_HEIGHT[cardAspect]), waterReach(ASPECT_HEIGHT[cardAspect]));
        const visibleBottom = -d * t;
        expect(reflectionTop - visibleBottom).toBeGreaterThan(0.3 * h);
      }
    }
  });

  it('水面網格伸到鏡頭下面（最遠縮放也是），遠處在淡完之後才結束', () => {
    const farthestCamera = cameraDistance(FOV, 0.7, 0.45, cardBox(ASPECT_HEIGHT.tarot), waterReach(ASPECT_HEIGHT.tarot));
    // 鏡頭下緣的視線打到水面的那一點
    const hitZ = farthestCamera - -waterY(ASPECT_HEIGHT.tarot) / Math.tan((FOV / 2) * RAD);
    expect(WATER_SIZE.near).toBeGreaterThan(hitZ);
    expect(WATER_SIZE.far + 3).toBeGreaterThan(WATER_FADE[1]);
    expect(WATER_SIZE.width / 2).toBeGreaterThan(WATER_FADE[1] * 0.6);
  });
});

describe('漣漪與波紋', () => {
  it('漣漪的週期：period 秒後一模一樣；count 圈錯開（同一時間半徑都不同）', () => {
    for (const time of [0, 1.3, 7.9, 100.25]) {
      for (let k = 0; k < WATER_RIPPLE.count; k++) {
        const a = waterRipple(time, k);
        const b = waterRipple(time + WATER_RIPPLE.period, k);
        expect(b.radius).toBeCloseTo(a.radius, 9);
        expect(b.strength).toBeCloseTo(a.strength, 9);
      }
      const radii = Array.from({ length: WATER_RIPPLE.count }, (_, k) => waterRipple(time, k).radius);
      expect(new Set(radii.map((r) => r.toFixed(6))).size).toBe(WATER_RIPPLE.count);
    }
    // 每 period ÷ count 秒冒一圈：第 k＋1 圈就是第 k 圈晚 period ÷ count 秒
    const step = WATER_RIPPLE.period / WATER_RIPPLE.count;
    expect(waterRipple(3, 1).radius).toBeCloseTo(waterRipple(3 + step, 0).radius, 9);
  });

  it('一圈從卡片正下方往外擴散：半徑一直變大、越外越淡、稍微變寬；不會比 WATER_RIPPLE.gain 亮', () => {
    let last = waterRipple(0, 0);
    expect(last.radius).toBeCloseTo(WATER_RIPPLE.start, 9);
    expect(last.strength).toBe(0);
    let peak = 0;
    for (let i = 1; i < 100; i++) {
      const r = waterRipple((i / 100) * WATER_RIPPLE.period, 0);
      expect(r.radius).toBeGreaterThan(last.radius);
      expect(r.width).toBeGreaterThan(last.width);
      peak = Math.max(peak, r.strength);
      last = r;
    }
    expect(peak).toBeLessThanOrEqual(WATER_RIPPLE.gain);
    expect(waterRipple(0.99 * WATER_RIPPLE.period, 0).strength).toBeLessThan(peak * 0.01);
    expect(WATER_RIPPLE.end).toBeGreaterThan(1.5); // 擴散到卡片外面
  });

  it('漣漪是淡的（低對比）', () => {
    expect(WATER_RIPPLE.gain).toBeLessThanOrEqual(0.06);
  });

  it('波紋：越往鏡頭（倒影越下面）越明顯；最大也只偏幾個像素', () => {
    expect(waveletAmplitude(-2)).toBeCloseTo(WAVELETS.near, 12);
    expect(waveletAmplitude(0)).toBeCloseTo(WAVELETS.near, 12);
    expect(waveletAmplitude(WAVELETS.reach / 2)).toBeGreaterThan(waveletAmplitude(0.1));
    expect(waveletAmplitude(100)).toBeCloseTo(WAVELETS.far, 12);
    expect(WAVELETS.far).toBeLessThan(0.01);
  });

  it('倒影映得比展示廳的石地板遠（淡得慢）、比卡片暗一點', () => {
    expect(WATER_REFLECTION.fade).toBeGreaterThan(REFLECTION_FADE * 3);
    expect(WATER_REFLECTION.gain).toBeLessThan(1);
    expect(WATER_REFLECTION.gain).toBeGreaterThan(0.5);
  });
});

describe('three.js 物件', () => {
  const camera = () => new PerspectiveCamera(30, 1, 0.05, 100);

  it('不擋卡片：比卡片先畫、不寫不測深度、留在不透明那一批；只在舞台那一層（倒影的鏡頭看不到水面自己）', () => {
    const fx = createWaterFx({ camera: camera() });
    const card = createCardObject(fakeImage(4, 4), 1, fakeImage(512, 512));
    expect(fx.group.renderOrder).toBeLessThan(card.group.renderOrder);
    const parts = drawables(fx.group);
    expect(parts.length).toBe(1); // 水面＝1 個 draw call（倒影另外一個 pass）
    for (const p of parts) {
      const m = p.material as Material;
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
      expect(p.layers.mask).toBe(1 << STAGE_LAYER);
    }
  });

  it('倒影的鏡面就是水面：放在整組的原點、朝上；水面高度跟著卡片比例', () => {
    const fx = createWaterFx({ camera: camera() });
    expect(fx.reflection.target.parent).toBe(fx.group);
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    expect(fx.group.position.y).toBeCloseTo(waterY(ASPECT_HEIGHT.tarot), 12);
    expect(fx.uniforms.planeY.value).toBeCloseTo(waterY(ASPECT_HEIGHT.tarot), 12);
    fx.group.updateMatrixWorld(true);
    const e = fx.reflection.target.matrixWorld.elements;
    expect(e[9]).toBeCloseTo(1, 12); // 鏡面法線＝世界 +y
    expect(e[13]).toBeCloseTo(waterY(ASPECT_HEIGHT.tarot), 12); // 鏡面在水面高度
  });

  it('倒影的鏡頭只看卡片那一層', () => {
    const cam = camera();
    cam.layers.enable(STAGE_LAYER);
    const fx = createWaterFx({ camera: cam });
    expect(fx.reflection.node.reflector.getVirtualCamera(cam).layers.mask).toBe(1 << CARD_LAYER);
  });

  it('不跟著卡片轉；每格只改 uniform（時間往前走）', () => {
    const fx = createWaterFx({ camera: camera() });
    const before = drawables(fx.group).map((p) => [p, p.geometry, p.material]);
    fx.setPose(70, 30);
    fx.update(0);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    expect(fx.group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(fx.uniforms.time.value).toBeCloseTo(0.5, 6);
    expect(drawables(fx.group).map((p) => [p, p.geometry, p.material])).toEqual(before);
  });

  it('減少動態效果：時間停住（漣漪與波紋停在當下）、轉卡也不變亮；關掉後繼續', () => {
    const fx = createWaterFx({ camera: camera() });
    fx.update(0);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    fx.setReducedMotion(true);
    fx.update(1 / 60);
    const still = fx.uniforms.time.value;
    for (let i = 0; i < 60; i++) {
      fx.setPose(i * 10, 0);
      fx.update(1 / 60);
    }
    expect(fx.uniforms.time.value).toBe(still);
    expect(fx.uniforms.energy.value).toBe(0);
    fx.setReducedMotion(false);
    fx.update(1 / 60);
    expect(fx.uniforms.time.value).toBeGreaterThan(still);
  });

  it('dispose：水面的網格、材質、倒影（render target）都釋放，並從場景拿掉', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    const reflector = fx.reflection.node.reflector;
    const renderTarget = reflector.getRenderTarget(reflector.getVirtualCamera(cam));
    const parent = new Group();
    parent.add(fx.group);
    const freed = new Set<unknown>();
    const watch = (o: { addEventListener(t: 'dispose', f: () => void): void }) => o.addEventListener('dispose', () => freed.add(o));
    const [water] = drawables(fx.group) as [Mesh];
    watch(water.geometry);
    watch(water.material as Material);
    watch(renderTarget);
    fx.dispose();
    expect(freed.has(water.geometry)).toBe(true);
    expect(freed.has(water.material)).toBe(true);
    expect(freed.has(renderTarget)).toBe(true);
    expect(fx.group.parent).toBeNull();
  });
});
