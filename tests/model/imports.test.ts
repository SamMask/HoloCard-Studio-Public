import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ARCHITECTURE：model 是純 TS，不准碰 DOM、three.js、IndexedDB 或其他 src 模組。
const dir = fileURLToPath(new URL('../../src/model/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

function specifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

describe('model 的依賴', () => {
  it('有程式檔可以檢查', () => {
    expect(files).toEqual(expect.arrayContaining(['types.ts', 'create.ts', 'validate.ts', 'actions.ts', 'history.ts']));
  });

  it.each(files)('%s 只 import model 自己的檔案', (file) => {
    const source = readFileSync(dir + file, 'utf8');
    for (const spec of specifiers(source)) {
      expect(spec.startsWith('./') && !spec.includes('..') && !spec.slice(2).includes('/')).toBe(true);
    }
  });

  it.each(files)('%s 不使用瀏覽器全域物件', (file) => {
    const code = readFileSync(dir + file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(document|window|indexedDB|localStorage|navigator|HTMLElement|fetch)\b/);
  });
});
