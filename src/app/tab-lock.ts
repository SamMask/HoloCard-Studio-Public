// 一次只有一個分頁能編輯（T-409）：工坊開著時再雙擊 main.bat 會多開一個分頁，兩個分頁開同一張卡會互相蓋掉。
// 用瀏覽器內建的 Web Locks（navigator.locks）當「編輯鎖」、BroadcastChannel 傳「要接手」：
//   1. 開啟時先拿鎖。拿不到（別的分頁拿著）→ 先排隊等鎖，再廣播「要接手」（onWait：畫面顯示「正在等另一個分頁存好…」）。
//      拿到之前每隔一下再廣播一次（T-412）：三個分頁時，通知可能剛好送到「正在交出去」或「還在排隊」的分頁而被忽略。
//   2. 拿著鎖的分頁收到「要接手」→ onYield（組裝端：蓋上遮罩、存好這張卡、自動存停住）→ 放掉鎖 → 排隊的分頁拿到鎖才讀卡片庫。
//   3. 被接手的分頁按〔在這裡繼續〕＝反過來再 acquire 一次。
// 寫入一律經過 guardWrites：沒拿著鎖就拒絕（自動存、縮圖、meta 都不能寫）。
// 瀏覽器沒有 Web Locks 或 BroadcastChannel：不擋（照以前，每個分頁都能寫）。
// 只用同源的瀏覽器內建介面，不對外連線；這個模組不碰 DOM。

import type { CardStore } from '../storage/types';

/** 編輯鎖的名字（同一個網址來源共用；localhost 和 127.0.0.1 是不同來源，資料庫也是分開的）。 */
export const EDIT_LOCK_NAME = 'holocard-studio:edit';
/** 分頁之間傳話的頻道名。 */
export const TAB_CHANNEL_NAME = 'holocard-studio:tabs';
/** 還沒拿到鎖時，每隔多久再請一次「要接手」。 */
export const TAKEOVER_RETRY_MS = 2000;

/** 這個分頁已經交給別的分頁編輯（沒拿著編輯鎖）：寫入被拒絕。和一般存檔失敗分開——不能當成「沒存到但照樣換卡」（T-412）。 */
export class HandedOffError extends Error {
  constructor() {
    super('這個分頁已經交給另一個分頁編輯，沒有寫入存檔');
    this.name = 'HandedOffError';
  }
}

/** navigator.locks 裡用到的部分（測試注入假的）。callback 回傳的 promise 沒結束前鎖都拿著。 */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean }, callback: (lock: object | null) => unknown): Promise<unknown>;
}

/** BroadcastChannel 裡用到的部分：送給同源的其他分頁（不會送給自己）、收別的分頁送來的。 */
export interface ChannelLike {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
}

export interface TabLockDeps {
  /** null＝瀏覽器沒有 Web Locks。 */
  locks: LockManagerLike | null;
  /** null＝瀏覽器沒有 BroadcastChannel。 */
  channel: ChannelLike | null;
  /** 別的分頁要接手：存好、停住所有寫入；resolve（或出錯）之後才放掉鎖。 */
  onYield(): Promise<void>;
  /** 鎖被別的分頁拿著、要等它存好交出來（每次 acquire 最多叫一次）。 */
  onWait?(): void;
  /** 還沒拿到鎖時多久再請一次（測試用；預設 TAKEOVER_RETRY_MS）。 */
  retryMs?: number;
  /** 這個分頁的代號（測試用；預設隨機）。 */
  id?: string;
}

export interface TabLock {
  /** 有 Web Locks 和 BroadcastChannel 才會擋；沒有就照以前（每個分頁都能寫）。 */
  readonly supported: boolean;
  /** 拿編輯鎖：別的分頁拿著就請它交出來，等它存好放掉才 resolve。不支援就馬上 resolve。 */
  acquire(): Promise<void>;
  /** 現在可以寫嗎（拿著鎖；交出去的途中也算，onYield 做完才放掉；不支援＝永遠可以）。 */
  holding(): boolean;
}

interface TakeoverMessage {
  type: 'takeover';
  from: string;
}

const TAKEOVER = 'takeover';

