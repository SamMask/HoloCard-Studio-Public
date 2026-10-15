// 舞台第七種「工作桌」（T-832，DESIGN §5「工作桌（壓克力展示架）」）：
//   1. 展示座的尺寸（desk-layout.ts）：夾住卡片下緣往上卡高 1/5、開著透明卡套也放得進槽裡、底座在夾塊下面、桌面在底座底面；
//   2. 外觀算式的 CPU 版（邊緣亮線、桌上的影子、倒影淡出）；
//   3. desk-fx.ts：展示座跟著卡片一起轉（和卡片同一個旋轉）、繪製順序照透明卡套的做法（遠側 → 近側 → 破框層：衝出來的部分在壓克力前面）、draw call 少（3 個網格、共用網格）、
//      每格不建東西、沒有會隨時間動的東西（減少動態時靜止）、有自己的背景圖時桌面讓出來、比例改了才換網格、釋放乾淨；
//   4. 經 stage-switch：選工作桌建這一組、擷取時（hidden）整組不畫、不改取景。
import { BackSide, FrontSide, Group, Mesh, Object3D, PerspectiveCamera, Texture, Vector3, type Material } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT } from '../src/model/types';
import { createDeskFx } from '../src/render/desk-fx';
import {
  boxEdgeDistance,
  DESK,
  DESK_LOOK,
  DESK_ORDER,
  deskBoxes,
  deskReflectionFade,
  deskRim,
  deskShadow,
  deskY,
} from '../src/render/desk-layout';
import { CARD_THICKNESS, DEFAULT_CARD_H } from '../src/render/fit';
import { STAGE_LAYER } from '../src/render/reflection';
import { SLEEVE, SLEEVE_ORDER, SLEEVE_THICKNESS } from '../src/render/sleeve';
import { createStageSwitch, stageReach, type StagePart } from '../src/render/stage-switch';

const RAD = Math.PI / 180;
const HEIGHTS = [ASPECT_HEIGHT.standard, ASPECT_HEIGHT.tarot, ASPECT_HEIGHT.square, ASPECT_HEIGHT.postcard, 2 / 3];

describe('1. 展示座的尺寸', () => {
  it('夾塊：從槽底到卡片下緣往上卡高 1/5；比卡片（和卡套）寬、比卡套厚', () => {
    for (const cardH of HEIGHTS) {
      const { block } = deskBoxes(cardH);
      const bottom = -cardH / 2;
      const top = block.center[1] + block.half[1];
      const floor = block.center[1] - block.half[1];
      expect(top - bottom, String(cardH)).toBeCloseTo(cardH / 5, 12);
      // 開著卡套時卡套下緣（卡片下緣再往下 0.03）也在槽裡
      expect(floor).toBeLessThan(bottom - SLEEVE.margin);
      expect(block.half[0]).toBeGreaterThan(0.5 + SLEEVE.margin);
      expect(block.half[2]).toBeGreaterThan(SLEEVE_THICKNESS / 2 + 0.03);
      expect(block.center[0]).toBe(0);
      expect(block.center[2]).toBe(0);
    }
  });

  it('底座在夾塊正下面、比夾塊寬也比夾塊深；桌面＝底座底面', () => {
    for (const cardH of HEIGHTS) {
      const { block, base } = deskBoxes(cardH);
      expect(base.center[1] + base.half[1]).toBeCloseTo(block.center[1] - block.half[1], 12);
      expect(base.half[0]).toBeGreaterThan(block.half[0]);
      expect(base.half[2]).toBeGreaterThan(block.half[2]);
      expect(deskY(cardH)).toBeCloseTo(base.center[1] - base.half[1], 12);
      expect(deskY(cardH)).toBeLessThan(-cardH / 2);
    }
  });

  it('繪製順序：遠側（同卡套遠側）< 近側 < 破框層的卡外網格（0，衝出來的部分在壓克力前面）< 卡套近側；桌面在卡片之前', () => {
    expect(DESK_ORDER.far).toBe(SLEEVE_ORDER.far);
    expect(DESK_ORDER.far).toBeLessThan(DESK_ORDER.near);
    expect(DESK_ORDER.near).toBeLessThan(0);
    expect(DESK_ORDER.near).toBeLessThan(SLEEVE_ORDER.near);
    expect(DESK_ORDER.plane).toBeLessThan(0);
  });
});

