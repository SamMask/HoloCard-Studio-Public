// 減少動態效果（T-608，DESIGN §8.3）的 CSS 檢查：style.css 裡每個有動畫（animation）或「會動」的轉場（transition 到
// transform、opacity、位置、大小……）的選擇器，都要在某個 @media (prefers-reduced-motion: reduce) 區塊裡用同一個選擇器關掉
// （animation: none／transition: none），而且關掉的規則排在原本的規則後面（或用 !important），才蓋得過去。
// 之後新增面板、選單、提示的動畫卻忘了關，這個測試會失敗並列出選擇器。只改顏色、陰影的轉場不算「會動」。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Rule {
  selectors: string[];
  decls: { prop: string; value: string; important: boolean }[];
  /** 外層 @media 的條件（沒有＝null）。 */
  media: string | null;
  /** 在檔案裡的先後（越大越後面）。 */
  order: number;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 用分號切宣告（括號裡的不切）。 */
function declarations(body: string): Rule['decls'] {
  const out: Rule['decls'] = [];
  let depth = 0;
  let start = 0;
  const push = (text: string) => {
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const prop = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    const important = /!important\s*$/i.test(value);
    value = value.replace(/!important\s*$/i, '').trim();
    if (prop) out.push({ prop, value, important });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return out;
}

/** 很小的 CSS 解析：只認規則、@media、@container（裡面的規則照樣收），@keyframes 等其他 @ 規則略過。 */
function parseCss(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let order = 0;
  const walk = (chunk: string, media: string | null) => {
    let i = 0;
    while (i < chunk.length) {
      const open = chunk.indexOf('{', i);
      if (open < 0) return;
      const prelude = norm(chunk.slice(i, open));
      let depth = 1;
      let j = open + 1;
      for (; j < chunk.length && depth > 0; j++) {
        if (chunk[j] === '{') depth++;
        else if (chunk[j] === '}') depth--;
      }
      const inner = chunk.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(inner, prelude);
      else if (prelude.startsWith('@container')) walk(inner, media);
      else if (!prelude.startsWith('@')) {
        rules.push({ selectors: prelude.split(',').map(norm), decls: declarations(inner), media, order: order++ });
      }
      i = j;
    }
  };
  walk(text, null);
  return rules;
}

const isReducedBlock = (media: string | null) => media !== null && /prefers-reduced-motion\s*:\s*reduce/.test(media);

/** 「會動」的屬性：位置、大小、變形、透明度（淡入淡出）、背景位置（光澤滑動）、all。 */
const MOVING = /^(all|transform|translate|rotate|scale|opacity|left|top|right|bottom|inset(-.*)?|(min-|max-)?(width|height)|r|cx|cy|background-position(-.*)?|margin(-.*)?)$/;
const TIME = /^-?[\d.]+m?s$/;
const EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\)|linear\(.*\)|allow-discrete|normal)$/;

/** 用逗號切（括號裡的不切）。 */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map(norm);
}

/** transition 簡寫或 transition-property 裡轉場的屬性（沒寫屬性＝all）。 */
function transitionProps(prop: string, value: string): string[] {
  if (norm(value) === 'none') return [];
  if (prop === 'transition-property') return splitTop(value);
  return splitTop(value).map((item) => {
    const tokens = item.match(/[^\s()]+(\([^)]*\))?/g) ?? [];
    return tokens.find((t) => !TIME.test(t) && !EASING.test(t)) ?? 'all';
  });
}

interface Moving {
  selector: string;
  kind: 'animation' | 'transition';
  order: number;
}

/** 減少動態區塊外，有動畫或會動的轉場的選擇器。 */
function movingSelectors(rules: Rule[]): Moving[] {
  const out: Moving[] = [];
  for (const rule of rules) {
    if (isReducedBlock(rule.media)) continue;
    for (const d of rule.decls) {
      const animated = (d.prop === 'animation' || d.prop === 'animation-name') && norm(d.value) !== 'none';
      const moves =
        (d.prop === 'transition' || d.prop === 'transition-property') && transitionProps(d.prop, d.value).some((p) => MOVING.test(p));
      if (!animated && !moves) continue;
      for (const selector of rule.selectors) out.push({ selector, kind: animated ? 'animation' : 'transition', order: rule.order });
    }
  }
  return out;
}

