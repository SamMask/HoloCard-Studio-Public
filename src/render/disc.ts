// CD 光碟（T-810，SCHEMA Card.kind?、DESIGN「CD 光碟」）的尺寸、外觀常數與純數學（不 import three.js，方便在 node 測試）。
// 網格與著色在 disc-nodes.ts，算式和這裡一一對應（改一邊要改另一邊）。
//
// 尺寸照真的 CD（直徑 120 mm、孔 15、透明圈到 46、印刷面到 118；光碟寬＝1）：
//   孔 0～hole → 透明塑膠圈 hole～printInner → 印刷面 printInner～printOuter（內緣一圈細銀環）→ 透明塑膠邊 printOuter～outer。
// 光碟是正方形的圓（model 的 aspect 一律 'square'），卡面網格＝印刷面圓環（不是圓角矩形），厚度＝卡片的 0.8 倍。
//
// 背面（資料面）：銀色鏡面＋繞射彩虹（GPU Gems 第 8 章 Jos Stam 繞射著色的簡化）：
//   溝槽是同心圓 → 每一點的光柵方向＝半徑方向 r̂（溝槽方向 ĝ＝N × r̂）。L＝往光源、V＝往眼睛（單位向量），
//   H＝L＋V，H_t＝H 在卡面上的切線分量；along＝H_t·r̂、across＝H_t·ĝ。
//   - 亮的地方（扇形）：lobe＝exp(−(across／lobeWidth)²)——切線分量和 r̂ 同方向（across≈0）時亮、垂直時暗。
//     H_t 在整片光碟上差不多，所以亮的地方是一條穿過中心的線（兩道相對的扇形，角寬 ≈ lobeWidth／|H_t|）；
//     卡片一轉 H_t 跟著轉，扇形就繞著中心轉。
//   - 顏色（換色譜）：u＝grating × |along|，第 m 階的 y＝2u／m − 1，y 在 0～1 時由藍（0.25）經綠（0.5）到紅（0.75）
//     （Stam 的 blend3：每個通道一個 max(0, 1 − x²) 的小山），把 orders 階加起來。
//   - 亮度照鐳射強度（holo.strength／100）乘彩虹；白色的光痕（streak）與銀面不看強度。
//   光源固定在世界座標「頭頂偏右前」的一點（light），不跟卡片轉；視線每個像素自己算（鏡頭透視、擷取、倒影都對）。
//   沒有時間項：減少動態時照舊（隨角度變化不算動畫）。

import { CARD_THICKNESS, type FrameBox, type RoundedRect } from './fit';
import type { Rgb } from './frame';
import type { Vec3 } from './holo';

export const DISC = {
  /** 外半徑（光碟寬＝1）：直徑 120 mm。 */
  outer: 0.5,
  /** 印刷面外緣：118 mm 的一半。 */
  printOuter: 118 / 240,
  /** 印刷面內緣：46 mm 的一半（印刷面內緣一圈細銀環從這裡往外 ringWidth）。 */
  printInner: 46 / 240,
  /** 孔：15 mm 的一半。 */
  hole: 15 / 240,
  /** 厚度是卡片的幾倍。 */
  thicknessScale: 0.8,
  /** 印刷面內緣的細銀環寬度（約 1 mm）。 */
  ringWidth: 0.008,
  /** 透明圈上的堆疊環（真的 CD 在直徑約 33.5 mm 有一圈凸起）半徑。 */
  stackRing: 33.5 / 240,
} as const;

/** 光碟厚度（卡寬單位）。 */
export const DISC_THICKNESS = CARD_THICKNESS * DISC.thicknessScale;

/** 圓的分段（three.js 整圈圓弧的點數＝2 × 這個值）：卡面、卡外網格、透明塑膠用同一個，邊緣的頂點才接得上。 */
export const DISC_SEGMENTS = 48;

/**
 * 透明塑膠（孔外的透明圈、最外緣的塑膠邊、側邊）的繪製順序（three.js 的透明物件先比 renderOrder）：
 * 光碟（不透明，寫深度）→ 遠側（BackSide）→ 近側（FrontSide）→ 破框層的卡外網格（card-mesh，renderOrder 0）。
 * 破框層是從印刷面衝出來的，蓋在塑膠上面；塑膠不寫深度、要測深度（印刷面後面的部分被擋掉）。
 */
export const DISC_ORDER = { far: -2, near: -1 } as const;

