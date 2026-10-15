// T-810 CD 光碟在 render 的部分（只建 three.js 物件、不畫；畫出來的樣子在 GPU 回歸頁 tests/gpu/blend-gpu.ts 的 13.）：
// 1. disc.ts 的尺寸與資料面彩虹的純數學（扇形在切線分量和半徑同方向時最亮、垂直時暗；轉卡時扇形繞著中心轉）。
// 2. card-mesh：光碟換網格（印刷面圓環、厚度 0.8 倍、透明塑膠）、換材質（正面多銀環、背面資料面），換回卡片時和從沒畫過光碟一樣。
// 3. pick.ts：光碟中間（透明圈、孔）點不到卡面。
import type { BufferGeometry, Mesh, MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { newCard, newDisc } from '../src/model/create';
import { HOLO_PALETTES, type Card, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';
import {
  DISC,
  DISC_LOOK,
  DISC_THICKNESS,
  discBackAt,
  discBox,
  discFanAngle,
  discOutline,
  discPrintSdf,
  discRainbow,
} from '../src/render/disc';
import { CARD_THICKNESS, cameraDistance, roundedRectSdf } from '../src/render/fit';
import { pickCard, type PickScene } from '../src/render/pick';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;
const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1000, 1000)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 500)],
]);
const getImage = (hash: string) => images.get(hash);
const NOW = '2026-10-15T00:00:00.000Z';

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: true, hasAlpha: depth > 0, ...over };
}

function withLayers(c: Card): Card {
  return {
    ...c,
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0, { holo: false }), layer('hero', 'bbbbbbbbbbbbbbbb', 50)] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
  };
}
const disc = () => withLayers(newDisc('d', NOW));
const square = () => withLayers(newCard('square', 'c', NOW));

/** 節點圖指紋（同 tests/render-lineart-mesh.test.ts）。 */
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

const newObject = () => createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
function faces(obj: ReturnType<typeof newObject>): { front: [number, string]; back: [number, string] } {
  const [, front, back] = obj.group.children as Mesh[];
  return { front: signature(front!), back: signature(back!) };
}

/** 網格頂點離中心的距離（最小、最大）。 */
function radii(g: BufferGeometry): { min: number; max: number } {
  const pos = g.getAttribute('position');
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return { min, max };
}

describe('disc.ts：尺寸照真的 CD（光碟寬＝1）', () => {
  it('外緣 0.5、印刷面 118／46 mm、孔 15 mm、厚度 0.8 倍卡片', () => {
    expect(DISC.outer).toBe(0.5);
    expect(DISC.printOuter).toBeCloseTo(0.4917, 4);
    expect(DISC.printInner).toBeCloseTo(0.1917, 4);
    expect(DISC.hole).toBeCloseTo(0.0625, 6);
    expect(DISC_THICKNESS).toBeCloseTo(CARD_THICKNESS * 0.8, 10);
  });

  it('輪廓＝印刷面外緣的圓（圓角正方形，圓角＝半徑）；盒子＝整片光碟', () => {
    const o = discOutline();
    expect(o).toEqual({ halfW: DISC.printOuter, halfH: DISC.printOuter, r: DISC.printOuter });
    // 圓角正方形的距離公式在這裡就是圓：45° 方向和 0° 方向一樣在半徑上
    expect(roundedRectSdf(DISC.printOuter, 0, o)).toBeCloseTo(0, 10);
    expect(roundedRectSdf(DISC.printOuter / Math.SQRT2, DISC.printOuter / Math.SQRT2, o)).toBeCloseTo(0, 10);
    expect(discBox()).toEqual({ halfW: 0.5, halfH: 0.5, thickness: DISC_THICKNESS });
  });

  it('印刷面圓環的距離：裡面負、孔與透明圈與外面正', () => {
    expect(discPrintSdf(0.3, 0)).toBeLessThan(0);
    expect(discPrintSdf(0, 0)).toBeGreaterThan(0);
    expect(discPrintSdf(0.1, 0)).toBeGreaterThan(0);
    expect(discPrintSdf(0.495, 0)).toBeGreaterThan(0);
    expect(discPrintSdf(0, DISC.printInner)).toBeCloseTo(0, 10);
  });
});

