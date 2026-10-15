import { describe, expect, it } from 'vitest';
import { MAX_PARALLAX, parallaxOffset } from '../src/interact/parallax';
import {
  beginDrag,
  clampPitch,
  dragBy,
  DRAG_DEG_PER_PX,
  endDrag,
  depthWiggle,
  holdAt,
  initialView,
  nearestFaceYaw,
  PITCH_LIMIT_DEG,
  initialShowcase,
  releaseInPlace,
  SHOWCASE_BLEND_SEC,
  SHOWCASE_PITCH_DEG,
  SHOWCASE_PITCH_PERIOD_SEC,
  SHOWCASE_RESUME_SEC,
  SHOWCASE_YAW_DEG,
  SHOWCASE_YAW_PERIOD_SEC,
  showcasePose,
  stepShowcase,
  tick,
  turnToFace,
  WIGGLE_DEG,
  zoomByWheel,
  ZOOM_MAX,
  ZOOM_MIN,
  type ShowcaseInput,
  type ShowcaseRun,
  type ShowcaseState,
  type ViewState,
} from '../src/interact/view';

const FRAME = 1 / 60;

/** 一直跑影格直到不再回正（或超過秒數上限），回傳每一格的狀態。 */
function runUntilSettled(start: ViewState, maxSeconds = 5): ViewState[] {
  const frames: ViewState[] = [];
  let s = start;
  for (let t = 0; t < maxSeconds && s.mode === 'returning'; t += FRAME) {
    s = tick(s, FRAME);
    frames.push(s);
  }
  return frames;
}

function release(yaw: number, pitch: number): ViewState {
  let s = beginDrag(initialView());
  s = dragBy(s, yaw / DRAG_DEG_PER_PX, pitch / DRAG_DEG_PER_PX);
  return endDrag(s);
}

describe('角度夾限', () => {
  it('pitch 夾在 ±上限', () => {
    expect(clampPitch(70)).toBe(PITCH_LIMIT_DEG);
    expect(clampPitch(-70)).toBe(-PITCH_LIMIT_DEG);
    expect(clampPitch(20)).toBe(20);
  });

  it('上下拖到底 pitch 停在上限，左右拖 yaw 不設限（可以翻到背面）', () => {
    let s = beginDrag(initialView());
    s = dragBy(s, 1000, 5000);
    expect(s.pitch).toBe(PITCH_LIMIT_DEG);
    expect(s.yaw).toBeCloseTo(1000 * DRAG_DEG_PER_PX);
    expect(s.yaw).toBeGreaterThan(180);
  });

  it('向右拖 yaw 變大、向下拖 pitch 變大', () => {
    const s = dragBy(beginDrag(initialView()), 10, 10);
    expect(s.yaw).toBeGreaterThan(0);
    expect(s.pitch).toBeGreaterThan(0);
  });

  it('沒有按下就拖不會轉', () => {
    const s = dragBy(initialView(), 100, 100);
    expect(s.yaw).toBe(0);
    expect(s.pitch).toBe(0);
  });
});

