// T-811 局部動態特效（SCHEMA §1 Layer.fx?、§1.1 驗證）：驗證規則（種類、顏色、強度與速度是 0～100 的整數、破框層不能有、
// 每一面最多 2 層）、updateLayer 加／改／拿掉（預設值、換種類時的顏色、第 3 層原樣回傳、破框互斥）、
// 其他動作（加圖層、交換深度、換圖、剪裁、變身圖、線稿高光、一鍵風格、刪層、寫出前整理）不會弄壞或弄丟它。
import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addTextLayer,
  omitCardDefaults,
  omitLayerDefaults,
  removeLayer,
  replaceLayerImage,
  swapDepth,
  updateLayer,
} from '../../src/model/actions';
import { DEFAULT_FX_SPEED, DEFAULT_FX_STRENGTH, FX_DEFAULT_COLORS, fxBlocked, fxCount, layerFx } from '../../src/model/fx';
import { applyCardStyle } from '../../src/model/styles';
import { MAX_FX_PER_FACE, type Card, type Layer, type LayerFx, type TextSpec } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const TEXT: TextSpec = { content: '星晶龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
const FIRE: LayerFx = { kind: 'fire', color: '#ff6a1f', strength: 70, speed: 50 };
const WATER: LayerFx = { kind: 'water', color: '#a8f0ff', strength: 40, speed: 20 };

/** 正面：底圖 b、立體層 a(50)、立體層 c(60)、文字層 t(70)；背面：立體層 d、e。 */
function sample(): Card {
  return cardWith(
    [
      baseLayer({ id: 'b', image: hash(1) }),
      depthLayer({ id: 'a', depth: 50, image: hash(2) }),
      depthLayer({ id: 'c', depth: 60, image: hash(3) }),
      depthLayer({ id: 't', depth: 70, image: hash(5), text: TEXT }),
    ],
    [depthLayer({ id: 'd', depth: 50, image: hash(4) }), depthLayer({ id: 'e', depth: 60, image: hash(6) })],
  );
}

/** 把 fx 放到指定的層上（直接改資料，不經過動作）。 */
function withFx(card: Card, fxById: Record<string, LayerFx>): Card {
  const put = (l: Layer): Layer => (fxById[l.id] ? { ...l, fx: fxById[l.id] } : l);
  return { ...card, front: { ...card.front, layers: card.front.layers.map(put) }, back: { ...card.back, layers: card.back.layers.map(put) } };
}

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]!);
}

const find = (c: Card, id: string): Layer => [...c.front.layers, ...c.back.layers].find((l) => l.id === id)!;

describe('validateCard：fx（SCHEMA §1.1）', () => {
  it('舊卡（沒有 fx）照樣合格', () => {
    expect(validateCard(sample(), anyImage)).toEqual([]);
  });

  it('立體層、底圖、文字層都可以有；每一面 2 層合格（兩面各自算）', () => {
    expect(validateCard(withFx(sample(), { a: FIRE }), anyImage)).toEqual([]);
    expect(validateCard(withFx(sample(), { b: FIRE, t: WATER }), anyImage)).toEqual([]);
    expect(validateCard(withFx(sample(), { a: FIRE, c: WATER, d: FIRE, e: WATER }), anyImage)).toEqual([]);
    // 大寫色碼、邊界值也合格
    expect(validateCard(withFx(sample(), { a: { kind: 'electric', color: '#4FD8FF', strength: 0, speed: 100 } }), anyImage)).toEqual([]);
  });

  it.each([
    ['不是物件', 'x', ['front.layers[1].fx']],
    ['null', null, ['front.layers[1].fx']],
    ['陣列', [], ['front.layers[1].fx']],
    ['種類不認得', { ...FIRE, kind: 'smoke' }, ['front.layers[1].fx.kind']],
    ['顏色格式不對', { ...FIRE, color: 'red' }, ['front.layers[1].fx.color']],
    ['強度不是整數', { ...FIRE, strength: 33.5 }, ['front.layers[1].fx.strength']],
    ['強度超出範圍', { ...FIRE, strength: 101 }, ['front.layers[1].fx.strength']],
    ['強度是文字', { ...FIRE, strength: '70' }, ['front.layers[1].fx.strength']],
    ['速度是負的', { ...FIRE, speed: -1 }, ['front.layers[1].fx.speed']],
    ['速度是 NaN', { ...FIRE, speed: Number.NaN }, ['front.layers[1].fx.speed']],
    ['少 speed', { kind: 'fire', color: '#ff6a1f', strength: 70 }, ['front.layers[1].fx.speed']],
    ['多一個欄位', { ...FIRE, size: 1 }, ['front.layers[1].fx.size']],
  ])('%s → 只錯在 fx', (_label, fx, expected) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[1].fx = fx;
    expect(paths(c)).toEqual(expected);
  });

  it('破框層不能有（連合格的 fx 也不行）', () => {
    const c: Raw = structuredClone(withFx(sample(), { a: FIRE }));
    c.front.layers[1].breakout = true;
    expect(paths(c)).toEqual(['front.layers[1].fx']);
  });

  it(`每一面最多 ${MAX_FX_PER_FACE} 層：第 3 層 → 錯在那一面`, () => {
    expect(paths(withFx(sample(), { b: FIRE, a: FIRE, c: WATER }))).toEqual(['front.layers']);
    expect(paths(withFx(sample(), { b: FIRE, a: FIRE, c: WATER, t: WATER }))).toEqual(['front.layers']);
  });
});

