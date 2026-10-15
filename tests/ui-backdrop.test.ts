// T-814 舞台背景圖的畫面（DESIGN §5「舞台背景圖」、§7.1）：
// 右欄「舞台」六顆按鈕下面一列「背景圖」：沒有時〔換成我的圖…〕＋小字；有了小縮圖＋〔換一張〕〔拿掉〕；加、換、拿掉各記一步；
// 選檔回來照 pickStillValid（回報的是按下去時那張卡）；預覽區的 CSS 那層換成背景圖（水鏡由 3D 畫）；
// 頁首〔匯出 ▾〕多「畫上背景」（有背景圖才出現、預設勾、同一次開著工坊記住、和「透明背景」只能選一個），PNG、影片、GIF 都照它；
// 說明面板多一句；鍵盤可用（原生按鈕）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { MAX_CARD_IMAGES } from '../src/model/limits';
import type { Card, StageStyle } from '../src/model/types';
import { createEditor, currentCard, redoEdit, setBackdropEdit, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createExportPanel } from '../src/ui/export-panel';
import { createHeader } from '../src/ui/header';
import { createInspector } from '../src/ui/inspector';
import {
  BACKDROP_ADD_LABEL,
  BACKDROP_CHANGE_LABEL,
  BACKDROP_EMPTY_HELP,
  BACKDROP_EXPORT_LABEL,
  BACKDROP_HELP_LINE,
  BACKDROP_REMOVE_LABEL,
  BACKDROP_TITLE,
  HELP_SECTIONS,
  problemText,
  stageBackdropView,
} from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { GifExportOptions, MotionRequest, TurntableKind, TurntableOutcome, UiIntents, UiState, VideoExportOptions } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeEvent, flush, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';
const BD = 'bbbbbbbbbbbbbbb1';
const BD2 = 'bbbbbbbbbbbbbbb2';
const plainCard = (id = 'card-1') => newCard('standard', id, T0);
const withBackdrop = (card: Card = plainCard(), hash = BD) => setBackdrop(card, hash);
const onStage = (card: Card, stage: StageStyle) => updateCard(card, { view: { stage } });

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
  it('列名、按鈕、小字、匯出勾選；說明面板多一句', () => {
    expect(BACKDROP_TITLE).toBe('背景圖');
    expect(BACKDROP_ADD_LABEL).toBe('換成我的圖…');
    expect(BACKDROP_EMPTY_HELP).toBe('放一張圖在卡片後面，每張卡各自記住。');
    expect(BACKDROP_CHANGE_LABEL).toBe('換一張');
    expect(BACKDROP_REMOVE_LABEL).toBe('拿掉');
    expect(BACKDROP_EXPORT_LABEL).toBe('畫上背景');
    expect(BACKDROP_HELP_LINE).toBe('舞台下面的〔換成我的圖…〕可以放一張自己的背景圖，匯出時也能畫上。');
    expect(HELP_SECTIONS.some((s) => s.lines.includes(BACKDROP_HELP_LINE))).toBe(true);
  });
});

