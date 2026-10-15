import { describe, expect, it } from 'vitest';
import {
  GIF_FAILED_TEXT,
  progressPercent,
  TURNTABLE_DONE_TEXT,
  turntableErrorText,
  turntableMenu,
  turntableProgress,
  turntableTitle,
  VIDEO_FAILED_TEXT,
  VIDEO_UNSUPPORTED_TEXT,
} from '../src/ui/logic';

const abortError = () => new DOMException('Aborted', 'AbortError');

describe('轉一圈匯出的進度（T-504）', () => {
  it('GIF 分兩段：轉一圈 0～50%、合成 50～100%', () => {
    expect(turntableProgress('gif', 'capture', 0, 80)).toBe(0);
    expect(turntableProgress('gif', 'capture', 40, 80)).toBe(0.25);
    expect(turntableProgress('gif', 'capture', 80, 80)).toBe(0.5);
    expect(turntableProgress('gif', 'encode', 0, 80)).toBe(0.5);
    expect(turntableProgress('gif', 'encode', 40, 80)).toBe(0.75);
    expect(turntableProgress('gif', 'encode', 80, 80)).toBe(1);
  });

  it('影片邊拍邊錄只有一段：拍到第幾格就是幾成', () => {
    expect(turntableProgress('webm', 'capture', 0, 80)).toBe(0);
    expect(turntableProgress('webm', 'capture', 20, 80)).toBe(0.25);
    expect(turntableProgress('webm', 'capture', 80, 80)).toBe(1);
  });

  it('超出範圍夾在 0～1；總數 0 或不合格當 0', () => {
    expect(turntableProgress('gif', 'capture', 100, 80)).toBe(0.5);
    expect(turntableProgress('webm', 'capture', -3, 80)).toBe(0);
    expect(turntableProgress('webm', 'capture', 5, 0)).toBe(0);
    expect(turntableProgress('gif', 'encode', Number.NaN, 80)).toBe(0.5);
  });

  it('百分比只往下取整（還沒做完不顯示 100%）', () => {
    expect(progressPercent(0)).toBe('0%');
    expect(progressPercent(0.256)).toBe('25%');
    expect(progressPercent(0.999)).toBe('99%');
    expect(progressPercent(1)).toBe('100%');
    expect(progressPercent(1.4)).toBe('100%');
    expect(progressPercent(-1)).toBe('0%');
    expect(progressPercent(Number.NaN)).toBe('0%');
  });
});

describe('轉一圈匯出的文字（白話、不出現技術名詞）', () => {
  it('匯出中的標題', () => {
    expect(turntableTitle('webm')).toBe('正在做轉動影片…');
    expect(turntableTitle('gif')).toBe('正在做 GIF…');
    expect(TURNTABLE_DONE_TEXT).toBe('好了！');
  });

  it('選單說明：影片可選長度與配樂（T-509），GIF 是 4 秒、可選大小（T-512）', () => {
    expect(turntableMenu('webm').title).toBe('轉動影片');
    expect(turntableMenu('gif').title).toBe('GIF 動圖');
    expect(turntableMenu('webm').detail).toContain('4～12 秒');
    expect(turntableMenu('webm').detail).toContain('配音樂');
    expect(turntableMenu('gif').detail).toContain('可選大小');
    expect(turntableMenu('gif').detail).not.toContain('轉一圈');
  });

  it('取消不是錯誤：不顯示訊息', () => {
    expect(turntableErrorText('webm', abortError())).toBeNull();
    expect(turntableErrorText('gif', abortError())).toBeNull();
  });

  it('瀏覽器不能做影片 → 請改用 GIF', () => {
    expect(turntableErrorText('webm', new Error('WebCodecs VideoEncoder/VideoFrame is not supported'))).toBe(VIDEO_UNSUPPORTED_TEXT);
    expect(turntableErrorText('webm', new Error('WebM VP9 and VP8 encoding is not supported'))).toBe(VIDEO_UNSUPPORTED_TEXT);
    expect(VIDEO_UNSUPPORTED_TEXT).toBe('這個瀏覽器不能做影片，請改用 GIF。');
  });

  it('其他失敗：說沒有下載', () => {
    expect(turntableErrorText('webm', new Error('encoder broke'))).toBe(VIDEO_FAILED_TEXT);
    expect(turntableErrorText('webm', 'weird')).toBe(VIDEO_FAILED_TEXT);
    expect(turntableErrorText('gif', new Error('GIF Worker failed'))).toBe(GIF_FAILED_TEXT);
    // GIF 不會叫人改用 GIF
    expect(turntableErrorText('gif', new Error('something is not supported'))).toBe(GIF_FAILED_TEXT);
    expect(VIDEO_FAILED_TEXT).toContain('沒有下載');
    expect(GIF_FAILED_TEXT).toContain('沒有下載');
  });

  it('畫面上的字沒有技術名詞', () => {
    const texts = [
      VIDEO_UNSUPPORTED_TEXT,
      VIDEO_FAILED_TEXT,
      GIF_FAILED_TEXT,
      TURNTABLE_DONE_TEXT,
      turntableTitle('webm'),
      turntableTitle('gif'),
      ...(['webm', 'gif'] as const).flatMap((k) => [turntableMenu(k).title, turntableMenu(k).detail]),
    ];
    for (const t of texts) expect(t).not.toMatch(/WebCodecs|編碼|VP8|VP9|Worker|encoder|abort/i);
  });
});