describe('fx 小工具', () => {
  it('layerFx：沒有＝null；fxCount：這一面有幾層有特效', () => {
    const c = withFx(sample(), { a: FIRE, t: WATER });
    expect(layerFx(find(c, 'b'))).toBeNull();
    expect(layerFx(find(c, 'a'))).toEqual(FIRE);
    expect(fxCount(c.front)).toBe(2);
    expect(fxCount(c.back)).toBe(0);
  });

  it('fxBlocked：破框層 → breakout；這一面已經有 2 層、這層還沒有 → face-full；已經有的那 2 層照樣能改', () => {
    const c = withFx(sample(), { a: FIRE, t: WATER });
    expect(fxBlocked(c.front, 2)).toBe('face-full');
    expect(fxBlocked(c.front, 0)).toBe('face-full');
    expect(fxBlocked(c.front, 1)).toBeNull();
    expect(fxBlocked(c.front, 3)).toBeNull();
    const one = withFx(sample(), { a: FIRE });
    expect(fxBlocked(one.front, 2)).toBeNull();
    const bo = { layers: one.front.layers.map((l) => (l.id === 'c' ? { ...l, breakout: true } : l)) };
    expect(fxBlocked(bo, 2)).toBe('breakout');
  });

  it('預設顏色：火焰橘紅、電光青藍、水波淡青；強度 70、速度 50', () => {
    expect(FX_DEFAULT_COLORS).toEqual({ fire: '#ff6a1f', electric: '#4fd8ff', water: '#a8f0ff' });
    expect(DEFAULT_FX_STRENGTH).toBe(70);
    expect(DEFAULT_FX_SPEED).toBe(50);
  });
});

