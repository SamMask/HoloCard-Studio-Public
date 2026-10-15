// 開一包（T-808，DESIGN 7.3）：收藏卡的儀式感，只是展示，不改任何資料。
//   新卡片面板最下面〔開一包〕→ 蓋上全螢幕的開包畫面（暗底）：
//   卡包浮在中間、淡淡的光掃過 → 點卡包（或 Enter／空白鍵）撕開，上緣一條飛走 → 卡片一張張從卡包裡滑出來、背面朝上疊好
//   → 點一下（或 Enter／空白鍵、或停 0.8 秒自動）翻開一張，翻開時彩虹光掃過卡面 → 全部翻完排成扇形。
//   最後：每張下面〔打開這張〕（卡片庫的卡＝打開；範例＝建立副本）、整體〔再開一包〕〔關閉〕。
//   任何時候〔跳過〕或 Esc → 直接到扇形，再按一次 Esc 關掉；減少動態效果 → 直接顯示扇形。
// 抽卡：卡片庫的卡＋範例（T-810 起五張），隨機、不重複，最多 5 張（不到 5 張就全部）。卡面用卡片庫縮圖（範例用卡片檔的預覽圖），不畫 3D。
// 分三層：純函式（抽卡 drawPack、狀態機 packStep、等多久 packWait、每張卡的位置 cardPose／fanLayout）可以在 node 測；
// DOM 層只把狀態畫出來（class、CSS 變數），動畫全寫在 style.css（只動 transform、opacity）。
// 計時器只負責「動畫跑完了／停 0.8 秒」→ 往下一步，畫面被藏起來、動畫沒跑也照樣往下走。顯示文字一律 textContent。

import { S } from '../i18n';
import { aspectHeight } from '../model/aspect';
import { setShapeHeight } from './aspect-picker';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { icon } from './icons';
import { SAMPLE_NAMES_ALL_LANGS } from './library-logic';
import type { LibraryCard } from './types';

/** 一包幾張。 */
export const PACK_SIZE = 5;

/** 動畫時間（毫秒）。CSS 的時間要和這裡對得上（style.css 的 T-808 段）。 */
export const PACK_TIMING = {
  /** 撕開後過多久第一張開始滑出（上緣那一條先飛走）。 */
  dealStartMs: 450,
  /** 一張接一張滑出的間隔。 */
  dealStepMs: 110,
  /** 一張滑出、疊好要多久。 */
  dealMoveMs: 650,
  /** 翻一張要多久。 */
  flipMs: 600,
  /** 停多久自動翻下一張（DESIGN：0.8 秒）。 */
  autoMs: 800,
} as const;

// ---- 抽卡 ----

/**
 * 從卡池隨機抽 count 張、不重複（Fisher–Yates 洗前面幾張）；卡池不到 count 張就全部（只換順序）。
 * random 回傳 [0, 1)（測試用固定亂數）；吐出 1 或超出範圍也不會抽到卡池外面。不改到原本的陣列。
 */
