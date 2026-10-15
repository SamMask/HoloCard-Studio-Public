import { describe, expect, it } from 'vitest';
import { captureLaps, MAX_VIDEO_LAPS, TURNTABLE, videoPlan, type CaptureLap } from '../src/app/files';
import { LAP_SECONDS, VIDEO_LAPS, videoSeconds } from '../src/ui/logic';

// T-509b：轉動影片可以選 4／8／12 秒（轉 1～3 圈，同樣速度）；多圈＝同一圈連拍幾次，每圈的效果時間接著走（頭尾無縫）

describe('影片長度換算（n 圈＝n×80 格、n×4 秒）', () => {
  it('1～3 圈', () => {
    expect(videoPlan(1)).toEqual({ laps: 1, frames: 80, seconds: 4 });
    expect(videoPlan(2)).toEqual({ laps: 2, frames: 160, seconds: 8 });
    expect(videoPlan(3)).toEqual({ laps: 3, frames: 240, seconds: 12 });
    expect(MAX_VIDEO_LAPS).toBe(3);
  });

  it('每圈的速度和一圈的設定一樣（每秒格數不變）', () => {
    for (const laps of [1, 2, 3]) {
      const plan = videoPlan(laps);
      expect(plan.frames / plan.seconds).toBe(TURNTABLE.frames / TURNTABLE.seconds);
    }
  });

  it('不合格的圈數丟錯', () => {
    for (const bad of [0, -1, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => videoPlan(bad)).toThrow();
  });

  it('畫面上的秒數和組裝用的一樣（ui 不 import app，兩邊各寫一份，這裡核對）', () => {
    expect(LAP_SECONDS).toBe(TURNTABLE.seconds);
    expect(VIDEO_LAPS).toEqual([1, 2, 3]);
    for (const laps of VIDEO_LAPS) expect(videoSeconds(laps)).toBe(videoPlan(laps).seconds);
  });
});

const abortError = () => new DOMException('Aborted', 'AbortError');

/** 照 captureTurntable 的樣子：一圈 frames 格，每格等 onFrame 做完；記下每圈的起始時間。 */
function fakeLap(frames: number, log: string[], starts: number[], failOnLap?: number): CaptureLap {
  let lap = 0;
  return async (startTime, onFrame, signal) => {
    const k = lap++;
    starts.push(startTime);
    if (k === failOnLap) throw new Error('render failed');
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) {
        log.push('aborted');
        throw abortError();
      }
      await onFrame(new Uint8ClampedArray([k, i]), i);
    }
  };
}

describe('多圈連拍（captureLaps）', () => {
  it('一圈一圈拍，畫格編號接著算；第 k 圈從 startTime＋k×timeSpan 開始', async () => {
    const starts: number[] = [];
    const got: string[] = [];
    const capture = captureLaps(3, 4, 0.5, 2, fakeLap(4, [], starts));
    await capture(async (rgba, index) => {
      got.push(`${index}:${rgba[0]}-${rgba[1]}`);
    }, new AbortController().signal);
    expect(starts).toEqual([0.5, 2.5, 4.5]);
    expect(got).toEqual(['0:0-0', '1:0-1', '2:0-2', '3:0-3', '4:1-0', '5:1-1', '6:1-2', '7:1-3', '8:2-0', '9:2-1', '10:2-2', '11:2-3']);
  });

  it('一圈＝原本的樣子（只拍一次、從 startTime 開始）', async () => {
    const starts: number[] = [];
    let count = 0;
    await captureLaps(1, 80, 0, 3.49, fakeLap(80, [], starts))(async () => {
      count++;
    }, new AbortController().signal);
    expect(starts).toEqual([0]);
    expect(count).toBe(80);
  });

  it('第 k 圈的起始時間＝上一圈「再下一格」的時間（圈與圈之間時間連續，不跳）', async () => {
    const frames = 80;
    const timeSpan = 3.49;
    const starts: number[] = [];
    await captureLaps(3, frames, 0, timeSpan, fakeLap(frames, [], starts))(async () => {}, new AbortController().signal);
    for (let k = 1; k < 3; k++) {
      const nextOfPrevious = starts[k - 1]! + (frames * timeSpan) / frames;
      expect(starts[k]).toBeCloseTo(nextOfPrevious, 12);
    }
  });

  it('取消：停在那一圈，不再拍下一圈', async () => {
    const log: string[] = [];
    const starts: number[] = [];
    const controller = new AbortController();
    let seen = 0;
    const err = await captureLaps(3, 4, 0, 1, fakeLap(4, log, starts))(async () => {
      seen++;
      if (seen === 6) controller.abort();
    }, controller.signal).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(starts).toEqual([0, 1]);
    expect(seen).toBe(6);
  });

  it('已經取消了：一圈都不拍', async () => {
    const starts: number[] = [];
    const controller = new AbortController();
    controller.abort();
    const err = await captureLaps(2, 4, 0, 1, fakeLap(4, [], starts))(async () => {}, controller.signal).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(starts).toEqual([]);
  });

  it('某一圈失敗：以那個錯誤停下，不拍後面的圈', async () => {
    const starts: number[] = [];
    await expect(captureLaps(3, 4, 0, 1, fakeLap(4, [], starts, 1))(async () => {}, new AbortController().signal)).rejects.toThrow(
      'render failed',
    );
    expect(starts).toEqual([0, 1]);
  });

  it('不合格的參數丟錯', () => {
    const lap = fakeLap(4, [], []);
    expect(() => captureLaps(0, 4, 0, 1, lap)).toThrow();
    expect(() => captureLaps(2, 0, 0, 1, lap)).toThrow();
    expect(() => captureLaps(2, 4, 0, 0, lap)).toThrow();
    expect(() => captureLaps(2, 4, Number.NaN, 1, lap)).toThrow();
  });
});
