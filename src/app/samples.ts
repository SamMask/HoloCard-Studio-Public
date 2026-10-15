// 範例卡（T-605b，DESIGN 7.3、7.4）：隨工坊附上的卡片檔 `public/samples/*.holocard`。範例和程式分開——程式裡只有檔名與順序，
// 卡片內容（圖層、文字、反光層…）都在檔案裡；換範例＝換檔案。
// 範例和使用者匯入的卡片檔一樣當成不可信資料：一律走 file/holocard 的 importHolocard（SCHEMA §4 完整檢查）才用。
//   第一次開啟（卡片庫是空的）：全部依序匯入成使用者的卡，第一張打開、其他只存進卡片庫；讀不到或沒通過的跳過，工坊一定打得開。
//   新卡片面板〔從範例開始〕：縮圖用檔案裡的 preview.png（打開面板時才讀）；點了＝匯入那個檔（新 id、新時間）並打開（main 走 session.importFile）。
// 只讀自己網站的檔（硬邊界 1）：fetch 帶 SAME_ORIGIN_FETCH（只准同源、轉址就失敗，T-605c）。
// 每次讀檔最多等 SAMPLE_READ_TIMEOUT_MS：伺服器不回或內容讀不完就當成讀不到（T-605c：不然會卡住啟動與分頁交接）。
// 補新的範例（T-829，DESIGN 7.4）：每張範例有版本號；開工坊時，卡片庫還沒拿過的範例或版本在背景補進去（addNewSamples），
// 拿過的記在 meta `samplesAdded`（SCHEMA §3）。第一次開啟匯入的也記進去。

import type { ImportHolocard } from '../file/types';
import { S } from '../i18n';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { ko } from '../i18n/ko';
import { zhHant } from '../i18n/zh-Hant';
import type { StoredImage } from '../images/types';
import { firstChars, NAME_MAX } from '../model/limits';
import type { Card, Face } from '../model/types';
import type { CardStore } from '../storage/types';
import { SAMPLE_NAMES_ALL_LANGS } from '../ui/library-logic';
import { SAME_ORIGIN_FETCH } from './fetch';
import type { OpenResult } from './session';

/**
 * 範例卡片檔（`public/samples/` 底下），照新卡片面板與第一次開啟的順序；第一張（星晶龍）是第一次開啟要打開的那張。
 * 面板上的名字在 ui/library-logic 的 SAMPLE_NAMES（ui 不 import app；測試核對兩邊一樣多、名字和檔案裡的卡名一樣）。
 */
export const SAMPLE_FILES: readonly string[] = [
  'card1-dragon.holocard',
  'card2-swordsman.holocard',
  'card3-pollenbear.holocard',
  'card4-neon.holocard',
  'card5-disc.holocard',
  'card6-moonlit.holocard',
];

/**
 * 每張範例的版本號（T-829，和 SAMPLE_FILES 對齊）：重畫或改了內容就加 1，老使用者下次開工坊會補一張「（新版）」。
 * 前四張 2：T-605 第一版、T-823 換成第二版的圖（星晶龍 T-826 只把龍那層的「衝出卡片」關掉，圖沒換，還是 2）；
 * 光碟（T-810）、月下幽舞（T-820）加進來後沒改過：1。
 */
export const SAMPLE_VERSIONS: readonly number[] = [2, 2, 2, 2, 1, 1];

/** meta 裡記「已經補過的範例與版本」的 key（SCHEMA §3）：值是 JSON 文字 `{ [範例檔名]: 版本號 }`，只增不減。 */
export const SAMPLES_ADDED_KEY = 'samplesAdded';

/** meta 裡記的範例檔名長這樣（擋掉 __proto__ 這類鍵）。 */
const SAMPLE_FILE_NAME = /^[A-Za-z0-9_-]+\.holocard$/;

/** 讀 meta 的 samplesAdded：壞值當作沒有（不是 JSON 物件就整個當沒有；檔名怪的、版本不是正整數的那一筆略過）。 */
export function parseSamplesAdded(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === undefined) return out;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  for (const [file, version] of Object.entries(value)) {
    if (SAMPLE_FILE_NAME.test(file) && Number.isSafeInteger(version) && (version as number) > 0) out[file] = version as number;
  }
  return out;
}

/** 記「補過哪些範例」用的 meta 改寫（存檔的 updateMeta：同一個交易裡讀、合併、寫回；沒拿著編輯權時會被拒絕）。 */
export type SampleMeta = Pick<CardStore, 'updateMeta'>;

