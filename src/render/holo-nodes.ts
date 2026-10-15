// 鐳射（全息反光）著色程式，TSL 版。
//
// 演算法移植自 EverettFish/holo-card-studio（MIT 授權，https://github.com/EverettFish/holo-card-studio）
// 的 assets/web-holographic/app.js：hash／noise、柔和色譜 spectrum（粉→金→藍→白）、視角驅動的波紋 wave、
// overlay 疊加混色（背景 0.36、主角 0.28 × 強度）、隨視角移動的窄光帶 sweep（pow(sin, 12)）、
// Voronoi 邊緣的稀疏閃星 star（隨時間與視角閃爍）。原作是 WebGL 的 GLSL 字串，這裡用 TSL 重寫（WebGPU／WebGL2 共用）。
// 授權全文見專案根目錄的 THIRD_PARTY_NOTICES.md。
//
// 和原作不同的地方：
// - 原作只有「背景＋主角」兩層、閃星只在背景；這裡每個要反光的圖層各自套一次（用該層的 alpha 當遮罩），
//   閃星的格點用「該層自己的座標」，所以亮點跟著圖層走；卡身色／素色卡背與卡框也能套。
// - 色帶寬度：波紋、色譜噪聲、光帶的空間座標乘上 freq（＝1／色帶寬度），視角帶來的移動量不變。
// - 閃星門檻由「閃星多寡」決定（原作固定 0.9）；亮邊寬度至少一個像素（見 star）。
// - 色譜的 4 個顏色改成 uniform（T-310 使用者選的鐳射色彩，holo.ts 的 holoPaletteColors／holoSpectrum）；
//   分段位置照原作，「經典彩虹」＝原作的粉 → 金 → 藍 → 白。換色彩只改 uniform。
// - 原作的線稿高光（墨線上加一點隨光帶走的奶油色亮光）改寫成 T-802 的「沿線條反光」（lineWeightNode／lineGlowNode，
//   整條線換成彩虹色，見 lineart.ts）；bloom 後處理沒有移植（不用後處理）。
// - 原作在 sRGB 數值上算、最後 pow 2.2；這裡同樣在 sRGB 數值上算，再用 three.js 的 sRGB 轉換回線性。
// - 反光層（T-417）的霧光（matteSheenNode：沒有彩虹的白色寬光帶）與選中時的斜線（flashStripesNode）是本專案自己加的，不是原作的。

import {
  cos,
  dot,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  pow,
  saturate,
  sin,
  smoothstep,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  step,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node, UniformNode, Vector3 } from 'three/webgpu';
import { LUM_WEIGHTS } from './blend';
import { MATTE_LOOK, SPARKLE_PHASE_RATE, SPECTRUM_STOPS } from './holo';
import { LINEART_LOOK } from './lineart';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const TAU = 6.283;

/** 原作：混色係數（背景 0.36、主角 0.28），光帶 0.28，閃星 0.65。 */
export const HOLO_MIX_BACKGROUND = 0.36;
export const HOLO_MIX_SUBJECT = 0.28;
const SWEEP_GAIN = 0.28;
const STAR_GAIN = 0.65;
/** 閃星格點密度：每個卡寬幾格（原作 105 格／卡面）。 */
const STAR_CELLS = 105;

// hash(p) = fract(sin(dot(p, (127.1, 311.7))) × 43758.5453)
const hash = Fn(([p]: [V2]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)), {
  p: 'vec2',
  return: 'float',
}) as unknown as (p: V2) => F;

