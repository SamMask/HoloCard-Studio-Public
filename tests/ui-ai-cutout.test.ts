// 上傳沒有透明的圖時的確認框（T-703，DESIGN §3.1、§4）：不管有沒有底圖都問；選項依「有沒有底圖、模型在不在」變化；
// 〔拆成立體層〕先變淡標「即將推出」（T-704 才做）；AI 的問題（沒有圖形加速、找不到主角）與進度小面板（取消、Esc）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { createUi } from '../src/ui/app';
import {
  addUploadedLayer,
  askOpaqueUpload,
  createEditor,
  currentCard,
  placeBase,
  takePending,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import {
  AI_WORKING_NOTE,
  AI_CUTTING_TEXT,
  AI_LOADING_TEXT,
  AI_MODEL_MISSING_NOTE,
  AI_NO_BACKGROUND_TEXT,
  AI_NO_SUBJECT_TEXT,
  AI_SLOW_ASK_TEXT,
  AI_SOON_TEXT,
  OPAQUE_LAYER_NOTE,
  opaqueUploadChoices,
  UPLOAD_ASK_TITLE,
} from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { AiView, UiIntents, UiState } from '../src/ui/types';
import { all, buttonWithText, byClass, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';

function input(id: string, hasAlpha: boolean): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1400 };
}

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const READY: AiView = { matteReady: true, depthReady: true, busy: false, progress: null, ask: null };
const ui = (s: EditorState, ai: AiView = READY): UiState => ({ ...toUiState(s, (h) => `blob:${h}`), ai });

const empty = () => createEditor(newCard('standard', 'card-1', T0));
function withBase(): EditorState {
  return addUploadedLayer(empty(), 'front', input('bg', false), 'bg.jpg', T0).state;
}

beforeEach(() => {
  installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- 編輯器：上傳沒有透明的圖一律先問 ----

describe('askOpaqueUpload：不管有沒有底圖都先問（以前沒有底圖直接當底圖）', () => {
  it('還沒有底圖：卡片不變、記下待確認，畫面知道沒有底圖', () => {
    const s0 = empty();
    const r = askOpaqueUpload(s0, 'front', input('pic', false), 'pic.jpg', T1);
    expect(r.problem).toBeNull();
    expect(currentCard(r.state)).toBe(currentCard(s0));
    expect(toUiState(r.state, () => undefined).pendingReplaceBase).toEqual({ fileName: 'pic.jpg', hasBase: false });
  });

  it('已有底圖：hasBase true', () => {
    const r = askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1);
    expect(toUiState(r.state, () => undefined).pendingReplaceBase).toEqual({ fileName: 'pic.jpg', hasBase: true });
  });

  it('這一面 8 層又沒有底圖：問了也加不進去 → face-full', () => {
    let s = empty();
    for (let i = 0; i < 8; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true), `${i}.png`, T0).state;
    const r = askOpaqueUpload(s, 'front', input('pic', false), 'pic.jpg', T1);
    expect(r.problem).toBe('face-full');
    expect(r.state.pending).toBeNull();
  });

  it('〔當底圖〕（沒有底圖時）＝answerReplaceBase(true)：放到第 0 個、選中、記一步', async () => {
    const { answerReplaceBase } = await import('../src/ui/editor');
    const s0 = askOpaqueUpload(empty(), 'front', input('pic', false), 'pic.jpg', T1).state;
    const s1 = answerReplaceBase(s0, true, T2);
    expect(currentCard(s1).front.layers.map((l) => [l.id, l.role])).toEqual([['pic', 'base']]);
    expect(s1.selectedLayerId).toBe('pic');
    expect(currentCard(undoEdit(s1)).front.layers).toEqual([]);
  });

  it('takePending：收起確認框、交出那張圖（卡片不變、不記步）', () => {
    const s0 = askOpaqueUpload(withBase(), 'back', input('pic', false), 'pic.jpg', T1).state;
    const r = takePending(s0);
    expect(r.pending).toMatchObject({ face: 'back', fileName: 'pic.jpg', input: { id: 'pic' } });
    expect(r.state.pending).toBeNull();
    expect(r.state.history).toBe(s0.history);
    expect(takePending(r.state).pending).toBeNull();
  });

  it('placeBase（找不到主角時的〔當底圖〕）：有底圖就取代、沒有就加；選中、切到那一面、一步', () => {
    const a = placeBase(withBase(), 'front', input('pic', false), T1);
    expect(a.problem).toBeNull();
    expect(currentCard(a.state).front.layers.map((l) => l.id)).toEqual(['pic']);
    expect(a.state.selectedLayerId).toBe('pic');
    expect(currentCard(undoEdit(a.state)).front.layers.map((l) => l.id)).toEqual(['bg']);
    const b = placeBase(empty(), 'back', input('pic', false), T1);
    expect(b.state.face).toBe('back');
    expect(currentCard(b.state).back.layers.map((l) => l.role)).toEqual(['base']);
  });

  it('placeBase：這一面 8 層又沒有底圖 → face-full、卡不變', () => {
    let s = empty();
    for (let i = 0; i < 8; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true), `${i}.png`, T0).state;
    const r = placeBase(s, 'front', input('pic', false), T1);
    expect(r.problem).toBe('face-full');
    expect(currentCard(r.state)).toBe(currentCard(s));
  });
});

