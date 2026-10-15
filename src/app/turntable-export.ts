// 轉動影片／GIF 的匯出組裝（T-504 起寫在 main；T-512b 抽到這裡，測試走同一條路、只換掉擷取、編碼、下載出口）：
//   開始：複製一份目前的卡（3D 預覽在匯出期間只畫它）→ 保留副本用的圖（登記簿 hold，換卡也不收）、先不拍縮圖
//   （自動存 holdThumbnails，3D 預覽畫的是副本）→ 離屏逐格拍一個來回 → 影片邊拍邊錄、GIF 整段拍好再合成 → 下載（檔名＝卡名）。
//   收尾（做完、取消、失敗、畫面更新拋錯都一樣）：副本清掉、畫面換回編輯中的卡，圖與縮圖各放開一次。
//   取消（〔取消〕、Esc、被別的分頁接手＝畫面送出取消）：停掉、不下載；拍完或合成完才發現取消也不下載。
//   GIF 選項小框的預估（T-512；T-512b 改成兩種寬度）：照選的動作拍 GIF_ESTIMATE.frames 格，寬 320 與 480 各實際編一次，
//   畫面照寬度內插（ui/logic 的 estimateGifBytes）。離屏擷取一次只做一件（估算與匯出排隊）。
// 上下點頭（T-812）：選項的 nodDeg（0～25，轉一圈與擺動都用）→ captureTurntable 的 nodDeg；影片每一圈、GIF、GIF 預估的試編都帶同一個值。
// 影片格式（T-514）：選項的 format 'mp4' 用 file/mp4 的 recordMp4（H.264＋AAC，不行就 Opus；onInfo 轉交畫面）、
//   'webm'（或沒寫）用 recordWebm；檔名 .mp4／.webm；長度、動作、配樂、邊拍邊錄都一樣。
//   canMakeMp4：打開影片選項小框時問（VideoEncoder.isConfigSupported，不載入大東西；同一次開著工坊只真的問一次）。
// 透明卡套（T-806）：選項的 includeSleeve（匯出選單的「包含卡套」）→ captureTurntable 的 sleeve；沒寫＝畫（跟著卡片開關，
//   卡片沒開卡套時 render 一律不畫）。GIF 的預估照同一個選擇。
// 畫上背景（T-814）：選項的 includeBackdrop（匯出選單的「畫上背景」）沒有勾掉、而且這張卡有背景圖 → captureTurntable 的 backdrop
//   ＝組裝端給的那張圖（圖片登記簿；匯出期間 hold 的圖含背景圖），每一格的底都是它；GIF 的預估照同一個選擇（勾著時畫格比較花、檔案比較大）。
//   遠景的位置與大小（T-822）：背景圖帶著這張卡（匯出的副本）的 view.farPan（render/backdrop 的 withFarPan；沒調過＝同一個物件），
//   每一格照同一個焦點與放大裁；GIF 的預估也照它。
// 舞台遠景（T-842）：includeStageFar 只有 true 才畫，沒有自訂背景圖且舞台有遠景時才讀；PNG 共用 exportBackdropFor。
//   同樣帶 farPan，不畫 3D 舞台；匯出與 GIF 預估在讀好之後再擷取，取消則不開始拍。
// 前景圖（T-830）：同一個勾選（includeBackdrop 沒有勾掉）、這張卡有前景圖、拿得到圖 → captureTurntable 的 foreground（圖＋位置、大小、模糊，
//   foregroundFor；PNG 的 main 也用它），每一格卡片之後疊上；圖用同一個 backdropImage（圖片登記簿）拿；GIF 的預估照同一個選擇。
// 連舞台一起錄（T-850）：選項的 withStage 勾著、舞台不是「關」（recordsStage）→ captureTurntable 的 stage：橫的 16:9
//   （影片寬 STAGE_VIDEO_WIDTH、GIF 寬照大小 gifWidth(size, true)、高 stageFrameHeight）、預覽的預設縮放（ZOOM_DEFAULT）、
//   CSS 那層（stage-scenery 的 stageSceneryFor：照預覽畫哪張圖，圖讀不到這次匯出失敗）、前景圖（不管「畫上背景」都畫）、
//   影片第幾圈（舞台的動畫接著前一圈走）；這時 backdrop、foreground 給 null（「畫上背景」「畫上舞台的遠景」不看），卡套照舊。
//   工作桌：每一格的上下角度（俯仰＋點頭）夾在預覽工作桌的範圍（turnLimits(true)，±10°；stage.pitchLimit）。
//   GIF 預估同一個選擇（試編 GIF_STAGE_ESTIMATE 的兩種寬度）。不勾（或舞台關著）時傳給 render 的選項和以前完全一樣（沒有 stage 這個欄位）。

