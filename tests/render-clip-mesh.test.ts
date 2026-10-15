// T-803 剪裁遮色片（SCHEMA §1 Layer.clip?）在 card-mesh 的部分：只建 three.js 物件、不畫（不需要 WebGPU）。
// 1. 沒有剪裁中的層（沒寫、明寫 false、下面是底圖、任一方破框）：shader 和沒有這個欄位時一模一樣（節點圖指紋；
//    一般卡和 T-803 以前一樣另外由 render-lineart-mesh.test.ts 的七個指紋驗）。
// 2. 剪裁中的層：換材質、多了乘下面那層 alpha 的節點；不投自己的景深陰影；下面那層的圖還沒好時先不畫。
// 3. 改下面那層的 depth（剪裁層跟著改）只改 uniform、不換材質。
// 4. 點選：破框層一定不剪裁（clipParent），所以點卡外的破框層照舊點得到（剪掉的地方不會被點到，因為破框層不會被剪）。
import type { Mesh, MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { HOLO_PALETTES, type Card, type Layer } from '../src/model/types';
import { createCardObject, type GetImage } from '../src/render/card-mesh';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
  ['cccccccccccccccc', fakeImage(800, 800)],
]);
const getImage: GetImage = (hash) => images.get(hash);

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: true, hasAlpha: depth > 0, ...over };
}

const BASE = layer('base', 'aaaaaaaaaaaaaaaa', 0, { holo: false });
const HERO = layer('hero', 'bbbbbbbbbbbbbbbb', 50);
const pattern = (over: Partial<Layer> = {}) => layer('pat', 'cccccccccccccccc', 50, { scale: 1.2, ...over });

function card(front: Layer[], over: Partial<Card> = {}): Card {
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: front },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...over,
  };
}

/** 走一遍卡面材質的節點圖：[節點數, FNV-1a 雜湊, 景深陰影的取樣數（有 mip 等級的貼圖取樣）]（同 render-lineart-mesh 的指紋）。 */
function signature(mesh: Mesh): [number, string, number] {
  const root = (mesh.material as MeshBasicNodeMaterial).colorNode;
  const order = new Map<Node, number>();
  let text = '';
  let taps = 0;
  const visit = (node: Node) => {
    const seen = order.get(node);
    if (seen !== undefined) {
      text += `@${seen};`;
      return;
    }
    order.set(node, order.size);
    const n = node as unknown as Record<string, unknown>;
    let label = String(n.type ?? node.constructor.name);
    if (typeof n.op === 'string') label += `:${n.op}`;
    if (typeof n.method === 'string') label += `:${n.method}`;
    if (n.isConstNode === true) label += `=${JSON.stringify(n.value)}`;
    if (n.isUniformNode === true && typeof n.value === 'number') label += `~${n.value}`;
    if (n.isTextureNode === true && n.levelNode) taps++;
    text += `${label}(`;
    for (const child of node.getChildren()) visit(child);
    text += ')';
  };
  if (root) visit(root);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return [order.size, h.toString(16).padStart(8, '0'), taps];
}

function faces(c: Card, images: GetImage = getImage): { front: [number, string, number]; back: [number, string, number] } {
  const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
  obj.update(c, images);
  const [, front, back] = obj.group.children as Mesh[];
  return { front: signature(front!), back: signature(back!) };
}

describe('沒有剪裁中的層：shader 和沒有 clip 欄位時一模一樣', () => {
  it('明寫 clip: false＝省略', () => {
    expect(faces(card([BASE, HERO, pattern({ clip: false })]))).toEqual(faces(card([BASE, HERO, pattern()])));
  });

  it('下面是底圖、下面沒有層 → 照一般層畫（連影子也照投）', () => {
    expect(faces(card([BASE, pattern({ clip: true })]))).toEqual(faces(card([BASE, pattern()])));
    expect(faces(card([pattern({ clip: true }), HERO]))).toEqual(faces(card([pattern(), HERO])));
  });

  it('任一方衝出卡片 → 照一般層畫', () => {
    expect(faces(card([BASE, HERO, pattern({ clip: true, breakout: true })]))).toEqual(faces(card([BASE, HERO, pattern({ breakout: true })])));
    const heroOut = { ...HERO, breakout: true };
    expect(faces(card([BASE, heroOut, pattern({ clip: true })]))).toEqual(faces(card([BASE, heroOut, pattern()])));
  });
});

describe('剪裁中的層（T-803）', () => {
  it('換材質、多了乘下面那層 alpha 的節點；背面不動', () => {
    const plain = faces(card([BASE, HERO, pattern()]));
    const clipped = faces(card([BASE, HERO, pattern({ clip: true })]));
    expect(clipped.front).not.toEqual(plain.front);
    expect(clipped.back).toEqual(plain.back);
  });

  it('剪裁層不投自己的景深陰影（下面那層照投）', () => {
    const plain = faces(card([BASE, HERO, pattern()]));
    const clipped = faces(card([BASE, HERO, pattern({ clip: true })]));
    const heroOnly = faces(card([BASE, HERO]));
    expect(heroOnly.front[2]).toBeGreaterThan(0);
    expect(plain.front[2]).toBe(heroOnly.front[2] * 2);
    expect(clipped.front[2]).toBe(heroOnly.front[2]);
  });

  it('好幾層剪裁到同一層：每層各乘一次，兩層都不投影子', () => {
    const two = faces(card([BASE, HERO, pattern({ clip: true }), layer('pat2', 'cccccccccccccccc', 50, { clip: true, blend: 'screen' })]));
    const heroOnly = faces(card([BASE, HERO]));
    expect(two.front[2]).toBe(heroOnly.front[2]);
    expect(two.front[0]).toBeGreaterThan(faces(card([BASE, HERO, pattern({ clip: true })])).front[0]);
  });

  it('下面那層的圖還沒準備好：剪裁層先不畫（和只有下面那層一樣）', () => {
    const noHero: GetImage = (h) => (h === 'bbbbbbbbbbbbbbbb' ? undefined : images.get(h));
    expect(faces(card([BASE, HERO, pattern({ clip: true })]), noHero)).toEqual(faces(card([BASE, HERO]), noHero));
  });

  it('同一個物件：打開剪裁 → 換材質；改下面那層的 depth（剪裁層跟著）→ 只改 uniform；關掉 → 換回來', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const front = () => (obj.group.children as Mesh[])[1]!;
    obj.update(card([BASE, HERO, pattern()]), getImage);
    const off = front().material;
    obj.update(card([BASE, HERO, pattern({ clip: true })]), getImage);
    const on = front().material;
    expect(on === off).toBe(false);
    obj.update(card([BASE, { ...HERO, depth: 80 }, pattern({ clip: true, depth: 80 })]), getImage);
    obj.setView(30, -10);
    expect(front().material === on).toBe(true);
    obj.update(card([BASE, HERO, pattern()]), getImage);
    expect(front().material === on).toBe(false);
  });
});

describe('點選（T-803 第 3 項）', () => {
  it('開了剪裁的破框層不剪裁：卡外有畫到的地方照樣點得到', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(card([BASE, HERO, pattern({ clip: true, breakout: true, scale: 2 })]), getImage);
    obj.setView(0, 0);
    expect(obj.breakoutAt('front', 0.7, 0)).toBe('pat');
  });
});