export function drawPack<T>(pool: readonly T[], count: number, random: () => number): T[] {
  const bag = pool.slice();
  const n = Math.min(bag.length, Math.max(0, Math.floor(count)));
  for (let i = 0; i < n; i++) {
    const r = Math.min(Math.max(random(), 0), 1);
    const j = Math.min(bag.length - 1, i + Math.floor(r * (bag.length - i)));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  return bag.slice(0, n);
}

// ---- 狀態機 ----

export type PackPhase = 'sealed' | 'torn' | 'dealt' | 'revealing' | 'done';

export interface PackState {
  readonly phase: PackPhase;
  /** 這一包幾張。 */
  readonly count: number;
  /** 翻開了幾張（revealing 時最後翻開的是第 revealed 張；done＝全部）。 */
  readonly revealed: number;
}

/**
 * next＝點一下、Enter／空白鍵，或停 0.8 秒自動；settled＝撕開與滑出的動畫跑完；skip＝〔跳過〕或 Esc。
 */
export type PackEvent = 'next' | 'settled' | 'skip';

/** 開始：平常是還沒撕開的卡包；減少動態效果 → 直接是扇形（全部翻開）。 */
export function packStart(count: number, reducedMotion: boolean): PackState {
  return reducedMotion ? { phase: 'done', count, revealed: count } : { phase: 'sealed', count, revealed: 0 };
}

/** 往下一步。沒有變就回傳同一個物件（畫面不用重畫）。 */
export function packStep(state: PackState, event: PackEvent): PackState {
  const { phase, count, revealed } = state;
  if (phase === 'done') return state;
  if (event === 'skip') return { phase: 'done', count, revealed: count };
  switch (phase) {
    case 'sealed':
      return event === 'next' ? { phase: 'torn', count, revealed: 0 } : state;
    case 'torn':
      // 撕開、滑出中點了不算（免得連點一下就跳過疊好那一步）
      return event === 'settled' ? { phase: 'dealt', count, revealed: 0 } : state;
    case 'dealt':
      if (event !== 'next') return state;
      return count > 0 ? { phase: 'revealing', count, revealed: 1 } : { phase: 'done', count, revealed: count };
    case 'revealing':
      if (event !== 'next') return state;
      return revealed < count ? { phase: 'revealing', count, revealed: revealed + 1 } : { phase: 'done', count, revealed: count };
  }
}

/** 撕開到最後一張滑出、疊好要多久（張數越多越久）。 */
export function tearMs(count: number): number {
  return PACK_TIMING.dealStartMs + Math.max(0, count - 1) * PACK_TIMING.dealStepMs + PACK_TIMING.dealMoveMs;
}

/** 撕開時第 index 張什麼時候開始滑出：最下面那張先出來，最上面（第一張翻開的）最後。 */
export function dealDelayMs(index: number, count: number): number {
  return PACK_TIMING.dealStartMs + Math.max(0, count - 1 - index) * PACK_TIMING.dealStepMs;
}

/** 這個狀態要自己往下走嗎：等多久、送什麼事件。沒卡包要撕、或已經是扇形 → null。 */
export function packWait(state: PackState): { event: PackEvent; ms: number } | null {
  switch (state.phase) {
    case 'torn':
      return { event: 'settled', ms: tearMs(state.count) };
    case 'dealt':
      return { event: 'next', ms: PACK_TIMING.autoMs };
    case 'revealing':
      return { event: 'next', ms: PACK_TIMING.flipMs + PACK_TIMING.autoMs };
    default:
      return null;
  }
}

/** 上方的提示句。 */
export function packHint(state: PackState | null): string {
  if (!state || state.phase === 'sealed') return S.pack.sealed;
  switch (state.phase) {
    case 'torn':
      return S.pack.torn;
    case 'dealt':
      return S.pack.flipFirst(state.count);
    case 'revealing':
      return state.revealed < state.count ? S.pack.flipNext(state.count - state.revealed) : S.pack.allRevealed;
    case 'done':
      return state.count > 0 ? S.pack.result(state.count) : S.pack.empty;
  }
}

// ---- 每張卡在哪裡（單位：--pk-size＝疊著時卡片的長邊） ----

/** 扇形裡的卡縮多小（CSS 也用：DOM 層設成 --pk-fan）。 */
export const FAN_SCALE = 0.72;
/** 扇形相鄰兩張的間距＝兩張寬度的平均 × 這個（小於 1＝稍微疊在一起）。 */
const FAN_STEP = 0.94;
/** 扇形相鄰兩張差幾度。 */
const FAN_TILT_DEG = 5;
/** 扇形中心比畫面中心高多少（下面要放卡名和〔打開這張〕）。 */
const FAN_Y = -0.12;
/** 扇形兩端比中間低多少。 */
const FAN_ARC = 0.07;
/** 疊著的卡：位置與一點點歪（第 i 張；第 0 張在最上面）。 */
const STACK = [
  { x: 0, y: 0, rot: 0 },
  { x: 0.014, y: 0.012, rot: -2.6 },
  { x: -0.012, y: 0.022, rot: 2.2 },
  { x: 0.02, y: 0.032, rot: -1.3 },
  { x: -0.016, y: 0.04, rot: 3.1 },
] as const;
const STACK_Y = -0.02;
const STACK_SCALE = 0.9;
/** 還在卡包裡：在卡包本體後面（看不到），比疊好的位置低。 */
const IN_PACK = { y: 0.2, scale: 0.8 } as const;
/** 剛翻開的那張：在最前面、放大一點。 */
const SPOTLIGHT = { y: -0.05, scale: 1 } as const;

export interface FanSlot {
  x: number;
  y: number;
  /** 度。 */
  rot: number;
}

/**
 * 扇形：照每張卡的高／寬（cardH）排，橫的卡分到比較寬的位置（照縮圖本身的比例，不拉變形）；
 * 整排置中、中間那張不歪、兩端往外歪、往下一點。
 */
export function fanLayout(cardHeights: readonly number[]): FanSlot[] {
  const n = cardHeights.length;
  if (n === 0) return [];
  const widths = cardHeights.map((hw) => FAN_SCALE * Math.min(1, 1 / (hw > 0 ? hw : 1)));
  const xs = [0];
  for (let i = 1; i < n; i++) xs.push(xs[i - 1]! + ((widths[i - 1]! + widths[i]!) / 2) * FAN_STEP);
  const shift = (xs[0]! - widths[0]! / 2 + xs[n - 1]! + widths[n - 1]! / 2) / 2;
  const mid = (n - 1) / 2;
  const span = Math.max(1, mid * mid);
  return xs.map((x, i) => {
    const off = i - mid;
    return { x: x - shift, y: FAN_Y + (FAN_ARC * off * off) / span, rot: off * FAN_TILT_DEG || 0 };
  });
}

export interface CardPose {
  x: number;
  y: number;
  rot: number;
  scale: number;
  /** 疊的順序（大的在前面）。 */
  z: number;
  /** 正面朝上。 */
  faceUp: boolean;
  /** 看得到（還沒撕開時藏在卡包裡）。 */
  shown: boolean;
}

/** 第 index 張卡在這個狀態的位置。 */
export function cardPose(state: PackState, index: number, fan: readonly FanSlot[]): CardPose {
  const { phase, count, revealed } = state;
  const stack = (): CardPose => {
    const j = STACK[index % STACK.length]!;
    return { x: j.x, y: STACK_Y + j.y, rot: j.rot, scale: STACK_SCALE, z: 30 + count - index, faceUp: false, shown: true };
  };
  const inFan = (): CardPose => {
    const f = fan[index] ?? { x: 0, y: FAN_Y, rot: 0 };
    return { x: f.x, y: f.y, rot: f.rot, scale: FAN_SCALE, z: 10 + index, faceUp: true, shown: true };
  };
  switch (phase) {
    case 'sealed':
      return { x: 0, y: IN_PACK.y, rot: 0, scale: IN_PACK.scale, z: 30 + count - index, faceUp: false, shown: false };
    case 'torn':
    case 'dealt':
      return stack();
    case 'revealing':
      if (index < revealed - 1) return inFan();
      if (index === revealed - 1) return { x: 0, y: SPOTLIGHT.y, rot: 0, scale: SPOTLIGHT.scale, z: 60, faceUp: true, shown: true };
      return stack();
    case 'done':
      return inFan();
  }
}

// ---- 卡池 ----

/** 範例預覽圖讀到之前先當這個比例（標準卡的預覽圖 377×512；讀到圖就照圖本身的比例）。 */
const SAMPLE_PREVIEW_H = 512 / 377;

export interface PackCard {
  /** 卡池裡不重複的鍵：card:<id>／sample:<index>。 */
  key: string;
  name: string;
  /** 卡片庫的卡（打開它）或第 index 張範例（建立副本）。 */
  source: { kind: 'card'; id: string } | { kind: 'sample'; index: number };
  /** 卡面格子的高／寬。 */
  cardH: number;
  /**
   * card＝卡片庫縮圖（透明底、四邊各有卡片長邊 4% 的空邊，格子照卡片比例）；
   * whole＝範例的預覽圖（整張不透明、卡片放在舞台底色上），整張照圖本身的比例放。
   */
  fit: 'card' | 'whole';
  /** 卡片庫的卡沒有縮圖時畫卡身顏色。 */
  bodyColor?: string;
  /** CD 光碟（T-810c）：沒有縮圖時的外形與翻開的彩虹光畫成圓環（CSS）；一般卡省略。 */
  disc?: true;
  /** 卡面的圖；抽到才讀。讀不到回 null。 */
  thumbnail(): Promise<Blob | null>;
}

/**
 * 卡池＝卡片庫的卡（同一張只算一次）＋範例（照順序）。範例的預覽圖抽到才讀。
 * sampleAliases[i]＝第 i 張範例在各種語言的名字（預設四種語言，T-828g）：卡片庫裡有任何一個同名的卡，那張範例就不放。
 */
export function packPool(
  cards: readonly LibraryCard[],
  sampleNames: readonly string[],
  samplePreview: (index: number) => Promise<Blob | null>,
  sampleAliases: readonly (readonly string[])[] = SAMPLE_NAMES_ALL_LANGS,
): PackCard[] {
  const out: PackCard[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const key = `card:${card.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const thumb = card.thumbnail ?? null;
    out.push({
      key,
      name: card.name,
      source: { kind: 'card', id: card.id },
      cardH: aspectHeight(card),
      fit: 'card',
      ...(card.bodyColor ? { bodyColor: card.bodyColor } : {}),
      ...(card.kind === 'disc' ? { disc: true as const } : {}),
      thumbnail: () => Promise.resolve(thumb),
    });
  }
  // 和卡片庫同名的範例不放：第一次開啟時範例已經匯入成使用者的卡，不然一包會抽到好幾張一樣的（主對話 T-808 驗收時決定）。
  // 範例匯入時卡名是當時語言的名字，換了語言再開一包也要擋住：同一張範例的各語言名字都算同名（T-828g）
  const libraryNames = new Set(cards.map((card) => card.name));
  sampleNames.forEach((name, index) => {
    if (libraryNames.has(name) || sampleAliases[index]?.some((alias) => libraryNames.has(alias))) return;
    out.push({
      key: `sample:${index}`,
      name,
      source: { kind: 'sample', index },
      cardH: SAMPLE_PREVIEW_H,
      fit: 'whole',
      thumbnail: () => samplePreview(index),
    });
  });
  return out;
}

// ---- 畫面 ----

export interface PackHooks {
  /** 這一包的卡池（卡片庫的卡＋範例）；每次開包、再開一包都叫一次。 */
  pool(): Promise<PackCard[]>;
  /** 〔打開這張〕：開包畫面已經收起來了。 */
  pick(card: PackCard): void;
  /** 使用者關掉開包畫面（〔關閉〕、第二次 Esc）：焦點要回到〔開一包〕。 */
  closed(): void;
}

export interface PackOpening {
  readonly el: HTMLElement;
  isOpen(): boolean;
  /** 打開並抽一包（焦點放到卡包上）。 */
  open(): void;
  /** 使用者關掉：收起來並通知 closed。 */
  close(): void;
  /** 安靜收起（新卡片面板整個關掉時）：計時器停掉、縮圖收回，不通知。 */
  hide(): void;
  /** Esc：還沒到扇形 → 跳過；已經是扇形 → 關掉。 */
  escape(): void;
}

interface Slot {
  card: PackCard;
  el: HTMLElement;
  label: HTMLElement;
  open: HTMLButtonElement;
  /** 卡面格子的高／寬（範例的圖讀到後照圖本身的比例）。 */
  cardH: number;
}

/** 作業系統設了減少動態效果（每次開包讀當下的設定）。 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createPackOpening(hooks: PackHooks): PackOpening {
  let openState = false;
  /** 每抽一次加一：晚到的卡池、縮圖認得出是上一包的。 */
  let token = 0;
  /** null＝卡池還在讀（畫面先顯示還沒撕開的卡包）。 */
  let state: PackState | null = null;
  /** 卡池還在讀時就點了卡包或跳過：讀好再照順序做。 */
  let queued: PackEvent[] = [];
  let slots: Slot[] = [];
  let urls: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reduced = false;

  // ---- 上方：標題、提示、〔跳過〕 ----
  const hint = h('p', { className: 'pk-hint', attrs: { 'aria-live': 'polite' } });
  const skipBtn = button('btn pk-skip', [S.pack.skip], S.pack.skipTip);
  skipBtn.addEventListener('click', () => step('skip'));
  const top = h('div', { className: 'pk-top' }, [h('h2', { className: 'pk-title', text: S.newCard.pack, attrs: { id: 'pk-title' } }), hint, skipBtn]);

  // ---- 中間：卡包（同一張圖用 clip-path 切成上緣一條＋本體）、卡片、點一下的地方 ----
  const packImg = (part: string) => h('span', { className: `pk-pack-img ${part}` });
  const packEl = h('div', { className: 'pk-pack', attrs: { 'aria-hidden': 'true' } }, [
    h('div', { className: 'pk-pack-float' }, [
      packImg('pk-pack-body'),
      h('span', { className: 'pk-pack-shine' }, [h('span', { className: 'pk-pack-shine-bar' })]),
      packImg('pk-pack-strip'),
      h('span', { className: 'pk-pack-tear' }),
    ]),
  ]);
  const cardsLayer = h('div', { className: 'pk-cards' });
  // 整個中間都能點（點卡包、點一下翻開）；Enter／空白鍵是按鈕本來就有的
  const tapBtn = button('pk-tap', []);
  tapBtn.addEventListener('click', () => step('next'));
  const stage = h('div', { className: 'pk-stage' }, [packEl, cardsLayer, tapBtn]);

  // ---- 下方（扇形時）：〔再開一包〕〔關閉〕 ----
  const againBtn = button('btn btn-lg pk-again', [icon('sparkle', 20), h('span', { text: S.pack.again })], S.pack.againTip);
  againBtn.addEventListener('click', () => draw());
  const closeBtn = button('btn btn-lg pk-close', [h('span', { text: S.pack.close })], S.pack.closeTip);
  closeBtn.addEventListener('click', () => close());
  const actions = h('div', { className: 'pk-actions' }, [againBtn, closeBtn]);

  // DOM 順序＝Tab 順序：扇形的〔打開這張〕／卡包 → 〔跳過〕 → 〔再開一包〕〔關閉〕
  const el = h('div', { className: 'pk-overlay', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pk-title' } }, [stage, top, actions]);
  el.style.setProperty('--pk-fan', String(FAN_SCALE));
  el.hidden = true;

  // ---- 每張卡 ----
  const buildSlot = (card: PackCard, mine: number): Slot => {
    const front = h('span', { className: `pk-face pk-front is-${card.fit}${card.disc ? ' is-disc' : ''}` }, [
      h('span', { className: 'pk-rainbow', attrs: { 'aria-hidden': 'true' } }, [h('span', { className: 'pk-rainbow-bar' })]),
    ]);
    const back = h('span', { className: 'pk-face pk-back' });
    const cardEl = h('span', { className: 'pk-card', attrs: { 'aria-hidden': 'true' } }, [h('span', { className: 'pk-flip' }, [back, front])]);
    const sample = card.source.kind === 'sample';
    const name = h('span', { className: 'pk-name', text: card.name, title: card.name });
    const open = button('btn pk-open', [S.pack.open], sample ? S.pack.openSampleTip : S.pack.openCardTip);
    open.setAttribute('aria-label', S.pack.openLabel(card.name));
    open.addEventListener('click', () => {
      hide();
      hooks.pick(card);
    });
    const label = h('div', { className: 'pk-label' }, [
      h('span', { className: 'pk-name-row' }, [name, sample ? h('span', { className: 'pk-tag', text: S.pack.sampleTag }) : null]),
      open,
    ]);
    label.inert = true;
    const slotEl = h('div', { className: 'pk-slot' }, [cardEl, label]);
    setShapeHeight(slotEl, card.cardH);
    const slot: Slot = { card, el: slotEl, label, open, cardH: card.cardH };
    loadFace(slot, front, mine);
    return slot;
  };

  /** 卡面的圖：讀好才放；讀不到就畫卡身顏色的卡片外形。範例照圖本身的比例。 */
  const loadFace = (slot: Slot, front: HTMLElement, mine: number) => {
    let read: Promise<Blob | null>;
    try {
      read = slot.card.thumbnail();
    } catch (err) {
      read = Promise.reject(err);
    }
    void read
      .catch((err: unknown) => {
        console.error(err);
        return null;
      })
      .then((blob) => {
        if (mine !== token) return;
        /** 沒有縮圖、或縮圖解不開：畫卡身顏色的卡片外形。 */
        const showPlain = () => {
          const plain = h('span', { className: 'pk-plain' });
          if (slot.card.bodyColor) plain.style.backgroundColor = slot.card.bodyColor;
          front.prepend(plain);
        };
        if (!blob) {
          showPlain();
          return;
        }
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = h('img', { className: 'pk-img', attrs: { src: url, alt: '', draggable: 'false', decoding: 'async' } });
        // 檔頭合格但圖片資料壞掉、解不開：拿掉圖、收回網址、改畫卡片外形（T-808 審查）
        img.addEventListener('error', () => {
          if (mine !== token) return;
          img.remove();
          URL.revokeObjectURL(url);
          showPlain();
        });
        if (slot.card.fit === 'whole') {
          img.addEventListener('load', () => {
            if (mine !== token || !(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
            slot.cardH = img.naturalHeight / img.naturalWidth;
            setShapeHeight(slot.el, slot.cardH);
            render();
          });
        }
        front.prepend(img);
      });
  };

  // ---- 畫狀態 ----
  /** 這個元素在開包畫面裡、而且現在按得到（自己和祖先都沒藏起來、沒 inert）。 */
  const usable = (node: HTMLElement | null): boolean => {
    if (!node || !el.contains(node)) return false;
    for (let n: HTMLElement | null = node; n && n !== el; n = n.parentNode as HTMLElement | null) if (n.hidden || n.inert) return false;
    return true;
  };

  function render(): void {
    if (!openState) return;
    const phase = state?.phase ?? 'sealed';
    const done = phase === 'done';
    // 減少動態效果、卡池還在讀：不先閃一下卡包（讀好直接是扇形）
    const waitingStill = !state && reduced;
    el.dataset.phase = phase;
    setText(hint, waitingStill ? S.pack.preparing : packHint(state));
    tapBtn.setAttribute('aria-label', phase === 'sealed' || phase === 'torn' ? S.pack.tearLabel : S.pack.flipLabel);
    setHidden(tapBtn, done || waitingStill);
    setHidden(skipBtn, done);
    setHidden(actions, !done);
    setHidden(packEl, waitingStill || !(phase === 'sealed' || phase === 'torn'));
    if (state) {
      const s = state;
      const fan = fanLayout(slots.map((slot) => slot.cardH));
      slots.forEach((slot, i) => {
        const p = cardPose(s, i, fan);
        const st = slot.el.style;
        st.setProperty('--x', String(p.x));
        st.setProperty('--y', String(p.y));
        st.setProperty('--r', String(p.rot));
        st.setProperty('--s', String(p.scale));
        // 撕開時一張接一張滑出；之後（含跳過）馬上動
        st.setProperty('--pk-delay', s.phase === 'torn' ? `${dealDelayMs(i, s.count)}ms` : '0ms');
        st.zIndex = String(p.z);
        toggleClass(slot.el, 'is-shown', p.shown);
        toggleClass(slot.el, 'is-up', p.faceUp);
        toggleClass(slot.el, 'is-new', s.phase === 'revealing' && i === s.revealed - 1);
        slot.label.inert = !done;
      });
    }
    // 焦點：按的東西藏起來了（撕開、跳過、再開一包）就移到現在要按的地方
    const active = document.activeElement as HTMLElement | null;
    if (done) {
      if (!usable(active)) (slots[0]?.open ?? againBtn).focus({ preventScroll: true });
    } else if (!usable(active)) {
      (waitingStill ? skipBtn : tapBtn).focus({ preventScroll: true });
    }
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = undefined;
    const wait = state ? packWait(state) : null;
    if (!wait) return;
    timer = setTimeout(() => {
      timer = undefined;
      step(wait.event);
    }, wait.ms);
  }

  function step(event: PackEvent): void {
    if (!openState) return;
    if (!state) {
      if (event !== 'settled' && !queued.includes(event)) queued.push(event);
      return;
    }
    const next = packStep(state, event);
    if (next === state) return;
    state = next;
    render();
    schedule();
  }

  /** 收掉這一包：計時器、卡片、縮圖的 object URL。 */
  function teardown(): void {
    clearTimeout(timer);
    timer = undefined;
    state = null;
    queued = [];
    slots = [];
    cardsLayer.replaceChildren();
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  }

  /** 抽一包：先顯示還沒撕開的卡包，卡池讀好再抽、擺好卡片。 */
  function draw(): void {
    teardown();
    const mine = ++token;
    reduced = prefersReducedMotion();
    render();
    let read: Promise<PackCard[]>;
    try {
      read = hooks.pool();
    } catch (err) {
      read = Promise.reject(err);
    }
    void read
      .catch((err: unknown) => {
        console.error(err);
        return [] as PackCard[];
      })
      .then((pool) => {
        if (mine !== token || !openState) return;
        slots = drawPack(pool, PACK_SIZE, Math.random).map((card) => buildSlot(card, mine));
        cardsLayer.replaceChildren(...slots.map((slot) => slot.el));
        state = packStart(slots.length, reduced);
        render();
        const pending = queued;
        queued = [];
        if (pending.length > 0) {
          // 讀卡池時就點了卡包：先讓瀏覽器算好卡片在卡包裡的樣子，接著撕開才有滑出來的動畫
          void cardsLayer.offsetWidth;
          for (const e of pending) step(e);
        }
        schedule();
      });
  }

  function hide(): void {
    if (!openState) return;
    openState = false;
    token++;
    teardown();
    el.hidden = true;
  }

  function close(): void {
    if (!openState) return;
    hide();
    hooks.closed();
  }

  return {
    el,
    isOpen: () => openState,
    open() {
      if (openState) return;
      openState = true;
      el.hidden = false;
      draw();
    },
    close,
    hide,
    escape() {
      if (!openState) return;
      // 還在讀卡池時第二次 Esc 也是關掉
      if (state?.phase === 'done' || (!state && queued.includes('skip'))) close();
      else step('skip');
    },
  };
}
