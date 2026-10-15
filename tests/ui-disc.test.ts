// T-810 CD 光碟的畫面（DESIGN「CD 光碟」）：
// 新卡片面板「空白卡」多〔光碟〕（CSS 畫的圓形、中間有孔）；左欄「背面」分頁灰掉＋說明（按了清單不換面，卡片照樣翻過去）；
// 右欄比例、圓角、卡框（含雕花）、透明卡套不顯示；說明面板多一句。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard, newDisc } from '../src/model/create';
import type { Card } from '../src/model/types';
import { createEditor, selectFace, selectLayer, showFace, toUiState, addUploadedLayer, currentCard } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { createLayerPanel } from '../src/ui/layer-list';
import { DISC_BACK_TITLE, DISC_CHOICE, HELP_SECTIONS, SLEEVE_LABEL } from '../src/ui/logic';
import { createNewCardPanel, type NewCardHooks } from '../src/ui/new-card';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeElement, installFakeDom, isShown } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T00:01:00.000Z';
const disc = (): Card => newDisc('d1', T0);
const card = (): Card => newCard('square', 'c1', T0);

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      return undefined;
    },
  });
  return { intents, calls };
}

beforeEach(() => {
  installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('文字照 DESIGN', () => {
  it('〔光碟〕、背面分頁的說明、說明面板「卡片外觀」多一句', () => {
    expect(DISC_CHOICE.name).toBe('光碟');
    expect(DISC_BACK_TITLE).toBe('光碟背面是資料面，不放圖');
    expect(HELP_SECTIONS.find((s) => s.title === '卡片外觀')!.lines).toContain('新卡片可以選〔光碟〕：圓形印刷面放圖，背面是會轉的彩虹資料面。');
  });
});

describe('新卡片面板：空白卡多〔光碟〕', () => {
  function setup() {
    const made: string[] = [];
    const hooks: NewCardHooks = {
      blank: (aspect) => made.push(aspect),
      disc: () => made.push('disc'),
      sample: () => {},
      preview: async () => null,
      changed: () => {},
      libraryCards: async () => [],
      openCard: () => {},
    };
    const panel = createNewCardPanel(hooks);
    const el = panel.el as unknown as FakeElement;
    return { panel, el, made };
  }

  it('空白卡最後一個是〔光碟〕：名字、說明、CSS 畫的圓形外形（中間有孔，不是圖檔）', () => {
    const t = setup();
    const blanks = all(t.el, 'nc-blank-opt');
    const last = blanks.at(-1)!;
    expect(byClass(last, 'nc-name').textContent).toBe('光碟');
    expect(byClass(last, 'nc-detail').textContent).toBe(DISC_CHOICE.detail);
    const art = byClass(last, 'nc-art');
    expect(art.classList.contains('nc-disc')).toBe(true);
    expect(all(art, 'nc-disc-hole')).toHaveLength(1);
    expect(last.querySelector('img')).toBe(null);
  });

  it('點〔光碟〕＝關掉面板、建立光碟（hooks.disc）', () => {
    const t = setup();
    t.panel.open('blank');
    all(t.el, 'nc-blank-opt').at(-1)!.click();
    expect(t.made).toEqual(['disc']);
    expect(t.panel.isOpen()).toBe(false);
  });
});

describe('編輯器：光碟的左欄一直是正面', () => {
  it('選背面：清單不換面（還是正面）；Home／F 的換面也一樣，照樣取消選中', () => {
    const s = createEditor(disc());
    expect(selectFace(s, 'back')).toBe(s);
    const up = addUploadedLayer(s, 'front', { id: 'a', name: 'a', image: '000000000000000a', hasAlpha: true, width: 100, height: 100 }, 'a.png', T1).state;
    expect(up.selectedLayerId).toBe('a');
    const shown = showFace(up, 'back');
    expect(shown.face).toBe('front');
    expect(shown.selectedLayerId).toBe(null);
  });

  it('卡片照舊可以換到背面', () => {
    expect(selectFace(createEditor(card()), 'back').face).toBe('back');
  });

  it('從背面換到光碟（換卡）也一定是正面', () => {
    // createEditor 一律從正面開始；選圖層也只會選到正面的
    const s = selectLayer(createEditor(disc()), 'nope');
    expect(s.face).toBe('front');
    expect(currentCard(s).kind).toBe('disc');
  });
});

describe('左欄：光碟的「背面」分頁灰掉', () => {
  function setup(c: Card) {
    const { intents, calls } = recorder();
    const p = createLayerPanel(intents);
    p.render(toUiState(createEditor(c), () => undefined));
    const root = p.el as unknown as FakeElement;
    const tabs = all(root, 'seg-btn');
    return { p, root, tabs, calls };
  }

  it('光碟：背面分頁 aria-disabled、滑過說明「光碟背面是資料面，不放圖」、加了灰掉的樣式；正面分頁照常', () => {
    const t = setup(disc());
    const [front, back] = t.tabs as [FakeElement, FakeElement];
    expect(back.getAttribute('aria-disabled')).toBe('true');
    expect(back.title).toBe(DISC_BACK_TITLE);
    expect(back.classList.contains('is-locked')).toBe(true);
    expect(front.getAttribute('aria-disabled')).toBe(null);
    expect(front.getAttribute('aria-checked')).toBe('true');
  });

  it('按了照樣送 selectFace（main 把卡片翻過去；編輯器的清單不換面）', () => {
    const t = setup(disc());
    t.tabs[1]!.click();
    expect(t.calls.filter((c) => c.name === 'selectFace').map((c) => c.args)).toEqual([['back']]);
  });

  it('卡片：背面分頁照常（沒有 aria-disabled、沒有說明）；從光碟換回卡片也恢復', () => {
    const t = setup(card());
    expect(t.tabs[1]!.getAttribute('aria-disabled')).toBe(null);
    expect(t.tabs[1]!.title).toBe('');
    t.p.render(toUiState(createEditor(disc()), () => undefined));
    t.p.render(toUiState(createEditor(card()), () => undefined));
    expect(t.tabs[1]!.getAttribute('aria-disabled')).toBe(null);
    expect(t.tabs[1]!.classList.contains('is-locked')).toBe(false);
    expect(t.tabs[1]!.title).toBe('');
  });
});

describe('右欄：比例、圓角、卡框（含雕花）、透明卡套對光碟不顯示', () => {
  function setup(c: Card) {
    const { intents } = recorder();
    const inspector = createInspector(intents);
    const render = (x: Card) => inspector.render(toUiState(createEditor(x), (h) => `blob:${h}`));
    render(c);
    const root = inspector.el as unknown as FakeElement;
    const parts = () => ({
      aspect: isShown(byClass(root, 'aspect-picker')),
      corner: isShown(byClass(root, 'corner-field')),
      frame: isShown(byClass(root, 'frame-group')),
      ornate: isShown(byClass(root, 'frame-styles')),
      sleeve: isShown(all(root, 'switch').find((b) => b.getAttribute('aria-label') === SLEEVE_LABEL)!),
      holo: isShown(byClass(root, 'holo-detail')),
    });
    return { render, parts };
  }

  it('光碟：五個小節都藏起來，鐳射等其他照舊', () => {
    const t = setup(disc());
    expect(t.parts()).toEqual({ aspect: false, corner: false, frame: false, ornate: false, sleeve: false, holo: true });
  });

  it('卡片：都顯示；從光碟換回卡片也恢復', () => {
    const t = setup(card());
    expect(t.parts()).toEqual({ aspect: true, corner: true, frame: true, ornate: true, sleeve: true, holo: true });
    t.render(disc());
    t.render(card());
    expect(t.parts()).toEqual({ aspect: true, corner: true, frame: true, ornate: true, sleeve: true, holo: true });
  });
});
