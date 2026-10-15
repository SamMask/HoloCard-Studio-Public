// 雙圖光柵（T-805）的著色程式，TSL 版：和 lenticular.ts 的 lensMix／lensDim 同一個式子（公式與出處見那個檔的檔頭）。
// card-mesh 每一面只算一次混入比例（同一面所有有變身圖的層共用），沒有變身圖的面不呼叫、不建任何節點。

import { abs, atan, degrees, float, fract, max, min, smoothstep } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { LENTICULAR } from './lenticular';

type F = Node<'float'>;

/**
 * 這一點換成變身圖的比例 0～1（lensMix）：view＝這一面座標下的看的方向（card-mesh 的 uViews[face]）、
 * u＝卡面橫向位置 0～1（看著這一面由左到右、不跟視差）。
 */
export function lensMixNode(view: Node<'vec3'>, u: F): F {
  const angle = degrees(atan(view.x, max(view.z, LENTICULAR.minZ))).add(u.sub(0.5).mul(LENTICULAR.sweep));
  const p = min(abs(angle).div(LENTICULAR.flipAngle), 1);
  const t = p.add(fract(u.mul(LENTICULAR.pitch)).sub(0.5).mul(LENTICULAR.stripe * 0.5));
  return smoothstep(0.5 - LENTICULAR.softness, 0.5 + LENTICULAR.softness, t);
}

/** 切換中間的暗度（lensDim）：(1 − |2·mix − 1|) × dim（參考專案原式的三角形）。 */
export function lensDimNode(mix: F): F {
  return float(1).sub(abs(mix.mul(2).sub(1))).mul(LENTICULAR.dim);
}
