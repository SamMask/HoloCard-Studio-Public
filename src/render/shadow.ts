// 景深陰影的純數學（spec §4.1 第 6 項、§5.2）：圖層 depth → 影子偏移、柔邊寬度、濃度；柔邊寬度 → 貼圖模糊等級。
// 不 import three.js（方便在 node 測）；著色在 card-mesh.ts（同一個 shader 由後往前合成時，畫每個立體層之前
// 先用它自己的 alpha 偏移取樣、壓暗已經合成好的後面的顏色）。不用 three.js 的 shadow map。
//
// 想像光從卡片左上方照下來、跟著卡片一起轉：浮起來的圖層把影子投在後面，往右下偏；
// 浮得越高（depth 越大）影子離得越遠、邊越散、也越濃（但最濃只壓暗 SHADOW_MAX_STRENGTH，不會變黑塊）。
// 使用者可以調濃淡與距離（T-310，card.shadow 0～100）：換成倍數 0～2（50＝上面這些原本的值），只改 uniform。

import type { Layer, Shadow } from '../model/types';

/**
 * 這一層投不投景深陰影：只有混合模式是正常的立體層投（T-408）。
 * 加深、發光這些模式是「光」或「墨」，不是擋光的紙片；沒有透明的發光層若投影，整張圖的方框會變成一塊黑影。
 * 底圖永遠不投。
 */
export function castsShadow(layer: Pick<Layer, 'role' | 'blend'>): boolean {
  return layer.role === 'depth' && (layer.blend ?? 'normal') === 'normal';
}

/** 影子方向（單位向量，卡面座標：看著這一面 +x 右、+y 上）：光從左上來 → 影子往右下。正反面各自看著都一樣。 */
export const SHADOW_DIRECTION = { x: 0.6, y: -0.8 } as const;
/** depth 100 的影子離圖層多遠（卡寬單位）。偏移和 depth 成正比（card-mesh 依賴這點）。 */
export const SHADOW_MAX_OFFSET = 0.05;
/** 柔邊寬度（卡寬單位）：depth 1 約 SHADOW_MIN_BLUR，depth 100 為 SHADOW_MAX_BLUR，中間線性。 */
export const SHADOW_MIN_BLUR = 0.008;
export const SHADOW_MAX_BLUR = 0.05;
/** depth 100 的影子最濃處壓暗幾成（spec：約 25～35%）。 */
export const SHADOW_MAX_STRENGTH = 0.3;

/** 使用者調的陰影換成的倍數：strength 乘在濃度上、distance 乘在偏移與柔邊上。1＝原本的效果。 */
export interface ShadowFactors {
  strength: number;
  distance: number;
}

export const DEFAULT_SHADOW_FACTORS: Readonly<ShadowFactors> = Object.freeze({ strength: 1, distance: 1 });

/** 0～100 → 0～2（50＝1）；超出範圍夾回，不是有限數字當 50（原本的效果）。 */
function factor(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) / 50 : 1;
}

/** card.shadow → 倍數：濃淡 0＝沒有影子、100＝兩倍濃；距離 0＝貼在圖層正下方、100＝偏移與柔邊都兩倍。 */
export function shadowFactors(shadow: Shadow): ShadowFactors {
  return { strength: factor(shadow.strength), distance: factor(shadow.distance) };
}

export interface LayerShadow {
  /** 影子相對圖層往哪裡移（卡寬單位、卡面座標）。 */
  offsetX: number;
  offsetY: number;
  /** 柔邊寬度（卡寬單位）。 */
  blur: number;
  /** 影子最濃處壓暗幾成（0～SHADOW_MAX_STRENGTH）。 */
  strength: number;
}

/**
 * 某個 depth 的圖層投出的影子。depth 夾在 0～100（不是有限數字當 0）；depth 0（底圖）沒有影子。
 * - 偏移＝SHADOW_DIRECTION × SHADOW_MAX_OFFSET × depth/100（成正比）× 距離倍數。
 * - 柔邊＝SHADOW_MIN_BLUR → SHADOW_MAX_BLUR 線性 × 距離倍數。
 * - 濃度＝SHADOW_MAX_STRENGTH × (1 − (1 − depth/100)²) × 濃淡倍數：淺的層也看得出來，越深越濃、到 100 剛好上限
 *   （濃淡倍數 1 時；倍數 2 時最深處壓暗 2 × SHADOW_MAX_STRENGTH）。
 * factors 不給＝原本的效果（倍數都是 1）。
 */
export function layerShadow(depth: number, factors: ShadowFactors = DEFAULT_SHADOW_FACTORS): LayerShadow {
  const t = Number.isFinite(depth) ? Math.min(100, Math.max(0, depth)) / 100 : 0;
  const distance = SHADOW_MAX_OFFSET * t * factors.distance;
  return {
    offsetX: SHADOW_DIRECTION.x * distance + 0,
    offsetY: SHADOW_DIRECTION.y * distance + 0,
    blur: (SHADOW_MIN_BLUR + (SHADOW_MAX_BLUR - SHADOW_MIN_BLUR) * t) * factors.distance,
    strength: SHADOW_MAX_STRENGTH * (1 - (1 - t) * (1 - t)) * factors.strength,
  };
}

/**
 * 想讓貼圖模糊到 width（卡寬單位）寬，要取第幾層 mip（每升一級，一個像素蓋住原圖的 2 倍寬）。
 * imageWidth：原圖寬（像素）；layerWidth：圖層在卡面上的寬（卡寬單位）。不到一個像素或數字不合理回 0（原圖）。
 */
export function shadowMipLevel(width: number, imageWidth: number, layerWidth: number): number {
  if (!(layerWidth > 0)) return 0;
  const pixels = (width * imageWidth) / layerWidth;
  return pixels > 1 ? Math.log2(pixels) : 0;
}
