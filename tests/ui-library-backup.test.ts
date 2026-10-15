import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../src/i18n';
import { createLibrary, type Library } from '../src/ui/library';
import type { BackupOutcome, BackupProgress, UiIntents } from '../src/ui/types';
import { byClass, FakeElement, flush, installFakeDom } from './ui-fake-dom';

let library: Library;
beforeEach(() => {
  const dom = installFakeDom();
  vi.stubGlobal('HTMLElement', FakeElement);
  Object.assign(document, { addEventListener: () => {} });
  Object.assign(dom.window, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { library?.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(backup: (progress: (p: BackupProgress) => void, signal: AbortSignal) => Promise<BackupOutcome>) {
  const intents = {
    loadLibrary: async () => ({ cards: [], storageLow: false }),
    backupLibrary: backup,
  } as unknown as UiIntents;
  library = createLibrary(intents, { openNewCard: () => {}, importFiles: () => {}, changed: () => {} });
  library.open();
  const el = library.el as unknown as FakeElement;
  return { el, start: byClass(el, 'lib-backup-start'), cancel: byClass(el, 'lib-backup-cancel'), status: byClass(el, 'lib-backup-status') };
}

describe('卡片庫全部備份操作（T-845）', () => {
  it('顯示還原說明、進度、失敗卡名純文字；進行中禁止重複啟動', async () => {
    let finish!: (r: BackupOutcome) => void;
    const backup = vi.fn((progress: (p: BackupProgress) => void) => {
      progress({ current: 3, total: 12 });
      return new Promise<BackupOutcome>((resolve) => { finish = resolve; });
    });
    const t = setup(backup);
    expect(byClass(t.el, 'lib-backup-restore').textContent).toBe(S.library.backupRestore);
    t.start.click();
    expect(t.status.textContent).toBe(S.library.backupProgress(3, 12));
    expect(t.start.disabled).toBe(true);
    expect(t.cancel.hidden).toBe(false);
    finish({ kind: 'done', saved: 11, failed: ['<img src=x>'] });
    await flush();
    expect(t.status.textContent).toBe(S.library.backupPartial(11, 1, '<img src=x>'));
    expect(t.status.children).toHaveLength(0);
    expect(t.start.disabled).toBe(false);
    expect(t.cancel.hidden).toBe(true);
  });

  it.each(['cancel', 'escape', 'close'] as const)('%s 會取消（被接手也走 close），收起進度且可以再開始', async (action) => {
    let signal!: AbortSignal;
    let finish!: (r: BackupOutcome) => void;
    const t = setup((_p, s) => { signal = s; return new Promise((resolve) => { finish = resolve; }); });
    t.start.click();
    if (action === 'cancel') t.cancel.click();
    else library[action]();
    expect(signal.aborted).toBe(true);
    finish({ kind: 'cancelled' });
    await flush();
    expect(t.status.textContent).toBe('');
    expect(t.start.disabled).toBe(false);
  });

  it('整體失敗顯示既有白話錯誤並可重試', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup(async () => { throw new Error('storage failure'); });
    t.start.click();
    await flush();
    expect(t.status.textContent).toBe(S.save.exportCardFailed);
    expect(t.start.disabled).toBe(false);
  });
});
