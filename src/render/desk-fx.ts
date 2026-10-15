// 舞台主題「工作桌」（T-832，DESIGN §5「工作桌（壓克力展示架）」）：由 stage-switch.ts 在選工作桌時建立、換掉時 dispose。
// 尺寸與算式在 desk-layout.ts（純數學、有測試），著色在 desk-nodes.ts，倒影在 reflection.ts（共用模組）。遠景（木桌）是 CSS 那層（ui/stage.ts）。
//
// 和其他舞台不一樣：展示座跟著卡片一起轉——setPose 收到的角度照卡片的旋轉（rotation.set(pitch, yaw, 0)，card-view 的 setPose 同一組數字）
// 套在 stand 上，桌面那片、倒影的鏡面、壓克力都在 stand 裡（整座一起轉、一起傾；上下只傾 ±10° 由 interact 夾）。
//
// 繪製順序：
//   - 桌面（影子＋倒影）：整組 group 的 renderOrder −1、留在「不透明」那一批、不測深度（stage-material.ts），比卡片先畫，卡片蓋在上面；
//   - 壓克力：放在 renderOrder 0 的 Group 裡（和卡片的 group 同一組排序）、透明那一批：卡片（不透明）→ 遠側 −1 → 近側 −0.5 → 破框層的卡外網格 0
//     （照透明卡套的做法，desk-layout.ts 的 DESK_ORDER；近側排在破框層之前＝衝出來的部分在壓克力前面）：卡片插在座裡、從任何角度看都對，不用每格重新排序。
// 展示座與桌面都在 STAGE_LAYER：倒影的鏡頭只看卡片那一層（桌面映出卡片，不映出展示座自己）。
// 擷取（PNG、影片、GIF、縮圖）時 stage-switch 的 hidden 整組藏起來：展示座也不畫。
// 有自己的背景圖（setBackdrop 有圖）：背景圖取代木桌（CSS 那層，ui），桌面那片（影子、倒影）也讓出來不畫，展示座照畫。
// 沒有會隨時間動的東西（減少動態時本來就靜止）。
//
// 每影格的 draw call：壓克力 2（同一個網格畫遠側、近側）＋桌面 1＝3 個；倒影多一個 pass（卡片在半解析度 render target 再畫一次，同展示廳）。
// 每格只改 stand 的旋轉，不建網格、材質；比例改了才換壓克力的網格（舊的釋放）。

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  type Camera,
  type NodeMaterial,
} from 'three/webgpu';
import { positionLocal, uniform } from 'three/tsl';
import { DEFAULT_CARD_H } from './fit';
import { DESK_ORDER, DESK_PLANE_HALF, deskBoxes, deskY, type DeskBox } from './desk-layout';
import { acrylicMaterial, BOX_CENTER, BOX_HALF, deskPlaneLook } from './desk-nodes';
import { createPlanarReflection, STAGE_LAYER, type PlanarReflection } from './reflection';
import { stageMaterial } from './stage-material';
import type { StagePart } from './stage-switch';

const RAD = Math.PI / 180;

export interface DeskDeps {
  /** 主鏡頭：倒影的鏡頭由它複製。 */
  camera: Camera;
}

export interface DeskPart extends StagePart {
  /** 跟著卡片轉的那一組（壓克力、桌面、倒影的鏡面都在裡面；檢查用）。 */
  readonly stand: Object3D;
  /** 壓克力的遠側、近側（同一個網格）與桌面（檢查用）。 */
  readonly far: Mesh;
  readonly near: Mesh;
  readonly plane: Mesh;
  readonly reflection: PlanarReflection;
}

/** 一個長方體的 6 個面（每面 4 個頂點、法線朝外），頂點帶著這塊的中心與半邊長（邊緣亮線用）。 */
const FACES: readonly { axis: 0 | 1 | 2; sign: 1 | -1 }[] = [
  { axis: 0, sign: 1 },
  { axis: 0, sign: -1 },
  { axis: 1, sign: 1 },
  { axis: 1, sign: -1 },
  { axis: 2, sign: 1 },
  { axis: 2, sign: -1 },
];

