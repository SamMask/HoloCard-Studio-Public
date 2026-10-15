// T-850 連舞台一起錄：舞台在擷取時用「自己的一份動態」（stage-switch 的 capture、各舞台的 forkMotion）——
// 每格固定走 dt 秒、不碰畫面上那份（預覽照常、不跳）；同樣的步驟走出同樣的結果（影片、GIF 不受電腦快慢影響）；
// 倒影在擷取的每一次 render 都重畫（freshReflections：three.js 的倒影平常一個影格只畫一次，擷取在影格之間畫會拿到預覽那一張）。
import { Group, NodeUpdateType, PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { StageStyle } from '../src/model/types';
import { createDeskFx } from '../src/render/desk-fx';
import { createGalleryFx } from '../src/render/gallery-fx';
import { createMagicFx } from '../src/render/magic-fx';
import { createNebulaFx } from '../src/render/nebula-fx';
import { createPlanarReflection, freshReflections } from '../src/render/reflection';
import { createStageFx } from '../src/render/stage-fx';
import { createStageSwitch, type GalleryPart, type MotionFork } from '../src/render/stage-switch';
import { createWaterFx } from '../src/render/water-fx';

type Kind = Exclude<StageStyle, 'none'>;

/** 假的舞台：動態只有一個時間 t；forkMotion 換成另一份。 */
class FakePart implements GalleryPart<string> {
  group = new Group();
  state = { t: 0 };
  pose: [number, number] = [0, 0];
  poses: [number, number][] = [];
  swaps = 0;
  constructor(readonly kind: Kind) {}
  setCardHeight() {}
  setReducedMotion() {}
  setPose(y: number, p: number) {
    this.pose = [y, p];
    this.poses.push([y, p]);
  }
  update(dt: number) {
    if (dt > 0) this.state.t += dt;
  }
  setThumbs() {}
  setScene() {}
  setFarPan() {}
  setLook() {}
  forkMotion(): MotionFork {
    let other = { t: 0 };
    return {
      swap: () => {
        const live = this.state;
        this.state = other;
        other = live;
        this.swaps++;
      },
    };
  }
  dispose() {}
}

function fakeSwitch() {
  const made: FakePart[] = [];
  const maker = (kind: Kind) => () => {
    const p = new FakePart(kind);
    made.push(p);
    return p;
  };
  const sw = createStageSwitch<string>({
    halo: maker('halo'),
    gallery: maker('gallery'),
    magic: maker('magic'),
    water: maker('water'),
    nebula: maker('nebula'),
    desk: maker('desk'),
  });
  return { sw, made };
}

describe('stage-switch 的 capture（T-850）', () => {
  it('step：換成擷取那份、角度設成這一格、走 dt 秒、畫，畫完換回畫面那份、角度放回畫面的', () => {
    const { sw, made } = fakeSwitch();
    sw.setStyle('magic');
    sw.setPose(31, -12);
    sw.update(0.5);
    const part = made[0]!;
    expect(part.state.t).toBe(0.5);
    const run = sw.capture();
    const seen: number[] = [];
    const out = run.step(90, -8, 0.05, () => {
      seen.push(part.state.t);
      expect(part.pose).toEqual([90, -8]);
      return 'drawn';
    });
    expect(out).toBe('drawn');
    run.step(95, -8, 0.05, () => seen.push(part.state.t));
    // 擷取那份從 0 開始、每格 0.05 秒
    expect(seen[0]).toBeCloseTo(0.05, 12);
    expect(seen[1]).toBeCloseTo(0.1, 12);
    // 畫面那份沒被動到；角度放回畫面的
    expect(part.state.t).toBe(0.5);
    expect(part.pose).toEqual([31, -12]);
    expect(part.swaps % 2).toBe(0);
  });

  it('沒有 draw＝只走不畫（先空跑用）；dt ≤ 0 不走時間', () => {
    const { sw, made } = fakeSwitch();
    sw.setStyle('halo');
    const run = sw.capture();
    run.step(0, -8, 0);
    run.step(10, -8, 0.05);
    run.step(20, -8, 0.05);
    let t = -1;
    run.step(30, -8, 0.05, () => (t = made[0]!.state.t));
    expect(t).toBeCloseTo(0.15, 12);
    expect(made[0]!.state.t).toBe(0);
  });

  it('舞台關閉：照畫、回傳 draw 的結果', () => {
    const { sw } = fakeSwitch();
    sw.setStyle('none');
    expect(sw.capture().step(10, 0, 0.05, () => 7)).toBe(7);
  });

  it('擷取途中換了主題（舊的已經釋放）：不動新的那組，照畫', () => {
    const { sw, made } = fakeSwitch();
    sw.setStyle('gallery');
    const run = sw.capture();
    sw.setStyle('water');
    const water = made[1]!;
    let drew = false;
    run.step(10, 0, 0.05, () => (drew = true));
    expect(drew).toBe(true);
    expect(water.swaps).toBe(0);
    expect(water.state.t).toBe(0);
  });

  it('擷取途中丟例外也換回畫面那份', () => {
    const { sw, made } = fakeSwitch();
    sw.setStyle('nebula');
    sw.setPose(5, 6);
    const run = sw.capture();
    expect(() => run.step(10, 0, 0.05, () => {
      throw new Error('畫壞了');
    })).toThrow('畫壞了');
    expect(made[0]!.swaps % 2).toBe(0);
    expect(made[0]!.state.t).toBe(0);
    expect(made[0]!.pose).toEqual([5, 6]);
  });
});

function fakeImage(width: number, height: number): HTMLImageElement {
  return { width, height, naturalWidth: width, naturalHeight: height, complete: true } as unknown as HTMLImageElement;
}

describe('真的舞台：forkMotion 不碰畫面那份、同樣的步驟同樣的結果（T-850）', () => {
  const camera = new PerspectiveCamera(30, 16 / 9, 0.05, 100);

  it('有會動的東西的五種都有 forkMotion；工作桌沒有（沒有會隨時間動的東西）', () => {
    const halo = createStageFx(fakeImage(1600, 480), 8);
    expect(typeof halo.forkMotion).toBe('function');
    expect(typeof createGalleryFx({ camera }).forkMotion).toBe('function');
    expect(typeof createMagicFx().forkMotion).toBe('function');
    expect(typeof createWaterFx({ camera }).forkMotion).toBe('function');
    expect(typeof createNebulaFx().forkMotion).toBe('function');
    expect((createDeskFx({ camera }) as { forkMotion?: unknown }).forkMotion).toBeUndefined();
    // 光環、展示廳換來換去不丟錯
    for (const part of [halo, createGalleryFx({ camera })]) {
      const fork = part.forkMotion!();
      fork.swap();
      part.setPose(40, -8);
      part.update(0.05);
      fork.swap();
    }
  });

  /** 預覽走幾格 → 開一份擷取的動態走幾格（含空跑）→ 換回：畫面那份的時間不變、擷取那份照步數走。 */
  const check = (make: () => {
    setPose(y: number, p: number): void;
    update(dt: number): void;
    forkMotion(): MotionFork;
    uniforms: { time: { value: number } };
  }) => {
    const part = make();
    part.setPose(0, 0);
    part.update(0);
    part.setPose(20, 0);
    part.update(0.3);
    const live = part.uniforms.time.value;
    expect(live).toBeCloseTo(0.3, 12);
    const run = () => {
      const fork = part.forkMotion();
      const times: number[] = [];
      for (let i = 0; i < 6; i++) {
        fork.swap();
        part.setPose(i * 18, -8);
        part.update(i === 0 ? 0 : 0.05);
        times.push(part.uniforms.time.value);
        fork.swap();
        // 換回來：uniform 也是畫面那份
        expect(part.uniforms.time.value).toBe(live);
      }
      return times;
    };
    const a = run();
    const b = run();
    expect(a[5]).toBeCloseTo(0.25, 12);
    expect(b).toEqual(a);
    // 畫面那份接著照常走
    part.setPose(30, 0);
    part.update(0.1);
    expect(part.uniforms.time.value).toBeCloseTo(0.4, 12);
  };

  it('魔法陣', () => check(() => createMagicFx()));
  it('星雲', () => check(() => createNebulaFx()));
  it('水鏡（水面流動的時間也是各自一份）', () => {
    const water = createWaterFx({ camera });
    check(() => water);
    water.setPose(0, 0);
    const flow = water.uniforms.flow.value;
    const fork = water.forkMotion();
    fork.swap();
    expect(water.uniforms.flow.value).toBe(0);
    water.update(0.05);
    water.update(0.05);
    expect(water.uniforms.flow.value).not.toBe(0);
    fork.swap();
    expect(water.uniforms.flow.value).toBe(flow);
  });
});

describe('freshReflections（T-850）：擷取時倒影每次 render 都重畫', () => {
  it('平常一個影格畫一次（FRAME）；裡面每次 render（RENDER）；結束（含丟例外）換回', () => {
    const reflection = createPlanarReflection(new PerspectiveCamera(30, 1, 0.05, 100));
    // 倒影的實作在 ReflectorNode 裡面的 reflector（ReflectorBaseNode）：它決定多久重畫一次
    const node = reflection.node.reflector;
    expect(node.getUpdateBeforeType()).toBe(NodeUpdateType.FRAME);
    expect(freshReflections(() => node.getUpdateBeforeType())).toBe(NodeUpdateType.RENDER);
    expect(node.getUpdateBeforeType()).toBe(NodeUpdateType.FRAME);
    expect(() => freshReflections(() => {
      throw new Error('x');
    })).toThrow('x');
    expect(node.getUpdateBeforeType()).toBe(NodeUpdateType.FRAME);
    reflection.dispose();
  });
});
