// 轉卡、回正、縮放的數學（純函式，不碰 DOM、不碰 three.js）。
// 角度一律用「度」：yaw＝左右轉（0＝正面朝鏡頭、180＝背面朝鏡頭，不限圈數）；
// pitch＝上下傾（正值＝上緣朝觀看者），夾在 ±PITCH_LIMIT_DEG。
// 工作桌舞台（T-832，DESIGN §5「工作桌」）：卡片插在展示座上整座一起轉——上下只傾 ±DESK_PITCH_LIMIT_DEG、展示擺動幅度減半。
// 這裡不認得舞台名字：main 用 turnLimits(是不是工作桌) 拿到範圍，傳給 dragBy／turnByKey／holdAt／limitPitch／stepShowcase（不給＝照舊）。

import type { FaceSide } from './parallax';

export const PITCH_LIMIT_DEG = 60;
/** 拖曳 1 像素轉幾度。 */
export const DRAG_DEG_PER_PX = 0.35;

/** 縮放倍率：1＝最近（包住卡片的球剛好塞滿畫面，卡片仍完整可見）。 */
export const ZOOM_MAX = 1;
export const ZOOM_MIN = 0.45;
export const ZOOM_DEFAULT = 0.85;
const ZOOM_PER_WHEEL_PX = 0.0015;

/** 回正的彈簧強度（1/秒）：臨界阻尼、從靜止出發，約 0.8 秒走完 95%、不會衝過頭。 */
const RETURN_OMEGA = 6;
const SNAP_DEG = 0.01;
const SNAP_SPEED = 0.05;

export type ViewMode = 'idle' | 'dragging' | 'returning' | 'held';

export interface ViewState {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
  readonly mode: ViewMode;
  /** 回正的目標 yaw（放開時決定）。 */
  readonly targetYaw: number;
  /** 回正的目標 pitch：回正與切面是 0；用鍵盤轉卡（turnByKey，T-607）時停在按出來的角度。 */
  readonly targetPitch: number;
  /** 回正中的角速度（度／秒）；不做慣性，所以放開時一律從 0 開始。 */
  readonly yawVel: number;
  readonly pitchVel: number;
}

export function initialView(): ViewState {
  return { yaw: 0, pitch: 0, zoom: ZOOM_DEFAULT, mode: 'idle', targetYaw: 0, targetPitch: 0, yawVel: 0, pitchVel: 0 };
}

/** 工作桌舞台（T-832）上下只傾這麼多度（不會像卡片從座上倒下來）。 */
export const DESK_PITCH_LIMIT_DEG = 10;
/** 工作桌舞台的展示擺動幅度倍數（左右、上下都減半）。 */
export const DESK_SHOWCASE_SCALE = 0.5;

/** 轉卡的範圍（T-832）：pitch 夾在 ±pitch 度；展示擺動的幅度乘 showcase。 */
export interface TurnLimits {
  readonly pitch: number;
  readonly showcase: number;
}

/** onDesk＝卡片在工作桌舞台上（main 看 card.view.stage）：±10°、擺動減半；其他舞台照舊 ±60°、1 倍。 */
export function turnLimits(onDesk: boolean): TurnLimits {
  return onDesk ? { pitch: DESK_PITCH_LIMIT_DEG, showcase: DESK_SHOWCASE_SCALE } : { pitch: PITCH_LIMIT_DEG, showcase: 1 };
}

export function clampPitch(deg: number, limit = PITCH_LIMIT_DEG): number {
  return Math.min(limit, Math.max(-limit, deg));
}

/**
 * 換到上下範圍比較小的舞台（T-832 工作桌）時：超出 ±limit 的 pitch 與回正的目標夾回範圍裡（直接到位，換舞台本來就是一下子換掉整個場景）；
 * 都沒超出就原樣回傳（同一個物件）。
 */
