import { describe, expect, it } from 'vitest';
import { previewWidth, safeFileName } from '../src/app/files';
import { isHolocardFile } from '../src/ui/logic';
import { ASPECT_HEIGHT } from '../src/model/types';
import { CAPTURE_MARGIN } from '../src/render/pick';

describe('匯出檔名（卡名＋副檔名，去掉 Windows 檔名不能用的字元）', () => {
  it('一般卡名直接用', () => {
    expect(safeFileName('月夜海景之卡', '.holocard')).toBe('月夜海景之卡.holocard');
    expect(safeFileName('範例卡・月夜', '.png')).toBe('範例卡・月夜.png');
  });

  it('去掉 < > : " / \\ | ? * 與控制字元', () => {
    expect(safeFileName('a<b>c:d"e/f\\g|h?i*j', '.png')).toBe('abcdefghij.png');
    expect(safeFileName('第一\n張\t卡\u0000', '.png')).toBe('第一張卡.png');
  });

  it('名字含 <script> 也只是一般字（去掉角括號）', () => {
    expect(safeFileName('<script>alert(1)</script>', '.holocard')).toBe('scriptalert(1)script.holocard');
  });

  it('結尾的點與空白去掉（Windows 不允許）', () => {
    expect(safeFileName('卡片...  ', '.png')).toBe('卡片.png');
  });

  it('空白或全是不能用的字 → 未命名卡片', () => {
    expect(safeFileName('', '.png')).toBe('未命名卡片.png');
    expect(safeFileName('   ', '.holocard')).toBe('未命名卡片.holocard');
    expect(safeFileName('???***', '.png')).toBe('未命名卡片.png');
  });

  it('Windows 保留的裝置名（CON、NUL、COM1…）前面加底線', () => {
    expect(safeFileName('CON', '.png')).toBe('_CON.png');
    expect(safeFileName('nul', '.holocard')).toBe('_nul.holocard');
    expect(safeFileName('com1', '.png')).toBe('_com1.png');
    expect(safeFileName('CONSOLE', '.png')).toBe('CONSOLE.png');
    expect(safeFileName('con_2', '.png')).toBe('con_2.png');
  });

  it('保留名看第一個點之前（Windows 的規則）：con.txt、aux.tar.gz、「CON .txt」也算（T-409）', () => {
    expect(safeFileName('con.txt', '.holocard')).toBe('_con.txt.holocard');
    expect(safeFileName('aux.tar.gz', '.png')).toBe('_aux.tar.gz.png');
    expect(safeFileName('CON .txt', '.png')).toBe('_CON .txt.png');
    expect(safeFileName('lpt9...', '.png')).toBe('_lpt9.png');
    expect(safeFileName('config.txt', '.png')).toBe('config.txt.png');
  });
});

describe('卡片檔的 preview 寬度（最長邊 512，依比例算寬）', () => {
  // 和 render/pick.ts 的 captureFrame 一樣：正面時外框＝卡片，四邊各留 CAPTURE_MARGIN × 長邊（cardH＝卡高，卡寬＝1）
  const outputHeight = (cardH: number, width: number) => {
    const m = CAPTURE_MARGIN * Math.max(1, cardH);
    return Math.round((width * (cardH + 2 * m)) / (1 + 2 * m));
  };

  it.each(['standard', 'tarot'] as const)('%s：高度剛好不超過 512、也不會小太多', (aspect) => {
    const w = previewWidth({ aspect });
    expect(Number.isInteger(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(512);
    const h = outputHeight(ASPECT_HEIGHT[aspect], w);
    expect(h).toBeLessThanOrEqual(512);
    expect(h).toBeGreaterThanOrEqual(509);
  });

  it('塔羅牌比較修長，寬度比標準卡小', () => {
    expect(previewWidth({ aspect: 'tarot' })).toBeLessThan(previewWidth({ aspect: 'standard' }));
  });

  it('標準卡、塔羅牌和以前一樣（T-807 前的算式：卡片永遠是直的）', () => {
    for (const aspect of ['standard', 'tarot'] as const) {
      const h = ASPECT_HEIGHT[aspect];
      const m = CAPTURE_MARGIN * h;
      expect(previewWidth({ aspect })).toBe(Math.max(1, Math.floor(512 * ((1 + 2 * m) / (h + 2 * m)))));
    }
  });

  it('T-807：正方形、明信片、橫式自訂——最長邊剛好不超過 512、也不會小太多', () => {
    const shapes = [
      { shape: { aspect: 'square' } as const, cardH: 1 },
      { shape: { aspect: 'postcard' } as const, cardH: 1.48 },
      { shape: { aspect: 'custom', customAspect: { width: 3, height: 2 } } as const, cardH: 2 / 3 },
      { shape: { aspect: 'custom', customAspect: { width: 2, height: 1 } } as const, cardH: 0.5 },
    ];
    for (const { shape, cardH } of shapes) {
      const w = previewWidth(shape);
      const h = outputHeight(cardH, w);
      expect(Number.isInteger(w), JSON.stringify(shape)).toBe(true);
      expect(Math.max(w, h), JSON.stringify(shape)).toBeLessThanOrEqual(512);
      expect(Math.max(w, h), JSON.stringify(shape)).toBeGreaterThanOrEqual(509);
    }
    // 橫式：寬是長邊
    expect(previewWidth({ aspect: 'custom', customAspect: { width: 3, height: 2 } })).toBe(512);
  });
});

describe('拖進來的檔是不是卡片檔（看副檔名）', () => {
  it('.holocard（不分大小寫）是', () => {
    expect(isHolocardFile('我的卡.holocard')).toBe(true);
    expect(isHolocardFile('CARD.HOLOCARD')).toBe(true);
  });

  it('圖片或其他檔不是', () => {
    expect(isHolocardFile('a.png')).toBe(false);
    expect(isHolocardFile('holocard')).toBe(false);
    expect(isHolocardFile('a.holocard.png')).toBe(false);
  });
});