describe('回正到最近的一面', () => {
  it('最近的 0° 或 180° 的倍數', () => {
    expect(nearestFaceYaw(100)).toBe(180);
    expect(nearestFaceYaw(-80)).toBe(0);
    expect(nearestFaceYaw(10)).toBe(0);
    expect(nearestFaceYaw(170)).toBe(180);
    expect(nearestFaceYaw(280)).toBe(360);
    expect(nearestFaceYaw(-100)).toBe(-180);
  });

  it('放開在 yaw 100° → 回到 180°，pitch 回 0', () => {
    const frames = runUntilSettled(release(100, 30));
    const last = frames[frames.length - 1]!;
    expect(last.mode).toBe('idle');
    expect(last.yaw).toBe(180);
    expect(last.pitch).toBe(0);
  });

  it('放開在 yaw -80° → 回到 0°', () => {
    const frames = runUntilSettled(release(-80, -20));
    const last = frames[frames.length - 1]!;
    expect(last.mode).toBe('idle');
    expect(last.yaw).toBe(0);
    expect(last.pitch).toBe(0);
  });

  it('回正曲線會收斂：單調靠近、不衝過頭、3 秒內停好', () => {
    const frames = runUntilSettled(release(100, 40), 3);
    expect(frames[frames.length - 1]!.mode).toBe('idle');
    let prevYaw = 100;
    let prevPitch = 40;
    for (const f of frames) {
      expect(f.yaw).toBeGreaterThanOrEqual(prevYaw);
      expect(f.yaw).toBeLessThanOrEqual(180);
      expect(f.pitch).toBeLessThanOrEqual(prevPitch);
      expect(f.pitch).toBeGreaterThanOrEqual(0);
      prevYaw = f.yaw;
      prevPitch = f.pitch;
    }
  });

  it('回正是平順的：一開始慢慢加速，不會第一格就跳一大段', () => {
    const start = release(100, 0);
    const first = tick(start, FRAME);
    const second = tick(first, FRAME);
    const step1 = first.yaw - start.yaw;
    const step2 = second.yaw - first.yaw;
    expect(step1).toBeGreaterThan(0);
    expect(step1).toBeLessThan(1);
    expect(step2).toBeGreaterThan(step1);
  });

  it('影格長短不同，最後停的位置一樣', () => {
    const fast = runUntilSettled(release(100, 0));
    let slow = release(100, 0);
    for (let i = 0; i < 100 && slow.mode === 'returning'; i++) slow = tick(slow, 0.1);
    expect(slow.yaw).toBe(fast[fast.length - 1]!.yaw);
  });

  it('setAngle（held）停住不回正，直到下一次拖曳', () => {
    let s = holdAt(release(100, 0), 30, 10);
    for (let i = 0; i < 120; i++) s = tick(s, FRAME);
    expect(s.yaw).toBe(30);
    expect(s.pitch).toBe(10);
    s = endDrag(dragBy(beginDrag(s), 1, 0));
    expect(s.mode).toBe('returning');
  });

  it('setAngle 的 pitch 也照樣夾限', () => {
    expect(holdAt(initialView(), 0, 90).pitch).toBe(PITCH_LIMIT_DEG);
  });
});

describe('滾輪縮放', () => {
  it('往上滾（deltaY < 0）拉近、往下滾推遠', () => {
    const z = initialView().zoom;
    expect(zoomByWheel(z, -100)).toBeGreaterThan(z);
    expect(zoomByWheel(z, 100)).toBeLessThan(z);
  });

  it('夾在範圍內（最近時卡片仍完整可見由 render 的 fitDistance 保證）', () => {
    expect(zoomByWheel(1, -100000)).toBe(ZOOM_MAX);
    expect(zoomByWheel(1, 100000)).toBe(ZOOM_MIN);
  });
});

describe('視差位移量', () => {
  it('depth 0（底圖）任何角度都不動', () => {
    for (const [yaw, pitch] of [[30, 0], [0, 30], [80, 40], [210, -20]] as const) {
      const o = parallaxOffset('front', yaw, pitch, 0);
      expect(Math.abs(o.x)).toBe(0);
      expect(Math.abs(o.y)).toBe(0);
    }
  });

  it('角度 0 時位移 0（正面看正面、背面看背面）', () => {
    const f = parallaxOffset('front', 0, 0, 100);
    expect(Math.abs(f.x)).toBe(0);
    expect(Math.abs(f.y)).toBe(0);
    const b = parallaxOffset('back', 180, 0, 100);
    expect(Math.abs(b.x)).toBeLessThan(1e-12);
    expect(Math.abs(b.y)).toBeLessThan(1e-12);
  });

  it('深度越大位移越大', () => {
    let prev = 0;
    for (const depth of [1, 25, 50, 75, 100]) {
      const o = parallaxOffset('front', 30, 15, depth);
      const len = Math.hypot(o.x, o.y);
      expect(len).toBeGreaterThan(prev);
      prev = len;
    }
  });

  it('方向：浮在卡面上的層往「離觀看者較遠的那一邊」移', () => {
    // yaw +30：卡片右緣往後退（從左邊斜看）→ 浮起來的層看起來往右移
    expect(parallaxOffset('front', 30, 0, 50).x).toBeGreaterThan(0);
    expect(parallaxOffset('front', -30, 0, 50).x).toBeLessThan(0);
    // pitch +30：卡片上緣朝觀看者、下緣往後退（從上方斜看）→ 往下移
    expect(parallaxOffset('front', 0, 30, 50).y).toBeLessThan(0);
    expect(parallaxOffset('front', 0, -30, 50).y).toBeGreaterThan(0);
    // 背面：yaw 210 等於「背面轉了 +30」→ 以背面自己的右邊為 +x，同樣往右移
    expect(parallaxOffset('back', 210, 0, 50).x).toBeGreaterThan(0);
    expect(parallaxOffset('back', 150, 0, 50).x).toBeLessThan(0);
    expect(parallaxOffset('back', 180, 30, 50).y).toBeLessThan(0);
  });

  it('35° 以內照物理（深度 × tan 角度），深度 100 對應 MAX_PARALLAX', () => {
    const o = parallaxOffset('front', 35, 0, 100);
    expect(o.x).toBeCloseTo(MAX_PARALLAX * Math.tan((35 * Math.PI) / 180), 10);
    expect(parallaxOffset('front', 35, 0, 50).x).toBeCloseTo(o.x / 2, 10);
  });

  it('接近 90° 不會爆掉：有上限且隨角度不減少', () => {
    let prev = 0;
    for (const yaw of [10, 30, 50, 60, 70, 80, 89.9]) {
      const x = parallaxOffset('front', yaw, 0, 100).x;
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x).toBeLessThanOrEqual(MAX_PARALLAX * 2);
      prev = x;
    }
  });
});

