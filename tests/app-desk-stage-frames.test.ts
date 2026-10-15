// 工作桌舞台的轉卡限制在組裝端（main.ts）的接線（T-832c，T-832b 審查的低）：真的載入 src/main.ts，取出它交給 3D 的每影格回呼（card-view 的 start）
// 與預覽區的鍵盤操作（interact/keys 的 turn），自己一格一格推，看 main 交給 3D 的畫面角度（card-view 的 setPose）。
// tests/interact-desk.test.ts 只測純函式（turnLimits、limitPitch…）；這裡驗 main 有沒有照 card.view.stage 把範圍接上去：
//   - 新卡片預設就是工作桌：setAngle 的上下角度夾在 ±10°。
//   - 換進工作桌：已經傾超過 10° 的下一格夾回來；換出：恢復 ±60°（不會殘留 ±10°）。
//   - 換舞台時展示擺動先停（那一格角度不跳、安靜一下），再用新的幅度（工作桌左右 ±11°、上下 ±4°；其他 ±22°、±8°）從當時的角度接上。
//   - 鍵盤轉卡（含減少動態直接到位）也照範圍。
// 其他東西（畫面、3D、存檔、分頁鎖）全換成假的，做法同 tests/app-foreground-drift.test.ts。
// 拿掉 main.ts 的 turnNow().pitch（鍵盤／setAngle）、limitPitch、換舞台時的 pauseShowcase 或展示擺動的 scale 時，這裡會失敗。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';

const T0 = '2026-10-15T00:00:00.000Z';
const DT = 1 / 60;

interface Pose {
  yaw: number;
  pitch: number;
}

const shared = vi.hoisted(() => ({
  startCard: null as unknown,
  /** card-view 的 start 收到的每影格回呼（main 組好之後才會有）。 */
  frame: null as null | ((dtSec: number) => void),
  /** card-view 的 setPose 收到的每一次（畫面上實際的角度）。 */
  poses: [] as { yaw: number; pitch: number }[],
  /** 預覽區鍵盤操作（interact/keys）的 turn：main 接上去的那個。 */
  turnKey: null as null | ((dYawDeg: number, dPitchDeg: number) => void),
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
  createUi: () => quiet({ previewHost: fakeHost(), overlayHost: fakeHost() }),
}));
vi.mock('../src/ui/overlay', () => ({ createOverlay: () => quiet({}) }));
vi.mock('../src/render/read-image', () => ({ readImage: async () => ({ naturalWidth: 8, naturalHeight: 8 }) }));
vi.mock('../src/render/card-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/card-view')>()),
  createCardView: async () =>
    quiet({
      start: (frame: (dtSec: number) => void) => void (shared.frame = frame),
      setPose: (pose: { yawDeg: number; pitchDeg: number }) => void shared.poses.push({ yaw: pose.yawDeg, pitch: pose.pitchDeg }),
    }),
}));
vi.mock('../src/images/registry', () => ({ createImageRegistry: () => quiet({ element: () => null }) }));
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
vi.mock('../src/interact/keys', () => ({
  attachPreviewKeys: (_host: unknown, hooks: { turn(dYawDeg: number, dPitchDeg: number): void }) => {
    shared.turnKey = hooks.turn;
    return quiet({});
  },
}));
vi.mock('../src/ai/runner', () => ({ createAiRunner: () => quiet({}) }));

interface Holo {
  setAngle(yawDeg: number, pitchDeg: number): void;
  setCard(patch: { view?: { stage?: string; showcase?: boolean } }): void;
  view(): { yaw: number; pitch: number };
}
const win = { location: { search: '' }, addEventListener() {}, devicePixelRatio: 1, __holo: undefined as Holo | undefined } as Record<string, unknown> & { __holo?: Holo };

beforeAll(async () => {
  // 什麼都不改的新卡片：預設舞台就是工作桌（T-832c）
  shared.startCard = newCard('standard', 'desk-frames-1', T0);
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

const holo = () => win.__holo!;
const lastPose = (): Pose => shared.poses.at(-1)!;
/** 推 n 格，回傳每一格畫完之後 main 交給 3D 的角度。 */
function frames(n: number): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < n; i++) {
    const before = shared.poses.length;
    shared.frame!(DT);
    // 每一格 main 都會 setPose 一次（applyPose）
    expect(shared.poses.length, '每一格都要交一次角度給 3D').toBe(before + 1);
    out.push(lastPose());
  }
  return out;
}
const onStage = (stage: 'halo' | 'desk', showcase = false) => holo().setCard({ view: { stage, showcase } });
const secs = (s: number) => Math.round(s * 60);

