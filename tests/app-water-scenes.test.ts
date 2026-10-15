// 水鏡遠景的三張圖（T-815，app/water-scenes）：第一次要用時才讀（舞台是水鏡才讀，開工坊時不讀）；這張卡選的那張先讀
// （3D 要用），另外兩張接著讀（右欄的小縮圖）；每張只讀一次；讀好通知畫面重畫；讀不到不丟錯，隔一段時間（10 秒，T-815b）之後
// 下次狀態改變才再試（持續讀不到時，請求不會跟著編輯事件一直打）。時間由測試注入。
import { describe, expect, it } from 'vitest';
import { createWaterScenes, WATER_SCENE_RETRY_MS } from '../src/app/water-scenes';
import { updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle, WaterScene } from '../src/model/types';
import { flush } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const card = (stage: StageStyle, scene?: WaterScene): Card =>
  updateCard(newCard('standard', 'c1', T0), { view: { stage, ...(scene ? { waterScene: scene } : {}) } });

/** 假的 <img>（讀好的 blob 網址＋寬高）。 */
const img = (scene: WaterScene, w = 2048, h = 1024) =>
  ({ src: `blob:${scene}`, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement;

function setup() {
  /** 假的時鐘（毫秒）：讀不到之後要隔多久才再試，由測試往前撥。 */
  let time = 1_000_000;
  const asked: WaterScene[] = [];
  const pending = new Map<WaterScene, { resolve: (i: HTMLImageElement) => void; reject: (e: unknown) => void }>();
  let loaded = 0;
  const failures: unknown[] = [];
  const scenes = createWaterScenes({
    load: (scene) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        asked.push(scene);
        pending.set(scene, { resolve, reject });
      }),
    loaded: () => loaded++,
    failed: (err) => failures.push(err),
    now: () => time,
  });
  return {
    scenes,
    asked,
    pending,
    failures,
    loaded: () => loaded,
    advance: (ms: number) => void (time += ms),
    /** 這個遠景一共被要求讀了幾次。 */
    count: (scene: WaterScene) => asked.filter((s) => s === scene).length,
  };
}

describe('第一次要用時才讀', () => {
  it('不是水鏡：一張都不讀', () => {
    const t = setup();
    for (const stage of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) t.scenes.want(card(stage, 'fuji'));
    expect(t.asked).toEqual([]);
    expect(t.scenes.image('lake')).toBeNull();
    expect(t.scenes.url('lake')).toBeUndefined();
  });

  it('水鏡：選的那張先讀，另外兩張接著讀；每張只讀一次', () => {
    const t = setup();
    t.scenes.want(card('water', 'fuji'));
    expect(t.asked).toEqual(['fuji', 'lake', 'ink']);
    t.scenes.want(card('water', 'ink'));
    t.scenes.want(card('water'));
    expect(t.asked).toEqual(['fuji', 'lake', 'ink']);
  });

  it('讀好之前 image／url 是空的（先照沒有遠景畫）；讀好通知重畫，之後拿得到圖與網址', async () => {
    const t = setup();
    t.scenes.want(card('water'));
    expect(t.scenes.image('lake')).toBeNull();
    const lake = img('lake');
    t.pending.get('lake')!.resolve(lake);
    await flush();
    expect(t.loaded()).toBe(1);
    expect(t.scenes.image('lake')).toEqual({ image: lake, width: 2048, height: 1024 });
    expect(t.scenes.image('lake')).toBe(t.scenes.image('lake'));
    expect(t.scenes.url('lake')).toBe('blob:lake');
    expect(t.scenes.image('ink')).toBeNull();
  });

  it('讀不到：不丟錯、交給 failed；隔 10 秒之後下次狀態改變才再試', async () => {
    const t = setup();
    t.scenes.want(card('water', 'ink'));
    t.pending.get('ink')!.reject(new Error('404'));
    await flush();
    expect(t.failures).toHaveLength(1);
    expect(t.loaded()).toBe(0);
    expect(t.scenes.image('ink')).toBeNull();
    // 剛失敗：狀態改變也不再讀
    t.scenes.want(card('water', 'ink'));
    expect(t.count('ink')).toBe(1);
    // 還差一毫秒：不讀；到了：讀（只有失敗的那一張重讀，另外兩張還在讀、不重複）
    t.advance(WATER_SCENE_RETRY_MS - 1);
    t.scenes.want(card('water', 'ink'));
    expect(t.count('ink')).toBe(1);
    t.advance(1);
    t.scenes.want(card('water', 'ink'));
    expect(t.count('ink')).toBe(2);
    expect(t.count('lake')).toBe(1);
    expect(t.count('fuji')).toBe(1);
    // 重讀成功：圖與網址拿得到、通知重畫
    t.pending.get('ink')!.resolve(img('ink'));
    await flush();
    expect(t.scenes.url('ink')).toBe('blob:ink');
    expect(t.loaded()).toBe(1);
  });

  it('持續讀不到＋快速連續更新（拖滑桿）：請求次數有上限，不跟著編輯事件走', async () => {
    const t = setup();
    // 400 次更新（每次隔 20 毫秒＝8 秒內）；每次更新後所有已送出的請求都失敗
    for (let i = 0; i < 400; i++) {
      t.scenes.want(card('water', 'lake'));
      for (const p of t.pending.values()) p.reject(new Error('404'));
      t.pending.clear();
      await flush();
      t.advance(20);
    }
    expect(t.asked).toHaveLength(3); // 三張各讀一次，之後都在冷卻
    expect(t.failures).toHaveLength(3);
    // 再撥過冷卻、再拖 400 次：各多讀一次（每 10 秒每張最多一次）
    t.advance(WATER_SCENE_RETRY_MS);
    for (let i = 0; i < 400; i++) {
      t.scenes.want(card('water', 'lake'));
      for (const p of t.pending.values()) p.reject(new Error('404'));
      t.pending.clear();
      await flush();
      t.advance(20);
    }
    expect(t.asked).toHaveLength(6);
    expect(t.failures).toHaveLength(6);
  });

  it('一張讀不到不擋別張：其他張照常讀、讀好', async () => {
    const t = setup();
    t.scenes.want(card('water', 'fuji'));
    t.pending.get('fuji')!.reject(new Error('404'));
    t.pending.get('lake')!.resolve(img('lake'));
    await flush();
    t.scenes.want(card('water', 'fuji'));
    expect(t.count('fuji')).toBe(1);
    expect(t.scenes.image('lake')).not.toBeNull();
    expect(t.scenes.image('fuji')).toBeNull();
  });

  it('沒有注入時鐘：用真的時間（讀不到之後立刻再要，不會馬上重讀）', async () => {
    const asked: WaterScene[] = [];
    const scenes = createWaterScenes({
      load: (scene) => {
        asked.push(scene);
        return Promise.reject(new Error('404'));
      },
      loaded: () => {},
      failed: () => {},
    });
    scenes.want(card('water', 'lake'));
    await flush();
    scenes.want(card('water', 'lake'));
    expect(asked).toEqual(['lake', 'ink', 'fuji']);
  });

  it('解碼出來寬高是 0 的圖當讀不到（image 回 null）', async () => {
    const t = setup();
    t.scenes.want(card('water'));
    t.pending.get('lake')!.resolve(img('lake', 0, 0));
    await flush();
    expect(t.scenes.image('lake')).toBeNull();
  });
});
