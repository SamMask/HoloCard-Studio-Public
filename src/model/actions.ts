// 卡片編輯動作（SCHEMA.md §1.2、§1.3）：全部是「舊卡 → 新卡」的純函式，不改輸入物件。
// 不碰 updatedAt（呼叫端提交時設定）。找不到圖層或沒有任何改變時回傳原卡（同一個物件）。
import {
  DEFAULT_MATTE,
  DEFAULT_OPACITY,
  FOIL_SHAPES,
  FRAME_STYLES,
  HEX_COLOR,
  HOLO_COLOR_COUNT,
  HOLO_PALETTE_IDS,
  ID_MAX,
  IMAGE_HASH,
  MAX_CARD_IMAGES,
  RANGE,
  STAGE_STYLES,
  DEFAULT_WATER_SCENE,
  WATER_SCENES,
  DEFAULT_FAR_PAN,
  DEFAULT_FOREGROUND,
  DEFAULT_WATER_LOOK,
  FAR_PAN_STEP,
  STORY_MAX,
  STORY_MAX_LINES,
  TEXT_ALIGNS,
  TEXT_CONTENT_MAX,
  TEXT_FONTS,
  TEXT_NAME_MAX,
  TEXT_STYLES,
  clamp,
  cleanName,
  exceedsLength,
  firstChars,
  isFiniteNumber,
} from './limits';
import { ASPECTS, aspectHeight, customAspectProblem, isDisc, type CardShape } from './aspect';
import {
  BLEND_MODES,
  MAX_LAYERS_PER_FACE,
  OPAQUE_LAYER_BLENDS,
  type Aspect,
  type BlendMode,
  type Card,
  type CustomAspect,
  type CardStory,
  type CardView,
  type FaceSide,
  type FarPan,
  type Foil,
  type Foreground,
  type FoilShape,
  type Frame,
  type FrameStyle,
  type Holo,
  type Layer,
  type LayerAlt,
  type LayerFx,
  type Shadow,
  type TextFont,
  type TextSpec,
  type WaterLook,
  type WaterScene,
} from './types';
import { cardImages, faceFoil, holoMatte, isDefaultFoil } from './foil';
import { fxBlocked, mergeFx, sameFx, type FxPatch } from './fx';

export interface NewLayerInput {
  /** 1～100 字，不能和這張卡任何一面現有的圖層 id 重複（呼叫端用 crypto.randomUUID()）。 */
  id: string;
  /** 已經是顯示用名稱（ingest 回傳的 name），這裡只做 trim 與截字。 */
  name: string;
  /** 圖片雜湊：16 碼小寫十六進位（ingest 算出來的）。 */
  image: string;
  hasAlpha: boolean;
  /** 圖片像素寬高，用來算預設擺法。 */
  width: number;
  height: number;
  /**
   * 混合模式（T-408，可不給）：沒有透明的圖給加深／發光／強光（OPAQUE_LAYER_BLENDS）就加成立體層、不當底圖
   * （上傳確認框的「當發光層」「當加深層」）；有透明的圖七種都可以給。不給＝normal（沒有透明的圖照舊當底圖）。
   */
  blend?: BlendMode;
}

/** 新文字圖層（SCHEMA §1「文字圖層」）：image 是程式依 text 畫好、走過 ingest 的圖。 */
export interface NewTextLayerInput {
  /** 規則同 NewLayerInput.id。 */
  id: string;
  image: string;
  text: TextSpec;
  /** 畫好的圖的像素寬高（只檢查合不合理；大小用圖層 scale）。 */
  width: number;
  height: number;
}

/**
 * 改文字圖層：字和圖一定要一起換——text 是完整的新設定（六個欄位都要有）、image 是依它畫好的新圖，
 * 兩個都必填（編譯期就擋掉只給一半）；執行期仍會檢查，少一個或不合格就整個不改（回原卡），
 * 才不會出現「圖照 A 畫、設定存成 B」。
 * 呼叫端想只改幾個欄位，先用 mergeTextSpec 合出完整設定、畫好圖再呼叫。
 * 圖的像素寬高不在這裡：文字圖層的大小用圖層 scale，不跟著圖走。
 */
export interface TextLayerUpdate {
  text: TextSpec;
  image: string;
}

export type AddLayerResult =
  | { ok: true; card: Card; layerId: string }
  | { ok: false; reason: 'face-full' | 'needs-replace-base' | 'invalid-input' | 'too-many-images' };

/** 改反光層（T-417）：只給要改的欄位。mask＝換上這張黑白圖（雜湊）。 */
export interface FoilPatch {
  shape?: FoilShape;
  mask?: string;
  frame?: boolean;
}

export type LayerPatch = Partial<
  Pick<Layer, 'name' | 'visible' | 'depth' | 'x' | 'y' | 'scale' | 'holo' | 'opacity' | 'blend' | 'breakout' | 'lineart' | 'clip'>
> & {
  /** 變身圖（T-805）：換上這張（加上或換一張）；null＝拿掉。 */
  alt?: LayerAlt | null;
  /** 動態特效（T-811）：只給要改的欄位（還沒有特效時要給 kind，其他用預設值，model/fx.ts 的 mergeFx）；null＝拿掉。 */
  fx?: FxPatch | null;
};

export interface CardPatch {
  name?: string;
  /**
   * 比例（T-807）：和 customAspect 一起改。換成 'custom' 一定要帶合格的 customAspect（已經是自訂時可以只給 customAspect）；
   * 不合格就不改比例。換成其他比例時拿掉 customAspect。圖層 x／y／scale 不變。
   */
  aspect?: Aspect;
  customAspect?: CustomAspect;
  bodyColor?: string;
  cornerRadius?: number;
  frame?: Partial<Frame>;
  holo?: Partial<Holo>;
  shadow?: Partial<Shadow>;
  /**
   * view：遠景的位置與大小 farPan（T-822）、水面樣子 waterLook（T-825）只給要改的欄位（其他照舊），見 nextView。
   * 水面樣子的快速套用（〔夜色〕〔霧白〕）＝給整組。
   * 前景圖（T-830）：只改位置、大小、模糊（只給要改的欄位；image 不理，加、換、拿掉用 setForeground；沒有前景圖時不做事）。
   */
  view?: Partial<Omit<CardView, 'farPan' | 'waterLook' | 'foreground'>> & {
    farPan?: Partial<FarPan>;
    waterLook?: Partial<WaterLook>;
    foreground?: Partial<Omit<Foreground, 'image'>>;
  };
  /**
   * 卡片故事（T-804）：text 照 cleanStory 整理；null、空字串（整理後是空的）＝拿掉欄位。
   * 只給 font：有故事才換字型（沒有故事時不改）。沒給 font 時沿用原本的、沒有就用 DEFAULT_STORY_FONT。
   */
  story?: Partial<CardStory> | null;
}

export const DEFAULT_LAYER_NAME = '圖層';
/** 卡片故事的預設字型（同新文字圖層：霞鶩文楷）。 */
export const DEFAULT_STORY_FONT: TextFont = 'wenkai';
/** 文字圖層內容整理後還是空的時候用的名字（正常不會發生：內容不准只有空白）。 */
export const DEFAULT_TEXT_LAYER_NAME = '文字';
/** 新文字圖層的設定（SCHEMA §1「文字圖層」）。 */
export const DEFAULT_TEXT: Readonly<TextSpec> = Object.freeze({
  content: '卡片名稱',
  font: 'wenkai',
  color: '#ffffff',
  align: 'center',
  vertical: false,
  style: 'outline',
});
/** 新文字圖層的位置：卡片上方。 */
export const TEXT_LAYER_Y = 0.55;
const TEXT_KEYS = ['content', 'font', 'color', 'align', 'vertical', 'style'] as const satisfies readonly (keyof TextSpec)[];
/** 這一面第一個立體層的 depth；之後每次＝目前最大 depth＋DEPTH_STEP。 */
const FIRST_DEPTH = 50;
const DEPTH_STEP = 20;

// ---- 小工具 ----

export function findLayer(card: Card, face: FaceSide, layerId: string): Layer | undefined {
  return card[face].layers.find((l) => l.id === layerId);
}

/** 換掉這一面的圖層；Face 上其他欄位（M3 文字圖層可能會加）原樣保留。 */
function withLayers(card: Card, face: FaceSide, layers: Layer[]): Card {
  return face === 'front'
    ? { ...card, front: { ...card.front, layers } }
    : { ...card, back: { ...card.back, layers } };
}

/** 卡片用到的圖超過上限了沒（T-417：反光層的黑白圖也算，所以兩面各 8 層不一定放得下）。 */
function tooManyImages(card: Card): boolean {
  return cardImages(card).length > MAX_CARD_IMAGES;
}

/**
 * 這一面不能放圖層（T-810）：CD 光碟的背面是銀色資料面（SCHEMA：back.layers 一定是空的）。
 * 加圖層的動作（上傳、加文字、取代底圖、AI 拆層）對它一律當成「放不下」（face-full／卡片不變）。
 */
function noLayersHere(card: Card, face: FaceSide): boolean {
  return face === 'back' && isDisc(card);
}

function validSize(v: number): boolean {
  return isFiniteNumber(v) && v > 0;
}

/** 新立體層的 depth（SCHEMA §1.3）：這一面第一個立體層 FIRST_DEPTH，之後＝目前最大＋DEPTH_STEP，上限 100。 */
function nextDepth(layers: readonly Layer[]): number {
  const depths = layers.filter((l) => l.role === 'depth').map((l) => l.depth);
  return depths.length === 0 ? FIRST_DEPTH : Math.min(RANGE.depth.max, Math.max(...depths) + DEPTH_STEP);
}