// 數值噪聲（平滑內插）
const noise = Fn(([p]: [V2]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash(i);
  const b = hash(i.add(vec2(1, 0)));
  const c = hash(i.add(vec2(0, 1)));
  const d = hash(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}, { p: 'vec2', return: 'float' }) as unknown as (p: V2) => F;

// 柔和色譜：4 個色票（uniform，sRGB 數值）依序漸變；原作是固定的粉 → 金 → 藍 → 白（if 分段改成三段連續 mix，結果相同）。
// 算式同 holo.ts 的 holoSpectrum
function spectrum(t0: F, palette: HoloUniforms['palette']): V3 {
  const t = fract(t0);
  const [s0, s1, s2, s3] = SPECTRUM_STOPS;
  const a = mix(palette[0], palette[1], saturate(t.sub(s0).div(s1 - s0)));
  const b = mix(a, palette[2], saturate(t.sub(s1).div(s2 - s1)));
  return mix(b, palette[3], saturate(t.sub(s2).div(s3 - s2)));
}

// 視角驅動的斜向波紋（a＝表面座標 × freq ＋ 視角 × 2.4）
const wave = Fn(([a]: [V2]) => {
  const stripes = a.x.mul(0.848).sub(a.y.mul(0.53)).mul(TAU * 0.55);
  return sin(stripes.add(noise(a.mul(1.5)).mul(7))).mul(0.5).add(0.5);
}, { a: 'vec2', return: 'float' }) as unknown as (a: V2) => F;

// Voronoi 邊緣的稀疏閃星：q＝格點座標；phase＝時間與視角的閃爍相位；cut＝亂數門檻（≥1 就沒有）
const star = Fn(([q, phase, cut]: [V2, F, F]) => {
  const id = floor(q);
  const f = fract(q);
  // 原作的 3×3 迴圈在這裡展開；「最近／第二近」用 min／max 更新，結果和 if 版相同
  let first: F = float(9);
  let second: F = float(9);
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const cell = id.add(vec2(x, y));
      const o = vec2(hash(cell), hash(cell.add(43.3)));
      const d = length(vec2(x, y).add(o).sub(f));
      second = min(second, max(first, d));
      first = min(first, d);
    }
  }
  // 原作的亮邊只有格子的 1／40 寬，在一般螢幕上比一個像素還細（亮點時有時無）；
  // 上緣加上一個像素的變化量，畫面解析度低時亮點至少一個像素寬，高解析度時和原作一樣細
  const gap = second.sub(first);
  const edge = float(1).sub(smoothstep(0.01, fwidth(gap).add(0.035), gap));
  const sparse = step(cut, hash(id.add(8.8)));
  const twinkle = pow(sin(phase.add(hash(id).mul(30))).mul(0.5).add(0.5), 6);
  return edge.mul(sparse).mul(twinkle);
}, { q: 'vec2', phase: 'float', cut: 'float', return: 'float' }) as unknown as (q: V2, phase: F, cut: F) => F;

/** overlay 疊加混色（底色 b、上色 f，都是 0～1 的 sRGB 數值）。 */
function overlay(b: V3, f: V3): V3 {
  const dark = b.mul(f).mul(2);
  const light = float(1).sub(float(1).sub(b).mul(float(1).sub(f)).mul(2));
  return mix(dark, light, step(vec3(0.5, 0.5, 0.5), b));
}

type ColorUniform = UniformNode<'vec3', Vector3>;

/** 兩面共用的鐳射 uniform（main 改設定、影格迴圈改時間時只動這些數值）。 */
export interface HoloUniforms {
  foil: UniformNode<'float', number>;
  freq: UniformNode<'float', number>;
  sparkleCut: UniformNode<'float', number>;
  time: UniformNode<'float', number>;
  /** 霧光 0～1（T-417，holo.ts 的 holoUniformValues；強度 0 時也是 0）。 */
  matte: UniformNode<'float', number>;
  /** 色譜的 4 個色票（sRGB 0～1，holo.ts 的 holoPaletteColors）。 */
  palette: [ColorUniform, ColorUniform, ColorUniform, ColorUniform];
}

/** 卡面上某一點的鐳射底稿（每個像素算一次，所有要反光的圖層共用）。 */
export interface HoloSurface {
  /** 彩虹色（sRGB 數值）。 */
  foil: V3;
  /** 光帶亮度 0～1。 */
  sweep: F;
  /** 閃星閃爍相位（時間＋視角）。 */
  phase: F;
}

/**
 * surface：卡面座標換成原作的 uv 方向（中心 0.5、往右 x 增加、往下 y 增加，卡寬單位）。
 * view：觀看方向（那一面自己的座標，見 holo.ts 的 viewDirection）。
 */
export function holoSurface(surface: V2, view: V3, u: HoloUniforms): HoloSurface {
  const scaled = surface.mul(u.freq);
  const w = wave(scaled.add(view.xy.mul(2.4)));
  const foil = spectrum(w.mul(0.8).add(noise(scaled.mul(5)).mul(0.12)), u.palette);
  const band = scaled.x.mul(0.83).add(scaled.y.mul(0.35)).add(view.x.mul(1.8)).add(view.y.mul(0.9));
  const sweep = pow(max(sin(band.mul(TAU)), 0), 12);
  const phase = u.time.mul(SPARKLE_PHASE_RATE).add(view.x.mul(27)).add(view.y.mul(21));
  return { foil, sweep, phase };
}

/** 閃星亮度 0～1。starAt：格點用的座標（卡寬單位、往下為 +y；圖層用它自己的位置，亮點才會跟著圖層走）。 */
export function holoGlint(starAt: V2, s: HoloSurface, u: HoloUniforms): F {
  return star(starAt.mul(STAR_CELLS), s.phase, u.sparkleCut);
}

/**
 * 對一個顏色（線性）套鐳射，回傳線性顏色。呼叫端再用該層的 alpha 疊上去，所以反光只出現在這層看得到的地方。
 * mixAmount：HOLO_MIX_BACKGROUND 或 HOLO_MIX_SUBJECT；glint：holoGlint 的結果（同一組座標的可以共用）。
 */
