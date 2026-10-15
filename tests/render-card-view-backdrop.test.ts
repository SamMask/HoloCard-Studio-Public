// T-814b／T-815b：card-view 真正的擷取入口與貼圖生命週期（假 GPU＋軟體 2D 畫布，同 render-turntable-nod-scene.test.ts 的做法）。
//   1. captureTurntable 逐格合成：「畫上背景」時每一格的底都是背景圖（圖有透明的地方露出深藍漸層，每格不透明、GIF 編碼器收），
//      卡片疊在上面、上一格的卡片不會留在下一格；卡套、光碟、破框層一起開也一樣；沒有背景圖時照舊（只有深藍漸層）。
//   2. CardScene.setBackdrop：貼圖第一次要時建、同一張不重建、換圖或拿掉時舞台換好之後才釋放舊的。
//   3. CardScene.setWaterScene（水鏡遠景）：貼圖同一張只建一次；切到別的舞台、加背景圖、換卡（main 都傳 null）時全部 dispose；回到水鏡重新建立。
//   4. 遠景的位置與大小（T-822）：captureTurntable 每一格的底照背景圖帶的 pan 裁（同 paintBase）；CardScene.setFarPan 交給舞台；
//      main 每次 update 交這張卡的 farPan、PNG 與影片／GIF 的背景圖帶著 pan。
//   5. 前景圖（T-830）：captureTurntable 每一格卡片之後疊前景圖（每格同一個位置）；沒給＝和以前一樣。
import { Group, Vector2 } from 'three';
import { Texture } from 'three/webgpu';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGifFrames } from '../src/file/gif-encode';
import { exportBackdropFor } from '../src/app/turntable-export';
import { newCard } from '../src/model/create';
import { ASPECT_HEIGHT, type Card, type FarPan } from '../src/model/types';
import { foregroundRect, paintForeground, withFarPan } from '../src/render/backdrop';
import { createCardView, paintBase, type BackdropImage, type CardPose, type ForegroundImage, type TurntableOptions } from '../src/render/card-view';
import { cardOutline } from '../src/render/fit';
import type { FaceBox } from '../src/render/pick';
import { discOutline } from '../src/render/disc';
import type { StageBackdrop } from '../src/render/stage-switch';
import { allOpaque, pixelAt, readPixels, SoftCanvas, softImage, SoftImageData } from './fake-canvas2d';

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
  front = [new Vector2()];
  back = [new Vector2()];
  shape = { aspect: 'standard' } as Card;
  outline = () => this.shape.kind === 'disc' ? discOutline() : cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => face === 'front' ? this.front : this.back;
  reach = () => null;
  /** 假的破框層：不是空的話，擷取會用它算整段取景。 */
  breakout: FaceBox[] = [];
  breakoutBoxes = (face: 'front' | 'back', offsets?: { x: number; y: number }[]) => this.breakout.filter(b => b.face === face).map(b => {
    const o = offsets?.[0] ?? this.offsets(face)[0]!;
    return { face, box: { left: b.box.left + o.x, right: b.box.right + o.x, bottom: b.box.bottom + o.y, top: b.box.top + o.y } };
  });
  breakoutAt = () => null;
  update(card: Card) { this.shape = card; }
  setTime() {}
  setView() {}
  setFlash() {}
  sleeveShown = false;
  sleeve = () => this.shape.view?.sleeve ?? false;
  withoutSleeve(draw: () => void) {
    const before = this.sleeveShown;
    this.sleeveShown = false;
    try { draw(); } finally { this.sleeveShown = before; }
  }
  setShadows() {}
  withFullShadows(draw: () => void) { draw(); }
}

