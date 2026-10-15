// T-804 卡片故事（SCHEMA §1 Card.story?、§1.1 驗證）：cleanStory 清理規則、updateCard 的 story（null／空字串＝拿掉）、
// 驗證（照 SCHEMA，不合格報錯）、可省略（舊卡照讀）、寫出前整理（omitCardDefaults 拿掉空的）、JSON 來回。
import { describe, expect, it } from 'vitest';
import { cleanStory, DEFAULT_STORY_FONT, omitCardDefaults, updateCard } from '../../src/model/actions';
import { newCard } from '../../src/model/create';
import { STORY_MAX } from '../../src/model/limits';
import type { Card } from '../../src/model/types';
import { validateCard } from '../../src/model/validate';
import { anyImage, deepFreeze, NOW } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const blank = (): Card => newCard('standard', 'c1', NOW);
const withStory = (text: string, font: Raw = 'wenkai'): Card => ({ ...blank(), story: { text, font } });

function paths(value: unknown): string[] {
  return validateCard(value, anyImage).map((e) => e.split('：')[0]!);
}

describe('cleanStory：清理規則', () => {
  it('去前後空白', () => {
    expect(cleanStory('  一輪明月照星海  ')).toBe('一輪明月照星海');
    expect(cleanStory('\n\t一輪明月\n')).toBe('一輪明月');
  });

  it('每行去頭尾空白；兩行用 \\n 連起來', () => {
    expect(cleanStory('  一輪明月照星海  \n   龍鱗映出遠古的光 ')).toBe('一輪明月照星海\n龍鱗映出遠古的光');
  });

  it('超過 2 行只留前 2 行', () => {
    expect(cleanStory('一\n二\n三\n四')).toBe('一\n二');
  });

  it('\\r\\n、\\r 也算換行（貼上來的字），存成 \\n', () => {
    expect(cleanStory('一輪明月\r\n龍鱗\r\n第三行')).toBe('一輪明月\n龍鱗');
    expect(cleanStory('一輪明月\r龍鱗')).toBe('一輪明月\n龍鱗');
  });

  it('只有空白的行不算一行（中間空一行的兩句還是兩行）', () => {
    expect(cleanStory('一輪明月\n\n   \n龍鱗')).toBe('一輪明月\n龍鱗');
    expect(cleanStory('一輪明月\n   ')).toBe('一輪明月');
  });

  it('超過 60 字截掉（含換行算 1 字；以 Unicode 字元計，表情符號算一個）', () => {
    expect(STORY_MAX).toBe(60);
    expect(cleanStory('星'.repeat(80))).toBe('星'.repeat(60));
    // 第一行 59 字＋換行＝60：第二行整個截掉，結尾的換行也不留
    expect(cleanStory(`${'星'.repeat(59)}\n月光`)).toBe('星'.repeat(59));
    // 第一行 58 字＋換行＋第二行只留 1 字
    expect(cleanStory(`${'星'.repeat(58)}\n月光`)).toBe(`${'星'.repeat(58)}\n月`);
    const emoji = cleanStory('🌙'.repeat(70))!;
    expect(Array.from(emoji)).toHaveLength(60);
  });

  it('截完結尾是空白就拿掉', () => {
    expect(cleanStory(`${'星'.repeat(57)}\n月 光`)).toBe(`${'星'.repeat(57)}\n月`);
  });

  it('空的、只有空白、不是文字 → null', () => {
    for (const v of ['', '   ', '\n\n', ' \r\n ', null, undefined, 12, {}, ['一']]) expect(cleanStory(v)).toBeNull();
  });

  it('很長的貼上（幾十萬字）也很快處理完', () => {
    const huge = `${'\n'.repeat(200_000)}一輪明月${'星'.repeat(300_000)}\n${' '.repeat(100_000)}龍鱗`;
    const t0 = performance.now();
    const out = cleanStory(huge)!;
    expect(performance.now() - t0).toBeLessThan(500);
    expect(Array.from(out)).toHaveLength(60);
    expect(out.startsWith('一輪明月')).toBe(true);
  });
});

