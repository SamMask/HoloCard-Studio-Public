import { opusHead, opusPreSkip } from './webm-mux';

export interface Mp4Frame { data: Uint8Array; key: boolean }
export interface Mp4AudioFrame { data: Uint8Array; /** Decoded samples per channel. */ duration: number }
export interface Mp4AudioTrack {
  codec: 'aac' | 'opus';
  sampleRate: number;
  channels: number;
  /** AAC AudioSpecificConfig or OpusHead, not a container box. */
  description?: Uint8Array;
  /** Samples to skip at the beginning of the decoded media. */
  primingSamples?: number;
  frames: readonly Mp4AudioFrame[];
}
export interface Mp4MuxOptions {
  width: number;
  height: number;
  fps: number;
  /** Encoder output in decode order; no B-frame reordering. */
  frames: readonly Mp4Frame[];
  /** AVCDecoderConfigurationRecord from WebCodecs (avc format). */
  description: Uint8Array;
  colorSpace?: VideoColorSpaceInit;
  audio?: Mp4AudioTrack;
}
export interface Mp4MuxDependencies { /** Unix epoch milliseconds. */ now?: () => number }

type Bytes = Uint8Array<ArrayBuffer>;
const UINT32_MAX = 0xffffffff;
function concat(parts: readonly Uint8Array[]): Bytes {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function integer(value: number, width: number): Bytes {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) >= (1n << BigInt(width * 8))) {
    throw new Error('MP4 integer exceeds field range');
  }
  const result = new Uint8Array(width); let remaining = BigInt(value);
  for (let i = width - 1; i >= 0; i--) { result[i] = Number(remaining & 255n); remaining >>= 8n; }
  return result;
}
const u16 = (value: number) => integer(value, 2);
const u32 = (value: number) => integer(value, 4);
const u64 = (value: number) => integer(value, 8);
const text = (value: string) => new TextEncoder().encode(value);
const zeros = (size: number) => new Uint8Array(size);
function header(type: string, payloadSize: number): Bytes {
  return payloadSize + 8 <= UINT32_MAX ? concat([u32(payloadSize + 8), text(type)])
    : concat([u32(1), text(type), u64(payloadSize + 16)]);
}
const box = (type: string, ...parts: Uint8Array[]) => {
  const content = concat(parts); return concat([header(type, content.length), content]);
};
const full = (type: string, flags: number, ...parts: Uint8Array[]) => box(type, u32(flags), ...parts);
const matrix = () => concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
function gcd(a: number, b: number): number { while (b) { const next = a % b; a = b; b = next; } return a; }

/** Rational frame rate, including 29.97 and 30000/1001, without microsecond rounding drift. */
function frameClock(fps: number): { scale: number; delta: number } {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid MP4 fps');
  let value = fps; let n0 = 0; let n1 = 1; let d0 = 1; let d1 = 0;
  for (let i = 0; i < 32; i++) {
    const whole = Math.floor(value); const n = whole * n1 + n0; const d = whole * d1 + d0;
    if (!Number.isSafeInteger(n) || n > UINT32_MAX || !Number.isSafeInteger(d) || d > UINT32_MAX) break;
    if (n > 0 && Math.abs(n / d - fps) <= fps * 1e-12) {
      let multiplier = 1;
      while (n * multiplier < 10000) multiplier *= 10;
      return { scale: n * multiplier, delta: d * multiplier };
    }
    n0 = n1; n1 = n; d0 = d1; d1 = d;
    value = 1 / (value - whole);
  }
  throw new Error('MP4 fps cannot be represented in an integer timescale');
}

