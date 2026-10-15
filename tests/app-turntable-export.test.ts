import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardImageHashes } from '../src/app/autosave';
import { GIF_ESTIMATE, TURNTABLE } from '../src/app/files';
import { createSession } from '../src/app/session';
import { createTurntableExporter, type TurntableExportDeps, type TurntableExporter } from '../src/app/turntable-export';
import type { EncodeGif, RecordWebm } from '../src/file/types';
import { createImageRegistry } from '../src/images/registry';
import type { StoredImage } from '../src/images/types';
import { addLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import type { TurntableOptions } from '../src/render/card-view';
import { openCardStore } from '../src/storage/store';
import type { CardStore } from '../src/storage/types';
import { createExportPanel } from '../src/ui/export-panel';
import { estimateGifBytes, fileSizeText, GIF_ESTIMATING_TEXT, GIF_FAILED_TEXT, GIF_SIZES } from '../src/ui/logic';
import type { GifExportOptions } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeEvent, flush, installFakeDom } from './ui-fake-dom';

// T-512b（T-512 交叉審查中③）：走真正的匯出組裝（app/turntable-export，main 用的同一個），只換掉擷取、編碼、下載出口。
// 三件事：被別的分頁接手後下載 0 次；匯出中換卡，副本用的圖還在；取消、例外（含畫面更新拋錯）都恰好放開一次。

const T0 = '2026-10-14T00:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

