// T-825 水鏡的〔地平線〕在 card-view：鏡頭往下移＋lens shift（setViewOffset）。假 GPU（同 render-card-view-backdrop.test.ts 的做法），
// 檢查真的入口：
//   - 卡片在畫面上的位置不變（projectCardPoint 和地平線 100 時一樣）、點選（hitTest）照移過的鏡頭算、來回對得上；
//   - 只有水鏡才移；地平線 100（〔夜色〕）鏡頭在 y＝0、沒有 view offset（和以前一樣）；
//   - 擷取（PNG、轉動影片）畫的那一格鏡頭放回 y＝0、沒有地平線的平移（舞台不進匯出），畫完還原；
//   - 擷取中途失敗（render 丟錯、讀回丟錯、onFrame 丟錯）鏡頭（位置、aspect、view offset、投影矩陣）與投影都還原（T-825d）；
//   - setWaterLook 交給舞台。
import { Group, Vector2, type PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WATER_LOOK, MIST_WATER_LOOK } from '../src/model/limits';
import { ASPECT_HEIGHT, type Card, type WaterLook } from '../src/model/types';
import { createCardView, type CardPose } from '../src/render/card-view';
import { cardOutline } from '../src/render/fit';
import { SoftCanvas, SoftImageData } from './fake-canvas2d';

const shared = vi.hoisted(() => ({
  renderer: null as FakeRenderer | null,
  stage: null as FakeStage | null,
}));

vi.mock('three/webgpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/webgpu')>()),
  WebGPURenderer: function () {
    return (shared.renderer = new FakeRenderer());
  },
}));
vi.mock('../src/render/card-mesh', () => ({ createCardObject: () => new FakeCard() }));
vi.mock('../src/render/stage-switch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/stage-switch')>()),
  createStageSwitch: () => (shared.stage = new FakeStage()),
}));

class FakeCard {
  group = new Group();
  front = [new Vector2()];
  back = [new Vector2()];
  outline = () => cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => (face === 'front' ? this.front : this.back);
  reach = () => null;
  breakoutBoxes = () => [];
  breakoutAt = () => null;
  update() {}
  setTime() {}
  setView() {}
  setFlash() {}
  sleeve = () => false;
  withoutSleeve(draw: () => void) {
    draw();
  }
  setShadows() {}
  withFullShadows(draw: () => void) {
    draw();
  }
}

class FakeStage {
  group = new Group();
  looks: WaterLook[] = [];
  setReducedMotion() {}
  setCardHeight() {}
  setPose() {}
  setStyle() {}
  setThumbs() {}
  update() {}
  hidden(draw: () => void) {
    draw();
  }
  setBackdrop() {}
  setWaterScene() {}
  setFarPan() {}
  setGalleryHall() {}
  setWaterLook(l: WaterLook) {
    this.looks.push({ ...l });
  }
}

type Target = { width: number; height: number; dispose(): void };
const SHOTS: { y: number; viewY: number | null }[] = [];
type Cam = { position: { y: number }; view: { enabled: boolean; offsetY: number } | null };

class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }) };
  target: Target | null = null;
  /** 每次 render 時鏡頭的高度與 view offset（所有假 renderer 共用一份）。 */
  shots = SHOTS;
  /** 失敗注入（T-825d）：renders＝已經畫過幾次，failRenderAt＝第幾次（從 0 數）丟錯；readError＝讀回丟錯。 */
  renders = 0;
  failRenderAt: number | null = null;
  readError: Error | null = null;
  /** 最後一次拿來畫的鏡頭（畫面上的那一個，擷取只是暫時改它）。 */
  camera: PerspectiveCamera | null = null;
  init = async () => {};
  /** 擷取前先 await compileAsync（T-827）；編譯本身的順序與狀態在 tests/render-card-view-compile.test.ts。 */
  compileAsync = async () => {};
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  setAnimationLoop() {}
  getRenderTarget = () => this.target;
  setRenderTarget(target: Target | null) {
    this.target = target;
  }
  render(_scene: unknown, camera: Cam) {
    this.camera = camera as unknown as PerspectiveCamera;
    this.shots.push({ y: camera.position.y, viewY: camera.view?.enabled ? camera.view.offsetY : null });
    if (this.renders++ === this.failRenderAt) throw new Error('假的 render 壞了');
  }
  async readRenderTargetPixelsAsync(target: Target) {
    if (this.readError) throw this.readError;
    const stride = Math.ceil((target.width * 4) / 256) * 256;
    return new Uint8Array(stride * (target.height - 1) + target.width * 4);
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
  });
  vi.stubGlobal('ImageData', SoftImageData);
  vi.stubGlobal('document', { createElement: () => new SoftCanvas() });
});
afterEach(() => vi.unstubAllGlobals());

