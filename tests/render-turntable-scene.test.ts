// 用真正的 three.js 鏡頭／旋轉搭配假 GPU 與 2D 畫布，驗證擷取的狀態生命週期。
import { Group, PerspectiveCamera, Vector2 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASPECT_HEIGHT, type Card } from '../src/model/types';
import { createCardView, type CardPose, type TurntableOptions } from '../src/render/card-view';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline, type FrameBox } from '../src/render/fit';
import { GALLERY_PULLBACK, galleryReach } from '../src/render/gallery-layout';
import { WATER_PULLBACK } from '../src/render/water-layout';
import { SPARKLE_PERIOD } from '../src/render/holo';
import { captureFrame, turntableFrame } from '../src/render/pick';
import { DISC_THICKNESS, discBox } from '../src/render/disc';
import { sleeveBounds } from '../src/render/sleeve';

const shared = vi.hoisted(() => ({
  webgpu: true,
  renderer: null as FakeRenderer | null,
  card: null as FakeCard | null,
  stage: null as FakeStage | null,
}));

vi.mock('three/webgpu', async importOriginal => ({
  ...await importOriginal<typeof import('three/webgpu')>(),
  WebGPURenderer: function () { return shared.renderer = new FakeRenderer(); },
}));
vi.mock('../src/render/card-mesh', () => ({ createCardObject: () => shared.card = new FakeCard() }));
// 舞台的切換（T-410 stage-switch）換成假的：擷取時看它的容器有沒有被藏起來；取景（stageReach，T-415）用真的
vi.mock('../src/render/stage-switch', async importOriginal => ({
  ...await importOriginal<typeof import('../src/render/stage-switch')>(),
  createStageSwitch: () => shared.stage = new FakeStage(),
}));

class FakeCard {
  group = new Group();
  front = [new Vector2(), new Vector2()];
  back = [new Vector2()];
  time = 0;
  // 動態特效（T-811）的時間：setTime 第二個參數；沒給＝同 time（和真的 card-mesh 一樣，預覽兩個一樣）
  fxTime = 0;
  view = [0, 0];
  outline = () => cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => face === 'front' ? this.front : this.back;
  // 破框層（T-411）：這裡的假卡片預設沒有；取景測試改 reachValue
  reachValue: { x: number; y: number } | null = null;
  reach = () => this.reachValue;
  breakoutBoxes = () => [];
  breakoutAt = () => null;
  update() {}
  setTime(time: number, fxTime = time) { this.time = time; this.fxTime = fxTime; }
  setView(yaw: number, pitch: number) { this.view = [yaw, pitch]; }
  // 選中反光層時的斜線（T-417）
  flash = { front: 0, back: 0 };
  setFlash(face: 'front' | 'back', level: number) { this.flash[face] = level; }
  // 透明卡套（T-806）：sleeveOn＝卡片開著卡套；withoutSleeve 畫的那一下藏起來
  sleeveOn = false;
  sleeveShown = true;
  sleeve = () => this.sleeveOn;
  withoutSleeve(draw: () => void) {
    if (!this.sleeveOn) return draw();
    this.sleeveShown = false;
    try { draw(); } finally { this.sleeveShown = true; }
  }
  // 景深陰影（T-809）：預覽可以關；withFullShadows 畫的那一下一律完整
  shadowsPreview = true;
  shadowsFull = false;
  shadowsOn = () => this.shadowsPreview || this.shadowsFull;
  setShadows(on: boolean) { this.shadowsPreview = on; }
  withFullShadows(draw: () => void) {
    if (this.shadowsPreview) return draw();
    this.shadowsFull = true;
    try { draw(); } finally { this.shadowsFull = false; }
  }
}

class FakeStage {
  group = new Group();
  setReducedMotion() {}
  setCardHeight() {}
  setPose() {}
  setStyle() {}
  setThumbs() {}
  update() {}
  hidden(draw: () => void) {
    const prev = this.group.visible;
    this.group.visible = false;
    try { draw(); } finally { this.group.visible = prev; }
  }
}

type Target = { width: number; height: number; dispose(): void };
class FakeRenderer {
  backend = { isWebGPUBackend: shared.webgpu };
  domElement = {};
  target: Target | null = null;
  camera: PerspectiveCamera | null = null;
  loop: ((time: number) => void) | null = null;
  rendered: {
    target: Target | null; cameraZ: number; view: number[]; rotation: ReturnType<Group['rotation']['toArray']>;
    viewOffset: PerspectiveCamera['view']; projectionMatrix: number[]; time: number;
    front: number[][]; back: number[][]; stage: boolean; flash: { front: number; back: number }; sleeve: boolean; shadows: boolean;
    fxTime: number;
  }[] = [];
  pixel = [200, 100, 50, 255];
  read = vi.fn(async (target: Target) => {
    const stride = this.backend.isWebGPUBackend ? Math.ceil(target.width * 4 / 256) * 256 : target.width * 4;
    const raw = new Uint8Array(stride * (target.height - 1) + target.width * 4);
    raw.set(this.pixel);
    return raw;
  });
  init = async () => {};
  /** 擷取前先 await compileAsync（T-827）；編譯本身的順序與狀態在 tests/render-card-view-compile.test.ts。 */
  compileAsync = async () => {};
  pixelRatios: number[] = [];
  setPixelRatio(ratio: number) { this.pixelRatios.push(ratio); }
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  getDrawingBufferSize(v: Vector2) { return v.set(8, 6); }
  setAnimationLoop(loop: (time: number) => void) { this.loop = loop; }
  getRenderTarget = () => this.target;
  setRenderTarget(target: Target | null) { this.target = target; }
  render(_scene: unknown, camera: PerspectiveCamera) {
    this.camera = camera;
    const card = shared.card!;
    this.rendered.push({ target: this.target, cameraZ: camera.position.z, view: [...card.view], time: card.time,
      rotation: card.group.rotation.toArray(), viewOffset: camera.view && { ...camera.view }, projectionMatrix: [...camera.projectionMatrix.elements],
      front: card.front.map(v => v.toArray()), back: card.back.map(v => v.toArray()), stage: shared.stage!.group.visible,
      flash: { ...card.flash }, sleeve: card.sleeveOn && card.sleeveShown, shadows: card.shadowsOn(), fxTime: card.fxTime });
  }
  readRenderTargetPixelsAsync(target: Target) { return this.read(target); }
}

