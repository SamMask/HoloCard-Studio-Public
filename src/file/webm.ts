import type { RecordWebm, WebmAudio } from './types';
import { muxWebm, opusPreSkip, type WebmFrame } from './webm-mux';

const VIDEO_BITS_PER_SECOND = 7_000_000;
const MAX_ENCODE_QUEUE = 4;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_BATCH_FRAMES = 960; // 20 ms at 48 kHz.
const CODECS = [{ codec: 'vp09.00.40.08', container: 'vp9' }, { codec: 'vp8', container: 'vp8' }] as const;

type FrameHandle = Pick<VideoFrame, 'close'>;
interface EncoderHandle extends Pick<VideoEncoder, 'state' | 'encodeQueueSize' | 'configure' | 'flush' | 'close' | 'addEventListener' | 'removeEventListener'> {
  encode(frame: FrameHandle, options: VideoEncoderEncodeOptions): void;
}
type AudioHandle = Pick<AudioData, 'close'>;
interface AudioEncoderHandle extends Pick<AudioEncoder, 'state' | 'encodeQueueSize' | 'configure' | 'flush' | 'close' | 'addEventListener' | 'removeEventListener'> {
  encode(data: AudioHandle): void;
}
export interface WebmRecorderDependencies {
  VideoEncoder?: {
    new(init: VideoEncoderInit): EncoderHandle;
    isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
  };
  VideoFrame?: { new(data: AllowSharedBufferSource, init: VideoFrameBufferInit): FrameHandle };
  AudioEncoder?: {
    new(init: AudioEncoderInit): AudioEncoderHandle;
    isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
  };
  AudioData?: { new(init: AudioDataInit): AudioHandle };
}

function validateAudio(audio: WebmAudio): void {
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0 || audio.channels.length < 1 || audio.channels.length > 2
    || audio.channels.some(c => !(c instanceof Float32Array) || c.length !== audio.channels[0].length)) {
    throw new Error('Invalid WebM audio channels or sample rate');
  }
}

/** Planar stereo batch, resampled by linear interpolation and padded with silence. */
function audioBatch(audio: WebmAudio, start: number, length: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(length * 2);
  for (let channel = 0; channel < 2; channel++) {
    const source = audio.channels[Math.min(channel, audio.channels.length - 1)];
    for (let i = 0; i < length; i++) {
      const position = (start + i) * audio.sampleRate / AUDIO_SAMPLE_RATE;
      if (position >= source.length) continue;
      const index = Math.floor(position); const fraction = position - index;
      const sample = source[index] + ((source[Math.min(index + 1, source.length - 1)]) - source[index]) * fraction;
      if (!Number.isFinite(sample)) throw new Error('Invalid WebM audio sample');
      data[channel * length + i] = sample;
    }
  }
  return data;
}

