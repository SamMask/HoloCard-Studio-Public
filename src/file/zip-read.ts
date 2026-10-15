// 讀不可信的 zip（SCHEMA.md §4）。只信中央目錄，逐一核對本地檔頭；解壓時一邊解一邊數位元組，
// 超過上限立刻中止（宣告的大小可能是假的）。只支援「不壓縮」與 DEFLATE；加密、分割壓縮檔都當成壞掉；
// ZIP64 的特徵值（大小 0xffffffff、檔案數 0xffff）會先被大小與檔案數上限擋下，回 too-large。
// 這裡不管檔名合不合法（白名單由呼叫端決定），也不寫入任何地方。
import { Inflate } from 'fflate';

export type ZipFailReason = 'too-large' | 'bad-zip';

/** 讀 zip 失敗：reason 給呼叫端對應成畫面訊息；message 是給開發者看的英文說明。 */
export class ZipError extends Error {
  readonly reason: ZipFailReason;
  constructor(reason: ZipFailReason, message: string) {
    super(message);
    this.name = 'ZipError';
    this.reason = reason;
  }
}

export interface ZipLimits {
  /** 最多幾個檔。 */
  maxEntries: number;
  /** 單檔解壓後最多幾個位元組（宣告的與實際解出來的都算）。 */
  maxEntryBytes: number;
  /** 全部解壓後加起來最多幾個位元組（宣告的與實際解出來的都算）。 */
  maxTotalBytes: number;
  /**
   * 個別檔名的單檔上限（和 maxEntryBytes 取較小的）；回 undefined 就只用 maxEntryBytes。
   * 宣告的與實際解出來的都算；例如 card.json 只准 1 MB，不然 JSON.parse 會卡住。
   */
  entryMaxBytes?: (name: string) => number | undefined;
  /**
   * 檔名最多幾個位元組。更長的名字在轉成字串**之前**就換成短的代號（內容不再是原本的名字，
   * 呼叫端的白名單一定不認得它，之後也解不出來），所以惡意的長檔名不會變成大字串。沒給就不限。
   */
  maxNameBytes?: number;
}

/** 中央目錄裡的一筆（還沒解壓）。 */
export interface ZipEntry {
  /**
   * 檔名的原始位元組逐一轉成字元（latin1）：非 ASCII 的名字不會被解讀成別的 ASCII 名字。
   * 超過 maxNameBytes 的名字不轉換，這裡是短的代號（見 ZipLimits.maxNameBytes）。
   */
  name: string;
  /** 0＝不壓縮、8＝DEFLATE。 */
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  /** 宣告的解壓後大小（可能是假的）。 */
  size: number;
  /** 本地檔頭的位置。 */
  headerOffset: number;
}

export interface ZipListing {
  entries: ZipEntry[];
  /** 中央目錄的起點：每個檔的本地檔頭與資料都要在它前面。 */
  directoryOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_LENGTH = 22;
const CENTRAL_LENGTH = 46;
const LOCAL_LENGTH = 30;
/** EOCD 之後的註解最長幾個位元組（往回找 EOCD 的範圍）。 */
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATE = 8;
/** 旗標：bit 0 加密、bit 6 強加密。 */
const ENCRYPTED = 0x0041;
/** 旗標 bit 3：CRC 與大小寫在資料後面（data descriptor），本地檔頭的這三欄可能是 0。 */
const DATA_DESCRIPTOR = 0x0008;
/**
 * 每次餵給解壓器多少壓縮資料。DEFLATE 最大壓縮比約 1032 倍，所以每餵一次最多多解出約 16 MB，
 * 超過上限時最多只多配置這麼多記憶體就會停下。
 */
const INFLATE_CHUNK = 16 * 1024;

function u16(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

/** 檔名放進錯誤訊息前：截短、跳脫控制字元。 */
function show(name: string): string {
  return JSON.stringify(name.length > 80 ? `${name.slice(0, 80)}…` : name);
}

/** 這個檔名的單檔上限：一般上限和 entryMaxBytes 取較小的。 */
function capOf(name: string, limits: ZipLimits): number {
  return Math.min(limits.maxEntryBytes, limits.entryMaxBytes?.(name) ?? Infinity);
}

function broken(message: string): ZipError {
  return new ZipError('bad-zip', message);
}

function tooLarge(message: string): ZipError {
  return new ZipError('too-large', message);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** zip 用的 CRC-32（IEEE）。 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 從尾巴往回找 EOCD；它的註解長度要剛好接到檔尾（尾巴多出東西或被截斷都算壞掉）。 */
function findEnd(bytes: Uint8Array): number {
  const last = bytes.length - EOCD_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let at = last; at >= first; at--) {
    if (u32(bytes, at) === EOCD_SIGNATURE && at + EOCD_LENGTH + u16(bytes, at + 20) === bytes.length) return at;
  }
  throw broken('end of central directory not found (not a zip, or truncated)');
}

/**
 * 解壓前：讀中央目錄，用宣告的數字擋掉太多檔、太大的檔（SCHEMA §4 第 1 條）。
 * 檔案數在讀每一筆之前就檢查；每讀一筆就檢查單檔與累計的宣告大小。
 */
export function listZip(bytes: Uint8Array, limits: ZipLimits): ZipListing {
  const end = findEnd(bytes);
  const count = u16(bytes, end + 10);
  if (u16(bytes, end + 4) !== 0 || u16(bytes, end + 6) !== 0 || u16(bytes, end + 8) !== count) {
    throw broken('split (multi-disk) archives are not supported');
  }
  if (count > limits.maxEntries) throw tooLarge(`${count} entries > ${limits.maxEntries}`);
  const directorySize = u32(bytes, end + 12);
  const start = u32(bytes, end + 16);
  const stop = start + directorySize;
  if (stop > end) throw broken('central directory is out of range');

  const entries: ZipEntry[] = [];
  let declared = 0;
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_LENGTH > stop || u32(bytes, at) !== CENTRAL_SIGNATURE) throw broken(`central directory entry ${i} is broken`);
    const nameLength = u16(bytes, at + 28);
    const next = at + CENTRAL_LENGTH + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    if (next > stop) throw broken(`central directory entry ${i} is out of range`);
    const tooLong = limits.maxNameBytes !== undefined && nameLength > limits.maxNameBytes;
    const entry: ZipEntry = {
      name: tooLong ? `<name of ${nameLength} bytes>` : latin1(bytes.subarray(at + CENTRAL_LENGTH, at + CENTRAL_LENGTH + nameLength)),
      flags: u16(bytes, at + 8),
      method: u16(bytes, at + 10),
      crc: u32(bytes, at + 16),
      compressedSize: u32(bytes, at + 20),
      size: u32(bytes, at + 24),
      headerOffset: u32(bytes, at + 42),
    };
    const cap = capOf(entry.name, limits);
    if (entry.size > cap) throw tooLarge(`${show(entry.name)} declares ${entry.size} bytes > ${cap}`);
    declared += entry.size;
    if (declared > limits.maxTotalBytes) throw tooLarge(`entries declare ${declared} bytes in total > ${limits.maxTotalBytes}`);
    if (u16(bytes, at + 34) !== 0) throw broken(`${show(entry.name)} starts on another disk`);
    if (entry.flags & ENCRYPTED) throw broken(`${show(entry.name)} is encrypted`);
    if (entry.method !== STORED && entry.method !== DEFLATE) throw broken(`${show(entry.name)} uses unsupported compression ${entry.method}`);
    entries.push(entry);
    at = next;
  }
  if (at !== stop) throw broken('central directory size does not match its entries');
  return { entries, directoryOffset: start };
}

