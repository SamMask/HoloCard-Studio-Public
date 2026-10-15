// 卡片物件：薄的圓角卡身（只畫側邊）＋正反兩個卡面，內容由 Card 資料決定。
// 「視差窗口」（spec §5.2）：每一面的所有圖層都在同一個卡面網格的 shader 裡由後往前疊，
// 不離開卡面、不靠 z 差排前後（所以斜看也不會 z-fighting）；卡面網格本身就是圓角輪廓，
// 任何角度都不會畫到卡外。每層的位移量由 interact 算好、當 uniform 傳進來，shader 只套用。
//
// 鐳射（holo-nodes.ts）：每個要反光的圖層在合成時各自套一次，用該層的 alpha 當遮罩；卡身與卡框也可以套。
// 反光層（T-417，holo.ts 的 holoTargets）決定哪些東西套亮面鐳射：整面＝以前的全卡（shader 和以前一模一樣，只多了
// 選中時的斜線，強度 0 時加 0）；用圖層形狀＝以前的指定圖層；上傳黑白圖＝亮面再乘黑白圖的亮度（卡面座標 cover、
// 不跟視差）；關＝沒有亮面。整面以外，反光層沒蓋到的地方加「霧光」：由後往前合成時一路記著「這一點最上面的表面
// 有幾成是亮面／霧光」（只算圖層自己的 alpha × 不是中性色的部分；破框層兩種都不是），圖層疊完再加白色的寬光帶 ×
// 霧光的比例（像霧面護膜在最上面）。卡框不反光時卡框也是霧光。選中反光層時，亮面的地方疊一層會動的淡斜線（setFlash）。
//
// 卡框金屬質感（frame.ts 純數學與常數、frame-nodes.ts 著色）：斜面、內緣暗線、隨視角沿框流動的高光、拉絲紋；
// 和鐳射開關無關；反光層「卡框也反光」時鐳射再疊上去，不反光時疊霧光。
// 雕花邊角（T-416，frame.style 'ornate'）：卡框之後再疊四角的花紋（frame-nodes.ts 的 ornateLayer；素材由 createCardObject
// 收進來，第一次用到時做成預乘貼圖、沒有一面用到時收掉；素材讀不到〔null，T-416b〕＝畫成簡約），一樣乘卡框開關、和卡框同一種反光（花紋算卡框的一部分）；
// 破框層照舊蓋在最上面（花紋表面那幾成先疊破框層再混進來）。換樣式＝換兩面的材質；簡約的材質和以前一模一樣。
//
// 景深陰影（shadow.ts）：畫每個立體層之前，先用它自己的 alpha 往右下偏移、模糊取樣，壓暗「已經合成好的、在它後面的」
// 顏色（卡身、素色卡背、後面的圖層與它們的鐳射），它自己再蓋上去，所以不會壓到自己。不用 shadow map、不加後處理。
// 只有混合模式是正常的立體層投影（shadow.ts 的 castsShadow）。
//
// 不透明度與混合模式（T-408，blend.ts 純數學、blend-nodes.ts 著色）：卡身、素色卡背、圖層（含鐳射與影子）都在
// sRGB 數值上由後往前合成（SCHEMA 的混合公式在 sRGB 數值上算；正常模式也是，半透明邊緣和 Photoshop 一樣），
// 全部圖層疊完才轉回線性，再疊卡框（卡框照舊在線性空間混）。每層（blend.ts 的 compositeColor）：
// 正常＝(1 − αs)·Cb＋αs·Cs；其他模式＝(1 − αs)·Cb＋αs·(B(夾(Cb), Cs)＋k·(Cb − 夾(Cb)))（夾＝夾在 0～1；
// 鐳射讓後面超過 1 的部分照 k 透過來：加深 k＝Cs、發光 k＝1 − Cs、其他 1，中性色才會完全不改變後面，T-413），
// αs＝alpha × 顯示 × 不透明度。模式在建材質時決定（每層只算自己那一種）；
// 非正常的層不投影、也不算「新的表面」（不重設影子、深度），鐳射只套在不是中性色的地方
// （blendHoloMask：黑底光效、白底線稿的方框不會露出來）。
//
// 圖層貼圖用預乘 alpha（T-413，layerTexture）：在線性空間乘上 alpha 再編回 sRGB 上傳（blend.ts 的 premultiplyRows），
// 縮小、斜看、mipmap 取樣時透明處的 RGB（通常是黑色）乘 0、不會混進邊緣變成暗邊，濾波仍在線性空間；
// 取樣後除回 alpha 得到直通顏色，轉成 sRGB 數值再合成。
//
// 破框層（T-411，breakout.ts）：卡片範圍內照舊在卡面 shader 裡合成；在卡框的地方再疊到卡框上面（像從框裡衝出來，
// 落在卡框上的影子也一起算）。卡片範圍外是卡面網格的子物件「卡外網格」：外框對齊格子、中間挖掉和卡面同一個輪廓
// （同一批頂點，MSAA 邊緣互補、沒有縫），只畫這一面的破框層（同一個位移、同一張貼圖，所以卡內卡外接得上），
// 不畫鐳射、卡框、其他層；半透明、不寫也不測深度、只畫正面（轉到背面看不到），接近 90° 時淡出（BREAKOUT_FADE）。
// 破框層整層不套鐳射（卡內也不套，holo.ts 的 holoTargets），卡邊兩側的顏色才接得上。
// 沒有破框層的面：卡面 shader 和以前一樣、卡外網格不顯示。
//
// 線稿高光（T-802，lineart.ts 純數學、holo-nodes.ts 的 lineWeightNode／lineGlowNode）：開了「沿線條反光」的立體層
// （不是文字層、不是破框層），照它的混合模式合成完之後，再 mix(合成好的顏色, 線條的光, 混入比例 × 顯示 × 不透明度 × 鐳射強度倍數)：
// 越黑的線條越換成流動的彩虹光，白底與淺色（混入比例 0）原封不動。只看鐳射強度、和反光層形狀無關（這層自己要的，
// 所以整面霧光時也算鐳射底稿）。線條算亮面（亮面／霧光的比例那幾成換成亮面），白底不改變下面的狀態。
// 沒有線稿高光層的面：不建任何新節點，shader 和以前一模一樣。
//
// 剪裁遮色片（T-803，model/actions.ts 的 clipParent）：剪裁中的層，cover（αs）多乘「下面那層在同一個卡面點的 alpha」：
// 下面那層用它自己的 uv 與視差取樣（剪裁層的 depth 一律等於下面那層，視差一樣，轉動時貼在一起）；只乘 alpha，
// 不乘下面那層的顯示與不透明度（下面那層隱藏時照樣剪，同 Photoshop）。反光層的比例、霧光、線稿高光、混合模式都照這層
// 自己的設定，只是 cover 多乘一個剪裁 alpha。剪裁層不投自己的景深陰影；蓋住的地方深度＝下面那層（影子落點用）。
// 下面那層的圖還沒準備好時先不畫這層（圖到了換材質）。沒有剪裁中的層的面：不建任何新節點，shader 和以前一模一樣。
//
// 雙圖光柵（T-805，lenticular.ts 純數學、lenticular-nodes.ts 著色）：有變身圖的立體層（不是文字層、不是破框層）多取樣一張貼圖：
// 同一個中心、同寬、高照變身圖自己的比例（同一個視差位移）；本來的圖和變身圖各自乘自己的範圍（超出＝透明），
// 預乘 alpha 的 texel 直接 mix(本來的, 變身圖, 混入比例)——透明處的顏色是 0，換的途中邊緣也不會有暗邊。混入比例由這一面的
// 看的方向（uViews[face]，背面照背面那一面算）和卡面原始座標 u（不跟視差，條紋貼在卡上）算，同一面的層共用一個；
// 換的途中在 sRGB 數值上乘 1 − 暗度（兩張各一半時最暗）。之後的合成、反光、線稿高光（線條強度用混好的顏色）、
// 剪裁（下面那層有變身圖時剪裁 alpha 用混好的 alpha）、景深陰影（本來的圖和變身圖的影子各取樣一次再照同一個比例混）都用混好的。
// 點選與選取框照本來的圖（pick 不看變身圖）。變身圖還沒準備好時先照沒有變身圖畫（圖到了換材質）。
// 沒有變身圖的面：不建任何新節點，shader 和以前一模一樣（tests/render-lineart-mesh.test.ts 的指紋）。
//
// 局部動態特效（T-811，fx-nodes.ts）：有 fx 的層（不是破框層），照它的混合模式合成完（線稿高光之後），在 sRGB 數值上加上
// 火焰／電光／水波的發光 × 強度 × 這層實際蓋住表面的幾成（含剪裁、雙圖光柵混好的 alpha；非正常模式再乘不是中性色的部分），
// 圖案用這層的局部座標（含視差）。種類在建材質時決定（compositionKey 含種類），顏色、強度、速度、迴圈位置都是 uniform；
// 迴圈位置由 setTime 的特效時間在 CPU 算（預覽＝影格時間、轉動匯出＝影片時間）。沒有特效的面：不建任何新節點，shader 不變。
//
// 透明卡套（T-806，sleeve.ts 數學、sleeve-nodes.ts 網格與著色）：卡片外面另一個網格（group 的第 4 個子物件），卡面 shader 完全不變。
// 第一次開卡套才建（沒開過的卡場景裡不多任何東西），關掉只藏起來；比例、圓角改了換卡套網格。透明面的順序見 sleeve.ts 的 SLEEVE_ORDER
// （遠側 → 破框層的卡外網格 → 近側）。擷取時可以暫時不畫（withoutSleeve）。
//
// CD 光碟（T-810，disc.ts 尺寸與算式、disc-nodes.ts 網格與著色；card.kind 'disc'）：網格換成印刷面圓環（卡面）＋圓環的內外側面（銀色）＋
// 透明塑膠（孔外的透明圈、最外緣的塑膠邊；第一次是光碟才建，group 最後一個子物件，不是光碟時藏起來）；厚度是卡片的 0.8 倍。
// 印刷面（正面）：圖層合成和卡片一模一樣，只是範圍是印刷面圓環（網格本身），卡框與雕花不畫、改畫內緣的細銀環（破框層照樣疊在上面）；
// 破框層的卡外網格＝印刷面外面＋透明圈（孔裡不畫）。背面（資料面）：discDataMaterial（銀色鏡面＋繞射彩虹，沒有圖層）。
// 卡套不畫（model 的 sleeveOn 對光碟一律 false）。換材質的 key 加上 kind（光碟正面「disc|」開頭、背面「disc-back」）；
// 卡片的 shader、網格完全不變（tests/render-lineart-mesh.test.ts 的指紋）。
//
// 更新分兩種（拖曳時每格都會呼叫 update，不能每次重建）：
//   - 比例、圓角改了 → 換網格；某一面的圖層組成（layer id＋圖片＋混合模式＋破框＋線稿高光＋剪裁到誰＋變身圖＋特效種類）、「哪些東西要反光」（holo.ts 的 holoTargets）
//     或卡框樣式（T-416）改了 → 換那一面的材質（含卡外網格的材質）；破框層的範圍超出卡外網格目前的外框（對齊格子）→ 換卡外網格。
//   - 其他（圖層 x／y／scale／visible／depth／不透明度、卡身色、卡框〔開關、粗細、顏色、光澤〕、鐳射強度／色帶寬度／閃星／色彩、
//     陰影濃淡距離）→ 只改 uniform；
//     觀看方向（setView）與時間（setTime）每影格也只改 uniform。

