// 鍵盤操作預覽區（T-607，DESIGN §8.2）：按鍵 → 轉卡／縮放／翻面／移動圖層的意圖（純函式）、轉卡的平順動畫（view.ts）、
// 連按合成一步（停手 0.6 秒才記）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachPreviewKeys,
  KEY_FINE_DEG,
  KEY_MOVE_BIG,
  KEY_MOVE_STEP,
  KEY_PITCH_DEG,
  KEY_SCALE_STEP,
  KEY_YAW_DEG,
  moveByKey,
  previewKeyAction,
  scaleByKey,
  type KeyInput,
  type PreviewKeyHandlers,
} from '../src/interact/keys';
import {
  beginDrag,
  endDrag,
  initialShowcase,
  initialView,
  KEY_MAX_LEAD_DEG,
  PITCH_LIMIT_DEG,
  pauseShowcase,
  releaseInPlace,
  settleNow,
  stepShowcase,
  tick,
  turnByKey,
  turnToFace,
  visibleFace,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomByKey,
  type ViewState,
} from '../src/interact/view';
import { FakeEvent, installFakeDom } from './ui-fake-dom';

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});
const NONE = { layerSelected: false };
const LAYER = { layerSelected: true };

/** 一直 tick 到停下來（最多 6 秒）。 */
function settle(s: ViewState): ViewState {
  let v = s;
  for (let i = 0; i < 600 && v.mode === 'returning'; i++) v = tick(v, 1 / 100);
  return v;
}

describe('按鍵 → 意圖：沒選圖層時轉卡', () => {
  it('← → 左右轉 15°（→ 是 +yaw，和往右拖一樣）；↑ ↓ 上下轉 10°（↓ 是 +pitch，和往下拖一樣）', () => {
    expect(KEY_YAW_DEG).toBe(15);
    expect(KEY_PITCH_DEG).toBe(10);
    expect(previewKeyAction(key('ArrowRight'), NONE)).toEqual({ kind: 'turn', yaw: 15, pitch: 0 });
    expect(previewKeyAction(key('ArrowLeft'), NONE)).toEqual({ kind: 'turn', yaw: -15, pitch: 0 });
    expect(previewKeyAction(key('ArrowDown'), NONE)).toEqual({ kind: 'turn', yaw: 0, pitch: 10 });
    expect(previewKeyAction(key('ArrowUp'), NONE)).toEqual({ kind: 'turn', yaw: 0, pitch: -10 });
  });

  it('按住 Shift 轉得細一點：5°', () => {
    expect(KEY_FINE_DEG).toBe(5);
    expect(previewKeyAction(key('ArrowRight', { shiftKey: true }), NONE)).toEqual({ kind: 'turn', yaw: 5, pitch: 0 });
    expect(previewKeyAction(key('ArrowUp', { shiftKey: true }), NONE)).toEqual({ kind: 'turn', yaw: 0, pitch: -5 });
  });

  it('Home 回正面；F（大小寫都可以）翻面', () => {
    expect(previewKeyAction(key('Home'), NONE)).toEqual({ kind: 'home' });
    expect(previewKeyAction(key('f'), NONE)).toEqual({ kind: 'flip' });
    expect(previewKeyAction(key('F', { shiftKey: true }), NONE)).toEqual({ kind: 'flip' });
  });

  it('PageUp／+（=）放大、PageDown／−縮小', () => {
    expect(previewKeyAction(key('PageUp'), NONE)).toEqual({ kind: 'zoom', dir: 1 });
    expect(previewKeyAction(key('PageDown'), NONE)).toEqual({ kind: 'zoom', dir: -1 });
    expect(previewKeyAction(key('+', { shiftKey: true }), NONE)).toEqual({ kind: 'zoom', dir: 1 });
    expect(previewKeyAction(key('='), NONE)).toEqual({ kind: 'zoom', dir: 1 });
    expect(previewKeyAction(key('-'), NONE)).toEqual({ kind: 'zoom', dir: -1 });
  });

  it('反光層被選中時（不能移動的圖層）：方向鍵照樣是轉卡、+ − 照樣是縮放卡片', () => {
    // 呼叫端把「選中可以移動的圖層」傳 false（反光層選著也一樣）
    expect(previewKeyAction(key('ArrowLeft'), { layerSelected: false })).toEqual({ kind: 'turn', yaw: -15, pitch: 0 });
    expect(previewKeyAction(key('+'), { layerSelected: false })).toEqual({ kind: 'zoom', dir: 1 });
  });
});

