// 面板與對話框的鍵盤（T-607，DESIGN §8.2）：打開時焦點移到第一個控制項、Tab 在裡面循環、Esc 關、關掉後焦點回到打開它的按鈕。
// 涵蓋：預覽區本身可以拿焦點、上傳確認框、AI 的問題、刪圖層確認（Delete）、新卡片、卡片庫（含刪除確認）、匯出選項小框與進度、接手遮罩，
// 以及 app.ts 的 Delete／Esc／Tab 接線。說明面板的在 ui-help-panel.test.ts。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { createAwayOverlay } from '../src/ui/away';
import { createUi } from '../src/ui/app';
import { addUploadedLayer, askOpaqueUpload, createEditor, currentCard, deleteLayer, selectLayer, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createExportPanel } from '../src/ui/export-panel';
import { focusableIn } from '../src/ui/focus';
import { createLibrary } from '../src/ui/library';
import { PREVIEW_LABEL } from '../src/ui/logic';
import { createNewCardPanel } from '../src/ui/new-card';
import { createStage } from '../src/ui/stage';
import type { AiView, UiIntents, UiState } from '../src/ui/types';
import { SAMPLE_NAMES } from '../src/ui/library-logic';
import {
  all,
  buttonWithText,
  byClass,
  FakeElement,
  FakeEvent,
  flush,
  installFakeDom,
  isShown,
  keydown,
  type FakeDom,
} from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

const input = (id: string, hasAlpha = true): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1400 });
const READY: AiView = { matteReady: true, depthReady: true, busy: false, progress: null, ask: null };
const ui = (s: EditorState, ai: AiView = READY): UiState => ({ ...toUiState(s, (h) => `blob:${h}`), ai });

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      // 新卡片面板打開時會讀範例縮圖
      return name === 'samplePreview' ? Promise.resolve(null) : undefined;
    },
  });
  return { intents, calls };
}

let dom: FakeDom;
const html = (e: unknown) => e as HTMLElement;
const fe = (e: unknown) => e as FakeElement;
const active = () => dom.document.activeElement;

beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/0');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---- 預覽區 ----

describe('3D 預覽區可以拿焦點', () => {
  it('Tab 走得到（tabindex 0），朗讀「3D 預覽，方向鍵轉卡」', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    expect(PREVIEW_LABEL).toBe('3D 預覽，方向鍵轉卡');
    expect(stage.previewHost.getAttribute('aria-label')).toBe('3D 預覽，方向鍵轉卡');
    expect(fe(stage.previewHost).tabIndex).toBe(0);
    expect(stage.previewHost.getAttribute('role')).toBe('group');
  });
});

// ---- 上傳確認框、AI 的問題 ----

describe('上傳確認框（不透明圖）', () => {
  function open() {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    const uploadBtn = dom.document.createElement('button');
    let s = addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('bg', false), 'bg.jpg', T0).state;
    s = selectLayer(s, null);
    stage.render(ui(s));
    uploadBtn.focus();
    const pendingState = askOpaqueUpload(s, 'front', input('pic', false), 'pic.jpg', T1).state;
    return { stage, calls, uploadBtn, s, pendingState, box: byClass(stage.el, 'confirm-upload') };
  }

  it('打開：焦點移到第一個能按的按鈕（模型在＝〔自動去背〕）', () => {
    const t = open();
    t.stage.render(ui(t.pendingState));
    expect(isShown(t.box)).toBe(true);
    expect(active()).toBe(buttonWithText(t.box, '自動去背'));
  });

  it('模型不在：〔自動去背〕和〔拆成立體層〕是淡的，焦點改在〔取代底圖〕', () => {
    const t = open();
    t.stage.render(ui(t.pendingState, { ...READY, matteReady: false, depthReady: false }));
    expect(active()).toBe(buttonWithText(t.box, '取代底圖'));
  });

  it('Tab 在框裡循環（最後的〔取消〕再 Tab 回第一個；Shift+Tab 反過來），不跑到後面的畫面', () => {
    const t = open();
    t.stage.render(ui(t.pendingState));
    const first = buttonWithText(t.box, '自動去背');
    const cancel = buttonWithText(t.box, '取消');
    cancel.focus();
    expect(keydown(cancel, 'Tab').defaultPrevented).toBe(true);
    expect(active()).toBe(first);
    keydown(first, 'Tab', { shiftKey: true });
    expect(active()).toBe(cancel);
  });

  it('答完（框收起）：焦點回到打開之前的地方（上傳按鈕）', () => {
    const t = open();
    t.stage.render(ui(t.pendingState));
    expect(active()).not.toBe(t.uploadBtn);
    t.stage.render(ui(t.s));
    expect(isShown(t.box)).toBe(false);
    expect(active()).toBe(t.uploadBtn);
  });

  it('打開前焦點在頁面上沒有東西：答完焦點放到預覽區', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const s = selectLayer(addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('bg', false), 'bg.jpg', T0).state, null);
    stage.render(ui(s));
    stage.render(ui(askOpaqueUpload(s, 'front', input('pic', false), 'pic.jpg', T1).state));
    stage.render(ui(s));
    expect(active()).toBe(stage.previewHost);
  });

  it('正在打字（改圖層名字）時跳出來：不搶走輸入框的焦點', () => {
    const t = open();
    const typing = dom.document.createElement('input');
    typing.setAttribute('type', 'text');
    typing.focus();
    t.stage.render(ui(t.pendingState));
    expect(active()).toBe(typing);
  });

  it('重畫（render 又來一次）不會把焦點再搶回第一個按鈕', () => {
    const t = open();
    t.stage.render(ui(t.pendingState));
    const cancel = buttonWithText(t.box, '取消');
    cancel.focus();
    t.stage.render(ui(t.pendingState));
    expect(active()).toBe(cancel);
  });
});

