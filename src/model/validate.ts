// 卡片資料驗證（SCHEMA.md §1.1）。載入與匯入都要過；輸入當成不可信資料：
// 任何輸入都只回錯誤清單（空陣列＝合格），不丟例外。錯誤格式：「欄位路徑：說明」。
// 錯誤最多列 MAX_ERRORS 條，超過就停止檢查並加一條「還有更多錯誤」；訊息裡引用到的（不認得的）欄位名稱截到 FIELD_NAME_MAX 字。
import {
  CARD_KINDS,
  FOIL_SHAPES,
  FRAME_STYLES,
  FX_KINDS,
  HEX_COLOR,
  HOLO_COLOR_COUNT,
  HOLO_PALETTE_IDS,
  ID_MAX,
  IMAGE_HASH,
  MAX_CARD_IMAGES,
  NAME_MAX,
  RANGE,
  STAGE_STYLES,
  STORY_MAX,
  STORY_MAX_LINES,
  TEXT_ALIGNS,
  TEXT_CONTENT_MAX,
  TEXT_FONTS,
  TEXT_STYLES,
  WATER_SCENES,
  exceedsLength,
  isFiniteNumber,
  nameLength,
  type Range,
} from './limits';
import { ASPECTS, CUSTOM_ASPECT, customAspectProblem } from './aspect';
import { BLEND_MODES, MAX_FX_PER_FACE, MAX_LAYERS_PER_FACE, OPAQUE_LAYER_BLENDS, type LayerRole } from './types';

type Obj = Record<string, unknown>;
type Check = (value: unknown, path: string, errors: string[]) => void;

const ROLES = ['base', 'depth'] as const satisfies readonly LayerRole[];
/** 年-月-日 T 時:分:秒 [.小數] (Z | ±時:分)；括號是給 isRealTime 取數字用的。 */
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** 最多列幾條錯誤（第 51 條起不再收集）。 */
const MAX_ERRORS = 50;
/** 訊息裡引用的欄位名稱最多幾個字（匯入的檔案可能塞很長的欄位名）。 */
const FIELD_NAME_MAX = 40;
const MORE_ERRORS = `還有更多錯誤（只列出前 ${MAX_ERRORS} 條）`;
/** 錯誤數到上限時丟出來中止檢查的記號，validateCard 會接住。 */
const STOP = Object.freeze({});

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 只讀自己的欄位，不讀原型鏈上的。 */
function own(obj: Obj, key: string): unknown {
  return hasOwn(obj, key) ? obj[key] : undefined;
}

function at(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** 欄位名稱太長就截到 FIELD_NAME_MAX 字再加「…」（以字計，表情符號算一個；不用掃完整個超長字串）。 */
function clip(key: string): string {
  if (key.length <= FIELD_NAME_MAX) return key;
  let out = '';
  let count = 0;
  for (const ch of key) {
    if (count === FIELD_NAME_MAX) return `${out}…`;
    out += ch;
    count += 1;
  }
  return out;
}

/** 記一條錯誤；已經有 MAX_ERRORS 條時，改加「還有更多錯誤」並中止整個檢查。 */
function report(errors: string[], message: string): void {
  if (errors.length >= MAX_ERRORS) {
    errors.push(MORE_ERRORS);
    throw STOP;
  }
  errors.push(message);
}

// ---- 單一欄位的檢查 ----

const finite: Check = (v, path, errors) => {
  if (typeof v !== 'number') report(errors, `${path}：要是數字`);
  else if (!Number.isFinite(v)) report(errors, `${path}：要是有限的數字`);
};

const num =
  (range: Range): Check =>
  (v, path, errors) => {
    const before = errors.length;
    finite(v, path, errors);
    if (errors.length === before && ((v as number) < range.min || (v as number) > range.max)) {
      report(errors, `${path}：要在 ${range.min}～${range.max} 之間`);
    }
  };

const bool: Check = (v, path, errors) => {
  if (typeof v !== 'boolean') report(errors, `${path}：要是 true 或 false`);
};

const text =
  (min: number, max: number): Check =>
  (v, path, errors) => {
    if (typeof v !== 'string') report(errors, `${path}：要是文字`);
    else if (exceedsLength(v, max) || nameLength(v) < min) report(errors, `${path}：長度要在 ${min}～${max} 字`);
  };

/** 名字：1～max 字，而且去頭尾空白後不能是空的（和 actions 的 cleanName 一致）。 */
const nameText =
  (max: number): Check =>
  (v, path, errors) => {
    const before = errors.length;
    text(1, max)(v, path, errors);
    if (errors.length === before && typeof v === 'string' && v.trim() === '') report(errors, `${path}：不能只有空白`);
  };

const color: Check = (v, path, errors) => {
  if (typeof v !== 'string' || !HEX_COLOR.test(v)) report(errors, `${path}：顏色要是 #rrggbb`);
};

const oneOf =
  (options: readonly string[]): Check =>
  (v, path, errors) => {
    if (typeof v !== 'string' || !options.includes(v)) report(errors, `${path}：要是 ${options.join('／')} 其中之一`);
  };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** ISO 時間格式，而且日期時間真的存在（2 月 30 日、第 24 小時、第 60 分都不行）。 */
function isRealTime(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const m = ISO_TIME.exec(v);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12) return false;
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > days) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return !Number.isNaN(Date.parse(v));
}