// ---- 確認框 ----

describe('確認框的選項依「有沒有底圖、模型在不在」變化（DESIGN §4）', () => {
  it('第一排：有底圖〔自動去背〕〔拆成立體層〕〔取代底圖〕；沒有〔當底圖〕〔自動去背〕〔拆成立體層〕', () => {
    expect(opaqueUploadChoices(true)).toEqual(['cutout', 'split', 'replace']);
    expect(opaqueUploadChoices(false)).toEqual(['base', 'cutout', 'split']);
  });

  function confirmOf(stage: { el: HTMLElement }) {
    return byClass(stage.el, 'confirm-upload');
  }
  const mainRow = (stage: { el: HTMLElement }) => byClass(confirmOf(stage), 'confirm-main');
  const labels = (row: FakeElement) => all(row, 'ai-choice-label').map((e) => e.textContent);

  it('已有底圖：標題、第一排三顆大按鈕、第二排發光層／加深層＋小字、〔取消〕', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state));
    const box = confirmOf(stage);
    expect(isShown(box)).toBe(true);
    expect(byClass(box, 'confirm-title').textContent).toBe(UPLOAD_ASK_TITLE);
    expect(UPLOAD_ASK_TITLE).toBe('這張圖沒有透明背景。要怎麼用？');
    expect(byClass(box, 'confirm-file').textContent).toBe('檔案：pic.jpg');
    expect(labels(mainRow(stage))).toEqual(['自動去背', '拆成立體層', '取代底圖']);
    expect(mainRow(stage).textContent).toContain('把主角剪下來，變成浮起來的一層');
    expect(mainRow(stage).textContent).toContain('依遠近把整張圖拆成 3 層（會取代目前的底圖）');
    const minor = byClass(box, 'confirm-minor-row');
    expect(isShown(minor)).toBe(true);
    expect(minor.textContent).toContain('當發光層（黑色變透明）');
    expect(minor.textContent).toContain('當加深層（白色變透明）');
    expect(minor.textContent).toContain(OPAQUE_LAYER_NOTE);
    expect(buttonWithText(box, '取消')).toBeDefined();
  });

  it('還沒有底圖：〔當底圖〕〔自動去背〕〔拆成立體層〕〔取消〕，沒有第二排', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(empty(), 'front', input('pic', false), 'pic.jpg', T1).state));
    expect(labels(mainRow(stage))).toEqual(['當底圖', '自動去背', '拆成立體層']);
    expect(mainRow(stage).textContent).not.toContain('會取代目前的底圖');
    expect(isShown(byClass(confirmOf(stage), 'confirm-minor-row'))).toBe(false);
    expect(buttonWithText(confirmOf(stage), '取消')).toBeDefined();
  });

  it('〔拆成立體層〕（T-704 起可以按）：沒有「即將推出」，按了送 answerSplitLayers', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state));
    const split = buttonWithText(mainRow(stage), '拆成立體層');
    expect(split.disabled).toBe(false);
    expect(split.textContent).not.toContain(AI_SOON_TEXT);
    split.click();
    expect(calls.map((c) => c.name)).toEqual(['answerSplitLayers']);
  });

  it('模型在：〔自動去背〕可以按、是主要按鈕，按了送 answerAutoCutout；沒有說明小字', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state));
    const cut = buttonWithText(mainRow(stage), '自動去背');
    expect(cut.disabled).toBe(false);
    expect(cut.classList.contains('primary')).toBe(true);
    expect(isShown(byClass(confirmOf(stage), 'confirm-ai-note'))).toBe(false);
    cut.click();
    expect(calls.map((c) => c.name)).toEqual(['answerAutoCutout']);
  });

  it('模型不在：兩個 AI 按鈕變淡、旁邊說怎麼下載；〔取代底圖〕變成主要按鈕', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state, { ...READY, matteReady: false, depthReady: false }));
    const cut = buttonWithText(mainRow(stage), '自動去背');
    expect(cut.disabled).toBe(true);
    expect(buttonWithText(mainRow(stage), '拆成立體層').disabled).toBe(true);
    const note = byClass(confirmOf(stage), 'confirm-ai-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(AI_MODEL_MISSING_NOTE);
    expect(AI_MODEL_MISSING_NOTE).toBe('要先下載 AI 模型（約 275 MB，只要一次）：關掉工坊，雙擊資料夾裡的「下載AI模型.bat」。');
    expect(buttonWithText(mainRow(stage), '取代底圖').classList.contains('primary')).toBe(true);
    expect(cut.classList.contains('primary')).toBe(false);
    cut.click();
    expect(calls).toEqual([]);
  });

  it('還不知道模型在不在（null）：〔自動去背〕先變淡、不說明', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state, { ...READY, matteReady: null }));
    expect(buttonWithText(mainRow(stage), '自動去背').disabled).toBe(true);
    expect(isShown(byClass(confirmOf(stage), 'confirm-ai-note'))).toBe(false);
  });

  it('只有一個模型不在：那一顆變淡，另一顆照樣能按；一樣說怎麼下載', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const s = askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state;
    stage.render(ui(s, { ...READY, depthReady: false }));
    expect(buttonWithText(mainRow(stage), '自動去背').disabled).toBe(false);
    expect(buttonWithText(mainRow(stage), '拆成立體層').disabled).toBe(true);
    expect(byClass(confirmOf(stage), 'confirm-ai-note').textContent).toBe(AI_MODEL_MISSING_NOTE);
    stage.render(ui(s, { ...READY, matteReady: false }));
    expect(buttonWithText(mainRow(stage), '自動去背').disabled).toBe(true);
    expect(buttonWithText(mainRow(stage), '拆成立體層').disabled).toBe(false);
  });

  it('另一件 AI 工作還在做：兩個 AI 按鈕都變淡、說「AI 還在處理上一張」', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state, { ...READY, busy: true }));
    expect(buttonWithText(mainRow(stage), '自動去背').disabled).toBe(true);
    expect(buttonWithText(mainRow(stage), '拆成立體層').disabled).toBe(true);
    expect(byClass(confirmOf(stage), 'confirm-ai-note').textContent).toBe(AI_WORKING_NOTE);
  });

  it('其他按鈕送出的意圖：取代底圖／當底圖＝answerReplaceBase(true)、發光層＝screen、加深層＝multiply、取消＝answerReplaceBase(false)', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state));
    buttonWithText(mainRow(stage), '取代底圖').click();
    buttonWithText(confirmOf(stage), '當發光層').click();
    buttonWithText(confirmOf(stage), '當加深層').click();
    buttonWithText(confirmOf(stage), '取消').click();
    stage.render(ui(askOpaqueUpload(empty(), 'front', input('pic', false), 'pic.jpg', T1).state));
    buttonWithText(mainRow(stage), '當底圖').click();
    expect(calls.map((c) => [c.name, ...c.args])).toEqual([
      ['answerReplaceBase', true],
      ['answerOpaqueLayer', 'screen'],
      ['answerOpaqueLayer', 'multiply'],
      ['answerReplaceBase', false],
      ['answerReplaceBase', true],
    ]);
  });

  it('沒有待確認的圖：確認框收起', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase()));
    expect(isShown(confirmOf(stage))).toBe(false);
  });
});