/** 外觀（T-810 施工時定、在瀏覽器上看過範例光碟調的；方向照 DESIGN「CD 光碟」）。顏色都是 sRGB 數值（0～1）。 */
export const DISC_LOOK = {
  /** 資料面的光源（世界座標，固定不動）：頭頂偏右前。 */
  light: { x: 0.9, y: 1.4, z: 1.3 },
  /** 光柵密度：u＝grating × |along|（約 1.3：正對背面時兩道扇形各看得到一段色譜）。 */
  grating: 1.3,
  /** 加幾階繞射（1～orders）。 */
  orders: 3,
  /** 扇形的寬：lobe＝exp(−(across／lobeWidth)²)。 */
  lobeWidth: 0.18,
  /** 彩虹乘多少（再乘鐳射強度 0～1）。 */
  rainbowGain: 1.1,
  /** 扇形裡白色的光痕（不看鐳射強度）。 */
  streak: 0.18,
  /**
   * 銀面：tint ×（floor＋sky × g^1.5）× 環帶，g＝反射方向往上的程度（0 往下～1 往上）；加上光源的高光 gain × (N·Ĥ)^power。
   * 環帶（看得出是光碟）：有資料的地方（半徑 < dataEnd）暗一點（written）、資料面內緣一圈亮一點（mirror 寬 mirrorWidth）。
   */
  silver: { tint: [0.86, 0.88, 0.93] as const, floor: 0.4, sky: 0.38 },
  bands: { dataEnd: 0.42, edge: 0.004, written: 0.93, mirrorWidth: 0.014, mirror: 0.1 },
  spec: { gain: 0.35, power: 60 },
  /** 印刷面內緣的細銀環：base ＋ shine × max(0, 朝向觀看方向的程度)。 */
  ring: { base: [0.66, 0.68, 0.72] as const, shine: 0.32 },
  /** 光碟側面（印刷面圓環的內外緣，夾在兩面中間）：銀色，依朝向鏡頭的程度加亮。 */
  edge: [0.6, 0.62, 0.66] as const,
  /**
   * 透明塑膠（同 sleeve.ts 的做法）：正反兩面 a＝base＋菲涅耳＋反光帶＋堆疊環；側邊 a＝side＋菲涅耳；顏色略偏冷的白（線性）。
   */
  plastic: {
    color: [0.93, 0.96, 1] as const,
    base: 0.05,
    fresnel: { gain: 0.9, power: 4 },
    sheen: { strength: 0.08, dir: { x: 0.857, y: 0.514 }, center: 0.55, halfWidth: 0.05 },
    stack: { width: 0.004, alpha: 0.06 },
    side: 0.3,
  },
} as const;

/** 光碟的「卡片輪廓」（card-mesh 的 outline）：印刷面外緣的圓（圓角＝半徑的圓角正方形就是圓）。點選、破框層的卡外判斷都用它。 */
export function discOutline(): RoundedRect {
  return { halfW: DISC.printOuter, halfH: DISC.printOuter, r: DISC.printOuter };
}

/** 包住整片光碟的盒子（鏡頭距離、擷取的裁切）：寬高＝直徑、厚度＝光碟厚度。 */
export function discBox(): FrameBox {
  return { halfW: DISC.outer, halfH: DISC.outer, thickness: DISC_THICKNESS };
}

/** 點 (x, y) 到印刷面圓環邊緣的帶號距離（裡面負、外面正；孔與透明圈也算外面）。 */
export function discPrintSdf(x: number, y: number): number {
  const d = Math.hypot(x, y);
  return Math.max(d - DISC.printOuter, DISC.printInner - d);
}

// ---- 資料面的繞射彩虹（disc-nodes.ts 的 discDataMaterial 同算式）----

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  return l > 0 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
}

/** Stam 的 blend3：每個通道一個小山 max(0, 1 − x²)。 */
function bump(x: number): number {
  return Math.max(0, 1 - x * x);
}

/** 第 1～orders 階加起來的彩虹（sRGB 數值，可能超過 1）：u＝grating × |along|。 */
export function discRainbow(u: number): Rgb {
  const out = { r: 0, g: 0, b: 0 };
  for (let m = 1; m <= DISC_LOOK.orders; m++) {
    const y = (2 * u) / m - 1;
    out.r += bump(4 * (y - 0.75));
    out.g += bump(4 * (y - 0.5));
    out.b += bump(4 * (y - 0.25));
  }
  return out;
}

export interface DiscGrooveTerms {
  /** H_t 沿半徑方向的量（換色譜）。 */
  along: number;
  /** H_t 沿溝槽方向的量（扇形：0 最亮）。 */
  across: number;
  /** 扇形的亮度 0～1。 */
  lobe: number;
}

/**
 * 資料面上一點的光柵項（世界座標）：point＝那一點、normal＝那一面朝外的法線（單位向量）、radial＝半徑方向（單位向量，
 * 在卡面上）、eye＝鏡頭位置。光源用 DISC_LOOK.light。
 */
export function discGroove(point: Vec3, normal: Vec3, radial: Vec3, eye: Vec3): DiscGrooveTerms {
  const toEye = normalize(sub(eye, point));
  const toLight = normalize(sub(DISC_LOOK.light, point));
  const h = add(toLight, toEye);
  const ht = sub(h, scale(normal, dot(h, normal)));
  const along = dot(ht, radial);
  const across = dot(ht, cross(normal, radial));
  const k = across / DISC_LOOK.lobeWidth;
  return { along, across, lobe: Math.exp(-k * k) };
}

