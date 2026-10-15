// 連舞台一起錄（T-850，DESIGN §7.1「連舞台一起錄」）的「CSS 那層」：預覽區 3D 畫布後面的背景——style.css 的 .stage 底色、
// .stage-backdrop 的圖（ui/stage.ts 照 ui/logic 的 stageBackdropView 換）與它的暗角（::after）——在 2D 畫布上照同樣的算法畫一張
// （card-view 的 captureTurntable stage：每格同一張當底，3D 舞台＋卡片疊上去，前景圖最後）。
// 照著畫的 CSS（style.css 改了這裡要跟著改）：
//   - 底色：--stage-bg（全息光環、關閉）、--gallery-bg（展示廳）、.stage.is-magic／is-water／is-nebula、工作桌 --page-fallback（木棕直漸層；上面一定蓋滿木桌圖）。
//   - 背景那層看不看得見：自己的背景圖（has-backdrop）一律看得見；展示廳只有大廳讀好（is-hall）；魔法陣、水鏡、星雲（沒有自己的背景圖）看不見；
//     全息光環、關閉、工作桌看得見。
//   - 圖：自己的背景圖＝cover、照 view.farPan 裁（farPanRect，同 T-822 的 farPanCss）、brightness(0.85)；
//     展示廳的大廳＝cover、object-position 50% 60%、brightness(0.8) saturate(0.95)（不套 farPan，同預覽）；
//     工作桌＝.stage-backdrop.is-desk::before 那塊（寬 max(100cqw, 284.4cqh)、高 160cqh、上緣 87cqh − 0.65×160cqh、
//     左緣 clamp(100cqw − 寬, 50cqw − 0.27×284.4cqh, 0)；圖 cover、0% 50%；左上檯燈那塊壓暗；brightness(0.9)）；
//     全息光環＝正面底圖 cover 置中、scale(1.18)、blur(32px) saturate(1.2) brightness(0.66)。
//     CSS 的 32px 是預覽區的像素：照「預覽區高 SCENERY_REF_HEIGHT（700）px」換成輸出畫面高的比例（同 backdrop.ts 前景圖模糊的換算想法）。
//   - 暗角：預設（.stage-backdrop::after）、自己的背景圖（is-custom）、大廳（is-hall 兩層）、木桌（is-desk 兩層）。
// 漸層一律用 rgba（透明端也帶顏色）：canvas 的漸層不一定在預乘空間內插，寫 transparent（透明黑）邊上會發灰。
// 純 2D 畫布、不碰 three.js；圖由呼叫端讀好給（render 不讀圖、不寫死網址）。

import type { StageStyle } from '../model/types';
import { coverRect, paintCover, type BackdropImage } from './backdrop';

/** 背景那層的圖是哪一種（見檔頭）。 */
export type SceneryKind = 'custom' | 'hall' | 'desk' | 'blur';

/** 預覽區 CSS 那層的內容：哪一種舞台（底色、看不看得見背景那層）＋背景那層的圖（沒有＝null）。 */
export interface StageScenery {
  readonly stage: StageStyle;
  readonly image: { readonly kind: SceneryKind; readonly source: BackdropImage } | null;
}

/** CSS 的 blur(32px) 是在多高的預覽區上看的（換算成輸出畫面高的比例）。 */
export const SCENERY_REF_HEIGHT = 700;
/** 全息光環底圖模糊版的 CSS（.stage-backdrop-img）。 */
const BLUR_PX = 32;
const BLUR_SCALE = 1.18;

type Stop = readonly [number, string];
/** CSS 的 radial-gradient(ellipse rx% ry% at cx% cy%, …)（半徑、中心都是畫面寬高的比例）。 */
interface Radial {
  readonly kind: 'radial';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly stops: readonly Stop[];
}
/** CSS 的 linear-gradient(180deg, …)（由上往下）。 */
interface Linear {
  readonly kind: 'linear';
  readonly stops: readonly Stop[];
}
type Layer = Radial | Linear;

