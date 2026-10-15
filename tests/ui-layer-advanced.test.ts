// T-840：常用設定往上，進階效果預設收起；只改顯示，不改圖層資料或互斥規則。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';
import { newCard } from '../src/model/create';
import type { Layer } from '../src/model/types';
import { focusableIn } from '../src/ui/focus';
import { createInspector } from '../src/ui/inspector';
import type { SectionStore, UiIntents, UiState } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

beforeEach(() => {
  const dom = installFakeDom();
  Object.assign(dom.document, { addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

const layer = (patch: Partial<Layer> = {}): Layer => ({
  id: 'hero', name: 'Hero', role: 'depth', image: '0123456789abcdef',
  visible: true, depth: 50, x: 0, y: 0, scale: 1, holo: true, hasAlpha: true,
  ...patch,
});

function setup(initial: string[] = []) {
  let saved = [...initial];
  let expanded: string[] = [];
  const sections: SectionStore = {
    read: () => saved, write: (ids) => { saved = [...ids]; },
    readExpanded: () => expanded, writeExpanded: (ids) => { expanded = [...ids]; },
  };
  const intents = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (target[key] ??= vi.fn()),
  }) as unknown as UiIntents;
  const inspector = createInspector(intents, sections);
  const root = byClass(inspector.el, 'layer-section');
  const render = (selected = layer(), others: Layer[] = []) => {
    const card = newCard('standard', 'card', '2026-10-15T00:00:00.000Z');
    card.front.layers = [...others, selected];
    const state: UiState = {
      card, face: 'front', selectedLayerId: selected.id, canUndo: false, canRedo: false,
      message: null, pendingReplaceBase: null, imageUrl: () => undefined,
    };
    inspector.render(state);
    return card;
  };
  render();
  const toggle = () => all(root, 'section-toggle').find((b) => b.getAttribute('aria-controls') === 'section-layer-advanced')!;
  return { inspector, root, render, toggle, sections, intents };
}

describe('選中的圖層重排（T-840）', () => {
  it('DOM 與 Tab 順序：深度、不透明度、混合模式、自動去背、位置、大小、置中／填滿、進階效果', () => {
    const { root, render, toggle } = setup();
    render(layer({ hasAlpha: false, blend: 'screen' }));
    const stops = focusableIn(root as unknown as HTMLElement) as unknown as FakeElement[];
    const depth = stops.find((n) => n.getAttribute('aria-label') === S.inspector.depth)!;
    const opacity = stops.find((n) => n.getAttribute('aria-label') === S.inspector.opacity)!;
    const blend = stops.find((n) => n.classList.contains('blend-opt'))!;
    const cutout = byClass(root, 'layer-cutout-btn');
    const x = stops.find((n) => n.getAttribute('aria-label') === S.inspector.posX)!;
    const y = stops.find((n) => n.getAttribute('aria-label') === S.inspector.posY)!;
    const size = stops.find((n) => n.getAttribute('aria-label') === S.inspector.size)!;
    const center = stops.find((n) => n.title === S.inspector.centerTip)!;
    const fill = stops.find((n) => n.title === S.inspector.fillTip)!;
    const expected = [depth, opacity, blend, cutout, x, y, size, center, fill, toggle()];
    for (const stop of expected) expect(stop).toBeDefined();
    expect(stops.slice(1)).toEqual(expected);
  });

  it('文字小節仍在深度前；底圖不出現深度、不透明度、混合模式', () => {
    const { root, render } = setup();
    render(layer({ text: { content: 'Text', font: 'wenkai', style: 'plain', color: '#ffffff', vertical: false, align: 'center' } }));
    const stops = focusableIn(root as unknown as HTMLElement) as unknown as FakeElement[];
    expect(stops.findIndex((n) => n.tagName === 'TEXTAREA')).toBeLessThan(stops.findIndex((n) => n.getAttribute('aria-label') === S.inspector.depth));
    render(layer({ role: 'base', depth: 0 }));
    expect(isShown(byClass(root, 'depth-block'))).toBe(false);
    expect(all(root, 'blend-opt').every((n) => !isShown(n))).toBe(true);
  });
});

describe('進階效果（T-840）', () => {
  it.each([{ ids: [] }, { ids: ['style'] }])('沒有紀錄或只有舊收起清單 $ids：進階效果仍預設收起', ({ ids }) => {
    const { toggle } = setup(ids);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('導覽只展開選中的圖層，有開著的進階效果也不展開子節', () => {
    const { inspector, render, toggle, root } = setup(['layer']);
    render(layer({ breakout: true }));
    inspector.reveal();
    expect(all(root, 'section-toggle')[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(byClass(root, 'layer-advanced-count').textContent).toBe(S.inspector.advancedCount(1));
  });

  it('五個效果照原順序放在同一個內容區；收起不佔 Tab 停點，展開後恢復', () => {
    const { root, toggle } = setup();
    const body = byClass(root, 'layer-advanced-body');
    expect(body.getAttribute('id')).toBe('section-layer-advanced');
    expect(body.children.map((n) => n.className.replace(' is-locked', ''))).toEqual([
      'field-group breakout-block', 'field-group lineart-block', 'field-group clip-block',
      'field-group alt-block', 'field-group fx-block',
    ]);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    const stops = () => focusableIn(root as unknown as HTMLElement) as unknown as FakeElement[];
    expect(stops().some((n) => body.contains(n))).toBe(false);
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(stops().some((n) => body.contains(n))).toBe(true);
  });

  it('展開記住，重建面板、換卡／換層也不收回；不送圖層修改意圖', () => {
    const { inspector, root, toggle, sections, intents, render } = setup();
    toggle().click();
    expect(sections.read()).toEqual([]);
    render(layer({ id: 'other' }));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const reloaded = createInspector(intents, sections);
    const restored = all(reloaded.el, 'section-toggle').find((b) => b.getAttribute('aria-controls') === 'section-layer-advanced')!;
    expect(restored.getAttribute('aria-expanded')).toBe('true');
    restored.click();
    const closed = createInspector(intents, sections);
    expect(all(closed.el, 'section-toggle').find((b) => b.getAttribute('aria-controls') === 'section-layer-advanced')!.getAttribute('aria-expanded')).toBe('false');
    inspector.reveal();
    expect(isShown(root)).toBe(true);
    expect(intents.editLayer).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 0], [{ breakout: true }, 1], [{ lineart: true, clip: true }, 2],
    [{ alt: { image: 'alt-image', hasAlpha: true }, fx: { kind: 'fire', color: '#ff6a1f', strength: 70, speed: 50 }, lineart: true, clip: true }, 4],
  ] as const)('計數更新，零個時不顯示數字：%o → %i', (patch, count) => {
    const { root, render, toggle } = setup();
    const card = render(layer(patch));
    const snapshot = JSON.stringify(card);
    const badge = byClass(root, 'layer-advanced-count');
    expect(isShown(badge)).toBe(count > 0);
    expect(badge.textContent).toBe(count ? S.inspector.advancedCount(count) : '');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    toggle().click();
    toggle().click();
    expect(JSON.stringify(card)).toBe(snapshot);
    render(layer());
    expect(isShown(badge)).toBe(false);
    expect(badge.textContent).toBe('');
  });

  it('展開後仍送原來的開關、混合模式與鍵盤意圖', () => {
    const { root, toggle, intents } = setup();
    toggle().click();
    byClass(root, 'breakout-block').querySelector('button')!.click();
    expect(intents.editLayer).toHaveBeenLastCalledWith('hero', { breakout: true }, 'commit');
    const normal = all(root, 'blend-opt')[0]!;
    normal.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowDown' }));
    expect(intents.editLayer).toHaveBeenLastCalledWith('hero', { blend: 'multiply' }, 'commit');
  });
});

it('四種語言都有進階效果標題與數量句', () => {
  for (const dict of [zhHant, en, ja, ko]) {
    expect(dict.inspector.advancedTitle).toBeTruthy();
    expect(dict.inspector.advancedCount(3)).toContain('3');
  }
  expect(zhHant.inspector.advancedCount(3)).toBe('（開著 3 個）');
});
