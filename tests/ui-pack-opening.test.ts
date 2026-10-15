// 開一包（T-808，DESIGN 7.3）：新卡片面板最下面〔開一包〕→ 從卡片庫的卡＋四張範例隨機抽（不重複、最多 5 張）→
// 撕開卡包、卡片一張張滑出背面朝上疊好 → 一張張翻開 → 排成扇形；〔跳過〕／Esc 直接到扇形，再按一次 Esc 關掉；
// 減少動態直接顯示扇形。只是展示，不改任何資料：〔打開這張〕走現有的開卡／範例副本 intent。
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusableIn } from '../src/ui/focus';
import { SAMPLE_NAMES } from '../src/ui/library-logic';
import { createNewCardPanel, type NewCardHooks } from '../src/ui/new-card';
import {
  cardPose,
  drawPack,
  fanLayout,
  PACK_SIZE,
  PACK_TIMING,
  packPool,
  packStart,
  packStep,
  packWait,
  tearMs,
  type PackState,
} from '../src/ui/pack-opening';
import type { LibraryCard } from '../src/ui/types';
import { all, byClass, buttonWithText, FakeElement, FakeEvent, flush, installFakeDom, isShown, keydown } from './ui-fake-dom';

const STD_H = 88 / 63;
const T0 = '2026-10-14T00:00:00.000Z';

/** 固定的亂數：照順序吐出 values，用完重頭。 */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const libCard = (id: string, name: string, extra: Partial<LibraryCard> = {}): LibraryCard => ({
  id,
  name,
  aspect: 'standard',
  createdAt: T0,
  updatedAt: T0,
  thumbnail: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
  ...extra,
});

// ---------------------------------------------------------------------------------------------
// 純函式
// ---------------------------------------------------------------------------------------------

describe('drawPack：抽卡', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

  it('抽 5 張、不重複、都來自卡池', () => {
    for (const r of [0, 0.3, 0.5, 0.77, 0.999]) {
      const got = drawPack(pool, PACK_SIZE, () => r);
      expect(got).toHaveLength(5);
      expect(new Set(got).size).toBe(5);
      for (const x of got) expect(pool).toContain(x);
    }
    expect(PACK_SIZE).toBe(5);
  });

  it('真的亂數跑很多次也不會重複', () => {
    for (let k = 0; k < 200; k++) {
      const got = drawPack(pool, 5, Math.random);
      expect(new Set(got).size).toBe(5);
    }
  });

  it('不到 5 張就全部（只換順序）；空的卡池抽到 0 張', () => {
    const small = ['x', 'y', 'z', 'w'];
    const got = drawPack(small, 5, seq(0.9, 0.1, 0.5));
    expect(got).toHaveLength(4);
    expect([...got].sort()).toEqual([...small].sort());
    expect(drawPack([], 5, Math.random)).toEqual([]);
  });

  it('固定亂數：結果穩定（同樣的亂數 → 同樣的五張、同樣的順序）', () => {
    const a = drawPack(pool, 5, seq(0.42, 0.13, 0.87, 0.5, 0.05));
    const b = drawPack(pool, 5, seq(0.42, 0.13, 0.87, 0.5, 0.05));
    expect(a).toEqual(b);
    // Fisher–Yates：0.42×9→3（d）、0.13×8→1+1（c）、0.87×7→6+2（i）、0.5×6→3+3（g）、0.05×5→0+4（e）
    expect(a).toEqual(['d', 'c', 'i', 'g', 'e']);
  });

  it('亂數吐 1（或超出範圍）也不會抽到卡池外面；不改到原本的陣列', () => {
    const copy = [...pool];
    const got = drawPack(pool, 5, () => 1);
    expect(got.every((x) => pool.includes(x))).toBe(true);
    expect(new Set(got).size).toBe(5);
    expect(pool).toEqual(copy);
  });
});