const radial = (cx: number, cy: number, rx: number, ry: number, stops: readonly Stop[]): Radial => ({ kind: 'radial', cx, cy, rx, ry, stops });
const linear = (stops: readonly Stop[]): Linear => ({ kind: 'linear', stops });

/** --c-ink（#1b1612）的 rgba。 */
const ink = (a: number) => `rgba(27, 22, 18, ${a})`;

/** 各舞台的底色（.stage 的 background；CSS 多層背景寫在前面的在上面，這裡由下往上排）。 */
const BASE: Record<StageStyle, readonly Layer[]> = {
  halo: [radial(0.5, 0.4, 0.8, 0.7, [[0, '#1a2c5c'], [0.55, '#0c1736'], [1, '#060b1b']])],
  none: [radial(0.5, 0.4, 0.8, 0.7, [[0, '#1a2c5c'], [0.55, '#0c1736'], [1, '#060b1b']])],
  gallery: [radial(0.5, 0.28, 0.95, 0.8, [[0, '#142a5e'], [0.42, '#0b1a3e'], [0.72, '#060d22'], [1, '#04081a']])],
  magic: [radial(0.5, 0.36, 0.9, 0.75, [[0, '#12224e'], [0.44, '#0a1536'], [0.74, '#050b1e'], [1, '#03060f']])],
  water: [
    linear([[0, '#060e26'], [0.28, '#0c1c44'], [0.43, '#17326a'], [0.52, '#0d1d42'], [1, '#050b1e']]),
    radial(0.5, 0.04, 0.36, 0.24, [[0, 'rgba(196, 216, 255, 0.14)'], [1, 'rgba(196, 216, 255, 0)']]),
  ],
  nebula: [radial(0.5, 0.42, 0.85, 0.75, [[0, '#0d1132'], [0.52, '#070a1f'], [1, '#03040d']])],
  desk: [linear([[0, '#3b2a1f'], [1, '#1b1612']])],
};

/** 暗角（::after；由下往上排）。 */
const VIGNETTE = {
  plain: [radial(0.5, 0.44, 0.75, 0.7, [[0, 'rgba(6, 12, 32, 0.06)'], [0.55, 'rgba(6, 12, 32, 0.3)'], [1, 'rgba(3, 7, 20, 0.82)']])],
  custom: [radial(0.5, 0.46, 0.85, 0.8, [[0.55, 'rgba(6, 12, 32, 0)'], [1, 'rgba(3, 7, 20, 0.45)']])],
  hall: [
    linear([[0, 'rgba(4, 8, 22, 0.25)'], [0.32, 'rgba(4, 8, 22, 0)']]),
    radial(0.5, 0.52, 0.72, 0.64, [[0.42, 'rgba(6, 12, 32, 0)'], [1, 'rgba(3, 7, 20, 0.5)']]),
  ],
  desk: [
    linear([[0, ink(0.3)], [0.3, ink(0)]]),
    radial(0.5, 0.56, 0.78, 0.72, [[0.45, ink(0)], [1, ink(0.55)]]),
  ],
} as const;

/** 木桌圖那塊（.stage-backdrop.is-desk::before，單位是預覽區的 cqh）。 */
const DESK = { aspect: 2.844, height: 1.6, anchorY: 0.87, lampY: 0.65, lampX: 0.27, brightness: 0.9 } as const;
/** 檯燈燈泡那一塊壓暗（::before 的第一層，相對木桌那塊的寬高）。 */
const DESK_LAMP = radial(0.227, 0.175, 0.15, 0.13, [[0, ink(0.6)], [0.55, ink(0.32)], [1, ink(0)]]);

type Ctx = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'translate' | 'scale' | 'fillRect' | 'createRadialGradient' | 'createLinearGradient' | 'drawImage' | 'fillStyle' | 'filter'
>;

