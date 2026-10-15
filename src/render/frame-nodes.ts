// 卡框金屬質感的著色程式（T-303），TSL 版。算式和 frame.ts 一一對應（參數也讀 frame.ts 的 FRAME_METAL），
// 那邊有測試；改一邊要改另一邊。只多幾個算式、不多貼圖取樣；改卡框顏色／寬度／光澤只改 uniform。
// 雕花邊角（T-416，ornateLayer）：四角鏡射取樣一張灰階浮雕素材（多一次貼圖取樣，只有選雕花邊角的材質才有），
// 算式對應 frame.ts 的 ornateUv／ornateHighlightAmount／ornateMetal。

import {
  abs,
  cos,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  pow,
  saturate,
  sign,
  sin,
  smoothstep,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  step,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';
import { FRAME_METAL as M, FRAME_ORNATE as O } from './frame';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const TAU = Math.PI * 2;

/** 點 p 到圓角矩形（半寬半高 half、圓角 r）邊緣的帶號距離：裡面負、外面正（同 fit.ts 的 roundedRectSdf）。 */
export function roundedRectSdfNode(p: V2, half: V2, r: F): F {
  const q = abs(p).sub(half.sub(r));
  return length(max(q, vec2(0, 0))).add(min(max(q.x, q.y), 0)).sub(r);
}

export interface FrameShape {
  /** 內緣（圖和框的分界）：半寬半高、圓角。 */
  innerHalf: V2;
  innerRadius: F;
  /** 外緣（卡片輪廓）：半寬半高、圓角。 */
  outerHalf: V2;
  outerRadius: F;
}

/** frameGlare：斜的亮帶（位置隨觀看方向移動）照到 p 多少（glint）與環境明暗（env）。卡框與雕花邊角共用。 */
function glareNode(p: V2, view: V3): { glint: F; env: F } {
  const u = dot(p, vec2(M.sweepDir.x, M.sweepDir.y))
    .add(dot(view.xy, vec2(M.sweepView.x, M.sweepView.y)))
    .sub(M.sweepOffset);
  const c = cos(u.mul(TAU / M.sweepPeriod));
  const pos = max(c, 0);
  return {
    glint: min(pow(pos, M.glintSharpness).add(pow(pos, M.haloSharpness).mul(M.haloGain)), 1),
    env: c.mul(0.5).add(0.5),
  };
}

/**
 * 卡面上 p 這一點的卡框。color：框色（線性）；view：這一面的觀看方向（holo.ts 的 viewDirection）；
 * shine：光澤倍數 0～2（frame.ts 的 frameShineFactor：0＝素色、1＝原本、2＝高光兩倍）。
 * 回傳 cover（框蓋住多少，內緣約 1 像素柔邊）與 color（金屬質感的框色，線性）。
 */
export function frameLayer(p: V2, shape: FrameShape, color: V3, view: V3, shine: F): { cover: F; color: V3 } {
  const d = roundedRectSdfNode(p, shape.innerHalf, shape.innerRadius);
  const dOuter = roundedRectSdfNode(p, shape.outerHalf, shape.outerRadius);
  const pixel = fwidth(d).add(1e-6); // 一個像素多寬；加一點點避免 smoothstep 兩端相等
  const aa = pixel.mul(0.5); // 約 1 像素的柔邊
  const cover = smoothstep(aa.negate(), aa, d);

  // framePoint：框寬、t（0 內緣～1 外緣）、朝光程度
  const width = max(d.sub(dOuter), 1e-5);
  const t = saturate(d.div(width));
  const q = max(abs(p).sub(shape.innerHalf.sub(shape.innerRadius)), vec2(0, 0));
  const outward = sign(p).mul(q).div(max(length(q), 1e-6));
  const facing = dot(outward, vec2(M.light.x, M.light.y));
  const s = t.mul(2).sub(1);
  const s2 = s.mul(s);
  const crest = float(1).sub(s2);

  const { glint, env } = glareNode(p, view);

  // 拉絲紋：沿框方向的細紋＝跨框方向（到內緣的距離）上的一維數值噪聲，−1～1；
  // 一條細紋在畫面上不到 3 個像素寬時開始淡掉、不到 1.5 個像素就沒有（不出摩爾紋）
  const bx = d.mul(M.brushFreq);
  const cell = floor(bx);
  const hash = (x: F) => fract(sin(x.mul(12.9898)).mul(43758.5453));
  const brush = mix(hash(cell), hash(cell.add(1)), smoothstep(0, 1, fract(bx)))
    .mul(2)
    .sub(1)
    .mul(saturate(float(2).sub(pixel.mul(3 * M.brushFreq))));

  // 光澤：明暗起伏（斜面、環境、拉絲紋、內緣暗線）乘 relief（最多到原本的），高光乘 shine
  const relief = saturate(shine);
  const fade = (v: F) => v.mul(relief).add(float(1).sub(relief));

  // frameBevel × 環境明暗 × 拉絲紋
  const bevel = float(1).sub(s2.mul(M.bevelDepth)).add(facing.mul(s).mul(M.bevelLight));
  const shade = fade(bevel.mul(float(1).sub(float(1).sub(env).mul(M.envDepth))).mul(brush.mul(M.brushAmount).add(1)));
  // frameHighlightAmount
  const raw = glint
    .mul(crest.mul(1 - M.glintEdge).add(M.glintEdge))
    .add(env.mul(env).mul(crest).mul(M.sheen))
    .mul(brush.mul(2 * M.brushAmount).add(1));
  const amount = saturate(raw.mul(shine)).mul(M.highlightMax);
  // frameInnerLine
  const lineWidth = min(max(float(M.innerLineWidth), pixel), width.mul(M.innerLineMax));
  const line = fade(float(1).sub(float(1).sub(smoothstep(lineWidth, lineWidth.add(pixel), d)).mul(M.innerLineDark)));

  // frameMetal（sRGB 數值上算，再轉回線性）
  const base = saturate(sRGBTransferOETF(color) as V3);
  const highlight = mix(base, vec3(1, 1, 1), M.highlightWhiten);
  const srgb = saturate(mix(base.mul(shade), highlight, amount).mul(line));
  return { cover, color: sRGBTransferEOTF(srgb) as V3 };
}

export interface OrnateShape {
  /** 卡片輪廓（卡框外緣）的半寬半高：花紋素材的 (0,0) 對齊卡片的四個角。 */
  outerHalf: V2;
  /** 花紋邊長（卡寬單位，frame.ts 的 ornateSize）。 */
  size: F;
}

/**
 * 四角的雕花（T-416）：p 在花紋素材上的位置（ornateUv：四角鏡射）、取樣灰階浮雕（corner 是預乘 alpha 的 sRGB 貼圖，
 * 同圖層的 layerTexture；除回 alpha 得到灰階），灰階 → 框色＋和卡框同一條亮帶的流動高光（ornateMetal）。
 * color：框色（線性）；view：這一面的觀看方向；shine：光澤倍數 0～2。回傳 cover（花紋蓋住多少）與 color（線性）。
 */
export function ornateLayer(p: V2, shape: OrnateShape, corner: Texture, color: V3, view: V3, shine: F): { cover: F; color: V3 } {
  // ornateUv：離最近的左右邊、上下邊多遠（除以邊長）；貼圖的 v 由下往上
  const uv = shape.outerHalf.sub(abs(p)).div(shape.size);
  const texel = texture(corner, vec2(uv.x, float(1).sub(uv.y)));
  // 超出花紋邊長的地方不取（夾邊取樣會把素材邊上的像素拉長）；卡片範圍外本來就不畫
  const inside = step(uv.x, 1).mul(step(uv.y, 1));
  const cover = texel.a.mul(inside);
  const straight = texel.rgb.div(max(texel.a, 1e-4));
  const lum = saturate(dot(sRGBTransferOETF(straight) as V3, vec3(1 / 3, 1 / 3, 1 / 3)));

  // ornateHighlightAmount
  const { glint, env } = glareNode(p, view);
  const raise = saturate(lum.sub(O.midGray).div(1 - O.midGray));
  const raw = glint.mul(raise.mul(1 - O.glintBody).add(O.glintBody)).add(env.mul(env).mul(raise).mul(M.sheen));
  const amount = saturate(raw.mul(shine)).mul(M.highlightMax);

  // ornateMetal（sRGB 數值上算，再轉回線性）：浮雕（中灰＝框色、暗往黑、亮往高光色）× 環境明暗，再往高光色蓋 amount
  const base = saturate(sRGBTransferOETF(color) as V3);
  const highlight = mix(base, vec3(1, 1, 1), M.highlightWhiten);
  const low = min(lum.div(O.midGray), 1);
  const relief = mix(base.mul(low), highlight, raise);
  const fadeIn = saturate(shine);
  const shade = float(1).sub(float(1).sub(env).mul(M.envDepth)).mul(fadeIn).add(float(1).sub(fadeIn));
  const srgb = saturate(mix(relief.mul(shade), highlight, amount));
  return { cover, color: sRGBTransferEOTF(srgb) as V3 };
}
