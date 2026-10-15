// T-850 連舞台一起錄：匯出組裝（app/turntable-export）把勾選變成 captureTurntable 的 stage（橫的 16:9、預覽的預設縮放、
// CSS 那層、前景圖、第幾圈），不勾時傳給 render 的選項和以前完全一樣；CSS 那層畫哪張圖照預覽（app/stage-scenery）。
import { describe, expect, it, vi } from 'vitest';
import { GIF_ESTIMATE, GIF_STAGE_ESTIMATE, STAGE_VIDEO_WIDTH, stageFrameHeight, TURNTABLE } from '../src/app/files';
import { stageSceneryFor } from '../src/app/stage-scenery';
import { createTurntableExporter, recordsStage, type TurntableExportDeps } from '../src/app/turntable-export';
import type { EncodeGif, RecordWebm } from '../src/file/types';
import { turnLimits, ZOOM_DEFAULT } from '../src/interact/view';
import { addLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle } from '../src/model/types';
import type { BackdropImage } from '../src/render/backdrop';
import type { TurntableOptions } from '../src/render/card-view';
import type { GifExportOptions, VideoExportOptions } from '../src/ui/types';

const T0 = '2026-10-15T00:00:00.000Z';
const HASH = (n: number) => n.toString(16).padStart(16, '0');

function card(stage: StageStyle, over: Partial<Card['view']> = {}): Card {
  let c = newCard('standard', 'c1', T0);
  const r = addLayer(c, 'front', { id: 'base', name: '底圖', image: HASH(1), hasAlpha: false, width: 64, height: 96 });
  if (!r.ok) throw new Error(r.reason);
  c = r.card;
  return { ...c, name: '星晶龍', view: { ...c.view, stage, ...over } };
}

const img = (w = 64, h = 48): BackdropImage => ({ image: {} as HTMLCanvasElement, width: w, height: h });

function fakeScene() {
  const calls: TurntableOptions[] = [];
  return {
    calls,
    async captureTurntable(options: TurntableOptions, onFrame: (rgba: Uint8ClampedArray, index: number) => void | Promise<void>) {
      calls.push(options);
      const width = options.width;
      const height = options.stage?.height ?? Math.round(width * 1.4);
      for (let i = 0; i < options.frames; i++) await onFrame(new Uint8ClampedArray(width * height * 4).fill(255), i);
      return { width, height };
    },
  };
}

function harness(c: Card, over: Partial<TurntableExportDeps> = {}) {
  const scene = fakeScene();
  const downloads: string[] = [];
  const errors: string[] = [];
  const encodes: { width: number; height: number }[] = [];
  const encodeGif: EncodeGif = async (frames, options) => {
    encodes.push({ width: options.width, height: options.height });
    return new Blob([new Uint8Array(frames.length * 10)]);
  };
  const recordWebm: RecordWebm = async (options, produce) => {
    await produce(async () => {});
    return new Blob([`${options.width}x${options.height}`]);
  };
  const loaded: string[] = [];
  const deps: TurntableExportDeps = {
    card: () => c,
    scene: () => scene,
    refresh: () => {},
    holdImages: () => () => {},
    holdThumbnails: () => () => {},
    showError: (t) => errors.push(t),
    download: (_b, name) => downloads.push(name),
    encodeGif,
    recordWebm,
    recordMp4: recordWebm,
    prepareMusic: () => Promise.reject(new Error('沒有音樂')),
    canRecordVideo: () => true,
    canAddMusic: () => true,
    backdropImage: (hash) => (hash === HASH(1) || hash === HASH(9) || hash === HASH(7) ? img() : null),
    stageImage: async (path) => {
      loaded.push(path);
      return img(2560, 1440);
    },
    ...over,
  };
  return { exporter: createTurntableExporter(deps), scene, downloads, errors, encodes, loaded };
}

const GIF: GifExportOptions = { size: 'small', motion: 'turn', swingDeg: 30, nodDeg: 10 };
const VIDEO: VideoExportOptions = { format: 'webm', laps: 1, music: null, motion: 'turn', swingDeg: 30, nodDeg: 10 };
const signal = () => new AbortController().signal;

