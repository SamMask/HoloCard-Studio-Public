// T-828a 換語言（DESIGN §9「切換」）：選了別的語言 → 先等進行中的上傳／加文字做完、存檔存好（「儲存中…」時等它）
// → 記下語言 → 整頁重新載入；存不到時不換、提醒（同「沒存到」的規則）。選目前的語言不做事；等的時候再按不會重來一次。
import { describe, expect, it } from 'vitest';
import { createAutoSaver } from '../src/app/autosave';
import { createLangSwitcher, RETURN_PLACE_KEY, rememberPlace, saveUntilSaved, takePlace, type LangSwitchDeps, type PlaceStorage } from '../src/app/lang-switch';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import type { Lang } from '../src/i18n/lang';
import { zhHant } from '../src/i18n/zh-Hant';
import { newCard, newDisc } from '../src/model/create';
import type { Card } from '../src/model/types';
import * as ed from '../src/ui/editor';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeDeps(over: Partial<LangSwitchDeps> = {}) {
  const log: string[] = [];
  const deps: LangSwitchDeps = {
    current: 'zh-Hant',
    work: () => [],
    settle: async () => void log.push('settle'),
    save: async () => {
      log.push('save');
      return true;
    },
    remember: (lang: Lang) => {
      log.push(`remember:${lang}`);
      return true;
    },
    reload: () => void log.push('reload'),
    notSaved: () => void log.push('not-saved'),
    notRemembered: () => void log.push('not-remembered'),
    aiBusy: () => false,
    aiWorking: () => void log.push('ai-working'),
    asking: () => false,
    answerFirst: () => void log.push('answer-first'),
    holding: () => true,
    ...over,
  };
  return { deps, log };
}

describe('換語言：等存好才重新載入', () => {
  it('選別的語言：先等進行中的工作 → 存好 → 記下語言 → 重新載入（照這個順序）', async () => {
    const { deps, log } = fakeDeps();
    expect(await createLangSwitcher(deps)('en')).toBe('reloading');
    expect(log).toEqual(['settle', 'save', 'remember:en', 'reload']);
  });

  it('選目前的語言：什麼都不做（不存、不重新載入）', async () => {
    const { deps, log } = fakeDeps({ current: 'ja' });
    expect(await createLangSwitcher(deps)('ja')).toBe('same');
    expect(log).toEqual([]);
  });

  it('存不到：不換（不記語言、不重新載入），照「沒存到」的規則提醒', async () => {
    const { deps, log } = fakeDeps({
      save: async () => {
        log.push('save');
        return false;
      },
    });
    expect(await createLangSwitcher(deps)('ko')).toBe('not-saved');
    expect(log).toEqual(['settle', 'save', 'not-saved']);
  });

  it('還在存（儲存中…）：等存檔回來才重新載入', async () => {
    const saving = deferred<boolean>();
    const { deps, log } = fakeDeps({
      save: () => {
        log.push('save');
        return saving.promise;
      },
    });
    const done = createLangSwitcher(deps)('en');
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['settle', 'save']);
    saving.resolve(true);
    expect(await done).toBe('reloading');
    expect(log).toEqual(['settle', 'save', 'remember:en', 'reload']);
  });

  it('等的時候再按（同一種或別種）：不重來，只換第一次選的', async () => {
    const saving = deferred<boolean>();
    const { deps, log } = fakeDeps({
      save: () => {
        log.push('save');
        return saving.promise;
      },
    });
    const change = createLangSwitcher(deps);
    const first = change('en');
    expect(await change('ja')).toBe('busy');
    saving.resolve(true);
    await first;
    expect(log).toEqual(['settle', 'save', 'remember:en', 'reload']);
  });

  it('存不到之後可以再試一次', async () => {
    let ok = false;
    const { deps, log } = fakeDeps({
      save: async () => {
        log.push('save');
        return ok;
      },
    });
    const change = createLangSwitcher(deps);
    expect(await change('en')).toBe('not-saved');
    ok = true;
    expect(await change('en')).toBe('reloading');
    expect(log.filter((l) => l === 'reload')).toHaveLength(1);
  });

  it('等工作或存檔時出錯：當成存不到（不換）', async () => {
    const { deps, log } = fakeDeps({
      settle: async () => {
        throw new Error('壞了');
      },
    });
    expect(await createLangSwitcher(deps)('en')).toBe('not-saved');
    expect(log).toEqual(['not-saved']);
  });
});