/** 別的分頁送來的東西不一定長這樣：照形狀檢查。 */
function isTakeover(message: unknown): message is TakeoverMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>).type === TAKEOVER &&
    typeof (message as Record<string, unknown>).from === 'string'
  );
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function createTabLock(deps: TabLockDeps): TabLock {
  const { locks, channel } = deps;
  const supported = locks !== null && channel !== null;
  const id = deps.id ?? randomId();
  const retryMs = deps.retryMs ?? TAKEOVER_RETRY_MS;
  let held = false;
  /** 放掉鎖（讓拿鎖時 callback 回傳的 promise 結束）。 */
  let release: (() => void) | null = null;
  let acquiring: Promise<void> | null = null;
  /** 正在交出去（onYield 還沒做完）：做完才會放掉鎖。 */
  let yielding: Promise<void> | null = null;

  const acquire = (): Promise<void> => {
    if (!locks || !channel) return Promise.resolve();
    // 正在交出去：等交完再重新排隊拿（不能以為自己還拿著）
    if (yielding) return yielding.then(acquire);
    if (held) return Promise.resolve();
    if (acquiring) return acquiring;
    acquiring = new Promise<void>((resolve, reject) => {
      let done = false;
      let retry: ReturnType<typeof setInterval> | undefined;
      const finish = () => {
        done = true;
        clearInterval(retry);
      };
      const hold = () => {
        finish();
        held = true;
        resolve();
        return new Promise<void>((r) => {
          release = r;
        });
      };
      const fail = (err: unknown) => {
        finish();
        reject(err);
      };
      const ask = () => channel.post({ type: TAKEOVER, from: id } satisfies TakeoverMessage);
      locks
        .request(EDIT_LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (lock) return hold();
          // 別的分頁拿著：先排隊（它一放掉就輪到這裡），再請它交出來
          locks.request(EDIT_LOCK_NAME, {}, () => hold()).catch(fail);
          deps.onWait?.();
          ask();
          // 拿到之前再請幾次：這次的通知可能被正在交出去、或自己也還在排隊的分頁忽略（T-412）
          if (!done) retry = setInterval(ask, retryMs);
          return undefined;
        })
        .catch(fail);
    }).finally(() => {
      acquiring = null;
    });
    return acquiring;
  };

  channel?.listen((message) => {
    if (!isTakeover(message) || message.from === id || !held || yielding) return;
    yielding = (async () => {
      try {
        await deps.onYield();
      } catch (err) {
        // 交出去的準備出錯也要放掉鎖（不然另一個分頁永遠等不到）；寫入已經被 guardWrites 擋住
        console.error(err);
      } finally {
        held = false;
        const r = release;
        release = null;
        r?.();
      }
    })().finally(() => {
      yielding = null;
    });
  });

  return {
    supported,
    acquire,
    // 交出去的途中（onYield）還算拿著：要存好這張卡才放掉
    holding: () => !supported || held,
  };
}

/** 存檔的寫入都要拿著編輯鎖才做（讀不擋）：被接手的分頁什麼都不能寫。 */
export function guardWrites(store: CardStore, canWrite: () => boolean): CardStore {
  const refuse = () => Promise.reject(new HandedOffError());
  return {
    list: () => store.list(),
    hasCards: () => store.hasCards(),
    load: (id) => store.load(id),
    loadImage: (hash) => store.loadImage(hash),
    getMeta: (key) => store.getMeta(key),
    estimate: () => store.estimate(),
    save: (card, thumbnail) => (canWrite() ? store.save(card, thumbnail) : refuse()),
    saveThumbnail: (id, updatedAt, thumbnail) => (canWrite() ? store.saveThumbnail(id, updatedAt, thumbnail) : refuse()),
    remove: (id) => (canWrite() ? store.remove(id) : refuse()),
    saveImage: (image) => (canWrite() ? store.saveImage(image) : refuse()),
    cleanupImages: () => (canWrite() ? store.cleanupImages() : refuse()),
    setMeta: (key, value) => (canWrite() ? store.setMeta(key, value) : refuse()),
    updateMeta: (key, update) => (canWrite() ? store.updateMeta(key, update) : refuse()),
  };
}

/** 瀏覽器的 navigator.locks（沒有就 null）。 */
export function browserLocks(): LockManagerLike | null {
  const manager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!manager || typeof manager.request !== 'function') return null;
  return { request: (name, options, callback) => manager.request(name, options, callback) };
}

/** 瀏覽器的 BroadcastChannel（沒有就 null）。 */
export function browserChannel(): ChannelLike | null {
  if (typeof BroadcastChannel !== 'function') return null;
  const channel = new BroadcastChannel(TAB_CHANNEL_NAME);
  return {
    post: (message) => channel.postMessage(message),
    listen: (handler) => channel.addEventListener('message', (event) => handler(event.data)),
  };
}
