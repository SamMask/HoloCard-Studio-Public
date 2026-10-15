// 測試用的極簡 DOM（T-512）：vitest 跑在 node（沒有 jsdom），這裡只做 ui 面板用到的那一點點，
// 讓 createVideoOptions／createGifOptions／createExportPanel／createLayerPanel 真的跑起來（建元素、按按鈕、打字、Esc）。
// 用 installFakeDom() 裝進 globalThis（vi.stubGlobal），測完 vi.unstubAllGlobals()。
// 焦點（T-607c）：focus()／blur() 和真的瀏覽器一樣發 blur、focusout（往上傳）、focus、focusin（往上傳）；
// blur() 或拿掉含焦點的元素（remove、清空 textContent、replaceWith）後焦點回到 body（拿掉時不發事件，同規格）。

import { vi } from 'vitest';

type Listener = (e: FakeEvent) => void;

export interface FakeEventInit {
  bubbles?: boolean;
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  relatedTarget?: FakeNode | null;
}

export class FakeEvent {
  readonly type: string;
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  readonly bubbles: boolean;
  key?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  /** focusout 用：焦點接下來去哪（沒有＝離開頁面）。 */
  relatedTarget: FakeNode | null;
  constructor(type: string, init: FakeEventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    if (init.key !== undefined) this.key = init.key;
    this.shiftKey = init.shiftKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.altKey = init.altKey ?? false;
    this.repeat = init.repeat ?? false;
    this.isComposing = init.isComposing ?? false;
    this.relatedTarget = init.relatedTarget ?? null;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
}

class FakeEventTarget {
  readonly listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener, options?: { once?: boolean } | boolean) {
    const once = typeof options === 'object' && options?.once;
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    if (once) {
      const wrapped: Listener = (e) => {
        set!.delete(wrapped);
        fn(e);
      };
      set.add(wrapped);
    } else {
      set.add(fn);
    }
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** 只在自己身上觸發（不往上傳）。 */
  fire(e: FakeEvent) {
    for (const fn of [...(this.listeners.get(e.type) ?? [])]) fn(e);
  }
}

/** 這個節點（或它裡面）有焦點，而且要被拿掉了：焦點回到 body（同真的瀏覽器的 focus fixup，不發事件）。 */
function dropFocusFrom(node: FakeNode) {
  const doc = current;
  if (!doc) return;
  for (let n: FakeNode | null = doc.activeElement; n; n = n.parentNode) {
    if (n === node) {
      doc.activeElement = doc.body;
      return;
    }
  }
}

export class FakeNode extends FakeEventTarget {
  parentNode: FakeElement | null = null;
  /** 同真的 DOM 的 isConnected：建出來就算接著，被 remove() 拿掉就不是了（假 DOM 沒有 document 樹）。 */
  isConnected = true;
  get textContent(): string {
    return '';
  }
  remove() {
    if (!this.parentNode) return;
    dropFocusFrom(this);
    const list = this.parentNode.childNodes;
    list.splice(list.indexOf(this), 1);
    this.parentNode = null;
    this.isConnected = false;
  }
}

class FakeText extends FakeNode {
  constructor(private text: string) {
    super();
  }
  override get textContent(): string {
    return this.text;
  }
}

class FakeClassList {
  constructor(private owner: FakeElement) {}
  private get set() {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean));
  }
  contains(name: string) {
    return this.set.has(name);
  }
  add(...names: string[]) {
    const s = this.set;
    for (const n of names) s.add(n);
    this.owner.className = [...s].join(' ');
  }
  remove(...names: string[]) {
    const s = this.set;
    for (const n of names) s.delete(n);
    this.owner.className = [...s].join(' ');
  }
  toggle(name: string, force?: boolean) {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList(this);
  readonly dataset: Record<string, string> = {};
  readonly style = {
    props: new Map<string, string>(),
    setProperty(name: string, value: string) {
      this.props.set(name, value);
    },
    removeProperty(name: string) {
      this.props.delete(name);
    },
    getPropertyValue(name: string) {
      return this.props.get(name) ?? '';
    },
  } as {
    props: Map<string, string>;
    setProperty(n: string, v: string): void;
    removeProperty(n: string): void;
    getPropertyValue(n: string): string;
  } & Record<string, unknown>;
  className = '';
  hidden = false;
  disabled = false;
  inert = false;
  title = '';
  value = '';
  min = '';
  max = '';
  type = '';
  files: unknown[] | null = null;

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }

  /** 同真的 DOM：按鈕、輸入框預設 0，其他元素預設 -1；有 tabindex 屬性就照屬性（T-607）。 */
  get tabIndex(): number {
    const attr = this.attributes.get('tabindex');
    if (attr !== undefined) return Number(attr);
    return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(this.tagName) ? 0 : -1;
  }
  set tabIndex(value: number) {
    this.attributes.set('tabindex', String(value));
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  override set textContent(text: string) {
    for (const n of this.childNodes) dropFocusFrom(n);
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes.length = 0;
    if (text !== '') this.append(text);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === 'type') this.type = String(value);
    if (name === 'min') this.min = String(value);
    if (name === 'max') this.max = String(value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  private adopt(child: FakeNode | string): FakeNode {
    const node = typeof child === 'string' ? new FakeText(child) : child;
    node.remove();
    node.parentNode = this;
    node.isConnected = true;
    return node;
  }
  append(...children: (FakeNode | string)[]) {
    for (const c of children) this.childNodes.push(this.adopt(c));
  }
  insertBefore(node: FakeNode, ref: FakeNode | null) {
    this.adopt(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  prepend(...children: (FakeNode | string)[]) {
    this.childNodes.unshift(...children.map((c) => this.adopt(c)));
  }
  /** 輸入框的全選（假的 DOM 沒有選取範圍，什麼都不做）。 */
  select() {}
  /** 同真的 DOM 的 after：放在自己後面（同一個父元素裡）。 */
  after(node: FakeNode) {
    const parent = this.parentNode;
    if (!parent) return;
    parent.insertBefore(node, parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null);
  }
  replaceChildren(...children: (FakeNode | string)[]) {
    this.textContent = '';
    this.append(...children);
  }
  replaceWith(next: FakeNode) {
    const parent = this.parentNode;
    if (!parent) return;
    dropFocusFrom(this);
    const i = parent.childNodes.indexOf(this);
    next.remove();
    next.parentNode = parent;
    parent.childNodes.splice(i, 1, next);
    this.parentNode = null;
  }
  contains(node: FakeNode | null): boolean {
    for (let n: FakeNode | null = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  /** 自己或最近的祖先符合 selector（同 querySelector 的寫法）。 */
  closest(selector: string): FakeElement | null {
    const [tag, ...classes] = selector.split('.');
    for (let n: FakeElement | null = this; n; n = n.parentNode) {
      if ((!tag || n.tagName === tag.toUpperCase()) && classes.every((k) => n!.classList.contains(k))) return n;
    }
    return null;
  }

  /** 支援 'tag'、'.class'、'tag.class'（ui 只用到 svg.icon），後面可以加 ':not(:disabled)'（選單打開時找第一個能按的選項）。 */
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const enabledOnly = selector.endsWith(':not(:disabled)');
    const [tag, ...classes] = selector.replace(':not(:disabled)', '').split('.');
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if ((!tag || c.tagName === tag.toUpperCase()) && classes.every((k) => c.classList.contains(k)) && !(enabledOnly && c.disabled)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  /** 從自己往上傳（bubbles）。 */
  dispatchEvent(e: FakeEvent): boolean {
    e.target = this;
    for (let n: FakeNode | null = this; n; n = n.parentNode) {
      e.currentTarget = n;
      n.fire(e);
      if (!e.bubbles || e.propagationStopped) break;
    }
    return !e.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click'));
  }
  /** 同真的瀏覽器：舊的發 blur＋focusout（relatedTarget＝新的），新的發 focus＋focusin（relatedTarget＝舊的）；已經有焦點就不做事。 */
  focus() {
    if (this.disabled || this.isInert()) return;
    const doc = fakeDocument();
    const old = doc.activeElement;
    if (old === this) return;
    const from = old === doc.body ? null : old;
    if (from) {
      from.dispatchEvent(new FakeEvent('blur', { bubbles: false, relatedTarget: this }));
      from.dispatchEvent(new FakeEvent('focusout', { relatedTarget: this }));
    }
    doc.activeElement = this;
    this.dispatchEvent(new FakeEvent('focus', { bubbles: false, relatedTarget: from }));
    this.dispatchEvent(new FakeEvent('focusin', { relatedTarget: from }));
  }
  /** 有焦點才做事：焦點回到 body，發 blur＋focusout（relatedTarget 是空的）。 */
  blur() {
    const doc = fakeDocument();
    if (doc.activeElement !== this) return;
    doc.activeElement = doc.body;
    this.dispatchEvent(new FakeEvent('blur', { bubbles: false }));
    this.dispatchEvent(new FakeEvent('focusout'));
  }
  /** 自己或祖先 inert／hidden：不能拿焦點。 */
  isInert(): boolean {
    for (let n: FakeElement | null = this; n; n = n.parentNode) if (n.inert) return true;
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
  }
}

/** <audio>：試聽用；load／play／pause 只改狀態，測試自己觸發 loadedmetadata／error。 */
export class FakeAudio extends FakeElement {
  paused = true;
  readyState = 0;
  currentTime = 0;
  preload = '';
  error: unknown = null;
  private source = '';
  plays = 0;
  constructor() {
    super('audio');
  }
  get src() {
    return this.source;
  }
  set src(v: string) {
    this.source = v;
    this.readyState = 0;
  }
  override removeAttribute(name: string) {
    super.removeAttribute(name);
    if (name === 'src') this.source = '';
  }
  load() {
    this.readyState = 0;
  }
  async play() {
    this.plays++;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

interface FakeDocument {
  activeElement: FakeElement | null;
  body: FakeElement;
  createElement(tag: string): FakeElement;
  createElementNS(ns: string, tag: string): FakeElement;
}

let current: FakeDocument | null = null;
const fakeDocument = (): FakeDocument => {
  if (!current) throw new Error('先 installFakeDom()');
  return current;
};

export interface FakeDom {
  document: FakeDocument;
  window: FakeEventTarget & { innerHeight: number; innerWidth: number };
  audios: FakeAudio[];
  /** 送一個 keydown 給 window（app 的 Esc 處理掛在 window 上）。 */
  key(key: string): void;
}

/** 裝上假的 document、window、Audio、HTMLMediaElement（vi.stubGlobal；測完 vi.unstubAllGlobals()）。 */
export function installFakeDom(): FakeDom {
  const audios: FakeAudio[] = [];
  const doc: FakeDocument = {
    activeElement: null,
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
  };
  current = doc;
  const win = Object.assign(new FakeEventTarget(), { innerHeight: 800, innerWidth: 1280 });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super();
        audios.push(this);
      }
    },
  );
  vi.stubGlobal('HTMLMediaElement', { HAVE_NOTHING: 0, HAVE_METADATA: 1 });
  return {
    document: doc,
    window: win,
    audios,
    key(key) {
      win.fire(new FakeEvent('keydown', { key }));
    },
  };
}

// ---- 找元素的小工具 ----

/** 第一個有這些 class 的子孫（找不到就丟錯，測試寫錯時比較好找）。 */
export function byClass(root: unknown, ...classes: string[]): FakeElement {
  const found = all(root, ...classes)[0];
  if (!found) throw new Error(`找不到 .${classes.join('.')}`);
  return found;
}

export function all(root: unknown, ...classes: string[]): FakeElement[] {
  return (root as FakeElement).querySelectorAll(`.${classes.join('.')}`);
}

/** 文字（含子孫）完全一樣、或包含 text 的按鈕。 */
export function buttonWithText(root: unknown, text: string): FakeElement {
  const found = (root as FakeElement).querySelectorAll('button').find((b) => b.textContent.includes(text));
  if (!found) throw new Error(`找不到按鈕「${text}」`);
  return found;
}

/** 元素自己或祖先被藏起來了嗎（hidden）。 */
export function isShown(el: unknown): boolean {
  for (let n = el as FakeElement | null; n; n = n.parentNode) if (n.hidden) return false;
  return true;
}

/** 在輸入框打字：改 value、送 input（change＝true 再送 change）。 */
export function typeInto(el: unknown, value: string, change = false): void {
  const input = el as FakeElement;
  input.value = value;
  input.dispatchEvent(new FakeEvent('input'));
  if (change) input.dispatchEvent(new FakeEvent('change'));
}

/** 在元素上按一個鍵（keydown，會往上傳）；回傳這個事件（看有沒有被 preventDefault）。 */
export function keydown(el: unknown, key: string, init: FakeEventInit = {}): FakeEvent {
  const e = new FakeEvent('keydown', { ...init, key });
  (el as FakeElement).dispatchEvent(e);
  return e;
}

/** 等 Promise 的後續都跑完（微任務排幾輪）。 */
export async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
