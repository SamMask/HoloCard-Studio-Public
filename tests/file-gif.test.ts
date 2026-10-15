import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPaletteLookup, encodeGifFrames, getDitherSpan } from '../src/file/gif-encode';
import { encodeGif } from '../src/file/gif';
import type { GifOptions } from '../src/file/types';

const OPTIONS: GifOptions = { width: 4, height: 4, delayMs: 67 };

function solid(width: number, height: number, rgb = [30, 60, 90]): Uint8ClampedArray {
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) frame.set([...rgb, 255], i);
  return frame;
}

function colorfulGradient(width: number, height: number): Uint8ClampedArray {
  const frame = solid(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    frame.set([
      Math.round(x * 255 / (width - 1)),
      Math.round((Math.floor(y / 4) % 8) * 200 / 7 + x / (width - 1) * 55),
      Math.round(Math.floor(y / 32) * 200 / (height / 32 - 1) + x / (width - 1) * 55),
      255,
    ], (y * width + x) * 4);
  }
  return frame;
}

// Independent GIF block parser and LZW decoder: inspect the actual encoded output.
function decodeLzw(data: number[], minSize: number): Uint8Array {
  const clear = 1 << minSize;
  const end = clear + 1;
  let dictionary: number[][] = [];
  let size = minSize + 1;
  let bit = 0;
  let previous: number[] | undefined;
  const output: number[] = [];
  const reset = () => {
    dictionary = Array.from({ length: clear }, (_, i) => [i]);
    dictionary.push([], []);
    size = minSize + 1;
    previous = undefined;
  };
  reset();
  while (bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === end) return Uint8Array.from(output);
    const entry = dictionary[code] ?? (code === dictionary.length && previous ? [...previous, previous[0]] : undefined);
    if (!entry) throw new Error('Invalid LZW code');
    for (const value of entry) output.push(value);
    if (previous && dictionary.length < 4096) {
      dictionary.push([...previous, entry[0]]);
      if (dictionary.length === 1 << size && size < 12) size++;
    }
    previous = entry;
  }
  throw new Error('Missing LZW end code');
}

function parseGif(bytes: Uint8Array, decode = false) {
  const ascii = (start: number, length: number) => new TextDecoder().decode(bytes.subarray(start, start + length));
  const u16 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8;
  expect(ascii(0, 6)).toBe('GIF89a');
  const width = u16(6), height = u16(8), packed = bytes[10];
  let cursor = 13;
  const globalColors: number[][] = [];
  if (packed & 128) {
    for (let i = 0; i < 1 << ((packed & 7) + 1); i++) {
      globalColors.push(Array.from(bytes.subarray(cursor, cursor + 3)));
      cursor += 3;
    }
  }
  const subBlocks = () => {
    const data: number[] = [];
    while (true) {
      const length = bytes[cursor++];
      if (length === 0) return data;
      if (length === undefined || cursor + length > bytes.length) throw new Error('Truncated GIF');
      for (let i = 0; i < length; i++) data.push(bytes[cursor++]);
    }
  };
  const images: { width: number; height: number; local: boolean; delay: number; pixels?: Uint8Array }[] = [];
  let delay = 0;
  let repeat: number | undefined;
  let application: string | undefined;
  while (cursor < bytes.length) {
    const marker = bytes[cursor++];
    if (marker === 0x3b) {
      expect(cursor).toBe(bytes.length);
      return { width, height, globalColors, images, application, repeat };
    }
    if (marker === 0x21) {
      const label = bytes[cursor++];
      if (label === 0xf9) {
        expect(bytes[cursor++]).toBe(4);
        delay = u16(cursor + 1);
        cursor += 4;
        expect(bytes[cursor++]).toBe(0);
      } else if (label === 0xff) {
        const length = bytes[cursor++];
        application = ascii(cursor, length);
        cursor += length;
        const data = subBlocks();
        if (application === 'NETSCAPE2.0') repeat = data[1] | data[2] << 8;
      } else subBlocks();
    } else if (marker === 0x2c) {
      const frameWidth = u16(cursor + 4), frameHeight = u16(cursor + 6);
      const imagePacked = bytes[cursor + 8];
      cursor += 9;
      const local = Boolean(imagePacked & 128);
      if (local) cursor += 3 * (1 << ((imagePacked & 7) + 1));
      const minSize = bytes[cursor++];
      const data = subBlocks();
      const pixels = decode ? decodeLzw(data, minSize) : undefined;
      if (pixels) expect(pixels.length).toBe(frameWidth * frameHeight);
      images.push({ width: frameWidth, height: frameHeight, local, delay, pixels });
    } else throw new Error(`Unexpected GIF block ${marker}`);
  }
  throw new Error('Missing GIF trailer');
}