export function limitPitch(s: ViewState, limit: number): ViewState {
  if (Math.abs(s.pitch) <= limit && Math.abs(s.targetPitch) <= limit) return s;
  const pitch = clampPitch(s.pitch, limit) + 0;
  return { ...s, pitch, targetPitch: clampPitch(s.targetPitch, limit) + 0, pitchVel: pitch === s.pitch ? s.pitchVel : 0 };
}

/** 最近的一面：最近的 180° 倍數（0＝正面、±180＝背面…）。 */
export function nearestFaceYaw(yaw: number): number {
  return Math.round(yaw / 180) * 180 + 0; // +0 把 -0 變成 0
}

export function zoomByWheel(zoom: number, deltaYPx: number): number {
  const next = zoom * Math.exp(-deltaYPx * ZOOM_PER_WHEEL_PX);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

export function beginDrag(s: ViewState): ViewState {
  return { ...s, mode: 'dragging', yawVel: 0, pitchVel: 0 };
}

/** 向右拖 yaw 變大（卡面跟著滑鼠往右）；向下拖 pitch 變大（上緣朝觀看者），夾在 ±pitchLimit（工作桌 ±10°，T-832）。 */
export function dragBy(s: ViewState, dxPx: number, dyPx: number, pitchLimit = PITCH_LIMIT_DEG): ViewState {
  if (s.mode !== 'dragging') return s;
  return {
    ...s,
    yaw: s.yaw + dxPx * DRAG_DEG_PER_PX,
    pitch: clampPitch(s.pitch + dyPx * DRAG_DEG_PER_PX, pitchLimit),
  };
}

export function endDrag(s: ViewState): ViewState {
  if (s.mode !== 'dragging') return s;
  return { ...s, mode: 'returning', targetYaw: nearestFaceYaw(s.yaw), targetPitch: 0, yawVel: 0, pitchVel: 0 };
}

/** 開發用 setAngle：停在指定角度、不回正，直到下一次拖曳。pitch 夾在 ±pitchLimit（T-832）。 */
export function holdAt(s: ViewState, yaw: number, pitch: number, pitchLimit = PITCH_LIMIT_DEG): ViewState {
  return { ...s, mode: 'held', yaw, pitch: clampPitch(pitch, pitchLimit), yawVel: 0, pitchVel: 0 };
}

/**
 * 臨界阻尼彈簧的精確解走一步（任何 dt 都穩定，影格長短不影響終點）。
 * x(t) = target + (c1 + c2·t)·e^(−ωt)，c1 = x0 − target，c2 = v0 + ω·c1。
 */
function springStep(x: number, v: number, target: number, dt: number): { x: number; v: number } {
  const c1 = x - target;
  const c2 = v + RETURN_OMEGA * c1;
  const e = Math.exp(-RETURN_OMEGA * dt);
  const nx = target + (c1 + c2 * dt) * e;
  const nv = (v - RETURN_OMEGA * c2 * dt) * e;
  if (Math.abs(nx - target) < SNAP_DEG && Math.abs(nv) < SNAP_SPEED) return { x: target, v: 0 };
  return { x: nx, v: nv };
}

/**
 * 每影格呼叫：只有「回正中」會動，停好後變回 idle。
 * reduced＝作業系統設了減少動態效果（DESIGN §8.3，T-608）：回正、翻面、切面直接放到目標，不經過動畫（main 每格讀當下的設定）。
 */
export function tick(s: ViewState, dtSec: number, reduced = false): ViewState {
  if (s.mode !== 'returning') return s;
  if (reduced) return settleNow(s);
  const y = springStep(s.yaw, s.yawVel, s.targetYaw, dtSec);
  const p = springStep(s.pitch, s.pitchVel, s.targetPitch, dtSec);
  const settled = y.x === s.targetYaw && y.v === 0 && p.x === s.targetPitch && p.v === 0;
  return {
    ...s,
    yaw: y.x,
    pitch: p.x + 0,
    yawVel: y.v,
    pitchVel: p.v,
    mode: settled ? 'idle' : 'returning',
  };
}

/**
 * 切到某一面（分頁或選中那一面的圖層）時，卡片自動轉過去：
 * 目標＝離目前 yaw 最近、屬於那一面的角度（正面 0°＋360° 的倍數、背面 180°＋360° 的倍數），走同一個回正彈簧。
 * 使用者正在拖曳時不搶；已經停在那一面就原樣回傳。
 */
export function turnToFace(s: ViewState, face: FaceSide): ViewState {
  if (s.mode === 'dragging') return s;
  const offset = face === 'front' ? 0 : 180;
  const target = offset + Math.round((s.yaw - offset) / 360) * 360 + 0;
  if (s.yaw === target && s.pitch === 0 && s.mode === 'idle') return s;
  const keepVel = s.mode === 'returning';
  return {
    ...s,
    mode: 'returning',
    targetYaw: target,
    targetPitch: 0,
    yawVel: keepVel ? s.yawVel : 0,
    pitchVel: keepVel ? s.pitchVel : 0,
  };
}

// ---- 鍵盤轉卡（DESIGN §8.2，T-607） ----

/** 連按時，目標最多領先目前角度多少度（按住不放時卡片不會越轉越遠，放手後很快停下來）。 */
export const KEY_MAX_LEAD_DEG = 45;
/** 鍵盤縮放卡片：一次放大或縮小的倍率。 */
export const KEY_ZOOM_FACTOR = 1.1;

/**
 * 用鍵盤轉卡：在目前的目標（正在轉就接在上一次的目標上，連按會累加）再加 dYawDeg／dPitchDeg，平順地轉過去，停在那個角度（不回正）。
 * smooth＝false（作業系統設了減少動態）：直接到位。滑鼠正在拖時不插手。pitch 夾在 ±pitchLimit（預設 PITCH_LIMIT_DEG；工作桌 ±10°，T-832）。
 *
 * 「最多領先 KEY_MAX_LEAD_DEG」只限制連按把目標越推越遠，不把已經在的目標往回拉（T-607c）：
 * - 只按 ↑ ↓（dYawDeg＝0）：yaw 的目標原樣保留（翻面途中按 ↑ 不會把 180° 截成 45°）。
 * - 翻面、回正、放開後回到最近的一面途中（只有它們會讓目標領先超過 45°，鍵盤自己最多 45°）：
 *   ← → 在那一面的角度上加減，最多離那一面 45°（翻面途中按 → ＝ 195°，一直按也停在 225°）。
 */
export function turnByKey(s: ViewState, dYawDeg: number, dPitchDeg: number, smooth: boolean, pitchLimit = PITCH_LIMIT_DEG): ViewState {
  if (s.mode === 'dragging') return s;
  const gliding = s.mode === 'returning';
  const baseYaw = gliding ? s.targetYaw : s.yaw;
  const basePitch = gliding ? s.targetPitch : s.pitch;
  const pitch = clampPitch(basePitch + dPitchDeg, pitchLimit) + 0;
  if (!smooth) {
    const yaw = baseYaw + dYawDeg + 0;
    return { ...s, mode: 'idle', yaw, pitch, targetYaw: yaw, targetPitch: 0, yawVel: 0, pitchVel: 0 };
  }
  let lo = s.yaw - KEY_MAX_LEAD_DEG;
  let hi = s.yaw + KEY_MAX_LEAD_DEG;
  if (Math.abs(baseYaw - s.yaw) > KEY_MAX_LEAD_DEG) {
    // 翻面、回正途中：只以那一面的角度（180° 的倍數）為準 ±45°，不和現在的角度合併
    // （合併的話往現在角度的方向連按，會把翻面一路拉回原本那一面，T-607c 審查）
    const face = Math.round(baseYaw / 180) * 180;
    lo = face - KEY_MAX_LEAD_DEG;
    hi = face + KEY_MAX_LEAD_DEG;
  }
  // 已經在的目標不往回拉
  lo = Math.min(lo, baseYaw);
  hi = Math.max(hi, baseYaw);
  const yaw = Math.min(hi, Math.max(lo, baseYaw + dYawDeg)) + 0;
  return {
    ...s,
    mode: 'returning',
    targetYaw: yaw,
    targetPitch: pitch,
    yawVel: gliding ? s.yawVel : 0,
    pitchVel: gliding ? s.pitchVel : 0,
  };
}

/** 回正中的卡片直接放到目標、不經過動畫（減少動態時回正、翻面用，tick 的 reduced 也走這裡）；沒在回正就原樣回傳。 */
export function settleNow(s: ViewState): ViewState {
  if (s.mode !== 'returning') return s;
  return { ...s, mode: 'idle', yaw: s.targetYaw, pitch: s.targetPitch, yawVel: 0, pitchVel: 0 };
}

/** 現在看到的是哪一面（最近的 180° 倍數；偶數＝正面、奇數＝背面）。 */
export function visibleFace(yaw: number): FaceSide {
  return Math.abs(Math.round(yaw / 180)) % 2 === 0 ? 'front' : 'back';
}

/** 鍵盤縮放卡片：dir＝1 放大、−1 縮小，夾在 ZOOM_MIN～ZOOM_MAX。 */
export function zoomByKey(zoom: number, dir: 1 | -1): number {
  const next = dir > 0 ? zoom * KEY_ZOOM_FACTOR : zoom / KEY_ZOOM_FACTOR;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

// ---- 預覽區下方的〔−〕{縮放比例}〔＋〕（T-835，DESIGN §5.2）：和滾輪、鍵盤同一個 zoom ----

/** 按一下〔＋〕〔−〕改幾個百分點。 */
export const ZOOM_STEP_PERCENT = 10;
/** 判斷「已經到上下限」的容許誤差（滾輪的 exp 乘法、百分比換算的浮點誤差）。 */
const ZOOM_EPS = 1e-6;

/** 縮放比例：預設大小（ZOOM_DEFAULT）＝100%，四捨五入成整數（最遠 53%、最近 118%）。 */
export function zoomPercent(zoom: number): number {
  return Math.round((zoom / ZOOM_DEFAULT) * 100);
}

/**
 * 按一下〔＋〕（dir 1）或〔−〕（dir −1）：照百分比每次 10%，停在 10 的倍數上（滾輪調到 87% 時按〔＋〕到 90%、〔−〕到 80%），
 * 換算回 zoom 再夾在 ZOOM_MIN～ZOOM_MAX。直接到位（和滾輪一樣沒有平滑過渡）。
 */
export function zoomByStep(zoom: number, dir: 1 | -1): number {
  const p = zoomPercent(zoom);
  const target = dir > 0 ? (Math.floor(p / ZOOM_STEP_PERCENT) + 1) * ZOOM_STEP_PERCENT : (Math.ceil(p / ZOOM_STEP_PERCENT) - 1) * ZOOM_STEP_PERCENT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (target / 100) * ZOOM_DEFAULT));
}

