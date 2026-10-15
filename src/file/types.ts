// 卡片檔 `.holocard` 匯出入的契約（SCHEMA.md §4）。實作在 `src/file/holocard.ts`。
// 匯入的檔案是不可信資料（硬邊界 4）：全部檢查通過才回傳結果；這個模組不寫入任何地方，
// 呼叫端（T-404）拿到結果再 `saveImage` 每張圖、最後 `save` 卡片。

import type { StoredImage } from '../images/types';
import type { Card } from '../model/types';

/** 卡片檔的副檔名與 MIME（下載與選檔用）。 */
export const HOLOCARD_EXT = '.holocard';
export const HOLOCARD_MIME = 'application/x-holocard+zip';

/**
 * 匯出：card 先過 validateCard（不合格就丟錯）；card 用到的每張圖用 getImage 取（找不到就丟錯）；
 * preview 是正面縮圖 PNG（最長邊 512，由呼叫端用 render 擷取）。回傳 zip 的 Blob。
 */
export type ExportHolocard = (
  card: Card,
  getImage: (hash: string) => Promise<StoredImage | undefined>,
  preview: Blob,
) => Promise<Blob>;

/** 匯入失敗的原因（畫面依它顯示白話訊息，DESIGN §4）。 */
export type ImportError =
  /** 壓縮檔 > 200 MB、單檔 > 30 MB、card.json > 1 MB、解壓總量 > 300 MB、檔案數 > 18（宣告的大小或實際解壓出來的都算）。 */
  | 'too-large'
  /** 不是 zip、zip 壞掉、解壓失敗。 */
  | 'bad-zip'
  /** 有白名單以外的路徑（SCHEMA §4 第 2 條）。 */
  | 'bad-path'
  /** 沒有 card.json，或不是合法的 JSON。 */
  | 'missing-card'
  /** formatVersion 比程式支援的新（有不認得的路徑、但 card.json 是較新版本時也回這個）。 */
  | 'newer-version'
  /** card.json 沒通過 validateCard。 */
  | 'invalid-card'
  /** card.json 用到的圖沒有附在檔案裡。 */
  | 'missing-image'
  /** 圖的雜湊和檔名不同、檔頭不是 WebP／PNG、副檔名和檔頭不符、長寬超過 2048、動畫圖、檔案大於寬×高×4＋1 MB、檔頭區塊太多。 */
  | 'bad-image';

export type ImportResult =
  /**
   * card 已換成新的 id 與時間（createdAt＝updatedAt＝now）；images 只含 card 用到的圖。
   * preview＝檔案裡的 preview.png（只檢查過是 PNG、長寬 1～2048；不存進卡片庫），沒有就沒有這個欄位（T-605b：新卡片面板的範例縮圖）。
   */
  | { ok: true; card: Card; images: StoredImage[]; preview?: Blob }
  /** detail 是給開發者看的英文或技術說明（不顯示在畫面上）。 */
  | { ok: false; reason: ImportError; detail?: string };

/** 匯入：file 是使用者拖進來或選的檔；newId、now 由呼叫端給（測試可以固定）。 */
export type ImportHolocard = (file: Blob, opts: { newId: () => string; now: () => string }) => Promise<ImportResult>;

// ---- GIF 匯出（SCHEMA §5，T-501）----

/** GIF 最寬幾像素（SCHEMA §5）。 */
export const GIF_MAX_WIDTH = 720;

export interface GifOptions {
  /** 畫格寬（1～GIF_MAX_WIDTH）。 */
  width: number;
  /** 畫格高（≥ 1）。 */
  height: number;
  /** 每格停多久（毫秒；GIF 以 10 毫秒為單位，四捨五入，至少 20）。 */
  delayMs: number;
}

/**
 * 把一串同樣大小的 RGBA 畫格（每格 width×height×4 位元組、不透明）編成無限循環的 GIF。
 * 全部畫格共用一組調色盤（避免顏色一格一格跳）；在 Web Worker 裡跑，不卡畫面。
 * onProgress(已完成格數, 總格數)。畫格大小不對、沒有畫格、選項不合格 → 丟錯。
 * signal（T-506）：abort 時立刻停掉 Worker，Promise 以 name 為 'AbortError' 的錯誤 reject。
 */
export type EncodeGif = (
  frames: readonly Uint8ClampedArray[],
  options: GifOptions,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
) => Promise<Blob>;

// ---- WebM 錄影（SCHEMA §5，T-503）----

