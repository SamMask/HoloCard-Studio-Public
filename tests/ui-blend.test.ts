// T-408 右欄的不透明度與混合模式（DESIGN §3）＋上傳確認框的「當發光層／當加深層」：
// 畫面用的純邏輯（ui/logic.ts）與編輯器狀態（ui/editor.ts）。
import { describe, expect, it } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { canRedo, canUndo } from '../src/model/history';
import { newCard } from '../src/model/create';
import { BLEND_MODES, OPAQUE_LAYER_BLENDS, type Layer } from '../src/model/types';
import { validateCard } from '../src/model/validate';
import {
  addUploadedLayer,
  answerOpaqueLayer,
  answerReplaceBase,
  createEditor,
  currentCard,
  editLayer,
  toUiState,
  undoEdit,
  redoEdit,
  type EditorState,
} from '../src/ui/editor';
import {
  BLEND_OPTIONS,
  blendChoices,
  blendLabel,
  layerBlendTag,
  layerSubText,
  OPAQUE_BLEND_NOTE,
  opacityText,
} from '../src/ui/logic';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';

function input(id: string, hasAlpha: boolean): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 };
}

/** 正面：底圖 bg、立體層 hero(50)。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  return s;
}

function layerOf(s: EditorState, id: string): Layer | undefined {
  const c = currentCard(s);
  return [...c.front.layers, ...c.back.layers].find((l) => l.id === id);
}

const depth = (over: Partial<Layer> = {}): Layer => ({
  id: 'd',
  name: 'd',
  role: 'depth',
  image: '0123456789abcdef',
  visible: true,
  depth: 50,
  x: 0,
  y: 0,
  scale: 1,
  holo: true,
  hasAlpha: true,
  ...over,
});

describe('混合模式選項（DESIGN §3 的字）', () => {
  it('七個選項、順序同 BLEND_MODES；每個＝白話名＋括號原名＋一句用途', () => {
    expect(BLEND_OPTIONS.map((o) => o.value)).toEqual([...BLEND_MODES]);
    expect(BLEND_OPTIONS.map((o) => [o.name, o.original, o.use])).toEqual([
      ['正常', null, null],
      ['加深', '色彩增值', '疊陰影、紙紋、線稿，白色會變透明'],
      ['發光', '濾色', '光暈、粒子、火焰，黑色會變透明'],
      ['強光', '線性加亮', '霓虹、能量，越疊越亮'],
      ['疊色', '覆蓋', '材質、加強對比'],
      ['柔光', null, '柔和打光、調色調'],
      ['換色', '顏色', '換顏色、保留明暗'],
    ]);
  });

  it('blendLabel：有原名的加括號', () => {
    expect(blendLabel('screen')).toBe('發光（濾色）');
    expect(blendLabel('normal')).toBe('正常');
    expect(blendLabel('soft-light')).toBe('柔光');
  });

  it('有透明的圖：七個都能選；沒有透明的圖：只有加深／發光／強光能選＋說明', () => {
    const all = blendChoices(depth());
    expect(all.choices.map((c) => c.enabled)).toEqual(BLEND_MODES.map(() => true));
    expect(all.note).toBeNull();
    const opaque = blendChoices(depth({ hasAlpha: false, blend: 'screen' }));
    expect(opaque.choices.filter((c) => c.enabled).map((c) => c.option.value)).toEqual([...OPAQUE_LAYER_BLENDS]);
    expect(opaque.choices).toHaveLength(7);
    expect(opaque.note).toBe(OPAQUE_BLEND_NOTE);
    expect(OPAQUE_BLEND_NOTE).toBe('這張圖沒有透明背景，只能用這三種');
  });
});

describe('不透明度滑桿旁的字', () => {
  it('0 → 看不見；其他是百分比（四捨五入）', () => {
    expect(opacityText(0)).toBe('看不見');
    expect(opacityText(0.4)).toBe('看不見');
    expect(opacityText(50)).toBe('50%');
    expect(opacityText(99.6)).toBe('100%');
    expect(opacityText(100)).toBe('100%');
  });
});

describe('圖層清單那一列：小字與縮圖上的模式標示', () => {
  it('小字：底圖＝底圖（T-837 起不再寫背景）；立體層＝深度（不管模式）', () => {
    expect(layerSubText(depth({ role: 'base', depth: 0, hasAlpha: false }))).toBe('底圖');
    expect(layerSubText(depth({ depth: 62.4 }))).toBe('深度 62');
    expect(layerSubText(depth({ blend: 'screen' }))).toBe('深度 50');
  });

  it('縮圖標示：非正常模式＝白話名；正常（含省略）＝不顯示', () => {
    expect(layerBlendTag(depth())).toBeNull();
    expect(layerBlendTag(depth({ blend: 'normal' }))).toBeNull();
    expect(layerBlendTag(depth({ blend: 'screen' }))).toBe('發光');
    expect(layerBlendTag(depth({ blend: 'soft-light', opacity: 30 }))).toBe('柔光');
    expect(layerBlendTag(depth({ blend: 'multiply' }))).toBe('加深');
  });
});

describe('編輯器：不透明度拖動中預覽、放開記一步；換模式記一步、可復原', () => {
  it('拖不透明度：preview 不記步、commit 記一步；復原一次回到 100', () => {
    const s0 = setup();
    const p1 = editLayer(s0, 'hero', { opacity: 80 }, 'preview', T1);
    const p2 = editLayer(p1, 'hero', { opacity: 40 }, 'preview', T1);
    expect(layerOf(p2, 'hero')?.opacity).toBe(40);
    expect(p2.history.past.length).toBe(s0.history.past.length);
    const done = editLayer(p2, 'hero', { opacity: 40 }, 'commit', T1);
    expect(done.history.past.length).toBe(s0.history.past.length + 1);
    expect(currentCard(done).updatedAt).toBe(T1);
    const undone = undoEdit(done);
    expect('opacity' in layerOf(undone, 'hero')!).toBe(false);
    expect(currentCard(undone)).toBe(currentCard(s0));
  });

  it('換模式：一步、可復原、可重做', () => {
    const s0 = setup();
    const s1 = editLayer(s0, 'hero', { blend: 'overlay' }, 'commit', T1);
    expect(layerOf(s1, 'hero')?.blend).toBe('overlay');
    expect(s1.history.past.length).toBe(s0.history.past.length + 1);
    const undone = undoEdit(s1);
    expect('blend' in layerOf(undone, 'hero')!).toBe(false);
    expect(canRedo(undone.history)).toBe(true);
    expect(layerOf(redoEdit(undone), 'hero')?.blend).toBe('overlay');
  });

  it('底圖不能調（不記步）', () => {
    const s0 = setup();
    for (const patch of [{ opacity: 20 }, { blend: 'screen' as const }]) {
      const s1 = editLayer(s0, 'bg', patch, 'commit', T1);
      expect(currentCard(s1)).toBe(currentCard(s0));
      expect(s1.history.past.length).toBe(s0.history.past.length);
    }
  });
});

describe('上傳確認框：當發光層／當加深層（SCHEMA §1.3、DESIGN §3）', () => {
  it.each([
    ['screen', '當發光層'],
    ['multiply', '當加深層'],
  ] as const)('%s（%s）：加成立體層並設好模式、選中它、記一步、關掉確認框、可復原', (blend, _button) => {
    const s0 = addUploadedLayer(setup(), 'front', input('fx', false), 'glow.jpg', T1).state;
    expect(toUiState(s0, () => undefined).pendingReplaceBase).toEqual({ fileName: 'glow.jpg', hasBase: true });
    const r = answerOpaqueLayer(s0, blend, T2);
    expect(r.problem).toBeNull();
    const s1 = r.state;
    expect(s1.pending).toBeNull();
    expect(s1.selectedLayerId).toBe('fx');
    expect(s1.face).toBe('front');
    expect(currentCard(s1).front.layers.map((l) => l.id)).toEqual(['bg', 'hero', 'fx']);
    expect(layerOf(s1, 'fx')).toMatchObject({ role: 'depth', depth: 70, hasAlpha: false, blend });
    expect(layerOf(s1, 'bg')?.role).toBe('base');
    expect(currentCard(s1).updatedAt).toBe(T2);
    expect(validateCard(currentCard(s1), () => true)).toEqual([]);
    expect(canUndo(s1.history)).toBe(true);
    expect(currentCard(undoEdit(s1)).front.layers.map((l) => l.id)).toEqual(['bg', 'hero']);
  });

  it('上傳到背面時：加到背面、切到背面', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    s = addUploadedLayer(s, 'back', input('bk', false), 'bk.jpg', T0).state;
    s = addUploadedLayer(s, 'back', input('fx', false), 'fx.jpg', T1).state;
    const r = answerOpaqueLayer({ ...s, face: 'front' }, 'screen', T2);
    expect(r.state.face).toBe('back');
    expect(currentCard(r.state).back.layers.map((l) => l.id)).toEqual(['bk', 'fx']);
  });

  it('這一面已經 8 層：face-full、確認框關掉、卡片不變', () => {
    let s = createEditor(newCard('standard', 'c', T0));
    s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
    for (let i = 0; i < 7; i++) s = addUploadedLayer(s, 'front', input(`l${i}`, true), `${i}.png`, T0).state;
    s = addUploadedLayer(s, 'front', input('fx', false), 'fx.jpg', T1).state;
    expect(s.pending).not.toBeNull();
    const before = currentCard(s);
    const r = answerOpaqueLayer(s, 'screen', T2);
    expect(r.problem).toBe('face-full');
    expect(r.state.pending).toBeNull();
    expect(currentCard(r.state)).toBe(before);
  });

  it('沒有待確認的圖：不做事', () => {
    const s0 = setup();
    const r = answerOpaqueLayer(s0, 'screen', T1);
    expect(r).toEqual({ state: s0, problem: null });
  });

  it('〔取代底圖〕〔取消〕照舊', () => {
    const s0 = addUploadedLayer(setup(), 'front', input('bg2', false), 'second.jpg', T1).state;
    expect(currentCard(answerReplaceBase(s0, true, T2)).front.layers[0]?.id).toBe('bg2');
    expect(currentCard(answerReplaceBase(s0, false, T2))).toBe(currentCard(s0));
  });
});
