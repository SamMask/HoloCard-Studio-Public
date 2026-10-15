// 介面配色（T-831，DESIGN §5.1「寫實桌面工坊風」）的 CSS 檢查：
// 介面的顏色全部是 :root 的變數（8 個色票 --c-* 加上由它們推出來的半透明、邊線、光暈），規則裡不寫色碼——
// 之後要再換一套配色只改 :root。舞台本身（DESIGN：舞台的樣子不跟介面換）與卡片內容的示意（卡背、鐳射光澤、空白卡的卡身…）
// 照原本的寫死顏色，列在下面的 ALLOWED 清單（每一個都寫為什麼）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

interface Rule {
  selector: string;
  decls: { prop: string; value: string }[];
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
    if (prop) out.push({ prop, value: norm(text.slice(colon + 1)) });
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

/** 很小的 CSS 解析：規則、@media／@container 裡的規則照樣收；@keyframes 的每一格記成「@keyframes 名字」。 */
function parseCss(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const walk = (chunk: string, keyframes: string | null) => {
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
      if (prelude.startsWith('@media') || prelude.startsWith('@container')) walk(inner, keyframes);
      else if (prelude.startsWith('@keyframes')) walk(inner, prelude);
      else if (!prelude.startsWith('@')) {
        for (const selector of keyframes ? [keyframes] : prelude.split(',').map(norm)) rules.push({ selector, decls: declarations(inner) });
      }
      i = j;
    }
  };
  walk(text, null);
  return rules;
}

/** 寫死的顏色：#色碼、rgb()/rgba()/hsl()/hsla()、white／black（url() 裡的不算）。 */
function colorLiterals(value: string): string[] {
  const v = value.replace(/url\([^)]*\)/g, '');
  return v.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![-\w])(?:white|black)(?![-\w])/gi) ?? [];
}

/** 遮罩（mask）只看透明度，裡面的 #000 不是看得到的顏色。 */
const MASK_PROPS = new Set(['mask', '-webkit-mask', 'mask-image', '-webkit-mask-image']);

/** 可以寫死顏色的地方（舞台＝不跟介面換色；卡片內容的示意＝畫的是卡片本身，不是介面）。 */
const ALLOWED: Record<string, string> = {
  // 舞台（DESIGN §5.1：舞台本身的樣子不變）
  '.stage-backdrop::after': '舞台：底圖模糊版的暗角',
  '.stage.is-magic': '舞台：魔法陣的夜空底色',
  '.stage.is-water': '舞台：水鏡的夜空底色',
  '.stage.is-nebula': '舞台：星雲的深空底色',
  '.stage-backdrop.is-custom::after': '舞台：自己的背景圖的暗角',
  '.stage-backdrop.is-hall::after': '舞台：展示廳大廳圖的暗角',
  '.stage.is-water.has-water-mist': '舞台：水鏡的霧（跟著霧色）',
  '.water-scene-frame': '舞台：水鏡遠景縮圖還沒讀好時的夜色（同遠景）',
  ".water-look-preset[data-preset='night'] .water-look-chip": '舞台：〔夜色〕那一組的天色',
  ".water-look-preset[data-preset='mist'] .water-look-chip": '舞台：〔霧白〕那一組的天色',
  '.story-line': '舞台：卡片兩側的直排詩句（目前藏起來）',
  // 卡片內容的示意
  '.lib-sheen': '卡片縮圖上的鐳射光澤',
  '.nc-sample.is-loading::after': '範例卡縮圖載入中的鐳射光澤',
  '.nc-blank': '空白卡的深藍卡身（＝新卡片的預設卡身色）',
  '.frame-style-thumb': '卡框樣式的迷你卡片（卡身＋金框）',
  '.frame-style-corner': '雕花邊角的金屬色',
  '.nc-disc-hole': '光碟中間的透明圈與銀環',
  '.pk-pack-tear': '開一包：撕開線閃一下',
  '.pk-pack-shine-bar': '開一包：卡包上掃過的光',
  '.pk-back': '開一包：卡背（素色卡背的卡身）',
  '.pk-back::after': '開一包：卡背的光澤',
  '.pk-rainbow-bar': '開一包：翻開時掃過卡面的彩虹',
  // 開發用
  '.debug-mark': '開發模式 __holo.mark() 的標點（正式版不會出現）',
};

