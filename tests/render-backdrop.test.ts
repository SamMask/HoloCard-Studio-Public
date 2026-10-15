// 舞台背景圖（T-814）的 render 部分：cover 裁切的矩形（匯出與水鏡遠景共用）、2D 鋪圖、舞台遠景的接點（stage-switch 記住並交給舞台）、
// 水鏡的遠景平面（下緣貼水平線、蓋滿畫面、倒影鏡頭看得到、拿掉時和以前一樣）、星雲讓出漩渦。只建物件、不畫（GPU 的部分在 tests/gpu）。
import { Group, Mesh, PerspectiveCamera, Texture, type Material, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ZOOM_MIN } from '../src/interact/view';
import { ASPECT_HEIGHT, type StageStyle } from '../src/model/types';
import { coverRect, paintCover, PREVIEW_DIM, PREVIEW_DIM_LINEAR } from '../src/render/backdrop';
import { cameraDistance, cardBox } from '../src/render/fit';
import { createGalleryFx } from '../src/render/gallery-fx';
import { createNebulaFx } from '../src/render/nebula-fx';
import { BACKDROP_LAYER, CARD_LAYER, STAGE_LAYER } from '../src/render/reflection';
import { createStageSwitch, type GalleryPart, type StageBackdrop } from '../src/render/stage-switch';
import { createWaterFx } from '../src/render/water-fx';
import { WATER_BACKDROP, WATER_SIZE, waterBackdropPlane, waterReach, waterY } from '../src/render/water-layout';

const RAD = Math.PI / 180;

