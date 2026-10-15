// 星雲漩渦大圖（T-817，app/nebula-swirl）：第一次要用時才讀（舞台是星雲、而且這張卡沒有自己的背景圖才讀，開工坊時不讀）；
// 只讀一次；讀好通知畫面重畫、之後拿得到同一個圖物件（render 用它比對是不是同一張）；讀不到不丟錯，先照程式漩渦畫，
// 至少隔 10 秒之後下次狀態改變才再試（照 T-815b／T-816）；解出來 0×0 當讀不到、收回 blob 網址（T-816b 的教訓）。
// 怎麼讀（同源、不跟著轉址）由 main 注入：main 用同一個 loadImage（SAME_ORIGIN_FETCH）讀 stages/nebula.webp。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNebulaSwirl, NEBULA_SWIRL_RETRY_MS } from '../src/app/nebula-swirl';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle } from '../src/model/types';
import { flush } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const card = (stage: StageStyle): Card => updateCard(newCard('standard', 'c1', T0), { view: { stage } });

/** 假的 <img>（讀好的 blob 網址＋寬高）。 */
const img = (w = 2048, h = 2048, src = 'blob:nebula') => ({ src, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement;

function setup() {
  let time = 1_000_000;
  let asked = 0;
  let pending: { resolve: (i: HTMLImageElement) => void; reject: (e: unknown) => void } | null = null;
  let loaded = 0;
  const failures: unknown[] = [];
  const revoked: string[] = [];
  const swirl = createNebulaSwirl({
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
    swirl,
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
  it('不是星雲：不讀', () => {
    const t = setup();
    for (const stage of ['halo', 'gallery', 'magic', 'water', 'none'] as const) t.swirl.want(card(stage));
    expect(t.asked()).toBe(0);
    expect(t.swirl.image()).toBeNull();
  });

  it('星雲但這張卡有自己的背景圖（大圖讓出來）：不讀；拿掉背景圖才讀', () => {
    const t = setup();
    t.swirl.want(setBackdrop(card('nebula'), 'bbbbbbbbbbbbbbb1'));
    expect(t.asked()).toBe(0);
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(1);
  });

  it('星雲：讀一次；讀的途中、讀好之後再要都不重讀；讀好通知一次，拿得到同一個圖物件（原圖寬高）', async () => {
    const t = setup();
    t.swirl.want(card('nebula'));
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(1);
    expect(t.swirl.image()).toBeNull();
    const i = img();
    t.resolve(i);
    await flush();
    expect(t.loaded()).toBe(1);
    const got = t.swirl.image();
    expect(got).toEqual({ image: i, width: 2048, height: 2048 });
    expect(t.swirl.image()).toBe(got);
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(1);
    expect(t.revoked).toEqual([]);
  });
});

describe('讀不到', () => {
  it('不丟錯、記下來；10 秒內再要不重讀（拖滑桿等重畫不會一直打請求），過了才重讀', async () => {
    const t = setup();
    t.swirl.want(card('nebula'));
    t.reject(new Error('404'));
    await flush();
    expect(t.failures.length).toBe(1);
    expect(t.swirl.image()).toBeNull();
    expect(t.loaded()).toBe(0);
    for (let i = 0; i < 20; i++) t.swirl.want(card('nebula'));
    t.advance(NEBULA_SWIRL_RETRY_MS - 1);
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(1);
    t.advance(1);
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(2);
    t.resolve(img());
    await flush();
    expect(t.swirl.image()).not.toBeNull();
  });

  it('解出來 0×0：當讀不到（收回 blob 網址、記下來），10 秒內不重讀', async () => {
    const t = setup();
    t.swirl.want(card('nebula'));
    t.resolve(img(0, 0, 'blob:empty'));
    await flush();
    expect(t.swirl.image()).toBeNull();
    expect(t.revoked).toEqual(['blob:empty']);
    expect(t.failures.length).toBe(1);
    expect(t.loaded()).toBe(0);
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(1);
    t.advance(NEBULA_SWIRL_RETRY_MS);
    t.swirl.want(card('nebula'));
    expect(t.asked()).toBe(2);
  });

  it('寬或高其中一個是 0 也一樣', async () => {
    const t = setup();
    t.swirl.want(card('nebula'));
    t.resolve(img(2048, 0, 'blob:flat'));
    await flush();
    expect(t.swirl.image()).toBeNull();
    expect(t.revoked).toEqual(['blob:flat']);
  });
});

describe('main 的接線', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('用同源讀圖（loadImage＝SAME_ORIGIN_FETCH）讀 stages/nebula.webp', () => {
    expect(main).toMatch(/createNebulaSwirl\(\{\s*load: \(\) => loadStageImage\('stages\/nebula\.webp'\)/);
    expect(main).toMatch(/const loadStageImage = createStageExportImages\(loadImage\)/);
    expect(main).toMatch(/function loadImage\(path: string\)[^]*?fetch\(url, SAME_ORIGIN_FETCH\)/);
  });

  it('每次畫面更新：先 want，再把「星雲、而且沒有自己的背景圖」的大圖交給 render，其他情況給 null（render 釋放貼圖）', () => {
    expect(main).toMatch(/nebulaSwirl\.want\(card\);\s*(\/\/[^\n]*\n\s*)*scene\?\.setNebulaSwirl\(\s*card\.view\.stage === 'nebula' && backdrop === null\s*\?\s*nebulaSwirl\.image\(\)\s*:\s*null\s*\)/);
  });
});
