import { describe, expect, it } from 'vitest';
import { boxBlur, depthBoundaries, fillBackground, insetBackground, quantiles, removeSmallComponents, resizeBilinear, unitQuantiles } from '../../src/ai/image-ops';

describe('resizeBilinear', () => {
  it('uses pixel centers and clamps the outer samples', () => {
    expect(Array.from(resizeBilinear(new Float32Array([0, 1]), 2, 1, 4, 1))).toEqual([0, 0.25, 0.75, 1]);
    expect(Array.from(resizeBilinear(new Float32Array([0, 1, 2, 3]), 2, 2, 1, 1))).toEqual([1.5]);
  });
  it('keeps interleaved channels separate', () => {
    expect(Array.from(resizeBilinear(new Uint8ClampedArray([10, 100, 30, 200]), 2, 1, 1, 1, 2)))
      .toEqual([20, 150]);
  });
  it('handles one pixel, long thin images and non-finite samples without changing the input', () => {
    expect(Array.from(resizeBilinear(new Float32Array([0.5]), 1, 1, 2, 2))).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(resizeBilinear(new Float32Array(2000).fill(0.25), 1, 2000, 1, 1)[0]).toBe(0.25);
    const input = new Float32Array([NaN, Infinity, -Infinity, 4]);
    expect(Array.from(resizeBilinear(input, 2, 2, 1, 1))).toEqual([1]);
    expect(Number.isNaN(input[0])).toBe(true);
  });
  it('rejects invalid geometry and buffer lengths', () => {
    expect(() => resizeBilinear(new Float32Array(1), 0, 1, 1, 1)).toThrow(RangeError);
    expect(() => resizeBilinear(new Float32Array(1), 2, 1, 1, 1)).toThrow(RangeError);
    expect(() => resizeBilinear(new Float32Array(1), 1, 1, 0.5, 1)).toThrow(RangeError);
    expect(() => resizeBilinear(new Float32Array(1), 1, 1, 1, 1, 0)).toThrow(RangeError);
  });
});

describe('boxBlur', () => {
  it('matches a slow reference with replicated image borders', () => {
    const width = 4, height = 3, radius = 2;
    const input = Float32Array.from({ length: width * height }, (_, i) => i / 12);
    const actual = boxBlur(input, width, height, radius);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const sx = Math.max(0, Math.min(width - 1, x + dx));
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        sum += input[sy * width + sx];
      }
      expect(actual[y * width + x]).toBeCloseTo(sum / 25, 6);
    }
  });
  it.each([0, 1])('preserves a uniform mask (%s), even when the radius exceeds the image', value => {
    expect(Array.from(boxBlur(new Float32Array(2000).fill(value), 1, 2000, 3000)))
      .toEqual(Array(2000).fill(value));
    expect(boxBlur(new Float32Array([value]), 1, 1, 10)[0]).toBe(value);
  });
  it('returns a fresh buffer at radius zero and sanitizes non-finite values', () => {
    const input = new Float32Array([NaN, Infinity, 1]);
    expect(Array.from(boxBlur(input, 3, 1, 0))).toEqual([0, 0, 1]);
    expect(boxBlur(input, 3, 1, 0)).not.toBe(input);
  });
  it('rejects negative or non-finite radii', () => {
    for (const radius of [-1, NaN, Infinity]) expect(() => boxBlur(new Float32Array(1), 1, 1, radius)).toThrow(RangeError);
  });
});

describe('quantiles', () => {
  it('interpolates sorted ranks, leaving the original data unchanged', () => {
    const input = new Float32Array([30, 0, 20, 10]);
    expect(quantiles(input, [0, 0.25, 0.5, 1])).toEqual([0, 7.5, 15, 30]);
    expect(Array.from(input)).toEqual([30, 0, 20, 10]);
  });
  it('treats non-finite values as zero and supports constant / one-pixel input', () => {
    expect(quantiles(new Float32Array([NaN, Infinity, -Infinity, 4]), [0, 1])).toEqual([0, 4]);
    expect(quantiles(new Float32Array([7]), [0.02, 0.98])).toEqual([7, 7]);
  });
  it('rejects empty samples and invalid fractions', () => {
    expect(() => quantiles(new Float32Array(), [0.5])).toThrow(RangeError);
    for (const fraction of [-1, 2, NaN]) expect(() => quantiles(new Float32Array([1]), [fraction])).toThrow(RangeError);
  });
});