interface Span {
  headerStart: number;
  dataStart: number;
  dataEnd: number;
}

/** 核對本地檔頭和中央目錄一致，回傳資料的範圍。 */
function locate(bytes: Uint8Array, entry: ZipEntry, limit: number): Span {
  const at = entry.headerOffset;
  if (at + LOCAL_LENGTH > limit || u32(bytes, at) !== LOCAL_SIGNATURE) throw broken(`${show(entry.name)}: local header not found`);
  const flags = u16(bytes, at + 6);
  const nameLength = u16(bytes, at + 26);
  const dataStart = at + LOCAL_LENGTH + nameLength + u16(bytes, at + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > limit) throw broken(`${show(entry.name)}: data is out of range`);
  if (u16(bytes, at + 8) !== entry.method || latin1(bytes.subarray(at + LOCAL_LENGTH, at + LOCAL_LENGTH + nameLength)) !== entry.name) {
    throw broken(`${show(entry.name)}: local header does not match the central directory`);
  }
  if (!(flags & DATA_DESCRIPTOR) && (u32(bytes, at + 14) !== entry.crc || u32(bytes, at + 18) !== entry.compressedSize || u32(bytes, at + 22) !== entry.size)) {
    throw broken(`${show(entry.name)}: local header sizes do not match the central directory`);
  }
  return { headerStart: at, dataStart, dataEnd };
}

/** DEFLATE 串流解壓，一邊解一邊數：超過 budget 立刻中止（不先整個解完）。 */
function inflateLimited(src: Uint8Array, budget: number, name: string): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > budget) throw tooLarge(`${show(name)} inflates past ${budget} bytes`);
    chunks.push(chunk);
  });
  try {
    let at = 0;
    do {
      const next = Math.min(src.length, at + INFLATE_CHUNK);
      inflater.push(src.subarray(at, next), next === src.length);
      at = next;
    } while (at < src.length);
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw broken(`${show(name)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 解壓 listZip 列出的每個檔（順序相同）。先核對所有本地檔頭、檔與檔不能重疊，
 * 再逐一解壓：實際大小超過單檔上限或累計超過總量上限 → too-large；
 * 實際大小和宣告不同、CRC 不符、DEFLATE 資料壞掉 → bad-zip。
 */
export function extractZip(bytes: Uint8Array, listing: ZipListing, limits: ZipLimits): Uint8Array<ArrayBuffer>[] {
  const spans = listing.entries.map((entry) => locate(bytes, entry, listing.directoryOffset));
  // 重疊＝同一份資料被當成好幾個檔（另一種 zip 炸彈手法）
  const sorted = [...spans].sort((a, b) => a.headerStart - b.headerStart);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.headerStart < sorted[i - 1]!.dataEnd) throw broken('entries overlap');
  }
  let used = 0;
  return listing.entries.map((entry, i) => {
    const span = spans[i]!;
    const data = bytes.subarray(span.dataStart, span.dataEnd);
    const budget = Math.min(capOf(entry.name, limits), limits.maxTotalBytes - used);
    let out: Uint8Array<ArrayBuffer>;
    if (entry.method === STORED) {
      if (data.length > budget) throw tooLarge(`${show(entry.name)} is ${data.length} bytes > ${budget}`);
      out = data.slice();
    } else {
      out = inflateLimited(data, budget, entry.name);
    }
    if (out.length !== entry.size) throw broken(`${show(entry.name)}: ${out.length} bytes, but ${entry.size} declared`);
    if (crc32(out) !== entry.crc) throw broken(`${show(entry.name)}: CRC mismatch`);
    used += out.length;
    return out;
  });
}
