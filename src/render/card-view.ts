// three.js 場景：WebGPURenderer（不支援 WebGPU 時 three.js 自動退回 WebGL2）＋卡片＋鏡頭＋影格迴圈＋擷取。
// 不 import 圖片模組、不寫死檔名：卡片內容由 setCard(card, getImage) 決定，圖片與素色卡背紋樣由組裝的 main 注入；
// 角度、縮放、位移量也由 main 每影格傳進來；鐳射的觀看方向由角度算、閃星的時間用影格迴圈的時間（只影響畫面）。
// 作業系統設了減少動態效果（T-608）：閃星與斜線的時間停住、取景直接到位、舞台靜止（設定改了立刻跟著變）。
// 動態特效（T-811，card-mesh／fx-nodes.ts）：預覽用同一個效果時間（減少動態時停在固定一格）；轉動匯出的每一格用影片時間
// （turntableFxTime：第幾格 × 每格秒數），閃星照舊用效果時間；PNG 畫當下那一刻。
// 卡片下方的舞台特效（stage-switch.ts：全息光環 stage-fx.ts／展示廳 gallery-fx.ts〔T-410〕／魔法陣 magic-fx.ts／水鏡 water-fx.ts／
// 星雲 nebula-fx.ts〔T-415〕／工作桌 desk-fx.ts〔T-832〕）是場景裡獨立的一組：不跟著卡片轉、比卡片先畫（不會擋到卡片）、擷取時不畫。
// 工作桌例外（T-832）：透明壓克力展示座拿 setPose 的同一組角度、跟著卡片一起轉，透明面照透明卡套的順序和卡片一起排（遠側 → 破框層 → 近側），
// 擷取時照樣整組不畫（PNG、影片、GIF、縮圖都沒有展示座）。
// captureCard（PNG 匯出、縮圖）：鏡頭 view offset 只渲染緊貼卡片的那一塊（裁切範圍在 pick.ts 的 captureFrame），
// 暫時改的狀態（鏡頭、render target、'front' 時的旋轉與視差）畫完立刻還原，畫面不受影響。
// 擷取（captureCard、captureTurntable〔第一格前一次〕、capture）畫之前先 await compileAsync（T-827：three.js 的 render 不等新的著色程式編譯完，
// 剛換材質就匯出會畫到舊的）；編譯用擷取那一份的 render target 與鏡頭，排好就先還原狀態再等，等待時影格迴圈照畫。
// 破框層（T-411）：擷取的裁切包住這個角度看得到的超出部分（轉一圈取全程聯集）；鏡頭取景多退一點讓超出部分放得進預覽區
// （fit.ts 的 cameraDistance reach，約 0.25 秒平順地退過去；拖圖層等「預覽中」先不動，放開才跟上）；
// 點卡片外面時看有沒有點到破框層（breakoutAt）。
// 反光層（T-417）：選中反光層時 flashFoil(face) 讓那一面亮面的地方閃一下淡斜線（約 1 秒，影格迴圈推進）；
// 任何擷取（PNG、縮圖、轉動匯出、capture）畫的那一格都先關掉斜線、畫完立刻恢復。
// 卡框雕花邊角（T-416）的素材也由 main 讀好注入（deps.frameCorner，T-416b）：建好畫面時已經在了，每一格（含所有擷取）都畫得到；
// 讀不到時是 null，雕花邊角先畫成簡約（右欄由 main 說明），不拖垮整個預覽。
// CD 光碟（T-810，card-mesh／disc.ts）：鏡頭照整片光碟的盒子退（disc.ts 的 discBox，寬高和正方形卡一樣、厚度 0.8 倍）、
// 擷取的裁切包住整片光碟（含最外緣的塑膠邊）、點選時中間那一圈（透明圈與孔）點不到卡面（pick.ts 的 inner）。
// 透明卡套（T-806，card-mesh／sleeve-nodes.ts）：畫面上照卡片的開關畫；captureCard、captureTurntable 照選項的 sleeve
// （省略＝不畫，所以縮圖、卡片檔預覽圖一律不畫），畫的時候裁切包住卡套（pick.ts 的 bounds）。capture()（目前畫面）照畫面。
// 效能自動降級（T-809，DESIGN §8.4）：setPreviewQuality 只影響工坊預覽（畫布的像素比上限、預覽要不要畫景深陰影）；
// 擷取（captureCard、captureTurntable、capture）一律完整畫質：自己的 render target 不看畫布像素比，畫的那一格用 card.withFullShadows 暫時恢復影子。
// 舞台背景圖（T-814）：setBackdrop(圖 | null) 建貼圖（同一張圖只建一次，換圖或拿掉時釋放舊的）交給舞台的遠景接點
// （stage-switch.ts 的 setBackdrop：水鏡畫成水平線上方的遠景、星雲讓出漩渦；其他舞台的遠景在 CSS 那層，由 ui 換圖）。
// 擷取一律不畫舞台；匯出的「畫上背景」是 captureCard／captureTurntable 的 backdrop 選項：整張先鋪原本的不透明底（深藍漸層），
// 再疊背景圖（backdrop.ts 的 paintCover，照輸出畫面的比例置中裁、不壓暗；圖本身有透明的地方露出漸層，T-814b），再疊卡片
// （輸出一定不透明，透明背景的選項不管；GIF 編碼器要求不透明）；轉動匯出每一格同一張。
// 前景圖（T-830）：預覽在 ui 的 CSS 那層（不進 3D）；匯出的「畫上背景」是 captureCard／captureTurntable 的 foreground 選項：
// 卡片疊好之後再畫（backdrop.ts 的 paintForeground，照輸出畫面的比例擺、同一個焦點、模糊照輸出畫面高換算）；轉動匯出每格同一張（先畫好一次）。
// 縮圖、卡片檔預覽圖不給（省略＝不畫）。
// 水鏡遠景（T-815）：setWaterScene(圖 | null) 建貼圖交給舞台（stage-switch 的 setWaterScene，只給水鏡；自己的背景圖優先）。
// 圖由 main 第一次要用時才讀好注入（render 不寫死網址）；貼圖在 scene-textures.ts：同一張只建一次（換來換去不重建），
// 收到 null（main：不是水鏡、或有自己的背景圖）時全部釋放。擷取不畫舞台，所以 PNG、影片、GIF、縮圖都不會有遠景。
// 展示廳畫好的大廳（T-816）：圖在 CSS 那層；setGalleryHall(讀好了沒) 交給舞台（只有展示廳用：地板換成只疊倒影的那種）。
// 遠景的位置與大小（T-822）：setFarPan 交給舞台（只有水鏡用）；匯出的「畫上背景」照 BackdropImage.pan 裁（paintCover 的 farPanRect，
// 同一個焦點與放大、照輸出畫面的比例）；沒有 pan＝置中（和 T-814 一樣）。
// 水鏡的水面樣子（T-825）：setWaterLook 交給舞台（stage-switch 只交給水鏡：霧、倒影拉長、閃光、波紋、卡片高度）；
// 〔地平線〕在這裡：舞台是水鏡、地平線不是 100 時，鏡頭往下移到 water-layout.ts 的 horizonCameraY、畫面用 setViewOffset 往下平移
// horizonShift（lens shift，鏡頭不歪）——卡片所在的平面在畫面上一點都不動（位置、大小、取景都不變），地平線降到卡片腳邊。
// 點選與投影（pick.ts）照移過的鏡頭算；擷取（captureCard、captureTurntable）不畫舞台，鏡頭先放回 y＝0、沒有平移（PNG、影片和以前一樣），
// 畫完還原。其他舞台、地平線 100：鏡頭在 y＝0、沒有 view offset（和以前一模一樣）。
// 星雲畫好的漩渦大圖（T-817）：setNebulaSwirl(圖 | null) 建貼圖交給舞台（stage-switch 的 setNebulaSwirl，只給星雲）。
// 圖由 main 第一次選星雲時才讀好注入（render 不寫死網址）；貼圖同水鏡遠景用 scene-textures.ts（同一張只建一次、sRGB、預設有 mipmap：
// 斜盤面遠處縮小不閃），收到 null（main：不是星雲、有自己的背景圖）時釋放（2048×2048 含 mipmap 約 21 MB 顯示記憶體）。擷取不畫舞台。
// renderer 初始化或建場景失敗：放掉 renderer（GPU 裝置、畫布）再丟出原本的錯。
// 連舞台一起錄（T-850，DESIGN §7.1）：captureTurntable 的 stage 選項＝另一條路（stageTurntable；不給 stage 時上面的路一行都不經過這裡，
// 輸出和以前逐位元相同）：畫面 width × stage.height（呼叫端照 16:9 算）、鏡頭＝預覽的預設鏡頭（stage.zoom、破框與舞台要的取景直接到位、
// 鏡頭 y＝0、沒有地平線的平移、不裁切），舞台照畫（不 hidden）；舞台用擷取自己的一份動態（stage-switch 的 capture）：先空跑（1＋lap）圈、
// 每格走 seconds／frames 秒，和卡片特效同一條每格時間；工作桌的展示座跟著這一格的角度。倒影每次 render 都重畫（reflection.ts 的 freshReflections）。
// 每格的畫面＝CSS 那層（stage-scenery.ts 的 paintScenery，整支先畫好一次）＋3D 讀回的畫格照瀏覽器合成透明畫布的方式疊上去
// （pixels.ts 的 composeOver，不還原預乘：舞台相加的光照預覽的樣子）＋前景圖（stage.foreground，先畫好一次）。backdrop、foreground 不看。

