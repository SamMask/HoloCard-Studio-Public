// T-814b：匯出「畫上背景」的底一定不透明。背景圖本身有透明（或半透明）的地方時，先鋪原本的深藍漸層底、再疊背景圖：
// PNG（composeCapture）、影片與 GIF 每一格的底（paintBase）共用；GIF 編碼器拒絕 alpha 不是 255 的畫格，所以真的走一次 GIF 編碼。
// 用軟體 2D 畫布（tests/fake-canvas2d.ts：真的混色），驗輸出的每個像素。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGifFrames } from '../src/file/gif-encode';
import { composeCapture, paintBackdrop, paintBase } from '../src/render/card-view';
import type { BackdropImage } from '../src/render/backdrop';
import { allOpaque, pixelAt, readPixels, SoftCanvas, softImage, solidImage, SoftImageData, type SoftImage } from './fake-canvas2d';

beforeEach(() => {
  vi.stubGlobal('ImageData', SoftImageData);
  vi.stubGlobal('document', { createElement: () => new SoftCanvas() });
});
afterEach(() => vi.unstubAllGlobals());

const W = 40;
const H = 56;

const backdropOf = (img: SoftImage): BackdropImage => ({ image: img as unknown as HTMLImageElement, width: img.width, height: img.height });

function canvas(w = W, h = H): { canvas: SoftCanvas; ctx: CanvasRenderingContext2D } {
  const c = new SoftCanvas();
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext('2d') as unknown as CanvasRenderingContext2D };
}

/** 鋪完底的整張畫布。 */
function base(backdrop: BackdropImage | null | undefined, w = W, h = H): SoftImageData {
  const c = canvas(w, h);
  paintBase(c.ctx, w, h, backdrop);
  return readPixels(c.canvas);
}

/** 只有深藍漸層（原本的底）的整張畫布。 */
function gradient(w = W, h = H): SoftImageData {
  const c = canvas(w, h);
  paintBackdrop(c.ctx, w, h);
  return readPixels(c.canvas);
}

describe('paintBase：背景圖有透明的地方，底還是不透明', () => {
  it('漸層底本身每個像素都不透明（對照基準）', () => {
    expect(allOpaque(gradient())).toBe(true);
  });

  it('完全透明的背景圖：整張等於深藍漸層、每個像素 alpha 255', () => {
    const out = base(backdropOf(solidImage(16, 16, [250, 20, 20, 0])));
    expect(allOpaque(out)).toBe(true);
    expect(Array.from(out.data)).toEqual(Array.from(gradient().data));
  });

  it('半透明的背景圖：每個像素 alpha 255、顏色是背景圖疊在漸層上的混色', () => {
    const out = base(backdropOf(solidImage(16, 16, [250, 20, 20, 128])));
    const grad = gradient();
    expect(allOpaque(out)).toBe(true);
    for (const [x, y] of [[0, 0], [W - 1, H - 1], [W >> 1, H >> 1]] as const) {
      const g = pixelAt(grad, x, y);
      const a = 128 / 255;
      const want = [250, 20, 20].map((c, i) => Math.round(c * a + g[i]! * (1 - a)));
      const got = pixelAt(out, x, y);
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!), `(${x},${y}) 通道 ${i}`).toBeLessThanOrEqual(1);
      expect(got[3]).toBe(255);
    }
  });

  it('左半不透明、右半透明：左半是背景圖的顏色、右半是漸層，整張 alpha 255', () => {
    // 正方形背景圖鋪到 40×56：cover 後左右各裁掉一些，中線仍是圖的正中央
    const half = softImage(32, 32, (x) => (x < 16 ? [10, 200, 30, 255] : [10, 200, 30, 0]));
    const out = base(backdropOf(half));
    const grad = gradient();
    expect(allOpaque(out)).toBe(true);
    for (const y of [2, H >> 1, H - 3]) {
      expect(pixelAt(out, 2, y)).toEqual([10, 200, 30, 255]);
      expect(pixelAt(out, W - 3, y)).toEqual(pixelAt(grad, W - 3, y));
    }
  });

  it('不透明的背景圖：完全是背景圖（和以前一樣，底被蓋住）', () => {
    const out = base(backdropOf(solidImage(16, 16, [12, 34, 56, 255])));
    expect(allOpaque(out)).toBe(true);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(12);
      expect(out.data[i + 1]).toBe(34);
      expect(out.data[i + 2]).toBe(56);
    }
  });

  it('沒有背景圖（null、省略）：和原本的深藍漸層一模一樣', () => {
    expect(Array.from(base(null).data)).toEqual(Array.from(gradient().data));
    expect(Array.from(base(undefined).data)).toEqual(Array.from(gradient().data));
  });
});

