// 前景圖轉卡微動的接線（T-830c，T-830b 審查的兩條低）：真的載入 src/main.ts（組裝端），取出它交給 3D 的每影格回呼（card-view 的 start），
// 自己一格一格推，核對 main 交給 ui.driftForeground 的值。之前只讀 main.ts 的原始碼文字比對（改成別的寫法就看不出來）。
//   - 有前景圖：照畫面上實際的角度算 render/backdrop 的 foregroundDrift 交出去。
//   - 減少動態：送 0, 0（前景圖停在原位）。
//   - 沒有前景圖（一開始就沒有、或〔拿掉〕之後）：一次都不呼叫（不算、不碰畫面）。
// 其他東西（畫面、3D、存檔、分頁鎖）全換成假的，做法同 tests/app-png-export.test.ts。
// 拿掉 main.ts 的減少動態判斷、或沒前景圖還照呼叫時，這裡會失敗。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setForeground, updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import { foregroundDrift } from '../src/render/backdrop';

const FG_HASH = '00000000000000f7';
const T0 = '2026-10-15T00:00:00.000Z';
const DT = 1 / 60;

const shared = vi.hoisted(() => ({
  startCard: null as unknown,
  intents: null as null | { removeForeground(): void },
  /** card-view 的 start 收到的每影格回呼（main 組好之後才會有）。 */
  frame: null as null | ((dtSec: number) => void),
  /** ui.driftForeground 收到的每一次（x, y）。 */
  drifts: [] as [number, number][],
  /** 「減少動態效果」現在開著嗎（matchMedia 的 matches 每次讀都看這個）。 */
  reduced: false,
  errors: [] as unknown[],
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
    return quiet({
      previewHost: fakeHost(),
      overlayHost: fakeHost(),
      driftForeground: (x: number, y: number) => void shared.drifts.push([x, y]),
    });
  },
}));
vi.mock('../src/ui/overlay', () => ({ createOverlay: () => quiet({}) }));
vi.mock('../src/render/read-image', () => ({ readImage: async () => ({ naturalWidth: 8, naturalHeight: 8 }) }));
vi.mock('../src/render/card-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/card-view')>()),
  createCardView: async () =>
    quiet({
      start: (frame: (dtSec: number) => void) => void (shared.frame = frame),
    }),
}));
vi.mock('../src/images/registry', () => ({
  createImageRegistry: () => quiet({ element: (hash: string) => (hash === FG_HASH ? { naturalWidth: 640, naturalHeight: 480 } : null) }),
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
vi.mock('../src/app/samples', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/samples')>()),
  addNewSamples: async () => [],
}));
vi.mock('../src/interact/pointer', () => ({ attachPointer: () => {} }));
vi.mock('../src/interact/keys', () => ({ attachPreviewKeys: () => quiet({}) }));
vi.mock('../src/ai/runner', () => ({ createAiRunner: () => quiet({}) }));

type HoloAngles = { setAngle(yawDeg: number, pitchDeg: number): void };
const win = { location: { search: '' }, addEventListener() {}, devicePixelRatio: 1, __holo: undefined as HoloAngles | undefined } as Record<string, unknown> & { __holo?: HoloAngles };

beforeAll(async () => {
  // 新卡片預設是工作桌（上下只傾 ±10°，T-832c）；這裡要測各種角度，先換成全息光環（不夾角度）
  shared.startCard = setForeground(updateCard(newCard('standard', 'drift-1', T0), { name: '微動測試卡', view: { stage: 'halo' } }), FG_HASH);
  win.matchMedia = () => ({
    get matches() {
      return shared.reduced;
    },
    addEventListener() {},
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', quiet({ getElementById: () => fakeHost(), addEventListener() {}, hidden: false, visibilityState: 'visible', body: quiet({}) }));
  const errors = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void shared.errors.push(args));
  await import('../src/main');
  // 啟動是非同步的（讀存檔、開卡、3D 準備好）：等到 3D 收到每影格回呼（開好卡、3D 好了之後才有），再讓剩下的同步接線跑完
  for (let i = 0; i < 1000 && !shared.frame; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 20));
  errors.mockRestore();
}, 30_000);
afterAll(() => vi.unstubAllGlobals());

/** 轉到某個角度（開發模式的 __holo.setAngle，定住不動），再推 n 格；回傳這幾格期間 ui.driftForeground 收到的值。 */
function framesAt(yawDeg: number, pitchDeg: number, n = 3): [number, number][] {
  win.__holo!.setAngle(yawDeg, pitchDeg);
  shared.drifts.length = 0;
  for (let i = 0; i < n; i++) shared.frame!(DT);
  return shared.drifts.slice();
}

describe('前景圖轉卡微動（main.ts 每影格）', () => {
  it('組裝端啟動了：拿到每影格回呼、__holo、畫面的意圖、沒有錯誤', () => {
    expect(shared.frame).not.toBeNull();
    expect(win.__holo).toBeDefined();
    expect(shared.intents).not.toBeNull();
    expect(shared.errors).toEqual([]);
  });

  it('有前景圖：每一格都把「畫面上實際角度」的 foregroundDrift 交給 ui.driftForeground（轉去哪裡都對）', () => {
    for (const [yaw, pitch] of [[30, 10], [-55, 0], [0, -12], [90, 20]] as const) {
      const got = framesAt(yaw, pitch);
      const want = foregroundDrift(yaw, pitch);
      expect(got).toHaveLength(3);
      for (const [x, y] of got) {
        expect(x).toBeCloseTo(want.x, 9);
        expect(y).toBeCloseTo(want.y, 9);
      }
    }
    // 方向：往右轉（yaw 變大）往左移、往下轉（pitch 變大）往上移
    const [x, y] = framesAt(30, 10)[0]!;
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
    expect(Math.abs(x)).toBeGreaterThan(0.5);
  });

  it('正面朝前（0, 0）：給 0, 0（不動）', () => {
    for (const [x, y] of framesAt(0, 0)) {
      expect(x).toBeCloseTo(0, 9);
      expect(y).toBeCloseTo(0, 9);
    }
  });

  it('減少動態：轉到哪裡都給 0, 0（前景圖停在原位）；關掉之後馬上又跟著轉', () => {
    shared.reduced = true;
    try {
      const got = framesAt(60, 15);
      expect(got).toHaveLength(3);
      for (const [x, y] of got) {
        expect(Object.is(x, 0)).toBe(true);
        expect(Object.is(y, 0)).toBe(true);
      }
    } finally {
      shared.reduced = false;
    }
    const after = framesAt(60, 15);
    expect(after).toHaveLength(3);
    expect(after[0]![0]).toBeCloseTo(foregroundDrift(60, 15).x, 9);
    expect(Math.abs(after[0]![0])).toBeGreaterThan(0.5);
  });

  it('〔拿掉〕前景圖之後：不管轉到哪裡、減少動態開不開，一次都不呼叫 ui.driftForeground', () => {
    shared.intents!.removeForeground();
    expect(framesAt(45, 10, 5)).toEqual([]);
    shared.reduced = true;
    try {
      expect(framesAt(-30, -5, 5)).toEqual([]);
    } finally {
      shared.reduced = false;
    }
    expect(shared.errors).toEqual([]);
  });
});
