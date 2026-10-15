// 卡片庫的資料流（T-404；T-407 的卡片庫與新卡片面板沿用）：開啟工坊、切換卡片、建立新卡、匯入、刪除。
// 原則（DESIGN §7）：東西永遠不會不見——換卡、開新卡之前一定先把目前這張存好；存不起來就不換。
// 這個模組不碰 DOM、three.js：圖片登記簿、「顯示這張卡」、縮圖怎麼拍都由組裝端（main）注入，所以能在 node 用 fake-indexeddb 測。
// 所有會改卡片庫的動作一次只做一個（serial），寫入和自動存排在同一條隊伍（saver.exclusive）。
// 一次只有一個分頁能編輯（T-409，鎖在 tab-lock.ts）：被接手時 handOff（存好、停住），拿回來時 reload（重新讀卡片庫）。
// 交出去時沒存到的版本（存檔壞了）不能在拿回來時被丟掉（T-412）：reload 先把它另存成「卡名（沒存到的版本）」，存不進去就留在畫面上。
// AI 去背／拆層做完時已經換到別張卡（T-703、T-704）：editStored（addLayerTo 也走它）把結果加到存檔裡開始時那張（不用打開它）。

import { S } from '../i18n';
import type { ImportError, ImportHolocard } from '../file/types';
import type { StoredImage } from '../images/types';
import { addLayer, updateCard, type NewLayerInput } from '../model/actions';
import { firstChars, NAME_MAX } from '../model/limits';
import type { Card, FaceSide } from '../model/types';
import type { CardStore, CardSummary } from '../storage/types';
import type { LibraryCard, LibraryData, SaveStatus } from '../ui/types';
import { cardImageHashes, createAutoSaver, LAST_OPENED_KEY, storageNearlyFull, type AutoSaver } from './autosave';
import { HandedOffError } from './tab-lock';

const COPY_SUFFIX = S.defaults.copySuffix;
const UNSAVED_SUFFIX = S.defaults.unsavedSuffix;

/** 原名＋後綴；加了會超過 60 字就先截原名（以 Unicode 字元計）。空的用「未命名卡片」。 */
function withSuffix(name: string, suffix: string): string {
  const room = NAME_MAX - Array.from(suffix).length;
  const base = firstChars(name.trim(), room).trim() || S.defaults.cardName;
  return `${base}${suffix}`;
}

/** 複製一份的卡名：原名＋「（副本）」；加了會超過 60 字就先截原名（以 Unicode 字元計）。空的用「未命名卡片」。 */
export function copyName(name: string): string {
  return withSuffix(name, COPY_SUFFIX);
}

/** 交出去時沒存到的版本另存的卡名（T-412）：原名＋「（沒存到的版本）」；已經是這種卡名就不再加。 */
export function unsavedCopyName(name: string): string {
  return name.trim().endsWith(UNSAVED_SUFFIX) ? name.trim() : withSuffix(name, UNSAVED_SUFFIX);
}

/** 刪掉開著的那張之後，依序試著打開哪幾張：其他卡依最近編輯排序（日期壞掉的排最後）。空的＝沒有別張。 */
export function openOrderAfterDelete(cards: readonly Pick<CardSummary, 'id' | 'updatedAt'>[], deletedId: string): string[] {
  const time = (s: string) => {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : -Infinity;
  };
  return cards
    .filter((c) => c.id !== deletedId)
    .map((c, i) => ({ id: c.id, t: time(c.updatedAt), i }))
    .sort((a, b) => (b.t === a.t ? a.i - b.i : b.t > a.t ? 1 : -1))
    .map((c) => c.id);
}

/** 圖片登記簿（images/registry）裡這裡會用到的部分。 */
export interface SessionImages {
  /** 加入並解碼（render 才拿得到）。 */
  add(image: StoredImage): Promise<void>;
  get(hash: string): StoredImage | undefined;
  /** 只留這些圖，其他的釋放（換卡時）。 */
  retain(keep: ReadonlySet<string>): void;
}

