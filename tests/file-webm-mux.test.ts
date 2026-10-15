import { describe, expect, it } from 'vitest';
import { muxWebm, opusHead } from '../src/file/webm-mux';

interface Element { id: number; size: number; sizeWidth: number; offset: number; start: number; end: number; data: Uint8Array }
// Independent EBML reader: IDs retain the marker, sizes remove it.
function parse(bytes: Uint8Array, start = 0, end = bytes.length): Element[] {
  const elements: Element[] = []; let cursor = start;
  const read = (id: boolean) => {
    const first = bytes[cursor++]; let mask = 0x80; let width = 1;
    while (!(first & mask) && width <= 8) { width++; mask >>= 1; }
    if (width > 8) throw new Error('Invalid VINT');
    let value = id ? first : first & (mask - 1);
    for (let i = 1; i < width; i++) value = value * 256 + bytes[cursor++];
    if (!id && value === 2 ** (width * 7) - 1) throw new Error('Unknown size');
    return { value, width };
  };
  while (cursor < end) {
    const offset = cursor; const id = read(true); const size = read(false);
    const payloadStart = cursor; cursor += size.value;
    if (cursor > end) throw new Error('Element overrun');
    elements.push({ id: id.value, size: size.value, sizeWidth: size.width, offset, start: payloadStart, end: cursor, data: bytes.subarray(payloadStart, cursor) });
  }
  if (cursor !== end) throw new Error('Invalid boundary'); return elements;
}
const children = (e: Element) => parse(e.data);
const get = (list: Element[], id: number) => { const e = list.find(e => e.id === id); if (!e) throw new Error(`Missing ${id.toString(16)}`); return e; };
const uint = (e: Element) => Array.from(e.data).reduce((n, b) => n * 256 + b, 0);
const text = (e: Element) => new TextDecoder().decode(e.data);
const base = { codec: 'vp9' as const, width: 720, height: 1096, durationMs: 4000, fps: 20 };
const frame = (timestampMs: number, key: boolean, data = Uint8Array.of(3, 9, 17)) => ({ timestampMs, key, data });

