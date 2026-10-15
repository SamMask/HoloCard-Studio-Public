// 頁首〔匯出 ▾〕選單的鍵盤（T-607）：↑ ↓ 在選項之間移動、用 Tab 走出選單就收起來、匯出做完焦點回到〔匯出 ▾〕。
// 圖層名字輸入框：焦點進去不會順手選中那一層（滑鼠點才選，鍵盤用 Enter）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { addUploadedLayer, createEditor, selectLayer, toUiState } from '../src/ui/editor';
import { createHeader } from '../src/ui/header';
import { createLayerPanel } from '../src/ui/layer-list';
import type { UiIntents } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeElement, FakeEvent, flush, installFakeDom, isShown, keydown, type FakeDom } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
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
  const calls: string[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push(name);
      return name === 'exportPng' || name === 'exportCardFile' ? Promise.resolve() : undefined;
    },
  });
  const h = createHeader(intents, { openLibrary: () => {}, openNewCard: () => {}, exportTurntable: async () => {}, toggleHelp: () => {} });
  const el = h.el as unknown as FakeElement;
  const exportBtn = h.exportButton as unknown as FakeElement;
  const menu = byClass(el, 'export-menu');
  return { h, el, calls, exportBtn, menu, items: all(menu, 'menu-item') };
}

describe('〔匯出 ▾〕選單', () => {
  it('Enter 打開：焦點在第一個選項；↓ ↑ 在選項之間移動，到頭停住；Home／End 到頭尾', () => {
    const t = header();
    t.exportBtn.focus();
    t.exportBtn.click();
    expect(isShown(t.menu)).toBe(true);
    expect(t.items.length).toBeGreaterThanOrEqual(5);
    expect(active()).toBe(t.items[0]);
    keydown(t.items[0], 'ArrowDown');
    expect(active()).toBe(t.items[1]);
    keydown(t.items[1], 'ArrowUp');
    keydown(t.items[0], 'ArrowUp');
    expect(active()).toBe(t.items[0]);
    keydown(t.items[0], 'End');
    expect(active()).toBe(t.items[t.items.length - 1]);
    keydown(t.items[t.items.length - 1], 'ArrowDown');
    expect(active()).toBe(t.items[t.items.length - 1]);
    keydown(t.items[t.items.length - 1], 'Home');
    expect(active()).toBe(t.items[0]);
  });

  it('用 Tab 走出選單（焦點跑到選單外面）：選單收起來；焦點還在選單裡面時不收', () => {
    const t = header();
    t.exportBtn.click();
    const inside = new FakeEvent('focusout', { relatedTarget: t.items[2] });
    t.items[1]!.dispatchEvent(inside);
    expect(isShown(t.menu)).toBe(true);
    const outside = dom.document.createElement('button');
    t.items[t.items.length - 1]!.dispatchEvent(new FakeEvent('focusout', { relatedTarget: outside }));
    expect(isShown(t.menu)).toBe(false);
    expect(t.exportBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('視窗失去焦點（relatedTarget 是空的）不收選單', () => {
    const t = header();
    t.exportBtn.click();
    t.items[0]!.dispatchEvent(new FakeEvent('focusout'));
    expect(isShown(t.menu)).toBe(true);
  });

  it('選了 PNG：匯出做完，焦點回到〔匯出 ▾〕（不掉到頁面最前面）；卡片檔一樣', async () => {
    const t = header();
    t.exportBtn.focus();
    t.exportBtn.click();
    buttonWithText(t.menu, 'PNG 圖片').click();
    expect(t.calls).toContain('exportPng');
    await flush();
    expect(active()).toBe(t.exportBtn);
    t.exportBtn.click();
    buttonWithText(t.menu, '卡片檔').click();
    await flush();
    expect(t.calls).toContain('exportCardFile');
    expect(active()).toBe(t.exportBtn);
  });
});

describe('圖層名字輸入框', () => {
  const input = (id: string): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha: true, width: 1000, height: 1000 });

  it('焦點進輸入框（Tab 走過）不會選中那一層；點那一列（click）才選中', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const intents = new Proxy({} as UiIntents, {
      get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
    });
    const panel = createLayerPanel(intents);
    let s = addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('hero'), 'hero.png', T0).state;
    s = selectLayer(s, null);
    panel.render(toUiState(s, () => undefined));
    const row = all(panel.el, 'layer-row')[0] as unknown as FakeElement;
    const name = byClass(row, 'layer-name');
    name.dispatchEvent(new FakeEvent('focus', { bubbles: false }));
    name.focus();
    expect(calls).toEqual([]);
    name.dispatchEvent(new FakeEvent('click'));
    expect(calls).toEqual([{ name: 'selectLayer', args: ['hero'] }]);
  });
});
