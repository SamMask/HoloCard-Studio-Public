import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

describe('專案骨架', () => {
  it('fake-indexeddb 能開一個資料庫並寫入、讀出', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('smoke', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('cards');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('cards', 'readwrite');
      tx.objectStore('cards').put({ name: '範例' }, 'a');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('cards').objectStore('cards').get('a');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(value).toEqual({ name: '範例' });
    db.close();
  });
});
