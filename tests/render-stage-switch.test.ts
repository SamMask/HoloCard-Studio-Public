// 舞台主題的切換（T-410、T-415、T-832）：一次只有一種在場景裡；換主題時舊的整組拿掉並釋放、新的才建；記住比例、角度、
// 減少動態效果與縮圖清單；擷取時整組不畫；取景只在展示廳、水鏡變。另外用真的七種舞台各建一次，確認換掉時 GPU 資源確實釋放。
import { Group, Mesh, PerspectiveCamera, Sprite, type Material, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { STAGE_STYLES } from '../src/model/limits';
import { ASPECT_HEIGHT, type StageStyle } from '../src/model/types';
import { boundingRadius, cardBox } from '../src/render/fit';
import { createGalleryFx } from '../src/render/gallery-fx';
import { galleryReach } from '../src/render/gallery-layout';
import { createDeskFx } from '../src/render/desk-fx';
import { createMagicFx } from '../src/render/magic-fx';
import { createNebulaFx } from '../src/render/nebula-fx';
import { createStageFx } from '../src/render/stage-fx';
import { createStageSwitch, stageReach, type GalleryPart, type StagePart } from '../src/render/stage-switch';
import { createWaterFx } from '../src/render/water-fx';
import { waterReach } from '../src/render/water-layout';

type Kind = Exclude<StageStyle, 'none'>;

class FakePart implements GalleryPart<string> {
  group = new Group();
  cardH: number | null = null;
  reduced: boolean | null = null;
  pose: [number, number] | null = null;
  thumbs: readonly string[] | null = null;
  updates = 0;
  disposed = false;
  constructor(readonly kind: Kind) {}
  setCardHeight(h: number) {
    this.cardH = h;
  }
  setReducedMotion(r: boolean) {
    this.reduced = r;
  }
  setPose(y: number, p: number) {
    this.pose = [y, p];
  }
  update() {
    this.updates++;
  }
  setThumbs(t: readonly string[]) {
    this.thumbs = t;
  }
  /** 水鏡的遠景（T-815；這裡的假舞台都有，stage-switch 只交給水鏡）。 */
  setScene() {}
  /** 遠景的位置與大小（T-822；同上，只交給水鏡）。 */
  setFarPan() {}
  setLook() {}
  /** 畫好的大廳讀好了沒（T-816；只交給展示廳）。 */
  hall: boolean | null = null;
  setHall(shown: boolean) {
    this.hall = shown;
  }
  dispose() {
    this.disposed = true;
  }
}

function setup() {
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

describe('切換主題', () => {
  it('還沒設定前什麼都不建；容器排在卡片之前畫', () => {
    const { sw, made } = setup();
    expect(made.length).toBe(0);
    expect(sw.style()).toBeNull();
    expect(sw.group.children.length).toBe(0);
    expect(sw.group.renderOrder).toBeLessThan(0);
  });

  it('全息光環 → 展示廳 → 關閉 → 全息光環：每次換掉的那組從容器拿掉並 dispose，新的才建', () => {
    const { sw, made } = setup();
    sw.setStyle('halo');
    expect(made.map((p) => p.kind)).toEqual(['halo']);
    expect(sw.group.children).toEqual([made[0]!.group]);

    sw.setStyle('gallery');
    expect(made[0]!.disposed).toBe(true);
    expect(made[1]!.kind).toBe('gallery');
    expect(sw.group.children).toEqual([made[1]!.group]);

    sw.setStyle('none');
    expect(made[1]!.disposed).toBe(true);
    expect(sw.group.children.length).toBe(0);
    expect(made.length).toBe(2);

    sw.setStyle('halo');
    expect(made.length).toBe(3);
    expect(made[2]!.disposed).toBe(false);
    expect(sw.style()).toBe('halo');
  });

  it('七種都建得出來（T-415、T-832 工作桌）：每個主題建對應的那一組；依序換一輪，每次換掉的都 dispose、容器裡永遠只有一組', () => {
    const { sw, made } = setup();
    const order: StageStyle[] = ['halo', 'magic', 'water', 'nebula', 'gallery', 'desk', 'none', 'nebula', 'desk', 'water', 'magic'];
    for (const style of order) {
      sw.setStyle(style);
      expect(sw.style()).toBe(style);
      if (style === 'none') {
        expect(sw.group.children.length).toBe(0);
        continue;
      }
      const latest = made.at(-1)!;
      expect(latest.kind).toBe(style);
      expect(latest.disposed).toBe(false);
      expect(sw.group.children).toEqual([latest.group]);
      expect(made.slice(0, -1).every((p) => p.disposed)).toBe(true);
    }
    expect(made.length).toBe(order.filter((s) => s !== 'none').length);
    // 契約裡的每一種都處理到了
    expect([...STAGE_STYLES].sort()).toEqual(['desk', 'gallery', 'halo', 'magic', 'nebula', 'none', 'water']);
  });

  it('新場景一建好也套上目前的比例、減少動態效果、角度（縮圖只給展示廳）', () => {
    const { sw, made } = setup();
    sw.setCardHeight(ASPECT_HEIGHT.tarot);
    sw.setReducedMotion(true);
    sw.setPose(30, 5);
    sw.setThumbs(['a']);
    for (const style of ['magic', 'water', 'nebula', 'desk'] as const) {
      sw.setStyle(style);
      const p = made.at(-1)!;
      expect(p.cardH).toBe(ASPECT_HEIGHT.tarot);
      expect(p.reduced).toBe(true);
      expect(p.pose).toEqual([30, 5]);
      expect(p.thumbs).toBeNull();
    }
  });

  it('同一個主題再設一次不做事（不重建）', () => {
    const { sw, made } = setup();
    sw.setStyle('gallery');
    sw.setStyle('gallery');
    expect(made.length).toBe(1);
    expect(made[0]!.disposed).toBe(false);
  });

  it('新建的那組一建好就套上目前的比例、減少動態效果、角度；展示廳拿到記住的縮圖', () => {
    const { sw, made } = setup();
    sw.setCardHeight(ASPECT_HEIGHT.tarot);
    sw.setReducedMotion(true);
    sw.setPose(42, -8);
    sw.setThumbs(['a', 'b']);
    sw.setStyle('gallery');
    const g = made[0]!;
    expect(g.cardH).toBe(ASPECT_HEIGHT.tarot);
    expect(g.reduced).toBe(true);
    expect(g.pose).toEqual([42, -8]);
    expect(g.thumbs).toEqual(['a', 'b']);
    // 之後改的也轉給它
    sw.setThumbs(['c']);
    expect(g.thumbs).toEqual(['c']);
    sw.update(1 / 60);
    expect(g.updates).toBe(1);
  });

  it('畫好的大廳（T-816）：記住、只交給展示廳；換到展示廳時新建的一建好就收到；之後改的也轉給它', () => {
    const { sw, made } = setup();
    expect(sw.galleryHall()).toBe(false);
    sw.setGalleryHall(true);
    expect(sw.galleryHall()).toBe(true);
    for (const style of ['halo', 'magic', 'water', 'nebula', 'desk'] as const) {
      sw.setStyle(style);
      expect(made.at(-1)!.hall).toBeNull();
    }
    sw.setStyle('gallery');
    const g = made.at(-1)!;
    expect(g.hall).toBe(true);
    sw.setGalleryHall(false);
    expect(g.hall).toBe(false);
  });

  it('關閉時每格不做事、改設定也不建東西', () => {
    const { sw, made } = setup();
    sw.setStyle('none');
    sw.update(1 / 60);
    sw.setCardHeight(ASPECT_HEIGHT.standard);
    sw.setPose(1, 2);
    sw.setThumbs(['x']);
    expect(made.length).toBe(0);
  });
});

describe('擷取時不畫舞台', () => {
  it('hidden(fn)：fn 執行時容器隱藏、結束後還原；fn 丟例外也還原', () => {
    const { sw } = setup();
    sw.setStyle('gallery');
    expect(sw.hidden(() => sw.group.visible)).toBe(false);
    expect(sw.group.visible).toBe(true);
    expect(() =>
      sw.hidden(() => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(sw.group.visible).toBe(true);
  });
});

describe('取景只在需要的場景變（stageReach）', () => {
  it('全息光環、魔法陣、星雲、工作桌、關閉、還沒設定：不改取景（null）', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      for (const style of ['halo', 'magic', 'nebula', 'desk', 'none', null] as const) expect(stageReach(style, ASPECT_HEIGHT[aspect])).toBeNull();
    }
  });

  it('展示廳：照 galleryReach；水鏡：照 waterReach（上下比卡片外接球多、左右不多退）', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      expect(stageReach('gallery', ASPECT_HEIGHT[aspect])).toEqual(galleryReach(ASPECT_HEIGHT[aspect]));
      const w = stageReach('water', ASPECT_HEIGHT[aspect])!;
      expect(w).toEqual(waterReach(ASPECT_HEIGHT[aspect]));
      expect(w.y).toBeGreaterThan(boundingRadius(cardBox(ASPECT_HEIGHT[aspect])));
      expect(w.x).toBeCloseTo(boundingRadius(cardBox(ASPECT_HEIGHT[aspect])), 12);
    }
  });
});

