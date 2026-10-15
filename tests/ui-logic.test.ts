import { describe, expect, it } from 'vitest';
import { HOLO_PALETTES, type Layer } from '../src/model/types';
import {
  COLOR_TABLE,
  displayOrder,
  escapeAction,
  HOLO_PALETTE_OPTIONS,
  holoStrengthText,
  paletteColors,
  paletteGradient,
  replaceColor,
  shadowStrengthText,
  indexAtY,
  isTextEntry,
  problemText,
  scaleToSlider,
  SCALE_SLIDER_MAX,
  shortcutFor,
  sliderToScale,
  sparkleText,
  swapTarget,
  uploadMessage,
} from '../src/ui/logic';

function layer(id: string, depth: number): Layer {
  const base = depth === 0;
  return {
    id,
    name: id,
    role: base ? 'base' : 'depth',
    image: '0123456789abcdef',
    visible: true,
    depth,
    x: 0,
    y: 0,
    scale: 1,
    holo: !base,
    hasAlpha: !base,
  };
}

const LAYERS = [layer('bg', 0), layer('pine', 20), layer('hero', 50), layer('petal', 90)];

describe('圖層清單顯示順序', () => {
  it('最前面的在最上面：資料陣列（由後到前）反過來', () => {
    expect(displayOrder(LAYERS).map((l) => l.id)).toEqual(['petal', 'hero', 'pine', 'bg']);
  });

  it('底圖永遠在最下面', () => {
    const rows = displayOrder(LAYERS);
    expect(rows[rows.length - 1]!.role).toBe('base');
  });

  it('沒有底圖時也照反過來排；不改原陣列', () => {
    const only = [layer('a', 10), layer('b', 60)];
    expect(displayOrder(only).map((l) => l.id)).toEqual(['b', 'a']);
    expect(only.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('空的面是空清單', () => {
    expect(displayOrder([])).toEqual([]);
  });
});

describe('清單拖拉排序 → 和哪一層交換深度', () => {
  const rows = displayOrder(LAYERS); // petal, hero, pine, bg

  it('把最上面一列拖到第 2 列 → 和那一層交換', () => {
    expect(swapTarget(rows, 'petal', 2)).toBe('pine');
    expect(swapTarget(rows, 'pine', 0)).toBe('petal');
  });

  it('放回自己那一列＝不交換', () => {
    expect(swapTarget(rows, 'hero', 1)).toBeNull();
  });

  it('底圖固定：拖底圖、或拖到底圖那一列都不交換', () => {
    expect(swapTarget(rows, 'bg', 0)).toBeNull();
    expect(swapTarget(rows, 'hero', 3)).toBeNull();
  });

  it('超出清單或找不到 → 不交換', () => {
    expect(swapTarget(rows, 'hero', -1)).toBeNull();
    expect(swapTarget(rows, 'hero', 9)).toBeNull();
    expect(swapTarget(rows, 'nobody', 0)).toBeNull();
  });
});

describe('指標高度 → 第幾列', () => {
  const rects = [
    { top: 0, bottom: 50 },
    { top: 56, bottom: 106 },
    { top: 112, bottom: 162 },
  ];

  it('在某一列範圍內就是那一列；列與列的縫算下一列之前最近的', () => {
    expect(indexAtY(10, rects)).toBe(0);
    expect(indexAtY(80, rects)).toBe(1);
    expect(indexAtY(53, rects)).toBe(0);
    expect(indexAtY(54, rects)).toBe(1);
  });

  it('超出上下 → 夾到第一列或最後一列；沒有列 → -1', () => {
    expect(indexAtY(-100, rects)).toBe(0);
    expect(indexAtY(999, rects)).toBe(2);
    expect(indexAtY(10, [])).toBe(-1);
  });
});

describe('上傳失敗的白話文字（DESIGN §4）', () => {
  it('每種原因都有一句話', () => {
    expect(problemText('too-large')).toBe('這個檔案超過 30 MB，沒有加入。');
    expect(problemText('face-full')).toBe('每一面最多 8 層。');
    expect(problemText('not-image')).toContain('不是圖片');
    expect(problemText('decode-failed')).toContain('打不開');
    expect(problemText('invalid-input')).toBe('這張圖加不進去，請再試一次。');
  });

  it('文字裡沒有技術名詞', () => {
    for (const r of ['too-large', 'face-full', 'not-image', 'decode-failed', 'invalid-input'] as const) {
      expect(problemText(r)).not.toMatch(/decode|alpha|ingest|error|MIME|depth/i);
    }
  });

  it('沒有問題 → 沒有訊息', () => {
    expect(uploadMessage([])).toBeNull();
  });

  it('單一檔案失敗：檔名＋原因，是錯誤訊息', () => {
    const m = uploadMessage([{ fileName: 'big.png', reason: 'too-large' }]);
    expect(m?.kind).toBe('error');
    expect(m?.text).toBe('big.png：這個檔案超過 30 MB，沒有加入。');
  });

  it('加不進去（資料不合格）：檔名＋白話一句，不會被當成「這一面滿了」', () => {
    const m = uploadMessage([{ fileName: 'a.png', reason: 'invalid-input' }]);
    expect(m?.kind).toBe('error');
    expect(m?.text).toBe('a.png：這張圖加不進去，請再試一次。');
    expect(m?.text).not.toContain('8 層');
  });

  it('面已滿：照 DESIGN 原文；好幾個檔都因為滿了被拒，只說一次並附張數', () => {
    expect(uploadMessage([{ fileName: 'a.png', reason: 'face-full' }])?.text).toBe('每一面最多 8 層。');
    const m = uploadMessage([
      { fileName: 'a.png', reason: 'face-full' },
      { fileName: 'b.png', reason: 'face-full' },
    ]);
    expect(m?.text).toBe('每一面最多 8 層。（2 張沒有加入）');
  });

  it('好幾個檔各自失敗：一行一個，最多列 3 行，其他用一句帶過', () => {
    const m = uploadMessage([
      { fileName: '1.png', reason: 'too-large' },
      { fileName: '2.txt', reason: 'not-image' },
      { fileName: '3.png', reason: 'decode-failed' },
      { fileName: '4.png', reason: 'too-large' },
      { fileName: '5.png', reason: 'too-large' },
    ]);
    const lines = m!.text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('1.png：這個檔案超過 30 MB，沒有加入。');
    expect(lines[3]).toBe('還有 2 個檔案沒有加入。');
  });
});

describe('鍵盤快捷鍵', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it('Ctrl+Z 復原；Ctrl+Shift+Z 與 Ctrl+Y 重做', () => {
    expect(shortcutFor(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(shortcutFor(key('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo');
    expect(shortcutFor(key('y', { ctrlKey: true }), false)).toBe('redo');
  });

  it('Mac 的 Cmd 也算', () => {
    expect(shortcutFor(key('z', { metaKey: true }), false)).toBe('undo');
  });

  it('沒按 Ctrl、多按 Alt、或焦點在文字輸入框時不攔', () => {
    expect(shortcutFor(key('z'), false)).toBeNull();
    expect(shortcutFor(key('z', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(shortcutFor(key('z', { ctrlKey: true }), true)).toBeNull();
    expect(shortcutFor(key('y', { ctrlKey: true }), true)).toBeNull();
  });

  it('其他鍵不管', () => {
    expect(shortcutFor(key('s', { ctrlKey: true }), false)).toBeNull();
  });

  it('哪些元素算文字輸入：文字框、多行文字、可編輯區；滑桿、顏色、核取方塊不算', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'color' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('大小滑桿（對數刻度）', () => {
  it('兩端對到 0.05 與 4', () => {
    expect(sliderToScale(0)).toBeCloseTo(0.05, 10);
    expect(sliderToScale(SCALE_SLIDER_MAX)).toBeCloseTo(4, 10);
    expect(scaleToSlider(0.05)).toBeCloseTo(0, 10);
    expect(scaleToSlider(4)).toBeCloseTo(SCALE_SLIDER_MAX, 10);
  });

  it('來回換算不變', () => {
    for (const s of [0.05, 0.1, 0.5, 1, 1.12, 2, 4]) expect(sliderToScale(scaleToSlider(s))).toBeCloseTo(s, 10);
  });

  it('小範圍比較好調：0.05～1 佔超過一半的滑桿', () => {
    expect(scaleToSlider(1)).toBeGreaterThan(SCALE_SLIDER_MAX / 2);
  });

  it('超出範圍夾回兩端', () => {
    expect(scaleToSlider(0.001)).toBe(0);
    expect(scaleToSlider(10)).toBe(SCALE_SLIDER_MAX);
    expect(sliderToScale(-5)).toBeCloseTo(0.05, 10);
  });
});

describe('鐳射設定的白話', () => {
  it('強度 0 顯示「關」，其他顯示數字', () => {
    expect(holoStrengthText(0)).toBe('關');
    expect(holoStrengthText(40)).toBe('40');
    expect(holoStrengthText(99.6)).toBe('100');
  });

  it('閃星 0 顯示「沒有」，其他顯示數字', () => {
    expect(sparkleText(0)).toBe('沒有');
    expect(sparkleText(30)).toBe('30');
  });

});

describe('使用者可調外觀（T-310）', () => {
  it('色彩七個選項，順序與名字照 DESIGN：暖陽、經典彩虹、銀箔、金箔、極光、銀河、自訂', () => {
    expect(HOLO_PALETTE_OPTIONS.map((o) => o.name)).toEqual(['暖陽', '經典彩虹', '銀箔', '金箔', '極光', '銀河', '自訂']);
    expect(HOLO_PALETTE_OPTIONS.map((o) => o.value)).toEqual(['warm', 'classic', 'silver', 'gold', 'aurora', 'galaxy', 'custom']);
  });

  it('每個選項的 4 色：預設的用色票表，自訂用卡片自己的', () => {
    const mine = ['#112233', '#445566', '#778899', '#aabbcc'];
    expect(paletteColors('gold', mine)).toEqual(HOLO_PALETTES.gold);
    expect(paletteColors('custom', mine)).toEqual(mine);
  });

  it('小色塊的漸層：4 色照色譜的位置（0、35%、70%、100%）', () => {
    expect(paletteGradient(['#111111', '#222222', '#333333', '#444444'])).toBe(
      'linear-gradient(90deg, #111111 0%, #222222 35%, #333333 70%, #444444 100%)',
    );
  });

  it('換自訂色彩的某一格：只換那一格、給新陣列、不改輸入；格數不對就不換', () => {
    const colors = Object.freeze(['#111111', '#222222', '#333333', '#444444']);
    expect(replaceColor(colors, 2, '#ABCDEF')).toEqual(['#111111', '#222222', '#abcdef', '#444444']);
    expect(replaceColor(colors, 0, '#000000')).not.toBe(colors);
    expect(replaceColor(colors, 4, '#000000')).toEqual(colors);
    expect(replaceColor(colors, -1, '#000000')).toEqual(colors);
  });

  it('顏色表：一排好看的預設色，都是合格的 #rrggbb、沒有重複', () => {
    expect(COLOR_TABLE.length).toBeGreaterThanOrEqual(8);
    for (const c of COLOR_TABLE) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
    expect(new Set(COLOR_TABLE.map((c) => c.color)).size).toBe(COLOR_TABLE.length);
  });

  it('陰影濃淡 0 顯示「沒有」，其他顯示數字', () => {
    expect(shadowStrengthText(0)).toBe('沒有');
    expect(shadowStrengthText(50)).toBe('50');
    expect(shadowStrengthText(99.6)).toBe('100');
  });
});

describe('Esc 要做什麼（優先順序，T-309）', () => {
  const ctx = (c: Partial<Parameters<typeof escapeAction>[0]> = {}) => ({
    layerDragging: false,
    menuOpen: false,
    confirmOpen: false,
    typingInText: false,
    layerSelected: false,
    ...c,
  });

  it('圖層拖曳中：取消這次拖曳（最優先，不取消選取、不回答確認框、不關選單）', () => {
    expect(escapeAction(ctx({ layerDragging: true, layerSelected: true }))).toBe('cancel-drag');
    expect(escapeAction(ctx({ layerDragging: true, layerSelected: true, confirmOpen: true, menuOpen: true }))).toBe('cancel-drag');
  });

  it('新卡片選單開著：關選單（不取消選取）', () => {
    expect(escapeAction(ctx({ menuOpen: true, layerSelected: true }))).toBe('close-menu');
    expect(escapeAction(ctx({ menuOpen: true, confirmOpen: true }))).toBe('close-menu');
  });

  it('取代底圖確認框開著：保留原本的（不取消選取）', () => {
    expect(escapeAction(ctx({ confirmOpen: true }))).toBe('keep-base');
    expect(escapeAction(ctx({ confirmOpen: true, layerSelected: true }))).toBe('keep-base');
  });

  it('焦點在文字輸入框（改名）：不攔，不管有沒有選圖層、確認框有沒有開', () => {
    expect(escapeAction(ctx({ typingInText: true, layerSelected: true }))).toBeNull();
    expect(escapeAction(ctx({ typingInText: true, confirmOpen: true, layerSelected: true }))).toBeNull();
  });

  it('其他情況、而且有選中圖層：取消選取', () => {
    expect(escapeAction(ctx({ layerSelected: true }))).toBe('deselect');
  });

  it('什麼都沒選、什麼都沒開：不做事', () => {
    expect(escapeAction(ctx())).toBeNull();
  });
});
