// GIF 動圖的選項（T-512，DESIGN 7.1〔匯出 ▾〕；使用者 2026-10-14：「GIF 匯出時給使用者自己選，顯示檔案會多大」）：
//   按〔GIF 動圖〕後先出現這個小框（和影片的選項小框同一個位置、同樣式，由 export-panel.ts 開關；Esc／〔取消〕＝不匯出）。
//   動作：〔轉一圈〕〔左右擺動〕＋擺動角度（motion-picker.ts，和影片共用同一個選擇）；動作下面一列「上下」（T-812）。
//   大小：〔小（寬 320）〕〔中（寬 400）〕〔大（寬 480）〕，每個旁邊顯示預估檔案大小「約 4.9 MB」：
//   打開時用這張卡（和選的動作）在兩種寬度試編幾格來估（intents.estimateGif），估好之前顯示「估算中…」；換動作馬上重估、
//   改擺動角度或上下角度停手 0.4 秒才重估；估不出來就不顯示數字（照樣能匯出）。同一次開著工坊記住上次選的大小，第一次選「中」。
// 連舞台一起錄（T-850）：〔開始匯出〕上面一列勾選（stage-record.ts，和影片共用同一個選擇）；勾著而且舞台開著時大小換成橫的寬 480／600／720
//   （gifWidth(size, true)）、預估照同一個選擇重估（estimateGif 帶 withStage: true）、多一句小字「舞台畫面顏色多…」；送出帶 withStage: true。
//   不勾時送出與估算的選項和以前一樣（沒有這個欄位）。stageOn＝打開時問這張卡的舞台是不是開著（關＝變淡、照不勾）。
// ui 只吐意圖；文字一律 textContent。

import { S } from '../i18n';
import { button, h, setText, toggleClass } from './dom';
import { icon } from './icons';
import {
  DEFAULT_GIF_SIZE,
  estimateGifBytes,
  fileSizeText,
  GIF_ESTIMATE_NOTE,
  GIF_ESTIMATING_TEXT,
  GIF_SIZES,
  gifSizeLabel,
  gifWidth,
  plainKey,
  STAGE_GIF_NOTE,
} from './logic';
import { createMotionPicker, defaultMotion } from './motion-picker';
import { createStageRecordToggle, defaultStageRecord, type StageRecordChoice } from './stage-record';
import type { GifExportOptions, GifSample, GifSize, MotionChoice, UiIntents } from './types';

/** 改擺動角度、上下角度後停手多久才重新估（拖滑桿時不要一直估）。 */
export const ESTIMATE_DELAY_MS = 400;

export interface GifOptions {
  /** 小框本身（放在匯出的透明遮罩裡）。 */
  readonly el: HTMLElement;
  /** 打開：按〔開始匯出〕→ 選好的選項；〔取消〕／Esc → null。 */
  ask(): Promise<GifExportOptions | null>;
  /** Esc：等同〔取消〕。 */
  cancel(): void;
}

/**
 * motion＝動作的選擇、stage＝連舞台一起錄（T-850）的選擇（都和影片的選項小框共用同一個物件；沒給就自己一份）；
 * stageOn＝這張卡的舞台開著嗎（打開小框時問；沒給＝開著）。
 */
