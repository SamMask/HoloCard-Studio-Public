// 舞台主題「水鏡」（T-415，DESIGN §5「舞台」）的尺寸、位置與「每影格怎麼動」：純數學，不 import three.js（方便在 node 測試）。
//
// 卡片下方一片很平靜的深色水面（月光般的冷色）：
//   - 映出卡片的倒影（共用的 reflection.ts，跟著卡片轉；比展示廳的拋光石地板映得遠、淡得慢）；
//   - 倒影有細細的橫向波紋扭曲（取樣位置左右偏一點），越往下（離卡片越遠的倒影）波紋越明顯；
//   - 一圈圈淡淡的漣漪從卡片正下方往外擴散（WATER_RIPPLE.count 圈錯開，同時看得到幾圈），經過的地方倒影也跟著晃一下；
//   - 水面遠處淡進預覽區的夜色底（CSS）。
// 時間沿用 stage-motion.ts（減少動態效果時停住：漣漪和波紋都停在當下）；轉卡越快漣漪稍微亮一點。
//
// 取景：鏡頭永遠在卡片中心的高度往前看，水面在卡片下方，倒影在更下面——只在水鏡把鏡頭往後退 WATER_PULLBACK 倍，
// 預設縮放下看得到倒影靠水面的那一段（再往下要用滾輪縮小才看得到全部）。全息光環、魔法陣、星雲、關閉不影響取景。
//
// 座標：卡寬＝1；水鏡整組的原點＝水面上卡片正下方那一點（在卡片下緣再往下 WATER_GAP），+y 上、+z 朝鏡頭。
//
// 水面樣子（T-825，卡片的 view.waterLook；DESIGN §5「水面樣子」）：六個 0～100 的滑桿換算成畫面的數字都在這裡（最下面一段）。
// 〔夜色〕（省略 waterLook）＝T-825 以前：波紋 1 倍、WATER_GAP、鏡頭在卡片中間高度、沒有霧、清楚鏡面、沒有閃光。

import { DEFAULT_WATER_LOOK } from '../model/limits';
import type { WaterLook } from '../model/types';
import { PREVIEW_DIM_LINEAR } from './backdrop';
import { boundingRadius, cardBox } from './fit';

/** 卡片下緣到水面的距離（卡寬）：卡片像浮在水面上一點點（〔卡片高度〕30＝這個，T-825）。 */
export const WATER_GAP = 0.06;

/** 水面的高度：卡片中心是 0；cardH＝卡高（aspectHeight）；gap＝卡片下緣到水面（T-825 的〔卡片高度〕，見 waterGap；省略＝WATER_GAP）。 */
export function waterY(cardH: number, gap: number = WATER_GAP): number {
  return -(cardH / 2 + gap);
}

/** 只在水鏡把鏡頭往後退多少倍（倒影才看得到）。 */
export const WATER_PULLBACK = 1.3;

/**
 * 給 fit.ts cameraDistance 的 reach：上下要放得下「卡片外接球半徑 × WATER_PULLBACK」（倒影在卡片下面，只缺上下的空間）；
 * 左右照舊（外接球半徑＝不多退）。寬的預覽區鏡頭剛好退 WATER_PULLBACK 倍；窄的本來上下就有空，退得少或不退。
 */
export function waterReach(cardH: number): { x: number; y: number } {
  const r = boundingRadius(cardBox(cardH));
  return { x: r, y: r * WATER_PULLBACK };
}

/** 水面網格：左右寬、往鏡頭延伸多遠、往遠處延伸多遠（卡寬）。鏡頭最遠約在 z＝12，水面要伸到鏡頭下面。 */
export const WATER_SIZE = { width: 40, near: 14, far: 26 } as const;

