// 第一次使用的導覽（DESIGN §8.1，T-606）：右下（或左下）一張小卡，共 4 步，每一步把對應的地方用青色外框圈起來；
// 〔下一步〕（最後一步是〔開始玩〕）、〔跳過〕、4 個進度點，Esc＝跳過（由 app.ts 的 Esc 處理叫 escape()，優先順序見那裡）。
// 看完或跳過就記在 localStorage（存在這台電腦，下次不再出現）；讀不到記錄就當看過，不要每次都跳出來煩人。
// 導覽開著時卡片照樣能操作：整層與外框不接滑鼠（style.css 的 .tour／.tour-ring：pointer-events: none），只有小卡本身接；
// 不掛鍵盤與滑鼠的全域監聽、不鎖住畫面。被卡片庫、新卡片面板、說明面板、匯出蓋住時由 app.ts 呼叫 suspend() 暫時收起來。
// 鍵盤（T-607b）：開始時焦點移到〔下一步〕（正在打字不搶；被蓋住時等看得到了才移，之後暫停再恢復不再搶），Tab 只在小卡裡循環；
// 看完或跳過（含 Esc）焦點回到開導覽前的地方，沒有的話給預覽區（focusFallback）。
// 文字一律 textContent（硬邊界 4）。

import { S } from '../i18n';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { dialogFocus, trapTab } from './focus';
import { TOUR_LABEL, TOUR_NEXT_TEXT, TOUR_SKIP_TEXT, TOUR_START_TEXT, TOUR_STEP_TEXTS } from './logic';

/** 記在 localStorage 的哪個名字下（有值＝看過了）。 */
export const TOUR_STORAGE_KEY = 'holocard.tour.seen';

/** 外框比被圈住的元素每邊大幾 px。 */
const RING_PAD = 4;

/** 每一步小卡放哪一邊：圈右欄那一步放左下，免得蓋住被圈的地方；其他在右下（DESIGN §8.1）。 */
const DOCKS: readonly ('left' | 'right')[] = ['right', 'right', 'left', 'right'];

/** localStorage 用到的那兩個函式（測試換成假的）。 */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TourHooks {
  /** 第 index 步（0 起）要圈住的元素：預覽區、左欄〔上傳圖片〕、右欄、頁首〔匯出 ▾〕。找不到回 null（不畫外框，小卡照樣顯示）。 */
  target(index: number): HTMLElement | null;
  /**
   * 第 index 步要顯示了（看得到時，量外框之前）：讓被指到的地方先準備好——右欄那一步，被指到的小節收著就先展開（T-836）。
   * 沒給＝不做事。
   */
  reveal?(index: number): void;
  /** 看完或跳過後，開導覽前的焦點已經不在了（沒有、被藏起來）時焦點給誰：預覽區（T-607b）。 */
  focusFallback?(): HTMLElement | null;
}

export interface Tour {
  readonly el: HTMLElement;
  /** 這台電腦還沒看過導覽才開始（回 true）。讀不到記錄、或已經看過都不開（回 false）。 */
  startIfFirstTime(): boolean;
  /** 〔重新看導覽〕：不管看過沒有，從第 1 步開始。 */
  start(): void;
  /** 小卡現在看得到嗎（進行中而且沒被暫停）。 */
  isOpen(): boolean;
  /** Esc＝跳過：看得到才收下（回 true）；沒開著或被暫停時回 false，讓別的處理。 */
  escape(): boolean;
  /** 被別的面板蓋住時暫停（收起來，進度保留）；恢復後回到同一步。沒在導覽時什麼都不做。 */
  suspend(on: boolean): void;
}

const browserStorage = (): TourStorage => window.localStorage;

