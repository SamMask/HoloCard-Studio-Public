// PNG 匯出（目前角度）帶遠景位置（T-822b ②）：真的載入 src/main.ts（組裝端）、走畫面上的〔匯出 PNG〕意圖（UiIntents.exportPng），
// 攔 3D 的 captureCard，核對收到的 backdrop 帶著「目前這張卡」的 farPan。之前只讀 main.ts 的原始碼文字比對，改壞接線也看不出來。
// 其他東西（畫面、3D、存檔、分頁鎖）全換成假的：ui/app、render/card-view、app/session、images/registry、app/tab-lock、storage/store 等。
// 改壞 PNG 的背景選擇或遠景位置接線時這裡會失敗。
// 前景圖（T-830）：同一個〔畫上背景〕勾選，captureCard 收到的 foreground 帶著目前這張卡的前景圖（圖＋位置、大小、模糊）；
// 勾掉、〔拿掉〕前景圖（UiIntents.removeForeground）之後不帶。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setBackdrop, setForeground, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, FarPan } from '../src/model/types';
import type { BackdropImage, CaptureOptions, ForegroundImage } from '../src/render/card-view';

const BACKDROP_HASH = '00000000000000b7';
const FG_HASH = '00000000000000f7';
const T0 = '2026-10-15T00:00:00.000Z';

const shared = vi.hoisted(() => ({
  startCard: null as unknown,
  intents: null as null | {
    exportPng(transparent: boolean, includeSleeve?: boolean, includeBackdrop?: boolean, includeStageFar?: boolean): Promise<void>;
    editCard(patch: unknown, phase: string): void;
    removeForeground(): void;
    removeBackdrop(): void;
  },
  captures: [] as unknown[],
  downloads: [] as string[],
  errors: [] as unknown[],
  sceneReady: false,
  stagePaths: [] as string[],
  backdropImage: { naturalWidth: 1600, naturalHeight: 900, tag: 'backdrop' } as Record<string, unknown>,
  foregroundImage: { naturalWidth: 640, naturalHeight: 480, tag: 'foreground' } as Record<string, unknown>,
}));

/** 任何沒寫的方法都是「什麼也不做」的假物件（then 要是 undefined，不然從 async 函式回傳時會被當成 Promise）。 */
const quiet = <T extends object>(known: T): T =>
  new Proxy(known, {
    get: (target, key) => (key in target ? (target as Record<PropertyKey, unknown>)[key] : key === 'then' ? undefined : () => undefined),
  });
const fakeHost = () => quiet({ addEventListener() {}, append() {}, style: {}, clientWidth: 800, clientHeight: 500 });

