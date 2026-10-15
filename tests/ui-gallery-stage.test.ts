// 舞台選「展示廳」的畫面（T-410，DESIGN §5「舞台」）：右欄舞台的選項（T-415 起六個、T-832 起七個，見 ui-stage-scenes）、選了記在卡上（一步、可復原）；
// 預覽區換成展示廳的深藍底色（不用底圖模糊版）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';
import { createEditor, currentCard, editCard, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { createStage } from '../src/ui/stage';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, installFakeDom, type FakeElement } from './ui-fake-dom';

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

/** 右欄「舞台」那一排按鈕。 */
function stageButtons(root: FakeElement): FakeElement[] {
  const group = all(root, 'segmented').find((s) => s.getAttribute('aria-label') === '舞台');
  if (!group) throw new Error('找不到舞台選項');
  return group.querySelectorAll('button');
}

describe('右欄「舞台」', () => {
  it('七個選項（T-415、T-832）：全息光環／展示廳／魔法陣／水鏡／星雲／工作桌（新卡片預設，T-832c）／關閉', () => {
    const { intents } = recorder();
    const inspector = createInspector(intents);
    inspector.render(ui(createEditor(newCard('standard', 'c1', T0))));
    const buttons = stageButtons(inspector.el as unknown as FakeElement);
    expect(buttons.map((b) => b.textContent)).toEqual(['全息光環', '展示廳', '魔法陣', '水鏡', '星雲', '工作桌', '關閉']);
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false', 'false', 'true', 'false']);
  });

  it('點展示廳：送 editCard({ view: { stage: "gallery" } }, commit)；卡片是展示廳時那一顆亮起來', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    const s = createEditor(newCard('standard', 'c1', T0));
    inspector.render(ui(s));
    stageButtons(inspector.el as unknown as FakeElement)[1]!.click();
    expect(calls.filter((c) => c.name === 'editCard').map((c) => c.args)).toEqual([[{ view: { stage: 'gallery' } }, 'commit']]);
    inspector.render(ui(editCard(s, { view: { stage: 'gallery' } }, 'commit', T1)));
    expect(stageButtons(inspector.el as unknown as FakeElement).map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('每張卡記住、算一步可以復原', () => {
    const s0 = createEditor(newCard('standard', 'c1', T0));
    const s1 = editCard(s0, { view: { stage: 'gallery' } }, 'commit', T1);
    expect(currentCard(s1).view.stage).toBe('gallery');
    expect(currentCard(undoEdit(s1)).view.stage).toBe('desk');
  });
});

describe('預覽區的底色', () => {
  it('展示廳：舞台加 is-gallery（CSS 換成展示廳深藍底、底圖模糊版淡掉）；換回全息光環或關閉就拿掉', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const el = stage.el as unknown as FakeElement;
    const s0 = createEditor(newCard('standard', 'c1', T0));
    stage.render(ui(s0));
    expect(el.classList.contains('is-gallery')).toBe(false);
    const s1 = editCard(s0, { view: { stage: 'gallery' } }, 'commit', T1);
    stage.render(ui(s1));
    expect(el.classList.contains('is-gallery')).toBe(true);
    stage.render(ui(editCard(s1, { view: { stage: 'none' } }, 'commit', T1)));
    expect(el.classList.contains('is-gallery')).toBe(false);
  });
});
