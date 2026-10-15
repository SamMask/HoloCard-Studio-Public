// T-802 線稿高光（SCHEMA §1 Layer.lineart?）在 card-mesh 的部分：只建 three.js 物件、不畫（不需要 WebGPU）。
// 1. 沒開線稿高光的卡，shader 和 T-802 以前一模一樣（節點圖的結構指紋＝d3847b8 記下的值；同 T-411d「沒有就不建新節點」）。
//    指紋＝由 colorNode 往下走一遍，每個節點的種類／運算／常數值依序串起來的 FNV-1a 雜湊（不含節點編號，同一份程式每次一樣）。
//    之後的任務要是刻意改了一般卡的 shader，重新記這幾個值（並在 commit 說明為什麼變）。
import type { Mesh, MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { HOLO_PALETTES, type Card, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
  ['cccccccccccccccc', fakeImage(800, 800)],
  ['dddddddddddddddd', fakeImage(200, 200)],
]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: true, hasAlpha: depth > 0, ...over };
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
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0, { holo: false }), layer('hero', 'bbbbbbbbbbbbbbbb', 50)] },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...over,
  };
}

/** 卡面材質的節點圖指紋：[節點數, FNV-1a 雜湊]。 */
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

function faces(c: Card): { front: [number, string]; back: [number, string] } {
  const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
  obj.update(c, getImage);
  const [, front, back] = obj.group.children as Mesh[];
  return { front: signature(front!), back: signature(back!) };
}

/** 幾種一般的卡（沒有線稿高光）：預設整面、用圖層形狀＋霧光、黑白圖、加深層（沒有透明）、破框層、雕花邊角、背面素色卡背。 */
const CASES: Record<string, () => Card> = {
  整面: () => card(),
  用圖層形狀: () => card({ front: { ...card().front, foil: { shape: 'layers', frame: false } } }),
  黑白圖: () => card({ front: { ...card().front, foil: { shape: 'mask', mask: 'dddddddddddddddd', frame: true } } }),
  加深層: () =>
    card({
      front: { layers: [...card().front.layers, layer('ink', 'cccccccccccccccc', 70, { blend: 'multiply', hasAlpha: false })] },
    }),
  破框層: () => card({ front: { layers: [card().front.layers[0]!, layer('hero', 'bbbbbbbbbbbbbbbb', 50, { breakout: true, scale: 1.5 })] } }),
  雕花邊角: () => card({ frame: { enabled: true, width: 0.03, color: '#d4af37', shine: 50, style: 'ornate' } }),
  背面圖層: () => card({ back: { layers: [layer('bb', 'cccccccccccccccc', 0, { holo: false }), layer('bh', 'bbbbbbbbbbbbbbbb', 60, { blend: 'screen' })] } }),
};

describe('沒開線稿高光的卡：shader 和 T-802 以前一模一樣（節點圖指紋）', () => {
  it.each(Object.keys(CASES))('%s', (name) => {
    expect(faces(CASES[name]!())).toEqual(GOLDEN[name]);
  });
});

/** d3847b8（T-802 開工前）的指紋。 */
const GOLDEN: Record<string, { front: [number, string]; back: [number, string] }> = {
  整面: { front: [949, 'b1cf4f2d'], back: [655, '9704f433'] },
  用圖層形狀: { front: [899, 'f56a289e'], back: [655, '9704f433'] },
  黑白圖: { front: [1034, '86a9c812'], back: [655, '9704f433'] },
  加深層: { front: [1120, '903266b0'], back: [655, '9704f433'] },
  破框層: { front: [983, '2b1e63ec'], back: [655, '9704f433'] },
  雕花邊角: { front: [1179, 'deb93fd3'], back: [885, '0439b320'] },
  背面圖層: { front: [949, 'b1cf4f2d'], back: [873, 'f68a03bf'] },
};

// 2. 開了線稿高光的層：換材質、多了沿線條發光的節點；破框層、底圖、文字層就算帶了 true 也不多節點；關掉回到原本的 shader。
describe('線稿高光的層（T-802）', () => {
  const withInk = (over: Partial<Layer>, foil?: Card['front']['foil']): Card =>
    card({
      front: {
        layers: [...card().front.layers, layer('ink', 'cccccccccccccccc', 70, { blend: 'multiply', hasAlpha: false, ...over })],
        ...(foil ? { foil } : {}),
      },
    });

  it('打開 → 正面換材質、節點變多、背面不動；關掉（或明寫 false）→ 和沒開一模一樣', () => {
    const plain = faces(CASES['加深層']!());
    const on = faces(withInk({ lineart: true }));
    expect(on.front).not.toEqual(plain.front);
    expect(on.front[0]).toBeGreaterThan(plain.front[0]);
    expect(on.back).toEqual(plain.back);
    expect(faces(withInk({ lineart: false }))).toEqual(plain);
  });

  it('同一個物件上切開關：開 → 換材質；拖鐳射強度 → 不換（強度 0 由 shader 乘 0）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(withInk({}), getImage);
    const front = () => (obj.group.children as Mesh[])[1]!;
    const off = front().material;
    obj.update(withInk({ lineart: true }), getImage);
    const on = front().material;
    // 比物件身分用布林（失敗時 vitest 印材質會去讀貼圖像素，node 沒有 document）
    expect(on === off).toBe(false);
    const c = withInk({ lineart: true });
    for (const strength of [0, 37, 100]) obj.update({ ...c, holo: { ...c.holo, strength } }, getImage);
    obj.setView(30, -10);
    expect(front().material === on).toBe(true);
  });

  it('破框層、底圖、文字層帶了 lineart: true 也不發光（shader 和沒帶一模一樣）', () => {
    const breakout = card({ front: { layers: [card().front.layers[0]!, layer('hero', 'bbbbbbbbbbbbbbbb', 50, { breakout: true, scale: 1.5 })] } });
    const breakoutOn = card({
      front: { layers: [card().front.layers[0]!, layer('hero', 'bbbbbbbbbbbbbbbb', 50, { breakout: true, scale: 1.5, lineart: true })] },
    });
    expect(faces(breakoutOn)).toEqual(faces(breakout));
    const baseOn = card({ front: { layers: [{ ...card().front.layers[0]!, lineart: true }, card().front.layers[1]!] } });
    expect(faces(baseOn)).toEqual(faces(card()));
    const text = { content: '月', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
    const textCard = (lineart: boolean) => card({ front: { layers: [...card().front.layers, layer('t', 'dddddddddddddddd', 80, lineart ? { text, lineart } : { text })] } });
    expect(faces(textCard(true))).toEqual(faces(textCard(false)));
  });

  it('和反光層形狀無關：整面霧光（關）時照樣有沿線條發光的節點', () => {
    const none = { shape: 'none', frame: false } as const;
    const off = faces(withInk({}, none));
    const on = faces(withInk({ lineart: true }, none));
    expect(on.front[0]).toBeGreaterThan(off.front[0]);
  });
});
