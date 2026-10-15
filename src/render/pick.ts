// 「點到卡上哪裡」與「卡上某點在螢幕哪裡」的純數學，以及擷取（PNG、縮圖）緊貼卡片的裁切範圍
// （不 import three.js，方便在 node 測試；測試拿 three.js 當對照組）。
//
// 場景設定和 card-view 一致：鏡頭在 (0, 0, cameraZ)、沒有旋轉、看向 −z（水鏡的地平線〔T-825〕：鏡頭往下移到 cameraY、
// 畫面上下平移 shiftY〔lens shift〕，見 PickScene；點選與投影照它算，擷取的裁切一律用沒有平移的鏡頭）；
// 卡片旋轉＝three.js Euler(pitch, yaw, 0, 'XYZ')，也就是 世界 ＝ Rx(pitch) · Ry(yaw) · 卡片本地。
// 正面在本地 z ＝ +厚度/2；背面在 z ＝ −厚度/2，且繞垂直軸轉 180°，所以「看著背面」的 x ＝ −本地 x（不鏡像）。
// 座標都是卡寬單位、卡片中心為 0；不處理視差位移（呼叫端自己加減）。

import type { FaceSide } from '../model/types';
import { BREAKOUT_FADE, type Box } from './breakout';
import { roundedRectSdf, type RoundedRect } from './fit';

export interface CardHit {
  face: FaceSide;
  /** 看著那一面的 +x 右、+y 上（卡寬單位，卡片中心為 0）。 */
  x: number;
  y: number;
}

export interface PickScene {
  vFovDeg: number;
  /** 畫面寬／高。 */
  viewAspect: number;
  cameraZ: number;
  yawDeg: number;
  pitchDeg: number;
  outline: RoundedRect;
  thickness: number;
  /**
   * 中間不是卡面的圓半徑（T-810 CD 光碟：孔與透明圈＝印刷面內緣）：這一圈裡點不到卡面（onCardFace）。省略＝0（卡片）。
   */
  inner?: number;
  /**
   * 擷取的裁切要包住的盒子（T-806 透明卡套：卡套比卡片大一圈、比較厚）：半寬、半高、厚度。
   * 省略＝卡片本身（outline＋thickness）。只影響 captureFrame／turntableFrame，點選與投影照卡片算。
   */
  bounds?: { halfW: number; halfH: number; thickness: number };
  /**
   * 水鏡的地平線（T-825，render/water-layout.ts 的 horizonCameraY／horizonShift）：鏡頭的高度（世界 y）與畫面上下平移（NDC，+ 往上）。
   * 省略＝0（和以前一樣）。只影響點選與投影（pickCard、planePoint、projectCardPoint）；擷取（captureFrame、turntableFrame）
   * 的鏡頭一律沒有平移（card-view 擷取時把鏡頭放回 y＝0），不看這兩個欄位。
   */
  cameraY?: number;
  shiftY?: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

export function clientToNdc(clientX: number, clientY: number, rect: ScreenRect): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((clientY - rect.top) / rect.height) * 2,
  };
}

export function ndcToClient(ndc: { x: number; y: number }, rect: ScreenRect): { x: number; y: number } {
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height,
  };
}

