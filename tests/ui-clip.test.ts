// T-803 剪裁遮色片的介面（DESIGN §3「剪裁遮色片」）：
// 右欄開關「只畫在下面那層上」＋說明（立體層與文字層有、底圖沒有）、變淡條件與滑過說明、一按記一步（可復原）、
// 剪裁中的層深度滑桿變淡、旁邊寫「跟著下面那層」；左欄剪裁中的層縮一格、前面一個小箭頭、不能拖（拖把手變淡）；
// 拖曳排序的目標是剪裁層時改成和它下面那層換；說明面板「圖層進階效果」段多一句；AI 拆成立體層不會壞。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clipParent, type NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Layer } from '../src/model/types';
import {
  addTextLayerEdit,
  addUploadedLayer,
  createEditor,
  currentCard,
  replaceCard,
  editLayer,
  redoEdit,
  selectLayer,
  splitIntoCard,
  swapLayers,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { createLayerPanel } from '../src/ui/layer-list';
import {
  CLIP_BREAKOUT_TEXT,
  CLIP_FOLLOW_TEXT,
  CLIP_HELP,
  CLIP_LABEL,
  CLIP_NO_LAYER_TEXT,
  clipShown,
  clipSwitch,
  displayOrder,
  HELP_SECTIONS,
  swapTarget,
} from '../src/ui/logic';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';

const input = (id: string, hasAlpha = true): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、龍 dragon(50)、花紋 pattern(70)、文字 title(90)。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('dragon'), 'dragon.png', T0).state;
  s = addUploadedLayer(s, 'front', input('pattern'), 'pattern.png', T0).state;
  const text = { content: '卡名', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
  s = addTextLayerEdit(s, 'front', { id: 'title', image: 'fedcba9876543210', text, width: 800, height: 200 }, T0).state;
  return selectLayer(s, null);
}

/** 花紋剪裁到龍。 */
const clipped = () => editLayer(setup(), 'pattern', { clip: true }, 'commit', T1);

const layersOf = (s: EditorState) => currentCard(s).front.layers;
const indexOf = (s: EditorState, id: string) => layersOf(s).findIndex((l) => l.id === id);
const layerOf = (s: EditorState, id: string): Layer => layersOf(s)[indexOf(s, id)]!;

describe('文字與出現條件（DESIGN 的字）', () => {
  it('開關名、說明、變淡的原因、深度旁邊的字', () => {
    expect(CLIP_LABEL).toBe('只畫在下面那層上');
    expect(CLIP_HELP).toBe('例如把花紋只貼在角色的衣服上');
    expect(CLIP_NO_LAYER_TEXT).toBe('下面要有一般的圖層');
    expect(CLIP_BREAKOUT_TEXT).toBe('衝出卡片的層不能剪裁');
    expect(CLIP_FOLLOW_TEXT).toBe('跟著下面那層');
  });

  it('立體層、文字層有；底圖沒有', () => {
    const s = setup();
    expect(clipShown(layerOf(s, 'pattern'))).toBe(true);
    expect(clipShown(layerOf(s, 'title'))).toBe(true);
    expect(clipShown(layerOf(s, 'bg'))).toBe(false);
  });

  it('下面有一般的圖層：可以按；開著顯示開', () => {
    const s = setup();
    expect(clipSwitch(layersOf(s), indexOf(s, 'pattern'))).toEqual({ on: false, locked: false, title: '' });
    const c = clipped();
    expect(clipSwitch(layersOf(c), indexOf(c, 'pattern'))).toEqual({ on: true, locked: false, title: '' });
  });

  it('下面是底圖、這層在最下面 → 變淡，說明「下面要有一般的圖層」', () => {
    const s = setup();
    expect(clipSwitch(layersOf(s), indexOf(s, 'dragon'))).toEqual({ on: false, locked: true, title: CLIP_NO_LAYER_TEXT });
    const noBase = [layerOf(s, 'dragon'), layerOf(s, 'pattern')];
    expect(clipSwitch(noBase, 0)).toEqual({ on: false, locked: true, title: CLIP_NO_LAYER_TEXT });
  });

  it('任一方衝出卡片 → 關著的變淡、按了不改，說明「衝出卡片的層不能剪裁」', () => {
    const own = editLayer(setup(), 'pattern', { breakout: true }, 'commit', T1);
    expect(clipSwitch(layersOf(own), indexOf(own, 'pattern'))).toEqual({ on: false, locked: true, title: CLIP_BREAKOUT_TEXT });
  });

  it('開著但剪裁不成立（下面那層衝出卡片、下面那層被刪掉）→ 不鎖，可以關掉；滑過照樣說明為什麼（T-803b）', () => {
    const below = editLayer(clipped(), 'dragon', { breakout: true }, 'commit', T1);
    expect(clipSwitch(layersOf(below), indexOf(below, 'pattern'))).toEqual({ on: true, locked: false, title: CLIP_BREAKOUT_TEXT });
    const c = clipped();
    const onBase = [layersOf(c)[0]!, layerOf(c, 'pattern')];
    expect(clipSwitch(onBase, 1)).toEqual({ on: true, locked: false, title: CLIP_NO_LAYER_TEXT });
  });
});