const time: Check = (v, path, errors) => {
  if (!isRealTime(v)) report(errors, `${path}：要是 ISO 時間`);
};

const exactly =
  (expected: number): Check =>
  (v, path, errors) => {
    if (v !== expected) report(errors, `${path}：要是 ${expected}`);
  };

/** 剛好 count 個 #rrggbb 的陣列（鐳射的自訂色彩）：個數不對只報整個欄位，個數對才逐格檢查（稀疏陣列的空格也算錯）。 */
const colorList =
  (count: number): Check =>
  (v, path, errors) => {
    if (!Array.isArray(v)) report(errors, `${path}：要是 ${count} 個顏色的清單`);
    else if (v.length !== count) report(errors, `${path}：要剛好 ${count} 個顏色（現在 ${v.length} 個）`);
    else for (let i = 0; i < count; i++) color(v[i], `${path}[${i}]`, errors);
  };

/** range 裡的整數（動態特效的強度、速度，T-811）。 */
const int =
  (range: Range): Check =>
  (v, path, errors) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < range.min || v > range.max) {
      report(errors, `${path}：要是 ${range.min}～${range.max} 的整數`);
    }
  };

const imageFormat: Check = (v, path, errors) => {
  if (typeof v !== 'string' || !IMAGE_HASH.test(v)) report(errors, `${path}：圖片代碼要是 16 碼小寫十六進位`);
};

/**
 * 物件只能有這些欄位：多的報「不認得」、少的報「缺少」，其餘照各自規則檢查。不是物件就回 null。
 * optional：可有可無的欄位（例如圖層的 text），有的話照規則檢查、沒有不報錯。
 */
function checkObject(
  v: unknown,
  fields: Record<string, Check>,
  path: string,
  errors: string[],
  optional: Record<string, Check> = {},
): Obj | null {
  if (!isObj(v)) {
    report(errors, `${path || '卡片'}：要是物件`);
    return null;
  }
  for (const key of Object.keys(v)) {
    if (!hasOwn(fields, key) && !hasOwn(optional, key)) report(errors, `${at(path, clip(key))}：不認得的欄位`);
  }
  for (const key of Object.keys(fields)) {
    if (!hasOwn(v, key)) report(errors, `${at(path, key)}：缺少欄位`);
    else fields[key](v[key], at(path, key), errors);
  }
  for (const key of Object.keys(optional)) {
    if (hasOwn(v, key)) optional[key](v[key], at(path, key), errors);
  }
  return v;
}

const object =
  (fields: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, path, errors) => {
    checkObject(v, fields, path, errors, optional);
  };

/** 圖片存在嗎（hasImage 由呼叫端注入；丟例外也當成找不到）。 */
function imageExists(hasImage: (hash: string) => boolean, hash: string): boolean {
  try {
    return hasImage(hash) === true;
  } catch {
    return false;
  }
}

// ---- 結構 ----

const LAYER_FIELDS: Record<string, Check> = {
  id: text(1, ID_MAX),
  name: nameText(NAME_MAX),
  role: oneOf(ROLES),
  image: imageFormat,
  visible: bool,
  depth: finite, // 範圍依角色不同，在 checkLayers 裡檢查
  x: num(RANGE.position),
  y: num(RANGE.position),
  scale: num(RANGE.scale),
  holo: bool,
  hasAlpha: bool,
};

