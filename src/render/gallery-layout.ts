// 舞台主題「展示廳」（T-410、T-816，DESIGN §5「舞台」「展示廳升級」）的尺寸、位置與「每影格怎麼動」：純數學，不 import three.js（方便在 node 測試）。
//
// T-816 起：卡片站在三層深色金屬圓台上（越上層越小，每層台緣一圈青藍發光環，最上層台面再幾圈細光環）；
// 遠景是畫好的大廳（public/stages/gallery-hall.webp，CSS 那層，ui/stage.ts）：讀好之後 3D 的石地板讓出來，換成只疊倒影
// （卡片、台子的光環）與台子周圍的光的「大廳地板」；還沒讀好照 T-410 畫石地板（深藍底）。程式的光柱在大廳前面保留成淡淡、
// 慢慢變亮變暗的一層（shaftLevel）。兩側浮著卡片庫裡其他卡的縮圖，像一片片玻璃板（沒有就用沒有圖案的玻璃板），比 T-410 大、離卡近
// （T-816c：照預覽區寬高比排，floatSlots；地板上的倒影與光調亮，FLOOR_REFLECTION）；
// 空中淡粉色櫻花瓣飄落（近的大而模糊、遠的小而清楚，petalDepth）＋柔和的散景光點。
// 轉速、能量、時間沿用全息光環的 stage-motion.ts（同一套拖曳反應；減少動態效果時時間停住）。
//
// 座標：卡寬＝1；展示廳整組的原點＝上層台面中心（在卡片下緣再往下 GALLERY_GAP），+y 上、+z 朝鏡頭。

import { boundingRadius, cameraDistance, cardBox, DEFAULT_CARD_H } from './fit';
import { BREATH_MIN, BREATH_STILL, GLOW_BOOST } from './stage-motion';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

/** 卡片下緣到上層台面的距離（卡寬）：比全息光環（0.1）貼近，卡片像站在台上，台面才看得到倒影。 */
export const GALLERY_GAP = 0.04;

/** 上層台面（展示廳原點）的高度：卡片中心是 0；cardH＝卡高（aspectHeight）。 */
export function galleryY(cardH: number): number {
  return -(cardH / 2 + GALLERY_GAP);
}

/** 一層圓台：半徑、厚度、上緣斜面寬（卡寬）。台子的頂面在 top（相對展示廳原點，往下是負的）。 */
export interface Tier {
  radius: number;
  height: number;
  bevel: number;
  /** 這一層頂面的高度（上層＝0）。 */
  top: number;
}

/** 由上到下三層（T-816 照美化稿）：越上層越小、每層露出一圈台面，疊起來像三階的展示台；每層的頂面＝上一層的底。 */
const TIER_SIZES = [
  { radius: 0.62, height: 0.05, bevel: 0.01 },
  { radius: 0.78, height: 0.055, bevel: 0.011 },
  { radius: 0.94, height: 0.06, bevel: 0.012 },
] as const;
export const TIERS: readonly Tier[] = TIER_SIZES.map((t, i) => ({
  ...t,
  top: TIER_SIZES.slice(0, i).reduce((sum, u) => sum - u.height, 0),
}));

/** 地板的高度（相對展示廳原點）＝最下層的底。 */
export const FLOOR_Y = -TIER_SIZES.reduce((sum, t) => sum + t.height, 0);

/** 最上層台面的細光環（T-816）：半徑、半寬（卡寬）、虛線段數（0＝整圈，有段數的那圈慢慢轉）。 */
export interface TopRing {
  radius: number;
  width: number;
  dashes: number;
}
export const TOP_RINGS: readonly TopRing[] = [
  { radius: 0.3, width: 0.003, dashes: 0 },
  { radius: 0.42, width: 0.0035, dashes: 28 },
  { radius: 0.53, width: 0.003, dashes: 0 },
];
/** 虛線那圈轉多快（弧度／秒；減少動態時時間停住＝不轉）。 */
export const TOP_RING_SPIN = 0.1;

