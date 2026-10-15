// 卡片故事（T-804，DESIGN「卡片故事」、SCHEMA Card.story?）：預覽區兩側的直排詩句，以及右欄輸入用的小規則。
// - 舞台不是「沒有」時，卡片「正面朝前（yaw 0、pitch 0）」時在螢幕上的外框右邊外面直排第 1 行、左邊外面直排第 2 行（由右往左讀），
//   垂直置中、和卡片之間留一點距離；字不會蓋到卡片，預覽區放不下就整個不顯示；卡片轉動時字不動。
// - 外框由 main 每影格用 frontCardRect 算（只用 render 現有的 projectCardPoint：從這一格的投影反推鏡頭，再算正面朝前的樣子），
//   視窗或預覽區大小、比例、縮放、取景改變都跟著重排；只是預覽區上面的一層 DOM，PNG、影片、GIF、縮圖都不會有。
// - 文字一律 textContent（硬邊界 4）；沒有淡入動畫（減少動態，T-608）。

import { S } from '../i18n';
import { TEXT_FONT_INFO } from '../images/text-layout';
import { STORY_MAX, STORY_MAX_LINES } from '../model/limits';
import type { Card, FaceSide, TextFont } from '../model/types';
import { CARD_THICKNESS } from '../render/fit';
import { h, setHidden, setText } from './dom';
import type { UiState } from './types';

/** 右欄的說明句（DESIGN）。 */
export const STORY_HELP = S.story.help;
/** 舞台選「關閉」而且有故事時，右欄多說一句。 */
export const STORY_STAGE_OFF_NOTE = S.story.stageOffNote;
/** 文字框的提示字（兩行的例子）。 */
export const STORY_PLACEHOLDER = S.story.placeholder;

/** 換行：\r\n、\r、\n 都算。 */
const LINE_BREAK = /\r\n|\r|\n/;

// ---------------------------------------------------------------- 輸入框的小規則

/** 字數「12／60」：以 Unicode 字元計（表情符號算一個、換行算一個），和 model 的上限同一種算法。 */
export function storyCountText(value: string): string {
  return S.story.count(Array.from(value).length, STORY_MAX);
}

/** 有幾行有字（只有空白的行不算，同 model 的 cleanStory，T-804b）。 */
function filledLines(value: string): number {
  return value.split(LINE_BREAK).filter((line) => line.trim() !== '').length;
}

/** 按 Enter 要不要擋下：選取範圍以外已經有 2 行有字就擋，第 3 行以後不能輸入（只有空白的行不算，T-804b）。 */
export function storyEnterBlocked(value: string, selectionStart: number, selectionEnd: number): boolean {
  const kept = value.slice(0, selectionStart) + value.slice(selectionEnd);
  return filledLines(kept) >= STORY_MAX_LINES;
}

/**
 * 貼上超過 2 行：只留到第 2 行有字的那一行為止（打字中，空白不整理；只有空白的行不算一行，同 model 的 cleanStory，T-804b——
 * 中間夾空白行的兩句兩句都留著）。
 */
export function limitStoryLines(value: string): string {
  const re = /\r\n|\r|\n/g;
  let start = 0;
  let filled = 0;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    if (value.slice(start, m.index).trim() !== '') filled += 1;
    if (filled === STORY_MAX_LINES) return value.slice(0, m.index);
    start = m.index + m[0].length;
  }
  return value;
}

/**
 * 文字框的上限（T-804b）：先照行數（limitStoryLines），再照字數剪到 STORY_MAX 個字——以 Unicode 字元計（表情符號算一個），
 * 和 model 的上限、字數「12／60」同一種算法（原生 maxlength 算的是 UTF-16，表情符號會只打得下一半，所以不用它）。
 */
export function limitStoryInput(value: string): string {
  const lines = limitStoryLines(value);
  const chars = Array.from(lines);
  return chars.length > STORY_MAX ? chars.slice(0, STORY_MAX).join('') : lines;
}

/**
 * 側面剛好對著鏡頭算不出外框時，能不能沿用上一次的（T-804b）：比例（卡高 cardH＝aspectHeight，T-807 含自訂）、縮放、
 * 畫布在螢幕上的位置與大小都一樣才行，有一個變了就不沿用（先不顯示，下一格轉開了就算得出來）。
 */
export function storyFrameKey(cardH: number, zoom: number, canvas: { left: number; top: number; width: number; height: number }): string {
  return `${cardH}|${zoom}|${canvas.left}|${canvas.top}|${canvas.width}|${canvas.height}`;
}

