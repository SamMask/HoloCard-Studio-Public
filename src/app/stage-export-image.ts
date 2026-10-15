// T-842：舞台畫好的遠景沿用同源讀圖，預覽與匯出共用解碼結果；不讀 3D 舞台。
import { waterSceneOf } from '../model/actions';
import type { Card } from '../model/types';

/** 有自訂背景圖時不使用內建遠景；水鏡省略選擇＝湖光山峰。 */
export function stageExportPath(card: Pick<Card, 'view'>): string | null {
  if (card.view.backdrop !== undefined) return null;
  switch (card.view.stage) {
    case 'gallery': return 'stages/gallery-hall.webp';
    case 'water': return `stages/water-${waterSceneOf(card)}.webp`;
    case 'nebula': return 'stages/nebula.webp';
    case 'desk': return 'stages/desk.webp';
    default: return null;
  }
}

/** 只有六張固定素材；保留成功的 blob 圖，避免每次匯出留下新的 blob 網址。失敗不保留，讓既有讀取器或下次匯出重試。 */
export function createStageExportImages(
  load: (path: string) => Promise<HTMLImageElement>,
  revoke: (url: string) => void = url => URL.revokeObjectURL(url),
): (path: string) => Promise<HTMLImageElement> {
  const images = new Map<string, Promise<HTMLImageElement>>();
  return path => {
    const existing = images.get(path);
    if (existing) return existing;
    const pending = load(path).then(img => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) return img;
      revoke(img.src);
      throw new Error(`Empty stage scenery image: ${path}`);
    }).catch((err: unknown) => {
      images.delete(path);
      throw err;
    });
    images.set(path, pending);
    return pending;
  };
}
