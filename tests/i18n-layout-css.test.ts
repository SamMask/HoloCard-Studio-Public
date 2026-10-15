// 四種語言的版面（T-828e，DESIGN §9：任何語言都不准把字截掉、擠出框外、蓋住卡片；按鈕可以換行或變寬，面板可以變高）的 CSS 檢查。
// 英日韓的字比中文長：這些地方原本用「…」截字或硬排一行，T-828e 改成放不下就換行／變高；之後誰又把它們改回截字，這裡會失敗。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 選擇器（逗號分開的其中一個，完全相同）對到的所有宣告（含 @media 裡的），後面的蓋前面的。 */
function decls(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map(norm);
    if (!selectors.includes(selector)) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out.set(d.slice(0, i).trim(), norm(d.slice(i + 1)));
    }
  }
  return out;
}

describe('style.css：長的介面字不截掉（T-828e）', () => {
  it.each(['.palette-name', '.card-style-name', '.water-scene-name', '.pk-name', '.layer-sub', '.layer-look'])(
    '%s 放不下就換行，不用「…」也不硬排一行',
    (selector) => {
      const d = decls(selector);
      expect(d.size, `style.css 找不到 ${selector}`).toBeGreaterThan(0);
      expect(d.get('text-overflow')).not.toBe('ellipsis');
      expect(d.get('white-space')).not.toBe('nowrap');
    },
  );

  it('整個工坊的欄寬固定成視窗寬：頁首放不下時卡名變「…」，不會把頁面撐得比視窗寬、右欄被推出畫面', () => {
    expect(decls('.app').get('grid-template-columns')).toBe('minmax(0, 1fr)');
  });

  it('右欄「比例」在英日韓排成三欄、按鈕可以變高（中文照舊五欄、固定 58px）', () => {
    expect(decls('.aspect-picker').get('grid-template-columns')).toBe('repeat(5, minmax(0, 1fr))');
    expect(decls('.aspect-opt').get('height')).toBe('58px');
    for (const lang of ['en', 'ja', 'ko']) {
      expect(decls(`html:lang(${lang}) .aspect-picker`).get('grid-template-columns')).toBe('repeat(3, minmax(0, 1fr))');
      expect(decls(`html:lang(${lang}) .aspect-opt`).get('height')).toBe('auto');
    }
  });

  it('動態特效四格：字比較長的那格至少放得下整個字', () => {
    expect(decls('.segmented.fx-list').get('grid-template-columns')).toBe('repeat(4, minmax(min-content, 1fr))');
  });

  it('影片選項的長度按鈕放不下時可以變兩行（不再固定 24px 高）', () => {
    const d = decls('.seg-btn.vo-len');
    expect(d.get('height')).toBe('auto');
    expect(d.get('flex-wrap')).toBe('wrap');
  });

  it('進階效果標題與開啟數量可以換行，不截字（T-840）', () => {
    const d = decls('.layer-advanced .section-toggle-text');
    expect(d.get('flex-wrap')).toBe('wrap');
    expect(d.get('overflow-wrap')).toBe('anywhere');
    expect(d.get('min-width')).toBe('0');
    expect(d.get('text-overflow')).not.toBe('ellipsis');
    expect(d.get('white-space')).not.toBe('nowrap');
  });
});
