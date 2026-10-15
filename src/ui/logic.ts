// 畫面用的純邏輯（不碰 DOM，可以在 node 測）：清單順序、拖拉排序對應、上傳錯誤的白話文字、快捷鍵判斷、大小滑桿刻度、
// 鐳射設定的白話與提示、使用者可調外觀（鐳射色彩選項、顏色表、陰影）、轉一圈影片／GIF 的進度與白話（T-504）、
// 轉動影片的長度與配樂選項（T-509b）；動作（轉一圈／左右擺動＋角度）、GIF 大小與預估檔案大小（T-512）；影片格式 MP4／WebM（T-514）。

import { S } from '../i18n';
import { HOLOCARD_EXT, MUSIC_MAX_BYTES, type ImportError, type Mp4Info } from '../file/types';
import type { IngestError } from '../images/types';
import { altBlocked, blendAllowed, clipBlocked, clipParent, layerBlend, layerBreakout, layerClip, layerLineart, layerOpacity, waterLookOf, waterSceneOf } from '../model/actions';
import { DEFAULT_WATER_LOOK, firstChars, HOLO_COLOR_COUNT, MIST_WATER_LOOK, NAME_MAX, RANGE, WATER_LOOK_PRESETS } from '../model/limits';
import { CARD_STYLE_VALUES, type CardStyle } from '../model/styles';
import {
  BLEND_MODES,
  HOLO_PALETTES,
  MAX_FX_PER_FACE,
  type Aspect,
  type BlendMode,
  type Card,
  type FoilShape,
  type FxKind,
  type HoloPalette,
  type Layer,
  type WaterLook,
  type WaterScene,
} from '../model/types';
import { fxBlocked } from '../model/fx';
import { ZOOM_DEFAULT } from '../interact/view';
import { customAspectProblem } from '../model/aspect';
import { boundingRadius, cardBox } from '../render/fit';
import { SPECTRUM_STOPS } from '../render/holo';
import { CAPTURE_MARGIN } from '../render/pick';
import { STORY_ENABLED } from './story';
import type { GifSample, GifSize, SaveStatus, TurntableKind, TurntableMotion, UiMessage, VideoFormat, VideoLaps } from './types';

// ---- 圖層清單 ----

/**
 * 清單顯示順序：最前面的在最上面（和 Photoshop 一樣）。資料陣列是由後到前，所以反過來；
 * 底圖不管在哪都放最下面。不改輸入陣列。
 */
export function displayOrder(layers: readonly Layer[]): Layer[] {
  const reversed = layers.slice().reverse();
  return [...reversed.filter((l) => l.role !== 'base'), ...reversed.filter((l) => l.role === 'base')];
}

/**
 * 清單拖拉：把 dragId 那一列放到畫面上第 overIndex 列 → 要和哪一層交換深度。
 * 放回自己、拖底圖、拖到底圖那一列、超出清單 → null（不交換）。rows＝畫面順序（displayOrder 的結果）。
 * 剪裁（T-803，layers＝這一面的資料陣列）：剪裁中的層不能拖（null）；放到剪裁中的層上＝和它下面那層換
 * （剪裁層跟著下面那層走）；那就是拖的這層自己 → null。
 */
export function swapTarget(rows: readonly Layer[], dragId: string, overIndex: number, layers: readonly Layer[] = []): string | null {
  const dragged = rows.find((l) => l.id === dragId);
  if (!dragged || dragged.role === 'base') return null;
  const parentOf = (id: string): Layer | null => {
    const i = layers.findIndex((l) => l.id === id);
    const p = i < 0 ? null : clipParent({ layers }, i);
    return p === null ? null : layers[p]!;
  };
  if (parentOf(dragId)) return null;
  const over = rows[overIndex];
  const target = over ? (parentOf(over.id) ?? over) : undefined;
  if (!target || target.id === dragId || target.role === 'base') return null;
  return target.id;
}

/** 指標的 y 落在第幾列（列與列之間的縫算比較近的那一列；超出上下夾到兩端；沒有列回 -1）。 */
export function indexAtY(y: number, rects: readonly { top: number; bottom: number }[]): number {
  if (rects.length === 0) return -1;
  let best = 0;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

// ---- 舞台背景（DESIGN §5） ----

/**
 * 預覽區背景要用哪張圖：目前這張卡「正面」的底圖（放大模糊當氣氛）。
 * 正面沒有底圖、或底圖被隱藏 → null（用深藍漸層）。回傳圖片雜湊。
 */
export function stageBackdrop(card: Pick<Card, 'front'>): string | null {
  const base = card.front.layers.find((l) => l.role === 'base');
  return base && base.visible ? base.image : null;
}

/**
 * 預覽區 CSS 那層顯示哪張圖（T-814）：這張卡有舞台背景圖、而且舞台不是水鏡 → 背景圖本身（custom：鋪滿、不模糊、約 85% 亮度＋淡暗角，
 * 各舞台的底色不蓋掉它）；水鏡的遠景由 3D 畫（render/water-fx.ts，倒影裡才看得到），CSS 照舊。
 * 展示廳、沒有自己的背景圖（T-816）→ { hall: true }：畫好的大廳（圖由 main 第一次要用時才讀，UiState.galleryHallUrl；還沒讀好照以前的深藍底）。
 * 工作桌、沒有自己的背景圖（T-832）→ { desk: true }：清楚的木桌（和頁面背景同一張圖，style.css 的 T-832 段直接鋪，不用另外讀）。
 * 其他情況照 stageBackdrop（正面底圖的模糊版）；都沒有＝null（深藍漸層）。
 */
export function stageBackdropView(
  card: Pick<Card, 'front' | 'view'>,
): { hash: string; custom: boolean } | { hall: true } | { desk: true } | null {
  const custom = card.view.backdrop;
  if (custom !== undefined && card.view.stage !== 'water') return { hash: custom, custom: true };
  if (card.view.stage === 'gallery') return { hall: true };
  if (card.view.stage === 'desk') return { desk: true };
  const base = stageBackdrop(card);
  return base === null ? null : { hash: base, custom: false };
}

// ---- 上傳回饋（DESIGN §4） ----

export type UploadProblemReason = IngestError | 'face-full' | 'invalid-input' | 'too-many-images';

export interface UploadProblem {
  fileName: string;
  reason: UploadProblemReason;
}

const PROBLEM_TEXT: Record<UploadProblemReason, string> = {
  'too-large': S.upload.tooLarge,
  'face-full': S.upload.faceFull,
  'not-image': S.upload.notImage,
  'decode-failed': S.upload.decodeFailed,
  'invalid-input': S.upload.invalidInput,
  'too-many-images': S.upload.tooManyImages,
};

export function problemText(reason: UploadProblemReason): string {
  return PROBLEM_TEXT[reason];
}

/** 訊息最多列幾個檔，其他用一句帶過。 */
const MAX_PROBLEM_LINES = 3;

/**
 * 一批上傳的問題 → 一則訊息（沒有問題回 null）。
 * 每一面滿了只說一次（照 DESIGN 原文，好幾張時附張數）；其他每個檔一行「檔名：原因」。
 */
export function uploadMessage(problems: readonly UploadProblem[]): UiMessage | null {
  if (problems.length === 0) return null;
  const lines: string[] = [];
  const full = problems.filter((p) => p.reason === 'face-full');
  if (full.length > 0) lines.push(full.length === 1 ? PROBLEM_TEXT['face-full'] : S.upload.faceFullMany(full.length));
  const others = problems.filter((p) => p.reason !== 'face-full');
  const room = Math.max(0, MAX_PROBLEM_LINES - lines.length);
  for (const p of others.slice(0, room)) lines.push(S.upload.fileProblem(p.fileName, PROBLEM_TEXT[p.reason]));
  const rest = others.length - Math.min(room, others.length);
  if (rest > 0) lines.push(S.upload.moreNotAdded(rest));
  return { kind: 'error', text: lines.join('\n') };
}

// ---- 保存與卡片檔（M4，DESIGN §7） ----

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = { saved: S.save.saved, saving: S.save.saving, error: S.save.error };

/** 頁首的存檔狀態小字（DESIGN 7.1）。 */
export function saveStatusText(status: SaveStatus): string {
  return SAVE_STATUS_TEXT[status];
}

export const STORAGE_LOW_TEXT = S.save.storageLow;
/** 換卡前目前這張存不起來：不換（DESIGN §7：東西永遠不會不見）。 */
export const NOT_SAVED_TEXT = S.save.notSaved;
export const CARD_MISSING_TEXT = S.save.cardMissing;
export const IMPORTING_TEXT = S.save.importing;
export const EXPORT_CARD_FAILED_TEXT = S.save.exportCardFailed;
export const EXPORT_PNG_FAILED_TEXT = S.save.exportPngFailed;
// 卡片庫面板（T-407）
export const RENAME_FAILED_TEXT = S.save.renameFailed;
export const COPY_FAILED_TEXT = S.save.copyFailed;
export const DELETE_FAILED_TEXT = S.save.deleteFailed;
/** 從範例開始：範例圖讀進來、字畫好要一點時間（新卡片面板已經關了）。 */
export const SAMPLE_PREPARING_TEXT = S.save.samplePreparing;

/** 匯入成功的訊息（DESIGN 7.5）。卡名照原樣（畫面用 textContent 顯示）。 */
export function importedText(name: string): string {
  return S.save.imported(name);
}

const NOT_CARD_FILE = S.save.notCardFile;
const BROKEN_CARD_FILE = S.save.brokenCardFile;
const NEWER_CARD_FILE = S.save.newerCardFile;

const IMPORT_ERROR_TEXT: Record<ImportError, string> = {
  // 不是 zip、zip 裡有卡片檔以外的東西、沒有 card.json：多半是拖錯檔
  'bad-zip': NOT_CARD_FILE,
  'bad-path': NOT_CARD_FILE,
  'missing-card': NOT_CARD_FILE,
  // 看得出是卡片檔，但內容不對或太大
  'too-large': BROKEN_CARD_FILE,
  'invalid-card': BROKEN_CARD_FILE,
  'missing-image': BROKEN_CARD_FILE,
  'bad-image': BROKEN_CARD_FILE,
  'newer-version': NEWER_CARD_FILE,
};

/** 匯入失敗的原因 → DESIGN 7.5 的三句白話之一；不認得的原因當成壞掉。 */
export function importErrorText(reason: ImportError): string {
  return Object.prototype.hasOwnProperty.call(IMPORT_ERROR_TEXT, reason) ? IMPORT_ERROR_TEXT[reason] : BROKEN_CARD_FILE;
}

/** 拖進來或選的檔是不是卡片檔（看副檔名，不分大小寫）。 */
export function isHolocardFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(HOLOCARD_EXT);
}

