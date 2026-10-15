import { describe, expect, it } from 'vitest';
import { createTurntableExporter, type TurntableExportDeps } from '../src/app/turntable-export';
import type { RecordWebm, WebmOptions } from '../src/file/types';
import { setBackdrop, setForeground, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import type { BackdropImage, TurntableOptions } from '../src/render/card-view';
import type { GifExportOptions, VideoExportOptions } from '../src/ui/types';

// T-830 前景圖：匯出選單的「畫上背景」勾著（或沒寫）、卡片有前景圖、組裝端拿得到圖 → 影片、GIF（與 GIF 的預估）的 captureTurntable
// 帶 foreground（圖＋這張卡的位置、大小、模糊）；勾掉就不帶；圖用同一個 backdropImage（圖片登記簿）拿；匯出期間保留的圖含前景圖。

const T0 = '2026-10-15T00:00:00.000Z';
const FG_HASH = '00000000000000f7';
const BD_HASH = '00000000000000b7';

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

const FG_IMAGE: BackdropImage = { image: { tag: 'fg' } as unknown as HTMLImageElement, width: 800, height: 600 };
const BD_IMAGE: BackdropImage = { image: { tag: 'bd' } as unknown as HTMLImageElement, width: 1600, height: 900 };

function setup(card: Card) {
  const scene = fakeScene();
  const held: string[][] = [];
  const deps: TurntableExportDeps = {
    card: () => card,
    scene: () => scene,
    refresh: () => {},
    holdImages: (hashes) => {
      held.push([...hashes]);
      return () => {};
    },
    holdThumbnails: () => () => {},
    showError: () => {},
    download: () => {},
    encodeGif: async () => new Blob([new Uint8Array(1)], { type: 'image/gif' }),
    recordWebm,
    prepareMusic: () => Promise.reject(new Error('沒有音樂')),
    canRecordVideo: () => true,
    canAddMusic: () => true,
    backdropImage: (hash) => (hash === FG_HASH ? FG_IMAGE : hash === BD_HASH ? BD_IMAGE : null),
  };
  return { exporter: createTurntableExporter(deps), scene, held };
}

const signal = () => new AbortController().signal;
const plainCard = (): Card => newCard('standard', 'c1', T0);
const PLACE = { x: 0.3, y: -0.4, scale: 1.6, blur: 55 };
const fgCard = (): Card => updateCard(setForeground(plainCard(), FG_HASH), { view: { foreground: PLACE } });
const GIF: GifExportOptions = { size: 'small', motion: 'turn', swingDeg: 30 };
const VIDEO: VideoExportOptions = { format: 'webm', laps: 1, music: null, motion: 'turn', swingDeg: 30 };
const WANT = { image: FG_IMAGE.image, width: 800, height: 600, place: PLACE };

describe('匯出組裝：前景圖跟著「畫上背景」（T-830）', () => {
  it('GIF：沒寫＝畫；勾掉＝不畫；勾著＝畫（圖＋位置、大小、模糊）', async () => {
    for (const [include, want] of [[undefined, WANT], [false, null], [true, WANT]] as const) {
      const t = setup(fgCard());
      const options = include === undefined ? GIF : { ...GIF, includeBackdrop: include };
      expect(await t.exporter.exportGif(options, () => {}, signal())).toBe('done');
      expect(t.scene.calls.length).toBeGreaterThan(0);
      for (const c of t.scene.calls) {
        if (want === null) expect(c.foreground ?? null, String(include)).toBeNull();
        else expect(c.foreground, String(include)).toEqual(want);
      }
    }
  });

  it('影片（每一圈）、GIF 預估照同一個選擇；有背景圖時兩個都帶', async () => {
    const video = setup(setBackdrop(fgCard(), BD_HASH));
    expect(await video.exporter.exportVideo({ ...VIDEO, laps: 2 }, () => {}, signal())).toBe('done');
    expect(video.scene.calls).toHaveLength(2);
    for (const c of video.scene.calls) {
      expect(c.foreground).toEqual(WANT);
      expect(c.backdrop).toBe(BD_IMAGE);
    }
    const estimate = setup(fgCard());
    await estimate.exporter.estimateGif({ motion: 'turn', swingDeg: 30, includeBackdrop: true }, signal());
    for (const c of estimate.scene.calls) expect(c.foreground).toEqual(WANT);
    const off = setup(fgCard());
    await off.exporter.estimateGif({ motion: 'turn', swingDeg: 30, includeBackdrop: false }, signal());
    for (const c of off.scene.calls) expect(c.foreground ?? null).toBeNull();
  });

  it('卡片沒有前景圖：不帶；組裝端拿不到圖：不帶；匯出期間保留的圖含前景圖', async () => {
    const none = setup(plainCard());
    await none.exporter.exportGif(GIF, () => {}, signal());
    for (const c of none.scene.calls) expect(c.foreground ?? null).toBeNull();
    const missing = setup(setForeground(plainCard(), '00000000000000c1'));
    expect(await missing.exporter.exportGif(GIF, () => {}, signal())).toBe('done');
    for (const c of missing.scene.calls) expect(c.foreground ?? null).toBeNull();
    const t = setup(fgCard());
    await t.exporter.exportGif(GIF, () => {}, signal());
    expect(t.held.at(-1)).toContain(FG_HASH);
  });
});
