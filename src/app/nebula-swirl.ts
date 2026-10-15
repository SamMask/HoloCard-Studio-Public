// 星雲畫好的漩渦大圖（T-817，DESIGN §5「星雲加強」）：public/stages/nebula.webp，交給 render 畫在卡片後面慢慢轉。
// 第一次要用時才讀：舞台是星雲、而且這張卡沒有自己的背景圖（背景圖取代漩渦）才讀，開工坊時不讀；只讀一次（讀好的 <img> 留著，
// 每次回同一個圖物件：render 用它比對是不是同一張、貼圖只建一次）；讀好通知畫面重畫一次；
// 讀不到不丟錯（交給 failed 記下來），先照程式漩渦畫，隔 NEBULA_SWIRL_RETRY_MS（10 秒）之後、下次狀態改變時才再試
// （同 T-815b 水鏡遠景、T-816 展示廳大廳：沒有計時器，持續讀不到時拖滑桿等編輯事件不會讓請求跟著一直打）。
// 解出來是 0×0：當作讀不到，收回那個 blob 網址（T-816b 的教訓：不然每次重試都多留一個）。
// 怎麼讀（同源、不跟著轉址）與網址由 main 注入：這裡和 render 都不寫死檔名。
// 連舞台一起錄（T-850c）：匯出自己（同一個同源讀取）讀到的圖用 provide 補進來——預覽讀不到、還在冷卻中時，匯出重讀成功的那張也交給 3D，
// 兩邊畫的是同一張；已經有的不換掉，空的圖不收。補上之後畫面由呼叫端重畫（main 的 update）。

import type { BackdropImage } from '../render/backdrop';
import type { Card } from '../model/types';

/** 讀不到之後，至少隔這麼久（毫秒）才再試。 */
export const NEBULA_SWIRL_RETRY_MS = 10_000;

export interface NebulaSwirlDeps {
  /** 讀大圖並解碼完（main：同源 fetch → blob 網址 → <img>）。 */
  load(): Promise<HTMLImageElement>;
  /** 讀好了：畫面重畫一次（render 換上大圖）。 */
  loaded(): void;
  /** 讀不到（記在 console）；不丟錯、不跟使用者說，先照程式漩渦畫。 */
  failed(err: unknown): void;
  /** 收回不用的 blob 網址；沒給＝URL.revokeObjectURL（測試注入）。 */
  revoke?(url: string): void;
  /** 現在的時間（毫秒，算讀不到之後的冷卻）；沒給＝Date.now（測試注入假時鐘）。 */
  now?(): number;
}

export interface NebulaSwirl {
  /** 畫面每次更新時呼叫：舞台是星雲、沒有自己的背景圖，而且還沒讀過（或冷卻過了）才讀。 */
  want(card: Pick<Card, 'view'>): void;
  /** 讀好的大圖（交給 render 建貼圖；每次回同一個物件）；還沒讀好、讀不到＝null。 */
  image(): BackdropImage | null;
  /** 補上匯出讀到的這張（T-850c，見檔頭）：回現在用的那張（已經有就是原本的；圖是空的、也還沒有＝null）。 */
  provide(img: HTMLImageElement): BackdropImage | null;
}

export function createNebulaSwirl(deps: NebulaSwirlDeps): NebulaSwirl {
  let image: BackdropImage | null = null;
  /** 已經在讀（還沒好也還沒失敗）。 */
  let asking = false;
  /** 讀不到的時間（毫秒）：冷卻中不重讀。 */
  let failedAt: number | null = null;
  const now = () => deps.now?.() ?? Date.now();
  const revoke = (url: string) => (deps.revoke ? deps.revoke(url) : URL.revokeObjectURL(url));

  return {
    want(card) {
      if (card.view.stage !== 'nebula' || card.view.backdrop !== undefined) return;
      if (image !== null || asking) return;
      if (failedAt !== null && now() - failedAt < NEBULA_SWIRL_RETRY_MS) return;
      asking = true;
      deps.load().then(
        (img) => {
          asking = false;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            failedAt = null;
            image = { image: img, width: img.naturalWidth, height: img.naturalHeight };
            deps.loaded();
            return;
          }
          // 解出來是空的：當作讀不到（不然重畫又會馬上再讀一次），這個 blob 網址也不會再用
          revoke(img.src);
          failedAt = now();
          deps.failed(new Error('星雲的漩渦大圖解出來是空的'));
        },
        (err: unknown) => {
          asking = false;
          failedAt = now();
          deps.failed(err);
        },
      );
    },
    image: () => image,
    provide(img) {
      if (image === null && img.naturalWidth > 0 && img.naturalHeight > 0) {
        image = { image: img, width: img.naturalWidth, height: img.naturalHeight };
        failedAt = null;
      }
      return image;
    },
  };
}
