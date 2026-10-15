// AI 自動去背接進工坊（T-703，DESIGN §3.1、§4）：上傳確認框按〔自動去背〕之後的流程。runner 一律用假的。
// 涵蓋：沒有圖形加速先問、去背成功加層（記一步）、換卡時加到原卡（存檔裡）、卡被刪不加、找不到主角、四種錯誤代碼的白話、取消、層數不夠。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../src/ai/runner';
import { createCutout, cutoutFeather, MIN_COVERAGE, type CutoutDeps } from '../src/app/ai-cutout';
import { createSession } from '../src/app/session';
import type { StoredImage } from '../src/images/types';
import { addLayer, type NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import type { CardStore } from '../src/storage/types';
import { addUploadedLayer, createEditor, currentCard, cutoutRoom, undoEdit, type EditorState } from '../src/ui/editor';
import {
  AI_CARD_GONE_TEXT,
  AI_FAILED_TEXT,
  AI_MODEL_MISSING_TEXT,
  AI_NO_SUBJECT_GONE_TEXT,
  aiErrorText,
  aiStoredText,
  problemText,
} from '../src/ui/logic';
import { flush, harness, hashOf, rgba, source, stored } from './ai-fakes';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('模型在不在（DESIGN §4「AI 模型還沒下載」）', () => {
  it('一開始不知道（null）；兩個模型都查，查到在就記住，之後不再問', async () => {
    const t = harness();
    expect(t.cutout.view().matteReady).toBeNull();
    expect(t.cutout.view().depthReady).toBeNull();
    expect(await t.cutout.checkModels()).toEqual({ matte: true, depth: true });
    expect(t.cutout.view().matteReady).toBe(true);
    expect(t.cutout.view().depthReady).toBe(true);
    await t.cutout.checkModels();
    expect(t.asked).toMatchObject({ matte: 1, depth: 1 });
  });

  it('不在：false（每次上傳都再查一次，下載好了就會變成在）；兩個分開記', async () => {
    const t = harness({ available: { matte: false } });
    expect(await t.cutout.checkModels()).toEqual({ matte: false, depth: true });
    expect(t.cutout.view().matteReady).toBe(false);
    expect(t.cutout.view().depthReady).toBe(true);
    await t.cutout.checkModels();
    expect(t.asked).toMatchObject({ matte: 2, depth: 1 });
  });

  it('模型不在還是按了（例如剛刪掉）：不開始，說怎麼下載', async () => {
    const t = harness({ available: false });
    await t.cutout.start(source());
    expect(t.calls).toHaveLength(0);
    expect(t.messages).toEqual([{ kind: 'error', text: AI_MODEL_MISSING_TEXT }]);
  });
});

describe('〔自動去背〕：一按下去畫面就知道在忙（T-703b 審查）', () => {
  it('start 當下（還在查模型、還沒有進度面板）就通知畫面 busy，右欄按鈕馬上變淡', () => {
    const t = harness();
    const seen: boolean[] = [];
    t.deps.changed = () => void seen.push(t.cutout.view().busy);
    void t.cutout.start(source());
    expect(seen[0]).toBe(true);
  });
});

describe('〔自動去背〕：有圖形加速直接開始', () => {
  it('進度面板：第一次「正在載入 AI 模型」（下載算前 9 成）→ 推論中「正在去背…」（不知道比例，約 3 秒慢慢走）', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    expect(t.calls).toHaveLength(1);
    expect(t.cutout.view().progress).toEqual({ step: 'load', fraction: 0, expectSec: 3 });
    expect(t.cutout.view().busy).toBe(true);
    t.calls[0]!.progress!('load', 0.5, 1);
    expect(t.cutout.view().progress).toEqual({ step: 'load', fraction: 0.45, expectSec: 3 });
    // 下載完、還在建模型：停在 9 成，不是 99%
    t.calls[0]!.progress!('load', 1, 1);
    expect(t.cutout.view().progress?.fraction).toBeCloseTo(0.9);
    t.calls[0]!.progress!('run', 0, 1);
    expect(t.cutout.view().progress).toEqual({ step: 'cut', fraction: null, expectSec: 3 });
    t.calls[0]!.progress!('post', 0, 1);
    expect(t.cutout.view().progress?.step).toBe('cut');
  });

  it('邊緣柔化約長邊 0.2%（2048 → 4px，小圖至少 1px），clip 用預設', async () => {
    expect(cutoutFeather(2048, 1024)).toBe(4);
    expect(cutoutFeather(300, 200)).toBe(1);
    const t = harness();
    void t.cutout.start(source());
    await flush();
    expect(t.calls[0]!.refine).toEqual({ feather: 4 });
    expect(t.calls[0]!.image.width).toBe(2048);
  });

  it('成功：去背的圖走 encode（WebP、雜湊）→ 加到開始時那張卡那一面；面板收起', async () => {
    const t = harness();
    const done = t.cutout.start(source('card-1', { face: 'back' }));
    await flush();
    t.calls[0]!.resolve({ image: rgba(2048, 1024), coverage: 0.3 });
    await done;
    await t.cutout.idle();
    expect(t.added).toHaveLength(1);
    expect(t.added[0]!.source).toMatchObject({ cardId: 'card-1', face: 'back', name: 'hero' });
    expect(t.added[0]!.image).toMatchObject({ hash: hashOf(100), hasAlpha: true, width: 2048, height: 1024 });
    expect(t.cutout.view().progress).toBeNull();
    expect(t.cutout.view().busy).toBe(false);
    expect(t.messages).toEqual([]);
  });

  it('第二次就不再說「正在載入 AI 模型」（模型已經在 Worker 裡）', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.3 });
    await t.cutout.idle();
    void t.cutout.start(source());
    await flush();
    expect(t.cutout.view().progress).toEqual({ step: 'cut', fraction: null, expectSec: 3 });
    t.calls[1]!.progress!('load', 0, 1);
    expect(t.cutout.view().progress?.step).toBe('cut');
  });

  it('正在做另一張：再按不做事（按鈕本來就變淡）', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    await t.cutout.start(source('card-1', { fileName: 'second.jpg' }));
    expect(t.calls).toHaveLength(1);
  });
});

