// T-807 卡片比例的畫面（DESIGN「卡片比例」、§7.3 新卡片的「空白卡」）：
// - 右欄「比例」五個選項（單選群組、方向鍵切換、每個有 CSS 畫的小卡片外形）；選「自訂」展開寬、高兩個數字框，停手才記一步，
//   超出 1:2～2:1 框變紅＋說明、不套用；
// - 新卡片面板的空白卡多正方形、明信片、自訂（自訂展開寬高＋〔建立〕，鍵盤可用）；
// - 卡片庫的格子照比例；開啟時的縮圖照卡高；說明面板多一句。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aspectHeight } from '../src/model/aspect';
import { updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Aspect, Card, CustomAspect } from '../src/model/types';
import { createEditor, toUiState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { createLibrary } from '../src/ui/library';
import {
  ASPECT_CHOICES,
  ASPECT_RATIO_ERROR,
  ASPECT_SIDE_ERROR,
  aspectInputError,
  HELP_SECTIONS,
  posterHeight,
  TEXT_IDLE_MS,
} from '../src/ui/logic';
import { createNewCardPanel } from '../src/ui/new-card';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeElement, flush, installFakeDom, isShown, keydown, typeInto } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const STD_H = 88 / 63;

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      return undefined;
    },
  });
  return { intents, calls };
}

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hw = (el: FakeElement) => Number(el.style.getPropertyValue('--card-hw'));

describe('文字照 DESIGN', () => {
  it('五種比例的名字與順序；自訂超出範圍的說明；說明面板多一句', () => {
    expect(ASPECT_CHOICES.map((c) => c.name)).toEqual(['標準卡', '塔羅牌', '正方形', '明信片', '自訂']);
    expect(ASPECT_CHOICES.map((c) => c.value)).toEqual(['standard', 'tarot', 'square', 'postcard', 'custom']);
    expect(ASPECT_RATIO_ERROR).toBe('太扁或太長了，寬和高差最多兩倍');
    expect(HELP_SECTIONS.flatMap((s) => s.lines)).toContain('右欄的「比例」可以換成正方形、明信片或自己輸入寬和高。');
  });

  it('自訂框的說明：合格 null；超出 1:2～2:1 → 太扁太長；空白、0、小數、超過 999 → 整數 1～999', () => {
    expect(aspectInputError('3', '2')).toBeNull();
    expect(aspectInputError('1', '2')).toBeNull();
    expect(aspectInputError('5', '2')).toBe(ASPECT_RATIO_ERROR);
    expect(aspectInputError('1', '3')).toBe(ASPECT_RATIO_ERROR);
    for (const [w, h] of [['', '2'], ['0', '2'], ['2.5', '3'], ['1000', '999'], ['abc', '3']]) expect(aspectInputError(w!, h!)).toBe(ASPECT_SIDE_ERROR);
  });
});

