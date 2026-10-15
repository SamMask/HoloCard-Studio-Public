// 舞台背景圖（T-814，view.backdrop?）的資料流：背景圖算「有在用」（存檔驗證、刪卡、清圖、換卡、複製、匯出入）；
// 卡片檔匯出帶這張圖、匯入照 SCHEMA §4 驗（圖要附、雜湊格式、圖片上限）；來回一致；舊卡（沒有 backdrop）照讀。
import { strFromU8, unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { cardImageHashes } from '../src/app/autosave';
import { createSession } from '../src/app/session';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const T0 = '2026-10-15T00:00:00.000Z';
const LATER = '2026-10-15T08:30:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: true };
}

/** 正面一個立體層（圖 layerImage），背景圖 backdropImage。 */
function cardWithBackdrop(id: string, layerImage: number, backdropImage: number): Card {
  const added = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-l`, name: '龍', image: hashOf(layerImage), hasAlpha: true, width: 64, height: 96 });
  if (!added.ok) throw new Error(added.reason);
  const card = setBackdrop(added.card, hashOf(backdropImage));
  if (card.view.backdrop !== hashOf(backdropImage)) throw new Error('背景圖沒有加上去');
  return card;
}

async function imageKeys(store: Awaited<ReturnType<typeof openCardStore>>, numbers: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const n of numbers) if (await store.loadImage(hashOf(n))) out.push(n);
  return out;
}

describe('資料庫：背景圖也算有在用', () => {
  it('背景圖要先存才存得進卡（和圖層的圖一樣驗）；存好讀得回', async () => {
    const store = await openCardStore(new IDBFactory());
    const card = cardWithBackdrop('a', 2, 4);
    await store.saveImage(image(2));
    await expect(store.save(card)).rejects.toThrow(/view\.backdrop/);
    await store.saveImage(image(4));
    await store.save(card);
    expect(await store.load('a')).toEqual(card);
  });

  it('啟動清圖不收背景圖；刪別張卡不收；刪掉最後一張用它的卡才收', async () => {
    const store = await openCardStore(new IDBFactory());
    for (const n of [2, 4, 6, 8]) await store.saveImage(image(n));
    const a = cardWithBackdrop('a', 2, 4);
    const b = cardWithBackdrop('b', 6, 4);
    await store.save(a);
    await store.save(b);
    expect(await store.cleanupImages()).toBe(1); // 只有 8 是孤兒
    await store.remove('a');
    expect(await imageKeys(store, [2, 4, 6])).toEqual([4, 6]);
    expect(await store.load('b')).toEqual(b);
    await store.remove('b');
    expect(await imageKeys(store, [2, 4, 6])).toEqual([]);
  });
});

describe('換卡、複製（app/session）：背景圖一起帶、不被收掉', () => {
  it('cardImageHashes 含背景圖（排在最後）', () => {
    expect(cardImageHashes(cardWithBackdrop('a', 2, 4))).toEqual([hashOf(2), hashOf(4)]);
  });

  it('打開有背景圖的卡：背景圖從存檔載入登記簿；複製一份也帶著；開複製的那張圖都還在', async () => {
    const store = await openCardStore(new IDBFactory());
    for (const n of [2, 4]) await store.saveImage(image(n));
    await store.save(cardWithBackdrop('a', 2, 4));
    const registry = new Map<string, StoredImage>();
    let current: Card | null = null;
    const session = createSession({
      store,
      images: {
        add: async (img) => void registry.set(img.hash, img),
        get: (h) => registry.get(h),
        retain: (keep) => {
          for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
        },
      },
      current: () => current,
      show: (card) => void (current = card),
      thumbnail: async () => null,
      settle: async () => {},
      onStatus: () => {},
      onStorageLow: () => {},
    });
    const choice = await session.chooseStart();
    await session.openStart(choice!.card);
    expect([...registry.keys()].sort()).toEqual([hashOf(2), hashOf(4)]);
    const copy = await session.duplicate('a', { newId: () => 'a2', now: () => LATER });
    expect(copy.ok && copy.card.view.backdrop).toBe(hashOf(4));
    current = updateCard(current!, {});
    expect(await session.open('a2')).toBe('opened');
    expect(registry.has(hashOf(4))).toBe(true);
  });
});

describe('卡片檔 .holocard', () => {
  const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
  const preview = () => new Blob([PREVIEW], { type: 'image/png' });
  const opts = { newId: () => 'imported', now: () => LATER };
  const reason = (r: ImportResult) => (r.ok ? 'ok' : r.reason);

  async function fixture() {
    const heroBytes = makeWebp({ kind: 'extended', width: 80, height: 120, alpha: true, seed: 2 });
    const backdropBytes = makeWebp({ kind: 'lossy', width: 160, height: 90, seed: 5 });
    const hero = await stored(heroBytes, 'image/webp', 80, 120, true);
    const backdrop = await stored(backdropBytes, 'image/webp', 160, 90, false);
    const added = addLayer(newCard('standard', 'card-1', T0), 'front', { id: 'hero', name: '星晶龍', image: hero.hash, hasAlpha: true, width: 80, height: 120 });
    if (!added.ok) throw new Error(added.reason);
    const card = setBackdrop(updateCard(added.card, { view: { stage: 'water' } }), backdrop.hash);
    const images = new Map([hero, backdrop].map((s) => [s.hash, s] as const));
    const files: Record<string, Uint8Array> = { [`images/${hero.hash}.webp`]: heroBytes, [`images/${backdrop.hash}.webp`]: backdropBytes };
    return { card, images, files, backdrop };
  }
  const holocard = (card: unknown, files: Record<string, Uint8Array>) => {
    const items: ZipItem[] = [{ name: 'card.json', data: utf8(JSON.stringify(card)) }];
    for (const [name, data] of Object.entries(files)) items.push({ name, data, method: 0 });
    items.push({ name: 'preview.png', data: PREVIEW, method: 0 });
    return new Blob([buildZip(items)]);
  };

  it('匯出：背景圖一起打包、card.json 裡有 view.backdrop', async () => {
    const fx = await fixture();
    const blob = await exportHolocard(fx.card, async (h) => fx.images.get(h), preview());
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    expect(JSON.parse(strFromU8(files['card.json']!)).view.backdrop).toBe(fx.backdrop.hash);
  });

  it('匯出時找不到背景圖 → 丟錯（不會匯出一個打不開的檔）', async () => {
    const fx = await fixture();
    await expect(exportHolocard(fx.card, async (h) => (h === fx.backdrop.hash ? undefined : fx.images.get(h)), preview())).rejects.toThrow(fx.backdrop.hash);
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣、背景圖也在回傳的圖裡', async () => {
    const fx = await fixture();
    const result = await importHolocard(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()), opts);
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...fx.card, id: 'imported', createdAt: LATER, updatedAt: LATER });
    expect(result.images.map((i) => i.hash)).toContain(fx.backdrop.hash);
  });

  it('匯入：用到的背景圖沒有附 → missing-image', async () => {
    const fx = await fixture();
    const { [`images/${fx.backdrop.hash}.webp`]: _gone, ...rest } = fx.files;
    const result = await importHolocard(holocard(fx.card, rest), opts);
    expect(reason(result)).toBe('missing-image');
    expect(!result.ok && result.detail).toContain(fx.backdrop.hash);
  });

  it('匯入壞值：雜湊格式不對、不是文字 → invalid-card（指到 view.backdrop）', async () => {
    const fx = await fixture();
    for (const bad of ['ABCDEF', 12, null, { image: fx.backdrop.hash }]) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, backdrop: bad } }, fx.files), opts);
      expect(reason(result)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/view\.backdrop/);
    }
  });

  it('圖片上限：15 張圖層＋背景圖（剛好 16 張）照樣匯出入；16 張圖層＋背景圖的卡片檔匯入不了', async () => {
    const fx = await fixture();
    const layerFiles: Record<string, Uint8Array> = {};
    const layers: Card['front']['layers'] = [];
    for (let i = 0; i < 16; i++) {
      const bytes = makePng({ width: 4, height: 4, seed: 200 + i });
      const s = await stored(bytes, 'image/png', 4, 4, true);
      layerFiles[`images/${s.hash}.png`] = bytes;
      layers.push({ id: `l${i}`, name: `圖${i}`, role: 'depth', image: s.hash, visible: true, depth: 50, x: 0, y: 0, scale: 1, holo: true, hasAlpha: true });
    }
    const backdropFile = { [`images/${fx.backdrop.hash}.webp`]: fx.files[`images/${fx.backdrop.hash}.webp`]! };
    const base = setBackdrop(newCard('standard', 'card-1', T0), fx.backdrop.hash);
    // 剛好 16 張（15 張圖層＋背景圖）
    const fifteen: Card = { ...base, front: { layers: layers.slice(0, 8) }, back: { layers: layers.slice(8, 15) } };
    const fifteenFiles = { ...layerFiles, ...backdropFile };
    delete fifteenFiles[`images/${layers[15]!.image}.png`];
    expect(reason(await importHolocard(holocard(fifteen, fifteenFiles), opts))).toBe('ok');
    // 17 張（16 張圖層＋背景圖）：卡片檔要放 17 張圖，超過檔案數上限，解壓前就擋（沒附背景圖的話卡片驗證也不過）
    const sixteen: Card = { ...base, front: { layers: layers.slice(0, 8) }, back: { layers: layers.slice(8) } };
    expect(reason(await importHolocard(holocard(sixteen, { ...layerFiles, ...backdropFile }), opts))).toBe('too-large');
    expect(reason(await importHolocard(holocard(sixteen, layerFiles), opts))).not.toBe('ok');
  });

  it('舊卡（沒有 backdrop）照讀；沒用到的圖照樣檢查但不匯入', async () => {
    const fx = await fixture();
    const { backdrop: _b, ...view } = fx.card.view;
    const result = await importHolocard(holocard({ ...fx.card, view }, fx.files), opts);
    expect(reason(result)).toBe('ok');
    if (result.ok) {
      expect('backdrop' in result.card.view).toBe(false);
      expect(result.images.map((i) => i.hash)).not.toContain(fx.backdrop.hash);
    }
  });
});