describe('T-828g 換語言：AI 去背／拆層還在做', () => {
  it('提示的字：四種語言都有，正體中文是定稿的那一句', () => {
    expect(zhHant.lang.aiBusy).toBe('AI 還在處理，做完再換語言。');
    for (const dict of [en, ja, ko]) expect(dict.lang.aiBusy.trim()).not.toBe('');
    expect(en.lang.aiBusy).toMatch(/^AI is still working/);
  });

  it('AI 在忙：不換（不等工作、不存、不記語言、不重新載入），提示一句', async () => {
    const { deps, log } = fakeDeps({ aiBusy: () => true });
    expect(await createLangSwitcher(deps)('en')).toBe('ai-busy');
    expect(log).toEqual(['ai-working']);
  });

  it('選目前的語言：就算 AI 在忙也什麼都不做（不提示）', async () => {
    const { deps, log } = fakeDeps({ current: 'ja', aiBusy: () => true });
    expect(await createLangSwitcher(deps)('ja')).toBe('same');
    expect(log).toEqual([]);
  });

  it('AI 在忙時被擋下之後，等它做完再選就換得成', async () => {
    let busy = true;
    const { deps, log } = fakeDeps({ aiBusy: () => busy });
    const change = createLangSwitcher(deps);
    expect(await change('ko')).toBe('ai-busy');
    busy = false;
    expect(await change('ko')).toBe('reloading');
    expect(log).toEqual(['ai-working', 'settle', 'save', 'remember:ko', 'reload']);
  });

  it('等存檔的時候 AI 才開始做：最後一刻擋下（不記語言、不重新載入）', async () => {
    let busy = false;
    const { deps, log } = fakeDeps({
      aiBusy: () => busy,
      save: async () => {
        log.push('save');
        busy = true; // 存檔的空檔 AI 開始了
        return true;
      },
    });
    expect(await createLangSwitcher(deps)('en')).toBe('ai-busy');
    expect(log).toEqual(['settle', 'save', 'ai-working']);
  });
});

describe('saveUntilSaved：存到目前這一版為止', () => {
  it('已經存好（或沒有卡）：照樣 flush 一次（含縮圖：卡片庫縮圖補成最新，T-828j），不重複存', async () => {
    const calls: unknown[] = [];
    const saver = { isSaved: () => true, flush: async (options?: { thumbnail?: boolean }) => (calls.push(options), true) };
    expect(await saveUntilSaved(saver, () => null)).toBe(true);
    expect(calls).toEqual([{ thumbnail: true }]);
  });

  it('還沒存好：存（含縮圖）；存的時候又改了 → 再存一次，直到這一版存好', async () => {
    let version = 1;
    let saved = 0;
    const flushes: unknown[] = [];
    const saver = {
      isSaved: (card: { v: number } | null) => card !== null && card.v === saved,
      flush: async (options?: { thumbnail?: boolean }) => {
        flushes.push(options);
        saved = version;
        if (flushes.length === 1) version = 2; // 存的時候又改了
        return true;
      },
    };
    expect(await saveUntilSaved(saver, () => ({ v: version }))).toBe(true);
    expect(flushes).toEqual([{ thumbnail: true }, { thumbnail: true }]);
  });

  it('存失敗：false', async () => {
    const saver = { isSaved: () => false, flush: async () => false };
    expect(await saveUntilSaved(saver, () => ({}))).toBe(false);
  });

  it('真的自動存（T-828j）：卡片早就存好、縮圖還不是這一版 → 補一張縮圖（卡片不重寫）；縮圖已經是這一版、沒改過的備援卡 → 什麼都不寫', async () => {
    const log: string[] = [];
    const store = {
      saveImage: async () => void log.push('image'),
      save: async (card: Card) => void log.push(`save:${card.id}`),
      saveThumbnail: async (id: string) => (log.push(`thumb:${id}`), true),
      setMeta: async () => {},
      estimate: async () => null,
    };
    const card = newCard('standard', 'c1', '2026-10-15T00:00:00.000Z');
    let current: Card | null = card;
    const saver = createAutoSaver({
      store,
      current: () => current,
      image: () => undefined,
      thumbnail: async () => new Blob(['thumb'], { type: 'image/webp' }),
      onStatus: () => {},
      onStorageLow: () => {},
    });
    saver.opened(card, true);
    expect(await saveUntilSaved(saver, () => current)).toBe(true);
    expect(log).toEqual(['thumb:c1']);

    log.length = 0;
    expect(await saveUntilSaved(saver, () => current)).toBe(true);
    expect(log).toEqual([]);

    const spare = newCard('standard', 'spare', '2026-10-15T00:00:00.000Z');
    current = spare;
    saver.opened(spare, false, { memoryOnly: true });
    expect(await saveUntilSaved(saver, () => current)).toBe(true);
    expect(log).toEqual([]);
  });
});

