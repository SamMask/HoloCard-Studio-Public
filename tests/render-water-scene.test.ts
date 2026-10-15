// 水鏡遠景（T-815）的 render 部分：水鏡收到 null（沒有自己的背景圖）時不再「沒有遠景」，改用這張卡選的那張遠景圖
// （同 T-814 那一片平面、同一套倒影）；自己的背景圖優先；亮度；stage-switch 只交給水鏡；card-view 的貼圖快取（同一張只建一次、
// 拿掉時全部釋放）。只建物件、不畫（GPU 的部分在 tests/gpu）。
import { Group, Mesh, PerspectiveCamera, Texture, type Material, type Object3D } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { StageStyle } from '../src/model/types';
import { PREVIEW_DIM_LINEAR } from '../src/render/backdrop';
import { BACKDROP_LAYER, CARD_LAYER, STAGE_LAYER } from '../src/render/reflection';
import { createSceneTextures } from '../src/render/scene-textures';
import { createStageSwitch, type GalleryPart, type StageBackdrop, type WaterPart } from '../src/render/stage-switch';
import { createWaterFx } from '../src/render/water-fx';
import { WATER_SCENE_DIM, waterBackdropPlane, waterFar, waterFarDim } from '../src/render/water-layout';

const fake = (w = 2048, h = 1024): StageBackdrop => ({ texture: new Texture(), width: w, height: h });

