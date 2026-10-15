// 卡片比例（T-807，SCHEMA Card.aspect／customAspect?、DESIGN「卡片比例」）：五種比例、自訂寬高的規則、
// 「高／寬」只有 aspectHeight 一個地方算；換比例時圖層 x／y／scale 不變；舊卡照讀；驗證照 SCHEMA。
import { describe, expect, it } from 'vitest';
import { containScale, coverScale, updateCard } from '../../src/model/actions';
import { aspectHeight, CUSTOM_ASPECT, customAspectProblem, presetAspectSize } from '../../src/model/aspect';
import { newCard } from '../../src/model/create';
import { apply, createHistory, undo } from '../../src/model/history';
import { ASPECT_HEIGHT, type Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, baseLayer, cardWith, deepFreeze, depthLayer, hash, NOW } from './helpers';

/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

describe('aspectHeight：高／寬（以卡寬為 1）', () => {
  it('標準卡、塔羅牌和以前一模一樣（88/63、120/70）', () => {
    expect(aspectHeight({ aspect: 'standard' })).toBe(88 / 63);
    expect(aspectHeight({ aspect: 'tarot' })).toBe(120 / 70);
    expect(ASPECT_HEIGHT.standard).toBe(88 / 63);
    expect(ASPECT_HEIGHT.tarot).toBe(120 / 70);
  });

  it('正方形 1:1、明信片 100:148', () => {
    expect(aspectHeight({ aspect: 'square' })).toBe(1);
    expect(aspectHeight({ aspect: 'postcard' })).toBe(148 / 100);
  });

  it('自訂：高 ÷ 寬（單位隨意，只看比例）；橫式小於 1', () => {
    expect(aspectHeight({ aspect: 'custom', customAspect: { width: 3, height: 2 } })).toBe(2 / 3);
    expect(aspectHeight({ aspect: 'custom', customAspect: { width: 63, height: 88 } })).toBe(88 / 63);
    expect(aspectHeight({ aspect: 'custom', customAspect: { width: 1, height: 2 } })).toBe(2);
    expect(aspectHeight({ aspect: 'custom', customAspect: { width: 2, height: 1 } })).toBe(0.5);
  });

  it('卡片本身就能傳（Card 是一個 CardShape）', () => {
    const card: Card = { ...newCard('custom', 'c1', NOW, { width: 4, height: 3 }) };
    expect(aspectHeight(card)).toBe(3 / 4);
  });

  it('每種預設比例都有一組整數寬高（自訂框的起始值），比例和 aspectHeight 一樣', () => {
    for (const aspect of ['standard', 'tarot', 'square', 'postcard'] as const) {
      const size = presetAspectSize(aspect);
      expect(Number.isInteger(size.width) && Number.isInteger(size.height)).toBe(true);
      expect(size.height / size.width).toBeCloseTo(aspectHeight({ aspect }), 12);
      expect(customAspectProblem(size.width, size.height)).toBeNull();
    }
    expect(presetAspectSize('standard')).toEqual({ width: 63, height: 88 });
    expect(presetAspectSize('postcard')).toEqual({ width: 100, height: 148 });
  });
});

describe('customAspectProblem：自訂寬高合不合格', () => {
  it('整數 1～999、高／寬在 0.5～2.0（含兩端）', () => {
    expect(CUSTOM_ASPECT.side).toEqual({ min: 1, max: 999 });
    expect(customAspectProblem(3, 2)).toBeNull();
    expect(customAspectProblem(1, 2)).toBeNull();
    expect(customAspectProblem(2, 1)).toBeNull();
    expect(customAspectProblem(999, 999)).toBeNull();
    expect(customAspectProblem(500, 999)).toBeNull();
  });

  it('不是 1～999 的整數 → side', () => {
    for (const [w, h] of [
      [0, 1],
      [1, 1000],
      [1.5, 2],
      [NaN, 2],
      [Infinity, 2],
      [-3, -3],
      ['3', 2],
      [null, 2],
    ] as [unknown, unknown][]) {
      expect(customAspectProblem(w, h), `${String(w)}×${String(h)}`).toBe('side');
    }
  });

  it('太扁或太長（超出 1:2～2:1）→ ratio', () => {
    expect(customAspectProblem(1, 3)).toBe('ratio');
    expect(customAspectProblem(3, 1)).toBe('ratio');
    expect(customAspectProblem(100, 201)).toBe('ratio');
    expect(customAspectProblem(201, 100)).toBe('ratio');
  });
});

