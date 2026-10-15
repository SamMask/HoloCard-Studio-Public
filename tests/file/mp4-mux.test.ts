import { describe, expect, it, vi } from 'vitest';
import { muxMp4, mp4ChunkTables, type Mp4MuxOptions } from '../../src/file/mp4-mux';
import { opusHead } from '../../src/file/webm-mux';

interface Box { type: string; start: number; end: number; payload: number; children: Box[] }
const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);
function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Box[] = [];
  while (start < end) {
    const size = view.getUint32(start);
    const type = new TextDecoder().decode(bytes.subarray(start + 4, start + 8));
    expect(size).toBeGreaterThanOrEqual(8); expect(start + size).toBeLessThanOrEqual(end);
    const payload = start + 8;
    const childStart = containers.has(type) ? payload : type === 'stsd' || type === 'dref' ? payload + 8
      : type === 'avc1' ? payload + 78 : type === 'mp4a' || type === 'Opus' ? payload + 28 : undefined;
    result.push({ type, start, end: start + size, payload,
      children: childStart === undefined ? [] : boxes(bytes, childStart, start + size) });
    start += size;
  }
  expect(start).toBe(end); return result;
}
function child(parent: Box, type: string): Box {
  const result = parent.children.find(b => b.type === type);
  if (!result) throw new Error(`Missing ${type} inside ${parent.type}`);
  return result;
}
const avcc = Uint8Array.of(1, 100, 0, 40, 255, 225, 0, 2, 103, 100, 1, 0, 2, 104, 0);
const video = [
  { data: Uint8Array.of(11, 12), key: true },
  { data: Uint8Array.of(21, 22, 23), key: false },
  { data: Uint8Array.of(31), key: true },
];
const options: Mp4MuxOptions = { width: 720, height: 1000, fps: 20, frames: video, description: avcc };