vi.mock('../src/ui/app', () => ({
  createUi: (_root: unknown, intents: typeof shared.intents) => {
    shared.intents = intents;
    return quiet({ previewHost: fakeHost(), overlayHost: fakeHost() });
  },
}));
vi.mock('../src/ui/overlay', () => ({ createOverlay: () => quiet({}) }));
vi.mock('../src/render/read-image', () => ({ readImage: async (_read: unknown, path: string) => {
  shared.stagePaths.push(path);
  return { naturalWidth: 8, naturalHeight: 8, src: path };
} }));
vi.mock('../src/render/card-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/card-view')>()),
  createCardView: async () =>
    quiet({
      // 組裝端開好卡、3D 好了之後每次 update 都會交一次遠景位置：第一次收到＝啟動完成
      setFarPan: () => void (shared.sceneReady = true),
      async captureCard(options: CaptureOptions) {
        shared.captures.push(options);
        return new Blob([new Uint8Array(1)], { type: 'image/png' });
      },
    }),
}));
vi.mock('../src/images/registry', () => ({
  createImageRegistry: () =>
    quiet({
      element: (hash: string) => (hash === '00000000000000b7' ? shared.backdropImage : hash === '00000000000000f7' ? shared.foregroundImage : null),
    }),
}));
vi.mock('../src/app/session', () => ({
  createSession: (deps: { show(card: unknown): void }) =>
    quiet({
      chooseStart: async () => ({ card: shared.startCard, thumbnail: null }),
      openStart: async (card: unknown) => deps.show(card),
      saver: quiet({}),
    }),
}));
vi.mock('../src/app/tab-lock', () => ({
  browserLocks: () => ({}),
  browserChannel: () => ({}),
  createTabLock: () => quiet({ acquire: async () => {}, holding: () => true }),
  guardWrites: (store: unknown) => store,
}));
vi.mock('../src/storage/store', () => ({ openCardStore: async () => ({}) }));
// 開工坊後在背景補新的範例（T-829）：存檔是假的，這裡不測（tests/app-samples-topup.test.ts 測）
vi.mock('../src/app/samples', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/samples')>()),
  addNewSamples: async () => [],
}));
vi.mock('../src/interact/pointer', () => ({ attachPointer: () => {} }));
vi.mock('../src/interact/keys', () => ({ attachPreviewKeys: () => quiet({}) }));
vi.mock('../src/ai/runner', () => ({ createAiRunner: () => quiet({}) }));
vi.mock('../src/app/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/files')>()),
  downloadBlob: (_blob: Blob, name: string) => void shared.downloads.push(name),
}));

const PAN: FarPan = { x: 0.4, y: -0.25, zoom: 1.5 };
const withPan = (card: Card, pan: FarPan): Card => updateCard(card, { view: { farPan: pan } });
const baseCard = (): Card =>
  setForeground(setBackdrop(updateCard(newCard('standard', 'png-1', T0), { name: '匯出測試卡' }), BACKDROP_HASH), FG_HASH);

beforeAll(async () => {
  shared.startCard = withPan(baseCard(), PAN);
  vi.stubGlobal('window', {
    location: { search: '' },
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    devicePixelRatio: 1,
  });
  vi.stubGlobal('document', quiet({ getElementById: () => fakeHost(), addEventListener() {}, hidden: false, visibilityState: 'visible', body: quiet({}) }));
  const errors = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void shared.errors.push(args));
  await import('../src/main');
  // 啟動是非同步的（讀存檔、開卡、3D 準備好）：等到 3D 收到第一次遠景位置（開好卡、3D 好了之後才會有），再讓剩下的同步接線跑完
  for (let i = 0; i < 1000 && !shared.sceneReady; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 20));
  errors.mockRestore();
});
afterAll(() => vi.unstubAllGlobals());

const lastCapture = () => shared.captures.at(-1) as CaptureOptions & { backdrop: BackdropImage | null; foreground: ForegroundImage | null };

describe('PNG 匯出（目前角度）帶遠景位置', () => {
  it('組裝端啟動了：3D 收到過遠景位置、拿到畫面的意圖、沒有錯誤', () => {
    expect(shared.sceneReady).toBe(true);
    expect(shared.errors).toEqual([]);
    expect(shared.intents).not.toBeNull();
  });

  it('有背景圖、卡片調過位置：captureCard 收到的 backdrop 帶著這張卡的 farPan（同一張圖）', async () => {
    await shared.intents!.exportPng(false);
    expect(shared.errors).toEqual([]);
    const options = lastCapture();
    expect(options.pose).toBe('current');
    expect(options.backdrop).not.toBeNull();
    expect(options.backdrop!.pan).toEqual(PAN);
    expect(options.backdrop!.image).toBe(shared.backdropImage);
    expect(options.backdrop!.width).toBe(1600);
    expect(options.backdrop!.height).toBe(900);
    expect(shared.downloads.at(-1)).toBe('匯出測試卡.png');
  });

  it('編輯之後再匯出：用的是目前卡片的位置，不是開卡時的（透明背景勾著也一樣帶）', async () => {
    shared.intents!.editCard({ view: { farPan: { x: -0.6, y: 0.1, zoom: 2 } } }, 'commit');
    await shared.intents!.exportPng(true);
    expect(lastCapture().transparent).toBe(true);
    expect(lastCapture().backdrop!.pan).toEqual({ x: -0.6, y: 0.1, zoom: 2 });
  });

  it('位置回到預設（{0,0,1}）：背景圖原樣（不帶 pan）；〔畫上背景〕沒勾：沒有背景圖', async () => {
    shared.intents!.editCard({ view: { farPan: { x: 0, y: 0, zoom: 1 } } }, 'commit');
    await shared.intents!.exportPng(false);
    expect(lastCapture().backdrop).not.toBeNull();
    expect(lastCapture().backdrop!.pan).toBeUndefined();
    shared.intents!.editCard({ view: { farPan: PAN } }, 'commit');
    await shared.intents!.exportPng(false, true, false);
    expect(lastCapture().backdrop).toBeNull();
    await shared.intents!.exportPng(false, true, true);
    expect(lastCapture().backdrop!.pan).toEqual(PAN);
  });
});