import { PerspectiveCamera, RenderTarget, Scene, SRGBColorSpace, Texture, Vector2, WebGPURenderer } from 'three/webgpu';
import { aspectHeight, isDisc } from '../model/aspect';
import { DEFAULT_WATER_LOOK } from '../model/limits';
import type { Card, FaceSide, FarPan, StageStyle, WaterLook } from '../model/types';
import { createCardObject, type GetImage } from './card-mesh';
import { paintCover, paintForeground, type BackdropImage, type ForegroundImage } from './backdrop';
import { breakoutFade } from './breakout';
import { cameraDistance, cardBox, CARD_THICKNESS, DEFAULT_CARD_H, type FrameBox } from './fit';
import { DISC, DISC_THICKNESS, discBox } from './disc';
import { effectClock, turntableFxTime } from './fx-nodes';
import { foilFlashLevel, FOIL_FLASH_SECONDS, viewDirection } from './holo';
import {
  captureFrame,
  clientToNdc,
  ndcToClient,
  onCardFace,
  pickCard,
  planePoint,
  projectCardPoint,
  turntableFrame,
  turntablePose,
  NOD_RANGE,
  type CardHit,
  type FaceBox,
  type PickScene,
} from './pick';
import { composeOver, packRows, unpremultiply } from './pixels';
import { createGalleryFx, type GalleryThumb } from './gallery-fx';
import { createMagicFx } from './magic-fx';
import { createNebulaFx } from './nebula-fx';
import { createDeskFx } from './desk-fx';
import { BACKDROP_LAYER, freshReflections, STAGE_LAYER } from './reflection';
import { createStageFx } from './stage-fx';
import { sleeveBounds } from './sleeve';
import { createSceneTextures } from './scene-textures';
import { paintScenery, type StageScenery } from './stage-scenery';
import { createStageSwitch, stageReach } from './stage-switch';
import { createWaterFx } from './water-fx';
import { horizonCameraY, horizonShift, horizonViewOffset, waterGap } from './water-layout';

export type { BackdropImage, ForegroundImage } from './backdrop';
export type { GetImage } from './card-mesh';
export type { CardHit } from './pick';
export type { GalleryThumb } from './gallery-fx';
export type { StageScenery } from './stage-scenery';

export interface Offset {
  x: number;
  y: number;
}

export interface CardPose {
  yawDeg: number;
  pitchDeg: number;
  zoom: number;
  /** 每層的視差位移量（interact 算好），順序＝該面的 layers 陣列。 */
  front: Offset[];
  back: Offset[];
}

export interface CardViewDeps {
  /** 開發驗證用：強制使用 WebGL2；省略時維持自動選擇後端。 */
  forceWebGL?: boolean;
  /** 素色卡背紋樣（灰階、中間灰＝不改色），背面沒有圖層時 cover 貼滿卡面。 */
  plainBack: HTMLImageElement;
  /** 展示台圖（原生透明）：舞台特效的底光，鋪在卡片下方的地上。 */
  pedestal: HTMLImageElement;
  /** 卡框雕花邊角的灰階浮雕素材（左上角一張，T-416）；讀不到＝null（雕花邊角先畫成簡約，T-416b）。 */
  frameCorner: HTMLImageElement | null;
}

export interface CaptureOptions {
  /** 輸出圖寬（像素，整數 ≥ 1）；高度依卡片在畫面上的外框比例算（四捨五入、至少 1）。 */
  width: number;
  /** true＝透明背景；false＝深藍徑向漸層背景（和沒有底圖時的舞台背景同色系）。 */
  transparent: boolean;
  /** 'current'＝目前角度與縮放下的樣子（含視差）；'front'＝正對正面（yaw 0、pitch 0）、沒有視差位移（縮圖用）。 */
  pose: 'current' | 'front';
  /** 透明卡套（T-806）：true＝卡片開著卡套時畫卡套（裁切包住卡套）；省略／false＝不畫（縮圖一律不給）。 */
  sleeve?: boolean;
  /**
   * 畫上背景（T-814）：有圖＝整張先鋪深藍漸層底、再疊這張（cover、照輸出的比例置中裁；圖有透明的地方露出漸層，T-814b），再疊卡片；transparent 不管（一定不透明）。
   * 省略／null＝和以前一樣（縮圖、卡片檔的預覽圖一律不給）。
   */
  backdrop?: BackdropImage | null;
  /**
   * 前景圖（T-830，「畫上背景」勾著才給）：卡片之後畫（照輸出畫面的比例擺、模糊照輸出畫面高換算）；透明背景時也是疊在卡片上面。
   * 省略／null＝不畫（縮圖、卡片檔的預覽圖一律不給）。
   */
  foreground?: ForegroundImage | null;
}

export interface TurntableOptions {
  /** 輸出寬（像素，整數 1～4096）；高度依整圈所有角度的卡片外框聯集算、取偶數且不超過 4096，整圈每格同樣大。 */
  width: number;
  /** 一圈幾格（整數 ≥ 2）。 */
  frames: number;
  /** 一圈幾秒（> 0）；省略 timeSpan 時也作為一圈的效果時間。 */
  seconds: number;
  /** 第 0 格的時間（秒，鐳射與閃星照這個時間動）；省略＝目前畫面的時間。GIF 和 WebM 傳同一個值，兩邊的閃星時序就一樣。 */
  startTime?: number;
  /** 一整圈涵蓋的「效果時間」（秒，> 0）；省略＝seconds。第 i 格的時間＝startTime＋i × timeSpan / frames。
   * 讓 timeSpan 是閃星週期的整數倍，GIF 無限循環時接縫就不會跳（呼叫端用 SPARKLE_PERIOD 算）。 */
  timeSpan?: number;
  /** 轉的時候的俯仰角（度），整圈固定（有 nodDeg 時是上下點頭的中心）；預設 0。 */
  pitchDeg?: number;
  /** 每層的視差位移由呼叫端計算，render 不 import interact。 */
  offsetsAt(yawDeg: number, pitchDeg: number): { front: Offset[]; back: Offset[] };
  /**
   * 動作（T-511，使用者 2026-10-14：「左轉再右轉，不要完全旋轉」）：
   * 'turn'＝轉一整圈（預設，yaw 0→360° 不含 360°）；
   * 'swing'＝左右擺動，第 i 格 yaw＝−swingDeg × sin(2π × i / frames)：從正面先往左、回正面、往右、回正面，一個來回＝frames 格，頭尾無縫。
   * 擺動時整圈外框只取擺動範圍內的角度聯集（卡片在畫面裡比轉一圈大）。
   */
  motion?: 'turn' | 'swing';
  /** 擺動幅度（度，5～60），預設 30；只在 motion 'swing' 時用。 */
  swingDeg?: number;
  /**
   * 上下點頭幅度（度，0～25，T-812），預設 0（只有左右，和以前一樣）。第 i 格俯仰角＝pitchDeg − nodDeg × cos(2π × i / frames)
   * （pick.ts 的 turntablePose）：轉一圈與左右擺動都會上下點頭，一個循環＝frames 格，頭尾無縫。
   * 整圈外框沿著這條路徑取聯集（最低 pitchDeg − nodDeg、最高 pitchDeg + nodDeg 都放得下），offsetsAt 拿到的也是那一格的俯仰角。
   */
  nodDeg?: number;
  /** 透明卡套（T-806）：true＝卡片開著卡套時畫卡套（整圈的裁切包住卡套）；省略／false＝不畫。 */
  sleeve?: boolean;
  /** 畫上背景（T-814）：有圖＝每一格的底是深藍漸層上疊這張（cover、照畫格比例置中裁；圖有透明的地方露出漸層，T-814b），每格一定不透明；省略／null＝只有深藍漸層（和以前一樣）。 */
  backdrop?: BackdropImage | null;
  /** 前景圖（T-830）：每一格卡片之後疊這張（照畫格比例擺、每格同一個位置）；省略／null＝不畫。 */
  foreground?: ForegroundImage | null;
  /**
   * 連舞台一起錄（T-850，見檔頭）：有＝畫面 width × stage.height，內容跟預覽一樣（CSS 那層＋3D 舞台＋卡片＋前景圖），
   * 這時 backdrop、foreground 不看（底一律是 stage.scenery、前景是 stage.foreground）；省略＝和以前一樣只有卡片。
   */
  stage?: StageShotOptions;
}

/** 連舞台一起錄（T-850）的設定。 */
export interface StageShotOptions {
  /** 畫面高（像素，整數 1～4096；寬＝width，呼叫端照 16:9 算）。 */
  height: number;
  /** 鏡頭的縮放：預覽的預設縮放（interact 的 ZOOM_DEFAULT；render 不 import interact，由呼叫端給，> 0）。 */
  zoom: number;
  /** 預覽區 CSS 那層（每格的底）。 */
  scenery: StageScenery;
  /** 前景圖（最上面，照畫面比例擺、每格同一個位置）；null＝沒有。 */
  foreground: ForegroundImage | null;
  /** 第幾圈（整數 ≥ 0，影片轉好幾圈時）：舞台先空跑（1＋lap）圈，動畫接著前幾圈走、不重來。省略＝0。 */
  lap?: number;
  /**
   * 上下角度的範圍（度，≥ 0）：每一格的上下角度（基本俯仰＋點頭）夾在 ±pitchLimit（卡片、舞台、視差都用夾過的）。
   * 工作桌給預覽的範圍（interact 的 turnLimits(true)，±10°：跟預覽一樣，展示座不會傾得比預覽大；T-850 主對話決定）；省略＝不夾。
   */
  pitchLimit?: number;
}

/** 預覽畫質（T-809）：由 interact/quality.ts 的等級換算，render 不 import interact，所以是兩個普通數值。 */
export interface PreviewQuality {
  /** 畫布像素比的上限（再和螢幕本來的像素比、MAX_PIXEL_RATIO 取最小）；Infinity 或不合理的數字（≤ 0、NaN）＝不另外限制。 */
  pixelRatioCap: number;
  /** 預覽要不要畫景深陰影。 */
  shadows: boolean;
}