describe('editor：加、換、拿掉各記一步', () => {
  it('加上 → 換一張 → 拿掉，每次一步；復原、重做照順序', () => {
    const s0 = createEditor(plainCard());
    const s1 = setBackdropEdit(s0, BD, T1);
    expect(s1.problem).toBeNull();
    expect(currentCard(s1.state).view.backdrop).toBe(BD);
    expect(currentCard(s1.state).updatedAt).toBe(T1);
    const s2 = setBackdropEdit(s1.state, BD2, T1);
    expect(currentCard(s2.state).view.backdrop).toBe(BD2);
    const s3 = setBackdropEdit(s2.state, null, T1);
    expect('backdrop' in currentCard(s3.state).view).toBe(false);
    expect(currentCard(undoEdit(s3.state)).view.backdrop).toBe(BD2);
    expect(currentCard(undoEdit(undoEdit(s3.state))).view.backdrop).toBe(BD);
    expect('backdrop' in currentCard(undoEdit(undoEdit(undoEdit(s3.state)))).view).toBe(false);
    expect(currentCard(redoEdit(undoEdit(s3.state))).view.backdrop).toBeUndefined();
  });

  it('同一張再設、沒有時拿掉：不記步、沒有問題', () => {
    const s1 = setBackdropEdit(createEditor(plainCard()), BD, T1).state;
    const again = setBackdropEdit(s1, BD, T1);
    expect(again.state.history).toBe(s1.history);
    expect(again.problem).toBeNull();
    const none = createEditor(plainCard());
    expect(setBackdropEdit(none, null, T1).state.history).toBe(none.history);
  });

  it('圖滿了（16 張）→ problem too-many-images、卡不變；提示照現有的「圖滿了」說法', () => {
    let card = plainCard();
    const layers = Array.from({ length: MAX_CARD_IMAGES }, (_, i) => ({
      id: `l${i}`,
      name: `圖${i}`,
      role: 'depth' as const,
      image: (0xa00 + i).toString(16).padStart(16, '0'),
      visible: true,
      depth: 50,
      x: 0,
      y: 0,
      scale: 1,
      holo: true,
      hasAlpha: true,
    }));
    card = { ...card, front: { layers: layers.slice(0, 8) }, back: { layers: layers.slice(8) } };
    const s = createEditor(card);
    const r = setBackdropEdit(s, BD, T1);
    expect(r.problem).toBe('too-many-images');
    expect(r.state.history).toBe(s.history);
    expect(problemText('too-many-images')).toContain('16 張');
  });
});

