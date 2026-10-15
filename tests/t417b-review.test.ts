// T-417b：T-417 交叉審查（Codex）4 個中等問題的回歸測試。
// ① 中性的混合層（50% 灰的疊色／柔光、白的加深、黑的發光）不改「亮面／霧光」比例 ② ?nodownload 攔下的檔有上限
// ③ 反光層那一列的眼睛按鈕用鍵盤按得到 ④ 反光層面板改勾選時不重建清單（鍵盤焦點留著）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, HELD_DOWNLOADS_MAX, holdDownload, type HeldDownload } from '../src/app/files';
import type { NewLayerInput } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { BlendMode } from '../src/model/types';
import { surfaceWeight } from '../src/render/blend';
import { coverStep, type FoilCover } from '../src/render/holo';
import { addUploadedLayer, createEditor, editFoil, editLayer, selectFoil, swapLayers, toUiState, type EditorState } from '../src/ui/editor';
import { createFoilPanel } from '../src/ui/foil-panel';
import { createLayerPanel } from '../src/ui/layer-list';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const gray = (v: number) => ({ r: v, g: v, b: v });

// ---------------------------------------------------------------- ①

describe('① 圖層對表面的實際覆蓋率（surfaceWeight）', () => {
  it('中性色＝0：50% 灰的疊色／柔光、白的加深、黑的發光／強光', () => {
    expect(surfaceWeight('overlay', gray(0.5))).toBe(0);
    expect(surfaceWeight('soft-light', gray(0.5))).toBe(0);
    expect(surfaceWeight('multiply', gray(1))).toBe(0);
    expect(surfaceWeight('screen', gray(0))).toBe(0);
    expect(surfaceWeight('add', gray(0))).toBe(0);
  });

  it('越偏離中性色越高；正常、換色永遠 1', () => {
    expect(surfaceWeight('overlay', gray(0))).toBe(1);
    expect(surfaceWeight('overlay', gray(1))).toBe(1);
    expect(surfaceWeight('soft-light', gray(0.75))).toBeCloseTo(0.5, 12);
    expect(surfaceWeight('overlay', { r: 0.5, g: 0.5, b: 0.9 })).toBeCloseTo(0.8, 12);
    expect(surfaceWeight('multiply', gray(0))).toBe(1);
    expect(surfaceWeight('screen', gray(1))).toBe(1);
    for (const mode of ['normal', 'color'] as BlendMode[]) {
      expect(surfaceWeight(mode, gray(0.5))).toBe(1);
      expect(surfaceWeight(mode, gray(0))).toBe(1);
    }
  });
});

describe('① 亮面／霧光比例跟著圖層更新（coverStep；card-mesh 同算式）', () => {
  const lit: FoilCover = { foil: 1, matte: 0 };
  const layer = (blend: BlendMode, cs: number, alpha: number, foil: number, breakout = false) => ({
    weight: surfaceWeight(blend, gray(cs)) * alpha,
    foil,
    breakout,
  });

  it('亮面上面疊一層沒勾反光、不透明、50% 灰的疊色／柔光：比例不變（以前會變成全霧光）', () => {
    expect(coverStep(lit, layer('overlay', 0.5, 1, 0))).toEqual(lit);
    expect(coverStep(lit, layer('soft-light', 0.5, 1, 0))).toEqual(lit);
  });

  it('不是中性色的疊色：照偏離程度換；正常模式的不透明層整個換掉', () => {
    expect(coverStep(lit, layer('overlay', 0, 1, 0))).toEqual({ foil: 0, matte: 1 });
    expect(coverStep(lit, layer('normal', 0.5, 1, 0))).toEqual({ foil: 0, matte: 1 });
  });

  it('半透明：換一半', () => {
    const half = coverStep(lit, layer('normal', 0.3, 0.5, 0));
    expect(half.foil).toBeCloseTo(0.5, 12);
    expect(half.matte).toBeCloseTo(0.5, 12);
    const halfNeutral = coverStep(lit, layer('overlay', 0.5, 0.5, 0));
    expect(halfNeutral).toEqual(lit);
  });

  it('破框層：兩種都不是（亮面、霧光都被擋掉）；中性色的破框層什麼都不擋', () => {
    expect(coverStep({ foil: 0.2, matte: 0.8 }, layer('normal', 0.5, 1, 0, true))).toEqual({ foil: 0, matte: 0 });
    expect(coverStep({ foil: 0.2, matte: 0.8 }, layer('overlay', 0.5, 1, 0, true))).toEqual({ foil: 0.2, matte: 0.8 });
    const halfBreakout = coverStep(lit, layer('normal', 0.5, 0.5, 0, true));
    expect(halfBreakout.foil).toBeCloseTo(0.5, 12);
    expect(halfBreakout.matte).toBe(0);
  });

  it('勾了反光的層蓋在霧光上：換成亮面', () => {
    expect(coverStep({ foil: 0, matte: 1 }, layer('normal', 0.4, 1, 1))).toEqual({ foil: 1, matte: 0 });
  });
});

