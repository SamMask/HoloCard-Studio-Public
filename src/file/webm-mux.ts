export interface WebmFrame {
  data: Uint8Array;
  timestampMs: number;
  key: boolean;
  durationMs?: number;
  discardPaddingNs?: number;
}

export interface WebmMuxOptions {
  codec: 'vp9' | 'vp8';
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  frames: readonly WebmFrame[];
  audio?: {
    frames: readonly WebmFrame[];
    codecPrivate?: Uint8Array;
  };
}

type Bytes = Uint8Array<ArrayBuffer>;

function concat(parts: readonly Uint8Array[]): Bytes {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function unsigned(value: number, width?: number): Bytes {
  let remaining = BigInt(value);
  const length = width ?? Math.max(1, Math.ceil(Math.log2(value + 1) / 8));
  const result = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) { result[i] = Number(remaining & 255n); remaining >>= 8n; }
  return result;
}

function sizeVint(size: number): Bytes {
  // All-one payloads are reserved for unknown sizes, including 127/16383.
  let width = 1;
  const value = BigInt(size);
  while (value >= (1n << BigInt(7 * width)) - 1n) width++;
  if (width > 8) throw new Error('WebM element is too large');
  const result = unsigned(size, width);
  result[0] |= 1 << (8 - width);
  return result;
}

function element(id: number, payload: Uint8Array): Bytes {
  return concat([unsigned(id), sizeVint(payload.length), payload]);
}
const integer = (id: number, value: number, width?: number) => element(id, unsigned(value, width));
const string = (id: number, value: string) => element(id, new TextEncoder().encode(value));
const master = (id: number, parts: readonly Uint8Array[]) => element(id, concat(parts));

/** Opus identification header, all numeric fields little-endian (mapping family 0). */
export function opusHead(preSkip = 312): Bytes {
  if (!Number.isInteger(preSkip) || preSkip < 0 || preSkip > 65535) throw new Error('Invalid Opus pre-skip');
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead')); head[8] = 1; head[9] = 2;
  const view = new DataView(head.buffer);
  view.setUint16(10, preSkip, true); view.setUint32(12, 48000, true);
  return head;
}

export function opusPreSkip(description: Uint8Array = opusHead()): number {
  if (description.length !== 19 || new TextDecoder().decode(description.subarray(0, 8)) !== 'OpusHead'
    || description[8] !== 1 || description[9] !== 2 || description[18] !== 0) throw new Error('Invalid stereo OpusHead');
  return new DataView(description.buffer, description.byteOffset, description.byteLength).getUint16(10, true);
}

function opusTrack(description: Uint8Array = opusHead()): Bytes {
  const preSkip = opusPreSkip(description);
  const frequency = new Uint8Array(8); new DataView(frequency.buffer).setFloat64(0, 48000);
  return master(0xae, [integer(0xd7, 2), integer(0x73c5, 2), integer(0x83, 2), string(0x86, 'A_OPUS'),
    element(0x63a2, description), integer(0x56aa, Math.round(preSkip / 48000 * 1e9)), integer(0x56bb, 80_000_000),
    master(0xe1, [element(0xb5, frequency), integer(0x9f, 2)]),
  ]);
}

function blockPayload(frame: WebmFrame, relativeTime: number, track: number, simple: boolean): Bytes {
  const header = new Uint8Array(4);
  header[0] = 0x80 | track; // Track number as a VINT; no lacing.
  new DataView(header.buffer).setInt16(1, relativeTime);
  header[3] = simple && frame.key ? 0x80 : 0; // BlockGroup's Block reserves the keyframe flag.
  return concat([header, frame.data]);
}

function simpleBlock(frame: WebmFrame, relativeTime: number, track = 1): Bytes {
  if (track === 2 && frame.discardPaddingNs) {
    const padding = unsigned(frame.discardPaddingNs);
    const signed = padding[0] & 0x80 ? concat([Uint8Array.of(0), padding]) : padding;
    return master(0xa0, [element(0xa1, blockPayload(frame, relativeTime, track, false)), element(0x75a2, signed)]);
  }
  return element(0xa3, blockPayload(frame, relativeTime, track, true));
}

function seekHead(info: number, tracks: number, cues: number): Bytes {
  return master(0x114d9b74, [[0x1549a966, info], [0x1654ae6b, tracks], [0x1c53bb6b, cues]].map(([id, position]) =>
    master(0x4dbb, [element(0x53ab, unsigned(id)), integer(0x53ac, position, 8)])));
}

