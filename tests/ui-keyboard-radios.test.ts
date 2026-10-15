// 右欄的混合模式（7 選項）與鐳射色彩（7 選項）也是單選群組（T-607b，同 createSegmented）：
// 方向鍵切換並送一次 commit（一按一步）、焦點與 aria-checked 同步、只有選中的在 Tab 順序裡、到頭停住不繞回、跳過不能選的。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { BLEND_MODES, type BlendMode, type HoloPalette } from '../src/model/types';
import { addUploadedLayer, answerOpaqueLayer, askOpaqueUpload, createEditor, editLayer, selectLayer, toUiState, type EditorState } from '../src/ui/editor';
import { attachRadioGroup } from '../src/ui/controls';
import { button, h } from '../src/ui/dom';
import { createInspector } from '../src/ui/inspector';
import { blendChoices, HOLO_PALETTE_OPTIONS } from '../src/ui/logic';
import { createPalettePicker } from '../src/ui/palette-picker';
import type { UiIntents } from '../src/ui/types';
import { all, FakeEvent, installFakeDom, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

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

const input = (id: string, hasAlpha: boolean): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、立體層 hero（hasAlpha 決定混合模式能選幾個）；選中 hero。 */
function setup(hasAlpha = true, blend: BlendMode = 'normal'): EditorState {
  let s = createEditor(newCard('standard', 'c1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', hasAlpha), 'hero.png', T0).state;
  if (blend !== 'normal') s = editLayer(s, 'hero', { blend }, 'commit', T0);
  return selectLayer(s, 'hero');
}

function blendGroup(root: FakeElement): FakeElement {
  const group = all(root, 'blend-list')[0];
  if (!group) throw new Error('找不到混合模式');
  return group;
}

describe('混合模式：單選群組', () => {
  function mount(s: EditorState) {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    inspector.render(toUiState(s, (h) => `blob:${h}`));
    const root = inspector.el as unknown as FakeElement;
    return { inspector, calls, root, render: (next: EditorState) => inspector.render(toUiState(next, (h) => `blob:${h}`)), buttons: () => blendGroup(root).querySelectorAll('button') };
  }

  it('群組是 radiogroup、每顆是 radio；aria-checked 和選中的一致；只有選中的那顆在 Tab 順序裡', () => {
    const t = mount(setup(true, 'screen'));
    expect(blendGroup(t.root).getAttribute('role')).toBe('radiogroup');
    const buttons = t.buttons();
    expect(buttons).toHaveLength(BLEND_MODES.length);
    for (const b of buttons) expect(b.getAttribute('role')).toBe('radio');
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(BLEND_MODES.map((m) => String(m === 'screen')));
    expect(buttons.map((b) => b.tabIndex)).toEqual(BLEND_MODES.map((m) => (m === 'screen' ? 0 : -1)));
  });

  it('→ ↓ 換到下一個模式：焦點跟過去，送一次 editLayer(blend, commit)；← ↑ 往回', () => {
    const t = mount(setup());
    const buttons = t.buttons();
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowRight');
    expect(active()).toBe(buttons[1]);
    expect(t.calls.at(-1)).toEqual({ name: 'editLayer', args: ['hero', { blend: 'multiply' }, 'commit'] });
    keydown(buttons[1], 'ArrowDown');
    expect(active()).toBe(buttons[2]);
    expect(t.calls.at(-1)).toEqual({ name: 'editLayer', args: ['hero', { blend: 'screen' }, 'commit'] });
    keydown(buttons[2], 'ArrowLeft');
    expect(active()).toBe(buttons[1]);
    expect(t.calls.at(-1)).toEqual({ name: 'editLayer', args: ['hero', { blend: 'multiply' }, 'commit'] });
  });

  it('Ctrl／Cmd／Alt＋方向鍵、輸入法選字中、已經被處理過的方向鍵：不換、不送、不攔（T-607c）', () => {
    const t = mount(setup());
    const buttons = t.buttons();
    buttons[0]!.focus();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      expect(keydown(buttons[0], 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    const handled = new FakeEvent('keydown', { key: 'ArrowRight' });
    handled.preventDefault();
    buttons[0]!.dispatchEvent(handled);
    expect(active()).toBe(buttons[0]);
    expect(t.calls.filter((c) => c.name === 'editLayer')).toEqual([]);
  });

  it('每按一次方向鍵送一次 commit（一步，和卡框樣式、舞台一樣），按了幾次就送幾次', () => {
    const t = mount(setup());
    const buttons = t.buttons();
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowDown');
    keydown(buttons[1], 'ArrowDown');
    keydown(buttons[2], 'ArrowDown');
    expect(t.calls.filter((c) => c.name === 'editLayer').map((c) => (c.args[1] as { blend: string }).blend)).toEqual(['multiply', 'screen', 'add']);
    expect(t.calls.filter((c) => c.name === 'editLayer').every((c) => c.args[2] === 'commit')).toBe(true);
  });

  it('送出後 render 對齊：焦點、aria-checked、Tab 停點都在新的那顆上，可以連續按', () => {
    let s = setup();
    const t = mount(s);
    t.buttons()[0]!.focus();
    for (const expected of ['multiply', 'screen', 'add'] as const) {
      keydown(active(), 'ArrowRight');
      s = editLayer(s, 'hero', { blend: expected }, 'commit', T1);
      t.render(s);
      const at = BLEND_MODES.indexOf(expected);
      const buttons = t.buttons();
      expect(active()).toBe(buttons[at]);
      expect(buttons[at]!.getAttribute('aria-checked')).toBe('true');
      expect(buttons[at]!.tabIndex).toBe(0);
      expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    }
  });

  it('到頭停住不繞回：最後一個按 → ↓、第一個按 ← ↑ 都不送、焦點不動', () => {
    const last = BLEND_MODES[BLEND_MODES.length - 1]!;
    const t = mount(setup(true, last));
    const buttons = t.buttons();
    buttons[buttons.length - 1]!.focus();
    const before = t.calls.length;
    keydown(buttons[buttons.length - 1], 'ArrowRight');
    keydown(buttons[buttons.length - 1], 'ArrowDown');
    expect(active()).toBe(buttons[buttons.length - 1]);
    expect(t.calls.length).toBe(before);
    t.render(setup(true, 'normal'));
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowLeft');
    keydown(buttons[0], 'ArrowUp');
    expect(active()).toBe(buttons[0]);
    expect(t.calls.length).toBe(before);
  });

  it('沒有透明的圖：不能選的模式（變淡的）方向鍵跳過，不能停在上面', () => {
    // 沒有透明的圖：上傳確認框選〔當發光層〕加成立體層（hasAlpha false）
    let s = addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('bg', false), 'bg.jpg', T0).state;
    s = answerOpaqueLayer(askOpaqueUpload(s, 'front', input('hero', false), 'hero.png', T0).state, 'screen', T0).state;
    s = selectLayer(s, 'hero');
    const t = mount(s);
    const enabled = blendChoices({ role: 'depth', hasAlpha: false }).choices.map((c) => c.enabled);
    const buttons = t.buttons();
    expect(buttons.map((b) => !b.disabled)).toEqual(enabled);
    expect(enabled.filter(Boolean).length).toBeLessThan(BLEND_MODES.length);
    expect(buttons[enabled.indexOf(true)]!.getAttribute('aria-checked')).toBe('false');
    // 選中的（發光）是 Tab 停點
    expect(buttons.map((b) => b.tabIndex)).toEqual(BLEND_MODES.map((m) => (m === 'screen' ? 0 : -1)));
    buttons[enabled.indexOf(true)]!.focus();
    // 一路往後按，走過的每一個都是能選的，最後停在最後一個能選的（不會停在變淡的上面）
    const visited: number[] = [];
    for (let i = 0; i < BLEND_MODES.length; i++) {
      keydown(active(), 'ArrowRight');
      visited.push(buttons.indexOf(active() as FakeElement));
    }
    expect(visited.every((i) => enabled[i])).toBe(true);
    const lastEnabled = enabled.lastIndexOf(true);
    expect(visited.at(-1)).toBe(lastEnabled);
    // 中間的空隙（變淡的）不會卡住：能選的每一個都走過一次，也只送過能選的模式
    expect([...new Set(visited)]).toEqual(enabled.map((on, i) => (on ? i : -1)).filter((i) => i > enabled.indexOf(true)));
    const sent = t.calls.filter((c) => c.name === 'editLayer').map((c) => (c.args[1] as { blend: BlendMode }).blend);
    expect(sent.every((m) => enabled[BLEND_MODES.indexOf(m)])).toBe(true);
    // 走過的能選的模式都送了（選中的「發光」本來就是，所以不再送一次）
    expect(sent).toEqual(BLEND_MODES.filter((m, i) => enabled[i] && i > enabled.indexOf(true) && m !== 'screen'));
  });

  it('不是方向鍵的鍵（Tab、字母、Enter、空白鍵）不攔，也不送；點擊還是照樣選', () => {
    const t = mount(setup());
    const buttons = t.buttons();
    buttons[0]!.focus();
    for (const k of ['Tab', 'a', 'Enter', ' ', 'Home']) expect(keydown(buttons[0], k).defaultPrevented, k).toBe(false);
    expect(t.calls.filter((c) => c.name === 'editLayer')).toEqual([]);
    buttons[3]!.click();
    expect(t.calls.at(-1)).toEqual({ name: 'editLayer', args: ['hero', { blend: 'add' }, 'commit'] });
  });
});

describe('鐳射色彩：單選群組', () => {
  const options = HOLO_PALETTE_OPTIONS.map((o) => o.value);

  function mount(palette: HoloPalette = 'warm') {
    const calls: { patch: unknown; phase: string }[] = [];
    const picker = createPalettePicker((patch, phase) => calls.push({ patch, phase }));
    const holo = { ...newCard('standard', 'c1', T0).holo, palette };
    picker.render(holo);
    const root = picker.el as unknown as FakeElement;
    const group = all(root, 'palette-grid')[0]!;
    return { picker, calls, group, holo, buttons: () => group.querySelectorAll('button') };
  }

  it('群組是 radiogroup、每顆是 radio；aria-checked 和選中的一致；只有選中的那顆在 Tab 順序裡', () => {
    const t = mount('gold');
    expect(t.group.getAttribute('role')).toBe('radiogroup');
    const buttons = t.buttons();
    expect(buttons).toHaveLength(7);
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(options.map((o) => String(o === 'gold')));
    expect(buttons.map((b) => b.tabIndex)).toEqual(options.map((o) => (o === 'gold' ? 0 : -1)));
  });

  it('→ ↓ 換下一個色彩：焦點跟過去，送 onChange({ palette }, commit)；← ↑ 往回', () => {
    const t = mount('warm');
    const buttons = t.buttons();
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowRight');
    expect(active()).toBe(buttons[1]);
    expect(t.calls.at(-1)).toEqual({ patch: { palette: 'classic' }, phase: 'commit' });
    keydown(buttons[1], 'ArrowDown');
    expect(t.calls.at(-1)).toEqual({ patch: { palette: 'silver' }, phase: 'commit' });
    keydown(buttons[2], 'ArrowUp');
    expect(active()).toBe(buttons[1]);
    expect(t.calls.at(-1)).toEqual({ patch: { palette: 'classic' }, phase: 'commit' });
  });

  it('送出後 render 對齊：焦點、aria-checked、Tab 停點都在新的那顆上', () => {
    const t = mount('warm');
    t.buttons()[0]!.focus();
    keydown(active(), 'ArrowRight');
    t.picker.render({ ...t.holo, palette: 'classic' });
    const buttons = t.buttons();
    expect(active()).toBe(buttons[1]);
    expect(buttons[1]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1, -1]);
  });

  it('到頭停住不繞回；最後一個是「自訂」', () => {
    const t = mount('custom');
    const buttons = t.buttons();
    expect(options[options.length - 1]).toBe('custom');
    buttons[6]!.focus();
    const before = t.calls.length;
    keydown(buttons[6], 'ArrowRight');
    keydown(buttons[6], 'ArrowDown');
    expect(active()).toBe(buttons[6]);
    t.picker.render({ ...t.holo, palette: 'warm' });
    buttons[0]!.focus();
    keydown(buttons[0], 'ArrowLeft');
    keydown(buttons[0], 'ArrowUp');
    expect(active()).toBe(buttons[0]);
    expect(t.calls.length).toBe(before);
  });

  it('不是方向鍵的鍵不攔；點擊還是照樣選', () => {
    const t = mount();
    const buttons = t.buttons();
    buttons[0]!.focus();
    for (const k of ['Tab', 'a', 'Enter', ' ']) expect(keydown(buttons[0], k).defaultPrevented, k).toBe(false);
    expect(t.calls).toEqual([]);
    buttons[4]!.click();
    expect(t.calls.at(-1)).toEqual({ patch: { palette: 'aurora' }, phase: 'commit' });
  });
});

describe('單選群組（共用的 attachRadioGroup）：skip 選項（T-811b）', () => {
  function mount(skip?: (i: number) => boolean) {
    const picks: number[] = [];
    const buttons = ['甲', '乙', '丙', '丁'].map((t) => button('seg-btn', [t]));
    const group = h('div', { className: 'segmented', attrs: { role: 'radiogroup' } }, buttons) as unknown as FakeElement;
    const radios = attachRadioGroup(group as unknown as HTMLElement, buttons, (i) => picks.push(i), skip);
    const els = buttons as unknown as FakeElement[];
    return { picks, radios, els };
  }

  it('沒給 skip＝和以前一樣：只跳過原生 disabled；只有 aria-disabled 的照樣走得到（光碟灰掉的〔背面〕分頁方向鍵還是要翻過去）', () => {
    const t = mount();
    t.radios.paint(0);
    t.els[1]!.setAttribute('aria-disabled', 'true');
    t.els[0]!.focus();
    keydown(t.els[0], 'ArrowRight');
    expect(active()).toBe(t.els[1]);
    expect(t.picks).toEqual([1]);
    t.radios.paint(1);
    t.els[2]!.disabled = true;
    keydown(t.els[1], 'ArrowRight');
    expect(active()).toBe(t.els[3]);
    expect(t.picks).toEqual([1, 3]);
  });

  it('給了 skip：被 skip 的選項方向鍵跳過、不送；沒被 skip 的照走（一步一個、到頭停住）', () => {
    const t = mount((i) => i === 1);
    t.radios.paint(0);
    t.els[0]!.focus();
    keydown(t.els[0], 'ArrowRight');
    expect(active()).toBe(t.els[2]);
    expect(t.picks).toEqual([2]);
    t.radios.paint(2);
    keydown(t.els[2], 'ArrowLeft');
    expect(active()).toBe(t.els[0]);
    expect(t.picks).toEqual([2, 0]);
    t.radios.paint(0);
    keydown(t.els[0], 'ArrowLeft');
    expect(active()).toBe(t.els[0]);
    expect(t.picks).toEqual([2, 0]);
  });

  it('skip 每次按鍵才問：整組鎖住時焦點不動、不送、仍攔下方向鍵；解除後又能走', () => {
    let locked = true;
    const t = mount(() => locked);
    t.radios.paint(0);
    t.els[0]!.focus();
    for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) expect(keydown(t.els[0], k).defaultPrevented, k).toBe(true);
    expect(active()).toBe(t.els[0]);
    expect(t.picks).toEqual([]);
    locked = false;
    keydown(t.els[0], 'ArrowRight');
    expect(active()).toBe(t.els[1]);
    expect(t.picks).toEqual([1]);
  });

  it('沒有選中的（paint -1）：第一個沒被 disabled、也沒被 skip 的當 Tab 停點', () => {
    const t = mount((i) => i === 0);
    t.els[1]!.disabled = true;
    t.radios.paint(-1);
    expect(t.els.map((b) => b.tabIndex)).toEqual([-1, -1, 0, -1]);
  });
});
