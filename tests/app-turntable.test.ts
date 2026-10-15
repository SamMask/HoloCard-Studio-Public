import { describe, expect, it } from 'vitest';
import {
  GIF_DELAY_MS,
  loopTimeSpan,
  recordWhileCapturing,
  TURNTABLE,
  TURNTABLE_FPS,
  type CaptureFrames,
  type RecordFrames,
} from '../src/app/files';
import { GIF_MAX_WIDTH } from '../src/file/types';
import { SPARKLE_PERIOD } from '../src/render/holo';

describe('轉一圈影片／GIF 的固定設定（T-504，spec B11：4±0.5 秒一圈）', () => {
  it('一圈 4 秒、80 格', () => {
    expect(TURNTABLE.seconds).toBe(4);
    expect(TURNTABLE.frames).toBe(80);
  });

  it('影片：每秒 20 格，80 格剛好 4.0 秒；寬 720', () => {
    expect(TURNTABLE_FPS).toBe(20);
    expect(TURNTABLE.frames / TURNTABLE_FPS).toBe(4);
    expect(TURNTABLE.webmWidth).toBe(720);
  });

  it('GIF：每格 50 毫秒（GIF 以 10 毫秒為單位，剛好整數），80 格＝4000 毫秒；寬 480 不超過上限', () => {
    expect(GIF_DELAY_MS).toBe(50);
    expect(GIF_DELAY_MS % 10).toBe(0);
    expect(GIF_DELAY_MS * TURNTABLE.frames).toBe(4000);
    expect(TURNTABLE.gifWidth).toBe(480);
    expect(TURNTABLE.gifWidth).toBeLessThanOrEqual(GIF_MAX_WIDTH);
  });

  it('從時間 0 開始、有一點俯仰（轉的時候看得出立體），但不會歪太多', () => {
    expect(TURNTABLE.startTime).toBe(0);
    expect(Math.abs(TURNTABLE.pitchDeg)).toBeGreaterThan(0);
    expect(Math.abs(TURNTABLE.pitchDeg)).toBeLessThanOrEqual(15);
  });

  it('兩種格式長度都在 4±0.5 秒', () => {
    expect(Math.abs(TURNTABLE.frames / TURNTABLE_FPS - 4)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((GIF_DELAY_MS * TURNTABLE.frames) / 1000 - 4)).toBeLessThanOrEqual(0.5);
  });
});

describe('一圈的效果時間：最接近一圈秒數的閃星週期整數倍（GIF 循環接縫不跳）', () => {
  it('4 秒 → 1 倍閃星週期（約 3.49 秒）', () => {
    expect(loopTimeSpan(4, SPARKLE_PERIOD)).toBeCloseTo(SPARKLE_PERIOD, 12);
  });

  it('取最接近的整數倍', () => {
    expect(loopTimeSpan(4, 1.5)).toBeCloseTo(4.5, 12); // 2.67 倍 → 3 倍
    expect(loopTimeSpan(4, 3)).toBeCloseTo(3, 12); // 1.33 倍 → 1 倍
    expect(loopTimeSpan(10, 2)).toBeCloseTo(10, 12);
  });

  it('秒數比週期短很多也至少一倍（不會是 0）', () => {
    expect(loopTimeSpan(1, SPARKLE_PERIOD)).toBeCloseTo(SPARKLE_PERIOD, 12);
  });

  it('結果一定是週期的整數倍', () => {
    for (const seconds of [0.5, 2, 4, 7.3, 12]) {
      const k = loopTimeSpan(seconds, SPARKLE_PERIOD) / SPARKLE_PERIOD;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      expect(Math.round(k)).toBeGreaterThanOrEqual(1);
    }
  });

  it('不合格的輸入丟錯', () => {
    expect(() => loopTimeSpan(0, 1)).toThrow();
    expect(() => loopTimeSpan(4, 0)).toThrow();
    expect(() => loopTimeSpan(Number.NaN, 1)).toThrow();
    expect(() => loopTimeSpan(4, Number.POSITIVE_INFINITY)).toThrow();
  });
});

// ---- 邊拍邊錄：拍好一格就交給錄影（第一格到了才知道高度） ----

const WIDTH = 3;
const HEIGHT = 2;
const frame = (n: number) => new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(n);
const abortError = () => new DOMException('Aborted', 'AbortError');

/** 照 captureTurntable 的樣子：每格等 onFrame 做完才拍下一格；signal 取消就以 AbortError 停。 */
function fakeCapture(count: number, log: string[], failAt?: number): CaptureFrames {
  return async (onFrame, signal) => {
    for (let i = 0; i < count; i++) {
      if (signal.aborted) {
        log.push('capture-aborted');
        throw abortError();
      }
      if (i === failAt) {
        log.push('capture-failed');
        throw new Error('render failed');
      }
      log.push(`shot ${i}`);
      await onFrame(frame(i), i);
    }
    log.push('capture-done');
  };
}

