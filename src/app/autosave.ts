// 自動存（SCHEMA §3、DESIGN 7.1）：沒有「存檔」按鈕，東西永遠不會不見。
// - 存的時機由組裝端告訴 changed()：一個動作完成（或一次拖曳放開）→ 馬上存；文字輸入 → 停手後才存；
//   切換卡片、分頁變成隱藏、離開頁面 → flush() 立刻存。一改動頁首就顯示「儲存中…」，存好才回到「已儲存」。
// - 存之前先 saveImage 這張卡用到的每張圖（已存在的會被略過），再 save 卡片（存檔模組會用真的圖片清單驗卡）。
// - 排隊：同時只跑一個存檔；存的過程中又有變動，就存完再存一次「當下最新的」（排隊中的好幾次合成一次）。
//   匯入、刪卡等其他寫入用 exclusive() 排進同一條隊伍，不會和存檔交錯（例如刪卡清圖清到正要存的圖）。
// - 存失敗：只改狀態（「沒存到」），記憶體裡的卡一個字都不動；下一次改動或 flush 會再試。
// - 縮圖（給卡片庫）不用每次都產生：停手約 2 秒後、或切換卡片／離開前產生一次。卡片一定先存（不等拍縮圖），
//   縮圖拍好再用 saveThumbnail 只補縮圖（資料庫裡還是這個版本才寫，T-409：不會把整張舊版寫回去）。
//   縮圖失敗、太久沒回來、或沒拿到就先不要，下次再補。
// - 交出編輯權（T-409，另一個分頁接手）：suspend() 等隊伍跑完就停，之後什麼都不寫；resume() 才恢復。
//   交接不等縮圖（T-412）：pauseThumbnails() 讓正在等的縮圖不等了、之後也不拍（接手的分頁開卡後會自己補），resume() 才恢復。
// - 轉動影片／GIF 匯出中（T-512）：3D 預覽畫的是開始時複製的那份卡，拍到的縮圖不是編輯中的最新版 → holdThumbnails() 先不拍
//   （卡片資料照常存），放開時補拍目前這一版。
// - 只在記憶體的備援卡（T-412，讀不到卡片庫時給的空白卡）：沒改過就不存（縮圖、換卡、離開都不會順便把它存進卡片庫、改 lastOpenedId）；
//   使用者改了它，那就是使用者的東西，照常存。
// 這個模組不碰 DOM、three.js；縮圖怎麼拍由組裝端注入。

import type { StoredImage } from '../images/types';
import { cardImages } from '../model/foil';
import type { Card } from '../model/types';
import type { CardStore, StorageEstimate } from '../storage/types';
import { TEXT_IDLE_MS } from '../ui/logic';
import type { SaveStatus } from '../ui/types';
import { HandedOffError } from './tab-lock';

/** meta 裡記「上次編輯的卡片 id」的 key（SCHEMA §3）。 */
export const LAST_OPENED_KEY = 'lastOpenedId';
/** 動作停手多久補一張縮圖。 */
export const THUMBNAIL_IDLE_MS = 2000;
/** 縮圖最多等多久（分頁在背景時 GPU 讀回可能很慢）；超過就先不要、下次再補。 */
export const THUMBNAIL_TIMEOUT_MS = 3000;
/** 文字輸入「停手 1 秒後存」：文字框已經停手 0.6 秒才送出改動（TEXT_IDLE_MS），這裡再等剩下的。 */
export const TEXT_SAVE_DELAY_MS = 1000 - TEXT_IDLE_MS;
/** 每存幾次查一次容量（開啟時也查一次）。 */
export const CAPACITY_CHECK_EVERY = 20;
/** 剩不到這個比例就提醒（DESIGN 7.2）。 */
const LOW_SPACE_RATIO = 0.1;

/** 容量剩不到 10%？查不到（null）或配額是 0 就當作沒問題。 */
export function storageNearlyFull(estimate: StorageEstimate | null): boolean {
  if (!estimate || !(estimate.quota > 0)) return false;
  return (estimate.quota - estimate.usage) / estimate.quota < LOW_SPACE_RATIO;
}

/** 卡片用到的圖（不重複，先正面後背面；反光層的黑白圖也算，T-417——存檔、換卡的 retain、匯出時 hold 都用它）。 */
export function cardImageHashes(card: Card): string[] {
  return cardImages(card);
}

