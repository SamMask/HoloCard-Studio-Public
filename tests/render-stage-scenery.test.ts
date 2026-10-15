// T-850 連舞台一起錄：預覽區「CSS 那層」（style.css 的 .stage 底色、.stage-backdrop 的圖與暗角）在 2D 畫布上照同樣的算法畫
// （render/stage-scenery.ts 的 paintScenery），3D 畫布讀回的畫格再照瀏覽器合成透明畫布的方式疊上去（pixels.ts 的 composeOver）。
// 這裡驗算法（畫哪些層、從圖上取哪一塊、畫在哪、濾鏡）；實際畫面由瀏覽器實測和預覽並排比。
import { describe, expect, it } from 'vitest';
import type { StageStyle } from '../src/model/types';
import { coverRect, farPanRect, type BackdropImage } from '../src/render/backdrop';
import { composeOver } from '../src/render/pixels';
import { paintScenery, SCENERY_REF_HEIGHT, type StageScenery } from '../src/render/stage-scenery';

type Op =
  | { op: 'fill'; kind: 'radial' | 'linear' | 'solid'; stops: [number, string][]; filter: string; rect: number[] }
  | { op: 'image'; args: number[]; filter: string };

/** 記錄畫了什麼的假 2D 畫布（漸層記下色標；drawImage 記下來源與目的地；當下的 filter）。 */
function recorder() {
  const ops: Op[] = [];
  // 位移與縮放（save／restore 一起記）：fillRect 記下換算回畫布像素的那一塊
  let t = { tx: 0, ty: 0, sx: 1, sy: 1 };
  const stack: { filter: string; t: typeof t }[] = [];
  const ctx = {
    filter: 'none',
    fillStyle: null as unknown,
    save() {
      stack.push({ filter: ctx.filter, t: { ...t } });
    },
    restore() {
      const top = stack.pop();
      ctx.filter = top?.filter ?? 'none';
      t = top?.t ?? { tx: 0, ty: 0, sx: 1, sy: 1 };
    },
    translate(x: number, y: number) {
      t = { ...t, tx: t.tx + x * t.sx, ty: t.ty + y * t.sy };
    },
    scale(x: number, y: number) {
      t = { ...t, sx: t.sx * x, sy: t.sy * y };
    },
    createRadialGradient() {
      const g = { kind: 'radial' as const, stops: [] as [number, string][], addColorStop: (at: number, c: string) => g.stops.push([at, c]) };
      return g;
    },
    createLinearGradient() {
      const g = { kind: 'linear' as const, stops: [] as [number, string][], addColorStop: (at: number, c: string) => g.stops.push([at, c]) };
      return g;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const style = ctx.fillStyle as { kind?: 'radial' | 'linear'; stops?: [number, string][] } | string;
      const kind = typeof style === 'string' ? 'solid' : style.kind!;
      ops.push({ op: 'fill', kind, stops: typeof style === 'string' ? [[0, style]] : [...style.stops!], filter: ctx.filter,
        rect: [t.tx + x * t.sx, t.ty + y * t.sy, w * t.sx, h * t.sy] });
    },
    drawImage(_img: unknown, ...args: number[]) {
      ops.push({ op: 'image', args, filter: ctx.filter });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, raw: ctx };
}

const img = (width: number, height: number): BackdropImage => ({ image: {} as HTMLCanvasElement, width, height });
const W = 1280;
const H = 720;

function paint(scenery: StageScenery) {
  const r = recorder();
  paintScenery(r.ctx, W, H, scenery);
  // 畫完 filter 一定還原
  expect(r.raw.filter).toBe('none');
  return r.ops;
}

const plain = (stage: StageStyle): StageScenery => ({ stage, image: null });
const firstColors = (ops: Op[]) => ops.filter((o) => o.op === 'fill').map((o) => (o as Extract<Op, { op: 'fill' }>).stops[0]![1]);

describe('底色（.stage 的 background）', () => {
  it('全息光環：深藍徑向漸層＋暗角（.stage-backdrop::after，背景那層看得見）', () => {
    const ops = paint(plain('halo'));
    expect(ops.every((o) => o.op === 'fill')).toBe(true);
    expect(firstColors(ops)).toEqual(['#1a2c5c', 'rgba(6, 12, 32, 0.06)']);
  });

  it('展示廳（大廳還沒有）、魔法陣、星雲：只有各自的底色（背景那層 opacity 0，沒有暗角）', () => {
    expect(firstColors(paint(plain('gallery')))).toEqual(['#142a5e']);
    expect(firstColors(paint(plain('magic')))).toEqual(['#12224e']);
    expect(firstColors(paint(plain('nebula')))).toEqual(['#0d1132']);
  });

  it('水鏡：夜空直的漸層，上面一點月光（兩層）', () => {
    const ops = paint(plain('water'));
    expect(ops.map((o) => (o as Extract<Op, { op: 'fill' }>).kind)).toEqual(['linear', 'radial']);
    expect(firstColors(ops)).toEqual(['#060e26', 'rgba(196, 216, 255, 0.14)']);
  });

  it('底色與暗角每一層都填滿整張（底色不透明）', () => {
    for (const stage of ['halo', 'gallery', 'magic', 'water', 'nebula', 'desk'] as const) {
      for (const o of paint(plain(stage))) {
        const f = o as Extract<Op, { op: 'fill' }>;
        expect(f.op).toBe('fill');
        [0, 0, W, H].forEach((v, i) => expect(f.rect[i]).toBeCloseTo(v, 6));
      }
    }
  });
});

describe('背景那層的圖', () => {
  it('全息光環的底圖模糊版：cover 置中、放大 1.18 倍、blur＋saturate＋brightness（模糊照畫面高換算）', () => {
    const src = img(800, 1200);
    const ops = paint({ stage: 'halo', image: { kind: 'blur', source: src } });
    const draw = ops.find((o) => o.op === 'image') as Extract<Op, { op: 'image' }>;
    const r = coverRect(800, 1200, W, H);
    expect(draw.args.slice(0, 4)).toEqual([r.sx, r.sy, r.sw, r.sh]);
    expect(draw.args[4]).toBeCloseTo((W - 1.18 * W) / 2, 9);
    expect(draw.args[5]).toBeCloseTo((H - 1.18 * H) / 2, 9);
    expect(draw.args[6]).toBeCloseTo(1.18 * W, 9);
    expect(draw.args[7]).toBeCloseTo(1.18 * H, 9);
    const blur = (32 * H) / SCENERY_REF_HEIGHT;
    expect(draw.filter).toBe(`blur(${blur}px) saturate(1.2) brightness(0.66)`);
    // 圖之後才是暗角
    expect(ops.indexOf(draw)).toBeLessThan(ops.length - 1);
    expect(firstColors(ops).at(-1)).toBe('rgba(6, 12, 32, 0.06)');
  });

  it('自己的背景圖：照 view.farPan 裁（farPanRect）、亮度 0.85、淡暗角', () => {
    const pan = { x: 0.5, y: -0.25, zoom: 1.4 };
    const src = { ...img(2048, 1024), pan };
    const ops = paint({ stage: 'magic', image: { kind: 'custom', source: src } });
    const draw = ops.find((o) => o.op === 'image') as Extract<Op, { op: 'image' }>;
    const r = farPanRect(2048, 1024, W, H, pan);
    expect(draw.args).toEqual([r.sx, r.sy, r.sw, r.sh, 0, 0, W, H]);
    expect(draw.filter).toBe('brightness(0.85)');
    expect(firstColors(ops)).toEqual(['#12224e', 'rgba(6, 12, 32, 0)']);
  });

  it('展示廳的大廳：cover、上下 60%（object-position 50% 60%）、brightness(0.8) saturate(0.95)、大廳的暗角兩層', () => {
    const ops = paint({ stage: 'gallery', image: { kind: 'hall', source: img(2400, 1350) } });
    const draw = ops.find((o) => o.op === 'image') as Extract<Op, { op: 'image' }>;
    const r = coverRect(2400, 1350, W, H, 0.6);
    expect(draw.args).toEqual([r.sx, r.sy, r.sw, r.sh, 0, 0, W, H]);
    expect(draw.filter).toBe('brightness(0.8) saturate(0.95)');
    expect(firstColors(ops)).toEqual(['#142a5e', 'rgba(4, 8, 22, 0.25)', 'rgba(6, 12, 32, 0)']);
  });

  it('工作桌的木桌：照 style.css 的 T-832 擺（寬 max(100cqw, 284.4cqh)、高 160cqh、上緣 87cqh − 0.65×160cqh）、檯燈那塊壓暗、亮度 0.9、木桌的暗角', () => {
    const src = img(2560, 1440);
    const ops = paint({ stage: 'desk', image: { kind: 'desk', source: src } });
    const draw = ops.find((o) => o.op === 'image') as Extract<Op, { op: 'image' }>;
    const bw = Math.max(W, 2.844 * H);
    const bh = 1.6 * H;
    const left = Math.max(W - bw, Math.min(W / 2 - 0.27 * 2.844 * H, 0));
    const top = 0.87 * H - 0.65 * 1.6 * H;
    const s = Math.max(bw / 2560, bh / 1440);
    expect(draw.args[0]).toBeCloseTo(0, 9);
    expect(draw.args[1]).toBeCloseTo((1440 - bh / s) / 2, 9);
    expect(draw.args[2]).toBeCloseTo(bw / s, 9);
    expect(draw.args[3]).toBeCloseTo(bh / s, 9);
    expect(draw.args[4]).toBeCloseTo(left, 9);
    expect(draw.args[5]).toBeCloseTo(top, 9);
    expect(draw.args[6]).toBeCloseTo(bw, 9);
    expect(draw.args[7]).toBeCloseTo(bh, 9);
    expect(draw.filter).toBe('brightness(0.9)');
    const fills = ops.filter((o) => o.op === 'fill') as Extract<Op, { op: 'fill' }>[];
    // 底（木棕）→ 檯燈那塊（只填木桌那一塊、同樣的亮度）→ 暗角（直的、橢圓）
    const lamp = fills[1]!;
    expect(lamp.kind).toBe('radial');
    expect(lamp.filter).toBe('brightness(0.9)');
    [left, top, bw, bh].forEach((v, i) => expect(lamp.rect[i]).toBeCloseTo(v, 6));
    expect(fills.slice(2).map((f) => f.kind)).toEqual(['linear', 'radial']);
  });
});

describe('composeOver：3D 畫布（預乘 alpha）疊到不透明的底上＝瀏覽器合成透明畫布的方式', () => {
  it('out＝上＋底×(1−a)；alpha 0 是底、255 是上；舞台相加的光（顏色比 alpha 亮）照加、超過 255 夾住；輸出不透明', () => {
    const top = new Uint8ClampedArray([100, 50, 0, 128, 0, 0, 0, 0, 9, 8, 7, 255, 80, 80, 80, 20, 250, 250, 250, 40]);
    const base = new Uint8ClampedArray([200, 200, 200, 255, 11, 22, 33, 255, 1, 2, 3, 255, 10, 10, 10, 255, 255, 255, 255, 255]);
    const out = new Uint8ClampedArray(top.length);
    composeOver(top, base, out);
    expect([...out.slice(0, 4)]).toEqual([Math.round(100 + 200 * 127 / 255), Math.round(50 + 200 * 127 / 255), Math.round(200 * 127 / 255), 255]);
    expect([...out.slice(4, 8)]).toEqual([11, 22, 33, 255]);
    expect([...out.slice(8, 12)]).toEqual([9, 8, 7, 255]);
    expect([...out.slice(12, 16)]).toEqual([89, 89, 89, 255]);
    expect([...out.slice(16, 20)]).toEqual([255, 255, 255, 255]);
  });

  it('大小不一樣就丟錯', () => {
    expect(() => composeOver(new Uint8ClampedArray(8), new Uint8ClampedArray(4), new Uint8ClampedArray(8))).toThrow();
  });
});
