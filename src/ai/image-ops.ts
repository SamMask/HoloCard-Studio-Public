/** Shared numeric image operations. All outputs own their buffers. */
type Samples = Float32Array | Uint8ClampedArray;

export function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function unitValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

export function pixelCount(width: number, height: number, channels = 1): number {
  if (![width, height, channels].every(value => Number.isSafeInteger(value) && value > 0)
    || !Number.isSafeInteger(width * height * channels)) {
    throw new RangeError('Image dimensions and channels must be positive safe integers.');
  }
  return width * height;
}

export function validateSamples(data: Samples, width: number, height: number, channels = 1): number {
  const count = pixelCount(width, height, channels);
  if (data.length !== count * channels) throw new RangeError('Image buffer length does not match its dimensions.');
  return count;
}

/** Integer block averaging before large reductions, including partial edge blocks. */
function averageBlocks(data: Samples, width: number, height: number, channels: number, xFactor: number, yFactor: number) {
  const outWidth = Math.ceil(width / xFactor);
  const outHeight = Math.ceil(height / yFactor);
  const result = new Float32Array(outWidth * outHeight * channels);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const right = Math.min(width, (x + 1) * xFactor);
    const bottom = Math.min(height, (y + 1) * yFactor);
    const area = (right - x * xFactor) * (bottom - y * yFactor);
    const target = (y * outWidth + x) * channels;
    for (let c = 0; c < channels; c++) {
      let sum = 0;
      for (let sy = y * yFactor; sy < bottom; sy++) for (let sx = x * xFactor; sx < right; sx++) {
        sum += finiteOrZero(data[(sy * width + sx) * channels + c]);
      }
      result[target + c] = sum / area;
    }
  }
  return { data: result, width: outWidth, height: outHeight };
}

/** Half-pixel bilinear sampling; reductions below 0.5 first use block averaging. */
export function resizeBilinear(
  data: Samples, width: number, height: number, outWidth: number, outHeight: number, channels = 1,
): Float32Array {
  validateSamples(data, width, height, channels);
  const count = pixelCount(outWidth, outHeight, channels);
  const xFactor = width / outWidth > 2 ? Math.floor(width / outWidth) : 1;
  const yFactor = height / outHeight > 2 ? Math.floor(height / outHeight) : 1;
  if (xFactor > 1 || yFactor > 1) {
    const averaged = averageBlocks(data, width, height, channels, xFactor, yFactor);
    data = averaged.data;
    width = averaged.width;
    height = averaged.height;
  }
  const result = new Float32Array(count * channels);
  const xScale = width / outWidth;
  const yScale = height / outHeight;
  // Reuse column coordinates across rows, retaining double precision weights.
  const left = new Uint32Array(outWidth), right = new Uint32Array(outWidth);
  const fractions = new Float64Array(outWidth);
  for (let x = 0; x < outWidth; x++) {
    const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * xScale - 0.5));
    const x0 = Math.floor(sx);
    left[x] = x0 * channels;
    right[x] = Math.min(width - 1, x0 + 1) * channels;
    fractions[x] = sx - x0;
  }
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * yScale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < outWidth; x++) {
      const fx = fractions[x];
      const a = y0 * width * channels + left[x];
      const b = y0 * width * channels + right[x];
      const c = y1 * width * channels + left[x];
      const d = y1 * width * channels + right[x];
      const target = (y * outWidth + x) * channels;
      for (let channel = 0; channel < channels; channel++) {
        const top = finiteOrZero(data[a + channel]) * (1 - fx) + finiteOrZero(data[b + channel]) * fx;
        const bottom = finiteOrZero(data[c + channel]) * (1 - fx) + finiteOrZero(data[d + channel]) * fx;
        result[target + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return result;
}

/** Sliding, separable box blur, O(width * height), including oversized radii. */
export function boxBlur(data: Float32Array, width: number, height: number, radius: number): Float32Array {
  const count = validateSamples(data, width, height);
  if (!Number.isFinite(radius) || radius < 0 || !Number.isSafeInteger(Math.round(radius) * 2 + 1)) {
    throw new RangeError('Blur radius must be finite, nonnegative and safely representable.');
  }
  const r = Math.round(radius);
  const divisor = r * 2 + 1;
  const horizontal = new Float32Array(count);
  const result = new Float32Array(count);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = finiteOrZero(data[row]) * (r + 1);
    for (let x = 1; x <= Math.min(r, width - 1); x++) sum += finiteOrZero(data[row + x]);
    sum += finiteOrZero(data[row + width - 1]) * Math.max(0, r - width + 1);
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / divisor;
      sum += finiteOrZero(data[row + Math.min(width - 1, x + r + 1)])
        - finiteOrZero(data[row + Math.max(0, x - r)]);
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = horizontal[x] * (r + 1);
    for (let y = 1; y <= Math.min(r, height - 1); y++) sum += horizontal[y * width + x];
    sum += horizontal[(height - 1) * width + x] * Math.max(0, r - height + 1);
    for (let y = 0; y < height; y++) {
      result[y * width + x] = sum / divisor;
      sum += horizontal[Math.min(height - 1, y + r + 1) * width + x]
        - horizontal[Math.max(0, y - r) * width + x];
    }
  }
  return result;
}

/** Linear interpolation of sorted ranks (fraction * (n - 1)). */
export function quantiles(data: Float32Array, fractions: readonly number[]): number[] {
  if (data.length === 0 || fractions.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError('Quantiles require samples and fractions between zero and one.');
  }
  const sorted = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) sorted[i] = finiteOrZero(data[i]);
  sorted.sort();
  return fractions.map(fraction => {
    const rank = fraction * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    return sorted[lower] * (1 - (rank - lower)) + sorted[upper] * (rank - lower);
  });
}

