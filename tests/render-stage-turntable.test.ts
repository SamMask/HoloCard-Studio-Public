// T-850 連舞台一起錄：captureTurntable 的 stage 選項（真的 three.js 鏡頭與旋轉、假 GPU 與 2D 畫布）。
// 畫面 width × stage.height、預覽的預設鏡頭（不裁切、y＝0、照 stage.zoom 與舞台取景）、舞台照畫、舞台每格走同一條時間（先空跑）、
// 倒影每次 render 都重畫、CSS 那層＋3D（預乘 alpha 照瀏覽器的方式疊）＋前景圖、做完全部還原；不給 stage 時舊的路完全不碰舞台的擷取。
import { Group, NodeUpdateType, PerspectiveCamera, Vector2 } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASPECT_HEIGHT, type Card } from '../src/model/types';
import { createCardView, type CardPose, type TurntableOptions } from '../src/render/card-view';
import { cameraDistance, cardBox, cardOutline } from '../src/render/fit';
import { galleryReach } from '../src/render/gallery-layout';
import { turntablePose } from '../src/render/pick';
import { createPlanarReflection } from '../src/render/reflection';
import { initialStageMotion, stepStageMotion } from '../src/render/stage-motion';
import { SCENERY_REF_HEIGHT } from '../src/render/stage-scenery';

const shared = vi.hoisted(() => ({
  renderer: null as FakeRenderer | null,
  card: null as FakeCard | null,
  stage: null as FakeStage | null,
}));

vi.mock('three/webgpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/webgpu')>()),
  WebGPURenderer: function () {
    return (shared.renderer = new FakeRenderer());
  },
}));
vi.mock('../src/render/card-mesh', () => ({ createCardObject: () => (shared.card = new FakeCard()) }));
vi.mock('../src/render/stage-switch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/stage-switch')>()),
  createStageSwitch: () => (shared.stage = new FakeStage()),
}));

class FakeCard {
  group = new Group();
  front = [new Vector2()];
  back = [new Vector2()];
  time = 0;
  fxTime = 0;
  view = [0, 0];
  outline = () => cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => (face === 'front' ? this.front : this.back);
  reach = () => null;
  breakoutBoxes = () => [];
  breakoutAt = () => null;
  update() {}
  setTime(time: number, fxTime = time) {
    this.time = time;
    this.fxTime = fxTime;
  }
  setView(yaw: number, pitch: number) {
    this.view = [yaw, pitch];
  }
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

/** 假舞台：記下擷取那份動態每一步（角度、dt、有沒有畫）。 */
class FakeStage {
  group = new Group();
  steps: { yaw: number; pitch: number; dt: number; drew: boolean }[] = [];
  captures = 0;
  hiddenCalls = 0;
  setReducedMotion() {}
  setCardHeight() {}
  setPose() {}
  setStyle() {}
  setThumbs() {}
  update() {}
  hidden<R>(draw: () => R): R {
    this.hiddenCalls++;
    const prev = this.group.visible;
    this.group.visible = false;
    try {
      return draw();
    } finally {
      this.group.visible = prev;
    }
  }
  /** 擷取那份動態正換在裡面（step 進行中）：失敗、取消後一定要回到 0。 */
  inside = 0;
  capture() {
    this.captures++;
    return {
      step: <R>(yaw: number, pitch: number, dt: number, draw?: () => R): R | undefined => {
        this.steps.push({ yaw, pitch, dt, drew: draw !== undefined });
        this.inside++;
        try {
          return draw?.();
        } finally {
          this.inside--;
        }
      },
    };
  }
}

/** 倒影的節點（真的）：render 時看它是不是每次都重畫。 */
const probe = createPlanarReflection(new PerspectiveCamera(30, 1, 0.05, 100));

type Target = { width: number; height: number; dispose(): void };
class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = {};
  target: Target | null = null;
  loop: ((time: number) => void) | null = null;
  rendered: {
    target: Target | null; aspect: number; view: boolean; y: number; z: number; stage: boolean; fresh: boolean; fxTime: number; rotation: number[];
    time: number; cardView: number[]; front: number[][]; projection: number[];
  }[] = [];
  /** 讀回的每個像素（預乘 alpha）。 */
  pixel = [100, 50, 0, 128];
  read = vi.fn(async (target: Target) => {
    const stride = Math.ceil((target.width * 4) / 256) * 256;
    const raw = new Uint8Array(stride * (target.height - 1) + target.width * 4);
    for (let row = 0; row < target.height; row++) for (let x = 0; x < target.width; x++) raw.set(this.pixel, row * stride + x * 4);
    return raw;
  });
  init = async () => {};
  compileAsync = vi.fn(async () => {});
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  setAnimationLoop(loop: (time: number) => void) {
    this.loop = loop;
  }
  getRenderTarget = () => this.target;
  /** 設過的 render target 與放掉了沒（RenderTarget 的 dispose 事件）。 */
  targets = new Map<Target, boolean>();
  setRenderTarget(target: Target | null) {
    this.target = target;
    if (target && !this.targets.has(target)) {
      this.targets.set(target, false);
      (target as unknown as { addEventListener(type: string, fn: () => void): void }).addEventListener('dispose', () => this.targets.set(target, true));
    }
  }
  render(_scene: unknown, camera: PerspectiveCamera) {
    this.rendered.push({
      target: this.target,
      aspect: camera.aspect,
      view: camera.view?.enabled === true,
      y: camera.position.y,
      z: camera.position.z,
      stage: shared.stage!.group.visible,
      fresh: probe.node.reflector.getUpdateBeforeType() === NodeUpdateType.RENDER,
      fxTime: shared.card!.fxTime,
      rotation: shared.card!.group.rotation.toArray().slice(0, 3) as number[],
      time: shared.card!.time,
      cardView: [...shared.card!.view],
      front: shared.card!.front.map((v) => v.toArray()),
      projection: [...camera.projectionMatrix.elements],
    });
  }
  readRenderTargetPixelsAsync(target: Target) {
    return this.read(target);
  }
}

class FakeImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

/** 假 2D 畫布：fillRect 填滿底色（26, 44, 92）；drawImage 記次數（前景圖）；putImageData／getImageData 照搬像素。 */
class FakeCanvas {
  width = 0;
  height = 0;
  pixels = new Uint8ClampedArray(0);
  draws = 0;
  ctx = {
    filter: 'none',
    fillStyle: null as unknown,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect: () => {
      for (let i = 0; i < this.pixels.length; i += 4) this.pixels.set([26, 44, 92, 255], i);
    },
    putImageData: (image: FakeImageData) => this.pixels.set(image.data),
    drawImage: () => void this.draws++,
    getImageData: () => new FakeImageData(this.pixels.slice(), this.width, this.height),
  };
  getContext() {
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    return this.ctx;
  }
}

const canvases: FakeCanvas[] = [];
beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', {
    createElement: () => {
      const c = new FakeCanvas();
      canvases.push(c);
      return c;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const pose: CardPose = { yawDeg: 31, pitchDeg: -12, zoom: 0.6, front: [{ x: 0.1, y: 0.2 }], back: [{ x: 0.3, y: -0.4 }] };
const W = 16;
const H = 9;
const FRAMES = 4;
const base: TurntableOptions = {
  width: W,
  frames: FRAMES,
  seconds: 4,
  pitchDeg: -8,
  nodDeg: 10,
  startTime: 0,
  timeSpan: 4,
  offsetsAt: (yaw, pitch) => ({ front: [{ x: yaw / 1000, y: pitch / 1000 }], back: [{ x: 0, y: 0 }] }),
};
const scenery = { stage: 'gallery' as const, image: null };
const withStage = (over: Partial<NonNullable<TurntableOptions['stage']>> = {}): TurntableOptions => ({
  ...base,
  stage: { height: H, zoom: 0.85, scenery, foreground: null, ...over },
});

async function setup(stageStyle: 'gallery' | 'halo' = 'gallery') {
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement, {
    plainBack: {} as HTMLImageElement,
    pedestal: {} as HTMLImageElement,
    frameCorner: null,
  });
  view.setCard({ aspect: 'standard' } as Card, () => undefined);
  view.setStage(stageStyle);
  view.setPose(pose);
  view.start(() => {});
  shared.renderer!.loop!(1000);
  shared.renderer!.rendered.length = 0;
  return view;
}

