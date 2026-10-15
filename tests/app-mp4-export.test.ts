import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURNTABLE, TURNTABLE_FPS, VIDEO_EXT } from '../src/app/files';
import { canEncodeMp4, createTurntableExporter, type TurntableExportDeps } from '../src/app/turntable-export';
import type { Mp4Info, RecordMp4, RecordWebm, WebmAudio, WebmOptions } from '../src/file/types';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import type { TurntableOptions } from '../src/render/card-view';
import { MP4_AUDIO_UNSUPPORTED_TEXT, MP4_UNSUPPORTED_TEXT } from '../src/ui/logic';
import type { VideoExportOptions } from '../src/ui/types';

// T-514：匯出組裝依格式選錄影器（MP4＝recordMp4、WebM＝recordWebm）、副檔名、配樂／長度／動作照舊、
// onInfo 轉交畫面、MP4 錯誤轉白話、打開小框時的 H.264 檢查（VideoEncoder.isConfigSupported，只問、不載入大東西）。

const T0 = '2026-10-14T00:00:00.000Z';
const card = (): Card => ({ ...newCard('standard', 'c1', T0), name: '月夜/卡' });

/** 假的 3D 擷取：每格不透明、高＝寬 × 1.4；記下每次的選項。 */
function fakeScene() {
  const calls: TurntableOptions[] = [];
  return {
    calls,
    async captureTurntable(options: TurntableOptions, onFrame: (rgba: Uint8ClampedArray, index: number) => void | Promise<void>, signal?: AbortSignal) {
      calls.push(options);
      const width = options.width;
      const height = Math.round(width * 1.4);
      for (let i = 0; i < options.frames; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await onFrame(new Uint8ClampedArray(width * height * 4), i);
      }
      return { width, height };
    },
  };
}

/** 照 RecordWebm／RecordMp4 的樣子：produce 結束＝錄完；記下選項與格數；MP4 在第一格之後回報 info。 */
function fakeRecorder(type: string, info?: Mp4Info, fail?: Error) {
  const calls: { options: WebmOptions; frames: number }[] = [];
  const record = async (
    options: WebmOptions,
    produce: (push: (rgba: Uint8ClampedArray) => Promise<void>) => Promise<void>,
    _signal?: AbortSignal,
    onInfo?: (info: Mp4Info) => void,
  ): Promise<Blob> => {
    const call = { options, frames: 0 };
    calls.push(call);
    if (fail) throw fail;
    await produce(async () => {
      call.frames++;
      if (call.frames === 1 && info) onInfo?.(info);
    });
    return new Blob([new Uint8Array(call.frames)], { type });
  };
  return { record, calls };
}

const AUDIO: WebmAudio = { channels: [new Float32Array(48000 * 8)], sampleRate: 48000 };

function setup(over: Partial<TurntableExportDeps> = {}) {
  const downloads: { name: string; size: number; type: string }[] = [];
  const errors: string[] = [];
  const scene = fakeScene();
  const mp4 = fakeRecorder('video/mp4', { videoCodec: 'avc1.640028', audioCodec: 'aac' });
  const webm = fakeRecorder('video/webm');
  const music: { startSec: number; durationSec: number }[] = [];
  const deps: TurntableExportDeps = {
    card: () => card(),
    scene: () => scene,
    refresh: () => {},
    holdImages: () => () => {},
    holdThumbnails: () => () => {},
    showError: (text) => errors.push(text),
    download: (blob, name) => downloads.push({ name, size: blob.size, type: blob.type }),
    encodeGif: () => Promise.reject(new Error('這個測試不做 GIF')),
    recordWebm: webm.record as RecordWebm,
    recordMp4: mp4.record as RecordMp4,
    prepareMusic: async (_file, options) => {
      music.push({ startSec: options.startSec, durationSec: options.durationSec });
      return AUDIO;
    },
    canRecordVideo: () => true,
    canAddMusic: () => true,
    ...over,
  };
  return { deps, exporter: createTurntableExporter(deps), downloads, errors, scene, mp4, webm, music };
}

