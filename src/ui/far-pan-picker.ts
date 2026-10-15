// 右欄「舞台」小節最下面的「位置」（T-822，DESIGN §5「遠景位置」）：在「遠景」與「背景圖」下面。
//   〔左右〕〔上下〕〔大小〕三個滑桿＋數字（左右、上下 −100～100、0＝置中；大小 100～300%）＋〔置中〕＋一句「調整遠景擺在卡片後面的位置」。
//   只有預覽區看得到遠景時出現（logic.ts 的 farPanShown：有自己的背景圖，或舞台是水鏡）；
//   水鏡時〔上下〕變淡（不能拖），下面說明「水鏡的遠景貼著水平線，只能左右移和放大」。
// 滑桿：拖著送 editCard({ view: { farPan: { x } } }, 'preview')（即時看）、放開送 'commit'（記一步），只給自己那個欄位
// （滑桿的整數 ÷ 100：存成 0.01 為單位，model 照 0.01 四捨五入）；鍵盤照原生滑桿（方向鍵一格、Home／End 到頭）。
// 〔置中〕：左右、上下回到 0（大小不變），一按記一步；已經置中時變淡。原生按鈕：Tab 走得到、Enter／空白鍵就是按。
// 換背景圖、換遠景時位置照舊（存在卡片裡，這裡只照著顯示）。文字一律 textContent。
// 〔左右〕滑桿和存的 x 方向相反（主對話決定）：滑桿往右＝遠景往右移（存的 x＝−滑桿÷100；x＝1 是看到圖的右邊、圖往左移）。
// 〔上下〕照存的 y（往右＝遠景往上移）。水鏡而且大小 100% 時，左右滑桿下面提示先放大（遠景平面比預覽區寬，左右通常移不動）。

import { farPanOf } from '../model/actions';
import { RANGE } from '../model/limits';
import { createSlider } from './controls';
import { button, h, setHidden, toggleClass } from './dom';
import { icon } from './icons';
import {
  FAR_PAN_CENTER_LABEL,
  FAR_PAN_CENTER_TIP,
  FAR_PAN_HELP,
  FAR_PAN_TITLE,
  FAR_PAN_WATER_NOTE,
  FAR_PAN_ZOOM_HINT,
  FAR_PAN_X_LABEL,
  FAR_PAN_Y_LABEL,
  FAR_PAN_ZOOM_LABEL,
  farPanShown,
} from './logic';
import type { UiIntents, UiState } from './types';

export interface FarPanPicker {
  readonly el: HTMLElement;
  render(state: UiState): void;
}

/** 滑桿上的整數 ↔ 存的值：左右、上下 −100～100 ↔ −1～1；大小 100～300 ↔ 1～3。 */
const PER = 100;
const toSlider = (v: number) => Math.round(v * PER);
/** 左右滑桿 ↔ 存的 x：方向相反；0 不寫成 −0。 */
const xToSlider = (x: number) => (x === 0 ? 0 : -toSlider(x));
const sliderToX = (v: number) => (v === 0 ? 0 : -v / PER);

export function createFarPanPicker(intents: Pick<UiIntents, 'editCard'>): FarPanPicker {
  const x = createSlider({
    label: FAR_PAN_X_LABEL,
    min: toSlider(RANGE.farPan.min),
    max: toSlider(RANGE.farPan.max),
    step: 1,
    bipolar: true,
    valueText: (v) => String(v),
    onChange: (v, phase) => intents.editCard({ view: { farPan: { x: sliderToX(v) } } }, phase),
  });
  const y = createSlider({
    label: FAR_PAN_Y_LABEL,
    min: toSlider(RANGE.farPan.min),
    max: toSlider(RANGE.farPan.max),
    step: 1,
    bipolar: true,
    valueText: (v) => String(v),
    onChange: (v, phase) => intents.editCard({ view: { farPan: { y: v / PER } } }, phase),
  });
  const zoom = createSlider({
    label: FAR_PAN_ZOOM_LABEL,
    min: toSlider(RANGE.farZoom.min),
    max: toSlider(RANGE.farZoom.max),
    step: 1,
    valueText: (v) => `${v}%`,
    onChange: (v, phase) => intents.editCard({ view: { farPan: { zoom: v / PER } } }, phase),
  });
  const center = button('btn far-pan-center', [icon('center', 18), FAR_PAN_CENTER_LABEL], FAR_PAN_CENTER_TIP);
  center.addEventListener('click', () => intents.editCard({ view: { farPan: { x: 0, y: 0 } } }, 'commit'));
  const waterNote = h('p', { className: 'help far-pan-water-note', text: FAR_PAN_WATER_NOTE });
  const zoomHint = h('p', { className: 'help far-pan-zoom-hint', text: FAR_PAN_ZOOM_HINT });

  const el = h('div', { className: 'field-group far-pan-block' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: FAR_PAN_TITLE })]),
    x.el,
    zoomHint,
    y.el,
    waterNote,
    zoom.el,
    h('div', { className: 'btn-row' }, [center]),
    h('p', { className: 'help', text: FAR_PAN_HELP }),
  ]);

  return {
    el,
    render(state) {
      const card = state.card;
      const shown = farPanShown(card);
      setHidden(el, !shown);
      if (!shown) return;
      const pan = farPanOf(card);
      x.set(xToSlider(pan.x));
      y.set(toSlider(pan.y));
      zoom.set(toSlider(pan.zoom));
      // 水鏡：遠景貼著水平線，上下不用
      const water = card.view.stage === 'water';
      y.setDisabled(water);
      setHidden(waterNote, !water);
      setHidden(zoomHint, !(water && pan.zoom === 1));
      toggleClass(el, 'is-water', water);
      const centered = pan.x === 0 && pan.y === 0;
      if (center.disabled !== centered) center.disabled = centered;
    },
  };
}
