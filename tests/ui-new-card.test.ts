// 新卡片面板的「從範例開始」（T-605b，DESIGN 7.3；T-810 加第五張光碟）：範例的名字＋縮圖（卡片檔裡的 preview.png，打開面板時才讀）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NAMES } from '../src/ui/library-logic';
import { createNewCardPanel, type NewCardHooks } from '../src/ui/new-card';
import { all, byClass, FakeElement, FakeEvent, flush, installFakeDom } from './ui-fake-dom';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function setup() {
  installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  const previews: { index: number; done: ReturnType<typeof deferred<Blob | null>> }[] = [];
  const picked: number[] = [];
  const hooks: NewCardHooks = {
    blank: () => {},
    disc: () => {},
    sample: (index) => picked.push(index),
    preview: (index) => {
      const done = deferred<Blob | null>();
      previews.push({ index, done });
      return done.promise;
    },
    changed: () => {},
    libraryCards: async () => [],
    openCard: () => {},
  };
  const panel = createNewCardPanel(hooks);
  const el = panel.el as unknown as FakeElement;
  const sampleButtons = () => all(el, 'nc-opt').filter((b) => b.querySelector('.nc-sample'));
  return { panel, el, previews, picked, sampleButtons };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('新卡片面板：從範例開始（T-605b）', () => {
  it('六張範例（T-810 加光碟、T-820 加月下幽舞），名字照順序；建立面板時不讀縮圖，第一次打開才讀（每張一次），再打開不重讀', () => {
    const t = setup();
    expect(t.sampleButtons().map((b) => byClass(b, 'nc-name').textContent)).toEqual([...SAMPLE_NAMES]);
    expect(SAMPLE_NAMES).toHaveLength(6);
    expect(t.previews).toEqual([]);
    t.panel.open('blank');
    expect(t.previews.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
    t.panel.close();
    t.panel.open('samples');
    expect(t.previews).toHaveLength(6);
  });

  it('縮圖＝卡片檔的預覽圖（object URL）：讀好、圖載好之前顯示光澤佔位；讀不到就拿掉佔位、不放圖', async () => {
    const t = setup();
    t.panel.open('blank');
    const arts = t.sampleButtons().map((b) => byClass(b, 'nc-sample'));
    expect(arts.every((a) => a.classList.contains('is-loading'))).toBe(true);
    t.previews[0]!.done.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    t.previews[1]!.done.resolve(null);
    await flush();
    const img = byClass(arts[0], 'nc-preview');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(img.getAttribute('alt')).toBe('');
    // 圖還在解碼：佔位留著
    expect(arts[0]!.classList.contains('is-loading')).toBe(true);
    img.fire(new FakeEvent('load'));
    expect(arts[0]!.classList.contains('is-loading')).toBe(false);
    // 讀不到：沒有圖、佔位拿掉
    expect(all(arts[1], 'nc-preview')).toEqual([]);
    expect(arts[1]!.classList.contains('is-loading')).toBe(false);
    // 還沒讀好的照樣是佔位
    expect(arts[2]!.classList.contains('is-loading')).toBe(true);
  });

  it('T-605c：縮圖的 object URL 在圖載好（或載入失敗）後收回，不會一直佔著記憶體', async () => {
    const t = setup();
    const revoked: string[] = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));
    t.panel.open('blank');
    const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    t.previews[0]!.done.resolve(png());
    t.previews[1]!.done.resolve(png());
    await flush();
    const arts = t.sampleButtons().map((b) => byClass(b, 'nc-sample'));
    const [ok, broken] = [byClass(arts[0], 'nc-preview'), byClass(arts[1], 'nc-preview')];
    expect(revoked).toEqual([]);
    ok.fire(new FakeEvent('load'));
    broken.fire(new FakeEvent('error'));
    expect(revoked).toEqual([ok.getAttribute('src'), broken.getAttribute('src')]);
    expect(new Set(revoked).size).toBe(2);
    // 再觸發一次也不會收兩次
    ok.fire(new FakeEvent('load'));
    expect(revoked).toHaveLength(2);
  });

  it('讀縮圖的時候出錯（丟例外）：拿掉佔位，面板照常', async () => {
    installFakeDom();
    vi.stubGlobal('HTMLElement', FakeElement);
    const preview = vi.fn(() => Promise.reject(new Error('boom')));
    const panel = createNewCardPanel({ blank: () => {}, disc: () => {}, sample: () => {}, preview, changed: () => {}, libraryCards: async () => [], openCard: () => {} });
    panel.open('samples');
    await flush();
    const arts = all(panel.el, 'nc-sample');
    expect(arts).toHaveLength(SAMPLE_NAMES.length);
    expect(arts.every((a) => !a.classList.contains('is-loading'))).toBe(true);
    expect(panel.isOpen()).toBe(true);
  });

  it('點範例：關掉面板、建立第 index 張的副本', () => {
    const t = setup();
    t.panel.open('samples');
    t.sampleButtons()[2]!.click();
    expect(t.picked).toEqual([2]);
    expect(t.panel.isOpen()).toBe(false);
  });
});
