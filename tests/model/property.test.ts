// 性質測試：對一張合格的卡隨機做一連串動作（含不合格的輸入、NaN、超範圍的數字），
// 每一步的結果都必須通過 validateCard。用固定亂數種子，結果每次都一樣。
import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addTextLayer,
  centerLayer,
  cleanTextSpec,
  fillLayer,
  removeLayer,
  replaceBase,
  swapDepth,
  updateCard,
  updateLayer,
  updateTextLayer,
  DEFAULT_TEXT,
  type CardPatch,
  type LayerPatch,
  type NewLayerInput,
  type NewTextLayerInput,
  type TextLayerUpdate,
} from '../../src/model/actions';
import { TEXT_ALIGNS, TEXT_FONTS, TEXT_STYLES } from '../../src/model/limits';
import { newCard } from '../../src/model/create';
import { BLEND_MODES, OPAQUE_LAYER_BLENDS, type BlendMode, type Card, type FaceSide, type HoloPalette, type StageStyle, type TextSpec } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { deepFreeze, hash, NOW } from './helpers';

/** mulberry32：很小的固定種子亂數產生器。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NASTY_NUMBERS = [NaN, Infinity, -Infinity, 0, -0, 1e9, -1e9, 1e-9, 0.05, 4, 4.0001, 100, 101, 1, -1];
const NASTY_NAMES = ['', '   ', '　', '狐狸', '  x  ', '字'.repeat(61), '😀'.repeat(70)];
const NASTY_COLORS = ['#ABCDEF', '#abc', 'red', '', '#12345g', '#00ff00'];
const FACES: FaceSide[] = ['front', 'back'];
const NASTY_CONTENTS = ['', '   ', '\n', '　\n　', '卡片名稱', '月', '第一行\n第二行', '字'.repeat(101), '😀'.repeat(120), '  x  '];
const NASTY_FONTS = [...TEXT_FONTS, 'comic', ''];
const NASTY_ALIGNS = [...TEXT_ALIGNS, 'left'];
const NASTY_STYLES = [...TEXT_STYLES, 'stamp'];
const NASTY_STAGES = ['halo', 'none', 'glow', 'toString', '', 'HALO'] as StageStyle[];
const NASTY_PALETTES = ['warm', 'classic', 'silver', 'gold', 'aurora', 'galaxy', 'custom', 'neon', 'toString', ''] as HoloPalette[];
/** 混合模式（T-408）：七種合格的＋不認得的。 */
const NASTY_BLENDS = [...BLEND_MODES, ...BLEND_MODES, 'darken', 'SCREEN', 'toString', '', null] as BlendMode[];

