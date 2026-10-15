// T-703b 右欄〔自動去背〕：replaceLayerImage（換掉立體層的圖，同一個 id、其他設定不變）。
// 只對立體層（非文字層）有效；找不到、底圖、文字層 → 原樣回傳；圖片數量上限：換掉不是新增，舊圖還有別人在用時才可能超過。
import { describe, expect, it } from 'vitest';
import { replaceLayerImage } from '../../src/model/actions';
import { cardImages } from '../../src/model/foil';
import { MAX_CARD_IMAGES } from '../../src/model/limits';
import type { Card, Layer } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash } from './helpers';

/** 正面：底圖 b、發光層 glow（沒有透明、screen、改過不透明度／破框／不反光）、文字層 t；背面：立體層 d。 */
function sample(): Card {
  return cardWith(
    [
      baseLayer({ id: 'b', image: hash(1) }),
      depthLayer({
        id: 'glow',
        name: '光效',
        image: hash(2),
        hasAlpha: false,
        blend: 'screen',
        opacity: 70,
        breakout: true,
        holo: false,
        depth: 64,
        x: 0.12,
        y: -0.3,
        scale: 0.8,
        visible: false,
      }),
      depthLayer({
        id: 't',
        depth: 90,
        image: hash(3),
        text: { content: '卡名', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' },
      }),
    ],
    [depthLayer({ id: 'd', image: hash(4) })],
  );
}

const glowOf = (card: Card): Layer => card.front.layers.find((l) => l.id === 'glow')!;

describe('replaceLayerImage：換上去背好的圖', () => {
  it('同一個圖層 id 換上新圖、hasAlpha 改成 true；名字、位置、大小、深度、不透明度、混合模式、破框、反光、顯示都不變', () => {
    const card = deepFreeze(sample());
    const next = replaceLayerImage(card, 'front', 'glow', { image: hash(99), hasAlpha: true });
    expect(next).not.toBe(card);
    expect(glowOf(next)).toEqual({ ...glowOf(card), image: hash(99), hasAlpha: true });
    // 陣列位置不變（不重新排序）、其他層同一個物件
    expect(next.front.layers.map((l) => l.id)).toEqual(['b', 'glow', 't']);
    expect(next.front.layers[0]).toBe(card.front.layers[0]);
    expect(next.front.layers[2]).toBe(card.front.layers[2]);
    expect(next.back).toBe(card.back);
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('不改輸入（輸入凍結也能跑）、不碰 updatedAt', () => {
    const card = deepFreeze(sample());
    const next = replaceLayerImage(card, 'front', 'glow', { image: hash(99), hasAlpha: true });
    expect(glowOf(card).image).toBe(hash(2));
    expect(next.updatedAt).toBe(card.updatedAt);
  });

  it('找不到（id 不存在、在另一面）、底圖、文字層 → 原樣回傳（同一個物件）', () => {
    const card = deepFreeze(sample());
    const img = { image: hash(99), hasAlpha: true };
    expect(replaceLayerImage(card, 'front', 'nope', img)).toBe(card);
    expect(replaceLayerImage(card, 'back', 'glow', img)).toBe(card);
    expect(replaceLayerImage(card, 'front', 'b', img)).toBe(card);
    expect(replaceLayerImage(card, 'front', 't', img)).toBe(card);
  });

  it('雜湊格式不對 → 原樣；同一張圖、同一個 hasAlpha（沒有改變）→ 原樣', () => {
    const card = deepFreeze(sample());
    expect(replaceLayerImage(card, 'front', 'glow', { image: 'not-a-hash', hasAlpha: true })).toBe(card);
    expect(replaceLayerImage(card, 'front', 'glow', { image: hash(2), hasAlpha: false })).toBe(card);
  });

  it('換成沒有透明的圖、但這層的混合模式只能給有透明的圖用（例如疊色）→ 原樣（不然寫出的卡通不過驗證）', () => {
    const card = cardWith([depthLayer({ id: 'a', image: hash(5), hasAlpha: true, blend: 'overlay' })]);
    expect(replaceLayerImage(card, 'front', 'a', { image: hash(6), hasAlpha: false })).toBe(card);
    // 發光／加深／強光可以
    const ok = cardWith([depthLayer({ id: 'a', image: hash(5), hasAlpha: true, blend: 'screen' })]);
    expect(replaceLayerImage(ok, 'front', 'a', { image: hash(6), hasAlpha: false }).front.layers[0]).toMatchObject({ image: hash(6), hasAlpha: false });
  });
});

describe('replaceLayerImage：圖片數量上限（每張卡 16 張；換掉不是新增）', () => {
  /** 正面 8 層、背面 8 層，每層一張不同的圖＝16 張。 */
  function full(): Card {
    const layers = (face: number) =>
      Array.from({ length: 8 }, (_, i) => depthLayer({ id: `${face}-${i}`, image: hash(face * 10 + i + 1), hasAlpha: i !== 3, ...(i === 3 ? { blend: 'screen' as const } : {}) }));
    return cardWith(layers(0), layers(1));
  }

  it('已經 16 張、舊圖只有這一層在用：照樣換（張數不變）', () => {
    const card = full();
    expect(cardImages(card)).toHaveLength(MAX_CARD_IMAGES);
    const next = replaceLayerImage(card, 'front', '0-3', { image: hash(999), hasAlpha: true });
    expect(next.front.layers[3]).toMatchObject({ image: hash(999), hasAlpha: true });
    expect(cardImages(next)).toHaveLength(MAX_CARD_IMAGES);
  });

  it('已經 16 張、舊圖還有別層在用（換了就變 17 張）→ 原樣', () => {
    const base = full();
    // 背面第 0 層也用正面第 3 層的圖：還是 15 張不同的圖；再加反光層的黑白圖湊滿 16 張
    const shared: Card = {
      ...base,
      back: { layers: base.back.layers.map((l, i) => (i === 0 ? { ...l, image: hash(4), hasAlpha: false, blend: 'screen' as const } : l)), foil: { shape: 'mask', mask: hash(500), frame: true } },
    };
    expect(cardImages(shared)).toHaveLength(MAX_CARD_IMAGES);
    expect(replaceLayerImage(shared, 'front', '0-3', { image: hash(999), hasAlpha: true })).toBe(shared);
  });
});
