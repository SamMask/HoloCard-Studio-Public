// 水鏡遠景（T-815，SCHEMA 的 view.waterScene?、DESIGN §5「水鏡遠景」）：可以省略（舊卡照讀、省略＝'lake'）、有的話三選一；
// 改它走 updateCard 的 view（每次切換一步；選回 'lake' 時拿掉欄位）；寫出時 'lake' 省略；
// 換舞台、套風格、換比例、背景圖、圖層、反光層、光碟都保留它（其他舞台照存不畫）。
import { describe, expect, it } from 'vitest';
import { addLayer, omitCardDefaults, setBackdrop, updateCard, updateFoil, updateLayer, waterSceneOf } from '../../src/model/actions';
import { newCard, newDisc } from '../../src/model/create';
import { apply, createHistory, undo } from '../../src/model/history';
import { DEFAULT_WATER_SCENE, WATER_SCENES } from '../../src/model/limits';
import { applyCardStyle } from '../../src/model/styles';
import type { Card, WaterScene } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, hash, NOW } from './helpers';

const fresh = (): Card => newCard('standard', 'c1', NOW);
/** 經過 JSON（像從資料庫或卡片檔讀進來）。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const withScene = (scene: unknown, card: Card = fresh()): unknown => {
  const c = plain(card) as unknown as { view: Record<string, unknown> };
  c.view.waterScene = scene;
  return c;
};
const on = (scene: WaterScene, card: Card = fresh()): Card => updateCard(card, { view: { waterScene: scene } });

describe('三種遠景', () => {
  it('湖光山峰、水墨山、富士山；預設湖光山峰', () => {
    expect(WATER_SCENES).toEqual(['lake', 'ink', 'fuji']);
    expect(DEFAULT_WATER_SCENE).toBe('lake');
  });
});

describe('驗證：view.waterScene 可以省略，有的話三選一', () => {
  it('新卡沒有這個欄位；舊卡（沒有 waterScene）照讀', () => {
    const c = plain(fresh());
    expect(own(c.view, 'waterScene')).toBe(false);
    expect(validateCard(c, anyImage)).toEqual([]);
  });

  it('三種都合格（含明寫 lake）', () => {
    for (const scene of WATER_SCENES) expect(validateCard(withScene(scene), anyImage), scene).toEqual([]);
  });

  it('其他值都不合格，錯誤指到 view.waterScene', () => {
    for (const bad of ['sea', 'LAKE', '', 1, null, true, ['lake'], { scene: 'lake' }]) {
      const errors = validateCard(withScene(bad), anyImage);
      expect(errors, JSON.stringify(bad)).toHaveLength(1);
      expect(errors[0]).toMatch(/^view\.waterScene/);
    }
  });

  it('光碟、其他舞台也能有（照存不畫）', () => {
    expect(validateCard(withScene('fuji', newDisc('d1', NOW)), anyImage)).toEqual([]);
    expect(validateCard(withScene('ink', updateCard(fresh(), { view: { stage: 'nebula' } })), anyImage)).toEqual([]);
  });
});

describe('waterSceneOf：這張卡選的遠景', () => {
  it('省略＝湖光山峰；有的話照它', () => {
    expect(waterSceneOf(fresh())).toBe('lake');
    for (const scene of WATER_SCENES) expect(waterSceneOf(on(scene))).toBe(scene);
  });

  it('壞資料（不該發生）也當湖光山峰，不丟錯', () => {
    const odd = { ...fresh(), view: { ...fresh().view, waterScene: 'sea' } } as unknown as Card;
    expect(waterSceneOf(odd)).toBe('lake');
  });
});

describe('動作：updateCard 的 view.waterScene', () => {
  it('換成水墨山：回新卡，只多這個欄位；不改輸入', () => {
    const card = fresh();
    const before = plain(card);
    const next = on('ink', card);
    expect(next).not.toBe(card);
    expect(next.view).toEqual({ ...card.view, waterScene: 'ink' });
    expect(card).toEqual(before);
  });

  it('選回湖光山峰：拿掉欄位（不寫 undefined、也不寫 lake）', () => {
    const back = on('lake', on('fuji'));
    expect(own(back.view, 'waterScene')).toBe(false);
    expect(back.view).toEqual(fresh().view);
  });

  it('沒有改變回原卡（同一個物件）：沒有欄位時選湖光山峰、同一種再選一次、明寫 lake 的舊卡選湖光山峰', () => {
    const card = fresh();
    expect(on('lake', card)).toBe(card);
    const ink = on('ink', card);
    expect(on('ink', ink)).toBe(ink);
    const explicit = { ...card, view: { ...card.view, waterScene: 'lake' as const } };
    expect(on('lake', explicit)).toBe(explicit);
  });

  it('不合格的值不改', () => {
    const card = on('fuji');
    for (const bad of ['sea', '', 7, null] as unknown as WaterScene[]) expect(on(bad, card)).toBe(card);
  });

  it('記一步：每次切換一步，復原回到上一種', () => {
    const card = fresh();
    let h = createHistory(card);
    h = apply(h, on('ink', h.present));
    h = apply(h, on('fuji', h.present));
    expect(waterSceneOf(h.present)).toBe('fuji');
    h = undo(h);
    expect(waterSceneOf(h.present)).toBe('ink');
    h = undo(h);
    expect(own(h.present.view, 'waterScene')).toBe(false);
  });

  it('和舞台一起改也可以；只改舞台不動遠景', () => {
    const both = updateCard(fresh(), { view: { stage: 'water', waterScene: 'fuji' } });
    expect(both.view.stage).toBe('water');
    expect(both.view.waterScene).toBe('fuji');
    expect(updateCard(both, { view: { stage: 'halo' } }).view.waterScene).toBe('fuji');
  });
});

describe('其他動作都保留遠景', () => {
  it('套風格（T-801）、換比例（T-807）、背景圖（T-814）、卡套、圖層、反光層', () => {
    expect(applyCardStyle(on('ink'), 'gold').view.waterScene).toBe('ink');
    expect(updateCard(on('ink'), { aspect: 'tarot' }).view.waterScene).toBe('ink');
    expect(updateCard(on('ink'), { aspect: 'custom', customAspect: { width: 3, height: 2 } }).view.waterScene).toBe('ink');
    expect(updateCard(on('ink'), { view: { sleeve: true } }).view.waterScene).toBe('ink');
    const bd = setBackdrop(on('ink'), hash(7));
    expect(bd.view.waterScene).toBe('ink');
    expect(setBackdrop(bd, null).view.waterScene).toBe('ink');
    const added = addLayer(on('ink'), 'front', { id: 'x', name: 'x', image: hash(1), hasAlpha: true, width: 10, height: 10 });
    if (!added.ok) throw new Error(added.reason);
    expect(updateLayer(added.card, 'front', 'x', { depth: 80 }).view.waterScene).toBe('ink');
    expect(updateFoil(on('ink'), 'front', { shape: 'none' }).view.waterScene).toBe('ink');
  });

  it('光碟（T-810）也能選', () => {
    const disc = on('fuji', newDisc('d1', NOW));
    expect(disc.view.waterScene).toBe('fuji');
    expect(validateCard(plain(disc), anyImage)).toEqual([]);
  });
});

describe('寫出時（卡片檔）', () => {
  it('水墨山、富士山照寫；明寫 lake、欄位在但是 undefined 都拿掉', () => {
    expect(omitCardDefaults(on('ink')).view.waterScene).toBe('ink');
    expect(omitCardDefaults(on('fuji')).view.waterScene).toBe('fuji');
    const explicit = { ...fresh(), view: { ...fresh().view, waterScene: 'lake' as const } };
    expect(own(omitCardDefaults(explicit).view, 'waterScene')).toBe(false);
    const odd = { ...fresh(), view: { ...fresh().view, waterScene: undefined } } as Card;
    expect(own(omitCardDefaults(odd).view, 'waterScene')).toBe(false);
  });

  it('沒有要拿掉的回原卡', () => {
    const card = fresh();
    expect(omitCardDefaults(card)).toBe(card);
  });
});