class FakeImageData {
  constructor(public data: Uint8ClampedArray<ArrayBuffer>, public width: number, public height: number) {}
}

// 模擬 putImageData 的直接寫入及 drawImage 的 alpha 合成；漸層的實際畫質由瀏覽器驗收。
class FakeCanvas {
  width = 0;
  height = 0;
  pixels = new Uint8ClampedArray(0);
  stops: [number, string][] = [];
  ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, fillStyle: null as unknown,
    createRadialGradient: () => ({ addColorStop: (at: number, color: string) => this.stops.push([at, color]) }),
    fillRect: () => {
      this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
      for (let i = 0; i < this.pixels.length; i += 4) this.pixels.set([26, 44, 92, 255], i);
    },
    putImageData: (image: FakeImageData) => { this.pixels.set(image.data); },
    drawImage: (layer: FakeCanvas) => {
      for (let i = 0; i < this.pixels.length; i += 4) {
        const a = layer.pixels[i + 3]! / 255;
        for (let c = 0; c < 3; c++) this.pixels[i + c] = layer.pixels[i + c]! * a + this.pixels[i + c]! * (1 - a);
        this.pixels[i + 3] = 255;
      }
    },
    getImageData: () => new FakeImageData(this.pixels.slice(), this.width, this.height),
  };
  getContext() {
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    return this.ctx;
  }
  // captureCard／capture 的輸出（T-417 的斜線測試用到；內容不檢查）
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

const originalPose: CardPose = {
  yawDeg: 31, pitchDeg: -12, zoom: 0.85,
  front: [{ x: 0.1, y: 0.2 }, { x: -0.3, y: 0.4 }], back: [{ x: 0.5, y: -0.6 }],
};
const options: TurntableOptions = {
  width: 8, frames: 4, seconds: 4, pitchDeg: 17,
  offsetsAt: (yaw, pitch) => ({ front: [{ x: yaw / 1000, y: pitch / 1000 }], back: [{ x: -yaw / 1000, y: -pitch / 1000 }] }),
};

async function setup(webgpu = true) {
  shared.webgpu = webgpu;
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement,
    { plainBack: {} as HTMLImageElement, pedestal: {} as HTMLImageElement, frameCorner: {} as HTMLImageElement });
  view.setCard({ aspect: 'standard' } as Card, () => undefined);
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
    projectionMatrix: [...camera.projectionMatrix.elements],
    rotation: c.group.rotation.toArray(), front: c.front.map(v => v.toArray()), back: c.back.map(v => v.toArray()),
    view: [...c.view], time: c.time, stage: shared.stage!.group.visible,
  };
}