describe('工作桌舞台的轉卡範圍（main.ts 每影格與鍵盤）', () => {
  it('組裝端啟動了：拿到每影格回呼、__holo、鍵盤轉卡、沒有錯誤；新卡片（預設舞台）上下只能傾 ±10°', () => {
    expect(shared.frame).not.toBeNull();
    expect(win.__holo).toBeDefined();
    expect(shared.turnKey).not.toBeNull();
    expect(shared.errors).toEqual([]);
    // 還沒換過舞台：新卡片預設就是工作桌
    holo().setAngle(25, 40);
    expect(lastPose()).toEqual({ yaw: 25, pitch: 10 });
    expect(frames(1)[0]).toEqual({ yaw: 25, pitch: 10 });
    holo().setAngle(-25, -40);
    expect(lastPose()).toEqual({ yaw: -25, pitch: -10 });
  });

  it('setAngle：工作桌夾 ±10°、其他舞台 ±60°；左右不限', () => {
    onStage('halo');
    holo().setAngle(30, 40);
    expect(lastPose()).toEqual({ yaw: 30, pitch: 40 });
    holo().setAngle(30, 90);
    expect(lastPose().pitch).toBe(60);
    onStage('desk');
    holo().setAngle(30, 40);
    expect(lastPose()).toEqual({ yaw: 30, pitch: 10 });
    holo().setAngle(200, -40);
    expect(lastPose()).toEqual({ yaw: 200, pitch: -10 });
  });

  it('換進工作桌：已經傾超過 10° 的，下一格夾回 ±10°（左右不動）；換出：恢復 ±60°，不殘留', () => {
    onStage('halo');
    holo().setAngle(20, 45);
    expect(frames(2).map((p) => p.pitch)).toEqual([45, 45]);
    onStage('desk');
    expect(frames(1)[0]).toEqual({ yaw: 20, pitch: 10 });
    holo().setAngle(20, -50);
    onStage('halo');
    holo().setAngle(20, -50);
    expect(frames(1)[0]).toEqual({ yaw: 20, pitch: -50 });
    onStage('desk');
    expect(frames(1)[0]).toEqual({ yaw: 20, pitch: -10 });
    onStage('halo');
    holo().setAngle(0, 55);
    expect(frames(3).map((p) => p.pitch)).toEqual([55, 55, 55]);
  });

  it('鍵盤轉卡（平順）：工作桌往上往下按到底都停在 ±10°（過程中也不超過）；換出之後照舊 ±60°', () => {
    shared.reduced = false;
    onStage('desk');
    holo().setAngle(0, 0);
    shared.turnKey!(0, 45);
    const down = frames(secs(2)).map((p) => p.pitch);
    expect(Math.max(...down)).toBeLessThanOrEqual(10 + 1e-9);
    expect(down.at(-1)).toBeCloseTo(10, 6);
    shared.turnKey!(0, -90);
    const up = frames(secs(2)).map((p) => p.pitch);
    expect(Math.min(...up)).toBeGreaterThanOrEqual(-10 - 1e-9);
    expect(up.at(-1)).toBeCloseTo(-10, 6);
    onStage('halo');
    shared.turnKey!(0, 45);
    const free = frames(secs(2)).map((p) => p.pitch);
    expect(Math.max(...free)).toBeGreaterThan(10);
    expect(free.at(-1)).toBeCloseTo(35, 6);
  });

  it('減少動態：鍵盤轉卡直接到位，也照範圍（工作桌 ±10°、換出之後 ±60°）', () => {
    shared.reduced = true;
    try {
      onStage('desk');
      holo().setAngle(0, 0);
      // 按下去的當下（還沒推影格）就在範圍裡：之後每格夾回來（limitPitch）只是第二道保險
      shared.turnKey!(0, 45);
      expect(holo().view().pitch).toBe(10);
      expect(frames(1)[0]!.pitch).toBe(10);
      shared.turnKey!(0, -90);
      expect(holo().view().pitch).toBe(-10);
      expect(frames(1)[0]!.pitch).toBe(-10);
      shared.turnKey!(30, 0);
      expect(frames(1)[0]).toEqual({ yaw: 30, pitch: -10 });
      onStage('halo');
      shared.turnKey!(0, 45);
      expect(holo().view().pitch).toBe(35);
      expect(frames(1)[0]!.pitch).toBe(35);
      shared.turnKey!(0, 45);
      expect(holo().view().pitch).toBe(60);
      expect(frames(1)[0]!.pitch).toBe(60);
    } finally {
      shared.reduced = false;
    }
  });
});

