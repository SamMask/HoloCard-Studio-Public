// T-803 剪裁遮色片（SCHEMA §1 Layer.clip?）的 model 部分：
// clipParent（下面那層＝往前找第一個 clip 不是 true 的層；底圖、沒有下面、任一方破框 → 不剪裁）、
// clipBlocked（右欄開關為什麼變淡）、驗證（同 breakout：boolean、底圖不能有）、寫出時省略 false、
// 深度規則（打開時 depth＝下面那層、改下面那層的 depth 剪裁層跟著、剪裁層自己的 depth 不能改）、
// 拖曳排序（剪裁層跟著下面那層走；剪裁層本身不能換）、刪掉下面那層（改剪裁到再下面一個；沒有就不剪裁但 clip 保留）、
// 加新層／加文字／取代底圖／換圖不會壞；隨機動作之後剪裁層的 depth 一定等於下面那層。
import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addTextLayer,
  alignClipDepths,
  clipBlocked,
  clipParent,
  clipRunEnd,
  layerClip,
  omitCardDefaults,
  omitLayerDefaults,
  removeLayer,
  replaceBase,
  replaceLayerImage,
  swapDepth,
  updateLayer,
  type LayerPatch,
} from '../../src/model/actions';
import type { Card, FaceSide, Layer, TextSpec } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash, ids } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const TEXT: TextSpec = { content: '星晶龍', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' };

const L = (id: string, depth: number, over: Partial<Layer> = {}): Layer => depthLayer({ id, name: id, depth, image: hash(id.charCodeAt(0)), ...over });
const B = (over: Partial<Layer> = {}): Layer => baseLayer({ id: 'b', image: hash(1), ...over });

/** 正面：底圖 b、龍 a(50)、花紋 c 剪裁到 a、前景 z(70)。 */
function sample(): Card {
  return cardWith([B(), L('a', 50), L('c', 50, { clip: true }), L('z', 70)], [L('d', 50)]);
}

const depths = (layers: readonly Layer[]) => layers.map((l) => l.depth);
const parentId = (card: Card, face: FaceSide, id: string): string | null => {
  const layers = card[face].layers;
  const p = clipParent(card[face], layers.findIndex((l) => l.id === id));
  return p === null ? null : layers[p]!.id;
};

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]);
}

describe('alignClipDepths：讀卡時把剪裁層的 depth 對齊下面那層（T-803b：資料庫與匯入，不擋檔）', () => {
  it('不一樣的改過來、陣列照 depth 排好、誰剪裁到誰不變；兩面都看', () => {
    const card = cardWith([B(), L('a', 50), L('c', 57, { clip: true }), L('z', 70)], [L('d', 40), L('e', 45, { clip: true })]);
    const out = alignClipDepths(card);
    expect(depths(out.front.layers)).toEqual([0, 50, 50, 70]);
    expect(out.front.layers.map((l) => l.id)).toEqual(['b', 'a', 'c', 'z']);
    expect(parentId(out, 'front', 'c')).toBe('a');
    expect(depths(out.back.layers)).toEqual([40, 40]);
    expect(validateCard(out, anyImage)).toEqual([]);
  });

  it('本來就對齊、或沒有剪裁中的層 → 回傳同一個物件（不改、不觸發存檔）', () => {
    const ok = sample();
    expect(alignClipDepths(ok)).toBe(ok);
    const blocked = cardWith([B(), L('c', 57, { clip: true })], []);
    expect(alignClipDepths(blocked)).toBe(blocked);
  });
});

