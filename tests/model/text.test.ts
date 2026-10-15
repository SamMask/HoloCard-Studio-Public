// 文字圖層（SCHEMA §1「文字圖層」）：驗證規則、addTextLayer／updateTextLayer、其他動作保留 text 欄位。
import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addTextLayer,
  centerLayer,
  cleanTextSpec,
  DEFAULT_TEXT,
  fillLayer,
  mergeTextSpec,
  removeLayer,
  replaceBase,
  swapDepth,
  textLayerName,
  updateCard,
  updateLayer,
  updateTextLayer,
  type NewTextLayerInput,
  type TextLayerUpdate,
} from '../../src/model/actions';
import { TEXT_ALIGNS, TEXT_FONTS, TEXT_STYLES } from '../../src/model/limits';
import { MAX_LAYERS_PER_FACE, type Card, type Layer, type TextSpec } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function spec(over: Partial<TextSpec> = {}): TextSpec {
  return { ...DEFAULT_TEXT, ...over };
}

function textLayer(over: Partial<Layer> = {}): Layer {
  return depthLayer({ id: 't1', name: '卡片名稱', depth: 60, image: hash(9), y: 0.55, text: spec(), ...over });
}

/** 正面：底圖 b＋立體層 a50＋文字層 t1(60)。 */
function sample(): Card {
  return cardWith([baseLayer({ id: 'b', image: hash(1) }), depthLayer({ id: 'a', depth: 50, image: hash(2) }), textLayer()]);
}

function raw(card: Card = sample()): Raw {
  return structuredClone(card);
}

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]);
}

function expectOnlyAt(value: unknown, path: string): void {
  const p = paths(value);
  expect(p.length).toBeGreaterThan(0);
  expect(p.every((x) => x === path), p.join(' | ')).toBe(true);
}

const T = 'front.layers[2]';

let seq = 0;
function textInput(over: Partial<NewTextLayerInput> = {}): NewTextLayerInput {
  seq += 1;
  return { id: `text-${seq}`, image: hash(500 + seq), text: spec(), width: 2048, height: 330, ...over };
}

/** 故意只給一半（或給多的欄位）的 update：型別已經擋掉，這裡用 cast 繞過，只為了測執行期的最後一道防線。 */
function looseUpdate(u: object): TextLayerUpdate {
  return u as TextLayerUpdate;
}

function addedText(card: Card, input: NewTextLayerInput, face: 'front' | 'back' = 'front'): { card: Card; layer: Layer } {
  const r = addTextLayer(card, face, input);
  if (!r.ok) throw new Error(`addTextLayer 失敗：${r.reason}`);
  const layer = r.card[face].layers.find((l) => l.id === r.layerId)!;
  return { card: r.card, layer };
}

// ---------------- 驗證 ----------------

describe('validateCard：文字圖層合格', () => {
  it('有 text 的立體層合格；沒有 text 的圖層照樣合格（欄位可有可無）', () => {
    expect(validateCard(sample(), anyImage)).toEqual([]);
    expect(validateCard(cardWith([depthLayer()]), anyImage)).toEqual([]);
  });

  it('每種字型、對齊、樣式、直排都合格', () => {
    for (const font of TEXT_FONTS) {
      for (const align of TEXT_ALIGNS) {
        for (const style of TEXT_STYLES) {
          for (const vertical of [true, false]) {
            const c = raw();
            c.front.layers[2].text = spec({ font, align, style, vertical });
            expect(validateCard(c, anyImage)).toEqual([]);
          }
        }
      }
    }
  });

  it('內容剛好 100 字（含換行、表情符號算一個字）合格；大寫顏色合格', () => {
    const c = raw();
    c.front.layers[2].text.content = `${'字'.repeat(49)}\n${'😀'.repeat(50)}`;
    c.front.layers[2].text.color = '#ABCDEF';
    expect(validateCard(c, anyImage)).toEqual([]);
  });
});

