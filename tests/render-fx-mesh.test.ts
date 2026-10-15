// T-811 局部動態特效在 card-mesh 的部分：只建 three.js 物件、不畫（不需要 WebGPU）。
// 1. 沒開特效的卡 shader 不變：tests/render-lineart-mesh.test.ts 的 7 個指紋照舊；破框層帶了 fx（不合格的資料）也不多節點。
// 2. 開了特效：換材質、節點變多、另一面不動；三種各不相同；拿掉回到原本的 shader；剪裁層、變身圖層、光碟印刷面也建得出來。
// 3. 拖強度、顏色、速度只改 uniform（不換材質）；換種類換材質。
// 4. setTime 的第二個參數（特效時間）決定迴圈位置的 uniform（fxLoop），和閃星的時間分開（轉動匯出時特效用影片時間）。
import type { Mesh, MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { newDisc } from '../src/model/create';
import { HOLO_PALETTES, type Card, type Layer, type LayerFx } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';
import { fxGlowNode, fxLoop } from '../src/render/fx-nodes';
import { uniform, vec2 } from 'three/tsl';
import { Vector3 } from 'three/webgpu';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
  ['cccccccccccccccc', fakeImage(800, 800)],
  ['dddddddddddddddd', fakeImage(200, 200)],
]);
const getImage = (hash: string) => images.get(hash);

const FIRE: LayerFx = { kind: 'fire', color: '#ff6a1f', strength: 70, speed: 50 };

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: true, hasAlpha: depth > 0, ...over };
}

function card(hero: Partial<Layer> = {}, over: Partial<Card> = {}): Card {
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0, { holo: false }), layer('hero', 'bbbbbbbbbbbbbbbb', 50, hero)] },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...over,
  };
}

/** 節點圖的走訪：[節點數, 雜湊]（同 render-lineart-mesh.test.ts），另外收集數值 uniform 的值。 */
function walk(mesh: Mesh): { size: number; hash: string; uniforms: number[] } {
  const root = (mesh.material as MeshBasicNodeMaterial).colorNode;
  const order = new Map<Node, number>();
  const uniforms: number[] = [];
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
    if (n.isUniformNode === true && typeof n.value === 'number') {
      label += `~${n.value}`;
      uniforms.push(n.value);
    }
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
  return { size: order.size, hash: h.toString(16).padStart(8, '0'), uniforms };
}

function make() {
  const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
  const [, front, back] = obj.group.children as Mesh[];
  return { obj, front: front!, back: back! };
}

function faces(c: Card) {
  const t = make();
  t.obj.update(c, getImage);
  const f = walk(t.front);
  const b = walk(t.back);
  return { front: [f.size, f.hash], back: [b.size, b.hash] };
}

describe('沒開特效：shader 不變', () => {
  it('破框層帶了 fx（不合格的資料）→ 和沒帶一模一樣（破框層不畫特效）', () => {
    const bo = { breakout: true, scale: 1.5 } as const;
    expect(faces(card({ ...bo, fx: FIRE }))).toEqual(faces(card(bo)));
  });

  it('沒有 fx 的卡和指紋測試的「整面」一樣（同一個卡片）', () => {
    expect(faces(card())).toEqual({ front: [949, 'b1cf4f2d'], back: [655, '9704f433'] });
  });
});

