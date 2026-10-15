// 連舞台一起錄（T-850，DESIGN §7.1）：轉動影片與 GIF 的選項小框〔開始匯出〕上面的勾選「連舞台一起錄」。
//   兩個小框共用同一個選擇（export-panel.ts 建一份交給兩邊）、同一次開著工坊記住、預設不勾（記法照頁首的「畫上舞台的遠景」）。
//   滑過說明「畫面跟預覽一樣，舞台、背景圖、前景圖都錄進去（橫的畫面）」。
//   舞台是「關」時變淡、不能勾（滑過說明「舞台關著」），這次照不勾——記住的選擇不改，換回有舞台的卡打開時又是勾著。
// ui 只吐選擇（withStage）；文字一律 textContent。

import { h, toggleClass } from './dom';
import { STAGE_RECORD_LABEL, STAGE_RECORD_OFF_TIP, STAGE_RECORD_TIP } from './logic';

/** 兩個小框共用的選擇（同一次開著工坊記住）。 */
export interface StageRecordChoice {
  on: boolean;
}

/** 第一次：不勾。 */
export function defaultStageRecord(): StageRecordChoice {
  return { on: false };
}

export interface StageRecordToggle {
  /** 一列：勾選＋名字（放在小框〔開始匯出〕那一列上面）。 */
  readonly el: HTMLElement;
  /** 打開小框時：available＝這張卡的舞台不是「關」（關＝變淡、不能勾、看起來沒勾）。 */
  render(available: boolean): void;
  /** 這次要不要連舞台一起錄（勾著而且舞台開著）。 */
  active(): boolean;
}

/** changed＝使用者勾了或取消（GIF 的小框要換大小的字、重估檔案大小）。 */
export function createStageRecordToggle(choice: StageRecordChoice, changed: () => void = () => {}): StageRecordToggle {
  const input = h('input', { className: 'stage-record-input', attrs: { type: 'checkbox' } });
  const el = h('label', { className: 'vo-row stage-record', title: STAGE_RECORD_TIP }, [input, h('span', { text: STAGE_RECORD_LABEL })]);
  let available = true;
  input.addEventListener('change', () => {
    if (!available) return;
    choice.on = input.checked;
    changed();
  });
  return {
    el,
    render(next) {
      available = next;
      input.disabled = !next;
      input.checked = next && choice.on;
      toggleClass(el, 'is-disabled', !next);
      const tip = next ? STAGE_RECORD_TIP : STAGE_RECORD_OFF_TIP;
      if (el.title !== tip) el.title = tip;
    },
    active: () => available && choice.on,
  };
}