describe('固定設定（T-850，SCHEMA §5）', () => {
  it('影片 1280×720；畫面高＝寬 × 9／16（四捨五入）；GIF 預估試編寬 480 與 720', () => {
    expect(STAGE_VIDEO_WIDTH).toBe(1280);
    expect(stageFrameHeight(1280)).toBe(720);
    expect(stageFrameHeight(480)).toBe(270);
    expect(stageFrameHeight(600)).toBe(338);
    expect(stageFrameHeight(720)).toBe(405);
    expect(GIF_STAGE_ESTIMATE).toEqual({ frames: GIF_ESTIMATE.frames, widths: [480, 720] });
    // 舊入口的 GIF 寬照舊 480（不跟著編碼器的上限變）
    expect(TURNTABLE.gifWidth).toBe(480);
  });

  it('recordsStage：勾了而且舞台不是「關」', () => {
    expect(recordsStage(card('gallery'), { withStage: true })).toBe(true);
    expect(recordsStage(card('none'), { withStage: true })).toBe(false);
    expect(recordsStage(card('gallery'), { withStage: false })).toBe(false);
    expect(recordsStage(card('gallery'), {})).toBe(false);
    expect(recordsStage(card('gallery'), undefined)).toBe(false);
  });
});

describe('不勾：傳給 render 的選項和以前完全一樣（沒有 stage）', () => {
  it('GIF、影片、GIF 預估都沒有 stage 這個欄位、寬度照舊', async () => {
    const h = harness(card('gallery'));
    expect(await h.exporter.exportGif(GIF, () => {}, signal())).toBe('done');
    expect(await h.exporter.exportVideo(VIDEO, () => {}, signal())).toBe('done');
    await h.exporter.estimateGif({ motion: 'turn', swingDeg: 30, nodDeg: 10 }, signal());
    for (const o of h.scene.calls) expect('stage' in o).toBe(false);
    expect(h.scene.calls.map((o) => o.width)).toEqual([320, TURNTABLE.webmWidth, 480, 320]);
    expect(h.loaded).toEqual([]);
  });

  it('勾了但舞台關著：照不勾', async () => {
    const h = harness(card('none'));
    expect(await h.exporter.exportGif({ ...GIF, withStage: true }, () => {}, signal())).toBe('done');
    expect('stage' in h.scene.calls[0]!).toBe(false);
    expect(h.scene.calls[0]!.width).toBe(320);
  });
});

