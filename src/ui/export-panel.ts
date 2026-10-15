// 轉一圈的影片／GIF 匯出中（T-504，DESIGN 7.1〔匯出 ▾〕）：
//   蓋住整個視窗的透明一層（不能點穿：匯出期間不能編輯，避免中途改卡讓前後格不一致；3D 預覽照常轉、看得清楚），
//   小框放在預覽區下方提示列的位置（不擋卡片，DESIGN §3、§6）：標題「正在做轉動影片…」／「正在做 GIF…」、進度條＋百分比、〔取消〕。
//   做完：「好了！」一下再關；取消：停掉、不下載、關掉；失敗：直接關（白話訊息由組裝端顯示在提示列）。Esc＝取消。
// 轉動影片（T-509b）：先在同一個位置出現選項小框（video-options.ts：動作、長度、音樂），按〔開始匯出〕才換成進度。
// GIF（T-512）：也先出現選項小框（gif-options.ts：動作、大小＋預估檔案大小）。兩個小框共用同一個動作的選擇（同一次開著工坊記住）。
//   選項小框的〔取消〕／Esc＝不匯出、直接關。
// 被別的分頁接手（T-512，審查中①）：block(true)＝選項小框關掉（試聽停、估算取消）、匯出中的送出取消、「好了！」直接關，
//   接手遮罩開著時整層不能拿焦點（inert）；block(false) 才恢復。
// MP4（T-514）：錄影回報聲音只能用 Opus 時，「好了！」下面加一行小字（DESIGN 7.1），多留一會兒看得完，〔知道了〕／Esc 可以先關。
// 包含卡套（T-806）：run 的 includeSleeve（頁首匯出選單的勾選）帶到這次的 exportVideo／exportGif 與 GIF 預估；沒給＝不帶（跟著卡片開關）。
// 畫上背景（T-814）：run 的 includeBackdrop 同上（GIF 預估照同一個選擇：勾著時畫格有背景、檔案比較大）；沒給＝不帶（跟著卡片）。
// 選項小框不蓋卡片（T-828h，DESIGN §6）：影片／GIF 的選項小框比提示列高很多（1280×720 約 194px），貼著預覽區底邊會蓋到比較高的卡。
//   小框開著時，卡片所在的 3D 預覽區往上縮到「卡片（含四邊空邊）的下緣離小框上緣 10px」：量小框的位置、照這張卡的高度算
//   （hooks.cardHeight；高的卡、矮的視窗縮得多，卡片本來就離小框夠遠就不縮），在預覽區元素（anchor）上設 --export-lift
//   （預覽區下面那一條要多高），style.css 讓提示列那一條至少這麼高；小框變高（選了音樂、出現錯誤、字換行）或視窗大小變了就重算；
//   小框關掉（開始匯出、取消、Esc、被接手）一律還原。預設縮放為準（滾輪放大過的卡不保證）。
// 連舞台一起錄（T-850）：影片與 GIF 的選項小框共用同一個勾選（stage-record.ts，同一次開著工坊記住）；舞台開不開問 hooks.stageOn（關＝變淡）。
// ui 只吐意圖（exportVideo、exportGif、estimateGif、readMusic、canMakeMp4）；文字一律 textContent。

import { S } from '../i18n';
import type { Mp4Info } from '../file/types';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { trapTab } from './focus';
import { createGifOptions } from './gif-options';
import { icon } from './icons';
import { posterHeight, progressPercent, TURNTABLE_DONE_TEXT, turntableTitle, videoDoneNote } from './logic';
import { defaultMotion } from './motion-picker';
import { defaultStageRecord } from './stage-record';
import type { TurntableKind, TurntableOutcome, UiIntents } from './types';
import { createVideoOptions } from './video-options';

/** 「好了！」顯示多久才關。 */
const DONE_MS = 1100;
/** 「好了！」下面有提醒小字時留多久（要看得完；〔知道了〕／Esc 可以先關）。 */
const DONE_NOTE_MS = 8000;
/** 小框底邊離預覽區底邊多遠（和提示列同一個位置）。 */
const BOTTOM_GAP_PX = 14;
/** 選項小框開著時，預覽區底邊離小框上緣至少多遠（T-828h）。 */
const LIFT_GAP_PX = 10;
/** 視窗太矮時，預覽區至少留多高（再小卡片就看不見了；這時小框只好蓋到一點）。 */
const MIN_PREVIEW_PX = 200;
const CANCEL = S.common.cancel;
const CANCELLING = S.export.cancelling;
const GOT_IT = S.export.gotIt;

