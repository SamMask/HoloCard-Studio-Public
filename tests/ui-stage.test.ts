import { describe, expect, it } from 'vitest';
import type { Card, Layer } from '../src/model/types';
import { stageBackdrop } from '../src/ui/logic';

function layer(id: string, role: Layer['role'], image: string, visible = true): Layer {
  return {
    id,
    name: id,
    role,
    image,
    visible,
    depth: role === 'base' ? 0 : 50,
    x: 0,
    y: 0,
    scale: 1,
    holo: false,
    hasAlpha: role !== 'base',
  };
}

const card = (front: Layer[], back: Layer[] = []): Pick<Card, 'front' | 'back'> => ({ front: { layers: front }, back: { layers: back } });

describe('舞台背景用哪張圖（DESIGN §5：目前這張卡正面底圖）', () => {
  it('正面有底圖：用底圖的雜湊', () => {
    expect(stageBackdrop(card([layer('bg', 'base', 'aaaa'), layer('hero', 'depth', 'bbbb')]))).toBe('aaaa');
  });

  it('底圖不在陣列第一個也找得到', () => {
    expect(stageBackdrop(card([layer('hero', 'depth', 'bbbb'), layer('bg', 'base', 'cccc')]))).toBe('cccc');
  });

  it('正面沒有底圖（只有立體層或空白卡）：null（用深藍漸層）', () => {
    expect(stageBackdrop(card([layer('hero', 'depth', 'bbbb')]))).toBeNull();
    expect(stageBackdrop(card([]))).toBeNull();
  });

  it('只看正面：背面有底圖、正面沒有 → null', () => {
    expect(stageBackdrop(card([], [layer('back-bg', 'base', 'dddd')]))).toBeNull();
  });

  it('底圖被隱藏：null（舞台跟著卡片看到的樣子）', () => {
    expect(stageBackdrop(card([layer('bg', 'base', 'aaaa', false)]))).toBeNull();
  });
});
