// 直接在卡上調圖層（DESIGN §3）的數學：選取框在卡面上的哪裡、按下去要做什麼（移動／縮放／轉卡）、
// 拖了多少 → 新的 x／y／scale。純函式：不碰 DOM、three.js，也不 import model（interact 不依賴別的模組）。
//
// 卡面座標＝卡寬單位、卡片中心為 0、看著那一面 +x 右 +y 上（背面不鏡像，SCHEMA §1）；螢幕座標＝client 像素。
// 卡面上的點由呼叫端用 render 的 planePoint 取得（射線打到那一面所在的無限平面，拖到卡外也能算）；
// 框四角的螢幕位置由呼叫端用 projectCardPoint 投影。

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 圖層在卡面上「看到的」矩形：中心＝位置＋目前的視差位移，w／h＝render 的 layerSize（卡寬單位）。 */
export interface LayerRect {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

/** 四角（看著那一面）：0 左上、1 右上、2 右下、3 左下。 */
export type Corner = 0 | 1 | 2 | 3;

export type Press =
  | { readonly kind: 'rotate' }
  | { readonly kind: 'move' }
  | { readonly kind: 'scale'; readonly corner: Corner };

export type PressCursor = 'grab' | 'move' | 'nwse-resize' | 'nesw-resize';

/** 把手的感應半徑（螢幕像素）：離角點這麼近就算按到把手。 */
export const HANDLE_HIT_PX = 14;
/** 圖層位置與大小的範圍：和 SCHEMA §1（model/limits 的 RANGE）一樣，model 也會再夾一次；測試檢查兩邊一致。 */
export const POSITION_LIMIT = 1;
export const SCALE_MIN = 0.05;
export const SCALE_MAX = 4;
/** 縮放時「到中心的距離」最少算這麼多（卡寬單位）：按在中心附近也不會一動就放大幾十倍、不會除以 0。 */
export const MIN_SCALE_REF = 0.02;

/** 「點一下」：按下到放開，過程中離按下的點最遠不超過這麼多像素（含）…… */
export const CLICK_MAX_MOVE_PX = 4;
/** ……而且不超過這麼多毫秒（含）。 */
export const CLICK_MAX_MS = 300;

const ROTATE: Press = { kind: 'rotate' };
const MOVE: Press = { kind: 'move' };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function layerRect(pos: Point, offset: Point, size: { w: number; h: number }): LayerRect {
  return { cx: pos.x + offset.x, cy: pos.y + offset.y, w: size.w, h: size.h };
}

/** 框的四角（卡面座標），順序見 Corner。 */
export function rectCorners(r: LayerRect): [Point, Point, Point, Point] {
  const hw = r.w / 2;
  const hh = r.h / 2;
  return [
    { x: r.cx - hw, y: r.cy + hh },
    { x: r.cx + hw, y: r.cy + hh },
    { x: r.cx + hw, y: r.cy - hh },
    { x: r.cx - hw, y: r.cy - hh },
  ];
}

/** 卡面上的點在不在框裡（邊上算裡面）。 */
export function insideRect(r: LayerRect, p: Point): boolean {
  return Math.abs(p.x - r.cx) <= r.w / 2 && Math.abs(p.y - r.cy) <= r.h / 2;
}

export interface PressInput {
  /** 指標的螢幕座標。 */
  readonly pointer: Point;
  /** 選中圖層的框；沒選中、或框沒顯示（轉動中、那一面背對鏡頭）＝null。 */
  readonly rect: LayerRect | null;
  /** rect 四角投影到螢幕（rectCorners 的順序）；投影不到＝null。 */
  readonly cornersPx: readonly Point[] | null;
  /** 指標打到那一面所在平面的點（卡面座標）；打不到＝null。 */
  readonly facePoint: Point | null;
}

/**
 * 按下（或滑過）時決定這一下要做什麼：四角把手附近 → 縮放；框內 → 移動；其他 → 轉卡。
 * 把手用螢幕距離判斷（轉了角度也跟著畫面上的角走）；框在螢幕上很小時，框內的把手感應範圍縮到短邊的 1/4，
 * 中間至少留一半能按住移動。
 */
export function classifyPress({ pointer, rect, cornersPx, facePoint }: PressInput): Press {
  if (!rect || !cornersPx || cornersPx.length !== 4) return ROTATE;
  const inside = facePoint !== null && insideRect(rect, facePoint);
  let minSide = Infinity;
  for (let i = 0; i < 4; i++) minSide = Math.min(minSide, dist(cornersPx[i], cornersPx[(i + 1) % 4]));
  const radius = inside ? Math.min(HANDLE_HIT_PX, minSide / 4) : HANDLE_HIT_PX;

  let corner = -1;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = dist(pointer, cornersPx[i]);
    if (d <= radius && d < best) {
      best = d;
      corner = i;
    }
  }
  if (corner >= 0) return { kind: 'scale', corner: corner as Corner };
  return inside ? MOVE : ROTATE;
}

