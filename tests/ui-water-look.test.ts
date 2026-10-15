// T-825 水面樣子的畫面（DESIGN §5「水面樣子」）：
// 舞台選水鏡時，右欄在「遠景」上面多一小節「水面」：〔夜色〕〔霧白〕兩顆快速套用（記一步）；
// 滑桿＋數字（0～100）〔霧〕〔倒影拉長〕〔閃光〕〔波紋〕〔卡片高度〕〔地平線〕（拖著即時看、停手記一步，只給自己那個欄位）；
// 兩個顏色〔霧的顏色〕〔閃光顏色〕（現有色票元件：幾個預設＋自選；選色記一步）。每張卡記住（view.waterLook）。
// 預覽區的天空（CSS 那層）跟著霧色與濃淡（有霧時才換，沒有霧和以前一樣）。文字一律 textContent。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCard, waterLookOf } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { DEFAULT_WATER_LOOK, MIST_WATER_LOOK } from '../src/model/limits';
import type { Card, StageStyle, WaterLook } from '../src/model/types';
import { createEditor, currentCard, editCard, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import {
  WATER_GLINT_COLORS,
  WATER_LOOK_GLINT_COLOR_LABEL,
  WATER_LOOK_MIST_COLOR_LABEL,
  WATER_LOOK_PRESETS_UI,
  WATER_LOOK_SLIDERS,
  WATER_LOOK_TITLE,
  WATER_MIST_COLORS,
  waterLookPreset,
} from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';

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

const onStage = (card: Card, stage: StageStyle) => updateCard(card, { view: { stage } });
const water = (look?: Partial<WaterLook>) => {
  const c = onStage(newCard('standard', 'card-1', T0), 'water');
  return look ? updateCard(c, { view: { waterLook: look } }) : c;
};

function mount() {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const root = inspector.el as unknown as FakeElement;
  const render = (card: Card) => inspector.render(toUiState(createEditor(card), (h) => `blob:${h}`));
  const block = () => byClass(root, 'water-look-block');
  const sliders = () => all(block(), 'slider');
  const field = (i: number) => sliders()[i]!.parentNode as FakeElement;
  const presets = () => all(block(), 'water-look-preset');
  const swatchGroups = () => all(block(), 'swatches');
  const edits = () => calls.filter((c) => c.name === 'editCard').map((c) => c.args);
  return { root, render, block, sliders, field, presets, swatchGroups, edits };
}

function drag(input: FakeElement, value: string, end = false) {
  input.value = value;
  input.dispatchEvent(new FakeEvent('input'));
  if (end) input.dispatchEvent(new FakeEvent('change'));
}

describe('文字照 DESIGN', () => {
  it('小節名、兩顆快速套用、六個滑桿、兩個顏色', () => {
    expect(WATER_LOOK_TITLE).toBe('水面');
    expect(WATER_LOOK_PRESETS_UI.map((p) => p.label)).toEqual(['夜色', '霧白']);
    expect(WATER_LOOK_SLIDERS.map((s) => [s.key, s.label])).toEqual([
      ['mist', '霧'],
      ['streak', '倒影拉長'],
      ['glint', '閃光'],
      ['ripple', '波紋'],
      ['lift', '卡片高度'],
      ['horizon', '地平線'],
    ]);
    expect(WATER_LOOK_MIST_COLOR_LABEL).toBe('霧的顏色');
    expect(WATER_LOOK_GLINT_COLOR_LABEL).toBe('閃光顏色');
  });

  it('畫面上的字（textContent）', () => {
    const m = mount();
    m.render(water());
    const text = m.block().textContent;
    for (const t of [WATER_LOOK_TITLE, '夜色', '霧白', ...WATER_LOOK_SLIDERS.map((s) => s.label), WATER_LOOK_MIST_COLOR_LABEL, WATER_LOOK_GLINT_COLOR_LABEL]) {
      expect(text).toContain(t);
    }
  });

  it('色票：幾個預設（霧色有夜色預設與霧白的顏色、閃光有暖金預設）＋自選', () => {
    expect(WATER_MIST_COLORS.map((c) => c.color)).toContain(DEFAULT_WATER_LOOK.mistColor);
    expect(WATER_MIST_COLORS.map((c) => c.color)).toContain(MIST_WATER_LOOK.mistColor);
    expect(WATER_GLINT_COLORS.map((c) => c.color)).toContain(DEFAULT_WATER_LOOK.glintColor);
    for (const c of [...WATER_MIST_COLORS, ...WATER_GLINT_COLORS]) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
    const m = mount();
    m.render(water());
    expect(m.swatchGroups()).toHaveLength(2);
    for (const g of m.swatchGroups()) expect(all(g, 'swatch-picker')).toHaveLength(1);
  });
});

describe('什麼時候出現、在哪裡', () => {
  it('只在水鏡顯示；在舞台六顆按鈕下面、「遠景」上面', () => {
    const m = mount();
    for (const s of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
      m.render(onStage(newCard('standard', 'c', T0), s));
      expect(isShown(m.block()), s).toBe(false);
    }
    m.render(water());
    expect(isShown(m.block())).toBe(true);
    const parent = m.block().parentNode as FakeElement;
    const kids = parent.childNodes as FakeElement[];
    const at = (cls: string) => kids.findIndex((k) => k.classList?.contains(cls));
    expect(at('water-look-block')).toBe(at('stage-grid') + 1);
    expect(at('water-scene-block')).toBe(at('water-look-block') + 1);
  });
});

describe('滑桿', () => {
  it('六個 0～100、整數一格；數字跟著卡片（沒調過＝夜色：0、0、0、50、30、100）', () => {
    const m = mount();
    m.render(water());
    expect(m.sliders()).toHaveLength(6);
    for (const s of m.sliders()) {
      expect([s.getAttribute('min'), s.getAttribute('max'), s.getAttribute('step')]).toEqual(['0', '100', '1']);
    }
    expect(m.sliders().map((s) => s.value)).toEqual(['0', '0', '0', '50', '30', '100']);
    m.render(water(MIST_WATER_LOOK));
    expect(m.sliders().map((s) => s.value)).toEqual(WATER_LOOK_SLIDERS.map((s) => String(MIST_WATER_LOOK[s.key])));
    expect(byClass(m.field(0), 'field-value').textContent).toBe(String(MIST_WATER_LOOK.mist));
    expect(m.sliders()[5]!.getAttribute('aria-label')).toBe('地平線');
  });

  it('拖著送 preview、放開送 commit；只給自己那個欄位', () => {
    const m = mount();
    m.render(water());
    drag(m.sliders()[0]!, '20');
    drag(m.sliders()[0]!, '65', true);
    drag(m.sliders()[5]!, '0', true);
    expect(m.edits()).toEqual([
      [{ view: { waterLook: { mist: 20 } } }, 'preview'],
      [{ view: { waterLook: { mist: 65 } } }, 'preview'],
      [{ view: { waterLook: { mist: 65 } } }, 'commit'],
      [{ view: { waterLook: { horizon: 0 } } }, 'preview'],
      [{ view: { waterLook: { horizon: 0 } } }, 'commit'],
    ]);
  });
});

describe('快速套用〔夜色〕〔霧白〕', () => {
  it('一按記一步：整組換成那一組', () => {
    const m = mount();
    m.render(water());
    const [night, mist] = m.presets();
    expect(night!.textContent).toBe('夜色');
    expect(mist!.textContent).toBe('霧白');
    mist!.dispatchEvent(new FakeEvent('click'));
    night!.dispatchEvent(new FakeEvent('click'));
    expect(m.edits()).toEqual([
      [{ view: { waterLook: { ...MIST_WATER_LOOK } } }, 'commit'],
      [{ view: { waterLook: { ...DEFAULT_WATER_LOOK } } }, 'commit'],
    ]);
  });

  it('現在剛好是哪一組就標著（aria-pressed）；微調過就都不標', () => {
    expect(waterLookPreset(water())).toBe('night');
    expect(waterLookPreset(water(MIST_WATER_LOOK))).toBe('mist');
    expect(waterLookPreset(water({ ...MIST_WATER_LOOK, glint: 3 }))).toBeNull();
    const m = mount();
    const pressed = () => m.presets().map((p) => p.getAttribute('aria-pressed'));
    m.render(water());
    expect(pressed()).toEqual(['true', 'false']);
    m.render(water(MIST_WATER_LOOK));
    expect(pressed()).toEqual(['false', 'true']);
    m.render(water({ mist: 10 }));
    expect(pressed()).toEqual(['false', 'false']);
    expect(m.presets()[1]!.classList.contains('is-selected')).toBe(false);
  });
});

describe('顏色', () => {
  it('霧的顏色、閃光顏色：點預設記一步（只給那個欄位）；自選拖著 preview、選好 commit', () => {
    const m = mount();
    m.render(water());
    const [mistGroup, glintGroup] = m.swatchGroups();
    const mistPreset = all(mistGroup, 'swatch').find((b) => b.getAttribute('aria-label') === WATER_MIST_COLORS[1]!.name)!;
    mistPreset.dispatchEvent(new FakeEvent('click'));
    const picker = byClass(glintGroup, 'swatch-picker');
    picker.value = '#ff8800';
    picker.dispatchEvent(new FakeEvent('input'));
    picker.dispatchEvent(new FakeEvent('change'));
    expect(m.edits()).toEqual([
      [{ view: { waterLook: { mistColor: WATER_MIST_COLORS[1]!.color } } }, 'commit'],
      [{ view: { waterLook: { glintColor: '#ff8800' } } }, 'preview'],
      [{ view: { waterLook: { glintColor: '#ff8800' } } }, 'commit'],
    ]);
  });

  it('選中的顏色標著（照卡片）', () => {
    const m = mount();
    m.render(water(MIST_WATER_LOOK));
    const [mistGroup] = m.swatchGroups();
    const selected = all(mistGroup, 'swatch').filter((b) => b.classList.contains('is-selected'));
    expect(selected.map((b) => b.getAttribute('aria-label'))).toEqual([WATER_MIST_COLORS.find((c) => c.color === MIST_WATER_LOOK.mistColor)!.name]);
  });
});

describe('接上編輯器', () => {
  it('拖的時候不記步、放開一步；快速套用一步；復原回到之前', () => {
    let state: EditorState = createEditor(water());
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
    const block = byClass(root, 'water-look-block');
    const streak = all(block, 'slider')[1]!;
    drag(streak, '30');
    drag(streak, '55');
    expect(waterLookOf(currentCard(state)).streak).toBe(55);
    expect(state.history.past).toHaveLength(0);
    streak.dispatchEvent(new FakeEvent('change'));
    expect(state.history.past).toHaveLength(1);
    all(block, 'water-look-preset')[1]!.dispatchEvent(new FakeEvent('click'));
    expect(state.history.past).toHaveLength(2);
    expect(waterLookOf(currentCard(state))).toEqual(MIST_WATER_LOOK);
    state = undoEdit(state);
    expect(waterLookOf(currentCard(state))).toEqual({ ...DEFAULT_WATER_LOOK, streak: 55 });
    state = undoEdit(state);
    expect(currentCard(state).view.waterLook).toBeUndefined();
  });
});

describe('預覽區的天空（CSS 那層）跟著霧', () => {
  function stage() {
    const { intents } = recorder();
    const s = createStage(intents);
    const el = s.el as unknown as FakeElement;
    const render = (card: Card) => s.render(toUiState(createEditor(card), (h) => `blob:${h}`));
    return { el, render };
  }

  it('水鏡有霧：has-water-mist、霧色與濃淡（0～1）放進 CSS 變數；沒有霧、不是水鏡：拿掉（和以前一樣）', () => {
    const s = stage();
    s.render(water({ mist: 70, mistColor: '#d3d8cf' }));
    expect(s.el.classList.contains('has-water-mist')).toBe(true);
    expect(s.el.style.getPropertyValue('--water-mist-color')).toBe('#d3d8cf');
    expect(s.el.style.getPropertyValue('--water-mist')).toBe('0.7');
    s.render(water());
    expect(s.el.classList.contains('has-water-mist')).toBe(false);
    expect(s.el.style.getPropertyValue('--water-mist-color')).toBe('');
    expect(s.el.style.getPropertyValue('--water-mist')).toBe('');
    s.render(onStage(water({ mist: 70 }), 'halo'));
    expect(s.el.classList.contains('has-water-mist')).toBe(false);
  });
});