class FakeStage {
  group = new Group();
  /** 舞台收到的遠景（setBackdrop）與水鏡遠景（setWaterScene），依呼叫順序。 */
  backdrops: (StageBackdrop | null)[] = [];
  scenes: (StageBackdrop | null)[] = [];
  setReducedMotion() {}
  setCardHeight() {}
  setPose() {}
  setStyle() {}
  setThumbs() {}
  update() {}
  hidden(draw: () => void) { draw(); }
  setBackdrop(b: StageBackdrop | null) { this.backdrops.push(b); }
  setWaterScene(s: StageBackdrop | null) { this.scenes.push(s); }
  pans: FarPan[] = [];
  setFarPan(p: FarPan) { this.pans.push(p); }
}

type Target = { width: number; height: number; dispose(): void };

/** 第 index 格讀回的卡片：4×4 的不透明綠色方塊，每格往右挪一格（其餘全透明）；左上角 (x, y) 是方塊的位置。 */
const BLOCK = { size: 4, y: 4, x0: 2, color: [30, 220, 60, 255] as const };
const blockX = (index: number) => BLOCK.x0 + index;

class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = {};
  target: Target | null = null;
  rendered: { sleeve: boolean }[] = [];
  reads = 0;
  init = async () => {};
  /** 擷取前先 await compileAsync（T-827）；編譯本身的順序與狀態在 tests/render-card-view-compile.test.ts。 */
  compileAsync = async () => {};
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  setAnimationLoop() {}
  getRenderTarget = () => this.target;
  setRenderTarget(target: Target | null) { this.target = target; }
  render() { this.rendered.push({ sleeve: shared.card!.sleeveShown }); }
  async readRenderTargetPixelsAsync(target: Target) {
    const index = this.reads++;
    // WebGPU 讀回：每列補齊到 256 位元組（最後一列不補）
    const stride = Math.ceil(target.width * 4 / 256) * 256;
    const data = new Uint8Array(stride * (target.height - 1) + target.width * 4);
    for (let y = BLOCK.y; y < BLOCK.y + BLOCK.size; y++)
      for (let x = blockX(index); x < blockX(index) + BLOCK.size; x++) data.set(BLOCK.color, y * stride + x * 4);
    return data;
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  vi.stubGlobal('ImageData', SoftImageData);
  vi.stubGlobal('document', { createElement: () => new SoftCanvas() });
});
afterEach(() => vi.unstubAllGlobals());

const pose: CardPose = { yawDeg: 0, pitchDeg: 0, zoom: 1, front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] };
const options: TurntableOptions = {
  width: 16, frames: 8, seconds: 4,
  offsetsAt: () => ({ front: [{ x: 0, y: 0 }], back: [{ x: 0, y: 0 }] }),
};

async function setup(card = { aspect: 'standard' } as Card) {
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement,
    { plainBack: {} as HTMLImageElement, pedestal: {} as HTMLImageElement, frameCorner: {} as HTMLImageElement });
  view.setCard(card, () => undefined);
  shared.card!.sleeveShown = shared.card!.sleeve();
  view.setPose(pose);
  return view;
}

/** 認得出來的背景圖：左半不透明紅、右半完全透明（所以右半露出深藍漸層）。 */
const RED = [200, 40, 40, 255] as const;
const backdropImage = softImage(2, 2, x => (x === 0 ? RED : [40, 90, 200, 0]));
const BACKDROP: BackdropImage = { image: backdropImage as unknown as HTMLImageElement, width: 2, height: 2 };

/** 輸出大小的底（paintBase：深藍漸層、有背景圖再疊上去）。底本身的正確性在 tests/render-backdrop-base.test.ts。 */
function baseOf(width: number, height: number, backdrop: BackdropImage | null): SoftImageData {
  const c = new SoftCanvas();
  c.width = width;
  c.height = height;
  paintBase(c.getContext('2d') as unknown as CanvasRenderingContext2D, width, height, backdrop);
  return readPixels(c);
}

