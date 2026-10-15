// T-812：captureTurntable 的上下點頭（nodDeg）。用真正的 three.js 鏡頭／旋轉搭配假 GPU 與 2D 畫布（同 render-turntable-scene.test.ts 的做法，
// 只留這個任務要看的部分）：每一格實際的左右＋上下旋轉、視差拿到的上下角度、整段取景、參數檢查、擷取後完全還原。
import { Group, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASPECT_HEIGHT, type Card } from '../src/model/types';
import { createCardView, type CardPose, type TurntableOptions } from '../src/render/card-view';
import { CARD_THICKNESS, cardOutline } from '../src/render/fit';
import { turntableFrame, turntablePose, type FaceBox } from '../src/render/pick';
import { DISC, discBox, discOutline, DISC_THICKNESS } from '../src/render/disc';
import { sleeveBounds } from '../src/render/sleeve';
import { parallaxOffset } from '../src/interact/parallax';
import { BREAKOUT_FADE } from '../src/render/breakout';
import { viewDirection } from '../src/render/holo';

const shared = vi.hoisted(() => ({
  renderer: null as FakeRenderer | null,
  card: null as FakeCard | null,
  stage: null as FakeStage | null,
}));

vi.mock('three/webgpu', async importOriginal => ({
  ...await importOriginal<typeof import('three/webgpu')>(),
  WebGPURenderer: function () { return shared.renderer = new FakeRenderer(); },
}));
vi.mock('../src/render/card-mesh', () => ({ createCardObject: () => shared.card = new FakeCard() }));
vi.mock('../src/render/stage-switch', async importOriginal => ({
  ...await importOriginal<typeof import('../src/render/stage-switch')>(),
  createStageSwitch: () => shared.stage = new FakeStage(),
}));

class FakeCard {
  group = new Group();
  front = [new Vector2(), new Vector2()];
  back = [new Vector2()];
  time = 0;
  view = [0, 0];
  shape = { aspect: 'standard' } as Card;
  outline = () => this.shape.kind === 'disc' ? discOutline() : cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => face === 'front' ? this.front : this.back;
  reach = () => null;
  /** 假的破框層：不是空的話，擷取會用它算整段取景（每個姿勢各算一次）。 */
  breakout: FaceBox[] = [];
  breakoutBoxes = (face: 'front' | 'back', offsets?: { x: number; y: number }[]) => this.breakout.filter(b => b.face === face).map(b => {
    const o = offsets?.[0] ?? this.offsets(face)[0]!;
    return { face, box: { left: b.box.left + o.x, right: b.box.right + o.x, bottom: b.box.bottom + o.y, top: b.box.top + o.y } };
  });
  breakoutAt = () => null;
  update(card: Card) { this.shape = card; }
  setTime(time: number) { this.time = time; }
  setView(yaw: number, pitch: number) { this.view = [yaw, pitch]; }
  flash = { front: 0, back: 0 };
  setFlash(face: 'front' | 'back', level: number) { this.flash[face] = level; }
  sleeveShown = false;
  sleeve = () => this.shape.view?.sleeve ?? false;
  withoutSleeve(draw: () => void) {
    const before = this.sleeveShown;
    this.sleeveShown = false;
    try { draw(); } finally { this.sleeveShown = before; }
  }
  shadowsOn = () => true;
  setShadows() {}
  withFullShadows(draw: () => void) { draw(); }
}

class FakeStage {
  group = new Group();
  setReducedMotion() {}
  setCardHeight() {}
  setPose() {}
  setStyle() {}
  setThumbs() {}
  update() {}
  hidden(draw: () => void) { draw(); }
}

