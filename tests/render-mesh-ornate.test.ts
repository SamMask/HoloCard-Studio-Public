// card-mesh 的雕花邊角（T-416）：換樣式＝換兩面的材質（多取樣一張花紋貼圖）；開關卡框、粗細、顏色、光澤只改 uniform；
// 換回簡約＝和沒選過時同一種材質、花紋貼圖收掉；花紋大小跟著框寬（uniform）。只建 three.js 物件、不畫。
import { LinearMipmapLinearFilter, SRGBColorSpace, type DataTexture, type Mesh, type MeshBasicNodeMaterial, type Node, type Texture } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { ASPECT_HEIGHT, type Card, type Frame, HOLO_PALETTES, type Layer } from '../src/model/types';
import { createCardObject } from '../src/render/card-mesh';
import { cardOutline } from '../src/render/fit';
import { ornateSize } from '../src/render/frame';

const fakeImage = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;
/** 花紋素材（512×512，和 public/textures/frame-corner.webp 一樣大）。 */
const corner = fakeImage(512, 512);

const images = new Map<string, HTMLImageElement>([
  ['aaaaaaaaaaaaaaaa', fakeImage(1008, 1408)],
  ['bbbbbbbbbbbbbbbb', fakeImage(500, 1000)],
]);
const getImage = (hash: string) => images.get(hash);

function layer(id: string, image: string, depth: number): Layer {
  return { id, name: id, role: depth === 0 ? 'base' : 'depth', image, visible: true, depth, x: 0, y: 0, scale: 1, holo: false, hasAlpha: depth > 0 };
}

function card(frame: Partial<Frame> = {}): Card {
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
    frame: { enabled: true, width: 0.03, color: '#d4af37', shine: 50, ...frame },
    holo: { strength: 40, bandWidth: 1, sparkle: 30, palette: 'warm', colors: [...HOLO_PALETTES.warm] },
    shadow: { strength: 50, distance: 50 },
    view: { returnToFront: true, showcase: false, stage: 'halo' },
  };
}

function parts(obj: ReturnType<typeof createCardObject>) {
  const [, front, back] = obj.group.children as Mesh[];
  return { front: front!, back: back! };
}

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

function textures(mesh: Mesh): Texture[] {
  const out = new Set<Texture>();
  for (const n of graphNodes(mesh)) {
    const value = (n as { isTextureNode?: boolean; value?: Texture }).isTextureNode ? (n as { value?: Texture }).value : undefined;
    if (value) out.add(value);
  }
  return [...out];
}

/** 取樣花紋素材的貼圖（512×512 的預乘貼圖）。 */
const cornerTextures = (mesh: Mesh) =>
  textures(mesh).filter((t) => {
    const image = t.image as { width?: number; height?: number };
    return image.width === 512 && image.height === 512;
  });

function floatUniforms(mesh: Mesh): Array<{ value: number }> {
  return graphNodes(mesh).filter(
    (n): n is Node & { value: number } => (n as { isUniformNode?: boolean }).isUniformNode === true && typeof (n as { value?: unknown }).value === 'number',
  );
}

