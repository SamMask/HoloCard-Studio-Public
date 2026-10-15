import { describe, expect, it } from 'vitest';
import { deleteConfirmText, editedAgoText, libraryCountText, tiltFromPointer } from '../src/ui/library-logic';
import { escapeAction, isTextEntry, type ElementLike } from '../src/ui/logic';

// 卡片庫與新卡片面板（T-407，DESIGN 7.2、7.3）的純邏輯。

describe('「3 分鐘前編輯」（剛剛／幾分鐘前／幾小時前／昨天／日期）', () => {
  // 用當地時間建日期：不管測試機在哪個時區都一樣
  const now = new Date(2026, 9, 14, 15, 30, 0);
  const at = (...args: [number, number, number, number, number, number?]) => new Date(...args).toISOString();

  it('不到 1 分鐘（或時間在未來）→ 剛剛編輯', () => {
    expect(editedAgoText(at(2026, 9, 14, 15, 29, 30), now)).toBe('剛剛編輯');
    expect(editedAgoText(at(2026, 9, 14, 15, 31, 0), now)).toBe('剛剛編輯');
  });

  it('1～59 分鐘 → N 分鐘前編輯', () => {
    expect(editedAgoText(at(2026, 9, 14, 15, 27, 0), now)).toBe('3 分鐘前編輯');
    expect(editedAgoText(at(2026, 9, 14, 15, 29, 0), now)).toBe('1 分鐘前編輯');
    expect(editedAgoText(at(2026, 9, 14, 14, 31, 0), now)).toBe('59 分鐘前編輯');
  });

  it('1～23 小時 → N 小時前編輯（跨過半夜也一樣）', () => {
    expect(editedAgoText(at(2026, 9, 14, 14, 30, 0), now)).toBe('1 小時前編輯');
    expect(editedAgoText(at(2026, 9, 14, 0, 0, 0), now)).toBe('15 小時前編輯');
    const earlyMorning = new Date(2026, 9, 14, 1, 0, 0);
    expect(editedAgoText(at(2026, 9, 13, 22, 0, 0), earlyMorning)).toBe('3 小時前編輯');
  });

  it('超過 24 小時、是前一天 → 昨天編輯', () => {
    expect(editedAgoText(at(2026, 9, 13, 9, 0, 0), now)).toBe('昨天編輯');
  });

  it('更早 → 日期（同一年不寫年）', () => {
    expect(editedAgoText(at(2026, 9, 12, 23, 0, 0), now)).toBe('10 月 12 日編輯');
    expect(editedAgoText(at(2025, 11, 31, 12, 0, 0), now)).toBe('2025 年 12 月 31 日編輯');
  });

  it('日期壞掉 → 空字串（不顯示）', () => {
    expect(editedAgoText('not-a-date', now)).toBe('');
  });
});

describe('卡片庫的其他文字', () => {
  it('刪除確認框（DESIGN 7.2 原文）', () => {
    expect(deleteConfirmText('月夜')).toBe('刪掉「月夜」？刪掉後就找不回來了。');
  });

  it('張數', () => {
    expect(libraryCountText(0)).toBe('還沒有卡片');
    expect(libraryCountText(5)).toBe('共 5 張');
  });
});

describe('滑鼠移上去縮圖微微傾斜', () => {
  const rect = { left: 100, top: 200, width: 200, height: 300 };

  it('正中間 → 不傾斜', () => {
    expect(tiltFromPointer(200, 350, rect)).toEqual({ rx: 0, ry: 0, gx: 50, gy: 50 });
  });

  it('移到右上角：往右轉、上緣往後倒；光澤跟著跑到右上', () => {
    const t = tiltFromPointer(300, 200, rect);
    expect(t.ry).toBeGreaterThan(0);
    expect(t.rx).toBeGreaterThan(0);
    expect(t.gx).toBe(100);
    expect(t.gy).toBe(0);
  });

  it('角度有上限（微微傾斜），超出外框也夾住', () => {
    const t = tiltFromPointer(10_000, -10_000, rect);
    expect(Math.abs(t.rx)).toBeLessThanOrEqual(12);
    expect(Math.abs(t.ry)).toBeLessThanOrEqual(12);
    expect(t.gx).toBe(100);
    expect(t.gy).toBe(0);
  });

  it('外框是 0 大小 → 不傾斜', () => {
    expect(tiltFromPointer(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0, gx: 50, gy: 50 });
  });
});

describe('Esc：卡片庫、新卡片面板開著的時候', () => {
  const ctx = (c: Partial<Parameters<typeof escapeAction>[0]> = {}) => ({
    layerDragging: false,
    menuOpen: false,
    confirmOpen: false,
    typingInText: false,
    layerSelected: false,
    ...c,
  });

  it('面板開著：交給面板（關掉面板裡最上面的東西），不取消選取、不回答取代底圖', () => {
    expect(escapeAction(ctx({ panelOpen: true, layerSelected: true, confirmOpen: true }))).toBe('close-panel');
  });

  it('面板裡正在改名（打字）：不攔，讓輸入框自己取消', () => {
    expect(escapeAction(ctx({ panelOpen: true, typingInText: true }))).toBeNull();
  });

  it('沒有面板：照原本的順序', () => {
    expect(escapeAction(ctx({ panelOpen: false, layerSelected: true }))).toBe('deselect');
    expect(escapeAction(ctx({ menuOpen: true }))).toBe('close-menu');
  });

  it('按鍵事件的目標不是元素（例如直接發在 window 上）：當成不是在打字，不會出錯', () => {
    expect(isTextEntry({} as ElementLike)).toBe(false);
  });
});
