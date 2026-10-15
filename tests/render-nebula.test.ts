// 舞台主題「星雲」（T-415，DESIGN §5「舞台」）：斜盤面在卡片後面、卡片周圍壓暗（卡片最亮最清楚）、星點的分布、光暈在卡片下方、
// 漩渦慢轉與減少動態效果；three.js 物件不擋卡片、只在舞台那一層、dispose 確實釋放。只建物件、不畫。
import { Group, Mesh, Sprite, type Material, type Node, type Object3D } from 'three/webgpu';
import { ASPECT_HEIGHT } from '../src/model/types';
import { cameraPosition, positionWorld, uniform } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import { ZOOM_DEFAULT } from '../src/interact/view';
import { createCardObject } from '../src/render/card-mesh';
import { cameraDistance, cardBox } from '../src/render/fit';
import { createNebulaFx, starGeometry } from '../src/render/nebula-fx';
import {
  haloBreath,
  initialNebulaMotion,
  NEBULA_BACKDROP,
  NEBULA_DISC,
  NEBULA_GAIN,
  NEBULA_HALO,
  NEBULA_MASK,
  NEBULA_SPIN,
  NEBULA_STARS,
  nebulaCardMask,
  nebulaDisc,
  nebulaEnvelope,
  nebulaHaloY,
  nebulaStars,
  stepNebula,
  type Vec3,
} from '../src/render/nebula-layout';
import { STAGE_LAYER } from '../src/render/reflection';
import { nebulaBackdrop } from '../src/render/nebula-nodes';

const FOV = 30;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.sqrt(dot(a, a));

// 只求值實際著色圖中的交點子圖；不另抄一份交點公式，也不需要 GPU。
type MathGraph = Node & {
  op?: string;
  method?: string;
  value?: number | { toArray(): number[] };
  nodes?: Node[];
  node?: MathGraph;
  aNode?: MathGraph;
  bNode?: MathGraph;
  cNode?: MathGraph;
};

function discIntersection() {
  const { alpha } = nebulaBackdrop({ spin: uniform(0), haloY: uniform(-1), halo: uniform(1), cardHalfH: uniform(1) });
  const pending: Node[] = [alpha];
  const seen = new Set<Node>();
  while (pending.length) {
    const node = pending.pop()! as MathGraph;
    if (seen.has(node)) continue;
    seen.add(node);
    const unwrap = (n?: MathGraph): MathGraph | undefined => n?.node ? unwrap(n.node) : n;
    const a = unwrap(node.aNode);
    const b = unwrap(node.bNode);
    // step(0,t) × step(t,1)：鏡頭到背景線段上的有效交點。
    if (node.op === '*' && a?.method === 'step' && b?.method === 'step' && a.bNode?.id === b.aNode?.id) {
      return { t: a.bNode!, mask: node };
    }
    pending.push(...node.getChildren());
  }
  throw new Error('星雲著色圖缺少鏡頭與背景之間的交點遮罩');
}

function evaluateIntersection(node: MathGraph, cam: Vec3, point: Vec3): number[] {
  if (node.id === cameraPosition.id) return [cam.x, cam.y, cam.z];
  if (node.id === positionWorld.id) return [point.x, point.y, point.z];
  if (node.node) return evaluateIntersection(node.node, cam, point);
  if (typeof node.value === 'number') return [node.value];
  if (node.value?.toArray) return node.value.toArray();
  if (node.nodes) return node.nodes.flatMap((n) => evaluateIntersection(n, cam, point));
  const a = evaluateIntersection(node.aNode!, cam, point);
  const b = evaluateIntersection(node.bNode!, cam, point);
  const component = (v: number[], i: number) => v[v.length === 1 ? 0 : i]!;
  const zip = (fn: (x: number, y: number) => number) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => fn(component(a, i), component(b, i)));
  switch (node.op ?? node.method) {
    case '+': return zip((x, y) => x + y);
    case '-': return zip((x, y) => x - y);
    case '*': return zip((x, y) => x * y);
    case '/': return zip((x, y) => x / y);
    case 'dot': return [zip((x, y) => x * y).reduce((sum, x) => sum + x, 0)];
    case 'step': return zip((edge, x) => x < edge ? 0 : 1);
    case 'mix': {
      const [factor] = evaluateIntersection(node.cNode!, cam, point);
      return zip((x, y) => x * (1 - factor!) + y * factor!);
    }
    default: throw new Error(`未支援的交點節點：${node.op ?? node.method ?? node.constructor.name}`);
  }
}

