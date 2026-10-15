// 舞台特效（T-314、T-316）的純數學：位置、展示台圖怎麼鋪、翻面判斷、拖曳反應、光環轉動／呼吸／浮動、底光轉動、外圈流光、漣漪、減少動態效果。
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT } from '../src/model/types';
import {  } from '../src/render/fit';
import {
  BREATH_MIN,
  BREATH_STILL,
  COMET_COUNT,
  COMET_SPEED,
  DUST_ORBIT,
  facingSide,
  FLIP_MARGIN,
  initialStageMotion,
  outerRingPath,
  PEDESTAL,
  PEDESTAL_SPIN,
  pedestalPlane,
  RING_BOB,
  RING_BOB_PERIOD,
  RINGS,
  RIPPLE_DURATION,
  RIPPLE_END,
  RIPPLE_FIRST,
  RIPPLE_FLIP_BOOST,
  RIPPLE_PERIOD,
  RIPPLE_START,
  RIPPLE_TRAIL,
  RIPPLE_TRAIL_GAIN,
  rippleShape,
  SPIN_BOOST,
  spinEnergy,
  STAGE_GAP,
  stageY,
  stepStageMotion,
  type StageMotion,
} from '../src/render/stage-motion';

const FRAME = 1 / 60;
const TAU = Math.PI * 2;

/** 用固定影格跑 seconds 秒；yawAt(t)＝第 t 秒卡片的 yaw（度）。回傳每一格開始漣漪的時間。 */
function run(m: StageMotion, seconds: number, yawAt: (t: number) => number, reduced = false, start = 0): number[] {
  const starts: number[] = [];
  const frames = Math.round(seconds / FRAME);
  for (let i = 1; i <= frames; i++) {
    const t = start + i * FRAME;
    stepStageMotion(m, yawAt(t), 0, FRAME, reduced);
    if (m.rippleAge === 0) starts.push(t);
  }
  return starts;
}

function fresh(yaw = 0): StageMotion {
  const m = initialStageMotion();
  stepStageMotion(m, yaw, 0, 0, false); // 影格迴圈的第一格 dt＝0
  return m;
}

describe('舞台的位置與展示台圖', () => {
  it('舞台平面在卡片下緣再往下 STAGE_GAP；塔羅牌比較高，舞台跟著低', () => {
    expect(stageY(ASPECT_HEIGHT.standard)).toBeCloseTo(-(ASPECT_HEIGHT.standard / 2 + STAGE_GAP), 12);
    expect(stageY(ASPECT_HEIGHT.tarot)).toBeCloseTo(-(ASPECT_HEIGHT.tarot / 2 + STAGE_GAP), 12);
    expect(stageY(ASPECT_HEIGHT.tarot)).toBeLessThan(stageY(ASPECT_HEIGHT.standard));
  });

  it('圖上的最外圈鋪到地上是半徑 PEDESTAL.radius 的正圓（橫向與縱向一樣大），中心對準光環中心', () => {
    const plane = pedestalPlane();
    // 地上 (x, z) → 圖的像素：u × 寬、(1 − v) × 高
    const toPx = (x: number, z: number) => ({
      px: (plane.centerU + x / plane.width) * PEDESTAL.widthPx,
      py: (1 - (plane.centerV - z / plane.depth)) * PEDESTAL.heightPx,
    });
    const center = toPx(0, 0);
    expect(center.px).toBeCloseTo(PEDESTAL.centerXPx, 9);
    expect(center.py).toBeCloseTo(PEDESTAL.centerYPx, 9);
    expect(toPx(PEDESTAL.radius, 0).px).toBeCloseTo(PEDESTAL.centerXPx + PEDESTAL.outerRadiusPx, 9);
    // 靠近鏡頭（+z）＝圖的下半部；縱向的像素半徑＝橫向 ÷ squash（圖上壓扁的橢圓）
    expect(toPx(0, PEDESTAL.radius).py).toBeCloseTo(PEDESTAL.centerYPx + PEDESTAL.outerRadiusPx / PEDESTAL.squash, 9);
  });

  it('外圈流光跑的路線對準圖上最外圈的細環（左右兩端、上緣、下緣）', () => {
    const plane = pedestalPlane();
    const ring = outerRingPath();
    const toPx = (x: number, z: number) => ({
      px: (plane.centerU + x / plane.width) * PEDESTAL.widthPx,
      py: (1 - (plane.centerV - z / plane.depth)) * PEDESTAL.heightPx,
    });
    expect(toPx(ring.rx, ring.cz).px).toBeCloseTo(PEDESTAL.centerXPx + PEDESTAL.outerRadiusPx, 6);
    expect(toPx(-ring.rx, ring.cz).px).toBeCloseTo(PEDESTAL.centerXPx - PEDESTAL.outerRadiusPx, 6);
    // 遠的那一側（−z）＝圖上緣、近的那一側（+z）＝圖下緣
    expect(toPx(0, ring.cz - ring.rz).py).toBeCloseTo(PEDESTAL.centerYPx - PEDESTAL.outerTopPx, 6);
    expect(toPx(0, ring.cz + ring.rz).py).toBeCloseTo(PEDESTAL.centerYPx + PEDESTAL.outerBottomPx, 6);
    // 拉回地上後接近正圓（差不到一成）
    expect(Math.abs(ring.rz / ring.rx - 1)).toBeLessThan(0.1);
  });

  it('懸浮光環的平常轉速約是 T-314 的兩倍（0.15～0.5 弧度／秒），三圈速度都不一樣', () => {
    for (const ring of RINGS) {
      expect(Math.abs(ring.speed)).toBeGreaterThanOrEqual(0.15);
      expect(Math.abs(ring.speed)).toBeLessThanOrEqual(0.5);
    }
    expect(new Set(RINGS.map((r) => Math.abs(r.speed))).size).toBe(RINGS.length);
  });

  it('光環都在展示台的範圍內、由內到外排，而且至少兩圈轉的方向不同', () => {
    const plane = pedestalPlane();
    for (let i = 1; i < RINGS.length; i++) expect(RINGS[i]!.radius).toBeGreaterThan(RINGS[i - 1]!.radius);
    expect(RINGS.length).toBeGreaterThanOrEqual(2);
    expect(RINGS.length).toBeLessThanOrEqual(3);
    for (const ring of RINGS) expect(ring.radius).toBeLessThan(plane.width / 2);
    expect(new Set(RINGS.map((r) => Math.sign(r.speed))).size).toBe(2);
    // 亮點、亮弧要是整數倍，繞一圈才接得起來
    for (const ring of RINGS) {
      expect(Number.isInteger(ring.dots)).toBe(true);
      expect(Number.isInteger(ring.arcs)).toBe(true);
    }
  });
});

