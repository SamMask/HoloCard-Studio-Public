import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { DepthBand, GrayImage, RgbaImage } from '../../src/ai/types';

interface FixtureMetadata {
  width: number;
  height: number;
  lossless?: boolean;
  baseline: { ghost: { ghostTotalFraction: number } };
}

export function readFixture(card: number, directory = new URL('./fixtures/', import.meta.url), scale = 1) {
  const metadata = JSON.parse(readFileSync(new URL(`card${card}.json`, directory), 'utf8')) as FixtureMetadata;
  const { width, height } = metadata;
  const count = width * height;
  const bytes = inflateSync(readFileSync(new URL(`card${card}.bin.z`, directory)));
  const lossless = metadata.lossless === true;
  if (bytes.length !== count * (lossless ? 7 : 6)) throw new Error('Unexpected fixture size');
  if (!lossless) {
    let start = 0;
    for (const stride of [2, 1, 2, 1]) {
      for (let i = 0; i < count * stride; i++) {
        if (i % (width * stride) >= stride) bytes[start + i] = (bytes[start + i] + bytes[start + i - stride]) & 255;
      }
      start += count * stride;
    }
  }
  const rgba = new Uint8ClampedArray(count * 4);
  const depth = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (lossless) rgba.set(bytes.subarray(i * 4, i * 4 + 4), i * 4);
    else {
      const color = bytes.readUInt16LE(i * 2);
      rgba[i * 4] = Math.round((color >>> 11) * 255 / 31);
      rgba[i * 4 + 1] = Math.round(((color >>> 5) & 63) * 255 / 63);
      rgba[i * 4 + 2] = Math.round((color & 31) * 255 / 31);
      rgba[i * 4 + 3] = bytes[count * 2 + i];
    }
    depth[i] = bytes.readUInt16LE(count * (lossless ? 4 : 3) + i * 2) / 65535;
  }
  const mask = bytes.subarray(count * (lossless ? 6 : 5));
  if (scale > 1) {
    const outWidth = width * scale, outHeight = height * scale;
    const output = new Uint8ClampedArray(outWidth * outHeight * 4);
    const outDepth = new Float32Array(outWidth * outHeight), outMask = new Uint8Array(outWidth * outHeight);
    for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
      const source = Math.floor(y / scale) * width + Math.floor(x / scale), target = y * outWidth + x;
      output.set(rgba.subarray(source * 4, source * 4 + 4), target * 4);
      outDepth[target] = depth[source]; outMask[target] = mask[source];
    }
    return { image: { width: outWidth, height: outHeight, data: output },
      depth: { width: outWidth, height: outHeight, data: outDepth }, mask: outMask, metadata };
  }
  return {
    image: { width, height, data: rgba } satisfies RgbaImage,
    depth: { width, height, data: depth } satisfies GrayImage,
    mask, metadata,
  };
}

/** Same alpha membership and max-channel difference <=16 proxy as the local audit. */
export function measureSplit(image: RgbaImage, mask: Uint8Array, bands: DepthBand[]) {
  const area = new Array<number>(bands.length).fill(0);
  const hero = area.slice();
  let heroCount = 0, ghosts = 0;
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    let foreground = 0;
    for (let band = 1; band < bands.length; band++) {
      const membership = bands[band].image.data[offset + 3] / 255;
      area[band] += membership;
      if (mask[i]) hero[band] += membership;
      foreground += membership;
    }
    const far = Math.max(0, image.data[offset + 3] / 255 - foreground);
    area[0] += far;
    if (!mask[i]) continue;
    heroCount++;
    hero[0] += far;
    let difference = 0;
    for (let c = 0; c < 3; c++) difference = Math.max(difference,
      Math.abs(bands[0].image.data[offset + c] - image.data[offset + c]));
    if (far > 0.5 || difference <= 16) ghosts++;
  }
  return {
    count: bands.length,
    area: area.map(value => value / mask.length),
    hero: hero.map(value => value / heroCount),
    nearPurity: hero.at(-1)! / area.at(-1)!,
    ghost: ghosts / heroCount,
  };
}