function unitHistogram(data: Float32Array) {
  const bins = 4096;
  const counts = new Float64Array(bins);
  const minima = new Float32Array(bins).fill(Infinity);
  const maxima = new Float32Array(bins).fill(-Infinity);
  for (let i = 0; i < data.length; i++) {
    const sample = unitValue(data[i]);
    const bin = Math.floor(sample * (bins - 1));
    counts[bin]++;
    if (sample < minima[bin]) minima[bin] = sample;
    if (sample > maxima[bin]) maxima[bin] = sample;
  }
  return { counts, minima, maxima };
}

function histogramQuantiles(histogram: ReturnType<typeof unitHistogram>, count: number, fractions: readonly number[]): number[] {
  const { counts, minima, maxima } = histogram;
  const atRank = (rank: number) => {
    let offset = 0;
    for (let bin = 0; bin < counts.length; bin++) {
      if (rank < offset + counts[bin]) {
        const t = counts[bin] <= 1 ? 0 : (rank - offset) / (counts[bin] - 1);
        return minima[bin] + (maxima[bin] - minima[bin]) * t;
      }
      offset += counts[bin];
    }
    return 1;
  };
  return fractions.map(fraction => {
    const rank = fraction * (count - 1);
    const lower = atRank(Math.floor(rank));
    return lower + (atRank(Math.ceil(rank)) - lower) * (rank - Math.floor(rank));
  });
}

/** O(n + 4096) quantiles for unit depth; within-bin rank error is at most 1/4095.
 * Observed bin extrema preserve exact plateaus, including tied zero/one depths.
 */
export function unitQuantiles(data: Float32Array, fractions: readonly number[]): number[] {
  if (data.length === 0 || fractions.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError('Quantiles require samples and fractions between zero and one.');
  }
  return histogramQuantiles(unitHistogram(data), data.length, fractions);
}

/** Prefer pronounced histogram valleys; use area quantiles only without a valley.
 * Limit resolution to roughly 16 samples/bin so sparse ramps do not look multimodal.
 * With fewer valleys than requested, keep fewer bands rather than bisecting a mode.
 */
