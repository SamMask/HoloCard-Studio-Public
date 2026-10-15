// 復原／重做堆疊（SCHEMA.md §1.2）：泛型、不可變；每個函式都回傳新的 History，不改舊的。
// 一次拖曳＝一步：拖曳中用 preview 只換 present，放開時 commit 才記成一步。
// 「有沒有改變」用同一個物件判斷（actions 沒有改變時會回傳原卡）。
//
// 拖曳中每次 preview 都要從 draftBase(h)（＝ h.previewBase ?? h.present）算新值，不要從 h.present 疊算：
// 這樣才能在拖回原值時算出「和拖之前同一個物件」，放開時 commit 判斷沒有改變、不多記一步。

export interface History<T> {
  /** 由舊到新；最多 limit 步。 */
  readonly past: readonly T[];
  readonly present: T;
  /** 下一個要重做的在第 0 個。 */
  readonly future: readonly T[];
  /** 拖曳中＝第一次 preview 之前的狀態；沒有在拖曳＝null。 */
  readonly previewBase: T | null;
  readonly limit: number;
}

/** SCHEMA 要求至少 50 步。 */
export const DEFAULT_HISTORY_LIMIT = 100;

function pushPast<T>(past: readonly T[], item: T, limit: number): readonly T[] {
  const next = [...past, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** 拖曳中每次 preview 要從這張算新值：拖曳中＝拖之前的狀態（previewBase），沒有在拖曳＝目前的狀態。 */
export function draftBase<T extends {}>(h: History<T>): T {
  return h.previewBase ?? h.present;
}

/** limit 不是 ≥1 的有限數字時用預設值。T 不可以是 null／undefined（null 用來表示「沒有在拖曳」）。 */
export function createHistory<T extends {}>(initial: T, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  const lim = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : DEFAULT_HISTORY_LIMIT;
  return { past: [], present: initial, future: [], previewBase: null, limit: lim };
}

/** 放開：把這次拖曳（第一次 preview 之前 → 現在）算成一步；沒變就不記。沒有在拖曳就原樣回傳。 */
export function commit<T extends {}>(h: History<T>): History<T> {
  if (h.previewBase === null) return h;
  if (h.present === h.previewBase) return { ...h, previewBase: null };
  return {
    past: pushPast(h.past, h.previewBase, h.limit),
    present: h.present,
    future: [],
    previewBase: null,
    limit: h.limit,
  };
}

/** 記一步：present 推進 past、清空 future；和 present 同一個物件就不記。拖曳中呼叫會先 commit 這次拖曳。 */
export function apply<T extends {}>(h: History<T>, next: T): History<T> {
  const base = commit(h);
  if (next === base.present) return base;
  return {
    past: pushPast(base.past, base.present, base.limit),
    present: next,
    future: [],
    previewBase: null,
    limit: base.limit,
  };
}

/** 拖曳中：只換 present、不記步；第一次 preview 時記住拖之前的狀態。重做在 commit 有改變時才清掉。 */
export function preview<T extends {}>(h: History<T>, next: T): History<T> {
  return { ...h, present: next, previewBase: draftBase(h) };
}

/** 放棄這次拖曳、回到拖之前。沒有在拖曳就原樣回傳。 */
export function cancel<T extends {}>(h: History<T>): History<T> {
  if (h.previewBase === null) return h;
  return { ...h, present: h.previewBase, previewBase: null };
}

/** 拖曳中呼叫會先 commit 這次拖曳，再復原它（回到拖之前）。 */
export function undo<T extends {}>(h: History<T>): History<T> {
  const base = commit(h);
  if (base.past.length === 0) return base;
  return {
    past: base.past.slice(0, -1),
    present: base.past[base.past.length - 1],
    future: [base.present, ...base.future],
    previewBase: null,
    limit: base.limit,
  };
}

/** 拖曳中呼叫會先 commit（有改變就清掉重做，所以停在拖曳結果）。 */
export function redo<T extends {}>(h: History<T>): History<T> {
  const base = commit(h);
  if (base.future.length === 0) return base;
  return {
    past: pushPast(base.past, base.present, base.limit),
    present: base.future[0],
    future: base.future.slice(1),
    previewBase: null,
    limit: base.limit,
  };
}

/** 和 undo 的行為一致：拖曳中且有改變也算可以復原。 */
export function canUndo<T extends {}>(h: History<T>): boolean {
  return commit(h).past.length > 0;
}

/** 和 redo 的行為一致：拖曳中且有改變時，放開會清掉重做，所以算不能重做。 */
export function canRedo<T extends {}>(h: History<T>): boolean {
  return commit(h).future.length > 0;
}