describe('右欄「舞台」的「背景圖」一列', () => {
  function mount() {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    const root = inspector.el as unknown as FakeElement;
    const render = (s: EditorState) => inspector.render(toUiState(s, (h) => `blob:${h}`) as UiState);
    const block = () => byClass(root, 'backdrop-block');
    const fileInput = () => byClass(block(), 'backdrop-file');
    const pick = (name: string) => {
      const file = { name } as File;
      fileInput().files = [file];
      fileInput().dispatchEvent(new FakeEvent('change'));
      return file;
    };
    return { root, calls, render, block, fileInput, pick };
  }

  it('在舞台六顆按鈕下面（同一個「舞台」小節；中間只隔著水鏡才顯示的「水面」〔T-825〕與「遠景」〔T-815〕）', () => {
    const t = mount();
    t.render(createEditor(plainCard()));
    const group = all(t.root, 'field-group').find((g) => all(g, 'stage-grid').length > 0 && !g.classList.contains('backdrop-block'));
    expect(group).toBeDefined();
    // T-836 起小節的內容包在一層 .section-body（CSS display: contents，版面不變、收起時一起藏）裡：看直接裝著六顆按鈕的那一層
    const holder = byClass(group, 'stage-grid').parentNode as FakeElement;
    expect(holder === group || (holder.classList.contains('section-body') && holder.parentNode === group)).toBe(true);
    const kids = (holder.children as unknown as FakeElement[]).filter(
      (k) => !k.classList.contains('water-scene-block') && !k.classList.contains('water-look-block'),
    );
    const grid = kids.findIndex((k) => k.classList.contains('stage-grid'));
    expect(kids[grid + 1]).toBe(t.block());
    expect(t.block().textContent).toContain(BACKDROP_TITLE);
  });

  it('沒有背景圖：〔換成我的圖…〕（原生按鈕）＋小字；沒有縮圖、〔換一張〕〔拿掉〕', () => {
    const t = mount();
    t.render(createEditor(plainCard()));
    const add = buttonWithText(t.block(), BACKDROP_ADD_LABEL);
    expect(add.tagName).toBe('BUTTON');
    expect(isShown(add)).toBe(true);
    expect(isShown(byClass(t.block(), 'backdrop-empty-help'))).toBe(true);
    expect(byClass(t.block(), 'backdrop-empty-help').textContent).toBe(BACKDROP_EMPTY_HELP);
    expect(isShown(byClass(t.block(), 'backdrop-row'))).toBe(false);
  });

  it('〔換成我的圖…〕→ 打開選檔視窗；選了 → uploadBackdrop(檔, 這張卡)；取消（沒選）不做事', () => {
    const t = mount();
    t.render(createEditor(plainCard()));
    let opened = 0;
    t.fileInput().addEventListener('click', () => opened++);
    buttonWithText(t.block(), BACKDROP_ADD_LABEL).click();
    expect(opened).toBe(1);
    const file = t.pick('fuji.png');
    expect(t.calls).toEqual([{ name: 'uploadBackdrop', args: [file, 'card-1'] }]);
    t.calls.length = 0;
    t.fileInput().files = [];
    t.fileInput().dispatchEvent(new FakeEvent('change'));
    expect(t.calls).toEqual([]);
  });

  it('選檔視窗開著時換了卡：回報的是按下去時那張卡（main 用 pickStillValid 對不上就不套用）', () => {
    const t = mount();
    t.render(createEditor(plainCard('card-1')));
    buttonWithText(t.block(), BACKDROP_ADD_LABEL).click();
    t.render(createEditor(plainCard('card-2')));
    const file = t.pick('fuji.png');
    expect(t.calls).toEqual([{ name: 'uploadBackdrop', args: [file, 'card-1'] }]);
  });

  it('沒按過按鈕就收到選檔結果（不該發生）：不做事', () => {
    const t = mount();
    t.render(createEditor(plainCard()));
    t.pick('stray.png');
    expect(t.calls).toEqual([]);
  });

  it('有背景圖：小縮圖（背景圖的網址）＋〔換一張〕〔拿掉〕；〔換成我的圖…〕與小字藏起來', () => {
    const t = mount();
    t.render(createEditor(withBackdrop()));
    expect(isShown(byClass(t.block(), 'backdrop-row'))).toBe(true);
    expect(byClass(t.block(), 'backdrop-thumb').getAttribute('src')).toBe(`blob:${BD}`);
    expect(isShown(buttonWithText(t.block(), BACKDROP_ADD_LABEL))).toBe(false);
    expect(isShown(byClass(t.block(), 'backdrop-empty-help'))).toBe(false);
    expect(isShown(buttonWithText(t.block(), BACKDROP_CHANGE_LABEL))).toBe(true);
    expect(isShown(buttonWithText(t.block(), BACKDROP_REMOVE_LABEL))).toBe(true);
  });

  it('〔換一張〕→ 選檔 → uploadBackdrop；〔拿掉〕→ removeBackdrop()', () => {
    const t = mount();
    t.render(createEditor(withBackdrop()));
    buttonWithText(t.block(), BACKDROP_CHANGE_LABEL).click();
    const file = t.pick('lake.webp');
    buttonWithText(t.block(), BACKDROP_REMOVE_LABEL).click();
    expect(t.calls).toEqual([
      { name: 'uploadBackdrop', args: [file, 'card-1'] },
      { name: 'removeBackdrop', args: [] },
    ]);
  });

  it('鍵盤可用：都是原生按鈕（Tab 走得到、Enter／空白鍵按）；選檔的輸入框不在 Tab 順序裡', () => {
    const t = mount();
    t.render(createEditor(withBackdrop()));
    for (const label of [BACKDROP_CHANGE_LABEL, BACKDROP_REMOVE_LABEL]) {
      const b = buttonWithText(t.block(), label);
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('tabindex')).toBeNull();
    }
    expect(t.fileInput().getAttribute('tabindex')).toBe('-1');
    expect(t.fileInput().getAttribute('accept')).toBe('image/png,image/webp,image/jpeg');
  });

  it('光碟也有這一列（舞台小節不藏）', () => {
    const t = mount();
    const disc = { ...plainCard(), kind: 'disc' as const, aspect: 'square' as const };
    t.render(createEditor(disc));
    expect(isShown(t.block())).toBe(true);
  });
});

