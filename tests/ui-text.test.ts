// 文字圖層的編輯器狀態（復原一步的規則）與「打字停 0.6 秒才送」的計時器。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEXT, type NewTextLayerInput } from '../src/model/actions';
import { canUndo } from '../src/model/history';
import { newCard } from '../src/model/create';
import type { Layer, TextSpec } from '../src/model/types';
import {
  addTextLayerEdit,
  createEditor,
  currentCard,
  editLayer,
  editTextLayer,
  redoEdit,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import { debounce, TEXT_IDLE_MS } from '../src/ui/logic';

const T0 = '2026-10-13T00:00:00.000Z';
const T1 = '2026-10-13T01:00:00.000Z';

const hash = (n: number) => n.toString(16).padStart(16, '0');

function textInput(id: string, n = 1): NewTextLayerInput {
  return { id, image: hash(n), text: { ...DEFAULT_TEXT }, width: 2048, height: 328 };
}

function drawn(text: TextSpec, n: number) {
  return { text, image: hash(n), width: 2048, height: 328 };
}

function layerOf(s: EditorState, id: string): Layer | undefined {
  const c = currentCard(s);
  return [...c.front.layers, ...c.back.layers].find((l) => l.id === id);
}

/** 新卡片、正面加一個文字層 t。 */
function withText(): EditorState {
  const r = addTextLayerEdit(createEditor(newCard('standard', 'c', T0)), 'front', textInput('t'), T0);
  return r.state;
}

describe('addTextLayerEdit：加文字＝一步', () => {
  it('成功：記一步、選中新圖層、切到那一面；復原就拿掉', () => {
    const s0 = createEditor(newCard('standard', 'c', T0));
    const r = addTextLayerEdit(s0, 'back', textInput('t'), T1);
    expect(r.problem).toBeNull();
    expect(r.state.selectedLayerId).toBe('t');
    expect(r.state.face).toBe('back');
    expect(layerOf(r.state, 't')).toMatchObject({ role: 'depth', y: 0.55, scale: 1, text: DEFAULT_TEXT, name: '卡片名稱' });
    expect(currentCard(r.state).updatedAt).toBe(T1);
    expect(r.state.history.past).toHaveLength(1);
    expect(layerOf(undoEdit(r.state), 't')).toBeUndefined();
  });

  it('這一面滿了 → face-full，卡片不變、不記步', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    for (let i = 0; i < 8; i++) s = addTextLayerEdit(s, 'front', textInput(`t${i}`, i + 1), T0).state;
    const before = s.history;
    const r = addTextLayerEdit(s, 'front', textInput('t9', 9), T1);
    expect(r.problem).toBe('face-full');
    expect(r.state.history.present).toBe(before.present);
    expect(r.state.history.past).toHaveLength(before.past.length);
  });

  it('輸入不合格 → invalid-input', () => {
    const r = addTextLayerEdit(createEditor(newCard('standard', 'c', T0)), 'front', { ...textInput('t'), image: 'bad' }, T1);
    expect(r.problem).toBe('invalid-input');
  });
});