/** getStorage 可以丟錯（有些環境連拿 localStorage 都會丟 SecurityError）或回 null：都當作看過。 */
export function createTour(hooks: TourHooks, getStorage: () => TourStorage | null = browserStorage): Tour {
  const last = TOUR_STEP_TEXTS.length - 1;
  /** 導覽進行中（含被暫停）。 */
  let active = false;
  let suspended = false;
  let index = 0;

  const hasSeen = (): boolean => {
    try {
      const storage = getStorage();
      return storage === null || storage.getItem(TOUR_STORAGE_KEY) !== null;
    } catch {
      return true;
    }
  };
  const markSeen = (): void => {
    try {
      getStorage()?.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      // 寫不進去也沒關係：這次照樣收起來
    }
  };

  const ring = h('div', { className: 'tour-ring', attrs: { 'aria-hidden': 'true' } });
  ring.hidden = true;
  const text = h('p', { className: 'tour-text', attrs: { 'aria-live': 'polite' } });
  const dots = TOUR_STEP_TEXTS.map(() => h('span', { className: 'tour-dot' }));
  const dotsEl = h('div', { className: 'tour-dots', attrs: { role: 'img' } }, dots);
  const skipBtn = button('btn btn-sm tour-skip', [TOUR_SKIP_TEXT]);
  const nextBtn = button('btn btn-sm primary tour-next', [TOUR_NEXT_TEXT]);
  const card = h('div', { className: 'tour-card', attrs: { role: 'dialog', 'aria-label': TOUR_LABEL } }, [
    text,
    h('div', { className: 'tour-foot' }, [dotsEl, h('div', { className: 'tour-actions' }, [skipBtn, nextBtn])]),
  ]);
  const el = h('div', { className: 'tour' }, [ring, card]);
  el.hidden = true;
  // 鍵盤（T-607b）：Tab 只在小卡裡循環；開始時焦點給〔下一步〕、結束時還回去
  trapTab(card);
  const focus = dialogFocus(card, { first: () => nextBtn, fallback: () => hooks.focusFallback?.() ?? null });
  /** 剛開始、還沒把焦點移進小卡（開始時被別的面板蓋住了，等看得到才移）。 */
  let wantsFocus = false;

  const visible = () => active && !suspended;

  /** 外框圈住這一步的元素。 */
  const placeRing = () => {
    const rect = hooks.target(index)?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      setHidden(ring, true);
      return;
    }
    setHidden(ring, false);
    ring.style.left = `${rect.left - RING_PAD}px`;
    ring.style.top = `${rect.top - RING_PAD}px`;
    ring.style.width = `${rect.width + RING_PAD * 2}px`;
    ring.style.height = `${rect.height + RING_PAD * 2}px`;
  };

  const render = () => {
    setText(text, TOUR_STEP_TEXTS[index] ?? '');
    setText(nextBtn, index === last ? TOUR_START_TEXT : TOUR_NEXT_TEXT);
    dots.forEach((dot, i) => {
      toggleClass(dot, 'is-on', i === index);
      toggleClass(dot, 'is-done', i < index);
      if (i === index) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    dotsEl.setAttribute('aria-label', S.tour.dotsLabel(index + 1, dots.length));
    card.dataset.dock = DOCKS[index] ?? 'right';
    // 被指到的小節收著就先展開（T-836），展開後才量外框
    hooks.reveal?.(index);
    placeRing();
  };

  const sync = () => {
    setHidden(el, !visible());
    if (visible()) {
      render();
      if (wantsFocus) {
        wantsFocus = false;
        focus.shown();
      }
    }
  };

  const finish = () => {
    active = false;
    wantsFocus = false;
    markSeen();
    sync();
    // 焦點還給開導覽前的地方；沒有地方可以還、焦點又還在要收起來的按鈕上，就放掉（不留在看不到的東西上）
    focus.hidden();
    const focused = document.activeElement as HTMLElement | null;
    if (focused && card.contains(focused)) focused.blur();
  };

  nextBtn.addEventListener('click', () => {
    if (index < last) {
      index++;
      render();
    } else {
      finish();
    }
  });
  skipBtn.addEventListener('click', finish);
  // 視窗大小改變：外框跟著元素
  window.addEventListener('resize', () => {
    if (visible()) placeRing();
  });

  const start = () => {
    active = true;
    index = 0;
    wantsFocus = true;
    sync();
  };

  return {
    el,
    startIfFirstTime() {
      if (hasSeen()) return false;
      start();
      return true;
    },
    start,
    isOpen: visible,
    escape() {
      if (!visible()) return false;
      finish();
      return true;
    },
    suspend(on) {
      if (suspended === on) return;
      suspended = on;
      if (active) sync();
    },
  };
}