describe('packStep：狀態機 sealed → torn → dealt → revealing(n) → done', () => {
  const s = (phase: PackState['phase'], revealed = 0, count = 3): PackState => ({ phase, count, revealed });

  it('開始：平常是 sealed；減少動態直接 done（全部翻開）', () => {
    expect(packStart(3, false)).toEqual(s('sealed'));
    expect(packStart(3, true)).toEqual(s('done', 3));
  });

  it('sealed：點一下 → torn；其他事件不動', () => {
    expect(packStep(s('sealed'), 'next')).toEqual(s('torn'));
    const sealed = s('sealed');
    expect(packStep(sealed, 'settled')).toBe(sealed);
  });

  it('torn：撕開、滑出的動畫跑完（settled）→ dealt；撕開中點一下不算（免得連點跳過）', () => {
    const torn = s('torn');
    expect(packStep(torn, 'next')).toBe(torn);
    expect(packStep(torn, 'settled')).toEqual(s('dealt'));
  });

  it('dealt：點一下 → revealing(1)；revealing(n) → revealing(n+1)；最後一張翻開後再一下 → done', () => {
    expect(packStep(s('dealt'), 'next')).toEqual(s('revealing', 1));
    expect(packStep(s('revealing', 1), 'next')).toEqual(s('revealing', 2));
    expect(packStep(s('revealing', 2), 'next')).toEqual(s('revealing', 3));
    expect(packStep(s('revealing', 3), 'next')).toEqual(s('done', 3));
    const dealt = s('dealt');
    expect(packStep(dealt, 'settled')).toBe(dealt);
  });

  it('跳過：任何階段直接 done（全部翻開）；done 什麼事件都不動', () => {
    for (const from of [s('sealed'), s('torn'), s('dealt'), s('revealing', 1), s('revealing', 3)]) {
      expect(packStep(from, 'skip')).toEqual(s('done', 3));
    }
    const done = s('done', 3);
    for (const e of ['next', 'settled', 'skip'] as const) expect(packStep(done, e)).toBe(done);
  });

  it('等多久自動往下：torn 等滑出動畫跑完；dealt 停 0.8 秒；翻開一張後等翻面動畫＋0.8 秒；sealed、done 不自動', () => {
    expect(PACK_TIMING.autoMs).toBe(800);
    expect(packWait(s('sealed'))).toBeNull();
    expect(packWait(s('done', 3))).toBeNull();
    expect(packWait(s('torn'))).toEqual({ event: 'settled', ms: tearMs(3) });
    expect(packWait(s('dealt'))).toEqual({ event: 'next', ms: 800 });
    expect(packWait(s('revealing', 2))).toEqual({ event: 'next', ms: PACK_TIMING.flipMs + 800 });
  });

  it('tearMs：最後一張滑出來才算好（張數越多越久）', () => {
    expect(tearMs(5)).toBeGreaterThan(tearMs(1));
    expect(tearMs(5)).toBe(PACK_TIMING.dealStartMs + 4 * PACK_TIMING.dealStepMs + PACK_TIMING.dealMoveMs);
  });
});

