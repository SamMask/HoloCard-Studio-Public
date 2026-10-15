import { describe, expect, it } from 'vitest';
import { applyAlpha, matteToAlpha, prepareMatteInput, refineAlpha } from '../../src/ai/matte';
import type { GrayImage, RgbaImage } from '../../src/ai/types';

const gray = (width: number, height: number, values: number[]): GrayImage => ({ width, height, data: Float32Array.from(values) });
const rgba = (width: number, height: number, values: number[]): RgbaImage => ({ width, height, data: Uint8ClampedArray.from(values) });

describe('prepareMatteInput', () => {
  it('letterboxes RGB in NCHW layout, divides only by 255 and ignores alpha', () => {
    const image = rgba(2, 1, [255, 128, 0, 0, 0, 64, 255, 255]);
    const before = image.data.slice();
    const { tensor, box } = prepareMatteInput(image, 4);
    expect(box).toEqual({ size: 4, scale: 2, offsetX: 0, offsetY: 1, width: 2, height: 1 });
    expect(tensor.length).toBe(48);
    expect(Array.from(tensor.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(tensor.subarray(4, 8))).toEqual([1, 0.75, 0.25, 0]);
    expect(tensor[16 + 4]).toBeCloseTo(128 / 255);
    expect(tensor[32 + 7]).toBe(1);
    expect(image.data).toEqual(before);
  });
  it('centers portrait input and returns the default size', () => {
    const prepared = prepareMatteInput(rgba(1, 2, [1, 2, 3, 255, 4, 5, 6, 255]), 4);
    expect(prepared.box.offsetX).toBe(1);
    expect(prepared.box.offsetY).toBe(0);
    expect(prepareMatteInput(rgba(1, 1, [255, 0, 0, 255])).tensor.length).toBe(3 * 1024 * 1024);
  });
  it('keeps at least one raster pixel on extreme aspect ratios', () => {
    const image: RgbaImage = { width: 1, height: 2000, data: new Uint8ClampedArray(8000).fill(255) };
    const { tensor, box } = prepareMatteInput(image, 4);
    expect(box.scale).toBe(4 / 2000);
    expect(Array.from(tensor.subarray(0, 16)).filter(value => value === 1)).toHaveLength(4);
  });
  it('rejects invalid size or image geometry', () => {
    expect(() => prepareMatteInput(rgba(1, 1, [0, 0, 0, 0]), 0)).toThrow(RangeError);
    expect(() => prepareMatteInput(rgba(2, 1, [0, 0, 0, 0]), 2)).toThrow(RangeError);
  });
});

describe('matteToAlpha', () => {
  it('crops padding before bilinear resizing so padding cannot contaminate the image', () => {
    const { box } = prepareMatteInput(rgba(2, 1, Array(8).fill(255)), 4);
    const mask = gray(4, 4, [0, 0, 0, 0, 1, 0.75, 0.25, 0, 1, 0.75, 0.25, 0, 0, 0, 0, 0]);
    const output = matteToAlpha(mask, box);
    expect(output.width).toBe(2);
    expect(output.height).toBe(1);
    expect(Array.from(output.data)).toEqual([0.875, 0.125]);
  });
  it('handles odd padding, tiny images and long thin images', () => {
    for (const [width, height] of [[1, 1], [2, 3], [1, 2000], [2000, 1]]) {
      const { box } = prepareMatteInput({ width, height, data: new Uint8ClampedArray(width * height * 4) }, 4);
      const result = matteToAlpha(gray(4, 4, Array(16).fill(1)), box);
      expect(result.data.length).toBe(width * height);
      expect(result.data.every(value => value === 1)).toBe(true);
    }
  });
  it('sanitizes model values before interpolation and clamps to the alpha range', () => {
    const box = { size: 2, scale: 1, offsetX: 0, offsetY: 0, width: 2, height: 2 };
    expect(Array.from(matteToAlpha(gray(2, 2, [NaN, Infinity, -1, 2]), box).data)).toEqual([0, 0, 0, 1]);
  });
  it('rejects inconsistent masks and letterbox metadata', () => {
    const box = { size: 2, scale: 1, offsetX: 0, offsetY: 0, width: 2, height: 2 };
    expect(() => matteToAlpha(gray(1, 1, [1]), box)).toThrow(RangeError);
    expect(() => matteToAlpha(gray(2, 2, [1, 1, 1, 1]), { ...box, offsetX: 1 })).toThrow(RangeError);
  });
});

describe('refineAlpha', () => {
  it('clips strictly outside the thresholds, with the default clip', () => {
    const input = gray(6, 1, [0.01, 0.04, 0.5, 0.96, 0.99, NaN]);
    const output = refineAlpha(input, { feather: 0 });
    expect(Array.from(output.data)).toEqual([0, input.data[1], 0.5, input.data[3], 1, 0]);
    expect(input.data[0]).toBeCloseTo(0.01);
  });
  it('removes isolated fragments below 0.05%, retaining a component at the exact limit', () => {
    const small = new Float32Array(4000);
    small[0] = 1;
    small[10] = small[11] = 1;
    const result = refineAlpha({ width: 4000, height: 1, data: small }, { feather: 0 });
    expect(result.data[0]).toBe(0);
    expect(result.data[10]).toBe(1);
    expect(result.data[11]).toBe(1);
  });
  it('softens inward and keeps a thin pixel at half its original alpha', () => {
    const output = refineAlpha(gray(3, 1, [0, 1, 0]), { feather: 1, clip: 0 });
    expect(Array.from(output.data)).toEqual([0, 0.5, 0]);
  });
  it('keeps blurred alpha within 0–1 despite sliding-sum cancellation', () => {
    const output = refineAlpha(gray(5, 1, [1, 1e-30, 0, 0, 0]), { feather: 1, clip: 0 });
    expect(output.data.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });
  it.each([0, 1])('preserves a uniform %s mask for 1x1 and 1x2000', value => {
    for (const height of [1, 2000]) {
      const result = refineAlpha({ width: 1, height, data: new Float32Array(height).fill(value) }, { feather: 4 });
      expect(result.data.every(sample => sample === value)).toBe(true);
    }
  });
  it('rejects invalid options', () => {
    const input = gray(1, 1, [1]);
    for (const feather of [-1, NaN, Infinity]) expect(() => refineAlpha(input, { feather })).toThrow(RangeError);
    for (const clip of [-0.1, 0.6, NaN]) expect(() => refineAlpha(input, { feather: 0, clip })).toThrow(RangeError);
  });
  it('refines a 1024x1024 mask within one second', () => {
    const data = new Float32Array(1024 * 1024);
    for (let y = 0; y < 1024; y++) data.fill(1, y * 1024 + 256, y * 1024 + 768);
    const start = performance.now();
    const output = refineAlpha({ width: 1024, height: 1024, data }, { feather: 16 });
    const elapsed = performance.now() - start;
    console.log(`refineAlpha 1024x1024 feather=16: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(3000);
    expect(output.data[512 * 1024 + 256]).toBeGreaterThan(0);
    expect(output.data[512 * 1024 + 256]).toBeLessThan(1);
  });
});

describe('applyAlpha', () => {
  it('multiplies the original alpha, preserves straight RGB and clears fully transparent RGB', () => {
    const image = rgba(3, 1, [200, 100, 50, 128, 20, 30, 40, 255, 50, 60, 70, 1]);
    const before = image.data.slice();
    const result = applyAlpha(image, gray(3, 1, [0.5, 0, 0.001]));
    expect(Array.from(result.data)).toEqual([200, 100, 50, 64, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(image.data).toEqual(before);
  });
  it('handles one pixel, non-finite masks and clamps out-of-range values', () => {
    const image = rgba(1, 1, [50, 60, 70, 255]);
    for (const value of [NaN, Infinity, -Infinity, -1]) expect(Array.from(applyAlpha(image, gray(1, 1, [value])).data)).toEqual([0, 0, 0, 0]);
    expect(Array.from(applyAlpha(image, gray(1, 1, [2])).data)).toEqual([50, 60, 70, 255]);
  });
  it('rejects mismatching sizes', () => {
    expect(() => applyAlpha(rgba(1, 1, [0, 0, 0, 0]), gray(2, 1, [0, 0]))).toThrow(RangeError);
  });
  it('applies a 2048x2048 alpha within one second', () => {
    const image = { width: 2048, height: 2048, data: new Uint8ClampedArray(2048 * 2048 * 4).fill(200) };
    const alpha = { width: 2048, height: 2048, data: new Float32Array(2048 * 2048).fill(0.5) };
    const start = performance.now();
    const result = applyAlpha(image, alpha);
    const elapsed = performance.now() - start;
    console.log(`applyAlpha 2048x2048: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(3000);
    expect(result.data[3]).toBe(100);
    expect(result.data[result.data.length - 1]).toBe(100);
  });
});