import {
  Color,
  DataTexture,
  ExtrudeGeometry,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Node,
  type UniformNode,
} from 'three/webgpu';
import {
  float,
  max,
  mix,
  normalView,
  positionLocal,
  saturate,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { BlendMode, Card, FaceSide, FxKind, Layer } from '../model/types';
import { fxGain, fxGlowNode, fxLoop, fxOn, fxRgb, type FxUniforms } from './fx-nodes';
import { blendOf, opacityFactor, premultiplyRows } from './blend';
import { blendHoloMaskNode, blendSurfaceNode, compositeNode } from './blend-nodes';
import {
  alphaMaskFromRgba,
  breakoutFade,
  contentBox,
  expandBox,
  framingReach,
  FULL_UV,
  HIT_ALPHA,
  layerLift,
  layerUv,
  MASK_EDGE,
  maskContent,
  maxOffset,
  outsideAlphaAt,
  ringBounds,
  type AlphaMask,
  type Box,
  type UvBox,
} from './breakout';
import { breakoutFadeNode, outsideLookNode } from './breakout-nodes';
import { CARD_THICKNESS, cardOutline, coverUv, DEFAULT_CARD_H, frameInner, layerSize, type RoundedRect } from './fit';
import { FRAME_ORNATE, frameShineFactor, ornateSize } from './frame';
import { frameLayer, ornateLayer } from './frame-nodes';
import { clipParent, frameStyle, sleeveOn } from '../model/actions';
import { aspectHeight, isDisc } from '../model/aspect';
import { faceFoil } from '../model/foil';
import { holoPaletteColors, holoTargets, holoUniformValues, viewDirection, type HoloTargets } from './holo';
import {
  applyHolo,
  applyHoloSrgb,
  flashStripesNode,
  FOIL_FLASH_GAIN,
  HOLO_MIX_BACKGROUND,
  HOLO_MIX_SUBJECT,
  holoGlint,
  holoSurface,
  lineFoilNode,
  lineGlowNode,
  lineWeightNode,
  maskCoverageNode,
  matteLiftNode,
  matteSheenNode,
  type HoloUniforms,
} from './holo-nodes';
import { altOn } from './lenticular';
import { lensDimNode, lensMixNode } from './lenticular-nodes';
import { lineartOn } from './lineart';
import { castsShadow, layerShadow, shadowFactors, shadowMipLevel } from './shadow';
import { createSleeveObject, type SleeveObject } from './sleeve-nodes';
import { DISC, DISC_THICKNESS, discOutline } from './disc';
import {
  createDiscPlastic,
  discBodyGeometry,
  discDataMaterial,
  discEdgeMaterial,
  discFaceGeometry,
  discRingGeometry,
  discRingLayer,
  type DiscPlastic,
} from './disc-nodes';

export type GetImage = (hash: string) => HTMLImageElement | undefined;

/** 素色卡背：在 sRGB 數值上算 卡身色 ＋ (紋樣亮度 − 0.5) × 這個倍數，再夾在 0～1（主對話 2026-10-13 定）。 */
export const PLAIN_BACK_CONTRAST = 1.5;

const CURVE_SEGMENTS = 16;
/** 除回 alpha 時分母的下限（alpha 0 的地方顏色當黑色，反正乘上 αs 0 看不到）。 */
const UNPREMULTIPLY_EPSILON = 1e-4;
const FACES: readonly FaceSide[] = ['front', 'back'];

/** 一個圖層在 shader 裡用到的 uniform；圖還沒準備好（getImage 回 undefined）時 image 是 null、不畫。 */
interface LayerSlot {
  /** 圖層 id（點選卡外的破框層時回傳）。 */
  id: string;
  image: HTMLImageElement | null;
  /** 破框層（T-411，建材質時決定：開關＝換材質）；底圖一律 false。 */
  breakout: boolean;
  /** 沿線條反光（T-802，lineart.ts 的 lineartOn；建材質時決定：開關＝換材質）。 */
  lineart: boolean;
  /** 剪裁到哪一層（T-803，clipParent：同一面 slots 的 index；建材質時決定）；不剪裁＝null。 */
  clip: number | null;
  /** 剪裁層蓋住的地方的深度（＝自己的 depth＝下面那層的，影子落點用）；不剪裁＝null（不建這個 uniform）。 */
  clipDepth: UniformNode<'float', number> | null;
  /** 圖層的 depth（卡外網格的範圍、鏡頭取景用；每次 update 更新）。 */
  depth: number;
  center: Vector2;
  size: Vector2;
  visible: UniformNode<'float', number>;
  /** 不透明度 0～1（blend.ts 的 opacityFactor；拖滑桿只改這個）。 */
  opacity: UniformNode<'float', number>;
  /** 混合模式（建材質時決定：換模式＝換材質）。 */
  blend: BlendMode;
  /** 視差位移（每影格由 setPose 傳入）。 */
  offset: Vector2;
  /** 這層套鐳射時的混色係數（底圖＝背景、立體層＝主角）；null＝不套。 */
  holoMix: number | null;
  /** 投影子用的 uniform；底圖與非正常模式的層是 null（不投影，shadow.ts 的 castsShadow）。 */
  shadow: ShadowSlot | null;
  /** 變身圖（T-805，lenticular.ts 的 altOn 而且圖準備好了；建材質時決定：加、換、拿掉＝換材質）；沒有＝null（不建任何節點）。 */
  alt: AltSlot | null;
  /** 動態特效（T-811，fx-nodes.ts 的 fxOn；種類在建材質時決定：加、拿掉、換種類＝換材質）；沒有＝null（不建任何節點）。 */
  fx: FxSlot | null;
}

/** 有特效的層多的東西（T-811）：種類（建材質時決定）、速度（setTime 算迴圈位置用）、顏色／強度／迴圈位置的 uniform（只改值）。 */
interface FxSlot extends FxUniforms {
  kind: FxKind;
  speed: number;
}

/** 有變身圖的層多的東西（T-805）：圖、卡面上的大小（同寬、高照它自己的比例）、影子的模糊等級（照它自己的像素寬）。 */
interface AltSlot {
  image: HTMLImageElement;
  size: Vector2;
  shadowLevel: UniformNode<'float', number>;
}

/** 一個立體層的影子（數值由 shadow.ts 從 depth 換算，改 depth 只改這些）。 */
interface ShadowSlot {
  /** 影子相對圖層的偏移（卡寬單位、卡面座標）。 */
  offset: Vector2;
  depth: UniformNode<'float', number>;
  /** 畫面上的影子濃度：預覽關掉景深陰影（T-809 setShadows）時是 0，否則等於 base。 */
  strength: UniformNode<'float', number>;
  /** 這層的影子該有的濃度（shadow.ts 算的值，每次 update 更新）；預覽關掉影子時 strength 是 0、擷取時暫時用它。 */
  base: number;
  /** 柔邊：四次取樣各自的模糊等級（mip level）與取樣點離中心多遠（卡寬單位）。 */
  level: UniformNode<'float', number>;
  spread: UniformNode<'float', number>;
}

/** uv 在 0～1 裡面＝1，外面＝0（取樣超出圖片範圍＝透明，不拉邊緣像素）。 */
function insideUv(uv: Node<'vec2'>): Node<'float'> {
  return step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
}

/**
 * 影子擋住多少（0～1，破框層用：卡框上、卡外網格裡）：圖層在 shadowUv 附近的 alpha，模糊過的 mip 等級、四個角各取一次平均，
 * 乘濃度、顯示、不透明度。算式同卡面 shader 裡圖層之間的影子。
 */
function shadowOcclusion(tex: Texture, shadowUv: Node<'vec2'>, size: Node<'vec2'>, slot: LayerSlot, sh: ShadowSlot): Node<'float'> {
  const spread = vec2(sh.spread, sh.spread).div(size);
  const tap = (x: number, y: number) => texture(tex, shadowUv.add(spread.mul(vec2(x, y)))).level(sh.level).a;
  return tap(-1, -1)
    .add(tap(1, -1))
    .add(tap(-1, 1))
    .add(tap(1, 1))
    .mul(0.25)
    .mul(insideUv(shadowUv))
    .mul(sh.strength)
    .mul(slot.visible)
    .mul(slot.opacity);
}

interface FaceState {
  mesh: Mesh;
  key: string | null;
  /** 材質裡有沒有雕花邊角（T-416；建材質時決定）。 */
  ornate: boolean;
  slots: LayerSlot[];
  /** 反光層的黑白圖（T-417，形狀是「上傳黑白圖」而且圖準備好了）；cover 貼滿卡面的縮放與位移每次 update 更新。 */
  mask: HTMLImageElement | null;
  maskScale: Vector2;
  maskOffset: Vector2;
  /** 選中反光層時的斜線強度 0～1（setFlash）。 */
  flash: UniformNode<'float', number>;
  /** 卡外網格（T-411，卡面網格的子物件）：這一面沒有破框層時不顯示。 */
  ring: Mesh;
  /** 卡外網格目前的外框＋輪廓（變了才換網格）。 */
  ringKey: string | null;
}

/** 卡面上的方框（看著那一面），pick.ts 的 FaceBox。 */
export interface BreakoutBox {
  face: FaceSide;
  box: Box;
}

export interface CardObject {
  group: Group;
  /** 目前的卡片輪廓（卡寬單位）。 */
  outline(): RoundedRect;
  /** 每層一個位移 uniform（卡寬單位、看著該面的 +x 右 +y 上），順序同該面的 layers 陣列。 */
  offsets(face: FaceSide): Vector2[];
  update(card: Card, getImage: GetImage): void;
  /**
   * 這一面顯示中的破框層，內容範圍（alpha 外框）在卡面上的方框。offsets＝每層的位移（順序同 layers）；
   * 省略＝目前的位移。擷取的裁切用（pick.ts 的 FaceBox）。
   */
  breakoutBoxes(face: FaceSide, offsets?: readonly { x: number; y: number }[]): BreakoutBox[];
  /** 卡面座標 (x, y)（看著那一面）上，由前往後第一個「這一點不透明」的破框層 id；沒有回 null。不管點在不在卡內。 */
  breakoutAt(face: FaceSide, x: number, y: number): string | null;
  /** 鏡頭取景要多放得下的範圍（breakout.ts 的 framingReach）；沒有破框層回 null。最近一次 update 的值。 */
  reach(): { x: number; y: number } | null;
  /** 卡片目前的角度（同 setPose）→ 兩面各自的觀看方向（鐳射隨角度流動）。 */
  setView(yawDeg: number, pitchDeg: number): void;
  /**
   * 畫面時間（秒），給閃星閃爍；fxSeconds＝動態特效的時間（T-811，省略＝同 seconds）：預覽兩個一樣，
   * 轉動匯出時閃星照效果時間、特效照影片時間（第幾格 × 每格秒數，特效的週期整除 4 秒，影片頭尾才接得上）。
   */
  setTime(seconds: number, fxSeconds?: number): void;
  /** 選中反光層時，這一面亮面的地方的斜線強度 0～1（T-417；holo.ts 的 foilFlashLevel）。0＝沒有，畫面和沒這功能時一樣。 */
  setFlash(face: FaceSide, level: number): void;
  /** 透明卡套（T-806）：最近一次 update 的卡片開著卡套嗎。 */
  sleeve(): boolean;
  /** 畫 draw 的那一下不畫卡套（擷取選了不包含卡套、縮圖），畫完（丟錯也一樣）立刻恢復；沒開卡套就直接 draw。 */
  withoutSleeve(draw: () => void): void;
  /**
   * 預覽要不要畫景深陰影（T-809 效能自動降級）：false＝每層影子濃度的 uniform 設成 0（只改 uniform，不換材質、節點圖不變）；
   * 之後 update 也維持 0，重建材質後新的層也是。預設 true。
   */
  setShadows(on: boolean): void;
  /** 畫 draw 的那一下一律畫完整景深陰影（擷取：PNG、縮圖、轉動匯出），畫完（丟錯也一樣）立刻放回預覽的設定；預覽開著就直接 draw。 */
  withFullShadows(draw: () => void): void;
}

function roundedRect({ halfW, halfH, r }: RoundedRect): Shape {
  const s = new Shape();
  s.moveTo(-halfW + r, -halfH);
  s.lineTo(halfW - r, -halfH);
  if (r > 0) s.absarc(halfW - r, -halfH + r, r, -Math.PI / 2, 0, false);
  s.lineTo(halfW, halfH - r);
  if (r > 0) s.absarc(halfW - r, halfH - r, r, 0, Math.PI / 2, false);
  s.lineTo(-halfW + r, halfH);
  if (r > 0) s.absarc(-halfW + r, halfH - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-halfW, -halfH + r);
  if (r > 0) s.absarc(-halfW + r, -halfH + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** 卡外網格（T-411）：對齊格子的外框，中間挖掉卡片輪廓（和卡面同一個 roundedRect、同樣的分段 → 同一批頂點）。 */
function ringGeometry(outline: RoundedRect, b: Box): ShapeGeometry {
  const s = new Shape();
  s.moveTo(b.left, b.bottom);
  s.lineTo(b.right, b.bottom);
  s.lineTo(b.right, b.top);
  s.lineTo(b.left, b.top);
  s.lineTo(b.left, b.bottom);
  s.holes.push(roundedRect(outline));
  return new ShapeGeometry(s, CURVE_SEGMENTS);
}

/** 圖的 alpha 遮罩（縮到長邊 MASK_EDGE）與內容範圍；沒有 DOM（node 測試）或讀不出來＝null。 */
interface ImageMask {
  mask: AlphaMask;
  /** alpha 外框（圖片 uv）；整張透明＝null。 */
  content: UvBox | null;
}

const imageMasks = new WeakMap<HTMLImageElement, ImageMask | null>();

/** 只在第一次用到破框層的圖時讀一次（縮小後的 alpha），之後記住。 */
function maskOf(image: HTMLImageElement): ImageMask | null {
  if (imageMasks.has(image)) return imageMasks.get(image) ?? null;
  let result: ImageMask | null = null;
  try {
    if (typeof document !== 'undefined') {
      const scale = Math.min(1, MASK_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const w = Math.max(1, Math.round(image.naturalWidth * scale));
      const h = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(image, 0, 0, w, h);
        const mask = alphaMaskFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
        result = { mask, content: maskContent(mask) };
      }
    }
  } catch {
    result = null;
  }
  imageMasks.set(image, result);
  return result;
}

/** 圖的內容範圍（圖片 uv）：讀不到遮罩就當整張；整張透明＝null。 */
function contentOf(image: HTMLImageElement): UvBox | null {
  const m = maskOf(image);
  return m ? m.content : FULL_UV;
}

/** 讀出圖片的像素（直通 alpha、由上到下）。 */
function readPixels(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('無法建立 2D 畫布');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * 圖層的貼圖（見檔頭）：sRGB 格式、預乘 alpha、自動 mipmap。像素在第一次上傳（three.js 讀 image.data）時才讀出來算，
 * 上傳完就放掉（要重新上傳時再算一次），不會在記憶體裡多留一份；node 測試沒有 GPU，不會讀。
 */
function layerTexture(image: HTMLImageElement, anisotropy: number): DataTexture {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  let data: Uint8Array | null = null;
  const tex = new DataTexture(null, width, height);
  tex.image = {
    width,
    height,
    get data() {
      return (data ??= premultiplyRows(readPixels(image), width, height));
    },
  };
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.onUpdate = () => {
    data = null;
  };
  tex.needsUpdate = true;
  return tex;
}

/** 這層要不要畫成破框層（T-411）：只有立體層、而且明寫 true。 */
function isBreakout(layer: Layer): boolean {
  return layer.role === 'depth' && layer.breakout === true;
}

/** 剪裁到哪一層（T-803）：同 model 的 clipParent（剪裁不成立＝null）。 */
function clipOf(card: Card, face: FaceSide, index: number): number | null {
  return clipParent(card[face], index);
}

/** 這層要畫的變身圖（T-805）：altOn 而且圖準備好了；沒有＝null。 */
function altImageOf(layer: Layer, getImage: GetImage): HTMLImageElement | null {
  return altOn(layer) && layer.alt ? (getImage(layer.alt.image) ?? null) : null;
}

/**
 * 圖層組成（layer id＋圖片＋圖準備好了沒＋混合模式＋破框＋線稿高光＋剪裁到誰＋變身圖〔T-805〕）＋哪些東西要反光（含黑白圖、有沒有霧光）＋
 * 要不要畫雕花邊角（T-416）。這串字變了才換材質。
 */
function compositionKey(card: Card, face: FaceSide, getImage: GetImage, holo: HoloTargets, ornate: boolean): string {
  // CD 光碟（T-810）：背面是資料面（不看圖層）；正面照卡片的 key、前面加 disc|（換種類就換材質）
  if (isDisc(card)) return face === 'back' ? 'disc-back' : `disc|${cardKey(card, face, getImage, holo, ornate)}`;
  return cardKey(card, face, getImage, holo, ornate);
}

function cardKey(card: Card, face: FaceSide, getImage: GetImage, holo: HoloTargets, ornate: boolean): string {
  const layers = card[face].layers.map((l, i) => {
    const clip = clipOf(card, face, i);
    const alt = altOn(l) && l.alt ? `|a${l.alt.image}|${getImage(l.alt.image) ? 1 : 0}` : '';
    // 動態特效（T-811）：只有種類要換材質（顏色、強度、速度是 uniform）
    const fx = fxOn(l) && l.fx ? `|f${l.fx.kind}` : '';
    return `${l.id}|${l.image}|${getImage(l.image) ? 1 : 0}|${holo.layers[i] ? 1 : 0}|${blendOf(l)}|${isBreakout(l) ? 1 : 0}${lineartOn(l) ? '|l' : ''}${clip !== null ? `|c${clip}` : ''}${alt}${fx}`;
  });
  return `${layers.join(',')}#${holo.body ? 1 : 0}${holo.frame ? 1 : 0}|${holo.mask ?? ''}|${holo.matte ? 1 : 0}|${ornate ? 'o' : ''}`;
}

/**
 * update 用的反光目標：卡框照「卡框也反光」（光碟沒有卡框＝不反光）、不看卡框開關（開關卡框只改 uFrameOn、不換材質，卡框關著時圓環乘 0，
 * 結果和 holoTargets 的「卡框關著＝不套」一樣）；黑白圖還沒準備好時先當「整面」畫（圖到了 key 會變、換材質）。
 */
function meshTargets(card: Card, face: FaceSide, getImage: GetImage): HoloTargets {
  // CD 光碟（T-810）沒有卡框：卡框不反光（不建卡框用的鐳射底稿）
  const targets = { ...holoTargets(card, face), frame: faceFoil(card[face]).frame && !isDisc(card) };
  if (targets.mask !== null && !getImage(targets.mask)) return { ...targets, mask: null, matte: false };
  return targets;
}

/**
 * plainBack：素色卡背紋樣；anisotropy：貼圖的各向異性取樣；
 * frameCorner：雕花邊角的灰階浮雕素材（左上角一張，T-416）；讀不到＝null，雕花邊角的卡畫成簡約（T-416b）。
 */
export function createCardObject(plainBack: HTMLImageElement, anisotropy: number, frameCorner: HTMLImageElement | null): CardObject {
  // 兩面共用的 uniform
  const bodyColor = new Color();
  const uBody = uniform(bodyColor);
  const faceSize = new Vector2(1, 1);
  const plainScale = new Vector2(1, 1);
  const plainOffset = new Vector2(0, 0);
  const frameHalf = new Vector2(0.5, 0.5);
  const uFrameRadius = uniform(0);
  // 卡框外緣＝卡片輪廓（金屬斜面要知道點在框寬的哪裡）
  const outerHalf = new Vector2(0.5, 0.5);
  const uOuterRadius = uniform(0);
  const uFrameOn = uniform(0);
  const frameColor = new Color();
  const uFrameColor = uniform(frameColor);
  const uFrameShine = uniform(1);
  // 雕花邊角（T-416）：花紋邊長（跟著框寬）；素材貼圖第一次用到時才建（同圖層的預乘貼圖），沒有一面用到時收掉
  const uOrnateSize = uniform(FRAME_ORNATE.size as number);
  let cornerTexture: DataTexture | null = null;
  /** 這張卡要不要畫雕花邊角：樣式是雕花而且素材在（開關卡框只改 uFrameOn、不換材質，所以不看 enabled）；光碟不畫（T-810）。 */
  const ornateOn = (card: Card): boolean => frameCorner !== null && frameStyle(card.frame) === 'ornate' && !isDisc(card);
  const cornerTextureFor = (corner: HTMLImageElement): DataTexture => (cornerTexture ??= layerTexture(corner, anisotropy));

  // 鐳射：強度／色帶寬度／閃星／色彩（拖滑桿、選色彩時改）、時間（每影格）、兩面各自的觀看方向（每影格）
  const paletteColors = [new Vector3(), new Vector3(), new Vector3(), new Vector3()] as const;
  const holo: HoloUniforms = {
    foil: uniform(0),
    freq: uniform(1),
    sparkleCut: uniform(1),
    time: uniform(0),
    matte: uniform(0),
    palette: [uniform(paletteColors[0]), uniform(paletteColors[1]), uniform(paletteColors[2]), uniform(paletteColors[3])],
  };
  const views: Record<FaceSide, Vector3> = { front: new Vector3(0, 0, 1), back: new Vector3(0, 0, -1) };
  const uViews = { front: uniform(views.front), back: uniform(views.back) };

  // 素色卡背紋樣：當原始數值讀（不轉線性），shader 裡直接在 sRGB 數值上算
  const plainTexture = new Texture(plainBack);
  plainTexture.anisotropy = anisotropy;
  plainTexture.needsUpdate = true;

  const textures = new Map<HTMLImageElement, Texture>();
  const textureFor = (image: HTMLImageElement): Texture => {
    let tex = textures.get(image);
    if (!tex) {
      tex = layerTexture(image, anisotropy);
      textures.set(image, tex);
    }
    return tex;
  };
  // 反光層的黑白圖（T-417）：當原始數值讀（不轉線性、不預乘），亮度就是 sRGB 數值的亮度（中間灰＝一半）
  const maskTextures = new Map<HTMLImageElement, Texture>();
  const maskTextureFor = (image: HTMLImageElement): Texture => {
    let tex = maskTextures.get(image);
    if (!tex) {
      tex = new Texture(image);
      tex.anisotropy = anisotropy;
      tex.needsUpdate = true;
      maskTextures.set(image, tex);
    }
    return tex;
  };

  /** disc＝CD 光碟的印刷面（T-810）：卡框與雕花換成內緣的細銀環，其他和卡片一模一樣。 */
  const buildMaterial = (face: FaceSide, slots: LayerSlot[], targets: HoloTargets, ornate: boolean, disc = false): MeshBasicNodeMaterial => {
    // 卡面網格的本地座標就是「看著這一面」的卡面座標（卡寬單位、中心為 0）
    const p = positionLocal.xy;
    /** 卡寬單位的點換成原作 uv 的方向（往右 x 增加、往下 y 增加）。 */
    const downward = (q: Node<'vec2'>) => vec2(q.x, q.y.negate());
    const surfaceAt = downward(p).add(0.5); // 卡片中心＝(0.5, 0.5)，同原作

    // 線稿高光（T-802）也要鐳射底稿（彩虹色、光帶），不管反光層的形狀
    const needHolo = targets.body || targets.frame || slots.some((s) => s.image && (s.holoMix !== null || s.lineart));
    const surface = needHolo ? holoSurface(surfaceAt, uViews[face], holo) : null;
    // 卡身與卡框的閃星都用卡面座標：算一次共用（卡框關著時這段也還在 shader 裡，共用才不會多花一次閃星的計算）
    const faceGlint = surface && (targets.body || targets.frame) ? holoGlint(surfaceAt, surface, holo) : null;

    // 反光層的黑白圖（T-417）：卡面座標 cover 貼滿、置中、不跟視差；這一點的反光程度＝亮度 × alpha。沒有＝null（不乘）
    const state = faces[face];
    let maskLum: Node<'float'> | null = null;
    if (targets.mask !== null && state.mask) {
      const maskUv = p.div(uniform(faceSize)).add(0.5).mul(uniform(state.maskScale)).add(uniform(state.maskOffset));
      const m = texture(maskTextureFor(state.mask), maskUv);
      maskLum = maskCoverageNode(m.rgb, m.a);
    }
    // 由後往前合成時，這一點最上面的表面有幾成是亮面（foil，斜線用）、幾成是霧光（matte，整面以外才有）

    // 卡身與圖層在 sRGB 數值上合成（見檔頭），圖層疊完才轉回線性
    let srgb = sRGBTransferOETF(uBody.rgb) as Node<'vec3'>;
    if (face === 'back' && slots.length === 0) {
      // 素色卡背：紋樣 cover 貼滿卡面，在 sRGB 數值上加到卡身色（輸出時 three.js 會轉回 sRGB，螢幕上＝公式的值）
      const faceUv = p.div(uniform(faceSize)).add(0.5);
      const pattern = texture(plainTexture, faceUv.mul(uniform(plainScale)).add(uniform(plainOffset))).r;
      srgb = saturate(srgb.add(pattern.sub(0.5).mul(PLAIN_BACK_CONTRAST))) as Node<'vec3'>;
    }
    // 沒有底圖時看得到的卡身（含素色卡背）當背景套；黑白圖的地方乘它的亮度
    if (surface && faceGlint && targets.body) {
      const shiny = applyHoloSrgb(srgb, surface, holo, HOLO_MIX_BACKGROUND, faceGlint);
      srgb = maskLum ? (mix(srgb, shiny, maskLum) as Node<'vec3'>) : shiny;
    }
    let foilCover: Node<'float'> = maskLum ?? float(targets.body ? 1 : 0);
    let matteCover: Node<'float'> = float(1).sub(foilCover);

    // 景深陰影：由後往前合成時，每一點記著「目前最上面那一層的 depth」（behind）和「目前的表面已經被影子壓暗幾成」（shade）
    let behind: Node<'float'> = float(0);
    let shade: Node<'float'> = float(0);
    // 破框層（T-411）：疊完卡框之後，在卡框的地方再疊一次（顏色、蓋多少、落在卡框上的影子；破框層不套鐳射）
    const overFrame: { blend: BlendMode; color: Node<'vec3'>; cover: Node<'float'>; shadow: Node<'float'> | null }[] = [];
    // 剪裁（T-803）：被剪裁到的層，記下它在每個卡面點的 alpha（用它自己的 uv 與視差）；沒有剪裁中的層時這兩個都是空的
    const clipTargets = new Set(slots.flatMap((s) => (s.clip !== null ? [s.clip] : [])));
    const clipAlpha = new Map<number, Node<'float'>>();
    // 雙圖光柵（T-805）：這一面有變身圖的層共用同一個混入比例（第一次用到才建；沒有變身圖的面不建）
    let lens: Node<'float'> | null = null;
    const lensMix = (): Node<'float'> => (lens ??= lensMixNode(uViews[face], surfaceAt.x));

    for (const [slotIndex, slot] of slots.entries()) {
      if (!slot.image) continue;
      // 剪裁中的層：下面那層的圖還沒準備好就先不畫（圖到了 compositionKey 會變、換材質）
      const clipA = slot.clip !== null ? clipAlpha.get(slot.clip) : undefined;
      if (slot.clip !== null && !clipA) continue;
      const tex = textureFor(slot.image);
      const center = uniform(slot.center);
      const offset = uniform(slot.offset);
      const size = uniform(slot.size);
      // 圖層中心在 center、再往 offset 移 → 卡面上這一點取的是圖層的 (卡面位置 − center − offset)
      const local = p.sub(center).sub(offset);
      const layerUv = local.div(size).add(0.5);
      // 雙圖光柵（T-805）：變身圖同一個中心、同寬（高照它自己的比例）；兩張各自乘自己的範圍，預乘 alpha 的 texel 直接照混入比例混
      const alt = slot.alt;
      const altSize = alt ? uniform(alt.size) : null;
      const altUv = altSize ? local.div(altSize).add(0.5) : null;
      const lensT = alt ? lensMix() : null;
      const texel: Node<'vec4'> =
        alt && altUv && lensT
          ? (mix(texture(tex, layerUv).mul(insideUv(layerUv)), texture(textureFor(alt.image), altUv).mul(insideUv(altUv)), lensT) as Node<'vec4'>)
          : (texture(tex, layerUv) as unknown as Node<'vec4'>);
      /** 這一點的 alpha（超出圖片範圍＝透明）：有變身圖時兩張已經各自乘過範圍；沒有時每次呼叫建新節點（和以前一模一樣）。 */
      const alphaOf = (): Node<'float'> => (lensT ? texel.a : texel.a.mul(insideUv(layerUv)));
      // 取樣得到預乘 alpha 的線性值：除回 alpha＝這一點的直通顏色（alpha 加權平均，透明處不算），轉回 sRGB 數值再合成
      const straight = texel.rgb.div(max(texel.a, UNPREMULTIPLY_EPSILON));
      let own = saturate(sRGBTransferOETF(straight) as Node<'vec3'>) as Node<'vec3'>;
      // 換的途中稍微變暗（兩張各一半時最暗，模擬光柵片的亮度下降）
      if (lensT) own = own.mul(float(1).sub(lensDimNode(lensT))) as Node<'vec3'>;
      // 鐳射先套在這層的顏色上，再用這層的 alpha 疊上去：反光只出現在這層看得到的地方；
      // 閃星用這層自己的座標，所以跟著圖層走。加深／發光／強光：中性色（白／黑）的地方不反光（blendHoloMask）
      let color = own;
      const neutral = blendHoloMaskNode(slot.blend, own);
      if (surface && slot.holoMix !== null) {
        const shiny = applyHoloSrgb(own, surface, holo, slot.holoMix, holoGlint(downward(local), surface, holo));
        // 黑白圖（T-417）：亮面再乘它的亮度
        const k = neutral && maskLum ? neutral.mul(maskLum) : (neutral ?? maskLum);
        color = k ? (mix(own, shiny, k) as Node<'vec3'>) : shiny;
      }
      // αs＝alpha × 顯示 × 不透明度（剪裁中的層再乘下面那層的 alpha，T-803；有變身圖時是混好的 alpha，剪裁到它的層也用這個）
      const ownAlpha = alphaOf();
      if (clipTargets.has(slotIndex)) clipAlpha.set(slotIndex, ownAlpha);
      const cover = (clipA ? ownAlpha.mul(clipA) : ownAlpha).mul(slot.visible).mul(slot.opacity);
      // 反光層的比例跟著這層更新（holo.ts 的 coverStep）：這層實際蓋住表面的幾成（blend.ts 的 surfaceWeight：
      // 中性色——白的加深、黑的發光、50% 灰的疊色／柔光——疊上去顏色不變，也不算蓋住，T-417b）換成這層的亮面／霧光比例；
      // 破框層兩種都不是（T-411）
      const layerSurface = blendSurfaceNode(slot.blend, own);
      const surfaceCover = layerSurface ? cover.mul(layerSurface) : cover;
      const layerFoil = slot.holoMix !== null && !slot.breakout ? (maskLum ?? float(1)) : float(0);
      foilCover = mix(foilCover, layerFoil, surfaceCover);
      if (targets.matte) matteCover = mix(matteCover, slot.breakout ? float(0) : float(1).sub(layerFoil), surfaceCover);
      // 線稿高光（T-802）：線條那幾成換成亮面（白底的混入比例 0，不改）；沒開的層不建這段。
      // 算亮面的比例和換成光的比例一樣，都乘鐳射強度的倍數：強度 0 時線條不亮、也不算亮面（選中反光層的斜線不出現在線上，T-802b）
      const lineAlpha = slot.lineart && surface ? alphaOf() : null;
      // 剪裁中的層：先算線條的混入比例、再乘剪裁 alpha（高光照剪裁等比例變淡；不放進 smoothstep 裡，T-803 審查）
      const lineMix = lineAlpha ? lineWeightNode(own, lineAlpha) : null;
      const line = lineMix ? (clipA ? lineMix.mul(clipA) : lineMix).mul(slot.visible).mul(slot.opacity) : null;
      const lineShine = line ? line.mul(lineFoilNode(holo)) : null;
      if (line && lineShine) {
        foilCover = mix(foilCover, float(1), lineShine);
        if (targets.matte) matteCover = mix(matteCover, float(0), line);
      }

      const sh = slot.shadow;
      if (slot.breakout) {
        // 卡框在卡面上（深度 0）：落在卡框上的影子＝影子偏移整段（同底圖上的影子）
        const onFrame = sh ? shadowOcclusion(tex, p.sub(center).sub(uniform(sh.offset)).div(size).add(0.5), size, slot, sh) : null;
        overFrame.push({ blend: slot.blend, color, cover, shadow: onFrame });
      }
      if (sh) {
        // 影子落在「這一點後面那一層」的平面上。影子偏移（shadow.ts）和視差（interact/parallax.ts）都和 depth 成正比，
        // 所以在深度 behind 的平面上，這一點的影子來自圖層上 (卡面位置 − center − mix(影子偏移, 這層的視差, behind/depth))：
        // 後面是底圖（behind 0）→ 影子貼在底圖上、不跟這層的視差走（轉動時圖層和影子錯開，看得出浮起來）；
        // 後面的層越接近這一層，深度差越小、影子越貼近這一層。
        const along = mix(uniform(sh.offset), offset, saturate(behind.div(sh.depth)));
        const shadowUv = p.sub(center).sub(along).div(size).add(0.5);
        // 柔邊：模糊過的 mip 等級、在四個角各取一次平均
        const spread = vec2(sh.spread, sh.spread).div(size);
        const tap = (x: number, y: number) => texture(tex, shadowUv.add(spread.mul(vec2(x, y)))).level(sh.level).a;
        let occlusion: Node<'float'> = tap(-1, -1).add(tap(1, -1)).add(tap(-1, 1)).add(tap(1, 1)).mul(0.25).mul(insideUv(shadowUv));
        if (alt && altSize && lensT) {
          // 變身圖的影子（T-805）：同一個偏移、照它自己的大小與模糊等級取樣，再照同一個混入比例混（影子跟著換）
          const altTex = textureFor(alt.image);
          const altShadowUv = p.sub(center).sub(along).div(altSize).add(0.5);
          const altSpread = vec2(sh.spread, sh.spread).div(altSize);
          const altTap = (x: number, y: number) => texture(altTex, altShadowUv.add(altSpread.mul(vec2(x, y)))).level(alt.shadowLevel).a;
          const altOcclusion = altTap(-1, -1).add(altTap(1, -1)).add(altTap(-1, 1)).add(altTap(1, 1)).mul(0.25).mul(insideUv(altShadowUv));
          occlusion = mix(occlusion, altOcclusion, lensT);
        }
        // 同一道光：被好幾層擋住也只壓暗一次（取最濃的），疊再多層也不會變黑塊；半透明的層影子也跟著淡
        const dark = max(shade, occlusion.mul(sh.strength).mul(slot.visible).mul(slot.opacity));
        // 濃度是螢幕上的顏色數值要壓暗幾成：在 sRGB 數值上乘 (1 − 濃度)；已經被壓暗 shade 的地方只再補到 dark
        srgb = srgb.mul(float(1).sub(dark).div(float(1).sub(shade)));
        shade = dark;
      }

      srgb = compositeNode(slot.blend, srgb, color, cover);
      // 線稿高光（T-802）：照混合模式合成完，再把線條換成流動的彩虹光（鐳射強度 0 時乘 0，原封不動）
      if (lineShine && surface) srgb = mix(srgb, lineGlowNode(surface), lineShine) as Node<'vec3'>;
      // 動態特效（T-811）：照混合模式合成完，在這層蓋住的地方加上發光（sRGB 數值相加；強度 0 時加 0）。範圍＝這層實際蓋住表面的幾成
      // （cover：alpha × 顯示 × 不透明度，含剪裁、雙圖光柵混好的 alpha；加深／發光等模式再乘不是中性色的部分，白底、黑底不發光）。
      // 圖案用這層的局部座標（含視差），跟著這層走。沒開的層不建這段
      if (slot.fx) {
        const glow = fxGlowNode(slot.fx.kind, { local, size, loop: slot.fx.loop, color: slot.fx.color });
        srgb = srgb.add(glow.mul(slot.fx.gain).mul(surfaceCover)) as Node<'vec3'>;
      }
      if (slot.blend === 'normal') {
        // 這層蓋住的地方是新的表面：還沒被影子壓暗、深度＝這一層。
        // 非正常模式的層是疊在後面表面上的光或墨，不算新的表面（不然沒有透明的整張圖會把影子切出一個方框）
        shade = shade.mul(float(1).sub(cover));
        behind = mix(behind, sh ? sh.depth : (slot.clipDepth ?? float(0)), cover);
      }
    }

    // 霧光（T-417）：反光層沒蓋到的地方加一條白色的寬光帶（整面時沒有這段）
    const sheen = matteSheenNode(surfaceAt, uViews[face]);
    if (targets.matte) srgb = srgb.add(matteLiftNode(holo, sheen).mul(matteCover)) as Node<'vec3'>;
    // 選中反光層時亮面的地方閃一下斜線（強度 0 時加 0，畫面不變）
    const stripes = flashStripesNode(p, holo.time).mul(state.flash).mul(FOIL_FLASH_GAIN);
    srgb = srgb.add(stripes.mul(foilCover)) as Node<'vec3'>;

    // 圖層疊完：轉回線性，卡框照舊在線性空間疊
    let rgb = sRGBTransferEOTF(srgb) as Node<'vec3'>;

    if (disc) {
      // CD 光碟（T-810）：印刷面內緣的細銀環（像卡框一樣疊在圖層上面）；破框層落在銀環上的影子、再由後往前疊破框層（同卡框的算式）
      const ring = discRingLayer(p, uViews[face]);
      let ringRgb = ring.color;
      if (overFrame.length > 0) {
        let dark: Node<'float'> | null = null;
        for (const b of overFrame) if (b.shadow) dark = dark ? max(dark, b.shadow) : b.shadow;
        let top = sRGBTransferOETF(ringRgb) as Node<'vec3'>;
        if (dark) top = top.mul(float(1).sub(dark));
        for (const b of overFrame) top = compositeNode(b.blend, top, b.color, b.cover);
        ringRgb = sRGBTransferEOTF(top) as Node<'vec3'>;
      }
      const discMaterial = new MeshBasicNodeMaterial();
      discMaterial.colorNode = mix(rgb, ringRgb, ring.cover);
      return discMaterial;
    }

    // 卡框：卡面最上層的一圈圓角環（外緣＝網格輪廓，內緣＝圓角矩形，距離公式同 fit.ts 的 roundedRectSdf）；
    // 金屬質感（斜面、內緣暗線、隨視角流動的高光、拉絲紋）是框本身的，「卡框也反光」時鐳射再疊上去
    const frame = frameLayer(
      p,
      { innerHalf: uniform(frameHalf), innerRadius: uFrameRadius, outerHalf: uniform(outerHalf), outerRadius: uOuterRadius },
      uFrameColor.rgb,
      uViews[face],
      uFrameShine,
    );
    // 卡框也反光：亮面鐳射＋選中時的斜線；不反光：霧光（同一條光帶，T-417）。雕花邊角算卡框的一部分，用同一種
    const finish = (metal: Node<'vec3'>): Node<'vec3'> =>
      surface && faceGlint && targets.frame
        ? (applyHolo(metal, surface, holo, HOLO_MIX_BACKGROUND, faceGlint).add(stripes) as Node<'vec3'>)
        : targets.frame
          ? metal
          : (sRGBTransferEOTF((sRGBTransferOETF(metal) as Node<'vec3'>).add(matteLiftNode(holo, sheen))) as Node<'vec3'>);
    // 破框層落在卡框（和雕花）上的影子：同一道光，好幾層取最濃的
    let dark: Node<'float'> | null = null;
    for (const b of overFrame) if (b.shadow) dark = dark ? max(dark, b.shadow) : b.shadow;
    let frameRgb = finish(frame.color);
    if (overFrame.length > 0) {
      // T-411d：同 frame-breakout.ts 的 CPU 公式 mix(L, EOTF(overFrame(OETF(F) × (1 − dark))), c)。
      // 先在卡框表面壓影子、用完整 cover 由後往前疊破框層（sRGB），最後只混一次卡框覆蓋率（線性）。
      // 沒有破框層時不建立新節點，保留原本 mix(L, finish(frame.color), c) 的路徑。
      let top = sRGBTransferOETF(frameRgb) as Node<'vec3'>;
      if (dark) top = top.mul(float(1).sub(dark));
      for (const b of overFrame) top = compositeNode(b.blend, top, b.color, b.cover);
      frameRgb = sRGBTransferEOTF(top) as Node<'vec3'>;
    }
    rgb = mix(rgb, frameRgb, frame.cover.mul(uFrameOn));

    if (ornate && frameCorner) {
      // 雕花邊角（T-416）：四角的花紋蓋在卡框與圖層上面，卡框關著時沒有。
      // 花紋的反鋸齒邊很多（細花紋縮小後大半是半蓋住的像素），所以照「這個像素有幾成是花紋表面」來混：
      // 花紋表面那幾成＝花紋顏色（壓上破框層的影子）再由後往前疊破框層（各自完整的 cover），其他幾成＝原本的顏色。
      // 破框層不透明的地方整個蓋住花紋（不會在邊緣透出一圈花紋）；花紋外面完全不變
      const orn = ornateLayer(p, { outerHalf: uniform(outerHalf), size: uOrnateSize }, cornerTextureFor(frameCorner), uFrameColor.rgb, uViews[face], uFrameShine);
      let ornRgb = finish(orn.color);
      if (overFrame.length > 0) {
        let surf = sRGBTransferOETF(ornRgb) as Node<'vec3'>;
        if (dark) surf = surf.mul(float(1).sub(dark));
        for (const b of overFrame) surf = compositeNode(b.blend, surf, b.color, b.cover);
        ornRgb = sRGBTransferEOTF(surf) as Node<'vec3'>;
      }
      rgb = mix(rgb, ornRgb, orn.cover.mul(uFrameOn));
    }

    const material = new MeshBasicNodeMaterial();
    material.colorNode = rgb;
    return material;
  };

  /**
   * 卡外網格的材質（T-411）：只畫這一面的破框層，取樣和卡面 shader 一模一樣（同一張貼圖、同一個 uv 算式）；
   * 由後往前疊（outsideLook：卡外沒有後面的顏色可以混），輸出直通顏色＋alpha（一般的半透明混色），接近 90° 時淡出。
   * 景深陰影（T-411c）：和卡面 shader 同一套（影子落在後面那一層的平面上、同一道光取最濃的），只是卡外後面只有破框層，
   * 所以影子只壓暗已經疊好的破框層顏色（premul 乘倍數、alpha 不變），沒有東西的地方不會冒出影子。
   * 這一面沒有破框層（或圖還沒好）＝null。
   */
  const buildRing = (face: FaceSide, slots: LayerSlot[]): MeshBasicNodeMaterial | null => {
    const items = slots.filter((s) => s.image && s.breakout);
    if (items.length === 0) return null;
    const p = positionLocal.xy;
    let premul: Node<'vec3'> = vec3(0, 0, 0);
    let alpha: Node<'float'> = float(0);
    let behind: Node<'float'> = float(0);
    let shade: Node<'float'> = float(0);
    for (const slot of items) {
      const tex = textureFor(slot.image!);
      const center = uniform(slot.center);
      const offset = uniform(slot.offset);
      const size = uniform(slot.size);
      const layerUv = p.sub(center).sub(offset).div(size).add(0.5);
      const texel = texture(tex, layerUv);
      const straight = texel.rgb.div(max(texel.a, UNPREMULTIPLY_EPSILON));
      const own = saturate(sRGBTransferOETF(straight) as Node<'vec3'>) as Node<'vec3'>;
      const look = outsideLookNode(slot.blend, own, texel.a.mul(insideUv(layerUv)).mul(slot.visible).mul(slot.opacity));
      const sh = slot.shadow;
      if (sh) {
        const along = mix(uniform(sh.offset), offset, saturate(behind.div(sh.depth)));
        const dark = max(shade, shadowOcclusion(tex, p.sub(center).sub(along).div(size).add(0.5), size, slot, sh));
        premul = premul.mul(float(1).sub(dark).div(float(1).sub(shade))) as Node<'vec3'>;
        shade = dark;
      }
      premul = look.color.mul(look.alpha).add(premul.mul(float(1).sub(look.alpha))) as Node<'vec3'>;
      alpha = look.alpha.add(alpha.mul(float(1).sub(look.alpha)));
      if (slot.blend === 'normal') {
        // 同卡面 shader：蓋住的地方是新的表面（還沒被影子壓暗、深度＝這一層）
        shade = shade.mul(float(1).sub(look.alpha));
        behind = mix(behind, sh ? sh.depth : float(0), look.alpha);
      }
    }
    const straightOut = saturate(premul.div(max(alpha, UNPREMULTIPLY_EPSILON))) as Node<'vec3'>;
    const material = new MeshBasicNodeMaterial();
    material.colorNode = vec4(sRGBTransferEOTF(straightOut) as Node<'vec3'>, alpha.mul(breakoutFadeNode(uViews[face].z)));
    material.transparent = true;
    // 不寫也不測深度：這一面朝鏡頭時，卡片沒有任何東西在這個平面前面（卡身都在它後面），
    // 測深度反而會在卡片邊緣和卡身側邊搶（側邊的上緣和這片的洞同一條線），露出一點側邊的顏色
    material.depthWrite = false;
    material.depthTest = false;
    return material;
  };

  // 卡身：ExtrudeGeometry 的群組 0 是上下蓋、1 是側邊；蓋子不畫（由卡面網格蓋住），只畫側邊
  const hiddenCaps = new MeshBasicNodeMaterial();
  hiddenCaps.visible = false;
  const sides = new MeshBasicNodeMaterial();
  // 側邊依朝向鏡頭的程度加亮，讓深色背景上看得到卡片的厚度
  sides.colorNode = uBody.rgb.mul(normalView.z.max(0).mul(1.6).add(0.9));
  const body = new Mesh(undefined, [hiddenCaps, sides]);
  // CD 光碟（T-810）的側面（印刷面圓環的內外緣）：銀色；第一次是光碟才建
  let discEdge: MeshBasicNodeMaterial | null = null;

  const frontMesh = new Mesh();
  frontMesh.position.z = CARD_THICKNESS / 2;
  // 背面：同一個形狀繞垂直軸轉 180°，本地 +x 就是「看著背面」的右邊（不鏡像）
  const backMesh = new Mesh();
  backMesh.position.z = -CARD_THICKNESS / 2;
  backMesh.rotation.y = Math.PI;

  // 卡外網格（T-411）：卡面網格的子物件（同位置、同方向）；沒有破框層時不顯示
  const ringFor = (parent: Mesh): Mesh => {
    const ring = new Mesh(undefined, hiddenCaps);
    ring.visible = false;
    parent.add(ring);
    return ring;
  };

  const faceState = (mesh: Mesh): FaceState => ({
    mesh,
    key: null,
    ornate: false,
    slots: [],
    mask: null,
    maskScale: new Vector2(1, 1),
    maskOffset: new Vector2(0, 0),
    flash: uniform(0),
    ring: ringFor(mesh),
    ringKey: null,
  });
  const faces: Record<FaceSide, FaceState> = { front: faceState(frontMesh), back: faceState(backMesh) };

  const group = new Group();
  group.add(body, frontMesh, backMesh);
  group.visible = false; // 第一次 update 之前沒有內容
  // 透明卡套（T-806）：第一次開卡套才建、加在 group 最後；之後關掉只藏起來
  let sleeve: SleeveObject | null = null;
  // CD 光碟的透明塑膠（T-810）：第一次是光碟才建、加在 group 最後；之後換成卡片只藏起來
  let plastic: DiscPlastic | null = null;
  let sleeveWanted = false;
  // 預覽要不要畫景深陰影（T-809 效能自動降級）：關掉＝每層影子濃度的 uniform 設成 0；擷取用 withFullShadows 暫時恢復
  let previewShadows = true;
  /** 動態特效的時間（秒，T-811；setTime 的第二個參數）：預覽＝影格時間，轉動匯出＝影片時間。 */
  let fxTime = 0;
  /** 每一層影子濃度的 uniform 照目前的設定寫一遍（關著＝0；full＝擷取時一律完整）。 */
  const writeShadowStrengths = (full: boolean) => {
    const on = full || previewShadows;
    for (const face of FACES) for (const slot of faces[face].slots) if (slot.shadow) slot.shadow.strength.value = on ? slot.shadow.base : 0;
  };

  let outline: RoundedRect = cardOutline(DEFAULT_CARD_H, 0);
  let geometryKey: string | null = null;
  /** 目前畫的是 CD 光碟（T-810，最近一次 update 的卡片）。 */
  let discShown = false;

  const rebuildGeometry = () => {
    const old = new Set<BufferGeometry>([body.geometry, frontMesh.geometry, backMesh.geometry]);
    if (discShown) {
      // CD 光碟（T-810）：印刷面圓環＋內外緣的側面（銀色），厚度是卡片的 0.8 倍；透明塑膠另外一組
      const faceGeometry = discFaceGeometry(); // 正反面共用
      body.geometry = discBodyGeometry();
      body.material = [hiddenCaps, (discEdge ??= discEdgeMaterial())];
      frontMesh.geometry = faceGeometry;
      backMesh.geometry = faceGeometry;
      frontMesh.position.z = DISC_THICKNESS / 2;
      backMesh.position.z = -DISC_THICKNESS / 2;
      if (!plastic) {
        plastic = createDiscPlastic();
        group.add(plastic.group);
      }
      plastic.group.visible = true;
    } else {
      const shape = roundedRect(outline);
      const bodyGeometry = new ExtrudeGeometry(shape, { depth: CARD_THICKNESS, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
      bodyGeometry.translate(0, 0, -CARD_THICKNESS / 2);
      const faceGeometry = new ShapeGeometry(shape, CURVE_SEGMENTS); // 正反面共用
      body.geometry = bodyGeometry;
      body.material = [hiddenCaps, sides];
      frontMesh.geometry = faceGeometry;
      backMesh.geometry = faceGeometry;
      frontMesh.position.z = CARD_THICKNESS / 2;
      backMesh.position.z = -CARD_THICKNESS / 2;
      if (plastic) plastic.group.visible = false;
    }
    for (const g of old) g.dispose();
  };

  const rebuildFace = (face: FaceSide, card: Card, getImage: GetImage, targets: HoloTargets) => {
    const state = faces[face];
    const disc = isDisc(card);
    // CD 光碟的背面（T-810）：資料面，不畫圖層（SCHEMA：背面一定沒有圖層；萬一有也不畫）
    const dataSide = disc && face === 'back';
    state.mask = targets.mask !== null && !dataSide ? (getImage(targets.mask) ?? null) : null;
    const oldOffsets = state.slots.map((s) => s.offset);
    state.slots = (dataSide ? [] : card[face].layers).map((layer, i) => {
      const clip = clipOf(card, face, i);
      const altImage = altImageOf(layer, getImage);
      return {
        id: layer.id,
        image: getImage(layer.image) ?? null,
        breakout: isBreakout(layer),
        lineart: lineartOn(layer),
        clip,
        clipDepth: clip !== null ? uniform(1) : null,
        depth: layer.depth,
        center: new Vector2(),
        size: new Vector2(1, 1),
        visible: uniform(1),
        opacity: uniform(opacityFactor(layer.opacity)),
        blend: blendOf(layer),
        // 沿用舊的位移，換材質的那一格不會跳一下
        offset: oldOffsets[i]?.clone() ?? new Vector2(),
        holoMix: targets.layers[i] ? (layer.role === 'base' ? HOLO_MIX_BACKGROUND : HOLO_MIX_SUBJECT) : null,
        // 剪裁中的層不投自己的影子（T-803）
        shadow:
          castsShadow(layer) && clip === null
            ? { offset: new Vector2(), depth: uniform(1), strength: uniform(0), base: 0, level: uniform(0), spread: uniform(0) }
            : null,
        // 變身圖（T-805）：還沒準備好先照沒有變身圖畫（圖到了 compositionKey 會變、換材質）
        alt: altImage ? { image: altImage, size: new Vector2(1, 1), shadowLevel: uniform(0) } : null,
        // 動態特效（T-811）：顏色、強度、迴圈位置在下面 update 的 uniform 那段寫
        fx: fxOn(layer) && layer.fx ? { kind: layer.fx.kind, speed: layer.fx.speed, color: uniform(new Vector3(1, 1, 1)), gain: uniform(0), loop: uniform(0) } : null,
      };
    });
    const old = state.mesh.material;
    state.ornate = ornateOn(card);
    state.mesh.material = dataSide ? discDataMaterial(holo) : buildMaterial(face, state.slots, targets, state.ornate, disc);
    if (!Array.isArray(old)) old.dispose();
    // 卡外網格：有破框層才顯示（網格在 update 裡依範圍換）
    const oldRing = state.ring.material;
    const ring = buildRing(face, state.slots);
    state.ring.material = ring ?? hiddenCaps;
    state.ring.visible = ring !== null;
    if (!Array.isArray(oldRing) && oldRing !== hiddenCaps) oldRing.dispose();
  };

  /** 這一面每個破框層（有圖的；shownOnly＝只算顯示中的）在位移 0 時的內容範圍，各自加上 grow(depth)。 */
  const breakoutExtents = (face: FaceSide, grow: (depth: number) => number, shownOnly = false): Box[] => {
    const out: Box[] = [];
    for (const s of faces[face].slots) {
      if (!s.breakout || !s.image || (shownOnly && s.visible.value === 0)) continue;
      const content = contentOf(s.image);
      if (content) out.push(expandBox(contentBox(s.center, { w: s.size.x, h: s.size.y }, content), grow(s.depth)));
    }
    return out;
  };

  /** 卡外網格的外框：這一面有破框層時，照「內容範圍＋最大位移」對齊格子；變了才換網格。 */
  const updateRing = (face: FaceSide) => {
    const state = faces[face];
    if (!state.ring.visible) return;
    const b = ringBounds(outline, breakoutExtents(face, maxOffset));
    const key = `${b.left}|${b.right}|${b.bottom}|${b.top}|${geometryKey}`;
    if (key === state.ringKey) return;
    const old = state.ring.geometry;
    // CD 光碟（T-810）：印刷面外面＋透明圈（孔裡不畫）
    state.ring.geometry = discShown ? discRingGeometry(b) : ringGeometry(outline, b);
    state.ringKey = key;
    old.dispose();
  };

  let currentReach: { x: number; y: number } | null = null;

  const disposeUnusedTextures = () => {
    const used = new Set<HTMLImageElement>();
    for (const face of FACES) {
      for (const s of faces[face].slots) {
        if (s.image) used.add(s.image);
        if (s.alt) used.add(s.alt.image);
      }
    }
    for (const [image, tex] of textures) {
      if (!used.has(image)) {
        tex.dispose();
        textures.delete(image);
      }
    }
    const masks = new Set(FACES.map((face) => faces[face].mask));
    for (const [image, tex] of maskTextures) {
      if (!masks.has(image)) {
        tex.dispose();
        maskTextures.delete(image);
      }
    }
    // 雕花邊角的貼圖（T-416）：兩面都換回簡約了就收掉
    if (cornerTexture && !FACES.some((face) => faces[face].ornate)) {
      cornerTexture.dispose();
      cornerTexture = null;
    }
  };

  return {
    group,
    outline: () => outline,
    offsets: (face) => faces[face].slots.map((s) => s.offset),

    update(card, getImage) {
      // 1. 網格：比例（卡高，T-807 含自訂）、圓角；CD 光碟（T-810）固定一種
      const cardH = aspectHeight(card);
      const disc = isDisc(card);
      const nextGeometryKey = disc ? 'disc' : `${cardH}|${card.cornerRadius}`;
      if (nextGeometryKey !== geometryKey) {
        discShown = disc;
        outline = disc ? discOutline() : cardOutline(cardH, card.cornerRadius);
        rebuildGeometry();
        geometryKey = nextGeometryKey;
      }

      // 2. 材質：每一面的圖層組成
      let rebuilt = false;
      for (const face of FACES) {
        const targets = meshTargets(card, face, getImage);
        const key = compositionKey(card, face, getImage, targets, ornateOn(card));
        if (key !== faces[face].key) {
          rebuildFace(face, card, getImage, targets);
          faces[face].key = key;
          rebuilt = true;
        }
      }
      if (rebuilt) disposeUnusedTextures();

      // 3. uniform：每次都更新（便宜）
      bodyColor.set(card.bodyColor);
      faceSize.set(outline.halfW * 2, outline.halfH * 2);
      const cover = coverUv(plainBack.naturalWidth, plainBack.naturalHeight, faceSize.x, faceSize.y);
      plainScale.set(cover.scaleX, cover.scaleY);
      plainOffset.set(cover.offsetX, cover.offsetY);

      const inner = frameInner(outline, card.frame.width);
      frameHalf.set(inner.halfW, inner.halfH);
      uFrameRadius.value = inner.r;
      outerHalf.set(outline.halfW, outline.halfH);
      uOuterRadius.value = outline.r;
      uFrameOn.value = card.frame.enabled ? 1 : 0;
      frameColor.set(card.frame.color);
      uFrameShine.value = frameShineFactor(card.frame.shine);
      uOrnateSize.value = ornateSize(card.frame.width, outline);

      const h = holoUniformValues(card.holo);
      holo.foil.value = h.foil;
      holo.freq.value = h.freq;
      holo.sparkleCut.value = h.sparkleCut;
      holo.matte.value = h.matte;
      holoPaletteColors(card.holo).forEach((c, i) => paletteColors[i]!.set(c.r, c.g, c.b));
      // 黑白圖 cover 貼滿卡面（比例改了也跟著變）
      for (const face of FACES) {
        const m = faces[face].mask;
        if (!m) continue;
        const c = coverUv(m.naturalWidth, m.naturalHeight, faceSize.x, faceSize.y);
        faces[face].maskScale.set(c.scaleX, c.scaleY);
        faces[face].maskOffset.set(c.offsetX, c.offsetY);
      }

      const shadowK = shadowFactors(card.shadow);

      for (const face of FACES) {
        card[face].layers.forEach((layer, i) => {
          const slot = faces[face].slots[i];
          if (!slot?.image) return;
          const { w, h } = layerSize(slot.image.naturalWidth, slot.image.naturalHeight, layer.scale);
          slot.center.set(layer.x, layer.y);
          slot.size.set(w, h);
          slot.depth = layer.depth;
          slot.visible.value = layer.visible ? 1 : 0;
          slot.opacity.value = opacityFactor(layer.opacity);
          if (slot.clipDepth) slot.clipDepth.value = Math.min(100, Math.max(1, Number.isFinite(layer.depth) ? layer.depth : 1));
          // 變身圖（T-805）：同寬、高照它自己的比例
          if (slot.alt) {
            const a = layerSize(slot.alt.image.naturalWidth, slot.alt.image.naturalHeight, layer.scale);
            slot.alt.size.set(a.w, a.h);
          }
          // 動態特效（T-811）：顏色、強度、速度只改 uniform；迴圈位置照目前的特效時間馬上算一次（拖速度滑桿時立刻看到）
          if (slot.fx && layer.fx) {
            const c = fxRgb(layer.fx.color);
            slot.fx.color.value.set(c.r, c.g, c.b);
            slot.fx.gain.value = fxGain(layer.fx.strength);
            slot.fx.speed = layer.fx.speed;
            slot.fx.loop.value = fxLoop(fxTime, slot.fx.speed);
          }
          if (slot.shadow) {
            const s = layerShadow(layer.depth, shadowK);
            slot.shadow.offset.set(s.offsetX, s.offsetY);
            slot.shadow.depth.value = Math.min(100, Math.max(1, Number.isFinite(layer.depth) ? layer.depth : 1));
            slot.shadow.base = s.strength;
            slot.shadow.strength.value = previewShadows ? s.strength : 0;
            // 四次取樣各模糊 blur/2、彼此相隔 blur/2 → 合起來約 blur 寬的柔邊
            slot.shadow.level.value = shadowMipLevel(s.blur / 2, slot.image.naturalWidth, w);
            slot.shadow.spread.value = s.blur / 4;
            if (slot.alt) slot.alt.shadowLevel.value = shadowMipLevel(s.blur / 2, slot.alt.image.naturalWidth, w);
          }
        });
      }

      // 破框層（T-411）：卡外網格的範圍、鏡頭取景
      for (const face of FACES) updateRing(face);
      currentReach = framingReach(FACES.flatMap((face) => breakoutExtents(face, layerLift, true)));

      // 4. 透明卡套（T-806）：跟著卡片輪廓（比例、圓角）
      sleeveWanted = sleeveOn(card);
      if (sleeveWanted && !sleeve) {
        sleeve = createSleeveObject();
        group.add(sleeve.group);
      }
      if (sleeve) {
        sleeve.setOutline(outline);
        sleeve.group.visible = sleeveWanted;
      }

      group.visible = true;
    },

    breakoutBoxes(face, offsets) {
      const out: BreakoutBox[] = [];
      faces[face].slots.forEach((s, i) => {
        if (!s.breakout || !s.image || s.visible.value === 0) return;
        const content = contentOf(s.image);
        if (!content) return;
        const o = offsets ? (offsets[i] ?? { x: 0, y: 0 }) : s.offset;
        out.push({ face, box: contentBox({ x: s.center.x + o.x, y: s.center.y + o.y }, { w: s.size.x, h: s.size.y }, content) });
      });
      return out;
    },

    breakoutAt(face, x, y) {
      const slots = faces[face].slots;
      const fade = breakoutFade(views[face].z);
      if (fade <= 0) return null;
      // CD 光碟（T-810）：孔裡不畫破框層，也點不到
      if (discShown && Math.hypot(x, y) < DISC.hole) return null;
      for (let i = slots.length - 1; i >= 0; i--) {
        const s = slots[i]!;
        if (!s.breakout || !s.image || s.visible.value === 0 || s.opacity.value === 0) continue;
        const { u, v } = layerUv(x, y, { x: s.center.x + s.offset.x, y: s.center.y + s.offset.y }, { w: s.size.x, h: s.size.y });
        if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
        const m = maskOf(s.image);
        // 卡外實際畫出來的 alpha（混合模式、不透明度、側面淡出都算進去，同卡外網格的 shader）；
        // 讀不到遮罩（沒有 DOM）時當整張不透明、只算不透明度與淡出
        const a = (m ? outsideAlphaAt(m.mask, u, v, s.blend, s.opacity.value * 100) : s.opacity.value) * fade;
        if (a * 255 > HIT_ALPHA) return s.id;
      }
      return null;
    },

    reach: () => currentReach,

    setView(yawDeg, pitchDeg) {
      for (const face of FACES) {
        const v = viewDirection(face, yawDeg, pitchDeg);
        views[face].set(v.x, v.y, v.z);
      }
    },

    setTime(seconds, fxSeconds = seconds) {
      holo.time.value = seconds;
      // 動態特效（T-811）：每層照自己的速度算迴圈位置（CPU 雙精度，fx-nodes.ts 的 fxLoop）
      fxTime = fxSeconds;
      for (const face of FACES) for (const slot of faces[face].slots) if (slot.fx) slot.fx.loop.value = fxLoop(fxTime, slot.fx.speed);
    },

    setFlash(face, level) {
      faces[face].flash.value = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    },

    sleeve: () => sleeveWanted,

    setShadows(on) {
      if (on === previewShadows) return;
      previewShadows = on;
      writeShadowStrengths(false);
    },

    withFullShadows(draw) {
      if (previewShadows) return draw();
      writeShadowStrengths(true);
      try {
        draw();
      } finally {
        writeShadowStrengths(false);
      }
    },

    withoutSleeve(draw) {
      const shown = sleeve?.group;
      if (!shown?.visible) return draw();
      shown.visible = false;
      try {
        draw();
      } finally {
        shown.visible = true;
      }
    },
  };
}
