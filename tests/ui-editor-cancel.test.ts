// 直接在卡上拖圖層時按 Esc／指標被取消：回到拖之前、不記步（src/ui/editor.ts 的 cancelEdit）。
import { describe, expect, it } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { canRedo, canUndo } from '../src/model/history';
import { addUploadedLayer, cancelEdit, createEditor, currentCard, editLayer, undoEdit } from '../src/ui/editor';

const T0 = '2026-10-13T00:00:00.000Z';
const T1 = '2026-10-13T01:00:00.000Z';

function input(id: string): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha: true, width: 600, height: 800 };
}

function setup() {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'back', input('hero'), 'hero.png', T0).state;
  return s;
}

const hero = (s: ReturnType<typeof setup>) => currentCard(s).back.layers.find((l) => l.id === 'hero')!;

describe('cancelEdit', () => {
  it('拖曳中取消：回到拖之前、復原堆疊不多一步、可以再拖', () => {
    const s0 = setup();
    let s = editLayer(s0, 'hero', { x: 0.2, y: 0.1 }, 'preview', T1);
    s = editLayer(s, 'hero', { x: 0.4, y: 0.3 }, 'preview', T1);
    expect(hero(s).x).toBeCloseTo(0.4, 12);
    const c = cancelEdit(s);
    expect(currentCard(c)).toBe(currentCard(s0));
    expect(c.history.past.length).toBe(s0.history.past.length);
    expect(c.previewKey).toBeNull();
    expect(c.selectedLayerId).toBe('hero');
    // 再拖一次＝新的一步
    const again = editLayer(editLayer(c, 'hero', { scale: 0.3 }, 'preview', T1), 'hero', { scale: 0.3 }, 'commit', T1);
    expect(again.history.past.length).toBe(s0.history.past.length + 1);
    expect(currentCard(undoEdit(again))).toBe(currentCard(s0));
  });

  it('沒有在拖曳：原樣回傳', () => {
    const s0 = setup();
    expect(cancelEdit(s0)).toBe(s0);
  });

  it('一次拖曳（多個 preview＋commit）＝復原一步，Ctrl+Z 一次回到拖之前', () => {
    const s0 = setup();
    let s = s0;
    for (const x of [0.05, 0.1, 0.2, 0.3]) s = editLayer(s, 'hero', { x, y: -x }, 'preview', T1);
    s = editLayer(s, 'hero', { x: 0.3, y: -0.3 }, 'commit', T1);
    expect(s.history.past.length).toBe(s0.history.past.length + 1);
    expect(canUndo(s.history)).toBe(true);
    const u = undoEdit(s);
    expect(currentCard(u)).toBe(currentCard(s0));
    expect(canRedo(u.history)).toBe(true);
  });
});
