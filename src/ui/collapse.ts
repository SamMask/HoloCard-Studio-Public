// 右欄各小節可以摺疊（T-836，DESIGN §5.2）：小節的標題變成可以按的按鈕（原本的標題字＋旁邊一個小箭頭），按了收起／展開；進階效果預設收起（T-840）。
// 收起來的是哪幾節記在這台電腦的瀏覽器（讀寫由組裝端給：app/section-pref.ts 的 localStorage，ui 不 import app），不存進卡片，
// 所以換卡、換語言、重新載入都照舊。
// 鍵盤：標題是原生 <button>（Enter／空白鍵就是按）、aria-expanded、aria-controls 指到內容；收起＝內容 hidden，
// 裡面的控制項就不在 Tab 順序裡。導覽指到右欄時由 inspector 叫 setExpanded(true) 先展開（也記下來）。
// 內容那一層（sectionBody／wrapFollowing 建的 .section-body）在 CSS 是 display: contents：展開時版面和以前完全一樣。
// 文字一律 textContent（硬邊界 4）：標題原本的節點直接搬進按鈕，不重寫字。

import { button, h, type Child } from './dom';
import { icon } from './icons';

/** 收起來的小節（整份清單）怎麼讀、怎麼寫。 */
export interface SectionPrefs {
  collapsed(id: string): boolean;
  set(id: string, collapsed: boolean): void;
}

const DEFAULT_COLLAPSED_SECTIONS: readonly string[] = ['layer-advanced'];

/** 讀不到或壞值當空清單；各份偏好獨立讀取。 */
function readIds(read?: () => readonly string[]): string[] {
  const ids: string[] = [];
  try {
    const got = read?.();
    if (Array.isArray(got)) for (const id of got) if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
  } catch {
    // 讀不到：當空清單
  }
  return ids;
}

/** 兩份清單分別記收起、以及預設收起但已展開的小節；沒給讀寫仍套用預設，不保存。 */
export function createSectionPrefs(
  read?: () => readonly string[], write?: (ids: string[]) => void,
  readExpanded?: () => readonly string[], writeExpanded?: (ids: string[]) => void,
): SectionPrefs {
  const ids = readIds(read);
  const expanded = readIds(readExpanded);
  const isCollapsed = (id: string) => (DEFAULT_COLLAPSED_SECTIONS.includes(id) && !expanded.includes(id)) || ids.includes(id);
  const persist = (writeList: typeof write, list: string[]) => {
    try { writeList?.([...list]); } catch { /* 這次仍照樣切換。 */ }
  };
  return {
    collapsed: isCollapsed,
    set(id, collapsed) {
      if (collapsed === isCollapsed(id)) return;
      const i = ids.indexOf(id);
      if (DEFAULT_COLLAPSED_SECTIONS.includes(id)) {
        const e = expanded.indexOf(id);
        if (collapsed && e >= 0) expanded.splice(e, 1);
        else if (!collapsed && e < 0) expanded.push(id);
        // 舊清單若已有這節，移除以免壓過使用者的新選擇。
        if (i >= 0) {
          ids.splice(i, 1);
          persist(write, ids);
        }
        persist(writeExpanded, expanded);
        return;
      }
      if (collapsed) ids.push(id);
      else ids.splice(i, 1);
      persist(write, ids);
    },
  };
}

export interface Collapsible {
  /** 標題按鈕（原本的標題字＋小箭頭）。 */
  readonly button: HTMLButtonElement;
  readonly body: HTMLElement;
  expanded(): boolean;
  /** 展開或收起並記下來（導覽指到時 setExpanded(true)）；已經是那樣就不做事。 */
  setExpanded(on: boolean): void;
}

export interface CollapsibleOptions {
  /** 小節的名字（記錄用，也拿來組內容的 id）：小寫英文。 */
  id: string;
  /** 放標題字的元素（h2.panel-title、div.group-title、span.field-label）：裡面原本的東西搬進按鈕，按鈕放回它裡面（樣式照舊）。 */
  title: HTMLElement;
  /** 收起時藏起來的內容。 */
  body: HTMLElement;
  prefs: SectionPrefs;
}

export function makeCollapsible(o: CollapsibleOptions): Collapsible {
  const bodyId = `section-${o.id}`;
  o.body.setAttribute('id', bodyId);
  const content = Array.from(o.title.childNodes);
  const chevron = h('span', { className: 'section-chevron', attrs: { 'aria-hidden': 'true' } }, [icon('chevronDown', 16)]);
  const toggle = button('section-toggle', [h('span', { className: 'section-toggle-text' }, content as Child[]), chevron]);
  toggle.setAttribute('aria-controls', bodyId);
  o.title.append(toggle);
  o.title.classList.add('has-toggle');

  let open = true;
  const paint = () => {
    toggle.setAttribute('aria-expanded', String(open));
    if (o.body.hidden !== !open) o.body.hidden = !open;
  };
  const setExpanded = (on: boolean) => {
    if (on === open) return;
    open = on;
    paint();
    o.prefs.set(o.id, !on);
  };
  toggle.addEventListener('click', () => setExpanded(!open));
  open = !o.prefs.collapsed(o.id);
  paint();

  return { button: toggle, body: o.body, expanded: () => open, setExpanded };
}

/** 包住一個小節內容的那一層（CSS display: contents：不多一層版面，只是收起時一起藏）。 */
export function sectionBody(parts: readonly Child[]): HTMLElement {
  return h('div', { className: 'section-body' }, parts);
}

/** 把 head 後面的兄弟元素（同一層）搬進一層 sectionBody，放在 head 後面；回傳那一層。 */
export function wrapFollowing(head: HTMLElement): HTMLElement {
  const parent = head.parentNode as HTMLElement | null;
  const siblings = parent ? Array.from(parent.children) : [];
  const after = siblings.slice(siblings.indexOf(head) + 1) as HTMLElement[];
  const body = sectionBody(after);
  parent?.append(body);
  return body;
}
