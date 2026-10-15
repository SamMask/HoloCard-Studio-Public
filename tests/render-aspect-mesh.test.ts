// T-807 卡片比例在 card-mesh：網格（卡身、卡面）與卡套照 aspectHeight 的卡高；同一個卡高（例如自訂 63:88＝標準卡）不重建網格。
// 只建 three.js 物件、不畫（不需要 WebGPU）。
import type { Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { type Card, HOLO_PALETTES, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';
import { CARD_THICKNESS } from '../src/render/fit';
import { SLEEVE } from '../src/render/sleeve';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;
const images = new Map<string, HTMLImageElement>([['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)]]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0.1, y: -0.2, scale: 1.2, holo: true, hasAlpha: depth > 0 };
}

function card(over: Partial<Card> = {}): Card {
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0)] },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50, style: 'ornate' },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...over,
  };
}

const make = () => createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
const bodyBox = (obj: ReturnType<typeof make>) => {
  const g = (obj.group.children[0] as Mesh).geometry;
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe('card-mesh：網格照卡高', () => {
  it('五種比例：輪廓與卡身網格的半高＝卡高／2（橫式 3:2 是 1/3），半寬 0.5、厚度不變', () => {
    const cases: [Partial<Card>, number][] = [
      [{ aspect: 'standard' }, 88 / 63 / 2],
      [{ aspect: 'tarot' }, 120 / 70 / 2],
      [{ aspect: 'square' }, 0.5],
      [{ aspect: 'postcard' }, 0.74],
      [{ aspect: 'custom', customAspect: { width: 3, height: 2 } }, 1 / 3],
      [{ aspect: 'custom', customAspect: { width: 1, height: 2 } }, 1],
    ];
    for (const [over, halfH] of cases) {
      const obj = make();
      obj.update(card(over), getImage);
      expect(obj.outline().halfH, JSON.stringify(over)).toBeCloseTo(halfH, 12);
      expect(obj.outline().halfW).toBe(0.5);
      const b = bodyBox(obj);
      expect(b.max.y).toBeCloseTo(halfH, 6);
      expect(b.min.y).toBeCloseTo(-halfH, 6);
      expect(b.max.x).toBeCloseTo(0.5, 6);
      expect(b.max.z - b.min.z).toBeCloseTo(CARD_THICKNESS, 9);
    }
  });

  it('換比例才重建網格；自訂 63:88 和標準卡同一個卡高，不重建', () => {
    const obj = make();
    obj.update(card(), getImage);
    const g = (obj.group.children[0] as Mesh).geometry;
    obj.update(card({ aspect: 'custom', customAspect: { width: 63, height: 88 } }), getImage);
    expect((obj.group.children[0] as Mesh).geometry === g).toBe(true);
    obj.update(card({ aspect: 'custom', customAspect: { width: 126, height: 176 } }), getImage);
    expect((obj.group.children[0] as Mesh).geometry === g).toBe(true);
    obj.update(card({ aspect: 'square' }), getImage);
    expect((obj.group.children[0] as Mesh).geometry === g).toBe(false);
    expect(obj.outline().halfH).toBe(0.5);
  });

  it('透明卡套跟著新比例（橫式自訂）', () => {
    const obj = make();
    obj.update(card({ aspect: 'custom', customAspect: { width: 3, height: 2 }, view: { returnToFront: true, showcase: false, stage: 'halo', sleeve: true } }), getImage);
    const sleeve = obj.group.children[3]!;
    const near = sleeve.children[0] as Mesh;
    near.geometry.computeBoundingBox();
    expect(near.geometry.boundingBox!.max.y).toBeCloseTo(1 / 3 + SLEEVE.margin, 6);
    expect(near.geometry.boundingBox!.max.x).toBeCloseTo(0.5 + SLEEVE.margin, 6);
  });
});
