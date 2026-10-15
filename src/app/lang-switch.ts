// 換介面語言（T-828a，DESIGN §9「切換」）：選了別的語言 → 先等進行中的上傳、加文字、匯入做完 → 存檔存好（「儲存中…」時等它）
// → 記下語言（localStorage）→ 整頁重新載入成新語言（卡片自動存著，回來還是同一張卡、同一面）。
// 存不到時不換、照「沒存到」的規則提醒（頁首已經是紅字「沒存到」＋〔匯出備份〕，提示列再說一句）。
// AI 去背／拆層還在做（T-828g）：重新載入會把它中斷 → 不換、提示一句「做完再換」（開始前、存好之後各看一次；不寫 localStorage）。
// 選目前的語言不做事；等的時候再按不會重來一次（只換第一次選的）。組裝在 main.ts，這裡只有順序（測試用假的）。
// T-828j（審查修正）：
// - 等的時候畫面照樣能操作（不擋畫面）：這段又排進新的工作（例如剛上傳的圖還在處理）→ 再等一輪、再存，
//   直到「等工作＋存好」的這一輪中間沒有新的工作排進來，才記語言、重新載入（之後到重新載入都是同步的，中間插不進操作）。
// - 剛上傳的圖正在問「要怎麼用」（或 AI 問要不要當底圖）：圖還沒加進卡片，重新載入就不見了 → 不換、提示先回答（開始前、存好之後各看一次）。
// - 語言寫不進 localStorage：重新載入也不會變 → 不重新載入、提示一句。
// - 等的時候被別的分頁接手（存檔停住、也算存好）：重新載入會把編輯權搶回來 → 不換、不記任何東西、不提示（接手的遮罩已經在說明）。
// - 回來同一面：重新載入前把卡片 id 與面別記在 sessionStorage（只有這個分頁、只用一次），開好同一張卡才還原（rememberPlace／takePlace）。

import type { Lang } from '../i18n/lang';
import type { FaceSide } from '../model/types';
import type { AutoSaver } from './autosave';

export interface LangSwitchDeps {
  /** 這次載入用的語言。 */
  current: Lang;
  /**
   * 進行中的工作排到哪（上傳、加文字、匯入、建立範例副本各一條隊伍：main 給各隊伍目前的 Promise）。
   * 排進新的工作，這份清單裡就會換成新的 Promise（逐項比對是不是同一個）。
   */
  work(): readonly unknown[];
  /** 等進行中的工作做完（上傳、加文字、匯入、建立範例副本；重新載入會把它們丟掉）。 */
  settle(): Promise<void>;
  /** 存好目前這張（saveUntilSaved）；存不到回 false。 */
  save(): Promise<boolean>;
  /** 記下語言（i18n 的 setLang）；寫不進去回 false。 */
  remember(lang: Lang): boolean;
  /** 整頁重新載入（location.reload；main 在這之前記下回來要開的那一面）。 */
  reload(): void;
  /** 存不到、不換：提醒。 */
  notSaved(): void;
  /** 語言記不住、不換：提示一句。 */
  notRemembered(): void;
  /** AI 去背／拆層正在做（或正在問要不要繼續）：重新載入會中斷它。 */
  aiBusy(): boolean;
  /** AI 還在做、不換：提示一句。 */
  aiWorking(): void;
  /** 剛上傳的圖正在等使用者回答怎麼用（上傳的確認框、AI 問要不要當底圖）：圖還沒加進卡片。 */
  asking(): boolean;
  /** 還有問題沒回答、不換：提示一句。 */
  answerFirst(): void;
  /** 還拿著編輯權嗎（tab-lock 的 holding）：等的時候被別的分頁接手 → 存檔停住，重新載入會把編輯權搶回來。 */
  holding(): boolean;
}

export type LangSwitchResult = 'same' | 'busy' | 'ai-busy' | 'asking' | 'handed-off' | 'not-saved' | 'not-remembered' | 'reloading';