describe('開了特效', () => {
  it('換材質、節點變多、背面不動；三種各不相同；拿掉（欄位不在）回到原本的 shader', () => {
    const plain = faces(card());
    const kinds = (['fire', 'electric', 'water'] as const).map((kind) => faces(card({ fx: { ...FIRE, kind } })));
    for (const k of kinds) {
      expect(k.front[0]).toBeGreaterThan(plain.front[0] as number);
      expect(k.back).toEqual(plain.back);
    }
    expect(new Set(kinds.map((k) => k.front[1])).size).toBe(3);
    expect(faces(card({ fx: undefined }))).toEqual(plain);
  });

  it('底圖、剪裁層、變身圖層、光碟印刷面都建得出來（節點變多）', () => {
    const plain = faces(card());
    const base = card();
    base.front.layers[0] = { ...base.front.layers[0]!, fx: FIRE };
    expect(faces(base).front[0]).toBeGreaterThan(plain.front[0] as number);

    const clipCard = (fx?: LayerFx) =>
      card({}, { front: { layers: [...card().front.layers, layer('pat', 'cccccccccccccccc', 50, { clip: true, ...(fx ? { fx } : {}) })] } });
    expect(faces(clipCard(FIRE)).front[0]).toBeGreaterThan(faces(clipCard()).front[0] as number);

    const alt = { alt: { image: 'dddddddddddddddd', hasAlpha: true } };
    expect(faces(card({ ...alt, fx: FIRE })).front[0]).toBeGreaterThan(faces(card(alt)).front[0] as number);

    const disc = (fx?: LayerFx): Card => ({ ...newDisc('d', '2026-10-15T00:00:00.000Z'), front: { layers: [layer('hero', 'bbbbbbbbbbbbbbbb', 50, fx ? { fx } : {})] } });
    expect(faces(disc(FIRE)).front[0]).toBeGreaterThan(faces(disc()).front[0] as number);
  });

  it('同一個物件：拖強度、顏色、速度 → 不換材質；換種類、拿掉 → 換材質', () => {
    const t = make();
    t.obj.update(card({ fx: FIRE }), getImage);
    const on = t.front.material;
    for (const fx of [
      { ...FIRE, strength: 0 },
      { ...FIRE, strength: 100 },
      { ...FIRE, color: '#00ff88' },
      { ...FIRE, speed: 0 },
      { ...FIRE, speed: 100 },
    ]) {
      t.obj.update(card({ fx }), getImage);
      // 比物件身分用布林（失敗時 vitest 印材質會去讀貼圖像素，node 沒有 document）
      expect(t.front.material === on).toBe(true);
    }
    t.obj.update(card({ fx: { ...FIRE, kind: 'water' } }), getImage);
    const water = t.front.material;
    expect(water === on).toBe(false);
    t.obj.update(card(), getImage);
    expect(t.front.material === water).toBe(false);
  });
});

describe('時間：特效時間決定迴圈位置的 uniform，和閃星的時間分開', () => {
  it('setTime(10, 1)：特效照 1 秒（不是 10 秒）；只給一個時間＝兩個一樣；改速度馬上照新速度算', () => {
    const t = make();
    const c = card({ fx: FIRE });
    t.obj.update(c, getImage);
    t.obj.setTime(10, 1);
    let u = walk(t.front).uniforms;
    expect(u).toContain(fxLoop(1, 50));
    expect(u).not.toContain(fxLoop(10, 50));
    t.obj.setTime(2.6);
    u = walk(t.front).uniforms;
    expect(u).toContain(fxLoop(2.6, 50));
    t.obj.update(card({ fx: { ...FIRE, speed: 0 } }), getImage);
    expect(walk(t.front).uniforms).toContain(fxLoop(2.6, 0));
  });
});

describe('發光上限（T-811 審查：強度 100 最多加 1）', () => {
  it('三種特效的發光值每個通道都夾在 0～1（再乘強度與覆蓋率；電光白芯＋外光、水波兩圈波峰重合都不會超過）', () => {
    for (const kind of ['fire', 'electric', 'water'] as const) {
      const node = fxGlowNode(kind, { local: vec2(0, 0), size: vec2(1, 1), loop: uniform(0), color: uniform(new Vector3(1, 1, 1)) }) as unknown as {
        method?: string;
        bNode?: { value?: unknown };
        cNode?: { value?: unknown };
      };
      expect(node.method, kind).toBe('clamp');
      expect(node.bNode?.value, kind).toBe(0);
      expect(node.cNode?.value, kind).toBe(1);
    }
  });
});