/** 文字圖層的 text（SCHEMA §1「文字圖層」）：內容 1～100 字、去頭尾空白後不能是空的。 */
const TEXT_FIELDS: Record<string, Check> = {
  content: nameText(TEXT_CONTENT_MAX),
  font: oneOf(TEXT_FONTS),
  color,
  align: oneOf(TEXT_ALIGNS),
  vertical: bool,
  style: oneOf(TEXT_STYLES),
};

/**
 * 圖層可有可無的欄位：有 text＝文字圖層；opacity 省略＝100、blend 省略＝normal（T-408，舊卡沒有這兩個欄位）；
 * breakout 省略＝false（T-411）；lineart 省略＝false（T-802）；clip 省略＝false（T-803）；
 * alt 省略＝沒有變身圖（T-805：只有 image、hasAlpha 兩個欄位；圖在不在、誰能有在 checkLayers 裡檢查）；
 * fx 省略＝沒有動態特效（T-811：種類、顏色、強度、速度四個欄位；破框層不能有、每一面最多幾層在 checkLayers 裡檢查）。
 */
const LAYER_OPTIONAL: Record<string, Check> = {
  text: object(TEXT_FIELDS),
  opacity: num(RANGE.opacity),
  blend: oneOf(BLEND_MODES),
  breakout: bool,
  lineart: bool,
  clip: bool,
  alt: object({ image: imageFormat, hasAlpha: bool }),
  fx: object({ kind: oneOf(FX_KINDS), color, strength: int(RANGE.fxStrength), speed: int(RANGE.fxSpeed) }),
};

const FRAME_FIELDS: Record<string, Check> = {
  enabled: bool,
  width: num(RANGE.frameWidth),
  color,
  shine: num(RANGE.frameShine),
};

/** 卡框可有可無的欄位：樣式 style 省略＝簡約（T-416，舊卡沒有這個欄位）。 */
const FRAME_OPTIONAL: Record<string, Check> = {
  style: oneOf(FRAME_STYLES),
};

const HOLO_FIELDS: Record<string, Check> = {
  strength: num(RANGE.holoStrength),
  bandWidth: num(RANGE.holoBandWidth),
  sparkle: num(RANGE.holoSparkle),
  palette: oneOf(HOLO_PALETTE_IDS),
  colors: colorList(HOLO_COLOR_COUNT),
};

/**
 * 鐳射可有可無的欄位：霧光 matte 省略＝35（T-417）。舊的範圍 scope 已經拿掉（讀進來時由 model/foil.ts 的 migrateCard 轉換），
 * 驗證時還有 scope＝不認得的欄位。
 */
const HOLO_OPTIONAL: Record<string, Check> = {
  matte: num(RANGE.holoMatte),
};

const SHADOW_FIELDS: Record<string, Check> = {
  strength: num(RANGE.shadowStrength),
  distance: num(RANGE.shadowDistance),
};

const VIEW_FIELDS: Record<string, Check> = {
  returnToFront: bool,
  showcase: bool,
  stage: oneOf(STAGE_STYLES),
};

/**
 * view 可有可無的欄位：透明卡套 sleeve 省略＝關（T-806，舊卡沒有這個欄位）；
 * 舞台背景圖 backdrop 省略＝沒有（T-814：格式在這裡檢查，圖在不在在 checkStageImages）；
 * 水鏡遠景 waterScene 省略＝湖光山峰（T-815：三選一，明寫 'lake' 也合格；其他舞台、光碟照樣可以有）；
 * 遠景位置 farPan 省略＝{0,0,1}（T-822：三個有限數字、在範圍裡、不能多欄位；沒四捨五入到 0.01 的也收，明寫預設值也合格；
 * 任何舞台、光碟、沒有背景圖照樣可以有）；
 * 水面樣子 waterLook 省略＝〔夜色〕（T-825：六個 0～100 的整數＋兩個 #rrggbb、不能多欄位；明寫預設值也合格；任何舞台、光碟照樣可以有）；
 * 前景圖 foreground 省略＝沒有（T-830：image 合格雜湊〔圖在不在在 checkStageImages〕、x、y −1～1、scale 0.5～3 的有限數字、
 * blur 0～100 的整數、不能多欄位；沒四捨五入到 0.01 的也收；任何舞台、光碟照樣可以有）。
 */
