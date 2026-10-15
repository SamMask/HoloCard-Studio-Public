// 展示廳兩側浮著的卡（T-410，DESIGN §5「舞台」）：卡片庫裡其他卡已存的正面縮圖（SCHEMA §3 cards.thumbnail）。
// 不另外拍、不上傳：從存檔讀出縮圖 Blob → 在本機解碼成 ImageBitmap → 交給 render（它畫進自己的拼圖貼圖）。
// 挑哪幾張是純函式（pickGalleryCards，有測試）；顯示出去的圖照「id＋最後編輯時間」記住，換卡時不用重解；
// 不在最新一批裡的就 close() 收回。晚到的要求（已經有更新的要求）不解碼、不進快取，解到一半被超車的把自己解的圖收回
// （T-410c）。解碼與讀清單由組裝端注入（node 測試用假的）。

import type { CardSummary } from '../storage/types';

/** 最多幾張（不含目前這張；同 render 的 MAX_GALLERY_CARDS）。 */
export const GALLERY_CARD_MAX = 6;

/** 已解碼的縮圖（render 的 GalleryThumb 同形狀）。 */
export interface FloatingThumb {
  image: ImageBitmap;
  width: number;
  height: number;
}

/** 浮哪幾張：不含目前這張、要有縮圖、最近編輯的先，最多 max 張。 */
export function pickGalleryCards(cards: readonly CardSummary[], currentId: string | null, max = GALLERY_CARD_MAX): CardSummary[] {
  return cards
    .filter((c) => c.id !== currentId && c.thumbnail instanceof Blob)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, Math.max(0, max));
}

export interface GalleryFeedDeps {
  /** 卡片庫清單（session.list）。 */
  list(): Promise<CardSummary[]>;
  /** 縮圖 Blob → 圖（瀏覽器：createImageBitmap）。 */
  decode(blob: Blob): Promise<ImageBitmap>;
  /** 交給畫面（scene.setGalleryThumbs）。 */
  show(thumbs: FloatingThumb[]): void;
}

export interface GalleryFeed {
  /**
   * 展示廳顯示著、目前這張是 currentId：和上次要的不同（換卡、剛切到展示廳）或 force（卡片庫有變）才重讀。
   * 讀完時又有新的要求就丟掉這次的結果。
   */
  want(currentId: string, force?: boolean): Promise<void>;
}

const keyOf = (c: CardSummary) => `${c.id}|${c.updatedAt}`;

export function createGalleryFeed(deps: GalleryFeedDeps): GalleryFeed {
  let wanted: string | null = null;
  let request = 0;
  /** 畫面上這一批的圖（id＋最後編輯時間 → 圖）：只有顯示出去的才進來，換下一批時不用的就 close。 */
  const cache = new Map<string, ImageBitmap>();

  return {
    async want(currentId, force = false) {
      if (!force && currentId === wanted) return;
      wanted = currentId;
      const req = ++request;
      let picked: CardSummary[];
      try {
        picked = pickGalleryCards(await deps.list(), currentId);
      } catch (err) {
        console.error(err);
        return;
      }
      // 晚到（T-410c）：清單回來時已經有更新的要求 → 不解碼、不碰快取
      if (req !== request) return;
      // 快取裡有的直接用；沒有的這次自己解碼（還不放進快取，確定要顯示才放）
      const fresh: ImageBitmap[] = [];
      const images = await Promise.all(
        picked.map(async (c): Promise<ImageBitmap | null> => {
          const cached = cache.get(keyOf(c));
          if (cached) return cached;
          try {
            const image = await deps.decode(c.thumbnail!);
            fresh.push(image);
            return image;
          } catch (err) {
            console.error(err);
            return null;
          }
        }),
      );
      // 解碼途中被更新的要求超車：自己解出來的圖收回（快取裡的是畫面上正在用的，不動）
      if (req !== request) {
        for (const image of fresh) image.close();
        return;
      }
      const keep = new Map<string, ImageBitmap>();
      picked.forEach((c, i) => {
        const image = images[i];
        if (image) keep.set(keyOf(c), image);
      });
      const thumbs: FloatingThumb[] = [...keep.values()].map((image) => ({ image, width: image.width, height: image.height }));
      deps.show(thumbs);
      // 畫面已經換成這一批：不在這批裡的收回
      for (const [key, image] of cache) if (!keep.has(key)) image.close();
      cache.clear();
      for (const [key, image] of keep) cache.set(key, image);
    },
  };
}
