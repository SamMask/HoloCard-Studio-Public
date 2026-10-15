// T-703b 右欄〔自動去背〕（DESIGN §3.1）：選中沒有透明背景的立體層 → 走 ai-cutout 同一套流程 → 去背好的圖換上這一層
// （同一個 id、其他設定不變、記一步）。找不到主角不問〔當底圖〕；做的途中換卡、卡被刪、層被刪、圖被換掉都有交代。
// ai-cutout 用假的 runner 與假的組裝端；開著的卡用編輯器；存檔裡的卡用真的 session（fake-indexeddb）；加回原卡用真的登記簿。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_COVERAGE } from '../src/app/ai-cutout';
import { addAiResult, editorImages } from '../src/app/ai-results';
import { createSession } from '../src/app/session';
import { createImageRegistry } from '../src/images/registry';
import { addLayer, type NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import {
  addUploadedLayer,
  answerOpaqueLayer,
  askOpaqueUpload,
  createEditor,
  currentCard,
  deleteLayer,
  editLayer,
  redoEdit,
  replaceCutoutInCard,
  replaceLayerImageEdit,
  replaceRoom,
  selectFace,
  selectLayer,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import {
  AI_REPLACE_CARD_GONE_TEXT,
  AI_REPLACE_LAYER_GONE_TEXT,
  AI_REPLACE_NO_BACKGROUND_TEXT,
  AI_REPLACE_NO_SUBJECT_TEXT,
  AI_REPLACED_TEXT,
  aiReplacedStoredText,
  problemText,
} from '../src/ui/logic';
import { flush, harness, hashOf, rgba, source, stored } from './ai-fakes';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';

/** 右欄按〔自動去背〕時交給 ai-cutout 的那張圖：選中那一層的圖（沒有透明）＋要換掉的那一層。 */
const layerSource = (cardId = 'card-1', layerId = 'glow') =>
  source(cardId, { image: stored(2, false, 1024, 1024), name: '光效', fileName: '光效', replaceLayerId: layerId });

// ---- ai-cutout：同一套流程，結果交給 replace（不是 add） ----

describe('ai-cutout：右欄〔自動去背〕（replaceLayerId）走同一套流程', () => {
  it('成功：去背好的圖交給組裝端的 replace（不加新層）；開著的卡換好了說「去背好了。」', async () => {
    const t = harness();
    void t.cutout.start(layerSource());
    await flush();
    expect(t.cutout.view().progress?.step).toBe('load');
    t.calls[0]!.resolve({ image: rgba(1024, 1024), coverage: 0.3 });
    await t.cutout.idle();
    expect(t.added).toHaveLength(0);
    expect(t.replaced).toHaveLength(1);
    expect(t.replaced[0]!.source).toMatchObject({ cardId: 'card-1', face: 'front', replaceLayerId: 'glow' });
    expect(t.replaced[0]!.image).toMatchObject({ hash: hashOf(100), hasAlpha: true });
    expect(t.messages).toEqual([{ kind: 'info', text: AI_REPLACED_TEXT }]);
    expect(AI_REPLACED_TEXT).toBe('去背好了。');
    expect(t.cutout.view().progress).toBeNull();
    expect(t.cutout.view().busy).toBe(false);
  });

  it('現有的上傳流程不變：沒有 replaceLayerId 就走 add、不呼叫 replace、加好不說話', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.3 });
    await t.cutout.idle();
    expect(t.added).toHaveLength(1);
    expect(t.replaced).toHaveLength(0);
    expect(t.messages).toEqual([]);
  });

  it(`找不到主角（coverage < ${MIN_COVERAGE}）：不問〔當底圖〕（這一層已經在卡上了），只說「這張圖找不到主角，沒有改。」`, async () => {
    const t = harness();
    void t.cutout.start(layerSource());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.001 });
    await t.cutout.idle();
    expect(t.replaced).toHaveLength(0);
    expect(t.cutout.view().ask).toBeNull();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_REPLACE_NO_SUBJECT_TEXT }]);
    expect(AI_REPLACE_NO_SUBJECT_TEXT).toBe('這張圖找不到主角，沒有改。');
  });

  it('找不到主角、已經換到別張卡：一樣只說「沒有改」', async () => {
    const t = harness();
    void t.cutout.start(layerSource('card-1'));
    await flush();
    t.state.open = 'card-2';
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0 });
    await t.cutout.idle();
    expect(t.cutout.view().ask).toBeNull();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_REPLACE_NO_SUBJECT_TEXT }]);
  });

  it('整張都被當成主角（去背後沒有透明）：不問、不換，說一聲', async () => {
    const t = harness();
    t.setEncodeAlpha(false);
    void t.cutout.start(layerSource());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 1 });
    await t.cutout.idle();
    expect(t.replaced).toHaveLength(0);
    expect(t.cutout.view().ask).toBeNull();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_REPLACE_NO_BACKGROUND_TEXT }]);
  });

  it.each([
    [{ result: 'stored', cardName: '龍騎士' } as const, { kind: 'info', text: '去背好了，改好「龍騎士」的那一層了。' }],
    [{ result: 'missing' } as const, { kind: 'info', text: '那張卡已經刪掉了，去背好的圖沒有用上。' }],
    [{ result: 'layer-gone' } as const, { kind: 'info', text: '那一層已經刪掉了，去背好的圖沒有用上。' }],
    [{ result: 'too-many-images' } as const, { kind: 'error', text: problemText('too-many-images') }],
  ])('做的途中情況變了：組裝端回 %j → 提示列說清楚', async (replaced, message) => {
    const t = harness({ replaced });
    void t.cutout.start(layerSource());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.messages).toEqual([message]);
  });

  it('文字對照', () => {
    expect(aiReplacedStoredText('龍騎士')).toBe('去背好了，改好「龍騎士」的那一層了。');
    expect(AI_REPLACE_CARD_GONE_TEXT).toBe('那張卡已經刪掉了，去背好的圖沒有用上。');
    expect(AI_REPLACE_LAYER_GONE_TEXT).toBe('那一層已經刪掉了，去背好的圖沒有用上。');
  });

  it('一次只做一件：上傳的去背還在做時按右欄的〔自動去背〕不做事；反過來也一樣', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    await t.cutout.start(layerSource());
    expect(t.calls).toHaveLength(1);
    expect(t.cutout.view().busy).toBe(true);
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();

    void t.cutout.start(layerSource());
    await flush();
    await t.cutout.start(source());
    void t.cutout.start(source('card-1', { fileName: 'x.jpg' }), 'split');
    await flush();
    expect(t.calls).toHaveLength(2);
    expect(t.splits).toHaveLength(0);
  });

  it('沒有圖形加速：一樣先問，〔繼續〕才開始，做完照樣換那一層', async () => {
    const t = harness({ fast: false });
    await t.cutout.start(layerSource());
    expect(t.cutout.view().ask).toEqual({ kind: 'slow', fileName: '光效' });
    t.cutout.answer(true);
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.replaced).toHaveLength(1);
  });

  it('取消：不換', async () => {
    const t = harness();
    void t.cutout.start(layerSource());
    await flush();
    t.cutout.cancel();
    await t.cutout.idle();
    expect(t.replaced).toHaveLength(0);
    expect(t.messages).toEqual([]);
  });

  it('開始前放不下：照 room 說、不跑 AI（kind 一樣是 cutout，組裝端看 replaceLayerId 判斷）', async () => {
    const seen: (string | undefined)[] = [];
    const t = harness({ room: (src) => (seen.push(src.replaceLayerId), problemText('too-many-images')) });
    await t.cutout.start(layerSource());
    expect(seen).toEqual(['glow']);
    expect(t.calls).toHaveLength(0);
    expect(t.messages).toEqual([{ kind: 'error', text: problemText('too-many-images') }]);
  });
});

