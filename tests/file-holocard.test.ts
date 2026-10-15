// 卡片檔 `.holocard` 匯出入（SCHEMA.md §4、spec B14、T-402）。匯入的檔是不可信資料：每一條檢查都要有測試。
import { deflateSync, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import { HOLOCARD_MIME, type ImportResult } from '../src/file/types';
import { listZip } from '../src/file/zip-read';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import type { Card, Layer, TextSpec } from '../src/model/types';
import { validateCard } from '../src/model/validate';
import {
  buildZip,
  concat,
  makePng,
  makeWebp,
  pngChunk,
  repeat,
  riff,
  riffChunk,
  stored,
  u32be,
  utf8,
  vp8,
  vp8x,
  withPngChunks,
  zeroBomb,
  type ZipItem,
} from './file-fixtures';

const NOW = '2026-10-13T00:00:00.000Z';
const LATER = '2026-10-14T08:30:00.000Z';
const OPTS = { newId: () => 'imported-id', now: () => LATER };
const MB = 1024 * 1024;
const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
const ROOMY = { maxEntries: 100, maxEntryBytes: 1 << 30, maxTotalBytes: 2 ** 32 };

function baseLayer(image: string, id = 'base'): Layer {
  return { id, name: '底圖', role: 'base', image, visible: true, depth: 0, x: 0, y: 0, scale: 1.4, holo: false, hasAlpha: false };
}

function depthLayer(image: string, id = 'hero', depth = 50): Layer {
  return { id, name: '角色', role: 'depth', image, visible: true, depth, x: 0.1, y: -0.2, scale: 0.9, holo: true, hasAlpha: true };
}

interface Fixture {
  card: Card;
  images: Map<string, StoredImage>;
  /** zip 裡的圖：路徑 → 位元組。 */
  files: Record<string, Uint8Array>;
}

/** 正面底圖＋立體層、背面用同一張底圖（圖都是自己組的小 WebP 檔頭）。 */
async function simpleFixture(): Promise<Fixture> {
  const baseBytes = makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 1 });
  const heroBytes = makeWebp({ kind: 'extended', width: 800, height: 1200, alpha: true, seed: 2 });
  const base = await stored(baseBytes, 'image/webp', 1000, 1400, false);
  const hero = await stored(heroBytes, 'image/webp', 800, 1200, true);
  const card: Card = {
    ...newCard('standard', 'card-1', NOW),
    name: '測試卡',
    front: { layers: [baseLayer(base.hash), depthLayer(hero.hash)] },
    back: { layers: [baseLayer(base.hash, 'back-base')] },
  };
  return {
    card,
    images: new Map([
      [base.hash, base],
      [hero.hash, hero],
    ]),
    files: { [`images/${base.hash}.webp`]: baseBytes, [`images/${hero.hash}.webp`]: heroBytes },
  };
}

/** 組一個卡片檔：card.json（物件就 JSON.stringify、字串就照原文）＋圖（不壓縮）＋預覽＋額外的項目。 */
function holocard(card: unknown, files: Record<string, Uint8Array> = {}, extra: ZipItem[] = [], preview: Uint8Array | null = PREVIEW): Blob {
  const items: ZipItem[] = [{ name: 'card.json', data: utf8(typeof card === 'string' ? card : JSON.stringify(card)) }];
  for (const [name, data] of Object.entries(files)) items.push({ name, data, method: 0 });
  if (preview) items.push({ name: 'preview.png', data: preview, method: 0 });
  return new Blob([buildZip([...items, ...extra])]);
}

function reason(result: ImportResult): string {
  return result.ok ? 'ok' : result.reason;
}

const importOf = (file: Blob): Promise<ImportResult> => importHolocard(file, OPTS);

async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function exportFixture(fx: Fixture): Promise<Blob> {
  return exportHolocard(fx.card, async (h) => fx.images.get(h), new Blob([PREVIEW], { type: 'image/png' }));
}

/** 一張圖：位元組＋照實算的雜湊＋卡片檔裡的路徑。 */
async function imageFile(bytes: Uint8Array<ArrayBuffer>, ext: 'webp' | 'png'): Promise<{ hash: string; path: string; bytes: Uint8Array }> {
  const { hash } = await stored(bytes, ext === 'webp' ? 'image/webp' : 'image/png', 1, 1, false);
  return { hash, path: `images/${hash}.${ext}`, bytes };
}

// ---------------------------------------------------------------- 匯出

describe('exportHolocard', () => {
  it('zip 只有 card.json、用到的圖（兩面共用的只放一份）、preview.png；沒用到的圖不問也不放', async () => {
    const fx = await simpleFixture();
    const unused = await stored(makePng({ seed: 50 }), 'image/png', 4, 4, true);
    const asked: string[] = [];
    const blob = await exportHolocard(
      fx.card,
      async (h) => {
        asked.push(h);
        return h === unused.hash ? unused : fx.images.get(h);
      },
      new Blob([PREVIEW], { type: 'image/png' }),
    );
    expect(blob.type).toBe(HOLOCARD_MIME);
    const files = unzipSync(await blobBytes(blob));
    expect(Object.keys(files).sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    expect([...asked].sort()).toEqual([...fx.images.keys()].sort());
    for (const [path, bytes] of Object.entries(fx.files)) expect(files[path]).toEqual(bytes);
    expect(files['preview.png']).toEqual(PREVIEW);
  });

  it('card.json 是 UTF-8 JSON、內容就是這張卡（中文與特殊字元不變）', async () => {
    const fx = await simpleFixture();
    fx.card.name = '月夜 <b>&"\'\u{1F319}';
    const files = unzipSync(await blobBytes(await exportFixture(fx)));
    expect(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['card.json']))).toEqual(fx.card);
  });

  it('圖與預覽不壓縮（已經壓縮過），card.json 用 DEFLATE', async () => {
    const fx = await simpleFixture();
    const listing = listZip(await blobBytes(await exportFixture(fx)), ROOMY);
    const methods = Object.fromEntries(listing.entries.map((e) => [e.name, e.method]));
    expect(methods['card.json']).toBe(8);
    expect(methods['preview.png']).toBe(0);
    for (const path of Object.keys(fx.files)) expect(methods[path]).toBe(0);
  });

  it('PNG 的圖副檔名用 .png', async () => {
    const fx = await simpleFixture();
    const png = await stored(makePng({ width: 600, height: 600, colorType: 6, seed: 7 }), 'image/png', 600, 600, true);
    fx.card.front.layers.push(depthLayer(png.hash, 'png-layer', 80));
    fx.images.set(png.hash, png);
    const files = unzipSync(await blobBytes(await exportFixture(fx)));
    expect(Object.keys(files)).toContain(`images/${png.hash}.png`);
  });

  it('卡片資料沒通過 validateCard → 丟錯', async () => {
    const fx = await simpleFixture();
    await expect(exportFixture({ ...fx, card: { ...fx.card, name: '   ' } })).rejects.toThrow();
    await expect(exportFixture({ ...fx, card: { ...fx.card, cornerRadius: Number.NaN } })).rejects.toThrow();
  });

  it('getImage 找不到圖 → 丟錯', async () => {
    const fx = await simpleFixture();
    const [, hero] = [...fx.images.keys()];
    fx.images.delete(hero!);
    await expect(exportFixture(fx)).rejects.toThrow();
  });

  it('圖的內容和雜湊不符、檔頭和類型不符 → 丟錯（匯出的檔一定要能匯入）', async () => {
    const fx = await simpleFixture();
    const [base] = [...fx.images.values()];
    const forged = { ...base!, blob: new Blob([makeWebp({ seed: 77 })], { type: 'image/webp' }) };
    await expect(exportHolocard(fx.card, async (h) => (h === base!.hash ? forged : fx.images.get(h)), new Blob([PREVIEW]))).rejects.toThrow();
    const wrongType = { ...base!, type: 'image/png' as const };
    await expect(exportHolocard(fx.card, async (h) => (h === base!.hash ? wrongType : fx.images.get(h)), new Blob([PREVIEW]))).rejects.toThrow();
  });

  it('預覽不是 PNG → 丟錯', async () => {
    const fx = await simpleFixture();
    await expect(exportHolocard(fx.card, async (h) => fx.images.get(h), new Blob([makeWebp()]))).rejects.toThrow();
  });
});

