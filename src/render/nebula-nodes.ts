// 星雲（T-415、T-817）的著色程式（TSL）。盤面、光暈、壓暗與星點的數字在 nebula-layout.ts；這裡只把 uniform 畫成光。
// 兩個 draw call：最遠的背景平面（漩渦、細絲、卡片下方的光暈與細光環、淡淡的星際霧都在同一個片段著色程式裡）、星點（一個網格，每顆一個小方塊）。
// 輸出一律是「預乘過的顏色＋不透明度」，材質用相加混色（nebula-fx.ts）。
//
// 背景平面怎麼畫出「在卡片後面、往下繞到卡片下方」的漩渦：每個像素從鏡頭拉一條視線到背景平面上的自己，
// 算這條線先打到斜盤面的哪一點（要在鏡頭與背景之間），在那一點的盤面座標畫螺旋；光暈同理打到卡片下方的水平面。
//
// 背景平面有兩種（nebula-fx 換材質，同一個網格、draw call 不變）：
//   - nebulaBackdrop：T-415 的程式漩渦（三層雜訊畫極光色帶＋星際霧）。畫好的大圖還沒讀好、讀不到時用；
//   - nebulaSwirlBackdrop（T-817）：畫好的漩渦大圖（盤面座標繞中心轉 spin 後取樣，有 mipmap）＋NEBULA_FILAMENTS 條細絲旋臂
//     （各自的斜盤面與轉角，每條一次三層雜訊）。沒有星際霧（大圖本身就是雲氣）。
// 兩種的光暈、細光環、卡片周圍壓暗、far（T-814 有自己的背景圖時遠景讓出來）都同一套，所以 far＝0 時兩種畫出來一模一樣。

import type { Node, Texture, UniformNode } from 'three/webgpu';
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
  fwidth,
  length,
  log,
  max,
  min,
  mix,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { fbm, linear } from './gallery-nodes';
import {
  discFrame,
  NEBULA_DISC,
  NEBULA_FILAMENTS,
  NEBULA_GAIN,
  NEBULA_HALO,
  NEBULA_HALO_RING,
  NEBULA_MASK,
  NEBULA_SWIRL,
  nebulaDisc,
  nebulaSwirlDisc,
  type DiscFrame,
  type NebulaFilament,
  type Vec3,
} from './nebula-layout';
import type { StageLook } from './stage-material';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type FloatUniform = UniformNode<'float', number>;

const PURPLE = '#6a3fd6';
const BLUE = '#2d5fe0';
const CYAN = '#30c6ea';
const PINK = '#e05cb6';
const HAZE = '#1d1850';
const HALO = '#b9d4ff';
/** 細絲旋臂的顏色（順序同 NEBULA_FILAMENTS：同盤面淡青藍、近的淡紫、遠的藍）。 */
const FILAMENT_TINTS = ['#96cdff', '#cda0ff', '#78aaff'] as const;

/** 寬的色帶、色帶裡順著螺旋的細紋（幾條、多深）、細亮的絲、星際霧、光暈中間那一片的亮度。 */
const RIBBON_SHARPNESS = 2.2;
const STRIAE = 11;
const STRIAE_DEPTH = 0.5;
const FILAMENT_SHARPNESS = 14;
const FILAMENT_GAIN = 0.55;
const HAZE_GAIN = 0.07;
const HALO_FILL = 0.05;
const TAU = Math.PI * 2;

export interface NebulaUniforms {
  /** 漩渦（大圖）轉到的角度（弧度）。 */
  spin: FloatUniform;
  /** 光暈所在水平面的世界高度（卡片下緣再往下）。 */
  haloY: FloatUniform;
  /** 光暈與細光環的亮度倍數（若隱若現 × 轉卡越快越亮）。 */
  halo: FloatUniform;
  /** 卡片的半高（卡寬）：卡片周圍壓暗用。 */
  cardHalfH: FloatUniform;
  /**
   * 遠景要不要畫（T-814）：1＝漩渦（大圖、細絲）與星際霧照畫（× 1，畫面和以前一模一樣）；0＝有舞台背景圖，遠景讓給它（CSS 那層），
   * 只剩卡片下方的光暈與細光環（前景）。星點另外一個 draw call，照舊。沒給＝一律畫（nebula-fx 一定給）。
   */
  far?: FloatUniform;
  /** 每條細絲旋臂轉到的角度（T-817，順序同 NEBULA_FILAMENTS；只有畫大圖的那種用到）。沒給＝都不轉。 */
  arms?: readonly FloatUniform[];
}

