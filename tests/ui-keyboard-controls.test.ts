// 共用的分段按鈕（T-607，T-415 交叉審查的中等問題）：單選群組（radiogroup／radio，不是分頁）、方向鍵切換、
// 焦點與 aria-checked 同步、只有選中的在 Tab 順序裡、到頭停住不繞回。右欄「舞台」七選一（T-832 多工作桌）、比例、反光層形狀、正面｜背面都用它。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';
import type { StageStyle } from '../src/model/types';
import { createSegmented } from '../src/ui/controls';
import { createEditor, editCard, toUiState } from '../src/ui/editor';
import { createFoilPanel } from '../src/ui/foil-panel';
import { createInspector } from '../src/ui/inspector';
import { createLayerPanel } from '../src/ui/layer-list';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, installFakeDom, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

let dom: FakeDom;

beforeEach(() => {
  dom = installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const ui = (s: ReturnType<typeof createEditor>): UiState => toUiState(s, (h) => `blob:${h}`);

function stageGroup(root: FakeElement): FakeElement {
  const group = all(root, 'segmented').find((s) => s.getAttribute('aria-label') === '舞台');
  if (!group) throw new Error('找不到舞台選項');
  return group;
}

const SCENES: readonly StageStyle[] = ['halo', 'gallery', 'magic', 'water', 'nebula', 'desk', 'none'];

describe('舞台七選一：單選群組（不是分頁）', () => {
  it('群組是 radiogroup、每顆是 radio；沒有 tablist／tab／aria-selected', () => {
    const { intents } = recorder();
    const inspector = createInspector(intents);
    inspector.render(ui(createEditor(newCard('standard', 'c1', T0))));
    const group = stageGroup(inspector.el as unknown as FakeElement);
    expect(group.getAttribute('role')).toBe('radiogroup');
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(7);
    for (const b of buttons) {
      expect(b.getAttribute('role')).toBe('radio');
      expect(b.getAttribute('aria-selected')).toBeNull();
      expect(b.getAttribute('aria-checked')).not.toBeNull();
    }
  });

  it('aria-checked 和選中的一致；只有選中的那顆在 Tab 順序裡（tabIndex 0），其他 -1', () => {
    const { intents } = recorder();
    const inspector = createInspector(intents);
    let s = createEditor(newCard('standard', 'c1', T0));
    inspector.render(ui(s));
    const checked = () => stageGroup(inspector.el as unknown as FakeElement).querySelectorAll('button').map((b) => b.getAttribute('aria-checked') === 'true');
    const tabStops = () => stageGroup(inspector.el as unknown as FakeElement).querySelectorAll('button').map((b) => b.tabIndex);
    expect(checked()).toEqual(SCENES.map((x) => x === 'desk'));
    expect(tabStops()).toEqual([-1, -1, -1, -1, -1, 0, -1]);
    s = editCard(s, { view: { stage: 'water' } }, 'commit', T1);
    inspector.render(ui(s));
    expect(checked()).toEqual(SCENES.map((x) => x === 'water'));
    expect(tabStops()).toEqual([-1, -1, -1, 0, -1, -1, -1]);
  });

  it('→ ↓ 換到下一個舞台：焦點跟過去，送一次 editCard(commit)；← ↑ 往回', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    inspector.render(ui(createEditor(newCard('standard', 'c1', T0))));
    const buttons = stageGroup(inspector.el as unknown as FakeElement).querySelectorAll('button');
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowRight');
    expect(dom.document.activeElement).toBe(buttons[1]);
    expect(calls.at(-1)).toEqual({ name: 'editCard', args: [{ view: { stage: 'gallery' } }, 'commit'] });
    keydown(buttons[1], 'ArrowDown');
    expect(dom.document.activeElement).toBe(buttons[2]);
    expect(calls.at(-1)).toEqual({ name: 'editCard', args: [{ view: { stage: 'magic' } }, 'commit'] });
  });

  it('方向鍵送出後 render 對齊：焦點、aria-checked、Tab 停點都在新的那顆上，可以連續按', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    let s = createEditor(newCard('standard', 'c1', T0));
    inspector.render(ui(s));
    const group = () => stageGroup(inspector.el as unknown as FakeElement);
    group().querySelectorAll('button')[0]!.focus();
    for (const expected of ['gallery', 'magic', 'water']) {
      keydown(dom.document.activeElement, 'ArrowRight');
      s = editCard(s, { view: { stage: expected as StageStyle } }, 'commit', T1);
      inspector.render(ui(s));
      const buttons = group().querySelectorAll('button');
      const at = SCENES.indexOf(expected as StageStyle);
      expect(dom.document.activeElement).toBe(buttons[at]);
      expect(buttons[at]!.getAttribute('aria-checked')).toBe('true');
      expect(buttons[at]!.tabIndex).toBe(0);
    }
    expect(calls.filter((c) => c.name === 'editCard')).toHaveLength(3);
  });

  it('到頭停住不繞回：最後一顆按 → ↓、第一顆按 ← ↑ 都不送、焦點不動', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    let s = createEditor(newCard('standard', 'c1', T0));
    s = editCard(s, { view: { stage: 'none' } }, 'commit', T1);
    inspector.render(ui(s));
    const buttons = stageGroup(inspector.el as unknown as FakeElement).querySelectorAll('button');
    buttons[6]!.focus();
    const before = calls.length;
    keydown(buttons[6], 'ArrowRight');
    keydown(buttons[6], 'ArrowDown');
    expect(dom.document.activeElement).toBe(buttons[6]);
    expect(calls.length).toBe(before);
    s = editCard(s, { view: { stage: 'halo' } }, 'commit', T1);
    inspector.render(ui(s));
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowLeft');
    keydown(buttons[0], 'ArrowUp');
    expect(dom.document.activeElement).toBe(buttons[0]);
    expect(calls.length).toBe(before);
  });

  it('用滑鼠點還是一樣：點哪個送哪個', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    inspector.render(ui(createEditor(newCard('standard', 'c1', T0))));
    stageGroup(inspector.el as unknown as FakeElement).querySelectorAll('button')[3]!.click();
    expect(calls.at(-1)).toEqual({ name: 'editCard', args: [{ view: { stage: 'water' } }, 'commit'] });
  });
});