describe('newCard：五種比例', () => {
  it('預設比例：沒有 customAspect 欄位、驗證過', () => {
    for (const aspect of ['standard', 'tarot', 'square', 'postcard'] as const) {
      const c = newCard(aspect, 'c1', NOW);
      expect(c.aspect).toBe(aspect);
      expect(own(c, 'customAspect')).toBe(false);
      expect(validateCard(plain(c), anyImage)).toEqual([]);
    }
  });

  it('自訂：帶寬高（複本，不共用呼叫端的物件）、驗證過', () => {
    const size = { width: 3, height: 2 };
    const c = newCard('custom', 'c1', NOW, size);
    expect(c.aspect).toBe('custom');
    expect(c.customAspect).toEqual({ width: 3, height: 2 });
    expect(c.customAspect).not.toBe(size);
    expect(validateCard(plain(c), anyImage)).toEqual([]);
  });

  it('自訂但寬高不合格（或沒給）→ 建成標準卡（不寫出不合格的卡）', () => {
    for (const bad of [undefined, { width: 1, height: 3 }, { width: 0, height: 5 }, { width: 2.5, height: 3 }]) {
      const c = newCard('custom', 'c1', NOW, bad);
      expect(c.aspect, JSON.stringify(bad)).toBe('standard');
      expect(own(c, 'customAspect')).toBe(false);
    }
  });

  it('不是自訂時帶了寬高也不寫', () => {
    const c = newCard('square', 'c1', NOW, { width: 3, height: 2 });
    expect(own(c, 'customAspect')).toBe(false);
  });
});

describe('updateCard：比例（aspect 與 customAspect 一起改）', () => {
  const layered = (): Card =>
    cardWith([baseLayer({ id: 'b', scale: 1.4 }), depthLayer({ id: 'a', x: 0.2, y: -0.3, scale: 0.7, image: hash(3) })]);

  it('換成新的預設比例：圖層 x／y／scale 不變', () => {
    const before = deepFreeze(layered());
    for (const aspect of ['tarot', 'square', 'postcard'] as const) {
      const next = updateCard(before, { aspect });
      expect(next.aspect).toBe(aspect);
      expect(next.front).toBe(before.front);
      expect(own(next, 'customAspect')).toBe(false);
    }
  });

  it('換成自訂：一定要帶合格的寬高；圖層不變；驗證過', () => {
    const before = deepFreeze(layered());
    const next = updateCard(before, { aspect: 'custom', customAspect: { width: 3, height: 2 } });
    expect(next.aspect).toBe('custom');
    expect(next.customAspect).toEqual({ width: 3, height: 2 });
    expect(next.front).toBe(before.front);
    expect(validateCard(plain(next), anyImage)).toEqual([]);
  });

  it('換成自訂但沒帶寬高、或寬高不合格 → 不改（回原卡）', () => {
    const before = deepFreeze(layered());
    expect(updateCard(before, { aspect: 'custom' })).toBe(before);
    expect(updateCard(before, { aspect: 'custom', customAspect: { width: 1, height: 3 } })).toBe(before);
    expect(updateCard(before, { aspect: 'custom', customAspect: { width: 0, height: 1 } })).toBe(before);
    expect(updateCard(before, { aspect: 'custom', customAspect: { width: 2.5, height: 3 } })).toBe(before);
  });

  it('已經是自訂：只給 customAspect 就改寬高；不合格不改；一樣的寬高回原卡', () => {
    const custom = deepFreeze(newCard('custom', 'c1', NOW, { width: 3, height: 2 }));
    const wider = updateCard(custom, { customAspect: { width: 2, height: 1 } });
    expect(wider.customAspect).toEqual({ width: 2, height: 1 });
    expect(wider.aspect).toBe('custom');
    expect(updateCard(custom, { customAspect: { width: 5, height: 1 } })).toBe(custom);
    expect(updateCard(custom, { customAspect: { width: 3, height: 2 } })).toBe(custom);
    expect(updateCard(custom, { aspect: 'custom', customAspect: { width: 3, height: 2 } })).toBe(custom);
    // 寬高不同但比例一樣也算改了（存的是使用者打的數字）
    expect(updateCard(custom, { customAspect: { width: 6, height: 4 } }).customAspect).toEqual({ width: 6, height: 4 });
  });

  it('不是自訂時只給 customAspect：不改', () => {
    const before = deepFreeze(newCard('standard', 'c1', NOW));
    expect(updateCard(before, { customAspect: { width: 3, height: 2 } })).toBe(before);
  });

  it('從自訂換回預設比例：拿掉 customAspect（不寫 undefined）', () => {
    const custom = deepFreeze(newCard('custom', 'c1', NOW, { width: 3, height: 2 }));
    const back = updateCard(custom, { aspect: 'standard', customAspect: { width: 9, height: 9 } });
    expect(back.aspect).toBe('standard');
    expect(own(back, 'customAspect')).toBe(false);
    expect(validateCard(plain(back), anyImage)).toEqual([]);
  });

  it('不認得的比例不改', () => {
    const before = deepFreeze(newCard('standard', 'c1', NOW));
    expect(updateCard(before, { aspect: 'round' as never })).toBe(before);
  });

  it('記一步、可復原（換成正方形再復原，圖層位置一樣）', () => {
    const start = layered();
    let h = createHistory(start);
    h = apply(h, updateCard(h.present, { aspect: 'square' }));
    h = apply(h, updateCard(h.present, { aspect: 'custom', customAspect: { width: 3, height: 2 } }));
    expect(h.present.aspect).toBe('custom');
    h = undo(h);
    expect(h.present.aspect).toBe('square');
    h = undo(h);
    expect(h.present).toEqual(start);
  });

  it('輸入的寬高物件不會被共用（改呼叫端的物件不影響卡）', () => {
    const size = { width: 3, height: 2 };
    const next = updateCard(newCard('standard', 'c1', NOW), { aspect: 'custom', customAspect: size });
    size.width = 1;
    expect(next.customAspect).toEqual({ width: 3, height: 2 });
  });
});

