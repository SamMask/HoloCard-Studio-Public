import { describe, expect, it } from 'vitest';
import {
  canvasSize,
  contentFraction,
  DARK_EDGE,
  LIGHT_EDGE,
  OUTLINE_EM,
  outlineColorFor,
  pixelsPerEm,
  planText,
  relativeLuminance,
  SEAL_PAD_EM,
  sealInkColor,
  splitLines,
  TEXT_BOX_EM,
  TEXT_CHAR_STEP,
  TEXT_EM_PX,
  TEXT_FONT_INFO,
  TEXT_LINE_GAP,
  TEXT_PAD_EM,
  verticalForm,
} from '../../src/images/text-layout';
import { MAX_EDGE_PX } from '../../src/images/types';
import { TEXT_FONTS } from '../../src/model/limits';
import type { TextSpec } from '../../src/model/types';

/** 假的量字：每個字寬 1 個字高（中文字大致如此）。 */
const measure = (s: string) => Array.from(s).length;

function plan(content: string, over: Partial<TextSpec> = {}) {
  return planText({ content, align: 'center', vertical: false, style: 'plain', ...over }, measure);
}

describe('字型清單', () => {
  it('四套字型都有檔名、白話名字，family 不重複', () => {
    for (const f of TEXT_FONTS) {
      expect(TEXT_FONT_INFO[f].file).toMatch(/\.ttf$/);
      expect(TEXT_FONT_INFO[f].label.length).toBeGreaterThan(0);
    }
    const families = TEXT_FONTS.map((f) => TEXT_FONT_INFO[f].family);
    expect(new Set(families).size).toBe(families.length);
  });
});

describe('splitLines／verticalForm', () => {
  it('三種換行都切開；空行保留', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
    expect(splitLines('卡片名稱')).toEqual(['卡片名稱']);
  });

  it('直排時常用標點換成直式；一般字不變', () => {
    expect(verticalForm('，')).toBe('︐');
    expect(verticalForm('。')).toBe('︒');
    expect(verticalForm('「')).toBe('﹁');
    expect(verticalForm('」')).toBe('﹂');
    expect(verticalForm('（')).toBe('︵');
    expect(verticalForm('…')).toBe('︙');
    expect(verticalForm('月')).toBe('月');
    expect(verticalForm('A')).toBe('A');
  });
});

describe('planText：橫排', () => {
  it('短的一行：圖寬剛好 TEXT_BOX_EM（scale 1 時一行字高＝0.1 卡寬），內容水平置中', () => {
    const p = plan('卡片名稱');
    expect(p.width).toBe(TEXT_BOX_EM);
    expect(p.height).toBeCloseTo(1 + 2 * TEXT_PAD_EM);
    expect(p.content.width).toBeCloseTo(4 + 2 * TEXT_PAD_EM);
    expect(p.content.x + p.content.width / 2).toBeCloseTo(p.width / 2);
    expect(p.glyphs).toEqual([{ text: '卡片名稱', x: TEXT_BOX_EM / 2, y: TEXT_PAD_EM + 0.5 }]);
    expect(p.seal).toBeNull();
    expect(p.outline).toBe(0);
  });

  it('長的一行：圖跟著變寬（內容＋兩邊透明邊）', () => {
    const p = plan('字'.repeat(30));
    expect(p.width).toBeCloseTo(30 + 2 * TEXT_PAD_EM);
    expect(p.content).toEqual({ x: 0, y: 0, width: p.width, height: p.height });
  });

  it('多行：行距 TEXT_LINE_GAP；靠左／置中／靠右對齊在最長那一行的範圍內', () => {
    const left = TEXT_BOX_EM / 2 - 2; // 最長一行 4 字、置中在圖中間
    const start = plan('一二三四\n五六', { align: 'start' }).glyphs;
    expect(start[0]).toMatchObject({ x: left + 2, y: TEXT_PAD_EM + 0.5 });
    expect(start[1]).toMatchObject({ x: left + 1, y: TEXT_PAD_EM + 0.5 + TEXT_LINE_GAP });
    expect(plan('一二三四\n五六', { align: 'center' }).glyphs[1]!.x).toBeCloseTo(left + 2);
    expect(plan('一二三四\n五六', { align: 'end' }).glyphs[1]!.x).toBeCloseTo(left + 3);
    expect(plan('一二三四\n五六').height).toBeCloseTo(1 + TEXT_LINE_GAP + 2 * TEXT_PAD_EM);
  });

  it('空行佔位置但不畫', () => {
    const p = plan('上\n\n下');
    expect(p.glyphs.map((g) => g.text)).toEqual(['上', '下']);
    expect(p.glyphs[1]!.y - p.glyphs[0]!.y).toBeCloseTo(2 * TEXT_LINE_GAP);
  });

  it('描邊：outline＝OUTLINE_EM；印章：方框包住字、四周多 SEAL_PAD_EM，框外還有透明邊', () => {
    expect(plan('名', { style: 'outline' }).outline).toBe(OUTLINE_EM);
    const p = plan('月', { style: 'seal' });
    expect(p.seal).not.toBeNull();
    const s = p.seal!;
    expect(s.width).toBeCloseTo(1 + 2 * SEAL_PAD_EM);
    expect(s.height).toBeCloseTo(1 + 2 * SEAL_PAD_EM);
    expect(s.x).toBeCloseTo(p.content.x + TEXT_PAD_EM);
    expect(s.y).toBeCloseTo(TEXT_PAD_EM);
    // 字在方框正中間
    expect(p.glyphs[0]!.x).toBeCloseTo(s.x + s.width / 2);
    expect(p.glyphs[0]!.y).toBeCloseTo(s.y + s.height / 2);
    expect(p.height).toBeCloseTo(s.height + 2 * TEXT_PAD_EM);
  });
});