function drawables(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

describe('waterFar：水鏡的遠景用哪張（純函式）', () => {
  it('都沒有＝null；只有遠景＝遠景；有自己的背景圖＝背景圖（不管有沒有遠景）', () => {
    const scene = fake();
    const backdrop = fake(1600, 900);
    expect(waterFar(null, null)).toBeNull();
    expect(waterFar(null, scene)).toEqual({ source: scene, kind: 'scene' });
    expect(waterFar(backdrop, scene)).toEqual({ source: backdrop, kind: 'backdrop' });
    expect(waterFar(backdrop, null)).toEqual({ source: backdrop, kind: 'backdrop' });
  });

  it('亮度：自己的背景圖照 T-814（約 85%）；遠景比原圖暗、不搶卡片（0.5～1 倍）', () => {
    expect(waterFarDim('backdrop')).toBe(PREVIEW_DIM_LINEAR);
    expect(WATER_SCENE_DIM).toBeGreaterThanOrEqual(0.5);
    expect(WATER_SCENE_DIM).toBeLessThanOrEqual(1);
    expect(waterFarDim('scene')).toBeCloseTo(Math.pow(WATER_SCENE_DIM, 2.2), 12);
  });
});

describe('水鏡的遠景（water-fx 的 setScene）', () => {
  const camera = () => {
    const c = new PerspectiveCamera(30, 1.6, 0.05, 100);
    c.layers.enable(STAGE_LAYER);
    c.layers.enable(BACKDROP_LAYER);
    c.position.set(0, 0, 6);
    return c;
  };

  it('有遠景：同 T-814 的那一片平面（BACKDROP_LAYER、水面之後畫）、倒影鏡頭看得到、水面不淡出', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    const scene = fake();
    fx.setScene(scene);
    const plane = fx.backdropMesh()!;
    expect(plane).not.toBeNull();
    expect(fx.farSource()).toEqual({ source: scene, kind: 'scene' });
    expect(drawables(fx.group)).toHaveLength(2);
    expect(plane.layers.mask).toBe(1 << BACKDROP_LAYER);
    const m = plane.material as Material;
    expect(m.transparent).toBe(false);
    expect(m.depthTest).toBe(false);
    expect(fx.uniforms.backdrop.value).toBe(1);
    expect(fx.reflection.node.reflector.getVirtualCamera(cam).layers.mask).toBe((1 << CARD_LAYER) | (1 << BACKDROP_LAYER));
  });

  it('自己的背景圖優先：設了背景圖換成背景圖；拿掉背景圖換回遠景', () => {
    const fx = createWaterFx({ camera: camera() });
    const scene = fake();
    const backdrop = fake(1600, 900);
    fx.setScene(scene);
    const first = fx.backdropMesh()!;
    fx.setBackdrop(backdrop);
    expect(fx.farSource()).toEqual({ source: backdrop, kind: 'backdrop' });
    expect(fx.backdropMesh()).not.toBe(first);
    expect(first.parent).toBeNull();
    fx.setBackdrop(null);
    expect(fx.farSource()).toEqual({ source: scene, kind: 'scene' });
    expect(fx.backdropMesh()).not.toBeNull();
  });

  it('有背景圖時換遠景：畫面不動（平面不重建），拿掉背景圖才看得到新選的', () => {
    const fx = createWaterFx({ camera: camera() });
    const backdrop = fake(1600, 900);
    fx.setBackdrop(backdrop);
    const plane = fx.backdropMesh()!;
    fx.setScene(fake());
    const ink = fake();
    fx.setScene(ink);
    expect(fx.backdropMesh()).toBe(plane);
    fx.setBackdrop(null);
    expect(fx.farSource()).toEqual({ source: ink, kind: 'scene' });
  });

  it('同一張再設不重建；換一張重建（舊的網格、材質釋放，貼圖不釋放：歸 card-view 管）', () => {
    const fx = createWaterFx({ camera: camera() });
    const lake = fake();
    fx.setScene(lake);
    const first = fx.backdropMesh()!;
    fx.setScene(lake);
    expect(fx.backdropMesh()).toBe(first);
    const freed = new Set<unknown>();
    first.geometry.addEventListener('dispose', () => freed.add('geometry'));
    (first.material as Material).addEventListener('dispose', () => freed.add('material'));
    lake.texture.addEventListener('dispose', () => freed.add('texture'));
    fx.setScene(fake());
    expect(fx.backdropMesh()).not.toBe(first);
    expect([...freed].sort()).toEqual(['geometry', 'material']);
  });

  it('遠景拿掉（null、沒有背景圖）：和以前一樣（沒有平面、倒影鏡頭只看卡片、水面照舊淡出）', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setScene(fake());
    fx.setScene(null);
    expect(fx.backdropMesh()).toBeNull();
    expect(fx.farSource()).toBeNull();
    expect(drawables(fx.group)).toHaveLength(1);
    expect(fx.uniforms.backdrop.value).toBe(0);
    expect(fx.reflection.node.reflector.getVirtualCamera(cam).layers.mask).toBe(1 << CARD_LAYER);
  });

  it('減少動態效果：有遠景時波紋與漣漪照舊停住（時間不走）', () => {
    const fx = createWaterFx({ camera: camera() });
    fx.setScene(fake());
    fx.update(0.5);
    const t = fx.uniforms.time.value;
    fx.setReducedMotion(true);
    fx.update(0.5);
    fx.update(0.5);
    expect(fx.uniforms.time.value).toBe(t);
    fx.setReducedMotion(false);
    fx.update(0.5);
    expect(fx.uniforms.time.value).toBeGreaterThan(t);
  });

  it('dispose 時連遠景平面一起釋放（貼圖不釋放）', () => {
    const fx = createWaterFx({ camera: camera() });
    const scene = fake();
    fx.setScene(scene);
    const plane = fx.backdropMesh()!;
    let freed = 0;
    let textureFreed = false;
    plane.geometry.addEventListener('dispose', () => freed++);
    (plane.material as Material).addEventListener('dispose', () => freed++);
    scene.texture.addEventListener('dispose', () => (textureFreed = true));
    fx.dispose();
    expect(freed).toBe(2);
    expect(textureFreed).toBe(false);
  });
});

class FakeWater {
  group = new Group();
  scenes: (StageBackdrop | null)[] = [];
  backdrops: (StageBackdrop | null)[] = [];
  /** 呼叫順序（setBackdrop 要在 setScene 之前：有背景圖時不用先建遠景）。 */
  order: string[] = [];
  setCardHeight() {}
  setReducedMotion() {}
  setPose() {}
  update() {}
  setBackdrop(b: StageBackdrop | null) {
    this.backdrops.push(b);
    this.order.push('backdrop');
  }
  setScene(s: StageBackdrop | null) {
    this.scenes.push(s);
    this.order.push('scene');
  }
  /** 遠景的位置與大小（T-822）：不記進 order（這裡只看遠景圖的順序）。 */
  setFarPan() {}
  setLook() {}
  dispose() {}
}

