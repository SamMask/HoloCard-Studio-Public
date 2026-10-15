import { describe, expect, it } from 'vitest';
import { ja } from '../src/i18n/ja';
import { zhHant } from '../src/i18n/zh-Hant';

function shape(value: unknown): unknown {
  if (typeof value === 'function') return `function/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)]));
  }
  return typeof value;
}

const args = ['PARAM_A', 'PARAM_B', 'PARAM_C'];
function strings(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'string') return { [path]: value };
  if (typeof value === 'function') {
    return { [path]: (value as (...values: string[]) => string)(...args.slice(0, value.length)) };
  }
  if (value && typeof value === 'object') {
    return Object.assign({}, ...Object.entries(value).map(([key, child]) => strings(child, path ? `${path}.${key}` : key)));
  }
  return {};
}

// 按鈕、分頁、選項（T-828f）：介面窄，日文盡量 ≤ 8 字。
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

const original = strings(zhHant);
const translated = strings(ja);
const entries = Object.entries(translated);

describe('T-828c Japanese dictionary', () => {
  it('preserves keys, value types, array lengths and function arity', () => {
    expect(shape(ja)).toEqual(shape(zhHant));
  });

  it('has no empty strings, including function results', () => {
    expect(entries.filter(([, value]) => !value.trim())).toEqual([]);
  });

  it('uses every function parameter', () => {
    for (const [path, value] of entries) {
      for (const arg of args.filter((item) => original[path]?.includes(item))) {
        expect(value, `${path}: missing ${arg}`).toContain(arg);
      }
    }
  });

  it('preserves all numeric values', () => {
    for (const [path, value] of entries) {
      const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).sort();
      expect(numbers(value), path).toEqual(numbers(original[path] ?? ''));
    }
  });

  it('has kana in at least 80% of text (except symbols, numbers and official font names)', () => {
    const eligible = entries.filter(([path, value]) =>
      !/^fonts\.[a-z]+Name$/.test(path) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value),
    );
    const kana = eligible.filter(([, value]) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value));
    expect(kana.length / eligible.length).toBeGreaterThanOrEqual(0.8);
  });

  it('does not retain Chinese-only traditional characters', () => {
    expect(entries.filter(([, value]) => /[這們說畫圖裡還會讓與從對號檔點]/u.test(value))).toEqual([]);
  });

  it('names download-ai-models.bat in the AI model note (T-828f)', () => {
    expect(ja.ai.modelMissingNote).toContain('download-ai-models.bat');
  });

  it('keeps buttons, tabs and options at 8 characters or fewer (T-828f)', () => {
    for (const path of SHORT_LABELS) {
      const value = translated[path];
      expect(typeof value, path).toBe('string');
      expect([...value!].length, `${path}: ${value}`).toBeLessThanOrEqual(8);
    }
  });

  it('quotes the same button names used by the controls', () => {
    const buttons: Record<string, string> = {
      '我的卡片': ja.header.library,
      '匯出備份': ja.header.backup,
      '匯出 ▾': `${ja.header.export} ▾`,
      '上傳圖片': ja.layers.upload,
      '展示': ja.preview.showcase,
      '光碟': ja.aspect.disc,
      '加上變身圖': ja.alt.add,
      '加文字': ja.layers.addText,
      '匯入卡片檔…': ja.header.importCard,
      '換成我的圖…': ja.stage.backdropAdd,
      '縮小': ja.preview.zoomOut,
      '放大': ja.preview.zoomIn,
      '全螢幕': ja.preview.fullscreen,
    };
    for (const [path, source] of Object.entries(original)) {
      for (const match of source.matchAll(/〔([^〕]+)〕/g)) {
        const button = buttons[match[1]!];
        expect(button, `${path}: unmapped button`).toBeDefined();
        expect(translated[path], path).toContain(`「${button}」`);
      }
    }
  });
});