describe('exportHolocard：用和匯入一樣的上限（T-406）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** 只有 size 的假 Blob：export 在讀進記憶體之前就要擋掉（arrayBuffer 被呼叫就代表沒擋）。 */
  function fakeBlob(size: number, type = 'image/png'): { blob: Blob; arrayBuffer: ReturnType<typeof vi.fn> } {
    const arrayBuffer = vi.fn();
    return { blob: { size, type, arrayBuffer } as unknown as Blob, arrayBuffer };
  }

  /** 用 hash 當雜湊、圖層分散在正反面（每面最多 8 層）的卡，圖都是 fake。 */
  function cardOfFakes(sizes: number[]): { card: Card; images: Map<string, StoredImage>; reads: ReturnType<typeof vi.fn>[] } {
    const card = newCard('standard', 'c', NOW);
    const images = new Map<string, StoredImage>();
    const reads: ReturnType<typeof vi.fn>[] = [];
    sizes.forEach((size, i) => {
      const hash = i.toString(16).padStart(16, '0');
      const { blob, arrayBuffer } = fakeBlob(size);
      reads.push(arrayBuffer);
      images.set(hash, { hash, blob, type: 'image/png', width: 2048, height: 2048, hasAlpha: true });
      (i < 8 ? card.front : card.back).layers.push(depthLayer(hash, `l${i}`, 10 + (i % 8)));
    });
    return { card, images, reads };
  }

  const exportFakes = (fx: ReturnType<typeof cardOfFakes>): Promise<Blob> =>
    exportHolocard(fx.card, async (h) => fx.images.get(h), new Blob([PREVIEW], { type: 'image/png' }));

  it('card.json 超過 1 MB → 丟錯，說明是 card.json 太大（剛好 1 MB 可以）', async () => {
    const fx = await simpleFixture();
    const original = JSON.stringify;
    let size = MB + 1;
    vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, replacer?: never, space?: string | number) =>
      value === fx.card ? `{${' '.repeat(size - 2)}}` : original(value, replacer, space)) as typeof JSON.stringify);
    await expect(exportFixture(fx)).rejects.toThrow(/card\.json.*1 MB/);
    size = MB;
    await expect(exportFixture(fx)).resolves.toBeInstanceOf(Blob);
  });

  it('單檔 > 30 MB → 丟錯，而且沒有把它讀進記憶體', async () => {
    const fx = cardOfFakes([30 * MB + 1, 1000]);
    await expect(exportFakes(fx)).rejects.toThrow(/30 MB/);
    for (const read of fx.reads) expect(read).not.toHaveBeenCalled();
  });

  it('總量 > 300 MB（每個都 ≤ 30 MB）→ 丟錯，說明是總量，沒有讀進記憶體', async () => {
    const fx = cardOfFakes(Array.from({ length: 11 }, () => 28 * MB));
    await expect(exportFakes(fx)).rejects.toThrow(/300 MB/);
    for (const read of fx.reads) expect(read).not.toHaveBeenCalled();
  });

  it('圖與預覽加起來 > 200 MB（不壓縮，成品一定比這個大）→ 丟錯，說明檔案會超過 200 MB，沒有讀進記憶體', async () => {
    const fx = cardOfFakes(Array.from({ length: 13 }, () => 16.5 * MB));
    await expect(exportFakes(fx)).rejects.toThrow(/200 MB/);
    for (const read of fx.reads) expect(read).not.toHaveBeenCalled();
  });

  it('產出的 Blob > 200 MB → 丟錯（最後再量一次成品）', async () => {
    class OversizedBlob extends Blob {
      override get size(): number {
        return this.type === HOLOCARD_MIME ? 200 * MB + 1 : super.size;
      }
    }
    vi.stubGlobal('Blob', OversizedBlob);
    await expect(exportFixture(await simpleFixture())).rejects.toThrow(/200 MB/);
  });

  it('圖檔大於 寬×高×4＋1 MB（4×4 的圖塞 2 MB 附加區塊）、動畫 PNG、預覽太大 → 丟錯（和匯入同一套檢查）', async () => {
    const fx = await simpleFixture();
    const fat = withPngChunks(makePng({ width: 4, height: 4, seed: 70 }), pngChunk('zzZz', new Uint8Array(2 * MB)));
    const apng = withPngChunks(makePng({ width: 4, height: 4, colorType: 6, seed: 71 }), pngChunk('acTL', concat([u32be(2), u32be(0)])));
    for (const bytes of [fat, apng]) {
      const image = await stored(bytes, 'image/png', 4, 4, true);
      const card = { ...fx.card, front: { layers: [...fx.card.front.layers, depthLayer(image.hash, 'extra', 90)] } };
      await expect(exportHolocard(card, async (h) => (h === image.hash ? image : fx.images.get(h)), new Blob([PREVIEW]))).rejects.toThrow(/cannot be exported/);
    }
    const fatPreview = withPngChunks(makePng({ width: 8, height: 8 }), pngChunk('zzZz', new Uint8Array(2 * MB)));
    await expect(exportHolocard(fx.card, async (h) => fx.images.get(h), new Blob([fatPreview]))).rejects.toThrow(/preview/);
  });
});

// ---------------------------------------------------------------- 匯入