/** 展示座的網格：每塊 6 個面、各 4 個頂點（逆時針朝外），屬性 position、normal、boxCenter、boxHalf。 */
export function standGeometry(boxes: readonly DeskBox[]): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const center: number[] = [];
  const half: number[] = [];
  const index: number[] = [];
  for (const box of boxes) {
    for (const { axis, sign } of FACES) {
      // 這個面的另外兩個軸（u × v 要朝外：sign 決定順序）
      const u = ((axis + 1) % 3) as 0 | 1 | 2;
      const v = ((axis + 2) % 3) as 0 | 1 | 2;
      const corners = sign > 0 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [-1, 1], [1, 1], [1, -1]];
      const start = position.length / 3;
      for (const [cu, cv] of corners) {
        const p = [0, 0, 0];
        p[axis] = box.center[axis] + sign * box.half[axis];
        p[u] = box.center[u] + cu! * box.half[u];
        p[v] = box.center[v] + cv! * box.half[v];
        position.push(p[0]!, p[1]!, p[2]!);
        const n = [0, 0, 0];
        n[axis] = sign;
        normal.push(n[0]!, n[1]!, n[2]!);
        center.push(...box.center);
        half.push(...box.half);
      }
      index.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute(BOX_CENTER, new BufferAttribute(new Float32Array(center), 3));
  g.setAttribute(BOX_HALF, new BufferAttribute(new Float32Array(half), 3));
  g.setIndex(index);
  return g;
}

export function createDeskFx(deps: DeskDeps): DeskPart {
  const group = new Group();
  // 桌面在「不透明」那一批、比卡片先畫（卡片的 group 是 0）
  group.renderOrder = DESK_ORDER.plane;
  const stand = new Object3D();
  group.add(stand);

  // ---- 桌面：影子＋倒影（鏡面在桌面上，跟著整座轉、傾） ----
  const reflection = createPlanarReflection(deps.camera);
  stand.add(reflection.target);
  const planeWorldY = uniform(deskY(DEFAULT_CARD_H));
  const planeGeometry = new PlaneGeometry(DESK_PLANE_HALF * 2, DESK_PLANE_HALF * 2);
  planeGeometry.rotateX(-Math.PI / 2);
  const plane = new Mesh(
    planeGeometry,
    stageMaterial(new MeshBasicNodeMaterial(), deskPlaneLook(positionLocal.xz, reflection.sample(planeWorldY)), 'over'),
  );
  plane.layers.set(STAGE_LAYER);
  stand.add(plane);

  // ---- 壓克力：renderOrder 0 的 Group（和卡片同一組排序），同一個網格畫遠側、近側 ----
  const acrylic = new Group();
  acrylic.renderOrder = 0;
  stand.add(acrylic);
  const far = new Mesh(undefined, acrylicMaterial('far'));
  far.renderOrder = DESK_ORDER.far;
  const near = new Mesh(undefined, acrylicMaterial('near'));
  near.renderOrder = DESK_ORDER.near;
  for (const m of [far, near]) {
    m.layers.set(STAGE_LAYER);
    acrylic.add(m);
  }

  let cardH: number | null = null;
  const setCardHeight = (next: number) => {
    if (next === cardH) return;
    cardH = next;
    const { block, base } = deskBoxes(next);
    const old = far.geometry;
    const geometry = standGeometry([block, base]);
    far.geometry = geometry; // 兩側共用同一個網格
    near.geometry = geometry;
    old.dispose();
    const y = deskY(next);
    plane.position.y = y;
    reflection.target.position.y = y;
    planeWorldY.value = y;
  };
  setCardHeight(DEFAULT_CARD_H);

  return {
    group,
    stand,
    far,
    near,
    plane,
    reflection,

    setCardHeight,

    // 沒有會隨時間動的東西：減少動態時本來就靜止
    setReducedMotion() {},

    setPose(yawDeg, pitchDeg) {
      // 同 card-view 的卡片：rotation.set(pitch, yaw, 0)（整座和卡片繞卡片中心一起轉）
      stand.rotation.set(pitchDeg * RAD, yawDeg * RAD, 0);
    },

    update() {},

    setBackdrop(next) {
      // 自己的背景圖取代木桌：桌面的影子與倒影讓出來（倒影的 pass 也就不跑），展示座照畫
      plane.visible = next === null;
    },

    dispose() {
      far.geometry.dispose();
      planeGeometry.dispose();
      for (const m of [far, near, plane]) (m.material as NodeMaterial).dispose();
      reflection.dispose();
      group.removeFromParent();
    },
  };
}
