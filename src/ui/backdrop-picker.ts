// 右欄「舞台」六顆按鈕下面的一列「背景圖」（T-814，DESIGN §5「舞台背景圖」）：
//   還沒有：〔換成我的圖…〕＋小字「放一張圖在卡片後面，每張卡各自記住。」；
//   有了：小縮圖＋〔換一張〕〔拿掉〕。
// 選檔交給組裝端（ingest → 換上，一步）；回報按下去時那張卡的 id（選檔期間換了卡、被接手，main 用 pickStillValid 擋，同 T-805b）。
// 〔拿掉〕一按就是一步（removeBackdrop）。原生按鈕：Tab 走得到、Enter／空白鍵就是按；選檔的輸入框不在 Tab 順序裡。
// 圖的網址由畫面狀態給（圖片登記簿的 object URL，只在本機）；文字一律 textContent。
// 前景圖（T-830，foreground-picker.ts）用同一個元件 createStageImagePicker（〔加上前景圖…〕＋同樣的縮圖列、〔換一張〕〔拿掉〕，
// 有圖時下面多接位置滑桿）。版面 class（backdrop-row／backdrop-frame／backdrop-thumb／backdrop-actions）兩個共用，
// 區分用的 class 是 `${kind}-…`（backdrop-add、foreground-add…）。

import type { Card } from '../model/types';
import { button, h, setHidden } from './dom';
import { icon } from './icons';
import { BACKDROP_ADD_LABEL, BACKDROP_CHANGE_LABEL, BACKDROP_EMPTY_HELP, BACKDROP_REMOVE_LABEL, BACKDROP_TITLE } from './logic';
import type { UiIntents, UiState } from './types';

export interface BackdropPicker {
  readonly el: HTMLElement;
  render(state: UiState): void;
}

/** 舞台的一張自己的圖（背景圖 T-814、前景圖 T-830）：加、換、拿掉的那一列。 */
export interface StageImagePickerOptions {
  /** 區分用的 class 前綴。 */
  kind: 'backdrop' | 'foreground';
  title: string;
  addLabel: string;
  emptyHelp: string;
  /** 這張卡現在的那張圖（雜湊）；沒有＝undefined。 */
  hashOf(card: Card): string | undefined;
  /** 選了檔（cardId＝按下去時那張卡）。 */
  upload(file: File, cardId: string): void;
  remove(): void;
  /** 有圖時才顯示、接在縮圖那一列下面的東西（前景圖的位置滑桿）。 */
  extra?: HTMLElement;
}

export function createStageImagePicker(o: StageImagePickerOptions): BackdropPicker {
  /** 共用的版面 class＋區分用的 class（背景圖兩個一樣就只寫一個）。 */
  const cls = (shared: string, own: string) => (`backdrop-${shared}` === `${o.kind}-${own}` ? `backdrop-${shared}` : `backdrop-${shared} ${o.kind}-${own}`);
  /** 畫面上這張卡（按下去時記下來）。 */
  let shownCardId: string | null = null;
  /** 按〔換成我的圖…〕〔換一張〕時開著的那張卡；選檔回來交給 main 核對。 */
  let pickedCard: string | null = null;

  const file = h('input', {
    className: `visually-hidden ${o.kind}-file`,
    attrs: { type: 'file', accept: 'image/png,image/webp,image/jpeg', tabindex: '-1', 'aria-hidden': 'true' },
  });
  file.addEventListener('change', () => {
    const picked = Array.from(file.files ?? [])[0];
    file.value = '';
    const card = pickedCard;
    pickedCard = null;
    if (picked && card) o.upload(picked, card);
  });
  const pick = () => {
    pickedCard = shownCardId;
    file.click();
  };

  const add = button(`btn btn-block ${o.kind}-add`, [icon('upload', 18), o.addLabel]);
  add.addEventListener('click', pick);
  const emptyHelp = h('p', { className: `help ${o.kind}-empty-help`, text: o.emptyHelp });
  const thumb = h('img', { className: cls('thumb', 'thumb'), attrs: { alt: o.title, draggable: 'false' } });
  const change = button(`btn ${o.kind}-change`, [icon('upload', 18), BACKDROP_CHANGE_LABEL]);
  change.addEventListener('click', pick);
  const remove = button(`btn ${o.kind}-remove`, [icon('trash', 18), BACKDROP_REMOVE_LABEL]);
  remove.addEventListener('click', () => o.remove());
  const row = h('div', { className: cls('row', 'row') }, [
    h('span', { className: 'backdrop-frame' }, [thumb]),
    h('span', { className: 'backdrop-actions' }, [change, remove]),
  ]);

  const el = h('div', { className: `field-group ${o.kind}-block` }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: o.title })]),
    add,
    emptyHelp,
    row,
    o.extra,
    file,
  ]);

  return {
    el,
    render(state) {
      shownCardId = state.card.id;
      const hash = o.hashOf(state.card);
      const has = hash !== undefined;
      setHidden(add, has);
      setHidden(emptyHelp, has);
      setHidden(row, !has);
      if (o.extra) setHidden(o.extra, !has);
      const url = has ? (state.imageUrl(hash) ?? '') : '';
      if (thumb.getAttribute('src') !== url) {
        if (url) thumb.setAttribute('src', url);
        else thumb.removeAttribute('src');
      }
    },
  };
}

export function createBackdropPicker(intents: Pick<UiIntents, 'uploadBackdrop' | 'removeBackdrop'>): BackdropPicker {
  return createStageImagePicker({
    kind: 'backdrop',
    title: BACKDROP_TITLE,
    addLabel: BACKDROP_ADD_LABEL,
    emptyHelp: BACKDROP_EMPTY_HELP,
    hashOf: (card) => card.view.backdrop,
    upload: (file, cardId) => intents.uploadBackdrop(file, cardId),
    remove: () => intents.removeBackdrop(),
  });
}
