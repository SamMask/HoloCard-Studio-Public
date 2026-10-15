import type { DepthBand, DepthToImage, PrepareDepthInput, SplitByDepth } from './types';
import { depthBoundaries, fillBackground, insetBackground, pixelCount, quantiles, resizeBilinear, unitValue, validateSamples } from './image-ops';

const PATCH_SIZE = 14;
const MAX_EDGE = 1036;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export const prepareDepthInput: PrepareDepthInput = (image, size = 518) => {
  validateSamples(image.data, image.width, image.height, 4);
  pixelCount(size, size);
  const requestedScale = size / Math.min(image.width, image.height);
  const capped = Math.max(image.width, image.height) * requestedScale > MAX_EDGE;
  const scale = capped ? MAX_EDGE / Math.max(image.width, image.height) : requestedScale;
  const minimumPatches = capped ? 1 : Math.ceil(size / PATCH_SIZE);
  const patchDimension = (dimension: number) => Math.min(MAX_EDGE, Math.max(minimumPatches, Math.round(dimension * scale / PATCH_SIZE)) * PATCH_SIZE);
  const width = patchDimension(image.width);
  const height = patchDimension(image.height);
  const plane = pixelCount(width, height, 3);
  const resized = resizeBilinear(image.data, image.width, image.height, width, height, 4);
  const tensor = new Float32Array(plane * 3);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < plane; i++) {
      tensor[c * plane + i] = (resized[i * 4 + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return { tensor, width, height };
};

export const depthToImage: DepthToImage = (raw, width, height, outWidth, outHeight) => {
  validateSamples(raw, width, height);
  pixelCount(outWidth, outHeight);
  const [low, high] = quantiles(raw, [0.02, 0.98]);
  const data = resizeBilinear(raw, width, height, outWidth, outHeight);
  const range = high - low;
  if (range === 0) data.fill(0);
  else for (let i = 0; i < data.length; i++) data[i] = unitValue((data[i] - low) / range);
  return { width: outWidth, height: outHeight, data };
};

function transition(value: number, boundary: number, feather: number): number {
  if (feather === 0) return value > boundary ? 1 : 0;
  const t = (value - boundary) / feather + 0.5;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export const splitByDepth: SplitByDepth = (image, depth, options = {}) => {
  const count = validateSamples(image.data, image.width, image.height, 4);
  validateSamples(depth.data, depth.width, depth.height);
  const bands = options.bands ?? 3;
  const feather = options.feather ?? 0.06;
  if (image.width !== depth.width || image.height !== depth.height
    || !Number.isInteger(bands) || bands < 2 || bands > 4 || !Number.isFinite(feather) || feather < 0) {
    throw new RangeError('Depth dimensions must match; bands must be 2–4; feather must be finite and nonnegative.');
  }
  const boundaries = depthBoundaries(depth.data, bands);
  const areas = new Array<number>(boundaries.length + 1).fill(0);
  const minima = new Array<number>(areas.length).fill(Infinity);
  const maxima = new Array<number>(areas.length).fill(-Infinity);
  for (let i = 0; i < count; i++) {
    const sample = unitValue(depth.data[i]);
    let band = 0;
    // Tied depths stay together on the farther side of a quantile.
    while (band < boundaries.length && sample > boundaries[band]) band++;
    areas[band]++;
    if (sample < minima[band]) minima[band] = sample;
    if (sample > maxima[band]) maxima[band] = sample;
  }
  // Merge from near to far: the nearest object needs 8% support, intermediate
  // fragments need 3%. Keep a narrow far band, which can supply clean fill RGB.
  for (let band = areas.length - 1; band > 0; band--) {
    if (areas[band] >= count * (band === areas.length - 1 ? 0.08 : 0.03)) continue;
    areas[band - 1] += areas[band];
    minima[band - 1] = Math.min(minima[band - 1], minima[band]);
    maxima[band - 1] = Math.max(maxima[band - 1], maxima[band]);
    areas.splice(band, 1);
    minima.splice(band, 1);
    maxima.splice(band, 1);
    boundaries.splice(band - 1, 1);
  }
  // A quantile may land exactly on a plateau. Put its soft edge in the gap
  // to the next occupied band so that the plateau is not half-transparent.
  for (let i = 0; i < boundaries.length; i++) {
    if (boundaries[i] === maxima[i] && Number.isFinite(minima[i + 1])) {
      boundaries[i] = (maxima[i] + minima[i + 1]) / 2;
    }
  }
  const feathers = boundaries.map((boundary, i) => Math.min(
    feather,
    i > 0 ? (boundary - boundaries[i - 1]) / 2 : boundary,
    i + 1 < boundaries.length ? (boundaries[i + 1] - boundary) / 2 : Infinity,
  ));
  const result: DepthBand[] = [];
  for (let band = 0; band < areas.length; band++) {
    const data = image.data.slice();
    result.push({ image: { width: image.width, height: image.height, data }, depth: band === 0 ? 0 : Math.round(100 * band / (areas.length - 1)) });
  }
  // Evaluate each boundary only once per pixel. Difference of rounded
  // cumulative alphas also prevents independent byte rounding from adding 1.
  const knownBackground = new Uint8Array(result.length > 1 ? count : 0);
  const backgroundSupport = new Uint8Array(knownBackground.length);
  const masks = result.slice(1).map(band => band.image.data);
  if (result.length > 1) for (let i = 0; i < count; i++) {
    const sample = unitValue(depth.data[i]);
    const offset = i * 4 + 3;
    const sourceAlpha = image.data[offset];
    const foreground = transition(sample, boundaries[0], feathers[0]);
    // Prefer colors well inside the far depth range, not its foreground rim.
    if (foreground === 0) {
      knownBackground[i] = sourceAlpha;
      backgroundSupport[i] = Math.round(sourceAlpha * (1 - sample / boundaries[0]));
    }
    let enter = Math.round(sourceAlpha * foreground);
    for (let band = 1; band < result.length; band++) {
      const leave = band === result.length - 1 ? 0
        : Math.round(sourceAlpha * transition(sample, boundaries[band], feathers[band]));
      masks[band - 1][offset] = Math.max(0, enter - leave);
      enter = leave;
    }
  }
  if (result.length > 1) fillBackground(result[0].image.data, image.width, image.height, knownBackground,
    insetBackground(backgroundSupport, image.width, image.height));
  return result;
};
