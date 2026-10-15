// 補新的範例到「我的卡片」（T-829，DESIGN §7.4「補新的範例」、SCHEMA §3 meta `samplesAdded`）：
// 開工坊時，卡片庫還沒拿過的範例或版本安靜地補進去（不換掉正在編輯的卡）；同名同版不放、同名不同版另放「（新版）」；
// 每張範例的每一版只補一次（記在 meta）；讀不到、存不進去的跳過、下次再試；沒拿著編輯權不補。
// T-829c：同時只跑一輪；每張「比對＋存進去」在卡片庫的寫入隊伍裡獨佔地做、每次重讀卡片庫；編輯權世代變了舊的一輪就停；meta 原子合併。
// 用真的範例卡片檔、真的 session、fake-indexeddb。
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_OPENED_KEY } from '../src/app/autosave';
import {
  addNewSamples,
  importSamplesOnFirstOpen,
  newVersionName,
  parseSamplesAdded,
  SAMPLE_FILES,
  SAMPLE_VERSIONS,
  SAMPLES_ADDED_KEY,
  sampleImporter,
  type FetchSample,
  type NewSamplesDeps,
} from '../src/app/samples';
import { createSession, type Session } from '../src/app/session';
import { guardWrites } from '../src/app/tab-lock';
import { importHolocard } from '../src/file/holocard';
import type { ImportHolocard } from '../src/file/types';
import { S } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';
import type { StoredImage } from '../src/images/types';
import { newCard } from '../src/model/create';
import { cardImages } from '../src/model/foil';
import { NAME_MAX } from '../src/model/limits';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import type { CardStore } from '../src/storage/types';

const OLD_TIME = '2026-10-14T08:00:00.000Z';
const START = Date.parse('2026-10-15T09:00:00.000Z');
const ZH = zhHant.samples.names;

const sampleBlob = (file: string) => new Blob([new Uint8Array(readFileSync(new URL(`../public/samples/${file}`, import.meta.url)))]);

/** 假的同源讀檔：直接讀 public/samples/；broken 裡的檔名讀不到。 */
function fsFetch(broken: readonly string[] = []): FetchSample & { calls: string[] } {
  const calls: string[] = [];
  const fetchSample = async (file: string) => {
    calls.push(file);
    if (broken.includes(file)) throw new Error(`範例卡片檔讀不到：${file}`);
    return sampleBlob(file);
  };
  return Object.assign(fetchSample, { calls });
}

let ids = 0;
const newId = () => `new-${++ids}`;

interface World {
  /** 寫入要拿著編輯權（guardWrites，同 main）。 */
  store: CardStore;
  session: Session;
  current(): Card | null;
  holding: boolean;
  /** 編輯權的世代（main 的 awayEpoch）：被接手過再拿回來就變。 */
  generation: number;
}

async function makeWorld(): Promise<World> {
  const raw = await openCardStore(new IDBFactory());
  const registry = new Map<string, StoredImage>();
  let current: Card | null = null;
  const world: World = {
    store: guardWrites(raw, () => world.holding),
    session: undefined as unknown as Session,
    current: () => current,
    holding: true,
    generation: 1,
  };
  world.session = createSession({
    store: world.store,
    images: {
      add: async (img) => void registry.set(img.hash, img),
      get: (h) => registry.get(h),
      retain: (keep) => {
        for (const h of [...registry.keys()]) if (!keep.has(h)) registry.delete(h);
      },
    },
    current: () => current,
    show: (card) => void (current = card),
    thumbnail: async () => null,
    settle: async () => {},
    onStatus: () => {},
    onStorageLow: () => {},
  });
  return world;
}

/** 照 main 的接法：卡片庫＝存檔（寫入要拿著編輯權）、獨佔＝session 的寫入隊伍（saver.exclusive）、世代＝拿著時的 awayEpoch。 */
function topUpDeps(world: World, over: Partial<NewSamplesDeps> = {}): NewSamplesDeps {
  return {
    fetchSample: fsFetch(),
    importer: importHolocard,
    newId,
    now: () => START,
    editGeneration: () => (world.holding ? world.generation : null),
    withLibrary: (task) => world.session.saver.exclusive(task),
    store: world.store,
    ...over,
  };
}

