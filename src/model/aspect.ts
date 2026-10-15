// 卡片比例（T-807，SCHEMA Card.aspect／customAspect?、DESIGN「卡片比例」）：卡片的「高／寬」只在這裡算。
// 其他模組（render 的網格與鏡頭、擷取、舞台、卡片故事、縮圖、介面的小卡片外形…）一律用 aspectHeight，不各自 switch。
import { ASPECT_HEIGHT, type Aspect, type Card, type CustomAspect, type PresetAspect } from './types';

/** 卡片的形狀：比例＋自訂寬高＋物件種類（T-810：光碟是正方形的圓；Card 本身就是一個 CardShape）。 */
export type CardShape = Pick<Card, 'aspect' | 'customAspect' | 'kind'>;

/** 是不是 CD 光碟（T-810，SCHEMA Card.kind?）：只有明寫 'disc' 才算（省略、'card' 都是卡片）。 */
export function isDisc(card: Pick<Card, 'kind'>): boolean {
  return card.kind === 'disc';
}

/** 五種比例（右欄、新卡片面板的順序）。 */
export const ASPECTS = ['standard', 'tarot', 'square', 'postcard', 'custom'] as const satisfies readonly Aspect[];

/**
 * 自訂寬高的規則（SCHEMA）：寬、高各是 1～999 的整數（單位隨意，只看比例）；
 * 高／寬在 0.5～2.0（含兩端，也就是 1:2～2:1；太扁或太長的卡不給）。
 */
export const CUSTOM_ASPECT = {
  side: { min: 1, max: 999 },
  ratio: { min: 0.5, max: 2 },
} as const;

/** 預設比例的整數寬高（自訂框的起始值：從這個比例換成自訂時形狀不變）。 */
const PRESET_SIZE: Record<PresetAspect, Readonly<CustomAspect>> = {
  standard: { width: 63, height: 88 },
  tarot: { width: 70, height: 120 },
  square: { width: 1, height: 1 },
  postcard: { width: 100, height: 148 },
};

/** 預設比例的整數寬高（複本）。 */
export function presetAspectSize(aspect: PresetAspect): CustomAspect {
  const s = PRESET_SIZE[aspect];
  return { width: s.width, height: s.height };
}

/** 卡片形狀的整數寬高：自訂就是使用者打的，其他是那個比例的寬高（自訂框顯示用）。 */
export function aspectSize(shape: CardShape): CustomAspect {
  if (shape.aspect === 'custom') {
    const c = shape.customAspect;
    if (c && customAspectProblem(c.width, c.height) === null) return { width: c.width, height: c.height };
    return presetAspectSize('standard');
  }
  return presetAspectSize(shape.aspect);
}

function isSide(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= CUSTOM_ASPECT.side.min && v <= CUSTOM_ASPECT.side.max;
}

/**
 * 自訂寬高哪裡不合格：'side'＝寬或高不是 1～999 的整數；'ratio'＝太扁或太長（高／寬不在 0.5～2.0）；合格回 null。
 * 都是整數，用乘法比，不會有小數誤差（1:2、2:1 剛好合格）。
 */
export function customAspectProblem(width: unknown, height: unknown): 'side' | 'ratio' | null {
  if (!isSide(width) || !isSide(height)) return 'side';
  // 高／寬 ≥ 0.5 ⇔ 2·高 ≥ 寬；高／寬 ≤ 2 ⇔ 高 ≤ 2·寬
  if (2 * height < width || height > 2 * width) return 'ratio';
  return null;
}

/**
 * 卡片的高／寬（以卡寬為 1，也就是卡高）。自訂用使用者的寬高；資料不合格（驗證會擋，正常不會發生）時照標準卡，
 * 不讓網格或鏡頭變成 NaN。
 */
export function aspectHeight(shape: CardShape): number {
  if (shape.aspect === 'custom') {
    const c = shape.customAspect;
    return c && customAspectProblem(c.width, c.height) === null ? c.height / c.width : ASPECT_HEIGHT.standard;
  }
  return ASPECT_HEIGHT[shape.aspect] ?? ASPECT_HEIGHT.standard;
}
