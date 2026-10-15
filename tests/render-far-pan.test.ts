// 遠景的位置與大小（T-822，SCHEMA view.farPan?、DESIGN §5「遠景位置」）的 render 部分：
//   - farPanRect：farPan＋畫面大小＋圖大小 → 從原圖取哪一塊（畫滿整個畫面）。預覽 CSS 那層、水鏡的遠景平面、匯出合成三處共用。
//     不管哪種寬高比、拉到哪個極端都不露空白；{0,0,1}＝T-814 的 cover（置中／水鏡貼下緣）一模一樣（沒有 farPan 的卡畫面不變）。
//   - farPanCss：CSS 那層的 object-position＋transform（cover 後再放大），模擬瀏覽器的算法要和 farPanRect 取到同一塊。
//   - paintCover（匯出）照背景圖帶的 pan 裁；水鏡（water-fx）照 setFarPan 裁、只在 x 或大小變了才重排；stage-switch 只交給水鏡。
import { Group, PerspectiveCamera, Texture } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { FarPan } from '../src/model/types';
import { coverRect, farPanCss, farPanRect, paintCover, withFarPan, type BackdropImage, type FarAnchor, type SourceRect } from '../src/render/backdrop';
import { BACKDROP_LAYER, STAGE_LAYER } from '../src/render/reflection';
import { createStageSwitch, type GalleryPart, type StageBackdrop, type WaterPart } from '../src/render/stage-switch';
import { createWaterFx } from '../src/render/water-fx';
import { waterBackdropPlane } from '../src/render/water-layout';

const EPS = 1e-9;
const pan = (x: number, y: number, zoom: number): FarPan => ({ x, y, zoom });

/** 畫面：16:9、4:3、9:16（題目要求的三種）＋很寬、很窄、正方形。 */
const SCREENS: readonly [number, number][] = [
  [1600, 900],
  [800, 600],
  [900, 1600],
  [2400, 700],
  [500, 1400],
  [700, 700],
];
/** 圖：寬、正方形、高、很寬（水鏡的遠景圖 2:1、使用者的圖什麼比例都有）。 */
const IMAGES: readonly [number, number][] = [
  [2048, 1024],
  [1600, 900],
  [1024, 1024],
  [800, 1200],
  [2048, 512],
  [37, 1999],
];
const EXTREMES = [-1, 0, 1] as const;
const ZOOMS = [1, 1.5, 3] as const;
const ANCHORS: readonly FarAnchor[] = ['center', 'bottom'];

/** 取的那一塊：和畫面同比例（等比放大畫滿）、完全在原圖裡面＝不露空白。 */
function expectCovers(r: SourceRect, srcW: number, srcH: number, dstW: number, dstH: number, label: string) {
  expect(r.sw / r.sh, label).toBeCloseTo(dstW / dstH, 9);
  expect(r.sx, label).toBeGreaterThanOrEqual(-EPS);
  expect(r.sy, label).toBeGreaterThanOrEqual(-EPS);
  expect(r.sx + r.sw, label).toBeLessThanOrEqual(srcW + 1e-6);
  expect(r.sy + r.sh, label).toBeLessThanOrEqual(srcH + 1e-6);
  expect(r.sw, label).toBeGreaterThan(0);
  expect(r.sh, label).toBeGreaterThan(0);
}