describe('non-fragmented MP4 mux', () => {
  it.each([20, 30, 29.97, 30000 / 1001])('writes faststart, correct video tables and exact duration at %s fps', fps => {
    const bytes = muxMp4({ ...options, fps }); const root = boxes(bytes);
    expect(root.map(b => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(new TextDecoder().decode(bytes.subarray(8, 32))).toBe('isom\u0000\u0000\u0002\u0000isomiso2avc1mp41');
    const moov = root[1]; const track = child(moov, 'trak'); const mdia = child(track, 'mdia');
    const view = new DataView(bytes.buffer); const u32 = (b: Box, at: number) => view.getUint32(b.payload + at);
    const mvhd = child(moov, 'mvhd'); const mdhd = child(mdia, 'mdhd'); const tkhd = child(track, 'tkhd');
    expect(u32(mdhd, 12)).toBeGreaterThanOrEqual(10000);
    if (fps === 20) expect(u32(mdhd, 12)).toBe(20000);
    const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000];
    expect(u32(tkhd, 0)).toBe(7);
    expect([u32(tkhd, 76), u32(tkhd, 80)]).toEqual([720 * 65536, 1000 * 65536]);
    expect(Array.from({ length: 9 }, (_, i) => u32(tkhd, 40 + i * 4))).toEqual(identity);
    expect(view.getUint16(tkhd.payload + 36)).toBe(0);
    expect(u32(mvhd, 20)).toBe(65536); expect(view.getUint16(mvhd.payload + 24)).toBe(256);
    expect(Array.from({ length: 9 }, (_, i) => u32(mvhd, 36 + i * 4))).toEqual(identity);
    expect(u32(mvhd, 96)).toBe(2);
    expect(view.getUint16(mdhd.payload + 20)).toBe(0x55c4);
    expect(new TextDecoder().decode(bytes.slice(child(mdia, 'hdlr').payload + 8, child(mdia, 'hdlr').payload + 12))).toBe('vide');
    const vmhd = child(child(mdia, 'minf'), 'vmhd');
    expect(u32(vmhd, 0)).toBe(1); expect(bytes.slice(vmhd.payload + 4, vmhd.end)).toEqual(new Uint8Array(8));
    expect(u32(mvhd, 16) / u32(mvhd, 12)).toBeCloseTo(3 / fps, 12);
    expect(u32(tkhd, 20) / u32(mvhd, 12)).toBeCloseTo(3 / fps, 12);
    expect(u32(mdhd, 16) / u32(mdhd, 12)).toBeCloseTo(3 / fps, 12);
    const stbl = child(child(mdia, 'minf'), 'stbl');
    expect(stbl.children.map(b => b.type)).toEqual(['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco']);
    const avc1 = child(child(stbl, 'stsd'), 'avc1');
    expect(view.getUint16(avc1.payload + 24)).toBe(720); expect(view.getUint16(avc1.payload + 26)).toBe(1000);
    expect([u32(avc1, 28), u32(avc1, 32)]).toEqual([72 * 65536, 72 * 65536]);
    expect([40, 74, 76].map(at => view.getUint16(avc1.payload + at))).toEqual([1, 24, 65535]);
    const config = child(avc1, 'avcC'); expect(bytes.slice(config.payload, config.end)).toEqual(avcc);
    const stts = child(stbl, 'stts'); expect(u32(stts, 4)).toBe(1); expect(u32(stts, 8)).toBe(3);
    expect(u32(stts, 12) / u32(mdhd, 12)).toBeCloseTo(1 / fps, 12);
    const stss = child(stbl, 'stss'); expect([u32(stss, 4), u32(stss, 8), u32(stss, 12)]).toEqual([2, 1, 3]);
    const stsc = child(stbl, 'stsc'); expect([4, 8, 12, 16].map(i => u32(stsc, i))).toEqual([1, 1, 1, 1]);
    const stsz = child(stbl, 'stsz'); expect(u32(stsz, 4)).toBe(0); expect(u32(stsz, 8)).toBe(3);
    const stco = child(stbl, 'stco'); expect(u32(stco, 4)).toBe(3);
    let offset = root[2].payload;
    video.forEach((frame, i) => {
      expect(u32(stco, 8 + i * 4)).toBe(offset); expect(u32(stsz, 12 + i * 4)).toBe(frame.data.length);
      expect(bytes.slice(offset, offset + frame.data.length)).toEqual(frame.data); offset += frame.data.length;
    });
    expect(offset).toBe(bytes.length); expect(moov.children.filter(b => b.type === 'trak')).toHaveLength(1);
    const dref = child(child(child(mdia, 'minf'), 'dinf'), 'dref');
    expect(u32(dref, 0)).toBe(0); expect(u32(dref, 4)).toBe(1);
    expect(dref.children[0].type).toBe('url '); expect(u32(dref.children[0], 0)).toBe(1);
  });

  it.each(['aac', 'opus'] as const)('writes %s audio, codec configuration and priming edit', codec => {
    const primingSamples = codec === 'aac' ? 2048 : 480;
    const description = codec === 'aac' ? Uint8Array.of(0x11, 0x90) : opusHead(primingSamples);
    const frames = Array.from({ length: 10 }, (_, i) => ({ data: Uint8Array.of(80 + i, 90), duration: 1024 }));
    const bytes = muxMp4({ ...options, audio: { codec, sampleRate: 48000, channels: 2, description, primingSamples, frames } });
    const root = boxes(bytes); const moov = root[1]; const tracks = moov.children.filter(b => b.type === 'trak');
    expect(tracks).toHaveLength(2);
    const view = new DataView(bytes.buffer); const u32 = (b: Box, at: number) => view.getUint32(b.payload + at);
    const movieScale = u32(child(moov, 'mvhd'), 12); const audio = tracks[1];
    expect(u32(child(moov, 'mvhd'), 96)).toBe(3);
    const tkhd = child(audio, 'tkhd'); expect(u32(tkhd, 0)).toBe(7);
    expect(view.getUint16(tkhd.payload + 36)).toBe(256);
    expect([u32(tkhd, 76), u32(tkhd, 80)]).toEqual([0, 0]);
    expect(Array.from({ length: 9 }, (_, i) => u32(tkhd, 40 + i * 4))).toEqual([65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000]);
    expect(u32(child(audio, 'tkhd'), 20) / movieScale).toBe(3 / 20);
    const elst = child(child(audio, 'edts'), 'elst');
    expect(u32(elst, 4)).toBe(1); expect(u32(elst, 8) / movieScale).toBe(3 / 20);
    expect(view.getInt32(elst.payload + 12)).toBe(primingSamples); expect(u32(elst, 16)).toBe(0x10000);
    const mdia = child(audio, 'mdia'); const mdhd = child(mdia, 'mdhd');
    expect(view.getUint16(mdhd.payload + 20)).toBe(0x55c4);
    expect(new TextDecoder().decode(bytes.slice(child(mdia, 'hdlr').payload + 8, child(mdia, 'hdlr').payload + 12))).toBe('soun');
    expect(u32(mdhd, 12)).toBe(48000); expect(u32(mdhd, 16)).toBe(10 * 1024);
    const stbl = child(child(mdia, 'minf'), 'stbl');
    const entry = child(child(stbl, 'stsd'), codec === 'aac' ? 'mp4a' : 'Opus');
    expect(view.getUint16(entry.payload + 16)).toBe(2); expect(u32(entry, 24)).toBe(48000 * 65536);
    if (codec === 'aac') {
      const esds = child(entry, 'esds');
      // Decode MPEG-4 descriptors, including their variable-length size fields.
      const descriptor = (start: number) => {
        const tag = bytes[start++]; let size = 0; let part: number;
        do { part = bytes[start++]; size = size * 128 + (part & 127); } while (part & 128);
        return { tag, start, end: start + size };
      };
      const es = descriptor(esds.payload + 4); expect(es.tag).toBe(3);
      const decoder = descriptor(es.start + 3); expect(decoder.tag).toBe(4);
      expect(bytes[decoder.start]).toBe(0x40); expect(bytes[decoder.start + 1]).toBe(0x15);
      const specific = descriptor(decoder.start + 13); expect(specific.tag).toBe(5);
      expect(bytes.slice(specific.start, specific.end)).toEqual(description);
      const sl = descriptor(decoder.end); expect(sl.tag).toBe(6); expect(bytes[sl.start]).toBe(2);
    } else {
      const dops = child(entry, 'dOps');
      expect(bytes.slice(dops.payload, dops.end)).toEqual(Uint8Array.of(0, 2, 1, 224, 0, 0, 187, 128, 0, 0, 0));
    }
    const offsets = child(stbl, 'stco'); const sizes = child(stbl, 'stsz'); const times = child(stbl, 'stts');
    expect(u32(times, 4)).toBe(1); expect(u32(times, 8)).toBe(10); expect(u32(times, 12)).toBe(1024);
    frames.forEach((frame, i) => {
      const offset = u32(offsets, 8 + i * 4); expect(offset).toBeGreaterThanOrEqual(root[2].payload);
      expect(u32(sizes, 12 + i * 4)).toBe(frame.data.length);
      expect(bytes.slice(offset, offset + frame.data.length)).toEqual(frame.data);
    });
  });

  it('uses default AAC priming and Opus pre-skip from the header', () => {
    for (const codec of ['aac', 'opus'] as const) {
      const bytes = muxMp4({ ...options, audio: { codec, sampleRate: 48000, channels: 2,
        description: codec === 'aac' ? Uint8Array.of(0x11, 0x90) : opusHead(648),
        frames: [{ data: Uint8Array.of(9), duration: 10000 }] } });
      const track = boxes(bytes)[1].children.filter(b => b.type === 'trak')[1];
      const edit = child(child(track, 'edts'), 'elst');
      expect(new DataView(bytes.buffer).getInt32(edit.payload + 12)).toBe(codec === 'aac' ? 1024 : 648);
    }
  });

  it('uses one movie clock for fractional fps and audio, with variable sample durations', () => {
    const fps = 29.97;
    const audio = { codec: 'aac' as const, sampleRate: 48000, channels: 2, description: Uint8Array.of(0x11, 0x90),
      frames: [1024, 1024, 1024, 1024, 2000].map(duration => ({ data: Uint8Array.of(1), duration })) };
    const bytes = muxMp4({ ...options, fps, audio }); const moov = boxes(bytes)[1];
    const view = new DataView(bytes.buffer); const mvhd = child(moov, 'mvhd');
    const scale = view.getUint32(mvhd.payload + 12); const duration = view.getUint32(mvhd.payload + 16);
    expect(scale % 48000).toBe(0);
    expect(scale % view.getUint32(child(child(child(moov, 'trak'), 'mdia'), 'mdhd').payload + 12)).toBe(0);
    expect(duration / scale).toBeCloseTo(3 / fps, 12);
    for (const track of moov.children.filter(b => b.type === 'trak')) {
      expect(view.getUint32(child(track, 'tkhd').payload + 20)).toBe(duration);
    }
    const track = moov.children.filter(b => b.type === 'trak')[1];
    const edit = child(child(track, 'edts'), 'elst'); expect(view.getUint32(edit.payload + 8)).toBe(duration);
    const stts = child(child(child(child(track, 'mdia'), 'minf'), 'stbl'), 'stts');
    expect([4, 8, 12, 16, 20].map(at => view.getUint32(stts.payload + at))).toEqual([2, 4, 1024, 1, 2000]);
  });

  it('rejects invalid metadata, missing configuration, empty samples and insufficient audio', () => {
    for (const invalid of [{ ...options, fps: 0 }, { ...options, width: 0 }, { ...options, frames: [] },
      { ...options, description: new Uint8Array() }, { ...options, frames: [{ data: new Uint8Array(), key: true }] },
      { ...options, frames: [{ data: Uint8Array.of(1), key: false }] }]) expect(() => muxMp4(invalid)).toThrow();
    expect(() => muxMp4({ ...options, audio: { codec: 'aac', sampleRate: 48000, channels: 2,
      description: Uint8Array.of(0x11, 0x90), frames: [{ data: Uint8Array.of(1), duration: 1024 }] } })).toThrow(/audio.*duration/i);
  });

  it.each([
    [undefined, [1, 1, 1, 0]],
    [{ primaries: 'bt470bg', transfer: 'smpte170m', matrix: 'bt470bg', fullRange: true }, [5, 6, 5, 128]],
    [{ primaries: 'smpte170m', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: false }, [6, 13, 0, 0]],
    [{ primaries: 'bt709', transfer: 'bt709', matrix: 'smpte170m' }, [1, 1, 6, 0]],
    [{ primaries: null, transfer: null, matrix: null, fullRange: null }, [1, 1, 1, 0]],
  ] as const)('writes nclx colour codes for %j', (colorSpace, expected) => {
    const bytes = muxMp4({ ...options, colorSpace });
    const entry = child(child(child(child(child(child(boxes(bytes)[1], 'trak'), 'mdia'), 'minf'), 'stbl'), 'stsd'), 'avc1');
    const colr = child(entry, 'colr'); const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(colr.payload, colr.payload + 4))).toBe('nclx');
    expect([4, 6, 8].map(at => view.getUint16(colr.payload + at)).concat(bytes[colr.payload + 10])).toEqual(expected);
    expect(colr.end - colr.payload).toBe(11);
  });

  it('writes a single injected current time into every movie, track and media header', () => {
    const now = vi.fn(() => Date.UTC(2026, 9, 14, 12, 34, 56, 999));
    const bytes = muxMp4({ ...options, audio: { codec: 'aac', sampleRate: 48000, channels: 2,
      description: Uint8Array.of(0x11, 0x90), frames: [{ data: Uint8Array.of(1), duration: 10000 }] } }, { now });
    const expected = Math.floor(now.mock.results[0].value / 1000) + 2082844800;
    const movie = boxes(bytes)[1]; const view = new DataView(bytes.buffer);
    const headers = [child(movie, 'mvhd'), ...movie.children.filter(b => b.type === 'trak')
      .flatMap(track => [child(track, 'tkhd'), child(child(track, 'mdia'), 'mdhd')])];
    for (const header of headers) expect([4, 8].map(at => view.getUint32(header.payload + at))).toEqual([expected, expected]);
    expect(now).toHaveBeenCalledOnce();
  });
  it('uses the current system time when no clock is injected', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 14));
    try {
      const bytes = muxMp4(options); const header = child(boxes(bytes)[1], 'mvhd');
      expect(new DataView(bytes.buffer).getUint32(header.payload + 4)).toBe(Date.UTC(2026, 9, 14) / 1000 + 2082844800);
    } finally { now.mockRestore(); }
  });

  it.each(['aac', 'opus'] as const)('allows up to one %s packet short, rejects more using exact integer clocks', codec => {
    const primingSamples = codec === 'aac' ? 1024 : 312; const packet = codec === 'aac' ? 1024 : 960;
    const audio = { codec, sampleRate: 48000, channels: 2, primingSamples,
      description: codec === 'aac' ? Uint8Array.of(0x11, 0x90) : opusHead(primingSamples) };
    for (const deficit of [1, packet]) {
      const bytes = muxMp4({ ...options, audio: { ...audio,
        frames: [{ data: Uint8Array.of(9), duration: primingSamples + 7200 - deficit }] } });
      const movie = boxes(bytes)[1]; const track = movie.children.filter(b => b.type === 'trak')[1]; const view = new DataView(bytes.buffer);
      const mdhd = child(child(track, 'mdia'), 'mdhd'); const elst = child(child(track, 'edts'), 'elst');
      expect(view.getUint32(mdhd.payload + 16)).toBe(primingSamples + 7200 - deficit);
      expect(view.getUint32(elst.payload + 8) / view.getUint32(child(movie, 'mvhd').payload + 12)).toBe(0.15);
    }
    expect(() => muxMp4({ ...options, audio: { ...audio,
      frames: [{ data: Uint8Array.of(9), duration: primingSamples + 7200 - packet - 1 }] } })).toThrow(/audio.*duration/i);
    // Fractional duration: the one-packet boundary lies between adjacent integer audio samples.
    const required = 3 * 1001 * 48000 / 30000 + primingSamples;
    expect(() => muxMp4({ ...options, fps: 30000 / 1001, audio: { ...audio,
      frames: [{ data: Uint8Array.of(9), duration: Math.floor(required) - packet }] } })).toThrow(/audio.*duration/i);
    expect(() => muxMp4({ ...options, fps: 30000 / 1001, audio: { ...audio,
      frames: [{ data: Uint8Array.of(9), duration: Math.ceil(required) - packet }] } })).not.toThrow();
  });

  it('calculates and serializes co64 offsets using fake sizes without allocating 4 GB', () => {
    const movieSize = vi.fn((wide: boolean) => wide ? 124 : 100);
    const tables = mp4ChunkTables([[0xffffffff, 2], [3]], 40, movieSize);
    expect(movieSize.mock.calls).toEqual([[false], [true]]);
    const first = boxes(tables[0])[0]; const second = boxes(tables[1])[0];
    expect([first.type, second.type]).toEqual(['co64', 'co64']);
    const a = new DataView(tables[0].buffer); const b = new DataView(tables[1].buffer);
    expect(a.getUint32(first.payload + 4)).toBe(2);
    expect(a.getBigUint64(first.payload + 8)).toBe(164n);
    expect(a.getBigUint64(first.payload + 16)).toBe(164n + 0xffffffffn);
    expect(b.getBigUint64(second.payload + 8)).toBe(166n + 0xffffffffn);
    const narrow = mp4ChunkTables([[2, 3]], 40, () => 100)[0];
    const table = boxes(narrow)[0]; expect(table.type).toBe('stco');
    expect(new DataView(narrow.buffer).getUint32(table.payload + 12)).toBe(142);
    const boundary = mp4ChunkTables([[1]], 0xffffffff, () => 0)[0];
    expect(boxes(boundary)[0].type).toBe('stco');
    expect(new DataView(boundary.buffer).getUint32(16)).toBe(0xffffffff);
  });
});
