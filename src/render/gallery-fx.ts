// 舞台主題「展示廳」（T-410、T-816，DESIGN §5「舞台」「展示廳升級」）：由 stage-switch.ts 在選展示廳時建立、換掉時 dispose。
// 數字與「每格怎麼動」在 gallery-layout.ts（純數學、有測試），著色在 gallery-nodes.ts，倒影在 reflection.ts（共用模組）。
//
// 不擋卡片（同全息光環）：整組在 stage-switch 的容器裡（renderOrder −1），每個東西都不寫深度、不測深度、留在「不透明」那一批，
// 照 renderOrder 由遠到近畫完，卡片最後蓋上去——卡片轉到任何角度都完整可見（破框層伸出卡外的部分也一樣）。
// 圓台是凸的實心旋轉體、只畫朝外的面：不測深度也不會畫錯；下層先畫、上層後畫，每層的台緣光環緊接在那一層後面畫（上一層蓋得住它）。
// 每個東西都放在 STAGE_LAYER：倒影的鏡頭只看卡片那一層，展示廳自己不會映進倒影（地板上台子的倒影在地板的著色程式裡直接算）。
//
// 每影格的 draw call（T-816）：地板（石地板或大廳地板，一次只畫一個）、光柱、玻璃板、三層台各 1＋台緣光環各 1、花瓣與散景光點＝10 個
// （T-410 是 8 個）；倒影多一個 pass（卡片在半解析度 render target 再畫一次，沒變）。每格只改 uniform 與 Sprite 的 count，
// 不建網格、材質；換縮圖清單才重建玻璃板的網格與拼圖貼圖。
// 玻璃板照預覽區寬高比排（T-816c，gallery-layout 的 floatSlots）：每格看主鏡頭的寬高比（card-view 在預覽區改大小時改它），
// 和卡片比例（setCardHeight）一樣，變了才重排——同一個網格、原地改頂點（不建網格、不換材質）；窄的預覽區少放的位置寬 0（不畫）。
// 板子一律是標準卡比例（T-816e）：縮圖不論多高多扁都等比放進板子（拼圖裡每格先留一塊板子比例的範圍 ATLAS_PLATE，縮圖置中放進去），
// 所以排法算的大小、離台面多高都準。
// 畫好的大廳（T-816，setHall）：大廳圖在 CSS 那層（ui/stage.ts），讀好之後這裡把石地板換成只疊倒影與光的大廳地板、光柱變淡淡一層；
// 還沒讀好（或讀不到）照 T-410 畫石地板。
// 舞台背景圖（T-814，stage-switch 的 setBackdrop）：展示廳的遠景本來就是 CSS 那層，換成背景圖由 ui 做；
// 3D 這邊讓出地板（石地板、大廳地板都不畫，不然背景圖下半整片被地板蓋掉），台子、光環、光柱、玻璃板、花瓣照舊；null＝和以前一樣。

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type NodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  Vector2,
  type Camera,
  type Texture,
  type UniformNode,
} from 'three/webgpu';
import { positionLocal, uniform } from 'three/tsl';
import { DEFAULT_CARD_H } from './fit';
import {
  BOKEH_COUNT,
  FLOAT_BOB,
  FLOAT_BOB_PERIOD,
  FLOAT_PLATES,
  FLOAT_THUMB_INSET,
  floatBlurPx,
  floatCorners,
  floatSlots,
  FLOOR_REFLECTION,
  FLOOR_SIZE,
  FLOOR_Y,
  galleryY,
  HALL_FLOOR_SIZE,
  LAYOUT_FOV,
  PETAL_COUNT,
  RIM_REACH,
  rimGlow,
  SHAFT_SHIMMER_PERIOD,
  SHAFT_TOP,
  shaftLevel,
  SHAFTS,
  TIERS,
  tierProfile,
  TOP_RINGS,
  type FloatSlot,
} from './gallery-layout';
import { floatLook, floorLook, hallFloorLook, rimHalo, shaftLook, skyNodes, tierLook } from './gallery-nodes';
import { createPlanarReflection, STAGE_LAYER } from './reflection';
import { stageMaterial } from './stage-material';
import { initialStageMotion, stepStageMotion } from './stage-motion';
import type { GalleryPart, MotionFork } from './stage-switch';

