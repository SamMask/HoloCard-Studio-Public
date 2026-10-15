import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebmRecorder, recordWebm } from '../src/file/webm';

const options = { width: 2, height: 2, fps: 20 };
const rgba = () => new Uint8ClampedArray(16).fill(255);
const VP9 = 'vp09.00.40.08';

async function duration(blob: Blob): Promise<number> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < bytes.length - 10; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88) return new DataView(bytes.buffer).getFloat64(i + 3);
  }
  throw new Error('Missing Duration');
}

describe('WebCodecs WebM recorder', () => {
  let encoder: FakeEncoder;
  let encoders: FakeEncoder[];
  let inputs: AllowSharedBufferSource[];
  let firstCallbackError: boolean;
  let configureVp9Error: boolean;
  let configureVp9Callback: boolean;
  let frames: FakeFrame[];
  let keys: boolean[];
  let supported: string[];
  let queued: boolean;
  let flushWork: (() => Promise<void>) | undefined;
  let encodeError: Error | undefined;
  let configureError: Error | undefined;
  let frameError: Error | undefined;
  let deferOutput: boolean;
  let outputs: (() => void)[];
  class FakeFrame {
    data: Uint8Array;
    close = vi.fn();
    constructor(data: AllowSharedBufferSource, public init: VideoFrameBufferInit) {
      if (frameError) throw frameError;
      inputs.push(data);
      const view = data as Uint8Array;
      this.data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
      frames.push(this);
    }
  }
  class FakeEncoder extends EventTarget {
    static isConfigSupported = vi.fn(async (config: VideoEncoderConfig): Promise<VideoEncoderSupport> => ({ supported: supported.includes(config.codec), config }));
    state: CodecState = 'unconfigured';
    encodeQueueSize = 0;
    config?: VideoEncoderConfig;
    configure = vi.fn((config: VideoEncoderConfig) => {
      if (configureError || (configureVp9Error && config.codec === VP9)) throw configureError ?? new Error('VP9 configure failed');
      if (configureVp9Callback && config.codec === VP9) this.init.error(new DOMException('VP9 configure callback failed', 'EncodingError'));
      this.config = config; this.state = 'configured';
    });
    close = vi.fn(() => { this.state = 'closed'; });
    flush = vi.fn(async () => { await flushWork?.(); outputs.forEach(output => output()); outputs = []; });
    encode(frame: { close(): void }, opts: VideoEncoderEncodeOptions) {
      if (this.state !== 'configured') throw new DOMException('Encoder is not configured', 'InvalidStateError');
      if (firstCallbackError && this.config?.codec === VP9) { queueMicrotask(() => this.init.error(new DOMException('VP9 first frame failed', 'EncodingError'))); return; }
      if (encodeError) throw encodeError;
      const value = frame as FakeFrame;
      keys.push(!!opts.keyFrame);
      this.encodeQueueSize = queued ? this.encodeQueueSize + 1 : 0;
      const payload = Uint8Array.of(frames.length, 42);
      const output = () => {
        this.init.output({ byteLength: payload.length, timestamp: value.init.timestamp,
          duration: value.init.duration ?? null, type: opts.keyFrame ? 'key' : 'delta',
          copyTo: destination => { (destination as Uint8Array).set(payload); } });
        payload.fill(0);
      };
      if (deferOutput) outputs.push(output); else output();
    }
    constructor(public init: VideoEncoderInit) { super(); encoder = this; encoders.push(this); }
    drain(size = 0) { this.encodeQueueSize = size; this.dispatchEvent(new Event('dequeue')); }
  }
  const record = () => createWebmRecorder({ VideoEncoder: FakeEncoder, VideoFrame: FakeFrame });
  function audioFixture() {
    const data: FakeAudioData[] = []; let audioEncoder!: FakeAudioEncoder;
    let queue = false; let flushWork: (() => Promise<void>) | undefined;
    let description: Uint8Array | undefined; let timestampOffset = 0;
    let tailTimestamp = 100000; let tailPacket = false; let nullDuration = false;
    let failureStage: string | undefined; const error = new DOMException('audio failed', 'EncodingError');
    class FakeAudioData {
      close = vi.fn();
      constructor(public init: AudioDataInit) { if (failureStage === 'data') throw error; data.push(this); }
    }
    class FakeAudioEncoder extends EventTarget {
      static isConfigSupported = vi.fn(async (config: AudioEncoderConfig) => ({ supported: true, config }));
      state: CodecState = 'unconfigured'; encodeQueueSize = 0;
      configure = vi.fn((_config: AudioEncoderConfig) => { if (failureStage === 'configure') throw error; this.state = 'configured'; });
      close = vi.fn(() => { this.state = 'closed'; });
      pending: FakeAudioData[] = [];
      encode(value: { close(): void }) {
        if (this.state !== 'configured') throw new Error('closed audio encoder');
        if (failureStage === 'encode') throw error;
        if (failureStage === 'callback') { this.init.error(error); return; }
        this.pending.push(value as FakeAudioData); this.encodeQueueSize = queue ? this.encodeQueueSize + 1 : 0;
      }
      flush = vi.fn(async () => {
        if (failureStage === 'flush') throw error;
        await flushWork?.();
        for (const value of this.pending) this.init.output({ timestamp: value.init.timestamp + timestampOffset,
          duration: Math.round(value.init.numberOfFrames / 48000 * 1e6), type: 'key', byteLength: 2,
          copyTo: target => { if (failureStage === 'copy') throw error; (target as Uint8Array).set([55, 66]); },
        }, description ? { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description } } : undefined);
        if (tailPacket) this.init.output({ timestamp: tailTimestamp, duration: nullDuration ? null : 20000, type: 'key', byteLength: 1,
          copyTo: target => { (target as Uint8Array).set([77]); } });
        description?.fill(0); // Output-owned memory must be copied by the recorder.
        this.pending = [];
      });
      constructor(public init: AudioEncoderInit) { super(); audioEncoder = this; }
      drain() { this.encodeQueueSize = 0; this.dispatchEvent(new Event('dequeue')); }
    }
    return {
      record: createWebmRecorder({ VideoEncoder: FakeEncoder, VideoFrame: FakeFrame, AudioEncoder: FakeAudioEncoder, AudioData: FakeAudioData }),
      data, Encoder: FakeAudioEncoder, get encoder() { return audioEncoder; },
      setQueue: () => { queue = true; }, setFlush: (work: () => Promise<void>) => { flushWork = work; },
      setDescription: (head: Uint8Array) => { description = head; }, setOffset: (offset: number) => { timestampOffset = offset; },
      addTailPacket: (timestamp = 100000) => { tailPacket = true; tailTimestamp = timestamp; },
      omitDuration: () => { nullDuration = true; },
      failAt: (stage: string) => { failureStage = stage; return error; },
    };
  }
  beforeEach(() => {
    encoders = []; inputs = []; firstCallbackError = false; configureVp9Error = false; configureVp9Callback = false;
    frames = []; keys = []; supported = [VP9]; queued = false; flushWork = undefined; encodeError = undefined;
    configureError = undefined; frameError = undefined; deferOutput = false; outputs = [];
    FakeEncoder.isConfigSupported.mockClear();
  });
  it.each([48000, 24000])('encodes planar stereo Opus and pads mono to video duration at %s Hz input', async sampleRate => {
    const audio = audioFixture(); const source = Float32Array.from({ length: sampleRate * 0.03 }, (_, i) => i / sampleRate);
    const blob = await audio.record({ ...options, audio: { sampleRate, channels: [source] } }, async push => { await push(rgba()); await push(rgba()); });
    expect(audio.encoder.configure).toHaveBeenCalledWith({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
      opus: { frameDuration: 20000 } });
    expect(audio.data.reduce((n, d) => n + d.init.numberOfFrames, 0)).toBe(4800);
    expect(audio.data.map(d => d.init.timestamp)).toEqual([0, 20000, 40000, 60000, 80000]);
    const planar = audio.data.flatMap(d => {
      expect(d.init).toMatchObject({ format: 'f32-planar', sampleRate: 48000, numberOfChannels: 2 });
      const values = d.init.data as Float32Array;
      expect(values.slice(0, d.init.numberOfFrames)).toEqual(values.slice(d.init.numberOfFrames));
      expect(d.close).toHaveBeenCalledOnce(); return Array.from(values.slice(0, d.init.numberOfFrames));
    });
    for (const i of [1, 3, 479, 961, 1437]) expect(planar[i]).toBeCloseTo(i / 48000, 8);
    expect(encoder.close).toHaveBeenCalledOnce(); expect(planar.slice(1440).every(x => x === 0)).toBe(true);
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toContain('A_OPUS');
    expect(audio.encoder.flush).toHaveBeenCalledOnce(); expect(audio.encoder.close).toHaveBeenCalledOnce();
    expect(await duration(blob)).toBe(100);
  });
  it('closes video immediately after its final flush before encoding audio', async () => {
    const audio = audioFixture();
    audio.setFlush(async () => { expect(encoder.state).toBe('closed'); expect(encoder.close).toHaveBeenCalledOnce(); });
    await audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } }, async push => { await push(rgba()); });
    expect(encoder.close.mock.invocationCallOrder[0]).toBeLessThan(audio.data[0].close.mock.invocationCallOrder[0]);
    expect(encoder.close).toHaveBeenCalledOnce();
  });
  it('drops a tail packet starting exactly at duration plus codec delay', async () => {
    const audio = audioFixture(); audio.addTailPacket(106500);
    const blob = await audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } },
      async push => { await push(rgba()); await push(rgba()); });
    expect(await duration(blob)).toBe(100);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes).join(',')).not.toContain('130,0,107,0,77');
    expect(new TextDecoder().decode(bytes)).toContain('A_OPUS');
  });
  it('truncates stereo, preserves channels and sends a partial final batch', async () => {
    const audio = audioFixture();
    await audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800).fill(0.2), new Float32Array(4800).fill(-0.4)] } },
      async push => { await push(rgba()); });
    expect(audio.data.map(d => d.init.numberOfFrames)).toEqual([960, 960, 480]);
    const values = audio.data[2].init.data as Float32Array;
    expect(values[479]).toBeCloseTo(0.2); expect(values[480]).toBeCloseTo(-0.4);
  });
  it('uses copied encoder OpusHead and normalizes negative codec-delay timestamps', async () => {
    const audio = audioFixture(); const head = new Uint8Array(19);
    head.set(new TextEncoder().encode('OpusHead')); head[8] = 1; head[9] = 2;
    new DataView(head.buffer).setUint16(10, 480, true); new DataView(head.buffer).setUint32(12, 48000, true);
    const expected = head.slice(); audio.setDescription(head); audio.setOffset(-10000);
    const blob = await audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } }, async push => { await push(rgba()); });
    expect(new Uint8Array(await blob.arrayBuffer()).join(',')).toContain(Array.from(expected).join(','));
    expect(new Uint8Array(await blob.arrayBuffer()).join(',')).toContain('130,0,0,128,55,66');
  });
  it.each([false, true])('retains the flush packet and trims its padded end (missing duration: %s)', async missingDuration => {
    const audio = audioFixture(); audio.addTailPacket();
    if (missingDuration) audio.omitDuration();
    const blob = await audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } },
      async push => { await push(rgba()); await push(rgba()); });
    const bytes = new Uint8Array(await blob.arrayBuffer()); const text = Array.from(bytes).join(',');
    expect(text).toContain('161,133,130,0,100,0,77');
    // DiscardPadding = 20 ms tail - 6.5 ms decoder pre-skip, signed big-endian.
    expect(text).toContain('117,162,132,0,205,254,96');
    expect(await duration(blob)).toBe(100);
  });
  it('reports absent AudioEncoder and unsupported Opus before producing video', async () => {
    const produce = vi.fn(); const withAudio = { ...options, audio: { sampleRate: 48000, channels: [new Float32Array(10)] } };
    await expect(record()(withAudio, produce)).rejects.toThrow(/AudioEncoder.*not supported/);
    const audio = audioFixture(); audio.Encoder.isConfigSupported.mockResolvedValueOnce({ supported: false, config: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 } });
    await expect(audio.record(withAudio, produce)).rejects.toThrow(/Opus.*not supported/); expect(produce).not.toHaveBeenCalled();
    await expect(createWebmRecorder({ VideoEncoder: FakeEncoder, VideoFrame: FakeFrame, AudioEncoder: audio.Encoder })(withAudio, produce)).rejects.toThrow(/AudioData.*not supported/);
    audio.Encoder.isConfigSupported.mockRejectedValueOnce(new Error('codec probe failed'));
    await expect(audio.record(withAudio, produce)).rejects.toThrow(/Opus.*not supported/);
  });
  it.each(['configure', 'data', 'encode', 'callback', 'flush', 'copy'])('closes both encoders and preserves audio %s errors', async stage => {
    const audio = audioFixture(); const error = audio.failAt(stage);
    await expect(audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } },
      async push => { await push(rgba()); })).rejects.toBe(error);
    expect(encoder.close).toHaveBeenCalledOnce(); expect(audio.encoder.close).toHaveBeenCalledOnce();
    expect(audio.data.every(d => d.close.mock.calls.length === 1)).toBe(true);
  });
  it('rejects invalid audio shape before video work and nonfinite samples during encoding', async () => {
    for (const value of [
      { sampleRate: 0, channels: [new Float32Array(1)] }, { sampleRate: 48000, channels: [] },
      { sampleRate: 48000, channels: [new Float32Array(1), new Float32Array(2)] },
    ]) {
      const audio = audioFixture(); const produce = vi.fn();
      await expect(audio.record({ ...options, audio: value }, produce)).rejects.toThrow(/Invalid WebM audio/);
      expect(produce).not.toHaveBeenCalled();
    }
    const audio = audioFixture();
    await expect(audio.record({ ...options, audio: { sampleRate: 48000, channels: [Float32Array.of(NaN)] } },
      async push => { await push(rgba()); })).rejects.toThrow(/audio sample/);
    expect(audio.encoder.close).toHaveBeenCalledOnce(); expect(encoder.close).toHaveBeenCalledOnce();
  });
  it.each(['producer', 'video queue', 'audio queue', 'audio flush'] as const)('cancels both encoders during %s', async stage => {
    const audio = audioFixture(); const controller = new AbortController();
    if (stage === 'audio queue') audio.setQueue();
    if (stage === 'video queue') queued = true;
    if (stage === 'audio flush') audio.setFlush(() => new Promise(() => {}));
    const result = audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } }, async push => {
      if (stage === 'producer') await new Promise(() => {});
      else { for (let i = 0; i < (stage === 'video queue' ? 8 : 2); i++) await push(rgba()); }
    }, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(audio.encoder.state).toBe('configured'));
    if (stage === 'audio queue') await vi.waitFor(() => expect(audio.encoder.encodeQueueSize).toBe(4));
    if (stage === 'video queue') await vi.waitFor(() => expect(encoder.encodeQueueSize).toBe(4));
    if (stage === 'audio flush') await vi.waitFor(() => expect(audio.encoder.flush).toHaveBeenCalled());
    controller.abort(); await rejected;
    expect(encoder.close).toHaveBeenCalledOnce(); expect(audio.encoder.close).toHaveBeenCalledOnce();
    expect(audio.data.every(d => d.close.mock.calls.length === 1)).toBe(true);
  });
  it('waits for audio dequeue and flush output before muxing', async () => {
    const audio = audioFixture(); audio.setQueue();
    const result = audio.record({ ...options, audio: { sampleRate: 48000, channels: [new Float32Array(4800)] } }, async push => { await push(rgba()); await push(rgba()); });
    await vi.waitFor(() => expect(audio.encoder.encodeQueueSize).toBe(4));
    expect(audio.encoder.flush).not.toHaveBeenCalled(); audio.encoder.drain();
    const blob = await result; expect(new TextDecoder().decode(await blob.arrayBuffer())).toContain('A_OPUS');
  });
  it.each([[VP9, [VP9]], ['vp8', [VP9, 'vp8']]])('selects %s in order', async (codec, attempts) => {
    supported = [codec];
    const blob = await record()(options, async push => { await push(rgba()); });
    expect(blob.type).toBe('video/webm');
    expect(FakeEncoder.isConfigSupported.mock.calls.map(([c]) => c.codec)).toEqual(attempts);
    expect(encoder.config).toMatchObject({ codec, width: 2, height: 2, bitrate: 7_000_000, framerate: 20 });
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toContain(codec === VP9 ? 'V_VP9' : 'V_VP8');
    expect(encoder.config).not.toHaveProperty('latencyMode');
    expect(encoder.flush).toHaveBeenCalledTimes(2); expect(encoder.close).toHaveBeenCalledOnce();
    // SimpleBlock + size + track + relative timestamp + key flag + copied chunk.
    expect(new Uint8Array(await blob.arrayBuffer()).join(',')).toContain('163,134,129,0,0,128,1,42');
  });
  it.each(['configure', 'configure callback', 'first callback'] as const)('retries VP9 %s failure once with VP8 without restarting the producer', async stage => {
    supported = [VP9, 'vp8']; configureVp9Error = stage === 'configure'; configureVp9Callback = stage === 'configure callback'; firstCallbackError = stage === 'first callback';
    const produce = vi.fn(async (push: (data: Uint8ClampedArray) => Promise<void>) => { await push(rgba()); await push(rgba()); });
    const blob = await record()(options, produce);
    expect(encoders.map(e => e.config?.codec ?? e.state)).toEqual(stage === 'configure' ? ['closed', 'vp8'] : [VP9, 'vp8']);
    expect(encoders).toHaveLength(2); expect(encoders.every(e => e.close.mock.calls.length === 1)).toBe(true);
    expect(produce).toHaveBeenCalledOnce(); expect(await duration(blob)).toBe(100);
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toContain('V_VP8');
    expect(frames.filter(f => f.init.timestamp !== 0).map(f => f.init.timestamp)).toEqual([50000]);
  });
  it('does not retry a failing VP8 encoder', async () => {
    supported = [VP9, 'vp8']; configureError = new Error('all configure attempts fail');
    await expect(record()(options, async push => { await push(rgba()); })).rejects.toBe(configureError);
    expect(encoders).toHaveLength(2); expect(encoders.every(e => e.close.mock.calls.length === 1)).toBe(true);
  });
  it('passes even-sized RGBA directly to VideoFrame', async () => {
    const source = rgba(); await record()(options, async push => { await push(source); await push(source); });
    expect(inputs).toEqual([source, source]); expect(inputs.every(input => input === source)).toBe(true);
  });
  it('reuses padding storage while VideoFrame keeps independent pixels', async () => {
    const source = new Uint8ClampedArray(3 * 3 * 4).fill(1);
    await record()({ ...options, width: 3, height: 3 }, async push => { await push(source); source.fill(2); await push(source); });
    expect(inputs[0]).toBe(inputs[1]); expect(frames[0].data.every(v => v === 1)).toBe(true); expect(frames[1].data.every(v => v === 2)).toBe(true);
  });
  it.each(['closed', 'unconfigured'] as const)('fake encode rejects %s state', state => {
    const fake = new FakeEncoder({ output: () => {}, error: () => {} }); fake.state = state;
    expect(() => fake.encode({ close() {} }, {})).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });
  it('cancelled backpressure rejects push and lets the producer finish', async () => {
    queued = true; const controller = new AbortController(); const finished = vi.fn(); const caught = vi.fn();
    const result = record()(options, async push => {
      try { for (let i = 0; i < 20; i++) await push(rgba()); }
      catch (error) { caught(error); throw error; }
      finally { finished(); }
    }, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(encoder.encodeQueueSize).toBe(4)); controller.abort(); await rejected;
    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce()); expect(caught).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
  });
  it('cancels a pending first-frame flush and finishes the producer', async () => {
    const controller = new AbortController(); const finished = vi.fn();
    flushWork = () => new Promise(() => {});
    const result = record()(options, async push => { try { await push(rgba()); } finally { finished(); } }, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(encoder.flush).toHaveBeenCalledOnce()); controller.abort(); await rejected;
    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce());
  });
  it('rejects pushes after cancellation without encoding on a closed encoder', async () => {
    const controller = new AbortController(); let release!: () => void; const finished = vi.fn();
    const gate = new Promise<void>(resolve => { release = resolve; });
    const encode = vi.spyOn(FakeEncoder.prototype, 'encode');
    const result = record()(options, async push => {
      await gate;
      try { await expect(push(rgba())).rejects.toMatchObject({ name: 'AbortError' }); }
      finally { finished(); }
    }, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(encoder.state).toBe('configured')); controller.abort(); await rejected; release();
    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce()); expect(encode).not.toHaveBeenCalled(); encode.mockRestore();
  });
  it('falls back when the VP9 support probe rejects', async () => {
    supported = ['vp8'];
    FakeEncoder.isConfigSupported.mockRejectedValueOnce(new Error('unsupported codec'));
    await record()(options, async push => { await push(rgba()); });
    expect(encoder.config?.codec).toBe('vp8');
  });
  it('collects delayed chunks before closing and muxing', async () => {
    deferOutput = true;
    const blob = await record()(options, async push => {
      await push(rgba()); await Promise.resolve(); await push(rgba());
      expect(outputs).toHaveLength(1); expect(encoder.close).not.toHaveBeenCalled();
    });
    const bytes = new Uint8Array(await blob.arrayBuffer()).join(',');
    expect(bytes).toContain('163,134,129,0,0,128,1,42');
    expect(bytes).toContain('163,134,129,0,50,0,2,42');
    expect(await duration(blob)).toBe(100);
  });
  it('writes 80 timestamps and a 4000 ms Duration without real-time pacing', async () => {
    const blob = await record()(options, async push => { for (let i = 0; i < 80; i++) await push(rgba()); });
    expect(frames.map(f => f.init.timestamp)).toEqual(Array.from({ length: 80 }, (_, i) => i * 50_000));
    expect(frames.every(f => f.init.duration === 50_000 && f.close.mock.calls.length === 1)).toBe(true);
    expect(keys.flatMap((key, i) => key ? [i] : [])).toEqual([0, 40]);
    expect(await duration(blob)).toBe(4000);
  });
  it('uses integer microseconds at fractional intervals', async () => {
    const blob = await record()({ ...options, fps: 30 }, async push => { for (let i = 0; i < 4; i++) await push(rgba()); });
    expect(frames.map(f => f.init.timestamp)).toEqual([0, 33333, 66667, 100000]);
    expect(await duration(blob)).toBeCloseTo(4000 / 30, 10);
  });
  it.each([[3, 2], [2, 3], [3, 3]])('pads %sx%s using edge pixels', async (width, height) => {
    const source = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i);
    await record()({ ...options, width, height }, async push => { await push(source); });
    const f = frames[0]; const w = width + width % 2; const h = height + height % 2;
    expect(f.init).toMatchObject({ format: 'RGBA', codedWidth: w, codedHeight: h });
    expect(encoder.config).toMatchObject({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const src = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4;
      expect(Array.from(f.data.slice((y * w + x) * 4, (y * w + x) * 4 + 4))).toEqual(Array.from(source.slice(src, src + 4)));
    }
  });
  it('waits for dequeue while the encode queue is full', async () => {
    queued = true; let completed = 0;
    const result = record()(options, async push => { for (let i = 0; i < 20; i++) { await push(rgba()); completed++; } });
    await vi.waitFor(() => expect(encoder.encodeQueueSize).toBeGreaterThan(0));
    expect(completed).toBeLessThan(20); expect(encoder.flush).toHaveBeenCalledTimes(1);
    encoder.drain(encoder.encodeQueueSize);
    await Promise.resolve(); expect(encoder.flush).toHaveBeenCalledTimes(1);
    queued = false; encoder.drain(); await result; expect(completed).toBe(20);
  });
  it('rejects already aborted signals before probing codecs', async () => {
    const controller = new AbortController(); controller.abort(); const produce = vi.fn();
    await expect(record()(options, produce, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeEncoder.isConfigSupported).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
  });
  it('aborts during codec probing before allocating an encoder', async () => {
    const controller = new AbortController(); let finish!: (value: VideoEncoderSupport) => void;
    FakeEncoder.isConfigSupported.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const produce = vi.fn(); const result = record()(options, produce, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    finish({ supported: true }); await Promise.resolve(); expect(produce).not.toHaveBeenCalled();
  });
  it.each(['producer', 'backpressure', 'flush'])('aborts immediately during %s', async stage => {
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
    if (stage === 'backpressure') queued = true;
    if (stage === 'flush') flushWork = () => new Promise(() => {});
    const result = record()(options, async push => {
      if (stage === 'producer') await new Promise(() => {});
      else for (let i = 0; i < (stage === 'flush' ? 1 : 20); i++) await push(rgba());
    }, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(encoder.state).toBe('configured'));
    if (stage === 'flush') await vi.waitFor(() => expect(encoder.flush).toHaveBeenCalled());
    if (stage === 'backpressure') expect(encoder.encodeQueueSize).toBe(4);
    controller.abort(); await rejected;
    expect(encoder.close).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it.each(['produce', 'encode', 'flush', 'callback', 'copy', 'configure', 'frame'])('closes and preserves %s errors', async stage => {
    const error = new DOMException('encoder failed', 'EncodingError');
    if (stage === 'encode') encodeError = error;
    if (stage === 'configure') configureError = error;
    if (stage === 'frame') frameError = error;
    if (stage === 'flush') flushWork = async () => { throw error; };
    const encode = vi.spyOn(FakeEncoder.prototype, 'encode');
    if (stage === 'copy') encode.mockImplementationOnce(() => {
      encoder.init.output({ byteLength: 1, timestamp: 0, duration: null, type: 'key', copyTo: () => { throw error; } });
    });
    const result = record()(options, async push => {
      if (stage === 'produce') throw error;
      if (stage === 'callback') { encoder.init.error(error); await new Promise(() => {}); }
      await push(rgba());
    });
    await expect(result).rejects.toBe(error); expect(encoder.close).toHaveBeenCalledOnce();
    expect(frames.every(f => f.close.mock.calls.length === 1)).toBe(true); encode.mockRestore();
  });
  it('rejects invalid options, empty recordings and wrong frame lengths', async () => {
    for (const invalid of [{ ...options, width: 1 }, { ...options, height: 2.5 }, { ...options, fps: 0 }, { ...options, fps: NaN }]) {
      await expect(record()(invalid, async () => {})).rejects.toThrow('options');
    }
    await expect(record()(options, async () => {})).rejects.toThrow('frames'); expect(encoder.close).toHaveBeenCalledOnce();
    await expect(record()(options, async push => { await push(new Uint8ClampedArray(3)); })).rejects.toThrow('RGBA');
    expect(encoder.close).toHaveBeenCalledOnce();
  });
  it('fails even if a producer swallows a push error', async () => {
    await expect(record()(options, async push => { try { await push(new Uint8ClampedArray(3)); } catch { /* swallowed */ } })).rejects.toThrow('RGBA');
    expect(encoder.close).toHaveBeenCalledOnce();
  });
  it('rejects concurrent pushes and closes the encoder', async () => {
    await expect(record()(options, async push => { await Promise.allSettled([push(rgba()), push(rgba())]); })).rejects.toThrow('sequentially');
    expect(encoder.close).toHaveBeenCalledOnce();
  });
  it('rejects a producer returning with a frame still under backpressure', async () => {
    queued = true;
    await expect(record()(options, async push => {
      for (let i = 0; i < 3; i++) await push(rgba());
      void push(rgba()).catch(() => {});
    })).rejects.toThrow('awaited');
    expect(encoder.close).toHaveBeenCalledOnce();
  });
  it('reports missing WebCodecs and unsupported codecs', async () => {
    await expect(createWebmRecorder({})(options, async () => {})).rejects.toThrow(/not supported/);
    supported = []; await expect(record()(options, async () => {})).rejects.toThrow(/VP8.*VP9|VP9.*VP8/);
    expect(FakeEncoder.isConfigSupported.mock.calls.map(([c]) => c.codec)).toEqual([VP9, 'vp8']);
    vi.stubGlobal('VideoEncoder', undefined);
    try { await expect(recordWebm(options, async () => {})).rejects.toThrow(/not supported/); }
    finally { vi.unstubAllGlobals(); }
  });
});