/**
 * 遠景（T-814 舞台背景圖；T-815 的三種遠景也走這裡）：一片直立的平面，在卡片後面 distance 卡寬（水面裡面，
 * 水面伸得比它遠、左右也比它寬），下緣貼水平線、左右鋪滿畫面、上緣到畫面頂再多 margin。
 * 倒影的鏡頭看得到它（reflection.ts 的 BACKDROP_LAYER），所以水裡映得出遠景、跟著波紋晃。
 */
export const WATER_BACKDROP = { distance: 10, margin: 0.04 } as const;

/**
 * 遠景平面的大小與位置（水鏡整組的座標：原點在水面上卡片正下方）：鏡頭在 (0, cameraY, cameraZ) 往 −z 看（不轉）、垂直視角 vFovDeg、
 * 畫面寬高比 aspect、畫面往上下平移 shift（NDC，T-825 地平線的 lens shift；省略＝0）；水面的世界高度 planeY（< 0）。
 * 回 z（平面所在的深度）、寬、高（下緣在水面 y＝0）。
 * 每影格照鏡頭重算（縮放、取景、預覽區大小、地平線變了都跟著），所以永遠蓋滿水平線以上。
 */
export function waterBackdropPlane(
  cameraZ: number,
  vFovDeg: number,
  aspect: number,
  planeY: number,
  cameraY = 0,
  shift = 0,
): { z: number; width: number; height: number } {
  const d = cameraZ + WATER_BACKDROP.distance;
  const halfH = d * Math.tan(((vFovDeg / 2) * Math.PI) / 180);
  const grow = 1 + WATER_BACKDROP.margin;
  const width = 2 * halfH * aspect * grow;
  // 畫面上緣在這個深度的世界高度（T-825 地平線：鏡頭往下移 cameraY、畫面往下平移 shift〔NDC〕）；沒有平移時＝halfH（和以前逐位元相同）
  const top = halfH * (1 - shift) + cameraY;
  const height = top * grow - planeY;
  return { z: -WATER_BACKDROP.distance, width, height };
}
/**
 * 三種遠景（T-815：湖光山峰、水墨山、富士山，public/stages/water-*.webp）畫在遠景平面上的亮度（sRGB 值的倍數）。
 * 圖本身已經是暗藍夜色（平均亮度約 12%，下緣的霧接近 #0b1630）；月亮與雪峰最亮，壓一點讓卡片永遠比遠景亮。
 * 自己的背景圖（T-814）照預覽區 CSS 那層的約 85%（PREVIEW_DIM）。
 */
export const WATER_SCENE_DIM = 0.85;

/** 遠景平面現在畫的是哪一種：自己的背景圖（T-814）或三種遠景之一（T-815）。 */
export type WaterFarKind = 'backdrop' | 'scene';

/**
 * 水鏡的遠景用哪張：自己的背景圖優先（遠景被取代、卡片的 waterScene 照存），沒有才用這張卡選的遠景；都沒有＝null（和 T-814 以前一樣）。
 * 型別不限（water-fx 傳 StageBackdrop），所以這裡不 import three.js。
 */
export function waterFar<T>(backdrop: T | null, scene: T | null): { source: T; kind: WaterFarKind } | null {
  if (backdrop) return { source: backdrop, kind: 'backdrop' };
  if (scene) return { source: scene, kind: 'scene' };
  return null;
}

/** 遠景平面乘的亮度（線性空間：sRGB 值 × d ≈ 線性值 × d^2.2）。 */
export function waterFarDim(kind: WaterFarKind): number {
  return kind === 'backdrop' ? PREVIEW_DIM_LINEAR : Math.pow(WATER_SCENE_DIM, 2.2);
}

/** 水面離鏡頭（水平距離）多遠開始淡、多遠完全淡進夜色。 */
export const WATER_FADE = [9, 24] as const;

/** 倒影：多亮（水面比鏡子暗一點）、淡出的距離（映出的高度每多這麼多卡寬剩 1/e；展示廳的石地板是 0.42）、柔化。 */
export const WATER_REFLECTION = {
  gain: 0.82,
  fade: 2.2,
  soften: { base: 0.0012, perHeight: 0.0045 },
} as const;