describe('連舞台一起錄（T-850）：captureTurntable 的 stage', () => {
  it('畫面 width × stage.height；預覽的預設鏡頭（整個畫面、y＝0、照 stage.zoom 與展示廳的取景）；舞台照畫、倒影每次重畫', async () => {
    const view = await setup('gallery');
    const frames: Uint8ClampedArray[] = [];
    const size = await view.captureTurntable(withStage(), (rgba) => void frames.push(rgba));
    expect(size).toEqual({ width: W, height: H });
    expect(frames).toHaveLength(FRAMES);
    for (const f of frames) expect(f.length).toBe(W * H * 4);
    const shots = shared.renderer!.rendered;
    expect(shots).toHaveLength(FRAMES);
    const z = cameraDistance(30, W / H, 0.85, cardBox(ASPECT_HEIGHT.standard), galleryReach(ASPECT_HEIGHT.standard));
    for (const s of shots) {
      expect(s.target).toMatchObject({ width: W, height: H });
      expect(s.aspect).toBeCloseTo(W / H, 12);
      expect(s.view).toBe(false);
      expect(s.y).toBe(0);
      expect(s.z).toBeCloseTo(z, 12);
      expect(s.stage).toBe(true);
      expect(s.fresh).toBe(true);
    }
    // 舞台沒有被藏起來過；擷取完倒影回到一個影格一次
    expect(shared.stage!.hiddenCalls).toBe(0);
    expect(probe.node.reflector.getUpdateBeforeType()).toBe(NodeUpdateType.FRAME);
  });

  it('舞台的時間：先空跑一圈（第一步 dt 0），每格 seconds／frames 秒、角度照這一格；卡片特效同一條每格時間', async () => {
    const view = await setup();
    await view.captureTurntable(withStage(), () => {});
    const steps = shared.stage!.steps;
    expect(shared.stage!.captures).toBe(1);
    expect(steps).toHaveLength(2 * FRAMES);
    const dt = 4 / FRAMES;
    steps.forEach((s, j) => {
      const p = turntablePose('turn', 30, 10, -8, j % FRAMES, FRAMES);
      // 轉一圈：給舞台的角度跨圈連續（T-850c：每過一圈加 360°）
      expect(s.yaw).toBeCloseTo(p.yawDeg + 360 * Math.floor(j / FRAMES), 9);
      expect(s.pitch).toBeCloseTo(p.pitchDeg, 12);
      expect(s.dt).toBe(j === 0 ? 0 : dt);
      expect(s.drew).toBe(j >= FRAMES);
    });
    expect(shared.renderer!.rendered.map((r) => r.fxTime)).toEqual([0, 1, 2, 3]);
  });

  it('轉一圈：給舞台的角度跨圈連續（空跑接第 0 格、每過一圈都不倒回 0°），卡片本身的角度照舊在一圈裡（T-850c）', async () => {
    const view = await setup();
    const frames = 80;
    await view.captureTurntable({ ...withStage({ lap: 1 }), frames }, () => {});
    const steps = shared.stage!.steps;
    expect(steps).toHaveLength(3 * frames);
    const step = 360 / frames;
    for (let j = 1; j < steps.length; j++) expect(steps[j]!.yaw - steps[j - 1]!.yaw).toBeCloseTo(step, 9);
    // 卡片本身：第 0 格 0°、最後一格 355.5°（不加 360）
    const RAD = Math.PI / 180;
    const yaws = shared.renderer!.rendered.map((r) => r.rotation[1]! / RAD);
    expect(yaws[0]).toBeCloseTo(0, 9);
    expect(yaws.at(-1)).toBeCloseTo(360 - step, 9);
  });

  it('轉一圈：交界前後舞台的轉速、能量和一圈中間一樣（照真的 stepStageMotion 走一次；回繞時不會突然變亮，T-850c）', async () => {
    const view = await setup();
    const frames = 80;
    await view.captureTurntable({ ...withStage(), frames }, () => {});
    const m = initialStageMotion();
    const spins: number[] = [];
    for (const s of shared.stage!.steps) {
      stepStageMotion(m, s.yaw, s.pitch, s.dt, false);
      spins.push(m.spin);
    }
    // 空跑一圈後已經穩定：第 0 格（交界，第 80 步）、正式那圈的中間、最後一格的轉速都一樣（轉一圈 90°／秒＋點頭）
    const atBoundary = spins[frames]!;
    const mid = spins[frames + frames / 2]!;
    expect(Math.abs(atBoundary - mid) / mid).toBeLessThan(0.05);
    expect(Math.max(...spins)).toBeLessThan(mid * 1.2);
  });

  it('左右擺動：角度本來就連續，不加 360°', async () => {
    const view = await setup();
    await view.captureTurntable({ ...withStage(), motion: 'swing', swingDeg: 30 }, () => {});
    shared.stage!.steps.forEach((s, j) => {
      expect(s.yaw).toBeCloseTo(turntablePose('swing', 30, 10, -8, j % FRAMES, FRAMES).yawDeg, 9);
    });
  });

  it('影片第 2 圈（lap 1）：舞台先空跑兩圈再拍，動畫接著前一圈走', async () => {
    const view = await setup();
    await view.captureTurntable(withStage({ lap: 1 }), () => {});
    const steps = shared.stage!.steps;
    expect(steps).toHaveLength(3 * FRAMES);
    expect(steps.filter((s) => s.drew)).toHaveLength(FRAMES);
    expect(steps.slice(0, 2 * FRAMES).every((s) => !s.drew)).toBe(true);
  });

  it('每格：CSS 那層當底，3D 讀回的預乘畫格照瀏覽器的方式疊上去（out＝上＋底×(1−a)），一定不透明', async () => {
    const view = await setup();
    const frames: Uint8ClampedArray[] = [];
    await view.captureTurntable(withStage(), (rgba) => void frames.push(rgba));
    const k = 127 / 255;
    const want = [Math.round(100 + 26 * k), Math.round(50 + 44 * k), Math.round(0 + 92 * k), 255];
    expect([...frames[0]!.slice(0, 4)]).toEqual(want);
    expect([...frames[3]!.slice(-4)]).toEqual(want);
    // 每格都是新的陣列
    expect(frames[0]).not.toBe(frames[1]);
  });

  it('有前景圖：最後疊上（先畫好一次）', async () => {
    const view = await setup();
    const fg = { image: {} as HTMLCanvasElement, width: 10, height: 10, place: { x: -0.5, y: -0.5, scale: 1, blur: 0 } };
    await view.captureTurntable(withStage({ foreground: fg }), () => {});
    const drawn = canvases.reduce((n, c) => n + c.draws, 0);
    // 前景圖畫進自己的畫布一次，每格疊到輸出上一次
    expect(drawn).toBe(1 + FRAMES);
  });

  it('做完全部還原：鏡頭（比例、位置、沒有裁切）、卡片角度與時間；預覽照常畫', async () => {
    const view = await setup();
    const camera = new PerspectiveCamera();
    shared.renderer!.loop!(2000);
    const before = shared.renderer!.rendered.at(-1)!;
    shared.renderer!.rendered.length = 0;
    await view.captureTurntable(withStage(), () => {});
    shared.renderer!.loop!(3000);
    const after = shared.renderer!.rendered.at(-1)!;
    expect(after.aspect).toBeCloseTo(before.aspect, 12);
    expect(after.z).toBeCloseTo(before.z, 12);
    expect(after.y).toBe(before.y);
    expect(after.view).toBe(false);
    expect(after.rotation).toEqual(before.rotation);
    expect(after.fresh).toBe(false);
    expect(after.target).toBeNull();
    void camera;
  });

  it('工作桌（pitchLimit 10）：每一格的上下角度夾在 ±10°（卡片、舞台、視差都用夾過的）；沒給 pitchLimit＝照算（T-850 主對話決定）', async () => {
    const view = await setup();
    const pitches: number[] = [];
    const nod: TurntableOptions = {
      ...withStage({ pitchLimit: 10 }),
      nodDeg: 25,
      offsetsAt: (yaw, pitch) => {
        pitches.push(pitch);
        return { front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] };
      },
    };
    await view.captureTurntable(nod, () => {});
    const RAD = Math.PI / 180;
    const want = [0, 1, 2, 3].map((i) => Math.max(-10, Math.min(10, turntablePose('turn', 30, 25, -8, i, FRAMES).pitchDeg)));
    expect(want[0]).toBe(-10);
    const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
    expect(shared.renderer!.rendered.map((r) => round(r.rotation[0]! / RAD))).toEqual(want.map(round));
    expect(shared.stage!.steps.every((s) => s.pitch >= -10 && s.pitch <= 10)).toBe(true);
    expect(pitches).toEqual(want);

    shared.stage!.steps.length = 0;
    shared.renderer!.rendered.length = 0;
    await view.captureTurntable({ ...withStage(), nodDeg: 25 }, () => {});
    expect(shared.renderer!.rendered[0]!.rotation[0]! / RAD).toBeCloseTo(-33, 9);
  });

  describe('取消、編譯失敗、讀回失敗：鏡頭、render target、卡片角度、舞台動態都還原（T-850c）', () => {
    /** 預覽畫一格，回那一格的狀態（鏡頭、卡片）。 */
    let clock = 5000;
    const preview = () => {
      shared.renderer!.loop!((clock += 16));
      const r = shared.renderer!.rendered.at(-1)!;
      // 卡片的效果時間照預覽的影格時鐘走（每格都不一樣），不比
      return { aspect: r.aspect, view: r.view, y: r.y, z: r.z, rotation: r.rotation, cardView: r.cardView, front: r.front, projection: r.projection, target: r.target, stage: r.stage, fresh: r.fresh };
    };
    const expectRestored = (before: ReturnType<typeof preview>) => {
      const after = preview();
      expect(after).toEqual(before);
      // 用過的 render target 全部放掉；畫面回到畫布（不是擷取的 render target）
      const r = shared.renderer!;
      expect([...r.targets.values()].every((d) => d)).toBe(true);
      expect(r.target).toBeNull();
      // 舞台：擷取那份動態沒有留在裡面
      expect(shared.stage!.inside).toBe(0);
    };

    it('取消（第 2 格交出時）：AbortError；全部還原', async () => {
      const view = await setup();
      const before = preview();
      const ctrl = new AbortController();
      const got = view.captureTurntable(withStage(), (_rgba, index) => {
        if (index === 1) ctrl.abort();
      }, ctrl.signal);
      await expect(got).rejects.toMatchObject({ name: 'AbortError' });
      expect(shared.renderer!.targets.size).toBeGreaterThan(0);
      expectRestored(before);
    });

    it('編譯失敗：丟錯；全部還原（沒畫任何一格）', async () => {
      const view = await setup();
      const before = preview();
      shared.renderer!.compileAsync.mockRejectedValueOnce(new Error('編譯壞了'));
      shared.renderer!.rendered.length = 0;
      await expect(view.captureTurntable(withStage(), () => {})).rejects.toThrow('編譯壞了');
      expect(shared.renderer!.rendered).toHaveLength(0);
      expect(shared.renderer!.targets.size).toBeGreaterThan(0);
      expectRestored(before);
    });

    it('讀回失敗（第 2 格）：丟錯；全部還原', async () => {
      const view = await setup();
      const before = preview();
      const ok = shared.renderer!.read.getMockImplementation()!;
      let n = 0;
      shared.renderer!.read.mockImplementation(async (target: Target) => {
        if (++n === 2) throw new Error('讀不回來');
        return ok(target);
      });
      await expect(view.captureTurntable(withStage(), () => {})).rejects.toThrow('讀不回來');
      shared.renderer!.read.mockImplementation(ok);
      expectRestored(before);
    });
  });

  it('不合理的 stage 設定丟錯', async () => {
    const view = await setup();
    await expect(view.captureTurntable(withStage({ height: 0 }), () => {})).rejects.toThrow();
    await expect(view.captureTurntable(withStage({ height: 1.5 }), () => {})).rejects.toThrow();
    await expect(view.captureTurntable(withStage({ zoom: 0 }), () => {})).rejects.toThrow();
    await expect(view.captureTurntable(withStage({ lap: -1 }), () => {})).rejects.toThrow();
    await expect(view.captureTurntable(withStage({ pitchLimit: -5 }), () => {})).rejects.toThrow();
    await expect(view.captureTurntable(withStage({ pitchLimit: Number.NaN }), () => {})).rejects.toThrow();
  });

  it('不給 stage：舊的路（舞台藏起來、不開擷取的舞台動態、倒影不改）', async () => {
    const view = await setup();
    await view.captureTurntable(base, () => {});
    expect(shared.stage!.captures).toBe(0);
    expect(shared.stage!.steps).toHaveLength(0);
    expect(shared.renderer!.rendered.every((r) => !r.stage && !r.fresh)).toBe(true);
  });

  it('CSS 那層的模糊換算基準（預覽區高 700 px）', () => {
    expect(SCENERY_REF_HEIGHT).toBe(700);
  });
});