describe('importHolocard：正常匯入（§4 第 5 條）', () => {
  it('給新的 id 與時間，其他欄位原樣；回傳用到的圖（blob 類型對）', async () => {
    const fx = await simpleFixture();
    const result = await importOf(holocard(fx.card, fx.files));
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...fx.card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    expect(result.images.map((i) => i.hash).sort()).toEqual([...fx.images.keys()].sort());
    for (const image of result.images) {
      const original = fx.images.get(image.hash)!;
      expect({ ...image, blob: undefined }).toEqual({ ...original, blob: undefined });
      expect(image.blob.type).toBe(original.type);
      expect(await blobBytes(image.blob)).toEqual(await blobBytes(original.blob));
    }
  });

  it('newId、now 每次匯入都呼叫（不覆蓋現有卡片）', async () => {
    const fx = await simpleFixture();
    const newId = vi.fn(() => 'id-x');
    const now = vi.fn(() => LATER);
    await importHolocard(holocard(fx.card, fx.files), { newId, now });
    expect(newId).toHaveBeenCalledTimes(1);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('zip 裡有、但卡片沒用到的圖：檢查但不回傳', async () => {
    const fx = await simpleFixture();
    const extra = await imageFile(makePng({ seed: 60 }), 'png');
    const result = await importOf(holocard(fx.card, { ...fx.files, [extra.path]: extra.bytes }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.images.map((i) => i.hash)).not.toContain(extra.hash);
    expect(result.images.length).toBe(fx.images.size);
  });

  it('沒有 preview.png 也可以；沒有 preview 欄位', async () => {
    const fx = await simpleFixture();
    const result = await importOf(holocard(fx.card, fx.files, [], null));
    if (!result.ok) throw new Error(result.reason);
    expect('preview' in result).toBe(false);
  });

  it('有 preview.png：回傳原樣的 PNG Blob（T-605b：新卡片面板的範例縮圖）；不算進 images', async () => {
    const fx = await simpleFixture();
    const result = await importOf(holocard(fx.card, fx.files));
    if (!result.ok) throw new Error(result.reason);
    expect(result.preview).toBeInstanceOf(Blob);
    expect(result.preview!.type).toBe('image/png');
    expect(await blobBytes(result.preview!)).toEqual(PREVIEW);
    expect(result.images.length).toBe(fx.images.size);
  });

  it('preview.png 不合格（不是 PNG）：整個檔不匯入，不會只回 preview', async () => {
    const fx = await simpleFixture();
    const result = await importOf(holocard(fx.card, fx.files, [], makeWebp({ kind: 'lossy', width: 8, height: 8, seed: 3 })));
    expect(result.ok).toBe(false);
    expect('preview' in result).toBe(false);
  });

  it('別的程式重新打包（圖也用 DEFLATE、card.json 前面有 BOM）也能匯入', async () => {
    const fx = await simpleFixture();
    const files: Zippable = { 'card.json': [utf8(`\uFEFF${JSON.stringify(fx.card)}`), { level: 9 }], 'preview.png': PREVIEW };
    for (const [path, bytes] of Object.entries(fx.files)) files[path] = [bytes, { level: 9 }];
    expect(reason(await importOf(new Blob([zipSync(files)])))).toBe('ok');
  });
});

describe('importHolocard：§4 第 1 條 大小', () => {
  it('檔案本身 > 200 MB → too-large，而且不讀進記憶體', async () => {
    const arrayBuffer = vi.fn();
    const huge = { size: 200 * MB + 1, type: '', arrayBuffer, slice: vi.fn(), stream: vi.fn(), text: vi.fn() } as unknown as Blob;
    expect(reason(await importOf(huge))).toBe('too-large');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('剛好 200 MB 不算太大', async () => {
    const fx = await simpleFixture();
    const real = holocard(fx.card, fx.files);
    const file = { size: 200 * MB, type: '', arrayBuffer: () => real.arrayBuffer() } as unknown as Blob;
    expect(reason(await importOf(file))).toBe('ok');
  });

  it('檔案數 > 18 → too-large', async () => {
    const fx = await simpleFixture();
    const extra: ZipItem[] = Array.from({ length: 16 }, (_, i) => ({ name: `x${i}`, data: utf8('x') }));
    // card.json＋2 張圖＋preview＋16＝20
    expect(reason(await importOf(holocard(fx.card, fx.files, extra)))).toBe('too-large');
  });

  it('剛好 18 個檔（1＋16 張圖＋preview）可以', async () => {
    const card = newCard('standard', 'c', NOW);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 16; i++) {
      const image = await imageFile(makeWebp({ kind: 'lossless', alpha: true, seed: 100 + i }), 'webp');
      files[image.path] = image.bytes;
      (i < 8 ? card.front : card.back).layers.push(depthLayer(image.hash, `l${i}`, 10 + (i % 8)));
    }
    expect(reason(await importOf(holocard(card, files)))).toBe('ok');
  });

  it('單檔宣告 > 30 MB → too-large（解壓前就擋）', async () => {
    const fx = await simpleFixture();
    const json = utf8(JSON.stringify(fx.card));
    const zip = buildZip([{ name: 'card.json', data: json, size: 30 * MB + 1 }]);
    expect(reason(await importOf(new Blob([zip])))).toBe('too-large');
  });

  it('宣告總量 > 300 MB → too-large（每個都 ≤ 30 MB）', async () => {
    const items: ZipItem[] = Array.from({ length: 11 }, (_, i) => ({ name: `images/${String(i).padStart(16, '0')}.png`, data: utf8('x'), size: 28 * MB }));
    expect(reason(await importOf(new Blob([buildZip(items)])))).toBe('too-large');
  });

  it('zip 炸彈：中央目錄宣告 100 位元組、實際解出 1 GB → 解到 30 MB 就停，too-large', async () => {
    const zip = buildZip([{ name: 'card.json', compressed: zeroBomb(1 << 30), size: 100, crc: 0 }]);
    const started = performance.now();
    expect(reason(await importOf(new Blob([zip])))).toBe('too-large');
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('zip 炸彈藏在圖裡也一樣', async () => {
    const fx = await simpleFixture();
    const bomb: ZipItem = { name: 'images/00000000000000aa.png', compressed: zeroBomb(1 << 28), size: 100, crc: 0 };
    expect(reason(await importOf(holocard(fx.card, fx.files, [bomb])))).toBe('too-large');
  });
});

describe('importHolocard：card.json 的 1 MB 上限與 ZIP64（T-406，審查：中）', () => {
  /** N 個 '[' 接 N 個 ']'：壓縮後只有幾 KB，解開來是 2N 位元組、JSON.parse 會吃掉大量記憶體。 */
  const nested = (n: number): Uint8Array<ArrayBuffer> => utf8('['.repeat(n) + ']'.repeat(n));
  const level1 = { level: 1 } as const;

  it('剛好 1 MB 的 card.json 還讀得進去（這裡是空物件→ invalid-card）；多 1 位元組 → too-large', async () => {
    const padded = (size: number): string => `{}${' '.repeat(size - 2)}`;
    expect(reason(await importOf(holocard(padded(MB))))).toBe('invalid-card');
    expect(reason(await importOf(holocard(padded(MB + 1))))).toBe('too-large');
  });

  it('括號炸彈、宣告老實（解壓前就擋）：6 MB → too-large，1 秒內', async () => {
    const data = nested(3_000_000);
    const zip = buildZip([{ name: 'card.json', data, compressed: deflateSync(data, level1) }]);
    expect(zip.length).toBeLessThan(100 * 1024); // 壓縮後很小
    const started = performance.now();
    expect(reason(await importOf(new Blob([zip])))).toBe('too-large');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('括號炸彈、宣告造假（宣告 100 位元組、實際 28 MB，在 30 MB 單檔上限之內）→ 解到 1 MB 就中止，too-large，1 秒內', async () => {
    const data = nested(14_000_000);
    const zip = buildZip([{ name: 'card.json', data, compressed: deflateSync(data, level1), size: 100, crc: 0 }]);
    const started = performance.now();
    const result = await importOf(new Blob([zip]));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(reason(result)).toBe('too-large');
    expect(!result.ok && result.detail).toMatch(/inflates past 1048576/);
  });

  it('圖的單檔上限還是 30 MB（只有 card.json 是 1 MB）', async () => {
    const fx = await simpleFixture();
    const big = { name: 'images/00000000000000aa.png', compressed: zeroBomb(5 * MB), size: 100, crc: 0 };
    const result = await importOf(holocard(fx.card, fx.files, [big]));
    // 5 MB 的圖沒超過 30 MB 上限，所以不是 too-large，而是實際大小和宣告（100）對不上
    expect(reason(result)).toBe('bad-zip');
  });

  it('ZIP64 的特徵值：單檔大小 0xffffffff、檔案數 0xffff → too-large', async () => {
    const json = utf8('{}');
    expect(reason(await importOf(new Blob([buildZip([{ name: 'card.json', data: json, size: 0xffffffff }])])))).toBe('too-large');
    expect(reason(await importOf(new Blob([buildZip([{ name: 'card.json', data: json }], { count: 0xffff })])))).toBe('too-large');
  });
});

describe('importHolocard：§4 第 2 條 路徑白名單', () => {
  const BAD_PATHS = [
    '../x',
    '/abs',
    '/card.json',
    './card.json',
    'images/../card.json',
    'IMAGES/0123456789abcdef.png',
    'images\\0123456789abcdef.png',
    '',
    'images/',
    'Card.json',
    'card.json/',
    'card.json ',
    'card.json\u0000',
    'preview.png.exe',
    'images/0123456789ABCDEF.png',
    'images/0123456789abcde.png',
    'images/0123456789abcdef0.png',
    'images/0123456789abcdeg.png',
    'images/0123456789abcdef.jpg',
    'images/0123456789abcdef.PNG',
    'images/0123456789abcdef.png\n',
    'images/sub/0123456789abcdef.png',
    'images//0123456789abcdef.png',
    'C:\\card.json',
    'thumbs.db',
    '__proto__',
  ];

  it.each(BAD_PATHS)('%j → bad-path', async (path) => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard(fx.card, fx.files, [{ name: path, data: utf8('x') }])))).toBe('bad-path');
  });

  it('非 ASCII 的檔名（全形字）→ bad-path', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard(fx.card, fx.files, [{ name: 'images/０１２３４５６７８９abcdef.png', data: utf8('x') }])))).toBe('bad-path');
  });

  it('同一個名字出現兩次 → bad-path', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard(fx.card, fx.files, [{ name: 'card.json', data: utf8('{}') }])))).toBe('bad-path');
    const [path, bytes] = Object.entries(fx.files)[0]!;
    expect(reason(await importOf(holocard(fx.card, fx.files, [{ name: path, data: bytes, method: 0 }])))).toBe('bad-path');
  });

  it('檔名超過 64 位元組 → bad-path，而且錯誤說明裡不會有整串長檔名（T-406）', async () => {
    const fx = await simpleFixture();
    for (const length of [65, 1000, 65_000]) {
      const result = await importOf(holocard(fx.card, fx.files, [{ name: `images/${'a'.repeat(length)}.png`, data: utf8('x') }]));
      expect(reason(result), `name of ${length + 11} bytes`).toBe('bad-path');
      // 名字沒有被轉成字串，說明裡只有「幾個位元組」的代號
      expect(!result.ok && result.detail).toContain(`<name of ${length + 11} bytes>`);
    }
    // 64 位元組以內但不在白名單裡的，照舊 bad-path
    expect(reason(await importOf(holocard(fx.card, fx.files, [{ name: 'a'.repeat(64), data: utf8('x') }])))).toBe('bad-path');
  });
});

