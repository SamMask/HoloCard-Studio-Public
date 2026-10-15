// 共用的平面倒影（T-410；T-415 水鏡也會用）：只映卡片那一層、越往下越淡、映出的高度怎麼算、釋放 render target。
import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  CARD_LAYER,
  createPlanarReflection,
  REFLECTION_FADE,
  reflectedHeight,
  reflectionFade,
  STAGE_LAYER,
} from '../src/render/reflection';

describe('映出的高度與淡出', () => {
  it('鏡面在卡片後面（z ≤ 0）映不到卡片＝0；越往鏡頭（z 越大）映出卡片越高的地方', () => {
    expect(reflectedHeight(-0.74, 0, 3.9)).toBe(0);
    expect(reflectedHeight(-0.74, -1, 3.9)).toBe(0);
    let last = 0;
    for (let z = 0.05; z < 3; z += 0.05) {
      const h = reflectedHeight(-0.74, z, 3.9);
      expect(h).toBeGreaterThan(last);
      last = h;
    }
  });

  it('和光線反射的幾何一致：鏡頭 (0,0,D) → 鏡面點 (z, planeY) → 反射後到 z＝0 的高度', () => {
    const planeY = -0.8;
    const D = 4;
    const z = 0.6;
    // 入射斜率：降 0.8 走 3.4；反射後同斜率往上走 0.6
    expect(reflectedHeight(planeY, z, D)).toBeCloseTo((0.8 / 3.4) * 0.6, 12);
  });

  it('越往下越淡：0 高度＝1、REFLECTION_FADE 高時剩 1/e、單調遞減', () => {
    expect(reflectionFade(0)).toBe(1);
    expect(reflectionFade(REFLECTION_FADE)).toBeCloseTo(Math.exp(-1), 12);
    expect(reflectionFade(1)).toBeLessThan(reflectionFade(0.5));
    expect(reflectionFade(-1)).toBe(1);
  });
});

describe('倒影的鏡頭只看卡片', () => {
  it('主鏡頭兩層都看；倒影的鏡頭（ReflectorNode 從主鏡頭 clone 的）只剩卡片那一層', () => {
    const camera = new PerspectiveCamera(30, 1, 0.05, 100);
    camera.layers.enable(STAGE_LAYER);
    const reflection = createPlanarReflection(camera);
    expect(camera.layers.isEnabled(CARD_LAYER)).toBe(true);
    expect(camera.layers.isEnabled(STAGE_LAYER)).toBe(true);
    // 畫的時候 ReflectorNode 用同一個主鏡頭去拿（有快取）：拿到的就是設好的那一個
    expect(reflection.node.reflector.getVirtualCamera(camera).layers.mask).toBe(1 << CARD_LAYER);
  });

  it('鏡面朝上（本地 +z 轉成世界 +y）', () => {
    const reflection = createPlanarReflection(new PerspectiveCamera());
    reflection.target.updateMatrixWorld();
    const e = reflection.target.matrixWorld.elements;
    // 第三欄＝本地 z 軸在世界的方向
    expect(e[8]).toBeCloseTo(0, 12);
    expect(e[9]).toBeCloseTo(1, 12);
    expect(e[10]).toBeCloseTo(0, 12);
  });

  it('dispose 釋放倒影的 render target', () => {
    const camera = new PerspectiveCamera();
    const reflection = createPlanarReflection(camera);
    const target = reflection.node.reflector.getRenderTarget(reflection.node.reflector.getVirtualCamera(camera));
    let freed = false;
    target.addEventListener('dispose', () => (freed = true));
    reflection.dispose();
    expect(freed).toBe(true);
  });
});
