// 預覽區鍵盤移動圖層 × 真的編輯器狀態（T-607c，T-607 交叉審查的高等問題）：
// 停手 0.6 秒才記的那一步，延遲記步前要核對身分（同一張卡、同一層、preview 還是這次鍵盤開的），
// 不能蓋掉之後的復原、滑鼠拖曳、換卡；鍵盤回正／翻面（Home／F）一定取消選中。
// 接線照 main：按鍵改的是 ui/editor.ts 的狀態，身分＝復原堆疊物件本身（editor.history）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPreviewKeys } from '../src/interact/keys';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import * as ed from '../src/ui/editor';
import { FakeEvent, installFakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T00:00:01.000Z';

const input = (id: string): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha: true, width: 1000, height: 1000 });

/** 正面兩層（hero、cloud），選著 hero。 */
function editorWithLayers(): ed.EditorState {
  let s = ed.createEditor(newCard('standard', 'card-1', T0));
  s = ed.addUploadedLayer(s, 'front', input('cloud'), 'cloud.png', T0).state;
  s = ed.addUploadedLayer(s, 'front', input('hero'), 'hero.png', T0).state;
  return ed.selectLayer(s, 'hero');
}

const layerOf = (s: ed.EditorState, id: string) => ed.currentCard(s).front.layers.find((l) => l.id === id)!;

