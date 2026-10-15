// 「電腦跑不動時自動降低畫質」開關的記錄（T-809，DESIGN §8.4）：只記在這台電腦的瀏覽器（localStorage），不存進卡片。
// 讀不到（沒有 localStorage、丟 SecurityError、沒記過、壞值）一律當開著；寫不進去也不丟錯（這次照樣生效）。
// 同 ui/tour.ts 的做法：取 storage 的函式可以注入（測試換成假的）。

/** 記在 localStorage 的哪個名字下（'0'＝關掉；沒有或別的值＝開著）。 */
export const AUTO_QUALITY_STORAGE_KEY = 'holocard.quality.auto';

/** localStorage 用到的那兩個函式。 */
export interface QualityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage = (): QualityStorage => window.localStorage;

/** 自動降低畫質開著嗎。getStorage 可以丟錯（有些環境連拿 localStorage 都會丟）或回 null：都當開著。 */
export function readAutoQuality(getStorage: () => QualityStorage | null = browserStorage): boolean {
  try {
    return getStorage()?.getItem(AUTO_QUALITY_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** 記下開關；寫不進去就算了。 */
export function writeAutoQuality(on: boolean, getStorage: () => QualityStorage | null = browserStorage): void {
  try {
    getStorage()?.setItem(AUTO_QUALITY_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 寫不進去也沒關係：這次照樣生效，下次開工坊回到預設（開著）
  }
}
