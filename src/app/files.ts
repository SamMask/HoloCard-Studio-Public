// 匯出、匯入檔案的小工具（T-404）：檔名、卡片檔 preview 的大小、下載。
// 下載只用 object URL（本機記憶體裡的 Blob），不對外請求（硬邊界 1）。
// 轉一圈的影片與 GIF（T-504）：固定設定、一圈的效果時間、邊拍邊錄。
// 連舞台一起錄（T-850，SCHEMA §5）：畫面橫的 16:9（stageFrameHeight）；影片寬 STAGE_VIDEO_WIDTH、GIF 寬照大小（ui/logic 的 gifWidth）；
// 其他固定設定（格數、秒數、每格時間、調色盤）照 TURNTABLE 不變。

import { S } from '../i18n';
import { aspectHeight, type CardShape } from '../model/aspect';
import { CAPTURE_MARGIN } from '../render/pick';

/** Windows 檔名不能用的字元與控制字元。 */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
/** Windows 保留的裝置名（不分大小寫）。 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 卡名 → 下載的檔名：去掉 Windows 不能用的字元、結尾的點與空白；空的用「未命名卡片」；保留裝置名前面加底線。
 * Windows 看的是第一個點之前（去掉結尾空白）：`con.txt`、`CON .txt` 也是保留名（T-409），所以加在最前面才有用。
 */
export function safeFileName(name: string, ext: string): string {
  let base = name.replace(INVALID_CHARS, '').trim().replace(/[. ]+$/, '');
  if (base === '') base = S.defaults.cardName;
  if (RESERVED.test(base.split('.')[0]!.trimEnd())) base = `_${base}`;
  return `${base}${ext}`;
}

/** 卡片檔裡 preview.png 的最長邊（SCHEMA §4）。 */
export const PREVIEW_MAX_SIDE = 512;

/**
 * 卡片檔 preview 的擷取寬度（captureCard 給寬度、高度照外框比例算）：正面時外框＝卡片四邊各加 CAPTURE_MARGIN × 長邊
 * （render/pick.ts 的 captureFrame）。直的卡（高 ≥ 寬）讓高度剛好不超過 512；橫式卡（T-807）寬是長邊，直接 512。
 */
export function previewWidth(shape: CardShape): number {
  const height = aspectHeight(shape);
  const margin = CAPTURE_MARGIN * Math.max(1, height);
  const ratio = (1 + 2 * margin) / (height + 2 * margin);
  return ratio > 1 ? PREVIEW_MAX_SIDE : Math.max(1, Math.floor(PREVIEW_MAX_SIDE * ratio));
}

// ---- 轉一圈的影片與 GIF（T-504，SCHEMA §5、spec B11：自動轉一圈 4±0.5 秒） ----

/**
 * 固定設定（不讓使用者面對技術設定）：一圈 4 秒、80 格（每格 50 毫秒，GIF 的延遲剛好是 10 毫秒的整數倍）；
 * 第 0 格的效果時間 0（GIF 和影片的閃星時序一樣）；轉的時候稍微從上往下看（pitch −8°：卡片下緣比較近，
 * 像看桌上立著的卡），看得出立體；影片寬 720、GIF 寬 480（GIF 上限）。
 */
export const TURNTABLE = {
  seconds: 4,
  frames: 80,
  pitchDeg: -8,
  startTime: 0,
  webmWidth: 720,
  // 沒有選項的舊入口用的 GIF 寬（＝以前的 GIF 上限 480；寫死，不跟著編碼器的上限變，T-850）
  gifWidth: 480,
} as const;

/** 連舞台一起錄（T-850）：影片寬（高＝stageFrameHeight＝720）。 */
export const STAGE_VIDEO_WIDTH = 1280;

/** 連舞台一起錄（T-850）：橫的 16:9 畫面的高（寬 × 9／16，四捨五入）：1280→720、480→270、600→338、720→405。 */
export function stageFrameHeight(width: number): number {
  return Math.round((width * 9) / 16);
}

/**
 * GIF 選項小框的預估檔案大小（T-512）：打開時用目前這張卡、選的動作，在這幾種寬度各拍這麼幾格實際編一次 GIF，
 * 照寬度內插每格大小再乘 80 格（ui/logic 的 estimateGifBytes）。8 格剛好是 80 格裡每隔 10 格取一格（同樣的角度與效果時間），
 * 編碼在背景執行，不卡畫面。T-512b：只編寬 320 一種、照像素數推的話，純色、漸層的卡會高估 33～50%（越大越省），改成兩種寬度；
 * 格數不能再少（4 格的話轉一圈有兩格剛好是側面，實測差到 −22%）。
 */