describe('importHolocard：有不認得的路徑時，較新的版本優先（T-406，SCHEMA §4 第 2 條例外）', () => {
  const stranger = (name = 'extras/new-thing.bin'): ZipItem => ({ name, data: utf8('x') });

  it('不認得的路徑＋card.json 的 formatVersion 比程式新 → newer-version（card.json 其他欄位長什麼樣都可以）', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard({ formatVersion: 2, somethingNew: [1, 2, 3] }, {}, [stranger()])))).toBe('newer-version');
    expect(reason(await importOf(holocard({ ...fx.card, formatVersion: 7 }, fx.files, [stranger()])))).toBe('newer-version');
  });

  it('不認得的路徑是長檔名（例如以後改用 64 碼雜湊的 images/…）也一樣', async () => {
    const longName = `images/${'0123456789abcdef'.repeat(4)}.webp`;
    expect(longName.length).toBeGreaterThan(64);
    expect(reason(await importOf(holocard({ formatVersion: 2 }, {}, [stranger(longName)])))).toBe('newer-version');
  });

  it('formatVersion 是 1（或比 1 小）→ 照舊 bad-path，不放寬', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard(fx.card, fx.files, [stranger()])))).toBe('bad-path');
    expect(reason(await importOf(holocard({ ...fx.card, formatVersion: 0 }, fx.files, [stranger()])))).toBe('bad-path');
  });

  it.each([
    ['不是 JSON', '{"formatVersion":'],
    ['不是物件', '[]'],
    ['null', 'null'],
    ['沒有 formatVersion', '{}'],
    ['formatVersion 是字串', '{"formatVersion":"2"}'],
    ['formatVersion 是 Infinity（1e999）', '{"formatVersion":1e999}'],
    ['formatVersion 是 null', '{"formatVersion":null}'],
    ['formatVersion 是 NaN（不是合法 JSON）', '{"formatVersion":NaN}'],
  ])('card.json 讀不出較新的版本號（%s）→ bad-path', async (_label, text) => {
    expect(reason(await importOf(holocard(text, {}, [stranger()])))).toBe('bad-path');
  });

  it('card.json 壞掉（不是 UTF-8、CRC 不符）、同名兩個、根本沒有 → bad-path', async () => {
    const newer = utf8('{"formatVersion":2}');
    const withStranger = (items: ZipItem[]): Blob => new Blob([buildZip(items)]);
    expect(reason(await importOf(withStranger([{ name: 'card.json', data: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }, stranger()])))).toBe('bad-path');
    expect(reason(await importOf(withStranger([{ name: 'card.json', data: newer, crc: 1234 }, stranger()])))).toBe('bad-path');
    // 同名兩個：不認得的路徑排在前面，才會走到「較新版本」的判斷（排在後面會先被「同名」擋掉）
    const twice: ZipItem[] = [stranger(), { name: 'card.json', data: newer }, { name: 'card.json', data: newer }];
    expect(reason(await importOf(withStranger(twice)))).toBe('bad-path');
    expect(reason(await importOf(withStranger([stranger()])))).toBe('bad-path');
  });

  it('card.json 是炸彈（宣告 100 位元組、實際 256 MB）→ 只解到 1 MB 就放棄，bad-path，很快', async () => {
    const bomb: ZipItem = { name: 'card.json', compressed: zeroBomb(1 << 28), size: 100, crc: 0 };
    const started = performance.now();
    expect(reason(await importOf(new Blob([buildZip([stranger(), bomb])])))).toBe('bad-path');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('card.json 超過 1 MB → too-large（比路徑先判斷）', async () => {
    const big = utf8(`{"formatVersion":2}${' '.repeat(MB)}`);
    expect(reason(await importOf(new Blob([buildZip([{ name: 'card.json', data: big }, stranger()])])))).toBe('too-large');
  });

  it('不認得的路徑＋較新版本時只讀 card.json，不去檢查圖（圖壞掉也一樣回 newer-version）', async () => {
    const broken = { name: 'images/00000000000000ff.png', data: utf8('not an image'), method: 0 };
    expect(reason(await importOf(new Blob([buildZip([{ name: 'card.json', data: utf8('{"formatVersion":2}') }, broken, stranger()])])))).toBe(
      'newer-version',
    );
  });
});

describe('importHolocard：壞掉的 zip → bad-zip', () => {
  it('不是 zip、空檔', async () => {
    expect(reason(await importOf(new Blob([utf8('這不是卡片檔')])))).toBe('bad-zip');
    expect(reason(await importOf(new Blob([makePng()])))).toBe('bad-zip');
    expect(reason(await importOf(new Blob([])))).toBe('bad-zip');
  });

  it('匯出的檔被截斷', async () => {
    const bytes = await blobBytes(await exportFixture(await simpleFixture()));
    expect(reason(await importOf(new Blob([bytes.subarray(0, bytes.length - 30)])))).toBe('bad-zip');
    expect(reason(await importOf(new Blob([bytes.subarray(0, bytes.length >> 1)])))).toBe('bad-zip');
  });

  it('資料被改了一個位元組（CRC 不符）', async () => {
    const fx = await simpleFixture();
    const bytes = await blobBytes(await exportFixture(fx));
    const [path] = Object.keys(fx.files);
    // 找到這張圖的資料：本地檔頭 30 位元組＋檔名之後
    const name = utf8(path!);
    let at = 0;
    for (; at < bytes.length; at++) if (bytes.subarray(at, at + name.length).every((b, i) => b === name[i])) break;
    const corrupted = bytes.slice();
    corrupted[at + name.length + 5] ^= 0xff;
    expect(reason(await importOf(new Blob([corrupted])))).toBe('bad-zip');
  });
});