describe('預覽區的背景（CSS 那層）', () => {
  it('stageBackdropView：有背景圖＝那張（custom）；水鏡由 3D 畫遠景，CSS 照舊；沒有背景圖＝正面底圖模糊版', () => {
    const base = {
      id: 'bg',
      name: 'bg',
      role: 'base' as const,
      image: 'aaaaaaaaaaaaaaa0',
      visible: true,
      depth: 0,
      x: 0,
      y: 0,
      scale: 1,
      holo: false,
      hasAlpha: false,
    };
    // 新卡片預設是工作桌（T-832c，底圖在 CSS 那層、不走模糊版）：這個測試看的是全息光環等舞台，先換過去
    const halo = (c: Card) => onStage(c, 'halo');
    const card = halo({ ...plainCard(), front: { layers: [base] } });
    expect(stageBackdropView(card)).toEqual({ hash: 'aaaaaaaaaaaaaaa0', custom: false });
    expect(stageBackdropView(withBackdrop(card))).toEqual({ hash: BD, custom: true });
    for (const stage of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
      expect(stageBackdropView(onStage(withBackdrop(card), stage))).toEqual({ hash: BD, custom: true });
    }
    expect(stageBackdropView(onStage(withBackdrop(card), 'water'))).toEqual({ hash: 'aaaaaaaaaaaaaaa0', custom: false });
    expect(stageBackdropView(withBackdrop(plainCard()))).toEqual({ hash: BD, custom: true });
    expect(stageBackdropView(halo(plainCard()))).toBeNull();
  });

  it('舞台元素：有背景圖時 has-backdrop（CSS 不讓各舞台的底色蓋掉它）、那層 is-custom、圖換成背景圖；拿掉就恢復', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const el = stage.el as unknown as FakeElement;
    const layer = byClass(el, 'stage-backdrop');
    const img = byClass(el, 'stage-backdrop-img');
    const render = (card: Card) => stage.render(toUiState(createEditor(card), (h) => `blob:${h}`));
    for (const s of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
      render(onStage(withBackdrop(), s));
      expect(el.classList.contains('has-backdrop'), s).toBe(true);
      expect(layer.classList.contains('is-custom'), s).toBe(true);
      expect(img.getAttribute('src')).toBe(`blob:${BD}`);
    }
    render(onStage(withBackdrop(), 'water'));
    expect(el.classList.contains('has-backdrop')).toBe(false);
    expect(layer.classList.contains('is-custom')).toBe(false);
    render(plainCard());
    expect(el.classList.contains('has-backdrop')).toBe(false);
    expect(img.getAttribute('src')).toBeNull();
  });
});