describe('編輯：一按記一步', () => {
  it('打開 → 深度跟著龍、復原回到原本的深度與沒有欄位 → 重做又打開；關掉拿掉欄位', () => {
    const s0 = setup();
    const on = editLayer(s0, 'pattern', { clip: true }, 'commit', T1);
    expect(layerOf(on, 'pattern')).toMatchObject({ clip: true, depth: 50 });
    expect(toUiState(on, () => undefined).canUndo).toBe(true);
    const undone = undoEdit(on);
    expect(currentCard(undone)).toEqual(currentCard(s0));
    expect(layerOf(redoEdit(undone), 'pattern')).toMatchObject({ clip: true, depth: 50 });
    const off = editLayer(on, 'pattern', { clip: false }, 'commit', T1);
    expect('clip' in layerOf(off, 'pattern')).toBe(false);
  });

  it('改龍的深度：花紋跟著、一步；Ctrl+Z 一次就回去', () => {
    const c = clipped();
    const moved = editLayer(c, 'dragon', { depth: 80 }, 'commit', T1);
    expect(layerOf(moved, 'pattern').depth).toBe(80);
    expect(clipParent(currentCard(moved).front, indexOf(moved, 'pattern'))).toBe(indexOf(moved, 'dragon'));
    expect(currentCard(undoEdit(moved))).toEqual(currentCard(c));
  });

  it('拖曳排序龍：花紋跟著、一步；拖花紋本身不會動（不記步）', () => {
    const c = clipped();
    const swapped = swapLayers(c, 'dragon', 'title', T1);
    expect(layersOf(swapped).map((l) => l.id)).toEqual(['bg', 'title', 'dragon', 'pattern']);
    expect(layerOf(swapped, 'pattern').depth).toBe(90);
    expect(currentCard(undoEdit(swapped))).toEqual(currentCard(c));
    expect(currentCard(swapLayers(c, 'pattern', 'title', T1))).toBe(currentCard(c));
  });

  it('底圖送 clip 不會改（不記步）；下面是底圖時送 true 不會改', () => {
    const s0 = setup();
    expect(currentCard(editLayer(s0, 'bg', { clip: true }, 'commit', T1))).toBe(currentCard(s0));
    expect(currentCard(editLayer(s0, 'dragon', { clip: true }, 'commit', T1))).toBe(currentCard(s0));
  });

  it('AI 拆成立體層：照樣拆得好，原本的剪裁不變', () => {
    const c = currentCard(clipped());
    const parts = [
      { ...input('far', false), image: '1111111111111111', depth: 0 },
      { ...input('mid'), image: '2222222222222222', depth: 30 },
      { ...input('near'), image: '3333333333333333', depth: 60 },
    ];
    const r = splitIntoCard(c, 'front', parts);
    if ('problem' in r) throw new Error(String(r.problem));
    const layers = r.card.front.layers;
    expect(layers.map((l) => l.id)).toEqual(['far', 'mid', 'dragon', 'pattern', 'near', 'title']);
    const p = layers.findIndex((l) => l.id === 'pattern');
    expect(layers[clipParent(r.card.front, p)!]!.id).toBe('dragon');
  });
});

describe('拖曳排序的對應（swapTarget）', () => {
  it('拖剪裁中的層 → 不換；放到剪裁層上 → 改成和它下面那層換；放到自己的剪裁層上 → 不換', () => {
    const layers = layersOf(clipped());
    const rows = displayOrder(layers); // title, pattern, dragon, bg
    expect(rows.map((l) => l.id)).toEqual(['title', 'pattern', 'dragon', 'bg']);
    expect(swapTarget(rows, 'pattern', 0, layers)).toBeNull();
    expect(swapTarget(rows, 'title', 1, layers)).toBe('dragon');
    expect(swapTarget(rows, 'dragon', 1, layers)).toBeNull();
    expect(swapTarget(rows, 'dragon', 0, layers)).toBe('title');
  });
});

