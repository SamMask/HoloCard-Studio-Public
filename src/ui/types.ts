// 畫面（ui）對組裝（main）的契約。ui 只讀狀態畫出來、只吐「使用者想做什麼」，不自己改資料。
// 顯示任何名字一律 textContent，禁用 innerHTML（硬邊界 4）。

import type { Mp4Info } from '../file/types';
import type { Lang } from '../i18n/lang';
import type { CardPatch, FoilPatch, LayerPatch } from '../model/actions';
import type { CardStyle } from '../model/styles';
import type { Aspect, Card, CustomAspect, FaceSide, TextFont, TextSpec, WaterScene } from '../model/types';
import type { CardSummary } from '../storage/types';
import type { StoryBox } from './story';

/** 拖曳類操作（滑桿、顏色拖選）：拖動中是 preview，放開是 commit（一次拖曳＝復原堆疊一步）。 */
export type EditPhase = 'preview' | 'commit';

/** 自動存的狀態（DESIGN 7.1 頁首小字）：已儲存（灰）／儲存中…／沒存到（紅字＋〔匯出備份〕）。 */
export type SaveStatus = 'saved' | 'saving' | 'error';

export interface UiMessage {
  kind: 'info' | 'error';
  /** 白話短句（DESIGN §4）。 */
  text: string;
}

/**
 * 上傳了沒有透明的圖：等使用者決定怎麼用（T-408；T-703 起不管有沒有底圖都問）。
 * hasBase＝那一面已經有底圖（確認框第一排是〔自動去背〕〔拆成立體層〕〔取代底圖〕＋第二排發光層／加深層；
 * 沒有底圖＝〔當底圖〕〔自動去背〕〔拆成立體層〕）。
 */
export interface PendingReplaceBase {
  fileName: string;
  hasBase: boolean;
}

/** AI 自動去背（T-703）與拆成立體層（T-704，DESIGN §3.1、§4）給畫面的狀態。一次只做一件 AI 工作（兩種共用）。 */
export interface AiView {
  /** 去背模型在不在這台電腦：false＝〔自動去背〕變淡＋說明怎麼下載；null＝還不知道（按鈕先變淡、不說明）。 */
  matteReady: boolean | null;
  /** 深度模型（拆成立體層用）在不在這台電腦（T-704）；沒給＝當作還不知道。規則同 matteReady。 */
  depthReady?: boolean | null;
  /** 正在做（或正在問要不要繼續）另一件 AI 工作：上傳確認框的兩個 AI 按鈕、右欄的〔自動去背〕（T-703b）變淡。 */
  busy: boolean;
  /** 預覽區下方的進度小面板（和匯出面板同一個位置、不蓋卡片）；null＝不顯示。 */
  progress: AiProgressView | null;
  /** 等使用者回答的問題；null＝沒有。 */
  ask: AiAsk | null;
}

export interface AiProgressView {
  /** 'load'＝「正在載入 AI 模型（第一次比較久）」；'cut'＝「正在去背…」；'split'＝「正在拆成立體層…」（T-704）。 */
  step: 'load' | 'cut' | 'split';
  /** 0～1；null＝推論中、不知道做到哪（進度條在 expectSec 秒內慢慢走到約 9 成）。 */
  fraction: number | null;
  /** 推論大約要幾秒（有圖形加速約 3 秒、沒有約 70 秒）。 */
  expectSec: number;
}

/**
 * AI 的問題：'slow'＝沒有圖形加速，先問要不要繼續（〔繼續〕〔取消〕）；
 * 'no-subject'＝找不到主角、'no-background'＝整張都被當成主角（沒有背景可以去掉）、
 * 'no-depth'＝拆層時分不出遠近（T-704），三個都是〔當底圖〕〔取消〕。
 */
export interface AiAsk {
  kind: 'slow' | 'no-subject' | 'no-background' | 'no-depth';
  fileName: string;
}

