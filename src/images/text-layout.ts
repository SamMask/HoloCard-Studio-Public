// 文字圖層的排版純函式（不碰 DOM、可以在 node 測）：字型清單、行／列的位置、直排標點、圖的大小、自動配色。
// 真正畫字在 text.ts（只在瀏覽器）。座標單位＝「字高」（字級 1 em）：x 向右、y 向下，(0,0) 是圖的左上角。
//
// 大小的約定（SCHEMA §1「文字圖層」：scale 1＝一行字高約 0.1 卡寬）：render 把圖寬當成 scale × 卡寬，
// 所以圖寬至少 TEXT_BOX_EM 個字高；字不多時內容置中、兩旁透明，scale 1 時一行字高剛好 0.1 卡寬。
// 一行比這還長時圖跟著變寬（同一個 scale 下字會變小，等於自動縮到放得下）。

import { S } from '../i18n';
import type { TextAlign, TextFont, TextSpec } from '../model/types';
import { MAX_EDGE_PX } from './types';

export interface TextFontInfo {
  /** 程式內部註冊的字型名（FontFace family），不會和系統字型撞名。 */
  family: string;
  /** public/fonts/ 裡的檔名。 */
  file: string;
  /** 介面上的白話名字。 */
  label: string;
  /** 完整字型名（滑鼠停在按鈕上時顯示）。 */
  fullName: string;
  /** 畫字用的粗細（可變字重的字型可以選，其他一律 400）。 */
  weight: number;
  /** FontFace 的 weight 描述（可變字重寫範圍）。 */
  weightRange: string;
}

/** 四套字型（public/fonts/README.md；授權見 THIRD_PARTY_NOTICES.md）。 */
export const TEXT_FONT_INFO: Readonly<Record<TextFont, TextFontInfo>> = {
  wenkai: { family: 'HoloTextWenkai', file: 'LXGWWenKaiTC-Regular.ttf', label: S.fonts.wenkai, fullName: S.fonts.wenkaiName, weight: 400, weightRange: '400' },
  huninn: { family: 'HoloTextHuninn', file: 'jf-openhuninn-2.1.ttf', label: S.fonts.huninn, fullName: S.fonts.huninnName, weight: 400, weightRange: '400' },
  iansui: { family: 'HoloTextIansui', file: 'Iansui-Regular.ttf', label: S.fonts.iansui, fullName: S.fonts.iansuiName, weight: 400, weightRange: '400' },
  notoserif: {
    family: 'HoloTextNotoSerif',
    file: 'NotoSerifTC-wght.ttf',
    label: S.fonts.notoserif,
    fullName: S.fonts.notoserifName,
    weight: 600,
    weightRange: '200 900',
  },
};

/** 一行字高的目標像素（高解析度，放大仍清楚）；圖的長邊超過 MAX_EDGE_PX 時整體等比縮小。 */
export const TEXT_EM_PX = 256;
/** 圖最少幾個字高寬：scale 1（圖寬＝卡寬）時一行字高＝1/TEXT_BOX_EM 卡寬。 */
export const TEXT_BOX_EM = 10;
/** 行距：橫排相鄰兩行（直排相鄰兩列）中心的距離。 */
export const TEXT_LINE_GAP = 1.3;
/** 直排：同一列相鄰兩個字中心的距離。 */
export const TEXT_CHAR_STEP = 1.04;
/** 內容四周的透明邊（描邊、手寫字超出字框、陰影模糊都不會被切到）。 */
export const TEXT_PAD_EM = 0.3;
/** 描邊：字外面露出來的邊寬（約字高 8%）。 */
export const OUTLINE_EM = 0.08;
/** 印章：字到方框邊的距離、圓角半徑、內框線（離邊多遠、多粗）。 */
export const SEAL_PAD_EM = 0.34;
export const SEAL_RADIUS_EM = 0.16;
export const SEAL_RIM_INSET_EM = 0.1;
export const SEAL_RIM_WIDTH_EM = 0.045;

/** 量一段字的寬（字高 1 時）。 */
export type MeasureEm = (text: string) => number;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一段要畫的字：x、y＝中心點（畫的時候置中對齊）。橫排一行一段；直排一個字一段。 */
export interface Glyph {
  text: string;
  x: number;
  y: number;
}

export interface TextPlan {
  /** 整張圖的寬高（字高為 1）。 */
  width: number;
  height: number;
  /** 看得到的內容（含四周透明邊）在圖中的範圍：永遠水平置中、上下貼齊。 */
  content: Rect;
  /** 印章的方框（style 'seal' 才有）。 */
  seal: (Rect & { radius: number }) | null;
  glyphs: Glyph[];
  /** 描邊寬（0＝不描邊）。 */
  outline: number;
}

/** 換行切成一行一行（\r\n、\r、\n 都算）。 */
export function splitLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

/** 直排時換成直式標點（逗號句號靠右上、括號轉向）；字型沒有這些字時瀏覽器會用別的字型補。 */
const VERTICAL_FORMS: Readonly<Record<string, string>> = {
  '，': '︐',
  '、': '︑',
  '。': '︒',
  '：': '︓',
  '；': '︔',
  '！': '︕',
  '？': '︖',
  '「': '﹁',
  '」': '﹂',
  '『': '﹃',
  '』': '﹄',
  '（': '︵',
  '）': '︶',
  '【': '︻',
  '】': '︼',
  '《': '︽',
  '》': '︾',
  '〈': '︿',
  '〉': '﹀',
  '｛': '︷',
  '｝': '︸',
  '〔': '︹',
  '〕': '︺',
  '—': '︱',
  '－': '︲',
  '…': '︙',
  '‥': '︰',
  '～': '≀',
};