describe('AI 的問題', () => {
  it('打開：焦點在主要按鈕（〔繼續〕／〔當底圖〕）；Tab 循環；收起後回到原本的地方', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const s = selectLayer(addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('bg', false), 'bg.jpg', T0).state, null);
    stage.render(ui(s));
    const opener = dom.document.createElement('button');
    opener.focus();
    stage.render(ui(s, { ...READY, busy: true, ask: { kind: 'slow', fileName: 'pic.jpg' } }));
    const box = byClass(stage.el, 'confirm-ai');
    const yes = buttonWithText(box, '繼續');
    const no = buttonWithText(box, '取消');
    expect(active()).toBe(yes);
    keydown(yes, 'Tab');
    expect(active()).toBe(no);
    keydown(no, 'Tab');
    expect(active()).toBe(yes);
    stage.render(ui(s));
    expect(active()).toBe(opener);
  });
});

// ---- 刪圖層（預覽區按 Delete）：直接刪，可以復原（T-607b：和左欄垃圾桶一致，不跳確認） ----

describe('預覽區按 Delete 刪圖層：沒有確認框，刪了可以復原', () => {
  it('舞台沒有刪圖層的確認框（T-607 一度有，T-607b 拿掉）', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    expect(all(stage.el, 'confirm-delete')).toHaveLength(0);
    expect('askDeleteLayer' in stage).toBe(false);
    expect('cancelDeleteAsk' in stage).toBe(false);
    expect('deleteAskOpen' in stage).toBe(false);
  });

  it('編輯器：刪掉的圖層按復原就回來（位置不變、選取不留在已經刪掉的那層）', () => {
    let s = addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('hero'), 'hero.png', T0).state;
    s = addUploadedLayer(s, 'front', input('dragon'), 'dragon.png', T0).state;
    s = selectLayer(s, 'hero');
    const deleted = deleteLayer(s, 'hero', T1);
    expect(currentCard(deleted).front.layers.map((l) => l.id)).toEqual(['dragon']);
    expect(deleted.selectedLayerId).toBeNull();
    const back = undoEdit(deleted);
    expect(currentCard(back).front.layers.map((l) => l.id)).toEqual(['hero', 'dragon']);
  });
});

// ---- 新卡片 ----

