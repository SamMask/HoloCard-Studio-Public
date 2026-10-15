// 減少動態效果（T-608，DESIGN §8.3）在 3D 畫面這一邊：用假的 matchMedia（matches 可切換、會發 change）建 createCardView，
// 確認閃星停在固定的亮點（卡片的效果時間停住）、取景（破框層、展示廳／水鏡退鏡頭）直接到位、縮放直接到位、
// 舞台收到減少動態；設定改了（change）不用重新整理，下一格就跟著變。GPU 用假的，鏡頭是真的 three.js。
import { Group, PerspectiveCamera, Vector2 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASPECT_HEIGHT, type Card } from '../src/model/types';
import { createCardView, type CardPose } from '../src/render/card-view';
import { cameraDistance, cardBox, cardOutline } from '../src/render/fit';
import { GALLERY_PULLBACK } from '../src/render/gallery-layout';
import { WATER_PULLBACK } from '../src/render/water-layout';

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
// 舞台換成假的（記下收到的減少動態）；取景（stageReach）用真的
vi.mock('../src/render/stage-switch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/stage-switch')>()),
  createStageSwitch: () => (shared.stage = new FakeStage()),
}));

class FakeCard {
  group = new Group();
  time = 0;
  flash = { front: 0, back: 0 };
  reachValue: { x: number; y: number } | null = null;
  outline = () => cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = () => [] as Vector2[];
  reach = () => this.reachValue;
  sleeve = () => false;
  breakoutBoxes = () => [];
  breakoutAt = () => null;
  update() {}
  setTime(time: number) {
    this.time = time;
  }
  setView() {}
  setFlash(face: 'front' | 'back', level: number) {
    this.flash[face] = level;
  }
}

class FakeStage {
  group = new Group();
  reduced: boolean[] = [];
  setReducedMotion(r: boolean) {
    this.reduced.push(r);
  }
  setCardHeight() {}
  setPose() {}
  setStyle() {}
  setThumbs() {}
  update() {}
  hidden(draw: () => void) {
    draw();
  }
}

class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = {};
  camera: PerspectiveCamera | null = null;
  loop: ((time: number) => void) | null = null;
  init = async () => {};
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  setAnimationLoop(loop: (time: number) => void) {
    this.loop = loop;
  }
  getRenderTarget = () => null;
  setRenderTarget() {}
  render(_scene: unknown, camera: PerspectiveCamera) {
    this.camera = camera;
  }
}

/** 假的 MediaQueryList：matches 可以切換，切換時發 change。 */
class FakeMedia {
  private listeners = new Set<(e: { matches: boolean }) => void>();
  constructor(public matches: boolean) {}
  addEventListener(type: string, fn: (e: { matches: boolean }) => void) {
    if (type === 'change') this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: (e: { matches: boolean }) => void) {
    if (type === 'change') this.listeners.delete(fn);
  }
  set(next: boolean) {
    this.matches = next;
    for (const fn of this.listeners) fn({ matches: next });
  }
}

const QUERY = '(prefers-reduced-motion: reduce)';
let media: FakeMedia;

beforeEach(() => {
  media = new FakeMedia(false);
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    matchMedia: (q: string) => (q === QUERY ? media : new FakeMedia(false)),
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
});
afterEach(() => vi.unstubAllGlobals());

const pose: CardPose = { yawDeg: 20, pitchDeg: -8, zoom: 0.85, front: [], back: [] };
const ASPECT = 800 / 500;
const plain = (zoom = pose.zoom) => cameraDistance(30, ASPECT, zoom, cardBox(ASPECT_HEIGHT.standard));

async function setup(reduced: boolean) {
  media.matches = reduced;
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement, {
    plainBack: {} as HTMLImageElement,
    pedestal: {} as HTMLImageElement,
    frameCorner: {} as HTMLImageElement,
  });
  view.setCard({ aspect: 'standard' } as Card, () => undefined);
  view.setPose(pose);
  view.start(() => {});
  frame(10000);
  return view;
}

/** 畫一格（時間 ms），回這一格的鏡頭距離。 */
function frame(ms: number): number {
  const r = shared.renderer!;
  r.loop!(ms);
  return r.camera!.position.z;
}

