// 我的卡片（卡片庫，DESIGN 7.2；T-407）：蓋在編輯畫面上的全螢幕面板。
//   上方：〔← 回到編輯〕 我的卡片（共 N 張・目前這張已儲存）            〔匯入卡片檔〕〔＋ 新卡片〕
//   卡片網格：正面縮圖（照卡片比例、淡淡的鐳射光澤、滑鼠移上去微微傾斜）、卡名、「3 分鐘前編輯」、「編輯中」標記、〔⋯〕選單。
//   〔⋯〕：開啟、改名（就地改）、複製一份、匯出卡片檔、刪除（確認框，刪除用紅色、≥48px）。
// 開關面板不影響自動存（存檔在組裝端的隊伍裡跑）。ui 只吐意圖；卡名一律 textContent（匯入的卡片檔可能被改過，硬邊界 4）。

import { S } from '../i18n';
import { aspectHeight, isDisc } from '../model/aspect';
import { setShapeHeight } from './aspect-picker';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { menuArrowKeys, trapTab } from './focus';
import { icon, swapIcon, type IconName } from './icons';
import { deleteConfirmText, editedAgoText, libraryCountText } from './library-logic';
import { saveStatusText } from './logic';
import { attachTilt } from './tilt';
import type { LibraryCard, LibraryData, UiIntents, UiMessage, UiState } from './types';

/** 讀清單超過這麼久才顯示「讀取中…」（通常一下就好，不要閃一下）。 */
const LOADING_DELAY_MS = 300;
/** 「3 分鐘前編輯」多久更新一次。 */
const TIME_REFRESH_MS = 30_000;
/** 卡名最多幾個字（SCHEMA §1；model 也會截）。 */
const NAME_MAX = 60;

export interface LibraryHooks {
  /** 打開新卡片面板（〔＋ 新卡片〕、空狀態的〔新卡片〕／〔從範例開始〕）。 */
  openNewCard(focus: 'blank' | 'samples'): void;
  /** 匯入選好的卡片檔：組裝端會關掉面板（匯入的卡會直接打開）。 */
  importFiles(files: File[]): void;
  /** 面板開關了（組裝端讓後面的編輯畫面不能按、不能用 Tab 走進去）。 */
  changed(): void;
}

export interface Library {
  readonly el: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  /** Esc：先關確認框 → 再關〔⋯〕選單 → 再關卡片庫。 */
  escape(): void;
  render(state: UiState): void;
  /** 有檔案拖在面板上：卡片檔＝「放開就匯入」；null＝收起。 */
  showDrop(kind: 'card-file' | 'images' | null): void;
  /** 新卡片面板疊在上面時，卡片庫不能按。 */
  setInert(inert: boolean): void;
}

/** 開著的卡片庫面板「在原地重讀清單」的函式（T-829c）：打開時登記、關掉時拿掉。 */
const openLibraries = new Set<() => void>();

/**
 * 開著的卡片庫重讀清單（T-829c：背景補了範例卡，組裝端叫這個）：原本看著的那張留在畫面上同一個位置、有焦點的那張還是有焦點；
 * 使用者正在用〔⋯〕選單、刪除確認或改名時先不讀（不打斷），那件事做完才讀。沒開著就什麼都不做。
 */
export function refreshOpenLibrary(): void {
  for (const refreshInPlace of openLibraries) refreshInPlace();
}

interface Tile {
  card: LibraryCard;
  el: HTMLElement;
  thumb: HTMLButtonElement;
  name: HTMLElement;
  time: HTMLElement;
  more: HTMLButtonElement;
}

