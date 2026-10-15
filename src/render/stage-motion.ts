// 舞台特效（T-314、T-316，DESIGN §5「舞台」）的尺寸、常數與「每影格怎麼動」：純數學，不 import three.js（方便在 node 測試）。
//
// 卡片下方一座全息展示台，不跟著卡片轉：
//   - 底光：展示台圖（public/brand/pedestal.webp）鋪在卡片正下方的水平面上，上面有兩道較亮的光區繞中心慢慢轉；
//   - 外圈流光：COMET_COUNT 道彗星狀的光（頭亮、尾巴漸淡）沿著圖上最外圈的細環繞圈跑；
//   - 懸浮光環：3 圈同心環浮在底光上方，各自轉（方向、速度不同），亮度像呼吸一樣明暗，整個平面輕輕上下浮；
//   - 能量漣漪：每隔 RIPPLE_PERIOD 秒、以及翻面時（更亮），一圈細亮環從中心向外擴散、越外越淡；
//   - 星塵：少量光點從舞台往上飄、漸淡後重生（位置在著色程式裡由編號與時間算，CPU 不逐顆更新）。
// 拖曳反應：由 setPose 收到的角度變化算卡片的轉速（平滑過）→「能量」0～1：轉越快光環、底光、流光轉越快、越亮，
// 星塵拖出光跡；停手後幾秒慢慢回到平常。時間只來自影格迴圈的 dt；作業系統設了減少動態效果時整個舞台靜止。
//
// 底光為什麼不直接把圖轉起來：圖是斜看的透視圖（圖上的橢圓寬：高約 7），線條與亮點的粗細是照「斜看」畫的，
// 鋪到地上拉成正圓後，前後方向的線比左右粗約 7 倍；直接在地上轉，轉到 30°～90° 時這些粗線會跑到左右兩側，
// 變成一條條斜的、橫的拖影（T-316 用同一個鏡頭模擬過）。所以圖本身不動，改成光區在圖上繞著轉。
//
// 每影格只改 StageMotion 裡的數字（不建新物件）。座標：卡寬＝1，原點＝光環中心（在舞台平面上），+y 上、+z 朝鏡頭。

import type { FaceSide } from '../model/types';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

/** 舞台平面在卡片下緣再往下多少（卡寬）。卡片轉到斜角時下角會比這更低，但卡片一律畫在舞台之上，不會被擋。 */
export const STAGE_GAP = 0.1;

/** 舞台平面（光環中心）的高度：卡片中心是 0，比例越高的卡舞台越低。 */
export function stageY(cardH: number): number {
  return -(cardH / 2 + STAGE_GAP);
}

/** 展示台圖（T-312，1600×480、原生透明）上量到的光環位置。 */
export const PEDESTAL = {
  widthPx: 1600,
  heightPx: 480,
  /** 光環中心（像素，左上為 0）。 */
  centerXPx: 800,
  centerYPx: 228,
  /** 最外圈細環的橫向半徑（像素）。 */
  outerRadiusPx: 668,
  /** 最外圈細環在中心上方（遠）、下方（近）多少像素：圖上的橢圓稍微偏下，外圈流光沿著它跑。 */
  outerTopPx: 86,
  outerBottomPx: 94,
  /** 圖上的光環是透視壓扁的橢圓（寬：高 約 6.3～7.8）；鋪在地上時把高度拉回這個倍數，光環才是正圓、和懸浮光環同心。 */
  squash: 7,
  /** 最外圈鋪在地上的半徑（卡寬）：整座展示台約 1.6 個卡寬。 */
  radius: 0.7,
  /** 底光的不透明度倍數（比卡片低調）。 */
  strength: 0.55,
} as const;

/** 底光平面：寬、深（卡寬）、光環中心在圖上的 uv（three.js 貼圖 v 由下往上）。 */
export interface PedestalPlane {
  width: number;
  depth: number;
  centerU: number;
  centerV: number;
}