export interface WebmOptions {
  /** 畫格寬、高（像素，整數 ≥ 2；VP8／VP9 需要偶數時由錄影模組自己處理，不能讓呼叫端失敗）。 */
  width: number;
  height: number;
  /** 每秒幾格（例如 20）。 */
  fps: number;
  /** 配樂（T-509）：有就加一條 Opus 音軌，長度以影片為準（多的截掉、少的補靜音）。 */
  audio?: WebmAudio;
}

// ---- 影片配樂（T-509；音樂只在匯出那一刻用，不存進卡片）----

/** 解碼好的聲音：每個聲道一條（1 或 2 條，長度相同），取樣率通常是 48000。 */
export interface WebmAudio {
  channels: Float32Array[];
  sampleRate: number;
}

/** 音樂檔大小上限。 */
export const MUSIC_MAX_BYTES = 50 * 1024 * 1024;

export interface MusicOptions {
  /** 從音樂的第幾秒開始（≥ 0；超過音樂長度就從 0 開始）。 */
  startSec: number;
  /** 要多長（秒，> 0，＝影片長度）。音樂比這短就補靜音。 */
  durationSec: number;
  /** 結尾淡出幾秒（預設 1；開頭固定 0.05 秒淡入，避免爆音）。 */
  fadeOutSec?: number;
}

/**
 * 準備配樂：解碼使用者選的音樂檔（瀏覽器讀得懂的格式：MP3、WAV、OGG、M4A…）→ 從 startSec 取 durationSec →
 * 淡入淡出 → 轉成 48000 Hz 立體聲。檔案超過 MUSIC_MAX_BYTES、讀不出來 → 丟錯（畫面轉白話）。不上傳、不存檔。
 */
export type PrepareMusic = (file: Blob, options: MusicOptions) => Promise<WebmAudio>;

/** 讀音樂檔的長度（秒），給畫面顯示與限制起始秒數；讀不出來丟錯。 */
export type MusicDuration = (file: Blob) => Promise<number>;

/**
 * 錄一段 WebM：produce 會拿到 push(rgba)，依序把每格（width×height×4、不透明）交出去；
 * 第 i 格的時間戳＝i／fps 秒（不靠實際經過的時間）。push 在編碼器忙時等它消化（背壓）才 resolve。produce 結束＝錄完。
 * 用瀏覽器內建的 WebCodecs `VideoEncoder`（VP9，不支援就 VP8）＋自己寫的最小 WebM 封裝（含 Duration），不另裝套件（T-503，2026-10-14 從 MediaRecorder 改）。
 * signal abort → 停止、以 name 'AbortError' 的錯誤 reject；瀏覽器沒有 WebCodecs 或不支援 VP8／VP9 → 丟錯。回傳 `video/webm` Blob。
 */
export type RecordWebm = (
  options: WebmOptions,
  produce: (push: (rgba: Uint8ClampedArray) => Promise<void>) => Promise<void>,
  signal?: AbortSignal,
) => Promise<Blob>;

// ---- MP4 錄影（SCHEMA §5，T-513；iPhone 與社群平台都能播）----

/**
 * 錄一段 MP4：用法、時間戳、背壓、取消都和 RecordWebm 一樣（同一個 WebmOptions）。
 * 影像用 WebCodecs `VideoEncoder` 的 H.264（avc），聲音用 `AudioEncoder` 的 AAC-LC（不支援就 Opus）；
 * 自己寫的 MP4 封裝（moov 在 mdat 前面，邊下載邊能播），不另裝套件。
 * 瀏覽器沒有 WebCodecs 或不支援 H.264 → 丟 name 'Mp4UnsupportedError' 的錯；有配樂但 AAC 與 Opus 都不能編 → 丟 name 'Mp4AudioUnsupportedError' 的錯。
 * 回傳 `video/mp4` Blob。
 * onInfo（T-513b）：第一格編碼成功、確定最後用哪個 codec 之後，在第一個 push 回傳之前呼叫一次，告訴呼叫端實際用的影像 codec 字串與聲音編碼
 * （沒有配樂＝null）；聲音是 'opus' 時 iPhone／QuickTime 可能沒聲音，畫面要提醒。
 */
export interface Mp4Info {
  videoCodec: string;
  audioCodec: 'aac' | 'opus' | null;
}

export type RecordMp4 = (
  options: WebmOptions,
  produce: (push: (rgba: Uint8ClampedArray) => Promise<void>) => Promise<void>,
  signal?: AbortSignal,
  onInfo?: (info: Mp4Info) => void,
) => Promise<Blob>;