describe('cardPose／fanLayout：每張卡在哪裡', () => {
  it('扇形：一樣大的卡左右對稱、中間那張不歪；橫的卡分到比較寬的位置', () => {
    const fan = fanLayout([STD_H, STD_H, STD_H, STD_H, STD_H]);
    expect(fan).toHaveLength(5);
    expect(fan[2]!.x).toBeCloseTo(0);
    expect(fan[2]!.rot).toBeCloseTo(0);
    expect(fan[0]!.x).toBeCloseTo(-fan[4]!.x);
    expect(fan[0]!.rot).toBeCloseTo(-fan[4]!.rot);
    expect(fan[0]!.y).toBeCloseTo(fan[4]!.y);
    // 從左到右
    for (let i = 1; i < 5; i++) expect(fan[i]!.x).toBeGreaterThan(fan[i - 1]!.x);
    const tall = fanLayout([STD_H, STD_H]);
    const wide = fanLayout([STD_H, 0.68]);
    expect(wide[1]!.x - wide[0]!.x).toBeGreaterThan(tall[1]!.x - tall[0]!.x);
  });

  it('疊著時背面朝上、第一張在最上面；翻開的那張在最前面正面朝上，之前翻的已經在扇形位置', () => {
    const fan = fanLayout([STD_H, STD_H, STD_H]);
    const dealt: PackState = { phase: 'dealt', count: 3, revealed: 0 };
    const poses = [0, 1, 2].map((i) => cardPose(dealt, i, fan));
    expect(poses.every((p) => !p.faceUp && p.shown)).toBe(true);
    expect(poses[0]!.z).toBeGreaterThan(poses[1]!.z);
    const rev: PackState = { phase: 'revealing', count: 3, revealed: 2 };
    const [a, b, c] = [0, 1, 2].map((i) => cardPose(rev, i, fan));
    expect(a).toMatchObject({ x: fan[0]!.x, y: fan[0]!.y, rot: fan[0]!.rot, faceUp: true });
    expect(b!.faceUp).toBe(true);
    expect(b!.z).toBeGreaterThan(c!.z);
    expect(b!.z).toBeGreaterThan(a!.z);
    expect(c!.faceUp).toBe(false);
    const sealed = cardPose({ phase: 'sealed', count: 3, revealed: 0 }, 0, fan);
    expect(sealed.shown).toBe(false);
    const done = [0, 1, 2].map((i) => cardPose({ phase: 'done', count: 3, revealed: 3 }, i, fan));
    expect(done.map((p) => [p.x, p.faceUp])).toEqual(fan.map((f) => [f.x, true]));
  });
});

describe('packPool：卡池＝卡片庫的卡＋四張範例', () => {
  it('和卡片庫同名的範例不放（第一次開啟時範例已經匯入成使用者的卡，不然一包會抽到好幾張一樣的；主對話 T-808 驗收時決定）', () => {
    const preview = vi.fn(async () => null);
    const pool = packPool([libCard('a', SAMPLE_NAMES[0]!), libCard('b', SAMPLE_NAMES[3]!), libCard('c', '我的卡')], SAMPLE_NAMES, preview);
    expect(pool.map((c) => c.name)).toEqual([SAMPLE_NAMES[0], SAMPLE_NAMES[3], '我的卡', SAMPLE_NAMES[1], SAMPLE_NAMES[2], SAMPLE_NAMES[4], SAMPLE_NAMES[5]]);
    expect(pool.filter((c) => c.source.kind === 'sample').map((c) => c.source)).toEqual([
      { kind: 'sample', index: 1 },
      { kind: 'sample', index: 2 },
      { kind: 'sample', index: 4 },
      { kind: 'sample', index: 5 },
    ]);
  });

  it('卡片庫的卡（照卡片比例、用縮圖）＋四張範例（照預覽圖本身的比例）；範例的縮圖抽到才讀', async () => {
    const preview = vi.fn(async (i: number) => new Blob([String(i)], { type: 'image/png' }));
    const pool = packPool([libCard('a', '甲'), libCard('b', '乙', { aspect: 'postcard', thumbnail: undefined, bodyColor: '#123456' })], SAMPLE_NAMES, preview);
    expect(pool.map((c) => c.name)).toEqual(['甲', '乙', ...SAMPLE_NAMES]);
    expect(new Set(pool.map((c) => c.key)).size).toBe(2 + SAMPLE_NAMES.length);
    expect(pool[0]).toMatchObject({ source: { kind: 'card', id: 'a' }, fit: 'card' });
    expect(pool[0]!.cardH).toBeCloseTo(STD_H);
    expect(pool[1]!.cardH).toBeCloseTo(1.48);
    expect(pool[1]!.bodyColor).toBe('#123456');
    expect(await pool[1]!.thumbnail()).toBeNull();
    expect(pool[2]).toMatchObject({ source: { kind: 'sample', index: 0 }, fit: 'whole' });
    expect(preview).not.toHaveBeenCalled();
    const blob = await pool[5]!.thumbnail();
    expect(preview).toHaveBeenCalledWith(3);
    expect(blob).toBeInstanceOf(Blob);
  });
});

