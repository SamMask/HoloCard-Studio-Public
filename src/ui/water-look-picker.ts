// 右欄「舞台」六顆按鈕下面、「遠景」上面的「水面」（T-825，DESIGN §5「水面樣子」）：只在舞台是水鏡時顯示。
//   〔夜色〕〔霧白〕兩顆快速套用：一按＝editCard({ view: { waterLook: 整組 } }, 'commit')（記一步，之後還能再微調）；
//     現在剛好是那一組時標著（is-selected＋aria-pressed，logic.ts 的 waterLookPreset），微調過就都不標。
//   六個滑桿＋數字（0～100）〔霧〕〔倒影拉長〕〔閃光〕〔波紋〕〔卡片高度〕〔地平線〕：拖著送 'preview'（即時看）、放開送 'commit'（記一步），
//     只給自己那個欄位；鍵盤照原生滑桿。
//   兩個顏色〔霧的顏色〕〔閃光顏色〕：現有的色票元件（幾個預設＋自選）；點預設記一步、自選拖著 preview、選好 commit。
// 每張卡記住（view.waterLook，model 的 waterLookOf 讀）。文字一律 textContent。

import { waterLookOf } from '../model/actions';
import { RANGE, WATER_LOOK_PRESETS } from '../model/limits';
import { createSlider, createSwatches, type Slider } from './controls';
import { button, h, setHidden, toggleClass } from './dom';
import {
  WATER_GLINT_COLORS,
  WATER_LOOK_GLINT_COLOR_LABEL,
  WATER_LOOK_MIST_COLOR_LABEL,
  WATER_LOOK_PRESETS_UI,
  WATER_LOOK_SLIDERS,
  WATER_LOOK_TITLE,
  WATER_MIST_COLORS,
  waterLookPreset,
} from './logic';
import type { UiIntents, UiState } from './types';

export interface WaterLookPicker {
  readonly el: HTMLElement;
  render(state: UiState): void;
}

export function createWaterLookPicker(intents: Pick<UiIntents, 'editCard'>): WaterLookPicker {
  const presets = WATER_LOOK_PRESETS_UI.map((o) => {
    // 左邊一小塊那一組的天色（style.css 的 T-825 段照 data-preset 畫）
    const el = button('btn water-look-preset', [h('span', { className: 'water-look-chip', attrs: { 'aria-hidden': 'true' } }), o.label]);
    el.dataset.preset = o.value;
    el.setAttribute('aria-pressed', 'false');
    el.addEventListener('click', () => intents.editCard({ view: { waterLook: { ...WATER_LOOK_PRESETS[o.value] } } }, 'commit'));
    return { value: o.value, el };
  });

  const sliders: { key: (typeof WATER_LOOK_SLIDERS)[number]['key']; slider: Slider }[] = WATER_LOOK_SLIDERS.map((o) => ({
    key: o.key,
    slider: createSlider({
      label: o.label,
      min: RANGE.waterLook.min,
      max: RANGE.waterLook.max,
      step: 1,
      valueText: (v) => String(v),
      onChange: (v, phase) => intents.editCard({ view: { waterLook: { [o.key]: v } } }, phase),
    }),
  }));

  const mistColor = createSwatches(WATER_LOOK_MIST_COLOR_LABEL, WATER_MIST_COLORS, (c, phase) => intents.editCard({ view: { waterLook: { mistColor: c } } }, phase));
  const glintColor = createSwatches(WATER_LOOK_GLINT_COLOR_LABEL, WATER_GLINT_COLORS, (c, phase) =>
    intents.editCard({ view: { waterLook: { glintColor: c } } }, phase),
  );
  const colorField = (label: string, el: HTMLElement) =>
    h('div', { className: 'field water-look-color' }, [h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: label })]), el]);

  const el = h('div', { className: 'field-group water-look-block' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: WATER_LOOK_TITLE })]),
    h('div', { className: 'btn-row water-look-presets' }, presets.map((p) => p.el)),
    ...sliders.map((s) => s.slider.el),
    colorField(WATER_LOOK_MIST_COLOR_LABEL, mistColor.el),
    colorField(WATER_LOOK_GLINT_COLOR_LABEL, glintColor.el),
  ]);

  return {
    el,
    render(state) {
      const card = state.card;
      const water = card.view.stage === 'water';
      setHidden(el, !water);
      if (!water) return;
      const look = waterLookOf(card);
      for (const s of sliders) s.slider.set(look[s.key]);
      mistColor.set(look.mistColor);
      glintColor.set(look.glintColor);
      const chosen = waterLookPreset(card);
      for (const p of presets) {
        const on = p.value === chosen;
        toggleClass(p.el, 'is-selected', on);
        if (p.el.getAttribute('aria-pressed') !== String(on)) p.el.setAttribute('aria-pressed', String(on));
      }
    },
  };
}
