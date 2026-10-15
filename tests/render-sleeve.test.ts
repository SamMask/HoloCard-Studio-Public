// T-806 透明卡套（SCHEMA view.sleeve?、DESIGN「透明卡套」）在 render 的部分：只建 three.js 物件、不畫（不需要 WebGPU）。
// 1. 純數學（sleeve.ts）：尺寸、菲涅耳、反光帶、白邊。
// 2. card-mesh：沒開卡套時場景裡不加任何東西；開了多一組卡套（遠側 BackSide → 破框層 → 近側 FrontSide，不寫深度）；
//    卡面 shader 完全不變（同一個材質物件、節點圖指紋一樣）；比例、圓角改了卡套跟著換；擷取時可以暫時不畫。
// 3. 擷取的裁切（pick.ts）：給卡套的盒子時，卡套的 8 個角都在輸出圖裡。
import { BackSide, Box3, FrontSide, Group, PerspectiveCamera, Vector3, type Mesh, type MeshBasicNodeMaterial, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT, type Card, HOLO_PALETTES, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline } from '../src/render/fit';
import { CAPTURE_MARGIN, captureFrame, turntableFrame, type CaptureFrame, type PickScene } from '../src/render/pick';
import {
  reflectDir,
  SLEEVE,
  sleeveBounds,
  sleeveFresnel,
  SLEEVE_LOOK,
  SLEEVE_ORDER,
  sleeveOutline,
  sleeveRim,
  sleeveSheen,
  SLEEVE_THICKNESS,
} from '../src/render/sleeve';

const RAD = Math.PI / 180;

// ---------------------------------------------------------------- 1. 純數學

describe('卡套的尺寸（DESIGN：每邊約卡寬 3%、厚度約卡片的 3 倍、圓角＝卡片圓角＋邊距）', () => {
  it('每邊大 0.03 卡寬、厚度＝卡片 3 倍', () => {
    expect(SLEEVE.margin).toBe(0.03);
    expect(SLEEVE_THICKNESS).toBeCloseTo(CARD_THICKNESS * 3, 12);
  });

  it('輪廓：卡片輪廓往外推一圈（標準卡、塔羅、圓角 0 和最大）', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      for (const r of [0, 0.05, 0.12]) {
        const card = cardOutline(ASPECT_HEIGHT[aspect], r);
        expect(sleeveOutline(card)).toEqual({ halfW: card.halfW + 0.03, halfH: card.halfH + 0.03, r: r + 0.03 });
        expect(sleeveBounds(card)).toEqual({ halfW: card.halfW + 0.03, halfH: card.halfH + 0.03, thickness: SLEEVE_THICKNESS });
      }
    }
  });
});

