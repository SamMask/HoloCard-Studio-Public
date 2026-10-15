// 舞台物件（T-314、T-316）：畫在卡片之前、不寫深度（卡片永遠蓋在上面）、不跟著卡片轉、切換只改 visible、每格不換物件。
// 只建 three.js 物件、不畫（不需要 WebGPU）；展示台圖用只有寬高的假物件。
import { CustomBlending, Group, Mesh, OneFactor, Sprite, type Material, type Object3D } from 'three/webgpu';
import { ASPECT_HEIGHT } from '../src/model/types';
import { describe, expect, it } from 'vitest';
import { createCardObject } from '../src/render/card-mesh';
import { createStageFx } from '../src/render/stage-fx';
import { DUST_COUNT, RING_BOB, RING_HOVER, stageY } from '../src/render/stage-motion';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

function setup() {
  const stage = createStageFx(fakeImage(1600, 480), 8);
  stage.setStyle('halo');
  return stage;
}

/** 舞台裡會畫出來的東西（每個一個 draw call）。 */
function drawables(root: Object3D): (Mesh | Sprite)[] {
  const out: (Mesh | Sprite)[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Sprite) out.push(o);
  });
  return out;
}

const materialOf = (o: Mesh | Sprite) => o.material as Material;

describe('舞台不擋卡片', () => {
  it('整組排在卡片之前畫（renderOrder 比卡片小），卡片之後蓋上去', () => {
    const stage = setup();
    const card = createCardObject(fakeImage(4, 4), 1, fakeImage(512, 512));
    expect(stage.group).toBeInstanceOf(Group);
    expect(stage.group.renderOrder).toBeLessThan(card.group.renderOrder);
  });

  it('每個東西都不寫深度、不做深度測試、用相加混色，而且留在「不透明」那一批（才會照 renderOrder 排在卡片前面）', () => {
    const stage = setup();
    const parts = drawables(stage.group);
    expect(parts.length).toBe(3); // 地上（底光＋漣漪）、懸浮光環、星塵：每格多 3 個 draw call
    for (const p of parts) {
      const m = materialOf(p);
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
      expect(m.blending).toBe(CustomBlending);
      expect([m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha]).toEqual([OneFactor, OneFactor, OneFactor, OneFactor]);
    }
  });

  it('舞台是獨立的一組：不在卡片的 group 裡，卡片轉動時不跟著轉', () => {
    const stage = setup();
    const card = createCardObject(fakeImage(4, 4), 1, fakeImage(512, 512));
    expect(stage.group.parent).toBeNull();
    let inside = false;
    card.group.traverse((o) => (inside ||= o === stage.group));
    expect(inside).toBe(false);
    stage.setPose(35, 20);
    stage.update(1 / 60);
    expect(stage.group.rotation.x).toBe(0);
    expect(stage.group.rotation.y).toBe(0);
  });
});

describe('設定：只切 visible、改位置', () => {
  it('還沒設定前不畫；halo 畫、none 整個不畫', () => {
    const stage = createStageFx(fakeImage(1600, 480), 8);
    expect(stage.group.visible).toBe(false);
    stage.setStyle('halo');
    expect(stage.group.visible).toBe(true);
    stage.setStyle('none');
    expect(stage.group.visible).toBe(false);
    stage.update(1 / 60);
    expect(stage.group.visible).toBe(false);
  });

  it('舞台高度跟著卡片比例（卡片下緣再往下）', () => {
    const stage = setup();
    stage.setCardHeight(ASPECT_HEIGHT.tarot);
    expect(stage.group.position.y).toBeCloseTo(stageY(ASPECT_HEIGHT.tarot), 12);
    stage.setCardHeight(ASPECT_HEIGHT.standard);
    expect(stage.group.position.y).toBeCloseTo(stageY(ASPECT_HEIGHT.standard), 12);
  });

  it('減少動態效果：星塵不顯示，底光與光環還在；關掉後星塵回來', () => {
    const stage = setup();
    const [floor, rings, dust] = drawables(stage.group);
    stage.setReducedMotion(true);
    stage.update(1 / 60);
    expect(dust!.visible).toBe(false);
    expect(floor!.visible).toBe(true);
    expect(rings!.visible).toBe(true);
    stage.setReducedMotion(false);
    stage.update(1 / 60);
    expect(dust!.visible).toBe(true);
  });

  it('懸浮光環上下浮動（只改位置）；減少動態效果時停在原本的高度', () => {
    const stage = setup();
    const [, rings] = drawables(stage.group);
    const heights = new Set<number>();
    for (let i = 0; i < 120; i++) {
      stage.update(1 / 60);
      heights.add(rings!.position.y);
      expect(Math.abs(rings!.position.y - RING_HOVER)).toBeLessThanOrEqual(RING_BOB + 1e-9);
    }
    expect(heights.size).toBeGreaterThan(100);
    stage.setReducedMotion(true);
    stage.update(1 / 60);
    expect(rings!.position.y).toBe(RING_HOVER);
  });

  it('星塵：一個 Sprite 畫 DUST_COUNT 顆（一次 draw call），不做視錐剔除（位置在著色程式裡算）', () => {
    const stage = setup();
    const sprites = drawables(stage.group).filter((o): o is Sprite => o instanceof Sprite);
    expect(sprites.length).toBe(1);
    expect(sprites[0]!.count).toBe(DUST_COUNT);
    expect(sprites[0]!.frustumCulled).toBe(false);
  });
});

describe('每影格', () => {
  it('換卡、改設定、跑很多格都不換網格、材質、物件', () => {
    const stage = setup();
    const before = drawables(stage.group).map((p) => [p, p.geometry, p.material]);
    for (let i = 0; i < 200; i++) {
      stage.setPose(i * 5, Math.sin(i) * 30);
      stage.update(1 / 60);
      if (i === 50) stage.setCardHeight(ASPECT_HEIGHT.tarot);
      if (i === 100) stage.setStyle('none');
      if (i === 120) stage.setStyle('halo');
      if (i === 150) stage.setReducedMotion(true);
    }
    expect(drawables(stage.group).map((p) => [p, p.geometry, p.material])).toEqual(before);
  });
});