const VIEW_OPTIONAL: Record<string, Check> = {
  sleeve: bool,
  backdrop: imageFormat,
  waterScene: oneOf(WATER_SCENES),
  farPan: object({ x: num(RANGE.farPan), y: num(RANGE.farPan), zoom: num(RANGE.farZoom) }),
  waterLook: object({
    mist: int(RANGE.waterLook),
    mistColor: color,
    streak: int(RANGE.waterLook),
    glint: int(RANGE.waterLook),
    glintColor: color,
    ripple: int(RANGE.waterLook),
    lift: int(RANGE.waterLook),
    horizon: int(RANGE.waterLook),
  }),
  foreground: object({
    image: imageFormat,
    x: num(RANGE.foregroundPos),
    y: num(RANGE.foregroundPos),
    scale: num(RANGE.foregroundScale),
    blur: int(RANGE.foregroundBlur),
  }),
};

/** 卡片故事的文字（T-804）：1～60 字、去頭尾空白後不能是空的、最多 2 行（\r\n、\r、\n 都算換行）。 */
const storyText: Check = (v, path, errors) => {
  const before = errors.length;
  nameText(STORY_MAX)(v, path, errors);
  if (errors.length === before && typeof v === 'string' && v.split(/\r\n|\r|\n/, STORY_MAX_LINES + 1).length > STORY_MAX_LINES) {
    report(errors, `${path}：最多 ${STORY_MAX_LINES} 行`);
  }
};

/** 自訂比例的寬或高（T-807）：1～999 的整數。 */
const aspectSide: Check = (v, path, errors) => {
  const { min, max } = CUSTOM_ASPECT.side;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) report(errors, `${path}：要是 ${min}～${max} 的整數`);
};

/**
 * 卡片可有可無的欄位：卡片故事 story 省略＝沒有故事（T-804，舊卡沒有這個欄位）；
 * 自訂比例的寬高 customAspect（T-807）：欄位本身在這裡檢查，跟 aspect 的搭配（自訂一定要有、其他不能有）與比例在 checkShape。
 */
const CARD_OPTIONAL: Record<string, Check> = {
  story: object({ text: storyText, font: oneOf(TEXT_FONTS) }),
  customAspect: object({ width: aspectSide, height: aspectSide }),
  kind: oneOf(CARD_KINDS),
};

/**
 * 比例與自訂寬高的搭配（T-807，SCHEMA Card.customAspect?）：aspect 'custom' 時一定要有 customAspect、
 * 高／寬在 0.5～2.0；其他比例時不能有。aspect 本身不認得已經在欄位檢查報過，這裡不再報。
 */
function checkShape(card: unknown, errors: string[]): void {
  if (!isObj(card)) return;
  const aspect = own(card, 'aspect');
  const has = hasOwn(card, 'customAspect');
  if (aspect === 'custom') {
    if (!has) {
      report(errors, 'customAspect：比例是自訂時要有寬和高');
      return;
    }
    const c = own(card, 'customAspect');
    // 寬高不是整數之類的已經報過；兩個都合格才看比例
    if (isObj(c) && customAspectProblem(own(c, 'width'), own(c, 'height')) === 'ratio') {
      const { min, max } = CUSTOM_ASPECT.ratio;
      report(errors, `customAspect：太扁或太長（高／寬要在 ${min}～${max}）`);
    }
  } else if (has && typeof aspect === 'string' && (ASPECTS as readonly string[]).includes(aspect)) {
    report(errors, 'customAspect：只有自訂比例才能有寬和高');
  }
}

/**
 * CD 光碟（T-810，SCHEMA Card.kind?）：比例一定是正方形（自訂也不行；自訂寬高的錯在 checkShape 另外報）、
 * 背面一定沒有圖層（背面是銀色資料面）。kind 不認得、aspect 不認得已經在欄位檢查報過，這裡不再報。
 */
function checkKind(card: unknown, errors: string[]): void {
  if (!isObj(card) || own(card, 'kind') !== 'disc') return;
  const aspect = own(card, 'aspect');
  if (aspect !== 'square' && typeof aspect === 'string' && (ASPECTS as readonly string[]).includes(aspect)) {
    report(errors, 'aspect：光碟的比例一定是正方形（square）');
  }
  const back = own(card, 'back');
  const layers = isObj(back) ? own(back, 'layers') : undefined;
  if (Array.isArray(layers) && layers.length > 0) report(errors, 'back.layers：光碟的背面是資料面，不能放圖層');
}