describe('真的物件：換掉時 GPU 資源確實釋放', () => {
  const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

  function watchAll(root: Object3D): () => boolean {
    const pending = new Set<unknown>();
    const watch = (o: { addEventListener(t: 'dispose', f: () => void): void }) => {
      pending.add(o);
      o.addEventListener('dispose', () => pending.delete(o));
    };
    root.traverse((o) => {
      if (o instanceof Mesh) watch(o.geometry);
      if (o instanceof Mesh || o instanceof Sprite) watch(o.material as Material);
    });
    return () => pending.size === 0;
  }

  it('全息光環 → 展示廳 → 全息光環：每次換掉的那組網格、材質全部 dispose', () => {
    const camera = new PerspectiveCamera(30, 1, 0.05, 100);
    const sw = createStageSwitch({
      halo: (): StagePart => {
        const fx = createStageFx(fakeImage(1600, 480), 8);
        fx.setStyle('halo');
        return fx;
      },
      gallery: () => createGalleryFx({ camera }),
      magic: () => createMagicFx(),
      water: () => createWaterFx({ camera }),
      nebula: () => createNebulaFx(),
      desk: () => createDeskFx({ camera }),
    });
    sw.setStyle('halo');
    const haloFreed = watchAll(sw.group);
    sw.setStyle('gallery');
    expect(haloFreed()).toBe(true);
    const galleryFreed = watchAll(sw.group);
    sw.setStyle('halo');
    expect(galleryFreed()).toBe(true);
    expect(sw.group.children.length).toBe(1);
  });

  it('七種輪流換三輪（T-415、T-832）：每次換掉的那組網格、材質全部 dispose；水鏡、工作桌的倒影 render target 也釋放', () => {
    const camera = new PerspectiveCamera(30, 1, 0.05, 100);
    const waters: ReturnType<typeof createWaterFx>[] = [];
    const reflectionsFreed = new Set<unknown>();
    const desks: ReturnType<typeof createDeskFx>[] = [];
    const deskReflectionsFreed = new Set<unknown>();
    const sw = createStageSwitch({
      halo: (): StagePart => {
        const fx = createStageFx(fakeImage(1600, 480), 8);
        fx.setStyle('halo');
        return fx;
      },
      gallery: () => createGalleryFx({ camera }),
      magic: () => createMagicFx(),
      water: () => {
        const fx = createWaterFx({ camera });
        waters.push(fx);
        fx.reflection.node.addEventListener('dispose', () => reflectionsFreed.add(fx));
        return fx;
      },
      nebula: () => createNebulaFx(),
      desk: () => {
        const fx = createDeskFx({ camera });
        desks.push(fx);
        fx.reflection.node.addEventListener('dispose', () => deskReflectionsFreed.add(fx));
        return fx;
      },
    });
    const order: StageStyle[] = ['magic', 'water', 'nebula', 'halo', 'desk', 'gallery'];
    let freed: (() => boolean) | null = null;
    for (let round = 0; round < 3; round++) {
      for (const style of order) {
        sw.setStyle(style);
        if (freed) expect(freed()).toBe(true);
        expect(sw.group.children.length).toBe(1);
        sw.update(1 / 60);
        // 擷取時整組不畫（水鏡的水面不畫，倒影的 pass 也就不會跑）
        expect(sw.hidden(() => sw.group.visible)).toBe(false);
        expect(sw.group.visible).toBe(true);
        freed = watchAll(sw.group);
      }
    }
    sw.setStyle('none');
    expect(freed!()).toBe(true);
    expect(sw.group.children.length).toBe(0);
    expect(waters.length).toBe(3);
    expect(reflectionsFreed.size).toBe(3);
    expect(desks.length).toBe(3);
    expect(deskReflectionsFreed.size).toBe(3);
  });
});