describe('離屏逐格擷取整圈', () => {
  it.each([undefined, 5, 32, 60])('左右擺動幅度 %s：實際旋轉、視差與時間符合固定步進，先左後右且無縫', async swingDeg => {
    const view = await setup(), r = shared.renderer!, before = snapshot();
    const frames = 8, amplitude = swingDeg ?? 30;
    const offsetsAt = vi.fn(options.offsetsAt);
    const result = await view.captureTurntable({ ...options, frames, motion: 'swing', swingDeg,
      startTime: 2, timeSpan: 8, offsetsAt }, () => {});
    const yaws = r.rendered.map(f => f.view[0]);
    for (let i = 0; i < frames; i++) {
      const yaw = -amplitude * Math.sin(2 * Math.PI * i / frames);
      expect(yaws[i]).toBeCloseTo(yaw, 12);
      expect(r.rendered[i]!.rotation[1]).toBeCloseTo(yaw * Math.PI / 180, 12);
      expect(offsetsAt).toHaveBeenNthCalledWith(i + 1, yaw, options.pitchDeg);
      expect(r.rendered[i]!.front[0]![0]).toBeCloseTo(yaw / 1000, 12);
      expect(r.rendered[i]!.time).toBe(2 + i);
    }
    expect(yaws[0]).toBeCloseTo(0, 12);
    expect(yaws[frames / 4]).toBeCloseTo(-amplitude, 12);
    expect(yaws[frames / 2]).toBeCloseTo(0, 12);
    expect(yaws[3 * frames / 4]).toBeCloseTo(amplitude, 12);
    // 末格到首格與首格到第二格是相同的左轉步進；不重複首格。
    expect(yaws[0]! - yaws[frames - 1]!).toBeCloseTo(yaws[1]! - yaws[0]!, 12);
    const camera = r.camera!;
    expect(result).toEqual({ width: options.width, height: turntableFrame({
      vFovDeg: camera.fov, viewAspect: camera.aspect, cameraZ: camera.position.z,
      yawDeg: 0, pitchDeg: options.pitchDeg!, outline: shared.card!.outline(), thickness: CARD_THICKNESS,
    }, options.width, amplitude).height });
    expect(snapshot()).toEqual(before);
  });

  // ---- 動態特效（T-811）：影片時間接進 card.setTime 的第二個參數（閃星另外用效果時間 startTime + index × timeSpan／frames）----
  it.each([
    { motion: 'turn' as const, frames: 8, seconds: 4, startTime: 2, timeSpan: 8 },
    { motion: 'swing' as const, frames: 8, seconds: 4, startTime: 2, timeSpan: 8 },
    { motion: 'turn' as const, frames: 80, seconds: 8, startTime: 13.7, timeSpan: 12 },
  ])('動態特效時間（%j）：第 i 格的特效時間＝i × 一圈秒數／格數（從 0 開始），和閃星的效果時間分開', async ({ motion, frames, seconds, startTime, timeSpan }) => {
    const view = await setup(), r = shared.renderer!;
    await view.captureTurntable({ ...options, motion, frames, seconds, startTime, timeSpan }, () => {});
    expect(r.rendered).toHaveLength(frames);
    for (const [i, f] of r.rendered.entries()) {
      expect(f.fxTime).toBeCloseTo((i * seconds) / frames, 12);
      expect(f.time).toBeCloseTo(startTime + i * (timeSpan / frames), 12);
    }
    expect(r.rendered[0]!.fxTime).toBe(0);
    // 特效時間和閃星的效果時間不是同一個數（起始時間 ≠ 0 時一眼看得出來）
    expect(r.rendered[1]!.fxTime).not.toBe(r.rendered[1]!.time);
  });

  it('動態特效時間：每一圈都從 0 開始（接著拍第二圈、起始時間不同也一樣）；拍完預覽的特效時間回到原本的畫面時間', async () => {
    const view = await setup(), r = shared.renderer!, card = shared.card!;
    await view.captureTurntable({ ...options, frames: 4, seconds: 4, startTime: 5, timeSpan: 4 }, () => {});
    const lap1 = r.rendered.map(f => f.fxTime);
    r.rendered.length = 0;
    await view.captureTurntable({ ...options, frames: 4, seconds: 4, startTime: 9, timeSpan: 4 }, () => {});
    const lap2 = r.rendered.map(f => f.fxTime);
    expect(lap1).toEqual([0, 1, 2, 3]);
    expect(lap2).toEqual(lap1);
    // 暫改都還原：預覽用的畫面時間與特效時間又是同一個數
    expect(card.fxTime).toBe(card.time);
  });

  it('沒給起始時間（省略）：特效時間照樣只看影片時間（和預覽的畫面時間無關）', async () => {
    const view = await setup(), r = shared.renderer!;
    await view.captureTurntable(options, () => {});
    expect(r.rendered.map(f => f.fxTime)).toEqual([0, 1, 2, 3]);
    expect(r.rendered.every(f => f.time >= 12.5)).toBe(true);
  });

  it('明確 turn 與省略 motion 的畫格和外框完全相同', async () => {
    const view = await setup(), r = shared.renderer!;
    const implicit = await view.captureTurntable(options, () => {});
    const first = r.rendered.slice();
    r.rendered.length = 0;
    expect(await view.captureTurntable({ ...options, motion: 'turn' }, () => {})).toEqual(implicit);
    expect(r.rendered.map(f => [f.rotation, f.viewOffset, f.time])).toEqual(first.map(f => [f.rotation, f.viewOffset, f.time]));
  });

  it.each([
    { motion: 'unknown' }, { motion: null },
    ...[4.9, 60.1, NaN, Infinity, -Infinity].flatMap(swingDeg => [
      { motion: 'swing', swingDeg }, { motion: 'turn', swingDeg },
    ]),
  ])('動作參數不合法 %j：建立畫布與渲染前拒絕', async invalid => {
    const view = await setup();
    await expect(view.captureTurntable({ ...options, ...invalid } as TurntableOptions, vi.fn())).rejects.toThrow();
    expect(shared.renderer!.rendered).toHaveLength(0);
    expect(canvases).toHaveLength(0);
  });

  it.each([0, 17])('pitch %d°：實際旋轉、裁切與投影符合整圈外框，高度取偶數、寬度不變', async pitch => {
    const view = await setup(), r = shared.renderer!, camera = r.camera!;
    const width = 79;
    const frame = turntableFrame({ vFovDeg: camera.fov, viewAspect: camera.aspect, cameraZ: camera.position.z,
      yawDeg: originalPose.yawDeg, pitchDeg: pitch, outline: shared.card!.outline(), thickness: CARD_THICKNESS }, width);
    const expectedCamera = camera.clone();
    const v = frame.viewOffset;
    expectedCamera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
    const before = snapshot();
    const result = await view.captureTurntable({ ...options, width, pitchDeg: pitch }, () => {});
    expect(result).toEqual({ width, height: frame.height });
    expect(result.height % 2).toBe(0);
    for (const [index, rendered] of r.rendered.entries()) {
      expect(rendered.rotation).toEqual([pitch * Math.PI / 180, index * Math.PI / 2, 0, 'XYZ']);
      expect(rendered.viewOffset).toEqual(expectedCamera.view);
      expect(rendered.projectionMatrix).toEqual(expectedCamera.projectionMatrix.elements);
      expect(rendered.target).toMatchObject(result);
    }
    expect(snapshot()).toEqual(before);
  });

  it.each([true, false])('半透明像素先在線性空間還原預乘 alpha 再合成背景（WebGPU=%s）', async webgpu => {
    const view = await setup(webgpu), r = shared.renderer!;
    r.pixel = [100, 50, 25, 128];
    await view.captureTurntable(options, rgba => {
      const first = webgpu ? 0 : (r.rendered[0]!.target!.height - 1) * options.width * 4;
      // sRGB [100,50,25] 在線性空間除以 128/255 → [138,71,38]；再疊到 [26,44,92]。
      expect([...canvases[1]!.pixels.slice(first, first + 4)]).toEqual([138, 71, 38, 128]);
      expect([...rgba.slice(first, first + 4)]).toEqual([82, 58, 65, 255]);
    });
  });

  it('最後一格的非同步呼叫端取消：完成前仍拒絕並釋放 target', async () => {
    const view = await setup(), r = shared.renderer!, before = snapshot(), controller = new AbortController();
    let dispose: ReturnType<typeof vi.spyOn> | undefined;
    const deliver = vi.fn(async (_: Uint8ClampedArray, index: number) => {
      dispose ??= vi.spyOn(r.rendered[0]!.target!, 'dispose');
      await Promise.resolve();
      if (index === options.frames - 1) controller.abort();
    });
    await expect(view.captureTurntable(options, deliver, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deliver).toHaveBeenCalledTimes(options.frames);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(before);
  });

  it('高度超過 4096 時在建立畫布／target 前拒絕', async () => {
    const view = await setup();
    const createElement = vi.fn(() => { throw new Error('不應建立畫布'); });
    vi.stubGlobal('document', { createElement });
    await expect(view.captureTurntable({ ...options, width: 4096 }, vi.fn())).rejects.toThrow(/4096/);
    expect(createElement).not.toHaveBeenCalled();
    expect(shared.renderer!.rendered).toHaveLength(0);
    expect(shared.renderer!.read).not.toHaveBeenCalled();
  });

  it.each([
    { startTime: 0, timeSpan: 8, expected: [0, 2, 4, 6] },
    { startTime: -2, expected: [-2, -1, 0, 1] },
    { timeSpan: 2, expected: [12.5, 13, 13.5, 14] },
    { expected: [12.5, 13.5, 14.5, 15.5] },
  ])('效果時間遵守 startTime／timeSpan 及各自預設：%j', async ({ expected, ...timing }) => {
    const view = await setup(), r = shared.renderer!, before = snapshot();
    await view.captureTurntable({ ...options, ...timing }, () => {});
    expect(r.rendered.map(f => f.time)).toEqual(expected);
    expect(snapshot()).toEqual(before);
  });

  it('相同起始時間與整數週期的效果時間：畫面時鐘改變後再次擷取仍得到相同閃星時序', async () => {
    const view = await setup(), r = shared.renderer!;
    const timing = { ...options, startTime: 3, timeSpan: SPARKLE_PERIOD * 2 };
    await view.captureTurntable(timing, () => {});
    const firstTimes = r.rendered.map(f => f.time);
    r.loop!(40000);
    r.rendered.length = 0;
    await view.captureTurntable(timing, () => {});
    expect(r.rendered.map(f => f.time)).toEqual(firstTimes);
    firstTimes.forEach((time, index) => expect(time).toBe(3 + index * timing.timeSpan / timing.frames));
    expect(shared.card!.time).toBe(40);
  });

  it.each([true, false])('固定角度與時間、等待呼叫端、每格都先完整還原再讀回（WebGPU=%s）', async webgpu => {
    const view = await setup(webgpu), r = shared.renderer!;
    const camera = r.camera!;
    camera.setViewOffset(800, 500, 10, 20, 700, 450);
    r.target = { width: 1, height: 1, dispose() {} };
    const before = snapshot();
    const read = r.read.getMockImplementation()!;
    r.read.mockImplementation(async target => { expect(snapshot()).toEqual(before); return read(target); });
    const delivered: Uint8ClampedArray[] = [];
    const result = await view.captureTurntable(options, async (rgba, index) => {
      expect(snapshot()).toEqual(before);
      expect(r.rendered).toHaveLength(index + 1);
      await Promise.resolve();
      expect(r.rendered).toHaveLength(index + 1);
      expect(rgba).toHaveLength(r.rendered[0]!.target!.width * r.rendered[0]!.target!.height * 4);
      expect([...rgba.filter((_, i) => i % 4 === 3)].every(a => a === 255)).toBe(true);
      const first = webgpu ? 0 : (r.rendered[0]!.target!.height - 1) * options.width * 4;
      expect([...rgba.slice(first, first + 4)]).toEqual([200, 100, 50, 255]);
      delivered.push(rgba);
    });
    expect(result.width).toBe(8);
    expect(result.height).toBe(r.rendered[0]!.target!.height);
    expect(delivered).toHaveLength(4);
    expect(new Set(delivered).size).toBe(4);
    expect(new Set(r.rendered.map(f => f.target)).size).toBe(1);
    expect(r.rendered.map(f => f.view)).toEqual([[0, 17], [90, 17], [180, 17], [270, 17]]);
    expect(r.rendered.map(f => f.time)).toEqual([12.5, 13.5, 14.5, 15.5]);
    expect(r.rendered.map(f => f.stage)).toEqual([false, false, false, false]);
    expect(r.rendered[1]!.front).toEqual([[0.09, 0.017], [0, 0]]);
    expect(r.rendered[1]!.back).toEqual([[-0.09, -0.017]]);
    expect(canvases).toHaveLength(2);
    expect(canvases[0]!.stops).toEqual([[0, '#1a2c5c'], [0.55, '#0c1736'], [1, '#060b1b']]);
    expect(snapshot()).toEqual(before);
  });

  it('每格之間沿用正在顯示的動畫的新狀態，不把整圈起始狀態蓋回去', async () => {
    const view = await setup(), r = shared.renderer!;
    let latest = snapshot();
    const read = r.read.getMockImplementation()!;
    r.read.mockImplementation(async target => { expect(snapshot()).toEqual(latest); return read(target); });
    await view.captureTurntable(options, (_, index) => {
      view.setPose({ ...originalPose, yawDeg: 42 + index, pitchDeg: 3, zoom: 0.7 });
      r.loop!(20000 + index * 100);
      latest = snapshot();
    });
    expect(snapshot()).toEqual(latest);
    expect(shared.card!.view).toEqual([45, 3]);
    expect(shared.card!.time).toBe(20.3);
    expect(r.rendered.filter(f => f.target).map(f => f.time)).toEqual([12.5, 13.5, 14.5, 15.5]);
  });

  it('擷取期間改畫面縮放，輸出的鏡頭距離仍固定，畫面保留新的縮放', async () => {
    const view = await setup(), r = shared.renderer!, initialZ = r.camera!.position.z;
    await view.captureTurntable(options, () => {
      view.setPose({ ...originalPose, zoom: 1 });
      r.loop!(21000);
    });
    expect(r.rendered.filter(f => f.target).map(f => f.cameraZ)).toEqual(Array(4).fill(initialZ));
    expect(r.camera!.position.z).not.toBe(initialZ);
  });

  it('取消發生在非同步讀回期間：不交出畫格且還原狀態', async () => {
    const view = await setup(), r = shared.renderer!, before = snapshot(), controller = new AbortController();
    const read = r.read.getMockImplementation()!;
    r.read.mockImplementation(async target => { controller.abort(); return read(target); });
    const deliver = vi.fn();
    await expect(view.captureTurntable(options, deliver, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deliver).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('signal 已取消：不建畫布、不畫也不讀回', async () => {
    const view = await setup(), controller = new AbortController();
    controller.abort();
    await expect(view.captureTurntable(options, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(shared.renderer!.rendered).toHaveLength(0);
    expect(shared.renderer!.read).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
  });

  it('預設 pitch 0，還原原本停用的鏡頭 view offset', async () => {
    const view = await setup(), r = shared.renderer!;
    r.camera!.setViewOffset(800, 500, 10, 20, 700, 450);
    r.camera!.clearViewOffset();
    const before = snapshot();
    await view.captureTurntable({ ...options, pitchDeg: undefined }, () => {});
    expect(r.rendered.map(f => f.view)).toEqual([[0, 0], [90, 0], [180, 0], [270, 0]]);
    expect(snapshot()).toEqual(before);
  });

  it('非同步呼叫端失敗：不再畫下一格並保留原錯誤', async () => {
    const view = await setup(), before = snapshot(), error = new Error('async callback');
    await expect(view.captureTurntable(options, async () => { throw error; })).rejects.toBe(error);
    expect(shared.renderer!.rendered).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });

  it('中途取消：下一格不畫，釋放 target 且還原狀態', async () => {
    const view = await setup(), before = snapshot(), controller = new AbortController();
    const deliver = vi.fn(() => controller.abort());
    await expect(view.captureTurntable(options, deliver, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(shared.renderer!.rendered).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });

  it.each(['offsets', 'render', 'read', 'callback'] as const)('%s 失敗也還原狀態、釋放 target、原錯誤 reject', async phase => {
    const view = await setup(), r = shared.renderer!, before = snapshot();
    const error = new Error(phase);
    const render = r.render.bind(r);
    let dispose: ReturnType<typeof vi.spyOn> | undefined;
    vi.spyOn(r, 'setRenderTarget').mockImplementation(target => {
      r.target = target;
      if (target && target !== before.target && !dispose) dispose = vi.spyOn(target, 'dispose');
    });
    if (phase === 'render') vi.spyOn(r, 'render').mockImplementation((s, c) => { render(s, c); throw error; });
    if (phase === 'read') r.read.mockRejectedValue(error);
    const opts = phase === 'offsets' ? { ...options, offsetsAt: () => { throw error; } } : options;
    await expect(view.captureTurntable(opts, () => { if (phase === 'callback') throw error; })).rejects.toBe(error);
    expect(snapshot()).toEqual(before);
    if (phase !== 'offsets') expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    { width: 0 }, { width: 4097 }, { width: 1.5 }, { frames: 1 }, { frames: 2.5 },
    { frames: Infinity }, { seconds: 0 }, { seconds: NaN }, { seconds: Infinity }, { pitchDeg: NaN },
    { timeSpan: 0 }, { timeSpan: -1 }, { timeSpan: NaN }, { timeSpan: Infinity },
    { startTime: NaN }, { startTime: Infinity },
  ])('無效參數 %j：畫之前拒絕', async invalid => {
    const view = await setup();
    await expect(view.captureTurntable({ ...options, ...invalid }, vi.fn())).rejects.toThrow();
    expect(shared.renderer!.rendered).toHaveLength(0);
    expect(canvases).toHaveLength(0);
  });
});

describe('破框層的取景（T-411c）', () => {
  /** 畫一格（時間 ms），回這一格的鏡頭距離。 */
  const frame = (ms: number) => {
    const r = shared.renderer!;
    r.loop!(ms);
    return r.camera!.position.z;
  };
  const reach = { x: 0.74, y: 1.6 };
  const full = () => cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.standard), reach);

  it('拖曳中（holdFraming）鏡頭完全不動：進行中的取景動畫也停住；放開後才繼續退到新的範圍', async () => {
    const view = await setup();
    const z0 = frame(12516);
    expect(z0).toBeCloseTo(cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.standard)), 9);
    // 打開破框：開始往後退
    shared.card!.reachValue = reach;
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    // 退到一半（範圍先要超過卡片自己的外接球，鏡頭才開始退）
    let zMoving = z0;
    for (let i = 1; i <= 6; i++) zMoving = frame(12516 + i * 16);
    expect(zMoving).toBeGreaterThan(z0 + 0.3);
    expect(zMoving).toBeLessThan(full() - 0.3);
    // 這時開始拖圖層：之後 10 格鏡頭一點都不動（修之前會一路退到底，拖曳的點跟著飄）
    view.holdFraming(true);
    for (let i = 7; i <= 16; i++) expect(frame(12516 + i * 16)).toBe(zMoving);
    // 放開：繼續退到底
    view.holdFraming(false);
    let z = zMoving;
    for (let i = 17; i <= 90; i++) z = frame(12516 + i * 16);
    expect(z).toBeCloseTo(full(), 6);
  });

  it('拖曳中 setCard 的新範圍先不採用；放開時直接用最新的範圍（不用等下一次 setCard）', async () => {
    const view = await setup();
    const z0 = frame(12516);
    view.holdFraming(true);
    shared.card!.reachValue = reach;
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    for (let i = 1; i <= 10; i++) expect(frame(12516 + i * 16)).toBe(z0);
    view.holdFraming(false);
    let z = z0;
    for (let i = 11; i <= 80; i++) z = frame(12516 + i * 16);
    expect(z).toBeCloseTo(full(), 6);
  });
});

describe('展示廳的取景（T-410b）', () => {
  const frame = (ms: number) => {
    const r = shared.renderer!;
    r.loop!(ms);
    return r.camera!.position.z;
  };
  /** 跑 n 格（取景動畫約 0.25 秒到位），回最後的鏡頭距離。 */
  const settle = (start: number, n = 80) => {
    let z = 0;
    for (let i = 1; i <= n; i++) z = frame(start + i * 16);
    return z;
  };
  const plain = () => cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.standard));

  it('只有展示廳把鏡頭拉遠 GALLERY_PULLBACK 倍；全息光環、關閉照舊；換回來就回到原本的距離', async () => {
    const view = await setup();
    expect(frame(12516)).toBeCloseTo(plain(), 9);
    view.setStage('halo');
    expect(settle(12600)).toBeCloseTo(plain(), 9);
    view.setStage('none');
    expect(settle(14000)).toBeCloseTo(plain(), 9);
    view.setStage('gallery');
    const zGallery = settle(16000);
    expect(zGallery / plain()).toBeCloseTo(GALLERY_PULLBACK, 6);
    view.setStage('halo');
    expect(settle(18000)).toBeCloseTo(plain(), 6);
  });

  it('三個新場景（T-415）：只有水鏡把鏡頭退 WATER_PULLBACK 倍（倒影看得到）；魔法陣、星雲照舊', async () => {
    const view = await setup();
    expect(frame(12516)).toBeCloseTo(plain(), 9);
    view.setStage('magic');
    expect(settle(12600)).toBeCloseTo(plain(), 9);
    view.setStage('nebula');
    expect(settle(14000)).toBeCloseTo(plain(), 9);
    view.setStage('water');
    expect(settle(16000) / plain()).toBeCloseTo(WATER_PULLBACK, 6);
    view.setCard({ aspect: 'tarot' } as Card, () => undefined);
    expect(settle(18000) / cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.tarot))).toBeCloseTo(WATER_PULLBACK, 6);
    view.setStage('magic');
    expect(settle(20000)).toBeCloseTo(cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.tarot)), 6);
  });

  it('還沒畫第一格前就選展示廳：直接到位（打開工坊不會看到鏡頭在退）', async () => {
    shared.webgpu = true;
    const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement,
      { plainBack: {} as HTMLImageElement, pedestal: {} as HTMLImageElement, frameCorner: {} as HTMLImageElement });
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    view.setPose(originalPose);
    view.setStage('gallery');
    expect(shared.renderer!.camera ?? null).toBeNull(); // 還沒畫
    view.start(() => {});
    expect(frame(1000) / plain()).toBeCloseTo(GALLERY_PULLBACK, 9);
  });

  it('破框層要的範圍比展示廳大時用破框層的（取兩者較大的）', async () => {
    const view = await setup();
    const big = { x: 0.74, y: 1.6 };
    shared.card!.reachValue = big;
    view.setStage('gallery');
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    const z = settle(12600);
    expect(z).toBeCloseTo(cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.standard), big), 6);
    expect(z).toBeGreaterThan(cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.standard), galleryReach(ASPECT_HEIGHT.standard)));
  });

  it('換比例時用新比例的展示廳取景', async () => {
    const view = await setup();
    view.setStage('gallery');
    view.setCard({ aspect: 'tarot' } as Card, () => undefined);
    const z = settle(12600);
    expect(z / cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.tarot))).toBeCloseTo(GALLERY_PULLBACK, 6);
  });
});