describe('farPanRect：遠景的位置與大小 → 從原圖取哪一塊', () => {
  it('{0,0,1}（含省略）＝T-814 的 cover：置中與水鏡貼下緣都一模一樣（逐位元相同）', () => {
    for (const [sw, sh] of IMAGES) {
      for (const [dw, dh] of SCREENS) {
        for (const p of [undefined, pan(0, 0, 1)]) {
          expect(farPanRect(sw, sh, dw, dh, p, 'center')).toStrictEqual(coverRect(sw, sh, dw, dh));
          expect(farPanRect(sw, sh, dw, dh, p, 'bottom')).toStrictEqual(coverRect(sw, sh, dw, dh, 1));
        }
        // anchor 省略＝置中
        expect(farPanRect(sw, sh, dw, dh, undefined)).toStrictEqual(coverRect(sw, sh, dw, dh));
      }
    }
  });

  it('16:9、4:3、9:16 等各種畫面 × 各種圖 × x／y 拉到 ±1 × 大小 1～3：都不露空白', () => {
    let n = 0;
    for (const [sw, sh] of IMAGES)
      for (const [dw, dh] of SCREENS)
        for (const x of EXTREMES)
          for (const y of EXTREMES)
            for (const zoom of ZOOMS)
              for (const anchor of ANCHORS) {
                const r = farPanRect(sw, sh, dw, dh, pan(x, y, zoom), anchor);
                expectCovers(r, sw, sh, dw, dh, `${sw}×${sh} → ${dw}×${dh} x${x} y${y} z${zoom} ${anchor}`);
                n++;
              }
    expect(n).toBe(IMAGES.length * SCREENS.length * 3 * 3 * 3 * 2);
  });

  it('±1＝圖的左／右（上／下）邊對齊畫面邊；0＝多出來的部分左右平均', () => {
    // 寬圖放進 4:3：左右多出來
    const [sw, sh, dw, dh] = [2048, 1024, 800, 600];
    const left = farPanRect(sw, sh, dw, dh, pan(-1, 0, 1));
    const right = farPanRect(sw, sh, dw, dh, pan(1, 0, 1));
    const mid = farPanRect(sw, sh, dw, dh, pan(0, 0, 1));
    expect(left.sx).toBe(0);
    expect(right.sx + right.sw).toBeCloseTo(sw, 9);
    expect(mid.sx).toBeCloseTo((sw - mid.sw) / 2, 9);
    // x＝0.5：多出來的部分的 75%
    expect(farPanRect(sw, sh, dw, dh, pan(0.5, 0, 1)).sx).toBeCloseTo((sw - mid.sw) * 0.75, 9);
    // 高圖放進 16:9：上下多出來
    const top = farPanRect(800, 1200, 1600, 900, pan(0, -1, 1));
    const bottom = farPanRect(800, 1200, 1600, 900, pan(0, 1, 1));
    expect(top.sy).toBe(0);
    expect(bottom.sy + bottom.sh).toBeCloseTo(1200, 9);
  });

  it('沒有多出來的方向（圖和畫面同比例、大小 1）：怎麼拉都不動（移到邊就停）', () => {
    for (const x of EXTREMES) for (const y of EXTREMES) expect(farPanRect(1600, 900, 800, 450, pan(x, y, 1))).toStrictEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
  });

  it('大小：取的那一塊是 1 倍時的 1／zoom；置中時以畫面中心（照 x、y 的焦點）放大', () => {
    const one = farPanRect(2048, 1024, 800, 600, pan(0, 0, 1));
    const three = farPanRect(2048, 1024, 800, 600, pan(0, 0, 3));
    expect(three.sw).toBeCloseTo(one.sw / 3, 9);
    expect(three.sh).toBeCloseTo(one.sh / 3, 9);
    // 置中放大：中心點不動
    expect(three.sx + three.sw / 2).toBeCloseTo(one.sx + one.sw / 2, 9);
    expect(three.sy + three.sh / 2).toBeCloseTo(one.sy + one.sh / 2, 9);
    // 放大後上下也有多出來的部分：y 才有作用
    expect(farPanRect(2048, 1024, 800, 600, pan(0, -1, 2)).sy).toBe(0);
  });

  it('水鏡（bottom）：y 不用、下緣永遠貼著（放大以下緣為基準）；x 照樣左右移', () => {
    for (const [sw, sh] of IMAGES) {
      for (const zoom of ZOOMS) {
        const rects = EXTREMES.map((y) => farPanRect(sw, sh, 2400, 700, pan(0.4, y, zoom), 'bottom'));
        for (const r of rects) {
          expect(r.sy + r.sh).toBeCloseTo(sh, 9);
          expect(r).toStrictEqual(rects[0]);
        }
      }
    }
    const left = farPanRect(2048, 1024, 1600, 900, pan(-1, 0, 2), 'bottom');
    const right = farPanRect(2048, 1024, 1600, 900, pan(1, 0, 2), 'bottom');
    expect(left.sx).toBe(0);
    expect(right.sx + right.sw).toBeCloseTo(2048, 9);
  });

  it('超出範圍夾回來、NaN 與無限大當預設值；尺寸不合理同 coverRect（整張原圖，不丟錯）', () => {
    expect(farPanRect(2048, 1024, 800, 600, pan(5, -5, 9))).toStrictEqual(farPanRect(2048, 1024, 800, 600, pan(1, -1, 3)));
    expect(farPanRect(2048, 1024, 800, 600, pan(-5, 5, 0.2))).toStrictEqual(farPanRect(2048, 1024, 800, 600, pan(-1, 1, 1)));
    expect(farPanRect(2048, 1024, 800, 600, pan(Number.NaN, Infinity, Number.NaN))).toStrictEqual(coverRect(2048, 1024, 800, 600));
    expect(farPanRect(400, 200, 0, 100, pan(1, 1, 2))).toStrictEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
    expect(farPanRect(400, 200, Number.NaN, 100, pan(1, 1, 2))).toStrictEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
  });
});

