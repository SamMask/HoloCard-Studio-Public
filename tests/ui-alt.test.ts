// T-805 雙圖光柵的介面（DESIGN「雙圖光柵」）：右欄「變身圖」小節（〔加上變身圖〕→ 選檔；加了之後小縮圖＋〔換一張〕〔拿掉〕＋說明句）、
// 出現條件（立體層有；底圖、文字層沒有；衝出卡片的層變淡、按了不改）、有變身圖的層「衝出卡片」開關變淡、
// 加／換／拿掉各記一步（editor 的 setLayerAlt）、不透明的變身圖不合混合模式時的白話、混合模式兩張一起看、
// 左欄縮圖角落「雙」、說明面板「圖層進階效果」段多一句、鍵盤可用（原生按鈕）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { cardImages } from '../src/model/foil';
import type { Layer } from '../src/model/types';
import {
  addTextLayerEdit,
  addUploadedLayer,
  answerOpaqueLayer,
  askOpaqueUpload,
  createEditor,
  currentCard,
  deleteLayer,
  editLayer,
  redoEdit,
  replaceCutoutInCard,
  replaceRoom,
  selectLayer,
  setLayerAlt,
  toUiState,
  undoEdit,
  type EditorState,
} from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { createLayerPanel } from '../src/ui/layer-list';
import {
  ALT_ADD_LABEL,
  ALT_BREAKOUT_TEXT,
  ALT_CHANGE_LABEL,
  ALT_HELP,
  ALT_NEEDS_ALPHA_TEXT,
  ALT_OPAQUE_BLEND_NOTE,
  ALT_REMOVE_LABEL,
  ALT_TAG,
  ALT_TITLE,
  altProblemText,
  altSection,
  blendChoices,
  BREAKOUT_ALT_TEXT,
  breakoutSwitch,
  HELP_SECTIONS,
  layerAltTag,
  OPAQUE_BLEND_NOTE,
  pickStillValid,
} from '../src/ui/logic';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeEvent, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const ALT = { image: 'aaaaaaaaaaaaaaa1', hasAlpha: true };
const ALT2 = { image: 'aaaaaaaaaaaaaaa2', hasAlpha: true };
const OPAQUE = { image: 'aaaaaaaaaaaaaaa3', hasAlpha: false };

const input = (id: string, hasAlpha: boolean, image = '0123456789abcdef'): NewLayerInput => ({ id, name: id, image, hasAlpha, width: 1000, height: 1000 });