const pose = (yawDeg = 0, pitchDeg = 0): CardPose => ({ yawDeg, pitchDeg, zoom: 1, front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] });

async function setup(stage: Card['view']['stage'], look: WaterLook) {
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement, {
    plainBack: {} as HTMLImageElement,
    pedestal: {} as HTMLImageElement,
    frameCorner: {} as HTMLImageElement,
  });
  view.setCard({ aspect: 'standard' } as Card, () => undefined);
  view.setStage(stage);
  view.setWaterLook(look);
  view.setPose(pose());
  return view;
}

const POINTS = [
  [0, 0],
  [0.3, -0.5],
  [-0.45, 0.6],
  [0.1, -0.69],
] as const;

describe('地平線：卡片在畫面上不動、點選照移過的鏡頭', () => {
  it('地平線 0：正面看時卡片上每一點在畫面上的位置和地平線 100 一樣（只差卡面在卡片平面前 0.0075 卡寬的一點點視差，< 0.3 像素）', async () => {
    const plain = await setup('water', DEFAULT_WATER_LOOK);
    const low = await setup('water', { ...DEFAULT_WATER_LOOK, horizon: 0, lift: 0 });
    for (const [x, y] of POINTS) {
      const a = plain.projectCardPoint('front', x, y)!;
      const b = low.projectCardPoint('front', x, y)!;
      expect(Math.abs(a.x - b.x), `${x},${y}`).toBeLessThan(0.3);
      expect(Math.abs(a.y - b.y), `${x},${y}`).toBeLessThan(0.3);
    }
  });

  it('轉著看（左右 35°、上下 −12°）：點選與投影來回對得上（hitTest 照移過的鏡頭）', async () => {
    const low = await setup('water', MIST_WATER_LOOK);
    low.setPose(pose(35, -12));
    for (const [x, y] of POINTS) {
      const at = low.projectCardPoint('front', x, y)!;
      const hit = low.hitTest(at.x, at.y)!;
      expect(hit.face).toBe('front');
      expect(hit.x).toBeCloseTo(x, 6);
      expect(hit.y).toBeCloseTo(y, 6);
      const onPlane = low.planePoint('front', at.x, at.y)!;
      expect(onPlane.x).toBeCloseTo(x, 6);
      expect(onPlane.y).toBeCloseTo(y, 6);
    }
  });

  it('只有水鏡才移鏡頭：別的舞台用同一組地平線 0 的樣子，畫面和夜色的水鏡一模一樣（逐位元）', async () => {
    const plain = await setup('water', DEFAULT_WATER_LOOK);
    for (const stage of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
      const other = await setup(stage, MIST_WATER_LOOK);
      // 取景（stageReach）不同的舞台鏡頭距離不一樣；同一個舞台、夜色 vs 地平線 0 才比
      const ref = await setup(stage, DEFAULT_WATER_LOOK);
      for (const [x, y] of POINTS) expect(other.projectCardPoint('front', x, y), stage).toStrictEqual(ref.projectCardPoint('front', x, y));
    }
    expect(plain.projectCardPoint('front', 0.3, 0.2)).not.toBeNull();
  });

  it('〔夜色〕：鏡頭在 y＝0、沒有 view offset；換進換出水鏡、拉地平線再拉回 100 都回到一模一樣', async () => {
    const view = await setup('water', DEFAULT_WATER_LOOK);
    const before = POINTS.map(([x, y]) => view.projectCardPoint('front', x, y));
    view.setWaterLook({ ...DEFAULT_WATER_LOOK, horizon: 20 });
    view.setStage('halo');
    view.setStage('water');
    view.setWaterLook(DEFAULT_WATER_LOOK);
    expect(POINTS.map(([x, y]) => view.projectCardPoint('front', x, y))).toStrictEqual(before);
    shared.renderer!.shots.length = 0;
    await view.capture();
    expect(shared.renderer!.shots).toEqual([{ y: 0, viewY: null }]);
  });

  it('setWaterLook 交給舞台', async () => {
    await setup('water', MIST_WATER_LOOK);
    expect(shared.stage!.looks.at(-1)).toEqual(MIST_WATER_LOOK);
  });
});