/** 還能往這個方向縮放嗎（到上下限那顆按鈕變淡）。 */
export function canZoomStep(zoom: number, dir: 1 | -1): boolean {
  return dir > 0 ? zoom < ZOOM_MAX - ZOOM_EPS : zoom > ZOOM_MIN + ZOOM_EPS;
}

/** 放開但不回正（卡片設定「放開後自動回正」關掉時）：停在放開的角度。 */
export function releaseInPlace(s: ViewState): ViewState {
  if (s.mode !== 'dragging') return s;
  return { ...s, mode: 'idle', yawVel: 0, pitchVel: 0 };
}

/** 調深度時卡片自動小幅擺動（DESIGN §3），讓人立刻看出差別：最大幾度。 */
export const WIGGLE_DEG = 9;
/** 擺一次來回幾秒。 */
const WIGGLE_PERIOD_SEC = 1.1;
/** 停手後幾秒收完（main 用來判斷要不要重新開始一輪）。 */
export const WIGGLE_FADE_SEC = 1.4;

/**
 * 擺動要加在 yaw 上的角度（度）。sinceStart＝這一輪擺動開始了幾秒（從 0 開始所以一開始不跳）；
 * sinceLastChange＝最後一次改深度過了幾秒（停手後線性收掉）。只影響顯示，不改 ViewState。
 * reduced＝減少動態效果（DESIGN §8.3，T-608）：不擺（一律 0）。
 */