/** 第 index 格該有的樣子：底＋第 index 格的方塊（其餘都是底，上一格的方塊不在）。 */
function expectedFrame(base: SoftImageData, index: number): number[] {
  const out = Array.from(base.data);
  for (let y = BLOCK.y; y < BLOCK.y + BLOCK.size; y++)
    for (let x = blockX(index); x < blockX(index) + BLOCK.size; x++) out.splice((y * base.width + x) * 4, 4, ...BLOCK.color);
  return out;
}

async function turntable(view: Awaited<ReturnType<typeof setup>>, extra: Partial<TurntableOptions>) {
  const frames: Uint8ClampedArray[] = [];
  shared.renderer!.reads = 0;
  shared.renderer!.rendered.length = 0;
  const result = await view.captureTurntable({ ...options, ...extra }, rgba => void frames.push(rgba));
  return { frames, ...result, image: (i: number) => new SoftImageData(frames[i] as Uint8ClampedArray<ArrayBuffer>, result.width, result.height) };
}

describe('captureTurntable 逐格合成：畫上背景（T-814b）', () => {
  const CASES = [
    ['一般卡', { aspect: 'standard' } as Card, false],
    ['透明卡套', { aspect: 'standard', view: { sleeve: true } } as Card, true],
    ['卡套開著、匯出沒勾卡套', { aspect: 'standard', view: { sleeve: true } } as Card, false],
    ['CD 光碟', { aspect: 'square', kind: 'disc' } as Card, false],
    ['破框層', { aspect: 'standard' } as Card, false],
  ] as const;

  it.each(CASES)('%s：每一格的底都是背景圖（透明處露出漸層）、整格不透明、卡片疊在上面、上一格的卡片不會留下來', async (name, shape, sleeve) => {
    const view = await setup(shape);
    if (name === '破框層') shared.card!.breakout = [{ face: 'front', box: { left: -0.4, right: 0.5, bottom: 0.2, top: 1.1 } }];
    const { frames, width, height, image } = await turntable(view, { backdrop: BACKDROP, sleeve });
    expect(frames).toHaveLength(8);
    expect(shared.renderer!.rendered).toHaveLength(8);
    for (const r of shared.renderer!.rendered) expect(r.sleeve, '卡套照選項畫').toBe(sleeve);
    // 每格是各自的陣列（呼叫端可以保留）
    expect(new Set(frames.map(f => f.buffer)).size).toBe(8);
    const base = baseOf(width, height, BACKDROP);
    // 對照基準本身：左邊是背景圖的紅、右下是漸層（透明處）
    expect(pixelAt(base, 0, height - 1)).toEqual([...RED]);
    expect(pixelAt(base, width - 1, height - 1)).not.toEqual([...RED]);
    for (let i = 0; i < 8; i++) {
      const img = image(i);
      expect(img.data.length, `第 ${i} 格大小`).toBe(width * height * 4);
      expect(allOpaque(img), `第 ${i} 格不透明`).toBe(true);
      // 整格 = 底 + 這一格的方塊：底是背景圖與漸層、方塊在 blockX(i)、上一格的方塊不留下來
      expect(Array.from(img.data), `第 ${i} 格`).toEqual(expectedFrame(base, i));
    }
  });

  it('背景圖有透明處的轉動匯出，每格 GIF 編碼器都收', async () => {
    const view = await setup();
    const { frames, width, height } = await turntable(view, { backdrop: BACKDROP });
    const bytes = encodeGifFrames(frames, { width, height, delayMs: 67 });
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
  });

  it('全透明的背景圖：每格就是深藍漸層＋卡片、不透明', async () => {
    const view = await setup();
    const clear: BackdropImage = { image: softImage(2, 2, () => [0, 0, 0, 0]) as unknown as HTMLImageElement, width: 2, height: 2 };
    const { width, height, image } = await turntable(view, { backdrop: clear });
    const base = baseOf(width, height, null);
    for (let i = 0; i < 8; i++) {
      expect(allOpaque(image(i))).toBe(true);
      expect(Array.from(image(i).data)).toEqual(expectedFrame(base, i));
    }
  });

  it('沒有背景圖（省略、null）：和以前一樣，底是深藍漸層（沒有背景圖的紅）', async () => {
    const view = await setup();
    for (const extra of [{}, { backdrop: null }] as const) {
      const { width, height, image } = await turntable(view, extra);
      const base = baseOf(width, height, null);
      for (let i = 0; i < 8; i++) expect(Array.from(image(i).data), JSON.stringify(extra)).toEqual(expectedFrame(base, i));
      expect(pixelAt(image(0), 0, height - 1)).not.toEqual([...RED]);
    }
  });
});

