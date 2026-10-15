// 展示廳（T-410、T-816）的著色程式（TSL）。尺寸、位置、轉速與漂浮的數字在 gallery-layout.ts；倒影在 reflection.ts。
// 輸出一律是「線性、預乘過的顏色＋不透明度」（圓台不透明，不透明度 1）；材質的混色在 gallery-fx.ts。
// 都是程式算的紋理（石地板、拉絲金屬、光柱、花瓣、散景光點、玻璃板），沒有額外的圖檔；畫好的大廳（T-816）是 CSS 那層。

import { Color, type Node, type Texture, type TextureNode, type UniformNode } from 'three/webgpu';
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  instanceIndex,
  length,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  saturate,
  sign,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import {
  BOKEH_BOX,
  BOKEH_COUNT,
  BOKEH_RISE,
  BOKEH_SIZE,
  BOKEH_TWINKLE,
  FLOAT_GLASS_PAD,
  FLOAT_THUMB_INSET,
  floatOpacity,
  FLOOR_FADE,
  FLOOR_LIGHT,
  FLOOR_POOL,
  FLOOR_REFLECTION,
  FLOOR_RING,
  FLOOR_TILE,
  GALLERY_LIGHTS,
  HALL_FLOOR_FADE,
  PETAL_BOX,
  PETAL_DEPTH,
  PETAL_FALL,
  PETAL_NEAR_BIAS,
  PETAL_SWAY,
  RIM_CORE,
  RIM_MIRROR_CORE,
  RIM_SPILL,
  rimMirrors,
  SHAFTS,
  TIERS,
  TOP_RING_SPIN,
  type Tier,
  type TopRing,
} from './gallery-layout';
import type { ReflectionSample } from './reflection';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type FloatUniform = UniformNode<'float', number>;

const TAU = Math.PI * 2;