describe('importHolocard：card.json → missing-card', () => {
  it('沒有 card.json', async () => {
    const fx = await simpleFixture();
    const items: ZipItem[] = Object.entries(fx.files).map(([name, data]) => ({ name, data, method: 0 }));
    expect(reason(await importOf(new Blob([buildZip(items)])))).toBe('missing-card');
    expect(reason(await importOf(new Blob([buildZip([])])))).toBe('missing-card');
  });

  it('不是合法 JSON（截斷、NaN、註解、單引號、空的）', async () => {
    for (const text of ['{"formatVersion":1,', '{"formatVersion": NaN}', '{"a":1} // x', "{'a':1}", '', 'undefined']) {
      expect(reason(await importOf(holocard(text))), text).toBe('missing-card');
    }
  });

  it('不是 UTF-8', async () => {
    const zip = buildZip([{ name: 'card.json', data: new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]) }]);
    expect(reason(await importOf(new Blob([zip])))).toBe('missing-card');
  });

  it('不用 eval：JSON 裡的程式碼不會被執行', async () => {
    const spy = vi.fn();
    (globalThis as Record<string, unknown>).__holoPwned = spy;
    const result = await importOf(holocard('__holoPwned()'));
    expect(reason(result)).toBe('missing-card');
    expect(spy).not.toHaveBeenCalled();
    delete (globalThis as Record<string, unknown>).__holoPwned;
  });
});

describe('importHolocard：§4 第 3 條 版本與驗證', () => {
  it('formatVersion 2 → newer-version（在 validateCard 之前判斷，其他欄位不合格也一樣）', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard({ ...fx.card, formatVersion: 2 }, fx.files)))).toBe('newer-version');
    expect(reason(await importOf(holocard({ formatVersion: 3, somethingNew: true })))).toBe('newer-version');
  });

  it('formatVersion 是 1e999（Infinity）、字串 "2"、0、缺少 → invalid-card（不是 newer-version）', async () => {
    const fx = await simpleFixture();
    const json = JSON.stringify(fx.card);
    expect(reason(await importOf(holocard(json.replace('"formatVersion":1', '"formatVersion":1e999'), fx.files)))).toBe('invalid-card');
    expect(reason(await importOf(holocard({ ...fx.card, formatVersion: '2' }, fx.files)))).toBe('invalid-card');
    expect(reason(await importOf(holocard({ ...fx.card, formatVersion: 0 }, fx.files)))).toBe('invalid-card');
    const { formatVersion: _, ...noVersion } = fx.card;
    expect(reason(await importOf(holocard(noVersion, fx.files)))).toBe('invalid-card');
  });

  it('card.json 不是物件（陣列、數字、null）→ invalid-card', async () => {
    for (const text of ['[]', '42', 'null', '"card"']) {
      expect(reason(await importOf(holocard(text))), text).toBe('invalid-card');
    }
  });

  it('沒通過 validateCard → invalid-card，detail 有說明', async () => {
    const fx = await simpleFixture();
    const result = await importOf(holocard({ ...fx.card, aspect: 'round' }, fx.files));
    expect(reason(result)).toBe('invalid-card');
    expect(!result.ok && result.detail).toMatch(/aspect/);
  });

  it('card.json 用到的圖沒附 → missing-image', async () => {
    const fx = await simpleFixture();
    const [path] = Object.keys(fx.files);
    const files = { ...fx.files };
    delete files[path!];
    expect(reason(await importOf(holocard(fx.card, files)))).toBe('missing-image');
  });

  it('卡片只記雜湊、不記格式：附的是 .png 也算有這張圖', async () => {
    const card = newCard('standard', 'c', NOW);
    const png = await imageFile(makePng({ colorType: 6, seed: 3 }), 'png');
    card.front.layers.push(depthLayer(png.hash));
    expect(reason(await importOf(holocard(card, { [png.path]: png.bytes })))).toBe('ok');
  });
});

