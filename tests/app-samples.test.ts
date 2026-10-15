// 範例卡（T-605b，DESIGN 7.3、7.4）：隨工坊附上的卡片檔 public/samples/*.holocard。
// 範例和使用者匯入的卡片檔一樣是不可信資料：一律走 importHolocard 的完整檢查（SCHEMA §4）。
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { strFromU8, unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_OPENED_KEY } from '../src/app/autosave';
import { importSamplesOnFirstOpen, readSamplePreview, SAMPLE_FILES, SAMPLE_READ_TIMEOUT_MS, sampleFetcher, type FetchSample, type FirstOpenDeps } from '../src/app/samples';
import { createSession } from '../src/app/session';
import { importHolocard } from '../src/file/holocard';
import type { ImportHolocard } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { cardImages } from '../src/model/foil';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { SAMPLE_NAMES } from '../src/ui/library-logic';
import { readImageHeader } from '../src/file/image-header';

const START = Date.parse('2026-10-14T09:00:00.000Z');

/** public/samples/ 底下的實際檔案。 */
const sampleBytes = (file: string) => new Uint8Array(readFileSync(new URL(`../public/samples/${file}`, import.meta.url)));
const sampleBlob = (file: string) => new Blob([sampleBytes(file)]);

/** 假的同源讀檔：直接讀 public/samples/；broken 裡的檔名讀不到（丟錯）。 */
function fsFetch(broken: readonly string[] = []): FetchSample & { calls: string[] } {
  const calls: string[] = [];
  const fetchSample = async (file: string) => {
    calls.push(file);
    if (broken.includes(file)) throw new Error(`範例卡片檔讀不到：${file}`);
    return sampleBlob(file);
  };
  return Object.assign(fetchSample, { calls });
}

let ids = 0;
const newId = () => `id-${++ids}`;

/** 假的 session：記住打開與只存的卡。openResult 決定第幾次打開的結果。 */
function fakeLibrary(openResults: Array<'opened' | 'missing'> = []) {
  const opened: Card[] = [];
  const kept: Card[] = [];
  const openTries: Card[] = [];
  const deps = {
    open: async (card: Card, images: readonly StoredImage[]) => {
      openTries.push(card);
      expect(images.map((i) => i.hash).sort()).toEqual(cardImages(card).sort());
      const result = openResults.shift() ?? 'opened';
      if (result === 'opened') opened.push(card);
      return result;
    },
    keep: async (card: Card, images: readonly StoredImage[]) => {
      expect(images.map((i) => i.hash).sort()).toEqual(cardImages(card).sort());
      kept.push(card);
      return true;
    },
  };
  return { deps, opened, kept, openTries };
}

/** 記在記憶體的 meta（T-829 第一次開啟會記 samplesAdded；這裡的測試不看它）。 */
function memoryMeta(): FirstOpenDeps['store'] {
  const data = new Map<string, string>();
  return { updateMeta: async (key, update) => void data.set(key, update(data.get(key))) };
}

function firstOpenDeps(over: Partial<FirstOpenDeps> & Pick<FirstOpenDeps, 'open' | 'keep'>): FirstOpenDeps {
  return { fetchSample: fsFetch(), importer: importHolocard, newId, now: () => START, store: memoryMeta(), ...over };
}