/**
 * 圓台的剖面（給 LatheGeometry 繞 y 軸轉一圈）：從中心底部 → 外緣（底下小倒角）→ 側邊 → 上緣斜面 → 頂面中心。
 * 凸的剖面：轉出來的實心台子不管從哪看，朝外的面都不會互相重疊（不測深度、只畫朝外的面也不會畫錯）。
 * 轉角的點各放兩次：LatheGeometry 每個點的法線是前後兩段的平均，重複的點讓兩段各用自己的法線（稜角分明，
 * 側邊整片是水平法線、斜面是斜的，金屬的亮帶才不會從斜面一路漸層到側邊）。y 相對這一層的頂面（頂面 0、底面 −height）。
 */
export function tierProfile(tier: Tier): { x: number; y: number }[] {
  const { radius: r, height: h, bevel: b } = tier;
  const foot = b * 0.4;
  const corners = [
    { x: r - foot, y: -h },
    { x: r, y: -h + foot },
    { x: r, y: -b },
    { x: r - b, y: 0 },
  ];
  return [{ x: 0, y: -h }, ...corners.flatMap((p) => [p, { ...p }]), { x: 0, y: 0 }];
}

/**
 * 展示廳的光有多亮（T-410b：使用者看美化稿更亮 → 台緣光環、光柱、地上亮環都調亮 GALLERY_LIGHT_BOOST 倍）：
 * rimCore＝台緣亮線、rimSpill＝台緣往內外散開的柔光、rimLine＝台子側邊的發光細線、shaft＝光柱最亮處、floorRing＝地上亮環。
 * 大片的光（rimSpill、shaft）就算轉卡最快也只有一點點（測試卡住上限），卡片還是畫面最亮、最清楚的東西。
 */
export const GALLERY_LIGHT_BOOST = 1.25;
export const GALLERY_LIGHTS = {
  rimCore: 1.1 * GALLERY_LIGHT_BOOST,
  rimSpill: 0.09 * GALLERY_LIGHT_BOOST,
  rimLine: 1.4 * GALLERY_LIGHT_BOOST,
  shaft: 0.24 * GALLERY_LIGHT_BOOST,
  floorRing: 0.55 * GALLERY_LIGHT_BOOST,
  /** T-816：最上層台面的細光環（地板上映出的台緣光環在 FLOOR_REFLECTION，T-816c）。 */
  topRing: 0.75,
} as const;

/**
 * 取景（T-410b）：只在展示廳把鏡頭拉遠 GALLERY_PULLBACK 倍，預設縮放（0.85）下整座台子與台面倒影都在預覽區裡
 * （預覽區在提示列上面，不會被擋）。全息光環、關閉照舊。T-816 三層台比較高、比較寬：1.08 → 1.16（卡片小約 7%）。
 */
export const GALLERY_PULLBACK = 1.16;

/**
 * 給 fit.ts cameraDistance 的 reach：上下左右都是「卡片外接球半徑 × GALLERY_PULLBACK」。鏡頭本來就是讓外接球剛好塞進
 * 寬、高比較緊的那一邊，所以不管預覽區是寬是窄，鏡頭都剛好退 GALLERY_PULLBACK 倍；破框層要更多時，card-view 取兩者較大的。
 */
export function galleryReach(cardH: number): { x: number; y: number } {
  const r = boundingRadius(cardBox(cardH)) * GALLERY_PULLBACK;
  return { x: r, y: r };
}

/**
 * 台緣發光環：每層一圈，亮線在斜面中間（半徑 radius − bevel／2）。RIM_CORE＝亮線半寬、RIM_SPILL＝往內外散開的柔光
 * 每多遠剩 1/e、RIM_REACH＝畫柔光的平面伸出台緣多遠（卡寬）。
 */
export const RIM_CORE = 0.005;
export const RIM_SPILL = 0.06;
export const RIM_REACH = 0.3;

/** 發光環的亮度（呼吸 × 拖曳反應）：週期 RIM_BREATH 秒，亮度 BREATH_MIN～1；減少動態效果時固定 BREATH_STILL。 */
export const RIM_BREATH = 5.2;

export function rimGlow(time: number, energy: number, reduced: boolean): number {
  if (reduced) return BREATH_STILL;
  const wave = 0.5 + 0.5 * Math.sin((TAU * time) / RIM_BREATH);
  return (BREATH_MIN + (1 - BREATH_MIN) * wave) * (1 + GLOW_BOOST * energy);
}

// ---- 浮在兩側的卡片（卡片庫裡其他卡的縮圖） ----

/** 最多幾張（不含目前這張）。 */
export const MAX_GALLERY_CARDS = 6;

