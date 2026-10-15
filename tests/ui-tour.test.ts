import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_KEYS, HELP_SECTIONS, TOUR_STEP_TEXTS } from '../src/ui/logic';
import { createTour, TOUR_STORAGE_KEY, type TourStorage } from '../src/ui/tour';
import { all, buttonWithText, byClass, FakeEvent, installFakeDom, isShown, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

// T-606：第一次使用的導覽（DESIGN §8.1）。假 DOM 真的跑：4 步流程、跳過、Esc、記住看過、localStorage 丟錯、
// 圈住對應元素、被別的面板蓋住時暫停；以及導覽與說明面板的文字不出現技術名詞。

let dom: FakeDom;

beforeEach(() => {
  dom = installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type MemoryStorage = TourStorage & { data: Map<string, string> };

/** 記憶用的假 localStorage。 */
function memoryStorage(seen = false): MemoryStorage {
  const data = new Map<string, string>(seen ? [[TOUR_STORAGE_KEY, '1']] : []);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

/** 四個目標元素（導覽依序圈它們）。 */
function targets() {
  const els = [0, 1, 2, 3].map((i) => {
    const el = dom.document.createElement('div');
    el.className = `target-${i}`;
    return el;
  });
  return { els, target: (i: number) => (els[i] ?? null) as unknown as HTMLElement | null };
}

function make(storage: TourStorage | null = memoryStorage()) {
  const t = targets();
  const tour = createTour({ target: t.target }, () => storage);
  return { tour, t, storage, el: tour.el as unknown as FakeElement };
}

const text = (el: FakeElement) => byClass(el, 'tour-text').textContent;
const dots = (el: FakeElement) => all(el, 'tour-dot');
const nextBtn = (el: FakeElement) => byClass(el, 'tour-next');
const skipBtn = (el: FakeElement) => byClass(el, 'tour-skip');

describe('導覽：只在第一次使用時出現', () => {
  it('沒看過 → 開始，顯示第 1 步', () => {
    const { tour, el } = make();
    expect(isShown(el)).toBe(false);
    expect(tour.startIfFirstTime()).toBe(true);
    expect(tour.isOpen()).toBe(true);
    expect(isShown(el)).toBe(true);
    expect(text(el)).toBe(TOUR_STEP_TEXTS[0]);
  });

  it('看過了 → 不出現', () => {
    const { tour, el } = make(memoryStorage(true));
    expect(tour.startIfFirstTime()).toBe(false);
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
  });

  it('讀記錄時丟錯（私密模式、被擋）→ 當作看過，不出現也不壞', () => {
    const broken: TourStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    const { tour, el } = make(broken);
    expect(() => tour.startIfFirstTime()).not.toThrow();
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
  });

  it('連 localStorage 都拿不到（null）→ 當作看過', () => {
    const { tour } = make(null);
    expect(tour.startIfFirstTime()).toBe(false);
  });

  it('拿 localStorage 本身就丟錯 → 當作看過', () => {
    const t = targets();
    const tour = createTour({ target: t.target }, () => {
      throw new Error('SecurityError');
    });
    expect(tour.startIfFirstTime()).toBe(false);
  });
});

describe('導覽：4 步流程', () => {
  it('四步的字、4 個進度點、下一步 → 最後一步變〔開始玩〕', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    expect(dots(el)).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(text(el)).toBe(TOUR_STEP_TEXTS[i]);
      // 目前這一步的點亮著，其他不亮
      expect(dots(el).map((d) => d.classList.contains('is-on'))).toEqual([0, 1, 2, 3].map((k) => k === i));
      expect(dots(el)[i]!.getAttribute('aria-current')).toBe('step');
      expect(nextBtn(el).textContent).toBe(i === 3 ? '開始玩' : '下一步');
      // 每一步都有〔跳過〕
      expect(skipBtn(el).textContent).toBe('跳過');
      if (i < 3) nextBtn(el).click();
    }
    expect(tour.isOpen()).toBe(true);
  });

  it('文字照 DESIGN：第 1 步講拖曳與滾輪，第 4 步講〔匯出 ▾〕', () => {
    expect(TOUR_STEP_TEXTS).toHaveLength(4);
    expect(TOUR_STEP_TEXTS[0]).toContain('拖曳');
    expect(TOUR_STEP_TEXTS[0]).toContain('滾輪');
    expect(TOUR_STEP_TEXTS[1]).toContain('上傳圖片');
    expect(TOUR_STEP_TEXTS[3]).toContain('匯出');
  });

  it('按〔開始玩〕：收起來並記住', () => {
    const { tour, el, storage } = make();
    tour.startIfFirstTime();
    for (let i = 0; i < 3; i++) nextBtn(el).click();
    nextBtn(el).click();
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
    expect((storage as MemoryStorage).data.get(TOUR_STORAGE_KEY)).toBe('1');
    // 下次再來：不出現
    expect(tour.startIfFirstTime()).toBe(false);
  });

  it('中途按〔跳過〕：收起來並記住', () => {
    const { tour, el, storage } = make();
    tour.startIfFirstTime();
    nextBtn(el).click();
    skipBtn(el).click();
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
    expect((storage as MemoryStorage).data.has(TOUR_STORAGE_KEY)).toBe(true);
  });

  it('Esc＝跳過：回傳 true 表示收下了；沒開著時回傳 false（讓別的處理）', () => {
    const { tour, el, storage } = make();
    tour.startIfFirstTime();
    expect(tour.escape()).toBe(true);
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
    expect((storage as MemoryStorage).data.has(TOUR_STORAGE_KEY)).toBe(true);
    expect(tour.escape()).toBe(false);
  });

  it('寫記錄時丟錯：照樣收起來，不壞', () => {
    const storage: TourStorage = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    const { tour, el } = make(storage);
    tour.startIfFirstTime();
    expect(() => skipBtn(el).click()).not.toThrow();
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
  });

  it('重新看導覽：看過了也從第 1 步開始；看到一半再按回到第 1 步；看完不會壞', () => {
    const { tour, el } = make(memoryStorage(true));
    tour.start();
    expect(tour.isOpen()).toBe(true);
    expect(text(el)).toBe(TOUR_STEP_TEXTS[0]);
    nextBtn(el).click();
    nextBtn(el).click();
    tour.start();
    expect(text(el)).toBe(TOUR_STEP_TEXTS[0]);
    for (let i = 0; i < 4; i++) nextBtn(el).click();
    expect(tour.isOpen()).toBe(false);
  });

  it('收起來時，焦點還在小卡裡就放掉（不留在已經看不到的按鈕上）', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    nextBtn(el).focus();
    expect(dom.document.activeElement).toBe(nextBtn(el));
    skipBtn(el).click();
    // 同真的瀏覽器：放掉的焦點回到 body（假 DOM 從 T-607c 起照這樣做）
    expect(dom.document.activeElement).toBe(dom.document.body);
  });
});

describe('導覽：鍵盤焦點（T-607b）', () => {
  /** previewStandIn＝預覽區（開導覽前沒有焦點時給它）。 */
  function withFocus(storage: TourStorage = memoryStorage()) {
    const t = targets();
    const previewStandIn = dom.document.createElement('div');
    previewStandIn.setAttribute('tabindex', '0');
    const tour = createTour({ target: t.target, focusFallback: () => previewStandIn as unknown as HTMLElement }, () => storage);
    return { tour, el: tour.el as unknown as FakeElement, previewStandIn, t };
  }

  it('開始（第一次使用、〔重新看導覽〕）時焦點移到〔下一步〕', () => {
    const { tour, el } = withFocus();
    const opener = dom.document.createElement('button');
    opener.focus();
    tour.startIfFirstTime();
    expect(dom.document.activeElement).toBe(nextBtn(el));
    tour.start();
    expect(dom.document.activeElement).toBe(nextBtn(el));
  });

  it('〔跳過〕：焦點回到開導覽前的地方', () => {
    const { tour, el } = withFocus();
    const opener = dom.document.createElement('button');
    opener.focus();
    tour.startIfFirstTime();
    skipBtn(el).click();
    expect(tour.isOpen()).toBe(false);
    expect(dom.document.activeElement).toBe(opener);
  });

  it('開導覽前焦點不在任何地方：看完（最後一步〔開始玩〕）後給預覽區', () => {
    const { tour, el, previewStandIn } = withFocus();
    tour.startIfFirstTime();
    for (let i = 0; i < 4; i++) nextBtn(el).click();
    expect(tour.isOpen()).toBe(false);
    expect(dom.document.activeElement).toBe(previewStandIn);
  });

  it('Esc（escape()）跳過：一樣把焦點還回去', () => {
    const { tour } = withFocus();
    const opener = dom.document.createElement('button');
    opener.focus();
    tour.startIfFirstTime();
    expect(tour.escape()).toBe(true);
    expect(dom.document.activeElement).toBe(opener);
  });

  it('走導覽的途中焦點被使用者移去別的地方：結束時不搶回來', () => {
    const { tour, el } = withFocus();
    const opener = dom.document.createElement('button');
    opener.focus();
    tour.startIfFirstTime();
    const elsewhere = dom.document.createElement('button');
    elsewhere.focus();
    skipBtn(el).click();
    expect(dom.document.activeElement).toBe(elsewhere);
  });

  it('導覽出現時使用者正在打字：不搶輸入框的焦點，結束時也不動', () => {
    const { tour, el } = withFocus();
    const typing = dom.document.createElement('input');
    typing.setAttribute('type', 'text');
    typing.focus();
    tour.startIfFirstTime();
    expect(dom.document.activeElement).toBe(typing);
    skipBtn(el).click();
    expect(dom.document.activeElement).toBe(typing);
  });

  it('被別的面板蓋住（暫停）時才開始：先不動焦點，等看得到了才移到〔下一步〕；之後暫停再恢復不再搶焦點', () => {
    const { tour, el } = withFocus();
    const panelButton = dom.document.createElement('button');
    panelButton.focus();
    tour.suspend(true);
    tour.startIfFirstTime();
    expect(dom.document.activeElement).toBe(panelButton);
    tour.suspend(false);
    expect(dom.document.activeElement).toBe(nextBtn(el));
    // 說明面板打開（導覽暫停），焦點在面板裡；面板關掉、導覽恢復：焦點留在使用者那邊
    tour.suspend(true);
    const afterHelp = dom.document.createElement('button');
    afterHelp.focus();
    tour.suspend(false);
    expect(dom.document.activeElement).toBe(afterHelp);
  });

  it('Tab 在小卡裡循環：〔下一步〕往後回到第一個控制項（〔跳過〕）、Shift+Tab 反過來', () => {
    const { tour, el } = withFocus();
    tour.startIfFirstTime();
    expect(dom.document.activeElement).toBe(nextBtn(el));
    expect(keydown(nextBtn(el), 'Tab').defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(skipBtn(el));
    keydown(skipBtn(el), 'Tab', { shiftKey: true });
    expect(dom.document.activeElement).toBe(nextBtn(el));
  });

  it('開導覽前的焦點在一個已經被藏起來的面板裡（例如說明面板的〔重新看導覽〕）：結束時改給預覽區', () => {
    const { tour, el, previewStandIn } = withFocus();
    const help = dom.document.createElement('aside');
    const restart = dom.document.createElement('button');
    help.append(restart);
    restart.focus();
    help.hidden = true;
    tour.start();
    skipBtn(el).click();
    expect(dom.document.activeElement).toBe(previewStandIn);
  });

  it('沒給預覽區（focusFallback）時，結束後焦點只是離開小卡（不留在看不到的按鈕上）', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    expect(dom.document.activeElement).toBe(nextBtn(el));
    skipBtn(el).click();
    // 同真的瀏覽器：放掉的焦點回到 body（假 DOM 從 T-607c 起照這樣做）
    expect(dom.document.activeElement).toBe(dom.document.body);
  });
});

describe('導覽：圈住對應的地方', () => {
  it('用青色外框圈住這一步的元素（位置來自它的框，每邊大 4px）', () => {
    const { tour, el } = make();
    const ring = () => byClass(el, 'tour-ring');
    tour.startIfFirstTime();
    expect(isShown(ring())).toBe(true);
    // 假 DOM 的元素框固定是 800×600
    expect(ring().style.left).toBe('-4px');
    expect(ring().style.top).toBe('-4px');
    expect(ring().style.width).toBe('808px');
    expect(ring().style.height).toBe('608px');
  });

  it('依序問每一步的元素', () => {
    const asked: number[] = [];
    const tour = createTour(
      {
        target: (i) => {
          asked.push(i);
          return dom.document.createElement('div') as unknown as HTMLElement;
        },
      },
      () => memoryStorage(),
    );
    tour.startIfFirstTime();
    const el = tour.el as unknown as FakeElement;
    for (let i = 0; i < 3; i++) nextBtn(el).click();
    expect([...new Set(asked)]).toEqual([0, 1, 2, 3]);
  });

  it('找不到元素：外框不畫，小卡照樣能走完', () => {
    const tour = createTour({ target: () => null }, () => memoryStorage());
    const el = tour.el as unknown as FakeElement;
    tour.startIfFirstTime();
    expect(isShown(byClass(el, 'tour-ring'))).toBe(false);
    for (let i = 0; i < 4; i++) nextBtn(el).click();
    expect(tour.isOpen()).toBe(false);
  });

  it('視窗大小改變：外框重新量位置', () => {
    const { tour, t, el } = make();
    tour.startIfFirstTime();
    t.els[0]!.getBoundingClientRect = () => ({ left: 100, top: 50, right: 300, bottom: 150, width: 200, height: 100, x: 100, y: 50 });
    dom.window.fire(new FakeEvent('resize'));
    const ring = byClass(el, 'tour-ring');
    expect(ring.style.left).toBe('96px');
    expect(ring.style.top).toBe('46px');
    expect(ring.style.width).toBe('208px');
    expect(ring.style.height).toBe('108px');
  });

  it('導覽收起來後，視窗大小改變不再量位置', () => {
    const { tour, t } = make();
    tour.startIfFirstTime();
    tour.escape();
    const measure = vi.spyOn(t.els[0]!, 'getBoundingClientRect');
    dom.window.fire(new FakeEvent('resize'));
    expect(measure).not.toHaveBeenCalled();
  });

  it('指到某一步之前先叫 reveal（T-836：右欄那一步，被指到的小節收著就先展開），展開後才量外框', () => {
    const order: string[] = [];
    const tour = createTour(
      {
        target: (i) => {
          order.push(`target ${i}`);
          return dom.document.createElement('div') as unknown as HTMLElement;
        },
        reveal: (i) => void order.push(`reveal ${i}`),
      },
      () => memoryStorage(),
    );
    tour.startIfFirstTime();
    const el = tour.el as unknown as FakeElement;
    for (let i = 0; i < 3; i++) nextBtn(el).click();
    expect(order.filter((s) => s.startsWith('reveal'))).toEqual(['reveal 0', 'reveal 1', 'reveal 2', 'reveal 3']);
    // 每一步都是先 reveal 再量（target）
    for (const step of [0, 1, 2, 3]) expect(order.indexOf(`reveal ${step}`)).toBeLessThan(order.indexOf(`target ${step}`));
  });

  it('暫停中（被面板蓋住）不叫 reveal，恢復時才叫', () => {
    const revealed: number[] = [];
    const tour = createTour({ target: () => null, reveal: (i) => void revealed.push(i) }, () => memoryStorage());
    tour.suspend(true);
    tour.startIfFirstTime();
    expect(revealed).toEqual([]);
    tour.suspend(false);
    expect(revealed).toEqual([0]);
  });

  it('小卡的位置：圈右欄那一步移到左下（免得蓋住被圈的地方），其他步在右下', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    const card = byClass(el, 'tour-card');
    const docks: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      docks.push(card.dataset.dock);
      if (i < 3) nextBtn(el).click();
    }
    expect(docks).toEqual(['right', 'right', 'left', 'right']);
  });
});