/** id 1～ID_MAX 字、不和這張卡任何一面現有的圖層 id 重複；image 是 16 碼小寫十六進位。 */
function isNewIdAndImage(card: Card, id: unknown, image: unknown): boolean {
  if (typeof id !== 'string' || id.length === 0 || exceedsLength(id, ID_MAX)) return false;
  if (typeof image !== 'string' || !IMAGE_HASH.test(image)) return false;
  return !card.front.layers.some((l) => l.id === id) && !card.back.layers.some((l) => l.id === id);
}

// ---- 不透明度與混合模式（T-408，SCHEMA §1）：欄位可省略，省略＝100／normal ----

/** 圖層的不透明度 0～100（省略＝100）。 */
export function layerOpacity(layer: Pick<Layer, 'opacity'>): number {
  return layer.opacity ?? DEFAULT_OPACITY;
}

/** 圖層的混合模式（省略＝normal）。 */
export function layerBlend(layer: Pick<Layer, 'blend'>): BlendMode {
  return layer.blend ?? 'normal';
}

/** 卡框樣式（T-416；省略＝simple）。 */
export function frameStyle(frame: Pick<Frame, 'style'>): FrameStyle {
  return frame.style ?? 'simple';
}

function isBlendMode(v: unknown): v is BlendMode {
  return typeof v === 'string' && (BLEND_MODES as readonly string[]).includes(v);
}

/**
 * 這一層能不能用這個混合模式：底圖都不行（固定正常）；沒有透明的立體層只能用 OPAQUE_LAYER_BLENDS
 * （白色或黑色會「消失」，才不會整片蓋住後面）；有透明的立體層與文字層七種都可以。
 * 有變身圖（T-805）時兩張一起看：任一張沒有透明就只能用那三種。
 */
export function blendAllowed(layer: Pick<Layer, 'role' | 'hasAlpha' | 'alt'>, blend: BlendMode): boolean {
  if (layer.role !== 'depth' || !isBlendMode(blend)) return false;
  return (layer.hasAlpha && layer.alt?.hasAlpha !== false) || OPAQUE_LAYER_BLENDS.includes(blend);
}

/** 換上這組不透明度與混合模式：等於預設值的欄位拿掉（不寫 undefined，存進資料庫才不會被擋）。不改輸入。 */
function withLook(layer: Layer, opacity: number, blend: BlendMode): Layer {
  const { opacity: _o, blend: _b, ...rest } = layer;
  const next: Layer = rest;
  if (opacity !== DEFAULT_OPACITY) next.opacity = opacity;
  if (blend !== 'normal') next.blend = blend;
  return next;
}

// ---- 破框（T-411，SCHEMA §1）：欄位可省略，省略＝false ----

/** 這層是不是破框層（超出卡片的部分也畫）：只有明寫 true 才算。 */
export function layerBreakout(layer: Pick<Layer, 'breakout'>): boolean {
  return layer.breakout === true;
}

/** 換上這個破框設定：false 拿掉欄位（不寫 undefined，存進資料庫才不會被擋）。不改輸入。 */
function withBreakout(layer: Layer, on: boolean): Layer {
  const { breakout: _b, ...rest } = layer;
  return on ? { ...rest, breakout: true } : rest;
}

// ---- 線稿高光（T-802，SCHEMA §1）：欄位可省略，省略＝false ----

/** 這層有沒有開「沿線條反光」：只有明寫 true 才算（底圖、文字層、破框層畫的時候另外排除，見 render/lineart.ts）。 */
export function layerLineart(layer: Pick<Layer, 'lineart'>): boolean {
  return layer.lineart === true;
}

/** 換上這個線稿高光設定：false 拿掉欄位（不寫 undefined，存進資料庫才不會被擋）。不改輸入。 */
function withLineart(layer: Layer, on: boolean): Layer {
  const { lineart: _l, ...rest } = layer;
  return on ? { ...rest, lineart: true } : rest;
}

// ---- 剪裁遮色片（T-803，SCHEMA §1 Layer.clip?）：欄位可省略，省略＝false ----

/** 這層有沒有開「只畫在下面那層上」：只有明寫 true 才算（真的有沒有剪裁看 clipParent）。 */
export function layerClip(layer: Pick<Layer, 'clip'>): boolean {
  return layer.clip === true;
}

/** 換上這個剪裁設定：false 拿掉欄位（不寫 undefined，存進資料庫才不會被擋）。不改輸入。 */
function withClip(layer: Layer, on: boolean): Layer {
  const { clip: _c, ...rest } = layer;
  return on ? { ...rest, clip: true } : rest;
}

/** 往前找第一個 clip 不是 true 的層（不看這層自己）；沒有＝-1。 */
function belowIndex(layers: readonly Layer[], index: number): number {
  let j = index - 1;
  while (j >= 0 && layerClip(layers[j]!)) j--;
  return j;
}

/** 剪裁不成立的原因：no-layer＝下面不是一般的圖層（底圖、沒有下面，或這層自己是底圖）；breakout＝任一方衝出卡片。 */
export type ClipBlock = 'no-layer' | 'breakout';

/**
 * 這層「如果打開剪裁」能不能剪裁（不看這層自己有沒有開；右欄開關變淡的原因）：可以＝null。
 * 下面那層＝陣列裡往前找第一個 clip 不是 true 的層；它是底圖或沒有 → no-layer；任一方破框 → breakout。
 */
export function clipBlocked(face: { readonly layers: readonly Layer[] }, layerIndex: number): ClipBlock | null {
  const layers = face.layers;
  const layer = layers[layerIndex];
  if (!layer || layer.role !== 'depth') return 'no-layer';
  const below = layers[belowIndex(layers, layerIndex)];
  if (!below || below.role !== 'depth') return 'no-layer';
  if (layerBreakout(layer) || layerBreakout(below)) return 'breakout';
  return null;
}

/**
 * 剪裁層的「下面那層」在陣列裡的 index（SCHEMA §1 Layer.clip?）；這層沒開剪裁、或剪裁不成立（clipBlocked）＝null。
 * render（乘下面那層的 alpha、不投影子）、ui（縮排、不能拖、深度滑桿變淡）、actions（深度規則、拖曳）共用。
 */
export function clipParent(face: { readonly layers: readonly Layer[] }, layerIndex: number): number | null {
  const layer = face.layers[layerIndex];
  if (!layer || !layerClip(layer) || clipBlocked(face, layerIndex) !== null) return null;
  return belowIndex(face.layers, layerIndex);
}

/**
 * 剪裁層的 depth 一律等於下面那層：不等的改過來（只會變小或不變），再穩定排序一次（只會在同一串剪裁層裡換位置，
 * 誰剪裁到誰不變）。沒有要改的回原陣列（同一個物件）；沒改到的圖層物件不動。
 */
function syncClipLayers(layers: Layer[]): Layer[] {
  let out: Layer[] | null = null;
  for (let i = 0; i < layers.length; i++) {
    const cur = out ?? layers;
    const p = clipParent({ layers: cur }, i);
    if (p === null || cur[i]!.depth === cur[p]!.depth) continue;
    out ??= layers.slice();
    out[i] = { ...out[i]!, depth: cur[p]!.depth };
  }
  return out ? sortByDepth(out) : layers;
}

/**
 * 讀卡時（資料庫、匯入卡片檔）把剪裁層的 depth 對齊下面那層（T-803b）：別的程式改過、depth 不一樣的卡不擋，
 * 讀進來就修好（同 syncClipLayers）。驗證過的卡才呼叫。兩面都沒有要改的回原卡（同一個物件）。
 */
export function alignClipDepths(card: Card): Card {
  const front = syncClipLayers(card.front.layers);
  const back = syncClipLayers(card.back.layers);
  if (front === card.front.layers && back === card.back.layers) return card;
  return { ...card, front: { ...card.front, layers: front }, back: { ...card.back, layers: back } };
}

/**
 * 拖曳排序、改 depth 時一起走的範圍：這層＋緊跟在後面的 clip 層（這層自己開了 clip 就只有它自己）；回傳結束的 index（不含）。
 * 左欄拖曳時跟著動的列也用這個（T-803 審查：中間夾一層剪裁但衝出卡片的層時，兩邊才一致）。
 */
export function clipRunEnd(layers: readonly Layer[], index: number): number {
  let end = index + 1;
  if (layerClip(layers[index]!)) return end;
  while (end < layers.length && layerClip(layers[end]!)) end++;
  return end;
}

// ---- 雙圖光柵的變身圖（T-805，SCHEMA §1 Layer.alt?）：欄位可省略，省略＝沒有變身圖 ----

/** 這層的變身圖；沒有＝null。 */
export function layerAlt(layer: Pick<Layer, 'alt'>): LayerAlt | null {
  return layer.alt ?? null;
}

/** 這層為什麼不能有變身圖（右欄「變身圖」那一小節變淡的原因）：可以＝null。 */
export type AltBlock = 'base' | 'text' | 'breakout';

/** 只有立體層能有變身圖：底圖、文字層、破框層不行（SCHEMA；破框層要先關掉衝出卡片）。 */
export function altBlocked(layer: Pick<Layer, 'role' | 'text' | 'breakout'>): AltBlock | null {
  if (layer.role !== 'depth') return 'base';
  if (layer.text !== undefined) return 'text';
  if (layerBreakout(layer)) return 'breakout';
  return null;
}

