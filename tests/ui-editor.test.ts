import { describe, expect, it } from 'vitest';
import { MAX_PARALLAX } from '../src/interact/parallax';
import type { CardPatch, NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, Layer } from '../src/model/types';
import {
  addUploadedLayer,
  answerReplaceBase,
  createEditor,
  currentCard,
  deleteLayer,
  dismissMessage,
  editCard,
  editLayer,
  fillBleed,
  fillLayerEdit,
  centerLayerEdit,
  redoEdit,
  selectFace,
  selectLayer,
  setMessage,
  startNewCard,
  swapLayers,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import { canRedo, canUndo } from '../src/model/history';

const T0 = '2026-10-13T00:00:00.000Z';
const T1 = '2026-10-13T01:00:00.000Z';
const T2 = '2026-10-13T02:00:00.000Z';

function input(id: string, hasAlpha: boolean, width = 1008, height = 1408): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha, width, height };
}

/** 新卡片，正面放：底圖 bg、立體層 hero(50)、petal(70)。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('petal', true), 'petal.png', T0).state;
  return s;
}

function layerOf(s: EditorState, id: string): Layer | undefined {
  const c = currentCard(s);
  return [...c.front.layers, ...c.back.layers].find((l) => l.id === id);
}

describe('建立與新卡片', () => {
  it('一開始編輯正面、沒有選中、不能復原重做', () => {
    const s = createEditor(newCard('tarot', 'x', T0));
    expect(s.face).toBe('front');
    expect(s.selectedLayerId).toBeNull();
    expect(canUndo(s.history)).toBe(false);
    expect(currentCard(s).aspect).toBe('tarot');
  });

  it('新卡片：照選的比例、換成新的復原堆疊（舊的步驟不留）', () => {
    const s = startNewCard('tarot', 'new-id', T1);
    const c = currentCard(s);
    expect(c.aspect).toBe('tarot');
    expect(c.id).toBe('new-id');
    expect(c.createdAt).toBe(T1);
    expect(c.front.layers).toEqual([]);
    expect(canUndo(s.history)).toBe(false);
  });
});

describe('上傳 → 加圖層', () => {
  it('透明圖成為立體層並自動選中、記一步、updatedAt 更新', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    const r = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T1);
    s = r.state;
    expect(r.problem).toBeNull();
    expect(s.selectedLayerId).toBe('hero');
    expect(layerOf(s, 'hero')?.role).toBe('depth');
    expect(currentCard(s).updatedAt).toBe(T1);
    expect(canUndo(s.history)).toBe(true);
  });

  it('上傳到背面：切到背面、選中新圖層', () => {
    const s = addUploadedLayer(createEditor(newCard('standard', 'c', T0)), 'back', input('bk', false), 'bk.jpg', T1).state;
    expect(s.face).toBe('back');
    expect(currentCard(s).back.layers[0]?.id).toBe('bk');
  });

  it('B3：已有底圖又上傳不透明圖 → 不改卡片，記下待確認（含檔名）', () => {
    const s0 = setup();
    const r = addUploadedLayer(s0, 'front', input('bg2', false), 'second.jpg', T1);
    expect(r.problem).toBeNull();
    expect(currentCard(r.state)).toBe(currentCard(s0));
    expect(r.state.pending?.fileName).toBe('second.jpg');
    expect(toUiState(r.state, () => undefined).pendingReplaceBase).toEqual({ fileName: 'second.jpg', hasBase: true });
  });

  it('確認〔取代〕→ 新底圖在第 0 個、選中它、記一步；〔保留原本的〕→ 不變', () => {
    const s0 = addUploadedLayer(setup(), 'front', input('bg2', false), 'second.jpg', T1).state;
    const yes = answerReplaceBase(s0, true, T2);
    expect(currentCard(yes).front.layers[0]?.id).toBe('bg2');
    expect(currentCard(yes).front.layers.some((l) => l.id === 'bg')).toBe(false);
    expect(yes.selectedLayerId).toBe('bg2');
    expect(yes.pending).toBeNull();
    expect(currentCard(yes).updatedAt).toBe(T2);
    const undone = undoEdit(yes);
    expect(currentCard(undone).front.layers[0]?.id).toBe('bg');

    const no = answerReplaceBase(s0, false, T2);
    expect(no.pending).toBeNull();
    expect(currentCard(no)).toBe(currentCard(s0));
  });

  it('每面 8 層滿了 → 回報 face-full、卡片不變', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    for (let i = 0; i < 8; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true), `${i}.png`, T0).state;
    const before = currentCard(s);
    const r = addUploadedLayer(s, 'front', input('l9', true), '9.png', T1);
    expect(r.problem).toBe('face-full');
    expect(currentCard(r.state)).toBe(before);
  });
});

describe('上傳 → 加不進去（invalid-input）', () => {
  it('id 和現有圖層重複 → 回報 invalid-input（不是 face-full）、卡片不變、不記步', () => {
    const s = setup();
    const before = currentCard(s);
    const r = addUploadedLayer(s, 'front', input('hero', true), 'again.png', T1);
    expect(r.problem).toBe('invalid-input');
    expect(currentCard(r.state)).toBe(before);
    expect(r.state.pending).toBeNull();
  });

  it('圖片代碼不合格、id 是空字串 → 也是 invalid-input', () => {
    const s = setup();
    const badImage = { ...input('fresh', true), image: 'not-a-hash' };
    expect(addUploadedLayer(s, 'front', badImage, 'a.png', T1).problem).toBe('invalid-input');
    expect(addUploadedLayer(s, 'back', input('', true), 'b.png', T1).problem).toBe('invalid-input');
  });

  it('不透明圖但 id 重複：不會跳「要不要取代底圖」', () => {
    const r = addUploadedLayer(setup(), 'front', input('hero', false), 'dup.jpg', T1);
    expect(r.problem).toBe('invalid-input');
    expect(r.state.pending).toBeNull();
  });
});

describe('選取與正背面', () => {
  it('切到另一面 → 取消選取；選中某層 → 切到它所在的那一面', () => {
    let s = setup();
    s = selectLayer(s, 'hero');
    expect(s.selectedLayerId).toBe('hero');
    s = selectFace(s, 'back');
    expect(s.face).toBe('back');
    expect(s.selectedLayerId).toBeNull();
    s = selectLayer(s, 'petal');
    expect(s.face).toBe('front');
    expect(s.selectedLayerId).toBe('petal');
  });

  it('選不存在的圖層 → 沒有選取', () => {
    expect(selectLayer(setup(), 'ghost').selectedLayerId).toBeNull();
  });

  it('刪掉選中的圖層 → 取消選取；可以復原（復原後選取不會指到不存在的層）', () => {
    let s = selectLayer(setup(), 'hero');
    s = deleteLayer(s, 'hero', T1);
    expect(layerOf(s, 'hero')).toBeUndefined();
    expect(s.selectedLayerId).toBeNull();
    s = undoEdit(s);
    expect(layerOf(s, 'hero')).toBeDefined();
  });

  it('復原到選中的層還不存在時，選取自動清掉', () => {
    let s = setup(); // 最後加的 petal 被選中
    expect(s.selectedLayerId).toBe('petal');
    s = undoEdit(s);
    expect(layerOf(s, 'petal')).toBeUndefined();
    expect(s.selectedLayerId).toBeNull();
    s = redoEdit(s);
    expect(layerOf(s, 'petal')).toBeDefined();
  });
});

describe('B7：拖曳滑桿＝一步', () => {
  it('preview 多次只換畫面、commit 才記一步；Ctrl+Z 一次回到拖之前', () => {
    const s0 = setup();
    const steps0 = s0.history.past.length;
    let s = editLayer(s0, 'hero', { depth: 60 }, 'preview', T1);
    s = editLayer(s, 'hero', { depth: 70 }, 'preview', T1);
    s = editLayer(s, 'hero', { depth: 80 }, 'preview', T1);
    expect(layerOf(s, 'hero')?.depth).toBe(80);
    expect(s.history.past.length).toBe(steps0);
    s = editLayer(s, 'hero', { depth: 85 }, 'commit', T2);
    expect(layerOf(s, 'hero')?.depth).toBe(85);
    expect(s.history.past.length).toBe(steps0 + 1);
    expect(currentCard(s).updatedAt).toBe(T2);
    s = undoEdit(s);
    expect(layerOf(s, 'hero')?.depth).toBe(50);
  });

  it('拖到一半換拖別的欄位：上一個拖曳先記成一步，兩個改變都保留', () => {
    const s0 = setup();
    let s = editLayer(s0, 'hero', { x: 0.5 }, 'preview', T1);
    s = editLayer(s, 'hero', { y: 0.3 }, 'preview', T1);
    expect(layerOf(s, 'hero')).toMatchObject({ x: 0.5, y: 0.3 });
    expect(s.history.past.length).toBe(s0.history.past.length + 1);
    s = editLayer(s, 'hero', { y: 0.4 }, 'commit', T1);
    expect(layerOf(s, 'hero')).toMatchObject({ x: 0.5, y: 0.4 });
    expect(layerOf(undoEdit(s), 'hero')).toMatchObject({ x: 0.5, y: 0 });
  });

  it('深度調到比別層大 → 陣列重新排序（清單跟著換位置）', () => {
    const s = editLayer(setup(), 'hero', { depth: 95 }, 'commit', T1);
    expect(currentCard(s).front.layers.map((l) => l.id)).toEqual(['bg', 'petal', 'hero']);
  });

  it('拖到一半去按別的開關：先把拖曳記成一步，開關再記一步，兩個都保留', () => {
    let s = editLayer(setup(), 'hero', { depth: 30 }, 'preview', T1);
    s = editLayer(s, 'petal', { visible: false }, 'commit', T1);
    expect(layerOf(s, 'hero')?.depth).toBe(30);
    expect(layerOf(s, 'petal')?.visible).toBe(false);
    s = undoEdit(s);
    expect(layerOf(s, 'petal')?.visible).toBe(true);
    expect(layerOf(s, 'hero')?.depth).toBe(30);
  });

  it('沒有改變的 commit 不記步', () => {
    const s0 = setup();
    const s = editLayer(s0, 'hero', { depth: 50 }, 'commit', T1);
    expect(s.history.past.length).toBe(s0.history.past.length);
  });

  it('卡片設定也一樣：卡身色拖選中 preview、放開 commit＝一步', () => {
    const s0 = setup();
    let s = editCard(s0, { bodyColor: '#112233' }, 'preview', T1);
    s = editCard(s, { bodyColor: '#445566' }, 'preview', T1);
    s = editCard(s, { bodyColor: '#778899' }, 'commit', T1);
    expect(currentCard(s).bodyColor).toBe('#778899');
    expect(s.history.past.length).toBe(s0.history.past.length + 1);
    expect(currentCard(undoEdit(s)).bodyColor).toBe('#1b2033');
  });

  it('卡框寬度與開關、放開回正、比例都走 updateCard', () => {
    let s = editCard(setup(), { frame: { enabled: true, width: 0.05 } }, 'commit', T1);
    s = editCard(s, { view: { returnToFront: false } }, 'commit', T1);
    s = editCard(s, { aspect: 'tarot' }, 'commit', T1);
    const c = currentCard(s);
    expect(c.frame).toEqual({ enabled: true, width: 0.05, color: '#d8dbe2', shine: 50 });
    expect(c.view.returnToFront).toBe(false);
    expect(c.aspect).toBe('tarot');
  });

  it('外觀滑桿（陰影濃淡、距離、卡框光澤，T-310）：拖動中 preview、放開 commit＝一步，復原一次就還原', () => {
    const s0 = setup();
    const before = currentCard(s0);
    const cases: [(v: number) => CardPatch, (c: Card) => number][] = [
      [(v) => ({ shadow: { strength: v } }), (c) => c.shadow.strength],
      [(v) => ({ shadow: { distance: v } }), (c) => c.shadow.distance],
      [(v) => ({ frame: { shine: v, enabled: true } }), (c) => c.frame.shine],
    ];
    for (const [patchAt, read] of cases) {
      let s = editCard(s0, patchAt(30), 'preview', T1);
      s = editCard(s, patchAt(10), 'preview', T1);
      expect(read(currentCard(s))).toBe(10);
      expect(s.history.past.length).toBe(s0.history.past.length);
      s = editCard(s, patchAt(0), 'commit', T1);
      expect(read(currentCard(s))).toBe(0);
      expect(s.history.past.length).toBe(s0.history.past.length + 1);
      expect(currentCard(undoEdit(s))).toBe(before);
    }
  });

  it('鐳射色彩與自訂顏色（T-310）：選了就 commit＝一步；復原一次就還原；換顏色時拖自選顏色只記一步', () => {
    const s0 = setup();
    const before = currentCard(s0);
    let s = editCard(s0, { holo: { palette: 'custom' } }, 'commit', T1);
    expect(currentCard(s).holo.palette).toBe('custom');
    expect(s.history.past.length).toBe(s0.history.past.length + 1);
    expect(currentCard(undoEdit(s))).toBe(before);

    const s1 = s;
    const colors = currentCard(s1).holo.colors;
    const at = (c: string) => [colors[0]!, c, colors[2]!, colors[3]!];
    s = editCard(s1, { holo: { colors: at('#101010') } }, 'preview', T2);
    s = editCard(s, { holo: { colors: at('#202020') } }, 'preview', T2);
    s = editCard(s, { holo: { colors: at('#303030') } }, 'commit', T2);
    expect(currentCard(s).holo.colors).toEqual(at('#303030'));
    expect(s.history.past.length).toBe(s1.history.past.length + 1);
    expect(currentCard(undoEdit(s)).holo.colors).toEqual(colors);
    expect(currentCard(undoEdit(s)).holo.palette).toBe('custom');
  });

  it('展示擺動開關：一次 commit＝一步，不動到放開回正；復原一次就還原', () => {
    const s0 = setup();
    expect(currentCard(s0).view.showcase).toBe(false);
    const s = editCard(s0, { view: { showcase: true } }, 'commit', T1);
    expect(currentCard(s).view).toEqual({ returnToFront: true, showcase: true, stage: 'desk' });
    expect(s.history.past.length).toBe(s0.history.past.length + 1);
    expect(currentCard(undoEdit(s)).view.showcase).toBe(false);
    // 再按一次關掉（已經是關的就不記步）
    const off = editCard(s, { view: { showcase: false } }, 'commit', T1);
    expect(currentCard(off).view.showcase).toBe(false);
    expect(editCard(off, { view: { showcase: false } }, 'commit', T1).history.past.length).toBe(off.history.past.length);
  });

  it('舞台選擇（T-314）：按一下＝一步，不動到其他 view 設定；復原一次就還原', () => {
    const s0 = setup();
    expect(currentCard(s0).view.stage).toBe('desk');
    const s = editCard(s0, { view: { stage: 'none' } }, 'commit', T1);
    expect(currentCard(s).view).toEqual({ ...currentCard(s0).view, stage: 'none' });
    expect(s.history.past.length).toBe(s0.history.past.length + 1);
    expect(currentCard(undoEdit(s)).view.stage).toBe('desk');
    // 再按一次同一個選項不記步
    expect(editCard(s, { view: { stage: 'none' } }, 'commit', T1).history.past.length).toBe(s.history.past.length);
  });
});

describe('其他圖層動作', () => {
  it('拖拉排序＝交換兩層深度（一步）', () => {
    const s = swapLayers(setup(), 'hero', 'petal', T1);
    expect(layerOf(s, 'hero')?.depth).toBe(70);
    expect(layerOf(s, 'petal')?.depth).toBe(50);
    expect(currentCard(undoEdit(s)).front.layers.map((l) => l.id)).toEqual(['bg', 'hero', 'petal']);
  });

  it('改名、顯示開關一次就記一步', () => {
    let s = editLayer(setup(), 'hero', { name: '主角' }, 'commit', T1);
    s = editLayer(s, 'hero', { visible: false }, 'commit', T1);
    expect(layerOf(s, 'hero')?.name).toBe('主角');
    expect(layerOf(s, 'hero')?.visible).toBe(false);
    expect(layerOf(undoEdit(s), 'hero')?.visible).toBe(true);
  });

  it('置中：x、y 歸 0', () => {
    let s = editLayer(setup(), 'hero', { x: 0.4, y: -0.2 }, 'commit', T1);
    s = centerLayerEdit(s, 'hero', T1);
    expect(layerOf(s, 'hero')).toMatchObject({ x: 0, y: 0 });
  });

  it('填滿的出血：立體層＝2 × depth/100 × MAX_PARALLAX；底圖 0', () => {
    const s = setup();
    expect(fillBleed(layerOf(s, 'hero')!)).toBeCloseTo(2 * 0.5 * MAX_PARALLAX, 12);
    expect(fillBleed(layerOf(s, 'petal')!)).toBeCloseTo(2 * 0.7 * MAX_PARALLAX, 12);
    expect(fillBleed(layerOf(s, 'bg')!)).toBe(0);
  });

  it('填滿：立體層蓋滿卡面再多放大出血；沒有圖片尺寸就不變', () => {
    const s0 = setup();
    const s = fillLayerEdit(s0, 'hero', { width: 1008, height: 1408 }, T1);
    const hero = layerOf(s, 'hero')!;
    const bleed = 2 * 0.5 * MAX_PARALLAX;
    // 要蓋住 (1+2b) × (卡高+2b)：寬、高兩個條件取大的
    expect(hero.scale).toBeCloseTo(Math.max(1 + 2 * bleed, ((88 / 63 + 2 * bleed) * 1008) / 1408), 10);
    expect(hero.scale).toBeGreaterThan(1);
    expect(hero).toMatchObject({ x: 0, y: 0 });
    expect(fillLayerEdit(s0, 'hero', undefined, T1)).toBe(s0);
  });
});

describe('訊息與畫面狀態', () => {
  it('設定與關掉訊息', () => {
    let s = setMessage(setup(), { kind: 'error', text: '每一面最多 8 層。' });
    expect(toUiState(s, () => undefined).message?.text).toBe('每一面最多 8 層。');
    s = dismissMessage(s);
    expect(s.message).toBeNull();
  });

  it('toUiState：帶出目前卡片、面、選取、能不能復原重做與縮圖網址', () => {
    const s = setup();
    const ui = toUiState(s, (h) => `blob:${h}`);
    expect(ui.card).toBe(currentCard(s));
    expect(ui.face).toBe('front');
    expect(ui.selectedLayerId).toBe('petal');
    expect(ui.canUndo).toBe(true);
    expect(ui.canRedo).toBe(false);
    expect(ui.imageUrl('abc')).toBe('blob:abc');
    expect(toUiState(undoEdit(s), () => undefined).canRedo).toBe(true);
    expect(canRedo(undoEdit(s).history)).toBe(true);
  });

  it('不改輸入的狀態物件', () => {
    const s = setup();
    const snapshot: Card = structuredClone(currentCard(s));
    editLayer(s, 'hero', { depth: 99 }, 'commit', T1);
    deleteLayer(s, 'hero', T1);
    expect(currentCard(s)).toEqual(snapshot);
  });
});