export interface ExportPanelHooks {
  /** 開關了（app 依它鎖住／放開後面的編輯畫面）。 */
  changed(): void;
  /** 預覽區（小框放在它下方的提示列位置）。 */
  anchor(): HTMLElement;
  /**
   * 目前這張卡的高（卡寬＝1，model/aspect.ts 的 aspectHeight；T-828h）：選項小框開著時，預覽區照它算要縮多少才不蓋到卡片。
   * 不給或不是正常的數字＝不知道，當卡片佔滿預覽區（縮到整個預覽區都在小框上面）。
   */
  cardHeight?(): number | undefined;
  /** 這張卡的舞台開著嗎（T-850：「關」時選項小框的「連舞台一起錄」變淡）；不給＝開著。 */
  stageOn?(): boolean;
}

export interface ExportPanel {
  readonly el: HTMLElement;
  isOpen(): boolean;
  /**
   * 開始一次轉動匯出：先出現選項小框（影片：動作、長度、音樂；GIF：動作、大小），按〔開始匯出〕才呼叫 exportVideo／exportGif。
   * 做完（含取消、失敗）、小框關掉才 resolve。正在匯出（或正在選、或被接手）時再呼叫不做事。started＝真的開始做時呼叫（選項選好之後）。
   * includeSleeve（T-806）：匯出選單「包含卡套」的勾選，帶到這次的影片／GIF 與 GIF 預估；省略＝不帶（跟著卡片開關）。
   * includeBackdrop（T-814）：匯出選單「畫上背景」的勾選，同上；省略＝不帶（跟著卡片）。
   * includeStageFar（T-842）：同一個選擇帶到影片／GIF／GIF 預估；省略＝不帶（不畫遠景）。
   */
  run(kind: TurntableKind, started?: () => void, includeSleeve?: boolean, includeBackdrop?: boolean, includeStageFar?: boolean): Promise<void>;
  /** 〔取消〕／Esc：正在選選項就關掉（不匯出）；還在做就停掉；已經「好了！」就直接關。 */
  cancel(): void;
  /** 被別的分頁接手（true）：全部停掉、關掉，整層不能拿焦點；拿回來（false）才恢復。 */
  block(on: boolean): void;
}

/** 選項小框（影片或 GIF）。 */
interface OptionsBox<T> {
  readonly el: HTMLElement;
  ask(): Promise<T | null>;
  cancel(): void;
}

/**
 * 選項小框開著時，預覽區（舞台）底下要多留多高（px，T-828h）。
 * stage＝預覽區元素的上、下緣（client 座標，有 1px 邊框）；boxTop＝小框上緣；cardShare＝卡片（含四邊空邊）佔預覽區高度的幾成（0～1，不知道＝1）。
 * 預覽區縮成 h：卡片置中、下緣在 預覽區上緣 + h/2 + cardShare×h/2，要在 boxTop − LIFT_GAP_PX 以上；已經離得開就回 0。
 * 預覽區自己至少留 MIN_PREVIEW_PX 高（再小卡片就看不見了，這時小框只好蓋到一點）。壞資料回 0。
 */
export function previewReserve(stage: { top: number; bottom: number }, boxTop: number, cardShare = 1): number {
  const inner = stage.bottom - stage.top - 2;
  const share = Number.isFinite(cardShare) && cardShare > 0 ? Math.min(1, cardShare) : 1;
  const tallest = (2 * (boxTop - LIFT_GAP_PX - (stage.top + 1))) / (1 + share);
  const wanted = Math.ceil(inner - tallest);
  const most = Math.floor(inner - MIN_PREVIEW_PX);
  if (!Number.isFinite(wanted) || !Number.isFinite(most)) return 0;
  return Math.max(0, Math.min(wanted, most));
}