describe('中間夾一層「剪裁但衝出卡片」的層（T-803 審查補的固定案例）', () => {
  /** a(50)、c(50, 剪裁＋衝出卡片：不成立)、d(50, 剪裁到 a)、z(70)。 */
  const mixed = () => cardWith([B(), L('a', 50), L('c', 50, { clip: true, breakout: true }), L('d', 50, { clip: true }), L('z', 70)], []);

  it('d 跳過 c 剪裁到 a；c 不剪裁', () => {
    const card = mixed();
    expect(parentId(card, 'front', 'd')).toBe('a');
    expect(parentId(card, 'front', 'c')).toBeNull();
    expect(clipRunEnd(card.front.layers, 1)).toBe(4);
  });

  it('a 和 z 交換：c、d 跟著 a 一起走，d 還是剪裁到 a，depth 都對齊', () => {
    const out = swapDepth(mixed(), 'front', 'a', 'z');
    const ids = out.front.layers.map((l) => l.id);
    expect(ids.indexOf('c')).toBe(ids.indexOf('a') + 1);
    expect(ids.indexOf('d')).toBe(ids.indexOf('a') + 2);
    expect(parentId(out, 'front', 'd')).toBe('a');
    const depthOf = (id: string) => out.front.layers.find((l) => l.id === id)!.depth;
    expect(depthOf('d')).toBe(depthOf('a'));
    expect(validateCard(out, anyImage)).toEqual([]);
  });
});

describe('clipParent：下面那層（陣列裡往前找第一個 clip 不是 true 的層）', () => {
  it('剪裁層 → 下面那層的 index；不是剪裁層、底圖、超出範圍 → null', () => {
    const face = sample().front;
    expect(clipParent(face, 2)).toBe(1);
    expect(clipParent(face, 1)).toBeNull();
    expect(clipParent(face, 0)).toBeNull();
    expect(clipParent(face, 3)).toBeNull();
    expect(clipParent(face, -1)).toBeNull();
    expect(clipParent(face, 9)).toBeNull();
  });

  it('好幾層可以剪裁到同一層（跳過中間的剪裁層）', () => {
    const face = { layers: [B(), L('a', 50), L('c', 50, { clip: true }), L('e', 50, { clip: true })] };
    expect(clipParent(face, 2)).toBe(1);
    expect(clipParent(face, 3)).toBe(1);
  });

  it('下面是底圖、下面沒有層 → 不剪裁', () => {
    expect(clipParent({ layers: [B(), L('c', 50, { clip: true })] }, 1)).toBeNull();
    expect(clipParent({ layers: [L('c', 50, { clip: true })] }, 0)).toBeNull();
    expect(clipParent({ layers: [L('c', 50, { clip: true }), L('e', 50, { clip: true })] }, 1)).toBeNull();
    expect(clipParent({ layers: [B(), L('c', 50, { clip: true }), L('e', 50, { clip: true })] }, 2)).toBeNull();
  });

  it('任一方是破框層 → 不剪裁', () => {
    expect(clipParent({ layers: [B(), L('a', 50), L('c', 50, { clip: true, breakout: true })] }, 2)).toBeNull();
    expect(clipParent({ layers: [B(), L('a', 50, { breakout: true }), L('c', 50, { clip: true })] }, 2)).toBeNull();
  });

  it('文字層可以當剪裁層、也可以當下面那層；下面那層隱藏或不透明度 0 照樣剪裁', () => {
    expect(clipParent({ layers: [B(), L('t', 50, { text: TEXT }), L('c', 50, { clip: true })] }, 2)).toBe(1);
    expect(clipParent({ layers: [B(), L('a', 50), L('t', 50, { text: TEXT, clip: true })] }, 2)).toBe(1);
    expect(clipParent({ layers: [B(), L('a', 50, { visible: false, opacity: 0 }), L('c', 50, { clip: true })] }, 2)).toBe(1);
  });

  it('clip 明寫 false＝不是剪裁層', () => {
    expect(clipParent({ layers: [B(), L('a', 50), L('c', 50, { clip: false })] }, 2)).toBeNull();
  });
});