describe('閃星不閃爍：停在固定的亮點', () => {
  it('減少動態：每一格交給卡片的效果時間都一樣（閃星與斜線不動）；沒設時照時間走', async () => {
    await setup(true);
    const times = [10016, 10500, 12000, 19000].map((ms) => {
      frame(ms);
      return shared.card!.time;
    });
    expect(new Set(times).size).toBe(1);

    await setup(false);
    frame(10016);
    const t1 = shared.card!.time;
    frame(12000);
    expect(shared.card!.time).toBeCloseTo(t1 + (12000 - 10016) / 1000, 9);
  });

  it('減少動態時選中反光層：斜線照樣在約 1 秒後收掉（時間停住不影響它結束）', async () => {
    const view = await setup(true);
    const c = shared.card!;
    view.flashFoil('front');
    frame(13000);
    frame(13400);
    expect(c.flash.front).toBe(1);
    frame(15000);
    expect(c.flash.front).toBe(0);
  });
});

describe('鏡頭換位置直接到位', () => {
  it('換到展示廳、水鏡：下一格就退到位（不緩動）；換回全息光環也一格就回來', async () => {
    const view = await setup(true);
    expect(frame(10016)).toBeCloseTo(plain(), 9);
    view.setStage('gallery');
    expect(frame(10032) / plain()).toBeCloseTo(GALLERY_PULLBACK, 9);
    view.setStage('water');
    expect(frame(10048) / plain()).toBeCloseTo(WATER_PULLBACK, 9);
    view.setStage('halo');
    expect(frame(10064)).toBeCloseTo(plain(), 9);
  });

  it('對照：沒設減少動態時，一格還沒退到位（約 0.25 秒平順地退過去）', async () => {
    const view = await setup(false);
    view.setStage('gallery');
    expect(frame(10016) / plain()).toBeLessThan(GALLERY_PULLBACK - 0.01);
    let z = 0;
    for (let i = 2; i <= 80; i++) z = frame(10000 + i * 16);
    expect(z / plain()).toBeCloseTo(GALLERY_PULLBACK, 6);
  });

  it('破框層的取景：範圍變了下一格就到位；拖曳中（holdFraming）照舊不動，放開下一格就到位', async () => {
    const view = await setup(true);
    const reach = { x: 0.74, y: 1.6 };
    const full = cameraDistance(30, ASPECT, pose.zoom, cardBox(ASPECT_HEIGHT.standard), reach);
    shared.card!.reachValue = reach;
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    expect(frame(10016)).toBeCloseTo(full, 9);

    shared.card!.reachValue = null;
    view.holdFraming(true);
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    expect(frame(10032)).toBeCloseTo(full, 9);
    view.holdFraming(false);
    expect(frame(10048)).toBeCloseTo(plain(), 9);
  });

  it('縮放：換了 zoom 那一格就到位（滾輪、PageUp／PageDown 都不緩動）', async () => {
    const view = await setup(true);
    view.setPose({ ...pose, zoom: 0.5 });
    expect(frame(10016)).toBeCloseTo(plain(0.5), 9);
    view.setPose({ ...pose, zoom: 1 });
    expect(frame(10032)).toBeCloseTo(plain(1), 9);
  });
});

describe('設定改了（change）不用重新整理就跟著變', () => {
  it('開始時就是減少動態：舞台一建好就收到', async () => {
    await setup(true);
    expect(shared.stage!.reduced).toEqual([true]);
  });

  it('打開減少動態 → 舞台靜止、效果時間停住、取景直接到位；再關掉 → 恢復照時間走、平順地退', async () => {
    const view = await setup(false);
    expect(shared.stage!.reduced).toEqual([false]);

    media.set(true);
    expect(shared.stage!.reduced).toEqual([false, true]);
    frame(10016);
    const still = shared.card!.time;
    frame(11000);
    expect(shared.card!.time).toBe(still);
    view.setStage('gallery');
    expect(frame(11016) / plain()).toBeCloseTo(GALLERY_PULLBACK, 9);

    media.set(false);
    expect(shared.stage!.reduced).toEqual([false, true, false]);
    frame(12000);
    const t1 = shared.card!.time;
    frame(12500);
    expect(shared.card!.time).toBeCloseTo(t1 + 0.5, 9);
    // 破框層要很大的範圍：一格還沒退到位（又是平順地退）
    const reach = { x: 0.74, y: 1.6 };
    const full = cameraDistance(30, ASPECT, pose.zoom, cardBox(ASPECT_HEIGHT.standard), reach);
    shared.card!.reachValue = reach;
    view.setCard({ aspect: 'standard' } as Card, () => undefined);
    expect(frame(12516)).toBeLessThan(full - 0.3);
  });
});
