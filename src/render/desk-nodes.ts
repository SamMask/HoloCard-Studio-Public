// 工作桌舞台（T-832）的著色（TSL）。尺寸、外觀常數、算式的 CPU 版在 desk-layout.ts（有測試；改一邊要改另一邊）。
//
// 壓克力展示座：夾塊與底座兩個長方體合成一個網格（每個頂點帶著自己那塊的中心 boxCenter、半邊長 boxHalf），同一個網格畫兩次——
// 遠側（BackSide）與近側（FrontSide），同透明卡套（sleeve-nodes.ts）：都不寫深度、要測深度；塑膠的菲涅耳與反光帶直接用卡套的
// plasticFresnel／plasticSheen（菲涅耳再乘 DESK_LOOK.fresnel：厚塊斜看頂面時卡套的算式太白），再加邊緣亮線（離長方體稜邊多近，
// boxEdgeDistance）與一層很淡的白（厚塊的體積）。
// 一個面最多 DESK_LOOK.maxAlpha（斜看夾塊頂面時菲涅耳很亮，不讓一條白線蓋住卡片）。沒有貼圖、沒有時間（減少動態時照舊：隨角度變化不算動畫）。
//
// 桌面：底座底面那一片水平面，畫柔和的影子（deskShadow）＋淡淡的卡片倒影（reflection.ts 的 sample，離展示座越遠越淡）；
// 輸出預乘過的顏色＋不透明度（stage-material.ts 的 'over'），不透明度至少是顏色最亮的分量（疊在 CSS 那層的木桌上，倒影不會被畫布合成壓暗）。

import { BackSide, FrontSide, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  float,
  length,
  max,
  min,
  normalWorldGeometry,
  positionLocal,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { DESK, DESK_LOOK as L } from './desk-layout';
import { roundedRectSdfNode } from './frame-nodes';
import type { ReflectionSample } from './reflection';
import { SLEEVE_LOOK } from './sleeve';
import { plasticFresnel, plasticSheen } from './sleeve-nodes';
import type { StageLook } from './stage-material';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** 展示座網格每個頂點帶的屬性名字（desk-fx.ts 建網格時寫進去）。 */
export const BOX_CENTER = 'boxCenter';
export const BOX_HALF = 'boxHalf';

/** 長方體表面上一點到最近一條稜邊的距離（同 desk-layout.ts 的 boxEdgeDistance）。 */
function edgeDistanceNode(p: V3, center: V3, half: V3): F {
  const d = max(half.sub(abs(p.sub(center))), vec3(0, 0, 0));
  return d.x.add(d.y).add(d.z).sub(min(d.x, min(d.y, d.z))).sub(max(d.x, max(d.y, d.z))) as F;
}

/**
 * 壓克力一側（遠側 'far'＝BackSide、近側 'near'＝FrontSide）的材質：
 * a＝菲涅耳＋反光帶（卡套的）＋邊緣亮線＋淡白（遠側再加卡套的 farTint），最多 maxAlpha；輸出 (塑膠色, a) 一般半透明混色。
 */
export function acrylicMaterial(pass: 'far' | 'near'): MeshBasicNodeMaterial {
  const normal = normalWorldGeometry;
  const toEye = cameraPosition.sub(positionWorld).normalize();
  const center = attribute(BOX_CENTER, 'vec3');
  const half = attribute(BOX_HALF, 'vec3');
  // 邊緣亮線：離稜邊 rim.width 以內漸亮（同 deskRim）
  const t = float(1).sub(smoothstep(0, L.rim.width, edgeDistanceNode(positionLocal, center, half)));
  const rim = t.mul(t).mul(L.rim.alpha);
  let alpha: F = plasticFresnel(normal, toEye).mul(L.fresnel[pass]).add(plasticSheen(normal, toEye)).add(rim).add(L.tint) as F;
  if (pass === 'far') alpha = alpha.add(SLEEVE_LOOK.farTint) as F;
  const c = SLEEVE_LOOK.color;
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(c[0], c[1], c[2], min(alpha, L.maxAlpha));
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = pass === 'far' ? BackSide : FrontSide;
  return material;
}

/** 顏色最亮的那個分量（同 gallery-nodes.ts：預乘 over 的光，不透明度至少取這個值）。 */
function maxChannel(c: V3): F {
  return max(max(c.x, c.y), c.z) as F;
}

/**
 * 桌面（p＝桌面上的點，展示座座標的 x、z）：影子（同 deskShadow）在下、卡片倒影（離中心越遠越淡，同 deskReflectionFade）疊在上面。
 * reflection＝null：只有影子（不用倒影時）。
 */
export function deskPlaneLook(p: V2, reflection: ReflectionSample | null): StageLook {
  const s = L.shadow;
  const sdf = roundedRectSdfNode(p, vec2(DESK.base.halfW, DESK.base.halfD), float(s.radius));
  const contact = float(1).sub(smoothstep(0, s.contactWidth, sdf)).mul(s.contact);
  const soft = float(1).sub(smoothstep(-s.softInner, s.softOuter, sdf)).mul(s.soft);
  const shadow = float(1).sub(float(1).sub(contact).mul(float(1).sub(soft)));
  if (!reflection) return { color: vec3(0, 0, 0), alpha: shadow as F };
  const r = L.reflection;
  const fade = float(1).sub(smoothstep(r.fadeStart, r.fadeEnd, length(p))).mul(r.strength);
  const color = reflection.color.mul(fade) as V3;
  const reflAlpha = reflection.alpha.mul(fade);
  // 影子先壓暗木桌，倒影再疊上去：預乘 over 兩層合成一層
  const alpha = float(1).sub(float(1).sub(shadow).mul(float(1).sub(reflAlpha)));
  return { color, alpha: max(alpha, maxChannel(color)) as F };
}
