// T-827／T-827c 擷取前先等著色程式編譯好。假 GPU（同 render-card-view-horizon.test.ts 的做法），假 renderer 學 three.js 的真行為：
//   - renderer.render 不等新的著色程式編譯完：材質換了、編譯還沒完成就畫，畫出來是舊的（stale）；
//   - renderer.compileAsync 的同步前半段（排出要編譯的東西）就認定「當下」的 render target、鏡頭、哪些東西看得見，
//     之後的編譯是非同步的（期間畫面的影格迴圈照畫、使用者可以拖角度、縮放、換卡）。
// 檢查真的入口（captureCard 目前／正面／畫卡套、capture()、captureTurntable 一般／畫卡套），一般舞台與水鏡（地平線 0）各一輪：
//   1. 每次擷取在 render 之前都 compileAsync 過、而且等它完成；材質剛換、立刻擷取＝不會畫到舊的；
//   2. 編譯的是擷取那一份：同一個 render target、擷取的鏡頭（完整裁切值、位置）、卡片旋轉、舞台不畫、卡套照選項，和之後畫的一模一樣；
//   3. 編譯等待的期間畫面是正常的（render target、鏡頭完整狀態、舞台、卡套都已還原），而且期間真的跑一格預覽影格也畫在畫面上；
//   4. 編譯丟錯（同步或非同步）：擷取失敗、鏡頭／render target／舞台都還原，之後還能擷取；
//   5. T-827c：編譯等待的期間姿態、縮放、視窗大小、破框層變了 → 裁切與輸出大小照「畫之前那一刻」算（和等一下再擷取一樣），不拿舊裁切框拍新姿態；
//      等待期間換了材質 → 畫之前再編譯一次（最多 2 次，之後照畫）；
//   6. T-827c：render target 在成功、同步丟錯、非同步拒絕、中途換了大小（換掉的那個）時，每一個都釋放一次。
import { Group, RenderTarget, Vector2, type PerspectiveCamera } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MIST_WATER_LOOK } from '../src/model/limits';
import { ASPECT_HEIGHT, type Card } from '../src/model/types';
import { createCardView, type CardPose } from '../src/render/card-view';
import { cardOutline } from '../src/render/fit';
import type { FaceBox } from '../src/render/pick';
import { SoftCanvas, SoftImageData } from './fake-canvas2d';