function drawables(root: Object3D): (Mesh | Sprite)[] {
  const out: (Mesh | Sprite)[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Sprite) out.push(o);
  });
  return out.sort((a, b) => a.renderOrder - b.renderOrder);
}

describe('漩渦的斜盤面', () => {
  it.each([
    ['完全平行', 0, false],
    ['近平行（正側）', 1e-12, false],
    ['近平行（負側）', -1e-12, false],
    ['交點在鏡頭後面', 1, false],
    ['交點在背景平面後面', -0.5, false],
    ['交點在鏡頭與背景之間', -2, true],
  ] as const)('%s：交點參數與遮罩都是有限數，正確判定有無交點', (_name, denominatorRatio, valid) => {
    const frame = nebulaDisc();
    const cam = { x: 0, y: 0, z: 7 };
    const numerator = dot({ x: frame.center.x, y: frame.center.y, z: frame.center.z - cam.z }, frame.normal);
    const dz = NEBULA_BACKDROP.z - cam.z;
    // 全部視線都終止在真正的背景平面；調 y 取得所需的方向。
    const denominator = Math.abs(denominatorRatio) < 1e-10 ? denominatorRatio : Math.abs(numerator) * denominatorRatio;
    const point = { x: 0, y: (denominator - dz * frame.normal.z) / frame.normal.y, z: NEBULA_BACKDROP.z };
    const graph = discIntersection();
    const [t] = evaluateIntersection(graph.t, cam, point);
    const [mask] = evaluateIntersection(graph.mask, cam, point);
    expect(Number.isFinite(t)).toBe(true);
    expect(Number.isFinite(mask)).toBe(true);
    expect(mask).toBe(valid ? 1 : 0); // 沒交點＝不畫漩渦。
    if (valid) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
  });

  it('法線與盤面兩軸都是單位向量、互相垂直', () => {
    const f = nebulaDisc();
    for (const v of [f.normal, f.u, f.v]) expect(len(v)).toBeCloseTo(1, 12);
    expect(dot(f.u, f.v)).toBeCloseTo(0, 12);
    expect(dot(f.u, f.normal)).toBeCloseTo(0, 12);
    expect(dot(f.v, f.normal)).toBeCloseTo(0, 12);
  });

  it('在卡片後面、往後倒：盤面上方往遠處（v 的 z < 0）、法線朝著鏡頭與上方；中心大約在卡片正後面', () => {
    const f = nebulaDisc();
    expect(f.center.z).toBeLessThan(-1);
    expect(f.v.z).toBeLessThan(0);
    expect(f.normal.z).toBeGreaterThan(0);
    expect(f.normal.y).toBeGreaterThan(0);
    expect(Math.abs(f.center.x)).toBeLessThan(0.5);
    expect(Math.abs(f.center.y)).toBeLessThan(0.5);
    expect(NEBULA_DISC.tiltDeg).toBeGreaterThan(30);
    expect(NEBULA_DISC.tiltDeg).toBeLessThan(80);
  });

  it('暗的核心在卡片正後面（從預設鏡頭看，卡片中間附近往後打到盤面中心的暗區；卡片周圍再由 nebulaCardMask 壓暗）', () => {
    const f = nebulaDisc();
    const d = cameraDistance(FOV, 1.6, ZOOM_DEFAULT, cardBox(ASPECT_HEIGHT.standard));
    // 卡片中間一圈往後看，打到盤面的點離中心多遠（盤面座標）
    const cam = { x: 0, y: 0, z: d };
    for (const [x, y] of [
      [0, 0],
      [0.25, 0.2],
      [-0.25, 0.2],
      [0.25, -0.2],
      [-0.25, -0.2],
    ] as const) {
      const ray = { x: x - cam.x, y: y - cam.y, z: 0 - cam.z };
      const t = dot({ x: f.center.x - cam.x, y: f.center.y - cam.y, z: f.center.z - cam.z }, f.normal) / dot(ray, f.normal);
      const hit = { x: cam.x + ray.x * t - f.center.x, y: cam.y + ray.y * t - f.center.y, z: cam.z + ray.z * t - f.center.z };
      const r = Math.hypot(dot(hit, f.u), dot(hit, f.v));
      // 卡片正中間往後是最暗的核心；中間附近（含壓暗）不到最亮的三成
      if (x === 0 && y === 0) expect(r).toBeLessThan(NEBULA_DISC.core);
      expect(nebulaEnvelope(r) * nebulaCardMask(x, y, ASPECT_HEIGHT.standard)).toBeLessThan(0.3);
    }
    expect(nebulaEnvelope(0)).toBe(0);
    expect(nebulaEnvelope(NEBULA_DISC.core * 3)).toBeCloseTo(1, 9);
    expect(nebulaEnvelope(NEBULA_DISC.radius)).toBe(0);
  });

  it('背景平面在所有東西後面、夠大：最遠縮放＋最寬的預覽區也蓋得滿', () => {
    expect(NEBULA_BACKDROP.z).toBeLessThan(NEBULA_STARS.far);
    const farthest = cameraDistance(FOV, 0.7, 0.45, cardBox(ASPECT_HEIGHT.tarot));
    const depth = farthest - NEBULA_BACKDROP.z;
    const halfH = depth * Math.tan((FOV / 2) * RAD);
    expect(NEBULA_BACKDROP.height / 2).toBeGreaterThan(halfH);
    expect(NEBULA_BACKDROP.width / 2).toBeGreaterThan(halfH * 2.4);
  });
});