/** 故事的每一行（存著的文字已經整理過：最多 2 行、用 \n 分開）。第 1 行在右邊、第 2 行在左邊。 */
export function storyLines(text: string): string[] {
  return text.split(LINE_BREAK, STORY_MAX_LINES);
}

/** 預覽區要不要顯示故事：有故事、舞台不是「沒有」（放不放得下另外算）。 */
export function storyShown(card: Pick<Card, 'story' | 'view'>): boolean {
  return card.story !== undefined && card.view.stage !== 'none';
}

/**
 * 卡片故事先藏起來（T-813，使用者 2026-10-15：「卡片故事可以去掉，不好看」→ 先藏起來）：false＝右欄小節、預覽區的直排字、
 * 說明面板那一句都不顯示；`Card.story` 照存、照驗證、卡片檔照帶。之後要再開只改這個常數。
 */
export const STORY_ENABLED: boolean = false;

/** 預覽區要不要顯示故事（main 排直排字、載字型用）：開關打開、而且 storyShown。 */
export function storyVisible(card: Pick<Card, 'story' | 'view'>): boolean {
  return STORY_ENABLED && storyShown(card);
}

// ---------------------------------------------------------------- 卡片正面朝前時在螢幕上的外框

/** 螢幕上的一個範圍（px）。 */
export interface StoryBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface StoryProbe {
  /** 這一格交給 render 的角度（度；含調深度的小擺動）。 */
  yawDeg: number;
  pitchDeg: number;
  /** 卡高（卡寬＝1；model/aspect.ts 的 aspectHeight，T-807 含正方形、明信片、自訂與橫式）。 */
  cardH: number;
  /** 3D 畫布在螢幕上的範圍（client 座標）：鏡頭正中間＝它的中心。 */
  canvas: { left: number; top: number; width: number; height: number };
  /** render 的 projectCardPoint：卡面上一點 → 螢幕 client 座標（用同一格的角度；那一面背對鏡頭回 null）。 */
  project(face: FaceSide, x: number, y: number): { x: number; y: number } | null;
}

const RAD = Math.PI / 180;

/** 卡片本地 → 世界（和 render/pick.ts 一樣：先繞 y 轉 yaw、再繞 x 轉 pitch；tests 拿 pick.ts 對照）。 */
function toWorld(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): [number, number, number] {
  const cy = Math.cos(yawDeg * RAD);
  const sy = Math.sin(yawDeg * RAD);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(pitchDeg * RAD);
  const sp = Math.sin(pitchDeg * RAD);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/**
 * 卡片正面朝前（yaw 0、pitch 0）時在螢幕上的外框（client 座標），不管這一格卡片轉到哪裡都算得一樣。
 * 做法：鏡頭在 (0, 0, Z)、沒有旋轉，世界上一點 (X, Y, W) 投到螢幕＝畫布中心 ＋ K·(X, −Y)／(Z − W)。
 * 用這一格看得到的那一面四個角的實際投影（render 的 projectCardPoint）解出 1/K 與 Z/K（最小平方），
 * 再算正面四角在 yaw 0 時（深度＝厚度的一半）的位置。四角在同一個深度（正對或背對鏡頭）時只解得出那個深度的比例，
 * 而那時那一面剛好就在正面朝前的深度上，結果一樣。兩面都看不到（側面剛好對著鏡頭）→ null。
 */
export function frontCardRect(p: StoryProbe): StoryBox | null {
  const halfW = 0.5;
  const halfH = p.cardH / 2;
  const half = CARD_THICKNESS / 2;
  const cx = p.canvas.left + p.canvas.width / 2;
  const cy = p.canvas.top + p.canvas.height / 2;

  for (const face of ['front', 'back'] as const) {
    // 每個角給兩條式子（x、y）：d·(b − W·a) = 對應的世界座標，a＝1/K、b＝Z/K；先把 W 減掉平均值 m（u＝a、v＝b − m·a），比較穩
    const rows: { d: number; w: number; r: number }[] = [];
    let ok = true;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx * halfW;
        const y = sy * halfH;
        const s = p.project(face, x, y);
        if (!s) {
          ok = false;
          break;
        }
        const [X, Y, W] = face === 'front' ? toWorld(x, y, half, p.yawDeg, p.pitchDeg) : toWorld(-x, y, -half, p.yawDeg, p.pitchDeg);
        rows.push({ d: s.x - cx, w: W, r: X }, { d: s.y - cy, w: W, r: -Y });
      }
      if (!ok) break;
    }
    if (!ok) continue;
    const m = rows.reduce((t, row) => t + row.w, 0) / rows.length;
    // 每一列：[-d·(W − m), d]·[u, v] = r
    let suu = 0;
    let suv = 0;
    let svv = 0;
    let su = 0;
    let sv = 0;
    for (const { d, w, r } of rows) {
      const cu = -d * (w - m);
      suu += cu * cu;
      suv += cu * d;
      svv += d * d;
      su += cu * r;
      sv += d * r;
    }
    if (!(svv > 0)) continue;
    let u = 0;
    let v = sv / svv;
    const det = suu * svv - suv * suv;
    if (suu > svv * 1e-18 && det > suu * svv * 1e-12) {
      u = (su * svv - sv * suv) / det;
      v = (suu * sv - suv * su) / det;
    }
    // 正面朝前時，正面在深度 half：(Z − half)/K ＝ b − half·a ＝ v + (m − half)·u
    const inv = v + (m - half) * u;
    if (!(inv > 0) || !Number.isFinite(inv)) continue;
    const q = 1 / inv;
    return { left: cx - halfW * q, right: cx + halfW * q, top: cy - halfH * q, bottom: cy + halfH * q };
  }
  return null;
}

