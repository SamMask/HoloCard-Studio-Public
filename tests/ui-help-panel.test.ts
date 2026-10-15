import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';
import { createHelpPanel } from '../src/ui/help-panel';
import { AUTO_QUALITY_HELP, AUTO_QUALITY_LABEL, HELP_KEYS, HELP_SECTIONS, HELP_TITLE } from '../src/ui/logic';
import { all, buttonWithText, byClass, FakeEvent, installFakeDom, isShown, keydown, type FakeDom, type FakeElement } from './ui-fake-dom';

// T-606：頁首〔？〕的操作說明面板（DESIGN §8.1）：開關、Esc、點外面、再按〔？〕、焦點回到〔？〕、〔重新看導覽〕、分段內容。

let dom: FakeDom;
let opener: FakeElement;
let outside: FakeElement;

beforeEach(() => {
  dom = installFakeDom();
  opener = dom.document.createElement('button');
  outside = dom.document.createElement('div');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function make(autoQualityOn = true) {
  const restartTour = vi.fn();
  const changed = vi.fn();
  let autoQuality = autoQualityOn;
  const setAutoQuality = vi.fn((on: boolean) => void (autoQuality = on));
  const help = createHelpPanel({
    opener: () => opener as unknown as HTMLElement,
    restartTour,
    changed,
    autoQuality: () => autoQuality,
    setAutoQuality,
  });
  const el = help.el as unknown as FakeElement;
  return { help, el, restartTour, changed, setAutoQuality };
}

/** 滑鼠在 target 上按下（視窗收到 pointerdown）。 */
function pointerDown(target: FakeElement) {
  const e = new FakeEvent('pointerdown');
  e.target = target;
  dom.window.fire(e);
}

describe('說明面板：開關與焦點', () => {
  it('一開始是收起來的；開了之後可以看到，標題「操作說明」，焦點移到第一個控制項（關閉鈕）', () => {
    const { help, el, changed } = make();
    expect(isShown(el)).toBe(false);
    expect(help.isOpen()).toBe(false);
    help.open();
    expect(help.isOpen()).toBe(true);
    expect(isShown(el)).toBe(true);
    expect(byClass(el, 'help-title').textContent).toBe(HELP_TITLE);
    expect(HELP_TITLE).toBe('操作說明');
    expect(dom.document.activeElement).toBe(byClass(el, 'help-close'));
    expect(changed).toHaveBeenLastCalledWith(true);
  });

  it('面板是對話框、有名字（朗讀用）', () => {
    const { el } = make();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-label')).toBe('操作說明');
  });

  it('toggle（頁首〔？〕）：按一下開、再按一下關', () => {
    const { help, el } = make();
    help.toggle();
    expect(isShown(el)).toBe(true);
    help.toggle();
    expect(isShown(el)).toBe(false);
  });

  it('關掉後焦點回到〔？〕', () => {
    const { help } = make();
    help.open();
    help.close();
    expect(dom.document.activeElement).toBe(opener);
  });

  it('按面板上的關閉鈕：關掉、焦點回到〔？〕', () => {
    const { help, el, changed } = make();
    help.open();
    byClass(el, 'help-close').click();
    expect(help.isOpen()).toBe(false);
    expect(dom.document.activeElement).toBe(opener);
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it('Esc：開著就關掉並回傳 true，焦點回到〔？〕；沒開著回傳 false', () => {
    const { help } = make();
    expect(help.escape()).toBe(false);
    help.open();
    expect(help.escape()).toBe(true);
    expect(help.isOpen()).toBe(false);
    expect(dom.document.activeElement).toBe(opener);
    expect(help.escape()).toBe(false);
  });

  it('點面板外面：關掉（焦點本來在面板裡 → 回到〔？〕）', () => {
    const { help } = make();
    help.open();
    pointerDown(outside);
    expect(help.isOpen()).toBe(false);
    expect(dom.document.activeElement).toBe(opener);
  });

  it('點面板外面：焦點本來就在別處 → 不搶焦點', () => {
    const { help } = make();
    help.open();
    outside.focus();
    pointerDown(outside);
    expect(help.isOpen()).toBe(false);
    expect(dom.document.activeElement).toBe(outside);
  });

  it('點面板裡面：不關', () => {
    const { help, el } = make();
    help.open();
    pointerDown(byClass(el, 'help-body'));
    expect(help.isOpen()).toBe(true);
  });

  it('點〔？〕自己的按下不算「點外面」（交給 toggle，不然會關了又開）', () => {
    const { help } = make();
    help.open();
    pointerDown(opener);
    expect(help.isOpen()).toBe(true);
    help.toggle();
    expect(help.isOpen()).toBe(false);
  });

  it('沒開著時點哪裡都沒事', () => {
    const { help, changed } = make();
    pointerDown(outside);
    expect(help.isOpen()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('重複開、重複關：只通知一次', () => {
    const { help, changed } = make();
    help.open();
    help.open();
    help.close();
    help.close();
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });

  it('close(false)：不把焦點拉回〔？〕（要換去別的地方時用）', () => {
    const { help } = make();
    help.open();
    outside.focus();
    help.close(false);
    expect(dom.document.activeElement).toBe(outside);
  });

  it('被別的面板蓋住時不能按（inert），解開後恢復', () => {
    const { help, el } = make();
    help.open();
    help.setInert(true);
    expect(el.inert).toBe(true);
    help.setInert(false);
    expect(el.inert).toBe(false);
  });
});

describe('說明面板：〔重新看導覽〕', () => {
  it('最下面有〔重新看導覽〕；按了先關掉面板、再開始導覽，焦點不拉回〔？〕', () => {
    const { help, el, restartTour } = make();
    help.open();
    const restart = buttonWithText(el, '重新看導覽');
    expect(restart.parentNode).toBe(byClass(el, 'help-foot'));
    // 面板的最後一個子元素＝最下面
    expect((el.children[el.children.length - 1] as FakeElement).className).toContain('help-foot');
    let openWhenRestarted: boolean | null = null;
    restartTour.mockImplementation(() => {
      openWhenRestarted = help.isOpen();
    });
    restart.click();
    expect(restartTour).toHaveBeenCalledTimes(1);
    expect(openWhenRestarted).toBe(false);
    expect(dom.document.activeElement).not.toBe(opener);
  });
});

describe('說明面板：內容分段', () => {
  it('T-849：分段順序照介面分組，鍵盤仍在最後', () => {
    const { el } = make();
    const titles = all(el, 'help-section-title').map((t) => t.textContent);
    expect(titles).toEqual(['轉卡與縮放', '做卡片', '圖層進階效果', '卡片外觀', '舞台與背景', '匯出與匯入', '鍵盤']);
    expect(HELP_SECTIONS.map((s) => s.title)).toEqual(titles.slice(0, -1));
  });

  it('每段都有白話短句；基本操作、進階效果、外觀各自歸位', () => {
    const { el } = make();
    for (const section of all(el, 'help-section')) {
      expect(all(section, 'help-line').length + all(section, 'help-key-row').length).toBeGreaterThan(0);
    }
    const body = (title: string) => HELP_SECTIONS.find((s) => s.title === title)!.lines.join('\n');
    expect(body('做卡片')).toContain('深度');
    expect(body('做卡片')).toContain('混合模式');
    expect(body('圖層進階效果')).toContain('衝出卡片');
    expect(body('卡片外觀')).toContain('霧光');
    expect(body('匯出與匯入')).toContain('匯出');
    expect(body('匯出與匯入')).toContain('匯入');
  });

  it('鍵盤段列出 8.2 的按鍵（復原、重做、Esc、方向鍵、Home、+ −、F、Delete）', () => {
    const { el } = make();
    const rows = all(el, 'help-key-row');
    expect(rows).toHaveLength(HELP_KEYS.length);
    const all_keys = HELP_KEYS.flatMap((k) => [...k.keys, k.text]).join(' ');
    for (const k of ['Ctrl', 'Z', 'Y', 'Esc', '←', '→', '↑', '↓', 'Home', '+', 'F', 'Delete']) expect(all_keys).toContain(k);
    // 每個按鍵畫成一顆小鍵帽
    expect(all(rows[0]!, 'help-key').map((k) => k.textContent)).toEqual([...HELP_KEYS[0]!.keys]);
  });

  it('T-607 做完了：按鍵都已經能用，沒有淡色、沒有「之後才有」的小標', () => {
    const { el } = make();
    const rows = all(el, 'help-key-row');
    expect(rows.length).toBe(HELP_KEYS.length);
    for (const row of rows) {
      expect(row.classList.contains('is-soon')).toBe(false);
      expect(all(row, 'help-soon')).toHaveLength(0);
    }
    expect(el.textContent).not.toContain('之後才有');
  });
});

describe('說明面板：Tab 在面板裡循環（T-607）', () => {
  it('最後一個控制項（最下面的自動降低畫質開關）按 Tab → 回到第一個（關閉鈕）；第一個按 Shift+Tab → 最後一個', () => {
    const { help, el } = make();
    help.open();
    const close = byClass(el, 'help-close');
    const last = byClass(el, 'switch');
    last.focus();
    const forward = keydown(last, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(close);
    const backward = keydown(close, 'Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(last);
  });

  it('中間的 Tab 也由面板接手，一步一步往下走（關閉鈕 → 〔重新看導覽〕 → 開關），不跑出面板', () => {
    const { help, el } = make();
    help.open();
    const close = byClass(el, 'help-close');
    const restart = buttonWithText(el, '重新看導覽');
    const sw = byClass(el, 'switch');
    keydown(close, 'Tab');
    expect(dom.document.activeElement).toBe(restart);
    keydown(restart, 'Tab');
    expect(dom.document.activeElement).toBe(sw);
    keydown(sw, 'Tab');
    expect(dom.document.activeElement).toBe(close);
  });
});

describe('說明面板：最下面的「電腦跑不動時自動降低畫質」開關（T-809，DESIGN §8.4）', () => {
  it('在面板最下面（〔重新看導覽〕下面），是一個開關，名字就是「電腦跑不動時自動降低畫質」，旁邊有白話說明', () => {
    const { el } = make();
    const foot = byClass(el, 'help-foot');
    const sw = byClass(el, 'switch');
    expect(AUTO_QUALITY_LABEL).toBe('電腦跑不動時自動降低畫質');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-label')).toBe(AUTO_QUALITY_LABEL);
    expect(byClass(el, 'help-setting').textContent).toContain(AUTO_QUALITY_LABEL);
    expect(byClass(el, 'help-setting').textContent).toContain(AUTO_QUALITY_HELP);
    // 在 help-foot 裡，順序是〔重新看導覽〕然後開關
    const kids = foot.children as FakeElement[];
    expect(kids[0]).toBe(buttonWithText(el, '重新看導覽'));
    expect(kids[kids.length - 1]).toBe(byClass(el, 'help-setting'));
    expect(foot.children.length).toBe(2);
    // 整個面板的最後一個東西還是 help-foot
    expect((el.children[el.children.length - 1] as FakeElement).className).toContain('help-foot');
  });

  it('預設開：打開面板時開關是「開」；上次存的是關，就顯示「關」', () => {
    const on = make(true);
    on.help.open();
    expect(byClass(on.el, 'switch').getAttribute('aria-checked')).toBe('true');
    expect(byClass(on.el, 'switch-state').textContent).toBe('開');
    const off = make(false);
    off.help.open();
    expect(byClass(off.el, 'switch').getAttribute('aria-checked')).toBe('false');
    expect(byClass(off.el, 'switch-state').textContent).toBe('關');
  });

  it('按開關：通知組裝端（關掉＝馬上回完整畫質由組裝端做），畫面立刻跟著變；再按一次打開', () => {
    const { help, el, setAutoQuality } = make(true);
    help.open();
    const sw = byClass(el, 'switch');
    sw.click();
    expect(setAutoQuality).toHaveBeenLastCalledWith(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    expect(setAutoQuality).toHaveBeenLastCalledWith(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(setAutoQuality).toHaveBeenCalledTimes(2);
  });

  it('每次打開面板都重新讀目前的設定（別的地方改過也跟著）；組裝端沒給布林（讀不到）當開著', () => {
    const { help, el, setAutoQuality } = make(true);
    help.open();
    byClass(el, 'switch').click();
    help.close();
    help.open();
    expect(byClass(el, 'switch').getAttribute('aria-checked')).toBe('false');
    setAutoQuality(true);
    help.close();
    help.open();
    expect(byClass(el, 'switch').getAttribute('aria-checked')).toBe('true');

    const odd = createHelpPanel({
      opener: () => opener as unknown as HTMLElement,
      restartTour: vi.fn(),
      changed: vi.fn(),
      autoQuality: () => undefined as unknown as boolean,
      setAutoQuality: vi.fn(),
    });
    odd.open();
    expect(byClass(odd.el as unknown as FakeElement, 'switch').getAttribute('aria-checked')).toBe('true');
  });

  it('按開關不會關掉面板，也不影響〔重新看導覽〕', () => {
    const { help, el, restartTour } = make();
    help.open();
    byClass(el, 'switch').click();
    expect(help.isOpen()).toBe(true);
    expect(restartTour).not.toHaveBeenCalled();
  });
});

describe('說明面板：只用 textContent', () => {
  it('新增的幾個檔案都沒有 innerHTML／insertAdjacentHTML／outerHTML（硬邊界 4）', () => {
    for (const file of ['ui/help-panel.ts', 'ui/tour.ts', 'ui/controls.ts', 'interact/quality.ts', 'app/quality-pref.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(source, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });
});

// 重排前的四語句子快照：排序後比較，搬位置可以、改字或漏句不行。
describe('T-849 help regrouping', () => {
  const cases = [
    ['zh-Hant', zhHant, ['轉卡與縮放', '做卡片', '圖層進階效果', '卡片外觀', '舞台與背景', '匯出與匯入']],
    ['en', en, ['Turn and zoom', 'Make a card', 'Advanced layer effects', 'Card appearance', 'Stage and background', 'Export and import']],
    ['ja', ja, ['回転とズーム', 'カードを作る', 'レイヤーの応用エフェクト', 'カードの見た目', 'ステージと背景', '書き出しと読み込み']],
    ['ko', ko, ['카드 회전과 확대·축소', '카드 만들기', '레이어 고급 효과', '카드 꾸미기', '무대와 배경', '내보내기와 가져오기']],
  ] as const;

  afterEach(() => {
    vi.doUnmock('../src/i18n');
    vi.resetModules();
  });

  for (const [locale, dict, titles] of cases) {
    it(`${locale}: preserves sentences and groups by interface`, async () => {
      vi.resetModules();
      vi.doMock('../src/i18n', () => ({ S: dict }));
      const logic = await import('../src/ui/logic');
      expect(logic.HELP_SECTIONS.flatMap((s) => s.lines).sort()).toMatchSnapshot();
      expect(logic.HELP_SECTIONS.map((s) => s.title)).toEqual(titles);
      expect(logic.HELP_SECTIONS.map((s) => s.lines)).toEqual([
        [dict.help.rotate1, dict.help.rotate2, dict.help.rotate3],
        [dict.help.upload1, dict.help.upload2, dict.help.upload3,
          dict.help.layers1, dict.help.layers2, dict.help.layers3, dict.help.text1],
        [dict.help.layers4, dict.help.layers5, dict.help.layers6, dict.help.layers7, dict.help.layers8],
        [dict.help.foil4, dict.help.foil3, dict.help.foil1, dict.help.foil2,
          dict.help.rotateAspect, dict.help.rotateDisc, dict.help.rotateSleeve],
        [dict.stage.backdropHelpLine, dict.stage.waterSceneHelpLine],
        [dict.help.export1, dict.help.export2, dict.help.export3],
      ]);
      expect(logic.HELP_KEYS_TITLE).toBe(dict.help.keysTitle);
    });
  }
});
