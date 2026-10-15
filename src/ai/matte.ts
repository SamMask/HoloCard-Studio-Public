import type { ApplyAlpha, Letterbox, MatteToAlpha, PrepareMatteInput, RefineAlpha } from './types';
import { boxBlur, pixelCount, removeSmallComponents, resizeBilinear, unitValue, validateSamples } from './image-ops';

function letterbox(width: number, height: number, size: number) {
  pixelCount(width, height);
  pixelCount(size, size, 3);
  const scale = size / Math.max(width, height);
  // Raster dimensions are rounded, with at least one pixel along either axis.
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const box: Letterbox = {
    size, scale, offsetX: Math.floor((size - scaledWidth) / 2), offsetY: Math.floor((size - scaledHeight) / 2), width, height,
  };
  return { box, scaledWidth, scaledHeight };
}

export const prepareMatteInput: PrepareMatteInput = (image, size = 1024) => {
  validateSamples(image.data, image.width, image.height, 4);
  const { box, scaledWidth, scaledHeight } = letterbox(image.width, image.height, size);
  const resized = resizeBilinear(image.data, image.width, image.height, scaledWidth, scaledHeight, 4);
  const plane = size * size;
  const tensor = new Float32Array(plane * 3);
  for (let y = 0; y < scaledHeight; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      const source = (y * scaledWidth + x) * 4;
      const target = (y + box.offsetY) * size + x + box.offsetX;
      for (let c = 0; c < 3; c++) tensor[c * plane + target] = resized[source + c] / 255;
    }
  }
  return { tensor, box };
};

export const matteToAlpha: MatteToAlpha = (mask, box) => {
  validateSamples(mask.data, mask.width, mask.height);
  const expected = letterbox(box.width, box.height, box.size);
  if (mask.width !== box.size || mask.height !== box.size || box.scale !== expected.box.scale
    || box.offsetX !== expected.box.offsetX || box.offsetY !== expected.box.offsetY) {
    throw new RangeError('Mask and letterbox metadata must match the prepared input.');
  }
  const { scaledWidth, scaledHeight } = expected;
  const cropped = new Float32Array(scaledWidth * scaledHeight);
  for (let y = 0; y < scaledHeight; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      cropped[y * scaledWidth + x] = unitValue(mask.data[(y + box.offsetY) * box.size + x + box.offsetX]);
    }
  }
  return { width: box.width, height: box.height, data: resizeBilinear(cropped, scaledWidth, scaledHeight, box.width, box.height) };
};

export const refineAlpha: RefineAlpha = (alpha, options) => {
  const count = validateSamples(alpha.data, alpha.width, alpha.height);
  const clip = options.clip ?? 0.04;
  if (!Number.isFinite(clip) || clip < 0 || clip > 0.5 || !Number.isFinite(options.feather) || options.feather < 0) {
    throw new RangeError('Clip must be between zero and 0.5; feather must be finite and nonnegative.');
  }
  // Match threshold precision to the Float32 mask, retaining exact endpoints.
  const low = Math.fround(clip);
  const high = Math.fround(1 - clip);
  const clipped = alpha.data.map(value => {
    const sample = unitValue(value);
    return sample < low ? 0 : sample > high ? 1 : sample;
  });
  const cleaned = removeSmallComponents(clipped, alpha.width, alpha.height, count * 0.0005);
  const data = boxBlur(cleaned, alpha.width, alpha.height, options.feather);
  // Feather only the surviving foreground: never grow into background or
  // resurrect clipped noise / removed fragments. Preserve fine details.
  for (let i = 0; i < count; i++) {
    data[i] = cleaned[i] === 0 ? 0 : Math.max(cleaned[i] * 0.5, Math.min(cleaned[i], unitValue(data[i])));
  }
  return { width: alpha.width, height: alpha.height, data };
};

export const applyAlpha: ApplyAlpha = (image, alpha) => {
  const count = validateSamples(image.data, image.width, image.height, 4);
  validateSamples(alpha.data, alpha.width, alpha.height);
  if (image.width !== alpha.width || image.height !== alpha.height) throw new RangeError('Alpha dimensions must match the image.');
  const data = image.data.slice();
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    data[offset + 3] = image.data[offset + 3] * unitValue(alpha.data[i]);
    if (data[offset + 3] === 0) data[offset] = data[offset + 1] = data[offset + 2] = 0;
  }
  return { width: image.width, height: image.height, data };
};