/**
 * 細波紋：倒影取樣位置左右偏移的振幅（螢幕 uv）——貼著卡片的地方 near，水面離卡片（往鏡頭）reach 卡寬以外 far；
 * 兩道波長的正弦（沿 z 的頻率，弧度／卡寬）各自慢慢流動（弧度／秒）。
 */
export const WAVELETS = {
  near: 0.0008,
  far: 0.0045,
  reach: 2.6,
  frequency: [34, 57] as const,
  speed: [1.3, -0.9] as const,
} as const;

/** 水面上這一點（z＝往鏡頭多遠，卡寬）的波紋振幅：越往鏡頭（映出卡片越高、越下面的倒影）越大。 */
export function waveletAmplitude(z: number): number {
  const s = Math.min(1, Math.max(0, z / WAVELETS.reach));
  return WAVELETS.near + (WAVELETS.far - WAVELETS.near) * s;
}

/**
 * 漣漪：count 圈錯開（每 period ÷ count 秒冒一圈），每圈花 period 秒從 start 擴散到 end（卡寬，水面上的半徑），
 * 一開始快、後來慢；細環的半寬由 width[0] 變到 width[1]；不透明度最亮 gain，越外越淡。
 * 扭曲：經過的地方倒影的取樣位置上下偏 distort（螢幕 uv，乘上那一圈的亮度）。
 */
export const WATER_RIPPLE = {
  count: 4,
  period: 9,
  start: 0.1,
  end: 2.6,
  width: [0.008, 0.034] as const,
  gain: 0.032,
  distort: 0.006,
} as const;
/** 轉卡越快漣漪越亮：能量 1 時 1＋RIPPLE_ENERGY_BOOST 倍。 */
export const RIPPLE_ENERGY_BOOST = 0.6;

export interface WaterRipple {
  /** 0～1：這一圈走到哪。 */
  age: number;
  radius: number;
  width: number;
  strength: number;
}

/** 第 k 圈漣漪（0～count−1）在 time 秒時的樣子。著色程式用同一個公式；減少動態效果時時間停住，漣漪就停在那裡。 */
export function waterRipple(time: number, k: number): WaterRipple {
  const R = WATER_RIPPLE;
  const x = time / R.period + k / R.count;
  const age = x - Math.floor(x);
  const ease = 1 - (1 - age) ** 2;
  return {
    age,
    radius: R.start + (R.end - R.start) * ease,
    width: R.width[0] + (R.width[1] - R.width[0]) * age,
    strength: R.gain * Math.min(1, age / 0.08) * (1 - age) ** 1.5,
  };
}

// ---- 水面樣子（T-825，卡片的 view.waterLook；DESIGN §5「水面樣子」）----
//   〔波紋〕ripple ÷ 50 倍：細波紋（倒影左右偏）、漣漪的亮度與扭曲都乘上它（0＝完全平靜，50＝以前）。
//   〔卡片高度〕lift：卡片下緣到水面 lift ÷ 30 × WATER_GAP（0＝站在水上，30＝以前，100＝0.2 卡寬）。
//   〔地平線〕horizon：鏡頭往下移到 horizonCameraY（100＝卡片中心＝以前；0＝卡片下緣〔腳邊〕的高度），同時畫面用 lens shift
//     （three.js setViewOffset，鏡頭不歪）往下平移 horizonShift，卡片所在的平面 z＝0 在畫面上一點都不動——卡片的位置、大小、
//     倒影都不變，只有地平線（很遠的水面＝鏡頭高度）跟著降到卡片腳邊。取景（waterReach）因此不用改。
//   〔霧〕mist／100：遠處的水面照 waterFog × mistHorizon、遠景平面照 farMist 混進「天空」（霧色 × mistSky：卡片後面亮、
//     上面與四角偏暗偏冷，T-825c）；接縫上兩邊一樣濃，霧 100 時遠景整片是天空、看不到地平線那條線。
//     預覽區的天空（CSS 那層）也照霧色與濃淡混（ui/stage.ts、style.css；有遠景時被 3D 的遠景平面蓋住）。
//   〔倒影拉長〕streak／100：倒影往下（遠離卡片）多取 WATER_STREAK.taps 點拉長模糊、再乘上一條條橫紋（濕柏油路那樣）；
//     越往畫面下方水面越暗（waterWet，T-825c：像參考圖濕暗的水面）。
//   〔閃光〕glint／100：卡片倒影那一條裡（glintDensity：左右約 1～1.5 卡寬）一閃一閃的小亮點，靠腳邊又多又大又亮（WATER_GLINT）。
// 霧、拉長、閃光大於 0 或波紋不是 50（needsLookShader）才用「水面樣子」那份著色程式；〔夜色〕和以前是同一份（water-nodes.ts 檔頭）。