export interface AutoSaverDeps {
  /** null＝瀏覽器不給存（IndexedDB 打不開）：每次都是「沒存到」。 */
  store: Pick<CardStore, 'save' | 'saveThumbnail' | 'saveImage' | 'setMeta' | 'estimate'> | null;
  /** 要存的卡（編輯中的那一張）；還沒開好卡＝null。 */
  current(): Card | null;
  /** 記憶體裡的圖（圖片登記簿）。 */
  image(hash: string): StoredImage | undefined;
  /** 拍目前畫面上這張卡的正面縮圖（3D 還沒好＝null）。 */
  thumbnail(): Promise<Blob | null>;
  onStatus(status: SaveStatus): void;
  /** 容量快滿了（同一次開啟只叫一次）。 */
  onStorageLow(): void;
}

export interface AutoSaver {
  /** 卡片改了（或可能改了）：馬上顯示「儲存中…」，delayMs 後存（預設馬上；文字輸入用 TEXT_SAVE_DELAY_MS）；停手 2 秒後補縮圖。 */
  changed(delayMs?: number): void;
  /**
   * 立刻存目前這張（thumbnail＝順便補縮圖）。卡片存好（或本來就存好了）回 true，失敗回 false。
   * 只要卡片的呼叫者不用等縮圖：卡片一寫好就回。
   */
  flush(options?: { thumbnail?: boolean }): Promise<boolean>;
  /**
   * 換成另一張卡之後呼叫：saved＝這張已經在卡片庫裡（剛載入或剛存進去）。停手 2 秒後補一張縮圖。
   * memoryOnly＝只在記憶體的備援卡（讀不到卡片庫時給的空白卡）：狀態「沒存到」，但沒改過就不存、不拍縮圖。
   */
  opened(card: Card, saved: boolean, options?: { memoryOnly?: boolean }): void;
  /** 這張卡（這個版本）不用再存了嗎？存好了、null（沒有東西要存）、沒改過的備援卡都算。 */
  isSaved(card: Card | null): boolean;
  /** 其他寫入（匯入、刪卡…）排進存檔的隊伍，不和存檔同時跑。停住（suspend）之後會被拒絕。 */
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  status(): SaveStatus;
  /** 查一次容量：快滿了就提醒（同一次開啟只提醒一次）。 */
  checkCapacity(): Promise<void>;
  /**
   * 停住（另一個分頁接手，T-409）：取消排定的存檔與縮圖，等隊伍裡的工作跑完才 resolve；之後 changed、flush 什麼都不寫，
   * exclusive 直接拒絕（HandedOffError）。呼叫端要自己先 flush（停住不會替你存）。
   */
  suspend(): Promise<void>;
  /** 交接開始（T-412）：取消排定的縮圖，正在等的縮圖不等了（只等卡片資料存好），之後也不拍，直到 resume。 */
  pauseThumbnails(): void;
  /**
   * 匯出中先不拍縮圖（T-512）：正在等的縮圖不等了（可能拍到副本）、之後也不拍；卡片資料照常存。
   * 回傳放開的函式（呼叫多次只算一次）：全部放開後馬上補拍目前這一版（交接中、停住時不拍）。
   */
  holdThumbnails(): () => void;
  /**
   * 恢復（重新拿回編輯權，T-409）：記憶體裡這張當作「不用存」——它是交出去之前的舊版，存檔裡的才是最新的，不能寫回去；
   * 組裝端接著從存檔重新開卡。交出去時沒存到的版本要在這之前另存（session.reload，T-412）。縮圖恢復照常拍。
   */
  resume(): void;
}

interface Waiter {
  /** 要等縮圖也存好才回（只要卡片的呼叫者卡片寫好就回）。 */
  thumbnail: boolean;
  done(ok: boolean): void;
}

