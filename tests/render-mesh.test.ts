// card-mesh 的「什麼時候重建」：拖曳時每格都會呼叫 update，只改數值不能換網格／材質。
// 只建 three.js 物件、不畫（不需要 WebGPU）；圖片用只有寬高的假物件。
import { FrontSide, LinearMipmapLinearFilter, SRGBColorSpace, type DataTexture, type MeshBasicNodeMaterial, type Mesh, type Node, type Texture } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLO_PALETTES, type Card, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: false, hasAlpha: depth > 0 };
}

function card(): Card {
  return {
    formatVersion: 1,
    id: 'c',
    name: '測試',
    createdAt: '',
    updatedAt: '',
    aspect: 'standard',
    bodyColor: '#1b2033',
    cornerRadius: 0.05,
    front: { layers: [layer('base', 'aaaaaaaaaaaaaaaa', 0), layer('hero', 'bbbbbbbbbbbbbbbb', 50)] },
    back: { layers: [] },
    frame: { enabled: false, width: 0.03, color: '#d8dbe2', shine: 50 },
    holo: { strength: 40, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
  };
}

/** 卡面材質 colorNode 底下所有的節點（每個只走一次）。 */
function graphNodes(mesh: Mesh): Node[] {
  const root = (mesh.material as MeshBasicNodeMaterial).colorNode;
  const seen = new Set<Node>();
  const stack: Node[] = root ? [root] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const child of node.getChildren()) stack.push(child);
  }
  return [...seen];
}

/** shader 裡用到的數字 uniform（拖滑桿時只改這些數值）。 */
function floatUniforms(mesh: Mesh): Array<{ value: number }> {
  return graphNodes(mesh).filter(
    (n): n is Node & { value: number } => (n as { isUniformNode?: boolean }).isUniformNode === true && typeof (n as { value?: unknown }).value === 'number',
  );
}

/** shader 裡取樣的貼圖。 */
function textures(mesh: Mesh): Texture[] {
  const out = new Set<Texture>();
  for (const n of graphNodes(mesh)) {
    const value = (n as { isTextureNode?: boolean; value?: Texture }).isTextureNode ? (n as { value?: Texture }).value : undefined;
    if (value) out.add(value);
  }
  return [...out];
}

function parts(obj: ReturnType<typeof createCardObject>) {
  const [body, front, back] = obj.group.children as Mesh[];
  return { body: body!, front: front!, back: back! };
}