/**
 * 反光層（T-417，SCHEMA §1「反光層」）：shape 四選一、frame 是布林、mask（可有可無）是合格雜湊而且圖片存在；
 * shape 'mask' 時一定要有 mask。不認得的欄位照樣報錯。
 */
function checkFoil(v: unknown, path: string, errors: string[], hasImage: (hash: string) => boolean): void {
  const foil = checkObject(v, { shape: oneOf(FOIL_SHAPES), frame: bool }, path, errors, { mask: imageFormat });
  if (!foil) return;
  const mask = own(foil, 'mask');
  if (own(foil, 'shape') === 'mask' && !hasOwn(foil, 'mask')) report(errors, `${path}.mask：形狀是黑白圖時要有圖`);
  if (typeof mask === 'string' && IMAGE_HASH.test(mask) && !imageExists(hasImage, mask)) {
    report(errors, `${path}.mask：找不到這張圖片`);
  }
}

/**
 * 舞台背景圖（T-814，SCHEMA view.backdrop?）與前景圖（T-830，view.foreground?.image）：格式合格的才看圖在不在
 * （格式不對已經在欄位檢查報過）。
 */
function checkStageImages(card: unknown, errors: string[], hasImage: (hash: string) => boolean): void {
  if (!isObj(card)) return;
  const view = own(card, 'view');
  if (!isObj(view)) return;
  const backdrop = own(view, 'backdrop');
  if (typeof backdrop === 'string' && IMAGE_HASH.test(backdrop) && !imageExists(hasImage, backdrop)) {
    report(errors, 'view.backdrop：找不到這張圖片');
  }
  const fg = own(view, 'foreground');
  const fgImage = isObj(fg) ? own(fg, 'image') : undefined;
  if (typeof fgImage === 'string' && IMAGE_HASH.test(fgImage) && !imageExists(hasImage, fgImage)) {
    report(errors, 'view.foreground.image：找不到這張圖片');
  }
}

/**
 * 卡片用到幾張不同的圖（兩面的圖層、圖層的變身圖〔T-805〕＋反光層的黑白圖＋舞台背景圖〔T-814〕＋前景圖〔T-830〕；
 * 只算格式合格的雜湊，壞的已經另外報錯）。
 */
function countImages(card: unknown): number {
  const hashes = new Set<string>();
  if (!isObj(card)) return 0;
  const add = (image: unknown) => {
    if (typeof image === 'string' && IMAGE_HASH.test(image)) hashes.add(image);
  };
  const view = own(card, 'view');
  if (isObj(view)) {
    add(own(view, 'backdrop'));
    const fg = own(view, 'foreground');
    if (isObj(fg)) add(own(fg, 'image'));
  }
  for (const key of ['front', 'back']) {
    const face = own(card, key);
    if (!isObj(face)) continue;
    const layers = own(face, 'layers');
    if (Array.isArray(layers)) {
      for (const layer of layers) {
        if (!isObj(layer)) continue;
        add(own(layer, 'image'));
        const alt = own(layer, 'alt');
        if (isObj(alt)) add(own(alt, 'image'));
      }
    }
    const foil = own(face, 'foil');
    const mask = isObj(foil) ? own(foil, 'mask') : undefined;
    if (typeof mask === 'string' && IMAGE_HASH.test(mask)) hashes.add(mask);
  }
  return hashes.size;
}