/** 卡片庫的存卡換成 save（其他照舊）。 */
const storeWith = (world: World, save: CardStore['save']): CardStore => ({ ...world.store, save });

/** 讀檔先停住，open() 才放行（等讀檔的期間做別的事）。 */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  return { opened, open: () => release() };
}

/**
 * 卡片庫裡放一張第 index 張範例的卡（id＝id、卡名＝name）。old＝舊版：圖和現在的範例檔不一樣（拿掉最上面那層，
 * 像 T-823 以前的第一版——圖全換過；這裡少一張就夠「不一樣」）。
 */
async function seed(world: World, index: number, opts: { id: string; name?: string; old?: boolean }): Promise<Card> {
  const result = await importHolocard(sampleBlob(SAMPLE_FILES[index]!), { newId: () => opts.id, now: () => OLD_TIME });
  if (!result.ok) throw new Error(result.reason);
  let card: Card = { ...result.card, name: opts.name ?? ZH[index]! };
  if (opts.old) card = { ...card, front: { ...card.front, layers: card.front.layers.slice(0, -1) } };
  const used = new Set(cardImages(card));
  for (const image of result.images) if (used.has(image.hash)) await world.store.saveImage(image);
  await world.store.save(card);
  return card;
}

/** 老使用者：卡片庫有前四張的舊版（第一版，中文名）、沒有光碟與月下幽舞、meta 沒有 samplesAdded；開著舊的星晶龍。 */
async function oldUser(): Promise<World> {
  const world = await makeWorld();
  for (let i = 0; i < 4; i++) await seed(world, i, { id: `old-${i}`, old: true });
  await world.store.setMeta(LAST_OPENED_KEY, 'old-0');
  const choice = await world.session.chooseStart();
  await world.session.openStart(choice!.card);
  return world;
}

const names = async (store: CardStore) => (await store.list()).map((c) => c.name).sort();
const addedMeta = async (store: CardStore) => JSON.parse((await store.getMeta(SAMPLES_ADDED_KEY)) ?? 'null') as unknown;
const fullMeta = () => Object.fromEntries(SAMPLE_FILES.map((file, i) => [file, SAMPLE_VERSIONS[i]]));