// ---- 右欄、左欄（假 DOM） ----

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

beforeEach(() => {
  installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function inspector() {
  const { intents, calls } = recorder();
  const ins = createInspector(intents);
  const root = ins.el as unknown as FakeElement;
  // T-840：測效果本身前先展開預設收起的進階效果。
  all(root, 'section-toggle').find((b) => b.getAttribute('aria-controls') === 'section-layer-advanced')!.click();
  const render = (s: EditorState) => ins.render(toUiState(s, (h) => `blob:${h}`) as UiState);
  const block = () => byClass(root, 'clip-block');
  const sw = () => byClass(block(), 'switch');
  const depthInput = () => all(root, 'slider').find((el) => el.getAttribute('aria-label') === '深度')!;
  const follow = () => byClass(root, 'depth-follow');
  return { root, calls, render, block, sw, depthInput, follow };
}

describe('右欄「只畫在下面那層上」', () => {
  it('選中立體層：出現開關＋小字；原生按鈕、role=switch、名字（鍵盤可用）', () => {
    const t = inspector();
    t.render(selectLayer(setup(), 'pattern'));
    expect(isShown(t.block())).toBe(true);
    expect(t.block().textContent).toContain(CLIP_LABEL);
    expect(t.block().textContent).toContain(CLIP_HELP);
    expect(t.sw().tagName).toBe('BUTTON');
    expect(t.sw().getAttribute('role')).toBe('switch');
    expect(t.sw().getAttribute('aria-label')).toBe(CLIP_LABEL);
    expect(t.sw().getAttribute('aria-checked')).toBe('false');
  });

  it('文字層有、底圖沒有', () => {
    const t = inspector();
    t.render(selectLayer(setup(), 'title'));
    expect(isShown(t.block())).toBe(true);
    t.render(selectLayer(setup(), 'bg'));
    expect(isShown(t.block())).toBe(false);
  });

  it('按一下 → editLayer(這層, { clip: true }, commit)；開著時顯示開、再按送 false', () => {
    const t = inspector();
    t.render(selectLayer(setup(), 'pattern'));
    t.sw().click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['pattern', { clip: true }, 'commit'] }]);
    t.calls.length = 0;
    t.render(selectLayer(clipped(), 'pattern'));
    expect(t.sw().getAttribute('aria-checked')).toBe('true');
    t.sw().click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['pattern', { clip: false }, 'commit'] }]);
  });

  it('下面是底圖：變淡、aria-disabled、滑過說明；按了不改', () => {
    const t = inspector();
    t.render(selectLayer(setup(), 'dragon'));
    expect(t.block().classList.contains('is-locked')).toBe(true);
    expect(t.sw().getAttribute('aria-disabled')).toBe('true');
    expect(t.sw().title).toBe(CLIP_NO_LAYER_TEXT);
    expect(t.block().title).toBe(CLIP_NO_LAYER_TEXT);
    t.sw().click();
    expect(t.calls).toEqual([]);
    t.render(selectLayer(setup(), 'pattern'));
    expect(t.block().classList.contains('is-locked')).toBe(false);
    expect(t.sw().getAttribute('aria-disabled')).toBeNull();
    expect(t.sw().title).toBe('');
  });

  it('衝出卡片：變淡，說明「衝出卡片的層不能剪裁」', () => {
    const t = inspector();
    t.render(selectLayer(editLayer(setup(), 'pattern', { breakout: true }, 'commit', T1), 'pattern'));
    expect(t.sw().title).toBe(CLIP_BREAKOUT_TEXT);
    t.sw().click();
    expect(t.calls).toEqual([]);
  });

  it('剪裁中的層：深度滑桿變淡（不能拖、Tab 不到）、旁邊寫「跟著下面那層」；一般層照舊', () => {
    const t = inspector();
    t.render(selectLayer(clipped(), 'pattern'));
    expect(t.depthInput().disabled).toBe(true);
    expect(isShown(t.follow())).toBe(true);
    expect(t.follow().textContent).toBe(CLIP_FOLLOW_TEXT);
    t.render(selectLayer(clipped(), 'dragon'));
    expect(t.depthInput().disabled).toBe(false);
    expect(isShown(t.follow())).toBe(false);
  });
});

