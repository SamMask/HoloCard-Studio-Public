// 文字圖層：依 TextSpec 把字畫成透明圖（只在瀏覽器）。排版在 text-layout.ts（純函式），這裡只負責
// 載入字型、用 OffscreenCanvas 畫、交給和上傳共用的 storeCanvas（WebP、雜湊）。
// 字型只從同源 /fonts/ 載入、而且只在第一次用到那套字型時載入（AGENTS.md 硬邊界 1：不對外請求）。

import type { TextFont, TextSpec } from '../model/types';
import { storeCanvas } from './ingest';
import {
  canvasSize,
  contentFraction,
  outlineColorFor,
  pixelsPerEm,
  planText,
  SEAL_RIM_INSET_EM,
  SEAL_RIM_WIDTH_EM,
  sealInkColor,
  TEXT_FONT_INFO,
} from './text-layout';
import type { StoredImage } from './types';

export type TextImageResult =
  | {
      ok: true;
      image: StoredImage;
      /** 看得到的字佔整張圖的比例（選取框、縮圖只框住字）。 */
      content: { w: number; h: number };
    }
  | { ok: false; reason: 'font-failed' | 'draw-failed' };

const loading = new Map<TextFont, Promise<void>>();
const ready = new Set<TextFont>();

/** 載入一套字型（同一套只載一次；失敗了下次再試）。 */
export function loadTextFont(font: TextFont): Promise<void> {
  let task = loading.get(font);
  if (!task) {
    const info = TEXT_FONT_INFO[font];
    const face = new FontFace(info.family, `url("${import.meta.env.BASE_URL}fonts/${info.file}")`, { weight: info.weightRange });
    task = face.load().then((loaded) => {
      document.fonts.add(loaded);
      ready.add(font);
    });
    task.catch(() => loading.delete(font));
    loading.set(font, task);
  }
  return task;
}

/** 已經載入好的字型（介面用來顯示字型預覽）。 */
export function loadedTextFonts(): TextFont[] {
  return [...ready];
}

/** 量字用的參考字級（像素）。 */
const MEASURE_PX = 100;

function fontString(font: TextFont, px: number): string {
  const info = TEXT_FONT_INFO[font];
  return `${info.weight} ${px}px "${info.family}"`;
}

/**
 * 把文字畫成圖、編碼、算雜湊。spec 要先用 model 的 cleanTextSpec／mergeTextSpec 整理過（畫的內容＝存的內容）。
 * 不丟例外：字型載不到 → font-failed；畫或編碼失敗 → draw-failed。
 */
export async function drawTextImage(spec: TextSpec): Promise<TextImageResult> {
  try {
    await loadTextFont(spec.font);
  } catch {
    return { ok: false, reason: 'font-failed' };
  }
  try {
    const probe = new OffscreenCanvas(1, 1).getContext('2d');
    if (!probe) return { ok: false, reason: 'draw-failed' };
    probe.font = fontString(spec.font, MEASURE_PX);
    probe.textBaseline = 'middle';
    const plan = planText(spec, (s) => probe.measureText(s).width / MEASURE_PX);
    // textBaseline 'middle' 是字框的中線，中文字的墨跡中心可能偏一點：用「國」量出偏移，畫的時候補回來
    const ref = probe.measureText('國');
    const inkShift = (ref.actualBoundingBoxDescent - ref.actualBoundingBoxAscent) / 2 / MEASURE_PX;

    const size = canvasSize(plan, pixelsPerEm(plan));
    const sx = size.width / plan.width;
    const sy = size.height / plan.height;
    const em = (sx + sy) / 2;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'draw-failed' };

    let ink = spec.color;
    if (plan.seal) {
      const s = plan.seal;
      ctx.fillStyle = spec.color;
      ctx.beginPath();
      ctx.roundRect(s.x * sx, s.y * sy, s.width * sx, s.height * sy, s.radius * em);
      ctx.fill();
      // 內框細線：像蓋出來的印章
      ink = sealInkColor(spec.color);
      const inset = SEAL_RIM_INSET_EM * em;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = SEAL_RIM_WIDTH_EM * em;
      ctx.beginPath();
      ctx.roundRect(s.x * sx + inset, s.y * sy + inset, s.width * sx - 2 * inset, s.height * sy - 2 * inset, Math.max(0, s.radius * em - inset));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.font = fontString(spec.font, em);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const at = (g: { x: number; y: number }) => [g.x * sx, (g.y - inkShift) * sy] as const;
    if (plan.outline > 0) {
      ctx.strokeStyle = outlineColorFor(spec.color);
      ctx.lineWidth = 2 * plan.outline * em;
      ctx.lineJoin = 'round';
      for (const g of plan.glyphs) ctx.strokeText(g.text, ...at(g));
    }
    ctx.fillStyle = ink;
    for (const g of plan.glyphs) ctx.fillText(g.text, ...at(g));

    return { ok: true, image: await storeCanvas(canvas, ctx), content: contentFraction(plan) };
  } catch {
    return { ok: false, reason: 'draw-failed' };
  }
}
