// 卡片檔 `.holocard` 匯出入（SCHEMA.md §4；契約在 ./types）。只負責打包與「檢查＋拆包」，不碰資料庫與畫面。
// 匯入的檔是不可信資料（硬邊界 4）：照 §4 的順序全部檢查通過才回傳，任何一條不過就回失敗原因、不回部分結果。
import { zipSync, type Zippable } from 'fflate';
import { hashBytes } from '../images/hash';
import { MAX_EDGE_PX, type StoredImage, type StoredImageType } from '../images/types';
import { alignClipDepths, omitCardDefaults } from '../model/actions';
import { cardImages, migrateCard } from '../model/foil';
import type { Card } from '../model/types';
import { validateCard } from '../model/validate';
import { readImageHeader, type ImageHeader } from './image-header';
import { HOLOCARD_MIME, type ExportHolocard, type ImportError, type ImportHolocard } from './types';
import { ZipError, extractZip, listZip, type ZipLimits, type ZipListing } from './zip-read';

const MB = 1024 * 1024;
/** 壓縮檔本身的上限（§4 第 1 條）。先看 Blob.size，超過就不讀進記憶體。 */
export const MAX_HOLOCARD_BYTES = 200 * MB;
/** card.json 的上限（§4 第 1 條）：合法的卡片不到 64 KB；再大 JSON.parse 會卡住、吃掉大量記憶體。 */
const MAX_CARD_JSON_BYTES = 1 * MB;
/** 檔名最多幾個位元組（§4 第 2 條）：合法的最長 28。 */
const MAX_NAME_BYTES = 64;

const CARD_PATH = 'card.json';
const PREVIEW_PATH = 'preview.png';

/** 解壓的上限（§4 第 1 條）：1 個 card.json＋最多 16 張圖＋preview；單檔 30 MB（card.json 只准 1 MB）、總量 300 MB。 */
export const HOLOCARD_ZIP_LIMITS: ZipLimits = {
  maxEntries: 18,
  maxEntryBytes: 30 * MB,
  maxTotalBytes: 300 * MB,
  entryMaxBytes: (name) => (name === CARD_PATH ? MAX_CARD_JSON_BYTES : undefined),
  maxNameBytes: MAX_NAME_BYTES,
};
/** 程式支援的最新 formatVersion。 */
const SUPPORTED_VERSION = 1;

/** 圖的路徑（§4 第 2 條）：雜湊是 16 碼小寫十六進位，副檔名只有小寫 webp／png。 */
const IMAGE_PATH = /^images\/([0-9a-f]{16})\.(webp|png)$/;
const EXTENSION: Record<StoredImageType, string> = { 'image/webp': 'webp', 'image/png': 'png' };
const TYPE_OF_EXTENSION: Record<string, StoredImageType> = { webp: 'image/webp', png: 'image/png' };
/** 圖已經壓縮過，不再壓；card.json 是文字，壓起來小很多。 */
const STORE = { level: 0 } as const;
const COMPRESS = { level: 6 } as const;

class ImportFail extends Error {
  readonly reason: ImportError;
  constructor(reason: ImportError, message: string) {
    super(message);
    this.name = 'ImportFail';
    this.reason = reason;
  }
}

function fail(reason: ImportError, detail: string): never {
  throw new ImportFail(reason, detail);
}

/** 卡片用到的圖（不重複，先正面後背面；反光層的黑白圖也算，T-417）。只用在已通過 validateCard 的卡。 */
function usedImages(card: Card): string[] {
  return cardImages(card);
}

function edgeOk(n: number): boolean {
  return n >= 1 && n <= MAX_EDGE_PX;
}

/** 檔頭是 expected 類型、長寬 1～2048、檔案大小 ≤ 寬×高×4＋1 MB（防止小圖塞幾十 MB 的附加區塊）；不合格 → bad-image。 */
function checkHeader(bytes: Uint8Array, expected: StoredImageType, label: string): ImageHeader {
  const header = readImageHeader(bytes);
  if (!header) fail('bad-image', `${label}: not a still WebP or PNG`);
  if (header.type !== expected) fail('bad-image', `${label}: content is ${header.type}, expected ${expected}`);
  if (!edgeOk(header.width) || !edgeOk(header.height)) fail('bad-image', `${label}: ${header.width}x${header.height} is outside 1..${MAX_EDGE_PX}`);
  const limit = header.width * header.height * 4 + MB;
  if (bytes.length > limit) fail('bad-image', `${label}: ${bytes.length} bytes > ${limit} (width x height x 4 + 1 MB)`);
  return header;
}

/** §4 第 4 條：檔頭（格式、副檔名、長寬）＋重新計算雜湊，和檔名的雜湊相同才算數。 */
async function checkImage(bytes: Uint8Array<ArrayBuffer>, type: StoredImageType, hash: string): Promise<StoredImage> {
  const label = `images/${hash}.${EXTENSION[type]}`;
  const header = checkHeader(bytes, type, label);
  const actual = await hashBytes(bytes);
  if (actual !== hash) fail('bad-image', `${label}: content hash is ${actual}`);
  return { hash, blob: new Blob([bytes], { type }), type, width: header.width, height: header.height, hasAlpha: header.hasAlpha };
}

