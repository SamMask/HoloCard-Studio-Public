import './style.css';
import { S } from './i18n';
import { lang, setLang } from './i18n/lang';
import { createAiRunner } from './ai/runner';
import { createCutout, SPLIT_BANDS, type CutoutAdded, type CutoutSource, type SplitResultPart } from './app/ai-cutout';
import { addAiResult, editorImages } from './app/ai-results';
import { TEXT_SAVE_DELAY_MS } from './app/autosave';
import { backupLibrary } from './app/backup';
import { downloadBlob, previewWidth, safeFileName } from './app/files';
import { createGalleryHall } from './app/gallery-hall';
import { createGalleryFeed } from './app/gallery-thumbs';
import { createNebulaSwirl } from './app/nebula-swirl';
import { SAME_ORIGIN_FETCH } from './app/fetch';
import { readAutoQuality, writeAutoQuality } from './app/quality-pref';
import { readCollapsedSections, writeCollapsedSections, readExpandedSections, writeExpandedSections } from './app/section-pref';
import { createLangSwitcher, rememberPlace, saveUntilSaved, takePlace } from './app/lang-switch';
import { addNewSamples, importSamplesOnFirstOpen, readSamplePreview, SAMPLE_FILES, sampleFetcher, sampleImporter } from './app/samples';
import { createSession, type OpenResult, type Session, type StartChoice } from './app/session';
import { browserChannel, browserLocks, createTabLock, guardWrites } from './app/tab-lock';
import { plainPreviewPng, thumbnailToPreviewPng, thumbnailToWebp } from './app/thumbnail';
import { createTurntableExporter, exportBackdropFor, foregroundFor } from './app/turntable-export';
import { createStageExportImages, stageExportPath } from './app/stage-export-image';
import { stage3dMatches } from './app/stage-scenery';
import { createWaterScenes } from './app/water-scenes';
import { musicDuration, prepareMusic } from './file/audio';
import { encodeGif } from './file/gif';
import { exportHolocard, importHolocard } from './file/holocard';
import { HOLOCARD_EXT } from './file/types';
import { recordWebm } from './file/webm';
import { ingestFile } from './images/ingest';
import { createImageRegistry } from './images/registry';
import { decodeToRgba, encodeRgba } from './images/rgba';
import { drawTextImage, loadedTextFonts, loadTextFont } from './images/text';
import type { StoredImage } from './images/types';
import {
  classifyPress,
  layerRect,
  moveLayer,
  pressCursor,
  rectCorners,
  scaleLayer,
  type LayerRect,
  type Point,
  type Press,
} from './interact/manipulate';
import { attachPreviewKeys, type PreviewKeys, type SelectedLayer } from './interact/keys';
import { parallaxOffset } from './interact/parallax';
import { attachPointer, type LayerDrag } from './interact/pointer';
import { createQualityGovernor, qualitySettings, type QualityLevel } from './interact/quality';
import {
  beginDrag,
  depthWiggle,
  dragBy,
  endDrag,
  holdAt,
  initialShowcase,
  initialView,
  limitPitch,
  pauseShowcase,
  releaseInPlace,
  settleNow,
  stepShowcase,
  tick,
  turnByKey,
  turnLimits,
  turnToFace,
  visibleFace,
  WIGGLE_FADE_SEC,
  zoomByKey,
  zoomByWheel,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewState,
} from './interact/view';
import { DEFAULT_TEXT, farPanOf, foregroundOf, mergeTextSpec, waterLookOf, waterSceneOf, type LayerPatch, type NewLayerInput } from './model/actions';
import { aspectHeight } from './model/aspect';
import { newCard, newDisc } from './model/create';
import { MAX_LAYERS_PER_FACE, type Card, type CardView, type FaceSide, type Frame, type Holo, type Layer, type Shadow, type TextFont, type TextSpec } from './model/types';
import { foregroundDrift } from './render/backdrop';
import { createCardView, type BackdropImage, type CaptureOptions, type CardHit, type CardScene } from './render/card-view';
import { layerSize } from './render/fit';
import { readImage } from './render/read-image';
import { openCardStore } from './storage/store';
import type { CardStore, CardSummary } from './storage/types';
import { createUi } from './ui/app';
import { refreshOpenLibrary } from './ui/library';
import * as ed from './ui/editor';
import {
  altProblemText,
  AUTO_QUALITY_NOTICE,
  CARD_MISSING_TEXT,
  COPY_FAILED_TEXT,
  DELETE_FAILED_TEXT,
  EXPORT_CARD_FAILED_TEXT,
  EXPORT_PNG_FAILED_TEXT,
  importedText,
  importErrorText,
  IMPORTING_TEXT,
  layerCutoutShown,
  musicErrorText,
  musicFileProblem,
  MUSIC_UNSUPPORTED_TEXT,
  NOT_SAVED_TEXT,
  problemText,
  pickStillValid,
  RENAME_FAILED_TEXT,
  SAMPLE_PREPARING_TEXT,
  STORAGE_LOW_TEXT,
  splitLayerName,
  splitPartNames,
  splitRoomText,
  uploadMessage,
  type SplitRoomProblem,
  type UploadProblem,
} from './ui/logic';
import { createOverlay } from './ui/overlay';
import { frontCardRect, storyFrameKey, storyVisible, type StoryBox } from './ui/story';
import type { EditPhase, MusicInfo, SaveStatus, UiIntents, UiMessage } from './ui/types';

// 組裝：復原堆疊管卡片（ui/editor）；畫面的意圖 → model 動作 → 復原堆疊 → render＋畫面；
// 上傳 → images.ingest → 圖片登記簿 → addLayer。
// 文字圖層：加文字／改文字 → images/text 畫字（和上傳共用 storeCanvas：WebP、雜湊）→ 登記簿 → addTextLayer／updateTextLayer。
// 保存（M4，資料流在 app/session）：開啟工坊回到上次的卡（第一次把範例卡片檔都匯入成使用者的卡，T-605b app/samples）、自動存、切換卡片、新卡、匯入；
// 匯出卡片檔與 PNG 在這裡接 render 的 captureCard 與 file 的 exportHolocard。
// 轉一圈的影片／GIF（T-504、T-509b、T-512）：組裝在 app/turntable-export（T-512b 從這裡抽出去，測試走同一條路）——
// render 的 captureTurntable → file 的 recordWebm（邊拍邊錄）／encodeGif；匯出期間 3D 只畫開始時複製的那份卡、保留副本用的圖、
// 先不拍縮圖，收尾才放開；GIF 選項小框打開時在寬 320、480 各試編 8 格估檔案大小。這裡只接上 3D、登記簿、自動存、下載出口。
// 連舞台一起錄（T-850）：舞台畫好的圖由這裡的同源讀取交給匯出組裝（stageImage，和預覽共用結果）；選項小框的「舞台關著」由 ui 看卡片。
// 卡片庫面板（T-407）：清單、改名、複製一份、匯出不用先打開（preview 用存著的縮圖）、刪除（含刪開著的那張）；縮圖存 WebP。
// 一次只有一個分頁能編輯（T-409，app/tab-lock）：開啟時先拿編輯鎖才讀卡片庫；被別的分頁接手就存好、停住、蓋上遮罩；
// 存檔的寫入都要拿著鎖（guardWrites）。換卡會讓換卡前開始的上傳、加文字、拖曳作廢（換卡次數編號）。
// 反光層（T-417）：選左欄最上面那一列＝右欄反光層面板＋卡面上亮面的地方閃一下斜線（render 的 flashFoil）；
// 黑白圖走和上傳一樣的 ingest → 登記簿 → setFoilMask（一步）。
// AI 自動去背（T-703）與拆成立體層（T-704），流程在 app/ai-cutout：上傳沒有透明的圖一律先問；
// 〔自動去背〕→ ai/runner 在 Worker 裡去背 → images/rgba 走 storeCanvas（WebP、雜湊）→ 加成立體層；
// 〔拆成立體層〕→ Worker 裡依深度拆 3 段 → 每段走 storeCanvas → 背景段當底圖（已有就取代）、其他段當立體層，整件事一步（ui/editor 的 addSplitLayers）。
// 右欄〔自動去背〕（T-703b）：選中的不透明立體層走同一套去背 → 換掉那一層的圖（同一個圖層、其他設定不變、一步；ui/editor 的 replaceLayerImageEdit）。
// 加到開始時那張卡（app/ai-results，T-703c：加入期間 hold 住結果圖）：開著＝編輯器（記一步，排在上傳的隊伍裡）；
// 換了卡＝session.addLayerTo／editStored（存檔裡）；被刪了＝不加。
// 一次只做一件 AI 工作；被別的分頁接手時停掉（stop：之前在等的結果全部作廢），已經在加進卡片的那一件做完才交出（settleWork）。
// 雙圖光柵（T-805）：右欄〔加上變身圖〕〔換一張〕選的圖走和上傳一樣的 ingest → 登記簿 → ui/editor 的 setLayerAlt（一步）；
// 排在上傳的隊伍裡，換卡了就作廢（換卡次數編號）。畫法在 render/card-mesh（lenticular.ts）。
// 卡片故事（T-804，ui/story.ts）：卡片兩側的直排詩句是預覽區上面的一層 DOM（擷取、匯出都不會有）；每影格用 render 的
// projectCardPoint 反推「卡片正面朝前時的外框」交給畫面（卡片轉動時字不動）；要顯示時才載入那套字型（同源 /fonts/）。
// 舞台背景圖（T-814）：右欄舞台〔換成我的圖…〕〔換一張〕選的圖走和上傳一樣的 ingest → 登記簿 → ui/editor 的 setBackdropEdit（一步）；
// 排在上傳的隊伍裡，選檔回來照 pickStillValid、換卡了就作廢。畫面每次 update 把這張卡的背景圖（登記簿的 <img>）交給 render 的 setBackdrop
// （舞台的遠景接點）；匯出的「畫上背景」：PNG 給 captureCard 的 backdrop，影片／GIF 由 app/turntable-export 跟這裡要圖（backdropImage）。
// 水鏡遠景（T-815）：右欄「遠景」三選一走 editCard 的 view.waterScene（一步）；那三張圖（public/stages/water-*.webp）由 app/water-scenes
// 在舞台是水鏡時才讀（同源、選的那張先、每張只讀一次，讀好再 update 一次）；update 把選的那張交給 render 的 setWaterScene
// （有自己的背景圖、不是水鏡＝null，render 釋放遠景貼圖）；右欄的小縮圖用同一張圖的 blob 網址（UiState.waterSceneUrl）。
// 遠景的位置與大小（T-822）：右欄「位置」小節的滑桿走 editCard 的 view.farPan（拖著 preview、放開 commit）；update 把 model 的 farPanOf
// 交給 render 的 setFarPan（水鏡的遠景平面），CSS 那層由 ui/stage 照同一個算法擺；匯出的「畫上背景」：PNG 的背景圖帶著 view.farPan
// （render/backdrop 的 withFarPan），影片／GIF 在 app/turntable-export 同樣帶著。
// 前景圖（T-830）：右欄「前景圖」〔加上前景圖…〕〔換一張〕選的圖和背景圖走同一條（uploadStageImage：ingest → 登記簿 → ui/editor 的
// setForegroundEdit，一步；排在上傳的隊伍裡、pickStillValid、換卡了就作廢）；位置、大小、模糊的滑桿走 editCard 的 view.foreground。
// 預覽在 ui/stage 的 CSS 那層（疊在 3D 上面、不接滑鼠）；每影格把 render/backdrop 的 foregroundDrift（照畫面上實際的角度；
// 減少動態時 0, 0；這張卡沒有前景圖就不算、不呼叫）交給 ui.driftForeground。匯出跟著「畫上背景」：PNG 給 captureCard 的 foreground（app/turntable-export 的
// foregroundFor），影片／GIF 在 app/turntable-export 同樣帶著；縮圖、卡片檔預覽圖不給。
// 水鏡的水面樣子（T-825）：右欄「水面」小節走 editCard 的 view.waterLook（快速套用一步、滑桿拖著 preview 放開 commit、選色一步）；
// update 把 model 的 waterLookOf 交給 render 的 setWaterLook（水鏡的霧、倒影拉長、閃光、波紋、卡片高度；地平線移鏡頭），
// 預覽區天空的霧色由 ui/stage 照卡片換；匯出不畫舞台。
// 展示廳畫好的大廳（T-816）：public/stages/gallery-hall.webp 由 app/gallery-hall 在舞台是展示廳（沒有自己的背景圖）時才讀（同源、只讀一次，
// 讀好再 update 一次；讀不到先照以前畫，至少隔 10 秒才重讀）；圖本身給 ui 的 CSS 那層（UiState.galleryHallUrl），update 再告訴 render
// 讀好了沒（setGalleryHall：展示廳的石地板換成只疊倒影的大廳地板、光柱變淡）。
// 星雲畫好的漩渦大圖（T-817）：public/stages/nebula.webp 由 app/nebula-swirl 在舞台是星雲（沒有自己的背景圖）時才讀（同源、只讀一次，
// 讀好再 update 一次；讀不到先照程式漩渦畫，至少隔 10 秒才重讀；解出來 0×0 當讀不到、收回 blob 網址）；update 把它交給 render 的
// setNebulaSwirl（不是星雲、有自己的背景圖＝null，render 釋放貼圖）。
// 工作桌舞台（T-832）：壓克力展示座在 render（desk-fx，跟著卡片轉）、木桌在 ui 的 CSS 那層；這裡照 card.view.stage 拿 interact 的 turnLimits：
// 上下拖、鍵盤、setAngle 只傾 ±10°（換到工作桌時已經超過的每影格用 limitPitch 夾回來）、展示擺動幅度減半（換進換出時這一輪先停，安靜一下再接上）。
// 效能自動降級（T-809，DESIGN §8.4）：每影格把這一格的秒數交給 interact/quality 的 governor；等級變了才呼叫 render 的 setPreviewQuality
// （只影響預覽：像素比、景深陰影；擷取一律完整畫質）。第一次降級時提示列說一次；開關在說明面板，記在 localStorage（app/quality-pref），不存進卡片。

