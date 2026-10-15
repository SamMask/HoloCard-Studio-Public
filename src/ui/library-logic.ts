// 卡片庫與新卡片面板（T-407，DESIGN 7.2、7.3）的純邏輯：不碰 DOM，可以在 node 測。

import { S } from '../i18n';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { ko } from '../i18n/ko';
import { zhHant } from '../i18n/zh-Hant';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 「3 分鐘前編輯」：不到 1 分鐘（或時間在未來）＝剛剛；不到 1 小時＝N 分鐘前；不到 24 小時＝N 小時前；
 * 前一天＝昨天；更早＝日期（同一年不寫年）。日期看當地時間。日期壞掉回空字串。
 */
export function editedAgoText(updatedAt: string, now: Date): string {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return '';
  const diff = now.getTime() - t;
  if (diff < MINUTE) return S.library.justNow;
  if (diff < HOUR) return S.library.minutesAgo(Math.floor(diff / MINUTE));
  if (diff < DAY) return S.library.hoursAgo(Math.floor(diff / HOUR));
  const then = new Date(t);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (then.getFullYear() === yesterday.getFullYear() && then.getMonth() === yesterday.getMonth() && then.getDate() === yesterday.getDate()) {
    return S.library.yesterday;
  }
  const date = [then.getMonth() + 1, then.getDate()] as const;
  return then.getFullYear() === now.getFullYear() ? S.library.editedOn(...date) : S.library.editedOnYear(then.getFullYear(), ...date);
}

/** 刪除確認框（DESIGN 7.2 原文）。卡名照原樣（畫面用 textContent 顯示）。 */
export function deleteConfirmText(name: string): string {
  return S.library.deleteConfirm(name);
}

/** 卡片庫標題旁的張數。 */
export function libraryCountText(count: number): string {
  return count === 0 ? S.library.empty : S.library.count(count);
}

/**
 * 新卡片面板〔從範例開始〕的範例（T-605b，DESIGN 7.3；T-810 加第五張光碟「星海唱片鯨」；T-820 加第六張「月下幽舞」），照順序。卡片本身是隨工坊附上的卡片檔，
 * 檔名在 app/samples 的 SAMPLE_FILES（同樣順序；ui 不 import app，測試核對兩邊一樣多、名字和檔案裡的卡名一樣）。
 */
export const SAMPLE_NAMES: readonly string[] = S.samples.names;

/**
 * 每張範例在四種語言的名字（T-828g，位置同 SAMPLE_NAMES）。範例匯入成使用者的卡時卡名是當時語言的名字，之後換語言，
 * 卡片庫裡的卡名還是舊語言的——開一包要比對所有語言的名字，才不會把已經匯入的範例又抽成另一張一樣的。
 */
export const SAMPLE_NAMES_ALL_LANGS: readonly (readonly string[])[] = S.samples.names.map((_, i) =>
  [zhHant, en, ja, ko].map((dict) => dict.samples.names[i]).filter((name): name is string => !!name),
);

/** 縮圖最多傾斜幾度（微微傾斜，呼應立體卡）。 */
export const MAX_TILT_DEG = 10;

export interface Tilt {
  /** 繞水平軸（度）：正＝上緣往後倒。 */
  rx: number;
  /** 繞垂直軸（度）：正＝往右轉（右邊往後）。 */
  ry: number;
  /** 光澤的位置（%，0～100）：跟著滑鼠走。 */
  gx: number;
  gy: number;
}

/** 滑鼠在縮圖上的位置 → 傾斜角度與光澤位置。超出外框就夾住；外框是 0 大小就不傾斜。 */
export function tiltFromPointer(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Tilt {
  if (!(rect.width > 0 && rect.height > 0)) return { rx: 0, ry: 0, gx: 50, gy: 50 };
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const u = clamp01((clientX - rect.left) / rect.width);
  const v = clamp01((clientY - rect.top) / rect.height);
  // -0 → 0（比對與 CSS 字串都乾淨）
  const deg = (n: number) => Math.round(n * MAX_TILT_DEG * 100) / 100 || 0;
  return { rx: deg(1 - 2 * v), ry: deg(2 * u - 1), gx: Math.round(u * 100), gy: Math.round(v * 100) };
}