// ---------------------------------------------------------------- 匯出

/**
 * 匯出前只看大小、不讀進記憶體（§4 匯出：用和匯入一樣的上限，匯出的檔一定要能匯入）。
 * files 是不壓縮的檔（圖與預覽）：單檔 ≤ 30 MB；全部加起來 ≤ 300 MB；成品至少有這麼大，所以 ≤ 200 MB。
 */
function checkExportSizes(cardBytes: number, files: ReadonlyArray<readonly [label: string, size: number]>): void {
  if (cardBytes > MAX_CARD_JSON_BYTES) throw new Error(`card.json is ${cardBytes} bytes, over the 1 MB limit`);
  let stored = 0;
  for (const [label, size] of files) {
    if (size > HOLOCARD_ZIP_LIMITS.maxEntryBytes) throw new Error(`${label} is ${size} bytes, over the 30 MB per-file limit`);
    stored += size;
  }
  if (cardBytes + stored > HOLOCARD_ZIP_LIMITS.maxTotalBytes) throw new Error(`files add up to ${cardBytes + stored} bytes, over the 300 MB total limit`);
  if (stored > MAX_HOLOCARD_BYTES) throw new Error(`images and preview add up to ${stored} bytes, so the file would be over the 200 MB limit`);
}

export const exportHolocard: ExportHolocard = async (card, getImage, preview) => {
  const errors = validateCard(card, () => true);
  if (errors.length > 0) throw new Error(`card is invalid, cannot export: ${errors.slice(0, 5).join('; ')}`);

  // 預設值省略（圖層的 opacity／blend／breakout、反光層與霧光，T-413／T-417）
  const cardBytes = new TextEncoder().encode(JSON.stringify(omitCardDefaults(card), null, 2));
  const images: Array<readonly [hash: string, image: StoredImage]> = [];
  for (const hash of usedImages(card)) {
    const image = await getImage(hash);
    if (!image) throw new Error(`image ${hash} not found, cannot export`);
    images.push([hash, image]);
  }
  checkExportSizes(cardBytes.length, [
    ...images.map(([hash, image]) => [`image ${hash}`, image.blob.size] as const),
    [PREVIEW_PATH, preview.size] as const,
  ]);

  const files: Zippable = { [CARD_PATH]: [cardBytes, COMPRESS] };
  for (const [hash, image] of images) {
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    // 和匯入同一套檢查：匯出的檔一定能匯入
    try {
      await checkImage(bytes, image.type, hash);
    } catch (e) {
      throw new Error(`image ${hash} cannot be exported: ${e instanceof Error ? e.message : String(e)}`);
    }
    files[`images/${hash}.${EXTENSION[image.type]}`] = [bytes, STORE];
  }

  const previewBytes = new Uint8Array(await preview.arrayBuffer());
  try {
    checkHeader(previewBytes, 'image/png', PREVIEW_PATH);
  } catch (e) {
    throw new Error(`preview cannot be exported: ${e instanceof Error ? e.message : String(e)}`);
  }
  files[PREVIEW_PATH] = [previewBytes, STORE];

  const blob = new Blob([zipSync(files)], { type: HOLOCARD_MIME });
  if (blob.size > MAX_HOLOCARD_BYTES) throw new Error(`exported file is ${blob.size} bytes, over the 200 MB limit`);
  return blob;
};

// ---------------------------------------------------------------- 匯入