import { recordMp4 as browserRecordMp4 } from '../file/mp4';
import type { EncodeGif, Mp4Info, PrepareMusic, RecordMp4, RecordWebm, WebmAudio } from '../file/types';
import { parallaxOffset } from '../interact/parallax';
import { turnLimits, ZOOM_DEFAULT } from '../interact/view';
import { foregroundOf } from '../model/actions';
import type { Card } from '../model/types';
import { withFarPan } from '../render/backdrop';
import type { BackdropImage, CardScene, ForegroundImage, StageScenery, StageShotOptions, TurntableOptions } from '../render/card-view';
import { SPARKLE_PERIOD } from '../render/holo';
import { clampNodDeg, clampSwingDeg, gifWidth, MUSIC_UNSUPPORTED_TEXT, musicErrorText, turntableErrorText, turntableProgress, VIDEO_UNSUPPORTED_TEXT } from '../ui/logic';
import type { BackdropChoice, GifSample, MotionRequest, SleeveChoice, StageChoice, TurntableKind, TurntableOutcome, UiIntents, VideoExportOptions } from '../ui/types';
import { cardImageHashes } from './autosave';
import { stageExportPath } from './stage-export-image';
import { stageSceneryFor, type Stage3dImages } from './stage-scenery';
import {
  captureLaps,
  GIF_DELAY_MS,
  GIF_ESTIMATE,
  GIF_STAGE_ESTIMATE,
  loopTimeSpan,
  recordWhileCapturing,
  safeFileName,
  STAGE_VIDEO_WIDTH,
  stageFrameHeight,
  TURNTABLE,
  TURNTABLE_FPS,
  VIDEO_EXT,
  videoPlan,
} from './files';

/** 組裝端（main）交進來的東西：測試換成假的擷取、編碼、下載出口，其他照真的接。 */
export interface TurntableExportDeps {
  /** 編輯中的卡（開始匯出時複製一份）；還沒有卡＝null。 */
  card(): Card | null;
  /** 3D 預覽的離屏擷取；還沒準備好＝null。 */
  scene(): Pick<CardScene, 'captureTurntable'> | null;
  /** 重畫畫面（3D 預覽換成副本／換回編輯中的卡；frozenCard() 在呼叫前已經換好）。 */
  refresh(): void;
  /** 保留這些圖到放開（圖片登記簿的 hold）；回傳放開的函式。 */
  holdImages(hashes: readonly string[]): () => void;
  /** 先不拍縮圖到放開（自動存的 holdThumbnails）；回傳放開的函式。 */
  holdThumbnails(): () => void;
  /** 在提示列顯示白話錯誤。 */
  showError(text: string): void;
  /** 下載出口（瀏覽器是 app/files 的 downloadBlob）。 */
  download(blob: Blob, fileName: string): void;
  encodeGif: EncodeGif;
  recordWebm: RecordWebm;
  /** MP4 錄影（T-514）；沒給＝瀏覽器的 file/mp4 recordMp4（組裝端不用另外接）。 */
  recordMp4?: RecordMp4;
  /** 這個瀏覽器能不能做 MP4（T-514）；沒給＝canEncodeMp4()（問瀏覽器的 VideoEncoder）。 */
  canEncodeMp4?: () => Promise<boolean>;
  prepareMusic: PrepareMusic;
  /** 瀏覽器有沒有做影片的功能（WebCodecs 的影像編碼）。 */
  canRecordVideo(): boolean;
  /** 瀏覽器有沒有幫影片加聲音的功能（WebCodecs 的聲音編碼）。 */
  canAddMusic(): boolean;
  /** 舞台背景圖（T-814）與前景圖（T-830）：這個雜湊的圖（已解碼）；拿不到＝null（就不畫）。沒給＝一律不畫。 */
  backdropImage?(hash: string): BackdropImage | null;
  /** T-842：勾選後才讀舞台原圖；用匯出的卡片副本選圖，不含 3D 舞台。讀不到則讓匯出失敗。 */
  stageBackdropImage?(card: Pick<Card, 'view'>): Promise<BackdropImage | null>;
  /** 連舞台一起錄（T-850）：舞台畫好的圖（public/stages/…，同源讀，和預覽共用結果）；讀不到丟錯（這次匯出失敗）。沒給＝讀不到。 */
  stageImage?(path: string): Promise<BackdropImage>;
  /**
   * 連舞台一起錄（T-850c）：把這次讀到的舞台圖、自己的背景圖交給 3D 舞台（補進預覽的讀圖狀態、重畫一次），回 3D 用的是不是這一批；
   * false＝接不上（這次匯出失敗）。見 app/stage-scenery 的 StageSceneryDeps.attach3d。沒給＝不檢查。
   */
  attachStage3d?(card: Pick<Card, 'view'>, images: Stage3dImages): boolean;
}

