import { describe, expect, it, vi } from 'vitest';
import { createMusicTools, MUSIC_MAX_SECONDS, sliceAndFade } from '../src/file/audio';
import { MUSIC_MAX_BYTES } from '../src/file/types';

const sine = (length: number) => Float32Array.from({ length }, (_, i) => Math.sin(i * Math.PI / 10 + 0.3));
const buffer = (channels: Float32Array[], sampleRate = 48000): AudioBuffer => ({
  numberOfChannels: channels.length, length: channels[0].length, sampleRate,
  duration: channels[0].length / sampleRate, getChannelData: (i: number) => channels[i],
}) as AudioBuffer;

describe('music slicing', () => {
  it('slices nonperiodic waves without mutating input and applies linear fades to both channels', () => {
    const left = Float32Array.from({ length: 3000 }, (_, i) => i / 3000); const right = Float32Array.from(left, x => x * 0.5); const original = left.slice();
    const result = sliceAndFade([left, right], 1000, { startSec: 0.537, durationSec: 1, fadeOutSec: 0.2 });
    expect(result.map(c => c.length)).toEqual([1000, 1000]);
    for (const i of [0, 25, 49, 50, 799, 800, 900, 999]) {
      const gain = Math.min(1, i / 49) * Math.min(1, (999 - i) / 199);
      expect(result[0][i]).toBeCloseTo(left[537 + i] * gain, 6);
      expect(result[1][i]).toBeCloseTo(right[537 + i] * gain, 6);
    }
    expect(left).toEqual(original);
  });
  it('starts at zero beyond the end and pads short input with silence', () => {
    const source = sine(200);
    const result = sliceAndFade([source], 1000, { startSec: 0.2, durationSec: 1, fadeOutSec: 0 });
    expect(result[0][100]).toBe(source[100]);
    expect(result[0].slice(200).every(x => x === 0)).toBe(true);
  });
  it('defaults to a one-second fade out and clamps fades for short clips', () => {
    const result = sliceAndFade([sine(2000)], 1000, { startSec: 0, durationSec: 2 });
    expect(result[0][1500]).toBeCloseTo(sine(2000)[1500] * 499 / 999, 6);
    const short = sliceAndFade([sine(10)], 1000, { startSec: 0, durationSec: 0.01 });
    expect(short[0][0]).toBe(0); expect(short[0][9]).toBe(0);
    expect(short[0].every(Number.isFinite)).toBe(true);
  });
  it('multiplies overlapping fades', () => {
    const result = sliceAndFade([new Float32Array(40).fill(1)], 1000, { startSec: 0, durationSec: 0.04, fadeOutSec: 0.04 });
    expect(result[0][19]).toBeCloseTo((19 / 39) * (20 / 39), 6);
  });
  it('clamps processed samples after fading without changing input', () => {
    const source = new Float32Array(200).fill(3); source[100] = -3;
    const result = sliceAndFade([source], 1000, { startSec: 0, durationSec: 0.2, fadeOutSec: 0 });
    expect(result[0][60]).toBe(1); expect(result[0][100]).toBe(-1);
    expect(result[0][10]).toBeCloseTo(3 * 10 / 49, 6);
    expect(result[0].every(x => x >= -1 && x <= 1)).toBe(true);
    expect(source[60]).toBe(3);
  });
  it.each([
    { startSec: -1, durationSec: 1 }, { startSec: NaN, durationSec: 1 },
    { startSec: 0, durationSec: 0 }, { startSec: 0, durationSec: Infinity },
    { startSec: 0, durationSec: 1, fadeOutSec: -1 },
  ])('rejects invalid options %j', options => {
    expect(() => sliceAndFade([sine(10)], 1000, options)).toThrow();
  });
  it('rejects invalid rates and unequal or missing channels', () => {
    for (const channels of [[], [sine(10), sine(9)], [sine(10), sine(10), sine(10)]]) {
      expect(() => sliceAndFade(channels, 1000, { startSec: 0, durationSec: 1 })).toThrow();
    }
    expect(() => sliceAndFade([sine(10)], 0, { startSec: 0, durationSec: 1 })).toThrow();
  });
});

