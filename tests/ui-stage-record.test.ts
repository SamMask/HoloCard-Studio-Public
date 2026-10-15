// T-850 連舞台一起錄：影片與 GIF 的選項小框〔開始匯出〕上面的勾選（假 DOM，真的跑小框）。
// 預設不勾、兩個小框共用同一個選擇、同一次開著工坊記住；舞台「關」時變淡（滑過說明「舞台關著」）、這次照不勾；
// 勾了 GIF 的大小變成寬 480／600／720、預估照同一個選擇重估、多一句小字提醒；不勾時送出的選項和以前完全一樣。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportPanel } from '../src/ui/export-panel';
import { createGifOptions } from '../src/ui/gif-options';
import {
  estimateGifBytes,
  fileSizeText,
  gifSizeLabel,
  gifWidth,
  GIF_STAGE_WIDTHS,
  STAGE_GIF_NOTE,
  STAGE_RECORD_LABEL,
  STAGE_RECORD_OFF_TIP,
  STAGE_RECORD_TIP,
} from '../src/ui/logic';
import { defaultMotion } from '../src/ui/motion-picker';
import { defaultStageRecord } from '../src/ui/stage-record';
import type { GifSample, MotionRequest, StageChoice, UiIntents } from '../src/ui/types';
import { createVideoOptions } from '../src/ui/video-options';
import { all, byClass, FakeEvent, flush, installFakeDom, isShown, type FakeElement } from './ui-fake-dom';