describe('clipBlocked：如果打開，為什麼不能剪裁（右欄開關變淡的原因）', () => {
  it('下面有一般的圖層 → null（可以）；開著的剪裁層也一樣', () => {
    expect(clipBlocked({ layers: [B(), L('a', 50), L('x', 70)] }, 2)).toBeNull();
    expect(clipBlocked(sample().front, 2)).toBeNull();
  });

  it('下面是底圖、這層在最下面、底圖自己 → no-layer', () => {
    expect(clipBlocked({ layers: [B(), L('x', 70)] }, 1)).toBe('no-layer');
    expect(clipBlocked({ layers: [L('x', 70)] }, 0)).toBe('no-layer');
    expect(clipBlocked({ layers: [B(), L('x', 70)] }, 0)).toBe('no-layer');
  });

  it('任一方衝出卡片 → breakout', () => {
    expect(clipBlocked({ layers: [B(), L('a', 50), L('x', 70, { breakout: true })] }, 2)).toBe('breakout');
    expect(clipBlocked({ layers: [B(), L('a', 50, { breakout: true }), L('x', 70)] }, 2)).toBe('breakout');
  });
});

describe('validateCard：clip（SCHEMA §1.1，照 breakout 的做法）', () => {
  it('舊卡（沒有 clip 欄位）照樣合格', () => {
    const c = cardWith([B(), L('a', 50), L('z', 70)]);
    for (const l of c.front.layers) expect('clip' in l).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each([true, false])('立體層、文字層 clip %s 合格', (v) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[2].clip = v;
    c.front.layers[3].clip = v;
    c.front.layers[3].text = TEXT;
    c.back.layers[0].clip = v;
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it.each(['true', 1, 0, null, {}, [], undefined])('clip 不是 boolean（%s）只錯在 clip', (v) => {
    const c: Raw = structuredClone(sample());
    c.front.layers[2].clip = v;
    expect(paths(c)).toEqual(['front.layers[2].clip']);
  });

  it('底圖不能有 clip（連 false 也不行）', () => {
    for (const v of [true, false]) {
      const c: Raw = structuredClone(sample());
      c.front.layers[0].clip = v;
      expect(paths(c)).toEqual(['front.layers[0].clip']);
    }
  });

  it('JSON 來回（存檔、卡片檔的格式）仍合格、欄位不變', () => {
    const back = JSON.parse(JSON.stringify(sample()));
    expect(validateCard(back, anyImage)).toEqual([]);
    expect(back.front.layers[2].clip).toBe(true);
  });
});

describe('layerClip／omitLayerDefaults', () => {
  it('省略＝false；只有 true 才算', () => {
    expect(layerClip(depthLayer())).toBe(false);
    expect(layerClip(depthLayer({ clip: false }))).toBe(false);
    expect(layerClip(depthLayer({ clip: true }))).toBe(true);
  });

  it('明寫的 clip: false 寫出時省略；true 留著；其他欄位不動', () => {
    const r: Raw = structuredClone(sample());
    r.front.layers[1].clip = false;
    r.back.layers[0].clip = false;
    const input = deepFreeze(r) as Card;
    const out = omitLayerDefaults(input);
    expect('clip' in out.front.layers[1]!).toBe(false);
    expect(out.front.layers[1]).toEqual(sample().front.layers[1]);
    expect(out.front.layers[2]).toMatchObject({ id: 'c', clip: true });
    expect('clip' in out.back.layers[0]!).toBe(false);
    expect(omitCardDefaults(input).front.layers[1]).toEqual(sample().front.layers[1]);
  });

  it('只有 clip: true → 回原卡（同一個物件）', () => {
    const card = deepFreeze(sample());
    expect(omitLayerDefaults(card)).toBe(card);
  });
});

describe('updateLayer：打開／關掉剪裁', () => {
  it('打開：depth 設成下面那層的、陣列位置在下面那層（和它已有的剪裁層）後面', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('c', 50, { clip: true }), L('x', 80), L('z', 90)]));
    const next = updateLayer(card, 'front', 'x', { clip: true });
    expect(ids(next.front.layers)).toEqual(['b', 'a', 'c', 'x', 'z']);
    expect(depths(next.front.layers)).toEqual([0, 50, 50, 50, 90]);
    expect(next.front.layers[3]).toMatchObject({ id: 'x', clip: true });
    expect(parentId(next, 'front', 'x')).toBe('a');
    expect(validateCard(next, anyImage)).toEqual([]);
    expect(next.back).toBe(card.back);
  });

  it('打開的層自己有剪裁層：它們一起改剪裁到新的下面那層、depth 一起跟著', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('x', 70), L('k', 70, { clip: true }), L('z', 90)]));
    const next = updateLayer(card, 'front', 'x', { clip: true });
    expect(ids(next.front.layers)).toEqual(['b', 'a', 'x', 'k', 'z']);
    expect(depths(next.front.layers)).toEqual([0, 50, 50, 50, 90]);
    expect(parentId(next, 'front', 'x')).toBe('a');
    expect(parentId(next, 'front', 'k')).toBe('a');
  });

  it('下面是底圖、這層在最下面、任一方衝出卡片 → 不能打開（回原卡）', () => {
    const above = deepFreeze(cardWith([B(), L('x', 70)]));
    expect(updateLayer(above, 'front', 'x', { clip: true })).toBe(above);
    const bottom = deepFreeze(cardWith([L('x', 70), L('z', 80)]));
    expect(updateLayer(bottom, 'front', 'x', { clip: true })).toBe(bottom);
    const own = deepFreeze(cardWith([B(), L('a', 50), L('x', 70, { breakout: true })]));
    expect(updateLayer(own, 'front', 'x', { clip: true })).toBe(own);
    const below = deepFreeze(cardWith([B(), L('a', 50, { breakout: true }), L('x', 70)]));
    expect(updateLayer(below, 'front', 'x', { clip: true })).toBe(below);
  });

  it('關掉：欄位拿掉、depth 留在原處（不跳回去）；後面的剪裁層改剪裁到它', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('x', 50, { clip: true }), L('k', 50, { clip: true })]));
    const next = updateLayer(card, 'front', 'x', { clip: false });
    expect('clip' in next.front.layers[2]!).toBe(false);
    expect(depths(next.front.layers)).toEqual([0, 50, 50, 50]);
    expect(parentId(next, 'front', 'k')).toBe('x');
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('和現在一樣 → 回原卡；不是 boolean → 忽略；底圖不能開', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'c', { clip: true })).toBe(card);
    expect(updateLayer(card, 'front', 'a', { clip: false })).toBe(card);
    for (const v of ['true', 1, null] as never[]) expect(updateLayer(card, 'front', 'z', { clip: v })).toBe(card);
    expect(updateLayer(card, 'front', 'b', { clip: true })).toBe(card);
  });

  it('文字層也能打開', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('t', 80, { text: TEXT })]));
    const next = updateLayer(card, 'front', 't', { clip: true });
    expect(next.front.layers[2]).toMatchObject({ id: 't', clip: true, depth: 50 });
  });

  it('同時打開剪裁和改 depth：depth 照下面那層，不照 patch', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('x', 70)]));
    const next = updateLayer(card, 'front', 'x', { clip: true, depth: 99 });
    expect(depths(next.front.layers)).toEqual([0, 50, 50]);
  });
});