const v3 = (p: Vec3) => vec3(p.x, p.y, p.z);

/** 視線（鏡頭 cam → 背景上這一點，t＝1 在背景上）打到斜盤面的哪裡：盤面座標 (dx, dy) 與「交點在鏡頭與背景之間」（0／1）。 */
function discHit(cam: V3, ray: V3, frame: DiscFrame): { dx: F; dy: F; on: F } {
  const n = v3(frame.normal);
  const denom = dot(ray, n);
  const safeDenom = mix(float(-1e-4), float(1e-4), step(0, denom)).add(denom);
  const t = dot(v3(frame.center).sub(cam), n).div(safeDenom);
  const rel = cam.add(ray.mul(t)).sub(v3(frame.center));
  return { dx: dot(rel, v3(frame.u)), dy: dot(rel, v3(frame.v)), on: step(0, t).mul(step(t, 1)) };
}

/** 卡片周圍壓暗（同 nebula-layout.ts 的 nebulaCardMask）：視線打到卡片平面（z＝0）的位置。 */
function cardMask(cam: V3, ray: V3, cardHalfH: FloatUniform): F {
  const t0 = cam.z.negate().div(min(ray.z, -1e-4));
  const p0 = cam.add(ray.mul(t0));
  const corner = NEBULA_MASK.corner;
  const qx = abs(p0.x).sub(0.5 - corner);
  const qy = abs(p0.y).sub(cardHalfH.sub(corner));
  const sdf = length(max(vec2(qx, qy), 0)).add(min(max(qx, qy), 0)).sub(corner);
  return mix(float(NEBULA_MASK.floor), float(1), smoothstep(NEBULA_MASK.inner, NEBULA_MASK.outer, sdf));
}

/** 卡片下方的光暈＋外面一圈細光環（T-817）：視線打到卡片下方水平面的哪裡；回傳不透明度（顏色＝HALO × 它）。 */
function haloRings(cam: V3, ray: V3, u: NebulaUniforms): F {
  const th = u.haloY.sub(cam.y).div(min(ray.y, -1e-4));
  const below = step(ray.y, -1e-4).mul(step(th, 1));
  const hit = cam.add(ray.mul(th));
  const rr = length(vec2(hit.x, hit.z));
  const pixel = max(fwidth(rr), 1e-5);
  // 一圈細環：半寬不小於約一個像素（太細時放寬、亮度按比例降，不閃）
  const ring = (radius: number, width: number, gain: number): F => {
    const w = max(float(width), pixel.mul(0.8));
    const d = rr.sub(radius).div(w);
    return exp(d.mul(d).negate()).mul(float(width).div(w)).mul(gain);
  };
  return ring(NEBULA_HALO.radius, NEBULA_HALO.width, NEBULA_HALO.gain)
    .add(ring(NEBULA_HALO_RING.radius, NEBULA_HALO_RING.width, NEBULA_HALO_RING.gain))
    .add(exp(rr.div(0.5).pow(2).negate()).mul(HALO_FILL))
    .mul(u.halo)
    .mul(below);
}