export function createLibrary(intents: UiIntents, hooks: LibraryHooks): Library {
  let openState = false;
  let currentId: string | null = null;
  let data: LibraryData | null = null;
  let request = 0;
  /** 縮圖的 object URL：重讀或關掉時收回。 */
  let urls: string[] = [];
  const tiles = new Map<string, Tile>();
  /** 正在匯出的卡（〔⋯〕暫時不能按，時間那一行顯示「匯出中…」）。 */
  const busy = new Set<string>();
  let timeTimer: ReturnType<typeof setInterval> | undefined;
  let returnFocus: HTMLElement | null = null;
  /** 正在改名的那張（改名框開著）。 */
  let renaming: string | null = null;
  /** 背景有新卡、但使用者正在用選單／確認框／改名：做完再在原地重讀（T-829c）。 */
  let staleWhileBusy = false;
  let backupController: AbortController | null = null;

  // ---- 上方 ----
  const backBtn = button('btn lib-back', [icon('arrowLeft', 18), S.library.back], S.library.backTip);
  backBtn.addEventListener('click', () => close());
  const countText = h('span', { className: 'lib-count' });
  const saveText = h('span', { className: 'lib-save' });
  const titleBox = h('div', { className: 'lib-title-box' }, [
    h('h2', { className: 'lib-title', text: S.header.library, attrs: { id: 'lib-title' } }),
    h('p', { className: 'lib-sub' }, [countText, saveText]),
  ]);
  const fileInput = h('input', {
    className: 'visually-hidden',
    attrs: { type: 'file', accept: '.holocard', multiple: '', tabindex: '-1', 'aria-hidden': 'true' },
  });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length > 0) hooks.importFiles(files);
  });
  const importBtn = button('btn btn-lg', [icon('upload', 20), S.library.import], S.library.importTip);
  importBtn.addEventListener('click', () => fileInput.click());
  const newBtn = button('btn btn-lg primary lib-new', [icon('plus', 20), S.header.newCard], S.header.newCardTip);
  newBtn.addEventListener('click', () => hooks.openNewCard('blank'));
  const head = h('div', { className: 'lib-head' }, [backBtn, titleBox, h('div', { className: 'spacer' }), importBtn, newBtn]);

  // T-845：獨立一列，還原說明緊接在按鈕下面，避免四種語言擠壓頁首。
  const backupBtn = button('btn lib-backup-start', [icon('cardFile', 20), S.library.backupAll]);
  backupBtn.disabled = !intents.backupLibrary;
  const backupCancel = button('btn lib-backup-cancel', [S.common.cancel]);
  backupCancel.hidden = true;
  const backupStatus = h('span', { className: 'lib-backup-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const backup = h('div', { className: 'lib-backup' }, [
    h('div', { className: 'lib-backup-actions' }, [backupBtn, backupStatus, backupCancel]),
    h('p', { className: 'lib-backup-restore', text: S.library.backupRestore }),
  ]);
  backupCancel.addEventListener('click', () => backupController?.abort());
  backupBtn.addEventListener('click', () => void startBackup());

  async function startBackup(): Promise<void> {
    if (backupController || !intents.backupLibrary) return;
    const controller = new AbortController();
    backupController = controller;
    backupBtn.disabled = true;
    backupCancel.hidden = false;
    setText(backupStatus, S.library.backupProgress(0, data?.cards.length ?? 0));
    try {
      const result = await intents.backupLibrary((p) => {
        if (!controller.signal.aborted) setText(backupStatus, S.library.backupProgress(p.current, p.total));
      }, controller.signal);
      if (controller.signal.aborted || result.kind === 'cancelled') setText(backupStatus, '');
      else setText(backupStatus, result.failed.length > 0
        ? S.library.backupPartial(result.saved, result.failed.length, result.failed.join(S.library.backupNameSeparator))
        : S.library.backupDone(result.saved));
    } catch (err) {
      console.error(err);
      setText(backupStatus, controller.signal.aborted ? '' : S.save.exportCardFailed);
    } finally {
      backupController = null;
      backupBtn.disabled = false;
      backupCancel.hidden = true;
      if (document.activeElement === backupCancel) backupBtn.focus();
    }
  }

  const warn = h('p', { className: 'note note-warn lib-warn' }, [icon('alert', 18), h('span', { text: S.save.storageLow })]);
  warn.hidden = true;

  // ---- 卡片網格與空狀態 ----
  const grid = h('div', { className: 'lib-grid', attrs: { role: 'list' } });
  const loading = h('p', { className: 'lib-loading', text: S.common.loading });
  loading.hidden = true;
  const emptyNew = button('btn btn-lg primary', [icon('plus', 20), S.header.newCard]);
  emptyNew.addEventListener('click', () => hooks.openNewCard('blank'));
  const emptySample = button('btn btn-lg', [icon('cards', 20), S.newCard.fromSample]);
  emptySample.addEventListener('click', () => hooks.openNewCard('samples'));
  const empty = h('div', { className: 'lib-empty' }, [
    h('div', { className: 'lib-empty-art', attrs: { 'aria-hidden': 'true' } }, [icon('cards', 44)]),
    h('p', { className: 'lib-empty-title', text: S.library.empty }),
    h('p', { className: 'lib-empty-tip', text: S.library.emptyTip }),
    h('div', { className: 'lib-empty-actions' }, [emptyNew, emptySample]),
  ]);
  empty.hidden = true;
  const scroll = h('div', { className: 'lib-scroll' }, [grid, loading, empty]);

  // ---- 訊息（卡片庫開著時，提示列被蓋住：訊息改顯示在這裡） ----
  const toastIcon = h('span', { className: 'hint-icon' }, [icon('info', 18)]);
  const toastText = h('span');
  const toastClose = button('btn-icon msg-close', [icon('close', 18)], S.common.closeMessage);
  toastClose.setAttribute('aria-label', S.common.closeMessage);
  toastClose.addEventListener('click', () => intents.dismissMessage());
  const toast = h('div', { className: 'hint-pill lib-toast', attrs: { role: 'status', 'aria-live': 'polite' } }, [toastIcon, toastText, toastClose]);
  toast.hidden = true;
  let toastMode = '';

  // ---- 拖檔案進來 ----
  const dropText = h('span');
  const drop = h('div', { className: 'drop-overlay lib-drop' }, [h('div', { className: 'drop-card' }, [icon('upload', 32), dropText])]);

  const panel = h('div', { className: 'lib-panel' }, [head, backup, warn, scroll, toast, drop]);

  // ---- 〔⋯〕選單（一個共用；開在按鈕旁邊，下面放不下就往上開） ----
  let menuFor: LibraryCard | null = null;
  let menuButton: HTMLButtonElement | null = null;
  const menuItem = (iconName: IconName, title: string, onClick: (card: LibraryCard) => void, danger = false): HTMLButtonElement => {
    const b = button(`menu-item${danger ? ' is-danger' : ''}`, [icon(iconName, 20), h('span', { className: 'menu-title', text: title })]);
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      const card = menuFor;
      closeMenu(false);
      if (card) onClick(card);
    });
    return b;
  };
  const menu = h('div', { className: 'menu lib-menu', attrs: { role: 'menu', 'aria-label': S.library.menuLabel } }, [
    menuItem('open', S.library.open, (card) => openCard(card)),
    menuItem('pencil', S.library.rename, (card) => startRename(card)),
    menuItem('copy', S.library.duplicate, (card) => void duplicate(card)),
    menuItem('cardFile', S.library.exportCard, (card) => void exportCard(card)),
    h('div', { className: 'menu-sep', attrs: { role: 'separator' } }),
    menuItem('trash', S.library.delete, (card) => openConfirm(card), true),
  ]);
  menu.hidden = true;

  const closeMenu = (focusButton = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    menuButton?.setAttribute('aria-expanded', 'false');
    if (focusButton && menuButton?.isConnected) menuButton.focus();
    menuFor = null;
    menuButton = null;
    refreshIfStale();
  };
  const openMenu = (card: LibraryCard, btn: HTMLButtonElement) => {
    if (menuFor?.id === card.id) {
      closeMenu();
      return;
    }
    closeMenu(false);
    menuFor = card;
    menuButton = btn;
    btn.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    // 靠按鈕右緣對齊；下面放不下就往上開；不超出視窗
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    const hgt = menu.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 6;
    const top = below + hgt <= window.innerHeight - 8 ? below : Math.max(8, r.top - hgt - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    (menu.querySelector('.menu-item') as HTMLElement | null)?.focus();
  };
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== menuButton && !menuButton?.contains(e.target as Node)) closeMenu(false);
  });
  scroll.addEventListener('scroll', () => closeMenu(false), { passive: true });
  window.addEventListener('resize', () => closeMenu(false));

  // ---- 刪除確認框（DESIGN 7.2：主次按鈕靠右並排、刪除用紅色、≥48px；Esc＝取消） ----
  let confirmFor: LibraryCard | null = null;
  const confirmTitle = h('p', { className: 'confirm-title', attrs: { id: 'lib-confirm-title' } });
  const cancelBtn = button('btn btn-lg', [S.common.cancel]);
  const deleteLabel = h('span', { text: S.library.deleteButton });
  const deleteBtn = button('btn btn-lg danger', [icon('trash', 20), deleteLabel]);
  const confirmBox = h('div', { className: 'confirm lib-confirm', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'lib-confirm-title' } }, [
    h('div', { className: 'confirm-icon is-danger' }, [icon('trash', 22)]),
    h('div', { className: 'confirm-text' }, [confirmTitle, h('p', { className: 'confirm-tip', text: S.library.deleteTip })]),
    h('div', { className: 'confirm-actions' }, [cancelBtn, deleteBtn]),
  ]);
  const confirmBack = h('div', { className: 'lib-confirm-back' }, [confirmBox]);
  confirmBack.hidden = true;
  confirmBack.addEventListener('pointerdown', (e) => {
    if (e.target === confirmBack) closeConfirm();
  });
  cancelBtn.addEventListener('click', () => closeConfirm());
  deleteBtn.addEventListener('click', () => void confirmDelete());

  const openConfirm = (card: LibraryCard) => {
    confirmFor = card;
    setText(confirmTitle, deleteConfirmText(card.name));
    deleteBtn.disabled = false;
    cancelBtn.disabled = false;
    setText(deleteLabel, S.library.deleteButton);
    confirmBack.hidden = false;
    panel.inert = true;
    cancelBtn.focus();
  };
  const closeConfirm = () => {
    if (confirmBack.hidden) return;
    const id = confirmFor?.id;
    confirmBack.hidden = true;
    panel.inert = false;
    confirmFor = null;
    // 焦點回到那張卡的〔⋯〕（卡已經刪掉就回到〔＋ 新卡片〕）
    const more = id ? tiles.get(id)?.more : undefined;
    (more?.isConnected ? more : newBtn).focus();
    refreshIfStale();
  };
  const confirmDelete = async () => {
    const card = confirmFor;
    if (!card || deleteBtn.disabled) return;
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    setText(deleteLabel, S.library.deleting);
    const ok = await intents.deleteCard(card.id).catch(() => false);
    if (ok) {
      // 馬上從網格拿掉（重讀清單要等目前這張的縮圖拍好，可能要一下子）
      tiles.get(card.id)?.el.remove();
      tiles.delete(card.id);
      setText(countText, libraryCountText(tiles.size));
    }
    closeConfirm();
    await refresh();
  };

  const el = h('div', { className: 'lib-overlay', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lib-title' } }, [
    panel,
    menu,
    confirmBack,
    fileInput,
  ]);
  el.hidden = true;
  // Tab 只在面板裡循環（T-607；確認框開著時後面的面板是 inert，只剩確認框的按鈕）
  trapTab(el);
  menuArrowKeys(menu);

  // ---- 卡片動作 ----
  const openCard = (card: LibraryCard) => {
    close();
    if (card.id !== currentId) intents.openCard(card.id);
  };

  const startRename = (card: LibraryCard) => {
    const tile = tiles.get(card.id);
    if (!tile) return;
    const input = h('input', {
      className: 'lib-name-input',
      attrs: { type: 'text', maxlength: String(NAME_MAX), 'aria-label': S.header.cardName, spellcheck: 'false', autocomplete: 'off' },
    });
    input.value = card.name;
    renaming = card.id;
    tile.name.hidden = true;
    tile.name.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      if (renaming === card.id) renaming = null;
      tile.name.hidden = false;
      if (commit && value !== '' && value !== card.name) {
        setText(tile.name, value);
        void intents.renameCard(card.id, value).finally(() => refresh());
      }
      if (tile.more.isConnected) tile.more.focus();
      refreshIfStale();
    };
    input.addEventListener('keydown', (e) => {
      // 用輸入法選字時的 Enter／Esc 是給輸入法的（T-409）
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  };

  const duplicate = async (card: LibraryCard) => {
    const newId = await intents.duplicateCard(card.id).catch(() => null);
    await refresh(newId ?? undefined);
  };

  const exportCard = async (card: LibraryCard) => {
    if (busy.has(card.id)) return;
    busy.add(card.id);
    updateTile(card.id);
    try {
      await intents.exportCardFileById(card.id);
    } finally {
      busy.delete(card.id);
      updateTile(card.id);
    }
  };

  // ---- 網格 ----
  function clearUrls(): void {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  }

  const timeText = (card: LibraryCard) => (busy.has(card.id) ? S.header.exporting : editedAgoText(card.updatedAt, new Date()));

  const updateTile = (id: string) => {
    const tile = tiles.get(id);
    if (!tile) return;
    setText(tile.time, timeText(tile.card));
    tile.more.disabled = busy.has(id);
  };

  const buildTile = (card: LibraryCard): Tile => {
    // 照卡片比例的格子（T-807：--card-hw＝高／寬，橫式、正方形也放得進同樣大的格子）
    const art = h('span', { className: 'lib-art' });
    setShapeHeight(art, aspectHeight(card));
    // 光碟（T-810b）：滑過的光澤與沒有縮圖時的外形是圓環（CSS 遮罩），縮圖本身不裁
    toggleClass(art, 'is-disc', isDisc(card));
    if (card.thumbnail) {
      const url = URL.createObjectURL(card.thumbnail);
      urls.push(url);
      art.append(h('img', { className: 'lib-art-img', attrs: { src: url, alt: '', draggable: 'false', decoding: 'async' } }));
    } else {
      // 還沒有縮圖：照比例的卡片外形＋卡身顏色
      const plain = h('span', { className: 'lib-art-plain' });
      if (card.bodyColor) plain.style.backgroundColor = card.bodyColor;
      art.append(plain);
    }
    art.append(h('span', { className: 'lib-sheen', attrs: { 'aria-hidden': 'true' } }));
    const badge = h('span', { className: 'lib-badge', text: S.library.editing });
    const thumb = button('lib-thumb', [art, badge]);
    thumb.setAttribute('aria-label', S.library.openLabel(card.name));
    thumb.addEventListener('click', () => openCard(card));
    attachTilt(thumb, art);

    const name = h('span', { className: 'lib-name', text: card.name, title: card.name });
    const time = h('span', { className: 'lib-time' });
    const more = button('btn-icon lib-more', [icon('more', 20)], S.library.moreTip);
    more.setAttribute('aria-label', S.library.moreLabel(card.name));
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => openMenu(card, more));
    const info = h('div', { className: 'lib-info' }, [h('div', { className: 'lib-text' }, [name, time]), more]);
    const tileEl = h('div', { className: 'lib-card', attrs: { role: 'listitem', 'data-id': card.id } }, [thumb, info]);
    toggleClass(tileEl, 'is-current', card.id === currentId);
    const tile = { card, el: tileEl, thumb, name, time, more };
    tiles.set(card.id, tile);
    updateTile(card.id);
    return tile;
  };

  const fill = (next: LibraryData, highlightId?: string) => {
    data = next;
    closeMenu(false);
    clearUrls();
    tiles.clear();
    grid.replaceChildren(...next.cards.map((card) => buildTile(card).el));
    setHidden(empty, next.cards.length > 0);
    setHidden(grid, next.cards.length === 0);
    setHidden(warn, !next.storageLow);
    setText(countText, libraryCountText(next.cards.length));
    if (highlightId) {
      const tile = tiles.get(highlightId);
      if (tile) {
        tile.el.classList.add('is-new');
        // 作業系統設了減少動態效果：直接跳過去、不平順地捲（DESIGN §8.3，T-608；每次讀當下的設定）
        const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        tile.el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      }
    }
  };

  /** 使用者正在用〔⋯〕選單、刪除確認或改名（這時重畫網格會打斷他）。 */
  const busyWithCard = () => !menu.hidden || !confirmBack.hidden || renaming !== null;

  /** 在原地重讀（T-829c）：使用者正在忙就先記著，忙完再讀。 */
  function refreshInPlace(): void {
    if (!openState) return;
    if (busyWithCard()) {
      staleWhileBusy = true;
      return;
    }
    staleWhileBusy = false;
    void refresh(undefined, true);
  }

  function refreshIfStale(): void {
    if (staleWhileBusy && openState && !busyWithCard()) refreshInPlace();
  }

  /** 捲動區裡第一張看得到的卡和它在螢幕上的位置（重讀後把它放回同一個位置）。 */
  const visibleAnchor = (): { id: string; top: number } | null => {
    const top = scroll.getBoundingClientRect().top;
    for (const [id, tile] of tiles) {
      const r = tile.el.getBoundingClientRect();
      if (r.bottom > top) return { id, top: r.top };
    }
    return null;
  };

  /** 有焦點的是哪一張的哪個按鈕。 */
  const focusedTile = (): { id: string; part: 'thumb' | 'more' } | null => {
    const active = document.activeElement;
    for (const [id, tile] of tiles) {
      if (active === tile.more) return { id, part: 'more' };
      if (active === tile.thumb) return { id, part: 'thumb' };
    }
    return null;
  };

  /** keepPlace＝背景重讀（T-829c）：看著的那張留在原位、焦點留著；讀的途中使用者開始忙就先不換，忙完再讀。 */
  async function refresh(highlightId?: string, keepPlace = false): Promise<void> {
    const req = ++request;
    const slow = setTimeout(() => {
      if (req === request && openState && !data) loading.hidden = false;
    }, LOADING_DELAY_MS);
    let next: LibraryData;
    try {
      next = await intents.loadLibrary();
    } catch (err) {
      console.error(err);
      next = { cards: [], storageLow: false };
    } finally {
      clearTimeout(slow);
    }
    if (req !== request || !openState) return;
    loading.hidden = true;
    if (!keepPlace) {
      fill(next, highlightId);
      return;
    }
    if (busyWithCard()) {
      staleWhileBusy = true;
      return;
    }
    const anchor = visibleAnchor();
    const focused = focusedTile();
    fill(next, highlightId);
    const anchorTile = anchor && tiles.get(anchor.id);
    if (anchor && anchorTile) scroll.scrollTop += anchorTile.el.getBoundingClientRect().top - anchor.top;
    const focusTile = focused && tiles.get(focused.id);
    if (focused && focusTile) (focused.part === 'more' ? focusTile.more : focusTile.thumb).focus();
  }

  // ---- 開關 ----
  function close(): void {
    if (!openState) return;
    backupController?.abort();
    setText(backupStatus, '');
    closeMenu(false);
    if (!confirmBack.hidden) {
      confirmBack.hidden = true;
      panel.inert = false;
      confirmFor = null;
    }
    openState = false;
    openLibraries.delete(refreshInPlace);
    staleWhileBusy = false;
    el.hidden = true;
    clearInterval(timeTimer);
    showDrop(null);
    request++;
    // 縮圖的 object URL 收回（T-409）：網格清掉，下次打開重讀
    data = null;
    tiles.clear();
    grid.replaceChildren();
    clearUrls();
    hooks.changed();
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function showDrop(kind: 'card-file' | 'images' | null): void {
    toggleClass(panel, 'is-drop', kind !== null);
    if (kind) setText(dropText, kind === 'card-file' ? S.library.dropImport : S.library.dropOnlyCards);
  }

  const showMessage = (m: UiMessage | null) => {
    setHidden(toast, m === null);
    if (!m) return;
    if (m.kind !== toastMode) {
      toastMode = m.kind;
      toast.dataset.mode = m.kind;
      swapIcon(toastIcon, m.kind === 'error' ? 'alert' : 'info', 18);
    }
    setText(toastText, m.text);
  };

  return {
    el,
    isOpen: () => openState,
    open() {
      if (openState) return;
      openState = true;
      openLibraries.add(refreshInPlace);
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // 上次的內容先留著（重讀好了再換），沒有就等一下
      data = null;
      grid.replaceChildren();
      empty.hidden = true;
      warn.hidden = true;
      setText(countText, '');
      el.hidden = false;
      hooks.changed();
      backBtn.focus();
      timeTimer = setInterval(() => {
        for (const id of tiles.keys()) updateTile(id);
      }, TIME_REFRESH_MS);
      void refresh();
    },
    close,
    escape() {
      if (!confirmBack.hidden) closeConfirm();
      else if (!menu.hidden) closeMenu();
      else if (backupController && !backupController.signal.aborted) backupController.abort();
      else close();
    },
    render(state) {
      if (state.card.id !== currentId) {
        currentId = state.card.id;
        for (const tile of tiles.values()) toggleClass(tile.el, 'is-current', tile.card.id === currentId);
      }
      setText(saveText, state.saveStatus ? S.library.currentStatus(saveStatusText(state.saveStatus)) : '');
      toggleClass(saveText, 'is-error', state.saveStatus === 'error');
      showMessage(state.message);
    },
    showDrop,
    setInert(inert) {
      el.inert = inert;
    },
  };
}
