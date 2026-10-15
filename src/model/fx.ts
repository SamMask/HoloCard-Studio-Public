// 局部動態特效（T-811，SCHEMA §1 Layer.fx?、DESIGN「局部動態特效」）的資料規則：預設值、誰能加、每一面最多幾層、改設定時怎麼合。
// 純 TS，不碰 DOM、three.js。畫法在 render/fx-nodes.ts。
import { FX_KINDS, HEX_COLOR, RANGE, clamp, isFiniteNumber } from './limits';
import { MAX_FX_PER_FACE, type FxKind, type Layer, type LayerFx } from './types';

/** 每一種的預設顏色（DESIGN：火焰橘紅、電光青藍、水波淡青）。 */
export const FX_DEFAULT_COLORS: Readonly<Record<FxKind, string>> = Object.freeze({
  fire: '#ff6a1f',
  electric: '#4fd8ff',
  water: '#a8f0ff',
});

/** 新加特效時的強度與速度（右欄滑桿的中間偏上／中間）。 */
export const DEFAULT_FX_STRENGTH = 70;
export const DEFAULT_FX_SPEED = 50;

/** 改特效時只給要改的欄位（UiIntents.editLayer 的 { fx: {...} }；拖滑桿時每次只送一個欄位）。 */
export type FxPatch = Partial<LayerFx>;

/** 這層的特效；沒有＝null。 */
export function layerFx(layer: Pick<Layer, 'fx'>): LayerFx | null {
  return layer.fx ?? null;
}

/** 這一面有幾層有特效（欄位在就算）。 */
export function fxCount(face: { readonly layers: readonly Pick<Layer, 'fx'>[] }): number {
  let n = 0;
  for (const l of face.layers) if (l.fx !== undefined) n++;
  return n;
}

/** 這層為什麼不能「加上」特效（右欄變淡的原因）：可以＝null。已經有特效的層改設定不受這個限制。 */
export type FxBlock = 'breakout' | 'face-full';

/**
 * 這一面第 index 層能不能加上特效：破框層不行（SCHEMA）→ 'breakout'；這層還沒有、而這一面已經有 MAX_FX_PER_FACE 層 → 'face-full'。
 * 已經有特效的層（改種類、顏色、強度、速度、拿掉）一律可以（不算 face-full）。找不到這層＝'face-full'（不給加）。
 */
export function fxBlocked(face: { readonly layers: readonly Layer[] }, index: number): FxBlock | null {
  const layer = face.layers[index];
  if (!layer) return 'face-full';
  if (layer.role === 'depth' && layer.breakout === true) return 'breakout';
  if (layer.fx === undefined && fxCount(face) >= MAX_FX_PER_FACE) return 'face-full';
  return null;
}

function isFxKind(v: unknown): v is FxKind {
  return typeof v === 'string' && (FX_KINDS as readonly string[]).includes(v);
}

/** 0～100 的整數（夾範圍、四捨五入）。 */
function level(v: number, range: { min: number; max: number }): number {
  return Math.round(clamp(v, range));
}

/**
 * 舊特效＋要改的欄位 → 新特效（只有四個欄位、顏色小寫、強度速度是 0～100 的整數）；合不出來＝null（呼叫端不改）：
 * - 種類：認得的就換；沒給或不認得 → 沿用舊的；沒有舊的也沒給 → null（不知道要加哪一種）。
 * - 顏色：合格的 #rrggbb 就用；沒給（或不合格）時：換了種類、而舊顏色還是舊種類的預設色 → 新種類的預設色；
 *   否則沿用舊的；新加的 → 那一種的預設色。
 * - 強度、速度：有限數字就夾在 0～100 再四捨五入；不然沿用舊的，新加的用預設值。
 * patch 不是物件（陣列、文字、null）→ null。
 */
export function mergeFx(old: LayerFx | undefined, patch: unknown): LayerFx | null {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return null;
  const p = patch as Record<string, unknown>;
  const own = (key: keyof LayerFx): unknown => (Object.prototype.hasOwnProperty.call(p, key) ? p[key] : undefined);
  const wantKind = own('kind');
  const kind = isFxKind(wantKind) ? wantKind : old?.kind;
  if (kind === undefined) return null;
  const wantColor = own('color');
  let color: string;
  if (typeof wantColor === 'string' && HEX_COLOR.test(wantColor)) color = wantColor.toLowerCase();
  else if (!old) color = FX_DEFAULT_COLORS[kind];
  else if (kind !== old.kind && old.color.toLowerCase() === FX_DEFAULT_COLORS[old.kind]) color = FX_DEFAULT_COLORS[kind];
  else color = old.color.toLowerCase();
  const wantStrength = own('strength');
  const wantSpeed = own('speed');
  const strength = isFiniteNumber(wantStrength) ? level(wantStrength, RANGE.fxStrength) : (old?.strength ?? DEFAULT_FX_STRENGTH);
  const speed = isFiniteNumber(wantSpeed) ? level(wantSpeed, RANGE.fxSpeed) : (old?.speed ?? DEFAULT_FX_SPEED);
  return { kind, color, strength, speed };
}

/** 兩個特效設定一樣嗎（顏色不分大小寫：匯入的卡可能是大寫，改成一樣的小寫不算改）。 */
export function sameFx(a: LayerFx | undefined, b: LayerFx | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.color.toLowerCase() === b.color.toLowerCase() && a.strength === b.strength && a.speed === b.speed;
}