export interface SessionDeps {
  /** null＝瀏覽器不給存：卡片只在記憶體，狀態一直是「沒存到」。 */
  store: CardStore | null;
  /** 瀏覽器持久保存 API；不支援或拒絕都不影響存檔。 */
  storage?: Partial<Pick<StorageManager, 'persisted' | 'persist'>>;
  images: SessionImages;
  /** 編輯中的卡（要存的那一份）；還沒開卡＝null。 */
  current(): Card | null;
  /** 換成這張卡：新的復原堆疊、畫面與 3D 更新。 */
  show(card: Card): void;
  /** 目前這張卡的正面縮圖（3D 還沒好＝null）。 */
  thumbnail(): Promise<Blob | null>;
  /** 等進行中的上傳、畫字做完（換卡前；不然結果會加到新卡上）。 */
  settle(): Promise<void>;
  /**
   * 等已經開始的匯入、建立範例做完（交出編輯權前，T-412；它們做完會換卡、存進卡片庫）。只在 handOff 用：
   * 它們自己會走 adopt（裡面會 settle），所以不能放進 settle，不然會等到自己。
   */
  settleWork?(): Promise<void>;
  onStatus(status: SaveStatus): void;
  onStorageLow(): void;
}

/**
 * opened＝換好了；not-saved＝目前這張存不起來，沒換；missing＝那張卡（或它的圖）讀不到，沒換；
 * away＝這個分頁已經交給別的分頁編輯（寫入被拒絕），沒換（T-412）。
 */
export type OpenResult = 'opened' | 'not-saved' | 'missing' | 'away';

export interface StartChoice {
  card: Card;
  /** 存過的正面縮圖：3D 準備好之前先顯示。 */
  thumbnail?: Blob;
}

export type ImportOutcome = { ok: true; card: Card; result: OpenResult } | { ok: false; reason: ImportError };

export interface AdoptOptions {
  /** false＝不存進卡片庫（啟動時讀不到卡片庫：給一張只在記憶體的空白卡，狀態「沒存到」）。預設 true。 */
  save?: boolean;
}

/**
 * 接手後重新開卡的結果：opened＝開了上次編輯的那張；empty／open-failed＝卡片庫是空的／那張打不開，改開 makeBlank() 存進去；
 * unreadable＝讀不到卡片庫，開 makeBlank() 但不存；kept＝交出去時沒存到的版本還是存不進去：不重新讀，留在畫面上（T-412）。
 */
export type ReloadResult = 'opened' | 'empty' | 'open-failed' | 'unreadable' | 'kept';

export interface ReloadOutcome {
  result: ReloadResult;
  /** 交出去時沒存到的版本另存成的卡名（kept＝還沒存進去、留在畫面上的那張）。沒有沒存到的版本就沒有這個欄位。 */
  rescued?: string;
}

/** 複製一份的結果：missing＝那張卡讀不到；not-saved＝要複製的是開著的那張、但它存不起來。 */
export type DuplicateOutcome = { ok: true; card: Card } | { ok: false; reason: 'missing' | 'not-saved' };

/** session.editStored 的結果（T-704）：saved＝存好了；problem＝edit 說放不下（不存）。 */
export type EditStoredOutcome<P> = { result: 'saved'; cardName: string } | { result: 'is-open' | 'missing' } | { result: 'problem'; problem: P };

/** session.addLayerTo 的結果（T-703）。 */
export type AddLayerToOutcome =
  | { result: 'added'; cardName: string }
  | { result: 'is-open' | 'missing' | 'face-full' | 'too-many-images' | 'invalid-input' };

/** 匯出某張卡（不用先打開它）要用的東西。 */
export interface ExportSource {
  card: Card;
  images: StoredImage[];
  /** 卡片庫存的正面縮圖（沒有就 undefined）。 */
  thumbnail?: Blob;
}