describe('2. 外觀算式', () => {
  it('邊緣亮線：面的中間離稜邊＝另外兩個半邊長裡小的那個；稜邊上 0、最亮；width 以外沒有', () => {
    const { block } = deskBoxes(DEFAULT_CARD_H);
    const [cx, cy, cz] = block.center;
    const [hx, hy, hz] = block.half;
    // 正面中間：離上下的邊 hy、左右的邊 hx → 取小的
    expect(boxEdgeDistance([cx, cy, cz + hz], block)).toBeCloseTo(Math.min(hx, hy), 12);
    // 正面的上緣、右上的稜邊
    expect(boxEdgeDistance([cx, cy + hy, cz + hz], block)).toBeCloseTo(0, 12);
    expect(boxEdgeDistance([cx + hx, cy, cz + hz], block)).toBeCloseTo(0, 12);
    expect(deskRim(0)).toBeCloseTo(DESK_LOOK.rim.alpha, 12);
    expect(deskRim(DESK_LOOK.rim.width)).toBe(0);
    expect(deskRim(DESK_LOOK.rim.width / 2)).toBeGreaterThan(0);
    expect(deskRim(DESK_LOOK.rim.width / 2)).toBeLessThan(DESK_LOOK.rim.alpha);
  });

  it('桌上的影子：底座邊上最深、往外越來越淡、遠處沒有；整體是淡的（壓克力透明）', () => {
    const edge = deskShadow(DESK.base.halfW, 0);
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.7);
    expect(deskShadow(DESK.base.halfW + 0.1, 0)).toBeLessThan(edge);
    expect(deskShadow(DESK.base.halfW + 0.2, 0)).toBeLessThan(deskShadow(DESK.base.halfW + 0.1, 0));
    expect(deskShadow(DESK.base.halfW + 0.5, 0)).toBe(0);
    expect(deskShadow(0, DESK.base.halfD + 0.5)).toBe(0);
  });

  it('倒影：展示座附近全部、離中心 1.15 卡寬以外沒有', () => {
    expect(deskReflectionFade(0, 0.5)).toBe(1);
    expect(deskReflectionFade(0, 1.2)).toBe(0);
    expect(deskReflectionFade(1, 0)).toBeGreaterThan(0);
    expect(deskReflectionFade(1, 0)).toBeLessThan(1);
  });
});

function setup() {
  const camera = new PerspectiveCamera(30, 1, 0.05, 100);
  const desk = createDeskFx({ camera });
  return { camera, desk };
}

/** 卡片在 card-view 裡的旋轉（rotation.set(pitch, yaw, 0)）。 */
function cardTurned(yaw: number, pitch: number): Object3D {
  const o = new Object3D();
  o.rotation.set(pitch * RAD, yaw * RAD, 0);
  o.updateMatrixWorld(true);
  return o;
}