/**
 * 拖檔進來（還沒放開）時要顯示哪種提示：拖曳中只看得到每個檔的 MIME 類型。
 * `.holocard` 系統不認得、類型是空的 → 每個檔都沒有類型＝卡片檔（「放開就匯入卡片檔」）；其他照原本的「放開就加到…」。
 */
export function dropKind(types: readonly string[]): 'card-file' | 'images' {
  return types.length > 0 && types.every((t) => t === '') ? 'card-file' : 'images';
}

// ---- 轉一圈影片與 GIF（T-504，SCHEMA §5） ----

const TURNTABLE_MENU: Record<TurntableKind, { title: string; detail: string }> = {
  // T-514：影片可以選 MP4（手機也能播）或 WebM，選單不再寫格式
  webm: { title: S.export.videoTitle, detail: S.export.videoDetail },
  gif: { title: S.export.gifTitle, detail: S.export.gifDetail },
};

/** 〔匯出 ▾〕選單裡的名字與一行說明。 */
export function turntableMenu(kind: TurntableKind): { title: string; detail: string } {
  return TURNTABLE_MENU[kind];
}

/** 匯出中小面板的標題。 */
export function turntableTitle(kind: TurntableKind): string {
  return kind === 'webm' ? S.export.makingVideo : S.export.makingGif;
}

/** 做好、已經下載：面板顯示一下再關。 */
export const TURNTABLE_DONE_TEXT = S.export.done;
export const VIDEO_UNSUPPORTED_TEXT = S.export.videoUnsupported;
export const VIDEO_FAILED_TEXT = S.export.videoFailed;
export const GIF_FAILED_TEXT = S.export.gifFailed;

/** 轉一圈匯出的哪一段：拍下每一格（capture）、把畫格合成 GIF（encode；影片是邊拍邊錄，沒有這一段）。 */
export type TurntablePhase = 'capture' | 'encode';

const fraction01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * 整體進度（0～1）：GIF 分兩段（轉一圈 0～50%、合成 50～100%）；影片邊拍邊錄只有一段（拍到第幾格就是幾成）。
 * done／total 超出範圍夾在兩端；total 不合格當 0。
 */
export function turntableProgress(kind: TurntableKind, phase: TurntablePhase, done: number, total: number): number {
  const part = total > 0 ? fraction01(done / total) : 0;
  if (kind === 'webm') return phase === 'capture' ? part : 1;
  return phase === 'capture' ? part / 2 : 0.5 + part / 2;
}

/** 進度條旁的百分比（往下取整：還沒做完不會顯示 100%）。 */
export function progressPercent(fraction: number): string {
  return `${Math.floor(fraction01(fraction) * 100)}%`;
}

/**
 * 轉一圈匯出失敗 → 畫面上的白話（英文錯誤只寫 console）。取消（AbortError）不是錯誤 → null（不顯示訊息）。
 * 影片：瀏覽器不能做（沒有內建的影片功能、或不支援這種影片格式；錄影模組丟的錯誤訊息含 "not supported"）→ 請改用 GIF；
 * 只是不能加聲音（T-509b）→ 先匯出沒有音樂的影片。
 */
export function turntableErrorText(kind: TurntableKind, err: unknown): string | null {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === 'AbortError') return null;
  if (kind === 'gif') return GIF_FAILED_TEXT;
  // MP4 錄影模組（T-513）的兩種「做不了」：看錯誤名稱（訊息裡也有 not supported，但 MP4 做不了要叫人改用 WebM，不是 GIF）
  if (name === 'Mp4UnsupportedError') return MP4_UNSUPPORTED_TEXT;
  if (name === 'Mp4AudioUnsupportedError') return MP4_AUDIO_UNSUPPORTED_TEXT;
  const message = errorMessage(err);
  if (AUDIO_UNSUPPORTED.test(message)) return MUSIC_UNSUPPORTED_TEXT;
  return /not supported/i.test(message) ? VIDEO_UNSUPPORTED_TEXT : VIDEO_FAILED_TEXT;
}

// ---- 轉動影片的格式：MP4／WebM（T-514，DESIGN 7.1） ----

/** 格式的分段按鈕（順序）：MP4 在前（推薦）。 */
export const VIDEO_FORMATS: readonly VideoFormat[] = ['mp4', 'webm'];

const VIDEO_FORMAT_OPTION: Record<VideoFormat, { label: string; detail: string }> = {
  mp4: { label: 'MP4', detail: S.export.mp4Recommended },
  webm: { label: 'WebM', detail: '' },
};

/** 格式按鈕上的字：「MP4」＋小字「（推薦，手機也能播）」；「WebM」。 */
export function videoFormatOption(format: VideoFormat): { label: string; detail: string } {
  return VIDEO_FORMAT_OPTION[format];
}

/** 這個瀏覽器不能做 MP4：格式那一列的小字（MP4 變淡、自動選 WebM）。 */
export const MP4_UNSUPPORTED_NOTE_TEXT = S.export.mp4UnsupportedNote;
/** 選了 MP4 但做的時候才發現不能做（錄影模組丟 Mp4UnsupportedError）。 */
export const MP4_UNSUPPORTED_TEXT = S.export.mp4Unsupported;
/** MP4 有配樂但聲音做不出來（錄影模組丟 Mp4AudioUnsupportedError）。 */
export const MP4_AUDIO_UNSUPPORTED_TEXT = S.export.mp4AudioUnsupported;
/** MP4 做完、聲音只能用 Opus 編（少數瀏覽器）：「好了！」下面的小字。 */
export const MP4_OPUS_NOTE_TEXT = S.export.mp4OpusNote;

/** 影片做好時「好了！」下面要不要加一行小字：MP4 的聲音是 Opus 才有；info＝MP4 錄影回報的（WebM 沒有＝null）。 */
export function videoDoneNote(info: Mp4Info | null): string | null {
  return info?.audioCodec === 'opus' ? MP4_OPUS_NOTE_TEXT : null;
}

// ---- 轉動影片的選項：長度、配樂（T-509b） ----

/** 每圈幾秒（＝app/files 的 TURNTABLE.seconds；ui 不 import app，測試核對兩邊一樣）。 */
export const LAP_SECONDS = 4;
/** 長度的分段按鈕：轉 1～3 圈。 */
export const VIDEO_LAPS: readonly VideoLaps[] = [1, 2, 3];

/** 轉 laps 圈的影片幾秒。 */
export function videoSeconds(laps: VideoLaps): number {
  return laps * LAP_SECONDS;
}

/** 長度分段按鈕上的字：「4 秒」＋小字「轉 1 圈」；左右擺動時小字寫「擺 1 次」（T-512）。 */
export function videoLengthOption(laps: VideoLaps, motion: TurntableMotion = 'turn'): { label: string; detail: string } {
  return { label: S.export.seconds(videoSeconds(laps)), detail: motion === 'swing' ? S.export.swingTimes(laps) : S.export.turnLaps(laps) };
}

// ---- 動作：轉一圈／左右擺動（T-512，使用者 2026-10-14） ----

/** 動作的分段按鈕（順序）。 */
export const MOTIONS: readonly TurntableMotion[] = ['turn', 'swing'];

const MOTION_LABEL: Record<TurntableMotion, string> = { turn: S.export.motionTurn, swing: S.export.motionSwing };

export function motionLabel(motion: TurntableMotion): string {
  return MOTION_LABEL[motion];
}

/** 擺動角度（左右各轉幾度）：5～60 度、整數、預設 30（render 的 captureTurntable 契約同一個範圍；使用者 2026-10-14：「角度給使用者自己輸入」）。 */
export const SWING_DEG = { min: 5, max: 60, default: 30 } as const;

/** 擺動角度取整數、夾在 5～60；不合格（NaN、無限大）用預設 30。 */
export function clampSwingDeg(value: number): number {
  if (!Number.isFinite(value)) return SWING_DEG.default;
  return Math.min(SWING_DEG.max, Math.max(SWING_DEG.min, Math.round(value)));
}

/** 擺動角度旁的小字。 */
export const SWING_NOTE_TEXT = S.export.swingNote;

/**
 * 上下角度（T-812，使用者 2026-10-15：「蠻順的，但只有左右角度，沒有上下仰角」）：轉的時候卡片上下點頭幾度——
 * 0～25 度、整數、預設 10（render 的 captureTurntable 契約同一個範圍，pick.ts 的 NOD_RANGE；0＝只有左右，和以前一樣）。
 */
export const NOD_DEG = { min: 0, max: 25, default: 10 } as const;

/** 上下角度取整數、夾在 0～25；不合格（NaN、無限大）用預設 10。 */
export function clampNodDeg(value: number): number {
  if (!Number.isFinite(value)) return NOD_DEG.default;
  // + 0：把 −0 變成 0（Math.round(−0.2) 是 −0）
  return Math.min(NOD_DEG.max, Math.max(NOD_DEG.min, Math.round(value))) + 0;
}

/** 上下角度旁的小字。 */
export const NOD_NOTE_TEXT = S.export.nodNote;

// ---- GIF 大小與預估檔案大小（T-512，使用者 2026-10-14：「GIF 匯出時給使用者自己選，顯示檔案會多大」） ----

/** GIF 一個來回幾格（＝app/files 的 TURNTABLE.frames；ui 不 import app，測試核對兩邊一樣）。 */
export const GIF_FRAMES = 80;

/** 三種大小（寬度都不超過 GIF 上限 480）。 */
export const GIF_SIZES: readonly { size: GifSize; name: string; width: number }[] = [
  { size: 'small', name: S.export.gifSmall, width: 320 },
  { size: 'medium', name: S.export.gifMedium, width: 400 },
  { size: 'large', name: S.export.gifLarge, width: 480 },
];

/** 第一次打開 GIF 選項小框選「中」（之後記住上次選的）。 */
export const DEFAULT_GIF_SIZE: GifSize = 'medium';

const gifSizeEntry = (size: GifSize) => GIF_SIZES.find((s) => s.size === size) ?? GIF_SIZES[1]!;

/** 連舞台一起錄（T-850）時三種大小的寬：橫的 16:9 畫面（高＝寬 × 9／16），小 480、中 600、大 720。 */
export const GIF_STAGE_WIDTHS: Readonly<Record<GifSize, number>> = { small: 480, medium: 600, large: 720 };