/** 合格的變身圖輸入：物件、image 是 16 碼小寫十六進位、hasAlpha 是 boolean。整理成只有這兩個欄位的新物件，不合格＝null。 */
function cleanAlt(v: unknown): LayerAlt | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const own = (key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);
  const image = own('image');
  const hasAlpha = own('hasAlpha');
  if (typeof image !== 'string' || !IMAGE_HASH.test(image) || typeof hasAlpha !== 'boolean') return null;
  return { image, hasAlpha };
}

/** 換上這張變身圖：null 拿掉欄位（不寫 undefined，存進資料庫才不會被擋）。不改輸入。 */
function withAlt(layer: Layer, alt: LayerAlt | null): Layer {
  const { alt: _a, ...rest } = layer;
  return alt ? { ...rest, alt } : rest;
}

function sameAlt(a: LayerAlt | undefined, b: LayerAlt | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.image === b.image && a.hasAlpha === b.hasAlpha);
}

// ---- 局部動態特效（T-811，SCHEMA §1 Layer.fx?）：欄位可省略，省略＝沒有特效；規則在 model/fx.ts ----

/** 換上這個特效：undefined 拿掉欄位（不寫 undefined，存進資料庫才不會被擋）。不改輸入。 */
function withFx(layer: Layer, fx: LayerFx | undefined): Layer {
  const { fx: _f, ...rest } = layer;
  return fx ? { ...rest, fx } : rest;
}

/**
 * 明寫了等於預設值的 opacity（100）、blend（normal）、breakout（false）、lineart（false）或 clip（false）；
 * 或欄位在但值是 undefined 的 alt（T-805）、fx（T-811）：記憶體裡才會有，存進資料庫、卡片檔會被擋。
 */
function hasExplicitDefault(layer: Layer): boolean {
  const own = (key: 'opacity' | 'blend' | 'breakout' | 'lineart' | 'clip' | 'alt' | 'fx') => Object.prototype.hasOwnProperty.call(layer, key);
  return (
    (own('opacity') && layer.opacity === DEFAULT_OPACITY) ||
    (own('blend') && layer.blend === 'normal') ||
    (own('breakout') && layer.breakout === false) ||
    (own('lineart') && layer.lineart === false) ||
    (own('clip') && layer.clip === false) ||
    (own('alt') && layer.alt === undefined) ||
    (own('fx') && layer.fx === undefined)
  );
}

/**
 * 寫出前的整理（SCHEMA §1：預設值一律省略，T-413；T-411 加 breakout、T-802 加 lineart、T-803 加 clip）：每一層明寫的
 * opacity: 100、blend: 'normal'、breakout: false、lineart: false、clip: false 拿掉（T-805：值是 undefined 的 alt 也拿掉；
 * 有變身圖的照樣留著；T-811 的 fx 同 alt）。validateCard 接受明寫的預設值
 * （例如別的程式寫出的卡片檔），工坊自己的動作不會產生（withLook、withBreakout、withLineart、withClip），
 * 所以在匯入或匯出的地方整理一次就不會漏。其他欄位、不是預設值的原樣；沒有要拿掉的回原卡（同一個物件）；不改輸入。
 */
export function omitLayerDefaults(card: Card): Card {
  const tidy = (l: Layer): Layer => {
    const look = withBreakout(withLook(l, layerOpacity(l), layerBlend(l)), layerBreakout(l));
    return withFx(withAlt(withClip(withLineart(look, layerLineart(l)), layerClip(l)), layerAlt(l)), l.fx);
  };
  const clean = (layers: Layer[]): Layer[] =>
    layers.some(hasExplicitDefault) ? layers.map((l) => (hasExplicitDefault(l) ? tidy(l) : l)) : layers;
  const front = clean(card.front.layers);
  const back = clean(card.back.layers);
  if (front === card.front.layers && back === card.back.layers) return card;
  return {
    ...card,
    front: front === card.front.layers ? card.front : { ...card.front, layers: front },
    back: back === card.back.layers ? card.back : { ...card.back, layers: back },
  };
}

/**
 * 寫出前的整理（卡片檔匯出用）：omitLayerDefaults 之外，反光層等於預設值（整面、卡框也反光、沒有保留黑白圖）就拿掉
 * Face.foil、霧光明寫 35 就拿掉 holo.matte（T-417）、卡框樣式明寫 'simple' 就拿掉 frame.style（T-416）、
 * 卡片故事是空的（欄位在但值是 undefined，或文字整理後是空的）就拿掉 story（T-804）、透明卡套不是 true（明寫 false）就拿掉
 * view.sleeve（T-806）、物件種類不是光碟（明寫 'card'）就拿掉 kind（T-810）、舞台背景圖欄位在但值是 undefined 就拿掉 view.backdrop（T-814）、
 * 水鏡遠景是預設的湖光山峰（明寫 'lake'）或 undefined 就拿掉 view.waterScene（T-815）、遠景位置是 {0,0,1} 或 undefined 就拿掉
 * view.farPan（T-822）、水面樣子等於〔夜色〕（顏色不分大小寫）或 undefined 就拿掉 view.waterLook（T-825）、
 * 前景圖欄位在但值是 undefined 就拿掉 view.foreground（T-830）。
 * 沒有要拿掉的回原卡（同一個物件）；不改輸入。
 */
export function omitCardDefaults(card: Card): Card {
  let next = omitLayerDefaults(card);
  for (const face of ['front', 'back'] as const) {
    const foil = next[face].foil;
    if (foil && isDefaultFoil(foil)) {
      const { foil: _f, ...rest } = next[face];
      next = { ...next, [face]: rest };
    }
  }
  if (Object.prototype.hasOwnProperty.call(next.holo, 'matte') && next.holo.matte === DEFAULT_MATTE) {
    const { matte: _m, ...rest } = next.holo;
    next = { ...next, holo: rest };
  }
  if (Object.prototype.hasOwnProperty.call(next.frame, 'style') && next.frame.style === 'simple') {
    const { style: _s, ...rest } = next.frame;
    next = { ...next, frame: rest };
  }
  if (Object.prototype.hasOwnProperty.call(next, 'story') && cleanStory(next.story?.text) === null) {
    const { story: _story, ...rest } = next;
    next = rest;
  }
  if (Object.prototype.hasOwnProperty.call(next.view, 'sleeve') && next.view.sleeve !== true) {
    const { sleeve: _s, ...rest } = next.view;
    next = { ...next, view: rest };
  }
  if (Object.prototype.hasOwnProperty.call(next.view, 'backdrop') && next.view.backdrop === undefined) {
    const { backdrop: _b, ...rest } = next.view;
    next = { ...next, view: rest };
  }
  if (Object.prototype.hasOwnProperty.call(next.view, 'foreground') && next.view.foreground === undefined) {
    const { foreground: _f, ...rest } = next.view;
    next = { ...next, view: rest };
  }
  if (
    Object.prototype.hasOwnProperty.call(next.view, 'waterScene') &&
    (next.view.waterScene === undefined || next.view.waterScene === DEFAULT_WATER_SCENE)
  ) {
    const { waterScene: _w, ...rest } = next.view;
    next = { ...next, view: rest };
  }
  if (Object.prototype.hasOwnProperty.call(next.view, 'farPan') && (next.view.farPan === undefined || isDefaultFarPan(next.view.farPan))) {
    const { farPan: _p, ...rest } = next.view;
    next = { ...next, view: rest };
  }
  if (
    Object.prototype.hasOwnProperty.call(next.view, 'waterLook') &&
    (next.view.waterLook === undefined || isDefaultWaterLook(cleanWaterLook(next.view.waterLook)))
  ) {
    const { waterLook: _l, ...rest } = next.view;
    next = { ...next, view: rest };
  }
  if (Object.prototype.hasOwnProperty.call(next, 'kind') && next.kind !== 'disc') {
    const { kind: _kind, ...rest } = next;
    next = rest;
  }
  return next;
}

// ---- 卡片故事（T-804，SCHEMA Card.story?）----

/**
 * 整理卡片故事的文字：去前後空白；只有空白的行不算一行；超過 2 行只留前 2 行；每行去頭尾空白；
 * 超過 60 字截掉（含換行算 1 字、以 Unicode 字元計；截完結尾的空白與換行拿掉）；\r\n、\r 都當換行、存成 \n。
 * 不是文字或整理完是空的 → null。逐行找、找夠 2 行就停（貼上幾十萬字也很快）。
 */
export function cleanStory(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lines: string[] = [];
  const breaks = /\r\n|\r|\n/g;
  let start = 0;
  while (lines.length < STORY_MAX_LINES) {
    breaks.lastIndex = start;
    const m = breaks.exec(raw);
    const line = raw.slice(start, m ? m.index : raw.length).trim();
    if (line !== '') lines.push(line);
    if (!m) break;
    start = m.index + m[0].length;
  }
  const text = firstChars(lines.join('\n'), STORY_MAX).trimEnd();
  return text === '' ? null : text;
}

/** 改故事（updateCard 用）：見 CardPatch.story。沒有改變回原本的物件（或 undefined）。 */
function nextStory(old: CardStory | undefined, patch: Partial<CardStory> | null | undefined): CardStory | undefined {
  if (patch === undefined) return old;
  if (patch === null) return undefined;
  if (typeof patch !== 'object' || Array.isArray(patch)) return old;
  const own = (key: keyof CardStory) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined;
  let text = old?.text;
  if (own('text')) {
    if (typeof patch.text !== 'string') return old;
    const cleaned = cleanStory(patch.text);
    if (cleaned === null) return undefined;
    text = cleaned;
  }
  if (text === undefined) return undefined;
  const font = own('font') && oneOf(patch.font, TEXT_FONTS) ? patch.font : (old?.font ?? DEFAULT_STORY_FONT);
  return old && old.text === text && old.font === font ? old : { text, font };
}

