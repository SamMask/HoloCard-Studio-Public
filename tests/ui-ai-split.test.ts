// 拆成立體層的畫面（T-704，DESIGN §3.1、§4）：進度小面板「正在拆成立體層…」、分不出遠近的問題、忙碌說明。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { addUploadedLayer, askOpaqueUpload, createEditor, toUiState, type EditorState } from '../src/ui/editor';
import { AI_NO_DEPTH_TEXT, AI_SPLITTING_TEXT, AI_WORKING_NOTE } from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { AiView, UiIntents, UiState } from '../src/ui/types';
import { buttonWithText, byClass, installFakeDom, isShown } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const READY: AiView = { matteReady: true, depthReady: true, busy: false, progress: null, ask: null };
const input = (id: string, hasAlpha: boolean): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 10, height: 14 });
const withBase = (): EditorState => addUploadedLayer(createEditor(newCard('standard', 'c', T0)), 'front', input('bg', false), 'bg.jpg', T0).state;
const ui = (s: EditorState, ai: AiView): UiState => ({ ...toUiState(s, () => undefined), ai });

beforeEach(() => {
  installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('拆成立體層的畫面', () => {
  it('進行中：「正在拆成立體層…」（第一次先「正在載入 AI 模型」，由 step 決定）', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, busy: true, progress: { step: 'split', fraction: null, expectSec: 3 } }));
    const panel = byClass(stage.el, 'ai-progress');
    expect(isShown(panel)).toBe(true);
    expect(byClass(panel, 'ai-progress-title').textContent).toBe(AI_SPLITTING_TEXT);
    expect(AI_SPLITTING_TEXT).toBe('正在拆成立體層…');
  });

  it('分不出遠近：問〔當底圖〕〔取消〕', () => {
    const { intents, calls } = recorder();
    const stage = createStage(intents);
    stage.render(ui(withBase(), { ...READY, ask: { kind: 'no-depth', fileName: 'land.jpg' } }));
    const box = byClass(stage.el, 'confirm-ai');
    expect(byClass(box, 'confirm-title').textContent).toBe(AI_NO_DEPTH_TEXT);
    buttonWithText(box, '當底圖').click();
    buttonWithText(box, '取消').click();
    expect(calls.map((c) => [c.name, ...c.args])).toEqual([
      ['answerAiAsk', true],
      ['answerAiAsk', false],
    ]);
  });

  it('另一件 AI 工作在做：說「AI 還在處理上一張圖」（去背、拆層共用）', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const s = askOpaqueUpload(withBase(), 'front', input('pic', false), 'pic.jpg', T0).state;
    stage.render(ui(s, { ...READY, busy: true }));
    expect(byClass(stage.el, 'confirm-ai-note').textContent).toBe(AI_WORKING_NOTE);
    expect(AI_WORKING_NOTE).toBe('AI 還在處理上一張圖，做完再試。');
  });
});