describe('createSegmented（共用）', () => {
  it('第一次 set 之前，第一顆先當 Tab 停點；沒有選中的值時 aria-checked 都是 false', () => {
    const seg = createSegmented('測試', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], () => {});
    const buttons = seg.el.querySelectorAll('button') as unknown as FakeElement[];
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1]);
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  });

  it('方向鍵移動時 onPick 帶 via=key，點擊帶 via=click', () => {
    const picks: [string, string][] = [];
    const seg = createSegmented('測試', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], (v, via) => picks.push([v, via]));
    seg.set('a');
    const buttons = seg.el.querySelectorAll('button') as unknown as FakeElement[];
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowRight');
    buttons[2]!.click();
    expect(picks).toEqual([['b', 'key'], ['c', 'click']]);
  });

  it('Ctrl／Cmd／Alt＋方向鍵、輸入法選字中的方向鍵：不換、不送、不攔（T-607c）', () => {
    const picks: string[] = [];
    const seg = createSegmented('測試', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], (v) => picks.push(v));
    seg.set('a');
    const buttons = seg.el.querySelectorAll('button') as unknown as FakeElement[];
    buttons[0]!.focus();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      expect(keydown(buttons[0], 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(picks).toEqual([]);
    expect(dom.document.activeElement).toBe(buttons[0]);
    // Shift 不算組合鍵：照樣換
    keydown(buttons[0], 'ArrowRight', { shiftKey: true });
    expect(picks).toEqual(['b']);
  });

  it('不是方向鍵的鍵（Tab、字母、Enter）不攔', () => {
    const seg = createSegmented('測試', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], () => {});
    seg.set('a');
    const buttons = seg.el.querySelectorAll('button') as unknown as FakeElement[];
    buttons[0]!.focus();
    for (const k of ['Tab', 'a', 'Enter', ' ']) expect(keydown(buttons[0], k).defaultPrevented).toBe(false);
    expect(dom.document.activeElement).toBe(buttons[0]);
  });

  it('沒有別處再用 tablist／tab：右欄比例、正面｜背面、反光層形狀也都是單選群組', () => {
    const { intents } = recorder();
    const s = createEditor(newCard('standard', 'c1', T0));
    const inspector = createInspector(intents);
    inspector.render(ui(s));
    const layers = createLayerPanel(intents);
    layers.render(ui(s));
    const foil = createFoilPanel(intents);
    foil.render(ui({ ...s, foilSelected: true }));
    for (const root of [inspector.el, layers.el, foil.el] as unknown as FakeElement[]) {
      const groups = all(root, 'segmented');
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.getAttribute('role'), g.getAttribute('aria-label') ?? '').toBe('radiogroup');
        for (const b of g.querySelectorAll('button')) expect(b.getAttribute('role')).toBe('radio');
      }
    }
  });

  it('反光層形狀：方向鍵經過「上傳黑白圖」時不跳出選檔視窗；在上面按 Enter／空白鍵（click）才選圖', () => {
    const { intents, calls } = recorder();
    const foil = createFoilPanel(intents);
    foil.render(ui({ ...createEditor(newCard('standard', 'c1', T0)), foilSelected: true }));
    const group = all(foil.el, 'segmented').find((g) => g.getAttribute('aria-label') === '反光層的形狀')!;
    const buttons = group.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    // 預設形狀是「整面」，往右兩下到「上傳黑白圖」
    const fileInput = all(foil.el, 'foil-file')[0]!;
    let opened = 0;
    fileInput.click = () => void opened++;
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowRight');
    keydown(buttons[1], 'ArrowRight');
    expect(opened).toBe(0);
    expect(dom.document.activeElement).toBe(buttons[2]);
    // 「用圖層形狀」是方向鍵經過時換上的
    expect(calls.filter((c) => c.name === 'editFoil').map((c) => c.args[0])).toEqual([{ shape: 'layers' }]);
    buttons[2]!.click();
    expect(opened).toBe(1);
  });
});