// ---- 編輯器（開著的卡）：換圖、記一步、復原回舊圖 ----

const input = (id: string, hasAlpha: boolean, image: string): NewLayerInput => ({ id, name: id, image, hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、發光層 glow（不透明圖＋發光模式，深度 50）；選中 glow。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false, hashOf(1)), 'bg.jpg', T0).state;
  s = askOpaqueUpload(s, 'front', input('glow', false, hashOf(2)), 'glow.jpg', T0).state;
  s = answerOpaqueLayer(s, 'screen', T0).state;
  s = editLayer(s, 'glow', { x: 0.2, scale: 0.7, opacity: 80, breakout: true }, 'commit', T0);
  return selectLayer(s, 'glow');
}

const glow = (s: EditorState) => currentCard(s).front.layers.find((l) => l.id === 'glow');
const CUT = { image: hashOf(100), hasAlpha: true };

describe('replaceLayerImageEdit：去背好的圖換上這一層（開著的卡）', () => {
  it('同一層換上新圖、hasAlpha true，其他設定不變；記一步；選取維持在這一層', () => {
    const s0 = setup();
    const before = glow(s0)!;
    expect(before).toMatchObject({ hasAlpha: false, blend: 'screen', breakout: true, opacity: 80 });
    const r = replaceLayerImageEdit(s0, 'front', 'glow', hashOf(2), CUT, T1);
    expect(r.problem).toBeNull();
    expect(glow(r.state)).toEqual({ ...before, image: hashOf(100), hasAlpha: true });
    expect(currentCard(r.state).updatedAt).toBe(T1);
    expect(r.state.selectedLayerId).toBe('glow');
    expect(r.state.history.past).toHaveLength(s0.history.past.length + 1);
  });

  it('Ctrl+Z 回舊圖（同一層、還是沒有透明）；Ctrl+Y 再換回去', () => {
    const s0 = setup();
    const r = replaceLayerImageEdit(s0, 'front', 'glow', hashOf(2), CUT, T1);
    const undone = undoEdit(r.state);
    expect(glow(undone)).toEqual(glow(s0));
    expect(undone.selectedLayerId).toBe('glow');
    expect(glow(redoEdit(undone))).toMatchObject({ image: hashOf(100), hasAlpha: true });
    // 新舊兩張圖都還在編輯器用到的圖裡（換卡時登記簿不會收掉，復原／重做才看得到）
    expect(editorImages(undone)).toEqual(new Set([hashOf(1), hashOf(2), hashOf(100)]));
  });

  it('途中改選了別層、或換到另一面：換好不搶選取、不換面', () => {
    const s0 = selectLayer(setup(), 'bg');
    const r = replaceLayerImageEdit(s0, 'front', 'glow', hashOf(2), CUT, T1);
    expect(r.problem).toBeNull();
    expect(r.state.selectedLayerId).toBe('bg');
    const s1 = selectFace(setup(), 'back');
    const r1 = replaceLayerImageEdit(s1, 'front', 'glow', hashOf(2), CUT, T1);
    expect(r1.problem).toBeNull();
    expect(r1.state.face).toBe('back');
    expect(glow(r1.state)?.image).toBe(hashOf(100));
  });

  it('那一層被刪了：layer-gone、卡不變、不記步', () => {
    const s0 = deleteLayer(setup(), 'glow', T1);
    const r = replaceLayerImageEdit(s0, 'front', 'glow', hashOf(2), CUT, T2);
    expect(r.problem).toBe('layer-gone');
    expect(currentCard(r.state)).toBe(currentCard(s0));
    expect(r.state.history.past).toHaveLength(s0.history.past.length);
  });

  it('那一層的圖已經被換掉（雜湊不同了）：當成被刪，不蓋掉後來的改動', () => {
    const s0 = replaceLayerImageEdit(setup(), 'front', 'glow', hashOf(2), { image: hashOf(77), hasAlpha: true }, T1).state;
    const r = replaceLayerImageEdit(s0, 'front', 'glow', hashOf(2), CUT, T2);
    expect(r.problem).toBe('layer-gone');
    expect(glow(r.state)?.image).toBe(hashOf(77));
  });

  it('拖到一半（滑桿 preview）時結果到了：先把拖曳記成一步，再換圖（各一步）', () => {
    const s0 = editLayer(setup(), 'glow', { depth: 80 }, 'preview', T1);
    const r = replaceLayerImageEdit(s0, 'front', 'glow', hashOf(2), CUT, T2);
    expect(glow(r.state)).toMatchObject({ depth: 80, image: hashOf(100) });
    expect(r.state.history.previewBase).toBeNull();
    expect(glow(undoEdit(r.state))).toMatchObject({ depth: 80, image: hashOf(2) });
  });
});

