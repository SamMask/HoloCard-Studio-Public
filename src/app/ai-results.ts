// AI 的結果加進開始時那張卡（T-703c，Codex 交叉審查 6565e1a 的高②；T-704 拆層的多段結果也走這裡；T-704c 再審的 2 中）。
// - 整段期間 hold 住結果圖：換卡時登記簿的 retain 不會先把還沒被卡片引用的結果圖收走。
// - 開著的就是那張 → 排進上傳隊伍做（換卡、交接前 session.settle 會等它）：先確保圖在登記簿（解碼好），再加進編輯器。
// - 不是開著的 → 存進存檔裡的那張（session 的隊伍裡）；回 is-open（佇列裡的換卡先把那張打開了）→ 再走一次「開著的」那條；
//   這時又被換走了 → 再回存檔判定（T-704c）。只有 session 確認那張卡不在了才回 missing。
// - 做完（成功、失敗、丟錯都一樣）放開 hold，這次沒用上的結果圖立刻收掉（T-704c）：目前的卡、復原／重做歷史在用的不收，
//   別人 hold 著的等放開才收（登記簿的 discard）。
// 不碰 DOM：登記簿、隊伍、加進編輯器／存檔的做法都由組裝端（main）注入，所以能在 node 用真的登記簿與 session 測。

import type { ManagedImageRegistry } from '../images/registry';
import type { StoredImage } from '../images/types';
import { cardImages } from '../model/foil';
import type { EditorState } from '../ui/editor';
import type { CutoutAdded } from './ai-cutout';

export interface AiResultDeps {
  registry: Pick<ManagedImageRegistry, 'add' | 'hold' | 'discard'>;
  /** 這張卡是不是開著的那張。 */
  isOpen(cardId: string): boolean;
  /** 上傳隊伍（換卡、交接前 session.settle 會等它做完）。不能在 session 的隊伍裡呼叫。 */
  queue<T>(task: () => T | Promise<T>): Promise<T>;
  /** 開著的卡現在用到的所有圖（目前的卡、復原／重做歷史、待確認的上傳圖；editorImages）：沒用上的結果圖收掉時不能收這些。 */
  inUse(): ReadonlySet<string>;
}

/** 編輯器用到的所有圖：目前的卡、復原／重做歷史、拖曳前的卡（含反光層的黑白圖），加上待確認的上傳圖。 */
export function editorImages(s: EditorState): Set<string> {
  const h = s.history;
  const out = new Set<string>();
  for (const card of [...h.past, h.present, ...h.future, ...(h.previewBase ? [h.previewBase] : [])]) {
    for (const hash of cardImages(card)) out.add(hash);
  }
  if (s.pending) out.add(s.pending.input.image);
  return out;
}

/**
 * 把 AI 的結果（images：結果圖，拆層時是好幾張）加到 cardId：
 * toOpen＝加進開著的編輯器（同步：記一步）；toStored＝加進存檔裡的那張（回 'is-open'＝那張又被打開了）。
 */
export async function addAiResult(
  deps: AiResultDeps,
  cardId: string,
  images: readonly StoredImage[],
  toOpen: () => CutoutAdded,
  toStored: () => Promise<CutoutAdded | 'is-open'>,
): Promise<CutoutAdded> {
  const { registry } = deps;
  const hashes = images.map((image) => image.hash);
  const release = registry.hold(hashes);
  /** 開著的就是那張：確保圖在登記簿再加；不是開著的回 null。 */
  const intoOpen = () =>
    deps.queue(async (): Promise<CutoutAdded | null> => {
      if (!deps.isOpen(cardId)) return null;
      for (const image of images) await registry.add(image);
      return deps.isOpen(cardId) ? toOpen() : null;
    });
  try {
    // 每輪都要真的換了一次卡才會再來一輪（開著 → 被換走 → 存檔說又開著 → …），不會空轉
    for (;;) {
      const open = await intoOpen();
      if (open) return open;
      const stored = await toStored();
      if (stored !== 'is-open') return stored;
    }
  } finally {
    release();
    const used = deps.inUse();
    registry.discard(hashes.filter((hash) => !used.has(hash)));
  }
}