/** GLSL 的 smoothstep（edge0 < edge1）。 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 銀面的環帶倍數與加亮（r＝離中心多遠）：有資料的地方乘 written、資料面內緣一圈加 mirror。 */
export function discBands(r: number): { scale: number; lift: number } {
  const b = DISC_LOOK.bands;
  const written = 1 - (1 - b.written) * (1 - smoothstep(b.dataEnd - b.edge, b.dataEnd + b.edge, r));
  const mirror = (1 - smoothstep(DISC.printInner + b.mirrorWidth - b.edge, DISC.printInner + b.mirrorWidth + b.edge, r)) * b.mirror;
  return { scale: written, lift: mirror };
}

/**
 * 資料面一點的顏色（sRGB 數值，可能超過 1）：銀面（含環帶）＋扇形 ×（白色光痕＋彩虹 × 鐳射強度 foil 0～1 × rainbowGain）。
 * 參數同 discGroove；r＝這一點離光碟中心多遠（卡面上）。
 */
export function discDataColor(point: Vec3, normal: Vec3, radial: Vec3, eye: Vec3, foil: number, r: number): Rgb {
  const L = DISC_LOOK;
  const { along, lobe } = discGroove(point, normal, radial, eye);
  const toEye = normalize(sub(eye, point));
  const toLight = normalize(sub(L.light, point));
  // 反射方向 reflect(−V, N)：往上的程度當環境的明暗（天空亮、地面暗）
  const incident = scale(toEye, -1);
  const refl = sub(incident, scale(normal, 2 * dot(incident, normal)));
  const g = Math.min(1, Math.max(0, refl.y * 0.5 + 0.5));
  const bands = discBands(r);
  const env = (L.silver.floor + L.silver.sky * Math.pow(g, 1.5)) * bands.scale;
  const half = normalize(add(toLight, toEye));
  const spec = L.spec.gain * Math.pow(Math.max(0, dot(half, normal)), L.spec.power);
  const rainbow = discRainbow(L.grating * Math.abs(along));
  const k = Math.min(1, Math.max(0, foil)) * L.rainbowGain;
  const [tr, tg, tb] = L.silver.tint;
  const base = spec + bands.lift;
  return {
    r: tr * env + base + lobe * (L.streak + rainbow.r * k),
    g: tg * env + base + lobe * (L.streak + rainbow.g * k),
    b: tb * env + base + lobe * (L.streak + rainbow.b * k),
  };
}

const RAD = Math.PI / 180;

/** 同 card-view／pick.ts：世界 ＝ Rx(pitch) · Ry(yaw) · 卡片本地。 */
function toWorld(v: Vec3, yawDeg: number, pitchDeg: number): Vec3 {
  const cy = Math.cos(yawDeg * RAD);
  const sy = Math.sin(yawDeg * RAD);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  const cp = Math.cos(pitchDeg * RAD);
  const sp = Math.sin(pitchDeg * RAD);
  return { x: x1, y: v.y * cp - z1 * sp, z: v.y * sp + z1 * cp };
}

/**
 * 背面（資料面）上一點 (x, y)（看著背面 +x 右 +y 上，卡寬單位）在這個角度、鏡頭在 (0, 0, cameraZ) 時的光柵項與顏色。
 * 測試與 GPU 回歸頁用（找扇形的方向、比亮度）。
 */
export function discBackAt(x: number, y: number, yawDeg: number, pitchDeg: number, cameraZ: number, foil: number): DiscGrooveTerms & { color: Rgb } {
  // 背面＝本地 z −厚度/2、繞垂直軸轉 180°：看著背面的 x＝−本地 x
  const point = toWorld({ x: -x, y, z: -DISC_THICKNESS / 2 }, yawDeg, pitchDeg);
  const normal = toWorld({ x: 0, y: 0, z: -1 }, yawDeg, pitchDeg);
  const radial = normalize(toWorld({ x: -x, y, z: 0 }, yawDeg, pitchDeg));
  const eye = { x: 0, y: 0, z: cameraZ };
  return { ...discGroove(point, normal, radial, eye), color: discDataColor(point, normal, radial, eye, foil, Math.hypot(x, y)) };
}

/**
 * 背面的扇形在這個角度朝哪個方向（看著背面、+x 右 +y 上的角度，弧度，0～π；兩道扇形是 θ 與 θ＋π）：
 * 在半徑 r 的圓上每 1° 找 lobe 最亮的方向。
 */
export function discFanAngle(yawDeg: number, pitchDeg: number, cameraZ: number, r = 0.33): number {
  let best = 0;
  let bestLobe = -1;
  for (let deg = 0; deg < 360; deg++) {
    const a = deg * RAD;
    const { lobe } = discBackAt(r * Math.cos(a), r * Math.sin(a), yawDeg, pitchDeg, cameraZ, 0);
    if (lobe > bestLobe) {
      bestLobe = lobe;
      best = a;
    }
  }
  return best % Math.PI;
}
