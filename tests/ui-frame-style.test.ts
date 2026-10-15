// 右欄卡框「樣式」（T-416，DESIGN「卡框樣式」）：〔簡約〕〔雕花邊角〕二選一、各有小縮圖；在卡框小節裡（卡框關著時跟著變淡）；
// 一按就 commit（順便打開卡框，同粗細／顏色／光澤），一步、可以復原。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';
import { createEditor, currentCard, editCard, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const ui = (s: EditorState): UiState => toUiState(s, (h) => `blob:${h}`);

beforeEach(() => {
  installFakeDom();
  // 色彩選擇器在 document 上聽點外面收起（極簡 DOM 沒有，這裡補空的）
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function styleGroup(root: FakeElement): FakeElement {
  const group = all(root, 'frame-styles').find((g) => g.getAttribute('aria-label') === '卡框樣式');
  if (!group) throw new Error('找不到卡框樣式');
  return group;
}
const styleButtons = (root: FakeElement) => styleGroup(root).querySelectorAll('button');
const checked = (root: FakeElement) => styleButtons(root).map((b) => b.getAttribute('aria-checked'));

function setup(card = newCard('standard', 'c1', T0)) {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const s = createEditor(card);
  inspector.render(ui(s));
  return { inspector, root: inspector.el as unknown as FakeElement, calls, s };
}

describe('右欄卡框「樣式」（T-416）', () => {
  it('兩個選項〔簡約〕〔雕花邊角〕；新卡（沒有 style）是簡約', () => {
    const { root } = setup();
    const buttons = styleButtons(root);
    expect(buttons.map((b) => b.textContent)).toEqual(['簡約', '雕花邊角']);
    expect(buttons.map((b) => b.getAttribute('role'))).toEqual(['radio', 'radio']);
    expect(checked(root)).toEqual(['true', 'false']);
    expect(buttons.map((b) => b.classList.contains('is-selected'))).toEqual([true, false]);
  });

  it('每個選項有小縮圖：雕花邊角的縮圖四個角各一個花紋，簡約的沒有', () => {
    const { root } = setup();
    const [simple, ornate] = styleButtons(root);
    const thumb = (b: FakeElement) => byClass(b, 'frame-style-thumb');
    expect(all(thumb(simple!), 'frame-style-corner')).toHaveLength(0);
    expect(all(thumb(ornate!), 'frame-style-corner')).toHaveLength(4);
  });

  it('在卡框小節裡：卡框關著時這組跟著變淡（is-off），打開時恢復', () => {
    const { inspector, root, s } = setup();
    let n: FakeElement | null = styleGroup(root);
    while (n && !n.classList.contains('frame-detail')) n = n.parentNode;
    expect(n).not.toBeNull();
    expect(n!.classList.contains('is-off')).toBe(true);
    inspector.render(ui(editCard(s, { frame: { enabled: true } }, 'commit', T1)));
    expect(n!.classList.contains('is-off')).toBe(false);
  });

  it('點雕花邊角：送 editCard({ frame: { style: "ornate", enabled: true } }, commit)；點簡約送 simple', () => {
    const { root, calls } = setup();
    styleButtons(root)[1]!.click();
    styleButtons(root)[0]!.click();
    expect(calls.filter((c) => c.name === 'editCard').map((c) => c.args)).toEqual([
      [{ frame: { style: 'ornate', enabled: true } }, 'commit'],
      [{ frame: { style: 'simple', enabled: true } }, 'commit'],
    ]);
  });

  it('卡片是雕花邊角時那一顆選中；換回簡約又換回來', () => {
    const { inspector, root, s } = setup();
    const s1 = editCard(s, { frame: { style: 'ornate', enabled: true } }, 'commit', T1);
    inspector.render(ui(s1));
    expect(checked(root)).toEqual(['false', 'true']);
    inspector.render(ui(editCard(s1, { frame: { style: 'simple' } }, 'commit', T1)));
    expect(checked(root)).toEqual(['true', 'false']);
  });

  it('切換算一步，可以復原（回到簡約、卡框也回到關）', () => {
    const s0 = createEditor(newCard('standard', 'c1', T0));
    const s1 = editCard(s0, { frame: { style: 'ornate', enabled: true } }, 'commit', T1);
    expect(currentCard(s1).frame.style).toBe('ornate');
    expect(currentCard(s1).frame.enabled).toBe(true);
    const back = currentCard(undoEdit(s1));
    expect(back.frame.style).toBeUndefined();
    expect(back.frame.enabled).toBe(false);
  });
});

// ---- T-416b：方向鍵切換、單一 Tab 停點；素材讀不到時的說明 ----

/** 對按鈕送一個 keydown（會往上傳到選項群組）。 */
function press(el: FakeElement, key: string): FakeEvent {
  const e = new FakeEvent('keydown', { key });
  el.dispatchEvent(e);
  return e;
}
const focused = () => (document as unknown as { activeElement: FakeElement | null }).activeElement;
const editCalls = (calls: { name: string; args: unknown[] }[]) => calls.filter((c) => c.name === 'editCard').map((c) => c.args);

describe('卡框樣式的鍵盤操作（T-416b，單選的慣例）', () => {
  it('Tab 停點只有一個：選中的那顆 tabIndex 0、另一顆 −1；卡片換樣式後跟著換', () => {
    const { inspector, root, s } = setup();
    expect(styleButtons(root).map((b) => b.tabIndex)).toEqual([0, -1]);
    inspector.render(ui(editCard(s, { frame: { style: 'ornate', enabled: true } }, 'commit', T1)));
    expect(styleButtons(root).map((b) => b.tabIndex)).toEqual([-1, 0]);
  });

  it('→／↓：選下一個、焦點跟過去、送一次 commit（順便打開卡框）；在最後一個再按不動、不再送', () => {
    const { root, calls } = setup();
    const [simple, ornate] = styleButtons(root);
    simple!.focus();
    const e = press(simple!, 'ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(focused()).toBe(ornate);
    expect(editCalls(calls)).toEqual([[{ frame: { style: 'ornate', enabled: true } }, 'commit']]);
    expect(checked(root)).toEqual(['false', 'true']);
    expect(styleButtons(root).map((b) => b.tabIndex)).toEqual([-1, 0]);
    press(ornate!, 'ArrowDown');
    expect(focused()).toBe(ornate);
    expect(editCalls(calls)).toHaveLength(1);
  });

  it('←／↑：回上一個；其他鍵不管', () => {
    const { inspector, root, calls, s } = setup();
    inspector.render(ui(editCard(s, { frame: { style: 'ornate', enabled: true } }, 'commit', T1)));
    const [simple, ornate] = styleButtons(root);
    ornate!.focus();
    expect(press(ornate!, 'Enter').defaultPrevented).toBe(false);
    expect(press(ornate!, 'a').defaultPrevented).toBe(false);
    expect(editCalls(calls)).toHaveLength(0);
    press(ornate!, 'ArrowUp');
    expect(focused()).toBe(simple);
    expect(editCalls(calls)).toEqual([[{ frame: { style: 'simple', enabled: true } }, 'commit']]);
    press(simple!, 'ArrowLeft');
    expect(editCalls(calls)).toHaveLength(1);
  });
});

describe('雕花素材讀不到（T-416b）', () => {
  const note = (root: FakeElement) => all(root, 'frame-style-missing')[0];

  it('素材讀不到：卡框樣式下面說「雕花素材讀不到，先用簡約」', () => {
    const { inspector, root, s } = setup();
    inspector.render({ ...ui(s), frameCornerMissing: true });
    const el = note(root);
    expect(el).toBeDefined();
    expect(isShown(el)).toBe(true);
    expect(el!.textContent).toContain('雕花素材讀不到，先用簡約');
    // 在卡框小節裡
    let n: FakeElement | null = el!;
    while (n && !n.classList.contains('frame-detail')) n = n.parentNode;
    expect(n).not.toBeNull();
  });

  it('讀得到（沒給或 false）：不顯示', () => {
    const { inspector, root, s } = setup();
    expect(isShown(note(root))).toBe(false);
    inspector.render({ ...ui(s), frameCornerMissing: false });
    expect(isShown(note(root))).toBe(false);
  });
});
