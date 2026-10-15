// T-418：測試用不下載開關。網址帶 ?nodownload 時，下載出口不點 <a download>，改把 { name, size, blob } 放進
// window.__holoDownloads 並在 console 記一行；沒有參數時照常下載。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, noDownloadMode, type HeldDownload } from '../src/app/files';

interface FakeAnchor {
  href: string;
  download: string;
  hidden: boolean;
  click: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function setup(search: string) {
  const anchors: FakeAnchor[] = [];
  const win: { __holoDownloads?: HeldDownload[] } = {};
  vi.stubGlobal('location', { search });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'a') throw new Error(`沒想到要建 <${tag}>`);
      const a: FakeAnchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
      anchors.push(a);
      return a;
    },
    body: { append: vi.fn() },
  });
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  return { anchors, win, createObjectURL, info };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('noDownloadMode：網址參數', () => {
  it('有 nodownload（有沒有值都算）才是；其他參數不算', () => {
    expect(noDownloadMode('?nodownload')).toBe(true);
    expect(noDownloadMode('?card=2&nodownload')).toBe(true);
    expect(noDownloadMode('?nodownload=1')).toBe(true);
    expect(noDownloadMode('')).toBe(false);
    expect(noDownloadMode('?card=2')).toBe(false);
    expect(noDownloadMode('?download')).toBe(false);
    expect(noDownloadMode('?nodownloads')).toBe(false);
  });
});

describe('downloadBlob', () => {
  it('?nodownload：不點連結、不建 object URL；放進 window.__holoDownloads（檔名、大小、Blob），console 記一行', () => {
    const t = setup('?nodownload');
    const blob = new Blob(['hello'], { type: 'image/png' });
    downloadBlob(blob, '月夜.png');
    downloadBlob(new Blob(['ab']), '月夜.holocard');
    expect(t.anchors).toEqual([]);
    expect(t.createObjectURL).not.toHaveBeenCalled();
    expect(t.win.__holoDownloads).toEqual([
      { name: '月夜.png', size: 5, blob },
      { name: '月夜.holocard', size: 2, blob: expect.any(Blob) },
    ]);
    expect(t.info).toHaveBeenCalledTimes(2);
    expect(String(t.info.mock.calls[0]![0])).toContain('月夜.png');
  });

  it('沒有參數：照常用 <a download> 下載（點一次、用完移除），不碰 __holoDownloads', () => {
    vi.useFakeTimers();
    const t = setup('?card=1');
    downloadBlob(new Blob(['x']), '卡.gif');
    expect(t.anchors).toHaveLength(1);
    expect(t.anchors[0]!.download).toBe('卡.gif');
    expect(t.anchors[0]!.href).toBe('blob:fake');
    expect(t.anchors[0]!.click).toHaveBeenCalledTimes(1);
    expect(t.anchors[0]!.remove).toHaveBeenCalledTimes(1);
    expect(t.win.__holoDownloads).toBeUndefined();
    expect(t.info).not.toHaveBeenCalled();
  });
});