/** 那個大小的寬（像素）；withStage＝連舞台一起錄（T-850，GIF_STAGE_WIDTHS）。 */
export function gifWidth(size: GifSize, withStage = false): number {
  return withStage ? GIF_STAGE_WIDTHS[size] ?? GIF_STAGE_WIDTHS.medium : gifSizeEntry(size).width;
}

/** 大小按鈕上的字：「小（寬 320）」；連舞台一起錄（T-850）時寫那時的寬「小（寬 480）」。 */
export function gifSizeLabel(size: GifSize, withStage = false): string {
  return S.export.gifSizeLabel(gifSizeEntry(size).name, gifWidth(size, withStage));
}

export const GIF_ESTIMATING_TEXT = S.export.estimating;
export const GIF_ESTIMATE_NOTE = S.export.estimateNote;

// ---- 連舞台一起錄（T-850，DESIGN §7.1）：影片與 GIF 的選項小框〔開始匯出〕上面的勾選 ----

export const STAGE_RECORD_LABEL = S.export.stageRecord;
/** 滑過勾選的說明。 */
export const STAGE_RECORD_TIP = S.export.stageRecordTip;
/** 舞台是「關」時（勾選變淡）滑過的說明。 */
export const STAGE_RECORD_OFF_TIP = S.export.stageRecordOff;
/** GIF 的小框勾著時多一句小字。 */
export const STAGE_GIF_NOTE = S.export.stageGifNote;

/**
 * 預估 GIF 檔案大小（位元組）＝這個寬度的「每格平均大小」× frames 格。每格平均大小從試編結果來：
 * - 兩種以上寬度（T-512b）：每格大小 ∝ 寬^k，k 由夾住這個寬度的兩筆算（超出範圍用最近的兩筆）。GIF 每格分開壓縮，
 *   純色、漸層的卡越大越省（實測 k 約 1.5～1.8，不是照像素數的 2），照像素數推會高估 33～50%。
 * - 只有一種寬度：照像素數等比例推（高度照試編的比例）。
 * 不合格的試編結果（大小、格數、寬高不是正的有限數字）略過；都不合格 → null（畫面不顯示數字）。
 * 輸入都合格也可能算壞（T-512c：極端的數字讓每格大小、k 或結果溢位成 Infinity、下溢成 0）→ null，不顯示成「約 1 KB」。
 */
export function estimateGifBytes(samples: readonly GifSample[], width: number, frames = GIF_FRAMES): number | null {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  if (!ok(width) || !ok(frames)) return null;
  // 每個寬度一筆（同寬度重複的取後面那筆），照寬度排
  const byWidth = new Map<number, GifSample>();
  for (const s of samples) if (ok(s.bytes) && ok(s.frames) && ok(s.width) && ok(s.height)) byWidth.set(s.width, s);
  const points = [...byWidth.values()].sort((a, b) => a.width - b.width);
  const perFrame = (s: GifSample) => s.bytes / s.frames;
  if (points.length === 0) return null;
  const result = (bytes: number) => (ok(bytes) ? bytes : null);
  if (points.length === 1) {
    const s = points[0]!;
    const perPixel = perFrame(s) / (s.width * s.height);
    if (!ok(perPixel)) return null;
    return result(perPixel * width * ((s.height * width) / s.width) * frames);
  }
  let i = 0;
  while (i < points.length - 2 && width > points[i + 1]!.width) i++;
  const a = points[i]!;
  const b = points[i + 1]!;
  if (!ok(perFrame(a)) || !ok(perFrame(b))) return null;
  // 負的 k（越大越省）照算；只擋算不出來的（Infinity、NaN）
  const k = Math.log(perFrame(b) / perFrame(a)) / Math.log(b.width / a.width);
  if (!Number.isFinite(k)) return null;
  return result(perFrame(a) * (width / a.width) ** k * frames);
}

const MB = 1024 * 1024;

/** 檔案大小：「約 4.9 MB」（1 MB＝1024×1024 位元組，和檔案總管一樣）；不到 0.1 MB 用「約 40 KB」。 */
export function fileSizeText(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b >= 0.1 * MB) return S.export.aboutMb((b / MB).toFixed(1));
  return S.export.aboutKb(Math.max(1, Math.round(b / 1024)));
}

export const MUSIC_NOTE_TEXT = S.export.musicNote;
export const MUSIC_TOO_LARGE_TEXT = S.export.musicTooLarge(MUSIC_MAX_BYTES / (1024 * 1024));
export const MUSIC_TOO_LONG_TEXT = S.export.musicTooLong;
export const MUSIC_UNREADABLE_TEXT = S.export.musicUnreadable;
export const MUSIC_UNSUPPORTED_TEXT = S.export.musicUnsupported;

/** 瀏覽器沒有加聲音需要的功能（聲音模組、錄影模組丟的錯誤訊息）。只有「格式不支援」的解碼錯誤不算（那是檔案的問題）。 */
const AUDIO_UNSUPPORTED = /(AudioEncoder|AudioData|OfflineAudioContext|audio encoding)\b.*not supported/i;

const errorMessage = (err: unknown) => (err instanceof Error || err instanceof DOMException ? err.message : '');

/** 選了音樂檔：超過大小上限就直接說（不用讀）；其他 → null。 */
export function musicFileProblem(size: number): string | null {
  return size > MUSIC_MAX_BYTES ? MUSIC_TOO_LARGE_TEXT : null;
}

/** 讀音樂、準備配樂失敗 → 白話：太大、太長（超過 15 分鐘）、瀏覽器不能加聲音；其他都當讀不出來（請他換一個檔）。 */
export function musicErrorText(err: unknown): string {
  const message = errorMessage(err);
  if (/too large/i.test(message)) return MUSIC_TOO_LARGE_TEXT;
  if (/too long/i.test(message)) return MUSIC_TOO_LONG_TEXT;
  if (AUDIO_UNSUPPORTED.test(message)) return MUSIC_UNSUPPORTED_TEXT;
  return MUSIC_UNREADABLE_TEXT;
}

/**
 * 從第幾秒開始的上限：音樂長度 − 影片長度（整數秒，往下取整），影片那一段一定整段有音樂、結尾淡出落在音樂上；
 * 音樂比影片短或長度不合格 → 0。
 */
export function maxMusicStart(musicSec: number, videoSec: number): number {
  if (!Number.isFinite(musicSec) || !Number.isFinite(videoSec)) return 0;
  return Math.max(0, Math.floor(musicSec - videoSec));
}

/** 起始秒數取整數、夾在 0～上限（換影片長度時也用它重新夾）；不合格當 0。 */
export function clampMusicStart(value: number, musicSec: number, videoSec: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maxMusicStart(musicSec, videoSec), Math.max(0, Math.round(value)));
}

/** 秒數 → 「3:25」（超過一小時「1:02:03」）；往下取整，不合格當 0。 */
export function formatClock(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 起始秒數旁的說明：「影片會用 0:42～0:46 這一段」；音樂比影片短就加「，後面沒有聲音」。 */
export function musicRangeText(startSec: number, videoSec: number, musicSec: number): string {
  const end = Math.min(startSec + videoSec, musicSec);
  const text = S.export.musicRange(formatClock(startSec), formatClock(end));
  return startSec + videoSec > musicSec ? S.export.musicRangeSilent(formatClock(startSec), formatClock(end)) : text;
}

/** 太長的檔名：中間換成「…」、保留副檔名（最多 8 個字含點），總長不超過 max 個字（emoji、中文不會切壞）。 */
export function shortFileName(name: string, max = 26): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
  const keepExt = ext.length > 1 && ext.length <= 8 && ext.length < max - 1 ? ext : [];
  const head = chars.slice(0, max - keepExt.length - 1);
  return `${head.join('')}…${keepExt.join('')}`;
}

// ---- 鍵盤 ----

