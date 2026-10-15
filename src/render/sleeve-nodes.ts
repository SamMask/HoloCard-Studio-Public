// 透明卡套（T-806）的網格與著色（TSL）。尺寸、外觀常數、算式的 CPU 版在 sleeve.ts（有測試；改一邊要改另一邊）。
// 網格：卡套輪廓的圓角矩形擠出成盒子（正面、背面、側邊一個 ExtrudeGeometry），中心＝卡片中心，放在卡片的 group 裡跟著轉；
// 卡片的比例、圓角改了才換網格（setOutline）。
// 透明面的繪製順序（sleeve.ts 的 SLEEVE_ORDER）：同一個網格畫兩次——遠的那一側（BackSide，看到的是盒子內側）先畫、
// 近的那一側（FrontSide）最後畫；都不寫深度、要測深度：遠側在卡片後面的部分被卡片的深度擋掉（不會把卡片蓋成霧霧的），
// 近側一定在卡片前面。盒子是凸的、卡片在裡面，所以從任何角度看這個順序都對，不用每格重新排序、也不會閃。
// 著色：正反兩面＝菲涅耳＋滑過的反光帶＋白邊（遠側多一層很淡的白）；側邊＝半透明白＋菲涅耳。用正面還是側邊的算式
// 看幾何法線（正反兩面的法線是 ±z、側邊的 z 是 0）。視線、法線、反射方向都在世界座標算（每個像素自己的視線），
// 倒影、擷取（鏡頭位置不同）也一樣對。沒有貼圖、沒有時間（減少動態效果時照舊：隨角度變化不算動畫）。

import { BackSide, ExtrudeGeometry, FrontSide, Group, Mesh, MeshBasicNodeMaterial, Shape, Vector2, type BufferGeometry, type Node, type UniformNode } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  dot,
  float,
  mix,
  normalLocal,
  normalWorldGeometry,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  saturate,
  smoothstep,
  step,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import type { RoundedRect } from './fit';
import { roundedRectSdfNode } from './frame-nodes';
import { SLEEVE_LOOK as L, SLEEVE_ORDER, SLEEVE_THICKNESS, sleeveOutline } from './sleeve';

type F = Node<'float'>;

const CURVE_SEGMENTS = 16;

export interface SleeveObject {
  /** 放進卡片的 group（跟著卡片轉）；藏起來＝visible false。 */
  readonly group: Group;
  /** 卡片輪廓（比例、圓角）→ 卡套網格；和上次一樣不做事，變了才換（舊網格釋放）。 */
  setOutline(card: RoundedRect): void;
}

/** 圓角矩形（同 card-mesh 的卡片形狀）。 */
function roundedShape({ halfW, halfH, r }: RoundedRect): Shape {
  const s = new Shape();
  s.moveTo(-halfW + r, -halfH);
  s.lineTo(halfW - r, -halfH);
  if (r > 0) s.absarc(halfW - r, -halfH + r, r, -Math.PI / 2, 0, false);
  s.lineTo(halfW, halfH - r);
  if (r > 0) s.absarc(halfW - r, halfH - r, r, 0, Math.PI / 2, false);
  s.lineTo(-halfW + r, halfH);
  if (r > 0) s.absarc(-halfW + r, halfH - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-halfW, -halfH + r);
  if (r > 0) s.absarc(-halfW + r, -halfH + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * 塑膠的菲涅耳反光比例（同 sleeve.ts 的 sleeveFresnel）：normal＝表面法線、toEye＝往眼睛的方向（都是世界座標的單位向量）。
 * 透明卡套與工作桌的壓克力展示座（T-832，desk-nodes.ts）共用。
 */
export function plasticFresnel(normal: Node<'vec3'>, toEye: Node<'vec3'>): F {
  return pow(float(1).sub(saturate(abs(dot(normal, toEye)))), L.fresnel.power).mul(L.fresnel.gain) as F;
}

/** 塑膠上滑過的反光帶（同 sleeve.ts 的 sleeveSheen）：反射方向投到斜方向上，|u| 在 center 附近亮。卡套與展示座共用。 */
export function plasticSheen(normal: Node<'vec3'>, toEye: Node<'vec3'>): F {
  const r = reflect(toEye.negate(), normal);
  const u = abs(dot(r.xy, vec2(L.sheen.dir.x, L.sheen.dir.y)));
  return float(1).sub(smoothstep(0, L.sheen.halfWidth, abs(u.sub(L.sheen.center)))).mul(L.sheen.strength) as F;
}

/**
 * 卡套一側（遠側 'far'＝BackSide、近側 'near'＝FrontSide）的材質。算式見 sleeve.ts：
 * a_正反面＝菲涅耳＋反光帶＋白邊（遠側＋farTint）、a_側邊＝菲涅耳＋side.alpha，輸出 (塑膠色, a) 一般半透明混色。
 */
function sleeveMaterial(pass: 'far' | 'near', half: UniformNode<'vec2', Vector2>, radius: UniformNode<'float', number>): MeshBasicNodeMaterial {
  const cap = step(0.5, abs(normalLocal.z));
  const normal = normalWorldGeometry;
  const toEye = cameraPosition.sub(positionWorld).normalize();
  const fresnel = plasticFresnel(normal, toEye);
  // 反光帶：反射方向投到斜方向上，|u| 在 center 附近亮（同 sleeve.ts 的 sleeveSheen）
  const sheen = plasticSheen(normal, toEye);
  // 白邊：卡套輪廓往內 rim.width 以內漸亮（同 sleeveRim）
  const t = smoothstep(-L.rim.width, 0, roundedRectSdfNode(positionLocal.xy, half, radius));
  const rim = t.mul(t).mul(L.rim.alpha);
  let capAlpha: F = fresnel.add(sheen).add(rim);
  if (pass === 'far') capAlpha = capAlpha.add(L.farTint);
  const sideAlpha = fresnel.add(L.side.alpha);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(L.color[0], L.color[1], L.color[2], saturate(mix(sideAlpha, capAlpha, cap)));
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = pass === 'far' ? BackSide : FrontSide;
  return material;
}

export function createSleeveObject(): SleeveObject {
  const half = new Vector2(0.5, 0.5);
  const uHalf = uniform(half);
  const uRadius = uniform(0);
  const far = new Mesh(undefined, sleeveMaterial('far', uHalf, uRadius));
  far.renderOrder = SLEEVE_ORDER.far;
  const near = new Mesh(undefined, sleeveMaterial('near', uHalf, uRadius));
  near.renderOrder = SLEEVE_ORDER.near;
  const group = new Group();
  group.add(far, near);
  let key: string | null = null;

  return {
    group,
    setOutline(card) {
      const o = sleeveOutline(card);
      const next = `${o.halfW}|${o.halfH}|${o.r}`;
      if (next === key) return;
      key = next;
      const old = new Set<BufferGeometry>([far.geometry, near.geometry]);
      const geometry = new ExtrudeGeometry(roundedShape(o), { depth: SLEEVE_THICKNESS, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
      geometry.translate(0, 0, -SLEEVE_THICKNESS / 2);
      far.geometry = geometry; // 兩側共用同一個網格
      near.geometry = geometry;
      for (const g of old) g.dispose();
      half.set(o.halfW, o.halfH);
      uRadius.value = o.r;
    },
  };
}