/** Known-size WebM with optional Opus and video keyframe cues. Times are milliseconds. */
export function muxWebm({ codec, width, height, durationMs, fps, frames, audio }: WebmMuxOptions): Bytes {
  if ((codec !== 'vp9' && codec !== 'vp8') || !Number.isSafeInteger(width) || width < 1
    || !Number.isSafeInteger(height) || height < 1 || !Number.isFinite(durationMs) || durationMs <= 0
    || !Number.isFinite(fps) || fps <= 0 || !Number.isSafeInteger(Math.round(1e9 / fps)) || Math.round(1e9 / fps) < 1) {
    throw new Error('Invalid WebM metadata');
  }
  if (!frames.length || !frames[0].key) throw new Error('WebM requires an initial keyframe');
  let previousTime = -1;
  for (const frame of frames) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs < previousTime
      || !Number.isSafeInteger(Math.round(frame.timestampMs)) || frame.timestampMs >= durationMs || !frame.data.length) {
      throw new Error('Invalid WebM frame');
    }
    previousTime = frame.timestampMs;
  }
  if (audio) {
    if (!audio.frames.length) throw new Error('No WebM audio frames');
    if (Math.round(audio.frames[0].timestampMs) < Math.round(frames[0].timestampMs)) {
      throw new Error('WebM audio cannot precede the initial video keyframe');
    }
    const delayMs = opusPreSkip(audio.codecPrivate) / 48;
    previousTime = -1;
    for (const frame of audio.frames) {
      if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs < previousTime
        || !Number.isSafeInteger(Math.round(frame.timestampMs)) || frame.timestampMs - delayMs >= durationMs || !frame.data.length
        || (frame.discardPaddingNs !== undefined && (!Number.isSafeInteger(frame.discardPaddingNs) || frame.discardPaddingNs < 0))) {
        throw new Error('Invalid WebM audio frame');
      }
      previousTime = frame.timestampMs;
    }
  }

  const header = master(0x1a45dfa3, [
    integer(0x4286, 1), integer(0x42f7, 1), integer(0x42f2, 4), integer(0x42f3, 8),
    string(0x4282, 'webm'), integer(0x4287, audio ? 4 : 2), integer(0x4285, 2),
  ]);
  const duration = new Uint8Array(8);
  new DataView(duration.buffer).setFloat64(0, durationMs);
  const info = master(0x1549a966, [integer(0x2ad7b1, 1_000_000), element(0x4489, duration),
    string(0x4d80, 'HoloCard-Studio'), string(0x5741, 'HoloCard-Studio')]);
  const tracks = master(0x1654ae6b, [master(0xae, [
    integer(0xd7, 1), integer(0x73c5, 1), integer(0x83, 1),
    // Matroska DefaultDuration is an unsigned integer in nanoseconds (not TimestampScale units).
    integer(0x23e383, Math.round(1e9 / fps)),
    string(0x86, codec === 'vp9' ? 'V_VP9' : 'V_VP8'),
    master(0xe0, [integer(0xb0, width), integer(0xba, height)]),
  ]), ...(audio ? [opusTrack(audio.codecPrivate)] : [])]);

  // Video-only keeps its existing five-second safety cut. Audio clusters open on video keys.
  // Ties put video first so the initial block remains the seekable video keyframe.
  const clusters: { time: number; key: boolean; bytes: Bytes }[] = [];
  let clusterTime = 0;
  let clusterKey = false;
  let blocks: Bytes[] = [];
  let clusterFrames: WebmFrame[] = [];
  let audioIndex = 0;
  const appendAudio = (endTime: number) => {
    if (!audio || !clusterFrames.length) return;
    const packets: { frame: WebmFrame; track: number }[] = clusterFrames.map(frame => ({ frame, track: 1 }));
    while (audioIndex < audio.frames.length && Math.round(audio.frames[audioIndex].timestampMs) < endTime) {
      packets.push({ frame: audio.frames[audioIndex++], track: 2 });
    }
    packets.sort((a, b) => Math.round(a.frame.timestampMs) - Math.round(b.frame.timestampMs) || a.track - b.track);
    blocks = packets.map(({ frame, track }) => {
      const relative = Math.round(frame.timestampMs) - clusterTime;
      if (relative < -32768 || relative > 32767) throw new Error('WebM audio exceeds Cluster timestamp range');
      return simpleBlock(frame, relative, track);
    });
  };
  const finishCluster = () => {
    if (blocks.length) clusters.push({ time: clusterTime, key: clusterKey,
      bytes: master(0x1f43b675, [integer(0xe7, clusterTime), ...blocks]) });
  };
  for (const frame of frames) {
    const time = Math.round(frame.timestampMs);
    const relative = time - clusterTime;
    if (audio && !frame.key && relative > 32767) throw new Error('WebM audio requires a video keyframe within the Cluster timestamp range');
    if (!blocks.length || frame.key || (!audio && (relative >= 5000 || relative > 32767 || relative < -32768))) {
      appendAudio(time);
      finishCluster(); clusterTime = time; clusterKey = frame.key; blocks = [];
      clusterFrames = [];
    }
    blocks.push(simpleBlock(frame, time - clusterTime));
    clusterFrames.push(frame);
  }
  appendAudio(Infinity);
  finishCluster();

  // Fixed-width SeekPosition makes the header size independent of actual offsets.
  const headSize = seekHead(0, 0, 0).length;
  const infoPosition = headSize;
  const tracksPosition = infoPosition + info.length;
  let position = tracksPosition + tracks.length;
  const cuePoints: Bytes[] = [];
  for (const cluster of clusters) {
    if (cluster.key) cuePoints.push(master(0xbb, [integer(0xb3, cluster.time),
      master(0xb7, [integer(0xf7, 1), integer(0xf1, position)])]));
    position += cluster.bytes.length;
  }
  const cues = master(0x1c53bb6b, cuePoints);
  const segment = master(0x18538067, [seekHead(infoPosition, tracksPosition, position), info, tracks,
    ...clusters.map(cluster => cluster.bytes), cues]);
  return concat([header, segment]);
}