describe('沒有圖形加速（沒有 WebGPU）先問', () => {
  it('先問「大約要一分多鐘」：〔繼續〕才開始（進度條照 70 秒走），這次開著工坊之後不再問', async () => {
    const t = harness({ fast: false });
    await t.cutout.start(source());
    expect(t.calls).toHaveLength(0);
    expect(t.cutout.view().ask).toEqual({ kind: 'slow', fileName: 'hero.jpg' });
    expect(t.cutout.view().busy).toBe(true);
    t.cutout.answer(true);
    await flush();
    expect(t.cutout.view().ask).toBeNull();
    expect(t.calls).toHaveLength(1);
    expect(t.cutout.view().progress?.expectSec).toBe(70);
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.added).toHaveLength(1);

    void t.cutout.start(source());
    await flush();
    expect(t.cutout.view().ask).toBeNull();
    expect(t.calls).toHaveLength(2);
  });

  it('〔取消〕：不做、不加，下次還會問', async () => {
    const t = harness({ fast: false });
    await t.cutout.start(source());
    t.cutout.answer(false);
    await t.cutout.idle();
    expect(t.calls).toHaveLength(0);
    expect(t.added).toHaveLength(0);
    expect(t.cutout.view().ask).toBeNull();
    expect(t.cutout.view().busy).toBe(false);
    await t.cutout.start(source());
    expect(t.cutout.view().ask?.kind).toBe('slow');
  });
});

