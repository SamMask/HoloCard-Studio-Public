// T-836（DESIGN §5.2「右欄各小節可以摺疊」）：小節的標題變成可以按的按鈕＋小箭頭，按了收起／展開；預設全部展開；
// 記在這台電腦（讀寫由組裝端給，app/section-pref.ts）；鍵盤照按鈕操作（原生 <button>：Enter／空白鍵）、aria-expanded、aria-controls；
// 收起的小節裡的控制項不在 Tab 順序裡；導覽指到時先展開（setExpanded(true)，也記下來）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSectionPrefs, makeCollapsible, sectionBody, wrapFollowing } from '../src/ui/collapse';
import { focusableIn } from '../src/ui/focus';
import { installFakeDom, isShown, type FakeDom, type FakeElement } from './ui-fake-dom';

let dom: FakeDom;

beforeEach(() => {
  dom = installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const el = (tag: string, className = '', text = '') => {
  const e = dom.document.createElement(tag);
  e.className = className;
  if (text) e.append(text);
  return e;
};

/** 一個小節：標題 div.group-title「鐳射」＋說明＋一個滑桿（input）＋一顆按鈕。 */
function section(id: string, prefs = createSectionPrefs()) {
  const title = el('div', 'group-title', '鐳射');
  const input = el('input', 'slider');
  const btn = el('button', 'btn', '置中');
  const body = sectionBody([el('p', 'help', '說明') as never, input as never, btn as never]) as unknown as FakeElement;
  const root = el('div', 'field-group');
  root.append(title, body);
  const c = makeCollapsible({ id, title: title as unknown as HTMLElement, body: body as unknown as HTMLElement, prefs });
  const toggle = c.button as unknown as FakeElement;
  return { c, root, title, body, input, btn, toggle };
}

describe('小節標題變成按鈕＋小箭頭（T-836）', () => {
  it('原本的標題字搬進按鈕、後面一個小箭頭；按鈕是原生 <button type=button>（Enter／空白鍵就是按）', () => {
    const { title, toggle } = section('holo');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.parentNode).toBe(title);
    expect(title.textContent).toBe('鐳射');
    expect(toggle.textContent).toBe('鐳射');
    expect(toggle.querySelector('svg.icon')).not.toBeNull();
  });

  it('預設展開：aria-expanded＝true、aria-controls 指到內容（有 id）', () => {
    const { toggle, body, c } = section('holo');
    expect(c.expanded()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.getAttribute('id')).toBeTruthy();
    expect(toggle.getAttribute('aria-controls')).toBe(body.getAttribute('id'));
    expect(isShown(body)).toBe(true);
  });

  it('不同小節的內容 id 不一樣', () => {
    const prefs = createSectionPrefs();
    const a = section('holo', prefs);
    const b = section('shadow', prefs);
    expect(a.body.getAttribute('id')).not.toBe(b.body.getAttribute('id'));
  });

  it('按一下收起（內容藏起來、aria-expanded＝false），再按一下展開', () => {
    const { toggle, body, c } = section('holo');
    toggle.click();
    expect(c.expanded()).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(isShown(body)).toBe(false);
    toggle.click();
    expect(c.expanded()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(isShown(body)).toBe(true);
  });

  it('收起時裡面的控制項不在 Tab 順序裡（標題按鈕還在）；展開後回來', () => {
    const { root, toggle, input, btn } = section('holo');
    const tabStops = () => focusableIn(root as unknown as HTMLElement) as unknown as FakeElement[];
    expect(tabStops()).toEqual([toggle, input, btn]);
    toggle.click();
    expect(tabStops()).toEqual([toggle]);
    toggle.click();
    expect(tabStops()).toEqual([toggle, input, btn]);
  });
});

describe('記在這台電腦（T-836）', () => {
  it('按了就寫：收起的小節名字清單（全部展開＝空清單）', () => {
    const write = vi.fn<(ids: string[]) => void>();
    const prefs = createSectionPrefs(() => [], write);
    const holo = section('holo', prefs);
    const shadow = section('shadow', prefs);
    holo.toggle.click();
    expect(write).toHaveBeenLastCalledWith(['holo']);
    shadow.toggle.click();
    expect(write).toHaveBeenLastCalledWith(['holo', 'shadow']);
    holo.toggle.click();
    expect(write).toHaveBeenLastCalledWith(['shadow']);
    shadow.toggle.click();
    expect(write).toHaveBeenLastCalledWith([]);
  });

  it('重新載入（再建一次）：照記錄收著；記錄裡沒有的照樣展開', () => {
    const prefs = createSectionPrefs(() => ['shadow', 'stage']);
    const holo = section('holo', prefs);
    const shadow = section('shadow', prefs);
    expect(holo.c.expanded()).toBe(true);
    expect(shadow.c.expanded()).toBe(false);
    expect(shadow.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(isShown(shadow.body)).toBe(false);
  });

  it('讀不到（讀的時候丟錯、沒有讀寫）：全部展開；寫的時候丟錯：不丟出來，這次照樣收起', () => {
    const prefs = createSectionPrefs(
      () => {
        throw new Error('SecurityError');
      },
      () => {
        throw new Error('QuotaExceededError');
      },
    );
    const holo = section('holo', prefs);
    expect(holo.c.expanded()).toBe(true);
    expect(() => holo.toggle.click()).not.toThrow();
    expect(holo.c.expanded()).toBe(false);
    const none = section('stage', createSectionPrefs());
    expect(none.c.expanded()).toBe(true);
    expect(() => none.toggle.click()).not.toThrow();
  });

  it('讀到的清單是壞的（不是陣列）：當全部展開', () => {
    const prefs = createSectionPrefs(() => 'holo' as unknown as string[]);
    expect(section('holo', prefs).c.expanded()).toBe(true);
  });
});

describe('導覽指到時先展開（T-836）', () => {
  it('setExpanded(true)：收著的展開、記下來；已經展開就不寫', () => {
    const write = vi.fn<(ids: string[]) => void>();
    const prefs = createSectionPrefs(() => ['layer'], write);
    const layer = section('layer', prefs);
    expect(layer.c.expanded()).toBe(false);
    layer.c.setExpanded(true);
    expect(layer.c.expanded()).toBe(true);
    expect(layer.toggle.getAttribute('aria-expanded')).toBe('true');
    expect(isShown(layer.body)).toBe(true);
    expect(write).toHaveBeenLastCalledWith([]);
    write.mockClear();
    layer.c.setExpanded(true);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('預設收起與獨立展開清單（T-840）', () => {
  it('切換預設收起的節只寫展開清單，其他節仍只寫舊清單', () => {
    const write = vi.fn();
    const writeExpanded = vi.fn();
    const prefs = createSectionPrefs(() => ['style'], write, () => [], writeExpanded);
    const advanced = section('layer-advanced', prefs);
    expect(advanced.c.expanded()).toBe(false);
    advanced.toggle.click();
    expect(writeExpanded).toHaveBeenLastCalledWith(['layer-advanced']);
    expect(write).not.toHaveBeenCalled();
    advanced.toggle.click();
    expect(writeExpanded).toHaveBeenLastCalledWith([]);
    section('style', prefs).toggle.click();
    expect(write).toHaveBeenLastCalledWith([]);
    expect(writeExpanded).toHaveBeenCalledTimes(2);
  });

  it('舊收起清單優先；手動展開會移除舊紀錄，重新建立仍展開', () => {
    let collapsed = ['style', 'layer-advanced'];
    let expanded = ['layer-advanced'];
    const make = () => createSectionPrefs(() => collapsed, (ids) => { collapsed = ids; }, () => expanded, (ids) => { expanded = ids; });
    const advanced = section('layer-advanced', make());
    expect(advanced.c.expanded()).toBe(false);
    advanced.toggle.click();
    expect(collapsed).toEqual(['style']);
    expect(section('layer-advanced', make()).c.expanded()).toBe(true);
  });

  it('展開清單讀不到或不是陣列當空；寫不進去仍能當次展開、收起', () => {
    const boom = () => { throw new Error('denied'); };
    for (const read of [undefined, boom, () => 'bad' as unknown as string[]]) {
      const advanced = section('layer-advanced', createSectionPrefs(() => ['style'], boom, read, boom));
      expect(advanced.c.expanded()).toBe(false);
      expect(() => advanced.toggle.click()).not.toThrow();
      expect(advanced.c.expanded()).toBe(true);
      expect(() => advanced.toggle.click()).not.toThrow();
      expect(advanced.c.expanded()).toBe(false);
    }
    // 收起清單讀不到也不能蓋掉另一份有效的展開紀錄。
    expect(createSectionPrefs(boom, undefined, () => ['layer-advanced']).collapsed('layer-advanced')).toBe(false);
  });
});

describe('包住內容的那一層（T-836）', () => {
  it('sectionBody：div.section-body 包住給的元素（CSS display: contents，不改版面）', () => {
    const a = el('p');
    const b = el('div');
    const body = sectionBody([a as never, b as never]) as unknown as FakeElement;
    expect(body.tagName).toBe('DIV');
    expect(body.classList.contains('section-body')).toBe(true);
    expect(body.children).toEqual([a, b]);
  });

  it('wrapFollowing：把標題後面的兄弟元素搬進一層 section-body，放在標題後面', () => {
    const group = el('div', 'field-group');
    const head = el('div', 'group-title', '風格');
    const help = el('p', 'help');
    const grid = el('div', 'grid');
    group.append(head, help, grid);
    const body = wrapFollowing(head as unknown as HTMLElement) as unknown as FakeElement;
    expect(group.children).toEqual([head, body]);
    expect(body.children).toEqual([help, grid]);
    expect(body.classList.contains('section-body')).toBe(true);
  });
});
