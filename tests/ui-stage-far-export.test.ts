import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';
import type { StageStyle } from '../src/model/types';
import { createEditor, toUiState } from '../src/ui/editor';
import { createExportPanel } from '../src/ui/export-panel';
import { createHeader, type HeaderHooks } from '../src/ui/header';
import type { UiIntents } from '../src/ui/types';
import { all, buttonWithText, byClass, FakeEvent, flush, installFakeDom, type FakeElement } from './ui-fake-dom';

beforeEach(() => {
  const dom = installFakeDom();
  Object.assign(dom.document, { addEventListener() {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const png = vi.fn(async () => {});
  const turntable = vi.fn<HeaderHooks['exportTurntable']>(async () => {});
  const intents = new Proxy({ exportPng: png }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} }) as unknown as UiIntents;
  const header = createHeader(intents, { openLibrary() {}, openNewCard() {}, toggleHelp() {}, exportTurntable: turntable });
  const menu = byClass(header.el, 'export-menu');
  const far = all(menu, 'menu-check').find(l => l.textContent === '畫上舞台的遠景')!;
  const transparent = all(menu, 'menu-check').find(l => l.textContent.startsWith('透明背景'))!;
  const check = (label: FakeElement, checked: boolean) => {
    const input = label.querySelector('input') as unknown as FakeElement & { checked: boolean };
    input.checked = checked;
    input.dispatchEvent(new FakeEvent('change'));
  };
  const render = (stage: StageStyle, backdrop?: string) => {
    const card = newCard('standard', stage, '2026-10-15T00:00:00.000Z');
    header.render(toUiState(createEditor({ ...card, view: { ...card.view, stage, backdrop } }), () => undefined));
  };
  return { header, menu, far, transparent, check, render, png, turntable };
}

describe('T-842 舞台遠景勾選', () => {
  it('只在四種有遠景的舞台、沒有自訂背景圖時出現；預設不勾，說明只包含遠景', () => {
    const t = setup();
    expect(t.far).toBeDefined();
    expect(t.far.title).toBe('只畫遠景的圖，光環、台子和倒影不會畫進去');
    expect((t.far.querySelector('input') as unknown as { checked: boolean }).checked).toBe(false);
    for (const stage of ['gallery', 'water', 'nebula', 'desk'] as const) {
      t.render(stage);
      expect(t.far.hidden).toBe(false);
      t.render(stage, '00000000000000b7');
      expect(t.far.hidden).toBe(true);
    }
    for (const stage of ['halo', 'magic', 'none'] as const) {
      t.render(stage);
      expect(t.far.hidden).toBe(true);
    }
    expect(t.far.parentNode).toBe(t.transparent.parentNode);
  });

  it('同一次開著工坊記住；透明背景互斥；PNG、影片、GIF 接到選擇', async () => {
    const t = setup();
    expect(t.far).toBeDefined();
    t.render('gallery');
    t.check(t.far, true);
    t.render('none');
    t.render('water');
    expect((t.far.querySelector('input') as unknown as { checked: boolean }).checked).toBe(true);
    for (const title of ['PNG 圖片', '轉動影片', 'GIF']) {
      t.header.exportButton.click();
      buttonWithText(t.menu, title).click();
      await flush();
    }
    expect(t.png).toHaveBeenCalledWith(false, true, true, true);
    expect(t.turntable.mock.calls.map(c => [c[0], c[4]])).toEqual([['webm', true], ['gif', true]]);
    t.check(t.transparent, true);
    expect((t.far.querySelector('input') as unknown as { checked: boolean }).checked).toBe(false);
    t.check(t.far, true);
    expect((t.transparent.querySelector('input') as unknown as { checked: boolean }).checked).toBe(false);
    t.check(t.far, false);
    expect((t.transparent.querySelector('input') as unknown as { checked: boolean }).checked).toBe(false);
  });

  it('面板將選擇送給 GIF 預估、GIF、影片；下一次省略不沿用', async () => {
    const estimateGif = vi.fn<UiIntents['estimateGif']>(async () => null);
    const exportGif = vi.fn<UiIntents['exportGif']>(async () => 'cancelled');
    const exportVideo = vi.fn<UiIntents['exportVideo']>(async () => 'cancelled');
    const panel = createExportPanel({ estimateGif, exportGif, exportVideo, readMusic: async () => ({ ok: true, durationSec: 1 }) }, {
      changed() {}, anchor: () => document.createElement('div'),
    });
    for (const [kind, value] of [['gif', true], ['webm', false], ['gif', undefined]] as const) {
      const run = panel.run(kind, undefined, true, true, value);
      await flush();
      byClass(panel.el, kind === 'gif' ? 'go-go' : 'vo-go').click();
      await run;
    }
    expect(estimateGif.mock.calls[0]![0]).toMatchObject({ includeStageFar: true });
    expect(exportGif.mock.calls[0]![0]).toMatchObject({ includeStageFar: true });
    expect(exportVideo.mock.calls[0]![0]).toMatchObject({ includeStageFar: false });
    expect(exportGif.mock.calls[1]![0]).not.toHaveProperty('includeStageFar');
    expect(estimateGif.mock.calls.at(-1)![0]).not.toHaveProperty('includeStageFar');
  });
});