function descriptor(tag: number, content: Uint8Array): Bytes {
  if (content.length > 0x0fffffff) throw new Error('MP4 descriptor is too large');
  const length = [content.length & 127]; let remaining = content.length >>> 7;
  while (remaining) { length.unshift((remaining & 127) | 128); remaining >>>= 7; }
  return concat([Uint8Array.of(tag, ...length), content]);
}
function audioEntry(audio: Mp4AudioTrack): Bytes {
  const base = concat([zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), zeros(4), u32(audio.sampleRate * 65536)]);
  if (audio.codec === 'aac') {
    const decoder = descriptor(4, concat([Uint8Array.of(0x40, 0x15), zeros(3), u32(128000), u32(128000),
      descriptor(5, audio.description!)]));
    const es = descriptor(3, concat([u16(2), Uint8Array.of(0), decoder, descriptor(6, Uint8Array.of(2))]));
    return box('mp4a', base, full('esds', 0, es));
  }
  const head = audio.description ?? opusHead(); const skip = opusPreSkip(head);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  // dOps uses network byte order; OpusHead uses little endian. Version 0, stereo mapping family 0.
  const dops = box('dOps', Uint8Array.of(0, audio.channels), u16(skip), u32(view.getUint32(12, true)),
    u16(view.getUint16(16, true)), Uint8Array.of(0));
  return box('Opus', base, dops);
}
function colorBox(colorSpace?: VideoColorSpaceInit): Bytes {
  const primaries: Record<VideoColorPrimaries, number> = { bt709: 1, bt470bg: 5, smpte170m: 6 };
  const transfer: Record<VideoTransferCharacteristics, number> = { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13 };
  const matrix: Record<VideoMatrixCoefficients, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6 };
  return box('colr', text('nclx'), u16(primaries[colorSpace?.primaries ?? 'bt709'] ?? 1),
    u16(transfer[colorSpace?.transfer ?? 'bt709'] ?? 1), u16(matrix[colorSpace?.matrix ?? 'bt709'] ?? 1),
    Uint8Array.of(colorSpace?.fullRange === true ? 0x80 : 0));
}
function videoEntry(width: number, height: number, description: Uint8Array, colorSpace?: VideoColorSpaceInit): Bytes {
  return box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000),
    zeros(4), u16(1), zeros(32), u16(24), u16(0xffff), box('avcC', description), colorBox(colorSpace));
}
function timeTable(durations: readonly number[]): Bytes {
  const runs: { count: number; delta: number }[] = [];
  for (const delta of durations) {
    const last = runs.at(-1);
    if (last?.delta === delta) last.count++; else runs.push({ count: 1, delta });
  }
  return full('stts', 0, u32(runs.length), ...runs.map(run => concat([u32(run.count), u32(run.delta)])));
}
interface Track {
  id: number; scale: number; duration: number; movieDuration: number;
  width: number; height: number; entry: Uint8Array; samples: readonly Uint8Array[];
  durations: readonly number[]; keys?: readonly number[]; priming?: number;
}
function offsetTable(offsets: readonly number[], wide: boolean): Bytes {
  return full(wide ? 'co64' : 'stco', 0, u32(offsets.length), ...offsets.map(wide ? u64 : u32));
}
/** Plan chunk offsets from sizes alone, accounting for the larger moov when co64 is needed. */
export function mp4ChunkTables(sampleSizes: readonly (readonly number[])[], prefixSize: number,
  movieSize: (wide: boolean) => number): Bytes[] {
  const offsetsAt = (base: number) => sampleSizes.map(sizes => sizes.map(size => {
    const offset = base; base += size; return offset;
  }));
  let wide = false; let offsets = offsetsAt(prefixSize + movieSize(false));
  if (offsets.some(track => track.some(offset => offset > UINT32_MAX))) {
    wide = true; offsets = offsetsAt(prefixSize + movieSize(true));
  }
  return offsets.map(track => offsetTable(track, wide));
}
function trackBox(track: Track, chunkTable: Uint8Array, time: number): Bytes {
  const isAudio = track.id === 2;
  const tkhd = full('tkhd', 7, u32(time), u32(time), u32(track.id), zeros(4), u32(track.movieDuration), zeros(8),
    u16(0), u16(0), u16(isAudio ? 0x100 : 0), zeros(2), matrix(), u32(track.width * 65536), u32(track.height * 65536));
  const mdhd = full('mdhd', 0, u32(time), u32(time), u32(track.scale), u32(track.duration), u16(0x55c4), zeros(2)); // und
  const hdlr = full('hdlr', 0, zeros(4), text(isAudio ? 'soun' : 'vide'), zeros(12), text(isAudio ? 'Sound\0' : 'Video\0'));
  const stbl = box('stbl', full('stsd', 0, u32(1), track.entry), timeTable(track.durations),
    ...(track.keys ? [full('stss', 0, u32(track.keys.length), ...track.keys.map(u32))] : []),
    full('stsc', 0, u32(1), u32(1), u32(1), u32(1)), // Each sample is one chunk.
    full('stsz', 0, u32(0), u32(track.samples.length), ...track.samples.map(sample => u32(sample.length))),
    chunkTable);
  const minf = box('minf', isAudio ? full('smhd', 0, zeros(4)) : full('vmhd', 1, zeros(8)),
    box('dinf', full('dref', 0, u32(1), full('url ', 1))), stbl);
  const edits = track.priming === undefined ? [] : [box('edts', full('elst', 0, u32(1), u32(track.movieDuration),
    // media_time is a signed 32-bit value, always non-negative here.
    u32(track.priming), u16(1), u16(0)))];
  return box('trak', tkhd, ...edits, box('mdia', mdhd, hdlr, minf));
}

