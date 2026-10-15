// 軟體 2D 畫布（vitest 跑在 node、沒有 canvas）：只做 card-view 的 paintBackdrop／paintCover／composeCapture／captureTurntable 用到的幾個動作，
// 但「真的混色」——直通 alpha 的 source-over，跟瀏覽器 2D 畫布的結果一致——所以能驗輸出的每個像素（例如 alpha 是不是 255）。
// 沒做的：旋轉、裁切、濾鏡、插值（縮放用最近點）。漸層只支援圓心在原點、半徑 0→1 的徑向漸層（paintBackdrop 用的那種，位置靠 translate／scale 拉成橢圓）。

export interface SoftImage {
  readonly width: number;
  readonly height: number;
  /** 直通 alpha 的 RGBA，由上到下。 */
  readonly data: Uint8ClampedArray;
}

export class SoftImageData implements SoftImage {
  constructor(
    public data: Uint8ClampedArray<ArrayBuffer>,
    public width: number,
    public height: number,
  ) {}
}

/** 每個像素由 f(x, y) 決定的圖（當 drawImage 的來源）。 */
export function softImage(width: number, height: number, f: (x: number, y: number) => readonly [number, number, number, number]): SoftImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(f(x, y), (y * width + x) * 4);
  return { width, height, data };
}

/** 單色圖。 */
export const solidImage = (width: number, height: number, rgba: readonly [number, number, number, number]): SoftImage =>
  softImage(width, height, () => rgba);