export interface CardScene {
  /**
   * 顯示這張卡。圖層組成（每面的 layer id＋圖片）或比例、圓角改了才重建網格／材質；
   * 只改 x／y／scale／visible／卡身色／卡框時只更新 uniform（拖曳時可以每格呼叫）。
   */
  setCard(card: Card, getImage: GetImage): void;
  setPose(pose: CardPose): void;
  /** 開始影格迴圈；每影格先呼叫 beforeFrame（秒），再畫。 */
  start(beforeFrame: (dtSec: number) => void): void;
  backend(): 'webgpu' | 'webgl2';
  /**
   * 開發用（__holo.setEffectTime，T-811 驗收拍特效的固定時刻）：把效果時間（閃星、動態特效）固定在 seconds 秒，馬上生效；
   * null＝回到照影格時間走（減少動態時照舊停住）。
   */
  setEffectTime(seconds: number | null): void;
  /** 用 render target 畫目前畫面（只有卡片，不畫舞台）、非同步讀回，輸出 PNG data URL。 */
  capture(): Promise<string>;
  /** 只畫卡片（不畫舞台）、裁成緊貼卡片外框（四邊各留外框寬 4% 的邊），輸出 PNG Blob。不影響畫面上正在顯示的樣子。 */
  captureCard(options: CaptureOptions): Promise<Blob>;
  /**
   * 離屏固定步進畫一圈（yaw 0°～360°，不含 360°）：只有卡片、不畫舞台，不透明深藍底。
   * 每格同步還原畫面後才讀回並等待 onFrame；rgba 每格都是新陣列，可由呼叫端保留。
   * signal 取消以 AbortError reject；完成、失敗或取消都還原暫改的狀態。
   */
  captureTurntable(
    options: TurntableOptions,
    onFrame: (rgba: Uint8ClampedArray, index: number) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ width: number; height: number }>;
  /**
   * 螢幕座標（clientX／clientY）打到卡片的哪一面、哪一點（卡寬單位、卡片中心為 0、看著那一面的 +x 右 +y 上，背面不鏡像）；
   * 沒打到卡面回 null。用最近一次 setPose 的角度；不含視差位移。
   */
  hitTest(clientX: number, clientY: number): CardHit | null;
  /** 卡面上一點 → 螢幕 client 座標；那一面背對鏡頭時回 null。不含視差位移。 */
  projectCardPoint(face: FaceSide, x: number, y: number): { x: number; y: number } | null;
  /**
   * 螢幕座標打到「某一面所在的無限平面」的哪一點（卡寬單位、看著那一面 +x 右 +y 上，背面不鏡像；不限卡片範圍，
   * 拖曳圖層拖到卡外也能算）。那一面背對鏡頭、或射線和平面平行時回 null。不含視差位移。
   */
  planePoint(face: FaceSide, clientX: number, clientY: number): { x: number; y: number } | null;
  /**
   * 卡片下方的舞台特效（SCHEMA view.stage）：'halo' 全息光環、'gallery' 展示廳（T-410）、'magic' 魔法陣、'water' 水鏡、
   * 'nebula' 星雲（T-415）、'desk' 工作桌（T-832：壓克力展示座跟著卡片轉）、'none' 整個不畫。
   * 換主題時舊的整組釋放（網格、材質、貼圖、倒影），新的才建立；同一個主題再呼叫不做事。
   * 舞台不跟著卡片轉（工作桌的展示座例外：跟著卡片一起轉）、不擋卡片、不影響 hitTest／projectCardPoint／planePoint；
   * 擷取（capture、captureCard、captureTurntable）不畫舞台。
   */
  setStage(style: StageStyle): void;
  /**
   * 展示廳兩側浮著的縮圖（T-410）：卡片庫裡其他卡已存的正面縮圖（最多用前 6 張、不含目前這張，由呼叫端挑好）；
   * 空清單＝用玻璃卡剪影。記住，切到展示廳時才用；render 畫進自己的拼圖貼圖，不留著這些圖。
   */
  setGalleryThumbs(thumbs: readonly GalleryThumb[]): void;
  /**
   * 舞台背景圖（T-814）：換成這張（舞台的遠景接點，見檔頭）；null＝各舞台本來的遠景。同一張圖（同一個 image）再呼叫不做事；
   * 換圖或拿掉時舊的貼圖釋放。擷取不畫舞台，所以也不畫這張（匯出的「畫上背景」用 captureCard／captureTurntable 的 backdrop）。
   */
  setBackdrop(backdrop: BackdropImage | null): void;
  /**
   * 水鏡的遠景圖（T-815，湖光山峰／水墨山／富士山其中一張，main 讀好給）：交給水鏡畫在水平線上方、倒影裡也有；自己的背景圖優先。
   * 同一張圖的貼圖只建一次（換來換去不重建）；null＝不需要（不是水鏡、有自己的背景圖、圖還沒讀好）→ 遠景的貼圖全部釋放。
   */
  setWaterScene(scene: BackdropImage | null): void;
  /**
   * 遠景的位置與大小（T-822，卡片的 view.farPan；main 每次 update 交 model 的 farPanOf）：交給舞台（stage-switch 只交給水鏡，
   * 遠景平面照 backdrop.ts 的 farPanRect 裁；其他舞台的遠景在 CSS 那層，由 ui 照同一個算法擺）。值一樣不做事。
   * 擷取不畫舞台；匯出的「畫上背景」照 BackdropImage.pan 裁（paintBase → paintCover）。
   */
  setFarPan(pan: FarPan): void;
  /**
   * 展示廳畫好的大廳（T-816）讀好了沒：大廳圖本身在 CSS 那層（ui/stage.ts，main 第一次選展示廳時才讀）；讀好（true）之後
   * 展示廳的石地板換成只疊倒影與光的大廳地板、光柱變淡（stage-switch 只交給展示廳）。render 不碰那張圖。
   */
  setGalleryHall(shown: boolean): void;
  /**
   * 水鏡的水面樣子（T-825，卡片的 view.waterLook；main 每次 update 交 model 的 waterLookOf）：霧、倒影拉長、閃光、波紋、卡片高度交給舞台
   * （stage-switch 只交給水鏡）；地平線移鏡頭（見檔頭）。值一樣不做事。擷取不畫舞台、鏡頭照以前。
   */
  setWaterLook(look: Readonly<WaterLook>): void;
  /**
   * 星雲畫好的漩渦大圖（T-817，main 第一次選星雲時讀好給）：交給星雲畫在卡片後面（慢慢轉）；null＝不需要（不是星雲、有自己的背景圖、
   * 圖還沒讀好或讀不到 → 星雲照程式漩渦畫）→ 貼圖釋放。同一張圖的貼圖只建一次。擷取不畫舞台。
   */
  setNebulaSwirl(swirl: BackdropImage | null): void;
  /**
   * 點卡片外面（T-411）：螢幕座標打到朝著鏡頭那一面所在的平面、在卡片輪廓外，而且那一點有破框層不透明的部分
   * （由前往後第一個）→ 回那一層；點在卡片上、沒點到、那一面接近 90°（卡外部分不畫）→ null。用最近一次 setPose。
   */
  breakoutAt(clientX: number, clientY: number): { face: FaceSide; layerId: string } | null;
  /**
   * 破框層的取景（T-411）：hold＝true 時鏡頭距離完全不動（進行中的取景動畫也停住；拖圖層時跟著退會讓拖曳的點跑掉）；
   * 改回 false 時目標換成卡片目前的內容，之後平順地跟上。
   */
  holdFraming(hold: boolean): void;
  /**
   * 選中反光層（T-417）：這一面亮面的地方疊一層淡淡會動的斜線約 1 秒（holo.ts 的 foilFlashLevel），讓人看出範圍。
   * 再呼叫一次從頭開始；換另一面時原本那一面立刻關掉。擷取的畫面不會有斜線。
   */
  flashFoil(face: FaceSide): void;
  /**
   * GPU 上還活著的貼圖與幾何數量（renderer.info.memory，T-404）：換卡時舊卡的貼圖與材質會在 setCard 重建時釋放，
   * 用這個確認連續換卡不會一直長。只讀、不改任何東西。
   */
  memoryInfo(): { textures: number; geometries: number; texturesBytes: number };
  /**
   * 效能自動降級（T-809）：降低（或恢復）工坊預覽的畫質。只改畫布像素比與景深陰影的 uniform，不換材質；
   * 擷取（PNG、縮圖、轉動影片／GIF、capture）不受影響，一律完整畫質。像素比實際沒變（螢幕本來就是 1 倍）時不重設畫布。
   */
  setPreviewQuality(quality: PreviewQuality): void;
}

const FOV_DEG = 30;
const MAX_PIXEL_RATIO = 2;
/** 連舞台一起錄（T-850）：第 0 格之前舞台先空跑幾圈（光環的轉速反應、漣漪先走到穩定，不是剛開始的樣子）。 */
const STAGE_PREROLL_LAPS = 1;
const RAD = Math.PI / 180;
/** 破框層的取景改變時，鏡頭退過去的時間常數（秒）：約 0.25 秒到位。 */
const FRAMING_EASE_SEC = 0.08;

/** 擷取輸出圖的長邊上限（像素）：WebGPU 與 WebGL2 都穩定支援的貼圖大小。 */
const MAX_CAPTURE_SIDE = 4096;
/**
 * captureCard 不透明時的背景：同 style.css 的 --stage-bg（沒有底圖時的舞台背景）
 * radial-gradient(ellipse 80% 70% at 50% 40%, #1a2c5c 0%, #0c1736 55%, #060b1b 100%)。
 */
const BACKDROP = {
  centerX: 0.5,
  centerY: 0.4,
  radiusX: 0.8,
  radiusY: 0.7,
  stops: [
    [0, '#1a2c5c'],
    [0.55, '#0c1736'],
    [1, '#060b1b'],
  ],
} as const;

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立 2D 畫布');
  return { canvas, ctx };
}

