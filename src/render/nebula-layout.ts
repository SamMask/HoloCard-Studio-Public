// 舞台主題「星雲」（T-415，DESIGN §5「舞台」）的尺寸、位置與「每影格怎麼動」：純數學，不 import three.js（方便在 node 測試）。
//
// 卡片後方與下方一個緩慢旋轉的星雲漩渦：
//   - 漩渦是一個「看不見的斜盤面」：在卡片後面、往後倒 NEBULA_DISC.tiltDeg 度（上半往遠處、下半從卡片下方往前伸），
//     再在畫面上斜一點（rollDeg）。盤面上畫對數螺旋的極光色帶（紫、藍、青、少量粉，程序化雜訊），中心（卡片正後面）是暗的；
//     實際上只有最遠的一片大平面（背景）——每個像素自己算視線打到盤面的哪裡（一個 draw call，沒有真的斜平面要排序）；
//   - 卡片下方一圈若隱若現的光暈：同一個背景平面，算視線打到卡片下方水平面的哪裡；
//   - 很多細小星點：一個網格、每顆一個小方塊（鏡頭只會前後移動、不會轉，方塊永遠正對鏡頭），在卡片後面（z < 0）。
// 卡片永遠最亮、最清楚：星雲最亮也只有 NEBULA_GAIN；卡片周圍一圈（nebulaCardMask）再壓暗，卡片的邊才分得清楚。
// 時間沿用 stage-motion.ts（減少動態效果時停住：漩渦不轉、星星不閃）；轉卡越快漩渦轉得稍微快一點。
//
// 星雲加強（T-817，DESIGN §5「星雲加強」）：
//   - 漩渦換成畫好的大圖（public/stages/nebula.webp，正上方俯視、中心在正中）：鋪在另一個斜盤面（NEBULA_SWIRL）上，
//     圖繞中心很慢地轉（NEBULA_SPIN，約 120 秒一圈）；大圖還沒讀好、讀不到時照 T-415 的程式漩渦（NEBULA_DISC）畫；
//   - 上面疊 NEBULA_FILAMENTS 條程式畫的細絲旋臂：各在自己的斜盤面（深度不同＝前後層次）、各自的速度慢轉；
//   - 星點變多、少數金色（NEBULA_STARS.gold），各自不同步閃；
//   - 卡片下方的光暈多一圈細光環（NEBULA_HALO_RING），亮一點，轉卡越快越亮（nebulaHaloGlow）。
//
// 座標：卡寬＝1；星雲整組的原點＝卡片中心（不跟著比例移動），+y 上、+z 朝鏡頭。光暈的高度跟著比例（nebulaHaloY）。

import { roundedRectSdf } from './fit';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

/** 背景平面：在多遠（z）、多大（卡寬）。鏡頭最遠約在 z＝12、最寬的預覽區寬高比約 2.4，都蓋得滿。 */
export const NEBULA_BACKDROP = { z: -16, width: 96, height: 56 } as const;

/**
 * 漩渦的斜盤面：中心（卡片後面一點、稍微偏低偏右，不在正中間）、往後倒幾度、在畫面上斜幾度、半徑、
 * 中心暗的範圍（core）、螺旋繞得多緊（twist）、幾條旋臂。
 */
export const NEBULA_DISC = {
  center: { x: 0.12, y: -0.3, z: -2.6 },
  tiltDeg: 60,
  rollDeg: -16,
  radius: 7.5,
  core: 1.05,
  twist: 2.3,
  arms: 2,
} as const;

function smoothstep(e0: number, e1: number, x: number): number {
  const s = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return s * s * (3 - 2 * s);
}

/** 盤面上離中心 r（盤面座標）的地方漩渦多亮（0～1）：中心暗（core 以內）、外緣淡掉。著色程式用同一個公式。 */
export function nebulaEnvelope(r: number): number {
  const D = NEBULA_DISC;
  return smoothstep(D.core * 0.7, D.core * 2, r) * (1 - smoothstep(D.radius * 0.45, D.radius, r));
}