type Target = { width: number; height: number; dispose(): void };
class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = {};
  target: Target | null = null;
  camera: PerspectiveCamera | null = null;
  loop: ((time: number) => void) | null = null;
  rendered: { target: Target | null; view: number[]; rotation: ReturnType<Group['rotation']['toArray']>; front: number[][];
    camera: PerspectiveCamera; sleeve: boolean; back: number[][] }[] = [];
  read = vi.fn(async (target: Target) => {
    const stride = Math.ceil(target.width * 4 / 256) * 256;
    return new Uint8Array(stride * (target.height - 1) + target.width * 4);
  });
  init = async () => {};
  /** 擷取前先 await compileAsync（T-827）；編譯本身的順序與狀態在 tests/render-card-view-compile.test.ts。 */
  compileAsync = async () => {};
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  getDrawingBufferSize(v: Vector2) { return v.set(8, 6); }
  setAnimationLoop(loop: (time: number) => void) { this.loop = loop; }
  getRenderTarget = () => this.target;
  setRenderTarget(target: Target | null) { this.target = target; }
  render(_scene: unknown, camera: PerspectiveCamera) {
    // 真 renderer 在繪製前會更新鏡頭矩陣；假 renderer 也要做，才能投影實際擷取的那格。
    camera.updateMatrixWorld();
    this.camera = camera;
    const card = shared.card!;
    this.rendered.push({ target: this.target, view: [...card.view], rotation: card.group.rotation.toArray(), front: card.front.map(v => v.toArray()),
      camera: camera.clone(), sleeve: card.sleeveShown, back: card.back.map(v => v.toArray()) });
  }
  readRenderTargetPixelsAsync(target: Target) { return this.read(target); }
}

class FakeImageData {
  constructor(public data: Uint8ClampedArray<ArrayBuffer>, public width: number, public height: number) {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  pixels = new Uint8ClampedArray(0);
  ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, fillStyle: null as unknown,
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect: () => { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); },
    putImageData: (image: FakeImageData) => { this.pixels.set(image.data); },
    drawImage: () => {},
    getImageData: () => new FakeImageData(this.pixels.slice(), this.width, this.height),
  };
  getContext() {
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    return this.ctx;
  }
  toBlob(done: (blob: Blob) => void) { done(new Blob([], { type: 'image/png' })); }
  toDataURL() { return 'data:image/png;base64,'; }
}

const canvases: FakeCanvas[] = [];
beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', { createElement: () => { const canvas = new FakeCanvas(); canvases.push(canvas); return canvas; } });
});
afterEach(() => vi.unstubAllGlobals());

const RAD = Math.PI / 180;
const originalPose: CardPose = { yawDeg: 31, pitchDeg: -12, zoom: 0.85, front: [{ x: 0.1, y: 0.2 }, { x: -0.3, y: 0.4 }], back: [{ x: 0.5, y: -0.6 }] };
const options: TurntableOptions = {
  width: 8, frames: 8, seconds: 4, pitchDeg: -8,
  offsetsAt: (yaw, pitch) => ({ front: [{ x: yaw / 1000, y: pitch / 1000 }], back: [{ x: -yaw / 1000, y: -pitch / 1000 }] }),
};

async function setup(card = { aspect: 'standard' } as Card) {
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement,
    { plainBack: {} as HTMLImageElement, pedestal: {} as HTMLImageElement, frameCorner: {} as HTMLImageElement });
  view.setCard(card, () => undefined);
  shared.card!.sleeveShown = shared.card!.sleeve();
  view.setPose(originalPose);
  view.start(() => {});
  shared.renderer!.loop!(12500);
  shared.renderer!.rendered.length = 0;
  return view;
}

function snapshot() {
  const r = shared.renderer!, c = shared.card!, camera = r.camera!;
  return {
    target: r.target, aspect: camera.aspect, cameraZ: camera.position.z, viewOffset: camera.view ? { ...camera.view } : null,
    rotation: c.group.rotation.toArray(), front: c.front.map(v => v.toArray()), back: c.back.map(v => v.toArray()),
    view: [...c.view], time: c.time,
  };
}