describe('卡套的外觀算式', () => {
  it('菲涅耳：正面看幾乎是 0（鏡頭透視造成的 15° 以內 < 0.0005），越斜越亮，60° 時看得出來', () => {
    expect(sleeveFresnel(1)).toBe(0);
    expect(sleeveFresnel(Math.cos(15 * RAD))).toBeLessThan(0.0005);
    expect(sleeveFresnel(-1)).toBe(0); // 背面（法線朝另一邊）一樣
    let prev = -1;
    for (const deg of [0, 15, 30, 45, 60, 75, 89]) {
      const f = sleeveFresnel(Math.cos(deg * RAD));
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
    expect(sleeveFresnel(Math.cos(60 * RAD))).toBeGreaterThan(0.05);
    expect(sleeveFresnel(0)).toBeLessThanOrEqual(1);
  });

  it('反光帶：正面看（反射方向偏不到 0.3）沒有；左右轉約 20° 時掃過卡套（左右都有）', () => {
    for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) for (const y of [-0.3, 0, 0.3]) expect(sleeveSheen(x, y)).toBe(0);
    // 左右轉 θ：法線 (sin θ, 0, cos θ)，從鏡頭看過去的反射方向 x 約 sin 2θ
    const at = (deg: number) => {
      const n = [Math.sin(deg * RAD), 0, Math.cos(deg * RAD)] as const;
      const r = reflectDir([0, 0, -1], n);
      return sleeveSheen(r[0], r[1]);
    };
    expect(at(20)).toBeGreaterThan(SLEEVE_LOOK.sheen.strength * 0.5);
    expect(at(-20)).toBeCloseTo(at(20), 12);
    expect(at(0)).toBe(0);
    expect(at(45)).toBeLessThan(at(20));
  });

  it('白邊：輪廓上最亮、往內 rim.width 以外是 0（正面看時這一圈在卡片外面：rim.width < 邊距）', () => {
    expect(sleeveRim(0)).toBeCloseTo(SLEEVE_LOOK.rim.alpha, 12);
    expect(sleeveRim(-SLEEVE_LOOK.rim.width)).toBe(0);
    expect(sleeveRim(-SLEEVE.margin)).toBe(0);
    expect(SLEEVE_LOOK.rim.width).toBeLessThan(SLEEVE.margin);
    expect(sleeveRim(-SLEEVE_LOOK.rim.width / 2)).toBeGreaterThan(0);
    expect(sleeveRim(-SLEEVE_LOOK.rim.width / 2)).toBeLessThan(SLEEVE_LOOK.rim.alpha);
  });

  it('reflectDir＝GLSL reflect', () => {
    expect(reflectDir([0, 0, -1], [0, 0, 1])).toEqual([0, 0, 1]);
    const r = reflectDir([0, 0, -1], [Math.sin(30 * RAD), 0, Math.cos(30 * RAD)]);
    expect(r[0]).toBeCloseTo(Math.sin(60 * RAD), 12);
    expect(r[2]).toBeCloseTo(Math.cos(60 * RAD), 12);
  });

  it('繪製順序：遠側 < 破框層的卡外網格（0）< 近側', () => {
    expect(SLEEVE_ORDER.far).toBeLessThan(0);
    expect(SLEEVE_ORDER.near).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 2. card-mesh

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;
const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number, over: Partial<Layer> = {}): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: true, hasAlpha: depth > 0, ...over };
}

function card(over: Partial<Card> = {}, sleeve?: boolean): Card {
  const view = { returnToFront: true, showcase: false, stage: 'halo' as const };
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0, { holo: false }), layer('hero', 'bbbbbbbbbbbbbbbb', 50, { breakout: true, scale: 1.4 })] },
    back: { layers: [] },
    frame: { enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: sleeve === undefined ? view : { ...view, sleeve },
    ...over,
  };
}

const make = () => createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
/** 卡套那一組（group 的第 4 個子物件；卡身、正面、背面固定是前 3 個）。 */
const sleeveGroup = (obj: ReturnType<typeof make>): Object3D | undefined => obj.group.children[3];
const sleeveMeshes = (obj: ReturnType<typeof make>) => {
  const meshes = (sleeveGroup(obj)?.children ?? []) as Mesh[];
  const by = (order: number) => meshes.find((m) => m.renderOrder === order)!;
  return { far: by(SLEEVE_ORDER.far), near: by(SLEEVE_ORDER.near), all: meshes };
};
const faceMaterials = (obj: ReturnType<typeof make>) => (obj.group.children as Mesh[]).slice(0, 3).map((m) => m.material);

describe('card-mesh：沒開卡套時場景裡不加任何東西', () => {
  it('省略、明寫 false：group 只有卡身、正面、背面三個子物件，sleeve() 是 false', () => {
    for (const sleeve of [undefined, false]) {
      const obj = make();
      obj.update(card({}, sleeve), getImage);
      expect(obj.group.children).toHaveLength(3);
      expect(obj.sleeve()).toBe(false);
    }
  });
});