describe('editTextLayer：改字＝一步；拖自選顏色＝一次拖曳一步', () => {
  it('commit：記一步（圖、設定、名字都換），復原回到舊的圖與設定，重做再回來', () => {
    const s0 = withText();
    const steps = s0.history.past.length;
    const text = { ...DEFAULT_TEXT, content: '月夜' };
    const s1 = editTextLayer(s0, 't', { content: '月夜' }, drawn(text, 2), 'commit', T1);
    expect(s1.history.past).toHaveLength(steps + 1);
    expect(layerOf(s1, 't')).toMatchObject({ name: '月夜', image: hash(2), text });
    const back = undoEdit(s1);
    expect(layerOf(back, 't')).toMatchObject({ name: '卡片名稱', image: hash(1), text: DEFAULT_TEXT });
    expect(layerOf(redoEdit(back), 't')!.text).toEqual(text);
  });

  it('兩次停頓各送一次 commit＝兩步（每次停手記一步，不是每個字一步）', () => {
    let s = withText();
    const steps = s.history.past.length;
    s = editTextLayer(s, 't', { content: '月' }, drawn({ ...DEFAULT_TEXT, content: '月' }, 2), 'commit', T1);
    s = editTextLayer(s, 't', { content: '月夜' }, drawn({ ...DEFAULT_TEXT, content: '月夜' }, 3), 'commit', T1);
    expect(s.history.past).toHaveLength(steps + 2);
  });

  it('拖自選顏色：preview 多次只換畫面，放開 commit 才記一步', () => {
    let s = withText();
    const steps = s.history.past.length;
    for (const [i, c] of ['#111111', '#222222', '#333333'].entries()) {
      s = editTextLayer(s, 't', { color: c }, drawn({ ...DEFAULT_TEXT, color: c }, 10 + i), 'preview', T1);
      expect(layerOf(s, 't')!.text!.color).toBe(c);
      expect(s.history.past).toHaveLength(steps);
    }
    s = editTextLayer(s, 't', { color: '#333333' }, drawn({ ...DEFAULT_TEXT, color: '#333333' }, 12), 'commit', T1);
    expect(s.history.past).toHaveLength(steps + 1);
    expect(layerOf(undoEdit(s), 't')!.text!.color).toBe('#ffffff');
  });

  it('拖顏色拖到一半去改別的（字型）：先把顏色記成一步，再記字型一步', () => {
    let s = withText();
    const steps = s.history.past.length;
    s = editTextLayer(s, 't', { color: '#123456' }, drawn({ ...DEFAULT_TEXT, color: '#123456' }, 20), 'preview', T1);
    const both = { ...DEFAULT_TEXT, color: '#123456', font: 'huninn' as const };
    s = editTextLayer(s, 't', { font: 'huninn' }, drawn(both, 21), 'commit', T1);
    expect(s.history.past).toHaveLength(steps + 2);
    expect(layerOf(s, 't')!.text).toEqual(both);
  });

  it('沒有改變（同一張圖、同一組設定）不記步；圖層不見了也不記步', () => {
    const s0 = withText();
    const same = editTextLayer(s0, 't', { content: '卡片名稱' }, drawn({ ...DEFAULT_TEXT }, 1), 'commit', T1);
    expect(same.history.past).toHaveLength(s0.history.past.length);
    const gone = editTextLayer(s0, 'nope', { content: '月' }, drawn({ ...DEFAULT_TEXT, content: '月' }, 5), 'commit', T1);
    expect(gone.history).toBe(s0.history);
  });

  it('在卡上拖文字圖層（移動／縮放）照舊是一般圖層拖曳，text 保留', () => {
    let s = withText();
    s = editLayer(s, 't', { x: 0.3 }, 'preview', T1);
    s = editLayer(s, 't', { x: 0.3 }, 'commit', T1);
    expect(layerOf(s, 't')).toMatchObject({ x: 0.3, text: DEFAULT_TEXT });
    expect(canUndo(s.history)).toBe(true);
  });
});

describe('toUiState：字型載入狀態、文字圖的內容比例', () => {
  it('有給就帶出去；沒給是空的', () => {
    const s = withText();
    const ui = toUiState(s, () => undefined, { loadedFonts: ['wenkai'], textContentBox: (h) => (h === hash(1) ? { w: 0.5, h: 1 } : undefined) });
    expect(ui.loadedFonts).toEqual(['wenkai']);
    expect(ui.textContentBox?.(hash(1))).toEqual({ w: 0.5, h: 1 });
    const plain = toUiState(s, () => undefined);
    expect(plain.loadedFonts ?? []).toEqual([]);
    expect(plain.textContentBox?.(hash(1))).toBeUndefined();
  });
});

describe('debounce：打字停 0.6 秒才送一次', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('連續打字只在停手 TEXT_IDLE_MS 後送最後的內容一次', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const d = debounce<string>((v) => sent.push(v), TEXT_IDLE_MS);
    expect(TEXT_IDLE_MS).toBe(600);
    for (const v of ['月', '月夜', '月夜之', '月夜之歌']) {
      d.push(v);
      vi.advanceTimersByTime(200);
    }
    expect(sent).toEqual([]);
    expect(d.pending()).toBe(true);
    vi.advanceTimersByTime(599 - 200);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['月夜之歌']);
    expect(d.pending()).toBe(false);
  });

  it('flush：馬上送出還沒送的（例如離開輸入框）；沒有待送的就不送', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const d = debounce<string>((v) => sent.push(v), TEXT_IDLE_MS);
    d.flush();
    expect(sent).toEqual([]);
    d.push('卡');
    d.flush();
    expect(sent).toEqual(['卡']);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(['卡']);
  });

  it('cancel：丟掉還沒送的', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const d = debounce<string>((v) => sent.push(v), TEXT_IDLE_MS);
    d.push('卡');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
    expect(d.pending()).toBe(false);
  });
});
