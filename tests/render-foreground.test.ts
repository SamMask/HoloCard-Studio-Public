// 前景圖（T-830，SCHEMA view.foreground?、DESIGN §5「前景圖」）的 render 部分（render/backdrop.ts，預覽 CSS 那層與匯出共用）：
//   - foregroundRect：位置、大小 → 畫在畫面的哪裡（圖的中心＝畫面寬高的比例，所以任何寬高比都是同一個焦點；長邊＝畫面高 × 0.6 × 大小）。
//   - foregroundBlurPx：模糊 0～100 → 像素（畫面高的比例，預覽區多大、匯出多大都一樣模糊）。
//   - foregroundCss：預覽區 CSS 那層的變數（容器查詢單位 cqw／cqh），模擬瀏覽器的擺法要和 foregroundRect 一致。
//   - foregroundDrift：轉卡時前景圖往反方向微動（最多畫面寬 2%）。
//   - paintForeground（匯出）：照 foregroundRect 畫、模糊用 ctx.filter，畫完還原 filter；模糊 0 不設濾鏡；尺寸不合理不畫。
//   - composeCapture（PNG）：前景圖畫在卡片之後；沒給＝和以前一模一樣。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOREGROUND } from '../src/model/limits';
import {
  FOREGROUND_BASE,
  FOREGROUND_DRIFT,
  FOREGROUND_MAX_BLUR,
  foregroundBlurPx,
  foregroundCss,
  foregroundDrift,
  foregroundRect,
  paintForeground,
  type ForegroundImage,
  type ForegroundPlace,
} from '../src/render/backdrop';
import { composeCapture } from '../src/render/card-view';
import { pixelAt, readPixels, SoftCanvas, SoftImageData, solidImage, type SoftImage } from './fake-canvas2d';

const EPS = 1e-9;
const place = (over: Partial<ForegroundPlace> = {}): ForegroundPlace => ({ ...DEFAULT_FOREGROUND, ...over });
const SCREENS: readonly [number, number][] = [
  [1600, 900],
  [800, 600],
  [900, 1600],
  [1500, 2100],
  [700, 700],
];
const IMAGES: readonly [number, number][] = [
  [1600, 900],
  [900, 1600],
  [1024, 1024],
  [37, 1999],
];

describe('常數', () => {
  it('大小 1＝長邊是畫面高的 0.6；模糊 100＝畫面高的 4%；轉卡微動最多畫面寬 2%', () => {
    expect(FOREGROUND_BASE).toBe(0.6);
    expect(FOREGROUND_MAX_BLUR).toBe(0.04);
    expect(FOREGROUND_DRIFT).toBe(2);
  });
});

describe('foregroundRect：畫在哪裡', () => {
  it('中心＝畫面寬高的比例（x 往右、y 往上是正的）；長邊＝畫面高 × 0.6 × 大小；保持圖的長寬比', () => {
    for (const [W, H] of SCREENS) {
      for (const [w, h] of IMAGES) {
        for (const p of [place(), place({ x: 0, y: 0, scale: 1 }), place({ x: 1, y: -1, scale: 3 }), place({ x: -1, y: 1, scale: 0.5 })]) {
          const r = foregroundRect(w, h, W, H, p)!;
          expect(r.dx + r.dw / 2).toBeCloseTo((W * (1 + p.x)) / 2, 6);
          expect(r.dy + r.dh / 2).toBeCloseTo((H * (1 - p.y)) / 2, 6);
          expect(Math.max(r.dw, r.dh)).toBeCloseTo(H * FOREGROUND_BASE * p.scale, 6);
          expect(r.dw / r.dh).toBeCloseTo(w / h, 6);
        }
      }
    }
  });

  it('預設（左下角）：中心在左邊 15%、上面算來 80% 的地方', () => {
    const r = foregroundRect(1000, 500, 1000, 600, place())!;
    expect(r.dx + r.dw / 2).toBeCloseTo(150, 9);
    expect(r.dy + r.dh / 2).toBeCloseTo(480, 9);
    expect(r.dw).toBeCloseTo(360, 9);
    expect(r.dh).toBeCloseTo(180, 9);
  });

  it('不同畫面比例＝同一個焦點（中心在畫面的同一個比例位置）', () => {
    const p = place({ x: 0.3, y: 0.4 });
    for (const [W, H] of SCREENS) {
      const r = foregroundRect(800, 600, W, H, p)!;
      expect((r.dx + r.dw / 2) / W).toBeCloseTo(0.65, 9);
      expect((r.dy + r.dh / 2) / H).toBeCloseTo(0.3, 9);
    }
  });

  it('超出範圍夾回來、壞值用預設；尺寸不合理 → null（不畫）', () => {
    const a = foregroundRect(100, 100, 1000, 1000, place({ x: 9, y: -9, scale: 99 }))!;
    const b = foregroundRect(100, 100, 1000, 1000, place({ x: 1, y: -1, scale: 3 }))!;
    expect(a).toEqual(b);
    const c = foregroundRect(100, 100, 1000, 1000, { x: Number.NaN, y: Infinity, scale: Number.NaN, blur: 0 })!;
    expect(c).toEqual(foregroundRect(100, 100, 1000, 1000, place())!);
    for (const bad of [[0, 100, 100, 100], [100, -1, 100, 100], [100, 100, Number.NaN, 100], [100, 100, 100, 0]] as const) {
      expect(foregroundRect(bad[0], bad[1], bad[2], bad[3], place())).toBeNull();
    }
  });
});