describe('unitQuantiles', () => {
  it('approximates sorted ranks within one bin, without changing input (seed 702)', () => {
    let seed = 702;
    const input = Float32Array.from({ length: 10000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    });
    const before = input.slice();
    const fractions = [0, 0.02, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.98, 1];
    const reference = quantiles(input, fractions);
    const actual = unitQuantiles(input, fractions);
    for (let i = 0; i < actual.length; i++) expect(Math.abs(actual[i] - reference[i])).toBeLessThanOrEqual(1 / 4095);
    expect(input).toEqual(before);
  });
  it('preserves exact plateaus even within one bin, and sanitizes unit depth', () => {
    expect(unitQuantiles(new Float32Array([0.5, 0.5, 0.5, 0.5]), [0, 0.5, 1])).toEqual([0.5, 0.5, 0.5]);
    expect(unitQuantiles(new Float32Array([NaN, Infinity, -1, 2]), [0, 1])).toEqual([0, 1]);
    expect(unitQuantiles(new Float32Array([0.5]), [0.02, 0.98])).toEqual([0.5, 0.5]);
  });
  it('rejects empty data and invalid fractions', () => {
    expect(() => unitQuantiles(new Float32Array(), [0.5])).toThrow(RangeError);
    for (const fraction of [-1, 2, NaN]) expect(() => unitQuantiles(new Float32Array([1]), [fraction])).toThrow(RangeError);
  });
});

