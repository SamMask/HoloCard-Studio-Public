// 局部動態特效（T-811，SCHEMA Layer.fx?、DESIGN「局部動態特效」）：火焰、電光、水波三種程序圖案（TSL）＋時間的純函式（node 可測）。
// 不是粒子：每個像素照「這層的局部座標＋迴圈位置」算出一個發光顏色，card-mesh 在這層照混合模式合成完之後加上去
// （發光的混法：在 sRGB 數值上相加），乘這層的 cover（alpha × 顯示 × 不透明度，含剪裁、雙圖光柵混好的 alpha），所以透明的地方不畫、
// 跟著這層的深度、視差一起走。
//
// 時間（DESIGN：週期一律是 4 秒的整數分之一）：速度 → 每 4 秒 n 個週期（fxCycles，n＝1～8 的整數）；CPU 算「迴圈位置」
// L＝(t × n／4) mod n（fxLoop：整數部分＝4 秒裡的第幾個週期、小數＝這個週期的相位），當 uniform 傳進 shader（雙精度算好，
// 開著工坊幾小時也不會因為 float 精度抖動）。圖案只看 L，所以 4 秒後一模一樣：4／8／12 秒的轉動影片與 4 秒 GIF 頭尾接得上。
// 預覽用影格時間、轉動匯出用影片時間（card-view 的 captureTurntable 傳第幾格 × 每格秒數）、PNG 用當下；減少動態時停在 EFFECT_STILL_TIME。
//
// 三種圖案（本專案自己寫的，沒有移植別的專案的程式碼；雜湊與數值雜訊的寫法同 holo-nodes.ts）：
// - 火焰：y 方向週期性的數值雜訊（noiseY：格點的 y 照週期取餘數，捲一整個週期剛好接回來）疊 3 層（fbm），橫向扭曲（搖曳，越往上晃越多），
//   每個週期往上捲一整個週期的距離；這層下緣熱、上緣涼，所以火舌從下面竄上來、尖端淡掉，最熱的地方偏白。
// - 電光：扭曲過的數值雜訊取「等於 0.5 的那條線」（|n − 0.5| 很小的地方）當閃電線：細白芯（至少約一個像素）＋外光＋細分枝，
//   只畫在另一張雜訊遮罩亮的地方（一段一段）；4 秒裡分成 n × 4 步，每一步換一組亂數種子（亂竄），有些步整個亮一下（偶爾一亮），一步之內慢慢變暗。
// - 水波：兩個圓心（照這層的大小擺，一個主要、一個淡的）各自一圈圈往外擴的光紋（cos 的波峰取次方變細、離圓心越遠越淡），
//   用雜訊把圓圈扭得不那麼正，每個週期往外走一圈的距離。
// 每像素多算（開了特效的層才有；shader 沒有分支，所以是這一面的每個像素都算，最多 2 層）：
//   火焰＝16 次格點雜湊（sin）＋8 次 mod；電光＝20 次格點雜湊＋3 次雜湊＋2 次 fwidth；水波＝4 次格點雜湊＋2 個距離、2 個 cos、2 個 pow。
//   都沒有迴圈、沒有貼圖取樣。

import { abs, cos, dot, float, floor, Fn, fract, fwidth, length, max, mix, mod, pow, saturate, sin, smoothstep, step, vec2, vec3 } from 'three/tsl';
import type { Node, UniformNode, Vector3 } from 'three/webgpu';
import type { FxKind, Layer } from '../model/types';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

// ---- 時間（CPU，node 可測）----

/** 迴圈長度（秒）：所有特效的週期都是它的整數分之一。 */
export const FX_LOOP_SECONDS = 4;
/** 速度 100 時每 4 秒幾個週期。 */
export const FX_MAX_CYCLES = 8;
/** 速度不是數字時當成這個（同 model/fx.ts 的 DEFAULT_FX_SPEED）。 */
const FALLBACK_SPEED = 50;

/** 速度 0～100 → 每 4 秒幾個週期（1～FX_MAX_CYCLES 的整數；速度 50 → 5，週期 0.8 秒）。 */
export function fxCycles(speed: number): number {
  const s = Number.isFinite(speed) ? Math.min(100, Math.max(0, speed)) : FALLBACK_SPEED;
  return 1 + Math.round((s / 100) * (FX_MAX_CYCLES - 1));
}

