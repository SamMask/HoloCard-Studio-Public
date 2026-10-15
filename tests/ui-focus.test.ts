// 鍵盤焦點的小工具（T-607，DESIGN §8.2）：找出面板裡能拿焦點的控制項、Tab 循環、選單方向鍵、不鎖畫面的對話框開關時的焦點。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogFocus, focusableIn, focusEdge, menuArrowKeys, trapTab } from '../src/ui/focus';
import { FakeElement, FakeEvent, installFakeDom, keydown, type FakeDom } from './ui-fake-dom';

let dom: FakeDom;
const el = (tag: string, attrs: Record<string, string> = {}) => {
  const e = dom.document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const asHtml = (e: FakeElement) => e as unknown as HTMLElement;

beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('focusableIn：面板裡現在能用 Tab 走到的控制項', () => {
  it('按鈕、輸入框、滑桿、有 tabindex 的自訂元件，照畫面順序；普通的 div／span／圖示不算', () => {
    const root = el('div');
    const a = el('button');
    const wrap = el('div');
    const b = el('input', { type: 'range' });
    const row = el('div', { role: 'button', tabindex: '0' });
    wrap.append(b, el('span'), row);
    root.append(a, wrap, el('svg'));
    expect(focusableIn(asHtml(root))).toEqual([a, b, row]);
  });

  it('跳過：disabled、tabindex 小於 0（單選群組沒選中的、藏起來的選檔框）、隱藏的整棵、inert 的整棵', () => {
    const root = el('div');
    const ok = el('button');
    const off = el('button');
    off.disabled = true;
    const radioOff = el('button');
    radioOff.tabIndex = -1;
    const file = el('input', { type: 'file', tabindex: '-1' });
    const hiddenBox = el('div');
    hiddenBox.hidden = true;
    hiddenBox.append(el('button'));
    const inertBox = el('div');
    inertBox.inert = true;
    inertBox.append(el('button'));
    const hiddenInput = el('input', { type: 'hidden' });
    root.append(ok, off, radioOff, file, hiddenBox, inertBox, hiddenInput);
    expect(focusableIn(asHtml(root))).toEqual([ok]);
  });

  it('單選群組：只有選中的那顆（tabindex 0）算', () => {
    const root = el('div');
    const radios = [0, 1, 2].map((i) => {
      const r = el('button');
      r.tabIndex = i === 1 ? 0 : -1;
      return r;
    });
    root.append(...radios);
    expect(focusableIn(asHtml(root))).toEqual([radios[1]]);
  });

  it('focusEdge：第一個（或最後一個）拿到焦點；沒有就不動', () => {
    const root = el('div');
    const a = el('button');
    const b = el('button');
    root.append(a, b);
    expect(focusEdge(asHtml(root))).toBe(a);
    expect(dom.document.activeElement).toBe(a);
    focusEdge(asHtml(root), true);
    expect(dom.document.activeElement).toBe(b);
    const empty = el('div');
    expect(focusEdge(asHtml(empty))).toBeNull();
    expect(dom.document.activeElement).toBe(b);
  });
});

describe('trapTab：Tab 只在面板裡循環', () => {
  function panel() {
    const root = el('div');
    const a = el('button');
    const mid = el('input', { type: 'text' });
    const z = el('button');
    root.append(a, mid, z);
    trapTab(asHtml(root));
    return { root, a, mid, z };
  }

  it('Tab 往下一個、Shift+Tab 往上一個；最後一個 Tab 回第一個、第一個 Shift+Tab 到最後一個；都攔下瀏覽器預設', () => {
    const { a, mid, z } = panel();
    a.focus();
    expect(keydown(a, 'Tab').defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(mid);
    keydown(mid, 'Tab');
    expect(dom.document.activeElement).toBe(z);
    keydown(z, 'Tab');
    expect(dom.document.activeElement).toBe(a);
    keydown(a, 'Tab', { shiftKey: true });
    expect(dom.document.activeElement).toBe(z);
    keydown(z, 'Tab', { shiftKey: true });
    expect(dom.document.activeElement).toBe(mid);
  });

  it('焦點不在清單裡（例如在面板本身）：Tab 到第一個、Shift+Tab 到最後一個', () => {
    const { root, a, z } = panel();
    root.focus();
    keydown(root, 'Tab');
    expect(dom.document.activeElement).toBe(a);
    dom.document.activeElement = null;
    keydown(root, 'Tab', { shiftKey: true });
    expect(dom.document.activeElement).toBe(z);
  });

  it('其他按鍵、Ctrl／Alt／Cmd+Tab、輸入法選字中的 Tab 都不管', () => {
    const { a } = panel();
    a.focus();
    expect(keydown(a, 'Enter').defaultPrevented).toBe(false);
    expect(keydown(a, 'ArrowDown').defaultPrevented).toBe(false);
    expect(keydown(a, 'Tab', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown(a, 'Tab', { altKey: true }).defaultPrevented).toBe(false);
    expect(keydown(a, 'Tab', { isComposing: true }).defaultPrevented).toBe(false);
    expect(dom.document.activeElement).toBe(a);
  });

  it('面板裡的控制項會變（藏起來、disabled）：每次按 Tab 重新算', () => {
    const { a, mid, z } = panel();
    mid.disabled = true;
    a.focus();
    keydown(a, 'Tab');
    expect(dom.document.activeElement).toBe(z);
    z.hidden = true;
    keydown(a, 'Tab');
    expect(dom.document.activeElement).toBe(a);
  });

  it('只有一個控制項：Tab 停在原地；一個都沒有：只攔下 Tab', () => {
    const root = el('div');
    const only = el('button');
    root.append(only);
    trapTab(asHtml(root));
    only.focus();
    keydown(only, 'Tab');
    expect(dom.document.activeElement).toBe(only);
    const none = el('div');
    trapTab(asHtml(none));
    expect(keydown(none, 'Tab').defaultPrevented).toBe(true);
  });
});

describe('menuArrowKeys：選單的 ↑ ↓', () => {
  function menu() {
    const root = el('div');
    const items = ['a', 'b', 'c'].map(() => {
      const b = el('button');
      b.className = 'menu-item';
      return b;
    });
    root.append(...items);
    menuArrowKeys(asHtml(root));
    return { root, items };
  }

  it('↓ 往下、↑ 往上，到頭停住；Home／End 到頭尾', () => {
    const { items } = menu();
    items[0]!.focus();
    keydown(items[0], 'ArrowDown');
    expect(dom.document.activeElement).toBe(items[1]);
    keydown(items[1], 'ArrowDown');
    keydown(items[2], 'ArrowDown');
    expect(dom.document.activeElement).toBe(items[2]);
    keydown(items[2], 'ArrowUp');
    expect(dom.document.activeElement).toBe(items[1]);
    keydown(items[1], 'Home');
    expect(dom.document.activeElement).toBe(items[0]);
    keydown(items[0], 'ArrowUp');
    expect(dom.document.activeElement).toBe(items[0]);
    keydown(items[0], 'End');
    expect(dom.document.activeElement).toBe(items[2]);
  });

  it('Ctrl／Cmd／Alt＋↑ ↓、輸入法選字中、已經被處理過的：不移動、不攔（T-607c）', () => {
    const { items } = menu();
    items[0]!.focus();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      expect(keydown(items[0], 'ArrowDown', init).defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(keydown(items[0], 'End', init).defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    const handled = new FakeEvent('keydown', { key: 'ArrowDown' });
    handled.preventDefault();
    items[0]!.dispatchEvent(handled);
    expect(dom.document.activeElement).toBe(items[0]);
  });

  it('跳過 disabled 的選項；別的鍵不管', () => {
    const { items } = menu();
    items[1]!.disabled = true;
    items[0]!.focus();
    keydown(items[0], 'ArrowDown');
    expect(dom.document.activeElement).toBe(items[2]);
    expect(keydown(items[2], 'a').defaultPrevented).toBe(false);
    expect(keydown(items[2], 'Enter').defaultPrevented).toBe(false);
  });
});

describe('dialogFocus：不鎖畫面的對話框，打開時焦點進去、關掉時回到原本的地方', () => {
  function setup() {
    const opener = el('button');
    const box = el('div');
    const first = el('button');
    const second = el('button');
    box.append(first, second);
    const fallback = el('div');
    const focus = dialogFocus(asHtml(box), { fallback: () => asHtml(fallback) });
    return { opener, box, first, second, fallback, focus };
  }

  it('打開：焦點移到第一個控制項；關掉：焦點回到原本的按鈕', () => {
    const { opener, first, focus } = setup();
    opener.focus();
    focus.shown();
    expect(dom.document.activeElement).toBe(first);
    focus.hidden();
    expect(dom.document.activeElement).toBe(opener);
  });

  it('first 可以指定要哪一個拿焦點', () => {
    const opener = el('button');
    const box = el('div');
    const a = el('button');
    const b = el('button');
    box.append(a, b);
    const focus = dialogFocus(asHtml(box), { first: () => asHtml(b) });
    opener.focus();
    focus.shown();
    expect(dom.document.activeElement).toBe(b);
  });

  it('打開前焦點在頁面上沒有東西（body）：關掉時回到 fallback', () => {
    const { first, focus, fallback } = setup();
    focus.shown();
    expect(dom.document.activeElement).toBe(first);
    focus.hidden();
    expect(dom.document.activeElement).toBe(fallback);
  });

  it('正在打字（文字框有焦點）時不搶焦點；關掉時文字框仍在就不動', () => {
    const { first, focus } = setup();
    const typing = el('input', { type: 'text' });
    typing.focus();
    focus.shown();
    expect(dom.document.activeElement).toBe(typing);
    focus.hidden();
    expect(dom.document.activeElement).toBe(typing);
    expect(first).toBeTruthy();
  });

  it('關掉時焦點已經被使用者移去別的地方：不搶回來', () => {
    const { opener, focus } = setup();
    opener.focus();
    focus.shown();
    const elsewhere = el('button');
    elsewhere.focus();
    focus.hidden();
    expect(dom.document.activeElement).toBe(elsewhere);
  });

  it('原本的按鈕不見了（被拿掉、被藏起來）：改給 fallback', () => {
    const { opener, focus, fallback } = setup();
    opener.focus();
    focus.shown();
    opener.hidden = true;
    focus.hidden();
    expect(dom.document.activeElement).toBe(fallback);
    const parent = el('div');
    const gone = el('button');
    parent.append(gone);
    gone.focus();
    focus.shown();
    gone.remove();
    focus.hidden();
    expect(dom.document.activeElement).toBe(fallback);
  });

  it('原本的按鈕在一個被藏起來的面板裡（按鈕自己沒有 hidden，祖先有）：改給 fallback（T-607b）', () => {
    const { focus, fallback } = setup();
    const panel = el('aside');
    const inside = el('button');
    panel.append(inside);
    inside.focus();
    focus.shown();
    panel.hidden = true;
    focus.hidden();
    expect(dom.document.activeElement).toBe(fallback);
  });

  it('原本的按鈕在 inert 的面板裡：改給 fallback', () => {
    const { focus, fallback } = setup();
    const panel = el('div');
    const inside = el('button');
    panel.append(inside);
    inside.focus();
    focus.shown();
    panel.inert = true;
    focus.hidden();
    expect(dom.document.activeElement).toBe(fallback);
  });

  it('重複 shown／hidden 不會亂：打開中再 shown 不改回去的目標；沒開著的 hidden 不做事', () => {
    const { opener, first, focus } = setup();
    focus.hidden();
    opener.focus();
    focus.shown();
    first.focus();
    focus.shown();
    focus.hidden();
    expect(dom.document.activeElement).toBe(opener);
  });
});

describe('假 DOM 的焦點（測試工具，T-607c）：和真的瀏覽器一樣發事件、拿掉含焦點的元素時焦點回到 body', () => {
  it('focus()：舊的發 blur（不往上傳）＋focusout（往上傳，relatedTarget＝新的）；新的發 focus＋focusin（relatedTarget＝舊的）', () => {
    const root = el('div');
    const a = el('button');
    const b = el('button');
    root.append(a, b);
    const log: string[] = [];
    for (const [name, node] of [['a', a], ['b', b], ['root', root]] as const) {
      for (const type of ['focus', 'blur', 'focusin', 'focusout']) {
        node.addEventListener(type, (e) => log.push(`${name}:${type}:${e.target === a ? 'a' : 'b'}:${e.relatedTarget === a ? 'a' : e.relatedTarget === b ? 'b' : '-'}`));
      }
    }
    a.focus();
    expect(log).toEqual(['a:focus:a:-', 'a:focusin:a:-', 'root:focusin:a:-']);
    log.length = 0;
    b.focus();
    expect(log).toEqual(['a:blur:a:b', 'a:focusout:a:b', 'root:focusout:a:b', 'b:focus:b:a', 'b:focusin:b:a', 'root:focusin:b:a']);
    log.length = 0;
    b.focus();
    expect(log).toEqual([]);
  });

  it('blur()：焦點回到 body，發 blur＋focusout（relatedTarget 是空的）；不是焦點的元素 blur 不做事', () => {
    const a = el('button');
    const b = el('button');
    const log: string[] = [];
    a.addEventListener('blur', () => log.push('blur'));
    a.addEventListener('focusout', (e) => log.push(`focusout:${e.relatedTarget === null}`));
    a.focus();
    b.blur();
    expect(dom.document.activeElement).toBe(a);
    a.blur();
    expect(dom.document.activeElement).toBe(dom.document.body);
    expect(log).toEqual(['blur', 'focusout:true']);
  });

  it('拿掉含焦點的元素（自己或祖先被 remove、被清空、被換掉）：焦點回到 body', () => {
    const root = el('div');
    const wrap = el('div');
    const a = el('button');
    wrap.append(a);
    root.append(wrap);
    a.focus();
    wrap.remove();
    expect(dom.document.activeElement).toBe(dom.document.body);

    const b = el('button');
    root.append(b);
    b.focus();
    root.textContent = '';
    expect(dom.document.activeElement).toBe(dom.document.body);

    const c = el('button');
    root.append(c);
    c.focus();
    c.replaceWith(el('span'));
    expect(dom.document.activeElement).toBe(dom.document.body);

    // 拿掉的不是焦點所在：不動
    const d = el('button');
    const other = el('button');
    root.append(d, other);
    d.focus();
    other.remove();
    expect(dom.document.activeElement).toBe(d);
  });
});