/** 背景平面上的一個片段（世界座標）：T-415 的程式漩渦＋光暈＋星際霧（大圖還沒讀好、讀不到時用）。 */
export function nebulaBackdrop(u: NebulaUniforms): StageLook {
  const cam = cameraPosition;
  const ray = positionWorld.sub(cam); // 從鏡頭到背景上這一點（t＝1 在背景上）

  // ---- 漩渦：視線打到斜盤面的哪裡 ----
  const { dx, dy, on: onDisc } = discHit(cam, ray, nebulaDisc());
  const r = length(vec2(dx, dy));
  // 對數螺旋：轉角＋twist × ln(半徑)，整個圖案隨 spin 轉
  const swirl = atan(dy, dx).sub(u.spin).add(log(max(r, 0.05).div(NEBULA_DISC.core)).mul(NEBULA_DISC.twist));
  const q = vec2(cos(swirl), sin(swirl)).mul(sqrt(r).mul(1.5)); // 繞一圈接得起來的雜訊座標
  const n1 = fbm(q.add(3.1));
  const n2 = fbm(q.mul(1.9).add(vec2(7.3, 1.7)));
  const n3 = fbm(q.mul(0.7).add(vec2(11.2, 4.4)));
  const band = cos(swirl.mul(NEBULA_DISC.arms).add(n1.mul(2.6))).mul(0.5).add(0.5);
  // 色帶裡一條條順著螺旋的細紋（像薄薄的極光絲，不是一團均勻的霧）
  const striae = pow(cos(swirl.mul(STRIAE).add(n1.mul(4.5)).add(n2.mul(3))).mul(0.5).add(0.5), 2);
  const ribbons = pow(band, RIBBON_SHARPNESS)
    .mul(n2.mul(0.8).add(0.35))
    .mul(striae.mul(STRIAE_DEPTH).add(1 - STRIAE_DEPTH));
  const filaments = pow(band, FILAMENT_SHARPNESS).mul(FILAMENT_GAIN);
  // 同 nebula-layout.ts 的 nebulaEnvelope：中心暗、外緣淡掉
  const radial = smoothstep(NEBULA_DISC.core * 0.7, NEBULA_DISC.core * 2, r).mul(
    float(1).sub(smoothstep(NEBULA_DISC.radius * 0.45, NEBULA_DISC.radius, r)),
  );

  const mask = cardMask(cam, ray, u.cardHalfH);

  const swirlA = ribbons.add(filaments).mul(radial).mul(onDisc).mul(mask).mul(NEBULA_GAIN).mul(u.far ?? 1);
  let swirlColor: V3 = mix(linear(PURPLE), linear(BLUE), saturate(n1.mul(1.4).sub(0.2)));
  swirlColor = mix(swirlColor, linear(CYAN), smoothstep(0.55, 0.85, n2).mul(0.85));
  swirlColor = mix(swirlColor, linear(PINK), smoothstep(0.52, 0.76, n3).mul(0.75));

  // ---- 星際霧：整片天空淡淡的紫藍雲氣 ----
  const hazeA = pow(fbm(positionLocal.xy.mul(0.11).add(vec2(5.3, 2.1))), 2).mul(HAZE_GAIN).mul(u.far ?? 1);

  // ---- 卡片下方的光暈與細光環 ----
  const ringA = haloRings(cam, ray, u);

  const color = swirlColor.mul(swirlA).add(linear(HAZE).mul(hazeA)).add(linear(HALO).mul(ringA));
  return { color, alpha: swirlA.add(hazeA).add(ringA) };
}

/**
 * 一條細絲旋臂（T-817）的不透明度：視線打到它自己的斜盤面，對數螺旋 θ ＝ ψ ＋ twist × ln r（往外逆時針繞、整條隨 angle 順時針轉），
 * 離最近那條臂的距離（盤面單位）畫成細線（半寬不小於約一個像素）＋旁邊一圈淡光；一次三層雜訊：把線扭一點、斷成一段一段。
 */
function filament(cam: V3, ray: V3, f: NebulaFilament, angle: F, seed: number): F {
  const { dx, dy, on } = discHit(cam, ray, discFrame(f));
  const r = length(vec2(dx, dy));
  const psi = atan(dy, dx).add(angle).sub(log(max(r, 0.05)).mul(f.twist));
  const nz = fbm(vec2(cos(psi), sin(psi)).mul(sqrt(r).mul(1.5)).add(vec2(3.1 + seed * 5, seed * 2)));
  const phase = psi.add(f.offset).add(nz.sub(0.5).mul(f.warp)).mul(f.arms);
  const wrapped = phase.sub(floor(phase.div(TAU).add(0.5)).mul(TAU)); // −π～π：離最近那條臂多遠（相位）
  const d = wrapped.div(f.arms).mul(r).div(Math.sqrt(1 + f.twist * f.twist)); // 換成盤面上的距離
  const w = max(float(f.width), max(fwidth(d), 1e-5).mul(0.9));
  const line = exp(d.div(w).pow(2).negate())
    .mul(float(f.width).div(w))
    .add(exp(d.div(f.width * 6).pow(2).negate()).mul(f.glow));
  const segments = smoothstep(0.35, 0.65, nz);
  const band = smoothstep(f.inner[0], f.inner[1], r).mul(float(1).sub(smoothstep(f.outer[0], f.outer[1], r)));
  return line.mul(segments).mul(band).mul(on).mul(f.gain);
}

