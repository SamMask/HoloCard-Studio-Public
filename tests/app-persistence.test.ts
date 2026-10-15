import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, type SessionDeps } from '../src/app/session';
import { newCard } from '../src/model/create';
import type { Card } from '../src/model/types';
import { openCardStore } from '../src/storage/store';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup(storage?: Partial<Pick<StorageManager, 'persisted' | 'persist'>>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const store = await openCardStore(new IDBFactory());
  let current: Card | null = null;
  const deps = {
    store, storage,
    images: { add: async () => {}, get: () => undefined, retain: () => {} },
    current: () => current,
    show: (card: Card) => { current = card; },
    thumbnail: async () => null,
    settle: async () => {}, onStatus: () => {}, onStorageLow: () => {},
  } satisfies SessionDeps;
  const session = createSession(deps);
  await session.adopt(newCard('standard', 'one', '2026-10-15T00:00:00.000Z'), []);
  const edit = () => { current = { ...current!, name: `${current!.name}!` }; };
  const saveEdit = async () => {
    edit();
    expect(await session.saver.flush()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { session, store, edit, saveEdit };
}

describe('T-844 persistent storage', () => {
  it.each([undefined, {}, { persisted: vi.fn(async () => false) }])('missing API does not affect saves: %s', async (storage) => {
    const h = await setup(storage);
    await h.saveEdit();
    await h.saveEdit();
    expect(h.session.saver.status()).toBe('saved');
  });

  it.each([true, false])('requests once and logs persist result %s', async (result) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => result) };
    const h = await setup(storage);
    await h.session.saver.flush({ thumbnail: true });
    expect(storage.persisted).not.toHaveBeenCalled();
    await h.saveEdit();
    await h.session.adopt(newCard('standard', 'two', '2026-10-15T00:00:00.000Z'), []);
    await h.saveEdit();
    expect(storage.persisted).toHaveBeenCalledTimes(1);
    expect(storage.persist).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Storage persistence:', result);
  });

  it('already persistent: checks once without requesting', async () => {
    const storage = { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) };
    const h = await setup(storage);
    await h.saveEdit();
    await h.saveEdit();
    expect(storage.persisted).toHaveBeenCalledTimes(1);
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it.each(['persisted', 'persist'] as const)('ignores %s throwing synchronously or rejecting', async (method) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const synchronous of [true, false]) {
      const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
      storage[method].mockImplementation(() => {
        if (synchronous) throw new Error('denied');
        return Promise.reject(new Error('denied'));
      });
      const h = await setup(storage);
      await h.saveEdit();
      await h.saveEdit();
      expect(storage.persisted).toHaveBeenCalledTimes(1);
      expect(storage.persist).toHaveBeenCalledTimes(method === 'persist' ? 1 : 0);
      expect(h.session.saver.status()).toBe('saved');
    }
  });

  it('failed card save does not request; successful retry does', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
    const h = await setup(storage);
    vi.spyOn(h.store, 'save').mockRejectedValueOnce(new Error('full'));
    h.edit();
    expect(await h.session.saver.flush()).toBe(false);
    expect(storage.persisted).not.toHaveBeenCalled();
    expect(await h.session.saver.flush()).toBe(true);
    await Promise.resolve();
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('pending persistence does not block saving, switching, or later saves', async () => {
    let resolve!: (result: boolean) => void;
    const storage = {
      persisted: vi.fn(async () => false),
      persist: vi.fn(() => new Promise<boolean>((done) => { resolve = done; })),
    };
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const h = await setup(storage);
    await h.saveEdit();
    await h.session.adopt(newCard('standard', 'two', '2026-10-15T00:00:00.000Z'), []);
    await h.saveEdit();
    expect(storage.persist).toHaveBeenCalledTimes(1);
    resolve(true);
    await Promise.resolve();
  });
});