describe('擷取不帶地平線（舞台不進匯出）', () => {
  it('PNG：畫的那一格鏡頭在 y＝0（view offset 是擷取的裁切）；畫完還原（投影和擷取前一樣）', async () => {
    const low = await setup('water', MIST_WATER_LOOK);
    const plain = await setup('water', DEFAULT_WATER_LOOK);
    const before = POINTS.map(([x, y]) => low.projectCardPoint('front', x, y));
    shared.renderer!.shots.length = 0;
    await low.captureCard({ width: 64, transparent: true, pose: 'current' });
    const lowShots = [...shared.renderer!.shots];
    shared.renderer!.shots.length = 0;
    await plain.captureCard({ width: 64, transparent: true, pose: 'current' });
    expect(lowShots).toEqual(shared.renderer!.shots);
    expect(lowShots).toHaveLength(1);
    expect(lowShots[0]!.y).toBe(0);
    expect(POINTS.map(([x, y]) => low.projectCardPoint('front', x, y))).toStrictEqual(before);
  });

  it('轉動影片／GIF：每一格鏡頭在 y＝0、裁切和夜色一樣；畫完還原', async () => {
    const opts = { width: 32, frames: 4, seconds: 4, offsetsAt: () => ({ front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] }) };
    const low = await setup('water', MIST_WATER_LOOK);
    const plain = await setup('water', DEFAULT_WATER_LOOK);
    const before = POINTS.map(([x, y]) => low.projectCardPoint('front', x, y));
    shared.renderer!.shots.length = 0;
    const a = await low.captureTurntable(opts, () => {});
    const lowShots = [...shared.renderer!.shots];
    shared.renderer!.shots.length = 0;
    const b = await plain.captureTurntable(opts, () => {});
    expect(a).toEqual(b);
    expect(lowShots).toEqual(shared.renderer!.shots);
    for (const s of lowShots) expect(s.y).toBe(0);
    expect(POINTS.map(([x, y]) => low.projectCardPoint('front', x, y))).toStrictEqual(before);
  });
});