function layerPanel(s: EditorState) {
  const { intents, calls } = recorder();
  const p = createLayerPanel(intents);
  p.render(toUiState(s, () => undefined));
  const root = p.el as unknown as FakeElement;
  const row = (id: string) => all(root, 'layer-row').find((r) => byClass(r, 'layer-name').value === id)!;
  return { root, calls, row, render: (next: EditorState) => p.render(toUiState(next, () => undefined)) };
}

const pointer = (type: string, clientY: number) => Object.assign(new FakeEvent(type), { button: 0, clientY, pointerId: 1 });

describe('左欄：剪裁中的層縮一格、前面一個小箭頭、不能拖', () => {
  it('剪裁中的層：縮一格（is-clipped）、小箭頭出現、拖把手變淡並說明；朗讀名字時說一聲', () => {
    const t = layerPanel(clipped());
    const r = t.row('pattern');
    expect(r.classList.contains('is-clipped')).toBe(true);
    expect(isShown(byClass(r, 'layer-clip-arrow'))).toBe(true);
    expect(byClass(r, 'layer-grip').title).toContain(CLIP_FOLLOW_TEXT);
    expect(r.getAttribute('aria-label')).toContain(CLIP_LABEL);
    const d = t.row('dragon');
    expect(d.classList.contains('is-clipped')).toBe(false);
    expect(isShown(byClass(d, 'layer-clip-arrow'))).toBe(false);
  });

  it('關掉之後恢復（不縮、沒有箭頭）', () => {
    const t = layerPanel(clipped());
    t.render(editLayer(clipped(), 'pattern', { clip: false }, 'commit', T1));
    expect(t.row('pattern').classList.contains('is-clipped')).toBe(false);
    expect(isShown(byClass(t.row('pattern'), 'layer-clip-arrow'))).toBe(false);
  });

  it('從拖把手或縮圖按住拖：剪裁中的層不會開始拖、不會交換', () => {
    const t = layerPanel(clipped());
    for (const handle of [byClass(t.row('pattern'), 'layer-grip'), byClass(t.row('pattern'), 'layer-thumb')]) {
      handle.dispatchEvent(pointer('pointerdown', 100));
      handle.dispatchEvent(pointer('pointermove', 300));
      expect(t.row('pattern').classList.contains('is-dragging')).toBe(false);
      handle.dispatchEvent(pointer('pointerup', 300));
    }
    expect(t.calls.filter((c) => c.name === 'swapLayers')).toEqual([]);
  });
});

describe('左欄拖曳：一起走的那一組和 model 一樣（T-803 審查）', () => {
  it('中間夾一層「剪裁但衝出卡片」的層：拖下面那層時，後面還在剪裁的層也跟著動（同 model 的 swapDepth）', () => {
    const s0 = setup();
    const card = currentCard(s0);
    const [bg, dragon, pattern, title] = card.front.layers;
    const layers: Layer[] = [
      bg!,
      dragon!,
      { ...pattern!, depth: dragon!.depth, clip: true, breakout: true },
      { ...pattern!, id: 'deco', name: 'deco', depth: dragon!.depth, clip: true },
      title!,
    ];
    const s = replaceCard(s0, { ...card, front: { ...card.front, layers } });
    expect(clipParent({ layers }, 3)).toBe(1);
    const t = layerPanel(s);
    const grip = byClass(t.row('dragon'), 'layer-grip');
    // 假 DOM 沒有 pointer capture：補空的
    for (const el of [grip, t.row('dragon')]) Object.assign(el, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true });
    grip.dispatchEvent(pointer('pointerdown', 100));
    grip.dispatchEvent(pointer('pointermove', 300));
    expect(t.row('dragon').classList.contains('is-dragging')).toBe(true);
    expect(t.row('pattern').classList.contains('is-dragging')).toBe(true);
    expect(t.row('deco').classList.contains('is-dragging')).toBe(true);
    expect(t.row('卡名').classList.contains('is-dragging')).toBe(false);
    grip.dispatchEvent(pointer('pointerup', 300));
  });
});

describe('說明面板「圖層進階效果」段', () => {
  it('多一句剪裁', () => {
    const lines = HELP_SECTIONS.find((s) => s.title === '圖層進階效果')!.lines;
    expect(lines).toContain('打開「只畫在下面那層上」，花紋就只會出現在下面那層的形狀裡。');
  });
});