describe('setCard：只改數值不重建', () => {
  it('改圖層 x／y／scale／visible、卡身色、卡框 → 網格與材質都不換', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const before = parts(obj);
    const mats = [before.front.material, before.back.material];
    const geos = [before.body.geometry, before.front.geometry];
    const offsets = obj.offsets('front');

    const hero = { ...c.front.layers[1]!, x: 0.3, y: -0.2, scale: 0.5, visible: false };
    obj.update(
      {
        ...c,
        bodyColor: '#ff0000',
        frame: { enabled: true, width: 0.06, color: '#00ff00', shine: 90 },
        front: { layers: [c.front.layers[0]!, hero] },
      },
      getImage,
    );
    const after = parts(obj);
    expect([after.front.material, after.back.material]).toEqual(mats);
    expect(after.front.material).toBe(mats[0]);
    expect(after.back.material).toBe(mats[1]);
    expect(after.body.geometry).toBe(geos[0]);
    expect(after.front.geometry).toBe(geos[1]);
    expect(obj.offsets('front')).toEqual(offsets);
    expect(obj.offsets('front')[1]).toBe(offsets[1]);
  });

  it('圖層組成改了 → 只換那一面的材質；位移 uniform 數量跟著圖層數', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const before = parts(obj);
    const frontMat = before.front.material;
    const backMat = before.back.material;

    obj.update({ ...c, back: { layers: [layer('back', 'aaaaaaaaaaaaaaaa', 0)] } }, getImage);
    expect(parts(obj).front.material).toBe(frontMat);
    expect(parts(obj).back.material).not.toBe(backMat);
    expect(obj.offsets('back')).toHaveLength(1);

    obj.update({ ...c, front: { layers: [c.front.layers[0]!] }, back: { layers: [layer('back', 'aaaaaaaaaaaaaaaa', 0)] } }, getImage);
    expect(parts(obj).front.material).not.toBe(frontMat);
    expect(obj.offsets('front')).toHaveLength(1);
  });

  it('改立體層的 depth（順序不變）→ 影子只改 uniform，不換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const mat = parts(obj).front.material;
    for (const depth of [1, 30, 90, 100]) {
      obj.update({ ...c, front: { layers: [c.front.layers[0]!, { ...c.front.layers[1]!, depth }] } }, getImage);
      expect(parts(obj).front.material).toBe(mat);
    }
  });

  it('比例或圓角改了 → 換網格（正反面共用同一個），輪廓跟著變', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const geo = parts(obj).front.geometry;
    obj.update({ ...c, aspect: 'tarot' }, getImage);
    expect(parts(obj).front.geometry).not.toBe(geo);
    expect(parts(obj).back.geometry).toBe(parts(obj).front.geometry);
    expect(obj.outline().halfH).toBeCloseTo(120 / 70 / 2, 12);
    const geo2 = parts(obj).front.geometry;
    obj.update({ ...c, aspect: 'tarot', cornerRadius: 0.12 }, getImage);
    expect(parts(obj).front.geometry).not.toBe(geo2);
    expect(obj.outline().r).toBe(0.12);
  });

  it('拖鐳射滑桿（強度、色帶寬度、閃星）、轉卡、時間走 → 只改 uniform，不換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    obj.update({ ...c, holo: { ...c.holo, strength: 0, bandWidth: 2, sparkle: 100 } }, getImage);
    obj.update({ ...c, holo: { ...c.holo, strength: 100, bandWidth: 0.1, sparkle: 0 } }, getImage);
    obj.setView(35, -20);
    obj.setTime(12.5);
    expect([parts(obj).front.material, parts(obj).back.material]).toEqual(mats);
    expect(parts(obj).front.material).toBe(mats[0]);
  });

  it('換鐳射色彩、自訂顏色、陰影濃淡距離、卡框光澤（T-310）→ 只改 uniform，不換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = { ...card(), frame: { ...card().frame, enabled: true } };
    obj.update(c, getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    for (const palette of ['classic', 'silver', 'gold', 'aurora', 'galaxy', 'custom', 'warm'] as const) {
      obj.update({ ...c, holo: { ...c.holo, palette } }, getImage);
    }
    obj.update({ ...c, holo: { ...c.holo, palette: 'custom', colors: ['#112233', '#445566', '#778899', '#aabbcc'] } }, getImage);
    obj.update({ ...c, shadow: { strength: 0, distance: 100 } }, getImage);
    obj.update({ ...c, shadow: { strength: 100, distance: 0 } }, getImage);
    obj.update({ ...c, frame: { ...c.frame, shine: 0 } }, getImage);
    obj.update({ ...c, frame: { ...c.frame, shine: 100 } }, getImage);
    expect(parts(obj).front.material).toBe(mats[0]);
    expect(parts(obj).back.material).toBe(mats[1]);
  });

  it('反光層的形狀改了 → 換那一面的材質；圖層的反光開關只在「用圖層形狀」時才需要換（T-417）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const allMat = parts(obj).front.material;
    const backMat = parts(obj).back.material;

    // 整面：每層都套，切換某層的開關畫面不變 → 不換
    const heroToggled = { ...c.front.layers[1]!, holo: !c.front.layers[1]!.holo };
    obj.update({ ...c, front: { layers: [c.front.layers[0]!, heroToggled] } }, getImage);
    expect(parts(obj).front.material).toBe(allMat);

    // 改成用圖層形狀 → 換（只換正面）
    const layersCard: Card = { ...c, front: { ...c.front, foil: { shape: 'layers', frame: false } } };
    obj.update(layersCard, getImage);
    const layersMat = parts(obj).front.material;
    expect(layersMat).not.toBe(allMat);
    expect(parts(obj).back.material).toBe(backMat);

    // 用圖層形狀時切某層的開關 → 換
    obj.update({ ...layersCard, front: { ...layersCard.front, layers: [c.front.layers[0]!, heroToggled] } }, getImage);
    expect(parts(obj).front.material).not.toBe(layersMat);

    // 關（整面霧光）、卡框也反光開關 → 換
    const noneMat = (() => {
      obj.update({ ...c, front: { ...c.front, foil: { shape: 'none', frame: true } } }, getImage);
      return parts(obj).front.material;
    })();
    obj.update({ ...c, front: { ...c.front, foil: { shape: 'none', frame: false } } }, getImage);
    expect(parts(obj).front.material).not.toBe(noneMat);
  });

  it('拖霧光滑桿、斜線閃一下 → 只改 uniform，不換材質（T-417）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c: Card = { ...card(), front: { ...card().front, foil: { shape: 'layers', frame: true } } };
    obj.update(c, getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    const before = floatUniforms(parts(obj).front).map((u) => u.value);
    obj.update({ ...c, holo: { ...c.holo, matte: 90 } }, getImage);
    obj.setFlash('front', 0.6);
    expect([parts(obj).front.material, parts(obj).back.material]).toEqual(mats);
    expect(parts(obj).front.material).toBe(mats[0]);
    const after = floatUniforms(parts(obj).front).map((u) => u.value);
    expect(after.filter((v, i) => v !== before[i]).sort()).toEqual([0.6, 0.9].sort());
    // 強度 0：霧光也是 0
    const matte = floatUniforms(parts(obj).front).find((u, i) => u.value === 0.9 && before[i] !== 0.9)!;
    obj.update({ ...c, holo: { ...c.holo, matte: 90, strength: 0 } }, getImage);
    expect(matte.value).toBe(0);
  });

  it('上傳黑白圖：圖準備好了才多一張貼圖（之前先當整面畫）；換比例只改 uniform；換掉後貼圖收掉（T-417）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c: Card = { ...card(), front: { ...card().front, foil: { shape: 'mask', mask: 'dddddddddddddddd', frame: true } } };
    const fullMat = (() => {
      obj.update(card(), getImage);
      return parts(obj).front.material;
    })();
    obj.update(c, getImage);
    // 圖還沒準備好：先當整面畫（和整面的材質一樣，不用換）
    const waitingMat = parts(obj).front.material;
    expect(waitingMat === fullMat).toBe(true);
    const waitingTextures = textures(parts(obj).front);
    expect(waitingTextures.every((t) => (t as DataTexture).isDataTexture)).toBe(true);
    images.set('dddddddddddddddd', fakeImage(200, 200));
    obj.update(c, getImage);
    const ready = parts(obj).front;
    expect(ready.material).not.toBe(waitingMat);
    const maskTex = textures(ready).filter((t) => !(t as DataTexture).isDataTexture);
    expect(textures(ready).length).toBe(waitingTextures.length + 1);
    expect(maskTex.length).toBe(1);
    const mat = ready.material;
    obj.update({ ...c, aspect: 'tarot' }, getImage);
    expect(parts(obj).front.material).toBe(mat);
    // 換回整面：黑白圖的貼圖收掉
    const dispose = vi.spyOn(maskTex[0]!, 'dispose');
    obj.update(card(), getImage);
    expect(dispose).toHaveBeenCalled();
    images.delete('dddddddddddddddd');
  });

  it('圖還沒準備好（getImage 回 undefined）的層先不畫；圖到了再呼叫就換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = { ...card(), front: { layers: [layer('late', 'cccccccccccccccc', 50)] } };
    obj.update(c, getImage);
    const mat = parts(obj).front.material;
    expect(obj.offsets('front')).toHaveLength(1);
    images.set('cccccccccccccccc', fakeImage(100, 100));
    obj.update(c, getImage);
    expect(parts(obj).front.material).not.toBe(mat);
  });
});