describe('切到某一面時自動轉過去（turnToFace）', () => {
  it('目標取離目前角度最近、屬於那一面的角度（0° 或 180° 的倍數）', () => {
    expect(turnToFace(initialView(), 'back').targetYaw).toBe(180);
    expect(turnToFace({ ...initialView(), yaw: -30 }, 'back').targetYaw).toBe(-180);
    expect(turnToFace({ ...initialView(), yaw: 200 }, 'front').targetYaw).toBe(360);
    expect(turnToFace({ ...initialView(), yaw: 170 }, 'front').targetYaw).toBe(0);
    expect(turnToFace({ ...initialView(), yaw: 500 }, 'back').targetYaw).toBe(540);
    expect(Object.is(turnToFace({ ...initialView(), yaw: -10 }, 'front').targetYaw, -0)).toBe(false);
  });

  it('走同一個回正彈簧：一路轉到背面、pitch 回 0、停好變 idle、不衝過頭', () => {
    const start = turnToFace({ ...initialView(), pitch: 20, mode: 'held' }, 'back');
    expect(start.mode).toBe('returning');
    const frames = runUntilSettled(start);
    const last = frames[frames.length - 1]!;
    expect(last.mode).toBe('idle');
    expect(last.yaw).toBe(180);
    expect(last.pitch).toBe(0);
    expect(Math.max(...frames.map((f) => f.yaw))).toBeLessThanOrEqual(180);
  });

  it('已經停在那一面就不動', () => {
    const s = { ...initialView(), yaw: 180 };
    expect(turnToFace(s, 'back')).toBe(s);
  });

  it('使用者正在拖曳時不搶', () => {
    const s = beginDrag(initialView());
    expect(turnToFace(s, 'back')).toBe(s);
  });
});

describe('放開後不回正（view.returnToFront 關掉）', () => {
  it('停在放開的角度、不再動', () => {
    let s = beginDrag(initialView());
    s = dragBy(s, 100, 40);
    const r = releaseInPlace(s);
    expect(r.mode).toBe('idle');
    expect(r.yaw).toBe(s.yaw);
    expect(r.pitch).toBe(s.pitch);
    expect(tick(r, 1)).toBe(r);
  });

  it('沒有在拖曳就原樣回傳', () => {
    const s = initialView();
    expect(releaseInPlace(s)).toBe(s);
  });
});

describe('調深度時的小幅擺動', () => {
  it('一開始是 0，之後左右擺、不超過幅度', () => {
    expect(depthWiggle(0, 0)).toBe(0);
    let max = 0;
    let min = 0;
    for (let t = 0; t < 1; t += 0.01) {
      const v = depthWiggle(t, 0);
      max = Math.max(max, v);
      min = Math.min(min, v);
      expect(Math.abs(v)).toBeLessThanOrEqual(WIGGLE_DEG);
    }
    expect(max).toBeGreaterThan(WIGGLE_DEG * 0.9);
    expect(min).toBeLessThan(-WIGGLE_DEG * 0.9);
  });

  it('停手後慢慢收掉，最後完全不動', () => {
    expect(Math.abs(depthWiggle(0.3, 0.9))).toBeLessThan(Math.abs(depthWiggle(0.3, 0)));
    expect(depthWiggle(5, 5)).toBe(0);
    expect(depthWiggle(3, Number.NaN)).toBe(0);
  });
});