const sameWork = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 回傳「換成這種語言」的函式。 */
export function createLangSwitcher(deps: LangSwitchDeps): (next: Lang) => Promise<LangSwitchResult> {
  let switching = false;
  /** 重新載入會丟掉東西就不換（AI 在做、剛上傳的圖在等回答）：提示一句、回傳原因；可以換＝null。 */
  const blocker = (): LangSwitchResult | null => {
    if (deps.aiBusy()) {
      deps.aiWorking();
      return 'ai-busy';
    }
    if (deps.asking()) {
      deps.answerFirst();
      return 'asking';
    }
    return null;
  };
  return async (next) => {
    if (next === deps.current) return 'same';
    if (switching) return 'busy';
    const before = blocker();
    if (before) return before;
    switching = true;
    try {
      let saved = false;
      try {
        // 等工作、存好；這一輪中間又排進新的工作（等的時候畫面照樣能操作）就再一輪
        for (;;) {
          const work = deps.work();
          await deps.settle();
          saved = await deps.save();
          if (!saved || sameWork(work, deps.work())) break;
        }
      } catch (err) {
        console.error(err);
        saved = false;
      }
      // 等的時候被別的分頁接手了（存檔停住後也會回「存好」）：不換、不寫 localStorage／sessionStorage、不提示（接手的遮罩已經在說明）。
      // 從這裡到重新載入都是同步的，這一次檢查也就是重新載入前的檢查
      if (!deps.holding()) return 'handed-off';
      if (!saved) {
        deps.notSaved();
        return 'not-saved';
      }
      // 等的空檔 AI 才開始、上傳做完跳出問題：最後一刻再看一次（從這裡到重新載入都是同步的）
      const after = blocker();
      if (after) return after;
      if (!deps.remember(next)) {
        deps.notRemembered();
        return 'not-remembered';
      }
      deps.reload();
      return 'reloading';
    } finally {
      switching = false;
    }
  };
}

/**
 * 存到目前這一版為止（含卡片庫縮圖，回來時卡片庫是最新樣子）：還在存就等它；存的時候又改了就再存一次。
 * 至少 flush 一次（含縮圖，T-828j）：卡片資料早就存好時，卡片庫的縮圖可能還不是這一版（停手 2 秒才拍）——
 * 已經存好的卡只補縮圖，沒改過的備援卡什麼都不寫（autosave 的規則）。
 * 已經存好、沒有卡、沒改過的備援卡都算存好。存失敗（含存檔不能用）回 false。
 */
export async function saveUntilSaved<C>(saver: Pick<AutoSaver, 'flush'> & { isSaved(card: C | null): boolean }, current: () => C | null): Promise<boolean> {
  do {
    if (!(await saver.flush({ thumbnail: true }))) return false;
  } while (!saver.isSaved(current()));
  return true;
}

// ---- 回來同一張卡、同一面（T-828j，DESIGN §9）----

/** 記在 sessionStorage 的哪個名字下（只有這個分頁看得到、關掉分頁就沒了）。 */
export const RETURN_PLACE_KEY = 'holocard.langReturn';

/** 重新載入前開著的卡與給人看的那一面。 */
export interface ReturnPlace {
  cardId: string;
  face: FaceSide;
}

/** sessionStorage 用到的那三個函式。 */
export interface PlaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const sessionStore = (): PlaceStorage | null => (typeof window === 'undefined' ? null : window.sessionStorage);

/** 重新載入前記下來；寫不進去就算了（回來照舊開正面）。 */
export function rememberPlace(place: ReturnPlace, getStorage: () => PlaceStorage | null = sessionStore): void {
  try {
    getStorage()?.setItem(RETURN_PLACE_KEY, JSON.stringify({ cardId: place.cardId, face: place.face }));
  } catch {
    // 寫不進去：回來照舊開正面
  }
}

/** 讀記下來的（讀一次就清掉）；沒有、壞值、讀不到 → null（不丟錯）。 */
export function takePlace(getStorage: () => PlaceStorage | null = sessionStore): ReturnPlace | null {
  let raw: string | null = null;
  try {
    const storage = getStorage();
    raw = storage?.getItem(RETURN_PLACE_KEY) ?? null;
    storage?.removeItem(RETURN_PLACE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { cardId, face } = value as { cardId?: unknown; face?: unknown };
    if (typeof cardId !== 'string' || cardId === '' || (face !== 'front' && face !== 'back')) return null;
    return { cardId, face };
  } catch {
    return null;
  }
}