function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`軟體畫布只認 #rrggbb：${color}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

class SoftGradient {
  readonly stops: [number, [number, number, number]][] = [];
  addColorStop(at: number, color: string) {
    this.stops.push([at, parseHex(color)]);
  }
  /** 離圓心 r（0～1，超過當 1）的顏色。 */
  at(r: number): [number, number, number] {
    const t = Math.min(1, Math.max(0, r));
    const stops = this.stops;
    if (stops.length === 0) return [0, 0, 0];
    if (t <= stops[0]![0]) return stops[0]![1];
    for (let i = 1; i < stops.length; i++) {
      const [b, cb] = stops[i]!;
      const [a, ca] = stops[i - 1]!;
      if (t <= b) {
        const k = b === a ? 1 : (t - a) / (b - a);
        return [0, 1, 2].map((c) => Math.round(ca[c]! + (cb[c]! - ca[c]!) * k)) as [number, number, number];
      }
    }
    return stops[stops.length - 1]![1];
  }
}

/** 直通 alpha 的 source-over：src 疊到 dst[at]。 */
function over(dst: Uint8ClampedArray, at: number, sr: number, sg: number, sb: number, sa255: number): void {
  const sa = sa255 / 255;
  const da = dst[at + 3]! / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) {
    dst[at] = dst[at + 1] = dst[at + 2] = dst[at + 3] = 0;
    return;
  }
  const src = [sr, sg, sb];
  for (let c = 0; c < 3; c++) dst[at + c] = Math.round((src[c]! * sa + dst[at + c]! * da * (1 - sa)) / oa);
  dst[at + 3] = Math.round(oa * 255);
}

interface Transform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

export class SoftContext {
  fillStyle: unknown = '#000000';
  private t: Transform = { tx: 0, ty: 0, sx: 1, sy: 1 };
  private stack: Transform[] = [];
  constructor(private readonly canvas: SoftCanvas) {}

  save() {
    this.stack.push({ ...this.t });
  }
  restore() {
    const t = this.stack.pop();
    if (t) this.t = t;
  }
  translate(x: number, y: number) {
    this.t.tx += this.t.sx * x;
    this.t.ty += this.t.sy * y;
  }
  scale(x: number, y: number) {
    this.t.sx *= x;
    this.t.sy *= y;
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
    if (x0 !== 0 || y0 !== 0 || r0 !== 0 || x1 !== 0 || y1 !== 0 || r1 !== 1) throw new Error('軟體畫布只做圓心在原點、半徑 0→1 的徑向漸層');
    return new SoftGradient();
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const { width, height, pixels } = this.canvas;
    const { tx, ty, sx, sy } = this.t;
    const style = this.fillStyle;
    for (let py = 0; py < height; py++) {
      const ly = (py + 0.5 - ty) / sy;
      if (ly < y || ly >= y + h) continue;
      for (let px = 0; px < width; px++) {
        const lx = (px + 0.5 - tx) / sx;
        if (lx < x || lx >= x + w) continue;
        const [r, g, b] = style instanceof SoftGradient ? style.at(Math.hypot(lx, ly)) : parseHex(String(style));
        over(pixels, (py * width + px) * 4, r, g, b, 255);
      }
    }
  }

  /** drawImage(來源, dx, dy)／(來源, dx, dy, dw, dh)／(來源, sx, sy, sw, sh, dx, dy, dw, dh)；來源是 SoftImage 或 SoftCanvas。 */
  drawImage(source: SoftImage | SoftCanvas, ...a: number[]) {
    const src: SoftImage = source instanceof SoftCanvas ? { width: source.width, height: source.height, data: source.pixels } : source;
    let [sx, sy, sw, sh, dx, dy, dw, dh] = [0, 0, src.width, src.height, 0, 0, src.width, src.height];
    if (a.length === 2) [dx, dy] = a as [number, number];
    else if (a.length === 4) [dx, dy, dw, dh] = a as [number, number, number, number];
    else if (a.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a as [number, number, number, number, number, number, number, number];
    else throw new Error('drawImage 的參數個數不支援');
    const { width, height, pixels } = this.canvas;
    for (let py = Math.max(0, Math.floor(dy)); py < Math.min(height, Math.ceil(dy + dh)); py++) {
      const v = sy + ((py + 0.5 - dy) / dh) * sh;
      const iy = Math.min(src.height - 1, Math.max(0, Math.floor(v)));
      for (let px = Math.max(0, Math.floor(dx)); px < Math.min(width, Math.ceil(dx + dw)); px++) {
        const u = sx + ((px + 0.5 - dx) / dw) * sw;
        const ix = Math.min(src.width - 1, Math.max(0, Math.floor(u)));
        const i = (iy * src.width + ix) * 4;
        over(pixels, (py * width + px) * 4, src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, src.data[i + 3]!);
      }
    }
  }

  putImageData(image: SoftImage, x: number, y: number) {
    const { width, height, pixels } = this.canvas;
    for (let row = 0; row < image.height; row++) {
      const py = y + row;
      if (py < 0 || py >= height) continue;
      for (let col = 0; col < image.width; col++) {
        const px = x + col;
        if (px < 0 || px >= width) continue;
        pixels.set(image.data.subarray((row * image.width + col) * 4, (row * image.width + col) * 4 + 4), (py * width + px) * 4);
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number): SoftImageData {
    const { width, height, pixels } = this.canvas;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const px = x + col;
        const py = y + row;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        out.set(pixels.subarray((py * width + px) * 4, (py * width + px) * 4 + 4), (row * w + col) * 4);
      }
    }
    return new SoftImageData(out, w, h);
  }
}

export class SoftCanvas {
  /** 'canvas' 設的 width／height 變動時像素重置（同瀏覽器：改大小就清空）。 */
  private w = 0;
  private h = 0;
  pixels = new Uint8ClampedArray(0);
  private ctx: SoftContext | null = null;
  get width() {
    return this.w;
  }
  set width(v: number) {
    this.w = v;
    this.pixels = new Uint8ClampedArray(this.w * this.h * 4);
  }
  get height() {
    return this.h;
  }
  set height(v: number) {
    this.h = v;
    this.pixels = new Uint8ClampedArray(this.w * this.h * 4);
  }
  getContext(kind: string) {
    if (kind !== '2d') return null;
    return (this.ctx ??= new SoftContext(this));
  }
  toBlob(done: (blob: Blob | null) => void) {
    done(new Blob([], { type: 'image/png' }));
  }
  toDataURL() {
    return 'data:image/png;base64,';
  }
}

/** 整張畫布讀成 SoftImageData（讀的是複本）。 */
export const readPixels = (canvas: SoftCanvas): SoftImageData =>
  new SoftImageData(canvas.pixels.slice(), canvas.width, canvas.height);

/** (x, y) 那一格的 [r, g, b, a]。 */
export const pixelAt = (image: SoftImage, x: number, y: number): number[] =>
  Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

/** 所有像素的 alpha 都是 255？ */
export const allOpaque = (image: SoftImage): boolean => {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return false;
  return true;
};
