// 鐳射（全息反光）的純數學：卡片的鐳射設定 → shader 用的數值、色彩選項 → 4 個色票與色譜、反光層 → 每層要不要反光、
// 霧光的光帶、黑白遮罩、選中反光層時的斜線、卡片姿態 → 觀看方向。不 import three.js（方便在 node 測）；著色程式在 holo-nodes.ts。

import { faceFoil, holoMatte } from '../model/foil';
import { HOLO_PALETTES, type Card, type FaceSide, type Holo } from '../model/types';
import { LUM_WEIGHTS } from './blend';
import { coverUv } from './fit';
import type { Rgb } from './frame';

/** 閃星 100 時，最多有幾成的亂數格子會閃（原演算法固定 0.1；這裡讓預設閃星 30 剛好等於原演算法）。 */
export const MAX_SPARKLE_DENSITY = 1 / 3;

/** 閃星的時間相位每秒增加的弧度；shader 與匯出週期共用，保持原效果速度。 */
export const SPARKLE_PHASE_RATE = 1.8;
/** 閃星的時間週期（秒）；一圈效果時間用它的整數倍，循環接縫的相位就一致。 */
export const SPARKLE_PERIOD = 2 * Math.PI / SPARKLE_PHASE_RATE;

export interface HoloUniformValues {
  /** 原演算法的 uFoil：0＝全關（彩虹、光帶、閃星都乘上它）。 */
  foil: number;
  /** 波紋與光帶的空間頻率倍數：1＝原演算法；色帶寬度越大頻率越低。 */
  freq: number;
  /** 閃星門檻：每個格子的亂數 ≥ 門檻才會閃；1＝沒有閃星。 */
  sparkleCut: number;
  /** 霧光 0～1（T-417，holo.matte/100）；鐳射強度 0 時也是 0（兩種都關）。 */
  matte: number;
}

