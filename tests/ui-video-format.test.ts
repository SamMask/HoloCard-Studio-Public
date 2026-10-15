import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMp4Recorder } from '../src/file/mp4';
import type { Mp4Info } from '../src/file/types';
import { createUi } from '../src/ui/app';
import { createExportPanel } from '../src/ui/export-panel';
import {
  MP4_AUDIO_UNSUPPORTED_TEXT,
  MP4_OPUS_NOTE_TEXT,
  MP4_UNSUPPORTED_NOTE_TEXT,
  MP4_UNSUPPORTED_TEXT,
  MUSIC_UNSUPPORTED_TEXT,
  TURNTABLE_DONE_TEXT,
  turntableErrorText,
  turntableMenu,
  VIDEO_FAILED_TEXT,
  VIDEO_FORMATS,
  VIDEO_UNSUPPORTED_TEXT,
  videoDoneNote,
  videoFormatOption,
} from '../src/ui/logic';
import type { TurntableOutcome, UiIntents, VideoExportOptions } from '../src/ui/types';
import { createVideoOptions } from '../src/ui/video-options';
import { all, buttonWithText, byClass, FakeEvent, flush, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

// T-514：MP4 接到匯出選單——影片選項小框的「格式」〔MP4（推薦，手機也能播）〕〔WebM〕、不能做 MP4 時自動 WebM、
// 「好了！」下面的 Opus 提醒、〔匯出 ▾〕的影片那一項、MP4 錯誤的白話（DESIGN §7.1）。

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  installFakeDom();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/0');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 選項小框平常由匯出面板打開（取消 hidden）；單獨測時自己打開。 */
function shown<T extends { el: HTMLElement }>(box: T): T {
  box.el.hidden = false;
  return box;
}

const readMusic: UiIntents['readMusic'] = async () => ({ ok: true, durationSec: 30 });
const formatButtons = (root: unknown) => all(root, 'vo-fmt');
const selectedFormat = (root: unknown) => formatButtons(root).filter((b) => b.classList.contains('is-selected')).map((b) => b.textContent);

// ---------------------------------------------------------------------------------------------

describe('文字（DESIGN §7.1 照抄）', () => {
  it('〔匯出 ▾〕的影片那一項：「轉動影片」〔4～12 秒，可以配音樂，MP4 手機也能播〕；拿掉「iPhone 可能播不了」', () => {
    expect(turntableMenu('webm')).toEqual({ title: '轉動影片', detail: '4～12 秒，可以配音樂，MP4 手機也能播' });
    expect(turntableMenu('webm').detail).not.toContain('iPhone');
  });

  it('格式按鈕：MP4 在前（推薦）、WebM 在後', () => {
    expect(VIDEO_FORMATS).toEqual(['mp4', 'webm']);
    expect(videoFormatOption('mp4')).toEqual({ label: 'MP4', detail: '（推薦，手機也能播）' });
    expect(videoFormatOption('webm')).toEqual({ label: 'WebM', detail: '' });
  });

  it('不能做 MP4 的小字、Opus 提醒', () => {
    expect(MP4_UNSUPPORTED_NOTE_TEXT).toBe('這個瀏覽器不能做 MP4，請用 WebM');
    expect(MP4_OPUS_NOTE_TEXT).toBe('這支影片的聲音格式 iPhone 可能播不出來，要給 iPhone 看可以改用不配樂或換 Chrome');
  });

  it('「好了！」下面的小字：只有 MP4 的聲音是 Opus 時才有', () => {
    expect(videoDoneNote({ videoCodec: 'avc1.640028', audioCodec: 'opus' })).toBe(MP4_OPUS_NOTE_TEXT);
    expect(videoDoneNote({ videoCodec: 'avc1.640028', audioCodec: 'aac' })).toBeNull();
    expect(videoDoneNote({ videoCodec: 'avc1.42E028', audioCodec: null })).toBeNull();
    // WebM 沒有 onInfo
    expect(videoDoneNote(null)).toBeNull();
  });
});

describe('MP4 錯誤轉白話（各一句；英文只寫 console）', () => {
  it('瀏覽器不能做 MP4（Mp4UnsupportedError，用錄影模組丟的真錯誤）→ 請改用 WebM（不是叫人改用 GIF）', async () => {
    const err = await createMp4Recorder({})({ width: 16, height: 16, fps: 20 }, async () => {}).catch((e: unknown) => e);
    expect((err as Error).name).toBe('Mp4UnsupportedError');
    expect(turntableErrorText('webm', err)).toBe(MP4_UNSUPPORTED_TEXT);
    expect(MP4_UNSUPPORTED_TEXT).toBe('這個瀏覽器不能做 MP4，請改用 WebM。');
    expect(MP4_UNSUPPORTED_TEXT).not.toBe(VIDEO_UNSUPPORTED_TEXT);
  });

  it('MP4 加不了聲音（Mp4AudioUnsupportedError）→ 先匯出沒有音樂的影片', () => {
    const err = Object.assign(new Error('MP4 AAC and Opus audio encoding is not supported'), { name: 'Mp4AudioUnsupportedError' });
    expect(turntableErrorText('webm', err)).toBe(MP4_AUDIO_UNSUPPORTED_TEXT);
    expect(MP4_AUDIO_UNSUPPORTED_TEXT).toBe('這個瀏覽器不能幫 MP4 影片加音樂，可以先匯出沒有音樂的影片。');
    expect(MP4_AUDIO_UNSUPPORTED_TEXT).not.toBe(MUSIC_UNSUPPORTED_TEXT);
  });

  it('WebM 原本的白話不變；名字對但做的是 GIF 時照 GIF 的說', () => {
    expect(turntableErrorText('webm', new Error('WebM VP9 and VP8 encoding is not supported'))).toBe(VIDEO_UNSUPPORTED_TEXT);
    expect(turntableErrorText('webm', new Error('WebM Opus audio encoding is not supported'))).toBe(MUSIC_UNSUPPORTED_TEXT);
    expect(turntableErrorText('webm', new Error('MP4 video output is missing or reordered'))).toBe(VIDEO_FAILED_TEXT);
    const named = Object.assign(new Error('x'), { name: 'Mp4UnsupportedError' });
    expect(turntableErrorText('gif', named)).not.toBe(MP4_UNSUPPORTED_TEXT);
  });

  it('畫面上的字沒有技術名詞', () => {
    for (const t of [MP4_UNSUPPORTED_TEXT, MP4_AUDIO_UNSUPPORTED_TEXT, MP4_UNSUPPORTED_NOTE_TEXT, MP4_OPUS_NOTE_TEXT, turntableMenu('webm').detail]) {
      expect(t).not.toMatch(/WebCodecs|編碼|H\.?264|AAC|Opus|encoder|codec/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('影片選項小框：格式', () => {
  it('第一次選 MP4；格式按鈕的字照 DESIGN；開始匯出帶 format: mp4', async () => {
    const box = shown(createVideoOptions({ readMusic, canMakeMp4: async () => true }));
    const asked = box.ask();
    await flush();
    expect(formatButtons(box.el).map((b) => b.textContent)).toEqual(['MP4（推薦，手機也能播）', 'WebM']);
    expect(selectedFormat(box.el)).toEqual(['MP4（推薦，手機也能播）']);
    expect(formatButtons(box.el).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(isShown(byClass(box.el, 'vo-fmt-note'))).toBe(false);
    byClass(box.el, 'vo-go').click();
    expect(await asked).toEqual({ format: 'mp4', laps: 1, music: null, motion: 'turn', swingDeg: 30, nodDeg: 10 });
  });

  it('選 WebM → 帶 format: webm；同一次開著工坊記住上次的（再打開還是 WebM）', async () => {
    const box = shown(createVideoOptions({ readMusic, canMakeMp4: async () => true }));
    let asked = box.ask();
    await flush();
    buttonWithText(box.el, 'WebM').click();
    expect(selectedFormat(box.el)).toEqual(['WebM']);
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.format).toBe('webm');
    asked = box.ask();
    await flush();
    expect(selectedFormat(box.el)).toEqual(['WebM']);
    // 取消也記得（和長度一樣：記的是按鈕的狀態）
    buttonWithText(box.el, 'MP4').click();
    box.cancel();
    await asked;
    asked = box.ask();
    await flush();
    expect(selectedFormat(box.el)[0]).toContain('MP4');
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.format).toBe('mp4');
  });

  it('方向鍵在兩個格式之間移動', async () => {
    const box = shown(createVideoOptions({ readMusic, canMakeMp4: async () => true }));
    const asked = box.ask();
    await flush();
    const group = byClass(box.el, 'vo-formats');
    const e = new FakeEvent('keydown', { key: 'ArrowRight' });
    formatButtons(box.el)[0]!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(selectedFormat(box.el)).toEqual(['WebM']);
    formatButtons(box.el)[1]!.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowLeft' }));
    expect(selectedFormat(box.el)[0]).toContain('MP4');
    box.cancel();
    await asked;
  });

  it('不能做 MP4：MP4 變淡（不能按）、小字說明、自動選 WebM；開始匯出帶 webm', async () => {
    const box = shown(createVideoOptions({ readMusic, canMakeMp4: async () => false }));
    const asked = box.ask();
    await flush();
    const [mp4, webm] = formatButtons(box.el) as [FakeElement, FakeElement];
    expect(mp4.disabled).toBe(true);
    expect(mp4.classList.contains('is-selected')).toBe(false);
    expect(webm.classList.contains('is-selected')).toBe(true);
    const note = byClass(box.el, 'vo-fmt-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(MP4_UNSUPPORTED_NOTE_TEXT);
    // 按也沒用
    mp4.click();
    expect(webm.classList.contains('is-selected')).toBe(true);
    // 方向鍵也不會停在不能用的 MP4
    webm.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowLeft' }));
    expect(webm.classList.contains('is-selected')).toBe(true);
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.format).toBe('webm');
  });

  it('打開小框時才問、每次打開都問；檢查還沒回來時照上次的（MP4），回來說不能就換 WebM', async () => {
    const checks: ReturnType<typeof deferred<boolean>>[] = [];
    const box = shown(createVideoOptions({
      readMusic,
      canMakeMp4: () => {
        const d = deferred<boolean>();
        checks.push(d);
        return d.promise;
      },
    }));
    expect(checks).toHaveLength(0);
    let asked = box.ask();
    expect(checks).toHaveLength(1);
    expect(selectedFormat(box.el)[0]).toContain('MP4');
    checks[0]!.resolve(false);
    await flush();
    expect(selectedFormat(box.el)).toEqual(['WebM']);
    box.cancel();
    await asked;

    // 關掉之後才回來的結果不管；下一次打開重新問
    asked = box.ask();
    expect(checks).toHaveLength(2);
    box.cancel();
    await asked;
    checks[1]!.resolve(true);
    await flush();
    asked = box.ask();
    expect(checks).toHaveLength(3);
    checks[2]!.resolve(true);
    await flush();
    // 這次能做：回到使用者記住的 MP4（剛才是被自動換成 WebM，不是使用者選的）
    expect(selectedFormat(box.el)[0]).toContain('MP4');
    expect(isShown(byClass(box.el, 'vo-fmt-note'))).toBe(false);
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.format).toBe('mp4');
  });

  it('檢查本身失敗：當作不能做 MP4（英文只寫 console）', async () => {
    const box = shown(createVideoOptions({ readMusic, canMakeMp4: () => Promise.reject(new Error('probe failed')) }));
    const asked = box.ask();
    await flush();
    expect(selectedFormat(box.el)).toEqual(['WebM']);
    expect(isShown(byClass(box.el, 'vo-fmt-note'))).toBe(true);
    box.cancel();
    expect(await asked).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

type Intents = Pick<UiIntents, 'exportVideo' | 'exportGif' | 'estimateGif' | 'readMusic' | 'canMakeMp4'>;

function panelWith(exportVideo: Intents['exportVideo']) {
  const intents: Intents = {
    exportVideo,
    exportGif: () => Promise.resolve('cancelled'),
    estimateGif: async () => null,
    readMusic,
    canMakeMp4: async () => true,
  };
  const anchor = document.createElement('div') as unknown as HTMLElement;
  const panel = createExportPanel(intents, { changed: () => {}, anchor: () => anchor });
  return { panel, el: panel.el as unknown as FakeElement };
}

/** 假的匯出：先回報（MP4 才有）再照 outcome 結束。 */
function fakeVideo(info: Mp4Info | null, outcome: TurntableOutcome = 'done') {
  const calls: VideoExportOptions[] = [];
  const exportVideo: Intents['exportVideo'] = async (options, _p, _signal, onInfo) => {
    calls.push(options);
    if (info) onInfo?.(info);
    return outcome;
  };
  return { exportVideo, calls };
}

describe('匯出面板：「好了！」下面的 Opus 提醒', () => {
  it('MP4 的聲音是 Opus：「好了！」下面多一行小字，多留一會兒＋〔知道了〕可以先關', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const video = fakeVideo({ videoCodec: 'avc1.640028', audioCodec: 'opus' });
    const t = panelWith(video.exportVideo);
    const run = t.panel.run('webm');
    await flush();
    byClass(t.el, 'vo-go').click();
    await flush();
    expect(video.calls[0]?.format).toBe('mp4');
    expect(byClass(t.el, 'export-title').textContent).toBe(TURNTABLE_DONE_TEXT);
    const note = byClass(t.el, 'export-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(MP4_OPUS_NOTE_TEXT);
    // 平常 1.1 秒就關；有提醒時要留到看得完
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.panel.isOpen()).toBe(true);
    const ok = byClass(t.el, 'export-cancel');
    expect(isShown(ok)).toBe(true);
    expect(ok.textContent).toBe('知道了');
    ok.click();
    await flush();
    expect(t.panel.isOpen()).toBe(false);
    await run;
  });

  it('Opus 提醒在 7,999 ms 還開著，8,000 ms 自動關閉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = panelWith(fakeVideo({ videoCodec: 'avc1.640028', audioCodec: 'opus' }).exportVideo);
    const run = t.panel.run('webm');
    await flush();
    byClass(t.el, 'vo-go').click();
    await flush();
    expect(byClass(t.el, 'export-title').textContent).toBe(TURNTABLE_DONE_TEXT);
    expect(isShown(byClass(t.el, 'export-note'))).toBe(true);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(t.panel.isOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.panel.isOpen()).toBe(false);
    await run;
  });

  it('Opus 提醒期間送出 keydown Escape：經畫面鍵盤處理直接關閉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // 假 DOM 的 window 只有 fire；這裡用原生 EventTarget 真正 dispatchEvent，
    // document 補上事件入口，讓 createUi（含頁首與鍵盤處理）完整組裝。
    const win = Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 1280 });
    vi.stubGlobal('window', win);
    const docEvents = new EventTarget();
    Object.assign(document, {
      addEventListener: docEvents.addEventListener.bind(docEvents),
      removeEventListener: docEvents.removeEventListener.bind(docEvents),
    });
    const video = fakeVideo({ videoCodec: 'avc1.640028', audioCodec: 'opus' });
    const noop = () => {};
    const intents: UiIntents = {
      newCard: noop, newDisc: noop, undo: noop, redo: noop, selectFace: noop, selectLayer: noop,
      uploadFiles: noop, answerReplaceBase: noop, answerOpaqueLayer: noop,
      answerAutoCutout: noop, answerSplitLayers: noop, autoCutoutLayer: noop, answerAiAsk: noop, cancelAi: noop,
      deleteLayer: noop, swapLayers: noop, editLayer: noop, centerLayer: noop,
      fillLayer: noop, editCard: noop, applyStyle: noop, selectFoil: noop, editFoil: noop,
      uploadFoilMask: noop, uploadLayerAlt: noop, uploadBackdrop: noop, removeBackdrop: noop, uploadForeground: noop, removeForeground: noop, dismissMessage: noop, addText: noop, editText: noop,
      listCards: async () => [], openCard: noop, newFromSample: noop,
      samplePreview: async () => null, importCardFile: noop,
      exportCardFile: async () => {}, exportPng: async () => {},
      exportTurntable: async () => 'cancelled', readMusic,
      exportVideo: video.exportVideo, canMakeMp4: async () => true,
      estimateGif: async () => null, exportGif: async () => 'cancelled',
      loadLibrary: async () => { throw new Error('這個測試不開卡片庫'); },
      renameCard: async () => false, duplicateCard: async () => null,
      exportCardFileById: async () => {}, deleteCard: async () => false,
      continueHere: noop, getAutoQuality: () => true, setAutoQuality: noop,
    };
    const root = document.createElement('div');
    createUi(root, intents);
    buttonWithText(byClass(root, 'dropdown'), '匯出').click();
    buttonWithText(byClass(root, 'export-menu'), '轉動影片').click();
    await flush();
    byClass(root, 'vo-go').click();
    await flush();
    const overlay = byClass(root, 'export-overlay');
    expect(isShown(overlay)).toBe(true);
    expect(byClass(root, 'export-title').textContent).toBe(TURNTABLE_DONE_TEXT);
    expect(isShown(byClass(root, 'export-note'))).toBe(true);
    // Node 沒有 KeyboardEvent；原生 Event 帶 key，走真正的 window 事件派送。
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    await flush();
    expect(isShown(overlay)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('聲音是 AAC、沒有配樂、或做的是 WebM：沒有小字，1.1 秒就關；上一次的提醒不會留著', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const infos: (Mp4Info | null)[] = [
      { videoCodec: 'avc1.640028', audioCodec: 'opus' },
      { videoCodec: 'avc1.640028', audioCodec: 'aac' },
      { videoCodec: 'avc1.640028', audioCodec: null },
      null,
    ];
    let i = 0;
    const t = panelWith(async (_o, _p, _s, onInfo) => {
      const info = infos[i++];
      if (info) onInfo?.(info);
      return 'done';
    });
    for (let k = 0; k < infos.length; k++) {
      const run = t.panel.run('webm');
      await flush();
      byClass(t.el, 'vo-go').click();
      await flush();
      const note = byClass(t.el, 'export-note');
      if (k === 0) {
        expect(isShown(note)).toBe(true);
        t.panel.cancel();
      } else {
        expect(isShown(note)).toBe(false);
        expect(isShown(byClass(t.el, 'export-cancel'))).toBe(false);
        await vi.advanceTimersByTimeAsync(1100);
      }
      await run;
      expect(t.panel.isOpen()).toBe(false);
    }
  });

  it('取消或失敗：不顯示提醒（錄到一半已經回報了 Opus 也一樣）', async () => {
    const t = panelWith(fakeVideo({ videoCodec: 'avc1.640028', audioCodec: 'opus' }, 'failed').exportVideo);
    const run = t.panel.run('webm');
    await flush();
    byClass(t.el, 'vo-go').click();
    await run;
    expect(t.panel.isOpen()).toBe(false);
    expect(isShown(byClass(t.el, 'export-note'))).toBe(false);
  });

  it('匯出面板打開影片小框時問一次能不能做 MP4', async () => {
    let asked = 0;
    const intents: Intents = {
      exportVideo: fakeVideo(null).exportVideo,
      exportGif: () => Promise.resolve('cancelled'),
      estimateGif: async () => null,
      readMusic,
      canMakeMp4: async () => {
        asked++;
        return false;
      },
    };
    const panel = createExportPanel(intents, { changed: () => {}, anchor: () => document.createElement('div') as unknown as HTMLElement });
    const run = panel.run('webm');
    await flush();
    expect(asked).toBe(1);
    expect(selectedFormat(panel.el)).toEqual(['WebM']);
    panel.cancel();
    await run;
  });
});
