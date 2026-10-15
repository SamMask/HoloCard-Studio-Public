// 直接在卡上調圖層（DESIGN §3）的數學：src/interact/manipulate.ts。
// 判斷「按下去要做什麼」用的是真正的投影（render/pick 的 projectCardPoint／planePoint），
// 所以也順便驗證：轉了角度、背面、視差位移時，框和把手都在畫面上看到的位置。
import { describe, expect, it } from 'vitest';
import {
  classifyPress,
  CLICK_MAX_MOVE_PX,
  CLICK_MAX_MS,
  HANDLE_HIT_PX,
  insideRect,
  isClickGesture,
  layerRect,
  MIN_SCALE_REF,
  moveLayer,
  POSITION_LIMIT,
  pressCursor,
  rectCorners,
  scaleLayer,
  SCALE_MAX,
  SCALE_MIN,
  type LayerRect,
  type Point,
  type PressInput,
} from '../src/interact/manipulate';
import { parallaxOffset } from '../src/interact/parallax';
import { RANGE } from '../src/model/limits';
import { ASPECT_HEIGHT, type FaceSide } from '../src/model/types';
import { CARD_THICKNESS, cardOutline, layerSize } from '../src/render/fit';
import { clientToNdc, ndcToClient, planePoint, projectCardPoint, type PickScene } from '../src/render/pick';

/** 和實際畫面差不多的預覽區：800×600 像素、鏡頭 30°。 */
const RECT = { left: 0, top: 0, width: 800, height: 600 };

function scene(yawDeg: number, pitchDeg: number): PickScene {
  return {
    vFovDeg: 30,
    viewAspect: RECT.width / RECT.height,
    cameraZ: 3.2,
    yawDeg,
    pitchDeg,
    outline: cardOutline(ASPECT_HEIGHT.standard, 0.05),
    thickness: CARD_THICKNESS,
  };
}

/** 卡面點 → 螢幕像素（那一面背對＝null）。 */
function toScreen(face: FaceSide, p: Point, s: PickScene): Point | null {
  const ndc = projectCardPoint(face, p.x, p.y, s);
  return ndc && ndcToClient(ndc, RECT);
}

/** 螢幕像素 → 那一面所在平面上的點。 */
function toFace(face: FaceSide, px: Point, s: PickScene): Point | null {
  const ndc = clientToNdc(px.x, px.y, RECT);
  return planePoint(face, ndc.x, ndc.y, s);
}

