// T-830 前景圖的畫面（DESIGN §5「前景圖」）：
// 右欄舞台小節「背景圖」（與它的「位置」）下面多「前景圖」：沒有時〔加上前景圖…〕＋小字；有了小縮圖＋〔換一張〕〔拿掉〕＋
// 〔左右〕〔上下〕〔大小〕〔模糊〕滑桿＋〔置中〕；加、換、拿掉各記一步；拖滑桿即時看（preview）、停手記一步（commit）；
// 選檔回來照 pickStillValid（回報的是按下去時那張卡）。
// 預覽區：疊在 3D 畫布上面（選取框下面）、滑鼠穿過它（pointer-events: none）、照 render/backdrop.ts 的 foregroundCss 擺；
// 轉卡時的微動走 driftForeground。頁首〔匯出 ▾〕的「畫上背景」在只有前景圖時也出現。文字一律 textContent。
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foregroundOf, setBackdrop, setForeground, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { MAX_CARD_IMAGES } from '../src/model/limits';
import type { Card, Foreground } from '../src/model/types';
import { foregroundCss } from '../src/render/backdrop';
import { createEditor, currentCard, editCard, redoEdit, setForegroundEdit, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createHeader } from '../src/ui/header';
import { createInspector } from '../src/ui/inspector';
import {
  BACKDROP_CHANGE_LABEL,
  BACKDROP_EXPORT_LABEL,
  BACKDROP_EXPORT_TIP,
  BACKDROP_REMOVE_LABEL,
  FAR_PAN_CENTER_LABEL,
  FAR_PAN_X_LABEL,
  FAR_PAN_Y_LABEL,
  FAR_PAN_ZOOM_LABEL,
  FOREGROUND_ADD_LABEL,
  FOREGROUND_BLUR_LABEL,
  FOREGROUND_EMPTY_HELP,
  FOREGROUND_EXPORT_TIP,
  FOREGROUND_HELP,
  FOREGROUND_TITLE,
} from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';
const FG = 'fffffffffffffff1';
const FG2 = 'fffffffffffffff2';
const plainCard = (id = 'card-1') => newCard('standard', id, T0);
const withFg = (card: Card = plainCard(), hash = FG) => setForeground(card, hash);
const moved = (p: Partial<Omit<Foreground, 'image'>>, card: Card = withFg()) => updateCard(card, { view: { foreground: p } });

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

/** 拖滑桿：改值、送 input（預覽）；end＝放開（change＝記一步）。 */
function drag(input: FakeElement, value: string, end = false) {
  input.value = value;
  input.dispatchEvent(new FakeEvent('input'));
  if (end) input.dispatchEvent(new FakeEvent('change'));
}

describe('文字照 DESIGN', () => {
  it('列名、〔加上前景圖…〕、〔換一張〕〔拿掉〕（和背景圖同一組字）、〔左右〕〔上下〕〔大小〕（和遠景位置同一組字）〔模糊〕〔置中〕', () => {
    expect(FOREGROUND_TITLE).toBe('前景圖');
    expect(FOREGROUND_ADD_LABEL).toBe('加上前景圖…');
    expect(BACKDROP_CHANGE_LABEL).toBe('換一張');
    expect(BACKDROP_REMOVE_LABEL).toBe('拿掉');
    expect([FAR_PAN_X_LABEL, FAR_PAN_Y_LABEL, FAR_PAN_ZOOM_LABEL, FOREGROUND_BLUR_LABEL, FAR_PAN_CENTER_LABEL]).toEqual(['左右', '上下', '大小', '模糊', '置中']);
    expect(FOREGROUND_EMPTY_HELP).toContain('透明背景');
    expect(FOREGROUND_HELP.length).toBeGreaterThan(0);
    expect(FOREGROUND_EXPORT_TIP).toContain('前景圖');
  });
});

