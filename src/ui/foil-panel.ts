// 右欄「反光層」面板（T-417，DESIGN「反光層」）：左欄選中最上面那一列「反光層」時，取代「選中的圖層」那一塊。
// 一句說明、形狀三選一〔整面〕〔用圖層形狀〕〔上傳黑白圖〕、用圖層形狀時每層一個勾選（＝左欄的星星，兩邊同步）、
// 上傳黑白圖時〔選圖…〕＋縮圖＋小字、「卡框也反光」開關、「霧光」滑桿（兩面共用）。
// 形狀、勾選、卡框開關一按就記一步；霧光滑桿拖動中 preview、放開 commit。名字一律 textContent。

import { S } from '../i18n';
import { faceFoil, holoMatte } from '../model/foil';
import { RANGE } from '../model/limits';
import type { FoilShape, Layer } from '../model/types';
import { createSegmented, createSlider, createSwitch } from './controls';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { icon, swapIcon } from './icons';
import {
  displayOrder,
  FOIL_FRAME_LABEL,
  FOIL_FRAME_OFF_TEXT,
  FOIL_HELP,
  FOIL_MASK_HELP,
  FOIL_OFF_NOTE,
  FOIL_PICK_MASK,
  FOIL_SHAPE_OPTIONS,
  FOIL_TITLE,
  layerHoloToggle,
  MATTE_HELP,
  MATTE_LABEL,
  matteText,
} from './logic';
import type { UiIntents, UiState } from './types';

interface LayerRow {
  layer: Layer;
  el: HTMLElement;
  check: HTMLButtonElement;
  name: HTMLElement;
}

export interface FoilPanel {
  readonly el: HTMLElement;
  /** 標題（h2）與內容：右欄把它做成可以摺疊的小節（T-836，inspector.ts）。 */
  readonly title: HTMLElement;
  readonly body: HTMLElement;
  render(state: UiState): void;
}

