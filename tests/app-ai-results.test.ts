// T-704c（Codex 交叉審查 2db6f07：2 中 1 低）：
// ① 連續換卡不能丟掉結果、不能誤報「卡已刪除」：再次換走就重新走存檔判定，只有 session 確認那張卡不在才回 missing。
// ② 加入失敗（放不下、解碼失敗、存到存檔裡）後，這次沒用上的結果圖立即回收；目前的卡、復原歷史、其他 hold 在用的不收。
// ③ 長檔名不能吃掉段名：先替「・遠」留字數，再截檔名。
// 用真的圖片登記簿（retain／hold／discard）與真的 session（fake-indexeddb）。
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CutoutAdded } from '../src/app/ai-cutout';
import { addAiResult, editorImages } from '../src/app/ai-results';
import { createSession } from '../src/app/session';
import { createImageRegistry } from '../src/images/registry';
import type { StoredImage } from '../src/images/types';
import { addLayer } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { NAME_MAX } from '../src/model/limits';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import { addUploadedLayer, createEditor, currentCard, undoEdit, type EditorState } from '../src/ui/editor';
import { splitLayerName, splitPartNames } from '../src/ui/logic';
import { hashOf, stored } from './ai-fakes';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

/** 解碼會失敗的圖（Blob）。 */
const failing = new Set<Blob>();