export interface Session {
  /** 自動存（main 在卡片改了時呼叫 saver.changed、離開頁面時 saver.flush）。 */
  readonly saver: AutoSaver;
  /**
   * 開啟工坊要開哪張（DESIGN 7.4）：先清一次沒人用的圖 → 上次編輯的那張（lastOpenedId）→ 最近編輯的那張 → null（卡片庫是空的，
   * 由組裝端把範例卡片檔匯入成使用者的卡：第一張交給 adopt、其他交給 addToLibrary，T-605b）。
   * 讀不到卡片庫（存檔打不開、清單或卡片讀取出錯）就丟錯——和「沒有卡」不一樣：組裝端不能因此再匯入範例（T-409、T-412）。
   * 有卡但一張都讀不出來（T-605c：儲存層會略過缺圖、不合格的紀錄，清單可能是空的）也丟錯：資料庫裡還有卡片紀錄
   * （store.hasCards）就不是第一次使用。
   */
  chooseStart(): Promise<StartChoice | null>;
  /** 打開 chooseStart 選的卡：圖從存檔載入登記簿 → 顯示。缺圖或解不開就丟錯（組裝端改開空白卡）。 */
  openStart(card: Card): Promise<void>;
  /** 開啟卡片庫裡的另一張：先存好目前這張（含縮圖）→ 載入那張與它的圖 → 顯示（復原堆疊清空）→ 釋放舊卡的圖 → lastOpenedId。 */
  open(id: string): Promise<OpenResult>;
  /**
   * 一張全新的卡（空白卡、範例副本、匯入的卡；images＝它用到的圖）：先存好目前這張 → 圖先解碼（解不開回 missing，什麼都不存）→
   * 新卡存進卡片庫 → 打開。新卡存不進去也照樣打開（狀態「沒存到」、之後自動重試）；目前這張存不起來就不換。
   */
  adopt(card: Card, images: readonly StoredImage[], options?: AdoptOptions): Promise<OpenResult>;
  /**
   * 存進卡片庫但不打開（T-605b：第一次開啟時，第一張以外的範例）：圖先存、再存卡；不換卡、不動登記簿與 lastOpenedId。
   * 存好回 true；存不進去（卡片不合格、存檔出錯、存檔不能用、已經交給別的分頁）回 false。
   * thumbnail＝卡片庫縮圖（範例卡片檔裡的 preview.png；沒打開過的卡不會自己拍縮圖，T-808 驗收時發現）。
   */
  addToLibrary(card: Card, images: readonly StoredImage[], thumbnail?: Blob): Promise<boolean>;
  /**
   * 組裝端把資料流交給畫面時呼叫（T-605c）：開卡途中畫面可能已經能改（第一次開啟時，第一張範例打開了、其他範例還在讀），
   * 那時改的沒有排存檔——目前這張不是存檔裡的版本就馬上排一次存檔（狀態顯示「儲存中…」）。沒改過就什麼都不做。
   */
  saveIfChanged(): void;
  /** 匯入卡片檔：檢查（importer＝file/holocard 的 importHolocard）→ adopt。失敗回原因（畫面顯示白話）；圖解不開＝bad-image（卡片檔壞掉了）。 */
  importFile(file: Blob, importer: ImportHolocard, ids: { newId: () => string; now: () => string }): Promise<ImportOutcome>;
  /** 卡片庫清單（依最近編輯排序）；存檔不能用或讀不到 → 空清單。 */
  list(): Promise<CardSummary[]>;
  /** 刪掉一張卡（和它獨用的圖）。開著的那張不能刪（is-open）：要先開別張。 */
  remove(id: string): Promise<'removed' | 'is-open'>;

  // ---- 卡片庫面板（T-407，DESIGN 7.2） ----