// ---------------------------------------------------------------- 字級與擺放

/** 字級＝卡片在畫面上高度的這個比例，夾在 STORY_FONT_MIN～STORY_FONT_MAX px。 */
export const STORY_FONT_RATIO = 0.065;
export const STORY_FONT_MIN = 13;
export const STORY_FONT_MAX = 30;
/** 直排一個字佔多高（字級的倍數：字＋字距 0.25em，同 style.css 的 .story-line）。 */
export const STORY_CHAR_EM = 1.25;
/** 字和卡片之間留的距離（字級的倍數）。 */
export const STORY_GAP_EM = 1.4;
/** 字離預覽區邊緣至少留多少 px。 */
export const STORY_EDGE_PX = 10;

/** 字級（px，整數）：卡片高度的 6.5%（13～30，主對話 2026-10-14 看過 1280×720 調大）；最長那一行直排比卡片還高時縮小到放得下（最小 13，再長就折成兩列）。 */
export function storyFontPx(cardHeightPx: number, longestChars: number): number {
  const base = Math.min(STORY_FONT_MAX, Math.max(STORY_FONT_MIN, cardHeightPx * STORY_FONT_RATIO));
  const fit = longestChars > 0 ? cardHeightPx / (longestChars * STORY_CHAR_EM) : base;
  return Math.round(Math.max(STORY_FONT_MIN, Math.min(base, fit)));
}

export interface StorySize {
  width: number;
  height: number;
}

export interface StoryFit {
  /** 卡片（正面朝前）在故事層裡的範圍（px，故事層左上角為 0）。 */
  card: StoryBox;
  /** 故事層（＝預覽區）的大小。 */
  area: StorySize;
  /** 字和卡片之間的距離（px）。 */
  gap: number;
  /** 第 1 行（右邊）量出來的大小。 */
  right: StorySize;
  /** 第 2 行（左邊）量出來的大小；只有一行＝null。 */
  left: StorySize | null;
}

export interface StoryPlacement {
  right: { x: number; y: number };
  left: { x: number; y: number } | null;
}

/**
 * 擺放：第 1 行放在卡片右邊那片空地的正中間、第 2 行放在左邊那片空地的正中間（像美化稿的直排詩句浮在兩側；
 * 也比較不會碰到衝出卡片的翅膀），但至少離卡片 gap；都和卡片垂直置中。
 * 任何一行超出預覽區（四邊各留 STORY_EDGE_PX）→ null（整個不顯示）。
 */
export function placeStory(f: StoryFit): StoryPlacement | null {
  const mid = (f.card.top + f.card.bottom) / 2;
  const fits = (x: number, y: number, s: StorySize) =>
    x >= STORY_EDGE_PX && y >= STORY_EDGE_PX && x + s.width <= f.area.width - STORY_EDGE_PX && y + s.height <= f.area.height - STORY_EDGE_PX;
  const right = { x: Math.max(f.card.right + f.gap, (f.card.right + f.area.width) / 2 - f.right.width / 2), y: mid - f.right.height / 2 };
  if (!fits(right.x, right.y, f.right)) return null;
  if (!f.left) return { right, left: null };
  const left = { x: Math.min(f.card.left - f.gap - f.left.width, f.card.left / 2 - f.left.width / 2), y: mid - f.left.height / 2 };
  return fits(left.x, left.y, f.left) ? { right, left } : null;
}

// ---------------------------------------------------------------- 預覽區上面的一層