/**
 * 一個位置此刻的樣子：中心（相對展示廳原點）、面向（繞 y 轉幾度，正＝往右轉、朝中間看）、卡寬（0＝這個預覽區寬高比放不下、不畫）、
 * 遠近（0 近～1 遠：越遠越淡越糊）、漂浮相位。
 */
export interface FloatSlot {
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  width: number;
  far: number;
  phase: number;
}

/**
 * 每個位置固定的東西（T-816c）。side＝哪一邊（−1 左、1 右）；rank＝由內到外第幾排（0 最靠卡片、也最近）；z＝深度；
 * yawDeg＝寬鬆時板子對視線斜幾度（看起來的斜度，朝中間；實際面向再加上視線本身的角度）；height＝看起來多高、lift＝中心在畫面上的高低
 * （兩個都以「卡片外接球在畫面上的半徑」為 1，玻璃板含 FLOAT_GLASS_PAD 的邊；越外排越高，從後面一片片露出來）；far、phase 同 FloatSlot。
 * 近的先（近的先放縮圖）、左右交替；左右稍微不對稱（右邊深一點、低一點），比較自然。
 */
export interface FloatPlate {
  side: -1 | 1;
  rank: number;
  z: number;
  yawDeg: number;
  height: number;
  lift: number;
  far: number;
  phase: number;
}
export const FLOAT_PLATES: readonly FloatPlate[] = [
  { side: -1, rank: 0, z: -0.6, yawDeg: 56, height: 1.14, lift: -0.06, far: 0.1, phase: 0 },
  { side: 1, rank: 0, z: -0.72, yawDeg: 56, height: 1.12, lift: -0.02, far: 0.2, phase: 2.2 },
  { side: -1, rank: 1, z: -1.8, yawDeg: 52, height: 1.04, lift: 0.07, far: 0.5, phase: 4.1 },
  { side: 1, rank: 1, z: -2.0, yawDeg: 52, height: 1.02, lift: 0.03, far: 0.55, phase: 1.3 },
  { side: -1, rank: 2, z: -3.3, yawDeg: 48, height: 0.96, lift: 0.17, far: 0.85, phase: 3.3 },
  { side: 1, rank: 2, z: -3.5, yawDeg: 48, height: 0.95, lift: 0.12, far: 1, phase: 5.2 },
];

/** 排法用的鏡頭：垂直視角（同 card-view 的 FOV_DEG）、預設縮放（同 interact 的 ZOOM_DEFAULT；render 不 import interact，測試核對）。 */
export const LAYOUT_FOV = 30;
export const LAYOUT_ZOOM = 0.85;

/**
 * 擠的程度（T-816c）。squeeze 0＝寬鬆（FLOAT_PLATES 的斜度與大小）～1＝最擠（每片斜到 tightYaw、縮到 minScale 倍）。
 * gapMin／gapMax＝板子之間（與卡片之間、與畫面邊之間）留多寬（同 height 的單位）：寬的預覽區平均分開、最多 gapMax（再寬就留在外面）；
 * edge＝離畫面左右邊至少多遠；threeMax＝三排要擠到這個程度以內才放三排，不然改放兩排（窄的預覽區寧可少一片、板子大一點、留點空隙）；
 * floorClear＝板子（上下漂到最低時）下緣離最上層台面至少多高（卡寬）。
 */
export const FLOAT_FIT = {
  tightYaw: 66,
  minScale: 0.72,
  gapMin: 0.06,
  gapMax: 0.3,
  edge: 0.05,
  threeMax: 0.5,
  floorClear: 0.03,
} as const;

/** 玻璃板的比例（標準卡；高／寬只在 model/aspect.ts 算）。縮圖不論比例都等比放進這個比例的板子（T-816e，gallery-fx 的拼圖）。 */
const PLATE_ASPECT = DEFAULT_CARD_H;
/** floatSlots 認得的卡高範圍（同自訂比例的 0.5～2）：超出照邊界排。 */
export const FLOAT_CARD_H = [0.5, 2] as const;

/**
 * 排法要的鏡頭數字：鏡頭距離 d、卡片外接球半徑 r（畫面上的 1 單位＝r × (d − z) ／ d 卡寬）、展示廳原點高度 y0、卡片半寬與
 * 畫面半寬、半高（同單位）。
 */
