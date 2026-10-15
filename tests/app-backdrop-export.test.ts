import { describe, expect, it, vi } from 'vitest';
import { createTurntableExporter, type TurntableExportDeps } from '../src/app/turntable-export';
import type { RecordWebm, WebmOptions } from '../src/file/types';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import type { BackdropImage, TurntableOptions } from '../src/render/card-view';
import type { GifExportOptions, VideoExportOptions } from '../src/ui/types';

// T-814 舞台背景圖：匯出選單的「畫上背景」照到影片、GIF（與 GIF 的預估）的擷取：
// captureTurntable 的 backdrop＝這張卡的背景圖（「畫上背景」沒有勾掉、卡片有背景圖才給；省略＝畫）；
// 背景圖從組裝端（圖片登記簿）拿；匯出期間保留的圖含背景圖。

const T0 = '2026-10-15T00:00:00.000Z';
const BACKDROP_HASH = '00000000000000b7';

function fakeScene() {
  const calls: TurntableOptions[] = [];
  return {
    calls,
    async captureTurntable(options: TurntableOptions, onFrame: (rgba: Uint8ClampedArray, index: number) => void | Promise<void>) {
      calls.push(options);
      const width = options.width;
      const height = Math.round(width * 1.4);
      for (let i = 0; i < options.frames; i++) await onFrame(new Uint8ClampedArray(width * height * 4), i);
      return { width, height };
    },
  };
}

const recordWebm: RecordWebm = async (_options: WebmOptions, produce) => {
  await produce(async () => {});
  return new Blob([new Uint8Array(1)], { type: 'video/webm' });
};

const IMAGE: BackdropImage = { image: {} as HTMLImageElement, width: 1600, height: 900 };

function setup(card: Card, stageBackdropImage?: TurntableExportDeps['stageBackdropImage']) {
  const scene = fakeScene();
  const asked: string[] = [];
  const held: string[][] = [];
  const download = vi.fn();
  const deps: TurntableExportDeps = {
    stageBackdropImage,
    card: () => card,
    scene: () => scene,
    refresh: () => {},
    holdImages: (hashes) => {
      held.push([...hashes]);
      return () => {};
    },
    holdThumbnails: () => () => {},
    showError: () => {},
    download,
    encodeGif: async () => new Blob([new Uint8Array(1)], { type: 'image/gif' }),
    recordWebm,
    prepareMusic: () => Promise.reject(new Error('沒有音樂')),
    canRecordVideo: () => true,
    canAddMusic: () => true,
    backdropImage: (hash) => {
      asked.push(hash);
      return hash === BACKDROP_HASH ? IMAGE : null;
    },
  };
  return { exporter: createTurntableExporter(deps), scene, asked, held, download };
}

const signal = () => new AbortController().signal;
const plainCard = (): Card => newCard('standard', 'c1', T0);
const backdropCard = (): Card => setBackdrop(plainCard(), BACKDROP_HASH);
const GIF: GifExportOptions = { size: 'small', motion: 'turn', swingDeg: 30 };
const VIDEO: VideoExportOptions = { format: 'webm', laps: 1, music: null, motion: 'turn', swingDeg: 30 };