/** 連舞台一起錄（T-850）：勾了（withStage）而且舞台不是「關」。 */
export function recordsStage(card: Pick<Card, 'view'>, choice: StageChoice | undefined): boolean {
  return choice?.withStage === true && card.view.stage !== 'none';
}

/** PNG、影片、GIF、GIF 預估共用的背景選擇；新選項省略／false 時完全沿用自訂背景圖行為。 */
export async function exportBackdropFor(
  card: Pick<Card, 'view'>,
  choice: BackdropChoice | undefined,
  lookup: TurntableExportDeps['backdropImage'],
  stageLookup: TurntableExportDeps['stageBackdropImage'],
): Promise<BackdropImage | null> {
  const hash = card.view.backdrop;
  if (hash !== undefined) {
    const image = choice?.includeBackdrop !== false ? lookup?.(hash) ?? null : null;
    return image ? withFarPan(image, card.view.farPan) : null;
  }
  if (choice?.includeStageFar !== true || stageExportPath(card) === null) return null;
  const image = await stageLookup?.(card) ?? null;
  return image ? withFarPan(image, card.view.farPan) : null;
}

/**
 * 匯出的前景圖（T-830）：「畫上背景」沒有勾掉（includeBackdrop 不是 false）、這張卡有前景圖、lookup 拿得到圖 → 圖＋這張卡的位置、大小、模糊；
 * 不然 null（不畫）。PNG（main）與影片、GIF、GIF 預估（這裡）共用。
 */
export function foregroundFor(
  card: Pick<Card, 'view'>,
  includeBackdrop: boolean | undefined,
  lookup: ((hash: string) => BackdropImage | null) | undefined,
): ForegroundImage | null {
  const fg = foregroundOf(card);
  if (includeBackdrop === false || !fg) return null;
  const image = lookup?.(fg.image) ?? null;
  if (!image) return null;
  const { image: _hash, ...place } = fg;
  return { image: image.image, width: image.width, height: image.height, place };
}

/** 匯出的選擇：動作、包含卡套（T-806）、畫上背景（T-814）、連舞台一起錄（T-850）。 */
type ExportChoice = Partial<MotionRequest> & SleeveChoice & BackdropChoice & StageChoice;

export type TurntableExporter = Pick<UiIntents, 'exportTurntable' | 'exportVideo' | 'exportGif' | 'estimateGif'> &
  Required<Pick<UiIntents, 'canMakeMp4'>> & {
    /** 匯出中的副本（3D 預覽只畫它）；沒有在匯出＝null。 */
    frozenCard(): Card | null;
  };

const noop = () => {};

