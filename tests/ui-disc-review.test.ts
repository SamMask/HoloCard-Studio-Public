// T-810b：T-810 CD 光碟的交叉審查（Codex，86dbc23）找到的 2 中 1 低。
// ① 光碟翻到背面就取消圖層選取（看不到的正面圖層不能被預覽區方向鍵移動）
// ② 光碟的〔正面｜背面〕分頁跟著「看哪一面」，方向鍵右→背面、左→正面能往返
// ③ 卡片庫的光碟格子：光澤與沒有縮圖時的外形是圓環（縮圖本身不裁）
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPreviewKeys } from '../src/interact/keys';
import { newCard, newDisc } from '../src/model/create';
import type { Card, FaceSide } from '../src/model/types';
import { openCardStore } from '../src/storage/store';
import * as ed from '../src/ui/editor';
import { createLayerPanel } from '../src/ui/layer-list';
import { createLibrary } from '../src/ui/library';
import type { LibraryCard, UiIntents } from '../src/ui/types';
import { all, FakeElement, flush, installFakeDom, keydown } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const T1 = '2026-10-15T00:01:00.000Z';
const disc = (): Card => newDisc('d1', T0);
const card = (): Card => newCard('square', 'c1', T0);

const layerInput = { id: 'a', name: 'a', image: '000000000000000a', hasAlpha: true, width: 100, height: 100 };

/** 光碟、正面一個圖層、選著它。 */
function discWithSelection(): ed.EditorState {
  return ed.selectLayer(ed.addUploadedLayer(ed.createEditor(disc()), 'front', layerInput, 'a.png', T1).state, 'a');
}

/** main 的 selectFace 意圖：編輯器換面（光碟不換、只取消選取）＋卡片轉過去（change 記下轉到哪一面，ed.turnedTo）。 */
const mainSelectFace = (s: ed.EditorState, face: FaceSide) => ed.turnedTo(ed.selectFace(s, face), face);

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

describe('審查 1：光碟翻到背面就取消圖層選取（方向鍵回到轉卡）', () => {
  it('選著正面圖層、按〔背面〕：編輯面還是正面、圖層取消選取；卡片本身不變', () => {
    const s = discWithSelection();
    expect(s.selectedLayerId).toBe('a');
    const back = ed.selectFace(s, 'back');
    expect(back.face).toBe('front');
    expect(back.selectedLayerId).toBe(null);
    expect(back.history).toBe(s.history);
  });

  it('一般卡的〔背面〕照舊：換面、取消選取', () => {
    const s = ed.selectLayer(ed.addUploadedLayer(ed.createEditor(card()), 'front', layerInput, 'a.png', T1).state, 'a');
    const back = ed.selectFace(s, 'back');
    expect(back.face).toBe('back');
    expect(back.selectedLayerId).toBe(null);
  });

  it('整合：選正面圖層→點〔背面〕→預覽區按方向鍵＝轉卡，圖層位置不變', () => {
    const host = document.createElement('div');
    let editor = discWithSelection();
    const turns: [number, number][] = [];
    const selected = () => {
      if (editor.foilSelected || editor.selectedLayerId === null) return null;
      const id = editor.selectedLayerId;
      return ed.currentCard(editor)[editor.face].layers.find((l) => l.id === id) ?? null;
    };
    attachPreviewKeys(host as unknown as HTMLElement, {
      context: () => ({ layerSelected: selected() !== null }),
      turn: (dYaw, dPitch) => turns.push([dYaw, dPitch]),
      zoom: () => {},
      home: () => {},
      flip: () => {},
      selected: () => {
        const l = selected();
        return l && { id: l.id, x: l.x, y: l.y, scale: l.scale };
      },
      editLayer: (id, patch, phase) => (editor = ed.editLayer(editor, id, patch, phase, T1)),
      editToken: () => editor.history,
    });
    const layerX = () => ed.currentCard(editor).front.layers[0]!.x;
    const x0 = layerX();
    // 還選著時：方向鍵是移圖層（確認這個接線是真的）
    keydown(host, 'ArrowRight');
    expect(turns).toEqual([]);
    expect(layerX()).not.toBe(x0);
    // 左欄點〔背面〕之後：方向鍵轉卡，圖層不動
    editor = mainSelectFace(editor, 'back');
    const moved = layerX();
    keydown(host, 'ArrowRight');
    expect(turns).toHaveLength(1);
    expect(layerX()).toBe(moved);
  });

  it('Home／F 換面一定取消選取（光碟也一樣，與一般卡一致）', () => {
    expect(ed.showFace(discWithSelection(), 'back').selectedLayerId).toBe(null);
    expect(ed.showFace(discWithSelection(), 'front').selectedLayerId).toBe(null);
  });
});