/**
 * 展示台圖鋪在地上的大小：橫向依最外圈半徑縮放；縱向（z）多乘 squash，圖上的橢圓在地上變正圓。
 * 地上一點 (x, z)（相對光環中心）取圖的 uv＝(centerU ＋ x／width, centerV − z／depth)：圖的下半部（靠近觀看者）在 +z。
 */
export function pedestalPlane(): PedestalPlane {
  const unit = PEDESTAL.radius / PEDESTAL.outerRadiusPx; // 每像素幾個卡寬（橫向）
  return {
    width: PEDESTAL.widthPx * unit,
    depth: PEDESTAL.heightPx * unit * PEDESTAL.squash,
    centerU: PEDESTAL.centerXPx / PEDESTAL.widthPx,
    centerV: 1 - PEDESTAL.centerYPx / PEDESTAL.heightPx,
  };
}

/** 外圈流光的路線（卡寬，相對光環中心、地上 x 右、z 朝鏡頭）：中心 (0, cz)、橫半徑 rx、縱半徑 rz 的橢圓（拉回地上後接近正圓）。 */
export interface RingPath {
  rx: number;
  rz: number;
  cz: number;
}

/** 圖上最外圈細環鋪到地上的位置（和 pedestalPlane 同一套換算）。 */
export function outerRingPath(): RingPath {
  const unit = PEDESTAL.radius / PEDESTAL.outerRadiusPx;
  const zUnit = unit * PEDESTAL.squash;
  return {
    rx: PEDESTAL.radius,
    rz: ((PEDESTAL.outerTopPx + PEDESTAL.outerBottomPx) / 2) * zUnit,
    cz: ((PEDESTAL.outerBottomPx - PEDESTAL.outerTopPx) / 2) * zUnit,
  };
}

/** 一圈懸浮光環。 */
export interface RingSpec {
  /** 半徑（卡寬）。 */
  radius: number;
  /** 線的半寬（卡寬；太細時著色程式會放寬到約一個像素、亮度跟著降，不會閃爍）。 */
  width: number;
  /** 沿圓周幾個亮點（整數，接縫才不會斷；0＝沒有）。 */
  dots: number;
  /** 分成幾段亮弧（整數；0＝整圈一樣亮）。 */
  arcs: number;
  /** 平常的轉速（弧度／秒；正負＝方向）。 */
  speed: number;
  /** 呼吸週期（秒）與起始相位（弧度）。 */
  breathPeriod: number;
  breathPhase: number;
}

/** 由內到外 3 圈：內圈亮點、中圈三段亮弧（反方向轉）、外圈細點，週期互不相同，看起來不會同步。轉速是 T-314 的 2 倍。 */
export const RINGS: readonly RingSpec[] = [
  { radius: 0.36, width: 0.005, dots: 6, arcs: 0, speed: 0.44, breathPeriod: 4.6, breathPhase: 0 },
  { radius: 0.53, width: 0.004, dots: 0, arcs: 3, speed: -0.3, breathPeriod: 5.8, breathPhase: 2.1 },
  { radius: 0.8, width: 0.003, dots: 14, arcs: 0, speed: 0.16, breathPeriod: 7.2, breathPhase: 4 },
];

/** 懸浮光環浮在底光上方多高（卡寬）；整個平面再上下浮動 ±RING_BOB、週期 RING_BOB_PERIOD 秒。 */
export const RING_HOVER = 0.05;
export const RING_BOB = 0.015;
export const RING_BOB_PERIOD = 4;
/** 呼吸：亮度在 BREATH_MIN～1 之間；減少動態效果時固定在 BREATH_STILL。 */
export const BREATH_MIN = 0.4;
export const BREATH_STILL = 0.8;

/** 底光的光區繞中心轉的速度（弧度／秒，48 秒一圈）；能量 1 時是 1＋PEDESTAL_SPIN_BOOST 倍。 */
export const PEDESTAL_SPIN = TAU / 48;
export const PEDESTAL_SPIN_BOOST = 1.5;