describe('選中反光層時的斜線（T-417）', () => {
  it('flashFoil：影格迴圈照 foilFlashLevel 亮起、約 1 秒後回 0；換另一面時先關掉原本那一面', async () => {
    const view = await setup();
    const r = shared.renderer!, c = shared.card!;
    view.flashFoil('front');
    r.loop!(13000); // 開始
    expect(c.flash.front).toBe(0);
    r.loop!(13400);
    expect(c.flash.front).toBe(1);
    view.flashFoil('back');
    expect(c.flash.front).toBe(0);
    r.loop!(13500);
    r.loop!(13900);
    expect(c.flash.back).toBe(1);
    r.loop!(15000);
    expect(c.flash.back).toBe(0);
    r.loop!(15100);
    expect(c.flash).toEqual({ front: 0, back: 0 });
  });

  it('閃著的時候擷取（PNG、縮圖、轉動匯出、capture）：畫的那一格沒有斜線，畫完立刻恢復', async () => {
    const view = await setup();
    const r = shared.renderer!, c = shared.card!;
    view.flashFoil('front');
    r.loop!(13000);
    r.loop!(13400);
    expect(c.flash.front).toBe(1);
    r.rendered.length = 0;
    await view.captureCard({ width: 8, transparent: true, pose: 'front' });
    await view.captureTurntable(options, () => {});
    await view.capture();
    expect(r.rendered.length).toBeGreaterThan(2);
    for (const f of r.rendered) expect(f.flash).toEqual({ front: 0, back: 0 });
    expect(c.flash.front).toBe(1);
  });
});

