// 舞台主題「魔法陣」（T-415，DESIGN §5「舞台」）：圓環半徑與大小（預設縮放下整個陣的最前緣在畫面裡）、內外圈反方向轉、
// 拖曳反應、減少動態效果時靜止、符紋放得進格子；three.js 物件不擋卡片、只在舞台那一層、dispose 確實釋放。只建物件、不畫。
import { Group, Mesh, Sprite, type Material, type Object3D } from 'three/webgpu';
import { ASPECT_HEIGHT } from '../src/model/types';
import { describe, expect, it } from 'vitest';
import { ZOOM_DEFAULT } from '../src/interact/view';
import { createCardObject } from '../src/render/card-mesh';
import { cameraDistance, cardBox } from '../src/render/fit';
import { createMagicFx } from '../src/render/magic-fx';
import {
  GLYPH_BAND,
  GLYPH_EXTENT,
  GLYPH_LINE,
  glyphCellLength,
  initialMagicMotion,
  MAGIC_DIAMONDS,
  MAGIC_DOTS,
  MAGIC_GAP,
  MAGIC_RINGS,
  MAGIC_SPIN,
  MAGIC_STARS,
  MAGIC_STILL,
  magicY,
  MOTE_COUNT,
  MOTE_RADIUS,
  starEdgeAngles,
  starEdgeDistance,
  stepMagic,
} from '../src/render/magic-layout';
import { CARD_LAYER, STAGE_LAYER } from '../src/render/reflection';

const FOV = 30;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

function drawables(root: Object3D): (Mesh | Sprite)[] {
  const out: (Mesh | Sprite)[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Sprite) out.push(o);
  });
  return out.sort((a, b) => a.renderOrder - b.renderOrder);
}

/** 轉角差（−π～π）。 */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

