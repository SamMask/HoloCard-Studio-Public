import { describe, expect, it } from 'vitest';
import { createTurntableExporter, type TurntableExportDeps } from '../src/app/turntable-export';
import type { RecordWebm, WebmOptions } from '../src/file/types';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import type { TurntableOptions } from '../src/render/card-view';
import type { GifExportOptions, VideoExportOptions } from '../src/ui/types';

// T-806 透明卡套：匯出選單的「包含卡套」照到影片、GIF（與 GIF 的預估）的擷取：
// captureTurntable 的 sleeve＝「包含卡套」沒有勾掉（省略＝跟著卡片的開關）；卡片有沒有開卡套由 render 自己看（卡沒開就不畫）。

const T0 = '2026-10-14T00:00:00.000Z';

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

function setup(card: Card) {
  const scene = fakeScene();
  const deps: TurntableExportDeps = {
    card: () => card,
    scene: () => scene,
    refresh: () => {},
    holdImages: () => () => {},
    holdThumbnails: () => () => {},
    showError: () => {},
    download: () => {},
    encodeGif: async () => new Blob([new Uint8Array(1)], { type: 'image/gif' }),
    recordWebm,
    prepareMusic: () => Promise.reject(new Error('沒有音樂')),
    canRecordVideo: () => true,
    canAddMusic: () => true,
  };
  return { exporter: createTurntableExporter(deps), scene };
}

const signal = () => new AbortController().signal;
const sleeveCard = (): Card => {
  const c = newCard('standard', 'c1', T0);
  return { ...c, view: { ...c.view, sleeve: true } };
};
const GIF: GifExportOptions = { size: 'small', motion: 'turn', swingDeg: 30 };
const VIDEO: VideoExportOptions = { format: 'webm', laps: 1, music: null, motion: 'turn', swingDeg: 30 };

describe('匯出組裝：包含卡套（T-806）', () => {
  it('GIF：沒寫＝畫卡套（跟著開關）；勾掉＝不畫；勾著＝畫', async () => {
    for (const [include, want] of [[undefined, true], [false, false], [true, true]] as const) {
      const t = setup(sleeveCard());
      const options = include === undefined ? GIF : { ...GIF, includeSleeve: include };
      expect(await t.exporter.exportGif(options, () => {}, signal())).toBe('done');
      expect(t.scene.calls.length).toBeGreaterThan(0);
      for (const c of t.scene.calls) expect(c.sleeve, String(include)).toBe(want);
    }
  });

  it('影片：勾掉＝每一圈都不畫；沒寫＝畫', async () => {
    const off = setup(sleeveCard());
    expect(await off.exporter.exportVideo({ ...VIDEO, laps: 2, includeSleeve: false }, () => {}, signal())).toBe('done');
    expect(off.scene.calls).toHaveLength(2);
    for (const c of off.scene.calls) expect(c.sleeve).toBe(false);
    const on = setup(sleeveCard());
    expect(await on.exporter.exportVideo(VIDEO, () => {}, signal())).toBe('done');
    for (const c of on.scene.calls) expect(c.sleeve).toBe(true);
  });

  it('GIF 選項小框的預估照同一個選擇（預估和實際匯出一樣大）', async () => {
    const t = setup(sleeveCard());
    await t.exporter.estimateGif({ motion: 'turn', swingDeg: 30, includeSleeve: false }, signal());
    expect(t.scene.calls.length).toBeGreaterThan(0);
    for (const c of t.scene.calls) expect(c.sleeve).toBe(false);
    const u = setup(sleeveCard());
    await u.exporter.estimateGif({ motion: 'turn', swingDeg: 30 }, signal());
    for (const c of u.scene.calls) expect(c.sleeve).toBe(true);
  });

  it('沒有選項的舊入口（exportTurntable）：跟著開關', async () => {
    const t = setup(sleeveCard());
    expect(await t.exporter.exportTurntable('gif', () => {}, signal())).toBe('done');
    for (const c of t.scene.calls) expect(c.sleeve).toBe(true);
  });
});
