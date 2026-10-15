import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { zhHant } from '../src/i18n/zh-Hant';

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff65-\uff9f]/u;
const languageNames = new Set(['繁體中文', 'English', '日本語', '한국어']);

function leaves(value: unknown, path = ''): [string, unknown][] {
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [[path, value]];
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)]));
  }
  return typeof value;
}

// 按鈕、分頁、選項（T-828f）：介面窄，英文盡量 ≤ 14 個字元。
const SHORT_LABELS = [
  'header.library', 'header.newCard', 'header.backup', 'header.export', 'header.undo', 'header.redo',
  'layers.upload', 'layers.addText', 'layers.front', 'layers.back',
  'style.plain', 'style.silver', 'style.rainbow', 'style.gold', 'style.galaxy', 'style.matte',
  'aspect.standard', 'aspect.tarot', 'aspect.square', 'aspect.postcard', 'aspect.custom', 'aspect.disc',
  'stage.halo', 'stage.gallery', 'stage.magic', 'stage.water', 'stage.nebula', 'stage.none',
  'blend.normal', 'blend.multiply', 'blend.screen', 'blend.add', 'blend.overlay', 'blend.softLight', 'blend.color',
  'foil.shapeFull', 'foil.shapeLayers', 'foil.shapeMask', 'foil.shapeMaskShort',
  'fx.none', 'fx.fire', 'fx.electric', 'fx.water',
  'text.plain', 'text.outline', 'text.seal', 'text.left', 'text.center', 'text.right', 'text.top', 'text.bottom',
  'export.motionTurn', 'export.motionSwing', 'export.gifSmall', 'export.gifMedium', 'export.gifLarge', 'export.stageRecord',
  'card.frameSimple', 'card.frameOrnate', 'inspector.center', 'inspector.fill',
];

const englishLeaves = leaves(en);
const sourceLeaves = new Map(leaves(zhHant));
const functions = englishLeaves.filter((entry): entry is [string, (...args: unknown[]) => unknown] => typeof entry[1] === 'function');

describe('English dictionary', () => {
  it('matches every source key, value type and array length recursively', () => {
    expect(shape(en)).toEqual(shape(zhHant));
  });

  it('keeps the same number of function parameters', () => {
    for (const [path, fn] of functions) {
      const source = sourceLeaves.get(path);
      expect(typeof source, path).toBe('function');
      expect(fn.length, path).toBe((source as (...args: unknown[]) => unknown).length);
    }
  });

  it('has no empty strings', () => {
    for (const [path, value] of englishLeaves) {
      if (typeof value === 'string') expect(value.trim(), path).not.toBe('');
    }
  });

  it('has no Chinese, Japanese or Korean text except language names in the language group', () => {
    for (const [path, value] of englishLeaves) {
      if (typeof value !== 'string') continue;
      if (path.startsWith('lang.') && languageNames.has(value)) continue;
      expect(value, path).not.toMatch(cjk);
    }
  });

  it('returns nonempty English text from every function, including singular and plural counts', () => {
    for (const [path, fn] of functions) {
      for (const count of [0, 1, 2]) {
        const value = fn(...Array.from({ length: fn.length }, () => count));
        expect(typeof value, path).toBe('string');
        expect((value as string).trim(), path).not.toBe('');
        expect(value, path).not.toMatch(cjk);
      }
    }
  });

  it('names download-ai-models.bat in the AI model note (T-828f)', () => {
    expect(en.ai.modelMissingNote).toContain('download-ai-models.bat');
  });

  it('keeps buttons, tabs and options at 14 characters or fewer (T-828f)', () => {
    for (const path of SHORT_LABELS) {
      const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], en);
      expect(typeof value, path).toBe('string');
      expect((value as string).length, `${path}: ${String(value)}`).toBeLessThanOrEqual(14);
    }
  });

  it('uses every parameter rather than replacing it with fixed text', () => {
    for (const [path, fn] of functions) {
      const args = Array.from({ length: fn.length }, (_, index) => `ARG_${index}_VALUE`);
      const value = fn(...args);
      for (const arg of args) expect(value, path).toContain(arg);
    }
  });
});