/** 漩渦（大圖）的轉速（弧度／秒，約 120 秒一圈，T-817）；能量 1 時 1＋NEBULA_SPIN_BOOST 倍。細絲各乘自己的 speed。 */
export const NEBULA_SPIN = TAU / 120;
export const NEBULA_SPIN_BOOST = 2;

/** 星雲最亮的不透明度（相加混色）：比卡片暗很多。 */
export const NEBULA_GAIN = 0.42;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 斜盤面的中心、法線、盤面上的兩個軸（u 右、v 上；三個都是單位向量、互相垂直）。 */
export interface DiscFrame {
  center: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

/** 一個斜盤面怎麼擺：中心、往後倒幾度、在畫面上斜幾度。 */
export interface DiscSpec {
  readonly center: Readonly<Vec3>;
  readonly tiltDeg: number;
  readonly rollDeg: number;
}

/** 先往後倒 tilt（繞 x 軸：上緣往遠處），再在畫面上轉 roll（繞 z 軸）。 */
export function discFrame(spec: DiscSpec): DiscFrame {
  const t = spec.tiltDeg * RAD;
  const r = spec.rollDeg * RAD;
  const roll = (p: Vec3): Vec3 => ({ x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r), z: p.z });
  return {
    center: { ...spec.center },
    u: roll({ x: 1, y: 0, z: 0 }),
    v: roll({ x: 0, y: Math.cos(t), z: -Math.sin(t) }),
    normal: roll({ x: 0, y: Math.sin(t), z: Math.cos(t) }),
  };
}

/** T-415 程式漩渦的盤面（大圖還沒讀好、讀不到時用）。 */
export function nebulaDisc(): DiscFrame {
  return discFrame(NEBULA_DISC);
}

// ---- 畫好的漩渦大圖（T-817） ----

/**
 * 大圖鋪在哪個斜盤面：比 T-415 的盤面更遠、更大（從預設鏡頭看，旋臂繞過卡片後面、下緣從卡片下方往前伸，暗心在卡片正後面）。
 * radius＝圖的半邊長（盤面單位：圖正中＝盤面中心、四邊＝±radius）；圖從 fade × radius 開始淡到 radius（圖轉起來時方形的四角不會露出來）；
 * core＝中心再壓暗的範圍（盤面單位，smoothstep 由 core[0] 到 core[1]）；gain＝最亮的倍數；contrast＝顏色先取幾次方（中間調壓暗、亮的旋臂留著）。
 */
export const NEBULA_SWIRL = {
  center: { x: 0.3, y: 0.2, z: -6 },
  tiltDeg: 62,
  rollDeg: -12,
  radius: 7.5,
  fade: 0.82,
  core: [0.3, 1.4] as const,
  gain: 0.85,
  contrast: 1.3,
} as const;

export function nebulaSwirlDisc(): DiscFrame {
  return discFrame(NEBULA_SWIRL);
}

/**
 * 盤面座標 (dx, dy)（u 右、v 上）在大圖上的 uv（three.js 貼圖：v 由下往上）；圖繞中心轉了 spin（從鏡頭看順時針）。
 * 圖上本來在角度 θ 的點，轉了之後在 θ − spin：所以取樣時把盤面上的點逆時針轉回 spin。著色程式用同一個公式。
 */
export function nebulaSwirlUv(dx: number, dy: number, spin: number): { u: number; v: number } {
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  const x = dx * c - dy * s;
  const y = dx * s + dy * c;
  return { u: 0.5 + x / (2 * NEBULA_SWIRL.radius), v: 0.5 + y / (2 * NEBULA_SWIRL.radius) };
}

/**
 * 程式畫的細絲旋臂（T-817）：每條在自己的斜盤面上（中心深度不同：近的粗、快，遠的細、慢＝前後層次），
 * 對數螺旋（θ ＝ ψ ＋ twist × ln r：往外逆時針繞，和大圖同一個方向），arms 條、細線半寬 width（盤面單位）＋旁邊一圈淡光（glow），
 * 用雜訊（三層）扭一點（warp）、斷成一段一段（不是一整圈）；只在 inner～outer 的半徑之間；speed＝轉速是大圖的幾倍。
 */