describe('擷取中途失敗：鏡頭與投影都還原（T-825d）', () => {
  /** 鏡頭目前的樣子：位置、aspect、view offset（含有沒有開）、投影矩陣。 */
  const cameraState = (camera: PerspectiveCamera) => ({
    y: camera.position.y,
    z: camera.position.z,
    aspect: camera.aspect,
    view: camera.view ? { ...camera.view } : null,
    projection: [...camera.projectionMatrix.elements],
  });
  const projected = (view: Awaited<ReturnType<typeof setup>>) => POINTS.map(([x, y]) => view.projectCardPoint('front', x, y));
  const turntable = { width: 32, frames: 4, seconds: 4, offsetsAt: () => ({ front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] }) };

  /** 地平線不是 100 的水鏡、轉著看；先成功擷取一次拿到畫面上的鏡頭（記下失敗前的樣子）。 */
  async function prepare() {
    const view = await setup('water', MIST_WATER_LOOK);
    view.setPose(pose(20, -8));
    await view.captureCard({ width: 64, transparent: true, pose: 'current' });
    const renderer = shared.renderer!;
    const camera = renderer.camera!;
    const before = cameraState(camera);
    // 有地平線的鏡頭才有東西可以還原：鏡頭往下移、view offset 開著
    expect(before.y).not.toBe(0);
    expect(before.view?.enabled).toBe(true);
    return { view, renderer, camera, before, points: projected(view) };
  }

  const cases: { name: string; inject(t: Awaited<ReturnType<typeof prepare>>): void; run(t: Awaited<ReturnType<typeof prepare>>): Promise<unknown> }[] = [
    {
      name: 'PNG：render 丟錯',
      inject: (t) => void (t.renderer.failRenderAt = t.renderer.renders),
      run: (t) => t.view.captureCard({ width: 64, transparent: true, pose: 'current' }),
    },
    {
      name: 'PNG（正面）：render 丟錯',
      inject: (t) => void (t.renderer.failRenderAt = t.renderer.renders),
      run: (t) => t.view.captureCard({ width: 64, transparent: true, pose: 'front' }),
    },
    {
      name: 'PNG：讀回丟錯',
      inject: (t) => void (t.renderer.readError = new Error('假的讀回壞了')),
      run: (t) => t.view.captureCard({ width: 64, transparent: true, pose: 'current' }),
    },
    {
      name: '轉動影片／GIF：第 2 格 render 丟錯',
      inject: (t) => void (t.renderer.failRenderAt = t.renderer.renders + 1),
      run: (t) => t.view.captureTurntable(turntable, () => {}),
    },
    {
      name: '轉動影片／GIF：讀回丟錯',
      inject: (t) => void (t.renderer.readError = new Error('假的讀回壞了')),
      run: (t) => t.view.captureTurntable(turntable, () => {}),
    },
    {
      name: '轉動影片／GIF：第 2 格的 onFrame 丟錯',
      inject: () => {},
      run: (t) =>
        t.view.captureTurntable(turntable, (_rgba, index) => {
          if (index === 1) throw new Error('假的 onFrame 壞了');
        }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}：鏡頭（位置、aspect、view offset、投影矩陣）與投影都和擷取前一樣，之後還能正常擷取`, async () => {
      const t = await prepare();
      c.inject(t);
      await expect(c.run(t)).rejects.toThrow();
      t.renderer.failRenderAt = null;
      t.renderer.readError = null;
      expect(cameraState(t.camera)).toEqual(t.before);
      expect(projected(t.view)).toStrictEqual(t.points);
      expect(t.renderer.target).toBeNull();
      // 失敗沒有留下半套狀態：下一次擷取照常（鏡頭在 y＝0 畫、畫完還原）
      t.renderer.shots.length = 0;
      await t.view.captureCard({ width: 64, transparent: true, pose: 'current' });
      expect(t.renderer.shots).toEqual([{ y: 0, viewY: expect.any(Number) }]);
      expect(cameraState(t.camera)).toEqual(t.before);
    });
  }

  it('〔夜色〕（鏡頭本來沒有 view offset）：轉動影片中途失敗，view 還是原本的 null、投影矩陣不變', async () => {
    const view = await setup('water', DEFAULT_WATER_LOOK);
    view.setPose(pose(20, -8));
    await view.captureTurntable(turntable, () => {}); // 成功的轉動影片擷取不留 view offset
    const renderer = shared.renderer!;
    const camera = renderer.camera!;
    const before = cameraState(camera);
    expect(before.view).toBeNull();
    renderer.failRenderAt = renderer.renders + 1;
    await expect(view.captureTurntable(turntable, () => {})).rejects.toThrow();
    expect(cameraState(camera)).toEqual(before);
    expect(renderer.target).toBeNull();
  });

  it('capture()（開發用整張）：render 丟錯 → render target 放回畫面、鏡頭不動', async () => {
    const t = await prepare();
    t.renderer.failRenderAt = t.renderer.renders;
    await expect(t.view.capture()).rejects.toThrow();
    expect(t.renderer.target).toBeNull();
    expect(cameraState(t.camera)).toEqual(t.before);
    expect(projected(t.view)).toStrictEqual(t.points);
  });
});