describe('卡片永遠最亮、最清楚', () => {
  it('星雲最亮也遠比卡片暗', () => {
    expect(NEBULA_GAIN).toBeLessThanOrEqual(0.5);
    expect(NEBULA_HALO.gain).toBeLessThanOrEqual(0.25);
  });

  it('卡片周圍壓暗：卡片中間剩 MASK.floor、邊上不到一半、離卡片 MASK.outer 以外不壓；由內往外一直變亮', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const h = ASPECT_HEIGHT[aspect];
      expect(nebulaCardMask(0, 0, ASPECT_HEIGHT[aspect])).toBeCloseTo(NEBULA_MASK.floor, 9);
      expect(nebulaCardMask(0.5, 0, ASPECT_HEIGHT[aspect])).toBeLessThan(0.5);
      expect(nebulaCardMask(0, h / 2, ASPECT_HEIGHT[aspect])).toBeLessThan(0.5);
      expect(nebulaCardMask(0.5 + NEBULA_MASK.outer + 0.01, 0, ASPECT_HEIGHT[aspect])).toBeCloseTo(1, 9);
      let last = 0;
      for (let x = 0; x <= 1.2; x += 0.05) {
        const m = nebulaCardMask(x, 0.1, ASPECT_HEIGHT[aspect]);
        expect(m).toBeGreaterThanOrEqual(last - 1e-12);
        last = m;
      }
    }
    expect(NEBULA_MASK.floor).toBeLessThan(0.3);
  });

  it('光暈在卡片下緣再往下一點；若隱若現（亮度在 breathMin～1 之間起伏）', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      expect(nebulaHaloY(ASPECT_HEIGHT[aspect])).toBeCloseTo(-(ASPECT_HEIGHT[aspect] / 2 + NEBULA_HALO.gap), 12);
    }
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < NEBULA_HALO.breath; t += 0.1) {
      lo = Math.min(lo, haloBreath(t));
      hi = Math.max(hi, haloBreath(t));
    }
    expect(lo).toBeCloseTo(NEBULA_HALO.breathMin, 2);
    expect(hi).toBeCloseTo(1, 2);
  });
});

