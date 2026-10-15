// 舞台七選一（T-415、T-832 多工作桌，DESIGN §5「舞台」）：右欄「舞台」七個選項排成三欄（3＋3＋1）、每個有小圖示；點魔法陣／水鏡／星雲記在卡上（一步、可復原）；
// 預覽區換成那個場景的底色（is-magic／is-water／is-nebula，一次只有一個；展示廳照舊 is-gallery）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';
import type { StageStyle } from '../src/model/types';
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
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stageGroup(root: FakeElement): FakeElement {
  const group = all(root, 'segmented').find((s) => s.getAttribute('aria-label') === '舞台');
  if (!group) throw new Error('找不到舞台選項');
  return group;
}

const SCENES: readonly StageStyle[] = ['halo', 'gallery', 'magic', 'water', 'nebula', 'desk', 'none'];

describe('右欄「舞台」七選一', () => {
  it('排成三欄（stage-grid）；每個選項都有一個小圖示和名字', () => {
    const { intents } = recorder();
    const inspector = createInspector(intents);
    inspector.render(ui(createEditor(newCard('standard', 'c1', T0))));
    const group = stageGroup(inspector.el as unknown as FakeElement);
    expect(group.classList.contains('stage-grid')).toBe(true);
    const buttons = group.querySelectorAll('button');
    expect(buttons.length).toBe(7);
    for (const b of buttons) {
      expect(b.querySelectorAll('svg').length).toBe(1);
      expect(b.textContent.length).toBeGreaterThan(0);
    }
    // 圖示各不相同（每個場景一個）
    const shapes = buttons.map((b) => b.querySelectorAll('path').map((p) => p.getAttribute('d')).join('|'));
    expect(new Set(shapes).size).toBe(7);
  });

  it('點魔法陣、水鏡、星雲：各送一次 editCard({ view: { stage } }, commit)；那一顆亮起來、其他不亮', () => {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    let s = createEditor(newCard('standard', 'c1', T0));
    inspector.render(ui(s));
    for (const [i, scene] of SCENES.entries()) {
      if (scene === 'halo') continue;
      stageGroup(inspector.el as unknown as FakeElement).querySelectorAll('button')[i]!.click();
      expect(calls.at(-1)).toEqual({ name: 'editCard', args: [{ view: { stage: scene } }, 'commit'] });
      s = editCard(s, { view: { stage: scene } }, 'commit', T1);
      inspector.render(ui(s));
      const selected = stageGroup(inspector.el as unknown as FakeElement)
        .querySelectorAll('button')
        .map((b) => b.getAttribute('aria-checked') === 'true');
      expect(selected).toEqual(SCENES.map((x) => x === scene));
    }
  });

  it('每張卡記住、一步可以復原', () => {
    const s0 = createEditor(newCard('standard', 'c1', T0));
    const s1 = editCard(s0, { view: { stage: 'nebula' } }, 'commit', T1);
    const s2 = editCard(s1, { view: { stage: 'water' } }, 'commit', T1);
    expect(currentCard(s2).view.stage).toBe('water');
    expect(currentCard(undoEdit(s2)).view.stage).toBe('nebula');
    expect(currentCard(undoEdit(undoEdit(s2))).view.stage).toBe('desk');
  });
});

describe('預覽區的底色跟著場景換', () => {
  it('魔法陣／水鏡／星雲／展示廳／工作桌各自一個 class，一次只有一個；全息光環與關閉都沒有（用底圖模糊版）', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const el = stage.el as unknown as FakeElement;
    const classes = { gallery: 'is-gallery', magic: 'is-magic', water: 'is-water', nebula: 'is-nebula', desk: 'is-desk' } as const;
    let s = createEditor(newCard('standard', 'c1', T0));
    for (const scene of [...SCENES, 'magic', 'halo'] as const) {
      s = editCard(s, { view: { stage: scene } }, 'commit', T1);
      stage.render(ui(s));
      for (const [key, cls] of Object.entries(classes)) expect(el.classList.contains(cls)).toBe(key === scene);
    }
  });
});