describe('T-828j 換語言：等的時候又上傳（不能丟圖）', () => {
  it('存檔的時候又排進新的上傳：再等那次上傳做完、再存一次，才記語言、重新載入', async () => {
    let uploads: Promise<void> = Promise.resolve();
    const upload = deferred();
    let version = 1;
    let savedVersion = 0;
    let first = true;
    const { deps, log } = fakeDeps({
      work: () => [uploads],
      settle: async () => {
        log.push('settle');
        await uploads;
      },
      save: async () => {
        log.push('save');
        if (first) {
          first = false;
          // 等存檔的空檔，使用者又上傳了一張（圖還在處理，還沒加進卡片）
          uploads = uploads
            .then(() => upload.promise)
            .then(() => {
              version += 1;
              log.push('layer-added');
            });
        }
        savedVersion = version;
        return true;
      },
      reload: () => void log.push(`reload:saved-v${savedVersion}:card-v${version}`),
    });
    const done = createLangSwitcher(deps)('en');
    await tick();
    // 還在等新的那次上傳：不能先重新載入
    expect(log).toEqual(['settle', 'save', 'settle']);
    upload.resolve();
    expect(await done).toBe('reloading');
    expect(log).toEqual(['settle', 'save', 'settle', 'layer-added', 'save', 'remember:en', 'reload:saved-v2:card-v2']);
  });

  it('等工作的時候（settle 期間）另一條隊伍排進新的工作（例如加文字）：也再等一輪、再存', async () => {
    let uploads: Promise<void> = Promise.resolve();
    let text: Promise<void> = Promise.resolve();
    let rounds = 0;
    const { deps, log } = fakeDeps({
      work: () => [uploads, text],
      settle: async () => {
        rounds += 1;
        log.push(`settle:${rounds}`);
        if (rounds === 1) text = text.then(() => void log.push('text-drawn'));
        await uploads;
        await text;
      },
    });
    expect(await createLangSwitcher(deps)('ja')).toBe('reloading');
    expect(log).toEqual(['settle:1', 'text-drawn', 'save', 'settle:2', 'save', 'remember:ja', 'reload']);
  });

  it('等到的上傳是沒有透明背景的圖、正在問要怎麼用：不換（不記語言、不重新載入），提示先回答', async () => {
    let asking = false;
    const { deps, log } = fakeDeps({
      settle: async () => {
        log.push('settle');
        asking = true; // 上傳做完，跳出「這張圖沒有透明背景。要怎麼用？」
      },
      asking: () => asking,
    });
    expect(await createLangSwitcher(deps)('ko')).toBe('asking');
    expect(log).toEqual(['settle', 'save', 'answer-first']);
  });

  it('一開始就有剛上傳的圖在等回答：不等、不存、不換，提示先回答；回答完再選就換得成', async () => {
    let asking = true;
    const { deps, log } = fakeDeps({ asking: () => asking });
    const change = createLangSwitcher(deps);
    expect(await change('en')).toBe('asking');
    expect(log).toEqual(['answer-first']);
    asking = false;
    expect(await change('en')).toBe('reloading');
    expect(log).toEqual(['answer-first', 'settle', 'save', 'remember:en', 'reload']);
  });

  it('提示的字：四種語言都有，正體中文是這一句', () => {
    expect(zhHant.lang.answerFirst).toBe('先選好剛上傳的圖要怎麼用，再換語言。');
    for (const dict of [en, ja, ko]) expect(dict.lang.answerFirst.trim()).not.toBe('');
  });
});

describe('T-828j 換語言：等的時候被別的分頁接手', () => {
  it('存好時已經交出編輯權（存檔停住、算存好）：不換——不記語言、不重新載入、不提示（接手的遮罩已經在說明）', async () => {
    let holding = true;
    const { deps, log } = fakeDeps({
      holding: () => holding,
      save: async () => {
        log.push('save');
        holding = false; // 等存檔的空檔，另一個分頁按了〔在這裡繼續〕
        return true;
      },
    });
    expect(await createLangSwitcher(deps)('en')).toBe('handed-off');
    expect(log).toEqual(['settle', 'save']);
  });

  it('交出編輯權、存檔也回存不到：一樣不提示「沒存到」（遮罩已經在說明）', async () => {
    let holding = true;
    const { deps, log } = fakeDeps({
      holding: () => holding,
      save: async () => {
        log.push('save');
        holding = false;
        return false;
      },
    });
    expect(await createLangSwitcher(deps)('ko')).toBe('handed-off');
    expect(log).toEqual(['settle', 'save']);
  });

  it('交出編輯權時就算 AI 在忙、有問題沒回答：也只是不換、不提示', async () => {
    let holding = true;
    let busy = false;
    const { deps, log } = fakeDeps({
      holding: () => holding,
      aiBusy: () => busy,
      asking: () => busy,
      save: async () => {
        log.push('save');
        holding = false;
        busy = true;
        return true;
      },
    });
    expect(await createLangSwitcher(deps)('ja')).toBe('handed-off');
    expect(log).toEqual(['settle', 'save']);
  });
});

