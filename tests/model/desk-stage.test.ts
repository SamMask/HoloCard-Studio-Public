// 舞台第七種「工作桌」（T-832，SCHEMA view.stage 多 'desk'，照 T-415 加舞台的先例不升 formatVersion）：
// 卡片資料接受 'desk'（驗證、改舞台一步、匯入的卡），其他不認得的值照舊擋掉。
import { describe, expect, it } from 'vitest';
import { updateCard } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { STAGE_STYLES } from '../../src/model/limits';
import { validateCard } from '../../src/model/validate';
import { anyImage } from './helpers';

const T0 = '2026-10-15T00:00:00.000Z';

describe('view.stage 多一種工作桌（desk）', () => {
  it('舞台清單有 desk（關閉照舊在最後）', () => {
    expect(STAGE_STYLES).toContain('desk');
    expect(STAGE_STYLES.at(-1)).toBe('none');
  });

  it('驗證：desk 合格；不認得的值照舊不合格', () => {
    const card = newCard('standard', 'c1', T0);
    expect(validateCard({ ...card, view: { ...card.view, stage: 'desk' } }, anyImage)).toEqual([]);
    expect(validateCard({ ...card, view: { ...card.view, stage: 'desks' } }, anyImage).map((e) => e.split('：')[0])).toEqual(['view.stage']);
  });

  it('改舞台：換成 desk、再換回 halo；formatVersion 不變', () => {
    const card = newCard('standard', 'c1', T0);
    const desk = updateCard(card, { view: { stage: 'desk' } });
    expect(desk.view.stage).toBe('desk');
    expect(desk.formatVersion).toBe(card.formatVersion);
    expect(updateCard(desk, { view: { stage: 'halo' } }).view.stage).toBe('halo');
  });
});