/** __holo.setCard 的參數：只給要改的欄位；frame、holo、shadow、view 可以只給部分欄位，front／back 要給整個 { layers }。 */
type DebugCardPatch = Partial<Omit<Card, 'frame' | 'holo' | 'shadow' | 'view'>> & {
  frame?: Partial<Frame>;
  holo?: Partial<Holo>;
  shadow?: Partial<Shadow>;
  view?: Partial<CardView>;
};

interface HoloDebug {
  setAngle(yawDeg: number, pitchDeg: number): void;
  /**
   * 把效果時間（閃星、動態特效）固定在某一秒（T-811 驗收拍火焰／電光／水波的固定時刻），馬上生效；null＝回到照影格時間走。
   * 例：setEffectTime(0.5); captureCard({ width: 600, transparent: false, pose: 'current' })。
   */
  setEffectTime(seconds: number | null): void;
  backend(): 'webgpu' | 'webgl2';
  capture(): Promise<string>;
  /**
   * 正式擷取（PNG 匯出、縮圖用）：只畫卡片、緊貼卡片外框，回 PNG Blob。
   * 例：captureCard({ width: 1500, transparent: true, pose: 'current' })、captureCard({ width: 320, transparent: false, pose: 'front' })。
   */
  captureCard(options: CaptureOptions): Promise<Blob>;
  /**
   * 轉一圈的畫格（T-502，GIF／WebM 用）：回畫格大小、耗時，以及第 0、1/4、1/2、3/4 圈的 PNG data URL 方便檢查。
   * 例：captureTurntable(480, 80, 4)。
   */
  captureTurntable(width: number, frames: number, seconds: number): Promise<{ width: number; height: number; ms: number; samples: string[] }>;
  /** 目前的卡片資料（複本）。 */
  card(): Card;
  /**
   * 改卡片屬性（算復原的一步），例：setCard({ aspect: 'tarot', cornerRadius: 0.12, frame: { enabled: true, width: 0.05 } })、
   * setCard({ holo: { strength: 100, sparkle: 0 } })、setCard({ holo: { palette: 'aurora' }, shadow: { strength: 0 }, frame: { shine: 100 } })、
   * setCard({ view: { stage: 'none' } })。
   */
  setCard(patch: DebugCardPatch): void;
  /** 改某一面第 index 層（陣列順序，0＝最後面），例：setLayer('front', 2, { x: 0.2, scale: 0.6, visible: false })。 */
  setLayer(face: FaceSide, index: number, patch: Partial<Layer>): void;
  hitTest(clientX: number, clientY: number): CardHit | null;
  projectCardPoint(face: FaceSide, x: number, y: number): { x: number; y: number } | null;
  /** 螢幕座標點到卡片外面的哪個破框層（T-411；點卡外選圖層用的同一個判斷）。 */
  breakoutAt(clientX: number, clientY: number): { face: FaceSide; layerId: string } | null;
  /** 最後一次在畫面上按下滑鼠時，打到卡片的哪裡（沒打到＝null）。 */
  lastHit: CardHit | null;
  /** 在螢幕上用小紅點標出卡面上的點（跟著卡片轉；那一面背對時不畫）；傳 [] 清掉。 */
  mark(points: { face: FaceSide; x: number; y: number }[]): void;
  /** 目前編輯狀態（給驗收看）；foilSelected＝選著反光層（T-417）。 */
  state(): { face: FaceSide; selectedLayerId: string | null; foilSelected: boolean; canUndo: boolean; canRedo: boolean };
  /** 目前的轉卡狀態（T-607 驗收鍵盤轉卡用）：角度（度）、縮放、模式（idle／dragging／returning／held）。 */
  view(): { yaw: number; pitch: number; zoom: number; mode: ViewState['mode'] };
  /** 卡片庫清單（T-404 驗收：切換卡片、匯入）。 */
  listCards(): Promise<CardSummary[]>;
  /** 開啟卡片庫裡的某張卡（同〔我的卡片〕點一張）。 */
  openCard(id: string): Promise<OpenResult>;
  /** GPU 上還活著的貼圖與幾何數量（換卡會不會一直長）。 */
  memory(): { textures: number; geometries: number; texturesBytes: number };
  /** 自動存的狀態。 */
  saveStatus(): SaveStatus;
  /** 目前的預覽畫質等級（T-809）：0 完整、1 像素比 1.25、2 再關景深陰影、3 像素比 1。 */
  quality(): QualityLevel;
  /** 直接把預覽畫質設成某一級（T-809 驗收擷取不受影響用；不經過自動降級，governor 下次升降時會蓋掉）。 */
  forceQuality(level: QualityLevel): void;
}

declare global {
  interface Window {
    __holo?: HoloDebug;
  }
}

const FATAL_TEXT = S.app.fatal;
const SAMPLE_FAILED_TEXT = S.app.sampleFailed;
const SAMPLE_COPY_FAILED_TEXT = S.app.sampleCopyFailed;
const OPEN_FAILED_TEXT = S.app.openFailed;
/** 開啟時讀不到卡片庫（和「還沒有卡」不一樣：不匯入範例，T-409；存檔整個打不開也一樣，T-412）。 */
const UNREADABLE_TEXT = S.app.unreadable;
/** 〔在這裡繼續〕時，交出去前沒存到的改動另存成新的一張了（T-412）。 */
const rescuedText = (name: string) => S.app.rescued(name);
/** 〔在這裡繼續〕時，交出去前沒存到的改動還是存不進去：留在畫面上（已經改成新的一張，不會蓋掉另一個分頁存的）。 */
const rescueFailedText = (name: string) => S.app.rescueFailed(name);
/** 卡片庫縮圖寬（SCHEMA §3 cards.thumbnail）。 */
const THUMBNAIL_WIDTH = 320;
/** PNG 匯出的畫布寬（SCHEMA §5）。 */
const PNG_WIDTH = 1500;
const TEXT_FONT_FAILED = S.text.fontFailed;
const TEXT_DRAW_FAILED = S.text.drawFailed;
/** 第一次用某套字型要先載入（幾 MB），超過這麼久才顯示「正在準備字型…」。 */
const BUSY_DELAY_MS = 400;

const now = () => new Date().toISOString();
/**
 * 新的空白卡（T-828a）：卡名換成目前語言的「未命名卡片」。model 不依賴其他模組、不認得語言（newCard 一律是正體中文原文），
 * 所以組裝端建卡時換掉；之後使用者自己改的名字照原樣。
 */
const blankName = (card: Card): Card => (card.name === S.defaults.cardName ? card : { ...card, name: S.defaults.cardName });
const seconds = () => performance.now() / 1000;
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
/** 範例卡片檔（public/samples/*.holocard，T-605b）：同源讀檔，只讀自己網站的檔。 */
const fetchSample = sampleFetcher(globalThis.fetch.bind(globalThis), import.meta.env.BASE_URL);

/**
 * 讀網站裡的素材圖（T-416b）：同源 fetch 取回內容再解碼（只准同源、被轉址就失敗）；
 * 不直接交給 Image.src（那樣會跟著轉址連到別的主機）。
 */
function loadImage(path: string): Promise<HTMLImageElement> {
  return readImage((url) => fetch(url, SAME_ORIGIN_FETCH), asset(path));
}