describe('removeSmallComponents', () => {
  it('removes only components strictly smaller than the area limit', () => {
    const input = new Float32Array([1, 0, 0, 0, 1, 1, 0, 0]);
    expect(Array.from(removeSmallComponents(input, 8, 1, 2))).toEqual([0, 0, 0, 0, 1, 1, 0, 0]);
    expect(input[0]).toBe(1);
  });
  it('keeps diagonally connected details (eight neighbors)', () => {
    expect(Array.from(removeSmallComponents(new Float32Array([0.5, 0, 0, 1]), 2, 2, 2)))
      .toEqual([0.5, 0, 0, 1]);
  });
  it('does not connect the end of a row to the start of the next row', () => {
    expect(Array.from(removeSmallComponents(new Float32Array([0, 0, 1, 1, 0, 0]), 3, 2, 2)))
      .toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('handles a large component iteratively', () => {
    const output = removeSmallComponents(new Float32Array(256 * 256).fill(1), 256, 256, 2);
    expect(output.every(value => value === 1)).toBe(true);
  });
  it('sanitizes non-finite samples and rejects invalid component limits / geometry', () => {
    expect(Array.from(removeSmallComponents(new Float32Array([NaN, Infinity, 1]), 3, 1, 1)))
      .toEqual([0, 0, 1]);
    for (const area of [-1, NaN, Infinity]) {
      expect(() => removeSmallComponents(new Float32Array(1), 1, 1, area)).toThrow(RangeError);
    }
    expect(() => removeSmallComponents(new Float32Array(1), 2, 1, 1)).toThrow(RangeError);
  });
});

describe('depthBoundaries', () => {
  it('finds a low-density valley even when there is no completely empty gap', () => {
    const data = Float32Array.from({ length: 10200 }, (_, i) => i < 5000
      ? 0.1 + (i % 100) / 1000 : i < 10000
        ? 0.7 + (i % 100) / 1000 : 0.2 + (i - 10000) / 400);
    const boundaries = depthBoundaries(data, 3);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toBeGreaterThan(0.25);
    expect(boundaries[0]).toBeLessThan(0.65);
  });
  it('finds all three valleys between four unequal modes', () => {
    const data = Float32Array.from({ length: 4000 }, (_, i) => i < 400 ? 0.05
      : i < 1200 ? 0.3 : i < 2400 ? 0.6 : 0.95);
    const boundaries = depthBoundaries(data, 4);
    expect(boundaries).toHaveLength(3);
    for (const [i, [low, high]] of [[0.05, 0.3], [0.3, 0.6], [0.6, 0.95]].entries()) {
      expect(boundaries[i]).toBeGreaterThan(low);
      expect(boundaries[i]).toBeLessThan(high);
    }
  });
  it('uses identical quantiles for a dense ramp and sanitizes non-finite input', () => {
    const data = Float32Array.from({ length: 8192 }, (_, i) => i / 8191);
    expect(depthBoundaries(data, 3)).toEqual(unitQuantiles(data, [1 / 3, 2 / 3]));
    expect(depthBoundaries(new Float32Array([NaN, Infinity, -1, 2]), 2)).toEqual([0]);
  });
  it('rejects empty input and invalid band counts', () => {
    expect(() => depthBoundaries(new Float32Array(), 3)).toThrow(RangeError);
    for (const bands of [1, 5, 2.5, NaN]) expect(() => depthBoundaries(new Float32Array([0]), bands)).toThrow(RangeError);
  });
});

describe('insetBackground', () => {
  it.each([[1, 1], [2, 7], [3, 2], [4, 5], [97, 65]])('matches the full five-by-five minimum at %sx%s, including edges and zero support', (width, height) => {
    const support = Uint8Array.from({ length: width * height }, (_, i) => i % 23 < 3 ? 0 : (i * 79 + 21) % 256);
    const before = support.slice();
    const reference = new Uint8Array(support.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let minimum = 255;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const sx = Math.max(0, Math.min(width - 1, x + dx));
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        minimum = Math.min(minimum, support[sy * width + sx]);
      }
      reference[y * width + x] = minimum;
    }
    expect(insetBackground(support, width, height)).toEqual(reference);
    expect(support).toEqual(before);
  });
});

describe('fillBackground', () => {
  it.each([[7, 5], [1, 2001], [2001, 1]])('fills odd and thin %sx%s images without covered or transparent color leakage', (width, height) => {
    const data = new Uint8ClampedArray(width * height * 4);
    const known = new Uint8Array(width * height);
    for (let i = 0; i < known.length; i++) data.set([255, 0, 0, 127], i * 4);
    data.set([255, 255, 0, 0], 0);
    data.set([0, 0, 255, 64], 4);
    known[1] = 64;
    const before = data.slice(), beforeKnown = known.slice();
    fillBackground(data, width, height, known);
    expect(data.subarray(4, 8)).toEqual(before.subarray(4, 8));
    for (let i = 2; i < known.length; i++) expect(Array.from(data.subarray(i * 4, i * 4 + 4))).toEqual([0, 0, 255, 127]);
    expect(data[3]).toBe(0);
    expect(known).toEqual(beforeKnown);
  });
  it('weights translucent background colors by alpha while keeping their original pixels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 64, 0, 0, 255, 192, 0, 255, 0, 255, 0, 255, 0, 255]);
    fillBackground(data, 2, 2, new Uint8Array([64, 192, 0, 0]));
    expect(Array.from(data.subarray(0, 8))).toEqual([255, 0, 0, 64, 0, 0, 255, 192]);
    expect(Array.from(data.subarray(8))).toEqual([64, 0, 191, 255, 64, 0, 191, 255]);
  });
  it('uses visible alpha-weighted RGB without background support, leaving alpha intact', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 127]);
    fillBackground(data, 1, 1, new Uint8Array(1));
    expect(Array.from(data)).toEqual([255, 0, 0, 127]);
  });
  it('ignores hidden RGB in the average when all known weights are zero', () => {
    const data = new Uint8ClampedArray([240, 0, 0, 64, 0, 0, 240, 192, 0, 255, 0, 0]);
    fillBackground(data, 3, 1, new Uint8Array(3));
    expect(Array.from(data.subarray(0, 8))).toEqual([60, 0, 180, 64, 60, 0, 180, 192]);
    expect(Array.from(data.subarray(8))).toEqual([0, 255, 0, 0]);
  });
  it('fills a gradient hole with continuous colors while preserving known pixels', () => {
    const width = 96, height = 64;
    const data = new Uint8ClampedArray(width * height * 4), known = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const hole = x >= 40 && x < 56;
      data.set(hole ? [255, 0, 0, 180] : [40 + x, 80 + y, 120, 180], offset);
      known[y * width + x] = hole ? 0 : 180;
    }
    const before = data.slice();
    fillBackground(data, width, height, known);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (known[y * width + x]) expect(data.subarray(offset, offset + 4)).toEqual(before.subarray(offset, offset + 4));
      else {
        expect(data[offset + 2]).toBe(120);
        expect(Math.abs(data[offset] - (40 + x))).toBeLessThanOrEqual(12);
        expect(data[offset + 3]).toBe(180);
      }
      if (x > 0) expect(Math.abs(data[offset] - data[offset - 4])).toBeLessThanOrEqual(12);
    }
  });
  it('rejects mismatching buffers', () => {
    expect(() => fillBackground(new Uint8ClampedArray(4), 2, 1, new Uint8Array(2))).toThrow(RangeError);
    expect(() => fillBackground(new Uint8ClampedArray(4), 1, 1, new Uint8Array(2))).toThrow(RangeError);
  });
});