/**
 * 把拿過的範例與版本併進 meta（只增不減：原本記得比較大的、不認得的檔名都留著）。讀、合併、寫回在同一個交易（T-829c：
 * 和別的改動同時寫也不會互相蓋掉）。寫不進去只記 console（下次開再比對）。
 */
async function rememberSamples(store: SampleMeta, taken: readonly (readonly [file: string, version: number])[]): Promise<void> {
  if (taken.length === 0) return;
  try {
    await store.updateMeta(SAMPLES_ADDED_KEY, (old) => {
      const added = parseSamplesAdded(old);
      for (const [file, version] of taken) added[file] = Math.max(added[file] ?? 0, version);
      return JSON.stringify(added);
    });
  } catch (err) {
    console.error('記不住補過的範例：', err);
  }
}

/** 新版另放一張時的卡名：原名＋「（新版）」（預設目前語言）；加了會超過 60 字就先截原名（以 Unicode 字元計）。 */
export function newVersionName(name: string, suffix: string = S.defaults.newVersionSuffix): string {
  return `${firstChars(name.trim(), NAME_MAX - Array.from(suffix).length).trim()}${suffix}`;
}

/** 四種語言的「（新版）」（比對同名時用：上次可能是在別的語言補進來的）。 */
const NEW_VERSION_SUFFIXES: readonly string[] = [zhHant, en, ja, ko].map((dict) => dict.defaults.newVersionSuffix);

/**
 * 範例卡的名字跟著語言（T-828a、T-828g，DESIGN §9）：匯入第 index 張範例後，卡名換成 names 的第 index 個、
 * 圖層名字換成 layers 的第 index 組（圖層 id → 名字；預設＝目前語言的 S.samples.names／S.samples.layers）；
 * 卡片檔本身不動（檔案裡是正體中文原名）。沒通過檢查的照原樣回；沒有這一個名字（或是空的）就保留檔案裡的名字；
 * 圖層用 id 對（不靠位置），id 對不到、名字是空的就保留原名；正面、背面都換。
 * 第一次開啟自動放進我的卡片的那幾張、新卡片面板建立的副本都走這裡；已經在我的卡片裡的卡不改。
 */
export function sampleImporter(
  importer: ImportHolocard,
  index: number,
  names: readonly string[] = S.samples.names,
  layers: readonly Readonly<Record<string, string>>[] = S.samples.layers,
): ImportHolocard {
  return async (file, opts) => {
    const result = await importer(file, opts);
    if (!result.ok) return result;
    const name = names[index]?.trim();
    const card = renameLayers(result.card, layers[index]);
    return { ...result, card: name ? { ...card, name } : card };
  };
}

/** 照圖層 id 換圖層名字（正面、背面）。id 要真的是 layerNames 自己的鍵（不吃 constructor、__proto__ 這類）；沒有對應或是空的名字＝原樣。 */
function renameLayers(card: Card, layerNames: Readonly<Record<string, string>> | undefined): Card {
  if (!layerNames) return card;
  const rename = (face: Face): Face => ({
    ...face,
    layers: face.layers.map((layer) => {
      const name = Object.hasOwn(layerNames, layer.id) ? layerNames[layer.id]?.trim() : undefined;
      return name ? { ...layer, name } : layer;
    }),
  });
  return { ...card, front: rename(card.front), back: rename(card.back) };
}

/** 讀一個範例卡片檔（SAMPLE_FILES 裡的檔名）→ 檔案內容；讀不到就丟錯。 */
export type FetchSample = (file: string) => Promise<Blob>;

/** 讀一個範例卡片檔最多等多久（毫秒，T-605c）：本機的檔正常不到 1 秒。 */
export const SAMPLE_READ_TIMEOUT_MS = 15_000;

/**
 * 同源讀範例檔：網址＝base（網站根目錄，Vite 的 BASE_URL）＋`samples/檔名`。
 * fetch 帶 SAME_ORIGIN_FETCH（被轉址到別的地方就失敗，不會連出去）；HTTP 不是 2xx 就丟錯；
 * 超過 timeoutMs 還沒讀完（伺服器不回、內容讀不完）→ 送出取消、丟錯（不靠 fetch 自己理會取消）。
 */