describe('驗證：aspect 五選一，customAspect 跟著 aspect', () => {
  const withShape = (aspect: unknown, customAspect?: unknown): unknown => {
    const c = plain(newCard('standard', 'c1', NOW)) as unknown as Record<string, unknown>;
    c.aspect = aspect;
    if (customAspect !== undefined) c.customAspect = customAspect;
    return c;
  };

  it('舊卡（標準卡、塔羅牌，沒有 customAspect）照讀', () => {
    expect(validateCard(withShape('standard'), anyImage)).toEqual([]);
    expect(validateCard(withShape('tarot'), anyImage)).toEqual([]);
  });

  it('正方形、明信片合格；自訂帶合格寬高合格', () => {
    expect(validateCard(withShape('square'), anyImage)).toEqual([]);
    expect(validateCard(withShape('postcard'), anyImage)).toEqual([]);
    expect(validateCard(withShape('custom', { width: 3, height: 2 }), anyImage)).toEqual([]);
    expect(validateCard(withShape('custom', { width: 1, height: 2 }), anyImage)).toEqual([]);
    expect(validateCard(withShape('custom', { width: 999, height: 500 }), anyImage)).toEqual([]);
  });

  it('自訂但沒有 customAspect → 錯誤指到 customAspect', () => {
    const errors = validateCard(withShape('custom'), anyImage);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^customAspect/);
  });

  it('不是自訂卻有 customAspect → 錯誤指到 customAspect', () => {
    for (const aspect of ['standard', 'tarot', 'square', 'postcard']) {
      const errors = validateCard(withShape(aspect, { width: 3, height: 2 }), anyImage);
      expect(errors, aspect).toHaveLength(1);
      expect(errors[0]).toMatch(/^customAspect/);
    }
  });

  it('寬高壞值：不是 1～999 的整數、太扁太長、少欄位、多欄位、不是物件', () => {
    for (const bad of [
      { width: 0, height: 2 },
      { width: 3, height: 1000 },
      { width: 1.5, height: 2 },
      { width: '3', height: 2 },
      { width: 1, height: 3 },
      { width: 3, height: 1 },
      { width: 3 },
      { width: 3, height: 2, depth: 1 },
      null,
      [3, 2],
      '3:2',
    ]) {
      const errors = validateCard(withShape('custom', bad), anyImage);
      expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(errors.every((e) => e.startsWith('customAspect')), JSON.stringify(errors)).toBe(true);
    }
  });

  it('不認得的比例照樣報錯', () => {
    const errors = validateCard(withShape('round'), anyImage);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^aspect/);
  });
});

describe('containScale／coverScale 照新比例（含橫式）', () => {
  it('正方形：方圖剛好放得下、剛好蓋滿', () => {
    expect(containScale(1000, 1000, { aspect: 'square' })).toBeCloseTo(1, 12);
    expect(coverScale(1000, 1000, { aspect: 'square' })).toBeCloseTo(1, 12);
  });

  it('明信片：直圖 100:148 剛好', () => {
    expect(containScale(1000, 1480, { aspect: 'postcard' })).toBeCloseTo(1, 12);
    expect(coverScale(1000, 1480, { aspect: 'postcard' })).toBeCloseTo(1, 12);
  });

  it('橫式自訂 3:2（卡高 2/3）：直圖放得下時被高度限制、蓋滿時寬度貼齊', () => {
    const wide = { aspect: 'custom', customAspect: { width: 3, height: 2 } } as const;
    // 直圖 1000×2000：放得下＝圖高等於卡高 → 寬 = (2/3)/2
    expect(containScale(1000, 2000, wide)).toBeCloseTo(1 / 3, 12);
    expect(coverScale(1000, 2000, wide)).toBeCloseTo(1, 12);
    // 橫圖 3000×2000：剛好
    expect(containScale(3000, 2000, wide)).toBeCloseTo(1, 12);
    expect(coverScale(3000, 2000, wide)).toBeCloseTo(1, 12);
    // 更橫的圖 4000×1000：放得下＝寬貼齊；蓋滿＝高貼齊 → 寬 = (2/3)×4
    expect(containScale(4000, 1000, wide)).toBeCloseTo(1, 12);
    expect(coverScale(4000, 1000, wide)).toBeCloseTo(8 / 3, 12);
    // 出血：蓋住 (1＋0.1) × (2/3＋0.1)
    expect(coverScale(3000, 2000, wide, 0.05)).toBeCloseTo(1.15, 12);
  });

  it('標準卡、塔羅牌照舊', () => {
    expect(containScale(1000, 2000, { aspect: 'standard' })).toBeCloseTo(88 / 63 / 2, 12);
    expect(coverScale(2000, 1000, { aspect: 'tarot' })).toBeCloseTo((120 / 70) * 2, 12);
  });
});
