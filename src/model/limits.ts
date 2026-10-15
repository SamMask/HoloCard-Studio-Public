// 數值範圍與格式（SCHEMA.md §1）：validate 與 actions 共用同一份，不各寫一次。
import type { CardKind, FarPan, FoilShape, FrameStyle, FxKind, HoloPalette, StageStyle, TextAlign, TextFont, TextStyle, WaterLook, WaterScene } from './types';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export const RANGE = {
  /** 立體層的 depth；底圖固定 0。 */
  depth: { min: 1, max: 100 },
  /** 圖層 x／y。 */
  position: { min: -1, max: 1 },
  scale: { min: 0.05, max: 4 },
  cornerRadius: { min: 0, max: 0.12 },
  frameWidth: { min: 0.01, max: 0.08 },
  holoStrength: { min: 0, max: 100 },
  holoBandWidth: { min: 0.1, max: 2 },
  holoSparkle: { min: 0, max: 100 },
  /** 卡框光澤、陰影濃淡、陰影距離（T-310）。 */
  frameShine: { min: 0, max: 100 },
  shadowStrength: { min: 0, max: 100 },
  shadowDistance: { min: 0, max: 100 },
  /** 圖層不透明度（T-408）；省略＝100。 */
  opacity: { min: 0, max: 100 },
  /** 霧光（T-417）；省略＝35。 */
  holoMatte: { min: 0, max: 100 },
  /** 動態特效的強度、速度（T-811，整數）。 */
  fxStrength: { min: 0, max: 100 },
  fxSpeed: { min: 0, max: 100 },
  /** 遠景的位置 x、y（T-822，SCHEMA view.farPan?）：0＝置中、±1＝圖的邊對齊畫面邊。 */
  farPan: { min: -1, max: 1 },
  /** 遠景的大小（T-822）：1＝剛好蓋滿。 */
  farZoom: { min: 1, max: 3 },
  /** 水鏡的水面樣子（T-825，SCHEMA view.waterLook?）：霧、倒影拉長、閃光、波紋、卡片高度、地平線都是這個範圍的整數。 */
  waterLook: { min: 0, max: 100 },
  /** 前景圖的位置 x、y（T-830，SCHEMA view.foreground?）：0＝圖的中心在畫面正中間、±1＝在畫面邊上。 */
  foregroundPos: { min: -1, max: 1 },
  /** 前景圖的大小（T-830）：1＝預設大小。 */
  foregroundScale: { min: 0.5, max: 3 },
  /** 前景圖的模糊（T-830，整數）。 */
  foregroundBlur: { min: 0, max: 100 },
} as const satisfies Record<string, Range>;

/**
 * 剛加上前景圖時的位置、大小、模糊（T-830，DESIGN §5「前景圖」：預設擺在左下角，不要一放就蓋住卡片中間；模糊 40）。
 * 換一張圖時沿用原本的（不回到這組）。
 */
export const DEFAULT_FOREGROUND: Readonly<{ x: number; y: number; scale: number; blur: number }> = Object.freeze({ x: -0.7, y: -0.6, scale: 1, blur: 40 });

/** 遠景的位置與大小省略時＝置中、剛好蓋滿（T-822；等於它時拿掉 view.farPan、寫出時省略）。 */
export const DEFAULT_FAR_PAN: Readonly<FarPan> = Object.freeze({ x: 0, y: 0, zoom: 1 });
/** 遠景的位置與大小存成幾位小數（T-822：照 0.01 四捨五入）。 */
export const FAR_PAN_STEP = 0.01;

/**
 * 水面樣子的〔夜色〕（T-825，省略 view.waterLook 的值；等於它時拿掉欄位、寫出時省略）＝T-825 以前的水鏡：
 * 沒有霧（以前沒有霧蓋在遠景上）、霧色＝以前水鏡夜空在水平線那一帶的顏色（style.css 的 .stage.is-water）、
 * 清楚的鏡面、沒有閃光（閃光色先放暖金）、波紋 50＝以前的漣漪與細波紋、卡片高度 30＝以前的 WATER_GAP（0.06 卡寬）、地平線 100＝以前的鏡頭高度。
 * 換算在 render/water-layout.ts（波紋 ÷ 50 倍、卡片高度 × 0.06 ÷ 30、地平線 100＝鏡頭在卡片中間高度）。
 */
export const DEFAULT_WATER_LOOK: Readonly<WaterLook> = Object.freeze({
  mist: 0,
  mistColor: '#17326a',
  streak: 0,
  glint: 0,
  glintColor: '#ffc56b',
  ripple: 50,
  lift: 30,
  horizon: 100,
});

/**
 * 〔霧白〕（T-825，使用者給的四張「霧中水面」參考圖的樣子）：霧濃、霧色淡灰白、倒影往下拉長碎成橫紋、暖金的小閃光、
 * 卡片站在水上（卡片高度 0）、地平線低（視線貼近水面）、水面比較平靜。數字在三張範例卡（星晶龍、霓虹信使、月下幽舞）上和參考圖並排看過才定
 * （T-825c 重調：霧 88＝遠景只剩淡淡的影子、閃光 80 集中在倒影那一條、波紋 25）。
 */
export const MIST_WATER_LOOK: Readonly<WaterLook> = Object.freeze({
  mist: 88,
  mistColor: '#d3d8cf',
  streak: 80,
  glint: 80,
  glintColor: '#ffc56b',
  ripple: 25,
  lift: 0,
  horizon: 0,
});