describe('importHolocard：§4 第 4 條 圖片 → bad-image', () => {
  async function withBase(bytes: Uint8Array<ArrayBuffer>, ext: 'webp' | 'png'): Promise<ImportResult> {
    const image = await imageFile(bytes, ext);
    const card = newCard('standard', 'c', NOW);
    card.front.layers.push(baseLayer(image.hash));
    return importOf(holocard(card, { [image.path]: image.bytes }));
  }

  it('合格的底圖（對照組）', async () => {
    expect(reason(await withBase(makeWebp({ width: 2048, height: 2048 }), 'webp'))).toBe('ok');
    expect(reason(await withBase(makePng({ width: 2048, height: 1, colorType: 2 }), 'png'))).toBe('ok');
  });

  it('同名雜湊冒充：檔名的雜湊和內容不同', async () => {
    const fx = await simpleFixture();
    const [path] = Object.keys(fx.files);
    const forged = { ...fx.files, [path!]: makeWebp({ kind: 'lossy', width: 1000, height: 1400, seed: 200 }) };
    const result = await importOf(holocard(fx.card, forged));
    expect(reason(result)).toBe('bad-image');
  });

  it('檔頭和副檔名不符（webp 內容叫 .png、png 內容叫 .webp）', async () => {
    expect(reason(await withBase(makeWebp(), 'png'))).toBe('bad-image');
    expect(reason(await withBase(makePng({ colorType: 2 }), 'webp'))).toBe('bad-image');
  });

  it('不是 WebP 也不是 PNG（JPEG、SVG、亂碼）', async () => {
    expect(reason(await withBase(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'webp'))).toBe('bad-image');
    expect(reason(await withBase(utf8('<svg onload="alert(1)"/>'), 'png'))).toBe('bad-image');
    expect(reason(await withBase(new Uint8Array(0), 'png'))).toBe('bad-image');
  });

  it('長或寬 > 2048（PNG、VP8、VP8L、VP8X 都擋）', async () => {
    expect(reason(await withBase(makePng({ width: 2049, height: 10, colorType: 2 }), 'png'))).toBe('bad-image');
    expect(reason(await withBase(makePng({ width: 10, height: 100000, colorType: 2 }), 'png'))).toBe('bad-image');
    expect(reason(await withBase(makeWebp({ kind: 'lossy', width: 3000, height: 100 }), 'webp'))).toBe('bad-image');
    expect(reason(await withBase(makeWebp({ kind: 'lossless', width: 100, height: 2049 }), 'webp'))).toBe('bad-image');
    expect(reason(await withBase(makeWebp({ kind: 'extended', width: 40000, height: 40000, innerWidth: 100, innerHeight: 100 }), 'webp'))).toBe(
      'bad-image',
    );
  });

  it('長或寬是 0', async () => {
    expect(reason(await withBase(makePng({ width: 0, height: 10, colorType: 2 }), 'png'))).toBe('bad-image');
    expect(reason(await withBase(makeWebp({ kind: 'lossy', width: 10, height: 0 }), 'webp'))).toBe('bad-image');
  });

  it('VP8X 小畫布藏大圖（畫布 100、內層 4000）', async () => {
    expect(reason(await withBase(makeWebp({ kind: 'extended', width: 100, height: 100, innerWidth: 4000 }), 'webp'))).toBe('bad-image');
  });

  it('卡片沒用到的圖壞掉也擋', async () => {
    const fx = await simpleFixture();
    const broken = { 'images/00000000000000ff.png': makePng() };
    expect(reason(await importOf(holocard(fx.card, { ...fx.files, ...broken })))).toBe('bad-image');
  });

  it('preview.png 不是 PNG、或長寬超過上限', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard(fx.card, fx.files, [], makeWebp())))).toBe('bad-image');
    expect(reason(await importOf(holocard(fx.card, fx.files, [], utf8('not png'))))).toBe('bad-image');
    expect(reason(await importOf(holocard(fx.card, fx.files, [], makePng({ width: 5000, height: 10 }))))).toBe('bad-image');
  });

  it('StoredImage.hasAlpha 照檔頭宣告', async () => {
    const card = newCard('standard', 'c', NOW);
    const opaque = await imageFile(makeWebp({ kind: 'lossy', seed: 1 }), 'webp');
    const lossless = await imageFile(makeWebp({ kind: 'lossless', alpha: true, seed: 2 }), 'webp');
    const extended = await imageFile(makeWebp({ kind: 'extended', alpha: true, seed: 3 }), 'webp');
    const trns = await imageFile(makePng({ colorType: 3, trns: true, seed: 4 }), 'png');
    const rgb = await imageFile(makePng({ colorType: 2, seed: 5 }), 'png');
    card.front.layers.push(baseLayer(opaque.hash), depthLayer(lossless.hash, 'a', 10), depthLayer(extended.hash, 'b', 20), depthLayer(trns.hash, 'c', 30));
    card.back.layers.push(baseLayer(rgb.hash, 'back-base'));
    const files = Object.fromEntries([opaque, lossless, extended, trns, rgb].map((i) => [i.path, i.bytes]));
    const result = await importOf(holocard(card, files));
    if (!result.ok) throw new Error(result.reason);
    const alpha = Object.fromEntries(result.images.map((i) => [i.hash, i.hasAlpha]));
    expect(alpha).toEqual({ [opaque.hash]: false, [lossless.hash]: true, [extended.hash]: true, [trns.hash]: true, [rgb.hash]: false });
    const types = Object.fromEntries(result.images.map((i) => [i.hash, [i.type, i.blob.type]]));
    expect(types[trns.hash]).toEqual(['image/png', 'image/png']);
    expect(types[opaque.hash]).toEqual(['image/webp', 'image/webp']);
  });

  // ---- T-406：檔案大小、動畫 PNG、檔頭掃描上限 ----

  /** 4×4 的 PNG 加上一個 size 位元組的附加區塊，總長剛好是 total。 */
  function pngOfLength(total: number): Uint8Array<ArrayBuffer> {
    const base = makePng({ width: 4, height: 4, colorType: 2, seed: 9 });
    const padding = total - base.length - 12; // 區塊開頭 8＋CRC 4
    return withPngChunks(base, pngChunk('zzZz', new Uint8Array(padding)));
  }

  it('圖檔大小 ≤ 寬×高×4＋1 MB：4×4 的小圖剛好在上限（64 位元組＋1 MB）可以，多 1 位元組 → bad-image', async () => {
    const limit = 4 * 4 * 4 + MB;
    expect(pngOfLength(limit).length).toBe(limit);
    expect(reason(await withBase(pngOfLength(limit), 'png'))).toBe('ok');
    expect(reason(await withBase(pngOfLength(limit + 1), 'png'))).toBe('bad-image');
  });

  it('4×4 的 PNG 塞 29 MB 的附加區塊 → bad-image（檔頭合格、雜湊也對，只有大小不對）', async () => {
    expect(reason(await withBase(pngOfLength(29 * MB), 'png'))).toBe('bad-image');
  });

  it('WebP 也一樣：4×4 的 VP8X 中間塞 29 MB 的區塊 → bad-image', async () => {
    const webp = riff(concat([vp8x(0, 4, 4), riffChunk('JUNK', new Uint8Array(29 * MB)), riffChunk('VP8 ', vp8(4, 4))]));
    expect(reason(await withBase(webp, 'webp'))).toBe('bad-image');
  });

  it('預覽圖也受同樣的大小上限（8×8 的預覽塞 29 MB）', async () => {
    const fx = await simpleFixture();
    const fat = withPngChunks(makePng({ width: 8, height: 8, seed: 5 }), pngChunk('zzZz', new Uint8Array(29 * MB)));
    expect(reason(await importOf(holocard(fx.card, fx.files, [], fat)))).toBe('bad-image');
  });

  it.each([6, 2] as const)('動畫 PNG（有 acTL 區塊，color type %i）→ bad-image', async (colorType) => {
    const apng = withPngChunks(makePng({ colorType, seed: 3 }), pngChunk('acTL', concat([u32be(2), u32be(0)])));
    expect(reason(await withBase(apng, 'png'))).toBe('bad-image');
  });

  it('PNG 的 IHDR 和 IDAT 中間塞了一百萬個空區塊（大小還在上限內）→ bad-image', async () => {
    // 宣告 2048×2048，上限 17 MB；100 萬個空區塊 12 MB 沒超過，只有「最多掃 64 個區塊」會擋
    const png = withPngChunks(makePng({ width: 2048, height: 2048, colorType: 6, seed: 4 }), repeat(pngChunk('aaAa', []), 1_000_000));
    expect(png.length).toBeLessThan(2048 * 2048 * 4 + MB);
    expect(reason(await withBase(png, 'png'))).toBe('bad-image');
  });

  it('WebP 的 VP8X 和圖中間塞了一百萬個空區塊（大小還在上限內）→ bad-image', async () => {
    const webp = riff(concat([vp8x(0x10, 2048, 2048), repeat(riffChunk('JUNK', []), 1_000_000), riffChunk('VP8 ', vp8(2048, 2048))]));
    expect(webp.length).toBeLessThan(2048 * 2048 * 4 + MB);
    expect(reason(await withBase(webp, 'webp'))).toBe('bad-image');
  });
});