/** 一層漸層畫在 (x, y, w, h) 這一塊上（只填這一塊）。 */
function fillLayer(ctx: Ctx, layer: Layer, x: number, y: number, w: number, h: number): void {
  ctx.save();
  if (layer.kind === 'linear') {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    for (const [at, color] of layer.stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  } else {
    // 把單位圓拉成橢圓：半徑 1＝寬的 rx、高的 ry（同 card-view 的 paintBackdrop）
    const sx = w * layer.rx;
    const sy = h * layer.ry;
    ctx.translate(x + w * layer.cx, y + h * layer.cy);
    ctx.scale(sx, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [at, color] of layer.stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect((x - (x + w * layer.cx)) / sx, (y - (y + h * layer.cy)) / sy, w / sx, h / sy);
  }
  ctx.restore();
}

const fillAll = (ctx: Ctx, layers: readonly Layer[], w: number, h: number) => {
  for (const layer of layers) fillLayer(ctx, layer, 0, 0, w, h);
};

/** 用 filter 畫一下（畫完還原）。 */
function withFilter(ctx: Ctx, filter: string, draw: () => void): void {
  ctx.save();
  ctx.filter = filter;
  try {
    draw();
  } finally {
    ctx.restore();
  }
}

/** 工作桌的木桌那塊（見檔頭）。 */
function paintDesk(ctx: Ctx, source: BackdropImage, w: number, h: number): void {
  const bw = Math.max(w, DESK.aspect * h);
  const bh = DESK.height * h;
  const top = DESK.anchorY * h - DESK.lampY * bh;
  const left = Math.max(w - bw, Math.min(w / 2 - DESK.lampX * DESK.aspect * h, 0));
  // background: url() 0% 50% / cover：蓋滿這一塊、左緣對齊、上下置中
  const s = Math.max(bw / source.width, bh / source.height);
  const sw = bw / s;
  const sh = bh / s;
  withFilter(ctx, `brightness(${DESK.brightness})`, () => {
    ctx.drawImage(source.image, 0, (source.height - sh) / 2, sw, sh, left, top, bw, bh);
    fillLayer(ctx, DESK_LAMP, left, top, bw, bh);
  });
}

/** 全息光環的底圖模糊版（見檔頭）。 */
function paintBlur(ctx: Ctx, source: BackdropImage, w: number, h: number): void {
  const r = coverRect(source.width, source.height, w, h);
  const blur = (BLUR_PX * h) / SCENERY_REF_HEIGHT;
  withFilter(ctx, `blur(${blur}px) saturate(1.2) brightness(0.66)`, () => {
    ctx.drawImage(source.image, r.sx, r.sy, r.sw, r.sh, (w - BLUR_SCALE * w) / 2, (h - BLUR_SCALE * h) / 2, BLUR_SCALE * w, BLUR_SCALE * h);
  });
}

/** 預覽區 CSS 那層畫滿 width × height（見檔頭）。一定不透明（底色蓋滿）。 */
export function paintScenery(ctx: Ctx, width: number, height: number, scenery: StageScenery): void {
  const { stage, image } = scenery;
  fillAll(ctx, BASE[stage] ?? BASE.halo, width, height);
  switch (image?.kind) {
    case 'custom':
      withFilter(ctx, 'brightness(0.85)', () => paintCover(ctx, image.source, width, height));
      fillAll(ctx, VIGNETTE.custom, width, height);
      return;
    case 'hall': {
      const r = coverRect(image.source.width, image.source.height, width, height, 0.6);
      withFilter(ctx, 'brightness(0.8) saturate(0.95)', () => ctx.drawImage(image.source.image, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height));
      fillAll(ctx, VIGNETTE.hall, width, height);
      return;
    }
    case 'desk':
      paintDesk(ctx, image.source, width, height);
      fillAll(ctx, VIGNETTE.desk, width, height);
      return;
    default:
      // 全息光環、關閉：背景那層看得見（底圖模糊版＋暗角；沒有底圖也有暗角）；其他舞台沒有自己的圖時那層看不見
      if (stage !== 'halo' && stage !== 'none') return;
      if (image?.kind === 'blur') paintBlur(ctx, image.source, width, height);
      fillAll(ctx, VIGNETTE.plain, width, height);
  }
}
