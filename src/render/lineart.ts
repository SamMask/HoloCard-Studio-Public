// 線稿高光（T-802，SCHEMA §1 Layer.lineart?）的純數學：哪些層會沿線條發光、線條強度、混入比例、線條的光、混色。
// 不 import three.js（方便在 node 測）；著色程式是 holo-nodes.ts 的 lineWeightNode／lineGlowNode，card-mesh 套用，算式一一對應。
//
// 參考 EverettFish/holo-card-studio（MIT）的「線稿」層：那邊只在墨線上加一點隨光帶走的奶油色亮光；
// 這裡改成整條線換成鐳射的彩虹色（同一組色譜、色帶寬度、視角流動），光帶掃過時更亮——黑線變成會流動的彩虹亮線。
//
// 每個像素（都在 sRGB 數值上，卡面的圖層本來就在 sRGB 數值上合成）：
//   線條強度 s＝(1 − Lum(這層的顏色)) × alpha（SCHEMA 的式子；Lum 權重同混合模式）
//   混入比例 w＝smoothstep(from, to, s)：淺色、米白紙（s ≤ from）完全不亮，越黑越亮
//   線條的光 G＝鐳射彩虹色 × (base ＋ sweep × 光帶亮度)
//   鐳射強度的倍數 f＝min(1, gain × 強度/100)：強度 0＝不亮；gain 讓預設強度（65）時黑線整條換成光
//   這層照它的混合模式合成完之後：結果＝mix(合成好的顏色, G, w × 顯示 × 不透明度 × f)
// 所以白底（w＝0）、鐳射強度 0、看不見的層：結果原封不動；黑線（加深模式合成完是黑的）換成彩虹光。
// 和反光層的關係（card-mesh）：線條算亮面（這一點最上面的表面那 w 成換成亮面），白底不改變下面的狀態。

import type { Layer } from '../model/types';
import { LUM_WEIGHTS } from './blend';
import type { Rgb } from './frame';

/**
 * 線稿高光的樣子（子代理 2026-10-14 在星晶龍、琥根花粉獸兩張範例卡上調）：
 * from／to＝混入比例的 smoothstep 兩端（線條強度）；base＝沒有光帶時線條的亮度倍數；sweep＝光帶掃過時多亮；
 * gain＝鐳射強度的倍數（強度 × gain 夾在 1：範例卡的強度 40 時線條約六成換成光、65 以上整條換成光；
 * 1 倍時強度 40 的卡線條只亮到一半，深色的線看起來是暗紅色、不像會發光）。
 */
export const LINEART_LOOK = {
  from: 0.2,
  to: 0.8,
  base: 1.15,
  sweep: 0.6,
  gain: 1.6,
} as const;

/** 這層畫的時候要不要沿線條發光：立體層、不是文字層、不是破框層（破框層整層不套鐳射），而且明寫 true。 */
export function lineartOn(layer: Pick<Layer, 'role' | 'text' | 'breakout' | 'lineart'>): boolean {
  return layer.role === 'depth' && layer.text === undefined && layer.breakout !== true && layer.lineart === true;
}

const sat = (v: number): number => Math.min(1, Math.max(0, v));

/** 線條強度（SCHEMA）：(1 − 亮度) × alpha，0～1；c＝這層的顏色（sRGB 數值），亮度用 Lum 權重。 */
export function lineStrength(c: Rgb, alpha: number): number {
  const lum = LUM_WEIGHTS.r * sat(c.r) + LUM_WEIGHTS.g * sat(c.g) + LUM_WEIGHTS.b * sat(c.b);
  return sat(1 - lum) * sat(alpha);
}

/** 混入比例：smoothstep(from, to, 線條強度)。 */
export function lineWeight(strength: number): number {
  const t = sat((strength - LINEART_LOOK.from) / (LINEART_LOOK.to - LINEART_LOOK.from));
  return t * t * (3 - 2 * t);
}

/** 線條的光（sRGB 數值，可能超過 1）：foil＝鐳射彩虹色、sweep＝光帶亮度 0～1（holo-nodes 的 HoloSurface）。 */
export function lineGlow(foil: Rgb, sweep: number): Rgb {
  const k = LINEART_LOOK.base + LINEART_LOOK.sweep * sweep;
  return { r: foil.r * k, g: foil.g * k, b: foil.b * k };
}

/** 鐳射強度（holo.ts 的 holoUniformValues 的 foil，0～1）→ 線條混入的倍數：min(1, gain × foil)；0 時是 0（不亮）。 */
export function lineFoil(foil01: number): number {
  return sat(LINEART_LOOK.gain * foil01);
}

/** 合成完這一層之後混進線條的光：k＝混入比例 × 顯示 × 不透明度 × lineFoil(鐳射強度)。k 0 時原封不動。 */
export function lineartMix(cb: Rgb, glow: Rgb, k: number): Rgb {
  const m = (x: number, y: number) => x * (1 - k) + y * k;
  return { r: m(cb.r, glow.r), g: m(cb.g, glow.g), b: m(cb.b, glow.b) };
}