describe('陣的位置與大小', () => {
  it('陣面在卡片下緣再往下 MAGIC_GAP；塔羅牌比較高，陣跟著低', () => {
    expect(magicY(ASPECT_HEIGHT.standard)).toBeCloseTo(-(ASPECT_HEIGHT.standard / 2 + MAGIC_GAP), 12);
    expect(magicY(ASPECT_HEIGHT.tarot)).toBeLessThan(magicY(ASPECT_HEIGHT.standard));
    expect(MAGIC_GAP).toBeGreaterThan(0);
    expect(MAGIC_GAP).toBeLessThanOrEqual(0.1);
  });

  it('同心圓環由內到外排好；細點、菱形、符紋帶都在最外圈以內', () => {
    const radii = MAGIC_RINGS.map((r) => r.radius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(new Set(radii).size).toBe(radii.length);
    const outer = radii.at(-1)!;
    expect(MAGIC_DOTS.radius).toBeLessThan(outer);
    expect(MAGIC_DIAMONDS.radius).toBeLessThanOrEqual(outer);
    expect(GLYPH_BAND.outer).toBeLessThan(outer);
    // 符紋帶兩邊各有一圈環夾著
    expect(radii).toContain(GLYPH_BAND.inner);
    expect(radii).toContain(GLYPH_BAND.outer);
    // 兩種顏色、兩組都有
    expect(new Set(MAGIC_RINGS.map((r) => r.tint))).toEqual(new Set(['cyan', 'gold']));
    expect(new Set(MAGIC_RINGS.map((r) => r.group))).toEqual(new Set(['inner', 'outer']));
  });

  it('預設縮放下整個陣（最外圈連菱形的最前緣）都在預覽區裡；陣比全息光環的展示台大', () => {
    const front = MAGIC_DIAMONDS.radius + MAGIC_DIAMONDS.across;
    const t = Math.tan((FOV / 2) * RAD);
    for (const cardAspect of ['standard', 'tarot'] as const) {
      for (const viewAspect of [1, 1.18, 1.6, 2.2]) {
        const d = cameraDistance(FOV, viewAspect, ZOOM_DEFAULT, cardBox(ASPECT_HEIGHT[cardAspect]));
        const ndcY = magicY(ASPECT_HEIGHT[cardAspect]) / (d - front) / t;
        expect(ndcY).toBeGreaterThan(-1);
        // 左右也在畫面裡（最寬處 z＝0）
        expect(front / d / (t * viewAspect)).toBeLessThan(1);
      }
    }
    expect(MAGIC_RINGS.at(-1)!.radius).toBeGreaterThan(0.84);
  });
});

describe('星形與符紋（原創幾何）', () => {
  it('星形 {n/k}：每條邊離中心 R·cos(πk/n)；外面那個七芒星的邊剛好貼著內側那圈環', () => {
    for (const star of MAGIC_STARS) {
      expect(Number.isInteger(star.points)).toBe(true);
      expect(star.skip).toBeGreaterThan(1); // 是星形，不是普通多邊形
      expect(star.skip).toBeLessThan(star.points / 2);
      expect(starEdgeDistance(star)).toBeCloseTo(star.radius * Math.cos((Math.PI * star.skip) / star.points), 12);
      expect(starEdgeAngles(star).length).toBe(star.points);
    }
    const ringRadii = MAGIC_RINGS.map((r) => r.radius);
    const touching = ringRadii.some((r) => Math.abs(r - starEdgeDistance(MAGIC_STARS[0]!)) < 0.01);
    expect(touching).toBe(true);
  });

  it('星形邊的法線：相鄰兩條差 2π／n，第一條在頂點 0 與頂點 k 的正中間', () => {
    const star = MAGIC_STARS[0]!;
    const angles = starEdgeAngles(star);
    for (let j = 1; j < angles.length; j++) expect(angles[j]! - angles[j - 1]!).toBeCloseTo(TAU / star.points, 12);
    expect(angles[0]).toBeCloseTo(star.phase + (Math.PI * star.skip) / star.points, 12);
  });

  it('符紋帶：整數格（繞一圈接得起來）；每個符紋放得進自己那一格、不碰到兩邊的環', () => {
    expect(Number.isInteger(GLYPH_BAND.cells)).toBe(true);
    expect(GLYPH_BAND.cells).toBeGreaterThanOrEqual(16);
    expect(2 * (GLYPH_EXTENT.along + GLYPH_LINE)).toBeLessThan(glyphCellLength());
    expect(GLYPH_EXTENT.across + GLYPH_LINE * 2).toBeLessThan((GLYPH_BAND.outer - GLYPH_BAND.inner) / 2);
  });
});

describe('內外圈反方向慢轉、拖曳反應', () => {
  it('平常：內圈和外圈轉向相反；都很慢（一圈超過 30 秒）', () => {
    expect(Math.sign(MAGIC_SPIN.inner)).toBe(-Math.sign(MAGIC_SPIN.outer));
    expect(Math.abs(MAGIC_SPIN.inner)).toBeLessThan(TAU / 30);
    expect(Math.abs(MAGIC_SPIN.outer)).toBeLessThan(TAU / 30);
    const m = initialMagicMotion();
    for (let i = 0; i < 60; i++) stepMagic(m, i / 60, 0, 1 / 60, false);
    expect(angleDelta(0, m.inner)).toBeCloseTo(MAGIC_SPIN.inner, 6);
    expect(angleDelta(0, m.outer)).toBeCloseTo(MAGIC_SPIN.outer, 6);
    expect(Math.sign(angleDelta(0, m.inner))).toBe(-Math.sign(angleDelta(0, m.outer)));
  });

  it('轉卡越快（能量越大）轉越快、越亮', () => {
    const calm = initialMagicMotion();
    const busy = initialMagicMotion();
    stepMagic(calm, 2, 0, 0.1, false);
    stepMagic(busy, 2, 1, 0.1, false);
    expect(Math.abs(angleDelta(0, busy.inner))).toBeGreaterThan(Math.abs(angleDelta(0, calm.inner)) * 2);
    expect(Math.abs(angleDelta(0, busy.outer))).toBeGreaterThan(Math.abs(angleDelta(0, calm.outer)) * 2);
    expect(busy.glow).toBeGreaterThan(calm.glow);
  });

  it('減少動態效果：不轉、亮度固定', () => {
    const m = initialMagicMotion();
    stepMagic(m, 1, 0, 0.5, false);
    const before = { ...m };
    for (let i = 0; i < 30; i++) stepMagic(m, 1 + i, 1, 1 / 60, true);
    expect(m.inner).toBe(before.inner);
    expect(m.outer).toBe(before.outer);
    expect(m.glow).toBe(MAGIC_STILL);
  });

  it('光點在陣的範圍裡出生（不在卡片正中間的細柱裡）', () => {
    expect(MOTE_RADIUS[0]).toBeGreaterThan(0.3);
    expect(MOTE_RADIUS[1]).toBeLessThanOrEqual(MAGIC_RINGS.at(-1)!.radius + 0.1);
  });
});

describe('three.js 物件', () => {
  it('不擋卡片：整組比卡片先畫；每個東西都不寫深度、不測深度、留在不透明那一批', () => {
    const fx = createMagicFx();
    const card = createCardObject(fakeImage(4, 4), 1, fakeImage(512, 512));
    expect(fx.group.renderOrder).toBeLessThan(card.group.renderOrder);
    const parts = drawables(fx.group);
    expect(parts.length).toBe(2); // 地上的陣、光點＝2 個 draw call
    for (const p of parts) {
      const m = p.material as Material;
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
      expect(p.layers.mask).toBe(1 << STAGE_LAYER);
    }
    expect((1 << STAGE_LAYER) & (1 << CARD_LAYER)).toBe(0);
  });

  it('光點：一個 Sprite 畫 MOTE_COUNT 顆，不做視錐剔除；陣是平放的平面', () => {
    const fx = createMagicFx();
    const [circle, motes] = drawables(fx.group) as [Mesh, Sprite];
    expect(motes).toBeInstanceOf(Sprite);
    expect(motes.count).toBe(MOTE_COUNT);
    expect(motes.frustumCulled).toBe(false);
    circle.geometry.computeBoundingBox();
    const box = circle.geometry.boundingBox!;
    expect(box.max.y - box.min.y).toBeCloseTo(0, 6);
    expect(box.max.x).toBeGreaterThan(MAGIC_RINGS.at(-1)!.radius);
  });

  it('跟著卡片比例；不跟著卡片轉', () => {
    const fx = createMagicFx();
    fx.setCardHeight(ASPECT_HEIGHT.tarot);
    expect(fx.group.position.y).toBeCloseTo(magicY(ASPECT_HEIGHT.tarot), 12);
    fx.setCardHeight(ASPECT_HEIGHT.standard);
    expect(fx.group.position.y).toBeCloseTo(magicY(ASPECT_HEIGHT.standard), 12);
    fx.setPose(70, 30);
    fx.update(1 / 60);
    expect(fx.group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('每格只改 uniform：內外圈反方向轉；轉卡時轉得更快', () => {
    const fx = createMagicFx();
    const before = drawables(fx.group).map((p) => [p, p.geometry, p.material]);
    fx.setPose(0, 0);
    fx.update(0);
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    const calmInner = angleDelta(0, fx.uniforms.inner.value);
    const calmOuter = angleDelta(0, fx.uniforms.outer.value);
    expect(Math.sign(calmInner)).toBe(-Math.sign(calmOuter));
    // 拖著轉：每格 8°
    const startInner = fx.uniforms.inner.value;
    for (let i = 1; i <= 60; i++) {
      fx.setPose(i * 8, 0);
      fx.update(1 / 60);
    }
    expect(Math.abs(angleDelta(startInner, fx.uniforms.inner.value))).toBeGreaterThan(Math.abs(calmInner) * 1.5);
    expect(drawables(fx.group).map((p) => [p, p.geometry, p.material])).toEqual(before);
  });

  it('減少動態效果：光點不畫、陣不轉不閃（時間停住）；關掉後恢復', () => {
    const fx = createMagicFx();
    fx.update(0);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    fx.setReducedMotion(true);
    const u = fx.uniforms;
    const still = [u.inner.value, u.outer.value, u.glow.value, u.time.value];
    for (let i = 0; i < 60; i++) {
      fx.setPose(i * 10, 0);
      fx.update(1 / 60);
    }
    expect([u.inner.value, u.outer.value, u.glow.value, u.time.value]).toEqual(still);
    expect(u.glow.value).toBe(MAGIC_STILL);
    const motes = drawables(fx.group).find((p) => p instanceof Sprite)!;
    expect(motes.visible).toBe(false);
    fx.setReducedMotion(false);
    fx.update(1 / 60);
    expect(motes.visible).toBe(true);
    expect(u.time.value).toBeGreaterThan(still[3]!);
  });

  it('dispose：網格（Sprite 共用的除外）、材質都釋放，並從場景拿掉', () => {
    const fx = createMagicFx();
    const parent = new Group();
    parent.add(fx.group);
    const freed = new Set<unknown>();
    const watch = (o: { addEventListener(t: 'dispose', f: () => void): void }) => o.addEventListener('dispose', () => freed.add(o));
    const parts = drawables(fx.group);
    for (const p of parts) {
      if (p instanceof Mesh) watch(p.geometry);
      watch(p.material as Material);
    }
    fx.dispose();
    for (const p of parts) {
      if (p instanceof Mesh) expect(freed.has(p.geometry)).toBe(true);
      expect(freed.has(p.material)).toBe(true);
    }
    expect(fx.group.parent).toBeNull();
  });
});