beforeEach(() => {
  installFakeDom();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shown = <T extends { el: HTMLElement }>(box: T): T => {
  box.el.hidden = false;
  return box;
};
const input = (root: unknown) => byClass(root, 'stage-record-input') as FakeElement & { checked: boolean };
const toggle = (root: unknown, on: boolean) => {
  const i = input(root);
  i.checked = on;
  i.dispatchEvent(new FakeEvent('change'));
};
const noMusic = { readMusic: async () => ({ ok: true as const, durationSec: 30 }) };

describe('文字與寬度（ui/logic）', () => {
  it('勾選、說明、舞台關著、GIF 小字', () => {
    expect(STAGE_RECORD_LABEL).toBe('連舞台一起錄');
    expect(STAGE_RECORD_TIP).toBe('畫面跟預覽一樣，舞台、背景圖、前景圖都錄進去（橫的畫面）');
    expect(STAGE_RECORD_OFF_TIP).toBe('舞台關著');
    expect(STAGE_GIF_NOTE).toBe('舞台畫面顏色多，GIF 會比較大；想要好看建議錄影片');
  });

  it('GIF 大小：不勾 320／400／480，勾了 480／600／720；按鈕上的字跟著寫', () => {
    expect(GIF_STAGE_WIDTHS).toEqual({ small: 480, medium: 600, large: 720 });
    expect([gifWidth('small'), gifWidth('medium'), gifWidth('large')]).toEqual([320, 400, 480]);
    expect([gifWidth('small', true), gifWidth('medium', true), gifWidth('large', true)]).toEqual([480, 600, 720]);
    expect(gifSizeLabel('medium')).toBe('中（寬 400）');
    expect(gifSizeLabel('medium', true)).toBe('中（寬 600）');
  });
});

describe('影片的選項小框', () => {
  it('預設不勾：送出的選項和以前一樣（沒有 withStage）；勾了＝withStage true；再打開還勾著', async () => {
    const box = shown(createVideoOptions(noMusic));
    expect(byClass(box.el, 'stage-record').textContent).toBe(STAGE_RECORD_LABEL);
    let asked = box.ask();
    expect(input(box.el).checked).toBe(false);
    byClass(box.el, 'vo-go').click();
    expect(await asked).toEqual({ format: 'mp4', laps: 1, music: null, motion: 'turn', swingDeg: 30, nodDeg: 10 });

    asked = box.ask();
    toggle(box.el, true);
    byClass(box.el, 'vo-go').click();
    expect(await asked).toMatchObject({ withStage: true });

    asked = box.ask();
    expect(input(box.el).checked).toBe(true);
    box.cancel();
    expect(await asked).toBeNull();
  });

  it('舞台關著：變淡（不能勾、說明「舞台關著」）、這次照不勾；記住的選擇不變（換回有舞台時又是勾著）', async () => {
    const stage = defaultStageRecord();
    stage.on = true;
    let on = false;
    const box = shown(createVideoOptions(noMusic, defaultMotion(), stage, () => on));
    let asked = box.ask();
    const label = byClass(box.el, 'stage-record');
    expect(input(box.el).disabled).toBe(true);
    expect(input(box.el).checked).toBe(false);
    expect(label.classList.contains('is-disabled')).toBe(true);
    expect(label.title).toBe(STAGE_RECORD_OFF_TIP);
    byClass(box.el, 'vo-go').click();
    expect(await asked).not.toHaveProperty('withStage');
    expect(stage.on).toBe(true);

    on = true;
    asked = box.ask();
    expect(input(box.el).disabled).toBe(false);
    expect(input(box.el).checked).toBe(true);
    expect(label.classList.contains('is-disabled')).toBe(false);
    expect(label.title).toBe(STAGE_RECORD_TIP);
    byClass(box.el, 'vo-go').click();
    expect(await asked).toMatchObject({ withStage: true });
  });
});

describe('GIF 的選項小框', () => {
  // 試編：不勾 320／480（直的），勾了 480／720（16:9）
  const plainSample: GifSample[] = [
    { bytes: 8 * 320 * 448 * 0.4, frames: 8, width: 320, height: 448 },
    { bytes: 8 * 480 * 672 * 0.35, frames: 8, width: 480, height: 672 },
  ];
  const stageSample: GifSample[] = [
    { bytes: 8 * 720 * 405 * 0.6, frames: 8, width: 720, height: 405 },
    { bytes: 8 * 480 * 270 * 0.7, frames: 8, width: 480, height: 270 },
  ];

  function setup(stageOn = () => true) {
    const calls: (MotionRequest & StageChoice)[] = [];
    const intents: Pick<UiIntents, 'estimateGif'> = {
      estimateGif: async (choice) => {
        calls.push(choice);
        return choice.withStage ? stageSample : plainSample;
      },
    };
    const stage = defaultStageRecord();
    const box = shown(createGifOptions(intents, defaultMotion(), stage, stageOn));
    return { box, calls, stage };
  }
  const labels = (root: unknown) => all(root, 'go-size').map((b) => b.childNodes[0]!.textContent);
  const estimates = (root: unknown) => all(root, 'go-size-est').map((e) => e.textContent);

  it('勾了：大小寫寬 480／600／720、照 16:9 的試編重估（帶 withStage）、多一句小字；送出帶 withStage', async () => {
    const { box, calls } = setup();
    const asked = box.ask();
    await flush();
    expect(labels(box.el)).toEqual(['小（寬 320）', '中（寬 400）', '大（寬 480）']);
    expect(calls).toEqual([{ motion: 'turn', swingDeg: 30, nodDeg: 10 }]);
    expect(isShown(byClass(box.el, 'go-stage-note'))).toBe(false);

    toggle(box.el, true);
    await flush();
    expect(labels(box.el)).toEqual(['小（寬 480）', '中（寬 600）', '大（寬 720）']);
    expect(calls.at(-1)).toEqual({ motion: 'turn', swingDeg: 30, nodDeg: 10, withStage: true });
    expect(estimates(box.el)).toEqual([480, 600, 720].map((w) => fileSizeText(estimateGifBytes(stageSample, w)!)));
    const note = byClass(box.el, 'go-stage-note');
    expect(isShown(note)).toBe(true);
    expect(note.textContent).toBe(STAGE_GIF_NOTE);

    byClass(box.el, 'go-go').click();
    expect(await asked).toEqual({ size: 'medium', motion: 'turn', swingDeg: 30, nodDeg: 10, withStage: true });
  });

  it('不勾：送出的選項和以前一樣；取消勾選＝照直的重估', async () => {
    const { box, calls } = setup();
    const asked = box.ask();
    toggle(box.el, true);
    toggle(box.el, false);
    await flush();
    expect(calls.at(-1)).toEqual({ motion: 'turn', swingDeg: 30, nodDeg: 10 });
    expect(estimates(box.el)).toEqual([320, 400, 480].map((w) => fileSizeText(estimateGifBytes(plainSample, w)!)));
    byClass(box.el, 'go-go').click();
    expect(await asked).toEqual({ size: 'medium', motion: 'turn', swingDeg: 30, nodDeg: 10 });
  });

  it('舞台關著：不能勾、估算與送出都照不勾', async () => {
    const { box, calls, stage } = setup(() => false);
    stage.on = true;
    const asked = box.ask();
    await flush();
    expect(input(box.el).disabled).toBe(true);
    expect(calls).toEqual([{ motion: 'turn', swingDeg: 30, nodDeg: 10 }]);
    expect(labels(box.el)[0]).toBe('小（寬 320）');
    byClass(box.el, 'go-go').click();
    expect(await asked).not.toHaveProperty('withStage');
  });
});

describe('匯出面板：兩個小框共用同一個選擇；舞台開不開問 hooks.stageOn', () => {
  it('影片勾了，打開 GIF 也是勾著；stageOn false 時兩邊都變淡', async () => {
    const intents = {
      exportVideo: vi.fn(async (_options: StageChoice) => 'done' as const),
      exportGif: vi.fn(async (_options: StageChoice) => 'done' as const),
      estimateGif: vi.fn(async (_choice: StageChoice) => null),
      readMusic: noMusic.readMusic,
      canMakeMp4: async () => true,
    };
    let stageOn = true;
    const anchor = document.createElement('div');
    const panel = createExportPanel(intents, { changed() {}, anchor: () => anchor, stageOn: () => stageOn });
    const video = byClass(panel.el, 'video-options');
    const gif = byClass(panel.el, 'gif-options');

    let run = panel.run('webm');
    toggle(video, true);
    byClass(video, 'vo-go').click();
    await run;
    expect(intents.exportVideo.mock.calls[0]![0]).toMatchObject({ withStage: true });

    run = panel.run('gif');
    await flush();
    expect(input(gif).checked).toBe(true);
    expect(intents.estimateGif.mock.calls[0]![0]).toMatchObject({ withStage: true });
    panel.cancel();
    await run;

    stageOn = false;
    run = panel.run('webm');
    expect(input(video).disabled).toBe(true);
    panel.cancel();
    await run;
  });
});