export const GIF_ESTIMATE = { frames: 8, widths: [320, 480] } as const;

/** 連舞台一起錄（T-850）的 GIF 預估：同樣 8 格，試編寬 480 與 720（橫的 16:9；涵蓋小／中／大的 480～720）。 */
export const GIF_STAGE_ESTIMATE = { frames: GIF_ESTIMATE.frames, widths: [480, 720] } as const;

/** 轉動影片的副檔名（T-514：MP4 或 WebM；SCHEMA §5）。 */
export const VIDEO_EXT = { mp4: '.mp4', webm: '.webm' } as const;

/** 影片每秒幾格：80 格剛好 4.0 秒。 */
export const TURNTABLE_FPS = TURNTABLE.frames / TURNTABLE.seconds;
/** GIF 每格停多久（毫秒）：80 格剛好 4000 毫秒。 */
export const GIF_DELAY_MS = (TURNTABLE.seconds * 1000) / TURNTABLE.frames;

/**
 * 一圈涵蓋的效果時間（captureTurntable 的 timeSpan）：最接近 seconds 的 period（閃星週期）整數倍、至少一倍，
 * GIF 無限循環時最後一格接回第一格，閃星不會跳。
 */
export function loopTimeSpan(seconds: number, period: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('一圈秒數要是大於 0 的有限數字');
  if (!Number.isFinite(period) || period <= 0) throw new Error('週期要是大於 0 的有限數字');
  return Math.max(1, Math.round(seconds / period)) * period;
}

// ---- 轉動影片的長度（T-509b）：轉 1～3 圈＝4／8／12 秒，每圈同樣速度 ----

/** 轉動影片最多轉幾圈。 */
export const MAX_VIDEO_LAPS = 3;

/** 轉 laps 圈的影片：總格數、總秒數（每圈和 TURNTABLE 一樣：80 格、4 秒）。laps 不是 1～MAX_VIDEO_LAPS 的整數就丟錯。 */
export function videoPlan(laps: number): { laps: number; frames: number; seconds: number } {
  if (!Number.isInteger(laps) || laps < 1 || laps > MAX_VIDEO_LAPS) throw new Error(`影片要轉 1～${MAX_VIDEO_LAPS} 圈`);
  return { laps, frames: laps * TURNTABLE.frames, seconds: laps * TURNTABLE.seconds };
}

/** 從 startTime 開始拍一圈（render 的 captureTurntable 包一層，startTime 以外的設定每圈一樣）。 */
export type CaptureLap = (
  startTime: number,
  onFrame: (rgba: Uint8ClampedArray, index: number) => Promise<void>,
  signal: AbortSignal,
) => Promise<unknown>;

/**
 * 多圈（T-509b）：同一圈連拍 laps 次，第 k 圈從 startTime＋k×timeSpan 開始——剛好是上一圈「再下一格」的效果時間，
 * 所以圈與圈之間時間連續；timeSpan 是閃星週期的整數倍，每圈畫面一樣、最後一格接回第一格也不跳。
 * 畫格編號接著算（第 k 圈第 i 格＝k×framesPerLap＋i），合成一個 CaptureFrames 給 recordWhileCapturing。
 */
export function captureLaps(laps: number, framesPerLap: number, startTime: number, timeSpan: number, captureLap: CaptureLap): CaptureFrames {
  if (!Number.isInteger(laps) || laps < 1) throw new Error('圈數要是正整數');
  if (!Number.isInteger(framesPerLap) || framesPerLap < 1) throw new Error('每圈格數要是正整數');
  if (!Number.isFinite(startTime)) throw new Error('起始時間要是有限數字');
  if (!Number.isFinite(timeSpan) || timeSpan <= 0) throw new Error('一圈的效果時間要是大於 0 的有限數字');
  return async (onFrame, signal) => {
    for (let k = 0; k < laps; k++) {
      if (signal.aborted) throw abortError();
      await captureLap(startTime + k * timeSpan, (rgba, index) => onFrame(rgba, k * framesPerLap + index), signal);
    }
  };
}

/** 拍一圈：每拍好一格就呼叫 onFrame（等它做完才拍下一格）；signal 取消以 AbortError 停（render 的 captureTurntable 包一層）。 */
export type CaptureFrames = (
  onFrame: (rgba: Uint8ClampedArray, index: number) => Promise<void>,
  signal: AbortSignal,
) => Promise<unknown>;

/** 交出一格給錄影（等錄影消化才 resolve）。 */
export type PushFrame = (rgba: Uint8ClampedArray) => Promise<void>;