describe('updateLayer：fx', () => {
  it('只給種類 → 用那一種的預設顏色、預設強度與速度（只有四個欄位）', () => {
    const c = deepFreeze(sample());
    for (const kind of ['fire', 'electric', 'water'] as const) {
      const next = updateLayer(c, 'front', 'a', { fx: { kind } });
      expect(find(next, 'a').fx).toEqual({ kind, color: FX_DEFAULT_COLORS[kind], strength: DEFAULT_FX_STRENGTH, speed: DEFAULT_FX_SPEED });
    }
  });

  it('還沒有特效時沒給種類（或種類不認得）→ 不改（同一個物件）', () => {
    const c = deepFreeze(sample());
    expect(updateLayer(c, 'front', 'a', { fx: { strength: 30 } })).toBe(c);
    expect(updateLayer(c, 'front', 'a', { fx: { kind: 'smoke' as never } })).toBe(c);
    expect(updateLayer(c, 'front', 'a', { fx: 'fire' as never })).toBe(c);
  });

  it('改一部分：其他欄位不變；強度、速度夾在 0～100 並四捨五入；NaN 忽略；顏色存小寫、不合格忽略', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE }));
    expect(find(updateLayer(c, 'front', 'a', { fx: { strength: 33.6 } }), 'a').fx).toEqual({ ...FIRE, strength: 34 });
    expect(find(updateLayer(c, 'front', 'a', { fx: { speed: 150 } }), 'a').fx).toEqual({ ...FIRE, speed: 100 });
    expect(find(updateLayer(c, 'front', 'a', { fx: { speed: -5 } }), 'a').fx).toEqual({ ...FIRE, speed: 0 });
    expect(updateLayer(c, 'front', 'a', { fx: { strength: Number.NaN } })).toBe(c);
    expect(find(updateLayer(c, 'front', 'a', { fx: { color: '#ABCDEF' } }), 'a').fx).toEqual({ ...FIRE, color: '#abcdef' });
    expect(updateLayer(c, 'front', 'a', { fx: { color: 'blue' } })).toBe(c);
    // 一樣的值 → 同一個物件
    expect(updateLayer(c, 'front', 'a', { fx: { ...FIRE } })).toBe(c);
    expect(updateLayer(c, 'front', 'a', { fx: { color: '#FF6A1F' } })).toBe(c);
  });

  it('換種類：顏色還是預設的就換成新種類的預設；自己選過顏色就留著；這次也給了顏色就用給的', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE, c: { ...FIRE, color: '#123456' } }));
    expect(find(updateLayer(c, 'front', 'a', { fx: { kind: 'water' } }), 'a').fx).toEqual({ ...FIRE, kind: 'water', color: FX_DEFAULT_COLORS.water });
    expect(find(updateLayer(c, 'front', 'c', { fx: { kind: 'electric' } }), 'c').fx).toEqual({ ...FIRE, kind: 'electric', color: '#123456' });
    expect(find(updateLayer(c, 'front', 'a', { fx: { kind: 'water', color: '#00ff00' } }), 'a').fx).toEqual({ ...FIRE, kind: 'water', color: '#00ff00' });
  });

  it('null → 拿掉欄位（不是 undefined）；沒有特效時給 null → 同一個物件', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE }));
    const next = updateLayer(c, 'front', 'a', { fx: null });
    expect('fx' in find(next, 'a')).toBe(false);
    expect(updateLayer(next, 'front', 'a', { fx: null })).toBe(next);
  });

  it('底圖、文字層可以加', () => {
    const c = deepFreeze(sample());
    expect(find(updateLayer(c, 'front', 'b', { fx: { kind: 'water' } }), 'b').fx?.kind).toBe('water');
    expect(find(updateLayer(c, 'front', 't', { fx: { kind: 'electric' } }), 't').fx?.kind).toBe('electric');
  });

  it(`這一面已經有 ${MAX_FX_PER_FACE} 層：第 3 層加不上（原樣回傳）；同一次的其他欄位照樣改；已經有的照樣能改；另一面不算`, () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE, t: WATER }));
    expect(updateLayer(c, 'front', 'c', { fx: { kind: 'fire' } })).toBe(c);
    expect(updateLayer(c, 'front', 'b', { fx: { kind: 'fire' } })).toBe(c);
    const moved = updateLayer(c, 'front', 'c', { fx: { kind: 'fire' }, x: 0.3 });
    expect(find(moved, 'c').x).toBe(0.3);
    expect('fx' in find(moved, 'c')).toBe(false);
    expect(find(updateLayer(c, 'front', 'a', { fx: { kind: 'electric' } }), 'a').fx?.kind).toBe('electric');
    expect(find(updateLayer(c, 'back', 'd', { fx: { kind: 'fire' } }), 'd').fx?.kind).toBe('fire');
    // 拿掉一層之後就能加
    const freed = updateLayer(c, 'front', 'a', { fx: null });
    expect(find(updateLayer(freed, 'front', 'c', { fx: { kind: 'fire' } }), 'c').fx?.kind).toBe('fire');
  });

  it('破框層加不上（其他欄位照樣改）；有特效的層不能打開衝出卡片；同一次先拿掉特效就可以', () => {
    const bo = deepFreeze(updateLayer(sample(), 'front', 'a', { breakout: true }));
    expect(updateLayer(bo, 'front', 'a', { fx: { kind: 'fire' } })).toBe(bo);
    expect(find(updateLayer(bo, 'front', 'a', { fx: { kind: 'fire' }, y: 0.2 }), 'a')).toMatchObject({ y: 0.2, breakout: true });
    expect('fx' in find(updateLayer(bo, 'front', 'a', { fx: { kind: 'fire' }, y: 0.2 }), 'a')).toBe(false);

    const c = deepFreeze(withFx(sample(), { a: FIRE }));
    expect(updateLayer(c, 'front', 'a', { breakout: true })).toBe(c);
    const both = updateLayer(c, 'front', 'a', { breakout: true, fx: null });
    expect(find(both, 'a').breakout).toBe(true);
    expect('fx' in find(both, 'a')).toBe(false);
    expect(validateCard(both, anyImage)).toEqual([]);
  });

  it('改其他欄位不動特效（同一個 fx 物件）', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE }));
    const next = updateLayer(c, 'front', 'a', { depth: 80, opacity: 40, blend: 'screen', lineart: true, clip: true });
    expect(find(next, 'a').fx).toBe(find(c, 'a').fx);
  });
});