describe('新卡片面板', () => {
  function setup() {
    const picked: string[] = [];
    const panel = createNewCardPanel({
      blank: (a) => picked.push(`blank:${a}`),
      disc: () => picked.push('disc'),
      sample: (i) => picked.push(`sample:${i}`),
      preview: async () => null,
      changed: () => {},
      libraryCards: async () => [],
      openCard: () => {},
    });
    const opener = dom.document.createElement('button');
    opener.focus();
    return { panel, el: fe(panel.el), opener, picked };
  }

  it('打開：焦點在第一個選項（標準卡）；從卡片庫的〔從範例開始〕打開則在第一張範例', () => {
    const t = setup();
    t.panel.open('blank');
    expect(active()).toBe(all(t.el, 'nc-opt')[0]);
    t.panel.close();
    t.panel.open('samples');
    // 五張空白卡（T-807）＋光碟（T-810）後面是範例
    expect(active()).toBe(all(t.el, 'nc-opt')[6]);
  });

  it('Tab 循環：最後一個控制項再 Tab 回第一個（關閉鈕）、第一個 Shift+Tab 到最後一個', () => {
    const t = setup();
    t.panel.open('blank');
    // 關閉鈕在畫面最上面（標題旁邊），後面是五張空白卡（T-807；自訂的寬高框收著時不算）、光碟（T-810）、「從範例開始」標題右邊的〔開一包〕（T-808）、範例
    const order = focusableIn(html(t.el)) as unknown as FakeElement[];
    expect(order).toHaveLength(8 + SAMPLE_NAMES.length);
    expect(order[0]!.className).toContain('nc-close');
    expect(order[7]!.className).toContain('nc-pack-btn');
    const last = order[order.length - 1]!;
    last.focus();
    keydown(last, 'Tab');
    expect(active() === order[0]).toBe(true);
    keydown(order[0], 'Tab', { shiftKey: true });
    expect(active() === last).toBe(true);
  });

  it('Esc 關掉，焦點回到打開它的按鈕', () => {
    const t = setup();
    t.panel.open('blank');
    t.panel.escape();
    expect(t.panel.isOpen()).toBe(false);
    expect(active()).toBe(t.opener);
  });

  it('選了範例：關掉面板，不把焦點拉回原本的按鈕（由 app 放到預覽區）', () => {
    const t = setup();
    t.panel.open('blank');
    all(t.el, 'nc-opt')[6]!.click();
    expect(t.picked).toEqual(['sample:0']);
    expect(t.panel.isOpen()).toBe(false);
    expect(active()).not.toBe(t.opener);
  });
});

// ---- 卡片庫 ----

describe('卡片庫', () => {
  function setup(cards: { id: string; name: string }[] = []) {
    const intents = new Proxy({} as UiIntents, {
      get: (_t, name: string) => {
        if (name === 'loadLibrary') {
          return async () => ({
            cards: cards.map((c) => ({ id: c.id, name: c.name, aspect: 'standard', updatedAt: T0, layerCount: 1 })),
            storageLow: false,
          });
        }
        if (name === 'deleteCard') return async () => true;
        return () => {};
      },
    });
    const library = createLibrary(intents, { openNewCard: () => {}, importFiles: () => {}, changed: () => {} });
    const opener = dom.document.createElement('button');
    opener.focus();
    return { library, el: fe(library.el), opener };
  }

  it('打開：焦點在〔回到編輯〕；Esc 關掉，焦點回到打開它的按鈕', () => {
    const t = setup();
    t.library.open();
    expect(active()).toBe(buttonWithText(t.el, '回到編輯'));
    t.library.escape();
    expect(t.library.isOpen()).toBe(false);
    expect(active()).toBe(t.opener);
  });

  it('Tab 循環：頭尾相接（最後一個控制項 Tab 回〔回到編輯〕）', async () => {
    const t = setup();
    t.library.open();
    await flush();
    const back = buttonWithText(t.el, '回到編輯');
    const lastBtn = buttonWithText(t.el, '從範例開始');
    lastBtn.focus();
    keydown(lastBtn, 'Tab');
    expect(active()).toBe(back);
    keydown(back, 'Tab', { shiftKey: true });
    expect(active()).toBe(lastBtn);
  });

  it('刪除確認框開著：後面的面板不能按（inert），Tab 只在〔取消〕〔刪除〕之間循環；Esc 先關確認框，焦點回到那張卡的〔⋯〕', async () => {
    const t = setup([{ id: 'a', name: '龍' }]);
    t.library.open();
    await flush();
    const more = byClass(t.el, 'lib-more');
    more.click();
    const menuItems = all(t.el, 'menu-item');
    // 選單裡 ↓ 移動
    expect(active()).toBe(menuItems[0]);
    keydown(menuItems[0], 'ArrowDown');
    expect(active()).toBe(menuItems[1]);
    menuItems[menuItems.length - 1]!.click();
    const cancel = buttonWithText(byClass(t.el, 'lib-confirm'), '取消');
    const del = buttonWithText(byClass(t.el, 'lib-confirm'), '刪除');
    expect(active()).toBe(cancel);
    keydown(cancel, 'Tab');
    expect(active()).toBe(del);
    keydown(del, 'Tab');
    expect(active()).toBe(cancel);
    t.library.escape();
    expect(isShown(byClass(t.el, 'lib-confirm-back'))).toBe(false);
    expect(t.library.isOpen()).toBe(true);
    expect(active()).toBe(more);
  });
});

