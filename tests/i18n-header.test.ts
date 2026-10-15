// T-828a 頁首的語言按鈕與清單（DESIGN §9「切換」）：在〔?〕左邊，地球＋目前語言的短名；按了展開清單，
// 每種語言用它自己的文字寫（繁體中文、English、日本語、한국어），目前那個標著；選了別的 → intents.changeLanguage；
// 鍵盤同其他選單（Enter／空白鍵＝按鈕打開、方向鍵選、Esc 由 app 關選單）。〔匯出 ▾〕選單不受影響。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANG_NAMES, LANGS } from '../src/i18n/lang';
import { createHeader } from '../src/ui/header';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeElement, FakeEvent, installFakeDom, isShown, keydown, type FakeDom } from './ui-fake-dom';

let dom: FakeDom;
const active = () => dom.document.activeElement;

beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function header() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      return undefined;
    },
  });
  const h = createHeader(intents, { openLibrary: () => {}, openNewCard: () => {}, exportTurntable: async () => {}, toggleHelp: () => {} });
  const el = h.el as unknown as FakeElement;
  const langBtn = byClass(el, 'lang-btn');
  const menu = byClass(el, 'lang-menu');
  return { h, el, calls, langBtn, menu, items: all(menu, 'menu-item') };
}

describe('頁首的語言按鈕', () => {
  it('在〔?〕左邊；按鈕上是目前語言的短名（node 裡＝中文），有滑過說明與報讀名字', () => {
    const t = header();
    const kids = t.el.childNodes as FakeElement[];
    const langAt = kids.findIndex((k) => k === t.langBtn || k.querySelectorAll('.lang-btn').includes(t.langBtn));
    const helpAt = kids.indexOf(t.h.helpButton as unknown as FakeElement);
    expect(langAt).toBeGreaterThanOrEqual(0);
    expect(langAt).toBe(helpAt - 1);
    expect(t.langBtn.textContent).toContain('中文');
    expect(t.langBtn.title).toBe('換介面語言');
    expect(t.langBtn.getAttribute('aria-label')).toBe('介面語言（目前是繁體中文）');
    expect(t.langBtn.getAttribute('aria-haspopup')).toBe('menu');
    expect(isShown(t.menu)).toBe(false);
  });

  it('按了展開清單：四種語言、各用自己的文字寫、各自標 lang；目前那個標著（aria-checked）；焦點在目前那個', () => {
    const t = header();
    t.langBtn.focus();
    t.langBtn.click();
    expect(isShown(t.menu)).toBe(true);
    expect(t.langBtn.getAttribute('aria-expanded')).toBe('true');
    expect(t.items.map((i) => i.textContent)).toEqual(['繁體中文', 'English', '日本語', '한국어']);
    expect(t.items.map((i) => i.getAttribute('lang'))).toEqual([...LANGS]);
    expect(t.items.map((i) => i.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitemradio']);
    expect(t.items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    expect(t.items[0]!.classList.contains('is-current')).toBe(true);
    expect(active()).toBe(t.items[0]);
    expect(Object.values(LANG_NAMES)).toEqual(t.items.map((i) => i.textContent));
  });

  it('方向鍵在語言之間移動（到頭停住）', () => {
    const t = header();
    t.langBtn.click();
    keydown(t.items[0], 'ArrowDown');
    expect(active()).toBe(t.items[1]);
    keydown(t.items[1], 'End');
    expect(active()).toBe(t.items[3]);
    keydown(t.items[3], 'ArrowDown');
    expect(active()).toBe(t.items[3]);
  });

  it('選別的語言：收起清單、焦點回到按鈕、送 changeLanguage（等存好、重新載入由組裝端做）', () => {
    const t = header();
    t.langBtn.click();
    t.items[1]!.click();
    expect(isShown(t.menu)).toBe(false);
    expect(active()).toBe(t.langBtn);
    expect(t.calls).toEqual([{ name: 'changeLanguage', args: ['en'] }]);
    t.langBtn.click();
    t.items[3]!.click();
    expect(t.calls.at(-1)).toEqual({ name: 'changeLanguage', args: ['ko'] });
  });

  it('選目前的語言：只收起清單，不送意圖', () => {
    const t = header();
    t.langBtn.click();
    t.items[0]!.click();
    expect(isShown(t.menu)).toBe(false);
    expect(t.calls).toEqual([]);
  });

  it('Esc（app 先問 menuOpen、再 closeMenus）：收起清單、焦點回到按鈕；Tab 走出清單也收起來', () => {
    const t = header();
    t.langBtn.click();
    expect(t.h.menuOpen()).toBe(true);
    t.h.closeMenus();
    expect(isShown(t.menu)).toBe(false);
    expect(active()).toBe(t.langBtn);
    t.langBtn.click();
    const outside = dom.document.createElement('button');
    t.items[0]!.dispatchEvent(new FakeEvent('focusout', { relatedTarget: outside }));
    expect(isShown(t.menu)).toBe(false);
  });

  it('打開語言清單會收起〔匯出 ▾〕選單（一次只開一個）', () => {
    const t = header();
    const exportBtn = t.h.exportButton as unknown as FakeElement;
    const exportMenu = byClass(t.el, 'export-menu');
    exportBtn.click();
    expect(isShown(exportMenu)).toBe(true);
    t.langBtn.click();
    expect(isShown(exportMenu)).toBe(false);
    expect(isShown(t.menu)).toBe(true);
  });
});
