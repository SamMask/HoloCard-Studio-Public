// 中間：舞台背景（正面底圖放大模糊＋暗角，DESIGN §5；舞台選展示廳時換成展示廳的深藍底色，T-410；T-816 起展示廳換成畫好的大廳
// 〔state.galleryHallUrl，鋪滿、不模糊、略壓暗＋暗角，不套 T-822 的位置；還沒讀好照舊深藍底〕；
// 這張卡有舞台背景圖〔T-814〕時換成那張：鋪滿、不模糊、約 85% 亮度＋淡暗角，各舞台的底色不蓋掉它；水鏡的遠景由 3D 畫；
// 工作桌〔T-832〕、沒有自己的背景圖：清楚的木桌〔is-desk，和頁面背景同一張圖，style.css 的 T-832 段直接鋪；img 不放圖〕；
// 遠景的位置與大小〔T-822〕：背景圖照 render/backdrop.ts 的 farPanCss 擺〔CSS 變數 --far-pos、--far-zoom → object-position＋scale〕，
// 和水鏡的遠景平面、匯出的「畫上背景」同一個算法，任何預覽區寬高比都不露空白）
// ＋3D 預覽（previewHost）＋前景圖〔T-830：疊在 3D 畫布上面、選取框下面，不接滑鼠（拖卡、點圖層、破框層照舊）；
// 照 render/backdrop.ts 的 foregroundCss 擺（預覽區的 cqw／cqh，和匯出同一個算法）、CSS 模糊；轉卡時 driftForeground 微動〕
// ＋疊層（overlayHost）＋空狀態虛線框＋拖檔案進來的提示
// ＋開啟時 3D 還沒好之前的靜態縮圖（T-404）＋卡片故事（T-804：卡片兩側的直排詩句，3D 預覽上面、選取框下面，不接滑鼠，story.ts）；
// 下方一條提示列：平常是操作說明，有訊息時換成訊息；上傳沒有透明的圖時多一個確認框
// （T-408 取代底圖／當發光層／當加深層；T-703 起不管有沒有底圖都問，多〔自動去背〕〔拆成立體層〕〔T-704 起可以按〕）；
// AI 的問題（沒有圖形加速、找不到主角、分不出遠近）與 AI 進行中的小面板（進度、〔取消〕）也在這裡（T-703、T-704）。
// 提示列和確認框在預覽區「下面」而不是疊在上面，所以永遠不會蓋住卡片。
// 提示列左邊：〔展示〕、〔−〕{縮放比例}〔＋〕、〔全螢幕〕（T-835，view-tools.ts；全螢幕鋪滿的是整個預覽區，下方工具列照樣在）。
// 鍵盤（T-607，DESIGN §8.2）：預覽區本身可以拿焦點（Tab 走得到；方向鍵轉卡等在 interact/keys.ts，Delete 在 app.ts）；
// 三個小對話框（上傳確認、AI 的問題、刪圖層確認）打開時焦點移到第一個控制項、Tab 只在框裡循環、關掉時焦點回到原本的地方。

import { S } from '../i18n';
import { farPanOf, foregroundOf, waterLookOf } from '../model/actions';
import type { FaceSide } from '../model/types';
import { farPanCss, foregroundCss } from '../render/backdrop';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { dialogFocus, trapTab } from './focus';
import { createStoryView, STORY_ENABLED, type StoryBox } from './story';
import { icon, swapIcon } from './icons';
import { createViewTools, type FullscreenApi } from './view-tools';
import {
  AI_CONTINUE_LABEL,
  posterHeight,
  stageBackdropView,
  AI_CUTOUT_DETAIL,
  AI_CUTOUT_LABEL,
  AI_CUTTING_TEXT,
  AI_LOADING_TEXT,
  AI_MODEL_MISSING_NOTE,
  AI_NO_BACKGROUND_TEXT,
  AI_NO_SUBJECT_TEXT,
  AI_NO_DEPTH_TEXT,
  AI_SLOW_ASK_TEXT,
  AI_SPLIT_DETAIL,
  AI_SPLIT_LABEL,
  AI_SPLIT_REPLACES_NOTE,
  AI_SPLITTING_TEXT,
  AI_WORKING_NOTE,
  AS_BASE_LABEL,
  OPAQUE_LAYER_NOTE,
  opaqueUploadChoices,
  PREVIEW_LABEL,
  progressPercent,
  REPLACE_BASE_LABEL,
  UPLOAD_ASK_TITLE,
  type OpaqueUploadChoice,
} from './logic';
import type { AiAsk, AiProgressView, AiView, UiIntents, UiMessage, UiState } from './types';

