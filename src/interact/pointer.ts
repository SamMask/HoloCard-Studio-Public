// 把滑鼠事件轉成「開始拖／拖了多少／放開／滾輪」事件；不自己算角度（數學在 view.ts、manipulate.ts）。
// 按下時先問 press()「這一下要做什麼」：回傳 LayerDrag＝移動／縮放圖層，之後的 move／up 都交給它；
// 回傳 null（或沒給 press）＝轉卡，行為和以前一樣。
// 圖層拖曳中按 Esc 或指標被取消（pointercancel）＝ cancel（回到拖之前）；轉卡的 pointercancel 照舊當放開。
// 轉卡的按下 → 放開如果沒拖、很快（isClickGesture）＝「點一下」，放開後多呼叫一次 click（點空白處取消選取用；
// T-411 起帶按下的位置：點到卡外的破框層＝選它）。

import { isClickGesture } from './manipulate';

/** 一次圖層拖曳（移動或縮放）。 */
export interface LayerDrag {
  move(clientX: number, clientY: number): void;
  /** 放開：記成復原堆疊的一步。 */
  end(): void;
  /** Esc／指標被取消：回到拖之前。 */
  cancel(): void;
}

export interface PointerHandlers {
  /** 按下時決定這一下要做什麼；回傳 null＝轉卡。沒給＝一律轉卡。 */
  press?(clientX: number, clientY: number): LayerDrag | null;
  /** 沒按著時指標在上面移動（換游標、放大把手用）；離開＝null。 */
  hover?(point: { x: number; y: number } | null): void;
  dragStart(): void;
  drag(dxPx: number, dyPx: number): void;
  dragEnd(): void;
  /**
   * 轉卡的按下沒拖、很快放開（點一下）：dragEnd 之後呼叫，帶按下那一點的螢幕座標。
   * 圖層拖曳（按在框內或把手）、被取消的不會呼叫。
   */
  click?(clientX: number, clientY: number): void;
  /** 滾輪量（像素）；往上滾為負。 */
  wheel(deltaYPx: number): void;
}

const LINE_PX = 16;

export function attachPointer(el: HTMLElement, h: PointerHandlers): void {
  let activeId: number | null = null;
  /** 這次按下是圖層拖曳（null＝轉卡）。 */
  let layer: LayerDrag | null = null;
  let lastX = 0;
  let lastY = 0;
  // 點一下的判斷：按下的位置與時間、按著的過程中離按下點最遠到哪
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let maxMove = 0;

  const release = (id: number) => {
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || activeId !== null) return;
    activeId = e.pointerId;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    downAt = e.timeStamp;
    maxMove = 0;
    el.setPointerCapture(e.pointerId);
    layer = h.press?.(e.clientX, e.clientY) ?? null;
    if (layer) return;
    el.classList.add('is-dragging');
    h.dragStart();
  };
  const onMove = (e: PointerEvent) => {
    if (activeId === null) {
      h.hover?.({ x: e.clientX, y: e.clientY });
      return;
    }
    if (e.pointerId !== activeId) return;
    if (layer) {
      layer.move(e.clientX, e.clientY);
      return;
    }
    maxMove = Math.max(maxMove, Math.hypot(e.clientX - downX, e.clientY - downY));
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx !== 0 || dy !== 0) h.drag(dx, dy);
  };
  const finish = (e: PointerEvent, cancelled: boolean, canClick = true) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    release(e.pointerId);
    if (layer) {
      const l = layer;
      layer = null;
      if (cancelled) l.cancel();
      else l.end();
      h.hover?.({ x: e.clientX, y: e.clientY });
      return;
    }
    el.classList.remove('is-dragging');
    h.dragEnd();
    maxMove = Math.max(maxMove, Math.hypot(e.clientX - downX, e.clientY - downY));
    if (canClick && isClickGesture(maxMove, e.timeStamp - downAt)) h.click?.(downX, downY);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    h.wheel(e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * LINE_PX : e.deltaY);
  };
  // 捕獲階段先收：圖層拖曳中的 Esc 只取消拖曳，不再觸發畫面其他的 Esc（例如確認框的「保留原本的」）
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !layer || activeId === null) return;
    e.preventDefault();
    e.stopPropagation();
    release(activeId);
    activeId = null;
    const l = layer;
    layer = null;
    l.cancel();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', (e) => finish(e, false));
  el.addEventListener('pointercancel', (e) => finish(e, layer !== null, false));
  el.addEventListener('pointerleave', () => {
    if (activeId === null) h.hover?.(null);
  });
  el.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey, true);
}