interface PlateView {
  d: number;
  r: number;
  y0: number;
  cardHalf: number;
  halfX: number;
  halfY: number;
}

/** 排好的一片：FLOAT_PLATES 的第幾個、放哪。 */
interface Placed {
  index: number;
  slot: FloatSlot;
}

/**
 * 一邊放 n 排、擠的程度 squeeze、間距 gap：由內往外一片片排（每片內緣＝上一片外緣＋gap，第一片＝卡片半寬＋gap），回傳每片的位置、最外緣
 * （畫面上，同 height 的單位）與上下放不放得下（T-816e：板子漂到最高、最低時都離畫面上下緣至少 edge）。
 * 左邊的板子朝右轉：內側那條邊比較遠、外側比較近（透視算在內）。
 */
function placeRow(side: -1 | 1, n: number, squeeze: number, gap: number, v: PlateView): { slots: Placed[]; outer: number; upright: boolean } {
  const { d, r } = v;
  const fit = FLOAT_FIT;
  let edge = v.cardHalf + gap;
  let outer = edge;
  let upright = true;
  const slots: Placed[] = [];
  FLOAT_PLATES.forEach((plate, index) => {
    if (plate.side !== side || plate.rank >= n) return;
    const depth = d - plate.z;
    const scale = 1 + (fit.minScale - 1) * squeeze;
    const height = plate.height * scale * ((r * depth) / d); // 玻璃板的高（卡寬）
    const u = height / PLATE_ASPECT / 2; // 玻璃板的半寬
    // 看起來的斜度＋視線的角度（內緣那條視線）＝實際面向
    const yaw = plate.yawDeg + (fit.tightYaw - plate.yawDeg) * squeeze + Math.atan((edge * r) / d) / RAD;
    const c = Math.cos(yaw * RAD);
    const s = Math.sin(yaw * RAD);
    // 內緣（離中間近、比較遠）落在畫面上的 edge：|x| ＝ edge × r × (d − z) ／ d
    const inner = (edge * r * (depth + u * s)) / d;
    const cx = inner + u * c;
    outer = ((cx + u * c) * d) / (Math.max(depth - u * s, 1e-3) * r);
    // 高低：畫面上的 lift 換成卡寬；下緣（漂到最低）至少在最上層台面上方 floorClear
    const lifted = (plate.lift * r * depth) / d - v.y0;
    const y = Math.max(lifted, height / 2 + FLOAT_BOB + fit.floorClear);
    // 上下（畫面上）：漂到最高時的頂端、最低時的底端
    const toScreen = d / (r * depth);
    const top = (y + v.y0 + height / 2 + FLOAT_BOB) * toScreen;
    const bottom = (y + v.y0 - height / 2 - FLOAT_BOB) * toScreen;
    if (top > v.halfY - fit.edge || bottom < -(v.halfY - fit.edge)) upright = false;
    const width = height / PLATE_ASPECT / FLOAT_GLASS_PAD;
    slots.push({ index, slot: { x: side * cx, y, z: plate.z, yawDeg: -side * yaw, width, far: plate.far, phase: plate.phase } });
    edge = outer + gap;
  });
  return { slots, outer, upright };
}

/** 一邊怎麼排：先試三排寬鬆、再三排擠一點（到 threeMax）、兩排、一排；寬鬆時間距平均分開（最多 gapMax）。都放不下＝這邊不放。 */
function fitRow(side: -1 | 1, v: PlateView): Placed[] {
  const { gapMin, gapMax, edge, threeMax } = FLOAT_FIT;
  const limit = v.halfX - edge;
  const fits = (row: { outer: number; upright: boolean }, room = limit) => row.upright && row.outer <= room;
  /** ok(yes) 成立、ok(no) 不成立：找最靠近 no 的成立值（二分法）。 */
  const bisect = (ok: (x: number) => boolean, yes: number, no: number) => {
    for (let i = 0; i < 32; i++) {
      const mid = (yes + no) / 2;
      if (ok(mid)) yes = mid;
      else no = mid;
    }
    return yes;
  };
  for (const n of [3, 2, 1]) {
    if (fits(placeRow(side, n, 0, gapMin, v))) {
      // 寬鬆：間距（含卡片與畫面邊）平均分開
      const spread = (g: number) => fits(placeRow(side, n, 0, g, v), v.halfX - g);
      const gap = !spread(gapMin) ? gapMin : spread(gapMax) ? gapMax : bisect(spread, gapMin, gapMax);
      return placeRow(side, n, 0, gap, v).slots;
    }
    const most = n === 3 ? threeMax : 1;
    if (fits(placeRow(side, n, most, gapMin, v))) {
      // 擠一點：剛好放得下的最小擠法
      const squeeze = bisect((k) => fits(placeRow(side, n, k, gapMin, v)), most, 0);
      return placeRow(side, n, squeeze, gapMin, v).slots;
    }
  }
  return [];
}

