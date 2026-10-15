// T-805 變身圖（Layer.alt?）在資料庫裡也算「有在用」：啟動時清圖（cleanupImages）、刪別張卡時都不能收掉；
// 刪掉用它的卡才收。存好讀得回（圖都在才合格）。
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';

const T0 = '2026-10-14T00:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: true };
}

/** 正面一個立體層（圖 layerImage），變身圖是 altImage。 */
function cardWithAlt(id: string, layerImage: number, altImage: number): Card {
  const added = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-l`, name: '龍', image: hashOf(layerImage), hasAlpha: true, width: 64, height: 96 });
  if (!added.ok) throw new Error(added.reason);
  const card = updateLayer(added.card, 'front', `${id}-l`, { alt: { image: hashOf(altImage), hasAlpha: true } });
  if (card.front.layers[0]?.alt?.image !== hashOf(altImage)) throw new Error('變身圖沒有加上去');
  return card;
}

async function imageKeys(store: Awaited<ReturnType<typeof openCardStore>>, numbers: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const n of numbers) if (await store.loadImage(hashOf(n))) out.push(n);
  return out;
}

describe('資料庫：變身圖也算有在用（T-805）', () => {
  it('存好讀得回；啟動清圖不會收掉變身圖', async () => {
    const store = await openCardStore(new IDBFactory());
    const card = cardWithAlt('a', 2, 4);
    await store.saveImage(image(2));
    await store.saveImage(image(4));
    await store.saveImage(image(8)); // 孤兒
    await store.save(card);
    expect(await store.load('a')).toEqual(card);
    expect(await store.cleanupImages()).toBe(1);
    expect(await imageKeys(store, [2, 4, 8])).toEqual([2, 4]);
    expect(await store.load('a')).toEqual(card);
  });

  it('刪別張卡時不收掉這張卡的變身圖（兩張卡共用同一張變身圖也一樣）；刪掉最後一張用它的卡才收', async () => {
    const store = await openCardStore(new IDBFactory());
    const a = cardWithAlt('a', 2, 4);
    const b = cardWithAlt('b', 6, 4);
    for (const n of [2, 4, 6]) await store.saveImage(image(n));
    await store.save(a);
    await store.save(b);
    await store.remove('a');
    expect(await imageKeys(store, [2, 4, 6])).toEqual([4, 6]);
    expect(await store.load('b')).toEqual(b);
    await store.remove('b');
    expect(await imageKeys(store, [2, 4, 6])).toEqual([]);
  });
});
