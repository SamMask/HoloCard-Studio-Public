// 減少動態效果（T-608，DESIGN §8.3）在卡片庫：複製一份之後，新的那張捲到看得到的地方——
// 減少動態時直接跳過去（behavior 'auto'），沒設時平順地捲（'smooth'）；設定一改（matches 變了）下一次就照新的。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibrary } from '../src/ui/library';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeElement, flush, installFakeDom, type FakeDom } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const QUERY = '(prefers-reduced-motion: reduce)';

let dom: FakeDom;
let reduced = false;
const scrolls: { id: string | null; options: unknown }[] = [];

beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake/0');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  // 假的 matchMedia：每次問都照 reduced 現在的值（和真的 MediaQueryList.matches 一樣會即時變）
  reduced = false;
  Object.assign(dom.window, {
    matchMedia: (q: string) => ({ matches: q === QUERY && reduced, addEventListener() {}, removeEventListener() {} }),
  });
  scrolls.length = 0;
  (FakeElement.prototype as unknown as { scrollIntoView: (o: unknown) => void }).scrollIntoView = function (this: FakeElement, options: unknown) {
    scrolls.push({ id: this.getAttribute('data-id'), options });
  };
});
afterEach(() => {
  delete (FakeElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const cards = [{ id: 'a', name: '龍' }];
  let copies = 0;
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => {
      if (name === 'loadLibrary') {
        return async () => ({
          cards: cards.map((c) => ({ id: c.id, name: c.name, aspect: 'standard', updatedAt: T0, layerCount: 1 })),
          storageLow: false,
        });
      }
      if (name === 'duplicateCard') {
        return async () => {
          const id = `copy${++copies}`;
          cards.push({ id, name: `龍 副本 ${copies}` });
          return id;
        };
      }
      return () => {};
    },
  });
  const library = createLibrary(intents, { openNewCard: () => {}, importFiles: () => {}, changed: () => {} });
  return { library, el: library.el as unknown as FakeElement };
}

/** 第一張卡的〔⋯〕→〔複製一份〕，等清單重讀完。 */
async function duplicateFirst(el: FakeElement) {
  byClass(el, 'lib-more').click();
  const copy = all(el, 'menu-item').find((b) => b.textContent?.includes('複製一份'));
  if (!copy) throw new Error('找不到〔複製一份〕');
  copy.click();
  await flush();
  await flush();
}

describe('卡片庫：複製後捲到新的那張', () => {
  it('沒設減少動態：平順地捲（smooth）；打開減少動態後下一次直接跳過去（auto），不用重新整理', async () => {
    const t = setup();
    t.library.open();
    await flush();
    await duplicateFirst(t.el);
    expect(scrolls.at(-1)?.options).toMatchObject({ behavior: 'smooth' });

    reduced = true;
    await duplicateFirst(t.el);
    expect(scrolls.at(-1)?.options).toMatchObject({ behavior: 'auto' });
    expect(scrolls).toHaveLength(2);
  });
});