/**
 * 浮著的玻璃板此刻放哪（T-816c：照預覽區寬高比排；T-816 是固定的六個位置，窄的預覽區會疊成一團）。
 * 在預設鏡頭（縮放 LAYOUT_ZOOM、垂直視角 fovDeg，展示廳的取景）的畫面上排：卡片兩側由內往外一片片排開，兩兩不重疊、不進卡片
 * （左右轉到任何角度的寬度）、整片在畫面裡；寬的預覽區每邊三片、間距平均分開，窄的先把板子斜一點、小一點，再不行就少放幾片（近的先留）。
 * 尺寸以「卡片外接球在畫面上的半徑」為單位，卡片比例（cardH）不同時一樣成立。回傳 FLOAT_PLATES 同順序的六個位置，沒放的寬 0。
 * 適用範圍（T-816e，測試卡住邊界）：寬高比 0.3～4、卡高 FLOAT_CARD_H（自訂比例允許的 0.5～2；超出照邊界算）、視角 20°～45°；
 * 左右、上下（板子漂到最高最低）都檢查，放不下就再擠、再少放。
 */
export function floatSlots(viewAspect: number, cardH: number, fovDeg = LAYOUT_FOV): FloatSlot[] {
  const aspect = Number.isFinite(viewAspect) && viewAspect > 0 ? viewAspect : 16 / 9;
  const h = Number.isFinite(cardH) && cardH > 0 ? Math.min(FLOAT_CARD_H[1], Math.max(FLOAT_CARD_H[0], cardH)) : DEFAULT_CARD_H;
  const fov = Number.isFinite(fovDeg) && fovDeg > 1 && fovDeg < 170 ? fovDeg : LAYOUT_FOV;
  const box = cardBox(h);
  const d = cameraDistance(fov, aspect, LAYOUT_ZOOM, box, galleryReach(h));
  const r = boundingRadius(box);
  const unit = r / (d * Math.tan((fov / 2) * RAD)); // 外接球在畫面上的半徑（NDC 的 y）
  const view: PlateView = {
    d,
    r,
    y0: galleryY(h),
    // 卡片左右轉時近側那條邊在畫面上最寬（sin ＝ 0.5 ／ d 時）：0.5 ／ (r √(1 − 0.25 ／ d²))
    cardHalf: 0.5 / (r * Math.sqrt(1 - 0.25 / (d * d))),
    halfX: Math.min(aspect / unit, 1e3),
    halfY: 1 / unit,
  };
  const placed = [...fitRow(-1, view), ...fitRow(1, view)];
  return FLOAT_PLATES.map(
    (plate, index) =>
      placed.find((p) => p.index === index)?.slot ?? { x: plate.side, y: 1, z: plate.z, yawDeg: -plate.side * 45, width: 0, far: plate.far, phase: plate.phase },
  );
}

/** 縮圖四邊有空邊（卡片外框的 4%）：四邊形比卡片大這麼多倍，卡片本身才是位置的寬（玻璃板的四邊形也一樣大，冷光邊才不會被切掉）。 */
export const FLOAT_THUMB_INSET = 1.1;
/** 玻璃板比裡面的卡片大一點（每邊約 2.5%），看起來像卡片封在玻璃裡；要小於 FLOAT_THUMB_INSET。 */
export const FLOAT_GLASS_PAD = 1.05;

/** 上下漂：振幅（卡寬）、週期（秒）。 */
export const FLOAT_BOB = 0.06;
export const FLOAT_BOB_PERIOD = 9;

/** 第 slot 張此刻往上漂多少（卡寬）。著色程式用同一個公式；減少動態效果時舞台的時間停住，就停在那裡不漂。 */
export function floatBob(slot: FloatSlot, time: number): number {
  return FLOAT_BOB * Math.sin((TAU * time) / FLOAT_BOB_PERIOD + slot.phase);
}

