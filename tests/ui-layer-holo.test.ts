import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { addUploadedLayer, createEditor, editFoil, editLayer, toUiState, type EditorState } from '../src/ui/editor';
import { createLayerPanel } from '../src/ui/layer-list';
import { BREAKOUT_NO_HOLO_TEXT, layerHoloToggle } from '../src/ui/logic';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, installFakeDom, type FakeElement } from './ui-fake-dom';

// T-411b：反光層選「用圖層形狀」時（T-417 以前是鐳射範圍的「指定圖層」），衝出卡片的層整層不反光（T-411），左欄那一列的星星開關沒有作用 →
// 變淡、滑過時說明「衝出卡片的層不反光」，按了不改。

const T0 = '2026-10-14T00:00:00.000Z';

function input(id: string, hasAlpha: boolean): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 };
}

/** 正面：底圖 bg、立體層 hero、立體層 dragon（衝出卡片）；正面的反光層＝用圖層形狀。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('dragon', true), 'dragon.png', T0).state;
  s = editLayer(s, 'dragon', { breakout: true, holo: true }, 'commit', T0);
  s = editLayer(s, 'hero', { holo: true }, 'commit', T0);
  return editFoil(s, 'front', { shape: 'layers' }, T0);
}

beforeEach(() => {
  installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('圖層清單的鐳射開關（T-411b）', () => {
  it('開關的狀態與說明：衝出卡片的層＝變淡（不管原本開關），其他照開關', () => {
    expect(BREAKOUT_NO_HOLO_TEXT).toBe('衝出卡片的層不反光');
    expect(layerHoloToggle({ holo: true })).toEqual({ state: 'on', title: '會反光（按一下關掉）' });
    expect(layerHoloToggle({ holo: false })).toEqual({ state: 'off', title: '不反光（按一下打開）' });
    expect(layerHoloToggle({ holo: true, breakout: true })).toEqual({ state: 'locked', title: BREAKOUT_NO_HOLO_TEXT });
    expect(layerHoloToggle({ holo: false, breakout: true })).toEqual({ state: 'locked', title: BREAKOUT_NO_HOLO_TEXT });
    expect(layerHoloToggle({ holo: true, breakout: false })).toEqual({ state: 'on', title: '會反光（按一下關掉）' });
  });

  it('清單上：破框層的星星變淡、說明、按了不改；一般的層照常切換；關掉破框又能按', () => {
    const edits: { id: string; patch: unknown }[] = [];
    const intents = { editLayer: (id: string, patch: unknown) => edits.push({ id, patch }) } as unknown as UiIntents;
    const panel = createLayerPanel(intents);
    let s = setup();
    panel.render(toUiState(s, () => undefined));
    const holoOf = (name: string): FakeElement => {
      const row = all(panel.el, 'layer-row').find((r) => byClass(r, 'layer-name').value === name);
      if (!row) throw new Error(`找不到 ${name}`);
      return byClass(row, 'layer-holo');
    };

    const dragon = holoOf('dragon');
    expect(dragon.dataset.state).toBe('locked');
    expect(dragon.title).toBe('衝出卡片的層不反光');
    expect(dragon.getAttribute('aria-label')).toBe('衝出卡片的層不反光');
    expect(dragon.getAttribute('aria-disabled')).toBe('true');
    expect(dragon.getAttribute('aria-pressed')).toBeNull();
    dragon.click();
    expect(edits).toEqual([]);

    const hero = holoOf('hero');
    expect(hero.dataset.state).toBe('on');
    expect(hero.getAttribute('aria-disabled')).toBeNull();
    hero.click();
    expect(edits).toEqual([{ id: 'hero', patch: { holo: false } }]);

    // 關掉破框：又能按（顯示原本存著的開關）
    s = editLayer(s, 'dragon', { breakout: false }, 'commit', T0);
    panel.render(toUiState(s, () => undefined));
    expect(dragon.dataset.state).toBe('on');
    expect(dragon.title).toBe('會反光（按一下關掉）');
    expect(dragon.getAttribute('aria-disabled')).toBeNull();
    expect(dragon.getAttribute('aria-pressed')).toBe('true');
    dragon.click();
    expect(edits.at(-1)).toEqual({ id: 'dragon', patch: { holo: false } });
  });
});
