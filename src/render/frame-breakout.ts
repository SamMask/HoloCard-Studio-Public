// 破框層蓋過簡約卡框（T-411d）：卡框反鋸齒邊上的合成公式的 CPU 版，給測試對照 card-mesh 的 shader 用（兩邊同一個公式）。
import type { BlendMode } from '../model/types';
import { compositeColor, linearToSrgb, srgbToLinear } from './blend';
import type { Rgb } from './frame';

export interface FrameBreakoutLayer {
  blend: BlendMode;
  color: Rgb;
  cover: number;
}

/**
 * 卡框與破框層的合成：L（圖層疊完）、F（卡框）、輸出是線性；破框層的顏色是 sRGB。
 * 結果＝mix(L, EOTF(overFrame(OETF(F) × (1 − 影子))), c)：卡框表面那幾成上，破框層用完整的 cover 由後往前疊，
 * 最後只照卡框覆蓋率 c 混一次（以前在 c 上又乘一次，反鋸齒邊會透出 c(1−c) 的框色）。沒有破框層＝原本的 mix(L, F, c)。
 */
export function compositeFrameBreakout(layersColor: Rgb, frameColor: Rgb, frameCover: number, layers: readonly FrameBreakoutLayer[], shadow = 0): Rgb {
  if (layers.length === 0) return compositeColor('normal', layersColor, frameColor, frameCover);
  let surface = {
    r: linearToSrgb(frameColor.r) * (1 - shadow),
    g: linearToSrgb(frameColor.g) * (1 - shadow),
    b: linearToSrgb(frameColor.b) * (1 - shadow),
  };
  for (const layer of layers) surface = compositeColor(layer.blend, surface, layer.color, layer.cover);
  const top = { r: srgbToLinear(surface.r), g: srgbToLinear(surface.g), b: srgbToLinear(surface.b) };
  return compositeColor('normal', layersColor, top, frameCover);
}
