// 目前語言的字典（T-828，DESIGN §9）：各模組 `import { S } from '../i18n'` 讀介面文字。
// 語言在模組載入時就決定（lang.ts），換語言＝重新載入頁面，所以模組層級的常數照樣可以用；
// node（vitest）裡沒有 window，一律是正體中文原文。
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';
import { lang, type Lang } from './lang';
import { zhHant, type Strings } from './zh-Hant';

const DICTS: Readonly<Record<Lang, Strings>> = { 'zh-Hant': zhHant, en, ja, ko };

/** 目前語言的字典。 */
export const S: Strings = DICTS[lang];

export { lang };
export type { Lang, Strings };