/** MP4 錄影模組依序試的 H.264 設定（High／Main／Baseline，level 4.0；和 file/mp4.ts 的 VIDEO_CODECS 一樣）。 */
const MP4_PROBE_CODECS = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028'] as const;
/** 問的時候用的畫格大小：影片寬 720、標準卡大約的高（實際高度要拍到第一格才知道）。 */
const MP4_PROBE_SIZE = { width: TURNTABLE.webmWidth, height: 1008 } as const;

/**
 * 這個瀏覽器能不能做 MP4（T-514）：用 VideoEncoder.isConfigSupported 依序問錄影模組會試的 H.264 設定，有一種可以就是可以。
 * 只問、不建編碼器、不載入大東西；沒有 VideoEncoder、問的時候丟錯都當不行。encoder 沒傳＝瀏覽器的 VideoEncoder。
 */
export async function canEncodeMp4(
  encoder: Pick<typeof VideoEncoder, 'isConfigSupported'> | undefined = typeof VideoEncoder === 'undefined' ? undefined : VideoEncoder,
): Promise<boolean> {
  if (typeof encoder?.isConfigSupported !== 'function') return false;
  for (const codec of MP4_PROBE_CODECS) {
    try {
      const support = await encoder.isConfigSupported({
        codec,
        ...MP4_PROBE_SIZE,
        bitrate: 7_000_000,
        framerate: TURNTABLE_FPS,
        avc: { format: 'avc' },
        latencyMode: 'realtime',
      });
      if (support.supported) return true;
    } catch {
      // 這個設定問不了：問下一個
    }
  }
  return false;
}

