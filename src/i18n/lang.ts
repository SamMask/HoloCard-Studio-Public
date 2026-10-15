// 介面語言（T-828，DESIGN §9）：正體中文（原文）、English、日本語、한국어。
// 模組載入時就決定這次用哪種（換語言＝重新載入頁面，所以各模組的常數照樣可以在載入時讀字典）：
//   沒有 window（node、vitest）→ 一律正體中文（原本斷言中文的測試不用改）；
//   瀏覽器 → localStorage 記過的（holocard.lang；壞值、讀不到就略過）→ navigator.languages 依序找第一個認得的 → 都不認得＝English。
// 選了語言只寫 localStorage（寫不進去不丟錯，同 app/quality-pref 的做法；T-828j 起回傳記住了沒），不存進卡片。

export type Lang = 'zh-Hant' | 'en' | 'ja' | 'ko';

/** 四種語言（頁首清單的順序）。 */
export const LANGS: readonly Lang[] = ['zh-Hant', 'en', 'ja', 'ko'];

/** 頁首語言清單上的名字：每種語言用它自己的文字寫（固定、不翻）。 */
export const LANG_NAMES: Readonly<Record<Lang, string>> = { 'zh-Hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어' };

/** 頁首語言按鈕上的短名（固定、不翻）。 */
export const LANG_SHORT_NAMES: Readonly<Record<Lang, string>> = { 'zh-Hant': '中文', en: 'EN', ja: '日本語', ko: '한국어' };

/** 記在 localStorage 的哪個名字下。 */
export const LANG_STORAGE_KEY = 'holocard.lang';

/** localStorage 用到的那兩個函式。 */
export interface LangStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 決定語言要看的瀏覽器東西（window 本身就符合）；測試用一般物件。 */
export interface LangWindow {
  readonly localStorage?: LangStorage | null;
  readonly navigator?: { readonly languages?: readonly string[]; readonly language?: string } | null;
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** 語言碼的開頭是不是 code（本身，或後面接 -，例如 zh、zh-TW；不分大小寫）。 */
const startsWith = (tag: string, code: string) => {
  const t = tag.toLowerCase();
  return t === code || t.startsWith(`${code}-`);
};

/** navigator.languages 依序找第一個認得的：zh*→正體中文、ja*→日本語、ko*→한국어、en*→English；都不認得＝English。 */
export function langFromNavigator(languages: readonly string[]): Lang {
  for (const tag of languages) {
    if (typeof tag !== 'string') continue;
    if (startsWith(tag, 'zh')) return 'zh-Hant';
    if (startsWith(tag, 'ja')) return 'ja';
    if (startsWith(tag, 'ko')) return 'ko';
    if (startsWith(tag, 'en')) return 'en';
  }
  return 'en';
}

/** 記過的（合格才算）優先，其他照瀏覽器語言。 */
export function pickLang(stored: string | null, languages: readonly string[]): Lang {
  return isLang(stored) ? stored : langFromNavigator(languages);
}

const browserStorage = (): LangStorage | null => (typeof window === 'undefined' ? null : window.localStorage);

/** 讀記過的語言；拿 localStorage 就丟錯、沒有、getItem 丟錯 → null（不丟錯）。 */
export function readStoredLang(getStorage: () => LangStorage | null = browserStorage): string | null {
  try {
    return getStorage()?.getItem(LANG_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** 這次用哪種語言。win＝undefined（沒有 window：node、vitest）→ 一律正體中文。 */
export function detectLang(win: LangWindow | undefined): Lang {
  if (win === undefined) return 'zh-Hant';
  const stored = readStoredLang(() => win.localStorage ?? null);
  let languages: readonly string[] = [];
  try {
    const nav = win.navigator;
    languages = nav?.languages && nav.languages.length > 0 ? nav.languages : nav?.language ? [nav.language] : [];
  } catch {
    languages = [];
  }
  return pickLang(stored, languages);
}

/**
 * 記下選的語言（下次載入生效）；不丟錯。回傳記住了沒（T-828j）：寫完讀回來還是它才算——
 * 拿不到 localStorage、setItem 丟錯、寫了卻沒留下都回 false（換語言就不重新載入：重新載入也只會照瀏覽器語言，選了等於沒選）。
 */
export function setLang(next: Lang, getStorage: () => LangStorage | null = browserStorage): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(LANG_STORAGE_KEY, next);
    return storage.getItem(LANG_STORAGE_KEY) === next;
  } catch {
    return false;
  }
}

/** 這次載入用的語言（模組載入時決定，之後不變）。 */
export const lang: Lang = detectLang(typeof window === 'undefined' ? undefined : window);
