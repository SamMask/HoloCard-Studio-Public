// 用鍵盤操作 3D 預覽區（DESIGN §8.2，T-607）：按鍵 → 「轉卡／縮放／回正／翻面／移動圖層／縮放圖層」的意圖（純函式），
// 以及把一連串的按鍵合成「一步」（連按時每次先 preview，停手 KEY_COMMIT_IDLE_MS 才 commit）。
// 和 pointer.ts 一樣只吐事件：不碰 model、three.js，也不 import ui；轉卡的數學在 view.ts，這裡只決定「按了什麼 → 做什麼」。
//
// 沒選圖層：← → 左右轉 15°、↑ ↓ 上下轉 10°（Shift 5°）；Home 回正面；PageUp／PageDown 或 + − 放大縮小；F 翻面。
// 選中圖層（可以移動的圖層；反光層不能移動，選著它時方向鍵照樣轉卡）：方向鍵移動那一層（1% 卡寬，Shift 5%）、+ − 縮放那一層。
// Delete（直接刪，可以復原）與 Esc（取消選取）在 ui（app.ts），不在這裡。
// 停手才記的那一步（T-607c）：記之前核對身分（editToken：最後一次 preview 之後編輯狀態沒被別人換掉），不是就不記；
// Home、F 之前先記；復原、重做、開始拖曳、換面、被接手前由 main 叫 flush、換卡時叫 cancel。

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  /** 已經被別人處理過（T-607c）：不再理。 */
  defaultPrevented?: boolean;
}

/** ← → 一次轉幾度。 */
export const KEY_YAW_DEG = 15;
/** ↑ ↓ 一次轉幾度。 */
export const KEY_PITCH_DEG = 10;
/** 按住 Shift 時一次轉幾度。 */
export const KEY_FINE_DEG = 5;
/** 方向鍵移動圖層：一次幾個卡寬（1%），Shift 5%。 */
export const KEY_MOVE_STEP = 0.01;
export const KEY_MOVE_BIG = 0.05;
/** + − 縮放圖層：一次乘（除）以幾倍。 */
export const KEY_SCALE_STEP = 1.05;
/** 連按停手多久才記成復原堆疊的一步（同文字輸入 TEXT_IDLE_MS）。 */
export const KEY_COMMIT_IDLE_MS = 600;

/** 圖層位置與大小的範圍：同 manipulate.ts／SCHEMA §1（model 也會再夾一次）。 */
const POSITION_LIMIT = 1;
const SCALE_MIN = 0.05;
const SCALE_MAX = 4;

export type PreviewKeyAction =
  /** 轉卡：yaw、pitch 各加幾度。 */
  | { kind: 'turn'; yaw: number; pitch: number }
  /** 回正面。 */
  | { kind: 'home' }
  /** 縮放卡片：1 放大、−1 縮小。 */
  | { kind: 'zoom'; dir: 1 | -1 }
  /** 翻面。 */
  | { kind: 'flip' }
  /** 移動選中的圖層（卡寬單位，+x 右、+y 上，看著那一面）。 */
  | { kind: 'move'; dx: number; dy: number }
  /** 縮放選中的圖層：乘以 factor。 */
  | { kind: 'scale'; factor: number };

