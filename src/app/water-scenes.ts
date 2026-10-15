// 水鏡遠景的三張圖（T-815，DESIGN §5「水鏡遠景」）：湖光山峰／水墨山／富士山（public/stages/water-*.webp，畫好的圖）。
// 第一次要用時才讀：舞台是水鏡才讀（開工坊時不讀）；這張卡選的那張先讀（3D 要用），另外兩張接著讀（右欄「遠景」的小縮圖）。
// 每張只讀一次（讀好的 <img> 留著：3D 建貼圖與小縮圖都用它，縮圖用它的 blob 網址）；讀好通知畫面重畫一次；
// 讀不到不丟錯（交給 failed 記下來），隔 WATER_SCENE_RETRY_MS（10 秒）之後、下次狀態改變時才再試（T-815b：
// 持續讀不到時，拖滑桿等編輯事件不會讓請求跟著一直打；沒有計時器，只在有人叫 want 時才看有沒有過冷卻）。
// 怎麼讀（同源、不跟著轉址）與網址由 main 注入：這裡和 render 都不寫死檔名。
// 連舞台一起錄（T-850c）：匯出自己（同一個同源讀取）讀到的圖用 provide 補進來——預覽讀不到、還在冷卻中時，匯出重讀成功的那張也交給 3D，
// 兩邊畫的是同一張；已經有的不換掉，空的圖不收。補上之後畫面由呼叫端重畫（main 的 update）。

import type { BackdropImage } from '../render/backdrop';
import { waterSceneOf } from '../model/actions';
import { WATER_SCENES } from '../model/limits';
import type { Card, WaterScene } from '../model/types';

/** 一張讀不到之後，至少隔這麼久（毫秒）才再試。 */
export const WATER_SCENE_RETRY_MS = 10_000;

export interface WaterScenesDeps {
  /** 讀一張遠景圖並解碼完（main：同源 fetch → blob 網址 → <img>）。 */
  load(scene: WaterScene): Promise<HTMLImageElement>;
  /** 讀好一張：畫面重畫一次（3D 換上遠景、右欄放上小縮圖）。 */
  loaded(): void;
  /** 讀不到（記在 console）；不丟錯、不跟使用者說，先照沒有遠景畫。 */
  failed(err: unknown): void;
  /** 現在的時間（毫秒，算讀不到之後的冷卻）；沒給＝Date.now（測試注入假時鐘）。 */
  now?(): number;
}

export interface WaterScenes {
  /** 畫面每次更新時呼叫：舞台是水鏡才開始讀還沒讀的（選的那張先）。 */
  want(card: Pick<Card, 'view'>): void;
  /** 讀好的圖（交給 render 建貼圖；同一張每次回同一個物件）；還沒讀好、讀不到＝null。 */
  image(scene: WaterScene): BackdropImage | null;
  /** 讀好的圖的網址（右欄的小縮圖；本機的 blob 網址）；還沒讀好＝undefined。 */
  url(scene: WaterScene): string | undefined;
  /** 補上匯出讀到的這張（T-850c，見檔頭）：回現在用的那張（已經有就是原本的；圖是空的、也還沒有＝null）。 */
  provide(scene: WaterScene, img: HTMLImageElement): BackdropImage | null;
}

export function createWaterScenes(deps: WaterScenesDeps): WaterScenes {
  const images = new Map<WaterScene, { image: BackdropImage; url: string }>();
  const asked = new Set<WaterScene>();
  /** 讀不到的時間（毫秒）：冷卻中不重讀；讀好了就清掉。 */
  const failedAt = new Map<WaterScene, number>();
  const now = () => deps.now?.() ?? Date.now();

  const ask = (scene: WaterScene) => {
    if (asked.has(scene)) return;
    const failed = failedAt.get(scene);
    if (failed !== undefined && now() - failed < WATER_SCENE_RETRY_MS) return;
    asked.add(scene);
    deps.load(scene).then(
      (img) => {
        failedAt.delete(scene);
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          images.set(scene, { image: { image: img, width: img.naturalWidth, height: img.naturalHeight }, url: img.src });
        }
        deps.loaded();
      },
      (err: unknown) => {
        // 不留在 asked（asked 是「已經要過、還沒失敗」），改記失敗的時間：冷卻過了才讓下一次 want 重讀
        asked.delete(scene);
        failedAt.set(scene, now());
        deps.failed(err);
      },
    );
  };

  return {
    want(card) {
      if (card.view.stage !== 'water') return;
      const first = waterSceneOf(card);
      ask(first);
      for (const scene of WATER_SCENES) if (scene !== first) ask(scene);
    },
    image: (scene) => images.get(scene)?.image ?? null,
    url: (scene) => images.get(scene)?.url,
    provide(scene, img) {
      if (!images.has(scene) && img.naturalWidth > 0 && img.naturalHeight > 0) {
        images.set(scene, { image: { image: img, width: img.naturalWidth, height: img.naturalHeight }, url: img.src });
        failedAt.delete(scene);
        // 已經有圖了：之後的 want 不用再讀這張
        asked.add(scene);
      }
      return images.get(scene)?.image ?? null;
    },
  };
}
