import { describe, expect, it } from 'vitest';
import { preferWebp, THUMBNAIL_WEBP_QUALITY } from '../src/app/thumbnail';

// 卡片庫縮圖改存 WebP（T-407，SCHEMA §3）：瀏覽器編不出 WebP（blob.type 不是 image/webp）就留原本的 PNG。

const png = new Blob(['png-bytes-png-bytes'], { type: 'image/png' });

describe('縮圖改存 WebP', () => {
  it('品質約 0.85', () => {
    expect(THUMBNAIL_WEBP_QUALITY).toBe(0.85);
  });

  it('編得出 WebP → 用 WebP', async () => {
    const webp = new Blob(['webp'], { type: 'image/webp' });
    expect(await preferWebp(png, async () => webp)).toBe(webp);
  });

  it('瀏覽器靜默退回 PNG（type 不是 image/webp）→ 留原本的 PNG', async () => {
    expect(await preferWebp(png, async () => new Blob(['x'], { type: 'image/png' }))).toBe(png);
  });

  it('編碼出錯 → 留原本的 PNG（縮圖照樣存）', async () => {
    expect(await preferWebp(png, async () => Promise.reject(new Error('沒有 OffscreenCanvas')))).toBe(png);
  });
});