describe('disc.ts：資料面的繞射彩虹', () => {
  it('色譜（Stam 的 blend3）：第 1 階 y＝2u − 1，藍在 0.25、綠在 0.5、紅在 0.75；u 很小（鏡面反射）時沒有顏色', () => {
    const at = (y: number) => discRainbow((y + 1) / 2);
    expect(at(0.25).b).toBeGreaterThan(at(0.25).r);
    expect(at(0.5).g).toBeGreaterThan(at(0.5).r);
    expect(at(0.5).g).toBeGreaterThan(at(0.5).b);
    expect(at(0.75).r).toBeGreaterThan(at(0.75).b);
    expect(discRainbow(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  const camZ = cameraDistance(30, 4 / 3, 1, discBox());

  it('正對背面：兩道相對的扇形（θ 與 θ＋180° 都亮），和它垂直的方向暗', () => {
    const theta = discFanAngle(180, 0, camZ);
    const lobe = (a: number) => discBackAt(0.33 * Math.cos(a), 0.33 * Math.sin(a), 180, 0, camZ, 0.65).lobe;
    expect(lobe(theta)).toBeGreaterThan(0.95);
    expect(lobe(theta + Math.PI)).toBeGreaterThan(0.7);
    expect(lobe(theta + Math.PI / 2)).toBeLessThan(0.01);
    expect(lobe(theta - Math.PI / 2)).toBeLessThan(0.01);
    // 顏色：扇形上比垂直方向亮
    const lum = (a: number) => {
      const c = discBackAt(0.33 * Math.cos(a), 0.33 * Math.sin(a), 180, 0, camZ, 0.65).color;
      return c.r + c.g + c.b;
    };
    expect(lum(theta)).toBeGreaterThan(lum(theta + Math.PI / 2) + 0.3);
  });

  it('轉卡時扇形繞著中心轉：背面 180°、150°、210°、俯仰 ±15° 的方向都不一樣', () => {
    const angles = [
      discFanAngle(180, 0, camZ),
      discFanAngle(150, 0, camZ),
      discFanAngle(210, 0, camZ),
      discFanAngle(180, 15, camZ),
      discFanAngle(180, -15, camZ),
    ];
    // 和正對背面（180°、俯仰 0）比，其他角度的扇形都轉開了 5° 以上；150° 和 210° 往相反的方向轉
    for (let j = 1; j < angles.length; j++) {
      const d = Math.abs(angles[0]! - angles[j]!) % Math.PI;
      expect(Math.min(d, Math.PI - d), `${j}`).toBeGreaterThan((5 * Math.PI) / 180);
    }
    const turn = (a: number) => ((a - angles[0]! + 1.5 * Math.PI) % Math.PI) - Math.PI / 2;
    expect(Math.sign(turn(angles[1]!))).toBe(-Math.sign(turn(angles[2]!)));
  });

  it('鐳射強度 0：沒有彩虹（扇形裡只剩白色的光痕，R、G、B 一樣多）；強度越大彩虹越多', () => {
    const theta = discFanAngle(180, 0, camZ);
    const x = 0.33 * Math.cos(theta);
    const y = 0.33 * Math.sin(theta);
    const off = discBackAt(x, y, 180, 0, camZ, 0).color;
    const on = discBackAt(x, y, 180, 0, camZ, 1).color;
    const tint = DISC_LOOK.silver.tint;
    // 強度 0：顏色＝銀面（tint × 環境＋高光）＋白色光痕：通道之間的差只來自銀面的色偏（比例和 tint 一樣）
    expect((off.b - off.r) / (off.b - off.g)).toBeCloseTo((tint[2] - tint[0]) / (tint[2] - tint[1]), 10);
    expect(on.r + on.g + on.b).toBeGreaterThan(off.r + off.g + off.b + 0.2);
  });
});

describe('card-mesh：光碟的網格', () => {
  it('卡面＝印刷面圓環（頂點都在 46～118 mm 之間）、厚度 0.8 倍；輪廓是印刷面外緣的圓', () => {
    const obj = newObject();
    obj.update(disc(), getImage);
    const [body, front, back] = obj.group.children as Mesh[];
    const r = radii(front!.geometry);
    expect(r.min).toBeCloseTo(DISC.printInner, 4);
    expect(r.max).toBeCloseTo(DISC.printOuter, 4);
    expect(front!.position.z).toBeCloseTo(DISC_THICKNESS / 2, 10);
    expect(back!.position.z).toBeCloseTo(-DISC_THICKNESS / 2, 10);
    expect(radii(body!.geometry).max).toBeCloseTo(DISC.printOuter, 4);
    expect(obj.outline()).toEqual(discOutline());
  });

  it('透明塑膠：group 最後一個子物件，孔外到外緣（頂點在孔～0.5），兩個網格（遠側、近側）都透明、不寫深度', () => {
    const obj = newObject();
    obj.update(disc(), getImage);
    const plastic = obj.group.children[3]!;
    expect(plastic.visible).toBe(true);
    const meshes = plastic.children as Mesh[];
    expect(meshes).toHaveLength(2);
    const r = radii(meshes[0]!.geometry);
    expect(r.min).toBeCloseTo(DISC.hole, 4);
    expect(r.max).toBeCloseTo(DISC.outer, 4);
    for (const m of meshes) {
      const mat = m.material as MeshBasicNodeMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    expect(meshes.map((m) => m.renderOrder).sort((a, b) => a - b)).toEqual([-2, -1]);
  });

  it('換回卡片：網格、材質和從沒畫過光碟的物件一模一樣（指紋），塑膠藏起來；再換成光碟塑膠不重建', () => {
    const fresh = newObject();
    fresh.update(square(), getImage);
    const obj = newObject();
    obj.update(disc(), getImage);
    const plastic = obj.group.children[3]!;
    obj.update(square(), getImage);
    expect(faces(obj)).toEqual(faces(fresh));
    expect(plastic.visible).toBe(false);
    const [fb, ff] = fresh.group.children as Mesh[];
    const [ob, of] = obj.group.children as Mesh[];
    expect(radii(of!.geometry)).toEqual(radii(ff!.geometry));
    expect(of!.position.z).toBe(ff!.position.z);
    expect((ob!.material as unknown[])[1] === (fb!.material as unknown[])[1]).toBe(false); // 各自的物件
    obj.update(disc(), getImage);
    expect(obj.group.children[3] === plastic).toBe(true);
    expect(plastic.visible).toBe(true);
  });
});

describe('card-mesh：光碟的材質', () => {
  it('正面：和同樣圖層的正方形卡不同（卡框換成內緣銀環）；背面：資料面，和卡片的素色卡背不同、不看圖層', () => {
    const d = newObject();
    d.update(disc(), getImage);
    const c = newObject();
    c.update(square(), getImage);
    const df = faces(d);
    const cf = faces(c);
    expect(df.front).not.toEqual(cf.front);
    expect(df.back).not.toEqual(cf.back);
  });

  it('光碟的卡框、雕花、圓角、比例欄位改了也不換材質、不換網格（不畫）', () => {
    const obj = newObject();
    const base = disc();
    obj.update(base, getImage);
    const [, front, back] = obj.group.children as Mesh[];
    const fm = front!.material;
    const bm = back!.material;
    const fg = front!.geometry;
    obj.update({ ...base, frame: { ...base.frame, style: 'ornate', enabled: true }, cornerRadius: 0.12 }, getImage);
    expect(front!.material === fm).toBe(true);
    expect(back!.material === bm).toBe(true);
    expect(front!.geometry === fg).toBe(true);
  });

  it('鐳射強度只改 uniform（拖滑桿不換材質）；換圖層才換正面的材質，背面不動', () => {
    const obj = newObject();
    const base = disc();
    obj.update(base, getImage);
    const [, front, back] = obj.group.children as Mesh[];
    const fm = front!.material;
    const bm = back!.material;
    for (const strength of [0, 30, 100]) obj.update({ ...base, holo: { ...base.holo, strength } }, getImage);
    expect(front!.material === fm).toBe(true);
    expect(back!.material === bm).toBe(true);
    obj.update({ ...base, front: { layers: [base.front.layers[0]!] } }, getImage);
    expect(front!.material === fm).toBe(false);
    expect(back!.material === bm).toBe(true);
  });

  it('透明卡套對光碟不畫（view.sleeve true 也一樣）', () => {
    const obj = newObject();
    const d = disc();
    obj.update({ ...d, view: { ...d.view, sleeve: true } }, getImage);
    expect(obj.sleeve()).toBe(false);
    expect(obj.group.children.some((c) => c.visible && c !== obj.group.children[3] && c.children.length === 2 && c.type === 'Group')).toBe(false);
  });

  it('破框層：卡外網格＝印刷面外面＋透明圈（頂點最近到孔邊，孔裡沒有）；孔裡點不到破框層', () => {
    const obj = newObject();
    const base = disc();
    obj.update({ ...base, front: { layers: [base.front.layers[0]!, layer('hero', 'bbbbbbbbbbbbbbbb', 50, { breakout: true, scale: 1.4 })] } }, getImage);
    const front = (obj.group.children as Mesh[])[1]!;
    const ring = front.children[0] as Mesh;
    expect(ring.visible).toBe(true);
    expect(radii(ring.geometry).min).toBeCloseTo(DISC.hole, 4);
    obj.setView(0, 0);
    expect(obj.breakoutAt('front', 0, 0)).toBe(null);
    expect(obj.breakoutAt('front', 0.03, 0)).toBe(null);
    // 透明圈上（孔外）、印刷面外面點得到（讀不到遮罩時當整張不透明）
    expect(obj.breakoutAt('front', 0.12, 0)).toBe('hero');
    expect(obj.breakoutAt('front', 0.6, 0)).toBe('hero');
  });
});

describe('pick.ts：光碟中間點不到卡面', () => {
  const scene = (inner?: number): PickScene => ({
    vFovDeg: 30,
    viewAspect: 1,
    cameraZ: 3,
    yawDeg: 0,
    pitchDeg: 0,
    outline: discOutline(),
    thickness: DISC_THICKNESS,
    ...(inner === undefined ? {} : { inner }),
  });
  it('inner：中心那一圈（透明圈與孔）沒打到；印刷面上照常；不給 inner 就和以前一樣', () => {
    expect(pickCard(0, 0, scene(DISC.printInner))).toBe(null);
    const ndc = 0.3 / (3 - DISC_THICKNESS / 2) / Math.tan((15 * Math.PI) / 180);
    expect(pickCard(ndc, 0, scene(DISC.printInner))?.x).toBeCloseTo(0.3, 6);
    expect(pickCard(0, 0, scene())).not.toBe(null);
  });
});