describe('不透明度與混合模式（T-408）', () => {
  const withHero = (c: Card, over: Partial<Layer>): Card => ({ ...c, front: { ...c.front, layers: [c.front.layers[0]!, { ...c.front.layers[1]!, ...over }] } });

  it('拖不透明度 → 只改 uniform，不換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const mat = parts(obj).front.material;
    for (const opacity of [0, 37, 99, 100]) {
      obj.update(withHero(c, { opacity }), getImage);
      expect(parts(obj).front.material).toBe(mat);
    }
  });

  it('同一個材質連續設 100 → 0 → 37 → 100：shader 裡的不透明度數值真的跟著變（T-413）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(withHero(c, { opacity: 100 }), getImage);
    const mat = parts(obj).front.material;
    const uniforms = floatUniforms(parts(obj).front);
    const before = uniforms.map((u) => u.value);

    obj.update(withHero(c, { opacity: 0 }), getImage);
    expect(parts(obj).front.material).toBe(mat);
    // 只有一個數字 uniform 變了：不透明度 1 → 0
    const changed = uniforms.filter((u, i) => u.value !== before[i]);
    expect(changed).toHaveLength(1);
    const opacity = changed[0]!;
    expect(before[uniforms.indexOf(opacity)]).toBe(1);
    expect(opacity.value).toBe(0);

    obj.update(withHero(c, { opacity: 37 }), getImage);
    expect(parts(obj).front.material).toBe(mat);
    expect(opacity.value).toBeCloseTo(0.37, 12);

    obj.update(withHero(c, { opacity: 100 }), getImage);
    expect(parts(obj).front.material).toBe(mat);
    expect(opacity.value).toBe(1);
    expect(uniforms.map((u) => u.value)).toEqual(before);
  });

  it('換混合模式 → 換那一面的材質（另一面不換）；模式沒變不換', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const frontMat = parts(obj).front.material;
    const backMat = parts(obj).back.material;
    obj.update(withHero(c, { blend: 'screen' }), getImage);
    const screenMat = parts(obj).front.material;
    expect(screenMat).not.toBe(frontMat);
    expect(parts(obj).back.material).toBe(backMat);
    obj.update(withHero(c, { blend: 'screen', opacity: 40, x: 0.2 }), getImage);
    expect(parts(obj).front.material).toBe(screenMat);
    obj.update(withHero(c, { blend: 'multiply' }), getImage);
    expect(parts(obj).front.material).not.toBe(screenMat);
  });

  it.each(['normal', 'multiply', 'screen', 'add', 'overlay', 'soft-light', 'color'] as const)(
    '%s：有鐳射、沒鐳射、沒有透明的圖都建得出材質',
    (blend) => {
      const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
      const c = card();
      const opaqueOk = blend === 'multiply' || blend === 'screen' || blend === 'add';
      for (const foil of [undefined, { shape: 'none', frame: true } as const, { shape: 'layers', frame: false } as const]) {
        const next = withHero(c, { blend, opacity: 60, hasAlpha: !opaqueOk });
        expect(() => obj.update({ ...next, front: foil ? { ...next.front, foil } : next.front }, getImage)).not.toThrow();
        expect(parts(obj).front.material).toBeTruthy();
      }
    },
  );
});