// ---- 反光層（T-417，SCHEMA §1「反光層」）----

/** 換上這個反光層：等於預設值時拿掉 Face.foil（寫出時省略）。 */
function withFoil(card: Card, face: FaceSide, foil: Foil): Card {
  const { foil: _f, ...rest } = card[face];
  return { ...card, [face]: isDefaultFoil(foil) ? rest : { ...rest, foil } };
}

/**
 * 改這一面的反光層：形狀（四選一）、黑白圖（合格雜湊；換圖）、卡框也反光。
 * 形狀選「上傳黑白圖」但這一面還沒有圖（patch 也沒給）→ 形狀不改；換別的形狀時黑白圖留著（切回來還在）。
 * 不合格的值忽略；結果會超過每張卡 16 張圖 → 不改；沒有改變回原卡。改回預設值（整面、卡框也反光、沒有圖）時拿掉欄位。
 */
export function updateFoil(card: Card, face: FaceSide, patch: FoilPatch): Card {
  const old = faceFoil(card[face]);
  const mask = typeof patch.mask === 'string' && IMAGE_HASH.test(patch.mask) ? patch.mask : old.mask;
  let shape = oneOf(patch.shape, FOIL_SHAPES) ? patch.shape : old.shape;
  if (shape === 'mask' && mask === undefined) shape = old.shape;
  const frame = typeof patch.frame === 'boolean' ? patch.frame : old.frame;
  if (shape === old.shape && mask === old.mask && frame === old.frame) return card;
  const foil: Foil = mask === undefined ? { shape, frame } : { shape, mask, frame };
  const next = withFoil(card, face, foil);
  return tooManyImages(next) ? card : next;
}

/** 依 depth 由小到大重新排；同 depth 維持原本的相對順序（Array.prototype.sort 是穩定排序）。 */
function sortByDepth(layers: Layer[]): Layer[] {
  return layers.slice().sort((a, b) => a.depth - b.depth);
}

/**
 * 輸入能不能變成合格的圖層（SCHEMA §1.1）：id 1～ID_MAX 字、不和這張卡任何一面現有的圖層 id 重複
 * （取代底圖時，即將被取代的舊底圖也算現有的）；image 是 16 碼小寫十六進位。
 * 正常流程（id 用 crypto.randomUUID()、雜湊由 ingest 產生）不會碰到；這是最後一道防線，
 * 避免寫出通不過 validateCard 的卡。
 */
function isValidInput(card: Card, input: NewLayerInput): boolean {
  return isNewIdAndImage(card, input.id, input.image);
}

/** 「放得下」：整張圖都在卡內（scale 1＝圖寬等於卡寬）。卡高照比例（含橫式自訂）。結果夾在 0.05～4；尺寸不合理時回 1。 */
export function containScale(imageWidth: number, imageHeight: number, shape: CardShape): number {
  if (!validSize(imageWidth) || !validSize(imageHeight)) return 1;
  const cardHeight = aspectHeight(shape);
  return clamp(Math.min(1, (cardHeight * imageWidth) / imageHeight), RANGE.scale);
}

/**
 * 「填滿」：蓋滿卡面、多的裁掉。bleed＝四邊各再多蓋多少（卡寬單位），
 * 也就是要蓋住 (1＋2×bleed) × (卡高＋2×bleed)。結果夾在 0.05～4；尺寸不合理時回 1。
 */
export function coverScale(imageWidth: number, imageHeight: number, shape: CardShape, bleed = 0): number {
  if (!validSize(imageWidth) || !validSize(imageHeight)) return 1;
  const b = isFiniteNumber(bleed) && bleed > 0 ? bleed : 0;
  const cardHeight = aspectHeight(shape);
  return clamp(Math.max(1 + 2 * b, ((cardHeight + 2 * b) * imageWidth) / imageHeight), RANGE.scale);
}

function makeBase(shape: CardShape, input: NewLayerInput): Layer {
  return {
    id: input.id,
    name: cleanName(input.name) || DEFAULT_LAYER_NAME,
    role: 'base',
    image: input.image,
    visible: true,
    depth: 0,
    x: 0,
    y: 0,
    scale: coverScale(input.width, input.height, shape),
    holo: false,
    hasAlpha: input.hasAlpha,
  };
}

// ---- 圖層 ----

/**
 * 上傳後加進這一面（SCHEMA §1.3 自動分類）：
 * - 沒有透明 → 底圖（放第 0 個、填滿）；這面已有底圖 → needs-replace-base（介面問要不要取代，同意後呼叫 replaceBase）。
 * - 有透明，或沒有透明但指定了加深／發光／強光（T-408，確認框的「當發光層」「當加深層」）→ 立體層
 *   （放最後＝最前面、放得下）；depth＝第一個 50，之後目前最大值＋20、上限 100。
 * - 每面已有 8 層 → face-full。已有底圖時不透明的圖先回 needs-replace-base（取代不會增加層數）。
 * - 輸入不合格（id 重複／空／太長、雜湊格式不對、混合模式不認得或這張圖不能用）→ invalid-input，
 *   優先於上面幾種（不合格的圖不必問要不要取代）。
 * - 加了會超過每張卡 16 張圖（反光層的黑白圖也算，T-417）→ too-many-images。
 * - CD 光碟的背面（T-810，資料面）→ face-full（不合格的輸入照樣先回 invalid-input）。
 */
export function addLayer(card: Card, face: FaceSide, input: NewLayerInput): AddLayerResult {
  if (!isValidInput(card, input)) return { ok: false, reason: 'invalid-input' };
  const blend = input.blend;
  if (blend !== undefined && !blendAllowed({ role: 'depth', hasAlpha: input.hasAlpha === true }, blend)) {
    return { ok: false, reason: 'invalid-input' };
  }
  // 光碟的背面（T-810）：不放圖層，不問要不要取代底圖
  if (noLayersHere(card, face)) return { ok: false, reason: 'face-full' };
  const layers = card[face].layers;
  const isBase = !input.hasAlpha && blend === undefined;
  if (isBase && layers.some((l) => l.role === 'base')) return { ok: false, reason: 'needs-replace-base' };
  if (layers.length >= MAX_LAYERS_PER_FACE) return { ok: false, reason: 'face-full' };

  if (isBase) {
    const base = makeBase(card, input);
    const next = withLayers(card, face, [base, ...layers]);
    return tooManyImages(next) ? { ok: false, reason: 'too-many-images' } : { ok: true, card: next, layerId: base.id };
  }

  const layer: Layer = {
    id: input.id,
    name: cleanName(input.name) || DEFAULT_LAYER_NAME,
    role: 'depth',
    image: input.image,
    visible: true,
    depth: nextDepth(layers),
    x: 0,
    y: 0,
    scale: containScale(input.width, input.height, card),
    holo: true,
    hasAlpha: input.hasAlpha === true,
  };
  if (blend !== undefined && blend !== 'normal') layer.blend = blend;
  // depth 不小於任何現有圖層，放最後仍維持排序；同為 100 時後上傳的在前面。
  const next = withLayers(card, face, [...layers, layer]);
  return tooManyImages(next) ? { ok: false, reason: 'too-many-images' } : { ok: true, card: next, layerId: layer.id };
}

/**
 * 取代這一面的底圖：新底圖用預設擺法重新填滿，不沿用舊的 x／y／scale。
 * 這面沒有底圖時直接放到第 0 個；沒有底圖而且已經 8 層 → 不變；輸入不合格（同 addLayer）→ 不變；
 * 換了會超過每張卡 16 張圖 → 不變；CD 光碟的背面（T-810）→ 不變。
 */
export function replaceBase(card: Card, face: FaceSide, input: NewLayerInput): Card {
  if (!isValidInput(card, input) || noLayersHere(card, face)) return card;
  const layers = card[face].layers;
  const others = layers.filter((l) => l.role !== 'base');
  if (others.length === layers.length && layers.length >= MAX_LAYERS_PER_FACE) return card;
  const next = withLayers(card, face, [makeBase(card, input), ...others]);
  return tooManyImages(next) ? card : next;
}

/**
 * 刪掉一層。剪裁（T-803）：刪掉的是下面那層時，它的剪裁層照 clipParent 改剪裁到再下面一個、depth 跟著新的下面那層；
 * 再下面是底圖或沒有 → 不剪裁（clip 欄位保留、depth 不動）。
 */
export function removeLayer(card: Card, face: FaceSide, layerId: string): Card {
  const layers = card[face].layers;
  if (!layers.some((l) => l.id === layerId)) return card;
  return withLayers(
    card,
    face,
    syncClipLayers(layers.filter((l) => l.id !== layerId)),
  );
}

