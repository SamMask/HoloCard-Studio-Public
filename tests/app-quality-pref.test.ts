// T-809 「電腦跑不動時自動降低畫質」開關的記錄（DESIGN §8.4）：只記在這台電腦的瀏覽器（localStorage），不存進卡片；
// 讀不到（沒有 localStorage、丟錯、沒記過、壞值）一律當開著；寫不進去也不丟錯。
import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY_STORAGE_KEY, readAutoQuality, writeAutoQuality, type QualityStorage } from '../src/app/quality-pref';

function fakeStorage(initial: Record<string, string> = {}): QualityStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('自動降低畫質開關的記錄', () => {
  it('預設（沒記過）是開著', () => {
    expect(readAutoQuality(() => fakeStorage())).toBe(true);
  });

  it('關掉之後記起來：下次讀到關；再打開也記起來', () => {
    const storage = fakeStorage();
    writeAutoQuality(false, () => storage);
    expect(readAutoQuality(() => storage)).toBe(false);
    writeAutoQuality(true, () => storage);
    expect(readAutoQuality(() => storage)).toBe(true);
  });

  it('只記在這個名字下，不碰別的鍵（例如導覽看過沒有）', () => {
    const storage = fakeStorage({ 'holocard.tour.seen': '1' });
    writeAutoQuality(false, () => storage);
    expect([...storage.data.keys()].sort()).toEqual(['holocard.tour.seen', AUTO_QUALITY_STORAGE_KEY].sort());
    expect(storage.data.get('holocard.tour.seen')).toBe('1');
  });

  it('壞值（亂寫的字）當開著；只有明確記了關才算關', () => {
    for (const bad of ['', 'false', 'off', 'null', '2', '{}']) {
      expect(readAutoQuality(() => fakeStorage({ [AUTO_QUALITY_STORAGE_KEY]: bad })), bad).toBe(true);
    }
  });

  it('拿 localStorage 就丟錯（隱私模式、被擋）、或沒有 localStorage（null）：讀當開著、寫不丟錯', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(readAutoQuality(boom)).toBe(true);
    expect(() => writeAutoQuality(false, boom)).not.toThrow();
    expect(readAutoQuality(() => null)).toBe(true);
    expect(() => writeAutoQuality(false, () => null)).not.toThrow();
  });

  it('getItem／setItem 丟錯（容量滿了、被擋）：讀當開著、寫不丟錯', () => {
    const broken: QualityStorage = {
      getItem() {
        throw new Error('壞了');
      },
      setItem() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(readAutoQuality(() => broken)).toBe(true);
    expect(() => writeAutoQuality(false, () => broken)).not.toThrow();
  });
});