// ---------------------------------------------------------------------------------------------
// 畫面（假 DOM）
// ---------------------------------------------------------------------------------------------

interface Setup {
  panel: ReturnType<typeof createNewCardPanel>;
  el: FakeElement;
  opened: string[];
  samples: number[];
  libraryCalls: number;
  packButton: FakeElement;
  pack: () => FakeElement;
  phase: () => string | undefined;
  slots: () => FakeElement[];
}

function setup(cards: LibraryCard[] = [libCard('a', '甲'), libCard('b', '乙')]): Setup {
  const opened: string[] = [];
  const samples: number[] = [];
  const t: Partial<Setup> = { opened, samples, libraryCalls: 0 };
  const hooks: NewCardHooks = {
    blank: () => {},
    disc: () => {},
    sample: (i) => samples.push(i),
    preview: async (i) => new Blob([String(i)], { type: 'image/png' }),
    changed: () => {},
    libraryCards: async () => {
      t.libraryCalls!++;
      return cards;
    },
    openCard: (id) => opened.push(id),
  };
  const panel = createNewCardPanel(hooks);
  const el = panel.el as unknown as FakeElement;
  const pack = () => byClass(el, 'pk-overlay');
  return Object.assign(t, {
    panel,
    el,
    packButton: byClass(el, 'nc-pack-btn'),
    pack,
    phase: () => pack().dataset.phase,
    slots: () => all(pack(), 'pk-slot'),
  }) as Setup;
}

const active = () => (document as unknown as { activeElement: FakeElement | null }).activeElement;

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 打開新卡片面板、按〔開一包〕、等卡池讀好。 */
async function openPack(t: Setup) {
  const opener = dom.document.createElement('button');
  opener.focus();
  t.panel.open('blank');
  t.packButton.click();
  await flush(30);
  return opener;
}

