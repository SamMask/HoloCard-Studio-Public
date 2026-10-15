// 左欄圖層清單的鍵盤（T-607，DESIGN §8.2）：↑ ↓ 在反光層那一列與各圖層之間移動焦點（到頭停住）、Enter 選中、空白鍵顯示／隱藏；
// Tab 停點只有一列（選中的那列或焦點最後在的那列）；反光層那一列照舊；在名字輸入框裡打字不攔。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { addUploadedLayer, createEditor, deleteLayer, selectLayer, toUiState, type EditorState } from '../src/ui/editor';
import { createLayerPanel } from '../src/ui/layer-list';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';

const input = (id: string, hasAlpha = true): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、立體層 hero、立體層 dragon（清單顯示由前到後：dragon、hero、bg）。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero'), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('dragon'), 'dragon.png', T0).state;
  return selectLayer(s, null);
}

let dom: FakeDom;
let calls: { name: string; args: unknown[] }[];

beforeEach(() => {
  dom = installFakeDom();
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function panel(s: EditorState = setup()) {
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  const p = createLayerPanel(intents);
  p.render(toUiState(s, () => undefined));
  const root = p.el as unknown as FakeElement;
  const rows = () => all(root, 'layer-row');
  const foilRow = byClass(root, 'foil-row');
  return { p, root, rows, foilRow, render: (next: EditorState) => p.render(toUiState(next, () => undefined)) };
}

const nameOf = (row: FakeElement) => byClass(row, 'layer-name').value;
const tabStops = (rows: FakeElement[]) => rows.map((r) => r.tabIndex);

describe('圖層清單：↑ ↓ 在列之間移動焦點', () => {
  it('清單最上面是反光層那一列，下面是各圖層（由前到後）；列本身可以拿焦點（有名字給朗讀）', () => {
    const { rows, foilRow } = panel();
    expect(rows().map(nameOf)).toEqual(['dragon', 'hero', 'bg']);
    expect(foilRow.tabIndex).toBe(0);
    for (const row of rows()) {
      expect(row.getAttribute('tabindex')).not.toBeNull();
      expect(row.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('↓ 從反光層那列到第一個圖層，再往下一層一層走；到最後一層停住', () => {
    const { rows, foilRow } = panel();
    foilRow.focus();
    expect(keydown(foilRow, 'ArrowDown').defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(rows()[0]);
    keydown(rows()[0], 'ArrowDown');
    expect(dom.document.activeElement).toBe(rows()[1]);
    keydown(rows()[1], 'ArrowDown');
    expect(dom.document.activeElement).toBe(rows()[2]);
    keydown(rows()[2], 'ArrowDown');
    expect(dom.document.activeElement).toBe(rows()[2]);
  });

  it('↑ 往上走，第一個圖層再往上到反光層那列，反光層那列再往上停住；Home／End 到頭尾', () => {
    const { rows, foilRow } = panel();
    rows()[2]!.focus();
    keydown(rows()[2], 'ArrowUp');
    expect(dom.document.activeElement).toBe(rows()[1]);
    keydown(rows()[1], 'ArrowUp');
    keydown(rows()[0], 'ArrowUp');
    expect(dom.document.activeElement).toBe(foilRow);
    keydown(foilRow, 'ArrowUp');
    expect(dom.document.activeElement).toBe(foilRow);
    keydown(foilRow, 'End');
    expect(dom.document.activeElement).toBe(rows()[2]);
    keydown(rows()[2], 'Home');
    expect(dom.document.activeElement).toBe(foilRow);
  });

  it('光用方向鍵移動焦點不會選中圖層，也不會改任何東西', () => {
    const { rows, foilRow } = panel();
    foilRow.focus();
    keydown(foilRow, 'ArrowDown');
    keydown(rows()[0], 'ArrowDown');
    expect(calls).toEqual([]);
  });
});

describe('圖層清單：Enter 選中、空白鍵顯示／隱藏', () => {
  it('Enter 選中這一層（selectLayer），空白鍵切換這一層的眼睛（editLayer visible commit）；兩個都攔下（頁面不捲）', () => {
    const { rows } = panel();
    const hero = rows()[1]!;
    hero.focus();
    expect(keydown(hero, 'Enter').defaultPrevented).toBe(true);
    expect(calls).toEqual([{ name: 'selectLayer', args: ['hero'] }]);
    expect(keydown(hero, ' ').defaultPrevented).toBe(true);
    expect(calls.at(-1)).toEqual({ name: 'editLayer', args: ['hero', { visible: false }, 'commit'] });
  });

  it('隱藏中的層：空白鍵變成顯示；列的朗讀名字會說「隱藏中」', () => {
    let s = setup();
    const { rows, render } = panel(s);
    s = { ...s, history: { ...s.history, present: { ...s.history.present, front: { ...s.history.present.front, layers: s.history.present.front.layers.map((l) => (l.id === 'hero' ? { ...l, visible: false } : l)) } } } };
    render(s);
    const hero = rows().find((r) => nameOf(r) === 'hero')!;
    expect(hero.getAttribute('aria-label')).toContain('隱藏中');
    keydown(hero, ' ');
    expect(calls.at(-1)).toEqual({ name: 'editLayer', args: ['hero', { visible: true }, 'commit'] });
    expect(rows().find((r) => nameOf(r) === 'dragon')!.getAttribute('aria-label')).toBe('dragon');
  });

  it('反光層那一列照舊：Enter 或空白鍵＝選反光層', () => {
    const { foilRow } = panel();
    foilRow.focus();
    expect(keydown(foilRow, 'Enter').defaultPrevented).toBe(true);
    keydown(foilRow, ' ');
    expect(calls).toEqual([
      { name: 'selectFoil', args: [] },
      { name: 'selectFoil', args: [] },
    ]);
  });

  it('其他鍵（字母、Tab、Delete）不攔，也不做事', () => {
    const { rows } = panel();
    const row = rows()[0]!;
    for (const k of ['a', 'Tab', 'Delete', 'Escape']) expect(keydown(row, k).defaultPrevented, k).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('圖層清單：組合鍵與輸入法不攔（T-607c）', () => {
  it('Ctrl＋空白鍵不切換顯示、Ctrl＋Enter 不選中；Cmd／Alt 也一樣；都不攔', () => {
    const { rows } = panel();
    const hero = rows()[1]!;
    hero.focus();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(keydown(hero, ' ', init).defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(keydown(hero, 'Enter', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('輸入法選字中的 ↑ ↓、空白鍵、Enter：不換列、不做事', () => {
    const { rows } = panel();
    const hero = rows()[1]!;
    hero.focus();
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', ' ', 'Enter']) expect(keydown(hero, k, { isComposing: true }).defaultPrevented, k).toBe(false);
    expect(dom.document.activeElement).toBe(hero);
    expect(calls).toEqual([]);
  });

  it('Ctrl／Alt＋↑ ↓ 不換列', () => {
    const { rows } = panel();
    rows()[0]!.focus();
    keydown(rows()[0], 'ArrowDown', { ctrlKey: true });
    keydown(rows()[0], 'ArrowDown', { altKey: true });
    expect(dom.document.activeElement).toBe(rows()[0]);
  });
});

describe('圖層清單：焦點所在的那一列被刪掉（T-607c）', () => {
  it('用鍵盤按垃圾桶刪掉中間那層：焦點移到補上它位置的那一列（不掉到頁面最前面），Tab 停點也跟過去', () => {
    const s = setup();
    const { rows, render } = panel(s);
    const remove = byClass(rows()[1]!, 'layer-remove');
    remove.focus();
    remove.click();
    expect(calls.at(-1)).toEqual({ name: 'deleteLayer', args: ['hero'] });
    render(deleteLayer(s, 'hero', T0));
    expect(rows().map(nameOf)).toEqual(['dragon', 'bg']);
    expect(dom.document.activeElement).not.toBe(dom.document.body);
    expect(dom.document.activeElement).toBe(rows()[1]);
    expect(tabStops(rows())).toEqual([-1, 0]);
  });

  it('刪掉最下面那層：焦點移到上一列', () => {
    const s = setup();
    const { rows, render } = panel(s);
    byClass(rows()[2]!, 'layer-remove').focus();
    render(deleteLayer(s, 'bg', T0));
    expect(dom.document.activeElement).toBe(rows()[1]);
    expect(nameOf(rows()[1]!)).toBe('hero');
  });

  it('刪掉最後一層（清單空了）：焦點移到反光層那一列', () => {
    let s = createEditor(newCard('standard', 'card-1', T0));
    s = addUploadedLayer(s, 'front', input('hero'), 'hero.png', T0).state;
    const { rows, render, foilRow } = panel(s);
    byClass(rows()[0]!, 'layer-remove').focus();
    render(deleteLayer(s, 'hero', T0));
    expect(rows()).toHaveLength(0);
    expect(dom.document.activeElement).toBe(foilRow);
  });

  it('焦點不在被刪的那一列（例如在預覽區按 Delete）：不搶焦點', () => {
    const s = setup();
    const { render } = panel(s);
    const elsewhere = dom.document.createElement('button');
    elsewhere.focus();
    render(deleteLayer(s, 'hero', T0));
    expect(dom.document.activeElement).toBe(elsewhere);
  });
});

describe('圖層清單：打字、列裡面的按鈕不被攔', () => {
  it('在名字輸入框裡打字：方向鍵、空白鍵、Enter 都留給輸入框（不換列、不隱藏、不選）', () => {
    const { rows } = panel();
    const name = byClass(rows()[0]!, 'layer-name');
    name.focus();
    for (const k of ['ArrowDown', 'ArrowUp', ' ', 'Home', 'End']) expect(keydown(name, k).defaultPrevented, k).toBe(false);
    expect(dom.document.activeElement).toBe(name);
    expect(calls).toEqual([]);
  });

  it('列裡面的眼睛、刪除按鈕按空白鍵／Enter 留給按鈕自己（瀏覽器會變成 click），不會連帶切換顯示', () => {
    const { rows } = panel();
    const eye = byClass(rows()[0]!, 'layer-eye');
    eye.focus();
    expect(keydown(eye, ' ').defaultPrevented).toBe(false);
    expect(keydown(eye, 'Enter').defaultPrevented).toBe(false);
    expect(keydown(eye, 'ArrowDown').defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('圖層清單：Tab 停點只有一列', () => {
  it('沒有選中任何圖層：最上面那列是 Tab 停點，它的名字、眼睛、刪除才在 Tab 順序裡；其他列裡面的都不在', () => {
    const { rows } = panel();
    expect(tabStops(rows())).toEqual([0, -1, -1]);
    const stopsOf = (row: FakeElement) => [byClass(row, 'layer-name'), byClass(row, 'layer-eye'), byClass(row, 'layer-remove')].map((c) => c.tabIndex);
    expect(stopsOf(rows()[0]!)).toEqual([0, 0, 0]);
    expect(stopsOf(rows()[1]!)).toEqual([-1, -1, -1]);
    expect(stopsOf(rows()[2]!)).toEqual([-1, -1, -1]);
  });

  it('選中某一層：Tab 停點換成那一列', () => {
    const s = selectLayer(setup(), 'hero');
    const { rows } = panel(s);
    expect(tabStops(rows())).toEqual([-1, 0, -1]);
  });

  it('用 ↑ ↓ 走到另一列：Tab 停點跟過去（再按 Tab 就進那一列的名字、按鈕）；焦點離開清單又回到選中的那列', () => {
    const s = selectLayer(setup(), 'hero');
    const { rows, root } = panel(s);
    rows()[1]!.focus();
    keydown(rows()[1], 'ArrowDown');
    expect(dom.document.activeElement).toBe(rows()[2]);
    expect(tabStops(rows())).toEqual([-1, -1, 0]);
    expect(byClass(rows()[2]!, 'layer-eye').tabIndex).toBe(0);
    expect(byClass(rows()[1]!, 'layer-eye').tabIndex).toBe(-1);
    // 焦點離開清單（跑到清單外面）
    root.dispatchEvent(new FakeEvent('focusout', { relatedTarget: dom.document.createElement('button') }));
    expect(tabStops(rows())).toEqual([-1, 0, -1]);
  });

  it('滑鼠點進某一列裡面的按鈕或名字（focusin）：Tab 停點也換到那一列', () => {
    const { rows } = panel();
    byClass(rows()[2]!, 'layer-eye').dispatchEvent(new FakeEvent('focusin'));
    expect(tabStops(rows())).toEqual([-1, -1, 0]);
  });

  it('反光層那一列永遠是 Tab 停點（它的眼睛按鈕也是）', () => {
    const { foilRow } = panel();
    expect(foilRow.tabIndex).toBe(0);
    expect(byClass(foilRow, 'foil-eye').tabIndex).toBe(0);
  });
});
