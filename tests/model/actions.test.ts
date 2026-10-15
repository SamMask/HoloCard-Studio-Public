import { describe, expect, it } from 'vitest';
import {
  addLayer,
  centerLayer,
  containScale,
  coverScale,
  fillLayer,
  findLayer,
  removeLayer,
  replaceBase,
  swapDepth,
  updateCard,
  updateLayer,
  type AddLayerResult,
  type NewLayerInput,
} from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { ASPECT_HEIGHT, type Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash, ids, NOW } from './helpers';

const STD_H = ASPECT_HEIGHT.standard; // 88/63
const TAROT_H = ASPECT_HEIGHT.tarot; // 120/70

let seq = 0;
function input(over: Partial<NewLayerInput> = {}): NewLayerInput {
  seq += 1;
  return {
    id: `new-${seq}`,
    name: `圖${seq}`,
    image: hash(100 + seq),
    hasAlpha: true,
    width: 1000,
    height: 1000,
    ...over,
  };
}

/** addLayer 一定要成功的情況，直接取出新卡。 */
function added(card: Card, face: 'front' | 'back', inp: NewLayerInput): Card {
  const r = addLayer(card, face, inp);
  if (!r.ok) throw new Error(`addLayer 失敗：${r.reason}`);
  return r.card;
}

/** 正面：底圖 b＋立體層 a50、c70、e90；背面：立體層 d50。 */
function sample(): Card {
  return cardWith(
    [
      baseLayer({ id: 'b', image: hash(1) }),
      depthLayer({ id: 'a', depth: 50, image: hash(2) }),
      depthLayer({ id: 'c', depth: 70, image: hash(3) }),
      depthLayer({ id: 'e', depth: 90, image: hash(5) }),
    ],
    [depthLayer({ id: 'd', depth: 50, image: hash(4) })],
  );
}

describe('預設擺法的大小（contain／cover，scale 1＝圖寬等於卡寬）', () => {
  it('contain：橫圖寬度貼齊卡寬', () => {
    expect(containScale(2000, 1000, { aspect: 'standard' })).toBeCloseTo(1);
    expect(containScale(2000, 1000, { aspect: 'tarot' })).toBeCloseTo(1);
  });

  it('contain：直圖高度貼齊卡高（兩種比例）', () => {
    expect(containScale(1000, 2000, { aspect: 'standard' })).toBeCloseTo(STD_H / 2); // 0.698
    expect(containScale(1000, 2000, { aspect: 'tarot' })).toBeCloseTo(TAROT_H / 2); // 0.857
  });

  it('cover：橫圖高度蓋滿卡高（兩種比例）', () => {
    expect(coverScale(2000, 1000, { aspect: 'standard' })).toBeCloseTo(STD_H * 2); // 2.794
    expect(coverScale(2000, 1000, { aspect: 'tarot' })).toBeCloseTo(TAROT_H * 2); // 3.429
  });

  it('cover：直圖寬度蓋滿卡寬；比卡片更瘦長才放大', () => {
    expect(coverScale(1000, 2000, { aspect: 'standard' })).toBeCloseTo(1);
    expect(coverScale(1000, 2000, { aspect: 'tarot' })).toBeCloseTo(1);
    // 700×1000 比標準卡胖、比塔羅卡瘦
    expect(coverScale(700, 1000, { aspect: 'standard' })).toBeCloseTo(1);
    expect(coverScale(700, 1000, { aspect: 'tarot' })).toBeCloseTo(TAROT_H * 0.7); // 1.2
    expect(containScale(700, 1000, { aspect: 'standard' })).toBeCloseTo(STD_H * 0.7); // 0.978
  });

  it('和卡片同比例的圖：contain 與 cover 都是 1', () => {
    expect(containScale(630, 880, { aspect: 'standard' })).toBeCloseTo(1);
    expect(coverScale(630, 880, { aspect: 'standard' })).toBeCloseTo(1);
    expect(containScale(700, 1200, { aspect: 'tarot' })).toBeCloseTo(1);
    expect(coverScale(700, 1200, { aspect: 'tarot' })).toBeCloseTo(1);
  });

  it('cover 加出血：四邊各多 bleed 卡寬', () => {
    // 直圖：寬度決定 → 1 + 2×0.05
    expect(coverScale(1000, 2000, { aspect: 'standard' }, 0.05)).toBeCloseTo(1.1);
    // 橫圖：高度決定 → (卡高 + 2×0.05) × 寬/高
    expect(coverScale(2000, 1000, { aspect: 'standard' }, 0.05)).toBeCloseTo((STD_H + 0.1) * 2);
    expect(coverScale(700, 1000, { aspect: 'tarot' }, 0.05)).toBeCloseTo((TAROT_H + 0.1) * 0.7);
  });

  it('結果夾在 0.05～4', () => {
    expect(containScale(10, 2000, { aspect: 'standard' })).toBe(0.05);
    expect(coverScale(2000, 100, { aspect: 'standard' })).toBe(4);
  });

  it('圖片尺寸不合理（0、負數、NaN）時用 1', () => {
    expect(containScale(0, 100, { aspect: 'standard' })).toBe(1);
    expect(coverScale(100, -5, { aspect: 'standard' })).toBe(1);
    expect(containScale(NaN, 100, { aspect: 'tarot' })).toBe(1);
    expect(coverScale(100, Infinity, { aspect: 'tarot' })).toBe(1);
  });
});

