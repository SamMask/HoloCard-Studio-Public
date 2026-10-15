// 展示廳畫好的大廳（T-816，app/gallery-hall）：第一次要用時才讀（舞台是展示廳、而且這張卡沒有自己的背景圖才讀，開工坊時不讀）；
// 只讀一次；讀好通知畫面重畫、之後拿得到網址；讀不到不丟錯，先照以前（深藍底＋石地板）畫，至少隔 10 秒之後下次狀態改變才再試
// （照 T-815b 水鏡遠景的做法）。時間由測試注入。
import { describe, expect, it, vi } from 'vitest';
import { createGalleryHall, GALLERY_HALL_RETRY_MS } from '../src/app/gallery-hall';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle } from '../src/model/types';
import { flush } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const card = (stage: StageStyle): Card => updateCard(newCard('standard', 'c1', T0), { view: { stage } });

/** 假的 <img>（讀好的 blob 網址＋寬高）。 */
const img = (w = 2048, h = 1152, src = 'blob:hall') => ({ src, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement;

function setup() {
  let time = 1_000_000;
  let asked = 0;
  let pending: { resolve: (i: HTMLImageElement) => void; reject: (e: unknown) => void } | null = null;
  let loaded = 0;
  const failures: unknown[] = [];
  const revoked: string[] = [];
  const hall = createGalleryHall({
    load: () =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        asked++;
        pending = { resolve, reject };
      }),
    loaded: () => loaded++,
    failed: (err) => failures.push(err),
    revoke: (url) => revoked.push(url),
    now: () => time,
  });
  return {
    hall,
    failures,
    revoked,
    asked: () => asked,
    loaded: () => loaded,
    resolve: (i: HTMLImageElement) => pending!.resolve(i),
    reject: (e: unknown) => pending!.reject(e),
    advance: (ms: number) => void (time += ms),
  };
}

describe('第一次要用時才讀', () => {
  it('不是展示廳：不讀', () => {
    const t = setup();
    for (const stage of ['halo', 'magic', 'water', 'nebula', 'none'] as const) t.hall.want(card(stage));
    expect(t.asked()).toBe(0);
    expect(t.hall.url()).toBeUndefined();
  });

  it('展示廳但這張卡有自己的背景圖（背景圖取代大廳）：不讀；拿掉背景圖才讀', () => {
    const t = setup();
    t.hall.want(setBackdrop(card('gallery'), 'bbbbbbbbbbbbbbb1'));
    expect(t.asked()).toBe(0);
    t.hall.want(card('gallery'));
    expect(t.asked()).toBe(1);
  });

  it('展示廳：讀一次；讀的途中、讀好之後再要都不重讀', async () => {
    const t = setup();
    t.hall.want(card('gallery'));
    t.hall.want(card('gallery'));
    expect(t.asked()).toBe(1);
    t.resolve(img());
    await flush();
    t.hall.want(card('gallery'));
    expect(t.asked()).toBe(1);
  });

  it('讀好之前網址是空的（先照以前畫）；讀好通知重畫一次，之後拿得到網址', async () => {
    const t = setup();
    t.hall.want(card('gallery'));
    expect(t.hall.url()).toBeUndefined();
    t.resolve(img());
    await flush();
    expect(t.loaded()).toBe(1);
    expect(t.hall.url()).toBe('blob:hall');
  });

  it('解出來是 0×0 的圖：當作讀不到（網址還是空的、交給 failed，冷卻中不重讀）', async () => {
    const t = setup();
    t.hall.want(card('gallery'));
    t.resolve(img(0, 0));
    await flush();
    expect(t.hall.url()).toBeUndefined();
    expect(t.failures.length).toBe(1);
    t.hall.want(card('gallery'));
    expect(t.asked()).toBe(1);
  });

  it('解出來是 0×0：被拒的 blob 網址要收回（不然每次重試都多留一個）；讀好的不收回', async () => {
    const t = setup();
    t.hall.want(card('gallery'));
    t.resolve(img(0, 0, 'blob:empty'));
    await flush();
    expect(t.revoked).toEqual(['blob:empty']);
    t.advance(GALLERY_HALL_RETRY_MS);
    t.hall.want(card('gallery'));
    expect(t.asked()).toBe(2);
    t.resolve(img(2048, 1152, 'blob:ok'));
    await flush();
    expect(t.hall.url()).toBe('blob:ok');
    // 讀好的留著（之後切舞台、換卡也不收回）
    for (const stage of ['halo', 'water', 'gallery'] as const) t.hall.want(card(stage));
    expect(t.revoked).toEqual(['blob:empty']);
  });

  it('寬或高其中一個是 0 也一樣收回；沒注入 revoke 時用 URL.revokeObjectURL', async () => {
    const t = setup();
    t.hall.want(card('gallery'));
    t.resolve(img(0, 1152, 'blob:no-width'));
    await flush();
    t.advance(GALLERY_HALL_RETRY_MS);
    t.hall.want(card('gallery'));
    t.resolve(img(2048, 0, 'blob:no-height'));
    await flush();
    expect(t.revoked).toEqual(['blob:no-width', 'blob:no-height']);

    const spy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const hall = createGalleryHall({
        load: () => Promise.resolve(img(0, 0, 'blob:default-path')),
        loaded: () => {},
        failed: () => {},
      });
      hall.want(card('gallery'));
      await flush();
      expect(spy).toHaveBeenCalledWith('blob:default-path');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('讀不到', () => {
  it('不丟錯、交給 failed；10 秒內再要不重讀，過了 10 秒下次要才重讀；讀好之後就有網址', async () => {
    const t = setup();
    t.hall.want(card('gallery'));
    t.reject(new Error('404'));
    await flush();
    expect(t.failures.length).toBe(1);
    expect(t.hall.url()).toBeUndefined();
    // 冷卻中：拖滑桿等每次狀態改變都會 want，請求不能跟著一直打
    for (let i = 0; i < 20; i++) {
      t.advance(GALLERY_HALL_RETRY_MS / 25);
      t.hall.want(card('gallery'));
    }
    expect(t.asked()).toBe(1);
    t.advance(GALLERY_HALL_RETRY_MS);
    t.hall.want(card('gallery'));
    expect(t.asked()).toBe(2);
    t.resolve(img());
    await flush();
    expect(t.hall.url()).toBe('blob:hall');
  });

  it('冷卻時間是 10 秒', () => {
    expect(GALLERY_HALL_RETRY_MS).toBe(10_000);
  });
});