describe('card-mesh：開了卡套', () => {
  it('多一組（加在最後，前三個不變）：遠側 BackSide、近側 FrontSide，透明、不寫深度、要測深度', () => {
    const obj = make();
    obj.update(card({}, true), getImage);
    expect(obj.group.children).toHaveLength(4);
    expect(obj.sleeve()).toBe(true);
    const { far, near, all } = sleeveMeshes(obj);
    expect(all).toHaveLength(2);
    const fm = far.material as MeshBasicNodeMaterial;
    const nm = near.material as MeshBasicNodeMaterial;
    expect(fm.side).toBe(BackSide);
    expect(nm.side).toBe(FrontSide);
    for (const m of [fm, nm]) {
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(true);
    }
    expect(sleeveGroup(obj)!.visible).toBe(true);
    // 破框層的卡外網格夾在遠側與近側之間
    const ring = (obj.group.children[1] as Mesh).children[0] as Mesh;
    expect(ring.visible).toBe(true);
    expect(far.renderOrder).toBeLessThan(ring.renderOrder);
    expect(near.renderOrder).toBeGreaterThan(ring.renderOrder);
  });

  it('卡面不受影響：開關卡套不換卡面材質（同一個物件）', () => {
    const obj = make();
    obj.update(card(), getImage);
    const before = faceMaterials(obj);
    obj.update(card({}, true), getImage);
    obj.update(card({}, false), getImage);
    obj.update(card({}, true), getImage);
    faceMaterials(obj).forEach((m, i) => expect(m === before[i]).toBe(true));
  });

  it('關掉：卡套藏起來（不重建）；再開：同一組網格與材質', () => {
    const obj = make();
    obj.update(card({}, true), getImage);
    const first = sleeveMeshes(obj);
    const mats = first.all.map((m) => m.material);
    obj.update(card({}, false), getImage);
    expect(obj.sleeve()).toBe(false);
    expect(sleeveGroup(obj)!.visible).toBe(false);
    obj.update(card({}, true), getImage);
    expect(sleeveGroup(obj)!.visible).toBe(true);
    expect(obj.group.children).toHaveLength(4);
    sleeveMeshes(obj).all.forEach((m, i) => expect(m.material === mats[i]).toBe(true));
  });

  it('網格＝卡套輪廓、厚度＝卡套厚度；比例、圓角改了跟著換（舊網格釋放），只改其他設定不換', () => {
    const obj = make();
    obj.update(card({}, true), getImage);
    const box = () => {
      const g = sleeveMeshes(obj).near.geometry;
      g.computeBoundingBox();
      return g.boundingBox!.clone();
    };
    const expectBox = (b: Box3, aspect: 'standard' | 'tarot', r: number) => {
      const o = sleeveOutline(cardOutline(ASPECT_HEIGHT[aspect], r));
      expect(b.min.x).toBeCloseTo(-o.halfW, 6);
      expect(b.max.x).toBeCloseTo(o.halfW, 6);
      expect(b.min.y).toBeCloseTo(-o.halfH, 6);
      expect(b.max.y).toBeCloseTo(o.halfH, 6);
      expect(b.min.z).toBeCloseTo(-SLEEVE_THICKNESS / 2, 6);
      expect(b.max.z).toBeCloseTo(SLEEVE_THICKNESS / 2, 6);
    };
    expectBox(box(), 'standard', 0.05);
    const g1 = sleeveMeshes(obj).near.geometry;
    expect(sleeveMeshes(obj).far.geometry === g1).toBe(true);
    let disposed = 0;
    g1.addEventListener('dispose', () => disposed++);
    obj.update(card({ bodyColor: '#ff0000', holo: { ...card().holo, strength: 10 } }, true), getImage);
    expect(sleeveMeshes(obj).near.geometry === g1).toBe(true);
    obj.update(card({ aspect: 'tarot', cornerRadius: 0.12 }, true), getImage);
    expect(disposed).toBe(1);
    expectBox(box(), 'tarot', 0.12);
  });

  it('卡套關著時改比例：開的時候網格已經是新的比例', () => {
    const obj = make();
    obj.update(card({}, true), getImage);
    obj.update(card({}, false), getImage);
    obj.update(card({ aspect: 'tarot' }, false), getImage);
    obj.update(card({ aspect: 'tarot' }, true), getImage);
    const g = sleeveMeshes(obj).near.geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(sleeveOutline(cardOutline(ASPECT_HEIGHT.tarot, 0.05)).halfH, 6);
  });

  it('withoutSleeve：畫的那一下卡套不顯示，畫完恢復；draw 丟錯也恢復；沒開卡套時照樣呼叫 draw', () => {
    const obj = make();
    obj.update(card({}, true), getImage);
    let seen: boolean | null = null;
    obj.withoutSleeve(() => {
      seen = sleeveGroup(obj)!.visible;
    });
    expect(seen).toBe(false);
    expect(sleeveGroup(obj)!.visible).toBe(true);
    expect(() =>
      obj.withoutSleeve(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(sleeveGroup(obj)!.visible).toBe(true);
    const plain = make();
    plain.update(card(), getImage);
    let called = 0;
    plain.withoutSleeve(() => called++);
    expect(called).toBe(1);
    expect(plain.group.children).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- 3. 擷取的裁切包住卡套

const FOV = 30;
const VIEW_ASPECT = 1.6;

function scene(yawDeg: number, pitchDeg: number, withSleeve: boolean): PickScene {
  const outline = cardOutline(ASPECT_HEIGHT.standard, 0.05);
  return {
    vFovDeg: FOV,
    viewAspect: VIEW_ASPECT,
    cameraZ: cameraDistance(FOV, VIEW_ASPECT, 1, cardBox(ASPECT_HEIGHT.standard)),
    yawDeg,
    pitchDeg,
    outline,
    thickness: CARD_THICKNESS,
    ...(withSleeve ? { bounds: sleeveBounds(outline) } : {}),
  };
}

/** 照 frame 設 three.js 鏡頭，卡套 8 個角在輸出圖上的像素座標。 */
function sleeveCorners(s: PickScene, frame: CaptureFrame, yawDeg = s.yawDeg): { x: number; y: number }[] {
  const camera = new PerspectiveCamera(FOV, s.viewAspect, 0.05, 100);
  camera.position.set(0, 0, s.cameraZ);
  const v = frame.viewOffset;
  camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
  camera.updateMatrixWorld();
  const group = new Group();
  group.rotation.set(s.pitchDeg * RAD, yawDeg * RAD, 0);
  group.updateMatrixWorld(true);
  const b = sleeveBounds(s.outline);
  const out: { x: number; y: number }[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = new Vector3(sx * b.halfW, sy * b.halfH, (sz * b.thickness) / 2).applyMatrix4(group.matrixWorld).project(camera);
        out.push({ x: ((p.x + 1) / 2) * frame.width, y: ((1 - p.y) / 2) * frame.height });
      }
  return out;
}

const inside = (pts: { x: number; y: number }[], frame: CaptureFrame) =>
  pts.every((p) => p.x >= 0 && p.x <= frame.width && p.y >= 0 && p.y <= frame.height);

/** 卡套 8 個角離輸出圖四邊最近的距離，以「卡套外框長邊 × CAPTURE_MARGIN」為 1（照規則留邊＝1）。 */
function marginRatio(pts: { x: number; y: number }[], frame: CaptureFrame): number {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const gap = Math.min(minX, frame.width - maxX, minY, frame.height - maxY);
  return gap / (CAPTURE_MARGIN * Math.max(maxX - minX, maxY - minY));
}

describe('擷取的裁切：畫卡套時包住卡套（邊緣不被切掉）', () => {
  it('PNG（captureFrame）：0°、左右 35°、上下 30°、背面：卡套 8 個角都在圖裡、四邊照規則留邊；不給卡套時邊留不夠（對照）', () => {
    for (const [yaw, pitch] of [[0, 0], [35, 0], [-35, 10], [0, 30], [180, 0], [150, -20]] as const) {
      const withSleeve = scene(yaw, pitch, true);
      const frame = captureFrame(withSleeve, 1500);
      const pts = sleeveCorners(withSleeve, frame);
      expect(inside(pts, frame), `${yaw},${pitch}`).toBe(true);
      expect(marginRatio(pts, frame), `${yaw},${pitch}`).toBeGreaterThan(0.95);
    }
    const plain = scene(0, 0, false);
    const frame = captureFrame(plain, 1500);
    expect(marginRatio(sleeveCorners(plain, frame), frame)).toBeLessThan(0.6);
  });

  it('畫卡套時輸出圖的卡片比較小（裁切比較大），寬一樣；不給 bounds＝和以前一模一樣', () => {
    const a = captureFrame(scene(0, 0, false), 1500);
    const b = captureFrame(scene(0, 0, true), 1500);
    expect(b.width).toBe(a.width);
    expect(b.viewOffset.fullWidth).toBeLessThan(a.viewOffset.fullWidth);
    const old = captureFrame({ ...scene(0, 0, false) }, 1500);
    expect(old).toEqual(a);
  });

  it('轉一圈（turntableFrame）：整圈每 15° 卡套 8 個角都在圖裡（左右擺動也是）', () => {
    const s = { ...scene(0, -8, true) };
    const frame = turntableFrame(s, 720);
    for (let yaw = 0; yaw < 360; yaw += 15) expect(inside(sleeveCorners(s, frame, yaw), frame), String(yaw)).toBe(true);
    const swing = turntableFrame(s, 720, 30);
    for (const yaw of [-30, -15, 0, 15, 30]) expect(inside(sleeveCorners(s, swing, yaw), swing), `swing ${yaw}`).toBe(true);
  });
});
