// T-703c（Codex 交叉審查 6565e1a 的 2 個高）：
// ① 交出編輯權要完整停止 AI 流程：檢查模型／後端途中、解碼途中接手 → 之後回來的結果全部作廢；
//    已經進入「加進卡片」（不能取消）的工作 → 交接要等它做完（settled）。
// ② 重新開回原卡時，結果圖不能先被換卡的回收收走：加入期間 hold 住、退回路徑重新確保登記簿有圖、加完才放開。
//    這裡用真的圖片登記簿（retain／hold 的回收行為）與真的 session（fake-indexeddb），不是 retain: () => {}。
// T-704 的多段結果走同一條 addAiResult（多張圖一起 hold）。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../src/ai/types';
import { createCutout, type CutoutDeps } from '../src/app/ai-cutout';
import { addAiResult, editorImages } from '../src/app/ai-results';
import { createSession } from '../src/app/session';
import { createImageRegistry } from '../src/images/registry';
import type { StoredImage } from '../src/images/types';
import { addLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { addSplitLayers, addUploadedLayer, createEditor, currentCard, type EditorState, type SplitPart } from '../src/ui/editor';
import { flush, harness, hashOf, rgba, source, stored } from './ai-fakes';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- ① 交接時停止 ----

describe('交出編輯權（stop）：之前在等的非同步結果全部作廢', () => {
  it('檢查模型途中接手：查完也不開始、不問', async () => {
    const t = harness({ fast: false });
    const gate = deferred<boolean>();
    const cutout = createCutout({ ...t.deps, runner: { ...t.runner, available: () => gate.promise } });
    const started = cutout.start(source(), 'split');
    await flush();
    expect(cutout.view().busy).toBe(true);
    cutout.stop();
    gate.resolve(true);
    await started;
    expect(t.splits).toHaveLength(0);
    expect(cutout.view().ask).toBeNull();
    expect(cutout.view().busy).toBe(false);
    expect(t.messages).toEqual([]);
  });

  it('檢查有沒有圖形加速途中接手：查完也不開始', async () => {
    const t = harness();
    const gate = deferred<boolean>();
    const cutout = createCutout({ ...t.deps, runner: { ...t.runner, hasFastBackend: () => gate.promise } });
    const started = cutout.start(source());
    await flush();
    cutout.stop();
    gate.resolve(true);
    await started;
    await cutout.idle();
    expect(t.calls).toHaveLength(0);
    expect(cutout.view().progress).toBeNull();
  });

  it('原圖解碼途中接手：解完也不送去推論', async () => {
    const t = harness();
    const gate = deferred<RgbaImage>();
    const cutout = createCutout({ ...t.deps, decode: () => gate.promise });
    void cutout.start(source());
    await flush();
    expect(cutout.view().progress).not.toBeNull();
    cutout.stop();
    expect(cutout.view().progress).toBeNull();
    gate.resolve(rgba(4, 4, 255));
    await cutout.idle();
    expect(t.calls).toHaveLength(0);
    expect(t.added).toHaveLength(0);
  });

  it('拆層的每一段編碼途中接手：不加', async () => {
    const t = harness();
    const gate = deferred<StoredImage>();
    let encodes = 0;
    const cutout = createCutout({ ...t.deps, encode: (img) => (++encodes === 2 ? gate.promise : t.deps.encode(img)) });
    void cutout.start(source(), 'split');
    await flush();
    t.splits[0]!.resolve({ bands: [0, 50, 100].map((depth, i) => ({ image: rgba(4, 4, i ? 128 : 255), depth })) });
    await flush();
    cutout.stop();
    gate.resolve(stored(7, true));
    await cutout.idle();
    expect(t.splitAdded).toHaveLength(0);
  });

  it('已經在加進卡片（例如等登記簿解碼）：取消不了，settled 等它做完才好（交接要等它）', async () => {
    const t = harness();
    const gate = deferred<{ result: 'added' }>();
    const cutout = createCutout({ ...t.deps, add: () => gate.promise });
    void cutout.start(source());
    await flush();
    t.calls[0]!.resolve({ image: rgba(4, 4), coverage: 0.5 });
    await flush();
    cutout.stop();
    let settled = false;
    void cutout.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    gate.resolve({ result: 'added' });
    await flush();
    expect(settled).toBe(true);
  });

  it('沒有在加：settled 馬上好', async () => {
    const t = harness();
    await expect(t.cutout.settled()).resolves.toBeUndefined();
  });
});

// ---- ② 加回原卡時圖不能被回收 ----

/** 讓真的登記簿能在 node 跑：假的 <img>（decode 馬上好）與 object URL。 */
function stubBrowserImages() {
  let n = 0;
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
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

beforeEach(() => {
  stubBrowserImages();
});

/** 組裝端的縮小版：真的登記簿、真的 session、編輯器、上傳隊伍。 */
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
  return { registry, store, session, queue, isOpen, editor: () => editor, setEditor: (e: EditorState) => (editor = e) };
}

/** addAiResult 的組裝端（在用的圖＝開著的編輯器用到的）。 */
function aiDeps(a: Awaited<ReturnType<typeof app>>) {
  return { registry: a.registry, isOpen: a.isOpen, queue: a.queue, inUse: () => (a.editor() ? editorImages(a.editor()!) : new Set<string>()) };
}

async function seedCard(store: Awaited<ReturnType<typeof openCardStore>>, id: string, imageN: number): Promise<{ card: Card; image: StoredImage }> {
  const image = stored(imageN, false);
  const r = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-bg`, name: 'bg', image: image.hash, hasAlpha: false, width: 40, height: 60 });
  if (!r.ok) throw new Error(r.reason);
  await store.saveImage(image);
  await store.save(r.card);
  return { card: r.card, image };
}

describe('addAiResult：開著原卡＝排進上傳隊伍加；換卡＝存檔；又被打開＝重新確保圖在登記簿再加', () => {
  it('Codex 的情境：去背原卡 A、開著 B；佇列裡的 open(A) 先完成（retain 收圖）→ is-open → 退回路徑一樣有圖', async () => {
    const a = await app();
    const { card: cardA } = await seedCard(a.store, 'A', 1);
    await seedCard(a.store, 'B', 2);
    await a.session.openStart((await a.store.load('B'))!);
    expect(a.isOpen('B')).toBe(true);
    const cut = stored(50, true);
    // 結果圖曾經進過登記簿（例如上一次嘗試）：沒有 hold 的話，open(A) 的 retain 會把它收掉
    await a.registry.add(cut);
    const input = { id: 'cut-layer', name: 'hero', image: cut.hash, hasAlpha: true, width: 40, height: 60 };
    // open(A) 先排進 session 的隊伍；addAiResult 第一次看「開著的不是 A」→ 走存檔 → 排在 open(A) 後面 → is-open
    const opening = a.session.open('A');
    const result = await addAiResult(
      aiDeps(a),
      'A',
      [cut],
      () => {
        const r = addUploadedLayer(a.editor()!, 'front', input, 'hero.jpg', T1);
        a.setEditor(r.state);
        return r.problem ? { result: r.problem } : { result: 'added' };
      },
      async () => {
        const r = await a.session.addLayerTo('A', 'front', input, cut, T1);
        if (r.result === 'is-open') return 'is-open';
        return r.result === 'added' ? { result: 'stored', cardName: r.cardName } : { result: 'missing' };
      },
    );
    expect(await opening).toBe('opened');
    expect(result).toEqual({ result: 'added' });
    expect(currentCard(a.editor()!).id).toBe(cardA.id);
    expect(currentCard(a.editor()!).front.layers.map((l) => l.image)).toContain(cut.hash);
    expect(a.registry.has(cut.hash)).toBe(true);
    // 放開之後，卡片在用的圖照樣留著（換卡的 retain 留下它）
    a.registry.retain(new Set(currentCard(a.editor()!).front.layers.map((l) => l.image)));
    expect(a.registry.has(cut.hash)).toBe(true);
  });

  it('開著原卡：排進上傳隊伍（換卡前 settle 會等它），圖進登記簿、記一步', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const cut = stored(51, true);
    let queued = 0;
    const result = await addAiResult(
      { ...aiDeps(a), queue: (task) => (queued++, a.queue(task)) },
      'A',
      [cut],
      () => {
        const r = addUploadedLayer(a.editor()!, 'front', { id: 'c', name: 'c', image: cut.hash, hasAlpha: true, width: 4, height: 4 }, 'c.jpg', T1);
        a.setEditor(r.state);
        return { result: 'added' };
      },
      async () => {
        throw new Error('開著的卡不該走存檔');
      },
    );
    expect(result).toEqual({ result: 'added' });
    expect(queued).toBe(1);
    expect(a.registry.has(cut.hash)).toBe(true);
  });

  it('加入期間換卡的回收（retain）不收結果圖；加完放開後，沒有卡在用的才收', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const parts = [stored(60, false), stored(61, true), stored(62, true)];
    for (const p of parts) await a.registry.add(p);
    // 上傳隊伍前面先塞一個卡住的工作：加入工作排在它後面，這段時間裡發生一次「換卡的回收」
    const gate = deferred();
    void a.queue(() => gate.promise);
    const result = addAiResult(
      aiDeps(a),
      'A',
      parts,
      () => {
        const split: SplitPart[] = parts.map((p, i) => ({ id: `p${i}`, name: `p${i}`, image: p.hash, hasAlpha: p.hasAlpha, width: 4, height: 4, depth: i * 50 }));
        const r = addSplitLayers(a.editor()!, 'front', split, T1);
        a.setEditor(r.state);
        return { result: 'added' };
      },
      async () => ({ result: 'missing' }),
    );
    await flush();
    a.registry.retain(new Set([hashOf(1)]));
    // hold 住：回收先不收
    for (const p of parts) expect(a.registry.has(p.hash)).toBe(true);
    gate.resolve();
    expect(await result).toEqual({ result: 'added' });
    for (const p of parts) expect(a.registry.has(p.hash)).toBe(true);
    // 放開之後：換到別的卡（retain 不含這些）就照常收
    a.registry.retain(new Set([hashOf(1)]));
    for (const p of parts) expect(a.registry.has(p.hash)).toBe(false);
  });

  it('換卡了：走存檔（不碰編輯器）；圖不留在登記簿佔記憶體', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await seedCard(a.store, 'B', 2);
    await a.session.openStart((await a.store.load('B'))!);
    const cut = stored(70, true);
    const result = await addAiResult(
      aiDeps(a),
      'A',
      [cut],
      () => {
        throw new Error('A 沒開著，不該改編輯器');
      },
      async () => {
        const r = await a.session.addLayerTo('A', 'front', { id: 'c', name: 'c', image: cut.hash, hasAlpha: true, width: 4, height: 4 }, cut, T1);
        return r.result === 'added' ? { result: 'stored', cardName: r.cardName } : 'is-open';
      },
    );
    expect(result).toEqual({ result: 'stored', cardName: '未命名卡片' });
    expect(a.registry.has(cut.hash)).toBe(false);
    expect((await a.store.load('A'))?.front.layers.map((l) => l.image)).toContain(cut.hash);
  });
});
