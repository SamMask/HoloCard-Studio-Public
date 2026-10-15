// T-811 局部動態特效的介面（DESIGN「局部動態特效」）：右欄「動態特效」小節（無／火焰／電光／水波單選群組＋顏色＋強度、速度滑桿）、
// 出現條件（底圖、立體層、文字層都有；破框層變淡＋「衝出卡片的層不能加特效」；這一面已經 2 層時第 3 層的選項變淡＋
// 「這一面最多 2 層有特效」）、有特效的層「衝出卡片」開關變淡、改類型／顏色／強度／速度各記一步（滑桿停手才記）、
// 鍵盤可用（方向鍵換類型、跳過變淡的）、說明面板「圖層進階效果」段多一句。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { FX_DEFAULT_COLORS } from '../src/model/fx';
import type { Layer } from '../src/model/types';
import {
  addTextLayerEdit,
  addUploadedLayer,
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
import {
  BREAKOUT_ALT_TEXT,
  BREAKOUT_FX_TEXT,
  breakoutSwitch,
  FX_BREAKOUT_TEXT,
  FX_FULL_TEXT,
  FX_HELP,
  FX_OPTIONS,
  FX_TITLE,
  fxSection,
  HELP_SECTIONS,
} from '../src/ui/logic';
import type { UiIntents, UiState } from '../src/ui/types';
import { createSegmented } from '../src/ui/controls';
import { all, byClass, FakeEvent, installFakeDom, isShown, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';

const input = (id: string, hasAlpha: boolean, image: string): NewLayerInput => ({ id, name: id, image, hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、立體層 hero、立體層 side、文字層 title。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false, '0123456789abcdef'), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true, '0123456789abcde0'), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('side', true, '0123456789abcde1'), 'side.png', T0).state;
  const text = { content: '卡名', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
  s = addTextLayerEdit(s, 'front', { id: 'title', image: 'fedcba9876543210', text, width: 800, height: 200 }, T0).state;
  return s;
}

const layers = (s: EditorState): Layer[] => currentCard(s).front.layers;
const layerOf = (s: EditorState, id: string): Layer => layers(s).find((l) => l.id === id)!;
const indexOf = (s: EditorState, id: string): number => layers(s).findIndex((l) => l.id === id);

describe('文字（DESIGN 的字）', () => {
  it('小節名、四個選項、變淡的說明', () => {
    expect(FX_TITLE).toBe('動態特效');
    expect(FX_OPTIONS.map((o) => o.label)).toEqual(['無', '火焰', '電光', '水波']);
    expect(FX_OPTIONS.map((o) => o.value)).toEqual([null, 'fire', 'electric', 'water']);
    expect(FX_BREAKOUT_TEXT).toBe('衝出卡片的層不能加特效');
    expect(FX_FULL_TEXT).toBe('這一面最多 2 層有特效');
    expect(FX_HELP.length).toBeGreaterThan(0);
  });

  it('說明面板「圖層進階效果」段多一句', () => {
    const lines = HELP_SECTIONS.find((s) => s.title === '圖層進階效果')!.lines;
    expect(lines).toContain('選一層打開「動態特效」，可以讓火焰、電光、水波在它的形狀裡流動。');
  });
});

describe('logic：小節狀態、衝出卡片開關', () => {
  it('fxSection：底圖、立體層、文字層都能加；目前的種類照設定', () => {
    const s = setup();
    for (const id of ['bg', 'hero', 'title']) expect(fxSection(layers(s), indexOf(s, id))).toEqual({ kind: null, locked: false, full: false, title: '' });
    const on = editLayer(s, 'hero', { fx: { kind: 'water' } }, 'commit', T1);
    expect(fxSection(layers(on), indexOf(on, 'hero')).kind).toBe('water');
  });

  it('破框層：locked＋說明；這一面已經 2 層：沒有特效的層 full＋說明，有特效的那 2 層照樣能改', () => {
    let s = setup();
    const bo = editLayer(s, 'hero', { breakout: true }, 'commit', T1);
    expect(fxSection(layers(bo), indexOf(bo, 'hero'))).toEqual({ kind: null, locked: true, full: false, title: FX_BREAKOUT_TEXT });
    s = editLayer(s, 'hero', { fx: { kind: 'fire' } }, 'commit', T1);
    s = editLayer(s, 'title', { fx: { kind: 'electric' } }, 'commit', T1);
    expect(fxSection(layers(s), indexOf(s, 'side'))).toEqual({ kind: null, locked: false, full: true, title: FX_FULL_TEXT });
    expect(fxSection(layers(s), indexOf(s, 'bg')).full).toBe(true);
    expect(fxSection(layers(s), indexOf(s, 'hero'))).toEqual({ kind: 'fire', locked: false, full: false, title: '' });
  });

  it('breakoutSwitch：有特效、還沒衝出卡片 → 變淡、滑過說明；變身圖的說明優先', () => {
    const hero = layerOf(setup(), 'hero');
    const fx = { kind: 'fire', color: '#ff6a1f', strength: 70, speed: 50 } as const;
    expect(breakoutSwitch({ ...hero, fx })).toEqual({ on: false, locked: true, title: BREAKOUT_FX_TEXT });
    expect(breakoutSwitch({ ...hero, fx, alt: { image: 'aaaaaaaaaaaaaaa1', hasAlpha: true } }).title).toBe(BREAKOUT_ALT_TEXT);
    expect(breakoutSwitch(hero)).toEqual({ on: false, locked: false, title: '' });
  });
});

describe('editor：每個改動記一步', () => {
  it('選種類一步、改顏色一步、拖強度（拖動中 preview、放開 commit）一步；復原一步一步回去', () => {
    let s = selectLayer(setup(), 'hero');
    s = editLayer(s, 'hero', { fx: { kind: 'fire' } }, 'commit', T1);
    s = editLayer(s, 'hero', { fx: { color: '#00ff88' } }, 'commit', T1);
    for (const v of [40, 30, 20]) s = editLayer(s, 'hero', { fx: { strength: v } }, 'preview', T1);
    s = editLayer(s, 'hero', { fx: { strength: 20 } }, 'commit', T1);
    for (const v of [60, 80]) s = editLayer(s, 'hero', { fx: { speed: v } }, 'preview', T1);
    s = editLayer(s, 'hero', { fx: { speed: 80 } }, 'commit', T1);
    expect(layerOf(s, 'hero').fx).toEqual({ kind: 'fire', color: '#00ff88', strength: 20, speed: 80 });
    s = undoEdit(s);
    expect(layerOf(s, 'hero').fx?.speed).toBe(50);
    s = undoEdit(s);
    expect(layerOf(s, 'hero').fx?.strength).toBe(70);
    s = undoEdit(s);
    expect(layerOf(s, 'hero').fx?.color).toBe(FX_DEFAULT_COLORS.fire);
    s = undoEdit(s);
    expect(layerOf(s, 'hero').fx).toBeUndefined();
    s = redoEdit(s);
    expect(layerOf(s, 'hero').fx?.kind).toBe('fire');
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

let dom: FakeDom;
const active = () => dom.document.activeElement;

beforeEach(() => {
  dom = installFakeDom();
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
  const block = () => byClass(root, 'fx-block');
  const options = () => all(block(), 'fx-opt');
  const detail = () => byClass(block(), 'fx-detail');
  return { root, calls, render, block, options, detail };
}

describe('右欄「動態特效」小節', () => {
  it('底圖、立體層、文字層都有；四個選項是原生按鈕（role=radio），沒有特效時選「無」、顏色與滑桿藏起來', () => {
    const t = mount();
    for (const id of ['bg', 'hero', 'title']) {
      t.render(selectLayer(setup(), id));
      expect(isShown(t.block())).toBe(true);
      expect(t.block().textContent).toContain(FX_TITLE);
      const opts = t.options();
      expect(opts.map((o) => o.textContent)).toEqual(['無', '火焰', '電光', '水波']);
      for (const o of opts) {
        expect(o.tagName).toBe('BUTTON');
        expect(o.getAttribute('role')).toBe('radio');
      }
      expect(opts[0]!.getAttribute('aria-checked')).toBe('true');
      expect(isShown(t.detail())).toBe(false);
    }
  });

  it('點火焰 → editLayer(這層, { fx: { kind: fire } }, commit)；點「無」→ { fx: null }', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'hero'));
    t.options()[1]!.click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { fx: { kind: 'fire' } }, 'commit'] }]);
    t.calls.length = 0;
    const s = editLayer(selectLayer(setup(), 'hero'), 'hero', { fx: { kind: 'fire' } }, 'commit', T1);
    t.render(s);
    expect(t.options()[1]!.getAttribute('aria-checked')).toBe('true');
    t.options()[0]!.click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { fx: null }, 'commit'] }]);
  });

  it('有特效：顏色色票與強度、速度滑桿出現；拖滑桿送 preview、放開送 commit；點色票 commit', () => {
    const t = mount();
    t.render(editLayer(selectLayer(setup(), 'hero'), 'hero', { fx: { kind: 'water' } }, 'commit', T1));
    expect(isShown(t.detail())).toBe(true);
    const sliders = all(t.detail(), 'slider');
    expect(sliders).toHaveLength(2);
    const [strength, speed] = sliders as [FakeElement, FakeElement];
    expect(strength.getAttribute('aria-label')).toBe('強度');
    expect(speed.getAttribute('aria-label')).toBe('速度');
    expect((strength as unknown as HTMLInputElement).value).toBe('70');
    (strength as unknown as HTMLInputElement).value = '35';
    strength.dispatchEvent(new FakeEvent('input'));
    strength.dispatchEvent(new FakeEvent('change'));
    (speed as unknown as HTMLInputElement).value = '90';
    speed.dispatchEvent(new FakeEvent('input'));
    speed.dispatchEvent(new FakeEvent('change'));
    expect(t.calls).toEqual([
      { name: 'editLayer', args: ['hero', { fx: { strength: 35 } }, 'preview'] },
      { name: 'editLayer', args: ['hero', { fx: { strength: 35 } }, 'commit'] },
      { name: 'editLayer', args: ['hero', { fx: { speed: 90 } }, 'preview'] },
      { name: 'editLayer', args: ['hero', { fx: { speed: 90 } }, 'commit'] },
    ]);
    t.calls.length = 0;
    const swatch = all(t.detail(), 'swatch')[0]!;
    swatch.click();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.name).toBe('editLayer');
    expect(t.calls[0]!.args[0]).toBe('hero');
    expect(t.calls[0]!.args[2]).toBe('commit');
    expect(Object.keys((t.calls[0]!.args[1] as { fx: object }).fx)).toEqual(['color']);
  });

  it('破框層：小節變淡（is-locked）、選項 aria-disabled、滑過說明；按了不改', () => {
    const t = mount();
    t.render(editLayer(selectLayer(setup(), 'hero'), 'hero', { breakout: true }, 'commit', T1));
    expect(t.block().classList.contains('is-locked')).toBe(true);
    expect(t.block().title).toBe(FX_BREAKOUT_TEXT);
    for (const o of t.options()) expect(o.getAttribute('aria-disabled')).toBe('true');
    t.options()[1]!.click();
    expect(t.calls).toEqual([]);
  });

  it('這一面已經 2 層有特效：第 3 層的火焰／電光／水波變淡（disabled）、說明「這一面最多 2 層有特效」；「無」照樣選著', () => {
    const t = mount();
    let s = setup();
    s = editLayer(s, 'hero', { fx: { kind: 'fire' } }, 'commit', T1);
    s = editLayer(s, 'title', { fx: { kind: 'electric' } }, 'commit', T1);
    t.render(selectLayer(s, 'side'));
    const [none, ...kinds] = t.options();
    expect((none as unknown as HTMLButtonElement).disabled).toBe(false);
    expect(none!.getAttribute('aria-checked')).toBe('true');
    for (const k of kinds) expect((k as unknown as HTMLButtonElement).disabled).toBe(true);
    expect(t.block().title).toBe(FX_FULL_TEXT);
    const note = byClass(t.block(), 'fx-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(FX_FULL_TEXT);
    // 有特效的那層照樣能換
    t.render(selectLayer(s, 'hero'));
    for (const o of t.options()) expect((o as unknown as HTMLButtonElement).disabled).toBe(false);
    expect(isShown(byClass(t.block(), 'fx-note'))).toBe(false);
  });

  it('鍵盤：方向鍵換種類（一按一步）；只有選中的那顆在 Tab 順序裡', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'hero'));
    const opts = t.options();
    expect(opts.map((o) => (o as unknown as HTMLButtonElement).tabIndex)).toEqual([0, -1, -1, -1]);
    (opts[0] as unknown as HTMLButtonElement).focus();
    const list = byClass(t.block(), 'fx-list');
    list.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowRight' }));
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { fx: { kind: 'fire' } }, 'commit'] }]);
    expect(active()).toBe(opts[1]);
  });

  it('鍵盤：破框層整個小節鎖住 → 選「無」按 → ↓ 焦點不動、不送（不會走到變淡的火焰）；← ↑ 一樣', () => {
    const t = mount();
    t.render(editLayer(selectLayer(setup(), 'hero'), 'hero', { breakout: true }, 'commit', T1));
    const opts = t.options();
    opts[0]!.focus();
    expect(active()).toBe(opts[0]);
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      const e = keydown(opts[0], key);
      expect(e.defaultPrevented).toBe(true);
      expect(active()).toBe(opts[0]);
    }
    expect(t.calls).toEqual([]);
    // 選中的那顆還是 Tab 順序裡唯一的停點
    expect(opts.map((o) => o.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('鍵盤：這一面滿 2 層 → 第 3 層選「無」按 → 焦點不動、不送（變淡的三個跳過）', () => {
    const t = mount();
    let s = setup();
    s = editLayer(s, 'hero', { fx: { kind: 'fire' } }, 'commit', T1);
    s = editLayer(s, 'title', { fx: { kind: 'electric' } }, 'commit', T1);
    t.render(selectLayer(s, 'side'));
    const opts = t.options();
    opts[0]!.focus();
    keydown(opts[0], 'ArrowRight');
    keydown(opts[0], 'ArrowDown');
    expect(active()).toBe(opts[0]);
    expect(t.calls).toEqual([]);
  });

  it('鍵盤：沒鎖住時照樣能走完全部選項，鎖住解除（關掉衝出卡片、復原）後方向鍵又能換', () => {
    const t = mount();
    let s = editLayer(selectLayer(setup(), 'hero'), 'hero', { breakout: true }, 'commit', T1);
    t.render(s);
    t.options()[0]!.focus();
    keydown(t.options()[0], 'ArrowRight');
    expect(t.calls).toEqual([]);
    s = undoEdit(s);
    t.render(s);
    expect(t.options().some((o) => o.getAttribute('aria-disabled') !== null)).toBe(false);
    t.options()[0]!.focus();
    keydown(t.options()[0], 'ArrowRight');
    expect(active()).toBe(t.options()[1]);
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { fx: { kind: 'fire' } }, 'commit'] }]);
  });

  it('換卡、換面、復原：小節的鎖與變淡跟著目前這層（不留上一張的狀態）', () => {
    const t = mount();
    const disabled = () => t.options().map((o) => (o as unknown as HTMLButtonElement).disabled);
    const aria = () => t.options().map((o) => o.getAttribute('aria-disabled'));
    // 正面滿 2 層；背面放一層沒有特效
    let s = setup();
    s = addUploadedLayer(s, 'back', input('back1', true, '0123456789abcde2'), 'back1.png', T0).state;
    s = editLayer(s, 'hero', { fx: { kind: 'fire' } }, 'commit', T1);
    s = editLayer(s, 'title', { fx: { kind: 'electric' } }, 'commit', T1);
    // 正面第 3 層：滿了
    t.render(selectLayer(s, 'side'));
    expect(disabled()).toEqual([false, true, true, true]);
    expect(t.block().title).toBe(FX_FULL_TEXT);
    expect(aria()).toEqual([null, null, null, null]);
    // 換到背面的層（每一面各自算）：沒滿
    const onBack = selectLayer(s, 'back1');
    expect(onBack.face).toBe('back');
    t.render(onBack);
    expect(disabled()).toEqual([false, false, false, false]);
    expect(t.block().title).toBe('');
    expect(isShown(byClass(t.block(), 'fx-note'))).toBe(false);
    // 換回去又滿；復原最後一步（title 的電光）→ 不滿了
    t.render(selectLayer(s, 'side'));
    expect(disabled()).toEqual([false, true, true, true]);
    const undone = selectLayer(undoEdit(s), 'side');
    t.render(undone);
    expect(disabled()).toEqual([false, false, false, false]);
    expect(isShown(byClass(t.block(), 'fx-note'))).toBe(false);
    // 換一張全新的卡（沒有特效）
    t.render(selectLayer(setup(), 'side'));
    expect(disabled()).toEqual([false, false, false, false]);
    // 破框：鎖住（aria-disabled、說明）；復原 → 解鎖；重做 → 又鎖；換卡 → 解鎖
    const bo = editLayer(selectLayer(setup(), 'hero'), 'hero', { breakout: true }, 'commit', T1);
    t.render(bo);
    expect(aria()).toEqual(['true', 'true', 'true', 'true']);
    expect(t.block().classList.contains('is-locked')).toBe(true);
    expect(t.block().title).toBe(FX_BREAKOUT_TEXT);
    expect(byClass(t.block(), 'fx-note').textContent).toBe(FX_BREAKOUT_TEXT);
    const back = undoEdit(bo);
    t.render(back);
    expect(aria()).toEqual([null, null, null, null]);
    expect(t.block().classList.contains('is-locked')).toBe(false);
    expect(t.block().title).toBe('');
    t.render(redoEdit(back));
    expect(aria()).toEqual(['true', 'true', 'true', 'true']);
    expect(t.block().classList.contains('is-locked')).toBe(true);
    t.render(selectLayer(setup(), 'hero'));
    expect(aria()).toEqual([null, null, null, null]);
    expect(t.block().classList.contains('is-locked')).toBe(false);
  });

  it('破框層鎖住時：點火焰／電光／水波都不送；復原後點得動', () => {
    const t = mount();
    const bo = editLayer(selectLayer(setup(), 'hero'), 'hero', { breakout: true }, 'commit', T1);
    t.render(bo);
    for (const o of t.options()) o.click();
    expect(t.calls).toEqual([]);
    t.render(undoEdit(bo));
    t.options()[2]!.click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { fx: { kind: 'electric' } }, 'commit'] }]);
  });

  it('有特效的層：「衝出卡片」開關變淡、滑過說明、按了不改', () => {
    const t = mount();
    t.render(editLayer(selectLayer(setup(), 'hero'), 'hero', { fx: { kind: 'fire' } }, 'commit', T1));
    const block = byClass(t.root, 'breakout-block');
    expect(block.classList.contains('is-locked')).toBe(true);
    expect(block.title).toBe(BREAKOUT_FX_TEXT);
    byClass(block, 'switch').click();
    expect(t.calls).toEqual([]);
  });
});
