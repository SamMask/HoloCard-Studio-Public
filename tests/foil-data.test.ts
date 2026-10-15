// 反光層（T-417）的資料流：黑白圖算「有在用」（存檔、刪卡、清圖、換卡、複製、匯出入）；舊卡（holo.scope）讀進來時轉換。
import { unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { cardImageHashes } from '../src/app/autosave';
import { createSession } from '../src/app/session';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard, updateFoil } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { faceFoil } from '../src/model/foil';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { DB_NAME, DB_VERSION } from '../src/storage/types';
import { buildZip, makePng, makeWebp, stored, utf8, type ZipItem } from './file-fixtures';

const T0 = '2026-10-14T00:00:00.000Z';
const LATER = '2026-10-14T08:30:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

/** 正面：底圖 1＋立體層 2；正面反光層用黑白圖 9（背面沒有圖層）。 */
function maskedCard(id: string, mask = 9): Card {
  let card = newCard('standard', id, T0);
  for (const n of [1, 2]) {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${n}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  }
  return updateFoil(card, 'front', { shape: 'mask', mask: hashOf(mask) });
}

function rawPut(factory: IDBFactory, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('存檔（IndexedDB）', () => {
  it('黑白圖要先存才存得進卡（和圖層的圖一樣驗）', async () => {
    const store = await openCardStore(new IDBFactory());
    const card = maskedCard('a');
    for (const n of [1, 2]) await store.saveImage(image(n));
    await expect(store.save(card)).rejects.toThrow(/front\.foil\.mask/);
    await store.saveImage(image(9));
    await store.save(card);
    expect(faceFoil((await store.load('a'))!.front)).toEqual({ shape: 'mask', mask: hashOf(9), frame: true });
  });

  it('清沒用的圖（cleanupImages）不收黑白圖；刪卡時只刪這張卡獨用的黑白圖', async () => {
    const store = await openCardStore(new IDBFactory());
    for (const n of [1, 2, 9, 11]) await store.saveImage(image(n));
    await store.save(maskedCard('a'));
    await store.save(maskedCard('b'));
    await store.save(maskedCard('c', 11));
    expect(await store.cleanupImages()).toBe(0);
    await store.remove('c');
    expect(await store.loadImage(hashOf(11))).toBeUndefined();
    await store.remove('a');
    expect(await store.loadImage(hashOf(9))).toBeDefined(); // b 還在用
    await store.remove('b');
    expect(await store.loadImage(hashOf(9))).toBeUndefined();
  });

  it('舊卡（有 holo.scope、沒有 foil）：讀出來已經轉好、清單也列得出來；下次存就沒有 scope', async () => {
    const factory = new IDBFactory();
    const store = await openCardStore(factory);
    for (const n of [1, 2]) await store.saveImage(image(n));
    const modern = maskedCard('x');
    const old = { ...modern, id: 'old', front: { layers: modern.front.layers }, holo: { ...modern.holo, scope: 'layers' } };
    await rawPut(factory, 'cards', 'old', { card: old });
    const loaded = (await store.load('old'))!;
    expect(loaded).toBeDefined();
    expect('scope' in loaded.holo).toBe(false);
    expect(loaded.front.foil).toEqual({ shape: 'layers', frame: false });
    expect(loaded.back.foil).toEqual({ shape: 'layers', frame: false });
    expect((await store.list()).map((s) => s.id)).toEqual(['old']);
    await store.save(loaded);
    expect('scope' in (await store.load('old'))!.holo).toBe(false);
  });
});

describe('換卡、複製（app/session）：黑白圖一起帶、不被收掉', () => {
  it('cardImageHashes 含黑白圖', () => {
    expect(cardImageHashes(maskedCard('a'))).toEqual([hashOf(1), hashOf(2), hashOf(9)]);
  });

  it('打開有黑白圖的卡：黑白圖從存檔載入登記簿；換卡 retain 留著它；複製一份也帶著', async () => {
    const store = await openCardStore(new IDBFactory());
    for (const n of [1, 2, 9]) await store.saveImage(image(n));
    await store.save(maskedCard('a'));
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
    expect([...registry.keys()].sort()).toEqual([hashOf(1), hashOf(2), hashOf(9)]);
    const copy = await session.duplicate('a', { newId: () => 'a2', now: () => LATER });
    expect(copy.ok && copy.card.front.foil).toEqual({ shape: 'mask', mask: hashOf(9), frame: true });
    // 開複製的那張：圖（含黑白圖）都還在
    current = updateCard(current!, {});
    expect(await session.open('a2')).toBe('opened');
    expect(registry.has(hashOf(9))).toBe(true);
  });
});

describe('卡片檔 .holocard', () => {
  async function fixture() {
    const baseBytes = makeWebp({ kind: 'lossy', width: 100, height: 140, seed: 1 });
    const maskBytes = makePng({ width: 8, height: 8, seed: 7 });
    const backMaskBytes = makePng({ width: 8, height: 8, seed: 8 });
    const base = await stored(baseBytes, 'image/webp', 100, 140, false);
    const mask = await stored(maskBytes, 'image/png', 8, 8, false);
    const backMask = await stored(backMaskBytes, 'image/png', 8, 8, false);
    let card: Card = newCard('standard', 'card-1', T0);
    const r = addLayer(card, 'front', { id: 'base', name: '底圖', image: base.hash, hasAlpha: false, width: 100, height: 140 });
    if (!r.ok) throw new Error(r.reason);
    card = updateFoil(r.card, 'front', { shape: 'mask', mask: mask.hash, frame: false });
    // 背面：保留著黑白圖、但形狀是整面（切回來還在）
    card = updateFoil(updateFoil(card, 'back', { shape: 'mask', mask: backMask.hash }), 'back', { shape: 'full' });
    card = updateCard(card, { holo: { matte: 60 } });
    const images = new Map([base, mask, backMask].map((i) => [i.hash, i] as const));
    const files: Record<string, Uint8Array> = {
      [`images/${base.hash}.webp`]: baseBytes,
      [`images/${mask.hash}.png`]: maskBytes,
      [`images/${backMask.hash}.png`]: backMaskBytes,
    };
    return { card, images, files, mask, backMask };
  }
  const preview = () => new Blob([makePng({ width: 8, height: 8, seed: 99 })], { type: 'image/png' });
  const holocard = (card: unknown, files: Record<string, Uint8Array>) => {
    const items: ZipItem[] = [{ name: 'card.json', data: utf8(JSON.stringify(card)) }];
    for (const [name, data] of Object.entries(files)) items.push({ name, data, method: 0 });
    return new Blob([buildZip(items)]);
  };
  const opts = { newId: () => 'imported', now: () => LATER };

  it('匯出：黑白圖一起打包（含保留著的）；匯入：來回不掉', async () => {
    const fx = await fixture();
    const blob = await exportHolocard(fx.card, async (h) => fx.images.get(h), preview());
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    const json = JSON.parse(new TextDecoder().decode(files['card.json']));
    expect(json.front.foil).toEqual({ shape: 'mask', mask: fx.mask.hash, frame: false });
    expect(json.back.foil).toEqual({ shape: 'full', mask: fx.backMask.hash, frame: true });
    expect(json.holo.matte).toBe(60);

    const result = await importHolocard(blob, opts);
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...fx.card, id: 'imported', createdAt: LATER, updatedAt: LATER });
    expect(result.images.map((i) => i.hash).sort()).toEqual([...fx.images.keys()].sort());
  });

  it('匯出時預設值省略：整面＋卡框也反光的 foil、霧光 35 不寫', async () => {
    const fx = await fixture();
    const plain: Card = {
      ...fx.card,
      front: { layers: fx.card.front.layers, foil: { shape: 'full', frame: true } },
      back: { layers: [] },
      holo: { ...fx.card.holo, matte: 35 },
    };
    const blob = await exportHolocard(plain, async (h) => fx.images.get(h), preview());
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(new TextDecoder().decode(files['card.json']));
    expect('foil' in json.front).toBe(false);
    expect('foil' in json.back).toBe(false);
    expect('matte' in json.holo).toBe(false);
    // 沒用到的黑白圖不打包
    expect(Object.keys(files).some((p) => p.includes(fx.mask.hash))).toBe(false);
  });

  it('匯入：卡片檔裡沒有黑白圖 → missing-image', async () => {
    const fx = await fixture();
    const files = { ...fx.files };
    delete files[`images/${fx.mask.hash}.png`];
    const result = await importHolocard(holocard(fx.card, files), opts);
    expect(result.ok ? 'ok' : result.reason).toBe('missing-image');
  });

  it('匯入：壞形狀、mask 形狀沒有圖、霧光超出範圍 → invalid-card', async () => {
    const fx = await fixture();
    const bad = (mutate: (c: Record<string, any>) => void) => {
      const c = structuredClone(fx.card) as Record<string, any>;
      mutate(c);
      return importHolocard(holocard(c, fx.files), opts).then((r) => (r.ok ? 'ok' : r.reason));
    };
    expect(await bad((c) => (c.front.foil.shape = 'half'))).toBe('invalid-card');
    expect(await bad((c) => delete c.front.foil.mask)).toBe('invalid-card');
    expect(await bad((c) => (c.holo.matte = 150))).toBe('invalid-card');
    expect(await bad((c) => (c.back.foil.frame = 1))).toBe('invalid-card');
  });

  it('匯入舊版卡片檔（holo.scope）：轉成兩面的反光層', async () => {
    const fx = await fixture();
    for (const [scope, foil] of [
      ['all', { shape: 'full', frame: true }],
      ['layers', { shape: 'layers', frame: false }],
      ['frame', { shape: 'none', frame: true }],
    ] as const) {
      const old = { ...fx.card, front: { layers: fx.card.front.layers }, back: { layers: [] }, holo: { ...fx.card.holo, scope } };
      const result = await importHolocard(holocard(old, fx.files), opts);
      if (!result.ok) throw new Error(`${scope}: ${result.reason} ${result.detail}`);
      expect('scope' in result.card.holo).toBe(false);
      expect(faceFoil(result.card.front)).toEqual(foil);
      expect(faceFoil(result.card.back)).toEqual(foil);
      // 'all' ＝ 預設：不寫出 foil
      expect('foil' in result.card.front).toBe(scope !== 'all');
    }
  });
});