export interface NebulaFilament extends DiscSpec {
  readonly twist: number;
  readonly arms: number;
  readonly width: number;
  readonly glow: number;
  readonly gain: number;
  readonly warp: number;
  readonly offset: number;
  readonly inner: readonly [number, number];
  readonly outer: readonly [number, number];
  readonly speed: number;
}

export const NEBULA_FILAMENTS: readonly NebulaFilament[] = [
  // 和大圖同一個盤面：淡青藍，兩條
  {
    center: { x: 0.3, y: 0.2, z: -6 },
    tiltDeg: 62,
    rollDeg: -12,
    twist: 1.6,
    arms: 2,
    width: 0.035,
    glow: 0.12,
    gain: 0.9,
    warp: 1.2,
    offset: 0,
    inner: [1.2, 2.5],
    outer: [4.5, 7],
    speed: 1.5,
  },
  // 近的那層（卡片後面一點、下緣從卡片下方往前伸）：淡紫，一條，轉得最快
  {
    center: { x: 0.25, y: -0.2, z: -3.6 },
    tiltDeg: 66,
    rollDeg: -18,
    twist: 1.4,
    arms: 1,
    width: 0.03,
    glow: 0.12,
    gain: 0.8,
    warp: 1.2,
    offset: 1,
    inner: [1.5, 2.6],
    outer: [3.6, 5.5],
    speed: 2.2,
  },
  // 遠的那層：藍，兩條，轉得最慢
  {
    center: { x: 0.4, y: 0.5, z: -9 },
    tiltDeg: 58,
    rollDeg: -8,
    twist: 1.8,
    arms: 2,
    width: 0.05,
    glow: 0.1,
    gain: 0.6,
    warp: 1.2,
    offset: 2,
    inner: [2, 3.5],
    outer: [6, 9],
    speed: 0.7,
  },
];

/** 卡片周圍壓暗：卡片範圍裡剩 MASK.floor，離卡片邊 MASK.outer 卡寬以外完全不壓。 */
export const NEBULA_MASK = { floor: 0.18, inner: -0.08, outer: 0.5, corner: 0.08 } as const;

/** 卡片平面（z＝0）上一點 (x, y) 的壓暗倍數（0～1；卡片中心是 0、卡片高＝這個比例的高）。著色程式用同一個公式。 */
export function nebulaCardMask(x: number, y: number, cardH: number): number {
  const d = roundedRectSdf(x, y, { halfW: 0.5, halfH: cardH / 2, r: NEBULA_MASK.corner });
  return NEBULA_MASK.floor + (1 - NEBULA_MASK.floor) * smoothstep(NEBULA_MASK.inner, NEBULA_MASK.outer, d);
}

/**
 * 卡片下方的光暈：在卡片下緣再往下 gap 的水平面上，半徑、半寬（卡寬）、最亮、呼吸週期（秒）與最暗倍數；
 * boost＝轉卡最快（能量 1）時再亮幾倍（T-817：亮一點、轉卡越快越亮）。
 */
export const NEBULA_HALO = { gap: 0.12, radius: 0.66, width: 0.045, gain: 0.22, breath: 7, breathMin: 0.5, boost: 0.9 } as const;

/** 光暈外面多的一圈細光環（T-817）：同一個水平面、同一個呼吸與轉卡變亮；半徑、半寬（卡寬）、最亮。 */
export const NEBULA_HALO_RING = { radius: 0.9, width: 0.014, gain: 0.22 } as const;

export function nebulaHaloY(cardH: number): number {
  return -(cardH / 2 + NEBULA_HALO.gap);
}

/** 光暈的亮度倍數（若隱若現）；減少動態效果時時間停住，就停在那裡。 */
export function haloBreath(time: number): number {
  const wave = 0.5 + 0.5 * Math.sin((TAU * time) / NEBULA_HALO.breath);
  return NEBULA_HALO.breathMin + (1 - NEBULA_HALO.breathMin) * wave;
}