const rules = parseCss(source);
const root = rules.find((r) => r.selector === ':root');

describe('style.css：介面的顏色都走 :root 的變數（T-831）', () => {
  it(':root 有 DESIGN §5.1 規格板的 8 個色票', () => {
    expect(root, 'style.css 找不到 :root').toBeDefined();
    const vars = new Map(root!.decls.map((d) => [d.prop, d.value.toLowerCase()]));
    expect(Object.fromEntries(['--c-gold-light', '--c-wood', '--c-amber', '--c-cream', '--c-ink', '--c-warm-gray', '--c-wine', '--c-pine'].map((k) => [k, vars.get(k)]))).toEqual({
      '--c-gold-light': '#f6d19b',
      '--c-wood': '#3b2a1f',
      '--c-amber': '#d4a259',
      '--c-cream': '#f8f1e6',
      '--c-ink': '#1b1612',
      '--c-warm-gray': '#7a6f63',
      '--c-wine': '#8c3b3b',
      '--c-pine': '#3e6b56',
    });
  });

  it('規則裡不寫死顏色（舞台與卡片內容的示意除外）', () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      if (rule.selector === ':root' || rule.selector in ALLOWED) continue;
      for (const d of rule.decls) {
        if (MASK_PROPS.has(d.prop)) continue;
        const hits = colorLiterals(d.value);
        if (hits.length > 0) offenders.push(`${rule.selector} { ${d.prop}: ${d.value} }`);
      }
    }
    expect(offenders, `改用 :root 的變數：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('允許清單裡的選擇器都還在（拿掉了就從清單刪掉）', () => {
    const selectors = new Set(rules.map((r) => r.selector));
    expect(Object.keys(ALLOWED).filter((s) => !selectors.has(s))).toEqual([]);
  });

  it('頁面背景是木桌工坊圖（壓暗＋模糊），讀不到時是 :root 的深木棕漸層', () => {
    const before = rules.find((r) => r.selector === 'body::before');
    const get = (r: Rule | undefined, prop: string) => r?.decls.find((d) => d.prop === prop)?.value ?? '';
    expect(get(before, 'background')).toContain('/stages/desk.webp');
    expect(get(before, 'filter')).toMatch(/blur\(/);
    expect(get(before, 'filter')).toMatch(/brightness\(0?\.\d+\)/);
    expect(get(before, 'position')).toBe('fixed');
    expect(get(before, 'z-index')).toBe('-1');
    const htmlBg = rules.filter((r) => r.selector === 'html').map((r) => get(r, 'background')).filter(Boolean);
    expect(htmlBg).toEqual(['var(--page-fallback)']);
  });

  it('工作桌的木桌（T-832c）：圖上面疊一層檯燈燈泡的柔和暗斑（墨色色票、徑向漸層、在圖的下面那層之上）；頁面背景不疊', () => {
    const get = (selector: string) => rules.find((r) => r.selector === selector)?.decls.find((d) => d.prop === 'background')?.value ?? '';
    const desk = get('.stage-backdrop.is-desk::before');
    const gradientAt = desk.indexOf('radial-gradient(');
    const imageAt = desk.indexOf('/stages/desk.webp');
    expect(gradientAt, '木桌那層少了檯燈暗斑的徑向漸層').toBeGreaterThanOrEqual(0);
    expect(imageAt).toBeGreaterThan(gradientAt);
    const gradient = desk.slice(gradientAt, desk.indexOf('url(', gradientAt));
    expect(gradient).toContain('var(--c-ink)');
    expect(colorLiterals(gradient)).toEqual([]);
    // 頁面背景（body::before）不動：還是單純的圖，沒有暗斑
    expect(get('body::before')).not.toContain('radial-gradient');
  });

  it('背景模糊（backdrop-filter）只用在面板、提示列與蓋住整頁的遮罩，不用在會蓋到 3D 預覽的大片面板', () => {
    const used = rules.filter((r) => r.decls.some((d) => d.prop === 'backdrop-filter' || d.prop === '-webkit-backdrop-filter')).map((r) => r.selector);
    expect(used.sort()).toEqual(['.away-overlay', '.hint-pill', '.nc-overlay', '.panel', '.showcase-btn', '.topbar'].sort());
  });
});