/** 確認框的「當發光層（黑色變透明）」＝screen、「當加深層（白色變透明）」＝multiply（T-408）。 */
export type OpaqueUploadBlend = 'screen' | 'multiply';

/**
 * 轉一圈的匯出種類（T-504，SCHEMA §5）：'webm'＝轉動影片（名字沿用 T-504；T-514 起影片可以是 MP4 或 WebM，見 VideoFormat）、'gif'＝GIF 動圖。
 */
export type TurntableKind = 'webm' | 'gif';

/** 轉動影片的檔案格式（T-514，DESIGN 7.1）：'mp4'（推薦，手機也能播；H.264）或 'webm'。 */
export type VideoFormat = 'mp4' | 'webm';

/** 轉一圈匯出的結果：'done'＝已下載、'cancelled'＝取消了（沒下載）、'failed'＝沒做成（組裝端已顯示白話訊息）。 */
export type TurntableOutcome = 'done' | 'cancelled' | 'failed';

/** 轉動影片轉幾圈（T-509b）：每圈 4 秒、同樣速度，1～3 圈＝4／8／12 秒。 */
export type VideoLaps = 1 | 2 | 3;

/** 轉動影片的選項（T-509b，按〔轉動影片〕後的選項面板）。音樂只用在這支影片：不存進卡片、不上傳。 */
export interface VideoExportOptions extends SleeveChoice, BackdropChoice, StageChoice {
  /** 檔案格式（T-514）；省略＝WebM（T-514 以前的呼叫）。畫面一律帶上。 */
  format?: VideoFormat;
  laps: VideoLaps;
  /** 配樂；null＝沒有聲音（和以前一樣）。startSec＝從音樂的第幾秒開始（整數，0～音樂長度 − 影片長度）。 */
  music: { file: File; startSec: number } | null;
  /** 動作（T-512）；省略＝轉一圈。 */
  motion?: TurntableMotion;
  /** 擺動時左右各轉幾度（T-512，5～60 整數）；只在 motion 'swing' 時用，省略＝30。 */
  swingDeg?: number;
  /** 轉的時候上下點頭幾度（T-812，0～25 整數，轉一圈與擺動都用）；省略＝0（只有左右，和 T-812 以前一樣）。畫面一律帶上。 */
  nodDeg?: number;
}

/** 這次匯出要不要包含透明卡套（T-806，匯出選單的勾選，不存進卡片）：false＝不畫；省略＝跟著卡片的開關（卡片沒開卡套時一律不畫）。 */
export interface SleeveChoice {
  includeSleeve?: boolean;
}

/**
 * 這次匯出要不要畫上舞台背景圖（T-814，匯出選單的「畫上背景」，不存進卡片）：false＝不畫（和以前一樣）；
 * 省略＝畫（跟著卡片：卡片沒有背景圖時一律不畫）。
 */
export interface BackdropChoice {
  includeBackdrop?: boolean;
  /** T-842：只畫內建舞台遠景（沒有自訂背景圖時）；省略／false＝不畫，不存進卡片。 */
  includeStageFar?: boolean;
}

/**
 * 連舞台一起錄（T-850，影片與 GIF 的選項小框的勾選，不存進卡片）：true＝畫面跟預覽一樣（橫的 16:9：CSS 那層、3D 舞台、卡片、前景圖），
 * 這時「畫上背景」「畫上舞台的遠景」不看；省略／false＝和以前一樣只有卡片。舞台「關」時組裝端照不勾。
 */
export interface StageChoice {
  withStage?: boolean;
}

/** 轉動匯出的動作（T-512，使用者 2026-10-14）：'turn' 轉一圈、'swing' 左右擺動（從正面先往左、回正面、往右、回正面）。 */
export type TurntableMotion = 'turn' | 'swing';

/**
 * 動作的選擇（T-512）：影片與 GIF 的選項小框共用、同一次開著工坊記住。swingDeg＝左右各轉幾度（5～60 整數，只在擺動時用）；
 * nodDeg＝上下點頭幾度（T-812，0～25 整數，轉一圈與擺動都用，0＝只有左右）。
 */