function checkLayers(
  v: unknown,
  path: string,
  errors: string[],
  usedIds: Set<string>,
  hasImage: (hash: string) => boolean,
): void {
  if (!Array.isArray(v)) {
    report(errors, `${path}：要是陣列`);
    return;
  }
  if (v.length > MAX_LAYERS_PER_FACE) {
    report(errors, `${path}：每一面最多 ${MAX_LAYERS_PER_FACE} 層（現在 ${v.length} 層）`);
    return;
  }
  let bases = 0;
  let effects = 0;
  let lastDepth: number | null = null;
  for (let i = 0; i < v.length; i++) {
    const lp = `${path}[${i}]`;
    const layer = checkObject(v[i], LAYER_FIELDS, lp, errors, LAYER_OPTIONAL);
    if (!layer) continue;
    const id = own(layer, 'id');
    const role = own(layer, 'role');
    const image = own(layer, 'image');
    const depth = own(layer, 'depth');

    if (role === 'base') {
      bases += 1;
      if (i !== 0) report(errors, `${lp}：底圖要在第 0 個`);
    }

    if (isFiniteNumber(depth)) {
      if (role === 'base') {
        if (depth !== 0) report(errors, `${lp}.depth：底圖的深度要是 0`);
      } else if (role === 'depth') {
        if (depth < RANGE.depth.min || depth > RANGE.depth.max) {
          report(errors, `${lp}.depth：立體層的深度要在 ${RANGE.depth.min}～${RANGE.depth.max}`);
        }
      } else if (depth < 0 || depth > RANGE.depth.max) {
        report(errors, `${lp}.depth：深度要在 0～${RANGE.depth.max}`);
      }
      if (lastDepth !== null && depth < lastDepth) report(errors, `${lp}.depth：圖層要依深度由小到大排`);
      lastDepth = depth;
    }

    // 底圖固定正常、100（T-408）、不能破框（T-411）、不能沿線條反光（T-802）、不能剪裁（T-803）：連預設值也不能寫
    if (role === 'base') {
      if (hasOwn(layer, 'opacity')) report(errors, `${lp}.opacity：底圖不能調不透明度`);
      if (hasOwn(layer, 'blend')) report(errors, `${lp}.blend：底圖不能換混合模式`);
      if (hasOwn(layer, 'breakout')) report(errors, `${lp}.breakout：底圖不能破框`);
      if (hasOwn(layer, 'lineart')) report(errors, `${lp}.lineart：底圖不能沿線條反光`);
      if (hasOwn(layer, 'clip')) report(errors, `${lp}.clip：底圖不能剪裁`);
    }
    // 線稿高光（T-802）：文字層也不能有（連 false 也不行）
    if (role !== 'base' && hasOwn(layer, 'text') && hasOwn(layer, 'lineart')) report(errors, `${lp}.lineart：文字圖層不能沿線條反光`);

    // 變身圖（T-805）：底圖、文字層、破框層不能有（欄位在就算，連空的也不行）；沒有透明的變身圖同本來的圖的混合模式限制；圖要存在
    if (hasOwn(layer, 'alt')) {
      const alt = own(layer, 'alt');
      const altImage = isObj(alt) ? own(alt, 'image') : undefined;
      if (role === 'base') report(errors, `${lp}.alt：底圖不能有變身圖`);
      else if (hasOwn(layer, 'text')) report(errors, `${lp}.alt：文字圖層不能有變身圖`);
      else if (own(layer, 'breakout') === true) report(errors, `${lp}.alt：衝出卡片的層不能有變身圖`);
      else if (role === 'depth' && isObj(alt) && own(alt, 'hasAlpha') === false) {
        const blend = hasOwn(layer, 'blend') ? own(layer, 'blend') : 'normal';
        if (typeof blend === 'string' && (BLEND_MODES as readonly string[]).includes(blend) && !(OPAQUE_LAYER_BLENDS as readonly string[]).includes(blend)) {
          report(errors, `${lp}.alt.hasAlpha：沒有透明的變身圖只能用在混合模式是 ${OPAQUE_LAYER_BLENDS.join('／')} 的立體層`);
        }
      }
      if (typeof altImage === 'string' && IMAGE_HASH.test(altImage) && !imageExists(hasImage, altImage)) {
        report(errors, `${lp}.alt.image：找不到這張圖片`);
      }
    }

    // 動態特效（T-811）：破框層不能有（欄位在就算）；每一面最多 MAX_FX_PER_FACE 層（迴圈後檢查）
    if (hasOwn(layer, 'fx')) {
      effects += 1;
      if (own(layer, 'breakout') === true) report(errors, `${lp}.fx：衝出卡片的層不能有特效`);
    }

    // 沒有透明的立體層：文字圖層一律不行；其他要用加深／發光／強光（T-408）。
    // blend 填了不認得的值已經在上面報過，不再重複報 hasAlpha。
    if (role === 'depth' && own(layer, 'hasAlpha') === false) {
      const blend = hasOwn(layer, 'blend') ? own(layer, 'blend') : 'normal';
      if (hasOwn(layer, 'text')) report(errors, `${lp}.hasAlpha：文字圖層要有透明`);
      else if (typeof blend === 'string' && (BLEND_MODES as readonly string[]).includes(blend)) {
        if (!(OPAQUE_LAYER_BLENDS as readonly string[]).includes(blend)) {
          report(errors, `${lp}.hasAlpha：沒有透明的圖只能當底圖，或當混合模式是 ${OPAQUE_LAYER_BLENDS.join('／')} 的立體層`);
        }
      }
    }

    // 文字圖層＝立體層＋text：role 要是 depth、hasAlpha 要是 true（depth 而沒有透明已在上面報過，不重複報）
    if (hasOwn(layer, 'text')) {
      if (role === 'base') report(errors, `${lp}.role：文字圖層要是立體層（depth）`);
      if (role !== 'depth' && own(layer, 'hasAlpha') === false) report(errors, `${lp}.hasAlpha：文字圖層要有透明`);
    }

    if (typeof image === 'string' && IMAGE_HASH.test(image) && !imageExists(hasImage, image)) {
      report(errors, `${lp}.image：找不到這張圖片`);
    }

    if (typeof id === 'string' && id.length > 0) {
      if (usedIds.has(id)) report(errors, `${lp}.id：圖層 id 重複`);
      else usedIds.add(id);
    }
  }
  if (bases > 1) report(errors, `${path}：每一面最多一個底圖`);
  if (effects > MAX_FX_PER_FACE) report(errors, `${path}：每一面最多 ${MAX_FX_PER_FACE} 層有特效（現在 ${effects} 層）`);
}

