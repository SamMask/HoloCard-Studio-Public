// 雙圖光柵（T-805，SCHEMA §1 Layer.alt?）的純數學：固定參數、每一點換成變身圖的比例、切換中間的暗度、哪些層要畫變身圖。
// 不 import three.js（方便在 node 測）；著色程式是 lenticular-nodes.ts 的 lensMixNode／lensDimNode，card-mesh 套用，算式一一對應。
//
// 公式移植自 EverettFish/holo-card-studio（MIT，授權全文見 THIRD_PARTY_NOTICES.md）的 references/lenticular-model.md：
//   角度 angle＝degrees(atan2(V.x, max(V.z, 0.05))) ＋ (u − 0.5) × sweep
//     V＝看的方向（卡片中心看向鏡頭，換到這一面自己的座標：holo.ts 的 viewDirection；背面照背面那一面算）；
//     u＝卡面橫向位置 0～1（看著這一面由左到右；用卡面原始座標、不跟視差，條紋像真的光柵片一樣貼在卡上）。
//     加上和 u 成正比的偏移，換的那一下從卡片一邊掃到另一邊。
//   進度 p＝min(|angle| ÷ flipAngle, 1)：左右兩邊都換成變身圖、正面是本來的圖（參考專案的「真實循環」cycle 這次不做）。
//   條紋 lens＝fract(u × pitch) − 0.5；t＝p ＋ lens × stripe × 0.5：卡寬分成 pitch 條，每條裡面切換點錯開一點。
//   混入比例 mix＝smoothstep(0.5 − softness, 0.5 + softness, t)：0＝本來的圖、1＝變身圖（中點在 flipAngle 的一半，約 7°）。
//   暗度＝(1 − |2·mix − 1|) × dim：兩張各一半時最暗（照參考專案原式的三角形；T-805 審查：DESIGN 要照原文，不換成平滑曲線）。
// 參考專案的 depth、refract、ridge、foil、cycle 都不做。參數固定、不給使用者調（DESIGN「雙圖光柵」）。

import type { Layer } from '../model/types';

/**
 * 固定參數（參考專案的預設）：flipAngle 切換角度（度）、softness 柔和度、pitch 條紋數（每個卡寬）、stripe 條紋強度
 * （0＝平順、1＝硬交錯）、sweep 掃過（度）；minZ＝atan2 分母的下限；dim＝切換中間最暗時壓暗幾成（在 sRGB 數值上乘 1 − 暗度）。
 */
export const LENTICULAR = {
  flipAngle: 14,
  softness: 0.22,
  pitch: 120,
  stripe: 0.35,
  sweep: 6,
  minZ: 0.05,
  dim: 0.06,
} as const;

/** 這層畫的時候要不要換成變身圖：立體層、不是文字層、不是破框層，而且有 alt（不合格的資料也不會畫）。 */
export function altOn(layer: Pick<Layer, 'role' | 'text' | 'breakout' | 'alt'>): boolean {
  return layer.role === 'depth' && layer.text === undefined && layer.breakout !== true && layer.alt !== undefined;
}

const RAD = Math.PI / 180;

const fract = (v: number): number => v - Math.floor(v);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 這一點看這一面的角度（度，帶正負）：viewX／viewZ＝這一面座標下的看的方向、u＝卡面橫向位置 0～1。 */
export function lensAngle(viewX: number, viewZ: number, u: number): number {
  return Math.atan2(viewX, Math.max(viewZ, LENTICULAR.minZ)) / RAD + (u - 0.5) * LENTICULAR.sweep;
}

/** 這一點換成變身圖的比例 0～1（0＝本來的圖、1＝變身圖）。 */
export function lensMix(viewX: number, viewZ: number, u: number): number {
  const p = Math.min(1, Math.abs(lensAngle(viewX, viewZ, u)) / LENTICULAR.flipAngle);
  const t = p + (fract(u * LENTICULAR.pitch) - 0.5) * LENTICULAR.stripe * 0.5;
  return smoothstep(0.5 - LENTICULAR.softness, 0.5 + LENTICULAR.softness, t);
}

/** 切換中間的暗度（0～dim）：(1 − |2·mix − 1|) × dim。 */
export function lensDim(mix: number): number {
  return (1 - Math.abs(2 * mix - 1)) * LENTICULAR.dim;
}
