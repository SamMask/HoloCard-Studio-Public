// 展示廳浮著的卡（T-410）：挑哪幾張（不含目前這張、要有縮圖、最近編輯的先、最多 6 張）、解碼快取、收回、
// 換卡才重讀、舊的結果晚到時丟掉。
import { describe, expect, it, vi } from 'vitest';
import { createGalleryFeed, GALLERY_CARD_MAX, pickGalleryCards, type FloatingThumb } from '../src/app/gallery-thumbs';
import { MAX_GALLERY_CARDS } from '../src/render/gallery-layout';
import type { CardSummary } from '../src/storage/types';

const blob = (tag: string) => new Blob([tag], { type: 'image/webp' });

function summary(id: string, updatedAt: string, thumbnail = true): CardSummary {
  const s: CardSummary = { id, name: id, aspect: 'standard', createdAt: '2026-10-01T00:00:00.000Z', updatedAt };
  if (thumbnail) s.thumbnail = blob(id);
  return s;
}

const at = (minute: number) => `2026-10-14T08:${String(minute).padStart(2, '0')}:00.000Z`;

describe('pickGalleryCards', () => {
  it('不含目前這張、沒有縮圖的跳過、最近編輯的先', () => {
    const cards = [summary('a', at(1)), summary('cur', at(9)), summary('b', at(5)), summary('nothumb', at(8), false), summary('c', at(3))];
    expect(pickGalleryCards(cards, 'cur').map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('最多 6 張（和 render 的位置數一樣）', () => {
    expect(GALLERY_CARD_MAX).toBe(MAX_GALLERY_CARDS);
    const cards = Array.from({ length: 10 }, (_, i) => summary(`k${i}`, at(i)));
    const picked = pickGalleryCards(cards, null);
    expect(picked.length).toBe(6);
    expect(picked.map((c) => c.id)).toEqual(['k9', 'k8', 'k7', 'k6', 'k5', 'k4']);
  });

  it('卡片庫只有目前這張：空的（render 改用玻璃卡）', () => {
    expect(pickGalleryCards([summary('cur', at(1))], 'cur')).toEqual([]);
    expect(pickGalleryCards([], 'cur')).toEqual([]);
  });

  it('不改傳進來的陣列', () => {
    const cards = [summary('a', at(1)), summary('b', at(2))];
    const copy = [...cards];
    pickGalleryCards(cards, null);
    expect(cards).toEqual(copy);
  });
});

/** 假的 ImageBitmap：記住是誰、有沒有被 close。 */
class FakeBitmap {
  closed = false;
  constructor(
    readonly tag: string,
    readonly width = 340,
    readonly height = 460,
  ) {}
  close() {
    this.closed = true;
  }
}

function feedSetup(list: () => CardSummary[]) {
  const decoded: FakeBitmap[] = [];
  const shown: FloatingThumb[][] = [];
  const decode = vi.fn(async (b: Blob) => {
    const bmp = new FakeBitmap(await b.text());
    decoded.push(bmp);
    return bmp as unknown as ImageBitmap;
  });
  const feed = createGalleryFeed({ list: async () => list(), decode, show: (t) => shown.push(t) });
  return { feed, decode, decoded, shown };
}

const tags = (thumbs: FloatingThumb[]) => thumbs.map((t) => (t.image as unknown as FakeBitmap).tag);

/** 等 Promise 的後續都跑完。 */
async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe('createGalleryFeed', () => {
  it('交給畫面：解碼過的圖＋寬高，順序同 pickGalleryCards', async () => {
    const { feed, shown } = feedSetup(() => [summary('a', at(1)), summary('b', at(2)), summary('cur', at(3))]);
    await feed.want('cur');
    expect(shown.length).toBe(1);
    expect(tags(shown[0]!)).toEqual(['b', 'a']);
    expect(shown[0]![0]!.width).toBe(340);
    expect(shown[0]![0]!.height).toBe(460);
  });

  it('同一張卡再要一次不重讀；換卡才重讀，沒變的縮圖不重新解碼', async () => {
    let cards = [summary('a', at(1)), summary('b', at(2)), summary('c', at(3))];
    const { feed, decode, shown } = feedSetup(() => cards);
    await feed.want('a');
    expect(decode).toHaveBeenCalledTimes(2); // b、c
    await feed.want('a');
    expect(shown.length).toBe(1);
    await feed.want('b');
    expect(tags(shown[1]!)).toEqual(['c', 'a']);
    expect(decode).toHaveBeenCalledTimes(3); // 只多解 a
    // 卡片庫有變（force）：同一張也重讀
    cards = [...cards, summary('d', at(4))];
    await feed.want('b', true);
    expect(tags(shown[2]!)).toEqual(['d', 'c', 'a']);
  });

  it('不在最新清單裡的圖收回（close）；編輯過的卡（updatedAt 變了）換新縮圖', async () => {
    let cards = [summary('a', at(1)), summary('b', at(2))];
    const { feed, decoded } = feedSetup(() => cards);
    await feed.want('x');
    const oldA = decoded.find((d) => d.tag === 'a')!;
    cards = [summary('a', at(7)), summary('b', at(2))];
    await feed.want('x', true);
    await Promise.resolve();
    expect(oldA.closed).toBe(true);
    expect(decoded.filter((d) => d.tag === 'a').length).toBe(2);
    expect(decoded.find((d) => d.tag === 'b')!.closed).toBe(false);
  });

  it('舊的要求晚到：結果丟掉，不蓋掉新的', async () => {
    let release: (v: CardSummary[]) => void = () => {};
    const slow = new Promise<CardSummary[]>((r) => (release = r));
    const lists = [() => slow, async () => [summary('n', at(2))]];
    const shown: FloatingThumb[][] = [];
    const feed = createGalleryFeed({
      list: () => lists.shift()!(),
      decode: async (b) => new FakeBitmap(await b.text()) as unknown as ImageBitmap,
      show: (t) => shown.push(t),
    });
    const first = feed.want('a');
    await feed.want('b');
    release([summary('old', at(1))]);
    await first;
    expect(shown.length).toBe(1);
    expect(tags(shown[0]!)).toEqual(['n']);
  });

  it('晚到的要求（清單比新的要求晚回來）：不解碼、不寫快取、不留下圖（T-410c）', async () => {
    let release: (v: CardSummary[]) => void = () => {};
    const slow = new Promise<CardSummary[]>((r) => (release = r));
    const lists = [() => slow, async () => [summary('n', at(2))]];
    const decoded: FakeBitmap[] = [];
    const shown: FloatingThumb[][] = [];
    const feed = createGalleryFeed({
      list: () => lists.shift()!(),
      decode: async (b) => {
        const bmp = new FakeBitmap(await b.text());
        decoded.push(bmp);
        return bmp as unknown as ImageBitmap;
      },
      show: (t) => shown.push(t),
    });
    const first = feed.want('a');
    await feed.want('b');
    expect(decoded.map((d) => d.tag)).toEqual(['n']);
    release([summary('old1', at(1)), summary('old2', at(3))]);
    await first;
    await flushMicrotasks();
    // 舊的那批連解碼都沒有
    expect(decoded.map((d) => d.tag)).toEqual(['n']);
    expect(tags(shown.at(-1)!)).toEqual(['n']);
  });

  it('晚到的要求（解碼到一半被新的要求超車）：自己解出來的圖收回、不進快取；畫面上的圖不動（T-410c）', async () => {
    const gates = new Map<string, () => void>();
    const decoded: FakeBitmap[] = [];
    const shown: FloatingThumb[][] = [];
    let cards = [summary('slow', at(5)), summary('keep', at(4))];
    const feed = createGalleryFeed({
      list: async () => cards,
      decode: async (b) => {
        const tag = await b.text();
        if (tag === 'slow') await new Promise<void>((r) => gates.set(tag, r));
        const bmp = new FakeBitmap(tag);
        decoded.push(bmp);
        return bmp as unknown as ImageBitmap;
      },
      show: (t) => shown.push(t),
    });
    const first = feed.want('x');
    await flushMicrotasks();
    // 新的要求：卡片庫變了（slow 被刪掉），先完成
    cards = [summary('keep', at(4)), summary('other', at(3))];
    await feed.want('x', true);
    expect(tags(shown.at(-1)!)).toEqual(['keep', 'other']);
    // 舊要求的慢解碼這時才回來
    gates.get('slow')!();
    await first;
    await flushMicrotasks();
    const slow = decoded.find((d) => d.tag === 'slow')!;
    expect(slow.closed).toBe(true);
    expect(shown.length).toBe(1);
    // 畫面上的圖都還能用（沒有被收回）
    for (const t of shown.at(-1)!) expect((t.image as unknown as FakeBitmap).closed).toBe(false);
    // 快取裡沒有 slow：之後卡片庫又有它時要重新解碼
    cards = [summary('slow', at(5)), summary('keep', at(4))];
    const again = feed.want('x', true);
    await flushMicrotasks();
    gates.get('slow')!();
    await again;
    expect(decoded.filter((d) => d.tag === 'slow').length).toBe(2);
  });

  it('連續很多個晚到的要求：快取不會超過 6 張，沒顯示的圖都收回', async () => {
    const releases: ((v: CardSummary[]) => void)[] = [];
    const decoded: FakeBitmap[] = [];
    let shownNow: FloatingThumb[] = [];
    const feed = createGalleryFeed({
      list: () => new Promise<CardSummary[]>((r) => releases.push(r)),
      decode: async (b) => {
        const bmp = new FakeBitmap(await b.text());
        decoded.push(bmp);
        return bmp as unknown as ImageBitmap;
      },
      show: (t) => (shownNow = t),
    });
    const runs = Array.from({ length: 5 }, (_, i) => feed.want(`cur${i}`));
    // 最新的先回來，其他（舊的）之後才回來
    releases[4]!(Array.from({ length: 8 }, (_, k) => summary(`new${k}`, at(10 + k))));
    await runs[4];
    for (let i = 0; i < 4; i++) releases[i]!(Array.from({ length: 8 }, (_, k) => summary(`old${i}-${k}`, at(k))));
    await Promise.all(runs);
    await flushMicrotasks();
    const alive = decoded.filter((d) => !d.closed);
    expect(alive.length).toBeLessThanOrEqual(6);
    expect(new Set(alive)).toEqual(new Set(shownNow.map((t) => t.image as unknown as FakeBitmap)));
  });

  it('解不開的縮圖跳過、讀不到清單不丟錯', async () => {
    const shown: FloatingThumb[][] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const feed = createGalleryFeed({
      list: async () => [summary('bad', at(2)), summary('ok', at(1))],
      decode: async (b) => {
        const tag = await b.text();
        if (tag === 'bad') throw new Error('壞掉的圖');
        return new FakeBitmap(tag) as unknown as ImageBitmap;
      },
      show: (t) => shown.push(t),
    });
    await feed.want('x');
    expect(tags(shown[0]!)).toEqual(['ok']);
    const broken = createGalleryFeed({ list: () => Promise.reject(new Error('讀不到')), decode: vi.fn(), show: (t) => shown.push(t) });
    await expect(broken.want('x')).resolves.toBeUndefined();
    expect(shown.length).toBe(1);
    errors.mockRestore();
  });
});
