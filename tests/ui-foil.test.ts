// 反光層的畫面（T-417，DESIGN「反光層」）：左欄最上面固定一列「反光層」、右欄「反光層」面板、星星與勾選同步、
// 鐳射小節拿掉「範圍」、每個改動記一步（可復原）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoilPatch, NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { faceFoil } from '../src/model/foil';
import {
  addUploadedLayer,
  createEditor,
  currentCard,
  editCard,
  editFoil,
  editLayer,
  redoEdit,
  selectFace,
  selectFoil,
  selectLayer,
  setFoilMask,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import { createFoilPanel } from '../src/ui/foil-panel';
import { createInspector } from '../src/ui/inspector';
import { createLayerPanel } from '../src/ui/layer-list';
import {
  escapeAction,
  FOIL_FRAME_LABEL,
  FOIL_FRAME_OFF_TEXT,
  FOIL_HELP,
  FOIL_MASK_HELP,
  FOIL_PICK_MASK,
  FOIL_SHAPE_OPTIONS,
  FOIL_TITLE,
  foilShapeText,
  MATTE_HELP,
  MATTE_LABEL,
  matteText,
  problemText,
} from '../src/ui/logic';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const MASK = 'abcdefabcdefabcd';

function input(id: string, hasAlpha: boolean, image = '0123456789abcdef'): NewLayerInput {
  return { id, name: id, image, hasAlpha, width: 1000, height: 1000 };
}

/** 正面：底圖 bg、立體層 hero、立體層 dragon（衝出卡片）。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('dragon', true), 'dragon.png', T0).state;
  s = editLayer(s, 'dragon', { breakout: true }, 'commit', T0);
  s = editLayer(s, 'bg', { holo: false }, 'commit', T0);
  return selectLayer(s, null);
}

/** 記下每個意圖（其他沒用到的意圖呼叫時丟錯）。 */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const ui = (s: EditorState): UiState => toUiState(s, (h) => `blob:${h}`);

beforeEach(() => {
  installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('介面文字（照 DESIGN「反光層」）', () => {
  it('標題、說明、三個形狀、黑白圖說明、卡框也反光、霧光', () => {
    expect(FOIL_TITLE).toBe('反光層');
    expect(FOIL_HELP).toBe('反光層蓋到的地方是亮面鐳射，其他地方是霧光');
    expect(FOIL_SHAPE_OPTIONS.map((o) => o.label)).toEqual(['整面', '用圖層形狀', '上傳黑白圖']);
    expect(FOIL_SHAPE_OPTIONS.map((o) => o.value)).toEqual(['full', 'layers', 'mask']);
    expect(FOIL_PICK_MASK).toBe('選圖…');
    expect(FOIL_MASK_HELP).toBe('白色＝反光、黑色＝霧光，照卡片比例準備');
    expect(FOIL_FRAME_LABEL).toBe('卡框也反光');
    expect(FOIL_FRAME_OFF_TEXT).toBe('先打開卡框');
    expect(MATTE_LABEL).toBe('霧光');
    expect(MATTE_HELP).toBe('兩面共用');
    expect(matteText(0)).toBe('不反光');
    expect(matteText(35)).toBe('35');
    expect(foilShapeText('full')).toBe('整面');
    expect(foilShapeText('none')).toContain('霧光');
  });

  it('圖滿 16 張的白話', () => {
    expect(problemText('too-many-images')).toMatch(/16/);
  });
});

describe('編輯器：選反光層、改反光層（每個改動記一步）', () => {
  it('選反光層＝取消選圖層；選圖層＝取消反光層；切到背面仍然選著（看背面的反光層）；取消選取兩個都取消', () => {
    let s = selectLayer(setup(), 'hero');
    s = selectFoil(s);
    expect(s.foilSelected).toBe(true);
    expect(s.selectedLayerId).toBeNull();
    expect(ui(s).foilSelected).toBe(true);
    expect(selectLayer(s, 'hero').foilSelected).toBe(false);
    const back = selectFace(s, 'back');
    expect(back.face).toBe('back');
    expect(back.foilSelected).toBe(true);
    expect(selectLayer(s, null).foilSelected).toBe(false);
  });

  it('改形狀、卡框也反光：各一步，可以復原、重做；選取不變', () => {
    const s0 = selectFoil(setup());
    const a = editFoil(s0, 'front', { shape: 'layers' }, T1);
    expect(faceFoil(currentCard(a).front)).toEqual({ shape: 'layers', frame: true });
    expect(currentCard(a).updatedAt).toBe(T1);
    const b = editFoil(a, 'front', { frame: false }, T1);
    expect(faceFoil(currentCard(b).front)).toEqual({ shape: 'layers', frame: false });
    expect(b.foilSelected).toBe(true);
    const undone = undoEdit(b);
    expect(faceFoil(currentCard(undone).front)).toEqual({ shape: 'layers', frame: true });
    expect(faceFoil(currentCard(undoEdit(undone)).front)).toEqual({ shape: 'full', frame: true });
    expect(faceFoil(currentCard(redoEdit(undone)).front)).toEqual({ shape: 'layers', frame: false });
    // 沒改變不記步
    expect(editFoil(b, 'front', { frame: false }, T1)).toEqual(b);
  });

  it('上傳黑白圖：換上並切過去，一步；超過 16 張圖回 too-many-images、卡不變', () => {
    const s0 = selectFoil(setup());
    const r = setFoilMask(s0, 'front', MASK, T1);
    expect(r.problem).toBeNull();
    expect(faceFoil(currentCard(r.state).front)).toEqual({ shape: 'mask', mask: MASK, frame: true });
    expect(faceFoil(currentCard(undoEdit(r.state)).front)).toEqual({ shape: 'full', frame: true });
    // 16 張不同的圖
    let full = createEditor(newCard('standard', 'c2', T0));
    for (const face of ['front', 'back'] as const) {
      for (let i = 0; i < 8; i++) {
        const n = (face === 'front' ? 0 : 8) + i + 1;
        full = addUploadedLayer(full, face, input(`${face}-${i}`, true, n.toString(16).padStart(16, '0')), 'x.png', T0).state;
      }
    }
    const blocked = setFoilMask(full, 'front', MASK, T1);
    expect(blocked.problem).toBe('too-many-images');
    expect(currentCard(blocked.state)).toBe(currentCard(full));
  });

  it('霧光滑桿：拖動中 preview、放開 commit＝一步', () => {
    const s0 = selectFoil(setup());
    const dragging = editCard(s0, { holo: { matte: 60 } }, 'preview', T1);
    expect(currentCard(dragging).holo.matte).toBe(60);
    const done = editCard(dragging, { holo: { matte: 70 } }, 'commit', T1);
    expect(currentCard(done).holo.matte).toBe(70);
    expect('matte' in currentCard(undoEdit(done)).holo).toBe(false);
  });

  it('Esc：選著反光層＝取消選取（和選著圖層一樣）', () => {
    expect(escapeAction({ layerDragging: false, menuOpen: false, confirmOpen: false, typingInText: false, layerSelected: true })).toBe('deselect');
  });
});

describe('左欄：最上面固定一列「反光層」', () => {
  const panel = (s: EditorState) => {
    const r = recorder();
    const p = createLayerPanel(r.intents);
    p.render(ui(s));
    return { ...r, p, row: byClass(p.el, 'foil-row') };
  };

  it('在圖層清單最上面；名字「反光層」、目前形狀；不算在 8 層裡；點它＝選反光層', () => {
    const { p, row, calls } = panel(setup());
    expect(row.textContent).toContain('反光層');
    expect(byClass(row, 'foil-sub').textContent).toBe('整面');
    // 列在清單（ol）前面
    const scroll = byClass(p.el, 'list-scroll');
    expect(scroll.children[0]).toBe(row);
    expect(byClass(p.el, 'panel-count').textContent).toBe('3／8');
    expect(all(p.el, 'layer-row')).toHaveLength(3);
    row.click();
    expect(calls).toEqual([{ name: 'selectFoil', args: [] }]);
  });

  it('選著時有選取的樣子；沒有拖拉把手、沒有刪除鈕', () => {
    const { row, p } = panel(selectFoil(setup()));
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(all(row, 'layer-grip')).toHaveLength(0);
    expect(all(row, 'layer-remove')).toHaveLength(0);
    p.render(ui(setup()));
    expect(row.classList.contains('is-selected')).toBe(false);
  });

  it('小縮圖跟著形狀：黑白圖顯示那張圖', () => {
    const s = setFoilMask(setup(), 'front', MASK, T1).state;
    const { row } = panel(s);
    const thumb = byClass(row, 'foil-thumb');
    expect(thumb.dataset.shape).toBe('mask');
    expect(byClass(row, 'foil-mask').getAttribute('src')).toBe(`blob:${MASK}`);
    expect(byClass(row, 'foil-sub').textContent).toBe('黑白圖');
  });

  it('眼睛：開→關＝形狀選「關」（整面霧光）；關→開回到原本的形狀（沒記住就整面）', () => {
    let s = editFoil(setup(), 'front', { shape: 'layers' }, T1);
    const { row, p, calls } = panel(s);
    const eye = byClass(row, 'foil-eye');
    expect(eye.dataset.state).toBe('on');
    eye.click();
    expect(calls.at(-1)).toEqual({ name: 'editFoil', args: [{ shape: 'none' } satisfies FoilPatch] });
    s = editFoil(s, 'front', { shape: 'none' }, T1);
    p.render(ui(s));
    expect(eye.dataset.state).toBe('off');
    expect(row.classList.contains('is-hidden')).toBe(true);
    eye.click();
    expect(calls.at(-1)).toEqual({ name: 'editFoil', args: [{ shape: 'layers' }] });
    // 一打開就是關著的（例如舊卡的「只在卡框」）：打開＝整面
    const fresh = panel(editFoil(setup(), 'front', { shape: 'none' }, T1));
    byClass(fresh.row, 'foil-eye').click();
    expect(fresh.calls.at(-1)).toEqual({ name: 'editFoil', args: [{ shape: 'full' }] });
  });

  it('圖層的星星只在「用圖層形狀」時出現；兩面各自看自己的反光層', () => {
    let s = setup();
    const { p } = panel(s);
    const list = byClass(p.el, 'layer-list');
    expect(list.classList.contains('show-holo')).toBe(false);
    s = editFoil(s, 'front', { shape: 'layers' }, T1);
    p.render(ui(s));
    expect(list.classList.contains('show-holo')).toBe(true);
    expect(all(p.el, 'layer-holo').every((b) => isShown(b))).toBe(true);
    p.render(ui(selectFace(s, 'back')));
    expect(list.classList.contains('show-holo')).toBe(false);
    expect(byClass(p.el, 'foil-sub').textContent).toBe('整面');
  });
});

describe('右欄「反光層」面板', () => {
  const panel = (s: EditorState) => {
    const r = recorder();
    const p = createFoilPanel(r.intents);
    p.render(ui(s));
    return { ...r, p };
  };
  const shapeButton = (root: unknown, label: string) => buttonWithText(root, label);

  it('標題、說明、三個形狀（目前的選著）、卡框也反光、霧光滑桿（兩面共用）', () => {
    const { p } = panel(selectFoil(setup()));
    expect(p.el.textContent).toContain(FOIL_TITLE);
    expect(p.el.textContent).toContain(FOIL_HELP);
    expect(shapeButton(p.el, '整面').classList.contains('is-selected')).toBe(true);
    expect(shapeButton(p.el, '用圖層形狀').classList.contains('is-selected')).toBe(false);
    expect(p.el.textContent).toContain(FOIL_FRAME_LABEL);
    expect(p.el.textContent).toContain(MATTE_LABEL);
    expect(p.el.textContent).toContain(MATTE_HELP);
  });

  it('點形狀＝editFoil；「上傳黑白圖」還沒有圖時先開選檔、選了就上傳；已經有圖就直接切過去', () => {
    const { p, calls } = panel(selectFoil(setup()));
    shapeButton(p.el, '用圖層形狀').click();
    expect(calls.at(-1)).toEqual({ name: 'editFoil', args: [{ shape: 'layers' }] });
    const file = byClass(p.el, 'foil-file');
    const pick = vi.fn();
    file.addEventListener('click', pick);
    file.click = () => pick();
    shapeButton(p.el, '上傳黑白圖').click();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.name === 'editFoil')).toHaveLength(1);
    const chosen = { name: 'mask.png' } as unknown as File;
    file.files = [chosen];
    file.dispatchEvent(new FakeEvent('change'));
    expect(calls.at(-1)).toEqual({ name: 'uploadFoilMask', args: [chosen] });

    const withMask = panel(editFoil(setFoilMask(setup(), 'front', MASK, T1).state, 'front', { shape: 'full' }, T1));
    shapeButton(withMask.p.el, '上傳黑白圖').click();
    expect(withMask.calls.at(-1)).toEqual({ name: 'editFoil', args: [{ shape: 'mask' }] });
  });

  it('用圖層形狀：列出這一面的圖層，每層一個勾選（＝左欄的星星）；衝出卡片的層不能勾', () => {
    const s = editFoil(selectFoil(setup()), 'front', { shape: 'layers' }, T1);
    const { p, calls } = panel(s);
    const rows = all(p.el, 'foil-layer');
    expect(rows.map((r) => byClass(r, 'foil-layer-name').textContent)).toEqual(['dragon', 'hero', 'bg']);
    const box = (name: string): FakeElement => byClass(rows.find((r) => byClass(r, 'foil-layer-name').textContent === name)!, 'foil-check');
    expect(box('hero').getAttribute('aria-checked')).toBe('true');
    expect(box('bg').getAttribute('aria-checked')).toBe('false');
    box('bg').click();
    expect(calls.at(-1)).toEqual({ name: 'editLayer', args: ['bg', { holo: true }, 'commit'] });
    expect(box('dragon').getAttribute('aria-disabled')).toBe('true');
    expect(box('dragon').title).toBe('衝出卡片的層不反光');
    const before = calls.length;
    box('dragon').click();
    expect(calls).toHaveLength(before);
    // 換形狀後這一塊藏起來
    p.render(ui(editFoil(s, 'front', { shape: 'full' }, T1)));
    expect(isShown(byClass(p.el, 'foil-layers'))).toBe(false);
  });

  it('上傳黑白圖：〔選圖…〕、縮圖、小字說明', () => {
    const s = setFoilMask(selectFoil(setup()), 'front', MASK, T1).state;
    const { p, calls } = panel(s);
    const block = byClass(p.el, 'foil-mask-block');
    expect(isShown(block)).toBe(true);
    expect(byClass(block, 'foil-mask-thumb').getAttribute('src')).toBe(`blob:${MASK}`);
    expect(block.textContent).toContain(FOIL_MASK_HELP);
    const file = byClass(p.el, 'foil-file');
    const pick = vi.fn();
    file.click = () => pick();
    buttonWithText(block, FOIL_PICK_MASK).click();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('卡框也反光：開關送 editFoil；卡框關著時變淡、提示「先打開卡框」', () => {
    const s = selectFoil(setup());
    const { p, calls } = panel(s);
    const sw = buttonWithText(p.el, '開');
    expect(sw.getAttribute('aria-label')).toBe(FOIL_FRAME_LABEL);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    expect(calls.at(-1)).toEqual({ name: 'editFoil', args: [{ frame: false }] });
    const hint = byClass(p.el, 'foil-frame-off');
    expect(isShown(hint)).toBe(true); // 新卡的卡框是關的
    expect(hint.textContent).toContain(FOIL_FRAME_OFF_TEXT);
    expect(byClass(p.el, 'foil-frame').classList.contains('is-off')).toBe(true);
    p.render(ui(editCard(s, { frame: { enabled: true } }, 'commit', T1)));
    expect(isShown(hint)).toBe(false);
    expect(byClass(p.el, 'foil-frame').classList.contains('is-off')).toBe(false);
  });

  it('霧光滑桿：拖動中 preview、放開 commit；0 顯示「不反光」', () => {
    const { p, calls } = panel(selectFoil(setup()));
    const slider = all(p.el, 'slider')[0]!;
    expect(slider.value).toBe('35');
    slider.value = '0';
    slider.dispatchEvent(new FakeEvent('input'));
    expect(calls.at(-1)).toEqual({ name: 'editCard', args: [{ holo: { matte: 0 } }, 'preview'] });
    expect(p.el.textContent).toContain('不反光');
    slider.dispatchEvent(new FakeEvent('change'));
    expect(calls.at(-1)).toEqual({ name: 'editCard', args: [{ holo: { matte: 0 } }, 'commit'] });
  });
});

describe('右欄：鐳射小節拿掉「範圍」；選著反光層時顯示反光層面板', () => {
  it('沒有「全卡／指定圖層／只在卡框」；選反光層時「選中的圖層」那塊換成反光層面板', () => {
    const { intents } = recorder();
    // 色彩選擇器在 document 上聽點外面收起（極簡 DOM 沒有，這裡補空的）
    Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
    const inspector = createInspector(intents);
    inspector.render(ui(setup()));
    const text = inspector.el.textContent;
    for (const old of ['全卡', '指定圖層', '只在卡框', '範圍']) expect(text).not.toContain(old);
    const foil = byClass(inspector.el, 'foil-panel');
    expect(isShown(foil)).toBe(false);
    inspector.render(ui(selectFoil(setup())));
    expect(isShown(foil)).toBe(true);
    expect(isShown(byClass(inspector.el, 'layer-section'))).toBe(false);
    inspector.render(ui(selectLayer(setup(), 'hero')));
    expect(isShown(foil)).toBe(false);
    expect(isShown(byClass(inspector.el, 'layer-section'))).toBe(true);
  });
});