/**
 * 改圖層屬性：數值夾在範圍內、NaN／Infinity 的欄位忽略；底圖 depth 永遠 0；
 * 名字去頭尾空白、截 60 字，空白就不改；改了 depth 就重新排序（穩定排序）。
 * 不透明度與混合模式（T-408）：底圖不能改；混合模式不認得或這一層不能用（blendAllowed）就不改；
 * 等於預設值（100／normal）時拿掉欄位。破框（T-411）：底圖不能開、不是 boolean 不改；關掉時拿掉欄位。
 * 線稿高光（T-802）：只有立體層、而且不是文字層才能開；不是 boolean 不改；關掉時拿掉欄位。
 * 剪裁（T-803）：只有立體層（含文字層）能開，打開後剪裁不成立（clipBlocked：下面是底圖、沒有下面、任一方破框）就不開；
 * 打開時 depth 設成下面那層的（陣列位置本來就在下面那層和它已有的剪裁層後面）；剪裁中的層自己的 depth 不能改（跟著下面那層）；
 * 改下面那層的 depth 時，緊跟在後面的剪裁層一起改、一起排序（相對順序不變）；關掉時拿掉欄位、depth 留著。
 * 變身圖（T-805）：alt 給合格的 { image, hasAlpha } ＝加上或換一張（只存這兩個欄位）、null＝拿掉；只有立體層、不是文字層、
 * 不是破框層能加（altBlocked）；這層的混合模式要兩張一起看（blendAllowed：沒有透明的變身圖只能放在加深／發光／強光的層）；
 * 加了會超過每張卡 16 張圖 → 不加。擋下變身圖時同一次的其他欄位照樣改。有變身圖的層不能打開衝出卡片
 * （SCHEMA：破框層不能有變身圖；同一次先拿掉變身圖就可以）。
 * 動態特效（T-811）：fx 給要改的欄位（model/fx.ts 的 mergeFx：還沒有特效時要給 kind）、null＝拿掉；破框層加不上、
 * 這一面已經有 MAX_FX_PER_FACE 層有特效時第 3 層加不上（fxBlocked；只改特效的話回原卡）；擋下特效時同一次的其他欄位照樣改。
 * 有特效的層不能打開衝出卡片（同一次先拿掉特效就可以）。
 */
export function updateLayer(card: Card, face: FaceSide, layerId: string, patch: LayerPatch): Card {
  const layers = card[face].layers;
  const index = layers.findIndex((l) => l.id === layerId);
  if (index < 0) return card;
  const old = layers[index];
  let next: Layer = { ...old };

  const name = cleanName(patch.name);
  if (name) next.name = name;
  if (typeof patch.visible === 'boolean') next.visible = patch.visible;
  if (typeof patch.holo === 'boolean') next.holo = patch.holo;
  if (isFiniteNumber(patch.x)) next.x = clamp(patch.x, RANGE.position);
  if (isFiniteNumber(patch.y)) next.y = clamp(patch.y, RANGE.position);
  if (isFiniteNumber(patch.scale)) next.scale = clamp(patch.scale, RANGE.scale);

  const oldOpacity = layerOpacity(old);
  const oldBlend = layerBlend(old);
  let opacity = oldOpacity;
  let blend = oldBlend;
  if (old.role === 'depth') {
    if (isFiniteNumber(patch.opacity)) opacity = clamp(patch.opacity, RANGE.opacity);
    if (isBlendMode(patch.blend) && blendAllowed(old, patch.blend)) blend = patch.blend;
  }
  if (opacity !== oldOpacity || blend !== oldBlend) next = withLook(next, opacity, blend);

  // 變身圖（T-805）：先決定（破框開關要看它）；混合模式不准就不換
  const oldAlt = old.alt;
  let alt = oldAlt;
  if (patch.alt === null) alt = undefined;
  else if (patch.alt !== undefined && altBlocked(old) === null) {
    const wanted = cleanAlt(patch.alt);
    if (wanted && blendAllowed({ role: old.role, hasAlpha: old.hasAlpha, alt: wanted }, blend)) alt = sameAlt(oldAlt, wanted) ? oldAlt : wanted;
  }
  if (alt !== oldAlt) next = withAlt(next, alt ?? null);

  // 動態特效（T-811）：先決定（破框開關要看它）；破框層、這一面已經滿了（還沒有特效的層）就不加
  const oldFx = old.fx;
  let fx = oldFx;
  if (patch.fx === null) fx = undefined;
  else if (patch.fx !== undefined) {
    const wanted = mergeFx(oldFx, patch.fx);
    if (wanted && (oldFx !== undefined || fxBlocked(card[face], index) === null)) fx = sameFx(oldFx, wanted) ? oldFx : wanted;
  }
  if (fx !== oldFx) next = withFx(next, fx);

  const oldBreakout = layerBreakout(old);
  let breakout = old.role === 'depth' && typeof patch.breakout === 'boolean' ? patch.breakout : oldBreakout;
  // 有變身圖或特效的層不能打開衝出卡片（SCHEMA：破框層不能有變身圖、特效）
  if (breakout && !oldBreakout && (alt !== undefined || fx !== undefined)) breakout = oldBreakout;
  if (breakout !== oldBreakout) next = withBreakout(next, breakout);

  const oldLineart = layerLineart(old);
  const lineart = old.role === 'depth' && !old.text && typeof patch.lineart === 'boolean' ? patch.lineart : oldLineart;
  if (lineart !== oldLineart) next = withLineart(next, lineart);

  // 剪裁（T-803）：打開後剪裁不成立就不開（右欄的開關也是變淡、按了不改）
  const oldClip = layerClip(old);
  let clip = old.role === 'depth' && typeof patch.clip === 'boolean' ? patch.clip : oldClip;
  if (clip !== oldClip) {
    const trial = layers.slice();
    trial[index] = withClip(next, clip);
    if (clip && clipParent({ layers: trial }, index) === null) clip = oldClip;
    else next = trial[index]!;
  }

  // 深度：剪裁中的層跟著下面那層（patch 的 depth 不算，下面 syncClipLayers 會對齊）
  if (isFiniteNumber(patch.depth) && old.role === 'depth') {
    const trial = layers.slice();
    trial[index] = next;
    if (clipParent({ layers: trial }, index) === null) next.depth = clamp(patch.depth, RANGE.depth);
  }

  if (
    next.name === old.name &&
    next.visible === old.visible &&
    next.holo === old.holo &&
    next.depth === old.depth &&
    next.x === old.x &&
    next.y === old.y &&
    next.scale === old.scale &&
    opacity === oldOpacity &&
    blend === oldBlend &&
    breakout === oldBreakout &&
    lineart === oldLineart &&
    clip === oldClip &&
    alt === oldAlt &&
    fx === oldFx
  ) {
    return card;
  }

  const nextLayers = layers.slice();
  nextLayers[index] = next;
  let result: Card;
  if (next.depth === old.depth) result = withLayers(card, face, syncClipLayers(nextLayers));
  else {
    // 下面那層改 depth：緊跟在後面的剪裁層一起改（clipRunEnd），穩定排序時整串不會被拆開、相對順序不變
    const end = clipRunEnd(nextLayers, index);
    for (let k = index + 1; k < end; k++) nextLayers[k] = { ...nextLayers[k]!, depth: next.depth };
    result = withLayers(card, face, syncClipLayers(sortByDepth(nextLayers)));
  }
  // 變身圖會讓這張卡超過 16 張圖（T-805）：不加，其他欄位照樣改
  if (alt !== oldAlt && alt !== undefined && tooManyImages(result)) {
    const { alt: _alt, ...rest } = patch;
    return updateLayer(card, face, layerId, rest);
  }
  return result;
}

/**
 * 換掉立體層的圖（T-703b 右欄〔自動去背〕：去背好的圖換上這一層）：同一個 id，只換 image 與 hasAlpha，
 * 名字、位置、大小、深度、不透明度、混合模式、破框、反光、顯示都不變；陣列位置不變。
 * 只對立體層（不是文字層）有效：找不到、底圖、文字層 → 原卡。雜湊不合格、圖和 hasAlpha 都沒變 → 原卡。
 * 換成沒有透明的圖、而這一層的混合模式只能給有透明的圖用（blendAllowed）→ 原卡。
 * 變身圖（T-805）不動：只換本來的圖（混合模式照樣兩張一起看）。
 * 圖片數量：換掉不是新增，舊圖只有這一層在用時張數不變；舊圖還有別人在用、換了會超過每張卡 16 張 → 原卡。
 * 舊圖沒人用了之後照現有的圖片回收機制清掉（這裡不管）。
 */
export function replaceLayerImage(card: Card, face: FaceSide, layerId: string, image: { image: string; hasAlpha: boolean }): Card {
  const layers = card[face].layers;
  const index = layers.findIndex((l) => l.id === layerId);
  if (index < 0) return card;
  const old = layers[index];
  if (old.role !== 'depth' || old.text) return card;
  if (typeof image.image !== 'string' || !IMAGE_HASH.test(image.image) || typeof image.hasAlpha !== 'boolean') return card;
  if (image.image === old.image && image.hasAlpha === old.hasAlpha) return card;
  if (!blendAllowed({ role: 'depth', hasAlpha: image.hasAlpha, alt: old.alt }, layerBlend(old))) return card;
  const nextLayers = layers.slice();
  nextLayers[index] = { ...old, image: image.image, hasAlpha: image.hasAlpha };
  const next = withLayers(card, face, nextLayers);
  return tooManyImages(next) ? card : next;
}

/**
 * 拖拉排序（SCHEMA §1.2）：兩個立體層交換 depth 值，同時交換陣列位置
 * （陣列本來依 depth 排好，交換後仍然排好；depth 相同時等於只交換前後）。
 * 剪裁（T-803）：有剪裁層的層，緊跟在後面的剪裁層整串跟著走（一起換到對方的位置與 depth）；
 * 剪裁中的層本身不能換（任一邊是 → 不變）。
 * 牽涉底圖、找不到、同一層、兩串重疊 → 不變。
 */
export function swapDepth(card: Card, face: FaceSide, layerIdA: string, layerIdB: string): Card {
  if (layerIdA === layerIdB) return card;
  const layers = card[face].layers;
  const i = layers.findIndex((l) => l.id === layerIdA);
  const j = layers.findIndex((l) => l.id === layerIdB);
  if (i < 0 || j < 0) return card;
  const a = layers[i];
  const b = layers[j];
  if (a.role !== 'depth' || b.role !== 'depth') return card;
  if (clipParent(card[face], i) !== null || clipParent(card[face], j) !== null) return card;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  const loEnd = clipRunEnd(layers, lo);
  const hiEnd = clipRunEnd(layers, hi);
  if (hi < loEnd) return card;
  const loDepth = layers[lo]!.depth;
  const hiDepth = layers[hi]!.depth;
  const nextLayers = [
    ...layers.slice(0, lo),
    ...layers.slice(hi, hiEnd).map((l) => ({ ...l, depth: loDepth })),
    ...layers.slice(loEnd, hi),
    ...layers.slice(lo, loEnd).map((l) => ({ ...l, depth: hiDepth })),
    ...layers.slice(hiEnd),
  ];
  return withLayers(card, face, syncClipLayers(nextLayers));
}