export function sampleFetcher(fetch: (url: string, init: RequestInit) => Promise<Response>, base: string, timeoutMs = SAMPLE_READ_TIMEOUT_MS): FetchSample {
  return (file) => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error(`範例卡片檔讀太久，不等了：${file}（超過 ${timeoutMs / 1000} 秒）`));
      }, timeoutMs);
    });
    const read = (async () => {
      const res = await fetch(`${base}samples/${file}`, { ...SAME_ORIGIN_FETCH, signal: abort.signal });
      if (!res.ok) throw new Error(`範例卡片檔讀不到：${file}（HTTP ${res.status}）`);
      return res.blob();
    })();
    // 逾時之後才失敗的讀取（例如取消造成的 AbortError）沒人等：先接住
    read.catch(() => {});
    return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
  };
}

export interface FirstOpenDeps {
  fetchSample: FetchSample;
  /** file/holocard 的 importHolocard（完整檢查）。 */
  importer: ImportHolocard;
  newId(): string;
  /** 現在時間（毫秒）。 */
  now(): number;
  /** 存進卡片庫並打開（session.adopt）。 */
  open(card: Card, images: readonly StoredImage[]): Promise<OpenResult>;
  /** 存進卡片庫、不打開（session.addToLibrary）；存好回 true。thumbnail＝卡片檔裡的 preview.png（當卡片庫縮圖）。 */
  keep(card: Card, images: readonly StoredImage[], thumbnail?: Blob): Promise<boolean>;
  /** 記「拿過哪些範例」的 meta（T-829：匯入成功的每一張記下版本，之後開工坊不會再補「（新版）」）。 */
  store: SampleMeta;
  /** 範例卡的名字（T-828a；照 SAMPLE_FILES 的順序）。沒給＝目前語言的 S.samples.names。 */
  names?: readonly string[];
  /** 範例卡的圖層名字（T-828g；照 SAMPLE_FILES 的順序，每張一組 圖層 id → 名字）。沒給＝目前語言的 S.samples.layers。 */
  layers?: readonly Readonly<Record<string, string>>[];
}

/**
 * 第一次開啟（卡片庫是空的，DESIGN 7.4）：範例依序走匯入的完整檢查，通過的成為使用者的卡（新 id）——第一張打開、其他只存。
 * 卡片庫依最近編輯排序：第 i 張的時間＝開始時間 − i 毫秒，所以照範例順序排（第一張在最前面）。檔案先一起開始讀，再依序檢查。
 * 讀不到、沒通過檢查、打不開、存不進去：跳過那一張、console 記一筆（打不開就改打開下一張）。
 * 放進卡片庫的每一張把版本記進 meta samplesAdded（T-829；跳過的不記，下次開工坊時補）。
 * 回打開的那張；一張都沒打開回 null（組裝端改開空白卡）。不丟錯。
 */
export async function importSamplesOnFirstOpen(deps: FirstOpenDeps): Promise<Card | null> {
  const start = deps.now();
  const reads = SAMPLE_FILES.map((file) => deps.fetchSample(file));
  // 後面的檔讀失敗時，前面還在處理、還沒人等它：先接住，免得變成沒處理的 rejection
  for (const read of reads) read.catch(() => {});
  let opened: Card | null = null;
  const taken: [string, number][] = [];
  for (const [i, file] of SAMPLE_FILES.entries()) {
    try {
      const time = new Date(start - i).toISOString();
      const result = await sampleImporter(deps.importer, i, deps.names, deps.layers)(await reads[i]!, { newId: () => deps.newId(), now: () => time });
      if (!result.ok) throw new Error(`沒通過卡片檔的檢查（${result.reason}${result.detail ? `：${result.detail}` : ''}）`);
      if (opened) {
        // 沒打開的卡不會自己拍縮圖：用卡片檔裡的預覽圖當卡片庫縮圖（卡片庫、開一包才不會是空白卡）
        if (!(await deps.keep(result.card, result.images, result.preview))) throw new Error('存不進卡片庫');
      } else {
        const outcome = await deps.open(result.card, result.images);
        if (outcome !== 'opened') throw new Error(`打不開（${outcome}）`);
        opened = result.card;
      }
      taken.push([file, SAMPLE_VERSIONS[i]!]);
    } catch (err) {
      console.error(`範例卡 ${file} 跳過：`, err);
    }
  }
  await rememberSamples(deps.store, taken);
  return opened;
}