const shared = vi.hoisted(() => ({
  renderer: null as FakeRenderer | null,
  stage: null as FakeStage | null,
  card: null as FakeCard | null,
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
  /** 材質的版本：換材質（加特效、換卡片風格…）就加一，著色程式要重新編譯。 */
  materials = 1;
  /** 卡套現在畫不畫（withoutSleeve 期間是 false）。 */
  sleeveShown = true;
  /** 假的破框層：不是空的話，擷取的取景會把它包進去（位置跟著目前的視差位移走）。 */
  breakout: FaceBox[] = [];
  outline = () => cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => (face === 'front' ? this.front : this.back);
  reach = () => null;
  breakoutBoxes = (face: 'front' | 'back', offsets?: { x: number; y: number }[]) =>
    this.breakout
      .filter((b) => b.face === face)
      .map((b) => {
        const o = offsets?.[0] ?? this.offsets(face)[0]!;
        return { face, box: { left: b.box.left + o.x, right: b.box.right + o.x, bottom: b.box.bottom + o.y, top: b.box.top + o.y } };
      });
  breakoutAt = () => null;
  update() {}
  setTime() {}
  setView() {}
  setFlash() {}
  sleeve = () => true;
  withoutSleeve(draw: () => void) {
    const before = this.sleeveShown;
    this.sleeveShown = false;
    try {
      draw();
    } finally {
      this.sleeveShown = before;
    }
  }
  setShadows() {}
  withFullShadows(draw: () => void) {
    draw();
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
    const was = this.group.visible;
    this.group.visible = false;
    try {
      draw();
    } finally {
      this.group.visible = was;
    }
  }
  setBackdrop() {}
  setWaterScene() {}
  setFarPan() {}
  setGalleryHall() {}
  setWaterLook() {}
}

/** 呼叫當下的樣子：render target 大小、鏡頭（完整 view offset 值、位置、aspect）、卡片旋轉、舞台、卡套。 */
interface Snapshot {
  target: RenderTarget | null;
  size: [number, number] | null;
  /** view offset 開著時的完整值（沒開＝null；關著的 view 留著上一次的舊數字，不算）。 */
  view: { fullWidth: number; fullHeight: number; offsetX: number; offsetY: number; width: number; height: number } | null;
  camY: number;
  camZ: number;
  aspect: number;
  rotation: number[];
  stage: boolean;
  sleeve: boolean;
}

class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }) };
  target: RenderTarget | null = null;
  camera: PerspectiveCamera | null = null;
  loop: ((time: number) => void) | null = null;
  clock = 0;
  /** 正在跑預覽影格（setAnimationLoop 的回呼）：這時的 render 記在 previewRendered，不算擷取。 */
  inFrame = false;
  /** 發生順序：'compile:start'、'compile:pending'（編譯等待中途）、'compile:done'、'render'、'read'。 */
  log: string[] = [];
  compileStart: Snapshot[] = [];
  compilePending: Snapshot[] = [];
  rendered: (Snapshot & { stale: boolean })[] = [];
  previewRendered: Snapshot[] = [];
  /** 擷取用過（設成 render target）的 target，不含畫面（null）。 */
  seenTargets = new Set<RenderTarget>();
  /** 已經編譯完成的材質版本（render 時比對 card.materials：不一樣＝畫到舊的）。 */
  compiledMaterials = 1;
  /** 失敗注入：下一次 compileAsync 丟錯（sync＝同步丟、async＝回傳被拒絕的 Promise）。 */
  compileError: { mode: 'sync' | 'async'; error: Error } | null = null;
  compileCalls = 0;
  /** 編譯等待中途做的事（參數＝這是第幾次 compileAsync，從 1 數）：使用者在這時拖角度、縮放、改視窗、換卡。 */
  duringCompile: ((n: number) => void) | null = null;
  init = async () => {};
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  setAnimationLoop(loop: (time: number) => void) {
    this.loop = loop;
  }
  /** 跑一格預覽影格（影格迴圈的回呼）。 */
  frame() {
    this.inFrame = true;
    try {
      this.loop!((this.clock += 16));
    } finally {
      this.inFrame = false;
    }
  }
  getRenderTarget = () => this.target;
  setRenderTarget(target: RenderTarget | null) {
    this.target = target;
    if (target) this.seenTargets.add(target);
  }
  snapshot(camera: PerspectiveCamera): Snapshot {
    const v = camera.view;
    return {
      target: this.target,
      size: this.target ? [this.target.width, this.target.height] : null,
      view: v?.enabled ? { fullWidth: v.fullWidth, fullHeight: v.fullHeight, offsetX: v.offsetX, offsetY: v.offsetY, width: v.width, height: v.height } : null,
      camY: camera.position.y,
      camZ: camera.position.z,
      aspect: camera.aspect,
      rotation: shared.card!.group.rotation.toArray().slice(0, 3) as number[],
      stage: shared.stage!.group.visible,
      sleeve: shared.card!.sleeveShown,
    };
  }
  /** 真的 compileAsync：同步前半段認定當下的狀態，之後非同步（讓出幾次、等到下一個計時器），完成時才算編譯好。 */
  compileAsync(_scene: unknown, camera: PerspectiveCamera): Promise<void> {
    const n = ++this.compileCalls;
    const injected = this.compileError;
    this.compileError = null;
    if (injected?.mode === 'sync') throw injected.error;
    this.log.push('compile:start');
    this.compileStart.push(this.snapshot(camera));
    const materials = shared.card!.materials;
    return (async () => {
      await Promise.resolve();
      this.log.push('compile:pending');
      this.compilePending.push(this.snapshot(camera));
      this.duringCompile?.(n);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (injected) throw injected.error;
      this.compiledMaterials = materials;
      this.log.push('compile:done');
    })();
  }
  render(_scene: unknown, camera: PerspectiveCamera) {
    this.camera = camera;
    if (this.inFrame) {
      this.previewRendered.push(this.snapshot(camera));
      return;
    }
    this.log.push('render');
    this.rendered.push({ ...this.snapshot(camera), stale: this.compiledMaterials !== shared.card!.materials });
  }
  async readRenderTargetPixelsAsync(target: RenderTarget) {
    this.log.push('read');
    const stride = Math.ceil((target.width * 4) / 256) * 256;
    return new Uint8Array(stride * (target.height - 1) + target.width * 4);
  }
}

let container: { clientWidth: number; clientHeight: number; append(): void };
let disposeSpy: MockInstance<RenderTarget['dispose']>;

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
  });
  vi.stubGlobal('ImageData', SoftImageData);
  vi.stubGlobal('document', { createElement: () => new SoftCanvas() });
  disposeSpy = vi.spyOn(RenderTarget.prototype, 'dispose');
});
afterEach(() => {
  disposeSpy.mockRestore();
  vi.unstubAllGlobals();
});

