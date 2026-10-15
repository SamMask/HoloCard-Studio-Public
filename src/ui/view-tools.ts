// 預覽區下方工具列（T-835，DESIGN §5.2）：〔展示〕旁邊的〔−〕{縮放比例}〔＋〕與〔全螢幕〕。
// - 縮放：和滾輪、鍵盤是同一個值（interact/view.ts 的 zoom）；顯示「預設大小＝100%」的整數百分比，按一下 10%（停在整十上），
//   直接到位（同滾輪，沒有平滑過渡，所以減少動態也一樣）；到上下限那顆變淡（aria-disabled，不用 disabled：連按到底時焦點不會掉）。
//   滾輪、鍵盤改的值由 main 每格 setZoom 進來（值沒變不碰 DOM）。
// - 全螢幕：只把預覽區（fullscreenTarget，整個 .stage，下方工具列也在裡面）用 Fullscreen API 鋪滿螢幕；左右欄與頁首不在裡面所以不顯示。
//   再按一次或 Esc（瀏覽器自己退出，頁面只收到 fullscreenchange）離開；按鈕的字、圖示跟著實際狀態換。
//   只有瀏覽器根本不支援（fullscreenEnabled 是 false、沒有 requestFullscreen，例如 iframe 沒給權限）時按鈕才變淡；
//   被拒絕（焦點、使用者動作的時機等）時按鈕保持可按、下次按再試一次，不丟錯、不跳訊息（T-838b，console 記一筆）。
// 文字一律 textContent（硬邊界 4）。

import { S } from '../i18n';
import { canZoomStep, ZOOM_DEFAULT, zoomByStep, zoomPercent } from '../interact/view';
import { button, h, setText, toggleClass } from './dom';
import { icon, swapIcon } from './icons';

/** 用到的那幾個 Fullscreen API（測試換成假的）。 */
export interface FullscreenApi {
  /** 這個瀏覽器（這個頁面）能不能全螢幕。 */
  enabled(): boolean;
  /** 現在全螢幕的元素（沒有＝null）。 */
  active(): Element | null;
  /** 把 el 鋪滿螢幕；被拒絕＝reject（也可能當場丟錯）。 */
  request(el: HTMLElement): Promise<void>;
  exit(): Promise<void>;
  /** 進出全螢幕（含使用者按 Esc 讓瀏覽器自己退出）時通知。 */
  onChange(fn: () => void): void;
}

/** 瀏覽器真的 Fullscreen API（沒有就當不支援）。 */
export function browserFullscreen(): FullscreenApi {
  return {
    enabled: () =>
      typeof document !== 'undefined' &&
      document.fullscreenEnabled === true &&
      typeof document.exitFullscreen === 'function' &&
      typeof HTMLElement !== 'undefined' &&
      typeof HTMLElement.prototype.requestFullscreen === 'function',
    active: () => document.fullscreenElement ?? null,
    // async：當場丟的錯也變成 reject
    request: async (el) => el.requestFullscreen({ navigationUI: 'hide' }),
    exit: async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    },
    onChange: (fn) => {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('fullscreenchange', fn);
    },
  };
}

export interface ViewToolsHooks {
  /** 按〔−〕〔＋〕：把縮放設成這個值（已經夾好範圍）。 */
  zoomTo(zoom: number): void;
  /** 要鋪滿螢幕的元素（預覽區）。 */
  fullscreenTarget(): HTMLElement;
}

export interface ViewTools {
  readonly el: HTMLElement;
  /** 目前的縮放（main 每格給；滾輪、鍵盤改的也從這裡進來）。數字沒變就不碰 DOM。 */
  setZoom(zoom: number): void;
  /** 在全螢幕就離開（被另一個分頁接手時：遮罩在預覽區外面，全螢幕會看不到它）。 */
  exitFullscreen(): void;
}