describe('透明卡套（T-806）：擷取照選項畫不畫、裁切包住卡套', () => {
  it('卡片開著卡套：PNG 給 sleeve true＝畫、裁切變大（同樣寬度下卡片比較小）；沒給（縮圖）＝那一格藏起來、畫完恢復', async () => {
    const view = await setup();
    const r = shared.renderer!, c = shared.card!;
    c.sleeveOn = true;
    await view.captureCard({ width: 8, transparent: true, pose: 'current' });
    const plain = r.rendered.at(-1)!;
    expect(plain.sleeve).toBe(false);
    expect(c.sleeveShown).toBe(true);
    await view.captureCard({ width: 8, transparent: true, pose: 'current', sleeve: true });
    const withSleeve = r.rendered.at(-1)!;
    expect(withSleeve.sleeve).toBe(true);
    expect(withSleeve.viewOffset!.fullWidth).toBeLessThan(plain.viewOffset!.fullWidth);
    await view.captureCard({ width: 8, transparent: false, pose: 'front' });
    expect(r.rendered.at(-1)!.sleeve).toBe(false);
    expect(c.sleeveShown).toBe(true);
  });

  it('卡片沒開卡套：給 sleeve true 也不畫，裁切和沒給一模一樣', async () => {
    const view = await setup();
    const r = shared.renderer!;
    await view.captureCard({ width: 8, transparent: true, pose: 'current' });
    const a = r.rendered.at(-1)!;
    await view.captureCard({ width: 8, transparent: true, pose: 'current', sleeve: true });
    const b = r.rendered.at(-1)!;
    expect(b.sleeve).toBe(false);
    expect(b.viewOffset).toEqual(a.viewOffset);
  });

  it('轉一圈：sleeve true 每一格都畫、整圈裁切包住卡套；沒給每一格都不畫；capture() 照畫面', async () => {
    const view = await setup();
    const r = shared.renderer!, c = shared.card!;
    c.sleeveOn = true;
    await view.captureTurntable(options, () => {});
    expect(r.rendered.every((f) => !f.sleeve)).toBe(true);
    const plainOffset = r.rendered.at(-1)!.viewOffset!;
    r.rendered.length = 0;
    await view.captureTurntable({ ...options, sleeve: true }, () => {});
    expect(r.rendered).toHaveLength(options.frames);
    expect(r.rendered.every((f) => f.sleeve)).toBe(true);
    expect(r.rendered.at(-1)!.viewOffset!.fullWidth).toBeLessThan(plainOffset.fullWidth);
    expect(c.sleeveShown).toBe(true);
    await view.capture();
    expect(r.rendered.at(-1)!.sleeve).toBe(true);
  });
});

