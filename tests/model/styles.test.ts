// 一鍵卡片風格（T-801）：applyCardStyle／matchCardStyle。六組現有設定的組合，不加新欄位。
import { describe, expect, it } from 'vitest';
import { updateCard, updateFoil } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { faceFoil, holoMatte } from '../../src/model/foil';
import { RANGE } from '../../src/model/limits';
import { applyCardStyle, CARD_STYLES, CARD_STYLE_VALUES, matchCardStyle, type CardStyle } from '../../src/model/styles';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash, NOW } from './helpers';

const MASK = hash(9);

function sample(): Card {
  return cardWith(
    [baseLayer({ id: 'b', image: hash(1) }), depthLayer({ id: 'd', image: hash(2) })],
    [depthLayer({ id: 'e', image: hash(3) })],
  );
}

/** 數值已經調過的卡：每個「不動」的欄位都換成和預設值不同的值，才看得出有沒有被動到。 */
function tuned(): Card {
  let c = sample();
  c = updateCard(c, {
    name: '我的卡',
    aspect: 'tarot',
    bodyColor: '#5c1f2e',
    cornerRadius: 0.09,
    frame: { enabled: true, width: 0.06, style: 'ornate', color: '#123456', shine: 91 },
    holo: { strength: 55, bandWidth: 0.4, sparkle: 61, matte: 77, palette: 'custom', colors: ['#111111', '#222222', '#333333', '#444444'] },
    shadow: { strength: 12, distance: 88 },
    view: { returnToFront: false, showcase: true, stage: 'nebula' },
  });
  return c;
}