export function createViewTools(hooks: ViewToolsHooks, fs: FullscreenApi = browserFullscreen()): ViewTools {
  // ---- 縮放 ----
  const zoomOut = button('btn-icon view-tool zoom-out', [icon('minus', 18)], S.preview.zoomOut);
  zoomOut.setAttribute('aria-label', S.preview.zoomOut);
  const zoomIn = button('btn-icon view-tool zoom-in', [icon('plus', 18)], S.preview.zoomIn);
  zoomIn.setAttribute('aria-label', S.preview.zoomIn);
  // 數字：按按鈕時朗讀新的比例（滾輪也會變，但用滾輪的人看得到）
  const value = h('span', { className: 'zoom-value', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
  const zoomGroup = h('div', { className: 'zoom-group', attrs: { role: 'group', 'aria-label': S.preview.zoomLabel } }, [zoomOut, value, zoomIn]);

  let zoom = Number.NaN;
  /** 變淡（aria-disabled）：按了不動，但照樣拿得到焦點。 */
  const fade = (b: HTMLButtonElement, off: boolean) => {
    toggleClass(b, 'is-off', off);
    if (off) b.setAttribute('aria-disabled', 'true');
    else b.removeAttribute('aria-disabled');
  };
  const setZoom = (next: number) => {
    if (!Number.isFinite(next) || next === zoom) return;
    zoom = next;
    setText(value, `${zoomPercent(zoom)}%`);
    fade(zoomOut, !canZoomStep(zoom, -1));
    fade(zoomIn, !canZoomStep(zoom, 1));
  };
  const step = (dir: 1 | -1) => {
    if (!canZoomStep(zoom, dir)) return;
    const next = zoomByStep(zoom, dir);
    hooks.zoomTo(next);
    // 數字馬上變（不用等下一格）；main 下一格 setZoom 同一個值不會再動
    setZoom(next);
  };
  zoomOut.addEventListener('click', () => step(-1));
  zoomIn.addEventListener('click', () => step(1));
  setZoom(ZOOM_DEFAULT);

  // ---- 全螢幕 ----
  const fullscreen = button('btn-icon view-tool fullscreen-btn', [icon('fullscreen', 18)]);
  /** 瀏覽器根本不支援：按鈕變淡、按了不做事。被拒絕不算（下次按再試）。 */
  let unsupported = false;
  let shownOn: boolean | null = null;
  const isOn = () => {
    const active = fs.active();
    return active !== null && active === hooks.fullscreenTarget();
  };
  const paintFullscreen = () => {
    const on = !unsupported && isOn();
    if (on !== shownOn) {
      shownOn = on;
      const label = on ? S.preview.exitFullscreen : S.preview.fullscreen;
      fullscreen.title = label;
      fullscreen.setAttribute('aria-label', label);
      swapIcon(fullscreen, on ? 'fullscreenExit' : 'fullscreen', 18);
      toggleClass(fullscreen, 'is-on', on);
    }
    fade(fullscreen, unsupported);
  };
  /** 被拒絕：不丟錯、不變淡，console 記一筆；下次按會再要求。 */
  const denied = (err: unknown) => console.warn('fullscreen request was denied; the button stays enabled, next click retries:', err);
  fullscreen.addEventListener('click', () => {
    if (unsupported) return;
    if (isOn()) {
      fs.exit().catch(() => {});
      return;
    }
    let pending: Promise<void>;
    try {
      pending = fs.request(hooks.fullscreenTarget());
    } catch (err) {
      denied(err);
      return;
    }
    pending.catch(denied);
  });
  fs.onChange(paintFullscreen);
  unsupported = !fs.enabled();
  paintFullscreen();

  const el = h('div', { className: 'view-tools' }, [zoomGroup, h('span', { className: 'view-tools-sep', attrs: { 'aria-hidden': 'true' } }), fullscreen]);

  return {
    el,
    setZoom,
    exitFullscreen() {
      if (isOn()) fs.exit().catch(() => {});
    },
  };
}