describe('coverRect：cover（保持長寬比、蓋滿、多的裁掉）從原圖取哪一塊', () => {
  it('比例一樣：整張', () => {
    expect(coverRect(400, 200, 800, 400)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
  });

  it('原圖比較寬：上下貼滿、左右平均裁掉（置中）', () => {
    const r = coverRect(1600, 900, 600, 900);
    expect(r.sh).toBeCloseTo(900, 9);
    expect(r.sw).toBeCloseTo(600, 9);
    expect(r.sx).toBeCloseTo(500, 9);
    expect(r.sy).toBe(0);
  });

  it('原圖比較高：左右貼滿、上下照 alignY 裁（0.5 置中、1 貼下緣、0 貼上緣）', () => {
    const mid = coverRect(1000, 2000, 1000, 500);
    expect(mid).toEqual({ sx: 0, sy: 750, sw: 1000, sh: 500 });
    expect(coverRect(1000, 2000, 1000, 500, 1)).toEqual({ sx: 0, sy: 1500, sw: 1000, sh: 500 });
    expect(coverRect(1000, 2000, 1000, 500, 0)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 500 });
  });

  it('取的那一塊和目的地同比例、一定在原圖裡面', () => {
    for (const [sw, sh, dw, dh] of [
      [2048, 1152, 720, 1008],
      [300, 2048, 1500, 2100],
      [1, 1, 480, 640],
      [2048, 2048, 320, 200],
    ] as const) {
      const r = coverRect(sw, sh, dw, dh);
      expect(r.sw / r.sh).toBeCloseTo(dw / dh, 9);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(sw + 1e-9);
      expect(r.sy + r.sh).toBeLessThanOrEqual(sh + 1e-9);
    }
  });

  it('尺寸不合理（0、負數、NaN）→ 整張原圖，不丟錯', () => {
    expect(coverRect(400, 200, 0, 100)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
    expect(coverRect(400, 200, Number.NaN, 100)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
    expect(coverRect(0, 200, 10, 10)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 200 });
  });

  it('paintCover：把裁好的那一塊畫滿整張畫布（不壓暗）', () => {
    const calls: unknown[][] = [];
    const ctx = { drawImage: (...args: unknown[]) => void calls.push(args) };
    const image = {} as HTMLImageElement;
    paintCover(ctx as unknown as CanvasRenderingContext2D, { image, width: 1600, height: 900 }, 600, 900);
    expect(calls).toHaveLength(1);
    const [src, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0] as [unknown, ...number[]];
    expect(src).toBe(image);
    expect([sx, sy, sw, sh].map((v) => Math.round(v!))).toEqual([500, 0, 600, 900]);
    expect([dx, dy, dw, dh]).toEqual([0, 0, 600, 900]);
  });

  it('預覽區的亮度約 85%；3D 用同一個亮度換到線性空間', () => {
    expect(PREVIEW_DIM).toBe(0.85);
    expect(PREVIEW_DIM_LINEAR).toBeCloseTo(0.85 ** 2.2, 12);
  });
});

describe('水鏡的遠景平面（waterBackdropPlane）', () => {
  const FOV = 30;
  it('下緣貼水平線、上緣超過畫面頂、左右蓋滿畫面；在卡片後面、水面裡面', () => {
    for (const aspect of [0.8, 1.3, 2.3, 3]) {
      for (const cardH of [ASPECT_HEIGHT.standard, ASPECT_HEIGHT.tarot, 2]) {
        for (const zoom of [ZOOM_MIN, 0.85, 1]) {
          const camZ = cameraDistance(FOV, aspect, zoom, cardBox(cardH), waterReach(cardH));
          const planeY = waterY(cardH);
          const p = waterBackdropPlane(camZ, FOV, aspect, planeY);
          const d = camZ - p.z;
          const halfH = d * Math.tan((FOV / 2) * RAD);
          expect(p.z).toBe(-WATER_BACKDROP.distance);
          expect(planeY + p.height).toBeGreaterThan(halfH); // 上緣在畫面頂上面（世界 y）
          expect(p.width / 2).toBeGreaterThan(halfH * aspect); // 左右蓋滿
          // 水面伸得比遠景遠、也比它寬（遠景下緣和水面之間不會露出空隙）
          expect(-p.z).toBeLessThan(WATER_SIZE.far);
          expect(p.width / 2).toBeLessThan(WATER_SIZE.width / 2);
        }
      }
    }
  });
});

class FakePart implements GalleryPart<string> {
  group = new Group();
  backdrops: (StageBackdrop | null)[] = [];
  constructor(readonly kind: string) {}
  setCardHeight() {}
  setReducedMotion() {}
  setPose() {}
  update() {}
  setThumbs() {}
  setBackdrop(b: StageBackdrop | null) {
    this.backdrops.push(b);
  }
  /** 水鏡的遠景（T-815；stage-switch 只交給水鏡）。 */
  setScene() {}
  /** 遠景的位置與大小（T-822；stage-switch 只交給水鏡）。 */
  setFarPan() {}
  setLook() {}
  dispose() {}
}

/** 沒寫 setBackdrop 的舞台（遠景在 CSS 那層）。 */
class PlainPart {
  group = new Group();
  setCardHeight() {}
  setReducedMotion() {}
  setPose() {}
  update() {}
  setThumbs() {}
  dispose() {}
}

const fakeBackdrop = (w = 1600, h = 900): StageBackdrop => ({ texture: new Texture(), width: w, height: h });

describe('舞台遠景的接點（stage-switch 的 setBackdrop）', () => {
  function setup() {
    const made: FakePart[] = [];
    const maker = (kind: string) => () => {
      const p = new FakePart(kind);
      made.push(p);
      return p;
    };
    const sw = createStageSwitch<string>({
      halo: () => new PlainPart(),
      gallery: maker('gallery') as () => GalleryPart<string>,
      magic: () => new PlainPart(),
      water: maker('water'),
      nebula: maker('nebula'),
      desk: () => new PlainPart(),
    });
    return { sw, made };
  }

  it('交給目前的舞台；同一張再設不做事；記住', () => {
    const { sw, made } = setup();
    sw.setStyle('water');
    const b = fakeBackdrop();
    sw.setBackdrop(b);
    sw.setBackdrop(b);
    expect(made[0]!.backdrops).toEqual([b]);
    expect(sw.backdrop()).toBe(b);
    sw.setBackdrop(null);
    expect(made[0]!.backdrops).toEqual([b, null]);
    expect(sw.backdrop()).toBeNull();
  });

  it('換主題：新建的舞台一建好就收到目前的遠景；沒設過遠景就不叫（舞台本來的樣子）', () => {
    const { sw, made } = setup();
    sw.setStyle('nebula');
    expect(made[0]!.backdrops).toEqual([]);
    const b = fakeBackdrop();
    sw.setBackdrop(b);
    sw.setStyle('water');
    expect(made[1]!.backdrops).toEqual([b]);
  });

  it('沒有 setBackdrop 的舞台（全息光環、魔法陣：遠景在 CSS）、關閉：照樣能設，不丟錯', () => {
    const { sw } = setup();
    const b = fakeBackdrop();
    for (const style of ['halo', 'magic', 'none', 'gallery'] as StageStyle[]) {
      sw.setStyle(style);
      expect(() => sw.setBackdrop(sw.backdrop() ? null : b)).not.toThrow();
    }
  });
});

function drawables(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

describe('水鏡的遠景（water-fx）', () => {
  const camera = () => {
    const c = new PerspectiveCamera(30, 1.6, 0.05, 100);
    c.layers.enable(STAGE_LAYER);
    c.layers.enable(BACKDROP_LAYER);
    c.position.set(0, 0, 6);
    return c;
  };

  it('沒有遠景＝和以前一樣：只有水面、倒影鏡頭只看卡片、水面照舊淡出（uniform 0）', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    expect(drawables(fx.group)).toHaveLength(1);
    expect(fx.backdropMesh()).toBeNull();
    expect(fx.uniforms.backdrop.value).toBe(0);
    expect(fx.reflection.node.reflector.getVirtualCamera(cam).layers.mask).toBe(1 << CARD_LAYER);
  });

  it('有遠景：多一片平面（在水面之後畫、不擋卡片、在 BACKDROP_LAYER），倒影鏡頭也看得到它；水面不淡出', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setBackdrop(fakeBackdrop());
    const plane = fx.backdropMesh()!;
    expect(plane).not.toBeNull();
    expect(drawables(fx.group)).toHaveLength(2);
    const [water] = drawables(fx.group).filter((m) => m !== plane);
    expect(plane.renderOrder).toBeGreaterThan(water!.renderOrder);
    const m = plane.material as Material;
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(false);
    expect(plane.layers.mask).toBe(1 << BACKDROP_LAYER);
    expect(fx.uniforms.backdrop.value).toBe(1);
    expect(fx.reflection.node.reflector.getVirtualCamera(cam).layers.mask).toBe((1 << CARD_LAYER) | (1 << BACKDROP_LAYER));
  });

  it('平面照鏡頭蓋滿水平線以上：下緣在水面（整組原點的高度）、照 waterBackdropPlane 的大小；鏡頭退了跟著變大', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    fx.setBackdrop(fakeBackdrop());
    fx.update(1 / 60);
    const plane = fx.backdropMesh()!;
    const want = waterBackdropPlane(6, 30, 1.6, waterY(ASPECT_HEIGHT.tarot));
    expect(plane.scale.x).toBeCloseTo(want.width, 9);
    expect(plane.scale.y).toBeCloseTo(want.height, 9);
    expect(plane.position.z).toBeCloseTo(want.z, 9);
    plane.geometry.computeBoundingBox();
    expect(plane.geometry.boundingBox!.min.y).toBeCloseTo(0, 12); // 下緣在水面
    const before = plane.scale.x;
    cam.position.z = 10;
    fx.update(1 / 60);
    expect(plane.scale.x).toBeGreaterThan(before);
  });

  it('同一張再設不重建；換一張重建（舊的網格、材質釋放，貼圖不釋放：歸 card-view 管）', () => {
    const fx = createWaterFx({ camera: camera() });
    const a = fakeBackdrop();
    fx.setBackdrop(a);
    const first = fx.backdropMesh()!;
    fx.setBackdrop(a);
    expect(fx.backdropMesh()).toBe(first);
    const freed = new Set<unknown>();
    first.geometry.addEventListener('dispose', () => freed.add('geometry'));
    (first.material as Material).addEventListener('dispose', () => freed.add('material'));
    a.texture.addEventListener('dispose', () => freed.add('texture'));
    fx.setBackdrop(fakeBackdrop(900, 1600));
    expect(fx.backdropMesh()).not.toBe(first);
    expect(first.parent).toBeNull();
    expect([...freed].sort()).toEqual(['geometry', 'material']);
  });

  it('拿掉（null）：平面拿掉並釋放、倒影鏡頭回到只看卡片、水面照舊淡出', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setBackdrop(fakeBackdrop());
    fx.setBackdrop(null);
    expect(fx.backdropMesh()).toBeNull();
    expect(drawables(fx.group)).toHaveLength(1);
    expect(fx.uniforms.backdrop.value).toBe(0);
    expect(fx.reflection.node.reflector.getVirtualCamera(cam).layers.mask).toBe(1 << CARD_LAYER);
  });

  it('dispose 時連遠景平面一起釋放', () => {
    const fx = createWaterFx({ camera: camera() });
    fx.setBackdrop(fakeBackdrop());
    const plane = fx.backdropMesh()!;
    let freed = 0;
    plane.geometry.addEventListener('dispose', () => freed++);
    (plane.material as Material).addEventListener('dispose', () => freed++);
    fx.dispose();
    expect(freed).toBe(2);
  });
});