describe('審查 2：光碟的分頁方向鍵往返（→ 背面、← 正面）', () => {
  function setup(c: Card) {
    const calls: FaceSide[] = [];
    let editor = ed.createEditor(c);
    const render = () => panel.render(ed.toUiState(editor, () => undefined));
    const intents = new Proxy({} as UiIntents, {
      get: (_t, name: string) => (...args: unknown[]) => {
        if (name !== 'selectFace') return undefined;
        const face = args[0] as FaceSide;
        calls.push(face);
        editor = mainSelectFace(editor, face);
        render();
        return undefined;
      },
    });
    const panel = createLayerPanel(intents);
    render();
    const tabs = all(panel.el as unknown as FakeElement, 'seg-btn');
    return {
      tabs,
      calls,
      render,
      setEditor: (e: ed.EditorState) => (editor = e),
      checked: () => tabs.map((t) => t.getAttribute('aria-checked')),
    };
  }

  it('焦點在〔正面〕：→ 卡片翻到背面、分頁的選中樣子跟著；← 翻回正面；再往返一次', () => {
    const t = setup(disc());
    t.tabs[0]!.focus();
    expect(t.checked()).toEqual(['true', 'false']);
    keydown(t.tabs[0], 'ArrowRight');
    expect(t.calls).toEqual(['back']);
    expect(t.checked()).toEqual(['false', 'true']);
    keydown(t.tabs[1], 'ArrowLeft');
    expect(t.calls).toEqual(['back', 'front']);
    expect(t.checked()).toEqual(['true', 'false']);
    keydown(t.tabs[0], 'ArrowRight');
    keydown(t.tabs[1], 'ArrowLeft');
    expect(t.calls).toEqual(['back', 'front', 'back', 'front']);
  });

  it('點〔背面〕再點〔正面〕也一樣：選中的樣子跟著看哪一面', () => {
    const t = setup(disc());
    t.tabs[1]!.click();
    expect(t.checked()).toEqual(['false', 'true']);
    t.tabs[0]!.click();
    expect(t.calls).toEqual(['back', 'front']);
    expect(t.checked()).toEqual(['true', 'false']);
  });

  it('卡片被別的操作轉回正面（選圖層、上傳；main 的 change 記下 turnedTo front）：分頁回到〔正面〕', () => {
    const t = setup(disc());
    t.tabs[1]!.click();
    expect(t.checked()).toEqual(['false', 'true']);
    t.setEditor(ed.turnedTo(mainSelectFace(ed.createEditor(disc()), 'back'), 'front'));
    t.render();
    expect(t.checked()).toEqual(['true', 'false']);
  });

  it('一般卡不變：分頁跟著編輯的那一面，→ ← 往返', () => {
    const t = setup(card());
    t.tabs[0]!.focus();
    keydown(t.tabs[0], 'ArrowRight');
    expect(t.checked()).toEqual(['false', 'true']);
    keydown(t.tabs[1], 'ArrowLeft');
    expect(t.calls).toEqual(['back', 'front']);
    expect(t.checked()).toEqual(['true', 'false']);
  });

  it('turnedTo：只有光碟記「看哪一面」；一般卡、同一面都原樣', () => {
    const d = ed.createEditor(disc());
    expect(d.viewFace).toBe('front');
    expect(ed.turnedTo(d, 'front')).toBe(d);
    expect(ed.turnedTo(d, 'back').viewFace).toBe('back');
    expect(ed.toUiState(ed.turnedTo(d, 'back'), () => undefined).viewFace).toBe('back');
    const c = ed.createEditor(card());
    expect(ed.turnedTo(c, 'back')).toBe(c);
  });
});

describe('審查 3：卡片庫的光碟格子用圓環光澤', () => {
  async function arts(cards: Partial<LibraryCard>[]) {
    const intents = new Proxy({} as UiIntents, {
      get: (_t, name: string) =>
        name === 'loadLibrary'
          ? async () => ({ cards: cards.map((c) => ({ ...c, createdAt: T0, updatedAt: T0 })), storageLow: false })
          : () => {},
    });
    const library = createLibrary(intents, { openNewCard: () => {}, importFiles: () => {}, changed: () => {} });
    library.open();
    await flush();
    return all(library.el, 'lib-art');
  }

  it('光碟（有縮圖、沒縮圖）的格子有 is-disc；一般卡沒有；縮圖與光澤都還在', async () => {
    const list = await arts([
      { id: 'd1', name: '光碟', aspect: 'square', kind: 'disc', thumbnail: new Blob(['x'], { type: 'image/webp' }) },
      { id: 'd2', name: '光碟（沒縮圖）', aspect: 'square', kind: 'disc', bodyColor: '#223344' },
      { id: 'c1', name: '卡', aspect: 'standard' },
      { id: 'c2', name: '卡（kind card）', aspect: 'square', kind: 'card' },
    ]);
    expect(list.map((a) => a.classList.contains('is-disc'))).toEqual([true, true, false, false]);
    expect(all(list[0]!, 'lib-art-img')).toHaveLength(1);
    expect(all(list[1]!, 'lib-art-plain')).toHaveLength(1);
    for (const a of list) expect(all(a, 'lib-sheen')).toHaveLength(1);
  });

  it('style.css：光碟的光澤與沒縮圖的外形是圓環（圓形＋中間孔的遮罩）；縮圖本身不遮不裁', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const block = (selector: string) => {
      let found = '';
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (m[1]!.split(',').some((s) => s.trim() === selector)) found += m[2]!;
      }
      return found;
    };
    for (const selector of ['.lib-art.is-disc .lib-sheen', '.lib-art.is-disc .lib-art-plain']) {
      const rule = block(selector);
      expect(rule, selector).toMatch(/border-radius:\s*50%/);
      expect(rule, selector).toMatch(/mask:\s*radial-gradient\(circle closest-side, transparent/);
    }
    // 縮圖本身可能有破框的部分在圓外：不遮、不裁
    expect(block('.lib-art.is-disc .lib-art-img')).not.toMatch(/mask|clip|border-radius|overflow/);
  });

  it('儲存的清單摘要帶 kind：光碟 → "disc"；一般卡不多出 kind 欄位', async () => {
    const store = await openCardStore(new IDBFactory());
    await store.save(disc());
    await store.save(card());
    const list = await store.list();
    const d = list.find((s) => s.id === 'd1')!;
    const c = list.find((s) => s.id === 'c1')!;
    expect(d.kind).toBe('disc');
    expect('kind' in c).toBe(false);
  });
});
