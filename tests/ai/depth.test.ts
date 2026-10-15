import { describe, expect, it } from 'vitest';
import { depthToImage, prepareDepthInput, splitByDepth } from '../../src/ai/depth';
import type { GrayImage, RgbaImage } from '../../src/ai/types';

const gray = (values: number[]): GrayImage => ({ width: values.length, height: 1, data: Float32Array.from(values) });
function image(width: number, height = 1): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 128, 0, 255], i);
  return { width, height, data };
}

describe('prepareDepthInput', () => {
  it('normalizes RGB in NCHW layout using ImageNet constants', () => {
    const input = image(1);
    input.data[3] = 8;
    const result = prepareDepthInput(input, 14);
    expect(result.width).toBe(14);
    expect(result.height).toBe(14);
    expect(result.tensor.length).toBe(3 * 14 * 14);
    expect(result.tensor[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(result.tensor[196]).toBeCloseTo((128 / 255 - 0.456) / 0.224);
    expect(result.tensor[392]).toBeCloseTo(-0.406 / 0.225);
    expect(input.data[3]).toBe(8);
  });
  it('scales the short edge and rounds the long edge to the nearest patch multiple', () => {
    const landscape = prepareDepthInput(image(3, 2), 28);
    expect([landscape.width, landscape.height]).toEqual([42, 28]);
    const portrait = prepareDepthInput(image(2, 3), 28);
    expect([portrait.width, portrait.height]).toEqual([28, 42]);
    expect([prepareDepthInput(image(5, 3), 28).width, prepareDepthInput(image(5, 3), 28).height]).toEqual([42, 28]);
  });
  it('defaults to 518 and keeps custom short edges at least the requested size', () => {
    expect(prepareDepthInput(image(1)).width).toBe(518);
    const output = prepareDepthInput(image(1), 15);
    expect([output.width, output.height]).toEqual([28, 28]);
  });
  it.each([[1, 2000], [100, 4000], [4000, 100]])('caps extreme %sx%s inputs at 1036 with bounded tensors', (width, height) => {
    // Check the small request first: the old default could allocate gigabytes.
    const small = prepareDepthInput(image(width, height), 14);
    expect(Math.max(small.width, small.height)).toBeLessThanOrEqual(1036);
    const result = prepareDepthInput(image(width, height));
    expect(Math.max(result.width, result.height)).toBe(1036);
    expect(result.width % 14).toBe(0);
    expect(result.height % 14).toBe(0);
    expect(Math.min(result.width, result.height)).toBeGreaterThanOrEqual(14);
    expect(result.tensor.byteLength).toBeLessThanOrEqual(1036 * 28 * 3 * 4);
    expect(result.tensor.every(Number.isFinite)).toBe(true);
  });
  it('rejects invalid sizes and buffer lengths', () => {
    expect(() => prepareDepthInput(image(1), NaN)).toThrow(RangeError);
    expect(() => prepareDepthInput({ ...image(1), width: 2 }, 14)).toThrow(RangeError);
  });
});

describe('depthToImage', () => {
  it('uses interpolated 2nd / 98th percentiles and clips extremes', () => {
    const raw = Float32Array.from({ length: 101 }, (_, i) => i);
    raw[0] = -10000;
    raw[100] = 10000;
    const result = depthToImage(raw, 101, 1, 101, 1);
    expect(result.data[0]).toBe(0);
    expect(result.data[2]).toBe(0);
    expect(result.data[50]).toBe(0.5);
    expect(result.data[98]).toBe(1);
    expect(result.data[100]).toBe(1);
    expect(raw[0]).toBe(-10000);
  });
  it('finds percentiles on raw model output before resizing', () => {
    const result = depthToImage(new Float32Array([0, 100]), 2, 1, 4, 1);
    expect(result.width).toBe(4);
    expect(Array.from(result.data)).toEqual([0, expect.closeTo((25 - 2) / 96, 6), expect.closeTo((75 - 2) / 96, 6), 1]);
  });
  it('converts non-finite values to zero before resizing / statistics', () => {
    expect(Array.from(depthToImage(new Float32Array([NaN, Infinity, -Infinity, 10]), 4, 1, 4, 1).data)).toEqual([0, 0, 0, 1]);
  });
  it.each([0, 7, -3])('returns a finite zero map for constant depth %s', value => {
    const result = depthToImage(new Float32Array([value]), 1, 1, 1, 2000);
    expect(result.data.every(sample => sample === 0)).toBe(true);
  });
  it('rejects invalid geometry / lengths', () => {
    expect(() => depthToImage(new Float32Array(1), 2, 1, 1, 1)).toThrow(RangeError);
    expect(() => depthToImage(new Float32Array(1), 1, 1, 0, 1)).toThrow(RangeError);
  });
});

describe('splitByDepth', () => {
  it('ignores a 0.3% isolated mode without losing the two real bands', () => {
    const values = Float32Array.from({ length: 10000 }, (_, i) => i < 4985 ? 0.1 : i < 5015 ? 0.4 : 0.8);
    const result = splitByDepth(image(10000), { width: 10000, height: 1, data: values }, { feather: 0 });
    expect(result).toHaveLength(2);
    for (let i = 5015; i < values.length; i++) expect(result[1].image.data[i * 4 + 3]).toBe(255);
  });
  it('does not treat clipped endpoint spikes in normalized single-mode output as objects', () => {
    const width = 10000;
    const raw = Float32Array.from({ length: width }, (_, i) => Math.sqrt(i / (width - 1)));
    const normalized = depthToImage(raw, width, 1, width, 1);
    const result = splitByDepth(image(width), normalized, { feather: 0 });
    expect(result).toHaveLength(3);
    const areas = result.slice(1).map(band => {
      let sum = 0;
      for (let i = 3; i < band.image.data.length; i += 4) sum += band.image.data[i] / 255;
      return sum / width;
    });
    expect(areas.every(area => area >= 0.1)).toBe(true);
    expect(1 - areas.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(0.1);
  });
  it('keeps a real valley after depth normalization has clipped both endpoints', () => {
    const raw = Float32Array.from({ length: 10000 }, (_, i) => i < 4000
      ? 0.1 + (i % 100) / 1000 : 0.7 + (i % 100) / 500);
    const normalized = depthToImage(raw, 10000, 1, 10000, 1);
    const result = splitByDepth(image(10000), normalized, { feather: 0 });
    expect(result).toHaveLength(2);
    for (let i = 0; i < 10000; i++) expect(result[1].image.data[i * 4 + 3]).toBe(i < 4000 ? 0 : 255);
  });
  it.each([false, true])('never fills black when the far band is narrow or transparent (%s)', transparent => {
    const input = image(1000), values = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      values[i] = i < 500 ? 0.1 : 0.115;
      input.data.set([40, 120, 200, transparent && i < 500 ? 0 : 180], i * 4);
    }
    const result = splitByDepth(input, { width: 1000, height: 1, data: values }, { bands: 2 });
    expect(result).toHaveLength(2);
    for (let i = 500; i < 1000; i++) expect(Array.from(result[0].image.data.subarray(i * 4, i * 4 + 4)))
      .toEqual([40, 120, 200, 180]);
  });
  it('excludes a contaminated foreground rim from background color support', () => {
    const input = image(64, 64), values = new Float32Array(4096);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = y * 64 + x;
      const near = x >= 16 && x < 48 && y >= 16 && y < 48;
      const rim = x >= 15 && x < 49 && y >= 15 && y < 49;
      values[i] = near ? 0.9 : 0.1;
      input.data.set(rim ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    }
    const result = splitByDepth(input, { width: 64, height: 64, data: values }, { bands: 2 });
    expect(Array.from(result[0].image.data.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 3)))
      .toEqual([0, 0, 255]);
  });
  it('keeps unequal, separated depth clusters whole instead of cutting the nearest object into thirds', () => {
    const input = image(2000);
    const values = Array.from({ length: 2000 }, (_, i) => i < 600
      ? 0.08 + (i % 100) / 1000 : i < 1000
        ? 0.35 + (i % 100) / 1000 : 0.7 + (i % 100) / 500);
    const result = splitByDepth(input, gray(values));
    expect(result).toHaveLength(3);
    for (let i = 0; i < values.length; i++) {
      expect(result[1].image.data[i * 4 + 3]).toBe(i >= 600 && i < 1000 ? 255 : 0);
      expect(result[2].image.data[i * 4 + 3]).toBe(i >= 1000 ? 255 : 0);
    }
  });
  it('uses only the available discontinuity when two objects are requested as three bands', () => {
    const values = Array.from({ length: 2000 }, (_, i) => i < 500
      ? 0.1 + (i % 100) / 1000 : 0.7 + (i % 100) / 500);
    const result = splitByDepth(image(2000), gray(values));
    expect(result).toHaveLength(2);
    for (let i = 500; i < values.length; i++) expect(result[1].image.data[i * 4 + 3]).toBe(255);
  });
  it('fills a large covered background using only far colors, preserving source alpha and foreground RGB', () => {
    const input = image(64, 64);
    const values = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = y * 64 + x;
      const near = x >= 16 && x < 48 && y >= 16 && y < 48;
      const middle = !near && x >= 8 && x < 56 && y >= 8 && y < 56;
      input.data.set(near ? [255, 0, 0, 255] : middle ? [0, 255, 0, 255] : [0, 0, 255, 255], i * 4);
      values[i] = near ? 0.9 : middle ? 0.5 : 0.1;
    }
    // Hidden RGB must never supply fill colors; partial source alpha is retained.
    input.data.set([255, 255, 0, 0], 0);
    input.data[(32 * 64 + 32) * 4 + 3] = 127;
    const before = input.data.slice();
    const result = splitByDepth(input, { width: 64, height: 64, data: values });
    expect(result).toHaveLength(3);
    for (let i = 1; i < values.length; i++) {
      expect(Array.from(result[0].image.data.subarray(i * 4, i * 4 + 3))).toEqual([0, 0, 255]);
      expect(result[0].image.data[i * 4 + 3]).toBe(input.data[i * 4 + 3]);
      expect(result[1].image.data[i * 4 + 3] + result[2].image.data[i * 4 + 3])
        .toBe(values[i] > 0.3 ? input.data[i * 4 + 3] : 0);
    }
    expect(Array.from(result[2].image.data.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)))
      .toEqual([255, 0, 0, 127]);
    expect(input.data).toEqual(before);
    expect(values[32 * 64 + 32]).toBeCloseTo(0.9);
  });
  it('falls back to area quantiles for a continuous depth ramp without valleys', () => {
    const values = Array.from({ length: 3000 }, (_, i) => i / 2999);
    const result = splitByDepth(image(3000), gray(values), { feather: 0 });
    expect(result).toHaveLength(3);
    for (let i = 0; i < values.length; i++) {
      expect(result[1].image.data[i * 4 + 3]).toBe(i >= 1000 && i < 2000 ? 255 : 0);
      expect(result[2].image.data[i * 4 + 3]).toBe(i >= 2000 ? 255 : 0);
    }
  });
  it('creates quantile bands in increasing depth, keeping a full opaque background', () => {
    const input = image(6);
    const before = input.data.slice();
    const result = splitByDepth(input, gray([0, 0.2, 0.4, 0.6, 0.8, 1]), { feather: 0 });
    expect(result.map(band => band.depth)).toEqual([0, 50, 100]);
    expect(Array.from(result[0].image.data).filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255, 255, 255]);
    expect(Array.from(result[1].image.data).filter((_, i) => i % 4 === 3)).toEqual([0, 0, 255, 255, 0, 0]);
    expect(Array.from(result[2].image.data).filter((_, i) => i % 4 === 3)).toEqual([0, 0, 0, 0, 255, 255]);
    expect(result[1].image.data[8]).toBe(255);
    expect(input.data).toEqual(before);
    expect(result[0].image.data).not.toBe(input.data);
  });
  it('uses area quantiles rather than equal depth-value intervals', () => {
    const result = splitByDepth(image(6), gray([0, 0.01, 0.02, 0.03, 0.9, 1]), { feather: 0 });
    expect(Array.from(result[1].image.data).filter((_, i) => i % 4 === 3)).toEqual([0, 0, 255, 255, 0, 0]);
  });
  it('softens a boundary symmetrically and uses the default feather width', () => {
    const values = [0, 0.48, 0.52, 1];
    const result = splitByDepth(image(4), gray(values), { bands: 2, feather: 0.1 });
    expect(result[1].image.data[7]).toBeGreaterThan(0);
    expect(result[1].image.data[7]).toBeLessThan(128);
    expect(result[1].image.data[7] + result[1].image.data[11]).toBe(255);
    const defaults = splitByDepth(image(4), gray(values), { bands: 2 });
    expect(defaults[1].image.data[7]).toBeGreaterThan(0);
    expect(defaults[1].image.data[7]).toBeLessThan(result[1].image.data[7]);
  });
  it.each([2, 3, 4])('supports %s bands', bands => {
    const values = Array.from({ length: 12 }, (_, i) => i / 11);
    const result = splitByDepth(image(12), gray(values), { bands, feather: 0 });
    expect(result).toHaveLength(bands);
    expect(result[0].depth).toBe(0);
    expect(result.at(-1)!.depth).toBe(100);
    for (let i = 1; i < result.length; i++) expect(result[i].depth).toBeGreaterThan(result[i - 1].depth);
  });
  it('merges small bands backwards, retaining the exact 8% limit', () => {
    for (const [count, expectedBands] of [[79, 1], [80, 2]]) {
      const values = new Array<number>(1000).fill(0);
      values.fill(1, 1000 - count);
      expect(splitByDepth(image(1000), gray(values), { bands: 3, feather: 0 })).toHaveLength(expectedBands);
    }
  });
  it('merges a small nearest band into the preceding foreground band', () => {
    const values = new Array<number>(1000).fill(0);
    values.fill(0.5, 600, 999);
    values[999] = 1;
    const result = splitByDepth(image(1000), gray(values), { bands: 3, feather: 0 });
    expect(result).toHaveLength(2);
    expect(result[1].image.data[999 * 4 + 3]).toBe(255);
  });
  it('does not spread a boundary plateau across unrelated bands', () => {
    const result = splitByDepth(image(6), gray([0, 0, 0, 0, 1, 1]));
    expect(result).toHaveLength(2);
    expect(result[1].image.data[3]).toBe(0);
    expect(result[1].image.data[5 * 4 + 3]).toBe(255);
  });
  it('keeps tied depths together even when a surviving quantile equals a plateau', () => {
    const result = splitByDepth(image(6), gray([0, 0, 0, 0, 0, 1]));
    expect(result).toHaveLength(2);
    expect(Array.from(result[1].image.data).filter((_, i) => i % 4 === 3))
      .toEqual([0, 0, 0, 0, 0, 255]);
  });
  it('merges a small far foreground band into the background', () => {
    const values = new Array<number>(1000).fill(0);
    values.fill(0.5, 665, 669);
    values.fill(1, 669);
    const result = splitByDepth(image(1000), gray(values), { feather: 0 });
    expect(result).toHaveLength(2);
    expect(result[1].image.data[668 * 4 + 3]).toBe(0);
    expect(result[1].image.data[669 * 4 + 3]).toBe(255);
  });
  it.each([0, 0.5, 1, NaN, Infinity])('returns only the background for uniform depth %s', value => {
    const result = splitByDepth(image(1), gray([value]));
    expect(result).toHaveLength(1);
    expect(Array.from(result[0].image.data)).toEqual([255, 128, 0, 255]);
  });
  it('sanitizes non-finite depth and handles long thin maps', () => {
    const values = Array.from({ length: 2000 }, (_, i) => i / 1999);
    values[0] = NaN; values[1] = Infinity;
    const result = splitByDepth(image(1, 2000), { width: 1, height: 2000, data: Float32Array.from(values) });
    expect(result).toHaveLength(3);
    expect(result.every(band => band.image.width === 1 && band.image.height === 2000)).toBe(true);
  });
  it('rejects mismatching maps and invalid options', () => {
    expect(() => splitByDepth(image(1), gray([0, 1]))).toThrow(RangeError);
    for (const bands of [1, 5, 2.5, NaN]) expect(() => splitByDepth(image(1), gray([0]), { bands })).toThrow(RangeError);
    for (const feather of [-1, NaN, Infinity]) expect(() => splitByDepth(image(1), gray([0]), { feather })).toThrow(RangeError);
  });
});
