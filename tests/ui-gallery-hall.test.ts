// 展示廳畫好的大廳（T-816，DESIGN §5「展示廳升級」）在預覽區的 CSS 那層：
// 展示廳、沒有自己的背景圖 → 那層換成大廳圖（鋪滿、不模糊；is-hall）；大廳圖還沒讀好 → 照以前（深藍底，不放圖）；
// 有自己的背景圖 → 背景圖取代大廳（T-814 照舊）；其他舞台不受影響；大廳圖不套 T-822 的位置（--far-pos／--far-zoom 不設）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle } from '../src/model/types';
import { createEditor, toUiState } from '../src/ui/editor';
import { stageBackdropView } from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { UiIntents } from '../src/ui/types';
import { byClass, installFakeDom, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const BD = 'bbbbbbbbbbbbbbb1';
const BASE = 'aaaaaaaaaaaaaaa0';
const plainCard = () => newCard('standard', 'card-1', T0);
const onStage = (card: Card, stage: StageStyle) => updateCard(card, { view: { stage } });
const withBase = (card: Card): Card => ({
  ...card,
  front: {
    layers: [
      { id: 'bg', name: 'bg', role: 'base', image: BASE, visible: true, depth: 0, x: 0, y: 0, scale: 1, holo: false, hasAlpha: false },
    ],
  },
});

beforeEach(() => {
  installFakeDom();
  Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stageBackdropView：展示廳沒有自己的背景圖＝大廳', () => {
  it('展示廳（有沒有底圖都一樣）→ { hall: true }', () => {
    expect(stageBackdropView(onStage(plainCard(), 'gallery'))).toEqual({ hall: true });
    expect(stageBackdropView(onStage(withBase(plainCard()), 'gallery'))).toEqual({ hall: true });
  });

  it('有自己的背景圖 → 背景圖（取代大廳）；其他舞台照舊（底圖模糊版／沒有）', () => {
    expect(stageBackdropView(setBackdrop(onStage(plainCard(), 'gallery'), BD))).toEqual({ hash: BD, custom: true });
    for (const stage of ['halo', 'magic', 'water', 'nebula', 'none'] as const) {
      expect(stageBackdropView(onStage(withBase(plainCard()), stage))).toEqual({ hash: BASE, custom: false });
      expect(stageBackdropView(onStage(plainCard(), stage))).toBeNull();
    }
  });
});

describe('預覽區的那層（ui/stage）', () => {
  function mount() {
    const stage = createStage(new Proxy({} as UiIntents, { get: () => () => undefined }));
    const el = stage.el as unknown as FakeElement;
    const layer = byClass(el, 'stage-backdrop');
    const img = byClass(el, 'stage-backdrop-img');
    const render = (card: Card, hallUrl?: string) =>
      stage.render({ ...toUiState(createEditor(card), (h) => `blob:${h}`), ...(hallUrl !== undefined ? { galleryHallUrl: hallUrl } : {}) });
    return { el, layer, img, render };
  }

  it('展示廳、大廳圖讀好了：換成大廳圖（is-hall），不是自己的背景圖（沒有 has-backdrop／is-custom）、不套遠景位置', () => {
    const t = mount();
    t.render(onStage(withBase(plainCard()), 'gallery'), 'blob:hall');
    expect(t.img.getAttribute('src')).toBe('blob:hall');
    expect(t.layer.classList.contains('is-hall')).toBe(true);
    expect(t.layer.classList.contains('has-image')).toBe(true);
    expect(t.layer.classList.contains('is-custom')).toBe(false);
    expect(t.el.classList.contains('has-backdrop')).toBe(false);
    expect(t.el.classList.contains('is-gallery')).toBe(true);
    expect(t.layer.style.getPropertyValue('--far-pos')).toBe('');
    expect(t.layer.style.getPropertyValue('--far-zoom')).toBe('');
  });

  it('大廳圖還沒讀好：不放圖（照以前的深藍底），也沒有 is-hall', () => {
    const t = mount();
    t.render(onStage(withBase(plainCard()), 'gallery'));
    expect(t.img.getAttribute('src')).toBeNull();
    expect(t.layer.classList.contains('is-hall')).toBe(false);
    expect(t.layer.classList.contains('has-image')).toBe(false);
  });

  it('有自己的背景圖：背景圖取代大廳（is-custom，不是 is-hall）；拿掉背景圖回到大廳', () => {
    const t = mount();
    t.render(setBackdrop(onStage(plainCard(), 'gallery'), BD), 'blob:hall');
    expect(t.img.getAttribute('src')).toBe(`blob:${BD}`);
    expect(t.layer.classList.contains('is-custom')).toBe(true);
    expect(t.layer.classList.contains('is-hall')).toBe(false);
    expect(t.el.classList.contains('has-backdrop')).toBe(true);
    t.render(onStage(plainCard(), 'gallery'), 'blob:hall');
    expect(t.img.getAttribute('src')).toBe('blob:hall');
    expect(t.layer.classList.contains('is-hall')).toBe(true);
    expect(t.layer.classList.contains('is-custom')).toBe(false);
  });

  it('換到別的舞台：回到底圖模糊版，沒有 is-hall', () => {
    const t = mount();
    t.render(onStage(withBase(plainCard()), 'gallery'), 'blob:hall');
    t.render(onStage(withBase(plainCard()), 'halo'), 'blob:hall');
    expect(t.img.getAttribute('src')).toBe(`blob:${BASE}`);
    expect(t.layer.classList.contains('is-hall')).toBe(false);
  });
});