describe('farPanCss：預覽區 CSS 那層（object-fit: cover＋object-position＋transform: scale，原點同 object-position）', () => {
  /**
   * 模擬瀏覽器：<img> 盒子＝畫面 W×H、object-fit: cover、object-position: px% py% → 圖以 s0 倍放、左上角在 (W − 圖寬)·px；
   * 再 transform: scale(z)，原點 (px·W, py·H)。回畫面 [0,W]×[0,H] 看得到的是原圖哪一塊。
   */
  function cssVisible(srcW: number, srcH: number, W: number, H: number, px: number, py: number, z: number): SourceRect {
    const s0 = Math.max(W / srcW, H / srcH);
    const left = (W - srcW * s0) * px;
    const top = (H - srcH * s0) * py;
    const ox = px * W;
    const oy = py * H;
    // 畫面上的點 X 對到縮放前的 (X − ox) / z + ox，再對到原圖 (· − left) / s0
    const toSrcX = (X: number) => ((X - ox) / z + ox - left) / s0;
    const toSrcY = (Y: number) => ((Y - oy) / z + oy - top) / s0;
    return { sx: toSrcX(0), sy: toSrcY(0), sw: toSrcX(W) - toSrcX(0), sh: toSrcY(H) - toSrcY(0) };
  }
  const parse = (css: { position: string; scale: string }) => {
    const m = /^(-?[\d.]+)% (-?[\d.]+)%$/.exec(css.position);
    if (!m) throw new Error(css.position);
    return { px: Number(m[1]) / 100, py: Number(m[2]) / 100, z: Number(css.scale) };
  };

  it('{0,0,1}＝置中、不放大（和 T-814 的 cover 一樣）', () => {
    expect(farPanCss(undefined)).toEqual({ position: '50% 50%', scale: '1' });
    expect(farPanCss(pan(0, 0, 1))).toEqual({ position: '50% 50%', scale: '1' });
  });

  it('各種畫面 × 各種圖 × 極端值：CSS 看到的那一塊＝farPanRect（同一個算法）', () => {
    for (const [sw, sh] of IMAGES)
      for (const [W, H] of SCREENS)
        for (const x of [-1, -0.37, 0, 0.5, 1])
          for (const y of [-1, 0, 0.82, 1])
            for (const zoom of [1, 1.73, 3]) {
              const { px, py, z } = parse(farPanCss(pan(x, y, zoom)));
              const css = cssVisible(sw, sh, W, H, px, py, z);
              const want = farPanRect(sw, sh, W, H, pan(x, y, zoom));
              const label = `${sw}×${sh} → ${W}×${H} x${x} y${y} z${zoom}`;
              expect(css.sx, label).toBeCloseTo(want.sx, 6);
              expect(css.sy, label).toBeCloseTo(want.sy, 6);
              expect(css.sw, label).toBeCloseTo(want.sw, 6);
              expect(css.sh, label).toBeCloseTo(want.sh, 6);
            }
  });

  it('超出範圍夾回來；NaN 當預設值', () => {
    expect(farPanCss(pan(3, -3, 9))).toEqual(farPanCss(pan(1, -1, 3)));
    expect(farPanCss(pan(Number.NaN, Number.NaN, Number.NaN))).toEqual({ position: '50% 50%', scale: '1' });
    expect(farPanCss(pan(1, -1, 3))).toEqual({ position: '100% 0%', scale: '3' });
  });
});

