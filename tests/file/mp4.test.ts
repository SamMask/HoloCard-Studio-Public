import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMp4Recorder, recordMp4 } from '../../src/file/mp4';
import { opusHead } from '../../src/file/webm-mux';

const options = { width: 2, height: 2, fps: 20 };
const pixels = () => new Uint8ClampedArray(16).fill(255);
const codecs = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028'];
const avcc = Uint8Array.of(1, 100, 0, 40, 255, 225, 0, 2, 103, 100, 1, 0, 2, 104, 0);
function payload(bytes: Uint8Array, type: string, occurrence = 0): DataView {
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const find = (start: number, end: number): DataView | undefined => {
    while (start < end) {
      let size = view.getUint32(start); let content = start + 8;
      if (size === 1) { size = Number(view.getBigUint64(start + 8)); content += 8; }
      if (size < content - start || start + size > end) throw new Error('Invalid MP4 box');
      const name = new TextDecoder().decode(bytes.subarray(start + 4, start + 8));
      if (name === type && occurrence-- === 0) return new DataView(bytes.buffer, bytes.byteOffset + content, start + size - content);
      const childStart = containers.has(name) ? content : name === 'stsd' || name === 'dref' ? content + 8
        : name === 'avc1' ? content + 78 : name === 'mp4a' || name === 'Opus' ? content + 28 : undefined;
      if (childStart !== undefined) { const found = find(childStart, start + size); if (found) return found; }
      start += size;
    }
  };
  const found = find(0, bytes.length); if (found) return found;
  throw new Error(`Missing ${type}`);
}

