// model 測試共用的小工具（不是測試檔，不會被 vitest 直接執行）。
import { newCard } from '../../src/model/create';
import type { Aspect, Card, Layer } from '../../src/model/types';

export const NOW = '2026-10-13T00:00:00.000Z';

/** 產生合格的圖片雜湊（16 碼小寫十六進位）。 */
export function hash(n: number): string {
  return n.toString(16).padStart(16, '0');
}

export const anyImage = (): boolean => true;

export function depthLayer(over: Partial<Layer> = {}): Layer {
  return {
    id: 'depth-1',
    name: '立體層',
    role: 'depth',
    image: hash(1),
    visible: true,
    depth: 50,
    x: 0,
    y: 0,
    scale: 1,
    holo: true,
    hasAlpha: true,
    ...over,
  };
}

export function baseLayer(over: Partial<Layer> = {}): Layer {
  return {
    id: 'base-1',
    name: '底圖',
    role: 'base',
    image: hash(2),
    visible: true,
    depth: 0,
    x: 0,
    y: 0,
    scale: 1.4,
    holo: false,
    hasAlpha: false,
    ...over,
  };
}

export function cardWith(front: Layer[], back: Layer[] = [], aspect: Aspect = 'standard'): Card {
  const card = newCard(aspect, 'card-1', NOW);
  return { ...card, front: { layers: front }, back: { layers: back } };
}

/** 遞迴凍結：之後若有人改到輸入物件，嚴格模式會直接丟 TypeError。 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 圖層 id 依陣列順序（由後到前）。 */
export function ids(layers: readonly Layer[]): string[] {
  return layers.map((l) => l.id);
}
