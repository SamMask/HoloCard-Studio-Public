// 展示廳（T-410、T-816）的 three.js 物件：不擋卡片（先畫、不寫不測深度）、只在舞台那一層（倒影的鏡頭看不到）、
// 浮著的玻璃板放縮圖或沒有圖案、玻璃板照預覽區寬高比重排（T-816c）、三層台、畫好的大廳在後面時地板只疊倒影（T-816）、
// 減少動態效果時靜止、dispose 確實釋放。
// 只建物件、不畫（不需要 WebGPU）。
// 釋放與「時間停住」的證據（T-816b）：拼圖貼圖用 Texture.prototype.dispose 的呼叫紀錄找、倒影的 render target 由包住
// createPlanarReflection 的紀錄拿到再監看、時間相關的 uniform 從材質的節點圖裡撿出數字（fx 本身不對外開 uniform）。
import { DataTexture, Group, Mesh, PerspectiveCamera, Sprite, Texture, type BufferAttribute, type Material, type Object3D } from 'three/webgpu';
import { ASPECT_HEIGHT } from '../src/model/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardObject } from '../src/render/card-mesh';
import { ATLAS_CELL, ATLAS_PLATE, createGalleryFx, floatQuads, type GalleryThumb, type MakeCanvas } from '../src/render/gallery-fx';
import {
  BOKEH_COUNT,
  FLOAT_BOB,
  FLOAT_GLASS_PAD,
  FLOAT_PLATES,
  FLOAT_THUMB_INSET,
  floatCorners,
  floatSlots,
  FLOOR_Y,
  galleryY,
  PETAL_COUNT,
  TIERS,
} from '../src/render/gallery-layout';
import { CARD_LAYER, STAGE_LAYER, type PlanarReflection } from '../src/render/reflection';

/** 展示廳建立的倒影（包住 createPlanarReflection 記下來；fx 本身不對外開倒影）。 */
const made = vi.hoisted(() => ({ reflections: [] as unknown[] }));
vi.mock('../src/render/reflection', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/render/reflection')>();
  return {
    ...mod,
    createPlanarReflection: (...args: Parameters<typeof mod.createPlanarReflection>) => {
      const reflection = mod.createPlanarReflection(...args);
      made.reflections.push(reflection);
      return reflection;
    },
  };
});

afterEach(() => vi.restoreAllMocks());

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

function drawables(root: Object3D): (Mesh | Sprite)[] {
  const out: (Mesh | Sprite)[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Sprite) out.push(o);
  });
  return out.sort((a, b) => a.renderOrder - b.renderOrder);
}

/** 假的 2D 畫布：記下畫了哪些圖、用了什麼模糊。 */
function fakeCanvasMaker() {
  const draws: { image: unknown; filter: string; x: number; y: number; w: number; h: number }[] = [];
  const canvases: HTMLCanvasElement[] = [];
  let count = 0;
  const make: MakeCanvas = (width, height) => {
    count++;
    const ctx = {
      filter: 'none',
      save() {},
      restore() {
        this.filter = 'none';
      },
      drawImage(image: unknown, x: number, y: number, w: number, h: number) {
        draws.push({ image, filter: this.filter, x, y, w, h });
      },
    };
    const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    canvases.push(canvas);
    return canvas;
  };
  return { make, draws, canvases, made: () => count };
}

const thumb = (w = 340, h = 460): GalleryThumb => ({ image: { tag: `${w}x${h}` } as unknown as CanvasImageSource, width: w, height: h });

function setup(makeCanvas?: MakeCanvas) {
  const camera = new PerspectiveCamera(30, 1, 0.05, 100);
  const fx = createGalleryFx({ camera, makeCanvas });
  return { camera, fx, reflection: made.reflections.at(-1) as PlanarReflection };
}

/** 記下之後釋放了哪些貼圖（照常呼叫原本的 dispose）。 */
function watchTextures() {
  const spy = vi.spyOn(Texture.prototype, 'dispose');
  return { freed: () => spy.mock.contexts as Texture[] };
}

