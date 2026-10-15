import { describe, expect, it } from 'vitest';
import { MUSIC_MAX_BYTES } from '../src/file/types';
import {
  clampMusicStart,
  formatClock,
  maxMusicStart,
  MUSIC_NOTE_TEXT,
  MUSIC_TOO_LARGE_TEXT,
  MUSIC_TOO_LONG_TEXT,
  MUSIC_UNREADABLE_TEXT,
  MUSIC_UNSUPPORTED_TEXT,
  musicErrorText,
  musicFileProblem,
  musicRangeText,
  shortFileName,
  turntableErrorText,
  VIDEO_FAILED_TEXT,
  VIDEO_UNSUPPORTED_TEXT,
  videoLengthOption,
} from '../src/ui/logic';

// T-509b：轉動影片的選項面板（長度、音樂、從第幾秒開始）用的純邏輯

describe('長度的分段按鈕：4／8／12 秒＝轉 1／2／3 圈', () => {
  it('文字', () => {
    expect(videoLengthOption(1)).toEqual({ label: '4 秒', detail: '轉 1 圈' });
    expect(videoLengthOption(2)).toEqual({ label: '8 秒', detail: '轉 2 圈' });
    expect(videoLengthOption(3)).toEqual({ label: '12 秒', detail: '轉 3 圈' });
  });
});

describe('從第幾秒開始：0～（音樂長度 − 影片長度），整數秒（影片那一段一定有音樂，淡出落在音樂上）', () => {
  it('上限＝音樂長度 − 影片長度，往下取整', () => {
    expect(maxMusicStart(205.7, 4)).toBe(201);
    expect(maxMusicStart(10, 4)).toBe(6);
    expect(maxMusicStart(10, 12)).toBe(0);
    expect(maxMusicStart(4, 4)).toBe(0);
    expect(maxMusicStart(4.9, 4)).toBe(0);
  });

  it('音樂比影片短、或長度不合格：上限 0', () => {
    expect(maxMusicStart(2, 4)).toBe(0);
    expect(maxMusicStart(Number.NaN, 4)).toBe(0);
    expect(maxMusicStart(Number.POSITIVE_INFINITY, 4)).toBe(0);
    expect(maxMusicStart(-3, 4)).toBe(0);
  });

  it('夾在範圍內、取整數', () => {
    expect(clampMusicStart(42, 205, 4)).toBe(42);
    expect(clampMusicStart(42.6, 205, 4)).toBe(43);
    expect(clampMusicStart(-5, 205, 4)).toBe(0);
    expect(clampMusicStart(300, 205, 4)).toBe(201);
    expect(clampMusicStart(Number.NaN, 205, 4)).toBe(0);
  });

  it('換長一點的影片時重新夾：原本可以的起點變成上限', () => {
    expect(clampMusicStart(200, 205, 4)).toBe(200);
    expect(clampMusicStart(200, 205, 12)).toBe(193);
  });
});

