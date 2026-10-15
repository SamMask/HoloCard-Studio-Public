// T-833 圖層列多顯示資訊（DESIGN §5「圖層清單」的「多顯示資訊」）：
// 每一列第三行「{混合模式}・不透明度 {N}%」；底圖、反光層不顯示；改了混合模式或不透明度，那一列馬上更新；四種語言都有格式、放得下（CSS）。
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { BLEND_MODES, type Layer } from '../src/model/types';
import { addUploadedLayer, createEditor, editLayer, selectLayer, toUiState, type EditorState } from '../src/ui/editor';
import { createLayerPanel } from '../src/ui/layer-list';
import { BLEND_OPTIONS, layerLookText } from '../src/ui/logic';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T01:00:00.000Z';

const input = (id: string, hasAlpha = true): NewLayerInput => ({ id, name: id, image: '0123456789abcdef', width: 1000, height: 1000, hasAlpha });

/** 正面：底圖 bg、立體層 hero、立體層 dragon（清單由前到後：dragon、hero、bg）。 */
function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero'), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('dragon'), 'dragon.png', T0).state;
  return selectLayer(s, null);
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

describe('layerLookText：第三行的字', () => {
  it('立體層：{混合模式白話名}・不透明度 {N}%（省略＝正常、100%）', () => {
    expect(layerLookText(depth())).toBe('正常・不透明度 100%');
    expect(layerLookText(depth({ blend: 'normal', opacity: 100 }))).toBe('正常・不透明度 100%');
    expect(layerLookText(depth({ blend: 'screen', opacity: 80 }))).toBe('發光・不透明度 80%');
    expect(layerLookText(depth({ blend: 'multiply', opacity: 35 }))).toBe('加深・不透明度 35%');
    expect(layerLookText(depth({ blend: 'soft-light', opacity: 0 }))).toBe('柔光・不透明度 0%');
  });

  it('不透明度四捨五入成整數', () => {
    expect(layerLookText(depth({ opacity: 62.4 }))).toBe('正常・不透明度 62%');
    expect(layerLookText(depth({ opacity: 99.6 }))).toBe('正常・不透明度 100%');
  });

  it('混合模式名字就是縮圖角落那一個（字典裡的白話名，不是 Photoshop 原名）', () => {
    for (const mode of BLEND_MODES) {
      const name = BLEND_OPTIONS.find((o) => o.value === mode)!.name;
      expect(layerLookText(depth({ blend: mode, opacity: 50 }))).toBe(`${name}・不透明度 50%`);
    }
  });

  it('文字圖層（也是立體層）照樣顯示；底圖沒有第三行（null）', () => {
    expect(layerLookText(depth({ text: { content: '字' } as unknown as Layer['text'], blend: 'add', opacity: 70 }))).toBe('強光・不透明度 70%');
    expect(layerLookText(depth({ role: 'base', depth: 0, hasAlpha: false }))).toBeNull();
  });
});

describe('四種語言的第三行格式', () => {
  it('每種語言都有格式函式，混合模式名與數字都在裡面', () => {
    for (const [lang, dict] of [['zh', zhHant], ['en', en], ['ja', ja], ['ko', ko]] as const) {
      const text = dict.layers.blendLine('MODE', 80);
      expect(text, lang).toContain('MODE');
      expect(text, lang).toContain('80%');
    }
  });

  it('數字前面是各語言的「不透明度」（和右欄滑桿標題同一個字）', () => {
    for (const dict of [zhHant, en, ja, ko]) expect(dict.layers.blendLine('X', 5)).toContain(dict.inspector.opacity);
  });

  it('英文沒有中日韓字；中文格式照規格', () => {
    expect(en.layers.blendLine('Glow', 80)).toBe('Glow · Opacity 80%');
    expect(zhHant.layers.blendLine('發光', 80)).toBe('發光・不透明度 80%');
  });
});