  /** 卡片庫的內容：先存好目前這張（含縮圖）→ 清單（沒有縮圖的附卡身顏色）＋容量快滿了沒。存檔不能用 → 空的。 */
  library(): Promise<LibraryData>;
  /**
   * 在卡片庫改名（不用打開那張）：存進去，updatedAt 不動（格子不會跳走，「幾分鐘前編輯」說的是內容）。
   * 開著的那張回 is-open（畫面改走 editCard，可以復原）；空白名字不改；讀不到回 missing。存檔出錯就丟錯。
   */
  rename(id: string, name: string): Promise<'renamed' | 'is-open' | 'missing'>;
  /**
   * 複製一份：新 id、卡名加「（副本）」、新時間、圖共用（同一張圖只存一份）、縮圖一起複製；放進卡片庫但不切換過去。
   * 複製開著的那張時先存好它（複製的是最新版）。存檔出錯就丟錯。
   */
  duplicate(id: string, ids: { newId: () => string; now: () => string }): Promise<DuplicateOutcome>;
  /** 匯出某張卡（不用先打開）要用的卡片、圖、縮圖；讀不到或缺圖回 null。不換卡、不動登記簿。 */
  cardForExport(id: string): Promise<ExportSource | null>;
  /**
   * 把一層加到卡片庫裡的某張卡（T-703：AI 去背做完時已經換到別張卡，就加到開始時那張），不用打開它。
   * 開著的那張回 is-open（畫面改走編輯器：記一步、可以復原）；讀不到（被刪了）或存檔不能用回 missing；
   * 放不下回 face-full／too-many-images（卡不變）；成功：圖先存、再存卡（updatedAt＝now，縮圖保留舊的）→ added＋卡名。
   * 和換卡、刪卡排在同一條隊伍。存檔出錯就丟錯。
   */
  addLayerTo(id: string, face: FaceSide, input: NewLayerInput, image: StoredImage, now: string): Promise<AddLayerToOutcome>;
  /**
   * 改卡片庫裡的某張卡（T-704：AI 拆層做完時已經換到別張卡），不用打開它：edit 回新卡 → 圖先存、再存卡（updatedAt＝now，縮圖保留舊的）
   * → saved＋卡名；edit 回 problem → 不存。開著的那張回 is-open（畫面改走編輯器）；讀不到（被刪了）或存檔不能用回 missing。
   * 和換卡、刪卡排在同一條隊伍。存檔出錯就丟錯。
   */
  editStored<P>(
    id: string,
    images: readonly StoredImage[],
    edit: (card: Card) => { card: Card } | { problem: P },
    now: string,
  ): Promise<EditStoredOutcome<P>>;
  /**
   * 刪除（確認框之後）。刪的是開著的那張：等上傳做完 → 先開最近編輯的另一張（讀不到就試下一張；沒有別張就建 makeBlank()
   * 存進卡片庫）→ 再刪（它改到一半的內容不用存，反正要刪）。刪卡會清掉只有那張卡用的圖。存檔出錯就丟錯。
   */
  deleteCard(id: string, makeBlank: () => Card): Promise<void>;

  // ---- 一次只有一個分頁能編輯（T-409） ----

  /**
   * 交出編輯權（另一個分頁要接手）：縮圖不等了（T-412）→ 等已經開始的匯入、建立範例做完 → 等進行中的換卡、上傳、畫字做完 →
   * 存好目前這張 → 自動存停住（之後什麼都不寫）。回目前這張有沒有存好（false＝有改動沒存到，畫面提醒先匯出備份）。
   */
  handOff(): Promise<boolean>;
  /**
   * 拿回編輯權之後（T-412）：交出去時有沒存到的版本 → 先另存成新的一張（新 id、卡名加「（沒存到的版本）」、圖先存、不改 lastOpenedId）；
   * 存不進去 → 不重新讀、不收回圖，留在畫面上（換成那張新的、狀態「沒存到」，之後自動重試，不會蓋掉別的分頁存的）＝kept。
   * 接著記憶體裡的舊版不再寫回去 → 重新讀卡片庫、打開上次編輯的那張（別的分頁可能改過，不能用記憶體裡的）。
   * 卡片庫是空的或那張打不開 → 開 makeBlank() 並存進去；讀不到卡片庫 → 開 makeBlank() 但不存。
   */
  reload(makeBlank: () => Card, ids: { newId: () => string; now: () => string }): Promise<ReloadOutcome>;
}

