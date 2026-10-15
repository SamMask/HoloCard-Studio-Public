// 舞台主題「工作桌」（T-832，DESIGN §5「工作桌（壓克力展示架）」）的尺寸、外觀常數與純數學（不 import three.js，方便在 node 測試）。
//
// 卡片下半截插在一座透明壓克力展示座裡：夾塊（厚透明塊，夾住卡片下緣往上約卡高 1/5）＋底座（比夾塊寬、深的薄板），
// 放在畫好的木桌上（遠景是 public/stages/desk.webp，CSS 那層，ui/stage.ts）。整座跟著卡片一起轉（同一個旋轉，desk-fx.ts），
// 上下只傾 ±10°（interact/view.ts 的 turnLimits）。塑膠的外觀沿用透明卡套（sleeve.ts 的 SLEEVE_LOOK：菲涅耳、反光帶、白邊），
// 繪製順序照卡套的做法（遠側先畫、和卡片一起排，DESK_ORDER），但破框層伸出卡外的部分排在近側之後：衝出來的部分在壓克力前面（DESIGN）。
// 著色在 desk-nodes.ts，算式和這裡一一對應（改一邊要改另一邊）。
// 桌面：底座底面那一片水平面上畫柔和的影子（deskShadow）＋淡淡的卡片倒影（reflection.ts，DESK_LOOK.reflection）。
//
// 座標：卡寬＝1；原點＝卡片中心（展示座和卡片繞同一點轉），+y 上、+z 朝鏡頭（卡片正面朝的方向）。

import { SLEEVE_ORDER, sleeveFresnel } from './sleeve';

/** 展示座的尺寸（卡寬單位）。 */
export const DESK = {
  /** 夾住卡高的幾成（卡片下緣往上這麼高被夾塊包住）。 */
  grip: 1 / 5,
  /** 槽底在卡片下緣下面多少：開著透明卡套時卡套比卡片每邊大 0.03（sleeve.ts），也放得進槽裡。 */
  slotGap: 0.035,
  /** 夾塊：每邊比卡片寬 margin、前後半厚 halfDepth（卡套半厚 0.0225，前後各留約 0.06 的實心壓克力）。 */
  block: { margin: 0.08, halfDepth: 0.08 },
  /** 底座：半寬、半深、高（在夾塊下面、中心對齊）。 */
  base: { halfW: 0.68, halfD: 0.26, height: 0.09 },
} as const;

/** 一個長方體（展示座的一塊）：中心、半邊長（卡寬）。 */
export interface DeskBox {
  center: readonly [number, number, number];
  half: readonly [number, number, number];
}

/** 展示座的兩塊（cardH＝卡高，aspectHeight）：夾塊從槽底到卡片下緣往上 grip；底座在夾塊正下面。 */
export function deskBoxes(cardH: number): { block: DeskBox; base: DeskBox } {
  const bottom = -cardH / 2;
  const floor = bottom - DESK.slotGap;
  const top = bottom + cardH * DESK.grip;
  const b = DESK.base;
  return {
    block: {
      center: [0, (floor + top) / 2, 0],
      half: [0.5 + DESK.block.margin, (top - floor) / 2, DESK.block.halfDepth],
    },
    base: {
      center: [0, floor - b.height / 2, 0],
      half: [b.halfW, b.height / 2, b.halfD],
    },
  };
}

/** 桌面（底座底面）的高度：卡片中心是 0；比例越高的卡桌面越低。 */
export function deskY(cardH: number): number {
  return -cardH / 2 - DESK.slotGap - DESK.base.height;
}

/**
 * 繪製順序（照卡套 SLEEVE_ORDER 的做法，three.js 的透明物件先比 renderOrder）：展示座的壓克力放在 renderOrder 0 的 Group 裡
 * （和卡片同一組排序）：卡片（不透明，寫深度）→ 遠側（BackSide，−1，被卡片擋住的地方深度測試不過）→ 近側（FrontSide，−0.5，
 * 卡片插在座裡的那一截隔著塑膠）→ 破框層的卡外網格（0，不測深度）→ 卡套的近側（+1）。
 * 和卡套不同的地方：近側排在破框層之前——DESIGN「破框部分照樣衝出（在壓克力前面）」：伸出卡外的部分不被壓克力染白（GPU 頁 20 驗差 0）；
 * 破框層在卡片範圍裡的部分是卡面 shader 畫的，和卡片一樣隔著夾塊。
 * 開著卡套時：卡套遠側也是 −1（同一個 renderOrder 再照遠近排）、卡套近側 +1 在展示座近側之後；塑膠都是同一種白、一般半透明混色，
 * 誰先誰後畫出來幾乎一樣。展示座是凸的長方體、卡片（與卡套）在裡面，這個順序從任何角度看都對，不用每格重新排序。
 */