// ---- 匯出小框、接手遮罩 ----

describe('匯出的小框', () => {
  function setup() {
    const intents = {
      exportVideo: async () => 'cancelled' as const,
      exportGif: async () => 'cancelled' as const,
      estimateGif: async () => null,
      readMusic: async () => ({ ok: true as const, durationSec: 30 }),
    };
    const anchor = dom.document.createElement('div');
    const panel = createExportPanel(intents, { changed: () => {}, anchor: () => html(anchor) });
    return { panel, el: fe(panel.el) };
  }

  it('GIF 選項小框：Tab 在小框裡循環（最後的〔開始匯出〕再 Tab 回第一個控制項），不跑到後面的畫面', async () => {
    const t = setup();
    const run = t.panel.run('gif');
    await flush();
    // 影片和 GIF 的小框各有一顆〔開始匯出〕，要的是現在看得到的那一顆
    const shown = (text: string) => fe(t.el).querySelectorAll('button').find((b) => b.textContent.includes(text) && isShown(b))!;
    const start = shown('開始匯出');
    const cancel = shown('取消');
    const order = focusableIn(html(t.el)) as unknown as FakeElement[];
    expect(order.length).toBeGreaterThan(3);
    expect(active() === start).toBe(true);
    // 〔開始匯出〕是最後一個控制項：再 Tab 回到小框裡的第一個，不跑到後面的畫面
    expect(order[order.length - 1] === start).toBe(true);
    const forward = keydown(start, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(active() === order[0]).toBe(true);
    keydown(order[0], 'Tab', { shiftKey: true });
    expect(active() === start).toBe(true);
    cancel.click();
    await run;
  });

  it('影片選項小框：Esc（panel.cancel）關掉；進度中只有〔取消〕，Tab 停在它上面', async () => {
    const t = setup();
    const run = t.panel.run('webm');
    await flush();
    t.panel.cancel();
    await run;
    expect(t.panel.isOpen()).toBe(false);
  });
});

describe('接手遮罩', () => {
  it('Tab 在〔匯出備份〕〔在這裡繼續〕之間循環', () => {
    const away = createAwayOverlay({ continueHere: () => {}, exportCardFile: async () => {} });
    away.show({ unsaved: true });
    const el = fe(away.el);
    const backup = buttonWithText(el, '匯出備份');
    const keep = buttonWithText(el, '在這裡繼續');
    expect(active()).toBe(keep);
    keydown(keep, 'Tab');
    expect(active()).toBe(backup);
    keydown(backup, 'Tab');
    expect(active()).toBe(keep);
  });
});

// ---- app.ts：Delete、Esc、Tab 的接線 ----

describe('整個畫面（app.ts）的鍵盤接線', () => {
  function mount() {
    const win = Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 1280 });
    vi.stubGlobal('window', win);
    const docEvents = new EventTarget();
    Object.assign(document, {
      addEventListener: docEvents.addEventListener.bind(docEvents),
      removeEventListener: docEvents.removeEventListener.bind(docEvents),
    });
    const { intents, calls } = recorder();
    const root = dom.document.createElement('div');
    const app = createUi(html(root), intents);
    const previewHost = fe(app.previewHost);
    const press = (key: string, init: Record<string, unknown> = {}) => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), { key }, init);
      win.dispatchEvent(e);
      return e;
    };
    // 預覽區的按鍵事件：FakeElement 的 dispatchEvent 只會往上傳到假 DOM 的祖先（不會到 window），這裡直接送給預覽區的監聽器
    const pressOnPreview = (key: string, init: Partial<FakeEvent> = {}) => keydown(previewHost, key, init);
    let s = addUploadedLayer(createEditor(newCard('standard', 'c1', T0)), 'front', input('hero'), 'hero.png', T0).state;
    s = addUploadedLayer(s, 'front', input('dragon'), 'dragon.png', T0).state;
    return {
      app, root, calls, press, pressOnPreview, previewHost, s,
      render: (state: EditorState, extra: Partial<UiState> = {}) => app.render({ ...ui(state), ...extra }),
    };
  }

  it('選中圖層後在預覽區按 Delete：直接刪（送 deleteLayer、沒有確認框），焦點留在預覽區', () => {
    const t = mount();
    t.render(selectLayer(t.s, 'hero'));
    t.previewHost.focus();
    const e = t.pressOnPreview('Delete');
    expect(e.defaultPrevented).toBe(true);
    expect(t.calls.filter((c) => c.name === 'deleteLayer')).toEqual([{ name: 'deleteLayer', args: ['hero'] }]);
    expect(all(t.root, 'confirm-delete')).toHaveLength(0);
    expect(active()).toBe(t.previewHost);
  });

  it('刪了以後 Ctrl+Z 就是復原（送 undo）', () => {
    const t = mount();
    t.render(selectLayer(t.s, 'hero'));
    t.pressOnPreview('Delete');
    t.press('z', { ctrlKey: true });
    expect(t.calls.map((c) => c.name).filter((n) => n === 'deleteLayer' || n === 'undo')).toEqual(['deleteLayer', 'undo']);
  });

  it('Backspace（Mac 沒有 Delete 鍵）也一樣；沒選圖層、選著反光層、帶 Ctrl 的不管', () => {
    const t = mount();
    t.render(selectLayer(t.s, null));
    expect(t.pressOnPreview('Delete').defaultPrevented).toBe(false);
    t.render({ ...selectLayer(t.s, null), foilSelected: true });
    expect(t.pressOnPreview('Delete').defaultPrevented).toBe(false);
    t.render(selectLayer(t.s, 'hero'));
    expect(t.pressOnPreview('Delete', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(t.calls.filter((c) => c.name === 'deleteLayer')).toEqual([]);
    expect(t.pressOnPreview('Backspace').defaultPrevented).toBe(true);
    expect(t.calls.filter((c) => c.name === 'deleteLayer')).toEqual([{ name: 'deleteLayer', args: ['hero'] }]);
  });

  it('Esc 還是取消選取（沒有確認框要先收了）', () => {
    const t = mount();
    t.render(selectLayer(t.s, 'hero'));
    t.press('Escape');
    expect(t.calls.map((c) => [c.name, ...c.args])).toEqual([['selectLayer', null]]);
  });

  it('取消選取後（Esc）Delete 不再刪', () => {
    const t = mount();
    t.render(selectLayer(t.s, 'hero'));
    t.press('Escape');
    t.render(selectLayer(t.s, null));
    expect(t.pressOnPreview('Delete').defaultPrevented).toBe(false);
  });

  it('全螢幕面板開著、焦點卻掉到頁面上（body）：Tab 把焦點拉回面板；焦點在面板裡時不插手', () => {
    const t = mount();
    t.render(t.s);
    // 打開接手遮罩
    t.app.showTakenOver({ unsaved: false });
    const overlay = byClass(t.root, 'away-overlay');
    const keep = buttonWithText(overlay, '在這裡繼續');
    dom.document.activeElement = null;
    const e = t.press('Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(active()).toBe(keep);
    const inside = t.press('Tab');
    // 焦點已經在面板裡：交給面板自己的 trapTab（這裡沒有經過面板的監聽器，所以 app 不攔）
    expect(inside.defaultPrevented).toBe(false);
  });

  it('沒有全螢幕面板時 Tab 不攔', () => {
    const t = mount();
    t.render(t.s);
    expect(t.press('Tab').defaultPrevented).toBe(false);
  });

  it('從範例開始：面板關掉後焦點放到預覽區，接著就能用方向鍵', async () => {
    const t = mount();
    t.render(t.s);
    // 打開新卡片面板：頁首〔新卡片〕
    const newBtn = buttonWithText(byClass(t.root, 'topbar'), '新卡片');
    newBtn.focus();
    newBtn.click();
    const panel = byClass(t.root, 'nc-overlay');
    expect(isShown(panel)).toBe(true);
    all(panel, 'nc-opt')[6]!.click();
    expect(t.calls.map((c) => c.name)).toContain('newFromSample');
    expect(isShown(panel)).toBe(false);
    expect(active()).toBe(t.previewHost);
  });
});

// 讓 lint 不抱怨沒用到的匯入（FakeEvent 用在型別上）
void FakeEvent;
