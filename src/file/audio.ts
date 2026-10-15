import { MUSIC_MAX_BYTES, type MusicDuration, type MusicOptions, type PrepareMusic } from './types';

export const MUSIC_MAX_SECONDS = 15 * 60;

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FADE_IN_SEC = 0.05;

export interface MusicDependencies {
  OfflineAudioContext?: {
    new(channels: number, length: number, sampleRate: number): Pick<OfflineAudioContext,
      'decodeAudioData' | 'createBufferSource' | 'startRendering' | 'destination'>;
  };
}

function validateOptions({ startSec, durationSec, fadeOutSec = 1 }: MusicOptions): void {
  if (!Number.isFinite(startSec) || startSec < 0 || !Number.isFinite(durationSec) || durationSec <= 0
    || !Number.isFinite(fadeOutSec) || fadeOutSec < 0) throw new Error('Invalid music options');
}

/** Copies the requested interval; overlapping linear fades multiply. Never changes input. */
export function sliceAndFade(channels: readonly Float32Array[], sampleRate: number, options: MusicOptions): Float32Array[] {
  validateOptions(options);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || channels.length < 1 || channels.length > 2
    || channels.some(c => c.length !== channels[0].length)) throw new Error('Invalid music channels or sample rate');
  const length = Math.round(options.durationSec * sampleRate);
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('Invalid music duration');
  const start = options.startSec >= channels[0].length / sampleRate ? 0 : Math.floor(options.startSec * sampleRate);
  const fadeIn = Math.min(length, Math.round(FADE_IN_SEC * sampleRate));
  const fadeOut = Math.min(length, Math.round((options.fadeOutSec ?? 1) * sampleRate));
  return channels.map(source => {
    const result = new Float32Array(length);
    result.set(source.subarray(start, start + length));
    for (let i = 0; i < length; i++) {
      const inGain = fadeIn === 0 ? 1 : Math.min(1, i / Math.max(1, fadeIn - 1));
      const outGain = fadeOut === 0 ? 1 : Math.min(1, (length - 1 - i) / Math.max(1, fadeOut - 1));
      result[i] = Math.max(-1, Math.min(1, result[i] * inGain * outGain));
    }
    return result;
  });
}

export function createMusicTools(deps: MusicDependencies): { musicDuration: MusicDuration; prepareMusic: PrepareMusic } {
  const context = (length: number) => {
    if (!deps.OfflineAudioContext) throw new Error('OfflineAudioContext is not supported');
    return new deps.OfflineAudioContext(CHANNELS, length, SAMPLE_RATE);
  };
  const decode = async (file: Blob) => {
    if (file.size > MUSIC_MAX_BYTES) throw new Error('Music file is too large');
    const decoder = context(1);
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.numberOfChannels < 1) {
      throw new Error('Invalid decoded music');
    }
    if (decoded.duration > MUSIC_MAX_SECONDS) throw new Error('Music is too long');
    return decoded;
  };
  return {
    musicDuration: async file => (await decode(file)).duration,
    prepareMusic: async (file, options) => {
      validateOptions(options);
      const decoded = await decode(file);
      const length = Math.round(options.durationSec * SAMPLE_RATE);
      if (!Number.isSafeInteger(length) || length < 1) throw new Error('Invalid music duration');
      const offsetSec = options.startSec >= decoded.duration ? 0 : options.startSec;
      const renderer = context(length);
      const source = renderer.createBufferSource();
      source.buffer = decoded;
      source.connect(renderer.destination); source.start(0, offsetSec);
      const rendered = await renderer.startRendering();
      return { sampleRate: SAMPLE_RATE, channels: sliceAndFade(
        [rendered.getChannelData(0), rendered.getChannelData(1)], SAMPLE_RATE, { ...options, startSec: 0 },
      ) };
    },
  };
}

const browserTools = () => createMusicTools({
  OfflineAudioContext: typeof OfflineAudioContext === 'undefined' ? undefined : OfflineAudioContext,
});
export const musicDuration: MusicDuration = file => browserTools().musicDuration(file);
export const prepareMusic: PrepareMusic = (file, options) => browserTools().prepareMusic(file, options);
