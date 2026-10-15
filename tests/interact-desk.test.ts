// 工作桌舞台的轉卡限制（T-832，DESIGN §5「工作桌」）：卡片插在展示座上整座一起轉——左右照舊（能轉到背面），
// 上下拖只讓整座傾 ±10°（其他舞台照舊 ±60°）；放開回正照舊；展示擺動幅度減半。interact 不認得舞台名字，main 用 turnLimits(是不是工作桌)。
import { describe, expect, it } from 'vitest';
import {
  beginDrag,
  DESK_PITCH_LIMIT_DEG,
  dragBy,
  endDrag,
  holdAt,
  initialShowcase,
  initialView,
  limitPitch,
  PITCH_LIMIT_DEG,
  SHOWCASE_PITCH_DEG,
  SHOWCASE_YAW_DEG,
  showcasePose,
  stepShowcase,
  tick,
  turnByKey,
  turnLimits,
  type ViewState,
} from '../src/interact/view';

const drag = (s: ViewState, dx: number, dy: number, limit?: number) => dragBy(beginDrag(s), dx, dy, limit);

describe('上下傾的範圍：只有工作桌夾在 ±10°', () => {
  it('turnLimits：工作桌 10°、擺動 0.5 倍；其他 60°、1 倍', () => {
    expect(DESK_PITCH_LIMIT_DEG).toBe(10);
    expect(turnLimits(true)).toEqual({ pitch: 10, showcase: 0.5 });
    expect(turnLimits(false)).toEqual({ pitch: PITCH_LIMIT_DEG, showcase: 1 });
  });

  it('拖曳：工作桌往下、往上拖到底都停在 ±10°；不給範圍＝照舊 ±60°；左右照樣能轉到背面', () => {
    const desk = turnLimits(true).pitch;
    expect(drag(initialView(), 0, 1000, desk).pitch).toBe(10);
    expect(drag(initialView(), 0, -1000, desk).pitch).toBe(-10);
    expect(drag(initialView(), 0, 20, desk).pitch).toBeCloseTo(7, 9);
    expect(drag(initialView(), 0, 1000).pitch).toBe(60);
    expect(drag(initialView(), 0, 1000, turnLimits(false).pitch).pitch).toBe(60);
    const back = drag(initialView(), 180 / 0.35, 0, desk);
    expect(back.yaw).toBeCloseTo(180, 9);
  });

  it('放開回正照舊（工作桌也回到正面、pitch 0）', () => {
    let s = endDrag(drag(initialView(), 60, 1000, 10));
    for (let i = 0; i < 300; i++) s = tick(s, 1 / 60);
    expect(s.mode).toBe('idle');
    expect(s.yaw).toBe(0);
    expect(s.pitch).toBe(0);
  });

  it('鍵盤轉卡、setAngle（holdAt）也照範圍夾', () => {
    expect(turnByKey(initialView(), 0, 45, false, 10).pitch).toBe(10);
    expect(turnByKey(initialView(), 0, -45, true, 10).targetPitch).toBe(-10);
    expect(turnByKey(initialView(), 0, 45, false).pitch).toBe(45);
    expect(holdAt(initialView(), 30, 40, 10).pitch).toBe(10);
    expect(holdAt(initialView(), 30, 40).pitch).toBe(40);
  });

  it('換到工作桌時已經傾超過 10°（例如鍵盤停在 40°）：limitPitch 夾回來、回正的目標也夾；沒超過原樣回傳（同一個物件）', () => {
    const held = holdAt(initialView(), 20, 40);
    const limited = limitPitch(held, 10);
    expect(limited.pitch).toBe(10);
    expect(limited.yaw).toBe(20);
    const gliding = turnByKey(initialView(), 0, 45, true);
    expect(limitPitch(gliding, 10).targetPitch).toBe(10);
    const calm = holdAt(initialView(), 20, 5);
    expect(limitPitch(calm, 10)).toBe(calm);
    expect(limitPitch(held, 60)).toBe(held);
  });
});

describe('展示擺動：工作桌幅度減半', () => {
  it('showcasePose：scale 0.5 時左右、上下的軌跡都是一半', () => {
    const run = { fromYaw: 0, fromPitch: 0, faceYaw: 0, sinceSec: 10 };
    const full = showcasePose(run);
    const half = showcasePose(run, 0.5);
    expect(half.yaw).toBeCloseTo(full.yaw / 2, 9);
    expect(half.pitch).toBeCloseTo(full.pitch / 2, 9);
  });

  it('stepShowcase：給 scale 0.5 時整輪擺動的範圍是左右 ±11°、上下 ±4°（工作桌的 ±10° 之內）', () => {
    let sc = initialShowcase();
    let v = initialView();
    let maxYaw = 0;
    let maxPitch = 0;
    for (let i = 0; i < 60 * 30; i++) {
      ({ showcase: sc, view: v } = stepShowcase(sc, v, { enabled: true, layerSelected: false, depthWiggling: false, scale: 0.5 }, 1 / 60));
      maxYaw = Math.max(maxYaw, Math.abs(v.yaw));
      maxPitch = Math.max(maxPitch, Math.abs(v.pitch));
    }
    expect(maxYaw).toBeGreaterThan(SHOWCASE_YAW_DEG / 2 - 0.5);
    expect(maxYaw).toBeLessThanOrEqual(SHOWCASE_YAW_DEG / 2 + 1e-9);
    expect(maxPitch).toBeGreaterThan(SHOWCASE_PITCH_DEG / 2 - 0.5);
    expect(maxPitch).toBeLessThanOrEqual(SHOWCASE_PITCH_DEG / 2 + 1e-9);
    expect(maxPitch).toBeLessThan(DESK_PITCH_LIMIT_DEG);
  });

  it('不給 scale：照舊（±22°、±8°）', () => {
    let sc = initialShowcase();
    let v = initialView();
    let maxYaw = 0;
    for (let i = 0; i < 60 * 30; i++) {
      ({ showcase: sc, view: v } = stepShowcase(sc, v, { enabled: true, layerSelected: false, depthWiggling: false }, 1 / 60));
      maxYaw = Math.max(maxYaw, Math.abs(v.yaw));
    }
    expect(maxYaw).toBeGreaterThan(SHOWCASE_YAW_DEG - 0.5);
  });
});