/** sRGB 色碼 → 線性的 vec3（著色程式在線性空間算）。 */
export function linear(hex: string): V3 {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** 預乘過的顏色＋不透明度。 */
export interface Look {
  color: V3;
  alpha: F;
}

/**
 * 顏色最亮的那個分量。畫布是透明的、和後面的 CSS 那層用預乘 alpha 合成：光（加上去的顏色）的不透明度不能比顏色小，
 * 不然疊在畫好的大廳上時光會被壓暗（T-816）。所以「預乘 over」的光，不透明度至少取這個值。
 */
function maxChannel(c: V3): F {
  return max(max(c.x, c.y), c.z);
}

// ---- 共用：小雜訊 ----

/** 0～1 的偽亂數（座標不大時夠穩定）。 */
export function rand2(p: V2): F {
  return fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
}

/** 平滑的值雜訊（0～1）。 */
export function noise2(p: V2): F {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = rand2(i);
  const b = rand2(i.add(vec2(1, 0)));
  const c = rand2(i.add(vec2(0, 1)));
  const d = rand2(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** 三層的碎形雜訊（0～1 附近）。 */
export function fbm(p: V2): F {
  return noise2(p).mul(0.55).add(noise2(p.mul(2.1).add(17.3)).mul(0.3)).add(noise2(p.mul(4.3).add(41.7)).mul(0.15));
}

// ---- 展示廳的環境光（金屬與地板反射用的假環境） ----

const HALL_SKY = '#16264f';
const HALL_BAND = '#5d9fe0';
const HALL_TOP = '#d8ecff';
const HALL_FLOOR = '#070b16';
const KEY_DIR = [-0.55, 0.35, 0.75] as const;

/** 反射方向 r（世界、單位向量）看到的展示廳：上方的燈（斜面高光）、地平線下方一條冷光帶（側邊的金屬光）、暗藍天花板、深色地板。 */
function hallEnv(r: V3): V3 {
  const top = smoothstep(0.72, 0.97, r.y).mul(0.75);
  const band = exp(r.y.add(0.13).div(0.17).pow(2).negate()).mul(0.5);
  const sky = smoothstep(-0.05, 0.9, r.y).mul(0.35);
  const ground = smoothstep(0.1, -0.6, r.y);
  const key = pow(max(dot(r, normalize(vec3(...KEY_DIR))), 0), 18).mul(0.9);
  return linear(HALL_SKY)
    .mul(sky)
    .add(linear(HALL_BAND).mul(band))
    .add(linear(HALL_TOP).mul(top.add(key)))
    .add(linear(HALL_FLOOR).mul(ground));
}

// ---- 地板 ----

const STONE_DARK = '#0a0f1a';
const STONE_LIGHT = '#1d2638';
const STONE_VEIN = '#3a4a68';
const GROUT = '#03050a';
const GLOW_COLOR = '#3fcfff';
const SHAFT_POOL = '#7fc2ff';

/** 柔和的上限（同 gallery-layout 的 softLimit）：x ≤ knee × max 原封不動，以上慢慢逼近 max。 */
function softLimitNode(x: F, maxValue: number): F {
  const start = FLOOR_LIGHT.knee * maxValue;
  const room = maxValue - start;
  return min(x, start).add(float(1).sub(exp(max(x.sub(start), 0).div(room).negate())).mul(room));
}

/** 整個顏色照最亮的那個分量設上限（不改色相）：FLOOR_LIGHT 的 ②，卡片的白以下。 */
function limitColor(c: V3): V3 {
  const brightest = maxChannel(c);
  return c.mul(softLimitNode(brightest, FLOOR_LIGHT.max).div(max(brightest, 1e-5)));
}

export interface FloorInputs {
  /** 倒影（已經越往下越淡）。 */
  reflection: ReflectionSample;
  /** 台緣發光環的亮度倍數（呼吸 × 拖曳反應）。 */
  glow: F;
  /** 光柱的明暗起伏（0～1）。 */
  shimmer: F;
}

/**
 * 地板上映出的台緣光環（T-816，台子的倒影；倒影的鏡頭只畫卡片，台子在這裡直接算）：
 * 視線打到地板後在鏡面下方繼續走，走到和某層亮線一樣深（gallery-layout 的 rimMirrors）時離中心多遠——剛好是那層的半徑就亮。
 * 越深的越糊、越淡。台子正後方的那半圈被台子本身擋住（台子後畫），看得到的是左右兩側台子外面的那段。回傳亮度（0 起跳）。
 * T-816c：亮度、越深越淡的長度、往兩邊散開的柔光照 FLOOR_REFLECTION（調亮，美化稿的台緣光環在地上有明顯的青藍反光）。
 */
function platformMirror(): F {
  const look = FLOOR_REFLECTION;
  const toPoint = positionWorld.sub(cameraPosition);
  const slope = toPoint.xz.div(max(toPoint.y.negate(), 1e-4));
  let light: F = float(0);
  for (const m of rimMirrors()) {
    const r = length(positionWorld.xz.add(slope.mul(m.height)));
    const d = r.sub(m.radius);
    const width = max(fwidth(r).mul(0.9), float(RIM_MIRROR_CORE.width + m.height * RIM_MIRROR_CORE.perHeight));
    const core = exp(d.div(width).pow(2).negate()).mul(float(RIM_MIRROR_CORE.width).div(width));
    const spill = exp(abs(d).div(look.rimMirrorSpread).negate()).mul(look.rimMirrorSpill);
    light = light.add(core.add(spill).mul(Math.exp(-m.height / look.rimMirrorDepth)));
  }
  return light.mul(look.rimMirror);
}

/** 台子周圍地上的青藍光暈＋台子底下一圈亮環（像地上的燈帶）：p＝地上一點（展示廳原點的 x、z）。 */
function floorGlow(p: V2): F {
  const r = length(p);
  const base = TIERS.at(-1)!.radius;
  const pool = exp(max(r.sub(base), 0).div(FLOOR_POOL.reach).negate()).mul(FLOOR_POOL.gain);
  const ringD = r.sub(base + FLOOR_RING.gap).div(max(fwidth(r).mul(0.9), FLOOR_RING.width));
  const ring = exp(ringD.mul(ringD).negate()).mul(GALLERY_LIGHTS.floorRing);
  return pool.add(ring);
}

/**
 * 地上的光（T-816e）：台子周圍的光暈與亮環（乘 FLOOR_REFLECTION.glow，兩種地板同一個倍數）＋映出的台緣光環，先限制在台緣亮線的
 * FLOOR_LIGHT.rimShare 倍以內（FLOOR_LIGHT ①），再乘呼吸／拖曳亮度 glow——任何時候都比台緣本身暗。回傳亮度（乘 GLOW_COLOR 用）。
 */
function floorLight(p: V2, glow: F): F {
  const raw = floorGlow(p).mul(FLOOR_REFLECTION.glow).add(platformMirror());
  return softLimitNode(raw, FLOOR_LIGHT.rimShare * GALLERY_LIGHTS.rimCore).mul(glow);
}

/** 石地板（畫好的大廳還沒讀好時，T-410）。p：地上一點（展示廳原點的 x、z，卡寬）。 */
export function floorLook(p: V2, inputs: FloorInputs): Look {
  // 大理石：磚內的底色起伏＋扭曲的細紋（磚與磚之間細細的縫）
  const cell = floor(p.div(FLOOR_TILE));
  const f = fract(p.div(FLOOR_TILE));
  const tone = rand2(cell.add(7.1));
  const warp = fbm(p.mul(0.9).add(cell.mul(3.7)));
  const vein = pow(saturate(float(1).sub(abs(sin(p.x.mul(1.1).add(p.y.mul(0.45)).add(warp.mul(4.5)))))), 7);
  const marble = mix(linear(STONE_DARK), linear(STONE_LIGHT), fbm(p.mul(1.6)).mul(0.6).add(tone.mul(0.4)));
  let color: V3 = marble.add(linear(STONE_VEIN).mul(vein.mul(0.14)));
  const edge = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(FLOOR_TILE);
  const seamWidth = max(fwidth(edge), 0.002);
  const seam = float(1).sub(smoothstep(seamWidth.mul(0.6), seamWidth.mul(1.8), edge));
  // 遠處縫線會糊成一片：照像素大小淡掉
  const seamFade = saturate(float(1).sub(fwidth(p.x).add(fwidth(p.y)).mul(18)));
  color = mix(color, linear(GROUT), seam.mul(seamFade).mul(0.75));

  // 拋光的石面：斜看時映出展示廳（菲涅耳）
  const view = normalize(positionWorld.sub(cameraPosition));
  const fresnel = pow(float(1).sub(abs(view.y)), 4).mul(0.85).add(0.04);
  color = color.add(hallEnv(reflect(view, vec3(0, 1, 0))).mul(fresnel).mul(0.8));

  // 台子周圍地上的青藍光暈、地上亮環、映出的台緣光環（T-816；T-816c 調亮；T-816e 有上限，floorLight）、光柱打下來的亮區
  color = color.add(linear(GLOW_COLOR).mul(floorLight(p, inputs.glow)));
  let pools: F = float(0);
  for (const s of SHAFTS) {
    const dx = p.x.sub(s.x).div(s.bottomWidth * 0.7);
    const dz = p.y.sub(s.z).div(s.bottomWidth * 1.4);
    pools = pools.add(exp(dx.mul(dx).add(dz.mul(dz)).negate()).mul(s.gain));
  }
  color = color.add(linear(SHAFT_POOL).mul(pools.mul(inputs.shimmer.mul(0.05).add(0.12))));

  // 倒影：拋光地板映得比台面淡一點（T-816c 調亮，FLOOR_REFLECTION.stoneCard）
  const refl = inputs.reflection;
  const mirror = FLOOR_REFLECTION.stoneCard;
  color = color.mul(float(1).sub(refl.alpha.mul(mirror))).add(refl.color.mul(mirror));
  // 整片地板最亮的分量不超過卡片的白（T-816e，FLOOR_LIGHT ②；平常的石面遠低於上限，不受影響）
  color = limitColor(color);

  // 遠處淡進背景（畫布透明，後面是 CSS 的展示廳底色）
  const dist = length(positionWorld.xz.sub(cameraPosition.xz));
  const alpha = float(1).sub(smoothstep(FLOOR_FADE[0], FLOOR_FADE[1], dist));
  return { color: color.mul(alpha), alpha };
}

export interface HallFloorInputs {
  /** 卡片的倒影（已經越往下越淡）。 */
  reflection: ReflectionSample;
  /** 台緣發光環的亮度倍數（呼吸 × 拖曳反應）。 */
  glow: F;
}

/**
 * 大廳地板（T-816）：畫好的大廳（CSS 那層）本身有拋光的石地板，這裡只疊上去——台子底下淡淡的影子（台子才像站在地上）、
 * 台子周圍的青藍光與地上亮環、映出的台緣光環、卡片的倒影；其他地方完全透明（不蓋住畫好的地板）。離中心 HALL_FLOOR_FADE 之間淡掉。
 * p：地上一點（展示廳原點的 x、z，卡寬）。
 */
export function hallFloorLook(p: V2, inputs: HallFloorInputs): Look {
  const r = length(p);
  const out = max(r.sub(TIERS.at(-1)!.radius), 0);
  // 貼著台腳的影子＋往外的淡影（T-816c：淡影 0.2 → 0.1，不然把台子周圍的光與倒影壓暗）
  const shadow = exp(out.div(0.07).negate()).mul(0.42).add(exp(out.div(0.5).negate()).mul(0.1));
  const refl = inputs.reflection;
  // T-816c：台子周圍的光、映出的台緣光環、卡片倒影都調亮（FLOOR_REFLECTION）；T-816e：地上的光與加上倒影後的總和都有上限（FLOOR_LIGHT）
  const light = limitColor(linear(GLOW_COLOR).mul(floorLight(p, inputs.glow)).add(refl.color.mul(FLOOR_REFLECTION.hallCard)));
  const edge = smoothstep(HALL_FLOOR_FADE[1], HALL_FLOOR_FADE[0], r);
  const color = light.mul(edge);
  // 光的不透明度至少是它的亮度（見 maxChannel）：疊在畫好的地板上像一層光，不會被畫布合成壓掉
  const alpha = saturate(max(shadow.add(refl.alpha.mul(0.4)).mul(edge), maxChannel(color)));
  return { color, alpha };
}

// ---- 金屬圓台 ----

const METAL = '#2a3446';
const METAL_TOP = '#121826';
const RIM_LINE = '#7fe8ff';
/** 各層頂面映出卡片的強度（由上到下；最上層最清楚）。 */
const TIER_REFLECTION = [0.75, 0.5, 0.45] as const;

export interface TierInputs {
  reflection: ReflectionSample;
  glow: F;
}

/** 一層圓台（positionLocal 的 y：頂面 0、底面 −height）。頂面是拋光的深色金屬（映出卡片）、斜面有高光、側邊有一圈發光細線。 */
export function tierLook(tier: Tier, index: number, inputs: TierInputs): Look {
  const n = normalize(normalWorld);
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const r = reflect(toCamera.negate(), n);
  const env = hallEnv(r);
  const y = positionLocal.y;
  const radial = length(positionLocal.xz);

  // 朝上的程度：頂面 1、斜面約 0.7、側邊 0
  const up = n.y;
  const isTop = smoothstep(0.93, 0.99, up);
  const isBevel = smoothstep(0.25, 0.5, up).mul(float(1).sub(isTop));

  // 頂面：一圈圈很細的拉絲紋＋拋光映出卡片
  const brushed = noise2(vec2(radial.mul(140), float(index * 13.1))).mul(0.5).add(0.75);
  const topColor = linear(METAL_TOP).mul(brushed).add(env.mul(0.22));
  // 側邊：暗金屬映著展示廳，橫向細紋
  const grooves = noise2(vec2(y.mul(420), float(index * 7.3))).mul(0.25).add(0.85);
  const sideColor = linear(METAL).mul(0.35).add(env.mul(linear(METAL)).mul(2.4)).mul(grooves);
  // 斜面：亮
  const bevelColor = env.mul(0.9).add(linear(METAL).mul(0.4));

  let color: V3 = mix(mix(sideColor, bevelColor, isBevel), topColor, isTop);

  // 倒影只在頂面（上層較清楚）
  const reflGain = TIER_REFLECTION[index] ?? TIER_REFLECTION[TIER_REFLECTION.length - 1];
  const refl = inputs.reflection;
  color = color.mul(float(1).sub(refl.alpha.mul(reflGain).mul(isTop))).add(refl.color.mul(reflGain).mul(isTop));

  // 發光細線：斜面下緣一圈（側邊與斜面交界）、底部一圈較淡
  const pixel = max(fwidth(y), 0.0008);
  const lineAt = (center: number, width: number) => {
    const d = y.sub(center).div(max(pixel, width));
    return exp(d.mul(d).negate());
  };
  const notTop = float(1).sub(isTop);
  const rim = lineAt(-tier.bevel, 0.0025).mul(GALLERY_LIGHTS.rimLine).add(lineAt(-tier.height + tier.bevel * 0.6, 0.002).mul(0.35));
  color = color.add(linear(RIM_LINE).mul(rim.mul(notTop).mul(inputs.glow)));
  return { color, alpha: float(1) };
}

/** 最上層台面的細光環（T-816）：哪幾圈＋時間（虛線那圈慢慢轉；減少動態時停住）。 */
export interface TopRingInputs {
  rings: readonly TopRing[];
  time: F;
}

/**
 * 台緣的柔光（相加混色，平放在這一層頂面的高度）：p＝平面上一點（卡寬，相對中心）。
 * 斜面上一圈細亮線（約一個像素寬、太細時放寬並降亮度，不閃爍）＋往內外兩邊淡淡散開的光。
 * 最上層再加台面上的幾圈細光環（top；T-816），其中一圈是慢慢轉的虛線。
 */
export function rimHalo(p: V2, tier: Tier, glow: F, top?: TopRingInputs): Look {
  const r = length(p);
  const d = r.sub(tier.radius - tier.bevel * 0.5);
  const pixel = max(fwidth(r), 1e-4);
  const coreW = max(float(RIM_CORE), pixel.mul(0.9));
  const core = exp(d.div(coreW).pow(2).negate()).mul(float(RIM_CORE).div(coreW)).mul(GALLERY_LIGHTS.rimCore);
  const spill = exp(abs(d).div(RIM_SPILL).negate()).mul(GALLERY_LIGHTS.rimSpill);
  let a: F = core.add(spill);
  if (top) {
    const theta = atan(p.y, p.x);
    for (const ring of top.rings) {
      const w = max(float(ring.width), pixel.mul(0.9));
      let line: F = exp(r.sub(ring.radius).div(w).pow(2).negate()).mul(float(ring.width).div(w));
      if (ring.dashes > 0) {
        const s = fract(theta.add(top.time.mul(TOP_RING_SPIN)).mul(ring.dashes / TAU));
        line = line.mul(smoothstep(0, 0.06, s).mul(smoothstep(0.6, 0.5, s)).mul(0.85).add(0.15));
      }
      a = a.add(line.mul(GALLERY_LIGHTS.topRing));
    }
  }
  a = a.mul(glow);
  return { color: linear(GLOW_COLOR).mul(a), alpha: a };
}

// ---- 光柱 ----

const SHAFT_COLOR = '#9fd6ff';

/**
 * 光柱（一個網格、SHAFTS 道梯形，相加混色）：uv.x 橫跨 0～1、uv.y 由下 0 到上 1；attribute shaftGain＝這一道的亮度、shaftPhase＝起伏相位。
 * 中間亮、兩邊柔；越往上越亮、接近地板淡掉；每道各自小幅起伏；level＝整體的亮度（gallery-layout 的 shaftLevel：有畫好的大廳時淡淡一層、
 * 慢慢變亮變暗）。
 */
export function shaftLook(time: FloatUniform, period: number, level: F): Look {
  const q = uv();
  const gain = attribute<'float'>('shaftGain', 'float');
  const phase = attribute<'float'>('shaftPhase', 'float');
  const across = pow(sin(q.x.mul(Math.PI)), 2.2);
  const along = smoothstep(0, 0.35, q.y).mul(mix(float(0.45), float(1), q.y));
  const shimmer = sin(time.mul(TAU / period).add(phase)).mul(0.2).add(0.8);
  const a = across.mul(along).mul(gain).mul(shimmer).mul(GALLERY_LIGHTS.shaft).mul(level);
  return { color: linear(SHAFT_COLOR).mul(a), alpha: a };
}

// ---- 浮著的玻璃板 ----

const GLASS_COLOR = '#a9dcff';
const GLASS_EDGE = '#d9f3ff';
const HAZE_COLOR = '#18305e';

export interface FloatInputs {
  /** 縮圖的拼圖貼圖（沒有縮圖時是 1×1 的空白）。 */
  atlas: Texture;
  /** 時間（秒，減少動態效果時停住）。 */
  time: FloatUniform;
  /** 漂浮振幅（卡寬）與週期（秒）。 */
  bob: number;
  period: number;
}

/**
 * 浮著的玻璃板（T-816：一個網格、每張一個四邊形，預乘 alpha 混色）。每個頂點的 attribute：
 * atlasUv＝拼圖裡的位置、floatInfo＝(有沒有縮圖 0／1、遠近 0～1、漂浮相位、圓角半徑占寬)、cardSize＝四邊形的(寬, 高)（卡寬）。
 * 四邊形比裡面的卡片大 FLOAT_THUMB_INSET 倍；玻璃板是卡片的 FLOAT_GLASS_PAD 倍（圓角矩形）：淡淡的冷色霧面（上面亮一點）、
 * 細細的冷光邊（左上角最亮）、一道斜光；有縮圖時縮圖封在玻璃裡（拼圖已在畫布上預先模糊、預乘上傳），越遠越偏藍、越淡、邊越糊。
 * atlasNode：換縮圖清單時改它的 value（換貼圖不重建材質）。
 */
export function floatLook(inputs: FloatInputs): { position: V3; look: Look; atlasNode: TextureNode } {
  const info = attribute<'vec4'>('floatInfo', 'vec4');
  const size = attribute<'vec2'>('cardSize', 'vec2');
  const atlasUv = attribute<'vec2'>('atlasUv', 'vec2');
  const bob = sin(inputs.time.mul(TAU / inputs.period).add(info.z)).mul(inputs.bob);
  const position = positionLocal.add(vec3(0, bob, 0));

  const hasImage = info.x;
  const far = info.y;
  const opacity = float(floatOpacity(0)).sub(far.mul(floatOpacity(0) - floatOpacity(1))); // 同 floatOpacity（遠近線性）

  // 玻璃板外形：圓角矩形（四邊形中心 0）
  const q = uv().sub(0.5).mul(size);
  const half = size.mul(0.5 * (FLOAT_GLASS_PAD / FLOAT_THUMB_INSET));
  const radius = info.w.mul(half.x).mul(2);
  const dq = abs(q).sub(half).add(radius);
  const sdf = length(max(dq, 0)).add(min(max(dq.x, dq.y), 0)).sub(radius);
  const px = max(fwidth(sdf), 1e-4);
  // 越遠邊越糊（景深）
  const soft = px.add(far.mul(0.006));
  const inside = smoothstep(soft, soft.negate(), sdf);
  const rim = exp(sdf.div(max(px.mul(1.6), far.mul(0.008).add(0.0035))).pow(2).negate());

  // 玻璃：上面亮一點的霧面、左上角最亮的冷光邊、一道斜光
  const vy = q.y.div(half.y); // −1 下～1 上
  const vx = q.x.div(half.x);
  const frost = inside.mul(smoothstep(-1.2, 1, vy).mul(0.035).add(0.02));
  const sheen = inside.mul(smoothstep(0.08, 0, abs(q.x.add(q.y.mul(0.55)).sub(size.x.mul(0.12))))).mul(0.09);
  const rimGain = smoothstep(-1.4, 1.4, vy.sub(vx)).mul(0.55).add(0.35);
  const edgeA = rim.mul(rimGain).mul(float(1).sub(far.mul(0.45)));
  const glassA = frost.add(sheen).add(edgeA);
  const glassColor = linear(GLASS_COLOR).mul(frost.add(sheen)).add(linear(GLASS_EDGE).mul(edgeA));

  // 縮圖（預乘過）封在玻璃裡：往展示廳的藍霧偏
  const atlasNode = texture(inputs.atlas, atlasUv);
  const haze = far.mul(0.45).add(0.06);
  const imageA = atlasNode.a.mul(inside).mul(0.95);
  const imageColor = mix(atlasNode.rgb, linear(HAZE_COLOR).mul(atlasNode.a), haze).mul(inside).mul(0.95);

  // 玻璃疊在縮圖上面（預乘的 over）
  const withImageColor = glassColor.add(imageColor.mul(float(1).sub(glassA)));
  const withImageA = glassA.add(imageA.mul(float(1).sub(glassA)));
  const color = mix(glassColor, withImageColor, hasImage).mul(opacity);
  const a = saturate(mix(glassA, withImageA, hasImage)).mul(opacity);
  return { position, look: { color, alpha: a }, atlasNode };
}

// ---- 花瓣與散景光點 ----

const PETAL_BASE = '#ef9fbe';
const PETAL_TIP = '#ffe3ee';
const BOKEH_COLORS = ['#a8ddff', '#ffd9a6', '#ffc8df'] as const;

export interface SkyNodes {
  position: V3;
  scale: V2;
  rotation: F;
  look: Look;
}

/**
 * 一個 Sprite 一次畫完（T-816）：第 instanceIndex 個＜BOKEH_COUNT 是散景光點，其他是花瓣（減少動態時只畫前 BOKEH_COUNT 個）。
 * 花瓣：遠近（亂數的 PETAL_NEAR_BIAS 次方，多數遠、少數近）決定 z、大小、模糊與可以飄的左右範圍（gallery-layout 的 petalDepth，同一套公式）；
 * 從頂端飄落到 PETAL_BOX.bottom、左右擺、自己旋轉，翻面（橫向縮放跟著 |cos|）像在空中翻；落到底再從頂端重來（位置由編號與時間算）。
 * 形狀是淡粉色櫻花瓣：底部尖、上面寬、頂端一個 V 形缺口，底部粉一點、尖端淡一點；近的邊緣糊、淡。
 * 光點：卡片後面散開、很慢地往上飄、各自明暗閃爍的柔和圓光（冷青、暖金、淡粉三種），相加混色（不透明度 0）。
 */
export function skyNodes(time: FloatUniform): SkyNodes {
  const seed = (k: number) => hash(instanceIndex.add(k));
  const r1 = seed(0);
  const r2 = seed(4099);
  const r3 = seed(8209);
  const r4 = seed(12301);
  const r5 = seed(16411);
  const r6 = seed(20483);
  const isPetal = step(BOKEH_COUNT - 0.5, float(instanceIndex));

  // ---- 花瓣 ----
  const d = PETAL_DEPTH;
  const near = pow(r2, PETAL_NEAR_BIAS);
  const blur = smoothstep(d.blur[0], d.blur[1], near);
  const z = mix(float(d.z[0]), float(d.z[1]), near);
  const size = mix(float(d.size[0]), float(d.size[1]), near).mul(mix(float(0.8), float(1.2), r5));
  const minX = smoothstep(d.minXRamp[0], d.minXRamp[1], near).mul(d.minX);
  const maxX = mix(float(d.maxX[0]), float(d.maxX[1]), near);
  const side = r1.mul(2).sub(1);
  const baseX = sign(side).mul(mix(minX, maxX, abs(side)));
  const top = mix(float(d.top[0]), float(d.top[1]), near);
  const span = top.sub(PETAL_BOX.bottom);
  const speed = mix(float(PETAL_FALL[0]), float(PETAL_FALL[1]), r3).mul(mix(float(0.9), float(1.5), near));
  const age = fract(time.mul(speed).div(span).add(r4)); // 0～1：落到哪
  const swayPeriod = mix(float(3.2), float(5.5), r5);
  const sway = sin(time.mul(TAU).div(swayPeriod).add(r6.mul(TAU))).mul(PETAL_SWAY).mul(mix(float(1), float(1.5), near));
  const petalPos = vec3(baseX.add(sway), top.sub(age.mul(span)), z.add(sway.mul(0.3)));
  const flip = abs(cos(time.mul(mix(float(0.6), float(1.4), r1)).add(r2.mul(TAU))));
  const petalScale = vec2(size.mul(flip.mul(0.75).add(0.25)), size);
  const fade = smoothstep(0, 0.06, age).mul(smoothstep(1, 0.88, age));

  // ---- 散景光點 ----
  const b = BOKEH_BOX;
  const riseSpan = b.maxY - b.minY;
  const rise = mix(float(BOKEH_RISE[0]), float(BOKEH_RISE[1]), r4);
  const climb = fract(r3.add(time.mul(rise).div(riseSpan))); // 0～1：飄到哪
  const bokehPos = vec3(mix(float(b.minX), float(b.maxX), r1), climb.mul(riseSpan).add(b.minY), mix(float(b.minZ), float(b.maxZ), r2));
  const bokehSize = mix(float(BOKEH_SIZE[0]), float(BOKEH_SIZE[1]), pow(r5, 0.85));
  const twinkle = sin(time.mul(TAU).div(mix(float(BOKEH_TWINKLE[0]), float(BOKEH_TWINKLE[1]), r6)).add(r1.mul(TAU))).mul(0.3).add(0.7);
  const bokehFade = smoothstep(0, 0.12, climb).mul(smoothstep(1, 0.85, climb));
  const bokehTint = mix(
    mix(linear(BOKEH_COLORS[0]), linear(BOKEH_COLORS[1]), step(0.62, r6)),
    linear(BOKEH_COLORS[2]),
    step(0.86, r6),
  );

  const position = mix(bokehPos, petalPos, isPetal);
  const scale = mix(vec2(bokehSize, bokehSize), petalScale, isPetal);
  const rotation = time.mul(mix(float(-0.9), float(0.9), r6)).add(r4.mul(TAU)).mul(isPetal);

  // 每一片（每一顆）在片段著色裡要用的數字：頂點算好傳下去
  const vPetal = varying(isPetal);
  const vBlur = varying(blur);
  const vPetalStrength = varying(fade.mul(mix(float(0.92), float(0.62), blur)).mul(mix(float(0.75), float(1), r3)));
  const vBokeh = varying(bokehTint.mul(bokehFade.mul(twinkle).mul(mix(float(0.16), float(0.4), r3))));

  // 花瓣形：底部（v 0）尖、上面寬的瓣，頂端一個 V 形缺口；糊的時候邊緣放寬
  const p = uv().mul(2).sub(1);
  const edge = mix(float(0.14), float(0.8), vBlur);
  const body = length(vec2(p.x.mul(1.5).div(p.y.mul(0.4).add(0.72)), p.y));
  const shape = smoothstep(float(1), float(1).sub(edge), body);
  const notch = float(1).sub(smoothstep(edge.mul(-0.3), edge.mul(0.3).add(0.04), p.y.sub(0.66).sub(abs(p.x).mul(1.2))));
  const petalA = shape.mul(notch).mul(vPetalStrength);
  const petalRgb = mix(linear(PETAL_BASE), linear(PETAL_TIP), smoothstep(-1, 0.85, p.y));

  // 光點：柔和的圓、邊緣一圈稍亮（像相機的散景）
  const dr = length(p);
  const disc = smoothstep(1, 0.3, dr);
  const ring = exp(dr.sub(0.75).div(0.15).pow(2).negate()).mul(0.25);
  const bokehLight = vBokeh.mul(disc.mul(0.75).add(ring));

  const color = mix(bokehLight, petalRgb.mul(petalA), vPetal);
  // 光點：不透明度＝最亮的那個顏色（畫布是透明的、預乘 alpha 合成，顏色不能比不透明度大，不然疊在 CSS 遠景上會被壓掉）
  const alpha = mix(maxChannel(bokehLight), petalA, vPetal);
  return { position, scale, rotation, look: { color, alpha } };
}
