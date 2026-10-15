// T-845：逐張讀卡、沿用卡片檔匯出器；外層 ZIP 不重複壓縮。
import { zipSync } from 'fflate';
import { exportHolocard } from '../file/holocard';
import { HOLOCARD_EXT } from '../file/types';
import type { BackupOutcome, BackupProgress } from '../ui/types';
import { downloadBlob, safeFileName } from './files';
import type { ExportSource, Session } from './session';

export interface BackupDeps {
  session: Pick<Session, 'saver' | 'list' | 'cardForExport'>;
  preview(source: ExportSource): Promise<Blob>;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Windows 解壓時大小寫也不能互蓋；序號本身撞到另一張卡名時繼續加。 */
function entryName(name: string, used: Set<string>): string {
  const base = safeFileName(name, '');
  let candidate = `${base}${HOLOCARD_EXT}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base} (${suffix++})${HOLOCARD_EXT}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function backupName(): string {
  const date = new Date();
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `holocard-backup-${day}.zip`;
}

/** 取消（包含分頁接手）在每個非同步步驟後檢查；下載出口只在全部做完後呼叫一次。 */
export async function backupLibrary(
  deps: BackupDeps,
  onProgress: (progress: BackupProgress) => void,
  signal: AbortSignal,
): Promise<BackupOutcome> {
  const cancelled = { kind: 'cancelled' } as const;
  if (signal.aborted) return cancelled;
  const savedCurrent = await deps.session.saver.flush({ thumbnail: true });
  if (signal.aborted) return cancelled;
  if (!savedCurrent) throw new Error('Could not save current card before backup');
  const cards = await deps.session.list();
  if (signal.aborted) return cancelled;
  const entries: Record<string, Uint8Array> = Object.create(null);
  const used = new Set<string>();
  const failed: string[] = [];
  let saved = 0;
  onProgress({ current: 0, total: cards.length });
  for (const [index, summary] of cards.entries()) {
    await yieldToUi();
    if (signal.aborted) return cancelled;
    try {
      const source = await deps.session.cardForExport(summary.id);
      if (signal.aborted) return cancelled;
      if (!source) throw new Error(`Could not read backup card ${summary.id}`);
      const preview = await deps.preview(source);
      if (signal.aborted) return cancelled;
      const images = new Map(source.images.map((image) => [image.hash, image]));
      const blob = await exportHolocard(source.card, async (hash) => images.get(hash), preview);
      if (signal.aborted) return cancelled;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (signal.aborted) return cancelled;
      entries[entryName(source.card.name, used)] = bytes;
      saved++;
    } catch (err) {
      if (signal.aborted) return cancelled;
      console.error('Card skipped during backup:', summary.id, err);
      failed.push(summary.name);
    }
    onProgress({ current: index + 1, total: cards.length });
  }
  // 讓最後一張的進度與取消按鈕有機會更新，再組 ZIP；組好後再讓出一次，避免取消事件已排隊卻仍下載。
  await yieldToUi();
  if (signal.aborted) return cancelled;
  if (saved > 0) {
    const zip = new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
    await yieldToUi();
    if (signal.aborted) return cancelled;
    downloadBlob(zip, backupName());
  }
  return { kind: 'done', saved, failed };
}