export function depthBoundaries(data: Float32Array, bands: number): number[] {
  if (data.length === 0 || !Number.isInteger(bands) || bands < 2 || bands > 4) {
    throw new RangeError('Depth boundaries require samples and 2–4 bands.');
  }
  const bins = Math.min(256, Math.floor(data.length / 16));
  const fractions = Array.from({ length: bands - 1 }, (_, i) => (i + 1) / bands);
  if (bins < 8) return unitQuantiles(data, fractions);
  const fine = unitHistogram(data);
  const fallback = () => histogramQuantiles(fine, data.length, fractions);
  const histogram = new Float64Array(bins);
  // Equal-width bins: 1.0 belongs to the last full bin, not a bin of its own.
  // Percentile normalization creates clipped platforms; they still belong to
  // the extreme bands, but must not manufacture peaks in the mode search.
  for (let i = 0; i < fine.counts.length; i++) {
    if (fine.maxima[i] <= 0.005 || fine.minima[i] >= 0.995) continue;
    histogram[Math.min(bins - 1, Math.floor(i / fine.counts.length * bins))] += fine.counts[i];
  }
  histogram[0] = histogram[1] = histogram[2];
  histogram[bins - 1] = histogram[bins - 2] = histogram[bins - 3];
  // Triangular smoothing suppresses single-bin noise without moving gap centers.
  const smooth = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    for (let d = -2; d <= 2; d++) smooth[i] += histogram[Math.max(0, Math.min(bins - 1, i + d))] * (3 - Math.abs(d));
  }
  const peaks: number[] = [];
  for (let start = 0; start < bins;) {
    let end = start;
    while (end + 1 < bins && smooth[end + 1] === smooth[start]) end++;
    if (smooth[start] > 0 && (start === 0 || smooth[start] > smooth[start - 1])
      && (end === bins - 1 || smooth[end] > smooth[end + 1])) peaks.push(Math.floor((start + end) / 2));
    start = end + 1;
  }
  const valleyBetween = (left: number, right: number) => {
    let minimum = Infinity, first = left, last = left;
    for (let bin = left + 1; bin < right; bin++) {
      if (smooth[bin] < minimum) { minimum = smooth[bin]; first = last = bin; }
      else if (smooth[bin] === minimum) last = bin;
    }
    return { minimum, first, last };
  };
  // Merge shallow neighboring peaks first. Low-density noise in a broad valley
  // must not hide the much stronger modes on either side of it.
  for (let i = 1; i < peaks.length;) {
    const left = peaks[i - 1], right = peaks[i];
    const { minimum } = valleyBetween(left, right);
    if (minimum > Math.min(smooth[left], smooth[right]) * 0.4) {
      peaks.splice(smooth[left] < smooth[right] ? i - 1 : i, 1);
      i = Math.max(1, i - 1);
    } else i++;
  }
  const valleys: { boundary: number; score: number }[] = [];
  const cumulative = new Float64Array(bins + 1);
  for (let i = 0; i < fine.counts.length; i++) {
    cumulative[Math.min(bins - 1, Math.floor(i / fine.counts.length * bins)) + 1] += fine.counts[i];
  }
  for (let i = 1; i <= bins; i++) cumulative[i] += cumulative[i - 1];
  for (let i = 1; i < peaks.length; i++) {
    const left = peaks[i - 1], right = peaks[i];
    const { minimum, first, last } = valleyBetween(left, right);
    const shoulder = Math.min(smooth[left], smooth[right]);
    if (minimum > shoulder * 0.4) continue;
    const center = (first + last) / 2;
    const leftArea = cumulative[Math.floor(center) + 1];
    if (leftArea < data.length * 0.03 || data.length - leftArea < data.length * 0.03) continue;
    valleys.push({ boundary: (center + 0.5) / bins, score: (shoulder - minimum) * (right - left) });
  }
  if (valleys.length === 0) return fallback();
  return valleys.sort((a, b) => b.score - a.score).slice(0, bands - 1)
    .map(valley => valley.boundary).sort((a, b) => a - b);
}

/** Separable five-pixel minimum: shrink support by two pixels in O(n). */
export function insetBackground(known: Uint8Array, width: number, height: number): Uint8Array {
  if (known.length !== pixelCount(width, height)) throw new RangeError('Background support must match image dimensions.');
  const horizontal = new Uint8Array(known.length), result = new Uint8Array(known.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    // Only the two edge pixels need clamped coordinates.
    for (let x = 0; x < Math.min(2, width); x++) horizontal[row + x] = Math.min(
      known[row + Math.max(0, x - 2)], known[row + Math.max(0, x - 1)], known[row + x],
      known[row + Math.min(width - 1, x + 1)], known[row + Math.min(width - 1, x + 2)],
    );
    for (let x = 2; x < width - 2; x++) {
      const i = row + x;
      if (known[i] === 0) continue;
      horizontal[i] = Math.min(known[i - 2], known[i - 1], known[i], known[i + 1], known[i + 2]);
    }
    for (let x = Math.max(2, width - 2); x < width; x++) horizontal[row + x] = Math.min(
      known[row + x - 2], known[row + x - 1], known[row + x],
      known[row + Math.min(width - 1, x + 1)], known[row + Math.min(width - 1, x + 2)],
    );
  }
  for (let y = 0; y < height; y++) {
    const a = Math.max(0, y - 2) * width, b = Math.max(0, y - 1) * width, c = y * width;
    const d = Math.min(height - 1, y + 1) * width, e = Math.min(height - 1, y + 2) * width;
    for (let x = 0; x < width; x++) {
      if (horizontal[c + x] === 0) continue;
      result[c + x] = Math.min(horizontal[a + x], horizontal[b + x], horizontal[c + x], horizontal[d + x], horizontal[e + x]);
    }
  }
  return result;
}

