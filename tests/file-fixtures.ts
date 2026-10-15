// .holocard 測試共用的小工具（不是測試檔，vitest 不會直接執行）：
// 自己用位元組組出 PNG／WebP 檔頭與 zip，才能做出壞掉、造假、炸彈這些「正常程式做不出來」的檔。
import { deflateSync, zlibSync } from 'fflate';
import { crc32 } from '../src/file/zip-read';
import { hashBytes } from '../src/images/hash';
import type { StoredImage, StoredImageType } from '../src/images/types';

type Bytes = Uint8Array | readonly number[];

export function concat(parts: readonly Bytes[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 把 unit 重複 n 次接成一段（幾百萬個小區塊用 concat 太慢）。 */
export function repeat(unit: Bytes, n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(unit.length * n);
  for (let i = 0; i < n; i++) out.set(unit, i * unit.length);
  return out;
}

export const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
export const u16le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
export const u24le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
export const u32le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
export const u32be = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

// ---- PNG ----

export interface PngSpec {
  width?: number;
  height?: number;
  /** 0 灰階、2 RGB、3 調色盤、4 灰階＋alpha、6 RGBA。 */
  colorType?: 0 | 2 | 3 | 4 | 6;
  /** 加一個 tRNS 區塊（宣告有透明色）。 */
  trns?: boolean;
  /** 0～255：讓每張圖內容不同（雜湊不同）。 */
  seed?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;

export function pngChunk(type: string, data: Bytes): Uint8Array<ArrayBuffer> {
  const body = concat([ascii(type), data]);
  return concat([u32be(data.length), body, u32be(crc32(body))]);
}

/** 在 PNG 的 IHDR 之後（第一個 IDAT 之前）塞進區塊。 */
export function withPngChunks(png: Uint8Array, ...chunks: Bytes[]): Uint8Array<ArrayBuffer> {
  return concat([png.subarray(0, 33), ...chunks, png.subarray(33)]);
}

/** 長寬 ≤ 8 時是真的能解碼的 PNG；更大的只有檔頭是對的（匯入不解碼，夠用）。 */
export function makePng({ width = 4, height = 4, colorType = 6, trns = false, seed = 0 }: PngSpec = {}): Uint8Array<ArrayBuffer> {
  const cols = Math.min(width, 8);
  const rows = Math.min(height, 8);
  const stride = 1 + cols * CHANNELS[colorType];
  const raw = new Uint8Array(rows * stride).fill(seed & 0xff);
  for (let r = 0; r < rows; r++) raw[r * stride] = 0; // 每行的濾波類型 0
  return concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', concat([u32be(width), u32be(height), [8, colorType, 0, 0, 0]])),
    colorType === 3 ? pngChunk('PLTE', [0, 0, 0, 255, 255, 255]) : [],
    trns ? pngChunk('tRNS', [0]) : [],
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', []),
  ]);
}

// ---- WebP ----

export interface WebpSpec {
  /** lossy＝VP8（沒有透明）、lossless＝VP8L、extended＝VP8X＋內層圖。 */
  kind?: 'lossy' | 'lossless' | 'extended';
  width?: number;
  height?: number;
  /** lossless：VP8L 的 alpha 位元；extended：VP8X 的 alpha 旗標。 */
  alpha?: boolean;
  seed?: number;
  /** extended 的內層格式與長寬（預設和畫布一樣）。 */
  inner?: 'lossy' | 'lossless';
  innerWidth?: number;
  innerHeight?: number;
  /** extended：VP8X 的動畫旗標。 */
  animated?: boolean;
  /** 不放內層圖（只有 VP8X）。 */
  noInner?: boolean;
}

export function riffChunk(type: string, data: Bytes): Uint8Array<ArrayBuffer> {
  return concat([ascii(type), u32le(data.length), data, data.length % 2 ? [0] : []]);
}

/** VP8X 區塊（資料 10 位元組：旗標 4、畫布寬-1 三位元組、畫布高-1 三位元組）。 */
export function vp8x(flags: number, width: number, height: number): Uint8Array<ArrayBuffer> {
  return riffChunk('VP8X', concat([[flags, 0, 0, 0], u24le(width - 1), u24le(height - 1)]));
}

/** VP8 關鍵幀：3 位元組幀標記（關鍵幀、顯示）＋起始碼 9d 01 2a＋14 位元長寬＋假的壓縮資料。 */
export function vp8(width: number, height: number, seed = 0): Uint8Array<ArrayBuffer> {
  return concat([[0x10, 0x02, 0x00], [0x9d, 0x01, 0x2a], u16le(width & 0x3fff), u16le(height & 0x3fff), new Uint8Array(8).fill(seed & 0xff)]);
}

/** VP8L：簽名 0x2f＋(寬-1) 14 位元、(高-1) 14 位元、alpha 1 位元、版本 3 位元。 */
export function vp8l(width: number, height: number, alpha: boolean, seed = 0, version = 0): Uint8Array<ArrayBuffer> {
  const bits = (((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28) | (version << 29)) >>> 0;
  return concat([[0x2f], u32le(bits), new Uint8Array(8).fill(seed & 0xff)]);
}

export function riff(chunks: Bytes): Uint8Array<ArrayBuffer> {
  const body = concat([ascii('WEBP'), chunks]);
  return concat([ascii('RIFF'), u32le(body.length), body]);
}

export function makeWebp(spec: WebpSpec = {}): Uint8Array<ArrayBuffer> {
  const { kind = 'lossy', width = 4, height = 4, alpha = false, seed = 0, inner = 'lossy', animated = false, noInner = false } = spec;
  const innerWidth = spec.innerWidth ?? width;
  const innerHeight = spec.innerHeight ?? height;
  if (kind === 'lossy') return riff(riffChunk('VP8 ', vp8(width, height, seed)));
  if (kind === 'lossless') return riff(riffChunk('VP8L', vp8l(width, height, alpha, seed)));
  const flags = (alpha ? 0x10 : 0) | (animated ? 0x02 : 0);
  const header = riffChunk('VP8X', concat([[flags, 0, 0, 0], u24le(width - 1), u24le(height - 1)]));
  if (noInner) return riff(header);
  const body =
    inner === 'lossy'
      ? concat([alpha ? riffChunk('ALPH', [0, seed & 0xff]) : [], riffChunk('VP8 ', vp8(innerWidth, innerHeight, seed))])
      : riffChunk('VP8L', vp8l(innerWidth, innerHeight, alpha, seed));
  return riff(concat([header, body]));
}

/** 位元組＋檔頭宣告的資訊 → 存得進資料庫的圖（雜湊照實算）。 */
export async function stored(
  bytes: Uint8Array<ArrayBuffer>,
  type: StoredImageType,
  width: number,
  height: number,
  hasAlpha: boolean,
): Promise<StoredImage> {
  return { hash: await hashBytes(bytes), blob: new Blob([bytes], { type }), type, width, height, hasAlpha };
}

// ---- zip ----

export interface ZipItem {
  name: string | Uint8Array;
  data?: Uint8Array;
  /** 0＝不壓縮、8＝DEFLATE（預設）；其他值用來測「不支援的壓縮法」。 */
  method?: number;
  /** 直接給壓縮後的資料（例如炸彈）；沒給就用 deflateSync(data)。 */
  compressed?: Uint8Array;
  /** 本地檔頭與中央目錄宣告的解壓大小（預設照實）。 */
  size?: number;
  crc?: number;
  flags?: number;
  /** 本地檔頭裡的檔名（預設和中央目錄一樣）。 */
  localName?: string;
  /** 中央目錄裡記的本地檔頭位置（預設照實；用來做「兩個檔指到同一份資料」）。 */
  offset?: number;
  /** 中央目錄這一筆的 extra 欄位內容（本地檔頭沒有）；用來把東西藏進中央目錄裡。 */
  extra?: Uint8Array;
}

export interface ZipShape {
  /** EOCD 宣告的檔案數（預設照實）。 */
  count?: number;
  /** EOCD 的「這是第幾片」（分割壓縮檔）。 */
  disk?: number;
  /** EOCD 之後再接的位元組。 */
  trailing?: Uint8Array;
}

/** 照 PKZIP 格式組 zip：本地檔頭＋資料、中央目錄、EOCD。所有欄位都可以造假。 */
export function buildZip(items: readonly ZipItem[], shape: ZipShape = {}): Uint8Array<ArrayBuffer> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const item of items) {
    const name = typeof item.name === 'string' ? utf8(item.name) : item.name;
    const localName = item.localName === undefined ? name : utf8(item.localName);
    const data = item.data ?? new Uint8Array(0);
    const method = item.method ?? 8;
    const body = item.compressed ?? (method === 8 ? deflateSync(data) : data);
    const size = item.size ?? data.length;
    const crc = item.crc ?? crc32(data);
    const flags = item.flags ?? 0x0800;
    const extra = item.extra ?? new Uint8Array(0);
    // 旗標、壓縮法、時間、日期、CRC、壓縮後大小、解壓大小、檔名長度、extra 長度（本地與中央目錄共用這 24 位元組）
    const fields = (n: Uint8Array, extraLength: number): Uint8Array =>
      concat([u16le(flags), u16le(method), u16le(0), u16le(0x21), u32le(crc), u32le(body.length), u32le(size), u16le(n.length), u16le(extraLength)]);
    const local = concat([u32le(0x04034b50), u16le(20), fields(localName, 0), localName, body]);
    const central = concat([
      u32le(0x02014b50),
      u16le(20),
      u16le(20),
      fields(name, extra.length),
      u16le(0), // 註解長度
      u16le(0), // 從第幾片開始
      u16le(0),
      u32le(0),
      u32le(item.offset ?? offset),
      name,
      extra,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = concat(centrals);
  const count = shape.count ?? items.length;
  const disk = shape.disk ?? 0;
  const end = concat([u32le(0x06054b50), u16le(disk), u16le(disk), u16le(count), u16le(count), u32le(directory.length), u32le(offset), u16le(0)]);
  return concat([...locals, directory, end, shape.trailing ?? []]);
}

/**
 * zip 炸彈用的 DEFLATE 串流：固定霍夫曼區塊，一個字面 0x00 之後一直重複「長度 258、距離 1」，
 * 解開來是 n 個（向下取到 1＋258k）0x00。每 258 位元組只要 13 位元，壓縮比約 159 倍。
 */
export function zeroBomb(n: number): Uint8Array<ArrayBuffer> {
  const repeats = Math.floor((n - 1) / 258);
  const out = new Uint8Array(Math.ceil((3 + 8 + repeats * 13 + 7) / 8));
  let pos = 0;
  const bit = (b: number): void => {
    if (b) out[pos >> 3] |= 1 << (pos & 7);
    pos += 1;
  };
  // 霍夫曼碼由最高位元開始寫
  const code = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bit((value >> i) & 1);
  };
  bit(1); // BFINAL
  bit(1); // BTYPE＝01（固定霍夫曼），低位元先寫
  bit(0);
  code(0x30, 8); // 字面 0
  for (let r = 0; r < repeats; r++) {
    code(0xc5, 8); // 長度碼 285＝258
    code(0, 5); // 距離碼 0＝1
  }
  code(0, 7); // 區塊結束 256
  return out;
}

/** zeroBomb(n) 實際解出來的長度。 */
export function zeroBombSize(n: number): number {
  return 1 + Math.floor((n - 1) / 258) * 258;
}