describe('minimal WebM mux', () => {
  it('keeps video-only output byte-for-byte identical to the pre-audio version', () => {
    // Fixture generated from the committed pre-T-509a mux, not from the current implementation.
    const previous = '1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878102428581021853806740d5114d9b74bf4dbb9253ab841549a96653ac8800000000000000444dbb9253ab841654ae6b53ac88000000000000007f4dbb9253ab841c53bb6b53ac8800000000000000c31549a966b62ad7b1830f424044898840af4000000000004d808f486f6c6f436172642d53747564696f57418f486f6c6f436172642d53747564696f1654ae6ba5aea3d7810173c5810183810123e3838402faf0808685565f565039e088b08202d0ba8204481f43b67595e78100a38781000080030911a387810032000309111c53bb6b8dbb8bb38100b786f78101f181a9';
    const bytes = muxWebm({ ...base, frames: [frame(0, true), frame(50, false)] });
    expect(Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')).toBe(previous);
  });
  it('writes an Opus track with little-endian OpusHead and nanosecond delay/preroll', () => {
    const list = children(parse(muxWebm({ ...base, frames: [frame(0, true)],
      audio: { frames: [frame(0, true)] } }))[1]);
    const header = children(parse(muxWebm({ ...base, frames: [frame(0, true)], audio: { frames: [frame(0, true)] } }))[0]);
    expect(uint(get(header, 0x4287))).toBe(4); expect(uint(get(header, 0x4285))).toBe(2);
    const tracks = children(get(list, 0x1654ae6b)); expect(tracks).toHaveLength(2);
    const track = children(tracks[1]);
    expect(uint(get(track, 0xd7))).toBe(2); expect(uint(get(track, 0x73c5))).toBe(2);
    expect(uint(get(track, 0x83))).toBe(2); expect(text(get(track, 0x86))).toBe('A_OPUS');
    const head = get(track, 0x63a2).data; expect(head).toHaveLength(19);
    expect(new TextDecoder().decode(head.slice(0, 8))).toBe('OpusHead');
    expect(Array.from(head.slice(8, 10))).toEqual([1, 2]);
    const view = new DataView(head.buffer, head.byteOffset, head.length);
    expect(view.getUint16(10, true)).toBe(312); expect(view.getUint32(12, true)).toBe(48000);
    expect(view.getInt16(16, true)).toBe(0); expect(head[18]).toBe(0);
    expect(uint(get(track, 0x56aa))).toBe(6_500_000); expect(uint(get(track, 0x56bb))).toBe(80_000_000);
    const audio = children(get(track, 0xe1)); const frequency = get(audio, 0xb5).data;
    expect(new DataView(frequency.buffer, frequency.byteOffset, 8).getFloat64(0)).toBe(48000);
    expect(uint(get(audio, 0x9f))).toBe(2);
    expect(track.some(e => e.id === 0x23e383)).toBe(false);
  });
  it('uses encoder CodecPrivate and its pre-skip for CodecDelay', () => {
    const description = opusHead(480);
    const list = children(parse(muxWebm({ ...base, frames: [frame(0, true)],
      audio: { frames: [frame(0, true)], codecPrivate: description } }))[1]);
    const track = children(children(get(list, 0x1654ae6b))[1]);
    expect(get(track, 0x63a2).data).toEqual(description); expect(uint(get(track, 0x56aa))).toBe(10_000_000);
  });
  it('interleaves blocks by time, starts clusters with video and cues only video', () => {
    const audioFrames = [0, 20, 40, 60, 1980, 2000, 2020, 3990].map(t => frame(t, true, Uint8Array.of(99)));
    const list = children(parse(muxWebm({ ...base, frames: [frame(0, true), frame(50, false), frame(2000, true), frame(2050, false)],
      audio: { frames: audioFrames } }))[1]);
    const clusters = list.filter(e => e.id === 0x1f43b675);
    expect(clusters.map(c => uint(get(children(c), 0xe7)))).toEqual([0, 2000]);
    const times = clusters.flatMap(c => {
      const fields = children(c); const time = uint(get(fields, 0xe7));
      const blocks = fields.filter(e => e.id === 0xa3); expect(blocks[0].data[0]).toBe(0x81);
      return blocks.map(b => [time + new DataView(b.data.buffer, b.data.byteOffset, b.data.length).getInt16(1), b.data[0]]);
    });
    expect(times).toEqual([[0, 129], [0, 130], [20, 130], [40, 130], [50, 129], [60, 130],
      [1980, 130], [2000, 129], [2000, 130], [2020, 130], [2050, 129], [3990, 130]]);
    const points = children(get(list, 0x1c53bb6b)); expect(points).toHaveLength(2);
    expect(points.every(p => uint(get(children(get(children(p), 0xb7)), 0xf7)) === 1)).toBe(true);
  });
  it('rejects invalid audio timestamps and malformed OpusHead', () => {
    for (const frames of [[frame(-1, true)], [frame(20, true), frame(0, true)], [frame(4007, true)], []]) {
      expect(() => muxWebm({ ...base, frames: [frame(0, true)], audio: { frames } })).toThrow(/audio/i);
    }
    expect(() => muxWebm({ ...base, frames: [frame(0, true)], audio: {
      frames: [frame(0, true)], codecPrivate: new Uint8Array(19),
    } })).toThrow(/OpusHead/);
  });
  it('keeps a delay-compensating tail packet and writes signed DiscardPadding', () => {
    const list = children(parse(muxWebm({ ...base, durationMs: 100, frames: [frame(0, true)],
      audio: { frames: [frame(0, true), { ...frame(100, true), discardPaddingNs: 13_500_000 }] } }))[1]);
    const fields = children(get(list, 0x1f43b675));
    const group = children(get(fields, 0xa0)); const block = get(group, 0xa1);
    expect(block.data[0]).toBe(130); expect(new DataView(block.data.buffer, block.data.byteOffset).getInt16(1)).toBe(100);
    const padding = get(group, 0x75a2); expect(uint(padding)).toBe(13_500_000);
    expect(padding.data[0] & 0x80).toBe(0); // Signed EBML integer must remain positive.
  });
  it('puts a rounded audio/video tie in the next cluster after its keyframe', () => {
    const list = children(parse(muxWebm({ ...base, frames: [frame(0, true), frame(2000, true)],
      audio: { frames: [frame(0, true), frame(1999.6, true)] } }))[1]);
    const clusters = list.filter(e => e.id === 0x1f43b675);
    expect(children(clusters[1]).filter(e => e.id === 0xa3).map(e => e.data[0])).toEqual([129, 130]);
  });
  it('requires the initial video keyframe before audio and keeps audio clusters on video keys', () => {
    expect(() => muxWebm({ ...base, frames: [frame(100, true)], audio: { frames: [frame(0, true)] } })).toThrow(/keyframe/i);
    const list = children(parse(muxWebm({ ...base, durationMs: 8000,
      frames: [frame(0, true), frame(5000, false), frame(6000, false), frame(7000, true)],
      audio: { frames: [frame(0, true), frame(5000, true), frame(6000, true), frame(7000, true)] } }))[1]);
    const clusters = list.filter(e => e.id === 0x1f43b675);
    expect(clusters.map(c => uint(get(children(c), 0xe7)))).toEqual([0, 7000]);
    expect(clusters.every(c => {
      const block = children(c).find(e => e.id === 0xa3)!;
      return block.data[0] === 129 && block.data[3] === 128;
    })).toBe(true);
  });
  it.each(['vp9', 'vp8'] as const)('writes known sizes, header, Info and %s track', codec => {
    const roots = parse(muxWebm({ ...base, codec, frames: [frame(0, true), frame(50, false)] }));
    expect(roots.map(e => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const header = children(roots[0]); expect(text(get(header, 0x4282))).toBe('webm'); expect(uint(get(header, 0x4287))).toBe(2);
    expect(uint(get(header, 0x42f2))).toBe(4); expect(uint(get(header, 0x42f3))).toBe(8);
    const segment = children(roots[1]); const info = children(get(segment, 0x1549a966));
    expect(uint(get(info, 0x2ad7b1))).toBe(1_000_000);
    const duration = get(info, 0x4489).data; expect(duration.length).toBe(8);
    expect(new DataView(duration.buffer, duration.byteOffset, 8).getFloat64(0)).toBe(4000);
    expect(text(get(info, 0x4d80))).toBe('HoloCard-Studio'); expect(text(get(info, 0x5741))).toBe('HoloCard-Studio');
    const track = children(get(children(get(segment, 0x1654ae6b)), 0xae));
    expect(uint(get(track, 0xd7))).toBe(1); expect(uint(get(track, 0x73c5))).toBe(1); expect(uint(get(track, 0x83))).toBe(1);
    expect(text(get(track, 0x86))).toBe(codec === 'vp9' ? 'V_VP9' : 'V_VP8');
    const video = children(get(track, 0xe0)); expect(uint(get(video, 0xb0))).toBe(720); expect(uint(get(video, 0xba))).toBe(1096);
  });
  it('preserves blocks and splits at keys, five seconds and large gaps', () => {
    const frames = [frame(0, true), frame(33.75, false), frame(2000, true), frame(2050, false), frame(7000, false), frame(50000, true)];
    const segment = children(parse(muxWebm({ ...base, durationMs: 50050, frames }))[1]);
    const clusters = segment.filter(e => e.id === 0x1f43b675);
    expect(clusters.map(c => uint(get(children(c), 0xe7)))).toEqual([0, 2000, 7000, 50000]);
    const decoded = clusters.flatMap(c => {
      const list = children(c); const time = uint(get(list, 0xe7));
      return list.filter(e => e.id === 0xa3).map(e => {
        expect(e.data[0]).toBe(0x81);
        const relative = new DataView(e.data.buffer, e.data.byteOffset, e.data.length).getInt16(1);
        expect(relative).toBeGreaterThanOrEqual(-32768); expect(relative).toBeLessThanOrEqual(32767); expect(e.data[3] & 0x7f).toBe(0);
        return { timestampMs: time + relative, key: !!(e.data[3] & 0x80), data: e.data.slice(4) };
      });
    });
    expect(decoded).toEqual(frames.map(f => ({ ...f, timestampMs: Math.round(f.timestampMs) })));
  });
  it('indexes keyframes with segment-relative Cluster positions and a SeekHead', () => {
    const bytes = muxWebm({ ...base, frames: [frame(0, true), frame(50, false), frame(2000, true)] });
    const segment = parse(bytes)[1]; const list = parse(bytes, segment.start, segment.end);
    const points = children(get(list, 0x1c53bb6b)).map(point => {
      const fields = children(point); const positions = children(get(fields, 0xb7)); expect(uint(get(positions, 0xf7))).toBe(1);
      const offset = uint(get(positions, 0xf1)); const cluster = list.find(e => e.offset - segment.start === offset)!;
      expect(cluster.id).toBe(0x1f43b675); return [uint(get(fields, 0xb3)), uint(get(children(cluster), 0xe7))];
    });
    expect(points).toEqual([[0, 0], [2000, 2000]]);
    const seeks = children(get(list, 0x114d9b74));
    for (const seek of seeks) {
      const fields = children(seek); const id = uint(get(fields, 0x53ab)); const offset = uint(get(fields, 0x53ac));
      expect(list.find(e => e.offset - segment.start === offset)?.id).toBe(id);
    }
    expect(seeks.some(s => uint(get(children(s), 0x53ab)) === 0x1c53bb6b)).toBe(true);
  });
  it('keeps large-frame SeekHead offsets on Info, Tracks and Cues IDs', () => {
    const bytes = muxWebm({ ...base, frames: [frame(0, true, new Uint8Array(512)), frame(50, false, new Uint8Array(512)), frame(2000, true, new Uint8Array(512))] });
    const segment = parse(bytes)[1]; const list = parse(bytes, segment.start, segment.end);
    const seeks = children(get(list, 0x114d9b74));
    expect(seeks.map(s => uint(get(children(s), 0x53ab)))).toEqual([0x1549a966, 0x1654ae6b, 0x1c53bb6b]);
    for (const seek of seeks) {
      const fields = children(seek); const position = get(fields, 0x53ac);
      expect(position.size).toBe(8);
      expect(parse(bytes, segment.start + uint(position), segment.end)[0].id).toBe(uint(get(fields, 0x53ab)));
    }
    expect(uint(get(children(seeks[2]), 0x53ac))).toBeGreaterThan(256);
  });
  it('does not cue a Cluster starting with a delta frame', () => {
    const list = children(parse(muxWebm({ ...base, durationMs: 8000, frames: [frame(0, true), frame(5000, false), frame(6000, false), frame(7000, true)] }))[1]);
    expect(list.filter(e => e.id === 0x1f43b675)).toHaveLength(3);
    expect(children(get(list, 0x1c53bb6b)).map(p => uint(get(children(p), 0xb3)))).toEqual([0, 7000]);
  });
  it.each([20, 30])('writes DefaultDuration in nanoseconds at %s fps', fps => {
    const list = children(parse(muxWebm({ ...base, fps, frames: [frame(0, true)] }))[1]);
    const track = children(get(children(get(list, 0x1654ae6b)), 0xae));
    expect(uint(get(track, 0x23e383))).toBe(Math.round(1e9 / fps));
  });
  it.each(['equal', 'greater', 'empty'] as const)('rejects %s frame data or timestamp boundary', kind => {
    const f = kind === 'empty' ? frame(0, true, new Uint8Array()) : frame(base.durationMs + (kind === 'greater' ? 1 : 0), true);
    expect(() => muxWebm({ ...base, frames: [f] })).toThrow('Invalid WebM frame');
  });
  it.each([[126, 1], [127, 2], [128, 2], [16382, 2], [16383, 3], [16384, 3], [2097150, 3], [2097151, 4]])('encodes size %i in %i bytes without an unknown-size marker', (size, width) => {
    const data = new Uint8Array(size - 4); data[0] = 37; data[data.length - 1] = 99;
    const segment = children(parse(muxWebm({ ...base, frames: [frame(0, true, data)] }))[1]);
    const block = get(children(get(segment, 0x1f43b675)), 0xa3);
    expect(block.size).toBe(size); expect(block.sizeWidth).toBe(width); expect(block.data[4]).toBe(37); expect(block.data[block.data.length - 1]).toBe(99);
  });
  it('rejects invalid tracks, duration and unsorted or non-decodable frames', () => {
    const valid = { ...base, frames: [frame(0, true)] };
    for (const input of [{ ...valid, width: 0 }, { ...valid, height: 2.5 }, { ...valid, durationMs: NaN },
      { ...valid, frames: [] }, { ...valid, frames: [frame(0, false)] }, { ...valid, frames: [frame(50, true), frame(0, false)] },
      { ...valid, frames: [frame(-1, true)] }, { ...valid, frames: [frame(NaN, true)] }, { ...valid, durationMs: 0 }]) expect(() => muxWebm(input)).toThrow();
  });
});
