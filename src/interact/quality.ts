// 效能自動降級（T-809，DESIGN §8.4）：電腦跑不動時自動降低「工坊預覽」的畫質，跑得動再開回來。
// 純狀態機＋把它接起來的小控制器；不碰 DOM、three.js、localStorage（開關存在 app/quality-pref.ts）。
// 量法：影格迴圈每格交進來這一格花了幾毫秒；分頁隱藏、或兩格間隔超過 250 ms（背景節流、剛切回分頁）的影格不算。
// 時間用「有算的影格自己的毫秒數」累積（不看真的時鐘），隱藏的時間不會被算進視窗。
// 降級：每累積滿 3 秒看一次，平均每格超過 25 ms 就降一級；恢復：每累積滿 10 秒看一次，平均低於 18 ms 就升一級。
// 每次等級變動兩個視窗都清掉重量，所以降級後至少再等 3 秒、升級後至少再等 10 秒才會再動。
// 三級（累加）：1 像素比降到 1.25；2 再關預覽的景深陰影；3 像素比降到 1。PNG、影片、GIF、縮圖不受影響（render 擷取時一律完整畫質）。

export type QualityLevel = 0 | 1 | 2 | 3;

const MAX_LEVEL: QualityLevel = 3;

/** DESIGN §8.4 的數字。 */
export const QUALITY_TUNING = {
  /** 兩格間隔超過這麼多毫秒的影格不算。 */
  skipOverMs: 250,
  /** 降級：每累積滿這麼久看一次… */
  downWindowMs: 3000,
  /** …平均每格超過這麼多毫秒就降一級。 */
  downAboveMs: 25,
  /** 恢復：每累積滿這麼久看一次… */
  upWindowMs: 10000,
  /** …平均每格低於這麼多毫秒就升一級。 */
  upBelowMs: 18,
} as const;

/** 一個量測視窗：累積的毫秒數與影格數。 */
interface Window {
  readonly ms: number;
  readonly frames: number;
}

const EMPTY: Window = { ms: 0, frames: 0 };

export interface QualityState {
  readonly level: QualityLevel;
  /** 降級視窗（3 秒）。 */
  readonly down: Window;
  /** 恢復視窗（10 秒）；0 級時不累積。 */
  readonly up: Window;
}

export function initialQuality(): QualityState {
  return { level: 0, down: EMPTY, up: EMPTY };
}

const add = (w: Window, ms: number): Window => ({ ms: w.ms + ms, frames: w.frames + 1 });

/**
 * 吃一個影格，回新狀態（不改輸入）。
 * frameMs＝這一格距離上一格幾毫秒；hidden＝分頁現在是不是隱藏的（document.hidden）；enabled＝使用者有沒有開自動降級。
 * 沒開＝馬上回 0 級並清掉量測；不算的影格（隱藏、超過 250 ms、不是正常的正數）原樣回傳。
 */
export function qualityStep(state: QualityState, frameMs: number, hidden: boolean, enabled: boolean): QualityState {
  const t = QUALITY_TUNING;
  if (!enabled) return state.level === 0 && state.down === EMPTY && state.up === EMPTY ? state : initialQuality();
  if (hidden || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > t.skipOverMs) return state;

  let down = add(state.down, frameMs);
  let up = state.level > 0 ? add(state.up, frameMs) : EMPTY;
  if (down.ms >= t.downWindowMs) {
    if (down.ms / down.frames > t.downAboveMs && state.level < MAX_LEVEL) {
      return { level: (state.level + 1) as QualityLevel, down: EMPTY, up: EMPTY };
    }
    down = EMPTY;
  }
  if (state.level > 0 && up.ms >= t.upWindowMs) {
    if (up.ms / up.frames < t.upBelowMs) {
      return { level: (state.level - 1) as QualityLevel, down: EMPTY, up: EMPTY };
    }
    up = EMPTY;
  }
  return { level: state.level, down, up };
}