export function createGifOptions(
  intents: Pick<UiIntents, 'estimateGif'>,
  motion: MotionChoice = defaultMotion(),
  stage: StageRecordChoice = defaultStageRecord(),
  stageOn: () => boolean = () => true,
): GifOptions {
  /** 上次選的大小：同一次開著工坊時沿用。 */
  let size: GifSize = DEFAULT_GIF_SIZE;
  /** 試編結果（每個試編寬度一筆）：undefined＝估算中、null＝估不出來（不顯示數字）。 */
  let sample: GifSample[] | null | undefined;
  /** 進行中的估算（換動作、關掉時送出取消）。 */
  let estimating: AbortController | null = null;
  let estimateTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveAsk: ((result: GifExportOptions | null) => void) | null = null;

  // ---- 動作 ----
  const motionPicker = createMotionPicker(
    motion,
    (what) => {
      if (!resolveAsk) return;
      if (what === 'motion') startEstimate();
      else estimateLater();
    },
    'go',
  );

  // ---- 大小：分段按鈕（單選），每個旁邊顯示預估檔案大小（連舞台一起錄時寬度不一樣，字由 render 寫） ----
  const sizeButtons = GIF_SIZES.map((s) => {
    const est = h('small', { className: 'go-size-est' });
    const label = h('span', { text: gifSizeLabel(s.size) });
    const b = button('seg-btn go-size', [label, est]);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => pickSize(s.size));
    return { size: s.size, el: b, label, est };
  });
  const sizeGroup = h(
    'div',
    { className: 'segmented go-sizes', attrs: { role: 'radiogroup', 'aria-labelledby': 'go-size-label' } },
    sizeButtons.map((b) => b.el),
  );

  // ---- 連舞台一起錄（T-850）：勾了或取消就換大小的字、重估 ----
  const stageToggle = createStageRecordToggle(stage, () => {
    if (!resolveAsk) return;
    startEstimate();
  });
  const stageNote = h('p', { className: 'vo-note go-stage-note', text: STAGE_GIF_NOTE });
  stageNote.hidden = true;
  /** 這次的選擇要帶上的欄位（勾著而且舞台開著才有，不勾＝和以前一樣沒有這個欄位）。 */
  const withStage = () => (stageToggle.active() ? { withStage: true } : {});

  // ---- 〔取消〕〔開始匯出〕 ----
  const cancelBtn = button('btn vo-cancel go-cancel', [S.common.cancel], S.export.noExport);
  const startBtn = button('btn primary vo-go go-go', [icon('download', 18), S.export.start]);
  cancelBtn.addEventListener('click', () => finish(null));
  startBtn.addEventListener('click', () =>
    finish({ size, motion: motion.motion, swingDeg: motion.swingDeg, nodDeg: motion.nodDeg, ...withStage() }),
  );

  const el = h(
    'div',
    { className: 'export-box gif-options', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': S.export.gifOptions } },
    [
      h('div', { className: 'export-icon vo-icon', attrs: { 'aria-hidden': 'true' } }, [icon('loop', 26)]),
      h('div', { className: 'vo-main' }, [
        motionPicker.el,
        h('div', { className: 'vo-row go-size-row' }, [h('span', { className: 'vo-label', text: S.export.size, attrs: { id: 'go-size-label' } }), sizeGroup]),
        stageToggle.el,
        stageNote,
        h('div', { className: 'vo-row vo-foot' }, [h('p', { className: 'vo-note', text: GIF_ESTIMATE_NOTE }), cancelBtn, startBtn]),
      ]),
    ],
  );
  el.hidden = true;

  const render = () => {
    const staged = stageToggle.active();
    stageNote.hidden = !staged;
    for (const b of sizeButtons) {
      const on = b.size === size;
      toggleClass(b.el, 'is-selected', on);
      b.el.setAttribute('aria-checked', String(on));
      b.el.tabIndex = on ? 0 : -1;
      setText(b.label, gifSizeLabel(b.size, staged));
      const bytes = sample ? estimateGifBytes(sample, gifWidth(b.size, staged)) : null;
      setText(b.est, sample === undefined ? GIF_ESTIMATING_TEXT : bytes === null ? '' : fileSizeText(bytes));
      toggleClass(b.est, 'is-estimating', sample === undefined);
    }
  };

  const pickSize = (next: GifSize) => {
    if (next === size) return;
    size = next;
    render();
  };
  sizeGroup.addEventListener('keydown', (e) => {
    // Ctrl+→ 之類的組合鍵、輸入法選字中不換（T-703b 補上 T-607c 的 plainKey）
    if (!plainKey(e)) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = GIF_SIZES.findIndex((s) => s.size === size);
    const next = GIF_SIZES[Math.min(GIF_SIZES.length - 1, Math.max(0, i + step))]!.size;
    pickSize(next);
    sizeButtons.find((b) => b.size === next)?.el.focus();
  });

  /** 停掉進行中與等著的估算。 */
  const stopEstimate = () => {
    clearTimeout(estimateTimer);
    estimateTimer = undefined;
    estimating?.abort();
    estimating = null;
  };

  /** 用目前的動作重新估（上一次的結果作廢）。 */
  const startEstimate = () => {
    stopEstimate();
    const job = new AbortController();
    estimating = job;
    sample = undefined;
    render();
    let result: Promise<GifSample[] | null>;
    try {
      result = intents.estimateGif({ ...motion, ...withStage() }, job.signal);
    } catch (err) {
      result = Promise.reject(err);
    }
    void result
      .catch((err: unknown) => {
        // 估不出來不影響匯出；英文原文只寫 console
        console.error(err);
        return null;
      })
      .then((got) => {
        if (estimating !== job || !resolveAsk) return;
        estimating = null;
        sample = got;
        render();
      });
  };

  /** 改擺動角度或上下角度（T-812）：先顯示估算中，停手一下才重估。 */
  const estimateLater = () => {
    stopEstimate();
    sample = undefined;
    render();
    estimateTimer = setTimeout(startEstimate, ESTIMATE_DELAY_MS);
  };

  const finish = (result: GifExportOptions | null) => {
    const resolve = resolveAsk;
    if (!resolve) return;
    resolveAsk = null;
    stopEstimate();
    resolve(result);
  };

  return {
    el,
    ask() {
      if (resolveAsk) return Promise.resolve(null);
      // 動作、連舞台一起錄可能在影片的選項小框改過；舞台開不開看這張卡
      motionPicker.render();
      stageToggle.render(stageOn());
      const asked = new Promise<GifExportOptions | null>((resolve) => {
        resolveAsk = resolve;
      });
      startEstimate();
      // 小框出現後焦點放在〔開始匯出〕：直接按 Enter＝照上次的選擇匯出
      queueMicrotask(() => startBtn.focus());
      return asked;
    },
    cancel: () => finish(null),
  };
}
