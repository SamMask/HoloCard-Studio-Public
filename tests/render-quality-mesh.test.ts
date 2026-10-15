// T-809 效能自動降級在卡面這一邊（card-mesh）：預覽可以關掉景深陰影（setShadows(false)＝把每層影子濃度的 uniform 設成 0），
// 擷取（PNG、縮圖、轉動匯出）用 withFullShadows 暫時恢復完整影子、畫完立刻放回去。
// 只改 uniform：不換材質、節點圖不變（一般卡的 7 個指紋由 render-lineart-mesh.test.ts 驗，預設就是開著，不受影響）。
// 只建 three.js 物件、不畫（不需要 WebGPU）；圖片用只有寬高的假物件。
import type { Mesh, MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { HOLO_PALETTES, type Card, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';
import { layerShadow, shadowFactors } from '../src/render/shadow';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
  ['cccccccccccccccc', fakeImage(800, 800)],
]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: false, hasAlpha: depth > 0, ...over };
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
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0), layer('hero', 'bbbbbbbbbbbbbbbb', 50)] },
    back: { layers: [layer('bk', 'aaaaaaaaaaaaaaaa', 0), layer('bhero', 'cccccccccccccccc', 80)] },
    frame: { enabled: false, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 40, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    // 濃淡 100＝兩倍濃：影子濃度的數字夠特別，不會和別的 uniform 撞
    shadow: { strength: 100, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
    ...over,
  };
}

/** 影子濃度（shadow.ts 的算法）。 */
const strengthOf = (depth: number, c: Card = card()) => layerShadow(depth, shadowFactors(c.shadow)).strength;

/** 卡面材質 colorNode 底下所有的數字 uniform 的值。 */
function floatValues(mesh: Mesh): number[] {
  const root = (mesh.material as MeshBasicNodeMaterial).colorNode;
  const seen = new Set<Node>();
  const stack: Node[] = root ? [root] : [];
  const out: number[] = [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const n = node as unknown as { isUniformNode?: boolean; value?: unknown };
    if (n.isUniformNode === true && typeof n.value === 'number') out.push(n.value);
    for (const child of node.getChildren()) stack.push(child);
  }
  return out;
}

function parts(obj: ReturnType<typeof createCardObject>) {
  const [body, front, back] = obj.group.children as Mesh[];
  return { body: body!, front: front!, back: back! };
}

/** 這一面現在有幾個 uniform 的值是這個數字。 */
const count = (mesh: Mesh, value: number) => floatValues(mesh).filter((v) => Math.abs(v - value) < 1e-12).length;

function make(c = card()) {
  const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
  obj.update(c, getImage);
  return obj;
}

describe('預設：影子是開著的（和 T-809 以前一樣）', () => {
  it('立體層的影子濃度就是 shadow.ts 算的值；正反面各自一個', () => {
    const obj = make();
    expect(strengthOf(50)).toBeGreaterThan(0.1);
    expect(strengthOf(80)).toBeGreaterThan(strengthOf(50));
    expect(count(parts(obj).front, strengthOf(50))).toBeGreaterThan(0);
    expect(count(parts(obj).back, strengthOf(80))).toBeGreaterThan(0);
  });
});

