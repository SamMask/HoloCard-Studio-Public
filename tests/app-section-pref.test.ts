// T-836（DESIGN §5.2「右欄各小節可以摺疊」）：哪幾個小節收起來，只記在這台電腦的瀏覽器（localStorage），不存進卡片。
// 照 app/quality-pref.ts 的做法：讀不到（沒有 localStorage、丟錯、沒記過、壞值）一律當全部展開；寫不進去也不丟錯。
import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_SECTIONS_STORAGE_KEY,
  EXPANDED_SECTIONS_STORAGE_KEY,
  readExpandedSections,
  writeExpandedSections,
  readCollapsedSections,
  writeCollapsedSections,
  type SectionStorage,
} from '../src/app/section-pref';

function fakeStorage(initial: Record<string, string> = {}): SectionStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('預設收起小節的展開記錄（T-840）', () => {
  it('獨立記錄、讀回、清空，不改舊的收起清單', () => {
    const storage = fakeStorage({ [COLLAPSED_SECTIONS_STORAGE_KEY]: '["style"]' });
    expect(readExpandedSections(() => storage)).toEqual([]);
    writeExpandedSections(['layer-advanced', 'layer-advanced'], () => storage);
    expect(storage.data.get(EXPANDED_SECTIONS_STORAGE_KEY)).toBe('["layer-advanced"]');
    expect(readExpandedSections(() => storage)).toEqual(['layer-advanced']);
    expect(readCollapsedSections(() => storage)).toEqual(['style']);
    writeExpandedSections([], () => storage);
    expect(readExpandedSections(() => storage)).toEqual([]);
  });

  it('壞值當空；名稱驗證、去重與 32 個上限沿用舊規則', () => {
    for (const bad of ['', '{', 'null', '{}', '42', 'true']) {
      expect(readExpandedSections(() => fakeStorage({ [EXPANDED_SECTIONS_STORAGE_KEY]: bad }))).toEqual([]);
    }
    const storage = fakeStorage();
    const ids = ['layer-advanced', 3, '', null, '<img>', 'Stage', 'x'.repeat(200), 'layer-advanced', ...Array.from({ length: 40 }, (_, i) => `s${i}`)];
    storage.data.set(EXPANDED_SECTIONS_STORAGE_KEY, JSON.stringify(ids));
    expect(readExpandedSections(() => storage)).toEqual(['layer-advanced', ...Array.from({ length: 31 }, (_, i) => `s${i}`)]);
    writeExpandedSections(ids as string[], () => storage);
    expect(readExpandedSections(() => storage)).toHaveLength(32);
  });

  it('讀不到當空、寫不進去不丟錯', () => {
    const boom = () => { throw new Error('SecurityError'); };
    const broken: SectionStorage = { getItem: boom, setItem: boom };
    for (const getStorage of [boom, () => null, () => broken]) {
      expect(readExpandedSections(getStorage)).toEqual([]);
      expect(() => writeExpandedSections(['layer-advanced'], getStorage)).not.toThrow();
    }
  });
});

describe('右欄收起來的小節的記錄（T-836）', () => {
  it('預設（沒記過）＝全部展開（空清單）', () => {
    expect(readCollapsedSections(() => fakeStorage())).toEqual([]);
  });

  it('記下來、讀回來一樣；全部展開時寫空清單', () => {
    const storage = fakeStorage();
    writeCollapsedSections(['holo', 'stage'], () => storage);
    expect(readCollapsedSections(() => storage)).toEqual(['holo', 'stage']);
    writeCollapsedSections([], () => storage);
    expect(readCollapsedSections(() => storage)).toEqual([]);
  });

  it('只記在這個名字下，不碰別的鍵（導覽、畫質、語言）', () => {
    const storage = fakeStorage({ 'holocard.tour.seen': '1', 'holocard.quality.auto': '0', 'holocard.lang': 'en' });
    writeCollapsedSections(['frame'], () => storage);
    expect([...storage.data.keys()].sort()).toEqual(
      ['holocard.lang', 'holocard.quality.auto', 'holocard.tour.seen', COLLAPSED_SECTIONS_STORAGE_KEY].sort(),
    );
    expect(storage.data.get('holocard.tour.seen')).toBe('1');
  });

  it('重複的只留一個', () => {
    const storage = fakeStorage();
    writeCollapsedSections(['holo', 'holo', 'shadow'], () => storage);
    expect(readCollapsedSections(() => storage)).toEqual(['holo', 'shadow']);
  });

  it('壞值當全部展開：不是 JSON、不是陣列、null、物件', () => {
    for (const bad of ['', 'holo', '{', 'null', '{"holo":true}', '42', 'true']) {
      expect(readCollapsedSections(() => fakeStorage({ [COLLAPSED_SECTIONS_STORAGE_KEY]: bad })), bad).toEqual([]);
    }
  });

  it('陣列裡不像小節名字的（數字、空字串、太長、怪字元）丟掉，其他照收', () => {
    const raw = JSON.stringify(['holo', 3, '', null, 'x'.repeat(200), '<img>', 'Stage', 'frame']);
    expect(readCollapsedSections(() => fakeStorage({ [COLLAPSED_SECTIONS_STORAGE_KEY]: raw }))).toEqual(['holo', 'frame']);
  });

  it('太多（被亂寫）只收前 32 個', () => {
    const raw = JSON.stringify(Array.from({ length: 100 }, (_, i) => `s${i}`));
    expect(readCollapsedSections(() => fakeStorage({ [COLLAPSED_SECTIONS_STORAGE_KEY]: raw }))).toHaveLength(32);
  });

  it('拿 localStorage 就丟錯（隱私模式、被擋）、或沒有 localStorage（null）：讀當全部展開、寫不丟錯', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(readCollapsedSections(boom)).toEqual([]);
    expect(() => writeCollapsedSections(['holo'], boom)).not.toThrow();
    expect(readCollapsedSections(() => null)).toEqual([]);
    expect(() => writeCollapsedSections(['holo'], () => null)).not.toThrow();
  });

  it('getItem／setItem 丟錯（容量滿了、被擋）：讀當全部展開、寫不丟錯', () => {
    const broken: SectionStorage = {
      getItem() {
        throw new Error('壞了');
      },
      setItem() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(readCollapsedSections(() => broken)).toEqual([]);
    expect(() => writeCollapsedSections(['holo'], () => broken)).not.toThrow();
  });
});
