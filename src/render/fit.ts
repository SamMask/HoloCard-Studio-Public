// 卡片尺寸（以卡寬為 1）、鏡頭距離、貼圖與卡框的幾何。純數學，不 import three.js（方便在 node 測試）。
// 卡片比例（T-807）：這裡只收「卡高」cardH（卡寬＝1 時的高＝model/aspect.ts 的 aspectHeight(card)），不認比例名字；
// 橫式（cardH < 1）、直式都用同一套算式。

import { aspectHeight } from '../model/aspect';

export const CARD_WIDTH = 1;
/** 卡身厚度：固定常數，卡寬的 1.5%（SCHEMA §1）。 */
export const CARD_THICKNESS = 0.015;
/** 圓角範圍（SCHEMA §1：0～0.12）。 */
export const MAX_CORNER_RADIUS = 0.12;

/** 還沒拿到卡片之前先用的卡高（標準卡）。 */
export const DEFAULT_CARD_H = aspectHeight({ aspect: 'standard' });

const RAD = Math.PI / 180;

/** 以中心為原點的圓角矩形：半寬、半高、圓角半徑（卡寬單位）。 */
export interface RoundedRect {
  halfW: number;
  halfH: number;
  r: number;
}

/** 包住卡片（或透明卡套）的盒子：半寬、半高、厚度（卡寬單位）。鏡頭距離（cameraDistance）與擷取的裁切（pick.ts）都用它。 */
export interface FrameBox {
  halfW: number;
  halfH: number;
  thickness: number;
}

/** 卡片輪廓（卡面網格的形狀、卡框的外緣）：cardH＝卡高（aspectHeight）。圓角夾在 0～0.12，壞資料也不會讓網格變形。 */
export function cardOutline(cardH: number, cornerRadius: number): RoundedRect {
  const r = Math.min(MAX_CORNER_RADIUS, Math.max(0, Number.isFinite(cornerRadius) ? cornerRadius : 0));
  return { halfW: CARD_WIDTH / 2, halfH: (CARD_WIDTH * cardH) / 2, r };
}

/** 卡片本身的盒子（cardH＝卡高）。 */
export function cardBox(cardH: number): FrameBox {
  return { halfW: CARD_WIDTH / 2, halfH: (CARD_WIDTH * cardH) / 2, thickness: CARD_THICKNESS };
}

/** 卡框內緣：外緣（卡片輪廓）往內縮 width；內緣圓角＝max(0, 圓角 − width)，所以直邊和圓角處框寬都一樣。 */
export function frameInner(outline: RoundedRect, width: number): RoundedRect {
  return { halfW: outline.halfW - width, halfH: outline.halfH - width, r: Math.max(0, outline.r - width) };
}

/** 點 (x, y) 到圓角矩形邊緣的帶號距離：裡面是負的、外面是正的。shader 裡的卡框用同一個公式。 */
export function roundedRectSdf(x: number, y: number, rect: RoundedRect): number {
  const qx = Math.abs(x) - (rect.halfW - rect.r);
  const qy = Math.abs(y) - (rect.halfH - rect.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rect.r;
}

/** 包住整個盒子（卡片或卡套，含厚度）的球半徑：不管怎麼轉，盒子都在這顆球裡（橫式、直式都一樣）。 */
export function boundingRadius(box: FrameBox): number {
  return Math.hypot(box.halfW, box.halfH, box.thickness / 2);
}

/** 半徑 radius 的球剛好塞進透視鏡頭（垂直視角 vFovDeg、寬高比 aspect）時，鏡頭到球心的距離。 */
export function fitDistance(vFovDeg: number, aspect: number, radius: number): number {
  const halfV = (vFovDeg / 2) * RAD;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  return radius / Math.sin(Math.min(halfV, halfH));
}

/**
 * 圖層在卡面上的大小（卡寬單位）。scale 1＝圖寬等於卡寬（SCHEMA §1 的 Layer.scale）；
 * 碰到卡邊的圖可以四邊多畫一圈出血、用 scale 放大，轉動位移時斷口仍在卡外（被圓角輪廓遮住）。
 */
export function layerSize(naturalWidth: number, naturalHeight: number, scale = 1): { w: number; h: number } {
  const w = CARD_WIDTH * scale;
  return { w, h: (w * naturalHeight) / naturalWidth };
}

/**
 * zoom 1＝最近（卡片任何角度都完整可見）；zoom 越小越遠。box＝要放進畫面的盒子：卡片（cardBox），
 * 開著透明卡套時給卡套的盒子（sleeve.ts 的 sleeveBounds，比卡片大一圈，T-806／T-807）。
 * 用外接球塞進寬、高比較緊的那一邊，所以橫式卡（寬比高大）在窄的預覽區也照寬退、不會被切掉；比例越長的卡，鏡頭退得越遠。
 * reach（T-411 破框層，breakout.ts 的 framingReach）：超出卡片的部分離中心最遠的半寬、半高（卡寬單位）；
 * 給了就再退到正面看時上下、左右都放得下（各自用 sin 留一點透視的邊；卡片小一點，超出的部分不被畫布切掉）。
 */
export function cameraDistance(
  vFovDeg: number,
  viewAspect: number,
  zoom: number,
  box: FrameBox,
  reach?: { x: number; y: number } | null,
): number {
  let fit = fitDistance(vFovDeg, viewAspect, boundingRadius(box));
  if (reach) {
    const halfV = (vFovDeg / 2) * RAD;
    const halfH = Math.atan(Math.tan(halfV) * viewAspect);
    const x = Number.isFinite(reach.x) ? Math.max(0, reach.x) : 0;
    const y = Number.isFinite(reach.y) ? Math.max(0, reach.y) : 0;
    fit = Math.max(fit, y / Math.sin(halfV), x / Math.sin(halfH));
  }
  return fit / zoom;
}

/**
 * cover 貼圖：圖保持長寬比、蓋滿卡面、多的平均裁掉。
 * 回傳把卡面 UV（0～1）換成圖片 UV 的係數：圖片 uv ＝ 卡面 uv × scale ＋ offset。
 */
export function coverUv(
  imageWidth: number,
  imageHeight: number,
  faceWidth: number,
  faceHeight: number,
): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
  const imageAspect = imageHeight / imageWidth;
  const faceAspect = faceHeight / faceWidth;
  // 圖比卡面「橫」→ 上下貼滿、左右裁；反之左右貼滿、上下裁
  const scaleX = imageAspect < faceAspect ? imageAspect / faceAspect : 1;
  const scaleY = imageAspect < faceAspect ? 1 : faceAspect / imageAspect;
  return { scaleX, scaleY, offsetX: (1 - scaleX) / 2, offsetY: (1 - scaleY) / 2 };
}