/** Faststart MP4; raw audio mdhd includes priming/padding, elst defines the exact audible movie span. */
export function muxMp4({ width, height, fps, frames, description, colorSpace, audio }: Mp4MuxOptions,
  { now = Date.now }: Mp4MuxDependencies = {}): Bytes {
  if (!Number.isInteger(width) || width < 2 || width > 65535 || !Number.isInteger(height) || height < 2 || height > 65535
    || !frames.length || !frames[0].key || frames.some(frame => !frame.data.length)
    || !description || description.length < 7 || description[0] !== 1) throw new Error('Invalid MP4 video metadata or configuration');
  const clock = frameClock(fps);
  const movieScale = audio ? clock.scale / gcd(clock.scale, audio.sampleRate) * audio.sampleRate : clock.scale;
  const movieDuration = frames.length * clock.delta * (movieScale / clock.scale);
  const tracks: Track[] = [{ id: 1, scale: clock.scale, duration: frames.length * clock.delta, movieDuration, width, height,
    entry: videoEntry(width, height, description, colorSpace), samples: frames.map(frame => frame.data),
    durations: frames.map(() => clock.delta), keys: frames.flatMap((frame, i) => frame.key ? [i + 1] : []) }];
  if (audio) {
    if ((audio.codec !== 'aac' && audio.codec !== 'opus') || audio.sampleRate !== 48000 || audio.channels !== 2
      || !audio.frames.length || audio.frames.some(frame => !frame.data.length || !Number.isSafeInteger(frame.duration) || frame.duration < 1)
      || (audio.codec === 'aac' && (!audio.description || audio.description.length < 2))) throw new Error('Invalid MP4 audio configuration');
    const priming = audio.primingSamples ?? (audio.codec === 'aac' ? 1024 : opusPreSkip(audio.description));
    if (!Number.isSafeInteger(priming) || priming < 0 || priming > 0x7fffffff) throw new Error('Invalid MP4 audio priming');
    if (audio.codec === 'opus' && priming !== opusPreSkip(audio.description)) throw new Error('MP4 Opus priming must match pre-skip');
    const duration = audio.frames.reduce((sum, frame) => sum + frame.duration, 0);
    const packetSamples = audio.codec === 'aac' ? 1024 : 960;
    if (!Number.isSafeInteger(duration) || (BigInt(duration) + BigInt(packetSamples) - BigInt(priming)) * BigInt(clock.scale)
      < BigInt(frames.length) * BigInt(clock.delta) * BigInt(audio.sampleRate)) throw new Error('Insufficient MP4 audio duration');
    tracks.push({ id: 2, scale: audio.sampleRate, duration, movieDuration, width: 0, height: 0,
      entry: audioEntry(audio), samples: audio.frames.map(frame => frame.data), durations: audio.frames.map(frame => frame.duration), priming });
  }
  const ftyp = box('ftyp', text('isom'), u32(0x200), text('isomiso2avc1mp41'));
  const time = Math.floor(now() / 1000) + 2082844800; // Seconds since 1904-01-01, shared by all headers.
  const mvhd = full('mvhd', 0, u32(time), u32(time), u32(movieScale), u32(movieDuration), u32(0x10000), u16(0x100), zeros(10),
    matrix(), zeros(24), u32(tracks.length + 1));
  const samples = tracks.flatMap(track => track.samples);
  const dataSize = samples.reduce((sum, sample) => sum + sample.length, 0);
  const dataHeader = header('mdat', dataSize);
  const makeMoov = (tables: readonly Uint8Array[]) => box('moov', mvhd,
    ...tracks.map((track, i) => trackBox(track, tables[i], time)));
  const sizes = tracks.map(track => track.samples.map(sample => sample.length));
  const tables = mp4ChunkTables(sizes, ftyp.length + dataHeader.length,
    wide => makeMoov(sizes.map(track => offsetTable(track.map(() => 0), wide))).length);
  const moov = makeMoov(tables);
  return concat([ftyp, moov, dataHeader, ...samples]);
}