function cardWith(id: string, imageNumbers: number[]): Card {
  let card = newCard('standard', id, T0);
  imageNumbers.forEach((n, i) => {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${i}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  });
  return { ...card, name: `卡 ${id}` };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * 假的 3D 擷取：照 options 的寬度與格數交出不透明畫格（高＝寬 × 1.4）；每格前先等 beforeFrame（測試在這裡換卡、取消）。
 * 和 render 一樣：每格開始前檢查取消（AbortError）。
 */
function fakeScene(beforeFrame: (index: number, options: TurntableOptions) => void | Promise<void> = () => {}) {
  const calls: TurntableOptions[] = [];
  return {
    calls,
    async captureTurntable(options: TurntableOptions, onFrame: (rgba: Uint8ClampedArray, index: number) => void | Promise<void>, signal?: AbortSignal) {
      calls.push(options);
      const width = options.width;
      const height = Math.round(width * 1.4);
      for (let i = 0; i < options.frames; i++) {
        await beforeFrame(i, options);
        if (signal?.aborted) throw abortError();
        await onFrame(new Uint8ClampedArray(width * height * 4).fill(255), i);
      }
      return { width, height };
    },
  };
}

/** 假的 GIF 編碼：大小＝格數 × 寬 × 10 位元組；取消時照真的一樣以 AbortError 停（ignoreAbort＝做完才發現取消的情況）。 */
function fakeEncoder(gate?: Promise<void>, ignoreAbort = false) {
  const calls: { frames: number; width: number }[] = [];
  const encode: EncodeGif = async (frames, options, onProgress, signal) => {
    calls.push({ frames: frames.length, width: options.width });
    if (gate) await gate;
    if (signal?.aborted && !ignoreAbort) throw abortError();
    onProgress?.(frames.length, frames.length);
    return new Blob([new Uint8Array(frames.length * options.width * 10)], { type: 'image/gif' });
  };
  return { encode, calls };
}

const neverRecord: RecordWebm = () => Promise.reject(new Error('這個測試不錄影片'));

interface Harness {
  deps: TurntableExportDeps;
  downloads: { name: string; size: number }[];
  errors: string[];
  releases: { images: number; thumbnails: number };
  holds: { images: number; thumbnails: number };
}

/** 組裝端（main）的接線，只換掉擷取、編碼、下載出口；hold／release 記次數。 */
function harness(card: Card | null, over: Partial<TurntableExportDeps> = {}): Harness {
  const downloads: { name: string; size: number }[] = [];
  const errors: string[] = [];
  const releases = { images: 0, thumbnails: 0 };
  const holds = { images: 0, thumbnails: 0 };
  const deps: TurntableExportDeps = {
    card: () => card,
    scene: () => fakeScene(),
    refresh: () => {},
    holdImages: () => {
      holds.images++;
      return () => releases.images++;
    },
    holdThumbnails: () => {
      holds.thumbnails++;
      return () => releases.thumbnails++;
    },
    showError: (text) => errors.push(text),
    download: (blob, name) => downloads.push({ name, size: blob.size }),
    encodeGif: fakeEncoder().encode,
    recordWebm: neverRecord,
    prepareMusic: () => Promise.reject(new Error('這個測試沒有音樂')),
    canRecordVideo: () => true,
    canAddMusic: () => true,
    ...over,
  };
  return { deps, downloads, errors, releases, holds };
}

const GIF: GifExportOptions = { size: 'small', motion: 'turn', swingDeg: 30 };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('匯出組裝：正常匯出', () => {
  it('GIF：拍一個來回、合成、下載一次（檔名＝卡名）；圖與縮圖各保留、放開一次；匯出中 3D 預覽畫副本', async () => {
    const card = cardWith('a', [1, 2]);
    const shown: (Card | null)[] = [];
    const h = harness(card);
    let exporter!: TurntableExporter;
    exporter = createTurntableExporter({ ...h.deps, refresh: () => shown.push(exporter.frozenCard()) });
    const outcome = await exporter.exportGif(GIF, () => {}, new AbortController().signal);
    expect(outcome).toBe('done');
    expect(h.downloads).toEqual([{ name: '卡 a.gif', size: TURNTABLE.frames * 320 * 10 }]);
    expect(h.holds).toEqual({ images: 1, thumbnails: 1 });
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
    // 開始時換成副本（和編輯中的卡內容一樣、但不是同一個物件），收尾換回
    expect(shown).toHaveLength(2);
    expect(shown[0]).toEqual(card);
    expect(shown[0]).not.toBe(card);
    expect(shown[1]).toBeNull();
    expect(exporter.frozenCard()).toBeNull();
  });
});

describe('被別的分頁接手後不下載（審查中③：走匯出面板＋真正的組裝）', () => {
  async function exportThenTakeOver(when: 'capture' | 'encode', ignoreAbort: boolean) {
    installFakeDom();
    const capturing = deferred<void>();
    const encoding = deferred<void>();
    let exporting = false;
    let reachedCapture = () => {};
    const atCapture = new Promise<void>((resolve) => (reachedCapture = resolve));
    // 只有真正的匯出（80 格）在第 40 格停下來等；估算的 8 格照常拍
    const scene = fakeScene(async (i, options) => {
      if (options.frames !== TURNTABLE.frames || i !== 40) return;
      exporting = true;
      reachedCapture();
      if (when === 'capture') await capturing.promise;
    });
    const encoder = fakeEncoder(undefined, ignoreAbort);
    let reachedEncode = () => {};
    const atEncode = new Promise<void>((resolve) => (reachedEncode = resolve));
    const encodeGif: EncodeGif = async (frames, options, onProgress, signal) => {
      if (frames.length === TURNTABLE.frames) {
        reachedEncode();
        await encoding.promise;
      }
      return encoder.encode(frames, options, onProgress, signal);
    };
    const h = harness(cardWith('a', [1]), { scene: () => scene, encodeGif });
    const exporter = createTurntableExporter(h.deps);
    const panel = createExportPanel({ ...exporter, readMusic: async () => ({ ok: false, text: '' }) }, { changed: () => {}, anchor: () => document.createElement('div') as unknown as HTMLElement });
    const run = panel.run('gif');
    byClass(panel.el, 'go-go').click();
    await atCapture;
    expect(exporting).toBe(true);
    if (when === 'capture') {
      // 拍到一半被接手（遮罩蓋上 → 匯出面板 block）
      panel.block(true);
      capturing.resolve();
    } else {
      // 拍完、合成到最後才被接手
      await atEncode;
      panel.block(true);
    }
    encoding.resolve();
    await run;
    return h;
  }

  it('拍到一半被接手：停掉、下載 0 次；圖與縮圖各放開一次', async () => {
    const h = await exportThenTakeOver('capture', false);
    expect(h.downloads).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
  });

  it('合成到最後才被接手（編碼器沒停、照樣交出檔案）：還是下載 0 次', async () => {
    const h = await exportThenTakeOver('encode', true);
    expect(h.downloads).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
  });
});

describe('匯出中換卡：副本用的圖還在（審查中③：session＋圖片登記簿＋自動存＋真正的組裝）', () => {
  beforeEach(() => {
    let next = 0;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        async decode() {}
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${next++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  async function seed(store: CardStore, card: Card) {
    for (const hash of cardImageHashes(card)) await store.saveImage(image(parseInt(hash, 16)));
    await store.save(card);
  }

  it('拍到一半換卡：之後每一格都拿得到副本的圖；匯出中不拍縮圖；收尾才收掉舊卡的圖、補拍新開的那張', async () => {
    const store = await openCardStore(new IDBFactory());
    const a = cardWith('a', [1, 2]);
    const b = cardWith('b', [3]);
    await seed(store, a);
    await seed(store, b);
    const registry = createImageRegistry();
    let editing: Card | null = null;
    const shotsOf: string[] = [];
    // 3D 預覽畫「副本 ?? 編輯中的卡」，縮圖拍的是 3D 預覽
    let exporter = null as TurntableExporter | null;
    const shownCard = () => exporter?.frozenCard() ?? editing;
    const session = createSession({
      store,
      images: registry,
      current: () => editing,
      show: (card) => {
        editing = card;
      },
      thumbnail: async () => {
        shotsOf.push(shownCard()!.id);
        return new Blob([`thumb-${shownCard()!.id}`], { type: 'image/png' });
      },
      settle: async () => {},
      onStatus: () => {},
      onStorageLow: () => {},
    });
    await session.openStart(a);

    // 每一格都像 render 一樣從登記簿拿副本的圖（setCard(card, getImage)）；第 10 格之前換卡
    const missing: string[] = [];
    const scene = fakeScene(async (i) => {
      if (i === 10) expect(await session.open('b')).toBe('opened');
      for (const hash of cardImageHashes(exporter!.frozenCard()!)) if (!registry.element(hash)) missing.push(`${i}:${hash}`);
    });
    const h = harness(null, {
      card: () => editing,
      scene: () => scene,
      holdImages: (hashes) => registry.hold(hashes),
      holdThumbnails: () => session.saver.holdThumbnails(),
    });
    exporter = createTurntableExporter(h.deps);
    const outcome = await exporter.exportGif(GIF, () => {}, new AbortController().signal);

    expect(outcome).toBe('done');
    expect(editing!.id).toBe('b');
    expect(missing).toEqual([]);
    expect(h.downloads.map((d) => d.name)).toEqual(['卡 a.gif']);
    // 收尾：舊卡的圖收掉、新卡的圖留著；縮圖補拍的是新開的那張（匯出中一張都沒拍）
    expect(registry.has(hashOf(1))).toBe(false);
    expect(registry.has(hashOf(2))).toBe(false);
    expect(registry.has(hashOf(3))).toBe(true);
    await vi.waitFor(() => expect(shotsOf).toEqual(['b']));
  });
});

describe('取消與例外：圖與縮圖都恰好放開一次（審查中①③）', () => {
  it('拍到一半取消：cancelled、不下載、不顯示錯誤', async () => {
    const ctrl = new AbortController();
    const h = harness(cardWith('a', [1]), { scene: () => fakeScene((i) => void (i === 5 && ctrl.abort())) });
    const exporter = createTurntableExporter(h.deps);
    expect(await exporter.exportGif(GIF, () => {}, ctrl.signal)).toBe('cancelled');
    expect(h.downloads).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
    expect(exporter.frozenCard()).toBeNull();
  });

  it('拍的時候出錯：failed、顯示白話、不下載', async () => {
    const h = harness(cardWith('a', [1]), {
      scene: () =>
        fakeScene((i) => {
          if (i === 3) throw new Error('GPU lost');
        }),
    });
    const exporter = createTurntableExporter(h.deps);
    expect(await exporter.exportGif(GIF, () => {}, new AbortController().signal)).toBe('failed');
    expect(h.errors).toEqual([GIF_FAILED_TEXT]);
    expect(h.downloads).toEqual([]);
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
  });

  it('開始時畫面更新拋錯：圖與縮圖還是放開、副本清掉，下一次匯出照常', async () => {
    let fail = true;
    const h = harness(cardWith('a', [1]), {
      refresh: () => {
        if (fail) {
          fail = false;
          throw new Error('render broke');
        }
      },
    });
    const exporter = createTurntableExporter(h.deps);
    await expect(exporter.exportGif(GIF, () => {}, new AbortController().signal)).rejects.toThrow('render broke');
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
    expect(h.downloads).toEqual([]);
    expect(exporter.frozenCard()).toBeNull();
    expect(await exporter.exportGif(GIF, () => {}, new AbortController().signal)).toBe('done');
    expect(h.downloads).toHaveLength(1);
    expect(h.releases).toEqual({ images: 2, thumbnails: 2 });
  });

  it('收尾時畫面更新拋錯：圖與縮圖還是各放開一次、副本清掉', async () => {
    let calls = 0;
    const h = harness(cardWith('a', [1]), {
      refresh: () => {
        if (++calls === 2) throw new Error('render broke');
      },
    });
    const exporter = createTurntableExporter(h.deps);
    await expect(exporter.exportGif(GIF, () => {}, new AbortController().signal)).rejects.toThrow('render broke');
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
    expect(exporter.frozenCard()).toBeNull();
    expect(await exporter.exportGif(GIF, () => {}, new AbortController().signal)).toBe('done');
  });

  it('放開圖時拋錯：縮圖還是放開', async () => {
    const h = harness(cardWith('a', [1]));
    const exporter = createTurntableExporter({
      ...h.deps,
      holdImages: () => () => {
        h.releases.images++;
        throw new Error('registry broke');
      },
    });
    await expect(exporter.exportGif(GIF, () => {}, new AbortController().signal)).rejects.toThrow('registry broke');
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
  });

  it('開始縮圖暫停時拋錯：已保留的圖照樣放開', async () => {
    const h = harness(cardWith('a', [1]), {
      holdThumbnails: () => {
        throw new Error('saver broke');
      },
    });
    const exporter = createTurntableExporter(h.deps);
    await expect(exporter.exportGif(GIF, () => {}, new AbortController().signal)).rejects.toThrow('saver broke');
    expect(h.releases.images).toBe(1);
    expect(exporter.frozenCard()).toBeNull();
  });

  it('還沒有卡、或已經在匯出：failed，不保留任何東西', async () => {
    const none = harness(null);
    expect(await createTurntableExporter(none.deps).exportGif(GIF, () => {}, new AbortController().signal)).toBe('failed');
    expect(none.holds).toEqual({ images: 0, thumbnails: 0 });

    const gate = deferred<void>();
    const h = harness(cardWith('a', [1]), { encodeGif: fakeEncoder(gate.promise).encode });
    const exporter = createTurntableExporter(h.deps);
    const first = exporter.exportGif(GIF, () => {}, new AbortController().signal);
    expect(await exporter.exportGif(GIF, () => {}, new AbortController().signal)).toBe('failed');
    gate.resolve();
    expect(await first).toBe('done');
    expect(h.holds).toEqual({ images: 1, thumbnails: 1 });
    expect(h.releases).toEqual({ images: 1, thumbnails: 1 });
  });
});

// T-812：上下點頭（nodDeg）一路帶到 captureTurntable——GIF 匯出、GIF 預估的試編、影片每一圈都用同一個值；沒給＝0（和以前一樣）；夾在 0～25 整數
describe('上下點頭帶進擷取（T-812）', () => {
  const exportGifWith = async (options: GifExportOptions) => {
    const scene = fakeScene();
    const h = harness(cardWith('a', [1]), { scene: () => scene });
    expect(await createTurntableExporter(h.deps).exportGif(options, () => {}, new AbortController().signal)).toBe('done');
    return scene.calls;
  };

  it('GIF：選的上下角度原樣交給擷取（轉一圈、擺動都一樣），俯仰角的中心仍是 TURNTABLE.pitchDeg', async () => {
    const turn = await exportGifWith({ ...GIF, nodDeg: 22 });
    expect(turn).toHaveLength(1);
    expect(turn[0]).toMatchObject({ motion: 'turn', nodDeg: 22, pitchDeg: TURNTABLE.pitchDeg, frames: TURNTABLE.frames });
    const swing = await exportGifWith({ ...GIF, motion: 'swing', swingDeg: 40, nodDeg: 5 });
    expect(swing[0]).toMatchObject({ motion: 'swing', swingDeg: 40, nodDeg: 5, pitchDeg: TURNTABLE.pitchDeg });
  });

  it('沒給上下角度（T-812 以前的呼叫、舊入口）＝0＝只有左右；0 也原樣交出', async () => {
    expect((await exportGifWith(GIF))[0]!.nodDeg).toBe(0);
    expect((await exportGifWith({ ...GIF, nodDeg: 0 }))[0]!.nodDeg).toBe(0);
    const scene = fakeScene();
    const h = harness(cardWith('a', [1]), { scene: () => scene });
    await createTurntableExporter(h.deps).exportTurntable('gif', () => {}, new AbortController().signal);
    expect(scene.calls[0]!.nodDeg).toBe(0);
  });

  it('夾在 0～25 整數：太大＝25、負的＝0、小數四捨五入、不是數字＝預設 10', async () => {
    const got = async (nodDeg: number) => (await exportGifWith({ ...GIF, nodDeg }))[0]!.nodDeg;
    expect(await got(99)).toBe(25);
    expect(await got(-5)).toBe(0);
    expect(await got(12.6)).toBe(13);
    expect(await got(Number.NaN)).toBe(10);
  });

  it('GIF 預估的試編：兩種寬度的 8 格都帶同一個上下角度（8 格＝80 格裡每隔 10 格，同一個公式）', async () => {
    const scene = fakeScene();
    const h = harness(cardWith('a', [1]), { scene: () => scene });
    await createTurntableExporter(h.deps).estimateGif({ motion: 'turn', swingDeg: 30, nodDeg: 18 }, new AbortController().signal);
    expect(scene.calls.map((c) => [c.width, c.frames, c.motion, c.nodDeg, c.pitchDeg])).toEqual([
      [480, 8, 'turn', 18, TURNTABLE.pitchDeg],
      [320, 8, 'turn', 18, TURNTABLE.pitchDeg],
    ]);
    // 沒給＝0（舊呼叫）
    scene.calls.length = 0;
    await createTurntableExporter(h.deps).estimateGif({ motion: 'swing', swingDeg: 20 }, new AbortController().signal);
    expect(scene.calls.map((c) => c.nodDeg)).toEqual([0, 0]);
  });

  it('改上下角度，GIF 的估算就會重做（走匯出面板：改完停手 0.4 秒後 estimateGif 收到新的角度）', async () => {
    installFakeDom();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const scene = fakeScene();
    const h = harness(cardWith('a', [1]), { scene: () => scene });
    const exporter = createTurntableExporter(h.deps);
    const panel = createExportPanel({ ...exporter, readMusic: async () => ({ ok: false, text: '' }) }, { changed: () => {}, anchor: () => document.createElement('div') as unknown as HTMLElement });
    const run = panel.run('gif');
    await vi.advanceTimersByTimeAsync(0);
    const first = scene.calls.map((c) => c.nodDeg);
    expect(first).toEqual([10, 10]);
    const num = byClass(byClass(panel.el, 'gif-options'), 'mo-nod-num');
    num.value = '20';
    num.dispatchEvent(new FakeEvent('input'));
    await vi.advanceTimersByTimeAsync(399);
    expect(scene.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush(50);
    expect(scene.calls.map((c) => c.nodDeg)).toEqual([10, 10, 20, 20]);
    panel.cancel();
    await run;
  });
});

describe('GIF 預估的試編（T-512b）', () => {
  it('照選的動作在兩種寬度各拍 8 格、各編一次（寬的先拍，編的時候拍下一個）；回每個寬度一筆', async () => {
    const scene = fakeScene();
    const encoder = fakeEncoder();
    const h = harness(cardWith('a', [1]), { scene: () => scene, encodeGif: encoder.encode });
    const exporter = createTurntableExporter(h.deps);
    const got = await exporter.estimateGif({ motion: 'swing', swingDeg: 45 }, new AbortController().signal);
    expect(GIF_ESTIMATE.widths).toEqual([320, 480]);
    expect(scene.calls.map((c) => [c.width, c.frames, c.motion, c.swingDeg])).toEqual([
      [480, 8, 'swing', 45],
      [320, 8, 'swing', 45],
    ]);
    expect(encoder.calls).toEqual([
      { frames: 8, width: 480 },
      { frames: 8, width: 320 },
    ]);
    expect(got).toEqual([
      { bytes: 8 * 480 * 10, frames: 8, width: 480, height: 672 },
      { bytes: 8 * 320 * 10, frames: 8, width: 320, height: 448 },
    ]);
    // 估算不保留圖、不暫停縮圖
    expect(h.holds).toEqual({ images: 0, thumbnails: 0 });
  });

  it('取消或失敗：null', async () => {
    const ctrl = new AbortController();
    const h = harness(cardWith('a', [1]), { scene: () => fakeScene((i, o) => void (o.width === 480 && i === 2 && ctrl.abort())) });
    expect(await createTurntableExporter(h.deps).estimateGif({ motion: 'turn', swingDeg: 30 }, ctrl.signal)).toBeNull();
    const broken = harness(cardWith('a', [1]), { encodeGif: () => Promise.reject(new Error('worker died')) });
    expect(await createTurntableExporter(broken.deps).estimateGif({ motion: 'turn', swingDeg: 30 }, new AbortController().signal)).toBeNull();
    const noScene = harness(cardWith('a', [1]), { scene: () => null });
    expect(await createTurntableExporter(noScene.deps).estimateGif({ motion: 'turn', swingDeg: 30 }, new AbortController().signal)).toBeNull();
  });
});

// T-512c（Codex 審 0d364a4 低②）：兩個寬度的試編都在跑的時候關小框或換動作——兩個編碼都要收到取消，
// 晚到的舊結果（編碼器沒停、照樣交出檔案）不能顯示出來。走 GIF 選項小框（匯出面板）＋真正的組裝。
describe('GIF 預估：兩個寬度的編碼都在跑時關小框或換動作（T-512c）', () => {
  interface EncodeJob {
    width: number;
    signal: AbortSignal | undefined;
    gate: ReturnType<typeof deferred<void>>;
  }

  /** 編碼一直等到測試放行；放行時不管有沒有取消都交出檔案（大小＝格數 × 寬 × perPixel）。 */
  function setup() {
    installFakeDom();
    const jobs: EncodeJob[] = [];
    let waiting: { count: number; resolve: () => void } | null = null;
    const encodeGif: EncodeGif = async (frames, options, _onProgress, signal) => {
      const gate = deferred<void>();
      jobs.push({ width: options.width, signal, gate });
      if (waiting && jobs.length >= waiting.count) waiting.resolve();
      await gate.promise;
      return new Blob([new Uint8Array(frames.length * options.width * (jobs.findIndex((j) => j.gate === gate) < 2 ? 1000 : 10))]);
    };
    const h = harness(cardWith('a', [1]), { encodeGif });
    const exporter = createTurntableExporter(h.deps);
    const panel = createExportPanel({ ...exporter, readMusic: async () => ({ ok: false, text: '' }) }, { changed: () => {}, anchor: () => document.createElement('div') as unknown as HTMLElement });
    /** 等到一共有 count 個編碼開始。 */
    const encodesStarted = (count: number) =>
      jobs.length >= count ? Promise.resolve() : new Promise<void>((resolve) => (waiting = { count, resolve }));
    const texts = () => all(panel.el, 'go-size-est').map((e) => e.textContent);
    return { jobs, panel, encodesStarted, texts };
  }

  /** 照試編的大小（每格 bytes 是寬 × perPixel）算出畫面該顯示的三個數字。 */
  const shown = (perPixel: number) => {
    const samples = [480, 320].map((width) => ({ bytes: 8 * width * perPixel, frames: 8, width, height: Math.round(width * 1.4) }));
    return GIF_SIZES.map((s) => fileSizeText(estimateGifBytes(samples, s.width)!));
  };

  it('關小框：兩個編碼都收到取消；再打開時，舊的結果晚到也不顯示，只顯示新估的', async () => {
    const t = setup();
    const first = t.panel.run('gif');
    await t.encodesStarted(2);
    expect(t.jobs.map((j) => j.width)).toEqual([480, 320]);
    expect(t.jobs.every((j) => j.signal && !j.signal.aborted)).toBe(true);
    byClass(t.panel.el, 'go-cancel').click();
    await first;
    expect(t.jobs.map((j) => j.signal!.aborted)).toEqual([true, true]);
    // 再打開：舊的兩個編碼現在才交出檔案
    const second = t.panel.run('gif');
    await t.encodesStarted(4);
    t.jobs[0]!.gate.resolve();
    t.jobs[1]!.gate.resolve();
    await flush(40);
    expect(t.texts()).toEqual(GIF_SIZES.map(() => GIF_ESTIMATING_TEXT));
    t.jobs[2]!.gate.resolve();
    t.jobs[3]!.gate.resolve();
    await flush(40);
    expect(t.texts()).toEqual(shown(10));
    byClass(t.panel.el, 'go-cancel').click();
    await second;
  });

  it('換動作：兩個編碼都收到取消，舊的結果晚到也不顯示；新的動作估好才顯示', async () => {
    const t = setup();
    const run = t.panel.run('gif');
    await t.encodesStarted(2);
    buttonWithText(byClass(t.panel.el, 'gif-options'), '左右擺動').click();
    expect(t.jobs.slice(0, 2).map((j) => j.signal!.aborted)).toEqual([true, true]);
    await t.encodesStarted(4);
    expect(t.jobs[2]!.signal!.aborted).toBe(false);
    t.jobs[0]!.gate.resolve();
    t.jobs[1]!.gate.resolve();
    await flush(40);
    expect(t.texts()).toEqual(GIF_SIZES.map(() => GIF_ESTIMATING_TEXT));
    t.jobs[2]!.gate.resolve();
    t.jobs[3]!.gate.resolve();
    await flush(40);
    expect(t.texts()).toEqual(shown(10));
    byClass(t.panel.el, 'go-cancel').click();
    await run;
  });
});