describe('updateCard：story', () => {
  it('新卡沒有故事（欄位不存在）', () => {
    expect('story' in blank()).toBe(false);
  });

  it('寫故事：文字照 cleanStory 整理、字型照給的；沒給字型用文楷', () => {
    const card = deepFreeze(blank());
    const a = updateCard(card, { story: { text: '  一輪明月照星海 \n 龍鱗映出遠古的光  \n第三行', font: 'huninn' } });
    expect(a.story).toEqual({ text: '一輪明月照星海\n龍鱗映出遠古的光', font: 'huninn' });
    expect(validateCard(a, anyImage)).toEqual([]);
    const b = updateCard(card, { story: { text: '一輪明月' } });
    expect(b.story).toEqual({ text: '一輪明月', font: DEFAULT_STORY_FONT });
    expect(DEFAULT_STORY_FONT).toBe('wenkai');
  });

  it('只改字型：有故事才改；沒有故事時不改（回原卡）', () => {
    const card = deepFreeze(withStory('一輪明月'));
    expect(updateCard(card, { story: { font: 'iansui' } }).story).toEqual({ text: '一輪明月', font: 'iansui' });
    const none = deepFreeze(blank());
    expect(updateCard(none, { story: { font: 'iansui' } })).toBe(none);
  });

  it('給 null、空字串、只有空白 → 拿掉欄位（不留 undefined）', () => {
    const card = deepFreeze(withStory('一輪明月'));
    for (const story of [null, { text: '' }, { text: '   \n  ' }, { text: '', font: 'huninn' as const }]) {
      const next = updateCard(card, { story });
      expect('story' in next, JSON.stringify(story)).toBe(false);
      expect(validateCard(next, anyImage)).toEqual([]);
    }
  });

  it('沒有故事時給 null 或空字串 → 回原卡（同一個物件）', () => {
    const card = deepFreeze(blank());
    expect(updateCard(card, { story: null })).toBe(card);
    expect(updateCard(card, { story: { text: '  ' } })).toBe(card);
  });

  it('整理後和現在一樣 → 回原卡（同一個物件）；故事物件也沿用', () => {
    const card = deepFreeze(withStory('一輪明月\n龍鱗', 'huninn'));
    expect(updateCard(card, { story: { text: ' 一輪明月 \n龍鱗\n' } })).toBe(card);
    expect(updateCard(card, { story: { text: '一輪明月\n龍鱗', font: 'huninn' } })).toBe(card);
    const renamed = updateCard(card, { name: '星晶龍' });
    expect(renamed.story).toBe(card.story);
  });

  it('不合格的值忽略：文字不是字串、字型不認得、story 不是物件', () => {
    const card = deepFreeze(withStory('一輪明月'));
    expect(updateCard(card, { story: { text: 12 as never } })).toBe(card);
    expect(updateCard(card, { story: { font: 'comic' as never } })).toBe(card);
    expect(updateCard(card, { story: '一輪明月' as never })).toBe(card);
    // 文字合格、字型不認得：只換文字，字型照舊
    expect(updateCard(card, { story: { text: '龍鱗', font: 'comic' as never } }).story).toEqual({ text: '龍鱗', font: 'wenkai' });
  });

  it('和其他欄位一起改：一次全部套用', () => {
    const next = updateCard(blank(), { name: '星晶龍', story: { text: '一輪明月' }, view: { stage: 'gallery' } });
    expect(next).toMatchObject({ name: '星晶龍', story: { text: '一輪明月', font: 'wenkai' }, view: { stage: 'gallery' } });
  });
});

describe('validateCard：story（SCHEMA §1.1）', () => {
  it('舊卡（沒有 story）照樣合格', () => {
    expect(validateCard(blank(), anyImage)).toEqual([]);
  });

  it.each(['wenkai', 'huninn', 'iansui', 'notoserif'])('字型 %s 合格；一行、兩行、剛好 60 字都合格', (font) => {
    for (const text of ['一輪明月', '一輪明月照星海\n龍鱗映出遠古的光', '星'.repeat(60), `${'星'.repeat(30)}\n${'月'.repeat(29)}`]) {
      expect(validateCard(withStory(text, font), anyImage), text).toEqual([]);
    }
  });

  it('文字：空的、只有空白、超過 60 字、三行、不是字串 → 只錯在 story.text', () => {
    for (const text of ['', '   ', '\n', '星'.repeat(61), '一\n二\n三', '一\r\n二\r\n三', '一\r二\n三', 12, null, ['一']]) {
      expect(paths(withStory(text as string)), JSON.stringify(text)).toEqual(['story.text']);
    }
  });

  it('字型不認得或不是字串 → 只錯在 story.font', () => {
    for (const font of ['comic', '', 1, null]) expect(paths(withStory('一輪明月', font))).toEqual(['story.font']);
  });

  it('story 不是物件、少欄位、多欄位 → 報錯', () => {
    for (const story of [null, '一輪明月', ['一輪明月'], 1, true]) {
      const c: Raw = { ...blank(), story };
      expect(paths(c), JSON.stringify(story)).toEqual(['story']);
    }
    expect(paths({ ...blank(), story: { text: '一輪明月' } })).toEqual(['story.font']);
    expect(paths({ ...blank(), story: { font: 'wenkai' } })).toEqual(['story.text']);
    expect(paths({ ...blank(), story: { text: '一輪明月', font: 'wenkai', color: '#fff' } })).toEqual(['story.color']);
  });

  it('JSON 來回（存檔、卡片檔的格式）仍合格、欄位不變', () => {
    const back = JSON.parse(JSON.stringify(withStory('一輪明月照星海\n龍鱗映出遠古的光', 'notoserif')));
    expect(validateCard(back, anyImage)).toEqual([]);
    expect(back.story).toEqual({ text: '一輪明月照星海\n龍鱗映出遠古的光', font: 'notoserif' });
  });
});

describe('omitCardDefaults：story', () => {
  it('有故事 → 原樣（同一個物件）', () => {
    const card = deepFreeze(withStory('一輪明月'));
    expect(omitCardDefaults(card)).toBe(card);
  });

  it('story 欄位在但是空的（undefined、只有空白）→ 拿掉欄位，其他不動', () => {
    for (const story of [undefined, { text: '  ', font: 'wenkai' }, { text: '', font: 'wenkai' }]) {
      const card = deepFreeze({ ...blank(), story } as Raw as Card);
      const out = omitCardDefaults(card);
      expect('story' in out, JSON.stringify(story)).toBe(false);
      expect(out).toEqual(blank());
    }
  });
});
