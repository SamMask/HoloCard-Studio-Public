// T-822 遠景位置的畫面（DESIGN §5「遠景位置」）：
// 右欄舞台小節，在「遠景」與「背景圖」下面多一小節「位置」：〔左右〕〔上下〕〔大小〕三個滑桿＋數字（−100～100、−100～100、100～300%）
// ＋〔置中〕＋一句「調整遠景擺在卡片後面的位置」；只有預覽區看得到遠景時出現（有自己的背景圖，或舞台是水鏡）；
// 水鏡時〔上下〕變淡＋說明；拖滑桿即時看（preview）、停手記一步（commit）；〔置中〕記一步；換背景圖、換遠景不歸零。
// 預覽區 CSS 那層（自己的背景圖）照同一個算法擺（render/backdrop.ts 的 farPanCss）。文字一律 textContent。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { farPanOf, setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, FarPan, StageStyle } from '../src/model/types';
import { farPanCss } from '../src/render/backdrop';
import { createEditor, currentCard, editCard, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import {
  FAR_PAN_CENTER_LABEL,
  FAR_PAN_HELP,
  FAR_PAN_TITLE,
  FAR_PAN_WATER_NOTE,
  FAR_PAN_ZOOM_HINT,
  FAR_PAN_X_LABEL,
  FAR_PAN_Y_LABEL,
  FAR_PAN_ZOOM_LABEL,
  farPanShown,
} from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';
const BD = 'bbbbbbbbbbbbbbb1';

beforeEach(() => {
  installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const plainCard = (id = 'card-1') => newCard('standard', id, T0);
const onStage = (card: Card, stage: StageStyle) => updateCard(card, { view: { stage } });
const withBackdrop = (card: Card = plainCard()) => setBackdrop(card, BD);
const panned = (p: Partial<FarPan>, card: Card) => updateCard(card, { view: { farPan: p } });

function mount() {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const root = inspector.el as unknown as FakeElement;
  const render = (card: Card) => inspector.render(toUiState(createEditor(card), (h) => `blob:${h}`));
  const block = () => byClass(root, 'far-pan-block');
  const sliders = () => all(block(), 'slider');
  const field = (i: number) => sliders()[i]!.parentNode as FakeElement;
  const center = () => byClass(block(), 'far-pan-center');
  const note = () => byClass(block(), 'far-pan-water-note');
  const edits = () => calls.filter((c) => c.name === 'editCard').map((c) => c.args);
  return { root, calls, render, block, sliders, field, center, note, edits };
}

/** 拖滑桿：改值、送 input（預覽）；end＝放開（change＝記一步）。 */
function drag(input: FakeElement, value: string, end = false) {
  input.value = value;
  input.dispatchEvent(new FakeEvent('input'));
  if (end) input.dispatchEvent(new FakeEvent('change'));
}

describe('文字照 DESIGN', () => {
  it('小節名、三個滑桿、按鈕、說明、水鏡的說明', () => {
    expect(FAR_PAN_TITLE).toBe('位置');
    expect([FAR_PAN_X_LABEL, FAR_PAN_Y_LABEL, FAR_PAN_ZOOM_LABEL]).toEqual(['左右', '上下', '大小']);
    expect(FAR_PAN_CENTER_LABEL).toBe('置中');
    expect(FAR_PAN_HELP).toBe('調整遠景擺在卡片後面的位置');
    expect(FAR_PAN_WATER_NOTE).toBe('水鏡的遠景貼著水平線，只能左右移和放大');
  });

  it('畫面上的字：小節名、三個滑桿的名字、按鈕、說明（textContent）', () => {
    const m = mount();
    m.render(withBackdrop());
    const text = m.block().textContent;
    for (const t of [FAR_PAN_TITLE, FAR_PAN_X_LABEL, FAR_PAN_Y_LABEL, FAR_PAN_ZOOM_LABEL, FAR_PAN_CENTER_LABEL, FAR_PAN_HELP]) expect(text).toContain(t);
  });
});

describe('什麼時候出現', () => {
  it('farPanShown：有自己的背景圖（任何舞台），或舞台是水鏡；其他不出現', () => {
    for (const s of ['halo', 'gallery', 'magic', 'water', 'nebula', 'none'] as const) {
      expect(farPanShown(onStage(withBackdrop(), s)), s).toBe(true);
      expect(farPanShown(onStage(plainCard(), s)), s).toBe(s === 'water');
    }
  });

  it('右欄：看得到遠景才顯示；在「背景圖」那一列下面', () => {
    const m = mount();
    m.render(plainCard());
    expect(isShown(m.block())).toBe(false);
    m.render(onStage(plainCard(), 'water'));
    expect(isShown(m.block())).toBe(true);
    m.render(onStage(plainCard(), 'nebula'));
    expect(isShown(m.block())).toBe(false);
    m.render(withBackdrop());
    expect(isShown(m.block())).toBe(true);
    const parent = m.block().parentNode as FakeElement;
    const kids = parent.childNodes as FakeElement[];
    const at = (cls: string) => kids.findIndex((k) => k.classList?.contains(cls));
    expect(at('far-pan-block')).toBe(at('backdrop-block') + 1);
    expect(at('backdrop-block')).toBeGreaterThan(at('water-scene-block'));
  });
});

describe('滑桿的值與範圍', () => {
  it('左右、上下 −100～100、大小 100～300（%）；數字跟著卡片', () => {
    const m = mount();
    m.render(panned({ x: 0.35, y: -0.8, zoom: 1.5 }, withBackdrop()));
    const [x, y, z] = m.sliders();
    expect([x!.getAttribute('min'), x!.getAttribute('max')]).toEqual(['-100', '100']);
    expect([y!.getAttribute('min'), y!.getAttribute('max')]).toEqual(['-100', '100']);
    expect([z!.getAttribute('min'), z!.getAttribute('max')]).toEqual(['100', '300']);
    // 左右滑桿和存的 x 方向相反（使用者 2026-10-15 主對話決定：滑桿往右＝遠景往右移；x＝1 是看到圖的右邊、圖往左移）
    expect([x!.value, y!.value, z!.value]).toEqual(['-35', '-80', '150']);
    expect(byClass(m.field(0), 'field-value').textContent).toBe('-35');
    expect(byClass(m.field(1), 'field-value').textContent).toBe('-80');
    expect(byClass(m.field(2), 'field-value').textContent).toBe('150%');
    expect(x!.getAttribute('aria-label')).toBe(FAR_PAN_X_LABEL);
  });

  it('沒調過：0、0、100%', () => {
    const m = mount();
    m.render(withBackdrop());
    expect(m.sliders().map((s) => s.value)).toEqual(['0', '0', '100']);
  });
});

describe('拖滑桿：即時看、停手記一步', () => {
  it('左右：拖著送 preview、放開送 commit（只給 x，0.01 為單位）', () => {
    const m = mount();
    m.render(withBackdrop());
    drag(m.sliders()[0]!, '20');
    drag(m.sliders()[0]!, '-45', true);
    expect(m.edits()).toEqual([
      [{ view: { farPan: { x: -0.2 } } }, 'preview'],
      [{ view: { farPan: { x: 0.45 } } }, 'preview'],
      [{ view: { farPan: { x: 0.45 } } }, 'commit'],
    ]);
  });

  it('上下、大小：只給自己那個欄位（大小 150 → 1.5）', () => {
    const m = mount();
    m.render(withBackdrop());
    drag(m.sliders()[1]!, '60', true);
    drag(m.sliders()[2]!, '150', true);
    expect(m.edits()).toEqual([
      [{ view: { farPan: { y: 0.6 } } }, 'preview'],
      [{ view: { farPan: { y: 0.6 } } }, 'commit'],
      [{ view: { farPan: { zoom: 1.5 } } }, 'preview'],
      [{ view: { farPan: { zoom: 1.5 } } }, 'commit'],
    ]);
  });

  it('接上編輯器：拖的時候不記步、放開一步；復原回到拖之前；換背景圖、換遠景不歸零', () => {
    let state: EditorState = createEditor(withBackdrop());
    const { intents } = recorder();
    const real = new Proxy(intents, {
      get: (t, name: string) =>
        name === 'editCard'
          ? (patch: Parameters<UiIntents['editCard']>[0], phase: Parameters<UiIntents['editCard']>[1]) => {
              state = editCard(state, patch, phase, T1);
            }
          : (t as unknown as Record<string, unknown>)[name],
    });
    const inspector = createInspector(real);
    const root = inspector.el as unknown as FakeElement;
    inspector.render(toUiState(state, (h) => `blob:${h}`));
    const x = all(byClass(root, 'far-pan-block'), 'slider')[0]!;
    // 左右滑桿往右＝遠景往右移＝存的 x 是負的
    drag(x, '-30');
    drag(x, '-70');
    expect(farPanOf(currentCard(state)).x).toBe(0.7);
    expect(state.history.past).toHaveLength(0);
    x.dispatchEvent(new FakeEvent('change'));
    expect(state.history.past).toHaveLength(1);
    expect(currentCard(state).view.farPan).toEqual({ x: 0.7, y: 0, zoom: 1 });
    // 換背景圖、換遠景、換舞台：位置照舊
    expect(setBackdrop(currentCard(state), 'bbbbbbbbbbbbbbb2').view.farPan).toEqual({ x: 0.7, y: 0, zoom: 1 });
    expect(updateCard(currentCard(state), { view: { stage: 'water', waterScene: 'fuji' } }).view.farPan).toEqual({ x: 0.7, y: 0, zoom: 1 });
    state = undoEdit(state);
    expect(currentCard(state).view.farPan).toBeUndefined();
  });
});

describe('〔置中〕', () => {
  it('一按記一步：左右、上下回到 0（大小不動）', () => {
    const m = mount();
    m.render(panned({ x: 0.4, y: 0.2, zoom: 2 }, withBackdrop()));
    expect(m.center().disabled).toBe(false);
    m.center().dispatchEvent(new FakeEvent('click'));
    expect(m.edits()).toEqual([[{ view: { farPan: { x: 0, y: 0 } } }, 'commit']]);
  });

  it('已經置中（左右、上下都是 0）時變淡（不能按）；只放大也算置中', () => {
    const m = mount();
    m.render(withBackdrop());
    expect(m.center().disabled).toBe(true);
    m.render(panned({ zoom: 2 }, withBackdrop()));
    expect(m.center().disabled).toBe(true);
    m.render(panned({ y: -0.1 }, withBackdrop()));
    expect(m.center().disabled).toBe(false);
  });

  it('原生按鈕：Tab 走得到、Enter／空白鍵就是按（textContent 是「置中」）', () => {
    const m = mount();
    m.render(panned({ x: 0.4 }, withBackdrop()));
    expect(m.center().tagName.toLowerCase()).toBe('button');
    expect(m.center().textContent).toContain(FAR_PAN_CENTER_LABEL);
  });
});

describe('水鏡：〔上下〕變淡＋說明', () => {
  it('水鏡（有沒有自己的背景圖都一樣）：上下滑桿不能拖、整列變淡、說明出現；其他舞台：可以拖、沒有說明', () => {
    const m = mount();
    for (const card of [onStage(plainCard(), 'water'), onStage(withBackdrop(), 'water')]) {
      m.render(card);
      expect(m.sliders()[1]!.disabled).toBe(true);
      expect(m.field(1).classList.contains('is-disabled')).toBe(true);
      expect(isShown(m.note())).toBe(true);
      expect(m.note().textContent).toBe(FAR_PAN_WATER_NOTE);
      // 左右、大小照樣可以
      expect(m.sliders()[0]!.disabled).toBe(false);
      expect(m.sliders()[2]!.disabled).toBe(false);
    }
    m.render(withBackdrop());
    expect(m.sliders()[1]!.disabled).toBe(false);
    expect(m.field(1).classList.contains('is-disabled')).toBe(false);
    expect(isShown(m.note())).toBe(false);
  });
});

describe('預覽區 CSS 那層照位置擺（自己的背景圖）', () => {
  function stage() {
    const { intents } = recorder();
    const s = createStage(intents);
    const el = s.el as unknown as FakeElement;
    const layer = byClass(el, 'stage-backdrop');
    const render = (card: Card) => s.render(toUiState(createEditor(card), (h) => `blob:${h}`));
    return { render, layer };
  }

  it('有背景圖：--far-pos、--far-zoom 照 farPanCss（同一個算法）；換位置跟著換', () => {
    const s = stage();
    s.render(withBackdrop());
    expect(s.layer.style.getPropertyValue('--far-pos')).toBe('50% 50%');
    expect(s.layer.style.getPropertyValue('--far-zoom')).toBe('1');
    const p = { x: -0.6, y: 0.3, zoom: 2.25 };
    s.render(panned(p, withBackdrop()));
    const css = farPanCss(p);
    expect(s.layer.style.getPropertyValue('--far-pos')).toBe(css.position);
    expect(s.layer.style.getPropertyValue('--far-zoom')).toBe(css.scale);
  });

  it('沒有背景圖（底圖模糊版、水鏡）：不套位置（拿掉變數，模糊版照舊放大 1.18 倍）', () => {
    const s = stage();
    s.render(panned({ x: 0.5, zoom: 2 }, withBackdrop()));
    s.render(panned({ x: 0.5, zoom: 2 }, plainCard()));
    expect(s.layer.style.getPropertyValue('--far-pos')).toBe('');
    expect(s.layer.style.getPropertyValue('--far-zoom')).toBe('');
    s.render(onStage(panned({ x: 0.5, zoom: 2 }, withBackdrop()), 'water'));
    expect(s.layer.style.getPropertyValue('--far-pos')).toBe('');
  });
});

describe('水鏡、大小 100%：提示先放大（T-822 主對話決定）', () => {
  it('水鏡而且大小 100% 時，左右滑桿下面說「先把大小放大，左右才移得動」；放大後、或不是水鏡時不說', () => {
    const m = mount();
    const hint = () => byClass(m.block(), 'far-pan-zoom-hint');
    m.render(onStage(plainCard(), 'water'));
    expect(isShown(hint())).toBe(true);
    expect(hint().textContent).toBe(FAR_PAN_ZOOM_HINT);
    expect(FAR_PAN_ZOOM_HINT).toBe('先把大小放大，左右才移得動');
    m.render(onStage(panned({ zoom: 1.5 }, plainCard()), 'water'));
    expect(isShown(hint())).toBe(false);
    m.render(withBackdrop());
    expect(isShown(hint())).toBe(false);
  });

  it('左右滑桿往右＝遠景往右移：存的 x 變負的；置中時 0 不會變成 −0', () => {
    const m = mount();
    m.render(withBackdrop());
    drag(m.sliders()[0]!, '100', true);
    expect(m.edits().at(-1)).toEqual([{ view: { farPan: { x: -1 } } }, 'commit']);
    drag(m.sliders()[0]!, '0', true);
    expect(Object.is((m.edits().at(-1)![0] as { view: { farPan: { x: number } } }).view.farPan.x, 0)).toBe(true);
  });
});