describe('replaceRoom／replaceCutoutInCard：換掉不是新增', () => {
  /** 兩面各 8 層、每層不同的圖＝16 張；正面第 0 層是不透明的發光層。 */
  function full(): Card {
    let card = newCard('standard', 'card-1', T0);
    for (const face of ['front', 'back'] as const) {
      for (let i = 0; i < 8; i++) {
        const n = (face === 'front' ? 0 : 8) + i + 1;
        const r = addLayer(card, face, { ...input(`${face}-${i}`, i !== 0 || face === 'back', hashOf(n)), ...(i === 0 && face === 'front' ? { blend: 'screen' as const } : {}) });
        if (!r.ok) throw new Error(r.reason);
        card = r.card;
      }
    }
    return card;
  }

  it('已經 16 張、舊圖只有這一層在用：放得下', () => {
    const card = full();
    expect(replaceRoom(card, 'front', 'front-0')).toBeNull();
    const r = replaceCutoutInCard(card, 'front', 'front-0', hashOf(1), CUT);
    expect('card' in r && r.card.front.layers.find((l) => l.id === 'front-0')?.image).toBe(hashOf(100));
  });

  it('舊圖還有別層在用、而且已經 16 張：too-many-images（開始前就說、做完也一樣擋）', () => {
    const base = full();
    // 背面第 7 層改用正面第 0 層的圖（15 張）＋反光層黑白圖（16 張）
    const card: Card = {
      ...base,
      back: { layers: base.back.layers.map((l, i) => (i === 7 ? { ...l, image: hashOf(1) } : l)), foil: { shape: 'mask', mask: hashOf(500), frame: true } },
    };
    expect(replaceRoom(card, 'front', 'front-0')).toBe('too-many-images');
    expect(replaceCutoutInCard(card, 'front', 'front-0', hashOf(1), CUT)).toEqual({ problem: 'too-many-images' });
  });

  it('找不到那一層、或圖已經不是開始時那張：layer-gone', () => {
    const card = full();
    expect(replaceCutoutInCard(card, 'front', 'nope', hashOf(1), CUT)).toEqual({ problem: 'layer-gone' });
    expect(replaceCutoutInCard(card, 'back', 'front-0', hashOf(1), CUT)).toEqual({ problem: 'layer-gone' });
    expect(replaceCutoutInCard(card, 'front', 'front-0', hashOf(42), CUT)).toEqual({ problem: 'layer-gone' });
  });
});

