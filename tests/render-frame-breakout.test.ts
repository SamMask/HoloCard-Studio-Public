import { describe, expect, it } from 'vitest';
import { BLEND_MODES } from '../src/model/types';
import { compositeColor, linearToSrgb, srgbToLinear } from '../src/render/blend';
import type { Rgb } from '../src/render/frame';
import { compositeFrameBreakout } from '../src/render/frame-breakout';

const linear = (c: Rgb): Rgb => ({ r: srgbToLinear(c.r), g: srgbToLinear(c.g), b: srgbToLinear(c.b) });
const srgb = (c: Rgb): Rgb => ({ r: linearToSrgb(c.r), g: linearToSrgb(c.g), b: linearToSrgb(c.b) });
const mix = (a: Rgb, b: Rgb, c: number): Rgb => ({ r: a.r + (b.r - a.r) * c, g: a.g + (b.g - a.g) * c, b: a.b + (b.b - a.b) * c });
const close = (actual: Rgb, expected: Rgb) => {
  for (const channel of ['r', 'g', 'b'] as const) expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(1e-6);
};
const F = linear({ r: 0.8, g: 0.6, b: 0.1 });
const B = { r: 0.9, g: 0.15, b: 0.7 };
const covers = Array.from({ length: 101 }, (_, i) => i / 100);

describe('T-411d 卡框邊上的破框合成', () => {
  it('不透明 normal 破框層：c 從 0 到 1 都等於 B', () => {
    for (const c of covers) close(compositeFrameBreakout(linear(B), F, c, [{ blend: 'normal', color: B, cover: 1 }]), linear(B));
  });

  it.each(BLEND_MODES)('半透明 %s：等於 mix(L, composite(F, B, b), c)，合成在 sRGB、mix 在線性', (blend) => {
    const L = linear({ r: 0.3, g: 0.5, b: 0.8 });
    for (const b of [0, 0.23, 0.6, 0.99]) {
      const surface = linear(compositeColor(blend, srgb(F), B, b));
      for (const c of covers) close(compositeFrameBreakout(L, F, c, [{ blend, color: B, cover: b }]), mix(L, surface, c));
    }
  });

  it('沒有破框層：完全等於原本 mix(L, F, c)，不套影子', () => {
    const L = linear(B);
    for (const c of covers) expect(compositeFrameBreakout(L, F, c, [], 0.4)).toEqual(mix(L, F, c));
  });

  it('卡框表面先壓影子，再由後往前用完整 cover 疊多層', () => {
    const L = linear(B);
    const layers = [{ blend: 'multiply', color: B, cover: 0.4 }, { blend: 'screen', color: B, cover: 0.7 }] as const;
    const f = srgb(F);
    let surface = { r: f.r * 0.6, g: f.g * 0.6, b: f.b * 0.6 };
    for (const layer of layers) surface = compositeColor(layer.blend, surface, layer.color, layer.cover);
    for (const c of covers) close(compositeFrameBreakout(L, F, c, layers, 0.4), mix(L, linear(surface), c));
  });
});