describe('GIF frame encoder', () => {
  it.each([
    { width: 0 }, { width: -1 }, { width: 721 }, { width: 1.5 }, { width: NaN }, { width: Infinity },
    { height: 0 }, { height: -1 }, { height: 1.5 }, { height: NaN }, { height: Infinity }, { height: 65536 },
    { delayMs: 0 }, { delayMs: -1 }, { delayMs: NaN }, { delayMs: Infinity }, { delayMs: 655360 },
  ])('rejects invalid options %j', (invalid) => {
    expect(() => encodeGifFrames([solid(4, 4)], { ...OPTIONS, ...invalid })).toThrow();
  });

  it('rejects missing, incorrectly sized or non-opaque frames before reporting progress', () => {
    const progress = vi.fn();
    expect(() => encodeGifFrames([], OPTIONS, progress)).toThrow();
    expect(() => encodeGifFrames([solid(4, 4), solid(3, 4)], OPTIONS, progress)).toThrow();
    const transparent = solid(4, 4);
    transparent[3] = 254;
    expect(() => encodeGifFrames([transparent], OPTIONS, progress)).toThrow();
    expect(progress).not.toHaveBeenCalled();
  });

  it('writes one global palette, full frames, an infinite loop, rounded delays and progress', () => {
    const progress = vi.fn();
    const frames = [solid(4, 4, [255, 0, 0]), solid(4, 4, [0, 255, 0]), solid(4, 4, [0, 0, 255])];
    const gif = parseGif(encodeGifFrames(frames, OPTIONS, progress), true);
    expect([gif.width, gif.height]).toEqual([4, 4]);
    expect(gif.application).toBe('NETSCAPE2.0');
    expect(gif.repeat).toBe(0);
    expect(gif.globalColors).toEqual(expect.arrayContaining([[255, 0, 0], [0, 255, 0], [0, 0, 255]]));
    expect(gif.images).toHaveLength(3);
    gif.images.forEach((image, i) => {
      expect(image).toMatchObject({ width: 4, height: 4, local: false, delay: 7 });
      expect(gif.globalColors[image.pixels![0]]).toEqual(Array.from(frames[i].subarray(0, 3)));
    });
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it.each([[1, 2], [19, 2], [20, 2], [24, 2], [25, 3], [65, 7], [655350, 65535]])(
    'writes delay %s ms as %s centiseconds', (delayMs, expected) => {
      const gif = parseGif(encodeGifFrames([solid(4, 4)], { ...OPTIONS, delayMs }));
      expect(gif.images[0].delay).toBe(expected);
    },
  );

  it('respects offset views and leaves all input bytes unchanged with dithering on or off', () => {
    const buffer = solid(6, 4, [180, 40, 90]);
    const frame = buffer.subarray(4, 4 + 4 * 4 * 4);
    const before = buffer.slice();
    for (const dither of [true, false]) {
      const gif = parseGif(encodeGifFrames([frame], OPTIONS, undefined, { dither }), true);
      expect(gif.images[0].pixels).toHaveLength(16);
      expect(gif.globalColors[gif.images[0].pixels![0]]).toEqual([180, 40, 90]);
    }
    expect(buffer).toEqual(before);
  });

  it('improves all three channels of a colorful gradient with more than 256 colors', () => {
    const width = 128, height = 128;
    const gradient = colorfulGradient(width, height);
    const sourceColors = new Set(Array.from({ length: width * height }, (_, i) => gradient.slice(i * 4, i * 4 + 3).join(',')));
    expect(sourceColors.size).toBeGreaterThan(256);
    const options = { width, height, delayMs: 67 };
    const plain = parseGif(encodeGifFrames([gradient], options, undefined, { dither: false }), true);
    const dithered = parseGif(encodeGifFrames([gradient], options), true);
    expect(dithered.globalColors).toEqual(plain.globalColors);
    const metrics = (gif: ReturnType<typeof parseGif>, channel: number) => {
      const means: number[] = [];
      let squaredError = 0;
      for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
        let sum = 0, source = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
          const pixel = (y + dy) * width + x + dx;
          sum += gif.globalColors[gif.images[0].pixels![pixel]][channel];
          source += gradient[pixel * 4 + channel];
        }
        const mean = sum / 16;
        means.push(mean);
        squaredError += (mean - source / 16) ** 2;
      }
      return { levels: new Set(means).size, rmse: Math.sqrt(squaredError / means.length) };
    };
    const metricsByChannel = [0, 1, 2].map((channel) => ({ before: metrics(plain, channel), after: metrics(dithered, channel) }));
    const span = getDitherSpan(dithered.globalColors);
    process.stdout.write(`GIF colorful gradient span: ${span.toFixed(2)}, RGB: ${JSON.stringify(metricsByChannel)}\n`);
    expect(span).toBeGreaterThan(12);
    for (const { before, after } of metricsByChannel) {
      expect(after.levels).toBeGreaterThan(before.levels * 1.25);
      expect(after.rmse).toBeLessThan(before.rmse * 0.85);
    }
    // This fixture requires more than the former fixed span of 8 to smooth red.
    expect(metricsByChannel[0].after.rmse).toBeLessThan(metricsByChannel[0].before.rmse * 0.65);
  });

  it('derives dither span from median nearest-neighbor RGB distances and clamps it', () => {
    expect(getDitherSpan([[0, 0, 0]])).toBe(8);
    expect(getDitherSpan([[0, 0, 0], [1, 1, 1]])).toBe(8);
    expect(getDitherSpan([[0, 0, 0], [20, 20, 20], [40, 40, 40], [100, 100, 100]])).toBeCloseTo(20);
    // Even counts use the average of the two middle distances.
    expect(getDitherSpan([[0, 0, 0], [10, 10, 10], [100, 100, 100], [130, 130, 130]])).toBeCloseTo(20);
    expect(getDitherSpan([[0, 0, 0], [255, 255, 255]])).toBe(32);
  });

  it('builds one 5-bit-per-channel nearest-color lookup using bin centers', () => {
    const lookup = buildPaletteLookup([[0, 0, 0], [255, 255, 255], [128, 128, 128]]);
    expect(lookup).toBeInstanceOf(Uint8Array);
    expect(lookup).toHaveLength(32768);
    expect(lookup[0]).toBe(0);
    expect(lookup[32767]).toBe(1);
    expect(lookup[(16 << 10) | (16 << 5) | 16]).toBe(2);
  });

  it('keeps static pixel indices identical despite changing pixels earlier in a frame', () => {
    const width = 128, height = 64;
    const first = solid(width, height);
    let seed = 12345;
    for (let i = 0; i < first.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      first.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], i);
    }
    const second = first.slice();
    for (let pixel = 0; pixel < width * 8; pixel++) {
      second.set(first.subarray((width * 8 - pixel - 1) * 4, (width * 8 - pixel) * 4), pixel * 4);
    }
    for (const dither of [false, true]) {
      const gif = parseGif(encodeGifFrames([first, second, first], { width, height, delayMs: 67 }, undefined, { dither }), true);
      expect(gif.images[0].pixels).toEqual(gif.images[2].pixels);
      const mismatches = gif.images[0].pixels!.slice(width * 8).reduce((count, index, i) => count + Number(index !== gif.images[1].pixels![width * 8 + i]), 0);
      process.stdout.write(`GIF static-region mismatches (dither=${dither}): ${mismatches}\n`);
      expect(mismatches).toBe(0);
    }
  });

  it('keeps a dark flat background free from strong ordered-dot variation', () => {
    const width = 128, height = 128;
    const frame = colorfulGradient(width, height);
    for (let y = 16; y < 48; y++) for (let x = 32; x < 96; x++) frame.set([12, 16, 24, 255], (y * width + x) * 4);
    const gif = parseGif(encodeGifFrames([frame], { width, height, delayMs: 67 }), true);
    const variances = [0, 1, 2].map((channel) => {
      const values: number[] = [];
      for (let y = 16; y < 48; y++) for (let x = 32; x < 96; x++) values.push(gif.globalColors[gif.images[0].pixels![y * width + x]][channel]);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    });
    const span = getDitherSpan(gif.globalColors);
    process.stdout.write(`GIF dark flat span: ${span.toFixed(2)}, RGB variance: ${JSON.stringify(variances)}\n`);
    expect(span).toBeGreaterThan(12);
    // Standard deviation <= 2 levels on the 0–255 scale bounds flat-area dots.
    expect(Math.max(...variances)).toBeLessThanOrEqual(4);
  });

  it('encodes 60 full-size changing frames and reports the measured time', () => {
    const width = 480, height = 672;
    const frames = Array.from({ length: 60 }, (_, f) => {
      const frame = solid(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        frame[i] = Math.round(x * 120 / (width - 1));
        frame[i + 1] = Math.round(y * 255 / (height - 1));
        frame[i + 2] = Math.round(f * 255 / 59);
      }
      // This static detail falls between the original sampler's 13 columns.
      for (let y = 40; y < 64; y++) for (let x = 44; x < 68; x++) frame.set([255, 90, 0, 255], (y * width + x) * 4);
      return frame;
    });
    const progress = vi.fn();
    const start = performance.now();
    progress.mockImplementationOnce(() => process.stdout.write(`GIF preparation + first frame: ${(performance.now() - start).toFixed(1)} ms\n`));
    const bytes = encodeGifFrames(frames, { width, height, delayMs: 67 }, progress);
    const elapsed = performance.now() - start;
    process.stdout.write(`GIF benchmark: 60 × 480×672 = ${elapsed.toFixed(1)} ms, ${bytes.length} bytes\n`);
    const gif = parseGif(bytes);
    expect(gif.images).toHaveLength(60);
    expect(gif.images.every((image) => !image.local && image.delay === 7)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(60, 60);
    const detailDistance = Math.min(...gif.globalColors.map(([r, g, b]) => Math.hypot(r - 255, g - 90, b)));
    process.stdout.write(`GIF static orange detail RGB distance: ${detailDistance.toFixed(2)}\n`);
    expect(detailDistance).toBeLessThan(24);
  }, 60_000);
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((message: unknown, transfer: Transferable[]) => {
    this.received = structuredClone(message, { transfer });
  });
  received: unknown;
  constructor(readonly url: URL, readonly options: WorkerOptions) { FakeWorker.instances.push(this); }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWorker.instances = [];
});

