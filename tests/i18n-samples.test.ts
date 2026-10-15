// T-828a 範例卡的名字跟著語言（DESIGN §9）：新卡片面板上的名字、第一次開時自動放進「我的卡片」的那幾張、
// 從面板建立的副本，都用當下語言的名字（範例卡片檔本身不動；已經在我的卡片裡的卡不改名）。
// node 裡是正體中文：名字剛好和卡片檔裡的一樣，所以這裡另外給一組名字，確定真的換了。
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { importSamplesOnFirstOpen, SAMPLE_FILES, sampleImporter } from '../src/app/samples';
import type { ImportHolocard, ImportResult } from '../src/file/types';
import { S } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';
import { newCard } from '../src/model/create';
import type { Card, Layer } from '../src/model/types';
import { SAMPLE_NAMES, SAMPLE_NAMES_ALL_LANGS } from '../src/ui/library-logic';
import { packPool } from '../src/ui/pack-opening';
import type { LibraryCard } from '../src/ui/types';

const T0 = '2026-10-15T00:00:00.000Z';
const OTHER_NAMES = ['Star Dragon', 'Sword', 'Pollen Bear', 'Neon', 'Disc Whale', 'Moonlit Dance'];

/** 假的匯入：每個檔都成功，卡名是檔名（像卡片檔裡寫死的原文名字）。failFile 那個檔失敗。 */
function fakeImporter(failFile?: string): ImportHolocard {
  return async (blob, ids) => {
    const file = await blob.text();
    if (file === failFile) return { ok: false, reason: 'invalid-card', detail: 'bad' };
    const card: Card = { ...newCard('standard', ids.newId(), ids.now()), name: `原文-${file}` };
    return { ok: true, card, images: [], preview: new Blob(['png']) };
  };
}

