// createCardView 的素材與失敗處理（T-416b）：雕花邊角的素材由 main 注入（deps.frameCorner），card-view 不自己讀；
// 素材讀不到（null）照樣建好畫面（雕花先畫成簡約）；renderer 初始化或建場景失敗 → 放掉 renderer、畫布不留在畫面上。
import { Group } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardView, type CardViewDeps } from '../src/render/card-view';

const shared = vi.hoisted(() => ({
  initFails: false,
  cardThrows: false,
  renderers: [] as { disposed: number; removed: number; appended: boolean }[],
  cardArgs: [] as unknown[][],
}));

vi.mock('three/webgpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/webgpu')>()),
  WebGPURenderer: function () {
    const state = { disposed: 0, removed: 0, appended: false };
    shared.renderers.push(state);
    return {
      backend: { isWebGPUBackend: true },
      domElement: { remove: () => void state.removed++ },
      init: async () => {
        if (shared.initFails) throw new Error('沒有 GPU');
      },
      dispose: () => void state.disposed++,
      setPixelRatio() {},
      setClearColor() {},
      getMaxAnisotropy: () => 8,
      setSize() {},
    };
  },
}));
vi.mock('../src/render/card-mesh', () => ({
  createCardObject: (...args: unknown[]) => {
    shared.cardArgs.push(args);
    if (shared.cardThrows) throw new Error('建卡片失敗');
    return { group: new Group(), outline: () => ({ halfW: 0.5, halfH: 0.7, r: 0.05 }), offsets: () => [], reach: () => null };
  },
}));
vi.mock('../src/render/stage-switch', () => ({
  createStageSwitch: () => ({ group: new Group(), setReducedMotion() {} }),
}));

const container = () => {
  const host = { clientWidth: 800, clientHeight: 500, append: () => void (shared.renderers.at(-1)!.appended = true) };
  return host as unknown as HTMLElement;
};
const plainBack = { naturalWidth: 4, naturalHeight: 4 } as HTMLImageElement;
const pedestal = { naturalWidth: 4, naturalHeight: 4 } as HTMLImageElement;
const corner = { naturalWidth: 512, naturalHeight: 512 } as HTMLImageElement;

beforeEach(() => {
  shared.initFails = false;
  shared.cardThrows = false;
  shared.renderers.length = 0;
  shared.cardArgs.length = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  // card-view 不准自己讀圖：有人建 Image 或呼叫 fetch 就丟錯
  vi.stubGlobal('Image', class { constructor() { throw new Error('card-view 不該自己建 Image'); } });
  vi.stubGlobal('fetch', () => {
    throw new Error('card-view 不該自己讀檔');
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('雕花邊角的素材由 main 注入（T-416b）', () => {
  it('deps.frameCorner 原樣交給 createCardObject（card-view 不自己讀圖）', async () => {
    const deps: CardViewDeps = { plainBack, pedestal, frameCorner: corner };
    await createCardView(container(), deps);
    expect(shared.cardArgs).toHaveLength(1);
    expect(shared.cardArgs[0]![0]).toBe(plainBack);
    expect(shared.cardArgs[0]![2]).toBe(corner);
  });

  it('素材讀不到（null）：照樣建好畫面，交給 createCardObject null（雕花先畫成簡約）', async () => {
    const view = await createCardView(container(), { plainBack, pedestal, frameCorner: null });
    expect(view).toBeTruthy();
    expect(shared.cardArgs[0]![2]).toBeNull();
    expect(shared.renderers[0]!.disposed).toBe(0);
  });
});

describe('建畫面失敗時放掉 renderer（T-416b）', () => {
  it('renderer 初始化失敗 → createCardView 失敗（原本的錯）、renderer 被釋放、畫布拿掉', async () => {
    shared.initFails = true;
    await expect(createCardView(container(), { plainBack, pedestal, frameCorner: corner })).rejects.toThrow('沒有 GPU');
    expect(shared.renderers).toHaveLength(1);
    expect(shared.renderers[0]!.disposed).toBe(1);
    expect(shared.renderers[0]!.removed).toBe(1);
    expect(shared.cardArgs).toHaveLength(0);
  });

  it('初始化成功、建卡片時丟錯 → 一樣釋放 renderer、畫布拿掉', async () => {
    shared.cardThrows = true;
    await expect(createCardView(container(), { plainBack, pedestal, frameCorner: corner })).rejects.toThrow('建卡片失敗');
    expect(shared.renderers[0]!.disposed).toBe(1);
    expect(shared.renderers[0]!.removed).toBe(1);
  });
});