describe('勾了：橫的 16:9、預覽的預設縮放、CSS 那層、前景圖', () => {
  it('GIF 小／中／大＝寬 480／600／720，高照 16:9；不看畫上背景與遠景', async () => {
    for (const [size, w] of [['small', 480], ['medium', 600], ['large', 720]] as const) {
      const h = harness(card('gallery', { backdrop: undefined }));
      const got = await h.exporter.exportGif({ ...GIF, size, withStage: true, includeBackdrop: true, includeStageFar: true }, () => {}, signal());
      expect(got).toBe('done');
      const o = h.scene.calls[0]!;
      expect(o.width).toBe(w);
      expect(o.stage).toMatchObject({ height: stageFrameHeight(w), zoom: ZOOM_DEFAULT, lap: 0 });
      expect(o.stage!.scenery.stage).toBe('gallery');
      expect(o.stage!.scenery.image?.kind).toBe('hall');
      expect(o.backdrop).toBeNull();
      expect(o.foreground).toBeNull();
      expect(h.encodes[0]).toEqual({ width: w, height: stageFrameHeight(w) });
    }
  });

  it('影片 1280×720；轉 3 圈＝lap 0、1、2（舞台的動畫接著走）', async () => {
    const h = harness(card('halo'));
    expect(await h.exporter.exportVideo({ ...VIDEO, laps: 3, withStage: true }, () => {}, signal())).toBe('done');
    expect(h.scene.calls.map((o) => [o.width, o.stage?.height, o.stage?.lap])).toEqual([
      [1280, 720, 0],
      [1280, 720, 1],
      [1280, 720, 2],
    ]);
  });

  it('包含卡套照舊；前景圖不管「畫上背景」的勾選都畫', async () => {
    const fg = { image: HASH(7), x: -0.6, y: -0.5, scale: 1, blur: 10 };
    const h = harness(card('magic', { foreground: fg }));
    await h.exporter.exportGif({ ...GIF, withStage: true, includeSleeve: false, includeBackdrop: false }, () => {}, signal());
    const o = h.scene.calls[0]!;
    expect(o.sleeve).toBe(false);
    expect(o.stage!.foreground).toMatchObject({ width: 64, height: 48, place: { x: -0.6, y: -0.5, scale: 1, blur: 10 } });
  });

  it('工作桌：上下角度夾在預覽工作桌的範圍（turnLimits(true)，±10°）；其他舞台不夾；不勾時沒有 stage（照舊）', async () => {
    const desk = harness(card('desk'));
    await desk.exporter.exportGif({ ...GIF, withStage: true, nodDeg: 25 }, () => {}, signal());
    expect(desk.scene.calls[0]!.stage!.pitchLimit).toBe(turnLimits(true).pitch);
    expect(turnLimits(true).pitch).toBe(10);
    await desk.exporter.estimateGif({ motion: 'turn', swingDeg: 30, nodDeg: 25, withStage: true }, signal());
    expect(desk.scene.calls.slice(1).every((o) => o.stage?.pitchLimit === 10)).toBe(true);
    const gallery = harness(card('gallery'));
    await gallery.exporter.exportGif({ ...GIF, withStage: true }, () => {}, signal());
    expect(gallery.scene.calls[0]!.stage).not.toHaveProperty('pitchLimit');
    const plain = harness(card('desk'));
    await plain.exporter.exportGif({ ...GIF, nodDeg: 25 }, () => {}, signal());
    expect('stage' in plain.scene.calls[0]!).toBe(false);
  });

  it('GIF 預估：試編寬 720 與 480（寬的先），都是 16:9、帶 stage', async () => {
    const h = harness(card('nebula'));
    const got = await h.exporter.estimateGif({ motion: 'turn', swingDeg: 30, nodDeg: 10, withStage: true }, signal());
    expect(h.scene.calls.map((o) => [o.width, o.stage?.height, o.frames])).toEqual([
      [720, 405, GIF_ESTIMATE.frames],
      [480, 270, GIF_ESTIMATE.frames],
    ]);
    expect(got?.map((s) => [s.width, s.height])).toEqual([
      [720, 405],
      [480, 270],
    ]);
  });

  it('舞台的圖讀不到：這次匯出失敗、不下載', async () => {
    const h = harness(card('desk'), { stageImage: () => Promise.reject(new Error('404')) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await h.exporter.exportGif({ ...GIF, withStage: true }, () => {}, signal())).toBe('failed');
    expect(h.downloads).toEqual([]);
    expect(h.errors).toHaveLength(1);
    expect(h.scene.calls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe('CSS 那層畫哪張圖（照預覽：ui/logic 的 stageBackdropView）', () => {
  const deps = () => {
    const loaded: string[] = [];
    return {
      loaded,
      deps: {
        image: (hash: string) => (hash === HASH(1) || hash === HASH(9) ? img() : null),
        stageImage: async (path: string) => {
          loaded.push(path);
          return img(2560, 1440);
        },
      },
    };
  };

  it('自己的背景圖（不是水鏡）：custom、帶 farPan', async () => {
    const d = deps();
    const pan = { x: 0.3, y: 0, zoom: 1.5 };
    const s = await stageSceneryFor(card('gallery', { backdrop: HASH(9), farPan: pan }), d.deps);
    expect(s.stage).toBe('gallery');
    expect(s.image?.kind).toBe('custom');
    expect(s.image?.source.pan).toEqual(pan);
    expect(d.loaded).toEqual([]);
  });

  it('自己的背景圖讀不到：丟錯', async () => {
    await expect(stageSceneryFor(card('magic', { backdrop: HASH(5) }), deps().deps)).rejects.toThrow();
  });

  it('展示廳：大廳圖；工作桌：木桌圖（同源讀）', async () => {
    const d = deps();
    expect((await stageSceneryFor(card('gallery'), d.deps)).image?.kind).toBe('hall');
    expect((await stageSceneryFor(card('desk'), d.deps)).image?.kind).toBe('desk');
    expect(d.loaded).toEqual(['stages/gallery-hall.webp', 'stages/desk.webp']);
  });

  it('全息光環：正面底圖的模糊版；魔法陣：沒有圖', async () => {
    const d = deps();
    expect((await stageSceneryFor(card('halo'), d.deps)).image?.kind).toBe('blur');
    expect((await stageSceneryFor(card('magic'), d.deps)).image).toBeNull();
  });

  it('水鏡、星雲：CSS 那層沒有圖（遠景在 3D）；但遠景、大圖要讀得到（讀不到丟錯）', async () => {
    const d = deps();
    expect((await stageSceneryFor(card('water', { waterScene: 'fuji' }), d.deps)).image).toBeNull();
    expect((await stageSceneryFor(card('nebula'), d.deps)).image).toBeNull();
    expect(d.loaded).toEqual(['stages/water-fuji.webp', 'stages/nebula.webp']);
    await expect(stageSceneryFor(card('nebula'), { ...d.deps, stageImage: () => Promise.reject(new Error('x')) })).rejects.toThrow();
  });

  it('水鏡＋自己的背景圖：CSS 那層沒有圖（背景圖在 3D 的遠景平面）', async () => {
    const d = deps();
    const s = await stageSceneryFor(card('water', { backdrop: HASH(9) }), d.deps);
    expect(s.image).toBeNull();
    expect(d.loaded).toEqual([]);
  });
});