interface ColorLevel { data: Float32Array; width: number; height: number }
const FILL_REDUCTION = 4;

/** Byte RGB and byte support have their own hot loop, keeping array types
 * stable instead of mixing Float32 pyramid accesses in the full-image reduction.
 */
function reduceKnownColors(data: Uint8ClampedArray, width: number, height: number, known: Uint8Array): ColorLevel {
  const outWidth = Math.ceil(width / FILL_REDUCTION), outHeight = Math.ceil(height / FILL_REDUCTION);
  const result = new Float32Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    let red = 0, green = 0, blue = 0, weight = 0;
    const right = Math.min(width, (x + 1) * FILL_REDUCTION), bottom = Math.min(height, (y + 1) * FILL_REDUCTION);
    for (let sy = y * FILL_REDUCTION; sy < bottom; sy++) for (let sx = x * FILL_REDUCTION; sx < right; sx++) {
      const pixel = sy * width + sx, offset = pixel * 4;
      if (known[pixel] === 0) continue;
      const coverage = known[pixel] / 255;
      red += data[offset] * coverage;
      green += data[offset + 1] * coverage;
      blue += data[offset + 2] * coverage;
      weight += coverage;
    }
    const offset = (y * outWidth + x) * 4;
    if (weight > 0) {
      result[offset] = red / weight;
      result[offset + 1] = green / weight;
      result[offset + 2] = blue / weight;
      result[offset + 3] = weight / ((right - x * FILL_REDUCTION) * (bottom - y * FILL_REDUCTION));
    }
  }
  return { data: result, width: outWidth, height: outHeight };
}

/** Push known RGB into a reduced, alpha-weighted color/coverage pyramid. */
function reduceColors(data: Float32Array, width: number, height: number, factor = 2): ColorLevel {
  const outWidth = Math.ceil(width / factor), outHeight = Math.ceil(height / factor);
  const result = new Float32Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    let red = 0, green = 0, blue = 0, weight = 0;
    const right = Math.min(width, (x + 1) * factor), bottom = Math.min(height, (y + 1) * factor);
    for (let sy = y * factor; sy < bottom; sy++) for (let sx = x * factor; sx < right; sx++) {
      const pixel = sy * width + sx, offset = pixel * 4;
      const coverage = data[offset + 3];
      red += data[offset] * coverage;
      green += data[offset + 1] * coverage;
      blue += data[offset + 2] * coverage;
      weight += coverage;
    }
    const offset = (y * outWidth + x) * 4;
    if (weight > 0) {
      result[offset] = red / weight;
      result[offset + 1] = green / weight;
      result[offset + 2] = blue / weight;
      result[offset + 3] = weight / ((right - x * factor) * (bottom - y * factor));
    }
  }
  return { data: result, width: outWidth, height: outHeight };
}

/** Pull coarse colors into missing support, preserving all original known pixels. */
function pullColors(data: Float32Array, width: number, height: number, coarse: ColorLevel): void {
  const source = coarse.data;
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, y / 2 - 0.25);
    const y0 = Math.floor(sy), y1 = Math.min(coarse.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x, offset = pixel * 4;
      if (data[offset + 3] === 1) continue;
      const sx = Math.max(0, x / 2 - 0.25);
      const x0 = Math.floor(sx), x1 = Math.min(coarse.width - 1, x0 + 1), fx = sx - x0;
      const a = (y0 * coarse.width + x0) * 4, b = (y0 * coarse.width + x1) * 4;
      const c = (y1 * coarse.width + x0) * 4, d = (y1 * coarse.width + x1) * 4;
      const coverage = data[offset + 3];
      for (let channel = 0; channel < 3; channel++) {
        const top = source[a + channel] * (1 - fx) + source[b + channel] * fx;
        const bottom = source[c + channel] * (1 - fx) + source[d + channel] * fx;
        data[offset + channel] = data[offset + channel] * coverage + (top * (1 - fy) + bottom * fy) * (1 - coverage);
      }
    }
  }
}