describe('validateCard：文字圖層的每個欄位', () => {
  it('內容：空字串、只有空白或換行、超過 100 字、不是文字 → 錯在 text.content', () => {
    for (const bad of ['', '   ', '\n\n', '　', '字'.repeat(101), '😀'.repeat(101), 3, null]) {
      const c = raw();
      c.front.layers[2].text.content = bad;
      expectOnlyAt(c, `${T}.text.content`);
    }
  });

  it('字型不是四選一 → 錯在 text.font', () => {
    for (const bad of ['comic', '', 'Wenkai', 1]) {
      const c = raw();
      c.front.layers[2].text.font = bad;
      expectOnlyAt(c, `${T}.text.font`);
    }
  });

  it('顏色不是 #rrggbb → 錯在 text.color', () => {
    for (const bad of ['#fff', 'red', '', '#12345g', 0xffffff]) {
      const c = raw();
      c.front.layers[2].text.color = bad;
      expectOnlyAt(c, `${T}.text.color`);
    }
  });

  it('對齊、樣式不是三選一、直排不是 true／false → 錯在各自的欄位', () => {
    const a = raw();
    a.front.layers[2].text.align = 'left';
    expectOnlyAt(a, `${T}.text.align`);
    const s = raw();
    s.front.layers[2].text.style = 'stamp';
    expectOnlyAt(s, `${T}.text.style`);
    const v = raw();
    v.front.layers[2].text.vertical = 'yes';
    expectOnlyAt(v, `${T}.text.vertical`);
  });

  it('text 裡不認得的欄位報錯；缺欄位報錯', () => {
    const extra = raw();
    extra.front.layers[2].text.size = 2;
    expectOnlyAt(extra, `${T}.text.size`);
    expect(validateCard(extra, anyImage)[0]).toContain('不認得的欄位');

    const missing = raw();
    delete missing.front.layers[2].text.style;
    expectOnlyAt(missing, `${T}.text.style`);
    expect(validateCard(missing, anyImage)[0]).toContain('缺少欄位');
  });

  it('text 不是物件 → 錯在 text', () => {
    for (const bad of ['卡片名稱', null, [], 1]) {
      const c = raw();
      c.front.layers[2].text = bad;
      expectOnlyAt(c, `${T}.text`);
    }
  });
});

describe('validateCard：有 text 時 role 必須是 depth、hasAlpha 必須是 true', () => {
  it('底圖（role base、有透明）帶 text → 錯在 role', () => {
    const c = raw(cardWith([baseLayer({ hasAlpha: true, text: spec() })]));
    expectOnlyAt(c, 'front.layers[0].role');
  });

  it('底圖（沒有透明）帶 text → role 與 hasAlpha 各一條', () => {
    const c = raw(cardWith([baseLayer({ text: spec() })]));
    expect(paths(c).sort()).toEqual(['front.layers[0].hasAlpha', 'front.layers[0].role']);
  });

  it('立體層帶 text 但 hasAlpha false → 只錯在 hasAlpha 一條', () => {
    const c = raw();
    c.front.layers[2].hasAlpha = false;
    expect(paths(c)).toEqual([`${T}.hasAlpha`]);
  });
});

// ---------------- 文字設定的整理 ----------------

describe('DEFAULT_TEXT 與 cleanTextSpec／mergeTextSpec', () => {
  it('新文字圖層的預設照 SCHEMA', () => {
    expect(DEFAULT_TEXT).toEqual({ content: '卡片名稱', font: 'wenkai', color: '#ffffff', align: 'center', vertical: false, style: 'outline' });
  });

  it('cleanTextSpec：合格的回新物件、只留六個欄位、顏色轉小寫、內容超過 100 字截到 100 字', () => {
    const input = { ...spec({ color: '#ABCDEF', content: '字'.repeat(120) }), size: 3 } as unknown;
    const out = cleanTextSpec(input)!;
    expect(Object.keys(out).sort()).toEqual(['align', 'color', 'content', 'font', 'style', 'vertical']);
    expect(out.color).toBe('#abcdef');
    expect(Array.from(out.content)).toHaveLength(100);
    expect(cleanTextSpec({ ...spec(), content: '😀'.repeat(101) })!.content).toBe('😀'.repeat(100));
  });

  it('cleanTextSpec：不合格的一律回 null', () => {
    for (const bad of [null, undefined, '卡片', 1, [], {}]) expect(cleanTextSpec(bad)).toBeNull();
    const fields: [keyof TextSpec, unknown][] = [
      ['content', ''],
      ['content', '  \n '],
      ['content', 5],
      ['font', 'comic'],
      ['color', 'red'],
      ['color', '#fff'],
      ['align', 'left'],
      ['vertical', 'yes'],
      ['vertical', 1],
      ['style', 'stamp'],
    ];
    for (const [k, v] of fields) expect(cleanTextSpec({ ...spec(), [k]: v }), `${k}=${String(v)}`).toBeNull();
  });

  it('mergeTextSpec：只改給的欄位；undefined 不算；任何一個不合格就回 null（不改）', () => {
    const base = spec();
    expect(mergeTextSpec(base, { font: 'huninn' })).toEqual({ ...base, font: 'huninn' });
    expect(mergeTextSpec(base, { font: undefined, vertical: true })).toEqual({ ...base, vertical: true });
    expect(mergeTextSpec(base, { font: 'huninn', color: 'blue' })).toBeNull();
    expect(mergeTextSpec(base, { content: '   ' })).toBeNull();
    expect(mergeTextSpec(base, { style: 'x' as never })).toBeNull();
  });

  it('textLayerName：內容前 20 字；換行和連續空白變成一個空格；去頭尾空白', () => {
    expect(textLayerName('卡片名稱')).toBe('卡片名稱');
    expect(textLayerName('  第一行\n\n第二行  ')).toBe('第一行 第二行');
    expect(textLayerName('字'.repeat(30))).toBe('字'.repeat(20));
    expect(textLayerName('😀'.repeat(30))).toBe('😀'.repeat(20));
    expect(textLayerName('一二三四五六七八九十一二三四五六七八九 尾巴')).toBe('一二三四五六七八九十一二三四五六七八九');
  });
});

