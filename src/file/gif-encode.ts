import { GIFEncoder, quantize, type Palette } from 'gifenc';
import { GIF_MAX_WIDTH, type GifOptions } from './types';

const MAX_GIF_FIELD = 0xffff;
const PALETTE_SAMPLE_PIXELS = 16_384;
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

function validate(frames: readonly Uint8ClampedArray[], options: GifOptions): number {
  const { width, height, delayMs } = options;
  if (!Number.isInteger(width) || width < 1 || width > GIF_MAX_WIDTH) {
    throw new Error(`GIF width must be an integer from 1 to ${GIF_MAX_WIDTH}`);
  }
  if (!Number.isInteger(height) || height < 1 || height > MAX_GIF_FIELD) {
    throw new Error(`GIF height must be an integer from 1 to ${MAX_GIF_FIELD}`);
  }
  if (!Number.isFinite(delayMs) || delayMs <= 0) throw new Error('GIF delay must be positive and finite');
  const delay = Math.max(2, Math.round(delayMs / 10));
  if (delay > MAX_GIF_FIELD) throw new Error('GIF delay exceeds the 16-bit field');
  if (frames.length === 0) throw new Error('GIF requires at least one frame');
  const length = width * height * 4;
  for (const frame of frames) {
    if (!(frame instanceof Uint8ClampedArray) || frame.length !== length) {
      throw new Error(`GIF frames must contain exactly ${length} RGBA bytes`);
    }
    for (let i = 3; i < length; i += 4) {
      if (frame[i] !== 255) throw new Error('GIF frames must be opaque');
    }
  }
  return delay;
}

function sampleFrames(frames: readonly Uint8ClampedArray[], width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = frames[0].length / 4;
  // Every frame contributes equally. Continue the R2 sequence across frames so
  // stationary details are sampled without aliasing against the image width.
  // Target <= 16,384 samples in total; if there are more frames, keep one per frame.
  const perFrame = Math.min(pixels, Math.max(1, Math.floor(PALETTE_SAMPLE_PIXELS / frames.length)));
  const samples = new Uint8ClampedArray(perFrame * frames.length * 4);
  let target = 0;
  let g = 0;
  for (const frame of frames) {
    for (let sample = 0; sample < perFrame; sample++, g++) {
      const x = Math.floor(((g * 0.7548776662466927 + 0.5) % 1) * width);
      const y = Math.floor(((g * 0.5698402909980532 + 0.5) % 1) * height);
      const source = (perFrame === pixels ? sample : y * width + x) * 4;
      samples.set(frame.subarray(source, source + 4), target);
      target += 4;
    }
  }
  return samples;
}

/** RGB distance of a typical palette step, expressed as a per-channel span. */
export function getDitherSpan(palette: Palette): number {
  if (palette.length < 2) return 8;
  const distances = palette.map((color, i) => {
    let nearest = Infinity;
    for (let j = 0; j < palette.length; j++) {
      if (i === j) continue;
      const other = palette[j];
      const squared = (color[0] - other[0]) ** 2 + (color[1] - other[1]) ** 2 + (color[2] - other[2]) ** 2;
      nearest = Math.min(nearest, squared);
    }
    return Math.sqrt(nearest);
  }).sort((a, b) => a - b);
  const middle = Math.floor(distances.length / 2);
  const median = distances.length % 2 ? distances[middle] : (distances[middle - 1] + distances[middle]) / 2;
  return Math.max(8, Math.min(32, median / Math.sqrt(3)));
}

/** One immutable RGB555 lookup shared by all frames. Bin-center distances make
 * the mapping independent of which pixel happens to visit a bin first.
 */
export function buildPaletteLookup(palette: Palette): Uint8Array {
  const lookup = new Uint8Array(32768);
  for (let bin = 0; bin < lookup.length; bin++) {
    const r = (bin >> 10) * 8 + 3.5;
    const g = ((bin >> 5) & 31) * 8 + 3.5;
    const b = (bin & 31) * 8 + 3.5;
    let nearest = Infinity;
    let index = 0;
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      let distance = (r - color[0]) ** 2;
      if (distance >= nearest) continue;
      distance += (g - color[1]) ** 2;
      if (distance >= nearest) continue;
      distance += (b - color[2]) ** 2;
      if (distance < nearest) { nearest = distance; index = i; }
    }
    lookup[bin] = index;
  }
  return lookup;
}

function indexFrame(frame: Uint8ClampedArray, width: number, lookup: Uint8Array, span: number): Uint8Array {
  const indexed = new Uint8Array(frame.length / 4);
  const offsets = BAYER_4.map((value) => ((value + 0.5) / 16 - 0.5) * span);
  // Offsets depend only on coordinates, never frame number. Read the supplied
  // view directly; no RGBA copy and no per-frame palette cache are needed.
  for (let y = 0, i = 0; i < frame.length; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const offset = offsets[(y & 3) * 4 + (x & 3)];
      const red = frame[i] + offset;
      const green = frame[i + 1] + offset;
      const blue = frame[i + 2] + offset;
      const r = red < 0 ? 0 : red > 255 ? 31 : red >> 3;
      const g = green < 0 ? 0 : green > 255 ? 31 : green >> 3;
      const b = blue < 0 ? 0 : blue > 255 ? 31 : blue >> 3;
      indexed[i >> 2] = lookup[(r << 10) | (g << 5) | b];
    }
  }
  return indexed;
}

/** Pure RGBA -> GIF encoder. Internal dither switch is for quality comparisons;
 * the public EncodeGif contract stays unchanged and enables dithering by default.
 */
export function encodeGifFrames(
  frames: readonly Uint8ClampedArray[],
  options: GifOptions,
  onProgress?: (done: number, total: number) => void,
  { dither = true }: { dither?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const delay = validate(frames, options);
  // R2 samples cover many more source colors than the old aliased sampler.
  // Bound gifenc's quantization histogram to 4096 RGB444 bins; the final palette
  // retains averaged 8-bit RGB colors, and pixel indexing still uses RGB555.
  const palette = quantize(sampleFrames(frames, options.width, options.height), 256, { format: 'rgb444' });
  const lookup = buildPaletteLookup(palette);
  const span = dither ? getDitherSpan(palette) : 0;
  const encoder = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const indexed = indexFrame(frames[i], options.width, lookup, span);
    encoder.writeFrame(indexed, options.width, options.height, {
      // Only the first frame writes a color table; later frames reuse the global one.
      ...(i === 0 ? { palette } : {}),
      delay: delay * 10, // gifenc takes milliseconds and writes centiseconds internally.
      repeat: 0,
    });
    onProgress?.(i + 1, frames.length);
  }
  encoder.finish();
  return encoder.bytes();
}