describe('翻面判斷（facingSide）', () => {
  it('正面朝鏡頭＝front、背面朝鏡頭＝back（pitch 不影響，±60° 內）', () => {
    expect(facingSide(0, 0, null)).toBe('front');
    expect(facingSide(180, 0, null)).toBe('back');
    expect(facingSide(-180, 30, null)).toBe('back');
    expect(facingSide(360, -60, null)).toBe('front');
    expect(facingSide(35, 20, null)).toBe('front');
  });

  it('卡在側面附近不會來回切換：要越過緩衝才算翻面', () => {
    const edge = (Math.acos(-FLIP_MARGIN) * 180) / Math.PI; // 約 95.7°：正面朝鏡頭的程度＝−FLIP_MARGIN
    expect(facingSide(95, 0, 'front')).toBe('front');
    expect(facingSide(edge - 1, 0, 'front')).toBe('front');
    expect(facingSide(edge + 1, 0, 'front')).toBe('back');
    expect(facingSide(100, 0, 'front')).toBe('back');
    expect(facingSide(85, 0, 'back')).toBe('back');
    expect(facingSide(80, 0, 'back')).toBe('front');
  });
});

describe('拖曳反應：轉速 → 能量', () => {
  it('能量在 0～1 之間、轉越快越大', () => {
    expect(spinEnergy(0)).toBe(0);
    expect(spinEnergy(-5)).toBe(0);
    expect(spinEnergy(80)).toBeGreaterThan(0);
    expect(spinEnergy(300)).toBeGreaterThan(spinEnergy(80));
    expect(spinEnergy(1e6)).toBeLessThanOrEqual(1);
  });

  it('轉卡時很快反應（0.3 秒內），停手後慢慢回到平常（0.5 秒還明顯、4 秒後幾乎沒有）', () => {
    const m = fresh();
    const speed = 300; // 度／秒
    run(m, 0.3, (t) => t * speed);
    expect(m.spin).toBeGreaterThan(speed * 0.9);
    run(m, 0.7, (t) => t * speed, false, 0.3);
    expect(m.spin).toBeCloseTo(speed, 0);
    const peak = m.energy;
    expect(peak).toBeGreaterThan(0.8);

    const stopAt = 1 * speed;
    run(m, 0.5, () => stopAt);
    expect(m.energy).toBeGreaterThan(peak * 0.4);
    expect(m.energy).toBeLessThan(peak);
    run(m, 3.5, () => stopAt);
    expect(m.energy).toBeLessThan(0.05);
  });

  it('上下轉（pitch）也算；量的是角度變化，和從幾度開始無關', () => {
    const a = fresh(0);
    const b = fresh(720);
    for (let i = 1; i <= 30; i++) {
      stepStageMotion(a, 0, i * 4, FRAME, false);
      stepStageMotion(b, 720, i * 4, FRAME, false);
    }
    expect(a.energy).toBeGreaterThan(0.5);
    expect(b.energy).toBeCloseTo(a.energy, 12);
  });

  it('光環轉速：平常照各自的速度，能量越大轉越快（1＋SPIN_BOOST × 能量 倍）', () => {
    const idle = fresh();
    const before = [...idle.ringAngles];
    stepStageMotion(idle, 0, 0, FRAME, false);
    RINGS.forEach((ring, i) => {
      const moved = (idle.ringAngles[i]! - before[i]! + TAU) % TAU;
      expect(moved).toBeCloseTo((ring.speed * FRAME + TAU) % TAU, 9);
    });
    expect(idle.dustSpeed).toBeCloseTo(DUST_ORBIT, 9);

    const fast = fresh();
    run(fast, 1, (t) => t * 400);
    const e = fast.energy;
    const angles = [...fast.ringAngles];
    stepStageMotion(fast, 401 * 1 + 400 * FRAME, 0, FRAME, false);
    const boost = 1 + SPIN_BOOST * fast.energy;
    RINGS.forEach((ring, i) => {
      const moved = (fast.ringAngles[i]! - angles[i]! + TAU) % TAU;
      expect(moved).toBeCloseTo((ring.speed * boost * FRAME + TAU) % TAU, 6);
    });
    expect(e).toBeGreaterThan(0.85);
    expect(fast.dustSpeed).toBeGreaterThan(DUST_ORBIT * 4);
  });

  it('光環亮度像呼吸：平常在 BREATH_MIN～1 之間慢慢變；轉卡時更亮', () => {
    const m = fresh();
    const seen: number[] = [];
    for (let i = 0; i < 600; i++) {
      stepStageMotion(m, 0, 0, FRAME, false);
      seen.push(m.ringGlow[0]!);
      for (const g of m.ringGlow) {
        expect(g).toBeGreaterThanOrEqual(BREATH_MIN - 1e-9);
        expect(g).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.5); // T-316：明暗幅度加大
    // 每格變化很小（慢慢明暗，不閃）
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThan(0.01);

    // 同一個時間點，轉卡中的比靜止的亮
    const still = fresh();
    const spinning = fresh();
    run(still, 1, () => 0);
    run(spinning, 1, (t) => t * 400);
    RINGS.forEach((_, i) => expect(spinning.ringGlow[i]!).toBeGreaterThan(still.ringGlow[i]! * 1.5));
  });
});

/** 一格之內角度往前走了多少（處理繞回 2π）。 */
const advanced = (before: number, after: number) => (after - before + TAU) % TAU;

describe('懸浮光環上下浮動', () => {
  it('整個光環平面輕輕上下浮動：幅度 RING_BOB（0.01～0.02 卡寬）、週期 RING_BOB_PERIOD（3～5 秒），慢慢動不跳', () => {
    expect(RING_BOB).toBeGreaterThanOrEqual(0.01);
    expect(RING_BOB).toBeLessThanOrEqual(0.02);
    expect(RING_BOB_PERIOD).toBeGreaterThanOrEqual(3);
    expect(RING_BOB_PERIOD).toBeLessThanOrEqual(5);
    const m = fresh();
    const seen: number[] = [];
    for (let i = 0; i < 600; i++) {
      stepStageMotion(m, 0, 0, FRAME, false);
      seen.push(m.ringLift);
      expect(Math.abs(m.ringLift)).toBeLessThanOrEqual(RING_BOB + 1e-9);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(RING_BOB * 1.9);
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThan(RING_BOB * 0.05);
    // 往上穿過 0 的次數＝10 秒裡浮了幾次
    let ups = 0;
    for (let i = 1; i < seen.length; i++) if (seen[i - 1]! < 0 && seen[i]! >= 0) ups++;
    expect(ups).toBe(Math.floor(10 / RING_BOB_PERIOD));
  });
});

describe('底光慢慢轉（展示台）', () => {
  it('平常 40～60 秒轉一圈；轉卡時稍微快一點（1.5～3 倍）', () => {
    expect(TAU / PEDESTAL_SPIN).toBeGreaterThanOrEqual(40);
    expect(TAU / PEDESTAL_SPIN).toBeLessThanOrEqual(60);
    const idle = fresh();
    run(idle, 1, () => 0);
    const a0 = idle.pedestalAngle;
    stepStageMotion(idle, 0, 0, FRAME, false);
    expect(advanced(a0, idle.pedestalAngle)).toBeCloseTo(PEDESTAL_SPIN * FRAME, 9);

    const fast = fresh();
    run(fast, 1, (t) => t * 400);
    const b0 = fast.pedestalAngle;
    stepStageMotion(fast, 400 + 400 * FRAME, 0, FRAME, false);
    const ratio = advanced(b0, fast.pedestalAngle) / (PEDESTAL_SPIN * FRAME);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThanOrEqual(3);
  });
});

describe('外圈流光', () => {
  it('1～2 道；平常 4～6 秒繞一圈、亮度倍數 1', () => {
    expect(COMET_COUNT).toBeGreaterThanOrEqual(1);
    expect(COMET_COUNT).toBeLessThanOrEqual(2);
    expect(TAU / COMET_SPEED).toBeGreaterThanOrEqual(4);
    expect(TAU / COMET_SPEED).toBeLessThanOrEqual(6);
    const m = fresh();
    run(m, 1, () => 0);
    const a0 = m.cometAngle;
    stepStageMotion(m, 0, 0, FRAME, false);
    expect(advanced(a0, m.cometAngle)).toBeCloseTo(COMET_SPEED * FRAME, 9);
    expect(m.cometGlow).toBeCloseTo(1, 9);
    expect(m.cometAngle).toBeGreaterThanOrEqual(0);
    expect(m.cometAngle).toBeLessThan(TAU);
  });

  it('轉卡時跑得更快（至少 1.8 倍）、更亮（至少 1.6 倍）；停手後慢慢回到平常', () => {
    const m = fresh();
    run(m, 1, (t) => t * 400);
    const a0 = m.cometAngle;
    stepStageMotion(m, 400 + 400 * FRAME, 0, FRAME, false);
    expect(advanced(a0, m.cometAngle) / (COMET_SPEED * FRAME)).toBeGreaterThan(1.8);
    expect(m.cometGlow).toBeGreaterThan(1.6);
    run(m, 4, () => 400 + 400 * FRAME);
    expect(m.cometGlow).toBeLessThan(1.1);
  });
});

describe('能量漣漪', () => {
  it('定時：開始後 RIPPLE_FIRST 秒第一圈，之後每 RIPPLE_PERIOD 秒一圈', () => {
    const m = fresh();
    const starts = run(m, 21, () => 0);
    expect(starts.length).toBe(Math.floor((21 - RIPPLE_FIRST) / RIPPLE_PERIOD) + 1);
    expect(starts[0]).toBeCloseTo(RIPPLE_FIRST, 1);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeCloseTo(RIPPLE_PERIOD, 1);
  });

  it('翻面時馬上一圈（正 → 背、背 → 正都算），並重新計時下一圈', () => {
    const m = fresh();
    run(m, 0.5, () => 0);
    expect(m.rippleAge).toBe(Infinity);
    // 0.5 秒內從正面轉到背面
    const toBack = run(m, 0.5, (t) => (t - 0.5) * 360, false, 0.5);
    expect(toBack.length).toBe(1);
    expect(m.facing).toBe('back');
    expect(m.nextRipple).toBeGreaterThan(RIPPLE_PERIOD - 0.5);
    run(m, 1, () => 180, false, 1);
    const toFront = run(m, 0.5, (t) => 180 + (t - 2) * 360, false, 2);
    expect(toFront.length).toBe(1);
    expect(m.facing).toBe('front');
  });

  it('翻面的那一圈比定時的亮（rippleBoost）', () => {
    expect(RIPPLE_FLIP_BOOST).toBeGreaterThan(1.2);
    const m = fresh();
    run(m, RIPPLE_FIRST + 0.1, () => 0); // 定時的第一圈
    expect(m.rippleAge).toBeLessThan(0.2);
    expect(m.rippleBoost).toBe(1);
    run(m, 0.5, (t) => t * 360); // 0.5 秒轉半圈：翻到背面
    expect(m.facing).toBe('back');
    expect(m.rippleBoost).toBe(RIPPLE_FLIP_BOOST);
    const timed = run(m, RIPPLE_PERIOD, () => 180); // 翻面後 RIPPLE_PERIOD 秒內會有下一圈定時的
    expect(timed.length).toBe(1);
    expect(m.rippleBoost).toBe(1);
  });

  it('卡在側面附近抖動不會一直觸發', () => {
    const m = fresh(88);
    const starts = run(m, 1, (t) => 88 + 4 * Math.sin(t * 40)); // 84°～92° 之間來回
    expect(starts.length).toBe(0);
  });

  it('漣漪由內往外擴散、越外越淡，結束後沒有', () => {
    const at = (s: number) => rippleShape(s * RIPPLE_DURATION);
    expect(at(0.02).radius).toBeGreaterThanOrEqual(RIPPLE_START);
    let last = at(0.02);
    for (const s of [0.2, 0.4, 0.6, 0.8, 0.98]) {
      const now = at(s);
      expect(now.radius).toBeGreaterThan(last.radius);
      expect(now.radius).toBeLessThanOrEqual(RIPPLE_END);
      expect(now.width).toBeGreaterThan(last.width);
      if (s >= 0.4) expect(now.strength).toBeLessThan(last.strength);
      last = now;
    }
    expect(at(0.1).strength).toBeGreaterThan(0.2);
    expect(rippleShape(RIPPLE_DURATION).strength).toBe(0);
    expect(rippleShape(Infinity).strength).toBe(0);
    expect(rippleShape(NaN).strength).toBe(0);
  });

  it('漣漪是清楚的細環：環寬（2 × 半寬）一直在 0.02～0.04 卡寬，後面拖的淡光很短、很淡', () => {
    for (let s = 0; s < 1; s += 0.01) {
      const w = rippleShape(s * RIPPLE_DURATION).width * 2;
      expect(w).toBeGreaterThanOrEqual(0.02);
      expect(w).toBeLessThanOrEqual(0.04);
    }
    expect(RIPPLE_TRAIL).toBeLessThanOrEqual(3);
    expect(RIPPLE_TRAIL_GAIN).toBeLessThanOrEqual(0.25);
  });

  it('rippleShape 寫進同一個物件（每影格不建新物件）', () => {
    const out = { radius: 0, width: 0, strength: 0 };
    expect(rippleShape(0.5, out)).toBe(out);
    expect(rippleShape(Infinity, out)).toBe(out);
  });
});

describe('減少動態效果：舞台靜止', () => {
  it('光環不轉不呼吸不浮、底光不轉、沒有流光、沒有漣漪（翻面也沒有）、時間停住、轉卡也沒反應', () => {
    const m = fresh();
    run(m, 2.3, () => 0); // 先跑一段：角度、浮動都不在起點
    const angles = [...m.ringAngles];
    const pedestal = m.pedestalAngle;
    const comet = m.cometAngle;
    const time = m.time;
    const starts = run(m, 12, (t) => t * 300, true);
    expect(starts.length).toBe(0);
    expect(m.rippleAge).toBe(Infinity);
    expect(m.ringAngles).toEqual(angles);
    for (const g of m.ringGlow) expect(g).toBe(BREATH_STILL);
    expect(m.ringLift).toBe(0);
    expect(m.pedestalAngle).toBe(pedestal);
    expect(m.cometAngle).toBe(comet);
    expect(m.cometGlow).toBe(0);
    expect(m.time).toBe(time);
    expect(m.energy).toBe(0);
    expect(m.dustSpeed).toBe(0);
  });

  it('關掉減少動態效果後，不會因為期間轉過的角度突然暴衝', () => {
    const m = fresh();
    run(m, 2, (t) => t * 300, true);
    stepStageMotion(m, 2 * 300, 0, FRAME, false);
    expect(m.energy).toBe(0);
  });
});

describe('每影格的成本', () => {
  it('只改同一個狀態物件裡的數字（陣列不換）；第一格 dt＝0、很長的一格都不會出現 NaN', () => {
    const m = initialStageMotion();
    const { ringAngles, ringGlow } = m;
    stepStageMotion(m, 10, 5, 0, false);
    stepStageMotion(m, 50, 5, 3, false);
    stepStageMotion(m, 50, 5, FRAME, false);
    expect(m.ringAngles).toBe(ringAngles);
    expect(m.ringGlow).toBe(ringGlow);
    for (const v of [
      m.spin,
      m.energy,
      m.time,
      m.dustAngle,
      m.dustSpeed,
      m.ringLift,
      m.pedestalAngle,
      m.cometAngle,
      m.cometGlow,
      m.rippleBoost,
      ...m.ringAngles,
      ...m.ringGlow,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(m.energy).toBeLessThan(0.2); // 3 秒轉 40° 不算快
  });
});
