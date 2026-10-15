import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageRegistry } from '../../src/images/registry';
import type { StoredImage } from '../../src/images/types';

// T-512（T-509b 審查中②）：匯出期間保留副本用到的圖——換卡時登記簿只留新卡的圖（retain），
// 但這次匯出還要用的圖要等匯出收尾才釋放（hold），不然後面的畫格會變成缺圖。

const hashOf = (n: number) => n.toString(16).padStart(16, '0');
const image = (n: number): StoredImage => ({
  hash: hashOf(n),
  blob: new Blob([`img-${n}`], { type: 'image/webp' }),
  type: 'image/webp',
  width: 4,
  height: 4,
  hasAlpha: false,
});

let revoked: string[] = [];

beforeEach(() => {
  revoked = [];
  let next = 0;
  // 瀏覽器的 <img> 與 object URL：node 沒有，換成假的（解碼一定成功）
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      async decode() {}
    },
  );
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${next++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('匯出期間暫時保留圖（hold）', () => {
  it('沒有 hold：換卡（retain）就收掉別的圖（和以前一樣）', async () => {
    const reg = createImageRegistry();
    await reg.add(image(1));
    await reg.add(image(2));
    reg.retain(new Set([hashOf(2)]));
    expect(reg.has(hashOf(1))).toBe(false);
    expect(reg.element(hashOf(1))).toBeUndefined();
    expect(revoked).toHaveLength(1);
  });

  it('hold 著的圖：換卡時不收，放開才收（匯出中的畫格不會缺圖）', async () => {
    const reg = createImageRegistry();
    await reg.add(image(1));
    await reg.add(image(2));
    const release = reg.hold([hashOf(1)]);
    // 匯出途中換成只有圖 2 的卡，之後又換一次（再 retain 一次也不能收）
    reg.retain(new Set([hashOf(2)]));
    await reg.add(image(3));
    reg.retain(new Set([hashOf(3)]));
    expect(reg.element(hashOf(1))).toBeDefined();
    expect(reg.url(hashOf(1))).toBeDefined();
    expect(reg.has(hashOf(2))).toBe(false);
    release();
    expect(reg.has(hashOf(1))).toBe(false);
    expect(reg.element(hashOf(1))).toBeUndefined();
    expect(reg.has(hashOf(3))).toBe(true);
  });

  it('放開時只收「換卡時本來要收」的圖：沒換卡（目前的卡還在用）就不收', async () => {
    const reg = createImageRegistry();
    await reg.add(image(1));
    const release = reg.hold([hashOf(1)]);
    // 匯出途中上傳了一張新圖到目前的卡（沒有 retain）
    await reg.add(image(2));
    release();
    expect(reg.has(hashOf(1))).toBe(true);
    expect(reg.has(hashOf(2))).toBe(true);
    expect(revoked).toEqual([]);
  });

  it('換回用到那張圖的卡：放開時不收', async () => {
    const reg = createImageRegistry();
    await reg.add(image(1));
    await reg.add(image(2));
    const release = reg.hold([hashOf(1)]);
    reg.retain(new Set([hashOf(2)]));
    reg.retain(new Set([hashOf(1), hashOf(2)]));
    release();
    expect(reg.has(hashOf(1))).toBe(true);
  });

  it('換卡後又把同一張圖加到目前的卡（重新 add）：放開時不收', async () => {
    const reg = createImageRegistry();
    await reg.add(image(1));
    await reg.add(image(2));
    const release = reg.hold([hashOf(1)]);
    reg.retain(new Set([hashOf(2)]));
    await reg.add(image(1)); // 例如上傳了一模一樣的圖
    release();
    expect(reg.has(hashOf(1))).toBe(true);
  });

  it('兩個 hold 疊在一起：兩個都放開才收；同一個放開函式呼叫兩次只算一次', async () => {
    const reg = createImageRegistry();
    await reg.add(image(1));
    await reg.add(image(2));
    const a = reg.hold([hashOf(1)]);
    const b = reg.hold([hashOf(1)]);
    reg.retain(new Set([hashOf(2)]));
    a();
    a();
    expect(reg.has(hashOf(1))).toBe(true);
    b();
    expect(reg.has(hashOf(1))).toBe(false);
  });
});