/** 右欄「水面」的兩顆快速套用（T-825）：〔夜色〕〔霧白〕。 */
export const WATER_LOOK_PRESETS = Object.freeze({ night: DEFAULT_WATER_LOOK, mist: MIST_WATER_LOOK });

/** 圖層不透明度與混合模式的預設值（T-408）：等於預設值時不寫出欄位（舊卡、舊卡片檔一模一樣）。 */
export const DEFAULT_OPACITY = 100;

/** 霧光的預設值（T-417，SCHEMA §1「反光層」）：等於預設值時不寫出 holo.matte。 */
export const DEFAULT_MATTE = 35;

/** 反光層的形狀（T-417）。 */
export const FOIL_SHAPES = ['full', 'layers', 'mask', 'none'] as const satisfies readonly FoilShape[];

/** 每張卡最多幾張不同的圖（兩面的圖層＋反光層的黑白圖；卡片檔最多 16 張圖，SCHEMA §4）。 */
export const MAX_CARD_IMAGES = 16;

/** 鐳射色彩選項（SCHEMA §1「鐳射色彩」）；custom 用 holo.colors。 */
export const HOLO_PALETTE_IDS = ['warm', 'classic', 'silver', 'gold', 'aurora', 'galaxy', 'custom'] as const satisfies readonly HoloPalette[];
/** 自訂色彩剛好幾個顏色。 */
export const HOLO_COLOR_COUNT = 4;

/** 卡框樣式（SCHEMA §1 的 frame.style，T-416）：簡約、雕花邊角；省略＝simple（寫出時省略）。 */
export const FRAME_STYLES = ['simple', 'ornate'] as const satisfies readonly FrameStyle[];

/** 物件種類（SCHEMA §1 的 Card.kind?，T-810）：卡片、CD 光碟；省略＝card（寫出時省略）。 */
export const CARD_KINDS = ['card', 'disc'] as const satisfies readonly CardKind[];

/** 動態特效的種類（SCHEMA §1 的 Layer.fx?，T-811）：火焰、電光、水波。 */
export const FX_KINDS = ['fire', 'electric', 'water'] as const satisfies readonly FxKind[];

/** 卡片下方的舞台特效（SCHEMA §1 的 view.stage，T-314；T-832 多工作桌 desk）。 */
export const STAGE_STYLES = ['halo', 'gallery', 'magic', 'water', 'nebula', 'desk', 'none'] as const satisfies readonly StageStyle[];

/** 水鏡的遠景（SCHEMA §1 的 view.waterScene?，T-815）：湖光山峰、水墨山、富士山；畫面上照這個順序。 */
export const WATER_SCENES = ['lake', 'ink', 'fuji'] as const satisfies readonly WaterScene[];
/** 省略 view.waterScene ＝湖光山峰（寫出時省略）。 */
export const DEFAULT_WATER_SCENE: WaterScene = 'lake';

/** 卡片與圖層名字最多幾個字（以 Unicode 字元計，表情符號算一個）。 */
export const NAME_MAX = 60;
/** id 長度上限（SCHEMA 沒寫；UUID 是 36 字，留寬一點擋異常資料）。 */
export const ID_MAX = 100;

/** 文字圖層（SCHEMA §1「文字圖層」）：內容最多幾個字（含換行；以 Unicode 字元計）。 */
export const TEXT_CONTENT_MAX = 100;
/** 文字圖層的名字＝內容的前幾個字。 */
export const TEXT_NAME_MAX = 20;
export const TEXT_FONTS = ['wenkai', 'huninn', 'iansui', 'notoserif'] as const satisfies readonly TextFont[];
export const TEXT_ALIGNS = ['start', 'center', 'end'] as const satisfies readonly TextAlign[];
export const TEXT_STYLES = ['plain', 'outline', 'seal'] as const satisfies readonly TextStyle[];

/** 卡片故事（T-804，SCHEMA Card.story?）：最多幾個字（含換行，以 Unicode 字元計）、最多幾行。 */
export const STORY_MAX = 60;
export const STORY_MAX_LINES = 2;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const IMAGE_HASH = /^[0-9a-f]{16}$/;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function clamp(v: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, v));
}

export function nameLength(s: string): number {
  return Array.from(s).length;
}

/**
 * 字數是不是超過 max。一個字最多佔 2 個 UTF-16 單位，所以 s.length > max × 2 一定超過，
 * 直接回 true、不用建整個陣列（匯入的檔案可能塞幾百萬字的字串）。
 */
export function exceedsLength(s: string, max: number): boolean {
  return s.length > max * 2 || nameLength(s) > max;
}

/**
 * 取前 max 個字（以 Unicode 字元計）。逐字走、拿夠了就停，不把整串拆成陣列
 * （匯入或貼上的字串可能有幾百萬字）；沒超過 max 字就原樣回傳。
 */
export function firstChars(s: string, max: number): string {
  let count = 0;
  let end = 0;
  for (const ch of s) {
    if (count === max) return s.slice(0, end);
    count += 1;
    end += ch.length;
  }
  return s;
}

/** 去頭尾空白、截到 NAME_MAX 字；不是字串或只有空白就回空字串。 */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return firstChars(raw.trim(), NAME_MAX).trim();
}