describe('導覽：開著時卡片照樣能操作', () => {
  it('不攔鍵盤與滑鼠（沒有掛在視窗上的 keydown／pointerdown 監聽），不鎖住畫面（inert）', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    expect(dom.window.listenerCount('keydown')).toBe(0);
    expect(dom.window.listenerCount('pointerdown')).toBe(0);
    expect(el.inert).toBe(false);
    expect(byClass(el, 'tour-card').inert).toBe(false);
  });

  it('樣式：整層與外框不接滑鼠，只有小卡接', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    const rule = (selector: string) => {
      const found = [...css.matchAll(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!);
      expect(found.length, `style.css 找不到 ${selector}`).toBeGreaterThan(0);
      return found.join('\n');
    };
    expect(rule('.tour')).toMatch(/pointer-events:\s*none/);
    expect(rule('.tour-ring')).toMatch(/pointer-events:\s*none/);
    expect(rule('.tour-card')).toMatch(/pointer-events:\s*auto/);
  });
});

describe('導覽：被別的面板蓋住時暫停', () => {
  it('暫停：收起來、Esc 不收、記錄不動；恢復後回到同一步', () => {
    const { tour, el, storage } = make();
    tour.startIfFirstTime();
    nextBtn(el).click();
    tour.suspend(true);
    expect(tour.isOpen()).toBe(false);
    expect(isShown(el)).toBe(false);
    expect(tour.escape()).toBe(false);
    expect((storage as MemoryStorage).data.has(TOUR_STORAGE_KEY)).toBe(false);
    tour.suspend(false);
    expect(tour.isOpen()).toBe(true);
    expect(isShown(el)).toBe(true);
    expect(text(el)).toBe(TOUR_STEP_TEXTS[1]);
  });

  it('沒在導覽時暫停／恢復：什麼都不會出現', () => {
    const { tour, el } = make();
    tour.suspend(true);
    tour.suspend(false);
    expect(isShown(el)).toBe(false);
    expect(tour.isOpen()).toBe(false);
  });

  it('暫停中才開始（面板開著時剛好該出導覽）：等恢復才顯示', () => {
    const { tour, el } = make();
    tour.suspend(true);
    expect(tour.startIfFirstTime()).toBe(true);
    expect(isShown(el)).toBe(false);
    tour.suspend(false);
    expect(isShown(el)).toBe(true);
  });
});