/** 深藍橢圓徑向漸層蓋滿整張畫布。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const b = BACKDROP;
  ctx.save();
  // 把單位圓拉成橢圓：漸層半徑 1＝寬的 radiusX、高的 radiusY
  ctx.translate(width * b.centerX, height * b.centerY);
  ctx.scale(width * b.radiusX, height * b.radiusY);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, color] of b.stops) gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(-b.centerX / b.radiusX, -b.centerY / b.radiusY, 1 / b.radiusX, 1 / b.radiusY);
  ctx.restore();
}

/**
 * 擷取的底：永遠先鋪深藍漸層（不勾「畫上背景」時用的那個底，不透明）；有背景圖（T-814）再把背景圖（cover）疊上去。
 * 背景圖本身有透明或半透明的地方（合法的透明 PNG／WebP）時，露出來的是漸層，所以底一定是不透明的
 * （GIF 編碼器拒絕 alpha 不是 255 的畫格，PNG 取消「透明背景」後也不該帶透明；T-814b）。
 */
export function paintBase(ctx: CanvasRenderingContext2D, width: number, height: number, backdrop: BackdropImage | null | undefined): void {
  paintBackdrop(ctx, width, height);
  if (backdrop) paintCover(ctx, backdrop, width, height);
}

/**
 * 擷取的卡片（已經還原成直通 alpha 的 RGBA）疊到底上，回畫好的畫布（captureCard 用；GPU 回歸頁也用這個驗）：
 * 有背景圖（T-814）＝先鋪底（paintBase：漸層＋背景圖）再疊卡片，輸出不透明；沒有：transparent＝只有卡片（透明底）、不然＝深藍漸層＋卡片（和以前一樣）。
 * 有前景圖（T-830）＝最後疊在卡片上面（paintForeground）。
 */
export function composeCapture(
  image: ImageData,
  options: Pick<CaptureOptions, 'transparent' | 'backdrop' | 'foreground'>,
): HTMLCanvasElement {
  const { width: w, height: h } = image;
  const out = canvas2d(w, h);
  if (!options.backdrop && options.transparent) {
    out.ctx.putImageData(image, 0, 0);
  } else {
    // putImageData 會直接蓋掉底下的像素（不混色）：卡片先放到另一張畫布，再疊到底上
    paintBase(out.ctx, w, h, options.backdrop);
    const layer = canvas2d(w, h);
    layer.ctx.putImageData(image, 0, 0);
    out.ctx.drawImage(layer.canvas, 0, 0);
  }
  if (options.foreground) paintForeground(out.ctx, options.foreground, w, h);
  return out.canvas;
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 圖片產生失敗'))), 'image/png');
  });
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('擷取已取消', 'AbortError');
}

export async function createCardView(container: HTMLElement, deps: CardViewDeps): Promise<CardScene> {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: deps.forceWebGL });
  try {
    await renderer.init();
    return buildCardView(renderer, container, deps);
  } catch (err) {
    // 初始化或建場景失敗：已經建的 renderer 放掉、畫布不留在畫面上；放不掉（沒初始化完）也照樣丟原本的錯
    renderer.domElement.remove();
    try {
      renderer.dispose();
    } catch {
      // 忽略
    }
    throw err;
  }
}

