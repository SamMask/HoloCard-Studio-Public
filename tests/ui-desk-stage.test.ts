// 舞台第七種「工作桌」（T-832，DESIGN §5「工作桌（壓克力展示架）」）的畫面：
//   - 預覽區的 CSS 那層：工作桌、沒有自己的背景圖 → 清楚的木桌（is-desk，圖在 style.css：和頁面背景同一張 /stages/desk.webp）；
//     有自己的背景圖 → 背景圖取代木桌（T-814 照舊）；換到別的舞台 → 拿掉 is-desk；
//   - 右欄「舞台」多一顆〔工作桌〕（七顆、小圖示各不相同、滑過有說明），點了記一步。
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../src/i18n';
import { setBackdrop, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle } from '../src/model/types';
import { createEditor, toUiState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { stageBackdropView } from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import type { UiIntents } from '../src/ui/types';
import { all, byClass, installFakeDom, type FakeElement } from './ui-fake-dom';

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stageBackdropView：工作桌沒有自己的背景圖＝木桌', () => {
  it('工作桌（有沒有底圖都一樣）→ { desk: true }', () => {
    expect(stageBackdropView(onStage(plainCard(), 'desk'))).toEqual({ desk: true });
    expect(stageBackdropView(onStage(withBase(plainCard()), 'desk'))).toEqual({ desk: true });
  });

  it('有自己的背景圖 → 背景圖（取代木桌）', () => {
    expect(stageBackdropView(setBackdrop(onStage(plainCard(), 'desk'), BD))).toEqual({ hash: BD, custom: true });
  });
});

describe('預覽區的那層（ui/stage）', () => {
  function mount() {
    const stage = createStage(new Proxy({} as UiIntents, { get: () => () => undefined }));
    const el = stage.el as unknown as FakeElement;
    const layer = byClass(el, 'stage-backdrop');
    const img = byClass(el, 'stage-backdrop-img');
    const render = (card: Card) => stage.render(toUiState(createEditor(card), (h) => `blob:${h}`));
    return { el, layer, img, render };
  }

  it('工作桌：那層換成木桌（is-desk；圖在 CSS，img 不放圖、不模糊的底圖版不顯示），預覽區 is-desk；不是自己的背景圖、不套遠景位置', () => {
    const t = mount();
    t.render(onStage(withBase(plainCard()), 'desk'));
    expect(t.layer.classList.contains('is-desk')).toBe(true);
    expect(t.el.classList.contains('is-desk')).toBe(true);
    expect(t.img.getAttribute('src')).toBeNull();
    expect(t.layer.classList.contains('has-image')).toBe(false);
    expect(t.layer.classList.contains('is-custom')).toBe(false);
    expect(t.el.classList.contains('has-backdrop')).toBe(false);
    expect(t.layer.style.getPropertyValue('--far-pos')).toBe('');
  });

  it('有自己的背景圖：背景圖取代木桌（is-custom，不是 is-desk）；拿掉背景圖回到木桌', () => {
    const t = mount();
    t.render(setBackdrop(onStage(plainCard(), 'desk'), BD));
    expect(t.img.getAttribute('src')).toBe(`blob:${BD}`);
    expect(t.layer.classList.contains('is-custom')).toBe(true);
    expect(t.layer.classList.contains('is-desk')).toBe(false);
    expect(t.el.classList.contains('has-backdrop')).toBe(true);
    t.render(onStage(plainCard(), 'desk'));
    expect(t.layer.classList.contains('is-desk')).toBe(true);
    expect(t.img.getAttribute('src')).toBeNull();
  });

  it('換到別的舞台：拿掉 is-desk，回到底圖模糊版', () => {
    const t = mount();
    t.render(onStage(withBase(plainCard()), 'desk'));
    t.render(onStage(withBase(plainCard()), 'halo'));
    expect(t.layer.classList.contains('is-desk')).toBe(false);
    expect(t.el.classList.contains('is-desk')).toBe(false);
    expect(t.img.getAttribute('src')).toBe(`blob:${BASE}`);
  });
});

describe('右欄「舞台」七選一', () => {
  function stageButtons() {
    const calls: unknown[][] = [];
    const intents = new Proxy({} as UiIntents, { get: (_t, name: string) => (...args: unknown[]) => void calls.push([name, ...args]) });
    const inspector = createInspector(intents);
    inspector.render(toUiState(createEditor(plainCard()), (h) => `blob:${h}`));
    const group = all(inspector.el as unknown as FakeElement, 'segmented').find((s) => s.getAttribute('aria-label') === S.stage.title)!;
    return { buttons: group.querySelectorAll('button'), calls };
  }

  it('七顆（工作桌在關閉前面），小圖示各不相同；工作桌的名字與滑過說明', () => {
    const { buttons } = stageButtons();
    expect(buttons.length).toBe(7);
    const desk = buttons[5]!;
    expect(desk.textContent).toBe(S.stage.desk);
    expect(desk.title).toBe(S.stage.deskTip);
    expect(buttons[6]!.textContent).toBe(S.stage.none);
    const shapes = buttons.map((b) => b.querySelectorAll('path').map((p) => p.getAttribute('d')).join('|'));
    expect(new Set(shapes).size).toBe(7);
  });

  it('點〔工作桌〕：editCard({ view: { stage: desk } }, commit)（一步）', () => {
    const { buttons, calls } = stageButtons();
    buttons[5]!.click();
    expect(calls.at(-1)).toEqual(['editCard', { view: { stage: 'desk' } }, 'commit']);
  });
});

describe('style.css：工作桌的木桌（T-832 段）', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  it('is-desk 的那層用和頁面背景同一張圖（清楚、不模糊）', () => {
    const at = css.indexOf('T-832');
    expect(at).toBeGreaterThan(0);
    const section = css.slice(at);
    expect(section).toContain('.stage-backdrop.is-desk');
    expect(section).toContain('/stages/desk.webp');
  });
});