describe('頁首匯出選單「畫上背景」', () => {
  function setup() {
    const { intents, calls } = recorder();
    const turntables: { kind: TurntableKind; includeSleeve: unknown; includeBackdrop: unknown }[] = [];
    const h = createHeader(intents, {
      openLibrary: () => {},
      openNewCard: () => {},
      exportTurntable: async (kind, _started, includeSleeve, includeBackdrop) => void turntables.push({ kind, includeSleeve, includeBackdrop }),
      toggleHelp: () => {},
    });
    const el = h.el as unknown as FakeElement;
    const menu = byClass(el, 'export-menu');
    const checkOf = (text: string) => {
      const label = all(menu, 'menu-check').find((l) => l.textContent.startsWith(text));
      if (!label) throw new Error(`找不到 ${text}`);
      return { label, box: label.querySelector('input') as unknown as FakeElement & { checked: boolean } };
    };
    const backdrop = checkOf(BACKDROP_EXPORT_LABEL);
    const transparent = checkOf('透明背景');
    const render = (card: Card) => h.render(toUiState(createEditor(card), () => undefined));
    const toggle = (box: FakeElement & { checked: boolean }, on: boolean) => {
      box.checked = on;
      box.dispatchEvent(new FakeEvent('change'));
    };
    const png = async () => {
      h.exportButton.click();
      buttonWithText(menu, 'PNG 圖片').click();
      await flush();
      return calls.filter((c) => c.name === 'exportPng').at(-1)!.args;
    };
    return { h, el, menu, calls, turntables, backdrop, transparent, render, toggle, png };
  }

  it('這張卡沒有背景圖時不出現；有了才出現；和「透明背景」在同一排', () => {
    const t = setup();
    t.render(plainCard());
    expect(t.backdrop.label.hidden).toBe(true);
    t.render(withBackdrop());
    expect(t.backdrop.label.hidden).toBe(false);
    expect(t.backdrop.label.parentNode === t.transparent.label.parentNode).toBe(true);
  });

  it('預設勾；PNG 帶上（透明背景 false、包含卡套、畫上背景 true）', async () => {
    const t = setup();
    t.render(withBackdrop());
    expect(t.backdrop.box.checked).toBe(true);
    expect(t.transparent.box.checked).toBe(false);
    expect(await t.png()).toEqual([false, true, true, false]);
  });

  it('和「透明背景」只能選一個：勾一個另一個自動取消（兩個方向都是）', async () => {
    const t = setup();
    t.render(withBackdrop());
    t.toggle(t.transparent.box, true);
    expect(t.backdrop.box.checked).toBe(false);
    expect(await t.png()).toEqual([true, true, false, false]);
    t.toggle(t.backdrop.box, true);
    expect(t.transparent.box.checked).toBe(false);
    expect(await t.png()).toEqual([false, true, true, false]);
    // 取消勾選不影響另一個
    t.toggle(t.backdrop.box, false);
    expect(t.transparent.box.checked).toBe(false);
  });

  it('同一次開著工坊記住：勾掉之後換別張卡再換回來，還是勾掉', () => {
    const t = setup();
    t.render(withBackdrop());
    t.toggle(t.backdrop.box, false);
    t.render(plainCard('card-2'));
    t.render(withBackdrop(plainCard('card-3'), BD2));
    expect(t.backdrop.box.checked).toBe(false);
  });

  it('影片、GIF 也照它（勾著 true、勾掉 false）', async () => {
    const t = setup();
    t.render(withBackdrop());
    t.h.exportButton.click();
    buttonWithText(t.menu, '轉動影片').click();
    await flush();
    t.toggle(t.backdrop.box, false);
    t.h.exportButton.click();
    buttonWithText(t.menu, 'GIF').click();
    await flush();
    expect(t.turntables.map((x) => [x.kind, x.includeBackdrop])).toEqual([
      ['webm', true],
      ['gif', false],
    ]);
  });
});

describe('匯出面板把「畫上背景」帶到影片、GIF 與 GIF 預估', () => {
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

  it('GIF 勾掉：預估與匯出都帶 includeBackdrop false（預估照實際的畫格估大小）', async () => {
    const t = setup();
    const run = t.panel.run('gif', undefined, true, false);
    await flush();
    expect(t.estimates.at(-1)).toMatchObject({ includeSleeve: true, includeBackdrop: false });
    byClass(t.el, 'go-go').click();
    await run;
    expect(t.jobs[0]).toMatchObject({ includeSleeve: true, includeBackdrop: false });
  });

  it('影片勾著：帶 includeBackdrop true；下一次沒給就不帶這個欄位（跟著卡片）', async () => {
    const t = setup();
    const run = t.panel.run('webm', undefined, undefined, true);
    await flush();
    byClass(t.el, 'vo-go').click();
    await run;
    expect(t.jobs[0]).toMatchObject({ includeBackdrop: true });
    expect('includeSleeve' in t.jobs[0]!).toBe(false);
    const again = t.panel.run('gif');
    await flush();
    expect('includeBackdrop' in t.estimates.at(-1)!).toBe(false);
    byClass(t.el, 'go-go').click();
    await again;
    expect('includeBackdrop' in t.jobs[1]!).toBe(false);
  });
});
