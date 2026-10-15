// 右欄「卡片」最上面的一鍵風格（T-801）：六顆小按鈕（色票縮圖＋名字）、一按套一組設定、記一步、提示列、選中標示、鍵盤。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { applyCardStyle, CARD_STYLES, CARD_STYLE_VALUES, matchCardStyle } from '../src/model/styles';
import { HOLO_PALETTES } from '../src/model/types';
import { applyStyleEdit, createEditor, currentCard, editCard, redoEdit, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { CARD_STYLE_OPTIONS, HELP_SECTIONS, paletteGradient, styleAppliedText, styleSwatch } from '../src/ui/logic';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, installFakeDom, keydown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

const ui = (s: EditorState) => toUiState(s, (h) => `blob:${h}`);

beforeEach(() => {
  installFakeDom();
  // 色彩選擇器在 document 上聽點外面收起（極簡 DOM 沒有，這裡補空的）
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(card = newCard('standard', 'c1', T0)) {
  const { intents, calls } = recorder();
  const inspector = createInspector(intents);
  const s = createEditor(card);
  inspector.render(ui(s));
  const root = inspector.el as unknown as FakeElement;
  return { inspector, root, calls, s };
}

function group(root: FakeElement): FakeElement {
  const g = all(root, 'card-styles').find((el) => el.getAttribute('aria-label') === '卡片風格');
  if (!g) throw new Error('找不到卡片風格');
  return g;
}
const buttons = (root: FakeElement) => group(root).querySelectorAll('button');
const pressed = (root: FakeElement) => buttons(root).map((b) => b.getAttribute('aria-pressed'));

const NAMES = ['普通', '銀箔', '彩虹箔', '金箔', '銀河', '霧面'];

describe('風格按鈕：長相', () => {
  it('六顆：普通／銀箔／彩虹箔／金箔／銀河／霧面（依序）；每顆是一個色票縮圖＋名字', () => {
    const { root } = setup();
    expect(buttons(root).map((b) => b.textContent)).toEqual(NAMES);
    expect(CARD_STYLE_OPTIONS.map((o) => o.name)).toEqual(NAMES);
    expect(CARD_STYLE_OPTIONS.map((o) => o.value)).toEqual([...CARD_STYLES]);
    for (const b of buttons(root)) expect(all(b, 'card-style-swatch')).toHaveLength(1);
  });

  it('在「卡片」區塊的最上面（比例、卡身顏色之前），標題「風格」', () => {
    const { root } = setup();
    let section: FakeElement | null = group(root);
    while (section && section.tagName !== 'SECTION') section = section.parentNode;
    expect(section).not.toBeNull();
    expect(byClass(section!, 'panel-title').textContent).toBe('卡片');
    const body = byClass(section!, 'panel-body');
    expect(body.children[0]!.textContent).toContain('風格');
    expect(body.children[0]!.contains(group(root))).toBe(true);
    expect(body.children[1]!.textContent).toContain('比例');
  });

  it('排成 3×2 的格子（CSS 三欄）；一組有名字（朗讀用）、是 toolbar，不是 radiogroup', () => {
    const { root } = setup();
    expect(group(root).getAttribute('role')).toBe('toolbar');
    expect(group(root).getAttribute('aria-label')).toBe('卡片風格');
    for (const b of buttons(root)) expect(b.getAttribute('role')).not.toBe('radio');
  });

  it('每顆有一句白話說明（title），銀箔照規格', () => {
    const { root } = setup();
    const titles = buttons(root).map((b) => b.title);
    for (const t of titles) expect(t.length).toBeGreaterThan(4);
    expect(new Set(titles).size).toBe(6);
    expect(titles[1]).toBe('銀色金屬箔，光帶細、閃星少');
  });

  it('色票縮圖用 CSS 漸層畫（不用圖檔）：顏色從鐳射色彩取；普通＝素色灰、霧面＝淡白', () => {
    const { root } = setup();
    const swatch = (i: number) => byClass(buttons(root)[i]!, 'card-style-swatch').style.getPropertyValue('--swatch');
    for (const i of [1, 2, 3, 4]) {
      const v = CARD_STYLE_VALUES[CARD_STYLES[i]!];
      const css = swatch(i);
      expect(css).toContain('linear-gradient');
      // 斜的（不是 90deg 的橫條）
      expect(css).toMatch(/linear-gradient\((?!90deg)\d+deg/);
      for (const color of HOLO_PALETTES[v.palette!]) expect(css).toContain(color);
    }
    expect(swatch(0)).not.toBe('');
    expect(swatch(5)).not.toBe('');
    expect(styleSwatch('plain')).toMatch(/^linear-gradient\(135deg, (#[0-9a-f]{6}), \1\)$/); // 同一個灰色＝素色
    expect(styleSwatch('matte')).toContain('#ffffff');
    for (const css of CARD_STYLES.map(styleSwatch)) {
      expect(css).not.toContain('url(');
      expect(css).not.toContain('<');
    }
  });

  it('paletteGradient 預設還是橫的 90deg（色彩選項的色條不變），可以指定角度', () => {
    expect(paletteGradient(['#111111', '#222222'])).toContain('linear-gradient(90deg,');
    expect(paletteGradient(['#111111', '#222222'], 135)).toContain('linear-gradient(135deg,');
  });

  it('按鈕是原生 button（type=button），文字用 textContent', () => {
    const { root } = setup();
    for (const b of buttons(root)) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
    }
  });
});

describe('風格按鈕：按下去', () => {
  it('每顆送一次 applyStyle(那個風格)；不送 editCard（一整組由組裝端一次記一步）', () => {
    const { root, calls } = setup();
    buttons(root).forEach((b) => b.click());
    expect(calls.map((c) => [c.name, ...c.args])).toEqual(CARD_STYLES.map((s) => ['applyStyle', s]));
  });
});

describe('風格按鈕：選中標示', () => {
  it('新卡（預設設定）都不選中：aria-pressed 全是 false', () => {
    const { root } = setup();
    expect(pressed(root)).toEqual(Array(6).fill('false'));
    expect(buttons(root).some((b) => b.classList.contains('is-selected'))).toBe(false);
  });

  it('設定剛好等於某個風格，那顆 aria-pressed=true（也亮起來）；換風格跟著換', () => {
    const { inspector, root, s } = setup();
    CARD_STYLES.forEach((style, i) => {
      inspector.render(ui(applyStyleEdit(s, style, T1)));
      expect(pressed(root)).toEqual(CARD_STYLES.map((_, j) => String(j === i)));
      expect(buttons(root).map((b) => b.classList.contains('is-selected'))).toEqual(CARD_STYLES.map((_, j) => j === i));
    });
  });

  it('微調過就都不選中；拉回原值又選中', () => {
    const { inspector, root, s } = setup();
    const s1 = applyStyleEdit(s, 'gold', T1);
    inspector.render(ui(s1));
    expect(pressed(root)[3]).toBe('true');
    const s2 = editCard(s1, { holo: { strength: 71 } }, 'commit', T2);
    inspector.render(ui(s2));
    expect(pressed(root)).toEqual(Array(6).fill('false'));
    inspector.render(ui(editCard(s2, { holo: { strength: 70 } }, 'commit', T2)));
    expect(pressed(root)[3]).toBe('true');
  });

  it('拖滑桿的途中（preview）就已經不選中', () => {
    const { inspector, root, s } = setup();
    const s1 = applyStyleEdit(s, 'galaxy', T1);
    inspector.render(ui(editCard(s1, { holo: { sparkle: 10 } }, 'preview', T2)));
    expect(pressed(root)).toEqual(Array(6).fill('false'));
  });
});

describe('風格按鈕：鍵盤', () => {
  it('六顆都是一般按鈕：每顆都在 Tab 順序裡（tabIndex 0），不是只有選中的那顆', () => {
    const { inspector, root, s } = setup();
    expect(buttons(root).map((b) => b.tabIndex)).toEqual(Array(6).fill(0));
    inspector.render(ui(applyStyleEdit(s, 'silver', T1)));
    expect(buttons(root).map((b) => b.tabIndex)).toEqual(Array(6).fill(0));
  });

  it('Enter、空白鍵、方向鍵都不被攔（原生按鈕自己處理 Enter／空白＝click）', () => {
    const { root } = setup();
    const b = buttons(root)[2]!;
    for (const key of ['Enter', ' ', 'ArrowRight', 'ArrowDown']) expect(keydown(b, key).defaultPrevented).toBe(false);
  });

  it('按下去之後焦點還在那顆按鈕上（畫面更新不重建按鈕）', () => {
    const { inspector, root, s } = setup();
    const b = buttons(root)[1]!;
    b.focus();
    b.click();
    inspector.render(ui(applyStyleEdit(s, 'silver', T1)));
    expect(buttons(root)[1]).toBe(b);
    expect((document as unknown as { activeElement: FakeElement }).activeElement).toBe(b);
  });
});

describe('套用風格：記一步、提示列', () => {
  it('套完卡片就是那個風格的設定', () => {
    const s = createEditor(newCard('standard', 'c1', T0));
    for (const style of CARD_STYLES) {
      const next = applyStyleEdit(s, style, T1);
      expect(currentCard(next)).toEqual({ ...applyCardStyle(currentCard(s), style), updatedAt: T1 });
      expect(matchCardStyle(currentCard(next))).toBe(style);
    }
  });

  it('一次整組記成一步：Ctrl+Z 一次整組還原、重做一次整組回來', () => {
    const s0 = createEditor(newCard('standard', 'c1', T0));
    const before = currentCard(s0);
    const s1 = applyStyleEdit(s0, 'silver', T1);
    expect(s1.history.past).toHaveLength(1);
    expect(currentCard(s1)).not.toBe(before);
    const s2 = undoEdit(s1);
    expect(currentCard(s2)).toBe(before);
    expect(s2.history.future).toHaveLength(1);
    expect(currentCard(redoEdit(s2))).toBe(currentCard(s1));
  });

  it('連按兩種風格＝兩步；一路復原回到最初', () => {
    const s0 = createEditor(newCard('standard', 'c1', T0));
    const s2 = applyStyleEdit(applyStyleEdit(s0, 'gold', T1), 'galaxy', T2);
    expect(s2.history.past).toHaveLength(2);
    expect(matchCardStyle(currentCard(undoEdit(s2)))).toBe('gold');
    expect(currentCard(undoEdit(undoEdit(s2)))).toBe(currentCard(s0));
  });

  it('已經是這個風格再按一次：卡片沒變、不多記一步', () => {
    const s1 = applyStyleEdit(createEditor(newCard('standard', 'c1', T0)), 'gold', T1);
    const s2 = applyStyleEdit(s1, 'gold', T2);
    expect(currentCard(s2)).toBe(currentCard(s1));
    expect(s2.history.past).toHaveLength(1);
  });

  it('更新「最後編輯時間」', () => {
    const s1 = applyStyleEdit(createEditor(newCard('standard', 'c1', T0)), 'matte', T1);
    expect(currentCard(s1).updatedAt).toBe(T1);
  });

  it('滑桿拖到一半時按風格：先把拖曳記成一步，再套風格（共兩步）', () => {
    const s0 = createEditor(newCard('standard', 'c1', T0));
    const dragging = editCard(s0, { holo: { sparkle: 5 } }, 'preview', T1);
    const s1 = applyStyleEdit(dragging, 'silver', T2);
    expect(s1.history.previewBase).toBeNull();
    expect(s1.history.past).toHaveLength(2);
    expect(currentCard(undoEdit(s1)).holo.sparkle).toBe(5);
  });

  it('提示列：「套用了「銀箔」風格，可以再微調。」（info）', () => {
    const s1 = applyStyleEdit(createEditor(newCard('standard', 'c1', T0)), 'silver', T1);
    expect(s1.message).toEqual({ kind: 'info', text: '套用了「銀箔」風格，可以再微調。' });
    expect(styleAppliedText('silver')).toBe('套用了「銀箔」風格，可以再微調。');
    const names = CARD_STYLES.map((s) => styleAppliedText(s));
    expect(names).toEqual(NAMES.map((n) => `套用了「${n}」風格，可以再微調。`));
  });

  it('提示列跟著畫面狀態送出去（UiState.message）', () => {
    const s1 = applyStyleEdit(createEditor(newCard('standard', 'c1', T0)), 'galaxy', T1);
    expect(ui(s1).message?.text).toBe('套用了「銀河」風格，可以再微調。');
  });

  it('選中的圖層、目前這一面都不動', () => {
    const s0 = { ...createEditor(newCard('standard', 'c1', T0)), face: 'back' as const };
    const s1 = applyStyleEdit(s0, 'gold', T1);
    expect(s1.face).toBe('back');
    expect(s1.selectedLayerId).toBe(s0.selectedLayerId);
  });

  it('微調過的卡（其他欄位都不是預設）：不動的欄位照舊', () => {
    const tuned = updateCard(newCard('standard', 'c1', T0), { bodyColor: '#5c1f2e', frame: { enabled: true, style: 'ornate' }, view: { stage: 'water' } });
    const out = currentCard(applyStyleEdit(createEditor(tuned), 'silver', T1));
    expect(out.bodyColor).toBe('#5c1f2e');
    expect(out.frame.enabled).toBe(true);
    expect(out.frame.style).toBe('ornate');
    expect(out.view.stage).toBe('water');
  });
});

describe('說明面板與沒有 innerHTML', () => {
  it('說明面板的「卡片外觀」段多一句：不知道怎麼調？先按右欄最上面的風格，再微調。', () => {
    const section = HELP_SECTIONS.find((s) => s.title === '卡片外觀')!;
    expect(section.lines).toContain('不知道怎麼調？先按右欄最上面的風格，再微調。');
  });

  it('新增的畫面檔不用 innerHTML', () => {
    for (const file of ['../src/ui/style-picker.ts', '../src/model/styles.ts']) {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });
});