describe('PNG 匯出帶前景圖（T-830）', () => {
  it('〔畫上背景〕勾著：foreground＝這張卡的前景圖（同一張圖、原圖寬高、目前的位置、大小、模糊）；勾掉：不帶', async () => {
    shared.intents!.editCard({ view: { foreground: { x: 0.2, blur: 65 } } }, 'commit');
    await shared.intents!.exportPng(false, true, true);
    expect(shared.errors).toEqual([]);
    const fg = lastCapture().foreground!;
    expect(fg.image).toBe(shared.foregroundImage);
    expect([fg.width, fg.height]).toEqual([640, 480]);
    expect(fg.place).toEqual({ x: 0.2, y: -0.6, scale: 1, blur: 65 });
    await shared.intents!.exportPng(false, true, false);
    expect(lastCapture().foreground ?? null).toBeNull();
  });

  it('〔拿掉〕前景圖之後：不帶', async () => {
    shared.intents!.removeForeground();
    await shared.intents!.exportPng(false, true, true);
    expect(lastCapture().foreground ?? null).toBeNull();
    expect(lastCapture().backdrop).not.toBeNull();
  });
});

describe('T-842 PNG 主接線：四種舞台的遠景', () => {
  it('勾選後四種舞台讀正確原圖、沿用 farPan；水鏡三選一', async () => {
    shared.intents!.removeBackdrop();
    for (const [stage, waterScene, path] of [
      ['gallery', undefined, 'gallery-hall.webp'],
      ['water', 'lake', 'water-lake.webp'],
      ['water', 'ink', 'water-ink.webp'],
      ['water', 'fuji', 'water-fuji.webp'],
      ['nebula', undefined, 'nebula.webp'],
      ['desk', undefined, 'desk.webp'],
    ] as const) {
      shared.intents!.editCard({ view: { stage, waterScene, farPan: PAN } }, 'commit');
      await shared.intents!.exportPng(false, true, true, true);
      const b = lastCapture().backdrop!;
      expect(b).not.toBeNull();
      expect((b.image as HTMLImageElement).src.endsWith(`/stages/${path}`)).toBe(true);
      expect(b.pan).toEqual(PAN);
      expect([b.width, b.height]).toEqual([8, 8]);
    }
  });

  it('新勾選省略／false：captureCard 的所有選項與原本相同，工作桌不額外讀圖', async () => {
    shared.intents!.editCard({ view: { stage: 'desk' } }, 'commit');
    const before = shared.stagePaths.length;
    await shared.intents!.exportPng(true, false, false);
    const legacy = lastCapture();
    expect(legacy).toEqual({ width: 1500, transparent: true, pose: 'current', sleeve: false, backdrop: null, foreground: null });
    await shared.intents!.exportPng(true, false, false, false);
    expect(lastCapture()).toEqual(legacy);
    expect(shared.stagePaths.length).toBe(before);
  });
});