/** 游標：框外 grab、框內 move、四角看螢幕上「這個角 → 對角」的方向用斜向 resize。 */
export function pressCursor(press: Press, cornersPx: readonly Point[] | null): PressCursor {
  if (press.kind === 'rotate') return 'grab';
  if (press.kind === 'move') return 'move';
  const a = cornersPx?.[press.corner];
  const b = cornersPx?.[(press.corner + 2) % 4];
  if (!a || !b) return press.corner % 2 === 0 ? 'nwse-resize' : 'nesw-resize';
  // 螢幕 y 向下：左上 → 右下（dx、dy 同號）＝ nwse
  return (b.x - a.x) * (b.y - a.y) >= 0 ? 'nwse-resize' : 'nesw-resize';
}

/** 移動：新位置＝起點＋（目前的點 − 按下的點），夾在 ±POSITION_LIMIT；算不出有限數字時保持起點。 */
export function moveLayer(start: Point, down: Point, now: Point): { x: number; y: number } {
  const x = start.x + now.x - down.x;
  const y = start.y + now.y - down.y;
  return {
    x: Number.isFinite(x) ? clamp(x, -POSITION_LIMIT, POSITION_LIMIT) : start.x,
    y: Number.isFinite(y) ? clamp(y, -POSITION_LIMIT, POSITION_LIMIT) : start.y,
  };
}

/**
 * 縮放：以框的中心（看到的中心）等比縮放，新 scale＝起點 × (目前點到中心距離 ÷ 按下點到中心距離)，夾在 SCALE_MIN～SCALE_MAX。
 * 兩個距離都至少算 MIN_SCALE_REF：按在中心附近時剛按下不會跳、拖一點點只變一點點。
 */
export function scaleLayer(startScale: number, center: Point, down: Point, now: Point): number {
  const d0 = Math.max(dist(down, center), MIN_SCALE_REF);
  const d1 = Math.max(dist(now, center), MIN_SCALE_REF);
  const next = startScale * (d1 / d0);
  return clamp(Number.isFinite(next) ? next : startScale, SCALE_MIN, SCALE_MAX);
}

/**
 * 這一下是不是「點一下」（沒有拖、很快放開）：點預覽區空白處取消選取用。
 * maxMovePx＝按著的過程中，指標離按下那一點最遠到哪（不是只看放開的位置，拖出去又拖回來也算拖）；
 * elapsedMs＝按下到放開的時間。不是有限數字（或時間倒退）一律不算，寧可不取消選取。
 */
export function isClickGesture(maxMovePx: number, elapsedMs: number): boolean {
  return Number.isFinite(maxMovePx) && Number.isFinite(elapsedMs) && elapsedMs >= 0 && maxMovePx <= CLICK_MAX_MOVE_PX && elapsedMs <= CLICK_MAX_MS;
}
