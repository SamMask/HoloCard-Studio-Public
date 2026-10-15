// T-806 透明卡套的畫面（DESIGN「透明卡套」）：
// 右欄卡片設定在「展示擺動」附近多一個開關「透明卡套」＋說明句，按一下記一步、鍵盤可用（開關是按鈕）；說明面板多一句；
// 頁首〔匯出 ▾〕在「透明背景」旁邊多一個勾選「包含卡套」（卡片開著卡套才出現、預設勾），PNG、影片、GIF 都照它。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { createEditor, toUiState } from '../src/ui/editor';
import { createExportPanel } from '../src/ui/export-panel';
import { createHeader } from '../src/ui/header';
import { createInspector } from '../src/ui/inspector';
import { HELP_SECTIONS, SLEEVE_EXPORT_LABEL, SLEEVE_HELP, SLEEVE_LABEL } from '../src/ui/logic';
import type { GifExportOptions, MotionRequest, TurntableKind, TurntableOutcome, UiIntents, VideoExportOptions } from '../src/ui/types';
import { all, buttonWithText, byClass, flush, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const plainCard = () => newCard('standard', 'c1', T0);
const sleeveCard = () => updateCard(plainCard(), { view: { sleeve: true } });

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      return name.startsWith('export') ? Promise.resolve() : undefined;
    },
  });
  return { intents, calls };
}

