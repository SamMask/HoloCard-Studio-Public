// 新卡片（SCHEMA.md §1.3 預設值）。反光層（Face.foil）與霧光（holo.matte）用預設值，不寫出欄位（T-417）。
import { customAspectProblem } from './aspect';
import { HOLO_PALETTES, type Aspect, type Card, type CustomAspect } from './types';

export const DEFAULT_CARD_NAME = '未命名卡片';

/**
 * id 由呼叫端產生（crypto.randomUUID()）；createdAt＝updatedAt＝now（ISO 時間）。
 * 自訂比例（T-807）：customAspect 是使用者打的寬高（存複本）；沒給或不合格就建成標準卡（不寫出驗證不過的卡）。
 * 其他比例不寫 customAspect。
 */
export function newCard(aspect: Aspect, id: string, now: string, customAspect?: CustomAspect): Card {
  const custom =
    aspect === 'custom' && customAspect !== undefined && customAspectProblem(customAspect.width, customAspect.height) === null
      ? { width: customAspect.width, height: customAspect.height }
      : null;
  return {
    formatVersion: 1,
    id,
    name: DEFAULT_CARD_NAME,
    createdAt: now,
    updatedAt: now,
    aspect: custom ? 'custom' : aspect === 'custom' ? 'standard' : aspect,
    ...(custom ? { customAspect: custom } : {}),
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [] },
    back: { layers: [] },
    frame: { enabled: false, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'desk' },
  };
}

/**
 * 新的 CD 光碟（T-810，SCHEMA Card.kind?）：正方形（不能有自訂寬高）、背面沒有圖層（銀色資料面）；
 * 其他預設值和新卡片一樣（圓角、卡框照存，光碟不畫）。
 */
export function newDisc(id: string, now: string): Card {
  return { ...newCard('square', id, now), kind: 'disc' };
}