/** 剛好接完軌跡之後（離軌跡很近時接上只要 SHOWCASE_BLEND_SEC 多一點）。 */
const BLEND_DONE = SHOWCASE_BLEND_SEC + 0.01;

describe('展示擺動：角度曲線（showcasePose）', () => {
  const run = (fromYaw: number, fromPitch: number, faceYaw: number, sinceSec: number): ShowcaseRun => ({ fromYaw, fromPitch, faceYaw, sinceSec });
  /** 已經完全接上軌跡之後的一點（起點就在中心）。 */
  const settled = (faceYaw: number, sinceSec: number) => showcasePose(run(faceYaw, 0, faceYaw, sinceSec));
  /** 軌跡本身（不含接上的過渡）。 */
  const path = (faceYaw: number, t: number) => ({
    yaw: faceYaw + SHOWCASE_YAW_DEG * Math.sin((2 * Math.PI * t) / SHOWCASE_YAW_PERIOD_SEC),
    pitch: SHOWCASE_PITCH_DEG * Math.sin((2 * Math.PI * t) / SHOWCASE_PITCH_PERIOD_SEC),
  });

  it('參數：yaw 約 ±22°、pitch 約 ±8°，兩個方向週期不同、都在 6～8 秒', () => {
    expect(SHOWCASE_YAW_DEG).toBeGreaterThanOrEqual(20);
    expect(SHOWCASE_YAW_DEG).toBeLessThanOrEqual(24);
    expect(SHOWCASE_PITCH_DEG).toBeGreaterThanOrEqual(6);
    expect(SHOWCASE_PITCH_DEG).toBeLessThanOrEqual(10);
    for (const p of [SHOWCASE_YAW_PERIOD_SEC, SHOWCASE_PITCH_PERIOD_SEC]) {
      expect(p).toBeGreaterThanOrEqual(6);
      expect(p).toBeLessThanOrEqual(8);
    }
    expect(SHOWCASE_YAW_PERIOD_SEC).not.toBe(SHOWCASE_PITCH_PERIOD_SEC);
  });

  it('角度永遠在範圍內，而且兩邊都真的擺到幅度附近（正面附近）', () => {
    let minYaw = Infinity;
    let maxYaw = -Infinity;
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    for (let t = 0; t < 60; t += 0.05) {
      const p = settled(0, t);
      expect(Math.abs(p.yaw)).toBeLessThanOrEqual(SHOWCASE_YAW_DEG + 1e-9);
      expect(Math.abs(p.pitch)).toBeLessThanOrEqual(SHOWCASE_PITCH_DEG + 1e-9);
      minYaw = Math.min(minYaw, p.yaw);
      maxYaw = Math.max(maxYaw, p.yaw);
      minPitch = Math.min(minPitch, p.pitch);
      maxPitch = Math.max(maxPitch, p.pitch);
    }
    expect(maxYaw).toBeGreaterThan(SHOWCASE_YAW_DEG * 0.95);
    expect(minYaw).toBeLessThan(-SHOWCASE_YAW_DEG * 0.95);
    expect(maxPitch).toBeGreaterThan(SHOWCASE_PITCH_DEG * 0.95);
    expect(minPitch).toBeLessThan(-SHOWCASE_PITCH_DEG * 0.95);
  });

  it('週期：yaw 隔一個 yaw 週期、pitch 隔一個 pitch 週期，回到同一點；兩個週期不同', () => {
    for (const t of [BLEND_DONE, BLEND_DONE + 1.3, BLEND_DONE + 2.9]) {
      expect(settled(0, t + SHOWCASE_YAW_PERIOD_SEC).yaw).toBeCloseTo(settled(0, t).yaw, 9);
      expect(settled(0, t + SHOWCASE_PITCH_PERIOD_SEC).pitch).toBeCloseTo(settled(0, t).pitch, 9);
    }
    // 一個 pitch 週期後 yaw 沒回到原位 → 兩個方向各擺各的，軌跡不呆板
    const t = BLEND_DONE + 1;
    expect(Math.abs(settled(0, t + SHOWCASE_PITCH_PERIOD_SEC).yaw - settled(0, t).yaw)).toBeGreaterThan(1);
  });

  it('起點平順：since＝0 時就是目前角度（不跳），而且從靜止慢慢開始', () => {
    for (const [fy, fp] of [[0, 0], [13.7, 20], [-40, -25], [95, 5]] as const) {
      const face = Math.round(fy / 180) * 180;
      const p0 = showcasePose(run(fy, fp, face, 0));
      expect(p0.yaw).toBe(fy);
      expect(p0.pitch).toBe(fp);
      // 第一個 1/60 秒幾乎沒動，之後才逐漸加速
      const p1 = showcasePose(run(fy, fp, face, FRAME));
      const p2 = showcasePose(run(fy, fp, face, 2 * FRAME));
      expect(Math.abs(p1.yaw - fy)).toBeLessThan(0.05);
      expect(Math.abs(p2.yaw - p1.yaw)).toBeGreaterThanOrEqual(Math.abs(p1.yaw - p0.yaw) - 1e-12);
    }
  });

  it('整段軌跡沒有跳動：每一格（1/60 秒）最多轉 1°，接上軌跡的瞬間也一樣', () => {
    for (const [fy, fp, face] of [[0, 0, 0], [30, 15, 0], [-70, -20, 0], [100, 30, 180], [180, 0, 180]] as const) {
      let prev = showcasePose(run(fy, fp, face, 0));
      for (let t = FRAME; t < 30; t += FRAME) {
        const p = showcasePose(run(fy, fp, face, t));
        expect(Math.abs(p.yaw - prev.yaw)).toBeLessThan(1);
        expect(Math.abs(p.pitch - prev.pitch)).toBeLessThan(1);
        prev = p;
      }
    }
  });

  it('離軌跡越遠接上越慢；接完之後完全貼在軌跡上（和起點無關）', () => {
    const t = SHOWCASE_BLEND_SEC + 0.1;
    // 起點在軌跡旁邊：這個時間點已經接完
    const nearAtT = showcasePose(run(179, 1, 180, t));
    expect(nearAtT.yaw).toBeCloseTo(path(180, t).yaw, 9);
    // 起點離很遠：同一個時間點還沒接完
    const farAtT = showcasePose(run(100, 30, 180, t));
    expect(Math.abs(farAtT.yaw - path(180, t).yaw)).toBeGreaterThan(1);
    // 夠久之後，從哪出發都完全一樣
    const late = 10;
    expect(showcasePose(run(100, 30, 180, late))).toEqual({ yaw: path(180, late).yaw, pitch: path(180, late).pitch });
    expect(showcasePose(run(-20, -30, 0, late))).toEqual({ yaw: path(0, late).yaw, pitch: path(0, late).pitch });
  });

  it('背面附近擺動：中心是 180°（或 180°＋360° 的倍數）', () => {
    for (const face of [180, -180, 540]) {
      let min = Infinity;
      let max = -Infinity;
      for (let t = 0; t < 30; t += 0.05) {
        const p = settled(face, t);
        min = Math.min(min, p.yaw);
        max = Math.max(max, p.yaw);
      }
      expect(max).toBeLessThanOrEqual(face + SHOWCASE_YAW_DEG + 1e-9);
      expect(min).toBeGreaterThanOrEqual(face - SHOWCASE_YAW_DEG - 1e-9);
      expect(max - face).toBeGreaterThan(SHOWCASE_YAW_DEG * 0.95);
      expect(face - min).toBeGreaterThan(SHOWCASE_YAW_DEG * 0.95);
    }
  });
});