const VIDEO: VideoExportOptions = { format: 'mp4', laps: 1, music: null, motion: 'turn', swingDeg: 30 };
const song = () => new File([new Uint8Array(10)], 'song.wav', { type: 'audio/wav' });
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('依格式選錄影器、副檔名', () => {
  it('副檔名常數', () => {
    expect(VIDEO_EXT).toEqual({ mp4: '.mp4', webm: '.webm' });
  });

  it('MP4：用 recordMp4（寬 720、每秒 20 格、沒有配樂）、不用 recordWebm；檔名＝卡名.mp4', async () => {
    const t = setup();
    const outcome = await t.exporter.exportVideo(VIDEO, () => {}, signal());
    expect(outcome).toBe('done');
    expect(t.webm.calls).toHaveLength(0);
    expect(t.mp4.calls).toHaveLength(1);
    expect(t.mp4.calls[0]!.options).toEqual({ width: TURNTABLE.webmWidth, height: Math.round(TURNTABLE.webmWidth * 1.4), fps: TURNTABLE_FPS, audio: undefined });
    expect(t.mp4.calls[0]!.frames).toBe(TURNTABLE.frames);
    expect(t.downloads).toEqual([{ name: '月夜卡.mp4', size: TURNTABLE.frames, type: 'video/mp4' }]);
    expect(t.errors).toEqual([]);
  });

  it('WebM：用 recordWebm、檔名 .webm（照舊）；沒寫格式也是 WebM（T-514 以前的呼叫）', async () => {
    const t = setup();
    expect(await t.exporter.exportVideo({ ...VIDEO, format: 'webm' }, () => {}, signal())).toBe('done');
    const { format: _omit, ...legacy } = VIDEO;
    expect(await t.exporter.exportVideo(legacy, () => {}, signal())).toBe('done');
    expect(await t.exporter.exportTurntable('webm', () => {}, signal())).toBe('done');
    expect(t.mp4.calls).toHaveLength(0);
    expect(t.webm.calls).toHaveLength(3);
    expect(t.downloads.map((d) => d.name)).toEqual(['月夜卡.webm', '月夜卡.webm', '月夜卡.webm']);
  });

  it('MP4 的長度、動作、配樂照舊：8 秒＝160 格、左右擺動、音樂從起始秒取 8 秒交給 recordMp4', async () => {
    const t = setup();
    const outcome = await t.exporter.exportVideo({ ...VIDEO, laps: 2, motion: 'swing', swingDeg: 45, music: { file: song(), startSec: 3 } }, () => {}, signal());
    expect(outcome).toBe('done');
    expect(t.music).toEqual([{ startSec: 3, durationSec: 8 }]);
    expect(t.mp4.calls[0]!.options.audio).toBe(AUDIO);
    expect(t.mp4.calls[0]!.frames).toBe(2 * TURNTABLE.frames);
    expect(t.scene.calls.map((c) => [c.motion, c.swingDeg])).toEqual([
      ['swing', 45],
      ['swing', 45],
    ]);
  });

  it('上下點頭（T-812）：每一圈都帶同一個上下角度（8／12 秒＝2／3 個循環，每圈同樣的姿勢）；沒給＝0', async () => {
    const t = setup();
    expect(await t.exporter.exportVideo({ ...VIDEO, laps: 3, nodDeg: 15 }, () => {}, signal())).toBe('done');
    expect(t.scene.calls.map((c) => [c.nodDeg, c.pitchDeg, c.frames, c.motion])).toEqual([
      [15, TURNTABLE.pitchDeg, TURNTABLE.frames, 'turn'],
      [15, TURNTABLE.pitchDeg, TURNTABLE.frames, 'turn'],
      [15, TURNTABLE.pitchDeg, TURNTABLE.frames, 'turn'],
    ]);
    t.scene.calls.length = 0;
    await t.exporter.exportVideo({ ...VIDEO, laps: 2, motion: 'swing', swingDeg: 45, nodDeg: 25 }, () => {}, signal());
    expect(t.scene.calls.map((c) => [c.motion, c.swingDeg, c.nodDeg])).toEqual([
      ['swing', 45, 25],
      ['swing', 45, 25],
    ]);
    t.scene.calls.length = 0;
    await t.exporter.exportVideo(VIDEO, () => {}, signal());
    expect(t.scene.calls.map((c) => c.nodDeg)).toEqual([0]);
  });

  it('進度照整體格數走到 100%', async () => {
    const t = setup();
    const seen: number[] = [];
    await t.exporter.exportVideo({ ...VIDEO, laps: 2 }, (f) => seen.push(f), signal());
    expect(seen).toHaveLength(2 * TURNTABLE.frames);
    expect(seen.at(-1)).toBe(1);
  });
});