/** 其他舞台：連 setScene 都沒有（遠景只交給水鏡）。 */
class OtherPart {
  group = new Group();
  calls: string[] = [];
  setCardHeight() {}
  setReducedMotion() {}
  setPose() {}
  update() {}
  setThumbs() {}
  setBackdrop() {
    this.calls.push('backdrop');
  }
  setScene() {
    this.calls.push('scene');
  }
  dispose() {}
}

describe('stage-switch：遠景只交給水鏡', () => {
  function setup() {
    const waters: FakeWater[] = [];
    const others: OtherPart[] = [];
    const other = () => {
      const p = new OtherPart();
      others.push(p);
      return p;
    };
    const sw = createStageSwitch<string>({
      halo: other,
      gallery: other as unknown as () => GalleryPart<string>,
      magic: other,
      water: () => {
        const w = new FakeWater();
        waters.push(w);
        return w as unknown as WaterPart;
      },
      nebula: other,
      desk: other,
    });
    return { sw, waters, others };
  }

  it('交給目前的水鏡；同一張再設不做事；記住', () => {
    const { sw, waters } = setup();
    sw.setStyle('water');
    const lake = fake();
    sw.setWaterScene(lake);
    sw.setWaterScene(lake);
    expect(waters[0]!.scenes).toEqual([lake]);
    expect(sw.waterScene()).toBe(lake);
    sw.setWaterScene(null);
    expect(waters[0]!.scenes).toEqual([lake, null]);
    expect(sw.waterScene()).toBeNull();
  });

  it('其他舞台收不到遠景（換主題、設遠景都不交給它們）', () => {
    const { sw, others } = setup();
    for (const style of ['halo', 'gallery', 'magic', 'nebula', 'none'] as StageStyle[]) {
      sw.setStyle(style);
      sw.setWaterScene(sw.waterScene() ? null : fake());
    }
    expect(others.flatMap((p) => p.calls.filter((c) => c === 'scene'))).toEqual([]);
  });

  it('換到水鏡：新建的水鏡一建好就收到記住的遠景（在背景圖之後給，有背景圖時不用先建遠景）；沒設過就不叫', () => {
    const { sw, waters } = setup();
    sw.setStyle('water');
    expect(waters[0]!.scenes).toEqual([]);
    const ink = fake();
    const backdrop = fake(1600, 900);
    sw.setStyle('halo');
    sw.setWaterScene(ink);
    sw.setBackdrop(backdrop);
    sw.setStyle('water');
    expect(waters[1]!.scenes).toEqual([ink]);
    expect(waters[1]!.order).toEqual(['backdrop', 'scene']);
  });
});

describe('card-view 的遠景貼圖（scene-textures）', () => {
  const image = (w = 2048, h = 1024) => ({ image: { tag: Symbol('img') } as unknown as HTMLImageElement, width: w, height: h });

  it('同一張圖只建一次（換來換去也不重建）；回傳同一個物件（水鏡才知道是同一張）', () => {
    const made: Texture[] = [];
    const textures = createSceneTextures(() => {
      const t = new Texture();
      made.push(t);
      return t;
    });
    const lake = image();
    const ink = image();
    const a = textures.get(lake);
    expect(a).toEqual({ texture: made[0], width: 2048, height: 1024 });
    textures.get(ink);
    expect(textures.get(lake)).toBe(a);
    expect(made).toHaveLength(2);
    expect(textures.size()).toBe(2);
  });

  it('release：全部釋放（切走水鏡、有自己的背景圖時）；之後再要重新建', () => {
    const made: Texture[] = [];
    const textures = createSceneTextures(() => {
      const t = new Texture();
      made.push(t);
      return t;
    });
    const lake = image();
    textures.get(lake);
    textures.get(image());
    let freed = 0;
    for (const t of made) t.addEventListener('dispose', () => freed++);
    textures.release();
    expect(freed).toBe(2);
    expect(textures.size()).toBe(0);
    textures.get(lake);
    expect(made).toHaveLength(3);
  });

  it('寬高不合理的圖不建（回 null）', () => {
    const textures = createSceneTextures(() => new Texture());
    expect(textures.get(image(0, 1024))).toBeNull();
    expect(textures.get(image(2048, Number.NaN))).toBeNull();
    expect(textures.size()).toBe(0);
  });
});

