// T-815 水鏡遠景的畫面（DESIGN §5「水鏡遠景」）：
// 舞台選水鏡時，舞台按鈕下面多「遠景」三顆小縮圖按鈕〔湖光山峰〕〔水墨山〕〔富士山〕（同一組單選、方向鍵切換、只有選中的在 Tab 順序裡）；
// 每次切換記一步（editCard commit）；其他舞台不顯示；有自己的背景圖時三顆變淡、說明「用了自己的背景圖（拿掉就會換回遠景）」；
// 小縮圖用那三張圖本身（main 讀好給網址，還沒讀好就不放圖）；說明面板多一句。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle, WaterScene } from '../src/model/types';
import { createEditor, currentCard, editCard, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import {
  HELP_SECTIONS,
  WATER_SCENE_BACKDROP_NOTE,
  WATER_SCENE_HELP_LINE,
  WATER_SCENE_OPTIONS,
  WATER_SCENE_TITLE,
  waterSceneFor,
} from '../src/ui/logic';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, byClass, installFakeDom, isShown, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';
const BD = 'bbbbbbbbbbbbbbb1';

let dom: FakeDom;
const active = () => dom.document.activeElement;

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

const plainCard = (id = 'card-1') => newCard('standard', id, T0);
const onStage = (card: Card, stage: StageStyle) => updateCard(card, { view: { stage } });
const water = (scene?: WaterScene, card: Card = plainCard()) => updateCard(onStage(card, 'water'), scene ? { view: { waterScene: scene } } : {});

/** main 讀好的縮圖網址（blob:）；loaded＝哪幾張讀好了。 */
const urls = (loaded: readonly WaterScene[] = ['lake', 'ink', 'fuji']) => (scene: WaterScene) =>
  loaded.includes(scene) ? `blob:scene-${scene}` : undefined;

function mount() {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const root = inspector.el as unknown as FakeElement;
  const render = (card: Card, loaded?: readonly WaterScene[]) => {
    const state: UiState = { ...toUiState(createEditor(card), (h) => `blob:${h}`), waterSceneUrl: urls(loaded) };
    inspector.render(state);
  };
  const block = () => byClass(root, 'water-scene-block');
  const group = () => byClass(block(), 'water-scene-grid');
  const buttons = () => group().querySelectorAll('button');
  return { root, calls, render, block, group, buttons };
}

describe('文字照 DESIGN', () => {
  it('小節名「遠景」、三顆的名字與順序、有背景圖時的說明；說明面板多一句', () => {
    expect(WATER_SCENE_TITLE).toBe('遠景');
    expect(WATER_SCENE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['lake', '湖光山峰'],
      ['ink', '水墨山'],
      ['fuji', '富士山'],
    ]);
    expect(WATER_SCENE_BACKDROP_NOTE).toBe('用了自己的背景圖（拿掉就會換回遠景）');
    expect(WATER_SCENE_HELP_LINE).toBe('舞台選水鏡時，可以換遠景：湖光山峰、水墨山、富士山。');
    expect(HELP_SECTIONS.some((s) => s.lines.includes(WATER_SCENE_HELP_LINE))).toBe(true);
  });
});

describe('waterSceneFor：水鏡要畫哪個遠景', () => {
  it('省略＝湖光山峰；選了照選的；有自己的背景圖＝backdrop（遠景被取代，欄位照存）', () => {
    expect(waterSceneFor(water())).toBe('lake');
    expect(waterSceneFor(water('ink'))).toBe('ink');
    expect(waterSceneFor(water('fuji'))).toBe('fuji');
    expect(waterSceneFor(setBackdrop(water('fuji'), BD))).toBe('backdrop');
    expect(setBackdrop(water('fuji'), BD).view.waterScene).toBe('fuji');
  });
});