describe('editor：加、換、拿掉各記一步', () => {
  it('加上（左下角、模糊 40）→ 換一張（位置照舊）→ 拿掉，每次一步；復原、重做照順序', () => {
    const s0 = createEditor(plainCard());
    const s1 = setForegroundEdit(s0, FG, T1);
    expect(s1.problem).toBeNull();
    expect(currentCard(s1.state).view.foreground).toEqual({ image: FG, x: -0.7, y: -0.6, scale: 1, blur: 40 });
    expect(currentCard(s1.state).updatedAt).toBe(T1);
    const s2 = setForegroundEdit(s1.state, FG2, T1);
    expect(currentCard(s2.state).view.foreground?.image).toBe(FG2);
    const s3 = setForegroundEdit(s2.state, null, T1);
    expect('foreground' in currentCard(s3.state).view).toBe(false);
    expect(currentCard(undoEdit(s3.state)).view.foreground?.image).toBe(FG2);
    expect(currentCard(undoEdit(undoEdit(s3.state))).view.foreground?.image).toBe(FG);
    expect('foreground' in currentCard(undoEdit(undoEdit(undoEdit(s3.state)))).view).toBe(false);
    expect(currentCard(redoEdit(undoEdit(s3.state))).view.foreground).toBeUndefined();
  });

  it('同一張再設、沒有時拿掉：不記步、沒有問題；圖滿了（16 張）→ too-many-images、卡不變', () => {
    const s1 = setForegroundEdit(createEditor(plainCard()), FG, T1).state;
    const again = setForegroundEdit(s1, FG, T1);
    expect(again.state.history).toBe(s1.history);
    expect(again.problem).toBeNull();
    const none = createEditor(plainCard());
    expect(setForegroundEdit(none, null, T1).state.history).toBe(none.history);
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
    const full = createEditor({ ...plainCard(), front: { layers: layers.slice(0, 8) }, back: { layers: layers.slice(8) } });
    const r = setForegroundEdit(full, FG, T1);
    expect(r.problem).toBe('too-many-images');
    expect(r.state.history).toBe(full.history);
  });
});

