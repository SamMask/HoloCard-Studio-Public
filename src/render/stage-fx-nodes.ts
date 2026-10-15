// 舞台特效的著色程式（TSL）。尺寸、轉速、漣漪與拖曳反應的數字都在 stage-motion.ts；這裡只把 uniform 畫成光。
// 三個東西各一個 draw call：地上的底光＋外圈流光＋漣漪、懸浮光環、星塵（一個 Sprite 畫 DUST_COUNT 顆，位置由編號與時間算）。
// 輸出一律是「預乘過的顏色＋不透明度」，材質用相加混色（stage-fx.ts 的 glowMaterial）。

import {
  atan,
  cos,
  exp,
  float,
  fract,
  fwidth,
  hash,
  instanceIndex,
  length,
  max,
  mix,
  pow,
  saturate,
  sin,
  smoothstep,
  sqrt,
  texture,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node, Texture, UniformNode } from 'three/webgpu';
import {
  COMET_COUNT,
  DUST_RISE,
  DUST_TRAIL_SEC,
  PEDESTAL,
  RIPPLE_TRAIL,
  RIPPLE_TRAIL_GAIN,
  type PedestalPlane,
  type RingPath,
  type RingSpec,
} from './stage-motion';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type FloatUniform = UniformNode<'float', number>;

const TAU = Math.PI * 2;

/** 一個發光的東西：預乘過的顏色（線性）＋不透明度。 */
export interface Glow {
  color: V3;
  alpha: F;
}

/** 細線的亮度剖面：半寬 width（卡寬）；比一個像素細時放寬到約一個像素、亮度按比例降（不閃爍、總亮度不變）。 */
function softLine(d: F, width: number, pixel: F): F {
  const w = max(float(width), pixel.mul(0.8));
  const x = d.div(w);
  return exp(x.mul(x).negate()).mul(float(width).div(w));
}

// ---- 地上：展示台圖（底光＋轉動的光區）＋外圈流光＋能量漣漪 ----

/** 底光的光區：幾道（整數，繞一圈接得起來）、多集中（越大光區越窄）、最暗與最亮的倍數（平均約 1，整體亮度不變）。 */
const SWEEP_LOBES = 2;
const SWEEP_SHARPNESS = 4;
const SWEEP_BASE = 0.72;
const SWEEP_GAIN = 1;

/**
 * 外圈流光（在展示台圖的像素空間量粗細，和圖上畫的細環一樣粗）：
 * 線芯與外圍柔光的半寬（圖的像素）、頭的長度（弧度；前緣更短）、每道尾巴的長度（弧度）與亮度。
 */
const COMET_CORE_PX = 2.5;
const COMET_GLOW_PX = 10;
const COMET_HEAD = 0.06;
const COMET_LEAD = 0.025;
const COMET_TAILS = [1.7, 1.1] as const;
const COMET_GAINS = [1, 0.65] as const;
/** 尾巴從頭往後變淡的快慢（次方；越大越快淡）。 */
const COMET_TAIL_FALLOFF = 1.6;
const COMET_TAIL_LINE = 1.1;
const COMET_TAIL_GLOW = 0.35;
const COMET_HEAD_LINE = 1.3;
const COMET_HEAD_GLOW = 0.7;

export interface FloorUniforms {
  /** 底光不透明度倍數。 */
  pedestal: FloatUniform;
  /** 底光光區轉到的角度（弧度）。 */
  pedestalAngle: FloatUniform;
  rippleRadius: FloatUniform;
  rippleWidth: FloatUniform;
  rippleStrength: FloatUniform;
  /** 外圈流光：第一道的頭在哪個角度（弧度）、亮度倍數（0＝不畫）。 */
  cometAngle: FloatUniform;
  cometStrength: FloatUniform;
}

export interface FloorColors {
  ripple: V3;
  /** 流光的尾巴與頭。 */
  comet: V3;
  cometHead: V3;
}