describe('範例卡的名字（S.samples.names）', () => {
  it('新卡片面板的名字＝字典裡目前語言的名字；張數和範例檔一樣多', () => {
    expect(SAMPLE_NAMES).toBe(S.samples.names);
    expect(S.samples.names).toHaveLength(SAMPLE_FILES.length);
  });

  it('sampleImporter：匯入成功的卡名換成第 index 個名字，其他欄位（id、圖、預覽圖）照舊', async () => {
    const importer = sampleImporter(fakeImporter(), 2, OTHER_NAMES);
    const result = (await importer(new Blob(['card3']), { newId: () => 'new-id', now: () => T0 })) as Extract<ImportResult, { ok: true }>;
    expect(result.ok).toBe(true);
    expect(result.card.name).toBe('Pollen Bear');
    expect(result.card.id).toBe('new-id');
    expect(result.preview).toBeInstanceOf(Blob);
  });

  it('sampleImporter：沒通過檢查的照原樣回（不改）；沒有這一個名字（或是空的）就保留卡片檔裡的名字', async () => {
    const failed = await sampleImporter(fakeImporter('x'), 0, OTHER_NAMES)(new Blob(['x']), { newId: () => 'a', now: () => T0 });
    expect(failed).toEqual({ ok: false, reason: 'invalid-card', detail: 'bad' });
    const noName = (await sampleImporter(fakeImporter(), 9, OTHER_NAMES)(new Blob(['y']), { newId: () => 'b', now: () => T0 })) as Extract<ImportResult, { ok: true }>;
    expect(noName.card.name).toBe('原文-y');
    const blank = (await sampleImporter(fakeImporter(), 0, ['  '])(new Blob(['z']), { newId: () => 'c', now: () => T0 })) as Extract<ImportResult, { ok: true }>;
    expect(blank.card.name).toBe('原文-z');
  });

  it('sampleImporter 預設用目前語言的名字（node 裡＝正體中文）', async () => {
    const result = (await sampleImporter(fakeImporter(), 0)(new Blob(['card1']), { newId: () => 'a', now: () => T0 })) as Extract<ImportResult, { ok: true }>;
    expect(result.card.name).toBe(S.samples.names[0]);
  });

  it('第一次開啟：自動放進我的卡片的每一張都用給的名字（打開的那張和只存的那幾張）', async () => {
    const opened: Card[] = [];
    const kept: Card[] = [];
    let n = 0;
    const result = await importSamplesOnFirstOpen({
      fetchSample: async (file) => new Blob([file]),
      store: { updateMeta: async () => {} },
      importer: fakeImporter(),
      newId: () => `id-${++n}`,
      now: () => Date.parse(T0),
      open: async (card) => {
        opened.push(card);
        return 'opened';
      },
      keep: async (card) => {
        kept.push(card);
        return true;
      },
      names: OTHER_NAMES,
    });
    expect(result?.name).toBe(OTHER_NAMES[0]);
    expect(opened.map((c) => c.name)).toEqual([OTHER_NAMES[0]]);
    expect(kept.map((c) => c.name)).toEqual(OTHER_NAMES.slice(1, SAMPLE_FILES.length));
  });

  it('第一次開啟：沒給名字＝目前語言的名字（node 裡＝正體中文）', async () => {
    const kept: Card[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await importSamplesOnFirstOpen({
      fetchSample: async (file) => new Blob([file]),
      store: { updateMeta: async () => {} },
      importer: fakeImporter(),
      newId: () => 'id',
      now: () => Date.parse(T0),
      open: async () => 'opened',
      keep: async (card) => {
        kept.push(card);
        return true;
      },
    });
    expect(result?.name).toBe(S.samples.names[0]);
    expect(kept.map((c) => c.name)).toEqual(S.samples.names.slice(1));
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------------------------
// T-828g 小修
// ---------------------------------------------------------------------------------------------

const DICTS = { 'zh-Hant': zhHant, en, ja, ko };

describe('T-828g 開一包：同名的範例不放，四種語言的名字都算', () => {
  const libCard = (id: string, name: string): LibraryCard => ({ id, name, aspect: 'standard', createdAt: T0, updatedAt: T0 });
  const preview = async () => null;
  const sampleIndexes = (pool: ReturnType<typeof packPool>) => pool.flatMap((c) => (c.source.kind === 'sample' ? [c.source.index] : []));

  it('SAMPLE_NAMES_ALL_LANGS：每張範例有四種語言的名字，位置和 SAMPLE_NAMES 一樣', () => {
    expect(SAMPLE_NAMES_ALL_LANGS).toHaveLength(SAMPLE_NAMES.length);
    SAMPLE_NAMES_ALL_LANGS.forEach((names, i) => {
      expect([...names].sort()).toEqual(Object.values(DICTS).map((d) => d.samples.names[i]!).sort());
    });
  });

  describe.each(Object.entries(DICTS))('卡片庫裡的卡用「%s」的範例名字', (_lang, libraryDict) => {
    describe.each(Object.entries(DICTS))('目前介面語言＝%s', (_current, currentDict) => {
      it('同一張範例不放進卡池（其他範例照放）', () => {
        const cards = [libCard('a', libraryDict.samples.names[0]!), libCard('b', libraryDict.samples.names[4]!), libCard('c', '我的卡')];
        const pool = packPool(cards, currentDict.samples.names, preview);
        expect(sampleIndexes(pool)).toEqual([1, 2, 3, 5]);
        expect(pool.filter((c) => c.source.kind === 'card')).toHaveLength(3);
      });
    });
  });

  it('不同範例不會被誤擋：卡片庫的卡叫另一張範例的名字，只擋那一張', () => {
    const pool = packPool([libCard('a', en.samples.names[2]!)], zhHant.samples.names, preview);
    expect(sampleIndexes(pool)).toEqual([0, 1, 3, 4, 5]);
  });

  it('卡名沒有任何一種語言的範例名字：六張範例都在', () => {
    const pool = packPool([libCard('a', 'Star Dragon')], en.samples.names, preview);
    expect(sampleIndexes(pool)).toHaveLength(SAMPLE_FILES.length);
  });
});

describe('T-828g 範例卡的圖層名字跟著語言', () => {
  const ID16 = '0'.repeat(16);
  const mk = (id: string, name: string): Layer =>
    ({ id, name, role: id === 'base' ? 'base' : 'layer', image: ID16, visible: true, depth: 0, x: 0, y: 0, scale: 1, holo: false, hasAlpha: true }) as Layer;

  /** 假的匯入：卡片有正面三層（id＝base／hero／fx）、背面一層（back-1），名字是原文。ids 可以換掉正面的 id。 */
  function layered(frontIds: readonly string[] = ['base', 'hero', 'fx']): ImportHolocard {
    return async (_blob, ids) => {
      const card = newCard('standard', ids.newId(), ids.now());
      card.name = '原文卡名';
      card.front.layers = [mk(frontIds[0]!, '原文底圖'), mk(frontIds[1]!, '原文主角'), mk(frontIds[2]!, '原文特效')];
      card.back.layers = [mk('back-1', '原文背面')];
      return { ok: true, card, images: [], preview: new Blob(['png']) };
    };
  }
  const NAMES = ['卡名甲', '卡名乙'];
  const LAYERS: Record<string, string>[] = [{ base: 'A底', hero: 'A主角', fx: 'A特效' }, { base: 'B底', hero: 'B主角', 'back-1': 'B背面' }];
  const ORIGINAL_FRONT = ['原文底圖', '原文主角', '原文特效'];
  const run = async (importer: ImportHolocard, index: number, layers: readonly Record<string, string>[] = LAYERS) =>
    (await sampleImporter(importer, index, NAMES, layers)(new Blob(['x']), { newId: () => 'n', now: () => T0 })) as Extract<ImportResult, { ok: true }>;

  it('用圖層 id 對到名字：正面、背面都換成第 index 組；id、順序、其他欄位不變', async () => {
    const a = await run(layered(), 0);
    expect(a.card.front.layers.map((l) => [l.id, l.name])).toEqual([['base', 'A底'], ['hero', 'A主角'], ['fx', 'A特效']]);
    expect(a.card.back.layers.map((l) => [l.id, l.name])).toEqual([['back-1', '原文背面']]);
    expect(a.card.front.layers[1]).toMatchObject({ role: 'layer', depth: 0, hasAlpha: true, image: ID16 });
    const b = await run(layered(), 1);
    expect(b.card.front.layers.map((l) => l.name)).toEqual(['B底', 'B主角', '原文特效']);
    expect(b.card.back.layers.map((l) => l.name)).toEqual(['B背面']);
    expect(b.card.name).toBe('卡名乙');
  });

  it('id 對不到、名字是空的 → 保留原名；這張沒有圖層名字組 → 全部保留', async () => {
    const blank = await run(layered(), 0, [{ base: '  ', hero: '', other: 'X' }]);
    expect(blank.card.front.layers.map((l) => l.name)).toEqual(ORIGINAL_FRONT);
    const none = await run(layered(), 5);
    expect(none.card.front.layers.map((l) => l.name)).toEqual(ORIGINAL_FRONT);
    expect(none.card.back.layers.map((l) => l.name)).toEqual(['原文背面']);
  });

  it('圖層 id 剛好叫 constructor／__proto__／toString 之類也不會當成名字', async () => {
    const result = await run(layered(['constructor', '__proto__', 'toString']), 0);
    expect(result.card.front.layers.map((l) => l.name)).toEqual(ORIGINAL_FRONT);
  });

  it('沒通過檢查的照原樣回', async () => {
    const failed = await sampleImporter(fakeImporter('x'), 0, NAMES, LAYERS)(new Blob(['x']), { newId: () => 'a', now: () => T0 });
    expect(failed).toEqual({ ok: false, reason: 'invalid-card', detail: 'bad' });
  });

  it('預設用目前語言的圖層名字（node 裡＝正體中文＝卡片檔裡現在的名字）', async () => {
    const real = (await run(layered(['base', 'dragon', 'front']), 0, S.samples.layers)).card.front.layers.map((l) => l.name);
    expect(real).toEqual([S.samples.layers[0]!.base, S.samples.layers[0]!.dragon, S.samples.layers[0]!.front]);
    const viaDefault = (await sampleImporter(layered(['base', 'dragon', 'front']), 0)(new Blob(['x']), { newId: () => 'n', now: () => T0 })) as Extract<ImportResult, { ok: true }>;
    expect(viaDefault.card.front.layers.map((l) => l.name)).toEqual(real);
  });

  it('第一次開啟：自動放進我的卡片的每一張都換上給的圖層名字（打開的那張和只存的那幾張）', async () => {
    const seen: Card[] = [];
    await importSamplesOnFirstOpen({
      fetchSample: async (file) => new Blob([file]),
      store: { updateMeta: async () => {} },
      importer: layered(),
      newId: () => 'id',
      now: () => Date.parse(T0),
      open: async (card) => (seen.push(card), 'opened'),
      keep: async (card) => (seen.push(card), true),
      names: OTHER_NAMES,
      layers: [LAYERS[0]!, LAYERS[1]!, {}, {}, {}, {}],
    });
    expect(seen).toHaveLength(SAMPLE_FILES.length);
    expect(seen[0]!.front.layers.map((l) => l.name)).toEqual(['A底', 'A主角', 'A特效']);
    expect(seen[1]!.front.layers.map((l) => l.name)).toEqual(['B底', 'B主角', '原文特效']);
    expect(seen[2]!.front.layers.map((l) => l.name)).toEqual(ORIGINAL_FRONT);
  });

  describe('字典 samples.layers 對照真的卡片檔', () => {
    /** 卡片檔裡每張範例的圖層 id → 名字（正面＋背面；只讀、不改檔）。 */
    const fileLayers = SAMPLE_FILES.map((file) => {
      const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(new URL(`../public/samples/${file}`, import.meta.url))))['card.json']!)) as {
        front: { layers: { id: string; name: string }[] };
        back: { layers: { id: string; name: string }[] };
      };
      return [...json.front.layers, ...json.back.layers];
    });

    it('每種語言都有六組（照 SAMPLE_FILES 的順序）', () => {
      for (const dict of Object.values(DICTS)) expect(dict.samples.layers).toHaveLength(SAMPLE_FILES.length);
    });

    it.each(SAMPLE_FILES.map((file, i) => [file, i] as const))('%s：字典的 id 和卡片檔的圖層 id 一一對上，名字不空、不太長；正體中文＝卡片檔現在的名字', (_file, i) => {
      const ids = fileLayers[i]!.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [lang, dict] of Object.entries(DICTS)) {
        const names = dict.samples.layers[i]!;
        expect(Object.keys(names).sort(), lang).toEqual([...ids].sort());
        for (const [id, name] of Object.entries(names)) {
          expect(name.trim(), `${lang} ${id}`).not.toBe('');
          expect(name.length, `${lang} ${id}`).toBeLessThanOrEqual(24);
        }
      }
      for (const layer of fileLayers[i]!) expect(zhHant.samples.layers[i]![layer.id]).toBe(layer.name);
    });
  });
});
