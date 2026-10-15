// CD 光碟（T-810）的網格與著色（TSL）。尺寸、外觀常數、算式的 CPU 版在 disc.ts（有測試；改一邊要改另一邊）。
// card-mesh 在卡片是光碟時用這些東西換掉卡片專用的部分（卡片的 shader 一個節點都不變）：
//   - 形狀：印刷面圓環（卡面網格、卡身側面）、破框層的卡外網格（印刷面外面＋透明圈，孔不畫）；圓都用同一個分段，頂點接得上。
//   - 印刷面內緣的細銀環（discRingLayer）：疊在圖層上面（像卡框），破框層再疊上去。
//   - 背面的資料面（discDataMaterial）：銀色鏡面＋繞射彩虹，沒有圖層。
//   - 透明塑膠（createDiscPlastic）：孔外的透明圈、最外緣的塑膠邊、內外兩圈側邊；同一個網格畫兩次（遠側 BackSide → 近側 FrontSide，
//     見 disc.ts 的 DISC_ORDER），不寫深度、要測深度。和卡套（sleeve-nodes.ts）同一套做法。
//   - 光碟側面（印刷面圓環的內外緣）：銀色（discEdgeMaterial）。

import {
  BackSide,
  ExtrudeGeometry,
  FrontSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Path,
  Shape,
  ShapeGeometry,
  type BufferGeometry,
  type Node,
} from 'three/webgpu';
import {
  abs,
  cameraPosition,
  cross,
  dot,
  exp,
  float,
  fwidth,
  length,
  max,
  mix,
  modelWorldMatrix,
  normalLocal,
  normalView,
  normalWorldGeometry,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  saturate,
  smoothstep,
  sRGBTransferEOTF,
  step,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { DISC, DISC_LOOK as L, DISC_ORDER, DISC_SEGMENTS, DISC_THICKNESS } from './disc';
import type { Box } from './breakout';
import type { HoloUniforms } from './holo-nodes';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** 半徑 r 的整圈（Shape 用；逆時針）。 */
function circleShape(r: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

/** 半徑 r 的整圈洞（順時針；three.js 會照方向整理，點的位置和 circleShape 一樣）。 */
function circleHole(r: number): Path {
  const p = new Path();
  p.absarc(0, 0, r, 0, Math.PI * 2, true);
  return p;
}

/** 圓環：外半徑 outer、洞半徑 inner。 */
function annulus(outer: number, inner: number): Shape {
  const s = circleShape(outer);
  s.holes.push(circleHole(inner));
  return s;
}

/** 印刷面圓環（卡面網格、卡身側面的形狀）。 */
export function discPrintShape(): Shape {
  return annulus(DISC.printOuter, DISC.printInner);
}

/** 卡面網格（正反兩面共用）：印刷面圓環。 */
export function discFaceGeometry(): ShapeGeometry {
  return new ShapeGeometry(discPrintShape(), DISC_SEGMENTS);
}

/** 光碟側面（印刷面圓環的內外緣，夾在兩面中間）：擠出的群組 0 是上下蓋（不畫）、1 是側邊。 */
export function discBodyGeometry(): ExtrudeGeometry {
  const g = new ExtrudeGeometry(discPrintShape(), { depth: DISC_THICKNESS, bevelEnabled: false, curveSegments: DISC_SEGMENTS });
  g.translate(0, 0, -DISC_THICKNESS / 2);
  return g;
}

/**
 * 破框層的卡外網格（同卡片的 ringGeometry）：對齊格子的外框挖掉印刷面外緣的圓（和卡面同一批頂點）；
 * 再加孔外的透明圈（印刷面內緣～孔），破框層往內衝出來也畫，孔裡不畫。
 */
export function discRingGeometry(b: Box): ShapeGeometry {
  const outside = new Shape();
  outside.moveTo(b.left, b.bottom);
  outside.lineTo(b.right, b.bottom);
  outside.lineTo(b.right, b.top);
  outside.lineTo(b.left, b.top);
  outside.lineTo(b.left, b.bottom);
  outside.holes.push(circleHole(DISC.printOuter));
  return new ShapeGeometry([outside, annulus(DISC.printInner, DISC.hole)], DISC_SEGMENTS);
}

/** 光碟側面的材質：銀色，依朝向鏡頭的程度加亮（同卡身側邊的做法）。 */
export function discEdgeMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = sRGBTransferEOTF(vec3(...L.edge).mul(normalView.z.max(0).mul(0.5).add(0.7))) as V3;
  return m;
}

/**
 * 印刷面內緣的細銀環（同 disc.ts 的 DISC.ringWidth、DISC_LOOK.ring）：p＝卡面座標（卡寬單位、中心 0）、view＝觀看方向（那一面的座標）。
 * 回傳線性顏色與這一點有幾成是銀環（反鋸齒的邊）。
 */
export function discRingLayer(p: V2, view: V3): { color: V3; cover: F } {
  const d = length(p).sub(DISC.printInner);
  const aa = fwidth(d).mul(0.75);
  const cover = float(1).sub(smoothstep(float(DISC.ringWidth).sub(aa), float(DISC.ringWidth).add(aa), d));
  // 朝著觀看方向那一側亮一點（轉卡時亮處繞著環走）
  const facing = saturate(dot(p.div(max(length(p), 1e-4)), view.xy).mul(2));
  const srgb = vec3(...L.ring.base).add(facing.mul(L.ring.shine));
  return { color: sRGBTransferEOTF(srgb) as V3, cover };
}

/** Stam 的 blend3（每個通道一個小山 max(0, 1 − x²)），x＝4 × (y − 0.75／0.5／0.25)。 */
function blend3(y: F): V3 {
  const x = vec3(y.sub(0.75), y.sub(0.5), y.sub(0.25)).mul(4);
  return max(float(1).sub(x.mul(x)), vec3(0, 0, 0)) as V3;
}

/**
 * 背面的資料面（disc.ts 的 discDataColor 同算式）：銀色鏡面＋兩道繞射彩虹扇形。世界座標算（每個像素自己的視線、光源固定在世界裡），
 * 半徑方向用網格的本地座標 × modelWorldMatrix。holo.foil（鐳射強度 0～1）乘彩虹。
 */
export function discDataMaterial(holo: HoloUniforms): MeshBasicNodeMaterial {
  const p = positionLocal.xy;
  const n = normalWorldGeometry.normalize();
  const toEye = cameraPosition.sub(positionWorld).normalize();
  const toLight = vec3(L.light.x, L.light.y, L.light.z).sub(positionWorld).normalize();
  const h = toLight.add(toEye);
  const ht = h.sub(n.mul(dot(h, n)));
  const radial = modelWorldMatrix.mul(vec4(p, 0, 0)).xyz.normalize();
  const along = dot(ht, radial);
  const across = dot(ht, cross(n, radial));
  const k = across.div(L.lobeWidth);
  const lobe = exp(k.mul(k).negate());
  const u = abs(along).mul(L.grating);
  let rainbow: V3 = vec3(0, 0, 0);
  for (let m = 1; m <= L.orders; m++) rainbow = rainbow.add(blend3(u.mul(2 / m).sub(1))) as V3;
  // 銀面：反射方向往上的程度當環境明暗＋光源的高光
  const refl = reflect(toEye.negate(), n);
  const g = saturate(refl.y.mul(0.5).add(0.5));
  // 環帶（同 disc.ts 的 discBands）：有資料的地方暗一點、資料面內緣一圈亮一點
  const B = L.bands;
  const r = length(p);
  const written = float(1).sub(float(1).sub(smoothstep(B.dataEnd - B.edge, B.dataEnd + B.edge, r)).mul(1 - B.written));
  const mirror = float(1).sub(smoothstep(DISC.printInner + B.mirrorWidth - B.edge, DISC.printInner + B.mirrorWidth + B.edge, r)).mul(B.mirror);
  const env = pow(g, 1.5).mul(L.silver.sky).add(L.silver.floor).mul(written);
  const spec = pow(saturate(dot(h.normalize(), n)), L.spec.power).mul(L.spec.gain);
  const silver = vec3(...L.silver.tint).mul(env).add(spec.add(mirror));
  const srgb = silver.add(rainbow.mul(holo.foil.mul(L.rainbowGain)).add(L.streak).mul(lobe));
  const m = new MeshBasicNodeMaterial();
  m.colorNode = sRGBTransferEOTF(srgb as V3) as V3;
  return m;
}

/** 透明塑膠一側（遠側 'far'＝BackSide、近側 'near'＝FrontSide）的材質（算式見 disc.ts 的 DISC_LOOK.plastic）。 */
function plasticMaterial(pass: 'far' | 'near'): MeshBasicNodeMaterial {
  const P = L.plastic;
  const cap = step(0.5, abs(normalLocal.z));
  const normal = normalWorldGeometry;
  const toEye = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(saturate(abs(dot(normal, toEye)))), P.fresnel.power).mul(P.fresnel.gain) as F;
  const r = reflect(toEye.negate(), normal);
  const u = abs(dot(r.xy, vec2(P.sheen.dir.x, P.sheen.dir.y)));
  const sheen = float(1).sub(smoothstep(0, P.sheen.halfWidth, abs(u.sub(P.sheen.center)))).mul(P.sheen.strength);
  // 堆疊環：透明圈上一圈細細的亮線
  const ringD = abs(length(positionLocal.xy).sub(DISC.stackRing));
  const stack = float(1).sub(smoothstep(0, P.stack.width, ringD)).mul(P.stack.alpha);
  const capAlpha = fresnel.add(sheen).add(stack).add(P.base);
  const sideAlpha = fresnel.add(P.side);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(P.color[0], P.color[1], P.color[2], saturate(mix(sideAlpha, capAlpha, cap)));
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = pass === 'far' ? BackSide : FrontSide;
  return material;
}

export interface DiscPlastic {
  /** 放進卡片的 group（跟著卡片轉）；不是光碟時藏起來（visible false）。 */
  readonly group: Group;
}

/**
 * 透明塑膠：孔外的透明圈（孔～印刷面內緣）與最外緣的塑膠邊（印刷面外緣～外緣）擠出成光碟的厚度，
 * 正反兩面＋孔與外緣的側邊（印刷面那兩圈側邊也在，被光碟側面的銀色擋住大半）。網格固定（光碟沒有比例、圓角），建一次就好。
 */
export function createDiscPlastic(): DiscPlastic {
  const shapes = [annulus(DISC.printInner, DISC.hole), annulus(DISC.outer, DISC.printOuter)];
  const geometry: BufferGeometry = new ExtrudeGeometry(shapes, { depth: DISC_THICKNESS, bevelEnabled: false, curveSegments: DISC_SEGMENTS });
  geometry.translate(0, 0, -DISC_THICKNESS / 2);
  const far = new Mesh(geometry, plasticMaterial('far'));
  far.renderOrder = DISC_ORDER.far;
  const near = new Mesh(geometry, plasticMaterial('near'));
  near.renderOrder = DISC_ORDER.near;
  const group = new Group();
  group.add(far, near);
  return { group };
}
