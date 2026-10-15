import { describe, expect, it } from 'vitest';
import { statSync } from 'node:fs';
import { splitByDepth } from '../../src/ai/depth';
import { measureSplit, readFixture } from './real-fixtures';

describe('real WebGPU depth regressions', () => {
  it.each([1, 2, 3, 4])('keeps useful bands and limits subject ghosts for card %s', card => {
    const fixtureSize = ['bin.z', 'json'].reduce((sum, extension) =>
      sum + statSync(new URL(`./fixtures/card${card}.${extension}`, import.meta.url)).size, 0);
    expect(fixtureSize).toBeLessThanOrEqual(300_000);
    const { image, depth, mask, metadata } = readFixture(card);
    const bands = splitByDepth(image, depth);
    const metrics = measureSplit(image, mask, bands);
    console.info(`card${card}`, JSON.stringify(metrics));
    expect(metrics.count).toBeGreaterThanOrEqual(2);
    expect(metrics.count).toBeLessThanOrEqual(3);
    expect(metrics.area.at(-1)).toBeGreaterThanOrEqual(0.08);
    expect(metrics.hero.slice(1).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(0.9);
    // Keep the two-pixel inset at the original audit's spatial scale. Expanding
    // stored samples adds no detail, but avoids turning it into an eight-pixel
    // inset when comparing the color-based ghost proxy to the original audit.
    const native = readFixture(card, undefined, 4);
    const nativeMetrics = measureSplit(native.image, native.mask, splitByDepth(native.image, native.depth));
    expect(nativeMetrics.ghost).toBeLessThanOrEqual(metadata.baseline.ghost.ghostTotalFraction);
    if (card === 1) {
      expect(metrics.hero.at(-1)).toBeGreaterThanOrEqual(0.9);
      expect(metrics.nearPurity).toBeGreaterThanOrEqual(0.85);
    }
    if (card === 4) {
      let lowerHero = 0, lowerNear = 0;
      for (let i = Math.floor(mask.length * 0.75); i < mask.length; i++) if (mask[i]) {
        lowerHero++;
        lowerNear += bands.at(-1)!.image.data[i * 4 + 3] / 255;
      }
      expect(lowerHero).toBeGreaterThan(0);
      expect(lowerNear / lowerHero).toBeGreaterThanOrEqual(0.9);
    }
    for (let band = 1; band < bands.length; band++) {
      expect(Number.isInteger(bands[band].depth)).toBe(true);
      expect(bands[band].depth).toBeGreaterThan(bands[band - 1].depth);
    }
    let changedAlpha = 0, overflowAlpha = 0;
    for (let i = 0; i < mask.length; i++) {
      const offset = i * 4 + 3;
      if (bands[0].image.data[offset] !== image.data[offset]) changedAlpha++;
      const sum = bands.slice(1).reduce((a, band) => a + band.image.data[offset], 0);
      if (sum > image.data[offset]) overflowAlpha++;
    }
    expect(changedAlpha).toBe(0);
    expect(overflowAlpha).toBe(0);
  });
});