describe('GIF Worker wrapper', () => {
  it('rejects an already-aborted signal without constructing a Worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    controller.abort();
    const promise = encodeGif([solid(4, 4)], OPTIONS, undefined, controller.signal);
    expect(FakeWorker.instances).toHaveLength(0);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError', message: 'Aborted' });
  });

  it('aborts encoding immediately, terminates the Worker and removes its listeners', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const progress = vi.fn();
    const promise = encodeGif([solid(4, 4)], OPTIONS, progress, controller.signal);
    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'progress', done: 1, total: 2 });
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError', message: 'Aborted' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect([worker.onmessage, worker.onerror, worker.onmessageerror]).toEqual([null, null, null]);
    worker.emit({ type: 'progress', done: 2, total: 2 });
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it.each(['result', 'error'])('removes the abort listener after %s settlement', async (type) => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = encodeGif([solid(4, 4)], OPTIONS, undefined, controller.signal);
    const worker = FakeWorker.instances[0];
    if (type === 'result') {
      worker.emit({ type, bytes: new ArrayBuffer(1) });
      await promise;
    } else {
      const rejection = expect(promise).rejects.toThrow('Failed');
      worker.emit({ type, message: 'Failed' });
      await rejection;
    }
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('uses a module Worker, transfers exact copies, forwards progress and returns a GIF Blob', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const backing = solid(6, 4);
    const frame = backing.subarray(4, 68);
    const before = backing.slice();
    const progress = vi.fn();
    const promise = encodeGif([frame, frame], OPTIONS, progress);
    const worker = FakeWorker.instances[0];
    expect(worker.url.pathname).toMatch(/\/gif-worker\.ts$/);
    expect(worker.options).toEqual({ type: 'module' });
    const [request, transfer] = worker.postMessage.mock.calls[0];
    expect(transfer).toHaveLength(2);
    expect(transfer.every((buffer) => buffer instanceof ArrayBuffer && buffer.byteLength === 0)).toBe(true);
    const received = worker.received as { frames: ArrayBuffer[]; options: GifOptions };
    expect(received.options).toEqual(OPTIONS);
    expect(received.frames.map((buffer) => new Uint8ClampedArray(buffer))).toEqual([frame, frame]);
    expect(request).toHaveProperty('options', OPTIONS);
    expect(backing).toEqual(before);
    worker.emit({ type: 'progress', done: 1, total: 2 });
    const bytes = encodeGifFrames([frame], OPTIONS);
    worker.emit({ type: 'result', bytes: bytes.buffer });
    const blob = await promise;
    expect(blob.type).toBe('image/gif');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(progress).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });

  it.each(['reported', 'runtime', 'message'])('rejects %s errors and terminates the Worker', async (kind) => {
    vi.stubGlobal('Worker', FakeWorker);
    const promise = encodeGif([solid(4, 4)], OPTIONS);
    const rejection = expect(promise).rejects.toThrow();
    const worker = FakeWorker.instances[0];
    if (kind === 'reported') worker.emit({ type: 'error', message: 'Invalid frame' });
    else if (kind === 'runtime') worker.onerror?.({ message: 'Worker failed', preventDefault: vi.fn() } as unknown as ErrorEvent);
    else worker.onmessageerror?.({} as MessageEvent);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects Worker construction, transfer and progress callback errors', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Cannot start'); } });
    await expect(encodeGif([solid(4, 4)], OPTIONS)).rejects.toThrow('Cannot start');
    vi.stubGlobal('Worker', FakeWorker);
    const progress = () => { throw new Error('Callback failed'); };
    const promise = encodeGif([solid(4, 4)], OPTIONS, progress);
    const rejection = expect(promise).rejects.toThrow('Callback failed');
    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'progress', done: 1, total: 1 });
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    class TransferFailureWorker extends FakeWorker {
      override postMessage = vi.fn((_message: unknown, _transfer: Transferable[]) => { throw new Error('Transfer failed'); });
    }
    vi.stubGlobal('Worker', TransferFailureWorker);
    await expect(encodeGif([solid(4, 4)], OPTIONS)).rejects.toThrow('Transfer failed');
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
  });
});

describe('GIF Worker handler', () => {
  it('encodes transferred buffers, posts progress and transfers the result', async () => {
    const scope = { onmessage: null as null | ((event: MessageEvent) => void), postMessage: vi.fn() };
    vi.stubGlobal('self', scope);
    await import('../src/file/gif-worker');
    scope.onmessage!({ data: { frames: [solid(4, 4).buffer], options: OPTIONS } } as MessageEvent);
    expect(scope.postMessage.mock.calls[0][0]).toEqual({ type: 'progress', done: 1, total: 1 });
    const [result, transfer] = scope.postMessage.mock.calls[1];
    expect(result.type).toBe('result');
    expect(transfer).toEqual([result.bytes]);
    expect(parseGif(new Uint8Array(result.bytes)).images).toHaveLength(1);
    scope.postMessage.mockClear();
    scope.onmessage!({ data: { frames: [], options: OPTIONS } } as MessageEvent);
    expect(scope.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'error', message: expect.any(String) });
  });
});