describe('匯出組裝：畫上背景（T-814）', () => {
  it('GIF：沒寫＝畫（給背景圖）；勾掉＝不畫；勾著＝畫', async () => {
    for (const [include, want] of [[undefined, IMAGE], [false, null], [true, IMAGE]] as const) {
      const t = setup(backdropCard());
      const options = include === undefined ? GIF : { ...GIF, includeBackdrop: include };
      expect(await t.exporter.exportGif(options, () => {}, signal())).toBe('done');
      expect(t.scene.calls.length).toBeGreaterThan(0);
      for (const c of t.scene.calls) expect(c.backdrop ?? null, String(include)).toBe(want);
    }
  });

  it('卡片沒有背景圖：勾著也不畫（不跟組裝端要圖）', async () => {
    const t = setup(plainCard());
    expect(await t.exporter.exportGif({ ...GIF, includeBackdrop: true }, () => {}, signal())).toBe('done');
    for (const c of t.scene.calls) expect(c.backdrop ?? null).toBeNull();
    expect(t.asked).toEqual([]);
  });

  it('影片：每一圈都照同一個選擇', async () => {
    const on = setup(backdropCard());
    expect(await on.exporter.exportVideo({ ...VIDEO, laps: 2 }, () => {}, signal())).toBe('done');
    expect(on.scene.calls).toHaveLength(2);
    for (const c of on.scene.calls) expect(c.backdrop).toBe(IMAGE);
    const off = setup(backdropCard());
    expect(await off.exporter.exportVideo({ ...VIDEO, laps: 2, includeBackdrop: false }, () => {}, signal())).toBe('done');
    for (const c of off.scene.calls) expect(c.backdrop ?? null).toBeNull();
  });

  it('GIF 選項小框的預估照同一個選擇（勾著時畫格有背景、檔案比較大，預估要照實際的拍）', async () => {
    const on = setup(backdropCard());
    await on.exporter.estimateGif({ motion: 'turn', swingDeg: 30, includeBackdrop: true }, signal());
    expect(on.scene.calls.length).toBeGreaterThan(0);
    for (const c of on.scene.calls) expect(c.backdrop).toBe(IMAGE);
    const off = setup(backdropCard());
    await off.exporter.estimateGif({ motion: 'turn', swingDeg: 30, includeBackdrop: false }, signal());
    for (const c of off.scene.calls) expect(c.backdrop ?? null).toBeNull();
  });

  it('匯出期間保留的圖含背景圖（換卡也不收掉）；組裝端拿不到圖＝不畫', async () => {
    const t = setup(backdropCard());
    await t.exporter.exportGif(GIF, () => {}, signal());
    expect(t.held.at(-1)).toContain(BACKDROP_HASH);
    const missing = setup(setBackdrop(plainCard(), '00000000000000c1'));
    expect(await missing.exporter.exportGif(GIF, () => {}, signal())).toBe('done');
    for (const c of missing.scene.calls) expect(c.backdrop ?? null).toBeNull();
  });
});

