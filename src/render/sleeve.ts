// 透明卡套（T-806，SCHEMA view.sleeve?、DESIGN「透明卡套」）的尺寸、外觀常數與純數學（不 import three.js，方便在 node 測試）。
// 卡套＝卡片外面一個圓角的透明塑膠盒：每邊比卡片大 SLEEVE.margin（卡寬 3%）、厚度＝卡片的 SLEEVE.thicknessScale 倍，
// 圓角＝卡片圓角＋邊距（卡套輪廓剛好是卡片輪廓往外推一圈，比例、圓角改了跟著變）。
// 著色在 sleeve-nodes.ts，算式和這裡一一對應（改一邊要改另一邊）：
//   - 菲涅耳：反光比例＝gain × (1 − |cos θ|)^power（θ＝視線和表面法線的夾角）：正面看幾乎是 0、越斜越亮；
//   - 滑過的反光帶：視線在表面上的反射方向（世界座標）投到斜方向 dir 上的量 |u|，在 center 附近亮（像遠處一條長燈管的倒影），
//     轉卡時反射方向跟著轉，光帶就從卡套上滑過；正面看時 |u| 很小（鏡頭透視造成的偏差而已），碰不到光帶；
//   - 白邊：卡套正反兩面在輪廓往內 rim.width 以內漸亮（正面看時這一圈在卡片外面，不蓋到卡片）；
//   - 側邊（塑膠的厚度）：半透明白＋菲涅耳；
//   - 遠的那一面（卡片後面那片塑膠）多一層很淡的白：只在卡片外圍看得到（卡片擋住的地方深度測試不過），讓卡套的範圍看得出來。
// 不做真的折射。顏色都是白（略偏冷），用一般的半透明混色：結果＝背後 × (1 − a)＋白 × a。

import { CARD_THICKNESS, type RoundedRect } from './fit';

export const SLEEVE = {
  /** 每邊比卡片大多少（卡寬單位）。 */
  margin: 0.03,
  /** 厚度是卡片的幾倍。 */
  thicknessScale: 3,
} as const;

/** 卡套厚度（卡寬單位）。 */
export const SLEEVE_THICKNESS = CARD_THICKNESS * SLEEVE.thicknessScale;

/**
 * 繪製順序（three.js 的透明物件先比 renderOrder，同一個 renderOrder 才比遠近）：
 * 卡片（不透明，寫深度）→ 卡套遠的那一側（BackSide，被卡片擋住的地方深度測試不過）→ 破框層的卡外網格（card-mesh，renderOrder 0）
 * → 卡套近的那一側（FrontSide）。卡套是凸的盒子、卡片在裡面：任何角度，視線都是先穿過近側、再碰到卡片、最後才碰到遠側，
 * 所以這個順序從哪個角度看都對（不用每格重新排序）。破框層夾在中間：卡套範圍內一樣隔著塑膠，伸出卡套外的部分照樣畫。
 */
export const SLEEVE_ORDER = { far: -1, near: 1 } as const;

/** 外觀（主對話 2026-10-14 定方向；數值在瀏覽器三張範例卡上調）。 */
export const SLEEVE_LOOK = {
  /** 塑膠的顏色（線性 RGB，略偏冷的白）。 */
  color: [0.93, 0.96, 1] as const,
  /**
   * 菲涅耳：反光比例＝gain × (1 − |cos θ|)^power。power 4：30°～40° 幾乎沒有（深色卡轉一點點不會變灰），
   * 60° 約 0.056、75° 約 0.3，越斜越亮。
   */
  fresnel: { gain: 0.9, power: 4 },
  /**
   * 滑過的反光帶：反射方向投到 dir（單位向量）上的 |u| 在 center ± halfWidth 裡亮，最亮 strength。
   * 卡上相鄰兩點的 u 只差在鏡頭透視（每卡寬約 0.26），halfWidth 0.05 ≈ 帶寬 0.4 卡寬（柔邊）；左右轉約 14°～26° 時掃過。
   */
  sheen: { strength: 0.09, dir: { x: 0.857, y: 0.514 }, center: 0.55, halfWidth: 0.05 },
  /** 正反兩面的白邊：輪廓往內 width（卡寬單位）以內由 0 漸亮到 alpha。 */
  rim: { width: 0.014, alpha: 0.32 },
  /** 側邊（厚度那一圈）的半透明白。 */
  side: { alpha: 0.22 },
  /** 遠的那一面的淡白（只在卡片外圍看得到）。 */
  farTint: 0.045,
} as const;

/** 卡套的輪廓：卡片輪廓每邊往外推 SLEEVE.margin（圓角也加上去，邊距處處一樣寬）。 */
export function sleeveOutline(card: RoundedRect): RoundedRect {
  const m = SLEEVE.margin;
  return { halfW: card.halfW + m, halfH: card.halfH + m, r: card.r + m };
}

/** 擷取的裁切要包住的盒子（pick.ts 的 PickScene.bounds）：卡套的半寬、半高、厚度。 */
export function sleeveBounds(card: RoundedRect): { halfW: number; halfH: number; thickness: number } {
  const o = sleeveOutline(card);
  return { halfW: o.halfW, halfH: o.halfH, thickness: SLEEVE_THICKNESS };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** GLSL 的 smoothstep（edge0 < edge1）。 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 菲涅耳反光比例：cosView＝視線和表面法線夾角的 cos（正反面一樣，取絕對值）。 */
export function sleeveFresnel(cosView: number): number {
  const { gain, power } = SLEEVE_LOOK.fresnel;
  return gain * Math.pow(1 - clamp01(Math.abs(cosView)), power);
}

/** 反光帶：反射方向（世界座標，單位向量）的 x、y → 這一點的反光帶比例。 */
export function sleeveSheen(reflectX: number, reflectY: number): number {
  const { strength, dir, center, halfWidth } = SLEEVE_LOOK.sheen;
  const u = Math.abs(reflectX * dir.x + reflectY * dir.y);
  return strength * (1 - smoothstep(0, halfWidth, Math.abs(u - center)));
}

/** 白邊：sdf＝這一點到卡套輪廓的帶號距離（裡面負）→ 白邊比例。 */
export function sleeveRim(sdf: number): number {
  const { width, alpha } = SLEEVE_LOOK.rim;
  const t = smoothstep(-width, 0, sdf);
  return alpha * t * t;
}

/** 視線和表面的反射方向：incident＝從眼睛射向表面的方向（單位向量），normal＝法線（單位向量）。同 GLSL reflect。 */
export function reflectDir(
  incident: readonly [number, number, number],
  normal: readonly [number, number, number],
): [number, number, number] {
  const d = incident[0] * normal[0] + incident[1] * normal[1] + incident[2] * normal[2];
  return [incident[0] - 2 * d * normal[0], incident[1] - 2 * d * normal[1], incident[2] - 2 * d * normal[2]];
}