describe('T-828j 換語言：語言記不住', () => {
  it('寫不進 localStorage：不重新載入，提示一句；之後寫得進去再選就換得成', async () => {
    let ok = false;
    const { deps, log } = fakeDeps({
      remember: (lang) => {
        log.push(`remember:${lang}`);
        return ok;
      },
    });
    const change = createLangSwitcher(deps);
    expect(await change('ja')).toBe('not-remembered');
    expect(log).toEqual(['settle', 'save', 'remember:ja', 'not-remembered']);
    ok = true;
    expect(await change('ja')).toBe('reloading');
    expect(log.filter((l) => l === 'reload')).toHaveLength(1);
  });

  it('提示的字：四種語言都有，正體中文是這一句', () => {
    expect(zhHant.lang.cannotRemember).toBe('這個瀏覽器記不住語言設定，沒辦法換語言。');
    for (const dict of [en, ja, ko]) expect(dict.lang.cannotRemember.trim()).not.toBe('');
  });
});

describe('T-828j 換語言回來：同一張卡、同一面', () => {
  function fakeSession(initial: Record<string, string> = {}): PlaceStorage & { data: Map<string, string> } {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  it('重新載入前記下卡片 id 與面別；回來讀一次就清掉（之後自己按重新整理不再套用）', () => {
    const storage = fakeSession({ other: 'x' });
    rememberPlace({ cardId: 'card-1', face: 'back' }, () => storage);
    expect(takePlace(() => storage)).toEqual({ cardId: 'card-1', face: 'back' });
    expect(storage.data.has(RETURN_PLACE_KEY)).toBe(false);
    expect(storage.data.get('other')).toBe('x');
    expect(takePlace(() => storage)).toBeNull();
  });

  it('壞值、別的形狀、沒有、讀寫丟錯：當作沒記（null），不丟錯', () => {
    for (const bad of ['', 'not json', '[]', 'null', '{"cardId":"a"}', '{"cardId":"a","face":"side"}', '{"cardId":3,"face":"back"}', '{"cardId":"","face":"back"}']) {
      expect(takePlace(() => fakeSession({ [RETURN_PLACE_KEY]: bad }))).toBeNull();
    }
    expect(takePlace(() => fakeSession())).toBeNull();
    expect(takePlace(() => null)).toBeNull();
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(takePlace(boom)).toBeNull();
    expect(() => rememberPlace({ cardId: 'a', face: 'front' }, boom)).not.toThrow();
    expect(() =>
      rememberPlace({ cardId: 'a', face: 'front' }, () => ({
        getItem: () => null,
        setItem() {
          throw new DOMException('quota', 'QuotaExceededError');
        },
        removeItem() {},
      })),
    ).not.toThrow();
    // 沒有 window（node）：預設的 storage 拿不到也不丟錯
    expect(() => rememberPlace({ cardId: 'a', face: 'front' })).not.toThrow();
    expect(takePlace()).toBeNull();
  });

  it('編輯器：一般卡記編輯的那一面，回來換到那一面（同點〔背面〕）', () => {
    const card = newCard('standard', 'c1', '2026-10-15T00:00:00.000Z');
    const before = ed.selectFace(ed.createEditor(card), 'back');
    expect(ed.shownFace(before)).toBe('back');
    const after = ed.showSide(ed.createEditor(card), ed.shownFace(before));
    expect(after.face).toBe('back');
    expect(ed.shownFace(after)).toBe('back');
    expect(after.selectedLayerId).toBeNull();
    expect(ed.currentCard(after)).toBe(card);
    expect(ed.shownFace(ed.createEditor(card))).toBe('front');
  });

  it('編輯器：CD 光碟記給人看的那一面（viewFace），回來翻到那一面、編輯的面留在正面', () => {
    const disc = newDisc('d1', '2026-10-15T00:00:00.000Z');
    const before = ed.turnedTo(ed.selectFace(ed.createEditor(disc), 'back'), 'back');
    expect(before.face).toBe('front');
    expect(ed.shownFace(before)).toBe('back');
    const after = ed.showSide(ed.createEditor(disc), 'back');
    expect(after.face).toBe('front');
    expect(after.viewFace).toBe('back');
    expect(ed.shownFace(after)).toBe('back');
  });
});