const INFO_MS = 4500;
/** AI 問題框的標題（T-703、T-704）。 */
const ASK_TEXT: Record<AiAsk['kind'], string> = {
  slow: AI_SLOW_ASK_TEXT,
  'no-subject': AI_NO_SUBJECT_TEXT,
  'no-background': AI_NO_BACKGROUND_TEXT,
  'no-depth': AI_NO_DEPTH_TEXT,
};
const ERROR_MS = 8000;
/** 縮圖淡出的時間（同 style.css 的 .stage-poster transition）。 */
const POSTER_FADE_MS = 450;

export interface Stage {
  readonly el: HTMLElement;
  readonly previewHost: HTMLElement;
  readonly overlayHost: HTMLElement;
  render(state: UiState): void;
  /** 有檔案拖在視窗上方時顯示「放開就加到…」（卡片檔＝「放開就匯入卡片檔」）；null＝收起。 */
  showDrop(face: FaceSide | null, kind?: 'card-file' | 'images'): void;
  /** 3D 還沒畫出來之前先顯示的靜態縮圖（url 是 object URL；圖的比例就是卡片外框的比例；cardH＝卡高，決定縮圖多高）。 */
  showPoster(url: string, cardH: number): void;
  /** 縮圖淡出；淡出完呼叫 done（收回 object URL）。 */
  hidePoster(done: () => void): void;
  /** 卡片故事（T-804）：卡片正面朝前時的外框（client 座標，main 每影格給）；null＝不知道。字排在它左右兩邊外面。 */
  placeStory(card: StoryBox | null): void;
  /** 前景圖（T-830）轉卡時的微動（預覽區寬的 %；y 往下是正的）；0 拿掉變數、值一樣不重設。 */
  driftForeground(x: number, y: number): void;
  /** 下方工具列的縮放比例（T-835，main 每格給）。 */
  setZoom(zoom: number): void;
  /** 在全螢幕就離開（T-835：被另一個分頁接手時，遮罩在預覽區外面）。 */
  exitFullscreen(): void;
}

