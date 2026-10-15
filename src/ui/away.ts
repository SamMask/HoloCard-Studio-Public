// 工坊在另一個分頁開著（T-409）：被接手的分頁蓋上一層半透明遮罩，後面不能再編輯（也不會再存檔）。
//   「工坊在另一個分頁開著。」＋〔在這裡繼續〕（換這個分頁接手、重新讀卡片庫）。
//   交出去前有改動沒存到（存檔壞掉）：多一行提醒＋〔匯出備份〕（把記憶體裡的這張存成卡片檔，不寫存檔）。
// 開啟時工坊已經在別的分頁開著（T-412）：同一層遮罩改成等待畫面「正在等另一個分頁存好…」（沒有按鈕），拿到編輯權就拿掉。
// ui 只吐意圖；文字一律 textContent。

import { S } from '../i18n';
import { button, h, setHidden, setText } from './dom';
import { trapTab } from './focus';
import { icon } from './icons';
import type { UiIntents } from './types';

export interface AwayOverlay {
  readonly el: HTMLElement;
  isOpen(): boolean;
  show(options: { unsaved: boolean }): void;
  /** 等另一個分頁存好、交出來（沒有按鈕）。 */
  wait(): void;
  hide(): void;
}

const TITLE = S.away.title;
const TIP = S.away.tip;
const UNSAVED = S.away.unsaved;
const CONTINUE = S.away.continue;
const CONTINUING = S.away.continuing;
const WAITING = S.away.waiting;
const WAITING_TIP = S.away.waitingTip;

export function createAwayOverlay(intents: Pick<UiIntents, 'continueHere' | 'exportCardFile'>): AwayOverlay {
  const continueLabel = h('span', { text: CONTINUE });
  const continueBtn = button('btn btn-lg primary', [icon('open', 20), continueLabel], S.away.continueTip);
  continueBtn.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    continueBtn.disabled = true;
    setText(continueLabel, CONTINUING);
    intents.continueHere();
  });

  const backupBtn = button('btn btn-lg', [icon('cardFile', 20), S.header.backup], S.header.backupTip);
  backupBtn.addEventListener('click', () => {
    if (backupBtn.disabled) return;
    backupBtn.disabled = true;
    void intents.exportCardFile().finally(() => (backupBtn.disabled = false));
  });
  const unsavedNote = h('p', { className: 'away-unsaved' }, [icon('alert', 18), h('span', { text: UNSAVED })]);

  const title = h('p', { className: 'away-title', text: TITLE, attrs: { id: 'away-title' } });
  const tip = h('p', { className: 'away-tip', text: TIP, attrs: { id: 'away-tip' } });
  const actions = h('div', { className: 'away-actions' }, [backupBtn, continueBtn]);
  const box = h('div', { className: 'away-box', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'away-title', 'aria-describedby': 'away-tip' } }, [
    h('div', { className: 'away-icon', attrs: { 'aria-hidden': 'true' } }, [icon('cards', 34)]),
    title,
    tip,
    unsavedNote,
    actions,
  ]);
  const el = h('div', { className: 'away-overlay' }, [box]);
  el.hidden = true;
  // Tab 只在遮罩的按鈕之間循環（T-607）
  trapTab(el);

  return {
    el,
    isOpen: () => !el.hidden,
    show({ unsaved }) {
      el.classList.remove('is-waiting');
      box.removeAttribute('aria-busy');
      setText(title, TITLE);
      setText(tip, TIP);
      setHidden(actions, false);
      setHidden(unsavedNote, !unsaved);
      setHidden(backupBtn, !unsaved);
      continueBtn.disabled = false;
      setText(continueLabel, CONTINUE);
      el.hidden = false;
      continueBtn.focus();
    },
    wait() {
      el.classList.add('is-waiting');
      box.setAttribute('aria-busy', 'true');
      setText(title, WAITING);
      setText(tip, WAITING_TIP);
      setHidden(actions, true);
      setHidden(unsavedNote, true);
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}