export interface MotionChoice {
  motion: TurntableMotion;
  swingDeg: number;
  nodDeg: number;
}

/** 組裝端收到的動作選擇：nodDeg 可以省略（＝0，T-812 以前的呼叫）。 */
export type MotionRequest = Omit<MotionChoice, 'nodDeg'> & Partial<Pick<MotionChoice, 'nodDeg'>>;

/** GIF 大小（T-512）：小＝寬 320、中＝寬 400、大＝寬 480。 */
export type GifSize = 'small' | 'medium' | 'large';

/** GIF 的選項（T-512，按〔GIF 動圖〕後的選項小框）。 */
export interface GifExportOptions extends MotionRequest, SleeveChoice, BackdropChoice, StageChoice {
  size: GifSize;
}

/**
 * 估 GIF 檔案大小用的試編結果（T-512）：用目前這張卡、選的動作，在某個寬度拍少量畫格實際編一次 GIF。
 * T-512b：試編兩種寬度（320、480），畫面照寬度內插每格大小 × 80 格（ui/logic 的 estimateGifBytes；
 * 純色、漸層的卡越大越省，照像素數等比例推會高估）。
 */
export interface GifSample {
  /** 試編出來的 GIF 有多大（位元組）。 */
  bytes: number;
  /** 試編了幾格。 */
  frames: number;
  /** 試編的畫格寬、高（像素）。 */
  width: number;
  height: number;
}

/** 選了音樂檔之後讀到的結果：長度（秒），或要顯示在選項面板上的白話錯誤。 */
export type MusicInfo = { ok: true; durationSec: number } | { ok: false; text: string };

export interface UiState {
  card: Card;
  /** 正在編輯哪一面（圖層清單顯示這一面）。 */
  face: FaceSide;
  /** 卡片正給人看哪一面（T-810b）：光碟的分頁選中樣子看這個（光碟的 face 一直是正面）；一般卡看 face；沒給＝正面。 */
  viewFace?: FaceSide;
  selectedLayerId: string | null;
  /** 選著這一面的反光層（T-417，左欄最上面那一列）；沒給＝沒選著。 */
  foilSelected?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  message: UiMessage | null;
  pendingReplaceBase: PendingReplaceBase | null;
  /** 縮圖網址（images registry 的 object URL）。 */
  imageUrl(hash: string): string | undefined;
  /** 已經載入的文字字型：字型按鈕用那套字寫預覽，還沒載入的先顯示名字（沒給＝都還沒載入）。 */
  loadedFonts?: readonly TextFont[];
  /** 文字圖層的圖裡，看得到的字佔多少（比例；縮圖只顯示字的部分）。不知道就回 undefined。 */
  textContentBox?(hash: string): { w: number; h: number } | undefined;
  /** 自動存的狀態（頁首小字）；沒給＝不顯示。 */
  saveStatus?: SaveStatus;
  /** AI 自動去背（T-703）；沒給＝還不知道模型在不在、沒有進行中的 AI 工作。 */
  ai?: AiView;
  /** 卡框雕花邊角的素材讀不到（T-416b）：雕花先畫成簡約，右欄卡框樣式下面說一句；沒給＝讀得到。 */
  frameCornerMissing?: boolean;
  /**
   * 水鏡遠景的小縮圖網址（T-815，右欄「遠景」三顆；main 第一次要用時才讀那三張圖，本機的 blob 網址）；
   * 還沒讀好＝undefined（按鈕先不放圖）；沒給＝都還沒讀好。
   */
  waterSceneUrl?(scene: WaterScene): string | undefined;
  /**
   * 展示廳畫好的大廳（T-816，預覽區 CSS 那層；main 第一次選展示廳時才讀，本機的 blob 網址）；還沒讀好、讀不到、沒給＝undefined
   * （照以前的深藍底）。
   */
  galleryHallUrl?: string;
}