describe('3. desk-fx：展示座', () => {
  it('跟著卡片一起轉：setPose 之後展示座（底座四角、夾塊）和卡片用同一個旋轉；能轉到背面', () => {
    const { desk } = setup();
    const { block, base } = deskBoxes(DEFAULT_CARD_H);
    const corner = new Vector3(base.half[0], base.center[1] - base.half[1], base.half[2]);
    const top = new Vector3(block.half[0], block.center[1] + block.half[1], block.half[2]);
    for (const [yaw, pitch] of [
      [0, 0],
      [40, 0],
      [-40, 10],
      [180, -10],
      [95, 6],
    ] as const) {
      desk.setPose(yaw, pitch);
      desk.group.updateMatrixWorld(true);
      const ref = cardTurned(yaw, pitch);
      for (const p of [corner, top]) {
        const got = p.clone().applyMatrix4(desk.stand.matrixWorld);
        const want = p.clone().applyMatrix4(ref.matrixWorld);
        expect(got.distanceTo(want), `${yaw},${pitch}`).toBeLessThan(1e-9);
      }
    }
    // 轉到背面：底座朝鏡頭那一邊（+z）轉到後面
    desk.setPose(180, 0);
    desk.group.updateMatrixWorld(true);
    expect(corner.clone().applyMatrix4(desk.stand.matrixWorld).z).toBeLessThan(0);
  });

  it('繪製順序與材質照透明卡套：壓克力在 renderOrder 0 的 Group 裡（和卡片同一組排序）、遠側 BackSide、近側 FrontSide，透明、不寫深度、要測深度', () => {
    const { desk } = setup();
    const acrylic = desk.far.parent!;
    expect(acrylic).toBeInstanceOf(Group);
    expect(acrylic.renderOrder).toBe(0);
    expect(desk.near.parent).toBe(acrylic);
    expect(desk.far.renderOrder).toBe(DESK_ORDER.far);
    expect(desk.near.renderOrder).toBe(DESK_ORDER.near);
    const fm = desk.far.material as Material;
    const nm = desk.near.material as Material;
    expect(fm.side).toBe(BackSide);
    expect(nm.side).toBe(FrontSide);
    for (const m of [fm, nm]) {
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(true);
    }
    // 桌面：整組 renderOrder −1、不透明那一批、不測不寫深度（比卡片先畫，卡片蓋在上面）
    expect(desk.group).toBeInstanceOf(Group);
    expect(desk.group.renderOrder).toBe(DESK_ORDER.plane);
    const pm = desk.plane.material as Material;
    expect(pm.transparent).toBe(false);
    expect(pm.depthTest).toBe(false);
    expect(pm.depthWrite).toBe(false);
    expect(desk.plane.position.y).toBeCloseTo(deskY(DEFAULT_CARD_H), 12);
  });

  it('draw call 少：整組只有 3 個網格（遠側、近側共用同一個網格＋桌面），都在舞台那一層（倒影不映出展示座）', () => {
    const { desk } = setup();
    const meshes: Mesh[] = [];
    desk.group.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.length).toBe(3);
    expect(desk.far.geometry).toBe(desk.near.geometry);
    for (const m of meshes) expect(m.layers.mask).toBe(1 << STAGE_LAYER);
    // 兩塊長方體 × 6 面 × 4 個頂點
    expect(desk.far.geometry.getAttribute('position').count).toBe(48);
  });

  it('每格不建東西、沒有會隨時間動的東西：update、setPose、減少動態都不換網格與材質，桌面與壓克力的位置不變', () => {
    const { desk } = setup();
    const before = { g: desk.far.geometry, fm: desk.far.material, nm: desk.near.material, pm: desk.plane.material, y: desk.plane.position.y };
    desk.setPose(20, 5);
    desk.group.updateMatrixWorld(true);
    const matrix = desk.stand.matrixWorld.clone();
    for (const reduced of [false, true]) {
      desk.setReducedMotion(reduced);
      for (let i = 0; i < 120; i++) desk.update(1 / 60);
    }
    desk.group.updateMatrixWorld(true);
    expect(desk.stand.matrixWorld.equals(matrix)).toBe(true);
    expect(desk.far.geometry).toBe(before.g);
    expect(desk.far.material).toBe(before.fm);
    expect(desk.near.material).toBe(before.nm);
    expect(desk.plane.material).toBe(before.pm);
    expect(desk.plane.position.y).toBe(before.y);
  });

  it('比例改了才換網格（舊的釋放）；桌面、倒影的鏡面跟著降到新的桌面高度；同一個比例再設不做事', () => {
    const { desk } = setup();
    const old = desk.far.geometry;
    let freed = false;
    old.addEventListener('dispose', () => (freed = true));
    desk.setCardHeight(DEFAULT_CARD_H);
    expect(desk.far.geometry).toBe(old);
    desk.setCardHeight(ASPECT_HEIGHT.tarot);
    expect(desk.far.geometry).not.toBe(old);
    expect(desk.near.geometry).toBe(desk.far.geometry);
    expect(freed).toBe(true);
    expect(desk.plane.position.y).toBeCloseTo(deskY(ASPECT_HEIGHT.tarot), 12);
    expect(desk.reflection.target.position.y).toBeCloseTo(deskY(ASPECT_HEIGHT.tarot), 12);
    // 網格的範圍＝新比例的展示座
    desk.far.geometry.computeBoundingBox();
    const box = desk.far.geometry.boundingBox!;
    const { block, base } = deskBoxes(ASPECT_HEIGHT.tarot);
    expect(box.max.y).toBeCloseTo(block.center[1] + block.half[1], 6);
    expect(box.min.y).toBeCloseTo(base.center[1] - base.half[1], 6);
  });

  it('有自己的背景圖：桌面（影子、倒影）讓出來，展示座照畫；拿掉就回來', () => {
    const { desk } = setup();
    const backdrop = { texture: new Texture(), width: 100, height: 50 };
    desk.setBackdrop!(backdrop);
    expect(desk.plane.visible).toBe(false);
    expect(desk.far.visible && desk.near.visible).toBe(true);
    desk.setBackdrop!(null);
    expect(desk.plane.visible).toBe(true);
  });

  it('釋放：網格、材質、倒影的 render target 都釋放，從場景拿掉', () => {
    const { desk } = setup();
    const parent = new Group();
    parent.add(desk.group);
    const pending = new Set<unknown>();
    const watch = (o: { addEventListener(t: 'dispose', f: () => void): void }) => {
      pending.add(o);
      o.addEventListener('dispose', () => pending.delete(o));
    };
    desk.group.traverse((o) => {
      if (o instanceof Mesh) {
        watch(o.geometry);
        watch(o.material as Material);
      }
    });
    watch(desk.reflection.node);
    desk.dispose();
    expect(pending.size).toBe(0);
    expect(desk.group.parent).toBeNull();
  });
});