/** 材質節點圖裡所有「數字」uniform 的現在值（時間、發光環、閃爍、高度…；貼圖的 uniform 不算）。 */
function numberUniforms(root: Object3D): Map<object, number> {
  const out = new Map<object, number>();
  for (const part of drawables(root)) {
    const material = part.material as unknown as Record<string, unknown>;
    for (const key of Object.keys(material)) {
      const node = material[key] as { isNode?: boolean; traverse?: (f: (n: { isUniformNode?: boolean; value?: unknown }) => void) => void } | null;
      if (!node?.isNode) continue;
      node.traverse!((n) => {
        if (n.isUniformNode && typeof n.value === 'number') out.set(n, n.value);
      });
    }
  }
  return out;
}
const changedCount = (a: Map<object, number>, b: Map<object, number>) => [...a].filter(([node, v]) => b.get(node) !== v).length;

describe('展示廳不擋卡片', () => {
  it('整組比卡片先畫（renderOrder 比卡片小）；每個東西都不寫深度、不測深度、留在不透明那一批', () => {
    const { fx } = setup();
    const card = createCardObject(fakeImage(4, 4), 1, fakeImage(512, 512));
    expect(fx.group.renderOrder).toBeLessThan(card.group.renderOrder);
    const parts = drawables(fx.group);
    // 石地板、大廳地板（T-816，兩個一次只畫一個）、光柱、浮卡、三層台各一個＋台緣光環各一個、花瓣與光點
    expect(parts.length).toBe(11);
    for (const p of parts) {
      const m = p.material as Material;
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
    }
  });

  it('畫的順序：由遠到近，下層台先、上層台後（不測深度也不會蓋錯），花瓣最後', () => {
    const { fx } = setup();
    const orders = drawables(fx.group).map((p) => p.renderOrder);
    expect(new Set(orders).size).toBe(orders.length);
    const tiers = drawables(fx.group).filter((p) => p instanceof Mesh && p.geometry.type === 'LatheGeometry');
    expect(tiers.length).toBe(3);
    // 下層（半徑大）先畫
    const radius = (m: Mesh | Sprite) => {
      (m as Mesh).geometry.computeBoundingSphere();
      return (m as Mesh).geometry.boundingSphere!.radius;
    };
    expect(radius(tiers[0]!)).toBeGreaterThan(radius(tiers[1]!));
    expect(radius(tiers[1]!)).toBeGreaterThan(radius(tiers[2]!));
    expect(drawables(fx.group).at(-1)).toBeInstanceOf(Sprite);
  });

  it('每個東西只在舞台那一層：主鏡頭看得到、倒影的鏡頭（只看卡片那一層）看不到', () => {
    const { fx } = setup();
    const stageMask = 1 << STAGE_LAYER;
    for (const p of drawables(fx.group)) expect(p.layers.mask).toBe(stageMask);
    expect(stageMask & (1 << CARD_LAYER)).toBe(0);
  });

  it('不跟著卡片轉：卡片的角度怎麼變，整組都不轉', () => {
    const { fx } = setup();
    fx.setPose(70, 30);
    fx.update(1 / 60);
    expect(fx.group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('台子跟著卡片比例：原點＝上層台面；地板在下層的底', () => {
    const { fx } = setup();
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    expect(fx.group.position.y).toBeCloseTo(galleryY(ASPECT_HEIGHT.tarot), 12);
    fx.setCardHeight(ASPECT_HEIGHT.standard);
    expect(fx.group.position.y).toBeCloseTo(galleryY(ASPECT_HEIGHT.standard), 12);
    const floor = drawables(fx.group)[0] as Mesh;
    floor.geometry.computeBoundingBox();
    expect(floor.geometry.boundingBox!.max.y).toBeCloseTo(FLOOR_Y, 6); // Float32 頂點
    expect(floor.geometry.boundingBox!.min.y).toBeCloseTo(FLOOR_Y, 6);
    expect(TIERS.length).toBe(3);
  });
});

describe('浮著的卡', () => {
  it('沒有縮圖：六張都是沒有圖案的玻璃板（拼圖是 1×1 的空白，不建畫布）', () => {
    const canvas = fakeCanvasMaker();
    const { fx } = setup(canvas.make);
    fx.setThumbs([]);
    expect(canvas.made()).toBe(0);
    const floats = drawables(fx.group)[3] as Mesh;
    const info = floats.geometry.getAttribute('floatInfo');
    expect(info.count).toBe(FLOAT_PLATES.length * 4);
    for (let i = 0; i < info.count; i++) expect(info.getX(i)).toBe(0);
  });

  it('有縮圖：近的位置先放縮圖、其他放玻璃卡；縮圖畫進拼圖時越遠越糊', () => {
    const canvas = fakeCanvasMaker();
    const { fx } = setup(canvas.make);
    fx.setThumbs([thumb(), thumb(320, 520)]);
    expect(canvas.made()).toBe(1);
    expect(canvas.draws.length).toBe(2);
    const blur = (f: string) => Number(/blur\(([\d.]+)px\)/.exec(f)?.[1]);
    expect(blur(canvas.draws[1]!.filter)).toBeGreaterThan(blur(canvas.draws[0]!.filter));
    const floats = drawables(fx.group)[3] as Mesh;
    const info = floats.geometry.getAttribute('floatInfo');
    // 每個四邊形 4 個頂點（x＝有沒有縮圖、y＝遠近）；有縮圖的兩個是最近的兩個位置
    const withImage: number[] = [];
    for (let q = 0; q < FLOAT_PLATES.length; q++) if (info.getX(q * 4) === 1) withImage.push(Math.fround(info.getY(q * 4)));
    expect(withImage.sort()).toEqual([FLOAT_PLATES[0]!.far, FLOAT_PLATES[1]!.far].map(Math.fround).sort());
  });

  it('超過 6 張只用前 6 張', () => {
    const canvas = fakeCanvasMaker();
    const { fx } = setup(canvas.make);
    fx.setThumbs(Array.from({ length: 9 }, () => thumb()));
    expect(canvas.draws.length).toBe(6);
  });

  it('網格裡由遠到近排（不測深度，照順序畫才不會遠的蓋過近的）', () => {
    const { fx } = setup();
    const floats = drawables(fx.group)[3] as Mesh;
    const pos = floats.geometry.getAttribute('position');
    const zs: number[] = [];
    for (let q = 0; q < FLOAT_PLATES.length; q++) {
      let z = 0;
      for (let k = 0; k < 4; k++) z += pos.getZ(q * 4 + k) / 4;
      zs.push(z);
    }
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
  });

  it('floatQuads：板子一律是標準卡比例（T-816e；縮圖等比放在板子裡），比卡片大一點（四邊空邊）；拼圖 uv 是那一格的板子範圍、在 0～1、照格子排', () => {
    const size = { width: ATLAS_CELL.width * 3, height: ATLAS_CELL.height * 1 };
    const slots = floatSlots(16 / 9, ASPECT_HEIGHT.standard);
    const quads = floatQuads(slots, [1.35, 1.85], size);
    expect(quads.length).toBe(FLOAT_PLATES.length);
    for (const q of quads) if (q.width > 0) expect(q.height / q.width).toBeCloseTo(ASPECT_HEIGHT.standard, 12);
    expect(quads[0]!.width).toBeGreaterThan(slots[0]!.width);
    // uv 範圍＝板子那一塊（同一個比例），不是縮圖本身
    const uv0 = quads[0]!.uv!;
    expect(((uv0.v1 - uv0.v0) * size.height) / ((uv0.u1 - uv0.u0) * size.width)).toBeCloseTo(ASPECT_HEIGHT.standard, 2);
    for (const q of quads.slice(0, 2)) {
      const uv = q.uv!;
      for (const v of [uv.u0, uv.u1, uv.v0, uv.v1]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(uv.u1).toBeGreaterThan(uv.u0);
      expect(uv.v1).toBeGreaterThan(uv.v0);
    }
    expect(quads[1]!.uv!.u0).toBeGreaterThanOrEqual(quads[0]!.uv!.u1); // 第二格在第一格右邊
    expect(quads.slice(2).every((q) => q.uv === null)).toBe(true);
  });

  it('換縮圖清單：舊的網格與拼圖貼圖釋放（新的拼圖留著）', () => {
    const canvas = fakeCanvasMaker();
    const { fx } = setup(canvas.make);
    const watch = watchTextures();
    fx.setThumbs([thumb()]);
    // 第一次換：一開始那張 1×1 的空白拼圖釋放
    expect(watch.freed().some((t) => t instanceof DataTexture)).toBe(true);
    const floats = drawables(fx.group)[3] as Mesh;
    const oldGeometry = floats.geometry;
    let geometryFreed = false;
    oldGeometry.addEventListener('dispose', () => (geometryFreed = true));
    fx.setThumbs([thumb(), thumb()]);
    expect(geometryFreed).toBe(true);
    expect(floats.geometry).not.toBe(oldGeometry);
    // 第二次換：第一張拼圖（畫在第一塊畫布上）釋放、第二張還在用
    expect(canvas.canvases.length).toBe(2);
    expect(watch.freed().some((t) => t.image === canvas.canvases[0])).toBe(true);
    expect(watch.freed().some((t) => t.image === canvas.canvases[1])).toBe(false);
  });

  it('縮圖比例不一（T-816e：9:16 很高、橫的、標準）：板子一律標準卡比例，縮圖等比放進板子（保持自己的比例、在那一格的板子範圍裡置中、碰到一邊）；板子下緣漂到最低時還在台面上方', () => {
    const canvas = fakeCanvasMaker();
    const { camera, fx } = setup(canvas.make);
    camera.aspect = 1.78;
    fx.update(1 / 60);
    const thumbs = [thumb(270, 520), thumb(520, 300), thumb(340, 460), thumb(300, 600)];
    fx.setThumbs(thumbs);
    expect(canvas.draws.length).toBe(thumbs.length);
    canvas.draws.forEach((d, i) => {
      const t = thumbs[i]!;
      expect(d.h / d.w).toBeCloseTo(t.height / t.width, 6);
      const cellX = (i % 3) * ATLAS_CELL.width;
      const cellY = Math.floor(i / 3) * ATLAS_CELL.height;
      const box = { x: cellX + ATLAS_PLATE.x, y: cellY + ATLAS_PLATE.y, w: ATLAS_PLATE.width, h: ATLAS_PLATE.height };
      expect(d.x).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(d.y).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(d.x + d.w).toBeLessThanOrEqual(box.x + box.w + 1e-6);
      expect(d.y + d.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
      expect(d.x + d.w / 2).toBeCloseTo(box.x + box.w / 2, 6);
      expect(d.y + d.h / 2).toBeCloseTo(box.y + box.h / 2, 6);
      expect(Math.max(d.w / box.w, d.h / box.h)).toBeCloseTo(1, 6);
    });
    expect(ATLAS_PLATE.height / ATLAS_PLATE.width).toBeCloseTo(ASPECT_HEIGHT.standard, 2);
    const floats = drawables(fx.group)[3] as Mesh;
    const pos = floats.geometry.getAttribute('position');
    const size = floats.geometry.getAttribute('cardSize');
    let checked = 0;
    for (let q = 0; q < pos.count / 4; q++) {
      const w = size.getX(q * 4);
      if (w === 0) continue;
      const h = size.getY(q * 4);
      expect(h / w).toBeCloseTo(ASPECT_HEIGHT.standard, 5);
      const bottom = Math.min(...[0, 1, 2, 3].map((k) => pos.getY(q * 4 + k)));
      // 玻璃板比四邊形小一圈（FLOAT_GLASS_PAD ÷ FLOAT_THUMB_INSET）
      const glassBottom = bottom + (h * (1 - FLOAT_GLASS_PAD / FLOAT_THUMB_INSET)) / 2;
      expect(glassBottom - FLOAT_BOB).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBe(FLOAT_PLATES.length);
  });

  /** 網格裡每個四邊形的四個角（照 z 由遠到近排，同 floatSlots 的位置 z 排序）與寬（cardSize.x）。 */
  function quadsOf(floats: Mesh) {
    const pos = floats.geometry.getAttribute('position');
    const size = floats.geometry.getAttribute('cardSize');
    return Array.from({ length: pos.count / 4 }, (_, q) => ({
      corners: [0, 1, 2, 3].map((k) => ({ x: pos.getX(q * 4 + k), y: pos.getY(q * 4 + k), z: pos.getZ(q * 4 + k) })),
      width: size.getX(q * 4),
    }));
  }
  /** floatSlots 算出來的位置照網格的順序（遠的先）排、四個角（沒有縮圖的玻璃板：四邊形比卡片大 FLOAT_THUMB_INSET 倍、標準卡比例）。 */
  function expectedQuads(viewAspect: number, cardH: number) {
    return floatSlots(viewAspect, cardH)
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((s) => {
        const w = s.width * FLOAT_THUMB_INSET;
        return { corners: floatCorners(s, w, w * ASPECT_HEIGHT.standard), width: w };
      });
  }
  function expectSameQuads(floats: Mesh, viewAspect: number, cardH: number) {
    const got = quadsOf(floats);
    const want = expectedQuads(viewAspect, cardH);
    expect(got.length).toBe(want.length);
    got.forEach((q, i) => {
      expect(q.width).toBeCloseTo(want[i]!.width, 5);
      q.corners.forEach((c, k) => {
        expect(c.x).toBeCloseTo(want[i]!.corners[k]!.x, 5);
        expect(c.y).toBeCloseTo(want[i]!.corners[k]!.y, 5);
        expect(c.z).toBeCloseTo(want[i]!.corners[k]!.z, 5);
      });
    });
  }

  it('照預覽區寬高比排（T-816c）：一開始照主鏡頭的寬高比；預覽區改大小（camera.aspect）下一格就重排，同一個網格原地改頂點', () => {
    const { camera, fx } = setup();
    const floats = drawables(fx.group)[3] as Mesh;
    // setup 的鏡頭寬高比 1：窄，每邊兩片（第三排寬 0、四個角疊在同一點＝不畫）
    expectSameQuads(floats, 1, ASPECT_HEIGHT.standard);
    expect(quadsOf(floats).filter((q) => q.width === 0).length).toBe(2);
    const geometry = floats.geometry;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const version = position.version;
    camera.aspect = 2.2;
    camera.updateProjectionMatrix();
    fx.update(1 / 60);
    expect(floats.geometry).toBe(geometry);
    expect(geometry.getAttribute('position')).toBe(position);
    expect(position.version).toBeGreaterThan(version);
    expectSameQuads(floats, 2.2, ASPECT_HEIGHT.standard);
    expect(quadsOf(floats).filter((q) => q.width === 0).length).toBe(0);
    // 寬高比沒變：不重傳
    const settled = position.version;
    fx.update(1 / 60);
    fx.update(1 / 60);
    expect(position.version).toBe(settled);
  });

  it('換卡片比例（setCardHeight）也重排；之後換縮圖清單照現在的排法建網格', () => {
    const canvas = fakeCanvasMaker();
    const { camera, fx } = setup(canvas.make);
    camera.aspect = 1.6;
    fx.update(1 / 60);
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    const floats = drawables(fx.group)[3] as Mesh;
    expectSameQuads(floats, 1.6, ASPECT_HEIGHT.tarot);
    fx.setThumbs([]);
    expectSameQuads(floats, 1.6, ASPECT_HEIGHT.tarot);
    // 玻璃板比裡面的卡片大一點（cardSize 是四邊形的大小）
    expect(FLOAT_GLASS_PAD).toBeLessThan(FLOAT_THUMB_INSET);
  });
});

describe('減少動態效果', () => {
  it('花瓣不畫（散景光點照畫）；台子、光柱、浮卡、地板還在', () => {
    const { fx } = setup();
    const parts = drawables(fx.group);
    const sprites = parts.find((p): p is Sprite => p instanceof Sprite)!;
    const shownBefore = parts.filter((p) => p.visible);
    fx.setReducedMotion(true);
    fx.update(1 / 60);
    // 光點排在前面、花瓣在後面：只畫前 BOKEH_COUNT 個＝只有光點
    expect(sprites.visible).toBe(true);
    expect(sprites.count).toBe(BOKEH_COUNT);
    expect(parts.filter((p) => p.visible)).toEqual(shownBefore);
    fx.setReducedMotion(false);
    fx.update(1 / 60);
    expect(sprites.count).toBe(BOKEH_COUNT + PETAL_COUNT);
  });

  it('時間停住：連續更新兩次（轉卡也一樣），時間、發光環、閃爍等 uniform 都不變；沒開減少動態時會變', () => {
    const moving = setup();
    const movingStart = numberUniforms(moving.fx.group);
    expect(movingStart.size).toBeGreaterThan(3); // 撿得到 uniform，下面的「不變」才有意義
    moving.fx.update(1 / 60);
    moving.fx.update(1 / 60);
    expect(changedCount(movingStart, numberUniforms(moving.fx.group))).toBeGreaterThan(0);

    const still = setup();
    still.fx.setReducedMotion(true);
    still.fx.update(1 / 60);
    const first = numberUniforms(still.fx.group);
    still.fx.setPose(80, 25);
    still.fx.update(1 / 60);
    still.fx.setPose(-60, -10);
    still.fx.update(0.5);
    expect(changedCount(first, numberUniforms(still.fx.group))).toBe(0);
  });

  it('花瓣與散景光點：一個 Sprite 一次畫完（一次 draw call），不做視錐剔除', () => {
    const { fx } = setup();
    const sprites = drawables(fx.group).filter((p): p is Sprite => p instanceof Sprite);
    expect(sprites.length).toBe(1);
    expect(sprites[0]!.count).toBe(BOKEH_COUNT + PETAL_COUNT);
    expect(sprites[0]!.frustumCulled).toBe(false);
  });

  it('每格只改數字：跑很多格、轉卡、換比例、切減少動態效果都不換網格與材質', () => {
    const { fx } = setup();
    const before = drawables(fx.group).map((p) => [p, p.geometry, p.material]);
    for (let i = 0; i < 200; i++) {
      fx.setPose(i * 7, Math.sin(i) * 20);
      fx.update(1 / 60);
      if (i === 50) fx.setCardHeight(ASPECT_HEIGHT.tarot);
      if (i === 120) fx.setReducedMotion(true);
    }
    expect(drawables(fx.group).map((p) => [p, p.geometry, p.material])).toEqual(before);
  });
});

describe('畫好的大廳（T-816）', () => {
  /** 預設（沒有大廳圖、沒有背景圖）：石地板；renderOrder 0＝石地板、1＝大廳地板（只疊倒影）。 */
  const floors = (fx: ReturnType<typeof setup>['fx']) => {
    const parts = drawables(fx.group);
    return { stone: parts.find((p) => p.renderOrder === 0)!, hall: parts.find((p) => p.renderOrder === 1)!, parts };
  };
  const fakeBackdrop = () => ({ texture: new Texture(), width: 64, height: 32 });

  it('大廳圖還沒讀好：照以前畫石地板（大廳地板不畫）；每格 draw call＝10', () => {
    const { fx } = setup();
    const f = floors(fx);
    expect(f.stone.visible).toBe(true);
    expect(f.hall.visible).toBe(false);
    expect(f.parts.filter((p) => p.visible).length).toBe(10);
  });

  it('大廳圖讀好（setHall(true)）：石地板讓出來、換成只疊倒影與光的大廳地板；其他照舊；拿掉回到石地板', () => {
    const { fx } = setup();
    const f = floors(fx);
    const others = f.parts.filter((p) => p !== f.stone && p !== f.hall);
    fx.setHall!(true);
    expect(f.stone.visible).toBe(false);
    expect(f.hall.visible).toBe(true);
    expect(others.every((p) => p.visible)).toBe(true);
    expect(f.parts.filter((p) => p.visible).length).toBe(10);
    fx.setHall!(false);
    expect(f.stone.visible).toBe(true);
    expect(f.hall.visible).toBe(false);
  });

  it('大廳地板比石地板小（只蓋住台子周圍、不用整片算），也在地板的高度', () => {
    const { fx } = setup();
    const f = floors(fx);
    const size = (m: Mesh | Sprite) => {
      (m as Mesh).geometry.computeBoundingBox();
      return (m as Mesh).geometry.boundingBox!;
    };
    const hall = size(f.hall);
    const stone = size(f.stone);
    expect(hall.max.x - hall.min.x).toBeLessThan((stone.max.x - stone.min.x) / 3);
    expect(hall.max.y).toBeCloseTo(FLOOR_Y, 6);
    expect(hall.max.x).toBeGreaterThan(TIERS.at(-1)!.radius * 2);
  });

  it('有自己的背景圖（T-814）：兩種地板都不畫（背景圖取代大廳）；拿掉背景圖回到大廳地板', () => {
    const { fx } = setup();
    const f = floors(fx);
    fx.setHall!(true);
    fx.setBackdrop!(fakeBackdrop());
    expect(f.stone.visible).toBe(false);
    expect(f.hall.visible).toBe(false);
    fx.setBackdrop!(null);
    expect(f.hall.visible).toBe(true);
    expect(f.stone.visible).toBe(false);
  });

  it('切大廳不換網格與材質（只切顯示）', () => {
    const { fx } = setup();
    const before = drawables(fx.group).map((p) => [p, p.geometry, p.material]);
    fx.setHall!(true);
    fx.update(1 / 60);
    fx.setHall!(false);
    expect(drawables(fx.group).map((p) => [p, p.geometry, p.material])).toEqual(before);
  });
});

describe('釋放', () => {
  it('dispose：所有網格（Sprite 共用的除外）、材質、拼圖貼圖、倒影的 render target 都釋放，並從場景拿掉', () => {
    const canvas = fakeCanvasMaker();
    const { camera, fx, reflection } = setup(canvas.make);
    fx.setThumbs([thumb()]);
    const parent = new Group();
    parent.add(fx.group);
    const freed = new Set<unknown>();
    const watch = (o: { addEventListener(t: 'dispose', f: () => void): void }) => o.addEventListener('dispose', () => freed.add(o));
    const parts = drawables(fx.group);
    const meshes = parts.filter((p): p is Mesh => p instanceof Mesh);
    for (const m of meshes) watch(m.geometry);
    for (const p of parts) watch(p.material as Material);
    // 倒影的 render target 在第一次畫的時候才建：這裡先要一個出來才有東西可以看它有沒有被釋放
    const renderTarget = reflection.node.reflector.getRenderTarget(reflection.node.reflector.getVirtualCamera(camera));
    watch(renderTarget);
    const textures = watchTextures();
    fx.dispose();
    for (const m of meshes) expect(freed.has(m.geometry)).toBe(true);
    for (const p of parts) expect(freed.has(p.material)).toBe(true);
    expect(freed.has(renderTarget)).toBe(true);
    // 拼圖貼圖（畫在那塊假畫布上的那張）也釋放
    expect(textures.freed().some((t) => t.image === canvas.canvases[0])).toBe(true);
    expect(fx.group.parent).toBeNull();
  });
});
