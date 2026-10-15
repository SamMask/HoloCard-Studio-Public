import { describe, expect, it } from 'vitest';
import type { ImportError } from '../src/file/types';
import { dropKind, importErrorText, saveStatusText, STORAGE_LOW_TEXT } from '../src/ui/logic';

describe('匯入失敗的白話訊息（DESIGN 7.5 的三句）', () => {
  const NOT_CARD = '這個檔案不是卡片檔。';
  const BROKEN = '這個卡片檔壞掉了，沒有匯入。';
  const NEWER = '這張卡是用較新的版本做的，請更新工坊後再開。';

  it('較新版本 → 請更新工坊', () => {
    expect(importErrorText('newer-version')).toBe(NEWER);
  });

  it('不是 zip、路徑不對、沒有 card.json → 不是卡片檔', () => {
    expect(importErrorText('bad-zip')).toBe(NOT_CARD);
    expect(importErrorText('bad-path')).toBe(NOT_CARD);
    expect(importErrorText('missing-card')).toBe(NOT_CARD);
  });

  it('太大、卡片資料不合格、缺圖、圖壞掉 → 卡片檔壞掉了', () => {
    expect(importErrorText('too-large')).toBe(BROKEN);
    expect(importErrorText('invalid-card')).toBe(BROKEN);
    expect(importErrorText('missing-image')).toBe(BROKEN);
    expect(importErrorText('bad-image')).toBe(BROKEN);
  });

  it('每一種原因都有對應的句子，而且只會是那三句之一', () => {
    const all: ImportError[] = ['too-large', 'bad-zip', 'bad-path', 'missing-card', 'newer-version', 'invalid-card', 'missing-image', 'bad-image'];
    for (const reason of all) expect([NOT_CARD, BROKEN, NEWER]).toContain(importErrorText(reason));
  });

  it('不認得的原因（程式出錯）→ 卡片檔壞掉了', () => {
    expect(importErrorText('something-else' as ImportError)).toBe(BROKEN);
  });
});

describe('存檔狀態小字（DESIGN 7.1）', () => {
  it('已儲存／儲存中…／沒存到', () => {
    expect(saveStatusText('saved')).toBe('已儲存');
    expect(saveStatusText('saving')).toBe('儲存中…');
    expect(saveStatusText('error')).toBe('沒存到');
  });

  it('空間快滿的提示照 DESIGN 7.2 原文', () => {
    expect(STORAGE_LOW_TEXT).toBe('儲存空間快滿了，建議先把卡片匯出備份。');
  });
});

describe('拖檔進來時的提示：卡片檔還是圖片', () => {
  it('每個檔都沒有類型（.holocard 系統不認得）→ 卡片檔', () => {
    expect(dropKind(['', ''])).toBe('card-file');
  });

  it('有圖片 → 圖片', () => {
    expect(dropKind(['image/png'])).toBe('images');
    expect(dropKind(['image/png', ''])).toBe('images');
  });

  it('沒有檔案資訊（某些瀏覽器拖曳中拿不到）→ 圖片（照原本的提示）', () => {
    expect(dropKind([])).toBe('images');
  });
});
