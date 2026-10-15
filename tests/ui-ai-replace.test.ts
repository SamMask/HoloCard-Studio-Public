// T-703b 右欄〔自動去背〕按鈕（DESIGN §3.1）：選中「沒有透明背景的立體層」（例如當發光層用的圖）時，
// 圖層設定區塊裡、混合模式下面多一個〔自動去背〕＋小字「把主角剪下來，背景變透明」。
// 底圖、文字層、反光層、有透明的圖都沒有；正在做別的 AI 工作時變淡＋title；模型不在時變淡＋同上傳時的說明；鍵盤能 Tab 到、Enter／空白鍵按（原生按鈕）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Layer } from '../src/model/types';
import { addTextLayerEdit, addUploadedLayer, answerOpaqueLayer, askOpaqueUpload, createEditor, selectFoil, selectLayer, toUiState, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { AI_LAYER_BUSY_TEXT, AI_MODEL_MISSING_NOTE, LAYER_CUTOUT_HELP, layerCutoutShown } from '../src/ui/logic';
import type { AiView, UiIntents, UiState } from '../src/ui/types';
import { all, byClass, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';

const input = (id: string, hasAlpha: boolean): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、有透明的 hero、沒有透明的發光層 glow、文字層。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = askOpaqueUpload(s, 'front', input('glow', false), 'glow.jpg', T0).state;
  s = answerOpaqueLayer(s, 'screen', T0).state;
  const text = { content: '卡名', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
  s = addTextLayerEdit(s, 'front', { id: 'title', image: 'fedcba9876543210', text, width: 800, height: 200 }, T0).state;
  return s;
}

const READY: AiView = { matteReady: true, depthReady: true, busy: false, progress: null, ask: null };

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
  const render = (s: EditorState, ai: AiView | undefined = READY) => inspector.render({ ...toUiState(s, (h) => `blob:${h}`), ...(ai ? { ai } : {}) } as UiState);
  const block = () => byClass(root, 'layer-cutout');
  const btn = () => byClass(block(), 'layer-cutout-btn');
  return { root, calls, render, block, btn };
}

describe('layerCutoutShown：只有沒有透明背景的立體層（不是文字層）', () => {
  const layer = (over: Partial<Layer>): Layer => ({
    id: 'x', name: 'x', role: 'depth', image: '0123456789abcdef', visible: true, depth: 50, x: 0, y: 0, scale: 1, holo: true, hasAlpha: false, ...over,
  });
  it('立體層、沒有透明 → 有；底圖、有透明、文字層 → 沒有', () => {
    expect(layerCutoutShown(layer({}))).toBe(true);
    expect(layerCutoutShown(layer({ role: 'base', depth: 0 }))).toBe(false);
    expect(layerCutoutShown(layer({ hasAlpha: true }))).toBe(false);
    expect(layerCutoutShown(layer({ hasAlpha: true, text: { content: 'a', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } }))).toBe(false);
  });
});

describe('右欄〔自動去背〕：什麼時候出現', () => {
  it('選中沒有透明的發光層：出現〔自動去背〕＋小字「把主角剪下來，背景變透明」', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'));
    expect(isShown(t.block())).toBe(true);
    expect(t.btn().tagName).toBe('BUTTON');
    expect(t.btn().textContent).toBe('自動去背');
    expect(t.block().textContent).toContain(LAYER_CUTOUT_HELP);
    expect(LAYER_CUTOUT_HELP).toBe('把主角剪下來，背景變透明');
  });

  it('位置：圖層設定區塊裡，混合模式下面（和混合模式在同一塊、排在它後面）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'));
    const blendList = byClass(t.root, 'blend-list');
    let field: FakeElement | null = blendList;
    while (field && !field.parentNode?.children.includes(t.block())) field = field.parentNode;
    expect(field).not.toBeNull();
    const siblings = field!.parentNode!.children;
    expect(siblings.indexOf(t.block())).toBeGreaterThan(siblings.indexOf(field!));
  });

  it.each([
    ['底圖', 'bg'],
    ['有透明的圖', 'hero'],
    ['文字層', 'title'],
  ])('選中%s：沒有', (_name, id) => {
    const t = mount();
    t.render(selectLayer(setup(), id));
    expect(isShown(t.block())).toBe(false);
  });

  it('選著反光層、沒選任何圖層：沒有', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'));
    expect(isShown(t.block())).toBe(true);
    t.render(selectFoil(setup()));
    expect(isShown(t.block())).toBe(false);
    t.render(selectLayer(setup(), null));
    expect(isShown(t.block())).toBe(false);
  });

  it('換選別層再換回來：跟著出現／收起', () => {
    const t = mount();
    const s = setup();
    t.render(selectLayer(s, 'glow'));
    expect(isShown(t.block())).toBe(true);
    t.render(selectLayer(s, 'hero'));
    expect(isShown(t.block())).toBe(false);
    t.render(selectLayer(s, 'glow'));
    expect(isShown(t.block())).toBe(true);
  });
});

describe('右欄〔自動去背〕：按下去', () => {
  it('送 autoCutoutLayer(這一層的 id)', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'));
    t.btn().click();
    expect(t.calls).toEqual([{ name: 'autoCutoutLayer', args: ['glow'] }]);
  });

  it('還不知道模型在不在（null，這次還沒上傳過不透明的圖）：可以按（按了才查，不在就說怎麼下載）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'), { ...READY, matteReady: null });
    expect(t.btn().disabled).toBe(false);
    expect(isShown(byClass(t.block(), 'layer-cutout-note'))).toBe(false);
    // 沒給 ai（組裝端還沒接上）也一樣
    t.render(selectLayer(setup(), 'glow'), undefined);
    expect(t.btn().disabled).toBe(false);
  });

  it('模型不在：變淡、下面說怎麼下載（同上傳時的說明）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'), { ...READY, matteReady: false });
    expect(t.btn().disabled).toBe(true);
    const note = byClass(t.block(), 'layer-cutout-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(AI_MODEL_MISSING_NOTE);
    t.btn().click();
    expect(t.calls).toEqual([]);
  });

  it('一次只做一件：正在做別的 AI 工作時變淡、title「上一張還在處理，做完再試。」；做完恢復', () => {
    const t = mount();
    const s = selectLayer(setup(), 'glow');
    t.render(s, { ...READY, busy: true, progress: { step: 'cut', fraction: null, expectSec: 3 } });
    expect(t.btn().disabled).toBe(true);
    expect(t.btn().title).toBe(AI_LAYER_BUSY_TEXT);
    expect(AI_LAYER_BUSY_TEXT).toBe('上一張還在處理，做完再試。');
    t.btn().click();
    expect(t.calls).toEqual([]);
    t.render(s);
    expect(t.btn().disabled).toBe(false);
    expect(t.btn().title).toBe('');
  });

  it('鍵盤：原生按鈕、在 Tab 順序裡（Enter／空白鍵由瀏覽器變成 click）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'));
    expect(t.btn().tagName).toBe('BUTTON');
    expect(t.btn().getAttribute('type')).toBe('button');
    expect(t.btn().tabIndex).toBe(0);
    expect(t.btn().getAttribute('role')).toBeNull();
  });

  it('小字只有一行（不是對話框、不擋操作）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'glow'));
    expect(all(t.block(), 'help').map((e) => e.textContent)).toEqual([LAYER_CUTOUT_HELP]);
  });
});