describe('importHolocard：B14 不可信資料', () => {
  it('名字含 <script> 原樣匯入（顯示時由畫面用 textContent，這裡不清理）', async () => {
    const fx = await simpleFixture();
    const evil = '<script>alert(1)</script>';
    fx.card.name = evil;
    fx.card.front.layers[1]!.name = '<img src=x onerror=alert(1)>';
    const result = await importOf(holocard(fx.card, fx.files));
    if (!result.ok) throw new Error(result.reason);
    expect(result.card.name).toBe(evil);
    expect(result.card.front.layers[1]!.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('1e999（Infinity）、-1e999、字串數字 → invalid-card', async () => {
    const fx = await simpleFixture();
    const json = JSON.stringify(fx.card);
    expect(reason(await importOf(holocard(json.replace('"x":0.1', '"x":1e999'), fx.files)))).toBe('invalid-card');
    expect(reason(await importOf(holocard(json.replace('"scale":0.9', '"scale":-1e999'), fx.files)))).toBe('invalid-card');
    expect(reason(await importOf(holocard(json.replace('"x":0.1', '"x":"0.1"'), fx.files)))).toBe('invalid-card');
    expect(reason(await importOf(holocard(json.replace('"strength":65', '"strength":"65"'), fx.files)))).toBe('invalid-card');
  });

  it('__proto__／constructor 鍵 → invalid-card，而且不汙染原型', async () => {
    const fx = await simpleFixture();
    const json = JSON.stringify(fx.card);
    const top = `{"__proto__":{"polluted":true},${json.slice(1)}`;
    expect(reason(await importOf(holocard(top, fx.files)))).toBe('invalid-card');
    const inLayer = json.replace('"id":"hero"', '"id":"hero","__proto__":{"polluted":true}');
    expect(reason(await importOf(holocard(inLayer, fx.files)))).toBe('invalid-card');
    const ctor = json.replace('"id":"hero"', '"id":"hero","constructor":{"prototype":{"polluted":true}}');
    expect(reason(await importOf(holocard(ctor, fx.files)))).toBe('invalid-card');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('超長字串（名字 90 萬字、不認得的欄位名 10 萬字）→ invalid-card，不會卡住；名字 500 萬字連 card.json 都超過 1 MB → too-large', async () => {
    const fx = await simpleFixture();
    // card.json 上限 1 MB（T-406）：90 萬字的名字加上其他欄位還在上限內
    expect(reason(await importOf(holocard({ ...fx.card, name: 'a'.repeat(5_000_000) }, fx.files)))).toBe('too-large');
    const started = performance.now();
    expect(reason(await importOf(holocard({ ...fx.card, name: 'a'.repeat(900_000) }, fx.files)))).toBe('invalid-card');
    expect(reason(await importOf(holocard({ ...fx.card, ['k'.repeat(100_000)]: 1 }, fx.files)))).toBe('invalid-card');
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('深層巢狀（20 萬層）→ 被擋（invalid-card 或 missing-card），不會丟例外', async () => {
    const fx = await simpleFixture();
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    const json = JSON.stringify(fx.card);
    const inLayers = json.replace('"layers":[{"id":"base"', `"layers":[${deep},{"id":"base"`);
    expect(['invalid-card', 'missing-card']).toContain(reason(await importOf(holocard(inLayers, fx.files))));
    const unknown = `{"deep":${deep},${json.slice(1)}`;
    expect(['invalid-card', 'missing-card']).toContain(reason(await importOf(holocard(unknown, fx.files))));
  });

  it('多出來的欄位（例如 script、onload）→ invalid-card', async () => {
    const fx = await simpleFixture();
    expect(reason(await importOf(holocard({ ...fx.card, script: 'alert(1)' }, fx.files)))).toBe('invalid-card');
  });
});

// ---------------------------------------------------------------- 來回

/** 來回用的一層：底圖（depth 0）、立體層，或文字層（有 text）；png＝這層的圖用 PNG。 */
interface RoundTripLayer {
  name: string;
  depth: number;
  x?: number;
  y?: number;
  scale?: number;
  png?: boolean;
  text?: TextSpec;
}

/**
 * 來回用的三種版面（T-605b 起不靠寫死的範例卡：自己寫的小版面）：多層＋出血放大＋文字層（印章）、立體層用 PNG、6 層；
 * 背面都有一張底圖。圖換成自己組的小檔頭（底圖不透明 WebP、立體層透明 WebP、文字層無損 WebP）。
 */
const ROUND_TRIP_LAYOUTS: readonly { front: RoundTripLayer[]; back: RoundTripLayer[] }[] = [
  {
    front: [
      { name: '海景', depth: 0 },
      { name: '松枝', depth: 20, scale: 1130 / 1008 },
      { name: '角色', depth: 50 },
      { name: '月', depth: 70, x: 0.31, y: 0.53, scale: 1.1, text: { content: '月', font: 'wenkai', color: '#c8322b', align: 'center', vertical: false, style: 'seal' } },
      { name: '花瓣', depth: 90 },
    ],
    back: [{ name: '卡背', depth: 0 }],
  },
  {
    front: [
      { name: '庭園', depth: 0 },
      { name: '角色', depth: 50, png: true },
      { name: '蝴蝶', depth: 90 },
    ],
    back: [{ name: '卡背', depth: 0 }],
  },
  {
    front: [
      { name: '遠景', depth: 0 },
      { name: '樹幹', depth: 20, scale: 1130 / 1008 },
      { name: '倒木', depth: 45, scale: 1280 / 1008 },
      { name: '角色', depth: 50 },
      { name: '蕨葉', depth: 75, scale: 1462 / 1008 },
      { name: '光點', depth: 90 },
    ],
    back: [{ name: '卡背', depth: 0 }],
  },
];

async function roundTripFixture(index: number): Promise<{ card: Card; images: Map<string, StoredImage> }> {
  const layout = ROUND_TRIP_LAYOUTS[index]!;
  const images = new Map<string, StoredImage>();
  let seed = 20 * (index + 1);
  const toLayer = async (face: string, spec: RoundTripLayer, i: number): Promise<Layer> => {
    seed += 1;
    let image: StoredImage;
    if (spec.text) image = await stored(makeWebp({ kind: 'lossless', width: 1200, height: 160, alpha: true, seed }), 'image/webp', 1200, 160, true);
    else if (spec.depth === 0) image = await stored(makeWebp({ kind: 'lossy', width: 1008, height: 1408, seed }), 'image/webp', 1008, 1408, false);
    else if (spec.png) image = await stored(makePng({ width: 900, height: 1300, seed }), 'image/png', 900, 1300, true);
    else image = await stored(makeWebp({ kind: 'extended', width: 1008, height: 1408, alpha: true, seed }), 'image/webp', 1008, 1408, true);
    images.set(image.hash, image);
    const base = spec.depth === 0;
    const layer: Layer = {
      id: `${face}-${i}`,
      name: spec.name,
      role: base ? 'base' : 'depth',
      image: image.hash,
      visible: true,
      depth: spec.depth,
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      scale: spec.scale ?? 1,
      holo: !base,
      hasAlpha: image.hasAlpha,
    };
    return spec.text ? { ...layer, text: spec.text } : layer;
  };
  const layersOf = async (face: string, specs: RoundTripLayer[]) => {
    const out: Layer[] = [];
    for (const [i, spec] of specs.entries()) out.push(await toLayer(face, spec, i));
    return out;
  };
  const card: Card = {
    ...newCard('standard', `round-trip-${index}`, NOW),
    name: `來回 ${index + 1}`,
    front: { layers: await layersOf('front', layout.front) },
    back: { layers: await layersOf('back', layout.back) },
  };
  return { card, images };
}

describe('來回：匯出再匯入，內容一樣（除了 id 與時間）', () => {
  it.each([0, 1, 2])('版面 %i', async (index) => {
    const { card, images } = await roundTripFixture(index);
    expect(validateCard(card, (h) => images.has(h))).toEqual([]);
    expect(card.front.layers.length).toBe(ROUND_TRIP_LAYOUTS[index]!.front.length);
    const blob = await exportHolocard(card, async (h) => images.get(h), new Blob([PREVIEW], { type: 'image/png' }));
    const result = await importOf(blob);
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...card, id: 'imported-id', createdAt: LATER, updatedAt: LATER });
    expect(result.images.length).toBe(images.size);
    for (const image of result.images) {
      const original = images.get(image.hash)!;
      expect({ ...image, blob: undefined }).toEqual({ ...original, blob: undefined });
      expect(image.blob.type).toBe(original.type);
      expect(await blobBytes(image.blob)).toEqual(await blobBytes(original.blob));
    }
  });

  it('文字圖層的 text 原樣保留', async () => {
    const { card, images } = await roundTripFixture(0);
    const textLayer = card.front.layers.find((l) => l.text);
    expect(textLayer?.text?.content).toBe('月');
    const result = await importOf(await exportHolocard(card, async (h) => images.get(h), new Blob([PREVIEW])));
    if (!result.ok) throw new Error(result.reason);
    expect(result.card.front.layers.find((l) => l.text)).toEqual(textLayer);
  });

  it('匯出的檔讀 card.json 就是原卡（給別的程式讀）', async () => {
    const { card, images } = await roundTripFixture(2);
    const files = unzipSync(await blobBytes(await exportHolocard(card, async (h) => images.get(h), new Blob([PREVIEW]))));
    expect(JSON.parse(strFromU8(files['card.json']!))).toEqual(card);
  });
});

// ---------------------------------------------------------------- 破框（T-411）

describe('破框層 breakout（T-411，SCHEMA §1、§4）', () => {
  it('匯出：true 照寫；明寫的 false 不寫出（和 opacity／blend 的預設值一樣）', async () => {
    const fx = await simpleFixture();
    const [base, hero] = fx.card.front.layers;
    fx.card.front.layers = [base!, { ...hero!, breakout: true }];
    fx.card.back.layers = [{ ...fx.card.back.layers[0]! }];
    const withFalse = await simpleFixture();
    withFalse.card.front.layers = [withFalse.card.front.layers[0]!, { ...withFalse.card.front.layers[1]!, breakout: false }];
    const on = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(fx)))['card.json']!));
    expect(on.front.layers[1].breakout).toBe(true);
    const off = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(withFalse)))['card.json']!));
    expect('breakout' in off.front.layers[1]).toBe(false);
  });

  it('匯入：true／false 都收（舊卡沒有這個欄位也收），匯入後原樣', async () => {
    const fx = await simpleFixture();
    for (const v of [true, false]) {
      const card = { ...fx.card, front: { layers: [fx.card.front.layers[0]!, { ...fx.card.front.layers[1]!, breakout: v }] } };
      const result = await importOf(holocard(card, fx.files));
      if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
      expect(result.card.front.layers[1]!.breakout).toBe(v);
    }
  });

  it('匯入壞值：字串、數字、底圖帶 breakout → invalid-card', async () => {
    const fx = await simpleFixture();
    const [base, hero] = fx.card.front.layers;
    for (const v of ['true', 1, null]) {
      const result = await importOf(holocard({ ...fx.card, front: { layers: [base, { ...hero, breakout: v }] } }, fx.files));
      expect(reason(result), String(v)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/breakout/);
    }
    for (const v of [true, false]) {
      const result = await importOf(holocard({ ...fx.card, front: { layers: [{ ...base, breakout: v }, hero] } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/breakout/);
    }
  });
});