/** 外圈流光：幾道（平均分在圈上）、平常的速度（弧度／秒，5 秒一圈）；能量 1 時快 1＋COMET_SPIN_BOOST 倍、亮 1＋COMET_GLOW_BOOST 倍。 */
export const COMET_COUNT = 2;
export const COMET_SPEED = TAU / 5;
export const COMET_SPIN_BOOST = 1.5;
export const COMET_GLOW_BOOST = 1;

/** 拖曳反應：轉速（度／秒）的平滑——變快時約 SPIN_RISE 秒跟上，變慢時時間常數 SPIN_FALL 秒（停手約 2～3 秒回到平常）。 */
export const SPIN_RISE = 0.08;
export const SPIN_FALL = 0.8;
/** 轉速 → 能量：energy＝1 − e^(−轉速／SPIN_REF)。每秒轉 160° 約 0.63，拖得很快（每秒 400° 以上）接近 1。 */
export const SPIN_REF = 160;
/** 能量 1 時：光環轉速是平常的 1＋SPIN_BOOST 倍、亮度 1＋GLOW_BOOST 倍。 */
export const SPIN_BOOST = 5;
export const GLOW_BOOST = 0.9;

/** 能量漣漪：每隔幾秒一圈（開始後第一圈在 RIPPLE_FIRST 秒），每圈持續 RIPPLE_DURATION 秒，半徑由 RIPPLE_START 擴散到 RIPPLE_END。 */
export const RIPPLE_PERIOD = 5;
export const RIPPLE_FIRST = 1.5;
export const RIPPLE_DURATION = 2.4;
export const RIPPLE_START = 0.2;
export const RIPPLE_END = 0.95;
/** 漣漪最亮時的不透明度；翻面觸發的那一圈再亮 RIPPLE_FLIP_BOOST 倍。 */
export const RIPPLE_GAIN = 0.75;
export const RIPPLE_FLIP_BOOST = 1.6;
/** 細環的半寬（卡寬）：開始時 RIPPLE_WIDTH，擴散到最外時多 RIPPLE_WIDEN（環寬＝2 × 半寬，約 0.024～0.036）。 */
export const RIPPLE_WIDTH = 0.012;
export const RIPPLE_WIDEN = 0.006;
/** 細環內側拖的一點淡光：長度（半寬的幾倍）與亮度。 */
export const RIPPLE_TRAIL = 2.5;
export const RIPPLE_TRAIL_GAIN = 0.2;

/** 翻面判斷的緩衝：正面朝鏡頭的程度（cos yaw × cos pitch）要越過 ±FLIP_MARGIN 才算翻面，卡在側面時不會一直觸發。 */
export const FLIP_MARGIN = 0.1;

/** 星塵：顆數、繞中心轉的平常速度（弧度／秒）、往上飄多高（卡寬）、拖出光跡的長度（秒數 × 速度）。 */
export const DUST_COUNT = 56;
export const DUST_ORBIT = 0.12;
export const DUST_RISE = 1.25;
export const DUST_TRAIL_SEC = 0.14;