describe('右欄「舞台」的「前景圖」', () => {
  function mount() {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    const root = inspector.el as unknown as FakeElement;
    const render = (card: Card) => inspector.render(toUiState(createEditor(card), (h) => `blob:${h}`) as UiState);
    const block = () => byClass(root, 'foreground-block');
    const fileInput = () => byClass(block(), 'foreground-file');
    const sliders = () => all(block(), 'slider');
    const field = (i: number) => sliders()[i]!.parentNode as FakeElement;
    const center = () => byClass(block(), 'foreground-center');
    const pick = (name: string) => {
      const file = { name } as File;
      fileInput().files = [file];
      fileInput().dispatchEvent(new FakeEvent('change'));
      return file;
    };
    const edits = () => calls.filter((c) => c.name === 'editCard').map((c) => c.args);
    return { root, calls, render, block, fileInput, sliders, field, center, pick, edits };
  }

  it('在同一個「舞台」小節、背景圖的「位置」下面', () => {
    const t = mount();
    t.render(plainCard());
    const parent = t.block().parentNode as FakeElement;
    const kids = parent.childNodes as FakeElement[];
    const at = (cls: string) => kids.findIndex((k) => k.classList?.contains(cls));
    expect(at('backdrop-block')).toBeGreaterThan(-1);
    expect(at('far-pan-block')).toBe(at('backdrop-block') + 1);
    expect(at('foreground-block')).toBe(at('far-pan-block') + 1);
    expect(t.block().textContent).toContain(FOREGROUND_TITLE);
  });

  it('沒有前景圖：〔加上前景圖…〕（原生按鈕）＋小字；沒有縮圖、按鈕、滑桿', () => {
    const t = mount();
    t.render(plainCard());
    const add = buttonWithText(t.block(), FOREGROUND_ADD_LABEL);
    expect(add.tagName).toBe('BUTTON');
    expect(isShown(add)).toBe(true);
    expect(byClass(t.block(), 'foreground-empty-help').textContent).toBe(FOREGROUND_EMPTY_HELP);
    expect(isShown(byClass(t.block(), 'foreground-empty-help'))).toBe(true);
    expect(isShown(byClass(t.block(), 'foreground-row'))).toBe(false);
    expect(isShown(byClass(t.block(), 'foreground-place'))).toBe(false);
  });

  it('〔加上前景圖…〕→ 選檔 → uploadForeground(檔, 這張卡)；選檔期間換了卡回報按下去時那張；沒按過不做事', () => {
    const t = mount();
    t.render(plainCard('card-1'));
    let opened = 0;
    t.fileInput().addEventListener('click', () => opened++);
    buttonWithText(t.block(), FOREGROUND_ADD_LABEL).click();
    expect(opened).toBe(1);
    t.render(plainCard('card-2'));
    const file = t.pick('branch.png');
    expect(t.calls).toEqual([{ name: 'uploadForeground', args: [file, 'card-1'] }]);
    t.calls.length = 0;
    t.pick('stray.png');
    expect(t.calls).toEqual([]);
    expect(t.fileInput().getAttribute('tabindex')).toBe('-1');
    expect(t.fileInput().getAttribute('accept')).toBe('image/png,image/webp,image/jpeg');
  });

  it('有前景圖：小縮圖（前景圖的網址）＋〔換一張〕〔拿掉〕＋五個控制；〔換一張〕→ uploadForeground、〔拿掉〕→ removeForeground()', () => {
    const t = mount();
    t.render(withFg());
    expect(isShown(byClass(t.block(), 'foreground-row'))).toBe(true);
    expect(byClass(t.block(), 'foreground-thumb').getAttribute('src')).toBe(`blob:${FG}`);
    expect(isShown(buttonWithText(t.block(), FOREGROUND_ADD_LABEL))).toBe(false);
    expect(isShown(byClass(t.block(), 'foreground-empty-help'))).toBe(false);
    expect(isShown(byClass(t.block(), 'foreground-place'))).toBe(true);
    const text = t.block().textContent;
    for (const s of [FAR_PAN_X_LABEL, FAR_PAN_Y_LABEL, FAR_PAN_ZOOM_LABEL, FOREGROUND_BLUR_LABEL, FAR_PAN_CENTER_LABEL, FOREGROUND_HELP]) expect(text).toContain(s);
    buttonWithText(t.block(), BACKDROP_CHANGE_LABEL).click();
    const file = t.pick('petal.webp');
    buttonWithText(t.block(), BACKDROP_REMOVE_LABEL).click();
    expect(t.calls).toEqual([
      { name: 'uploadForeground', args: [file, 'card-1'] },
      { name: 'removeForeground', args: [] },
    ]);
  });

  it('滑桿：左右、上下 −100～100、大小 50～300（%）、模糊 0～100；數字跟著卡片（左右往右＝往右、上下往右＝往上）', () => {
    const t = mount();
    t.render(moved({ x: 0.35, y: -0.8, scale: 1.5, blur: 62 }));
    const [x, y, s, b] = t.sliders();
    expect([x!.getAttribute('min'), x!.getAttribute('max')]).toEqual(['-100', '100']);
    expect([y!.getAttribute('min'), y!.getAttribute('max')]).toEqual(['-100', '100']);
    expect([s!.getAttribute('min'), s!.getAttribute('max')]).toEqual(['50', '300']);
    expect([b!.getAttribute('min'), b!.getAttribute('max')]).toEqual(['0', '100']);
    expect([x!.value, y!.value, s!.value, b!.value]).toEqual(['35', '-80', '150', '62']);
    expect(byClass(t.field(2), 'field-value').textContent).toBe('150%');
    expect(byClass(t.field(3), 'field-value').textContent).toBe('62');
    expect(b!.getAttribute('aria-label')).toBe(FOREGROUND_BLUR_LABEL);
  });

  it('拖滑桿：拖著 preview、放開 commit，只給自己那個欄位（÷ 100；模糊照整數）', () => {
    const t = mount();
    t.render(withFg());
    drag(t.sliders()[0]!, '20');
    drag(t.sliders()[0]!, '-45', true);
    drag(t.sliders()[1]!, '60', true);
    drag(t.sliders()[2]!, '150', true);
    drag(t.sliders()[3]!, '75', true);
    expect(t.edits()).toEqual([
      [{ view: { foreground: { x: 0.2 } } }, 'preview'],
      [{ view: { foreground: { x: -0.45 } } }, 'preview'],
      [{ view: { foreground: { x: -0.45 } } }, 'commit'],
      [{ view: { foreground: { y: 0.6 } } }, 'preview'],
      [{ view: { foreground: { y: 0.6 } } }, 'commit'],
      [{ view: { foreground: { scale: 1.5 } } }, 'preview'],
      [{ view: { foreground: { scale: 1.5 } } }, 'commit'],
      [{ view: { foreground: { blur: 75 } } }, 'preview'],
      [{ view: { foreground: { blur: 75 } } }, 'commit'],
    ]);
  });

  it('〔置中〕：一按記一步（左右、上下回到 0，大小、模糊不動）；已經置中時變淡', () => {
    const t = mount();
    t.render(withFg());
    expect(t.center().tagName.toLowerCase()).toBe('button');
    expect(t.center().disabled).toBe(false);
    t.center().dispatchEvent(new FakeEvent('click'));
    expect(t.edits()).toEqual([[{ view: { foreground: { x: 0, y: 0 } } }, 'commit']]);
    t.render(moved({ x: 0, y: 0, scale: 2 }));
    expect(t.center().disabled).toBe(true);
  });

  it('接上編輯器：拖的時候不記步、放開一步；復原回到拖之前', () => {
    let state: EditorState = createEditor(withFg());
    const { intents } = recorder();
    const real = new Proxy(intents, {
      get: (tgt, name: string) =>
        name === 'editCard'
          ? (patch: Parameters<UiIntents['editCard']>[0], phase: Parameters<UiIntents['editCard']>[1]) => {
              state = editCard(state, patch, phase, T1);
            }
          : (tgt as unknown as Record<string, unknown>)[name],
    });
    const inspector = createInspector(real);
    const root = inspector.el as unknown as FakeElement;
    inspector.render(toUiState(state, (h) => `blob:${h}`));
    const blur = all(byClass(root, 'foreground-block'), 'slider')[3]!;
    drag(blur, '55');
    drag(blur, '90');
    expect(foregroundOf(currentCard(state))?.blur).toBe(90);
    expect(state.history.past).toHaveLength(0);
    blur.dispatchEvent(new FakeEvent('change'));
    expect(state.history.past).toHaveLength(1);
    state = undoEdit(state);
    expect(foregroundOf(currentCard(state))?.blur).toBe(40);
  });
});

