// T-703b 加做（T-607c 審查留下的小尾巴）：比較早的鍵盤處理也只收「單按」的鍵（ui/logic 的 plainKey）——
// Ctrl／Cmd／Alt 組合（Ctrl+→ 跳字、Ctrl+空白鍵切輸入法…）與輸入法選字中的按鍵不換選項、不記步、不攔。
// 涵蓋：右欄卡框樣式（T-416b）、GIF 大小、影片格式與長度、動作（motion-picker）、左欄反光層那一列；
// 另外 grep 到左欄圖層名字輸入框的 Enter 沒看輸入法（選字按 Enter 會直接離開輸入框）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { addUploadedLayer, createEditor, selectLayer, toUiState } from '../src/ui/editor';
import { createGifOptions } from '../src/ui/gif-options';
import { createInspector } from '../src/ui/inspector';
import { createLayerPanel } from '../src/ui/layer-list';
import { createMotionPicker, defaultMotion } from '../src/ui/motion-picker';
import type { UiIntents } from '../src/ui/types';
import { createVideoOptions } from '../src/ui/video-options';
import { all, byClass, flush, installFakeDom, keydown, type FakeDom, type FakeElement, type FakeEventInit } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';

/** 不該被當成「單按」的幾種：三種組合鍵＋輸入法選字中。 */
const NOT_PLAIN: FakeEventInit[] = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }];

let dom: FakeDom;

beforeEach(() => {
  dom = installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/0');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const selected = (buttons: FakeElement[]) => buttons.findIndex((b) => b.classList.contains('is-selected'));

describe('右欄卡框樣式（T-416b）', () => {
  it('Ctrl／Cmd／Alt＋→、輸入法選字中的 →：不換樣式、不記步（不送 editCard）、不攔', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    inspector.render(toUiState(createEditor(newCard('standard', 'c1', T0)), () => undefined));
    const group = all(inspector.el, 'frame-styles').find((g) => g.getAttribute('aria-label') === '卡框樣式')!;
    const [simple] = group.querySelectorAll('button');
    simple!.focus();
    for (const init of NOT_PLAIN) {
      for (const key of ['ArrowRight', 'ArrowDown']) expect(keydown(simple, key, init).defaultPrevented, `${key} ${JSON.stringify(init)}`).toBe(false);
    }
    expect(dom.document.activeElement).toBe(simple);
    expect(calls.filter((c) => c.name === 'editCard')).toEqual([]);
    // 單按照舊會換
    expect(keydown(simple, 'ArrowRight').defaultPrevented).toBe(true);
    expect(calls.filter((c) => c.name === 'editCard')).toHaveLength(1);
  });
});

describe('GIF 選項：大小', () => {
  it('組合鍵、輸入法選字中：不換大小、不攔', async () => {
    const box = createGifOptions({ estimateGif: async () => null });
    box.el.hidden = false;
    const asked = box.ask();
    await flush();
    const buttons = all(box.el, 'go-size');
    const before = selected(buttons);
    buttons[before]!.focus();
    for (const init of NOT_PLAIN) expect(keydown(buttons[before], 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    expect(selected(all(box.el, 'go-size'))).toBe(before);
    expect(dom.document.activeElement).toBe(buttons[before]);
    keydown(buttons[before], 'ArrowRight');
    expect(selected(all(box.el, 'go-size'))).toBe(before + 1);
    box.cancel();
    await asked;
  });
});

describe('影片選項：格式與長度', () => {
  async function open() {
    const box = createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 30 }), canMakeMp4: async () => true });
    box.el.hidden = false;
    const asked = box.ask();
    await flush();
    return { box, asked };
  }

  it('格式：組合鍵、輸入法選字中不換、不攔', async () => {
    const { box, asked } = await open();
    const buttons = all(box.el, 'vo-fmt');
    const before = selected(buttons);
    for (const init of NOT_PLAIN) expect(keydown(buttons[before], 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    expect(selected(all(box.el, 'vo-fmt'))).toBe(before);
    keydown(buttons[before], 'ArrowRight');
    expect(selected(all(box.el, 'vo-fmt'))).not.toBe(before);
    box.cancel();
    await asked;
  });

  it('長度：組合鍵、輸入法選字中不換、不攔', async () => {
    const { box, asked } = await open();
    const buttons = all(box.el, 'vo-len');
    const before = selected(buttons);
    for (const init of NOT_PLAIN) expect(keydown(buttons[before], 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    expect(selected(all(box.el, 'vo-len'))).toBe(before);
    keydown(buttons[before], 'ArrowRight');
    expect(selected(all(box.el, 'vo-len'))).toBe(before + 1);
    box.cancel();
    await asked;
  });
});

describe('動作（轉一圈／左右擺動）', () => {
  it('組合鍵、輸入法選字中：不換動作、不通知、不攔', () => {
    const changes: string[] = [];
    const choice = defaultMotion();
    const picker = createMotionPicker(choice, (what) => changes.push(what), 'kb');
    picker.render();
    const buttons = all(picker.el, 'mo-btn');
    for (const init of NOT_PLAIN) expect(keydown(buttons[0], 'ArrowRight', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    expect(choice.motion).toBe('turn');
    expect(changes).toEqual([]);
    keydown(buttons[0], 'ArrowRight');
    expect(choice.motion).toBe('swing');
    expect(changes).toEqual(['motion']);
  });
});

describe('左欄', () => {
  const input = (id: string, hasAlpha = true): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 });

  function panel() {
    const { intents, calls } = recorder();
    let s = createEditor(newCard('standard', 'card-1', T0));
    s = addUploadedLayer(s, 'front', input('hero'), 'hero.png', T0).state;
    s = selectLayer(s, null);
    const p = createLayerPanel(intents);
    p.render(toUiState(s, () => undefined));
    return { root: p.el as unknown as FakeElement, calls };
  }

  it('反光層那一列：Ctrl／Cmd／Alt＋Enter／空白鍵、輸入法選字中不選反光層、不攔', () => {
    const { root, calls } = panel();
    const foilRow = byClass(root, 'foil-row');
    foilRow.focus();
    for (const init of NOT_PLAIN) {
      for (const key of ['Enter', ' ']) expect(keydown(foilRow, key, init).defaultPrevented, `${JSON.stringify(key)} ${JSON.stringify(init)}`).toBe(false);
    }
    expect(calls).toEqual([]);
    keydown(foilRow, 'Enter');
    expect(calls).toEqual([{ name: 'selectFoil', args: [] }]);
  });

  it('圖層名字輸入框：輸入法選字中按 Enter（確定選字）不離開輸入框；選完再按 Enter 才離開', () => {
    const { root } = panel();
    const name = byClass(all(root, 'layer-row')[0]!, 'layer-name');
    name.focus();
    keydown(name, 'Enter', { isComposing: true });
    expect(dom.document.activeElement).toBe(name);
    keydown(name, 'Escape', { isComposing: true });
    expect(dom.document.activeElement).toBe(name);
    keydown(name, 'Enter');
    expect(dom.document.activeElement).not.toBe(name);
  });
});
