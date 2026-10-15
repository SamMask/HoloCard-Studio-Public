import { describe, expect, it } from 'vitest';
import { depthToImage, prepareDepthInput, splitByDepth } from '../../src/ai/depth';
import { resizeBilinear } from '../../src/ai/image-ops';
import { matteToAlpha, prepareMatteInput, refineAlpha } from '../../src/ai/matte';
import type { RgbaImage } from '../../src/ai/types';

function asymmetric(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set([10 + x * 3 + y * 7, 30 + x * 5 + y * 2, 90 + x + y * 4, (x * 31 + y * 53) % 256], (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('T-702b regressions', () => {
  it('keeps two-pixel line tips at least half opaque with feather 4', () => {
    const width = 20, height = 20;
    const data = new Float32Array(width * height);
    for (let y = 3; y < 17; y++) data[y * width + 9] = data[y * width + 10] = 0.8;
    const output = refineAlpha({ width, height, data }, { feather: 4, clip: 0 });
    for (let i = 0; i < data.length; i++) expect(output.data[i]).toBeGreaterThanOrEqual(data[i] * 0.5);
  });

  it('leaves the one-pixel border outside a square fully transparent', () => {
    const width = 20, height = 20;
    const data = new Float32Array(width * height);
    for (let y = 5; y < 15; y++) data.fill(1, y * width + 5, y * width + 15);
    const output = refineAlpha({ width, height, data }, { feather: 4 });
    for (let i = 0; i < data.length; i++) if (data[i] === 0) expect(output.data[i]).toBe(0);
    expect(output.data[5 * width + 5]).toBeGreaterThanOrEqual(0.5);
    expect(output.data[5 * width + 5]).toBeLessThan(1);
  });

  it.each([[8, 8, 2, 2], [9, 7, 3, 2], [8, 1, 2, 1], [1, 8, 1, 2]])(
    'preserves off-center thin lines when shrinking %sx%s to %sx%s', (width, height, outWidth, outHeight) => {
      const data = new Float32Array(width * height);
      if (width > 1) for (let y = 0; y < height; y++) data[y * width] = 1;
      else data[0] = 1;
      const result = resizeBilinear(data, width, height, outWidth, outHeight);
      expect(result.some(value => value > 0)).toBe(true);
      if (width === 8) expect(result[0]).toBeCloseTo(0.25, 6);
    },
  );

  it('places asymmetric RGB at tensor[c*plane+y*W+x] for both models', () => {
    const input = asymmetric(14, 14);
    const matte = prepareMatteInput(input, 14);
    const depth = prepareDepthInput(input, 14);
    const means = [0.485, 0.456, 0.406], stds = [0.229, 0.224, 0.225];
    for (let c = 0; c < 3; c++) for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
      const value = input.data[(y * 14 + x) * 4 + c] / 255;
      expect(matte.tensor[c * 196 + y * 14 + x]).toBeCloseTo(value, 6);
      expect(depth.tensor[c * 196 + y * 14 + x]).toBeCloseTo((value - means[c]) / stds[c], 6);
    }
  });

  it.each([[5, 3, 5], [3, 5, 5], [7, 2, 7], [2, 7, 7], [1, 1, 3], [4, 7, 9]])(
    'round-trips asymmetric matte %sx%s through size %s including odd padding', (width, height, size) => {
      const input = asymmetric(width, height);
      const { tensor, box } = prepareMatteInput(input, size);
      const result = matteToAlpha({ width: size, height: size, data: tensor.slice(0, size * size) }, box);
      expect([result.width, result.height]).toEqual([width, height]);
      for (let i = 0; i < result.data.length; i++) {
        expect(result.data[i]).toBeCloseTo(input.data[i * 4] / 255, Math.max(width, height) === size ? 6 : 2);
      }
      expect(result.data[0]).toBeLessThanOrEqual(result.data.at(-1)!);
    },
  );

  it.each([[28, 14], [14, 28], [35, 21], [21, 35]])('round-trips depth geometry for %sx%s', (width, height) => {
    const input = asymmetric(width, height);
    const prepared = prepareDepthInput(input, 14);
    // Use the prepared red plane as a simulated model output; undo ImageNet
    // normalization so both preprocessing and postprocessing take part.
    const raw = prepared.tensor.slice(0, prepared.width * prepared.height);
    for (let i = 0; i < raw.length; i++) raw[i] = raw[i] * 0.229 + 0.485;
    const output = depthToImage(raw, prepared.width, prepared.height, width, height);
    expect([output.width, output.height, output.data.length]).toEqual([width, height, width * height]);
    expect(output.data[width - 1]).toBeLessThan(output.data[(height - 1) * width]);
    expect(output.data.every(value => value >= 0 && value <= 1)).toBe(true);
  });

  it('retains source alpha and gives four bands integer, strictly increasing depths', () => {
    const input = asymmetric(12, 1);
    const result = splitByDepth(input, { width: 12, height: 1, data: Float32Array.from({ length: 12 }, (_, i) => i / 11) }, { bands: 4, feather: 0 });
    expect(result).toHaveLength(4);
    // T-704b fills covered RGB; the background still retains every source alpha.
    for (let i = 0; i < 12; i++) expect(result[0].image.data[i * 4 + 3]).toBe(input.data[i * 4 + 3]);
    expect(result[0].image.data.subarray(0, 12)).toEqual(input.data.subarray(0, 12));
    for (let band = 1; band < result.length; band++) {
      expect(Number.isInteger(result[band].depth)).toBe(true);
      expect(result[band].depth).toBeGreaterThan(result[band - 1].depth);
      for (let i = 0; i < 12; i++) expect(result[band].image.data[i * 4 + 3]).toBeLessThanOrEqual(input.data[i * 4 + 3]);
    }
  });

  it.each([3, 4])('does not dilute concentrated middle plateaus with %s soft bands', bands => {
    const input = { width: bands * 100, height: 1, data: new Uint8ClampedArray(bands * 400).fill(255) };
    const data = Float32Array.from({ length: input.width }, (_, i) => 0.5 + Math.floor(i / 100) * 0.001);
    const result = splitByDepth(input, { width: input.width, height: 1, data }, { bands, feather: 0.06 });
    expect(result).toHaveLength(bands);
    for (let band = 1; band < bands; band++) expect(result[band].image.data[(band * 100 + 50) * 4 + 3]).toBe(255);
  });

  it.each([3, 4])('has no composite holes and bounded foreground alpha for %s soft bands (seed 702)', bands => {
    let seed = 702;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (const feather of [0.001, 0.06, 0.8]) {
      const input = asymmetric(32, 24);
      const data = Float32Array.from({ length: 32 * 24 }, () => random());
      for (let i = 0; i < data.length; i++) input.data[i * 4 + 3] = Math.floor(random() * 256);
      const result = splitByDepth(input, { width: 32, height: 24, data }, { bands, feather });
      expect(result).toHaveLength(bands);
      for (let i = 0; i < data.length; i++) {
        const original = input.data[i * 4 + 3];
        let foregroundSum = 0, composite = result[0].image.data[i * 4 + 3] / 255;
        expect(composite * 255).toBeCloseTo(original, 8);
        for (const band of result.slice(1)) {
          const alpha = band.image.data[i * 4 + 3];
          foregroundSum += alpha;
          composite = alpha / 255 + composite * (1 - alpha / 255);
        }
        expect(foregroundSum).toBeLessThanOrEqual(original);
        expect(composite * 255 + 1e-8).toBeGreaterThanOrEqual(original);
        expect(composite).toBeLessThanOrEqual(1);
      }
    }
  });

  it('processes 12.6 Mpx depth and three bands within the 3x timing allowance', () => {
    const width = 4096, height = 3072;
    const input = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
    let seed = 702;
    const raw = Float32Array.from({ length: 518 * 392 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    });
    const start = performance.now();
    const depth = depthToImage(raw, 518, 392, width, height);
    const middle = performance.now();
    const result = splitByDepth(input, depth, { bands: 3 });
    const end = performance.now();
    console.log(`12.6 Mpx: depthToImage=${(middle - start).toFixed(1)} ms, splitByDepth=${(end - middle).toFixed(1)} ms, total=${(end - start).toFixed(1)} ms (target 2000 ms; test allowance 6000 ms)`);
    expect(result).toHaveLength(3);
    expect(end - start).toBeLessThan(6000);
  }, 60000);
});