/** 置中：x、y 歸 0。 */
export function centerLayer(card: Card, face: FaceSide, layerId: string): Card {
  const layer = findLayer(card, face, layerId);
  if (!layer || (layer.x === 0 && layer.y === 0)) return card;
  return updateLayer(card, face, layerId, { x: 0, y: 0 });
}

/**
 * 填滿：置中＋cover；bleed＝四邊各多放大多少（卡寬單位，由呼叫端算好；底圖一律不加）。
 * 卡高用目前比例。圖片尺寸不合理 → 不變。
 */
export function fillLayer(
  card: Card,
  face: FaceSide,
  layerId: string,
  imageWidth: number,
  imageHeight: number,
  bleed: number,
): Card {
  const layer = findLayer(card, face, layerId);
  if (!layer || !validSize(imageWidth) || !validSize(imageHeight)) return card;
  const scale = coverScale(imageWidth, imageHeight, card, layer.role === 'base' ? 0 : bleed);
  return updateLayer(card, face, layerId, { x: 0, y: 0, scale });
}

// ---- 文字圖層（SCHEMA §1「文字圖層」）：立體層＋text；image 是呼叫端依 text 畫好、走過 ingest 的圖 ----

function oneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return typeof v === 'string' && (options as readonly string[]).includes(v);
}

/** 內容：不是文字或去頭尾空白後是空的 → null；超過 TEXT_CONTENT_MAX 字截掉後面的（截完是空的也算 null）。 */
function cleanTextContent(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = firstChars(v, TEXT_CONTENT_MAX);
  return s.trim() === '' ? null : s;
}

/**
 * 整理一份文字設定：每個欄位都合格才回新物件（只有六個欄位、顏色小寫、內容最多 100 字），否則回 null。
 * 畫字之前先用它整理，畫出來的圖和存進卡片的設定才會一致。
 */
export function cleanTextSpec(v: unknown): TextSpec | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const get = (key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);
  const content = cleanTextContent(get('content'));
  const font = get('font');
  const color = hexColor(get('color'));
  const align = get('align');
  const vertical = get('vertical');
  const style = get('style');
  if (content === null || color === null || typeof vertical !== 'boolean') return null;
  if (!oneOf(font, TEXT_FONTS) || !oneOf(align, TEXT_ALIGNS) || !oneOf(style, TEXT_STYLES)) return null;
  return { content, font, color, align, vertical, style };
}

/** 舊設定＋要改的欄位（undefined 不算）→ 整理好的新設定；任何一個不合格就回 null（呼叫端不改）。 */
export function mergeTextSpec(old: TextSpec, patch: Partial<TextSpec>): TextSpec | null {
  const merged: Record<string, unknown> = { ...old };
  for (const key of TEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) merged[key] = patch[key];
  }
  return cleanTextSpec(merged);
}

/** 文字圖層的名字＝內容的前 20 字（換行與連續空白變一個空格、去頭尾空白）。 */
export function textLayerName(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, TEXT_NAME_MAX).join('').trim() || DEFAULT_TEXT_LAYER_NAME;
}

function sameText(a: TextSpec, b: TextSpec): boolean {
  return TEXT_KEYS.every((k) => a[k] === b[k]);
}

/**
 * 加一個文字圖層到這一面：立體層（有透明、會反光）、x 0／y 0.55／scale 1、depth 照立體層的自動規則、
 * name＝內容前 20 字。每面已有 8 層、CD 光碟的背面（T-810）→ face-full；id／雜湊／文字設定／尺寸不合格 → invalid-input（優先）。
 */
export function addTextLayer(card: Card, face: FaceSide, input: NewTextLayerInput): AddLayerResult {
  const text = cleanTextSpec(input.text);
  if (!text || !isNewIdAndImage(card, input.id, input.image) || !validSize(input.width) || !validSize(input.height)) {
    return { ok: false, reason: 'invalid-input' };
  }
  const layers = card[face].layers;
  if (layers.length >= MAX_LAYERS_PER_FACE || noLayersHere(card, face)) return { ok: false, reason: 'face-full' };
  const layer: Layer = {
    id: input.id,
    name: textLayerName(text.content),
    role: 'depth',
    image: input.image,
    visible: true,
    depth: nextDepth(layers),
    x: 0,
    y: TEXT_LAYER_Y,
    scale: 1,
    holo: true,
    hasAlpha: true,
    text,
  };
  const next = withLayers(card, face, [...layers, layer]);
  return tooManyImages(next) ? { ok: false, reason: 'too-many-images' } : { ok: true, card: next, layerId: layer.id };
}

/**
 * 改文字圖層：換新設定與新圖，兩個要一起給（見 TextLayerUpdate）：
 * - 沒給新圖 → 回原卡（不管設定有沒有改：改了設定圖卻沒換，字和畫出來的圖就對不上）。
 * - 有給新圖，但 text 不是完整、合格的設定（少欄位、值不合格）→ 回原卡；多給的欄位（含 width／height）不會存進去。
 * 名字原本是自動取的（＝舊內容前 20 字）就跟著新內容換，使用者自己改過就不動。
 * 雜湊不合格、不是文字圖層、找不到、整理後的設定和圖都沒變 → 回原卡。
 */
export function updateTextLayer(card: Card, face: FaceSide, layerId: string, update: TextLayerUpdate): Card {
  const layers = card[face].layers;
  const index = layers.findIndex((l) => l.id === layerId);
  if (index < 0) return card;
  const old = layers[index];
  if (!old.text) return card;

  // 型別已經要求兩個都給；這裡是最後一道防線（沒給新圖、雜湊不對、設定不完整或不合格都不改）
  if (typeof update.image !== 'string' || !IMAGE_HASH.test(update.image)) return card;
  const text = cleanTextSpec(update.text);
  if (!text) return card;
  // 匯入的卡可能有大寫顏色：舊設定也整理過再比，沒改東西就不要多一步
  const oldText = cleanTextSpec(old.text) ?? old.text;
  const name = old.name === textLayerName(oldText.content) ? textLayerName(text.content) : old.name;

  if (sameText(text, oldText) && update.image === old.image && name === old.name) return card;
  const nextLayers = layers.slice();
  nextLayers[index] = { ...old, name, image: update.image, text };
  const next = withLayers(card, face, nextLayers);
  // 舊圖還有別層在用、又已經 16 張圖時，新圖放不下（T-417）
  return tooManyImages(next) ? card : next;
}

// ---- 卡片 ----

function hexColor(v: unknown): string | null {
  return typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : null;
}

function nextFrame(old: Frame, patch: Partial<Frame> | undefined): Frame {
  if (!patch) return old;
  let next: Frame = { ...old };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (isFiniteNumber(patch.width)) next.width = clamp(patch.width, RANGE.frameWidth);
  const c = hexColor(patch.color);
  if (c) next.color = c;
  if (isFiniteNumber(patch.shine)) next.shine = clamp(patch.shine, RANGE.frameShine);
  // 樣式（T-416）：二選一；簡約＝預設值，拿掉欄位（不寫 undefined，存進資料庫才不會被擋）
  const oldStyle = frameStyle(old);
  const style = oneOf(patch.style, FRAME_STYLES) ? patch.style : oldStyle;
  if (style !== oldStyle) {
    const { style: _s, ...rest } = next;
    next = style === 'simple' ? rest : { ...rest, style };
  }
  return next.enabled === old.enabled &&
    next.width === old.width &&
    next.color === old.color &&
    next.shine === old.shine &&
    style === oldStyle
    ? old
    : next;
}

