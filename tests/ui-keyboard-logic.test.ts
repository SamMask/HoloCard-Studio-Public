// 鍵盤操作的純邏輯（T-607，DESIGN §8.2）：面板裡 Tab 循環、單選群組的方向鍵、圖層清單的方向鍵／Enter／空白鍵、Delete 鍵、說明面板的按鍵表。
import { describe, expect, it } from 'vitest';
import {
  deleteKeyWanted,
  HELP_KEYS,
  layerRowKey,
  listStep,
  nextTabStop,
  plainKey,
  radioStep,
} from '../src/ui/logic';

describe('plainKey：鍵盤操作只收「單按」的鍵（T-607c）', () => {
  const key = (extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; defaultPrevented: boolean }> = {}) => ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });

  it('沒有 Ctrl／Cmd／Alt、不是輸入法選字中、沒被別人處理過 → true；Shift 可以（Shift＝大步／小步）', () => {
    expect(plainKey(key())).toBe(true);
    expect(plainKey(key({ shiftKey: true }))).toBe(true);
    expect(plainKey(key({ isComposing: false, defaultPrevented: false }))).toBe(true);
  });

  it('帶 Ctrl／Cmd／Alt（Ctrl+→ 跳字、Alt+← 上一頁…）、輸入法選字中、已經 preventDefault 的 → false', () => {
    expect(plainKey(key({ ctrlKey: true }))).toBe(false);
    expect(plainKey(key({ metaKey: true }))).toBe(false);
    expect(plainKey(key({ altKey: true }))).toBe(false);
    expect(plainKey(key({ isComposing: true }))).toBe(false);
    expect(plainKey(key({ defaultPrevented: true }))).toBe(false);
  });
});

describe('nextTabStop：面板裡 Tab 循環', () => {
  it('Tab 往後一個、Shift+Tab 往前一個；到頭繞回另一頭', () => {
    expect(nextTabStop(4, 0, false)).toBe(1);
    expect(nextTabStop(4, 2, false)).toBe(3);
    expect(nextTabStop(4, 3, false)).toBe(0);
    expect(nextTabStop(4, 3, true)).toBe(2);
    expect(nextTabStop(4, 0, true)).toBe(3);
  });

  it('焦點不在清單裡（-1，例如在面板本身或剛打開）：Tab 到第一個、Shift+Tab 到最後一個', () => {
    expect(nextTabStop(3, -1, false)).toBe(0);
    expect(nextTabStop(3, -1, true)).toBe(2);
    expect(nextTabStop(3, 9, false)).toBe(0);
  });

  it('只有一個控制項：停在原地（Tab 不跑出面板）', () => {
    expect(nextTabStop(1, 0, false)).toBe(0);
    expect(nextTabStop(1, 0, true)).toBe(0);
  });

  it('一個控制項都沒有：-1（呼叫端只攔下 Tab）', () => {
    expect(nextTabStop(0, -1, false)).toBe(-1);
  });
});

describe('radioStep：單選群組的方向鍵（到頭停住不繞回）', () => {
  it('→ ↓ 往後一個、← ↑ 往前一個', () => {
    expect(radioStep('ArrowRight', 1, 4)).toBe(2);
    expect(radioStep('ArrowDown', 1, 4)).toBe(2);
    expect(radioStep('ArrowLeft', 1, 4)).toBe(0);
    expect(radioStep('ArrowUp', 1, 4)).toBe(0);
  });

  it('到頭停住，不繞回', () => {
    expect(radioStep('ArrowRight', 3, 4)).toBe(3);
    expect(radioStep('ArrowDown', 3, 4)).toBe(3);
    expect(radioStep('ArrowLeft', 0, 4)).toBe(0);
    expect(radioStep('ArrowUp', 0, 4)).toBe(0);
  });

  it('跳過不能選的（disabled）；後面全都不能選就停在原地', () => {
    const off = (i: number) => i === 1 || i === 2;
    expect(radioStep('ArrowRight', 0, 4, off)).toBe(3);
    expect(radioStep('ArrowLeft', 3, 4, off)).toBe(0);
    expect(radioStep('ArrowRight', 3, 4, off)).toBe(3);
    expect(radioStep('ArrowRight', 0, 3, off)).toBe(0);
  });

  it('不是方向鍵 → null（讓別的處理，例如 Tab、Enter、字母）', () => {
    for (const k of ['Tab', 'Enter', ' ', 'a', 'Home', 'Escape']) expect(radioStep(k, 1, 4)).toBeNull();
  });
});