describe('addLayer：自動分類（SCHEMA §1.3）', () => {
  it('沒有透明 → 底圖：depth 0、放第 0 個、cover、holo 關', () => {
    const card = cardWith([depthLayer({ id: 'a', depth: 50 })]);
    const r = addLayer(card, 'front', input({ id: 'bg', hasAlpha: false, width: 2000, height: 1000 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layerId).toBe('bg');
    expect(ids(r.card.front.layers)).toEqual(['bg', 'a']);
    const bg = r.card.front.layers[0];
    expect(bg).toMatchObject({ role: 'base', depth: 0, x: 0, y: 0, holo: false, visible: true, hasAlpha: false });
    expect(bg.scale).toBeCloseTo(STD_H * 2);
  });

  it('沒有透明、這面已經有底圖 → 回報要取代，卡不變', () => {
    const card = sample();
    const r = addLayer(card, 'front', input({ hasAlpha: false }));
    expect(r).toEqual({ ok: false, reason: 'needs-replace-base' });
  });

  it('有透明 → 立體層：放陣列最後、contain、holo 開、x=y=0', () => {
    const card = cardWith([baseLayer({ id: 'b' })]);
    const r = addLayer(card, 'front', input({ id: 'fox', width: 1000, height: 2000 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.card.front.layers)).toEqual(['b', 'fox']);
    const fox = r.card.front.layers[1];
    expect(fox).toMatchObject({ role: 'depth', depth: 50, x: 0, y: 0, holo: true, visible: true, hasAlpha: true });
    expect(fox.scale).toBeCloseTo(STD_H / 2);
  });

  it('立體層的 depth：50 → 70 → 90 → 100 → 100，後上傳的在陣列後面（前面）', () => {
    let card = newCard('standard', 'c', NOW);
    const added_ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const inp = input();
      added_ids.push(inp.id);
      card = added(card, 'front', inp);
    }
    expect(card.front.layers.map((l) => l.depth)).toEqual([50, 70, 90, 100, 100]);
    expect(ids(card.front.layers)).toEqual(added_ids);
  });

  it('depth 看的是目前最大值＋20，不是層數', () => {
    const card = cardWith([depthLayer({ id: 'a', depth: 10 })]);
    expect(added(card, 'front', input()).front.layers[1].depth).toBe(30);
  });

  it('立體層全刪光之後，下一個又從 50 開始；底圖不影響', () => {
    let card = cardWith([baseLayer({ id: 'b' }), depthLayer({ id: 'a', depth: 90 })]);
    card = removeLayer(card, 'front', 'a');
    expect(added(card, 'front', input()).front.layers[1].depth).toBe(50);
  });

  it('正面與背面各自計算 depth', () => {
    const card = sample(); // 背面有 d50
    expect(added(card, 'back', input()).back.layers[1].depth).toBe(70);
    expect(added(card, 'front', input()).front.layers[4].depth).toBe(100);
  });

  it('每面已有 8 層 → face-full（有透明、沒透明都一樣）', () => {
    let card = newCard('standard', 'c', NOW);
    for (let i = 0; i < 8; i++) card = added(card, 'front', input());
    expect(card.front.layers).toHaveLength(8);
    expect(addLayer(card, 'front', input())).toEqual({ ok: false, reason: 'face-full' });
    expect(addLayer(card, 'front', input({ hasAlpha: false }))).toEqual({ ok: false, reason: 'face-full' });
    // 背面還是可以加
    expect(addLayer(card, 'back', input()).ok).toBe(true);
  });

  it('8 層裡有底圖時，再傳不透明的圖 → 問要不要取代（取代不會超過 8 層）', () => {
    let card = cardWith([baseLayer({ id: 'b' })]);
    for (let i = 0; i < 7; i++) card = added(card, 'front', input());
    expect(addLayer(card, 'front', input({ hasAlpha: false }))).toEqual({ ok: false, reason: 'needs-replace-base' });
  });

  it('名字：去頭尾空白、截到 60 字、空白就叫「圖層」', () => {
    const card = newCard('standard', 'c', NOW);
    expect(added(card, 'front', input({ name: '  狐狸  ' })).front.layers[0].name).toBe('狐狸');
    expect(added(card, 'front', input({ name: '' })).front.layers[0].name).toBe('圖層');
    expect(added(card, 'front', input({ name: '   ' })).front.layers[0].name).toBe('圖層');
    expect(added(card, 'front', input({ name: '字'.repeat(61) })).front.layers[0].name).toBe('字'.repeat(60));
    // 表情符號以「字」計，不會切成半個
    expect(added(card, 'front', input({ name: '😀'.repeat(61) })).front.layers[0].name).toBe('😀'.repeat(60));
  });

  it('圖片雜湊、id、透明旗標照傳入的值', () => {
    const inp = input({ id: 'x1', image: hash(77) });
    const r = addLayer(newCard('standard', 'c', NOW), 'back', inp);
    expect(r.ok && r.card.back.layers[0]).toMatchObject({ id: 'x1', image: hash(77), hasAlpha: true });
  });

  it('加完的卡通過驗證；不改輸入的卡與 input；不碰 updatedAt；另一面不變', () => {
    const card = deepFreeze(sample());
    const inp = deepFreeze(input());
    const next = added(card, 'front', inp);
    expect(validateCard(next, anyImage)).toEqual([]);
    expect(next.updatedAt).toBe(card.updatedAt);
    expect(next.back).toBe(card.back);
    expect(card.front.layers).toHaveLength(4);
  });
});

describe('addLayer／replaceBase：擋不合格的輸入（回 invalid-input，不加進卡片）', () => {
  const INVALID: AddLayerResult = { ok: false, reason: 'invalid-input' };

  /** 正面 b、a50、c70、e90，背面 d50（sample()），各種不合格的 input。 */
  const badInputs: [string, () => NewLayerInput][] = [
    ['id 和同一面的圖層重複', () => input({ id: 'a' })],
    ['id 和另一面的圖層重複', () => input({ id: 'd' })],
    ['id 和底圖重複', () => input({ id: 'b', hasAlpha: false })],
    ['id 是空字串', () => input({ id: '' })],
    ['id 101 字', () => input({ id: 'x'.repeat(101) })],
    ['image 太短', () => input({ image: 'abc' })],
    ['image 少一碼', () => input({ image: 'a'.repeat(15) })],
    ['image 多一碼', () => input({ image: 'a'.repeat(17) })],
    ['image 有大寫', () => input({ image: 'ABCDEF0123456789' })],
    ['image 有非十六進位字', () => input({ image: 'g'.repeat(16) })],
    ['image 是空字串', () => input({ image: '' })],
  ];

  it.each(badInputs)('addLayer：%s', (_label, make) => {
    const card = deepFreeze(sample());
    for (const face of ['front', 'back'] as const) {
      const bad = make();
      expect(addLayer(card, face, bad)).toEqual(INVALID);
      expect(addLayer(card, face, { ...bad, hasAlpha: !bad.hasAlpha })).toEqual(INVALID);
    }
  });

  it.each(badInputs)('replaceBase：%s → 回傳原卡（同一個物件）', (_label, make) => {
    const card = deepFreeze(sample());
    expect(replaceBase(card, 'front', make())).toBe(card);
    expect(replaceBase(card, 'back', make())).toBe(card);
  });

  it('不合格的輸入優先於 needs-replace-base 與 face-full（不會問使用者要不要取代一張加不進去的圖）', () => {
    const card = sample(); // 正面有底圖
    expect(addLayer(card, 'front', input({ id: 'a', hasAlpha: false }))).toEqual(INVALID);
    let full = newCard('standard', 'c', NOW);
    for (let i = 0; i < 8; i++) full = added(full, 'front', input());
    expect(addLayer(full, 'front', input({ image: 'nope' }))).toEqual(INVALID);
  });

  it('id 剛好 100 字、image 剛好 16 碼小寫十六進位 → 合格', () => {
    const card = newCard('standard', 'c', NOW);
    const r = addLayer(card, 'front', input({ id: 'x'.repeat(100), image: 'abcdef0123456789' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateCard(r.card, anyImage)).toEqual([]);
  });

  it('id 以 Unicode 字元計：100 個表情符號（200 個 UTF-16 單位）合格、101 個擋掉（不能改用 id.length 比）', () => {
    const card = newCard('standard', 'c', NOW);
    const ok = '😀'.repeat(100);
    expect(ok.length).toBe(200);
    const r = addLayer(card, 'front', input({ id: ok }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layerId).toBe(ok);
      expect(validateCard(r.card, anyImage)).toEqual([]);
    }
    const tooLong = '😀'.repeat(101);
    expect(addLayer(card, 'front', input({ id: tooLong }))).toEqual(INVALID);
    expect(addLayer(card, 'back', input({ id: tooLong, hasAlpha: false }))).toEqual(INVALID);
    // 取代底圖走同一道檢查
    expect(replaceBase(card, 'front', input({ id: ok, hasAlpha: false })).front.layers[0]?.id).toBe(ok);
    expect(replaceBase(card, 'front', input({ id: tooLong, hasAlpha: false }))).toBe(card);
  });

  it('id 和卡片自己的 id 相同沒關係（兩種 id 不同範圍）', () => {
    expect(addLayer(newCard('standard', 'same', NOW), 'front', input({ id: 'same' })).ok).toBe(true);
  });

  it('取代底圖時，新 id 和「即將被取代的舊底圖」相同也擋掉（一律不准和現有圖層重複）', () => {
    const card = sample();
    expect(replaceBase(card, 'front', input({ id: 'b', hasAlpha: false }))).toBe(card);
  });

  it('合格的輸入照常加／取代', () => {
    const card = sample();
    expect(addLayer(card, 'front', input({ id: 'fresh' })).ok).toBe(true);
    expect(ids(replaceBase(card, 'front', input({ id: 'fresh', hasAlpha: false })).front.layers)).toEqual(['fresh', 'a', 'c', 'e']);
  });
});

describe('replaceBase：取代底圖', () => {
  it('新 id、新圖、預設擺法重新填滿，不沿用舊的 x／y／scale；其他層不動', () => {
    const card = deepFreeze(
      cardWith([
        baseLayer({ id: 'b', x: 0.3, y: -0.2, scale: 2.5, visible: false }),
        depthLayer({ id: 'a', depth: 50 }),
      ]),
    );
    const next = replaceBase(card, 'front', input({ id: 'b2', name: '新背景', image: hash(9), hasAlpha: false, width: 2000, height: 1000 }));
    expect(ids(next.front.layers)).toEqual(['b2', 'a']);
    const b2 = next.front.layers[0];
    expect(b2).toMatchObject({ id: 'b2', name: '新背景', role: 'base', image: hash(9), depth: 0, x: 0, y: 0, visible: true, holo: false, hasAlpha: false });
    expect(b2.scale).toBeCloseTo(STD_H * 2);
    expect(next.front.layers[1]).toBe(card.front.layers[1]);
    expect(next.back).toBe(card.back);
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('這面還沒有底圖：放到第 0 個', () => {
    const card = cardWith([depthLayer({ id: 'a' })]);
    const next = replaceBase(card, 'front', input({ id: 'b', hasAlpha: false }));
    expect(ids(next.front.layers)).toEqual(['b', 'a']);
  });

  it('有底圖而且已經 8 層：取代成功，仍是 8 層、底圖在第 0 個', () => {
    let card = cardWith([baseLayer({ id: 'b' })]);
    for (let i = 0; i < 7; i++) card = added(card, 'front', input());
    expect(card.front.layers).toHaveLength(8);
    const next = replaceBase(card, 'front', input({ id: 'b2', hasAlpha: false }));
    expect(next).not.toBe(card);
    expect(next.front.layers).toHaveLength(8);
    expect(next.front.layers[0]).toMatchObject({ id: 'b2', role: 'base' });
    expect(next.front.layers.some((l) => l.id === 'b')).toBe(false);
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('沒有底圖而且已經 8 層：不變（回傳原卡）', () => {
    let card = newCard('standard', 'c', NOW);
    for (let i = 0; i < 8; i++) card = added(card, 'front', input());
    expect(replaceBase(card, 'front', input({ hasAlpha: false }))).toBe(card);
  });
});

describe('removeLayer', () => {
  it('刪掉指定圖層，其他順序不變', () => {
    const card = deepFreeze(sample());
    const next = removeLayer(card, 'front', 'c');
    expect(ids(next.front.layers)).toEqual(['b', 'a', 'e']);
    expect(next.back).toBe(card.back);
  });

  it('找不到 id（或在另一面）就回傳原卡', () => {
    const card = sample();
    expect(removeLayer(card, 'front', 'nope')).toBe(card);
    expect(removeLayer(card, 'front', 'd')).toBe(card);
  });
});

describe('updateLayer：改屬性、夾範圍、重新排序', () => {
  it('數值超範圍就夾住', () => {
    const card = sample();
    const l = (patch: Parameters<typeof updateLayer>[3]) => findLayer(updateLayer(card, 'front', 'a', patch), 'front', 'a');
    expect(l({ x: 2 })?.x).toBe(1);
    expect(l({ x: -3 })?.x).toBe(-1);
    expect(l({ y: -5 })?.y).toBe(-1);
    expect(l({ y: 1.5 })?.y).toBe(1);
    expect(l({ scale: 10 })?.scale).toBe(4);
    expect(l({ scale: 0.001 })?.scale).toBe(0.05);
    expect(l({ scale: -1 })?.scale).toBe(0.05);
    expect(l({ depth: 150 })?.depth).toBe(100);
    expect(l({ depth: 0 })?.depth).toBe(1);
    expect(l({ depth: -20 })?.depth).toBe(1);
  });

  it('NaN／Infinity 的欄位忽略，其他欄位照改', () => {
    const card = sample();
    expect(updateLayer(card, 'front', 'a', { x: NaN, y: Infinity, scale: -Infinity, depth: NaN })).toBe(card);
    const next = updateLayer(card, 'front', 'a', { x: NaN, y: 0.5 });
    expect(findLayer(next, 'front', 'a')).toMatchObject({ x: 0, y: 0.5 });
  });

  it('範圍內的值照改', () => {
    const next = updateLayer(sample(), 'front', 'a', { x: 0.25, y: -0.75, scale: 1.5, visible: false, holo: false });
    expect(findLayer(next, 'front', 'a')).toMatchObject({ x: 0.25, y: -0.75, scale: 1.5, visible: false, holo: false });
  });

  it('底圖的 depth 永遠 0', () => {
    const card = sample();
    expect(updateLayer(card, 'front', 'b', { depth: 50 })).toBe(card);
    const next = updateLayer(card, 'front', 'b', { depth: 50, x: 0.1 });
    expect(findLayer(next, 'front', 'b')).toMatchObject({ depth: 0, x: 0.1 });
    expect(next.front.layers[0].id).toBe('b');
  });

  it('改 depth 後重新排序（SCHEMA §1.2 深度滑桿）', () => {
    const next = updateLayer(sample(), 'front', 'a', { depth: 95 });
    expect(ids(next.front.layers)).toEqual(['b', 'c', 'e', 'a']);
    expect(next.front.layers.map((l) => l.depth)).toEqual([0, 70, 90, 95]);
    const back = updateLayer(next, 'front', 'e', { depth: 1 });
    expect(ids(back.front.layers)).toEqual(['b', 'e', 'c', 'a']);
    expect(validateCard(back, anyImage)).toEqual([]);
  });

  it('穩定排序：改成和別層同 depth 時維持原本的相對順序', () => {
    const card = sample(); // b0 a50 c70 e90
    expect(ids(updateLayer(card, 'front', 'c', { depth: 50 }).front.layers)).toEqual(['b', 'a', 'c', 'e']);
    expect(ids(updateLayer(card, 'front', 'a', { depth: 70 }).front.layers)).toEqual(['b', 'a', 'c', 'e']);
    expect(ids(updateLayer(card, 'front', 'a', { depth: 90 }).front.layers)).toEqual(['b', 'c', 'a', 'e']);
  });

  it('名字：去頭尾空白、截 60 字；空白就不改', () => {
    const card = sample();
    expect(findLayer(updateLayer(card, 'front', 'a', { name: '  新名字 ' }), 'front', 'a')?.name).toBe('新名字');
    expect(findLayer(updateLayer(card, 'front', 'a', { name: 'x'.repeat(70) }), 'front', 'a')?.name).toBe('x'.repeat(60));
    expect(updateLayer(card, 'front', 'a', { name: '   ' })).toBe(card);
    expect(updateLayer(card, 'front', 'a', { name: '' })).toBe(card);
  });

  it('找不到 id、在另一面、或沒有任何改變 → 回傳原卡', () => {
    const card = sample();
    expect(updateLayer(card, 'front', 'nope', { x: 0.5 })).toBe(card);
    expect(updateLayer(card, 'back', 'a', { x: 0.5 })).toBe(card);
    expect(updateLayer(card, 'front', 'a', {})).toBe(card);
    expect(updateLayer(card, 'front', 'a', { x: 0, depth: 50 })).toBe(card);
  });

  it('不改輸入、不碰 updatedAt、另一面不變', () => {
    const card = deepFreeze(sample());
    const next = updateLayer(card, 'front', 'a', { x: 0.5, depth: 99 });
    expect(next.updatedAt).toBe(card.updatedAt);
    expect(next.back).toBe(card.back);
    expect(findLayer(card, 'front', 'a')?.x).toBe(0);
  });
});

describe('swapDepth：拖拉排序＝交換兩層的 depth（SCHEMA §1.2）', () => {
  it('depth 不同：交換 depth 值，陣列仍依 depth 排好', () => {
    const card = deepFreeze(sample()); // b0 a50 c70 e90
    const next = swapDepth(card, 'front', 'a', 'e');
    expect(ids(next.front.layers)).toEqual(['b', 'e', 'c', 'a']);
    expect(next.front.layers.map((l) => l.depth)).toEqual([0, 50, 70, 90]);
    expect(findLayer(next, 'front', 'a')?.depth).toBe(90);
    expect(findLayer(next, 'front', 'e')?.depth).toBe(50);
    expect(validateCard(next, anyImage)).toEqual([]);
    // 順序無關
    expect(swapDepth(card, 'front', 'e', 'a')).toEqual(next);
  });

  it('直接佔對方原位：中間有同 depth 的其他層時，陣列位置也各自換到對方的位置', () => {
    const card = cardWith([
      baseLayer({ id: 'b' }),
      depthLayer({ id: 'a', depth: 50 }),
      depthLayer({ id: 'x', depth: 50 }),
      depthLayer({ id: 'c', depth: 70 }),
    ]);
    const next = swapDepth(card, 'front', 'a', 'c');
    expect(ids(next.front.layers)).toEqual(['b', 'c', 'x', 'a']);
    expect(next.front.layers.map((l) => l.depth)).toEqual([0, 50, 50, 70]);
    expect(next.front.layers[2]).toBe(card.front.layers[2]); // x 完全沒動
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('相鄰兩層交換', () => {
    const next = swapDepth(sample(), 'front', 'c', 'e');
    expect(ids(next.front.layers)).toEqual(['b', 'a', 'e', 'c']);
  });

  it('depth 相同：交換陣列位置（改變前後）', () => {
    const card = cardWith([baseLayer({ id: 'b' }), depthLayer({ id: 'p', depth: 100 }), depthLayer({ id: 'q', depth: 100 })]);
    const next = swapDepth(card, 'front', 'p', 'q');
    expect(ids(next.front.layers)).toEqual(['b', 'q', 'p']);
    expect(next.front.layers.map((l) => l.depth)).toEqual([0, 100, 100]);
  });

  it('牽涉底圖、找不到、同一層、跨面 → 不變（回傳原卡）', () => {
    const card = sample();
    expect(swapDepth(card, 'front', 'b', 'a')).toBe(card);
    expect(swapDepth(card, 'front', 'a', 'b')).toBe(card);
    expect(swapDepth(card, 'front', 'a', 'nope')).toBe(card);
    expect(swapDepth(card, 'front', 'a', 'a')).toBe(card);
    expect(swapDepth(card, 'front', 'a', 'd')).toBe(card);
  });
});

describe('Face 上的其他欄位不會被動作弄丟（M3 文字圖層可能會加）', () => {
  it('每個改圖層的動作都保留 face 上 layers 以外的欄位', () => {
    const base = sample();
    const card = { ...base, front: { ...base.front, note: 'keep-front' }, back: { ...base.back, note: 'keep-back' } } as unknown as Card;
    const noteOf = (c: Card, face: 'front' | 'back') => (c[face] as unknown as { note?: string }).note;
    const results: [string, Card][] = [
      ['addLayer', added(card, 'front', input())],
      ['replaceBase', replaceBase(card, 'front', input({ hasAlpha: false }))],
      ['removeLayer', removeLayer(card, 'front', 'a')],
      ['updateLayer', updateLayer(card, 'front', 'a', { depth: 80 })],
      ['swapDepth', swapDepth(card, 'front', 'a', 'c')],
      ['centerLayer', centerLayer(updateLayer(card, 'front', 'a', { x: 0.5 }), 'front', 'a')],
      ['fillLayer', fillLayer(card, 'front', 'a', 2000, 1000, 0)],
    ];
    for (const [label, next] of results) {
      expect(next, label).not.toBe(card);
      expect(noteOf(next, 'front'), label).toBe('keep-front');
      expect(noteOf(next, 'back'), label).toBe('keep-back');
    }
    expect(noteOf(added(card, 'back', input()), 'back')).toBe('keep-back');
  });
});

describe('centerLayer：置中（SCHEMA §1.3 對齊按鈕）', () => {
  it('x、y 歸 0，大小不變', () => {
    const card = deepFreeze(cardWith([depthLayer({ id: 'a', x: 0.3, y: -0.4, scale: 1.5 })]));
    expect(findLayer(centerLayer(card, 'front', 'a'), 'front', 'a')).toMatchObject({ x: 0, y: 0, scale: 1.5 });
  });

  it('已經置中或找不到 → 回傳原卡', () => {
    const card = sample();
    expect(centerLayer(card, 'front', 'a')).toBe(card);
    expect(centerLayer(card, 'front', 'nope')).toBe(card);
  });
});

describe('fillLayer：填滿（cover＋出血）', () => {
  it('立體層：cover 加四邊出血，並置中', () => {
    const card = deepFreeze(cardWith([depthLayer({ id: 'a', x: 0.5, y: 0.5, scale: 0.3 })]));
    const tall = findLayer(fillLayer(card, 'front', 'a', 1000, 2000, 0.05), 'front', 'a');
    expect(tall).toMatchObject({ x: 0, y: 0 });
    expect(tall?.scale).toBeCloseTo(1.1);
    const wide = findLayer(fillLayer(card, 'front', 'a', 2000, 1000, 0.05), 'front', 'a');
    expect(wide?.scale).toBeCloseTo((STD_H + 0.1) * 2);
  });

  it('沒有出血就是純 cover', () => {
    const card = cardWith([depthLayer({ id: 'a' })]);
    expect(findLayer(fillLayer(card, 'front', 'a', 2000, 1000, 0), 'front', 'a')?.scale).toBeCloseTo(STD_H * 2);
  });

  it('用卡片目前的比例算卡高（塔羅）', () => {
    const card = cardWith([depthLayer({ id: 'a' })], [], 'tarot');
    expect(findLayer(fillLayer(card, 'front', 'a', 700, 1000, 0.05), 'front', 'a')?.scale).toBeCloseTo((TAROT_H + 0.1) * 0.7);
  });

  it('底圖不加出血', () => {
    const card = cardWith([baseLayer({ id: 'b', scale: 3 })]);
    expect(findLayer(fillLayer(card, 'front', 'b', 1000, 2000, 0.05), 'front', 'b')?.scale).toBeCloseTo(1);
  });

  it('出血是負數或 NaN 時當 0；scale 夾在 4 以內', () => {
    const card = cardWith([depthLayer({ id: 'a' })]);
    expect(findLayer(fillLayer(card, 'front', 'a', 1000, 2000, -0.2), 'front', 'a')?.scale).toBeCloseTo(1);
    expect(findLayer(fillLayer(card, 'front', 'a', 1000, 2000, NaN), 'front', 'a')?.scale).toBeCloseTo(1);
    expect(findLayer(fillLayer(card, 'front', 'a', 2000, 100, 0.05), 'front', 'a')?.scale).toBe(4);
  });

  it('找不到、圖片尺寸不合理、結果和原本一樣 → 回傳原卡', () => {
    const card = cardWith([depthLayer({ id: 'a', scale: 1 })]);
    expect(fillLayer(card, 'front', 'nope', 100, 100, 0)).toBe(card);
    expect(fillLayer(card, 'front', 'a', 0, 100, 0)).toBe(card);
    expect(fillLayer(card, 'front', 'a', 100, NaN, 0)).toBe(card);
    expect(fillLayer(card, 'front', 'a', 1000, 2000, 0)).toBe(card);
  });
});

describe('updateCard：卡片屬性', () => {
  it('名字：去頭尾空白、截 60 字；空白就不改', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { name: '  我的卡  ' }).name).toBe('我的卡');
    expect(updateCard(card, { name: '卡'.repeat(61) }).name).toBe('卡'.repeat(60));
    expect(updateCard(card, { name: '  ' })).toBe(card);
  });

  it('換比例時圖層的 x／y／scale 不變（SCHEMA §1.3）', () => {
    const card = deepFreeze(sample());
    const next = updateCard(card, { aspect: 'tarot' });
    expect(next.aspect).toBe('tarot');
    expect(next.front).toBe(card.front);
    expect(next.back).toBe(card.back);
  });

  it('不認得的比例忽略', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { aspect: 'round' as never })).toBe(card);
    expect(updateCard(card, { aspect: 'toString' as never })).toBe(card);
  });

  it('卡身色：合格就改成小寫，不合格忽略', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { bodyColor: '#ABCDEF' }).bodyColor).toBe('#abcdef');
    expect(updateCard(card, { bodyColor: 'red' })).toBe(card);
    expect(updateCard(card, { bodyColor: '#abc' })).toBe(card);
  });

  it('圓角夾在 0～0.12、NaN 忽略', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { cornerRadius: 0.5 }).cornerRadius).toBe(0.12);
    expect(updateCard(card, { cornerRadius: -1 }).cornerRadius).toBe(0);
    expect(updateCard(card, { cornerRadius: 0.08 }).cornerRadius).toBe(0.08);
    expect(updateCard(card, { cornerRadius: NaN })).toBe(card);
  });

  it('卡框：只改給的欄位；寬度夾 0.01～0.08；顏色不合格忽略', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { frame: { enabled: true } }).frame).toEqual({ enabled: true, width: 0.03, color: '#d8dbe2', shine: 50 });
    expect(updateCard(card, { frame: { width: 1 } }).frame.width).toBe(0.08);
    expect(updateCard(card, { frame: { width: 0 } }).frame.width).toBe(0.01);
    expect(updateCard(card, { frame: { color: '#123456' } }).frame.color).toBe('#123456');
    expect(updateCard(card, { frame: { color: 'blue', width: Infinity } })).toBe(card);
  });

  it('鐳射：各數值夾範圍、不認得的欄位（舊的範圍 scope）忽略', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { holo: { strength: 150 } }).holo).toEqual({ ...card.holo, strength: 100 });
    expect(updateCard(card, { holo: { strength: -5 } }).holo.strength).toBe(0);
    expect(updateCard(card, { holo: { bandWidth: 0 } }).holo.bandWidth).toBe(0.1);
    expect(updateCard(card, { holo: { bandWidth: 5 } }).holo.bandWidth).toBe(2);
    expect(updateCard(card, { holo: { sparkle: -5 } }).holo.sparkle).toBe(0);
    expect(updateCard(card, { holo: { sparkle: 101 } }).holo.sparkle).toBe(100);
    expect(updateCard(card, { holo: { matte: 60 } }).holo.matte).toBe(60);
    expect(updateCard(card, { holo: { scope: 'layers', strength: NaN } as never })).toBe(card);
  });

  it('卡框光澤：夾在 0～100、NaN／Infinity 忽略，只改光澤', () => {
    const card = deepFreeze(newCard('standard', 'c', NOW));
    expect(updateCard(card, { frame: { shine: 80 } }).frame).toEqual({ ...card.frame, shine: 80 });
    expect(updateCard(card, { frame: { shine: 0 } }).frame.shine).toBe(0);
    expect(updateCard(card, { frame: { shine: 150 } }).frame.shine).toBe(100);
    expect(updateCard(card, { frame: { shine: -3 } }).frame.shine).toBe(0);
    expect(updateCard(card, { frame: { shine: NaN } })).toBe(card);
    expect(updateCard(card, { frame: { shine: Infinity } })).toBe(card);
    expect(updateCard(card, { frame: { shine: '80' as never } })).toBe(card);
    expect(updateCard(card, { frame: { shine: 50 } })).toBe(card);
  });

  it('鐳射色彩：七選一，不認得（含原型鏈上的名字）就忽略；不動 colors', () => {
    const card = deepFreeze(newCard('standard', 'c', NOW));
    for (const palette of ['classic', 'silver', 'gold', 'aurora', 'galaxy', 'custom'] as const) {
      const next = updateCard(card, { holo: { palette } });
      expect(next.holo).toEqual({ ...card.holo, palette });
      expect(next.holo.colors).toBe(card.holo.colors);
    }
    expect(updateCard(card, { holo: { palette: 'warm' } })).toBe(card);
    expect(updateCard(card, { holo: { palette: 'neon' as never } })).toBe(card);
    expect(updateCard(card, { holo: { palette: 'toString' as never } })).toBe(card);
    expect(updateCard(card, { holo: { palette: 3 as never } })).toBe(card);
  });

  it('自訂色彩：剛好 4 個合格顏色才改（存成小寫的新陣列）；其他一律不改', () => {
    const card = deepFreeze(newCard('standard', 'c', NOW));
    const input = ['#FF0000', '#00ff00', '#0000FF', '#ffffff'];
    const next = updateCard(card, { holo: { colors: input } });
    expect(next.holo.colors).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
    expect(next.holo.colors).not.toBe(input);
    expect(next.holo.palette).toBe(card.holo.palette);
    expect(input).toEqual(['#FF0000', '#00ff00', '#0000FF', '#ffffff']); // 不改輸入
    // 和現在一樣（大小寫不同也算一樣）→ 原卡
    expect(updateCard(card, { holo: { colors: card.holo.colors.map((c) => c.toUpperCase()) } })).toBe(card);
    const sparse = ['#ff0000', '#00ff00', '#0000ff'];
    sparse.length = 4;
    for (const bad of [
      ['#ff0000', '#00ff00', '#0000ff'],
      ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'],
      ['#ff0000', '#00ff00', 'blue', '#ffffff'],
      ['#ff0000', '#00ff00', '#00f', '#ffffff'],
      [],
      sparse,
      '#ff0000',
      { 0: '#ff0000', 1: '#ff0000', 2: '#ff0000', 3: '#ff0000', length: 4 },
      null,
    ]) {
      expect(updateCard(card, { holo: { colors: bad as never } }), JSON.stringify(bad)).toBe(card);
    }
    // 顏色不合格只忽略顏色，同一次的其他欄位照改
    expect(updateCard(card, { holo: { colors: ['x'] as never, palette: 'custom' } }).holo).toEqual({ ...card.holo, palette: 'custom' });
  });

  it('陰影：濃淡、距離各自夾在 0～100、NaN／Infinity 忽略、只改給的欄位', () => {
    const card = deepFreeze(newCard('standard', 'c', NOW));
    expect(updateCard(card, { shadow: { strength: 0 } }).shadow).toEqual({ strength: 0, distance: 50 });
    expect(updateCard(card, { shadow: { distance: 100 } }).shadow).toEqual({ strength: 50, distance: 100 });
    expect(updateCard(card, { shadow: { strength: 120, distance: -5 } }).shadow).toEqual({ strength: 100, distance: 0 });
    expect(updateCard(card, { shadow: { strength: NaN, distance: Infinity } })).toBe(card);
    expect(updateCard(card, { shadow: { strength: '10' as never } })).toBe(card);
    expect(updateCard(card, { shadow: { strength: 50, distance: 50 } })).toBe(card);
    expect(updateCard(card, { shadow: {} })).toBe(card);
    // 沒改陰影時陰影物件不換
    expect(updateCard(card, { name: '新名字' }).shadow).toBe(card.shadow);
  });

  it('view：只收布林值', () => {
    const card = newCard('standard', 'c', NOW);
    expect(updateCard(card, { view: { showcase: true } }).view).toEqual({ returnToFront: true, showcase: true, stage: 'desk' });
    expect(updateCard(card, { view: { returnToFront: false } }).view).toEqual({ returnToFront: false, showcase: false, stage: 'desk' });
    expect(updateCard(card, { view: { showcase: 1 as never } })).toBe(card);
  });

  it('view.stage（T-314）：只收 halo／none，不認得的值不改', () => {
    // 新卡片預設是工作桌（T-832c）：這裡要測 halo／none 的切換，先換成全息光環
    const card = deepFreeze(updateCard(newCard('standard', 'c', NOW), { view: { stage: 'halo' } }));
    expect(card.view.stage).toBe('halo');
    const off = updateCard(card, { view: { stage: 'none' } });
    expect(off.view).toEqual({ returnToFront: true, showcase: false, stage: 'none' });
    expect(off.view).not.toBe(card.view);
    expect(updateCard(off, { view: { stage: 'halo' } }).view.stage).toBe('halo');
    for (const bad of ['glow', 'toString', '', 'HALO', null, 1, true, undefined]) {
      expect(updateCard(card, { view: { stage: bad as never } }), String(bad)).toBe(card);
    }
    // 一樣的值＝沒改，回原卡
    expect(updateCard(card, { view: { stage: 'halo' } })).toBe(card);
    expect(updateCard(off, { view: { stage: 'none' } })).toBe(off);
    // 和其他 view 欄位一起改、互不影響
    expect(updateCard(card, { view: { showcase: true, stage: 'none' } }).view).toEqual({ returnToFront: true, showcase: true, stage: 'none' });
    expect(updateCard(off, { view: { showcase: true } }).view).toEqual({ returnToFront: true, showcase: true, stage: 'none' });
    expect(validateCard(off, anyImage)).toEqual([]);
  });

  it('沒有改變就回傳原卡；改了也不碰 updatedAt、不改輸入、結果合格', () => {
    const card = deepFreeze(newCard('standard', 'c', NOW));
    expect(updateCard(card, {})).toBe(card);
    expect(updateCard(card, { name: '未命名卡片', frame: { enabled: false }, view: { showcase: false } })).toBe(card);
    const next = updateCard(card, {
      name: '新',
      cornerRadius: 0.1,
      frame: { enabled: true, shine: 90 },
      holo: { matte: 0, palette: 'custom', colors: ['#111111', '#222222', '#333333', '#444444'] },
      shadow: { strength: 10, distance: 90 },
      view: { showcase: true },
    });
    expect(next.updatedAt).toBe(NOW);
    expect(next.id).toBe(card.id);
    expect(next.createdAt).toBe(card.createdAt);
    expect(validateCard(next, anyImage)).toEqual([]);
  });
});

describe('所有動作都不改輸入物件', () => {
  it('凍結的卡跑過每個動作都不丟例外，原卡內容不變', () => {
    const card = deepFreeze(sample());
    const before = structuredClone(card);
    addLayer(card, 'front', input());
    addLayer(card, 'back', input({ hasAlpha: false }));
    replaceBase(card, 'front', input({ hasAlpha: false }));
    removeLayer(card, 'front', 'a');
    updateLayer(card, 'front', 'a', { x: 0.2, depth: 99, name: '改' });
    swapDepth(card, 'front', 'a', 'e');
    centerLayer(card, 'front', 'a');
    fillLayer(card, 'front', 'a', 100, 300, 0.05);
    updateCard(card, { name: 'n', aspect: 'tarot', frame: { width: 0.05, shine: 0 }, holo: { strength: 1, palette: 'gold', colors: ['#111111', '#222222', '#333333', '#444444'] }, shadow: { strength: 0, distance: 100 }, view: { showcase: true } });
    expect(card).toEqual(before);
  });
});