export function createFoilPanel(intents: UiIntents): FoilPanel {
  let hasMask = false;

  // 選黑白圖：和上傳圖片一樣的檔案類型；選了就交給組裝端（ingest → 換上、切到這個形狀）
  const fileInput = h('input', {
    className: 'visually-hidden foil-file',
    attrs: { type: 'file', accept: 'image/png,image/webp,image/jpeg', tabindex: '-1', 'aria-hidden': 'true' },
  });
  fileInput.addEventListener('change', () => {
    const file = Array.from(fileInput.files ?? [])[0];
    fileInput.value = '';
    if (file) intents.uploadFoilMask(file);
  });

  const shapes = createSegmented<FoilShape>(
    S.foil.shapeLabel,
    FOIL_SHAPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    (shape, via) => {
      // 還沒有黑白圖：先選圖，選好才切過去（方向鍵經過時不跳出選檔視窗，要在上面按 Enter／空白鍵才選圖）
      if (shape === 'mask' && !hasMask) {
        if (via === 'click') fileInput.click();
      } else intents.editFoil({ shape });
    },
  );
  const offNote = h('div', { className: 'note' }, [icon('info', 18), h('span', { text: FOIL_OFF_NOTE })]);

  // 用圖層形狀：這一面的圖層（最前面在最上面），每層一個勾選。列依圖層 id 重用、只更新狀態（T-417b：
  // 改勾選時不重建，鍵盤使用者的焦點留在剛按的那一個）
  const layerList = h('div', { className: 'foil-layer-list', attrs: { role: 'group', 'aria-label': S.foil.layersLabel } });
  const emptyLayers = h('p', { className: 'help', text: S.foil.noLayers });
  const layersBlock = h('div', { className: 'field foil-layers' }, [layerList, emptyLayers]);
  const layerRows = new Map<string, LayerRow>();

  // 上傳黑白圖：〔選圖…〕＋縮圖＋小字
  const pickBtn = button('btn', [icon('upload', 18), FOIL_PICK_MASK]);
  pickBtn.addEventListener('click', () => fileInput.click());
  const maskThumb = h('img', { className: 'foil-mask-thumb', attrs: { alt: S.foil.maskAlt } });
  const maskBlock = h('div', { className: 'field foil-mask-block' }, [
    h('div', { className: 'foil-mask-row' }, [h('span', { className: 'foil-mask-frame' }, [maskThumb]), pickBtn]),
    h('p', { className: 'help', text: FOIL_MASK_HELP }),
  ]);

  // 卡框也反光（卡框關著時變淡、提示先打開卡框）
  const frameSwitch = createSwitch(FOIL_FRAME_LABEL, (next) => intents.editFoil({ frame: next }));
  const openFrameBtn = button('btn', [S.foil.openFrame]);
  openFrameBtn.addEventListener('click', () => intents.editCard({ frame: { enabled: true } }, 'commit'));
  const frameOff = h('div', { className: 'note note-warn foil-frame-off' }, [
    icon('info', 18),
    h('span', { className: 'note-text' }, [h('span', { text: FOIL_FRAME_OFF_TEXT }), openFrameBtn]),
  ]);
  const frameGroup = h('div', { className: 'field-group foil-frame' }, [
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: FOIL_FRAME_LABEL }), frameSwitch.el]),
  ]);

  // 霧光：0～100，兩面共用
  const matte = createSlider({
    label: MATTE_LABEL,
    min: RANGE.holoMatte.min,
    max: RANGE.holoMatte.max,
    step: 1,
    valueText: matteText,
    ends: [S.foil.matteLow, S.foil.matteHigh],
    onChange: (v, phase) => intents.editCard({ holo: { matte: v } }, phase),
  });
  const matteGroup = h('div', { className: 'field-group' }, [matte.el, h('p', { className: 'help', text: MATTE_HELP })]);

  const title = h('h2', { className: 'panel-title foil-title' }, [icon('rainbow', 18), FOIL_TITLE]);
  const body = h('div', { className: 'panel-body' }, [
    h('p', { className: 'help', text: FOIL_HELP }),
    h('div', { className: 'field' }, [h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.foil.shape })]), shapes.el]),
    offNote,
    layersBlock,
    maskBlock,
    frameGroup,
    frameOff,
    matteGroup,
    fileInput,
  ]);
  const el = h('section', { className: 'panel-section foil-panel' }, [h('div', { className: 'panel-head' }, [title]), body]);

  /** 一層的勾選：建一次，之後 updateLayerRow 只更新狀態（按下去時用最新的圖層資料）。 */
  const makeLayerRow = (layer: Layer): LayerRow => {
    const check = button('btn-icon foil-check', [icon('sparkleOff')]);
    check.setAttribute('role', 'checkbox');
    const name = h('span', { className: 'foil-layer-name' });
    const row: LayerRow = { layer, el: h('div', { className: 'foil-layer' }, [check, name]), check, name };
    check.addEventListener('click', () => {
      // 衝出卡片的層整層不反光：按了不改（T-411b）
      if (layerHoloToggle(row.layer).state !== 'locked') intents.editLayer(row.layer.id, { holo: !row.layer.holo }, 'commit');
    });
    return row;
  };

  /** 狀態照 layerHoloToggle：開＝金色星星、關＝空心加斜線、衝出卡片的層＝變淡、不能勾。 */
  const updateLayerRow = (row: LayerRow, layer: Layer) => {
    row.layer = layer;
    setText(row.name, layer.name);
    const toggle = layerHoloToggle(layer);
    if (row.check.dataset.state !== toggle.state) {
      row.check.dataset.state = toggle.state;
      swapIcon(row.check, toggle.state === 'on' ? 'sparkle' : 'sparkleOff');
    }
    row.check.title = toggle.title;
    row.check.setAttribute('aria-label', toggle.title);
    if (toggle.state === 'locked') {
      row.check.setAttribute('aria-disabled', 'true');
      row.check.removeAttribute('aria-checked');
    } else {
      row.check.removeAttribute('aria-disabled');
      row.check.setAttribute('aria-checked', String(layer.holo));
    }
  };

  return {
    el,
    title,
    body,
    render(state) {
      const face = state.card[state.face];
      const foil = faceFoil(face);
      hasMask = foil.mask !== undefined;
      shapes.set(foil.shape);
      setHidden(offNote, foil.shape !== 'none');

      setHidden(layersBlock, foil.shape !== 'layers');
      if (foil.shape === 'layers') {
        const order = displayOrder(face.layers);
        const keep = new Set(order.map((l) => l.id));
        for (const [id, row] of layerRows) {
          if (!keep.has(id)) {
            row.el.remove();
            layerRows.delete(id);
          }
        }
        order.forEach((layer, i) => {
          let row = layerRows.get(layer.id);
          if (!row) {
            row = makeLayerRow(layer);
            layerRows.set(layer.id, row);
          }
          updateLayerRow(row, layer);
          // 已經在對的位置就不動（搬動元素會讓焦點跑掉）
          if (layerList.children[i] !== row.el) layerList.insertBefore(row.el, layerList.children[i] ?? null);
        });
        setHidden(emptyLayers, order.length > 0);
      }

      setHidden(maskBlock, foil.shape !== 'mask');
      const url = foil.mask !== undefined ? (state.imageUrl(foil.mask) ?? '') : '';
      if (maskThumb.getAttribute('src') !== url) maskThumb.setAttribute('src', url);

      frameSwitch.set(foil.frame);
      toggleClass(frameGroup, 'is-off', !state.card.frame.enabled);
      setHidden(frameOff, state.card.frame.enabled);

      matte.set(holoMatte(state.card.holo));
    },
  };
}

/** 左欄那一列的小縮圖：形狀寫在 data-shape（CSS 畫彩虹、霧面）；黑白圖顯示那張圖。 */
export function foilThumb(): { el: HTMLElement; set(shape: FoilShape, maskUrl: string): void } {
  const mask = h('img', { className: 'foil-mask', attrs: { alt: '', draggable: 'false' } });
  const el = h('span', { className: 'foil-thumb' }, [mask]);
  return {
    el,
    set(shape, maskUrl) {
      if (el.dataset.shape !== shape) el.dataset.shape = shape;
      const src = shape === 'mask' ? maskUrl : '';
      if (mask.getAttribute('src') !== src) mask.setAttribute('src', src);
      setHidden(mask, shape !== 'mask');
    },
  };
}

/** 眼睛的圖示與說明（開＝反光層開著）。 */
export function setFoilEye(eye: HTMLButtonElement, on: boolean): void {
  const state = on ? 'on' : 'off';
  if (eye.dataset.state === state) return;
  eye.dataset.state = state;
  swapIcon(eye, on ? 'eye' : 'eyeOff');
  eye.title = on ? S.foil.eyeOn : S.foil.eyeOff;
  eye.setAttribute('aria-label', eye.title);
  eye.setAttribute('aria-pressed', String(!on));
}