describe('新卡片面板的〔開一包〕', () => {
  it('在「從範例開始」標題的右邊（不另外佔一整列，矮視窗不用捲動；主對話 T-808 驗收時改）；滑過說明「從你的卡片和範例裡隨機抽 5 張」', () => {
    const t = setup();
    const groups = all(byClass(t.el, 'nc-body'), 'nc-group');
    const samples = groups[groups.length - 1]!;
    const head = byClass(samples, 'nc-group-head');
    expect(head.contains(t.packButton)).toBe(true);
    expect(head.textContent).toContain('從範例開始');
    expect(t.packButton.textContent).toContain('開一包');
    expect(t.packButton.title).toBe('從你的卡片和範例裡隨機抽 5 張，像開卡包一樣');
  });

  it('按下去：開包畫面蓋上來、讀卡片庫一次、後面的面板不能按；焦點在卡包上（Enter／空白鍵＝撕開）', async () => {
    const t = setup();
    expect(isShown(t.pack())).toBe(false);
    await openPack(t);
    expect(isShown(t.pack())).toBe(true);
    expect(t.libraryCalls).toBe(1);
    expect(byClass(t.el, 'nc-panel').inert).toBe(true);
    expect(t.phase()).toBe('sealed');
    expect(active()).toBe(byClass(t.pack(), 'pk-tap'));
    expect(byClass(t.pack(), 'pk-hint').textContent).toBe('點卡包撕開');
    // 亂數 0：照卡池順序抽 5 張（卡片庫 2 張＋範例前 3 張）
    expect(t.slots().map((s) => byClass(s, 'pk-name').textContent)).toEqual(['甲', '乙', ...SAMPLE_NAMES.slice(0, 3)]);
  });

  it('完整流程：點卡包 → 撕開 → 疊好 → 一張張翻（點一下或停 0.8 秒自動）→ 扇形', async () => {
    vi.useFakeTimers();
    const t = setup();
    await openPack(t);
    const tap = byClass(t.pack(), 'pk-tap');
    tap.click();
    expect(t.phase()).toBe('torn');
    expect(t.slots().every((s) => s.classList.contains('is-shown'))).toBe(true);
    expect(t.slots().some((s) => s.classList.contains('is-up'))).toBe(false);
    // 撕開中再點不算
    tap.click();
    expect(t.phase()).toBe('torn');
    vi.advanceTimersByTime(tearMs(5));
    expect(t.phase()).toBe('dealt');
    expect(isShown(byClass(t.pack(), 'pk-pack'))).toBe(false);
    // 點一下翻第一張：正面朝上、彩虹光掃過
    tap.click();
    expect(t.phase()).toBe('revealing');
    const s0 = t.slots()[0]!;
    expect(s0.classList.contains('is-up')).toBe(true);
    expect(s0.classList.contains('is-new')).toBe(true);
    // 停 0.8 秒（翻面動畫之後）自動翻下一張
    vi.advanceTimersByTime(PACK_TIMING.flipMs + PACK_TIMING.autoMs - 1);
    expect(t.slots()[1]!.classList.contains('is-up')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.slots()[1]!.classList.contains('is-up')).toBe(true);
    expect(s0.classList.contains('is-new')).toBe(false);
    // 剩下的用點的，最後排成扇形
    for (let i = 0; i < 4; i++) tap.click();
    expect(t.phase()).toBe('done');
    expect(t.slots().every((s) => s.classList.contains('is-up'))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    // 扇形：每張下面〔打開這張〕、整體〔再開一包〕〔關閉〕；焦點到第一張的〔打開這張〕
    const opens = all(t.pack(), 'pk-open');
    expect(opens).toHaveLength(5);
    expect(opens.every((b) => b.textContent === '打開這張' && isShown(b))).toBe(true);
    expect(isShown(buttonWithText(t.pack(), '再開一包'))).toBe(true);
    expect(isShown(buttonWithText(t.pack(), '關閉'))).toBe(true);
    expect(isShown(tap)).toBe(false);
    expect(active()).toBe(opens[0]);
  });

  it('〔跳過〕：任何時候直接到扇形，焦點到第一張的〔打開這張〕', async () => {
    vi.useFakeTimers();
    const t = setup();
    await openPack(t);
    byClass(t.pack(), 'pk-tap').click();
    buttonWithText(t.pack(), '跳過').click();
    expect(t.phase()).toBe('done');
    expect(t.slots().every((s) => s.classList.contains('is-up'))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(active()).toBe(all(t.pack(), 'pk-open')[0]);
    expect(isShown(buttonWithText(t.pack(), '跳過'))).toBe(false);
  });

  it('Esc 兩段：第一次跳到扇形（還開著），第二次關掉開包畫面、回到新卡片面板、焦點回〔開一包〕', async () => {
    const t = setup();
    await openPack(t);
    t.panel.escape();
    expect(t.phase()).toBe('done');
    expect(isShown(t.pack())).toBe(true);
    t.panel.escape();
    expect(isShown(t.pack())).toBe(false);
    expect(t.panel.isOpen()).toBe(true);
    expect(byClass(t.el, 'nc-panel').inert).toBe(false);
    expect(active()).toBe(t.packButton);
    // 再一次才關新卡片面板
    t.panel.escape();
    expect(t.panel.isOpen()).toBe(false);
  });

  it('〔關閉〕：關掉開包畫面，焦點回〔開一包〕', async () => {
    const t = setup();
    await openPack(t);
    t.panel.escape();
    buttonWithText(t.pack(), '關閉').click();
    expect(isShown(t.pack())).toBe(false);
    expect(active()).toBe(t.packButton);
  });

  it('減少動態：直接顯示最後的扇形（不撕、不翻、沒有計時器）', async () => {
    vi.useFakeTimers();
    (dom.window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({
      matches: q.includes('prefers-reduced-motion: reduce'),
    });
    const t = setup();
    t.panel.open('blank');
    t.packButton.click();
    // 卡池還在讀：不先閃一下卡包
    expect(isShown(byClass(t.pack(), 'pk-pack'))).toBe(false);
    expect(byClass(t.pack(), 'pk-hint').textContent).toBe('準備中…');
    await flush(30);
    expect(t.phase()).toBe('done');
    expect(t.slots().every((s) => s.classList.contains('is-up') && !s.classList.contains('is-new'))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(active()).toBe(all(t.pack(), 'pk-open')[0]);
  });

  it('鍵盤：Tab 只在開包畫面裡循環（後面的新卡片面板走不到）', async () => {
    const t = setup();
    await openPack(t);
    const order = focusableIn(t.el as unknown as HTMLElement) as unknown as FakeElement[];
    expect(order.length).toBeGreaterThan(0);
    expect(order.every((b) => t.pack().contains(b))).toBe(true);
    const last = order[order.length - 1]!;
    last.focus();
    keydown(last, 'Tab');
    expect(active()).toBe(order[0]);
    // 扇形：〔打開這張〕×5、〔再開一包〕、〔關閉〕
    t.panel.escape();
    const done = focusableIn(t.el as unknown as HTMLElement) as unknown as FakeElement[];
    expect(done.map((b) => b.textContent)).toEqual([...Array(5).fill('打開這張'), '再開一包', '關閉']);
  });

  it('〔打開這張〕：卡片庫的卡＝打開它；範例＝建立副本；新卡片面板一起關掉', async () => {
    let t = setup();
    await openPack(t);
    t.panel.escape();
    all(t.pack(), 'pk-open')[1]!.click();
    expect(t.opened).toEqual(['b']);
    expect(t.samples).toEqual([]);
    expect(t.panel.isOpen()).toBe(false);
    expect(isShown(t.pack())).toBe(false);

    t = setup();
    await openPack(t);
    t.panel.escape();
    // 第 3 張＝範例第 0 張（亂數 0：卡片庫 2 張在前）
    all(t.pack(), 'pk-open')[2]!.click();
    expect(t.samples).toEqual([0]);
    expect(t.opened).toEqual([]);
    expect(t.panel.isOpen()).toBe(false);
  });

  it('〔再開一包〕：重新讀卡池、重抽、回到還沒撕開的卡包，焦點在卡包', async () => {
    const t = setup();
    await openPack(t);
    t.panel.escape();
    expect(t.slots().map((s) => byClass(s, 'pk-name').textContent)).toEqual(['甲', '乙', '星晶龍', '颯真・雲斬', '琥根花粉獸']);
    // 這次亂數都取最後一個：抽出來的不一樣
    vi.mocked(Math.random).mockReturnValue(0.999);
    buttonWithText(t.pack(), '再開一包').click();
    await flush(30);
    expect(t.libraryCalls).toBe(2);
    expect(t.phase()).toBe('sealed');
    const names = t.slots().map((s) => byClass(s, 'pk-name').textContent);
    expect(names).toHaveLength(5);
    expect(names).not.toEqual(['甲', '乙', '星晶龍', '颯真・雲斬', '琥根花粉獸']);
    expect(active()).toBe(byClass(t.pack(), 'pk-tap'));
  });

  it('卡片庫是空的：從範例抽（T-820 起六張範例，一包最多 5 張、不重複）', async () => {
    const t = setup([]);
    await openPack(t);
    const names = t.slots().map((s) => byClass(s, 'pk-name').textContent);
    expect(names).toHaveLength(Math.min(5, SAMPLE_NAMES.length));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(SAMPLE_NAMES).toContain(n);
  });

  it('卡片庫讀取失敗：照樣用範例開包', async () => {
    const opened: string[] = [];
    const panel = createNewCardPanel({
      blank: () => {},
      disc: () => {},
      sample: () => {},
      preview: async () => null,
      changed: () => {},
      libraryCards: () => Promise.reject(new Error('boom')),
      openCard: (id) => opened.push(id),
    });
    panel.open('blank');
    byClass(panel.el, 'nc-pack-btn').click();
    await flush(30);
    expect(all(byClass(panel.el, 'pk-overlay'), 'pk-slot')).toHaveLength(Math.min(5, SAMPLE_NAMES.length));
  });

  it('範例縮圖第一次讀不到：開一包抽到時再讀一次（讀到的才留著，不重讀）', async () => {
    const calls: number[] = [];
    const panel = createNewCardPanel({
      blank: () => {},
      disc: () => {},
      sample: () => {},
      preview: async (i) => {
        calls.push(i);
        return calls.length <= SAMPLE_NAMES.length ? null : new Blob([String(i)], { type: 'image/png' });
      },
      changed: () => {},
      libraryCards: async () => [],
      openCard: () => {},
    });
    panel.open('blank');
    await flush(30);
    const every = SAMPLE_NAMES.map((_, i) => i);
    expect(calls).toEqual(every);
    byClass(panel.el, 'nc-pack-btn').click();
    await flush(30);
    // 一包最多 5 張：抽到的才再讀一次（不重複）
    const drawn = Math.min(5, SAMPLE_NAMES.length);
    const reread = calls.slice(SAMPLE_NAMES.length);
    expect(reread).toHaveLength(drawn);
    expect(new Set(reread).size).toBe(drawn);
    const pack = byClass(panel.el, 'pk-overlay');
    expect(all(pack, 'pk-img')).toHaveLength(drawn);
    // 讀到了就留著：再開一包不重讀（每張最多讀兩次：第一次讀不到、抽到時再讀到）
    panel.escape();
    buttonWithText(pack, '再開一包').click();
    await flush(30);
    for (const i of every) expect(calls.filter((c) => c === i).length, `sample ${i}`).toBeLessThanOrEqual(2);
  });

  it('還在讀卡池時點卡包：讀好後照樣撕開', async () => {
    let release!: (cards: LibraryCard[]) => void;
    const panel = createNewCardPanel({
      blank: () => {},
      disc: () => {},
      sample: () => {},
      preview: async () => null,
      changed: () => {},
      libraryCards: () => new Promise((res) => (release = res)),
      openCard: () => {},
    });
    panel.open('blank');
    byClass(panel.el, 'nc-pack-btn').click();
    const pack = byClass(panel.el, 'pk-overlay');
    byClass(pack, 'pk-tap').click();
    expect(pack.dataset.phase).toBe('sealed');
    release([libCard('a', '甲')]);
    await flush(30);
    expect(pack.dataset.phase).toBe('torn');
  });

  it('新卡片面板被關掉（例如被另一個分頁接手）：開包畫面一起收起、計時器停掉', async () => {
    vi.useFakeTimers();
    const t = setup();
    await openPack(t);
    byClass(t.pack(), 'pk-tap').click();
    t.panel.close();
    expect(isShown(t.pack())).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(byClass(t.el, 'nc-panel').inert).toBe(false);
  });

  it('卡名一律當純文字顯示（textContent）：匯入的卡名裡的標籤不會變成元素', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const t = setup([libCard('z', evil)]);
    await openPack(t);
    const slot = t.slots().find((s) => byClass(s, 'pk-name').textContent === evil)!;
    expect(slot).toBeDefined();
    expect(byClass(slot, 'pk-name').children).toEqual([]);
    expect(all(slot, 'pk-img').every((img) => img.getAttribute('alt') === '')).toBe(true);
  });

  it('卡片縮圖：卡片庫的卡照卡片比例（--card-hw）、用 object URL；關掉時收回', async () => {
    const revoked: string[] = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
    const t = setup([libCard('a', '甲', { aspect: 'postcard' })]);
    await openPack(t);
    const slot = t.slots().find((s) => byClass(s, 'pk-name').textContent === '甲')!;
    expect(Number(slot.style.getPropertyValue('--card-hw'))).toBeCloseTo(1.48);
    const img = byClass(slot, 'pk-img');
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    t.panel.escape();
    t.panel.escape();
    expect(revoked).toContain(img.getAttribute('src'));
  });
});

describe('縮圖讀不出來（T-808 審查）', () => {
  it('圖片解不開（error）：拿掉圖、收回 object URL、改畫卡身顏色的卡片外形', async () => {
    const revoked: string[] = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
    const t = setup([libCard('a', '甲', { bodyColor: '#123456' })]);
    await openPack(t);
    const slot = t.slots().find((s) => byClass(s, 'pk-name').textContent === '甲')!;
    const img = byClass(slot, 'pk-img');
    const src = img.getAttribute('src')!;
    img.dispatchEvent(new FakeEvent('error'));
    expect(all(slot, 'pk-img')).toHaveLength(0);
    expect(revoked).toContain(src);
    const plain = byClass(slot, 'pk-plain');
    expect(plain.style.backgroundColor).toBe('#123456');
  });
});

describe('光碟（T-810c）', () => {
  it('packPool：卡片庫的光碟標記 disc，一般卡沒有', () => {
    const pool = packPool([libCard('a', '甲'), libCard('d', '光', { kind: 'disc', aspect: 'square' })], SAMPLE_NAMES, async () => null);
    expect(pool[0]!.disc).toBeUndefined();
    expect(pool[1]!.disc).toBe(true);
  });

  it('沒有縮圖的光碟：卡面是 is-disc（卡身外形與翻開的彩虹光畫成圓環，CSS 遮罩）；一般卡不是', async () => {
    const t = setup([libCard('d', '光', { kind: 'disc', aspect: 'square', thumbnail: undefined }), libCard('a', '甲', { thumbnail: undefined })]);
    await openPack(t);
    const disc = t.slots().find((s) => byClass(s, 'pk-name').textContent === '光')!;
    const card = t.slots().find((s) => byClass(s, 'pk-name').textContent === '甲')!;
    expect(byClass(disc, 'pk-front').className).toContain('is-disc');
    expect(byClass(card, 'pk-front').className).not.toContain('is-disc');
    expect(all(disc, 'pk-plain')).toHaveLength(1);
  });

  it('style.css：光碟的卡身外形與彩虹光是圓的、中間有孔', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.pk-front\.is-disc \.pk-plain\s*\{[^}]*border-radius:\s*50%[^}]*mask:\s*radial-gradient/);
    expect(css).toMatch(/\.pk-front\.is-disc \.pk-rainbow\s*\{[^}]*border-radius:\s*50%[^}]*mask:\s*radial-gradient/);
  });
});