describe('預覽區：前景圖那層', () => {
  function stage() {
    const { intents } = recorder();
    const s = createStage(intents);
    const el = s.el as unknown as FakeElement;
    const layer = byClass(el, 'stage-foreground');
    const img = byClass(el, 'stage-foreground-img');
    const render = (card: Card) => s.render(toUiState(createEditor(card), (h) => `blob:${h}`));
    return { s, el, layer, img, render };
  }

  it('在預覽區裡、3D 畫布上面、選取框下面；不給輔助技術讀（aria-hidden）', () => {
    const t = stage();
    const view = byClass(t.el, 'stage-view');
    const kids = view.childNodes as FakeElement[];
    const at = (cls: string) => kids.findIndex((k) => k.classList?.contains(cls));
    expect(at('stage-foreground')).toBeGreaterThan(at('preview-host'));
    expect(at('stage-foreground')).toBeLessThan(at('overlay-host'));
    expect(t.layer.getAttribute('aria-hidden')).toBe('true');
  });

  it('有前景圖：圖換成那張、has-image、位置變數照 foregroundCss；拿掉就收起來（沒有 src）', () => {
    const t = stage();
    t.render(plainCard());
    expect(t.layer.classList.contains('has-image')).toBe(false);
    expect(t.img.getAttribute('src')).toBeNull();
    const card = moved({ x: 0.25, y: 0.1, scale: 2, blur: 70 });
    t.render(card);
    expect(t.img.getAttribute('src')).toBe(`blob:${FG}`);
    expect(t.layer.classList.contains('has-image')).toBe(true);
    const css = foregroundCss(foregroundOf(card)!);
    expect(t.layer.style.getPropertyValue('--fg-left')).toBe(css.left);
    expect(t.layer.style.getPropertyValue('--fg-top')).toBe(css.top);
    expect(t.layer.style.getPropertyValue('--fg-size')).toBe(css.size);
    expect(t.layer.style.getPropertyValue('--fg-blur')).toBe(css.blur);
    t.render(setBackdrop(plainCard(), 'bbbbbbbbbbbbbbb1'));
    expect(t.layer.classList.contains('has-image')).toBe(false);
    expect(t.img.getAttribute('src')).toBeNull();
    expect(t.layer.style.getPropertyValue('--fg-left')).toBe('');
  });

  it('轉卡微動：driftForeground(x, y) → --fg-dx／--fg-dy（畫面寬的 %＝cqw）；回到 0 拿掉', () => {
    const t = stage();
    t.render(withFg());
    t.s.driftForeground(-1.25, 0.5);
    expect(t.layer.style.getPropertyValue('--fg-dx')).toBe('-1.25cqw');
    expect(t.layer.style.getPropertyValue('--fg-dy')).toBe('0.5cqw');
    t.s.driftForeground(0, 0);
    expect(t.layer.style.getPropertyValue('--fg-dx')).toBe('');
    expect(t.layer.style.getPropertyValue('--fg-dy')).toBe('');
  });

  it('style.css：那層不接滑鼠（拖卡、點圖層照舊）、照變數擺、用 CSS 模糊', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const rule = (sel: string) => {
      const m = new RegExp(`(^|\\n)${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
      if (!m) throw new Error(`找不到 ${sel}`);
      return m[2]!;
    };
    expect(rule('.stage-foreground')).toMatch(/pointer-events:\s*none/);
    const img = rule('.stage-foreground-img');
    expect(img).toMatch(/pointer-events:\s*none/);
    expect(img).toMatch(/var\(--fg-left/);
    expect(img).toMatch(/var\(--fg-size/);
    expect(img).toMatch(/blur\(var\(--fg-blur/);
    expect(img).toMatch(/object-fit:\s*contain/);
  });
});

describe('頁首匯出選單「畫上背景」', () => {
  function setup() {
    const { intents, calls } = recorder();
    const h = createHeader(intents, { openLibrary: () => {}, openNewCard: () => {}, exportTurntable: async () => {}, toggleHelp: () => {} });
    const el = h.el as unknown as FakeElement;
    const menu = byClass(el, 'export-menu');
    const label = all(menu, 'menu-check').find((l) => l.textContent.startsWith(BACKDROP_EXPORT_LABEL))!;
    const render = (card: Card) => h.render(toUiState(createEditor(card), () => undefined));
    return { label, render, calls };
  }

  it('只有前景圖也出現（說明提到前景圖）；只有背景圖照舊；都沒有不出現', () => {
    const t = setup();
    t.render(plainCard());
    expect(t.label.hidden).toBe(true);
    t.render(withFg());
    expect(t.label.hidden).toBe(false);
    expect((t.label as unknown as { title: string }).title).toBe(FOREGROUND_EXPORT_TIP);
    t.render(setBackdrop(plainCard(), 'bbbbbbbbbbbbbbb1'));
    expect(t.label.hidden).toBe(false);
    expect((t.label as unknown as { title: string }).title).toBe(BACKDROP_EXPORT_TIP);
    t.render(withFg(setBackdrop(plainCard(), 'bbbbbbbbbbbbbbb1')));
    expect((t.label as unknown as { title: string }).title).toBe(FOREGROUND_EXPORT_TIP);
  });
});

// main.ts 每影格的微動接線（有前景圖才算、減少動態給 0, 0）：實際載入 main.ts 跑影格，見 tests/app-foreground-drift.test.ts