export const DESK_ORDER = { far: SLEEVE_ORDER.far, near: -0.5, plane: -1 } as const;

/** 外觀（數值在瀏覽器三張範例卡上調；塑膠本身的菲涅耳、反光帶、顏色用卡套的 SLEEVE_LOOK）。 */
export const DESK_LOOK = {
  /** 壓克力本身的淡白（每一面都加，厚塊才看得出體積）；遠側另外再加卡套的 farTint。 */
  tint: 0.02,
  /**
   * 菲涅耳（卡套的 sleeveFresnel）再乘這個倍數：厚塊斜看頂面時（鏡頭和底座頂面約 10°）卡套的算式太白，近側打個折；
   * 遠側（隔著塑膠看到的內面）實際上是折射後的角度、沒那麼斜，只留一點。
   */
  fresnel: { near: 0.55, far: 0.12 },
  /** 邊緣亮線：離長方體的稜邊 width（卡寬）以內由 0 漸亮到 alpha（同卡套白邊的曲線）。 */
  rim: { width: 0.012, alpha: 0.45 },
  /** 一個面最多多白（斜看夾塊頂面時菲涅耳很亮，壓在這以下，卡片不會被一條白線蓋住）。 */
  maxAlpha: 0.4,
  /**
   * 桌上的影子：貼著底座邊緣一圈深一點（contact，寬 contactWidth）＋往外散開的淡影（soft，從底座邊往內 softInner 到往外 softOuter 淡掉）。
   * 壓克力是透明的，影子比實心的東西淡。
   */
  shadow: { contact: 0.45, contactWidth: 0.06, soft: 0.32, softInner: 0.12, softOuter: 0.4, radius: 0.04 },
  /** 桌面倒影：卡片倒影的強度（木桌是霧面，淡淡的）、離展示座中心 fadeStart～fadeEnd（卡寬）淡掉（桌面那片網格的邊看不出來）。 */
  reflection: { strength: 0.32, fadeStart: 0.75, fadeEnd: 1.15 },
} as const;

/** 桌面那片網格的半邊長（卡寬；中心＝展示座中心）：倒影淡出的距離外面一點。 */
export const DESK_PLANE_HALF = 1.25;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** GLSL 的 smoothstep（edge0 < edge1）。 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * 長方體表面上一點到最近一條稜邊的距離（卡寬）：每個軸離那一對面多遠（半邊長 − |p − 中心|，表面上那個面的軸是 0），
 * 取三個裡面中間那一個（最小的是 0＝所在的面，中間的＝離這個面的邊多遠）。著色程式照同一個式子算邊緣亮線。
 */
export function boxEdgeDistance(p: readonly [number, number, number], box: DeskBox): number {
  const d = [0, 1, 2].map((k) => Math.max(0, box.half[k]! - Math.abs(p[k]! - box.center[k]!)));
  const [x, y, z] = d as [number, number, number];
  return x + y + z - Math.min(x, y, z) - Math.max(x, y, z);
}

/** 展示座一側（遠側／近側）的菲涅耳：cosView＝視線和表面法線夾角的 cos（同卡套 sleeveFresnel 再乘 DESK_LOOK.fresnel）。 */
export function deskFresnel(pass: 'far' | 'near', cosView: number): number {
  return sleeveFresnel(cosView) * DESK_LOOK.fresnel[pass];
}

/** 邊緣亮線：離稜邊 distance → 不透明度（同卡套 sleeveRim 的曲線：t²）。 */
export function deskRim(distance: number): number {
  const { width, alpha } = DESK_LOOK.rim;
  const t = 1 - smoothstep(0, width, distance);
  return alpha * t * t;
}

/** 圓角矩形的帶號距離（裡面負）：同 fit.ts 的 roundedRectSdf，這裡是桌面上的 (x, z)。 */
function rectSdf(x: number, z: number, halfW: number, halfD: number, r: number): number {
  const qx = Math.abs(x) - (halfW - r);
  const qz = Math.abs(z) - (halfD - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** 桌上的影子（0～1 的不透明度）：桌面上一點 (x, z)（展示座的座標）。 */
export function deskShadow(x: number, z: number): number {
  const s = DESK_LOOK.shadow;
  const sdf = rectSdf(x, z, DESK.base.halfW, DESK.base.halfD, s.radius);
  const contact = (1 - smoothstep(0, s.contactWidth, sdf)) * s.contact;
  const soft = (1 - smoothstep(-s.softInner, s.softOuter, sdf)) * s.soft;
  return 1 - (1 - contact) * (1 - soft);
}

/** 倒影離展示座中心多遠淡掉（1＝全部、0＝沒有）。 */
export function deskReflectionFade(x: number, z: number): number {
  const { fadeStart, fadeEnd } = DESK_LOOK.reflection;
  return 1 - smoothstep(fadeStart, fadeEnd, Math.hypot(x, z));
}
