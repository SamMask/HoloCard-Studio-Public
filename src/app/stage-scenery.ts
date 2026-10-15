// 連舞台一起錄（T-850，DESIGN §7.1）：匯出畫面的「CSS 那層」要畫哪張圖——照預覽（ui/logic 的 stageBackdropView，ui/stage.ts 同一個判斷）：
//   - 自己的背景圖（舞台不是水鏡）→ 'custom'，帶這張卡的 view.farPan（同 T-822 預覽的擺法）；
//   - 展示廳（沒有自己的背景圖）→ 'hall' 畫好的大廳；工作桌 → 'desk' 木桌（兩張都同源讀，同 T-842 的圖）；
//   - 全息光環、關閉 → 'blur' 正面底圖的模糊版（底圖隱藏或沒有＝沒有圖，只有底色與暗角）；
//   - 魔法陣、水鏡、星雲（沒有自己的背景圖）→ 沒有圖（那層在預覽是看不見的；水鏡的遠景、星雲的大圖在 3D 裡）。
// 3D 裡要用的舞台圖（水鏡的遠景、星雲的大圖）也在這裡先讀到（同一個同源讀取，main 的預覽讀圖共用結果）：讀不到這次匯出就失敗、不下載（照 T-842）。
// 3D 舞台要接上同一批圖（T-850c，審查中等②③）：讀到的舞台圖與自己的背景圖交給 deps.attach3d（main：補進預覽的讀圖狀態、重畫一次，
//   3D 的水鏡遠景／星雲大圖／展示廳地板／遠景接點就是這一批），回 false＝接不上 → 丟錯（這次匯出失敗、不下載）。
//   自己的背景圖一律要拿得到（水鏡也是：它畫在 3D 的遠景平面，CSS 那層沒有它），拿不到就丟錯、不照錄替代畫面。
// 圖由組裝端交進來（圖片登記簿、同源讀取）；這裡不讀網址以外的東西、不碰 3D。

import { stageExportPath } from './stage-export-image';
import type { Card } from '../model/types';
import { withFarPan, type BackdropImage } from '../render/backdrop';
import type { StageScenery } from '../render/card-view';
import { stageBackdropView } from '../ui/logic';

/** 3D 舞台這次要用的圖（T-850c）：舞台畫好的圖（stageExportPath 那張）與自己的背景圖；沒有＝null。 */
export interface Stage3dImages {
  stage: { path: string; image: BackdropImage } | null;
  backdrop: BackdropImage | null;
}

export interface StageSceneryDeps {
  /** 這張卡的圖（圖片登記簿，已解碼）；拿不到＝null。沒給＝都拿不到。 */
  image?(hash: string): BackdropImage | null;
  /** 舞台畫好的圖（public/stages/…，同源讀）；讀不到丟錯。沒給＝讀不到。 */
  stageImage?(path: string): Promise<BackdropImage>;
  /**
   * 把這一批圖交給 3D 舞台（T-850c，見檔頭），回 3D 舞台現在用的是不是這一批；false＝接不上（丟錯）。
   * 沒給＝不檢查（測試；main 一定接）。
   */
  attach3d?(card: Pick<Card, 'view'>, images: Stage3dImages): boolean;
}

/** 這張卡匯出時的 CSS 那層（見檔頭）；要的圖讀不到就丟錯。 */
export async function stageSceneryFor(card: Pick<Card, 'front' | 'view'>, deps: StageSceneryDeps): Promise<StageScenery> {
  const stage = card.view.stage;
  // 自己的背景圖：一律要拿得到（水鏡也是，T-850c）
  const hash = card.view.backdrop;
  const own = hash === undefined ? null : (deps.image?.(hash) ?? null);
  if (hash !== undefined && !own) throw new Error('讀不到這張卡的背景圖');
  // 舞台畫好的圖（大廳、木桌、水鏡遠景、星雲大圖；有自己的背景圖＝null）：先讀到
  const path = stageExportPath(card);
  let stageImage: BackdropImage | null = null;
  if (path !== null) {
    if (!deps.stageImage) throw new Error(`讀不到舞台的圖：${path}`);
    stageImage = await deps.stageImage(path);
  }
  // 3D 舞台接上同一批圖（T-850c）；接不上這次就失敗
  const used: Stage3dImages = { stage: path !== null && stageImage ? { path, image: stageImage } : null, backdrop: own ? withFarPan(own, card.view.farPan) : null };
  if (deps.attach3d && !deps.attach3d(card, used)) throw new Error('舞台的圖沒有接上 3D');
  const shown = stageBackdropView(card);
  if (shown === null) return { stage, image: null };
  if ('desk' in shown || 'hall' in shown) {
    if (!stageImage) throw new Error('讀不到舞台的圖');
    return { stage, image: { kind: 'desk' in shown ? 'desk' : 'hall', source: stageImage } };
  }
  if (shown.custom) {
    if (!used.backdrop) throw new Error('讀不到這張卡的背景圖');
    return { stage, image: { kind: 'custom', source: used.backdrop } };
  }
  // 正面底圖的模糊版：只有全息光環、關閉看得見那一層（其他舞台的那層是 opacity 0）
  if (stage !== 'halo' && stage !== 'none') return { stage, image: null };
  const base = deps.image?.(shown.hash) ?? null;
  return { stage, image: base ? { kind: 'blur', source: base } : null };
}

/** main 交給 3D 舞台的東西（T-850c；同 main 的 update 交給 scene 的那幾樣）。 */
export interface Stage3dShown {
  /** setBackdrop 的圖（自己的背景圖；沒有＝null）。 */
  backdrop: BackdropImage | null;
  /** setWaterScene 的圖（水鏡、沒有自己的背景圖時）；沒有＝null。 */
  waterScene: BackdropImage | null;
  /** setNebulaSwirl 的圖（星雲、沒有自己的背景圖時）；沒有＝null。 */
  nebulaSwirl: BackdropImage | null;
  /** setGalleryHall：展示廳的大廳讀好了沒。 */
  galleryHall: boolean;
}

/**
 * 3D 舞台用的是不是這一批圖（T-850c）：有自己的背景圖＝遠景接點是同一張；不然水鏡遠景、星雲大圖＝同一張、展示廳＝大廳地板；
 * 其他舞台（全息光環、魔法陣、工作桌）3D 不用舞台的圖＝一定接得上。
 */
export function stage3dMatches(card: Pick<Card, 'view'>, used: Stage3dImages, shown: Stage3dShown): boolean {
  if (used.backdrop) return shown.backdrop !== null && shown.backdrop.image === used.backdrop.image;
  const want = used.stage?.image.image;
  switch (card.view.stage) {
    case 'water':
      return want !== undefined && shown.waterScene?.image === want;
    case 'nebula':
      return want !== undefined && shown.nebulaSwirl?.image === want;
    case 'gallery':
      return want !== undefined && shown.galleryHall;
    default:
      return true;
  }
}