export interface StageMotion {
  /** 平滑後的轉速（度／秒）。 */
  spin: number;
  /** 拖曳反應 0～1。 */
  energy: number;
  /** 舞台自己的時間（秒）：星塵用；減少動態效果時停住。 */
  time: number;
  /** 每圈光環目前的轉角（弧度，0～2π）。 */
  ringAngles: number[];
  /** 每圈光環目前的亮度倍數（呼吸 × 拖曳反應）。 */
  ringGlow: number[];
  /** 光環平面目前往上浮多少（卡寬，±RING_BOB）。 */
  ringLift: number;
  /** 底光光區、外圈流光目前的角度（弧度，0～2π）。 */
  pedestalAngle: number;
  cometAngle: number;
  /** 外圈流光的亮度倍數（拖曳反應；減少動態效果時 0＝不畫）。 */
  cometGlow: number;
  /**
   * 星塵繞中心轉的角度（弧度）與目前的角速度（弧度／秒）。角度不繞回 0：每顆星塵的轉速倍數不同（0.7～1.3），
   * 繞回會讓光點跳位置（一天也只累積到約一萬弧度，float 精度仍夠）。
   */
  dustAngle: number;
  dustSpeed: number;
  /** 漣漪開始後幾秒（沒有漣漪＝Infinity）。 */
  rippleAge: number;
  /** 這一圈漣漪的亮度倍數：定時的 1、翻面觸發的 RIPPLE_FLIP_BOOST。 */
  rippleBoost: number;
  /** 下一次定時漣漪還有幾秒。 */
  nextRipple: number;
  /** 目前看到哪一面（還沒收到角度＝null）。 */
  facing: FaceSide | null;
  /** 上一格的角度（量轉速用）。 */
  lastYaw: number;
  lastPitch: number;
}

export function initialStageMotion(): StageMotion {
  return {
    spin: 0,
    energy: 0,
    time: 0,
    ringAngles: RINGS.map(() => 0),
    ringGlow: RINGS.map(() => BREATH_STILL),
    ringLift: 0,
    pedestalAngle: 0,
    cometAngle: 0,
    cometGlow: 1,
    dustAngle: 0,
    dustSpeed: DUST_ORBIT,
    rippleAge: Infinity,
    rippleBoost: 1,
    nextRipple: RIPPLE_FIRST,
    facing: null,
    lastYaw: NaN,
    lastPitch: NaN,
  };
}

/** 轉速 → 能量 0～1。 */
export function spinEnergy(spinDegPerSec: number): number {
  return spinDegPerSec > 0 ? 1 - Math.exp(-spinDegPerSec / SPIN_REF) : 0;
}

/** 呼吸亮度（BREATH_MIN～1）。 */
export function breath(ring: RingSpec, time: number): number {
  const wave = 0.5 + 0.5 * Math.sin((TAU * time) / ring.breathPeriod + ring.breathPhase);
  return BREATH_MIN + (1 - BREATH_MIN) * wave;
}

/**
 * 現在看到哪一面：正面法線朝鏡頭的程度＝cos yaw × cos pitch（同 holo.ts 的 viewDirection('front').z）。
 * 有上一個結果時要越過 ±FLIP_MARGIN 才換面。
 */
export function facingSide(yawDeg: number, pitchDeg: number, previous: FaceSide | null): FaceSide {
  const toward = Math.cos(yawDeg * RAD) * Math.cos(pitchDeg * RAD);
  if (previous === 'front') return toward < -FLIP_MARGIN ? 'back' : 'front';
  if (previous === 'back') return toward > FLIP_MARGIN ? 'front' : 'back';
  return toward >= 0 ? 'front' : 'back';
}

export interface RippleShape {
  /** 半徑、線寬（卡寬）。 */
  radius: number;
  width: number;
  /** 不透明度（0＝沒有漣漪）。 */
  strength: number;
}

/** 漣漪的樣子：開始後 age 秒的半徑、半寬、不透明度。一圈細亮環，越外越淡、稍微變寬。寫進 out（每影格用同一個物件）。 */
export function rippleShape(age: number, out: RippleShape = { radius: 0, width: 0, strength: 0 }): RippleShape {
  if (!(age >= 0) || age >= RIPPLE_DURATION) {
    out.radius = RIPPLE_START;
    out.width = RIPPLE_WIDTH;
    out.strength = 0;
    return out;
  }
  const s = age / RIPPLE_DURATION;
  const ease = 1 - (1 - s) ** 3; // 一開始快、後來慢
  out.radius = RIPPLE_START + (RIPPLE_END - RIPPLE_START) * ease;
  out.width = RIPPLE_WIDTH + RIPPLE_WIDEN * s;
  out.strength = RIPPLE_GAIN * Math.min(1, s / 0.08) * (1 - s) ** 2;
  return out;
}