// ---------------------------------------------------------------- ②

describe('② ?nodownload 攔下的檔有上限（淘汰最舊的）', () => {
  const item = (name: string, size: number): HeldDownload => ({ name, size, blob: new Blob([]) });

  it('筆數上限：超過就丟最舊的', () => {
    const list: HeldDownload[] = [];
    for (let i = 0; i < HELD_DOWNLOADS_MAX.count + 3; i++) holdDownload(list, item(`f${i}`, 10));
    expect(list).toHaveLength(HELD_DOWNLOADS_MAX.count);
    expect(list[0]!.name).toBe('f3');
    expect(list.at(-1)!.name).toBe(`f${HELD_DOWNLOADS_MAX.count + 2}`);
  });

  it('總大小上限：超過就丟最舊的；最新的一筆一定留著（就算自己就超過）', () => {
    const max = { count: 10, bytes: 100 };
    const list: HeldDownload[] = [];
    holdDownload(list, item('a', 40), max);
    holdDownload(list, item('b', 40), max);
    holdDownload(list, item('c', 40), max);
    expect(list.map((d) => d.name)).toEqual(['b', 'c']);
    holdDownload(list, item('huge', 500), max);
    expect(list.map((d) => d.name)).toEqual(['huge']);
  });

  it('downloadBlob 在 ?nodownload 下照這個上限收（不會一直佔記憶體）', () => {
    vi.stubGlobal('location', { search: '?nodownload' });
    const win: { __holoDownloads?: HeldDownload[] } = {};
    vi.stubGlobal('window', win);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    for (let i = 0; i < HELD_DOWNLOADS_MAX.count * 2; i++) downloadBlob(new Blob(['x']), `g${i}.gif`);
    expect(win.__holoDownloads).toHaveLength(HELD_DOWNLOADS_MAX.count);
    expect(win.__holoDownloads!.at(-1)!.name).toBe(`g${HELD_DOWNLOADS_MAX.count * 2 - 1}.gif`);
    expect(HELD_DOWNLOADS_MAX.bytes).toBeLessThanOrEqual(256 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------- ③ ④

function input(id: string, hasAlpha: boolean): NewLayerInput {
  return { id, name: id, image: '0123456789abcdef', hasAlpha, width: 1000, height: 1000 };
}

function setup(): EditorState {
  let s = createEditor(newCard('standard', 'card-1', T0));
  s = addUploadedLayer(s, 'front', input('bg', false), 'bg.jpg', T0).state;
  s = addUploadedLayer(s, 'front', input('hero', true), 'hero.png', T0).state;
  s = addUploadedLayer(s, 'front', input('fx', true), 'fx.png', T0).state;
  s = editLayer(s, 'bg', { holo: false }, 'commit', T0);
  return editFoil(selectFoil(s), 'front', { shape: 'layers' }, T0);
}

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

describe('③ 反光層那一列：子按鈕的鍵盤操作不被整列攔下', () => {
  let dom: ReturnType<typeof installFakeDom>;
  beforeEach(() => {
    dom = installFakeDom();
  });

  it('眼睛按鈕上按 Enter／空白：不選反光層、不 preventDefault（讓按鈕自己被按下去）', () => {
    const { intents, calls } = recorder();
    const panel = createLayerPanel(intents);
    panel.render(toUiState(setup(), () => undefined));
    const eye = byClass(panel.el, 'foil-eye');
    for (const key of ['Enter', ' ']) {
      const e = new FakeEvent('keydown', { key });
      eye.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(calls).toEqual([]);
    void dom;
  });

  it('焦點在那一列本身時按 Enter／空白：選反光層', () => {
    const { intents, calls } = recorder();
    const panel = createLayerPanel(intents);
    panel.render(toUiState(setup(), () => undefined));
    const row = byClass(panel.el, 'foil-row');
    const e = new FakeEvent('keydown', { key: 'Enter' });
    row.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    row.dispatchEvent(new FakeEvent('keydown', { key: ' ' }));
    expect(calls).toEqual([
      { name: 'selectFoil', args: [] },
      { name: 'selectFoil', args: [] },
    ]);
  });
});

describe('④ 反光層面板：改勾選不重建清單（鍵盤焦點留著）', () => {
  beforeEach(() => {
    installFakeDom();
  });

  const checkOf = (root: unknown, name: string): FakeElement =>
    byClass(all(root, 'foil-layer').find((r) => byClass(r, 'foil-layer-name').textContent === name)!, 'foil-check');

  it('勾一層：同一個按鈕、焦點還在它上面、狀態跟著變', () => {
    const { intents } = recorder();
    const panel = createFoilPanel(intents);
    let s = setup();
    panel.render(toUiState(s, () => undefined));
    const bg = checkOf(panel.el, 'bg');
    bg.focus();
    expect(document.activeElement).toBe(bg);
    s = editLayer(s, 'bg', { holo: true }, 'commit', T0);
    panel.render(toUiState(s, () => undefined));
    expect(checkOf(panel.el, 'bg')).toBe(bg);
    expect(panel.el.contains(bg as unknown as Node)).toBe(true);
    expect(document.activeElement).toBe(bg);
    expect(bg.dataset.state).toBe('on');
    expect(bg.getAttribute('aria-checked')).toBe('true');
  });

  it('按了之後送出的是最新的狀態（不會用到舊的開關）', () => {
    const { intents, calls } = recorder();
    const panel = createFoilPanel(intents);
    let s = setup();
    panel.render(toUiState(s, () => undefined));
    const bg = checkOf(panel.el, 'bg');
    bg.click();
    expect(calls.at(-1)).toEqual({ name: 'editLayer', args: ['bg', { holo: true }, 'commit'] });
    s = editLayer(s, 'bg', { holo: true }, 'commit', T0);
    panel.render(toUiState(s, () => undefined));
    bg.click();
    expect(calls.at(-1)).toEqual({ name: 'editLayer', args: ['bg', { holo: false }, 'commit'] });
  });

  it('改名、換順序、刪掉、加圖層：留下的列重用，順序與名字照最新的', () => {
    const { intents } = recorder();
    const panel = createFoilPanel(intents);
    let s = setup();
    panel.render(toUiState(s, () => undefined));
    const hero = checkOf(panel.el, 'hero');
    const fx = checkOf(panel.el, 'fx');
    s = swapLayers(s, 'hero', 'fx', T0);
    s = editLayer(s, 'hero', { name: '主角' }, 'commit', T0);
    panel.render(toUiState(s, () => undefined));
    const names = () => all(panel.el, 'foil-layer-name').map((n) => n.textContent);
    expect(names()).toEqual(['主角', 'fx', 'bg']);
    expect(checkOf(panel.el, '主角')).toBe(hero);
    expect(checkOf(panel.el, 'fx')).toBe(fx);
    s = addUploadedLayer(s, 'front', input('new', true), 'new.png', T0).state;
    panel.render(toUiState(selectFoil(s), () => undefined));
    expect(names()).toEqual(['new', '主角', 'fx', 'bg']);
    expect(checkOf(panel.el, 'fx')).toBe(fx);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
