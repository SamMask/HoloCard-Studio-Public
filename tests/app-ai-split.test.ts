// 拆成立體層（T-704，DESIGN §3.1、§4）：上傳確認框按〔拆成立體層〕之後的流程。runner 一律用假的。
// 涵蓋：深度分 3 段、背景段當底圖（已有就取代）、其他段當立體層（建議深度、和底圖對齊、名字「檔名・遠／中／近」）、
// 整件事一步（一次復原全部還原，含被取代的舊底圖）、空間不夠先說、模型不在、沒有圖形加速先問、取消、分不出遠近、
// 換卡加到原卡（存檔裡）、卡被刪不加、和去背共用「一次一件」、錯誤白話。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../src/ai/runner';
import type { DepthBand } from '../src/ai/types';
import { SPLIT_BANDS } from '../src/app/ai-cutout';
import { createSession } from '../src/app/session';
import type { StoredImage } from '../src/images/types';
import { addLayer, type NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import {
  addSplitLayers,
  addUploadedLayer,
  createEditor,
  currentCard,
  redoEdit,
  splitIntoCard,
  splitRoom,
  undoEdit,
  type EditorState,
  type SplitPart,
} from '../src/ui/editor';
import {
  AI_FAILED_TEXT,
  AI_MODEL_MISSING_TEXT,
  AI_NO_DEPTH_GONE_TEXT,
  AI_NO_DEPTH_TEXT,
  AI_SPLIT_CARD_GONE_TEXT,
  aiSplitStoredText,
  splitPartNames,
  splitRoomText,
} from '../src/ui/logic';
import { flush, harness, hashOf, rgba, source, stored } from './ai-fakes';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 假的拆層結果：第 0 段整張不透明（背景），其他段有透明（柔邊遮罩）。深度照 splitByDepth：0、50、100。 */
function bands(count = 3, width = 8, height = 12): DepthBand[] {
  return Array.from({ length: count }, (_, i) => ({
    image: rgba(width, height, i === 0 ? 255 : 128),
    depth: i === 0 ? 0 : Math.round((100 * i) / (count - 1)),
  }));
}

// ---- 流程（app/ai-cutout 的 start(source, 'split')）----

describe('〔拆成立體層〕：深度分 3 段，做完交給組裝端加進卡片', () => {
  it('先看空間（split）→ splitLayers({ bands: 3 })；進度：第一次「正在載入 AI 模型」→「正在拆成立體層…」', async () => {
    const rooms: string[] = [];
    const t = harness({
      room: (_src, kind) => {
        rooms.push(kind);
        return null;
      },
    });
    void t.cutout.start(source(), 'split');
    await flush();
    expect(rooms).toEqual(['split']);
    expect(SPLIT_BANDS).toBe(3);
    expect(t.splits).toHaveLength(1);
    expect(t.splits[0]!.options).toEqual({ bands: 3 });
    expect(t.calls).toHaveLength(0);
    expect(t.cutout.view().progress).toEqual({ step: 'load', fraction: 0, expectSec: 3 });
    t.splits[0]!.progress!('run', 0, 1);
    expect(t.cutout.view().progress).toEqual({ step: 'split', fraction: null, expectSec: 3 });
  });

  it('成功：每一段走 encode（WebP、雜湊）→ addSplit（由遠到近：背景沒有透明、其他段有；深度 0／50／100）', async () => {
    const t = harness();
    t.setEncodeAlpha(null);
    void t.cutout.start(source('card-1', { face: 'back' }), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: bands() });
    await t.cutout.idle();
    expect(t.splitAdded).toHaveLength(1);
    const { source: src, parts } = t.splitAdded[0]!;
    expect(src).toMatchObject({ cardId: 'card-1', face: 'back', name: 'hero' });
    expect(parts.map((p) => [p.image.hash, p.image.hasAlpha, p.depth])).toEqual([
      [hashOf(100), false, 0],
      [hashOf(101), true, 50],
      [hashOf(102), true, 100],
    ]);
    expect(t.cutout.view().progress).toBeNull();
    expect(t.messages).toEqual([]);
  });

  it('去背的模型載入過，拆層的模型第一次還是會說「正在載入 AI 模型」（兩個模型分開）', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    void t.cutout.start(source(), 'split');
    await flush();
    expect(t.cutout.view().progress?.step).toBe('load');
    t.splits[0]!.resolve({ bands: bands() });
    await t.cutout.idle();
    void t.cutout.start(source(), 'split');
    await flush();
    expect(t.cutout.view().progress?.step).toBe('split');
  });

  it('空間不夠：不跑 AI，直接說（文字由組裝端算好）', async () => {
    const text = splitRoomText({ kind: 'layers', space: 2, need: 3 });
    const t = harness({ room: () => text });
    await t.cutout.start(source(), 'split');
    expect(t.splits).toHaveLength(0);
    expect(t.messages).toEqual([{ kind: 'error', text }]);
    expect(text).toBe('這一面只剩 2 層的空間，拆成立體層需要 3 層。');
  });

  it('做的途中又加滿了：做完加不進去也說', async () => {
    const text = splitRoomText({ kind: 'layers', space: 1, need: 3 });
    const t = harness({ addedSplit: { result: 'no-room', text } });
    void t.cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: bands() });
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'error', text }]);
  });
});