describe('卡片比例與透明卡套的取景（T-807）', () => {
  const frame = (ms: number) => {
    const r = shared.renderer!;
    r.loop!(ms);
    return r.camera!.position.z;
  };
  const settle = (start: number, n = 80) => {
    let z = 0;
    for (let i = 1; i <= n; i++) z = frame(start + i * 16);
    return z;
  };
  const distance = (box: FrameBox, reach?: { x: number; y: number }) => cameraDistance(30, 800 / 500, originalPose.zoom, box, reach);

  it('自訂比例（橫式 3:2）、正方形：鏡頭照 aspectHeight 的卡高退；換回標準卡就回來', async () => {
    const view = await setup();
    view.setCard({ aspect: 'custom', customAspect: { width: 3, height: 2 } } as Card, () => undefined);
    expect(frame(12516)).toBeCloseTo(distance(cardBox(2 / 3)), 9);
    view.setCard({ aspect: 'square' } as Card, () => undefined);
    expect(frame(12532)).toBeCloseTo(distance(cardBox(1)), 9);
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    expect(frame(12548)).toBeCloseTo(distance(cardBox(ASPECT_HEIGHT.standard)), 9);
  });

  it('水鏡的取景：換比例時第一格就到位（不緩動；長卡 1:2 ↔ 橫卡 2:1 兩個方向，T-807 審查）', async () => {
    const view = await setup();
    view.setStage('water');
    view.setCard({ aspect: 'custom', customAspect: { width: 1, height: 2 } } as Card, () => undefined);
    const tall = settle(12600);
    view.setCard({ aspect: 'custom', customAspect: { width: 2, height: 1 } } as Card, () => undefined);
    const wideFirst = frame(12600 + 81 * 16);
    const wideSettled = settle(12600 + 81 * 16);
    expect(wideFirst).toBeCloseTo(wideSettled, 6);
    expect(wideFirst).not.toBeCloseTo(tall, 3);
    view.setCard({ aspect: 'custom', customAspect: { width: 1, height: 2 } } as Card, () => undefined);
    expect(frame(12600 + 200 * 16)).toBeCloseTo(tall, 6);
  });

  it('展示廳的取景也照自訂比例', async () => {
    const view = await setup();
    view.setStage('gallery');
    view.setCard({ aspect: 'custom', customAspect: { width: 3, height: 2 } } as Card, () => undefined);
    expect(settle(12600) / distance(cardBox(2 / 3))).toBeCloseTo(GALLERY_PULLBACK, 6);
  });

  it('T-806 加做：開著卡套時鏡頭照卡套外框退（約多 5%），關掉就回來', async () => {
    const view = await setup();
    const plain = distance(cardBox(ASPECT_HEIGHT.standard));
    expect(frame(12516)).toBeCloseTo(plain, 9);
    shared.card!.sleeveOn = true;
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    const z = frame(12532);
    expect(z).toBeCloseTo(distance(sleeveBounds(shared.card!.outline())), 9);
    expect(z / plain).toBeGreaterThan(1.03);
    expect(z / plain).toBeLessThan(1.07);
    shared.card!.sleeveOn = false;
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    expect(frame(12548)).toBeCloseTo(plain, 9);
  });

  it('卡套＋展示廳：取兩者較大的（展示廳退得比卡套多）', async () => {
    const view = await setup();
    shared.card!.sleeveOn = true;
    view.setStage('gallery');
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    const z = settle(12600);
    expect(z).toBeCloseTo(distance(sleeveBounds(shared.card!.outline()), galleryReach(ASPECT_HEIGHT.standard)), 6);
    expect(z).toBeGreaterThanOrEqual(distance(sleeveBounds(shared.card!.outline())) - 1e-9);
  });
});