describe('setShadows：關掉預覽的景深陰影', () => {
  it('關：兩面所有立體層的影子濃度都變 0；開：回來。不換材質、不換網格', () => {
    const obj = make();
    // 存材質與網格本身（不是 Mesh：同一個 Mesh 換掉 material 時，存 Mesh 會比到同一個新值，T-809 審查）
    const before = {
      front: { material: parts(obj).front.material, geometry: parts(obj).front.geometry },
      back: { material: parts(obj).back.material, geometry: parts(obj).back.geometry },
    };
    obj.setShadows(false);
    expect(parts(obj).front.material).toBe(before.front.material);
    expect(parts(obj).back.material).toBe(before.back.material);
    expect(count(parts(obj).front, strengthOf(50))).toBe(0);
    expect(count(parts(obj).back, strengthOf(80))).toBe(0);
    obj.setShadows(true);
    expect(count(parts(obj).front, strengthOf(50))).toBeGreaterThan(0);
    expect(count(parts(obj).back, strengthOf(80))).toBeGreaterThan(0);
    expect(parts(obj).front.material).toBe(before.front.material);
    expect(parts(obj).back.material).toBe(before.back.material);
    expect(parts(obj).front.geometry).toBe(before.front.geometry);
    expect(parts(obj).back.geometry).toBe(before.back.geometry);
  });

  it('關著的時候照樣 update：拖深度、改陰影濃淡都還是 0（不會因為更新又冒出影子）；開了才用最新的值', () => {
    const c = card();
    const obj = make(c);
    obj.setShadows(false);
    const deeper = { ...c, front: { layers: [c.front.layers[0]!, { ...c.front.layers[1]!, depth: 90 }] } };
    obj.update(deeper, getImage);
    expect(count(parts(obj).front, strengthOf(90))).toBe(0);
    expect(count(parts(obj).front, strengthOf(50))).toBe(0);
    const softer = { ...deeper, shadow: { strength: 60, distance: 50 } };
    obj.update(softer, getImage);
    expect(count(parts(obj).front, strengthOf(90, softer))).toBe(0);
    obj.setShadows(true);
    expect(count(parts(obj).front, strengthOf(90, softer))).toBeGreaterThan(0);
  });

  it('關著的時候圖層組成變了（新增一層 → 重建材質）：新的那層影子也是 0', () => {
    const c = card();
    const obj = make(c);
    obj.setShadows(false);
    const more = { ...c, front: { layers: [...c.front.layers, layer('extra', 'cccccccccccccccc', 70)] } };
    obj.update(more, getImage);
    expect(count(parts(obj).front, strengthOf(70))).toBe(0);
    expect(count(parts(obj).front, strengthOf(50))).toBe(0);
    obj.setShadows(true);
    expect(count(parts(obj).front, strengthOf(70))).toBeGreaterThan(0);
    expect(count(parts(obj).front, strengthOf(50))).toBeGreaterThan(0);
  });

  it('重複關、重複開沒有副作用', () => {
    const obj = make();
    obj.setShadows(false);
    obj.setShadows(false);
    expect(count(parts(obj).front, strengthOf(50))).toBe(0);
    obj.setShadows(true);
    obj.setShadows(true);
    expect(count(parts(obj).front, strengthOf(50))).toBeGreaterThan(0);
  });
});

describe('withFullShadows：擷取一律完整影子', () => {
  it('預覽關著時：畫的那一下是完整影子，畫完（含丟錯）立刻放回 0', () => {
    const obj = make();
    obj.setShadows(false);
    let during = { front: -1, back: -1 };
    obj.withFullShadows(() => {
      during = { front: count(parts(obj).front, strengthOf(50)), back: count(parts(obj).back, strengthOf(80)) };
    });
    expect(during.front).toBeGreaterThan(0);
    expect(during.back).toBeGreaterThan(0);
    expect(count(parts(obj).front, strengthOf(50))).toBe(0);
    expect(count(parts(obj).back, strengthOf(80))).toBe(0);

    expect(() =>
      obj.withFullShadows(() => {
        throw new Error('畫失敗');
      }),
    ).toThrow('畫失敗');
    expect(count(parts(obj).front, strengthOf(50))).toBe(0);
  });

  it('預覽開著時：就是直接畫，不動任何東西', () => {
    const obj = make();
    const before = floatValues(parts(obj).front);
    let during: number[] = [];
    obj.withFullShadows(() => {
      during = floatValues(parts(obj).front);
    });
    expect(during).toEqual(before);
    expect(floatValues(parts(obj).front)).toEqual(before);
  });

  it('擷取裡面用最新的卡片值（關著時改過深度）', () => {
    const c = card();
    const obj = make(c);
    obj.setShadows(false);
    obj.update({ ...c, front: { layers: [c.front.layers[0]!, { ...c.front.layers[1]!, depth: 30 }] } }, getImage);
    let inside = 0;
    obj.withFullShadows(() => {
      inside = count(parts(obj).front, strengthOf(30));
    });
    expect(inside).toBeGreaterThan(0);
  });

  it('不投影的層（底圖、非正常混合模式）本來就沒有影子 uniform：不受影響、不丟錯', () => {
    const c = card({ front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0), layer('glow', 'bbbbbbbbbbbbbbbb', 40, { blend: 'screen' })] } });
    const obj = make(c);
    expect(() => {
      obj.setShadows(false);
      obj.withFullShadows(() => {});
      obj.setShadows(true);
    }).not.toThrow();
  });
});
