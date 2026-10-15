// 反光層（T-417，SCHEMA §1「反光層」）的小工具：預設值、卡片用到的圖（含黑白圖、變身圖、舞台背景圖）、讀舊卡時把 holo.scope 換成 Face.foil。
// 純 TS，不碰 DOM。改反光層的動作（updateFoil）在 actions.ts。
import { DEFAULT_MATTE, IMAGE_HASH } from './limits';
import type { Card, Face, Foil, Holo } from './types';

/** `Face.foil` 省略時＝整面反光、卡框也反光。 */
export const DEFAULT_FOIL: Readonly<Foil> = Object.freeze({ shape: 'full', frame: true });

/** 這一面的反光層（省略＝預設）。 */
export function faceFoil(face: Pick<Face, 'foil'>): Foil {
  return face.foil ?? DEFAULT_FOIL;
}

/** 霧光 0～100（省略＝35）。 */
export function holoMatte(holo: Pick<Holo, 'matte'>): number {
  return holo.matte ?? DEFAULT_MATTE;
}

/** 等於預設值（整面、卡框也反光、沒有保留黑白圖）：寫出時省略。 */
export function isDefaultFoil(foil: Foil): boolean {
  return foil.shape === 'full' && foil.frame === true && foil.mask === undefined;
}

/**
 * 卡片用到的圖（不重複）：正面的圖層（每層的圖、接著它的變身圖）、正面反光層的黑白圖、背面的圖層、背面的黑白圖、
 * 最後是舞台背景圖（T-814）、前景圖（T-830）。存檔、換卡、卡片檔打包、圖片回收都用這一份（黑白圖、變身圖〔T-805〕、背景圖、
 * 前景圖也算「有在用」）；每張卡最多 MAX_CARD_IMAGES 張。
 */
export function cardImages(card: Pick<Card, 'front' | 'back' | 'view'>): string[] {
  const out = new Set<string>();
  for (const face of [card.front, card.back]) {
    for (const layer of face.layers) {
      out.add(layer.image);
      if (layer.alt !== undefined) out.add(layer.alt.image);
    }
    const mask = face.foil?.mask;
    if (mask !== undefined) out.add(mask);
  }
  const backdrop = card.view.backdrop;
  if (backdrop !== undefined) out.add(backdrop);
  const foreground = card.view.foreground?.image;
  if (foreground !== undefined) out.add(foreground);
  return [...out];
}

// ---- 舊卡轉換（讀進來時，validateCard 之前）----

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 舊的鐳射範圍 → 兩面的反光層（SCHEMA §1「舊卡轉換」）。'all'＝預設值，不寫出。 */
const LEGACY_SCOPE: Record<string, Foil | null> = {
  all: null,
  layers: { shape: 'layers', frame: false },
  frame: { shape: 'none', frame: true },
};

/**
 * 舊卡（T-417 以前存的、或舊版卡片檔）：holo.scope 是認得的值 → 拿掉 scope；兩面都沒有 foil 時依 scope 給兩面 foil。
 * 一面已經有 foil 就只拿掉 scope。不認得的 scope、壞資料原樣回傳（交給 validateCard 報錯）；沒有 scope 回同一個物件。
 * 不改輸入（回新物件）；輸入是不可信資料，只讀自己的欄位、不丟例外。
 */
export function migrateCard(raw: unknown): unknown {
  if (!isObj(raw) || !hasOwn(raw, 'holo')) return raw;
  const holo = raw.holo;
  if (!isObj(holo) || !hasOwn(holo, 'scope')) return raw;
  const scope = holo.scope;
  if (typeof scope !== 'string' || !hasOwn(LEGACY_SCOPE, scope)) return raw;
  const { scope: _scope, ...rest } = holo;
  const out: Obj = { ...raw, holo: rest };
  const front = hasOwn(raw, 'front') ? raw.front : undefined;
  const back = hasOwn(raw, 'back') ? raw.back : undefined;
  const hasFoil = (face: unknown) => isObj(face) && hasOwn(face, 'foil');
  const foil = LEGACY_SCOPE[scope];
  if (foil && !hasFoil(front) && !hasFoil(back)) {
    if (isObj(front)) out.front = { ...front, foil: { ...foil } };
    if (isObj(back)) out.back = { ...back, foil: { ...foil } };
  }
  return out;
}

/** 是不是合格的圖片雜湊（16 碼小寫十六進位）。 */
export function isImageHash(v: unknown): v is string {
  return typeof v === 'string' && IMAGE_HASH.test(v);
}
