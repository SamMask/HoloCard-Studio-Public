// T-829c：背景補了範例卡（DESIGN 7.4「補新的範例」），開著的「我的卡片」面板跟著重讀清單（refreshOpenLibrary）：
// 原本看著的那張留在畫面上同一個位置（捲動跟著新多出來的格子調）、有焦點的那張〔⋯〕還是有焦點；
// 使用者正在用〔⋯〕選單、刪除確認或改名時先不重讀（不打斷），做完才讀；面板沒開著就什麼都不做。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibrary, refreshOpenLibrary } from '../src/ui/library';
import type { LibraryData, UiIntents } from '../src/ui/types';
import { all, byClass, FakeElement, flush, installFakeDom, keydown, type FakeDom } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
/** 一格卡片（含間距）多高：假的版面照網格裡的順序排。 */
const ROW = 260;

let dom: FakeDom;

beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  Object.assign(dom.window, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/0');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  // 假的版面：捲動區在螢幕上 0～600；網格裡第 i 格在 i × ROW（減掉捲了多少）
  (FakeElement.prototype as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = function (this: FakeElement) {
    if (this.classList.contains('lib-card') && this.parentNode) {
      const scroll = this.parentNode.parentNode as unknown as { scrollTop?: number };
      const top = this.parentNode.children.indexOf(this) * ROW - (scroll.scrollTop ?? 0);
      return { left: 0, top, right: 200, bottom: top + ROW, width: 200, height: ROW, x: 0, y: top };
    }
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(names: string[]) {
  const cards = names.map((name, i) => ({ id: `c${i}`, name }));
  let loads = 0;
  const intents = new Proxy({} as UiIntents, {
    get: (_t, key: string) => {
      if (key === 'loadLibrary') {
        return async (): Promise<LibraryData> => {
          loads++;
          return { cards: cards.map((c) => ({ id: c.id, name: c.name, aspect: 'standard', createdAt: T0, updatedAt: T0 })), storageLow: false };
        };
      }
      if (key === 'renameCard') return async () => true;
      return () => {};
    },
  });
  const library = createLibrary(intents, { openNewCard: () => {}, importFiles: () => {}, changed: () => {} });
  const el = library.el as unknown as FakeElement;
  return {
    library,
    el,
    cards,
    loads: () => loads,
    scroll: byClass(el, 'lib-scroll') as unknown as FakeElement & { scrollTop: number },
    tileIds: () => all(el, 'lib-card').map((t) => t.getAttribute('data-id')),
    more: (id: string) => all(el, 'lib-card').find((t) => t.getAttribute('data-id') === id)!.querySelector('.lib-more')!,
  };
}

describe('背景補了範例：開著的我的卡片重讀清單（T-829c）', () => {
  it('沒開著：不讀', async () => {
    const t = setup(['龍']);
    refreshOpenLibrary();
    await flush();
    expect(t.loads()).toBe(0);
    t.library.open();
    await flush();
    t.library.close();
    refreshOpenLibrary();
    await flush();
    expect(t.loads()).toBe(1);
  });

  it('開著：新的卡出現；原本看著的那張留在同一個位置（捲動跟著調）；有焦點的〔⋯〕還是有焦點', async () => {
    const t = setup(['a', 'b', 'c', 'd', 'e']);
    t.library.open();
    await flush();
    // 捲到第三張（c）在最上面，焦點在 d 的〔⋯〕
    t.scroll.scrollTop = 2 * ROW;
    t.more('c3').focus();
    // 背景補了兩張新卡（最近編輯，排最前面）
    t.cards.unshift({ id: 'n1', name: '星海唱片鯨' }, { id: 'n2', name: '月下幽舞' });
    refreshOpenLibrary();
    await flush();
    expect(t.tileIds()).toEqual(['n1', 'n2', 'c0', 'c1', 'c2', 'c3', 'c4']);
    expect(t.scroll.scrollTop).toBe(4 * ROW);
    expect(document.activeElement).toBe(t.more('c3'));
  });

  it('〔⋯〕選單開著：先不重讀（選單不會被關掉）；選單關了才讀', async () => {
    const t = setup(['a']);
    t.library.open();
    await flush();
    t.more('c0').click();
    const menu = byClass(t.el, 'lib-menu');
    expect(menu.hidden).toBe(false);
    t.cards.unshift({ id: 'n1', name: '新的' });
    refreshOpenLibrary();
    await flush();
    expect(menu.hidden).toBe(false);
    expect(t.tileIds()).toEqual(['c0']);
    t.library.escape();
    await flush();
    expect(menu.hidden).toBe(true);
    expect(t.tileIds()).toEqual(['n1', 'c0']);
  });

  it('改名中：先不重讀（打到一半的字不會不見）；改完才讀', async () => {
    const t = setup(['a']);
    t.library.open();
    await flush();
    t.more('c0').click();
    all(t.el, 'menu-item').find((b) => b.textContent?.includes('改名'))!.click();
    const input = byClass(t.el, 'lib-name-input') as unknown as FakeElement & { value: string };
    input.value = '我的龍';
    t.cards.unshift({ id: 'n1', name: '新的' });
    refreshOpenLibrary();
    await flush();
    expect(t.tileIds()).toEqual(['c0']);
    expect(input.isConnected).toBe(true);
    keydown(input, 'Escape');
    await flush();
    expect(t.tileIds()).toEqual(['n1', 'c0']);
  });
});