type Job = (onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<TurntableOutcome>;

export function createExportPanel(
  intents: Pick<UiIntents, 'exportVideo' | 'exportGif' | 'estimateGif' | 'readMusic' | 'canMakeMp4'>,
  hooks: ExportPanelHooks,
): ExportPanel {
  const title = h('p', { className: 'export-title', attrs: { id: 'export-title' } });
  /** 「好了！」下面的小字（T-514：MP4 的聲音是 Opus 時）。 */
  const note = h('p', { className: 'export-note', attrs: { id: 'export-note' } });
  note.hidden = true;
  const percent = h('span', { className: 'export-percent', attrs: { 'aria-hidden': 'true' } });
  const fill = h('div', { className: 'export-fill' });
  const bar = h('div', { className: 'export-bar', attrs: { role: 'progressbar', 'aria-labelledby': 'export-title', 'aria-valuemin': '0', 'aria-valuemax': '100' } }, [fill]);
  const cancelLabel = h('span', { text: CANCEL });
  const cancelBtn = button('btn export-cancel', [cancelLabel], S.export.stopNoDownload);
  const iconBox = h('div', { className: 'export-icon', attrs: { 'aria-hidden': 'true' } });
  const box = h('div', { className: 'export-box', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'export-title' } }, [
    iconBox,
    h('div', { className: 'export-main' }, [h('div', { className: 'export-head' }, [title, percent]), note, bar]),
    cancelBtn,
  ]);
  // 影片與 GIF 共用同一個動作的選擇（同一次開著工坊記住上次的動作與角度）
  const motion = defaultMotion();
  /** 這一次的「包含卡套」（T-806）與「畫上背景」（T-814）（run 開始時記下）；undefined＝沒給，選項原樣送出（不帶這個欄位）。 */
  let sleeveChoice: boolean | undefined;
  let backdropChoice: boolean | undefined;
  let stageFarChoice: boolean | undefined;
  const withSleeve = <T extends object>(options: T): T => {
    let out = options;
    if (sleeveChoice !== undefined) out = { ...out, includeSleeve: sleeveChoice };
    if (backdropChoice !== undefined) out = { ...out, includeBackdrop: backdropChoice };
    if (stageFarChoice !== undefined) out = { ...out, includeStageFar: stageFarChoice };
    return out;
  };
  // 連舞台一起錄（T-850）：兩個小框共用、同一次開著工坊記住
  const stageRecord = defaultStageRecord();
  const stageOn = () => hooks.stageOn?.() ?? true;
  const videoOptions = createVideoOptions(intents, motion, stageRecord, stageOn);
  // GIF 的預估照同一個選擇（畫不畫卡套，裁切大小不一樣；畫不畫背景，檔案大小差很多）
  const gifOptions = createGifOptions({ estimateGif: (choice, signal) => intents.estimateGif(withSleeve(choice), signal) }, motion, stageRecord, stageOn);
  const el = h('div', { className: 'export-overlay' }, [box, videoOptions.el, gifOptions.el]);
  el.hidden = true;
  // Tab 只在小框裡循環（T-607）
  trapTab(el);

  let controller: AbortController | null = null;
  /** 開著的選項小框（還沒按〔開始匯出〕）。 */
  let choosing: OptionsBox<unknown> | null = null;
  /** 「好了！」顯示中：按〔取消〕或 Esc 就直接關。 */
  let closeDone: (() => void) | null = null;
  /** 被別的分頁接手了。 */
  let blocked = false;

  const setProgress = (fraction: number) => {
    const p = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    fill.style.width = `${(p * 100).toFixed(1)}%`;
    setText(percent, progressPercent(p));
    bar.setAttribute('aria-valuenow', String(Math.floor(p * 100)));
  };

  /** 放在預覽區下方的提示列位置、左右置中對齊預覽區（視窗大小變了就重算）。 */
  const place = () => {
    const r = hooks.anchor().getBoundingClientRect();
    el.style.setProperty('--export-x', `${Math.round(r.left + r.width / 2)}px`);
    el.style.setProperty('--export-bottom', `${Math.round(window.innerHeight - r.bottom + BOTTOM_GAP_PX)}px`);
    if (choosing) lift(choosing.el);
  };

  /**
   * 選項小框開著：預覽區讓位（見檔頭 T-828h）。小框的位置用 offsetTop／offsetHeight（版面位置，不受進場動畫的位移影響；
   * 小框是 position: absolute、算在蓋滿視窗的透明層裡，所以 offsetTop 就是視窗座標）；還沒有版面（高度 0）就不讓。
   * 卡片佔預覽區幾成：同開啟工坊時的縮圖（posterHeight：預設縮放下卡片＋四邊空邊），不知道卡高就當佔滿（1）。
   */
  const lift = (options: HTMLElement) => {
    const anchor = hooks.anchor();
    const cardH = hooks.cardHeight?.();
    const share = cardH !== undefined && Number.isFinite(cardH) && cardH > 0 ? posterHeight(cardH) / 100 : 1;
    const reserve = options.offsetHeight > 0 ? previewReserve(anchor.getBoundingClientRect(), options.offsetTop, share) : 0;
    if (reserve > 0) anchor.style.setProperty('--export-lift', `${reserve}px`);
    else anchor.style.removeProperty('--export-lift');
  };
  const unlift = () => hooks.anchor().style.removeProperty('--export-lift');

  const close = () => {
    window.removeEventListener('resize', place);
    el.hidden = true;
    hooks.changed();
  };

  /** 先在同一個位置、同一層遮罩出現選項小框；選好回選項，取消回 null（小框關掉，遮罩還開著）。 */
  const choose = async <T,>(options: OptionsBox<T>): Promise<T | null> => {
    choosing = options;
    box.hidden = true;
    options.el.hidden = false;
    toggleClass(el, 'is-choosing', true);
    place();
    window.addEventListener('resize', place);
    el.hidden = false;
    hooks.changed();
    let watcher: ResizeObserver | null = null;
    try {
      const asked = options.ask();
      // 小框顯示出來、內容排好（ask 會重排）才量得到位置；之後小框變高（選了音樂、錯誤、字換行）跟著重算
      lift(options.el);
      if (typeof ResizeObserver === 'function') {
        watcher = new ResizeObserver(() => lift(options.el));
        watcher.observe(options.el);
      }
      return await asked;
    } finally {
      watcher?.disconnect();
      unlift();
      choosing = null;
      options.el.hidden = true;
      box.hidden = false;
      toggleClass(el, 'is-choosing', false);
    }
  };

  cancelBtn.addEventListener('click', () => panel.cancel());

  const panel: ExportPanel = {
    el,
    isOpen: () => !el.hidden,
    async run(kind, started, includeSleeve, includeBackdrop, includeStageFar) {
      if (blocked || controller || choosing || !el.hidden) return;
      sleeveChoice = includeSleeve;
      backdropChoice = includeBackdrop;
      stageFarChoice = includeStageFar;
      let job: Job | null = null;
      /** MP4 錄影回報的實際編碼（WebM、GIF 沒有）。 */
      let info = null as Mp4Info | null;
      if (kind === 'webm') {
        const video = await choose(videoOptions);
        if (video) {
          job = (onProgress, signal) =>
            intents.exportVideo(withSleeve(video), onProgress, signal, (got) => {
              info = got;
            });
        }
      } else {
        const gif = await choose(gifOptions);
        if (gif) job = (onProgress, signal) => intents.exportGif(withSleeve(gif), onProgress, signal);
      }
      // 取消了（或選的時候被接手了）：直接關
      if (!job || blocked) {
        close();
        return;
      }
      const work = new AbortController();
      controller = work;
      started?.();
      el.dataset.kind = kind;
      toggleClass(el, 'is-done', false);
      iconBox.replaceChildren(icon(kind === 'webm' ? 'video' : 'loop', 26));
      setText(title, turntableTitle(kind));
      setHidden(percent, false);
      setProgress(0);
      setHidden(cancelBtn, false);
      cancelBtn.disabled = false;
      setText(cancelLabel, CANCEL);
      cancelBtn.title = S.export.stopNoDownload;
      setText(note, '');
      setHidden(note, true);
      box.removeAttribute('aria-describedby');
      place();
      window.addEventListener('resize', place);
      el.hidden = false;
      hooks.changed();
      cancelBtn.focus();
      try {
        const onProgress = (fraction: number) => {
          // 按了取消之後不再動進度條
          if (!work.signal.aborted) setProgress(fraction);
        };
        const outcome = await job(onProgress, work.signal);
        if (outcome === 'done' && !blocked) {
          const doneNote = videoDoneNote(info);
          setProgress(1);
          setText(title, TURNTABLE_DONE_TEXT);
          setHidden(percent, true);
          toggleClass(el, 'is-done', true);
          if (doneNote) {
            // 有提醒：小字＋〔知道了〕（同〔取消〕的位置，按了或 Esc 就關），多留一會兒
            setText(note, doneNote);
            setHidden(note, false);
            box.setAttribute('aria-describedby', 'export-note');
            setText(cancelLabel, GOT_IT);
            cancelBtn.title = '';
            cancelBtn.focus();
          } else {
            setHidden(cancelBtn, true);
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, doneNote ? DONE_NOTE_MS : DONE_MS);
            closeDone = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        closeDone = null;
        controller = null;
        close();
      }
    },
    cancel() {
      if (choosing) {
        choosing.cancel();
        return;
      }
      if (closeDone) {
        closeDone();
        return;
      }
      if (!controller || controller.signal.aborted) return;
      controller.abort();
      cancelBtn.disabled = true;
      setText(cancelLabel, CANCELLING);
    },
    block(on) {
      blocked = on;
      // 接手遮罩開著時：整層不能拿焦點（取消入口被遮住，改由這裡全部停掉）
      el.inert = on;
      if (on) panel.cancel();
    },
  };
  return panel;
}
