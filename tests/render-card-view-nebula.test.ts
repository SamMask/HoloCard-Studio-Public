// T-817：card-view 的星雲大圖貼圖（CardScene.setNebulaSwirl）。假 GPU（同 render-card-view-backdrop.test.ts 的做法）。
// 同一張圖只建一次貼圖（sRGB、有 mipmap：遠處縮小不閃）；main 傳 null（不是星雲、有自己的背景圖、換卡）時釋放；回到星雲重新建立。
import { Group, Vector2 } from 'three';
import { LinearMipmapLinearFilter, SRGBColorSpace, Texture } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASPECT_HEIGHT, type Card } from '../src/model/types';
import { createCardView, type BackdropImage } from '../src/render/card-view';
import { cardOutline } from '../src/render/fit';
import type { StageBackdrop } from '../src/render/stage-switch';

const shared = vi.hoisted(() => ({
  stage: null as FakeStage | null,
}));

vi.mock('three/webgpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/webgpu')>()),
  WebGPURenderer: function () {
    return new FakeRenderer();
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
  shape = { aspect: 'standard' } as Card;
  outline = () => cardOutline(ASPECT_HEIGHT.standard, 0.05);
  offsets = (face: string) => (face === 'front' ? this.front : this.back);
  reach = () => null;
  breakoutBoxes = () => [];
  breakoutAt = () => null;
  update(card: Card) {
    this.shape = card;
  }
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
  swirls: (StageBackdrop | null)[] = [];
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
  setWaterLook() {}
  setNebulaSwirl(s: StageBackdrop | null) {
    this.swirls.push(s);
  }
}

class FakeRenderer {
  backend = { isWebGPUBackend: true };
  domElement = {};
  init = async () => {};
  setPixelRatio() {}
  setClearColor() {}
  getMaxAnisotropy = () => 8;
  setSize() {}
  setAnimationLoop() {}
  getRenderTarget = () => null;
  setRenderTarget() {}
  render() {}
}

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const view = await createCardView({ clientWidth: 800, clientHeight: 500, append() {} } as unknown as HTMLElement, {
    plainBack: {} as HTMLImageElement,
    pedestal: {} as HTMLImageElement,
    frameCorner: {} as HTMLImageElement,
  });
  view.setCard({ aspect: 'standard' } as Card, () => undefined);
  return view;
}

const img = (tag: string): BackdropImage => ({ image: { tag } as unknown as HTMLImageElement, width: 2048, height: 2048 });
const counted = (b: StageBackdrop | null) => {
  const count = { n: 0 };
  b?.texture.addEventListener('dispose', () => count.n++);
  return count;
};

describe('CardScene.setNebulaSwirl：星雲大圖貼圖的生命週期', () => {
  it('第一次建貼圖交給舞台（原圖寬高、sRGB、mipmap、各向異性）；同一張圖再設拿到同一個、不釋放', async () => {
    const view = await setup();
    const n = img('nebula');
    view.setNebulaSwirl(n);
    const first = shared.stage!.swirls[0]!;
    expect(first.texture).toBeInstanceOf(Texture);
    expect(first.texture.image).toBe(n.image);
    expect([first.width, first.height]).toEqual([2048, 2048]);
    expect(first.texture.colorSpace).toBe(SRGBColorSpace);
    expect(first.texture.generateMipmaps).toBe(true);
    expect(first.texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(first.texture.anisotropy).toBeGreaterThan(1);
    const freed = counted(first);
    view.setNebulaSwirl(n);
    expect(shared.stage!.swirls[1]).toBe(first);
    expect(freed.n).toBe(0);
  });

  it('傳 null（不是星雲、有自己的背景圖、換卡）：舞台收到 null、貼圖釋放一次；再傳 null 不重複釋放', async () => {
    const view = await setup();
    view.setNebulaSwirl(img('nebula'));
    const freed = counted(shared.stage!.swirls[0]!);
    view.setNebulaSwirl(null);
    expect(shared.stage!.swirls.at(-1)).toBeNull();
    expect(freed.n).toBe(1);
    view.setNebulaSwirl(null);
    expect(freed.n).toBe(1);
  });

  it('回到星雲：重新建立（新的貼圖、不是釋放掉的那個）', async () => {
    const view = await setup();
    const n = img('nebula');
    view.setNebulaSwirl(n);
    const before = shared.stage!.swirls[0]!;
    view.setNebulaSwirl(null);
    view.setNebulaSwirl(n);
    const after = shared.stage!.swirls.at(-1)!;
    expect(after.texture).not.toBe(before.texture);
    expect(after.texture.image).toBe(n.image);
  });

  it('尺寸不合理的圖（寬 0）：舞台收到 null、已經建好的貼圖也釋放', async () => {
    const view = await setup();
    view.setNebulaSwirl(img('nebula'));
    const freed = counted(shared.stage!.swirls[0]!);
    view.setNebulaSwirl({ image: {} as HTMLImageElement, width: 0, height: 2048 });
    expect(shared.stage!.swirls.at(-1)).toBeNull();
    expect(freed.n).toBe(1);
  });

  it('和水鏡遠景的貼圖分開：釋放星雲的不影響水鏡的', async () => {
    const view = await setup();
    const stage = shared.stage! as FakeStage & { scenes?: (StageBackdrop | null)[] };
    const scenes: (StageBackdrop | null)[] = [];
    stage.setWaterScene = ((s: StageBackdrop | null) => void scenes.push(s)) as () => void;
    view.setWaterScene(img('lake'));
    const lakeFreed = counted(scenes[0]!);
    view.setNebulaSwirl(img('nebula'));
    view.setNebulaSwirl(null);
    expect(lakeFreed.n).toBe(0);
  });
});
