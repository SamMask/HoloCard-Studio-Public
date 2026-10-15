// 偵測圖片有沒有透明（SCHEMA.md §2）。純函式，node 也能測。

/** alpha 低於這個值就算有透明（略低於 255，避免壓縮雜訊誤判）。 */
const OPAQUE_ALPHA = 250;

/** RGBA 陣列（每像素 4 個位元組，第 4 個是 alpha）裡，任一像素 alpha < 250 就是 true。 */
export function hasTransparency(rgba: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < OPAQUE_ALPHA) return true;
  }
  return false;
}
