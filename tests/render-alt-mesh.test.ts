// T-805 雙圖光柵在 card-mesh 的部分：只建 three.js 物件、不畫（不需要 WebGPU）。
// 1. 沒有變身圖的卡 shader 不變：tests/render-lineart-mesh.test.ts 的 7 個指紋（不在這裡重複）。
// 2. 有變身圖的層：換材質、多了取樣變身圖與切換的節點；背面不動；變身圖還沒準備好、破框層／底圖／文字層帶了 alt
//    （不合格的資料）→ 和沒有變身圖一模一樣；轉角度（setView）只改 uniform、不換材質；換變身圖／拿掉 → 換材質。
import type { Mesh, MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { HOLO_PALETTES, type Card, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
  ['cccccccccccccccc', fakeImage(800, 800)],
  ['eeeeeeeeeeeeeeee', fakeImage(600, 900)],
]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: true, hasAlpha: depth > 0, ...over };
}

const ALT = { image: 'eeeeeeeeeeeeeeee', hasAlpha: true };

function card(heroOver: Partial<Layer> = {}, over: Partial<Card> = {}): Card {
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0, { holo: false }), layer('hero', 'bbbbbbbbbbbbbbbb', 50, heroOver)] },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...over,
  };
}

/** 卡面材質的節點圖指紋：[節點數, FNV-1a 雜湊]（同 render-lineart-mesh.test.ts）。 */
function signature(mesh: Mesh): [number, string] {
  const root = (mesh.material as MeshBasicNodeMaterial).colorNode;
  const order = new Map<Node, number>();
  let text = '';
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
  return [order.size, h.toString(16).padStart(8, '0')];
}

function faces(c: Card, get = getImage): { front: [number, string]; back: [number, string] } {
  const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
  obj.update(c, get);
  const [, front, back] = obj.group.children as Mesh[];
  return { front: signature(front!), back: signature(back!) };
}

/** 節點圖裡有沒有取樣這張圖（texture 節點的 value.image 是 card-mesh 的預乘貼圖，image.width 對得上就算）。 */
function samplesSize(mesh: Mesh, w: number, h: number): boolean {
  const root = (mesh.material as MeshBasicNodeMaterial).colorNode;
  const seen = new Set<Node>();
  let found = false;
  const visit = (node: Node) => {
    if (seen.has(node) || found) return;
    seen.add(node);
    const n = node as unknown as { isTextureNode?: boolean; value?: { image?: { width?: number; height?: number } } };
    if (n.isTextureNode && n.value?.image?.width === w && n.value.image.height === h) found = true;
    for (const child of node.getChildren()) visit(child);
  };
  if (root) visit(root);
  return found;
}

describe('有變身圖的層（T-805）', () => {
  it('加上 → 正面換材質、節點變多、有取樣變身圖；背面不動', () => {
    const plain = faces(card());
    const on = faces(card({ alt: ALT }));
    expect(on.front).not.toEqual(plain.front);
    expect(on.front[0]).toBeGreaterThan(plain.front[0]);
    expect(on.back).toEqual(plain.back);
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(card({ alt: ALT }), getImage);
    expect(samplesSize((obj.group.children as Mesh[])[1]!, 600, 900)).toBe(true);
    obj.update(card(), getImage);
    expect(samplesSize((obj.group.children as Mesh[])[1]!, 600, 900)).toBe(false);
  });

  it('變身圖還沒準備好（登記簿還沒有）→ 先照沒有變身圖畫；圖到了換材質', () => {
    const plain = faces(card());
    const missing = (hash: string) => (hash === ALT.image ? undefined : images.get(hash));
    expect(faces(card({ alt: ALT }), missing)).toEqual(plain);
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(card({ alt: ALT }), missing);
    const front = () => (obj.group.children as Mesh[])[1]!;
    const before = front().material;
    obj.update(card({ alt: ALT }), getImage);
    expect(front().material === before).toBe(false);
    expect(signature(front())).toEqual(faces(card({ alt: ALT })).front);
  });

  it('破框層、底圖、文字層帶了 alt（不合格的資料）也不畫變身圖：shader 和沒帶一模一樣', () => {
    expect(faces(card({ alt: ALT, breakout: true, scale: 1.5 }))).toEqual(faces(card({ breakout: true, scale: 1.5 })));
    const baseAlt = card();
    baseAlt.front.layers[0] = { ...baseAlt.front.layers[0]!, alt: ALT };
    expect(faces(baseAlt)).toEqual(faces(card()));
    const text = { content: '龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
    expect(faces(card({ text, alt: ALT }))).toEqual(faces(card({ text })));
  });

  it('同一個物件：轉角度、拖鐳射強度、移動圖層只改 uniform（不換材質）；換一張變身圖、拿掉 → 換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const front = () => (obj.group.children as Mesh[])[1]!;
    obj.update(card({ alt: ALT }), getImage);
    const on = front().material;
    for (const yaw of [0, 7, -7, 20]) obj.setView(yaw, -5);
    obj.update(card({ alt: ALT, x: 0.2, scale: 0.7 }), getImage);
    const c = card({ alt: ALT });
    obj.update({ ...c, holo: { ...c.holo, strength: 10 } }, getImage);
    expect(front().material === on).toBe(true);
    obj.update(card({ alt: { image: 'cccccccccccccccc', hasAlpha: true } }), getImage);
    const swapped = front().material;
    expect(swapped === on).toBe(false);
    obj.update(card(), getImage);
    expect(front().material === swapped).toBe(false);
    expect(signature(front())).toEqual(faces(card()).front);
  });

  it('背面的層有變身圖：背面換材質、正面不動', () => {
    const backLayers = (alt: boolean): Card =>
      card({}, { back: { layers: [layer('bb', 'cccccccccccccccc', 0, { holo: false }), layer('bh', 'bbbbbbbbbbbbbbbb', 60, alt ? { alt: ALT } : {})] } });
    const off = faces(backLayers(false));
    const on = faces(backLayers(true));
    expect(on.front).toEqual(off.front);
    expect(on.back[0]).toBeGreaterThan(off.back[0]);
  });

  it('加深層（不投影）也能有變身圖；投影的層比不投影的多取樣變身圖的影子', () => {
    const shadowLayer = faces(card({ alt: ALT })).front[0] - faces(card()).front[0];
    const noShadowLayer = faces(card({ alt: ALT, blend: 'screen' })).front[0] - faces(card({ blend: 'screen' })).front[0];
    expect(shadowLayer).toBeGreaterThan(noShadowLayer);
    const ink = card({ alt: { image: 'cccccccccccccccc', hasAlpha: false }, blend: 'multiply', hasAlpha: false });
    const inkPlain = card({ blend: 'multiply', hasAlpha: false });
    expect(faces(ink).front[0]).toBeGreaterThan(faces(inkPlain).front[0]);
  });
});