describe('T-842 不勾遠景的位元組回歸（假 GPU＋軟體畫布，GIF 用真編碼器）', () => {
  it.each(['gallery', 'water', 'nebula', 'desk'] as const)('%s：PNG 送編碼的 RGBA、影片每格 RGBA、GIF 檔案與舊路徑逐位元相同', async stage => {
    // 軟體畫布沒有 PNG 編碼器：在 toBlob 邊界取真實合成像素，比對 PNG 編碼器的完整輸入；不把空 Blob 當成 PNG 證據。
    const pngPixels = vi.spyOn(SoftCanvas.prototype, 'toBlob').mockImplementation(function (this: SoftCanvas, done) {
      done(new Blob([new Uint8Array(this.pixels)], { type: 'application/octet-stream' }));
    });
    try {
      for (const custom of [false, true]) {
        const card = newCard('standard', 'regression', '2026-10-15T00:00:00.000Z');
        card.view.stage = stage;
        card.view.farPan = { x: 0.4, y: -0.2, zoom: 1.5 };
        if (custom) card.view.backdrop = '00000000000000b7';
        const load = vi.fn(async () => BACKDROP);
        const view = await setup(card);
        // 修改前的背景選擇：只看自訂背景圖，不看舞台。
        const legacy = custom ? withFarPan(BACKDROP, card.view.farPan) : null;
        for (const includeStageFar of [undefined, false]) {
          const backdrop = await exportBackdropFor(card, { includeStageFar }, () => BACKDROP, load);
          for (const transparent of [false, true]) {
            shared.renderer!.reads = 0;
            const before = await view.captureCard({ width: 16, transparent, pose: 'current', backdrop: legacy });
            shared.renderer!.reads = 0;
            const after = await view.captureCard({ width: 16, transparent, pose: 'current', backdrop });
            expect(before.size).toBeGreaterThan(0);
            expect(new Uint8Array(await after.arrayBuffer())).toEqual(new Uint8Array(await before.arrayBuffer()));
          }
          const before = await turntable(view, { backdrop: legacy });
          const after = await turntable(view, { backdrop });
          // 影片編碼器接到的所有畫格：包含時序與尺寸都用同一組設定。
          expect(after.frames).toEqual(before.frames);
          const gifOptions = { width: before.width, height: before.height, delayMs: 67 };
          expect(encodeGifFrames(after.frames, gifOptions)).toEqual(encodeGifFrames(before.frames, gifOptions));
          expect(load).not.toHaveBeenCalled();
        }
      }
    } finally {
      pngPixels.mockRestore();
    }
  });
});