/** 全部備份進度：current＝已處理（含略過）的張數。 */
export interface BackupProgress {
  current: number;
  total: number;
}

export type BackupOutcome = { kind: 'done'; saved: number; failed: string[] } | { kind: 'cancelled' };

export interface UiIntents {
  /** 新的空白卡；自訂比例（T-807）帶使用者打的寬高。 */
  newCard(aspect: Aspect, customAspect?: CustomAspect): void;
  /** 新的空白 CD 光碟（T-810）：同 newCard，之後頁首卡名進入可編輯狀態。 */
  newDisc(): void;
  undo(): void;
  redo(): void;
  /**
   * 換介面語言（T-828，DESIGN §9）：先等存檔存好再整頁重新載入成新語言；存不到時不換（提示列說明）。選目前的語言不做事。
   * 選用（?）：之前寫好的測試有整組列出意圖的，不加這個也要過（組裝端 main.ts 一定有）。
   */
  changeLanguage?(lang: Lang): void;
  selectFace(face: FaceSide): void;
  selectLayer(layerId: string | null): void;
  /** 上傳到目前這一面（按鈕或拖放）。 */
  uploadFiles(files: File[]): void;
  /** 取代底圖確認框的回答（〔取代底圖〕＝true、〔取消〕＝false）。 */
  answerReplaceBase(replace: boolean): void;
  /** 確認框的〔當發光層（黑色變透明）〕〔當加深層（白色變透明）〕（T-408）：把那張圖加成立體層並設好混合模式。 */
  answerOpaqueLayer(blend: OpaqueUploadBlend): void;
  /**
   * 確認框的〔自動去背〕（T-703）：收起確認框，把那張圖交給 AI 去背（沒有圖形加速先問），
   * 做完加成立體層（加到開始時那張卡）。進行中可以繼續編輯。
   */
  answerAutoCutout(): void;
  /**
   * 確認框的〔拆成立體層〕（T-704）：收起確認框，把那張圖交給 AI 依遠近拆成 3 層（沒有圖形加速先問），
   * 做完背景段當底圖（已有就取代）、其他段當立體層（整件事一步，加到開始時那張卡）。進行中可以繼續編輯。
   */
  answerSplitLayers(): void;
  /**
   * 右欄的〔自動去背〕（T-703b）：選中的這一層（沒有透明背景的立體層）交給 AI 去背（流程同確認框的〔自動去背〕：
   * 模型不在說怎麼下載、沒有圖形加速先問），做完換掉這一層的圖（同一個圖層、其他設定不變、記一步）。進行中可以繼續編輯。
   */
  autoCutoutLayer(layerId: string): void;
  /** AI 問題的回答（T-703）：〔繼續〕／〔當底圖〕＝true、〔取消〕＝false（Esc 也是 false）。 */
  answerAiAsk(yes: boolean): void;
  /** AI 進度小面板的〔取消〕（Esc 也是）：停掉，圖不加進來。 */
  cancelAi(): void;
  deleteLayer(layerId: string): void;
  /** 圖層清單拖拉排序＝交換兩層深度。 */
  swapLayers(layerIdA: string, layerIdB: string): void;
  /** 改圖層屬性（顯示開關、名字、鐳射開關是一次就 commit；深度／位置／大小滑桿有 preview）。 */
  editLayer(layerId: string, patch: LayerPatch, phase: EditPhase): void;
  centerLayer(layerId: string): void;
  fillLayer(layerId: string): void;
  /** 改卡片屬性（比例、卡身色、圓角、卡框…）。 */
  editCard(patch: CardPatch, phase: EditPhase): void;
  /**
   * 右欄「卡片」最上面的風格按鈕（T-801）：一次換上一組鐳射色彩、強度、色帶、閃星、霧光、卡框顏色與光澤、反光層形狀，
   * 整組記一步（Ctrl+Z 一次還原），提示列說「套用了「銀箔」風格，可以再微調。」。
   */
  applyStyle(style: CardStyle): void;
  /** 選目前這一面的反光層（T-417，左欄最上面那一列）：右欄顯示反光層面板，卡面上亮面的地方閃一下斜線。 */
  selectFoil(): void;
  /** 改目前這一面的反光層（形狀、卡框也反光；一按就記一步）。霧光用 editCard({ holo: { matte } })。 */
  editFoil(patch: FoilPatch): void;
  /** 選了黑白圖（T-417「上傳黑白圖」）：走和上傳一樣的 ingest，換上並切到這個形狀（一步）；失敗顯示白話訊息。 */
  uploadFoilMask(file: File): void;
  /**
   * 右欄〔加上變身圖〕〔換一張〕選了圖（T-805）：走和上傳一樣的 ingest（縮圖、WebP、雜湊），換上這一層的變身圖（一步）；
   * 沒有透明背景、這層的混合模式又只能給有透明的圖用 → 說「這層的混合模式只能用有透明背景的圖」。拿掉用 editLayer({ alt: null })。
   */
  /** 變身圖（T-805）：cardId＝打開選檔視窗時的那張卡（選檔期間換了卡、被接手就不加，T-805 審查）。 */
  uploadLayerAlt(layerId: string, file: File, cardId: string): void;
  /**
   * 右欄舞台的〔換成我的圖…〕〔換一張〕選了圖（T-814 舞台背景圖）：走和上傳一樣的 ingest（≤ 30 MB、最長邊 2048、存 WebP），
   * 換上這張卡的背景圖（一步）；會超過每張卡 16 張圖 → 照「圖滿了」說。cardId＝打開選檔視窗時的那張卡
   * （選檔期間換了卡、被接手就不套用，同 T-805b 的 pickStillValid）。
   */
  uploadBackdrop(file: File, cardId: string): void;
  /** 右欄舞台的〔拿掉〕（T-814）：拿掉這張卡的背景圖（一步，可以復原）。 */
  removeBackdrop(): void;
  /**
   * 右欄舞台「前景圖」的〔加上前景圖…〕〔換一張〕選了圖（T-830）：同 uploadBackdrop（同一套 ingest、圖片上限、pickStillValid），
   * 換上這張卡的前景圖（一步；剛加上擺在左下角、換一張時位置照舊）。
   */
  uploadForeground(file: File, cardId: string): void;
  /** 右欄舞台「前景圖」的〔拿掉〕（T-830）：拿掉這張卡的前景圖（一步，可以復原）。 */
  removeForeground(): void;
  dismissMessage(): void;
  /** 在目前這一面加一個文字圖層（預設內容「卡片名稱」，SCHEMA §1「文字圖層」）。 */
  addText(): void;
  /** 改文字圖層的設定（只給要改的欄位）。打字停 0.6 秒才送一次 commit；拖自選顏色時拖動中送 preview。 */
  editText(layerId: string, patch: Partial<TextSpec>, phase: EditPhase): void;