export function createWebmRecorder(deps: WebmRecorderDependencies): RecordWebm {
  return (options, produce, signal) => new Promise<Blob>((resolve, reject) => {
    let encoder: EncoderHandle | undefined;
    let audioEncoder: AudioEncoderHandle | undefined;
    let settled = false;
    let failure: unknown;
    let producing = true;
    let pushing = false;
    let count = 0;
    let cancelWait: ((error: unknown) => void) | undefined;
    const chunks: WebmFrame[] = [];
    const audioChunks: WebmFrame[] = [];
    let codecPrivate: Uint8Array | undefined;
    let rejectStopped!: (error: unknown) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
    void stopped.catch(() => {});

    const closeEncoder = () => {
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* Preserve the original error. */ }
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      closeEncoder();
      try { if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close(); } catch { /* Preserve the original error. */ }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; failure = error; chunks.length = 0; audioChunks.length = 0;
      rejectStopped(error);
      cancelWait?.(error); cancelWait = undefined;
      cleanup(); reject(error);
    };
    const abort = () => fail(new DOMException('Aborted', 'AbortError'));
    const checkActive = () => { if (settled) throw failure; };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });

    const waitForQueue = (current: EncoderHandle | AudioEncoderHandle): Promise<void> => {
      checkActive();
      if (current.encodeQueueSize < MAX_ENCODE_QUEUE) return Promise.resolve();
      return new Promise<void>((done, failed) => {
        const remove = () => { current.removeEventListener('dequeue', onDequeue); cancelWait = undefined; };
        const onDequeue = () => {
          if (current.encodeQueueSize >= MAX_ENCODE_QUEUE) return;
          remove(); done();
        };
        cancelWait = error => { remove(); failed(error); };
        current.addEventListener('dequeue', onDequeue);
        onDequeue(); // Also handles a queue drained before listener registration.
      });
    };

    void (async () => {
      const { width, height, fps } = options;
      if (!Number.isSafeInteger(width) || width < 2 || !Number.isSafeInteger(height) || height < 2
        || !Number.isFinite(fps) || fps <= 0) throw new Error('Invalid WebM options');
      const { VideoEncoder: Encoder, VideoFrame: Frame } = deps;
      if (!Encoder || !Frame) throw new Error('WebCodecs VideoEncoder/VideoFrame is not supported');
      const audioConfig: AudioEncoderConfig = { codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: 128000,
        opus: { frameDuration: AUDIO_BATCH_FRAMES * 1e6 / AUDIO_SAMPLE_RATE } };
      if (options.audio) {
        validateAudio(options.audio);
        if (!deps.AudioEncoder || !deps.AudioData) throw new Error('WebCodecs AudioEncoder/AudioData is not supported');
        let supported = false;
        try { supported = !!(await deps.AudioEncoder.isConfigSupported(audioConfig)).supported; }
        catch { /* Report an unsupported Opus encoder below. */ }
        checkActive();
        if (!supported) throw new Error('WebM Opus audio encoding is not supported');
      }
      const codedWidth = width + width % 2; const codedHeight = height + height % 2;
      let selected: typeof CODECS[number] | undefined;
      let startupError: unknown;
      let startupFailed: Promise<never>;
      let rejectStartup: (error: unknown) => void;
      let firstFrameConfirmed = false;
      let configuring = false;
      const openEncoder = async (firstCandidate: number, initialError?: unknown) => {
        let lastError: unknown = initialError;
        for (const candidate of CODECS.slice(firstCandidate)) {
          const config: VideoEncoderConfig = { codec: candidate.codec, width: codedWidth, height: codedHeight,
            bitrate: VIDEO_BITS_PER_SECOND, framerate: fps };
          let supported = false;
          try { supported = !!(await Encoder.isConfigSupported(config)).supported; }
          catch { /* A rejected codec probe can still fall back to VP8. */ }
          checkActive();
          if (!supported) continue;
          startupError = undefined;
          startupFailed = new Promise<never>((_, reject) => { rejectStartup = reject; });
          void startupFailed.catch(() => {});
          const current = new Encoder({
            output: chunk => {
              if (settled || encoder !== current) return;
              try {
                const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
                chunks.push({ data, timestampMs: chunk.timestamp / 1000, key: chunk.type === 'key' });
              } catch (error) { fail(error); }
            },
            error: error => {
              if (settled || encoder !== current) return;
              if (firstFrameConfirmed || (!pushing && !configuring)) fail(error);
              else { startupError = error; rejectStartup(error); }
            },
          });
          encoder = current; selected = candidate;
          try {
            configuring = true;
            try { current.configure(config); } finally { configuring = false; }
            checkActive();
            if (startupError !== undefined) throw startupError;
            return;
          } catch (error) { checkActive(); lastError = error; closeEncoder(); chunks.length = 0; }
        }
        throw lastError ?? new Error('WebM VP9 and VP8 encoding is not supported');
      };
      await openEncoder(0);
      if (options.audio) {
        audioEncoder = new deps.AudioEncoder!({
          output: (chunk, metadata) => {
            if (settled) return;
            try {
              const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
              audioChunks.push({ data, timestampMs: chunk.timestamp / 1000, key: true,
                durationMs: chunk.duration === null ? AUDIO_BATCH_FRAMES * 1000 / AUDIO_SAMPLE_RATE : chunk.duration / 1000 });
              const description = metadata?.decoderConfig?.description;
              if (description) codecPrivate = (ArrayBuffer.isView(description)
                ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
                : new Uint8Array(description)).slice();
            } catch (error) { fail(error); }
          },
          error: fail,
        });
        audioEncoder.configure(audioConfig); checkActive();
      }
      // VideoFrame copies its input. Only odd dimensions need reusable padding storage.
      const padding = codedWidth !== width || codedHeight !== height
        ? new Uint8Array(codedWidth * codedHeight * 4) : undefined;
      const keyInterval = Math.max(1, Math.round(fps * 2));
      const push = async (rgba: Uint8ClampedArray) => {
        checkActive();
        if (!producing || pushing) {
          const error = new Error('WebM frames must be pushed sequentially and awaited'); fail(error); throw error;
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
          // WebCodecs timestamps/durations are integer microseconds; round each absolute timestamp.
          const frame = new Frame(pixels, { format: 'RGBA', codedWidth, codedHeight,
            timestamp: Math.round(count * 1_000_000 / fps), duration: Math.max(1, Math.round(1_000_000 / fps)) });
          try {
            const encode = async () => {
              if (startupError !== undefined) throw startupError;
              encoder!.encode(frame, { keyFrame: count % keyInterval === 0 });
              if (!firstFrameConfirmed) {
                // Confirm the first frame before accepting more input: async codec failures can still retry it.
                await Promise.race([encoder!.flush(), startupFailed, stopped]);
                checkActive();
                if (startupError !== undefined) throw startupError;
                firstFrameConfirmed = true;
              }
            };
            try { await encode(); }
            catch (error) {
              checkActive();
              if (firstFrameConfirmed || selected?.container !== 'vp9') throw error;
              closeEncoder(); chunks.length = 0;
              await openEncoder(1, error); await encode();
            }
          }
          finally { frame.close(); }
          checkActive(); count++;
          await waitForQueue(encoder!); checkActive();
        } catch (error) { fail(error); throw error; }
        finally { pushing = false; }
      };
      await produce(push); producing = false; checkActive();
      if (pushing) throw new Error('WebM frames must be awaited');
      if (!count) throw new Error('No WebM frames supplied');
      await Promise.race([encoder!.flush(), stopped]); checkActive();
      closeEncoder();
      let muxAudio: { frames: WebmFrame[]; codecPrivate?: Uint8Array } | undefined;
      if (options.audio) {
        const total = Math.round(count * AUDIO_SAMPLE_RATE / fps);
        if (!Number.isSafeInteger(total) || total < 1) throw new Error('Invalid WebM audio duration');
        for (let start = 0; start < total; start += AUDIO_BATCH_FRAMES) {
          checkActive();
          const length = Math.min(AUDIO_BATCH_FRAMES, total - start);
          const data = new deps.AudioData!({ format: 'f32-planar', sampleRate: AUDIO_SAMPLE_RATE,
            numberOfChannels: 2, numberOfFrames: length, timestamp: Math.round(start * 1e6 / AUDIO_SAMPLE_RATE),
            data: audioBatch(options.audio, start, length) });
          try { audioEncoder!.encode(data); } finally { data.close(); }
          await waitForQueue(audioEncoder!); checkActive();
        }
        await Promise.race([audioEncoder!.flush(), stopped]); checkActive();
        // Opus encoders may report the first packet before zero to account for pre-skip.
        // Store it at zero; CodecDelay in the track describes the decoder's pre-skip.
        const offset = Math.min(0, audioChunks[0]?.timestampMs ?? 0);
        const delayMs = opusPreSkip(codecPrivate) / 48;
        const durationMs = count * 1000 / fps;
        muxAudio = { codecPrivate, frames: audioChunks.map(chunk => {
          const timestampMs = chunk.timestampMs - offset;
          // DiscardPadding trims the last Opus packet without losing the samples needed after pre-skip.
          const discardPaddingNs = chunk.durationMs === undefined ? undefined
            : Math.max(0, Math.round((timestampMs + chunk.durationMs - delayMs - durationMs) * 1e6));
          return { ...chunk, timestampMs, discardPaddingNs };
        }).filter(chunk => chunk.timestampMs - delayMs < durationMs) };
      }
      const bytes = muxWebm({ codec: selected!.container, width: codedWidth, height: codedHeight,
        durationMs: count * 1000 / fps, fps, frames: chunks, audio: muxAudio });
      const blob = new Blob([bytes], { type: 'video/webm' });
      settled = true; cleanup(); chunks.length = 0; audioChunks.length = 0; resolve(blob);
    })().catch(fail);
  });
}

export const recordWebm: RecordWebm = (options, produce, signal) => createWebmRecorder({
  VideoEncoder: typeof VideoEncoder === 'undefined' ? undefined : VideoEncoder,
  VideoFrame: typeof VideoFrame === 'undefined' ? undefined : VideoFrame,
  AudioEncoder: typeof AudioEncoder === 'undefined' ? undefined : AudioEncoder,
  AudioData: typeof AudioData === 'undefined' ? undefined : AudioData,
})(options, produce, signal);
