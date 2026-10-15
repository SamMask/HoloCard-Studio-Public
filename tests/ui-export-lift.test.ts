import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportPanel, previewReserve } from '../src/ui/export-panel';
import { posterHeight } from '../src/ui/logic';
import type { TurntableOutcome, UiIntents } from '../src/ui/types';
import { byClass, FakeEvent, flush, installFakeDom, type FakeDom, type FakeElement } from './ui-fake-dom';

// T-828h：影片／GIF 的選項小框打開時，不能蓋到卡片（DESIGN §6）。
// 小框貼在預覽區（舞台）底邊、比頁面下方的提示列高很多；所以小框開著時，卡片所在的 3D 預覽區往上縮到卡片（含四邊空邊）的下緣離小框上緣 10px，
// 卡片本來就離小框夠遠就不縮（卡越高、視窗越矮，縮得越多）。
// 做法：export-panel 量小框的位置，在舞台元素上設 --export-lift（舞台下方那條要多高），style.css 讓提示列那條至少這麼高。
// 小框關掉（按了開始、取消、Esc、被別的分頁接手）一律還原。

let dom: FakeDom;
let observers: FakeObserver[];

class FakeObserver {
  observed: unknown[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    observers.push(this);
  }
  observe(el: unknown) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
}

beforeEach(() => {
  dom = installFakeDom();
  observers = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Box {
  top: number;
  height: number;
}

/** 1280×720 的實測數字：舞台 y 86～708，影片選項小框上緣 506、高 194；GIF 小框上緣 542、高 158。 */
function setup(
  stage = { top: 86, bottom: 708 },
  boxes: { video: Box; gif: Box } = { video: { top: 506, height: 194 }, gif: { top: 542, height: 158 } },
  cardHeight?: () => number,
) {
  const jobs: { done: { resolve: (o: TurntableOutcome) => void } }[] = [];
  const job = () => {
    return new Promise<TurntableOutcome>((resolve) => jobs.push({ done: { resolve } }));
  };
  const intents: Pick<UiIntents, 'exportVideo' | 'exportGif' | 'estimateGif' | 'readMusic' | 'canMakeMp4'> = {
    exportVideo: job,
    exportGif: job,
    estimateGif: async () => [],
    readMusic: async () => ({ ok: true, durationSec: 30 }),
    canMakeMp4: async () => true,
  };
  const anchor = document.createElement('div') as unknown as FakeElement;
  anchor.getBoundingClientRect = () => ({ left: 308, top: stage.top, right: 952, bottom: stage.bottom, width: 644, height: stage.bottom - stage.top, x: 308, y: stage.top });
  const panel = createExportPanel(intents, { changed: () => {}, anchor: () => anchor as unknown as HTMLElement, ...(cardHeight ? { cardHeight } : {}) });
  const el = panel.el as unknown as FakeElement;
  // 假 DOM 沒有排版：小框的版面位置（真的瀏覽器的 offsetTop／offsetHeight，不受進場動畫影響）自己給
  const place = (cls: 'video-options' | 'gif-options', box: Box) => {
    const e = byClass(el, cls) as unknown as { offsetTop: number; offsetHeight: number };
    e.offsetTop = box.top;
    e.offsetHeight = box.height;
  };
  place('video-options', boxes.video);
  place('gif-options', boxes.gif);
  return { panel, el, anchor, jobs, place, lift: () => anchor.style.getPropertyValue('--export-lift') };
}

describe('previewReserve：預覽區底下要多留多高（T-828h）', () => {
  const stage = { top: 86, bottom: 708 };

  it('1280×720、不知道卡多高（當卡片佔滿預覽區）：留 211，預覽區底邊剛好在小框上緣上面 10px', () => {
    // 舞台內高 620（上下各 1px 邊框）；預覽區 87～496＝小框上緣 506 − 10
    expect(previewReserve(stage, 506)).toBe(211);
  });

  it('小框高一點（選了音樂多一列）就留得更多', () => {
    expect(previewReserve(stage, 470)).toBe(247);
  });

  it('卡片只佔預覽區一部分：卡的下緣離小框夠遠就少讓一點（卡越矮讓越少）', () => {
    expect(previewReserve(stage, 506, 0.5)).toBe(75);
    // 星晶龍（20:33）：卡＋空邊約佔預覽區高 75.8%（posterHeight）
    expect(previewReserve(stage, 506, posterHeight(1.65) / 100)).toBe(155);
    // 比 GIF 小框矮：讓的更少
    expect(previewReserve(stage, 542, posterHeight(1.65) / 100)).toBe(114);
  });

  it('卡片本來就離小框很遠：不讓（0）', () => {
    expect(previewReserve(stage, 506, 0.3)).toBe(0);
  });

  it('1920×1080 的星晶龍：只讓 106（預覽區縮不到 15%，不是整個小框的高度）', () => {
    expect(previewReserve({ top: 86, bottom: 1068 }, 866, posterHeight(1.65) / 100)).toBe(106);
  });

  it('小數點進位（不要差 1px 就碰到）', () => {
    expect(previewReserve(stage, 506.4)).toBe(211);
    expect(previewReserve({ top: 86, bottom: 708.2 }, 506)).toBe(212);
  });

  it('視窗太矮：預覽區至少留 200px 高，不讓它縮到看不見（這時小框只好蓋到一點）', () => {
    expect(previewReserve({ top: 86, bottom: 586 }, 300)).toBe(295);
    expect(previewReserve({ top: 86, bottom: 586 }, 250)).toBe(298);
    expect(previewReserve({ top: 86, bottom: 586 }, 100)).toBe(298);
  });

  it('壞資料（NaN、小框跑到舞台下面）：不留、不丟錯；卡片佔比壞掉就當佔滿', () => {
    expect(previewReserve(stage, Number.NaN)).toBe(0);
    expect(previewReserve({ top: Number.NaN, bottom: 708 }, 506)).toBe(0);
    expect(previewReserve(stage, 900)).toBe(0);
    for (const bad of [Number.NaN, 0, -1, Infinity]) expect(previewReserve(stage, 506, bad)).toBe(211);
    expect(previewReserve(stage, 506, 5)).toBe(211);
  });
});

describe('匯出面板：選項小框開著時預覽區讓位（T-828h）', () => {
  it('影片：打開小框 → 舞台設 --export-lift；〔取消〕→ 還原（不知道卡多高時當佔滿預覽區）', async () => {
    const t = setup();
    const run = t.panel.run('webm');
    expect(t.lift()).toBe('211px');
    byClass(t.el, 'vo-cancel').click();
    await run;
    expect(t.lift()).toBe('');
  });

  it('GIF：小框比較矮，讓的也比較少', async () => {
    const t = setup();
    const run = t.panel.run('gif');
    expect(t.lift()).toBe('175px');
    byClass(t.el, 'go-cancel').click();
    await run;
    expect(t.lift()).toBe('');
  });

  it('照這張卡的高度算：高的卡（星晶龍 20:33）讓得比矮的卡多，卡片本來就離得開就不讓', async () => {
    const lifts: Record<string, string> = {};
    for (const [name, cardH] of [['dragon', 1.65], ['standard', 1.4], ['postcard', 0.67], ['wide', 0.3]] as const) {
      const t = setup(undefined, undefined, () => cardH);
      const run = t.panel.run('webm');
      lifts[name] = t.lift();
      t.panel.cancel();
      await run;
    }
    expect(lifts.dragon).toBe('155px');
    expect(lifts.standard).toBe('145px');
    expect(Number.parseInt(lifts.postcard!)).toBeLessThan(Number.parseInt(lifts.standard!));
    expect(lifts.wide).toBe('');
  });

  it('卡高壞掉（NaN、沒給）：當佔滿預覽區，一樣讓（不讓卡片被蓋住比較重要）', async () => {
    for (const cardH of [() => Number.NaN, () => 0, () => -1]) {
      const t = setup(undefined, undefined, cardH);
      const run = t.panel.run('webm');
      expect(t.lift()).toBe('211px');
      t.panel.cancel();
      await run;
    }
  });

  it('按〔開始匯出〕：換成進度小框（矮、不蓋卡片）時預覽區已經還原', async () => {
    const t = setup();
    const run = t.panel.run('webm');
    expect(t.lift()).toBe('211px');
    byClass(t.el, 'vo-go').click();
    await flush();
    expect(t.jobs).toHaveLength(1);
    expect(t.lift()).toBe('');
    t.jobs[0]!.done.resolve('cancelled');
    await run;
    expect(t.lift()).toBe('');
  });

  it('Esc（cancel）、被別的分頁接手（block）：一樣還原', async () => {
    const t = setup();
    const first = t.panel.run('webm');
    expect(t.lift()).toBe('211px');
    t.panel.cancel();
    await first;
    expect(t.lift()).toBe('');

    const second = t.panel.run('gif');
    expect(t.lift()).toBe('175px');
    t.panel.block(true);
    await second;
    expect(t.lift()).toBe('');
  });

  it('小框變高（選了音樂、出現錯誤、換行）：跟著多讓；變矮就少讓', async () => {
    const t = setup();
    // 開著小框時，ResizeObserver 盯著小框
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const run = t.panel.run('webm');
    const watcher = observers[0]!;
    expect(watcher.observed).toEqual([byClass(t.el, 'video-options')]);
    expect(t.lift()).toBe('211px');
    t.place('video-options', { top: 470, height: 238 });
    watcher.callback();
    expect(t.lift()).toBe('247px');
    t.place('video-options', { top: 506, height: 194 });
    watcher.callback();
    expect(t.lift()).toBe('211px');
    byClass(t.el, 'vo-cancel').click();
    await run;
    // 關掉就不再盯、不再讓
    expect(watcher.disconnected).toBe(true);
    expect(t.lift()).toBe('');
  });

  it('視窗大小變了（舞台位置變了）：重算；小框關掉後不再聽', async () => {
    const t = setup();
    const run = t.panel.run('webm');
    expect(t.lift()).toBe('211px');
    t.anchor.getBoundingClientRect = () => ({ left: 0, top: 86, right: 800, bottom: 808, width: 800, height: 722, x: 0, y: 86 });
    t.place('video-options', { top: 614, height: 194 });
    dom.window.fire(new FakeEvent('resize'));
    expect(t.lift()).toBe('203px');
    t.place('video-options', { top: 560, height: 248 });
    dom.window.fire(new FakeEvent('resize'));
    expect(t.lift()).toBe('257px');
    byClass(t.el, 'vo-cancel').click();
    await run;
    expect(dom.window.listenerCount('resize')).toBe(0);
  });

  it('小框還沒有版面（高度 0）：不設，不丟錯', async () => {
    const t = setup(undefined, { video: { top: 0, height: 0 }, gif: { top: 0, height: 0 } });
    const run = t.panel.run('webm');
    expect(t.lift()).toBe('');
    byClass(t.el, 'vo-cancel').click();
    await run;
  });
});

describe('style.css：提示列那一條可以被撐高（T-828h）', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const footer = [...css.matchAll(/(?:^|\})\s*\.stage-footer\s*\{([^{}]*)\}/g)].map((m) => m[1]!).join(';');

  it('.stage-footer 至少 var(--export-lift) 高（沒設時 0）、內容貼底（小框蓋在上面，提示列照舊在最下面）', () => {
    expect(footer).toMatch(/min-height:\s*var\(--export-lift,\s*0px\)/);
    expect(footer).toMatch(/justify-content:\s*flex-end/);
  });
});
