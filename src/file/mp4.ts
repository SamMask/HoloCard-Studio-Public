import type { RecordMp4, WebmAudio } from './types';
import type { WebmRecorderDependencies } from './webm';
import { muxMp4, type Mp4AudioFrame, type Mp4AudioTrack, type Mp4Frame, type Mp4MuxDependencies } from './mp4-mux';
import { opusPreSkip } from './webm-mux';

export type Mp4RecorderDependencies = WebmRecorderDependencies & Mp4MuxDependencies;
type VideoHandle = InstanceType<NonNullable<Mp4RecorderDependencies['VideoEncoder']>>;
type AudioHandle = InstanceType<NonNullable<Mp4RecorderDependencies['AudioEncoder']>>;
const VIDEO_CODECS = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028'] as const;
const VIDEO_BITRATE = 7_000_000;
const SAMPLE_RATE = 48000;
const AUDIO_BITRATE = 128000;
const MAX_QUEUE = 4;
const AUDIO_ORIGIN_TOLERANCE_US = 5;

function unsupported(audio = false): Error {
  const error = new Error(audio ? 'MP4 AAC and Opus audio encoding is not supported' : 'MP4 H.264 encoding is not supported');
  error.name = audio ? 'Mp4AudioUnsupportedError' : 'Mp4UnsupportedError'; return error;
}
function copyDescription(description: AllowSharedBufferSource): Uint8Array<ArrayBuffer> {
  return (ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description)).slice();
}
function validateAudio(audio: WebmAudio): void {
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0 || audio.channels.length < 1 || audio.channels.length > 2
    || audio.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== audio.channels[0].length)) {
    throw new Error('Invalid MP4 audio channels or sample rate');
  }
}
/** Same planar stereo, linear resampling and silence padding as WebM, without modifying the caller's audio. */
function audioBatch(audio: WebmAudio, start: number, length: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(length * 2);
  for (let channel = 0; channel < 2; channel++) {
    const source = audio.channels[Math.min(channel, audio.channels.length - 1)];
    for (let i = 0; i < length; i++) {
      const position = (start + i) * audio.sampleRate / SAMPLE_RATE;
      if (position >= source.length) continue;
      const index = Math.floor(position); const fraction = position - index;
      const sample = source[index] + (source[Math.min(index + 1, source.length - 1)] - source[index]) * fraction;
      if (!Number.isFinite(sample)) throw new Error('Invalid MP4 audio sample');
      data[channel * length + i] = sample;
    }
  }
  return data;
}

