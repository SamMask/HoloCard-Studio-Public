// 轉動影片的選項（T-509b，DESIGN 7.1〔匯出 ▾〕）：按〔轉動影片〕後先出現這個小框，選好再開始匯出。
//   和匯出中的小框同一個位置（預覽區下方提示列的位置，不蓋卡片），由 export-panel.ts 開關；Esc／〔取消〕＝不匯出。
//   長度：〔4 秒〕〔8 秒〕〔12 秒〕（小字「轉 1／2／3 圈」）；同一次開著工坊時記住上次選的長度（音樂不記住）。
//   音樂：〔選音樂…〕→ 檔名＋長度＋〔移除〕；選了才出現「從第幾秒開始」（滑桿＋數字，0～音樂長度 − 影片長度）、
//   「影片會用 0:42～0:46 這一段」、〔試聽〕（從起始秒播影片那麼長，再按一次停）。沒選＝沒有聲音（和以前一樣）。
//   小字：音樂只用在這支影片，不會存進卡片，也不會上傳。
// 動作（T-512）：〔轉一圈〕〔左右擺動〕＋擺動角度（motion-picker.ts，和 GIF 的選項小框共用同一個選擇）；
//   擺動時長度按鈕的小字改成「擺 1／2／3 次」。動作下面一列「上下」（T-812，0～25 度、預設 10）：兩種動作都有，一起帶進匯出選項。
// 格式（T-514）：最上面一列〔MP4（推薦，手機也能播）〕〔WebM〕，同一次開著工坊記住上次的、第一次選 MP4。
//   打開小框時問組裝端能不能做 MP4（intents.canMakeMp4）：不能 → MP4 變淡（不能按）、小字「這個瀏覽器不能做 MP4，請用 WebM」、
//   自動選 WebM（使用者記住的選擇不改，下次能做時回到它）；還沒問到之前照記住的。
// 連舞台一起錄（T-850）：〔開始匯出〕上面一列勾選（stage-record.ts，和 GIF 的選項小框共用同一個選擇）；勾著而且舞台開著才帶 withStage: true，
//   不勾時送出的選項和以前一樣（沒有這個欄位）。stageOn＝打開時問這張卡的舞台是不是開著（關＝變淡）。
// ui 只吐意圖（readMusic）；試聽用 <audio> 播本機的檔（object URL），不對外請求。檔名一律 textContent。

import { S } from '../i18n';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { icon, swapIcon } from './icons';
import {
  clampMusicStart,
  formatClock,
  maxMusicStart,
  MP4_UNSUPPORTED_NOTE_TEXT,
  MUSIC_NOTE_TEXT,
  MUSIC_UNREADABLE_TEXT,
  musicFileProblem,
  musicRangeText,
  plainKey,
  shortFileName,
  VIDEO_FORMATS,
  videoFormatOption,
  VIDEO_LAPS,
  videoLengthOption,
  videoSeconds,
} from './logic';
import { createMotionPicker, defaultMotion } from './motion-picker';
import { createStageRecordToggle, defaultStageRecord, type StageRecordChoice } from './stage-record';
import type { MotionChoice, UiIntents, VideoExportOptions, VideoFormat, VideoLaps } from './types';

export interface VideoOptions {
  /** 小框本身（放在匯出的透明遮罩裡）。 */
  readonly el: HTMLElement;
  /** 打開：按〔開始匯出〕→ 選好的選項；〔取消〕／Esc → null。 */
  ask(): Promise<VideoExportOptions | null>;
  /** Esc：等同〔取消〕。 */
  cancel(): void;
}

interface Music {
  file: File;
  durationSec: number;
  /** 試聽用的 object URL（關掉、移除、換一首時收回）。 */
  url: string;
}

const READING = S.common.loading;
/** 檔名最多顯示幾個字（太長的中間省略，滑鼠移上去看全名）。 */
const NAME_MAX = 22;

/**
 * motion＝動作的選擇、stage＝連舞台一起錄（T-850）的選擇（都和 GIF 的選項小框共用同一個物件；沒給就自己一份）；
 * stageOn＝這張卡的舞台開著嗎（打開小框時問；沒給＝開著）。
 */