describe('右欄「遠景」三顆', () => {
  it('只在水鏡顯示：其他五種舞台藏起來', () => {
    const t = mount();
    for (const stage of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
      t.render(onStage(plainCard(), stage));
      expect(isShown(t.block()), stage).toBe(false);
    }
    t.render(water());
    expect(isShown(t.block())).toBe(true);
    expect(t.block().textContent).toContain(WATER_SCENE_TITLE);
  });

  it('在舞台六顆按鈕下面（T-825 起中間隔著「水面」）、背景圖那一列上面（同一個「舞台」小節）', () => {
    const t = mount();
    t.render(water());
    const grid = all(t.root, 'stage-grid')[0]!;
    const kids = grid.parentNode!.children as unknown as FakeElement[];
    const at = kids.indexOf(grid);
    expect(kids[at + 1]!.classList.contains('water-look-block')).toBe(true);
    expect(kids[at + 2]).toBe(t.block());
    expect(kids[at + 3]!.classList.contains('backdrop-block')).toBe(true);
  });

  it('三顆小縮圖按鈕（原生按鈕）：縮圖是那張圖本身、下面是名字；還沒讀好的先不放圖', () => {
    const t = mount();
    t.render(water(), ['lake']);
    const buttons = t.buttons();
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(buttons.map((b) => b.textContent)).toEqual(['湖光山峰', '水墨山', '富士山']);
    const thumbs = buttons.map((b) => byClass(b, 'water-scene-thumb'));
    expect(thumbs.map((i) => i.getAttribute('src'))).toEqual(['blob:scene-lake', null, null]);
    t.render(water());
    expect(thumbs.map((i) => i.getAttribute('src'))).toEqual(['blob:scene-lake', 'blob:scene-ink', 'blob:scene-fuji']);
  });

  it('單選群組：radiogroup／radio、aria-checked 和這張卡選的一致、只有選中的在 Tab 順序裡；省略＝湖光山峰', () => {
    const t = mount();
    t.render(water());
    expect(t.group().getAttribute('role')).toBe('radiogroup');
    expect(t.group().getAttribute('aria-label')).toBe(WATER_SCENE_TITLE);
    expect(t.buttons().map((b) => b.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(t.buttons().map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(t.buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    t.render(water('fuji'));
    expect(t.buttons().map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(t.buttons().map((b) => b.classList.contains('is-selected'))).toEqual([false, false, true]);
    expect(t.buttons().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('點一顆：送一次 editCard({ view: { waterScene } }, commit)', () => {
    const t = mount();
    t.render(water());
    t.buttons()[2]!.click();
    t.buttons()[1]!.click();
    expect(t.calls).toEqual([
      { name: 'editCard', args: [{ view: { waterScene: 'fuji' } }, 'commit'] },
      { name: 'editCard', args: [{ view: { waterScene: 'ink' } }, 'commit'] },
    ]);
  });

  it('方向鍵切換：焦點跟過去、送一次 commit；到頭停住', () => {
    const t = mount();
    t.render(water());
    const buttons = t.buttons();
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowRight');
    expect(active()).toBe(buttons[1]);
    expect(t.calls).toEqual([{ name: 'editCard', args: [{ view: { waterScene: 'ink' } }, 'commit'] }]);
    t.calls.length = 0;
    t.render(water('fuji'));
    buttons[2]!.focus();
    keydown(buttons[2], 'ArrowRight');
    expect(t.calls).toEqual([]);
    keydown(buttons[2], 'ArrowLeft');
    expect(active()).toBe(buttons[1]);
    expect(t.calls).toEqual([{ name: 'editCard', args: [{ view: { waterScene: 'ink' } }, 'commit'] }]);
  });

  it('有自己的背景圖：三顆變淡（不能按）、選中的照樣標著，下面說明；拿掉就恢復', () => {
    const t = mount();
    t.render(setBackdrop(water('ink'), BD));
    expect(t.group().classList.contains('is-muted')).toBe(true);
    expect(t.buttons().map((b) => b.disabled)).toEqual([true, true, true]);
    expect(t.buttons().map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    const note = byClass(t.block(), 'water-scene-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(WATER_SCENE_BACKDROP_NOTE);
    t.render(water('ink'));
    expect(t.group().classList.contains('is-muted')).toBe(false);
    expect(t.buttons().map((b) => b.disabled)).toEqual([false, false, false]);
    expect(isShown(note)).toBe(false);
  });
});

describe('editor：每次切換記一步', () => {
  it('換成水墨山 → 富士山：兩步，復原照順序回去；選同一種不多記', () => {
    const s0 = createEditor(water());
    const s1 = editCard(s0, { view: { waterScene: 'ink' } }, 'commit', T1);
    const s2 = editCard(s1, { view: { waterScene: 'fuji' } }, 'commit', T1);
    expect(currentCard(s2).view.waterScene).toBe('fuji');
    expect(currentCard(s2).updatedAt).toBe(T1);
    expect(currentCard(undoEdit(s2)).view.waterScene).toBe('ink');
    expect('waterScene' in currentCard(undoEdit(undoEdit(s2))).view).toBe(false);
    const same = editCard(s2, { view: { waterScene: 'fuji' } }, 'commit', T1);
    expect(currentCard(undoEdit(same)).view.waterScene).toBe('ink');
  });

  it('沒選過的卡切回湖光山峰：不記步', () => {
    const s0: EditorState = createEditor(water());
    const s1 = editCard(s0, { view: { waterScene: 'lake' } }, 'commit', T1);
    expect(s1.history.past).toHaveLength(s0.history.past.length);
  });
});