export function createMp4Recorder(deps: Mp4RecorderDependencies): RecordMp4 {
  return (options, produce, signal, onInfo) => new Promise<Blob>((resolve, reject) => {
    let encoder: VideoHandle | undefined; let audioEncoder: AudioHandle | undefined;
    let settled = false; let failure: unknown; let producing = true; let pushing = false; let count = 0;
    let cancelWait: ((error: unknown) => void) | undefined;
    const chunks: Mp4Frame[] = [];
    const audioChunks: (Mp4AudioFrame & { timestamp: number })[] = [];
    let videoDescription: Uint8Array | undefined; let audioDescription: Uint8Array | undefined;
    let videoColorSpace: VideoColorSpaceInit | undefined;
    let rejectStopped!: (error: unknown) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
    void stopped.catch(() => {});
    const closeVideo = () => {
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* Preserve original failure. */ }
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', abort); closeVideo();
      try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch { /* Preserve original failure. */ }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; failure = error; chunks.length = 0; audioChunks.length = 0;
      rejectStopped(error); cancelWait?.(error); cancelWait = undefined; cleanup(); reject(error);
    };
    const abort = () => fail(new DOMException('Aborted', 'AbortError'));
    const checkActive = () => { if (settled) throw failure; };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });

    const waitForQueue = (current: VideoHandle | AudioHandle): Promise<void> => {
      checkActive(); if (current.encodeQueueSize < MAX_QUEUE) return Promise.resolve();
      return new Promise<void>((done, failed) => {
        const remove = () => { current.removeEventListener('dequeue', onDequeue); cancelWait = undefined; };
        const onDequeue = () => {
          if (current.encodeQueueSize >= MAX_QUEUE) return;
          remove(); done();
        };
        cancelWait = error => { remove(); failed(error); };
        current.addEventListener('dequeue', onDequeue); onDequeue();
      });
    };
    void (async () => {
      const { width, height, fps, audio } = options;
      if (!Number.isSafeInteger(width) || width < 2 || !Number.isSafeInteger(height) || height < 2
        || !Number.isFinite(fps) || fps <= 0) throw new Error('Invalid MP4 options');
      const codedWidth = width + width % 2; const codedHeight = height + height % 2;
      const { VideoEncoder: Encoder, VideoFrame: Frame } = deps;
      if (!Encoder || !Frame) throw unsupported();
      let audioConfig: AudioEncoderConfig | undefined;
      let audioCodec: 'aac' | 'opus' = 'aac';
      let selected = -1; let firstFrameConfirmed = false;
      let startupError: unknown; let configuring = false;
      let rejectStartup!: (error: unknown) => void; let startupFailed!: Promise<never>;
      const openVideo = async (first: number) => {
        for (let i = first; i < VIDEO_CODECS.length; i++) {
          const config: VideoEncoderConfig = { codec: VIDEO_CODECS[i], width: codedWidth, height: codedHeight,
            bitrate: VIDEO_BITRATE, framerate: fps, avc: { format: 'avc' }, latencyMode: 'realtime' };
          let supported = false;
          try { supported = !!(await Encoder.isConfigSupported(config)).supported; } catch { /* Try next profile. */ }
          checkActive(); if (!supported) continue;
          startupError = undefined;
          startupFailed = new Promise<never>((_, reject) => { rejectStartup = reject; });
          void startupFailed.catch(() => {});
          const current = new Encoder({
            output: (chunk, metadata) => {
              if (settled || encoder !== current) return;
              try {
                // stts describes decode order with no ctts: realtime must not emit reordered frames.
                if (chunk.timestamp !== Math.round(chunks.length * 1e6 / fps)) throw new Error('MP4 video output is missing or reordered');
                const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
                chunks.push({ data, key: chunk.type === 'key' });
                const description = metadata?.decoderConfig?.description;
                const colorSpace = metadata?.decoderConfig?.colorSpace;
                if (colorSpace) videoColorSpace = { ...colorSpace };
                if (description) {
                  const copy = copyDescription(description);
                  if (videoDescription && (copy.length !== videoDescription.length || copy.some((b, i) => b !== videoDescription![i]))) {
                    throw new Error('MP4 video configuration changed during recording');
                  }
                  videoDescription = copy;
                }
              } catch (error) { fail(error); }
            },
            error: error => {
              if (settled || encoder !== current) return;
              if (firstFrameConfirmed || (!pushing && !configuring)) fail(error);
              else { startupError = error; rejectStartup(error); }
            },
          });
          encoder = current; selected = i;
          try {
            configuring = true;
            try { current.configure(config); } finally { configuring = false; }
            checkActive(); if (startupError !== undefined) throw startupError; return;
          } catch { checkActive(); closeVideo(); chunks.length = 0; videoDescription = undefined; videoColorSpace = undefined; }
        }
        throw unsupported();
      };
      await openVideo(0);
      if (audio) {
        validateAudio(audio);
        if (!deps.AudioEncoder || !deps.AudioData) throw unsupported(true);
        for (const codec of ['mp4a.40.2', 'opus']) {
          const config: AudioEncoderConfig & { aac?: { format: 'aac' } } = {
            codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE,
            ...(codec === 'opus' ? { opus: { frameDuration: 20000 } } : { aac: { format: 'aac' } }) };
          let supported = false;
          try { supported = !!(await deps.AudioEncoder.isConfigSupported(config)).supported; } catch { /* Try next codec. */ }
          checkActive(); if (!supported) continue;
          audioConfig = config; audioCodec = codec === 'opus' ? 'opus' : 'aac'; break;
        }
        if (!audioConfig) throw unsupported(true);
      }
      const batchSize = audioCodec === 'aac' ? 1024 : 960;
      if (audio) {
        audioEncoder = new deps.AudioEncoder!({
          output: (chunk, metadata) => {
            if (settled) return;
            try {
              const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
              const duration = chunk.duration == null ? batchSize : Math.round(chunk.duration * SAMPLE_RATE / 1e6);
              if (!Number.isSafeInteger(duration) || duration < 1 || !Number.isSafeInteger(chunk.timestamp)) throw new Error('Invalid MP4 audio timing');
              const previous = audioChunks.at(-1);
              if (previous && Math.abs(chunk.timestamp - previous.timestamp - previous.duration * 1e6 / SAMPLE_RATE) > 2) {
                throw new Error('MP4 audio output is missing or reordered');
              }
              audioChunks.push({ data, duration, timestamp: chunk.timestamp });
              const description = metadata?.decoderConfig?.description;
              if (description) {
                const copy = copyDescription(description);
                if (audioDescription && (copy.length !== audioDescription.length || copy.some((b, i) => b !== audioDescription![i]))) {
                  throw new Error('MP4 audio configuration changed during recording');
                }
                audioDescription = copy;
              }
            } catch (error) { fail(error); }
          },
          error: fail,
        });
        audioEncoder.configure(audioConfig!); checkActive();
      }
      const padding = codedWidth !== width || codedHeight !== height ? new Uint8Array(codedWidth * codedHeight * 4) : undefined;
      const keyInterval = Math.max(1, Math.round(fps * 2));
      const push = async (rgba: Uint8ClampedArray) => {
        checkActive();
        if (!producing || pushing) {
          const error = new Error('MP4 frames must be pushed sequentially and awaited'); fail(error); throw error;
        }
        pushing = true;
        try {
          if (rgba.length !== width * height * 4) throw new Error('Invalid RGBA frame length');
          const pixels = padding ?? rgba;
          if (padding) for (let y = 0; y < codedHeight; y++) {
            const src = Math.min(y, height - 1) * width * 4; const dst = y * codedWidth * 4;
            pixels.set(rgba.subarray(src, src + width * 4), dst);
            if (codedWidth > width) pixels.set(rgba.subarray(src + (width - 1) * 4, src + width * 4), dst + width * 4);
          }
          const frame = new Frame(pixels, { format: 'RGBA', codedWidth, codedHeight,
            timestamp: Math.round(count * 1e6 / fps), duration: Math.max(1, Math.round((count + 1) * 1e6 / fps) - Math.round(count * 1e6 / fps)) });
          try {
            // Confirm frame zero before accepting more inputs, so profile fallback can replay just it.
            while (true) {
              try {
                if (startupError !== undefined) throw startupError;
                encoder!.encode(frame, { keyFrame: count % keyInterval === 0 });
                if (!firstFrameConfirmed) {
                  await Promise.race([encoder!.flush(), startupFailed, stopped]); checkActive();
                  if (startupError !== undefined) throw startupError;
                  firstFrameConfirmed = true;
                  onInfo?.({ videoCodec: VIDEO_CODECS[selected], audioCodec: audio ? audioCodec : null });
                }
                break;
              } catch (error) {
                checkActive(); if (firstFrameConfirmed) throw error;
                closeVideo(); chunks.length = 0; videoDescription = undefined; videoColorSpace = undefined; await openVideo(selected + 1);
              }
            }
          } finally { frame.close(); }
          checkActive(); count++; await waitForQueue(encoder!); checkActive();
        } catch (error) { fail(error); throw error; }
        finally { pushing = false; }
      };
      await Promise.race([produce(push), stopped]); producing = false; checkActive();
      if (pushing) throw new Error('MP4 frames must be awaited');
      if (!count) throw new Error('No MP4 frames supplied');
      await Promise.race([encoder!.flush(), stopped]); checkActive(); closeVideo();
      if (chunks.length !== count) throw new Error('MP4 encoder did not return every video frame');
      if (!videoDescription) throw new Error('Missing MP4 AVC decoder configuration');
      let muxAudio: Mp4AudioTrack | undefined;
      if (audio) {
        const total = Math.round(count * SAMPLE_RATE / fps);
        if (!Number.isSafeInteger(total) || total < 1) throw new Error('Invalid MP4 audio duration');
        for (let start = 0; start < total; start += batchSize) {
          checkActive(); const length = Math.min(batchSize, total - start);
          const data = new deps.AudioData!({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfChannels: 2,
            numberOfFrames: length, timestamp: Math.round(start * 1e6 / SAMPLE_RATE), data: audioBatch(audio, start, length) });
          try { audioEncoder!.encode(data); } finally { data.close(); }
          await waitForQueue(audioEncoder!); checkActive();
        }
        await Promise.race([audioEncoder!.flush(), stopped]); checkActive();
        if (!audioChunks.length) throw new Error('No MP4 audio packets');
        // AAC ASC has no delay field. Negative first output timestamp exposes encoder priming in microseconds.
        // Opus explicitly specifies decoder pre-skip in OpusHead, including when timestamps are non-negative.
        const timestamp = audioChunks[0].timestamp;
        const firstTime = timestamp > 0 && timestamp <= AUDIO_ORIGIN_TOLERANCE_US ? 0 : timestamp;
        if (firstTime > 0) throw new Error('MP4 audio does not start at the movie origin');
        const primingSamples = audioCodec === 'opus' ? opusPreSkip(audioDescription)
          : firstTime < 0 ? Math.round(-firstTime * SAMPLE_RATE / 1e6) : 1024;
        const frames: Mp4AudioFrame[] = audioChunks.map(({ data, duration }) => ({ data, duration }));
        muxAudio = { codec: audioCodec, sampleRate: SAMPLE_RATE, channels: 2, description: audioDescription, primingSamples, frames };
      }
      const bytes = muxMp4({ width: codedWidth, height: codedHeight, fps, frames: chunks,
        description: videoDescription, colorSpace: videoColorSpace, audio: muxAudio }, deps);
      const blob = new Blob([bytes], { type: 'video/mp4' });
      settled = true; cleanup(); chunks.length = 0; audioChunks.length = 0; resolve(blob);
    })().catch(fail);
  });
}

export const recordMp4: RecordMp4 = (options, produce, signal, onInfo) => createMp4Recorder({
  VideoEncoder: typeof VideoEncoder === 'undefined' ? undefined : VideoEncoder,
  VideoFrame: typeof VideoFrame === 'undefined' ? undefined : VideoFrame,
  AudioEncoder: typeof AudioEncoder === 'undefined' ? undefined : AudioEncoder,
  AudioData: typeof AudioData === 'undefined' ? undefined : AudioData,
})(options, produce, signal, onInfo);