describe('雕花邊角（T-416）：什麼時候換材質', () => {
  it('簡約（省略或明寫 simple）：兩面都不取樣花紋貼圖；明寫 simple 和省略是同一個材質（不重建）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, corner);
    obj.update(card(), getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    expect(cornerTextures(parts(obj).front)).toHaveLength(0);
    expect(cornerTextures(parts(obj).back)).toHaveLength(0);
    obj.update(card({ style: 'simple' }), getImage);
    expect(parts(obj).front.material).toBe(mats[0]);
    expect(parts(obj).back.material).toBe(mats[1]);
  });

  it('換成雕花邊角：正反兩面都換材質，都取樣同一張花紋貼圖（sRGB、預乘、自動 mipmap、大小＝素材）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, corner);
    obj.update(card(), getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    obj.update(card({ style: 'ornate' }), getImage);
    const { front, back } = parts(obj);
    expect(front.material).not.toBe(mats[0]);
    expect(back.material).not.toBe(mats[1]);
    const [tex] = cornerTextures(front);
    expect(tex).toBeDefined();
    expect(cornerTextures(back)).toEqual([tex]);
    expect((tex as DataTexture).isDataTexture).toBe(true);
    expect(tex!.colorSpace).toBe(SRGBColorSpace);
    expect(tex!.generateMipmaps).toBe(true);
    expect(tex!.minFilter).toBe(LinearMipmapLinearFilter);
    // 只多一張貼圖
    expect(textures(front).length).toBe(3);
  });

  it('雕花邊角時開關卡框、拖粗細／顏色／光澤、轉卡 → 只改 uniform，不換材質', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, corner);
    obj.update(card({ style: 'ornate' }), getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    obj.update(card({ style: 'ornate', enabled: false }), getImage);
    obj.update(card({ style: 'ornate', width: 0.08, color: '#d8dbe2', shine: 100 }), getImage);
    obj.update(card({ style: 'ornate', width: 0.01, shine: 0 }), getImage);
    obj.setView(30, -10);
    expect(parts(obj).front.material).toBe(mats[0]);
    expect(parts(obj).back.material).toBe(mats[1]);
  });

  it('花紋大小跟著框寬（frame.ts 的 ornateSize），只改 uniform', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, corner);
    obj.update(card({ style: 'ornate' }), getImage);
    const outline = cardOutline(ASPECT_HEIGHT.standard, 0.05);
    const size = floatUniforms(parts(obj).front).filter((u) => Math.abs(u.value - ornateSize(0.03, outline)) < 1e-12);
    expect(size.length).toBeGreaterThan(0);
    obj.update(card({ style: 'ornate', width: 0.08 }), getImage);
    for (const u of size) expect(u.value).toBeCloseTo(ornateSize(0.08, outline), 12);
  });

  it('換回簡約：材質的節點數和沒選過時一樣（畫面不變）、花紋貼圖收掉；再換成雕花時重新建', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, corner);
    obj.update(card(), getImage);
    const simpleNodes = [graphNodes(parts(obj).front).length, graphNodes(parts(obj).back).length];
    obj.update(card({ style: 'ornate' }), getImage);
    const ornateNodes = graphNodes(parts(obj).front).length;
    expect(ornateNodes).toBeGreaterThan(simpleNodes[0]!);
    const [tex] = cornerTextures(parts(obj).front);
    const dispose = vi.spyOn(tex!, 'dispose');
    obj.update(card(), getImage);
    expect(dispose).toHaveBeenCalled();
    expect([graphNodes(parts(obj).front).length, graphNodes(parts(obj).back).length]).toEqual(simpleNodes);
    expect(cornerTextures(parts(obj).front)).toHaveLength(0);
    obj.update(card({ style: 'ornate' }), getImage);
    const [again] = cornerTextures(parts(obj).front);
    expect(again).toBeDefined();
    expect(again).not.toBe(tex);
  });

  it('素材讀不到（frameCorner 是 null，T-416b）：雕花邊角的卡畫成簡約（同一個材質、不取樣花紋貼圖、不丟錯）', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, null);
    obj.update(card(), getImage);
    const mats = [parts(obj).front.material, parts(obj).back.material];
    const simpleNodes = graphNodes(parts(obj).front).length;
    obj.update(card({ style: 'ornate' }), getImage);
    expect(parts(obj).front.material).toBe(mats[0]);
    expect(parts(obj).back.material).toBe(mats[1]);
    expect(cornerTextures(parts(obj).front)).toHaveLength(0);
    expect(graphNodes(parts(obj).front).length).toBe(simpleNodes);
    obj.update(card({ style: 'ornate', width: 0.08, enabled: false }), getImage);
    expect(parts(obj).front.material).toBe(mats[0]);
  });

  it('換卡（圖層組成改了）時花紋貼圖留著用，不重建貼圖', () => {
    const obj = createCardObject(fakeImage(1008, 1408), 1, corner);
    obj.update(card({ style: 'ornate' }), getImage);
    const [tex] = cornerTextures(parts(obj).front);
    const dispose = vi.spyOn(tex!, 'dispose');
    const other = card({ style: 'ornate' });
    obj.update({ ...other, front: { layers: [layer('base2', 'aaaaaaaaaaaaaaaa', 0)] } }, getImage);
    expect(dispose).not.toHaveBeenCalled();
    expect(cornerTextures(parts(obj).front)).toEqual([tex]);
  });
});
