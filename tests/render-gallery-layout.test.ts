// 展示廳（T-410、T-816）的純數學：台子的位置與形狀（T-816 三層＋上層台面細光環）、浮著的玻璃板放在哪（看得到、在卡片後面、
// 約卡高 0.55～0.7；T-816c 照預覽區寬高比排、兩兩不重疊、不進卡片範圍；T-816e 垂直邊界與適用範圍）、漂浮、發光環的呼吸、
// 花瓣與散景光點的遠近分布、光柱的明暗、地板的倒影（T-816c 調亮）與地上的光的上限（T-816e）、減少動態效果。
import { describe, expect, it } from 'vitest';
import { ASPECT_HEIGHT } from '../src/model/types';
import { ZOOM_DEFAULT } from '../src/interact/view';
import { cameraDistance, cardBox } from '../src/render/fit';
import {
  BOKEH_BOX,
  BOKEH_COUNT,
  BOKEH_SIZE,
  FLOAT_BOB,
  GALLERY_LIGHTS,
  GALLERY_PULLBACK,
  galleryReach,
  FLOAT_GLASS_PAD,
  FLOAT_PLATES,
  floatBlurPx,
  floatBob,
  floatCorners,
  floatOpacity,
  floatSlots,
  FLOOR_LIGHT,
  floorLightPeak,
  FLOOR_REFLECTION,
  FLOOR_Y,
  GALLERY_GAP,
  galleryY,
  HALL_SHAFT_GAIN,
  LAYOUT_FOV,
  LAYOUT_ZOOM,
  MAX_GALLERY_CARDS,
  PETAL_BOX,
  PETAL_COUNT,
  petalDepth,
  rimGlow,
  rimMirrors,
  shaftLevel,
  SHAFT_SHIMMER_PERIOD,
  softLimit,
  TIERS,
  tierProfile,
  TOP_RINGS,
  type FloatSlot,
} from '../src/render/gallery-layout';
import { REFLECTION_FADE, REFLECTION_SOFTEN } from '../src/render/reflection';
import { BREATH_MIN, BREATH_STILL, GLOW_BOOST } from '../src/render/stage-motion';

const FOV = 30;
const RAD = Math.PI / 180;
/** 玻璃板的比例（標準卡）。 */
const GLASS_ASPECT = 88 / 63;

/** 預設鏡頭（縮放 0.85、預覽區寬高比 aspect、展示廳的取景）離卡片多遠。鏡頭在 (0, 0, D) 看原點。 */
function galleryCamera(viewAspect: number, cardAspect: 'standard' | 'tarot' = 'standard') {
  const cardH = ASPECT_HEIGHT[cardAspect];
  return cameraDistance(FOV, viewAspect, ZOOM_DEFAULT, cardBox(cardH), galleryReach(cardH));
}

describe('台子的位置與形狀', () => {
  it('上層台面在卡片下緣再往下 GALLERY_GAP（比全息光環貼近，卡片像站在台上）；塔羅牌比較高，台子跟著低', () => {
    expect(galleryY(ASPECT_HEIGHT.standard)).toBeCloseTo(-(ASPECT_HEIGHT.standard / 2 + GALLERY_GAP), 12);
    expect(galleryY(ASPECT_HEIGHT.tarot)).toBeLessThan(galleryY(ASPECT_HEIGHT.standard));
    expect(GALLERY_GAP).toBeLessThan(0.1);
  });

  it('三層（T-816 照美化稿）：越上層越小；每一層的頂面＝上一層的底；地板＝最下層的底', () => {
    expect(TIERS.length).toBe(3);
    expect(TIERS[0]!.top).toBe(0);
    for (let i = 1; i < TIERS.length; i++) {
      const upper = TIERS[i - 1]!;
      const lower = TIERS[i]!;
      expect(upper.radius).toBeLessThan(lower.radius);
      // 每層露出一圈台面（看得到台緣光環），但不會比卡片窄
      expect(lower.radius - upper.radius).toBeGreaterThan(0.1);
      expect(lower.top).toBeCloseTo(upper.top - upper.height, 12);
    }
    const last = TIERS.at(-1)!;
    expect(FLOOR_Y).toBeCloseTo(last.top - last.height, 12);
  });

  it('最上層台面多兩三圈細光環：都在台面上（斜面以內）、由內到外、彼此不疊', () => {
    const top = TIERS[0]!;
    expect(TOP_RINGS.length).toBeGreaterThanOrEqual(2);
    expect(TOP_RINGS.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < TOP_RINGS.length; i++) {
      const ring = TOP_RINGS[i]!;
      expect(ring.radius + ring.width * 3).toBeLessThan(top.radius - top.bevel);
      expect(ring.width).toBeLessThan(0.01);
      if (i > 0) expect(ring.radius - TOP_RINGS[i - 1]!.radius).toBeGreaterThan(0.05);
    }
  });

  it('台子比卡片寬：卡片轉到側面（卡寬 1 變成前後方向）也站得在上層台面上', () => {
    expect(TIERS[0]!.radius).toBeGreaterThan(0.5);
  });

  it('剖面是凸的（不測深度、只畫朝外的面也不會互相蓋錯）：從底部中心繞到頂面中心一路左轉或直走', () => {
    for (const tier of TIERS) {
      const pts = tierProfile(tier).filter((p, i, all) => i === 0 || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y);
      expect(pts[0]).toEqual({ x: 0, y: -tier.height });
      expect(pts.at(-1)).toEqual({ x: 0, y: 0 });
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const c = pts[i + 1]!;
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        expect(cross).toBeGreaterThanOrEqual(-1e-12);
      }
      // 最寬的地方＝半徑、最高＝頂面
      expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(tier.radius, 12);
      expect(Math.max(...pts.map((p) => p.y))).toBe(0);
    }
  });

  it('轉角的點各放兩次（LatheGeometry 的法線才不會把斜面和側邊平均成一片漸層）', () => {
    for (const tier of TIERS) {
      const pts = tierProfile(tier);
      const inner = pts.slice(1, -1);
      expect(inner.length % 2).toBe(0);
      for (let i = 0; i < inner.length; i += 2) expect(inner[i]).toEqual(inner[i + 1]);
    }
  });
});

