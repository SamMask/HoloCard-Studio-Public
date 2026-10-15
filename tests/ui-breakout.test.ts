// T-411 右欄的「衝出卡片」開關（DESIGN §3「破框」）：介面文字、開關記一步（可復原）、底圖沒有這個開關。
import { describe, expect, it } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Layer } from '../src/model/types';
import { addUploadedLayer, createEditor, currentCard, editLayer, redoEdit, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { BREAKOUT_HELP, BREAKOUT_LABEL, breakoutShown } from '../src/ui/logic';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

function input(id: string, hasAlpha: boolean): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 };
}

/** 正面：底圖 bg、立體層 hero(50)。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  return s;
}

function layerOf(s: EditorState, id: string): Layer {
  return currentCard(s).front.layers.find((l) => l.id === id)!;
}

describe('衝出卡片開關（DESIGN §3 的字）', () => {
  it('開關名與說明', () => {
    expect(BREAKOUT_LABEL).toBe('衝出卡片');
    expect(BREAKOUT_HELP).toBe('讓角色的頭、翅膀超出卡片邊緣（圖要放得比卡大）');
  });

  it('立體層與文字層有開關，底圖沒有', () => {
    const s = setup();
    expect(breakoutShown(layerOf(s, 'hero'))).toBe(true);
    expect(breakoutShown(layerOf(s, 'bg'))).toBe(false);
  });

  it('開關記一步：打開 → 復原回到沒有欄位 → 重做又打開', () => {
    const s0 = setup();
    const before = toUiState(s0, () => undefined);
    const on = editLayer(s0, 'hero', { breakout: true }, 'commit', T1);
    expect(layerOf(on, 'hero').breakout).toBe(true);
    expect(toUiState(on, () => undefined).canUndo).toBe(true);
    const undone = undoEdit(on);
    expect('breakout' in layerOf(undone, 'hero')).toBe(false);
    expect(currentCard(undone)).toEqual(currentCard(s0));
    expect(before.canUndo).toBe(true);
    expect(layerOf(redoEdit(undone), 'hero').breakout).toBe(true);
    // 關掉：欄位拿掉
    const off = editLayer(on, 'hero', { breakout: false }, 'commit', T1);
    expect('breakout' in layerOf(off, 'hero')).toBe(false);
  });

  it('底圖送 breakout 不會改（不記步）', () => {
    const s0 = setup();
    const next = editLayer(s0, 'bg', { breakout: true }, 'commit', T1);
    expect(currentCard(next)).toBe(currentCard(s0));
  });
});