describe('拆層：模型、沒有圖形加速、取消、一次一件', () => {
  it('深度模型不在：不開始、說怎麼下載；去背模型不在不影響拆層', async () => {
    const t = harness({ available: { depth: false } });
    await t.cutout.start(source(), 'split');
    expect(t.splits).toHaveLength(0);
    expect(t.messages).toEqual([{ kind: 'error', text: AI_MODEL_MISSING_TEXT }]);
    const t2 = harness({ available: { matte: false } });
    void t2.cutout.start(source(), 'split');
    await flush();
    expect(t2.splits).toHaveLength(1);
  });

  it('沒有圖形加速：先問；〔繼續〕才開始，進度條照 70 秒走', async () => {
    const t = harness({ fast: false });
    await t.cutout.start(source(), 'split');
    expect(t.cutout.view().ask?.kind).toBe('slow');
    expect(t.splits).toHaveLength(0);
    t.cutout.answer(true);
    await flush();
    expect(t.splits).toHaveLength(1);
    expect(t.cutout.view().progress?.expectSec).toBe(70);
  });

  it('取消：面板馬上收起、不加', async () => {
    const t = harness();
    void t.cutout.start(source(), 'split');
    await flush();
    t.cutout.cancel();
    expect(t.cutout.view().progress).toBeNull();
    expect(t.splits[0]!.signal?.aborted).toBe(true);
    await t.cutout.idle();
    expect(t.splitAdded).toHaveLength(0);
    expect(t.messages).toEqual([]);
  });

  it('和去背共用「一次一件」：去背中按拆層不做事；拆層中按去背也不做事', async () => {
    const t = harness();
    void t.cutout.start(source());
    await flush();
    await t.cutout.start(source(), 'split');
    expect(t.splits).toHaveLength(0);
    expect(t.cutout.view().busy).toBe(true);
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await t.cutout.idle();
    void t.cutout.start(source(), 'split');
    await flush();
    await t.cutout.start(source());
    expect(t.calls).toHaveLength(1);
    expect(t.splits).toHaveLength(1);
  });
});

describe('分不出遠近（只拆出 1 段，或其他段沒有透明）', () => {
  it('開著那張卡：問〔當底圖〕〔取消〕；〔當底圖〕交給組裝端', async () => {
    const t = harness();
    void t.cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: bands(1) });
    await t.cutout.idle();
    expect(t.splitAdded).toHaveLength(0);
    expect(t.cutout.view().ask).toEqual({ kind: 'no-depth', fileName: 'hero.jpg' });
    t.cutout.answer(true);
    expect(t.bases.map((b) => b.fileName)).toEqual(['hero.jpg']);
  });

  it('前面的段整張沒有透明：一樣當作分不出遠近', async () => {
    const t = harness();
    t.setEncodeAlpha(false);
    void t.cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: bands() });
    await t.cutout.idle();
    expect(t.splitAdded).toHaveLength(0);
    expect(t.cutout.view().ask?.kind).toBe('no-depth');
  });

  it('已經換卡：只說一聲', async () => {
    const t = harness();
    void t.cutout.start(source('card-1'), 'split');
    await flush();
    t.state.open = 'card-2';
    t.splits[0]!.resolve({ bands: bands(1) });
    await t.cutout.idle();
    expect(t.cutout.view().ask).toBeNull();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_NO_DEPTH_GONE_TEXT }]);
    expect(AI_NO_DEPTH_TEXT).toBe('這張圖分不出遠近，拆不成立體層。換一張試試，或當底圖用。');
  });
});