describe('文字：白話，不出現技術名詞', () => {
  const BANNED = ['WebGPU', 'WebGL', 'alpha', 'Alpha', 'shader', 'Shader', 'IndexedDB', 'localStorage', 'canvas', 'GPU', 'API', 'JSON', 'blob', 'texture', 'mesh', 'uniform', 'z 值', '法線', 'RGB', 'CDN', 'HTTP', 'WASM', 'ONNX'];

  it('導覽的步驟與按鈕', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    const seen: string[] = [...TOUR_STEP_TEXTS];
    for (let i = 0; i < 4; i++) {
      seen.push(el.textContent);
      if (i < 3) nextBtn(el).click();
    }
    for (const s of seen) for (const word of BANNED) expect(s, `「${word}」不該出現在：${s}`).not.toContain(word);
  });

  it('說明面板的文字常數（分段、鍵盤）', () => {
    const strings: string[] = [];
    for (const section of HELP_SECTIONS) strings.push(section.title, ...section.lines);
    for (const key of HELP_KEYS) strings.push(...key.keys, key.text);
    expect(strings.length).toBeGreaterThan(10);
    for (const s of strings) for (const word of BANNED) expect(s, `「${word}」不該出現在：${s}`).not.toContain(word);
  });

  it('防呆：測試找到的按鈕就是導覽的按鈕', () => {
    const { tour, el } = make();
    tour.startIfFirstTime();
    expect(buttonWithText(el, '下一步')).toBe(nextBtn(el));
    expect(buttonWithText(el, '跳過')).toBe(skipBtn(el));
  });
});