describe('深度規則：剪裁層的 depth 一律等於下面那層', () => {
  it('剪裁層自己改 depth → 不改（其他欄位照改）', () => {
    const card = deepFreeze(sample());
    expect(updateLayer(card, 'front', 'c', { depth: 90 })).toBe(card);
    const moved = updateLayer(card, 'front', 'c', { depth: 90, x: 0.3, scale: 1.5 });
    expect(moved.front.layers[2]).toMatchObject({ id: 'c', depth: 50, x: 0.3, scale: 1.5 });
  });

  it('改下面那層的 depth（往前）：剪裁層一起改、一起排序，相對順序不變', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('c', 50, { clip: true }), L('e', 50, { clip: true }), L('z', 70)]));
    const next = updateLayer(card, 'front', 'a', { depth: 90 });
    expect(ids(next.front.layers)).toEqual(['b', 'z', 'a', 'c', 'e']);
    expect(depths(next.front.layers)).toEqual([0, 70, 90, 90, 90]);
    expect(parentId(next, 'front', 'c')).toBe('a');
    expect(parentId(next, 'front', 'e')).toBe('a');
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('改下面那層的 depth（往後、和別層同 depth）：剪裁層緊跟著、不被拆開', () => {
    const card = deepFreeze(cardWith([B(), L('q', 30), L('a', 50), L('c', 50, { clip: true }), L('z', 70)]));
    const back = updateLayer(card, 'front', 'a', { depth: 10 });
    expect(ids(back.front.layers)).toEqual(['b', 'a', 'c', 'q', 'z']);
    expect(depths(back.front.layers)).toEqual([0, 10, 10, 30, 70]);
    const tie = updateLayer(card, 'front', 'a', { depth: 30 });
    expect(ids(tie.front.layers)).toEqual(['b', 'q', 'a', 'c', 'z']);
    expect(parentId(tie, 'front', 'c')).toBe('a');
    const tieFront = updateLayer(card, 'front', 'a', { depth: 70 });
    expect(ids(tieFront.front.layers)).toEqual(['b', 'q', 'a', 'c', 'z']);
    expect(depths(tieFront.front.layers)).toEqual([0, 30, 70, 70, 70]);
    expect(parentId(tieFront, 'front', 'c')).toBe('a');
  });

  it('沒有剪裁層的卡：改 depth 和以前一樣（只排序、別層物件不動）', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('x', 70), L('z', 90)]));
    const next = updateLayer(card, 'front', 'a', { depth: 80 });
    expect(ids(next.front.layers)).toEqual(['b', 'x', 'a', 'z']);
    expect(next.front.layers[1]).toBe(card.front.layers[2]);
    expect(next.front.layers[3]).toBe(card.front.layers[3]);
  });
});