/** 交給 render 的預覽畫質（render 不 import interact，所以是兩個普通數值）。 */
export interface QualitySettings {
  /** 像素比上限（再和螢幕本來的像素比、render 自己的上限取最小）；Infinity＝不另外限制。 */
  pixelRatioCap: number;
  /** 預覽要不要畫景深陰影（擷取一律畫）。 */
  shadows: boolean;
}

const LEVELS: readonly QualitySettings[] = [
  { pixelRatioCap: Number.POSITIVE_INFINITY, shadows: true },
  { pixelRatioCap: 1.25, shadows: true },
  { pixelRatioCap: 1.25, shadows: false },
  { pixelRatioCap: 1, shadows: false },
];

/** 某一級的預覽畫質（0＝完整）。 */
export function qualitySettings(level: QualityLevel): QualitySettings {
  return { ...LEVELS[level]! };
}

export interface QualityGovernorDeps {
  /** 一開始有沒有開自動降級（使用者的設定）。 */
  enabled: boolean;
  /** 分頁現在是不是隱藏的（document.hidden）。 */
  hidden(): boolean;
  /** 等級變了（降、升、或關掉自動降級回到 0）：把新的預覽畫質交給 render。沒變不呼叫。 */
  apply(settings: QualitySettings, level: QualityLevel): void;
  /** 第一次降級時叫一次，讓畫面說一句話；回 false＝這次沒說成（例如還沒有地方顯示），下一次降級再試。 */
  notice(): boolean | void;
  /**
   * 螢幕本來的像素比（window.devicePixelRatio）。給了就跳過「在這台螢幕上畫面不會變」的等級
   * （例如像素比 1 的螢幕，降到 1.25 沒有效果：0 級直接降到 2 級關陰影；主對話 T-809 驗收時決定）。沒給＝每一級都當有效果。
   */
  pixelRatio?(): number;
}

export interface QualityGovernor {
  /** 每個影格叫一次，dtSec＝這一格距離上一格幾秒（影格迴圈給的）。 */
  frame(dtSec: number): void;
  /** 說明面板的開關。關掉＝馬上回完整畫質；再打開＝從頭量。 */
  setEnabled(on: boolean): void;
  level(): QualityLevel;
}

export function createQualityGovernor(deps: QualityGovernorDeps): QualityGovernor {
  let enabled = deps.enabled;
  let state = initialQuality();
  /** 提示說過了：這次開著工坊只說一次（關掉再打開、升回去又降也不再說）。 */
  let noticed = false;

  /** 某一級在這台螢幕上實際的畫面（像素比取 min(螢幕, 2, 上限)＋陰影）；兩級一樣＝切過去畫面不會變。 */
  const effect = (level: QualityLevel): string => {
    const s = qualitySettings(level);
    return deps.pixelRatio ? `${Math.min(deps.pixelRatio(), 2, s.pixelRatioCap)}|${s.shadows}` : String(level);
  };
  const change = (next: QualityState) => {
    const before = state.level;
    if (next.level === before) {
      state = next;
      return;
    }
    // 沒有效果的等級跳過：繼續往同一個方向走到畫面真的會變的那一級
    const dir = next.level > before ? 1 : -1;
    let level = next.level;
    while (effect(level) === effect(before) && level + dir >= 0 && level + dir <= MAX_LEVEL) level = (level + dir) as QualityLevel;
    // 降級走到底畫面還是一樣（例如像素比 1 的螢幕已經在 2 級）：不降，只清掉降級的視窗；
    // 恢復的累積照留（等級沒變，不然快慢交替時永遠升不回來，T-809 審查）
    if (dir > 0 && effect(level) === effect(before)) {
      state = { level: before, down: next.down, up: state.up };
      return;
    }
    state = { ...next, level };
    deps.apply(qualitySettings(level), level);
    if (level > before && !noticed) noticed = deps.notice() !== false;
  };

  return {
    frame(dtSec) {
      change(qualityStep(state, dtSec * 1000, deps.hidden(), enabled));
    },
    setEnabled(on) {
      enabled = on;
      change(qualityStep(state, 0, false, on));
    },
    level: () => state.level,
  };
}