// ---- AI 的問題 ----

describe('AI 的問題（沒有圖形加速、找不到主角）', () => {
  const askBox = (stage: { el: HTMLElement }) => byClass(stage.el, 'confirm-ai');

  it('沒有圖形加速：問「大約要一分多鐘」〔繼續〕〔取消〕', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, busy: true, ask: { kind: 'slow', fileName: 'pic.jpg' } }));
    const box = askBox(stage);
    expect(isShown(box)).toBe(true);
    expect(byClass(box, 'confirm-title').textContent).toBe(AI_SLOW_ASK_TEXT);
    expect(AI_SLOW_ASK_TEXT).toBe('這台電腦沒有圖形加速，大約要一分多鐘，期間可以繼續編輯。要繼續嗎？');
    buttonWithText(box, '繼續').click();
    buttonWithText(box, '取消').click();
    expect(calls.map((c) => [c.name, ...c.args])).toEqual([
      ['answerAiAsk', true],
      ['answerAiAsk', false],
    ]);
  });

  it('找不到主角：「這張圖找不到主角…」〔當底圖〕〔取消〕', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, ask: { kind: 'no-subject', fileName: 'pic.jpg' } }));
    const box = askBox(stage);
    expect(byClass(box, 'confirm-title').textContent).toBe(AI_NO_SUBJECT_TEXT);
    expect(AI_NO_SUBJECT_TEXT).toBe('這張圖找不到主角，換一張試試，或當底圖用。');
    expect(byClass(box, 'confirm-file').textContent).toBe('檔案：pic.jpg');
    buttonWithText(box, '當底圖').click();
    expect(calls.map((c) => [c.name, ...c.args])).toEqual([['answerAiAsk', true]]);
  });

  it('整張都被當成主角：另一句，按鈕一樣', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, ask: { kind: 'no-background', fileName: 'pic.jpg' } }));
    expect(byClass(askBox(stage), 'confirm-title').textContent).toBe(AI_NO_BACKGROUND_TEXT);
    expect(buttonWithText(askBox(stage), '當底圖')).toBeDefined();
  });

  it('沒有問題：收起', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase()));
    expect(isShown(askBox(stage))).toBe(false);
  });
});

