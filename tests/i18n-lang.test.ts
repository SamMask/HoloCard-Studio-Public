// T-828a 語言（DESIGN §9）：第一次開照瀏覽器語言自動選、選過就記在 localStorage（holocard.lang）、壞值與讀不到都略過；
// 沒有 window（node、vitest）一律正體中文；四份字典的鍵與函式參數一樣多；範例卡名字跟著語言。
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { S, lang } from '../src/i18n/index';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import {
  detectLang,
  isLang,
  LANG_NAMES,
  LANG_SHORT_NAMES,
  LANG_STORAGE_KEY,
  LANGS,
  langFromNavigator,
  pickLang,
  readStoredLang,
  setLang,
  type LangStorage,
} from '../src/i18n/lang';
import { zhHant } from '../src/i18n/zh-Hant';

function fakeStorage(initial: Record<string, string> = {}): LangStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('瀏覽器語言 → 介面語言（navigator.languages 依序找第一個認得的）', () => {
  it('zh* → 正體中文、ja* → 日本語、ko* → 한국어、en* → English（不分大小寫、地區碼不管）', () => {
    expect(langFromNavigator(['zh-TW'])).toBe('zh-Hant');
    expect(langFromNavigator(['zh-CN'])).toBe('zh-Hant');
    expect(langFromNavigator(['zh'])).toBe('zh-Hant');
    expect(langFromNavigator(['zh-Hant-HK'])).toBe('zh-Hant');
    expect(langFromNavigator(['ja-JP'])).toBe('ja');
    expect(langFromNavigator(['ja'])).toBe('ja');
    expect(langFromNavigator(['ko-KR'])).toBe('ko');
    expect(langFromNavigator(['EN-us'])).toBe('en');
    expect(langFromNavigator(['en-GB'])).toBe('en');
  });

  it('照順序：第一個認得的贏，不認得的跳過', () => {
    expect(langFromNavigator(['fr-FR', 'de', 'ja-JP', 'en-US'])).toBe('ja');
    expect(langFromNavigator(['ko', 'zh-TW'])).toBe('ko');
    expect(langFromNavigator(['en-US', 'zh-TW'])).toBe('en');
  });

  it('都不認得、空清單 → English', () => {
    expect(langFromNavigator(['fr-FR', 'de-DE', 'es'])).toBe('en');
    expect(langFromNavigator([])).toBe('en');
  });

  it('「zhx」「japan」這種不是語言碼開頭的不算（只認語言碼本身或後面接 -）', () => {
    expect(langFromNavigator(['zhx', 'japan', 'korean'])).toBe('en');
  });
});

describe('記過的語言優先（localStorage holocard.lang）', () => {
  it('記過合格的語言 → 用它，不管瀏覽器語言', () => {
    expect(pickLang('ko', ['zh-TW'])).toBe('ko');
    expect(pickLang('zh-Hant', ['en-US'])).toBe('zh-Hant');
    expect(pickLang('en', ['ja'])).toBe('en');
  });

  it('壞值（亂寫的、大小寫不對、舊格式）略過 → 照瀏覽器語言', () => {
    for (const bad of ['', 'zh', 'zh-TW', 'EN', 'fr', 'null', '{}']) expect(pickLang(bad, ['ja-JP']), bad).toBe('ja');
    expect(pickLang(null, ['ko-KR'])).toBe('ko');
  });

  it('isLang 只認四種', () => {
    for (const l of LANGS) expect(isLang(l)).toBe(true);
    for (const bad of ['zh', 'jp', 'kr', '', null, undefined, 3]) expect(isLang(bad)).toBe(false);
  });

  it('讀不到 localStorage（拿就丟錯、沒有、getItem 丟錯）→ null，不丟錯', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(readStoredLang(boom)).toBeNull();
    expect(readStoredLang(() => null)).toBeNull();
    expect(
      readStoredLang(() => ({
        getItem() {
          throw new Error('壞了');
        },
        setItem() {},
      })),
    ).toBeNull();
    expect(readStoredLang(() => fakeStorage({ [LANG_STORAGE_KEY]: 'ja' }))).toBe('ja');
  });
});