export interface NewSamplesDeps {
  fetchSample: FetchSample;
  /** file/holocard 的 importHolocard（完整檢查）。 */
  importer: ImportHolocard;
  newId(): string;
  /** 現在時間（毫秒）。 */
  now(): number;
  /**
   * 現在拿著的編輯權是第幾代（T-409、T-829c）：沒拿著＝null；被別的分頁接手過、再拿回來就換一個數字（main 的 awayEpoch）。
   * 開始時記下來，之後不是同一代（沒拿著、或接手過又拿回來）這一輪就停——不會用舊的資料復活再補。
   */
  editGeneration(): number | null;
  /**
   * 在卡片庫的寫入隊伍裡獨佔地跑 task（main：session 的 saver.exclusive，換卡、匯入、建範例、刪卡、自動存都排在這裡）：
   * 「重讀卡片庫、比對、存進去」中間不會插進別的寫入。交出編輯權之後會拒絕。
   */
  withLibrary<T>(task: () => Promise<T>): Promise<T>;
  /** 卡片庫（清單、讀卡、存圖、存卡；讀不到要丟錯，不能當成「沒有卡」）＋記「拿過哪些範例」的 meta。 */
  store: Pick<CardStore, 'list' | 'load' | 'saveImage' | 'save' | 'getMeta'> & SampleMeta;
  /** 範例卡的名字（照 SAMPLE_FILES 的順序）。沒給＝目前語言的 S.samples.names。 */
  names?: readonly string[];
  /** 範例卡的圖層名字（照 SAMPLE_FILES 的順序）。沒給＝目前語言的 S.samples.layers。 */
  layers?: readonly Readonly<Record<string, string>>[];
  /** 「（新版）」。沒給＝目前語言的 S.defaults.newVersionSuffix。 */
  newSuffix?: string;
  /** 範例版本號（照 SAMPLE_FILES 的順序）。沒給＝SAMPLE_VERSIONS（測試改版號用）。 */
  versions?: readonly number[];
}

