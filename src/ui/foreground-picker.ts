// 右欄「舞台」小節的「前景圖」（T-830，DESIGN §5「前景圖」）：在「背景圖」與它的「位置」下面。
//   還沒有：〔加上前景圖…〕＋小字（建議用透明背景的圖）；
//   有了：小縮圖＋〔換一張〕〔拿掉〕（和背景圖同一個元件 createStageImagePicker），下面接位置：
//   〔左右〕〔上下〕（−100～100）〔大小〕（50～300%）〔模糊〕（0～100）四個滑桿＋數字＋〔置中〕＋一句說明（和遠景位置同一組元件與字）。
// 選檔交給組裝端（uploadForeground：ingest → 換上，一步；回報按下去時那張卡）；〔拿掉〕一步（removeForeground）。
// 滑桿：拖著送 editCard({ view: { foreground: { x } } }, 'preview')（即時看）、放開送 'commit'（記一步），只給自己那個欄位
// （左右、上下、大小 ÷ 100；模糊照整數）。〔左右〕往右＝前景圖往右、〔上下〕往右＝往上（照存的 x、y，不像遠景位置的左右要反過來）。
// 〔置中〕：左右、上下回到 0（大小、模糊不變），一按記一步；已經置中時變淡。文字一律 textContent。

import { foregroundOf } from '../model/actions';
import { RANGE } from '../model/limits';
import { createStageImagePicker, type BackdropPicker } from './backdrop-picker';
import { createSlider } from './controls';
import { button, h } from './dom';
import { icon } from './icons';
import {
  FAR_PAN_CENTER_LABEL,
  FAR_PAN_CENTER_TIP,
  FAR_PAN_X_LABEL,
  FAR_PAN_Y_LABEL,
  FAR_PAN_ZOOM_LABEL,
  FOREGROUND_ADD_LABEL,
  FOREGROUND_BLUR_LABEL,
  FOREGROUND_EMPTY_HELP,
  FOREGROUND_HELP,
  FOREGROUND_TITLE,
} from './logic';
import type { UiIntents } from './types';

/** 滑桿上的整數 ↔ 存的值：左右、上下 −100～100 ↔ −1～1；大小 50～300 ↔ 0.5～3；模糊一樣。 */
const PER = 100;
const toSlider = (v: number) => Math.round(v * PER);

export function createForegroundPicker(intents: Pick<UiIntents, 'uploadForeground' | 'removeForeground' | 'editCard'>): BackdropPicker {
  const edit = (patch: { x?: number; y?: number; scale?: number; blur?: number }, phase: 'preview' | 'commit') =>
    intents.editCard({ view: { foreground: patch } }, phase);
  const x = createSlider({
    label: FAR_PAN_X_LABEL,
    min: toSlider(RANGE.foregroundPos.min),
    max: toSlider(RANGE.foregroundPos.max),
    step: 1,
    bipolar: true,
    valueText: (v) => String(v),
    onChange: (v, phase) => edit({ x: v / PER }, phase),
  });
  const y = createSlider({
    label: FAR_PAN_Y_LABEL,
    min: toSlider(RANGE.foregroundPos.min),
    max: toSlider(RANGE.foregroundPos.max),
    step: 1,
    bipolar: true,
    valueText: (v) => String(v),
    onChange: (v, phase) => edit({ y: v / PER }, phase),
  });
  const scale = createSlider({
    label: FAR_PAN_ZOOM_LABEL,
    min: toSlider(RANGE.foregroundScale.min),
    max: toSlider(RANGE.foregroundScale.max),
    step: 1,
    valueText: (v) => `${v}%`,
    onChange: (v, phase) => edit({ scale: v / PER }, phase),
  });
  const blur = createSlider({
    label: FOREGROUND_BLUR_LABEL,
    min: RANGE.foregroundBlur.min,
    max: RANGE.foregroundBlur.max,
    step: 1,
    valueText: (v) => String(v),
    onChange: (v, phase) => edit({ blur: v }, phase),
  });
  const center = button('btn foreground-center', [icon('center', 18), FAR_PAN_CENTER_LABEL], FAR_PAN_CENTER_TIP);
  center.addEventListener('click', () => edit({ x: 0, y: 0 }, 'commit'));
  const place = h('div', { className: 'foreground-place' }, [
    x.el,
    y.el,
    scale.el,
    blur.el,
    h('div', { className: 'btn-row' }, [center]),
    h('p', { className: 'help', text: FOREGROUND_HELP }),
  ]);

  const picker = createStageImagePicker({
    kind: 'foreground',
    title: FOREGROUND_TITLE,
    addLabel: FOREGROUND_ADD_LABEL,
    emptyHelp: FOREGROUND_EMPTY_HELP,
    hashOf: (card) => foregroundOf(card)?.image,
    upload: (file, cardId) => intents.uploadForeground(file, cardId),
    remove: () => intents.removeForeground(),
    extra: place,
  });

  return {
    el: picker.el,
    render(state) {
      picker.render(state);
      const fg = foregroundOf(state.card);
      if (!fg) return;
      x.set(toSlider(fg.x));
      y.set(toSlider(fg.y));
      scale.set(toSlider(fg.scale));
      blur.set(fg.blur);
      const centered = fg.x === 0 && fg.y === 0;
      if (center.disabled !== centered) center.disabled = centered;
    },
  };
}
