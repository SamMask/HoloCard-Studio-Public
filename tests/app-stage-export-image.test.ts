import { describe, expect, it, vi } from 'vitest';
import { createStageExportImages, stageExportPath } from '../src/app/stage-export-image';
import { newCard } from '../src/model/create';
import type { Card, StageStyle, WaterScene } from '../src/model/types';

const card = (stage: StageStyle, waterScene?: WaterScene): Card => {
  const c = newCard('standard', 'stage-export', '2026-10-15T00:00:00.000Z');
  return { ...c, view: { ...c.view, stage, waterScene } };
};

describe('T-842 舞台遠景來源與讀圖', () => {
  it.each([
    ['gallery', undefined, 'stages/gallery-hall.webp'],
    ['water', undefined, 'stages/water-lake.webp'],
    ['water', 'lake', 'stages/water-lake.webp'],
    ['water', 'ink', 'stages/water-ink.webp'],
    ['water', 'fuji', 'stages/water-fuji.webp'],
    ['nebula', undefined, 'stages/nebula.webp'],
    ['desk', undefined, 'stages/desk.webp'],
  ] as const)('%s / %s 用正確的原圖', (stage, water, path) => {
    expect(stageExportPath(card(stage, water))).toBe(path);
  });

  it('沒有遠景的舞台、卡片有自己的背景圖都不適用', () => {
    for (const stage of ['halo', 'magic', 'none'] as const) expect(stageExportPath(card(stage))).toBeNull();
    const c = card('gallery');
    c.view.backdrop = '00000000000000b7';
    expect(stageExportPath(c)).toBeNull();
  });

  it('預覽與匯出同時要同一張圖只讀一次，保留解碼結果供下次使用', async () => {
    const img = { naturalWidth: 1600, naturalHeight: 900 } as HTMLImageElement;
    const load = vi.fn(async () => img);
    const read = createStageExportImages(load);
    expect(await Promise.all([read('stages/desk.webp'), read('stages/desk.webp')])).toEqual([img, img]);
    expect(await read('stages/desk.webp')).toBe(img);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('讀取失敗不留在快取；空圖回收 blob 網址，下一次匯出可重試', async () => {
    const revoke = vi.fn();
    const img = { naturalWidth: 16, naturalHeight: 9 } as HTMLImageElement;
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ naturalWidth: 0, naturalHeight: 0, src: 'blob:empty' })
      .mockResolvedValueOnce(img);
    const read = createStageExportImages(load, revoke);
    await expect(read('stages/desk.webp')).rejects.toThrow('missing');
    await expect(read('stages/desk.webp')).rejects.toThrow();
    expect(revoke).toHaveBeenCalledWith('blob:empty');
    expect(await read('stages/desk.webp')).toBe(img);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