describe('取消（〔取消〕或 Esc）', () => {
  it('推論中取消：面板馬上收起、不加圖、沒有訊息', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    t.cutout.cancel();
    expect(t.cutout.view().progress).toBeNull();
    expect(t.calls[0]!.signal?.aborted).toBe(true);
    await t.cutout.idle();
    expect(t.added).toHaveLength(0);
    expect(t.messages).toEqual([]);
    // 可以馬上再做一張
    void t.cutout.start(source());
    await flush();
    expect(t.calls).toHaveLength(2);
  });

  it('取消之後才回來的結果也不加', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    const call = t.calls[0]!;
    t.cutout.cancel();
    call.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.added).toHaveLength(0);
  });

  it('被別的分頁接手（stop）：進行中的停掉、問題也收掉', async () => {
    const t = harness({ fast: false });
    await t.cutout.start(source());
    t.cutout.stop();
    expect(t.cutout.view().ask).toBeNull();
  });
});

describe('找不到主角', () => {
  it(`coverage < ${MIN_COVERAGE}：開著那張卡就問〔當底圖〕〔取消〕；〔當底圖〕交給組裝端`, async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.004 });
    await t.cutout.idle();
    expect(t.added).toHaveLength(0);
    expect(t.cutout.view().ask).toEqual({ kind: 'no-subject', fileName: 'hero.jpg' });
    expect(t.cutout.view().busy).toBe(false);
    t.cutout.answer(true);
    expect(t.bases.map((s) => s.fileName)).toEqual(['hero.jpg']);
    expect(t.cutout.view().ask).toBeNull();
  });

  it('〔取消〕：什麼都不加', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0 });
    await t.cutout.idle();
    t.cutout.answer(false);
    expect(t.bases).toHaveLength(0);
    expect(t.cutout.view().ask).toBeNull();
  });

  it('整張都被當成主角（去背後沒有透明）：問 no-background', async () => {
    const t = harness();
    t.setEncodeAlpha(false);
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 1 });
    await t.cutout.idle();
    expect(t.added).toHaveLength(0);
    expect(t.cutout.view().ask?.kind).toBe('no-background');
  });

  it('已經換到別張卡：不問（當底圖會加錯卡），只說一聲', async () => {
    const t = harness();
    void t.cutout.start(source('card-1'));
    await flush();
    t.state.open = 'card-2';
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.001 });
    await t.cutout.idle();
    expect(t.cutout.view().ask).toBeNull();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_NO_SUBJECT_GONE_TEXT }]);
  });

  it('問著的時候換了卡：問題收掉', async () => {
    const t = harness();
    void t.cutout.start(source('card-1'));
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0 });
    await t.cutout.idle();
    t.cutout.cardOpened('card-1');
    expect(t.cutout.view().ask).not.toBeNull();
    t.cutout.cardOpened('card-2');
    expect(t.cutout.view().ask).toBeNull();
  });
});

describe('錯誤：依 AiError.code 顯示白話，英文只進 console', () => {
  it.each([
    ['model-missing', AI_MODEL_MISSING_TEXT],
    ['load-failed', AI_FAILED_TEXT],
    ['run-failed', AI_FAILED_TEXT],
    ['bad-output', AI_FAILED_TEXT],
  ] as const)('%s', async (code, text) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = harness();
    await t.cutout.checkModels();
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.reject(new AiError(code, new Error('Some English reason')));
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'error', text }]);
    expect(text).not.toContain('English');
    expect(text).not.toContain(code);
    expect(log).toHaveBeenCalled();
    expect(t.added).toHaveLength(0);
    expect(t.cutout.view().progress).toBeNull();
    // 模型不見了：按鈕跟著變淡
    expect(t.cutout.view().matteReady).toBe(code !== 'model-missing');
  });

  it('白話對照（aiErrorText）：取消不是錯誤；不認得的錯誤當 AI 失敗', () => {
    expect(aiErrorText(new DOMException('Aborted', 'AbortError'))).toBeNull();
    expect(aiErrorText(new AiError('model-missing', null))).toBe(AI_MODEL_MISSING_TEXT);
    expect(aiErrorText(new TypeError('boom'))).toBe(AI_FAILED_TEXT);
    expect(AI_FAILED_TEXT).toBe('AI 處理時出了問題，圖沒有加進來。可以再試一次，或換一張圖。');
    expect(AI_MODEL_MISSING_TEXT).toContain('下載AI模型.bat');
  });

  it('解碼或編碼失敗（不是 AiError）：一樣說 AI 失敗', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // encode 丟錯
    const t2 = harness();
    const broken = createCutout({ ...t2.deps, encode: async () => { throw new Error('canvas failed'); } });
    void broken.start(source());
    await flush();
    t2.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await broken.idle();
    expect(t2.messages).toEqual([{ kind: 'error', text: AI_FAILED_TEXT }]);
  });
});