/** p：地上一點（卡寬，相對光環中心，x 右、y＝世界的 +z 朝鏡頭）；path：外圈流光的路線（stage-motion.ts 的 outerRingPath）。 */
export function floorGlow(
  p: V2,
  pedestal: Texture,
  plane: PedestalPlane,
  path: RingPath,
  u: FloorUniforms,
  colors: FloorColors,
): Glow {
  // 底光：圖本身不動（見 stage-motion.ts 開頭為什麼不轉圖），SWEEP_LOBES 道較亮的光區繞中心轉
  const texUv = vec2(p.x.div(plane.width).add(plane.centerU), float(plane.centerV).sub(p.y.div(plane.depth)));
  const t = texture(pedestal, texUv);
  const theta = atan(p.y, p.x);
  const lobe = pow(cos(theta.sub(u.pedestalAngle).mul(SWEEP_LOBES)).mul(0.5).add(0.5), SWEEP_SHARPNESS);
  const baseA = t.a.mul(u.pedestal).mul(lobe.mul(SWEEP_GAIN).add(SWEEP_BASE));

  // 外圈流光：在圖的像素空間（圖上的細環是粗細一致的橢圓）算到細環的距離，線的粗細就和圖上畫的一樣、
  // 遠的那一側也不會變得太細太暗。角度用橢圓自己的參數角，頭在 cometAngle（＋每道平分一圈），尾巴拖在後面。
  const unit = PEDESTAL.radius / PEDESTAL.outerRadiusPx; // 每像素幾個卡寬（橫向）
  const a = path.rx / unit;
  const b = path.rz / (unit * PEDESTAL.squash);
  const img = vec2(p.x.div(unit), p.y.sub(path.cz).div(unit * PEDESTAL.squash)); // 相對細環中心（圖的像素）
  const q = vec2(img.x.div(a), img.y.div(b));
  const rn = max(length(q), 1e-4);
  const grad = length(vec2(img.x.div(a * a), img.y.div(b * b))).div(rn);
  const dPx = rn.sub(1).div(max(grad, 1e-6)); // 到細環的距離（圖的像素，外正內負）
  const pixel = fwidth(dPx);
  const core = softLine(dPx, COMET_CORE_PX, pixel);
  const halo = softLine(dPx, COMET_GLOW_PX, pixel);
  const phi = atan(q.y, q.x);
  let tails: F = float(0);
  let heads: F = float(0);
  for (let k = 0; k < COMET_COUNT; k++) {
    // 0～2π：這一點落後第 k 道的頭多少角度（頭往角度變大的方向跑）
    const behind = fract(u.cometAngle.sub(phi).div(TAU).add(k / COMET_COUNT)).mul(TAU);
    const ahead = float(TAU).sub(behind);
    const tail = pow(saturate(float(1).sub(behind.div(COMET_TAILS[k] ?? COMET_TAILS[0]))), COMET_TAIL_FALLOFF);
    const hb = behind.div(COMET_HEAD);
    const ha = ahead.div(COMET_LEAD);
    const head = exp(hb.mul(hb).negate()).add(exp(ha.mul(ha).negate()));
    const gain = COMET_GAINS[k] ?? COMET_GAINS[0];
    tails = tails.add(tail.mul(gain));
    heads = heads.add(head.mul(gain));
  }
  const tailA = core.mul(COMET_TAIL_LINE).add(halo.mul(COMET_TAIL_GLOW)).mul(tails).mul(u.cometStrength);
  const headA = core.mul(COMET_HEAD_LINE).add(halo.mul(COMET_HEAD_GLOW)).mul(heads).mul(u.cometStrength);

  // 漣漪：半徑 rippleRadius 的一圈細亮環，內側拖一點點淡光；寬度與亮度隨時間變，見 stage-motion.ts 的 rippleShape
  const r = length(p);
  const w = max(u.rippleWidth, fwidth(r).mul(0.8));
  const d = r.sub(u.rippleRadius);
  const x = d.div(w);
  const front = exp(x.mul(x).negate());
  const trail = saturate(x.negate()).mul(exp(d.div(w.mul(RIPPLE_TRAIL)))).mul(RIPPLE_TRAIL_GAIN);
  const rippleA = front.add(trail).mul(u.rippleStrength);

  return {
    color: t.rgb
      .mul(baseA)
      .add(colors.ripple.mul(rippleA))
      .add(colors.comet.mul(tailA))
      .add(colors.cometHead.mul(headA)),
    alpha: baseA.add(rippleA).add(tailA).add(headA),
  };
}

// ---- 懸浮光環 ----

export interface RingUniforms {
  /** 每圈目前的轉角（弧度）。 */
  angles: readonly FloatUniform[];
  /** 每圈目前的亮度倍數（呼吸 × 拖曳反應）。 */
  glow: readonly FloatUniform[];
}

/** 線本身的亮度、外圍柔光的寬度（線寬的幾倍）與亮度、亮點的尖銳度與亮度。 */
const RING_LINE = 0.7;
const RING_HALO_WIDTH = 7;
const RING_HALO = 0.16;
const DOT_SHARPNESS = 60;
const DOT_WIDTH = 4;
const DOT_GAIN = 1.1;
/** 分段亮弧：暗的那段剩幾成。 */
const ARC_FLOOR = 0.15;

