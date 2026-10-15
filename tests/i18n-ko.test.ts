import { describe, expect, it } from 'vitest';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';

type Entry = { path: string; value: string };

// Render parameterized messages too, using distinct markers to detect dropped arguments.
function messages(value: unknown, path = '', result: Entry[] = []): Entry[] {
  if (typeof value === 'string') result.push({ path, value });
  else if (typeof value === 'function') {
    const args = Array.from({ length: value.length }, (_, i) => `__arg_${i}__`);
    const rendered: unknown = Reflect.apply(value, undefined, args);
    expect(typeof rendered, path).toBe('string');
    for (const arg of args) expect(rendered, `${path}: ${arg}`).toContain(arg);
    result.push({ path, value: String(rendered) });
  } else if (Array.isArray(value)) value.forEach((item, i) => messages(item, `${path}[${i}]`, result));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) messages(item, path ? `${path}.${key}` : key, result);
  }
  return result;
}

function shape(value: unknown): unknown {
  if (typeof value === 'function') return `function/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
  return typeof value;
}

// 按鈕、分頁、選項（T-828f）：介面窄，韓文盡量 ≤ 8 字（不算空格）。
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

describe('Korean dictionary (T-828d)', () => {
  it('names download-ai-models.bat in the AI model note (T-828f)', () => {
    expect(ko.ai.modelMissingNote).toContain('download-ai-models.bat');
  });

  it('keeps buttons, tabs and options at 8 characters or fewer, not counting spaces (T-828f)', () => {
    const translated = new Map(messages(ko).map(({ path, value }) => [path, value]));
    for (const path of SHORT_LABELS) {
      const value = translated.get(path);
      expect(typeof value, path).toBe('string');
      expect([...value!.replace(/\s/g, '')].length, `${path}: ${value}`).toBeLessThanOrEqual(8);
    }
  });

  it('keeps every source key, value kind, array length and function arity', () => {
    expect(shape(ko)).toEqual(shape(zhHant));
  });

  it('has no empty messages and uses every function argument', () => {
    expect(messages(ko).filter(({ value }) => value.trim() === '')).toEqual([]);
  });

  it('has Hangul in at least 80% of messages, including rendered functions', () => {
    const entries = messages(ko);
    expect(entries.filter(({ value }) => /\p{Script=Hangul}/u.test(value)).length / entries.length).toBeGreaterThanOrEqual(0.8);
  });

  it('contains no Han or kana except unchanged language names', () => {
    const languageNames = new Set(['繁體中文', 'English', '日本語', '한국어']);
    const invalid = messages(ko).filter(({ path, value }) => {
      if (path.startsWith('lang.') && languageNames.has(value)) return false;
      return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
    });
    expect(invalid).toEqual([]);
  });

  it('preserves source numbers and file formats in every message', () => {
    const source = messages(zhHant);
    const translated = new Map(messages(ko).map(({ path, value }) => [path, value]));
    const tokens = (value: string) => value.match(/\d+(?:\.\d+)?|\.holocard|\b(?:PNG|WebP|JPG|GIF|MP4|WebM|MP3|WAV|OGG|MB|KB)\b/g)?.sort() ?? [];
    for (const { path, value } of source) expect(tokens(translated.get(path)!), path).toEqual(tokens(value));
  });

  it('quotes the same button labels that the interface displays', () => {
    const buttons: Record<string, string> = {
      我的卡片: ko.header.library,
      '匯出 ▾': `${ko.header.export} ▾`,
      匯出備份: ko.header.backup,
      上傳圖片: ko.layers.upload,
      '換成我的圖…': ko.stage.backdropAdd,
      光碟: ko.aspect.disc,
      展示: ko.preview.showcase,
      加上變身圖: ko.alt.add,
      加文字: ko.layers.addText,
      '匯入卡片檔…': ko.header.importCard,
      縮小: ko.preview.zoomOut,
      放大: ko.preview.zoomIn,
      全螢幕: ko.preview.fullscreen,
    };
    const translated = new Map(messages(ko).map(({ path, value }) => [path, value]));
    for (const { path, value } of messages(zhHant)) {
      for (const match of value.matchAll(/〔([^〕]+)〕/g)) {
        expect(buttons[match[1]], `${path}: ${match[1]}`).toBeDefined();
        expect(translated.get(path), path).toContain(`‘${buttons[match[1]]}’`);
      }
    }
  });
});