/** 換算的基準：〔夜色〕的波紋、卡片高度（＝以前）。 */
const LOOK_BASE = { ripple: DEFAULT_WATER_LOOK.ripple, lift: DEFAULT_WATER_LOOK.lift } as const;

/** 〔波紋〕→ 漣漪與細波紋的倍數（50＝1＝以前）。 */
export function rippleScale(ripple: number): number {
  return ripple / LOOK_BASE.ripple;
}

/** 〔卡片高度〕→ 卡片下緣到水面的距離（卡寬）：30＝WATER_GAP（逐位元相同）、0＝貼著水面。 */
export function waterGap(lift: number): number {
  return lift === LOOK_BASE.lift ? WATER_GAP : (lift / LOOK_BASE.lift) * WATER_GAP;
}

/** 地平線 0 時鏡頭最少離水面多高（卡寬）：卡片貼著水面時視線不會剛好擦過水面（那樣水面縮成一條線、看不到倒影）。 */
export const HORIZON_MIN_HEIGHT = 0.05;

/**
 * 〔地平線〕→ 鏡頭的高度（世界 y，卡片中心＝0）：100＝0（以前）；0＝卡片下緣（腳邊）的高度、但至少離水面 HORIZON_MIN_HEIGHT；
 * 中間線性。cardH＝卡高、gap＝卡片下緣到水面（waterGap）。
 */
export function horizonCameraY(cardH: number, gap: number, horizon: number): number {
  if (horizon >= 100) return 0;
  const low = Math.max(-cardH / 2, waterY(cardH, gap) + HORIZON_MIN_HEIGHT);
  return low * (1 - Math.max(0, horizon) / 100);
}

/**
 * 鏡頭往下移 cameraY（< 0）之後，畫面要平移多少（NDC，+＝往上）卡片所在的平面（z＝0）才在畫面上不動：
 * 那個平面上一點 y 原本在 y ÷ (D × tan 半視角)，鏡頭低了 cameraY 之後在 (y − cameraY) ÷ (D × tan 半視角)，所以平移 cameraY ÷ (D × tan 半視角)。
 * 很遠的水面（地平線）也在這個高度＝卡片平面上 y＝cameraY 那一點。
 */
export function horizonShift(cameraY: number, cameraZ: number, vFovDeg: number): number {
  if (cameraY === 0) return 0;
  return cameraY / (cameraZ * Math.tan(((vFovDeg / 2) * Math.PI) / 180));
}

/**
 * three.js PerspectiveCamera.setViewOffset 的參數：畫面平移 shift（NDC）。fullWidth／fullHeight＝aspect（不改鏡頭的寬高比）、
 * 只有 y 偏移：offsetY＝shift ÷ 2 × fullHeight（three.js 的 offsetY 讓 NDC 加 2 × offsetY ÷ fullHeight；shift < 0＝畫面內容往下）。
 */