export function depthWiggle(sinceStartSec: number, sinceLastChangeSec: number, reduced = false): number {
  if (reduced) return 0;
  if (!(sinceLastChangeSec >= 0) || sinceLastChangeSec >= WIGGLE_FADE_SEC || !(sinceStartSec >= 0)) return 0;
  const envelope = 1 - sinceLastChangeSec / WIGGLE_FADE_SEC;
  return WIGGLE_DEG * Math.sin((2 * Math.PI * sinceStartSec) / WIGGLE_PERIOD_SEC) * envelope + 0;
}

// ---- 展示擺動（card.view.showcase，spec §4.1 第 6 項） ----
// 開關打開、卡片閒著、沒選圖層時，卡片在「最近的一面」附近慢慢擺（左右 ±22°、上下 ±8°，兩個方向週期不同，軌跡像緩慢的纏繞 8 字）。
// 擺動直接寫進 ViewState 的 yaw／pitch（mode 維持 idle），所以拖曳、切面、選圖層都從「畫面上看到的角度」出發，不會跳。

export const SHOWCASE_YAW_DEG = 22;
export const SHOWCASE_PITCH_DEG = 8;
export const SHOWCASE_YAW_PERIOD_SEC = 8;
export const SHOWCASE_PITCH_PERIOD_SEC = 6;
/** 拖曳、回正、取消選取之後，安靜多久才回到擺動。 */
export const SHOWCASE_RESUME_SEC = 1.5;
/** 從目前角度接上擺動軌跡至少要幾秒；離軌跡越遠越久（每 40° 多 1 秒、最多 4 秒），移動才不會太快。 */
export const SHOWCASE_BLEND_SEC = 1.5;
const BLEND_SEC_PER_DEG = 1 / 40;
const BLEND_MAX_SEC = 4;
/** 一格最多算幾秒：分頁在背景放很久再回來時，軌跡不會一格跳到別處。 */
const MAX_STEP_SEC = 0.1;