describe('展示擺動：什麼時候擺、什麼時候不擺（stepShowcase）', () => {
  const ON: ShowcaseInput = { enabled: true, layerSelected: false, depthWiggling: false };
  const OFF: ShowcaseInput = { ...ON, enabled: false };

  interface Sim {
    sc: ShowcaseState;
    view: ViewState;
    /** 每一格結束後的 yaw、pitch。 */
    trace: { yaw: number; pitch: number }[];
  }

  /** 以 60fps 跑 seconds 秒，輸入固定。 */
  function play(sim: { sc: ShowcaseState; view: ViewState }, input: ShowcaseInput, seconds: number): Sim {
    let { sc, view } = sim;
    const trace: Sim['trace'] = [];
    for (let t = 0; t < seconds - 1e-9; t += FRAME) {
      ({ showcase: sc, view } = stepShowcase(sc, view, input, FRAME));
      trace.push({ yaw: view.yaw, pitch: view.pitch });
    }
    return { sc, view, trace };
  }
  const fresh = (view: ViewState = initialView()) => ({ sc: initialShowcase(), view });
  const maxStep = (trace: Sim['trace'], from: { yaw: number; pitch: number }) => {
    let prev = from;
    let worst = 0;
    for (const p of trace) {
      worst = Math.max(worst, Math.abs(p.yaw - prev.yaw), Math.abs(p.pitch - prev.pitch));
      prev = p;
    }
    return worst;
  };

  it('開關關著：什麼都不動，原樣回傳', () => {
    const view = initialView();
    const r = stepShowcase(initialShowcase(), view, OFF, FRAME);
    expect(r.view).toBe(view);
    expect(r.showcase.run).toBeNull();
    const r2 = play(fresh(), OFF, 5);
    expect(r2.view.yaw).toBe(0);
    expect(r2.view.pitch).toBe(0);
  });

  it('開關打開、閒著、沒選圖層：馬上開始擺，而且一直是平順的（不跳）', () => {
    const r = play(fresh(), ON, 20);
    expect(r.view.mode).toBe('idle');
    expect(maxStep(r.trace, { yaw: 0, pitch: 0 })).toBeLessThan(1);
    const yaws = r.trace.map((p) => p.yaw);
    expect(Math.max(...yaws)).toBeGreaterThan(SHOWCASE_YAW_DEG * 0.9);
    expect(Math.min(...yaws)).toBeLessThan(-SHOWCASE_YAW_DEG * 0.9);
    expect(Math.max(...yaws)).toBeLessThanOrEqual(SHOWCASE_YAW_DEG + 1e-9);
  });

  it('大到不行的 dt（分頁在背景放很久再回來）不會一格跳很遠', () => {
    const swinging = play(fresh(), ON, 5);
    const r = stepShowcase(swinging.sc, swinging.view, ON, 30);
    expect(Math.abs(r.view.yaw - swinging.view.yaw)).toBeLessThan(5);
  });

  it('在拖曳：暫停，不改角度', () => {
    const swinging = play(fresh(), ON, 3);
    const dragging = beginDrag(swinging.view);
    const r = play({ sc: swinging.sc, view: dragging }, ON, 2);
    expect(r.view.yaw).toBe(swinging.view.yaw);
    expect(r.view.pitch).toBe(swinging.view.pitch);
    expect(r.sc.run).toBeNull();
  });

  it('放開（停在原處）後：約 1.5 秒沒動作才回到擺動，而且從放開的角度平順接上', () => {
    const swinging = play(fresh(), ON, 3);
    // 拖曳中先走一格讓狀態機看到「在忙」，再放開
    const dragging = play({ sc: swinging.sc, view: beginDrag(swinging.view) }, ON, FRAME);
    const view = releaseInPlace(dragBy(dragging.view, 40, 20));
    const released = { yaw: view.yaw, pitch: view.pitch };
    // 1.5 秒內：不動
    const wait = play({ sc: dragging.sc, view }, ON, SHOWCASE_RESUME_SEC - 0.1);
    expect(wait.view.yaw).toBe(released.yaw);
    expect(wait.view.pitch).toBe(released.pitch);
    expect(wait.sc.run).toBeNull();
    // 之後：開始擺，從放開的角度出發、沒有跳
    const resumed = play(wait, ON, 6);
    expect(resumed.view.yaw).not.toBe(released.yaw);
    expect(maxStep(resumed.trace, released)).toBeLessThan(1);
  });

  it('放開後回正：回正中不擺；停好之後再等 1.5 秒才擺', () => {
    const swinging = play(fresh(), ON, 3);
    let view = beginDrag(swinging.view);
    view = endDrag(dragBy(view, 100 / DRAG_DEG_PER_PX, 0)); // 放開時離最近的一面還有一段 → 回正
    expect(view.mode).toBe('returning');
    let sc = swinging.sc;
    let returningFrames = 0;
    let settleAt = -1;
    let swingAt = -1;
    for (let i = 0; i < 60 * 12; i++) {
      view = tick(view, FRAME);
      if (view.mode === 'returning') returningFrames++;
      ({ showcase: sc, view } = stepShowcase(sc, view, ON, FRAME));
      if (settleAt < 0 && view.mode === 'idle') settleAt = i;
      if (swingAt < 0 && sc.run !== null) swingAt = i;
    }
    expect(returningFrames).toBeGreaterThan(30);
    expect(settleAt).toBeGreaterThan(0);
    const wait = Math.round(SHOWCASE_RESUME_SEC * 60);
    expect(swingAt).toBeGreaterThanOrEqual(settleAt + wait - 2);
    expect(swingAt).toBeLessThanOrEqual(settleAt + wait + 3);
  });

  it('選中圖層：不擺（要讓人好拖）；取消選取後也要再等 1.5 秒', () => {
    const swinging = play(fresh(), ON, 3);
    const selected = play(swinging, { ...ON, layerSelected: true }, 4);
    expect(selected.view.yaw).toBe(swinging.view.yaw);
    expect(selected.sc.run).toBeNull();
    const wait = play(selected, ON, SHOWCASE_RESUME_SEC - 0.1);
    expect(wait.view.yaw).toBe(swinging.view.yaw);
    const resumed = play(wait, ON, 1);
    expect(resumed.sc.run).not.toBeNull();
    expect(maxStep(resumed.trace, { yaw: swinging.view.yaw, pitch: swinging.view.pitch })).toBeLessThan(1);
  });

  it('調深度時的小擺動（depthWiggle）優先：那段時間展示不擺', () => {
    const swinging = play(fresh(), ON, 3);
    const wiggling = play(swinging, { ...ON, depthWiggling: true }, 2);
    expect(wiggling.view.yaw).toBe(swinging.view.yaw);
    expect(wiggling.sc.run).toBeNull();
  });

  it('展示打開、剛好停在背面：在背面附近擺', () => {
    const r = play(fresh({ ...initialView(), yaw: 180 }), ON, 40);
    const yaws = r.trace.map((p) => p.yaw);
    expect(Math.min(...yaws)).toBeGreaterThanOrEqual(180 - SHOWCASE_YAW_DEG - 1e-9);
    expect(Math.max(...yaws)).toBeLessThanOrEqual(180 + SHOWCASE_YAW_DEG + 1e-9);
    expect(Math.max(...yaws)).toBeGreaterThan(180 + SHOWCASE_YAW_DEG * 0.9);
  });

  it('停在奇怪的角度（放開後不回正）：往最近的一面接，不跳', () => {
    const r = play(fresh({ ...initialView(), yaw: 100, pitch: 30 }), ON, 12);
    expect(maxStep(r.trace, { yaw: 100, pitch: 30 })).toBeLessThan(1);
    const late = r.trace.slice(-60).map((p) => p.yaw);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(180 - SHOWCASE_YAW_DEG - 1e-9);
  });

  it('setAngle（held）優先：停住不擺，直到下一次拖曳，或把展示關掉再打開', () => {
    const running = play(fresh(), ON, 1); // 展示已經開著、正在擺，這時才呼叫 setAngle
    const held = holdAt(running.view, 30, 10);
    const stays = play({ sc: running.sc, view: held }, ON, 5);
    expect(stays.view.yaw).toBe(30);
    expect(stays.view.pitch).toBe(10);
    expect(stays.view.mode).toBe('held');
    expect(stays.sc.run).toBeNull();
    // 關掉：仍然停住
    const off = play(stays, OFF, 1);
    expect(off.view.mode).toBe('held');
    expect(off.view.yaw).toBe(30);
    // 再打開：解除停住，開始擺（從 30° 接上）
    const again = play(off, ON, 4);
    expect(again.view.mode).toBe('idle');
    expect(again.sc.run).not.toBeNull();
    expect(maxStep(again.trace, { yaw: 30, pitch: 10 })).toBeLessThan(1);
    // 下一次拖曳：照舊（拖曳 → 回正）
    const drag = endDrag(dragBy(beginDrag(stays.view), 1, 0));
    expect(drag.mode).toBe('returning');
  });

  it('擺動到一半關掉：停在那個角度（不彈回、不跳）', () => {
    const swinging = play(fresh(), ON, 5);
    const off = play(swinging, OFF, 2);
    expect(off.view.yaw).toBe(swinging.view.yaw);
    expect(off.view.pitch).toBe(swinging.view.pitch);
    expect(off.sc.run).toBeNull();
  });

  it('關掉再馬上打開：不用再等 1.5 秒', () => {
    const swinging = play(fresh(), ON, 5);
    const off = play(swinging, OFF, 0.5);
    const first = stepShowcase(off.sc, off.view, ON, FRAME);
    expect(first.showcase.run).not.toBeNull();
  });
});