function wrapAngle(a: number): number {
  const w = a % TAU;
  return w < 0 ? w + TAU : w;
}

/**
 * 走一格（改 m 本身，不建新物件）：yaw／pitch＝這一格卡片的角度（度）、dt＝這一格的秒數、reduced＝減少動態效果。
 * dt ≤ 0（影格迴圈的第一格）只記住角度。
 */
export function stepStageMotion(m: StageMotion, yawDeg: number, pitchDeg: number, dt: number, reduced: boolean): void {
  const first = m.facing === null;
  const facing = facingSide(yawDeg, pitchDeg, m.facing);
  const flipped = !first && facing !== m.facing;
  m.facing = facing;

  if (reduced) {
    // 靜止：光環不轉不呼吸不浮、底光不轉、沒有流光、沒有漣漪、星塵時間停住、不受拖曳影響
    m.spin = 0;
    m.energy = 0;
    m.dustSpeed = 0;
    m.rippleAge = Infinity;
    m.rippleBoost = 1;
    m.nextRipple = RIPPLE_PERIOD;
    m.ringLift = 0;
    m.cometGlow = 0;
    for (let i = 0; i < m.ringGlow.length; i++) m.ringGlow[i] = BREATH_STILL;
    m.lastYaw = yawDeg;
    m.lastPitch = pitchDeg;
    return;
  }

  if (dt > 0) {
    // 轉速：這一格轉了幾度 ÷ 秒數，再平滑（變快跟得快、變慢退得慢）
    const moved = Number.isFinite(m.lastYaw) ? Math.hypot(yawDeg - m.lastYaw, pitchDeg - m.lastPitch) : 0;
    const measured = moved / dt;
    const tau = measured > m.spin ? SPIN_RISE : SPIN_FALL;
    m.spin += (measured - m.spin) * (1 - Math.exp(-dt / tau));
    m.energy = spinEnergy(m.spin);

    m.time += dt;
    const speedUp = 1 + SPIN_BOOST * m.energy;
    const glowUp = 1 + GLOW_BOOST * m.energy;
    for (let i = 0; i < RINGS.length; i++) {
      const ring = RINGS[i]!;
      m.ringAngles[i] = wrapAngle(m.ringAngles[i]! + ring.speed * speedUp * dt);
      m.ringGlow[i] = breath(ring, m.time) * glowUp;
    }
    m.ringLift = RING_BOB * Math.sin((TAU * m.time) / RING_BOB_PERIOD);
    m.pedestalAngle = wrapAngle(m.pedestalAngle + PEDESTAL_SPIN * (1 + PEDESTAL_SPIN_BOOST * m.energy) * dt);
    m.cometAngle = wrapAngle(m.cometAngle + COMET_SPEED * (1 + COMET_SPIN_BOOST * m.energy) * dt);
    m.cometGlow = 1 + COMET_GLOW_BOOST * m.energy;
    m.dustSpeed = DUST_ORBIT * speedUp;
    m.dustAngle += m.dustSpeed * dt;
    m.rippleAge += dt;
    m.nextRipple -= dt;
  }
  // dt ≤ 0（影格迴圈的第一格）只記住角度；之後每格都記，下一格才量得到轉了多少
  if (dt > 0 || first) {
    m.lastYaw = yawDeg;
    m.lastPitch = pitchDeg;
  }

  // 漣漪：定時一圈；翻面也觸發一圈、更亮（重新計時下一次定時的）
  if (flipped || m.nextRipple <= 0) {
    m.rippleAge = 0;
    m.rippleBoost = flipped ? RIPPLE_FLIP_BOOST : 1;
    m.nextRipple = RIPPLE_PERIOD;
  }
}