/** 卡片圖層用到的圖（正面＋背面每一層的圖）：比對「是不是這一版的範例」用（T-829）。 */
function layerImages(card: Card): Set<string> {
  return new Set([...card.front.layers, ...card.back.layers].map((layer) => layer.image));
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** 一張範例在卡片庫獨佔區裡的結果：放了（卡名）／同名同版不放／這一輪該停了（編輯權換代）。 */
type PlaceOutcome = { placed: string } | 'same-version' | 'stop';

/** 補範例一次只跑一輪（T-829c）：同時又被叫，就排在正在跑的那一輪後面（後面那輪重讀 meta 與卡片庫，補過的不會再補）。 */
let rounds: Promise<unknown> = Promise.resolve();

/**
 * 補新的範例（T-829，DESIGN 7.4「補新的範例」）：開工坊、卡片庫讀好、拿著編輯權之後在背景呼叫。不換卡、不打開任何一張。
 * meta samplesAdded 記的版本比 SAMPLE_VERSIONS 小（或沒記）的範例才讀檔、走完整檢查，然後看卡片庫裡有沒有同名的卡
 * （四種語言的名字、以及名字＋任一種語言的「（新版）」都算同名）：
 *   - 沒有同名的卡 → 照目前語言的名字放一張；
 *   - 同名的卡裡有一張圖層的圖和範例檔完全一樣（同一版）→ 不放、記成拿過了；
 *   - 有同名的卡、但都不是這一版（舊版範例、或使用者改過的）→ 另放一張，卡名加「（新版）」；舊的不動。
 * T-829c：每一張的「重讀卡片庫 → 比對 → 存圖、存卡」在 withLibrary 裡獨佔地做（讀檔、檢查在外面先做好），等讀檔時使用者
 * 從面板建了同一張範例也認得出來；同時只跑一輪；開始時記下編輯權世代，之後不是同一代就停。
 * 放進去的卡用卡片檔裡的預覽圖當卡片庫縮圖；時間＝開始時間 − i 毫秒（卡片庫最上面、照範例順序）。每處理完一張就原子地併進 meta。
 * 讀不到、沒通過檢查、存不進去的那張跳過、不記（console 記一筆），下次開再試；meta 讀不到就整個不補。
 * 存圖之後存卡之前出錯（或頁面被關掉）留下的圖沒有卡用：同 session 的匯入，下次開工坊時 chooseStart 的 cleanupImages 會清掉。
 * 回這次放進卡片庫的卡名（照範例順序；沒有就空的）。不丟錯。
 */
export function addNewSamples(deps: NewSamplesDeps): Promise<string[]> {
  const round = rounds.then(() => addNewSamplesNow(deps));
  rounds = round.catch(() => {});
  return round;
}

async function addNewSamplesNow(deps: NewSamplesDeps): Promise<string[]> {
  const generation = deps.editGeneration();
  if (generation === null) return [];
  /** 還是開始時那一代的編輯權（沒被接手過）。 */
  const ours = () => deps.editGeneration() === generation;
  const versions = deps.versions ?? SAMPLE_VERSIONS;
  const names = deps.names ?? S.samples.names;
  const suffix = deps.newSuffix ?? S.defaults.newVersionSuffix;
  const start = deps.now();
  let pending: number[];
  try {
    const taken = parseSamplesAdded(await deps.store.getMeta(SAMPLES_ADDED_KEY));
    pending = SAMPLE_FILES.flatMap((file, i) => ((taken[file] ?? 0) < (versions[i] ?? 0) ? [i] : []));
  } catch (err) {
    // 讀不到就不補：當成「什麼都沒拿過」會把刪掉的範例又放回去
    console.error('讀不到卡片庫，這次不補新的範例：', err);
    return [];
  }
  if (pending.length === 0) return [];
  const reads = new Map(pending.map((i) => [i, deps.fetchSample(SAMPLE_FILES[i]!)] as const));
  // 後面的檔讀失敗時，前面還在處理、還沒人等它：先接住
  for (const read of reads.values()) read.catch(() => {});
  const added: string[] = [];
  for (const i of pending) {
    if (!ours()) break;
    const file = SAMPLE_FILES[i]!;
    try {
      const time = new Date(start - i).toISOString();
      const result = await sampleImporter(deps.importer, i, deps.names, deps.layers)(await reads.get(i)!, { newId: () => deps.newId(), now: () => time });
      if (!result.ok) throw new Error(`沒通過卡片檔的檢查（${result.reason}${result.detail ? `：${result.detail}` : ''}）`);
      const baseNames = [...(SAMPLE_NAMES_ALL_LANGS[i] ?? []), names[i]?.trim() ?? ''].filter(Boolean);
      const sameNames = new Set(baseNames.flatMap((name) => [name, ...[...NEW_VERSION_SUFFIXES, suffix].map((s) => newVersionName(name, s))]));
      const fileImages = layerImages(result.card);
      const outcome = await deps.withLibrary(async (): Promise<PlaceOutcome> => {
        if (!ours()) return 'stop';
        // 每一張都重讀卡片庫：等讀檔的時候使用者可能已經建了同一張範例
        const sameNamed = (await deps.store.list()).filter((summary) => sameNames.has(summary.name));
        for (const summary of sameNamed) {
          const card = await deps.store.load(summary.id);
          if (card && sameSet(layerImages(card), fileImages)) return 'same-version';
        }
        if (!ours()) return 'stop';
        const card = sameNamed.length > 0 ? { ...result.card, name: newVersionName(result.card.name, suffix) } : result.card;
        for (const image of result.images) await deps.store.saveImage(image);
        await deps.store.save(card, result.preview);
        return { placed: card.name };
      });
      if (outcome === 'stop') break;
      if (outcome !== 'same-version') added.push(outcome.placed);
      await rememberSamples(deps.store, [[file, versions[i]!]]);
    } catch (err) {
      // 被別的分頁接手（寫入被擋）：停下，不算這一張出錯
      if (!ours()) break;
      console.error(`範例卡 ${file} 跳過：`, err);
    }
  }
  return added;
}

/**
 * 新卡片面板的縮圖（T-605b）：讀第 index 張範例、完整檢查通過才回它的 preview.png（不存進任何地方）。
 * 沒有這一張、讀不到、沒通過、檔案裡沒有預覽圖 → null（console 記一筆）。
 */
export async function readSamplePreview(index: number, fetchSample: FetchSample, importer: ImportHolocard): Promise<Blob | null> {
  const file = SAMPLE_FILES[index];
  try {
    if (file === undefined) throw new Error(`沒有第 ${index + 1} 張範例`);
    const result = await importer(await fetchSample(file), { newId: () => 'sample-preview', now: () => new Date().toISOString() });
    if (!result.ok) throw new Error(`沒通過卡片檔的檢查（${result.reason}）`);
    if (!result.preview) throw new Error('卡片檔裡沒有預覽圖');
    return result.preview;
  } catch (err) {
    console.error(`範例卡 ${file ?? index} 的縮圖讀不到：`, err);
    return null;
  }
}