/** 自訂色彩：剛好 HOLO_COLOR_COUNT 個合格顏色才回新陣列（小寫），否則 null。逐格讀，稀疏陣列的空格也擋得到。 */
function holoColors(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length !== HOLO_COLOR_COUNT) return null;
  const out: string[] = [];
  for (let i = 0; i < HOLO_COLOR_COUNT; i++) {
    const c = hexColor(v[i]);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function sameColors(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function nextHolo(old: Holo, patch: Partial<Holo> | undefined): Holo {
  if (!patch) return old;
  let next: Holo = { ...old };
  if (isFiniteNumber(patch.strength)) next.strength = clamp(patch.strength, RANGE.holoStrength);
  if (isFiniteNumber(patch.bandWidth)) next.bandWidth = clamp(patch.bandWidth, RANGE.holoBandWidth);
  if (isFiniteNumber(patch.sparkle)) next.sparkle = clamp(patch.sparkle, RANGE.holoSparkle);
  if (oneOf(patch.palette, HOLO_PALETTE_IDS)) next.palette = patch.palette;
  const colors = holoColors(patch.colors);
  // 和現在一樣（大小寫不同也算）就保留原本的陣列，沒有改變時才能回傳原物件
  if (colors && !sameColors(colors, old.colors)) next.colors = colors;
  // 霧光（T-417）：夾在 0～100；等於預設值 35 時拿掉欄位（不寫 undefined，存進資料庫才不會被擋）
  const oldMatte = holoMatte(old);
  const matte = isFiniteNumber(patch.matte) ? clamp(patch.matte, RANGE.holoMatte) : oldMatte;
  if (matte !== oldMatte) {
    const { matte: _m, ...rest } = next;
    next = matte === DEFAULT_MATTE ? rest : { ...rest, matte };
  }
  return next.strength === old.strength &&
    next.bandWidth === old.bandWidth &&
    next.sparkle === old.sparkle &&
    next.palette === old.palette &&
    next.colors === old.colors &&
    matte === oldMatte
    ? old
    : next;
}

function nextShadow(old: Shadow, patch: Partial<Shadow> | undefined): Shadow {
  if (!patch) return old;
  const next: Shadow = { ...old };
  if (isFiniteNumber(patch.strength)) next.strength = clamp(patch.strength, RANGE.shadowStrength);
  if (isFiniteNumber(patch.distance)) next.distance = clamp(patch.distance, RANGE.shadowDistance);
  return next.strength === old.strength && next.distance === old.distance ? old : next;
}

/**
 * 透明卡套開著嗎（T-806，SCHEMA view.sleeve?）：只有 true 算開（省略、明寫 false 都是關）。
 * CD 光碟（T-810）不套卡套：欄位照存，但一律算關（畫面、匯出選單都照這個）。
 */
export function sleeveOn(card: Pick<Card, 'view' | 'kind'>): boolean {
  return card.view.sleeve === true && !isDisc(card);
}

/**
 * 舞台背景圖（T-814，SCHEMA view.backdrop?）：換上這張（圖片雜湊；加上或換一張）／null＝拿掉（拿掉欄位，不寫 undefined）。
 * 不合格的雜湊、會超過每張卡 16 張圖 → 不改；沒有改變回原卡（同一個物件）。一次呼叫＝一步（呼叫端記步）。
 */
export function setBackdrop(card: Card, image: string | null): Card {
  const old = card.view.backdrop;
  if (image === null) {
    if (old === undefined && !Object.prototype.hasOwnProperty.call(card.view, 'backdrop')) return card;
    const { backdrop: _b, ...rest } = card.view;
    return { ...card, view: rest };
  }
  if (typeof image !== 'string' || !IMAGE_HASH.test(image) || image === old) return card;
  const next: Card = { ...card, view: { ...card.view, backdrop: image } };
  return tooManyImages(next) ? card : next;
}

// ---- 前景圖（T-830，SCHEMA view.foreground?）----

/**
 * 前景圖：加上（剛加上擺在 DEFAULT_FOREGROUND：左下角、大小 1、模糊 40）／換一張（位置、大小、模糊照舊）／null＝拿掉（拿掉欄位，不寫 undefined）。
 * 不合格的雜湊、會超過每張卡 16 張圖 → 不改；沒有改變回原卡（同一個物件）。一次呼叫＝一步（呼叫端記步）。
 */
export function setForeground(card: Card, image: string | null): Card {
  const old = card.view.foreground;
  if (image === null) {
    if (old === undefined && !Object.prototype.hasOwnProperty.call(card.view, 'foreground')) return card;
    const { foreground: _f, ...rest } = card.view;
    return { ...card, view: rest };
  }
  if (typeof image !== 'string' || !IMAGE_HASH.test(image)) return card;
  const was = foregroundOf(card);
  if (was?.image === image) return card;
  const { image: _i, ...place } = was ?? { image, ...DEFAULT_FOREGROUND };
  const next: Card = { ...card, view: { ...card.view, foreground: { image, ...place } } };
  return tooManyImages(next) ? card : next;
}

/** 前景圖的一個數字欄位：有限數字就夾範圍（blur 再取整數，+ 0 去掉 −0），不然用 fallback。 */
function fgField(v: unknown, range: { min: number; max: number }, fallback: number, integer = false): number {
  if (!isFiniteNumber(v)) return fallback;
  const c = clamp(v, range);
  return integer ? Math.round(c) + 0 : c;
}

/**
 * 這張卡的前景圖（T-830）：省略、雜湊不合格（不該發生，驗證會擋）＝null；數字欄位壞了各自夾範圍或用 DEFAULT_FOREGROUND，不丟錯。
 * 回的是新的物件（改它不影響卡片）。
 */
export function foregroundOf(card: Pick<Card, 'view'>): Foreground | null {
  const o = farObject(card.view.foreground);
  if (!o || typeof o.image !== 'string' || !IMAGE_HASH.test(o.image)) return null;
  const d = DEFAULT_FOREGROUND;
  return {
    image: o.image,
    x: fgField(o.x, RANGE.foregroundPos, d.x),
    y: fgField(o.y, RANGE.foregroundPos, d.y),
    scale: fgField(o.scale, RANGE.foregroundScale, d.scale),
    blur: fgField(o.blur, RANGE.foregroundBlur, d.blur, true),
  };
}

/**
 * 改前景圖的位置、大小、模糊（nextView 用）：沒有前景圖、patch 不是物件 → 不改；有限數字才收（x、y、scale 夾範圍、照 0.01 四捨五入，
 * 同遠景位置的 roundFar；blur 夾範圍、取整數），image 不理；和原本一樣回原本的物件。沒有「預設＝省略」：置中（0, 0）也留著欄位。
 */
function nextForeground(old: Foreground | undefined, patch: unknown): Foreground | undefined {
  const o = farObject(patch);
  const was = foregroundOf({ view: { foreground: old } as CardView });
  if (!o || !was) return old;
  const pick = (v: unknown, range: { min: number; max: number }, fallback: number) => (isFiniteNumber(v) ? roundFar(clamp(v, range)) : fallback);
  const next: Foreground = {
    image: was.image,
    x: pick(o.x, RANGE.foregroundPos, was.x),
    y: pick(o.y, RANGE.foregroundPos, was.y),
    scale: pick(o.scale, RANGE.foregroundScale, was.scale),
    blur: fgField(o.blur, RANGE.foregroundBlur, was.blur, true),
  };
  return next.x === was.x && next.y === was.y && next.scale === was.scale && next.blur === was.blur ? old : next;
}

/**
 * 水鏡的遠景（T-815，SCHEMA view.waterScene?）：省略＝湖光山峰；壞資料（不該發生，驗證會擋）也當湖光山峰。
 * 其他舞台、有背景圖時照樣回這張卡選的那種（畫不畫由畫面決定）。
 */
export function waterSceneOf(card: Pick<Card, 'view'>): WaterScene {
  const scene = card.view.waterScene;
  return oneOf(scene, WATER_SCENES) ? scene : DEFAULT_WATER_SCENE;
}

// ---- 遠景的位置與大小（T-822，SCHEMA view.farPan?）----

/** 1 ÷ FAR_PAN_STEP（＝100）：乘上去取整數再除回來。 */
const FAR_PAN_PER = Math.round(1 / FAR_PAN_STEP);

/**
 * 照 FAR_PAN_STEP（0.01）十進位四捨五入、正負對稱（剛好一半往遠離 0 進位；T-822 審查）：先用 toPrecision(12) 去掉
 * 1.005 × 100 ＝ 100.49999… 這類浮點誤差再取整；+ 0 把 −0 變成 0（存檔與比較都不會有 −0）。
 */
function roundFar(v: number): number {
  const scaled = Number((Math.abs(v) * FAR_PAN_PER).toPrecision(12));
  return (Math.sign(v) * Math.round(scaled)) / FAR_PAN_PER + 0;
}

/** 等於預設值 {0,0,1} 嗎（等於時拿掉欄位）。 */
function isDefaultFarPan(p: FarPan): boolean {
  return p.x === DEFAULT_FAR_PAN.x && p.y === DEFAULT_FAR_PAN.y && p.zoom === DEFAULT_FAR_PAN.zoom;
}

/** 一個欄位：有限數字就夾範圍，不然用 fallback。 */
function farField(v: unknown, range: { min: number; max: number }, fallback: number): number {
  return isFiniteNumber(v) ? clamp(v, range) : fallback;
}

/**
 * 這張卡遠景的位置與大小（T-822）：省略＝{0,0,1}；壞資料（不該發生，驗證會擋）每個欄位各自夾範圍或用預設值，不丟錯。
 * 不管看不看得到遠景都照回（畫不畫由畫面決定）。
 */
export function farPanOf(card: Pick<Card, 'view'>): FarPan {
  return cleanFarPan(card.view.farPan);
}

/** 物件（不是陣列）才讀欄位。 */
function farObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function cleanFarPan(p: unknown): FarPan {
  const o = farObject(p);
  if (!o) return { ...DEFAULT_FAR_PAN };
  return {
    x: farField(o.x, RANGE.farPan, DEFAULT_FAR_PAN.x),
    y: farField(o.y, RANGE.farPan, DEFAULT_FAR_PAN.y),
    zoom: farField(o.zoom, RANGE.farZoom, DEFAULT_FAR_PAN.zoom),
  };
}

/**
 * 改遠景位置（nextView 用）：patch 只給要改的欄位，有限數字才收（夾範圍、照 0.01 四捨五入），其他欄位照舊（沒有欄位時從 {0,0,1} 開始）。
 * 回 undefined＝{0,0,1}（拿掉欄位）；和原本一樣回原本的物件（含 undefined）。
 */
function nextFarPan(old: FarPan | undefined, patch: unknown): FarPan | undefined {
  const o = farObject(patch);
  if (!o) return old;
  const was = cleanFarPan(old);
  const pick = (v: unknown, range: { min: number; max: number }, fallback: number) => (isFiniteNumber(v) ? roundFar(clamp(v, range)) : fallback);
  const next: FarPan = { x: pick(o.x, RANGE.farPan, was.x), y: pick(o.y, RANGE.farPan, was.y), zoom: pick(o.zoom, RANGE.farZoom, was.zoom) };
  if (next.x === was.x && next.y === was.y && next.zoom === was.zoom) return old;
  return isDefaultFarPan(next) ? undefined : next;
}

// ---- 水鏡的水面樣子（T-825，SCHEMA view.waterLook?）----

/** 六個滑桿的欄位（0～100 的整數）與兩個顏色欄位。 */
const WATER_LOOK_NUMBERS = ['mist', 'streak', 'glint', 'ripple', 'lift', 'horizon'] as const;
const WATER_LOOK_COLORS = ['mistColor', 'glintColor'] as const;

/** 一個數字欄位：有限數字就夾範圍、四捨五入成整數（+ 0 去掉 −0），不然用 fallback。 */
function lookNumber(v: unknown, fallback: number): number {
  return isFiniteNumber(v) ? Math.round(clamp(v, RANGE.waterLook)) + 0 : fallback;
}

/** 整理成完整的一組：每個欄位各自夾範圍、取整、顏色轉小寫，壞的欄位用 base 的值（預設＝〔夜色〕）。 */
function cleanWaterLook(v: unknown, base: Readonly<WaterLook> = DEFAULT_WATER_LOOK): WaterLook {
  const o = farObject(v);
  const look: WaterLook = { ...base };
  if (!o) return look;
  for (const k of WATER_LOOK_NUMBERS) look[k] = lookNumber(o[k], base[k]);
  for (const k of WATER_LOOK_COLORS) look[k] = hexColor(o[k]) ?? base[k];
  return look;
}

function sameWaterLook(a: Readonly<WaterLook>, b: Readonly<WaterLook>): boolean {
  return WATER_LOOK_NUMBERS.every((k) => a[k] === b[k]) && WATER_LOOK_COLORS.every((k) => a[k].toLowerCase() === b[k].toLowerCase());
}

function isDefaultWaterLook(look: Readonly<WaterLook>): boolean {
  return sameWaterLook(look, DEFAULT_WATER_LOOK);
}

/**
 * 這張卡的水面樣子（T-825）：省略＝〔夜色〕（DEFAULT_WATER_LOOK 的一份新的副本）；壞資料（不該發生，驗證會擋）每個欄位各自
 * 夾範圍、取整或用預設值，不丟錯。不管是不是水鏡都照回（畫不畫由畫面決定）。
 */
export function waterLookOf(card: Pick<Card, 'view'>): WaterLook {
  return cleanWaterLook(card.view.waterLook);
}

/**
 * 改水面樣子（nextView 用）：patch 只給要改的欄位（快速套用給整組），數字要是有限數字（夾 0～100、四捨五入成整數）、
 * 顏色要是 #rrggbb（存小寫），不合格的欄位不改；其他欄位照舊（沒有欄位時從〔夜色〕開始）。
 * 回 undefined＝〔夜色〕（拿掉欄位）；和原本一樣回原本的物件（含 undefined）。
 */
function nextWaterLook(old: WaterLook | undefined, patch: unknown): WaterLook | undefined {
  const o = farObject(patch);
  if (!o) return old;
  const was = cleanWaterLook(old);
  const next = cleanWaterLook(o, was);
  if (sameWaterLook(next, was)) return old;
  return isDefaultWaterLook(next) ? undefined : next;
}

/**
 * 改 view（updateCard 用）：舞台背景圖不在這裡改（patch 帶了也不理，用 setBackdrop）。
 * 前景圖（T-830）：只改位置、大小、模糊，見 nextForeground（加、換、拿掉用 setForeground）。
 * 水鏡遠景（T-815）：換成水墨山、富士山寫進欄位；選回湖光山峰拿掉欄位（不寫 undefined）；和現在一樣（含明寫 'lake' 的舊卡選湖光山峰）不改。
 * 遠景位置（T-822）：見 nextFarPan；回到 {0,0,1} 時拿掉欄位（不寫 undefined）。
 * 水面樣子（T-825）：見 nextWaterLook；回到〔夜色〕時拿掉欄位（不寫 undefined）。
 */
function nextView(old: CardView, patch: CardPatch['view']): CardView {
  if (!patch) return old;
  let next: CardView = { ...old };
  if (typeof patch.returnToFront === 'boolean') next.returnToFront = patch.returnToFront;
  if (typeof patch.showcase === 'boolean') next.showcase = patch.showcase;
  if (oneOf(patch.stage, STAGE_STYLES)) next.stage = patch.stage;
  // 透明卡套（T-806）：開＝true；關＝拿掉欄位（不寫 undefined，存進資料庫才不會被擋）
  const oldSleeve = old.sleeve === true;
  const sleeve = typeof patch.sleeve === 'boolean' ? patch.sleeve : oldSleeve;
  if (sleeve !== oldSleeve) {
    const { sleeve: _s, ...rest } = next;
    next = sleeve ? { ...rest, sleeve: true } : rest;
  }
  const oldScene = waterSceneOf({ view: old });
  const scene = oneOf(patch.waterScene, WATER_SCENES) ? patch.waterScene : oldScene;
  if (scene !== oldScene) {
    const { waterScene: _w, ...rest } = next;
    next = scene === DEFAULT_WATER_SCENE ? rest : { ...rest, waterScene: scene };
  }
  const farPan = nextFarPan(old.farPan, patch.farPan);
  if (farPan !== old.farPan) {
    const { farPan: _p, ...rest } = next;
    next = farPan ? { ...rest, farPan } : rest;
  }
  const waterLook = nextWaterLook(old.waterLook, patch.waterLook);
  if (waterLook !== old.waterLook) {
    const { waterLook: _l, ...rest } = next;
    next = waterLook ? { ...rest, waterLook } : rest;
  }
  const foreground = nextForeground(old.foreground, patch.foreground);
  if (foreground !== old.foreground) next = { ...next, foreground };
  return next.returnToFront === old.returnToFront &&
    next.showcase === old.showcase &&
    next.stage === old.stage &&
    sleeve === oldSleeve &&
    scene === oldScene &&
    farPan === old.farPan &&
    waterLook === old.waterLook &&
    foreground === old.foreground
    ? old
    : next;
}

/**
 * 改卡片屬性：名字（空白不改）、比例（圖層 x／y／scale 不變，SCHEMA §1.3）、卡身色、圓角、卡框（含光澤、樣式）、
 * 鐳射（含色彩選項與自訂的 4 色、霧光）、陰影、view、卡片故事（T-804，見 CardPatch.story）。反光層是每一面各自的，用 updateFoil。
 * 數值夾範圍、NaN 忽略、不合格式的顏色或選項忽略（自訂色彩不是剛好 4 個合格顏色就整組不改）；顏色存成小寫。
 */
export function updateCard(card: Card, patch: CardPatch): Card {
  const name = cleanName(patch.name) || card.name;
  const { aspect, customAspect } = nextShape(card, patch);
  const bodyColor = hexColor(patch.bodyColor) ?? card.bodyColor;
  const cornerRadius = isFiniteNumber(patch.cornerRadius) ? clamp(patch.cornerRadius, RANGE.cornerRadius) : card.cornerRadius;
  const frame = nextFrame(card.frame, patch.frame);
  const holo = nextHolo(card.holo, patch.holo);
  const shadow = nextShadow(card.shadow, patch.shadow);
  const view = nextView(card.view, patch.view);
  const story = nextStory(card.story, patch.story);

  if (
    name === card.name &&
    aspect === card.aspect &&
    customAspect === card.customAspect &&
    bodyColor === card.bodyColor &&
    cornerRadius === card.cornerRadius &&
    frame === card.frame &&
    holo === card.holo &&
    shadow === card.shadow &&
    view === card.view &&
    story === card.story
  ) {
    return card;
  }
  // 沒有故事、不是自訂比例時拿掉欄位（不寫 undefined，存進資料庫才不會被擋）
  const { story: _story, customAspect: _custom, ...rest } = card;
  const next: Card = { ...rest, name, aspect, bodyColor, cornerRadius, frame, holo, shadow, view };
  if (customAspect) next.customAspect = customAspect;
  if (story) next.story = story;
  return next;
}

/**
 * 比例（T-807）：patch 的 aspect 與 customAspect 一起看。回傳的 customAspect 沒變時是原本的物件（才能回傳原卡）。
 * CD 光碟（T-810）：比例不能改（一律不變）。
 * - 換成預設比例 → 沒有 customAspect；
 * - 結果是自訂（換成自訂，或本來就是自訂而只給 customAspect）→ 要有合格的寬高：patch 給的優先，沒給就沿用原本的；
 *   都沒有合格的 → 比例整個不改。
 */
function nextShape(card: Card, patch: CardPatch): { aspect: Card['aspect']; customAspect: CustomAspect | undefined } {
  const keep = { aspect: card.aspect, customAspect: card.customAspect };
  // CD 光碟（T-810）一律正方形：比例不能改
  if (isDisc(card)) return keep;
  const aspect = oneOf(patch.aspect, ASPECTS) ? patch.aspect : card.aspect;
  if (aspect !== 'custom') return aspect === card.aspect ? keep : { aspect, customAspect: undefined };
  const p = patch.customAspect;
  if (p !== undefined) {
    if (customAspectProblem(p?.width, p?.height) !== null) return keep;
    const old = card.aspect === 'custom' ? card.customAspect : undefined;
    if (old && old.width === p.width && old.height === p.height) return keep;
    return { aspect, customAspect: { width: p.width, height: p.height } };
  }
  // 沒給寬高：本來就是自訂＝不變；從別的比例換成自訂卻沒有寬高＝不合格，不改
  return keep;
}