describe('injected offline music tools', () => {
  function fixture(decoded = buffer([sine(4800)]), rendered?: AudioBuffer) {
    const contexts: FakeContext[] = [];
    class FakeContext {
      destination = {} as AudioDestinationNode;
      decodeAudioData = vi.fn(async () => decoded);
      createBuffer = vi.fn((n: number, length: number, rate: number) => buffer(Array.from({ length: n }, () => new Float32Array(length)), rate));
      source = { buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn((_when: number, _offset = 0) => {}) };
      createBufferSource = vi.fn(() => this.source);
      startRendering = vi.fn(async () => {
        if (rendered) return rendered;
        const input = this.source.buffer!;
        const offset = this.source.start.mock.calls[0]?.[1] ?? 0;
        return buffer(Array.from({ length: this.channels }, (_, channel) => {
          const samples = new Float32Array(this.length);
          const source = input.getChannelData(Math.min(channel, input.numberOfChannels - 1));
          for (let i = 0; i < samples.length; i++) samples[i] = source[Math.floor((offset + i / this.rate) * input.sampleRate)] ?? 0;
          return samples;
        }), this.rate);
      });
      constructor(public channels: number, public length: number, public rate: number) { contexts.push(this); }
    }
    const tools = createMusicTools({ OfflineAudioContext: FakeContext as unknown as typeof OfflineAudioContext });
    return { tools, contexts };
  }
  it('decodes duration locally at 48000 Hz', async () => {
    const { tools, contexts } = fixture();
    expect(await tools.musicDuration(new Blob([Uint8Array.of(1)]))).toBe(0.1);
    expect(contexts.map(c => [c.channels, c.rate])).toEqual([[2, 48000]]);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledOnce();
    expect(contexts[0].startRendering).not.toHaveBeenCalled();
  });
  it('renders only the requested interval and lets the destination mix mono', async () => {
    const { tools, contexts } = fixture();
    const result = await tools.prepareMusic(new Blob([Uint8Array.of(1)]), { startSec: 0, durationSec: 0.2, fadeOutSec: 0 });
    expect(result.sampleRate).toBe(48000); expect(result.channels.map(c => c.length)).toEqual([9600, 9600]);
    expect(result.channels[0]).toEqual(result.channels[1]); expect(result.channels[0]).not.toBe(result.channels[1]);
    expect(contexts[1]).toMatchObject({ channels: 2, length: 9600, rate: 48000 });
    expect(contexts[1].source.buffer?.numberOfChannels).toBe(1);
    expect(contexts[1].createBuffer).not.toHaveBeenCalled();
    expect(result.channels[0].slice(4800).every(x => x === 0)).toBe(true);
    expect(contexts[1].source.connect).toHaveBeenCalledWith(contexts[1].destination);
    expect(contexts[1].source.start).toHaveBeenCalledWith(0, 0); expect(contexts[1].startRendering).toHaveBeenCalledOnce();
  });
  it('keeps distinct stereo channels', async () => {
    const { tools } = fixture(buffer([sine(4800), Float32Array.from(sine(4800), x => -x)]));
    const result = await tools.prepareMusic(new Blob([Uint8Array.of(1)]), { startSec: 0, durationSec: 0.1, fadeOutSec: 0 });
    expect(result.channels[0][3000]).toBe(-result.channels[1][3000]);
  });
  it('uses the offline rendering result for a source at another sample rate', async () => {
    const resampled = buffer([sine(4800), sine(4800)]);
    const { tools, contexts } = fixture(buffer([sine(2400)], 24000), resampled);
    const result = await tools.prepareMusic(new Blob([Uint8Array.of(1)]), { startSec: 0, durationSec: 0.1, fadeOutSec: 0 });
    expect(contexts[1]).toMatchObject({ length: 4800, rate: 48000 });
    expect(contexts[1].createBuffer).not.toHaveBeenCalled();
    expect(result.channels[0][3000]).toBe(resampled.getChannelData(0)[3000]);
  });
  it('prepares a nonzero nonperiodic offset with the original source buffer', async () => {
    const source = Float32Array.from({ length: 48000 }, (_, i) => i / 48000);
    const decoded = buffer([source, source, source, source, source, source]);
    const { tools, contexts } = fixture(decoded);
    const result = await tools.prepareMusic(new Blob(), { startSec: 0.137, durationSec: 0.2, fadeOutSec: 0 });
    expect(contexts[1].length).toBe(9600); expect(contexts[1].source.buffer).toBe(decoded);
    expect(contexts[1].source.start).toHaveBeenCalledWith(0, 0.137);
    expect(contexts[1].createBuffer).not.toHaveBeenCalled();
    expect(result.channels[0][3000]).toBeCloseTo(source[6576 + 3000], 6);
  });
  it('resets an offset at the music end to zero before rendering', async () => {
    const { tools, contexts } = fixture();
    await tools.prepareMusic(new Blob(), { startSec: 0.1, durationSec: 0.2 });
    expect(contexts[1].source.start).toHaveBeenCalledWith(0, 0);
  });
  it('accepts exactly 15 minutes and rejects longer music in both APIs before rendering', async () => {
    expect(MUSIC_MAX_SECONDS).toBe(900);
    const decoded = buffer([sine(10)]); Object.defineProperty(decoded, 'duration', { value: 900 });
    const accepted = fixture(decoded); expect(await accepted.tools.musicDuration(new Blob())).toBe(900);
    await accepted.tools.prepareMusic(new Blob(), { startSec: 0, durationSec: 4 });
    const long = buffer([sine(10)]); Object.defineProperty(long, 'duration', { value: 900.001 });
    const { tools, contexts } = fixture(long);
    await expect(tools.musicDuration(new Blob())).rejects.toThrow(/too long/);
    await expect(tools.prepareMusic(new Blob(), { startSec: 0, durationSec: 4 })).rejects.toThrow(/too long/);
    expect(contexts).toHaveLength(2); expect(contexts.every(c => c.startRendering.mock.calls.length === 0)).toBe(true);
  });
  it('accepts a file exactly at the size limit in both APIs', async () => {
    const { tools } = fixture(); const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const file = { size: MUSIC_MAX_BYTES, arrayBuffer } as unknown as Blob;
    await expect(tools.musicDuration(file)).resolves.toBe(0.1);
    await expect(tools.prepareMusic(file, { startSec: 0, durationSec: 4 })).resolves.toMatchObject({ sampleRate: 48000 });
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized files before reading or allocating a context', async () => {
    const { tools, contexts } = fixture(); const arrayBuffer = vi.fn();
    const file = { size: MUSIC_MAX_BYTES + 1, arrayBuffer } as unknown as Blob;
    await expect(tools.musicDuration(file)).rejects.toThrow(/large/i);
    await expect(tools.prepareMusic(file, { startSec: 0, durationSec: 4 })).rejects.toThrow(/large/i);
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(contexts).toHaveLength(0);
  });
  it('propagates decode errors and reports an unavailable browser API', async () => {
    class BrokenContext { decodeAudioData = async () => { throw new Error('bad music'); }; }
    const tools = createMusicTools({ OfflineAudioContext: BrokenContext as unknown as typeof OfflineAudioContext });
    await expect(tools.musicDuration(new Blob())).rejects.toThrow('bad music');
    await expect(createMusicTools({}).musicDuration(new Blob())).rejects.toThrow(/not supported/);
  });
});