export function verticalForm(ch: string): string {
  return VERTICAL_FORMS[ch] ?? ch;
}

/** 在長度 total 的範圍裡放一段長 size 的東西，依對齊方式回傳起點。 */
function alignStart(align: TextAlign, total: number, size: number): number {
  if (align === 'start') return 0;
  if (align === 'end') return total - size;
  return (total - size) / 2;
}

/** n 行（列）字疊起來的總高（寬）：每行字高 1，相鄰兩行中心差 TEXT_LINE_GAP。 */
function stackSize(n: number, step: number): number {
  return n <= 0 ? 0 : (n - 1) * step + 1;
}

/**
 * 依文字設定排版（字高為 1）。
 * - 橫排：一行一段；多行時依 align 對齊（靠左／置中／靠右）。
 * - 直排：由上到下、多列由右到左；每個字置中、標點換成直式；多列時依 align 對齊（靠上／置中／靠下）。
 * - 印章：字外面加一圈 SEAL_PAD_EM 的方框；描邊：字外面加 OUTLINE_EM。
 * - 內容（含透明邊）永遠水平置中；圖寬至少 TEXT_BOX_EM。
 */
export function planText(spec: Pick<TextSpec, 'content' | 'align' | 'vertical' | 'style'>, measure: MeasureEm): TextPlan {
  const lines = splitLines(spec.content);
  const sealPad = spec.style === 'seal' ? SEAL_PAD_EM : 0;
  const inset = TEXT_PAD_EM + sealPad;
  const glyphs: Glyph[] = [];
  let blockW: number;
  let blockH: number;

  if (!spec.vertical) {
    const widths = lines.map((l) => Math.max(0, measure(l)));
    blockW = Math.max(1, ...widths);
    blockH = stackSize(lines.length, TEXT_LINE_GAP);
    lines.forEach((line, i) => {
      if (widths[i] <= 0) return;
      glyphs.push({ text: line, x: alignStart(spec.align, blockW, widths[i]) + widths[i] / 2, y: 0.5 + i * TEXT_LINE_GAP });
    });
  } else {
    const columns = lines.map((l) => Array.from(l).map(verticalForm));
    blockW = stackSize(columns.length, TEXT_LINE_GAP);
    blockH = Math.max(1, ...columns.map((c) => stackSize(c.length, TEXT_CHAR_STEP)));
    columns.forEach((chars, i) => {
      const top = alignStart(spec.align, blockH, stackSize(chars.length, TEXT_CHAR_STEP));
      const x = blockW - 0.5 - i * TEXT_LINE_GAP;
      chars.forEach((ch, j) => {
        if (ch.trim() !== '') glyphs.push({ text: ch, x, y: top + 0.5 + j * TEXT_CHAR_STEP });
      });
    });
  }

  const contentW = blockW + 2 * inset;
  const contentH = blockH + 2 * inset;
  const width = Math.max(TEXT_BOX_EM, contentW);
  const left = (width - contentW) / 2;
  for (const g of glyphs) {
    g.x += left + inset;
    g.y += inset;
  }
  return {
    width,
    height: contentH,
    content: { x: left, y: 0, width: contentW, height: contentH },
    seal:
      spec.style === 'seal'
        ? { x: left + TEXT_PAD_EM, y: TEXT_PAD_EM, width: blockW + 2 * sealPad, height: blockH + 2 * sealPad, radius: SEAL_RADIUS_EM }
        : null,
    glyphs,
    outline: spec.style === 'outline' ? OUTLINE_EM : 0,
  };
}

/** 一個字高要畫幾像素：目標 TEXT_EM_PX，圖的長邊超過 MAX_EDGE_PX 就整體縮小。 */
export function pixelsPerEm(plan: Pick<TextPlan, 'width' | 'height'>): number {
  return Math.min(TEXT_EM_PX, MAX_EDGE_PX / Math.max(plan.width, plan.height));
}

/** 畫布像素大小（四捨五入，1～MAX_EDGE_PX）。 */
export function canvasSize(plan: Pick<TextPlan, 'width' | 'height'>, emPx: number): { width: number; height: number } {
  const px = (v: number) => Math.min(MAX_EDGE_PX, Math.max(1, Math.round(v * emPx)));
  return { width: px(plan.width), height: px(plan.height) };
}

/** 看得到的內容佔整張圖的比例（選取框只框住字，不框兩旁的透明邊）。 */
export function contentFraction(plan: Pick<TextPlan, 'width' | 'height' | 'content'>): { w: number; h: number } {
  return { w: plan.content.width / plan.width, h: plan.content.height / plan.height };
}

// ---- 自動配色 ----

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** #rrggbb 的相對亮度（0＝黑、1＝白；WCAG 的算法）。格式不對當成黑色。 */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 0;
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** 亮度高於這個值時，黑色比白色更顯眼（兩者對比相等的點）。 */
const LIGHT_THRESHOLD = 0.179;
export const DARK_EDGE = '#17141f';
export const LIGHT_EDGE = '#f7f4ec';

/** 描邊顏色：字亮就用深邊、字暗就用淺邊。 */
export function outlineColorFor(color: string): string {
  return relativeLuminance(color) > LIGHT_THRESHOLD ? DARK_EDGE : LIGHT_EDGE;
}

/** 印章上的字：一般是白字；印章底色太淺（例如白色、淺黃）時白字看不見，改用深色字。 */
export function sealInkColor(color: string): string {
  return relativeLuminance(color) > 0.5 ? DARK_EDGE : '#ffffff';
}