describe('CardScene.setBackdrop：貼圖的建立與釋放（T-814b）', () => {
  const img = (tag: string, w = 1600, h = 900): BackdropImage => ({ image: { tag } as unknown as HTMLImageElement, width: w, height: h });

  /** 舞台收到的貼圖：記下每個貼圖什麼時候被釋放（和舞台收到的順序放在同一條時間線上）。 */
  function watch(stage: FakeStage, log: string[]) {
    const seen = new Set<Texture>();
    return () => {
      for (const b of stage.backdrops) {
        if (!b || seen.has(b.texture)) continue;
        seen.add(b.texture);
        const name = `T${seen.size}`;
        b.texture.addEventListener('dispose', () => log.push(`dispose ${name}`));
      }
    };
  }

  it('第一次建貼圖交給舞台（原圖寬高、sRGB）；同一張圖再設不重建、不再交給舞台', async () => {
    const view = await setup();
    const a = img('a');
    view.setBackdrop(a);
    expect(shared.stage!.backdrops).toHaveLength(1);
    const first = shared.stage!.backdrops[0]!;
    expect(first.texture).toBeInstanceOf(Texture);
    expect(first.texture.image).toBe(a.image);
    expect([first.width, first.height]).toEqual([1600, 900]);
    expect(first.texture.colorSpace).toBe('srgb');
    view.setBackdrop(a);
    view.setBackdrop({ ...a });
    expect(shared.stage!.backdrops).toHaveLength(1);
  });

  it('換一張：舞台先換成新的、舊貼圖之後才釋放（只釋放一次）；新的貼圖還活著', async () => {
    const view = await setup();
    const stage = shared.stage!;
    const log: string[] = [];
    const track = watch(stage, log);
    stage.setBackdrop = (b) => { stage.backdrops.push(b); log.push(`stage ${b ? 'get' : 'null'}`); track(); };
    view.setBackdrop(img('a'));
    view.setBackdrop(img('b'));
    expect(log).toEqual(['stage get', 'stage get', 'dispose T1']);
    expect(stage.backdrops[0]!.texture).not.toBe(stage.backdrops[1]!.texture);
  });

  it('拿掉（null）：舞台收到 null、貼圖釋放；再拿掉一次不再做事', async () => {
    const view = await setup();
    const stage = shared.stage!;
    const log: string[] = [];
    const track = watch(stage, log);
    stage.setBackdrop = (b) => { stage.backdrops.push(b); log.push(`stage ${b ? 'get' : 'null'}`); track(); };
    view.setBackdrop(img('a'));
    view.setBackdrop(null);
    view.setBackdrop(null);
    expect(log).toEqual(['stage get', 'stage null', 'dispose T1']);
  });

  it('尺寸不合理的圖（寬 0）當沒有：不建貼圖、舞台收到 null、舊的釋放', async () => {
    const view = await setup();
    const stage = shared.stage!;
    const log: string[] = [];
    const track = watch(stage, log);
    stage.setBackdrop = (b) => { stage.backdrops.push(b); log.push(`stage ${b ? 'get' : 'null'}`); track(); };
    view.setBackdrop(img('a'));
    view.setBackdrop(img('bad', 0, 900));
    expect(log).toEqual(['stage get', 'stage null', 'dispose T1']);
  });
});