/**
 * 照 SCHEMA §1.1 檢查卡片資料；回傳錯誤說明清單（空陣列＝合格；最多 MAX_ERRORS 條，
 * 還有更多時第 MAX_ERRORS＋1 條是「還有更多錯誤」）。
 * hasImage(hash)：圖片存不存在由呼叫端注入（登記簿、資料庫或匯入的壓縮檔）；反光層的黑白圖也檢查（T-417）。
 * 舊卡（有 holo.scope，T-417 以前）要先用 model/foil.ts 的 migrateCard 轉換再驗，不然 scope 會被當成不認得的欄位。
 *
 * 只接受 `JSON.parse` 或 `structuredClone` 的結果（單純的資料物件）。
 * 不保證能擋住 getter／Proxy 這類「活物件」：它們每次讀取可以給不同的值（驗的時候合格、用的時候不合格）。
 * 匯入的檔案一律先 JSON.parse 再驗，不要直接拿別人給的物件來驗。
 */
export function validateCard(card: unknown, hasImage: (hash: string) => boolean): string[] {
  const errors: string[] = [];
  try {
    const usedIds = new Set<string>();
    const face = object(
      { layers: (v, path, errs) => checkLayers(v, path, errs, usedIds, hasImage) },
      { foil: (v, path, errs) => checkFoil(v, path, errs, hasImage) },
    );
    checkObject(
      card,
      {
        formatVersion: exactly(1),
        id: text(1, ID_MAX),
        name: nameText(NAME_MAX),
        createdAt: time,
        updatedAt: time,
        aspect: oneOf(ASPECTS),
        bodyColor: color,
        cornerRadius: num(RANGE.cornerRadius),
        front: face,
        back: face,
        frame: object(FRAME_FIELDS, FRAME_OPTIONAL),
        holo: object(HOLO_FIELDS, HOLO_OPTIONAL),
        shadow: object(SHADOW_FIELDS),
        view: object(VIEW_FIELDS, VIEW_OPTIONAL),
      },
      '',
      errors,
      CARD_OPTIONAL,
    );
    checkShape(card, errors);
    checkKind(card, errors);
    checkStageImages(card, errors, hasImage);
    // 每張卡最多 16 張不同的圖（反光層的黑白圖也算，T-417；背景圖也算，T-814；前景圖也算，T-830；卡片檔最多放 16 張圖，SCHEMA §4）
    const images = countImages(card);
    if (images > MAX_CARD_IMAGES) {
      report(errors, `卡片：圖片最多 ${MAX_CARD_IMAGES} 張（兩面的圖層、變身圖、反光層的黑白圖加舞台背景圖、前景圖，現在 ${images} 張）`);
    }
  } catch (e) {
    if (e !== STOP) {
      // 讀欄位時丟了例外（getter、Proxy…）。已經滿了就補「還有更多錯誤」，不再丟出去。
      if (errors.length >= MAX_ERRORS) errors.push(MORE_ERRORS);
      else errors.push('卡片：資料讀取失敗');
    }
  }
  return errors;
}