/** 一個週期幾秒（4／n）。 */
export function fxPeriod(speed: number): number {
  return FX_LOOP_SECONDS / fxCycles(speed);
}

/**
 * 時間 t（秒）→ 迴圈位置 L＝(t × n／4) mod n，在 [0, n)：整數部分＝4 秒裡的第幾個週期、小數＝相位。
 * 剛好落在週期的接縫上（浮點誤差在 1e-9 以內）一律算 0，4 秒、8 秒、12 秒都剛好回到原點。不是有限數字 → 0。
 */
export function fxLoop(t: number, speed: number): number {
  if (!Number.isFinite(t)) return 0;
  const n = fxCycles(speed);
  const x = (t * n) / FX_LOOP_SECONDS;
  const whole = Math.round(x);
  if (Math.abs(x - whole) < 1e-9 * Math.max(1, Math.abs(x))) return ((whole % n) + n) % n;
  const L = x - n * Math.floor(x / n);
  return L >= n ? 0 : L;
}

/** 這一刻的相位 0～1（fxLoop 的小數部分）。 */
export function fxPhase(t: number, speed: number): number {
  const L = fxLoop(t, speed);
  return L - Math.floor(L);
}

/** 強度 100 時的發光倍數（sRGB 數值上加多少；主對話看三張範例後可再調）。 */
export const FX_MAX_GAIN = 1;

/** 強度 0～100 → 發光倍數（0＝沒有光）。不是數字 → 0。 */
export function fxGain(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return (Math.min(100, Math.max(0, strength)) / 100) * FX_MAX_GAIN;
}

/** #rrggbb → sRGB 數值 0～1（shader 在 sRGB 數值上合成）；不合格 → 白色。 */
export function fxRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 1, g: 1, b: 1 };
  return { r: parseInt(m[1]!, 16) / 255, g: parseInt(m[2]!, 16) / 255, b: parseInt(m[3]!, 16) / 255 };
}

/** 這層要不要畫特效：有 fx、而且不是破框層（SCHEMA：破框層不能有；萬一有也不畫）。 */
export function fxOn(layer: Pick<Layer, 'role' | 'breakout' | 'fx'>): boolean {
  return layer.fx !== undefined && !(layer.role === 'depth' && layer.breakout === true);
}

/**
 * 轉動匯出第 index 格的特效時間（影片時間，秒）＝index × 一圈秒數／一圈格數。每一圈都從 0 開始：一圈 4 秒（TURNTABLE.seconds）
 * 是每個特效週期的整數倍，所以多圈的影片在圈與圈之間、GIF 無限循環的頭尾都接得上（閃星另外用 loopTimeSpan 的效果時間）。
 */
export function turntableFxTime(index: number, frames: number, seconds: number): number {
  return (index * seconds) / frames;
}

/** 減少動態效果時卡片的效果時間（秒）：閃星、特效都停在這一刻（T-608、T-811）。 */
export const EFFECT_STILL_TIME = 0;

/** 預覽交給卡片的效果時間：平常＝影格時間；減少動態＝EFFECT_STILL_TIME（card-view 每格用）。 */
export function effectClock(clock: number, reduced: boolean): number {
  return reduced ? EFFECT_STILL_TIME : clock;
}

// ---- 樣子的常數（卡寬單位；主對話看過範例卡後可再調）----

/** 火焰：格子寬高（高比寬大＝拉長的火舌）、y 方向幾格重複一次（每個週期往上捲這麼多格）、搖曳、下熱上涼、門檻、最熱處偏白。 */
export const FIRE_LOOK = {
  cellX: 0.04,
  cellY: 0.09,
  period: 4,
  sway: 1.1,
  baseHeat: 0.5,
  topCool: 0.28,
  lo: 0.46,
  hi: 0.66,
  coreLo: 0.7,
  coreHi: 0.95,
  core: 0.4,
} as const;

/**
 * 電光：格子大小、一個週期分幾步（每步換一組閃電）、扭曲、哪些地方有閃電（遮罩門檻）、白芯寬（雜訊值單位，至少約一個像素）、
 * 外光寬、分枝、多少步會亮一下（亂數 ≥ 門檻）、亮一下多亮、亮的時候整個形狀淡淡一層光。
 */
export const ELECTRIC_LOOK = {
  cell: 0.15,
  steps: 4,
  warp: 0.6,
  maskLo: 0.42,
  maskHi: 0.6,
  core: 0.01,
  halo: 0.07,
  haloGain: 0.55,
  branch: 0.45,
  flashCut: 0.7,
  flashGain: 1.1,
  flashGlow: 0.14,
  white: 0.7,
} as const;

