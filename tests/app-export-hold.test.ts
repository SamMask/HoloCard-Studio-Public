import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutoSaver, THUMBNAIL_IDLE_MS } from '../src/app/autosave';
import type { StoredImage } from '../src/images/types';
import { addLayer, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';

// T-512（T-509b 審查中②③）：轉動影片／GIF 匯出中，3D 預覽畫的是開始時複製的那份卡。
// ③ 這段時間不拍縮圖（拍到的是副本，不是編輯中的最新版），卡片資料照常存；匯出收尾後補拍目前這一版。
// ② 匯出中換卡：副本用到的圖要保留到匯出收尾（登記簿的 hold）——T-512b 起走真正的匯出組裝測，在 app-turntable-export.test.ts。

const T0 = '2026-10-14T00:00:00.000Z';
const hashOf = (n: number) => n.toString(16).padStart(16, '0');

function image(n: number): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width: 64, height: 96, hasAlpha: n % 2 === 0 };
}

function cardWith(id: string, imageNumbers: number[]): Card {
  let card = newCard('standard', id, T0);
  imageNumbers.forEach((n, i) => {
    const img = image(n);
    const r = addLayer(card, 'front', { id: `${id}-${i}`, name: `圖 ${n}`, image: img.hash, hasAlpha: img.hasAlpha, width: 64, height: 96 });
    if (!r.ok) throw new Error(r.reason);
    card = r.card;
  });
  return card;
}

/** 只記錄的假存檔（縮圖只有資料庫裡是同一版才寫）。 */
function fakeStore() {
  const saved = new Map<string, { card: Card; thumbnail?: Blob }>();
  return {
    saved,
    thumbWrites: [] as string[],
    async saveImage() {},
    async save(card: Card) {
      saved.set(card.id, { card: structuredClone(card), thumbnail: saved.get(card.id)?.thumbnail });
    },
    async saveThumbnail(id: string, updatedAt: string, thumbnail: Blob) {
      const record = saved.get(id);
      if (!record || record.card.updatedAt !== updatedAt) return false;
      record.thumbnail = thumbnail;
      this.thumbWrites.push(id);
      return true;
    },
    async setMeta() {},
    async estimate() {
      return null;
    },
  };
}

function setupSaver(card: Card, thumbnail?: () => Promise<Blob | null>) {
  const store = fakeStore();
  let current = card;
  let shots = 0;
  const saver = createAutoSaver({
    store,
    current: () => current,
    image: (h) => image(parseInt(h, 16)),
    thumbnail:
      thumbnail ??
      (async () => {
        shots++;
        return new Blob([`thumb-${current.name}`], { type: 'image/png' });
      }),
    onStatus: () => {},
    onStorageLow: () => {},
  });
  return {
    store,
    saver,
    shots: () => shots,
    get card() {
      return current;
    },
    set card(c: Card) {
      current = c;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('匯出中先不拍縮圖（holdThumbnails）', () => {
  it('匯出中：卡片照常存，但不拍縮圖（flush 要縮圖、停手 2 秒的縮圖都不拍）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setupSaver(cardWith('c1', [1]));
    await t.saver.flush();
    const release = t.saver.holdThumbnails();
    t.card = updateCard(t.card, { name: '匯出中改的' });
    t.saver.changed();
    expect(await t.saver.flush({ thumbnail: true })).toBe(true);
    await vi.advanceTimersByTimeAsync(THUMBNAIL_IDLE_MS + 10);
    expect(t.store.saved.get('c1')!.card.name).toBe('匯出中改的');
    expect(t.shots()).toBe(0);
    expect(t.store.thumbWrites).toEqual([]);
    release();
  });

  it('匯出收尾（放開）：馬上補拍目前這一版的縮圖', async () => {
    const t = setupSaver(cardWith('c1', [1]));
    const release = t.saver.holdThumbnails();
    t.card = updateCard(t.card, { name: '最新版' });
    await t.saver.flush({ thumbnail: true });
    expect(t.shots()).toBe(0);
    release();
    await vi.waitFor(() => expect(t.store.thumbWrites).toEqual(['c1']));
    expect(t.shots()).toBe(1);
    expect(await t.store.saved.get('c1')!.thumbnail!.text()).toBe('thumb-最新版');
  });

  it('匯出開始前就在拍的縮圖：不等了、不寫（拍到的可能是副本）', async () => {
    let finish: (b: Blob | null) => void = () => {};
    const t = setupSaver(cardWith('c1', [1]), () => new Promise<Blob | null>((resolve) => (finish = resolve)));
    const done = t.saver.flush({ thumbnail: true });
    await vi.waitFor(() => expect(t.store.saved.has('c1')).toBe(true));
    const release = t.saver.holdThumbnails();
    expect(await done).toBe(true);
    finish(new Blob(['late'], { type: 'image/png' }));
    await Promise.resolve();
    expect(t.store.thumbWrites).toEqual([]);
    release();
  });

  it('兩次匯出疊在一起：兩個都放開才補拍；同一個放開呼叫兩次只算一次', async () => {
    const t = setupSaver(cardWith('c1', [1]));
    const a = t.saver.holdThumbnails();
    const b = t.saver.holdThumbnails();
    a();
    a();
    await t.saver.flush({ thumbnail: true });
    expect(t.shots()).toBe(0);
    b();
    await vi.waitFor(() => expect(t.shots()).toBe(1));
  });

  it('交接中（另一個分頁接手）放開：不拍（交接不等縮圖）', async () => {
    const t = setupSaver(cardWith('c1', [1]));
    await t.saver.flush();
    const release = t.saver.holdThumbnails();
    t.saver.pauseThumbnails();
    release();
    await t.saver.flush({ thumbnail: true });
    expect(t.shots()).toBe(0);
  });

  it('已經停住（交出去了）才放開：什麼都不寫', async () => {
    const t = setupSaver(cardWith('c1', [1]));
    await t.saver.flush();
    const release = t.saver.holdThumbnails();
    await t.saver.suspend();
    release();
    await Promise.resolve();
    expect(t.shots()).toBe(0);
    expect(t.store.thumbWrites).toEqual([]);
  });
});