describe('星點的分布', () => {
  const stars = nebulaStars();

  it('很多顆、每次一樣（固定種子）', () => {
    expect(stars.length).toBe(NEBULA_STARS.count);
    expect(stars.length).toBeGreaterThanOrEqual(400);
    expect(nebulaStars()).toEqual(stars);
  });

  it('都在卡片後面（z 在 far～near 之間，near < 0）', () => {
    expect(NEBULA_STARS.near).toBeLessThan(0);
    for (const s of stars) {
      expect(s.z).toBeLessThanOrEqual(NEBULA_STARS.near);
      expect(s.z).toBeGreaterThanOrEqual(NEBULA_STARS.far);
    }
  });

  it('畫面上均勻：從參考鏡頭看，四個象限各約四分之一；預設鏡頭看得到上百顆', () => {
    const ref = NEBULA_STARS.refDistance;
    const quadrants = [0, 0, 0, 0];
    for (const s of stars) {
      const sx = s.x / (ref - s.z);
      const sy = s.y / (ref - s.z);
      expect(Math.abs(sx)).toBeLessThanOrEqual(NEBULA_STARS.spanX + 1e-9);
      expect(Math.abs(sy)).toBeLessThanOrEqual(NEBULA_STARS.spanY + 1e-9);
      quadrants[(sx >= 0 ? 1 : 0) + (sy >= 0 ? 2 : 0)]!++;
    }
    for (const q of quadrants) {
      expect(q / stars.length).toBeGreaterThan(0.18);
      expect(q / stars.length).toBeLessThan(0.32);
    }
    const d = cameraDistance(FOV, 1.6, ZOOM_DEFAULT, cardBox(ASPECT_HEIGHT.standard));
    const t = Math.tan((FOV / 2) * RAD);
    const visible = stars.filter((s) => Math.abs(s.y / (d - s.z)) < t && Math.abs(s.x / (d - s.z)) < t * 1.6).length;
    expect(visible).toBeGreaterThan(150);
  });

  it('細小：大小在範圍內、大多數很小；亮度 0～1、大多數暗；三種顏色、藍白最多', () => {
    const sizes = stars.map((s) => s.size).sort((a, b) => a - b);
    expect(sizes[0]).toBeGreaterThanOrEqual(NEBULA_STARS.size[0]);
    expect(sizes.at(-1)).toBeLessThanOrEqual(NEBULA_STARS.size[1]);
    expect(sizes[Math.floor(sizes.length / 2)]).toBeLessThan((NEBULA_STARS.size[0] + NEBULA_STARS.size[1]) / 2);
    const bright = stars.map((s) => s.brightness);
    expect(Math.min(...bright)).toBeGreaterThan(0);
    expect(Math.max(...bright)).toBeLessThanOrEqual(1);
    expect(bright.filter((b) => b > 0.65).length).toBeLessThan(stars.length / 2);
    const tints = [0, 0, 0];
    for (const s of stars) tints[s.tint]!++;
    expect(tints[0]).toBeGreaterThan(stars.length * 0.6);
    expect(tints[1]).toBeGreaterThan(0);
    expect(tints[2]).toBeGreaterThan(0);
  });

  it('星點網格：每顆一個正對鏡頭的方塊（4 個頂點、同一個 z）', () => {
    const few = stars.slice(0, 5);
    const g = starGeometry(few);
    const pos = g.getAttribute('position');
    expect(pos.count).toBe(20);
    expect(g.getIndex()!.count).toBe(30);
    for (let i = 0; i < few.length; i++) {
      const zs = [0, 1, 2, 3].map((k) => pos.getZ(i * 4 + k));
      expect(new Set(zs).size).toBe(1);
      expect(pos.getX(i * 4 + 1) - pos.getX(i * 4)).toBeCloseTo(few[i]!.size, 5); // Float32 頂點
    }
    expect(g.getAttribute('starInfo').itemSize).toBe(4);
  });
});