describe('4. 經 stage-switch', () => {
  const make = (camera: PerspectiveCamera) => {
    const other = (): StagePart => ({ group: new Group(), setCardHeight() {}, setReducedMotion() {}, setPose() {}, update() {}, dispose() {} });
    return createStageSwitch({
      halo: other,
      gallery: () => ({ ...other(), setThumbs() {} }),
      magic: other,
      water: () => ({ ...other(), setScene() {}, setFarPan() {}, setLook() {} }),
      nebula: other,
      desk: () => createDeskFx({ camera }),
    });
  };

  it('選工作桌：建展示座（套上目前的比例與角度）；擷取時（hidden）整組不畫、畫完還原', () => {
    const camera = new PerspectiveCamera(30, 1, 0.05, 100);
    const sw = make(camera);
    sw.setCardHeight(ASPECT_HEIGHT.tarot);
    sw.setPose(30, 8);
    sw.setStyle('desk');
    expect(sw.group.children.length).toBe(1);
    const part = sw.group.children[0]!;
    const stand = part.children[0]!;
    expect(stand.rotation.x).toBeCloseTo(8 * RAD, 12);
    expect(stand.rotation.y).toBeCloseTo(30 * RAD, 12);
    let meshY = 0;
    part.traverse((o) => {
      if (o instanceof Mesh && o.geometry.getAttribute('boxCenter')) {
        o.geometry.computeBoundingBox();
        meshY = o.geometry.boundingBox!.max.y;
      }
    });
    expect(meshY).toBeCloseTo(-ASPECT_HEIGHT.tarot / 2 + ASPECT_HEIGHT.tarot / 5, 6);
    // 之後的角度也轉給它
    sw.setPose(-50, -10);
    expect(stand.rotation.y).toBeCloseTo(-50 * RAD, 12);
    expect(sw.hidden(() => sw.group.visible)).toBe(false);
    expect(sw.group.visible).toBe(true);
  });

  it('不改取景（卡片和別的舞台一樣大）；卡片厚度在夾塊裡', () => {
    expect(stageReach('desk', DEFAULT_CARD_H)).toBeNull();
    expect(CARD_THICKNESS / 2).toBeLessThan(DESK.block.halfDepth);
  });
});