describe('匯出：paintCover 照背景圖帶的位置裁', () => {
  const draw = (backdrop: BackdropImage, w: number, h: number) => {
    const calls: number[][] = [];
    const ctx = { drawImage: (_img: unknown, ...args: number[]) => void calls.push(args) };
    paintCover(ctx as unknown as CanvasRenderingContext2D, backdrop, w, h);
    return calls;
  };
  const image = {} as HTMLImageElement;

  it('有 pan：取 farPanRect 那一塊、畫滿整張（畫面比例不同也同一個焦點與放大）', () => {
    for (const [w, h] of [[720, 1008], [480, 270], [1000, 1000]] as const) {
      const p = pan(0.6, -0.4, 1.8);
      const calls = draw({ image, width: 2048, height: 1024, pan: p }, w, h);
      const r = farPanRect(2048, 1024, w, h, p);
      expect(calls).toEqual([[r.sx, r.sy, r.sw, r.sh, 0, 0, w, h]]);
    }
  });

  it('沒有 pan＝和 T-814 一樣（置中 cover）', () => {
    const r = coverRect(1600, 900, 600, 900);
    expect(draw({ image, width: 1600, height: 900 }, 600, 900)).toEqual([[r.sx, r.sy, r.sw, r.sh, 0, 0, 600, 900]]);
  });

  it('withFarPan：沒有位置或 {0,0,1} 回同一個物件（和以前一樣）；有的話多帶 pan', () => {
    const bd: BackdropImage = { image, width: 10, height: 10 };
    expect(withFarPan(bd, undefined)).toBe(bd);
    expect(withFarPan(bd, pan(0, 0, 1))).toBe(bd);
    expect(withFarPan(bd, pan(0.2, 0, 1))).toEqual({ ...bd, pan: pan(0.2, 0, 1) });
  });
});

describe('水鏡的遠景平面照位置裁（water-fx 的 setFarPan）', () => {
  const fake = (w = 2048, h = 1024): StageBackdrop => ({ texture: new Texture(), width: w, height: h });
  const camera = () => {
    const c = new PerspectiveCamera(30, 1.6, 0.05, 100);
    c.layers.enable(STAGE_LAYER);
    c.layers.enable(BACKDROP_LAYER);
    c.position.set(0, 0, 6);
    return c;
  };
  const planeOf = (cam: PerspectiveCamera, y: number) => waterBackdropPlane(cam.position.z, 30, 1.6, y);

  it('沒設過＝T-814 的 cover 貼下緣（和以前一樣）；設了照 farPanRect（bottom）', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setScene(fake());
    const plane = planeOf(cam, fx.group.position.y);
    expect(fx.farCrop()).toStrictEqual(coverRect(2048, 1024, plane.width, plane.height, 1));
    fx.setFarPan(pan(0.8, 0.5, 1.6));
    expect(fx.farCrop()).toStrictEqual(farPanRect(2048, 1024, plane.width, plane.height, pan(0.8, 0.5, 1.6), 'bottom'));
    fx.setFarPan(pan(0, 0, 1));
    expect(fx.farCrop()).toStrictEqual(coverRect(2048, 1024, plane.width, plane.height, 1));
  });

  it('先設位置再建遠景：一建好就照位置排；換一張遠景也照同一個位置（不歸零）', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setFarPan(pan(-1, 0, 2));
    fx.setScene(fake());
    const plane = planeOf(cam, fx.group.position.y);
    expect(fx.farCrop()).toStrictEqual(farPanRect(2048, 1024, plane.width, plane.height, pan(-1, 0, 2), 'bottom'));
    fx.setBackdrop(fake(1600, 900));
    expect(fx.farCrop()).toStrictEqual(farPanRect(1600, 900, plane.width, plane.height, pan(-1, 0, 2), 'bottom'));
  });

  it('只在 x 或大小變了才重排；y 變了、同一組再設都不重排（水鏡不用 y）', () => {
    const cam = camera();
    const fx = createWaterFx({ camera: cam });
    fx.setScene(fake());
    const spy = vi.spyOn(fx.backdropMesh()!.scale, 'set');
    fx.setFarPan(pan(0, 0, 1));
    fx.setFarPan(pan(0, 0.7, 1));
    fx.update(0.016);
    expect(spy).not.toHaveBeenCalled();
    fx.setFarPan(pan(0.3, 0.7, 1));
    expect(spy).toHaveBeenCalledTimes(1);
    fx.setFarPan(pan(0.3, 0.7, 2));
    expect(spy).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 30; i++) fx.update(0.016);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('沒有遠景時設位置不出錯（沒有平面＝沒有裁切）', () => {
    const fx = createWaterFx({ camera: camera() });
    fx.setFarPan(pan(1, 1, 3));
    expect(fx.farCrop()).toBeNull();
    expect(fx.backdropMesh()).toBeNull();
  });
});