describe('慢慢轉', () => {
  it('很慢（一圈超過 100 秒）；轉卡越快轉越快；繞回 0～2π', () => {
    expect(NEBULA_SPIN).toBeLessThan(TAU / 100);
    const calm = initialNebulaMotion();
    const busy = initialNebulaMotion();
    stepNebula(calm, 0, 1, false);
    stepNebula(busy, 1, 1, false);
    expect(calm.spin).toBeCloseTo(NEBULA_SPIN, 12);
    expect(busy.spin).toBeGreaterThan(calm.spin * 2);
    const m = initialNebulaMotion();
    for (let i = 0; i < 400; i++) stepNebula(m, 0, 1, false);
    expect(m.spin).toBeGreaterThanOrEqual(0);
    expect(m.spin).toBeLessThan(TAU);
  });

  it('減少動態效果：不轉', () => {
    const m = initialNebulaMotion();
    stepNebula(m, 0, 1, false);
    const before = m.spin;
    stepNebula(m, 1, 5, true);
    expect(m.spin).toBe(before);
  });
});

describe('three.js 物件', () => {
  it('不擋卡片：比卡片先畫、不寫不測深度、留在不透明那一批、只在舞台那一層；2 個 draw call', () => {
    const fx = createNebulaFx();
    const card = createCardObject(fakeImage(4, 4), 1, fakeImage(512, 512));
    expect(fx.group.renderOrder).toBeLessThan(card.group.renderOrder);
    const parts = drawables(fx.group);
    expect(parts.length).toBe(2); // 背景平面（漩渦＋光暈＋霧）、星點
    for (const p of parts) {
      const m = p.material as Material;
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
      expect(p.layers.mask).toBe(1 << STAGE_LAYER);
    }
  });

  it('全部在卡片後面（z < 0）；背景平面在最遠', () => {
    const fx = createNebulaFx();
    for (const p of drawables(fx.group)) {
      const g = (p as Mesh).geometry;
      g.computeBoundingBox();
      expect(g.boundingBox!.max.z).toBeLessThan(0);
    }
    const [backdrop] = drawables(fx.group) as [Mesh];
    expect(backdrop.geometry.boundingBox!.max.z).toBeCloseTo(NEBULA_BACKDROP.z, 6);
  });

  it('跟著卡片比例改光暈高度與壓暗範圍；不跟著卡片轉', () => {
    const fx = createNebulaFx();
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    expect(fx.uniforms.haloY.value).toBeCloseTo(nebulaHaloY(ASPECT_HEIGHT.tarot), 12);
    expect(fx.uniforms.cardHalfH.value).toBeCloseTo(ASPECT_HEIGHT.tarot / 2, 12);
    fx.setPose(70, 30);
    fx.update(1 / 60);
    expect(fx.group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(fx.group.position.y).toBe(0);
  });

  it('每格只改 uniform：漩渦慢慢轉；減少動態效果時不轉不閃（時間停住），關掉後繼續', () => {
    const fx = createNebulaFx();
    const before = drawables(fx.group).map((p) => [p, p.geometry, p.material]);
    fx.update(0);
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(fx.uniforms.spin.value).toBeGreaterThan(0);
    fx.setReducedMotion(true);
    const still = [fx.uniforms.spin.value, fx.uniforms.time.value, fx.uniforms.halo.value];
    for (let i = 0; i < 60; i++) {
      fx.setPose(i * 10, 0);
      fx.update(1 / 60);
    }
    expect([fx.uniforms.spin.value, fx.uniforms.time.value, fx.uniforms.halo.value]).toEqual(still);
    fx.setReducedMotion(false);
    fx.update(1 / 60);
    expect(fx.uniforms.spin.value).toBeGreaterThan(still[0]!);
    expect(drawables(fx.group).map((p) => [p, p.geometry, p.material])).toEqual(before);
  });

  it('dispose：網格、材質都釋放，並從場景拿掉', () => {
    const fx = createNebulaFx();
    const parent = new Group();
    parent.add(fx.group);
    const freed = new Set<unknown>();
    const watch = (o: { addEventListener(t: 'dispose', f: () => void): void }) => o.addEventListener('dispose', () => freed.add(o));
    const parts = drawables(fx.group) as Mesh[];
    for (const p of parts) {
      watch(p.geometry);
      watch(p.material as Material);
    }
    fx.dispose();
    for (const p of parts) {
      expect(freed.has(p.geometry)).toBe(true);
      expect(freed.has(p.material)).toBe(true);
    }
    expect(fx.group.parent).toBeNull();
  });
});