beforeEach(() => {
  ids = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 只聽 127.0.0.1 的測試伺服器，回傳埠號。 */
function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

describe('隨工坊附上的範例卡片檔', () => {
  it('五張（T-810 加第五張光碟），順序＝新卡片面板的名字（ui 不 import app，這裡核對）；檔案都在 public/samples', () => {
    expect(SAMPLE_FILES).toEqual(['card1-dragon.holocard', 'card2-swordsman.holocard', 'card3-pollenbear.holocard', 'card4-neon.holocard', 'card5-disc.holocard', 'card6-moonlit.holocard']);
    expect(SAMPLE_NAMES).toEqual(['星晶龍', '颯真・雲斬', '琥根花粉獸', '霓虹信使', '星海唱片鯨', '月下幽舞']);
    for (const file of SAMPLE_FILES) expect(sampleBytes(file).length).toBeGreaterThan(0);
  });

  it.each(SAMPLE_FILES.map((file, i) => [file, i] as const))('%s 通過完整的匯入檢查（SCHEMA §4）：卡名＝面板上的名字、有 PNG 預覽圖', async (file, i) => {
    const result = await importHolocard(sampleBlob(file), { newId: () => 'new-id', now: () => '2026-10-14T09:00:00.000Z' });
    if (!result.ok) throw new Error(`${file}: ${result.reason} ${result.detail}`);
    expect(result.card.name).toBe(SAMPLE_NAMES[i]);
    expect(result.card.id).toBe('new-id');
    expect(result.images.map((img) => img.hash).sort()).toEqual(cardImages(result.card).sort());
    expect(result.preview).toBeInstanceOf(Blob);
    const header = readImageHeader(new Uint8Array(await result.preview!.arrayBuffer()));
    expect(header?.type).toBe('image/png');
    expect(Math.max(header!.width, header!.height)).toBeLessThanOrEqual(512);
  });

  it('範例檔是 T-417 之後的新格式（card.json 沒有舊的鐳射範圍 holo.scope；讀進來不用轉換）', () => {
    for (const file of SAMPLE_FILES) {
      const json = JSON.parse(strFromU8(unzipSync(sampleBytes(file))['card.json']!)) as { holo: object };
      expect(json.holo, file).not.toHaveProperty('scope');
    }
  });
});

describe('同源讀範例檔', () => {
  it('網址＝網站根目錄底下的 samples/檔名；fetch 帶同源設定（只准同源、轉址就失敗）＋取消用的 signal；讀到就回 Blob', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]));
    };
    const blob = await sampleFetcher(fetchImpl, '/')('card1-dragon.holocard');
    expect(calls.map((c) => c.url)).toEqual(['/samples/card1-dragon.holocard']);
    expect(calls[0]!.init).toMatchObject({ mode: 'same-origin', redirect: 'error', credentials: 'same-origin' });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(blob.size).toBe(3);
  });

  it('HTTP 不是 2xx → 丟錯', async () => {
    const fetchImpl = async () => new Response('not found', { status: 404 });
    await expect(sampleFetcher(fetchImpl, '/')('card1-dragon.holocard')).rejects.toThrow(/card1-dragon/);
  });

  it('T-605c：同源網址被轉址到別的主機 → 讀取失敗，別的主機一次都沒被連到（用真的 fetch 和兩台本機伺服器）', async () => {
    const outside: string[] = [];
    const elsewhere = createServer((req, res) => {
      outside.push(req.url ?? '');
      res.end('should never be reached');
    });
    const elsewherePort = await listen(elsewhere);
    const workshop = createServer((req, res) => {
      res.writeHead(302, { Location: `http://localhost:${elsewherePort}/evil.holocard` });
      res.end();
    });
    const port = await listen(workshop);
    try {
      const read = sampleFetcher(globalThis.fetch.bind(globalThis), `http://127.0.0.1:${port}/`);
      await expect(read('card1-dragon.holocard')).rejects.toThrow();
      expect(outside).toEqual([]);
    } finally {
      workshop.close();
      elsewhere.close();
    }
  });

  it('T-605c：fetch 一直不回（永不完成）→ 15 秒後當成讀不到、送出取消', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(SAMPLE_READ_TIMEOUT_MS).toBe(15_000);
    let signal: AbortSignal | undefined;
    const fetchImpl = (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    };
    const read = sampleFetcher(fetchImpl, '/')('card2-swordsman.holocard');
    const settled = vi.fn();
    read.then(settled, settled);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).rejects.toThrow(/card2-swordsman/);
    expect(signal?.aborted).toBe(true);
  });

  it('T-605c：內容一直讀不完（body 卡住）→ 也一樣逾時', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stuck = { ok: true, status: 200, blob: () => new Promise<Blob>(() => {}) } as unknown as Response;
    const read = sampleFetcher(async () => stuck, '/')('card3-pollenbear.holocard');
    read.catch(() => {});
    await vi.advanceTimersByTimeAsync(SAMPLE_READ_TIMEOUT_MS);
    await expect(read).rejects.toThrow(/card3-pollenbear/);
  });

  it('讀好了就不會再逾時（計時器收掉）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const blob = await sampleFetcher(async () => new Response(new Uint8Array([1])), '/')('card1-dragon.holocard');
    expect(blob.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('第一次開啟（卡片庫是空的，DESIGN 7.4）', () => {
  it('六張都匯入成使用者的卡（T-820 加第六張）：第一張（星晶龍）打開、其他只存；新 id；時間照順序遞減 1 毫秒（卡片庫照範例順序）', async () => {
    const lib = fakeLibrary();
    const fetchSample = fsFetch();
    const opened = await importSamplesOnFirstOpen(firstOpenDeps({ ...lib.deps, fetchSample }));
    expect(fetchSample.calls.sort()).toEqual([...SAMPLE_FILES].sort());
    expect(opened?.name).toBe('星晶龍');
    expect(lib.opened.map((c) => c.name)).toEqual(['星晶龍']);
    expect(lib.kept.map((c) => c.name)).toEqual(['颯真・雲斬', '琥根花粉獸', '霓虹信使', '星海唱片鯨', '月下幽舞']);
    const all = [...lib.opened, ...lib.kept];
    expect(new Set(all.map((c) => c.id)).size).toBe(6);
    expect(all.every((c) => c.id.startsWith('id-'))).toBe(true);
    expect(all.map((c) => c.updatedAt)).toEqual([0, 1, 2, 3, 4, 5].map((i) => new Date(START - i).toISOString()));
    // 第五張是 CD 光碟（T-810）：匯入後還是光碟；第六張月下幽舞（T-820）是自訂 9:16
    expect(lib.kept.find((c) => c.name === '星海唱片鯨')!.kind).toBe('disc');
    expect(lib.kept.at(-1)!.customAspect).toEqual({ width: 9, height: 16 });
    expect(all.every((c) => c.createdAt === c.updatedAt)).toBe(true);
  });

  it('某一張讀不到或沒通過檢查：跳過那一張、console 記一筆，其他照常', async () => {
    const lib = fakeLibrary();
    const importer: ImportHolocard = async (file, opts) => {
      const result = await importHolocard(file, opts);
      // 第三張假裝沒通過檢查
      return result.ok && result.card.name === '琥根花粉獸' ? { ok: false, reason: 'bad-image', detail: 'test' } : result;
    };
    const opened = await importSamplesOnFirstOpen(firstOpenDeps({ ...lib.deps, importer, fetchSample: fsFetch(['card2-swordsman.holocard']) }));
    expect(opened?.name).toBe('星晶龍');
    expect(lib.kept.map((c) => c.name)).toEqual(['霓虹信使', '星海唱片鯨', '月下幽舞']);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('第一張讀不到：打開下一張通過的', async () => {
    const lib = fakeLibrary();
    const opened = await importSamplesOnFirstOpen(firstOpenDeps({ ...lib.deps, fetchSample: fsFetch(['card1-dragon.holocard']) }));
    expect(opened?.name).toBe('颯真・雲斬');
    expect(lib.kept.map((c) => c.name)).toEqual(['琥根花粉獸', '霓虹信使', '星海唱片鯨', '月下幽舞']);
  });

  it('T-605c：某一張一直讀不完（永不完成）→ 逾時跳過，其他照常，啟動不會卡住', async () => {
    const lib = fakeLibrary();
    const fetchImpl = async (url: string) => {
      if (url.endsWith('card2-swordsman.holocard')) return new Promise<Response>(() => {});
      return new Response(sampleBytes(url.slice('/samples/'.length)));
    };
    const opened = await importSamplesOnFirstOpen(firstOpenDeps({ ...lib.deps, fetchSample: sampleFetcher(fetchImpl, '/', 300) }));
    expect(opened?.name).toBe('星晶龍');
    expect(lib.kept.map((c) => c.name)).toEqual(['琥根花粉獸', '霓虹信使', '星海唱片鯨', '月下幽舞']);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('打不開（例如圖解不開）：跳過那一張、改打開下一張', async () => {
    const lib = fakeLibrary(['missing']);
    const opened = await importSamplesOnFirstOpen(firstOpenDeps(lib.deps));
    expect(lib.openTries.map((c) => c.name)).toEqual(['星晶龍', '颯真・雲斬']);
    expect(opened?.name).toBe('颯真・雲斬');
    expect(lib.kept.map((c) => c.name)).toEqual(['琥根花粉獸', '霓虹信使', '星海唱片鯨', '月下幽舞']);
  });

  it('全部讀不到 → null（組裝端改開空白卡，工坊一定打得開）；不會丟錯', async () => {
    const lib = fakeLibrary();
    const importer: ImportHolocard = async () => {
      throw new Error('檢查程式自己壞了');
    };
    expect(await importSamplesOnFirstOpen(firstOpenDeps({ ...lib.deps, fetchSample: fsFetch(SAMPLE_FILES) }))).toBeNull();
    expect(await importSamplesOnFirstOpen(firstOpenDeps({ ...lib.deps, importer }))).toBeNull();
    expect(lib.opened).toEqual([]);
    expect(lib.kept).toEqual([]);
  });

  it('接上真正的 session（fake-indexeddb）：卡片庫有五張、照範例順序；上次編輯＝星晶龍；圖都存了', async () => {
    const store = await openCardStore(new IDBFactory());
    const registry = new Map<string, StoredImage>();
    let current: Card | null = null;
    const session = createSession({
      store,
      images: {
        add: async (img) => void registry.set(img.hash, img),
        get: (h) => registry.get(h),
        retain: (keep) => {
          for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
        },
      },
      current: () => current,
      show: (card) => void (current = card),
      thumbnail: async () => null,
      settle: async () => {},
      onStatus: () => {},
      onStorageLow: () => {},
    });
    expect(await session.chooseStart()).toBeNull();
    const opened = await importSamplesOnFirstOpen(
      firstOpenDeps({ open: (card, images) => session.adopt(card, images), keep: (card, images, thumb) => session.addToLibrary(card, images, thumb), store }),
    );
    expect(current).toBe(opened);
    expect((await store.list()).map((c) => c.name)).toEqual(['星晶龍', '颯真・雲斬', '琥根花粉獸', '霓虹信使', '星海唱片鯨', '月下幽舞']);
    expect(await store.getMeta(LAST_OPENED_KEY)).toBe(opened!.id);
    for (const summary of await store.list()) {
      const card = (await store.load(summary.id))!;
      for (const hash of cardImages(card)) expect(await store.loadImage(hash), `${card.name} ${hash}`).toBeDefined();
    }
    // 重新整理：回到星晶龍，不會再匯入一次
    expect((await session.chooseStart())!.card.name).toBe('星晶龍');
    // 只存不打開的四張：卡片庫縮圖用卡片檔裡的 preview.png（不然卡片庫與開一包都是空白卡，T-808 驗收時發現）
    const others = (await store.list()).filter((s) => s.id !== opened!.id);
    expect(others).toHaveLength(5);
    for (const s of others) expect(s.thumbnail, s.name).toBeInstanceOf(Blob);
  });
});

describe('新卡片面板的縮圖：用卡片檔裡的 preview.png', () => {
  it('完整檢查通過才回預覽圖（PNG）', async () => {
    const preview = await readSamplePreview(0, fsFetch(), importHolocard);
    expect(preview).toBeInstanceOf(Blob);
    const expected = unzipSync(sampleBytes(SAMPLE_FILES[0]!))['preview.png']!;
    expect(new Uint8Array(await preview!.arrayBuffer())).toEqual(expected);
  });

  it('讀不到、沒通過檢查、沒有預覽圖、沒有這一張 → null（console 記一筆）', async () => {
    expect(await readSamplePreview(0, fsFetch([SAMPLE_FILES[0]!]), importHolocard)).toBeNull();
    const failing: ImportHolocard = async () => ({ ok: false, reason: 'bad-zip' });
    expect(await readSamplePreview(1, fsFetch(), failing)).toBeNull();
    const noPreview: ImportHolocard = async (file, opts) => {
      const result = await importHolocard(file, opts);
      if (!result.ok) return result;
      const { preview: _preview, ...rest } = result;
      return rest;
    };
    expect(await readSamplePreview(2, fsFetch(), noPreview)).toBeNull();
    expect(await readSamplePreview(9, fsFetch(), importHolocard)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