describe('展示擺動換舞台（工作桌減半）', () => {
  /** 從正面開始擺（關掉再打開讓狀態歸零），推 sec 秒，回傳每一格的角度。 */
  function startShowcase(stage: 'halo' | 'desk', sec: number): Pose[] {
    onStage(stage, false);
    frames(2);
    onStage(stage, true);
    holo().setAngle(0, 0);
    return frames(secs(sec));
  }
  const maxAbs = (poses: Pose[], key: keyof Pose) => Math.max(...poses.map((p) => Math.abs(p[key])));
  const maxStep = (poses: Pose[]) => Math.max(...poses.slice(1).map((p, i) => Math.hypot(p.yaw - poses[i]!.yaw, p.pitch - poses[i]!.pitch)));

  it('其他舞台 → 工作桌：那一格角度不跳、停一下，再用一半的幅度（左右 ±11°、上下 ±4°）從當時的角度接上', () => {
    // 擺到第 10 秒：左右角度正好在最大處（22 × sin(2π × 10 / 8) ＝ 22），這時換舞台，不先停的話幅度一減半角度就跳 11°
    const before = startShowcase('halo', 10);
    expect(maxAbs(before, 'yaw')).toBeGreaterThan(21); // 一般舞台擺得到 ±22°
    const peak = before.at(-1)!;
    expect(Math.abs(peak.yaw)).toBeGreaterThan(21);
    onStage('desk', true);
    const after = frames(secs(20));
    // 換的那一格：和上一格一模一樣（沒有跳）；接下來安靜 1.5 秒（約 90 格）都不動
    expect(after[0]).toEqual(peak);
    for (const p of after.slice(0, secs(1.4))) expect(p).toEqual(peak);
    // 整段（換之前到換之後）每格最多移 1°（一般的擺動每格約 0.3°；沒先停的話換的那一格會跳 10° 以上）
    expect(maxStep([peak, ...after])).toBeLessThan(1);
    // 接上（最久 1.5＋4 秒）之後，用工作桌的幅度擺
    const settled = after.slice(secs(8));
    expect(maxAbs(settled, 'yaw')).toBeGreaterThan(10);
    expect(maxAbs(settled, 'yaw')).toBeLessThanOrEqual(11 + 1e-6);
    expect(maxAbs(settled, 'pitch')).toBeGreaterThan(3);
    expect(maxAbs(settled, 'pitch')).toBeLessThanOrEqual(4 + 1e-6);
    // 工作桌的上下範圍 ±10° 之內
    expect(maxAbs(after, 'pitch')).toBeLessThanOrEqual(10);
  });

  it('工作桌 → 其他舞台：一樣先停、不跳，再恢復 ±22°、±8°', () => {
    const before = startShowcase('desk', 10);
    expect(maxAbs(before, 'yaw')).toBeLessThanOrEqual(11 + 1e-6);
    const peak = before.at(-1)!;
    expect(Math.abs(peak.yaw)).toBeGreaterThan(10);
    onStage('halo', true);
    const after = frames(secs(24));
    expect(after[0]).toEqual(peak);
    for (const p of after.slice(0, secs(1.4))) expect(p).toEqual(peak);
    expect(maxStep([peak, ...after])).toBeLessThan(1);
    const settled = after.slice(secs(8));
    expect(maxAbs(settled, 'yaw')).toBeGreaterThan(21);
    expect(maxAbs(settled, 'yaw')).toBeLessThanOrEqual(22 + 1e-6);
    expect(maxAbs(settled, 'pitch')).toBeGreaterThan(7);
    expect(maxAbs(settled, 'pitch')).toBeLessThanOrEqual(8 + 1e-6);
  });
});