export function applyHolo(linear: V3, s: HoloSurface, u: HoloUniforms, mixAmount: number, glint: F): V3 {
  return sRGBTransferEOTF(applyHoloSrgb(sRGBTransferOETF(linear) as V3, s, u, mixAmount, glint)) as V3;
}

/**
 * 同 applyHolo，但輸入輸出都是 sRGB 數值（T-408：卡面的圖層在 sRGB 數值上合成，不必轉來轉去）。
 * 結果可能超過 1（光帶、閃星是加上去的）。
 */
export function applyHoloSrgb(c: V3, s: HoloSurface, u: HoloUniforms, mixAmount: number, glint: F): V3 {
  const tinted = mix(c, overlay(c, s.foil), u.foil.mul(mixAmount));
  const swept = tinted.add(s.foil.mul(s.sweep).mul(u.foil.mul(SWEEP_GAIN)));
  return swept.add(vec3(0.66, 0.86, 1).mul(glint).mul(u.foil.mul(STAR_GAIN)));
}

// ---- 反光層（T-417）----

/**
 * 霧光光帶的亮度（haze～1，同 holo.ts 的 matteSheen）：沒有彩虹，一條很寬、很柔的光帶隨視角慢慢滑過。
 * surface：表面座標（同 holoSurface：中心 0.5、往下 +y）；view：觀看方向。
 */
export function matteSheenNode(surface: V2, view: V3): F {
  const m = MATTE_LOOK;
  const d = surface.x.mul(m.dir.x).add(surface.y.mul(m.dir.y)).add(view.x.mul(m.view.x)).add(view.y.mul(m.view.y));
  const band = pow(cos(d.sub(m.center).mul((2 * Math.PI) / m.period)).mul(0.5).add(0.5), m.power);
  return band.mul(1 - m.haze).add(m.haze);
}

/** 霧光加多亮（sRGB 數值，白色；同 holo.ts 的 matteLift）。 */
export function matteLiftNode(u: HoloUniforms, sheen: F): F {
  return u.matte.mul(MATTE_LOOK.gain).mul(sheen);
}

/** 黑白圖這一點的反光程度（同 holo.ts 的 maskCoverage）：rgba＝取樣的原始數值（不轉線性）。 */
export function maskCoverageNode(rgb: V3, alpha: F): F {
  return dot(rgb, vec3(LUM_WEIGHTS.r, LUM_WEIGHTS.g, LUM_WEIGHTS.b)).mul(alpha);
}

/** 斜線的密度（每卡寬幾條，沿 x＋y 方向）與往右上移動的速度（每秒幾條）。 */
const FLASH_STRIPES = 9;
const FLASH_SPEED = 1.5;
/** 斜線最亮加多少（sRGB 數值，白色）：淡淡的，看得出範圍就好。 */
export const FOIL_FLASH_GAIN = 0.2;

/** 選中反光層時的斜線 0～1（每一條中間亮、兩邊柔和）。p：卡面座標（卡寬單位，+y 往上）。 */
export function flashStripesNode(p: V2, time: F): F {
  const t = fract(p.x.add(p.y).mul(FLASH_STRIPES).sub(time.mul(FLASH_SPEED)));
  return smoothstep(0, 0.12, t).mul(float(1).sub(smoothstep(0.3, 0.42, t)));
}

// ---- 線稿高光（T-802，lineart.ts 同算式）----

/** 混入比例（同 lineart.ts 的 lineWeight(lineStrength(c, alpha))）：smoothstep(from, to, (1 − Lum(c)) × alpha)。c＝這層的顏色（sRGB 數值，已夾在 0～1）。 */
export function lineWeightNode(c: V3, alpha: F): F {
  const strength = saturate(float(1).sub(dot(c, vec3(LUM_WEIGHTS.r, LUM_WEIGHTS.g, LUM_WEIGHTS.b)))).mul(saturate(alpha));
  return smoothstep(LINEART_LOOK.from, LINEART_LOOK.to, strength);
}

/** 鐳射強度 → 線條混入的倍數（同 lineart.ts 的 lineFoil）：min(1, gain × foil)。 */
export function lineFoilNode(u: HoloUniforms): F {
  return saturate(u.foil.mul(LINEART_LOOK.gain));
}

/** 線條的光（同 lineart.ts 的 lineGlow）：鐳射彩虹色 × (base ＋ sweep × 光帶亮度)，sRGB 數值。 */
export function lineGlowNode(s: HoloSurface): V3 {
  return s.foil.mul(s.sweep.mul(LINEART_LOOK.sweep).add(LINEART_LOOK.base));
}