/** p：光環平面上一點（卡寬，相對中心）。 */
export function ringGlow(p: V2, rings: readonly RingSpec[], u: RingUniforms, lineColor: V3, dotColor: V3): Glow {
  const r = length(p);
  const theta = atan(p.y, p.x);
  const pixel = fwidth(r);
  let color: V3 = vec3(0, 0, 0);
  let alpha: F = float(0);
  rings.forEach((ring, i) => {
    const d = r.sub(ring.radius);
    const angle = theta.sub(u.angles[i]!);
    // 亮弧與亮點都用整數倍的 cos：繞一圈接得起來，轉角繞回 2π 也看不出來
    const body: F = ring.arcs > 0 ? mix(float(ARC_FLOOR), float(1), smoothstep(-0.2, 0.4, cos(angle.mul(ring.arcs)))) : float(1);
    const line = softLine(d, ring.width, pixel).mul(RING_LINE).add(softLine(d, ring.width * RING_HALO_WIDTH, pixel).mul(RING_HALO));
    const lineA = line.mul(body).mul(u.glow[i]!);
    color = color.add(lineColor.mul(lineA));
    alpha = alpha.add(lineA);
    if (ring.dots > 0) {
      const dotA = pow(max(cos(angle.mul(ring.dots)), 0), DOT_SHARPNESS)
        .mul(softLine(d, ring.width * DOT_WIDTH, pixel))
        .mul(DOT_GAIN)
        .mul(u.glow[i]!);
      color = color.add(dotColor.mul(dotA));
      alpha = alpha.add(dotA);
    }
  });
  return { color, alpha };
}

// ---- 星塵 ----

export interface DustUniforms {
  /** 舞台時間（秒）。 */
  time: FloatUniform;
  /** 繞中心轉的角度（弧度）與角速度（弧度／秒）。 */
  angle: FloatUniform;
  speed: FloatUniform;
  /** 拖曳反應 0～1：越大光跡越長。 */
  energy: FloatUniform;
}

/** 每顆星塵的一生（秒）、出生的半徑範圍（卡寬，往上飄時往內收 DUST_CONVERGE）、大小（卡寬）、亮度。 */
const DUST_LIFE = [6, 11] as const;
const DUST_RADIUS = [0.25, 0.85] as const;
const DUST_CONVERGE = 0.3;
const DUST_SIZE = [0.013, 0.026] as const;
const DUST_GAIN = 0.75;

export interface DustNodes {
  /** Sprite 的中心（舞台座標）、大小（寬＝光點、高＝沿速度拉長）、旋轉（讓長邊順著速度）。 */
  position: V3;
  scale: V2;
  rotation: F;
  /** 片段著色：預乘過的顏色＋不透明度。 */
  glow: Glow;
}

/**
 * 第 instanceIndex 顆星塵：出生在舞台上某個半徑、繞中心轉、往上飄 DUST_RISE 後淡掉再從底下重生。
 * 光跡：沿畫面上的速度方向（繞圈的橫向速度＋往上）拉長，長度＝速度 × DUST_TRAIL_SEC × 能量；拉長時亮度按比例降。
 */
export function dustNodes(u: DustUniforms, color: V3): DustNodes {
  const seed = (k: number) => hash(instanceIndex.add(k));
  const r1 = seed(0);
  const r2 = seed(7919);
  const r3 = seed(15887);
  const r4 = seed(23873);
  const r5 = seed(31991);

  const life = mix(float(DUST_LIFE[0]), float(DUST_LIFE[1]), r3);
  const age = fract(u.time.div(life).add(r4)); // 0～1：一生走到哪
  const radius = mix(float(DUST_RADIUS[0]), float(DUST_RADIUS[1]), sqrt(r2)).mul(float(1).sub(age.mul(DUST_CONVERGE)));
  const orbit = mix(float(0.7), float(1.3), r5);
  const angle = r1.mul(TAU).add(u.angle.mul(orbit));
  const position = vec3(cos(angle).mul(radius), age.mul(DUST_RISE).add(0.02), sin(angle).mul(radius));

  // 畫面上的速度（鏡頭在 +z 看向原點：橫向≈世界 x、直向＝世界 y）
  const vx = sin(angle).negate().mul(radius).mul(u.speed).mul(orbit);
  const vy = float(DUST_RISE).div(life);
  const size = mix(float(DUST_SIZE[0]), float(DUST_SIZE[1]), fract(r1.mul(13.7)));
  const stretched = size.add(length(vec2(vx, vy)).mul(DUST_TRAIL_SEC).mul(u.energy));
  const rotation = atan(vy, vx).sub(Math.PI / 2);

  const fade = smoothstep(0, 0.12, age).mul(pow(float(1).sub(age), 1.5));
  const strength = varying(fade.mul(mix(float(0.45), float(1), r2)).mul(size.div(stretched)).mul(DUST_GAIN));

  // 圓形柔光點（拉長時跟著變成細長的光跡）
  const q = uv().mul(2).sub(1);
  const shape = pow(saturate(float(1).sub(length(q))), 2);
  const alpha = shape.mul(strength);
  return { position, scale: vec2(size, stretched), rotation, glow: { color: color.mul(alpha), alpha } };
}
