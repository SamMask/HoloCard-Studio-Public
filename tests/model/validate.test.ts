import { describe, expect, it, vi } from 'vitest';
import { addLayer, addTextLayer, cleanTextSpec, DEFAULT_TEXT, updateCard, updateLayer, updateTextLayer } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { cleanName, exceedsLength, NAME_MAX, TEXT_CONTENT_MAX } from '../../src/model/limits';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, depthLayer, hash, NOW } from './helpers';

/** 合格的卡：正面 底圖＋兩個立體層，背面 一個立體層。 */
function sample(): Card {
  return cardWith(
    [
      baseLayer({ id: 'b', image: hash(1) }),
      depthLayer({ id: 'a', depth: 50, image: hash(2) }),
      depthLayer({ id: 'c', depth: 70, image: hash(3) }),
    ],
    [depthLayer({ id: 'd', depth: 50, image: hash(4) })],
  );
}

// 模擬匯入的 JSON：可以任意亂改。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
function raw(card: Card = sample()): Raw {
  return structuredClone(card);
}

/** 錯誤訊息格式是「欄位路徑：說明」，取出路徑。 */
function paths(value: unknown, hasImage: (h: string) => boolean = anyImage): string[] {
  return validateCard(value, hasImage).map((e) => e.split('：')[0]);
}

/** 錯誤至少一條，而且全部都指到這個路徑（不會誤報別的欄位）。 */
function expectOnlyAt(value: unknown, path: string): void {
  const p = paths(value);
  expect(p.length).toBeGreaterThan(0);
  expect(p.every((x) => x === path)).toBe(true);
}

