// attachPointer 的「點一下」判斷接線（T-309）：轉卡的按下 → 放開，沒拖、很快 → 呼叫 click；
// 其他（拖了、按太久、按在選取框內、被取消）不呼叫。node 環境沒有 DOM，用最小的假元素與事件。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPointer, type LayerDrag, type PointerHandlers } from '../src/interact/pointer';

class FakeEl extends EventTarget {
  captured = new Set<number>();
  classes = new Set<string>();
  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
  };
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
}

function pointerEvent(type: string, x: number, y: number, t: number, id = 1): Event {
  const ev = new Event(type, { cancelable: true });
  Object.defineProperty(ev, 'timeStamp', { value: t });
  return Object.assign(ev, { button: 0, pointerId: id, clientX: x, clientY: y });
}

function keyEvent(key: string): Event {
  return Object.assign(new Event('keydown', { cancelable: true }), { key });
}

interface Rig {
  el: FakeEl;
  win: EventTarget;
  calls: string[];
  /** 每次 click 帶的座標。 */
  clickAt: { x: number; y: number }[];
  down(x: number, y: number, t: number): void;
  move(x: number, y: number, t: number): void;
  up(x: number, y: number, t: number): void;
  cancel(x: number, y: number, t: number): void;
}

function rig(press?: PointerHandlers['press']): Rig {
  const el = new FakeEl();
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const calls: string[] = [];
  const clickAt: { x: number; y: number }[] = [];
  attachPointer(el as unknown as HTMLElement, {
    press,
    dragStart: () => calls.push('dragStart'),
    drag: () => calls.push('drag'),
    dragEnd: () => calls.push('dragEnd'),
    click: (x, y) => {
      calls.push('click');
      clickAt.push({ x, y });
    },
    wheel: () => {},
  });
  const send = (type: string) => (x: number, y: number, t: number) => void el.dispatchEvent(pointerEvent(type, x, y, t));
  return { el, win, calls, clickAt, down: send('pointerdown'), move: send('pointermove'), up: send('pointerup'), cancel: send('pointercancel') };
}

const clicks = (r: Rig) => r.calls.filter((c) => c === 'click').length;

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('轉卡的按下：沒拖、很快放開＝點一下', () => {
  it('原地按下放開：呼叫一次 click；轉卡的 dragStart／dragEnd 照舊', () => {
    const r = rig();
    r.down(100, 100, 1000);
    r.up(100, 100, 1080);
    expect(clicks(r)).toBe(1);
    expect(r.calls).toEqual(['dragStart', 'dragEnd', 'click']);
  });

  it('按下去的位置不在選取框內（press 回傳 null）一樣是點一下', () => {
    const r = rig(() => null);
    r.down(10, 10, 0);
    r.up(11, 10, 100);
    expect(clicks(r)).toBe(1);
  });

  it('click 帶按下那一點的螢幕座標（T-411：點卡外的破框層用）', () => {
    const r = rig();
    r.down(120, 80, 0);
    r.move(122, 81, 30);
    r.up(122, 81, 60);
    expect(r.clickAt).toEqual([{ x: 120, y: 80 }]);
  });

  it('手抖 3 像素還算點一下', () => {
    const r = rig();
    r.down(100, 100, 0);
    r.move(103, 100, 40);
    r.up(103, 100, 90);
    expect(clicks(r)).toBe(1);
  });

  it('拖動超過 4 像素（轉卡）：不算點一下', () => {
    const r = rig();
    r.down(100, 100, 0);
    r.move(130, 100, 50);
    r.up(130, 100, 100);
    expect(clicks(r)).toBe(0);
    expect(r.calls).toContain('drag');
  });

  it('拖出去又拖回原位也不算（中途動過就是轉卡）', () => {
    const r = rig();
    r.down(100, 100, 0);
    r.move(160, 100, 50);
    r.move(100, 100, 100);
    r.up(100, 100, 150);
    expect(clicks(r)).toBe(0);
  });

  it('按太久（超過 300 毫秒）不算', () => {
    const r = rig();
    r.down(100, 100, 0);
    r.up(100, 100, 600);
    expect(clicks(r)).toBe(0);
  });

  it('指標被取消（pointercancel）不算', () => {
    const r = rig();
    r.down(100, 100, 0);
    r.cancel(100, 100, 50);
    expect(clicks(r)).toBe(0);
  });

  it('連續點兩下：各算一次', () => {
    const r = rig();
    r.down(100, 100, 0);
    r.up(100, 100, 50);
    r.down(100, 100, 200);
    r.up(100, 100, 250);
    expect(clicks(r)).toBe(2);
  });

  it('沒給 click 處理也不會壞', () => {
    const el = new FakeEl();
    vi.stubGlobal('window', new EventTarget());
    attachPointer(el as unknown as HTMLElement, { dragStart() {}, drag() {}, dragEnd() {}, wheel() {} });
    el.dispatchEvent(pointerEvent('pointerdown', 1, 1, 0));
    expect(() => el.dispatchEvent(pointerEvent('pointerup', 1, 1, 10))).not.toThrow();
  });
});

describe('圖層拖曳（按在選取框內或把手）：不算點一下', () => {
  const layerDrag = (log: string[]): LayerDrag => ({
    move: () => log.push('move'),
    end: () => log.push('end'),
    cancel: () => log.push('cancel'),
  });

  it('按在框內、沒拖就放開：結束這次拖曳，不呼叫 click（選取留著）', () => {
    const log: string[] = [];
    const r = rig(() => layerDrag(log));
    r.down(100, 100, 0);
    r.up(100, 100, 50);
    expect(log).toEqual(['end']);
    expect(clicks(r)).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it('拖動中 Esc：取消這次拖曳（不呼叫 click、事件被攔下不再往外傳）', () => {
    const log: string[] = [];
    const r = rig(() => layerDrag(log));
    r.down(100, 100, 0);
    r.move(150, 120, 30);
    const esc = keyEvent('Escape');
    r.win.dispatchEvent(esc);
    expect(log).toEqual(['move', 'cancel']);
    expect(esc.defaultPrevented).toBe(true);
    // 之後放開不再重複處理
    r.up(150, 120, 80);
    expect(log).toEqual(['move', 'cancel']);
    expect(clicks(r)).toBe(0);
  });

  it('沒在拖曳時的 Esc：這裡不攔（交給畫面的 Esc 處理）', () => {
    const r = rig(() => null);
    const esc = keyEvent('Escape');
    r.win.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });
});