/** 這個 render target 被 dispose 了幾次。 */
const disposedTimes = (target: RenderTarget) => disposeSpy.mock.contexts.filter((c) => c === target).length;

const pose: CardPose = { yawDeg: 20, pitchDeg: -8, zoom: 1, front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] };
/** 編譯等待時使用者拖到的新姿態：角度、縮放、各層視差位移都不一樣。 */
const NEW_POSE: CardPose = { yawDeg: 55, pitchDeg: 14, zoom: 1.7, front: [{ x: 0.3, y: 0.1 }], back: [{ x: 0, y: 0 }] };

type Look = 'plain' | 'water';

async function setup(look: Look = 'plain') {
  container = { clientWidth: 800, clientHeight: 500, append() {} };
  const view = await createCardView(container as unknown as HTMLElement, {
    plainBack: {} as HTMLImageElement,
    pedestal: {} as HTMLImageElement,
    frameCorner: {} as HTMLImageElement,
  });
  view.setCard({ aspect: 'standard' } as Card, () => undefined);
  if (look === 'water') {
    view.setStage('water');
    // 地平線 0：預覽的鏡頭往下移、開著 view offset（lens shift）；擷取要把這些放回 y＝0、換成裁切
    view.setWaterLook(MIST_WATER_LOOK);
  }
  view.setPose(pose);
  view.start(() => {});
  // 預覽一直在畫：材質都已經編譯好
  shared.renderer!.compiledMaterials = shared.card!.materials;
  shared.renderer!.frame();
  return view;
}

/** 剛換材質：還沒編譯就立刻擷取（例如剛打開卡套、剛加特效、剛換卡片風格就按匯出）。 */
const changeMaterials = () => void shared.card!.materials++;
/** 換卡（main 每次改動都走 setCard）：card-view 的卡片版本加一。 */
const setCardAgain = (view: Awaited<ReturnType<typeof setup>>) => view.setCard({ aspect: 'standard' } as Card, () => undefined);

const turntable = { width: 32, frames: 4, seconds: 4, offsetsAt: () => ({ front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] }) };

interface Capture {
  name: string;
  frames: number;
  /** 擷取那一份畫的卡套（擷取選項要畫卡套、而且卡開著卡套）。 */
  sleeve: boolean;
  /** 有擷取自己的裁切（view offset、鏡頭放回 y＝0）；capture() 沒有，照預覽的鏡頭。 */
  cropped: boolean;
  /** 破框層會被包進取景（capture() 照畫面，不看破框層）。 */
  breakout: boolean;
  run(view: Awaited<ReturnType<typeof setup>>): Promise<unknown>;
}

const captures: Capture[] = [
  {
    name: 'PNG（目前角度）',
    frames: 1,
    sleeve: false,
    cropped: true,
    breakout: true,
    run: (view) => view.captureCard({ width: 64, transparent: true, pose: 'current' }),
  },
  {
    name: 'PNG（正面）',
    frames: 1,
    sleeve: false,
    cropped: true,
    breakout: true,
    run: (view) => view.captureCard({ width: 64, transparent: true, pose: 'front' }),
  },
  {
    name: 'PNG（畫卡套）',
    frames: 1,
    sleeve: true,
    cropped: true,
    breakout: true,
    run: (view) => view.captureCard({ width: 64, transparent: true, pose: 'current', sleeve: true }),
  },
  {
    name: 'capture()（開發用整張）',
    frames: 1,
    sleeve: true,
    cropped: false,
    breakout: false,
    run: (view) => view.capture(),
  },
  {
    name: '轉動影片／GIF',
    frames: 4,
    sleeve: false,
    cropped: true,
    breakout: true,
    run: (view) => view.captureTurntable(turntable, () => {}),
  },
  {
    name: '轉動影片／GIF（畫卡套）',
    frames: 4,
    sleeve: true,
    cropped: true,
    breakout: true,
    run: (view) => view.captureTurntable({ ...turntable, sleeve: true }, () => {}),
  },
];

const clearLogs = (renderer: FakeRenderer) => {
  renderer.log.length = 0;
  renderer.compileStart.length = 0;
  renderer.compilePending.length = 0;
  renderer.rendered.length = 0;
  renderer.previewRendered.length = 0;
  renderer.compileCalls = 0;
};