/**
 * 水波：圓心（以這層的大小為 1、中心為 0）與各自的亮度（一個主要的、一個淡的，交疊處有一點干涉）、光紋間距（卡寬）、扭曲、
 * 波峰的銳利度（cos 的次方）、亮度、整個形狀淡淡一層底光、波峰偏白的程度、離圓心越遠越淡的程度。
 */
export const WATER_LOOK = {
  centers: [
    [0.04, 0.08, 1],
    [-0.38, -0.34, 0.5],
  ],
  spacing: 0.1,
  warpCell: 0.17,
  warp: 0.9,
  sharp: 6,
  gain: 0.6,
  base: 0.05,
  core: 0.25,
  falloff: 0.06,
} as const;

// ---- 雜訊（TSL）----

const TAU = 6.283185307;

// hash(p) = fract(sin(dot(p, (127.1, 311.7))) × 43758.5453)（同 holo-nodes 的寫法；格點座標都是整數、不大，精度夠）
const hash = Fn(([p]: [V2]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)), {
  p: 'vec2',
  return: 'float',
}) as unknown as (p: V2) => F;

const hash1 = Fn(([x]: [F]) => fract(sin(x.mul(91.3458).add(17.17)).mul(47453.5453)), {
  x: 'float',
  return: 'float',
}) as unknown as (x: F) => F;

// 數值雜訊（平滑內插）
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