describe('右欄「比例」', () => {
  function setup(card: Card) {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    const render = (c: Card) => inspector.render(toUiState(createEditor(c), (h) => `blob:${h}`));
    render(card);
    const root = inspector.el as unknown as FakeElement;
    const group = all(root, 'aspect-picker')[0]!;
    const options = all(group, 'aspect-opt');
    const custom = byClass(root, 'aspect-custom');
    const [width, height] = all(custom, 'aspect-num') as [FakeElement, FakeElement];
    return { root, group, options, custom, width, height, calls, render };
  }
  const edits = (calls: { name: string; args: unknown[] }[]) => calls.filter((c) => c.name === 'editCard').map((c) => c.args);

  it('五個選項（單選群組）：名字、選中的是這張卡的比例、只有選中的在 Tab 順序裡', () => {
    const t = setup(newCard('tarot', 'c1', T0));
    expect(t.group.getAttribute('role')).toBe('radiogroup');
    expect(t.options.map((o) => o.textContent)).toEqual(['標準卡', '塔羅牌', '正方形', '明信片', '自訂']);
    expect(t.options.map((o) => o.getAttribute('role'))).toEqual(Array(5).fill('radio'));
    expect(t.options.map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    expect(t.options.map((o) => o.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    expect(isShown(t.custom)).toBe(false);
  });

  it('每個選項有照比例的小卡片外形（CSS 的 --card-hw，不是圖檔）', () => {
    const t = setup(newCard('standard', 'c1', T0));
    const shapes = t.options.map((o) => byClass(o, 'aspect-shape'));
    expect(shapes.every((s) => s.tagName === 'SPAN')).toBe(true);
    expect(shapes.slice(0, 4).map(hw)).toEqual([STD_H, 120 / 70, 1, 1.48]);
    expect(all(t.root, 'aspect-opt').some((o) => o.querySelector('img'))).toBe(false);
  });

  it('點正方形＝editCard({ aspect: square }, commit)；方向鍵 → 從塔羅牌移到正方形也一樣（一按一步）', () => {
    const t = setup(newCard('standard', 'c1', T0));
    t.options[2]!.click();
    expect(edits(t.calls)).toEqual([[{ aspect: 'square' }, 'commit']]);
    const u = setup(newCard('tarot', 'c1', T0));
    u.options[1]!.focus();
    keydown(u.group, 'ArrowRight');
    expect(edits(u.calls)).toEqual([[{ aspect: 'square' }, 'commit']]);
  });

  it('點目前的比例不做事', () => {
    const t = setup(newCard('postcard', 'c1', T0));
    t.options[3]!.click();
    expect(edits(t.calls)).toEqual([]);
  });

  it('選自訂：換成自訂、寬高沿用目前比例（形狀不變，一步）', () => {
    const t = setup(newCard('postcard', 'c1', T0));
    t.options[4]!.click();
    expect(edits(t.calls)).toEqual([[{ aspect: 'custom', customAspect: { width: 100, height: 148 } }, 'commit']]);
  });

  it('自訂的卡：展開寬、高兩個數字框（整數 1～999），放著這張卡的寬高；自訂的小外形照這張卡', () => {
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    expect(isShown(t.custom)).toBe(true);
    expect([t.width.getAttribute('type'), t.width.getAttribute('min'), t.width.getAttribute('max'), t.width.getAttribute('step')]).toEqual(['number', '1', '999', '1']);
    expect([t.width.getAttribute('aria-label'), t.height.getAttribute('aria-label')]).toEqual(['寬', '高']);
    expect([t.width.value, t.height.value]).toEqual(['3', '2']);
    expect(hw(byClass(t.options[4], 'aspect-shape'))).toBeCloseTo(2 / 3, 12);
  });

  it('打寬高：停手 0.6 秒才記一步（editCard commit）；打字中一個字都不送', () => {
    vi.useFakeTimers();
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    t.width.focus();
    typeInto(t.width, '4');
    typeInto(t.width, '40');
    vi.advanceTimersByTime(TEXT_IDLE_MS - 1);
    expect(edits(t.calls)).toEqual([]);
    typeInto(t.height, '30');
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits(t.calls)).toEqual([[{ aspect: 'custom', customAspect: { width: 40, height: 30 } }, 'commit']]);
  });

  it('超出 1:2～2:1：框變紅、說「太扁或太長了，寬和高差最多兩倍」、不套用；改回合格就消失並套用', () => {
    vi.useFakeTimers();
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    t.width.focus();
    typeInto(t.width, '5');
    expect(t.width.classList.contains('is-invalid')).toBe(true);
    expect(t.height.classList.contains('is-invalid')).toBe(true);
    expect(t.width.getAttribute('aria-invalid')).toBe('true');
    const error = byClass(t.custom, 'aspect-error');
    expect(isShown(error)).toBe(true);
    expect(error.textContent).toBe(ASPECT_RATIO_ERROR);
    vi.advanceTimersByTime(TEXT_IDLE_MS * 3);
    expect(edits(t.calls)).toEqual([]);
    typeInto(t.width, '4');
    expect(t.width.classList.contains('is-invalid')).toBe(false);
    expect(isShown(error)).toBe(false);
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits(t.calls)).toEqual([[{ aspect: 'custom', customAspect: { width: 4, height: 2 } }, 'commit']]);
  });

  it('離開框：還沒送的先送出；不合格的字放回這張卡現在的寬高', () => {
    vi.useFakeTimers();
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    t.width.focus();
    typeInto(t.width, '4');
    t.width.blur();
    expect(edits(t.calls)).toEqual([[{ aspect: 'custom', customAspect: { width: 4, height: 2 } }, 'commit']]);
    t.calls.length = 0;
    t.width.focus();
    typeInto(t.width, '9');
    t.width.blur();
    expect(edits(t.calls)).toEqual([]);
    expect([t.width.value, t.height.value]).toEqual(['3', '2']);
    expect(t.width.classList.contains('is-invalid')).toBe(false);
  });

  it('寬框移到高框（Tab）不算離開：不會提早送出', () => {
    vi.useFakeTimers();
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    t.width.focus();
    typeInto(t.width, '4');
    t.height.focus();
    expect(edits(t.calls)).toEqual([]);
  });

  it('復原（卡上的寬高變了）時框跟著變；還在等著送的不蓋掉', () => {
    vi.useFakeTimers();
    const card = newCard('custom', 'c1', T0, { width: 3, height: 2 });
    const t = setup(card);
    t.render(updateCard(card, { customAspect: { width: 5, height: 4 } }));
    expect([t.width.value, t.height.value]).toEqual(['5', '4']);
    t.width.focus();
    typeInto(t.width, '6');
    t.render(updateCard(card, { customAspect: { width: 7, height: 4 } }));
    expect(t.width.value).toBe('6');
  });

  it('換了一張卡：還沒送的寬高丟掉（不會寫到新卡上）', () => {
    vi.useFakeTimers();
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    t.width.focus();
    typeInto(t.width, '4');
    t.render(newCard('custom', 'c2', T0, { width: 1, height: 1 }));
    vi.advanceTimersByTime(TEXT_IDLE_MS * 2);
    expect(edits(t.calls)).toEqual([]);
    expect([t.width.value, t.height.value]).toEqual(['1', '1']);
  });

  it('數字框算打字的地方（快捷鍵不攔）', async () => {
    const { isTextEntry } = await import('../src/ui/logic');
    const t = setup(newCard('custom', 'c1', T0, { width: 3, height: 2 }));
    expect(isTextEntry(t.width as never)).toBe(true);
  });
});

describe('新卡片面板：空白卡多正方形、明信片、自訂', () => {
  function setup() {
    const picked: { aspect: Aspect; custom?: CustomAspect }[] = [];
    const panel = createNewCardPanel({
      blank: (aspect, custom) => picked.push(custom ? { aspect, custom } : { aspect }),
      disc: () => {},
      sample: () => {},
      preview: async () => null,
      changed: () => {},
      libraryCards: async () => [],
      openCard: () => {},
    });
    const el = panel.el as unknown as FakeElement;
    const blanks = () => all(el, 'nc-opt').filter((b) => b.querySelector('.nc-blank'));
    return { panel, el, picked, blanks, customBox: () => byClass(el, 'nc-custom') };
  }

  it('五個空白卡（＋T-810 的光碟）：名字、小字、照比例的卡片外形（--card-hw）', () => {
    const t = setup();
    expect(t.blanks().map((b) => byClass(b, 'nc-name').textContent)).toEqual(['標準卡', '塔羅牌', '正方形', '明信片', '自訂', '光碟']);
    expect(t.blanks().map((b) => byClass(b, 'nc-detail').textContent)).toEqual(['63 × 88', '70 × 120，較修長', '1 : 1', '100 × 148', '自己輸入寬和高', '圓形，中間有孔']);
    const ratios = t.blanks().map((b) => hw(byClass(b, 'nc-blank')));
    expect(ratios).toEqual([STD_H, 120 / 70, 1, 1.48, STD_H, 1]);
  });

  it('點正方形、明信片：直接建立（沒有寬高）', () => {
    const t = setup();
    t.panel.open('blank');
    t.blanks()[2]!.click();
    expect(t.picked).toEqual([{ aspect: 'square' }]);
    t.panel.open('blank');
    t.blanks()[3]!.click();
    expect(t.picked.at(-1)).toEqual({ aspect: 'postcard' });
  });

  it('點自訂：在選項下面展開寬 × 高（預設 63 × 88）＋〔建立〕，焦點放到寬；還沒建立、面板還開著', () => {
    const t = setup();
    t.panel.open('blank');
    expect(isShown(t.customBox())).toBe(false);
    const custom = t.blanks()[4]!;
    expect(custom.getAttribute('aria-expanded')).toBe('false');
    custom.click();
    expect(t.picked).toEqual([]);
    expect(t.panel.isOpen()).toBe(true);
    expect(isShown(t.customBox())).toBe(true);
    expect(custom.getAttribute('aria-expanded')).toBe('true');
    const [w, h] = all(t.customBox(), 'aspect-num');
    expect([w!.value, h!.value]).toEqual(['63', '88']);
    expect(dom.document.activeElement).toBe(w);
    expect(byClass(t.customBox(), 'nc-create').textContent).toBe('建立');
  });

  it('打 3 × 2 → Enter 建立橫式自訂卡；自訂的卡片外形跟著打的比例', () => {
    const t = setup();
    t.panel.open('blank');
    t.blanks()[4]!.click();
    const [w, h] = all(t.customBox(), 'aspect-num');
    typeInto(w, '3');
    typeInto(h, '2');
    expect(hw(byClass(t.blanks()[4], 'nc-blank'))).toBeCloseTo(2 / 3, 12);
    keydown(h, 'Enter');
    expect(t.picked).toEqual([{ aspect: 'custom', custom: { width: 3, height: 2 } }]);
    expect(t.panel.isOpen()).toBe(false);
  });

  it('Ctrl／Cmd／Alt＋Enter、輸入法選字中按 Enter：不建立（只收單按的 Enter，T-807 審查）', () => {
    const t = setup();
    t.panel.open('blank');
    t.blanks()[4]!.click();
    const [w, h] = all(t.customBox(), 'aspect-num');
    typeInto(w, '3');
    typeInto(h, '2');
    keydown(h, 'Enter', { ctrlKey: true });
    keydown(h, 'Enter', { metaKey: true });
    keydown(h, 'Enter', { altKey: true });
    keydown(h, 'Enter', { isComposing: true });
    expect(t.picked).toEqual([]);
    keydown(h, 'Enter');
    expect(t.picked).toEqual([{ aspect: 'custom', custom: { width: 3, height: 2 } }]);
  });

  it('〔建立〕也可以；太扁太長時框變紅、說明、〔建立〕不能按、Enter 不建立', () => {
    const t = setup();
    t.panel.open('blank');
    t.blanks()[4]!.click();
    const [w, h] = all(t.customBox(), 'aspect-num');
    const create = byClass(t.customBox(), 'nc-create');
    typeInto(w, '5');
    typeInto(h, '2');
    expect(w!.classList.contains('is-invalid')).toBe(true);
    expect(byClass(t.customBox(), 'aspect-error').textContent).toBe(ASPECT_RATIO_ERROR);
    expect(create.disabled).toBe(true);
    keydown(h, 'Enter');
    expect(t.picked).toEqual([]);
    typeInto(w, '4');
    expect(create.disabled).toBe(false);
    create.click();
    expect(t.picked).toEqual([{ aspect: 'custom', custom: { width: 4, height: 2 } }]);
  });

  it('再打開面板：自訂收起來、寬高回到 63 × 88', () => {
    const t = setup();
    t.panel.open('blank');
    t.blanks()[4]!.click();
    typeInto(all(t.customBox(), 'aspect-num')[0], '9');
    t.panel.close();
    t.panel.open('blank');
    expect(isShown(t.customBox())).toBe(false);
    expect(all(t.customBox(), 'aspect-num').map((i) => i.value)).toEqual(['63', '88']);
  });
});

describe('卡片庫的格子照比例（格子大小不變）', () => {
  it('每張縮圖的 --card-hw＝那張卡的高／寬（自訂用寬高）', async () => {
    const cards = [
      { id: 'a', name: '標準', aspect: 'standard' as const },
      { id: 'b', name: '橫', aspect: 'custom' as const, customAspect: { width: 3, height: 2 } },
      { id: 'c', name: '方', aspect: 'square' as const },
    ];
    const intents = new Proxy({} as UiIntents, {
      get: (_t, name: string) =>
        name === 'loadLibrary'
          ? async () => ({ cards: cards.map((c) => ({ ...c, createdAt: T0, updatedAt: T0 })), storageLow: false })
          : () => {},
    });
    const library = createLibrary(intents, { openNewCard: () => {}, importFiles: () => {}, changed: () => {} });
    library.open();
    await flush();
    const arts = all(library.el, 'lib-art');
    expect(arts.map(hw)).toEqual([STD_H, 2 / 3, 1]);
    expect(arts.some((a) => a.getAttribute('data-aspect') !== null)).toBe(false);
  });
});

describe('開啟時先顯示的縮圖照卡高', () => {
  it('標準卡約 72、塔羅牌約 77（以前寫死的值）；正方形、橫式比較矮', () => {
    expect(posterHeight(STD_H)).toBeCloseTo(72, 0);
    expect(Math.abs(posterHeight(120 / 70) - 77)).toBeLessThan(1);
    expect(posterHeight(1)).toBeLessThan(posterHeight(STD_H));
    expect(posterHeight(2 / 3)).toBeLessThan(posterHeight(1));
    expect(posterHeight(aspectHeight({ aspect: 'postcard' }))).toBeGreaterThan(posterHeight(STD_H));
  });
});