/**
 * 背景平面上的一個片段（T-817）：畫好的漩渦大圖（swirl，sRGB、有 mipmap；盤面座標繞中心轉 spin 後取樣，同 nebula-layout.ts 的 nebulaSwirlUv）
 * ＋細絲旋臂＋光暈與細光環。大圖的中心與卡片周圍壓暗；圖的方形四角淡掉（轉起來不露邊）。
 */
export function nebulaSwirlBackdrop(u: NebulaUniforms, swirl: Texture): StageLook {
  const cam = cameraPosition;
  const ray = positionWorld.sub(cam);
  const mask = cardMask(cam, ray, u.cardHalfH);
  const far: F = u.far ?? float(1);
  const S = NEBULA_SWIRL;

  // ---- 大圖 ----
  const { dx, dy, on } = discHit(cam, ray, nebulaSwirlDisc());
  const r = length(vec2(dx, dy));
  const c = cos(u.spin);
  const s = sin(u.spin);
  const st = vec2(dx.mul(c).sub(dy.mul(s)), dx.mul(s).add(dy.mul(c)))
    .div(2 * S.radius)
    .add(0.5);
  const image = pow(texture(swirl, st).rgb, vec3(S.contrast));
  const imageA = float(1)
    .sub(smoothstep(S.radius * S.fade, S.radius, r))
    .mul(smoothstep(S.core[0], S.core[1], r))
    .mul(on)
    .mul(mask)
    .mul(S.gain)
    .mul(far);
  const imageColor = image.mul(imageA);
  // 大圖當作光：亮的地方蓋住後面的 CSS 底色多一點、暗的地方幾乎不蓋（不透明度＝顏色最亮的分量）
  let alpha: F = max(max(imageColor.x, imageColor.y), imageColor.z);
  let color: V3 = imageColor;

  // ---- 細絲旋臂 ----
  NEBULA_FILAMENTS.forEach((f, i) => {
    const a = filament(cam, ray, f, u.arms?.[i] ?? float(0), i).mul(mask).mul(far);
    color = color.add(linear(FILAMENT_TINTS[i % FILAMENT_TINTS.length]!).mul(a));
    alpha = alpha.add(a);
  });

  // ---- 卡片下方的光暈與細光環 ----
  const ringA = haloRings(cam, ray, u);
  return { color: color.add(linear(HALO).mul(ringA)), alpha: alpha.add(ringA) };
}

// ---- 星點 ----

const STAR_GAIN = 1.4;
/** 星星的芯（方塊的幾成；太小時放寬到約一個像素、亮度按比例降）、外圍的柔光。 */
const STAR_CORE = 0.3;
const STAR_GLOW = 0.6;
const STAR_GLOW_GAIN = 0.25;
/** 一閃一閃（T-817）：最暗剩幾成；亮起來的那一下有多尖（次方越大，暗的時間越長、亮的那一下越短）。 */
const TWINKLE_FLOOR = 0.25;
const TWINKLE_SHARP = 2;

/**
 * 星點網格（每顆一個方塊）：attribute starInfo＝(亮度、閃爍相位、閃爍速度、顏色 0／1／2)。
 * 中間一個小亮點＋淡淡柔光，各自照自己的相位與速度一閃一閃（時間停住就不閃）。
 */
export function starLook(time: FloatUniform): StageLook {
  const info = attribute<'vec4'>('starInfo', 'vec4');
  const q = uv().mul(2).sub(1);
  const d = length(q);
  const sigma = max(float(STAR_CORE), fwidth(d).mul(1.2));
  const core = exp(d.div(sigma).pow(2).negate()).mul(float(STAR_CORE).div(sigma).pow(2));
  const glow = exp(d.div(STAR_GLOW).pow(2).negate()).mul(STAR_GLOW_GAIN);
  const wave = sin(time.mul(info.z).add(info.y)).mul(0.5).add(0.5);
  const twinkle = pow(wave, TWINKLE_SHARP).mul(1 - TWINKLE_FLOOR).add(TWINKLE_FLOOR);
  const a: F = core.add(glow).mul(info.x).mul(twinkle).mul(STAR_GAIN);
  const tint = mix(
    mix(linear('#dfe9ff'), linear('#ffe3a8'), step(0.5, info.w)),
    linear('#f0c4ff'),
    step(1.5, info.w),
  );
  return { color: tint.mul(a), alpha: a };
}