describe('validateCard：合格的卡', () => {
  it('新卡與有圖層的卡都沒有錯誤', () => {
    expect(validateCard(newCard('standard', 'x', NOW), anyImage)).toEqual([]);
    expect(validateCard(sample(), anyImage)).toEqual([]);
  });

  it('每個範圍的邊界值都合格', () => {
    const lows = raw();
    lows.cornerRadius = 0;
    lows.frame.width = 0.01;
    lows.frame.shine = 0;
    lows.holo = { strength: 0, bandWidth: 0.1, sparkle: 0, matte: 0, palette: 'classic', colors: ['#000000', '#000000', '#000000', '#000000'] };
    lows.shadow = { strength: 0, distance: 0 };
    lows.front.layers[1] = { ...lows.front.layers[1], x: -1, y: -1, scale: 0.05, depth: 1 };
    lows.front.layers[2] = { ...lows.front.layers[2], depth: 1 };
    expect(validateCard(lows, anyImage)).toEqual([]);

    const highs = raw();
    highs.cornerRadius = 0.12;
    highs.frame = { enabled: true, width: 0.08, color: '#ffffff', shine: 100 };
    highs.holo = { strength: 100, bandWidth: 2, sparkle: 100, matte: 100, palette: 'custom', colors: ['#FFFFFF', '#ff00AA', '#123456', '#abcdef'] };
    highs.shadow = { strength: 100, distance: 100 };
    highs.front.layers[1] = { ...highs.front.layers[1], x: 1, y: 1, scale: 4, depth: 100 };
    highs.front.layers[2] = { ...highs.front.layers[2], depth: 100 };
    expect(validateCard(highs, anyImage)).toEqual([]);
  });

  it('名字剛好 60 字合格（中文與表情符號都算一個字）', () => {
    const c = raw();
    c.name = '卡'.repeat(60);
    c.front.layers[1].name = '😀'.repeat(60);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('剛好 8 層合格', () => {
    const layers = [baseLayer({ id: 'b0', image: hash(1) })];
    for (let i = 1; i < 8; i++) layers.push(depthLayer({ id: `d${i}`, depth: i * 10, image: hash(i + 1) }));
    expect(validateCard(cardWith(layers), anyImage)).toEqual([]);
  });

  it('只有立體層、沒有底圖也合格；有透明的圖可以當底圖', () => {
    expect(validateCard(cardWith([depthLayer()]), anyImage)).toEqual([]);
    expect(validateCard(cardWith([baseLayer({ hasAlpha: true })]), anyImage)).toEqual([]);
  });

  it('同 depth 的立體層合格（陣列後面的在前面）', () => {
    const c = cardWith([depthLayer({ id: 'a', depth: 100 }), depthLayer({ id: 'b', depth: 100 })]);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('大寫的色碼也接受', () => {
    const c = raw();
    c.bodyColor = '#1B2033';
    c.frame.color = '#D8DBE2';
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('每張圖都會用 hasImage 確認', () => {
    const asked: string[] = [];
    validateCard(sample(), (h) => {
      asked.push(h);
      return true;
    });
    expect(asked.sort()).toEqual([hash(1), hash(2), hash(3), hash(4)]);
  });
});

describe('validateCard：整體型別與版本', () => {
  it.each([null, undefined, 0, 'card', true, [], [sample()]])('不是物件（%s）就報錯', (v) => {
    expect(validateCard(v, anyImage).length).toBeGreaterThan(0);
  });

  it.each([2, 0, '1', null])('formatVersion 不是 1（%s）就報錯', (v) => {
    const c = raw();
    c.formatVersion = v;
    expectOnlyAt(c, 'formatVersion');
  });
});

describe('validateCard：數字（Number.isFinite 且在範圍內）', () => {
  const cases: [string, (c: Raw, v: unknown) => void, string][] = [
    ['卡片圓角', (c, v) => (c.cornerRadius = v), 'cornerRadius'],
    ['卡框寬度', (c, v) => (c.frame.width = v), 'frame.width'],
    ['鐳射強度', (c, v) => (c.holo.strength = v), 'holo.strength'],
    ['色帶寬度', (c, v) => (c.holo.bandWidth = v), 'holo.bandWidth'],
    ['閃星', (c, v) => (c.holo.sparkle = v), 'holo.sparkle'],
    ['卡框光澤', (c, v) => (c.frame.shine = v), 'frame.shine'],
    ['陰影濃淡', (c, v) => (c.shadow.strength = v), 'shadow.strength'],
    ['陰影距離', (c, v) => (c.shadow.distance = v), 'shadow.distance'],
    ['圖層 x', (c, v) => (c.front.layers[1].x = v), 'front.layers[1].x'],
    ['圖層 y', (c, v) => (c.back.layers[0].y = v), 'back.layers[0].y'],
    ['圖層 scale', (c, v) => (c.front.layers[1].scale = v), 'front.layers[1].scale'],
    ['立體層 depth', (c, v) => (c.back.layers[0].depth = v), 'back.layers[0].depth'],
  ];

  it.each(cases)('%s 是 NaN／Infinity／-Infinity 就報錯', (_label, set, path) => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const c = raw();
      set(c, bad);
      expectOnlyAt(c, path);
    }
  });

  it.each(cases)('%s 是字串型別的數字就報錯', (_label, set, path) => {
    for (const bad of ['0.5', '50', '']) {
      const c = raw();
      set(c, bad);
      expectOnlyAt(c, path);
    }
  });

  const outOfRange: [string, (c: Raw) => void, string][] = [
    ['圓角 -0.01', (c) => (c.cornerRadius = -0.01), 'cornerRadius'],
    ['圓角 0.13', (c) => (c.cornerRadius = 0.13), 'cornerRadius'],
    ['卡框寬 0.009', (c) => (c.frame.width = 0.009), 'frame.width'],
    ['卡框寬 0.081', (c) => (c.frame.width = 0.081), 'frame.width'],
    ['強度 -1', (c) => (c.holo.strength = -1), 'holo.strength'],
    ['強度 101', (c) => (c.holo.strength = 101), 'holo.strength'],
    ['色帶 0.09', (c) => (c.holo.bandWidth = 0.09), 'holo.bandWidth'],
    ['色帶 2.01', (c) => (c.holo.bandWidth = 2.01), 'holo.bandWidth'],
    ['閃星 -1', (c) => (c.holo.sparkle = -1), 'holo.sparkle'],
    ['閃星 100.5', (c) => (c.holo.sparkle = 100.5), 'holo.sparkle'],
    ['卡框光澤 -1', (c) => (c.frame.shine = -1), 'frame.shine'],
    ['卡框光澤 101', (c) => (c.frame.shine = 101), 'frame.shine'],
    ['陰影濃淡 -0.5', (c) => (c.shadow.strength = -0.5), 'shadow.strength'],
    ['陰影濃淡 100.1', (c) => (c.shadow.strength = 100.1), 'shadow.strength'],
    ['陰影距離 -1', (c) => (c.shadow.distance = -1), 'shadow.distance'],
    ['陰影距離 150', (c) => (c.shadow.distance = 150), 'shadow.distance'],
    ['x 1.01', (c) => (c.front.layers[1].x = 1.01), 'front.layers[1].x'],
    ['x -1.5', (c) => (c.front.layers[1].x = -1.5), 'front.layers[1].x'],
    ['y 2', (c) => (c.front.layers[1].y = 2), 'front.layers[1].y'],
    ['scale 0.04', (c) => (c.front.layers[1].scale = 0.04), 'front.layers[1].scale'],
    ['scale 4.01', (c) => (c.front.layers[1].scale = 4.01), 'front.layers[1].scale'],
    ['立體層 depth 0', (c) => (c.back.layers[0].depth = 0), 'back.layers[0].depth'],
    ['立體層 depth 0.5', (c) => (c.back.layers[0].depth = 0.5), 'back.layers[0].depth'],
    ['立體層 depth 101', (c) => (c.back.layers[0].depth = 101), 'back.layers[0].depth'],
    ['底圖 depth 5', (c) => (c.front.layers[0].depth = 5), 'front.layers[0].depth'],
    ['底圖 depth -1', (c) => (c.front.layers[0].depth = -1), 'front.layers[0].depth'],
  ];

  it.each(outOfRange)('超範圍：%s', (_label, mutate, path) => {
    const c = raw();
    mutate(c);
    expectOnlyAt(c, path);
  });
});

describe('validateCard：其他欄位型別', () => {
  const cases: [string, (c: Raw) => void, string][] = [
    ['卡片 id 是數字', (c) => (c.id = 5), 'id'],
    ['卡片 id 是空字串', (c) => (c.id = ''), 'id'],
    ['卡片名字是數字', (c) => (c.name = 123), 'name'],
    ['卡片名字是空字串', (c) => (c.name = ''), 'name'],
    ['卡片名字 61 字', (c) => (c.name = '卡'.repeat(61)), 'name'],
    ['比例不認得', (c) => (c.aspect = 'round'), 'aspect'],
    ['建立時間不是時間', (c) => (c.createdAt = 'yesterday'), 'createdAt'],
    ['更新時間是數字', (c) => (c.updatedAt = 1700000000000), 'updatedAt'],
    ['卡身色 #fff', (c) => (c.bodyColor = '#fff'), 'bodyColor'],
    ['卡身色 red', (c) => (c.bodyColor = 'red'), 'bodyColor'],
    ['卡身色少了 #', (c) => (c.bodyColor = '1b2033'), 'bodyColor'],
    ['卡身色有非十六進位字', (c) => (c.bodyColor = '#12345g'), 'bodyColor'],
    ['卡身色多一碼', (c) => (c.bodyColor = '#1b20331'), 'bodyColor'],
    ['卡框顏色是數字', (c) => (c.frame.color = 0xffffff), 'frame.color'],
    ['卡框開關是字串', (c) => (c.frame.enabled = 'yes'), 'frame.enabled'],
    ['舊的鐳射範圍沒有轉換（T-417 起不認得）', (c) => (c.holo.scope = 'all'), 'holo.scope'],
    ['鐳射色彩不認得', (c) => (c.holo.palette = 'neon'), 'holo.palette'],
    ['鐳射色彩是原型鏈上的名字', (c) => (c.holo.palette = 'toString'), 'holo.palette'],
    ['鐳射色彩是數字', (c) => (c.holo.palette = 1), 'holo.palette'],
    ['自訂色彩不是陣列', (c) => (c.holo.colors = '#ff0000'), 'holo.colors'],
    ['自訂色彩是物件', (c) => (c.holo.colors = { 0: '#ff0000', length: 4 }), 'holo.colors'],
    ['自訂色彩只有 3 個', (c) => (c.holo.colors = ['#ff0000', '#00ff00', '#0000ff']), 'holo.colors'],
    ['自訂色彩有 5 個', (c) => (c.holo.colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000']), 'holo.colors'],
    ['自訂色彩是空陣列', (c) => (c.holo.colors = []), 'holo.colors'],
    ['自訂色彩第 3 個不是色碼', (c) => (c.holo.colors[2] = 'blue'), 'holo.colors[2]'],
    ['自訂色彩第 1 個是 #fff', (c) => (c.holo.colors[0] = '#fff'), 'holo.colors[0]'],
    ['自訂色彩第 4 個是 null', (c) => (c.holo.colors[3] = null), 'holo.colors[3]'],
    ['陰影是陣列', (c) => (c.shadow = [50, 50]), 'shadow'],
    ['陰影是 null', (c) => (c.shadow = null), 'shadow'],
    ['回正是數字', (c) => (c.view.returnToFront = 1), 'view.returnToFront'],
    ['展示是 null', (c) => (c.view.showcase = null), 'view.showcase'],
    ['舞台不認得', (c) => (c.view.stage = 'glow'), 'view.stage'],
    ['舞台是原型鏈上的名字', (c) => (c.view.stage = 'toString'), 'view.stage'],
    ['舞台是 null', (c) => (c.view.stage = null), 'view.stage'],
    ['舞台是布林', (c) => (c.view.stage = true), 'view.stage'],
    ['舞台是大寫', (c) => (c.view.stage = 'HALO'), 'view.stage'],
    ['卡框是陣列', (c) => (c.frame = []), 'frame'],
    ['view 是 null', (c) => (c.view = null), 'view'],
    ['正面是 null', (c) => (c.front = null), 'front'],
    ['圖層清單不是陣列', (c) => (c.back.layers = {}), 'back.layers'],
    ['圖層不是物件', (c) => (c.back.layers[0] = 'layer'), 'back.layers[0]'],
    ['圖層 id 是空字串', (c) => (c.front.layers[1].id = ''), 'front.layers[1].id'],
    ['圖層名字是空字串', (c) => (c.front.layers[1].name = ''), 'front.layers[1].name'],
    ['圖層名字 61 字', (c) => (c.front.layers[1].name = 'a'.repeat(61)), 'front.layers[1].name'],
    ['圖層角色不認得', (c) => (c.front.layers[1].role = 'top'), 'front.layers[1].role'],
    ['顯示開關是字串', (c) => (c.front.layers[1].visible = 'true'), 'front.layers[1].visible'],
    ['鐳射開關是數字', (c) => (c.front.layers[1].holo = 1), 'front.layers[1].holo'],
    ['透明旗標是 null', (c) => (c.front.layers[0].hasAlpha = null), 'front.layers[0].hasAlpha'],
  ];

  it.each(cases)('%s 就報錯', (_label, mutate, path) => {
    const c = raw();
    mutate(c);
    expectOnlyAt(c, path);
  });
});

describe('validateCard：不認得的欄位與缺欄位', () => {
  const extra: [string, (c: Raw) => void, string][] = [
    ['卡片', (c) => (c.owner = 'x'), 'owner'],
    ['正面', (c) => (c.front.note = 1), 'front.note'],
    ['圖層', (c) => (c.front.layers[1].script = 'alert(1)'), 'front.layers[1].script'],
    ['卡框', (c) => (c.frame.glow = true), 'frame.glow'],
    ['鐳射', (c) => (c.holo.speed = 2), 'holo.speed'],
    ['陰影', (c) => (c.shadow.color = '#000000'), 'shadow.color'],
    ['view', (c) => (c.view.zoom = 1), 'view.zoom'],
  ];

  it.each(extra)('%s 有不認得的欄位就報錯', (_label, mutate, path) => {
    const c = raw();
    mutate(c);
    expectOnlyAt(c, path);
  });

  it('JSON 裡的 __proto__ 欄位也算不認得', () => {
    const c = JSON.parse(JSON.stringify(sample()).replace('{', '{"__proto__":{"x":1},'));
    expect(paths(c)).toContain('__proto__');
  });

  it('缺欄位就報錯', () => {
    const c = raw();
    delete c.holo;
    expectOnlyAt(c, 'holo');

    const d = raw();
    delete d.front.layers[1].scale;
    expectOnlyAt(d, 'front.layers[1].scale');

    const e = raw();
    delete e.view.showcase;
    expectOnlyAt(e, 'view.showcase');

    // T-314 的舞台也是必填
    const st = raw();
    delete st.view.stage;
    expectOnlyAt(st, 'view.stage');

    // T-310 的新欄位也都是必填
    const f = raw();
    delete f.shadow;
    expectOnlyAt(f, 'shadow');
    const g = raw();
    delete g.frame.shine;
    expectOnlyAt(g, 'frame.shine');
    const k = raw();
    delete k.holo.palette;
    expectOnlyAt(k, 'holo.palette');
    const m = raw();
    delete m.holo.colors;
    expectOnlyAt(m, 'holo.colors');
    const n = raw();
    delete n.shadow.distance;
    expectOnlyAt(n, 'shadow.distance');
  });

  it('自訂色彩有空洞（稀疏陣列）也報錯', () => {
    const c = raw();
    c.holo.colors = ['#ff0000', '#00ff00', '#0000ff'];
    c.holo.colors.length = 4;
    expectOnlyAt(c, 'holo.colors[3]');
  });

  it('七種鐳射色彩都合格；不是自訂時 colors 也要是 4 個合格顏色', () => {
    for (const palette of ['warm', 'classic', 'silver', 'gold', 'aurora', 'galaxy', 'custom']) {
      const c = raw();
      c.holo.palette = palette;
      expect(validateCard(c, anyImage), palette).toEqual([]);
    }
    const c = raw();
    c.holo.palette = 'gold';
    c.holo.colors = ['#ff0000'];
    expectOnlyAt(c, 'holo.colors');
  });
});

describe('validateCard：圖層規則（SCHEMA §1.1）', () => {
  it('9 層就報錯', () => {
    const layers = [baseLayer({ id: 'b0' })];
    for (let i = 1; i < 9; i++) layers.push(depthLayer({ id: `d${i}`, depth: i * 10 }));
    expect(paths(cardWith(layers))).toContain('front.layers');
    expect(paths(cardWith([], layers))).toContain('back.layers');
  });

  it('兩個底圖就報錯', () => {
    const c = cardWith([baseLayer({ id: 'b1' }), baseLayer({ id: 'b2' }), depthLayer({ id: 'd' })]);
    expect(paths(c)).toContain('front.layers');
  });

  it('底圖不在第 0 個就報錯', () => {
    const c = raw();
    // 把底圖搬到最後；depth 也調成 0 以外會再多一條「未排序」，這裡只看底圖位置
    const [base, ...rest] = c.front.layers;
    c.front.layers = [...rest, base];
    expect(paths(c)).toContain('front.layers[2]');
  });

  it('沒有透明的圖不能當一般（混合模式正常）的立體層（T-408 起加深／發光／強光可以，見 blend.test.ts）', () => {
    const c = raw();
    c.front.layers[1].hasAlpha = false;
    expectOnlyAt(c, 'front.layers[1].hasAlpha');
  });

  it.each(['ABCDEF0123456789', '0123456789abcde', '0123456789abcdef0', '0123456789abcdeg', 'sha256:01234567', '', 42])(
    '圖片雜湊格式錯（%s）就報錯',
    (bad) => {
      const c = raw();
      c.front.layers[1].image = bad;
      expectOnlyAt(c, 'front.layers[1].image');
    },
  );

  it('格式錯的雜湊不會拿去問 hasImage', () => {
    const c = raw();
    c.front.layers[1].image = 'NOT-A-HASH';
    const asked: string[] = [];
    validateCard(c, (h) => {
      asked.push(h);
      return true;
    });
    expect(asked).not.toContain('NOT-A-HASH');
  });

  it('圖片不存在就報錯', () => {
    const missing = hash(3);
    const errs = validateCard(sample(), (h) => h !== missing).map((e) => e.split('：')[0]);
    expect(errs).toEqual(['front.layers[2].image']);
  });

  it('hasImage 丟例外也不會丟出去，算成錯誤', () => {
    let errs: string[] = [];
    expect(() => {
      errs = validateCard(sample(), () => {
        throw new Error('db down');
      });
    }).not.toThrow();
    expect(errs.length).toBeGreaterThan(0);
  });

  it('沒有依 depth 由小到大排就報錯', () => {
    const c = cardWith([depthLayer({ id: 'a', depth: 70 }), depthLayer({ id: 'b', depth: 50 })]);
    expectOnlyAt(c, 'front.layers[1].depth');
  });

  it('同一面的圖層 id 重複就報錯', () => {
    const c = raw();
    c.front.layers[2].id = 'a';
    expectOnlyAt(c, 'front.layers[2].id');
  });

  it('正背面之間的圖層 id 重複也報錯', () => {
    const c = raw();
    c.back.layers[0].id = 'a';
    expectOnlyAt(c, 'back.layers[0].id');
  });
});

describe('validateCard：任何輸入都不丟例外', () => {
  it('讀欄位會丟例外的物件', () => {
    const evil = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    let errs: string[] = [];
    expect(() => (errs = validateCard(evil, anyImage))).not.toThrow();
    expect(errs.length).toBeGreaterThan(0);
  });

  it('getter 丟例外的圖層', () => {
    const c = raw();
    Object.defineProperty(c.front.layers[1], 'x', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    let errs: string[] = [];
    expect(() => (errs = validateCard(c, anyImage))).not.toThrow();
    expect(errs.length).toBeGreaterThan(0);
  });

  it('稀疏陣列、空物件、各種奇怪值', () => {
    const weird: Raw[] = [{}, { formatVersion: 1 }, Object.create(null)];
    const sparse = raw();
    sparse.front.layers = new Array(3);
    weird.push(sparse);
    for (const w of weird) {
      let errs: string[] = [];
      expect(() => (errs = validateCard(w, anyImage))).not.toThrow();
      expect(errs.length).toBeGreaterThan(0);
    }
  });
});

describe('validateCard：id 長度（SCHEMA §1.1，上限 100 字）', () => {
  it('卡片 id、圖層 id 剛好 100 字合格；101 字報錯', () => {
    const ok = raw();
    ok.id = 'x'.repeat(100);
    ok.front.layers[1].id = 'y'.repeat(100);
    expect(validateCard(ok, anyImage)).toEqual([]);

    const cardId = raw();
    cardId.id = 'x'.repeat(101);
    expectOnlyAt(cardId, 'id');

    const layerId = raw();
    layerId.front.layers[1].id = 'y'.repeat(101);
    expectOnlyAt(layerId, 'front.layers[1].id');
  });

  it('id 以 Unicode 字元計：100 個表情符號（200 個 UTF-16 單位）合格；101 個報錯（不能改用 id.length 比）', () => {
    const emoji100 = '😀'.repeat(100);
    expect(emoji100.length).toBe(200);
    const ok = raw();
    ok.id = emoji100;
    ok.front.layers[1].id = emoji100;
    ok.back.layers[0].id = '😀'.repeat(99) + 'a';
    expect(validateCard(ok, anyImage)).toEqual([]);

    const cardId = raw();
    cardId.id = '😀'.repeat(101);
    expectOnlyAt(cardId, 'id');

    const layerId = raw();
    layerId.front.layers[1].id = '😀'.repeat(101);
    expectOnlyAt(layerId, 'front.layers[1].id');
  });
});

describe('validateCard：名字去頭尾空白後是空的視為不合格', () => {
  const blanks: [string, string][] = [
    ['空格', '   '],
    ['tab 與換行', ' \t\n '],
    ['全形空格', '　　'],
    ['不換行空格', ' '],
  ];

  it.each(blanks)('卡片名字只有%s → 報錯', (_label, name) => {
    const c = raw();
    c.name = name;
    expectOnlyAt(c, 'name');
  });

  it.each(blanks)('圖層名字只有%s → 報錯', (_label, name) => {
    const c = raw();
    c.back.layers[0].name = name;
    expectOnlyAt(c, 'back.layers[0].name');
  });

  it('前後有空白但中間有字 → 合格', () => {
    const c = raw();
    c.name = '  卡 ';
    c.front.layers[1].name = '　狐狸　';
    expect(validateCard(c, anyImage)).toEqual([]);
  });
});

describe('validateCard：建立／更新時間要是真的存在的時間', () => {
  const good = [
    '2026-10-13T00:00:00.000Z',
    '2026-10-13T08:30:15Z',
    '2026-10-13T08:30:15+08:00',
    '2026-10-13T08:30:15.123456789-05:30',
    '2028-02-29T12:00:00.000Z', // 閏年
    '2000-02-29T00:00:00.000Z', // 400 的倍數是閏年
    '2026-12-31T23:59:59.999Z',
    '2026-01-31T00:00:00Z',
  ];
  const bad = [
    '2026-02-30T00:00:00.000Z',
    '2026-02-29T00:00:00.000Z', // 2026 不是閏年
    '1900-02-29T00:00:00.000Z', // 100 的倍數但不是 400 的倍數
    '2026-04-31T00:00:00.000Z',
    '2026-06-31T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
    '2026-00-10T00:00:00.000Z',
    '2026-10-00T00:00:00.000Z',
    '2026-10-32T00:00:00.000Z',
    '2026-10-13T24:00:00.000Z',
    '2026-10-13T00:60:00.000Z',
    '2026-10-13T00:00:60.000Z',
    '2026-10-13T00:00:00+24:00',
    '2026-10-13T00:00:00+08:60',
    '2026-10-13',
    '2026-10-13 00:00:00',
    '',
  ];

  it.each(good)('%s 合格', (t) => {
    const c = raw();
    c.createdAt = t;
    c.updatedAt = t;
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each(bad)('「%s」不合格（建立與更新時間都擋）', (t) => {
    const created = raw();
    created.createdAt = t;
    expectOnlyAt(created, 'createdAt');
    const updated = raw();
    updated.updatedAt = t;
    expectOnlyAt(updated, 'updatedAt');
  });
});

describe('validateCard：錯誤清單上限與欄位名截短', () => {
  const MORE = '還有更多錯誤';

  /** 在卡片上多加 n 個不認得的欄位 → 每個欄位 1 條錯誤。 */
  function withExtras(n: number): Raw {
    const c = raw();
    for (let i = 0; i < n; i++) c[`extra${i}`] = i;
    return c;
  }

  it('剛好 50 條錯誤：全部列出，沒有「還有更多」', () => {
    const errs = validateCard(withExtras(50), anyImage);
    expect(errs).toHaveLength(50);
    expect(errs.some((e) => e.includes(MORE))).toBe(false);
  });

  it('51 條以上：只留前 50 條，再加一條「還有更多錯誤」', () => {
    const errs = validateCard(withExtras(51), anyImage);
    expect(errs).toHaveLength(51);
    expect(errs.slice(0, 50).every((e) => e.endsWith('：不認得的欄位'))).toBe(true);
    expect(errs[50]).toContain(MORE);
  });

  it('非常多的錯誤也會停下來（不會一路收集到底）', () => {
    const errs = validateCard(withExtras(5000), anyImage);
    expect(errs).toHaveLength(51);
    expect(errs[50]).toContain(MORE);
    expect(errs[0]).toBe('extra0：不認得的欄位');
  });

  it('錯誤出在圖層欄位時，也一樣在第 50 條後停止（不是只有不認得的欄位才有上限）', () => {
    const c = raw();
    for (const face of ['front', 'back']) {
      c[face].layers = Array.from({ length: 8 }, (_, i) => depthLayer({ id: `${face}-${i}`, depth: i + 1, image: hash(i + 1) }));
      for (const layer of c[face].layers) Object.assign(layer, { x: NaN, y: NaN, scale: NaN, visible: 'no', holo: 1 });
    }
    const errs = validateCard(c, anyImage); // 16 層 × 5 條 = 80 條
    expect(errs).toHaveLength(51);
    expect(errs[0]).toBe('front.layers[0].visible：要是 true 或 false');
    expect(errs[50]).toContain(MORE);
  });

  it('訊息裡引用的欄位名稱截到 40 字（卡片層與圖層都一樣）', () => {
    const long = 'k'.repeat(500);
    const c = raw();
    c[long] = 1;
    c.front.layers[1][long] = 1;
    const errs = validateCard(c, anyImage);
    expect(errs).toHaveLength(2);
    const clipped = 'k'.repeat(40) + '…';
    expect(errs[0]).toBe(`${clipped}：不認得的欄位`);
    expect(errs[1]).toBe(`front.layers[1].${clipped}：不認得的欄位`);
    for (const e of errs) expect(e.length).toBeLessThan(100);
  });

  it('剛好 40 字的欄位名稱不截；表情符號以「字」計', () => {
    const c = raw();
    c['m'.repeat(40)] = 1;
    c['😀'.repeat(41)] = 1;
    const errs = validateCard(c, anyImage);
    expect(errs[0]).toBe(`${'m'.repeat(40)}：不認得的欄位`);
    expect(errs[1]).toBe(`${'😀'.repeat(40)}…：不認得的欄位`);
  });
});

describe('超長字串：先用字元數快篩、截字逐字取前 N 個，都不建整個陣列（T-311、T-315）', () => {
  const HUGE = 'x'.repeat(3_000_000);

  /** 跑 fn 的時候記下所有 Array.from(字串) 的字串長度（建陣列吃記憶體的就是這個）。 */
  function longestArrayFromString(fn: () => void): number {
    const spy = vi.spyOn(Array, 'from');
    try {
      fn();
      return Math.max(0, ...spy.mock.calls.map(([first]) => (typeof first === 'string' ? first.length : 0)));
    } finally {
      spy.mockRestore();
    }
  }

  it('exceedsLength：以 Unicode 字元計（表情符號算一個字），邊界正確', () => {
    expect(exceedsLength('', 60)).toBe(false);
    expect(exceedsLength('字'.repeat(60), 60)).toBe(false);
    expect(exceedsLength('字'.repeat(61), 60)).toBe(true);
    expect(exceedsLength('😀'.repeat(60), 60)).toBe(false); // 120 個 UTF-16 單位，剛好是 max × 2
    expect(exceedsLength('😀'.repeat(61), 60)).toBe(true);
    expect(exceedsLength('x'.repeat(121), 60)).toBe(true);
    expect(exceedsLength('x'.repeat(120), 60)).toBe(true); // 120 個字元 > 60
  });

  it('validateCard：卡片 id／名字、圖層 id／名字、文字內容超長 → 照樣報錯，而且沒有對超長字串建陣列', () => {
    const c = raw(cardWith([depthLayer({ id: 'a', text: { content: 'ok', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'plain' } })]));
    c.id = HUGE;
    c.name = HUGE;
    c.front.layers[0].id = HUGE;
    c.front.layers[0].name = HUGE;
    c.front.layers[0].text.content = HUGE;
    let errs: string[] = [];
    const longest = longestArrayFromString(() => {
      errs = validateCard(c, anyImage);
    });
    expect(errs.map((e) => e.split('：')[0]).sort()).toEqual(
      ['front.layers[0].id', 'front.layers[0].name', 'front.layers[0].text.content', 'id', 'name'].sort(),
    );
    for (const e of errs) expect(e).toContain('長度要在');
    expect(longest, '對超長字串建了陣列').toBeLessThanOrEqual(1000);
  });

  it('addLayer／addTextLayer：超長的 id 回 invalid-input，沒有對超長字串建陣列', () => {
    const card = cardWith([]);
    let results: unknown[] = [];
    const longest = longestArrayFromString(() => {
      results = [
        addLayer(card, 'front', { id: HUGE, name: '圖', image: hash(1), hasAlpha: true, width: 10, height: 10 }),
        addTextLayer(card, 'front', { id: HUGE, image: hash(2), text: { ...DEFAULT_TEXT }, width: 10, height: 10 }),
      ];
    });
    expect(results).toEqual([
      { ok: false, reason: 'invalid-input' },
      { ok: false, reason: 'invalid-input' },
    ]);
    expect(longest, '對超長字串建了陣列').toBeLessThanOrEqual(1000);
  });

  // ---- T-315：cleanName／cleanTextContent 截字改成逐字取前 N 個（行為不變） ----

  /** 改寫前的做法（整串拆成陣列再切）：拿來證明新做法的結果一模一樣。 */
  const oldCleanName = (raw: unknown): string =>
    typeof raw !== 'string' ? '' : Array.from(raw.trim()).slice(0, NAME_MAX).join('').trim();
  const oldCleanContent = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const chars = Array.from(v);
    const s = chars.length > TEXT_CONTENT_MAX ? chars.slice(0, TEXT_CONTENT_MAX).join('') : v;
    return s.trim() === '' ? null : s;
  };
  const cleanContent = (v: unknown): string | null => cleanTextSpec({ ...DEFAULT_TEXT, content: v })?.content ?? null;

  /** 邊界與怪字：剛好 N 字、N+1 字、表情符號、單獨的代理對半邊、截完尾巴是空白、全是空白、組合字元。 */
  const SAMPLES: unknown[] = [
    '',
    ' ',
    '\n',
    '　字　',
    'a',
    ' 狐狸 ',
    'x'.repeat(59),
    'x'.repeat(60),
    'x'.repeat(61),
    'x'.repeat(99),
    'x'.repeat(100),
    'x'.repeat(101),
    '😀'.repeat(59),
    '😀'.repeat(60),
    '😀'.repeat(61),
    '😀'.repeat(100),
    '😀'.repeat(101),
    '😀'.repeat(150),
    `x${'😀'.repeat(60)}`,
    '\ud83d', // 單獨的高代理
    '\ude00', // 單獨的低代理
    `a\ud83d${'b'.repeat(120)}`,
    '\ud83d😀'.repeat(70),
    `${'x'.repeat(59)} ${'y'.repeat(200)}`, // 第 60 字剛好是空白：截完要去掉
    `${'x'.repeat(58)}  ${'y'.repeat(200)}`,
    `${' '.repeat(100)}a`, // 截完全是空白
    `a${' '.repeat(200)}`,
    `  ${'字'.repeat(70)}  `,
    '字\n'.repeat(60),
    'é'.repeat(80), // 組合字元各算一個字
    5,
    null,
    undefined,
    {},
    ['x'],
  ];

  it('cleanName：結果和改寫前的做法逐項一模一樣（邊界、表情符號、代理對、空白）', () => {
    for (const sample of SAMPLES) {
      expect(cleanName(sample), JSON.stringify(sample)?.slice(0, 40)).toBe(oldCleanName(sample));
    }
    expect(cleanName(' 狐狸 ')).toBe('狐狸');
    expect(cleanName('x'.repeat(61))).toBe('x'.repeat(60));
    expect(cleanName('😀'.repeat(61))).toBe('😀'.repeat(60));
    expect(cleanName(`${'x'.repeat(59)} ${'y'.repeat(200)}`)).toBe('x'.repeat(59));
  });

  it('cleanTextSpec 的內容：結果和改寫前的做法逐項一模一樣（只有空白就不合格、截完只剩空白也不合格）', () => {
    for (const sample of SAMPLES) {
      expect(cleanContent(sample), JSON.stringify(sample)?.slice(0, 40)).toBe(oldCleanContent(sample));
    }
    expect(cleanContent('x'.repeat(101))).toBe('x'.repeat(100));
    expect(cleanContent('😀'.repeat(101))).toBe('😀'.repeat(100));
    expect(cleanContent(' '.repeat(100) + 'a')).toBeNull();
    expect(cleanContent(`a${' '.repeat(200)}`)).toBe(`a${' '.repeat(99)}`); // 內容不去頭尾空白，只截字
  });

  it('300 萬字的輸入：cleanName 結果正確，而且沒有對超長字串建陣列', () => {
    const padded = `  ${'字'.repeat(3_000_000)}  `;
    const emoji = '😀'.repeat(1_500_000); // 300 萬個 UTF-16 單位、150 萬個字
    const spaced = `${'x'.repeat(59)} ${'y'.repeat(3_000_000)}`;
    const out: string[] = [];
    const longest = longestArrayFromString(() => {
      out.push(cleanName(HUGE), cleanName(padded), cleanName(emoji), cleanName(spaced));
    });
    expect(out).toEqual(['x'.repeat(60), '字'.repeat(60), '😀'.repeat(60), 'x'.repeat(59)]);
    expect(longest, '對超長字串建了陣列').toBeLessThanOrEqual(1000);
  });

  it('300 萬字的文字內容：cleanTextSpec 結果正確，而且沒有對超長字串建陣列', () => {
    const emoji = '😀'.repeat(1_500_000);
    const blank = ' '.repeat(3_000_000);
    const out: (string | null)[] = [];
    const longest = longestArrayFromString(() => {
      out.push(cleanContent(HUGE), cleanContent(emoji), cleanContent(blank), cleanContent(`${blank}a`));
    });
    expect(out).toEqual(['x'.repeat(100), '😀'.repeat(100), null, null]);
    expect(longest, '對超長字串建了陣列').toBeLessThanOrEqual(1000);
  });

  it('用到 cleanName／cleanTextSpec 的動作（改名、改卡片名、加／改文字圖層）碰到 300 萬字也不建陣列', () => {
    const card = cardWith([depthLayer({ id: 'a', text: { ...DEFAULT_TEXT } })]);
    let layerName = '';
    let cardName = '';
    let textContent = '';
    let updatedContent = '';
    const longest = longestArrayFromString(() => {
      layerName = updateLayer(card, 'front', 'a', { name: HUGE }).front.layers[0].name;
      cardName = updateCard(card, { name: HUGE }).name;
      const added = addTextLayer(card, 'back', { id: 'n', image: hash(7), text: { ...DEFAULT_TEXT, content: HUGE }, width: 10, height: 10 });
      if (added.ok) textContent = added.card.back.layers[0].text!.content;
      updatedContent = updateTextLayer(card, 'front', 'a', { text: { ...DEFAULT_TEXT, content: HUGE }, image: hash(8) }).front.layers[0].text!.content;
    });
    expect(layerName).toBe('x'.repeat(60));
    expect(cardName).toBe('x'.repeat(60));
    expect(textContent).toBe('x'.repeat(100));
    expect(updatedContent).toBe('x'.repeat(100));
    expect(longest, '對超長字串建了陣列').toBeLessThanOrEqual(1000);
  });
});