// y 方向每 period 格重複的數值雜訊（period 是整數）：格點的 y 照週期取餘數，往上捲一整個週期剛好接回原樣
const noiseY = Fn(([p, period]: [V2, F]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const y0 = mod(i.y, period);
  const y1 = mod(i.y.add(1), period);
  const a = hash(vec2(i.x, y0));
  const b = hash(vec2(i.x.add(1), y0));
  const c = hash(vec2(i.x, y1));
  const d = hash(vec2(i.x.add(1), y1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}, { p: 'vec2', period: 'float', return: 'float' }) as unknown as (p: V2, period: F) => F;

/** 3 層的 y 週期性雜訊（頻率 1、2、4，週期跟著 ×1、×2、×4，所以整體一樣每 period 格重複）；結果約 0～1。 */
function fbmY(p: V2, period: number): F {
  const a = noiseY(p, float(period));
  const b = noiseY(p.mul(2).add(vec2(13.7, 5.1)), float(period * 2));
  const c = noiseY(p.mul(4).add(vec2(-7.3, 21.9)), float(period * 4));
  return a.mul(0.5).add(b.mul(0.25)).add(c.mul(0.125)).div(0.875);
}

// ---- 三種圖案：回傳這一點的發光顏色（sRGB 數值，還沒乘 cover 與強度）----

/** local＝這層的局部座標（卡寬單位、這層中心為 0、+y 向上、含視差）；size＝這層的寬高；loop＝迴圈位置 L；color＝特效顏色（sRGB 數值）。 */
export interface FxInput {
  local: V2;
  size: V2;
  loop: F;
  color: V3;
}

const HOT = vec3(1, 0.93, 0.78);
const WHITE = vec3(1, 1, 1);

function fireGlow({ local, size, loop, color }: FxInput): V3 {
  const L = FIRE_LOOK;
  const phase = fract(loop);
  const s = vec2(local.x.div(L.cellX), local.y.div(L.cellY));
  // 這層的高度：0＝下緣、1＝上緣
  const v = saturate(local.y.div(size.y).add(0.5));
  // 搖曳：y 週期一半的雜訊，每個週期捲兩個自己的週期（和火舌錯開，像在晃）；越往上晃得越多
  const sway = noiseY(vec2(s.x.mul(0.35).add(17.3), s.y.mul(0.5).sub(phase.mul(L.period))), float(L.period / 2)).sub(0.5);
  const q = vec2(s.x.add(sway.mul(L.sway).mul(v.add(0.4))), s.y.sub(phase.mul(L.period)));
  const n = fbmY(q, L.period);
  // 越往上越涼（火舌的尖端淡掉）
  const heat = n.add(float(1).sub(v).mul(L.baseHeat)).sub(v.mul(L.topCool)).sub(L.baseHeat * 0.5);
  const flame = smoothstep(L.lo, L.hi, heat);
  const core = smoothstep(L.coreLo, L.coreHi, heat);
  return color.mul(flame).add(HOT.mul(core.mul(L.core))) as V3;
}

function electricGlow({ local, loop, color }: FxInput): V3 {
  const E = ELECTRIC_LOOK;
  // 每一步一組亂數種子（4 秒裡的第幾步：迴圈位置 × 步數）；一步之內慢慢變暗
  const at = loop.mul(E.steps);
  const k = floor(at);
  const within = fract(at);
  const seed = vec2(hash1(k), hash1(k.add(11.7))).mul(97);
  const s = local.div(E.cell);
  const w = vec2(noise(s.mul(2.7).add(seed)), noise(s.mul(2.7).add(seed.yx).add(31.1))).sub(0.5);
  const q = s.add(w.mul(E.warp));
  // 閃電線＝雜訊等於 0.5 的那條線；只有遮罩亮的地方有（一段一段，不是滿滿的網）
  const r = abs(noise(q.add(seed.yx)).sub(0.5));
  const mask = smoothstep(E.maskLo, E.maskHi, noise(s.mul(0.6).add(seed.mul(1.7))));
  // 白芯至少約一個像素寬（fwidth），縮小時不會時有時無；外光是同一條線往外淡出
  const core = float(1).sub(smoothstep(0, max(fwidth(r).mul(1.2), E.core), r));
  const halo = pow(float(1).sub(smoothstep(0, E.halo, r)), 2);
  // 分枝：細一點的第二組線，只在遮罩裡、比較暗
  const r2 = abs(noise(q.mul(2.3).add(seed).add(7.7)).sub(0.5));
  const branch = float(1).sub(smoothstep(0, max(fwidth(r2), E.core * 0.6), r2)).mul(E.branch);
  const flash = step(E.flashCut, hash1(k.add(5.3)));
  const fade = float(1).sub(within.mul(0.6));
  const lit = mask.mul(fade).mul(flash.mul(E.flashGain).add(1));
  const bolts = core.add(branch).add(halo.mul(E.haloGain)).mul(lit);
  const glow = flash.mul(E.flashGlow).mul(float(1).sub(within));
  return color.mul(bolts.add(glow)).add(WHITE.mul(core.add(branch).mul(lit).mul(E.white))) as V3;
}

function waterGlow({ local, size, loop, color }: FxInput): V3 {
  const W = WATER_LOOK;
  const phase = fract(loop);
  const warp = noise(local.div(W.warpCell).add(3.7)).sub(0.5).mul(W.warp);
  let rings: F = float(0);
  for (const [cx, cy, weight] of W.centers) {
    const d = length(local.sub(size.mul(vec2(cx, cy)))).div(W.spacing);
    // 波峰往外走：每個週期走一圈的距離；離圓心越遠越淡
    const wave = cos(d.add(warp).sub(phase).mul(TAU)).mul(0.5).add(0.5);
    rings = rings.add(pow(wave, W.sharp).mul(weight).div(d.mul(W.falloff).add(1)));
  }
  const crest = saturate(rings);
  return color.mul(rings.mul(W.gain).add(W.base)).add(WHITE.mul(crest.mul(crest).mul(W.core))) as V3;
}

/**
 * 這一種特效在這一點的發光顏色（sRGB 數值，還沒乘 cover 與強度）。種類在建材質時決定（換種類＝換材質）。
 * 每個通道夾在 0～1（T-811 審查：電光白芯＋外光、水波兩圈波峰重合會超過 1；DESIGN「強度 100 最多加 1」）。
 * 只夾特效自己的光，不夾整個合成結果（鐳射高光照舊）。
 */
export function fxGlowNode(kind: FxKind, input: FxInput): V3 {
  const glow = kind === 'fire' ? fireGlow(input) : kind === 'electric' ? electricGlow(input) : waterGlow(input);
  return saturate(glow) as V3;
}

/** 一個有特效的層在 shader 裡用到的 uniform（card-mesh 的 LayerSlot.fx）。 */
export interface FxUniforms {
  /** 特效顏色（sRGB 數值 0～1，fxRgb）。 */
  color: UniformNode<'vec3', Vector3>;
  /** 發光倍數（fxGain；拖強度只改這個）。 */
  gain: UniformNode<'float', number>;
  /** 迴圈位置（fxLoop；每格由 setTime 更新）。 */
  loop: UniformNode<'float', number>;
}