// ---------------- addTextLayer ----------------

describe('addTextLayer：預設擺法與自動深度', () => {
  it('空的一面：立體層、有透明、會反光、x 0／y 0.55／scale 1、depth 50、名字＝內容前 20 字', () => {
    const card = deepFreeze(cardWith([]));
    const inp = textInput({ text: spec({ content: '閃耀之星\n第二行' }) });
    const { card: next, layer } = addedText(card, inp);
    expect(layer).toEqual({
      id: inp.id,
      name: '閃耀之星 第二行',
      role: 'depth',
      image: inp.image,
      visible: true,
      depth: 50,
      x: 0,
      y: 0.55,
      scale: 1,
      holo: true,
      hasAlpha: true,
      text: spec({ content: '閃耀之星\n第二行' }),
    });
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('深度照立體層的自動規則：目前最大＋20、上限 100；放最後＝最前面', () => {
    const one = addedText(sample(), textInput()).card;
    expect(one.front.layers.map((l) => l.depth)).toEqual([0, 50, 60, 80]);
    const high = addedText(cardWith([depthLayer({ depth: 95 })]), textInput()).card;
    expect(high.front.layers.map((l) => l.depth)).toEqual([95, 100]);
  });

  it('加到背面不影響正面；顏色存成小寫、內容超過 100 字截到 100 字', () => {
    const card = sample();
    const r = addedText(card, textInput({ text: spec({ color: '#C8322B', content: '字'.repeat(130) }) }), 'back');
    expect(r.card.front).toBe(card.front);
    expect(r.card.back.layers).toHaveLength(1);
    expect(r.layer.text!.color).toBe('#c8322b');
    expect(Array.from(r.layer.text!.content)).toHaveLength(100);
    expect(validateCard(r.card, anyImage)).toEqual([]);
  });

  it('每面已有 8 層 → face-full', () => {
    const layers = Array.from({ length: MAX_LAYERS_PER_FACE }, (_, i) => depthLayer({ id: `d${i}`, depth: 10 + i, image: hash(i + 1) }));
    expect(addTextLayer(cardWith(layers), 'front', textInput())).toEqual({ ok: false, reason: 'face-full' });
  });

  it('輸入不合格 → invalid-input（id 重複／空、雜湊不對、文字設定不合格、尺寸不合理）', () => {
    const card = sample();
    const bads: Partial<NewTextLayerInput>[] = [
      { id: 'a' },
      { id: '' },
      { id: 'x'.repeat(101) },
      { image: 'ABCDEF0123456789' },
      { image: '' },
      { text: spec({ content: '  ' }) },
      { text: spec({ font: 'comic' as never }) },
      { text: spec({ color: 'red' }) },
      { text: null as never },
      { width: 0 },
      { height: Number.NaN },
      { width: Infinity },
    ];
    for (const over of bads) {
      expect(addTextLayer(card, 'front', textInput(over)), JSON.stringify(over)).toEqual({ ok: false, reason: 'invalid-input' });
    }
  });

  it('id 以 Unicode 字元計：100 個表情符號（200 個 UTF-16 單位）合格、101 個 → invalid-input', () => {
    const card = cardWith([]);
    const ok = '😀'.repeat(100);
    expect(ok.length).toBe(200);
    const r = addTextLayer(card, 'front', textInput({ id: ok }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layerId).toBe(ok);
      expect(validateCard(r.card, anyImage)).toEqual([]);
    }
    const tooLong = textInput({ id: '😀'.repeat(101) });
    expect(addTextLayer(card, 'front', tooLong)).toEqual({ ok: false, reason: 'invalid-input' });
    expect(addTextLayer(card, 'back', tooLong)).toEqual({ ok: false, reason: 'invalid-input' });
  });

  it('輸入的 text 有多的欄位：存進去的只有六個欄位（不會寫出驗證不過的卡）', () => {
    const inp = textInput({ text: { ...spec(), extra: 1 } as TextSpec });
    const { card, layer } = addedText(cardWith([]), inp);
    expect(Object.keys(layer.text!)).toHaveLength(6);
    expect(validateCard(card, anyImage)).toEqual([]);
  });
});

// ---------------- updateTextLayer ----------------

describe('updateTextLayer：換新圖與文字設定（圖和設定一起給）', () => {
  it('改內容＋新圖：text、image、名字跟著換；位置、大小、深度、顯示、反光不變', () => {
    const card = deepFreeze(sample());
    const next = updateTextLayer(card, 'front', 't1', { text: spec({ content: '月夜' }), image: hash(77) });
    const layer = next.front.layers[2]!;
    expect(layer).toEqual({ ...textLayer(), name: '月夜', image: hash(77), text: spec({ content: '月夜' }) });
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('使用者自己改過名字 → 改內容時名字不動', () => {
    const card = cardWith([textLayer({ name: '我的標題' })]);
    const next = updateTextLayer(card, 'front', 't1', { text: spec({ content: '月夜' }), image: hash(77) });
    expect(next.front.layers[0]!.name).toBe('我的標題');
    expect(next.front.layers[0]!.text!.content).toBe('月夜');
  });

  it('只改一個設定（字型）：給完整的新設定，其他設定照給的存', () => {
    const next = updateTextLayer(sample(), 'front', 't1', { text: spec({ font: 'iansui' }), image: hash(78) });
    expect(next.front.layers[2]!.text).toEqual(spec({ font: 'iansui' }));
    expect(next.front.layers[2]!.name).toBe('卡片名稱');
  });

  it('任何一個設定不合格 → 整個不改（回原卡）', () => {
    const card = sample();
    const bads: Partial<TextSpec>[] = [
      { content: '' },
      { content: ' \n ' },
      { font: 'comic' as never },
      { color: 'blue' },
      { color: '#fff' },
      { align: 'left' as never },
      { style: 'stamp' as never },
      { vertical: 'yes' as never },
      { font: 'huninn', color: 'nope' },
    ];
    for (const over of bads) {
      expect(updateTextLayer(card, 'front', 't1', { text: spec(over), image: hash(79) }), JSON.stringify(over)).toBe(card);
    }
  });

  it('雜湊格式不對 → 不改', () => {
    const card = sample();
    expect(updateTextLayer(card, 'front', 't1', { text: spec({ content: '月' }), image: 'xyz' })).toBe(card);
    expect(updateTextLayer(card, 'front', 't1', { text: spec({ content: '月' }), image: hash(255).toUpperCase() })).toBe(card); // 大寫的十六進位不合格（要小寫）
  });

  it('呼叫端帶著 width／height（例如整包 DrawnText）也沒關係：不檢查、也不會存進圖層', () => {
    const drawn = { text: spec({ content: '月夜' }), image: hash(80), width: 0, height: Number.NaN }; // 變數不是字面值，型別上可以多帶
    const next = updateTextLayer(sample(), 'front', 't1', drawn);
    const layer = next.front.layers[2]!;
    expect(layer.image).toBe(hash(80));
    expect(layer.text).toEqual(spec({ content: '月夜' }));
    expect(Object.keys(layer).sort()).toEqual(Object.keys(textLayer()).sort());
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('不是文字圖層、找不到、沒有任何改變 → 回原卡', () => {
    const card = sample();
    expect(updateTextLayer(card, 'front', 'a', { text: spec({ content: '月' }), image: hash(81) })).toBe(card);
    expect(updateTextLayer(card, 'front', 'b', { text: spec({ content: '月' }), image: hash(81) })).toBe(card);
    expect(updateTextLayer(card, 'front', 'nope', { text: spec({ content: '月' }), image: hash(81) })).toBe(card);
    expect(updateTextLayer(card, 'back', 't1', { text: spec({ content: '月' }), image: hash(81) })).toBe(card);
    expect(updateTextLayer(card, 'front', 't1', { text: spec(), image: hash(9) })).toBe(card);
    expect(updateTextLayer(card, 'front', 't1', looseUpdate({}))).toBe(card);
  });

  it('內容超過 100 字截到 100 字、顏色轉小寫，結果仍通過驗證', () => {
    const next = updateTextLayer(sample(), 'front', 't1', { text: spec({ content: '字'.repeat(150), color: '#ABCDEF' }), image: hash(82) });
    expect(Array.from(next.front.layers[2]!.text!.content)).toHaveLength(100);
    expect(next.front.layers[2]!.text!.color).toBe('#abcdef');
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('多給的欄位不會被寫進 text', () => {
    const next = updateTextLayer(sample(), 'front', 't1', { text: { ...spec({ font: 'huninn' }), size: 3 } as TextSpec, image: hash(83) });
    expect(Object.keys(next.front.layers[2]!.text!)).toHaveLength(6);
    expect(validateCard(next, anyImage)).toEqual([]);
  });
});

describe('updateTextLayer：字和圖一定要一起換（T-311：不能出現「圖照 A 畫、設定存成 B」）', () => {
  const TEXT_KEYS: (keyof TextSpec)[] = ['content', 'font', 'color', 'align', 'vertical', 'style'];

  it('改了設定卻沒給新圖 → 回原卡（內容、字型、顏色、對齊、直排、樣式每一種都一樣）', () => {
    const card = deepFreeze(sample());
    const changes: Partial<TextSpec>[] = [
      { content: '月夜' },
      { font: 'iansui' },
      { color: '#00ff00' },
      { align: 'start' },
      { vertical: true },
      { style: 'seal' },
    ];
    for (const over of changes) {
      expect(updateTextLayer(card, 'front', 't1', looseUpdate({ text: spec(over) })), JSON.stringify(over)).toBe(card);
    }
  });

  it('只給設定的一部分、沒給新圖 → 回原卡', () => {
    const card = deepFreeze(sample());
    expect(updateTextLayer(card, 'front', 't1', looseUpdate({ text: { content: '月夜' } }))).toBe(card);
    expect(updateTextLayer(card, 'front', 't1', looseUpdate({ text: { font: 'iansui' } }))).toBe(card);
  });

  it('只給尺寸、沒給新圖，設定又有改 → 回原卡', () => {
    const card = deepFreeze(sample());
    expect(updateTextLayer(card, 'front', 't1', looseUpdate({ text: spec({ content: '月夜' }), width: 2048, height: 330 }))).toBe(card);
  });

  it('有給新圖，但 text 少了任何一個欄位 → 回原卡（不會把舊設定偷偷補進去）', () => {
    const card = deepFreeze(sample());
    for (const key of TEXT_KEYS) {
      const missing: Record<string, unknown> = { ...spec({ content: '月夜', font: 'iansui' }) };
      delete missing[key];
      expect(updateTextLayer(card, 'front', 't1', { text: missing as unknown as TextSpec, image: hash(84) }), `少了 ${key}`).toBe(card);
    }
  });

  it('有給新圖，但某個欄位寫成 undefined → 回原卡', () => {
    const card = deepFreeze(sample());
    for (const key of TEXT_KEYS) {
      const text = { ...spec({ content: '月夜' }), [key]: undefined } as unknown as TextSpec;
      expect(updateTextLayer(card, 'front', 't1', { text, image: hash(84) }), `${key}: undefined`).toBe(card);
    }
  });

  it('有給新圖，但沒給 text（或給的不是物件）→ 回原卡', () => {
    const card = deepFreeze(sample());
    expect(updateTextLayer(card, 'front', 't1', looseUpdate({ image: hash(84) }))).toBe(card);
    expect(updateTextLayer(card, 'front', 't1', looseUpdate({ image: hash(84), width: 2048, height: 330 }))).toBe(card);
    for (const text of [null, '月夜', 3, []] as unknown[]) {
      expect(updateTextLayer(card, 'front', 't1', { text: text as TextSpec, image: hash(84) }), String(text)).toBe(card);
    }
  });

  it('設定完整、也有給新圖 → 照常改（同一個雜湊也算「有給」：畫出來一樣的圖，雜湊本來就會一樣）', () => {
    const card = deepFreeze(sample());
    const next = updateTextLayer(card, 'front', 't1', { text: spec({ align: 'start' }), image: hash(9) });
    expect(next).not.toBe(card);
    expect(next.front.layers[2]!.text).toEqual(spec({ align: 'start' }));
    expect(next.front.layers[2]!.image).toBe(hash(9));
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('只換圖、設定不變（完整設定＋新雜湊）→ 圖換掉、設定與名字不變', () => {
    const next = updateTextLayer(sample(), 'front', 't1', { text: spec(), image: hash(85) });
    expect(next.front.layers[2]).toEqual({ ...textLayer(), image: hash(85) });
  });
});

describe('updateTextLayer：用清理過的舊設定比較有沒有改（匯入的卡可能有大寫顏色）', () => {
  function imported(): Card {
    return deepFreeze(cardWith([textLayer({ text: spec({ color: '#ABCDEF' }) })]));
  }

  it('舊設定是大寫顏色，新設定一樣（大寫或小寫）、圖也一樣 → 沒改東西，回原卡', () => {
    const card = imported();
    expect(updateTextLayer(card, 'front', 't1', { text: spec({ color: '#ABCDEF' }), image: hash(9) })).toBe(card);
    expect(updateTextLayer(card, 'front', 't1', { text: spec({ color: '#abcdef' }), image: hash(9) })).toBe(card);
  });

  it('舊設定是大寫顏色，改了別的設定 → 有改；存進去的顏色是小寫', () => {
    const card = imported();
    const next = updateTextLayer(card, 'front', 't1', { text: spec({ color: '#ABCDEF', content: '月夜' }), image: hash(86) });
    expect(next).not.toBe(card);
    expect(next.front.layers[0]!.text).toEqual(spec({ color: '#abcdef', content: '月夜' }));
    expect(next.front.layers[0]!.name).toBe('月夜');
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('舊設定是大寫顏色，設定沒變但換了新圖 → 有改（只換圖）', () => {
    const card = imported();
    const next = updateTextLayer(card, 'front', 't1', { text: spec({ color: '#abcdef' }), image: hash(87) });
    expect(next).not.toBe(card);
    expect(next.front.layers[0]!.image).toBe(hash(87));
  });
});

describe('文字圖層的名字：內容前 20 字，換行與連續空白併成一個空格', () => {
  const LONG = `第一行\n\n   第二行${'字'.repeat(30)}`;

  it('addTextLayer：內容超過 20 字、含換行 → 名字＝併好空白後的前 20 字，沒有換行', () => {
    const { layer, card } = addedText(cardWith([]), textInput({ text: spec({ content: LONG }) }));
    expect(layer.name).toBe(`第一行 第二行${'字'.repeat(13)}`);
    expect(Array.from(layer.name)).toHaveLength(20);
    expect(layer.text!.content).toBe(LONG); // 內容本身原樣保留，只有名字被整理
    expect(validateCard(card, anyImage)).toEqual([]);
  });

  it('Windows 換行、Tab、全形空白也算空白；名字不會有頭尾空白', () => {
    expect(textLayerName('a\r\nb\tc')).toBe('a b c');
    expect(textLayerName('\n\n  月夜　星空  \n')).toBe('月夜 星空');
    expect(textLayerName('一二三四五六七八九十一二三四五六七八九\n尾巴')).toBe('一二三四五六七八九十一二三四五六七八九'); // 第 20 個是換行→空格，被修掉
  });

  it('各種內容的名字都 1～20 字、沒有換行、不是空白，而且卡片仍合格', () => {
    const contents = ['月', '\n\n月', LONG, '😀'.repeat(100), `${'\n'.repeat(60)}字${'\n'.repeat(39)}`, '字\n'.repeat(50), '  a  b  c  '];
    for (const content of contents) {
      const { layer, card } = addedText(cardWith([]), textInput({ text: spec({ content }) }));
      const n = Array.from(layer.name).length;
      expect(n, JSON.stringify(content).slice(0, 40)).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(20);
      expect(layer.name).not.toMatch(/[\r\n\t]/);
      expect(layer.name.trim()).toBe(layer.name);
      expect(validateCard(card, anyImage)).toEqual([]);
    }
  });

  it('名字是自動取的（長內容、含換行）→ 改內容時跟著換；只改字型時不動', () => {
    const { card } = addedText(cardWith([]), textInput({ id: 'long', text: spec({ content: LONG }) }));
    const autoName = `第一行 第二行${'字'.repeat(13)}`;
    expect(card.front.layers[0]!.name).toBe(autoName);

    const font = updateTextLayer(card, 'front', 'long', { text: spec({ content: LONG, font: 'iansui' }), image: hash(88) });
    expect(font.front.layers[0]!.name).toBe(autoName);

    const content = updateTextLayer(card, 'front', 'long', { text: spec({ content: '新的\n標題' }), image: hash(89) });
    expect(content.front.layers[0]!.name).toBe('新的 標題');
  });

  it('使用者改過名字（長內容）→ 改內容時名字不動', () => {
    const { card } = addedText(cardWith([]), textInput({ id: 'long', text: spec({ content: LONG }) }));
    const renamed = updateLayer(card, 'front', 'long', { name: '我取的名字' });
    const next = updateTextLayer(renamed, 'front', 'long', { text: spec({ content: '新的\n標題' }), image: hash(90) });
    expect(next.front.layers[0]!.name).toBe('我取的名字');
  });
});

// ---------------- 其他動作保留 text ----------------

describe('現有動作保留 text 欄位', () => {
  it('updateLayer（位置、大小、深度、名字、顯示）保留 text', () => {
    const card = deepFreeze(sample());
    const next = updateLayer(card, 'front', 't1', { x: 0.3, scale: 1.5, depth: 90, name: '標題', visible: false });
    const layer = next.front.layers.find((l) => l.id === 't1')!;
    expect(layer.text).toEqual(spec());
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('swapDepth 兩邊都保留各自的 text', () => {
    const next = swapDepth(sample(), 'front', 'a', 't1');
    const t = next.front.layers.find((l) => l.id === 't1')!;
    const a = next.front.layers.find((l) => l.id === 'a')!;
    expect(t.text).toEqual(spec());
    expect(t.depth).toBe(50);
    expect(a.text).toBeUndefined();
    expect('text' in a).toBe(false);
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('removeLayer／centerLayer／replaceBase／addLayer 不弄丟文字圖層的 text', () => {
    const base = { id: 'nb', name: '新底圖', image: hash(90), hasAlpha: false, width: 100, height: 100 };
    const card = sample();
    const checks: Card[] = [
      removeLayer(card, 'front', 'a'),
      centerLayer(updateLayer(card, 'front', 't1', { x: 0.4 }), 'front', 't1'),
      replaceBase(card, 'front', base),
    ];
    const added = addLayer(card, 'front', { ...base, id: 'nd', hasAlpha: true });
    if (added.ok) checks.push(added.card);
    for (const c of checks) {
      expect(c.front.layers.find((l) => l.id === 't1')!.text).toEqual(spec());
      expect(validateCard(c, anyImage)).toEqual([]);
    }
  });

  it('fillLayer（填滿）保留 text，只改 x／y／scale', () => {
    const card = deepFreeze(cardWith([textLayer({ x: 0.3, y: 0.2, scale: 0.5 })]));
    const next = fillLayer(card, 'front', 't1', 2048, 330, 0.05);
    const layer = next.front.layers[0]!;
    expect(next).not.toBe(card);
    expect(layer.scale).not.toBe(0.5);
    expect(layer.text).toEqual(spec());
    expect({ ...layer, x: 0.3, y: 0.2, scale: 0.5 }).toEqual(textLayer({ x: 0.3, y: 0.2, scale: 0.5 }));
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('updateCard 換比例：正反兩面文字圖層的 text 與 x／y／scale 都原封不動', () => {
    const back = textLayer({ id: 't2', image: hash(10), text: spec({ content: '背面', vertical: true }), x: -0.2, y: 0.1, scale: 1.2 });
    const card = deepFreeze(cardWith([textLayer(), depthLayer({ id: 'a', depth: 70, image: hash(2) })], [back]));
    const next = updateCard(card, { aspect: 'tarot' });
    expect(next.aspect).toBe('tarot');
    expect(next.front.layers).toEqual(card.front.layers);
    expect(next.back.layers).toEqual([back]);
    expect(next.front.layers[0]!.text).toEqual(spec());
    expect(next.back.layers[0]!.text).toEqual(spec({ content: '背面', vertical: true }));
    expect(validateCard(next, anyImage)).toEqual([]);
  });

  it('updateCard 改別的（名字、鐳射、陰影）也不弄丟 text', () => {
    const card = deepFreeze(sample());
    const next = updateCard(card, { name: '新名字', holo: { strength: 10 }, shadow: { strength: 5 }, frame: { shine: 3 } });
    expect(next.front.layers).toBe(card.front.layers);
    expect(next.front.layers[2]!.text).toEqual(spec());
  });
});

// ---------------- text: undefined ----------------

/** 圖層的 text 欄位要嘛不存在、要嘛是物件：不能是「有這個欄位、值卻是 undefined」。 */
function expectNoUndefinedText(card: Card, label: string): void {
  for (const l of [...card.front.layers, ...card.back.layers]) {
    if (Object.prototype.hasOwnProperty.call(l, 'text')) expect(l.text, `${label}：${l.id} 的 text 是 undefined`).toBeDefined();
  }
}

describe('text: undefined 不能出現（存檔會失敗）', () => {
  it('圖層寫成 text: undefined（有這個欄位、值是 undefined）→ validateCard 報錯在 text；沒有 text 欄位才合格', () => {
    const c = raw();
    c.front.layers[1].text = undefined;
    expectOnlyAt(c, 'front.layers[1].text');
    expect(validateCard(c, anyImage)[0]).toContain('要是物件');

    const ok = raw();
    delete ok.front.layers[1].text;
    expect(validateCard(ok, anyImage)).toEqual([]);
  });

  it('model 的每個動作，結果裡的圖層都沒有 text: undefined（沒有文字就是沒有這個欄位）', () => {
    const card = deepFreeze(sample());
    const base = { id: 'nb', name: '新底圖', image: hash(90), hasAlpha: false, width: 100, height: 100 };
    const results: [string, Card][] = [
      ['updateLayer', updateLayer(card, 'front', 'a', { x: 0.2, name: '改名', depth: 80 })],
      ['updateLayer 偷塞 text', updateLayer(card, 'front', 'a', { x: 0.1, text: undefined } as never)],
      ['updateLayer(文字圖層)', updateLayer(card, 'front', 't1', { x: 0.2 })],
      ['swapDepth', swapDepth(card, 'front', 'a', 't1')],
      ['centerLayer', centerLayer(updateLayer(card, 'front', 'a', { x: 0.4 }), 'front', 'a')],
      ['fillLayer', fillLayer(card, 'front', 'a', 100, 200, 0.05)],
      ['fillLayer(文字圖層)', fillLayer(card, 'front', 't1', 2048, 330, 0.05)],
      ['removeLayer', removeLayer(card, 'front', 'a')],
      ['replaceBase', replaceBase(card, 'front', base)],
      ['updateCard', updateCard(card, { aspect: 'tarot', name: 'x' })],
      ['updateTextLayer', updateTextLayer(card, 'front', 't1', { text: spec({ content: '月夜' }), image: hash(91) })],
      ['updateTextLayer 多給 text 欄位', updateTextLayer(card, 'front', 't1', { text: { ...spec(), extra: undefined } as TextSpec, image: hash(92) })],
    ];
    const added = addLayer(card, 'front', { ...base, id: 'nd', hasAlpha: true });
    if (added.ok) results.push(['addLayer', added.card]);
    const addedBase = addLayer(cardWith([]), 'front', { ...base, id: 'nb2' });
    if (addedBase.ok) results.push(['addLayer(底圖)', addedBase.card]);
    results.push(['addTextLayer', addedText(card, textInput()).card]);
    for (const [label, result] of results) {
      expectNoUndefinedText(result, label);
      expect(validateCard(result, anyImage), label).toEqual([]);
    }
    // 不是文字圖層的圖層，完全沒有 text 這個欄位
    const a = updateLayer(card, 'front', 'a', { x: 0.2 }).front.layers.find((l) => l.id === 'a')!;
    expect('text' in a).toBe(false);
  });
});