/** 減少動態區塊裡，這個選擇器有沒有被關掉（同一個選擇器、排在後面或 !important）。 */
function isTurnedOff(rules: Rule[], m: Moving): boolean {
  return rules.some(
    (rule) =>
      isReducedBlock(rule.media) &&
      rule.selectors.includes(m.selector) &&
      rule.decls.some((d) => {
        const off =
          m.kind === 'animation'
            ? (d.prop === 'animation' || d.prop === 'animation-name') && norm(d.value) === 'none'
            : ((d.prop === 'transition' || d.prop === 'transition-property') && norm(d.value) === 'none') ||
              (d.prop === 'transition-duration' && /^0m?s$/.test(norm(d.value)));
        return off && (rule.order > m.order || d.important);
      }),
  );
}

function uncovered(source: string): string[] {
  const rules = parseCss(source);
  const missing = movingSelectors(rules).filter((m) => !isTurnedOff(rules, m));
  return [...new Set(missing.map((m) => `${m.selector}（${m.kind}）`))];
}

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

describe('style.css：每個會動的地方在減少動態效果時都關掉', () => {
  it('沒有漏掉的（列出來的選擇器要加進某個 @media (prefers-reduced-motion: reduce) 區塊）', () => {
    expect(uncovered(css)).toEqual([]);
  });

  it('解析有抓到東西：面板、選單、導覽、提示、縮圖傾斜、確認框都在「會動」的清單裡', () => {
    const found = new Set(movingSelectors(parseCss(css)).map((m) => m.selector));
    for (const s of [
      '.confirm',
      '.lib-panel',
      '.nc-panel',
      '.lib-overlay',
      '.lib-confirm-back',
      '.lib-toast',
      '.lib-art',
      '.nc-art',
      '.help-panel',
      '.tour-card',
      '.tour-ring',
      '.export-box',
      '.ai-progress',
      '.away-box',
      '.stage-poster',
    ]) {
      expect(found.has(s), s).toBe(true);
    }
    expect(found.size).toBeGreaterThan(25);
  });

  it('只改顏色、陰影的轉場不算會動（按鈕 hover 不用關）', () => {
    const found = new Set(movingSelectors(parseCss(css)).map((m) => m.selector));
    expect(found.has('.btn')).toBe(false);
    expect(found.has('.layer-row')).toBe(false);
  });
});

describe('檢查本身（之後新增卻漏掉的抓得到）', () => {
  const reduced = (body: string) => `@media (prefers-reduced-motion: reduce) {\n${body}\n}`;

  it('新增一個滑入的面板、沒關 → 抓到', () => {
    const src = `.new-panel { animation: rise 0.2s ease-out; }\n${reduced('.other { animation: none; }')}`;
    expect(uncovered(src)).toEqual(['.new-panel（animation）']);
  });

  it('新增淡入（opacity 轉場）、會動的 transform 轉場、沒寫屬性的轉場（＝all）→ 都抓到；只改顏色的不抓', () => {
    const src = [
      '.a { transition: opacity 0.3s ease; }',
      '.b { transition: background 0.15s, transform 0.2s; }',
      '.c { transition: 0.2s; }',
      '.d { transition: background 0.15s, border-color 0.15s, box-shadow 0.15s; }',
      '.e { transition-property: left, top; transition-duration: 0.25s; }',
    ].join('\n');
    expect(uncovered(src)).toEqual(['.a（transition）', '.b（transition）', '.c（transition）', '.e（transition）']);
  });

  it('在減少動態區塊用同一個選擇器關掉、排在後面 → 算有關；排在前面（蓋不過）→ 還是抓到，除非 !important', () => {
    expect(uncovered(`.a, .b { animation: rise 1s; }\n${reduced('.a,\n.b { animation: none; }')}`)).toEqual([]);
    expect(uncovered(`${reduced('.a { transition: none; }')}\n.a { transition: opacity 1s; }`)).toEqual(['.a（transition）']);
    expect(uncovered(`${reduced('.a { transition: none !important; }')}\n.a { transition: opacity 1s; }`)).toEqual([]);
  });

  it('別的 @media（例如窄螢幕）不算減少動態；只關 transition 不能抵 animation', () => {
    expect(uncovered(`.a { animation: rise 1s; }\n@media (max-width: 900px) { .a { animation: none; } }`)).toEqual(['.a（animation）']);
    expect(uncovered(`.a { animation: rise 1s; }\n${reduced('.a { transition: none; }')}`)).toEqual(['.a（animation）']);
  });
});