// ---------------------------------------------------------------- 線稿高光（T-802）

describe('線稿高光 lineart（T-802，SCHEMA §1、§4）', () => {
  it('匯出：true 照寫；明寫的 false 不寫出（和 breakout 一樣）', async () => {
    const fx = await simpleFixture();
    fx.card.front.layers = [fx.card.front.layers[0]!, { ...fx.card.front.layers[1]!, lineart: true }];
    const withFalse = await simpleFixture();
    withFalse.card.front.layers = [withFalse.card.front.layers[0]!, { ...withFalse.card.front.layers[1]!, lineart: false }];
    const on = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(fx)))['card.json']!));
    expect(on.front.layers[1].lineart).toBe(true);
    const off = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(withFalse)))['card.json']!));
    expect('lineart' in off.front.layers[1]).toBe(false);
  });

  it('匯入：true／false 都收（舊卡沒有這個欄位也收），匯入後原樣', async () => {
    const fx = await simpleFixture();
    for (const v of [true, false]) {
      const card = { ...fx.card, front: { layers: [fx.card.front.layers[0]!, { ...fx.card.front.layers[1]!, lineart: v }] } };
      const result = await importOf(holocard(card, fx.files));
      if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
      expect(result.card.front.layers[1]!.lineart).toBe(v);
    }
  });

  it('匯入壞值：字串、數字、底圖或文字層帶 lineart → invalid-card', async () => {
    const fx = await simpleFixture();
    const [base, hero] = fx.card.front.layers;
    for (const v of ['true', 1, null]) {
      const result = await importOf(holocard({ ...fx.card, front: { layers: [base, { ...hero, lineart: v }] } }, fx.files));
      expect(reason(result), String(v)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/lineart/);
    }
    for (const v of [true, false]) {
      const result = await importOf(holocard({ ...fx.card, front: { layers: [{ ...base, lineart: v }, hero] } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/lineart/);
    }
    const text = { content: '月', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
    const result = await importOf(holocard({ ...fx.card, front: { layers: [base, { ...hero, text, lineart: true }] } }, fx.files));
    expect(reason(result)).toBe('invalid-card');
    expect(!result.ok && result.detail).toMatch(/lineart/);
  });
});

// ---------------------------------------------------------------- 剪裁遮色片（T-803）

describe('剪裁遮色片 clip（T-803，SCHEMA §1、§4）', () => {
  /** 正面：底圖、hero、剪裁到 hero 的花紋（同一張圖，depth 跟 hero 一樣）。 */
  async function clipFixture(clip: unknown): Promise<Fixture> {
    const fx = await simpleFixture();
    const [base, hero] = fx.card.front.layers;
    fx.card.front.layers = [base!, hero!, { ...hero!, id: 'pattern', name: '花紋', clip } as never];
    return fx;
  }

  it('匯出：true 照寫；明寫的 false 不寫出（和 breakout 一樣）', async () => {
    const on = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(await clipFixture(true))))['card.json']!));
    expect(on.front.layers[2].clip).toBe(true);
    const off = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(await clipFixture(false))))['card.json']!));
    expect('clip' in off.front.layers[2]).toBe(false);
  });

  it('匯入：true／false 都收（舊卡沒有這個欄位也收），匯入後原樣', async () => {
    for (const v of [true, false]) {
      const fx = await clipFixture(v);
      const result = await importOf(holocard(fx.card, fx.files));
      if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
      expect(result.card.front.layers[2]!.clip).toBe(v);
    }
    const old = await simpleFixture();
    const result = await importOf(holocard(old.card, old.files));
    expect(result.ok && result.card.front.layers.every((l) => !('clip' in l))).toBe(true);
  });

  it('匯入：剪裁層的 depth 和下面那層不一樣（別的程式改過）→ 不擋檔，讀進來就對齊下面那層（T-803b）', async () => {
    const fx = await clipFixture(true);
    const hero = fx.card.front.layers[1]!;
    fx.card.front.layers[2] = { ...fx.card.front.layers[2]!, depth: Math.min(100, hero.depth + 7) };
    const result = await importOf(holocard(fx.card, fx.files));
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card.front.layers[2]!.depth).toBe(result.card.front.layers[1]!.depth);
    expect(result.card.front.layers[2]!.id).toBe('pattern');
  });

  it('匯入壞值：字串、數字、底圖帶 clip → invalid-card', async () => {
    for (const v of ['true', 1, null]) {
      const fx = await clipFixture(v);
      const result = await importOf(holocard(fx.card, fx.files));
      expect(reason(result), String(v)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/clip/);
    }
    const fx = await simpleFixture();
    const [base, hero] = fx.card.front.layers;
    for (const v of [true, false]) {
      const result = await importOf(holocard({ ...fx.card, front: { layers: [{ ...base, clip: v }, hero] } }, fx.files));
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/clip/);
    }
  });
});

// ---------------------------------------------------------------- 卡片故事（T-804）

describe('卡片故事 story（T-804，SCHEMA §1、§4）', () => {
  const STORY = { text: '一輪明月照星海\n龍鱗映出遠古的光', font: 'notoserif' as const };

  it('匯出：故事照寫（文字、字型、換行都在）；沒有故事的卡不寫這個欄位', async () => {
    const fx = await simpleFixture();
    fx.card = { ...fx.card, story: STORY };
    const json = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(fx)))['card.json']!));
    expect(json.story).toEqual(STORY);
    const plain = await simpleFixture();
    const none = JSON.parse(strFromU8(unzipSync(await blobBytes(await exportFixture(plain)))['card.json']!));
    expect('story' in none).toBe(false);
  });

  it('匯出入來回：故事原樣回來；舊卡（沒有 story）照樣匯入、匯入後也沒有', async () => {
    const fx = await simpleFixture();
    fx.card = { ...fx.card, story: STORY };
    const back = await importOf(await exportFixture(fx));
    if (!back.ok) throw new Error(`${back.reason} ${back.detail}`);
    expect(back.card.story).toEqual(STORY);
    const old = await simpleFixture();
    const result = await importOf(holocard(old.card, old.files));
    expect(result.ok && !('story' in result.card)).toBe(true);
  });

  it('匯入壞值：空的、三行、超過 60 字、字型不認得、多欄位 → invalid-card', async () => {
    const fx = await simpleFixture();
    const bad = [
      { text: '   ', font: 'wenkai' },
      { text: '一\n二\n三', font: 'wenkai' },
      { text: '星'.repeat(61), font: 'wenkai' },
      { text: '一輪明月', font: 'comic' },
      { text: '一輪明月', font: 'wenkai', html: '<b>x</b>' },
      '一輪明月',
      null,
    ];
    for (const story of bad) {
      const result = await importOf(holocard({ ...fx.card, story }, fx.files));
      expect(reason(result), JSON.stringify(story)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/story/);
    }
  });
});
