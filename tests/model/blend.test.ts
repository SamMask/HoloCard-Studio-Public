// T-408 圖層不透明度與混合模式（SCHEMA §1 Layer.opacity?／blend?、§1.1 驗證、§1.3 上傳）：
// 驗證規則、updateLayer／addLayer 的新欄位、欄位可省略（舊卡照讀）、預設值不寫出。
import { describe, expect, it } from 'vitest';
import {
  addLayer,
  blendAllowed,
  layerBlend,
  layerOpacity,
  omitLayerDefaults,
  swapDepth,
  updateLayer,
  type NewLayerInput,
} from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { BLEND_MODES, OPAQUE_LAYER_BLENDS, type BlendMode, type Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash, ids, NOW } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** 正面：底圖 b、立體層 a(50)、c(70)；背面：立體層 d。 */
function sample(): Card {
  return cardWith(
    [baseLayer({ id: 'b', image: hash(1) }), depthLayer({ id: 'a', depth: 50, image: hash(2) }), depthLayer({ id: 'c', depth: 70, image: hash(3) })],
    [depthLayer({ id: 'd', depth: 50, image: hash(4) })],
  );
}

function raw(card: Card = sample()): Raw {
  return structuredClone(card);
}

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]);
}

const NON_OPAQUE = BLEND_MODES.filter((m) => !OPAQUE_LAYER_BLENDS.includes(m));

let seq = 0;
function input(over: Partial<NewLayerInput> = {}): NewLayerInput {
  seq += 1;
  return { id: `new-${seq}`, name: `光效${seq}`, image: hash(100 + seq), hasAlpha: false, width: 1000, height: 1000, ...over };
}

// ---------------------------------------------------------------- 驗證