// T-814b：遠景平面的布局（大小、位置、圖的裁切）只在輸入變了才重算——鏡頭距離（縮放、取景動畫）、視角、寬高比、水面高度、遠景圖尺寸；
// 靜止時（含減少動態）每影格不再重算、不再寫變換與 uniform。數「重算」＝數平面的 scale.set 被呼叫幾次（每次重算都會呼叫一次）。
describe('水鏡遠景布局：靜止時不重算（T-814b）', () => {
  const camera = () => {
    const c = new PerspectiveCamera(30, 1.6, 0.05, 100);
    c.layers.enable(STAGE_LAYER);
    c.layers.enable(BACKDROP_LAYER);
    c.position.set(0, 0, 6);
    return c;
  };

  /** 建好水鏡＋遠景，回傳平面的 scale.set 計數器 spy（建立時那次排版不算：spy 是建好之後才裝的）。 */
  function setup(withReduced = false) {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    const scene = fake();
    fx.setScene(scene);
    if (withReduced) fx.setReducedMotion(true);
    const plane = fx.backdropMesh()!;
    const spy = vi.spyOn(plane.scale, 'set');
    return { cam, fx, scene, plane, spy };
  }

  it('建好那一刻就排好版（第一格畫出來就蓋滿水平線以上），不用等下一次 update', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setScene(fake());
    const expected = waterBackdropPlane(cam.position.z, 30, 1.6, fx.group.position.y);
    expect(fx.backdropMesh()!.scale.x).toBeCloseTo(expected.width, 9);
    expect(fx.backdropMesh()!.scale.y).toBeCloseTo(expected.height, 9);
    expect(fx.backdropMesh()!.position.z).toBe(expected.z);
  });

  it.each([false, true])('鏡頭、比例、水面高度都沒變：連續 120 次 update 一次都不重算（減少動態 %s）', (reduced) => {
    const { fx, spy } = setup(reduced);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(spy).not.toHaveBeenCalled();
  });

  it('鏡頭距離變了（縮放、取景動畫）：每個變了的影格都重算（即時跟著），停下來就不再算', () => {
    const { cam, fx, plane, spy } = setup();
    for (let i = 1; i <= 10; i++) {
      cam.position.z = 6 + i * 0.1;
      fx.update(1 / 60);
      expect(spy, `第 ${i} 格`).toHaveBeenCalledTimes(i);
    }
    // 重算出來的結果是對的（同純函式）
    const want = waterBackdropPlane(cam.position.z, 30, 1.6, fx.group.position.y);
    expect(plane.scale.x).toBeCloseTo(want.width, 9);
    expect(plane.scale.y).toBeCloseTo(want.height, 9);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('視角、寬高比變了：各重算一次，沒變就不算', () => {
    const { cam, fx, plane, spy } = setup();
    cam.aspect = 2.3;
    fx.update(0.016);
    fx.update(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(plane.scale.x).toBeCloseTo(waterBackdropPlane(6, 30, 2.3, fx.group.position.y).width, 9);
    cam.fov = 45;
    fx.update(0.016);
    fx.update(0.016);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(plane.scale.y).toBeCloseTo(waterBackdropPlane(6, 45, 2.3, fx.group.position.y).height, 9);
  });

  it('水面高度變了（換卡片比例）：重算一次，之後 update 不再算', () => {
    const { fx, plane, spy } = setup();
    fx.setCardHeight(2);
    expect(spy).toHaveBeenCalledTimes(1);
    fx.update(0.016);
    fx.update(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(plane.scale.y).toBeCloseTo(waterBackdropPlane(6, 30, 1.6, fx.group.position.y).height, 9);
  });

  it('遠景圖的尺寸變了：重算（cover 的裁切跟著）；同尺寸不算', () => {
    const { fx, scene, spy } = setup();
    fx.update(0.016);
    expect(spy).not.toHaveBeenCalled();
    (scene as { width: number }).width = 1024;
    fx.update(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
    fx.update(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('換一張遠景（新平面）：新平面馬上排好版，之後同樣靜止時不重算', () => {
    const { cam, fx } = setup();
    fx.setScene(fake(1600, 900));
    const next = fx.backdropMesh()!;
    const want = waterBackdropPlane(cam.position.z, 30, 1.6, fx.group.position.y);
    expect(next.scale.x).toBeCloseTo(want.width, 9);
    const spy = vi.spyOn(next.scale, 'set');
    for (let i = 0; i < 20; i++) fx.update(0.016);
    expect(spy).not.toHaveBeenCalled();
  });
});