/** 組一個 classifyPress 的輸入：和 main 的做法一樣（框四角投影到螢幕、指標打到那一面的平面）。 */
function pressAt(face: FaceSide, rect: LayerRect | null, pointer: Point, s: PickScene): PressInput {
  const cornersPx = rect ? rectCorners(rect).map((c) => toScreen(face, c, s)) : null;
  return {
    pointer,
    rect,
    cornersPx: cornersPx && cornersPx.every((c) => c !== null) ? (cornersPx as Point[]) : null,
    facePoint: toFace(face, pointer, s),
  };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** 一張 600×800 的圖，scale 0.5、放在 (0.1, -0.05)、沒有視差位移。 */
const BOX: LayerRect = layerRect({ x: 0.1, y: -0.05 }, { x: 0, y: 0 }, layerSize(600, 800, 0.5));

describe('選取框在卡面上的位置', () => {
  it('中心＝位置＋視差位移，大小＝layerSize', () => {
    const r = layerRect({ x: 0.2, y: -0.1 }, { x: 0.03, y: -0.02 }, layerSize(1000, 500, 0.8));
    expect(r.cx).toBeCloseTo(0.23, 12);
    expect(r.cy).toBeCloseTo(-0.12, 12);
    expect(r.w).toBeCloseTo(0.8, 12);
    expect(r.h).toBeCloseTo(0.4, 12);
  });

  it('四角順序：左上、右上、右下、左下（看著那一面，+y 向上）', () => {
    const [tl, tr, br, bl] = rectCorners({ cx: 0, cy: 0, w: 0.4, h: 0.6 });
    expect(tl).toEqual({ x: -0.2, y: 0.3 });
    expect(tr).toEqual({ x: 0.2, y: 0.3 });
    expect(br).toEqual({ x: 0.2, y: -0.3 });
    expect(bl).toEqual({ x: -0.2, y: -0.3 });
  });

  it('insideRect：邊上算裡面、外面一點點不算', () => {
    const r = { cx: 0, cy: 0, w: 0.4, h: 0.6 };
    expect(insideRect(r, { x: 0.2, y: 0.3 })).toBe(true);
    expect(insideRect(r, { x: 0, y: 0 })).toBe(true);
    expect(insideRect(r, { x: 0.2001, y: 0 })).toBe(false);
    expect(insideRect(r, { x: 0, y: -0.3001 })).toBe(false);
  });
});

describe('按下去要做什麼：移動／縮放／轉卡', () => {
  const s0 = scene(0, 0);

  it('沒選中任何圖層 → 一律轉卡', () => {
    const center = toScreen('front', { x: BOX.cx, y: BOX.cy }, s0)!;
    expect(classifyPress(pressAt('front', null, center, s0))).toEqual({ kind: 'rotate' });
  });

  it('框內 → 移動；框外 → 轉卡', () => {
    const center = toScreen('front', { x: BOX.cx, y: BOX.cy }, s0)!;
    expect(classifyPress(pressAt('front', BOX, center, s0))).toEqual({ kind: 'move' });
    // 框右邊外面（卡片上，但不在框裡）
    const outside = toScreen('front', { x: BOX.cx + BOX.w / 2 + 0.08, y: BOX.cy }, s0)!;
    expect(classifyPress(pressAt('front', BOX, outside, s0))).toEqual({ kind: 'rotate' });
    // 卡片外面很遠
    expect(classifyPress(pressAt('front', BOX, { x: 5, y: 5 }, s0))).toEqual({ kind: 'rotate' });
  });

  it('四角附近（螢幕上 ≤ 14px，框內框外都算）→ 縮放，回報是哪個角', () => {
    const corners = rectCorners(BOX).map((c) => toScreen('front', c, s0)!);
    corners.forEach((c, i) => {
      // 角的外側 10px（框外）
      const out = { x: c.x + (i === 1 || i === 2 ? 7 : -7), y: c.y + (i === 2 || i === 3 ? 7 : -7) };
      expect(dist(out, c)).toBeLessThanOrEqual(HANDLE_HIT_PX);
      expect(classifyPress(pressAt('front', BOX, out, s0))).toEqual({ kind: 'scale', corner: i });
      // 角的內側 8px（框內）
      const inn = { x: c.x + (i === 1 || i === 2 ? -5.6 : 5.6), y: c.y + (i === 2 || i === 3 ? -5.6 : 5.6) };
      expect(classifyPress(pressAt('front', BOX, inn, s0))).toEqual({ kind: 'scale', corner: i });
    });
  });

  it('離角 > 14px：框外 → 轉卡、框內 → 移動', () => {
    const tr = toScreen('front', rectCorners(BOX)[1], s0)!;
    expect(classifyPress(pressAt('front', BOX, { x: tr.x + 12, y: tr.y - 12 }, s0))).toEqual({ kind: 'rotate' });
    expect(classifyPress(pressAt('front', BOX, { x: tr.x - 12, y: tr.y + 12 }, s0))).toEqual({ kind: 'move' });
  });

  it('角點用投影後的螢幕座標判斷：轉了角度時，把手跟著畫面上的角走', () => {
    const s = scene(40, -25);
    const cornerFace = rectCorners(BOX)[1];
    const projected = toScreen('front', cornerFace, s)!;
    const flat = toScreen('front', cornerFace, s0)!; // 沒轉角度時的位置
    expect(dist(projected, flat)).toBeGreaterThan(1.5 * HANDLE_HIT_PX);
    expect(classifyPress(pressAt('front', BOX, { x: projected.x + 6, y: projected.y - 6 }, s))).toEqual({
      kind: 'scale',
      corner: 1,
    });
    // 「沒轉時的角」在轉了以後不是把手
    expect(classifyPress(pressAt('front', BOX, flat, s)).kind).not.toBe('scale');
  });

  it('那一面背對鏡頭（投影不到）→ 轉卡', () => {
    const s = scene(180, 0); // 正面背對
    const input = pressAt('front', BOX, { x: 400, y: 300 }, s);
    expect(input.cornersPx).toBeNull();
    expect(classifyPress(input)).toEqual({ kind: 'rotate' });
  });

  it('框在螢幕上很小：框中間按住仍然是移動（把手不會吃掉整個框）', () => {
    const tiny = layerRect({ x: 0, y: 0 }, { x: 0, y: 0 }, layerSize(100, 100, 0.05));
    const corners = rectCorners(tiny).map((c) => toScreen('front', c, s0)!);
    expect(dist(corners[0], corners[1])).toBeLessThan(2 * HANDLE_HIT_PX); // 真的很小
    const center = toScreen('front', { x: 0, y: 0 }, s0)!;
    expect(classifyPress(pressAt('front', tiny, center, s0))).toEqual({ kind: 'move' });
    // 框外、角的旁邊還是縮放
    const out = { x: corners[1].x + 6, y: corners[1].y - 6 };
    expect(classifyPress(pressAt('front', tiny, out, s0))).toEqual({ kind: 'scale', corner: 1 });
  });

  it('視差位移下：框在「看到的位置」，按沒加位移的位置不算框內', () => {
    const s = scene(40, 10);
    const offset = parallaxOffset('front', 40, 10, 100);
    expect(offset.x).toBeGreaterThan(0.1);
    const size = layerSize(500, 500, 0.08);
    const shifted = layerRect({ x: 0, y: 0 }, offset, size);
    // 看到的中心 → 移動
    const seen = toScreen('front', { x: shifted.cx, y: shifted.cy }, s)!;
    expect(classifyPress(pressAt('front', shifted, seen, s))).toEqual({ kind: 'move' });
    // 沒加位移的中心（圖層的 x／y）在看到的框外面 → 轉卡
    const raw = toScreen('front', { x: 0, y: 0 }, s)!;
    expect(classifyPress(pressAt('front', shifted, raw, s))).toEqual({ kind: 'rotate' });
  });

  it('背面：框和把手照「看著背面」的座標（不鏡像）', () => {
    const s = scene(180, 0);
    const box = layerRect({ x: 0.2, y: 0 }, { x: 0, y: 0 }, layerSize(400, 400, 0.2));
    // 背面的 +x 在螢幕右邊
    const c = toScreen('back', { x: box.cx, y: box.cy }, s)!;
    expect(c.x).toBeGreaterThan(RECT.width / 2);
    expect(classifyPress(pressAt('back', box, c, s))).toEqual({ kind: 'move' });
    // 右上角（看著背面）在螢幕上也是右上
    const tr = toScreen('back', rectCorners(box)[1], s)!;
    expect(tr.x).toBeGreaterThan(c.x);
    expect(tr.y).toBeLessThan(c.y);
    expect(classifyPress(pressAt('back', box, { x: tr.x + 5, y: tr.y - 5 }, s))).toEqual({ kind: 'scale', corner: 1 });
  });
});

describe('游標', () => {
  const s0 = scene(0, 0);
  const corners = rectCorners(BOX).map((c) => toScreen('front', c, s0)!);

  it('框外 grab、框內 move', () => {
    expect(pressCursor({ kind: 'rotate' }, corners)).toBe('grab');
    expect(pressCursor({ kind: 'move' }, corners)).toBe('move');
  });

  it('左上／右下 nwse-resize；右上／左下 nesw-resize（看螢幕上的對角方向）', () => {
    expect(pressCursor({ kind: 'scale', corner: 0 }, corners)).toBe('nwse-resize');
    expect(pressCursor({ kind: 'scale', corner: 2 }, corners)).toBe('nwse-resize');
    expect(pressCursor({ kind: 'scale', corner: 1 }, corners)).toBe('nesw-resize');
    expect(pressCursor({ kind: 'scale', corner: 3 }, corners)).toBe('nesw-resize');
  });
});

describe('移動', () => {
  it('新位置＝起點＋（目前的點 − 按下的點）', () => {
    const p = moveLayer({ x: 0.1, y: -0.2 }, { x: 0.3, y: 0.3 }, { x: 0.45, y: 0.1 });
    expect(p.x).toBeCloseTo(0.25, 12);
    expect(p.y).toBeCloseTo(-0.4, 12);
  });

  it('夾在 -1～1（和 model 的範圍一樣）', () => {
    expect(POSITION_LIMIT).toBe(RANGE.position.max);
    expect(-POSITION_LIMIT).toBe(RANGE.position.min);
    expect(moveLayer({ x: 0.9, y: -0.9 }, { x: 0, y: 0 }, { x: 0.5, y: -0.5 })).toEqual({ x: 1, y: -1 });
    expect(moveLayer({ x: -0.9, y: 0.9 }, { x: 0, y: 0 }, { x: -3, y: 3 })).toEqual({ x: -1, y: 1 });
  });

  it('沒動＝原位置', () => {
    const p = moveLayer({ x: 0.3, y: 0.4 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 });
    expect(p.x).toBeCloseTo(0.3, 12);
    expect(p.y).toBeCloseTo(0.4, 12);
  });

  it('不是有限數字時保持原位置', () => {
    expect(moveLayer({ x: 0.3, y: 0.4 }, { x: 0, y: 0 }, { x: NaN, y: Infinity })).toEqual({ x: 0.3, y: 0.4 });
  });

  it('背面：螢幕往右拖＝圖往右（x 變大，不鏡像）', () => {
    const s = scene(180, 0);
    const down = toFace('back', { x: 400, y: 300 }, s)!;
    const now = toFace('back', { x: 460, y: 300 }, s)!;
    const p = moveLayer({ x: 0, y: 0 }, down, now);
    expect(p.x).toBeGreaterThan(0.05);
    expect(Math.abs(p.y)).toBeLessThan(1e-9);
    // 往上拖＝圖往上
    const up = toFace('back', { x: 400, y: 250 }, s)!;
    expect(moveLayer({ x: 0, y: 0 }, down, up).y).toBeGreaterThan(0.05);
  });

  it('拖到卡片外面也能繼續算（射線打到無限平面）', () => {
    const s = scene(0, 0);
    const down = toFace('front', { x: 400, y: 300 }, s)!;
    const far = toFace('front', { x: 640, y: 300 }, s)!; // 卡片右邊外面
    expect(far.x).toBeGreaterThan(0.5);
    expect(moveLayer({ x: 0, y: 0 }, down, far).x).toBeCloseTo(far.x - down.x, 9);
  });

  it('移動後框還是跟著指標：按下的點在框內的相對位置不變', () => {
    const s = scene(-20, 15);
    const start = { x: 0.05, y: 0.1 };
    const offset = parallaxOffset('front', -20, 15, 60);
    const size = layerSize(800, 600, 0.4);
    const r0 = layerRect(start, offset, size);
    const grabPx = toScreen('front', { x: r0.cx + 0.03, y: r0.cy - 0.02 }, s)!;
    const down = toFace('front', grabPx, s)!;
    const nowPx = { x: grabPx.x + 40, y: grabPx.y + 25 };
    const moved = moveLayer(start, down, toFace('front', nowPx, s)!);
    const r1 = layerRect(moved, offset, size);
    const grabAfter = toScreen('front', { x: r1.cx + 0.03, y: r1.cy - 0.02 }, s)!;
    expect(grabAfter.x).toBeCloseTo(nowPx.x, 6);
    expect(grabAfter.y).toBeCloseTo(nowPx.y, 6);
  });
});

describe('縮放', () => {
  const center = { x: 0.1, y: -0.05 };

  it('以中心等比：新 scale＝起點 × (目前距離 ÷ 按下距離)', () => {
    const down = { x: center.x + 0.2, y: center.y + 0.15 }; // 距離 0.25
    expect(scaleLayer(0.5, center, down, { x: center.x + 0.4, y: center.y + 0.3 })).toBeCloseTo(1, 12);
    expect(scaleLayer(0.5, center, down, { x: center.x + 0.1, y: center.y + 0.075 })).toBeCloseTo(0.25, 12);
    // 只看距離、不看方向（往別的方向拉一樣長，大小一樣）
    expect(scaleLayer(0.5, center, down, { x: center.x - 0.25, y: center.y })).toBeCloseTo(0.5, 12);
  });

  it('沒動＝原大小', () => {
    const down = { x: 0.4, y: 0.3 };
    expect(scaleLayer(0.7, center, down, down)).toBeCloseTo(0.7, 12);
  });

  it('夾在 0.05～4（和 model 的範圍一樣）', () => {
    expect(SCALE_MIN).toBe(RANGE.scale.min);
    expect(SCALE_MAX).toBe(RANGE.scale.max);
    const down = { x: center.x + 0.3, y: center.y };
    expect(scaleLayer(2, center, down, { x: center.x + 3, y: center.y })).toBe(SCALE_MAX);
    expect(scaleLayer(0.2, center, down, { x: center.x + 0.001, y: center.y })).toBe(SCALE_MIN);
  });

  it('按在中心附近（距離很小）不會爆：剛按下不變、拖一點點只變一點點、都是有限數字', () => {
    const down = { x: center.x + 1e-9, y: center.y };
    expect(scaleLayer(0.6, center, down, down)).toBeCloseTo(0.6, 9);
    expect(scaleLayer(0.6, center, center, center)).toBeCloseTo(0.6, 9);
    const nudged = scaleLayer(0.6, center, down, { x: center.x + MIN_SCALE_REF * 1.1, y: center.y });
    expect(Number.isFinite(nudged)).toBe(true);
    expect(nudged).toBeCloseTo(0.66, 9);
  });

  it('不是有限數字時保持原大小（夾在範圍內）', () => {
    expect(scaleLayer(0.6, center, { x: 0.5, y: 0.5 }, { x: NaN, y: 0 })).toBe(0.6);
  });

  it('拖角縮放：角跟著指標走（從中心看出去的距離比例）', () => {
    const s = scene(0, 0);
    const box = layerRect({ x: 0, y: 0 }, { x: 0, y: 0 }, layerSize(600, 800, 0.5));
    const tr = rectCorners(box)[1];
    const trPx = toScreen('front', tr, s)!;
    const down = toFace('front', trPx, s)!;
    // 沿對角線往外拖到 1.5 倍
    const target = { x: tr.x * 1.5, y: tr.y * 1.5 };
    const now = toFace('front', toScreen('front', target, s)!, s)!;
    expect(scaleLayer(0.5, { x: box.cx, y: box.cy }, down, now)).toBeCloseTo(0.75, 9);
  });
});

describe('點一下的判斷（點預覽區空白處取消選取，T-309）', () => {
  it('參數：移動不超過 4 像素、不超過 300 毫秒', () => {
    expect(CLICK_MAX_MOVE_PX).toBe(4);
    expect(CLICK_MAX_MS).toBe(300);
  });

  it('幾乎沒動、很快放開＝點一下', () => {
    expect(isClickGesture(0, 0)).toBe(true);
    expect(isClickGesture(1.5, 120)).toBe(true);
  });

  it('邊界：剛好 4 像素、300 毫秒還算；多一點就不算', () => {
    expect(isClickGesture(CLICK_MAX_MOVE_PX, 100)).toBe(true);
    expect(isClickGesture(CLICK_MAX_MOVE_PX + 0.01, 100)).toBe(false);
    expect(isClickGesture(0, CLICK_MAX_MS)).toBe(true);
    expect(isClickGesture(0, CLICK_MAX_MS + 1)).toBe(false);
  });

  it('拖動了（轉卡）不算；按太久（長按）不算', () => {
    expect(isClickGesture(40, 100)).toBe(false);
    expect(isClickGesture(0, 2000)).toBe(false);
  });

  it('不是有限數字、或時間倒退，一律不算（寧可不取消選取）', () => {
    expect(isClickGesture(NaN, 100)).toBe(false);
    expect(isClickGesture(0, NaN)).toBe(false);
    expect(isClickGesture(Infinity, 100)).toBe(false);
    expect(isClickGesture(0, -5)).toBe(false);
  });
});
