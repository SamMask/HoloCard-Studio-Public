// 操作說明面板（DESIGN §8.1，T-606）：頁首〔？〕打開，從右邊滑出（寬約 380px，貼著頁首下方，不蓋住卡片中間）。
// 分段標題＋白話短句（文字在 logic.ts 的 HELP_SECTIONS）、鍵盤那一段畫成小鍵帽（HELP_KEYS）、最下面〔重新看導覽〕。
// Esc（由 app.ts 的 Esc 處理叫 escape()）、點面板外面、再按〔？〕都會關；關掉後焦點回到〔？〕。
// 不鎖住後面的畫面（開著也能轉卡、調圖層）；只在卡片庫、新卡片面板、匯出蓋住時由 app.ts 設成 inert。
// Tab 在面板裡循環（T-607，focus.ts 的 trapTab）。文字一律 textContent（硬邊界 4）。
// 〔重新看導覽〕下面是開關「電腦跑不動時自動降低畫質」（T-809，DESIGN §8.4）：每次打開面板重新讀目前的設定，按了立刻通知組裝端。

import { S } from '../i18n';
import { createSwitch } from './controls';
import { button, h } from './dom';
import { trapTab } from './focus';
import { icon } from './icons';
import {
  AUTO_QUALITY_HELP,
  AUTO_QUALITY_LABEL,
  HELP_CLOSE_LABEL,
  HELP_KEYS,
  HELP_KEYS_TITLE,
  HELP_RESTART_TOUR_TEXT,
  HELP_SECTIONS,
  HELP_TITLE,
} from './logic';

export interface HelpPanelHooks {
  /** 頁首的〔？〕按鈕：關掉後焦點回到它；按在它上面不算「點外面」（交給它自己的 toggle）。 */
  opener(): HTMLElement | null;
  /** 〔重新看導覽〕：面板已經關掉了才叫。 */
  restartTour(): void;
  /** 面板開了或關了（組裝端同步〔？〕的按下狀態、暫停導覽）。 */
  changed(open: boolean): void;
  /** 最下面的開關「電腦跑不動時自動降低畫質」現在開著嗎（T-809）；每次打開面板時讀一次。 */
  autoQuality(): boolean;
  /** 使用者按了那個開關（T-809）：組裝端記下來；關掉時馬上回到完整畫質。 */
  setAutoQuality(on: boolean): void;
}

export interface HelpPanel {
  readonly el: HTMLElement;
  isOpen(): boolean;
  open(): void;
  /** refocus＝焦點拉回〔？〕（預設要；換去別的地方時傳 false）。 */
  close(refocus?: boolean): void;
  /** 頁首〔？〕：開著就關、關著就開。 */
  toggle(): void;
  /** Esc：開著就關掉並回 true；沒開著回 false，讓別的處理。 */
  escape(): boolean;
  /** 被卡片庫等蓋住時不能按、Tab 走不進去。 */
  setInert(on: boolean): void;
}

export function createHelpPanel(hooks: HelpPanelHooks): HelpPanel {
  let openState = false;

  const line = (text: string) => h('li', { className: 'help-line', text });

  const section = (title: string, body: HTMLElement) =>
    h('section', { className: 'help-section' }, [h('h3', { className: 'help-section-title', text: title }), body]);

  const keyRows = HELP_KEYS.map((k) =>
    h('li', { className: 'help-key-row' }, [
      h('span', { className: 'help-keycaps' }, k.keys.map((key) => h('kbd', { className: 'help-key', text: key }))),
      h('span', { className: 'help-key-text', text: k.text }),
    ]),
  );

  const sections = [
    ...HELP_SECTIONS.map((s) => section(s.title, h('ul', { className: 'help-lines' }, s.lines.map(line)))),
    section(HELP_KEYS_TITLE, h('ul', { className: 'help-keys' }, keyRows)),
  ];

  const closeBtn = button('btn-icon help-close', [icon('close', 22)], S.common.closeEsc);
  closeBtn.setAttribute('aria-label', HELP_CLOSE_LABEL);
  closeBtn.addEventListener('click', () => close());

  const restartBtn = button('btn help-restart', [icon('rotate', 18), HELP_RESTART_TOUR_TEXT]);
  restartBtn.addEventListener('click', () => {
    close(false);
    hooks.restartTour();
  });

  // 最下面的開關（T-809，DESIGN §8.4）：電腦跑不動時自動降低畫質；預設開，記在這台電腦的瀏覽器
  const qualitySwitch = createSwitch(AUTO_QUALITY_LABEL, (next) => {
    qualitySwitch.set(next);
    hooks.setAutoQuality(next);
  });
  const qualitySetting = h('div', { className: 'help-setting' }, [
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: AUTO_QUALITY_LABEL }), qualitySwitch.el]),
    h('p', { className: 'help', text: AUTO_QUALITY_HELP }),
  ]);

  const el = h('aside', { className: 'help-panel', attrs: { role: 'dialog', 'aria-label': HELP_TITLE } }, [
    h('div', { className: 'help-head' }, [h('h2', { className: 'help-title', text: HELP_TITLE }), closeBtn]),
    h('div', { className: 'help-body' }, sections),
    h('div', { className: 'help-foot' }, [restartBtn, qualitySetting]),
  ]);
  el.hidden = true;
  // Tab 只在面板裡循環（T-607）
  trapTab(el);

  function open(): void {
    if (openState) return;
    openState = true;
    qualitySwitch.set(hooks.autoQuality() !== false);
    el.hidden = false;
    hooks.changed(true);
    closeBtn.focus();
  }

  function close(refocus = true): void {
    if (!openState) return;
    openState = false;
    el.hidden = true;
    hooks.changed(false);
    if (refocus) hooks.opener()?.focus();
  }

  // 點面板外面＝關掉。捕獲階段收：預覽區的指標處理可能把事件攔下來。
  // 焦點本來在面板裡才拉回〔？〕；點的是別的按鈕或預覽區就讓它自己拿焦點，不搶。
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!openState) return;
      const target = e.target as Node | null;
      if (target && (el.contains(target) || hooks.opener()?.contains(target))) return;
      close(el.contains(document.activeElement));
    },
    true,
  );

  return {
    el,
    isOpen: () => openState,
    open,
    close,
    toggle: () => (openState ? close() : open()),
    escape() {
      if (!openState) return false;
      close();
      return true;
    },
    setInert(on) {
      if (el.inert !== on) el.inert = on;
    },
  };
}
