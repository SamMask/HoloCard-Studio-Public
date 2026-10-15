// 前景圖（T-830，view.foreground?）的資料流：前景圖算「有在用」（存檔驗證、刪卡、清圖、換卡用到的圖）；
// 卡片檔匯出帶這張圖、匯入照 SCHEMA §4 驗（圖要附、欄位範圍、圖片上限）；來回一致；舊卡（沒有 foreground）照讀。
import { strFromU8, unzipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { cardImageHashes } from '../src/app/autosave';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { ImportResult } from '../src/file/types';
import type { StoredImage } from '../src/images/types';
import { addLayer, setBackdrop, setForeground, updateCard } from '../src/model/actions';
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

/** 正面一個立體層（圖 layerImage），前景圖 fgImage。 */
function cardWithForeground(id: string, layerImage: number, fgImage: number): Card {
  const added = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-l`, name: '龍', image: hashOf(layerImage), hasAlpha: true, width: 64, height: 96 });
  if (!added.ok) throw new Error(added.reason);
  const card = setForeground(added.card, hashOf(fgImage));
  if (card.view.foreground?.image !== hashOf(fgImage)) throw new Error('前景圖沒有加上去');
  return card;
}

async function imageKeys(store: Awaited<ReturnType<typeof openCardStore>>, numbers: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const n of numbers) if (await store.loadImage(hashOf(n))) out.push(n);
  return out;
}

describe('資料庫：前景圖也算有在用', () => {
  it('前景圖要先存才存得進卡（和圖層的圖一樣驗）；存好讀得回', async () => {
    const store = await openCardStore(new IDBFactory());
    const card = cardWithForeground('a', 2, 4);
    await store.saveImage(image(2));
    await expect(store.save(card)).rejects.toThrow(/view\.foreground/);
    await store.saveImage(image(4));
    await store.save(card);
    expect(await store.load('a')).toEqual(card);
  });

  it('啟動清圖不收前景圖；刪別張卡不收；刪掉最後一張用它的卡才收', async () => {
    const store = await openCardStore(new IDBFactory());
    for (const n of [2, 4, 6, 8]) await store.saveImage(image(n));
    const a = cardWithForeground('a', 2, 4);
    const b = cardWithForeground('b', 6, 4);
    await store.save(a);
    await store.save(b);
    expect(await store.cleanupImages()).toBe(1); // 只有 8 是孤兒
    await store.remove('a');
    expect(await imageKeys(store, [2, 4, 6])).toEqual([4, 6]);
    expect(await store.load('b')).toEqual(b);
    await store.remove('b');
    expect(await imageKeys(store, [2, 4, 6])).toEqual([]);
  });

  it('自動存用到的圖含前景圖（排在背景圖後面）', () => {
    expect(cardImageHashes(cardWithForeground('a', 2, 4))).toEqual([hashOf(2), hashOf(4)]);
    expect(cardImageHashes(setBackdrop(cardWithForeground('a', 2, 4), hashOf(6)))).toEqual([hashOf(2), hashOf(6), hashOf(4)]);
  });
});

describe('卡片檔 .holocard', () => {
  const PREVIEW = makePng({ width: 8, height: 8, seed: 99 });
  const preview = () => new Blob([PREVIEW], { type: 'image/png' });
  const opts = { newId: () => 'imported', now: () => LATER };
  const reason = (r: ImportResult) => (r.ok ? 'ok' : r.reason);

  async function fixture() {
    const heroBytes = makeWebp({ kind: 'extended', width: 80, height: 120, alpha: true, seed: 2 });
    const fgBytes = makeWebp({ kind: 'extended', width: 160, height: 90, alpha: true, seed: 7 });
    const hero = await stored(heroBytes, 'image/webp', 80, 120, true);
    const fg = await stored(fgBytes, 'image/webp', 160, 90, true);
    const added = addLayer(newCard('standard', 'card-1', T0), 'front', { id: 'hero', name: '星晶龍', image: hero.hash, hasAlpha: true, width: 80, height: 120 });
    if (!added.ok) throw new Error(added.reason);
    const card = updateCard(setForeground(added.card, fg.hash), { view: { foreground: { x: 0.25, y: -0.5, scale: 1.5, blur: 60 } } });
    const images = new Map([hero, fg].map((s) => [s.hash, s] as const));
    const files: Record<string, Uint8Array> = { [`images/${hero.hash}.webp`]: heroBytes, [`images/${fg.hash}.webp`]: fgBytes };
    return { card, images, files, fg };
  }
  const holocard = (card: unknown, files: Record<string, Uint8Array>) => {
    const items: ZipItem[] = [{ name: 'card.json', data: utf8(JSON.stringify(card)) }];
    for (const [name, data] of Object.entries(files)) items.push({ name, data, method: 0 });
    items.push({ name: 'preview.png', data: PREVIEW, method: 0 });
    return new Blob([buildZip(items)]);
  };

  it('匯出：前景圖一起打包、card.json 裡有 view.foreground（位置、大小、模糊照存）', async () => {
    const fx = await fixture();
    const blob = await exportHolocard(fx.card, async (h) => fx.images.get(h), preview());
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['card.json', ...Object.keys(fx.files), 'preview.png'].sort());
    expect(JSON.parse(strFromU8(files['card.json']!)).view.foreground).toEqual({ image: fx.fg.hash, x: 0.25, y: -0.5, scale: 1.5, blur: 60 });
  });

  it('匯出時找不到前景圖 → 丟錯（不會匯出一個打不開的檔）', async () => {
    const fx = await fixture();
    await expect(exportHolocard(fx.card, async (h) => (h === fx.fg.hash ? undefined : fx.images.get(h)), preview())).rejects.toThrow(fx.fg.hash);
  });

  it('來回一致：匯出再匯入，卡片（除了新 id 與時間）一樣、前景圖也在回傳的圖裡', async () => {
    const fx = await fixture();
    const result = await importHolocard(await exportHolocard(fx.card, async (h) => fx.images.get(h), preview()), opts);
    if (!result.ok) throw new Error(`${result.reason} ${result.detail}`);
    expect(result.card).toEqual({ ...fx.card, id: 'imported', createdAt: LATER, updatedAt: LATER });
    expect(result.images.map((i) => i.hash)).toContain(fx.fg.hash);
  });

  it('匯入：用到的前景圖沒有附 → missing-image', async () => {
    const fx = await fixture();
    const { [`images/${fx.fg.hash}.webp`]: _gone, ...rest } = fx.files;
    const result = await importHolocard(holocard(fx.card, rest), opts);
    expect(reason(result)).toBe('missing-image');
    expect(!result.ok && result.detail).toContain(fx.fg.hash);
  });

  it('匯入壞值：範圍外、模糊不是整數、雜湊格式不對、多欄位 → invalid-card（指到 view.foreground）', async () => {
    const fx = await fixture();
    const good = fx.card.view.foreground!;
    for (const bad of [{ ...good, x: 2 }, { ...good, scale: 0.1 }, { ...good, blur: 12.5 }, { ...good, image: 'ABCDEF' }, { ...good, spin: 1 }, fx.fg.hash]) {
      const result = await importHolocard(holocard({ ...fx.card, view: { ...fx.card.view, foreground: bad } }, fx.files), opts);
      expect(reason(result), JSON.stringify(bad)).toBe('invalid-card');
      expect(!result.ok && result.detail).toMatch(/view\.foreground/);
    }
  });

  it('圖片上限：15 張圖層＋前景圖（剛好 16 張）照樣匯入；15 張圖層＋背景圖＋前景圖（17 張）匯入不了', async () => {
    const fx = await fixture();
    const layerFiles: Record<string, Uint8Array> = {};
    const layers: Card['front']['layers'] = [];
    for (let i = 0; i < 15; i++) {
      const bytes = makePng({ width: 4, height: 4, seed: 300 + i });
      const s = await stored(bytes, 'image/png', 4, 4, true);
      layerFiles[`images/${s.hash}.png`] = bytes;
      layers.push({ id: `l${i}`, name: `圖${i}`, role: 'depth', image: s.hash, visible: true, depth: 50, x: 0, y: 0, scale: 1, holo: true, hasAlpha: true });
    }
    const fgFile = { [`images/${fx.fg.hash}.webp`]: fx.files[`images/${fx.fg.hash}.webp`]! };
    const base = setForeground(newCard('standard', 'card-1', T0), fx.fg.hash);
    const fifteen: Card = { ...base, front: { layers: layers.slice(0, 8) }, back: { layers: layers.slice(8) } };
    expect(reason(await importHolocard(holocard(fifteen, { ...layerFiles, ...fgFile }), opts))).toBe('ok');
    const bdBytes = makeWebp({ kind: 'lossy', width: 32, height: 18, seed: 9 });
    const bd = await stored(bdBytes, 'image/webp', 32, 18, false);
    const over = { ...fifteen, view: { ...fifteen.view, backdrop: bd.hash } };
    expect(reason(await importHolocard(holocard(over, { ...layerFiles, ...fgFile, [`images/${bd.hash}.webp`]: bdBytes }), opts))).not.toBe('ok');
  });

  it('舊卡（沒有 foreground）照讀；沒用到的圖照樣檢查但不匯入', async () => {
    const fx = await fixture();
    const { foreground: _f, ...view } = fx.card.view;
    const result = await importHolocard(holocard({ ...fx.card, view }, fx.files), opts);
    expect(reason(result)).toBe('ok');
    if (result.ok) {
      expect('foreground' in result.card.view).toBe(false);
      expect(result.images.map((i) => i.hash)).not.toContain(fx.fg.hash);
    }
  });
});