/** 一輪擺動：從哪個角度出發、繞哪一面擺、已經擺了幾秒。 */
export interface ShowcaseRun {
  readonly fromYaw: number;
  readonly fromPitch: number;
  /** 擺動的中心 yaw（出發時最近的一面：0°、180°…）。 */
  readonly faceYaw: number;
  readonly sinceSec: number;
}

export interface ShowcaseState {
  /** 上一格開關是不是開著（用來認出「剛打開」）。 */
  readonly enabledPrev: boolean;
  /** 沒在擺動時，已經安靜（沒人動卡片）幾秒。 */
  readonly quietSec: number;
  /** 正在擺動的這一輪；沒在擺＝null。 */
  readonly run: ShowcaseRun | null;
}

export interface ShowcaseInput {
  /** card.view.showcase */
  readonly enabled: boolean;
  /** 有選中圖層（要讓人好拖，不擺）。 */
  readonly layerSelected: boolean;
  /** 調深度的小擺動還在進行（以它為準，展示讓開）。 */
  readonly depthWiggling: boolean;
  /** 擺動幅度倍數（T-832：工作桌 0.5＝減半）；省略＝1。 */
  readonly scale?: number;
}

/** 有人動了卡片（鍵盤轉卡，T-607）：這一輪擺動作廢、重新等安靜 SHOWCASE_RESUME_SEC 才接回。 */
export function pauseShowcase(sc: ShowcaseState): ShowcaseState {
  return { ...sc, quietSec: 0, run: null };
}