function clampOr(v: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/**
 * strength 0～100 → foil 0～1；bandWidth 0.1～2 → freq＝1／bandWidth（10～0.5）；
 * sparkle 0～100 → sparkleCut＝1 − sparkle/100 × MAX_SPARKLE_DENSITY（1～0.667）；
 * matte 0～100（省略＝35）→ 0～1，strength 0 時是 0（SCHEMA：強度 0＝亮面與霧光都關）。
 * 超出範圍夾回、不是數字用「關／原演算法」的值，shader 永遠拿不到 NaN。
 */
export function holoUniformValues(holo: Holo): HoloUniformValues {
  const strength = clampOr(holo.strength, 0, 100, 0);
  const bandWidth = clampOr(holo.bandWidth, 0.1, 2, 1);
  const sparkle = clampOr(holo.sparkle, 0, 100, 0);
  const matte = clampOr(holoMatte(holo), 0, 100, 0);
  return {
    foil: strength / 100,
    freq: 1 / bandWidth,
    sparkleCut: 1 - (sparkle / 100) * MAX_SPARKLE_DENSITY,
    matte: strength > 0 ? matte / 100 : 0,
  };
}

// ---- 鐳射色彩（T-310，SCHEMA §1「鐳射色彩」）----

/**
 * 色譜上 4 個色票的位置：第 1 色在 0、第 2 色在 0.35、第 3 色在 0.7、第 4 色在 1，中間線性漸變；
 * 超過 1 取小數＝回到第 1 色。位置照原演算法的粉 → 金 → 藍 → 白，所以「經典彩虹」和 T-310 以前一樣。
 * （shader 餵進來的 t 在 0～0.92，看得到的是第 1 色到第 4 色之間，第 4 色約到七成。）holo-nodes.ts 的 spectrum 同算式。
 */
export const SPECTRUM_STOPS = [0, 0.35, 0.7, 1] as const;

const HEX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

/** #rrggbb → 0～1 的 sRGB 數值（不轉線性：鐳射在 sRGB 數值上算）；不合格回 null。 */
export function hexToRgb(hex: string): Rgb | null {
  const m = typeof hex === 'string' ? HEX.exec(hex) : null;
  if (!m) return null;
  return { r: parseInt(m[1]!, 16) / 255, g: parseInt(m[2]!, 16) / 255, b: parseInt(m[3]!, 16) / 255 };
}

function toRgb4(colors: readonly unknown[]): [Rgb, Rgb, Rgb, Rgb] | null {
  if (colors.length !== 4) return null;
  const out = colors.map((c) => hexToRgb(c as string));
  return out.every((c): c is Rgb => c !== null) ? (out as [Rgb, Rgb, Rgb, Rgb]) : null;
}

/**
 * 這張卡的 4 個色票（sRGB 0～1）：自訂用卡片自己的 colors，其他用 HOLO_PALETTES。
 * 壞資料（自訂色彩不是 4 個合格顏色、選項不認得）→ 暖陽，shader 永遠拿到 4 個合格顏色。
 */
export function holoPaletteColors(holo: Pick<Holo, 'palette' | 'colors'>): [Rgb, Rgb, Rgb, Rgb] {
  const warm = toRgb4(HOLO_PALETTES.warm)!;
  if (holo.palette === 'custom') return (Array.isArray(holo.colors) && toRgb4(holo.colors)) || warm;
  const preset = Object.prototype.hasOwnProperty.call(HOLO_PALETTES, holo.palette)
    ? HOLO_PALETTES[holo.palette as keyof typeof HOLO_PALETTES]
    : null;
  return (preset && toRgb4(preset)) || warm;
}

/** 色譜上 t 的顏色（sRGB 0～1），stops＝4 個色票。和 holo-nodes.ts 的 spectrum 一一對應。 */
export function holoSpectrum(stops: readonly Rgb[], t0: number): Rgb {
  const t = t0 - Math.floor(t0);
  const [s0, s1, s2, s3] = SPECTRUM_STOPS;
  const sat = (v: number) => Math.min(1, Math.max(0, v));
  const mix = (a: Rgb, b: Rgb, k: number): Rgb => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
  const a = mix(stops[0]!, stops[1]!, sat((t - s0) / (s1 - s0)));
  const b = mix(a, stops[2]!, sat((t - s1) / (s2 - s1)));
  return mix(b, stops[3]!, sat((t - s2) / (s3 - s2)));
}

/**
 * 某一面哪些東西要套亮面鐳射、哪裡是霧光（T-417 反光層）。卡身＝沒有底圖時看得到的卡身色／素色卡背；
 * layers 順序同 layers 陣列；mask＝亮面再乘這張黑白圖的亮度（null＝不乘）；matte＝反光層沒蓋到的地方有霧光
 * （「整面」時沒有：整面都是亮面）。
 */
export interface HoloTargets {
  body: boolean;
  frame: boolean;
  layers: boolean[];
  mask: string | null;
  matte: boolean;
}

/**
 * 反光層的規則（SCHEMA §1「反光層」；T-417 以前是鐳射範圍 scope）：
 * - full 整面（預設）：所有圖層＋這一面沒有底圖時的卡身（空白卡、素色卡背也會閃）；沒有霧光。＝以前的「全卡」。
 * - layers 用圖層形狀：只有 layer.holo 為 true 的圖層（每層用自己的 alpha、跟著位移）；其他是霧光。＝以前的「指定圖層」。
 * - mask 上傳黑白圖：圖層與卡身照「整面」的規則套，再乘黑白圖的亮度（cover、置中、不跟視差）；其他是霧光。
 *   形狀是 mask 卻沒有圖（壞資料，驗證會擋）＝none。
 * - none 關：整面霧光。
 * 卡框照 foil.frame（「卡框也反光」），卡框關著時不套。圖層顯示與否不影響（隱藏的層本來就不畫）。
 * 破框層（T-411，立體層＋breakout: true）不管哪種形狀都不套（卡內也不套）：卡外本來就不畫鐳射，衝出來的角色不是卡面的箔，
 * 整層不套才不會在卡邊看到接縫；霧光也不套（card-mesh）。
 * 強度不在這裡判斷（拖滑桿時不能換材質），強度 0 由 shader 乘 0 關掉。
 */
export function holoTargets(card: Card, face: FaceSide): HoloTargets {
  const foil = faceFoil(card[face]);
  const layers = card[face].layers;
  const free = layers.map((l) => !(l.role === 'depth' && l.breakout === true));
  const hasBase = layers.some((l) => l.role === 'base');
  const frame = foil.frame && card.frame.enabled;
  switch (foil.shape) {
    case 'full':
      return { body: !hasBase, frame, layers: free, mask: null, matte: false };
    case 'layers':
      return { body: false, frame, layers: layers.map((l, i) => free[i]! && l.holo), mask: null, matte: true };
    case 'mask':
      if (foil.mask !== undefined) return { body: !hasBase, frame, layers: free, mask: foil.mask, matte: true };
      break;
    case 'none':
      break;
  }
  return { body: false, frame, layers: layers.map(() => false), mask: null, matte: true };
}

// ---- 霧光（T-417）：反光層沒蓋到的地方，沒有彩虹，只有很淡的柔和白光帶隨視角慢慢滑過 ----

/**
 * 霧光的樣子（holo-nodes.ts 的 matteSheenNode 同算式；主對話 2026-10-14 看三張範例卡定）：
 * 光帶位置 d＝表面座標 · dir＋視角 · view（表面座標同鐳射：中心 0.5、往右 +x、往下 +y，卡寬單位）；
 * 亮度＝haze＋(1 − haze) × (0.5＋0.5 cos(2π (d − center) / period))^power——一條約 0.35 卡寬的寬光帶，
 * period 比卡片大，同時只看得到一條；視角係數比鐳射光帶（1.8／0.9）小，滑得比較慢。
 * 加到畫面上的亮度（sRGB 數值，白色）＝霧光 × gain × 亮度；預設霧光 35 時最亮處約 +0.1、其他地方約 +0.015。
 */
export const MATTE_LOOK = {
  gain: 0.3,
  haze: 0.15,
  period: 1.6,
  power: 6,
  center: 0.55,
  dir: { x: 0.7, y: 0.45 },
  view: { x: 0.9, y: 0.6 },
} as const;

/** 霧光光帶的亮度（haze～1）。sx、sy＝表面座標（中心 0.5、往下 +y）；view＝觀看方向（viewDirection）。 */
export function matteSheen(sx: number, sy: number, view: Vec3): number {
  const m = MATTE_LOOK;
  const d = sx * m.dir.x + sy * m.dir.y + view.x * m.view.x + view.y * m.view.y;
  const band = Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * (d - m.center)) / m.period), m.power);
  return m.haze + (1 - m.haze) * band;
}