describe('planText：直排（由上到下、多列由右到左）', () => {
  it('一列：字由上往下排，間距 TEXT_CHAR_STEP；圖寬仍至少 TEXT_BOX_EM、內容置中', () => {
    const p = plan('月夜', { vertical: true });
    expect(p.width).toBe(TEXT_BOX_EM);
    expect(p.glyphs.map((g) => g.text)).toEqual(['月', '夜']);
    expect(p.glyphs[0]!.x).toBeCloseTo(TEXT_BOX_EM / 2);
    expect(p.glyphs[1]!.x).toBeCloseTo(TEXT_BOX_EM / 2);
    expect(p.glyphs[1]!.y - p.glyphs[0]!.y).toBeCloseTo(TEXT_CHAR_STEP);
    expect(p.height).toBeCloseTo(1 + TEXT_CHAR_STEP + 2 * TEXT_PAD_EM);
  });

  it('兩列：第一行在右邊、第二行在左邊；直式標點', () => {
    const p = plan('月夜，\n海', { vertical: true, align: 'start' });
    const [a, b, comma, sea] = p.glyphs;
    expect([a!.text, b!.text, comma!.text, sea!.text]).toEqual(['月', '夜', '︐', '海']);
    expect(a!.x - sea!.x).toBeCloseTo(TEXT_LINE_GAP);
    expect(sea!.y).toBeCloseTo(a!.y); // 靠上：兩列的第一個字同高
  });

  it('對齊：短的那一列靠上／置中／靠下', () => {
    const y = (align: TextSpec['align']) => plan('一二三\n四', { vertical: true, align }).glyphs[3]!.y;
    const top = TEXT_PAD_EM + 0.5;
    expect(y('start')).toBeCloseTo(top);
    expect(y('center')).toBeCloseTo(top + TEXT_CHAR_STEP);
    expect(y('end')).toBeCloseTo(top + 2 * TEXT_CHAR_STEP);
  });

  it('空白字佔位置但不畫', () => {
    const p = plan('上 下', { vertical: true });
    expect(p.glyphs.map((g) => g.text)).toEqual(['上', '下']);
    expect(p.glyphs[1]!.y - p.glyphs[0]!.y).toBeCloseTo(2 * TEXT_CHAR_STEP);
  });
});

describe('像素大小與內容比例', () => {
  it('一般情況一個字高 TEXT_EM_PX，但長邊不超過 MAX_EDGE_PX', () => {
    expect(pixelsPerEm({ width: 4, height: 2 })).toBe(TEXT_EM_PX);
    expect(pixelsPerEm({ width: TEXT_BOX_EM, height: 1.6 })).toBeCloseTo(MAX_EDGE_PX / TEXT_BOX_EM);
    expect(pixelsPerEm({ width: 3, height: 40 })).toBeCloseTo(MAX_EDGE_PX / 40);
  });

  it('畫布四捨五入、不超過上限、至少 1 像素', () => {
    const p = plan('字'.repeat(100));
    const size = canvasSize(p, pixelsPerEm(p));
    expect(size.width).toBe(MAX_EDGE_PX);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(canvasSize({ width: TEXT_BOX_EM, height: 1.6 }, 204.8)).toEqual({ width: 2048, height: 328 });
  });

  it('內容比例：短字只佔中間一段，長字佔滿', () => {
    const short = contentFraction(plan('卡片名稱'));
    expect(short.w).toBeCloseTo((4 + 2 * TEXT_PAD_EM) / TEXT_BOX_EM);
    expect(short.h).toBe(1);
    expect(contentFraction(plan('字'.repeat(30))).w).toBe(1);
  });
});

describe('自動配色', () => {
  it('相對亮度：白 1、黑 0；格式不對當黑', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('red')).toBe(0);
  });

  it('描邊：字亮就深邊、字暗就淺邊', () => {
    expect(outlineColorFor('#ffffff')).toBe(DARK_EDGE);
    expect(outlineColorFor('#e6c06a')).toBe(DARK_EDGE); // 金
    expect(outlineColorFor('#5fd4ee')).toBe(DARK_EDGE); // 青藍
    expect(outlineColorFor('#000000')).toBe(LIGHT_EDGE);
    expect(outlineColorFor('#c8322b')).toBe(LIGHT_EDGE); // 朱紅
    expect(outlineColorFor('#1b2033')).toBe(LIGHT_EDGE); // 夜藍
  });

  it('印章字：一般白字；底色太淺改深色字', () => {
    expect(sealInkColor('#c8322b')).toBe('#ffffff');
    expect(sealInkColor('#1b2033')).toBe('#ffffff');
    expect(sealInkColor('#ffffff')).toBe(DARK_EDGE);
    expect(sealInkColor('#fff2a8')).toBe(DARK_EDGE);
  });
});