describe('原始碼：不用 innerHTML（硬邊界 4）、只動 transform／opacity', () => {
  it('pack-opening.ts、new-card.ts 沒有 innerHTML／outerHTML／insertAdjacentHTML', () => {
    for (const file of ['../src/ui/pack-opening.ts', '../src/ui/new-card.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });

  it('style.css 的開包段（T-808）：轉場與動畫只動 transform、opacity', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const start = css.indexOf('T-808');
    expect(start).toBeGreaterThan(0);
    const section = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, '');
    // 轉場的屬性（用逗號切，括號裡的不切）
    const splitTop = (value: string) => {
      const out: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === '(') depth++;
        else if (value[i] === ')') depth--;
        else if (value[i] === ',' && depth === 0) {
          out.push(value.slice(start, i));
          start = i + 1;
        }
      }
      out.push(value.slice(start));
      return out.map((s) => s.trim());
    };
    let transitions = 0;
    for (const m of section.matchAll(/transition\s*:\s*([^;]+);/g)) {
      const value = m[1]!.trim();
      if (value === 'none') continue;
      for (const item of splitTop(value)) {
        transitions++;
        expect(item.split(/\s+/)[0], item).toMatch(/^(transform|opacity)$/);
      }
    }
    expect(transitions).toBeGreaterThan(5);
    // 關鍵影格裡改的屬性
    for (const kf of section.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)) {
      for (const d of kf[1]!.matchAll(/([a-z-]+)\s*:/g)) expect(d[1], kf[0].slice(0, 40)).toMatch(/^(transform|opacity)$/);
    }
  });
});