// Keep byte output separate from floating-point pyramid pulls: otherwise the
// large final pass makes the hot typed-array accesses polymorphic in the JIT.
function writeFilledColors(data: Uint8ClampedArray, width: number, height: number, coarse: ColorLevel, known: Uint8Array): void {
  const source = coarse.data;
  const columns = new Uint32Array(width * 2);
  const fractions = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const sx = Math.max(0, (x + 0.5) / FILL_REDUCTION - 0.5), x0 = Math.floor(sx);
    columns[x * 2] = x0 * 4;
    columns[x * 2 + 1] = Math.min(coarse.width - 1, x0 + 1) * 4;
    fractions[x] = sx - x0;
  }
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, (y + 0.5) / FILL_REDUCTION - 0.5), y0 = Math.floor(sy), fy = sy - y0;
    const top = y0 * coarse.width * 4, bottom = Math.min(coarse.height - 1, y0 + 1) * coarse.width * 4;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x, offset = pixel * 4;
      if (known[pixel] > 0 || data[offset + 3] === 0) continue;
      const fx = fractions[x], left = columns[x * 2], right = columns[x * 2 + 1];
      const a = top + left, b = top + right, c = bottom + left, d = bottom + right;
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      data[offset] = source[a] * wa + source[b] * wb + source[c] * wc + source[d] * wd;
      data[offset + 1] = source[a + 1] * wa + source[b + 1] * wb + source[c + 1] * wc + source[d + 1] * wd;
      data[offset + 2] = source[a + 2] * wa + source[b + 2] * wb + source[c + 2] * wc + source[d + 2] * wd;
    }
  }
}

/** Fill covered background RGB in place; alpha is untouched. Known preserves
 * uncovered far pixels. Support stores alpha-weighted color confidence, zero
 * elsewhere; it can be inset without overwriting the original uncovered RGB.
 * Pyramid storage starts at quarter resolution. Without any visible background,
 * the fill uses the source's visible alpha-weighted average color.
 */
export function fillBackground(data: Uint8ClampedArray, width: number, height: number, known: Uint8Array, support = known): void {
  const count = validateSamples(data, width, height, 4);
  if (known.length !== count || support.length !== count) throw new RangeError('Background support must match image dimensions.');
  const levels = [reduceKnownColors(data, width, height, support)];
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    const last = levels.at(-1)!;
    levels.push(reduceColors(last.data, last.width, last.height));
  }
  const root = levels.at(-1)!.data;
  if (root[3] === 0) {
    let red = 0, green = 0, blue = 0, weight = 0;
    for (let i = 0; i < count; i++) {
      const offset = i * 4, alpha = data[offset + 3];
      red += data[offset] * alpha;
      green += data[offset + 1] * alpha;
      blue += data[offset + 2] * alpha;
      weight += alpha;
    }
    if (weight === 0) return;
    root[0] = red / weight; root[1] = green / weight; root[2] = blue / weight;
  }
  for (let i = levels.length - 2; i >= 0; i--) {
    const level = levels[i];
    pullColors(level.data, level.width, level.height, levels[i + 1]);
  }
  writeFilledColors(data, width, height, levels[0], known);
}

/** Eight-connected positive samples; iterative flood fill with a reusable queue. */
export function removeSmallComponents(
  data: Float32Array, width: number, height: number, minimumArea: number,
): Float32Array {
  const count = validateSamples(data, width, height);
  if (!Number.isFinite(minimumArea) || minimumArea < 0) throw new RangeError('Component area must be finite and nonnegative.');
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) result[i] = finiteOrZero(data[i]);
  if (minimumArea <= 1) return result;
  const visited = new Uint8Array(count);
  const queue = new Uint32Array(count);
  for (let start = 0; start < count; start++) {
    if (visited[start] || result[start] <= 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const neighbor = ny * width + nx;
          if (visited[neighbor] || result[neighbor] <= 0) continue;
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    if (tail < minimumArea) {
      for (let i = 0; i < tail; i++) result[queue[i]] = 0;
    }
  }
  return result;
}