describe('時間顯示', () => {
  it('分:秒（秒補兩位）', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(42)).toBe('0:42');
    expect(formatClock(205)).toBe('3:25');
    expect(formatClock(205.9)).toBe('3:25');
    expect(formatClock(600)).toBe('10:00');
  });

  it('超過一小時：時:分:秒', () => {
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('不合格當 0', () => {
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('影片用哪一段', () => {
    expect(musicRangeText(42, 4, 205)).toBe('影片會用 0:42～0:46 這一段');
    expect(musicRangeText(60, 12, 205)).toBe('影片會用 1:00～1:12 這一段');
  });

  it('音樂比影片短：說後面沒有聲音', () => {
    expect(musicRangeText(0, 12, 7.5)).toBe('影片會用 0:00～0:07 這一段，後面沒有聲音');
  });
});

describe('音樂檔名（太長的中間省略、留副檔名）', () => {
  it('不長就不動', () => {
    expect(shortFileName('song.mp3')).toBe('song.mp3');
    expect(shortFileName('夜空的歌.wav', 24)).toBe('夜空的歌.wav');
  });

  it('太長：中間換成「…」，保留副檔名，總長不超過上限', () => {
    const name = 'a-very-very-long-music-file-name-for-test.mp3';
    const short = shortFileName(name, 20);
    expect(Array.from(short).length).toBeLessThanOrEqual(20);
    expect(short.endsWith('.mp3')).toBe(true);
    expect(short).toContain('…');
    expect(short.startsWith('a-very')).toBe(true);
  });

  it('中文、emoji 不會切壞字', () => {
    const short = shortFileName('🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵.ogg', 12);
    expect(short).toBe('🎵🎵🎵🎵🎵🎵🎵….ogg');
  });

  it('沒有副檔名', () => {
    const short = shortFileName('x'.repeat(40), 10);
    expect(short).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('音樂的錯誤 → 白話（英文原文只寫 console）', () => {
  it('檔案太大（選檔時就擋）', () => {
    expect(musicFileProblem(MUSIC_MAX_BYTES)).toBeNull();
    expect(musicFileProblem(1000)).toBeNull();
    expect(musicFileProblem(MUSIC_MAX_BYTES + 1)).toBe(MUSIC_TOO_LARGE_TEXT);
    expect(MUSIC_TOO_LARGE_TEXT).toBe('音樂檔太大了（最多 50 MB）');
  });

  it('讀不出來', () => {
    expect(musicErrorText(new DOMException('Unable to decode audio data', 'EncodingError'))).toBe(MUSIC_UNREADABLE_TEXT);
    expect(musicErrorText(new Error('Invalid decoded music'))).toBe(MUSIC_UNREADABLE_TEXT);
    expect(musicErrorText('weird')).toBe(MUSIC_UNREADABLE_TEXT);
    // 解碼器自己說「格式不支援」不是瀏覽器不能加聲音，還是請他換一個檔
    expect(musicErrorText(new Error('The audio format is not supported'))).toBe(MUSIC_UNREADABLE_TEXT);
    expect(MUSIC_UNREADABLE_TEXT).toBe('這個音樂檔讀不出來，換一個試試（MP3、WAV、OGG 都可以）。');
  });

  it('太大、太長', () => {
    expect(musicErrorText(new Error('Music file is too large'))).toBe(MUSIC_TOO_LARGE_TEXT);
    expect(musicErrorText(new Error('Music is too long'))).toBe(MUSIC_TOO_LONG_TEXT);
    expect(MUSIC_TOO_LONG_TEXT).toBe('這段音樂太長了（最多 15 分鐘），換一段短一點的。');
  });

  it('瀏覽器不能加聲音', () => {
    expect(musicErrorText(new Error('OfflineAudioContext is not supported'))).toBe(MUSIC_UNSUPPORTED_TEXT);
    expect(MUSIC_UNSUPPORTED_TEXT).toBe('這個瀏覽器不能幫影片加音樂，可以先匯出沒有音樂的影片。');
  });

  it('錄影時發現不能加聲音：不是叫人改用 GIF，而是先匯出沒有音樂的影片', () => {
    expect(turntableErrorText('webm', new Error('WebCodecs AudioEncoder/AudioData is not supported'))).toBe(MUSIC_UNSUPPORTED_TEXT);
    expect(turntableErrorText('webm', new Error('WebM Opus audio encoding is not supported'))).toBe(MUSIC_UNSUPPORTED_TEXT);
    // 影片本身不能做的照舊
    expect(turntableErrorText('webm', new Error('WebCodecs VideoEncoder/VideoFrame is not supported'))).toBe(VIDEO_UNSUPPORTED_TEXT);
    expect(turntableErrorText('webm', new Error('Invalid WebM audio sample'))).toBe(VIDEO_FAILED_TEXT);
  });

  it('畫面上的字沒有技術名詞', () => {
    const texts = [
      MUSIC_TOO_LARGE_TEXT,
      MUSIC_TOO_LONG_TEXT,
      MUSIC_UNREADABLE_TEXT,
      MUSIC_UNSUPPORTED_TEXT,
      MUSIC_NOTE_TEXT,
      musicRangeText(0, 12, 7.5),
      ...[1, 2, 3].flatMap((n) => Object.values(videoLengthOption(n as 1 | 2 | 3))),
    ];
    for (const t of texts) expect(t).not.toMatch(/Opus|AudioEncoder|WebCodecs|取樣率|編碼|解碼|sample/i);
  });

  it('說明音樂不會存進卡片、不會上傳', () => {
    expect(MUSIC_NOTE_TEXT).toBe('音樂只用在這支影片，不會存進卡片，也不會上傳。');
  });
});