describe('validateCard：不透明度與混合模式（SCHEMA §1.1）', () => {
  it('舊卡（沒有 opacity／blend 欄位）照樣合格', () => {
    const c = sample();
    for (const l of [...c.front.layers, ...c.back.layers]) {
      expect('opacity' in l).toBe(false);
      expect('blend' in l).toBe(false);
    }
    expect(validateCard(c, anyImage)).toEqual([]);
    expect(validateCard(JSON.parse(JSON.stringify(c)), anyImage)).toEqual([]);
  });

  it.each([0, 0.5, 37, 99.99, 100])('opacity %s 合格', (v) => {
    const c = raw();
    c.front.layers[1].opacity = v;
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each([-1, -0.01, 100.01, 101, NaN, Infinity, -Infinity, '50', null, true, undefined])('opacity 不合格（%s）只錯在 opacity', (v) => {
    const c = raw();
    c.front.layers[1].opacity = v;
    expect(paths(c)).toEqual(['front.layers[1].opacity']);
  });

  it.each(BLEND_MODES)('立體層的 blend %s 合格', (mode) => {
    const c = raw();
    c.front.layers[2].blend = mode;
    c.back.layers[0].blend = mode;
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each(['darken', 'Normal', 'SCREEN', '', 'toString', null, 3, undefined, {}])('blend 不合格（%s）只錯在 blend', (v) => {
    const c = raw();
    c.front.layers[2].blend = v;
    expect(paths(c)).toEqual(['front.layers[2].blend']);
  });

  it('底圖不能有 opacity（連 100 也不行）', () => {
    for (const v of [100, 50, 0]) {
      const c = raw();
      c.front.layers[0].opacity = v;
      expect(paths(c)).toEqual(['front.layers[0].opacity']);
    }
  });

  it('底圖不能有 blend（連 normal 也不行）', () => {
    for (const v of ['normal', 'screen'] as const) {
      const c = raw();
      c.front.layers[0].blend = v;
      expect(paths(c)).toEqual(['front.layers[0].blend']);
    }
  });

  it.each(OPAQUE_LAYER_BLENDS)('沒有透明的圖當立體層：blend %s 合格', (mode) => {
    const c = raw();
    c.front.layers[1].hasAlpha = false;
    c.front.layers[1].blend = mode;
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each([...NON_OPAQUE, 'missing'])('沒有透明的圖當立體層：blend %s 不行（只錯在 hasAlpha）', (mode) => {
    const c = raw();
    c.front.layers[1].hasAlpha = false;
    if (mode !== 'missing') c.front.layers[1].blend = mode;
    expect(paths(c)).toEqual(['front.layers[1].hasAlpha']);
  });

  it('沒有透明的立體層 blend 填了不認得的值：只報 blend 一條（不重複報 hasAlpha）', () => {
    const c = raw();
    c.front.layers[1].hasAlpha = false;
    c.front.layers[1].blend = 'darken';
    expect(paths(c)).toEqual(['front.layers[1].blend']);
  });

  it('文字圖層沒有透明：就算 blend 是 screen 也不行（只錯在 hasAlpha）', () => {
    const c = raw();
    c.front.layers[2].text = { content: '月夜', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
    c.front.layers[2].hasAlpha = false;
    c.front.layers[2].blend = 'screen';
    expect(paths(c)).toEqual(['front.layers[2].hasAlpha']);
  });

  it('文字圖層可以有 opacity 與任何 blend', () => {
    const c = raw();
    c.front.layers[2].text = { content: '月夜', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };
    c.front.layers[2].opacity = 40;
    c.front.layers[2].blend = 'soft-light';
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('有新欄位的卡經過 JSON 來回（匯出入、存讀的格式）仍合格、欄位不變', () => {
    const c = raw();
    c.front.layers[1].opacity = 35;
    c.front.layers[1].blend = 'screen';
    c.front.layers[1].hasAlpha = false;
    const back = JSON.parse(JSON.stringify(c));
    expect(validateCard(back, anyImage)).toEqual([]);
    expect(back.front.layers[1]).toMatchObject({ opacity: 35, blend: 'screen', hasAlpha: false });
  });
});

// ---------------------------------------------------------------- 讀值的小工具

describe('layerOpacity／layerBlend／blendAllowed', () => {
  it('省略＝100／normal', () => {
    expect(layerOpacity(depthLayer())).toBe(100);
    expect(layerBlend(depthLayer())).toBe('normal');
    expect(layerOpacity(depthLayer({ opacity: 25 }))).toBe(25);
    expect(layerBlend(depthLayer({ blend: 'color' }))).toBe('color');
  });

  it('有透明的立體層七種都可以；沒有透明的只有三種；底圖都不行', () => {
    for (const m of BLEND_MODES) expect(blendAllowed(depthLayer(), m)).toBe(true);
    for (const m of BLEND_MODES) expect(blendAllowed(depthLayer({ hasAlpha: false, blend: 'screen' }), m)).toBe(OPAQUE_LAYER_BLENDS.includes(m));
    for (const m of BLEND_MODES) expect(blendAllowed(baseLayer(), m)).toBe(false);
    expect(blendAllowed(depthLayer(), 'darken' as BlendMode)).toBe(false);
  });
});

// ---------------------------------------------------------------- updateLayer

describe('updateLayer：opacity', () => {
  it('設 50 → 寫進欄位；設回 100 → 欄位拿掉（預設值不寫出）', () => {
    const card = deepFreeze(sample());
    const half = updateLayer(card, 'front', 'a', { opacity: 50 });
    expect(half.front.layers[1]).toMatchObject({ id: 'a', opacity: 50 });
    const full = updateLayer(half, 'front', 'a', { opacity: 100 });
    expect('opacity' in full.front.layers[1]!).toBe(false);
    expect(full.front.layers[1]).toEqual(card.front.layers[1]);
    expect(validateCard(half, anyImage)).toEqual([]);
    expect(validateCard(full, anyImage)).toEqual([]);
  });

  it('夾在 0～100', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'a', { opacity: -20 }).front.layers[1]!.opacity).toBe(0);
    const over = updateLayer(updateLayer(card, 'front', 'a', { opacity: 10 }), 'front', 'a', { opacity: 250 });
    expect('opacity' in over.front.layers[1]!).toBe(false);
  });

  it('NaN／Infinity／不是數字 → 忽略（回原卡）', () => {
    const card = deepFreeze(sample());
    for (const v of [NaN, Infinity, -Infinity, '50' as never, null as never]) {
      expect(updateLayer(card, 'front', 'a', { opacity: v })).toBe(card);
    }
  });

  it('底圖不能調不透明度（回原卡）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'b', { opacity: 50 })).toBe(card);
  });

  it('和現在一樣 → 回原卡（同一個物件）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'a', { opacity: 100 })).toBe(card);
    const half = deepFreeze(updateLayer(card, 'front', 'a', { opacity: 50 }));
    expect(updateLayer(half, 'front', 'a', { opacity: 50 })).toBe(half);
  });
});

describe('updateLayer：blend', () => {
  it.each(BLEND_MODES.filter((m) => m !== 'normal'))('有透明的立體層換成 %s', (mode) => {
    const card = deepFreeze(sample());
    const next = updateLayer(card, 'front', 'c', { blend: mode });
    expect(next.front.layers[2]).toMatchObject({ id: 'c', blend: mode });
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('換回 normal → 欄位拿掉；本來就 normal → 回原卡', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'c', { blend: 'normal' })).toBe(card);
    const glow = updateLayer(card, 'front', 'c', { blend: 'screen' });
    const back = updateLayer(glow, 'front', 'c', { blend: 'normal' });
    expect('blend' in back.front.layers[2]!).toBe(false);
    expect(back.front.layers[2]).toEqual(card.front.layers[2]);
  });

  it('不認得的模式 → 不改', () => {
    const card = deepFreeze(sample());
    for (const v of ['darken', '', 'SCREEN', 'toString', 3, null] as never[]) {
      expect(updateLayer(card, 'front', 'c', { blend: v })).toBe(card);
    }
  });

  it('底圖不能換模式（回原卡）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'b', { blend: 'screen' })).toBe(card);
  });

  it('沒有透明的立體層：只能在加深／發光／強光之間換，其他不改', () => {
    const glowCard = cardWith([depthLayer({ id: 'g', hasAlpha: false, blend: 'screen' })]);
    const card = deepFreeze(glowCard);
    for (const m of NON_OPAQUE) expect(updateLayer(card, 'front', 'g', { blend: m })).toBe(card);
    for (const m of ['multiply', 'add'] as const) {
      const next = updateLayer(card, 'front', 'g', { blend: m });
      expect(next.front.layers[0]!.blend).toBe(m);
      expect(validateCard(next, anyImage)).toEqual([]);
    }
  });

  it('同時改 opacity、blend 與位置：一次全部套用', () => {
    const card = deepFreeze(sample());
    const next = updateLayer(card, 'front', 'a', { opacity: 30, blend: 'overlay', x: 0.2 });
    expect(next.front.layers[1]).toMatchObject({ opacity: 30, blend: 'overlay', x: 0.2 });
  });

  it('不合格的 blend 不影響同一次的其他欄位', () => {
    const card = deepFreeze(sample());
    const next = updateLayer(card, 'front', 'a', { opacity: 30, blend: 'darken' as never });
    expect(next.front.layers[1]!.opacity).toBe(30);
    expect('blend' in next.front.layers[1]!).toBe(false);
  });

  it('交換深度時 opacity／blend 跟著自己的圖層', () => {
    let card = sample();
    card = updateLayer(card, 'front', 'a', { opacity: 40, blend: 'screen' });
    const swapped = swapDepth(card, 'front', 'a', 'c');
    const a = swapped.front.layers.find((l) => l.id === 'a')!;
    const c = swapped.front.layers.find((l) => l.id === 'c')!;
    expect(a).toMatchObject({ opacity: 40, blend: 'screen', depth: 70 });
    expect('opacity' in c).toBe(false);
    expect('blend' in c).toBe(false);
  });
});

// ---------------------------------------------------------------- addLayer（上傳確認框的「當發光層／當加深層」）

describe('addLayer：沒有透明的圖＋指定混合模式 → 立體層（SCHEMA §1.3）', () => {
  it.each(OPAQUE_LAYER_BLENDS)('blend %s：加成立體層（depth 照一般規則、放得下、會反光、hasAlpha 照實記）', (mode) => {
    const card = deepFreeze(sample());
    const r = addLayer(card, 'front', input({ id: 'fx', blend: mode, width: 1000, height: 1000 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.card.front.layers)).toEqual(['b', 'a', 'c', 'fx']);
    const fx = r.card.front.layers[3]!;
    expect(fx).toMatchObject({ role: 'depth', depth: 90, hasAlpha: false, blend: mode, holo: true, visible: true, x: 0, y: 0, scale: 1 });
    expect('opacity' in fx).toBe(false);
    expect(validateCard(r.card, anyImage)).toEqual([]);
  });

  it('這一面還沒有立體層 → depth 50；已有底圖也不會問要不要取代', () => {
    const card = cardWith([baseLayer({ id: 'b' })]);
    const r = addLayer(card, 'front', input({ id: 'fx', blend: 'multiply' }));
    expect(r.ok && r.card.front.layers[1]).toMatchObject({ id: 'fx', depth: 50, blend: 'multiply' });
  });

  it.each([...NON_OPAQUE, 'darken'])('沒有透明的圖給 %s → invalid-input', (mode) => {
    const card = deepFreeze(sample());
    expect(addLayer(card, 'front', input({ blend: mode as BlendMode }))).toEqual({ ok: false, reason: 'invalid-input' });
  });

  it('沒給 blend 的不透明圖照舊：已有底圖 → needs-replace-base；沒有底圖 → 底圖', () => {
    expect(addLayer(sample(), 'front', input())).toEqual({ ok: false, reason: 'needs-replace-base' });
    const r = addLayer(newCard('standard', 'x', NOW), 'front', input({ id: 'bg' }));
    expect(r.ok && r.card.front.layers[0]).toMatchObject({ id: 'bg', role: 'base' });
    expect(r.ok && 'blend' in r.card.front.layers[0]!).toBe(false);
  });

  it('這一面滿了 → face-full', () => {
    const layers = [baseLayer({ id: 'b0', image: hash(1) })];
    for (let i = 1; i < 8; i++) layers.push(depthLayer({ id: `d${i}`, depth: i * 10, image: hash(i + 1) }));
    expect(addLayer(cardWith(layers), 'front', input({ blend: 'screen' }))).toEqual({ ok: false, reason: 'face-full' });
  });

  it('有透明的圖也可以直接指定模式；給 normal 不寫欄位', () => {
    const card = sample();
    const r = addLayer(card, 'front', input({ id: 'ov', hasAlpha: true, blend: 'overlay' }));
    expect(r.ok && r.card.front.layers.at(-1)).toMatchObject({ id: 'ov', hasAlpha: true, blend: 'overlay' });
    const n = addLayer(card, 'front', input({ id: 'nm', hasAlpha: true, blend: 'normal' }));
    expect(n.ok && 'blend' in n.card.front.layers.at(-1)!).toBe(false);
  });
});

// ---------------------------------------------------------------- omitLayerDefaults

describe('omitLayerDefaults：明寫的預設值寫出時省略（T-413）', () => {
  /** 正面 a 明寫 100／normal、c 明寫 normal 但 opacity 40；背面 d 明寫 opacity 100 但 blend screen。 */
  function explicit(): Raw {
    const r = raw();
    Object.assign(r.front.layers[1], { opacity: 100, blend: 'normal' });
    Object.assign(r.front.layers[2], { opacity: 40, blend: 'normal' });
    Object.assign(r.back.layers[0], { opacity: 100, blend: 'screen' });
    return r;
  }

  it('明寫的 opacity: 100、blend: normal 合法（validate 接受），整理後拿掉；不是預設值的原樣', () => {
    const input = deepFreeze(explicit()) as Card;
    expect(validateCard(input, anyImage)).toEqual([]);
    const out = omitLayerDefaults(input);
    const [, a, c] = out.front.layers;
    expect('opacity' in a! || 'blend' in a!).toBe(false);
    expect(a).toEqual(sample().front.layers[1]);
    expect(c).toMatchObject({ id: 'c', opacity: 40 });
    expect('blend' in c!).toBe(false);
    expect(out.back.layers[0]).toMatchObject({ id: 'd', blend: 'screen' });
    expect('opacity' in out.back.layers[0]!).toBe(false);
    expect(validateCard(out, anyImage)).toEqual([]);
    // 圖層以外的欄位不動
    expect({ ...out, front: null, back: null }).toEqual({ ...input, front: null, back: null });
  });

  it('沒有明寫預設值 → 回原卡（同一個物件）；只有一面要整理 → 另一面原樣（同一個物件）', () => {
    const plain = deepFreeze(sample());
    expect(omitLayerDefaults(plain)).toBe(plain);
    const set = deepFreeze(updateLayer(updateLayer(sample(), 'front', 'a', { opacity: 50 }), 'front', 'c', { blend: 'multiply' }));
    expect(omitLayerDefaults(set)).toBe(set);
    const r = raw();
    r.back.layers[0].opacity = 100;
    const backOnly = deepFreeze(r) as Card;
    const out = omitLayerDefaults(backOnly);
    expect(out.front).toBe(backOnly.front);
    expect('opacity' in out.back.layers[0]!).toBe(false);
  });

  it('JSON 來回（卡片檔、存檔的格式）之後再整理：沒有 opacity／blend 欄位', () => {
    const out = JSON.parse(JSON.stringify(omitLayerDefaults(JSON.parse(JSON.stringify(explicit())) as Card))) as Card;
    expect('opacity' in out.front.layers[1]!).toBe(false);
    expect('blend' in out.front.layers[1]!).toBe(false);
  });
});