function rotX([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

function rotY([x, y, z]: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

/** 卡片本地 → 世界。 */
function toWorld(v: Vec3, s: PickScene): Vec3 {
  return rotX(rotY(v, s.yawDeg * RAD), s.pitchDeg * RAD);
}

/** 世界 → 卡片本地（旋轉的反向）。 */
function toLocal(v: Vec3, s: PickScene): Vec3 {
  return rotY(rotX(v, -s.pitchDeg * RAD), -s.yawDeg * RAD);
}

/** 鏡頭穿過 NDC 那一點的射線（起點、方向），換到卡片本地座標。 */
function cameraRay(ndcX: number, ndcY: number, s: PickScene): { origin: Vec3; dir: Vec3 } {
  const tanV = Math.tan((s.vFovDeg / 2) * RAD);
  const y = s.cameraY ?? 0;
  const shift = s.shiftY ?? 0;
  return { origin: toLocal([0, y, s.cameraZ], s), dir: toLocal([ndcX * tanV * s.viewAspect, (ndcY - shift) * tanV, -1], s) };
}

/**
 * 卡面座標 (x, y) 在不在卡面上：卡片輪廓裡面（圓角矩形的距離 ≤ 0），而且不在中間那一圈（s.inner，T-810 光碟的孔與透明圈）。
 * pickCard 與 card-view 的「點卡外的破框層」共用。
 */
export function onCardFace(x: number, y: number, s: Pick<PickScene, 'outline' | 'inner'>): boolean {
  return roundedRectSdf(x, y, s.outline) <= 0 && !(s.inner !== undefined && s.inner > 0 && Math.hypot(x, y) < s.inner);
}

/** 從 NDC 打一條射線到卡片：回傳打到哪一面的哪一點；沒打到卡面（或只打到側邊、光碟中間那一圈）回 null。 */
export function pickCard(ndcX: number, ndcY: number, s: PickScene): CardHit | null {
  const { origin, dir } = cameraRay(ndcX, ndcY, s);
  // 射線往 −z 走 → 先碰到正面那一層；往 +z 走 → 先碰到背面。另一面是背對射線的，看不到。
  if (Math.abs(dir[2]) < 1e-12) return null;
  const face: FaceSide = dir[2] < 0 ? 'front' : 'back';
  const planeZ = face === 'front' ? s.thickness / 2 : -s.thickness / 2;
  const t = (planeZ - origin[2]) / dir[2];
  if (!(t > 0)) return null;
  const x = origin[0] + t * dir[0];
  const y = origin[1] + t * dir[1];
  if (!onCardFace(x, y, s)) return null;
  return { face, x: face === 'front' ? x : -x + 0, y };
}

/**
 * 從 NDC 打一條射線到「某一面所在的無限平面」（不限卡片範圍，拖曳圖層拖到卡外也能繼續算）：
 * 回傳看著那一面的座標（卡寬單位、+x 右 +y 上，背面不鏡像）。
 * 那一面背對鏡頭（和 projectCardPoint 的判斷一致）、射線和平面平行、或往反方向打不到時回 null。
 */
export function planePoint(face: FaceSide, ndcX: number, ndcY: number, s: PickScene): { x: number; y: number } | null {
  const { origin, dir } = cameraRay(ndcX, ndcY, s);
  const sign = face === 'front' ? 1 : -1;
  const planeZ = (sign * s.thickness) / 2;
  // 鏡頭要在那一面的法線那一側，那一面才朝著鏡頭
  if ((origin[2] - planeZ) * sign <= 0) return null;
  if (Math.abs(dir[2]) < 1e-12) return null;
  const t = (planeZ - origin[2]) / dir[2];
  if (!(t > 0) || !Number.isFinite(t)) return null;
  const x = origin[0] + t * dir[0];
  const y = origin[1] + t * dir[1];
  return { x: face === 'front' ? x : -x + 0, y };
}

/** 擷取（PNG、縮圖）四邊各留「卡片外框長邊」的這個比例。 */
export const CAPTURE_MARGIN = 0.04;

/** 給 three.js `camera.setViewOffset(fullWidth, fullHeight, x, y, width, height)` 的參數。 */
export interface ViewOffset {
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureFrame {
  /** 輸出圖的寬高（像素）。 */
  width: number;
  height: number;
  /**
   * 只渲染卡片那一塊、解析度＝輸出大小。fullWidth／fullHeight 的比例＝原本的 viewAspect，
   * 所以 setViewOffset 把鏡頭 aspect 設成同一個值（透視不變，畫出來和畫面上一樣）。
   */
  viewOffset: ViewOffset;
}

/** 破框層（T-411）超出卡片的部分：那一面上的方框（卡面座標，看著那一面 +x 右 +y 上；breakout.ts 的內容範圍＋目前位移）。 */
export interface FaceBox {
  face: FaceSide;
  box: Box;
}

/**
 * 這一面朝鏡頭的程度（＝holo.ts viewDirection 的 z、card-mesh 卡外部分淡出用的那個值）大於 BREAKOUT_FADE.from
 * 才看得到卡外的部分（背對、接近 90° 的那一面不畫）。
 */
function breakoutShown(face: FaceSide, s: PickScene): boolean {
  const z = Math.cos(s.pitchDeg * RAD) * Math.cos(s.yawDeg * RAD) * (face === 'front' ? 1 : -1);
  return z > BREAKOUT_FADE.from;
}

/**
 * 卡片 8 個角（正反兩面、含厚度）投影到「離鏡頭 1 的平面」上的外框（+y 上）。
 * 圓角卡片的方角頂點在卡外，所以這個外框一定包住整張卡（0° 時剛好貼齊）。
 * boxes（T-411）：看得到的那一面的破框層方框四角也算進去。
 * s.bounds（T-806）：有給就改用這個盒子的 8 個角（透明卡套）；破框層照舊在卡面上。
 */
function cardViewBounds(s: PickScene, boxes: readonly FaceBox[] = []): { left: number; right: number; bottom: number; top: number } {
  const { halfW, halfH } = s.bounds ?? s.outline;
  const halfT = s.thickness / 2;
  const boxHalfT = (s.bounds?.thickness ?? s.thickness) / 2;
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = toWorld([sx * halfW, sy * halfH, sz * boxHalfT], s);
        const depth = s.cameraZ - p[2];
        if (!(depth > 0)) throw new Error('卡片跑到鏡頭後面，無法擷取');
        const x = p[0] / depth;
        const y = p[1] / depth;
        left = Math.min(left, x);
        right = Math.max(right, x);
        bottom = Math.min(bottom, y);
        top = Math.max(top, y);
      }
  for (const { face, box } of boxes) {
    if (!breakoutShown(face, s)) continue;
    const z = face === 'front' ? halfT : -halfT;
    for (const bx of [box.left, box.right])
      for (const by of [box.bottom, box.top]) {
        const p = toWorld([face === 'front' ? bx : -bx, by, z], s);
        const depth = s.cameraZ - p[2];
        if (!(depth > 0)) continue;
        left = Math.min(left, p[0] / depth);
        right = Math.max(right, p[0] / depth);
        bottom = Math.min(bottom, p[1] / depth);
        top = Math.max(top, p[1] / depth);
      }
  }
  return { left, right, bottom, top };
}

/**
 * 擷取的裁切：卡片 8 個角投影後的外框，四邊各加「外框寬、高取大者」× CAPTURE_MARGIN；
 * 輸出寬＝outputWidth、高照裁切範圍的比例（四捨五入、至少 1），高度取整的差平均分到上下。
 * 回傳的 view offset 讓鏡頭只渲染那一塊（離軸透視、和畫面同一個鏡頭位置與視角）。
 * boxes（T-411）：破框層超出卡片的部分，這個角度看得到的也包進去。
 */
export function captureFrame(s: PickScene, outputWidth: number, boxes: readonly FaceBox[] = []): CaptureFrame {
  if (!Number.isInteger(outputWidth) || outputWidth < 1) throw new Error('擷取寬度要是 1 以上的整數');
  return frameFromBounds(s, outputWidth, cardViewBounds(s, boxes));
}

/** 轉動匯出上下點頭的幅度範圍（度，T-812）：0～25；0＝只有左右（和以前一樣）。ui/logic 的 NOD_DEG 是同一個範圍。 */
export const NOD_RANGE = { min: 0, max: 25 } as const;

/**
 * 轉動匯出第 index 格（共 frames 格、一個循環）的姿勢（T-812；captureTurntable 與取景共用）。
 * 相位 φ＝2π × index ÷ frames（影片每 4 秒一個循環，8／12 秒就是 2／3 個循環，每個循環同樣的姿勢）：
 * 左右 yaw：'turn'＝index × 360 ÷ frames（轉一圈，不含 360°）；'swing'＝−swingDeg × sin φ（先往左）；
 * 上下 pitch：basePitchDeg − nodDeg × cos φ（第 0 格最低、半圈最高；nodDeg 0＝固定 basePitchDeg，和以前逐格一樣）。
 * 所以 index＝frames 的姿勢回到第 0 格（轉一圈的左右差一整圈 360°），GIF 頭尾接得上；卡片的左右、上下合起來畫一個橢圓。
 */
export function turntablePose(
  motion: 'turn' | 'swing',
  swingDeg: number,
  nodDeg: number,
  basePitchDeg: number,
  index: number,
  frames: number,
): { yawDeg: number; pitchDeg: number } {
  const phase = (2 * Math.PI * index) / frames;
  const yawDeg = motion === 'swing' ? -swingDeg * Math.sin(phase) : (index * 360) / frames;
  const pitchDeg = nodDeg === 0 ? basePitchDeg : basePitchDeg - nodDeg * Math.cos(phase);
  return { yawDeg, pitchDeg };
}

/** 整段取景沿著姿勢的路徑取樣的格數（每 3° 相位一個，0°／90°／180°／270° 都剛好取到）。 */
const FRAME_PATH_SAMPLES = 120;

/** 每 5° 投影含厚度的 8 個角，取外框聯集後一次留邊；高度取偶數、上下對稱補邊。
 * 指定 swingDeg 時只取 ±swingDeg（含兩端與 0°），否則取整圈；所有畫格共用同一個裁切。
 * boxesAt（T-411）：那個角度破框層超出卡片的部分（位移照那個角度算），每個取樣角度都包進去。
 * nodDeg（T-812，0～25，預設 0）：轉動時上下點頭的幅度。大於 0 時改沿著 turntablePose 的整條路徑（s.pitchDeg 是基準俯仰角）
 * 取樣，每個姿勢（左右＋上下）都包進去，boxesAt 也拿到那一格的上下角度（視差位移跟著上下角度變）；0 或省略＝和以前完全一樣。 */
export function turntableFrame(
  s: PickScene,
  outputWidth: number,
  swingDeg?: number,
  boxesAt?: (yawDeg: number, pitchDeg: number) => readonly FaceBox[],
  nodDeg = 0,
): CaptureFrame {
  if (!Number.isInteger(outputWidth) || outputWidth < 1) throw new Error('擷取寬度要是 1 以上的整數');
  if (!Number.isFinite(s.pitchDeg)) throw new Error('俯仰角要是有限數字');
  if (swingDeg !== undefined && (!Number.isFinite(swingDeg) || swingDeg < 5 || swingDeg > 60)) {
    throw new Error('擺動幅度要是 5～60 的有限數字');
  }
  if (!Number.isFinite(nodDeg) || nodDeg < NOD_RANGE.min || nodDeg > NOD_RANGE.max) {
    throw new Error(`上下點頭幅度要是 ${NOD_RANGE.min}～${NOD_RANGE.max} 的有限數字`);
  }
  /** 取樣到的姿勢；有點頭時整條路徑，沒有時只有左右（俯仰角固定）。 */
  const poses: { yawDeg: number; pitchDeg: number }[] = [];
  if (nodDeg > 0) {
    for (let k = 0; k < FRAME_PATH_SAMPLES; k++) {
      poses.push(turntablePose(swingDeg === undefined ? 'turn' : 'swing', swingDeg ?? 30, nodDeg, s.pitchDeg, k, FRAME_PATH_SAMPLES));
    }
  } else {
    poses.push({ yawDeg: 0, pitchDeg: s.pitchDeg });
    const yaws: number[] = [];
    if (swingDeg === undefined) {
      for (let yaw = 5; yaw < 360; yaw += 5) yaws.push(yaw);
    } else {
      yaws.push(-swingDeg, swingDeg);
      for (let yaw = 5; yaw < swingDeg; yaw += 5) yaws.push(-yaw, yaw);
    }
    for (const yawDeg of yaws) poses.push({ yawDeg, pitchDeg: s.pitchDeg });
  }
  const first = poses[0]!;
  const b = cardViewBounds({ ...s, yawDeg: first.yawDeg, pitchDeg: first.pitchDeg }, boxesAt?.(first.yawDeg, first.pitchDeg));
  for (const { yawDeg, pitchDeg } of poses.slice(1)) {
    const next = cardViewBounds({ ...s, yawDeg, pitchDeg }, boxesAt?.(yawDeg, pitchDeg));
    b.left = Math.min(b.left, next.left);
    b.right = Math.max(b.right, next.right);
    b.bottom = Math.min(b.bottom, next.bottom);
    b.top = Math.max(b.top, next.top);
  }
  return frameFromBounds(s, outputWidth, b, true);
}

function frameFromBounds(
  s: PickScene,
  outputWidth: number,
  b: ReturnType<typeof cardViewBounds>,
  evenHeight = false,
): CaptureFrame {
  const margin = CAPTURE_MARGIN * Math.max(b.right - b.left, b.top - b.bottom);
  const cropW = b.right - b.left + 2 * margin;
  const cropH = b.top - b.bottom + 2 * margin;
  const width = outputWidth;
  const roundedHeight = Math.max(1, Math.round((width * cropH) / cropW));
  const height = roundedHeight + (evenHeight ? roundedHeight % 2 : 0);
  const scale = width / cropW; // 每單位幾像素
  const left = b.left - margin;
  const top = (b.top + b.bottom) / 2 + height / scale / 2;
  // 整個視角在「離鏡頭 1 的平面」上：x −halfX～halfX、y −halfY～halfY
  const halfY = Math.tan((s.vFovDeg / 2) * RAD);
  const halfX = halfY * s.viewAspect;
  return {
    width,
    height,
    viewOffset: {
      fullWidth: 2 * halfX * scale,
      fullHeight: 2 * halfY * scale,
      x: (left + halfX) * scale,
      y: (halfY - top) * scale,
      width,
      height,
    },
  };
}

/** 卡面上一點 → NDC。那一面背對鏡頭時回 null。 */
export function projectCardPoint(face: FaceSide, x: number, y: number, s: PickScene): { x: number; y: number } | null {
  const half = s.thickness / 2;
  const local: Vec3 = face === 'front' ? [x, y, half] : [-x, y, -half];
  const normal = toWorld([0, 0, face === 'front' ? 1 : -1], s);
  const p = toWorld(local, s);
  const camY = s.cameraY ?? 0;
  const toCamera: Vec3 = [-p[0], camY - p[1], s.cameraZ - p[2]];
  if (normal[0] * toCamera[0] + normal[1] * toCamera[1] + normal[2] * toCamera[2] <= 0) return null;
  const depth = s.cameraZ - p[2]; // 鏡頭前方的距離
  if (depth <= 0) return null;
  const tanV = Math.tan((s.vFovDeg / 2) * RAD);
  return { x: p[0] / depth / (tanV * s.viewAspect), y: (p[1] - camY) / depth / tanV + (s.shiftY ?? 0) };
}