describe('層數、圖片數不夠時先說（每面 8 層、每張卡 16 張圖）', () => {
  it('開始前放不下：不跑 AI，直接說', async () => {
    const rooms: string[] = [];
    const t = harness({ room: (_src, kind) => (rooms.push(kind), problemText('face-full')) });
    await t.cutout.start(source());
    expect(rooms).toEqual(['cutout']);
    expect(t.calls).toHaveLength(0);
    expect(t.messages).toEqual([{ kind: 'error', text: problemText('face-full') }]);
    const t2 = harness({ room: () => problemText('too-many-images') });
    await t2.cutout.start(source());
    expect(t2.messages).toEqual([{ kind: 'error', text: problemText('too-many-images') }]);
  });

  it('做的途中又加滿了：做完加不進去也說', async () => {
    const t = harness({ added: { result: 'face-full' } });
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'error', text: problemText('face-full') }]);
  });

  it('cutoutRoom：這一面 8 層 → face-full；這張卡 16 張圖 → too-many-images；放得下 → null', () => {
    let card = newCard('standard', 'c', T0);
    expect(cutoutRoom(card, 'front')).toBeNull();
    for (let i = 0; i < 8; i++) card = add(card, 'front', i);
    expect(cutoutRoom(card, 'front')).toBe('face-full');
    expect(cutoutRoom(card, 'back')).toBeNull();
    for (let i = 8; i < 16; i++) card = add(card, 'back', i);
    // 正面 7 層＋反光層的黑白圖、背面 8 層＝16 張圖：正面還有空位，但圖已經滿了
    const masked: Card = { ...card, front: { layers: card.front.layers.slice(1), foil: { shape: 'mask', mask: hashOf(500), frame: true } } };
    expect(cutoutRoom(masked, 'front')).toBe('too-many-images');
  });
});

function add(card: Card, face: 'front' | 'back', n: number): Card {
  const r = addLayer(card, face, { id: `l${n}`, name: `l${n}`, image: hashOf(n + 1), hasAlpha: true, width: 10, height: 10 });
  if (!r.ok) throw new Error(r.reason);
  return r.card;
}

describe('做完時換了卡：加到開始時那張（存檔裡）；那張被刪了就不加', () => {
  it('組裝端回 stored：說「去背好了，加到「卡名」了」', async () => {
    const t = harness({ added: { result: 'stored', cardName: '龍騎士' } });
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'info', text: aiStoredText('龍騎士') }]);
    expect(aiStoredText('龍騎士')).toBe('去背好了，加到「龍騎士」了。');
  });

  it('組裝端回 missing（那張被刪了）：說一聲，不加', async () => {
    const t = harness({ added: { result: 'missing' } });
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_CARD_GONE_TEXT }]);
  });
});

// ---- 存檔裡的那張（session.addLayerTo）----

const freshStore = () => openCardStore(new IDBFactory());

function sessionHarness(store: CardStore | null) {
  const registry = new Map<string, StoredImage>();
  const state = { current: null as Card | null };
  const session = createSession({
    store,
    images: {
      add: async (img) => void registry.set(img.hash, img),
      get: (h) => registry.get(h),
      retain: () => {},
    },
    current: () => state.current,
    show: (card) => {
      state.current = card;
    },
    thumbnail: async () => null,
    settle: async () => {},
    onStatus: () => {},
    onStorageLow: () => {},
  });
  return { session, state };
}