/** 擷取畫出來的每一格（render target 實例不比，其他都比）。 */
const shotsOf = (renderer: FakeRenderer) => renderer.rendered.map(({ target: _target, stale: _stale, ...rest }) => rest);

const LOOKS: { look: Look; label: string }[] = [
  { look: 'plain', label: '一般舞台' },
  { look: 'water', label: '水鏡（地平線 0）' },
];

describe.each(LOOKS)('擷取在畫之前先等著色程式編譯好（T-827）：$label', ({ look }) => {
  for (const c of captures) {
    it(`${c.name}：render 之前 compileAsync 過、而且等它完成；材質剛換、立刻擷取也不會畫到舊的`, async () => {
      const view = await setup(look);
      const renderer = shared.renderer!;
      changeMaterials();
      clearLogs(renderer);
      await c.run(view);
      // 編譯開始 → 編譯完成 → 才畫（轉動影片只在第一格前編譯一次）
      expect(renderer.compileCalls).toBe(1);
      const firstRender = renderer.log.indexOf('render');
      expect(renderer.log.slice(0, firstRender)).toEqual(['compile:start', 'compile:pending', 'compile:done']);
      expect(renderer.log.filter((e) => e === 'render')).toHaveLength(c.frames);
      // 剛換的材質：每一格畫的時候都已經編譯好
      expect(renderer.rendered).toHaveLength(c.frames);
      for (const r of renderer.rendered) expect(r.stale, '畫的時候新材質已編譯').toBe(false);
    });

    it(`${c.name}：編譯的是擷取那一份（同一個 render target、鏡頭裁切與位置、卡片旋轉、舞台不畫、卡套照選項）；等待期間畫面完整還原、預覽影格照畫`, async () => {
      const view = await setup(look);
      const renderer = shared.renderer!;
      const before = renderer.previewRendered.at(-1)!;
      expect(before.target).toBeNull();
      if (look === 'water') {
        // 預覽真的有地平線：鏡頭往下移、view offset 開著（擷取要放回 y＝0）
        expect(before.camY).not.toBe(0);
        expect(before.view).not.toBeNull();
      }
      clearLogs(renderer);
      // 編譯等待中途真的跑一格預覽影格：它要畫在畫面上（target null）、鏡頭是預覽的樣子（不是擷取暫改的）
      renderer.duringCompile = () => renderer.frame();
      await c.run(view);
      const start = renderer.compileStart[0]!;
      expect(start.target, '編譯時已經設好擷取用的 render target').not.toBeNull();
      expect(start.stage, '舞台不畫').toBe(false);
      expect(start.sleeve, '卡套照選項').toBe(c.sleeve);
      if (c.cropped) {
        expect(start.view, '擷取自己的裁切').not.toBeNull();
        expect(start.camY, '鏡頭放回 y＝0（地平線不進匯出）').toBe(0);
      } else {
        // capture()：整張目前畫面，鏡頭照預覽（水鏡的地平線在內）
        expect(start.view).toEqual(before.view);
        expect(start.camY).toBe(before.camY);
      }
      // 編譯和畫是同一個 render target、同一份鏡頭（完整裁切值、位置、aspect）、同一個卡片旋轉、同一個舞台／卡套狀態
      const first = renderer.rendered[0]!;
      expect(first.target).toBe(start.target);
      const { target: _a, ...startRest } = start;
      const { target: _b, stale: _c, ...firstRest } = first;
      expect(firstRest).toEqual(startRest);
      // 編譯等待的期間：render target、鏡頭完整狀態、卡片旋轉、舞台、卡套都和擷取前一樣（和預覽影格看到的也一樣）
      expect(renderer.compilePending[0]).toEqual(before);
      expect(renderer.previewRendered, '等待期間跑了一格預覽').toHaveLength(1);
      expect(renderer.previewRendered[0]).toEqual(before);
    });
  }

  it('同一個擷取連做兩次：每一次都各自先編譯（材質在兩次之間又換了）', async () => {
    const view = await setup(look);
    const renderer = shared.renderer!;
    changeMaterials();
    await view.captureCard({ width: 64, transparent: true, pose: 'current' });
    changeMaterials();
    renderer.rendered.length = 0;
    renderer.compileCalls = 0;
    await view.captureCard({ width: 64, transparent: true, pose: 'current' });
    expect(renderer.compileCalls).toBe(1);
    expect(renderer.rendered.map((r) => r.stale)).toEqual([false]);
  });
});