export function createVideoOptions(
  intents: Pick<UiIntents, 'readMusic' | 'canMakeMp4'>,
  motion: MotionChoice = defaultMotion(),
  stage: StageRecordChoice = defaultStageRecord(),
  stageOn: () => boolean = () => true,
): VideoOptions {
  /** 上次選的格式：同一次開著工坊時沿用，第一次 MP4（T-514）。 */
  let format: VideoFormat = 'mp4';
  /** 這個瀏覽器能不能做 MP4：最近一次問到的結果；還沒問到＝null（照記住的格式）。 */
  let mp4Ok: boolean | null = null;
  /** 每次打開加一：關掉後才回來的檢查結果不用。 */
  let checkToken = 0;
  /** 上次選的長度：同一次開著工坊時沿用。 */
  let laps: VideoLaps = 1;
  let music: Music | null = null;
  /** 正在讀的音樂檔名（還沒讀好）。 */
  let reading: string | null = null;
  /** 換一首、移除、關掉後，還沒讀完的那次結果就作廢。 */
  let readToken = 0;
  let startSec = 0;
  let resolveAsk: ((result: VideoExportOptions | null) => void) | null = null;

  /** 這次實際要做的格式：不能做 MP4 時自動 WebM。 */
  const chosenFormat = (): VideoFormat => (mp4Ok === false ? 'webm' : format);

  // ---- 格式：分段按鈕（單選，T-514） ----
  const formatButtons = VIDEO_FORMATS.map((f) => {
    const { label, detail } = videoFormatOption(f);
    const parts = detail ? [h('span', { text: label }), h('small', { className: 'vo-fmt-detail', text: detail })] : [h('span', { text: label })];
    const b = button('seg-btn vo-fmt', parts);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => pickFormat(f));
    return { format: f, el: b };
  });
  const formatGroup = h(
    'div',
    { className: 'segmented vo-formats', attrs: { role: 'radiogroup', 'aria-labelledby': 'vo-format-label' } },
    formatButtons.map((b) => b.el),
  );
  const formatNote = h('span', { className: 'vo-fmt-note', text: MP4_UNSUPPORTED_NOTE_TEXT });
  formatNote.hidden = true;

  // ---- 長度：分段按鈕（單選） ----
  const lengthButtons = VIDEO_LAPS.map((n) => {
    const { label, detail } = videoLengthOption(n, motion.motion);
    const detailEl = h('small', { className: 'vo-len-detail', text: detail });
    const b = button('seg-btn vo-len', [h('span', { text: label }), detailEl]);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => pickLaps(n));
    return { laps: n, el: b, detail: detailEl };
  });

  // ---- 動作：〔轉一圈〕〔左右擺動〕＋擺動角度（換動作時長度按鈕的小字跟著換） ----
  const motionPicker = createMotionPicker(motion, () => render(), 'vo');
  const lengthGroup = h(
    'div',
    { className: 'segmented vo-lengths', attrs: { role: 'radiogroup', 'aria-labelledby': 'vo-length-label' } },
    lengthButtons.map((b) => b.el),
  );

  // ---- 音樂：〔選音樂…〕／檔名＋長度＋〔移除〕 ----
  const fileInput = h('input', {
    className: 'visually-hidden vo-file',
    attrs: { type: 'file', accept: 'audio/*', tabindex: '-1', 'aria-hidden': 'true' },
  });
  const pickBtn = button('btn btn-sm vo-pick', [icon('music', 18), S.export.pickMusic], S.export.pickMusicTip);
  pickBtn.addEventListener('click', () => fileInput.click());
  const musicName = h('span', { className: 'vo-music-name' });
  const musicLength = h('span', { className: 'vo-music-length' });
  const removeBtn = button('btn btn-sm vo-remove', [S.export.removeMusic], S.export.removeMusicTip);
  const musicChip = h('div', { className: 'vo-music' }, [icon('music', 16), musicName, musicLength]);
  removeBtn.addEventListener('click', () => {
    clearMusic();
    render();
    pickBtn.focus();
  });

  // ---- 從第幾秒開始（選了音樂才出現）＋〔試聽〕 ----
  const startRange = h('input', {
    className: 'slider vo-range-input',
    attrs: { type: 'range', min: '0', max: '0', step: '1', 'aria-label': S.export.musicStartLabel },
  });
  const startNumber = h('input', {
    className: 'vo-num',
    attrs: { type: 'number', min: '0', max: '0', step: '1', inputmode: 'numeric', 'aria-label': S.export.musicStartUnitLabel },
  });
  const rangeText = h('span', { className: 'vo-range-text' });
  const previewLabel = h('span', { text: S.export.preview });
  const previewBtn = button('btn btn-sm vo-preview', [icon('play', 16), previewLabel], S.export.previewTip);
  const startRow = h('div', { className: 'vo-row vo-start' }, [
    h('span', { className: 'vo-label', text: S.export.musicFrom }),
    startRange,
    startNumber,
    h('span', { className: 'vo-unit', text: S.export.musicFromUnit }),
    rangeText,
    previewBtn,
  ]);
  const error = h('p', { className: 'vo-error', attrs: { role: 'alert' } });
  // 連舞台一起錄（T-850）
  const stageToggle = createStageRecordToggle(stage);

  // ---- 〔取消〕〔開始匯出〕 ----
  const cancelBtn = button('btn vo-cancel', [S.common.cancel], S.export.noExport);
  const startBtn = button('btn primary vo-go', [icon('download', 18), S.export.start]);
  cancelBtn.addEventListener('click', () => finish(null));
  startBtn.addEventListener('click', () => {
    if (reading !== null) return;
    finish({
      format: chosenFormat(),
      laps,
      music: music ? { file: music.file, startSec } : null,
      motion: motion.motion,
      swingDeg: motion.swingDeg,
      nodDeg: motion.nodDeg,
      ...(stageToggle.active() ? { withStage: true } : {}),
    });
  });

  const el = h(
    'div',
    { className: 'export-box video-options', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': S.export.videoOptions } },
    [
      h('div', { className: 'export-icon vo-icon', attrs: { 'aria-hidden': 'true' } }, [icon('video', 26)]),
      h('div', { className: 'vo-main' }, [
        h('div', { className: 'vo-row vo-format' }, [
          h('span', { className: 'vo-label', text: S.export.format, attrs: { id: 'vo-format-label' } }),
          formatGroup,
          formatNote,
        ]),
        motionPicker.el,
        h('div', { className: 'vo-row vo-top' }, [
          h('span', { className: 'vo-label', text: S.export.length, attrs: { id: 'vo-length-label' } }),
          lengthGroup,
          h('span', { className: 'vo-label vo-music-label', text: S.export.music }),
          musicChip,
          removeBtn,
          pickBtn,
          fileInput,
        ]),
        startRow,
        stageToggle.el,
        error,
        h('div', { className: 'vo-row vo-foot' }, [h('p', { className: 'vo-note', text: MUSIC_NOTE_TEXT }), cancelBtn, startBtn]),
      ]),
    ],
  );
  el.hidden = true;

  // ---- 試聽：<audio> 從起始秒播影片那麼長；再按一次、換設定、關掉就停 ----
  const audio = new Audio();
  audio.preload = 'auto';
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  /** 每次開始／停止加一，還在等的那次試聽就作廢。 */
  let previewToken = 0;
  let playing = false;
  /** 正在等 <audio> 讀到長度：停止、換音樂、關掉時叫它，拿掉監聽器、結束等待（審查低④）。 */
  let cancelWait: (() => void) | null = null;
  const setPlaying = (on: boolean) => {
    playing = on;
    toggleClass(previewBtn, 'is-on', on);
    previewBtn.setAttribute('aria-pressed', String(on));
    swapIcon(previewBtn, on ? 'stop' : 'play', 16);
    setText(previewLabel, on ? S.export.stop : S.export.preview);
  };
  const stopPreview = () => {
    previewToken++;
    clearTimeout(previewTimer);
    cancelWait?.();
    if (!audio.paused) audio.pause();
    if (playing) setPlaying(false);
  };
  /** 等 <audio> 知道長度才能跳到起始秒；停止試聽（cancelWait）就拿掉監聽器、以「已停止」結束。 */
  const whenReady = () =>
    audio.readyState >= HTMLMediaElement.HAVE_METADATA
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const done = () => {
            audio.removeEventListener('loadedmetadata', ok);
            audio.removeEventListener('error', bad);
            cancelWait = null;
          };
          const ok = () => {
            done();
            resolve();
          };
          const bad = () => {
            done();
            reject(audio.error ?? new Error('audio preview failed'));
          };
          cancelWait = () => {
            done();
            reject(new DOMException('preview stopped', 'AbortError'));
          };
          audio.addEventListener('loadedmetadata', ok);
          audio.addEventListener('error', bad);
        });
  const startPreview = async () => {
    stopPreview();
    if (!music) return;
    const token = previewToken;
    setPlaying(true);
    try {
      await whenReady();
      if (token !== previewToken) return;
      audio.currentTime = startSec;
      await audio.play();
    } catch (err) {
      // 停止了（等待被結束）：不是錯誤
      if (token !== previewToken) return;
      // 試聽不了不影響匯出（匯出用的是另一條路）；英文原文只寫 console
      console.error(err);
      stopPreview();
      return;
    }
    if (token !== previewToken) {
      audio.pause();
      return;
    }
    previewTimer = setTimeout(stopPreview, videoSeconds(laps) * 1000);
  };
  audio.addEventListener('ended', stopPreview);
  previewBtn.addEventListener('click', () => (playing ? stopPreview() : void startPreview()));

  // ---- 狀態 ----
  const clearMusic = () => {
    readToken++;
    reading = null;
    stopPreview();
    if (music) {
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(music.url);
    }
    music = null;
    startSec = 0;
  };

  const showError = (text: string | null) => {
    setText(error, text ?? '');
    setHidden(error, text === null);
  };

  /** 起始秒數改了：滑桿、數字、說明一起更新（數字框正在打字時不蓋掉）。 */
  const paintStart = (fromNumber = false) => {
    if (!music) return;
    const max = maxMusicStart(music.durationSec, videoSeconds(laps));
    for (const input of [startRange, startNumber]) input.max = String(max);
    startRange.value = String(startSec);
    startRange.disabled = max === 0;
    startRange.style.setProperty('--fill', `${max > 0 ? (startSec / max) * 100 : 0}%`);
    if (!fromNumber) startNumber.value = String(startSec);
    startNumber.disabled = max === 0;
    setText(rangeText, musicRangeText(startSec, videoSeconds(laps), music.durationSec));
  };

  const render = () => {
    const chosen = chosenFormat();
    for (const b of formatButtons) {
      const on = b.format === chosen;
      const off = b.format === 'mp4' && mp4Ok === false;
      toggleClass(b.el, 'is-selected', on);
      b.el.setAttribute('aria-checked', String(on));
      b.el.disabled = off;
      b.el.tabIndex = on ? 0 : -1;
    }
    setHidden(formatNote, mp4Ok !== false);
    for (const b of lengthButtons) {
      const on = b.laps === laps;
      toggleClass(b.el, 'is-selected', on);
      b.el.setAttribute('aria-checked', String(on));
      b.el.tabIndex = on ? 0 : -1;
      setText(b.detail, videoLengthOption(b.laps, motion.motion).detail);
    }
    const hasChip = music !== null || reading !== null;
    // 選了（或正在讀）：檔名＋長度＋〔移除〕；沒選：〔選音樂…〕
    setHidden(musicChip, !hasChip);
    setHidden(removeBtn, !hasChip);
    setHidden(pickBtn, hasChip);
    toggleClass(musicChip, 'is-reading', reading !== null);
    const name = music?.file.name ?? reading ?? '';
    setText(musicName, shortFileName(name, NAME_MAX));
    musicChip.title = name;
    setText(musicLength, music ? formatClock(music.durationSec) : reading !== null ? READING : '');
    setHidden(startRow, music === null);
    paintStart();
    startBtn.disabled = reading !== null;
  };

  const pickFormat = (f: VideoFormat) => {
    // 不能做 MP4 時按不了（按鈕已經 disabled，這裡保險）
    if (f === 'mp4' && mp4Ok === false) return;
    format = f;
    render();
  };
  // 方向鍵在格式之間移動（跳過不能用的）
  formatGroup.addEventListener('keydown', (e) => {
    // Ctrl+→ 之類的組合鍵、輸入法選字中不換（T-703b 補上 T-607c 的 plainKey）
    if (!plainKey(e)) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    let i = VIDEO_FORMATS.indexOf(chosenFormat()) + step;
    while (i >= 0 && i < VIDEO_FORMATS.length && formatButtons[i]!.el.disabled) i += step;
    const next = VIDEO_FORMATS[i];
    if (next === undefined) return;
    pickFormat(next);
    formatButtons[i]!.el.focus();
  });

  /** 打開時問能不能做 MP4（組裝端只真的問一次）；問壞了＝不能。關掉或再打開之後才回來的結果不用。 */
  const checkMp4 = () => {
    const token = ++checkToken;
    if (!intents.canMakeMp4) return;
    void intents
      .canMakeMp4()
      .catch((err: unknown) => {
        console.error(err);
        return false;
      })
      .then((ok) => {
        if (token !== checkToken || !resolveAsk) return;
        mp4Ok = ok;
        render();
      });
  };

  const pickLaps = (n: VideoLaps) => {
    if (n === laps) return;
    laps = n;
    // 影片變長，起點的上限變小：重新夾（影片那一段一定整段有音樂）
    if (music) startSec = clampMusicStart(startSec, music.durationSec, videoSeconds(laps));
    render();
    if (playing) void startPreview();
  };
  // 方向鍵在長度之間移動（單選的慣例）
  lengthGroup.addEventListener('keydown', (e) => {
    if (!plainKey(e)) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = VIDEO_LAPS.indexOf(laps);
    const next = VIDEO_LAPS[Math.min(VIDEO_LAPS.length - 1, Math.max(0, i + step))]!;
    pickLaps(next);
    lengthButtons.find((b) => b.laps === next)?.el.focus();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || !resolveAsk) return;
    clearMusic();
    showError(null);
    const problem = musicFileProblem(file.size);
    if (problem) {
      showError(problem);
      render();
      return;
    }
    const token = readToken;
    reading = file.name;
    render();
    void intents
      .readMusic(file)
      .catch((err: unknown) => {
        console.error(err);
        return { ok: false as const, text: MUSIC_UNREADABLE_TEXT };
      })
      .then((info) => {
        // 讀的途中換了一首、移除了、或面板關了：這次的結果不要了
        if (token !== readToken || !resolveAsk) return;
        reading = null;
        if (info.ok) {
          music = { file, durationSec: info.durationSec, url: URL.createObjectURL(file) };
          audio.src = music.url;
          startSec = 0;
        } else {
          showError(info.text);
        }
        render();
      });
  });

  startRange.addEventListener('input', () => {
    if (!music) return;
    startSec = clampMusicStart(Number(startRange.value), music.durationSec, videoSeconds(laps));
    paintStart();
  });
  // 放開滑桿時，正在試聽就從新的起點重播
  startRange.addEventListener('change', () => {
    if (playing) void startPreview();
  });
  startNumber.addEventListener('input', () => {
    if (!music || startNumber.value === '') return;
    startSec = clampMusicStart(Number(startNumber.value), music.durationSec, videoSeconds(laps));
    paintStart(true);
  });
  startNumber.addEventListener('change', () => {
    paintStart();
    if (playing) void startPreview();
  });

  const finish = (result: VideoExportOptions | null) => {
    const resolve = resolveAsk;
    if (!resolve) return;
    resolveAsk = null;
    clearMusic();
    showError(null);
    resolve(result);
  };

  return {
    el,
    ask() {
      if (resolveAsk) return Promise.resolve(null);
      clearMusic();
      showError(null);
      // 動作、連舞台一起錄可能在 GIF 的選項小框改過；舞台開不開看這張卡
      motionPicker.render();
      stageToggle.render(stageOn());
      render();
      return new Promise<VideoExportOptions | null>((resolve) => {
        resolveAsk = resolve;
        checkMp4();
        // 小框出現後焦點放在〔開始匯出〕：直接按 Enter＝照上次的長度、沒有音樂匯出
        queueMicrotask(() => startBtn.focus());
      });
    },
    cancel: () => finish(null),
  };
}
