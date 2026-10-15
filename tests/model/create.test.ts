import { describe, expect, it } from 'vitest';
import { newCard, newDisc } from '../../src/model/create';
import { HOLO_PALETTES } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { NOW } from './helpers';

describe('newCard（SCHEMA §1.3 新卡片預設）', () => {
  it('照 SCHEMA 的預設值建立', () => {
    expect(newCard('standard', 'card-1', NOW)).toEqual({
      formatVersion: 1,
      id: 'card-1',
      name: '未命名卡片',
      createdAt: NOW,
      updatedAt: NOW,
      aspect: 'standard',
      bodyColor: '#1b2033',
      cornerRadius: 0.05,
      front: { layers: [] },
      back: { layers: [] },
      frame: { enabled: false, width: 0.03, color: '#d8dbe2', shine: 50 },
      holo: { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: ['#ff6b9d', '#ff9f5a', '#ffd36b', '#fff4e0'] },
      shadow: { strength: 50, distance: 50 },
      view: { returnToFront: true, showcase: false, stage: 'desk' },
    });
  });

  it('新卡片的預設舞台是工作桌（T-832c），光碟也是', () => {
    expect(newCard('standard', 'a', NOW).view.stage).toBe('desk');
    expect(newDisc('d', NOW).view.stage).toBe('desk');
  });

  it('自訂色彩的預設＝暖陽的 4 色（T-310），但不是同一個陣列（改了不會動到色票表）', () => {
    const card = newCard('standard', 'card-1', NOW);
    expect(card.holo.colors).toEqual([...HOLO_PALETTES.warm]);
    expect(card.holo.colors).not.toBe(HOLO_PALETTES.warm);
  });

  it('比例照傳入的值', () => {
    expect(newCard('tarot', 'card-2', NOW).aspect).toBe('tarot');
  });

  it('兩種比例的新卡都通過驗證', () => {
    expect(validateCard(newCard('standard', 'a', NOW), () => true)).toEqual([]);
    expect(validateCard(newCard('tarot', 'b', NOW), () => true)).toEqual([]);
  });

  it('每次都給新的物件，兩張卡不共用圖層陣列或設定', () => {
    const a = newCard('standard', 'a', NOW);
    const b = newCard('standard', 'b', NOW);
    expect(a.front).not.toBe(b.front);
    expect(a.front.layers).not.toBe(b.front.layers);
    expect(a.back.layers).not.toBe(a.front.layers);
    expect(a.frame).not.toBe(b.frame);
    expect(a.holo).not.toBe(b.holo);
    expect(a.holo.colors).not.toBe(b.holo.colors);
    expect(a.shadow).not.toBe(b.shadow);
    expect(a.view).not.toBe(b.view);
  });
});