export interface StoryView {
  readonly el: HTMLElement;
  /** 狀態變了（故事、舞台、字型載入好了）：馬上重排（舞台改成「沒有」不用等下一格）。 */
  render(state: UiState): void;
  /** 卡片正面朝前時的外框（client 座標，main 每影格給）；null＝不知道（3D 還沒好）。沒變就不重排。 */
  place(card: StoryBox | null): void;
}

export function createStoryView(): StoryView {
  const right = h('div', { className: 'story-line is-right' });
  const left = h('div', { className: 'story-line is-left' });
  right.hidden = true;
  left.hidden = true;
  const el = h('div', { className: 'story-layer', attrs: { 'aria-hidden': 'true' } }, [right, left]);

  let story: { lines: string[]; font: TextFont } | null = null;
  let fontReady = false;
  let rect: StoryBox | null = null;
  /** 上一次排版用的輸入（一樣就不重排）。 */
  let lastKey = '';
  /** 上一次量字的條件與結果（字、字型、字級、最大高度一樣就不再量，免得每格都逼瀏覽器重排版）。 */
  let measured: { key: string; right: StorySize; left: StorySize | null } | null = null;
  const lines = [right, left];

  const hide = () => {
    setHidden(right, true);
    setHidden(left, true);
  };
  const setStyle = (line: HTMLElement, name: string, value: string) => {
    if (line.style.getPropertyValue(name) !== value) line.style.setProperty(name, value);
  };

  const layout = () => {
    if (!story || !fontReady || !rect) {
      lastKey = '';
      hide();
      return;
    }
    const area = el.getBoundingClientRect();
    // 故事層沒畫出來（匯出錄影中 display: none）：先不排，也不量
    if (!(area.width > 0 && area.height > 0)) {
      lastKey = '';
      hide();
      return;
    }
    // 每格算出來的外框會有極小的誤差：取到 0.01 px，沒變就不重排
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const card: StoryBox = {
      left: r2(rect.left - area.left),
      right: r2(rect.right - area.left),
      top: r2(rect.top - area.top),
      bottom: r2(rect.bottom - area.top),
    };
    const key = [card.left, card.right, card.top, card.bottom, area.width, area.height, story.font, ...story.lines].join('|');
    if (key === lastKey) return;
    lastKey = key;

    const cardHeight = card.bottom - card.top;
    const longest = Math.max(...story.lines.map((l) => Array.from(l).length));
    const px = storyFontPx(cardHeight, longest);
    const maxHeight = Math.max(1, Math.floor(cardHeight));
    const info = TEXT_FONT_INFO[story.font];
    const measureKey = [px, maxHeight, story.font, ...story.lines].join('|');
    if (!measured || measured.key !== measureKey) {
      const sizes: StorySize[] = [];
      story.lines.forEach((text, i) => {
        const line = lines[i]!;
        setText(line, text);
        setStyle(line, 'font-family', `"${info.family}", serif`);
        setStyle(line, 'font-weight', String(info.weight));
        setStyle(line, 'font-size', `${px}px`);
        setStyle(line, 'max-height', `${maxHeight}px`);
        // 藏著的量不到大小：先打開量（同一段程式裡又決定藏不藏，畫面不會閃）
        setHidden(line, false);
        sizes.push({ width: line.offsetWidth, height: line.offsetHeight });
      });
      if (!(sizes[0]!.width > 0 && sizes[0]!.height > 0)) {
        lastKey = '';
        hide();
        return;
      }
      measured = { key: measureKey, right: sizes[0]!, left: sizes[1] ?? null };
    }
    const placed = placeStory({ card, area: { width: area.width, height: area.height }, gap: STORY_GAP_EM * px, right: measured.right, left: measured.left });
    if (!placed) {
      hide();
      return;
    }
    const put = (line: HTMLElement, at: { x: number; y: number } | null) => {
      if (!at) {
        setHidden(line, true);
        return;
      }
      setStyle(line, 'transform', `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`);
      setHidden(line, false);
    };
    put(right, placed.right);
    put(left, placed.left);
  };

  return {
    el,
    render(state) {
      const card = state.card;
      const next = storyShown(card) && card.story ? { lines: storyLines(card.story.text), font: card.story.font } : null;
      const ready = next !== null && (state.loadedFonts ?? []).includes(next.font);
      const same =
        (next === null && story === null) ||
        (next !== null && story !== null && next.font === story.font && next.lines.join('\n') === story.lines.join('\n'));
      if (same && ready === fontReady) return;
      story = next;
      fontReady = ready;
      // 換了字或字型：清空另一行（只剩一行時左邊不留舊字）、重新量
      if (!same) {
        measured = null;
        for (const line of lines) setText(line, '');
      }
      lastKey = '';
      layout();
    },
    place(card) {
      rect = card;
      layout();
    },
  };
}