describe('編譯等待的期間畫面變了：裁切與輸出大小照畫之前那一刻算（T-827c）', () => {
  for (const c of captures) {
    it(`${c.name}：等待中途拖了角度與縮放、視窗變了 → 畫出來的取景和「等一下再擷取」一模一樣，不是舊裁切框`, async () => {
      const view = await setup();
      const renderer = shared.renderer!;
      clearLogs(renderer);
      renderer.duringCompile = (n) => {
        if (n !== 1) return;
        view.setPose(NEW_POSE);
        container.clientHeight = 320;
      };
      await c.run(view);
      renderer.duringCompile = null;
      const mid = shotsOf(renderer);
      const staleFrame = { size: renderer.compileStart[0]!.size, view: renderer.compileStart[0]!.view };
      // 對照組：姿態、視窗都已經是新的，沒有任何等待期間的變動
      clearLogs(renderer);
      await c.run(view);
      expect(renderer.compileCalls, '對照組沒有變動，不用再編譯').toBe(1);
      expect(mid).toHaveLength(c.frames);
      expect(mid).toEqual(shotsOf(renderer));
      // 這個變動真的會讓取景不一樣（不然上面的比對什麼都沒驗到）
      expect({ size: mid[0]!.size, view: mid[0]!.view }).not.toEqual(staleFrame);
    });

    if (!c.breakout) continue;
    it(`${c.name}：等待中途破框層加進來（換卡）→ 取景把破框層包進去（和一開始就有破框層一樣）、畫之前再編譯一次`, async () => {
      const view = await setup();
      const renderer = shared.renderer!;
      const BOX: FaceBox = { face: 'front', box: { left: -0.5, right: 1.3, bottom: -0.2, top: 1.2 } };
      clearLogs(renderer);
      renderer.duringCompile = (n) => {
        if (n !== 1) return;
        shared.card!.breakout = [BOX];
        changeMaterials();
        setCardAgain(view);
      };
      await c.run(view);
      renderer.duringCompile = null;
      const mid = shotsOf(renderer);
      const staleFrame = { size: renderer.compileStart[0]!.size, view: renderer.compileStart[0]!.view };
      expect(renderer.compileCalls, '換了卡：畫之前再編譯一次').toBe(2);
      for (const r of renderer.rendered) expect(r.stale).toBe(false);
      // 對照組：破框層一開始就在
      clearLogs(renderer);
      await c.run(view);
      expect(renderer.compileCalls).toBe(1);
      expect(mid).toEqual(shotsOf(renderer));
      expect({ size: mid[0]!.size, view: mid[0]!.view }, '破框層真的撐大了取景（沒被舊裁切框裁掉）').not.toEqual(staleFrame);
    });
  }

  for (const c of captures) {
    it(`${c.name}：等待中途換了材質 → 畫之前再編譯一次（兩次都完成才畫），畫出來不是舊的`, async () => {
      const view = await setup();
      const renderer = shared.renderer!;
      clearLogs(renderer);
      renderer.duringCompile = (n) => {
        if (n !== 1) return;
        changeMaterials();
        setCardAgain(view);
      };
      await c.run(view);
      expect(renderer.compileCalls).toBe(2);
      const firstRender = renderer.log.indexOf('render');
      expect(renderer.log.slice(0, firstRender)).toEqual(['compile:start', 'compile:pending', 'compile:done', 'compile:start', 'compile:pending', 'compile:done']);
      expect(renderer.rendered).toHaveLength(c.frames);
      for (const r of renderer.rendered) expect(r.stale, '再編譯過，畫的是新材質').toBe(false);
    });

    it(`${c.name}：一直在換材質也最多編譯 2 次，之後照畫（不無限追）`, async () => {
      const view = await setup();
      const renderer = shared.renderer!;
      clearLogs(renderer);
      renderer.duringCompile = () => {
        changeMaterials();
        setCardAgain(view);
      };
      await c.run(view);
      expect(renderer.compileCalls).toBe(2);
      const firstRender = renderer.log.indexOf('render');
      expect(renderer.log.slice(0, firstRender)).toEqual(['compile:start', 'compile:pending', 'compile:done', 'compile:start', 'compile:pending', 'compile:done']);
      expect(renderer.rendered).toHaveLength(c.frames);
    });
  }

  it('只換了姿態沒換材質、輸出大小不變：不再編譯（只在材質變了或換了 render target 時才再編譯）', async () => {
    const view = await setup();
    const renderer = shared.renderer!;
    clearLogs(renderer);
    // 只動各層視差位移（'front' 的 PNG 不看視差，取景和大小都不變）
    renderer.duringCompile = () => view.setPose({ ...pose, front: [{ x: 0.05, y: 0 }] });
    await view.captureCard({ width: 64, transparent: true, pose: 'front' });
    expect(renderer.compileCalls).toBe(1);
    expect(renderer.rendered).toHaveLength(1);
  });
});