function wire(initial: ed.EditorState = editorWithLayers()) {
  const dom = installFakeDom();
  const host = dom.document.createElement('div');
  let editor = initial;
  const faceCalls: { kind: 'home' | 'flip'; pending: boolean }[] = [];
  const selected = () => {
    if (editor.foilSelected || editor.selectedLayerId === null) return null;
    const id = editor.selectedLayerId;
    return ed.currentCard(editor)[editor.face].layers.find((l) => l.id === id) ?? null;
  };
  const keys = attachPreviewKeys(host as unknown as HTMLElement, {
    context: () => ({ layerSelected: selected() !== null }),
    turn: () => {},
    zoom: () => {},
    // 記下按 Home／F 時還有沒有沒記的鍵盤步驟（應該已經先記起來了）
    home: () => faceCalls.push({ kind: 'home', pending: editor.history.previewBase !== null }),
    flip: () => faceCalls.push({ kind: 'flip', pending: editor.history.previewBase !== null }),
    selected: () => {
      const l = selected();
      return l && { id: l.id, x: l.x, y: l.y, scale: l.scale };
    },
    editLayer: (id, patch, phase) => (editor = ed.editLayer(editor, id, patch, phase, T1)),
    editToken: () => editor.history,
  });
  const press = (key: string) => (host as unknown as FakeElement).dispatchEvent(new FakeEvent('keydown', { key }));
  return {
    keys,
    press,
    faceCalls,
    get: () => editor,
    set: (next: ed.EditorState) => (editor = next),
    x: (id = 'hero') => layerOf(editor, id).x,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('延遲記步核對身分：不是這次鍵盤開的 preview 就不記', () => {
  it('審查的重現：→ 之後 0.6 秒內復原、馬上拖同一層並按住：舊的計時器到期不會把位置改回去；Esc 取消拖曳回到復原後的位置', () => {
    const t = wire();
    const x0 = t.x();
    t.press('ArrowRight');
    expect(t.x()).toBeCloseTo(x0 + 0.01, 10);
    // 復原（就算沒先結清，ed.undoEdit 也會先把這一步記起來再復原）
    t.set(ed.undoEdit(t.get()));
    expect(t.x()).toBe(x0);
    // 用滑鼠拖同一層（同一組欄位 x、y），還按著
    t.set(ed.editLayer(t.get(), 'hero', { x: 0.3, y: 0 }, 'preview', T1));
    vi.advanceTimersByTime(600);
    expect(t.x()).toBe(0.3);
    expect(t.get().history.previewBase).not.toBeNull();
    // Esc：取消拖曳 → 回到復原後的樣子，不是 0.01
    t.set(ed.cancelEdit(t.get()));
    expect(t.x()).toBe(x0);
  });

  it('換了卡（新的編輯器，就算是同一張卡、同一個圖層 id）：舊的計時器到期不記到新的上面', () => {
    const t = wire();
    const before = t.get();
    t.press('ArrowRight');
    // 換卡（例如重新讀進同一張卡）：復原堆疊是新的
    const reopened = ed.selectLayer(ed.createEditor(ed.currentCard(before)), 'hero');
    t.set(reopened);
    vi.advanceTimersByTime(600);
    expect(t.get()).toBe(reopened);
  });

  it('別的操作已經把這一步記起來了（改了別的欄位）：計時器到期不再補記', () => {
    const t = wire();
    t.press('ArrowRight');
    // 拖深度滑桿（別的欄位）：編輯器先把方向鍵那一步記起來，再開自己的 preview
    t.set(ed.editLayer(t.get(), 'hero', { depth: 33 }, 'preview', T1));
    const during = t.get();
    vi.advanceTimersByTime(600);
    expect(t.get()).toBe(during);
    t.set(ed.editLayer(t.get(), 'hero', { depth: 33 }, 'commit', T1));
    // 兩步：方向鍵一步、深度一步
    expect(t.get().history.past).toHaveLength(during.history.past.length + 1);
  });

  it('同一張卡、同一層、preview 還是這次鍵盤開的：照常記成一步', () => {
    const t = wire();
    const x0 = t.x();
    const steps = t.get().history.past.length;
    t.press('ArrowRight');
    t.press('ArrowRight');
    vi.advanceTimersByTime(600);
    expect(t.get().history.previewBase).toBeNull();
    expect(t.get().history.past).toHaveLength(steps + 1);
    expect(t.x()).toBeCloseTo(x0 + 0.02, 10);
  });

  it('選了別的東西（只換選取、卡片沒變）之後計時器到期：照樣記（按過的鍵算數）', () => {
    const t = wire();
    const steps = t.get().history.past.length;
    t.press('ArrowRight');
    t.set(ed.selectLayer(t.get(), null));
    vi.advanceTimersByTime(600);
    expect(t.get().history.previewBase).toBeNull();
    expect(t.get().history.past).toHaveLength(steps + 1);
  });
});

describe('復原、換卡、換面之前先結清', () => {
  it('復原前先 flush：剛才那段連按記成一步再復原（可以重做回來）', () => {
    const t = wire();
    const x0 = t.x();
    t.press('ArrowRight');
    t.press('ArrowRight');
    t.keys.flush();
    t.set(ed.undoEdit(t.get()));
    expect(t.x()).toBe(x0);
    vi.advanceTimersByTime(1000);
    expect(t.x()).toBe(x0);
    t.set(ed.redoEdit(t.get()));
    expect(t.x()).toBeCloseTo(x0 + 0.02, 10);
  });

  it('cancel()：作廢還沒記的那一步（換卡用，舊卡交出去前已經存了畫面上的樣子）：不記、計時器也停', () => {
    const t = wire();
    t.press('ArrowRight');
    const during = t.get();
    t.keys.cancel();
    expect(t.keys.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(t.get()).toBe(during);
  });

  it('按 Home／F 之前，還沒記的移動先記起來', () => {
    const t = wire();
    t.press('ArrowRight');
    t.press('Home');
    t.press('ArrowLeft');
    t.press('f');
    expect(t.faceCalls).toEqual([
      { kind: 'home', pending: false },
      { kind: 'flip', pending: false },
    ]);
  });
});

describe('鍵盤回正／翻面（Home、F）一定取消選中：ed.showFace', () => {
  it('已經在正面、選著圖層：按 Home 也取消選中', () => {
    const s = editorWithLayers();
    expect(s.face).toBe('front');
    expect(s.selectedLayerId).toBe('hero');
    const next = ed.showFace(s, 'front');
    expect(next.face).toBe('front');
    expect(next.selectedLayerId).toBeNull();
    expect(next.foilSelected).toBe(false);
  });

  it('選著反光層：取消（換面也一樣，不會改看另一面的反光層）', () => {
    const s = ed.selectFoil(editorWithLayers());
    expect(ed.showFace(s, 'front').foilSelected).toBe(false);
    const back = ed.showFace(s, 'back');
    expect(back.face).toBe('back');
    expect(back.foilSelected).toBe(false);
    expect(back.selectedLayerId).toBeNull();
  });

  it('換到另一面：取消選中、卡片不變；本來就沒選東西又在那一面＝原樣', () => {
    const s = editorWithLayers();
    const back = ed.showFace(s, 'back');
    expect(back.face).toBe('back');
    expect(back.selectedLayerId).toBeNull();
    expect(back.history).toBe(s.history);
    const plain = ed.selectLayer(s, null);
    expect(ed.showFace(plain, 'front')).toBe(plain);
  });
});
