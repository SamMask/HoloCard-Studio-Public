// 一鍵卡片風格（T-801）：把鐳射色彩、強度、色帶、閃星、霧光、卡框顏色與光澤、反光層形狀這些現有設定，
// 一次換成一組（普通／銀箔／彩虹箔／金箔／銀河／霧面）。不加新欄位、不改 SCHEMA：套完就是一張普通的卡，之後照樣能一項一項微調。
// 純 TS，不碰 DOM。數值都走 updateCard／updateFoil（夾範圍、驗證），不繞過。
import { updateCard, updateFoil, type CardPatch } from './actions';
import { faceFoil, holoMatte } from './foil';
import type { Card, FaceSide, FoilShape, HoloPalette } from './types';

export type CardStyle = 'plain' | 'silver' | 'rainbow' | 'gold' | 'galaxy' | 'matte';

/** 六種風格，畫面上的順序。 */
export const CARD_STYLES: readonly CardStyle[] = ['plain', 'silver', 'rainbow', 'gold', 'galaxy', 'matte'];

/**
 * 一種風格要換掉的設定；沒寫的欄位（「不變」）完全不碰。
 * 反光層只換形狀（兩面都換；上傳過的遮罩圖、「卡框也反光」都保留）。
 * 沒寫的還有：卡框開關、樣式、粗細、卡身顏色、圓角、陰影、舞台、展示擺動、自訂色彩、圖層。
 */
export interface CardStyleValues {
  /** 鐳射強度 0～100；0＝鐳射、閃星、霧光一起關。 */
  strength: number;
  palette?: Exclude<HoloPalette, 'custom'>;
  bandWidth?: number;
  sparkle?: number;
  /** 霧光 0～100。 */
  matte?: number;
  /** 卡框顏色與光澤（「普通」不寫：只關鐳射、不動卡框，T-801 審查）。 */
  frameColor?: string;
  frameShine?: number;
  /** 兩面反光層的形狀。 */
  foil?: FoilShape;
}

export const CARD_STYLE_VALUES: Readonly<Record<CardStyle, Readonly<CardStyleValues>>> = {
  // 「普通」只把強度設 0：其他鐳射設定與卡框都保留，之後把強度拉回來就是原本的樣子
  plain: { strength: 0 },
  silver: { strength: 70, palette: 'silver', bandWidth: 0.8, sparkle: 20, matte: 20, frameColor: '#d8dbe2', frameShine: 70, foil: 'full' },
  rainbow: { strength: 75, palette: 'classic', bandWidth: 1, sparkle: 30, matte: 35, frameColor: '#d8dbe2', frameShine: 60, foil: 'full' },
  gold: { strength: 70, palette: 'gold', bandWidth: 0.9, sparkle: 25, matte: 30, frameColor: '#d4af37', frameShine: 75, foil: 'full' },
  galaxy: { strength: 80, palette: 'galaxy', bandWidth: 1.4, sparkle: 80, matte: 25, frameColor: '#16161a', frameShine: 60, foil: 'full' },
  // 整面都是霧光（不是亮面鐳射）
  matte: { strength: 35, palette: 'warm', bandWidth: 1.6, sparkle: 0, matte: 70, frameColor: '#ffffff', frameShine: 20, foil: 'none' },
};

const FACES: readonly FaceSide[] = ['front', 'back'];

/**
 * 把一種風格套到卡片上。已經是這個風格（和 matchCardStyle 同一個判斷：大寫色碼、滑桿的浮點誤差都算一樣）或沒有任何改變時
 * 回傳原卡（同一個物件，才不會多記一步，T-801 審查）。
 */
export function applyCardStyle(card: Card, style: CardStyle): Card {
  const v = CARD_STYLE_VALUES[style];
  if (sameValues(card, v)) return card;
  const holo: NonNullable<CardPatch['holo']> = { strength: v.strength };
  if (v.palette !== undefined) holo.palette = v.palette;
  if (v.bandWidth !== undefined) holo.bandWidth = v.bandWidth;
  if (v.sparkle !== undefined) holo.sparkle = v.sparkle;
  if (v.matte !== undefined) holo.matte = v.matte;
  // 卡框只換顏色與光澤，不替使用者打開它（沒寫就不動）
  const frame: NonNullable<CardPatch['frame']> = {};
  if (v.frameColor !== undefined) frame.color = v.frameColor;
  if (v.frameShine !== undefined) frame.shine = v.frameShine;
  let next = updateCard(card, { holo, frame });
  if (v.foil !== undefined) {
    for (const face of FACES) next = updateFoil(next, face, { shape: v.foil });
  }
  return next;
}

/** 色帶寬度滑桿的浮點誤差（0.8 拖出 0.8000000000000002）不算微調過。 */
const BAND_EPSILON = 0.001;

function sameValues(card: Card, v: Readonly<CardStyleValues>): boolean {
  const { holo, frame } = card;
  return (
    holo.strength === v.strength &&
    (v.palette === undefined || holo.palette === v.palette) &&
    (v.bandWidth === undefined || Math.abs(holo.bandWidth - v.bandWidth) < BAND_EPSILON) &&
    (v.sparkle === undefined || holo.sparkle === v.sparkle) &&
    (v.matte === undefined || holoMatte(holo) === v.matte) &&
    (v.frameColor === undefined || frame.color.toLowerCase() === v.frameColor) &&
    (v.frameShine === undefined || frame.shine === v.frameShine) &&
    (v.foil === undefined || FACES.every((face) => faceFoil(card[face]).shape === v.foil))
  );
}

/** 目前的設定剛好等於哪一種風格（沒寫的「不變」欄位不比）；微調過、或本來就不是，回 null。 */
export function matchCardStyle(card: Card): CardStyle | null {
  return CARD_STYLES.find((style) => sameValues(card, CARD_STYLE_VALUES[style])) ?? null;
}