describe('T-842 影片、GIF 與預估的舞台遠景', () => {
  it('勾選才讀遠景，沿用 farPan；每一圈與 GIF 預估用同一張圖', async () => {
    const card = updateCard(plainCard(), { view: { stage: 'water', waterScene: 'ink', farPan: { x: 0.3, y: -0.2, zoom: 2 } } });
    for (const kind of ['gif', 'video', 'estimate'] as const) {
      const load = vi.fn<NonNullable<TurntableExportDeps['stageBackdropImage']>>(async () => IMAGE);
      const t = setup(card, load);
      if (kind === 'gif') await t.exporter.exportGif({ ...GIF, includeStageFar: true }, () => {}, signal());
      if (kind === 'video') await t.exporter.exportVideo({ ...VIDEO, laps: 2, includeStageFar: true }, () => {}, signal());
      if (kind === 'estimate') await t.exporter.estimateGif({ ...GIF, includeStageFar: true }, signal());
      expect(load).toHaveBeenCalledTimes(1);
      expect(load.mock.calls[0]![0]).toEqual(card);
      expect(t.scene.calls.length).toBeGreaterThan(0);
      for (const c of t.scene.calls) expect(c.backdrop).toEqual({ ...IMAGE, pan: card.view.farPan });
    }
  });

  it('未勾選或省略不讀遠景，擷取選項與舊的背景圖行為完全相同', async () => {
    for (const card of [plainCard(), backdropCard()]) {
      const load = vi.fn(async () => IMAGE);
      const t = setup(card, load);
      await t.exporter.exportGif(GIF, () => {}, signal());
      const baseline = t.scene.calls.at(-1)!;
      await t.exporter.exportGif({ ...GIF, includeStageFar: false }, () => {}, signal());
      const off = t.scene.calls.at(-1)!;
      const { offsetsAt: baseOffsets, ...base } = baseline;
      const { offsetsAt: offOffsets, ...actual } = off;
      expect(actual).toEqual(base);
      expect(offOffsets!(12, 5)).toEqual(baseOffsets!(12, 5));
      expect(load).not.toHaveBeenCalled();
    }
  });

  it('自訂背景圖優先，不能用舞台遠景繞過「畫上背景」；沒有遠景的舞台不讀圖', async () => {
    for (const stage of ['halo', 'magic', 'none'] as const) {
      const load = vi.fn(async () => IMAGE);
      const t = setup(updateCard(plainCard(), { view: { stage } }), load);
      await t.exporter.exportGif({ ...GIF, includeStageFar: true }, () => {}, signal());
      expect(load).not.toHaveBeenCalled();
      expect(t.scene.calls[0]!.backdrop).toBeNull();
    }
    const load = vi.fn(async () => IMAGE);
    const t = setup(backdropCard(), load);
    await t.exporter.exportGif({ ...GIF, includeBackdrop: false, includeStageFar: true }, () => {}, signal());
    expect(load).not.toHaveBeenCalled();
    expect(t.scene.calls[0]!.backdrop).toBeNull();
  });

  it('讀圖期間取消：不擷取、不下載，放開匯出鎖與圖片保留', async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => { controller.abort(); return IMAGE; });
    const t = setup(plainCard(), load);
    expect(await t.exporter.exportGif({ ...GIF, includeStageFar: true }, () => {}, controller.signal)).toBe('cancelled');
    expect(t.scene.calls).toHaveLength(0);
    expect(t.download).not.toHaveBeenCalled();
    expect(t.exporter.frozenCard()).toBeNull();
  });

  it('遠景讀取失敗：匯出失敗、不下載，預估回 null；不靜默輸出錯誤背景', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const t = setup(plainCard(), async () => { throw new Error('missing stage image'); });
      expect(await t.exporter.exportGif({ ...GIF, includeStageFar: true }, () => {}, signal())).toBe('failed');
      expect(t.exporter.frozenCard()).toBeNull();
      expect(await t.exporter.estimateGif({ ...GIF, includeStageFar: true }, signal())).toBeNull();
      expect(t.scene.calls).toHaveLength(0);
      expect(t.download).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

// T-822 遠景的位置與大小：影片、GIF、GIF 的預估都照這張卡的 view.farPan 裁（背景圖帶著 pan，render 的 paintCover 照它）；
// 沒有調過（省略）＝和 T-814 一樣（同一個物件，置中裁）。
describe('匯出組裝：畫上背景照遠景位置（T-822）', () => {
  const PAN = { x: -0.6, y: 0.25, zoom: 1.8 };
  const pannedCard = (): Card => updateCard(backdropCard(), { view: { farPan: PAN } });

  it('GIF、影片、GIF 預估：背景圖帶著這張卡的位置（圖本身同一張）', async () => {
    const gif = setup(pannedCard());
    expect(await gif.exporter.exportGif(GIF, () => {}, signal())).toBe('done');
    const video = setup(pannedCard());
    expect(await video.exporter.exportVideo({ ...VIDEO, laps: 2 }, () => {}, signal())).toBe('done');
    const estimate = setup(pannedCard());
    await estimate.exporter.estimateGif({ motion: 'turn', swingDeg: 30, includeBackdrop: true }, signal());
    for (const t of [gif, video, estimate]) {
      expect(t.scene.calls.length).toBeGreaterThan(0);
      for (const c of t.scene.calls) {
        expect(c.backdrop?.image).toBe(IMAGE.image);
        expect([c.backdrop?.width, c.backdrop?.height]).toEqual([IMAGE.width, IMAGE.height]);
        expect(c.backdrop?.pan).toEqual(PAN);
      }
    }
  });

  it('沒有調過位置：和以前一樣（同一個物件、沒有 pan）；勾掉「畫上背景」照樣不畫', async () => {
    const t = setup(backdropCard());
    await t.exporter.exportGif(GIF, () => {}, signal());
    for (const c of t.scene.calls) expect(c.backdrop).toBe(IMAGE);
    const off = setup(pannedCard());
    await off.exporter.exportGif({ ...GIF, includeBackdrop: false }, () => {}, signal());
    for (const c of off.scene.calls) expect(c.backdrop ?? null).toBeNull();
  });
});
