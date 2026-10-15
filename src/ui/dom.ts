// 小型 DOM 工具：只用 createElement／textContent／setAttribute，不用 innerHTML（硬邊界 4）。

export type Child = Node | string | null | undefined | false;

export interface ElOptions {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
}

/** 建一個元素；字串子元素一律當純文字。 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.title !== undefined) el.title = opts.title;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** 普通按鈕（type=button，避免在表單裡誤送出）。 */
export function button(className: string, children: readonly Child[], title?: string): HTMLButtonElement {
  const b = h('button', { className, attrs: { type: 'button' }, ...(title ? { title } : {}) }, children);
  return b;
}

/** 有變才寫，避免不必要的重排。 */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggleClass(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}