describe('星雲讓出遠景（nebula-fx）', () => {
  it('有背景圖：漩渦與星際霧不畫（far 0），光暈、星點照舊（draw call 數不變）；拿掉回到 1', () => {
    const fx = createNebulaFx();
    expect(fx.uniforms.far.value).toBe(1);
    const count = drawables(fx.group).length;
    fx.setBackdrop(fakeBackdrop());
    expect(fx.uniforms.far.value).toBe(0);
    expect(drawables(fx.group)).toHaveLength(count);
    fx.setBackdrop(null);
    expect(fx.uniforms.far.value).toBe(1);
  });
});

describe('展示廳讓出石地板（gallery-fx）', () => {
  it('有背景圖：一路鋪到遠處的石地板不畫，台子、光環、光柱、浮著的卡照舊；拿掉回到以前', () => {
    const fx = createGalleryFx({ camera: new PerspectiveCamera(30, 1.6, 0.05, 100), makeCanvas: () => null });
    const meshes = drawables(fx.group);
    const floor = meshes.find((m) => m.renderOrder === 0)!;
    // 大廳地板（T-816，renderOrder 1）只在畫好的大廳讀好時畫，這裡沒設＝本來就不畫
    const others = meshes.filter((m) => m !== floor && m.renderOrder !== 1);
    expect(floor.visible).toBe(true);
    fx.setBackdrop!(fakeBackdrop());
    expect(floor.visible).toBe(false);
    expect(others.every((m) => m.visible)).toBe(true);
    fx.setBackdrop!(null);
    expect(floor.visible).toBe(true);
  });
});