describe('WebCodecs MP4 recorder', () => {
  let video: FakeVideo; let audio: FakeAudio;
  let supported: string[]; let audioSupported: string[];
  let frames: FakeFrame[]; let audioData: FakeData[]; let encoders: FakeVideo[];
  let queueVideo: boolean; let queueAudio: boolean; let holdFlush: boolean; let holdAudioFlush: boolean;
  let audioOffset: number; let head: Uint8Array; let omitDuration: boolean;
  let failure: string | undefined; let startupFailure: boolean; let videoDescription: boolean; let reordered: boolean;
  let syncStartupFailure: boolean; let missingPackets: number; let videoColorSpace: VideoColorSpaceInit | undefined;
  class FakeFrame {
    close = vi.fn(); data: Uint8Array;
    constructor(data: AllowSharedBufferSource, public init: VideoFrameBufferInit) {
      const values = data as Uint8Array; this.data = new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice(); frames.push(this);
    }
  }
  class FakeVideo extends EventTarget {
    static isConfigSupported = vi.fn(async (config: VideoEncoderConfig): Promise<VideoEncoderSupport> => ({ supported: supported.includes(config.codec), config }));
    state: CodecState = 'unconfigured'; encodeQueueSize = 0; config?: VideoEncoderConfig;
    pending: (() => void)[] = [];
    constructor(public init: VideoEncoderInit) { super(); video = this; encoders.push(this); }
    configure(config: VideoEncoderConfig) { this.config = config; this.state = 'configured'; }
    close = vi.fn(() => { this.state = 'closed'; });
    encode(value: { close(): void }, opts: VideoEncoderEncodeOptions) {
      if (failure === 'video encode') throw new Error(failure);
      if (syncStartupFailure && this.config?.codec === codecs[0]) throw new Error('synchronous startup failure');
      if (startupFailure && this.config?.codec === codecs[0]) { queueMicrotask(() => this.init.error(new DOMException('startup failed'))); return; }
      const frame = value as FakeFrame;
      this.encodeQueueSize = queueVideo ? this.encodeQueueSize + 1 : 0;
      this.pending.push(() => {
        const data = Uint8Array.of(7, 8);
        this.init.output({ timestamp: frame.init.timestamp + (reordered ? 1 : 0), duration: frame.init.duration ?? null,
          byteLength: 2, type: opts.keyFrame ? 'key' : 'delta', copyTo: target => { (target as Uint8Array).set(data); } },
        videoDescription ? { decoderConfig: { codec: this.config!.codec, description: avcc.slice(), colorSpace: videoColorSpace } } : undefined);
        data.fill(0);
      });
    }
    flush = vi.fn(async () => {
      if (holdFlush) await new Promise(() => {});
      for (const output of this.pending) output(); this.pending = []; this.encodeQueueSize = 0;
    });
    drain() { this.encodeQueueSize = 0; this.dispatchEvent(new Event('dequeue')); }
  }
  class FakeData {
    close = vi.fn(); constructor(public init: AudioDataInit) { audioData.push(this); }
  }
  class FakeAudio extends EventTarget {
    static isConfigSupported = vi.fn(async (config: AudioEncoderConfig) => ({ supported: audioSupported.includes(config.codec), config }));
    state: CodecState = 'unconfigured'; encodeQueueSize = 0; config?: AudioEncoderConfig;
    pending: FakeData[] = [];
    constructor(public init: AudioEncoderInit) { super(); audio = this; }
    configure(config: AudioEncoderConfig) { this.config = config; this.state = 'configured'; }
    close = vi.fn(() => { this.state = 'closed'; });
    encode(value: { close(): void }) {
      if (failure === 'audio encode') throw new Error(failure);
      this.pending.push(value as FakeData); this.encodeQueueSize = queueAudio ? this.encodeQueueSize + 1 : 0;
    }
    flush = vi.fn(async () => {
      if (holdAudioFlush) await new Promise(() => {});
      if (failure === 'audio flush') throw new Error(failure);
      const isAac = this.config?.codec === 'mp4a.40.2'; const batch = isAac ? 1024 : 960;
      // Like a codec: complete packets, plus priming and end padding in the flush output.
      const samples = this.pending.reduce((n, d) => n + d.init.numberOfFrames, 0);
      const priming = isAac ? (audioOffset < 0 ? Math.round(-audioOffset * 48000 / 1e6) : 1024) : 312;
      const count = Math.max(0, Math.ceil((samples + priming) / batch) - missingPackets);
      for (let i = 0; i < count; i++) this.init.output({ timestamp: Math.round(i * batch / 48000 * 1e6) + audioOffset,
        duration: omitDuration ? null : Math.round(batch / 48000 * 1e6), type: 'key', byteLength: 1,
        copyTo: target => { (target as Uint8Array).set([99]); } },
      i === 0 ? { decoderConfig: { codec: this.config!.codec, sampleRate: 48000, numberOfChannels: 2,
        description: isAac ? Uint8Array.of(0x11, 0x90) : head } } : undefined);
      head.fill(0); this.pending = []; this.encodeQueueSize = 0;
    });
    drain() { this.encodeQueueSize = 0; this.dispatchEvent(new Event('dequeue')); }
  }
  const record = () => createMp4Recorder({ VideoEncoder: FakeVideo, VideoFrame: FakeFrame, AudioEncoder: FakeAudio, AudioData: FakeData });
  const music = () => ({ ...options, audio: { sampleRate: 24000, channels: [new Float32Array(600).fill(0.5)] } });
  beforeEach(() => {
    supported = [codecs[0]]; audioSupported = ['mp4a.40.2', 'opus'];
    frames = []; audioData = []; encoders = []; queueVideo = false; queueAudio = false; holdFlush = false; holdAudioFlush = false;
    audioOffset = 0; head = opusHead(); omitDuration = false; failure = undefined; startupFailure = false; videoDescription = true; reordered = false;
    syncStartupFailure = false; missingPackets = 0; videoColorSpace = undefined;
    FakeVideo.isConfigSupported.mockClear(); FakeAudio.isConfigSupported.mockClear();
  });

  it('reports High and AAC once after frame zero succeeds', async () => {
    const onInfo = vi.fn();
    await record()(music(), async push => {
      expect(onInfo).not.toHaveBeenCalled();
      await push(pixels()); await push(pixels());
    }, undefined, onInfo);
    expect(onInfo).toHaveBeenCalledExactlyOnceWith({ videoCodec: codecs[0], audioCodec: 'aac' });
  });
  it.each(['asynchronous', 'synchronous'])('reports only Main after %s High startup failure', async mode => {
    supported = codecs; startupFailure = mode === 'asynchronous'; syncStartupFailure = mode === 'synchronous';
    const onInfo = vi.fn();
    await record()(music(), async push => { await push(pixels()); await push(pixels()); }, undefined, onInfo);
    expect(onInfo).toHaveBeenCalledExactlyOnceWith({ videoCodec: codecs[1], audioCodec: 'aac' });
  });
  it('reports Opus when AAC is unsupported', async () => {
    audioSupported = ['opus']; const onInfo = vi.fn();
    await record()(music(), async push => { await push(pixels()); }, undefined, onInfo);
    expect(onInfo).toHaveBeenCalledExactlyOnceWith({ videoCodec: codecs[0], audioCodec: 'opus' });
  });
  it('reports null audio before the first push returns', async () => {
    const onInfo = vi.fn();
    await record()(options, async push => {
      expect(onInfo).not.toHaveBeenCalled();
      await push(pixels());
      expect(onInfo).toHaveBeenCalledExactlyOnceWith({ videoCodec: codecs[0], audioCodec: null });
      await push(pixels());
    }, undefined, onInfo);
    expect(onInfo).toHaveBeenCalledOnce();
  });
  it('does not report info when cancelled while confirming frame zero', async () => {
    holdFlush = true; const controller = new AbortController(); const onInfo = vi.fn();
    const result = record()(options, async push => { await push(pixels()); }, controller.signal, onInfo);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(video.flush).toHaveBeenCalledOnce());
    expect(onInfo).not.toHaveBeenCalled(); controller.abort(); await rejected;
    expect(onInfo).not.toHaveBeenCalled();
  });
  it('does not report info when every profile fails before confirmation', async () => {
    supported = codecs; failure = 'video encode'; const onInfo = vi.fn();
    await expect(record()(options, async push => { await push(pixels()); }, undefined, onInfo))
      .rejects.toMatchObject({ name: 'Mp4UnsupportedError' });
    expect(onInfo).not.toHaveBeenCalled();
  });
  it('forwards onInfo through the public recorder', async () => {
    const onInfo = vi.fn(); vi.stubGlobal('VideoEncoder', FakeVideo); vi.stubGlobal('VideoFrame', FakeFrame);
    try {
      await recordMp4(options, async push => { await push(pixels()); }, undefined, onInfo);
      expect(onInfo).toHaveBeenCalledExactlyOnceWith({ videoCodec: codecs[0], audioCodec: null });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(codecs)('selects %s in order and writes video-only MP4', async codec => {
    supported = [codec]; const blob = await record()(options, async push => { for (let i = 0; i < 80; i++) await push(pixels()); });
    expect(blob.type).toBe('video/mp4'); expect(FakeVideo.isConfigSupported.mock.calls.map(([c]) => c.codec)).toEqual(codecs.slice(0, codecs.indexOf(codec) + 1));
    expect(video.config).toMatchObject({ codec, bitrate: 7_000_000, avc: { format: 'avc' }, latencyMode: 'realtime' });
    expect(frames.map(f => f.init.timestamp)).toEqual(Array.from({ length: 80 }, (_, i) => i * 50000));
    expect(frames.every(f => f.close.mock.calls.length === 1)).toBe(true); expect(video.close).toHaveBeenCalledOnce();
    const bytes = new Uint8Array(await blob.arrayBuffer()); const mvhd = payload(bytes, 'mvhd');
    expect(mvhd.getUint32(16) / mvhd.getUint32(12)).toBe(4);
    const stss = payload(bytes, 'stss'); expect([4, 8, 12].map(i => stss.getUint32(i))).toEqual([2, 1, 41]);
    expect(() => payload(bytes, 'mp4a')).toThrow(); expect(FakeAudio.isConfigSupported).not.toHaveBeenCalled();
  });
  it('retries first-frame startup failure with Main without restarting produce', async () => {
    supported = codecs; startupFailure = true;
    const produce = vi.fn(async (push: (rgba: Uint8ClampedArray) => Promise<void>) => { await push(pixels()); await push(pixels()); });
    await record()(options, produce); expect(produce).toHaveBeenCalledOnce(); expect(video.config?.codec).toBe(codecs[1]);
    expect(encoders.every(e => e.close.mock.calls.length === 1)).toBe(true);
  });
  it('retries synchronous first-frame encode failure and reuses the frame', async () => {
    supported = codecs; syncStartupFailure = true;
    const produce = vi.fn(async (push: (rgba: Uint8ClampedArray) => Promise<void>) => { await push(pixels()); await push(pixels()); });
    await record()(options, produce);
    expect(video.config?.codec).toBe(codecs[1]); expect(produce).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(2); expect(frames.every(frame => frame.close.mock.calls.length === 1)).toBe(true);
    expect(encoders.every(encoder => encoder.close.mock.calls.length === 1)).toBe(true);
  });
  it('reports unsupported after synchronous startup failure exhausts every supported profile', async () => {
    supported = codecs; failure = 'video encode';
    await expect(record()(options, async push => { await push(pixels()); })).rejects.toMatchObject({ name: 'Mp4UnsupportedError' });
    expect(encoders).toHaveLength(3); expect(encoders.every(encoder => encoder.close.mock.calls.length === 1)).toBe(true);
  });
  it('preserves a synchronous encode failure after frame zero was confirmed', async () => {
    await expect(record()(options, async push => { await push(pixels()); failure = 'video encode'; await push(pixels()); })).rejects.toThrow('video encode');
    expect(encoders).toHaveLength(1);
  });
  it('probes H.264 before audio and prioritizes the unsupported-video contract error', async () => {
    supported = []; audioSupported = []; const produce = vi.fn();
    await expect(record()(music(), produce)).rejects.toMatchObject({ name: 'Mp4UnsupportedError' });
    expect(FakeAudio.isConfigSupported).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
  });
  it('probes supported video before AAC and explicitly requests raw AAC packets', async () => {
    await record()(music(), async push => { await push(pixels()); });
    expect(FakeVideo.isConfigSupported.mock.invocationCallOrder[0]).toBeLessThan(FakeAudio.isConfigSupported.mock.invocationCallOrder[0]);
    expect(FakeAudio.isConfigSupported.mock.calls[0][0]).toMatchObject({ aac: { format: 'aac' } });
    expect(audio.config).toMatchObject({ aac: { format: 'aac' } });
  });
  it('copies encoder colour metadata into nclx', async () => {
    videoColorSpace = { primaries: 'smpte170m', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true };
    const bytes = new Uint8Array(await (await record()(options, async push => { await push(pixels()); })).arrayBuffer());
    const colr = payload(bytes, 'colr');
    expect([4, 6, 8].map(at => colr.getUint16(at)).concat(colr.getUint8(10))).toEqual([6, 13, 0, 128]);
  });
  it.each([1, 2, 5])('treats first audio timestamp %s microseconds as zero', async offset => {
    audioOffset = offset;
    const bytes = new Uint8Array(await (await record()(music(), async push => { await push(pixels()); })).arrayBuffer());
    expect(payload(bytes, 'elst').getInt32(12)).toBe(1024);
  });
  it('rejects a material positive audio start offset', async () => {
    audioOffset = 1000;
    await expect(record()(music(), async push => { await push(pixels()); })).rejects.toThrow(/movie origin/);
  });
  it.each(['aac', 'opus'] as const)('keeps slightly short %s audio packets but rejects a deficit exceeding a packet', async codec => {
    audioSupported = [codec === 'aac' ? 'mp4a.40.2' : 'opus']; missingPackets = 1;
    const bytes = new Uint8Array(await (await record()(music(), async push => { await push(pixels()); await push(pixels()); })).arrayBuffer());
    // Six AAC or Opus packets would normally be produced; the five actual packets are preserved.
    expect(payload(bytes, 'stsz', 1).getUint32(8)).toBe(5);
    expect(payload(bytes, 'mdhd', 1).getUint32(16)).toBe(5 * (codec === 'aac' ? 1024 : 960));
    const trackTimes = payload(bytes, 'elst'); expect(trackTimes.getUint32(8) / payload(bytes, 'mvhd').getUint32(12)).toBe(0.1);
    missingPackets = 2; head = opusHead();
    await expect(record()(music(), async push => { await push(pixels()); await push(pixels()); })).rejects.toThrow(/audio.*duration/i);
  });
  it('preserves all returned audio packets including encoder padding', async () => {
    missingPackets = -2;
    const bytes = new Uint8Array(await (await record()(music(), async push => { await push(pixels()); })).arrayBuffer());
    expect(payload(bytes, 'stsz', 1).getUint32(8)).toBe(6);
    expect(payload(bytes, 'mdhd', 1).getUint32(16)).toBe(6 * 1024);
  });
  it('passes the injected clock through the recorder to the movie headers', async () => {
    const now = vi.fn(() => Date.UTC(2026, 9, 14));
    const recorder = createMp4Recorder({ VideoEncoder: FakeVideo, VideoFrame: FakeFrame, now });
    const bytes = new Uint8Array(await (await recorder(options, async push => { await push(pixels()); })).arrayBuffer());
    expect(payload(bytes, 'mvhd').getUint32(4)).toBe(Date.UTC(2026, 9, 14) / 1000 + 2082844800);
    expect(now).toHaveBeenCalledOnce();
  });
  it('does not mistake a box name in encoded sample bytes for a real box', async () => {
    const blob = await record()(options, async push => { await push(pixels()); });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mdat = payload(bytes, 'mdat');
    expect(mdat.byteLength).toBe(2);
    const forged = Uint8Array.of(0, 0, 0, 16, 109, 100, 97, 116, 0, 0, 0, 8, 99, 111, 108, 114);
    expect(() => payload(forged, 'colr')).toThrow(/Missing/);
  });
  it.each([[3, 2], [2, 3], [3, 3]])('pads %sx%s with edge pixels', async (width, height) => {
    const rgba = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i);
    await record()({ ...options, width, height }, async push => { await push(rgba); });
    const w = width + width % 2; const h = height + height % 2;
    expect(video.config).toMatchObject({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const src = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4;
      expect(frames[0].data.slice((y * w + x) * 4, (y * w + x + 1) * 4)).toEqual(new Uint8Array(rgba.slice(src, src + 4)));
    }
  });
  it.each([0, -42667])('uses AAC ASC, actual negative-timestamp priming or 1024 default (%s)', async offset => {
    audioOffset = offset; const blob = await record()(music(), async push => { await push(pixels()); await push(pixels()); });
    expect(audio.config?.codec).toBe('mp4a.40.2'); const bytes = new Uint8Array(await blob.arrayBuffer());
    const edit = payload(bytes, 'elst'); expect(edit.getInt32(12)).toBe(offset ? 2048 : 1024);
    const movie = payload(bytes, 'mvhd'); expect(edit.getUint32(8) / movie.getUint32(12)).toBe(0.1);
    const total = audioData.reduce((n, d) => n + d.init.numberOfFrames, 0); expect(total).toBe(4800);
    const values = audioData.flatMap(d => Array.from((d.init.data as Float32Array).slice(0, d.init.numberOfFrames)));
    expect(values.slice(0, 1200).every(v => v === 0.5)).toBe(true); expect(values.slice(1200).every(v => v === 0)).toBe(true);
    expect(audioData.every(d => d.close.mock.calls.length === 1)).toBe(true); expect(audio.close).toHaveBeenCalledOnce();
  });
  it('falls back to Opus, copies OpusHead and handles missing packet durations', async () => {
    audioSupported = ['opus']; omitDuration = true;
    const bytes = new Uint8Array(await (await record()(music(), async push => { await push(pixels()); })).arrayBuffer());
    expect(FakeAudio.isConfigSupported.mock.calls.map(([c]) => c.codec)).toEqual(['mp4a.40.2', 'opus']);
    expect(audio.config?.codec).toBe('opus'); expect(payload(bytes, 'elst').getInt32(12)).toBe(312);
    expect(payload(bytes, 'dOps').getUint16(2)).toBe(312);
  });
  it('uses nominal AAC packet size when durations are missing', async () => {
    omitDuration = true;
    const bytes = new Uint8Array(await (await record()(music(), async push => { await push(pixels()); })).arrayBuffer());
    expect(payload(bytes, 'elst').getInt32(12)).toBe(1024);
  });
  it('falls back on rejected codec probes', async () => {
    supported = [codecs[1]];
    FakeVideo.isConfigSupported.mockRejectedValueOnce(new DOMException('probe unavailable'));
    FakeAudio.isConfigSupported.mockRejectedValueOnce(new DOMException('AAC unavailable'));
    await record()(music(), async push => { await push(pixels()); });
    expect(video.config?.codec).toBe(codecs[1]); expect(audio.config?.codec).toBe('opus');
  });
  it('truncates long stereo input and preserves distinct channels', async () => {
    await record()({ ...options, audio: { sampleRate: 48000,
      channels: [new Float32Array(8000).fill(0.2), new Float32Array(8000).fill(-0.4)] } },
    async push => { await push(pixels()); });
    expect(audioData.reduce((sum, data) => sum + data.init.numberOfFrames, 0)).toBe(2400);
    for (const data of audioData) {
      const values = data.init.data as Float32Array; const n = data.init.numberOfFrames;
      expect(values.slice(0, n).every(v => Math.abs(v - 0.2) < 1e-7)).toBe(true);
      expect(values.slice(n).every(v => Math.abs(v + 0.4) < 1e-7)).toBe(true);
    }
  });
  it('rejects malformed audio before rendering and non-finite samples while encoding', async () => {
    const produce = vi.fn();
    await expect(record()({ ...options, audio: { channels: [], sampleRate: 48000 } }, produce)).rejects.toThrow(/audio channels/);
    expect(produce).not.toHaveBeenCalled();
    await expect(record()({ ...options, audio: { channels: [Float32Array.of(NaN)], sampleRate: 48000 } },
      async push => { await push(pixels()); })).rejects.toThrow(/audio sample/);
    expect(video.close).toHaveBeenCalledOnce(); expect(audio.close).toHaveBeenCalledOnce();
  });
  it.each(['video', 'audio'] as const)('applies %s backpressure', async kind => {
    queueVideo = kind === 'video'; queueAudio = kind === 'audio'; let done = 0;
    const result = record()(music(), async push => { for (let i = 0; i < 10; i++) { await push(pixels()); done++; } });
    await vi.waitFor(() => expect((kind === 'video' ? video : audio).encodeQueueSize).toBe(4));
    if (kind === 'video') { expect(done).toBeLessThan(10); queueVideo = false; video.drain(); }
    else { expect(audio.flush).not.toHaveBeenCalled(); queueAudio = false; audio.drain(); }
    await result;
  });
  it.each(['producer', 'video queue', 'video flush', 'audio queue', 'audio flush'] as const)('aborts during %s and closes encoders', async stage => {
    const controller = new AbortController(); queueVideo = stage === 'video queue'; queueAudio = stage === 'audio queue'; holdFlush = stage === 'video flush'; holdAudioFlush = stage === 'audio flush';
    const result = record()(music(), async push => {
      if (stage === 'producer') await new Promise(() => {});
      else for (let i = 0; i < 10; i++) await push(pixels());
    }, controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(audio.state).toBe('configured'));
    if (stage === 'video queue') await vi.waitFor(() => expect(video.encodeQueueSize).toBe(4));
    if (stage === 'video flush') await vi.waitFor(() => expect(video.flush).toHaveBeenCalled());
    if (stage === 'audio queue') await vi.waitFor(() => expect(audio.encodeQueueSize).toBe(4));
    if (stage === 'audio flush') await vi.waitFor(() => expect(audio.flush).toHaveBeenCalled());
    controller.abort(); await rejected;
    expect(video.close).toHaveBeenCalledOnce(); expect(audio.close).toHaveBeenCalledOnce();
  });
  it('rejects pre-aborted and aborts pending probes without producing', async () => {
    const c = new AbortController(); c.abort(); const produce = vi.fn();
    await expect(record()(options, produce, c.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeVideo.isConfigSupported).not.toHaveBeenCalled();
    let finish!: (value: VideoEncoderSupport) => void;
    FakeVideo.isConfigSupported.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const next = new AbortController(); const result = record()(options, produce, next.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' }); next.abort(); await rejected;
    finish({ supported: true }); await Promise.resolve(); expect(produce).not.toHaveBeenCalled();
  });
  it('reports contract error names for missing APIs and unsupported codecs', async () => {
    const produce = vi.fn();
    await expect(createMp4Recorder({})(options, produce)).rejects.toMatchObject({ name: 'Mp4UnsupportedError' });
    supported = []; await expect(record()(options, produce)).rejects.toMatchObject({ name: 'Mp4UnsupportedError' });
    supported = [codecs[0]]; audioSupported = [];
    await expect(record()(music(), produce)).rejects.toMatchObject({ name: 'Mp4AudioUnsupportedError' });
    await expect(createMp4Recorder({ VideoEncoder: FakeVideo, VideoFrame: FakeFrame })(music(), produce)).rejects.toMatchObject({ name: 'Mp4AudioUnsupportedError' });
    expect(produce).not.toHaveBeenCalled();
    vi.stubGlobal('VideoEncoder', undefined);
    try { await expect(recordMp4(options, produce)).rejects.toMatchObject({ name: 'Mp4UnsupportedError' }); }
    finally { vi.unstubAllGlobals(); }
  });
  it.each(['audio encode', 'audio flush'])('cleans up after %s failure', async stage => {
    failure = stage; await expect(record()(music(), async push => { await push(pixels()); })).rejects.toThrow(stage);
    expect(video.close).toHaveBeenCalledOnce(); expect(audio.close).toHaveBeenCalledOnce();
    expect(frames.every(f => f.close.mock.calls.length === 1)).toBe(true);
    expect(audioData.every(d => d.close.mock.calls.length === 1)).toBe(true);
  });
  it('rejects invalid inputs, no frames and missing avcC', async () => {
    await expect(record()({ ...options, fps: 0 }, async () => {})).rejects.toThrow(/options/);
    await expect(record()(options, async () => {})).rejects.toThrow(/frames/);
    await expect(record()(options, async push => { await push(new Uint8ClampedArray(1)); })).rejects.toThrow(/RGBA/);
    videoDescription = false;
    await expect(record()(options, async push => { await push(pixels()); })).rejects.toThrow(/configuration/i);
  });
  it('rejects reordered output rather than writing an incorrect decode time table', async () => {
    reordered = true;
    await expect(record()(options, async push => { await push(pixels()); })).rejects.toThrow(/reordered/);
    expect(video.close).toHaveBeenCalledOnce(); expect(frames[0].close).toHaveBeenCalledOnce();
  });
  it('rejects concurrent pushes, unawaited pushes and swallowed failures', async () => {
    await expect(record()(options, async push => { await Promise.allSettled([push(pixels()), push(pixels())]); })).rejects.toThrow(/sequential/);
    queueVideo = true;
    await expect(record()(options, async push => {
      for (let i = 0; i < 4; i++) await push(pixels()); void push(pixels()).catch(() => {});
    })).rejects.toThrow(/awaited/);
    await expect(record()(options, async push => { try { await push(new Uint8ClampedArray(1)); } catch { /* swallowed */ } })).rejects.toThrow(/RGBA/);
  });
});