describe('其他動作和 fx', () => {
  it(`這一面已經有 ${MAX_FX_PER_FACE} 層特效：照樣能上傳、加文字（新層沒有特效）`, () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE, c: WATER }));
    const up = addLayer(c, 'front', { id: 'n', name: 'n', image: hash(9), hasAlpha: true, width: 100, height: 100 });
    expect(up.ok).toBe(true);
    if (up.ok) {
      expect('fx' in find(up.card, 'n')).toBe(false);
      expect(validateCard(up.card, anyImage)).toEqual([]);
    }
    const tx = addTextLayer(c, 'front', { id: 'n2', image: hash(10), text: TEXT, width: 800, height: 200 });
    expect(tx.ok).toBe(true);
    if (tx.ok) expect('fx' in find(tx.card, 'n2')).toBe(false);
  });

  it('交換深度：特效跟著它的層走', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE }));
    const next = swapDepth(c, 'front', 'a', 'c');
    expect(find(next, 'a').fx).toEqual(FIRE);
    expect(find(next, 'a').depth).toBe(60);
    expect('fx' in find(next, 'c')).toBe(false);
  });

  it('換圖（自動去背）：特效留著', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE }));
    const next = replaceLayerImage(c, 'front', 'a', { image: hash(30), hasAlpha: true });
    expect(find(next, 'a').image).toBe(hash(30));
    expect(find(next, 'a').fx).toEqual(FIRE);
  });

  it('剪裁：剪裁層可以有特效；開關剪裁、刪掉下面那層，特效都還在', () => {
    let c: Card = withFx(sample(), { c: FIRE });
    c = updateLayer(c, 'front', 'c', { clip: true });
    expect(find(c, 'c')).toMatchObject({ clip: true, depth: 50, fx: FIRE });
    expect(validateCard(c, anyImage)).toEqual([]);
    expect(find(updateLayer(c, 'front', 'c', { clip: false }), 'c').fx).toEqual(FIRE);
    expect(find(removeLayer(c, 'front', 'a'), 'c').fx).toEqual(FIRE);
    // 剪裁中的層加特效
    let d: Card = updateLayer(sample(), 'front', 'c', { clip: true });
    d = updateLayer(d, 'front', 'c', { fx: { kind: 'water' } });
    expect(find(d, 'c').fx?.kind).toBe('water');
  });

  it('變身圖：有變身圖的層可以有特效；加、拿掉變身圖不動特效', () => {
    let c: Card = withFx(sample(), { a: FIRE });
    c = updateLayer(c, 'front', 'a', { alt: { image: hash(40), hasAlpha: true } });
    expect(find(c, 'a')).toMatchObject({ fx: FIRE, alt: { image: hash(40), hasAlpha: true } });
    expect(validateCard(c, anyImage)).toEqual([]);
    expect(find(updateLayer(c, 'front', 'a', { alt: null }), 'a').fx).toEqual(FIRE);
    const d = updateLayer(updateLayer(sample(), 'front', 'a', { alt: { image: hash(40), hasAlpha: true } }), 'front', 'a', { fx: { kind: 'electric' } });
    expect(find(d, 'a').fx?.kind).toBe('electric');
  });

  it('線稿高光：可以一起開', () => {
    const c = updateLayer(updateLayer(sample(), 'front', 'a', { lineart: true }), 'front', 'a', { fx: { kind: 'fire' } });
    expect(find(c, 'a')).toMatchObject({ lineart: true, fx: { kind: 'fire' } });
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('一鍵風格：不動圖層的特效', () => {
    const c = deepFreeze(withFx(sample(), { a: FIRE, d: WATER }));
    const next = applyCardStyle(c, 'gold');
    expect(next).not.toBe(c);
    expect(find(next, 'a').fx).toEqual(FIRE);
    expect(find(next, 'd').fx).toEqual(WATER);
  });

  it('寫出前整理：值是 undefined 的 fx 拿掉；有特效的照樣留著（同一個物件）', () => {
    const c = withFx(sample(), { a: FIRE });
    expect(omitLayerDefaults(c)).toBe(c);
    expect(omitCardDefaults(c).front.layers[1]!.fx).toEqual(FIRE);
    const raw: Card = { ...c, front: { layers: c.front.layers.map((l) => (l.id === 'c' ? { ...l, fx: undefined } : l)) } };
    const cleaned = omitLayerDefaults(raw);
    expect('fx' in find(cleaned, 'c')).toBe(false);
    expect(find(cleaned, 'a').fx).toEqual(FIRE);
  });
});