/** renderer 初始化好之後：建場景、卡片、舞台、鏡頭，回傳畫面物件（同步，丟錯由 createCardView 收拾）。 */
function buildCardView(renderer: WebGPURenderer, container: HTMLElement, deps: CardViewDeps): CardScene {
  // 畫布的像素比：完整畫質＝螢幕的（最多 MAX_PIXEL_RATIO）；效能自動降級（setPreviewQuality）時再被 pixelRatioCap 壓低
  let pixelRatioCap = Number.POSITIVE_INFINITY;
  const fullPixelRatio = () => Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  let shownPixelRatio = fullPixelRatio();
  renderer.setPixelRatio(shownPixelRatio);
  container.append(renderer.domElement);

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

  // 畫布透明：後面是 ui 的舞台背景（正面底圖放大模糊，DESIGN §5）；capture() 也因此是透明底
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.05, 100);
  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  const card = createCardObject(deps.plainBack, anisotropy, deps.frameCorner);
  scene.add(card.group);
  // 舞台：獨立的一組（不放在卡片的 group 裡）；作業系統設了減少動態效果時靜止，設定改了立刻跟著變。
  // 一次只有一種主題在場景裡（stage-switch.ts）；舞台的東西在 STAGE_LAYER，主鏡頭兩層都看、展示廳與水鏡的倒影只看卡片
  const stage = createStageSwitch<GalleryThumb>({
    halo: () => {
      const halo = createStageFx(deps.pedestal, anisotropy);
      halo.setStyle('halo');
      return halo;
    },
    gallery: () => createGalleryFx({ camera }),
    magic: () => createMagicFx(),
    water: () => createWaterFx({ camera }),
    nebula: () => createNebulaFx(),
    desk: () => createDeskFx({ camera }),
  });
  scene.add(stage.group);
  camera.layers.enable(STAGE_LAYER);
  // 水鏡的遠景平面（T-814）在 BACKDROP_LAYER：主鏡頭看得到
  camera.layers.enable(BACKDROP_LAYER);
  /** 舞台背景圖的貼圖（T-814）：同一張圖只建一次；換圖、拿掉時釋放。 */
  let backdropShown: { source: BackdropImage['image']; texture: Texture } | null = null;
  /** 舞台用的圖建貼圖（sRGB、各向異性；three.js 預設有 mipmap）。 */
  const stageTexture = (image: BackdropImage) => {
    const texture = new Texture(image.image);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    return texture;
  };
  /** 水鏡遠景的貼圖（T-815）：同一張只建一次；不需要時全部釋放。 */
  const sceneTextures = createSceneTextures(stageTexture);
  /** 星雲大圖的貼圖（T-817）：同一張只建一次；不需要時釋放（和水鏡的分開，釋放一邊不影響另一邊）。 */
  const nebulaTextures = createSceneTextures(stageTexture);
  // 作業系統設了「減少動態效果」（DESIGN §8.3，T-608）：舞台靜止、取景直接到位（不緩動）、閃星停在固定的亮點（卡片的效果時間停住）；
  // 鐳射隨角度變化照舊。設定改了（change）不用重新整理，下一格就跟著變
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedMotion.matches;
  stage.setReducedMotion(reduced);
  reducedMotion.addEventListener('change', (e) => {
    reduced = e.matches;
    stage.setReducedMotion(reduced);
  });

  let zoom = 1;
  /** 卡高（aspectHeight，卡寬＝1；T-807 含自訂、橫式）：鏡頭距離、展示廳與水鏡的取景都照它。 */
  let cardH = DEFAULT_CARD_H;
  /** 這張卡開著透明卡套（T-806）：預覽的鏡頭照卡套外框退（比卡片大一圈，最近縮放、斜看時邊角也不碰畫布邊；T-807 一起做）。 */
  let sleeveShown = false;
  /** 這張是 CD 光碟（T-810）：鏡頭、擷取的裁切、點選照光碟。 */
  let discShown = false;
  /** 目前的舞台主題（展示廳、水鏡的鏡頭多退一點，T-410b、T-415）；還沒設定＝null。 */
  let stageStyle: StageStyle | null = null;
  /** 水鏡的水面樣子（T-825）：地平線、卡片高度決定鏡頭往下移多少。 */
  let waterLook: WaterLook = { ...DEFAULT_WATER_LOOK };
  let hasCard = false;
  /** 卡片內容換過幾次（setCard 一次加一）：擷取等編譯的期間材質變了，要再編譯一次（T-827c）。 */
  let cardRevision = 0;
  // 破框層的取景（T-411）：target＝卡片內容要的、shown＝鏡頭目前用的（影格迴圈裡平順地跟上）
  let reachTarget = { x: 0, y: 0 };
  let reachShown = { x: 0, y: 0 };
  let framingHeld = false;
  let framingStarted = false;
  let yawDeg = 0;
  let pitchDeg = 0;
  // 影格迴圈的時間（秒）：反光層斜線的計時用（減少動態時也照走，斜線才會收掉）
  let clock = 0;
  // card-mesh 的時間只有 setter；記下畫面目前交給它的時間，供離屏擷取暫改後同步還原。
  // 減少動態時固定在 EFFECT_STILL_TIME（fx-nodes.ts 的 effectClock：閃星、斜線、動態特效不動）
  let cardTime = 0;
  /** 開發用（__holo.setEffectTime）：把效果時間固定在這一刻；null＝照影格時間走。 */
  let effectOverride: number | null = null;
  // 選中反光層時的斜線（T-417）：哪一面、從哪一格開始（下一格才知道時間）、目前強度
  let flash: { face: FaceSide; start: number | null } | null = null;
  let flashLevel = 0;
  /** 畫擷取的那一格時先關掉斜線，畫完立刻恢復（同步做完，畫面不受影響）。 */
  const withoutFlash = (draw: () => void) => {
    const f = flash;
    if (!f || flashLevel === 0) return draw();
    card.setFlash(f.face, 0);
    try {
      draw();
    } finally {
      card.setFlash(f.face, flashLevel);
    }
  };
  /** 擷取要不要畫透明卡套（T-806）：選項要（true）而且這張卡開著卡套。 */
  const sleeveIn = (want: boolean | undefined) => want === true && card.sleeve();
  /** 在擷取的畫面狀態下同步做一件事：影子完整、舞台不畫、反光層斜線不畫；sleeve false 時卡套也不畫（都是做完立刻恢復）。 */
  const inCapture = (sleeve: boolean, run: () => void) =>
    card.withFullShadows(() => stage.hidden(() => withoutFlash(() => (sleeve ? run() : card.withoutSleeve(run)))));
  /** 擷取的那一格（同步畫完立刻恢復）。 */
  const drawCapture = (sleeve: boolean) => inCapture(sleeve, () => renderer.render(scene, camera));
  /**
   * 擷取前先編譯（T-827）：three.js 的 renderer.render 不等新的著色程式編譯完——剛換材質（剛打開卡套、剛加特效、剛換卡片風格）就匯出，
   * 第一次畫時新的著色程式還沒好，畫出來是舊的／不對的（tests/gpu/gpu-harness.ts 實測冷啟動時差 88414 個位元組）。
   * 呼叫端已經把鏡頭、render target 擺成擷取的樣子；compileAsync 的同步前半段就認定當下的 render target、鏡頭與哪些東西看得見
   * （之後才非同步編譯），所以只在這個同步段裡擺成擷取的狀態，回傳的 Promise 等呼叫端還原狀態之後才 await：
   * 等待的期間影格迴圈照畫，不會畫進擷取用的 render target、也不會畫到暫改的鏡頭。編譯的 render target 要和之後畫的是同一個（編譯快取照它算）。
   */
  const compileCapture = (sleeve: boolean): Promise<void> => {
    let compiling: Promise<void> = Promise.resolve();
    inCapture(sleeve, () => {
      compiling = renderer.compileAsync(scene, camera);
    });
    return compiling;
  };
  /**
   * 擷取前先編譯，編譯完「同步」重新算取景再交給呼叫端畫（T-827c）。await 編譯的期間畫面是活的：使用者可能在拖角度、縮放、改視窗大小，
   * setCard 也可能換了材質。所以編譯前算的取景（裁切框、輸出大小）不能拿去畫——await 回來之後 plan() 重算，緊接著畫
   * （await 回來是微任務，中間不會插進事件或影格）。重算出來輸出大小變了就換一個大小對的 render target、再編譯一次（編譯快取照 render target 算）；
   * 等待期間材質換了（cardRevision 變了）也再編譯一次。最多編譯 2 次，之後照畫（不無限追）。
   * compile 要在呼叫當下同步擺好擷取的狀態、排出編譯、還原再回傳 Promise（見 compileCapture）。失敗時放掉 render target。
   */
  const prepareCapture = async <S extends { w: number; h: number }>(
    first: S,
    plan: () => S,
    compile: (shot: S, target: RenderTarget) => Promise<void>,
  ): Promise<{ shot: S; target: RenderTarget }> => {
    const makeTarget = (shot: S) => new RenderTarget(shot.w, shot.h, { samples: 4, colorSpace: SRGBColorSpace });
    let shot = first;
    let target = makeTarget(shot);
    try {
      for (let compiles = 1; ; compiles++) {
        const revision = cardRevision;
        await compile(shot, target);
        shot = plan();
        const resized = shot.w !== target.width || shot.h !== target.height;
        if (resized) {
          target.dispose();
          target = makeTarget(shot);
        }
        if ((!resized && revision === cardRevision) || compiles >= 2) return { shot, target };
      }
    } catch (err) {
      target.dispose();
      throw err;
    }
  };
  /** 擷取的裁切：畫卡套時包住卡套（比卡片大一圈、比較厚）。 */
  const framing = (s: PickScene, sleeve: boolean): PickScene => (sleeve ? { ...s, bounds: sleeveBounds(card.outline()) } : s);
  const stepFlash = () => {
    if (!flash) return;
    flash.start ??= clock;
    const t = clock - flash.start;
    flashLevel = foilFlashLevel(t);
    card.setFlash(flash.face, flashLevel);
    if (t >= FOIL_FLASH_SECONDS) flash = null;
  };

  /** 鏡頭要放進畫面的盒子：開著卡套＝卡套（sleeve.ts 的 sleeveBounds），沒開＝卡片。 */
  const fitBox = (): FrameBox => (sleeveShown ? sleeveBounds(card.outline()) : discShown ? discBox() : cardBox(cardH));
  /** 水鏡的地平線（T-825）：鏡頭的高度（世界 y）；不是水鏡、地平線 100＝0（和以前一樣）。 */
  const horizonY = () => (stageStyle === 'water' ? horizonCameraY(cardH, waterGap(waterLook.lift), waterLook.horizon) : 0);
  const placeCamera = () => {
    const z = cameraDistance(FOV_DEG, camera.aspect, zoom, fitBox(), reachShown);
    const y = horizonY();
    camera.position.set(0, y, z);
    if (y === 0) {
      // 和以前一樣：沒有 view offset（地平線剛改回 100、或擷取用過之後關著的也照樣關）
      if (camera.view?.enabled) camera.clearViewOffset();
      else camera.updateProjectionMatrix();
    } else {
      // 鏡頭往下移、畫面往下平移（lens shift）：卡片所在的平面在畫面上不動，地平線降到鏡頭的高度
      const v = horizonViewOffset(horizonShift(y, z, FOV_DEG), camera.aspect);
      camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
    }
  };
  /** 取景往目標靠近 dt 秒（dt＝Infinity 直接到位）；有變才搬鏡頭。 */
  const easeFraming = (dt: number) => {
    if (reachShown.x === reachTarget.x && reachShown.y === reachTarget.y) return;
    const k = 1 - Math.exp(-Math.max(0, dt) / FRAMING_EASE_SEC);
    const step = (from: number, to: number) => (Math.abs(to - from) < 1e-4 ? to : from + (to - from) * k);
    reachShown = { x: step(reachShown.x, reachTarget.x), y: step(reachShown.y, reachTarget.y) };
    placeCamera();
  };
  /**
   * 取景目標改成卡片目前的內容（拖曳中 hold 著就先不改）：破框層要的範圍；舞台是展示廳（T-410b：鏡頭多退約 8%，
   * 整座台子與台面倒影露出來）或水鏡（T-415：上下多退，水面倒影露出來）時再和 stageReach 取較大的。
   * 全息光環、魔法陣、星雲、關閉不影響取景。
   */
  const retarget = () => {
    if (framingHeld) return;
    const r = card.reach();
    const g = stageReach(stageStyle, cardH);
    reachTarget = { x: Math.max(r?.x ?? 0, g?.x ?? 0), y: Math.max(r?.y ?? 0, g?.y ?? 0) };
  };
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    placeCamera();
  };
  resize();
  new ResizeObserver(resize).observe(container);

  const setOffsets = (uniforms: Vector2[], values: Offset[]) => {
    uniforms.forEach((u, i) => u.set(values[i]?.x ?? 0, values[i]?.y ?? 0));
  };

  /** plain：擷取用（鏡頭放回 y＝0、沒有地平線的平移）；省略＝畫面上的鏡頭（點選與投影）。 */
  const pickScene = (plain = false): PickScene => {
    let s: PickScene = {
      vFovDeg: FOV_DEG,
      viewAspect: camera.aspect,
      cameraZ: camera.position.z,
      yawDeg,
      pitchDeg,
      outline: card.outline(),
      thickness: CARD_THICKNESS,
    };
    // 水鏡的地平線（T-825）：鏡頭往下移、畫面平移
    const y = plain ? 0 : camera.position.y;
    if (y !== 0) s = { ...s, cameraY: y, shiftY: horizonShift(y, camera.position.z, FOV_DEG) };
    // CD 光碟（T-810）：比較薄、中間那一圈不是卡面；擷取的裁切包住整片光碟（輪廓只到印刷面外緣）
    return discShown ? { ...s, thickness: DISC_THICKNESS, inner: DISC.printInner, bounds: discBox() } : s;
  };

  /** 這一格各層的位移（offsetsAt 的結果）。 */
  type FrameOffsets = { front: Offset[]; back: Offset[] };
  /** captureTurntable 驗好的設定（stageTurntable 用）。 */
  interface TurntableParams {
    width: number;
    frames: number;
    seconds: number;
    pitch: number;
    startTime: number;
    timeSpan: number;
    motion: 'turn' | 'swing';
    swingDeg: number;
    nodDeg: number;
  }
  /**
   * 連舞台一起錄（T-850，見檔頭）：captureTurntable 給了 stage 時走這裡。舊的路（只有卡片）不經過這裡。
   * 畫的那一格：影子完整、反光層斜線不畫、卡套照選項；舞台照畫、倒影每次 render 都重畫。
   */
  const stageTurntable = async (
    p: TurntableParams,
    options: TurntableOptions,
    st: StageShotOptions,
    onFrame: (rgba: Uint8ClampedArray, index: number) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{ width: number; height: number }> => {
    const { width, frames, seconds, pitch, startTime, timeSpan, motion, swingDeg, nodDeg } = p;
    const { height, zoom: stageZoom, lap = 0, pitchLimit = Number.POSITIVE_INFINITY } = st;
    if (!Number.isInteger(height) || height < 1 || height > MAX_CAPTURE_SIDE) throw new Error(`畫面高要是 1～${MAX_CAPTURE_SIDE} 的整數`);
    if (!Number.isFinite(stageZoom) || stageZoom <= 0) throw new Error('鏡頭縮放要是大於 0 的有限數字');
    if (!Number.isInteger(lap) || lap < 0) throw new Error('第幾圈要是 0 以上的整數');
    if (Number.isNaN(pitchLimit) || pitchLimit < 0) throw new Error('上下角度範圍要是 0 以上的數字');
    const aspect = width / height;
    /** 取景（同步算；等編譯之後會再算一次，同 prepareCapture）：預覽的預設鏡頭，破框與舞台要的範圍直接到位。 */
    const plan = () => {
      const r = card.reach();
      const g = stageReach(stageStyle, cardH);
      const reach = { x: Math.max(r?.x ?? 0, g?.x ?? 0), y: Math.max(r?.y ?? 0, g?.y ?? 0) };
      return { w: width, h: height, sleeve: sleeveIn(options.sleeve), cameraZ: cameraDistance(FOV_DEG, aspect, stageZoom, fitBox(), reach) };
    };
    type Plan = ReturnType<typeof plan>;
    /** 第 index 格（可以超過一圈：空跑用，照一圈的格數繞回）的左右、上下角度；上下角度夾在 ±pitchLimit（工作桌）。 */
    const poseAt = (index: number) => {
      const p = turntablePose(motion, swingDeg, nodDeg, pitch, index % frames, frames);
      const clamped = Math.min(pitchLimit, Math.max(-pitchLimit, p.pitchDeg));
      return clamped === p.pitchDeg ? p : { ...p, pitchDeg: clamped };
    };
    /**
     * 把畫面暫時擺成第 index 格（角度、位移、時間、鏡頭、render target），同步做 step（拿到這一格的角度），立刻還原。
     * values＝這一格各層的位移；null＝不動目前的位移（編譯、空跑不需要）。
     */
    const shoot = <T>(shot: Plan, target: RenderTarget, index: number, values: FrameOffsets | null, step: (yaw: number, framePitch: number) => T): T => {
      const { yawDeg: yaw, pitchDeg: framePitch } = poseAt(index);
      const prevTarget = renderer.getRenderTarget();
      const prevAspect = camera.aspect;
      const prevCameraY = camera.position.y;
      const prevCameraZ = camera.position.z;
      const prevView = camera.view;
      const prevViewValues = prevView && { ...prevView };
      const prevRotation = card.group.rotation.clone();
      const prevTime = cardTime;
      const prevYaw = yawDeg;
      const prevPitch = pitchDeg;
      const offsets = [card.offsets('front'), card.offsets('back')];
      const prevOffsets = offsets.map((list) => list.map((v) => v.clone()));
      try {
        card.group.rotation.set(framePitch * RAD, yaw * RAD, 0);
        card.setView(yaw, framePitch);
        if (values) {
          setOffsets(offsets[0]!, values.front);
          setOffsets(offsets[1]!, values.back);
        }
        // 閃星照效果時間；動態特效（T-811）照影片時間；舞台照同一條每格時間（stageTurntable 每格走 seconds／frames）
        card.setTime(startTime + index * (timeSpan / frames), turntableFxTime(index, frames, seconds));
        // 預覽的預設鏡頭：y＝0（水鏡的地平線不移）、整個畫面（不裁切）、畫面比例＝輸出比例
        camera.position.y = 0;
        camera.position.z = shot.cameraZ;
        camera.aspect = aspect;
        camera.clearViewOffset();
        renderer.setRenderTarget(target);
        return step(yaw, framePitch);
      } finally {
        renderer.setRenderTarget(prevTarget);
        camera.view = prevView;
        if (prevView && prevViewValues) Object.assign(prevView, prevViewValues);
        camera.aspect = prevAspect;
        camera.position.y = prevCameraY;
        camera.position.z = prevCameraZ;
        camera.updateProjectionMatrix();
        card.group.rotation.copy(prevRotation);
        card.setView(prevYaw, prevPitch);
        card.setTime(prevTime);
        offsets.forEach((list, face) => list.forEach((v, i) => v.copy(prevOffsets[face]![i]!)));
      }
    };
    /** 擷取的那一格的狀態，但舞台照畫（同 inCapture，少了 stage.hidden）。 */
    const inStageCapture = (sleeve: boolean, run: () => void) =>
      card.withFullShadows(() => withoutFlash(() => (sleeve ? run() : card.withoutSleeve(run))));
    const compileStage = (sleeve: boolean): Promise<void> => {
      let compiling: Promise<void> = Promise.resolve();
      inStageCapture(sleeve, () => {
        compiling = renderer.compileAsync(scene, camera);
      });
      return compiling;
    };
    const drawStage = (sleeve: boolean) => inStageCapture(sleeve, () => freshReflections(() => renderer.render(scene, camera)));

    let target: RenderTarget | undefined;
    try {
      checkAbort(signal);
      const prepared = await prepareCapture(plan(), plan, (s, t) => shoot(s, t, 0, null, () => compileStage(s.sleeve)));
      target = prepared.target;
      const shot = prepared.shot;
      checkAbort(signal);
      // CSS 那層與前景圖：整支先畫好一次，每格重用
      const out = canvas2d(width, height);
      paintScenery(out.ctx, width, height, st.scenery);
      const scenery = out.ctx.getImageData(0, 0, width, height).data;
      let front: HTMLCanvasElement | null = null;
      if (st.foreground) {
        const f = canvas2d(width, height);
        paintForeground(f.ctx, st.foreground, width, height);
        front = f.canvas;
      }
      const pixels = new Uint8ClampedArray(width * height * 4);
      const composed = new Uint8ClampedArray(width * height * 4);
      const image = new ImageData(composed, width, height);
      // 舞台：擷取自己的一份動態（畫面那份不動）；先空跑（不畫），第 0 格接在空跑的最後一格後面
      const run = stage.capture();
      const dt = seconds / frames;
      const pre = (STAGE_PREROLL_LAPS + lap) * frames;
      /**
       * 給舞台的角度要跨圈連續（T-850c）：舞台照前後兩格的角度差量轉速（stage-motion 的 stepStageMotion），轉一圈時第 79 格 355.5° 接第 0 格 0°
       * 會被當成倒轉 355.5°（一格之內），光環突然變亮。第 j 步（空跑與正式那圈接著數）每過一圈加 360°；擺動本來就連續。卡片本身的角度不變。
       */
      const stageYaw = (j: number, yaw: number) => (motion === 'turn' ? yaw + 360 * Math.floor(j / frames) : yaw);
      shoot(shot, target, 0, null, () => {
        for (let j = 0; j < pre; j++) {
          const q = poseAt(j);
          run.step(stageYaw(j, q.yawDeg), q.pitchDeg, j === 0 ? 0 : dt);
        }
      });
      for (let index = 0; index < frames; index++) {
        checkAbort(signal);
        const { yawDeg: yaw, pitchDeg: framePitch } = poseAt(index);
        const values = options.offsetsAt(yaw, framePitch);
        shoot(shot, target, index, values, (y, fp) => run.step(stageYaw(pre + index, y), fp, dt, () => drawStage(shot.sleeve)));
        // 所有暫改都已還原，這裡才 await（同只有卡片的那條路）
        const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
        checkAbort(signal);
        packRows(data as ArrayLike<number>, width, height, !isWebGPU, pixels);
        composeOver(pixels, scenery, composed);
        if (front) {
          out.ctx.putImageData(image, 0, 0);
          out.ctx.drawImage(front, 0, 0);
          await onFrame(out.ctx.getImageData(0, 0, width, height).data, index);
        } else {
          // 每格交出新的陣列（呼叫端可以留著）；暫存整支重用
          await onFrame(composed.slice(), index);
        }
      }
      checkAbort(signal);
      return { width, height };
    } finally {
      target?.dispose();
    }
  };

  return {
    setCard(next, getImage) {
      card.update(next, getImage);
      cardRevision++;
      const nextH = aspectHeight(next);
      stage.setCardHeight(nextH);
      hasCard = true;
      // 先換比例：展示廳、水鏡的取景跟著比例（stageReach）；比例（卡高）或卡套開關改了，鏡頭的基本距離跟著變（直接到位）
      const fitChanged = nextH !== cardH || card.sleeve() !== sleeveShown || isDisc(next) !== discShown;
      cardH = nextH;
      sleeveShown = card.sleeve();
      discShown = isDisc(next);
      retarget();
      // 第一格還沒畫（開啟、換卡前）、減少動態、或換了比例／卡套（DESIGN：換比例時鏡頭直接到位，連舞台與破框的取景一起，T-807 審查）：
      // 直接到位，不要看到鏡頭在退
      if (!framingHeld && (!framingStarted || reduced || fitChanged)) easeFraming(Infinity);
      if (fitChanged) placeCamera();
    },

    holdFraming(hold) {
      // hold 著：取景整個凍住（連進行中的動畫也停，T-411c）；放開：目標換成卡片目前的內容，影格迴圈再接著退
      framingHeld = hold;
      retarget();
    },

    breakoutAt(clientX, clientY) {
      if (!hasCard) return null;
      const ndc = clientToNdc(clientX, clientY, renderer.domElement.getBoundingClientRect());
      const s = pickScene();
      for (const face of ['front', 'back'] as const) {
        const p = planePoint(face, ndc.x, ndc.y, s);
        if (!p) continue;
        // 卡片上面照舊（只有破框層在卡外能被點到）；那一面接近 90° 時卡外部分不畫，也點不到
        if (onCardFace(p.x, p.y, s)) return null;
        if (breakoutFade(viewDirection(face, yawDeg, pitchDeg).z) <= 0) return null;
        const layerId = card.breakoutAt(face, p.x, p.y);
        return layerId ? { face, layerId } : null;
      }
      return null;
    },

    setPose(pose) {
      yawDeg = pose.yawDeg;
      pitchDeg = pose.pitchDeg;
      card.group.rotation.set(pitchDeg * RAD, yawDeg * RAD, 0);
      card.setView(yawDeg, pitchDeg);
      stage.setPose(yawDeg, pitchDeg);
      setOffsets(card.offsets('front'), pose.front);
      setOffsets(card.offsets('back'), pose.back);
      if (pose.zoom !== zoom) {
        zoom = pose.zoom;
        placeCamera();
      }
    },

    start(beforeFrame) {
      let last: number | null = null;
      void renderer.setAnimationLoop((time) => {
        const dt = last === null ? 0 : (time - last) / 1000;
        last = time;
        clock = time / 1000;
        cardTime = effectOverride ?? effectClock(clock, reduced);
        card.setTime(cardTime);
        stepFlash();
        framingStarted = true;
        if (!framingHeld) easeFraming(reduced ? Infinity : dt);
        beforeFrame(dt);
        stage.update(dt);
        renderer.render(scene, camera);
      });
    },

    backend() {
      return isWebGPU ? 'webgpu' : 'webgl2';
    },

    setEffectTime(seconds) {
      effectOverride = seconds !== null && Number.isFinite(seconds) ? seconds : null;
      // 馬上交給卡片（窗格沒顯示、影格迴圈停住時，擷取也拿得到這一刻）
      cardTime = effectOverride ?? effectClock(clock, reduced);
      card.setTime(cardTime);
    },

    flashFoil(face) {
      if (flash && flash.face !== face) card.setFlash(flash.face, 0);
      flash = { face, start: null };
      flashLevel = 0;
      card.setFlash(face, 0);
    },

    setStage(style) {
      stage.setStyle(style);
      if (style === stageStyle) return;
      // 展示廳、水鏡的取景（T-410b、T-415）：換主題時鏡頭平順地退過去或回來；第一格還沒畫、或減少動態就直接到位
      const wasY = horizonY();
      stageStyle = style;
      retarget();
      if (!framingHeld && (!framingStarted || reduced)) easeFraming(Infinity);
      // 水鏡的地平線（T-825）：換進、換出水鏡時鏡頭的高度跟著變（卡片在畫面上不動）
      if (horizonY() !== wasY) placeCamera();
    },

    setGalleryThumbs(thumbs) {
      stage.setThumbs(thumbs);
    },

    setBackdrop(backdrop) {
      if ((backdrop?.image ?? null) === (backdropShown?.source ?? null)) return;
      const old = backdropShown;
      if (backdrop && backdrop.width > 0 && backdrop.height > 0) {
        const texture = new Texture(backdrop.image);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        backdropShown = { source: backdrop.image, texture };
        stage.setBackdrop({ texture, width: backdrop.width, height: backdrop.height });
      } else {
        backdropShown = null;
        stage.setBackdrop(null);
      }
      // 舞台已經換成新的（或沒有）才釋放舊的貼圖
      old?.texture.dispose();
    },

    setWaterScene(image) {
      const shown = image ? sceneTextures.get(image) : null;
      stage.setWaterScene(shown);
      // 舞台已經不用了才釋放（不是水鏡、有自己的背景圖、圖不合理）
      if (!shown) sceneTextures.release();
    },

    setNebulaSwirl(image) {
      const shown = image ? nebulaTextures.get(image) : null;
      stage.setNebulaSwirl(shown);
      // 舞台已經不用了才釋放（不是星雲、有自己的背景圖、圖不合理）
      if (!shown) nebulaTextures.release();
    },

    setFarPan(pan) {
      stage.setFarPan(pan);
    },

    setGalleryHall(shown) {
      stage.setGalleryHall(shown);
    },

    setWaterLook(look) {
      stage.setWaterLook(look);
      const wasY = horizonY();
      waterLook = { ...look };
      // 地平線、卡片高度改了：鏡頭的高度跟著變（拖滑桿時每一格都即時跟上）
      if (horizonY() !== wasY) placeCamera();
    },

    setPreviewQuality(quality) {
      pixelRatioCap = quality.pixelRatioCap > 0 ? quality.pixelRatioCap : Number.POSITIVE_INFINITY;
      const ratio = Math.min(fullPixelRatio(), pixelRatioCap);
      if (ratio !== shownPixelRatio) {
        shownPixelRatio = ratio;
        renderer.setPixelRatio(ratio);
      }
      card.setShadows(quality.shadows);
    },

    memoryInfo() {
      const m = renderer.info.memory;
      return { textures: m.textures, geometries: m.geometries, texturesBytes: m.texturesSize };
    },

    hitTest(clientX, clientY) {
      if (!hasCard) return null;
      const ndc = clientToNdc(clientX, clientY, renderer.domElement.getBoundingClientRect());
      return pickCard(ndc.x, ndc.y, pickScene());
    },

    projectCardPoint(face, x, y) {
      if (!hasCard) return null;
      const ndc = projectCardPoint(face, x, y, pickScene());
      return ndc && ndcToClient(ndc, renderer.domElement.getBoundingClientRect());
    },

    planePoint(face, clientX, clientY) {
      if (!hasCard) return null;
      const ndc = clientToNdc(clientX, clientY, renderer.domElement.getBoundingClientRect());
      return planePoint(face, ndc.x, ndc.y, pickScene());
    },

    async capture() {
      // 完整畫質：大小照完整像素比算（預覽降級時畫布比較小，擷取不跟著變小）；視窗大小可能在等編譯時變，所以每次同步重算
      const plan = () => {
        const ratio = fullPixelRatio();
        return {
          w: Math.max(1, Math.floor(Math.max(1, container.clientWidth) * ratio)),
          h: Math.max(1, Math.floor(Math.max(1, container.clientHeight) * ratio)),
        };
      };
      /** render target 設好、做 step（同步）、馬上放回畫面。 */
      const shoot = <T>(target: RenderTarget, step: () => T): T => {
        try {
          renderer.setRenderTarget(target);
          return step();
        } finally {
          renderer.setRenderTarget(null);
        }
      };
      let target: RenderTarget | undefined;
      let data: unknown;
      let shot = plan();
      try {
        // 先等著色程式編譯好（T-827）：render target 設好、排出編譯、馬上放回畫面，之後才 await
        const prepared = await prepareCapture(shot, plan, (_s, t) => shoot(t, () => compileCapture(true)));
        target = prepared.target;
        shot = prepared.shot;
        // PNG 與縮圖只要卡片：舞台不畫、選中反光層的斜線也不畫（卡套照畫面）
        shoot(target, () => drawCapture(true));
        data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, shot.w, shot.h);
      } finally {
        target?.dispose();
      }
      const { w, h } = shot;
      // WebGL2 讀回的列由下到上，要翻；WebGPU 由上到下但每列補齊 256 位元組
      const pixels = packRows(data as ArrayLike<number>, w, h, !isWebGPU);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法建立 2D 畫布');
      ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
      return canvas.toDataURL('image/png');
    },

    async captureTurntable(options, onFrame, signal) {
      checkAbort(signal);
      if (!hasCard) throw new Error('還沒有卡片可以擷取');
      const { width, frames, seconds, pitchDeg: pitch = 0, startTime = cardTime, timeSpan = seconds,
        motion = 'turn', swingDeg = 30, nodDeg = 0 } = options;
      if (!Number.isInteger(width) || width < 1 || width > MAX_CAPTURE_SIDE) {
        throw new Error(`擷取寬度要是 1～${MAX_CAPTURE_SIDE} 的整數`);
      }
      if (!Number.isInteger(frames) || frames < 2) throw new Error('畫格數要是 2 以上的整數');
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('一圈秒數要是大於 0 的有限數字');
      if (!Number.isFinite(startTime)) throw new Error('起始時間要是有限數字');
      if (!Number.isFinite(timeSpan) || timeSpan <= 0) throw new Error('效果時間要是大於 0 的有限數字');
      if (!Number.isFinite(pitch)) throw new Error('俯仰角要是有限數字');
      if (motion !== 'turn' && motion !== 'swing') throw new Error('擷取動作要是 turn 或 swing');
      if (!Number.isFinite(swingDeg) || swingDeg < 5 || swingDeg > 60) {
        throw new Error('擺動幅度要是 5～60 的有限數字');
      }
      if (!Number.isFinite(nodDeg) || nodDeg < NOD_RANGE.min || nodDeg > NOD_RANGE.max) {
        throw new Error(`上下點頭幅度要是 ${NOD_RANGE.min}～${NOD_RANGE.max} 的有限數字`);
      }
      // 連舞台一起錄（T-850）：另一條路；不給 stage 時下面照舊
      if (options.stage) {
        return stageTurntable({ width, frames, seconds, pitch, startTime, timeSpan, motion, swingDeg, nodDeg }, options, options.stage, onFrame, signal);
      }
      /**
       * 這支影片的取景（同步算：裁切框、輸出高度、鏡頭距離、卡套）。等編譯之後會再算一次（prepareCapture）：
       * 等待期間縮放、換卡、改視窗都可能讓上一次算的過時。
       */
      const plan = () => {
        // 破框層超出的部分（T-411）：每個取樣角度用那個角度的位移，全程聯集（沒有破框層就不用算）
        const hasBreakout = card.breakoutBoxes('front').length + card.breakoutBoxes('back').length > 0;
        const boxesAt = hasBreakout
          ? (yaw: number, framePitch: number): FaceBox[] => {
              const values = options.offsetsAt(yaw, framePitch);
              return [...card.breakoutBoxes('front', values.front), ...card.breakoutBoxes('back', values.back)];
            }
          : undefined;
        const sleeve = sleeveIn(options.sleeve);
        // 擷取的鏡頭沒有地平線的平移（T-825：鏡頭放回 y＝0，和以前一樣）
        const frame = turntableFrame(framing({ ...pickScene(true), pitchDeg: pitch }, sleeve), width, motion === 'swing' ? swingDeg : undefined, boxesAt, nodDeg);
        if (frame.height > MAX_CAPTURE_SIDE) throw new Error(`擷取的圖太大（長邊最多 ${MAX_CAPTURE_SIDE} 像素）`);
        return { w: width, h: frame.height, frame, sleeve, cameraZ: camera.position.z };
      };
      type Plan = ReturnType<typeof plan>;
      /** 這一格的左右、上下角度（T-812：上下點頭；nodDeg 0＝俯仰角固定 pitch，和以前逐格一樣）與各層位移（每格只算一次）。 */
      const poseAt = (index: number) => {
        const { yawDeg: yaw, pitchDeg: framePitch } = turntablePose(motion, swingDeg, nodDeg, pitch, index, frames);
        return { yaw, framePitch, values: options.offsetsAt(yaw, framePitch) };
      };
      /**
       * 把畫面暫時擺成第 index 格的樣子（角度、位移、時間、鏡頭、render target），同步做 step，立刻還原。
       * 每格各自記下「目前」的畫面狀態：讀回／onFrame 等待期間，動畫與操作仍可更新。
       * values＝這一格各層的位移；編譯（T-827）不需要，給 null＝不動目前的位移（也就不用多呼叫一次 offsetsAt）。
       */
      const shoot = <T>(shot: Plan, target: RenderTarget, index: number, values: ReturnType<typeof poseAt>['values'] | null, step: () => T): T => {
        const { yawDeg: yaw, pitchDeg: framePitch } = turntablePose(motion, swingDeg, nodDeg, pitch, index, frames);
        const prevTarget = renderer.getRenderTarget();
        const prevAspect = camera.aspect;
        const prevCameraY = camera.position.y;
        const prevCameraZ = camera.position.z;
        const prevView = camera.view;
        const prevViewValues = prevView && { ...prevView };
        const prevRotation = card.group.rotation.clone();
        const prevTime = cardTime;
        const prevYaw = yawDeg;
        const prevPitch = pitchDeg;
        const offsets = [card.offsets('front'), card.offsets('back')];
        const prevOffsets = offsets.map(list => list.map(v => v.clone()));
        try {
          card.group.rotation.set(framePitch * RAD, yaw * RAD, 0);
          card.setView(yaw, framePitch);
          if (values) {
            setOffsets(offsets[0]!, values.front);
            setOffsets(offsets[1]!, values.back);
          }
          // 閃星照效果時間；動態特效（T-811）照影片時間（週期整除 4 秒，頭尾接得上）
          card.setTime(startTime + index * (timeSpan / frames), turntableFxTime(index, frames, seconds));
          // 裁切外框依起始鏡頭距離計算；畫面上的縮放／resize 不改變匯出時的構圖。鏡頭放回 y＝0（水鏡的地平線不進影片，T-825）
          camera.position.y = 0;
          camera.position.z = shot.cameraZ;
          const v = shot.frame.viewOffset;
          camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
          renderer.setRenderTarget(target);
          return step();
        } finally {
          renderer.setRenderTarget(prevTarget);
          // setViewOffset 會改 aspect 與原本的 view 物件；連 null／停用的 view 也原樣還原。
          camera.view = prevView;
          if (prevView && prevViewValues) Object.assign(prevView, prevViewValues);
          camera.aspect = prevAspect;
          camera.position.y = prevCameraY;
          camera.position.z = prevCameraZ;
          camera.updateProjectionMatrix();
          card.group.rotation.copy(prevRotation);
          card.setView(prevYaw, prevPitch);
          card.setTime(prevTime);
          offsets.forEach((list, face) => list.forEach((v, i) => v.copy(prevOffsets[face]![i]!)));
        }
      };
      const first = plan();
      let target: RenderTarget | undefined;
      try {
        // 先等著色程式編譯好（T-827）：整支影片是同一份場景、同一個 render target，第一格前編譯一次就夠（之後有快取）；
        // 編譯完同步重算取景（T-827c），下面的每一格都照重算的畫
        checkAbort(signal);
        const prepared = await prepareCapture(first, plan, (s, t) => shoot(s, t, 0, null, () => compileCapture(s.sleeve)));
        target = prepared.target;
        const { sleeve, h: height } = prepared.shot;
        checkAbort(signal);
        const out = canvas2d(width, height);
        // 每一格的底（T-814：畫上背景＝背景圖，不然深藍漸層）：先畫好一次，每格重用
        paintBase(out.ctx, width, height, options.backdrop);
        const backdrop = out.ctx.getImageData(0, 0, width, height);
        // 前景圖（T-830）：模糊過的那一層先畫好一次，每格疊在卡片上面
        let front: HTMLCanvasElement | null = null;
        if (options.foreground) {
          const f = canvas2d(width, height);
          paintForeground(f.ctx, options.foreground, width, height);
          front = f.canvas;
        }
        const layer = canvas2d(width, height);
        const pixels = new Uint8ClampedArray(width * height * 4);
        const image = new ImageData(pixels, width, height);
        for (let index = 0; index < frames; index++) {
          checkAbort(signal);
          shoot(prepared.shot, target, index, poseAt(index).values, () => drawCapture(sleeve));
          // 所有暫改都已還原，這裡才 await；不使用 requestAnimationFrame 排程，分頁隱藏仍可擷取。
          const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
          checkAbort(signal);
          packRows(data as ArrayLike<number>, width, height, !isWebGPU, pixels);
          unpremultiply(pixels);
          layer.ctx.putImageData(image, 0, 0);
          out.ctx.putImageData(backdrop, 0, 0);
          out.ctx.drawImage(layer.canvas, 0, 0);
          if (front) out.ctx.drawImage(front, 0, 0);
          // getImageData 每格產生新的陣列；整理暫存、背景與兩張畫布則整圈重用。
          await onFrame(out.ctx.getImageData(0, 0, width, height).data, index);
        }
        checkAbort(signal);
        return { width, height };
      } finally {
        target?.dispose();
      }
    },

    async captureCard(options) {
      if (!hasCard) throw new Error('還沒有卡片可以擷取');
      const front = options.pose === 'front';
      /**
       * 這張 PNG 的取景（同步算：破框層、卡套、裁切框、輸出大小）。等編譯之後會再算一次（prepareCapture）：
       * 等待期間拖角度、縮放、換卡都可能讓上一次算的過時，拿舊裁切框拍新姿態會裁掉破框內容。
       */
      const plan = () => {
        // 破框層超出的部分（T-411）：這個角度看得到的也包進去（'front' 沒有視差位移）
        const still = (face: 'front' | 'back') => card.offsets(face).map(() => ({ x: 0, y: 0 }));
        const boxes: FaceBox[] = front
          ? [...card.breakoutBoxes('front', still('front')), ...card.breakoutBoxes('back', still('back'))]
          : [...card.breakoutBoxes('front'), ...card.breakoutBoxes('back')];
        const sleeve = sleeveIn(options.sleeve);
        // 擷取的鏡頭沒有地平線的平移（T-825：鏡頭放回 y＝0，和以前一樣）
        const frame = captureFrame(framing(front ? { ...pickScene(true), yawDeg: 0, pitchDeg: 0 } : pickScene(true), sleeve), options.width, boxes);
        if (frame.width > MAX_CAPTURE_SIDE || frame.height > MAX_CAPTURE_SIDE) throw new Error(`擷取的圖太大（長邊最多 ${MAX_CAPTURE_SIDE} 像素）`);
        return { w: frame.width, h: frame.height, frame, sleeve };
      };
      type Plan = ReturnType<typeof plan>;
      /**
       * 把鏡頭、卡片暫時擺成擷取的樣子（render target 設成 target），同步做 step，立刻還原（影格迴圈的下一格和擷取前一樣）；
       * 暫時改的狀態先全部記下來。每次呼叫各自記「目前」的樣子：編譯等待的期間，動畫與操作仍可更新。
       */
      const shoot = <T>(shot: Plan, target: RenderTarget, step: () => T): T => {
        const prevTarget = renderer.getRenderTarget();
        const prevAspect = camera.aspect;
        const prevCameraY = camera.position.y;
        const prevRotation = card.group.rotation.clone();
        const offsets = [card.offsets('front'), card.offsets('back')];
        const prevOffsets = offsets.map((list) => list.map((v) => v.clone()));
        try {
          // 水鏡的地平線不進 PNG（T-825）：鏡頭放回 y＝0（下面的 setViewOffset 換掉地平線的平移）
          camera.position.y = 0;
          if (front) {
            // 正對正面、沒有視差：卡片轉正、鐳射與卡框高光的觀看方向轉正、每層位移歸零
            card.group.rotation.set(0, 0, 0);
            card.setView(0, 0);
            for (const list of offsets) for (const v of list) v.set(0, 0);
          }
          // 只渲染卡片那一塊、解析度＝輸出大小（setViewOffset 會改鏡頭 aspect，下面還原）
          const v = shot.frame.viewOffset;
          camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
          renderer.setRenderTarget(target);
          return step();
        } finally {
          renderer.setRenderTarget(prevTarget);
          camera.clearViewOffset();
          camera.aspect = prevAspect;
          camera.updateProjectionMatrix();
          // 地平線（T-825）：鏡頭的高度與平移放回去
          if (prevCameraY !== 0) placeCamera();
          card.group.rotation.copy(prevRotation);
          card.setView(yawDeg, pitchDeg);
          offsets.forEach((list, f) => list.forEach((v, i) => v.copy(prevOffsets[f]![i]!)));
        }
      };
      let shot = plan();
      let target: RenderTarget | undefined;
      let data: unknown;
      try {
        // 先等著色程式編譯好（T-827）：編譯的是擷取那一份（同一個 render target、擷取的鏡頭裁切），排出編譯後立刻還原，之後才 await；
        // 編譯完同步重算取景（T-827c），下面照重算的畫
        const prepared = await prepareCapture(shot, plan, (s, t) => shoot(s, t, () => compileCapture(s.sleeve)));
        shot = prepared.shot;
        target = prepared.target;
        // PNG 與縮圖只要卡片：舞台不畫、選中反光層的斜線也不畫；卡套照選項（縮圖不畫）
        shoot(shot, target, () => drawCapture(shot.sleeve));
        data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, shot.w, shot.h);
      } catch (err) {
        throw new Error('擷取卡片畫面失敗', { cause: err });
      } finally {
        target?.dispose();
      }
      const { w, h } = shot;

      // WebGL2 讀回的列由下到上，要翻；WebGPU 由上到下但每列補齊 256 位元組
      const pixels = packRows(data as ArrayLike<number>, w, h, !isWebGPU);
      // 卡片邊緣的半透明像素是預乘的顏色：還原成 PNG 要的顏色，不然邊緣多一圈暗邊
      unpremultiply(pixels);
      // 透明背景／深藍漸層／畫上背景（T-814）
      return toPngBlob(composeCapture(new ImageData(pixels, w, h), options));
    },
  };
}