describe('按鍵 → 意圖：選中圖層時移動、縮放那一層', () => {
  it('方向鍵移動：每次 1% 卡寬（Shift 5%）；↑ 是 +y（上）、→ 是 +x（右）', () => {
    expect(KEY_MOVE_STEP).toBe(0.01);
    expect(KEY_MOVE_BIG).toBe(0.05);
    expect(previewKeyAction(key('ArrowRight'), LAYER)).toEqual({ kind: 'move', dx: 0.01, dy: 0 });
    expect(previewKeyAction(key('ArrowLeft'), LAYER)).toEqual({ kind: 'move', dx: -0.01, dy: 0 });
    expect(previewKeyAction(key('ArrowUp'), LAYER)).toEqual({ kind: 'move', dx: 0, dy: 0.01 });
    expect(previewKeyAction(key('ArrowDown'), LAYER)).toEqual({ kind: 'move', dx: 0, dy: -0.01 });
    expect(previewKeyAction(key('ArrowRight', { shiftKey: true }), LAYER)).toEqual({ kind: 'move', dx: 0.05, dy: 0 });
  });

  it('+ − 縮放那一層（一次 5%）；PageUp／PageDown 還是縮放卡片', () => {
    expect(KEY_SCALE_STEP).toBe(1.05);
    expect(previewKeyAction(key('+', { shiftKey: true }), LAYER)).toEqual({ kind: 'scale', factor: 1.05 });
    expect(previewKeyAction(key('='), LAYER)).toEqual({ kind: 'scale', factor: 1.05 });
    expect(previewKeyAction(key('-'), LAYER)).toEqual({ kind: 'scale', factor: 1 / 1.05 });
    expect(previewKeyAction(key('PageUp'), LAYER)).toEqual({ kind: 'zoom', dir: 1 });
    expect(previewKeyAction(key('PageDown'), LAYER)).toEqual({ kind: 'zoom', dir: -1 });
  });

  it('Home、F 不管有沒有選圖層都照樣是回正、翻面', () => {
    expect(previewKeyAction(key('Home'), LAYER)).toEqual({ kind: 'home' });
    expect(previewKeyAction(key('f'), LAYER)).toEqual({ kind: 'flip' });
  });

  it('moveByKey：加上位移、夾在 ±1、去掉小數誤差', () => {
    expect(moveByKey({ x: 0, y: 0 }, 0.01, 0)).toEqual({ x: 0.01, y: 0 });
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 3; i++) p = moveByKey(p, 0.01, 0);
    expect(p.x).toBe(0.03);
    expect(moveByKey({ x: 0.99, y: -0.995 }, 0.05, -0.05)).toEqual({ x: 1, y: -1 });
  });

  it('scaleByKey：乘上倍率、夾在 0.05～4', () => {
    expect(scaleByKey(1, 1.05)).toBeCloseTo(1.05, 10);
    expect(scaleByKey(3.99, 1.05)).toBe(4);
    expect(scaleByKey(0.051, 1 / 1.05)).toBe(0.05);
  });
});