/** 遠近 → 不透明度（近 0.8、遠 0.42）與縮圖模糊的半徑（縮圖格子像素：近 0.8、遠 4.2）。 */
export function floatOpacity(far: number): number {
  return 0.8 - 0.38 * far;
}
export function floatBlurPx(far: number): number {
  return 0.8 + 3.4 * far;
}

/** 浮著的卡的四個角（左下、右下、右上、左上；展示廳原點的座標）：寬 width、高 height 的卡繞自己的中心轉 yawDeg。 */
export function floatCorners(slot: FloatSlot, width: number, height: number): { x: number; y: number; z: number }[] {
  const c = Math.cos(slot.yawDeg * RAD);
  const s = Math.sin(slot.yawDeg * RAD);
  const hw = width / 2;
  const hh = height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => ({ x: slot.x + lx! * c, y: slot.y + ly!, z: slot.z - lx! * s }));
}

// ---- 光柱 ----

/** 一道光柱：底部中心 x、z（地板上），上下寬度（卡寬），往右斜多少（頂端相對底部的 x 偏移），亮度。 */
export interface Shaft {
  x: number;
  z: number;
  topWidth: number;
  bottomWidth: number;
  lean: number;
  gain: number;
  phase: number;
}

/** 光柱從多高打下來（相對展示廳原點）。 */
export const SHAFT_TOP = 5;

export const SHAFTS: readonly Shaft[] = [
  { x: -3.3, z: -8, topWidth: 0.35, bottomWidth: 1.2, lean: -0.6, gain: 0.8, phase: 0 },
  { x: -1.4, z: -9, topWidth: 0.3, bottomWidth: 1.0, lean: -0.3, gain: 1, phase: 1.9 },
  { x: 0.5, z: -9.5, topWidth: 0.28, bottomWidth: 0.95, lean: 0.1, gain: 0.7, phase: 3.7 },
  { x: 2.2, z: -8.6, topWidth: 0.32, bottomWidth: 1.1, lean: 0.4, gain: 0.95, phase: 0.8 },
  { x: 4.0, z: -7.6, topWidth: 0.36, bottomWidth: 1.25, lean: 0.7, gain: 0.75, phase: 2.6 },
];

/** 光柱明暗的慢慢起伏（週期秒）。 */
export const SHAFT_SHIMMER_PERIOD = 11;

/** 有畫好的大廳時光柱只剩這麼亮（大廳圖本身就有光柱，程式的只是淡淡一層），再隨 shaftLevel 慢慢變亮變暗。 */
export const HALL_SHAFT_GAIN = 0.5;

/**
 * 光柱整體的亮度倍數：沒有大廳＝1（T-410 的樣子，每道各自小幅起伏在著色程式裡）；有大廳＝HALL_SHAFT_GAIN × 0.45～1，
 * 週期 SHAFT_SHIMMER_PERIOD 秒慢慢變亮變暗；減少動態時固定在中間。
 */
export function shaftLevel(time: number, reduced: boolean, hall: boolean): number {
  if (!hall) return 1;
  const wave = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((TAU * time) / SHAFT_SHIMMER_PERIOD);
  return HALL_SHAFT_GAIN * (0.45 + 0.55 * wave);
}

// ---- 花瓣與散景光點（一個 Sprite 一次畫完：前 BOKEH_COUNT 個是光點、後面是花瓣） ----

/** 花瓣：片數、落到多低（相對展示廳原點；落到最上層台面上方就淡掉）、下落速度（卡寬／秒）、左右擺幅。 */
export const PETAL_COUNT = 42;
export const PETAL_BOX = { top: 3.0, bottom: 0.12 } as const;
export const PETAL_FALL = [0.07, 0.12] as const;
export const PETAL_SWAY = 0.22;
/** 遠近的分布：亂數的幾次方（越大越多遠的、少數近的）。 */
export const PETAL_NEAR_BIAS = 1.7;

/** 一片花瓣在某個遠近（0 最遠～1 最近）時：z、大小（卡寬）、模糊（0 清楚～1 很糊）、左右可以飄的範圍（|x| 在 minX～maxX）、從多高開始落。 */
export interface PetalDepth {
  z: number;
  size: number;
  blur: number;
  minX: number;
  maxX: number;
  top: number;
}