type Job = { kind: 'save'; waiters: Waiter[] } | { kind: 'task'; run: () => Promise<void> };

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function createAutoSaver(deps: AutoSaverDeps): AutoSaver {
  const { store } = deps;
  /** 最後一次存好的那個卡片物件（卡片資料不可變：同一個物件＝同一個版本）。 */
  let lastSaved: Card | null = null;
  /** 最後一次存進去的縮圖拍的是哪個版本。 */
  let thumbFor: Card | null = null;
  /** lastOpenedId 目前記的是誰（一樣就不重寫）。 */
  let metaId: string | null = null;
  let status: SaveStatus = 'saved';
  let saves = 0;
  let warnedLow = false;
  /** 交出編輯權了：什麼都不寫。 */
  let suspended = false;
  /** 只在記憶體的備援卡（沒改過就不存）。 */
  let memoryOnly: Card | null = null;
  /** 交接中：不拍縮圖（T-412）。 */
  let thumbsPaused = false;
  /** 叫醒正在等的縮圖（當作沒拍到）。 */
  let skipThumbWait = () => {};
  /** 匯出中（T-512）：幾個匯出要先不拍縮圖。 */
  let thumbHolds = 0;
  const thumbsOff = () => thumbsPaused || thumbHolds > 0;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let thumbTimer: ReturnType<typeof setTimeout> | undefined;

  const jobs: Job[] = [];
  let running = false;
  /** 等隊伍空下來的人（suspend）。 */
  let idleWaiters: (() => void)[] = [];

  /** 不用再存了：沒有卡、存好的那一版、沒改過的備援卡。 */
  const isSaved = (card: Card | null) => card === null || card === lastSaved || card === memoryOnly;

  const setStatus = (next: SaveStatus) => {
    if (next === status) return;
    status = next;
    deps.onStatus(next);
  };

  const clearTimers = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    clearTimeout(thumbTimer);
    thumbTimer = undefined;
  };

  const checkCapacity = async () => {
    if (!store || warnedLow) return;
    try {
      if (storageNearlyFull(await store.estimate())) {
        warnedLow = true;
        deps.onStorageLow();
      }
    } catch {
      // 查不到容量就算了
    }
  };

  /** 還有排著的存檔（計時器或隊伍裡）：狀態先別顯示「已儲存」。 */
  const morePending = () => saveTimer !== undefined || jobs.some((j) => j.kind === 'save');

  /** 補縮圖：畫面上還是這個版本才拍；拿到了而且資料庫裡還是這個版本才寫（只寫縮圖）。失敗不算沒存到。交接中不拍、不等。 */
  const saveThumbnail = async (card: Card) => {
    if (!store || thumbsOff() || deps.current() !== card) return;
    const thumb = await new Promise<Blob | null>((resolve) => {
      skipThumbWait = () => resolve(null);
      void withTimeout(deps.thumbnail(), THUMBNAIL_TIMEOUT_MS, null).then(resolve);
    }).finally(() => {
      skipThumbWait = () => {};
    });
    if (!thumb || thumbsOff()) return;
    try {
      if (await store.saveThumbnail(card.id, card.updatedAt, thumb)) thumbFor = card;
    } catch (err) {
      console.error(err);
    }
  };

  /**
   * 存「現在」最新的卡；thumbnail＝縮圖不是這個版本的就補一張。卡片寫好（或本來就存好）就先叫 cardDone，
   * 不讓只要卡片的呼叫者等拍縮圖。回傳卡片有沒有存好。
   */
  const saveLatest = async (thumbnail: boolean, cardDone: (ok: boolean) => void): Promise<boolean> => {
    const card = deps.current();
    // 停住了、沒有卡、沒改過的備援卡：什麼都不寫（狀態也不動）
    if (suspended || !card || card === memoryOnly) {
      const ok = isSaved(card);
      cardDone(ok);
      return ok;
    }
    if (!store) {
      setStatus('error');
      cardDone(false);
      return false;
    }
    if (card !== lastSaved) {
      setStatus('saving');
      try {
        for (const hash of cardImageHashes(card)) {
          const image = deps.image(hash);
          if (!image) throw new Error(`記憶體裡找不到圖 ${hash}，沒有存`);
          await store.saveImage(image);
        }
        await store.save(card);
        lastSaved = card;
        // 備援卡存進卡片庫之後就是一般卡：之後復原回最初的空白狀態也要照常存
        memoryOnly = null;
      } catch (err) {
        console.error(err);
        setStatus('error');
        cardDone(false);
        return false;
      }
      if (metaId !== card.id) {
        try {
          await store.setMeta(LAST_OPENED_KEY, card.id);
          metaId = card.id;
        } catch (err) {
          // 卡片已經存好了；記不住「上次開的卡」只會讓下次開到最近編輯的那張
          console.error(err);
        }
      }
      saves += 1;
      if (saves % CAPACITY_CHECK_EVERY === 0) await checkCapacity();
    }
    // 又有改動排著（計時器或隊伍裡）就繼續顯示「儲存中…」
    setStatus(morePending() ? 'saving' : 'saved');
    cardDone(true);
    if (thumbnail && card !== thumbFor) await saveThumbnail(card);
    return true;
  };

  const notifyIdle = () => {
    if (running || jobs.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  };

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (jobs.length > 0) {
        const job = jobs.shift()!;
        if (job.kind === 'task') {
          await job.run(); // run 不會丟錯（錯誤已經交給 exclusive 的呼叫端）
          continue;
        }
        // 等待者一定要被通知（就算存檔程式自己出錯，例如畫狀態時丟錯），不然換卡會一直等下去
        const waiting = job.waiters;
        let ok = false;
        try {
          ok = await saveLatest(
            waiting.some((w) => w.thumbnail),
            (cardOk) => {
              for (const w of waiting) if (!w.thumbnail || !cardOk) w.done(cardOk);
            },
          );
        } catch (err) {
          console.error(err);
        } finally {
          for (const w of waiting) w.done(ok);
        }
      }
    } finally {
      running = false;
      notifyIdle();
    }
  };

  const requestSave = (thumbnail: boolean): Promise<boolean> => {
    // 還沒開始跑的存檔可以合併（反正都是存「當下最新的」）
    const last = jobs[jobs.length - 1];
    let job: Extract<Job, { kind: 'save' }>;
    if (last?.kind === 'save') {
      job = last;
    } else {
      job = { kind: 'save', waiters: [] };
      jobs.push(job);
    }
    const done = new Promise<boolean>((resolve) => {
      let settled = false;
      job.waiters.push({
        thumbnail,
        done(ok) {
          if (settled) return;
          settled = true;
          resolve(ok);
        },
      });
    });
    void pump();
    return done;
  };

  const flush = (options: { thumbnail?: boolean } = {}): Promise<boolean> => {
    if (suspended) return Promise.resolve(isSaved(deps.current()));
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (options.thumbnail) {
      clearTimeout(thumbTimer);
      thumbTimer = undefined;
    }
    return requestSave(options.thumbnail === true);
  };

  const scheduleThumbnail = () => {
    clearTimeout(thumbTimer);
    thumbTimer = undefined;
    if (thumbsPaused) return;
    thumbTimer = setTimeout(() => {
      thumbTimer = undefined;
      void flush({ thumbnail: true });
    }, THUMBNAIL_IDLE_MS);
  };

  return {
    changed(delayMs = 0) {
      if (suspended) return;
      // 一改動就顯示「儲存中…」（文字輸入要停手才存，不能讓頁首在這段時間還說「已儲存」）
      if (store && deps.current() !== null && deps.current() !== lastSaved) setStatus('saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void flush();
      }, delayMs);
      scheduleThumbnail();
    },

    flush,

    opened(card, saved, options = {}) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      lastSaved = saved ? card : null;
      memoryOnly = !saved && options.memoryOnly ? card : null;
      thumbFor = null;
      if (saved) metaId = card.id;
      setStatus(saved ? 'saved' : 'error');
      // 備援卡沒改過不拍縮圖（拍了也不存）
      if (!suspended && memoryOnly === null) scheduleThumbnail();
    },

    isSaved,

    exclusive(task) {
      if (suspended) return Promise.reject(new HandedOffError());
      return new Promise((resolve, reject) => {
        // Promise.resolve().then：task 就算同步丟錯也變成拒絕，隊伍不會卡住
        jobs.push({ kind: 'task', run: () => Promise.resolve().then(task).then(resolve, reject) });
        void pump();
      });
    },

    status: () => status,
    checkCapacity,

    async suspend() {
      clearTimers();
      // 檢查「隊伍空了」和設成停住之間沒有 await：中間不會有新的寫入插進來
      while (running || jobs.length > 0) await new Promise<void>((resolve) => idleWaiters.push(resolve));
      suspended = true;
    },

    pauseThumbnails() {
      thumbsPaused = true;
      clearTimeout(thumbTimer);
      thumbTimer = undefined;
      skipThumbWait();
    },

    holdThumbnails() {
      thumbHolds += 1;
      skipThumbWait();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        thumbHolds -= 1;
        if (thumbHolds === 0 && !suspended && !thumbsPaused) void flush({ thumbnail: true });
      };
    },

    resume() {
      suspended = false;
      thumbsPaused = false;
      lastSaved = deps.current();
      thumbFor = lastSaved;
    },
  };
}