describe('onInfo：MP4 實際用的聲音轉交畫面', () => {
  it('取消之後錄影器才回報 onInfo：不轉交畫面、不下載', async () => {
    let started!: () => void;
    const recording = new Promise<void>((resolve) => { started = resolve; });
    let resume!: () => void;
    const delayedInfo = new Promise<void>((resolve) => { resume = resolve; });
    const reported = vi.fn();
    const recordMp4: RecordMp4 = async (_options, produce, _signal, onInfo) => {
      await produce(async () => {});
      started();
      await delayedInfo;
      const info: Mp4Info = { videoCodec: 'avc1.640028', audioCodec: 'opus' };
      reported(info);
      onInfo?.(info);
      // 模擬錄影器太晚收到取消，仍交出 Blob；組裝端也必須擋下下載。
      return new Blob([new Uint8Array(1)], { type: 'video/mp4' });
    };
    const t = setup({ recordMp4 });
    const controller = new AbortController();
    const onInfo = vi.fn();
    const exporting = t.exporter.exportVideo(VIDEO, () => {}, controller.signal, onInfo);
    await recording;
    expect(reported).not.toHaveBeenCalled();
    controller.abort();
    resume();
    expect(await exporting).toBe('cancelled');
    expect(reported).toHaveBeenCalledExactlyOnceWith({ videoCodec: 'avc1.640028', audioCodec: 'opus' });
    expect(onInfo).not.toHaveBeenCalled();
    expect(t.downloads).toEqual([]);
  });

  it('MP4：錄影模組回報什麼就轉交什麼（第一格之後）', async () => {
    const opus = fakeRecorder('video/mp4', { videoCodec: 'avc1.4D0028', audioCodec: 'opus' });
    const t = setup({ recordMp4: opus.record as RecordMp4 });
    const infos: Mp4Info[] = [];
    await t.exporter.exportVideo({ ...VIDEO, music: { file: song(), startSec: 0 } }, () => {}, signal(), (info) => infos.push(info));
    expect(infos).toEqual([{ videoCodec: 'avc1.4D0028', audioCodec: 'opus' }]);
  });

  it('WebM：不回報', async () => {
    const t = setup();
    const infos: Mp4Info[] = [];
    await t.exporter.exportVideo({ ...VIDEO, format: 'webm' }, () => {}, signal(), (info) => infos.push(info));
    expect(infos).toEqual([]);
  });
});

describe('MP4 失敗：白話、不下載', () => {
  it('不支援 H.264（Mp4UnsupportedError）→「這個瀏覽器不能做 MP4，請改用 WebM。」', async () => {
    const err = Object.assign(new Error('MP4 H.264 encoding is not supported'), { name: 'Mp4UnsupportedError' });
    const t = setup({ recordMp4: fakeRecorder('video/mp4', undefined, err).record as RecordMp4 });
    expect(await t.exporter.exportVideo(VIDEO, () => {}, signal())).toBe('failed');
    expect(t.errors).toEqual([MP4_UNSUPPORTED_TEXT]);
    expect(t.downloads).toEqual([]);
  });

  it('加不了聲音（Mp4AudioUnsupportedError）→ 先匯出沒有音樂的影片', async () => {
    const err = Object.assign(new Error('MP4 AAC and Opus audio encoding is not supported'), { name: 'Mp4AudioUnsupportedError' });
    const t = setup({ recordMp4: fakeRecorder('video/mp4', undefined, err).record as RecordMp4 });
    expect(await t.exporter.exportVideo({ ...VIDEO, music: { file: song(), startSec: 0 } }, () => {}, signal())).toBe('failed');
    expect(t.errors).toEqual([MP4_AUDIO_UNSUPPORTED_TEXT]);
    expect(t.downloads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

type Probe = (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>;
const encoderWith = (probe: Probe) => ({ isConfigSupported: vi.fn(probe) });

describe('能不能做 MP4（打開影片選項小框時問）', () => {
  it('依序問 High／Main／Baseline 的 H.264（寬 720、每秒 20 格、avc 格式）；有一種可以就是可以', async () => {
    const enc = encoderWith(async (config) => ({ supported: config.codec === 'avc1.4D0028', config }));
    expect(await canEncodeMp4(enc)).toBe(true);
    const asked = enc.isConfigSupported.mock.calls.map(([c]) => c);
    expect(asked.map((c) => c.codec)).toEqual(['avc1.640028', 'avc1.4D0028']);
    for (const c of asked) {
      expect(c.width).toBe(TURNTABLE.webmWidth);
      expect(c.framerate).toBe(TURNTABLE_FPS);
      expect(c.avc).toEqual({ format: 'avc' });
    }
  });

  it('都不行、問的時候丟錯、沒有 VideoEncoder：不行', async () => {
    expect(await canEncodeMp4(encoderWith(async (config) => ({ supported: false, config })))).toBe(false);
    expect(await canEncodeMp4(encoderWith(() => Promise.reject(new TypeError('bad config'))))).toBe(false);
    expect(await canEncodeMp4(undefined)).toBe(false);
  });

  it('沒傳就用瀏覽器的 VideoEncoder', async () => {
    vi.stubGlobal('VideoEncoder', encoderWith(async (config) => ({ supported: true, config })));
    expect(await canEncodeMp4()).toBe(true);
    vi.stubGlobal('VideoEncoder', undefined);
    expect(await canEncodeMp4()).toBe(false);
  });

  it('組裝：canMakeMp4 只真的問一次（同一次開著工坊結果不會變）；問壞了＝不行', async () => {
    let probes = 0;
    const t = setup({
      canEncodeMp4: async () => {
        probes++;
        return true;
      },
    });
    expect(await t.exporter.canMakeMp4()).toBe(true);
    expect(await t.exporter.canMakeMp4()).toBe(true);
    expect(probes).toBe(1);
    const broken = setup({ canEncodeMp4: () => Promise.reject(new Error('probe failed')) });
    expect(await broken.exporter.canMakeMp4()).toBe(false);
  });
});