/** 0～1 的平滑過渡（同著色程式的 smoothstep）。 */
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 花瓣的遠近範圍（z）、大小（卡寬）、模糊從哪裡開始、可以飄的最大 |x|、近的要離中間多遠（才不會從卡片前面飄過）、從多高開始落。
 * 著色程式（gallery-nodes 的 skyNodes）用同一套數字與公式。
 */
export const PETAL_DEPTH = {
  z: [-4.2, 1.3],
  size: [0.07, 0.2],
  blur: [0.45, 1],
  maxX: [3.6, 1.6],
  minX: 0.95,
  minXRamp: [0.45, 0.85],
  top: [PETAL_BOX.top, 2.0],
} as const;

/** 花瓣「近的大而模糊、遠的小而清楚」（T-816）：遠近 near（0～1）→ 位置與大小。 */
export function petalDepth(near: number): PetalDepth {
  const n = Math.min(1, Math.max(0, near));
  const d = PETAL_DEPTH;
  return {
    z: lerp(d.z[0], d.z[1], n),
    size: lerp(d.size[0], d.size[1], n),
    blur: smooth(d.blur[0], d.blur[1], n),
    minX: lerp(0, d.minX, smooth(d.minXRamp[0], d.minXRamp[1], n)),
    maxX: lerp(d.maxX[0], d.maxX[1], n),
    top: lerp(d.top[0], d.top[1], n),
  };
}

/** 散景光點：顆數、散在卡片後面的範圍（相對展示廳原點）、大小（卡寬）、往上飄的速度（卡寬／秒）、明暗閃爍的週期（秒）。 */
export const BOKEH_COUNT = 32;
export const BOKEH_BOX = { minX: -4.2, maxX: 4.2, minY: 0.3, maxY: 3.4, minZ: -5.5, maxZ: -1.4 } as const;
export const BOKEH_SIZE = [0.1, 0.36] as const;
export const BOKEH_RISE = [0.01, 0.035] as const;
export const BOKEH_TWINKLE = [4, 9] as const;

// ---- 地板 ----

/** 地板的石磚邊長、遠處淡出成背景的距離（離鏡頭，卡寬）。 */
export const FLOOR_TILE = 1.25;
export const FLOOR_FADE = [7, 17] as const;
/** 地板網格的大小（卡寬，正方形）。 */
export const FLOOR_SIZE = 44;
/**
 * 大廳地板（T-816，畫好的大廳讀好之後取代石地板）：只疊倒影與台子周圍的光，所以只要蓋住台子周圍（正方形邊長，卡寬）；
 * 離中心 HALL_FLOOR_FADE 之間淡掉（看不出邊）。
 */
export const HALL_FLOOR_SIZE = 7;
export const HALL_FLOOR_FADE = [2.2, 3.4] as const;

/**
 * 地板上的倒影與光（T-816c：主對話和美化稿並排看，拋光地板上的倒影、台緣光環在地上的青藍反光都比美化稿暗 → 調亮）。
 * hallCard／stoneCard＝卡片倒影疊在大廳地板／石地板上的強度（兩種地板同一個倍數）；fade／soften＝地板取倒影時的淡出距離與柔化
 * （比台面〔倒影模組的預設〕淡得慢一點、柔一點：看得出是拋光石面上的倒影，不像第二張卡）；rimMirror＝地上映出的台緣光環、
 * rimMirrorDepth＝它越深越淡（每深這麼多卡寬剩 1/e）、rimMirrorSpill／rimMirrorSpread＝它往兩邊散開的柔光有多亮、每多遠剩 1/e（卡寬）；
 * glow＝台子周圍地上的青藍光暈與地上亮環的倍數（T-816e：大廳地板 1.4、石地板 1.75 → 兩種地板同一個 1.3。大廳地板的光用「不透明度＝亮度」
 * 疊在畫好的地板上、會蓋掉底下那一份，深色的石地板直接加上去，兩者合成出來差不多；石地板以前多乘的那份讓它過曝）。
 * 光的總量另有上限（FLOOR_LIGHT）：卡片還是畫面最亮、最清楚的東西（測試卡住）。
 */