// T-809 效能自動降級（DESIGN §8.4）：預覽可以降像素比、關景深陰影（setPreviewQuality）；擷取（PNG、縮圖、轉動匯出、capture）一律完整畫質
describe('預覽畫質（T-809）：降像素比、關景深陰影，擷取不受影響', () => {
  const withRatio = (ratio: number) =>
    vi.stubGlobal('window', { devicePixelRatio: ratio, matchMedia: () => ({ matches: false, addEventListener() {} }) });

  it('沒降級：像素比＝螢幕的（最多 2），影子開著，和 T-809 以前一樣', async () => {
    withRatio(3);
    await setup();
    expect(shared.renderer!.pixelRatios).toEqual([2]);
    expect(shared.card!.shadowsOn()).toBe(true);
    shared.renderer!.loop!(13000);
    expect(shared.renderer!.rendered.at(-1)!.shadows).toBe(true);
  });

  it('像素比上限：1.25、1 都生效（取螢幕與上限較小的）；回到 Infinity 又恢復完整；沒變不重設（不白白重建畫布）', async () => {
    withRatio(2);
    const view = await setup();
    const r = shared.renderer!;
    expect(r.pixelRatios).toEqual([2]);
    view.setPreviewQuality({ pixelRatioCap: 1.25, shadows: true });
    view.setPreviewQuality({ pixelRatioCap: 1.25, shadows: false });
    expect(r.pixelRatios).toEqual([2, 1.25]);
    view.setPreviewQuality({ pixelRatioCap: 1, shadows: false });
    expect(r.pixelRatios).toEqual([2, 1.25, 1]);
    view.setPreviewQuality({ pixelRatioCap: Number.POSITIVE_INFINITY, shadows: true });
    expect(r.pixelRatios).toEqual([2, 1.25, 1, 2]);
    view.setPreviewQuality({ pixelRatioCap: Number.POSITIVE_INFINITY, shadows: true });
    expect(r.pixelRatios).toEqual([2, 1.25, 1, 2]);
  });

  it('螢幕本來就是 1 倍：上限 1.25 沒有實際差別，不重設像素比；降到 1 也一樣', async () => {
    withRatio(1);
    const view = await setup();
    const r = shared.renderer!;
    view.setPreviewQuality({ pixelRatioCap: 1.25, shadows: true });
    view.setPreviewQuality({ pixelRatioCap: 1, shadows: false });
    expect(r.pixelRatios).toEqual([1]);
  });

  it('不合理的上限（0、負數、NaN）當作不限制，不會把畫布縮成 0', async () => {
    withRatio(2);
    const view = await setup();
    const r = shared.renderer!;
    view.setPreviewQuality({ pixelRatioCap: 1, shadows: true });
    for (const cap of [0, -1, Number.NaN]) {
      view.setPreviewQuality({ pixelRatioCap: cap, shadows: true });
      expect(r.pixelRatios.at(-1)).toBe(2);
      view.setPreviewQuality({ pixelRatioCap: 1, shadows: true });
    }
  });

  it('預覽關影子：影格迴圈畫的每一格都沒有影子；開回來又有', async () => {
    const view = await setup();
    const r = shared.renderer!;
    view.setPreviewQuality({ pixelRatioCap: 1.25, shadows: false });
    r.loop!(13000);
    r.loop!(13016);
    expect(r.rendered.map((f) => f.shadows)).toEqual([false, false]);
    view.setPreviewQuality({ pixelRatioCap: Number.POSITIVE_INFINITY, shadows: true });
    r.loop!(13032);
    expect(r.rendered.at(-1)!.shadows).toBe(true);
  });

  it('降級中擷取（PNG 現在角度／縮圖正面／轉一圈／capture）：畫的那一格都是完整影子，畫完立刻放回預覽的設定', async () => {
    withRatio(2);
    const view = await setup();
    const r = shared.renderer!, c = shared.card!;
    view.setPreviewQuality({ pixelRatioCap: 1, shadows: false });
    r.rendered.length = 0;
    r.pixelRatios.length = 0;
    await view.captureCard({ width: 8, transparent: true, pose: 'current' });
    await view.captureCard({ width: 8, transparent: false, pose: 'front' });
    await view.captureTurntable(options, () => {});
    await view.captureTurntable({ ...options, motion: 'swing' }, () => {});
    await view.capture();
    expect(r.rendered).toHaveLength(2 + options.frames * 2 + 1);
    expect(r.rendered.every((f) => f.shadows)).toBe(true);
    expect(c.shadowsOn()).toBe(false);
    r.loop!(13000);
    expect(r.rendered.at(-1)!.shadows).toBe(false);
    // 擷取不碰畫布的像素比
    expect(r.pixelRatios).toEqual([]);
  });

  it('擷取失敗（讀回丟錯）也把影子放回預覽的設定', async () => {
    const view = await setup();
    const r = shared.renderer!, c = shared.card!;
    view.setPreviewQuality({ pixelRatioCap: 1, shadows: false });
    r.read.mockRejectedValueOnce(new Error('GPU 讀不回來'));
    await expect(view.captureCard({ width: 8, transparent: true, pose: 'current' })).rejects.toThrow();
    expect(c.shadowsOn()).toBe(false);
  });

  it('capture() 的大小照完整像素比算（不因為預覽降到 1 倍就變小）', async () => {
    withRatio(2);
    const view = await setup();
    view.setPreviewQuality({ pixelRatioCap: 1, shadows: false });
    canvases.length = 0;
    await view.capture();
    expect([canvases[0]!.width, canvases[0]!.height]).toEqual([1600, 1000]);
  });
});