describe('圖層貼圖：預乘 alpha（T-413）', () => {
  it('sRGB 格式、自動 mipmap（線性空間濾波）；大小＝原圖；在沒有 GPU 的地方不讀像素', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(card(), getImage); // 假圖片沒有像素：要是建材質時就讀像素會丟錯
    const layerTextures = textures(parts(obj).front).filter((t) => (t as DataTexture).isDataTexture);
    expect(layerTextures).toHaveLength(2);
    for (const t of layerTextures) {
      expect(t.colorSpace).toBe(SRGBColorSpace);
      expect(t.generateMipmaps).toBe(true);
      expect(t.minFilter).toBe(LinearMipmapLinearFilter);
      expect(t.premultiplyAlpha).toBe(false); // 預乘是自己在線性空間做的，不能再讓瀏覽器在 sRGB 數值上乘一次
    }
    const sizes = layerTextures.map((t) => {
      const image = t.image as { width: number; height: number };
      return [image.width, image.height];
    });
    expect(sizes).toEqual(expect.arrayContaining([[1008, 1408], [500, 1000]]));
  });
});

describe('破框層（T-411）：卡外網格', () => {
  const withHero = (c: Card, over: Partial<Layer>): Card => ({ ...c, front: { ...c.front, layers: [c.front.layers[0]!, { ...c.front.layers[1]!, ...over }] } });
  const ringOf = (mesh: Mesh) => mesh.children[0] as Mesh;

  it('沒有破框層：卡外網格不顯示、卡面網格照舊；兩面都有一片卡外網格（卡面網格的子物件）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(card(), getImage);
    const { front, back } = parts(obj);
    expect(front.children).toHaveLength(1);
    expect(back.children).toHaveLength(1);
    expect(ringOf(front).visible).toBe(false);
    expect(ringOf(back).visible).toBe(false);
    expect(obj.reach()).toBeNull();
    expect(obj.breakoutBoxes('front')).toEqual([]);
  });

  it('打開破框 → 換那一面的材質、卡外網格出現（半透明、不寫也不測深度、只畫正面）；關掉 → 又不顯示', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update(c, getImage);
    const mat = parts(obj).front.material;
    const backMat = parts(obj).back.material;
    obj.update(withHero(c, { breakout: true, scale: 1.5 }), getImage);
    const front = parts(obj).front;
    expect(front.material).not.toBe(mat);
    expect(parts(obj).back.material).toBe(backMat);
    const ring = ringOf(front);
    expect(ring.visible).toBe(true);
    const ringMat = ring.material as MeshBasicNodeMaterial;
    expect(ringMat.transparent).toBe(true);
    expect(ringMat.depthWrite).toBe(false);
    expect(ringMat.depthTest).toBe(false);
    expect(ringMat.side).toBe(FrontSide);
    // 和卡面同一張貼圖（取樣一樣，卡內卡外接得上）
    expect(textures(ring).some((t) => textures(front).includes(t))).toBe(true);
    expect(ringOf(parts(obj).back).visible).toBe(false);

    obj.update(withHero(c, { breakout: false, scale: 1.5 }), getImage);
    expect(ringOf(parts(obj).front).visible).toBe(false);
  });

  it('破框層的鐳射遮罩是 0：用圖層形狀時切它的反光開關不換材質（shader 裡沒有它的鐳射）；關掉破框後照舊會換', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c: Card = { ...card(), front: { ...card().front, foil: { shape: 'layers', frame: true } } };
    obj.update(withHero(c, { breakout: true, holo: true }), getImage);
    const mat = parts(obj).front.material;
    obj.update(withHero(c, { breakout: true, holo: false }), getImage);
    expect(parts(obj).front.material).toBe(mat);
    obj.update(withHero(c, { breakout: false, holo: false }), getImage);
    const plain = parts(obj).front.material;
    obj.update(withHero(c, { breakout: false, holo: true }), getImage);
    expect(parts(obj).front.material).not.toBe(plain);
  });

  it('底圖就算帶了 breakout 也不當破框層', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    obj.update({ ...c, front: { layers: [{ ...c.front.layers[0]!, breakout: true }, c.front.layers[1]!] } }, getImage);
    expect(ringOf(parts(obj).front).visible).toBe(false);
  });

  it('卡外網格中間挖掉的洞＝卡面的輪廓（同一批頂點），外框包住圖層加最大位移', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(withHero(card(), { breakout: true, scale: 1.5, depth: 80 }), getImage);
    const front = parts(obj).front;
    const ringPos = ringOf(front).geometry.getAttribute('position');
    const facePos = front.geometry.getAttribute('position');
    const key = (x: number, y: number) => `${x.toFixed(9)},${y.toFixed(9)}`;
    const ringPoints = new Set<string>();
    let maxY = -Infinity;
    for (let i = 0; i < ringPos.count; i++) {
      ringPoints.add(key(ringPos.getX(i), ringPos.getY(i)));
      maxY = Math.max(maxY, ringPos.getY(i));
    }
    for (let i = 0; i < facePos.count; i++) expect(ringPoints.has(key(facePos.getX(i), facePos.getY(i)))).toBe(true);
    // 圖 500×1000、scale 1.5 → 高 3，上緣 1.5；最大位移 0.24
    expect(maxY).toBeGreaterThanOrEqual(1.5 + 0.24);
  });

  it('拖曳圖層：小幅移動不換卡外網格，移出外框才換；不換卡面材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = withHero(card(), { breakout: true, scale: 1.5, depth: 80 });
    obj.update(c, getImage);
    const mat = parts(obj).front.material;
    const geo = ringOf(parts(obj).front).geometry;
    obj.update(withHero(card(), { breakout: true, scale: 1.5, depth: 80, x: 0.01 }), getImage);
    expect(ringOf(parts(obj).front).geometry).toBe(geo);
    obj.update(withHero(card(), { breakout: true, scale: 1.5, depth: 80, x: 0.6 }), getImage);
    expect(ringOf(parts(obj).front).geometry).not.toBe(geo);
    expect(parts(obj).front.material).toBe(mat);
  });

  it('方框、取景、點選（沒有 DOM 讀不到 alpha：整張圖都算）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    obj.update(withHero(card(), { breakout: true, scale: 1.5, depth: 80, x: 0.1 }), getImage);
    const [box] = obj.breakoutBoxes('front');
    expect(box!.face).toBe('front');
    expect(box!.box.left).toBeCloseTo(0.1 - 0.75, 9);
    expect(box!.box.top).toBeCloseTo(1.5, 9);
    // 指定位移
    const [moved] = obj.breakoutBoxes('front', [{ x: 0, y: 0 }, { x: 0.2, y: -0.1 }]);
    expect(moved!.box.left).toBeCloseTo(0.1 - 0.75 + 0.2, 9);
    expect(moved!.box.top).toBeCloseTo(1.4, 9);
    const reach = obj.reach()!;
    expect(reach.y).toBeCloseTo(1.5 + 0.12, 9);
    expect(reach.x).toBeCloseTo(0.85 + 0.12, 9);
    expect(obj.breakoutAt('front', 0.5, 1.2)).toBe('hero');
    expect(obj.breakoutAt('front', 2, 0)).toBeNull();
    expect(obj.breakoutAt('back', 0.5, 1.2)).toBeNull();
    // 隱藏的層：沒有方框、點不到、不算取景
    obj.update(withHero(card(), { breakout: true, scale: 1.5, depth: 80, x: 0.1, visible: false }), getImage);
    expect(obj.breakoutBoxes('front')).toEqual([]);
    expect(obj.breakoutAt('front', 0.5, 1.2)).toBeNull();
    expect(obj.reach()).toBeNull();
  });
});

