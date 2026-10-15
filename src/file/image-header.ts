// 從檔頭讀圖片格式、長寬、有沒有宣告透明，不解碼（SCHEMA.md §4 第 4 條：解碼前確認長寬）。
// 輸入是不可信資料：任何欄位都可能是假的，讀不懂或互相矛盾就回 null；長寬上限由呼叫端判斷。
// 往後掃區塊的圈數有上限（MAX_SCAN_CHUNKS）：幾百萬個空區塊不會讓這裡跑很久，超過就當成壞圖。
import type { StoredImageType } from '../images/types';

export interface ImageHeader {
  type: StoredImageType;
  width: number;
  height: number;
  /**
   * 檔頭宣告有透明：PNG 的 color type 4／6 或有 tRNS；WebP 的 VP8X alpha 旗標或 VP8L 的 alpha 位元。
   * VP8（有損、沒有 VP8X）一定是 false。只看宣告，不檢查實際像素。
   */
  hasAlpha: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 簽名 8＋IHDR 區塊（長度 4、類型 4、資料 13、CRC 4）。 */
const PNG_HEADER_LENGTH = 33;
const PNG_COLOR_TYPES = [0, 2, 3, 4, 6];
/** IHDR／VP8X 之後最多看幾個區塊（含停下來的那個 IDAT／VP8／VP8L）；超過就拒絕（SCHEMA §4 第 4 條）。 */
const MAX_SCAN_CHUNKS = 64;
/** VP8X 旗標。 */
const VP8X_ALPHA = 0x10;
const VP8X_ANIMATION = 0x02;

function u16le(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}

function u24le(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
}

function u32le(b: Uint8Array, at: number): number {
  return (u24le(b, at) | (b[at + 3]! << 24)) >>> 0;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
}

function readPng(b: Uint8Array): ImageHeader | null {
  if (b.length < PNG_HEADER_LENGTH || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return null;
  if (u32be(b, 8) !== 13 || fourcc(b, 12) !== 'IHDR') return null;
  const colorType = b[25]!;
  if (!PNG_COLOR_TYPES.includes(colorType)) return null;
  let hasAlpha = colorType === 4 || colorType === 6;
  // tRNS、acTL 規定在第一個 IDAT 之前，所以一路掃到 IDAT（color type 4／6 也要掃，才看得到 acTL）；
  // 每圈至少前進 12 位元組，區塊長度造假只會提早跳出；圈數有上限
  for (let at = PNG_HEADER_LENGTH, scanned = 0; at + 8 <= b.length; ) {
    if (++scanned > MAX_SCAN_CHUNKS) return null;
    const type = fourcc(b, at + 4);
    if (type === 'acTL') return null; // 動畫 PNG（APNG）
    if (type === 'tRNS') hasAlpha = true;
    else if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + u32be(b, at);
  }
  return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20), hasAlpha };
}

interface Chunk {
  type: string;
  size: number;
  /** 資料起點。 */
  data: number;
  /** 下一個區塊的起點（資料長度是奇數時有一個補齊位元組）。 */
  next: number;
}

function chunkAt(b: Uint8Array, at: number, end: number): Chunk | null {
  if (at + 8 > end) return null;
  const size = u32le(b, at + 4);
  const data = at + 8;
  if (data + size > end) return null;
  return { type: fourcc(b, at), size, data, next: data + size + (size & 1) };
}

/** VP8 關鍵幀：幀標記 3 位元組（bit 0＝0 是關鍵幀）、起始碼 9d 01 2a、14 位元的長寬。 */
function readVp8(b: Uint8Array, c: Chunk): { width: number; height: number } | null {
  if (c.size < 10) return null;
  const d = c.data;
  if (b[d]! & 1) return null;
  if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
  return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
}

/** VP8L：簽名 0x2f，之後 (寬-1) 14 位元、(高-1) 14 位元、alpha 1 位元、版本 3 位元（要是 0）。 */
function readVp8l(b: Uint8Array, c: Chunk): { width: number; height: number; alpha: boolean } | null {
  if (c.size < 5 || b[c.data] !== 0x2f) return null;
  const bits = u32le(b, c.data + 1);
  if (bits >>> 29 !== 0) return null;
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
}

function readWebp(b: Uint8Array): ImageHeader | null {
  if (b.length < 20 || fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') return null;
  const end = 8 + u32le(b, 4);
  if (end > b.length) return null;
  const first = chunkAt(b, 12, end);
  if (!first) return null;

  if (first.type === 'VP8 ') {
    const size = readVp8(b, first);
    return size && { type: 'image/webp', ...size, hasAlpha: false };
  }
  if (first.type === 'VP8L') {
    const info = readVp8l(b, first);
    return info && { type: 'image/webp', width: info.width, height: info.height, hasAlpha: info.alpha };
  }
  if (first.type !== 'VP8X' || first.size < 10) return null;

  const flags = b[first.data]!;
  if (flags & VP8X_ANIMATION) return null;
  const width = u24le(b, first.data + 4) + 1;
  const height = u24le(b, first.data + 7) + 1;
  // 跳過 ICCP、ALPH、EXIF 等區塊，找到真正的圖：長寬要和畫布一樣（不讓小畫布藏大圖）
  for (let at = first.next, scanned = 0; at < end; ) {
    if (++scanned > MAX_SCAN_CHUNKS) return null;
    const c = chunkAt(b, at, end);
    if (!c || c.type === 'ANIM' || c.type === 'ANMF') return null;
    if (c.type === 'VP8 ' || c.type === 'VP8L') {
      const inner = c.type === 'VP8 ' ? readVp8(b, c) : readVp8l(b, c);
      if (!inner || inner.width !== width || inner.height !== height) return null;
      return { type: 'image/webp', width, height, hasAlpha: (flags & VP8X_ALPHA) !== 0 };
    }
    at = c.next;
  }
  return null;
}

/** 讀檔頭：PNG 或 WebP（靜態）；其他格式、截斷、欄位互相矛盾 → null。長寬照檔頭寫的回傳，上限由呼叫端檢查。 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  return readPng(bytes) ?? readWebp(bytes);
}
