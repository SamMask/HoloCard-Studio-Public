// 等比縮小到最長邊不超過上限。純函式，node 也能測。

/** 最長邊 ≤ max 就原樣；否則等比縮小（四捨五入成整數、每邊至少 1）。不放大。 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