describe('按鍵 → 意圖：不攔的按鍵', () => {
  it('Ctrl／Cmd／Alt 一起按的不管（Ctrl+Z／Y、瀏覽器的 Alt+←、Ctrl++ 放大網頁都照舊）', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(previewKeyAction(key('ArrowLeft', mod), NONE)).toBeNull();
      expect(previewKeyAction(key('z', mod), NONE)).toBeNull();
      expect(previewKeyAction(key('+', mod), NONE)).toBeNull();
      expect(previewKeyAction(key('f', mod), NONE)).toBeNull();
    }
  });

  it('已經被別人處理過（defaultPrevented）的不管（T-607c）', () => {
    expect(previewKeyAction(key('ArrowLeft', { defaultPrevented: true }), NONE)).toBeNull();
    expect(previewKeyAction(key('Home', { defaultPrevented: true }), LAYER)).toBeNull();
  });

  it('輸入法選字中、Tab、Esc、Delete、字母不是我們的鍵 → null（Esc 與 Delete 由別處處理）', () => {
    expect(previewKeyAction(key('ArrowLeft', { isComposing: true }), NONE)).toBeNull();
    for (const k of ['Tab', 'Escape', 'Enter', ' ', 'a', 'Delete', 'Backspace', 'End']) expect(previewKeyAction(key(k), LAYER)).toBeNull();
  });
});