interface World {
  rng: () => number;
  /** 外觀欄位用的另一條亂數（見 randomCardPatch）。 */
  looks: () => number;
  card: Card;
  /** 目前「圖片存在」的雜湊（模擬登記簿）。 */
  images: Set<string>;
  nextId: number;
  nextImage: number;
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** 四成機率給奇怪的數字（NaN、無限、超大），其餘在 min～max 之間。 */
function randomNumber(rng: () => number, min: number, max: number): number {
  return rng() < 0.4 ? pick(rng, NASTY_NUMBERS) : between(rng, min, max);
}

function allLayerIds(card: Card): string[] {
  return [...card.front.layers, ...card.back.layers].map((l) => l.id);
}

/** 亂數產生一個輸入；bad＝故意不合格（重複 id、空 id、過長 id、壞雜湊）。 */
function randomInput(w: World): { input: NewLayerInput; bad: boolean } {
  const { rng } = w;
  w.nextId += 1;
  let id = `layer-${w.nextId}`;
  let image: string;
  let bad = false;

  // 圖片：多數是新的、已登記的雜湊；有時重用舊雜湊（同一張圖放兩層是合法的）
  if (w.images.size > 0 && rng() < 0.2) image = pick(rng, [...w.images]);
  else {
    w.nextImage += 1;
    image = hash(w.nextImage);
    w.images.add(image);
  }

  const roll = rng();
  const existing = allLayerIds(w.card);
  if (roll < 0.08 && existing.length > 0) {
    id = pick(rng, existing);
    bad = true;
  } else if (roll < 0.12) {
    id = '';
    bad = true;
  } else if (roll < 0.16) {
    id = 'x'.repeat(101);
    bad = true;
  } else if (roll < 0.22) {
    image = pick(rng, ['', 'abc', 'ABCDEF0123456789', 'g'.repeat(16), 'a'.repeat(17)]);
    bad = true;
  }

  const input: NewLayerInput = {
    id,
    name: pick(rng, NASTY_NAMES),
    image,
    hasAlpha: rng() < 0.6,
    width: rng() < 0.1 ? pick(rng, NASTY_NUMBERS) : Math.floor(between(rng, 1, 4000)),
    height: rng() < 0.1 ? pick(rng, NASTY_NUMBERS) : Math.floor(between(rng, 1, 4000)),
  };
  // 混合模式（T-408，上傳確認框的「當發光層／當加深層」）：用 looks 那條亂數，原本動作的亂數序列不變。
  // 多數給沒有透明的圖能用的三種（才真的會加出沒有透明的立體層），也混不合格的
  const { looks } = w;
  if (looks() < 0.25) input.blend = looks() < 0.6 ? pick(looks, OPAQUE_LAYER_BLENDS) : pick(looks, NASTY_BLENDS);
  return { bad, input };
}

/** 亂數文字設定的一部分（含不合格的值）；every＝六個欄位都給。 */
function randomTextPatch(rng: () => number, every = false): Partial<TextSpec> {
  const patch: Record<string, unknown> = {};
  const p = every ? 1 : 0.35;
  if (rng() < p) patch.content = pick(rng, NASTY_CONTENTS);
  if (rng() < p) patch.font = pick(rng, NASTY_FONTS);
  if (rng() < p) patch.color = pick(rng, NASTY_COLORS);
  if (rng() < p) patch.align = pick(rng, NASTY_ALIGNS);
  if (rng() < p) patch.vertical = rng() < 0.9 ? rng() < 0.5 : 'yes';
  if (rng() < p) patch.style = pick(rng, NASTY_STYLES);
  return patch as Partial<TextSpec>;
}

/** 文字圖層的動作：加一層（有時設定不合格、id 重複）或改某一層（可能不是文字圖層、可能換壞掉的雜湊）。 */
function textStep(w: World, face: FaceSide): { next: Card; label: string } {
  const { rng, card } = w;
  const layers = card[face].layers;
  if (rng() < 0.45 || layers.length === 0) {
    const { input: base, bad } = randomInput(w);
    const text = { ...DEFAULT_TEXT, ...randomTextPatch(rng, rng() < 0.3) };
    const input: NewTextLayerInput = { id: base.id, image: base.image, text, width: base.width, height: base.height };
    const r = addTextLayer(card, face, input);
    if (bad) expect(r, 'addTextLayer 要擋掉不合格的 id／雜湊').toEqual({ ok: false, reason: 'invalid-input' });
    return { next: r.ok ? r.card : card, label: `addTextLayer(${face}, ${JSON.stringify(text).slice(0, 80)}) → ${r.ok ? 'ok' : r.reason}` };
  }
  const textLayers = layers.filter((l) => l.text);
  const target = textLayers.length > 0 && rng() < 0.85 ? pick(rng, textLayers) : pick(rng, layers);
  let image: string | undefined;
  if (rng() < 0.7) {
    w.nextImage += 1;
    image = rng() < 0.1 ? 'not-a-hash' : hash(w.nextImage);
    if (image !== 'not-a-hash') w.images.add(image);
  }
  const patch = randomTextPatch(rng);
  // 給的設定：多數是完整的（目前的設定＋這次的改動，可能含不合格的值）；有時只給這次改的幾個欄位，有時完全不給
  const roll = rng();
  const text: Partial<TextSpec> | undefined = roll < 0.08 ? undefined : roll < 0.2 ? patch : { ...(target.text ?? DEFAULT_TEXT), ...patch };
  const incomplete = text === undefined || Object.keys(text).length < 6;
  // 型別要求 text、image 都必填；性質測試故意連「少給」一起丟進去，驗執行期的最後一道防線，所以這裡用 cast 繞過
  const next = updateTextLayer(card, face, target.id, { text, image } as unknown as TextLayerUpdate);
  // 字和圖一定要一起換：沒給新圖、設定沒給齊，都不准改
  if (image === undefined) expect(next, 'updateTextLayer 沒給新圖要回原卡').toBe(card);
  if (incomplete) expect(next, 'updateTextLayer 設定沒給齊要回原卡').toBe(card);
  if (image === 'not-a-hash') expect(next, 'updateTextLayer 要擋掉壞掉的雜湊').toBe(card);
  if (!target.text) expect(next, 'updateTextLayer 對不是文字圖層的不改').toBe(card);
  if (next !== card) {
    const changed = next[face].layers.find((l) => l.id === target.id)!;
    expect(changed.image, 'updateTextLayer 成功時圖要換成給的那張').toBe(image);
    // 成功的話 text 一定是完整、合格的設定；存進去的要是整理過的那份（不是舊設定、也不是半份）
    expect(changed.text, 'updateTextLayer 成功時 text 要換成整理過的新設定').toEqual(cleanTextSpec(text));
  }
  const label = `updateTextLayer(${face}, ${JSON.stringify(text ?? null).slice(0, 80)}, ${image})`;
  return { next, label };
}

/** looks：不透明度與混合模式（T-408）用的另一條亂數（同 randomCardPatch）。 */
function randomLayerPatch(rng: () => number, looks: () => number = rng): LayerPatch {
  const patch: LayerPatch = {};
  if (looks() < 0.3) patch.opacity = randomNumber(looks, -20, 150);
  if (looks() < 0.3) patch.blend = pick(looks, NASTY_BLENDS);
  if (rng() < 0.4) patch.depth = randomNumber(rng, -20, 130);
  if (rng() < 0.4) patch.x = randomNumber(rng, -2, 2);
  if (rng() < 0.4) patch.y = randomNumber(rng, -2, 2);
  if (rng() < 0.4) patch.scale = randomNumber(rng, 0, 6);
  if (rng() < 0.3) patch.name = pick(rng, NASTY_NAMES);
  if (rng() < 0.3) patch.visible = rng() < 0.5;
  if (rng() < 0.3) patch.holo = rng() < 0.5;
  return patch;
}

/** 亂數自訂色彩：多數是 4 個顏色（可能有不合格的、大寫的），有時個數不對、有空洞或根本不是陣列。 */
function randomColors(rng: () => number): string[] {
  const roll = rng();
  if (roll < 0.1) return pick(rng, ['#ff0000', null, { length: 4 }]) as never;
  const n = roll < 0.3 ? pick(rng, [0, 1, 3, 5, 8]) : 4;
  // 多數是合格的顏色（含大寫），偶爾混一個不合格的
  const color = () => (rng() < 0.9 ? `#${Math.floor(rng() * 0x1000000).toString(16).padStart(6, '0')}` : pick(rng, NASTY_COLORS));
  const colors = Array.from({ length: n }, () => (rng() < 0.2 ? color().toUpperCase() : color()));
  if (n === 4 && rng() < 0.1) delete colors[pick(rng, [0, 1, 2, 3])];
  return colors;
}

/**
 * 亂數卡片設定。looks：外觀欄位（卡框光澤、鐳射色彩、自訂色彩、陰影，T-310）用的亂數；混合測試給另一條，
 * 原本那些動作的亂數序列才不會因為多了欄位而整個改掉。
 */
function randomCardPatch(rng: () => number, looks: () => number = rng): CardPatch {
  const patch: CardPatch = {};
  if (rng() < 0.3) patch.name = pick(rng, NASTY_NAMES);
  if (rng() < 0.3) patch.aspect = pick(rng, ['standard', 'tarot', 'square' as never]);
  if (rng() < 0.3) patch.bodyColor = pick(rng, NASTY_COLORS);
  if (rng() < 0.3) patch.cornerRadius = randomNumber(rng, -0.1, 0.3);
  if (rng() < 0.4) {
    patch.frame = {};
    if (rng() < 0.5) patch.frame.enabled = rng() < 0.5;
    if (rng() < 0.5) patch.frame.width = randomNumber(rng, -0.1, 0.3);
    if (rng() < 0.5) patch.frame.color = pick(rng, NASTY_COLORS);
    if (looks() < 0.4) patch.frame.shine = randomNumber(looks, -20, 150);
  }
  if (rng() < 0.4) {
    patch.holo = {};
    if (rng() < 0.5) patch.holo.strength = randomNumber(rng, -10, 200);
    if (rng() < 0.5) patch.holo.bandWidth = randomNumber(rng, -1, 5);
    if (rng() < 0.5) patch.holo.sparkle = randomNumber(rng, -10, 200);
    // 霧光（T-417，取代舊的範圍 scope；亂數用量一樣，原本的亂數序列不變）
    if (rng() < 0.5) patch.holo.matte = pick(rng, [0, 35, 80, -10, 250, Number.NaN]);
    if (looks() < 0.4) patch.holo.palette = pick(looks, NASTY_PALETTES);
    if (looks() < 0.4) patch.holo.colors = randomColors(looks);
  }
  if (looks() < 0.3) {
    patch.shadow = {};
    if (looks() < 0.6) patch.shadow.strength = randomNumber(looks, -20, 150);
    if (looks() < 0.6) patch.shadow.distance = randomNumber(looks, -20, 150);
  }
  if (rng() < 0.3) patch.view = { returnToFront: rng() < 0.5, showcase: rng() < 0.5 };
  // 舞台（T-314）：用 looks 那條亂數，原本動作的亂數序列不變
  if (looks() < 0.3) patch.view = { ...patch.view, stage: pick(looks, NASTY_STAGES) };
  return patch;
}

/**
 * 有 text／opacity／blend 這些欄位就要有值：不能是 undefined（存進資料庫會被擋）；
 * opacity／blend 等於預設值（100／normal）時不寫出（T-408）、底圖沒有這兩個欄位。
 */
function expectNoUndefinedText(card: Card, where: string): void {
  for (const l of [...card.front.layers, ...card.back.layers]) {
    if ('text' in l) expect(l.text, `${where}：${l.id} 的 text 是 undefined`).toBeDefined();
    if ('opacity' in l) expect(l.opacity, `${where}：${l.id} 的 opacity 不該寫出`).not.toBe(100);
    if ('blend' in l) expect(l.blend, `${where}：${l.id} 的 blend 不該寫出`).not.toBe('normal');
    if ('opacity' in l) expect(l.opacity, `${where}：${l.id} 的 opacity 是 undefined`).toBeDefined();
    if ('blend' in l) expect(l.blend, `${where}：${l.id} 的 blend 是 undefined`).toBeDefined();
  }
}

/** 非文字動作之後：還在的圖層 text 和動作前一模一樣（有沒有這個欄位也一樣）；文字圖層除了被刪掉，不會不見。 */
function expectTextKept(before: Card, after: Card, removing: boolean, where: string): void {
  const byId = (c: Card) => new Map([...c.front.layers, ...c.back.layers].map((l) => [l.id, l]));
  const was = byId(before);
  const now = byId(after);
  for (const [id, layer] of was) {
    const kept = now.get(id);
    if (!kept) {
      if (layer.text) expect(removing, `${where}：文字圖層 ${id} 不見了`).toBe(true);
      continue;
    }
    expect('text' in kept, `${where}：${id} 的 text 欄位有無改變`).toBe('text' in layer);
    expect(kept.text, `${where}：${id} 的 text 內容變了`).toEqual(layer.text);
  }
}

/** 隨機挑一個動作對 w.card 做一步；回傳新卡與動作說明（失敗時用來指出是哪一步）。 */
function step(w: World): { next: Card; label: string } {
  const { rng, card } = w;
  const face = pick(rng, FACES);
  const layers = card[face].layers;
  const someId = (): string => (layers.length > 0 && rng() < 0.9 ? pick(rng, layers).id : 'no-such-layer');
  if (rng() < 0.2) return textStep(w, face);
  const roll = rng();

  if (roll < 0.28) {
    const { input, bad } = randomInput(w);
    const r = addLayer(card, face, input);
    if (bad) {
      expect(r, `addLayer 要擋掉不合格的輸入（id=${input.id.slice(0, 12)} image=${input.image}）`).toEqual({
        ok: false,
        reason: 'invalid-input',
      });
    }
    return {
      next: r.ok ? r.card : card,
      label: `addLayer(${face}, id=${input.id.slice(0, 12)}, hasAlpha=${input.hasAlpha}) → ${r.ok ? 'ok' : r.reason}`,
    };
  }
  if (roll < 0.38) {
    const { input, bad } = randomInput(w);
    const next = replaceBase(card, face, { ...input, hasAlpha: false });
    if (bad) expect(next, 'replaceBase 要擋掉不合格的輸入（回傳原卡）').toBe(card);
    return { next, label: `replaceBase(${face}, id=${input.id.slice(0, 12)})` };
  }
  if (roll < 0.48) return { next: removeLayer(card, face, someId()), label: `removeLayer(${face})` };
  if (roll < 0.68) {
    const patch = randomLayerPatch(rng, w.looks);
    return { next: updateLayer(card, face, someId(), patch), label: `updateLayer(${face}, ${JSON.stringify(patch)})` };
  }
  if (roll < 0.78) return { next: swapDepth(card, face, someId(), someId()), label: `swapDepth(${face})` };
  if (roll < 0.83) return { next: centerLayer(card, face, someId()), label: `centerLayer(${face})` };
  if (roll < 0.9) {
    const width = randomNumber(rng, 1, 4000);
    const height = randomNumber(rng, 1, 4000);
    const bleed = randomNumber(rng, -1, 1);
    return { next: fillLayer(card, face, someId(), width, height, bleed), label: `fillLayer(${face}, ${width}, ${height}, ${bleed})` };
  }
  const patch = randomCardPatch(rng, w.looks);
  return { next: updateCard(card, patch), label: `updateCard(${JSON.stringify(patch)})` };
}

describe('性質：任何動作的結果都通過 validateCard', () => {
  const SEEDS = [1, 2, 3, 7, 2026, 20261013];
  const STEPS = 300;

  it.each(SEEDS)('種子 %i：隨機 300 步（含不合格輸入、NaN、超範圍），每一步都合格', (seed) => {
    const rng = makeRng(seed);
    const w: World = {
      rng,
      looks: makeRng(seed + 310),
      card: deepFreeze(newCard(pick(rng, ['standard', 'tarot'] as const), 'card-1', NOW)),
      images: new Set(),
      nextId: 0,
      nextImage: 0,
    };
    const hasImage = (h: string): boolean => w.images.has(h);
    expect(validateCard(w.card, hasImage)).toEqual([]);

    let changed = 0;
    const textSeen = { added: 0, updated: 0 };
    // T-408：真的有改到不透明度、混合模式，也真的加出過沒有透明的立體層（不是每次都被擋掉）
    const lookSeen = { opacity: 0, blend: 0, opaqueDepth: 0 };
    const looksOf = (c: Card) =>
      [...c.front.layers, ...c.back.layers].map((l) => `${l.id}:${l.opacity ?? '-'}:${l.blend ?? '-'}`).join(',');
    for (let i = 0; i < STEPS; i++) {
      const before = structuredClone(w.card);
      const { next, label } = step(w); // w.card 是凍結的：動作若改到輸入會直接丟 TypeError
      if (next !== w.card && label.startsWith('addTextLayer')) textSeen.added += 1;
      if (next !== w.card && label.startsWith('updateTextLayer')) textSeen.updated += 1;
      expect(w.card, `第 ${i} 步（${label}）改到了輸入的卡`).toEqual(before);
      expect(validateCard(next, hasImage), `種子 ${seed} 第 ${i} 步：${label}`).toEqual([]);
      expectNoUndefinedText(next, `種子 ${seed} 第 ${i} 步：${label}`);
      if (!label.startsWith('addTextLayer') && !label.startsWith('updateTextLayer')) {
        expectTextKept(before, next, label.startsWith('removeLayer'), `種子 ${seed} 第 ${i} 步：${label}`);
      }
      if (next !== w.card) changed += 1;
      if (label.startsWith('updateLayer') && looksOf(next) !== looksOf(w.card)) {
        if (/"opacity"/.test(label)) lookSeen.opacity += 1;
        if (/"blend"/.test(label)) lookSeen.blend += 1;
      }
      if ([...next.front.layers, ...next.back.layers].some((l) => l.role === 'depth' && !l.hasAlpha)) lookSeen.opaqueDepth += 1;
      w.card = deepFreeze(next);
    }

    // 測試沒有退化：多數步驟真的改了卡，最後兩面也有圖層（或至少曾經有過）
    expect(changed).toBeGreaterThan(STEPS / 3);
    // 文字圖層真的有被加進去、被改過（不是每次都被擋掉）
    expect(textSeen.added, `種子 ${seed}：沒有成功加過文字圖層`).toBeGreaterThan(0);
    expect(textSeen.updated, `種子 ${seed}：沒有成功改過文字圖層`).toBeGreaterThan(0);
    expect(lookSeen.opacity, `種子 ${seed}：沒有成功改過不透明度`).toBeGreaterThan(0);
    expect(lookSeen.blend, `種子 ${seed}：沒有成功改過混合模式`).toBeGreaterThan(0);
    expect(lookSeen.opaqueDepth, `種子 ${seed}：沒有加出過沒有透明的立體層`).toBeGreaterThan(0);
  });
});

describe('性質：只改卡片設定（外觀，T-310）', () => {
  it.each([1, 7, 2026])('種子 %i：隨機 300 次 updateCard（含壞色彩、壞色碼清單、NaN），每一步都合格、外觀設定真的有被改到', (seed) => {
    const rng = makeRng(seed);
    let card = deepFreeze(newCard('standard', 'card-1', NOW));
    const seen = { palette: 0, colors: 0, shadow: 0, shine: 0, stage: 0 };
    for (let i = 0; i < 300; i++) {
      const patch = randomCardPatch(rng);
      const next = updateCard(card, patch);
      expect(validateCard(next, () => true), `種子 ${seed} 第 ${i} 步：${JSON.stringify(patch)}`).toEqual([]);
      if (next.holo.palette !== card.holo.palette) seen.palette += 1;
      if (next.holo.colors !== card.holo.colors) seen.colors += 1;
      if (next.shadow !== card.shadow) seen.shadow += 1;
      if (next.frame.shine !== card.frame.shine) seen.shine += 1;
      if (next.view.stage !== card.view.stage) seen.stage += 1;
      card = deepFreeze(next);
    }
    for (const [key, n] of Object.entries(seen)) expect(n, `種子 ${seed}：沒有成功改過 ${key}`).toBeGreaterThan(3);
  });
});

describe('性質：只改圖層的不透明度與混合模式（T-408）', () => {
  it.each([1, 7, 2026])('種子 %i：隨機 300 次 updateLayer（含 NaN、超範圍、不認得的模式、底圖、沒有透明的層），每一步都合格', (seed) => {
    const rng = makeRng(seed);
    const img = (n: number) => hash(500 + n);
    const layer = (over: Partial<Card['front']['layers'][number]>) => ({
      id: 'x',
      name: '圖',
      role: 'depth' as const,
      image: img(0),
      visible: true,
      depth: 50,
      x: 0,
      y: 0,
      scale: 1,
      holo: true,
      hasAlpha: true,
      ...over,
    });
    let card: Card = deepFreeze({
      ...newCard('standard', 'card-1', NOW),
      front: {
        layers: [
          layer({ id: 'base', role: 'base', depth: 0, hasAlpha: false, holo: false, image: img(1) }),
          layer({ id: 'hero', depth: 40, image: img(2) }),
          layer({ id: 'glow', depth: 60, hasAlpha: false, blend: 'screen', image: img(3) }),
          layer({ id: 'title', depth: 80, image: img(4), text: { ...DEFAULT_TEXT } }),
        ],
      },
    });
    expect(validateCard(card, () => true)).toEqual([]);
    const ids = ['base', 'hero', 'glow', 'title', 'nope'];
    const seen = { opacity: 0, blend: 0, glowBlend: 0, back100: 0 };
    for (let i = 0; i < 300; i++) {
      const id = pick(rng, ids);
      const patch = randomLayerPatch(rng, rng);
      const next = updateLayer(card, 'front', id, patch);
      const where = `種子 ${seed} 第 ${i} 步：${id} ${JSON.stringify(patch)}`;
      expect(validateCard(next, () => true), where).toEqual([]);
      expectNoUndefinedText(next, where);
      const before = card.front.layers.find((l) => l.id === id);
      const after = next.front.layers.find((l) => l.id === id);
      if (before && after) {
        if (before.opacity !== after.opacity) seen.opacity += 1;
        if (before.blend !== after.blend) seen.blend += 1;
        if (id === 'glow' && before.blend !== after.blend) seen.glowBlend += 1;
        if (before.opacity !== undefined && after.opacity === undefined) seen.back100 += 1;
        // 底圖永遠沒有這兩個欄位；沒有透明的立體層永遠是加深／發光／強光
        if (after.role === 'base') expect('opacity' in after || 'blend' in after, where).toBe(false);
        if (!after.hasAlpha && after.role === 'depth') expect(OPAQUE_LAYER_BLENDS, where).toContain(after.blend);
      }
      card = deepFreeze(next);
    }
    for (const [key, n] of Object.entries(seen)) expect(n, `種子 ${seed}：${key} 沒有發生過`).toBeGreaterThan(0);
  });
});
