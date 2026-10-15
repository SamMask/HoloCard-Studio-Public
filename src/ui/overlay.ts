// 直接在卡上調圖層（DESIGN §3）的選取框與四角把手：畫在 overlayHost 的 SVG 裡，全用 DOM API 建元素（不用 innerHTML）。
// 只負責畫：四角的螢幕位置由 main 每影格用 projectCardPoint 算好傳進來（跟著卡片角度與視差走）；
// SVG 不吃滑鼠事件（pointer-events: none），框外照樣能轉卡。按下去做什麼由預覽區的指標處理判斷（interact/manipulate）。

const SVG_NS = 'http://www.w3.org/2000/svg';

export type OverlayCursor = 'grab' | 'move' | 'nwse-resize' | 'nesw-resize';

export interface Overlay {
  /** 框四角的螢幕 client 座標（左上、右上、右下、左下，看著那一面）；null＝不畫。 */
  update(corners: readonly { x: number; y: number }[] | null): void;
  /** 哪個把手要放大（滑過或正在拖）；null＝都不放大。 */
  highlight(corner: number | null): void;
  /** 預覽區的游標：框外 grab、框內 move、四角斜向 resize。 */
  setCursor(cursor: OverlayCursor): void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, className: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  el.setAttribute('class', className);
  return el;
}

/** host＝畫框的疊層；cursorHost＝收滑鼠事件的預覽區（游標設在它身上）。 */
export function createOverlay(host: HTMLElement, cursorHost: HTMLElement): Overlay {
  const svg = svgEl('svg', 'select-overlay');
  svg.setAttribute('aria-hidden', 'true');
  // 深色底線＋青藍細線：亮色圖上也看得到框
  const shadow = svgEl('polygon', 'select-shadow');
  const frame = svgEl('polygon', 'select-frame');
  const handles = [0, 1, 2, 3].map(() => {
    const c = svgEl('circle', 'select-handle');
    c.setAttribute('r', '7');
    return c;
  });
  svg.append(shadow, frame, ...handles);
  svg.style.display = 'none';
  host.append(svg);

  let shown = false;
  let lastPoints = '';
  let hot: number | null = null;
  let cursor: OverlayCursor = 'grab';

  return {
    update(corners) {
      const visible = corners !== null && corners.length === 4;
      if (visible !== shown) {
        shown = visible;
        svg.style.display = visible ? '' : 'none';
      }
      if (!corners || !visible) return;
      const origin = host.getBoundingClientRect();
      const pts = corners.map((c) => [(c.x - origin.left).toFixed(1), (c.y - origin.top).toFixed(1)] as const);
      const points = pts.map(([x, y]) => `${x},${y}`).join(' ');
      if (points === lastPoints) return;
      lastPoints = points;
      shadow.setAttribute('points', points);
      frame.setAttribute('points', points);
      handles.forEach((c, i) => {
        c.setAttribute('cx', pts[i][0]);
        c.setAttribute('cy', pts[i][1]);
      });
    },
    highlight(corner) {
      if (corner === hot) return;
      hot = corner;
      handles.forEach((c, i) => c.classList.toggle('is-hot', i === corner));
    },
    setCursor(next) {
      if (next === cursor) return;
      cursor = next;
      if (next === 'grab') delete cursorHost.dataset.cursor;
      else cursorHost.dataset.cursor = next;
    },
  };
}
