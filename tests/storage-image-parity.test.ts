import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { StoredImage } from '../src/images/types';
import { addLayer, setBackdrop, setForeground, updateFoil, updateLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { cardImages } from '../src/model/foil';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { DB_NAME, DB_VERSION } from '../src/storage/types';

const hashOf = (n: number): string => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return {
    hash: hashOf(n),
    blob: new Blob([`image-${n}`], { type: 'image/webp' }),
    type: 'image/webp',
    width: 64,
    height: 96,
    hasAlpha: true,
  };
}

/** 每面都有圖層、變身圖與黑白遮罩，另外有舞台背景圖與前景圖。 */
function fullCard(shared: boolean): Card {
  let card = newCard('standard', 'image-parity', '2026-10-15T00:00:00.000Z');
  for (const [side, first] of [['front', 1], ['back', shared ? 1 : 4]] as const) {
    const added = addLayer(card, side, {
      id: `${side}-layer`, name: side, image: hashOf(first), hasAlpha: true, width: 64, height: 96,
    });
    if (!added.ok) throw new Error(added.reason);
    card = updateLayer(added.card, side, `${side}-layer`, {
      alt: { image: hashOf(first + 1), hasAlpha: true },
    });
    card = updateFoil(card, side, { shape: 'mask', mask: hashOf(first + 2) });
  }
  return setForeground(setBackdrop(card, hashOf(7)), hashOf(8));
}

/** 直接讀實際保留的 keys，不重寫 storage 的圖片列舉邏輯，也不匯出私有函式。 */
async function storedImageKeys(factory: IDBFactory): Promise<IDBValidKey[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = db.transaction('images', 'readonly').objectStore('images').getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe('T-839：model 與 storage 的圖片清單一致', () => {
  it.each([
    { label: '各欄位用不同圖片', shared: false, numbers: [1, 2, 3, 4, 5, 6, 7, 8] },
    { label: '兩面共用圖層、變身圖與遮罩', shared: true, numbers: [1, 2, 3, 7, 8] },
  ])('全功能卡（$label）：清圖後集合相同、每張圖與卡片都還在', async ({ shared, numbers }) => {
    const factory = new IDBFactory();
    const store = await openCardStore(factory);
    const card = fullCard(shared);
    const images = numbers.map(image);
    // 獨立的預期清單確保全功能卡沒有漏放欄位，model 也沒有漏列圖片。
    expect(new Set(cardImages(card))).toEqual(new Set(images.map((img) => img.hash)));
    for (const img of images) await store.saveImage(img);
    await store.saveImage(image(9)); // 孤兒圖必須清掉，不能只驗「全部保留」。
    await store.save(card);

    await store.cleanupImages();

    // 只有一張卡：實際留下的 keys 就是 imageHashes 判定有在用的集合。
    expect(new Set(await storedImageKeys(factory))).toEqual(new Set(cardImages(card)));
    for (const img of images) expect(await store.loadImage(img.hash)).toEqual(img);
    expect(await store.loadImage(hashOf(9))).toBeUndefined();
    expect((await store.list()).map((summary) => summary.id)).toEqual([card.id]);
    expect(await store.load(card.id)).toEqual(card);
    expect(await store.cleanupImages()).toBe(0);
  });
});