describe('圖層清單：每一列第三行', () => {
  let dom: ReturnType<typeof installFakeDom>;
  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function panel(s: EditorState = setup()) {
    const intents = new Proxy({} as UiIntents, { get: () => () => undefined });
    const p = createLayerPanel(intents);
    p.render(toUiState(s, () => undefined));
    const root = p.el as unknown as FakeElement;
    const rowOf = (name: string) => all(root, 'layer-row').find((r) => byClass(r, 'layer-name').value === name)!;
    return { root, rowOf, render: (next: EditorState) => p.render(toUiState(next, () => undefined)) };
  }

  it('立體層：顯示「正常・不透明度 100%」；第二行（深度）照舊', () => {
    const { rowOf } = panel();
    const row = rowOf('hero');
    const look = byClass(row, 'layer-look');
    expect(look.textContent).toBe('正常・不透明度 100%');
    expect(isShown(look)).toBe(true);
    expect(byClass(row, 'layer-sub').textContent).toMatch(/^深度 /);
    // 第三行是列的子元素（跨欄排在最下面），這一列的縮圖跨兩行（CSS 的 .has-look）
    expect(look.parentNode).toBe(row);
    expect(row.classList.contains('has-look')).toBe(true);
  });

  it('底圖：第二行寫「底圖」，沒有第三行（藏起來、沒有字）', () => {
    const { rowOf } = panel();
    const row = rowOf('bg');
    expect(byClass(row, 'layer-sub').textContent).toBe('底圖');
    const look = byClass(row, 'layer-look');
    expect(isShown(look)).toBe(false);
    expect(look.textContent).toBe('');
    expect(row.classList.contains('has-look')).toBe(false);
  });

  it('反光層那一列沒有第三行', () => {
    const { root } = panel();
    expect(all(byClass(root, 'foil-row'), 'layer-look')).toHaveLength(0);
  });

  it('改了混合模式或不透明度，那一列馬上更新；別列不動', () => {
    const { rowOf, render } = panel();
    let s = setup();
    s = editLayer(s, 'hero', { blend: 'screen' }, 'commit', T1);
    s = editLayer(s, 'hero', { opacity: 80 }, 'commit', T1);
    render(s);
    expect(byClass(rowOf('hero'), 'layer-look').textContent).toBe('發光・不透明度 80%');
    expect(byClass(rowOf('dragon'), 'layer-look').textContent).toBe('正常・不透明度 100%');
    // 拖滑桿中的預覽也跟著變
    s = editLayer(s, 'hero', { opacity: 35 }, 'preview', T1);
    render(s);
    expect(byClass(rowOf('hero'), 'layer-look').textContent).toBe('發光・不透明度 35%');
    void dom;
  });
});

describe('style.css：第三行的樣子（T-833）', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1]!.split(',').map((s) => s.trim()).includes(selector)) continue;
      for (const d of m[2]!.split(';')) {
        const i = d.indexOf(':');
        if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).replace(/\s+/g, ' ').trim());
      }
    }
    return out;
  };

  it('字比第二行小一級、淡色（走 :root 的變數）', () => {
    const look = rule('.layer-look');
    const sub = rule('.layer-sub');
    expect(look.size, 'style.css 找不到 .layer-look').toBeGreaterThan(0);
    expect(parseInt(look.get('font-size') ?? '99', 10)).toBeLessThan(parseInt(sub.get('font-size') ?? '0', 10));
    expect(look.get('color')).toMatch(/var\(--/);
  });

  it('放不下就換行，不截字（數字不能被「…」吃掉）', () => {
    const look = rule('.layer-look');
    expect(look.get('text-overflow')).not.toBe('ellipsis');
    expect(look.get('white-space')).not.toBe('nowrap');
  });

  it('名字欄只有約 84px：第三行跨過名字欄與按鈕欄（最後兩欄）排在整列最下面，縮圖跨兩行', () => {
    expect(rule('.layer-look').get('grid-column')).toBe('-3 / -1');
    expect(rule('.layer-row.has-look > .layer-thumb-wrap').get('grid-row')).toBe('span 2');
    expect(rule('.layer-row.has-look > .layer-grip').get('grid-row')).toBe('span 2');
  });
});