export function createSession(deps: SessionDeps): Session {
  const { store, images } = deps;
  let openedCard: Card | null = null;
  let persistenceRequested = false;
  const requestPersistence = async (): Promise<void> => {
    if (persistenceRequested) return;
    persistenceRequested = true;
    try {
      const storage = deps.storage;
      if (!storage?.persisted || !storage.persist) return;
      if (await storage.persisted()) return;
      console.info('Storage persistence:', await storage.persist());
    } catch (err) {
      console.warn('Storage persistence:', err);
    }
  };
  const saver = createAutoSaver({
    store: store ? {
      save: async (card, thumbnail) => {
        await store.save(card, thumbnail);
        // 只看自動存的改版：匯入、建立範例、開卡與補縮圖不算使用者改卡。
        if (openedCard && card !== openedCard) void requestPersistence();
      },
      saveThumbnail: (...args) => store.saveThumbnail(...args),
      saveImage: (image) => store.saveImage(image),
      setMeta: (key, value) => store.setMeta(key, value),
      estimate: () => store.estimate(),
    } : null,
    current: deps.current,
    image: (hash) => images.get(hash),
    thumbnail: deps.thumbnail,
    onStatus: deps.onStatus,
    onStorageLow: deps.onStorageLow,
  });

  // 換卡、建卡、刪卡一次只做一個（連點兩張卡也會依序換好）
  let ops: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = ops.then(task, task);
    ops = run.catch(() => {});
    return run;
  };

  /** 換卡前：等上傳、畫字做完，存好目前這張（含縮圖）。存檔不能用時不擋（什麼都存不了，擋住就永遠開不了新卡）。 */
  const saveCurrent = async (): Promise<boolean> => {
    await deps.settle();
    if (!store) return true;
    return saver.flush({ thumbnail: true });
  };

  /** 從存檔讀這張卡用到的圖（登記簿裡已經有的就不讀）。缺圖就丟錯。 */
  const loadStoredImages = async (card: Card): Promise<StoredImage[]> => {
    const out: StoredImage[] = [];
    for (const hash of cardImageHashes(card)) {
      const image = images.get(hash) ?? (await store?.loadImage(hash));
      if (!image) throw new Error(`存檔裡缺圖 ${hash}`);
      out.push(image);
    }
    return out;
  };

  /**
   * 換成 card：圖進登記簿 → 確定舊卡的最新版存好了 → 顯示 → 只留新卡的圖 → 記成已儲存、lastOpenedId。
   * discardCurrent＝舊卡馬上要刪掉，不用等它存好。memoryOnly＝只在記憶體的備援卡（沒改過就不存）。
   */
  const switchTo = async (
    card: Card,
    cardImages: readonly StoredImage[],
    saved: boolean,
    discardCurrent = false,
    memoryOnly = false,
  ): Promise<OpenResult> => {
    try {
      for (const image of cardImages) await images.add(image);
    } catch (err) {
      console.error(err);
      return 'missing';
    }
    // 等圖解碼的時候舊卡可能又被改了：存到最新版才換（檢查和換之間沒有 await，中間不會再被改）
    while (!discardCurrent && store && !saver.isSaved(deps.current())) {
      if (!(await saver.flush())) return 'not-saved';
    }
    openedCard = card;
    deps.show(card);
    images.retain(new Set(cardImageHashes(card)));
    saver.opened(card, saved, { memoryOnly });
    if (saved && store) {
      await saver.exclusive(() => store.setMeta(LAST_OPENED_KEY, card.id)).catch((err: unknown) => console.error(err));
    }
    return 'opened';
  };

  /** adopt 的內容（不排 serial：reload 在 serial 裡面也要用）。 */
  const adoptNow = async (card: Card, cardImages: readonly StoredImage[], options: AdoptOptions = {}): Promise<OpenResult> => {
    if (!(await saveCurrent())) return 'not-saved';
    // 圖先解碼：解不開（例如匯入的卡片檔裡的圖壞掉）就不存，卡片庫不會多一張打不開的卡
    try {
      for (const image of cardImages) await images.add(image);
    } catch (err) {
      console.error(err);
      return 'missing';
    }
    let saved = false;
    if (store && options.save !== false) {
      try {
        await saver.exclusive(async () => {
          for (const image of cardImages) await store.saveImage(image);
          await store.save(card);
        });
        saved = true;
      } catch (err) {
        // 已經交給別的分頁編輯：不是「存失敗但照樣換」，是不能再換卡（T-412）
        if (err instanceof HandedOffError) return 'away';
        console.error(err);
      }
    }
    return switchTo(card, cardImages, saved, false, options.save === false);
  };

  const adopt: Session['adopt'] = (card, cardImages, options = {}) => serial(() => adoptNow(card, cardImages, options));

  const list = async (): Promise<CardSummary[]> => {
    if (!store) return [];
    try {
      return await store.list();
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  /** 讀一張卡和它用到的圖（給換卡用）；讀不到或缺圖回 null。 */
  const loadWithImages = async (id: string): Promise<{ card: Card; images: StoredImage[] } | null> => {
    const card = await store?.load(id).catch(() => undefined);
    if (!card) return null;
    try {
      return { card, images: await loadStoredImages(card) };
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const chooseStart: Session['chooseStart'] = async () => {
    // 存檔整個打不開：讀不到（不是「沒有卡」），組裝端不能當成第一次使用去建範例（T-412）
    if (!store) throw new Error('存檔打不開，讀不到卡片庫');
    // 程式剛啟動（或剛拿回編輯權、記憶體裡的卡要整個換掉）：沒有任何復原堆疊會指到沒人用的圖（SCHEMA §3）；一定要在任何存檔之前做
    try {
      await store.cleanupImages();
    } catch (err) {
      console.error(err);
    }
    // 下面讀不到就丟錯（不是回 null：null＝卡片庫是空的）
    const summaries = await store.list();
    const tryLoad = async (id: string | undefined): Promise<StartChoice | null> => {
      const card = id ? await store.load(id) : undefined;
      if (!card) return null;
      const thumbnail = summaries.find((s) => s.id === card.id)?.thumbnail;
      return thumbnail ? { card, thumbnail } : { card };
    };
    const last = await tryLoad(await store.getMeta(LAST_OPENED_KEY));
    if (last) return last;
    for (const summary of summaries) {
      const choice = await tryLoad(summary.id);
      if (choice) return choice;
    }
    // 一張都開不了：資料庫裡真的一筆卡片紀錄都沒有才是第一次使用（null）。紀錄還在、但缺圖或不合格被儲存層略過（清單是空的）
    // ＝讀不到卡片庫，不能再匯入一次範例（T-605c）
    if (summaries.length > 0 || (await store.hasCards())) throw new Error('卡片庫裡有卡，但一張都讀不出來');
    return null;
  };

  /**
   * 另存交出去時沒存到的版本（reload 用，T-412）：圖先存、再存卡；不改 lastOpenedId。存不進去回 false。
   * 這時自動存還停著（隊伍是空的），直接寫存檔；圖從記憶體（登記簿）拿。
   */
  const saveRescue = async (copy: Card): Promise<boolean> => {
    if (!store) return false;
    try {
      for (const hash of cardImageHashes(copy)) {
        const image = images.get(hash);
        if (!image) throw new Error(`記憶體裡找不到圖 ${hash}，沒有另存`);
        await store.saveImage(image);
      }
      await store.save(copy);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const editStored: Session['editStored'] = (id, cardImages, edit, now) =>
    serial(async () => {
      if (deps.current()?.id === id) return { result: 'is-open' as const };
      if (!store) return { result: 'missing' as const };
      const card = await store.load(id).catch(() => undefined);
      if (!card) return { result: 'missing' as const };
      const edited = edit(card);
      if ('problem' in edited) return { result: 'problem' as const, problem: edited.problem };
      const next: Card = { ...edited.card, updatedAt: now };
      await saver.exclusive(async () => {
        for (const image of cardImages) await store.saveImage(image);
        await store.save(next);
      });
      return { result: 'saved' as const, cardName: next.name };
    });

  return {
    saver,

    chooseStart,

    openStart: (card) =>
      serial(async () => {
        const result = await switchTo(card, await loadStoredImages(card), true);
        if (result !== 'opened') throw new Error(`打不開卡片 ${card.id}（${result}）`);
      }),

    open: (id) =>
      serial(async () => {
        if (deps.current()?.id === id) return 'opened';
        if (!store) return 'missing';
        if (!(await saveCurrent())) return 'not-saved';
        const card = await store.load(id).catch(() => undefined);
        if (!card) return 'missing';
        let cardImages: StoredImage[];
        try {
          cardImages = await loadStoredImages(card);
        } catch (err) {
          console.error(err);
          return 'missing';
        }
        return switchTo(card, cardImages, true);
      }),

    adopt,

    addToLibrary: (card, cardImages, thumbnail) =>
      serial(async () => {
        if (!store) return false;
        try {
          await saver.exclusive(async () => {
            for (const image of cardImages) await store.saveImage(image);
            await store.save(card, thumbnail);
          });
          return true;
        } catch (err) {
          if (!(err instanceof HandedOffError)) console.error(err);
          return false;
        }
      }),

    saveIfChanged() {
      if (!saver.isSaved(deps.current())) saver.changed();
    },

    async importFile(file, importer, ids) {
      let result: Awaited<ReturnType<ImportHolocard>>;
      try {
        result = await importer(file, ids);
      } catch (err) {
        // 檢查程式自己出錯：對使用者來說就是這個檔打不開
        console.error(err);
        return { ok: false, reason: 'invalid-card' };
      }
      if (!result.ok) return { ok: false, reason: result.reason };
      const opened = await adopt(result.card, result.images);
      // 圖解不開：什麼都沒存，對使用者來說就是這個卡片檔壞掉了
      if (opened === 'missing') return { ok: false, reason: 'bad-image' };
      return { ok: true, card: result.card, result: opened };
    },

    list,

    remove: (id) =>
      serial(async () => {
        if (deps.current()?.id === id) return 'is-open';
        if (store) await saver.exclusive(() => store.remove(id));
        return 'removed';
      }),

    async library() {
      if (!store) return { cards: [], storageLow: false };
      // 清單上要是最新的樣子：目前這張（含縮圖）先存好。存不起來也照樣列（狀態小字會顯示「沒存到」）
      await saver.flush({ thumbnail: true });
      const current = deps.current();
      const cards = await Promise.all(
        (await list()).map(async (summary): Promise<LibraryCard> => {
          // 有縮圖就不用讀卡；自訂比例（T-807）例外：格子照比例要寬高（清單摘要只有 aspect）
          if (summary.thumbnail && summary.aspect !== 'custom') return summary;
          const card = summary.id === current?.id ? current : await store.load(summary.id).catch(() => undefined);
          if (!card) return summary;
          const out: LibraryCard = { ...summary, bodyColor: card.bodyColor };
          if (card.aspect === 'custom' && card.customAspect) out.customAspect = { ...card.customAspect };
          return out;
        }),
      );
      let storageLow = false;
      try {
        storageLow = storageNearlyFull(await store.estimate());
      } catch {
        // 查不到容量就不提醒
      }
      return { cards, storageLow };
    },

    rename: (id, name) =>
      serial(async () => {
        if (deps.current()?.id === id) return 'is-open';
        if (!store) return 'missing';
        const card = await store.load(id).catch(() => undefined);
        if (!card) return 'missing';
        // updateCard 會整理名字（去空白、截 60 字），空白就不改；不動 updatedAt
        const next = updateCard(card, { name });
        if (next !== card) await saver.exclusive(() => store.save(next));
        return 'renamed';
      }),

    duplicate: (id, ids) =>
      serial(async (): Promise<DuplicateOutcome> => {
        if (!store) return { ok: false, reason: 'missing' };
        const isCurrent = deps.current()?.id === id;
        // 開著的那張：先存好（含縮圖），複製的才是最新版、用到的圖也都在存檔裡
        if (isCurrent && !(await saveCurrent())) return { ok: false, reason: 'not-saved' };
        const source = isCurrent ? deps.current() : await store.load(id).catch(() => undefined);
        if (!source) return { ok: false, reason: 'missing' };
        const thumbnail = (await list()).find((s) => s.id === id)?.thumbnail;
        const now = ids.now();
        const copy: Card = { ...source, id: ids.newId(), name: copyName(source.name), createdAt: now, updatedAt: now };
        await saver.exclusive(() => store.save(copy, thumbnail));
        return { ok: true, card: copy };
      }),

    async cardForExport(id) {
      if (!store) return null;
      const loaded = await loadWithImages(id);
      if (!loaded) return null;
      const thumbnail = (await list()).find((s) => s.id === id)?.thumbnail;
      return thumbnail ? { ...loaded, thumbnail } : loaded;
    },

    editStored,

    async addLayerTo(id, face, input, image, now) {
      const r = await editStored<'face-full' | 'too-many-images' | 'invalid-input'>(id, [image], (card) => {
        const added = addLayer(card, face, input);
        return added.ok ? { card: added.card } : { problem: added.reason === 'needs-replace-base' ? ('invalid-input' as const) : added.reason };
      }, now);
      if (r.result === 'saved') return { result: 'added', cardName: r.cardName };
      return r.result === 'problem' ? { result: r.problem } : r;
    },

    deleteCard: (id, makeBlank) =>
      serial(async () => {
        if (!store) return;
        if (deps.current()?.id === id) {
          // 進行中的上傳、畫字要先做完（不然會加到下一張卡上）
          await deps.settle();
          let opened = false;
          for (const nextId of openOrderAfterDelete(await list(), id)) {
            const next = await loadWithImages(nextId);
            if (next && (await switchTo(next.card, next.images, true, true)) === 'opened') {
              opened = true;
              break;
            }
          }
          if (!opened) {
            const blank = makeBlank();
            let saved = false;
            try {
              await saver.exclusive(() => store.save(blank));
              saved = true;
            } catch (err) {
              console.error(err);
            }
            await switchTo(blank, [], saved, true);
          }
        }
        // 排在存檔隊伍裡：正在存的舊卡存完才刪，不會刪了又被存回來
        await saver.exclusive(() => store.remove(id));
      }),

    async handOff() {
      // 縮圖不等（接手的分頁開卡後會自己補）：正在等的不等了、之後也不拍，交接只等卡片資料（T-412）
      saver.pauseThumbnails();
      // 已經開始的匯入、建立範例先做完：它們會換卡、存進卡片庫，不能在交出去之後才換（T-412）。
      // 要在排進 serial 之前等：它們的 adopt 也排在 serial 裡
      await deps.settleWork?.();
      return serial(async () => {
        // 進行中的上傳、畫字改的是這張卡：先做完，再存到最新版
        await deps.settle();
        while (store && !saver.isSaved(deps.current())) {
          if (!(await saver.flush())) break;
        }
        await saver.suspend();
        return saver.isSaved(deps.current());
      });
    },

    reload: (makeBlank, ids) =>
      serial(async (): Promise<ReloadOutcome> => {
        // 交出去時沒存到的版本：先另存成新的一張，不能被下面重新讀進來的卡取代、圖也不能收回（T-412）
        const current = deps.current();
        let rescued: string | undefined;
        if (current && !saver.isSaved(current)) {
          const now = ids.now();
          const copy: Card = { ...current, id: ids.newId(), name: unsavedCopyName(current.name), createdAt: now, updatedAt: now };
          rescued = copy.name;
          if (!(await saveRescue(copy))) {
            // 存不進去：不重新讀、不收回圖，留在畫面上。換成那張新的（新 id），之後自動存重試時才不會蓋掉別的分頁存的那張
            saver.resume();
            deps.show(copy);
            saver.opened(copy, false);
            return { result: 'kept', rescued };
          }
        }
        const done = (result: ReloadResult): ReloadOutcome => (rescued ? { result, rescued } : { result });
        saver.resume();
        let choice: StartChoice | null;
        try {
          choice = await chooseStart();
        } catch (err) {
          console.error(err);
          await adoptNow(makeBlank(), [], { save: false });
          return done('unreadable');
        }
        if (choice) {
          const card = choice.card;
          const cardImages = await loadStoredImages(card).catch((err: unknown) => {
            console.error(err);
            return null;
          });
          if (cardImages && (await switchTo(card, cardImages, true, true)) === 'opened') return done('opened');
        }
        await adoptNow(makeBlank(), []);
        return done(choice ? 'open-failed' : 'empty');
      }),
  };
}
