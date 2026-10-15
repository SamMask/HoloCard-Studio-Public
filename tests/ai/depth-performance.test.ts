import { expect, it } from 'vitest';
import { depthToImage, splitByDepth } from '../../src/ai/depth';
import { readFixture } from './real-fixtures';

it('normalizes and splits 12.6 Mpx within the 3x timing tolerance', () => {
  const { depth: raw } = readFixture(2);
  const width = 4096, height = 3072;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919) & 255;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const start = performance.now();
  const depth = depthToImage(raw.data, raw.width, raw.height, width, height);
  const bands = splitByDepth({ width, height, data }, depth, { bands: 3 });
  const ms = performance.now() - start;
  process.stdout.write(`12.6 Mpx depthToImage + splitByDepth: ${ms.toFixed(1)} ms (${bands.length} bands)\n`);
  expect(bands).toHaveLength(2);
  // Product target: 2000 ms. Allow contention here; audit reports five-run timings.
  expect(ms).toBeLessThanOrEqual(2000 * 3);
}, 15_000);