describe('六種風格的名單', () => {
  it('六個：普通、銀箔、彩虹箔、金箔、銀河、霧面（依這個順序）', () => {
    expect([...CARD_STYLES]).toEqual(['plain', 'silver', 'rainbow', 'gold', 'galaxy', 'matte']);
  });

  it('每個風格的起始值都在合格範圍內（套上去不會被夾掉）', () => {
    for (const style of CARD_STYLES) {
      const v = CARD_STYLE_VALUES[style];
      expect(v.strength).toBeGreaterThanOrEqual(RANGE.holoStrength.min);
      expect(v.strength).toBeLessThanOrEqual(RANGE.holoStrength.max);
      for (const [value, range] of [
        [v.bandWidth, RANGE.holoBandWidth],
        [v.sparkle, RANGE.holoSparkle],
        [v.matte, RANGE.holoMatte],
      ] as const) {
        if (value === undefined) continue;
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      }
      // 「普通」不寫卡框（不動卡框）；其他五種都有
      if (style === 'plain') {
        expect(v.frameShine).toBeUndefined();
        expect(v.frameColor).toBeUndefined();
        continue;
      }
      expect(v.frameShine).toBeGreaterThanOrEqual(RANGE.frameShine.min);
      expect(v.frameShine).toBeLessThanOrEqual(RANGE.frameShine.max);
      expect(v.frameColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('applyCardStyle：每種風格套上去的結果', () => {
  const cases: { style: CardStyle; palette: string; strength: number; bandWidth: number; sparkle: number; matte: number; color: string; shine: number; shape: string }[] = [
    { style: 'silver', palette: 'silver', strength: 70, bandWidth: 0.8, sparkle: 20, matte: 20, color: '#d8dbe2', shine: 70, shape: 'full' },
    { style: 'rainbow', palette: 'classic', strength: 75, bandWidth: 1, sparkle: 30, matte: 35, color: '#d8dbe2', shine: 60, shape: 'full' },
    { style: 'gold', palette: 'gold', strength: 70, bandWidth: 0.9, sparkle: 25, matte: 30, color: '#d4af37', shine: 75, shape: 'full' },
    { style: 'galaxy', palette: 'galaxy', strength: 80, bandWidth: 1.4, sparkle: 80, matte: 25, color: '#16161a', shine: 60, shape: 'full' },
    { style: 'matte', palette: 'warm', strength: 35, bandWidth: 1.6, sparkle: 0, matte: 70, color: '#ffffff', shine: 20, shape: 'none' },
  ];

  for (const c of cases) {
    it(`${c.style}：色彩、強度、色帶、閃星、霧光、卡框顏色與光澤、兩面的反光層形狀`, () => {
      const out = applyCardStyle(tuned(), c.style);
      expect(out.holo.palette).toBe(c.palette);
      expect(out.holo.strength).toBe(c.strength);
      expect(out.holo.bandWidth).toBe(c.bandWidth);
      expect(out.holo.sparkle).toBe(c.sparkle);
      expect(holoMatte(out.holo)).toBe(c.matte);
      expect(out.frame.color).toBe(c.color);
      expect(out.frame.shine).toBe(c.shine);
      expect(faceFoil(out.front).shape).toBe(c.shape);
      expect(faceFoil(out.back).shape).toBe(c.shape);
    });
  }

  it('普通：只把強度設 0（鐳射、閃星、霧光一起關）；其他鐳射設定、卡框、反光層形狀都保留（DESIGN T-801；T-801 審查）', () => {
    const before = tuned();
    const out = applyCardStyle(before, 'plain');
    expect(out.holo.strength).toBe(0);
    expect(out.holo.palette).toBe('custom');
    expect(out.holo.bandWidth).toBe(0.4);
    expect(out.holo.sparkle).toBe(61);
    expect(holoMatte(out.holo)).toBe(77);
    expect(out.frame).toEqual(before.frame);
    expect(out.front).toBe(before.front);
    expect(out.back).toBe(before.back);
  });

  it('普通之後把強度拉回來，就是原本的樣子（鐳射與卡框都還在）', () => {
    const before = tuned();
    const back = updateCard(applyCardStyle(before, 'plain'), { holo: { strength: 55 } });
    expect(back.holo).toEqual(before.holo);
    expect(back.frame).toEqual(before.frame);
  });

  it('已經是那個風格（選中判斷認得的寫法，例如大寫色碼、滑桿的浮點誤差）再套一次：回傳同一個物件，不多記一步（T-801 審查）', () => {
    const gold = applyCardStyle(sample(), 'gold');
    const upper = { ...gold, frame: { ...gold.frame, color: '#D4AF37' } };
    expect(matchCardStyle(upper)).toBe('gold');
    expect(applyCardStyle(upper, 'gold')).toBe(upper);
    const silver = applyCardStyle(sample(), 'silver');
    const drift = { ...silver, holo: { ...silver.holo, bandWidth: 0.8000000000000002 } };
    expect(matchCardStyle(drift)).toBe('silver');
    expect(applyCardStyle(drift, 'silver')).toBe(drift);
  });

  it('自訂色彩 colors 一律保留（不是 custom 的風格也不動它）', () => {
    const before = tuned();
    for (const style of CARD_STYLES) expect(applyCardStyle(before, style).holo.colors).toEqual(['#111111', '#222222', '#333333', '#444444']);
  });

  it('不動的東西：卡框開關與樣式與粗細、卡身顏色、圓角、陰影、舞台與展示、名字、比例、圖層', () => {
    const before = tuned();
    for (const style of CARD_STYLES) {
      const out = applyCardStyle(before, style);
      expect(out.frame.enabled).toBe(true);
      expect(out.frame.style).toBe('ornate');
      expect(out.frame.width).toBe(0.06);
      expect(out.bodyColor).toBe(before.bodyColor);
      expect(out.cornerRadius).toBe(before.cornerRadius);
      expect(out.shadow).toEqual(before.shadow);
      expect(out.view).toEqual(before.view);
      expect(out.name).toBe(before.name);
      expect(out.aspect).toBe(before.aspect);
      expect(out.id).toBe(before.id);
      expect(out.front.layers).toBe(before.front.layers);
      expect(out.back.layers).toBe(before.back.layers);
    }
  });

  it('卡框關著時只改顏色與光澤，不會順便打開', () => {
    const before = sample();
    expect(before.frame.enabled).toBe(false);
    for (const style of CARD_STYLES) {
      const out = applyCardStyle(before, style);
      expect(out.frame.enabled).toBe(false);
      expect(out.frame.width).toBe(before.frame.width);
    }
    expect(applyCardStyle(before, 'gold').frame).toMatchObject({ color: '#d4af37', shine: 75, enabled: false });
  });

  it('反光層的「卡框也反光」不動；只換形狀', () => {
    let c = updateFoil(sample(), 'front', { frame: false });
    c = updateFoil(c, 'back', { shape: 'layers' });
    const out = applyCardStyle(c, 'silver');
    expect(faceFoil(out.front)).toEqual({ shape: 'full', frame: false });
    expect(faceFoil(out.back)).toEqual({ shape: 'full', frame: true });
    const matte = applyCardStyle(c, 'matte');
    expect(faceFoil(matte.front)).toEqual({ shape: 'none', frame: false });
    expect(faceFoil(matte.back)).toEqual({ shape: 'none', frame: true });
  });

  it('上傳過的遮罩圖保留：只換形狀、mask 欄位留著，切回「上傳遮罩」時還在', () => {
    let c = sample();
    c = updateFoil(c, 'front', { shape: 'mask', mask: MASK });
    expect(faceFoil(c.front)).toEqual({ shape: 'mask', mask: MASK, frame: true });
    for (const style of ['silver', 'matte'] as const) {
      const out = applyCardStyle(c, style);
      expect(faceFoil(out.front).mask).toBe(MASK);
      expect(faceFoil(out.front).shape).toBe(style === 'silver' ? 'full' : 'none');
      const back = updateFoil(out, 'front', { shape: 'mask' });
      expect(faceFoil(back.front)).toEqual({ shape: 'mask', mask: MASK, frame: true });
    }
  });

  it('普通不碰反光層：遮罩形狀照舊', () => {
    const c = updateFoil(sample(), 'front', { shape: 'mask', mask: MASK });
    expect(faceFoil(applyCardStyle(c, 'plain').front)).toEqual({ shape: 'mask', mask: MASK, frame: true });
  });

  it('回新卡、不改輸入（輸入先凍結）', () => {
    const before = deepFreeze(tuned());
    for (const style of CARD_STYLES) {
      expect(() => applyCardStyle(before, style)).not.toThrow();
    }
  });

  it('同一個風格套兩次＝同一個物件（第二次沒有改變，才不會多記一步）', () => {
    for (const style of CARD_STYLES) {
      const once = applyCardStyle(tuned(), style);
      expect(applyCardStyle(once, style)).toBe(once);
    }
  });

  it('套完仍是合格的卡（validateCard 沒有錯誤）', () => {
    const c = updateFoil(tuned(), 'front', { shape: 'mask', mask: MASK });
    const has = (h: string) => anyImage() && (h === MASK || [hash(1), hash(2), hash(3)].includes(h));
    for (const style of CARD_STYLES) expect(validateCard(applyCardStyle(c, style), has)).toEqual([]);
  });

  it('新卡的預設值套上去：霧光 35 的風格（彩虹箔）拿掉 matte 欄位，不寫 undefined', () => {
    const out = applyCardStyle(newCard('standard', 'c', NOW), 'rainbow');
    expect('matte' in out.holo).toBe(false);
    expect(holoMatte(out.holo)).toBe(35);
  });
});

describe('matchCardStyle：目前的設定剛好等於哪個風格', () => {
  it('套完每個風格，就認得出那個風格（從幾種不同的起點）', () => {
    const starts = [sample(), tuned(), newCard('tarot', 'x', NOW), updateCard(sample(), { holo: { strength: 0 } })];
    for (const start of starts) {
      for (const style of CARD_STYLES) expect(matchCardStyle(applyCardStyle(start, style))).toBe(style);
    }
  });

  it('新卡（預設設定）不是任何風格', () => {
    expect(matchCardStyle(newCard('standard', 'c', NOW))).toBeNull();
    expect(matchCardStyle(sample())).toBeNull();
  });

  it('微調過就都不是：強度差 1、色帶、閃星、霧光、色彩、卡框顏色、卡框光澤、其中一面的反光層', () => {
    const base = applyCardStyle(sample(), 'gold');
    expect(matchCardStyle(base)).toBe('gold');
    expect(matchCardStyle(updateCard(base, { holo: { strength: 71 } }))).toBeNull();
    expect(matchCardStyle(updateCard(base, { holo: { bandWidth: 1 } }))).toBeNull();
    expect(matchCardStyle(updateCard(base, { holo: { sparkle: 26 } }))).toBeNull();
    expect(matchCardStyle(updateCard(base, { holo: { matte: 31 } }))).toBeNull();
    expect(matchCardStyle(updateCard(base, { holo: { palette: 'silver' } }))).toBeNull();
    expect(matchCardStyle(updateCard(base, { frame: { color: '#d8dbe2' } }))).toBeNull();
    expect(matchCardStyle(updateCard(base, { frame: { shine: 74 } }))).toBeNull();
    expect(matchCardStyle(updateFoil(base, 'back', { shape: 'layers' }))).toBeNull();
    expect(matchCardStyle(updateFoil(base, 'front', { shape: 'none' }))).toBeNull();
  });

  it('不是風格管的欄位怎麼動都不影響：卡框開關與樣式、卡身顏色、圓角、陰影、舞台、自訂色彩、遮罩圖', () => {
    const base = applyCardStyle(sample(), 'silver');
    let c = updateCard(base, {
      bodyColor: '#101014',
      cornerRadius: 0.1,
      frame: { enabled: true, width: 0.07, style: 'ornate' },
      shadow: { strength: 0 },
      view: { stage: 'water', showcase: true },
      holo: { colors: ['#010101', '#020202', '#030303', '#040404'] },
    });
    c = updateFoil(c, 'front', { frame: false });
    expect(matchCardStyle(c)).toBe('silver');
    c = updateFoil(updateFoil(c, 'front', { shape: 'mask', mask: MASK }), 'front', { shape: 'full' });
    expect(matchCardStyle(c)).toBe('silver');
  });

  it('普通：強度 0 就算（卡框是什麼都一樣，普通不管卡框）', () => {
    expect(matchCardStyle(applyCardStyle(sample(), 'plain'))).toBe('plain');
    expect(matchCardStyle(updateCard(sample(), { holo: { strength: 0 } }))).toBe('plain');
    expect(matchCardStyle(updateCard(applyCardStyle(sample(), 'plain'), { frame: { shine: 31, color: '#d4af37' } }))).toBe('plain');
    expect(matchCardStyle(updateCard(sample(), { holo: { strength: 1 } }))).not.toBe('plain');
  });

  it('色帶寬度用滑桿拖出來的浮點誤差（0.8000000000000002）也算同一個值', () => {
    const base = applyCardStyle(sample(), 'silver');
    expect(matchCardStyle({ ...base, holo: { ...base.holo, bandWidth: 0.8000000000000002 } })).toBe('silver');
  });

  it('卡框顏色大小寫不同也算', () => {
    const base = applyCardStyle(sample(), 'gold');
    expect(matchCardStyle({ ...base, frame: { ...base.frame, color: '#D4AF37' } })).toBe('gold');
  });
});