export interface PreviewKeyContext {
  /** 選中了可以移動的圖層（沒選、或選著反光層＝false）。 */
  layerSelected: boolean;
}

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** 按鍵 → 預覽區要做什麼；不是我們的鍵（含 Ctrl／Cmd／Alt 組合、輸入法選字中、已經被處理過的）回 null，讓別人處理。 */
export function previewKeyAction(e: KeyInput, ctx: PreviewKeyContext): PreviewKeyAction | null {
  // 同 ui/logic.ts 的 plainKey（interact 不 import ui，所以這裡自己寫一次）
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented) return null;
  const arrow = ARROWS[e.key];
  if (arrow) {
    const [x, y] = arrow;
    if (ctx.layerSelected) {
      const step = e.shiftKey ? KEY_MOVE_BIG : KEY_MOVE_STEP;
      return { kind: 'move', dx: x * step, dy: y * step };
    }
    // 向右拖 yaw 變大、向下拖 pitch 變大（view.ts dragBy）：→ ↓ 是正的
    return {
      kind: 'turn',
      yaw: x * (e.shiftKey ? KEY_FINE_DEG : KEY_YAW_DEG) + 0,
      pitch: -y * (e.shiftKey ? KEY_FINE_DEG : KEY_PITCH_DEG) + 0,
    };
  }
  switch (e.key) {
    case 'Home':
      return { kind: 'home' };
    case 'f':
    case 'F':
      return { kind: 'flip' };
    case 'PageUp':
      return { kind: 'zoom', dir: 1 };
    case 'PageDown':
      return { kind: 'zoom', dir: -1 };
    case '+':
    case '=':
      return ctx.layerSelected ? { kind: 'scale', factor: KEY_SCALE_STEP } : { kind: 'zoom', dir: 1 };
    case '-':
      return ctx.layerSelected ? { kind: 'scale', factor: 1 / KEY_SCALE_STEP } : { kind: 'zoom', dir: -1 };
    default:
      return null;
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** 去掉 0.01 + 0.02 這種浮點誤差（位置只留到小數 4 位）。 */
const tidy = (v: number) => Math.round(v * 10000) / 10000 + 0;

/** 移動：加上位移、夾在 ±POSITION_LIMIT。 */
export function moveByKey(pos: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  return { x: clamp(tidy(pos.x + dx), -POSITION_LIMIT, POSITION_LIMIT), y: clamp(tidy(pos.y + dy), -POSITION_LIMIT, POSITION_LIMIT) };
}

/** 縮放：乘上倍率、夾在 SCALE_MIN～SCALE_MAX。 */
export function scaleByKey(scale: number, factor: number): number {
  return clamp(scale * factor, SCALE_MIN, SCALE_MAX);
}

// ---- 接線：連按合成一步 ----

/** 圖層改動的內容：移動送完整的 { x, y }（同一組欄位，一連串的按鍵才會合成一步）、縮放送 { scale }。 */
export type KeyLayerPatch = { x: number; y: number } | { scale: number };

export interface SelectedLayer {
  id: string;
  x: number;
  y: number;
  scale: number;
}

export interface PreviewKeyHandlers {
  /** 現在選著什麼（每次按鍵都問，所以取消選取後方向鍵又是轉卡）。 */
  context(): PreviewKeyContext;
  /** 轉卡：yaw、pitch 各加幾度。 */
  turn(dYawDeg: number, dPitchDeg: number): void;
  home(): void;
  zoom(dir: 1 | -1): void;
  flip(): void;
  /** 選中的、可以移動的圖層「現在」的樣子（含還沒記步的 preview）；沒有＝null。 */
  selected(): SelectedLayer | null;
  /** 改圖層：preview＝只換畫面、commit＝記成復原堆疊的一步。 */
  editLayer(layerId: string, patch: KeyLayerPatch, phase: 'preview' | 'commit'): void;
  /**
   * 現在編輯狀態的「身分」（main 給復原堆疊物件本身，T-607c）：停手後補記一步之前，和最後一次 preview 之後的比；
   * 不一樣（換了卡、復原了、別的操作已經把這一步記掉或開了自己的 preview）就不記，免得蓋掉之後的改動。
   */
  editToken(): unknown;
}

export interface PreviewKeys {
  /** 馬上把還沒記的那一步記起來（焦點離開、復原、開始拖曳、換面、被接手前）；沒有、或身分不對（見 editToken）就不做事。 */
  flush(): void;
  /** 作廢還沒記的那一步（不記、計時器停掉）：換卡時用（舊卡換掉前已經存了畫面上的樣子）。 */
  cancel(): void;
  /** 有一步還沒記（在等停手）。 */
  pending(): boolean;
}

/** 掛在可以拿焦點的預覽區上。idleMs＝停手多久才記一步（測試可以調）。 */
export function attachPreviewKeys(el: HTMLElement, h: PreviewKeyHandlers, idleMs = KEY_COMMIT_IDLE_MS): PreviewKeys {
  /** 還沒記的那一步；token＝這次 preview 之後的編輯狀態身分。 */
  let waiting: { id: string; kind: 'move' | 'scale'; patch: KeyLayerPatch; token: unknown } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    waiting = null;
  };

  const flush = () => {
    const w = waiting;
    cancel();
    // 身分不對（之後有別的操作）：這一步已經被記掉、或被復原／換卡作廢了，不再補記
    if (w && h.editToken() === w.token) h.editLayer(w.id, w.patch, 'commit');
  };

  const edit = (layer: SelectedLayer, kind: 'move' | 'scale', patch: KeyLayerPatch) => {
    // 換了一層、或從移動換成縮放：上一步先記起來
    if (waiting && (waiting.id !== layer.id || waiting.kind !== kind)) flush();
    h.editLayer(layer.id, patch, 'preview');
    waiting = { id: layer.id, kind, patch, token: h.editToken() };
    clearTimeout(timer);
    timer = setTimeout(flush, idleMs);
  };

  el.addEventListener('keydown', (e) => {
    const action = previewKeyAction(e, h.context());
    if (!action) return;
    e.preventDefault();
    switch (action.kind) {
      case 'turn':
        h.turn(action.yaw, action.pitch);
        return;
      case 'home':
        // 回正、翻面會換面、取消選中：還沒記的移動先記起來
        flush();
        h.home();
        return;
      case 'zoom':
        h.zoom(action.dir);
        return;
      case 'flip':
        flush();
        h.flip();
        return;
      case 'move': {
        const layer = h.selected();
        if (!layer) return;
        const next = moveByKey(layer, action.dx, action.dy);
        if (next.x === layer.x && next.y === layer.y) return;
        edit(layer, 'move', next);
        return;
      }
      case 'scale': {
        const layer = h.selected();
        if (!layer) return;
        const scale = scaleByKey(layer.scale, action.factor);
        if (scale === layer.scale) return;
        edit(layer, 'scale', { scale });
        return;
      }
    }
  });
  // 焦點離開預覽區：沒記的那一步馬上記
  el.addEventListener('blur', flush);

  return { flush, cancel, pending: () => waiting !== null };
}