describe('做完時換了卡、卡被刪、錯誤', () => {
  it('存進卡片庫裡的那張：「拆好了，加到「卡名」了。」', async () => {
    const t = harness({ addedSplit: { result: 'stored', cardName: '龍騎士' } });
    void t.cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: bands() });
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'info', text: aiSplitStoredText('龍騎士') }]);
    expect(aiSplitStoredText('龍騎士')).toBe('拆好了，加到「龍騎士」了。');
  });

  it('那張被刪了：說一聲，不加', async () => {
    const t = harness({ addedSplit: { result: 'missing' } });
    void t.cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: bands() });
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'info', text: AI_SPLIT_CARD_GONE_TEXT }]);
  });

  it.each([
    ['model-missing', AI_MODEL_MISSING_TEXT],
    ['load-failed', AI_FAILED_TEXT],
    ['run-failed', AI_FAILED_TEXT],
    ['bad-output', AI_FAILED_TEXT],
  ] as const)('%s：白話、英文只進 console', async (code, text) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = harness();
    await t.cutout.checkModels();
    void t.cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.reject(new AiError(code, new Error('Some English reason')));
    await t.cutout.idle();
    expect(t.messages).toEqual([{ kind: 'error', text }]);
    expect(log).toHaveBeenCalled();
    expect(t.cutout.view().depthReady).toBe(code !== 'model-missing');
    expect(t.cutout.view().matteReady).toBe(true);
  });
});

// ---- 編輯器：一次加進卡片（整件事一步）----

const T2 = '2026-10-14T02:00:00.000Z';

function input(id: string, hasAlpha: boolean, n = 1): NewLayerInput {
  return { id, name: id, image: hashOf(n), hasAlpha, width: 1000, height: 1400 };
}

function parts(names = splitPartNames(3).map((s) => `pic・${s}`)): SplitPart[] {
  return names.map((name, i) => ({
    id: `part-${i}`,
    name,
    image: hashOf(500 + i),
    hasAlpha: i > 0,
    width: 1000,
    height: 1400,
    depth: i === 0 ? 0 : Math.round((100 * i) / (names.length - 1)),
  }));
}