describe('浮著的玻璃板（卡片庫其他卡的縮圖；T-816 放大、離卡近，T-816c 照預覽區寬高比排）', () => {
  /** 要檢查的預覽區寬高比（T-816c 派工的 1.0／1.2／1.78／2.2，再加更窄、中間、更寬）與卡片比例（自訂的最扁 0.5、最長 2）。 */
  const VIEW_ASPECTS = [0.7, 1, 1.2, 1.5, 1.78, 2.2, 3] as const;
  const CARD_HEIGHTS = [ASPECT_HEIGHT.standard, ASPECT_HEIGHT.tarot, ASPECT_HEIGHT.square, ASPECT_HEIGHT.postcard, 0.5, 2] as const;
  const shown = (slots: readonly FloatSlot[]) => slots.filter((s) => s.width > 0);

  /** 預設鏡頭（縮放 0.85、垂直視角 fov）看一點：NDC（−1～1 在畫面裡）。p 是展示廳原點的座標（y 再加 galleryY 才是世界座標）。 */
  function ndc(p: { x: number; y: number; z: number }, viewAspect: number, cardH: number, fov = FOV) {
    const d = cameraDistance(fov, viewAspect, ZOOM_DEFAULT, cardBox(cardH), galleryReach(cardH));
    const t = Math.tan((fov / 2) * RAD);
    const depth = d - p.z;
    return { x: p.x / depth / (t * viewAspect), y: (p.y + galleryY(cardH)) / depth / t };
  }
  /** 玻璃板（比裡面的卡片大 FLOAT_GLASS_PAD 倍、標準卡比例）在畫面上的左右範圍與上下範圍（含上下漂）。 */
  function glassBox(slot: FloatSlot, viewAspect: number, cardH: number, fov = FOV) {
    const w = slot.width * FLOAT_GLASS_PAD;
    const pts = [-FLOAT_BOB, FLOAT_BOB].flatMap((bob) =>
      floatCorners({ ...slot, y: slot.y + bob }, w, w * GLASS_ASPECT).map((c) => ndc(c, viewAspect, cardH, fov)),
    );
    const xs = pts.map((c) => c.x);
    const ys = pts.map((c) => c.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  /** 卡片在畫面上的半寬（NDC）：正面、以及左右轉到任何角度時近側那條邊（透視會稍微變寬）取最大。 */
  function cardHalfX(viewAspect: number, cardH: number, fov = FOV): number {
    let half = 0;
    for (let deg = 0; deg <= 90; deg++) {
      const a = deg * RAD;
      half = Math.max(half, ndc({ x: 0.5 * Math.cos(a), y: -galleryY(cardH), z: 0.5 * Math.sin(a) }, viewAspect, cardH, fov).x);
    }
    return half;
  }
  /** 一組排法的所有條件：同一邊兩兩不重疊、不進卡片、整片（含上下漂）在畫面裡、板子下緣漂到最低時在台面上方。 */
  function expectGoodLayout(viewAspect: number, cardH: number, fov = FOV) {
    const slots = shown(floatSlots(viewAspect, cardH, fov));
    const half = cardHalfX(viewAspect, cardH, fov);
    const label = `寬高比 ${viewAspect}、卡高 ${cardH.toFixed(2)}、視角 ${fov}`;
    for (const side of [-1, 1]) {
      const boxes = slots.filter((s) => Math.sign(s.x) === side).map((s) => glassBox(s, viewAspect, cardH, fov));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(Math.min(boxes[i]!.x1, boxes[j]!.x1) - Math.max(boxes[i]!.x0, boxes[j]!.x0), label).toBeLessThanOrEqual(0);
        }
      }
    }
    for (const s of slots) {
      const b = glassBox(s, viewAspect, cardH, fov);
      expect(Math.min(Math.abs(b.x0), Math.abs(b.x1)), label).toBeGreaterThan(half);
      for (const v of [b.x0, b.x1, b.y0, b.y1]) expect(Math.abs(v), label).toBeLessThan(1);
      expect(s.y - (s.width * FLOAT_GLASS_PAD * GLASS_ASPECT) / 2 - FLOAT_BOB, label).toBeGreaterThan(0);
    }
    return slots;
  }

  it('最多 6 個位置：近的先放縮圖、左右交替；遠近（far）由近到遠，排數（由內到外）越外越遠', () => {
    expect(FLOAT_PLATES.length).toBe(MAX_GALLERY_CARDS);
    expect(MAX_GALLERY_CARDS).toBe(6);
    expect(FLOAT_PLATES.map((p) => p.side)).toEqual([-1, 1, -1, 1, -1, 1]);
    expect(FLOAT_PLATES.map((p) => p.rank)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(FLOAT_PLATES.map((p) => p.far)).toEqual([...FLOAT_PLATES.map((p) => p.far)].sort((a, b) => a - b));
    for (const side of [-1, 1]) {
      const zs = FLOAT_PLATES.filter((p) => p.side === side).map((p) => p.z);
      expect(zs).toEqual([...zs].sort((a, b) => b - a));
    }
    expect(new Set(FLOAT_PLATES.map((p) => p.phase)).size).toBe(FLOAT_PLATES.length);
  });

  it('排法用的鏡頭＝工坊預設（縮放 ZOOM_DEFAULT、垂直視角 30°）', () => {
    expect(LAYOUT_ZOOM).toBe(ZOOM_DEFAULT);
    expect(LAYOUT_FOV).toBe(FOV);
  });

  it('寬高比 1.0／1.2／1.78／2.2（還有更窄、更寬）、各種卡片比例：同一邊的玻璃板兩兩不重疊（含上下漂）', () => {
    for (const viewAspect of VIEW_ASPECTS) {
      for (const cardH of CARD_HEIGHTS) {
        const slots = shown(floatSlots(viewAspect, cardH));
        for (const side of [-1, 1]) {
          const boxes = slots.filter((s) => Math.sign(s.x) === side).map((s) => glassBox(s, viewAspect, cardH));
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              const overlap = Math.min(boxes[i]!.x1, boxes[j]!.x1) - Math.max(boxes[i]!.x0, boxes[j]!.x0);
              expect(overlap, `寬高比 ${viewAspect}、卡高 ${cardH.toFixed(2)}：第 ${i}、${j} 片`).toBeLessThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it('不進卡片範圍（正面與左右轉時的卡片寬度都留空隙）、整片在畫面裡（含上下漂）', () => {
    for (const viewAspect of VIEW_ASPECTS) {
      for (const cardH of CARD_HEIGHTS) {
        const half = cardHalfX(viewAspect, cardH);
        for (const slot of shown(floatSlots(viewAspect, cardH))) {
          const b = glassBox(slot, viewAspect, cardH);
          const label = `寬高比 ${viewAspect}、卡高 ${cardH.toFixed(2)}、x ${slot.x.toFixed(2)}`;
          expect(Math.min(Math.abs(b.x0), Math.abs(b.x1)), label).toBeGreaterThan(half);
          expect(Math.sign(b.x0), label).toBe(Math.sign(b.x1));
          for (const v of [b.x0, b.x1, b.y0, b.y1]) expect(Math.abs(v), label).toBeLessThan(1);
        }
      }
    }
  });

  it('張數照寬度：標準卡 1.78 以上每邊 3 片、1.0～1.2 每邊至少 2 片；任何卡片比例在寬高比 1 以上每邊至少 1 片；沒放的位置寬 0', () => {
    const perSide = (viewAspect: number, cardH: number) => {
      const slots = shown(floatSlots(viewAspect, cardH));
      return [-1, 1].map((side) => slots.filter((s) => Math.sign(s.x) === side).length);
    };
    for (const a of [1.78, 2.2, 3]) expect(perSide(a, ASPECT_HEIGHT.standard)).toEqual([3, 3]);
    for (const a of [1, 1.2]) for (const n of perSide(a, ASPECT_HEIGHT.standard)) expect(n).toBeGreaterThanOrEqual(2);
    for (const a of [1, 1.2, 1.5, 1.78, 2.2]) for (const cardH of CARD_HEIGHTS) for (const n of perSide(a, cardH)) expect(n).toBeGreaterThanOrEqual(1);
    // 一定是近的先放：放了第 k 排，k−1 排一定也放
    for (const viewAspect of VIEW_ASPECTS) {
      for (const cardH of CARD_HEIGHTS) {
        const slots = floatSlots(viewAspect, cardH);
        expect(slots.length).toBe(FLOAT_PLATES.length);
        slots.forEach((s, i) => {
          if (s.width > 0 && FLOAT_PLATES[i]!.rank > 0) expect(slots[i - 2]!.width).toBeGreaterThan(0);
        });
      }
    }
  });

  it('都在卡片後面、離卡近（z −0.5～−4）、面向中間；越外排越遠、越往外（畫面上）', () => {
    for (const viewAspect of VIEW_ASPECTS) {
      for (const cardH of CARD_HEIGHTS) {
        const slots = floatSlots(viewAspect, cardH);
        slots.forEach((s, i) => {
          expect(s.far).toBe(FLOAT_PLATES[i]!.far);
          expect(s.phase).toBe(FLOAT_PLATES[i]!.phase);
          if (s.width === 0) return;
          expect(s.z).toBeLessThan(-0.5);
          expect(s.z).toBeGreaterThan(-4);
          expect(Math.sign(s.x)).toBe(FLOAT_PLATES[i]!.side);
          expect(Math.sign(s.yawDeg)).toBe(-Math.sign(s.x));
          if (FLOAT_PLATES[i]!.rank > 0) {
            const inner = slots[i - 2]!;
            expect(Math.abs(glassBox(s, viewAspect, cardH).x0 + glassBox(s, viewAspect, cardH).x1)).toBeGreaterThan(
              Math.abs(glassBox(inner, viewAspect, cardH).x0 + glassBox(inner, viewAspect, cardH).x1),
            );
          }
        });
      }
    }
  });

  it('看起來約卡高的 0.55～0.72（標準卡、寬的預覽區）：最近的一排最大、越外越小；窄的預覽區縮小但不小於 0.45', () => {
    const cardH = ASPECT_HEIGHT.standard;
    const ratio = (s: FloatSlot, viewAspect: number) => {
      const d = cameraDistance(FOV, viewAspect, ZOOM_DEFAULT, cardBox(cardH), galleryReach(cardH));
      return (s.width * GLASS_ASPECT) / (d - s.z) / (cardH / d);
    };
    for (const viewAspect of [1.78, 2.2]) {
      const slots = shown(floatSlots(viewAspect, cardH));
      for (const s of slots) {
        expect(ratio(s, viewAspect)).toBeGreaterThanOrEqual(0.55);
        expect(ratio(s, viewAspect)).toBeLessThanOrEqual(0.72);
      }
      expect(ratio(slots[0]!, viewAspect)).toBeGreaterThanOrEqual(0.65);
      expect(ratio(slots.at(-1)!, viewAspect)).toBeLessThan(ratio(slots[0]!, viewAspect));
    }
    for (const viewAspect of [0.7, 1, 1.2, 1.5]) {
      for (const s of shown(floatSlots(viewAspect, cardH))) expect(ratio(s, viewAspect)).toBeGreaterThanOrEqual(0.45);
    }
  });

  it('不碰台子：上下漂到最低時，板子下緣還在最上層台面上方（各種寬高比與卡片比例）', () => {
    for (const viewAspect of VIEW_ASPECTS) {
      for (const cardH of CARD_HEIGHTS) {
        for (const s of shown(floatSlots(viewAspect, cardH))) {
          const bottom = s.y - (s.width * FLOAT_GLASS_PAD * GLASS_ASPECT) / 2 - FLOAT_BOB;
          expect(bottom).toBeGreaterThan(0);
        }
      }
    }
  });

  it('寬高比慢慢變時排法跟著慢慢變（同一個張數時不跳）；不合理的數字（0、NaN）不會壞掉', () => {
    const cardH = ASPECT_HEIGHT.standard;
    let prev = floatSlots(1.8, cardH);
    for (let a = 1.81; a <= 2.6; a += 0.01) {
      const next = floatSlots(a, cardH);
      next.forEach((s, i) => {
        if (s.width > 0 && prev[i]!.width > 0) {
          expect(Math.abs(s.x - prev[i]!.x)).toBeLessThan(0.05);
          expect(Math.abs(s.width - prev[i]!.width)).toBeLessThan(0.02);
        }
      });
      prev = next;
    }
    for (const bad of [0, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const slots = floatSlots(bad, cardH);
      expect(slots.length).toBe(FLOAT_PLATES.length);
      for (const s of slots) for (const v of [s.x, s.y, s.z, s.width, s.yawDeg]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('適用範圍的邊界（T-816e）：寬高比 0.3～4、卡高 0.5～2（自訂比例的範圍；超出照邊界算）、視角 20°～45° 都成立；每邊至少放 1 片', () => {
    for (const viewAspect of [0.3, 0.7, 1, 1.78, 4]) {
      for (const cardH of [0.5, ASPECT_HEIGHT.standard, 2]) {
        for (const fov of [20, 30, 45]) {
          const slots = expectGoodLayout(viewAspect, cardH, fov);
          if (viewAspect >= 1) for (const side of [-1, 1]) expect(slots.filter((s) => Math.sign(s.x) === side).length).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // 卡高超出 0.5～2：照邊界排
    expect(floatSlots(1.78, 3)).toEqual(floatSlots(1.78, 2));
    expect(floatSlots(1.78, 0.2)).toEqual(floatSlots(1.78, 0.5));
  });

  it('垂直也檢查（T-816e）：板子漂到最高時頂端在畫面裡，太高放不下就縮小或少放（很扁的卡，台子在畫面上比較高）', () => {
    // 很扁的卡（0.5）＋寬的預覽區：台子比較高、板子要抬到台面上方，仍然整片在畫面裡
    for (const viewAspect of [1.2, 2.2, 4]) expectGoodLayout(viewAspect, 0.5);
  });

  it('上下漂 ±FLOAT_BOB、每張相位不同（減少動態效果時舞台時間停住＝不漂，stage-motion 的測試）', () => {
    const seen = new Set<number>();
    const slots = floatSlots(1.78, ASPECT_HEIGHT.standard);
    for (let t = 0; t < 20; t += 0.25) {
      for (const slot of slots) {
        const b = floatBob(slot, t);
        expect(Math.abs(b)).toBeLessThanOrEqual(FLOAT_BOB + 1e-12);
        seen.add(Math.round(b * 1e6));
      }
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('四個角：繞自己的中心轉，寬高不變、中心不動', () => {
    const slot = floatSlots(1.78, ASPECT_HEIGHT.standard)[0]!;
    const c = floatCorners(slot, 0.6, 0.84);
    const mid = c.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4, z: a.z + p.z / 4 }), { x: 0, y: 0, z: 0 });
    expect(mid.x).toBeCloseTo(slot.x, 12);
    expect(mid.y).toBeCloseTo(slot.y, 12);
    expect(mid.z).toBeCloseTo(slot.z, 12);
    expect(Math.hypot(c[1]!.x - c[0]!.x, c[1]!.z - c[0]!.z)).toBeCloseTo(0.6, 12);
    expect(c[3]!.y - c[0]!.y).toBeCloseTo(0.84, 12);
    // 左邊的卡（yaw > 0）右緣比較遠：面向中間
    expect(c[1]!.z).toBeLessThan(c[0]!.z);
  });

  it('越遠越淡、越糊（景深）', () => {
    expect(floatOpacity(0)).toBeGreaterThan(floatOpacity(1));
    expect(floatOpacity(1)).toBeGreaterThan(0);
    expect(floatOpacity(0)).toBeLessThan(1); // 半透明
    expect(floatBlurPx(1)).toBeGreaterThan(floatBlurPx(0));
    expect(floatBlurPx(0)).toBeGreaterThan(0);
  });
});

describe('發光環與花瓣', () => {
  it('呼吸：亮度隨時間變；轉卡越快越亮；減少動態效果時固定', () => {
    const values = new Set<number>();
    for (let t = 0; t < 10; t += 0.5) values.add(Math.round(rimGlow(t, 0, false) * 1e6));
    expect(values.size).toBeGreaterThan(5);
    for (let t = 0; t < 10; t += 0.5) expect(rimGlow(t, 1, false)).toBeGreaterThan(rimGlow(t, 0, false));
    expect(rimGlow(0, 0, true)).toBe(BREATH_STILL);
    expect(rimGlow(3.7, 1, true)).toBe(BREATH_STILL);
  });

  it('花瓣在台面上方飄落（不會落到台子上蓋住它）', () => {
    expect(PETAL_BOX.bottom).toBeGreaterThan(0);
    expect(PETAL_BOX.top).toBeGreaterThan(PETAL_BOX.bottom);
  });
});

describe('花瓣與散景光點（T-816）', () => {
  it('花瓣大小不一：近的大而模糊、遠的小而清楚（遠近 0→1 一路變大、變糊、變近）', () => {
    const far = petalDepth(0);
    const near = petalDepth(1);
    expect(far.blur).toBe(0);
    expect(near.blur).toBeGreaterThan(0.6);
    expect(near.size).toBeGreaterThanOrEqual(far.size * 2.5);
    expect(near.z).toBeGreaterThan(0); // 最近的在卡片前面
    expect(far.z).toBeLessThan(-3);
    let last = petalDepth(0);
    for (let n = 0.1; n <= 1.0001; n += 0.1) {
      const d = petalDepth(n);
      expect(d.size).toBeGreaterThan(last.size);
      expect(d.z).toBeGreaterThan(last.z);
      expect(d.blur).toBeGreaterThanOrEqual(last.blur);
      last = d;
    }
  });

  it('看起來的大小也是近的大：最近的花瓣在畫面上至少是最遠的 4 倍', () => {
    const d = galleryCamera(1.4);
    const screen = (n: number) => petalDepth(n).size / (d - petalDepth(n).z);
    expect(screen(1)).toBeGreaterThan(screen(0) * 4);
  });

  it('近的花瓣不從卡片前面飄過：離中間至少比卡片在那個深度的半寬再遠一點', () => {
    const d = galleryCamera(1.4);
    for (const n of [0.8, 0.9, 1]) {
      const p = petalDepth(n);
      const cardHalf = (0.5 * (d - p.z)) / d;
      expect(p.minX).toBeGreaterThan(cardHalf + 0.15);
      expect(p.maxX).toBeGreaterThan(p.minX);
    }
    // 遠的散在整個背景
    expect(petalDepth(0).minX).toBe(0);
    expect(petalDepth(0).maxX).toBeGreaterThan(2.5);
  });

  it('片數：花瓣多一點、另外有一批散景光點；光點在卡片後面、柔和（大小有大有小）', () => {
    expect(PETAL_COUNT).toBeGreaterThanOrEqual(34);
    expect(BOKEH_COUNT).toBeGreaterThanOrEqual(16);
    expect(PETAL_COUNT + BOKEH_COUNT).toBeLessThanOrEqual(96);
    expect(BOKEH_BOX.maxZ).toBeLessThan(-0.5);
    expect(BOKEH_BOX.minY).toBeGreaterThan(0);
    expect(BOKEH_SIZE[1]).toBeGreaterThan(BOKEH_SIZE[0] * 2);
  });
});

describe('光柱（T-816：有畫好的大廳時保留成淡淡、慢慢變亮變暗的一層）', () => {
  it('有大廳時比沒有時淡；慢慢起伏（週期 ≥ 8 秒）；減少動態時固定', () => {
    expect(HALL_SHAFT_GAIN).toBeLessThan(0.7);
    expect(SHAFT_SHIMMER_PERIOD).toBeGreaterThanOrEqual(8);
    const seen = new Set<number>();
    for (let t = 0; t < 20; t += 0.5) {
      expect(shaftLevel(t, false, true)).toBeLessThan(shaftLevel(t, false, false) + 1e-9);
      expect(shaftLevel(t, false, true)).toBeGreaterThan(0);
      seen.add(Math.round(shaftLevel(t, false, true) * 1e4));
    }
    expect(seen.size).toBeGreaterThan(8);
    // 起伏幅度夠看得出來（最亮至少是最暗的 1.6 倍）
    const all = [...seen].map((v) => v / 1e4);
    expect(Math.max(...all)).toBeGreaterThan(Math.min(...all) * 1.6);
    expect(shaftLevel(0, true, true)).toBe(shaftLevel(7.3, true, true));
    expect(shaftLevel(0, true, false)).toBe(shaftLevel(7.3, true, false));
  });
});

describe('展示廳的取景（T-410b 拉遠約 8%；T-816 三層台再多退一點）', () => {
  it('galleryReach 讓鏡頭剛好退 GALLERY_PULLBACK 倍，預覽區寬或窄都一樣；三層台要的比 T-410b 多、但卡片只小一點（≤ 1.2 倍）', () => {
    expect(GALLERY_PULLBACK).toBeGreaterThan(1.1);
    expect(GALLERY_PULLBACK).toBeLessThanOrEqual(1.2);
    for (const cardAspect of ['standard', 'tarot'] as const) {
      for (const viewAspect of [0.7, 1, 1.18, 1.6, 2.2]) {
        const plain = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT[cardAspect]));
        const gallery = cameraDistance(FOV, viewAspect, 1, cardBox(ASPECT_HEIGHT[cardAspect]), galleryReach(ASPECT_HEIGHT[cardAspect]));
        expect(gallery / plain).toBeCloseTo(GALLERY_PULLBACK, 9);
      }
    }
  });

  it('預設縮放下整座台子（最下層台底的最前緣、地上亮環）和台面倒影都在畫面裡', () => {
    const lower = TIERS.at(-1)!;
    for (const cardAspect of ['standard', 'tarot'] as const) {
      for (const viewAspect of [1, 1.18, 1.6, 2.2]) {
        const d = cameraDistance(FOV, viewAspect, ZOOM_DEFAULT, cardBox(ASPECT_HEIGHT[cardAspect]), galleryReach(ASPECT_HEIGHT[cardAspect]));
        const t = Math.tan((FOV / 2) * RAD);
        const y0 = galleryY(ASPECT_HEIGHT[cardAspect]);
        // 下層台底最前緣、地上亮環（台緣外一點）：畫面下緣以內
        for (const z of [lower.radius, lower.radius + 0.04]) {
          const ndcY = (y0 + FLOOR_Y) / (d - z) / t;
          expect(ndcY).toBeGreaterThan(-1);
        }
        // 上層台面最前緣（台面倒影在卡片下緣到這裡之間）
        expect((y0 / (d - TIERS[0]!.radius)) / t).toBeGreaterThan(-1);
      }
    }
  });
});

describe('展示廳的亮度（T-410b：台緣光環、光柱、地上亮環調亮約 25%，但不搶卡片）', () => {
  /** T-410 時的亮度（基準）。 */
  const T410 = { rimCore: 1.1, rimSpill: 0.09, rimLine: 1.4, shaft: 0.24, floorRing: 0.55 };

  it('每一項都是 T-410 的 1.25 倍', () => {
    for (const key of Object.keys(T410) as (keyof typeof T410)[]) {
      expect(GALLERY_LIGHTS[key] / T410[key]).toBeCloseTo(1.25, 9);
    }
  });

  it('大片的光（台緣散開的柔光、光柱）最亮時（轉卡最快）仍遠低於卡片：相加不到 0.35', () => {
    expect(GALLERY_LIGHTS.rimSpill * rimGlow(1.3, 1, false)).toBeLessThan(0.35);
    expect(GALLERY_LIGHTS.rimSpill * (1 + GLOW_BOOST)).toBeLessThan(0.35);
    expect(GALLERY_LIGHTS.shaft).toBeLessThan(0.35);
  });
});

describe('地板的倒影（T-816c：和美化稿比太暗 → 調亮；遠處照樣淡出、比台面柔，不像第二張卡）', () => {
  /** T-816 時的數字（基準）。 */
  const T816 = { hallCard: 0.6, stoneCard: 0.45, rimMirror: 0.9, rimMirrorSpill: 0.07 };

  it('卡片倒影（大廳地板、石地板）、地上映出的台緣光環與它的柔光、台子周圍的光：都比 T-816 亮至少 25%', () => {
    for (const key of Object.keys(T816) as (keyof typeof T816)[]) {
      expect(FLOOR_REFLECTION[key] / T816[key], key).toBeGreaterThanOrEqual(1.25);
    }
    // 台緣光環倒影越深越淡得慢一點（下面兩層也看得到），但還是越深越淡
    expect(FLOOR_REFLECTION.rimMirrorDepth).toBeGreaterThan(0.25);
    expect(FLOOR_REFLECTION.rimMirrorDepth).toBeLessThan(1);
  });

  it('卡片還是最亮、最清楚：倒影強度 < 1（比卡片本身淡）；地上的台緣光環比台緣本身暗；石地板與大廳地板倒影比例一致', () => {
    expect(FLOOR_REFLECTION.hallCard).toBeLessThan(1);
    expect(FLOOR_REFLECTION.stoneCard).toBeLessThan(1);
    const nearest = Math.min(...rimMirrors().map((m) => m.height));
    expect(FLOOR_REFLECTION.rimMirror * Math.exp(-nearest / FLOOR_REFLECTION.rimMirrorDepth)).toBeLessThan(GALLERY_LIGHTS.rimCore);
    // 兩種地板調亮的倍數一樣（石地板疊在自己的底色上本來就淡一點）
    expect(FLOOR_REFLECTION.stoneCard / T816.stoneCard).toBeCloseTo(FLOOR_REFLECTION.hallCard / T816.hallCard, 9);
  });

  it('越往遠處照樣淡出、比台面柔：映到卡片下緣往上 1 卡寬時剩不到 30%；柔化比台面（倒影模組的預設）大', () => {
    expect(Math.exp(-1 / FLOOR_REFLECTION.fade)).toBeLessThan(0.3);
    expect(FLOOR_REFLECTION.fade).toBeGreaterThanOrEqual(REFLECTION_FADE);
    expect(FLOOR_REFLECTION.soften.base).toBeGreaterThan(REFLECTION_SOFTEN.base);
    expect(FLOOR_REFLECTION.soften.perHeight).toBeGreaterThan(REFLECTION_SOFTEN.perHeight);
  });
});

describe('地上的光有上限（T-816e：地上亮環中心各項相加、拖曳最亮時藍色會超過 1、比卡片亮）', () => {
  /** 呼吸最暗、減少動態、呼吸最亮、拖曳最快又呼吸最亮。 */
  const GLOWS = [BREATH_MIN, BREATH_STILL, 1, 1 + GLOW_BOOST];

  it('softLimit：上限的 knee 倍以下原封不動；以上一路變大、越來越慢逼近上限（永遠到不了）；接得平順', () => {
    const max = 0.9;
    const start = FLOOR_LIGHT.knee * max;
    for (const x of [0, 0.1, start * 0.5, start]) expect(softLimit(x, max)).toBeCloseTo(x, 12);
    let last = softLimit(start, max);
    for (let x = start + 0.01; x < 3; x += 0.05) {
      const y = softLimit(x, max);
      expect(y).toBeGreaterThan(last);
      expect(y).toBeLessThan(max);
      last = y;
    }
    expect(softLimit(1e3, max)).toBeLessThanOrEqual(max);
    // 接點兩邊的斜率都是 1（沒有折角）
    const h = 1e-6;
    expect((softLimit(start + h, max) - softLimit(start, max)) / h).toBeCloseTo(1, 4);
    expect(FLOOR_LIGHT.knee).toBeGreaterThan(0.3);
    expect(FLOOR_LIGHT.knee).toBeLessThan(1);
  });

  it('地上的光（光暈＋亮環＋三層映出的台緣光環，假設全疊在同一點、亮線取最細）乘上呼吸／拖曳亮度：任何時候都比台緣亮線本身暗', () => {
    for (const glow of GLOWS) expect(floorLightPeak(glow).light, `亮度 ${glow}`).toBeLessThan(GALLERY_LIGHTS.rimCore * glow);
    // 不設上限時真的會超過（上限有作用）：拖曳最亮時各項相加 > 1、也比台緣亮線亮
    const peak = floorLightPeak(1 + GLOW_BOOST);
    expect(peak.raw * (1 + GLOW_BOOST)).toBeGreaterThan(1);
    expect(peak.raw).toBeGreaterThan(GALLERY_LIGHTS.rimCore * FLOOR_LIGHT.rimShare);
  });

  it('再加上白卡最亮的倒影（不算淡出，保守）：總和（最亮的顏色分量）也比卡片的白暗（< 1）', () => {
    for (const glow of GLOWS) expect(floorLightPeak(glow, FLOOR_REFLECTION.hallCard).total, `亮度 ${glow}`).toBeLessThan(1);
    expect(FLOOR_LIGHT.max).toBeLessThan(1);
  });

  it('石地板與大廳地板用同一個光的倍數與上限（合成後看起來一致）；仍比 T-816 亮（大廳 0.8、石地板 1 的 1.25 倍以上）', () => {
    expect('hallGlow' in FLOOR_REFLECTION).toBe(false);
    expect('stoneGlow' in FLOOR_REFLECTION).toBe(false);
    expect(FLOOR_REFLECTION.glow / 0.8).toBeGreaterThanOrEqual(1.25);
    expect(FLOOR_REFLECTION.glow / 1).toBeGreaterThanOrEqual(1.25);
  });
});
