// 圖層混合模式的著色程式（T-408），TSL 版。算式和 blend.ts 一一對應（那邊有測試；改一邊要改另一邊）。
// 全部在 sRGB 數值（0～1）上算。模式在建材質時就決定（JS 的值，不是 uniform）：每一層只產生它自己那一種的算式，
// 正常模式的層完全不多算；換模式＝換那一面的材質（card-mesh 的 compositionKey 含 blend），拖不透明度只改 uniform。

import { abs, dot, float, max, min, mix, saturate, select, sqrt, step, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BlendMode } from '../model/types';
import { CLIP_EPSILON, LUM_WEIGHTS } from './blend';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const LUM = vec3(LUM_WEIGHTS.r, LUM_WEIGHTS.g, LUM_WEIGHTS.b);

function lumNode(c: V3): F {
  return dot(c, LUM);
}

function maxChannel(c: V3): F {
  return max(c.x, max(c.y, c.z));
}

function minChannel(c: V3): F {
  return min(c.x, min(c.y, c.z));
}

/** W3C ClipColor（同 blend.ts 的 clipColor：n、x 用原本的顏色算，先處理小於 0、再處理大於 1）。 */
function clipColorNode(c: V3): V3 {
  const l = lumNode(c);
  const n = minChannel(c);
  const x = maxChannel(c);
  const low = c.sub(l).mul(l).div(max(l.sub(n), CLIP_EPSILON)).add(l);
  const c1 = select(n.lessThan(0), low, c) as V3;
  const high = c1.sub(l).mul(float(1).sub(l)).div(max(x.sub(l), CLIP_EPSILON)).add(l);
  return select(x.greaterThan(1), high, c1) as V3;
}

/** W3C SetLum。 */
function setLumNode(c: V3, l: F): V3 {
  return clipColorNode(c.add(l.sub(lumNode(c))));
}

/** 疊色：Cb ≤ 0.5 → 2·Cb·Cs；否則 screen(Cs, 2·Cb − 1)（Cb＝0.5 時兩邊相等，用 step 選）。 */
function overlayNode(cb: V3, cs: V3): V3 {
  const dark = cb.mul(cs).mul(2);
  const t = cb.mul(2).sub(1);
  const light = cs.add(t).sub(cs.mul(t));
  return mix(dark, light, step(vec3(0.5, 0.5, 0.5), cb));
}

/** 柔光（W3C）：Cs ≤ 0.5 一段、> 0.5 一段；D(Cb)：Cb ≤ 0.25 多項式、否則 √Cb（分段處兩邊相等）。 */
function softLightNode(cb: V3, cs: V3): V3 {
  const low = cb.sub(float(1).sub(cs.mul(2)).mul(cb).mul(float(1).sub(cb)));
  const poly = cb.mul(16).sub(12).mul(cb).add(4).mul(cb);
  const d = mix(poly, sqrt(cb), step(vec3(0.25, 0.25, 0.25), cb));
  const high = cb.add(cs.mul(2).sub(1).mul(d.sub(cb)));
  return mix(low, high, step(vec3(0.5, 0.5, 0.5), cs));
}

/** B(Cb, Cs)（同 blend.ts 的 blendColor）：正常直接回 Cs；其他模式先把兩個顏色夾在 0～1。 */
export function blendNode(mode: BlendMode, cbIn: V3, csIn: V3): V3 {
  if (mode === 'normal') return csIn;
  const cb = saturate(cbIn) as V3;
  const cs = saturate(csIn) as V3;
  switch (mode) {
    case 'multiply':
      return cb.mul(cs);
    case 'screen':
      return cb.add(cs).sub(cb.mul(cs));
    case 'add':
      return min(cb.add(cs), vec3(1, 1, 1));
    case 'overlay':
      return overlayNode(cb, cs);
    case 'soft-light':
      return softLightNode(cb, cs);
    case 'color':
      return setLumNode(cs, lumNode(cb));
  }
}

/**
 * 合成一層（同 blend.ts 的 compositeColor）：正常＝(1 − αs)·Cb＋αs·Cs；
 * 其他模式＝(1 − αs)·Cb＋αs·(B(夾(Cb), Cs)＋k·(Cb − 夾(Cb)))，k（同 excessPass）：加深＝夾(Cs)、發光＝1 − 夾(Cs)、其他＝1。
 * 中性色完全不改變後面（含鐳射超過 1 的亮光）；純黑的墨擋住亮光、純白的發光不會超過 1。
 */
export function compositeNode(mode: BlendMode, cb: V3, cs: V3, alpha: F): V3 {
  if (mode === 'normal') return mix(cb, cs, alpha);
  const clamped = saturate(cb) as V3;
  const excess = cb.sub(clamped);
  const kept =
    mode === 'multiply'
      ? excess.mul(saturate(cs))
      : mode === 'screen'
        ? excess.mul(float(1).sub(saturate(cs)))
        : excess;
  return mix(cb, blendNode(mode, clamped, cs).add(kept), alpha);
}

/** 鐳射在這一層的多少（同 blend.ts 的 blendHoloMask）；null＝1（不用乘）。 */
export function blendHoloMaskNode(mode: BlendMode, cs: V3): F | null {
  if (mode === 'screen' || mode === 'add') return saturate(maxChannel(cs));
  if (mode === 'multiply') return saturate(float(1).sub(minChannel(cs)));
  return null;
}

/**
 * 這一層對「表面」的實際覆蓋率（同 blend.ts 的 surfaceWeight，T-417b）；null＝1（不用乘）。
 * 加深／發光／強光同 blendHoloMaskNode；疊色／柔光＝離 50% 灰最遠的通道 × 2；正常、換色＝1。
 */
export function blendSurfaceNode(mode: BlendMode, cs: V3): F | null {
  if (mode === 'overlay' || mode === 'soft-light') {
    const d = abs(saturate(cs).sub(0.5)) as V3;
    return saturate(maxChannel(d).mul(2));
  }
  return blendHoloMaskNode(mode, cs);
}