/** 正面：底圖 bg、立體層 hero（深度 50）。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false, 1), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true, 2), 'hero.png', T0).state;
  return s;
}

describe('名字與空間', () => {
  it('段名：3 段＝遠／中／近；2 段＝遠／近；4 段＝遠／中遠／中近／近；1 段＝遠', () => {
    expect(splitPartNames(3)).toEqual(['遠', '中', '近']);
    expect(splitPartNames(2)).toEqual(['遠', '近']);
    expect(splitPartNames(4)).toEqual(['遠', '中遠', '中近', '近']);
    expect(splitPartNames(1)).toEqual(['遠']);
  });

  it('層數：底圖那一格算空間（會被取代），其他層各佔一格', () => {
    let s = setup();
    expect(splitRoom(currentCard(s), 'front', 3)).toBeNull();
    for (let i = 0; i < 5; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true, 10 + i), `${i}.png`, T0).state;
    // 底圖＋6 個立體層：只剩 2 格
    expect(splitRoom(currentCard(s), 'front', 3)).toEqual({ kind: 'layers', space: 2, need: 3 });
    expect(splitRoomText({ kind: 'layers', space: 2, need: 3 })).toBe('這一面只剩 2 層的空間，拆成立體層需要 3 層。');
    expect(splitRoom(currentCard(s), 'front', 2)).toBeNull();
  });

  it('沒有底圖：8 格都算空間', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    for (let i = 0; i < 6; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true, 10 + i), `${i}.png`, T0).state;
    expect(splitRoom(currentCard(s), 'front', 3)).toEqual({ kind: 'layers', space: 2, need: 3 });
  });

  it('圖片數：每張卡 16 張（舊底圖的圖會被換掉，不算）', () => {
    let card = currentCard(setup());
    for (let i = 0; i < 8; i++) card = add(card, 'back', 20 + i);
    for (let i = 0; i < 4; i++) card = add(card, 'front', 40 + i);
    // 正面 bg＋hero＋4 層（層數空間 3）；兩面共 14 張圖，不算會被換掉的舊底圖＝13 張 → 剛好還有 3 張空間
    // 再加一張反光層黑白圖 → 只剩 2 張空間
    expect(splitRoom(card, 'front', 3)).toBeNull();
    const masked: Card = { ...card, front: { ...card.front, foil: { shape: 'mask', mask: hashOf(900), frame: true } } };
    expect(splitRoom(masked, 'front', 3)).toEqual({ kind: 'images', space: 2, need: 3 });
    expect(splitRoomText({ kind: 'images', space: 2, need: 3 })).toBe('這張卡只剩 2 張圖的空間，拆成立體層需要 3 張。');
  });
});

function add(card: Card, face: 'front' | 'back', n: number): Card {
  const r = addLayer(card, face, { id: `x${n}`, name: `x${n}`, image: hashOf(n), hasAlpha: true, width: 10, height: 10 });
  if (!r.ok) throw new Error(r.reason);
  return r.card;
}

describe('addSplitLayers：背景段當底圖、其他段當立體層；整件事一步', () => {
  it('已有底圖：取代；其他段深度用建議值、位置大小和新底圖一樣（才會對齊）；名字照段名；切到那一面、不選中', () => {
    const s0 = setup();
    const r = addSplitLayers(s0, 'front', parts(), T1);
    expect(r.problem).toBeNull();
    const layers = currentCard(r.state).front.layers;
    const base = layers.find((l) => l.role === 'base')!;
    expect(base).toMatchObject({ id: 'part-0', name: 'pic・遠', image: hashOf(500), depth: 0 });
    expect(layers.some((l) => l.id === 'bg')).toBe(false);
    const mid = layers.find((l) => l.id === 'part-1')!;
    const near = layers.find((l) => l.id === 'part-2')!;
    expect(mid).toMatchObject({ name: 'pic・中', role: 'depth', depth: 50, hasAlpha: true, x: base.x, y: base.y, scale: base.scale });
    expect(near).toMatchObject({ name: 'pic・近', role: 'depth', depth: 100, hasAlpha: true, x: base.x, y: base.y, scale: base.scale });
    // 原本的 hero 還在；陣列照深度由後到前
    expect(layers.map((l) => l.id)).toEqual(['part-0', 'hero', 'part-1', 'part-2']);
    expect(r.state.face).toBe('front');
    expect(r.state.selectedLayerId).toBeNull();
    expect(currentCard(r.state).updatedAt).toBe(T1);
  });

  it('一次復原全部還原（含被取代的舊底圖），重做全部回來', () => {
    const s0 = setup();
    const s1 = addSplitLayers(s0, 'front', parts(), T1).state;
    const undone = undoEdit(s1);
    expect(currentCard(undone)).toEqual(currentCard(s0));
    expect(currentCard(redoEdit(undone)).front.layers.map((l) => l.id)).toEqual(['part-0', 'hero', 'part-1', 'part-2']);
  });

  it('沒有底圖：背景段加成底圖（第 0 個）；切到背面', () => {
    const s0 = createEditor(newCard('standard', 'c', T0));
    const r = addSplitLayers(s0, 'back', parts(), T1);
    expect(currentCard(r.state).back.layers.map((l) => [l.id, l.role])).toEqual([
      ['part-0', 'base'],
      ['part-1', 'depth'],
      ['part-2', 'depth'],
    ]);
    expect(r.state.face).toBe('back');
  });

  it('只有 2 段：遠＝底圖、近＝深度 100', () => {
    const r = addSplitLayers(setup(), 'front', parts(splitPartNames(2).map((s) => `pic・${s}`)), T1);
    const layers = currentCard(r.state).front.layers;
    expect(layers.find((l) => l.id === 'part-1')).toMatchObject({ name: 'pic・近', depth: 100 });
  });

  it('放不下：problem、卡不變', () => {
    let s = setup();
    for (let i = 0; i < 5; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true, 10 + i), `${i}.png`, T0).state;
    const r = addSplitLayers(s, 'front', parts(), T1);
    expect(r.problem).toEqual({ kind: 'layers', space: 2, need: 3 });
    expect(currentCard(r.state)).toBe(currentCard(s));
  });

  it('splitIntoCard（存檔裡的卡也用這個）：成功回新卡、不碰 updatedAt；放不下回 problem', () => {
    const card = currentCard(setup());
    const ok = splitIntoCard(card, 'front', parts());
    expect('card' in ok && ok.card.front.layers.length).toBe(4);
    expect('card' in ok && ok.card.updatedAt).toBe(card.updatedAt);
    let full = card;
    for (let i = 0; i < 6; i++) full = add(full, 'front', 60 + i);
    expect(splitIntoCard(full, 'front', parts())).toEqual({ problem: { kind: 'layers', space: 1, need: 3 } });
  });
});

// ---- 存檔裡的那張（session.editStored）----

function sessionHarness(store: Awaited<ReturnType<typeof openCardStore>> | null) {
  const state = { current: null as Card | null };
  const registry = new Map<string, StoredImage>();
  const session = createSession({
    store,
    images: { add: async (img) => void registry.set(img.hash, img), get: (h) => registry.get(h), retain: () => {} },
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

describe('session.editStored：改卡片庫裡的那張（不用打開）', () => {
  it('成功：圖先存、再存卡（updatedAt＝現在）→ saved＋卡名', async () => {
    const store = await openCardStore(new IDBFactory());
    await store.saveImage(stored(1, false));
    let card = { ...newCard('standard', 'a', T0), name: '星晶龍' };
    const r0 = addLayer(card, 'front', input('bg', false, 1));
    if (!r0.ok) throw new Error(r0.reason);
    card = r0.card;
    await store.save(card);
    const { session, state } = sessionHarness(store);
    state.current = newCard('standard', 'b', T0);
    const images = parts().map((p) => stored(parseInt(p.image, 16), p.hasAlpha));
    const r = await session.editStored('a', images, (c) => splitIntoCard(c, 'front', parts()), T2);
    expect(r).toEqual({ result: 'saved', cardName: '星晶龍' });
    const saved = await store.load('a');
    expect(saved?.front.layers.map((l) => l.id)).toEqual(['part-0', 'part-1', 'part-2']);
    expect(saved?.updatedAt).toBe(T2);
  });

  it('被刪了 → missing；開著的 → is-open；放不下 → problem（不存）', async () => {
    const store = await openCardStore(new IDBFactory());
    const { session, state } = sessionHarness(store);
    state.current = newCard('standard', 'open', T0);
    const edit = (c: Card) => splitIntoCard(c, 'front', parts());
    expect(await session.editStored('gone', [], edit, T2)).toEqual({ result: 'missing' });
    expect(await session.editStored('open', [], edit, T2)).toEqual({ result: 'is-open' });
    await store.save(newCard('standard', 'c', T0));
    const r = await session.editStored('c', [stored(77, true)], () => ({ problem: { kind: 'layers', space: 0, need: 3 } }), T2);
    expect(r).toEqual({ result: 'problem', problem: { kind: 'layers', space: 0, need: 3 } });
    expect(await store.loadImage(hashOf(77))).toBeUndefined();
    expect((await store.load('c'))?.updatedAt).toBe(T0);
  });
});