describe('swapDepth：拖曳排序時剪裁層跟著下面那層走', () => {
  it('換的是有剪裁層的層：剪裁層跟著走、depth 一起換', () => {
    const card = deepFreeze(sample()); // b a50 c(clip)50 z70
    const next = swapDepth(card, 'front', 'a', 'z');
    expect(ids(next.front.layers)).toEqual(['b', 'z', 'a', 'c']);
    expect(depths(next.front.layers)).toEqual([0, 50, 70, 70]);
    expect(parentId(next, 'front', 'c')).toBe('a');
    expect(validateCard(next, anyImage)).toEqual([]);
    expect(swapDepth(card, 'front', 'z', 'a')).toEqual(next);
  });

  it('兩邊都有剪裁層：兩組整組交換，中間的層不動', () => {
    const card = deepFreeze(
      cardWith([B(), L('a', 30), L('c', 30, { clip: true }), L('m', 50), L('z', 70), L('k', 70, { clip: true }), L('n', 70, { clip: true })]),
    );
    const next = swapDepth(card, 'front', 'a', 'z');
    expect(ids(next.front.layers)).toEqual(['b', 'z', 'k', 'n', 'm', 'a', 'c']);
    expect(depths(next.front.layers)).toEqual([0, 30, 30, 30, 50, 70, 70]);
    expect(next.front.layers[4]).toBe(card.front.layers[3]);
    expect(parentId(next, 'front', 'k')).toBe('z');
    expect(parentId(next, 'front', 'n')).toBe('z');
    expect(parentId(next, 'front', 'c')).toBe('a');
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('剪裁層本身不能被拖去換：任一邊是剪裁層 → 原樣回傳', () => {
    const card = deepFreeze(sample());
    expect(swapDepth(card, 'front', 'c', 'z')).toBe(card);
    expect(swapDepth(card, 'front', 'z', 'c')).toBe(card);
    expect(swapDepth(card, 'front', 'c', 'a')).toBe(card);
  });

  it('沒有剪裁層的卡：和以前一樣（只換兩層）', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('x', 50), L('c', 70)]));
    const next = swapDepth(card, 'front', 'a', 'c');
    expect(ids(next.front.layers)).toEqual(['b', 'c', 'x', 'a']);
    expect(next.front.layers[2]).toBe(card.front.layers[2]);
  });
});

