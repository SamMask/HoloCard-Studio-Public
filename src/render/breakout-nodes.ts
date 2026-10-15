// 破框層（T-411）卡片範圍外的著色程式，TSL 版：和 breakout.ts 的 outsideLook、breakoutFade 一一對應（那邊有測試）。

import { float, max, min, smoothstep, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BlendMode } from '../model/types';
import { BREAKOUT_FADE } from './breakout';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const EPS = 1e-4;

/** 同 breakout.ts 的 outsideLook：卡外沒有後面的顏色可以混，換成一般半透明疊法的顏色（sRGB 數值）與 alpha。 */
export function outsideLookNode(mode: BlendMode, c: V3, alpha: F): { color: V3; alpha: F } {
  if (mode === 'screen' || mode === 'add') {
    const m = max(max(c.x, c.y), c.z);
    return { color: c.div(max(m, EPS)) as V3, alpha: alpha.mul(m) };
  }
  if (mode === 'multiply') {
    const n = float(1).sub(min(min(c.x, c.y), c.z));
    return { color: c.sub(vec3(1, 1, 1).sub(n)).div(max(n, EPS)) as V3, alpha: alpha.mul(n) };
  }
  return { color: c, alpha };
}

/** 同 breakout.ts 的 breakoutFade：viewZ＝這一面朝鏡頭的程度（holo.ts 的 viewDirection 的 z）。 */
export function breakoutFadeNode(viewZ: F): F {
  return smoothstep(BREAKOUT_FADE.from, BREAKOUT_FADE.to, viewZ);
}