/** 正面：底圖 bg、有透明的 hero、沒有透明的加深層 ink、文字層 title。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = askOpaqueUpload(s, 'front', input('ink', false), 'ink.png', T0).state;
  s = answerOpaqueLayer(s, 'multiply', T0).state;
  const text = { content: '卡名', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' } as const;
  s = addTextLayerEdit(s, 'front', { id: 'title', image: 'fedcba9876543210', text, width: 800, height: 200 }, T0).state;
  return s;
}

const layerOf = (s: EditorState, id: string): Layer => currentCard(s).front.layers.find((l) => l.id === id)!;

describe('文字（DESIGN 的字）', () => {
  it('小節名、按鈕、說明句、左欄標記、混合模式提示', () => {
    expect(ALT_TITLE).toBe('變身圖');
    expect(ALT_ADD_LABEL).toBe('加上變身圖');
    expect(ALT_CHANGE_LABEL).toBe('換一張');
    expect(ALT_REMOVE_LABEL).toBe('拿掉');
    expect(ALT_HELP).toBe('左右轉卡就會換成這張，像會動的光柵卡');
    expect(ALT_TAG).toBe('雙');
    expect(ALT_NEEDS_ALPHA_TEXT).toBe('這層的混合模式只能用有透明背景的圖');
  });

  it('說明面板「圖層進階效果」段多一句', () => {
    const lines = HELP_SECTIONS.find((s) => s.title === '圖層進階效果')!.lines;
    expect(lines).toContain('選一層按〔加上變身圖〕，左右轉卡就會換成另一張，像光柵卡。');
  });
});

describe('logic：小節狀態、衝出卡片開關、混合模式、左欄標記', () => {
  it('altSection：立體層有（含加深層）；底圖、文字層沒有；衝出卡片的層變淡＋滑過說明', () => {
    const s = setup();
    expect(altSection(layerOf(s, 'hero'))).toEqual({ shown: true, has: false, locked: false, title: '' });
    expect(altSection(layerOf(s, 'ink'))).toMatchObject({ shown: true, locked: false });
    expect(altSection(layerOf(s, 'bg')).shown).toBe(false);
    expect(altSection(layerOf(s, 'title')).shown).toBe(false);
    expect(altSection({ ...layerOf(s, 'hero'), breakout: true })).toEqual({ shown: true, has: false, locked: true, title: ALT_BREAKOUT_TEXT });
    expect(altSection({ ...layerOf(s, 'hero'), alt: ALT })).toEqual({ shown: true, has: true, locked: false, title: '' });
  });

  it('breakoutSwitch：有變身圖、還沒衝出卡片 → 變淡、按了不改、滑過說明；開著的照樣能關', () => {
    const hero = layerOf(setup(), 'hero');
    expect(breakoutSwitch(hero)).toEqual({ on: false, locked: false, title: '' });
    expect(breakoutSwitch({ ...hero, alt: ALT })).toEqual({ on: false, locked: true, title: BREAKOUT_ALT_TEXT });
    expect(breakoutSwitch({ ...hero, breakout: true })).toEqual({ on: true, locked: false, title: '' });
  });

  it('blendChoices：變身圖沒有透明 → 只能選三種，提示說是變身圖', () => {
    const hero = layerOf(setup(), 'hero');
    const { choices, note } = blendChoices({ ...hero, alt: OPAQUE });
    expect(choices.filter((c) => c.enabled).map((c) => c.option.value)).toEqual(['multiply', 'screen', 'add']);
    expect(note).toBe(ALT_OPAQUE_BLEND_NOTE);
    expect(blendChoices({ ...hero, hasAlpha: false, alt: OPAQUE }).note).toBe(OPAQUE_BLEND_NOTE);
    expect(blendChoices({ ...hero, alt: ALT }).note).toBeNull();
  });

  it('layerAltTag：有變身圖＝「雙」，沒有＝null', () => {
    const hero = layerOf(setup(), 'hero');
    expect(layerAltTag(hero)).toBeNull();
    expect(layerAltTag({ ...hero, alt: ALT })).toBe(ALT_TAG);
  });

  it('altProblemText：混合模式不合、圖太多', () => {
    expect(altProblemText('needs-alpha')).toBe(ALT_NEEDS_ALPHA_TEXT);
    expect(altProblemText('too-many-images')).toContain('16 張');
    expect(altProblemText('layer-gone')).toBeNull();
  });
});

describe('editor.setLayerAlt：加、換、拿掉各記一步', () => {
  it('加上 → 一步（復原回到沒有、重做又有）；換一張 → 一步（復原回到上一張）；拿掉 → 一步', () => {
    const s0 = setup();
    const added = setLayerAlt(s0, 'hero', ALT, T1);
    expect(added.problem).toBeNull();
    expect(layerOf(added.state, 'hero').alt).toEqual(ALT);
    expect(currentCard(added.state).updatedAt).toBe(T1);
    const undone = undoEdit(added.state);
    expect(currentCard(undone)).toEqual(currentCard(s0));
    expect(layerOf(redoEdit(undone), 'hero').alt).toEqual(ALT);

    const changed = setLayerAlt(added.state, 'hero', ALT2, T1);
    expect(layerOf(changed.state, 'hero').alt).toEqual(ALT2);
    expect(layerOf(undoEdit(changed.state), 'hero').alt).toEqual(ALT);

    const removed = editLayer(changed.state, 'hero', { alt: null }, 'commit', T1);
    expect('alt' in layerOf(removed, 'hero')).toBe(false);
    expect(layerOf(undoEdit(removed), 'hero').alt).toEqual(ALT2);
  });

  it('選同一張 → 不多記一步、沒有問題', () => {
    const added = setLayerAlt(setup(), 'hero', ALT, T1).state;
    const again = setLayerAlt(added, 'hero', { ...ALT }, T1);
    expect(again.problem).toBeNull();
    expect(again.state.history).toBe(added.history);
  });

  it('不透明的圖、這層是正常模式 → needs-alpha、卡不變；加深層可以', () => {
    const s0 = setup();
    const r = setLayerAlt(s0, 'hero', OPAQUE, T1);
    expect(r.problem).toBe('needs-alpha');
    expect(currentCard(r.state)).toBe(currentCard(s0));
    expect(setLayerAlt(s0, 'ink', OPAQUE, T1).problem).toBeNull();
  });

  it('那一層被刪了、或變成不能有變身圖（衝出卡片）→ layer-gone、卡不變', () => {
    const s0 = setup();
    expect(setLayerAlt(deleteLayer(s0, 'hero', T1), 'hero', ALT, T1).problem).toBe('layer-gone');
    const breakout = editLayer(s0, 'hero', { breakout: true }, 'commit', T1);
    expect(setLayerAlt(breakout, 'hero', ALT, T1).problem).toBe('layer-gone');
    expect(setLayerAlt(s0, 'title', ALT, T1).problem).toBe('layer-gone');
  });

  it('這張卡已經 16 張圖 → too-many-images', () => {
    let s = createEditor(newCard('standard', 'card-2', T0));
    for (let i = 0; i < 8; i++) s = addUploadedLayer(s, 'front', input(`f${i}`, true, `${'0'.repeat(15)}${i.toString(16)}`), 'f.png', T0).state;
    for (let i = 0; i < 8; i++) s = addUploadedLayer(s, 'back', input(`k${i}`, true, `${'1'.repeat(15)}${i.toString(16)}`), 'k.png', T0).state;
    expect(setLayerAlt(s, 'f0', ALT, T1).problem).toBe('too-many-images');
  });
});

describe('右欄〔自動去背〕換圖（T-703b）的空間計算也算變身圖', () => {
  it('換掉本來的圖時變身圖還在：舊圖還有別層在用、加上變身圖已經 16 張 → too-many-images', () => {
    let s = createEditor(newCard('standard', 'card-3', T0));
    const shared = `${'0'.repeat(15)}0`;
    s = addUploadedLayer(s, 'front', input('f0', true, shared), 'f.png', T0).state;
    s = addUploadedLayer(s, 'front', input('f1', true, shared), 'f.png', T0).state;
    for (let i = 2; i < 8; i++) s = addUploadedLayer(s, 'front', input(`f${i}`, true, `${'0'.repeat(15)}${i.toString(16)}`), 'f.png', T0).state;
    for (let i = 0; i < 8; i++) s = addUploadedLayer(s, 'back', input(`k${i}`, true, `${'1'.repeat(15)}${i.toString(16)}`), 'k.png', T0).state;
    s = setLayerAlt(s, 'f0', ALT, T1).state;
    const card = currentCard(s);
    expect(cardImages(card)).toHaveLength(16);
    expect(replaceRoom(card, 'front', 'f0')).toBe('too-many-images');
    expect(replaceCutoutInCard(card, 'front', 'f0', shared, { image: 'bbbbbbbbbbbbbbb1', hasAlpha: true })).toEqual({ problem: 'too-many-images' });
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

function mount() {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const root = inspector.el as unknown as FakeElement;
  // T-840：測效果本身前先展開預設收起的進階效果。
  all(root, 'section-toggle').find((b) => b.getAttribute('aria-controls') === 'section-layer-advanced')!.click();
  const render = (s: EditorState) => inspector.render(toUiState(s, (h) => `blob:${h}`) as UiState);
  const block = () => byClass(root, 'alt-block');
  const fileInput = () => byClass(block(), 'alt-file');
  /** 選檔：模擬檔案選擇視窗選了一個檔（change 事件）。 */
  const pick = (name: string) => {
    const file = { name } as File;
    fileInput().files = [file];
    fileInput().dispatchEvent(new FakeEvent('change'));
    return file;
  };
  return { root, calls, render, block, fileInput, pick };
}