async function start(root: HTMLElement): Promise<void> {
  const registry = createImageRegistry();
  const getImage = (hash: string) => registry.element(hash);
  /** 舞台背景圖（T-814）：登記簿裡已解碼的 <img>（同一張圖同一個元素，render 才不會每次重建貼圖）；拿不到＝null。 */
  const backdropImage = (hash: string): BackdropImage | null => {
    const img = registry.element(hash);
    return img && img.naturalWidth > 0 && img.naturalHeight > 0 ? { image: img, width: img.naturalWidth, height: img.naturalHeight } : null;
  };

  let editor: ed.EditorState | null = null;
  let view: ViewState = initialView();
  // 展示擺動（card.view.showcase）：狀態機，每影格推進
  let showcase = initialShowcase();
  let scene: CardScene | null = null;
  // 調深度時的小幅擺動（只影響顯示）
  let wiggleStart = -Infinity;
  let lastDepthEdit = -Infinity;
  /** 卡片庫與自動存（開啟時那張卡打開之後才交給畫面，T-409）。 */
  let session: Session | null = null;
  let saveStatus: SaveStatus | undefined;
  /** 換卡次數（T-409）：換卡前開始的上傳、加文字、拖曳，做完時編號不同就丟掉（不然會加到新卡上）。 */
  let generation = 0;
  /** 換卡時取消進行中的圖層拖曳（3D 好了之後才接上）。 */
  let cancelLayerDrag = () => {};
  /**
   * 預覽區鍵盤移動圖層「停手 0.6 秒才記」的那一步（3D 好了之後才接上，T-607c）：復原、重做、開始拖曳或拖滑桿（會開新 preview 的操作）、
   * 換面、被別的分頁接手之前先 flush（按過的鍵算數：復原＝復原掉剛才那段連按）；換卡時 cancel（舊卡換掉前已經存了畫面上的樣子）。
   */
  let previewKeys: PreviewKeys | null = null;
  /**
   * 3D 預覽上的卡片。轉一圈匯出中（T-504）＝這次匯出的卡片（開始時複製的一份，exporter.frozenCard()）：
   * 畫面已經鎖住不能編輯，但開始前就在做的上傳、加文字、匯入做完時還是會改到卡片，不能讓前後格不一致。
   */
  const shownCard = (): Card | null => exporter.frozenCard() ?? (editor ? ed.currentCard(editor) : null);
  /** 轉卡的範圍（T-832）：工作桌上下只傾 ±10°、展示擺動減半；其他舞台照舊。 */
  const turnNow = () => turnLimits(shownCard()?.view.stage === 'desk');

  /** 卡框雕花邊角的素材讀不到（T-416b）：雕花先畫成簡約，右欄說一句。 */
  let frameCornerMissing = false;

  // T-842：預覽與匯出共用同源讀取結果；工作桌在第一次勾選匯出時才讀。
  const loadStageImage = createStageExportImages(loadImage);
  const stageBackdropImage = async (card: Pick<Card, 'view'>): Promise<BackdropImage | null> => {
    const path = stageExportPath(card);
    if (path === null) return null;
    const img = await loadStageImage(path);
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  };

  /** 水鏡遠景的三張圖（T-815）：舞台是水鏡才讀（同源、不跟著轉址）；讀好重畫一次；讀不到先照沒有遠景畫，至少隔 WATER_SCENE_RETRY_MS（10 秒）後畫面再更新時才重讀（T-815b）。 */
  const waterScenes = createWaterScenes({
    load: (scene) => loadStageImage(`stages/water-${scene}.webp`),
    loaded: () => update(),
    failed: (err) => console.error(err),
  });

  /** 展示廳畫好的大廳（T-816）：第一次選展示廳（沒有自己的背景圖）才讀；讀好重畫一次；讀不到先照以前畫，至少隔 10 秒後畫面再更新時才重讀。 */
  const galleryHall = createGalleryHall({
    load: () => loadStageImage('stages/gallery-hall.webp'),
    loaded: () => update(),
    failed: (err) => console.error(err),
  });

  /** 星雲畫好的漩渦大圖（T-817）：第一次選星雲（沒有自己的背景圖）才讀；讀好重畫一次；讀不到先照程式漩渦畫，至少隔 10 秒後畫面再更新時才重讀。 */
  const nebulaSwirl = createNebulaSwirl({
    load: () => loadStageImage('stages/nebula.webp'),
    loaded: () => update(),
    failed: (err) => console.error(err),
  });

  // 文字圖層的選取框與縮圖只框住字：字在圖裡的範圍由登記簿從 alpha 算（registry.inkBox），存檔載入的卡也一樣準
  const renderUi = () => {
    if (!editor) return;
    const state = ed.toUiState(editor, (h) => registry.url(h), { loadedFonts: loadedTextFonts(), textContentBox: (h) => registry.inkBox(h) });
    ui.render({
      ...state,
      saveStatus,
      ai: cutout.view(),
      frameCornerMissing,
      waterSceneUrl: (s) => waterScenes.url(s),
      galleryHallUrl: galleryHall.url(),
    });
  };

  // 展示廳兩側浮著的卡（T-410）：卡片庫裡其他卡已存的縮圖，在本機解碼後交給 3D；換卡、切到展示廳、卡片庫有變時重讀
  const galleryFeed = createGalleryFeed({
    list: () => session?.list() ?? Promise.resolve([]),
    decode: (blob) => createImageBitmap(blob),
    show: (thumbs) => scene?.setGalleryThumbs(thumbs),
  });
  const refreshGallery = (force = false) => {
    const card = shownCard();
    if (scene && session && card?.view.stage === 'gallery') void galleryFeed.want(card.id, force);
  };

  /** 卡片故事要用的字型（T-804）：要顯示時才載入（同文字圖層，同源 /fonts/、只載一次）；載好重畫一次。失敗了下次狀態改變再試。 */
  const storyFontsAsked = new Set<TextFont>();
  const ensureStoryFont = (card: Card) => {
    const font = card.story?.font;
    if (!font || !storyVisible(card) || storyFontsAsked.has(font) || loadedTextFonts().includes(font)) return;
    storyFontsAsked.add(font);
    loadTextFont(font).then(renderUi, (err: unknown) => {
      console.error(err);
      storyFontsAsked.delete(font);
    });
  };

  const update = () => {
    const card = shownCard();
    if (!card) return;
    ensureStoryFont(card);
    // 破框層的取景（T-411）：拖曳、拖滑桿（預覽中）時鏡頭先不跟著退，放開才跟上（不然拖曳的點會跑掉）
    scene?.holdFraming(!exporter.frozenCard() && editor !== null && editor.history.previewBase !== null);
    scene?.setCard(card, getImage);
    scene?.setStage(card.view.stage);
    // 舞台背景圖（T-814）：交給舞台的遠景接點（沒有＝各舞台本來的遠景）
    const backdrop = card.view.backdrop !== undefined ? backdropImage(card.view.backdrop) : null;
    scene?.setBackdrop(backdrop);
    // 水鏡遠景（T-815）：水鏡才讀圖；沒有自己的背景圖時交給 render（圖還沒讀好＝null，先照沒有遠景畫，讀好會再 update 一次）
    waterScenes.want(card);
    scene?.setWaterScene(card.view.stage === 'water' && backdrop === null ? waterScenes.image(waterSceneOf(card)) : null);
    // 遠景的位置與大小（T-822）：水鏡的遠景平面照它裁（其他舞台的遠景在 CSS 那層，ui/stage 照同一個算法擺）
    scene?.setFarPan(farPanOf(card));
    // 水鏡的水面樣子（T-825）：霧、倒影拉長、閃光、波紋、卡片高度交給水鏡，地平線移鏡頭（不是水鏡時照存不畫）
    scene?.setWaterLook(waterLookOf(card));
    // 展示廳的大廳（T-816）：展示廳才讀；讀好了 3D 的地板換成只疊倒影的那種（圖本身在 CSS 那層，ui/stage）
    galleryHall.want(card);
    scene?.setGalleryHall(galleryHall.url() !== undefined);
    // 星雲的漩渦大圖（T-817）：星雲才讀；沒有自己的背景圖時交給 render（還沒讀好＝null，先照程式漩渦畫，讀好會再 update 一次）
    nebulaSwirl.want(card);
    scene?.setNebulaSwirl(card.view.stage === 'nebula' && backdrop === null ? nebulaSwirl.image() : null);
    refreshGallery();
    renderUi();
  };

  /**
   * 換狀態；turnTo＝順便把卡片轉到那一面；saveDelay＝這次改了卡片的話幾毫秒後存（文字輸入停手才存）。
   * 一個動作完成或一次拖曳放開就存（SCHEMA §3）；拖曳中（preview）不存；只換選取、訊息（卡片沒變）不存。
   */
  const change = (next: ed.EditorState, turnTo?: FaceSide, saveDelay = 0) => {
    editor = turnTo ? ed.turnedTo(next, turnTo) : next;
    if (turnTo) view = turnToFace(view, turnTo);
    update();
    if (session && next.history.previewBase === null && !session.saver.isSaved(ed.currentCard(next))) session.saver.changed(saveDelay);
  };

  // ---- 上傳（依序處理；一批裡壞掉的檔不影響其他檔，B13） ----
  let uploads: Promise<void> = Promise.resolve();
  const uploadBatch = async (files: File[]) => {
    if (!editor) return;
    const gen = generation;
    const face = editor.face;
    const problems: UploadProblem[] = [];
    const busy: UiMessage = { kind: 'info', text: files.length > 1 ? S.upload.addingMany(files.length) : S.upload.adding };
    const slow = setTimeout(() => editor && gen === generation && change(ed.setMessage(editor, busy)), 400);
    try {
      for (const file of files) {
        const result = await ingestFile(file);
        // 換卡了：這批是給舊卡的，剩下的丟掉
        if (gen !== generation) return;
        if (!result.ok) {
          problems.push({ fileName: file.name, reason: result.reason });
          continue;
        }
        const image = result.image;
        try {
          await registry.add(image);
        } catch {
          problems.push({ fileName: file.name, reason: 'decode-failed' });
          continue;
        }
        if (gen !== generation) return;
        const input: NewLayerInput = {
          id: crypto.randomUUID(),
          name: result.name,
          image: image.hash,
          hasAlpha: image.hasAlpha,
          width: image.width,
          height: image.height,
        };
        if (!image.hasAlpha) {
          // T-848：沒底圖且兩個模型都確定不在時直接加入；其他情況保留 T-703 的確認框。
          const models = await cutout.checkModels();
          if (gen !== generation || !editor) return;
          if (models.matte === false && models.depth === false && !ed.currentCard(editor)[face].layers.some((layer) => layer.role === 'base')) {
            const r = ed.addUploadedLayer(editor, face, input, file.name, now());
            if (r.problem) problems.push({ fileName: file.name, reason: r.problem });
            const next = r.problem ? r.state : ed.setMessage(r.state, { kind: 'info', text: S.upload.addedAsBase });
            change(next, r.state.selectedLayerId === input.id ? face : undefined);
            continue;
          }
          const r = ed.askOpaqueUpload(editor, face, input, file.name, now());
          if (r.problem) problems.push({ fileName: file.name, reason: r.problem });
          change(r.state);
          continue;
        }
        const r = ed.addUploadedLayer(editor!, face, input, file.name, now());
        if (r.problem) problems.push({ fileName: file.name, reason: r.problem });
        change(r.state, r.state.selectedLayerId === input.id ? face : undefined);
      }
    } finally {
      clearTimeout(slow);
      const message = uploadMessage(problems);
      if (editor && gen === generation && (message || editor.message === busy)) change(ed.setMessage(editor, message));
    }
  };

  // ---- 反光層的黑白圖（T-417）：和上傳一樣走 ingest → 登記簿，再換上並切到「上傳黑白圖」（一步） ----
  const uploadMask = async (file: File) => {
    if (!editor) return;
    const gen = generation;
    const face = editor.face;
    const busy: UiMessage = { kind: 'info', text: S.upload.adding };
    const slow = setTimeout(() => editor && gen === generation && change(ed.setMessage(editor, busy)), 400);
    let problem: UiMessage | null = null;
    try {
      const result = await ingestFile(file);
      if (gen !== generation) return;
      if (!result.ok) {
        problem = uploadMessage([{ fileName: file.name, reason: result.reason }]);
        return;
      }
      try {
        await registry.add(result.image);
      } catch {
        problem = uploadMessage([{ fileName: file.name, reason: 'decode-failed' }]);
        return;
      }
      if (!editor || gen !== generation) return;
      const r = ed.setFoilMask(editor, face, result.image.hash, now());
      if (r.problem) {
        problem = { kind: 'error', text: problemText(r.problem) };
        change(r.state);
        return;
      }
      change(r.state, face);
      scene?.flashFoil(face);
    } finally {
      clearTimeout(slow);
      if (editor && gen === generation && (problem || editor.message === busy)) change(ed.setMessage(editor, problem));
    }
  };

  // ---- 變身圖（T-805，雙圖光柵）：和上傳一樣走 ingest → 登記簿，再換上那一層的變身圖（一步）；換卡了就作廢 ----
  const uploadAlt = async (layerId: string, file: File, cardId: string) => {
    // 排隊等到的時候已經換了卡（圖層 id 可能一樣，例如副本）：不加（T-805 審查）
    if (!editor || ed.currentCard(editor).id !== cardId) return;
    const gen = generation;
    const busy: UiMessage = { kind: 'info', text: S.upload.adding };
    const slow = setTimeout(() => editor && gen === generation && change(ed.setMessage(editor, busy)), BUSY_DELAY_MS);
    let problem: UiMessage | null = null;
    try {
      const result = await ingestFile(file);
      if (gen !== generation) return;
      if (!result.ok) {
        problem = uploadMessage([{ fileName: file.name, reason: result.reason }]);
        return;
      }
      try {
        await registry.add(result.image);
      } catch {
        problem = uploadMessage([{ fileName: file.name, reason: 'decode-failed' }]);
        return;
      }
      if (!editor || gen !== generation) return;
      // 鍵盤還沒記的那一步先記起來（換變身圖是新的一步）
      previewKeys?.flush();
      const r = ed.setLayerAlt(editor, layerId, { image: result.image.hash, hasAlpha: result.image.hasAlpha }, now());
      const text = r.problem ? altProblemText(r.problem) : null;
      if (text) problem = { kind: 'error', text };
      change(r.state);
      // 沒加上（例如不透明圖配正常模式）：這張圖沒人用就放掉，不留在記憶體裡等換卡（T-805 審查）
      if (r.problem && editor && !editorImages(editor).has(result.image.hash)) registry.discard([result.image.hash]);
    } finally {
      clearTimeout(slow);
      if (editor && gen === generation && (problem || editor.message === busy)) change(ed.setMessage(editor, problem));
    }
  };

  // ---- 舞台背景圖（T-814）、前景圖（T-830）：和上傳一樣走 ingest → 登記簿，再換上這張卡的那張圖（一步）；換卡了就作廢 ----
  const uploadStageImage = async (
    file: File,
    cardId: string,
    put: (s: ed.EditorState, hash: string, at: string) => { state: ed.EditorState; problem: 'too-many-images' | null },
  ) => {
    // 排隊等到的時候已經換了卡：不套用（同變身圖，T-805 審查）
    if (!editor || ed.currentCard(editor).id !== cardId) return;
    const gen = generation;
    const busy: UiMessage = { kind: 'info', text: S.upload.adding };
    const slow = setTimeout(() => editor && gen === generation && change(ed.setMessage(editor, busy)), BUSY_DELAY_MS);
    let problem: UiMessage | null = null;
    try {
      const result = await ingestFile(file);
      if (gen !== generation) return;
      if (!result.ok) {
        problem = uploadMessage([{ fileName: file.name, reason: result.reason }]);
        return;
      }
      try {
        await registry.add(result.image);
      } catch {
        problem = uploadMessage([{ fileName: file.name, reason: 'decode-failed' }]);
        return;
      }
      if (!editor || gen !== generation) return;
      // 鍵盤還沒記的那一步先記起來（換背景圖、前景圖是新的一步）
      previewKeys?.flush();
      const r = put(editor, result.image.hash, now());
      if (r.problem) problem = { kind: 'error', text: problemText(r.problem) };
      change(r.state);
      // 沒換上（圖滿了）：這張圖沒人用就放掉，不留在記憶體裡等換卡
      if (r.problem && editor && !editorImages(editor).has(result.image.hash)) registry.discard([result.image.hash]);
    } finally {
      clearTimeout(slow);
      if (editor && gen === generation && (problem || editor.message === busy)) change(ed.setMessage(editor, problem));
    }
  };

  // ---- AI 自動去背（T-703）與拆成立體層（T-704），流程在 app/ai-cutout；加回開始時那張卡在 app/ai-results（T-703c）----
  const aiRunner = createAiRunner();
  /** 排在上傳的隊伍裡做（換卡前 session.settle 會等它做完，不會加到新卡上）。不能在 session 的隊伍裡呼叫（換卡會等它）。 */
  const queueUpload = <T,>(task: () => T | Promise<T>): Promise<T> => {
    const run = uploads.then(task);
    uploads = run.then(
      () => {},
      (err: unknown) => console.error(err),
    );
    return run;
  };
  const cutoutInput = (source: CutoutSource, image: StoredImage): NewLayerInput => ({
    id: crypto.randomUUID(),
    name: source.name,
    image: image.hash,
    hasAlpha: image.hasAlpha,
    width: image.width,
    height: image.height,
  });
  const isOpenCard = (cardId: string) => editor !== null && ed.currentCard(editor).id === cardId;
  /** 加回原卡（T-703c）：加入期間 hold 住結果圖、每次加進開著的卡前都重新確保圖在登記簿、加完才放開。 */
  // 做完沒用上的結果圖立刻收掉，目前的卡與復原歷史在用的不收（T-704c）
  const aiResults = { registry, isOpen: isOpenCard, queue: queueUpload, inUse: () => (editor ? editorImages(editor) : new Set<string>()) };
  /** 拆好的段 → 加進卡片的輸入（由遠到近；名字「檔名・遠／中／近」，段數變少就照實際段數）。 */
  const splitInputs = (source: CutoutSource, parts: SplitResultPart[]): ed.SplitPart[] => {
    const names = splitPartNames(parts.length);
    return parts.map((part, i) => ({
      id: crypto.randomUUID(),
      name: splitLayerName(source.name, names[i] ?? ''),
      image: part.image.hash,
      hasAlpha: part.image.hasAlpha,
      width: part.image.width,
      height: part.image.height,
      depth: part.depth,
    }));
  };
  const splitProblem = (problem: SplitRoomProblem | 'invalid-input'): CutoutAdded =>
    problem === 'invalid-input' ? { result: 'invalid-input' } : { result: 'no-room', text: splitRoomText(problem) };
  const roomText = (source: CutoutSource, kind: 'cutout' | 'split'): string | null => {
    if (!editor || !isOpenCard(source.cardId)) return null;
    const card = ed.currentCard(editor);
    if (kind === 'split') {
      const problem = ed.splitRoom(card, source.face, SPLIT_BANDS);
      return problem ? splitRoomText(problem) : null;
    }
    // 右欄〔自動去背〕（T-703b）：換掉不是新增，不看層數；舊圖還有別人在用、又已經 16 張圖才放不下
    const problem = source.replaceLayerId !== undefined ? ed.replaceRoom(card, source.face, source.replaceLayerId) : ed.cutoutRoom(card, source.face);
    return problem ? problemText(problem) : null;
  };
  /** 右欄〔自動去背〕換不上去的原因 → ai-cutout 的結果（layer-gone 由它說「那一層已經刪掉了」）。 */
  const replaceProblem = (problem: ed.ReplaceProblem): CutoutAdded => ({ result: problem });
  const cutout = createCutout({
    runner: aiRunner,
    decode: (image) => decodeToRgba(image.blob),
    encode: (pixels) => encodeRgba(pixels),
    room: roomText,
    add(source, image) {
      const input = cutoutInput(source, image);
      return addAiResult(
        aiResults,
        source.cardId,
        [image],
        () => {
          if (!editor) return { result: 'missing' };
          // 開著的就是那張：加成立體層（記一步、選中、轉到那一面）
          const r = ed.addUploadedLayer(editor, source.face, input, source.fileName, now());
          change(r.state, r.problem ? undefined : source.face);
          return r.problem ? { result: r.problem } : { result: 'added' };
        },
        async () => {
          // 已經換到別張卡：加到存檔裡開始時那張（session 的隊伍裡再確認一次是不是又打開了）
          if (!session) return { result: 'missing' };
          const stored = await session.addLayerTo(source.cardId, source.face, input, image, now());
          if (stored.result === 'is-open') return 'is-open';
          return stored.result === 'added' ? { result: 'stored', cardName: stored.cardName } : { result: stored.result };
        },
      );
    },
    addSplit(source, parts) {
      const inputs = splitInputs(source, parts);
      const images = parts.map((part) => part.image);
      return addAiResult(
        aiResults,
        source.cardId,
        images,
        () => {
          if (!editor) return { result: 'missing' };
          // 開著的就是那張：一次加進去（一步、轉到那一面）
          const r = ed.addSplitLayers(editor, source.face, inputs, now());
          change(r.state, r.problem ? undefined : source.face);
          return r.problem ? splitProblem(r.problem) : { result: 'added' };
        },
        async () => {
          if (!session) return { result: 'missing' };
          const stored = await session.editStored(source.cardId, images, (card) => ed.splitIntoCard(card, source.face, inputs), now());
          if (stored.result === 'is-open') return 'is-open';
          if (stored.result === 'saved') return { result: 'stored', cardName: stored.cardName };
          return stored.result === 'problem' ? splitProblem(stored.problem) : { result: 'missing' };
        },
      );
    },
    replace(source, image) {
      // 右欄〔自動去背〕（T-703b）：同一個圖層換上去背好的圖（其他設定不變）；那一層被刪了或圖已經被換掉就不用
      const layerId = source.replaceLayerId ?? '';
      const oldImage = source.image.hash;
      const cut = { image: image.hash, hasAlpha: image.hasAlpha };
      return addAiResult(
        aiResults,
        source.cardId,
        [image],
        () => {
          if (!editor) return { result: 'missing' };
          // 鍵盤還沒記的那一步先記起來（換圖是新的一步）
          previewKeys?.flush();
          // 開著的就是那張：記一步；選取與正在看的那一面都不動
          const r = ed.replaceLayerImageEdit(editor, source.face, layerId, oldImage, cut, now());
          change(r.state);
          return r.problem ? replaceProblem(r.problem) : { result: 'added' };
        },
        async () => {
          // 已經換到別張卡：改存檔裡那張卡的那一層（session 的隊伍裡再確認一次是不是又打開了）
          if (!session) return { result: 'missing' };
          const stored = await session.editStored(source.cardId, [image], (card) => ed.replaceCutoutInCard(card, source.face, layerId, oldImage, cut), now());
          if (stored.result === 'is-open') return 'is-open';
          if (stored.result === 'saved') return { result: 'stored', cardName: stored.cardName };
          return stored.result === 'problem' ? replaceProblem(stored.problem) : { result: 'missing' };
        },
      );
    },
    useAsBase(source) {
      void queueUpload(async () => {
        await registry.add(source.image);
        if (!editor || !isOpenCard(source.cardId)) return;
        const r = ed.placeBase(editor, source.face, cutoutInput(source, source.image), now());
        if (r.problem) change(ed.setMessage(r.state, { kind: 'error', text: problemText(r.problem) }));
        else change(r.state, source.face);
      });
    },
    isOpen: isOpenCard,
    message: (message) => {
      if (editor) change(ed.setMessage(editor, message));
    },
    changed: () => renderUi(),
  });

  const layerById = (id: string): Layer | undefined => {
    if (!editor) return undefined;
    const card = ed.currentCard(editor);
    return [...card.front.layers, ...card.back.layers].find((l) => l.id === id);
  };

  // ---- 文字圖層：畫字 → 登記簿；依序處理（後面的改動建立在前面的結果上），拖自選顏色時只畫最新的 ----
  const showError = (text: string) => {
    if (editor) change(ed.setMessage(editor, { kind: 'error', text }));
  };
  const showInfo = (text: string) => {
    if (editor) change(ed.setMessage(editor, { kind: 'info', text }));
  };

  /** 畫字並登記；第一次用某套字型、載入比較久時顯示「正在準備字型…」。失敗顯示訊息、回 null。 */
  const renderText = async (spec: TextSpec): Promise<StoredImage | null> => {
    const busy: UiMessage = { kind: 'info', text: S.text.preparingFont };
    const slow = setTimeout(() => editor && change(ed.setMessage(editor, busy)), BUSY_DELAY_MS);
    try {
      const drawn = await drawTextImage(spec);
      if (!drawn.ok) {
        showError(drawn.reason === 'font-failed' ? TEXT_FONT_FAILED : TEXT_DRAW_FAILED);
        return null;
      }
      await registry.add(drawn.image);
      return drawn.image;
    } catch {
      showError(TEXT_DRAW_FAILED);
      return null;
    } finally {
      // 錯誤訊息已經換掉「正在準備字型…」的話就不清
      clearTimeout(slow);
      if (editor?.message === busy) change(ed.setMessage(editor, null));
    }
  };

  let textQueue: Promise<void> = Promise.resolve();
  const queueText = (task: () => Promise<void>) => {
    textQueue = textQueue.then(task).catch((err: unknown) => console.error(err));
  };
  /** 拖自選顏色時等著畫的那一次（新的蓋掉舊的：只畫最新的顏色）。 */
  let waitingPreview: { layerId: string; patch: Partial<TextSpec> } | null = null;

  /** 用「現在」的設定加上這次的改動重畫；圖層不見了或設定不合格就不做。 */
  const applyTextEdit = async (layerId: string, patch: Partial<TextSpec>, phase: EditPhase) => {
    const gen = generation;
    const layer = layerById(layerId);
    if (!layer?.text) return;
    const spec = mergeTextSpec(layer.text, patch);
    if (!spec) return;
    const image = await renderText(spec);
    if (!image || !editor || gen !== generation) return;
    const drawn = { text: spec, image: image.hash, width: image.width, height: image.height };
    change(ed.editTextLayer(editor, layerId, patch, drawn, phase, now()), undefined, TEXT_SAVE_DELAY_MS);
  };

  const addTextLayer = async () => {
    if (!editor) return;
    const gen = generation;
    const face = editor.face;
    if (ed.currentCard(editor)[face].layers.length >= MAX_LAYERS_PER_FACE) {
      showError(problemText('face-full'));
      return;
    }
    // 新文字圖層的字用目前語言的「卡片名稱」（model 的 DEFAULT_TEXT 是正體中文原文，T-828a）
    const spec: TextSpec = { ...DEFAULT_TEXT, content: S.defaults.textContent };
    const image = await renderText(spec);
    // 換卡了：這是要加到舊卡的字，丟掉
    if (!image || !editor || gen !== generation) return;
    const input = { id: crypto.randomUUID(), image: image.hash, text: spec, width: image.width, height: image.height };
    const r = ed.addTextLayerEdit(editor, face, input, now());
    if (r.problem) change(ed.setMessage(r.state, { kind: 'error', text: problemText(r.problem) }));
    else change(r.state, face);
  };

  // ---- 卡片庫：範例副本、換卡、新卡、匯入、匯出（資料流在 app/session） ----

  /** 換卡沒成功：白話說明（目前這張存不起來＝不換；那張讀不到＝沒打開；已經交給別的分頁＝遮罩已經說明，不另外說）。回傳有沒有換成。 */
  const reportOpen = (result: OpenResult): boolean => {
    if (result === 'not-saved') showError(NOT_SAVED_TEXT);
    else if (result === 'missing') showError(CARD_MISSING_TEXT);
    return result === 'opened';
  };

  /** 新的一張卡（空白卡）：舊卡先存好 → 新卡存進卡片庫 → 打開。 */
  const adoptCard = async (card: Card, images: StoredImage[]): Promise<boolean> =>
    session ? reportOpen(await session.adopt(card, images)) : false;

  let imports: Promise<void> = Promise.resolve();
  /** 進行中的建立範例副本（交出編輯權前要等它做完，T-412）。 */
  let samples: Promise<void> = Promise.resolve();
  const importFile = async (file: File) => {
    if (!session) return;
    // 大檔（最多 200 MB）檢查要一點時間：超過 0.4 秒才顯示「匯入中…」
    const busy: UiMessage = { kind: 'info', text: IMPORTING_TEXT };
    const slow = setTimeout(() => editor && change(ed.setMessage(editor, busy)), BUSY_DELAY_MS);
    let message: UiMessage | null = null;
    try {
      const outcome = await session.importFile(file, importHolocard, { newId: () => crypto.randomUUID(), now });
      if (!outcome.ok) message = { kind: 'error', text: importErrorText(outcome.reason) };
      else if (outcome.result === 'opened') message = { kind: 'info', text: importedText(outcome.card.name) };
      else reportOpen(outcome.result);
    } finally {
      clearTimeout(slow);
      if (editor && (message || editor.message === busy)) change(ed.setMessage(editor, message));
    }
  };

  const exportCardFile = async () => {
    if (!editor) return;
    const card = ed.currentCard(editor);
    try {
      if (!scene) throw new Error('3D 預覽沒有準備好，拍不了 preview');
      const preview = await scene.captureCard({ width: previewWidth(card), transparent: false, pose: 'front' });
      const blob = await exportHolocard(card, async (hash) => registry.get(hash), preview);
      downloadBlob(blob, safeFileName(card.name, HOLOCARD_EXT));
    } catch (err) {
      console.error(err);
      showError(EXPORT_CARD_FAILED_TEXT);
    }
  };

  /** 匯出卡片庫裡的某張卡（不用先打開）：卡片與圖從存檔讀；preview 用存著的縮圖轉 PNG（沒有縮圖就畫卡身顏色的卡片外形）。 */
  const exportCardFileById = async (id: string) => {
    if (!editor || !session) return;
    if (ed.currentCard(editor).id === id) return exportCardFile();
    try {
      const source = await session.cardForExport(id);
      if (!source) throw new Error(`讀不到要匯出的卡 ${id}`);
      const { card, thumbnail } = source;
      const preview = thumbnail ? await thumbnailToPreviewPng(thumbnail) : await plainPreviewPng(card, card.bodyColor);
      const byHash = new Map(source.images.map((image) => [image.hash, image] as const));
      const blob = await exportHolocard(card, async (hash) => byHash.get(hash), preview);
      downloadBlob(blob, safeFileName(card.name, HOLOCARD_EXT));
    } catch (err) {
      console.error(err);
      showError(EXPORT_CARD_FAILED_TEXT);
    }
  };

  /**
   * PNG（目前角度）：includeSleeve＝匯出選單的「包含卡套」（T-806；省略＝畫，卡片沒開卡套時 render 一律不畫）；
   * includeBackdrop＝「畫上背景」（T-814；省略＝這張卡有背景圖就畫，畫的時候透明背景不管）。
   * includeStageFar＝「畫上舞台的遠景」（T-842；只有 true 且沒有自訂背景圖時才畫）。
   */
  const exportPng = async (transparent: boolean, includeSleeve?: boolean, includeBackdrop?: boolean, includeStageFar?: boolean) => {
    if (!editor) return;
    const card = ed.currentCard(editor);
    try {
      if (!scene) throw new Error('3D 預覽沒有準備好');
      const backdrop = await exportBackdropFor(card, { includeBackdrop, includeStageFar }, backdropImage, stageBackdropImage);
      // 前景圖（T-830）：同一個勾選，卡片之後畫
      const foreground = foregroundFor(card, includeBackdrop, backdropImage);
      const png = await scene.captureCard({ width: PNG_WIDTH, transparent, pose: 'current', sleeve: includeSleeve !== false, backdrop, foreground });
      downloadBlob(png, safeFileName(card.name, '.png'));
    } catch (err) {
      console.error(err);
      showError(EXPORT_PNG_FAILED_TEXT);
    }
  };

  /** 瀏覽器有沒有幫影片加聲音的功能（WebCodecs 的聲音編碼）。 */
  const canAddMusic = () => typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';

  /**
   * 轉動的影片／GIF 與 GIF 預估（T-504、T-509b、T-512；T-512b 組裝抽到 app/turntable-export，測試走同一條路）：
   * 匯出期間 3D 預覽只畫開始時複製的那份卡（frozenCard）、保留副本用的圖（登記簿 hold）、先不拍縮圖（自動存 holdThumbnails）。
   */
  const exporter = createTurntableExporter({
    card: () => (editor ? ed.currentCard(editor) : null),
    scene: () => scene,
    refresh: () => update(),
    holdImages: (hashes) => registry.hold(hashes),
    holdThumbnails: () => session?.saver.holdThumbnails() ?? (() => {}),
    showError: (text) => showError(text),
    download: downloadBlob,
    encodeGif,
    recordWebm,
    prepareMusic,
    canRecordVideo: () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined',
    canAddMusic,
    // 畫上背景（T-814）：匯出期間 hold 著副本用到的圖（含背景圖），從登記簿拿
    backdropImage,
    stageBackdropImage,
    // 連舞台一起錄（T-850）：舞台畫好的圖（大廳、木桌、水鏡遠景、星雲大圖），和預覽共用同源讀取的結果；讀不到這次匯出失敗
    stageImage: async (path) => {
      const img = await loadStageImage(path);
      return { image: img, width: img.naturalWidth, height: img.naturalHeight };
    },
    // 連舞台一起錄（T-850c）：匯出讀到的舞台圖補進預覽的讀圖狀態（預覽讀不到、還在冷卻中也一樣），重畫一次讓 3D 舞台接上，
    // 再確認 3D 用的就是這一批（3D 畫的是匯出這張卡、交給 scene 的圖是同一張）；接不上這次匯出就失敗
    attachStage3d: (card, used) => {
      const img = used.stage?.image.image;
      if (img instanceof HTMLImageElement) {
        if (card.view.stage === 'water') waterScenes.provide(waterSceneOf(card), img);
        else if (card.view.stage === 'nebula') nebulaSwirl.provide(img);
        else if (card.view.stage === 'gallery') galleryHall.provide(img);
      }
      update();
      if (shownCard() !== card) return false;
      // 同 update 交給 scene 的那幾樣
      const backdrop = card.view.backdrop !== undefined ? backdropImage(card.view.backdrop) : null;
      return stage3dMatches(card, used, {
        backdrop,
        waterScene: card.view.stage === 'water' && backdrop === null ? waterScenes.image(waterSceneOf(card)) : null,
        nebulaSwirl: card.view.stage === 'nebula' && backdrop === null ? nebulaSwirl.image() : null,
        galleryHall: galleryHall.url() !== undefined,
      });
    },
  });

  /** 選項面板選了音樂檔（T-509b）：讀長度；太大、太長、讀不出來、瀏覽器不能加聲音 → 白話（英文原文只寫 console）。 */
  const readMusic = async (file: File): Promise<MusicInfo> => {
    const problem = musicFileProblem(file.size);
    if (problem) return { ok: false, text: problem };
    if (!canAddMusic()) return { ok: false, text: MUSIC_UNSUPPORTED_TEXT };
    try {
      return { ok: true, durationSec: await musicDuration(file) };
    } catch (err) {
      console.error(err);
      return { ok: false, text: musicErrorText(err) };
    }
  };

  /** 改圖層（不先結清鍵盤那一步：鍵盤自己記步時用，其他走 intents.editLayer）。 */
  const editLayerNow = (layerId: string, patch: LayerPatch, phase: EditPhase) => {
    if (!editor) return;
    if (patch.depth !== undefined) {
      const t = seconds();
      if (t - lastDepthEdit >= WIGGLE_FADE_SEC) wiggleStart = t;
      lastDepthEdit = t;
    }
    change(ed.editLayer(editor, layerId, patch, phase, now()));
  };

  // ---- 效能自動降級（T-809）：開關記在 localStorage（讀不到＝開著），降級時只影響預覽 ----
  let autoQuality = readAutoQuality();
  const quality = createQualityGovernor({
    enabled: autoQuality,
    hidden: () => document.hidden,
    pixelRatio: () => window.devicePixelRatio || 1,
    apply: (settings) => scene?.setPreviewQuality(settings),
    // 第一次降級說一句；還沒有可以顯示的地方（卡片還沒開好）回 false，下一次降級再說
    notice() {
      if (!editor) return false;
      showInfo(AUTO_QUALITY_NOTICE);
      return true;
    },
  });

  // ---- 換介面語言（T-828，DESIGN §9）：先等進行中的工作做完、存檔存好，才記下語言、整頁重新載入；存不到不換（提示列說明） ----
  // T-828j：等的時候又排進新的工作（例如又上傳一張）→ 再等一輪、再存（app/lang-switch）；剛上傳的圖在等回答 → 不換；
  // 重新載入前記下這張卡與給人看的那一面（sessionStorage），回來開到同一張卡就還原那一面
  const switchLanguage = createLangSwitcher({
    current: lang,
    // 各條隊伍目前的 Promise：排進新的工作就換成新的（上傳、AI 結果走 uploads；加文字 textQueue；匯入 imports；範例副本 samples）
    work: () => [uploads, textQueue, imports, samples],
    async settle() {
      // 鍵盤移動圖層還沒記的那一步先記起來（T-607c）；上傳、加文字、匯入、建立範例副本做完才存（重新載入會丟掉做到一半的）
      previewKeys?.flush();
      await uploads;
      await textQueue;
      await imports;
      await samples;
    },
    // 還沒開好卡（資料流還沒交給畫面）＝不換；讀不到存檔時只有沒改過的備援卡算存好
    save: () => (session ? saveUntilSaved(session.saver, () => (editor ? ed.currentCard(editor) : null)) : Promise.resolve(false)),
    remember: (next) => setLang(next),
    reload() {
      if (editor) rememberPlace({ cardId: ed.currentCard(editor).id, face: ed.shownFace(editor) });
      location.reload();
    },
    notSaved: () => showError(S.lang.notSaved),
    notRemembered: () => showError(S.lang.cannotRemember),
    // AI 去背／拆層還在做（或正在問要不要繼續）：重新載入會中斷它 → 不換、提示一句（T-828g）
    aiBusy: () => cutout.view().busy,
    aiWorking: () => showInfo(S.lang.aiBusy),
    // 剛上傳的圖在等回答（上傳的確認框、AI 問要不要當底圖）：圖還沒加進卡片，重新載入就不見了（T-828j）
    asking: () => editor?.pending != null || cutout.view().ask !== null,
    answerFirst: () => showInfo(S.lang.answerFirst),
    // 等的時候被別的分頁接手（T-409）：不換，重新載入會把編輯權搶回來。
    // 還沒開好卡（session 還是 null）也還沒有編輯權；tabLock 在下面才建立，先看 session 才不會在它建立前碰到
    holding: () => session !== null && tabLock.holding(),
  });

  const intents: UiIntents = {
    changeLanguage(next) {
      void switchLanguage(next);
    },
    newCard(aspect, customAspect) {
      // 新空白卡：頁首卡名直接進入可編輯狀態，方便取名（DESIGN 7.3）；自訂比例帶使用者打的寬高（T-807）
      void adoptCard(blankName(newCard(aspect, crypto.randomUUID(), now(), customAspect)), []).then((ok) => ok && ui.startRename());
    },
    newDisc() {
      // 新的 CD 光碟（T-810）：同新空白卡
      void adoptCard(blankName(newDisc(crypto.randomUUID(), now())), []).then((ok) => ok && ui.startRename());
    },
    listCards: () => session?.list() ?? Promise.resolve([]),
    openCard(id) {
      if (session) void session.open(id).then(reportOpen);
    },
    newFromSample(index) {
      // 範例＝隨工坊附上的卡片檔（T-605b）：讀檔、走和匯入一樣的完整檢查 → 新 id、新時間存進卡片庫並打開。
      // 超過 0.4 秒才顯示「正在準備範例卡…」（新卡片面板已經關了，不讓人以為沒反應）
      const busy: UiMessage = { kind: 'info', text: SAMPLE_PREPARING_TEXT };
      const slow = setTimeout(() => editor && change(ed.setMessage(editor, busy)), BUSY_DELAY_MS);
      const job = (async () => {
        const file = SAMPLE_FILES[index];
        if (!session || file === undefined) throw new Error(`沒有第 ${index + 1} 張範例，或還沒開好卡`);
        // 卡名換成目前語言的範例名字（T-828a，DESIGN §9；卡片檔本身不動）
        const outcome = await session.importFile(await fetchSample(file), sampleImporter(importHolocard, index), { newId: () => crypto.randomUUID(), now });
        if (!outcome.ok) throw new Error(`範例卡片檔 ${file} 沒通過檢查（${outcome.reason}）`);
        reportOpen(outcome.result);
      })()
        .catch((err: unknown) => {
          console.error(err);
          showError(SAMPLE_COPY_FAILED_TEXT);
        })
        .finally(() => {
          clearTimeout(slow);
          if (editor?.message === busy) change(ed.setMessage(editor, null));
        });
      // 交出編輯權前要等它做完（T-412）
      samples = Promise.all([samples, job]).then(() => {});
    },
    samplePreview: (index) => readSamplePreview(index, fetchSample, importHolocard),
    importCardFile(file) {
      imports = imports.then(() => importFile(file)).catch((err: unknown) => console.error(err));
    },
    exportCardFile,
    exportPng,
    exportTurntable: exporter.exportTurntable,
    readMusic,
    exportVideo: exporter.exportVideo,
    canMakeMp4: exporter.canMakeMp4,
    estimateGif: exporter.estimateGif,
    exportGif: exporter.exportGif,
    // ---- 卡片庫面板（T-407） ----
    // 卡片庫面板每次重讀清單（打開、刪除、複製、匯入之後）時，展示廳浮著的卡也跟著重讀（T-410）
    loadLibrary: async () => {
      const data = await (session?.library() ?? Promise.resolve({ cards: [], storageLow: false }));
      refreshGallery(true);
      return data;
    },
    async renameCard(id, name) {
      if (!session || !editor) return false;
      // 開著的那張：和頁首改名一樣（可以復原、自動存）
      const renameOpen = () => {
        if (editor) change(ed.editCard(editor, { name }, 'commit', now()));
        return true;
      };
      if (ed.currentCard(editor).id === id) return renameOpen();
      try {
        const result = await session.rename(id, name);
        if (result === 'is-open') return renameOpen();
        if (result === 'renamed') return true;
      } catch (err) {
        console.error(err);
      }
      showError(RENAME_FAILED_TEXT);
      return false;
    },
    async duplicateCard(id) {
      if (!session) return null;
      try {
        const result = await session.duplicate(id, { newId: () => crypto.randomUUID(), now });
        if (result.ok) return result.card.id;
      } catch (err) {
        console.error(err);
      }
      showError(COPY_FAILED_TEXT);
      return null;
    },
    exportCardFileById,
    async backupLibrary(onProgress, signal) {
      if (!session || !tabLock.holding()) return { kind: 'cancelled' };
      backupAbort?.abort();
      const controller = new AbortController();
      backupAbort = controller;
      const cancel = () => controller.abort();
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      try {
        return await backupLibrary({
          session,
          preview: ({ card, thumbnail }) => thumbnail ? thumbnailToPreviewPng(thumbnail) : plainPreviewPng(card, card.bodyColor),
        }, onProgress, controller.signal);
      } finally {
        signal.removeEventListener('abort', cancel);
        if (backupAbort === controller) backupAbort = null;
      }
    },
    async deleteCard(id) {
      if (!session) return false;
      try {
        await session.deleteCard(id, () => blankName(newCard('standard', crypto.randomUUID(), now())));
        return true;
      } catch (err) {
        console.error(err);
        showError(DELETE_FAILED_TEXT);
        return false;
      }
    },
    // ---- 效能自動降級（T-809）----
    getAutoQuality: () => autoQuality,
    setAutoQuality(on) {
      autoQuality = on;
      writeAutoQuality(on);
      quality.setEnabled(on);
    },
    // ---- 預覽區下方的〔−〕〔＋〕（T-835）：和滾輪、鍵盤同一個 zoom，直接到位（同滾輪）；數字由每影格的 ui.setZoom 跟上 ----
    zoomTo(zoom) {
      if (Number.isFinite(zoom)) view = { ...view, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) };
    },
    // ---- 一次只有一個分頁能編輯（T-409） ----
    continueHere() {
      if (resuming) return;
      resuming = true;
      const epoch = awayEpoch;
      void (async () => {
        try {
          // 換這個分頁接手：另一個分頁先存好、放掉鎖 → 重新讀卡片庫（記憶體裡的是交出去之前的舊版，不能用）；
          // 交出去前沒存到的改動先另存成新的一張，存不進去就留在畫面上（T-412）
          await tabLock.acquire();
          const { result, rescued } = await cards.reload(() => blankName(newCard('standard', crypto.randomUUID(), now())), {
            newId: () => crypto.randomUUID(),
            now,
          });
          const problem = result === 'unreadable' ? UNREADABLE_TEXT : result === 'open-failed' ? OPEN_FAILED_TEXT : null;
          if (result === 'kept' && rescued) showError(rescueFailedText(rescued));
          else if (problem) showError(rescued ? `${problem}${rescuedText(rescued)}` : problem);
          else if (rescued) showInfo(rescuedText(rescued));
        } catch (err) {
          console.error(err);
        } finally {
          resuming = false;
        }
        // 接手的途中又被別的分頁接手了：遮罩留著（〔在這裡繼續〕恢復成可以按）
        if (awayEpoch === epoch && tabLock.holding()) ui.hideTakenOver();
        else showAway();
      })();
    },
    undo() {
      previewKeys?.flush();
      if (editor) change(ed.undoEdit(editor));
    },
    redo() {
      previewKeys?.flush();
      if (editor) change(ed.redoEdit(editor));
    },
    selectFace(face) {
      previewKeys?.flush();
      if (editor) change(ed.selectFace(editor, face), face);
    },
    selectLayer(layerId) {
      if (!editor) return;
      const next = ed.selectLayer(editor, layerId);
      change(next, next.selectedLayerId ? next.face : undefined);
    },
    uploadFiles(files) {
      // 選檔視窗開著時被別的分頁接手：這個分頁已經不存檔，回來的檔不加（T-805 審查；加了關頁就不見）
      if (!tabLock.holding()) return;
      uploads = uploads.then(() => uploadBatch(files)).catch((err: unknown) => console.error(err));
    },
    answerReplaceBase(replace) {
      if (!editor?.pending) return;
      const face = editor.pending.face;
      change(ed.answerReplaceBase(editor, replace, now()), replace ? face : undefined);
    },
    answerOpaqueLayer(blend) {
      if (!editor?.pending) return;
      const { face, fileName } = editor.pending;
      const r = ed.answerOpaqueLayer(editor, blend, now());
      const next = r.problem ? ed.setMessage(r.state, uploadMessage([{ fileName, reason: r.problem }])) : r.state;
      change(next, r.problem ? undefined : face);
    },
    answerAutoCutout() {
      if (!editor) return;
      const { state, pending } = ed.takePending(editor);
      if (!pending) return;
      change(state);
      const image = registry.get(pending.input.image);
      if (!image) {
        showError(problemText('decode-failed'));
        return;
      }
      void cutout.start({ cardId: ed.currentCard(state).id, face: pending.face, image, name: pending.input.name, fileName: pending.fileName });
    },
    answerSplitLayers() {
      if (!editor) return;
      const { state, pending } = ed.takePending(editor);
      if (!pending) return;
      change(state);
      const image = registry.get(pending.input.image);
      if (!image) {
        showError(problemText('decode-failed'));
        return;
      }
      void cutout.start({ cardId: ed.currentCard(state).id, face: pending.face, image, name: pending.input.name, fileName: pending.fileName }, 'split');
    },
    autoCutoutLayer(layerId) {
      // 右欄〔自動去背〕（T-703b）：選中的不透明立體層交給 AI 去背，做完換掉這一層的圖（加回開始時那張卡那一面）
      previewKeys?.flush();
      if (!editor) return;
      const card = ed.currentCard(editor);
      const face: FaceSide | null = card.front.layers.some((l) => l.id === layerId) ? 'front' : card.back.layers.some((l) => l.id === layerId) ? 'back' : null;
      const layer = face ? card[face].layers.find((l) => l.id === layerId) : undefined;
      if (!face || !layer || !layerCutoutShown(layer)) return;
      const image = registry.get(layer.image);
      if (!image) {
        showError(problemText('decode-failed'));
        return;
      }
      void cutout.start({ cardId: card.id, face, image, name: layer.name, fileName: layer.name, replaceLayerId: layer.id });
    },
    answerAiAsk(yes) {
      cutout.answer(yes);
    },
    cancelAi() {
      cutout.cancel();
    },
    deleteLayer(layerId) {
      if (editor) change(ed.deleteLayer(editor, layerId, now()));
    },
    swapLayers(a, b) {
      if (editor) change(ed.swapLayers(editor, a, b, now()));
    },
    editLayer(layerId, patch, phase) {
      // 滑鼠拖、拖滑桿、切開關（同一組欄位會和鍵盤的那一步合在一起）：鍵盤還沒記的那一步先記起來
      previewKeys?.flush();
      editLayerNow(layerId, patch, phase);
    },
    centerLayer(layerId) {
      if (editor) change(ed.centerLayerEdit(editor, layerId, now()));
    },
    fillLayer(layerId) {
      if (!editor) return;
      const layer = layerById(layerId);
      const image = layer && registry.get(layer.image);
      change(ed.fillLayerEdit(editor, layerId, image && { width: image.width, height: image.height }, now()));
    },
    editCard(patch, phase) {
      previewKeys?.flush();
      // 卡片故事是打字停手才送（T-804）：和文字圖層一樣，停手 1 秒後才存
      if (editor) change(ed.editCard(editor, patch, phase, now()), undefined, patch.story !== undefined ? TEXT_SAVE_DELAY_MS : 0);
    },
    applyStyle(style) {
      previewKeys?.flush();
      if (editor) change(ed.applyStyleEdit(editor, style, now()));
    },
    selectFoil() {
      if (!editor) return;
      const face = editor.face;
      change(ed.selectFoil(editor), face);
      // 卡面上亮面的地方閃一下斜線（約 1 秒），看得出範圍
      scene?.flashFoil(face);
    },
    editFoil(patch) {
      if (!editor) return;
      const face = editor.face;
      const before = ed.currentCard(editor);
      const next = ed.editFoil(editor, face, patch, now());
      change(next, face);
      // 換了形狀：再閃一次，看得出新的範圍
      if (patch.shape !== undefined && ed.currentCard(next) !== before) scene?.flashFoil(face);
    },
    uploadFoilMask(file) {
      if (!tabLock.holding()) return;
      uploads = uploads.then(() => uploadMask(file)).catch((err: unknown) => console.error(err));
    },
    uploadLayerAlt(layerId, file, cardId) {
      // 選檔視窗開著時被接手、或換到別張卡：不加（T-805 審查）
      if (!pickStillValid({ holding: tabLock.holding(), openCardId: editor ? ed.currentCard(editor).id : null, pickedCardId: cardId })) return;
      // 雙圖光柵（T-805）：排在上傳的隊伍裡（換卡前 session.settle 會等它）；鍵盤還沒記的那一步先記起來
      previewKeys?.flush();
      uploads = uploads.then(() => uploadAlt(layerId, file, cardId)).catch((err: unknown) => console.error(err));
    },
    uploadBackdrop(file, cardId) {
      // 舞台背景圖（T-814）：選檔視窗開著時被接手、或換到別張卡 → 不套用（同 T-805b 的 pickStillValid）
      if (!pickStillValid({ holding: tabLock.holding(), openCardId: editor ? ed.currentCard(editor).id : null, pickedCardId: cardId })) return;
      previewKeys?.flush();
      uploads = uploads.then(() => uploadStageImage(file, cardId, ed.setBackdropEdit)).catch((err: unknown) => console.error(err));
    },
    removeBackdrop() {
      previewKeys?.flush();
      if (editor) change(ed.setBackdropEdit(editor, null, now()).state);
    },
    uploadForeground(file, cardId) {
      // 前景圖（T-830）：同背景圖（選檔視窗開著時被接手、或換到別張卡 → 不套用）
      if (!pickStillValid({ holding: tabLock.holding(), openCardId: editor ? ed.currentCard(editor).id : null, pickedCardId: cardId })) return;
      previewKeys?.flush();
      uploads = uploads.then(() => uploadStageImage(file, cardId, ed.setForegroundEdit)).catch((err: unknown) => console.error(err));
    },
    removeForeground() {
      previewKeys?.flush();
      if (editor) change(ed.setForegroundEdit(editor, null, now()).state);
    },
    dismissMessage() {
      if (editor) change(ed.dismissMessage(editor));
    },
    addText() {
      queueText(addTextLayer);
    },
    editText(layerId, patch, phase) {
      previewKeys?.flush();
      if (phase === 'preview') {
        const alreadyQueued = waitingPreview !== null;
        waitingPreview = { layerId, patch };
        if (alreadyQueued) return;
        queueText(async () => {
          const job = waitingPreview;
          waitingPreview = null;
          if (job) await applyTextEdit(job.layerId, job.patch, 'preview');
        });
        return;
      }
      // 放開（commit）了：還沒畫的 preview 不用畫了
      waitingPreview = null;
      queueText(() => applyTextEdit(layerId, patch, 'commit'));
    },
  };

  // 右欄摺疊（T-836）：收起哪幾節只記在這台電腦的瀏覽器（app/section-pref），不存進卡片
  const ui = createUi(root, intents, { sections: {
    read: () => readCollapsedSections(), write: (ids) => writeCollapsedSections(ids),
    readExpanded: () => readExpandedSections(), writeExpanded: (ids) => writeExpandedSections(ids),
  } });

  // ---- 3D 預覽：WebGPU 初始化要一點時間，和讀存檔同時進行 ----
  const scenePromise = (async (): Promise<CardScene | null> => {
    try {
      const [plainBack, pedestal, frameCorner] = await Promise.all([
        loadImage('textures/plain-back.webp'),
        loadImage('brand/pedestal.webp'),
        // 卡框雕花邊角的素材（T-416）讀不到：只有雕花先畫成簡約、右欄說一句，不拖垮整個預覽（T-416b）
        loadImage('textures/frame-corner.webp').catch((err: unknown) => {
          console.error(err);
          frameCornerMissing = true;
          return null;
        }),
      ]);
      return await createCardView(ui.previewHost, {
        plainBack, pedestal, frameCorner,
        forceWebGL: import.meta.env.DEV && new URLSearchParams(window.location.search).has('webgl'),
      });
    } catch (err) {
      console.error(err);
      return null;
    }
  })();

  // ---- 存檔：打不開（瀏覽器不給 IndexedDB）也照樣能編輯，只是狀態一直是「沒存到」；
  //      開啟時當成「讀不到存檔」說明（chooseStart 丟錯），不當成第一次使用去建範例（T-412） ----
  let rawStore: CardStore | null = null;
  try {
    rawStore = await openCardStore();
  } catch (err) {
    console.error(err);
  }

  // ---- 一次只有一個分頁能編輯（T-409）：被別的分頁接手 → 蓋上遮罩、等開卡做完、存好、自動存停住，才放掉鎖 ----
  let markStarted = () => {};
  const startup = new Promise<void>((resolve) => (markStarted = resolve));
  /** 被接手幾次了（接手的途中又被接手，遮罩要留著）。 */
  let awayEpoch = 0;
  let backupAbort: AbortController | null = null;
  /** 交出去時有沒存到的改動（遮罩上提醒先匯出備份）。 */
  let awayUnsaved = false;
  let resuming = false;
  const showAway = () => ui.showTakenOver({ unsaved: awayUnsaved });
  const tabLock = createTabLock({
    locks: browserLocks(),
    channel: browserChannel(),
    // 開啟時工坊已經在別的分頁開著：拿到鎖之前顯示「正在等另一個分頁存好…」，不讓人面對空白（T-412）。
    // 〔在這裡繼續〕的等待由遮罩上的「接手中…」說明
    onWait() {
      if (!session) ui.showWaiting();
    },
    async onYield() {
      awayEpoch += 1;
      backupAbort?.abort();
      // 鍵盤還沒記的那一步先記起來（交出去前存好；之後計時器到期也不會在交出去的卡上改）
      previewKeys?.flush();
      // AI（T-703、T-704）：停掉，之前在等的結果全部作廢；已經在加進卡片的那一件由 handOff 的 settleWork 等它做完（T-703c）
      cutout.stop();
      awayUnsaved = false;
      showAway();
      await startup;
      awayUnsaved = !(await cards.handOff());
      if (awayUnsaved && !resuming) showAway();
    },
  });
  const store = rawStore && guardWrites(rawStore, () => tabLock.holding());

  const cards = createSession({
    store,
    storage: navigator.storage,
    images: registry,
    current: () => (editor ? ed.currentCard(editor) : null),
    show(card) {
      // 換卡：換卡前開始的上傳、加文字、拖曳作廢（T-409）
      generation += 1;
      cancelLayerDrag();
      // 鍵盤還沒記的那一步作廢（舊卡換掉前已經存了畫面上的樣子；不能記到新卡上，T-607c）
      previewKeys?.cancel();
      // 新的復原堆疊、正面朝前（縮放不變）、展示擺動與深度擺動重來
      editor = ed.createEditor(card);
      view = { ...initialView(), zoom: view.zoom };
      showcase = initialShowcase();
      wiggleStart = -Infinity;
      lastDepthEdit = -Infinity;
      waitingPreview = null;
      // AI「找不到主角，要不要當底圖」是別張卡的：收掉（T-703）
      cutout.cardOpened(card.id);
      update();
    },
    // 卡片庫縮圖：拍 320 寬透明 PNG → 改存 WebP（保留透明；編不出 WebP 就照舊 PNG，T-407）
    thumbnail: async () =>
      scene && editor ? thumbnailToWebp(await scene.captureCard({ width: THUMBNAIL_WIDTH, transparent: true, pose: 'front' })) : null,
    async settle() {
      await uploads;
      await textQueue;
    },
    // 交出編輯權前：已經開始的匯入、建立範例、AI 正在加進卡片的那一件先做完（T-412、T-703c）
    async settleWork() {
      await imports;
      await samples;
      // AI 已經在加進卡片的那一件停不了（T-703c）：做完、存好才交出編輯權
      await cutout.settled();
    },
    onStatus(status) {
      saveStatus = status;
      renderUi();
    },
    onStorageLow: () => showInfo(STORAGE_LOW_TEXT),
  });

  // 分頁變成隱藏、離開頁面：立刻存。卡片先單獨存好（不等拍縮圖，背景分頁拍縮圖可能很慢），縮圖另外補（T-409）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    void cards.saver.flush();
    void cards.saver.flush({ thumbnail: true });
  });
  window.addEventListener('pagehide', () => void cards.saver.flush());
  // 還沒存好或存失敗時離開頁面：讓瀏覽器問一聲「確定要離開？」（T-409）
  window.addEventListener('beforeunload', (e) => {
    if (cards.saver.isSaved(editor ? ed.currentCard(editor) : null)) return;
    e.preventDefault();
    e.returnValue = true;
  });

  // ---- 開啟工坊（DESIGN 7.4）：回到上次編輯的那張；第一次使用（卡片庫是空的）把範例卡片檔都匯入成使用者的卡、打開第一張（T-605b） ----
  // 先拿編輯鎖（T-409）：工坊已經在別的分頁開著，就請它存好交出來（等的時候顯示「正在等另一個分頁存好…」），拿到了才讀卡片庫
  await tabLock.acquire();
  ui.hideTakenOver();
  /** 開到的是卡片庫裡原本就有的卡（不是第一次使用、也不是讀不到）：開好之後補新的範例（T-829）。 */
  let hadLibrary = false;
  try {
    let choice: StartChoice | null = null;
    /** 讀不到卡片庫（≠ 還沒有卡）：不匯入範例，給一張不存進去的空白卡並說明（T-409）。 */
    let unreadable = false;
    try {
      choice = await cards.chooseStart();
      hadLibrary = choice !== null;
    } catch (err) {
      console.error(err);
      unreadable = true;
    }
    // 換語言前記下的那張卡與那一面（T-828j）：只用這一次（讀了就清掉）
    const place = takePlace();
    // 3D 準備好之前先顯示這張卡存過的縮圖，不讓人面對空白（縮圖是正面：要回到背面時不顯示，免得正面閃一下又翻成背面）
    const backAgain = place !== null && place.face === 'back' && place.cardId === choice?.card.id;
    if (choice?.thumbnail && !backAgain) ui.showPoster(choice.thumbnail, aspectHeight(choice.card));
    let startProblem: string | null = null;
    try {
      if (choice) {
        await cards.openStart(choice.card);
      } else if (!unreadable && store) {
        // 範例走和匯入一樣的完整檢查；某一張讀不到或沒通過就跳過，一張都沒打開才改開空白卡。匯入的每一張記進 meta samplesAdded（T-829）
        const opened = await importSamplesOnFirstOpen({
          fetchSample,
          importer: importHolocard,
          newId: () => crypto.randomUUID(),
          now: () => Date.now(),
          open: (card, images) => cards.adopt(card, images),
          keep: (card, images, thumbnail) => cards.addToLibrary(card, images, thumbnail),
          store,
        });
        if (!opened) throw new Error('範例卡一張都沒有打開');
      }
    } catch (err) {
      console.error(err);
      startProblem = choice ? OPEN_FAILED_TEXT : SAMPLE_FAILED_TEXT;
    }
    if (!editor) {
      // 打不開：給一張空白卡（照樣存進卡片庫）；讀不到卡片庫時不存（可能已經有卡，只是這次讀不到）
      await cards.adopt(blankName(newCard('standard', crypto.randomUUID(), now())), [], { save: !unreadable });
      if (!editor) editor = ed.createEditor(blankName(newCard('standard', crypto.randomUUID(), now())));
    }
    if (unreadable) startProblem = UNREADABLE_TEXT;
    if (startProblem) showError(startProblem);
    // 開好卡就顯示存檔狀態（onStatus 只在狀態「變了」才通知；剛開好的卡本來就是「已儲存」，不補就一直不顯示）
    saveStatus ??= cards.saver.status();
    // 開好卡才把資料流交給畫面（T-409）：之前按的換卡、匯入、卡片庫不會和開卡搶著改
    session = cards;
    // 第一次開啟時，第一張範例一打開畫面就能改，但其他範例還在讀時 session 是 null、改了也沒排存檔（T-605c）：
    // 交給畫面這時補排一次（狀態跟著變「儲存中…」）。正在拖曳就不用：放開時照常會排
    if (editor.history.previewBase === null) cards.saveIfChanged();
    // 換語言回來（T-828j，DESIGN §9「回來還是同一張卡、同一面」）：開到的是換語言前那張卡才還原那一面，直接到位（不轉過去）
    if (place && ed.currentCard(editor).id === place.cardId && place.face !== ed.shownFace(editor)) {
      editor = ed.showSide(editor, place.face);
      view = settleNow(turnToFace(view, place.face));
    }
  } finally {
    // 開卡做完（或出錯）才讓別的分頁接手：不然接手的分頁可能讀到還沒建好的卡片庫
    markStarted();
  }
  update();
  void cards.saver.checkCapacity();

  // 補新的範例（T-829，DESIGN 7.4）：卡片庫還沒拿過的範例或新版，在背景安靜地補進去（不換卡、不打斷）；補了就提示一句列名字。
  // 第一次使用時範例剛匯入過、讀不到卡片庫時不補；沒拿著編輯權就不補。T-829c：每張「重讀卡片庫、比對、存進去」排在存檔的寫入隊伍裡
  // （saver.exclusive：換卡、匯入、建範例、刪卡都在這條隊伍，中間插不進來）；被別的分頁接手過（awayEpoch 變了）這一輪就停，
  // 拿回來也不復活。換語言重新載入不等它：中途關掉頁面，下次開時重讀卡片庫，已經放進去的認得出是同名同版、只記不放
  if (hadLibrary && store) {
    void addNewSamples({
      fetchSample,
      importer: importHolocard,
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
      editGeneration: () => (tabLock.holding() ? awayEpoch : null),
      withLibrary: (task) => cards.saver.exclusive(task),
      store,
    }).then((names) => {
      if (names.length === 0 || !tabLock.holding()) return;
      // 展示廳浮著的卡、開著的我的卡片都跟著重讀；畫面上正顯示錯誤時不蓋掉它（卡已經在我的卡片裡了）
      refreshGallery(true);
      refreshOpenLibrary();
      if (editor?.message?.kind !== 'error') showInfo(S.app.samplesAdded(...names));
    });
  }

  scene = await scenePromise;
  if (!scene) {
    ui.hidePoster();
    const msg = document.createElement('p');
    msg.className = 'fatal';
    msg.textContent = FATAL_TEXT;
    ui.previewHost.append(msg);
    return;
  }
  update();

  const s = scene;

  // 作業系統設了「減少動態效果」（DESIGN §8.3，T-608）：回正、翻面、切面直接到位，調深度不自動擺，鍵盤轉卡直接到位。
  // 每次用到時讀 matches（設定一改就跟著變，不用重新整理）；舞台、取景、閃星由 render 自己聽同一個設定。
  // 展示擺動照卡片的開關（預設關；使用者自己打開就照擺）。
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** 調深度的小擺動還在進行嗎（減少動態時不擺）。 */
  const depthWiggling = (t: number) => !reducedMotion.matches && t - lastDepthEdit < WIGGLE_FADE_SEC;

  // 畫面上實際用的 yaw（含調深度的擺動）、卡片是不是正在轉（拖曳轉動、回正、展示擺動、深度擺動：選取框隱藏）
  let poseYaw = view.yaw;
  let turning = false;

  const offsetsFor = (face: FaceSide, yaw: number) =>
    shownCard()?.[face].layers.map((l) => parallaxOffset(face, yaw, view.pitch, l.depth)) ?? [];
  const applyPose = () => {
    const t = seconds();
    const wiggle = view.mode === 'dragging' ? 0 : depthWiggle(t - wiggleStart, t - lastDepthEdit, reducedMotion.matches);
    const yaw = view.yaw + wiggle;
    poseYaw = yaw;
    turning = view.mode === 'dragging' || view.mode === 'returning' || showcase.run !== null || depthWiggling(t);
    s.setPose({ yawDeg: yaw, pitchDeg: view.pitch, zoom: view.zoom, front: offsetsFor('front', yaw), back: offsetsFor('back', yaw) });
  };

  // ---- 直接在卡上調圖層（DESIGN §3）：選取框、把手、按下去是移動／縮放／轉卡 ----
  const overlay = createOverlay(ui.overlayHost, ui.previewHost);

  interface SelectionBox {
    face: FaceSide;
    layer: Layer;
    /** 看到的框（含視差位移），卡面座標。 */
    rect: LayerRect;
    /** 框四角的螢幕座標（左上、右上、右下、左下）。 */
    cornersPx: Point[];
  }

  /** 選中的圖層的框：沒選取、圖層隱藏、卡片正在轉、或那一面背對鏡頭＝null（不畫、按下去一律轉卡）。 */
  const selectionBox = (): SelectionBox | null => {
    if (!editor || turning || editor.selectedLayerId === null) return null;
    const face = editor.face;
    const id = editor.selectedLayerId;
    const layer = ed.currentCard(editor)[face].layers.find((l) => l.id === id);
    const img = layer && getImage(layer.image);
    if (!layer || !layer.visible || !img) return null;
    const offset = parallaxOffset(face, poseYaw, view.pitch, layer.depth);
    const size = layerSize(img.naturalWidth, img.naturalHeight, layer.scale);
    // 文字圖層：圖兩旁是透明邊，框只框住字（字的範圍從圖的 alpha 算，存檔載入的卡也一樣）
    const ink = layer.text ? registry.inkBox(layer.image) : undefined;
    const rect = layerRect(layer, offset, ink ? { w: size.w * ink.w, h: size.h * ink.h } : size);
    const cornersPx: Point[] = [];
    for (const c of rectCorners(rect)) {
      const p = s.projectCardPoint(face, c.x, c.y);
      if (!p) return null;
      cornersPx.push(p);
    }
    return { face, layer, rect, cornersPx };
  };

  const pressAt = (box: SelectionBox | null, x: number, y: number): Press =>
    classifyPress({
      pointer: { x, y },
      rect: box?.rect ?? null,
      cornersPx: box?.cornersPx ?? null,
      facePoint: box ? s.planePoint(box.face, x, y) : null,
    });

  /** 指標停在哪（沒按著時）；null＝不在預覽區上。 */
  let hoverAt: Point | null = null;
  /** 正在拖圖層（游標與把手維持按下時的樣子）。 */
  let editingLayer = false;

  const refreshOverlay = () => {
    const box = selectionBox();
    overlay.update(box?.cornersPx ?? null);
    if (editingLayer) return;
    const press: Press = hoverAt ? pressAt(box, hoverAt.x, hoverAt.y) : { kind: 'rotate' };
    overlay.setCursor(pressCursor(press, box?.cornersPx ?? null));
    overlay.highlight(press.kind === 'scale' ? press.corner : null);
  };

  /** 按在框內或四角：開始一次圖層拖曳（拖動中 preview、放開 commit＝復原一步；Esc／取消＝回到拖之前）。 */
  const startLayerDrag = (box: SelectionBox, press: Press, x: number, y: number): LayerDrag | null => {
    if (press.kind === 'rotate') return null;
    const down = s.planePoint(box.face, x, y);
    if (!down) return null;
    // 鍵盤還沒記的那一步先記起來（不然會和這次拖曳合成一步，Esc 取消拖曳時連鍵盤的也一起不見，T-607c）
    previewKeys?.flush();
    const { face, layer, rect } = box;
    const center = { x: rect.cx, y: rect.cy };
    let last: LayerPatch | null = null;
    // 拖到一半換卡了（T-409）：這次拖曳作廢，之後的移動、放開都不理
    const gen = generation;
    editingLayer = true;
    overlay.highlight(press.kind === 'scale' ? press.corner : null);
    return {
      move(cx, cy) {
        if (gen !== generation) return;
        const now = s.planePoint(face, cx, cy);
        if (!now) return;
        last = press.kind === 'move' ? moveLayer(layer, down, now) : { scale: scaleLayer(layer.scale, center, down, now) };
        intents.editLayer(layer.id, last, 'preview');
      },
      end() {
        if (gen !== generation) return;
        editingLayer = false;
        if (last) intents.editLayer(layer.id, last, 'commit');
      },
      cancel() {
        if (gen !== generation) return;
        editingLayer = false;
        if (last && editor) change(ed.cancelEdit(editor));
      },
    };
  };
  cancelLayerDrag = () => {
    if (!editingLayer) return;
    editingLayer = false;
    overlay.highlight(null);
  };

  attachPointer(ui.previewHost, {
    press: (x, y) => {
      const box = selectionBox();
      return box && startLayerDrag(box, pressAt(box, x, y), x, y);
    },
    hover: (p) => (hoverAt = p),
    dragStart: () => (view = beginDrag(view)),
    drag: (dx, dy) => (view = dragBy(view, dx, dy, turnNow().pitch)),
    dragEnd: () => {
      const returnToFront = editor ? ed.currentCard(editor).view.returnToFront : true;
      view = returnToFront ? endDrag(view) : releaseInPlace(view);
    },
    // 在框外（卡上或空白處）點一下、沒拖：取消選取（按在框內或把手是圖層拖曳，不會走到這裡）；
    // 點到卡片外面的破框層（T-411）＝選它（選了就出現選取框，可以直接拖）
    click: (x, y) => {
      const hit = s.breakoutAt(x, y);
      if (hit) {
        if (editor?.selectedLayerId !== hit.layerId) intents.selectLayer(hit.layerId);
        return;
      }
      if (editor?.selectedLayerId != null || editor?.foilSelected) intents.selectLayer(null);
    },
    wheel: (dy) => (view = { ...view, zoom: zoomByWheel(view.zoom, dy) }),
  });

  // ---- 用鍵盤操作預覽區（DESIGN §8.2，T-607）----
  // 沒選圖層：方向鍵轉卡（平順轉過去，作業系統設了減少動態就直接到位）、Home 回正面、PageUp／PageDown 或 + − 縮放、F 翻面；
  // 選中圖層：方向鍵移動它、+ − 縮放它，連按合成一步（停手 0.6 秒才記）；選著反光層時方向鍵照樣轉卡（反光層不能移動）。
  /** 選中的、可以移動的圖層（沒選、或選著反光層＝null）。 */
  const movableSelection = (): SelectedLayer | null => {
    if (!editor || editor.foilSelected || editor.selectedLayerId === null) return null;
    const id = editor.selectedLayerId;
    const layer = ed.currentCard(editor)[editor.face].layers.find((l) => l.id === id);
    return layer ? { id: layer.id, x: layer.x, y: layer.y, scale: layer.scale } : null;
  };
  /**
   * 回正、翻面（同點〔正面〕〔背面〕：卡片轉過去、清單跟著換面）；一定取消選中（含反光層），已經在那一面也一樣（T-607c）；
   * 減少動態時直接到位。還沒記的鍵盤移動已經由 keys.ts 先記起來了。
   */
  const turnToFaceByKey = (face: FaceSide) => {
    if (editor) change(ed.showFace(editor, face), face);
    showcase = pauseShowcase(showcase);
    if (reducedMotion.matches) view = settleNow(view);
  };
  previewKeys = attachPreviewKeys(ui.previewHost, {
    context: () => ({ layerSelected: movableSelection() !== null }),
    turn(dYawDeg, dPitchDeg) {
      view = turnByKey(view, dYawDeg, dPitchDeg, !reducedMotion.matches, turnNow().pitch);
      showcase = pauseShowcase(showcase);
    },
    home: () => turnToFaceByKey('front'),
    zoom: (dir) => (view = { ...view, zoom: zoomByKey(view.zoom, dir) }),
    flip: () => turnToFaceByKey(visibleFace(view.mode === 'returning' ? view.targetYaw : view.yaw) === 'front' ? 'back' : 'front'),
    selected: movableSelection,
    editLayer: editLayerNow,
    // 停手後補記一步前核對身分（T-607c）：復原堆疊換過了（換卡、復原、別的操作已經記掉或開了自己的 preview）就不記
    editToken: () => editor?.history ?? null,
  });

  // ---- 卡片故事（T-804）：每影格算卡片正面朝前時的外框，交給畫面排兩側的直排字（卡片轉動時字不動）----
  // 側面剛好對著鏡頭（兩面都看不到）算不出來：沿用上一次的（比例、縮放、畫布位置大小都一樣才用，T-804b）
  let lastStoryBox: { key: string; box: StoryBox } | null = null;
  const placeStory = () => {
    const card = shownCard();
    if (!card || !storyVisible(card)) {
      ui.placeStory(null);
      return;
    }
    const canvas = (ui.previewHost.querySelector('canvas') ?? ui.previewHost).getBoundingClientRect();
    const cardH = aspectHeight(card);
    const box = frontCardRect({
      yawDeg: poseYaw,
      pitchDeg: view.pitch,
      cardH,
      canvas,
      project: (face, x, y) => s.projectCardPoint(face, x, y),
    });
    const key = storyFrameKey(cardH, view.zoom, canvas);
    if (box) lastStoryBox = { key, box };
    ui.placeStory(box ?? (lastStoryBox?.key === key ? lastStoryBox.box : null));
  };

  let afterFrame = () => {};
  // 3D 第一格畫好（第二次進來時上一格已經畫了）就讓開啟時的縮圖淡出
  let framesDrawn = 0;
  /** 上一格展示擺動的幅度倍數（T-832：換進、換出工作桌時這一輪擺動先停）；還沒畫過＝null。 */
  let showcaseScale: number | null = null;
  s.start((dt) => {
    quality.frame(dt);
    if (framesDrawn < 2 && ++framesDrawn === 2) ui.hidePoster();
    // 回正、翻面：減少動態時這一格直接到位
    view = tick(view, dt, reducedMotion.matches);
    // 工作桌（T-832）：幅度變了（換進、換出工作桌）這一輪擺動先停，安靜一下從當時的角度用新的幅度接上（不會一下子跳一半）
    const limits = turnNow();
    if (showcaseScale !== null && showcaseScale !== limits.showcase) showcase = pauseShowcase(showcase);
    showcaseScale = limits.showcase;
    ({ showcase, view } = stepShowcase(
      showcase,
      view,
      {
        enabled: editor ? ed.currentCard(editor).view.showcase : false,
        layerSelected: editor?.selectedLayerId != null || editor?.foilSelected === true,
        depthWiggling: depthWiggling(seconds()),
        scale: limits.showcase,
      },
      dt,
    ));
    // 換到工作桌時已經傾超過 ±10°（鍵盤停在那個角度、setAngle）：夾回來
    view = limitPitch(view, limits.pitch);
    applyPose();
    // 預覽區下方的縮放比例（T-835）：滾輪、鍵盤、按鈕改的都在這裡跟上（值沒變 ui 不碰 DOM）
    ui.setZoom(view.zoom);
    // 前景圖（T-830）：轉卡時往反方向微動（照畫面上實際的角度）；減少動態時 0, 0（不動）；沒有前景圖就整段略過（T-830c）
    if (editor && foregroundOf(ed.currentCard(editor)) !== null) {
      if (reducedMotion.matches) ui.driftForeground(0, 0);
      else {
        const drift = foregroundDrift(poseYaw, view.pitch);
        ui.driftForeground(drift.x, drift.y);
      }
    }
    refreshOverlay();
    placeStory();
    afterFrame();
  });

  if (import.meta.env.DEV) {
    // 標點：每影格依目前角度重新投影
    const marks: { face: FaceSide; x: number; y: number; el: HTMLElement }[] = [];
    afterFrame = () => {
      for (const m of marks) {
        const p = s.projectCardPoint(m.face, m.x, m.y);
        m.el.hidden = p === null;
        if (p) m.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    };
    const current = () => ed.currentCard(editor!);

    const debug: HoloDebug = {
      setAngle(yawDeg, pitchDeg) {
        view = holdAt(view, yawDeg, pitchDeg, turnNow().pitch);
        applyPose();
      },
      setEffectTime: (seconds) => s.setEffectTime(seconds),
      backend: () => s.backend(),
      capture: () => s.capture(),
      captureCard: (options) => s.captureCard(options),
      async captureTurntable(width, frames, seconds) {
        const card = current();
        const offsetsAt = (yaw: number, pitch: number) => ({
          front: card.front.layers.map((l) => parallaxOffset('front', yaw, pitch, l.depth)),
          back: card.back.layers.map((l) => parallaxOffset('back', yaw, pitch, l.depth)),
        });
        const picks = new Set([0, Math.floor(frames / 4), Math.floor(frames / 2), Math.floor((frames * 3) / 4)]);
        const kept: { index: number; rgba: Uint8ClampedArray }[] = [];
        const t0 = performance.now();
        const size = await s.captureTurntable({ width, frames, seconds, offsetsAt }, (rgba, index) => {
          if (picks.has(index)) kept.push({ index, rgba });
        });
        const ms = Math.round(performance.now() - t0);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d')!;
        const samples = kept.map(({ rgba }) => {
          ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);
          return canvas.toDataURL('image/png');
        });
        return { ...size, ms, samples };
      },
      card: () => structuredClone(current()),
      setCard(patch) {
        const card = current();
        change(
          ed.replaceCard(editor!, {
            ...card,
            ...patch,
            frame: { ...card.frame, ...patch.frame },
            holo: { ...card.holo, ...patch.holo },
            shadow: { ...card.shadow, ...patch.shadow },
            view: { ...card.view, ...patch.view },
          }),
        );
      },
      setLayer(face, index, patch) {
        const card = current();
        const layers = card[face].layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
        change(ed.replaceCard(editor!, { ...card, [face]: { ...card[face], layers } }));
      },
      hitTest: (x, y) => s.hitTest(x, y),
      projectCardPoint: (face, x, y) => s.projectCardPoint(face, x, y),
      breakoutAt: (x, y) => s.breakoutAt(x, y),
      lastHit: null,
      mark(points) {
        for (const m of marks.splice(0)) m.el.remove();
        for (const p of points) {
          const el = document.createElement('div');
          el.className = 'debug-mark';
          document.body.append(el);
          marks.push({ ...p, el });
        }
        afterFrame();
      },
      state() {
        const e = editor!;
        const ui = ed.toUiState(e, () => undefined);
        return { face: e.face, selectedLayerId: e.selectedLayerId, foilSelected: e.foilSelected, canUndo: ui.canUndo, canRedo: ui.canRedo };
      },
      view: () => ({ yaw: view.yaw, pitch: view.pitch, zoom: view.zoom, mode: view.mode }),
      listCards: () => cards.list(),
      openCard: (id) =>
        cards.open(id).then((result) => {
          reportOpen(result);
          return result;
        }),
      memory: () => s.memoryInfo(),
      saveStatus: () => cards.saver.status(),
      quality: () => quality.level(),
      forceQuality: (level) => s.setPreviewQuality(qualitySettings(level)),
    };
    ui.previewHost.addEventListener('pointerdown', (e) => {
      debug.lastHit = s.hitTest(e.clientX, e.clientY);
    });
    window.__holo = debug;
  }
}

// 介面語言（T-828，DESIGN §9）：<html lang> 跟著換（瀏覽器才會用對的字形：同一個漢字中、日字形不同）、頁面標題
document.documentElement.lang = lang;
document.title = S.app.title;

const app = document.getElementById('app');
if (!app) throw new Error('找不到 #app');

start(app).catch((err: unknown) => {
  console.error(err);
  const msg = document.createElement('p');
  msg.className = 'fatal';
  msg.textContent = FATAL_TEXT;
  app.append(msg);
});