describe('foregroundBlurPx', () => {
  it('模糊 ÷ 100 × 4% × 畫面高；0＝0；夾 0～100', () => {
    expect(foregroundBlurPx(place({ blur: 40 }), 1000)).toBeCloseTo(16, 9);
    expect(foregroundBlurPx(place({ blur: 100 }), 600)).toBeCloseTo(24, 9);
    expect(foregroundBlurPx(place({ blur: 0 }), 600)).toBe(0);
    expect(foregroundBlurPx(place({ blur: 500 }), 600)).toBeCloseTo(24, 9);
    expect(foregroundBlurPx(place({ blur: -3 }), 600)).toBe(0);
  });
});

describe('foregroundCss：預覽區 CSS 那層（容器查詢單位）', () => {
  /** 模擬瀏覽器：cqw／cqh 換成像素；<img> 是 size×size 的方框、中心在 left／top（translate −50%），object-fit: contain。 */
  function browser(css: ReturnType<typeof foregroundCss>, W: number, H: number, w: number, h: number) {
    const unit = (v: string) => {
      const m = /^(-?[\d.]+)(cqw|cqh)$/.exec(v);
      if (!m) throw new Error(`單位不對：${v}`);
      return (Number(m[1]) / 100) * (m[2] === 'cqw' ? W : H);
    };
    const cx = unit(css.left);
    const cy = unit(css.top);
    const box = unit(css.size);
    const k = box / Math.max(w, h);
    return { dx: cx - (w * k) / 2, dy: cy - (h * k) / 2, dw: w * k, dh: h * k, blur: unit(css.blur) };
  }

  it('各種畫面與圖：CSS 擺出來的位置、大小、模糊和 foregroundRect／foregroundBlurPx 一樣', () => {
    for (const [W, H] of SCREENS) {
      for (const [w, h] of IMAGES) {
        for (const p of [place(), place({ x: 0.55, y: 0.25, scale: 2.2, blur: 77 }), place({ x: -1, y: 1, scale: 0.5, blur: 0 })]) {
          const b = browser(foregroundCss(p), W, H, w, h);
          const r = foregroundRect(w, h, W, H, p)!;
          for (const k of ['dx', 'dy', 'dw', 'dh'] as const) expect(Math.abs(b[k] - r[k]), `${W}x${H} ${w}x${h} ${k}`).toBeLessThan(1e-3);
          expect(Math.abs(b.blur - foregroundBlurPx(p, H))).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('數字不會寫成 1e-7 這種寫法', () => {
    const css = foregroundCss(place({ x: -0.9999999, y: 0.9999999, scale: 0.5000001, blur: 1 }));
    for (const v of Object.values(css)) expect(v).not.toMatch(/e/i);
  });
});

describe('foregroundDrift：轉卡時往反方向微動', () => {
  it('正對（0°, 0°）不動；往右拖（yaw 變大）往左移、往下拖（pitch 變大）往上移；最多畫面寬 2%', () => {
    expect(foregroundDrift(0, 0)).toEqual({ x: 0, y: 0 });
    const right = foregroundDrift(30, 0);
    expect(right.x).toBeCloseTo(-1, 9);
    expect(right.y).toBe(0);
    expect(foregroundDrift(-90, 0).x).toBeCloseTo(2, 9);
    expect(foregroundDrift(0, 30).y).toBeCloseTo(-1, 9);
    for (let yaw = -720; yaw <= 720; yaw += 7) {
      const d = foregroundDrift(yaw, yaw / 4);
      expect(Math.abs(d.x)).toBeLessThanOrEqual(FOREGROUND_DRIFT + EPS);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(FOREGROUND_DRIFT + EPS);
    }
  });

  it('轉一整圈回到原位（不會跳）；不會有 −0；壞值＝不動', () => {
    expect(foregroundDrift(360, 0).x).toBeCloseTo(0, 9);
    expect(Object.is(foregroundDrift(0, 0).x, 0)).toBe(true);
    expect(Object.is(foregroundDrift(-0, -0).y, 0)).toBe(true);
    expect(foregroundDrift(Number.NaN, Infinity)).toEqual({ x: 0, y: 0 });
  });
});

describe('paintForeground（匯出）', () => {
  function recorder() {
    const calls: { filter: string; args: unknown[] }[] = [];
    const ctx = {
      filter: 'none',
      drawImage(...args: unknown[]) {
        calls.push({ filter: this.filter, args });
      },
    };
    return { ctx, calls };
  }
  const img = { tag: 'fg' } as unknown as HTMLImageElement;
  const fgOf = (p: ForegroundPlace, w = 400, h = 200): ForegroundImage => ({ image: img, width: w, height: h, place: p });

  it('照 foregroundRect 畫，模糊用 ctx.filter（像素照畫面高換算），畫完還原 filter', () => {
    const { ctx, calls } = recorder();
    const p = place({ blur: 50 });
    paintForeground(ctx as unknown as CanvasRenderingContext2D, fgOf(p), 600, 800);
    const r = foregroundRect(400, 200, 600, 800, p)!;
    expect(calls).toEqual([{ filter: `blur(${foregroundBlurPx(p, 800)}px)`, args: [img, r.dx, r.dy, r.dw, r.dh] }]);
    expect(ctx.filter).toBe('none');
  });

  it('模糊 0：不設濾鏡；尺寸不合理：不畫', () => {
    const { ctx, calls } = recorder();
    paintForeground(ctx as unknown as CanvasRenderingContext2D, fgOf(place({ blur: 0 })), 600, 800);
    expect(calls[0]!.filter).toBe('none');
    paintForeground(ctx as unknown as CanvasRenderingContext2D, fgOf(place(), 0, 200), 600, 800);
    paintForeground(ctx as unknown as CanvasRenderingContext2D, fgOf(place()), 0, 800);
    expect(calls).toHaveLength(1);
  });
});

describe('composeCapture（PNG）：前景圖畫在卡片之後', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageData', SoftImageData);
    vi.stubGlobal('document', { createElement: () => new SoftCanvas() });
  });
  afterEach(() => vi.unstubAllGlobals());

  const W = 40;
  const H = 40;
  /** 卡片：整張不透明的綠。 */
  const cardImage = () => new SoftImageData(solidImage(W, H, [20, 200, 20, 255]).data as Uint8ClampedArray<ArrayBuffer>, W, H);
  /** 前景圖：不透明的紅，放在正中間、長邊 = 畫面高 × 0.6（模糊 0，軟體畫布不做濾鏡）。 */
  const red: SoftImage = solidImage(10, 10, [220, 20, 20, 255]);
  const fg: ForegroundImage = { image: red as unknown as HTMLImageElement, width: 10, height: 10, place: place({ x: 0, y: 0, scale: 1, blur: 0 }) };

  it('有前景圖：中間是前景圖的紅（蓋在卡片上）、角落還是卡片', () => {
    for (const transparent of [false, true]) {
      const out = readPixels(composeCapture(cardImage() as unknown as ImageData, { transparent, foreground: fg }) as unknown as SoftCanvas);
      expect(pixelAt(out, W / 2, H / 2), String(transparent)).toEqual([220, 20, 20, 255]);
      expect(pixelAt(out, 1, 1), String(transparent)).toEqual([20, 200, 20, 255]);
    }
  });

  it('沒有前景圖（省略、null）：和以前一模一樣', () => {
    const before = readPixels(composeCapture(cardImage() as unknown as ImageData, { transparent: false }) as unknown as SoftCanvas);
    const none = readPixels(composeCapture(cardImage() as unknown as ImageData, { transparent: false, foreground: null }) as unknown as SoftCanvas);
    expect(Array.from(none.data)).toEqual(Array.from(before.data));
    expect(pixelAt(before, W / 2, H / 2)).toEqual([20, 200, 20, 255]);
  });
});