describe('轉卡的平順動畫（view.ts）', () => {
  it('按一下：目標＝現在 ±15°，卡片慢慢轉過去，停在那裡（不會彈回正面）', () => {
    const s = turnByKey(initialView(), 15, 0, true);
    expect(s.mode).toBe('returning');
    expect(s.yaw).toBe(0);
    expect(s.targetYaw).toBe(15);
    const done = settle(s);
    expect(done.mode).toBe('idle');
    expect(done.yaw).toBe(15);
    expect(done.pitch).toBe(0);
  });

  it('上下轉：停在 pitch 目標（不會回到 0）', () => {
    const done = settle(turnByKey(initialView(), 0, 10, true));
    expect(done.mode).toBe('idle');
    expect(done.pitch).toBe(10);
    expect(done.yaw).toBe(0);
  });

  it('連按：在上一次的目標上累加（不是從還沒轉到的目前角度算）', () => {
    let s = turnByKey(initialView(), 15, 0, true);
    s = tick(s, 0.05);
    expect(s.yaw).toBeGreaterThan(0);
    expect(s.yaw).toBeLessThan(15);
    s = turnByKey(s, 15, 0, true);
    expect(s.targetYaw).toBe(30);
    expect(settle(s).yaw).toBe(30);
  });

  it('連按不會越跑越遠：目標最多領先目前角度 KEY_MAX_LEAD_DEG（45°），放手後很快停下來', () => {
    expect(KEY_MAX_LEAD_DEG).toBe(45);
    let s = initialView();
    for (let i = 0; i < 40; i++) s = turnByKey(s, 15, 0, true);
    expect(s.targetYaw).toBe(45);
    s = tick(s, 0.2);
    s = turnByKey(s, 15, 0, true);
    expect(s.targetYaw - s.yaw).toBeLessThanOrEqual(45 + 1e-9);
    expect(settle(s).yaw).toBeLessThan(120);
  });

  it('pitch 夾在 ±60°', () => {
    let s = initialView();
    for (let i = 0; i < 10; i++) s = turnByKey(s, 0, 10, true);
    expect(s.targetPitch).toBe(PITCH_LIMIT_DEG);
    expect(settle(s).pitch).toBe(PITCH_LIMIT_DEG);
    s = initialView();
    for (let i = 0; i < 10; i++) s = turnByKey(s, 0, -10, true);
    expect(s.targetPitch).toBe(-PITCH_LIMIT_DEG);
  });

  it('滑鼠正在拖的時候不插手', () => {
    const dragging = beginDrag(initialView());
    expect(turnByKey(dragging, 15, 0, true)).toBe(dragging);
    expect(turnByKey(dragging, 15, 0, false)).toBe(dragging);
  });

  it('減少動態（smooth=false）：直接到位，不經過動畫', () => {
    const s = turnByKey(initialView(), 15, 10, false);
    expect(s.mode).toBe('idle');
    expect(s.yaw).toBe(15);
    expect(s.pitch).toBe(10);
    // 連按照樣累加，pitch 照樣夾
    let t = s;
    for (let i = 0; i < 10; i++) t = turnByKey(t, 15, 10, false);
    expect(t.yaw).toBe(165);
    expect(t.pitch).toBe(PITCH_LIMIT_DEG);
  });

  it('從回正中（滑鼠剛放開）按鍵：接在回正的目標上', () => {
    let s = endDrag(beginDrag({ ...initialView(), yaw: 170 }));
    expect(s.targetYaw).toBe(180);
    s = turnByKey(s, 15, 0, true);
    expect(s.targetYaw).toBe(195);
    expect(settle(s).yaw).toBe(195);
  });

  it('翻面途中只按 ↑ ↓（不轉左右）：保留翻面的目標，不會把 180° 截成 45°（T-607c）', () => {
    const flipping = turnToFace(initialView(), 'back');
    expect(flipping.targetYaw).toBe(180);
    const s = turnByKey(flipping, 0, -10, true);
    expect(s.targetYaw).toBe(180);
    expect(s.targetPitch).toBe(-10);
    const done = settle(s);
    expect(done.yaw).toBe(180);
    expect(done.pitch).toBe(-10);
    // 轉到一半才按也一樣
    const half = tick(flipping, 0.1);
    expect(half.yaw).toBeGreaterThan(0);
    expect(half.yaw).toBeLessThan(135);
    expect(turnByKey(half, 0, 10, true).targetYaw).toBe(180);
  });

  it('回正途中只按 ↑ ↓：保留回正的目標（不往回拉）', () => {
    const returning = turnToFace({ ...initialView(), yaw: 150 }, 'front');
    expect(returning.targetYaw).toBe(0);
    expect(turnByKey(returning, 0, 10, true).targetYaw).toBe(0);
  });

  it('翻面途中按 → ←：在翻面目標上加減 15°，不截斷', () => {
    const flipping = tick(turnToFace(initialView(), 'back'), 0.05);
    expect(turnByKey(flipping, 15, 0, true).targetYaw).toBe(195);
    expect(turnByKey(flipping, -15, 0, true).targetYaw).toBe(165);
  });

  it('翻面途中一直按 →：最多到翻面目標再過 45°（不會越轉越遠）', () => {
    let s = turnToFace(initialView(), 'back');
    for (let i = 0; i < 40; i++) s = turnByKey(s, 15, 0, true);
    expect(s.targetYaw).toBe(180 + KEY_MAX_LEAD_DEG);
    expect(settle(s).yaw).toBe(180 + KEY_MAX_LEAD_DEG);
  });

  it('翻面途中一直按 ←（往目前角度的方向）：最多到翻面目標少 45°，不會把翻面拉回正面（T-607c 審查）', () => {
    let s = turnToFace(initialView(), 'back');
    const target = s.targetYaw;
    for (let i = 0; i < 40; i++) s = turnByKey(s, -15, 0, true);
    expect(s.targetYaw).toBe(target - KEY_MAX_LEAD_DEG);
    expect(settle(s).yaw).toBe(target - KEY_MAX_LEAD_DEG);
  });

  it('背面翻回正面途中連按 ← 或 →：都停在正面 ±45°', () => {
    const fromBack = turnToFace({ ...initialView(), yaw: 180, targetYaw: 180 }, 'front');
    const target = fromBack.targetYaw;
    let left = fromBack;
    let right = fromBack;
    for (let i = 0; i < 40; i++) {
      left = turnByKey(left, -15, 0, true);
      right = turnByKey(right, 15, 0, true);
    }
    expect(left.targetYaw).toBe(target - KEY_MAX_LEAD_DEG);
    expect(right.targetYaw).toBe(target + KEY_MAX_LEAD_DEG);
  });

  it('鍵盤轉過 pitch 之後，滑鼠拖一下放開，還是會回到 pitch 0、最近的一面', () => {
    const turned = settle(turnByKey(initialView(), 0, 30, true));
    expect(turned.pitch).toBe(30);
    const back = settle(endDrag(beginDrag(turned)));
    expect(back.pitch).toBe(0);
    expect(back.yaw).toBe(0);
  });

  it('鍵盤轉過 pitch 之後，切面（turnToFace）pitch 也回到 0', () => {
    const turned = settle(turnByKey(initialView(), 0, 30, true));
    const flipped = settle(turnToFace(turned, 'back'));
    expect(flipped.pitch).toBe(0);
    expect(flipped.yaw).toBe(180);
  });

  it('settleNow：回正中的卡片直接放到目標（減少動態時回正、翻面用）；沒在動的原樣不變', () => {
    const s = settleNow(turnToFace({ ...initialView(), yaw: 100, pitch: 20 }, 'front'));
    expect(s.mode).toBe('idle');
    expect(s.yaw).toBe(0);
    expect(s.pitch).toBe(0);
    const idle = releaseInPlace(beginDrag(initialView()));
    expect(settleNow(idle)).toBe(idle);
  });

  it('visibleFace：看到的是哪一面（最近的 180° 倍數）', () => {
    expect(visibleFace(0)).toBe('front');
    expect(visibleFace(80)).toBe('front');
    expect(visibleFace(100)).toBe('back');
    expect(visibleFace(180)).toBe('back');
    expect(visibleFace(-170)).toBe('back');
    expect(visibleFace(350)).toBe('front');
    expect(visibleFace(-10)).toBe('front');
  });

  it('zoomByKey：一次約 10%，夾在縮放範圍', () => {
    expect(zoomByKey(0.8, 1)).toBeCloseTo(0.88, 10);
    expect(zoomByKey(0.8, -1)).toBeCloseTo(0.8 / 1.1, 10);
    expect(zoomByKey(0.99, 1)).toBe(ZOOM_MAX);
    expect(zoomByKey(0.46, -1)).toBe(ZOOM_MIN);
  });

  it('展示擺動：按鍵轉卡時展示讓開（pauseShowcase 清掉這一輪、安靜時間歸零）', () => {
    const view = { ...initialView() };
    const running = { enabledPrev: true, quietSec: 5, run: { fromYaw: 0, fromPitch: 0, faceYaw: 0, sinceSec: 2 } };
    const paused = pauseShowcase(running);
    expect(paused.run).toBeNull();
    expect(paused.quietSec).toBe(0);
    expect(paused.enabledPrev).toBe(true);
    // 轉動中（returning）時展示不擺；停下來安靜 1.5 秒才接回
    let v = turnByKey(view, 15, 0, true);
    let sc = paused;
    const input = { enabled: true, layerSelected: false, depthWiggling: false };
    for (let i = 0; i < 20; i++) {
      v = tick(v, 0.05);
      ({ showcase: sc, view: v } = stepShowcase(sc, v, input, 0.05));
    }
    expect(sc.run).toBeNull();
    expect(initialShowcase().run).toBeNull();
  });
});