describe('編譯丟錯：擷取失敗、狀態都還原（T-827）', () => {
  const cameraState = (camera: PerspectiveCamera) => ({
    y: camera.position.y,
    z: camera.position.z,
    aspect: camera.aspect,
    // 停用的 view offset 留著上一次擷取的舊數字（clearViewOffset 只關不清）：沒開就不比數字，投影矩陣會管
    view: camera.view?.enabled ? { ...camera.view } : null,
    projection: [...camera.projectionMatrix.elements],
  });

  for (const look of ['plain', 'water'] as const) {
    for (const mode of ['sync', 'async'] as const) {
      for (const c of captures) {
        it(`${look === 'water' ? '水鏡：' : ''}${c.name}：compileAsync ${mode === 'sync' ? '同步丟錯' : '之後被拒絕'} → 擷取丟錯；render target、舞台、卡套、鏡頭都還原，之後還能擷取`, async () => {
          const view = await setup(look);
          const renderer = shared.renderer!;
          const camera = renderer.camera!;
          const before = cameraState(camera);
          renderer.compileError = { mode, error: new Error('假的編譯壞了') };
          renderer.rendered.length = 0;
          await expect(c.run(view)).rejects.toThrow();
          expect(renderer.rendered, '編譯失敗就不畫').toHaveLength(0);
          expect(renderer.target).toBeNull();
          expect(shared.stage!.group.visible).toBe(true);
          expect(shared.card!.sleeveShown).toBe(true);
          expect(cameraState(camera)).toEqual(before);
          // 沒有留下半套狀態：下一次擷取照常
          await c.run(view);
          expect(renderer.rendered).toHaveLength(c.frames);
          expect(cameraState(camera)).toEqual(before);
        });
      }
    }
  }
});

describe('render target 的釋放（T-827c）：每個都釋放一次', () => {
  const targetsOf = (renderer: FakeRenderer) => [...renderer.seenTargets];

  for (const c of captures) {
    it(`${c.name}：成功 → 用到的 render target 各釋放一次`, async () => {
      const view = await setup();
      const renderer = shared.renderer!;
      renderer.seenTargets.clear();
      await c.run(view);
      const targets = targetsOf(renderer);
      expect(targets).toHaveLength(1);
      for (const t of targets) expect(disposedTimes(t)).toBe(1);
    });

    for (const mode of ['sync', 'async'] as const) {
      it(`${c.name}：compileAsync ${mode === 'sync' ? '同步丟錯' : '之後被拒絕'} → 擷取丟錯，render target 釋放一次`, async () => {
        const view = await setup();
        const renderer = shared.renderer!;
        renderer.seenTargets.clear();
        renderer.compileError = { mode, error: new Error('假的編譯壞了') };
        await expect(c.run(view)).rejects.toThrow();
        const targets = targetsOf(renderer);
        expect(targets).toHaveLength(1);
        for (const t of targets) expect(disposedTimes(t)).toBe(1);
      });
    }

    it(`${c.name}：等待中途改了視窗、拖了縮放（輸出大小變了就換一個 render target）→ 換掉的與最後用的各釋放一次`, async () => {
      const view = await setup();
      const renderer = shared.renderer!;
      renderer.seenTargets.clear();
      renderer.duringCompile = (n) => {
        if (n !== 1) return;
        view.setPose(NEW_POSE);
        container.clientHeight = 320;
      };
      await c.run(view);
      const targets = targetsOf(renderer);
      expect(targets.length).toBeGreaterThanOrEqual(1);
      if (c.name.startsWith('capture()')) expect(targets, '視窗變了：換成新大小的 target').toHaveLength(2);
      for (const t of targets) expect(disposedTimes(t)).toBe(1);
    });
  }

  it('擷取畫的 render target 大小＝輸出大小（換過之後最後畫的那個也是）', async () => {
    const view = await setup();
    const renderer = shared.renderer!;
    renderer.duringCompile = (n) => {
      if (n === 1) container.clientHeight = 320;
    };
    await view.capture();
    expect(renderer.rendered[0]!.size).toEqual([800, 320]);
  });
});