/** 光暈與細光環的亮度倍數（T-817）：呼吸 × 轉卡越快越亮（能量 0～1，超出夾住）。減少動態效果時能量 0、時間停住。 */
export function nebulaHaloGlow(time: number, energy: number): number {
  const e = Math.min(1, Math.max(0, Number.isFinite(energy) ? energy : 0));
  return haloBreath(time) * (1 + NEBULA_HALO.boost * e);
}

// ---- 星點 ----

/**
 * 星點：顆數、在多遠（z 範圍，都在卡片後面）、怎麼撒——在「參考鏡頭距離 refDistance 看出去的方向」上平均撒
 * （橫向斜率 ±spanX、縱向 ±spanY），所以不管在哪個深度，畫面上都是均勻的；大小（卡寬）、閃爍速度（弧度／秒）；
 * 金色、淡紫粉各佔幾成（其餘藍白；T-817：少數金色）。
 */
export const NEBULA_STARS = {
  count: 960,
  near: -5,
  far: -13,
  refDistance: 7,
  spanX: 0.66,
  spanY: 0.3,
  size: [0.035, 0.13] as const,
  twinkle: [0.6, 2.2] as const,
  gold: 0.12,
  pink: 0.08,
} as const;

export type StarTint = 0 | 1 | 2;

export interface NebulaStar {
  x: number;
  y: number;
  z: number;
  /** 方塊的邊長（卡寬）。 */
  size: number;
  /** 亮度 0～1（大多數暗、少數亮）。 */
  brightness: number;
  /** 閃爍的相位（弧度）與速度（弧度／秒）。 */
  phase: number;
  rate: number;
  /** 0＝藍白、1＝淡金、2＝淡紫粉。 */
  tint: StarTint;
}

/** 固定種子的亂數（每次產生一樣的星空）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nebulaStars(count: number = NEBULA_STARS.count, seed = 0x415c): NebulaStar[] {
  const S = NEBULA_STARS;
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const u = rand() * 2 - 1;
    const v = rand() * 2 - 1;
    const z = S.near + (S.far - S.near) * rand();
    const reach = S.refDistance - z;
    const small = rand() ** 3; // 大多數很小
    const bright = rand();
    const tintRoll = rand();
    return {
      x: u * S.spanX * reach,
      y: v * S.spanY * reach,
      z,
      size: S.size[0] + (S.size[1] - S.size[0]) * small,
      brightness: 0.3 + 0.7 * bright ** 2,
      phase: rand() * TAU,
      rate: S.twinkle[0] + (S.twinkle[1] - S.twinkle[0]) * rand(),
      tint: tintRoll < S.gold ? 1 : tintRoll < S.gold + S.pink ? 2 : 0,
    };
  });
}

// ---- 每格 ----

export interface NebulaMotion {
  /** 漩渦（大圖）目前轉到的角度（弧度，0～2π）。 */
  spin: number;
  /** 每條細絲旋臂目前轉到的角度（弧度，0～2π；順序同 NEBULA_FILAMENTS）。 */
  arms: number[];
}

export function initialNebulaMotion(): NebulaMotion {
  return { spin: 0, arms: NEBULA_FILAMENTS.map(() => 0) };
}

const wrapAngle = (a: number) => {
  const next = a % TAU;
  return next < 0 ? next + TAU : next;
};

/** 走一格：大圖與每條細絲各照自己的速度轉；轉卡越快一起轉快一點；減少動態效果時都不轉。只改數字，不建物件。 */
export function stepNebula(m: NebulaMotion, energy: number, dt: number, reduced: boolean): void {
  if (reduced || !(dt > 0)) return;
  const step = NEBULA_SPIN * (1 + NEBULA_SPIN_BOOST * energy) * dt;
  m.spin = wrapAngle(m.spin + step);
  for (let i = 0; i < m.arms.length; i++) m.arms[i] = wrapAngle(m.arms[i]! + step * NEBULA_FILAMENTS[i]!.speed);
}