describe('composeCapture：PNG 的輸出', () => {
  /** 中央一塊不透明的綠、四周透明的「卡片」（擷取讀回、還原成直通 alpha 的樣子）。 */
  const card = () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 20; y < 36; y++) for (let x = 12; x < 28; x++) data.set([30, 220, 60, 255], (y * W + x) * 4);
    return new SoftImageData(data, W, H) as unknown as ImageData;
  };
  const png = (opts: Parameters<typeof composeCapture>[1]) => readPixels(composeCapture(card(), opts) as unknown as SoftCanvas);

  it.each([
    ['透明背景關著', false],
    ['透明背景開著（畫上背景時不管）', true],
  ] as const)('有背景圖（它自己有透明的地方）、%s：整張不透明，卡片在上、其他地方是背景圖或漸層', (_name, transparent) => {
    const bd = backdropOf(softImage(32, 32, (x) => (x < 16 ? [200, 40, 40, 255] : [200, 40, 40, 0])));
    const out = png({ transparent, backdrop: bd });
    expect(allOpaque(out)).toBe(true);
    expect(pixelAt(out, W >> 1, H >> 1)).toEqual([30, 220, 60, 255]);
    expect(pixelAt(out, 2, 4)).toEqual([200, 40, 40, 255]);
    expect(pixelAt(out, W - 3, 4)).toEqual(pixelAt(gradient(), W - 3, 4));
  });

  it('全透明的背景圖也是不透明的輸出', () => {
    expect(allOpaque(png({ transparent: true, backdrop: backdropOf(solidImage(8, 8, [0, 0, 0, 0])) }))).toBe(true);
  });

  it('沒有背景圖時照舊：透明背景＝卡片以外還是透明；不勾＝深藍漸層底', () => {
    const t = png({ transparent: true });
    expect(pixelAt(t, 2, 4)[3]).toBe(0);
    expect(pixelAt(t, W >> 1, H >> 1)).toEqual([30, 220, 60, 255]);
    const o = png({ transparent: false });
    expect(allOpaque(o)).toBe(true);
    expect(pixelAt(o, 2, 4)).toEqual(pixelAt(gradient(), 2, 4));
  });
});

describe('GIF：背景圖有透明的地方也編得出來', () => {
  it('透明與半透明的背景圖鋪出來的畫格，GIF 編碼器收（沒有「must be opaque」）', () => {
    for (const alpha of [0, 100, 255]) {
      const frame = base(backdropOf(solidImage(16, 16, [40, 90, 200, alpha])), 8, 8);
      const bytes = encodeGifFrames([frame.data], { width: 8, height: 8, delayMs: 67 });
      expect(String.fromCharCode(...bytes.subarray(0, 6)), `背景圖 alpha ${alpha}`).toBe('GIF89a');
    }
  });

  it('對照：直接把透明背景圖畫在透明畫布上（舊做法）的畫格，編碼器拒絕', () => {
    const c = canvas(8, 8);
    c.ctx.drawImage(solidImage(16, 16, [40, 90, 200, 0]) as unknown as CanvasImageSource, 0, 0, 16, 16, 0, 0, 8, 8);
    const frame = readPixels(c.canvas);
    expect(() => encodeGifFrames([frame.data], { width: 8, height: 8, delayMs: 67 })).toThrow(/opaque/);
  });
});