export const FLOOR_REFLECTION = {
  hallCard: 0.9,
  stoneCard: 0.675,
  fade: 0.55,
  soften: { base: 0.003, perHeight: 0.03 },
  rimMirror: 1.5,
  rimMirrorDepth: 0.4,
  rimMirrorSpill: 0.16,
  rimMirrorSpread: 0.07,
  glow: 1.3,
} as const;

/** 台子周圍地上的光暈：台腳的亮度、每離台腳多遠剩 1/e（卡寬）。地上亮環：離最下層台緣多遠、半寬（卡寬；亮度 GALLERY_LIGHTS.floorRing）。 */
export const FLOOR_POOL = { gain: 0.42, reach: 0.3 } as const;
export const FLOOR_RING = { gap: 0.035, width: 0.008 } as const;
/** 地上映出的台緣光環的亮線半寬：至少 width ＋ perHeight × 離地板多高（越深越糊）；亮線本身的亮度＝width ÷ 半寬（越糊越暗）。 */
export const RIM_MIRROR_CORE = { width: 0.006, perHeight: 0.07 } as const;

/**
 * 地上的光的上限（T-816e，審查：地上亮環中心各項相加——光暈＋亮環＋映出的台緣光環——再乘拖曳最亮，藍色會超過 1、比卡片亮）。
 * 兩層，都用柔和的上限 softLimit（上限的 knee 倍以下原封不動、以上慢慢逼近上限）：
 * ① 地上的光（還沒乘呼吸／拖曳亮度）限制在台緣亮線（GALLERY_LIGHTS.rimCore）的 rimShare 倍以內，再乘亮度——任何時候都比台緣本身暗；
 * ② 再加上卡片倒影後，整體最亮的顏色分量限制在 max 以內（比卡片的白暗）。石地板整片地板（含石紋與映出的展示廳）都算進 ②。
 */
export const FLOOR_LIGHT = { rimShare: 0.8, max: 0.92, knee: 0.6 } as const;

/** 柔和的上限：x ≤ knee × max 原封不動；以上一路變大、越來越慢逼近 max（永遠到不了），接點斜率 1（沒有折角）。著色程式用同一個式子。 */
export function softLimit(x: number, max: number, knee: number = FLOOR_LIGHT.knee): number {
  const start = knee * max;
  if (!(x > start)) return x;
  const room = max - start;
  return start + room * (1 - Math.exp(-(x - start) / room));
}

/**
 * 地上的光最亮的地方有多亮（給測試核對上限，著色程式是 gallery-nodes 的 floorLight）：光暈在台腳、亮環中心、三層映出的台緣光環
 * （亮線取最細、最亮的寬度，加上柔光）都取最亮，而且假設全疊在同一點（比實際保守）。glow＝呼吸 × 拖曳亮度；reflection＝那裡的卡片倒影
 * （最亮的顏色分量）。raw＝還沒設上限、沒乘亮度的總和；light＝①之後乘上亮度（地上的光）；total＝加上倒影再經過②（最亮的顏色分量）。
 */
export function floorLightPeak(glow: number, reflection = 0): { raw: number; light: number; total: number } {
  let raw = (FLOOR_POOL.gain + GALLERY_LIGHTS.floorRing) * FLOOR_REFLECTION.glow;
  for (const m of rimMirrors()) {
    const core = RIM_MIRROR_CORE.width / (RIM_MIRROR_CORE.width + m.height * RIM_MIRROR_CORE.perHeight);
    raw += (core + FLOOR_REFLECTION.rimMirrorSpill) * Math.exp(-m.height / FLOOR_REFLECTION.rimMirrorDepth) * FLOOR_REFLECTION.rimMirror;
  }
  const light = softLimit(raw, FLOOR_LIGHT.rimShare * GALLERY_LIGHTS.rimCore) * glow;
  return { raw, light, total: softLimit(light + reflection, FLOOR_LIGHT.max) };
}

/**
 * 地板映出的台緣光環（T-816，「倒影（卡片與台子）」的台子那一半）：每層台緣亮線的半徑、離地板多高（卡寬）。
 * 倒影的鏡頭只畫卡片，所以台子的倒影在地板的著色程式裡直接算（鏡面下方同樣深度的一圈光，越深越淡越糊），不多一個 pass。
 */
export function rimMirrors(): { radius: number; height: number }[] {
  return TIERS.map((t) => ({ radius: t.radius - t.bevel * 0.5, height: t.top - t.bevel - FLOOR_Y }));
}