/** 剛開啟：開關一打開就可以馬上擺（不用先等安靜）。 */
export function initialShowcase(): ShowcaseState {
  return { enabledPrev: false, quietSec: SHOWCASE_RESUME_SEC, run: null };
}

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * 這一輪擺動在 sinceSec 秒時的角度。
 * 軌跡本身＝中心 ± 幅度的正弦（t＝0 在中心）；一開始用 smoothstep 從出發角度慢慢接上軌跡（t＝0 時就是出發角度、速度 0），
 * 接完之後完全等於軌跡。scale＝幅度倍數（T-832 工作桌 0.5：左右、上下都減半）。
 */
export function showcasePose(run: ShowcaseRun, scale = 1): { yaw: number; pitch: number } {
  const t = Math.max(0, run.sinceSec);
  const pathYaw = run.faceYaw + SHOWCASE_YAW_DEG * scale * Math.sin((2 * Math.PI * t) / SHOWCASE_YAW_PERIOD_SEC);
  const pathPitch = SHOWCASE_PITCH_DEG * scale * Math.sin((2 * Math.PI * t) / SHOWCASE_PITCH_PERIOD_SEC);
  const dist = Math.hypot(run.fromYaw - run.faceYaw, run.fromPitch);
  const blend = Math.min(BLEND_MAX_SEC, SHOWCASE_BLEND_SEC + dist * BLEND_SEC_PER_DEG);
  if (t >= blend) return { yaw: pathYaw, pitch: pathPitch + 0 };
  const k = smoothstep(t / blend);
  return {
    yaw: run.fromYaw + (pathYaw - run.fromYaw) * k,
    pitch: run.fromPitch + (pathPitch - run.fromPitch) * k + 0,
  };
}

/**
 * 每影格呼叫（在 tick 之後）：決定這一格要不要擺，要的話把擺動角度寫進 view。
 * - 開關關著：不動；擺動到一半關掉就停在那個角度。
 * - 不是 idle（拖曳中、回正中、setAngle 的 held）、有選圖層、調深度小擺動進行中：不擺，安靜時間歸零；
 *   這些都結束後再安靜 SHOWCASE_RESUME_SEC 才開始擺，從當時的角度平順接上。
 * - setAngle（held）優先於擺動，直到下一次拖曳，或把開關關掉再打開（剛打開那一格解除 held）。
 */
export function stepShowcase(
  sc: ShowcaseState,
  view: ViewState,
  input: ShowcaseInput,
  dtSec: number,
): { showcase: ShowcaseState; view: ViewState } {
  if (!input.enabled) return { showcase: { enabledPrev: false, quietSec: SHOWCASE_RESUME_SEC, run: null }, view };

  let v = view;
  if (!sc.enabledPrev && v.mode === 'held') v = { ...v, mode: 'idle', yawVel: 0, pitchVel: 0 };
  if (v.mode !== 'idle' || input.layerSelected || input.depthWiggling) {
    return { showcase: { enabledPrev: true, quietSec: 0, run: null }, view: v };
  }

  const dt = dtSec > 0 ? Math.min(dtSec, MAX_STEP_SEC) : 0;
  const quietSec = sc.quietSec + dt;
  let run: ShowcaseRun;
  if (sc.run) {
    run = { ...sc.run, sinceSec: sc.run.sinceSec + dt };
  } else if (quietSec >= SHOWCASE_RESUME_SEC) {
    run = { fromYaw: v.yaw, fromPitch: v.pitch, faceYaw: nearestFaceYaw(v.yaw), sinceSec: 0 };
  } else {
    return { showcase: { enabledPrev: true, quietSec, run: null }, view: v };
  }
  const pose = showcasePose(run, input.scale ?? 1);
  return { showcase: { enabledPrev: true, quietSec, run }, view: { ...v, yaw: pose.yaw, pitch: pose.pitch } };
}