  // ---- 卡片庫與保存（M4，DESIGN §7） ----
  // newCard(aspect)（上面）＝建立一張新的空白卡並切換過去（舊卡已自動存好），之後頁首卡名進入可編輯狀態。
  // 改卡名用 editCard({ name }, 'commit')（可復原）。

  /** 卡片庫清單（依最近編輯排序，含正面縮圖）。存檔不能用時回空清單。 */
  listCards(): Promise<CardSummary[]>;
  /** 開啟卡片庫裡的某張卡：先存好目前這張（含縮圖）→ 載入那張 → 復原堆疊清空。目前這張存不起來就不換、顯示訊息。 */
  openCard(id: string): void;
  /** 從範例開始：建立第 index 張範例卡（0 起）的副本並切換過去（範例本身不變；T-605b：匯入隨工坊附上的卡片檔）。 */
  newFromSample(index: number): void;
  /**
   * 新卡片面板的範例縮圖（T-605b）：第 index 張範例卡片檔裡的預覽圖（PNG），檔案走完整檢查（SCHEMA §4）通過才給；
   * 讀不到回 null。打開面板時才叫，不存進任何地方。
   */
  samplePreview(index: number): Promise<Blob | null>;
  /** 匯入一個卡片檔：檢查（SCHEMA §4）→ 成為一張新卡並打開；失敗顯示白話訊息、不影響現有卡片。 */
  importCardFile(file: File): void;
  /** 匯出目前這張卡的卡片檔（.holocard）並下載。做完（含失敗）才 resolve；失敗由組裝端顯示訊息。 */
  exportCardFile(): Promise<void>;
  /**
   * 匯出目前角度的 PNG（寬 1500）並下載。做完（含失敗）才 resolve。
   * includeSleeve（T-806，匯出選單的「包含卡套」）：false＝不畫透明卡套；省略＝跟著卡片的開關。
   * includeBackdrop（T-814，匯出選單的「畫上背景」）：false＝不畫；省略＝這張卡有背景圖就畫（畫的時候 transparent 不管）。
   * includeStageFar（T-842）：只有 true 且沒有自訂背景圖時才畫內建遠景；和透明背景互斥由頁首勾選維護。
   */
  exportPng(transparent: boolean, includeSleeve?: boolean, includeBackdrop?: boolean, includeStageFar?: boolean): Promise<void>;
  /**
   * 匯出自動轉一圈（4 秒）的轉動影片或 GIF 並下載（檔名＝卡名，T-504）：先複製一份目前的卡片當這次匯出的內容
   * （做的途中卡片有改動也不影響）。onProgress(0～1)；signal 取消＝停掉、不下載。做完、取消或失敗才 resolve。
   */
  exportTurntable(kind: TurntableKind, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<TurntableOutcome>;
  /**
   * 選項面板選了音樂檔（T-509b）：讀出長度給面板顯示、限制起始秒數；太大、太長、讀不出來、瀏覽器不能加聲音 →
   * 回白話錯誤（面板上顯示，英文原文只寫 console）。不上傳、不存檔。
   */
  readMusic(file: File): Promise<MusicInfo>;
  /**
   * 照選項匯出轉動影片（T-509b）：轉 laps 圈（每圈畫面一樣、頭尾無縫）、有音樂就配上（從 startSec 取影片那麼長、結尾淡出）。
   * 其他和 exportTurntable('webm') 一樣：先複製一份卡、onProgress(0～1) 照整體格數、signal 取消＝不下載。
   * T-514：options.format 選 MP4 或 WebM（檔名 .mp4／.webm）；MP4 錄到第一格、確定實際用的影像與聲音編碼後呼叫一次 onInfo
   * （聲音是 'opus' 時畫面在「好了！」下面提醒 iPhone 可能沒聲音）；WebM 不呼叫。
   */
  exportVideo(
    options: VideoExportOptions,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    onInfo?: (info: Mp4Info) => void,
  ): Promise<TurntableOutcome>;
  /**
   * 這個瀏覽器能不能做 MP4（T-514：問瀏覽器的 H.264 影片功能，不載入大東西；同一次開著工坊結果不變，組裝端只真的問一次）。
   * 打開影片選項小框時問；不能 → MP4 變淡、小字說明、自動選 WebM。沒給（組裝端還沒接上）＝當作可以，真的做不了時匯出會說白話。
   */
  canMakeMp4?(): Promise<boolean>;
  /**
   * GIF 選項小框要估檔案大小（T-512）：用目前這張卡、照這個動作拍少量畫格實際編 GIF，回試編結果
   * （T-512b：每個試編寬度一筆）；失敗、取消或還不能拍回 null（畫面就不顯示數字，照樣能匯出）。
   * 不能卡住畫面太久；signal 取消＝停掉。
   */
  estimateGif(choice: MotionRequest & SleeveChoice & BackdropChoice & StageChoice, signal: AbortSignal): Promise<GifSample[] | null>;
  /**
   * 照選項匯出 GIF（T-512）：動作（轉一圈／左右擺動＋角度）、大小（寬 320／400／480），固定 4 秒 80 格、沒有聲音。
   * 其他和 exportTurntable('gif') 一樣：先複製一份卡、onProgress(0～1)（轉一圈 0～50%、合成 50～100%）、signal 取消＝不下載。
   */
  exportGif(options: GifExportOptions, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<TurntableOutcome>;

  // ---- 卡片庫面板（T-407，DESIGN 7.2） ----
  // 失敗時由組裝端顯示白話訊息（卡片庫開著時訊息顯示在卡片庫裡）；回傳值只給面板決定下一步。

  /** 卡片庫的內容：先存好目前這張（含縮圖），再讀清單（依最近編輯排序）與容量。 */
  loadLibrary(): Promise<LibraryData>;
  /** 改某張卡的名字（開著的那張走 editCard，可復原）。成功回 true。 */
  renameCard(id: string, name: string): Promise<boolean>;
  /** 複製一份（新 id、卡名加「（副本）」、圖共用），放進卡片庫但不切換過去。回新卡的 id；失敗回 null。 */
  duplicateCard(id: string): Promise<string | null>;
  /** 匯出某張卡的卡片檔（不用先打開它）。做完（含失敗）才 resolve。 */
  exportCardFileById(id: string): Promise<void>;
  /** 全部備份成 ZIP（T-845）；取消或被接手不下載。組裝端必須接線；選用以相容既有測試意圖。 */
  backupLibrary?(onProgress: (progress: BackupProgress) => void, signal: AbortSignal): Promise<BackupOutcome>;
  /** 刪掉某張卡（確認框之後才呼叫）。刪的是開著的那張：先開最近編輯的另一張（沒有別張就建一張空白標準卡）再刪。成功回 true。 */
  deleteCard(id: string): Promise<boolean>;

  // ---- 一次只有一個分頁能編輯（T-409） ----

  /** 被接手的分頁按〔在這裡繼續〕：換這個分頁接手（另一個分頁先存好），重新讀卡片庫、打開上次編輯的那張。做完組裝端呼叫 hideTakenOver。 */
  continueHere(): void;

  // ---- 效能自動降級（T-809，DESIGN §8.4） ----

  /** 說明面板最下面的開關「電腦跑不動時自動降低畫質」現在開著嗎（只記在這台電腦的瀏覽器，不存進卡片；讀不到、沒記過＝開著）。 */
  getAutoQuality(): boolean;
  /** 使用者按了那個開關：記下來；關掉時馬上回到完整畫質。 */
  setAutoQuality(on: boolean): void;

  // ---- 預覽區下方工具列（T-835，DESIGN §5.2） ----

  /**
   * 〔−〕〔＋〕：把卡片的縮放設成這個值（和滾輪、鍵盤同一個 zoom，已經夾好範圍；直接到位）。
   * 選用（?）：之前寫好的測試有整組列出意圖的，不加這個也要過（組裝端 main.ts 一定有）。
   */
  zoomTo?(zoom: number): void;
}

/** 右欄收起來的小節怎麼記（T-836：只記在這台電腦的瀏覽器，不存進卡片；main 接 app/section-pref.ts）。 */
export interface SectionStore {
  /** 收起來的小節名字（讀不到＝空清單）。建右欄時讀一次。 */
  read(): readonly string[];
  /** 收起／展開了：把收起來的小節名字整份記下來（寫不進去不丟錯）。 */
  write(ids: readonly string[]): void;
  /** 預設收起、但使用者選擇展開的小節；可省略以相容既有接線。 */
  readExpanded?(): readonly string[];
  writeExpanded?(ids: readonly string[]): void;
}

/** createUi 的選項：不是「使用者想做什麼」的接線（不放 intents，免得列出意圖的測試多出一筆）。 */
export interface UiOptions {
  /** 右欄摺疊的記錄（T-836／T-840）；沒給＝套用預設、不記。 */
  sections?: SectionStore;
}

/**
 * 卡片庫裡的一張卡：清單摘要＋卡身顏色（沒有縮圖時畫照比例的卡片外形用；有縮圖就不一定有）＋
 * 自訂比例的寬高（T-807：aspect 'custom' 的卡才有，縮圖格子照比例）。
 */
export interface LibraryCard extends CardSummary {
  bodyColor?: string;
  customAspect?: CustomAspect;
}

export interface LibraryData {
  /** 依最近編輯排序。 */
  cards: LibraryCard[];
  /** 儲存空間剩不到 10%（卡片庫上方提醒先匯出備份）。 */
  storageLow: boolean;
}

export interface Ui {
  /** 3D 預覽要掛的容器（main 把 render 的 canvas 放進來）。 */
  readonly previewHost: HTMLElement;
  /** 預覽區上方的疊層（直接在卡上調的外框與把手畫在這裡；不能擋住轉卡的滑鼠事件以外的地方）。 */
  readonly overlayHost: HTMLElement;
  /** 狀態變了就呼叫；ui 只更新有變的部分（拖滑桿時不能整個重畫導致滑桿失去焦點）。 */
  render(state: UiState): void;
  /** 頁首卡名進入可編輯狀態（建立新卡後，方便直接取名）。 */
  startRename(): void;
  /** 3D 還沒畫出來之前，在預覽區中間先顯示這張卡的靜態縮圖（照卡片比例；cardH＝卡高，model/aspect.ts 的 aspectHeight）。 */
  showPoster(image: Blob, cardH: number): void;
  /** 3D 第一格畫好了：縮圖淡出。 */
  hidePoster(): void;
  /**
   * 卡片故事（T-804）：卡片正面朝前（yaw 0、pitch 0）時在螢幕上的外框（client 座標；main 每影格用 ui/story.ts 的
   * frontCardRect 從 render 的 projectCardPoint 算好，卡片轉到哪裡都一樣）；null＝不知道（3D 還沒好、這張卡沒有要顯示的故事）。
   * 故事直排在它左右兩邊外面；沒變就不重排。
   */
  placeStory(card: StoryBox | null): void;
  /**
   * 前景圖（T-830）轉卡時的微動：x、y 是預覽區寬的 %（render/backdrop.ts 的 foregroundDrift；y 往下是正的）；
   * main 每影格給（減少動態時給 0, 0）。值一樣不重設。
   */
  driftForeground(x: number, y: number): void;
  /**
   * 預覽區下方工具列的縮放比例（T-835）：main 每影格給目前的 zoom（滾輪、鍵盤、按鈕改的都一樣）；
   * 顯示成「預設大小＝100%」，到上下限那顆按鈕變淡。值一樣不重設。
   */
  setZoom(zoom: number): void;
  /**
   * 工坊在另一個分頁開著（T-409）：蓋上半透明遮罩「工坊在另一個分頁開著。」＋〔在這裡繼續〕，後面什麼都不能按；面板、選單、改名框都關掉。
   * unsaved＝交出去前這個分頁有改動沒存到：多一行提醒＋〔匯出備份〕。再呼叫一次會把〔在這裡繼續〕恢復成可以按。
   */
  showTakenOver(options: { unsaved: boolean }): void;
  /** 接手好了：拿掉遮罩。 */
  hideTakenOver(): void;
  /**
   * 開啟時工坊已經在別的分頁開著（T-412）：拿到編輯權之前蓋上同一層遮罩「正在等另一個分頁存好…」（沒有按鈕），不讓人面對空白。
   * 拿到了呼叫 hideTakenOver；這中間被接手就改成 showTakenOver。
   */
  showWaiting(): void;
}

/** `createUi(root, intents, options?)`：在 root 裡建出整個畫面。實作在 `src/ui/app.ts`。 */
export type CreateUi = (root: HTMLElement, intents: UiIntents, options?: UiOptions) => Ui;