/** 卡片庫裡另一張卡的縮圖（已解碼）：透明底、四邊有空邊的正面圖（SCHEMA §3 cards.thumbnail）。 */
export interface GalleryThumb {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** 拼圖用的畫布（node 測試可以注入假的）；沒有 DOM 時 null＝全部用玻璃板。 */
export type MakeCanvas = (width: number, height: number) => HTMLCanvasElement | null;

export interface GalleryDeps {
  /** 主鏡頭：倒影的鏡頭由它複製。 */
  camera: Camera;
  makeCanvas?: MakeCanvas;
}

type FloatUniform = UniformNode<'float', number>;

/**
 * 拼圖每格的大小（像素，含四邊留白 ATLAS_PAD，避免 mipmap 混到隔壁）。T-816 玻璃板放大到約卡高 0.7：176×288 → 224×352；
 * T-816e 每格只放板子比例（標準卡）的範圍：224×306（拼圖最大 672×612，約 1.6 MB）。
 */
export const ATLAS_CELL = { width: 224, height: 306 } as const;
const ATLAS_PAD = 10;
const ATLAS_COLUMNS = 3;
/** 玻璃板的比例（標準卡；高／寬只在 model/aspect.ts 算，T-807 審查）與圓角占寬。 */
const GLASS_ASPECT = DEFAULT_CARD_H;

/** 每格裡板子那一塊（像素，相對格子左上）：留白內、標準卡比例的最大範圍、置中。四邊形的 uv 就是這一塊。 */
export const ATLAS_PLATE = (() => {
  const innerW = ATLAS_CELL.width - ATLAS_PAD * 2;
  const innerH = ATLAS_CELL.height - ATLAS_PAD * 2;
  const width = Math.min(innerW, innerH / GLASS_ASPECT);
  const height = width * GLASS_ASPECT;
  return { x: (ATLAS_CELL.width - width) / 2, y: (ATLAS_CELL.height - height) / 2, width, height } as const;
})();
const GLASS_RADIUS = 0.05;
const LATHE_SEGMENTS = 128;

function defaultCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 光柱：每道一個梯形（底寬、頂寬、往旁邊斜），attribute shaftGain／shaftPhase。 */
function shaftGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const gains: number[] = [];
  const phases: number[] = [];
  const index: number[] = [];
  SHAFTS.forEach((s, i) => {
    const y0 = FLOOR_Y;
    const y1 = SHAFT_TOP;
    positions.push(
      s.x - s.bottomWidth / 2, y0, s.z,
      s.x + s.bottomWidth / 2, y0, s.z,
      s.x + s.lean + s.topWidth / 2, y1, s.z,
      s.x + s.lean - s.topWidth / 2, y1, s.z,
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) {
      gains.push(s.gain);
      phases.push(s.phase);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('shaftGain', new BufferAttribute(new Float32Array(gains), 1));
  g.setAttribute('shaftPhase', new BufferAttribute(new Float32Array(phases), 1));
  g.setIndex(index);
  return g;
}

/** 浮著的玻璃板在拼圖裡的哪一格（有縮圖的才有）。 */
export interface FloatQuad {
  slot: FloatSlot;
  /** 這一格四邊形的寬、高（卡寬）：都比裡面的卡片大 FLOAT_THUMB_INSET 倍（縮圖的空邊、玻璃板的冷光邊）。 */
  width: number;
  height: number;
  /** 拼圖裡的 uv 範圍（左下、右上；three.js 的 v 由下往上）；沒有圖案的玻璃板＝null。 */
  uv: { u0: number; v0: number; u1: number; v1: number } | null;
}

/**
 * 每個位置放什麼：slots＝此刻的位置（gallery-layout 的 floatSlots，寬 0＝這個寬高比不放）；前 aspects.length 個位置（近的先）放縮圖、
 * 其他放沒有圖案的玻璃板。aspects＝每張縮圖的高÷寬（只看有沒有；T-816e 起四邊形一律標準卡比例，縮圖在拼圖裡已經等比放進板子那一塊）。
 */
export function floatQuads(slots: readonly FloatSlot[], aspects: readonly number[], atlasSize: { width: number; height: number }): FloatQuad[] {
  return slots.map((slot, i) => {
    const width = slot.width * FLOAT_THUMB_INSET;
    const height = width * GLASS_ASPECT;
    if (aspects[i] === undefined) return { slot, width, height, uv: null };
    const col = i % ATLAS_COLUMNS;
    const row = Math.floor(i / ATLAS_COLUMNS);
    const box = ATLAS_PLATE;
    const x0 = col * ATLAS_CELL.width + box.x;
    const y0 = row * ATLAS_CELL.height + box.y; // 由上往下（畫布座標）
    return {
      slot,
      width,
      height,
      uv: {
        u0: x0 / atlasSize.width,
        u1: (x0 + box.width) / atlasSize.width,
        v0: 1 - (y0 + box.height) / atlasSize.height,
        v1: 1 - y0 / atlasSize.height,
      },
    };
  });
}

/** 一張縮圖（高÷寬＝aspect）等比放進板子那一塊（ATLAS_PLATE）：放到最大、置中（畫布像素，相對格子左上）。很高的縮圖兩側留空、很扁的上下留空。 */
function atlasBox(aspect: number): { x: number; y: number; width: number; height: number } {
  const plate = ATLAS_PLATE;
  const width = Math.min(plate.width, plate.height / aspect);
  const height = width * aspect;
  return { x: plate.x + (plate.width - width) / 2, y: plate.y + (plate.height - height) / 2, width, height };
}

/** 玻璃板網格的頂點資料：遠的先（不測深度，照順序畫），每張一個四邊形，四角照位置轉向中間。z 是每個位置固定的，所以順序不會變。 */
function floatArrays(quads: readonly FloatQuad[]) {
  const order = [...quads].sort((a, b) => a.slot.z - b.slot.z);
  const positions: number[] = [];
  const uvs: number[] = [];
  const atlasUvs: number[] = [];
  const infos: number[] = [];
  const sizes: number[] = [];
  const index: number[] = [];
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const; // 同 floatCorners 的順序（左下、右下、右上、左上）
  order.forEach((q, i) => {
    floatCorners(q.slot, q.width, q.height).forEach((p, k) => {
      const [u, v] = corners[k]!;
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
      const uv = q.uv;
      atlasUvs.push(uv ? (u === 0 ? uv.u0 : uv.u1) : 0, uv ? (v === 0 ? uv.v0 : uv.v1) : 0);
      infos.push(uv ? 1 : 0, q.slot.far, q.slot.phase, GLASS_RADIUS);
      sizes.push(q.width, q.height);
    });
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { position: positions, uv: uvs, atlasUv: atlasUvs, floatInfo: infos, cardSize: sizes, index };
}

/** 每個頂點屬性幾個數字。 */
const FLOAT_ITEM_SIZE = { position: 3, uv: 2, atlasUv: 2, floatInfo: 4, cardSize: 2 } as const;
type FloatAttribute = keyof typeof FLOAT_ITEM_SIZE;
const FLOAT_ATTRIBUTES = Object.keys(FLOAT_ITEM_SIZE) as FloatAttribute[];

/** 玻璃板的網格（換縮圖清單時建新的）。 */
function floatGeometry(quads: readonly FloatQuad[]): BufferGeometry {
  const data = floatArrays(quads);
  const g = new BufferGeometry();
  for (const name of FLOAT_ATTRIBUTES) g.setAttribute(name, new BufferAttribute(new Float32Array(data[name]), FLOAT_ITEM_SIZE[name]));
  g.setIndex(data.index);
  return g;
}

/** 重排玻璃板（T-816c，寬高比或卡片比例變了）：同一個網格原地改頂點（四邊形數量不變），上傳新的數字。 */
function rewriteFloatGeometry(g: BufferGeometry, quads: readonly FloatQuad[]): void {
  const data = floatArrays(quads);
  for (const name of FLOAT_ATTRIBUTES) {
    const attribute = g.getAttribute(name) as BufferAttribute;
    (attribute.array as Float32Array).set(data[name]);
    attribute.needsUpdate = true;
  }
}

/** 主鏡頭此刻的寬高比與垂直視角（玻璃板照它排；不是透視鏡頭就用預設）。 */
function viewOf(camera: Camera): { aspect: number; fov: number } {
  return camera instanceof PerspectiveCamera ? { aspect: camera.aspect, fov: camera.fov } : { aspect: 16 / 9, fov: LAYOUT_FOV };
}

/** 沒有縮圖時的拼圖：1×1 透明。 */
function emptyAtlas(): DataTexture {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export function createGalleryFx(deps: GalleryDeps): GalleryPart<GalleryThumb> {
  const makeCanvas = deps.makeCanvas ?? defaultCanvas;
  // 擷取（T-850）時換成另一份（forkMotion），所以是 let
  let motion = initialStageMotion();
  let reduced = false;
  let yaw = 0;
  let pitch = 0;
  /** 畫好的大廳讀好了沒（T-816）、有沒有自己的背景圖（T-814）：決定畫哪種地板、光柱多亮。 */
  let hall = false;
  let backdrop = false;
  /** 玻璃板此刻照哪個寬高比、視角、卡片比例排（T-816c）；縮圖的比例與拼圖大小（重排時沿用）。 */
  let layout = { ...viewOf(deps.camera), cardH: DEFAULT_CARD_H };
  let slots = floatSlots(layout.aspect, layout.cardH, layout.fov);
  let thumbAspects: number[] = [];
  let atlasSize = { width: 1, height: 1 };

  const group = new Group();
  group.renderOrder = -1;

  // 共用的 uniform：時間（減少動態效果時停住）、發光環亮度、光柱起伏與整體亮度、鏡面與地板的世界高度
  const time = uniform(0) as FloatUniform;
  const glow = uniform(rimGlow(0, 0, false)) as FloatUniform;
  const shimmer = uniform(0.5) as FloatUniform;
  const shaftGain = uniform(1) as FloatUniform;
  const tierWorldY = TIERS.map((t) => uniform(galleryY(DEFAULT_CARD_H) + t.top) as FloatUniform);
  const floorWorldY = uniform(galleryY(DEFAULT_CARD_H) + FLOOR_Y) as FloatUniform;

  // ---- 倒影：鏡面在最上層台面（地板與下面兩層台面借同一張，各自用自己的高度算淡出） ----
  const reflection = createPlanarReflection(deps.camera);
  group.add(reflection.target);

  const drawables: (Mesh | Sprite)[] = [];
  const place = <O extends Mesh | Sprite>(object: O, order: number): O => {
    object.renderOrder = order;
    object.layers.set(STAGE_LAYER);
    drawables.push(object);
    group.add(object);
    return object;
  };
  const floorPlane = (size: number) => {
    const g = new PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2);
    g.translate(0, FLOOR_Y, 0);
    return g;
  };

  // ---- 地板：石地板（大廳圖還沒讀好，T-410）／大廳地板（T-816，只疊倒影與光，一次只畫一個） ----
  // 地板取倒影比台面柔、淡得慢一點（T-816c，FLOOR_REFLECTION）
  const floorReflection = () => reflection.sample(floorWorldY, undefined, { fade: FLOOR_REFLECTION.fade, soften: FLOOR_REFLECTION.soften });
  const stoneFloor = place(
    new Mesh(
      floorPlane(FLOOR_SIZE),
      stageMaterial(
        new MeshBasicNodeMaterial(),
        floorLook(positionLocal.xz, { reflection: floorReflection(), glow, shimmer }),
        'over',
      ),
    ),
    0,
  );
  const hallFloor = place(
    new Mesh(
      floorPlane(HALL_FLOOR_SIZE),
      stageMaterial(new MeshBasicNodeMaterial(), hallFloorLook(positionLocal.xz, { reflection: floorReflection(), glow }), 'over'),
    ),
    1,
  );

  // ---- 光柱 ----
  place(new Mesh(shaftGeometry(), stageMaterial(new MeshBasicNodeMaterial(), shaftLook(time, SHAFT_SHIMMER_PERIOD, shaftGain), 'add')), 2);

  // ---- 浮著的玻璃板（換縮圖清單才重建網格與拼圖） ----
  let atlas: Texture = emptyAtlas();
  const floatMaterial = new MeshBasicNodeMaterial();
  const floatShape = floatLook({ atlas, time, bob: FLOAT_BOB, period: FLOAT_BOB_PERIOD });
  stageMaterial(floatMaterial, floatShape.look, 'over');
  floatMaterial.positionNode = floatShape.position;
  const floats = place(new Mesh(floatGeometry(floatQuads(slots, thumbAspects, atlasSize)), floatMaterial), 3);
  floats.frustumCulled = false; // 上下漂在著色程式裡

  // ---- 三層圓台與台緣光環（下層先畫；最上層的光環多台面上的細光環） ----
  const lowestFirst = TIERS.map((_, i) => i).reverse();
  lowestFirst.forEach((i, k) => {
    const tier = TIERS[i]!;
    const lathe = new LatheGeometry(
      tierProfile(tier).map((p) => new Vector2(p.x, p.y)),
      LATHE_SEGMENTS,
    );
    const mesh = place(
      new Mesh(lathe, stageMaterial(new MeshBasicNodeMaterial(), tierLook(tier, i, { reflection: reflection.sample(tierWorldY[i]!), glow }), 'opaque')),
      4 + k * 2,
    );
    mesh.position.y = tier.top;
    const isTop = i === 0;
    const inner = isTop ? TOP_RINGS[0]!.radius - 0.05 : tier.radius - tier.bevel * 2;
    const haloGeometry = new RingGeometry(inner, tier.radius + RIM_REACH, LATHE_SEGMENTS, 1);
    haloGeometry.rotateX(-Math.PI / 2);
    const look = rimHalo(positionLocal.xz, tier, glow, isTop ? { rings: TOP_RINGS, time } : undefined);
    const halo = place(new Mesh(haloGeometry, stageMaterial(new MeshBasicNodeMaterial(), look, 'add')), 5 + k * 2);
    halo.position.y = tier.top + 0.001;
  });

  // ---- 花瓣與散景光點：一個 Sprite（前 BOKEH_COUNT 個是光點、後面是花瓣；減少動態時只畫光點） ----
  const sky = skyNodes(time);
  const skyMaterial = stageMaterial(new SpriteNodeMaterial(), sky.look, 'over');
  skyMaterial.positionNode = sky.position;
  skyMaterial.scaleNode = sky.scale;
  skyMaterial.rotationNode = sky.rotation;
  const sprites = place(new Sprite(skyMaterial), 4 + lowestFirst.length * 2);
  sprites.count = BOKEH_COUNT + PETAL_COUNT;
  sprites.frustumCulled = false; // 位置在著色程式裡算

  /** 照寬高比、視角、卡片比例重排玻璃板（T-816c）：有變才改頂點。 */
  const relayout = (next: { aspect: number; fov: number; cardH: number }) => {
    if (next.aspect === layout.aspect && next.fov === layout.fov && next.cardH === layout.cardH) return;
    layout = next;
    slots = floatSlots(layout.aspect, layout.cardH, layout.fov);
    rewriteFloatGeometry(floats.geometry, floatQuads(slots, thumbAspects, atlasSize));
  };

  const setCardHeight = (cardH: number) => {
    const y = galleryY(cardH);
    group.position.y = y;
    TIERS.forEach((t, i) => (tierWorldY[i]!.value = y + t.top));
    floorWorldY.value = y + FLOOR_Y;
    relayout({ ...layout, cardH });
  };
  setCardHeight(DEFAULT_CARD_H);

  /** 地板：有自己的背景圖＝都不畫；大廳圖讀好＝大廳地板；不然石地板。 */
  const showFloors = () => {
    stoneFloor.visible = !backdrop && !hall;
    hallFloor.visible = !backdrop && hall;
  };
  showFloors();

  const writeUniforms = () => {
    time.value = motion.time;
    glow.value = rimGlow(motion.time, motion.energy, reduced);
    shimmer.value = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((2 * Math.PI * motion.time) / SHAFT_SHIMMER_PERIOD);
    shaftGain.value = shaftLevel(motion.time, reduced, hall && !backdrop);
    sprites.count = reduced ? BOKEH_COUNT : BOKEH_COUNT + PETAL_COUNT;
  };
  writeUniforms();

  /** 縮圖 → 拼圖（在畫布上預先模糊：越遠越糊）。沒有畫布或沒有縮圖＝空白拼圖。 */
  const buildAtlas = (thumbs: readonly GalleryThumb[]): { texture: Texture; aspects: number[]; size: { width: number; height: number } } => {
    const list = thumbs.slice(0, FLOAT_PLATES.length).filter((t) => t.width > 0 && t.height > 0);
    const rows = Math.max(1, Math.ceil(list.length / ATLAS_COLUMNS));
    const size = { width: ATLAS_CELL.width * ATLAS_COLUMNS, height: ATLAS_CELL.height * rows };
    const canvas = list.length > 0 ? makeCanvas(size.width, size.height) : null;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return { texture: emptyAtlas(), aspects: [], size };
    const aspects: number[] = [];
    list.forEach((thumb, i) => {
      const aspect = thumb.height / thumb.width;
      const box = atlasBox(aspect);
      const x = (i % ATLAS_COLUMNS) * ATLAS_CELL.width + box.x;
      const y = Math.floor(i / ATLAS_COLUMNS) * ATLAS_CELL.height + box.y;
      ctx.save();
      ctx.filter = `blur(${floatBlurPx(FLOAT_PLATES[i]!.far).toFixed(2)}px)`;
      ctx.drawImage(thumb.image, x, y, box.width, box.height);
      ctx.restore();
      aspects.push(aspect);
    });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.premultiplyAlpha = true; // 預乘上傳：縮小、mipmap 時透明處不會混出暗邊
    texture.needsUpdate = true;
    return { texture, aspects, size };
  };

  return {
    group,

    setCardHeight,

    setReducedMotion(next) {
      reduced = next;
      writeUniforms();
    },

    setPose(yawDeg, pitchDeg) {
      yaw = yawDeg;
      pitch = pitchDeg;
    },

    forkMotion(): MotionFork {
      let other = initialStageMotion();
      return {
        swap() {
          const live = motion;
          motion = other;
          other = live;
          writeUniforms();
        },
      };
    },

    update(dt) {
      stepStageMotion(motion, yaw, pitch, dt, reduced);
      writeUniforms();
      // 預覽區改了大小（主鏡頭的寬高比變了）：玻璃板重排。每格只比數字，變了才建新的排法（T-816e）
      const camera = deps.camera;
      if (camera instanceof PerspectiveCamera && (camera.aspect !== layout.aspect || camera.fov !== layout.fov)) {
        relayout({ aspect: camera.aspect, fov: camera.fov, cardH: layout.cardH });
      }
    },

    setBackdrop(next) {
      // 有背景圖：地板讓出來（見檔頭）
      backdrop = next !== null;
      showFloors();
      writeUniforms();
    },

    setHall(shown) {
      hall = shown;
      showFloors();
      writeUniforms();
    },

    setThumbs(thumbs) {
      const next = buildAtlas(thumbs);
      const oldAtlas = atlas;
      atlas = next.texture;
      floatShape.atlasNode.value = atlas;
      const oldGeometry = floats.geometry;
      thumbAspects = next.aspects;
      atlasSize = next.size;
      floats.geometry = floatGeometry(floatQuads(slots, thumbAspects, atlasSize));
      oldGeometry.dispose();
      oldAtlas.dispose();
    },

    dispose() {
      for (const o of drawables) {
        // Sprite 的網格是 three.js 所有 Sprite 共用的，不釋放
        if (o instanceof Mesh) o.geometry.dispose();
        (o.material as NodeMaterial).dispose();
      }
      atlas.dispose();
      reflection.dispose();
      group.removeFromParent();
    },
  };
}