describe('破框層（T-411c）：卡外的點選與影子', () => {
  /** 假的 2D 畫布：drawImage 記住畫的是哪張圖，getImageData 回那張圖指定的單一顏色（每個像素都一樣）。 */
  const fills = new Map<HTMLImageElement, readonly [number, number, number, number]>();
  function stubCanvas() {
    vi.stubGlobal('document', {
      createElement: () => {
        let drawn: HTMLImageElement | null = null;
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage: (img: HTMLImageElement) => (drawn = img),
              getImageData: (_x: number, _y: number, w: number, h: number) => {
                const px = (drawn && fills.get(drawn)) ?? [0, 0, 0, 0];
                const data = new Uint8ClampedArray(w * h * 4);
                for (let i = 0; i < data.length; i += 4) data.set(px, i);
                return { data };
              },
            };
          },
        };
      },
    });
  }
  afterEach(() => vi.unstubAllGlobals());

  /** 正面：底圖＋後面 back（正常、不透明）＋前面 top（指定模式與顏色），兩層都破框、都很大。 */
  function setup(topBlend: Layer['blend'], topColor: readonly [number, number, number, number], topOver: Partial<Layer> = {}) {
    stubCanvas();
    const backImg = fakeImage(64, 64);
    const topImg = fakeImage(64, 64);
    fills.set(backImg, [200, 40, 40, 255]);
    fills.set(topImg, topColor);
    const local = new Map([...images, ['dddddddddddddddd', backImg], ['eeeeeeeeeeeeeeee', topImg]]);
    const obj = createCardObject(fakeImage(1008, 1408), 1, fakeImage(512, 512));
    const c = card();
    const back = { ...layer('back', 'dddddddddddddddd', 60), scale: 2.5, breakout: true };
    const top = { ...layer('top', 'eeeeeeeeeeeeeeee', 90), scale: 2.5, breakout: true, hasAlpha: topBlend === 'normal', blend: topBlend, ...topOver };
    obj.update({ ...c, front: { layers: [c.front.layers[0]!, back, top] } }, (h) => local.get(h));
    obj.setView(0, 0);
    return obj;
  }
  // 卡片外面（卡片右上角再往外）
  const OUT = { x: 0.8, y: 0.9 };

  it('前面是不透明黑底的發光層：卡外畫不出來 → 點到的是後面看得到的那層', () => {
    for (const blend of ['screen', 'add'] as const) {
      const obj = setup(blend, [0, 0, 0, 255]);
      expect(obj.breakoutAt('front', OUT.x, OUT.y)).toBe('back');
    }
  });

  it('前面是不透明白底的加深層：一樣點到後面', () => {
    const obj = setup('multiply', [255, 255, 255, 255]);
    expect(obj.breakoutAt('front', OUT.x, OUT.y)).toBe('back');
  });

  it('看得到的才點得到：正常的不透明層＝前面那層；不透明度太低、側面淡出時不算', () => {
    expect(setup('normal', [20, 200, 80, 255]).breakoutAt('front', OUT.x, OUT.y)).toBe('top');
    expect(setup('normal', [20, 200, 80, 255], { opacity: 10 }).breakoutAt('front', OUT.x, OUT.y)).toBe('back');
    const side = setup('normal', [20, 200, 80, 255]);
    side.setView(88, 0);
    expect(side.breakoutAt('front', OUT.x, OUT.y)).toBeNull();
  });

  it('卡外的破框層之間也有景深陰影：前面的正常層在卡外網格裡投影到後面的破框層（模糊取樣）', () => {
    const obj = setup('normal', [20, 200, 80, 255]);
    const ring = parts(obj).front.children[0] as Mesh;
    const shadowTaps = graphNodes(ring).filter(
      (n) => (n as { isTextureNode?: boolean }).isTextureNode === true && (n as { levelNode?: unknown }).levelNode != null,
    );
    expect(shadowTaps.length).toBeGreaterThan(0);
  });
});
