// T-802 右欄「沿線條反光」開關（DESIGN §1「線稿高光」）：介面文字、出現條件（立體層有，底圖、文字層沒有）、
// 放在「衝出卡片」下面、一按記一步（可復原）、這層開了衝出卡片時變淡＋滑過說明「衝出卡片的層不反光」、
// 鍵盤可用（原生按鈕＋role=switch）；說明面板「圖層進階效果」段多一句。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Layer } from '../src/model/types';
import {
  addTextLayerEdit,
  addUploadedLayer,
  answerOpaqueLayer,
  askOpaqueUpload,
  createEditor,
  currentCard,
  editLayer,
  redoEdit,
  selectLayer,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { BREAKOUT_NO_HOLO_TEXT, HELP_SECTIONS, LINEART_HELP, LINEART_LABEL, lineartShown, lineartSwitch } from '../src/ui/logic';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, byClass, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

const input = (id: string, hasAlpha: boolean): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、有透明的 hero、沒有透明的加深層 ink（白底黑線的線稿）、文字層 title。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = askOpaqueUpload(s, 'front', input('ink', false), 'ink.png', T0).state;
  s = answerOpaqueLayer(s, 'multiply', T0).state;
  const text = { content: '卡名', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
  s = addTextLayerEdit(s, 'front', { id: 'title', image: 'fedcba9876543210', text, width: 800, height: 200 }, T0).state;
  return s;
}

function layerOf(s: EditorState, id: string): Layer {
  return currentCard(s).front.layers.find((l) => l.id === id)!;
}

describe('文字與出現條件（DESIGN 的字）', () => {
  it('開關名與說明', () => {
    expect(LINEART_LABEL).toBe('沿線條反光');
    expect(LINEART_HELP).toBe('白底黑線的線稿：線條會發出彩虹光（混合模式選「加深」白底就會消失）');
  });

  it('立體層（含沒有透明的加深層）有；底圖、文字層沒有', () => {
    const s = setup();
    expect(lineartShown(layerOf(s, 'hero'))).toBe(true);
    expect(lineartShown(layerOf(s, 'ink'))).toBe(true);
    expect(lineartShown(layerOf(s, 'bg'))).toBe(false);
    expect(lineartShown(layerOf(s, 'title'))).toBe(false);
  });

  it('衝出卡片的層：開關變淡、按了不改，滑過說明「衝出卡片的層不反光」', () => {
    const s = setup();
    expect(lineartSwitch(layerOf(s, 'ink'))).toEqual({ on: false, locked: false, title: '' });
    expect(lineartSwitch({ ...layerOf(s, 'ink'), lineart: true })).toEqual({ on: true, locked: false, title: '' });
    expect(lineartSwitch({ ...layerOf(s, 'ink'), lineart: true, breakout: true })).toEqual({ on: true, locked: true, title: BREAKOUT_NO_HOLO_TEXT });
    expect(BREAKOUT_NO_HOLO_TEXT).toBe('衝出卡片的層不反光');
  });
});

describe('編輯：一按記一步', () => {
  it('打開 → 復原回到沒有欄位 → 重做又打開；關掉拿掉欄位', () => {
    const s0 = setup();
    const on = editLayer(s0, 'ink', { lineart: true }, 'commit', T1);
    expect(layerOf(on, 'ink').lineart).toBe(true);
    expect(toUiState(on, () => undefined).canUndo).toBe(true);
    const undone = undoEdit(on);
    expect('lineart' in layerOf(undone, 'ink')).toBe(false);
    expect(currentCard(undone)).toEqual(currentCard(s0));
    expect(layerOf(redoEdit(undone), 'ink').lineart).toBe(true);
    const off = editLayer(on, 'ink', { lineart: false }, 'commit', T1);
    expect('lineart' in layerOf(off, 'ink')).toBe(false);
  });

  it('底圖、文字層送 lineart 不會改（不記步）', () => {
    const s0 = setup();
    expect(currentCard(editLayer(s0, 'bg', { lineart: true }, 'commit', T1))).toBe(currentCard(s0));
    expect(currentCard(editLayer(s0, 'title', { lineart: true }, 'commit', T1))).toBe(currentCard(s0));
  });
});

// ---- 右欄（假 DOM） ----

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

beforeEach(() => {
  installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount() {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const root = inspector.el as unknown as FakeElement;
  // T-840：測效果本身前先展開預設收起的進階效果。
  all(root, 'section-toggle').find((b) => b.getAttribute('aria-controls') === 'section-layer-advanced')!.click();
  const render = (s: EditorState) => inspector.render(toUiState(s, (h) => `blob:${h}`) as UiState);
  const block = () => byClass(root, 'lineart-block');
  const sw = () => byClass(block(), 'switch');
  return { root, calls, render, block, sw };
}

describe('右欄「沿線條反光」', () => {
  it('選中立體層：出現開關＋小字；原生按鈕、role=switch、名字（鍵盤 Tab 得到、Enter／空白鍵就是按）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'ink'));
    expect(isShown(t.block())).toBe(true);
    expect(t.block().textContent).toContain(LINEART_LABEL);
    expect(t.block().textContent).toContain(LINEART_HELP);
    expect(t.sw().tagName).toBe('BUTTON');
    expect(t.sw().getAttribute('role')).toBe('switch');
    expect(t.sw().getAttribute('aria-label')).toBe(LINEART_LABEL);
    expect(t.sw().getAttribute('aria-checked')).toBe('false');
  });

  it('底圖、文字層：沒有這個開關', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'bg'));
    expect(isShown(t.block())).toBe(false);
    t.render(selectLayer(setup(), 'title'));
    expect(isShown(t.block())).toBe(false);
    t.render(selectLayer(setup(), 'hero'));
    expect(isShown(t.block())).toBe(true);
  });

  it('位置：「衝出卡片」那一塊的下一塊', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'ink'));
    const breakoutBlock = byClass(t.root, 'breakout-block');
    const siblings = breakoutBlock.parentNode!.children;
    expect(siblings.indexOf(t.block())).toBe(siblings.indexOf(breakoutBlock) + 1);
  });

  it('按一下 → editLayer(這層, { lineart: true }, commit)；開著時顯示開、再按送 false', () => {
    const t = mount();
    const s = selectLayer(setup(), 'ink');
    t.render(s);
    t.sw().click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['ink', { lineart: true }, 'commit'] }]);
    t.calls.length = 0;
    t.render(editLayer(s, 'ink', { lineart: true }, 'commit', T1));
    expect(t.sw().getAttribute('aria-checked')).toBe('true');
    t.sw().click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['ink', { lineart: false }, 'commit'] }]);
  });

  it('這層開了衝出卡片：變淡、aria-disabled、滑過說明；按了不改；關掉衝出卡片後恢復', () => {
    const t = mount();
    const s = editLayer(selectLayer(setup(), 'ink'), 'ink', { breakout: true }, 'commit', T1);
    t.render(s);
    expect(t.block().classList.contains('is-locked')).toBe(true);
    expect(t.sw().getAttribute('aria-disabled')).toBe('true');
    expect(t.sw().title).toBe(BREAKOUT_NO_HOLO_TEXT);
    expect(t.block().title).toBe(BREAKOUT_NO_HOLO_TEXT);
    t.sw().click();
    expect(t.calls).toEqual([]);
    t.render(editLayer(s, 'ink', { breakout: false }, 'commit', T1));
    expect(t.block().classList.contains('is-locked')).toBe(false);
    expect(t.sw().getAttribute('aria-disabled')).toBeNull();
    expect(t.sw().title).toBe('');
    t.sw().click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['ink', { lineart: true }, 'commit'] }]);
  });
});

describe('說明面板「圖層進階效果」段', () => {
  it('多一句沿線條反光', () => {
    const lines = HELP_SECTIONS.find((s) => s.title === '圖層進階效果')!.lines;
    expect(lines).toContain('白底黑線的線稿可以打開「沿線條反光」，線條會發彩虹光。');
  });
});