describe('listStep：圖層清單的 ↑ ↓（Home／End 到頭尾，到頭停住）', () => {
  it('↓ 往下一個、↑ 往上一個，到頭停住', () => {
    expect(listStep('ArrowDown', 0, 3)).toBe(1);
    expect(listStep('ArrowDown', 2, 3)).toBe(2);
    expect(listStep('ArrowUp', 2, 3)).toBe(1);
    expect(listStep('ArrowUp', 0, 3)).toBe(0);
  });

  it('Home 回第一個、End 到最後一個；不認得的鍵 null；焦點不在清單（-1）按 ↓ 到第一個', () => {
    expect(listStep('Home', 2, 3)).toBe(0);
    expect(listStep('End', 0, 3)).toBe(2);
    expect(listStep('ArrowLeft', 1, 3)).toBeNull();
    expect(listStep('a', 1, 3)).toBeNull();
    expect(listStep('ArrowDown', -1, 3)).toBe(0);
    expect(listStep('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('layerRowKey：圖層那一列上的 Enter／空白鍵', () => {
  it('Enter 選中、空白鍵切換顯示（眼睛）、其他不管', () => {
    expect(layerRowKey('Enter')).toBe('select');
    expect(layerRowKey(' ')).toBe('toggle-visible');
    expect(layerRowKey('Spacebar')).toBe('toggle-visible');
    for (const k of ['a', 'Delete', 'Tab', 'ArrowDown']) expect(layerRowKey(k)).toBeNull();
  });
});

describe('Delete 鍵（預覽區選中圖層時）', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });

  it('選中可以刪的圖層時 Delete（Mac 沒有 Delete 鍵，Backspace 也算）→ 要刪', () => {
    expect(deleteKeyWanted(key('Delete'), true)).toBe(true);
    expect(deleteKeyWanted(key('Backspace'), true)).toBe(true);
  });

  it('沒選圖層（或選著反光層）不管；帶 Ctrl／Alt／Cmd 的不管；輸入法選字中不管', () => {
    expect(deleteKeyWanted(key('Delete'), false)).toBe(false);
    expect(deleteKeyWanted(key('Delete', { ctrlKey: true }), true)).toBe(false);
    expect(deleteKeyWanted(key('Delete', { altKey: true }), true)).toBe(false);
    expect(deleteKeyWanted(key('Delete', { metaKey: true }), true)).toBe(false);
    expect(deleteKeyWanted(key('Delete', { isComposing: true }), true)).toBe(false);
    expect(deleteKeyWanted({ ...key('Delete'), defaultPrevented: true }, true)).toBe(false);
    expect(deleteKeyWanted(key('x'), true)).toBe(false);
  });
});

describe('說明面板的鍵盤表（T-607 做完，沒有「之後才有」）', () => {
  it('每一列都已經能用：沒有 soon 標記', () => {
    expect(HELP_KEYS.length).toBeGreaterThanOrEqual(8);
    for (const k of HELP_KEYS) expect('soon' in k, k.text).toBe(false);
  });

  it('Delete 的說明：直接刪、可以復原（沒有確認框）', () => {
    const row = HELP_KEYS.find((k) => k.keys.includes('Delete'))!;
    expect(row.text).toContain('復原');
    expect(row.text).not.toContain('先問');
  });

  it('列出 8.2 的按鍵：Tab、方向鍵、Home、PageUp／PageDown、+ −、F、Delete、圖層清單的 ↑ ↓ Enter 空白鍵', () => {
    const text = HELP_KEYS.map((k) => `${k.keys.join(' ')} ${k.text}`).join('\n');
    for (const need of ['Tab', '←', '→', '↑', '↓', 'Home', 'PageUp', 'PageDown', '+', 'F', 'Delete', 'Enter', '空白鍵']) expect(text).toContain(need);
  });
});
