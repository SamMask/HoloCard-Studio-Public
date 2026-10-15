// 右欄哪幾個小節收起來（T-836，DESIGN §5.2「右欄各小節可以摺疊」）：只記在這台電腦的瀏覽器（localStorage），不存進卡片；
// 換卡、換語言、重新載入都照這份。同 quality-pref.ts 的做法：讀不到（沒有 localStorage、丟 SecurityError、沒記過、壞值）
// 一律當空清單；預設收起的小節另記使用者展開的清單（T-840）。寫不進去也不丟錯。取 storage 的函式可以注入（測試換成假的）。
// 記的是小節的名字（ui/inspector.ts 決定，例如 'holo'、'stage'）的 JSON 陣列；這裡只擋壞值，不認得哪些名字。

/** 記在 localStorage 的哪個名字下。 */
export const COLLAPSED_SECTIONS_STORAGE_KEY = 'holocard.inspector.collapsed';
/** 預設收起、但使用者選擇展開的小節。 */
export const EXPANDED_SECTIONS_STORAGE_KEY = 'holocard.inspector.expanded';

/** 小節名字長這樣（小寫英文開頭、小寫英數與 -，最多 32 字）；別的（被亂寫的）丟掉。 */
const SECTION_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** 最多收幾個名字（右欄的小節沒有這麼多，被亂寫時不會讀進一大堆）。 */
const MAX_SECTIONS = 32;

/** localStorage 用到的那兩個函式。 */
export interface SectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage = (): SectionStorage => window.localStorage;

/** 只留像小節名字的字串、去掉重複、最多 MAX_SECTIONS 個。 */
function clean(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= MAX_SECTIONS) break;
    if (typeof id === 'string' && SECTION_ID.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 收起來的小節名字；讀不到、壞值一律回空清單（由 UI 套用預設）。getStorage 可以丟錯或回 null。 */
export function readCollapsedSections(getStorage: () => SectionStorage | null = browserStorage): string[] {
  return readSections(COLLAPSED_SECTIONS_STORAGE_KEY, getStorage);
}

export function readExpandedSections(getStorage: () => SectionStorage | null = browserStorage): string[] {
  return readSections(EXPANDED_SECTIONS_STORAGE_KEY, getStorage);
}

function readSections(key: string, getStorage: () => SectionStorage | null): string[] {
  try {
    const raw = getStorage()?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? clean(parsed) : [];
  } catch {
    return [];
  }
}

/** 記下收起來的小節名字（整份蓋掉）；寫不進去就算了。 */
export function writeCollapsedSections(ids: readonly string[], getStorage: () => SectionStorage | null = browserStorage): void {
  writeSections(COLLAPSED_SECTIONS_STORAGE_KEY, ids, getStorage);
}

export function writeExpandedSections(ids: readonly string[], getStorage: () => SectionStorage | null = browserStorage): void {
  writeSections(EXPANDED_SECTIONS_STORAGE_KEY, ids, getStorage);
}

function writeSections(key: string, ids: readonly string[], getStorage: () => SectionStorage | null): void {
  try {
    getStorage()?.setItem(key, JSON.stringify(clean(ids)));
  } catch {
    // 寫不進去也沒關係：這次照樣切換，下次開工坊照已保存的偏好。
  }
}