describe('CardScene.setWaterScene：水鏡遠景貼圖的生命週期（T-815b）', () => {
  const img = (tag: string): BackdropImage => ({ image: { tag } as unknown as HTMLImageElement, width: 2048, height: 1024 });
  /** 記下貼圖被釋放幾次。 */
  const counted = (b: StageBackdrop | null) => {
    const count = { n: 0 };
    b?.texture.addEventListener('dispose', () => count.n++);
    return count;
  };

  it('同一張圖只建一次貼圖（湖光山峰 → 水墨山 → 湖光山峰：第三次拿到第一次那個）；換來換去都沒有釋放', async () => {
    const view = await setup();
    const lake = img('lake');
    const ink = img('ink');
    view.setWaterScene(lake);
    const lakeStage = shared.stage!.scenes[0]!;
    const lakeFreed = counted(lakeStage);
    expect(lakeStage.texture).toBeInstanceOf(Texture);
    expect(lakeStage.texture.image).toBe(lake.image);
    view.setWaterScene(ink);
    const inkFreed = counted(shared.stage!.scenes[1]!);
    view.setWaterScene(lake);
    expect(shared.stage!.scenes[2]).toBe(lakeStage);
    expect([lakeFreed.n, inkFreed.n]).toEqual([0, 0]);
  });

  // main 的 update 每次都呼叫 setWaterScene(舞台是水鏡且沒有自己的背景圖 ? 選的那張 : null)（main.ts，下面有一個測試盯著這句話）：
  // 切到別的舞台、加了自己的背景圖、換成不是水鏡的卡，傳的都是 null。
  it.each([
    ['切到別的舞台', 'stage'],
    ['加了自己的背景圖', 'backdrop'],
    ['換成不是水鏡的卡', 'card'],
  ] as const)('%s：傳 null → 舞台收到 null、三張貼圖都釋放（各一次）；再傳 null 不重複釋放', async (_name, _why) => {
    const view = await setup();
    const lake = img('lake');
    const ink = img('ink');
    const fuji = img('fuji');
    const freed = [lake, ink, fuji].map(i => {
      view.setWaterScene(i);
      return counted(shared.stage!.scenes.at(-1)!);
    });
    view.setWaterScene(null);
    expect(shared.stage!.scenes.at(-1)).toBeNull();
    expect(freed.map(f => f.n)).toEqual([1, 1, 1]);
    view.setWaterScene(null);
    expect(freed.map(f => f.n)).toEqual([1, 1, 1]);
  });

  it('回到水鏡：重新建立（是新的貼圖、不是釋放掉的那個、沒被釋放）', async () => {
    const view = await setup();
    const lake = img('lake');
    view.setWaterScene(lake);
    const before = shared.stage!.scenes[0]!;
    view.setWaterScene(null);
    view.setWaterScene(lake);
    const after = shared.stage!.scenes.at(-1)!;
    expect(after).not.toBeNull();
    expect(after.texture).not.toBe(before.texture);
    expect(after.texture.image).toBe(lake.image);
    const freed = counted(after);
    view.setWaterScene(lake);
    expect(freed.n).toBe(0);
  });

  it('尺寸不合理的圖（寬 0）：舞台收到 null、已經建好的貼圖也釋放', async () => {
    const view = await setup();
    view.setWaterScene(img('lake'));
    const freed = counted(shared.stage!.scenes[0]!);
    view.setWaterScene({ image: {} as HTMLImageElement, width: 0, height: 1024 });
    expect(shared.stage!.scenes.at(-1)).toBeNull();
    expect(freed.n).toBe(1);
  });

  it('main.ts 照「水鏡、而且沒有自己的背景圖」才給圖，其他情況給 null（上面幾條靠這句話）', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/scene\?\.setWaterScene\(\s*card\.view\.stage === 'water' && backdrop === null\s*\?\s*waterScenes\.image\(waterSceneOf\(card\)\)\s*:\s*null\s*\)/);
  });
});