describe('決定這次用哪種語言（detectLang）', () => {
  it('沒有 window（node、vitest）→ 一律正體中文', () => {
    expect(detectLang(undefined)).toBe('zh-Hant');
  });

  it('瀏覽器：記過的 → 記過的；沒記過 → navigator.languages；都沒有 → English', () => {
    expect(detectLang({ localStorage: fakeStorage({ [LANG_STORAGE_KEY]: 'ko' }), navigator: { languages: ['ja-JP'] } })).toBe('ko');
    expect(detectLang({ localStorage: fakeStorage(), navigator: { languages: ['ja-JP', 'en'] } })).toBe('ja');
    expect(detectLang({ localStorage: fakeStorage(), navigator: { languages: [] } })).toBe('en');
    expect(detectLang({ localStorage: fakeStorage(), navigator: { languages: ['fr'] } })).toBe('en');
  });

  it('沒有 languages 清單時看 navigator.language；連 navigator 都沒有 → English', () => {
    expect(detectLang({ localStorage: fakeStorage(), navigator: { language: 'zh-TW' } })).toBe('zh-Hant');
    expect(detectLang({ localStorage: fakeStorage() })).toBe('en');
  });

  it('拿 localStorage 就丟錯（被擋）：略過，照瀏覽器語言', () => {
    const win = {
      get localStorage(): LangStorage {
        throw new DOMException('denied', 'SecurityError');
      },
      navigator: { languages: ['ko-KR'] },
    };
    expect(detectLang(win)).toBe('ko');
  });

  it('壞值略過：照瀏覽器語言', () => {
    expect(detectLang({ localStorage: fakeStorage({ [LANG_STORAGE_KEY]: 'klingon' }), navigator: { languages: ['zh-HK'] } })).toBe('zh-Hant');
  });
});

describe('選了語言就記起來（setLang 只寫 localStorage）', () => {
  it('寫進 holocard.lang，不碰別的鍵；下次讀得到；回傳 true（T-828j）', () => {
    const storage = fakeStorage({ 'holocard.tour.seen': '1' });
    expect(setLang('ja', () => storage)).toBe(true);
    expect(storage.data.get(LANG_STORAGE_KEY)).toBe('ja');
    expect(storage.data.get('holocard.tour.seen')).toBe('1');
    expect(detectLang({ localStorage: storage, navigator: { languages: ['en'] } })).toBe('ja');
  });

  it('寫不進去（拿就丟錯、setItem 丟錯、沒有 localStorage、寫了讀回來不是它）不丟錯，回傳 false（T-828j：換語言就不重新載入）', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(setLang('en', boom)).toBe(false);
    expect(setLang('en', () => null)).toBe(false);
    expect(
      setLang('en', () => ({
        getItem: () => null,
        setItem() {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      })),
    ).toBe(false);
    // 不丟錯、卻沒寫進去（讀回來還是舊的）
    expect(setLang('en', () => ({ getItem: () => 'ja', setItem() {} }))).toBe(false);
  });

  it('沒有 window（node）：預設的 storage 拿不到也不丟錯（回傳 false）', () => {
    expect(() => setLang('ko')).not.toThrow();
    expect(setLang('ko')).toBe(false);
  });
});

describe('目前語言與字典', () => {
  it('測試環境（沒有 window）是正體中文，S 就是原文字典', () => {
    expect(lang).toBe('zh-Hant');
    expect(S).toBe(zhHant);
  });

  it('語言清單：四種，各用自己的文字寫（固定、不翻）；頁首按鈕的短名', () => {
    expect([...LANGS]).toEqual(['zh-Hant', 'en', 'ja', 'ko']);
    expect(LANG_NAMES).toEqual({ 'zh-Hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어' });
    expect(LANG_SHORT_NAMES).toEqual({ 'zh-Hant': '中文', en: 'EN', ja: '日本語', ko: '한국어' });
  });

  /** 字典的「形狀」：每個鍵的種類（字串、函式幾個參數、陣列幾項、物件再往下）。 */
  const shape = (v: unknown): unknown => {
    if (typeof v === 'function') return `fn/${v.length}`;
    if (Array.isArray(v)) return v.map(shape);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
    return typeof v;
  };

  it('四份字典的鍵、種類、函式參數個數、陣列長度都一樣（tsc 也會擋，這裡是執行時再核對一次）', () => {
    const base = shape(zhHant);
    expect(shape(en)).toEqual(base);
    expect(shape(ja)).toEqual(base);
    expect(shape(ko)).toEqual(base);
  });

  it('原文字典沒有空字串', () => {
    const empty: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') {
        if (v.trim() === '') empty.push(path);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(zhHant, 'zhHant');
    expect(empty).toEqual([]);
  });
});