beforeEach(() => {
  failing.clear();
  const failUrls = new Set<string>();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:fake/${n++}`;
    if (failing.has(blob as Blob)) failUrls.add(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 4;
      naturalHeight = 4;
      decode() {
        return failUrls.has(this.src) ? Promise.reject(new Error('decode failed')) : Promise.resolve();
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 組裝端的縮小版：真的登記簿、真的 session、編輯器、上傳隊伍、「在用的圖」。 */
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

async function seedCard(store: Awaited<ReturnType<typeof openCardStore>>, id: string, imageN: number): Promise<Card> {
  const image = stored(imageN, false);
  const r = addLayer(newCard('standard', id, T0), 'front', { id: `${id}-bg`, name: 'bg', image: image.hash, hasAlpha: false, width: 40, height: 60 });
  if (!r.ok) throw new Error(r.reason);
  await store.saveImage(image);
  await store.save(r.card);
  return r.card;
}

const layerInput = (image: StoredImage, id = 'cut') => ({ id, name: 'hero', image: image.hash, hasAlpha: true, width: 4, height: 4 });

// ---- ① 連續換卡 ----

describe('連續換卡：結果不丟、不誤報刪除', () => {
  it('重開 A（存檔路徑回 is-open）後又開 B、結果圖延遲解碼：重新走存檔判定 → 存進 A（stored），不是 missing', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await seedCard(a.store, 'B', 2);
    await a.session.openStart((await a.store.load('B'))!);
    const cut = stored(50, true);
    let storedCalls = 0;
    const opening = a.session.open('A');
    const result = await addAiResult(
      a.deps,
      'A',
      [cut],
      () => {
        const r = addUploadedLayer(a.editor(), 'front', layerInput(cut), 'hero.jpg', T1);
        a.setEditor(r.state);
        return { result: 'added' };
      },
      async () => {
        storedCalls++;
        const r = await a.session.addLayerTo('A', 'front', layerInput(cut, `cut-${storedCalls}`), cut, T1);
        if (r.result === 'is-open') {
          // 第一次：佇列裡的 open(A) 先完成 → is-open；回去加之前，使用者又開了 B（結果圖還在解碼）
          expect(await a.session.open('B')).toBe('opened');
          return 'is-open';
        }
        return r.result === 'added' ? { result: 'stored', cardName: r.cardName } : { result: r.result };
      },
    );
    expect(await opening).toBe('opened');
    expect(storedCalls).toBe(2);
    expect(result).toEqual({ result: 'stored', cardName: '未命名卡片' });
    expect((await a.store.load('A'))?.front.layers.map((l) => l.image)).toEqual([hashOf(1), cut.hash]);
    expect(currentCard(a.editor()).id).toBe('B');
  });

  it('那張真的被刪了：session 說 missing 才回 missing', async () => {
    const a = await app();
    await seedCard(a.store, 'B', 2);
    await a.session.openStart((await a.store.load('B'))!);
    const cut = stored(51, true);
    const result = await addAiResult(
      a.deps,
      'gone',
      [cut],
      () => ({ result: 'added' }),
      async () => {
        const r = await a.session.addLayerTo('gone', 'front', layerInput(cut), cut, T1);
        return r.result === 'is-open' ? 'is-open' : r.result === 'added' ? { result: 'stored', cardName: r.cardName } : { result: r.result };
      },
    );
    expect(result).toEqual({ result: 'missing' });
  });
});

// ---- ② 沒用上的結果圖立即回收 ----

describe('加入失敗：這次沒用上的結果圖立即回收', () => {
  it('拆層三張、第二次空間檢查失敗（開著的卡）：三張都收掉', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const parts = [stored(60, false), stored(61, true), stored(62, true)];
    const noRoom: CutoutAdded = { result: 'no-room', text: '這一面只剩 0 層的空間，拆成立體層需要 3 層。' };
    const result = await addAiResult(a.deps, 'A', parts, () => noRoom, async () => ({ result: 'missing' }));
    expect(result).toEqual(noRoom);
    for (const p of parts) expect(a.registry.has(p.hash)).toBe(false);
    // 卡片本來的圖照樣在
    expect(a.registry.has(hashOf(1))).toBe(true);
  });

  it('其中一張解碼失敗：已經進登記簿的那幾張也收掉，錯誤照樣丟給呼叫端', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const parts = [stored(63, false), stored(64, true), stored(65, true)];
    failing.add(parts[1]!.blob);
    await expect(addAiResult(a.deps, 'A', parts, () => ({ result: 'added' }), async () => ({ result: 'missing' }))).rejects.toThrow('decode failed');
    for (const p of parts) expect(a.registry.has(p.hash)).toBe(false);
  });

  it('存進存檔裡的那張（換卡了）：開著的卡沒在用，不留在登記簿', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await seedCard(a.store, 'B', 2);
    await a.session.openStart((await a.store.load('A'))!);
    const cut = stored(66, true);
    // 第一次在開著的 A 上：圖進了登記簿，但加之前換到 B
    const result = await addAiResult(
      { ...a.deps, isOpen: (() => { let first = true; return (id: string) => (first ? ((first = false), a.deps.isOpen(id)) : false); })() },
      'A',
      [cut],
      () => ({ result: 'added' }),
      async () => ({ result: 'stored', cardName: 'A' }),
    );
    expect(result).toEqual({ result: 'stored', cardName: 'A' });
    expect(a.registry.has(cut.hash)).toBe(false);
  });

  it('保護：目前的卡、復原歷史在用的圖不收（再去背一次得到同一張圖、這次放不下）', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const cut = stored(67, true);
    // 第一次成功加進卡（之後復原掉：只在「重做」裡）
    await addAiResult(a.deps, 'A', [cut], () => {
      const r = addUploadedLayer(a.editor(), 'front', layerInput(cut), 'hero.jpg', T1);
      a.setEditor(r.state);
      return { result: 'added' };
    }, async () => ({ result: 'missing' }));
    a.setEditor(undoEdit(a.editor()));
    expect(currentCard(a.editor()).front.layers.map((l) => l.image)).not.toContain(cut.hash);
    // 第二次同一張圖、放不下：重做還要用它，不能收
    await addAiResult(a.deps, 'A', [cut], () => ({ result: 'face-full' }), async () => ({ result: 'missing' }));
    expect(a.registry.has(cut.hash)).toBe(true);
  });

  it('保護：別人 hold 著（例如匯出中）的先不收，放開時才收', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const cut = stored(68, true);
    const releaseExport = a.registry.hold([cut.hash]);
    await addAiResult(a.deps, 'A', [cut], () => ({ result: 'face-full' }), async () => ({ result: 'missing' }));
    expect(a.registry.has(cut.hash)).toBe(true);
    releaseExport();
    expect(a.registry.has(cut.hash)).toBe(false);
  });

  it('成功加進開著的卡：照樣留著', async () => {
    const a = await app();
    await seedCard(a.store, 'A', 1);
    await a.session.openStart((await a.store.load('A'))!);
    const cut = stored(69, true);
    await addAiResult(a.deps, 'A', [cut], () => {
      const r = addUploadedLayer(a.editor(), 'front', layerInput(cut), 'hero.jpg', T1);
      a.setEditor(r.state);
      return { result: 'added' };
    }, async () => ({ result: 'missing' }));
    expect(a.registry.has(cut.hash)).toBe(true);
  });
});

describe('editorImages：目前的卡＋復原／重做歷史＋拖曳前的卡＋待確認的上傳圖', () => {
  it('都算在用', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    s = addUploadedLayer(s, 'front', { id: 'a', name: 'a', image: hashOf(1), hasAlpha: true, width: 4, height: 4 }, 'a.png', T0).state;
    s = addUploadedLayer(s, 'front', { id: 'b', name: 'b', image: hashOf(2), hasAlpha: true, width: 4, height: 4 }, 'b.png', T0).state;
    s = undoEdit(s);
    s = { ...s, pending: { face: 'front', input: { id: 'p', name: 'p', image: hashOf(3), hasAlpha: false, width: 4, height: 4 }, fileName: 'p.jpg' } };
    expect([...editorImages(s)].sort()).toEqual([hashOf(1), hashOf(2), hashOf(3)]);
  });
});

// ---- ③ 長檔名 ----

describe('段名不會被長檔名吃掉', () => {
  it(`檔名 ${NAME_MAX} 字：先替「・遠」留字數，三層名字不一樣、都不超過 ${NAME_MAX} 字`, () => {
    const long = '龍'.repeat(NAME_MAX);
    const names = splitPartNames(3).map((p) => splitLayerName(long, p));
    expect(new Set(names).size).toBe(3);
    for (const [i, name] of names.entries()) {
      expect(Array.from(name)).toHaveLength(NAME_MAX);
      expect(name.endsWith(`・${splitPartNames(3)[i]}`)).toBe(true);
    }
    // 4 段的「中遠」「中近」也一樣
    const four = splitPartNames(4).map((p) => splitLayerName(long, p));
    expect(new Set(four).size).toBe(4);
    expect(four.every((n) => Array.from(n).length <= NAME_MAX)).toBe(true);
  });

  it('短檔名照舊；emoji 等以字元計', () => {
    expect(splitLayerName('hero', '近')).toBe('hero・近');
    const emoji = '🐉'.repeat(NAME_MAX);
    expect(Array.from(splitLayerName(emoji, '遠'))).toHaveLength(NAME_MAX);
  });
});
