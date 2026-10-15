import { describe, expect, it } from 'vitest';
import { findLayer, updateLayer } from '../../src/model/actions';
import {
  apply,
  canRedo,
  canUndo,
  cancel,
  commit,
  createHistory,
  draftBase,
  preview,
  redo,
  undo,
  type History,
} from '../../src/model/history';
import { cardWith, deepFreeze, depthLayer } from './helpers';

/** 連續記好幾步。 */
function applyAll<T extends {}>(h: History<T>, values: T[]): History<T> {
  return values.reduce((acc, v) => apply(acc, v), h);
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

describe('createHistory', () => {
  it('一開始沒有可以復原或重做的步驟', () => {
    const h = createHistory(0);
    expect(h.present).toBe(0);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.previewBase).toBeNull();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe('apply／undo／redo', () => {
  it('apply 記一步；undo、redo 來回走', () => {
    let h = applyAll(createHistory(0), [1, 2]);
    expect(h.past).toEqual([0, 1]);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(0);
    expect(canUndo(h)).toBe(false);
    expect(undo(h).present).toBe(0);
    h = redo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
    expect(redo(h).present).toBe(2);
  });

  it('和目前同一個物件就不記', () => {
    const state = { v: 1 };
    const h = createHistory(state);
    expect(apply(h, state)).toBe(h);
  });

  it('新動作清掉重做', () => {
    let h = applyAll(createHistory(0), [1, 2]);
    h = undo(h);
    h = apply(h, 9);
    expect(h.present).toBe(9);
    expect(h.future).toEqual([]);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([0, 1]);
  });
});

describe('preview／commit／cancel（一次拖曳＝一步，SCHEMA §1.2）', () => {
  it('拖曳中只換 present、不記步；放開 commit 才算一步', () => {
    let h = createHistory(0);
    h = preview(h, 1);
    h = preview(h, 2);
    h = preview(h, 3);
    expect(h.present).toBe(3);
    expect(h.past).toEqual([]);
    expect(h.previewBase).toBe(0);
    h = commit(h);
    expect(h.past).toEqual([0]);
    expect(h.present).toBe(3);
    expect(h.previewBase).toBeNull();
    h = undo(h);
    expect(h.present).toBe(0);
    h = redo(h);
    expect(h.present).toBe(3);
  });

  it('拖回原狀（同一個物件）再放開不記步', () => {
    let h = applyAll(createHistory(0), [1]);
    h = preview(h, 5);
    h = preview(h, 1);
    h = commit(h);
    expect(h.past).toEqual([0]);
    expect(h.present).toBe(1);
    expect(h.previewBase).toBeNull();
  });

  it('沒有在拖曳時 commit、cancel 都不變', () => {
    const h = applyAll(createHistory(0), [1]);
    expect(commit(h)).toBe(h);
    expect(cancel(h)).toBe(h);
  });

  it('cancel 回到拖之前，不記步', () => {
    let h = applyAll(createHistory(0), [1]);
    h = preview(h, 5);
    h = preview(h, 6);
    h = cancel(h);
    expect(h.present).toBe(1);
    expect(h.past).toEqual([0]);
    expect(h.previewBase).toBeNull();
  });

  it('拖曳中保留重做；cancel 後還能重做；commit 有改變才清掉', () => {
    let h = applyAll(createHistory(0), [1, 2]);
    h = undo(h);
    h = preview(h, 7);
    expect(h.future).toEqual([2]);
    const cancelled = cancel(h);
    expect(cancelled.present).toBe(1);
    expect(canRedo(cancelled)).toBe(true);
    const committed = commit(h);
    expect(committed.future).toEqual([]);
    expect(committed.past).toEqual([0, 1]);
  });

  it('canUndo／canRedo 在拖曳中和「先 commit」的結果一致', () => {
    let h = createHistory(0);
    h = preview(h, 5);
    expect(canUndo(h)).toBe(true);
    h = preview(h, 0);
    expect(canUndo(h)).toBe(false);

    let r = applyAll(createHistory(0), [1]);
    r = undo(r);
    r = preview(r, 8);
    expect(canRedo(r)).toBe(false); // 放開就會清掉重做
    r = preview(r, 0);
    expect(canRedo(r)).toBe(true); // 拖回原狀，放開不記步，重做還在
  });

  it('拖曳中按復原：先把這次拖曳算一步，再復原它', () => {
    let h = applyAll(createHistory(0), [1]);
    h = preview(h, 5);
    h = preview(h, 6);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(h.previewBase).toBeNull();
    h = redo(h);
    expect(h.present).toBe(6);
  });

  it('拖曳中按重做：先 commit（有改變就清掉重做），所以停在拖曳結果', () => {
    let h = applyAll(createHistory(0), [1, 2]);
    h = undo(h);
    h = preview(h, 7);
    h = redo(h);
    expect(h.present).toBe(7);
    expect(h.previewBase).toBeNull();
    expect(h.future).toEqual([]);
  });

  it('拖曳中 apply：先把拖曳算一步，再記這一步', () => {
    let h = applyAll(createHistory(0), [1]);
    h = preview(h, 5);
    h = apply(h, 9);
    expect(h.past).toEqual([0, 1, 5]);
    expect(h.present).toBe(9);
    expect(h.previewBase).toBeNull();
  });
});

describe('步數上限', () => {
  it('past 超過上限時丟掉最舊的', () => {
    let h = applyAll(createHistory(0, 3), range(1, 5));
    expect(h.past).toEqual([2, 3, 4]);
    expect(h.present).toBe(5);
    h = undo(undo(undo(h)));
    expect(h.present).toBe(2);
    expect(canUndo(h)).toBe(false);
  });

  it('拖曳 commit 也受上限限制', () => {
    let h = applyAll(createHistory(0, 2), [1, 2]);
    h = commit(preview(h, 3));
    expect(h.past).toEqual([1, 2]);
  });

  it('redo 碰到上限時丟掉最舊的一步', () => {
    // 正常用 undo／redo 走不到這裡（undo 會騰出空位）；直接給一個 past 已滿、future 還有東西的狀態
    const full: History<number> = { past: [1, 2, 3], present: 4, future: [5, 6], previewBase: null, limit: 3 };
    const h = redo(full);
    expect(h.past).toEqual([2, 3, 4]);
    expect(h.present).toBe(5);
    expect(h.future).toEqual([6]);
    expect(h.past).toHaveLength(h.limit);
    // 再 redo 一次也一樣
    const h2 = redo(h);
    expect(h2.past).toEqual([3, 4, 5]);
    expect(h2.present).toBe(6);
    expect(h2.future).toEqual([]);
  });

  it('預設至少 50 步（SCHEMA §1.2）；預設上限 100', () => {
    let h = applyAll(createHistory(0), range(1, 60));
    for (let i = 0; i < 60; i++) h = undo(h);
    expect(h.present).toBe(0);

    const big = applyAll(createHistory(0), range(1, 150));
    expect(big.past).toHaveLength(100);
    expect(big.past[0]).toBe(50);
  });
});

describe('不可變', () => {
  it('舊的狀態被凍結也能操作，而且內容不變', () => {
    const h0 = deepFreeze(applyAll(createHistory(0), [1, 2]));
    const snapshot = structuredClone(h0);
    const ops = [
      apply(h0, 3),
      undo(h0),
      redo(undo(h0)),
      preview(h0, 4),
      commit(preview(h0, 4)),
      cancel(preview(h0, 4)),
    ];
    for (const h of ops) deepFreeze(h);
    expect(h0).toEqual(snapshot);
  });
});

describe('draftBase：拖曳中要從哪一張卡算新值', () => {
  it('沒有在拖曳＝目前的卡；拖曳中＝拖之前的卡（第一次 preview 之前的狀態）', () => {
    const start = cardWith([depthLayer({ id: 'a', x: 0 })]);
    let h = createHistory(start);
    expect(draftBase(h)).toBe(start);
    h = preview(h, updateLayer(draftBase(h), 'front', 'a', { x: 0.1 }));
    expect(h.present).not.toBe(start);
    expect(draftBase(h)).toBe(start);
    h = preview(h, updateLayer(draftBase(h), 'front', 'a', { x: 0.2 }));
    expect(draftBase(h)).toBe(start);
    h = commit(h);
    expect(draftBase(h)).toBe(h.present);
  });

  it('每次都從 draftBase 算：拖回原值再放開，不會多記一步', () => {
    const start = cardWith([depthLayer({ id: 'a', x: 0 })]);
    let h = createHistory(start);
    for (const x of [0.3, 0.6, 0]) h = preview(h, updateLayer(draftBase(h), 'front', 'a', { x }));
    expect(h.present).toBe(start); // 回到 0，沒有改變，拿到的是同一個物件
    h = commit(h);
    expect(h.past).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
  });
});

describe('和卡片動作一起用', () => {
  it('拖曳圖層：每次從拖之前的卡算新位置，放開算一步，復原回到原本那張卡', () => {
    const start = cardWith([depthLayer({ id: 'a', x: 0 })]);
    let h = createHistory(start);
    for (const dx of [0.1, 0.2, 0.3]) {
      const from = draftBase(h);
      h = preview(h, updateLayer(from, 'front', 'a', { x: dx }));
    }
    h = commit(h);
    expect(findLayer(h.present, 'front', 'a')?.x).toBe(0.3);
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(start);
  });
});