describe('離屏逐格擷取：上下點頭（T-812）', () => {
  it.each([
    ['卡套', 'turn'], ['卡套', 'swing'],
    ['光碟', 'turn'], ['光碟', 'swing'],
    ['背面破框', 'turn'],
  ] as const)('%s、%s：上下 25° 真正擷取的 80 格全部投影在輸出內', async (kind, motion) => {
    const shape = kind === '光碟' ? { aspect: 'square', kind: 'disc' } as Card
      : { aspect: 'standard', view: { sleeve: kind === '卡套' } } as Card;
    const view = await setup(shape), c = shared.card!, r = shared.renderer!;
    if (kind === '背面破框') c.breakout = [{ face: 'back', box: { left: -0.9, right: 0.3, bottom: -1.2, top: 0.4 } }];
    const before = snapshot();
    const offsetsAt = (yaw: number, pitch: number) => ({
      front: [parallaxOffset('front', yaw, pitch, 100)], back: [parallaxOffset('back', yaw, pitch, 100)],
    });
    const result = await view.captureTurntable({ ...options, width: 80, frames: 80, motion, swingDeg: 30, nodDeg: 25,
      sleeve: kind === '卡套', offsetsAt }, () => {});
    expect(r.rendered).toHaveLength(80);
    const bounds = kind === '卡套' ? sleeveBounds(c.outline()) : kind === '光碟' ? discBox()
      : { ...c.outline(), thickness: CARD_THICKNESS };
    let backFrames = 0;
    for (const [i, frame] of r.rendered.entries()) {
      const phase = 2 * Math.PI * i / 80;
      const yaw = motion === 'turn' ? i * 4.5 : -30 * Math.sin(phase);
      const pitch = -8 - 25 * Math.cos(phase);
      expect(frame.view[0]).toBeCloseTo(yaw, 12);
      expect(frame.view[1]).toBeCloseTo(pitch, 12);
      expect(frame.sleeve).toBe(kind === '卡套');
      const group = new Group();
      group.rotation.fromArray(frame.rotation);
      group.updateMatrixWorld();
      const assertPoint = (x: number, y: number, z: number) => {
        const p = new Vector3(x, y, z).applyMatrix4(group.matrixWorld).project(frame.camera);
        const px = (p.x + 1) * result.width / 2, py = (1 - p.y) * result.height / 2;
        expect(px, `第 ${i} 格 x`).toBeGreaterThanOrEqual(-1e-6);
        expect(px, `第 ${i} 格 x`).toBeLessThanOrEqual(result.width + 1e-6);
        expect(py, `第 ${i} 格 y`).toBeGreaterThanOrEqual(-1e-6);
        expect(py, `第 ${i} 格 y`).toBeLessThanOrEqual(result.height + 1e-6);
      };
      for (const x of [-bounds.halfW, bounds.halfW])
        for (const y of [-bounds.halfH, bounds.halfH])
          for (const z of [-bounds.thickness / 2, bounds.thickness / 2]) assertPoint(x, y, z);
      // 光碟另檢查真正圓周的正反面（盒子的角只是保守上界）。
      if (kind === '光碟') for (let k = 0; k < 96; k++) {
        const a = 2 * Math.PI * k / 96;
        for (const z of [-DISC_THICKNESS / 2, DISC_THICKNESS / 2]) assertPoint(DISC.outer * Math.cos(a), DISC.outer * Math.sin(a), z);
      }
      if (kind === '背面破框' && viewDirection('back', yaw, pitch).z > BREAKOUT_FADE.from) {
        backFrames++;
        const o = frame.back[0]!;
        const b = c.breakout[0]!.box;
        for (const x of [b.left + o[0]!, b.right + o[0]!])
          for (const y of [b.bottom + o[1]!, b.top + o[1]!]) assertPoint(-x, y, -CARD_THICKNESS / 2);
      }
    }
    if (kind === '背面破框') expect(backFrames).toBeGreaterThan(20);
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['turn', undefined],
    ['swing', 30],
    ['swing', 60],
  ] as const)('%s（擺動 %s）、上下 25 度：每一格實際旋轉＝turntablePose（左右＋上下）、視差拿到那一格的上下角度，拍完完全還原', async (motion, swingDeg) => {
    const view = await setup(), r = shared.renderer!, before = snapshot();
    const offsetsAt = vi.fn(options.offsetsAt);
    await view.captureTurntable({ ...options, motion, swingDeg, nodDeg: 25, offsetsAt }, () => {});
    expect(r.rendered).toHaveLength(options.frames);
    for (let i = 0; i < options.frames; i++) {
      const { yawDeg, pitchDeg } = turntablePose(motion, swingDeg ?? 30, 25, -8, i, options.frames);
      expect(r.rendered[i]!.view[0]).toBeCloseTo(yawDeg, 12);
      expect(r.rendered[i]!.view[1]).toBeCloseTo(pitchDeg, 12);
      expect(r.rendered[i]!.rotation[0]).toBeCloseTo(pitchDeg * RAD, 12);
      expect(r.rendered[i]!.rotation[1]).toBeCloseTo(yawDeg * RAD, 12);
      expect(offsetsAt).toHaveBeenNthCalledWith(i + 1, yawDeg, pitchDeg);
      expect(r.rendered[i]!.front[0]![1]).toBeCloseTo(pitchDeg / 1000, 12);
    }
    // 第 0 格最低（−33°）、半圈最高（+17°）
    expect(r.rendered[0]!.view[1]).toBeCloseTo(-33, 12);
    expect(r.rendered[options.frames / 2]!.view[1]).toBeCloseTo(17, 12);
    expect(snapshot()).toEqual(before);
  });

  it('上下 0 度（明確給 0）與沒給 nodDeg：每一格旋轉、視差、輸出大小完全一樣，俯仰角整圈固定', async () => {
    const view = await setup(), r = shared.renderer!;
    const plain = await view.captureTurntable({ ...options, motion: 'swing' }, () => {});
    const first = r.rendered.map(f => [f.view, f.rotation, f.front]);
    r.rendered.length = 0;
    expect(await view.captureTurntable({ ...options, motion: 'swing', nodDeg: 0 }, () => {})).toEqual(plain);
    expect(r.rendered.map(f => [f.view, f.rotation, f.front])).toEqual(first);
    for (const f of r.rendered) {
      expect(f.view[1]).toBe(-8);
      expect(f.rotation[0]).toBe(-8 * RAD);
    }
  });

  it('輸出大小＝turntableFrame 帶同一個 nodDeg 算出來的；比沒有上下點頭的取景範圍大', async () => {
    const view = await setup(), r = shared.renderer!;
    const result = await view.captureTurntable({ ...options, motion: 'swing', swingDeg: 30, nodDeg: 25 }, () => {});
    const camera = r.camera!;
    const scene = { vFovDeg: camera.fov, viewAspect: camera.aspect, cameraZ: camera.position.z, yawDeg: 0, pitchDeg: -8,
      outline: shared.card!.outline(), thickness: CARD_THICKNESS };
    expect(result).toEqual({ width: options.width, height: turntableFrame(scene, options.width, 30, undefined, 25).height });
    expect(turntableFrame(scene, 480, 30, undefined, 25).viewOffset.fullWidth).toBeLessThan(turntableFrame(scene, 480, 30).viewOffset.fullWidth);
  });

  it('GIF 試編的 8 格＝80 格裡每隔 10 格取一格的同樣姿勢（同一個公式）', async () => {
    const view = await setup(), r = shared.renderer!;
    await view.captureTurntable({ ...options, frames: 8, nodDeg: 17 }, () => {});
    const few = r.rendered.map(f => f.view);
    r.rendered.length = 0;
    await view.captureTurntable({ ...options, frames: 80, nodDeg: 17 }, () => {});
    const all = r.rendered.map(f => f.view);
    few.forEach((v, k) => {
      expect(v[0]).toBeCloseTo(all[k * 10]![0]!, 9);
      expect(v[1]).toBeCloseTo(all[k * 10]![1]!, 9);
    });
  });

  it('有破框層：整段取景時視差拿到的是整條路徑上的（左右、上下）角度，最低與最高的上下角度都有', async () => {
    const view = await setup();
    shared.card!.breakout = [{ face: 'front', box: { left: -0.4, right: 0.5, bottom: 0.2, top: 1.1 } }];
    const offsetsAt = vi.fn(options.offsetsAt);
    await view.captureTurntable({ ...options, nodDeg: 25, offsetsAt }, () => {});
    const pitches = offsetsAt.mock.calls.map(c => c[1]);
    expect(Math.min(...pitches)).toBeCloseTo(-33, 9);
    expect(Math.max(...pitches)).toBeCloseTo(17, 9);
    // 取景（120 個姿勢）＋8 格各一次
    expect(offsetsAt.mock.calls.length).toBeGreaterThan(options.frames);
  });

  it.each([-1, -0.001, 25.001, 26, NaN, Infinity, -Infinity])('上下點頭幅度 %s 不合法：建立畫布與渲染前拒絕', async nodDeg => {
    const view = await setup();
    await expect(view.captureTurntable({ ...options, nodDeg }, vi.fn())).rejects.toThrow(/上下/);
    expect(shared.renderer!.rendered).toHaveLength(0);
    expect(canvases).toHaveLength(0);
  });

  it.each([0, 1, 10, 25])('上下點頭幅度 %s 合法', async nodDeg => {
    const view = await setup();
    await expect(view.captureTurntable({ ...options, nodDeg }, () => {})).resolves.toMatchObject({ width: options.width });
  });
});