/** card.json：UTF-8（不合法的位元組直接算錯）＋JSON.parse；不用 eval／Function。 */
function parseCardJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('missing-card', 'card.json is not valid UTF-8');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail('missing-card', `card.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** formatVersion 是有限的數字而且比程式支援的大（只讀自己的欄位）。Infinity、字串交給 validateCard 擋。 */
function isNewerVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, 'formatVersion')) return false;
  const version: unknown = (value as Record<string, unknown>).formatVersion;
  return typeof version === 'number' && Number.isFinite(version) && version > SUPPORTED_VERSION;
}

/**
 * 有不認得的路徑（含太長的檔名）：如果 card.json 讀得出來而且版本比程式新，回「較新的版本」
 * （新版可能多了新檔案），否則回 bad-path。只讀 card.json（≤ 1 MB），不放寬任何其他檢查。
 */
function failUnknownPath(bytes: Uint8Array, listing: ZipListing, path: string): never {
  let newer = false;
  try {
    const cards = listing.entries.filter((entry) => entry.name === CARD_PATH);
    if (cards.length === 1) {
      const [cardBytes] = extractZip(bytes, { entries: cards, directoryOffset: listing.directoryOffset }, HOLOCARD_ZIP_LIMITS);
      newer = isNewerVersion(parseCardJson(cardBytes!));
    }
  } catch {
    // card.json 壞掉、CRC 不符、解壓失敗：照舊當成 bad-path
  }
  if (newer) fail('newer-version', `formatVersion is newer than ${SUPPORTED_VERSION} (and the file has paths this version does not know)`);
  fail('bad-path', `path not allowed: ${JSON.stringify(path.slice(0, 80))}`);
}

async function readHolocard(file: Blob): Promise<{ card: Card; images: StoredImage[]; preview?: Blob }> {
  // §4 第 1 條：先看大小，太大就不讀進記憶體
  if (file.size > MAX_HOLOCARD_BYTES) fail('too-large', `file is ${file.size} bytes > ${MAX_HOLOCARD_BYTES}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_HOLOCARD_BYTES) fail('too-large', `file is ${bytes.length} bytes > ${MAX_HOLOCARD_BYTES}`);

  // §4 第 1 條：解壓前用中央目錄的宣告擋檔案數與大小（不是 zip → bad-zip）
  const listing = listZip(bytes, HOLOCARD_ZIP_LIMITS);

  // §4 第 2 條：路徑白名單；同名兩次也不行（後面的會蓋掉前面的）
  const seen = new Set<string>();
  for (const entry of listing.entries) {
    const allowed = entry.name === CARD_PATH || entry.name === PREVIEW_PATH || IMAGE_PATH.test(entry.name);
    if (!allowed) failUnknownPath(bytes, listing, entry.name);
    if (seen.has(entry.name)) fail('bad-path', `duplicate path: ${entry.name}`);
    seen.add(entry.name);
  }

  // 解壓：一邊解一邊數，實際大小超過上限立刻中止
  const contents = extractZip(bytes, listing, HOLOCARD_ZIP_LIMITS);
  const files = new Map(listing.entries.map((entry, i) => [entry.name, contents[i]!]));

  const cardBytes = files.get(CARD_PATH);
  if (!cardBytes) fail('missing-card', 'card.json not found');
  // 舊版卡片檔（T-417 以前，holo.scope）：先轉成兩面的反光層，再照新格式驗
  const parsed = migrateCard(parseCardJson(cardBytes));

  // §4 第 3 條：版本比程式新 → 在 validateCard 之前就擋，給比較準的原因
  if (isNewerVersion(parsed)) fail('newer-version', `formatVersion is newer than ${SUPPORTED_VERSION}`);

  // §4 第 4 條：zip 裡每一張圖（含卡片沒用到的）都要檔頭正確、重算雜湊相符
  const images = new Map<string, StoredImage>();
  for (const [path, data] of files) {
    const match = IMAGE_PATH.exec(path);
    if (!match) continue;
    const [, hash, extension] = match;
    images.set(hash!, await checkImage(data, TYPE_OF_EXTENSION[extension!]!, hash!));
  }
  // preview.png 只檢查是 PNG、長寬在上限內（全部檢查通過才連同卡片一起回傳，T-605b 範例縮圖用）
  const preview = files.get(PREVIEW_PATH);
  if (preview) checkHeader(preview, 'image/png', PREVIEW_PATH);

  // §4 第 3 條：§1.1 驗證。先不管圖在不在，結構不合格 → invalid-card；
  // 結構合格再看用到的圖有沒有附（→ missing-image），最後用「zip 裡通過檢查的圖」完整驗一次。
  const structure = validateCard(parsed, () => true);
  if (structure.length > 0) fail('invalid-card', structure.slice(0, 5).join('; '));
  const card = parsed as Card;
  const used = usedImages(card);
  const missing = used.filter((hash) => !images.has(hash));
  if (missing.length > 0) fail('missing-image', `images not in the file: ${missing.join(', ')}`);
  const errors = validateCard(card, (hash) => images.has(hash));
  if (errors.length > 0) fail('invalid-card', errors.slice(0, 5).join('; '));

  // 剪裁層的 depth 對齊下面那層（T-803b：別的程式改過的卡不擋，讀進來就修好；圖片清單不變）
  const checked = { card: alignClipDepths(card), images: used.map((hash) => images.get(hash)!) };
  return preview ? { ...checked, preview: new Blob([preview], { type: 'image/png' }) } : checked;
}

export const importHolocard: ImportHolocard = async (file, opts) => {
  let checked: Awaited<ReturnType<typeof readHolocard>>;
  try {
    checked = await readHolocard(file);
  } catch (e) {
    if (e instanceof ImportFail || e instanceof ZipError) return { ok: false, reason: e.reason, detail: e.message };
    // 讀檔失敗或其他沒料到的錯：當成壞掉的檔，不讓例外跑出去
    return { ok: false, reason: 'bad-zip', detail: e instanceof Error ? e.message : String(e) };
  }
  // §4 第 5 條：新的 id 與時間（不覆蓋現有卡片），其他欄位原樣
  const now = opts.now();
  const card = { ...checked.card, id: opts.newId(), createdAt: now, updatedAt: now };
  return checked.preview ? { ok: true, card, images: checked.images, preview: checked.preview } : { ok: true, card, images: checked.images };
};