beforeEach(() => {
  ids = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('範例版本號（T-829）', () => {
  it('每張範例一個版本號，和 SAMPLE_FILES 對齊：前四張 2（T-823 第二版；星晶龍 T-826 圖沒換也算 2）、光碟 1、月下幽舞 1', () => {
    expect(SAMPLE_VERSIONS).toHaveLength(SAMPLE_FILES.length);
    expect(SAMPLE_VERSIONS).toEqual([2, 2, 2, 2, 1, 1]);
    expect(SAMPLES_ADDED_KEY).toBe('samplesAdded');
  });

  it('meta 的值：壞值當作沒有（不是 JSON、不是物件、版本不是正整數、檔名怪的都略過）', () => {
    expect(parseSamplesAdded(undefined)).toEqual({});
    expect(parseSamplesAdded('not json')).toEqual({});
    expect(parseSamplesAdded('[1,2]')).toEqual({});
    expect(parseSamplesAdded('null')).toEqual({});
    expect(parseSamplesAdded('"card1-dragon.holocard"')).toEqual({});
    expect(
      parseSamplesAdded(
        JSON.stringify({
          'card1-dragon.holocard': 2,
          'card2-swordsman.holocard': '2',
          'card3-pollenbear.holocard': 0,
          'card4-neon.holocard': 1.5,
          'card5-disc.holocard': -1,
          'later-sample.holocard': 3,
          __proto__x: 1,
        }),
      ),
    ).toEqual({ 'card1-dragon.holocard': 2, 'later-sample.holocard': 3 });
    const proto = parseSamplesAdded('{"__proto__": {"polluted": 1}, "card6-moonlit.holocard": 1}');
    expect(proto).toEqual({ 'card6-moonlit.holocard': 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('「（新版）」：名字後面加目前語言的字；太長就把原名截短再加（以 Unicode 字元計，最多 60 字）', () => {
    expect(newVersionName('星晶龍')).toBe('星晶龍（新版）');
    expect(newVersionName('Astralshard Dragon', en.defaults.newVersionSuffix)).toBe('Astralshard Dragon (new)');
    const long = '龍'.repeat(NAME_MAX);
    const named = newVersionName(long);
    expect(Array.from(named)).toHaveLength(NAME_MAX);
    expect(named.endsWith('（新版）')).toBe(true);
  });

  it('新加的字（四種語言）：（新版）與提示句，名字用各語言的頓號／逗號接', () => {
    expect([zhHant, en, ja, ko].map((d) => d.defaults.newVersionSuffix)).toEqual(['（新版）', ' (new)', '（新版）', ' (새 버전)']);
    expect(S.app.samplesAdded('星海唱片鯨', '月下幽舞')).toBe('把新的範例卡放進〔我的卡片〕了：星海唱片鯨、月下幽舞');
    expect(en.app.samplesAdded('A', 'B')).toContain('A, B');
    expect(ja.app.samplesAdded('A', 'B')).toContain('A、B');
    expect(ko.app.samplesAdded('A', 'B')).toContain('A, B');
  });
});

describe('老使用者開工坊：補新的範例（DESIGN §7.4）', () => {
  it('有舊版前四張、沒有後兩張、沒有 samplesAdded：多出後兩張＋四張「（新版）」，舊的不動、不換卡、meta 記滿；再開一次不再多', async () => {
    const world = await oldUser();
    const before = await world.store.list();
    const fetchSample = fsFetch();
    const added = await addNewSamples(topUpDeps(world, { fetchSample }));
    expect(added).toEqual(['星晶龍（新版）', '颯真・雲斬（新版）', '琥根花粉獸（新版）', '霓虹信使（新版）', '星海唱片鯨', '月下幽舞']);
    expect(await names(world.store)).toEqual([...ZH.slice(0, 4), ...added].sort());
    // 舊的那四張不動（同 id、同時間）
    const after = await world.store.list();
    for (const old of before) expect(after.find((c) => c.id === old.id)?.updatedAt).toBe(old.updatedAt);
    // 不換掉正在編輯的卡、上次編輯的那張不變
    expect(world.current()?.id).toBe('old-0');
    expect(await world.store.getMeta(LAST_OPENED_KEY)).toBe('old-0');
    // 補進來的卡：新 id、圖都存了、卡片庫縮圖＝卡片檔裡的預覽圖
    for (const summary of after.filter((c) => !c.id.startsWith('old-'))) {
      expect(summary.id).toMatch(/^new-/);
      expect(summary.thumbnail, summary.name).toBeInstanceOf(Blob);
      const card = (await world.store.load(summary.id))!;
      for (const hash of cardImages(card)) expect(await world.store.loadImage(hash), `${card.name} ${hash}`).toBeDefined();
    }
    expect(await addedMeta(world.store)).toEqual(fullMeta());

    // 再開一次：都拿過了 → 什麼都不讀、不多
    const again = fsFetch();
    expect(await addNewSamples(topUpDeps(world, { fetchSample: again }))).toEqual([]);
    expect(again.calls).toEqual([]);
    expect(await world.store.list()).toHaveLength(10);
  }, 30_000);

  it('同名而且同一版（卡片圖層的圖和範例檔一樣）：不放、記成拿過了', async () => {
    const world = await makeWorld();
    await seed(world, 0, { id: 'mine-0' });
    await seed(world, 4, { id: 'mine-4' });
    const added = await addNewSamples(topUpDeps(world));
    expect(added).toEqual(['颯真・雲斬', '琥根花粉獸', '霓虹信使', '月下幽舞']);
    expect(await world.store.list()).toHaveLength(6);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('同名、但使用者自己加了一張新圖（圖比範例檔多）：算不同版，另放「（新版）」；舊的不動', async () => {
    const world = await makeWorld();
    const mine = await seed(world, 1, { id: 'mine-1' });
    const myImage: StoredImage = { hash: 'abcdef0123456789', blob: new Blob([new Uint8Array([1, 2, 3])]), type: 'image/png', width: 8, height: 8, hasAlpha: true };
    await world.store.saveImage(myImage);
    const top = mine.front.layers.at(-1)!;
    const edited: Card = { ...mine, front: { ...mine.front, layers: [...mine.front.layers, { ...top, id: 'my-extra', image: myImage.hash }] } };
    await world.store.save(edited);
    const only = (file: string) => fsFetch(SAMPLE_FILES.filter((f) => f !== file));
    expect(await addNewSamples(topUpDeps(world, { fetchSample: only('card2-swordsman.holocard') }))).toEqual(['颯真・雲斬（新版）']);
    expect((await world.store.load('mine-1'))?.front.layers).toHaveLength(edited.front.layers.length);
    expect(await addedMeta(world.store)).toEqual({ 'card2-swordsman.holocard': 2 });
  }, 30_000);

  it('使用者遇到的情況：第一次開時範例全部讀不到（卡片庫只有一張空白卡、meta 沒有 samplesAdded）→ 下次開六張都補進去，空白卡留著、不換卡', async () => {
    const world = await makeWorld();
    expect(await world.session.chooseStart()).toBeNull();
    // 第一次開：六張都讀不到 → 組裝端改開空白卡（照樣存進卡片庫），meta 沒記任何範例
    const opened = await importSamplesOnFirstOpen({
      fetchSample: fsFetch(SAMPLE_FILES),
      importer: importHolocard,
      newId,
      now: () => START,
      open: (card, images) => world.session.adopt(card, images),
      keep: (card, images, thumbnail) => world.session.addToLibrary(card, images, thumbnail),
      store: world.store,
    });
    expect(opened).toBeNull();
    const blank: Card = { ...newCard('standard', 'blank-1', OLD_TIME), name: S.defaults.cardName };
    expect(await world.session.adopt(blank, [])).toBe('opened');
    expect(await world.store.getMeta(SAMPLES_ADDED_KEY)).toBeUndefined();

    // 下次開：回到空白卡，背景補六張（原名，沒有「（新版）」），提示列出六個名字
    const choice = await world.session.chooseStart();
    expect(choice?.card.id).toBe('blank-1');
    await world.session.openStart(choice!.card);
    const added = await addNewSamples(topUpDeps(world));
    expect(added).toEqual([...ZH]);
    expect(S.app.samplesAdded(...added)).toBe(`把新的範例卡放進〔我的卡片〕了：${ZH.join('、')}`);
    expect(await names(world.store)).toEqual([S.defaults.cardName, ...ZH].sort());
    expect(world.current()?.id).toBe('blank-1');
    expect(await world.store.getMeta(LAST_OPENED_KEY)).toBe('blank-1');
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('補進來的卡被刪掉：再開不會回來；版本號加 1 才再補「（新版）」', async () => {
    const world = await oldUser();
    await addNewSamples(topUpDeps(world));
    const list = await world.store.list();
    const whale = list.find((c) => c.name === '星海唱片鯨')!;
    const dragonNew = list.find((c) => c.name === '星晶龍（新版）')!;
    expect(await world.session.remove(whale.id)).toBe('removed');
    expect(await world.session.remove(dragonNew.id)).toBe('removed');

    const again = fsFetch();
    expect(await addNewSamples(topUpDeps(world, { fetchSample: again }))).toEqual([]);
    expect(again.calls).toEqual([]);
    expect(await world.store.list()).toHaveLength(8);

    // 星晶龍改版（版本號 2 → 3）：卡片庫只剩舊版（圖不一樣）→ 再補一張「（新版）」，meta 記 3；其他不動
    const bumped = [3, ...SAMPLE_VERSIONS.slice(1)];
    const third = fsFetch();
    expect(await addNewSamples(topUpDeps(world, { fetchSample: third, versions: bumped }))).toEqual(['星晶龍（新版）']);
    expect(third.calls).toEqual(['card1-dragon.holocard']);
    expect(await world.store.list()).toHaveLength(9);
    expect(await addedMeta(world.store)).toEqual({ ...fullMeta(), 'card1-dragon.holocard': 3 });
  }, 30_000);

  it('版本號加 1、但卡片庫已經有一樣的圖（同名同版）：不放、只記新的版本號', async () => {
    const world = await makeWorld();
    await seed(world, 0, { id: 'mine-0' });
    await world.store.setMeta(SAMPLES_ADDED_KEY, JSON.stringify(fullMeta()));
    const bumped = [3, ...SAMPLE_VERSIONS.slice(1)];
    expect(await addNewSamples(topUpDeps(world, { versions: bumped }))).toEqual([]);
    expect(await world.store.list()).toHaveLength(1);
    expect(await addedMeta(world.store)).toEqual({ ...fullMeta(), 'card1-dragon.holocard': 3 });
  }, 30_000);

  it('某張讀不到、某張存不進去：跳過、不記（console 記一筆），其他照補；下次開再試', async () => {
    const world = await oldUser();
    const store = storeWith(world, (card, thumbnail) =>
      card.name === '霓虹信使（新版）' ? Promise.reject(new Error('存檔出錯')) : world.store.save(card, thumbnail),
    );
    const added = await addNewSamples(topUpDeps(world, { fetchSample: fsFetch(['card5-disc.holocard']), store }));
    expect(added).toEqual(['星晶龍（新版）', '颯真・雲斬（新版）', '琥根花粉獸（新版）', '月下幽舞']);
    expect(console.error).toHaveBeenCalledTimes(2);
    const meta = fullMeta();
    delete meta['card4-neon.holocard'];
    delete meta['card5-disc.holocard'];
    expect(await addedMeta(world.store)).toEqual(meta);

    // 下次開：只補上次沒成功的兩張
    const again = fsFetch();
    expect(await addNewSamples(topUpDeps(world, { fetchSample: again }))).toEqual(['霓虹信使（新版）', '星海唱片鯨']);
    expect(again.calls.sort()).toEqual(['card4-neon.holocard', 'card5-disc.holocard']);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('T-829c 圖存了、卡存不進去：留下的圖沒有卡用，下次開工坊（chooseStart 先清沒人用的圖）就清掉', async () => {
    const world = await makeWorld();
    await seed(world, 0, { id: 'mine-0' });
    const store = storeWith(world, (card, thumbnail) => (card.name === '月下幽舞' ? Promise.reject(new Error('存檔出錯')) : world.store.save(card, thumbnail)));
    const moon = await importHolocard(sampleBlob('card6-moonlit.holocard'), { newId: () => 'x', now: () => OLD_TIME });
    if (!moon.ok) throw new Error(moon.reason);
    expect(await addNewSamples(topUpDeps(world, { store }))).not.toContain('月下幽舞');
    for (const image of moon.images) expect(await world.store.loadImage(image.hash)).toBeDefined();
    // 下次開工坊
    expect((await world.session.chooseStart())?.card.id).toBeDefined();
    for (const image of moon.images) expect(await world.store.loadImage(image.hash)).toBeUndefined();
  }, 30_000);

  it('沒通過卡片檔的檢查：跳過、不記', async () => {
    const world = await makeWorld();
    const importer: ImportHolocard = async (file, opts) => {
      const result = await importHolocard(file, opts);
      return result.ok && result.card.name === '月下幽舞' ? { ok: false, reason: 'invalid-card', detail: 'test' } : result;
    };
    const added = await addNewSamples(topUpDeps(world, { importer }));
    expect(added).toEqual(ZH.slice(0, 5));
    expect(Object.keys((await addedMeta(world.store)) as object)).not.toContain('card6-moonlit.holocard');
  }, 30_000);

  it('全部讀不到：什麼都不放、不記、回空的（畫面不提示），console 有記', async () => {
    const world = await oldUser();
    expect(await addNewSamples(topUpDeps(world, { fetchSample: fsFetch(SAMPLE_FILES) }))).toEqual([]);
    expect(await world.store.list()).toHaveLength(4);
    expect(await world.store.getMeta(SAMPLES_ADDED_KEY)).toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('沒拿著編輯權：不補（不讀範例檔、不寫任何東西）', async () => {
    const world = await oldUser();
    world.holding = false;
    const fetchSample = fsFetch();
    expect(await addNewSamples(topUpDeps(world, { fetchSample }))).toEqual([]);
    expect(fetchSample.calls).toEqual([]);
    expect(await world.store.list()).toHaveLength(4);
    expect(await world.store.getMeta(SAMPLES_ADDED_KEY)).toBeUndefined();
  });

  it('補到一半被別的分頁接手：停下，後面的不補、不記（拿回來下次開再試）', async () => {
    const world = await oldUser();
    const store = storeWith(world, async (card, thumbnail) => {
      await world.store.save(card, thumbnail);
      world.holding = false;
    });
    const added = await addNewSamples(topUpDeps(world, { store }));
    expect(added).toEqual(['星晶龍（新版）']);
    expect(await world.store.list()).toHaveLength(5);
    // 被接手後寫不進 meta（寫入被擋）：下次開時同名同版會被認出來、只記不放
    world.holding = true;
    world.generation = 2;
    const again = await addNewSamples(topUpDeps(world));
    expect(again).toEqual(['颯真・雲斬（新版）', '琥根花粉獸（新版）', '霓虹信使（新版）', '星海唱片鯨', '月下幽舞']);
    expect(await world.store.list()).toHaveLength(10);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('T-829c 等讀檔的時候使用者從面板建了同一張範例：存之前重讀卡片庫，認得出同名同版 → 不再放一張', async () => {
    const world = await oldUser();
    const disc = gate();
    const fetchSample: FetchSample = async (file) => {
      if (file === 'card5-disc.holocard') await disc.opened;
      return sampleBlob(file);
    };
    const round = addNewSamples(topUpDeps(world, { fetchSample }));
    // 前四張（新版）補好了、光碟還在讀：這時使用者從新卡片面板建了一張「星海唱片鯨」
    await vi.waitFor(async () => expect(await world.store.list()).toHaveLength(8), { timeout: 20_000, interval: 20 });
    const made = await world.session.importFile(sampleBlob('card5-disc.holocard'), sampleImporter(importHolocard, 4), {
      newId: () => 'from-panel',
      now: () => OLD_TIME,
    });
    expect(made.ok).toBe(true);
    disc.open();
    expect(await round).toEqual(['星晶龍（新版）', '颯真・雲斬（新版）', '琥根花粉獸（新版）', '霓虹信使（新版）', '月下幽舞']);
    expect((await names(world.store)).filter((n) => n === '星海唱片鯨')).toHaveLength(1);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('T-829c 比對到存進去之間，別的寫入插不進來（排在 session 的寫入隊伍裡，等這一張存好才輪到）', async () => {
    const world = await makeWorld();
    // 只剩光碟沒拿過
    const meta = fullMeta();
    delete meta['card5-disc.holocard'];
    await world.store.setMeta(SAMPLES_ADDED_KEY, JSON.stringify(meta));
    const copy = await importHolocard(sampleBlob('card5-disc.holocard'), { newId: () => 'user-copy', now: () => OLD_TIME });
    if (!copy.ok) throw new Error(copy.reason);
    const events: string[] = [];
    let other: Promise<boolean> | null = null;
    const store: CardStore = {
      ...world.store,
      // 補範例正在比對（讀卡片庫）時，使用者那邊也要存一張同名的卡
      list: async () => {
        other ??= world.session.addToLibrary(copy.card, copy.images).then((ok) => (events.push('使用者那張存好'), ok));
        return world.store.list();
      },
      save: async (card, thumbnail) => {
        await world.store.save(card, thumbnail);
        events.push(`補範例存好：${card.name}`);
      },
    };
    expect(await addNewSamples(topUpDeps(world, { store }))).toEqual(['星海唱片鯨']);
    expect(await other).toBe(true);
    expect(events).toEqual(['補範例存好：星海唱片鯨', '使用者那張存好']);
  }, 30_000);

  it('T-829c 同時叫兩次：一次只跑一輪，第二輪什麼都不讀、不重複放', async () => {
    const world = await oldUser();
    const second = fsFetch();
    const [a, b] = await Promise.all([addNewSamples(topUpDeps(world)), addNewSamples(topUpDeps(world, { fetchSample: second }))]);
    expect(a).toEqual(['星晶龍（新版）', '颯真・雲斬（新版）', '琥根花粉獸（新版）', '霓虹信使（新版）', '星海唱片鯨', '月下幽舞']);
    expect(b).toEqual([]);
    expect(second.calls).toEqual([]);
    expect(await world.store.list()).toHaveLength(10);
  }, 30_000);

  it('T-829c 失去編輯權又拿回來（世代變了）：舊的那一輪不會復活，停在原地；新的一輪補剩下的', async () => {
    const world = await oldUser();
    const swordsman = gate();
    const fetchSample: FetchSample = async (file) => {
      if (file === 'card2-swordsman.holocard') await swordsman.opened;
      return sampleBlob(file);
    };
    const round = addNewSamples(topUpDeps(world, { fetchSample }));
    await vi.waitFor(async () => expect(await world.store.list()).toHaveLength(5), { timeout: 20_000, interval: 20 });
    // 等第二張讀檔時：被別的分頁接手（false）→ 按〔在這裡繼續〕拿回來（true，世代 2）
    world.holding = false;
    world.generation = 2;
    world.holding = true;
    swordsman.open();
    expect(await round).toEqual(['星晶龍（新版）']);
    expect(await world.store.list()).toHaveLength(5);
    expect(await addedMeta(world.store)).toEqual({ 'card1-dragon.holocard': 2 });
    // 新的一輪（世代 2）：補剩下的五張
    expect(await addNewSamples(topUpDeps(world))).toEqual(['颯真・雲斬（新版）', '琥根花粉獸（新版）', '霓虹信使（新版）', '星海唱片鯨', '月下幽舞']);
    expect(await world.store.list()).toHaveLength(10);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('meta 記的版本比現在的大（只增不減）：那張不補、記錄不變小；不認得的檔名也留著', async () => {
    const world = await makeWorld();
    await world.store.setMeta(SAMPLES_ADDED_KEY, JSON.stringify({ 'card1-dragon.holocard': 5, 'retired.holocard': 1 }));
    const added = await addNewSamples(topUpDeps(world));
    expect(added).toEqual(ZH.slice(1));
    expect(await addedMeta(world.store)).toEqual({ ...fullMeta(), 'card1-dragon.holocard': 5, 'retired.holocard': 1 });
  }, 30_000);

  it('meta 壞掉：當作沒有（照卡片庫比對：同名同版只記、沒有的補）', async () => {
    const world = await makeWorld();
    await seed(world, 2, { id: 'mine-2' });
    await world.store.setMeta(SAMPLES_ADDED_KEY, '{broken');
    const added = await addNewSamples(topUpDeps(world));
    expect(added).toEqual([ZH[0], ZH[1], ZH[3], ZH[4], ZH[5]]);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);
});

describe('補新的範例：名字跟著語言（DESIGN §9）', () => {
  it('英文介面：沒有的放英文名（圖層名也換）、有同名舊版的放 “ (new)”；同名比對四種語言都算', async () => {
    const world = await makeWorld();
    // 星晶龍舊版是日文名、颯真舊版是中文名、琥根花粉獸是韓文名而且是同一版、霓虹信使是英文名的舊版
    await seed(world, 0, { id: 'ja-0', name: ja.samples.names[0]!, old: true });
    await seed(world, 1, { id: 'zh-1', old: true });
    await seed(world, 2, { id: 'ko-2', name: ko.samples.names[2]! });
    await seed(world, 3, { id: 'en-3', name: en.samples.names[3]!, old: true });
    const added = await addNewSamples(topUpDeps(world, { names: en.samples.names, layers: en.samples.layers, newSuffix: en.defaults.newVersionSuffix }));
    expect(added).toEqual([
      'Astralshard Dragon (new)',
      'Saevan Cloudcleaver (new)',
      'Neon Nightcourier (new)',
      'Starwave Vinylwhale',
      'Moonlit Spirit Waltz',
    ]);
    const moon = (await world.store.list()).find((c) => c.name === 'Moonlit Spirit Waltz')!;
    const moonCard = (await world.store.load(moon.id))!;
    const englishLayers = Object.values(en.samples.layers[5]!);
    expect(moonCard.front.layers.map((l) => l.name).sort()).toEqual([...englishLayers].sort());
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('「（新版）」那張已經在卡片庫（例如換了語言、上次沒記到 meta）：認得出是同名同版，不再放一張', async () => {
    const world = await makeWorld();
    await seed(world, 0, { id: 'old-0', old: true });
    // 上次在中文介面補進來的「星晶龍（新版）」，但 meta 沒記到
    await seed(world, 0, { id: 'new-0', name: '星晶龍（新版）' });
    const added = await addNewSamples(
      topUpDeps(world, {
        fetchSample: fsFetch(SAMPLE_FILES.slice(1)),
        names: ko.samples.names,
        layers: ko.samples.layers,
        newSuffix: ko.defaults.newVersionSuffix,
      }),
    );
    expect(added).toEqual([]);
    expect(await world.store.list()).toHaveLength(2);
    expect(await addedMeta(world.store)).toEqual({ 'card1-dragon.holocard': 2 });
  }, 30_000);
});

describe('第一次開（卡片庫是空的）：照舊匯入全部，並把每張的版本記進 samplesAdded', () => {
  async function firstOpen(world: World, fetchSample: FetchSample = fsFetch()) {
    return importSamplesOnFirstOpen({
      fetchSample,
      importer: importHolocard,
      newId,
      now: () => START,
      open: (card, images) => world.session.adopt(card, images),
      keep: (card, images, thumbnail) => world.session.addToLibrary(card, images, thumbnail),
      store: world.store,
    });
  }

  it('六張、meta 記滿；之後開工坊補新的範例：什麼都不讀、不多出「（新版）」', async () => {
    const world = await makeWorld();
    expect(await world.session.chooseStart()).toBeNull();
    expect((await firstOpen(world))?.name).toBe('星晶龍');
    expect(await world.store.list()).toHaveLength(6);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
    const again = fsFetch();
    expect(await addNewSamples(topUpDeps(world, { fetchSample: again }))).toEqual([]);
    expect(again.calls).toEqual([]);
    expect(await world.store.list()).toHaveLength(6);
  }, 30_000);

  it('某張讀不到：那張不記；下次開工坊時補上（沒有同名的卡，放原名）', async () => {
    const world = await makeWorld();
    await firstOpen(world, fsFetch(['card6-moonlit.holocard']));
    const meta = fullMeta();
    delete meta['card6-moonlit.holocard'];
    expect(await addedMeta(world.store)).toEqual(meta);
    expect(await addNewSamples(topUpDeps(world))).toEqual(['月下幽舞']);
    expect(await addedMeta(world.store)).toEqual(fullMeta());
  }, 30_000);

  it('T-829c 記錄和別的改動同時寫 meta：原子合併，兩邊都留著', async () => {
    const world = await makeWorld();
    const other = world.store.updateMeta(SAMPLES_ADDED_KEY, (old) => JSON.stringify({ ...parseSamplesAdded(old), 'retired.holocard': 4 }));
    await Promise.all([firstOpen(world), other]);
    expect(await addedMeta(world.store)).toEqual({ ...fullMeta(), 'retired.holocard': 4 });
  }, 30_000);

  it('記錄只增不減：meta 原本有的（例如更大的版本、不認得的檔名）留著', async () => {
    const world = await makeWorld();
    await world.store.setMeta(SAMPLES_ADDED_KEY, JSON.stringify({ 'card2-swordsman.holocard': 7, 'retired.holocard': 1 }));
    await firstOpen(world);
    expect(await addedMeta(world.store)).toEqual({ ...fullMeta(), 'card2-swordsman.holocard': 7, 'retired.holocard': 1 });
  }, 30_000);
});