// ---- 連按合成一步（停手 0.6 秒才記） ----

type Edit = { id: string; patch: Record<string, number>; phase: 'preview' | 'commit' };

function setup(initial: { id: string; x: number; y: number; scale: number } | null = { id: 'L1', x: 0, y: 0, scale: 1 }) {
  const dom = installFakeDom();
  const host = dom.document.createElement('div');
  const edits: Edit[] = [];
  const calls: string[] = [];
  let layer = initial && { ...initial };
  const handlers: PreviewKeyHandlers = {
    context: () => ({ layerSelected: layer !== null }),
    turn: (yaw, pitch) => calls.push(`turn ${yaw} ${pitch}`),
    home: () => calls.push('home'),
    zoom: (dir) => calls.push(`zoom ${dir}`),
    flip: () => calls.push('flip'),
    selected: () => layer && { ...layer },
    editLayer(id, patch, phase) {
      edits.push({ id, patch: { ...patch }, phase });
      // 像 main 一樣：preview 馬上讓畫面上的位置跟著變
      if (layer && layer.id === id) layer = { ...layer, ...patch };
    },
    // 編輯狀態的身分（T-607c）：這裡沒有別的操作會換掉它，延遲記步照常
    editToken: () => 'same',
  };
  const keys = attachPreviewKeys(host as unknown as HTMLElement, handlers);
  const press = (k: string, init: ConstructorParameters<typeof FakeEvent>[1] = {}) => {
    const e = new FakeEvent('keydown', { ...init, key: k });
    host.dispatchEvent(e);
    return e;
  };
  return { host, edits, calls, keys, press, layer: () => layer, setLayer: (l: typeof layer) => (layer = l) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('預覽區按鍵接線：轉卡、縮放、翻面', () => {
  it('方向鍵、Home、PageUp、F 各叫對應的動作，並且 preventDefault（頁面不跟著捲）', () => {
    const t = setup(null);
    expect(t.press('ArrowLeft').defaultPrevented).toBe(true);
    t.press('ArrowDown', { shiftKey: true });
    t.press('Home');
    t.press('PageUp');
    t.press('PageDown');
    t.press('f');
    expect(t.calls).toEqual(['turn -15 0', 'turn 0 5', 'home', 'zoom 1', 'zoom -1', 'flip']);
  });

  it('不是我們的鍵不攔（Tab 照常移動焦點、Ctrl+Z 交給視窗的復原）', () => {
    const t = setup(null);
    expect(t.press('Tab').defaultPrevented).toBe(false);
    expect(t.press('z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(t.press('ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
    expect(t.calls).toEqual([]);
  });

  it('選中圖層時，方向鍵不轉卡（轉卡的動作一個都不叫）', () => {
    const t = setup();
    t.press('ArrowLeft');
    t.press('ArrowUp');
    expect(t.calls).toEqual([]);
    expect(t.edits.length).toBe(2);
  });
});

describe('預覽區按鍵接線：移動、縮放選中的圖層，連按合成一步', () => {
  it('每次按鍵先 preview（畫面馬上動），停手 0.6 秒才 commit（只記一步）', () => {
    const t = setup();
    t.press('ArrowRight');
    t.press('ArrowRight');
    t.press('ArrowRight');
    expect(t.edits.map((e) => e.phase)).toEqual(['preview', 'preview', 'preview']);
    expect(t.edits.map((e) => e.patch.x)).toEqual([0.01, 0.02, 0.03]);
    expect(t.keys.pending()).toBe(true);
    vi.advanceTimersByTime(599);
    expect(t.edits.filter((e) => e.phase === 'commit')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const commits = t.edits.filter((e) => e.phase === 'commit');
    expect(commits).toEqual([{ id: 'L1', patch: { x: 0.03, y: 0 }, phase: 'commit' }]);
    expect(t.keys.pending()).toBe(false);
  });

  it('每按一下都重新計時：按鍵間隔不到 0.6 秒就一直不記', () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      t.press('ArrowUp');
      vi.advanceTimersByTime(500);
    }
    expect(t.edits.some((e) => e.phase === 'commit')).toBe(false);
    vi.advanceTimersByTime(100);
    expect(t.edits.filter((e) => e.phase === 'commit')).toHaveLength(1);
  });

  it('隔了 0.6 秒再按：是新的一步（兩次 commit）', () => {
    const t = setup();
    t.press('ArrowRight');
    vi.advanceTimersByTime(600);
    t.press('ArrowRight');
    vi.advanceTimersByTime(600);
    const commits = t.edits.filter((e) => e.phase === 'commit');
    expect(commits.map((c) => c.patch.x)).toEqual([0.01, 0.02]);
  });

  it('左右、上下混著按也是同一步：每次都送完整的 {x, y}（同一組欄位才會合成一步）', () => {
    const t = setup();
    t.press('ArrowRight');
    t.press('ArrowUp');
    t.press('ArrowLeft', { shiftKey: true });
    expect(t.edits.map((e) => Object.keys(e.patch).sort())).toEqual([['x', 'y'], ['x', 'y'], ['x', 'y']]);
    expect(t.layer()).toMatchObject({ x: -0.04, y: 0.01 });
    vi.advanceTimersByTime(600);
    expect(t.edits.at(-1)).toEqual({ id: 'L1', patch: { x: -0.04, y: 0.01 }, phase: 'commit' });
  });

  it('Shift＝一次 5%', () => {
    const t = setup();
    t.press('ArrowRight', { shiftKey: true });
    expect(t.edits[0]!.patch).toEqual({ x: 0.05, y: 0 });
  });

  it('+ − 縮放那一層：送 { scale }；縮放和移動各是一步', () => {
    const t = setup();
    t.press('+', { shiftKey: true });
    t.press('+', { shiftKey: true });
    expect(t.edits.map((e) => Object.keys(e.patch))).toEqual([['scale'], ['scale']]);
    expect(t.layer()!.scale).toBeCloseTo(1.1025, 10);
    t.press('ArrowRight');
    // 換成移動時，縮放那一步先記起來
    const commitsNow = t.edits.filter((e) => e.phase === 'commit');
    expect(commitsNow).toHaveLength(1);
    expect(Object.keys(commitsNow[0]!.patch)).toEqual(['scale']);
    vi.advanceTimersByTime(600);
    expect(t.edits.filter((e) => e.phase === 'commit')).toHaveLength(2);
  });

  it('已經在邊界（再移動也不會變）就不送、不計時', () => {
    const t = setup({ id: 'L1', x: 1, y: 0, scale: 1 });
    t.press('ArrowRight');
    expect(t.edits).toEqual([]);
    expect(t.keys.pending()).toBe(false);
  });

  it('flush()：馬上把還沒記的那一步記起來（離開預覽區、換卡前用）；沒有待記的不做事', () => {
    const t = setup();
    t.keys.flush();
    expect(t.edits).toEqual([]);
    t.press('ArrowRight');
    t.keys.flush();
    expect(t.edits.at(-1)).toEqual({ id: 'L1', patch: { x: 0.01, y: 0 }, phase: 'commit' });
    expect(t.keys.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(t.edits.filter((e) => e.phase === 'commit')).toHaveLength(1);
  });

  it('焦點離開預覽區（blur）就馬上記', () => {
    const t = setup();
    t.press('ArrowRight');
    t.host.dispatchEvent(new FakeEvent('blur', { bubbles: false }));
    expect(t.edits.at(-1)!.phase).toBe('commit');
  });

  it('待記的那一層被換掉（選了另一層）：先把舊的記起來，再開新的一步', () => {
    const t = setup();
    t.press('ArrowRight');
    t.setLayer({ id: 'L2', x: 0.5, y: 0.5, scale: 1 });
    t.press('ArrowRight');
    const phases = t.edits.map((e) => `${e.id}:${e.phase}`);
    expect(phases).toEqual(['L1:preview', 'L1:commit', 'L2:preview']);
    vi.advanceTimersByTime(600);
    expect(t.edits.at(-1)).toEqual({ id: 'L2', patch: { x: 0.51, y: 0.5 }, phase: 'commit' });
  });

  it('取消選取後（Esc）方向鍵又是轉卡；還沒記的那一步照樣會記', () => {
    const t = setup();
    t.press('ArrowRight');
    t.setLayer(null);
    t.press('ArrowRight');
    expect(t.calls).toEqual(['turn 15 0']);
    vi.advanceTimersByTime(600);
    expect(t.edits.at(-1)!.phase).toBe('commit');
  });
});
