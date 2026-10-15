// 視差位移量：整個專案唯一的一份公式（spec §5.2）。render 的 shader 只套用這裡算出來的數字。
//
// 想像每個立體層浮在卡面上方 h 的高度（h 由 depth 換算，見 MAX_PARALLAX）。
// 從斜方向看，浮起來的點會蓋在「卡面上離觀看者較遠那一側」的位置：
//   位移 = −h × (視線方向在卡面上的分量) ÷ (視線和卡面法線夾角的 cos)  ＝ h × tan(夾角)，方向朝遠的那一邊。
// 夾角超過 60° 後分母固定在 cos 60°，位移只再緩慢增加（最多 2h），避免接近 90° 時 tan 爆掉。

export type FaceSide = 'front' | 'back';

/** depth 100 的層浮在卡面上方多高（以卡寬為 1）。depth 線性對應：depth 50 ＝ 一半。 */
export const MAX_PARALLAX = 0.15;
/** 視線和卡面法線的夾角超過 60°（cos < 0.5）後不再照 tan 放大。 */
const MIN_VIEW_COS = 0.5;

const RAD = Math.PI / 180;

/**
 * 回傳某一面、某深度的圖層，在目前卡片角度下要往哪裡移（卡寬單位）。
 * 座標以「看著這一面」為準：+x 向右、+y 向上；背面不鏡像。
 * 卡片角度的定義同 `view.ts`：yaw 向右拖變大（卡片右緣往後退）、pitch 正值＝上緣朝觀看者。
 */
export function parallaxOffset(face: FaceSide, yawDeg: number, pitchDeg: number, depth: number): { x: number; y: number } {
  if (depth <= 0) return { x: 0, y: 0 };
  const yaw = yawDeg * RAD;
  const pitch = pitchDeg * RAD;
  // 「卡片中心 → 鏡頭」的方向，換到正面自己的座標（卡片旋轉＝先 yaw 再沿螢幕水平軸 pitch）
  let vx = -Math.cos(pitch) * Math.sin(yaw);
  const vy = Math.sin(pitch);
  let vz = Math.cos(pitch) * Math.cos(yaw);
  if (face === 'back') {
    // 背面的座標＝正面繞垂直軸轉 180°：x、z 反向
    vx = -vx;
    vz = -vz;
  }
  const h = (depth / 100) * MAX_PARALLAX;
  const k = -h / Math.max(vz, MIN_VIEW_COS);
  return { x: k * vx + 0, y: k * vy + 0 };
}