// ---- 存檔裡的卡（已經換卡了）：session.editStored ＋ replaceCutoutInCard ----

beforeEach(() => {
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 4;
      naturalHeight = 4;
      decode() {
        return Promise.resolve();
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 組裝端的縮小版：真的登記簿、真的 session、編輯器、上傳隊伍（同 tests/app-ai-results）。 */
async function app() {
  const registry = createImageRegistry();
  const store = await openCardStore(new IDBFactory());
  let editor: EditorState | null = null;
  let uploads: Promise<unknown> = Promise.resolve();
  const queue = <T,>(task: () => T | Promise<T>): Promise<T> => {
    const run = uploads.then(task);
    uploads = run.catch(() => {});
    return run;
  };
  const session = createSession({
    store,
    images: registry,
    current: () => (editor ? currentCard(editor) : null),
    show: (card) => {
      editor = createEditor(card);
    },
    thumbnail: async () => null,
    settle: async () => {
      await uploads;
    },
    onStatus: () => {},
    onStorageLow: () => {},
  });
  const isOpen = (id: string) => editor !== null && currentCard(editor).id === id;
  const deps = { registry, isOpen, queue, inUse: () => (editor ? editorImages(editor) : new Set<string>()) };
  return { registry, store, session, deps, editor: () => editor!, setEditor: (e: EditorState) => (editor = e) };
}

/** 存一張卡：正面一層發光層 glow（圖 hashOf(n)）。 */
async function seed(store: Awaited<ReturnType<typeof openCardStore>>, id: string, n: number, name = id): Promise<Card> {
  const image = stored(n, false);
  const r = addLayer({ ...newCard('standard', id, T0), name }, 'front', { ...input('glow', false, image.hash), blend: 'screen' });
  if (!r.ok) throw new Error(r.reason);
  await store.saveImage(image);
  await store.save(r.card);
  return r.card;
}

/** main 的 replace（存檔那條）：editStored ＋ replaceCutoutInCard。 */
async function replaceStored(a: Awaited<ReturnType<typeof app>>, cardId: string, oldImage: string) {
  const cut = stored(100, true);
  const r = await a.session.editStored(cardId, [cut], (card) => replaceCutoutInCard(card, 'front', 'glow', oldImage, { image: cut.hash, hasAlpha: true }), T1);
  return { r, cut };
}

describe('做完時已經換到別張卡：改存檔裡那張卡的那一層', () => {
  it('換好、圖先存、卡的 updatedAt＝現在 → saved＋卡名', async () => {
    const a = await app();
    await seed(a.store, 'A', 2, '龍騎士');
    await seed(a.store, 'B', 3);
    await a.session.openStart((await a.store.load('B'))!);
    const { r, cut } = await replaceStored(a, 'A', hashOf(2));
    expect(r).toEqual({ result: 'saved', cardName: '龍騎士' });
    const saved = await a.store.load('A');
    expect(saved?.front.layers).toHaveLength(1);
    expect(saved?.front.layers[0]).toMatchObject({ id: 'glow', image: cut.hash, hasAlpha: true, blend: 'screen' });
    expect(saved?.updatedAt).toBe(T1);
    expect(await a.store.loadImage(cut.hash)).toBeDefined();
  });

  it('那張卡被刪了 → missing', async () => {
    const a = await app();
    await seed(a.store, 'B', 3);
    await a.session.openStart((await a.store.load('B'))!);
    expect((await replaceStored(a, 'gone', hashOf(2))).r).toEqual({ result: 'missing' });
  });

  it('存檔裡那張的那一層被刪了 → layer-gone、卡不變', async () => {
    const a = await app();
    const card = await seed(a.store, 'A', 2);
    await a.store.save({ ...card, front: { layers: [] } });
    await seed(a.store, 'B', 3);
    await a.session.openStart((await a.store.load('B'))!);
    expect((await replaceStored(a, 'A', hashOf(2))).r).toEqual({ result: 'problem', problem: 'layer-gone' });
    expect((await a.store.load('A'))?.front.layers).toEqual([]);
  });

  it('存檔裡那張的那一層圖已經被換掉 → layer-gone、不蓋掉', async () => {
    const a = await app();
    const card = await seed(a.store, 'A', 2);
    await a.store.saveImage(stored(9, false));
    await a.store.save({ ...card, front: { layers: card.front.layers.map((l) => ({ ...l, image: hashOf(9) })) } });
    await seed(a.store, 'B', 3);
    await a.session.openStart((await a.store.load('B'))!);
    expect((await replaceStored(a, 'A', hashOf(2))).r).toEqual({ result: 'problem', problem: 'layer-gone' });
    expect((await a.store.load('A'))?.front.layers[0]?.image).toBe(hashOf(9));
  });
});

describe('加回開著的卡（addAiResult）：層被刪了 → 結果圖立即收掉', () => {
  it('開著的卡那一層已經刪了：layer-gone、去背圖不留在登記簿；開著的卡換好時照樣留著', async () => {
    const a = await app();
    await seed(a.store, 'A', 2);
    await a.session.openStart((await a.store.load('A'))!);
    const cut = stored(100, true);
    const toOpen = () => {
      const r = replaceLayerImageEdit(a.editor(), 'front', 'glow', hashOf(2), { image: cut.hash, hasAlpha: true }, T1);
      a.setEditor(r.state);
      return r.problem ? { result: r.problem } : { result: 'added' as const };
    };
    a.setEditor(deleteLayer(a.editor(), 'glow', T1));
    // 刪掉之後馬上復原歷史還在用舊圖，但新圖沒人用
    expect(await addAiResult(a.deps, 'A', [cut], toOpen, async () => ({ result: 'missing' }))).toEqual({ result: 'layer-gone' });
    expect(a.registry.has(cut.hash)).toBe(false);

    a.setEditor(undoEdit(a.editor()));
    expect(await addAiResult(a.deps, 'A', [cut], toOpen, async () => ({ result: 'missing' }))).toEqual({ result: 'added' });
    expect(a.registry.has(cut.hash)).toBe(true);
    expect(currentCard(a.editor()).front.layers[0]).toMatchObject({ id: 'glow', image: cut.hash, hasAlpha: true });
  });
});
