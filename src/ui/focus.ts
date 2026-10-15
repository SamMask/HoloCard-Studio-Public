// 鍵盤焦點的小工具（DESIGN §8.2，T-607）：找出面板裡能拿焦點的控制項、讓 Tab 在面板裡循環。
// 純 DOM 走訪（不用 querySelectorAll 的選擇器），所以測試用的假 DOM 也能跑；顯示文字不在這裡。

import { isTextEntry, nextTabStop, plainKey, type ElementLike } from './logic';

const NATIVE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

function isFocusable(el: HTMLElement): boolean {
  const tag = (el.tagName ?? '').toUpperCase();
  if ((el as HTMLButtonElement).disabled) return false;
  if (typeof el.tabIndex === 'number' && el.tabIndex < 0) return false;
  if (tag === 'INPUT' && (el as HTMLInputElement).type === 'hidden') return false;
  if (NATIVE.has(tag)) return true;
  // 自訂元件（role=button 的列…）要自己寫了 tabindex 才算
  return el.getAttribute('tabindex') !== null;
}

/** 這個元素沒畫出來（display:none 之類，真的瀏覽器才有 getClientRects）。 */
function notRendered(el: HTMLElement): boolean {
  return typeof el.getClientRects === 'function' && el.getClientRects().length === 0;
}

/**
 * root 裡現在能用 Tab 走到的控制項（照畫面順序）：跳過 hidden、inert（整棵）、disabled、tabindex 小於 0 的（單選群組只剩選中的那個）、
 * 沒畫出來的。root 自己不算。
 */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (parent: HTMLElement) => {
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.hidden || child.inert) continue;
      if (isFocusable(child) && !notRendered(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/** 第一個（或最後一個）能拿焦點的控制項拿焦點；沒有就不做事。回傳拿到焦點的那個。 */
export function focusEdge(root: HTMLElement, last = false): HTMLElement | null {
  const items = focusableIn(root);
  const target = last ? items[items.length - 1] : items[0];
  target?.focus({ preventScroll: true });
  return target ?? null;
}

/**
 * 面板裡按 Tab 不跑出去：最後一個再 Tab 回第一個，Shift+Tab 反過來。掛在面板的最外層，
 * 只管焦點在面板裡的 Tab（焦點在別處時，由面板自己開啟時把焦點移進來）。Ctrl／Alt／Cmd 的組合不管。
 */
export function trapTab(root: HTMLElement): void {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !plainKey(e)) return;
    const items = focusableIn(root);
    const next = nextTabStop(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    e.preventDefault();
    if (next >= 0) items[next]!.focus({ preventScroll: true });
  });
}

/**
 * 選單（role=menu）的方向鍵：↑ ↓ 在選項之間移動、Home／End 到頭尾（到頭停住）。選項是 menu 裡的按鈕。
 * 組合鍵、輸入法選字中、已經被處理過的不管（T-607c）。
 */
export function menuArrowKeys(menu: HTMLElement, selector = '.menu-item'): void {
  menu.addEventListener('keydown', (e) => {
    if (!plainKey(e)) return;
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? -1 : null;
    if (step === 0 && edge === null) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>(selector)).filter((i) => !(i as HTMLButtonElement).disabled && !i.hidden);
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = edge !== null ? (edge === 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at < 0 ? (step > 0 ? 0 : items.length - 1) : at + step));
    items[to]!.focus({ preventScroll: true });
  });
}

export interface DialogFocus {
  /** 對話框剛顯示：記下焦點本來在哪，把焦點移進第一個控制項（正在打字就不搶）。已經顯示著不做事。 */
  shown(): void;
  /** 對話框剛收起：焦點還在裡面（或掉到頁面最前面）就還給原本的地方，原本的地方沒了就給 fallback。 */
  hidden(): void;
}

/** 這個元素現在能拿焦點：還接在頁面上、自己和祖先都沒有 hidden／inert。 */
function usable(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  for (let n: HTMLElement | null = el; n; n = n.parentNode as HTMLElement | null) if (n.hidden || n.inert) return false;
  return true;
}

/**
 * 不鎖住畫面的對話框（預覽區下方的確認框、AI 的問題）開關時的焦點（DESIGN §8.2）：
 * 打開 → 焦點移到第一個控制項；關掉 → 焦點回到打開它之前的地方。root 要自己 trapTab。
 * first＝要拿焦點的控制項（預設是 root 裡第一個能拿焦點的）。
 */
export function dialogFocus(
  root: HTMLElement,
  options: { first?: () => HTMLElement | null; fallback?: () => HTMLElement | null } = {},
): DialogFocus {
  let open = false;
  let returnTo: HTMLElement | null = null;
  const body = () => document.body as HTMLElement | null;
  return {
    shown() {
      if (open) return;
      open = true;
      const active = document.activeElement as HTMLElement | null;
      returnTo = active && active !== body() && !root.contains(active) ? active : null;
      // 正在打字（改圖層名字、卡名…）不搶焦點；Tab 進來時再由 trapTab 接手
      if (isTextEntry(active as ElementLike | null)) return;
      (options.first?.() ?? focusableIn(root)[0])?.focus({ preventScroll: true });
    },
    hidden() {
      if (!open) return;
      open = false;
      const active = document.activeElement as HTMLElement | null;
      const stillHere = !active || active === body() || root.contains(active);
      const target = usable(returnTo) ? returnTo : (options.fallback?.() ?? null);
      returnTo = null;
      if (stillHere) target?.focus({ preventScroll: true });
    },
  };
}