export function createTurntableExporter(deps: TurntableExportDeps): TurntableExporter {
  /** 這次匯出的卡片（開始時複製的一份）：畫面已經鎖住不能編輯，但開始前就在做的上傳、加文字、匯入做完時還是會改到卡片。 */
  let frozen: Card | null = null;
  const recordMp4 = deps.recordMp4 ?? browserRecordMp4;

  /** 能不能做 MP4：同一次開著工坊結果不會變，只真的問一次；問壞了＝不能。 */
  let mp4Check: Promise<boolean> | null = null;
  const canMakeMp4 = (): Promise<boolean> =>
    (mp4Check ??= (deps.canEncodeMp4 ?? canEncodeMp4)().catch((err: unknown) => {
      console.error(err);
      return false;
    }));

  /** 離屏擷取一次只做一件：GIF 選項小框的試編與真正的匯出不同時拍（小框關掉時試編已送出取消，等它停好才開始匯出）。 */
  let captureQueue: Promise<unknown> = Promise.resolve();
  const exclusiveCapture = <T>(task: () => Promise<T>): Promise<T> => {
    const run = captureQueue.then(task, task);
    captureQueue = run.catch(noop);
    return run;
  };

  /** 一個來回涵蓋的效果時間：最接近 4 秒的閃星週期整數倍（GIF 循環接縫不跳）。 */
  const loopSpan = loopTimeSpan(TURNTABLE.seconds, SPARKLE_PERIOD);

  /**
   * 動作 → captureTurntable 的 motion／swingDeg／nodDeg（擺動角度夾在 5～60 整數；上下點頭夾在 0～25 整數，
   * T-812：轉一圈與擺動都用；沒給＝0＝只有左右，和 T-812 以前一樣）。
   */
  const motionOptions = (choice: Partial<MotionRequest> | undefined): Pick<TurntableOptions, 'motion' | 'swingDeg' | 'nodDeg'> => {
    const nodDeg = choice?.nodDeg === undefined ? 0 : clampNodDeg(choice.nodDeg);
    return choice?.motion === 'swing' ? { motion: 'swing', swingDeg: clampSwingDeg(choice.swingDeg ?? Number.NaN), nodDeg } : { motion: 'turn', nodDeg };
  };

  /**
   * 拍 card 的固定設定（一個來回 4 秒 80 格、俯仰 −8°〔上下點頭的中心〕、閃星整數週期）＋寬度、動作、卡套與背景圖；
   * 視差位移照 card 算（拿到那一格的左右、上下角度）。GIF 預估拍的 8 格用同一個公式（frames 8 就是 80 格裡每隔 10 格）。
   */
  const turntableOptions = (card: Card, width: number, choice: ExportChoice | undefined, backdrop: BackdropImage | null): TurntableOptions => ({
    width,
    sleeve: choice?.includeSleeve !== false,
    backdrop,
    foreground: foregroundFor(card, choice?.includeBackdrop, deps.backdropImage),
    frames: TURNTABLE.frames,
    seconds: TURNTABLE.seconds,
    startTime: TURNTABLE.startTime,
    timeSpan: loopSpan,
    pitchDeg: TURNTABLE.pitchDeg,
    ...motionOptions(choice),
    offsetsAt: (yaw, pitch) => ({
      front: card.front.layers.map((l) => parallaxOffset('front', yaw, pitch, l.depth)),
      back: card.back.layers.map((l) => parallaxOffset('back', yaw, pitch, l.depth)),
    }),
  });

  /**
   * 連舞台一起錄（T-850）的選項：同 turntableOptions（動作、卡套、固定設定），backdrop、foreground 給 null（不看「畫上背景」），
   * 多 stage：橫的 16:9、預覽的預設縮放、CSS 那層、前景圖（不管「畫上背景」都畫）、第 0 圈。
   */
  const stageOptions = (card: Card, width: number, choice: ExportChoice | undefined, scenery: StageScenery): TurntableOptions => {
    const stage: StageShotOptions = {
      height: stageFrameHeight(width),
      zoom: ZOOM_DEFAULT,
      scenery,
      foreground: foregroundFor(card, undefined, deps.backdropImage),
      lap: 0,
      // 工作桌：上下角度夾在預覽工作桌的範圍（±10°，跟預覽一樣；T-850 主對話決定）
      ...(card.view.stage === 'desk' ? { pitchLimit: turnLimits(true).pitch } : {}),
    };
    return { ...turntableOptions(card, width, choice, null), foreground: null, stage };
  };

  /** CSS 那層（stage-scenery；圖讀不到丟錯）。 */
  const sceneryFor = (card: Card) =>
    stageSceneryFor(card, { image: deps.backdropImage, stageImage: deps.stageImage, attach3d: deps.attachStage3d });

  /**
   * GIF 選項小框的預估：用 3D 預覽上的這張卡、選的動作，在 GIF_ESTIMATE.widths 的每個寬度拍 GIF_ESTIMATE.frames 格實際編一次
   * （回傳的順序＝拍的順序，寬的先）。拍完一個寬度就開始編（在 Worker 裡），同時拍下一個寬度；編碼不佔離屏擷取。
   * 失敗、取消、3D 還沒好 → null（畫面不顯示數字）。
   */
  const estimateGif = async (choice: MotionRequest & SleeveChoice & BackdropChoice & StageChoice, signal: AbortSignal): Promise<GifSample[] | null> => {
    try {
      const encodes = await exclusiveCapture(async () => {
        const s = deps.scene();
        const card = frozen ?? deps.card();
        if (!s || !card || signal.aborted) return null;
        // 連舞台一起錄（T-850）：CSS 那層；不勾＝畫上背景照舊
        const staged = recordsStage(card, choice);
        const scenery = staged ? await sceneryFor(card) : null;
        const backdrop = scenery ? null : await exportBackdropFor(card, choice, deps.backdropImage, deps.stageBackdropImage);
        if (signal.aborted) return null;
        const jobs: Promise<GifSample>[] = [];
        // 先拍最寬的（編最久，早點開始編）；編的時候同時拍下一個寬度
        for (const width of [...(scenery ? GIF_STAGE_ESTIMATE : GIF_ESTIMATE).widths].sort((a, b) => b - a)) {
          const shots: Uint8ClampedArray[] = [];
          const options = scenery ? stageOptions(card, width, choice, scenery) : turntableOptions(card, width, choice, backdrop);
          const size = await s.captureTurntable(
            { ...options, frames: GIF_ESTIMATE.frames },
            (rgba) => {
              shots.push(rgba);
            },
            signal,
          );
          const job = deps
            .encodeGif(shots, { width: size.width, height: size.height, delayMs: GIF_DELAY_MS }, undefined, signal)
            .then((blob) => ({ bytes: blob.size, frames: shots.length, width: size.width, height: size.height }));
          // 後面的寬度拍失敗時沒人等這個：先接住，免得變成沒處理的 rejection
          job.catch(noop);
          jobs.push(job);
        }
        return jobs;
      });
      return encodes ? await Promise.all(encodes) : null;
    } catch (err) {
      if (!signal.aborted) console.error(err);
      return null;
    }
  };

  /** exportTurntable 的拍與錄（副本已經準備好、輪到這次擷取了）。 */
  const renderTurntable = async (
    kind: TurntableKind,
    card: Card,
    width: number,
    stageWidth: number,
    choice: ExportChoice | undefined,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    video: VideoExportOptions | undefined,
    music: VideoExportOptions['music'],
    onInfo: ((info: Mp4Info) => void) | undefined,
  ): Promise<TurntableOutcome> => {
    try {
      const s = deps.scene();
      if (!s) throw new Error('3D 預覽沒有準備好');
      if (signal.aborted) return 'cancelled';
      const { frames } = TURNTABLE;
      // 連舞台一起錄（T-850）：CSS 那層（圖讀不到＝這次失敗）；不勾＝畫上背景照舊
      const scenery = recordsStage(card, choice) ? await sceneryFor(card) : null;
      const backdrop = scenery ? null : await exportBackdropFor(card, choice, deps.backdropImage, deps.stageBackdropImage);
      if (signal.aborted) return 'cancelled';
      const options = scenery ? stageOptions(card, stageWidth, choice, scenery) : turntableOptions(card, width, choice, backdrop);
      let blob: Blob;
      /** 影片的格式（沒寫＝WebM，T-514 以前的呼叫）。 */
      const format = video?.format ?? 'webm';
      if (kind === 'webm') {
        const plan = videoPlan(video?.laps ?? 1);
        // 配樂：從起始秒取影片那麼長、結尾淡出（音樂只用在這支影片，不存進卡片）
        let audio: WebmAudio | undefined;
        if (music) {
          try {
            audio = await deps.prepareMusic(music.file, { startSec: music.startSec, durationSec: plan.seconds });
          } catch (err) {
            if (signal.aborted) return 'cancelled';
            console.error(err);
            deps.showError(musicErrorText(err));
            return 'failed';
          }
          if (signal.aborted) return 'cancelled';
        }
        // 影片：拍好一格就交給錄影（不用先把整段存在記憶體裡）；n 個來回＝同一個來回連拍 n 次，進度照整體格數
        const laps = captureLaps(plan.laps, frames, TURNTABLE.startTime, loopSpan, (startTime, onFrame, sig) =>
          s.captureTurntable(
            // 連舞台一起錄（T-850）：第幾圈帶給 render（舞台的動畫接著前一圈走）
            options.stage
              ? { ...options, startTime, stage: { ...options.stage, lap: Math.round((startTime - TURNTABLE.startTime) / loopSpan) } }
              : { ...options, startTime },
            onFrame,
            sig,
          ),
        );
        blob = await recordWhileCapturing(
          options.width,
          (onFrame, sig) =>
            laps(async (rgba, index) => {
              await onFrame(rgba, index);
              onProgress(turntableProgress('webm', 'capture', index + 1, plan.frames));
            }, sig),
          (height, produce, sig) => {
            const recordOptions = { width: options.width, height, fps: TURNTABLE_FPS, audio };
            if (format === 'webm') return deps.recordWebm(recordOptions, produce, sig);
            // MP4：實際用的編碼（聲音是不是 Opus）轉交畫面；已經取消就不轉
            return recordMp4(recordOptions, produce, sig, (info) => {
              if (!signal.aborted) onInfo?.(info);
            });
          },
          signal,
        );
      } else {
        // GIF：一個來回拍好（0～50%）再一次合成（50～100%，全部畫格共用一組調色盤）
        const shots: Uint8ClampedArray[] = [];
        const size = await s.captureTurntable(
          options,
          (rgba, index) => {
            shots.push(rgba);
            onProgress(turntableProgress('gif', 'capture', index + 1, frames));
          },
          signal,
        );
        blob = await deps.encodeGif(
          shots,
          { width: size.width, height: size.height, delayMs: GIF_DELAY_MS },
          (done, total) => onProgress(turntableProgress('gif', 'encode', done, total)),
          signal,
        );
      }
      // 做好了才發現取消（例如做到最後一格時被別的分頁接手）：不下載
      if (signal.aborted) return 'cancelled';
      deps.download(blob, safeFileName(card.name, kind === 'webm' ? VIDEO_EXT[format] : '.gif'));
      return 'done';
    } catch (err) {
      const text = turntableErrorText(kind, err);
      if (text === null || signal.aborted) return 'cancelled';
      console.error(err);
      deps.showError(text);
      return 'failed';
    }
  };

  /**
   * 轉動的影片／GIF（SCHEMA §5）：見檔頭。動作 choice（轉一圈／左右擺動）；GIF 寬 width（320／400／480）；
   * 影片的選項 video（轉幾圈、配樂；有音樂就先準備好，準備中按了取消就等它做完、丟掉結果、不開始錄）。
   */
  const exportTurntable = async (
    kind: TurntableKind,
    width: number,
    stageWidth: number,
    choice: ExportChoice | undefined,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    video?: VideoExportOptions,
    onInfo?: (info: Mp4Info) => void,
  ): Promise<TurntableOutcome> => {
    const current = deps.card();
    if (!current || frozen) return 'failed';
    // 瀏覽器沒有內建的影片功能：不用開始做，直接請使用者改用 GIF
    if (kind === 'webm' && !deps.canRecordVideo()) {
      deps.showError(VIDEO_UNSUPPORTED_TEXT);
      return 'failed';
    }
    const music = kind === 'webm' ? (video?.music ?? null) : null;
    // 有選音樂但瀏覽器不能加聲音：不用開始做（選音樂時已經擋過，這裡保險）
    if (music && !deps.canAddMusic()) {
      deps.showError(MUSIC_UNSUPPORTED_TEXT);
      return 'failed';
    }
    const card = structuredClone(current);
    frozen = card;
    let releaseImages = noop;
    let releaseThumbnails = noop;
    try {
      // 和複製同一刻（中間沒有 await）：之後換卡也不會收掉副本的圖、不會拍到副本當縮圖
      releaseImages = deps.holdImages(cardImageHashes(card));
      releaseThumbnails = deps.holdThumbnails();
      deps.refresh();
      return await exclusiveCapture(() => renderTurntable(kind, card, width, stageWidth, choice, onProgress, signal, video, music, onInfo));
    } finally {
      // 畫面換回編輯中的卡；換回時拋錯也一定放開圖與縮圖（不然之後換卡收不掉圖、縮圖一直不拍）
      frozen = null;
      try {
        deps.refresh();
      } finally {
        try {
          releaseImages();
        } finally {
          releaseThumbnails();
        }
      }
    }
  };

  return {
    frozenCard: () => frozen,
    // 沒有選項的舊入口（現在畫面都先出選項小框）：轉一圈、影片寬 720／GIF 寬 480
    exportTurntable: (kind, onProgress, signal) => {
      const width = kind === 'webm' ? TURNTABLE.webmWidth : TURNTABLE.gifWidth;
      return exportTurntable(kind, width, width, undefined, onProgress, signal);
    },
    // 連舞台一起錄（T-850）時的寬：影片 STAGE_VIDEO_WIDTH、GIF 照大小（gifWidth(size, true)）
    exportVideo: (video, onProgress, signal, onInfo) =>
      exportTurntable('webm', TURNTABLE.webmWidth, STAGE_VIDEO_WIDTH, video, onProgress, signal, video, onInfo),
    canMakeMp4,
    exportGif: (gif, onProgress, signal) => exportTurntable('gif', gifWidth(gif.size), gifWidth(gif.size, true), gif, onProgress, signal),
    estimateGif,
  };
}