class FakeWater {
  group = new Group();
  pans: FarPan[] = [];
  order: string[] = [];
  setCardHeight() {}
  setReducedMotion() {}
  setPose() {}
  update() {}
  setBackdrop() {
    this.order.push('backdrop');
  }
  setScene() {
    this.order.push('scene');
  }
  setFarPan(p: FarPan) {
    this.pans.push(p);
    this.order.push('pan');
  }
  setLook() {}
  dispose() {}
}

class OtherPart {
  group = new Group();
  calls: string[] = [];
  setCardHeight() {}
  setReducedMotion() {}
  setPose() {}
  update() {}
  setThumbs() {}
  setFarPan() {
    this.calls.push('pan');
  }
  dispose() {}
}

describe('stage-switch：遠景位置只交給水鏡', () => {
  function setup() {
    const waters: FakeWater[] = [];
    const others: OtherPart[] = [];
    const other = () => {
      const p = new OtherPart();
      others.push(p);
      return p;
    };
    const sw = createStageSwitch<unknown>({
      halo: other,
      gallery: () => other() as unknown as GalleryPart<unknown>,
      magic: other,
      nebula: other,
      desk: other,
      water: () => {
        const w = new FakeWater();
        waters.push(w);
        return w as unknown as WaterPart;
      },
    });
    return { sw, waters, others };
  }

  it('交給目前的水鏡；同一組（值一樣）再設不做事；記住', () => {
    const { sw, waters } = setup();
    sw.setStyle('water');
    sw.setFarPan(pan(0.5, 0, 2));
    sw.setFarPan({ x: 0.5, y: 0, zoom: 2 });
    expect(waters[0]!.pans).toEqual([pan(0, 0, 1), pan(0.5, 0, 2)]);
    expect(sw.farPan()).toEqual(pan(0.5, 0, 2));
  });

  it('換到水鏡：新建的水鏡一建好就收到記住的位置（在遠景圖之前給，第一次排版就照位置）', () => {
    const { sw, waters } = setup();
    sw.setFarPan(pan(-0.3, 0, 1.4));
    sw.setBackdrop({ texture: new Texture(), width: 4, height: 2 });
    sw.setWaterScene({ texture: new Texture(), width: 4, height: 2 });
    sw.setStyle('water');
    expect(waters[0]!.pans).toEqual([pan(-0.3, 0, 1.4)]);
    expect(waters[0]!.order).toEqual(['pan', 'backdrop', 'scene']);
  });

  it('其他舞台收不到（遠景在 CSS 那層，3D 不用動）', () => {
    const { sw, others } = setup();
    let i = 0;
    for (const style of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
      sw.setStyle(style);
      sw.setFarPan(pan(0.1 * ++i, 0, 2));
    }
    for (const o of others) expect(o.calls).toEqual([]);
  });
});
