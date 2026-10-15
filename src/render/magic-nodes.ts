// 魔法陣（T-415）的著色程式（TSL）。尺寸、轉速與亮度的數字在 magic-layout.ts；這裡只把 uniform 畫成光。
// 兩個 draw call：地上的陣（一個平面，環、星形、符紋、細點、菱形、底光全在同一個片段著色程式裡算）、往上飄的光點（一個 Sprite）。
// 輸出一律是「預乘過的顏色＋不透明度」，材質用相加混色（magic-fx.ts）。
//
// 符紋是程式畫的幾何小零件（菱形、小圓、成對的點、短弧、短橫線），每格由格子編號的亂數挑哪幾個零件——
// 只有這些零件、沒有直的長筆畫交叉，拼不出任何文字或字母。

import type { Node, UniformNode } from 'three/webgpu';
import {
  abs,
  atan,
  cos,
  exp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  instanceIndex,
  length,
  max,
  mix,
  mod,
  pow,
  saturate,
  sin,
  smoothstep,
  sqrt,
  step,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { linear } from './gallery-nodes';
import {
  GLYPH_BAND,
  GLYPH_LINE,
  glyphBandCenter,
  glyphCellLength,
  MAGIC_DIAMONDS,
  MAGIC_DOTS,
  MAGIC_RINGS,
  MAGIC_STARS,
  MOTE_LIFE,
  MOTE_RADIUS,
  MOTE_RISE,
  MOTE_SIZE,
  starEdgeAngles,
  starEdgeDistance,
  type MagicGroup,
  type MagicTint,
} from './magic-layout';
import type { StageLook } from './stage-material';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type FloatUniform = UniformNode<'float', number>;

const TAU = Math.PI * 2;

const CYAN = '#58d6ff';
const GOLD = '#ffd88a';
const SPARK = '#e9fbff';
const POOL = '#2f8fe0';

/** 線本身、外圍柔光（線寬的幾倍、多亮）、星形、符紋、細點的亮度。 */
const RING_LINE = 1.1;
const RING_HALO_WIDTH = 7;
const RING_HALO = 0.16;
const STAR_LINE = 0.95;
const GLYPH_GAIN = 1.1;
const DOT_GAIN = 1;
/**
 * 線比一個像素細時亮度怎麼降：width／w 的這個次方（1＝總亮度不變；越小越不會變暗）。陣是斜著看的，
 * 前後兩邊的線被壓得很細，照總亮度不變會暗到看不見；鏡頭不動、圓環轉起來也不變，稍微不守恆不會閃。
 */
const THIN_KEEP = 0.5;
/** 地上的柔光：中間一片、最外圈往外散一點。 */
const POOL_GAIN = 0.14;
const POOL_RADIUS = 0.62;
const RIM_SPILL = 0.06;
const RIM_SPILL_REACH = 0.08;

export interface MagicUniforms {
  /** 內圈、外圈目前的轉角（弧度）。 */
  inner: FloatUniform;
  outer: FloatUniform;
  /** 亮度倍數（呼吸 × 拖曳反應）。 */
  glow: FloatUniform;
  /** 舞台時間（秒，減少動態效果時停住）：符紋一閃一閃。 */
  time: FloatUniform;
}

/** 細線的亮度剖面：半寬 width；比一個像素細時放寬到約一個像素、亮度跟著降一些（THIN_KEEP，不閃爍）。 */
function line(d: F, width: number, pixel: F): F {
  const w = max(float(width), pixel.mul(0.8));
  const x = d.div(w);
  return exp(x.mul(x).negate()).mul(pow(float(width).div(w), THIN_KEEP));
}

/** 繞一圈平分成 count 份，這一點離最近那一份的中心：沿圓周的距離（在半徑 radius 上量）、所在的格子編號。 */
function fold(angle: F, count: number, radius: number): { along: F; cell: F } {
  const a = fract(angle.div(TAU)).mul(count);
  // 編號繞回 0（最後一格的後半和第 0 格是同一格，符紋的亂數才接得起來）
  return { along: fract(a.add(0.5)).sub(0.5).mul((TAU * radius) / count), cell: mod(floor(a.add(0.5)), count) };
}

/**
 * 一格符紋（s＝沿圓周、t＝沿半徑，相對格子中心，卡寬）：中心一個菱形／小圓／成對的點（亂數挑一個），
 * 兩側可能各一個點、外側或內側一道短弧、另一側一條短橫線；亮度由格子編號決定的相位慢慢閃。
 */
function glyph(s: F, t: F, cell: F, time: FloatUniform): F {
  const h = (k: number) => hash(cell.add(k * 97 + 13));
  const h1 = h(0);
  const h2 = h(1);
  const h3 = h(2);
  const h4 = h(3);
  const h5 = h(4);
  const pixel = max(length(vec2(fwidth(s), fwidth(t))), 1e-5);
  const stroke = (d: F) => line(d, GLYPH_LINE, pixel);

  // 中心：菱形外框（半對角線 0.025 沿圓周、0.032 沿半徑）／小圓／沿半徑成對的兩個點
  const diamond = stroke(abs(abs(s).div(0.025).add(abs(t).div(0.032)).sub(1)).mul(0.0197));
  const ring = stroke(abs(length(vec2(s, t)).sub(0.021)));
  const pair = line(length(vec2(s, abs(t).sub(0.016))), 0.0068, pixel);
  const isDiamond = step(h1, 0.4);
  const isRing = step(0.4, h1).mul(step(h1, 0.75));
  const isPair = step(0.75, h1);
  const core = diamond.mul(isDiamond).add(ring.mul(isRing)).add(pair.mul(isPair));

  // 兩側的點
  const sideDots = line(length(vec2(abs(s).sub(0.054), t)), 0.006, pixel).mul(step(0.45, h2));

  // 短弧：中心偏一點的圓，只留朝外（或朝內）的那一半
  const side = step(0.5, h3).mul(2).sub(1); // +1 朝外、−1 朝內
  const cy = side.mul(-0.0075);
  const arcD = abs(length(vec2(s, t.sub(cy))).sub(0.037));
  const arc = stroke(arcD).mul(smoothstep(0.005, 0.015, t.sub(cy).mul(side))).mul(step(0.3, h4));

  // 另一側一條短橫線（沿圓周）
  const tick = stroke(length(vec2(max(abs(s).sub(0.014), 0), t.add(side.mul(0.046))))).mul(step(0.55, h5));

  const shimmer = sin(time.mul(1.1).add(h1.mul(TAU))).mul(0.3).add(0.7);
  return core.add(sideDots).add(arc).add(tick).mul(shimmer);
}

/** p：地上一點（卡寬，相對陣的中心；x 右、y＝世界的 +z 朝鏡頭）。 */
export function magicCircle(p: V2, u: MagicUniforms): StageLook {
  const r = length(p);
  const theta = atan(p.y, p.x);
  const angleOf = (g: MagicGroup) => theta.sub(g === 'inner' ? u.inner : u.outer);
  const tintOf = (t: MagicTint) => linear(t === 'gold' ? GOLD : CYAN);
  const pixelR = max(fwidth(r), 1e-5);

  let color: V3 = vec3(0, 0, 0);
  let alpha: F = float(0);
  const add = (tint: V3, a: F) => {
    color = color.add(tint.mul(a));
    alpha = alpha.add(a);
  };

  // ---- 同心細環（有些沿圓周分段明暗，轉起來看得出在轉） ----
  for (const ring of MAGIC_RINGS) {
    const d = r.sub(ring.radius);
    const body: F =
      ring.segments > 0 ? mix(float(0.45), float(1), smoothstep(-0.3, 0.6, cos(angleOf(ring.group).mul(ring.segments)))) : float(1);
    const a = line(d, ring.width, pixelR).mul(RING_LINE).add(line(d, ring.width * RING_HALO_WIDTH, pixelR).mul(RING_HALO)).mul(body);
    add(tintOf(ring.tint), a);
  }

  // ---- 星形多邊形：每條邊是一條直線（離中心 starEdgeDistance），只畫在外接圓裡面；頂點一個小光點 ----
  for (const star of MAGIC_STARS) {
    const angle = angleOf(star.group);
    const d0 = starEdgeDistance(star);
    const inside = smoothstep(star.radius + 0.004, star.radius - 0.004, r);
    let edges: F = float(0);
    for (const phi of starEdgeAngles(star)) {
      const d = abs(r.mul(cos(angle.sub(phi))).sub(d0));
      edges = edges.add(line(d, star.width, max(fwidth(d), 1e-5)));
    }
    add(tintOf(star.tint), edges.mul(inside).mul(STAR_LINE));
    const v = fold(angle.sub(star.phase), star.points, star.radius);
    const tip = line(length(vec2(v.along, r.sub(star.radius))), 0.009, pixelR).mul(DOT_GAIN);
    add(linear(SPARK), tip);
  }

  // ---- 符紋帶（跟著外圈轉） ----
  const outer = angleOf('outer');
  const band = fold(outer.add(Math.PI / GLYPH_BAND.cells), GLYPH_BAND.cells, glyphBandCenter()); // 格子中心錯開半格
  const t = r.sub(glyphBandCenter());
  const inBand = smoothstep(0.088, 0.072, abs(t));
  const marks = glyph(band.along, t, band.cell, u.time).mul(inBand).mul(GLYPH_GAIN);
  // 格與格之間一個小點
  const gap = line(length(vec2(abs(band.along).sub(glyphCellLength() / 2), t)), 0.005, pixelR).mul(0.8);
  add(mix(tintOf('cyan'), linear(SPARK), 0.35), marks.add(gap));

  // ---- 外圈細點、淡金菱形標記（跟著外圈轉） ----
  const dots = fold(outer, MAGIC_DOTS.count, MAGIC_DOTS.radius);
  add(linear(SPARK), line(length(vec2(dots.along, r.sub(MAGIC_DOTS.radius))), MAGIC_DOTS.size, pixelR).mul(DOT_GAIN));
  const dia = fold(outer.add(Math.PI / MAGIC_DIAMONDS.count), MAGIC_DIAMONDS.count, MAGIC_DIAMONDS.radius);
  const dq = abs(dia.along).div(MAGIC_DIAMONDS.along).add(abs(r.sub(MAGIC_DIAMONDS.radius)).div(MAGIC_DIAMONDS.across));
  const diaPixel = max(fwidth(dq), 1e-4);
  const diaFill = smoothstep(float(1).add(diaPixel), float(1).sub(diaPixel), dq).mul(0.32);
  const diaEdge = exp(dq.sub(1).div(max(diaPixel, 0.09)).pow(2).negate()).mul(0.9);
  add(tintOf('gold'), diaFill.add(diaEdge));

  // ---- 地上的柔光（不轉） ----
  const pool = exp(r.div(POOL_RADIUS).pow(2).negate()).mul(POOL_GAIN);
  const spill = exp(abs(r.sub(MAGIC_RINGS[MAGIC_RINGS.length - 1]!.radius)).div(RIM_SPILL_REACH).negate()).mul(RIM_SPILL);
  add(linear(POOL), pool.add(spill));

  return { color: color.mul(u.glow), alpha: alpha.mul(u.glow) };
}

// ---- 往上飄的光點 ----

export interface MoteUniforms {
  time: FloatUniform;
  /** 拖曳反應 0～1：越大越亮。 */
  energy: FloatUniform;
}

export interface MoteNodes {
  /** Sprite 的中心（魔法陣座標）、大小。 */
  position: V3;
  scale: V2;
  look: StageLook;
}

/** 第 instanceIndex 顆光點：出生在陣上某個半徑、慢慢往上飄 MOTE_RISE、漸淡後從底下重生（位置由編號與時間算）；多數青藍、少數淡金。 */
export function moteNodes(u: MoteUniforms): MoteNodes {
  const seed = (k: number) => hash(instanceIndex.add(k));
  const r1 = seed(0);
  const r2 = seed(4111);
  const r3 = seed(8221);
  const r4 = seed(12343);
  const r5 = seed(16477);

  const life = mix(float(MOTE_LIFE[0]), float(MOTE_LIFE[1]), r3);
  const age = fract(u.time.div(life).add(r4));
  const radius = mix(float(MOTE_RADIUS[0]), float(MOTE_RADIUS[1]), sqrt(r2));
  const angle = r1.mul(TAU).add(u.time.mul(r5.sub(0.5).mul(0.12)));
  const position = vec3(cos(angle).mul(radius), age.mul(MOTE_RISE).add(0.02), sin(angle).mul(radius));
  const size = mix(float(MOTE_SIZE[0]), float(MOTE_SIZE[1]), r5);

  const fade = smoothstep(0, 0.15, age).mul(pow(float(1).sub(age), 1.3));
  const strength = varying(fade.mul(mix(float(0.5), float(1), r2)).mul(u.energy.mul(0.6).add(1)).mul(0.85));
  const tint = varying(mix(linear('#bff3ff'), linear('#ffe2a0'), step(0.72, r3)));

  const q = uv().mul(2).sub(1);
  const shape = pow(saturate(float(1).sub(length(q))), 2);
  const a = shape.mul(strength);
  return { position, scale: vec2(size, size), look: { color: tint.mul(a), alpha: a } };
}