/** fullscreen：測試換成假的 Fullscreen API（沒給＝瀏覽器真的）。 */
export function createStage(intents: UiIntents, fullscreen?: FullscreenApi): Stage {
  // 預覽區可以拿焦點（Tab 走得到）：方向鍵轉卡、選中圖層時移動它（T-607，interact/keys.ts）
  const previewHost = h('div', { className: 'preview-host', attrs: { tabindex: '0', role: 'group', 'aria-label': PREVIEW_LABEL } });
  const overlayHost = h('div', { className: 'overlay-host' });

  // 舞台背景：鋪滿整個預覽區（含下方提示列）、在 3D 預覽「後面」、不接滑鼠；沒有底圖時只剩深藍漸層（.stage 自己的背景）
  const backdropImg = h('img', { className: 'stage-backdrop-img', attrs: { alt: '', draggable: 'false', decoding: 'async' } });
  backdropImg.addEventListener('load', () => toggleClass(backdropImg, 'is-ready', true));
  const backdrop = h('div', { className: 'stage-backdrop', attrs: { 'aria-hidden': 'true' } }, [backdropImg]);
  let backdropUrl: string | undefined;

  const dropText = h('span');
  const drop = h('div', { className: 'drop-overlay' }, [h('div', { className: 'drop-card' }, [icon('upload', 32), dropText])]);

  // 3D 還沒畫出來之前先顯示的靜態縮圖（開啟工坊時）：置中、照卡片比例；3D 第一格畫好就淡出
  const poster = h('img', { className: 'stage-poster', attrs: { alt: '', draggable: 'false', 'aria-hidden': 'true' } });
  poster.hidden = true;
  let posterDone: (() => void) | null = null;
  let posterTimer: ReturnType<typeof setTimeout> | undefined;

  // 卡片故事（T-804）：3D 預覽上面、選取框與拖放提示下面；不接滑鼠（拖卡片旁邊的空白照樣轉卡）
  const story = createStoryView();
  // 前景圖（T-830）：3D 預覽與故事上面、選取框下面；不接滑鼠（style.css 的 T-830 段）
  const foregroundImg = h('img', { className: 'stage-foreground-img', attrs: { alt: '', draggable: 'false', decoding: 'async' } });
  const foreground = h('div', { className: 'stage-foreground', attrs: { 'aria-hidden': 'true' } }, [foregroundImg]);
  let foregroundUrl: string | undefined;
  const view = h('div', { className: 'stage-view' }, [previewHost, poster, story.el, foreground, overlayHost, drop]);
  const emptyFrame = h('div', { className: 'stage-empty-frame', attrs: { 'aria-hidden': 'true' } });

  // ---- 上傳沒有透明的圖時的確認框（T-408；T-703 起不管有沒有底圖都問，DESIGN §4）----
  // 第一排大按鈕：已有底圖〔自動去背〕〔拆成立體層〕〔取代底圖〕；還沒有〔當底圖〕〔自動去背〕〔拆成立體層〕。
  // 第二排（已有底圖才有）小按鈕〔當發光層〕〔當加深層〕＋小字；〔取消〕靠右。
  // 哪個模型還沒下載，那一顆 AI 按鈕就變淡＋說明怎麼下載；另一件 AI 工作還在做時兩顆都變淡（T-704）。
  const confirmFile = h('span', { className: 'confirm-file' });
  const bigChoice = (iconName: 'sparkle' | 'layers' | 'image', label: string, detail?: string) => {
    const sub = h('span', { className: 'ai-choice-sub', text: detail ?? '' });
    sub.hidden = !detail;
    const text = h('span', { className: 'ai-choice-text' }, [
      h('span', { className: 'ai-choice-head' }, [h('span', { className: 'ai-choice-label', text: label })]),
      sub,
    ]);
    const el = button('btn btn-lg ai-choice', [h('span', { className: 'ai-choice-icon' }, [icon(iconName, 20)]), text]);
    return { el, sub };
  };
  const cutout = bigChoice('sparkle', AI_CUTOUT_LABEL, AI_CUTOUT_DETAIL);
  const split = bigChoice('layers', AI_SPLIT_LABEL, AI_SPLIT_DETAIL);
  const replace = bigChoice('image', REPLACE_BASE_LABEL);
  const asBase = bigChoice('image', AS_BASE_LABEL);
  const choiceEls: Record<OpaqueUploadChoice, HTMLButtonElement> = {
    cutout: cutout.el,
    split: split.el,
    replace: replace.el,
    base: asBase.el,
  };
  const asGlow = button('btn confirm-minor', [S.preview.asGlow, h('span', { className: 'confirm-choice-sub', text: S.preview.asGlowSub })]);
  const asInk = button('btn confirm-minor', [S.preview.asInk, h('span', { className: 'confirm-choice-sub', text: S.preview.asInkSub })]);
  const cancel = button('btn btn-lg', [S.common.cancel]);
  cutout.el.addEventListener('click', () => intents.answerAutoCutout());
  split.el.addEventListener('click', () => intents.answerSplitLayers());
  replace.el.addEventListener('click', () => intents.answerReplaceBase(true));
  asBase.el.addEventListener('click', () => intents.answerReplaceBase(true));
  asGlow.addEventListener('click', () => intents.answerOpaqueLayer('screen'));
  asInk.addEventListener('click', () => intents.answerOpaqueLayer('multiply'));
  cancel.addEventListener('click', () => intents.answerReplaceBase(false));
  const mainRow = h('div', { className: 'confirm-main' });
  const aiNote = h('p', { className: 'confirm-ai-note', attrs: { id: 'confirm-ai-note', role: 'note' } });
  aiNote.hidden = true;
  const minorRow = h('div', { className: 'confirm-minor-row' }, [asGlow, asInk, h('span', { className: 'confirm-minor-note', text: OPAQUE_LAYER_NOTE })]);
  const confirm = h('div', { className: 'confirm confirm-upload', attrs: { role: 'alertdialog', 'aria-labelledby': 'confirm-title' } }, [
    h('div', { className: 'confirm-icon' }, [icon('image', 22)]),
    h('div', { className: 'confirm-text' }, [h('p', { className: 'confirm-title', text: UPLOAD_ASK_TITLE, attrs: { id: 'confirm-title' } }), confirmFile]),
    mainRow,
    aiNote,
    h('div', { className: 'confirm-bottom' }, [minorRow, cancel]),
  ]);
  /** 第一排目前是哪一種（有底圖／沒有），變了才重排。 */
  let shownHasBase: boolean | null = null;
  // 鍵盤（T-607）：Tab 只在確認框裡循環；打開時焦點移到第一個能按的（能去背就是〔自動去背〕），關掉時回到原本的地方
  trapTab(confirm);
  const confirmFocus = dialogFocus(confirm, { fallback: () => previewHost });

  // ---- AI 的問題（T-703）：沒有圖形加速先問〔繼續〕；找不到主角〔當底圖〕；都有〔取消〕 ----
  const askTitle = h('p', { className: 'confirm-title', attrs: { id: 'ai-ask-title' } });
  const askFile = h('span', { className: 'confirm-file' });
  const askIcon = h('div', { className: 'confirm-icon' });
  const askYesLabel = h('span');
  const askYes = button('btn btn-lg primary', [askYesLabel]);
  const askNo = button('btn btn-lg', [S.common.cancel]);
  askYes.addEventListener('click', () => intents.answerAiAsk(true));
  askNo.addEventListener('click', () => intents.answerAiAsk(false));
  const askBox = h('div', { className: 'confirm confirm-ai', attrs: { role: 'alertdialog', 'aria-labelledby': 'ai-ask-title' } }, [
    askIcon,
    h('div', { className: 'confirm-text' }, [askTitle, askFile]),
    h('div', { className: 'confirm-actions' }, [askYes, askNo]),
  ]);
  askBox.hidden = true;
  let askKind: AiAsk['kind'] | null = null;
  trapTab(askBox);
  const askFocus = dialogFocus(askBox, { first: () => askYes, fallback: () => previewHost });

  // ---- AI 進行中的小面板（T-703）：提示列上面（和匯出面板同一個地方、不蓋卡片）；不是對話框，後面照常能編輯 ----
  const aiTitle = h('p', { className: 'ai-progress-title', attrs: { id: 'ai-progress-title' } });
  const aiPercent = h('span', { className: 'ai-progress-percent', attrs: { 'aria-hidden': 'true' } });
  const aiFill = h('div', { className: 'ai-progress-fill' });
  const aiBar = h('div', {
    className: 'ai-progress-bar',
    attrs: { role: 'progressbar', 'aria-labelledby': 'ai-progress-title', 'aria-valuemin': '0', 'aria-valuemax': '100' },
  }, [aiFill]);
  const aiCancel = button('btn ai-progress-cancel', [S.common.cancel], S.preview.aiCancelTip);
  aiCancel.addEventListener('click', () => intents.cancelAi());
  const aiPanel = h('div', { className: 'ai-progress', attrs: { role: 'status', 'aria-labelledby': 'ai-progress-title' } }, [
    h('div', { className: 'ai-progress-icon', attrs: { 'aria-hidden': 'true' } }, [icon('sparkle', 24)]),
    h('div', { className: 'ai-progress-main' }, [h('div', { className: 'ai-progress-head' }, [aiTitle, aiPercent]), aiBar]),
    aiCancel,
  ]);
  aiPanel.hidden = true;
  /** 進度條現在怎麼走：'exact'＝照比例；'creep:<秒>'＝不知道比例，照預估時間慢慢走到約 9 成；''＝沒在顯示。 */
  let aiBarMode = '';

  const renderUpload = (pending: UiState['pendingReplaceBase'], ai: AiView | undefined) => {
    setHidden(confirm, pending === null);
    setText(confirmFile, pending ? S.preview.fileName(pending.fileName) : '');
    if (!pending) {
      confirmFocus.hidden();
      return;
    }
    if (shownHasBase !== pending.hasBase) {
      shownHasBase = pending.hasBase;
      mainRow.replaceChildren(...opaqueUploadChoices(pending.hasBase).map((c) => choiceEls[c]));
      split.sub.textContent = pending.hasBase ? `${AI_SPLIT_DETAIL}${AI_SPLIT_REPLACES_NOTE}` : AI_SPLIT_DETAIL;
      setHidden(minorRow, !pending.hasBase);
    }
    const busy = ai?.busy === true;
    const canCut = ai?.matteReady === true && !busy;
    const canSplit = ai?.depthReady === true && !busy;
    cutout.el.disabled = !canCut;
    split.el.disabled = !canSplit;
    // 主要按鈕：能去背就是〔自動去背〕，不然是〔取代底圖〕／〔當底圖〕
    toggleClass(cutout.el, 'primary', canCut);
    toggleClass(replace.el, 'primary', !canCut);
    toggleClass(asBase.el, 'primary', !canCut);
    // 有模型還沒下載：那一顆變淡、說怎麼下載；另一件 AI 工作還在做（去背、拆層共用）：兩顆都變淡、說做完再試
    const missing = ai?.matteReady === false || ai?.depthReady === false;
    const note = missing ? AI_MODEL_MISSING_NOTE : busy && (ai?.matteReady || ai?.depthReady) ? AI_WORKING_NOTE : '';
    setText(aiNote, note);
    setHidden(aiNote, note === '');
    for (const b of [cutout.el, split.el]) {
      if (note) b.setAttribute('aria-describedby', 'confirm-ai-note');
      else b.removeAttribute('aria-describedby');
    }
    // 按鈕的狀態都排好了，焦點才移進來（第一個能按的）
    confirmFocus.shown();
  };

  const renderAsk = (q: AiAsk | null) => {
    setHidden(askBox, q === null);
    if (!q) {
      askKind = null;
      askFocus.hidden();
      return;
    }
    if (askKind !== q.kind) {
      askKind = q.kind;
      swapIcon(askIcon, q.kind === 'slow' ? 'info' : 'alert', 22);
      setText(askTitle, ASK_TEXT[q.kind]);
      setText(askYesLabel, q.kind === 'slow' ? AI_CONTINUE_LABEL : AS_BASE_LABEL);
    }
    setText(askFile, S.preview.fileName(q.fileName));
    askFocus.shown();
  };

  const renderProgress = (p: AiProgressView | null) => {
    setHidden(aiPanel, p === null);
    if (!p) {
      aiBarMode = '';
      return;
    }
    setText(aiTitle, p.step === 'load' ? AI_LOADING_TEXT : p.step === 'split' ? AI_SPLITTING_TEXT : AI_CUTTING_TEXT);
    if (p.fraction !== null) {
      const f = Math.min(1, Math.max(0, p.fraction));
      if (aiBarMode !== 'exact') {
        aiBarMode = 'exact';
        aiFill.style.transition = '';
      }
      aiFill.style.width = `${(f * 100).toFixed(1)}%`;
      setText(aiPercent, progressPercent(f));
      setHidden(aiPercent, false);
      aiBar.setAttribute('aria-valuenow', String(Math.floor(f * 100)));
      return;
    }
    setHidden(aiPercent, true);
    aiBar.removeAttribute('aria-valuenow');
    const mode = `creep:${p.expectSec}`;
    if (aiBarMode === mode) return;
    aiBarMode = mode;
    // 從頭開始，照預估時間慢慢走到 92%（越後面越慢）；做完面板就收起
    aiFill.style.transition = 'none';
    aiFill.style.width = '0%';
    void aiFill.offsetWidth; // 先讓 0% 生效，下面的寬度才會有動畫
    aiFill.style.transition = `width ${p.expectSec}s cubic-bezier(0.15, 0.6, 0.35, 1)`;
    aiFill.style.width = '92%';
  };

  // ---- 提示列／訊息 ----
  const hintText = h('span');
  const hintIcon = h('span', { className: 'hint-icon' }, [icon('rotate', 18)]);
  const close = button('btn-icon msg-close', [icon('close', 18)], S.common.closeMessage);
  close.setAttribute('aria-label', S.common.closeMessage);
  close.addEventListener('click', () => intents.dismissMessage());
  const pill = h('div', { className: 'hint-pill', attrs: { role: 'status', 'aria-live': 'polite' } }, [hintIcon, hintText, close]);

  // 〔展示〕：和右欄「展示擺動」是同一個設定（開＝亮起來）
  const showcaseBtn = button('btn showcase-btn', [icon('showcase', 18), h('span', { text: S.preview.showcase })], S.preview.showcaseTip);
  showcaseBtn.setAttribute('aria-pressed', 'false');
  let showcaseOn = false;
  showcaseBtn.addEventListener('click', () => intents.editCard({ view: { showcase: !showcaseOn } }, 'commit'));
  // 〔展示〕旁邊的〔−〕{縮放比例}〔＋〕與〔全螢幕〕（T-835，view-tools.ts）：全螢幕鋪滿的是整個預覽區（這個 section，下方工具列也在裡面）
  const tools = createViewTools(
    {
      zoomTo: (zoom) => intents.zoomTo?.(zoom),
      fullscreenTarget: () => el,
    },
    fullscreen,
  );
  const bar = h('div', { className: 'stage-bar' }, [showcaseBtn, tools.el, pill]);

  const footer = h('div', { className: 'stage-footer' }, [confirm, askBox, aiPanel, bar]);
  const el = h('section', { className: 'stage', attrs: { 'aria-label': S.preview.areaLabel } }, [backdrop, view, emptyFrame, footer]);

  let shownMessage: UiMessage | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pillMode = '';

  /** 有變才設、空字串＝拿掉（CSS 變數）。 */
  const setVar = (target: HTMLElement, name: string, value: string) => {
    if (target.style.getPropertyValue(name) === value) return;
    if (value) target.style.setProperty(name, value);
    else target.style.removeProperty(name);
  };

  const setPill = (mode: 'hint' | 'empty' | 'info' | 'error', text: string) => {
    if (mode !== pillMode) {
      pillMode = mode;
      pill.dataset.mode = mode;
      swapIcon(hintIcon, mode === 'error' ? 'alert' : mode === 'info' ? 'info' : mode === 'empty' ? 'upload' : 'rotate', 18);
    }
    setText(hintText, text);
    setHidden(close, mode !== 'info' && mode !== 'error');
  };

  return {
    el,
    previewHost,
    overlayHost,
    render(state) {
      const empty = state.card[state.face].layers.length === 0;
      toggleClass(el, 'is-empty', empty);

      // 換卡、換底圖、隱藏底圖、換舞台背景圖（T-814）、展示廳的大廳（T-816）：背景跟著換（新圖載好才淡入）
      const shown = stageBackdropView(state.card);
      const hall = shown !== null && 'hall' in shown;
      // 工作桌的木桌（T-832）：圖在 CSS 那層（.is-desk），img 不放圖
      const desk = shown !== null && 'desk' in shown;
      const url = shown === null || 'desk' in shown ? undefined : 'hall' in shown ? state.galleryHallUrl : state.imageUrl(shown.hash);
      if (url !== backdropUrl) {
        backdropUrl = url;
        toggleClass(backdropImg, 'is-ready', false);
        // 沒有圖就拿掉 src（設成空字串會去抓頁面本身）
        if (url) backdropImg.setAttribute('src', url);
        else backdropImg.removeAttribute('src');
      }
      toggleClass(backdrop, 'has-image', url !== undefined);
      // 展示廳的大廳（T-816）：style.css 的 T-816 段（不模糊、略壓暗＋暗角，展示廳的深藍底不蓋掉它）
      toggleClass(backdrop, 'is-hall', hall && url !== undefined);
      toggleClass(backdrop, 'is-desk', desk);
      // 舞台背景圖（T-814）：不模糊、不放大、亮度約 85%＋淡暗角；舞台元素 has-backdrop＝展示廳／魔法陣／星雲的底色不蓋掉它
      const custom = shown !== null && 'hash' in shown && shown.custom && url !== undefined;
      toggleClass(backdrop, 'is-custom', custom);
      toggleClass(el, 'has-backdrop', custom);
      // 遠景的位置與大小（T-822）：只套在背景圖上（底圖模糊版照舊）；style.css 的 T-822 段用這兩個變數
      const css = custom ? farPanCss(farPanOf(state.card)) : null;
      for (const [name, value] of [
        ['--far-pos', css?.position ?? ''],
        ['--far-zoom', css?.scale ?? ''],
      ] as const) {
        if (backdrop.style.getPropertyValue(name) === value) continue;
        if (value) backdrop.style.setProperty(name, value);
        else backdrop.style.removeProperty(name);
      }
      // 前景圖（T-830）：換圖、拿掉；位置、大小、模糊照 foregroundCss（預覽區的 cqw／cqh）
      const fg = foregroundOf(state.card);
      const fgUrl = fg ? state.imageUrl(fg.image) : undefined;
      if (fgUrl !== foregroundUrl) {
        foregroundUrl = fgUrl;
        // 沒有圖就拿掉 src（設成空字串會去抓頁面本身）
        if (fgUrl) foregroundImg.setAttribute('src', fgUrl);
        else foregroundImg.removeAttribute('src');
      }
      toggleClass(foreground, 'has-image', fgUrl !== undefined);
      const fgCss = fg && fgUrl !== undefined ? foregroundCss(fg) : null;
      setVar(foreground, '--fg-left', fgCss?.left ?? '');
      setVar(foreground, '--fg-top', fgCss?.top ?? '');
      setVar(foreground, '--fg-size', fgCss?.size ?? '');
      setVar(foreground, '--fg-blur', fgCss?.blur ?? '');
      // 展示廳（T-410）、魔法陣／水鏡／星雲（T-415）：預覽區換成那個場景的底色、底圖模糊版淡掉
      const scene = state.card.view.stage;
      toggleClass(el, 'is-gallery', scene === 'gallery');
      toggleClass(el, 'is-magic', scene === 'magic');
      toggleClass(el, 'is-water', scene === 'water');
      toggleClass(el, 'is-nebula', scene === 'nebula');
      toggleClass(el, 'is-desk', scene === 'desk');
      // 水鏡的霧（T-825）：天空跟著霧色與濃淡（style.css 的 T-825 段用這兩個變數）；沒有霧、不是水鏡＝拿掉（和以前一樣）
      const look = scene === 'water' ? waterLookOf(state.card) : null;
      const misty = look !== null && look.mist > 0;
      toggleClass(el, 'has-water-mist', misty);
      for (const [name, value] of [
        ['--water-mist-color', misty ? look.mistColor : ''],
        ['--water-mist', misty ? String(look.mist / 100) : ''],
      ] as const) {
        if (el.style.getPropertyValue(name) === value) continue;
        if (value) el.style.setProperty(name, value);
        else el.style.removeProperty(name);
      }

      showcaseOn = state.card.view.showcase;
      toggleClass(showcaseBtn, 'is-on', showcaseOn);
      if (showcaseBtn.getAttribute('aria-pressed') !== String(showcaseOn)) showcaseBtn.setAttribute('aria-pressed', String(showcaseOn));

      // 卡片故事先藏起來（T-813）：不排字
      if (STORY_ENABLED) story.render(state);
      renderUpload(state.pendingReplaceBase, state.ai);
      renderAsk(state.ai?.ask ?? null);
      renderProgress(state.ai?.progress ?? null);

      const m = state.message;
      if (m !== shownMessage) {
        shownMessage = m;
        clearTimeout(timer);
        if (m) {
          timer = setTimeout(() => {
            if (shownMessage === m) intents.dismissMessage();
          }, m.kind === 'error' ? ERROR_MS : INFO_MS);
        }
      }
      if (m) setPill(m.kind, m.text);
      else if (empty) setPill('empty', S.preview.emptyPill);
      else setPill('hint', S.preview.hintPill);
    },
    showDrop(face, kind = 'images') {
      toggleClass(el, 'is-drop', face !== null);
      if (!face) return;
      setText(dropText, kind === 'card-file' ? S.preview.dropCardFile : face === 'front' ? S.preview.dropFront : S.preview.dropBack);
    },
    showPoster(url, cardH) {
      clearTimeout(posterTimer);
      posterDone?.();
      posterDone = null;
      // 縮圖的高度＝預設縮放下 3D 卡片的高度＋空邊（T-807：照卡高算，橫式卡比較矮）
      poster.style.setProperty('--poster-h', `${posterHeight(cardH).toFixed(2)}cqh`);
      poster.src = url;
      toggleClass(poster, 'is-fading', false);
      poster.hidden = false;
    },
    placeStory(card) {
      story.place(card);
    },
    driftForeground(x, y) {
      const unit = (v: number) => (Number.isFinite(v) && v !== 0 ? `${Math.round(v * 1e3) / 1e3}cqw` : '');
      setVar(foreground, '--fg-dx', unit(x));
      setVar(foreground, '--fg-dy', unit(y));
    },
    setZoom: (zoom) => tools.setZoom(zoom),
    exitFullscreen: () => tools.exitFullscreen(),
    hidePoster(done) {
      if (poster.hidden) {
        done();
        return;
      }
      posterDone = done;
      toggleClass(poster, 'is-fading', true);
      // 淡出（CSS 0.45 秒）完才拿掉，收回 object URL
      posterTimer = setTimeout(() => {
        poster.hidden = true;
        poster.removeAttribute('src');
        posterDone?.();
        posterDone = null;
      }, POSTER_FADE_MS);
    },
  };
}