const cutInput = (id = 'cut-1'): NewLayerInput => ({ id, name: 'hero', image: hashOf(99), hasAlpha: true, width: 40, height: 60 });

describe('session.addLayerTo：加到卡片庫裡的那張（不用打開）', () => {
  it('存檔裡的卡：圖先存、再存卡（新的立體層、updatedAt＝現在）→ added＋卡名', async () => {
    const store = await freshStore();
    const card = { ...newCard('standard', 'a', T0), name: '龍騎士' };
    await store.save(card);
    const { session, state } = sessionHarness(store);
    state.current = newCard('standard', 'b', T0);
    const r = await session.addLayerTo('a', 'back', cutInput(), stored(99, true), T1);
    expect(r).toEqual({ result: 'added', cardName: '龍騎士' });
    const saved = await store.load('a');
    expect(saved?.back.layers).toHaveLength(1);
    expect(saved?.back.layers[0]).toMatchObject({ id: 'cut-1', role: 'depth', image: hashOf(99), hasAlpha: true, depth: 50 });
    expect(saved?.updatedAt).toBe(T1);
    expect(await store.loadImage(hashOf(99))).toBeDefined();
  });

  it('那張被刪了 → missing（不存圖、不存卡）', async () => {
    const store = await freshStore();
    const { session, state } = sessionHarness(store);
    state.current = newCard('standard', 'b', T0);
    expect(await session.addLayerTo('gone', 'front', cutInput(), stored(99, true), T1)).toEqual({ result: 'missing' });
    expect(await store.loadImage(hashOf(99))).toBeUndefined();
  });

  it('那張就是開著的 → is-open（交給編輯器：可以復原）', async () => {
    const store = await freshStore();
    const { session, state } = sessionHarness(store);
    state.current = newCard('standard', 'a', T0);
    expect(await session.addLayerTo('a', 'front', cutInput(), stored(99, true), T1)).toEqual({ result: 'is-open' });
  });

  it('那一面滿了 → face-full、卡不變', async () => {
    const store = await freshStore();
    let card = newCard('standard', 'a', T0);
    for (let i = 0; i < 8; i++) card = add(card, 'front', i);
    for (let i = 0; i < 8; i++) await store.saveImage(stored(i + 1, true));
    await store.save(card);
    const { session, state } = sessionHarness(store);
    state.current = newCard('standard', 'b', T0);
    expect(await session.addLayerTo('a', 'front', cutInput(), stored(99, true), T1)).toEqual({ result: 'face-full' });
    expect((await store.load('a'))?.front.layers).toHaveLength(8);
  });

  it('存檔不能用 → missing', async () => {
    const { session } = sessionHarness(null);
    expect(await session.addLayerTo('a', 'front', cutInput(), stored(99, true), T1)).toEqual({ result: 'missing' });
  });
});

// ---- 開著的那張（編輯器）：加層、選中、記一步 ----

describe('開著的那張：去背好的圖加成立體層、選中、記一步（可以復原）', () => {
  it('addUploadedLayer（hasAlpha）：深度照自動排、名字＝檔名、選中、切到那一面', () => {
    let s: EditorState = createEditor(newCard('standard', 'card-1', T0));
    s = addUploadedLayer(s, 'front', { id: 'bg', name: 'bg', image: hashOf(1), hasAlpha: false, width: 10, height: 14 }, 'bg.jpg', T0).state;
    const before = currentCard(s);
    const r = addUploadedLayer(s, 'front', { ...cutInput(), name: 'hero' }, 'hero.jpg', T1);
    expect(r.problem).toBeNull();
    const layer = currentCard(r.state).front.layers.at(-1)!;
    expect(layer).toMatchObject({ id: 'cut-1', name: 'hero', role: 'depth', depth: 50, hasAlpha: true });
    expect(r.state.selectedLayerId).toBe('cut-1');
    expect(currentCard(undoEdit(r.state))).toEqual(before);
  });
});