export function horizonViewOffset(
  shift: number,
  aspect: number,
): { fullWidth: number; fullHeight: number; x: number; y: number; width: number; height: number } {
  return { fullWidth: aspect, fullHeight: 1, x: 0, y: shift / 2, width: aspect, height: 1 };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * 霧：遠景平面（T-825c）。m＝〔霧〕／100。水平線那一帶比 m 濃（boost：霧不大時地平線就先融進霧），越往上越接近 m、
 * 最上面再淡一點（thin）；兩個都乘 (1 − m)，所以 m＝1 時整片＝1（遠景完全融進霧色，DESIGN「都融進霧色」）、m＝0 時＝0（逐位元）。
 * v＝離水平線多高（0＝下緣、1＝上緣），reach 以上算「上面」。
 */
export const FAR_MIST = { boost: 1.5, thin: 0.22, reach: 0.75 } as const;
export function farMist(v: number, m: number): number {
  const s = smoothstep(0, FAR_MIST.reach, v);
  return clamp01(m * (1 + (1 - m) * (FAR_MIST.boost * (1 - s) - FAR_MIST.thin * s)));
}
/** 水平線上（遠景平面下緣、遠處水面）的霧濃淡＝farMist(0, m)。 */
export function mistHorizon(m: number): number {
  return Math.min(1, m * (1 + FAR_MIST.boost * (1 - m)));
}

/**
 * 霧：水面上一點（T-825c，乘上 mistHorizon）。z＝往鏡頭多遠（卡寬；卡片正下方 0、遠景平面 −WATER_BACKDROP.distance），
 * cameraZ＝鏡頭的 z、cameraHeight＝鏡頭離水面多高。離鏡頭越遠越濃（(水平距離 ÷ 鏡頭到遠景平面)^power，到遠景平面＝1，
 * 和遠景平面的下緣接得上）；貼著水平線那一條（往下看的角度的 sin < band）也是霧——地平線低時卡片腳邊就是水平線，
 * 那一帶融進霧、往下（靠看的人）很快變回清楚的濕暗水面。
 */
export const WATER_FOG = { power: 2, band: 0.035 } as const;
export function waterFog(z: number, cameraZ: number, cameraHeight: number): number {
  const run = cameraZ - z;
  const t = clamp01(run / (cameraZ + WATER_BACKDROP.distance));
  const down = cameraHeight / Math.hypot(cameraHeight, Math.max(run, 1e-6));
  return Math.max(Math.pow(t, WATER_FOG.power), 1 - smoothstep(0, WATER_FOG.band, down));
}

/**
 * 天空的明暗（T-825c，參考圖：主體後面最亮、四周偏冷偏暗的柔和暗角）：霧色 × mistSky(u, v) 就是霧裡的天空；
 * u、v＝遠景平面上的位置（0～1；v 0＝水平線）。上面暗 top、上面的左右兩邊再暗 side（水平線那一帶只有 sideLow 成：
 * 水平線整條接近霧色，霧 100 看不到線）；卡片後面（glowAt，大小 glowSize）亮 glow 倍、偏暖 warm；暗的地方偏冷 cool。
 */
export const MIST_SKY = {
  top: 0.38,
  side: 0.24,
  sideLow: 0.18,
  topFrom: 0.08,
  sideReach: 0.6,
  glow: 0.12,
  glowAt: [0.5, 0.3] as const,
  glowSize: [0.36, 0.45] as const,
  coolAt: 0.45,
  cool: [0.88, 0.97, 1.1] as const,
  warm: [1.025, 1.0, 0.955] as const,
} as const;
export function mistSky(u: number, v: number): [number, number, number] {
  const S = MIST_SKY;
  const hx = (u - 0.5) * 2;
  const dark = S.top * smoothstep(S.topFrom, 1, v) + S.side * hx * hx * (S.sideLow + (1 - S.sideLow) * smoothstep(0, S.sideReach, v));
  const gx = (u - S.glowAt[0]) / S.glowSize[0];
  const gy = (v - S.glowAt[1]) / S.glowSize[1];
  const glow = Math.exp(-(gx * gx + gy * gy));
  const b = (1 - dark) * (1 + S.glow * glow);
  const c = Math.min(1, dark / S.coolAt);
  return [0, 1, 2].map((i) => b * (1 + (S.cool[i]! - 1) * c) * (1 + (S.warm[i]! - 1) * glow)) as [number, number, number];
}

/** 螢幕上的 x（0～1）→ 遠景平面的 u：平面比畫面寬 WATER_BACKDROP.margin、置中（水面的霧色取同一條直線上的天空）。 */
export function screenToFarU(x: number): number {
  return 0.5 + (x - 0.5) / (1 + WATER_BACKDROP.margin);
}

/**
 * 倒影拉長：倒影原本的 5 點柔化之外，再往卡片那邊（畫面上方）多取 taps 點、平均起來（總共 ≤ 12 點）；
 * 拉長的距離（螢幕 uv）＝〔倒影拉長〕×（base ＋ perHeight × 映出的高度）——越下面（映出卡片越高的地方）拉得越長；
 * 橫紋：倒影裡的高度（reflection.ts 的 reflectedHeightNode：和倒影一起在畫面上等比例排開，地平線高低都一樣）與倒影在卡片平面上的 x
 * （reflectedX：螢幕上左右等寬）的雜訊（高度方向頻率 band、x 方向 bandX，卡寬⁻¹）把倒影切成一條條亮暗，最暗 floor、最亮 peak 倍，
 * 每一條左右錯開 wobble（螢幕 uv）；
 * 濕的水面（waterWet）：越靠近看的人（倒影裡越高的地方，wetFrom～wetTo 卡寬）整片水面越暗，最暗乘到 1 − wet × √〔倒影拉長〕（像參考圖下方的深色水面）。
 */
export const WATER_STREAK = {
  taps: 7,
  base: 0.03,
  perHeight: 0.2,
  band: 64,
  bandX: 2,
  bandSoft: [0.2, 0.8] as const,
  floor: 0.45,
  peak: 1.25,
  wobble: 0.007,
  wet: 0.9,
  wetFrom: 0,
  wetTo: 0.5,
  wetCurve: 0.7,
} as const;

/**
 * 濕的水面（T-825c）：倒影裡的高度 height（≈ 水平線往下多遠，卡寬）→ 水面乘多少；streak＝〔倒影拉長〕／100（0＝1，逐位元）。
 * 水平線那裡不暗，往下很快變暗（smoothstep 再開 wetCurve 次方：前段陡），到 wetTo 以下＝1 − wet × √streak（拉長不大就夠暗）。
 */
export function waterWet(height: number, streak: number): number {
  const s = Math.pow(smoothstep(WATER_STREAK.wetFrom, WATER_STREAK.wetTo, height), WATER_STREAK.wetCurve);
  return 1 - WATER_STREAK.wet * Math.sqrt(streak) * s;
}

/**
 * 水面上一點 (x, z) 映出的是卡片平面（z＝0）上哪個 x（卡寬）：從鏡頭（x＝0、z＝cameraZ）看出去同一條直線往前走到 z＝0。
 * 螢幕上左右等寬（不像水面的 x 越靠鏡頭越被壓扁）——閃光的格子、橫紋、閃光集中的那一條都排在它上面（T-825c）。
 */
export function reflectedX(x: number, z: number, cameraZ: number): number {
  return (x * cameraZ) / Math.max(cameraZ - z, 1e-3);
}

/**
 * 閃光：格子排在「倒影在卡片平面上的 x（reflectedX）× 倒影裡的高度」上（cell，卡寬；兩個都和倒影一起在畫面上等比例排開），
 * 兩層（layers：格子大小 scale 倍、亮點大小 size 倍、亮度 gain 倍、seed 錯開），每格最多一顆、在格子裡隨機擺（離中心最多 jitter 格的一半）、
 * 每一排錯開半格；出現的機率最大 density（乘上〔閃光〕／100 與 glintDensity）；大小 size（卡寬，最小 1 像素多一點；倒影拉長時上下拉長
 * stretch 倍；最大 fit 格——亮點在自己的格子裡就淡完，不會被格子切成方塊）、
 * 亮度 gain；各自不同步地一閃一閃（每秒 rate 弧度上下；腳邊閃得緩一點、亮的時間長：sharp 次方由遠到近）；
 * 集中在卡片倒影那一條（T-825c）：左右 column[0] 以內全有、column[1] 以外沒有；靠腳邊最多（倒影裡的高度每多 feet 卡寬剩 1/e，
 * 遠處留 far 成），靠腳邊大 feetSize、亮 feetGain 倍；卡片後面沒有。
 */
export const WATER_GLINT = {
  cell: [0.085, 0.06] as const,
  density: 0.75,
  size: 0.006,
  fit: 0.12,
  jitter: 0.5,
  gain: 4.4,
  rate: [1.6, 4.2] as const,
  sharp: [6, 2.5] as const,
  stretch: 2,
  column: [0.24, 0.62] as const,
  feet: 0.4,
  far: 0.14,
  feetSize: 1.8,
  feetGain: 1.6,
  layers: [
    { scale: 1, size: 1, gain: 1, seed: 0 },
    { scale: 0.55, size: 0.6, gain: 0.65, seed: 37.7 },
  ] as const,
} as const;

/** 閃光出現的機率倍數（0～1，T-825c）：cx＝倒影在卡片平面上的 x、height＝倒影裡的高度。 */
export function glintDensity(cx: number, height: number): number {
  const G = WATER_GLINT;
  const column = 1 - smoothstep(G.column[0], G.column[1], Math.abs(cx));
  const feet = Math.exp(-Math.max(0, height) / G.feet);
  return column * (G.far + (1 - G.far) * feet);
}

/** 閃光靠腳邊大一點、亮一點的倍數（T-825c）。 */
export function glintBoost(height: number): { size: number; gain: number } {
  const feet = Math.exp(-Math.max(0, height) / WATER_GLINT.feet);
  return { size: 1 + WATER_GLINT.feetSize * feet, gain: 1 + WATER_GLINT.feetGain * feet };
}

/**
 * 水面流動的時間（T-825c，月光微光、倒影的橫紋用）：每格加「舞台時間走了多少 × 波紋倍數（scale，rippleScale）」——波紋 0＝完全平靜（不走），
 * 改波紋時從現在的位置接著走（不跳）；減少動態時舞台時間停住，它也停住。
 */
export function waterFlow(flow: number, dTime: number, scale: number): number {
  return flow + dTime * scale;
}

/** 水面樣子 → 著色程式的四個數字 uniform（顏色另外換成線性）：霧、倒影拉長、閃光是 0～1，波紋是倍數。 */
export function waterLookUniforms(look: Readonly<WaterLook>): { mist: number; streak: number; glint: number; ripple: number } {
  return { mist: look.mist / 100, streak: look.streak / 100, glint: look.glint / 100, ripple: rippleScale(look.ripple) };
}

/**
 * 要不要用「水面樣子」那份著色程式（T-825c）：霧、倒影拉長、閃光大於 0 或波紋不是 1 倍。〔夜色〕（含只改卡片高度、地平線、顏色）
 * 用平常那份＝以前的著色程式（兩種後端都逐位元相同）。
 */
export function needsLookShader(u: { mist: number; streak: number; glint: number; ripple: number }): boolean {
  return u.mist > 0 || u.streak > 0 || u.glint > 0 || u.ripple !== 1;
}
