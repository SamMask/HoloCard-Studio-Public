// T-836（DESIGN §5.2「右欄各小節可以摺疊」）：真的建出右欄（假 DOM），看各小節都接上了摺疊、記錄、導覽展開。
// 小節照現有的分節：選中的圖層、反光層、風格、比例、卡身（卡身顏色＋圓角）、卡框、鐳射、陰影、卡片故事（目前藏著）、舞台。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../src/i18n';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { focusableIn } from '../src/ui/focus';
import { createInspector } from '../src/ui/inspector';
import type { SectionStore, UiIntents, UiState } from '../src/ui/types';
import { all, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

beforeEach(() => {
  const dom = installFakeDom();
  // 色彩選擇器（palette-picker）在 document 上聽 pointerdown（點別處關掉顏色表）：假 document 補兩個空的
  Object.assign(dom.document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SECTIONS = ['layer', 'foil', 'style', 'aspect', 'body', 'frame', 'holo', 'shadow', 'story', 'stage'];

/** 意圖全部是假的；右欄收起來的小節從 sections 讀寫（T-836：不走 intents）。 */
function intentsWith(collapsed: readonly string[] | (() => readonly string[]), write = vi.fn<(ids: readonly string[]) => void>()) {
  const intents = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (target[key] ??= vi.fn()),
  }) as unknown as UiIntents;
  const sections: SectionStore = { read: typeof collapsed === 'function' ? collapsed : () => collapsed, write };
  return { intents, sections, write };
}

function state(card: Card, extra: Partial<UiState> = {}): UiState {
  return {
    card,
    face: 'front',
    selectedLayerId: null,
    canUndo: false,
    canRedo: false,
    message: null,
    pendingReplaceBase: null,
    imageUrl: () => undefined,
    ...extra,
  };
}

function make(collapsed: readonly string[] | (() => readonly string[]) = []) {
  const { intents, sections, write } = intentsWith(collapsed);
  const inspector = createInspector(intents, sections);
  const el = inspector.el as unknown as FakeElement;
  const toggles = () => all(el, 'section-toggle');
  /** 這個小節的標題按鈕（照 aria-controls 找）。 */
  const toggle = (id: string) => {
    const found = toggles().find((t) => t.getAttribute('aria-controls') === `section-${id}`);
    if (!found) throw new Error(`找不到小節 ${id}`);
    return found;
  };
  /** aria-controls 指到的內容。 */
  const body = (id: string) => {
    const walk = (n: FakeElement): FakeElement | null => {
      if (n.getAttribute('id') === `section-${id}`) return n;
      for (const c of n.children) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    const found = walk(el);
    if (!found) throw new Error(`找不到內容 section-${id}`);
    return found;
  };
  return { inspector, el, write, toggles, toggle, body };
}

const card = () => newCard('standard', 'card-1', '2026-10-15T00:00:00.000Z');

describe('右欄各小節都可以摺疊（T-836）', () => {
  it('每一節都有標題按鈕（aria-controls 指到自己的內容），預設全部展開', () => {
    const { toggle, body } = make();
    for (const id of SECTIONS) {
      expect(toggle(id).getAttribute('aria-expanded'), id).toBe('true');
      expect(body(id).hidden, id).toBe(false);
    }
  });

  it('標題字照舊（鐳射、陰影、舞台、比例、卡框…），「卡身」是新的節名', () => {
    const { toggle } = make();
    expect(toggle('layer').textContent).toBe(S.inspector.layerTitle);
    expect(toggle('holo').textContent).toBe(S.holo.title);
    expect(toggle('shadow').textContent).toBe(S.shadow.title);
    expect(toggle('stage').textContent).toBe(S.stage.title);
    expect(toggle('aspect').textContent).toBe(S.card.aspect);
    expect(toggle('frame').textContent).toBe(S.card.frame);
    expect(toggle('body').textContent).toBe(S.card.body);
    expect(toggle('style').textContent).toBe(S.style.title);
  });

  it('按「鐳射」收起：內容藏起來、裡面的滑桿不在 Tab 順序裡、記下 ["holo"]；別節不受影響', () => {
    const { el, toggle, body, write, inspector } = make();
    inspector.render(state(card()));
    const inHolo = (n: FakeElement) => body('holo').contains(n);
    expect(focusableIn(el as unknown as HTMLElement).some((n) => inHolo(n as unknown as FakeElement))).toBe(true);
    toggle('holo').click();
    expect(toggle('holo').getAttribute('aria-expanded')).toBe('false');
    expect(isShown(body('holo'))).toBe(false);
    expect(write).toHaveBeenLastCalledWith(['holo']);
    expect(focusableIn(el as unknown as HTMLElement).some((n) => inHolo(n as unknown as FakeElement))).toBe(false);
    // 標題按鈕本身還在 Tab 順序裡
    expect(focusableIn(el as unknown as HTMLElement)).toContain(toggle('holo') as unknown as HTMLElement);
    expect(isShown(body('shadow'))).toBe(true);
  });

  it('卡框收起時，標題列的開關照樣看得到、按得到（只藏樣式、粗細、顏色、光澤）', () => {
    const { el, toggle, body } = make();
    toggle('frame').click();
    const row = toggle('frame').closest('div.field-row');
    expect(row).not.toBeNull();
    const sw = row!.querySelector('button.switch') ?? row!.children.find((c) => c.getAttribute('role') === 'switch');
    expect(sw).toBeTruthy();
    expect(isShown(sw)).toBe(true);
    expect(isShown(body('frame'))).toBe(false);
    expect(focusableIn(el as unknown as HTMLElement)).toContain(sw as unknown as HTMLElement);
  });

  it('重新載入：照記錄收著；換卡（render 別張卡）照舊收著', () => {
    const { toggle, body, inspector } = make(['stage', 'body']);
    expect(toggle('stage').getAttribute('aria-expanded')).toBe('false');
    expect(isShown(body('stage'))).toBe(false);
    expect(isShown(body('body'))).toBe(false);
    expect(isShown(body('holo'))).toBe(true);
    inspector.render(state(card()));
    inspector.render(state(newCard('tarot', 'card-2', '2026-10-15T00:00:00.000Z')));
    expect(isShown(body('stage'))).toBe(false);
    expect(toggle('stage').getAttribute('aria-expanded')).toBe('false');
  });

  it('記錄讀不到（丟錯）：全部展開、不壞', () => {
    const { toggle } = make(() => {
      throw new Error('SecurityError');
    });
    for (const id of SECTIONS) expect(toggle(id).getAttribute('aria-expanded'), id).toBe('true');
  });

  it('沒給記錄（舊的呼叫 createInspector(intents)）：全部展開，按了照樣收起、不壞；不會去叫任何意圖', () => {
    const calls: string[] = [];
    const intents = new Proxy({} as Record<string, unknown>, {
      get: (_t, key: string) => () => void calls.push(key),
    }) as unknown as UiIntents;
    const inspector = createInspector(intents);
    const el = inspector.el as unknown as FakeElement;
    const holo = all(el, 'section-toggle').find((t) => t.getAttribute('aria-controls') === 'section-holo')!;
    expect(holo.getAttribute('aria-expanded')).toBe('true');
    expect(() => holo.click()).not.toThrow();
    expect(holo.getAttribute('aria-expanded')).toBe('false');
    expect(calls).toEqual([]);
  });

  it('導覽指到右欄（reveal）：「選中的圖層」收著就展開、記下來；選著反光層時展開反光層', () => {
    const { inspector, toggle, body, write } = make(['layer', 'foil']);
    inspector.render(state(card()));
    expect(isShown(body('layer'))).toBe(false);
    inspector.reveal();
    expect(isShown(body('layer'))).toBe(true);
    expect(toggle('layer').getAttribute('aria-expanded')).toBe('true');
    expect(write).toHaveBeenLastCalledWith(['foil']);
    inspector.render(state(card(), { foilSelected: true }));
    expect(isShown(body('foil'))).toBe(false);
    inspector.reveal();
    expect(isShown(body('foil'))).toBe(true);
    expect(write).toHaveBeenLastCalledWith([]);
  });
});
