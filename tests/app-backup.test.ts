import { IDBFactory } from 'fake-indexeddb';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupLibrary, type BackupDeps } from '../src/app/backup';
import { createSession } from '../src/app/session';
import { importHolocard } from '../src/file/holocard';
import { newCard } from '../src/model/create';
import { addLayer } from '../src/model/actions';
import { openCardStore } from '../src/storage/store';
import { makePng, stored } from './file-fixtures';

const NOW = '2026-10-15T08:00:00.000Z';
const preview = new Blob([makePng({ width: 8, height: 8, seed: 1 })], { type: 'image/png' });

async function setup(names = ['同名', '同名', '同名 (2)']) {
  const store = await openCardStore(new IDBFactory());
  const image = await stored(makePng({ width: 8, height: 8, seed: 2 }), 'image/png', 8, 8, false);
  await store.saveImage(image);
  for (const [i, name] of names.entries()) {
    const added = addLayer({ ...newCard('standard', `card-${i}`, NOW), name }, 'front', {
      id: `layer-${i}`, name: 'image', image: image.hash, width: 8, height: 8, hasAlpha: false,
    });
    if (!added.ok) throw new Error(added.reason);
    await store.save(added.card);
  }
  const session = createSession({
    store, current: () => null, show: () => {},
    images: { add: async () => {}, get: () => undefined, retain: () => {} },
    thumbnail: async () => null, settle: async () => {}, onStatus: () => {}, onStorageLow: () => {},
  });
  vi.stubGlobal('location', { search: '?nodownload' });
  vi.stubGlobal('window', {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const deps: BackupDeps = { session, preview: async () => preview };
  return { deps, store };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('全部備份（T-845）', () => {
  it('fake-indexeddb 三張卡：ZIP 恰好三個不壓縮、檔名不互蓋的合法卡片檔；nodownload 攔住下載', async () => {
    const { deps, store } = await setup();
    const progress = vi.fn();
    const result = await backupLibrary(deps, progress, new AbortController().signal);
    expect(result).toEqual({ kind: 'done', saved: 3, failed: [] });
    expect(progress.mock.calls.map(([p]) => p)).toEqual([
      { current: 0, total: 3 }, { current: 1, total: 3 }, { current: 2, total: 3 }, { current: 3, total: 3 },
    ]);
    expect(window.__holoDownloads).toHaveLength(1);
    const held = window.__holoDownloads![0]!;
    expect(held.name).toMatch(/^holocard-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const bytes = new Uint8Array(await held.blob.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint16(8, true)).toBe(0);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toHaveLength(3);
    const names = [];
    for (const [name, data] of Object.entries(entries)) {
      expect(name).toMatch(/^[^/\\]+\.holocard$/);
      const imported = await importHolocard(new Blob([data as Uint8Array<ArrayBuffer>]), { newId: () => 'restored', now: () => NOW });
      expect(imported.ok).toBe(true);
      if (imported.ok) {
        names.push(imported.card.name);
        expect(imported.images).toHaveLength(1);
        expect(imported.card.front.layers[0]?.image).toBe(imported.images[0]?.hash);
      }
    }
    expect(names.sort()).toEqual(['同名', '同名', '同名 (2)'].sort());
  });

  it('單張讀取失敗或 preview 失敗：跳過、列出原卡名，其餘仍下載', async () => {
    const { deps, store } = await setup(['好卡', '讀不到', '預覽壞了']);
    const read = deps.session.cardForExport.bind(deps.session);
    deps.session = { ...deps.session, cardForExport: async (id) => id === 'card-1' ? null : read(id) };
    deps.preview = async ({ card }) => { if (card.id === 'card-2') throw new Error('preview failed'); return preview; };
    expect(await backupLibrary(deps, () => {}, new AbortController().signal)).toEqual({ kind: 'done', saved: 1, failed: ['讀不到', '預覽壞了'] });
    expect(Object.keys(unzipSync(new Uint8Array(await window.__holoDownloads![0]!.blob.arrayBuffer())))).toEqual(['好卡.holocard']);
  });

  it.each(['before', 'reading', 'preview', 'last-progress'] as const)('取消於 %s：不下載、不把取消算失敗', async (when) => {
    const { deps, store } = await setup();
    const controller = new AbortController();
    if (when === 'before') controller.abort();
    const read = deps.session.cardForExport.bind(deps.session);
    deps.session = { ...deps.session, cardForExport: async (id) => {
      const source = await read(id);
      if (when === 'reading') controller.abort();
      return source;
    } };
    deps.preview = async () => { if (when === 'preview') controller.abort(); return preview; };
    expect(await backupLibrary(deps, (p) => {
      if (when === 'last-progress' && p.current === p.total) controller.abort();
    }, controller.signal)).toEqual({ kind: 'cancelled' });
    expect(window.__holoDownloads).toBeUndefined();
  });

  it('存檔失敗不匯出舊版本；空清單與全部失敗不下載空 ZIP', async () => {
    const { deps, store } = await setup([]);
    expect(await backupLibrary(deps, () => {}, new AbortController().signal)).toEqual({ kind: 'done', saved: 0, failed: [] });
    vi.spyOn(deps.session.saver, 'flush').mockResolvedValue(false);
    await expect(backupLibrary(deps, () => {}, new AbortController().signal)).rejects.toThrow();
    expect(window.__holoDownloads).toBeUndefined();
  });

  it('清理非法檔名字元與大小寫重名；全部失敗不下載', async () => {
    const { deps, store } = await setup(['A/B', 'ab', 'AB (2)']);
    await backupLibrary(deps, () => {}, new AbortController().signal);
    const entries = Object.keys(unzipSync(new Uint8Array(await window.__holoDownloads![0]!.blob.arrayBuffer())));
    expect(new Set(entries.map((name) => name.toLowerCase())).size).toBe(3);
    expect(entries.every((name) => !name.includes('/'))).toBe(true);
    window.__holoDownloads = [];
    deps.preview = async () => { throw new Error('broken'); };
    expect(await backupLibrary(deps, () => {}, new AbortController().signal)).toEqual({ kind: 'done', saved: 0, failed: ['A/B', 'ab', 'AB (2)'] });
    expect(window.__holoDownloads).toEqual([]);
  });
});