describe('CD 光碟（T-810）：鏡頭、擷取的裁切、點選照光碟', () => {
  const discCard = { aspect: 'square', kind: 'disc' } as Card;
  const frame = (ms: number) => {
    const r = shared.renderer!;
    r.loop!(ms);
    return r.camera!.position.z;
  };

  it('鏡頭照整片光碟的盒子退（discBox）；換回卡片就回來', async () => {
    const view = await setup();
    view.setCard(discCard, () => undefined);
    expect(frame(12516)).toBeCloseTo(cameraDistance(30, 800 / 500, originalPose.zoom, discBox()), 9);
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    expect(frame(12532)).toBeCloseTo(cameraDistance(30, 800 / 500, originalPose.zoom, cardBox(ASPECT_HEIGHT.standard)), 9);
  });

  it('擷取的裁切包住整片光碟（discBox），和卡片輪廓無關', async () => {
    const view = await setup();
    view.setCard(discCard, () => undefined);
    await view.captureCard({ width: 8, transparent: true, pose: 'front' });
    const r = shared.renderer!;
    const camera = r.camera!;
    const got = r.rendered.at(-1)!.viewOffset!;
    const want = captureFrame(
      { vFovDeg: 30, viewAspect: camera.aspect, cameraZ: camera.position.z, yawDeg: 0, pitchDeg: 0, outline: shared.card!.outline(), thickness: DISC_THICKNESS, bounds: discBox() },
      8,
    ).viewOffset;
    expect(got.fullWidth).toBeCloseTo(want.fullWidth, 9);
    expect(got.height).toBe(want.height);
  });

  it('點選：中間那一圈（透明圈與孔）點不到卡面；印刷面上照常', async () => {
    const view = await setup();
    view.setCard(discCard, () => undefined);
    view.setPose({ ...originalPose, yawDeg: 0, pitchDeg: 0 });
    (shared.renderer!.domElement as { getBoundingClientRect?: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
    expect(view.hitTest(400, 250)).toBe(null);
    const p = view.projectCardPoint('front', 0.3, 0)!;
    expect(view.hitTest(p.x, p.y)?.x).toBeCloseTo(0.3, 6);
  });
});