describe('removeLayer：刪掉下面那層', () => {
  it('剪裁層改剪裁到再下面一個，depth 跟著新的下面那層', () => {
    const card = deepFreeze(cardWith([B(), L('q', 30), L('a', 50), L('c', 50, { clip: true }), L('z', 70)]));
    const next = removeLayer(card, 'front', 'a');
    expect(ids(next.front.layers)).toEqual(['b', 'q', 'c', 'z']);
    expect(depths(next.front.layers)).toEqual([0, 30, 30, 70]);
    expect(parentId(next, 'front', 'c')).toBe('q');
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('再下面是底圖或沒有 → 不剪裁，但 clip 欄位保留、depth 不動', () => {
    const card = deepFreeze(sample());
    const next = removeLayer(card, 'front', 'a');
    expect(ids(next.front.layers)).toEqual(['b', 'c', 'z']);
    expect(next.front.layers[1]).toMatchObject({ id: 'c', clip: true, depth: 50 });
    expect(parentId(next, 'front', 'c')).toBeNull();
    expect(validateCard(next, anyImage)).toEqual([]);
    const noBase = deepFreeze(cardWith([L('a', 50), L('c', 50, { clip: true })]));
    const alone = removeLayer(noBase, 'front', 'a');
    expect(alone.front.layers[0]).toMatchObject({ id: 'c', clip: true, depth: 50 });
  });

  it('刪掉剪裁層本身：別層不動', () => {
    const card = deepFreeze(sample());
    const next = removeLayer(card, 'front', 'c');
    expect(ids(next.front.layers)).toEqual(['b', 'a', 'z']);
    expect(next.front.layers[1]).toBe(card.front.layers[1]);
  });
});

describe('現有動作不會壞掉', () => {
  const input = (id: string, hasAlpha = true) => ({ id, name: id, image: hash(200 + id.length), hasAlpha, width: 800, height: 1000 });

  it('加新層：放最前面、不會變成剪裁層，原本的剪裁不變', () => {
    const card = deepFreeze(sample());
    const r = addLayer(card, 'front', input('new'));
    if (!r.ok) throw new Error(r.reason);
    expect(ids(r.card.front.layers)).toEqual(['b', 'a', 'c', 'z', 'new']);
    expect(parentId(r.card, 'front', 'c')).toBe('a');
    expect(parentId(r.card, 'front', 'new')).toBeNull();
    expect(validateCard(r.card, anyImage)).toEqual([]);
  });

  it('加新層到最上面是剪裁層的面：新層不會被當成剪裁層', () => {
    const card = deepFreeze(cardWith([B(), L('a', 50), L('c', 50, { clip: true })]));
    const r = addLayer(card, 'front', input('new'));
    if (!r.ok) throw new Error(r.reason);
    expect(r.card.front.layers.at(-1)).toMatchObject({ id: 'new', depth: 70 });
    expect('clip' in r.card.front.layers.at(-1)!).toBe(false);
    expect(parentId(r.card, 'front', 'c')).toBe('a');
  });

  it('加文字層：一樣放最前面，原本的剪裁不變', () => {
    const card = deepFreeze(sample());
    const r = addTextLayer(card, 'front', { id: 'txt', image: hash(300), text: TEXT, width: 800, height: 200 });
    if (!r.ok) throw new Error(r.reason);
    expect(parentId(r.card, 'front', 'c')).toBe('a');
    expect(validateCard(r.card, anyImage)).toEqual([]);
  });

  it('取代底圖：剪裁不變；底圖上面的剪裁層照舊不剪裁', () => {
    const card = deepFreeze(sample());
    const next = replaceBase(card, 'front', input('nb', false));
    expect(ids(next.front.layers)).toEqual(['nb', 'a', 'c', 'z']);
    expect(parentId(next, 'front', 'c')).toBe('a');
    expect(validateCard(next, anyImage)).toEqual([]);
    const loose = deepFreeze(cardWith([B(), L('c', 50, { clip: true })]));
    const replaced = replaceBase(loose, 'front', input('nb', false));
    expect(parentId(replaced, 'front', 'c')).toBeNull();
    expect(replaced.front.layers[1]).toMatchObject({ id: 'c', clip: true, depth: 50 });
  });

  it('換圖（自動去背）：clip 跟著自己的圖層', () => {
    const next = replaceLayerImage(sample(), 'front', 'c', { image: hash(77), hasAlpha: true });
    expect(next.front.layers[2]).toMatchObject({ id: 'c', image: hash(77), clip: true });
  });
});

// ---- 性質：隨機動作之後，卡片一定合格、剪裁層的 depth 一定等於下面那層 ----

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectClipInvariant(card: Card, where: string): void {
  for (const face of ['front', 'back'] as const) {
    const layers = card[face].layers;
    for (let i = 1; i < layers.length; i++) expect(layers[i]!.depth, `${where}：${face} 沒有依 depth 排好`).toBeGreaterThanOrEqual(layers[i - 1]!.depth);
    layers.forEach((l, i) => {
      const p = clipParent(card[face], i);
      if (p !== null) expect(l.depth, `${where}：${face} 的剪裁層 ${l.id} depth 和下面那層不同`).toBe(layers[p]!.depth);
      if (l.role === 'base') expect('clip' in l, `${where}：底圖有 clip`).toBe(false);
    });
  }
}

describe('性質：隨機的開關剪裁、破框、改 depth、拖曳、刪除、加層', () => {
  it.each([1, 7, 2026, 803])('種子 %i：400 步，每一步都合格、剪裁層 depth＝下面那層、不改輸入', (seed) => {
    const rng = makeRng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
    let card = deepFreeze(cardWith([B(), L('a', 40), L('c', 40, { clip: true }), L('z', 70)], [L('d', 50)]));
    let n = 0;
    let clipped = 0;
    for (let i = 0; i < 400; i++) {
      const face = pick(['front', 'front', 'back'] as const);
      const layers = card[face].layers;
      const some = () => (layers.length > 0 ? pick(layers).id : 'none');
      const roll = rng();
      let next: Card;
      let label: string;
      if (roll < 0.3) {
        const patch: LayerPatch = { clip: rng() < 0.7 };
        if (rng() < 0.2) patch.breakout = rng() < 0.3;
        next = updateLayer(card, face, some(), patch);
        label = `updateLayer ${JSON.stringify(patch)}`;
      } else if (roll < 0.5) {
        const patch: LayerPatch = { depth: Math.round(rng() * 110) - 5 };
        next = updateLayer(card, face, some(), patch);
        label = `updateLayer ${JSON.stringify(patch)}`;
      } else if (roll < 0.7) {
        next = swapDepth(card, face, some(), some());
        label = 'swapDepth';
      } else if (roll < 0.8 && layers.length > 2) {
        next = removeLayer(card, face, some());
        label = 'removeLayer';
      } else if (roll < 0.9) {
        const r = addLayer(card, face, { id: `n${n++}`, name: 'n', image: hash(500 + (n % 6)), hasAlpha: true, width: 500, height: 500 });
        next = r.ok ? r.card : card;
        label = 'addLayer';
      } else {
        next = updateLayer(card, face, some(), { breakout: rng() < 0.4 });
        label = 'breakout';
      }
      const where = `種子 ${seed} 第 ${i} 步 ${label}`;
      expect(validateCard(next, anyImage), where).toEqual([]);
      expectClipInvariant(next, where);
      if ([...next.front.layers.keys()].some((k) => clipParent(next.front, k) !== null)) clipped++;
      card = deepFreeze(next);
    }
    // 測試沒有退化：真的常常有剪裁中的層
    expect(clipped).toBeGreaterThan(40);
  });
});