describe('右欄「變身圖」小節', () => {
  it('選中立體層、還沒有變身圖：小節名＋〔加上變身圖〕（原生按鈕）；沒有縮圖、〔換一張〕〔拿掉〕', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'hero'));
    expect(isShown(t.block())).toBe(true);
    expect(t.block().textContent).toContain(ALT_TITLE);
    const add = buttonWithText(t.block(), ALT_ADD_LABEL);
    expect(add.tagName).toBe('BUTTON');
    expect(isShown(add)).toBe(true);
    expect(isShown(byClass(t.block(), 'alt-row'))).toBe(false);
  });

  it('底圖、文字層：沒有這個小節', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'bg'));
    expect(isShown(t.block())).toBe(false);
    t.render(selectLayer(setup(), 'title'));
    expect(isShown(t.block())).toBe(false);
  });

  it('〔加上變身圖〕→ 打開選檔視窗；選了檔 → uploadLayerAlt(這層, 檔)；沒選（取消）不做事', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'hero'));
    let opened = 0;
    t.fileInput().addEventListener('click', () => opened++);
    buttonWithText(t.block(), ALT_ADD_LABEL).click();
    expect(opened).toBe(1);
    const file = t.pick('battle.png');
    expect(t.calls).toEqual([{ name: 'uploadLayerAlt', args: ['hero', file, 'card-1'] }]);
    t.calls.length = 0;
    t.fileInput().files = [];
    t.fileInput().dispatchEvent(new FakeEvent('change'));
    expect(t.calls).toEqual([]);
  });

  it('選檔視窗開著時改選了別層：圖還是加到按下去的那一層', () => {
    const t = mount();
    const s = setup();
    t.render(selectLayer(s, 'hero'));
    buttonWithText(t.block(), ALT_ADD_LABEL).click();
    t.render(selectLayer(s, 'ink'));
    const file = t.pick('battle.png');
    expect(t.calls).toEqual([{ name: 'uploadLayerAlt', args: ['hero', file, 'card-1'] }]);
  });

  it('選檔視窗開著時換了卡：回報的是按下去時那張卡的 id（main 對不上就不加，T-805 審查）', () => {
    const t = mount();
    const s = setup();
    t.render(selectLayer(s, 'hero'));
    buttonWithText(t.block(), ALT_ADD_LABEL).click();
    const other = createEditor({ ...newCard('standard', 'card-2', T0), front: currentCard(s).front });
    t.render(selectLayer(other, 'hero'));
    const file = t.pick('battle.png');
    expect(t.calls).toEqual([{ name: 'uploadLayerAlt', args: ['hero', file, 'card-1'] }]);
  });

  it('選檔回來還算不算數（pickStillValid）：交出編輯權了、或已經換到別張卡 → 不算（T-805 審查）', () => {
    expect(pickStillValid({ holding: true, openCardId: 'card-1', pickedCardId: 'card-1' })).toBe(true);
    expect(pickStillValid({ holding: false, openCardId: 'card-1', pickedCardId: 'card-1' })).toBe(false);
    expect(pickStillValid({ holding: true, openCardId: 'card-2', pickedCardId: 'card-1' })).toBe(false);
    expect(pickStillValid({ holding: true, openCardId: null, pickedCardId: 'card-1' })).toBe(false);
  });

  it('有變身圖：小縮圖（變身圖的網址）＋〔換一張〕〔拿掉〕＋說明句；〔加上變身圖〕藏起來', () => {
    const t = mount();
    t.render(setLayerAlt(selectLayer(setup(), 'hero'), 'hero', ALT, T1).state);
    expect(isShown(byClass(t.block(), 'alt-row'))).toBe(true);
    expect(byClass(t.block(), 'alt-thumb').getAttribute('src')).toBe(`blob:${ALT.image}`);
    expect(isShown(buttonWithText(t.block(), ALT_CHANGE_LABEL))).toBe(true);
    expect(isShown(buttonWithText(t.block(), ALT_REMOVE_LABEL))).toBe(true);
    expect(isShown(buttonWithText(t.block(), ALT_ADD_LABEL))).toBe(false);
    const help = all(t.block(), 'help').find((el) => el.textContent === ALT_HELP)!;
    expect(isShown(help)).toBe(true);
  });

  it('〔拿掉〕→ editLayer(這層, { alt: null }, commit)；〔換一張〕→ 選檔 → uploadLayerAlt', () => {
    const t = mount();
    t.render(setLayerAlt(selectLayer(setup(), 'hero'), 'hero', ALT, T1).state);
    buttonWithText(t.block(), ALT_REMOVE_LABEL).click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { alt: null }, 'commit'] }]);
    t.calls.length = 0;
    let opened = 0;
    t.fileInput().addEventListener('click', () => opened++);
    buttonWithText(t.block(), ALT_CHANGE_LABEL).click();
    expect(opened).toBe(1);
    const file = t.pick('battle2.png');
    expect(t.calls).toEqual([{ name: 'uploadLayerAlt', args: ['hero', file, 'card-1'] }]);
  });

  it('衝出卡片的層：小節變淡、按鈕 aria-disabled、滑過說明；按了不改', () => {
    const t = mount();
    t.render(editLayer(selectLayer(setup(), 'hero'), 'hero', { breakout: true }, 'commit', T1));
    expect(t.block().classList.contains('is-locked')).toBe(true);
    expect(t.block().title).toBe(ALT_BREAKOUT_TEXT);
    const add = buttonWithText(t.block(), ALT_ADD_LABEL);
    expect(add.getAttribute('aria-disabled')).toBe('true');
    let opened = 0;
    t.fileInput().addEventListener('click', () => opened++);
    add.click();
    expect(opened).toBe(0);
    expect(t.calls).toEqual([]);
  });

  it('有變身圖的層：「衝出卡片」開關變淡、按了不改、滑過說明；拿掉變身圖後恢復', () => {
    const t = mount();
    const s = setLayerAlt(selectLayer(setup(), 'hero'), 'hero', ALT, T1).state;
    t.render(s);
    const block = byClass(t.root, 'breakout-block');
    const sw = byClass(block, 'switch');
    expect(block.classList.contains('is-locked')).toBe(true);
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(sw.title).toBe(BREAKOUT_ALT_TEXT);
    sw.click();
    expect(t.calls).toEqual([]);
    t.render(editLayer(s, 'hero', { alt: null }, 'commit', T1));
    expect(block.classList.contains('is-locked')).toBe(false);
    expect(sw.getAttribute('aria-disabled')).toBeNull();
    sw.click();
    expect(t.calls).toEqual([{ name: 'editLayer', args: ['hero', { breakout: true }, 'commit'] }]);
  });

  it('位置：「只畫在下面那層上」的下一塊（混合模式之前）', () => {
    const t = mount();
    t.render(selectLayer(setup(), 'hero'));
    const clip = byClass(t.root, 'clip-block');
    const siblings = clip.parentNode!.children;
    expect(siblings.indexOf(t.block())).toBe(siblings.indexOf(clip) + 1);
  });
});

describe('左欄：有變身圖的層縮圖角落「雙」', () => {
  it('有＝顯示「雙」（textContent）；拿掉＝藏起來', () => {
    const { intents } = recorder();
    const p = createLayerPanel(intents);
    const root = p.el as unknown as FakeElement;
    const row = (id: string) => all(root, 'layer-row').find((r) => byClass(r, 'layer-name').value === id)!;
    const s = setLayerAlt(setup(), 'hero', ALT, T1).state;
    p.render(toUiState(s, () => undefined));
    const tag = byClass(row('hero'), 'layer-alt-tag');
    expect(isShown(tag)).toBe(true);
    expect(tag.textContent).toBe(ALT_TAG);
    expect(isShown(byClass(row('ink'), 'layer-alt-tag'))).toBe(false);
    p.render(toUiState(editLayer(s, 'hero', { alt: null }, 'commit', T1), () => undefined));
    expect(isShown(byClass(row('hero'), 'layer-alt-tag'))).toBe(false);
  });
});