export type Shortcut = 'undo' | 'redo';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Ctrl+Z 復原；Ctrl+Shift+Z、Ctrl+Y 重做（Mac 的 Cmd 也算）。焦點在文字輸入框時不攔，讓它自己的復原運作。 */
export function shortcutFor(e: KeyLike, typingInText: boolean): Shortcut | null {
  if (typingInText || e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

// ---- 只用鍵盤操作（DESIGN §8.2，T-607） ----

/** 按鍵事件裡判斷「是不是單按」要看的欄位（DOM 的 KeyboardEvent 本身就符合）。 */
export interface PlainKeyLike {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

/**
 * 這個按鍵是不是「單按」（T-607c）：帶 Ctrl／Cmd／Alt 的組合（Ctrl+→ 跳字、Alt+← 上一頁、Ctrl+空白鍵切輸入法…）、
 * 輸入法選字中、已經被別人處理過（defaultPrevented）的都不是。T-607 加的鍵盤操作（單選群組、選單、圖層清單、預覽區 Delete、Tab 拉回面板）
 * 一律只收單按的鍵，其他的不攔、不做事。Shift 不算組合（Shift＝大步／小步、Shift+Tab）。
 */
export function plainKey(e: PlainKeyLike): boolean {
  return !(e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented);
}

/**
 * 面板（對話框）裡按 Tab：下一個要拿焦點的是第幾個（循環：最後一個再 Tab 回第一個，第一個 Shift+Tab 去最後一個）。
 * count＝面板裡能拿焦點的控制項有幾個、current＝現在焦點是第幾個（不在其中＝-1）。一個都沒有回 -1。
 */
export function nextTabStop(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

/**
 * 單選群組（radiogroup）裡按方向鍵：→ ↓ 往後、← ↑ 往前，到頭停住不繞回（同 T-416b 卡框樣式）；跳過不能選的（disabled）。
 * 回新的位置（停住就是原本的位置）；不是方向鍵回 null。
 */
export function radioStep(key: string, index: number, count: number, disabled: (i: number) => boolean = () => false): number | null {
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return null;
  for (let i = index + step; i >= 0 && i < count; i += step) if (!disabled(i)) return i;
  return index;
}

/** 圖層清單裡按鍵移動焦點：↑ ↓ 一列、Home／End 頭尾，到頭停住；不是這幾個鍵（或清單是空的）回 null。 */
export function listStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** 焦點在圖層那一列上：Enter＝選中、空白鍵＝顯示／隱藏（眼睛）。 */
export function layerRowKey(key: string): 'select' | 'toggle-visible' | null {
  if (key === 'Enter') return 'select';
  if (key === ' ' || key === 'Spacebar') return 'toggle-visible';
  return null;
}

/** 預覽區按 Delete（Mac 沒有 Delete 鍵，Backspace 也算）：選中了可以刪的圖層才要刪（直接刪，可以復原）。 */
export function deleteKeyWanted(e: PlainKeyLike & { key: string }, layerSelected: boolean): boolean {
  if (!layerSelected || !plainKey(e)) return false;
  return e.key === 'Delete' || e.key === 'Backspace';
}

/** 3D 預覽區的名字（朗讀用）：可以用 Tab 走到，方向鍵轉卡。 */
export const PREVIEW_LABEL = S.preview.label;

export type EscapeAction = 'cancel-drag' | 'close-panel' | 'close-menu' | 'keep-base' | 'deselect';

export interface EscapeContext {
  /** 正在拖圖層（移動／縮放）。 */
  layerDragging: boolean;
  /** 卡片庫或新卡片面板開著（T-407）：Esc 交給面板（關掉面板裡最上面的東西）。 */
  panelOpen?: boolean;
  /** 頁首的選單（我的卡片、新卡片、匯出）有一個開著。 */
  menuOpen: boolean;
  /** 取代底圖的確認框開著。 */
  confirmOpen: boolean;
  /** 焦點在文字輸入框（例如改圖層名字）。 */
  typingInText: boolean;
  /** 有選中的圖層。 */
  layerSelected: boolean;
}

/**
 * 按 Esc 要做什麼，優先順序由上到下：
 * 圖層拖曳中＝取消這次拖曳（由 interact/pointer 在捕獲階段處理，這裡只記優先順序）→
 * 卡片庫／新卡片面板開著＝交給面板（面板裡正在改名就不攔，讓輸入框自己取消）→ 頁首選單開著＝關選單 →
 * 焦點在文字輸入框＝不攔（null，輸入框自己處理）→ 確認框開著＝保留原本的 → 有選中圖層＝取消選取 → 其他不做事。
 */
export function escapeAction(c: EscapeContext): EscapeAction | null {
  if (c.layerDragging) return 'cancel-drag';
  if (c.panelOpen) return c.typingInText ? null : 'close-panel';
  if (c.menuOpen) return 'close-menu';
  if (c.typingInText) return null;
  if (c.confirmOpen) return 'keep-base';
  if (c.layerSelected) return 'deselect';
  return null;
}

/** 元素的樣子（DOM 元素本身就符合）；測試用一般物件。 */
export interface ElementLike {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

const NON_TEXT_INPUTS = new Set(['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image']);

/** 這個元素是不是在打字的地方（文字框、多行文字、可編輯區）。 */
export function isTextEntry(el: ElementLike | null): boolean {
  // 按鍵事件的目標也可能不是元素（例如發在 window 上）：當成不是在打字
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase());
  return false;
}

// ---- 打字停手才送（文字圖層：停 0.6 秒才重畫並記一步，不要每個字都記一步） ----

export const TEXT_IDLE_MS = 600;

export interface Debounced<T> {
  /** 收到新的值：重新計時，停手 ms 毫秒後送出最後一個值。 */
  push(value: T): void;
  /** 馬上送出還沒送的（例如離開輸入框、換選別的圖層）；沒有待送的就不做事。 */
  flush(): void;
  /** 丟掉還沒送的。 */
  cancel(): void;
  pending(): boolean;
}

export function debounce<T>(fire: (value: T) => void, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: { value: T } | null = null;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    stop();
    const w = waiting;
    waiting = null;
    if (w) fire(w.value);
  };
  return {
    push(value) {
      stop();
      waiting = { value };
      timer = setTimeout(flush, ms);
    },
    flush,
    cancel() {
      stop();
      waiting = null;
    },
    pending: () => waiting !== null,
  };
}

// ---- 大小滑桿：對數刻度（小的範圍比較好調） ----

export const SCALE_SLIDER_MAX = 1000;
const SCALE_RATIO = RANGE.scale.max / RANGE.scale.min;

export function scaleToSlider(scale: number): number {
  const s = Math.min(RANGE.scale.max, Math.max(RANGE.scale.min, scale));
  return (Math.log(s / RANGE.scale.min) / Math.log(SCALE_RATIO)) * SCALE_SLIDER_MAX;
}

export function sliderToScale(v: number): number {
  const t = Math.min(1, Math.max(0, v / SCALE_SLIDER_MAX));
  return RANGE.scale.min * Math.pow(SCALE_RATIO, t);
}

// ---- 鐳射（DESIGN §3） ----

/** 強度滑桿旁的字：0＝關。 */
export function holoStrengthText(v: number): string {
  const n = Math.round(v);
  return n <= 0 ? S.holo.off : String(n);
}

/** 閃星滑桿旁的字：0＝沒有。 */
export function sparkleText(v: number): string {
  const n = Math.round(v);
  return n <= 0 ? S.holo.sparkleNone : String(n);
}

// ---- 反光層（T-417，DESIGN「反光層」）：取代鐳射小節原本的「範圍」 ----

export const FOIL_TITLE = S.foil.title;
export const FOIL_HELP = S.foil.help;
/** 右欄的形狀三選一（「關」由左欄那一列的眼睛切換）。 */
export const FOIL_SHAPE_OPTIONS: readonly { value: Exclude<FoilShape, 'none'>; label: string }[] = [
  { value: 'full', label: S.foil.shapeFull },
  { value: 'layers', label: S.foil.shapeLayers },
  { value: 'mask', label: S.foil.shapeMask },
];
export const FOIL_PICK_MASK = S.foil.pickMask;
export const FOIL_MASK_HELP = S.foil.maskHelp;
export const FOIL_FRAME_LABEL = S.foil.frameLabel;
export const FOIL_FRAME_OFF_TEXT = S.foil.frameOff;
export const MATTE_LABEL = S.foil.matteLabel;
export const MATTE_HELP = S.foil.matteHelp;
/** 反光層關著（左欄的眼睛關了）時右欄的說明（DESIGN 沒寫，T-417 子代理加）。 */
export const FOIL_OFF_NOTE = S.foil.offNote;

/** 左欄那一列名字下面的小字：目前的形狀。 */
export function foilShapeText(shape: FoilShape): string {
  switch (shape) {
    case 'full':
      return S.foil.shapeFull;
    case 'layers':
      return S.foil.shapeLayers;
    case 'mask':
      return S.foil.shapeMaskShort;
    case 'none':
      return S.foil.shapeNone;
  }
}

/** 霧光滑桿旁的字：0＝不反光。 */
export function matteText(v: number): string {
  const n = Math.round(v);
  return n <= 0 ? S.foil.matteNone : String(n);
}

// ---- 使用者可調外觀（T-310） ----

export interface PaletteOption {
  value: HoloPalette;
  name: string;
}

/** 鐳射色彩的七個選項（DESIGN §3）。 */
export const HOLO_PALETTE_OPTIONS: readonly PaletteOption[] = [
  { value: 'warm', name: S.palette.warm },
  { value: 'classic', name: S.palette.classic },
  { value: 'silver', name: S.palette.silver },
  { value: 'gold', name: S.palette.gold },
  { value: 'aurora', name: S.palette.aurora },
  { value: 'galaxy', name: S.palette.galaxy },
  { value: 'custom', name: S.palette.custom },
];

/** 某個色彩選項的 4 色：預設的用色票表，自訂用卡片自己的 colors。 */
export function paletteColors(palette: HoloPalette, custom: readonly string[]): readonly string[] {
  return palette === 'custom' ? custom : HOLO_PALETTES[palette];
}

/** 小色塊上的漸層：4 色放在色譜上的位置（render/holo.ts 的 SPECTRUM_STOPS）。angle 預設 90（橫的）；風格按鈕用斜的（T-801）。 */
export function paletteGradient(colors: readonly string[], angle = 90): string {
  const stops = colors.map((c, i) => `${c} ${Math.round((SPECTRUM_STOPS[i] ?? 1) * 100)}%`);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

// ---- 一鍵卡片風格（T-801，右欄「卡片」最上面）----

export interface CardStyleOption {
  value: CardStyle;
  /** 按鈕上的名字，也是提示列裡的風格名。 */
  name: string;
  /** 滑鼠停著或朗讀時的一句白話說明。 */
  title: string;
}

/** 六種風格（畫面順序＝model 的 CARD_STYLES）。 */
export const CARD_STYLE_OPTIONS: readonly CardStyleOption[] = [
  { value: 'plain', name: S.style.plain, title: S.style.plainTip },
  { value: 'silver', name: S.style.silver, title: S.style.silverTip },
  { value: 'rainbow', name: S.style.rainbow, title: S.style.rainbowTip },
  { value: 'gold', name: S.style.gold, title: S.style.goldTip },
  { value: 'galaxy', name: S.style.galaxy, title: S.style.galaxyTip },
  { value: 'matte', name: S.style.matte, title: S.style.matteTip },
];

export const CARD_STYLE_TITLE = S.style.title;
/** 風格按鈕那一排的名字（朗讀用）。 */
export const CARD_STYLE_LABEL = S.style.label;
export const CARD_STYLE_HELP = S.style.help;

/** 按下風格之後的提示列：「套用了「銀箔」風格，可以再微調。」 */
export function styleAppliedText(style: CardStyle): string {
  const name = CARD_STYLE_OPTIONS.find((o) => o.value === style)?.name ?? '';
  return S.style.applied(name);
}

/** 普通＝素色灰、霧面＝淡淡的白。 */
const PLAIN_SWATCH = '#8d94a4';
const MATTE_SWATCH = ['#f1ede6', '#ffffff', '#e6e1d9'];

/** 風格按鈕上小色票的 CSS 漸層（斜的）：其他四種用該風格的鐳射色彩，不用圖檔。 */
export function styleSwatch(style: CardStyle): string {
  if (style === 'plain') return `linear-gradient(135deg, ${PLAIN_SWATCH}, ${PLAIN_SWATCH})`;
  if (style === 'matte') return `linear-gradient(135deg, ${MATTE_SWATCH.join(', ')})`;
  const palette = CARD_STYLE_VALUES[style].palette;
  return palette ? paletteGradient(HOLO_PALETTES[palette], 135) : `linear-gradient(135deg, ${PLAIN_SWATCH}, ${PLAIN_SWATCH})`;
}

/** 換掉自訂色彩的第 index 格（顏色存小寫），回新陣列；index 超出範圍就原樣複製。 */
export function replaceColor(colors: readonly string[], index: number, color: string): string[] {
  const next = colors.slice();
  if (Number.isInteger(index) && index >= 0 && index < HOLO_COLOR_COUNT && index < next.length) next[index] = color.toLowerCase();
  return next;
}

/** 自訂色彩的顏色表：一排好看的預設色（點了就換那一格；最後還有自選）。 */
export const COLOR_TABLE: readonly { color: string; name: string }[] = [
  { color: '#ff6b9d', name: S.colors.sakura },
  { color: '#ff4d4d', name: S.colors.vermilion },
  { color: '#ff9f5a', name: S.colors.orange },
  { color: '#ffd36b', name: S.colors.golden },
  { color: '#fff4e0', name: S.colors.cream },
  { color: '#ffffff', name: S.colors.white },
  { color: '#c9d3e0', name: S.colors.silverGray },
  { color: '#39ffc3', name: S.colors.mint },
  { color: '#2fd0ff', name: S.colors.sky },
  { color: '#4a7dff', name: S.colors.royal },
  { color: '#6b4dff', name: S.colors.indigo },
  { color: '#b26bff', name: S.colors.purple },
  { color: '#ff6bd6', name: S.colors.peach },
];

/** 陰影濃淡滑桿旁的字：0＝沒有。 */
export function shadowStrengthText(v: number): string {
  const n = Math.round(v);
  return n <= 0 ? S.shadow.none : String(n);
}

// ---- 不透明度與混合模式（T-408，DESIGN §3） ----

export interface BlendOption {
  value: BlendMode;
  /** 白話名。 */
  name: string;
  /** Photoshop 的原名（和白話名一樣的不寫）。 */
  original: string | null;
  /** 一句用途（正常不寫）。 */
  use: string | null;
}

/** 混合模式的七個選項（DESIGN §3 的字），順序同 BLEND_MODES。 */
export const BLEND_OPTIONS: readonly BlendOption[] = [
  { value: 'normal', name: S.blend.normal, original: null, use: null },
  { value: 'multiply', name: S.blend.multiply, original: S.blend.multiplyOriginal, use: S.blend.multiplyUse },
  { value: 'screen', name: S.blend.screen, original: S.blend.screenOriginal, use: S.blend.screenUse },
  { value: 'add', name: S.blend.add, original: S.blend.addOriginal, use: S.blend.addUse },
  { value: 'overlay', name: S.blend.overlay, original: S.blend.overlayOriginal, use: S.blend.overlayUse },
  { value: 'soft-light', name: S.blend.softLight, original: null, use: S.blend.softLightUse },
  { value: 'color', name: S.blend.color, original: S.blend.colorOriginal, use: S.blend.colorUse },
];

/** 沒有透明的圖只能用三種時，選項下面的說明（DESIGN §3）。 */
export const OPAQUE_BLEND_NOTE = S.blend.opaqueNote;

/** 右欄「衝出卡片」開關（T-411，DESIGN §3「破框」）。 */
export const BREAKOUT_LABEL = S.breakout.label;
export const BREAKOUT_HELP = S.breakout.help;

/** 這一層有沒有「衝出卡片」開關：立體層與文字層有，底圖沒有。 */
export function breakoutShown(layer: Pick<Layer, 'role'>): boolean {
  return layer.role === 'depth';
}

/** 衝出卡片的層整層不反光（T-411）：反光層選「用圖層形狀」時，左欄那一列的星星開關（與右欄的勾選）滑過時的說明（T-411b）。 */
export const BREAKOUT_NO_HOLO_TEXT = S.breakout.noHolo;

/** 有變身圖的層不能衝出卡片（T-805，SCHEMA：破框層不能有變身圖）：「衝出卡片」開關變淡時滑過的說明。 */
export const BREAKOUT_ALT_TEXT = S.breakout.alt;

/** 有動態特效的層不能衝出卡片（T-811，SCHEMA：破框層不能有特效）：「衝出卡片」開關變淡時滑過的說明。 */
export const BREAKOUT_FX_TEXT = S.breakout.fx;

/**
 * 「衝出卡片」開關的狀態：on 照這層的設定；有變身圖（T-805）或動態特效（T-811）、還沒衝出卡片 → locked（變淡、按了不改，
 * 滑過說明；兩個都有時先說變身圖）。開著的照樣能關（正常不會同時有變身圖、特效）。
 */
export function breakoutSwitch(layer: Pick<Layer, 'breakout' | 'alt' | 'fx'>): { on: boolean; locked: boolean; title: string } {
  const on = layerBreakout(layer);
  if (on) return { on, locked: false, title: '' };
  if (layer.alt !== undefined) return { on, locked: true, title: BREAKOUT_ALT_TEXT };
  if (layer.fx !== undefined) return { on, locked: true, title: BREAKOUT_FX_TEXT };
  return { on, locked: false, title: '' };
}

// ---- 局部動態特效（T-811，DESIGN「局部動態特效」）----

export const FX_TITLE = S.fx.title;
/** 小節標題下面那一句。 */
export const FX_HELP = S.fx.help;
/** 四個選項（單選群組）：value null＝無。title＝滑過的一句（DESIGN 的樣子）。 */
export const FX_OPTIONS: readonly { value: FxKind | null; label: string; title: string }[] = [
  { value: null, label: S.fx.none, title: S.fx.noneTip },
  { value: 'fire', label: S.fx.fire, title: S.fx.fireTip },
  { value: 'electric', label: S.fx.electric, title: S.fx.electricTip },
  { value: 'water', label: S.fx.water, title: S.fx.waterTip },
];
/** 衝出卡片的層：小節變淡時滑過的說明。 */
export const FX_BREAKOUT_TEXT = S.fx.breakout;
/** 這一面已經有 MAX_FX_PER_FACE 層有特效：第 3 層的選項變淡時的說明。 */
export const FX_FULL_TEXT = S.fx.faceFull(MAX_FX_PER_FACE);

/**
 * 右欄「動態特效」小節的狀態（layers＝這一面的資料陣列、index＝這層的位置）：kind＝目前的種類（沒有＝null）；
 * locked＝破框層（整個小節變淡、按了不改）；full＝這一面已經 MAX_FX_PER_FACE 層有特效、這層還沒有（火焰／電光／水波變淡，「無」照樣選著）；
 * title＝變淡的原因（滑過說明）。
 */
export function fxSection(layers: readonly Layer[], index: number): { kind: FxKind | null; locked: boolean; full: boolean; title: string } {
  const layer = layers[index];
  const kind = layer?.fx?.kind ?? null;
  const blocked = fxBlocked({ layers }, index);
  if (blocked === 'breakout') return { kind, locked: true, full: false, title: FX_BREAKOUT_TEXT };
  if (blocked === 'face-full') return { kind, locked: false, full: true, title: FX_FULL_TEXT };
  return { kind, locked: false, full: false, title: '' };
}

/**
 * 圖層清單那一列的反光星星（反光層選「用圖層形狀」時才出現；右欄反光層面板的勾選同一個）：'on'／'off' 照這層的開關；
 * 衝出卡片的層＝'locked'（變淡、按了不改，滑過說明不反光；關掉衝出卡片後照原本的開關）。
 */
export function layerHoloToggle(layer: Pick<Layer, 'holo' | 'breakout'>): { state: 'on' | 'off' | 'locked'; title: string } {
  if (layerBreakout(layer)) return { state: 'locked', title: BREAKOUT_NO_HOLO_TEXT };
  return layer.holo ? { state: 'on', title: S.layers.holoOn } : { state: 'off', title: S.layers.holoOff };
}

/** 右欄「沿線條反光」開關（T-802，DESIGN §1「線稿高光」）。 */
export const LINEART_LABEL = S.lineart.label;
export const LINEART_HELP = S.lineart.help;

/** 這一層有沒有「沿線條反光」開關：立體層有，底圖、文字層沒有。 */
export function lineartShown(layer: Pick<Layer, 'role' | 'text'>): boolean {
  return layer.role === 'depth' && layer.text === undefined;
}

/**
 * 「沿線條反光」開關的狀態：on 照這層的設定；衝出卡片的層整層不反光（T-411）→ locked（變淡、按了不改，
 * 滑過說明「衝出卡片的層不反光」；關掉衝出卡片後照原本的設定），同左欄反光星星的做法（layerHoloToggle）。
 */
export function lineartSwitch(layer: Pick<Layer, 'lineart' | 'breakout'>): { on: boolean; locked: boolean; title: string } {
  const locked = layerBreakout(layer);
  return { on: layerLineart(layer), locked, title: locked ? BREAKOUT_NO_HOLO_TEXT : '' };
}

/** 右欄「只畫在下面那層上」開關（T-803，DESIGN §3「剪裁遮色片」）。 */
export const CLIP_LABEL = S.clip.label;
export const CLIP_HELP = S.clip.help;
/** 開關變淡時滑過的說明：下面是底圖、或這層在最下面。 */
export const CLIP_NO_LAYER_TEXT = S.clip.noLayer;
/** 開關變淡時滑過的說明：這層或下面那層開了衝出卡片。 */
export const CLIP_BREAKOUT_TEXT = S.clip.breakout;
/** 剪裁中的層：深度滑桿旁邊、左欄拖把手滑過的字。 */
export const CLIP_FOLLOW_TEXT = S.clip.follow;

/** 這一層有沒有「只畫在下面那層上」開關：立體層與文字層有，底圖沒有。 */
export function clipShown(layer: Pick<Layer, 'role'>): boolean {
  return layer.role === 'depth';
}

/**
 * 「只畫在下面那層上」開關的狀態（layers＝這一面的資料陣列、index＝這層的位置）：on 照這層的設定；
 * 打開了也剪裁不成立（model 的 clipBlocked：下面是底圖、這層在最下面、任一方衝出卡片）→ 滑過說明為什麼；
 * 關著的才 locked（變淡、按了不改）——開著的照樣可以關掉（例如下面那層被刪了，T-803b）。
 */
export function clipSwitch(layers: readonly Layer[], index: number): { on: boolean; locked: boolean; title: string } {
  const layer = layers[index];
  const on = layer ? layerClip(layer) : false;
  const blocked = clipBlocked({ layers }, index);
  const title = blocked === 'no-layer' ? CLIP_NO_LAYER_TEXT : blocked === 'breakout' ? CLIP_BREAKOUT_TEXT : '';
  return { on, locked: blocked !== null && !on, title };
}

// ---- 雙圖光柵的變身圖（T-805，DESIGN「雙圖光柵」）----

export const ALT_TITLE = S.alt.title;
export const ALT_ADD_LABEL = S.alt.add;
export const ALT_CHANGE_LABEL = S.alt.change;
export const ALT_REMOVE_LABEL = S.alt.remove;
/** 加了之後縮圖下面那一句（DESIGN 原文）。 */
export const ALT_HELP = S.alt.help;
/** 還沒加的時候〔加上變身圖〕下面那一句（DESIGN 沒寫，T-805 子代理加：沒有這句看不出按鈕要做什麼）。 */
export const ALT_EMPTY_HELP = S.alt.emptyHelp;
/** 衝出卡片的層：小節變淡時滑過的說明。 */
export const ALT_BREAKOUT_TEXT = S.alt.breakout;
/** 選的圖沒有透明背景、這層的混合模式又只能給有透明的圖用。 */
export const ALT_NEEDS_ALPHA_TEXT = S.alt.needsAlpha;
/** 變身圖沒有透明背景時，混合模式選項下面的說明。 */
export const ALT_OPAQUE_BLEND_NOTE = S.alt.opaqueNote;
/** 左欄縮圖角落的小標記。 */
export const ALT_TAG = S.alt.tag;

/**
 * 右欄「變身圖」小節的狀態：shown＝立體層（含加深層）有，底圖、文字層沒有；has＝已經有變身圖；
 * locked＝衝出卡片的層（變淡、按了不改，滑過說明；關掉衝出卡片後就能加）。
 */
export function altSection(layer: Pick<Layer, 'role' | 'text' | 'breakout' | 'alt'>): { shown: boolean; has: boolean; locked: boolean; title: string } {
  const blocked = altBlocked(layer);
  const shown = blocked === null || blocked === 'breakout';
  const locked = blocked === 'breakout';
  return { shown, has: layer.alt !== undefined, locked, title: locked ? ALT_BREAKOUT_TEXT : '' };
}

/** 左欄縮圖角落的「雙」：有變身圖才有。 */
export function layerAltTag(layer: Pick<Layer, 'alt'>): string | null {
  return layer.alt !== undefined ? ALT_TAG : null;
}

/** 變身圖加不上去 → 白話（那一層不在了＝null，不說）。 */
export function altProblemText(problem: 'needs-alpha' | 'too-many-images' | 'layer-gone'): string | null {
  if (problem === 'needs-alpha') return ALT_NEEDS_ALPHA_TEXT;
  if (problem === 'too-many-images') return problemText('too-many-images');
  return null;
}

function blendOption(mode: BlendMode): BlendOption {
  return BLEND_OPTIONS.find((o) => o.value === mode) ?? BLEND_OPTIONS[0]!;
}

/** 白話名＋括號原名，例如「發光（濾色）」；沒有原名的只有白話名。 */
export function blendLabel(mode: BlendMode): string {
  const o = blendOption(mode);
  return o.original ? S.blend.withOriginal(o.name, o.original) : o.name;
}

/**
 * 右欄「混合模式」：七個選項都列出來，這一層不能用的變淡（沒有透明的圖只能用三種，附說明）。
 * 變身圖沒有透明（T-805）也一樣只能用三種，說明改說是變身圖。
 */
export function blendChoices(layer: Pick<Layer, 'role' | 'hasAlpha' | 'alt'>): {
  choices: { option: BlendOption; enabled: boolean }[];
  note: string | null;
} {
  const choices = BLEND_MODES.map((mode) => ({ option: blendOption(mode), enabled: blendAllowed(layer, mode) }));
  if (layer.role !== 'depth') return { choices, note: null };
  if (!layer.hasAlpha) return { choices, note: OPAQUE_BLEND_NOTE };
  return { choices, note: layer.alt?.hasAlpha === false ? ALT_OPAQUE_BLEND_NOTE : null };
}

/** 不透明度滑桿旁的字：0＝看不見，其他是百分比。 */
export function opacityText(v: number): string {
  const n = Math.round(v);
  return n <= 0 ? S.inspector.opacityZero : `${n}%`;
}

/** 圖層清單那一列名字下面的小字：底圖＝底圖（T-837 起不再寫「背景」）；立體層＝深度。 */
export function layerSubText(layer: Layer): string {
  return layer.role === 'base' ? S.layers.baseSub : S.layers.depthSub(Math.round(layer.depth));
}

/**
 * 圖層清單縮圖角落的小標示（T-408）：混合模式不是正常時＝模式的白話名（例如「發光」），正常＝null（不顯示）。
 * 放在縮圖上而不是名字下面：清單那一欄很窄，「深度 100・發光」會被截掉。
 */
export function layerBlendTag(layer: Pick<Layer, 'blend'>): string | null {
  const blend = layerBlend(layer);
  return blend === 'normal' ? null : blendOption(blend).name;
}

/**
 * 圖層清單那一列的第三行（T-833，DESIGN §5「圖層清單」）：「{混合模式白話名}・不透明度 {N}%」，例如「發光・不透明度 80%」、「正常・不透明度 100%」
 * （混合模式名字和縮圖角落同一個，不是 Photoshop 原名）。底圖沒有混合模式與不透明度 → null（不顯示）；反光層不是圖層、清單那一列另外畫、沒有這一行。
 */
export function layerLookText(layer: Pick<Layer, 'role' | 'blend' | 'opacity'>): string | null {
  if (layer.role === 'base') return null;
  return S.layers.blendLine(blendOption(layerBlend(layer)).name, Math.round(layerOpacity(layer)));
}

// ---- AI 自動去背（T-703，DESIGN §3.1、§4）：上傳沒有透明的圖時的確認框、進度、問題、錯誤；白話，不出現技術名詞 ----
// T-703 起確認框不管有沒有底圖都問（T-408 起多「當發光層／當加深層」）。

export const UPLOAD_ASK_TITLE = S.ai.uploadAsk;
export const AI_CUTOUT_LABEL = S.ai.cutout;
export const AI_CUTOUT_DETAIL = S.ai.cutoutDetail;
export const AI_SPLIT_LABEL = S.ai.split;
export const AI_SPLIT_DETAIL = S.ai.splitDetail;
/** 已有底圖時〔拆成立體層〕說明後面加的（背景段會當底圖）。 */
export const AI_SPLIT_REPLACES_NOTE = S.ai.splitReplacesNote;
/** 〔拆成立體層〕T-704 才做：先變淡、標這幾個字。 */
export const AI_SOON_TEXT = S.ai.soon;
export const REPLACE_BASE_LABEL = S.ai.replaceBase;
export const AS_BASE_LABEL = S.ai.asBase;
/** 第二排〔當發光層〕〔當加深層〕旁邊的小字。 */
export const OPAQUE_LAYER_NOTE = S.ai.opaqueLayerNote;
/** 模型還沒下載：兩個 AI 按鈕變淡，旁邊這句。 */
export const AI_MODEL_MISSING_NOTE = S.ai.modelMissingNote;

export type OpaqueUploadChoice = 'cutout' | 'split' | 'replace' | 'base';

/** 確認框第一排的大按鈕（DESIGN §4）：已有底圖〔自動去背〕〔拆成立體層〕〔取代底圖〕；還沒有〔當底圖〕〔自動去背〕〔拆成立體層〕。 */
export function opaqueUploadChoices(hasBase: boolean): OpaqueUploadChoice[] {
  return hasBase ? ['cutout', 'split', 'replace'] : ['base', 'cutout', 'split'];
}

export const AI_LOADING_TEXT = S.ai.loading;
export const AI_CUTTING_TEXT = S.ai.cutting;
export const AI_CONTINUE_LABEL = S.ai.continue;
export const AI_SLOW_ASK_TEXT = S.ai.slowAsk;
export const AI_NO_SUBJECT_TEXT = S.ai.noSubject;
/** 去背後整張都沒有透明（整張都被當成主角）：一樣給〔當底圖〕〔取消〕。 */
export const AI_NO_BACKGROUND_TEXT = S.ai.noBackground;
/** 找不到主角，但已經換到別張卡（不能問要不要當底圖）。 */
export const AI_NO_SUBJECT_GONE_TEXT = S.ai.noSubjectGone;
export const AI_FAILED_TEXT = S.ai.failed;
export const AI_MODEL_MISSING_TEXT = S.ai.modelMissing(AI_MODEL_MISSING_NOTE);
/** 做完時開始的那張卡已經刪掉了：不加。 */
export const AI_CARD_GONE_TEXT = S.ai.cardGone;

/** 做完時已經換到別張卡：加到開始時那張（存檔裡），說一聲加到哪了。 */
export function aiStoredText(cardName: string): string {
  return S.ai.stored(cardName);
}

/**
 * AI 失敗 → 白話（DESIGN §4；英文原因只寫 console）。取消（AbortError）不是錯誤 → null。
 * 依 AiError.code：model-missing＝說怎麼下載模型；load-failed、run-failed、bad-output 和其他錯誤＝「AI 處理時出了問題…」。
 */
export function aiErrorText(err: unknown): string | null {
  const e = typeof err === 'object' && err !== null ? (err as { name?: unknown; code?: unknown }) : {};
  if (e.name === 'AbortError') return null;
  if (e.name === 'AiError' && e.code === 'model-missing') return AI_MODEL_MISSING_TEXT;
  return AI_FAILED_TEXT;
}

// ---- 拆成立體層（T-704，DESIGN §3.1、§4）----

/** 另一件 AI 工作（去背或拆層）還在做：兩個 AI 按鈕變淡，旁邊這句。 */
export const AI_WORKING_NOTE = S.ai.workingNote;
export const AI_SPLITTING_TEXT = S.ai.splitting;
/** 只拆出 1 段（或前面的段沒有透明）：〔當底圖〕〔取消〕。 */
export const AI_NO_DEPTH_TEXT = S.ai.noDepth;
/** 分不出遠近，但已經換到別張卡（不能問要不要當底圖）。 */
export const AI_NO_DEPTH_GONE_TEXT = S.ai.noDepthGone;
/** 做完時開始的那張卡已經刪掉了：不加。 */
export const AI_SPLIT_CARD_GONE_TEXT = S.ai.splitCardGone;

/** 做完時已經換到別張卡：加到開始時那張（存檔裡），說一聲加到哪了。 */
export function aiSplitStoredText(cardName: string): string {
  return S.ai.splitStored(cardName);
}

// ---- 右欄〔自動去背〕（T-703b，DESIGN §3.1）：選中沒有透明背景的立體層時，去背後換掉這一層的圖（其他設定不變） ----

/** 按鈕下面的小字（按鈕本身用 AI_CUTOUT_LABEL）。 */
export const LAYER_CUTOUT_HELP = S.ai.layerCutoutHelp;
/** 正在做別的 AI 工作（一次只做一件）：按鈕變淡，title 這句。 */
export const AI_LAYER_BUSY_TEXT = S.ai.layerBusy;
/** 開著的卡那一層換好了。 */
export const AI_REPLACED_TEXT = S.ai.replaced;
/** 找不到主角：這一層已經在卡上了，不問〔當底圖〕。 */
export const AI_REPLACE_NO_SUBJECT_TEXT = S.ai.replaceNoSubject;
/** 去背後整張都沒有透明（整張都被當成主角）：一樣不問。 */
export const AI_REPLACE_NO_BACKGROUND_TEXT = S.ai.replaceNoBackground;
/** 做完時開始的那張卡已經刪掉了。 */
export const AI_REPLACE_CARD_GONE_TEXT = S.ai.replaceCardGone;
/** 做完時那一層已經刪掉了（或那一層的圖已經被換掉：不蓋掉後來的改動）。 */
export const AI_REPLACE_LAYER_GONE_TEXT = S.ai.replaceLayerGone;

/** 做完時已經換到別張卡：改好存檔裡那張卡的那一層，說一聲改到哪了。 */
export function aiReplacedStoredText(cardName: string): string {
  return S.ai.replacedStored(cardName);
}

/** 右欄要不要有〔自動去背〕：沒有透明背景的立體層（不是文字層）才有；底圖、文字層、有透明的圖都沒有。 */
export function layerCutoutShown(layer: Pick<Layer, 'role' | 'text' | 'hasAlpha'>): boolean {
  return layer.role === 'depth' && !layer.text && !layer.hasAlpha;
}

/** 拆出來的每一段的名字（由遠到近，接在「檔名・」後面）：3 段遠／中／近；段數變少就照實際段數。 */
export function splitPartNames(count: number): string[] {
  switch (count) {
    case 1:
      return [S.ai.partFar];
    case 2:
      return [S.ai.partFar, S.ai.partNear];
    case 4:
      return [S.ai.partFar, S.ai.partMidFar, S.ai.partMidNear, S.ai.partNear];
    default:
      return [S.ai.partFar, S.ai.partMid, S.ai.partNear];
  }
}

/**
 * 拆層的圖層名：「檔名・遠」。圖層名最多 NAME_MAX 字（以字元計）：先替「・遠」留字數再截檔名，
 * 長檔名才不會把段名吃掉、三層變成同一個名字（T-704c）。
 */
export function splitLayerName(fileLayerName: string, part: string): string {
  const suffix = S.ai.partSuffix(part);
  const room = Math.max(0, NAME_MAX - Array.from(suffix).length);
  return `${firstChars(fileLayerName.trim(), room).trim()}${suffix}`;
}

/** 拆層需要的空間不夠（每面 8 層、每張卡 16 張圖）：layers＝這一面還能放幾層（會被取代的底圖那一格也算）；images＝這張卡還能放幾張圖。 */
export interface SplitRoomProblem {
  kind: 'layers' | 'images';
  space: number;
  need: number;
}

/** 空間不夠時先說（DESIGN §3.1）：「這一面只剩 N 層的空間，拆成立體層需要 M 層。」；圖片數同一個句型。 */
export function splitRoomText(p: SplitRoomProblem): string {
  return p.kind === 'layers'
    ? S.ai.splitNoLayerRoom(p.space, p.need)
    : S.ai.splitNoImageRoom(p.space, p.need);
}

// ---- 導覽與操作說明（T-606，DESIGN §8.1）：白話，不出現技術名詞 ----

/** 第一次使用的 4 步導覽，每一步一句話（依序圈：預覽區、左欄〔上傳圖片〕、右欄、頁首〔匯出 ▾〕）。 */
export const TOUR_STEP_TEXTS: readonly string[] = [
  S.tour.step1,
  S.tour.step2,
  S.tour.step3,
  S.tour.step4,
];

export const TOUR_LABEL = S.tour.label;
export const TOUR_NEXT_TEXT = S.tour.next;
export const TOUR_START_TEXT = S.tour.start;
export const TOUR_SKIP_TEXT = S.tour.skip;

// ---- 卡片比例（T-807，DESIGN「卡片比例」、§7.3 新卡片的「空白卡」） ----

/** 五種比例：名字、新卡片面板的小字（順序＝右欄與新卡片面板的順序）。 */
export const ASPECT_CHOICES: readonly { value: Aspect; name: string; detail: string }[] = [
  { value: 'standard', name: S.aspect.standard, detail: '63 × 88' },
  { value: 'tarot', name: S.aspect.tarot, detail: S.aspect.tarotDetail },
  { value: 'square', name: S.aspect.square, detail: '1 : 1' },
  { value: 'postcard', name: S.aspect.postcard, detail: '100 × 148' },
  { value: 'custom', name: S.aspect.custom, detail: S.aspect.customDetail },
];
/** 新卡片面板「空白卡」最後一個：CD 光碟（T-810，DESIGN「CD 光碟」）。 */
export const DISC_CHOICE = { name: S.aspect.disc, detail: S.aspect.discDetail } as const;
/** 光碟時左欄「背面」分頁灰掉，滑過的說明（T-810）。 */
export const DISC_BACK_TITLE = S.aspect.discBackTip;

/** 自訂寬高太扁或太長（超出 1:2～2:1）時框下面的說明（DESIGN）。 */
export const ASPECT_RATIO_ERROR = S.aspect.ratioError;
/** 自訂寬高不是 1～999 的整數（空白、0、小數…）時的說明。 */
export const ASPECT_SIDE_ERROR = S.aspect.sideError;
/** 右欄「自訂」寬高框下面的說明。 */
export const ASPECT_CUSTOM_HELP = S.aspect.customHelp;
/** 新卡片面板「自訂」的〔建立〕。 */
export const ASPECT_CREATE_TEXT = S.aspect.create;

/** 自訂寬高框的說明：合格回 null。 */
export function aspectInputError(width: string, height: string): string | null {
  const problem = customAspectProblem(numberOrNaN(width), numberOrNaN(height));
  return problem === 'side' ? ASPECT_SIDE_ERROR : problem === 'ratio' ? ASPECT_RATIO_ERROR : null;
}

/** 數字框的字串 → 數字（空白、不是數字＝NaN）。 */
export function numberOrNaN(text: string): number {
  return text.trim() === '' ? NaN : Number(text);
}

/**
 * 開啟工坊時 3D 還沒畫出來先顯示的縮圖要多高（預覽區高度的百分比，CSS 的 cqh）：預設縮放（ZOOM_DEFAULT）下 3D 卡片的高度
 * ×縮圖四邊的空邊（captureFrame 的 CAPTURE_MARGIN × 長邊）。鏡頭照外接球退（render/fit.ts），垂直視角 30°。
 * 標準卡約 72、塔羅牌約 77（T-807 以前寫死在 CSS 的值）；橫式卡比較矮。
 */
export function posterHeight(cardH: number): number {
  const halfV = (15 * Math.PI) / 180;
  const cardShare = (ZOOM_DEFAULT * Math.cos(halfV) * (cardH / 2)) / boundingRadius(cardBox(cardH));
  const margin = 1 + (2 * CAPTURE_MARGIN * Math.max(1, cardH)) / cardH;
  return 100 * cardShare * margin;
}

// ---- 透明卡套（T-806，DESIGN「透明卡套」） ----

/** 右欄開關的名字。 */
export const SLEEVE_LABEL = S.sleeve.label;
/** 右欄開關下面的說明句。 */
export const SLEEVE_HELP = S.sleeve.help;
/** 頁首匯出選單的勾選（卡片開著卡套才出現、預設勾）。 */
export const SLEEVE_EXPORT_LABEL = S.sleeve.exportLabel;
/** 勾選的提示：PNG、影片、GIF 都照它。 */
export const SLEEVE_EXPORT_TIP = S.sleeve.exportTip;

// ---- 舞台背景圖（T-814，DESIGN §5「舞台背景圖」、§7.1） ----

/** 右欄舞台六顆按鈕下面那一列的名字。 */
export const BACKDROP_TITLE = S.stage.backdropTitle;
/** 還沒有背景圖時的按鈕。 */
export const BACKDROP_ADD_LABEL = S.stage.backdropAdd;
/** 還沒有背景圖時按鈕下面的小字。 */
export const BACKDROP_EMPTY_HELP = S.stage.backdropEmptyHelp;
export const BACKDROP_CHANGE_LABEL = S.stage.backdropChange;
export const BACKDROP_REMOVE_LABEL = S.stage.backdropRemove;
/** 頁首匯出選單的勾選（這張卡有背景圖才出現、預設勾；和「透明背景」只能選一個）。 */
export const BACKDROP_EXPORT_LABEL = S.stage.backdropExportLabel;
/** 勾選的提示：PNG、影片、GIF 都照它。 */
export const BACKDROP_EXPORT_TIP = S.stage.backdropExportTip;

export const STAGE_FAR_EXPORT_LABEL = S.stage.farExportLabel;
export const STAGE_FAR_EXPORT_TIP = S.stage.farExportTip;
/** T-842：只有沒有自訂背景圖且舞台有畫好的遠景時才提供匯出選項。 */
export function stageFarExportShown(card: Pick<Card, 'view'>): boolean {
  return card.view.backdrop === undefined && ['gallery', 'water', 'nebula', 'desk'].includes(card.view.stage);
}
/** 說明面板的一句。 */
export const BACKDROP_HELP_LINE = S.stage.backdropHelpLine;

// ---- 水鏡遠景（T-815，DESIGN §5「水鏡遠景」） ----

/** 右欄舞台六顆按鈕下面那一小節的名字（只在水鏡顯示）。 */
export const WATER_SCENE_TITLE = S.stage.waterSceneTitle;
/** 三顆小縮圖按鈕：畫面上的順序與名字。 */
export const WATER_SCENE_OPTIONS: readonly { value: WaterScene; label: string }[] = [
  { value: 'lake', label: S.stage.waterSceneLake },
  { value: 'ink', label: S.stage.waterSceneInk },
  { value: 'fuji', label: S.stage.waterSceneFuji },
];
/** 有自己的背景圖時三顆變淡，下面寫這句。 */
export const WATER_SCENE_BACKDROP_NOTE = S.stage.waterSceneBackdropNote;
/** 說明面板的一句（放在「轉卡與縮放」段，背景圖那句後面）。 */
export const WATER_SCENE_HELP_LINE = S.stage.waterSceneHelpLine;

// ---- 遠景位置（T-822，DESIGN §5「遠景位置」） ----

/** 右欄舞台小節「遠景」「背景圖」下面那一小節的名字。 */
export const FAR_PAN_TITLE = S.stage.farPanTitle;
export const FAR_PAN_X_LABEL = S.stage.farPanX;
export const FAR_PAN_Y_LABEL = S.stage.farPanY;
export const FAR_PAN_ZOOM_LABEL = S.stage.farPanZoom;
export const FAR_PAN_CENTER_LABEL = S.stage.farPanCenter;
/** 〔置中〕滑過的說明。 */
export const FAR_PAN_CENTER_TIP = S.stage.farPanCenterTip;
/** 小節下面的一句。 */
export const FAR_PAN_HELP = S.stage.farPanHelp;
/** 水鏡時〔上下〕變淡，下面寫這句。 */
export const FAR_PAN_WATER_NOTE = S.stage.farPanWaterNote;
/** 水鏡、大小 100% 時（水鏡的遠景平面比預覽區寬，左右通常沒有多出來的部分）：提示先放大（T-822 主對話決定）。 */
export const FAR_PAN_ZOOM_HINT = S.stage.farPanZoomHint;

/** 「位置」小節出不出現：預覽區看得到遠景時（這張卡有自己的背景圖〔任何舞台〕，或舞台是水鏡〔畫三種遠景之一〕）。 */
export function farPanShown(card: Pick<Card, 'view'>): boolean {
  return card.view.backdrop !== undefined || card.view.stage === 'water';
}

/**
 * 水鏡要畫哪個遠景：這張卡有自己的背景圖＝'backdrop'（遠景被取代，view.waterScene 照存）；沒有＝選的那種（省略＝湖光山峰）。
 * 只看卡片資料（舞台是不是水鏡由呼叫端看）。
 */
export function waterSceneFor(card: Pick<Card, 'view'>): WaterScene | 'backdrop' {
  return card.view.backdrop !== undefined ? 'backdrop' : waterSceneOf(card);
}

// ---- 前景圖（T-830，DESIGN §5「前景圖」） ----
// 〔換一張〕〔拿掉〕用背景圖那兩句（BACKDROP_CHANGE_LABEL／BACKDROP_REMOVE_LABEL），〔左右〕〔上下〕〔大小〕〔置中〕用遠景位置那組（FAR_PAN_*）。

/** 右欄舞台小節「背景圖」（與它的「位置」）下面那一小節的名字。 */
export const FOREGROUND_TITLE = S.stage.foregroundTitle;
/** 還沒有前景圖時的按鈕。 */
export const FOREGROUND_ADD_LABEL = S.stage.foregroundAdd;
/** 還沒有前景圖時按鈕下面的小字（建議用透明背景的圖）。 */
export const FOREGROUND_EMPTY_HELP = S.stage.foregroundEmptyHelp;
/** 〔模糊〕滑桿。 */
export const FOREGROUND_BLUR_LABEL = S.stage.foregroundBlur;
/** 滑桿下面的一句。 */
export const FOREGROUND_HELP = S.stage.foregroundHelp;
/** 這張卡有前景圖時，頁首匯出選單「畫上背景」的提示（前景圖也照這個勾選）。 */
export const FOREGROUND_EXPORT_TIP = S.stage.foregroundExportTip;

// ---- 水面樣子（T-825，DESIGN §5「水面樣子」） ----

/** 右欄舞台六顆按鈕下面、「遠景」上面那一小節的名字（只在水鏡顯示）。 */
export const WATER_LOOK_TITLE = S.stage.waterLookTitle;
/** 兩顆快速套用：畫面上的順序與名字。 */
export const WATER_LOOK_PRESETS_UI: readonly { value: keyof typeof WATER_LOOK_PRESETS; label: string }[] = [
  { value: 'night', label: S.stage.waterLookNight },
  { value: 'mist', label: S.stage.waterLookMist },
];
/** 六個滑桿（0～100）：畫面上的順序與名字。 */
export const WATER_LOOK_SLIDERS: readonly { key: 'mist' | 'streak' | 'glint' | 'ripple' | 'lift' | 'horizon'; label: string }[] = [
  { key: 'mist', label: S.stage.waterLookMistSlider },
  { key: 'streak', label: S.stage.waterLookStreak },
  { key: 'glint', label: S.stage.waterLookGlint },
  { key: 'ripple', label: S.stage.waterLookRipple },
  { key: 'lift', label: S.stage.waterLookLift },
  { key: 'horizon', label: S.stage.waterLookHorizon },
];
export const WATER_LOOK_MIST_COLOR_LABEL = S.stage.waterLookMistColor;
export const WATER_LOOK_GLINT_COLOR_LABEL = S.stage.waterLookGlintColor;
/** 霧的顏色的預設色票（第一個＝〔夜色〕的、第二個＝〔霧白〕的；名字只用在滑過說明與報讀）。 */
export const WATER_MIST_COLORS: readonly { color: string; name: string }[] = [
  { color: DEFAULT_WATER_LOOK.mistColor, name: S.colors.nightBlue },
  { color: MIST_WATER_LOOK.mistColor, name: S.colors.mistWhite },
  { color: '#b9cbe0', name: S.colors.dawnBlue },
  { color: '#d9c8ad', name: S.colors.warmSand },
  { color: '#8f80ac', name: S.colors.duskPurple },
];
/** 閃光顏色的預設色票（第一個＝預設的暖金）。 */
export const WATER_GLINT_COLORS: readonly { color: string; name: string }[] = [
  { color: DEFAULT_WATER_LOOK.glintColor, name: S.colors.warmGold },
  { color: '#ffffff', name: S.colors.whiteLight },
  { color: '#a4dcff', name: S.colors.iceBlue },
  { color: '#ffb3d1', name: S.colors.pinkSakura },
];

/** 這張卡的水面樣子剛好是哪一組快速套用（八個欄位都一樣，顏色不分大小寫）；微調過＝null。 */
export function waterLookPreset(card: Pick<Card, 'view'>): keyof typeof WATER_LOOK_PRESETS | null {
  const look = waterLookOf(card);
  const same = (p: Readonly<WaterLook>) => (Object.keys(p) as (keyof WaterLook)[]).every((k) => String(p[k]).toLowerCase() === String(look[k]).toLowerCase());
  for (const o of WATER_LOOK_PRESETS_UI) if (same(WATER_LOOK_PRESETS[o.value])) return o.value;
  return null;
}

// ---- 效能自動降級（T-809，DESIGN §8.4）：說明面板最下面的開關 ----

/** 說明面板最下面的開關的名字。 */
export const AUTO_QUALITY_LABEL = S.quality.label;
/** 開關下面的白話說明。 */
export const AUTO_QUALITY_HELP = S.quality.help;
/** 第一次降級時提示列說的話（這次開著工坊只說一次）。 */
export const AUTO_QUALITY_NOTICE = S.quality.notice;

export const HELP_TITLE = S.help.title;
export const HELP_CLOSE_LABEL = S.help.closeLabel;
export const HELP_RESTART_TOUR_TEXT = S.help.restartTour;
/** 頁首〔？〕按鈕的提示。 */
export const HELP_BUTTON_TIP = S.help.buttonTip;

export interface HelpSection {
  title: string;
  lines: readonly string[];
}

/** 說明面板的分段（鍵盤那一段另外用 HELP_KEYS 畫成小鍵帽）。 */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: S.help.rotateTitle,
    lines: [
      S.help.rotate1,
      S.help.rotate2,
      S.help.rotate3,
    ],
  },
  {
    title: S.help.makeTitle,
    lines: [
      S.help.upload1,
      S.help.upload2,
      S.help.upload3,
      S.help.layers1,
      S.help.layers2,
      S.help.layers3,
      S.help.text1,
    ],
  },
  {
    title: S.help.advancedTitle,
    lines: [
      S.help.layers4,
      S.help.layers5,
      S.help.layers6,
      S.help.layers7,
      S.help.layers8,
    ],
  },
  {
    title: S.help.appearanceTitle,
    lines: [
      S.help.foil4,
      S.help.foil3,
      S.help.foil1,
      S.help.foil2,
      S.help.rotateAspect,
      S.help.rotateDisc,
      S.help.rotateSleeve,
    ],
  },
  {
    title: S.help.stageTitle,
    lines: [
      // 卡片故事先藏起來（T-813）時不提
      ...(STORY_ENABLED ? [S.help.rotateStory] : []),
      BACKDROP_HELP_LINE,
      WATER_SCENE_HELP_LINE,
    ],
  },
  {
    title: S.help.exportTitle,
    lines: [
      S.help.export1,
      S.help.export2,
      S.help.export3,
    ],
  },
];

export const HELP_KEYS_TITLE = S.help.keysTitle;

export interface HelpKey {
  /** 每一顆是一個鍵帽。 */
  keys: readonly string[];
  text: string;
}

/** 鍵盤說明（DESIGN §8.2 的按鍵，T-607 全部做好了）。 */
export const HELP_KEYS: readonly HelpKey[] = [
  { keys: ['Tab'], text: S.help.keyTab },
  { keys: ['Ctrl', 'Z'], text: S.help.keyUndo },
  { keys: ['Ctrl', 'Shift', 'Z'], text: S.help.keyRedo },
  { keys: ['Esc'], text: S.help.keyEsc },
  { keys: ['←', '→', '↑', '↓'], text: S.help.keyTurn },
  { keys: ['Home'], text: S.help.keyHome },
  { keys: ['+', '−'], text: S.help.keyZoom },
  { keys: ['F'], text: S.help.keyFlip },
  { keys: ['←', '→', '↑', '↓'], text: S.help.keyMoveLayer },
  { keys: ['Delete'], text: S.help.keyDelete },
  { keys: ['↑', '↓'], text: S.help.keyLayerList },
];

/**
 * 選檔視窗回來的檔還算不算數（T-805 審查）：選檔視窗開著的時候可能被別的分頁接手（這個分頁已經不存檔，加了也會不見）、
 * 或換到別張卡（圖層 id 可能一樣，例如副本）——都不算，什麼都不做。holding＝這個分頁還拿著編輯權；
 * openCardId＝現在開著的卡（沒有＝null）；pickedCardId＝打開選檔視窗時的那張卡。
 */
export function pickStillValid(p: { holding: boolean; openCardId: string | null; pickedCardId: string }): boolean {
  return p.holding && p.openCardId !== null && p.openCardId === p.pickedCardId;
}