/** 照 recordWebm 的樣子：produce 結束＝錄完；signal 取消或 produce 失敗就停；push 收到的格數記下來。 */
function fakeRecord(log: string[], opts: { failBeforeProduce?: boolean; failPushAt?: number } = {}): RecordFrames & { heights: number[]; got: number[] } {
  const heights: number[] = [];
  const got: number[] = [];
  const record: RecordFrames = (height, produce, signal) =>
    new Promise<Blob>((resolve, reject) => {
      heights.push(height);
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        log.push(`record-stopped ${(err as Error).name === 'AbortError' ? 'abort' : (err as Error).message}`);
        reject(err);
      };
      signal.addEventListener('abort', () => fail(abortError()), { once: true });
      if (opts.failBeforeProduce) {
        queueMicrotask(() => fail(new Error('WebM VP9 and VP8 encoding is not supported')));
        return;
      }
      produce(async (rgba) => {
        if (settled) throw new Error('recorder stopped');
        if (got.length === opts.failPushAt) {
          const err = new Error('encoder broke');
          fail(err);
          throw err;
        }
        got.push(rgba[0]!);
      }).then(
        () => {
          if (settled) return;
          settled = true;
          log.push('record-done');
          resolve(new Blob([new Uint8Array(got)], { type: 'video/webm' }));
        },
        fail,
      );
    });
  return Object.assign(record, { heights, got });
}

describe('邊拍邊錄（影片：拍好一格就交給錄影，不用先把整圈存在記憶體）', () => {
  it('每一格依序交給錄影、回傳錄好的檔；錄影拿到的高度＝第一格算出來的', async () => {
    const log: string[] = [];
    const record = fakeRecord(log);
    const blob = await recordWhileCapturing(WIDTH, fakeCapture(5, log), record);
    expect(record.heights).toEqual([HEIGHT]);
    expect(record.got).toEqual([0, 1, 2, 3, 4]);
    expect(blob.type).toBe('video/webm');
    expect(log.at(-2)).toBe('capture-done');
    expect(log.at(-1)).toBe('record-done');
  });

  it('第一格拍好才開始錄（之前不知道高度）', async () => {
    const log: string[] = [];
    let started = 0;
    const inner = fakeRecord(log);
    const record: RecordFrames = (height, produce, signal) => {
      started++;
      expect(log).toEqual(['shot 0']);
      return inner(height, produce, signal);
    };
    await recordWhileCapturing(WIDTH, fakeCapture(3, log), record);
    expect(started).toBe(1);
  });

  it('還沒開始錄就失敗（例如瀏覽器不能做影片）：以那個錯誤 reject，也不再拍下一格', async () => {
    const log: string[] = [];
    await expect(recordWhileCapturing(WIDTH, fakeCapture(5, log), fakeRecord(log, { failBeforeProduce: true }))).rejects.toThrow(
      'WebM VP9 and VP8 encoding is not supported',
    );
    expect(log.filter((l) => l.startsWith('shot'))).toEqual(['shot 0']);
  });

  it('錄到一半失敗：以那個錯誤 reject，不再拍下一格', async () => {
    const log: string[] = [];
    const record = fakeRecord(log, { failPushAt: 2 });
    await expect(recordWhileCapturing(WIDTH, fakeCapture(6, log), record)).rejects.toThrow('encoder broke');
    expect(record.got).toEqual([0, 1]);
    expect(log).not.toContain('shot 3');
  });

  it('拍到一半失敗：以拍的錯誤 reject，錄影也跟著停（不會一直等下一格）', async () => {
    const log: string[] = [];
    const record = fakeRecord(log);
    await expect(recordWhileCapturing(WIDTH, fakeCapture(6, log, 3), record)).rejects.toThrow('render failed');
    expect(log.some((l) => l.startsWith('record-stopped'))).toBe(true);
    expect(log).not.toContain('record-done');
  });

  it('取消：兩邊都停，以 AbortError reject', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const capture: CaptureFrames = async (onFrame, signal) => {
      for (let i = 0; i < 10; i++) {
        if (signal.aborted) {
          log.push('capture-aborted');
          throw abortError();
        }
        await onFrame(frame(i), i);
        if (i === 2) controller.abort();
      }
    };
    const record = fakeRecord(log);
    const err = await recordWhileCapturing(WIDTH, capture, record, controller.signal).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(log).toContain('capture-aborted');
    expect(log).toContain('record-stopped abort');
    expect(record.got).toEqual([0, 1, 2]);
  });

  it('一開始就取消了：不拍也不錄', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const record = fakeRecord(log);
    const err = await recordWhileCapturing(WIDTH, fakeCapture(3, log), record, controller.signal).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(log).toEqual([]);
    expect(record.heights).toEqual([]);
  });

  it('一格都沒拍到：丟錯（不會一直等）', async () => {
    const log: string[] = [];
    await expect(recordWhileCapturing(WIDTH, fakeCapture(0, log), fakeRecord(log))).rejects.toThrow();
  });
});