/** 錄影：知道畫格高度後開始；produce 拿到 push 依序交出每一格，produce 結束＝錄完（file 的 recordWebm 包一層）。 */
export type RecordFrames = (height: number, produce: (push: PushFrame) => Promise<void>, signal: AbortSignal) => Promise<Blob>;

const abortError = () => new DOMException('匯出已取消', 'AbortError');

/**
 * 邊拍邊錄（影片）：拍好一格就交給錄影，不用先把整圈存在記憶體裡。畫格寬已知、高度要等第一格拍好才知道
 * （高度由 render 依整圈的外框算），所以第一格到了才開始錄。
 * 任何一邊失敗或 signal 取消 → 兩邊都停（另一邊不會一直等），以原本的錯誤（取消＝AbortError）reject。
 */
export async function recordWhileCapturing(
  width: number,
  capture: CaptureFrames,
  record: RecordFrames,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) throw abortError();
  // 兩邊共用的停止開關：外面取消、或任何一邊失敗，都拉下它
  const inner = new AbortController();
  const forward = () => inner.abort();
  signal?.addEventListener('abort', forward, { once: true });
  let finishProduce = () => {};
  let failProduce: (err: unknown) => void = () => {};
  const produced = new Promise<void>((resolve, reject) => {
    finishProduce = resolve;
    failProduce = reject;
  });
  // 錄影還沒開始就失敗時沒有人等 produced：先接住，免得變成沒處理的 rejection
  produced.catch(() => {});
  let recording = null as Promise<Blob> | null;
  let push = null as PushFrame | null;
  try {
    await capture(async (rgba) => {
      if (!push) {
        const height = rgba.length / (width * 4);
        push = await new Promise<PushFrame>((resolve, reject) => {
          recording = record(
            height,
            (p) => {
              resolve(p);
              return produced;
            },
            inner.signal,
          );
          // 還沒拿到 push 就失敗（例如瀏覽器不能錄）：這一格就失敗、不再拍下一格
          recording.catch(reject);
        });
      }
      await push(rgba);
    }, inner.signal);
    if (!recording) throw new Error('一格都沒有拍到');
    finishProduce();
    return await recording;
  } catch (err) {
    failProduce(err);
    inner.abort();
    throw signal?.aborted ? abortError() : err;
  } finally {
    signal?.removeEventListener('abort', forward);
  }
}

/** object URL 留多久才收回：太快收回，有些瀏覽器還沒開始下載。 */
const REVOKE_DELAY_MS = 10_000;

/** 測試用不下載開關（T-418）攔下來的一次下載。 */
export interface HeldDownload {
  name: string;
  size: number;
  blob: Blob;
}

declare global {
  interface Window {
    /** 網址帶 ?nodownload 時，攔下來沒下載的檔（T-418，給瀏覽器自動化測試讀）。 */
    __holoDownloads?: HeldDownload[];
  }
}

/**
 * 攔下來的檔最多留幾個、加起來多大（T-417b）：測 GIF／影片時每次幾 MB～幾十 MB，不設上限會一直佔記憶體。
 * 測試只要讀最近幾次的結果就夠了。
 */
export const HELD_DOWNLOADS_MAX = { count: 10, bytes: 200 * 1024 * 1024 } as const;

/**
 * 放進攔下來的清單（改 list 本身）：超過筆數或總大小就丟最舊的；最新的一筆一定留著（就算它自己就超過總大小）。
 */
export function holdDownload(list: HeldDownload[], item: HeldDownload, max: { count: number; bytes: number } = HELD_DOWNLOADS_MAX): void {
  list.push(item);
  let total = list.reduce((sum, d) => sum + d.size, 0);
  while (list.length > 1 && (list.length > max.count || total > max.bytes)) total -= list.shift()!.size;
}

/** 網址參數有 nodownload（T-418）：測試時匯出不落地。 */
export function noDownloadMode(search: string): boolean {
  return new URLSearchParams(search).has('nodownload');
}

/**
 * 用 <a download> 下載一個 Blob（只在瀏覽器）；用完收回 object URL。
 * 網址帶 ?nodownload（T-418，2026-10-14 子代理三次漏攔下載的根本解）：不點連結，改放進 window.__holoDownloads（最多 10 筆、200 MB，淘汰最舊的）、console 記一行；
 * 每次下載時才讀網址，熱更新、重新整理後也還在。使用者正常開工坊（沒有這個參數）不受影響。
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof location !== 'undefined' && noDownloadMode(location.search)) {
    holdDownload((window.__holoDownloads ??= []), { name: fileName, size: blob.size, blob });
    console.info(`[nodownload] 沒有下載「${fileName}」（${blob.size} 位元組），放在 window.__holoDownloads`);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