describe('遠景的位置與大小（T-822）', () => {
  /** 四欄不同顏色的背景圖（左到右：紅、綠、藍、黃），寬 4 高 1：放進直的畫格，左右多出來很多。 */
  const COLS = [[200, 40, 40, 255], [40, 200, 40, 255], [40, 40, 200, 255], [200, 200, 40, 255]] as const;
  const striped: BackdropImage = { image: softImage(4, 1, x => COLS[x]!) as unknown as HTMLImageElement, width: 4, height: 1 };

  it('captureTurntable：每一格的底照背景圖帶的位置裁（和 paintBase 一樣）；左右拉到兩端時畫格的底真的不同', async () => {
    const view = await setup();
    const shots = [];
    for (const x of [-1, 1]) {
      const backdrop: BackdropImage = { ...striped, pan: { x, y: 0, zoom: 1 } };
      const { width, height, image } = await turntable(view, { backdrop });
      const base = baseOf(width, height, backdrop);
      for (let i = 0; i < 8; i++) expect(Array.from(image(i).data), `x ${x} 第 ${i} 格`).toEqual(expectedFrame(base, i));
      shots.push(pixelAt(image(0), 0, height - 1));
    }
    // 左下角：x −1 是最左那欄（紅）、x 1 是靠右那幾欄（不是紅）
    expect(shots[0]).toEqual([...COLS[0]]);
    expect(shots[1]).not.toEqual([...COLS[0]]);
  });

  it('沒有位置（省略）＝置中 cover，和 {0,0,1} 一模一樣', async () => {
    const view = await setup();
    const a = await turntable(view, { backdrop: striped });
    const b = await turntable(view, { backdrop: { ...striped, pan: { x: 0, y: 0, zoom: 1 } } });
    for (let i = 0; i < 8; i++) expect(Array.from(a.image(i).data)).toEqual(Array.from(b.image(i).data));
  });

  it('CardScene.setFarPan：交給舞台（舞台只交給水鏡、值一樣不重排）', async () => {
    const view = await setup();
    view.setFarPan({ x: 0.4, y: -0.2, zoom: 1.5 });
    expect(shared.stage!.pans).toEqual([{ x: 0.4, y: -0.2, zoom: 1.5 }]);
  });

  it('main.ts：每次 update 交這張卡的位置（PNG 與影片／GIF 的位置由 app 接線測試覆蓋）', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/scene\?\.setFarPan\(farPanOf\(card\)\)/);
  });
});

describe('前景圖（T-830）：captureTurntable 每一格卡片之後疊前景圖', () => {
  /** 不透明洋紅的前景圖，擺在左上（模糊 0：軟體畫布不做濾鏡），會蓋到卡片的方塊。 */
  const MAGENTA = [210, 30, 200, 255] as const;
  const foreground: ForegroundImage = {
    image: softImage(3, 3, () => MAGENTA) as unknown as HTMLImageElement,
    width: 3,
    height: 3,
    place: { x: -0.5, y: 0.6, scale: 1, blur: 0 },
  };

  /** 底＋這一格的方塊，再照 paintForeground 疊前景圖。 */
  function withForeground(base: SoftImageData, index: number): number[] {
    const c = new SoftCanvas();
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    ctx.putImageData(new SoftImageData(new Uint8ClampedArray(expectedFrame(base, index)), base.width, base.height) as unknown as ImageData, 0, 0);
    paintForeground(ctx, foreground, base.width, base.height);
    return Array.from(readPixels(c).data);
  }

  it('有背景圖、沒有背景圖都一樣：每一格＝底＋卡片＋前景圖（前景圖蓋在卡片上面、每格同一個位置）、不透明', async () => {
    const view = await setup();
    for (const backdrop of [BACKDROP, null]) {
      const { width, height, image } = await turntable(view, { backdrop, foreground });
      const base = baseOf(width, height, backdrop);
      for (let i = 0; i < 8; i++) {
        expect(allOpaque(image(i)), `第 ${i} 格不透明`).toBe(true);
        expect(Array.from(image(i).data), `第 ${i} 格`).toEqual(withForeground(base, i));
      }
      // 對照：前景圖真的有畫上去（不是只有底＋卡片），而且蓋到了卡片的方塊
      expect(withForeground(base, 0)).not.toEqual(expectedFrame(base, 0));
      const r = foregroundRect(3, 3, width, height, foreground.place)!;
      const px = Math.floor(r.dx + r.dw / 2);
      const py = Math.floor(r.dy + r.dh / 2);
      expect(pixelAt(image(0), px, py)).toEqual([...MAGENTA]);
    }
  });

  it('沒有前景圖（省略、null）：和以前一模一樣', async () => {
    const view = await setup();
    for (const extra of [{}, { foreground: null }] as const) {
      const { width, height, image } = await turntable(view, extra);
      const base = baseOf(width, height, null);
      for (let i = 0; i < 8; i++) expect(Array.from(image(i).data)).toEqual(expectedFrame(base, i));
    }
  });
});