// ---- 進度小面板 ----

describe('進度小面板（預覽區下方，和匯出面板同一個位置）', () => {
  const panel = (stage: { el: HTMLElement }) => byClass(stage.el, 'ai-progress');

  it('第一次：「正在載入 AI 模型（第一次比較久）」＋百分比；推論中：「正在去背…」、不顯示百分比', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, busy: true, progress: { step: 'load', fraction: 0.42, expectSec: 3 } }));
    const p = panel(stage);
    expect(isShown(p)).toBe(true);
    expect(byClass(p, 'ai-progress-title').textContent).toBe(AI_LOADING_TEXT);
    expect(AI_LOADING_TEXT).toBe('正在載入 AI 模型（第一次比較久）');
    expect(byClass(p, 'ai-progress-percent').textContent).toBe('42%');
    expect(byClass(p, 'ai-progress-bar').getAttribute('aria-valuenow')).toBe('42');
    stage.render(ui(withBase(), { ...READY, busy: true, progress: { step: 'cut', fraction: null, expectSec: 3 } }));
    expect(byClass(p, 'ai-progress-title').textContent).toBe(AI_CUTTING_TEXT);
    expect(AI_CUTTING_TEXT).toBe('正在去背…');
    expect(isShown(byClass(p, 'ai-progress-percent'))).toBe(false);
    expect(byClass(p, 'ai-progress-bar').getAttribute('aria-valuenow')).toBeNull();
  });

  it('〔取消〕送 cancelAi；沒有工作時收起', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, busy: true, progress: { step: 'cut', fraction: null, expectSec: 3 } }));
    buttonWithText(panel(stage), '取消').click();
    expect(calls.map((c) => c.name)).toEqual(['cancelAi']);
    stage.render(ui(withBase()));
    expect(isShown(panel(stage))).toBe(false);
  });

  it('進行中可以繼續編輯：面板不是對話框（不擋後面）', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, busy: true, progress: { step: 'cut', fraction: null, expectSec: 3 } }));
    expect(panel(stage).getAttribute('role')).toBe('status');
    expect(panel(stage).getAttribute('aria-modal')).toBeNull();
  });
});

// ---- Esc ----

describe('Esc：AI 的問題＝取消；進行中（沒有別的東西要關、沒選圖層）＝取消去背', () => {
  function mount() {
    const win = Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 1280 });
    vi.stubGlobal('window', win);
    const docEvents = new EventTarget();
    Object.assign(document, {
      addEventListener: docEvents.addEventListener.bind(docEvents),
      removeEventListener: docEvents.removeEventListener.bind(docEvents),
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/0');
    const { intents, calls } = recorder();
    const app = createUi(document.createElement('div') as unknown as HTMLElement, intents);
    const esc = () => win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    return { app, calls, esc };
  }

  it('問題開著：Esc＝answerAiAsk(false)', () => {
    const { app, calls, esc } = mount();
    app.render(ui(withBase(), { ...READY, ask: { kind: 'no-subject', fileName: 'pic.jpg' } }));
    esc();
    expect(calls.filter((c) => c.name !== 'selectLayer').map((c) => [c.name, ...c.args])).toEqual([['answerAiAsk', false]]);
  });

  it('上傳確認框和 AI 問題都開著：先關上傳確認框', () => {
    const { app, calls, esc } = mount();
    const s = askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T1).state;
    app.render(ui(s, { ...READY, ask: { kind: 'no-subject', fileName: 'x.jpg' } }));
    esc();
    expect(calls.map((c) => [c.name, ...c.args])).toEqual([['answerReplaceBase', false]]);
  });

  it('去背中、沒有選圖層：Esc＝cancelAi', () => {
    const { app, calls, esc } = mount();
    const s = { ...withBase(), selectedLayerId: null };
    app.render(ui(s, { ...READY, busy: true, progress: { step: 'cut', fraction: null, expectSec: 3 } }));
    esc();
    expect(calls.map((c) => c.name)).toEqual(['cancelAi']);
  });

  it('去背中、選著圖層：Esc 先取消選取（不會一不小心停掉去背）', () => {
    const { app, calls, esc } = mount();
    app.render(ui(withBase(), { ...READY, busy: true, progress: { step: 'cut', fraction: null, expectSec: 3 } }));
    esc();
    expect(calls.map((c) => [c.name, ...c.args])).toEqual([['selectLayer', null]]);
  });
});
