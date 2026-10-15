// 水鏡三種遠景的貼圖（T-815，card-view 的 setWaterScene 用）：同一張圖只建一次貼圖（湖光山峰 → 水墨山 → 湖光山峰不重建），
// 回傳同一個 StageBackdrop 物件（水鏡用物件比對「是不是同一張」）；release() 全部釋放（切走水鏡、或有自己的背景圖不需要遠景時）。
// 最多三張（每張 2048×1024 約 11 MB 顯示記憶體，含 mipmap），只在水鏡時留著。建貼圖的方式由 card-view 給（色彩空間、各向異性）。

import type { Texture } from 'three/webgpu';
import type { BackdropImage } from './backdrop';
import type { StageBackdrop } from './stage-switch';

export interface SceneTextures {
  /** 這張圖的貼圖（第一次要才建）；寬高不合理（≤ 0、NaN）＝null。 */
  get(image: BackdropImage): StageBackdrop | null;
  /** 全部釋放（之後再要會重新建）。 */
  release(): void;
  /** 目前留著幾張（檢查用）。 */
  size(): number;
}

const valid = (n: number) => Number.isFinite(n) && n > 0;

export function createSceneTextures(make: (image: BackdropImage) => Texture): SceneTextures {
  const built = new Map<BackdropImage['image'], StageBackdrop>();
  return {
    get(image) {
      if (!valid(image.width) || !valid(image.height)) return null;
      const had = built.get(image.image);
      if (had) return had;
      const made: StageBackdrop = { texture: make(image), width: image.width, height: image.height };
      built.set(image.image, made);
      return made;
    },
    release() {
      for (const b of built.values()) b.texture.dispose();
      built.clear();
    },
    size: () => built.size,
  };
}