/** 霧光加多亮（sRGB 數值，白色）：matte01＝holoUniformValues 的 matte、sheen＝matteSheen。 */
export function matteLift(matte01: number, sheen: number): number {
  return matte01 * MATTE_LOOK.gain * sheen;
}

// ---- 反光層的黑白圖（T-417）----

/** 黑白圖這一點的反光程度（0～1）：sRGB 數值的亮度（同混合模式的 Lum 權重）× alpha。白＝亮面、黑＝霧光、透明＝霧光。 */
export function maskCoverage(r: number, g: number, b: number, a: number): number {
  return (LUM_WEIGHTS.r * r + LUM_WEIGHTS.g * g + LUM_WEIGHTS.b * b) * a;
}

/**
 * 卡面座標 (x, y)（看著那一面、卡寬單位、中心 0、+y 往上）→ 黑白圖的 uv（v 往上，同 three.js 貼圖）：
 * 照 cover 拉滿卡面（多的裁掉）、置中、不跟視差。faceW／faceH＝卡面寬高；imageW／imageH＝圖的像素寬高。
 */
export function maskUv(x: number, y: number, faceW: number, faceH: number, imageW: number, imageH: number): { u: number; v: number } {
  const c = coverUv(imageW, imageH, faceW, faceH);
  return { u: (x / faceW + 0.5) * c.scaleX + c.offsetX, v: (y / faceH + 0.5) * c.scaleY + c.offsetY };
}

// ---- 亮面／霧光的比例（T-417；T-417b 中性色不改比例）----

/** 這一點最上面的表面有幾成是亮面（foil，斜線用）、幾成是霧光（matte）。 */
export interface FoilCover {
  foil: number;
  matte: number;
}

/**
 * 由後往前疊一層之後的比例（card-mesh 同算式）：weight＝這層對表面的實際覆蓋率（blend.ts 的 surfaceWeight × alpha
 * × 顯示 × 不透明度）；foil＝這層的亮面比例（勾了反光 1、上傳黑白圖時是那一點的亮度、其他 0）；破框層兩種都不是。
 * 這層蓋住的那幾成換成這層的比例，其他照舊——中性色（weight 0）完全不改。
 */
export function coverStep(prev: FoilCover, layer: { weight: number; foil: number; breakout: boolean }): FoilCover {
  const w = Math.min(1, Math.max(0, layer.weight));
  if (w === 0) return prev;
  const matte = layer.breakout ? 0 : 1 - layer.foil;
  const foil = layer.breakout ? 0 : layer.foil;
  return { foil: prev.foil + (foil - prev.foil) * w, matte: prev.matte + (matte - prev.matte) * w };
}

// ---- 選中反光層時，卡面上亮面的地方閃一下淡淡的斜線（DESIGN「反光層」）----

/** 斜線一共閃多久（秒）。 */
export const FOIL_FLASH_SECONDS = 1;
const FLASH_IN = 0.15;
const FLASH_OUT = 0.45;

/** 選中後經過 t 秒的斜線強度 0～1：0.15 秒淡入、停一下、最後 0.45 秒淡出；範圍外（含 NaN）是 0。 */
export function foilFlashLevel(t: number): number {
  if (!(t > 0) || t >= FOIL_FLASH_SECONDS) return 0;
  if (t < FLASH_IN) return t / FLASH_IN;
  const out = FOIL_FLASH_SECONDS - t;
  return out < FLASH_OUT ? out / FLASH_OUT : 1;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const RAD = Math.PI / 180;

/**
 * 從卡片中心看向鏡頭的方向（單位向量），換到某一面自己的座標：看著那一面 +x 右、+y 上、+z 朝外（背面不鏡像）。
 * 鏡頭固定在世界座標 +z 軸上看向原點；卡片旋轉＝先 yaw 再沿螢幕水平軸 pitch（同 card-view 與 interact/parallax）。
 * 原演算法的 uView＝鏡頭位置換到卡片座標後正規化，就是這個值。
 */
export function viewDirection(face: FaceSide, yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = yawDeg * RAD;
  const pitch = pitchDeg * RAD;
  const x = -Math.cos(pitch) * Math.sin(yaw);
  const y = Math.sin(pitch);
  const z = Math.cos(pitch) * Math.cos(yaw);
  // 背面的座標＝正面繞垂直軸轉 180°：x、z 反向
  return face === 'front' ? { x, y, z } : { x: -x, y, z: -z };
}