beforeEach(() => {
  installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('文字照 DESIGN', () => {
  it('開關「透明卡套」、說明句、匯出選單「包含卡套」；說明面板「卡片外觀」多一句', () => {
    expect(SLEEVE_LABEL).toBe('透明卡套');
    expect(SLEEVE_HELP).toBe('卡片外面套一層透明塑膠，轉動時邊緣會反光。');
    expect(SLEEVE_EXPORT_LABEL).toBe('包含卡套');
    expect(HELP_SECTIONS.find((s) => s.title === '卡片外觀')!.lines).toContain('右欄的「透明卡套」可以把卡片裝進透明塑膠殼。');
  });
});

describe('右欄開關「透明卡套」', () => {
  function setup(card: Card) {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    inspector.render(toUiState(createEditor(card), (h) => `blob:${h}`));
    const root = inspector.el as unknown as FakeElement;
    const sw = all(root, 'switch').find((b) => b.getAttribute('aria-label') === SLEEVE_LABEL);
    if (!sw) throw new Error('找不到透明卡套開關');
    return { inspector, root, calls, sw };
  }

  it('在「展示擺動」那一組後面（同一個卡片區塊），下面一句說明', () => {
    const { root, sw } = setup(plainCard());
    const groups = all(root, 'field-group');
    const showcase = groups.findIndex((g) => g.textContent.includes('展示擺動'));
    const sleeve = groups.findIndex((g) => g.contains(sw));
    expect(showcase).toBeGreaterThanOrEqual(0);
    expect(sleeve).toBe(showcase + 1);
    expect(groups[sleeve]!.textContent).toContain(SLEEVE_LABEL);
    expect(byClass(groups[sleeve]!, 'help').textContent).toBe(SLEEVE_HELP);
  });

  it('預設關；按一下＝editCard({ view: { sleeve: true } }, commit)（記一步）；開著時再按＝關', () => {
    const off = setup(plainCard());
    expect(off.sw.getAttribute('role')).toBe('switch');
    expect(off.sw.getAttribute('aria-checked')).toBe('false');
    off.sw.click();
    expect(off.calls).toEqual([{ name: 'editCard', args: [{ view: { sleeve: true } }, 'commit'] }]);
    const on = setup(sleeveCard());
    expect(on.sw.getAttribute('aria-checked')).toBe('true');
    on.sw.click();
    expect(on.calls).toEqual([{ name: 'editCard', args: [{ view: { sleeve: false } }, 'commit'] }]);
  });

  it('鍵盤可用：開關是一般按鈕（Tab 走得到、Enter／空白鍵按）', () => {
    const { sw } = setup(plainCard());
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.getAttribute('type')).toBe('button');
    expect(sw.tabIndex).toBe(0);
  });
});

describe('頁首匯出選單「包含卡套」', () => {
  function setup() {
    const { intents, calls } = recorder();
    const turntables: { kind: TurntableKind; includeSleeve: unknown }[] = [];
    const h = createHeader(intents, {
      openLibrary: () => {},
      openNewCard: () => {},
      exportTurntable: async (kind, _started, includeSleeve) => void turntables.push({ kind, includeSleeve }),
      toggleHelp: () => {},
    });
    const el = h.el as unknown as FakeElement;
    const menu = byClass(el, 'export-menu');
    const label = all(menu, 'menu-check').find((l) => l.textContent === SLEEVE_EXPORT_LABEL);
    if (!label) throw new Error('找不到包含卡套');
    const box = label.querySelector('input') as unknown as FakeElement & { checked: boolean };
    const render = (card: Card) => h.render(toUiState(createEditor(card), () => undefined));
    return { h, el, menu, calls, turntables, label, box, render };
  }

  it('卡片沒開卡套時不出現；開了才出現；和「透明背景」在同一排', () => {
    const t = setup();
    // 選單收著（整個 hidden），看勾選自己有沒有藏起來；打開選單才看得到
    t.render(plainCard());
    expect(t.label.hidden).toBe(true);
    t.render(sleeveCard());
    expect(t.label.hidden).toBe(false);
    t.h.exportButton.click();
    expect(isShown(t.label)).toBe(true);
    t.render(plainCard());
    expect(isShown(t.label)).toBe(false);
    const transparent = all(t.menu, 'menu-check').find((l) => l.textContent.startsWith('透明背景'))!;
    expect(transparent.parentNode === t.label.parentNode).toBe(true);
  });

  it('預設勾；PNG 帶上（透明背景, 包含卡套）；勾掉之後 PNG、影片、GIF 都是 false', async () => {
    const t = setup();
    t.render(sleeveCard());
    expect(t.box.checked).toBe(true);
    t.h.exportButton.click();
    buttonWithText(t.menu, 'PNG 圖片').click();
    await flush();
    expect(t.calls.find((c) => c.name === 'exportPng')!.args[1]).toBe(true);
    t.box.checked = false;
    t.h.exportButton.click();
    buttonWithText(t.menu, 'PNG 圖片').click();
    await flush();
    expect(t.calls.filter((c) => c.name === 'exportPng')[1]!.args[1]).toBe(false);
    t.h.exportButton.click();
    buttonWithText(t.menu, '轉動影片').click();
    await flush();
    t.h.exportButton.click();
    buttonWithText(t.menu, 'GIF').click();
    await flush();
    expect(t.turntables).toEqual([
      { kind: 'webm', includeSleeve: false },
      { kind: 'gif', includeSleeve: false },
    ]);
  });
});

describe('匯出面板把「包含卡套」帶到影片、GIF 與 GIF 預估', () => {
  type Intents = Pick<UiIntents, 'exportVideo' | 'exportGif' | 'estimateGif' | 'readMusic'>;
  function setup() {
    const jobs: (VideoExportOptions | GifExportOptions)[] = [];
    const estimates: MotionRequest[] = [];
    const intents: Intents = {
      exportVideo: async (options) => {
        jobs.push(options);
        return 'cancelled' as TurntableOutcome;
      },
      exportGif: async (options) => {
        jobs.push(options);
        return 'cancelled' as TurntableOutcome;
      },
      estimateGif: async (choice) => {
        estimates.push({ ...choice });
        return null;
      },
      readMusic: async () => ({ ok: true, durationSec: 30 }),
    };
    const anchor = document.createElement('div') as unknown as HTMLElement;
    const panel = createExportPanel(intents, { changed: () => {}, anchor: () => anchor });
    return { panel, el: panel.el as unknown as FakeElement, jobs, estimates };
  }

  it('GIF 勾掉：預估與匯出都帶 includeSleeve false', async () => {
    const t = setup();
    const run = t.panel.run('gif', undefined, false);
    await flush();
    expect(t.estimates.at(-1)).toMatchObject({ includeSleeve: false });
    byClass(t.el, 'go-go').click();
    await run;
    expect(t.jobs[0]).toMatchObject({ includeSleeve: false });
  });

  it('影片勾著：帶 includeSleeve true；下一次沒給（舊的呼叫）就不帶這個欄位（跟著卡片開關）', async () => {
    const t = setup();
    const run = t.panel.run('webm', undefined, true);
    await flush();
    byClass(t.el, 'vo-go').click();
    await run;
    expect(t.jobs[0]).toMatchObject({ includeSleeve: true });
    const again = t.panel.run('gif');
    await flush();
    expect('includeSleeve' in t.estimates.at(-1)!).toBe(false);
    byClass(t.el, 'go-go').click();
    await again;
    expect('includeSleeve' in t.jobs[1]!).toBe(false);
  });
});
