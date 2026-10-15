// 頁首（DESIGN §1、§5、7.1）：
//   App 圖示＋名稱 ｜〔≡ 我的卡片〕〔＋ 新卡片〕｜ 卡名 ✎（點一下就能改）＋存檔狀態小字 ｜〔復原〕〔重做〕〔地球 語言〕〔？〕〔匯出 ▾〕
// 〔我的卡片〕打開全螢幕的卡片庫（library.ts，DESIGN 7.2）、〔新卡片〕打開新卡片面板（new-card.ts，7.3）；兩個面板由 app.ts 建立。
// 〔匯出 ▾〕的轉動影片／GIF 打開匯出中的小面板（export-panel.ts，T-504），也由 app.ts 建立。
// 〔？〕（T-606）開關操作說明面板（help-panel.ts，app.ts 建立）；導覽（tour.ts）第 4 步圈住〔匯出 ▾〕。
// 〔匯出 ▾〕的「包含卡套」（T-806）：在「透明背景」旁邊，卡片開著透明卡套才出現、預設勾；PNG、影片、GIF 都照它（不存進卡片）。
// 〔匯出 ▾〕的「畫上背景」（T-814）：同一排，這張卡有舞台背景圖才出現、預設勾、同一次開著工坊記住；PNG、影片、GIF 都照它；
// 和「透明背景」只能選一個（勾一個另一個自動取消；藏起來時也照這條，兩個永遠不會同時勾著）。
// 語言（T-828，DESIGN §9）：〔?〕左邊一顆地球＋目前語言的短名，按了展開清單（每種語言用它自己的文字寫、目前那個打勾）；
// 選了別的語言 → intents.changeLanguage（組裝端等存好再重新載入）。鍵盤同〔匯出 ▾〕選單。
// ui 只吐意圖、不自己改資料；卡名一律 textContent（匯入的卡片檔可能被改過，硬邊界 4）。

import { S } from '../i18n';
import { lang, LANG_NAMES, LANG_SHORT_NAMES, LANGS } from '../i18n/lang';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { menuArrowKeys } from './focus';
import { icon, type IconName } from './icons';
import { foregroundOf, sleeveOn } from '../model/actions';
import { BACKDROP_EXPORT_LABEL, BACKDROP_EXPORT_TIP, FOREGROUND_EXPORT_TIP, HELP_BUTTON_TIP, saveStatusText, SLEEVE_EXPORT_LABEL, SLEEVE_EXPORT_TIP, STAGE_FAR_EXPORT_LABEL, STAGE_FAR_EXPORT_TIP, stageFarExportShown, turntableMenu } from './logic';
import type { SaveStatus, TurntableKind, UiIntents, UiState } from './types';

export interface HeaderHooks {
  /** 〔我的卡片〕：打開卡片庫。 */
  openLibrary(): void;
  /** 〔新卡片〕：打開新卡片面板。 */
  openNewCard(): void;
  /**
   * 〔匯出 ▾〕的轉動影片／GIF（T-504）：打開匯出中的小面板並開始做；做完（含取消、失敗）、面板關掉才 resolve。
   * started：真的開始做的時候呼叫（轉動影片要先在選項小框選好，T-509b；之前〔匯出 ▾〕不顯示「匯出中…」）。
   * includeSleeve：匯出選單「包含卡套」的勾選（T-806；卡片沒開卡套時沒有作用）。
   * includeBackdrop：匯出選單「畫上背景」的勾選（T-814；卡片沒有背景圖時沒有作用）。
   * includeStageFar：匯出選單「畫上舞台的遠景」（T-842；預設不勾，只有沒有自訂背景圖時生效）。
   */
  exportTurntable(kind: TurntableKind, started: () => void, includeSleeve?: boolean, includeBackdrop?: boolean, includeStageFar?: boolean): Promise<void>;
  /** 〔？〕：開關操作說明面板（help-panel.ts，T-606），由 app.ts 建立。 */
  toggleHelp(): void;
}

/** 「儲存中…」至少顯示這麼久（存檔通常幾十毫秒就好，太快會閃一下看不清楚）。 */
const SAVING_MIN_MS = 600;
/** 卡名最多幾個字（SCHEMA §1：1～60 字；model 的改名動作也會截）。 */
const NAME_MAX = 60;

export interface Header {
  readonly el: HTMLElement;
  render(state: UiState): void;
  /** 頁首有選單開著嗎（Esc 先關選單）。 */
  menuOpen(): boolean;
  /** 關掉開著的選單，焦點回到它的按鈕。 */
  closeMenus(): void;
  /** 卡名進入可編輯狀態。 */
  startRename(): void;
  /** 〔？〕按鈕（T-606）：說明面板關掉後焦點回到它；按在它上面不算「點面板外面」。 */
  readonly helpButton: HTMLButtonElement;
  /** 〔匯出 ▾〕按鈕：導覽第 4 步圈它。 */
  readonly exportButton: HTMLButtonElement;
  /** 說明面板開了或關了：〔？〕跟著亮起來／恢復（T-606）。 */
  setHelpOpen(open: boolean): void;
}

interface Dropdown {
  readonly wrap: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly menu: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
}

function menuItem(iconName: IconName, title: string, detail: string | null, onClick: () => void): HTMLButtonElement {
  const b = button('menu-item', [
    icon(iconName, 26),
    h('span', { className: 'menu-text' }, [
      h('span', { className: 'menu-title', text: title }),
      detail ? h('span', { className: 'menu-detail', text: detail }) : null,
    ]),
  ]);
  b.setAttribute('role', 'menuitem');
  b.addEventListener('click', onClick);
  return b;
}

export function createHeader(intents: UiIntents, hooks: HeaderHooks): Header {
  const dropdowns: Dropdown[] = [];

  /**
   * 按鈕＋往下開的選單（〔匯出 ▾〕、語言）。first＝打開時焦點給誰（沒給＝第一個能按的選項）；
   * wrapClass＝外框的 class（語言用 lang-dropdown：頁首第一個 .dropdown 一直是〔匯出 ▾〕）。
   */
  const dropdown = (btn: HTMLButtonElement, menu: HTMLElement, first?: () => HTMLElement | null, wrapClass = 'dropdown'): Dropdown => {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    const wrap = h('div', { className: wrapClass }, [btn, menu]);
    const d: Dropdown = {
      wrap,
      button: btn,
      menu,
      isOpen: () => !menu.hidden,
      open() {
        for (const other of dropdowns) if (other !== d) other.close();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        (first?.() ?? (menu.querySelector('.menu-item:not(:disabled)') as HTMLElement | null))?.focus();
      },
      close() {
        if (menu.hidden) return;
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      },
    };
    btn.addEventListener('click', () => (d.isOpen() ? d.close() : d.open()));
    // 鍵盤（T-607）：↑ ↓ 在選項之間移動；用 Tab 走出選單就收起來（不留一個開著的選單在畫面上）
    menuArrowKeys(menu);
    wrap.addEventListener('focusout', (e) => {
      const to = (e as FocusEvent).relatedTarget as Node | null;
      if (d.isOpen() && to && !wrap.contains(to)) d.close();
    });
    dropdowns.push(d);
    return d;
  };

  document.addEventListener('pointerdown', (e) => {
    for (const d of dropdowns) if (d.isOpen() && !d.wrap.contains(e.target as Node)) d.close();
  });

  // ---- App 圖示＋名稱（DESIGN §5） ----
  const brand = h('div', { className: 'brand' }, [
    h('img', {
      className: 'brand-logo',
      attrs: { src: `${import.meta.env.BASE_URL}brand/icon-192.png`, alt: '', width: '36', height: '36', draggable: 'false' },
    }),
    h('div', { className: 'brand-text' }, [
      h('h1', { className: 'brand-name', text: S.app.title }),
      h('p', { className: 'brand-tagline', text: S.app.tagline }),
    ]),
  ]);

  // ---- 〔我的卡片〕〔新卡片〕：打開全螢幕的卡片庫、新卡片面板（app.ts） ----
  const libraryBtn = button('btn', [icon('list', 18), S.header.library], S.header.libraryTip);
  libraryBtn.setAttribute('aria-haspopup', 'dialog');
  libraryBtn.addEventListener('click', () => hooks.openLibrary());
  const newCardBtn = button('btn', [icon('plus', 18), S.header.newCard], S.header.newCardTip);
  newCardBtn.setAttribute('aria-haspopup', 'dialog');
  newCardBtn.addEventListener('click', () => hooks.openNewCard());

  // ---- 卡名（點一下就能改：Enter 確定、Esc 取消、離開輸入框也算確定；1～60 字） ----
  // 用輸入法選字時的 Enter／Esc 是給輸入法的，不算確定或取消（T-409）；換了一張卡就關掉改名框（不把名字改到新卡上）
  let cardName = '';
  let cardId: string | null = null;
  let editing = false;
  const nameText = h('span', { className: 'card-name-text' });
  const nameBtn = button('card-name', [nameText, icon('pencil', 16)], S.header.renameTip);
  const nameInput = h('input', {
    className: 'card-name-input',
    attrs: { type: 'text', maxlength: String(NAME_MAX), 'aria-label': S.header.cardName, spellcheck: 'false', autocomplete: 'off' },
  });
  nameInput.hidden = true;
  const beginRename = () => {
    if (editing) return;
    editing = true;
    nameInput.value = cardName;
    nameBtn.hidden = true;
    nameInput.hidden = false;
    nameInput.focus();
    nameInput.select();
  };
  const endRename = (commit: boolean) => {
    if (!editing) return;
    editing = false;
    const value = nameInput.value.trim();
    nameInput.hidden = true;
    nameBtn.hidden = false;
    // 空白不改（卡名不能是空的）
    if (commit && value !== '' && value !== cardName) intents.editCard({ name: value }, 'commit');
  };
  nameBtn.addEventListener('click', beginRename);
  nameInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      endRename(true);
      nameBtn.focus();
    } else if (e.key === 'Escape') {
      endRename(false);
      nameBtn.focus();
    }
  });
  nameInput.addEventListener('blur', () => endRename(true));

  // ---- 存檔狀態小字：已儲存（灰）／儲存中…／沒存到（紅）＋〔匯出備份〕 ----
  const statusText = h('span', { className: 'save-status-text' });
  const backupBtn = button('btn btn-sm backup-btn', [S.header.backup], S.header.backupTip);
  backupBtn.hidden = true;
  const status = h('div', { className: 'save-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [statusText, backupBtn]);
  let shownStatus: SaveStatus | null = null;
  let wantedStatus: SaveStatus | null = null;
  let savingSince = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const showStatus = (s: SaveStatus) => {
    shownStatus = s;
    status.dataset.status = s;
    setText(statusText, saveStatusText(s));
    setHidden(backupBtn, s !== 'error');
  };
  const updateStatus = (s: SaveStatus | undefined) => {
    setHidden(status, s === undefined);
    if (s === undefined || s === wantedStatus) return;
    wantedStatus = s;
    clearTimeout(statusTimer);
    if (s === 'saving') {
      if (shownStatus !== 'saving') savingSince = performance.now();
      showStatus('saving');
      return;
    }
    const wait = shownStatus === 'saving' ? SAVING_MIN_MS - (performance.now() - savingSince) : 0;
    if (wait > 0) statusTimer = setTimeout(() => wantedStatus && showStatus(wantedStatus), wait);
    else showStatus(s);
  };

  // ---- 〔復原〕〔重做〕 ----
  const undoBtn = button('btn', [icon('undo', 18), S.header.undo], S.header.undoTip);
  const redoBtn = button('btn', [icon('redo', 18), S.header.redo], S.header.redoTip);
  undoBtn.addEventListener('click', () => intents.undo());
  redoBtn.addEventListener('click', () => intents.redo());

  // ---- 〔？〕操作說明（T-606）：在〔匯出 ▾〕左邊，打開從右邊滑出的說明面板（help-panel.ts） ----
  const helpBtn = button('btn help-btn', ['?'], HELP_BUTTON_TIP);
  helpBtn.setAttribute('aria-label', HELP_BUTTON_TIP);
  helpBtn.setAttribute('aria-haspopup', 'dialog');
  helpBtn.setAttribute('aria-expanded', 'false');
  helpBtn.addEventListener('click', () => hooks.toggleHelp());

  // ---- 語言（T-828，DESIGN §9）：地球＋目前語言的短名；清單每種語言用它自己的文字寫（固定、不翻），目前那個打勾 ----
  const langBtn = button('btn lang-btn', [icon('globe', 18), h('span', { className: 'lang-btn-name', text: LANG_SHORT_NAMES[lang] })], S.lang.buttonTip);
  langBtn.setAttribute('aria-label', S.lang.buttonLabel(LANG_NAMES[lang]));
  const langItems = LANGS.map((l) => {
    const current = l === lang;
    const item = button(current ? 'menu-item lang-item is-current' : 'menu-item lang-item', [
      h('span', { className: 'menu-title', text: LANG_NAMES[l] }),
      current ? icon('check', 18) : null,
    ]);
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(current));
    // 每個名字用它自己的語言標：瀏覽器才會用對的字形
    item.setAttribute('lang', l);
    item.addEventListener('click', () => {
      langMenu.close();
      langBtn.focus({ preventScroll: true });
      if (!current) intents.changeLanguage?.(l);
    });
    return item;
  });
  const langMenuEl = h('div', { className: 'menu menu-right lang-menu', attrs: { role: 'menu', 'aria-label': S.lang.menuLabel } }, langItems);
  const langMenu = dropdown(langBtn, langMenuEl, () => langItems[LANGS.indexOf(lang)] ?? null, 'lang-dropdown');

  // ---- 〔匯出 ▾〕：卡片檔、PNG（＋透明背景）、轉動影片、GIF 動圖；匯入卡片檔… ----
  const exportLabel = h('span', { text: S.header.export });
  const exportBtn = button(
    'btn',
    [icon('download', 18), exportLabel, icon('chevronDown', 16)],
    S.header.exportTip,
  );
  let exporting = false;
  /**
   * refocus＝做完把焦點放回〔匯出 ▾〕（匯出中的小面板關掉後，鍵盤操作不會掉到頁面最前面）。
   * labelNow＝馬上顯示「匯出中…」；false＝等 task 呼叫 busy 才顯示（轉動影片先選選項，T-509b）。
   */
  const runExport = (task: (busy: () => void) => Promise<void>, refocus = false, labelNow = true) => {
    if (exporting) return;
    exporting = true;
    exportMenu.close();
    exportBtn.disabled = true;
    backupBtn.disabled = true;
    const busy = () => {
      if (exporting) setText(exportLabel, S.header.exporting);
    };
    if (labelNow) busy();
    task(busy)
      .catch((err: unknown) => console.error(err))
      .finally(() => {
        exporting = false;
        exportBtn.disabled = false;
        backupBtn.disabled = false;
        setText(exportLabel, S.header.export);
        if (refocus) exportBtn.focus({ preventScroll: true });
      });
  };
  const turntableItem = (kind: TurntableKind) => {
    const { title, detail } = turntableMenu(kind);
    return menuItem(kind === 'webm' ? 'video' : 'loop', title, detail, () =>
      // 影片與 GIF 都先出現選項小框（T-509b、T-512）：選好、真的開始做才顯示「匯出中…」
      runExport((busy) => hooks.exportTurntable(kind, busy, includeSleeve.checked, includeBackdrop.checked, includeStageFar.checked), true, false),
    );
  };
  const transparent = h('input', { attrs: { type: 'checkbox' } });
  transparent.checked = false;
  // 包含卡套（T-806）：預設勾、同一次開著工坊記住；卡片開著透明卡套才出現（render 裡切）
  const includeSleeve = h('input', { attrs: { type: 'checkbox' } });
  includeSleeve.checked = true;
  const sleeveCheck = h('label', { className: 'menu-check', title: SLEEVE_EXPORT_TIP }, [includeSleeve, h('span', { text: SLEEVE_EXPORT_LABEL })]);
  sleeveCheck.hidden = true;
  // 畫上背景（T-814）：預設勾、同一次開著工坊記住；這張卡有舞台背景圖才出現（render 裡切）。
  // 前景圖（T-830）跟著同一個勾選：只有前景圖也出現，有前景圖時提示換成提到前景圖的那句。
  const includeBackdrop = h('input', { attrs: { type: 'checkbox' } });
  includeBackdrop.checked = true;
  const backdropCheck = h('label', { className: 'menu-check', title: BACKDROP_EXPORT_TIP }, [includeBackdrop, h('span', { text: BACKDROP_EXPORT_LABEL })]);
  backdropCheck.hidden = true;
  // T-842：內建舞台遠景獨立勾選、預設關，同一次開著工坊保留選擇。
  const includeStageFar = h('input', { attrs: { type: 'checkbox' } });
  includeStageFar.checked = false;
  const stageFarCheck = h('label', { className: 'menu-check', title: STAGE_FAR_EXPORT_TIP }, [includeStageFar, h('span', { text: STAGE_FAR_EXPORT_LABEL })]);
  stageFarCheck.hidden = true;
  // 和「透明背景」只能選一個：勾了一個，另一個自動取消（取消勾選不動另一個）
  transparent.addEventListener('change', () => {
    if (transparent.checked) {
      includeBackdrop.checked = false;
      includeStageFar.checked = false;
    }
  });
  includeBackdrop.addEventListener('change', () => {
    if (includeBackdrop.checked) transparent.checked = false;
  });
  includeStageFar.addEventListener('change', () => {
    if (includeStageFar.checked) transparent.checked = false;
  });
  const fileInput = h('input', { className: 'visually-hidden', attrs: { type: 'file', accept: '.holocard', tabindex: '-1', 'aria-hidden': 'true' } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) intents.importCardFile(file);
  });
  const exportMenuEl = h('div', { className: 'menu menu-right export-menu', attrs: { role: 'menu', 'aria-label': S.header.export } }, [
    // 做完焦點回到〔匯出 ▾〕（T-607）：選單收起來時選項消失，焦點不回來的話鍵盤使用者就掉到頁面最前面
    menuItem('cardFile', S.header.cardFile, S.header.cardFileDetail, () => runExport(() => intents.exportCardFile(), true)),
    menuItem('image', S.header.png, S.header.pngDetail, () =>
      runExport(() => intents.exportPng(transparent.checked, includeSleeve.checked, includeBackdrop.checked, includeStageFar.checked), true),
    ),
    h('div', { className: 'menu-checks' }, [h('label', { className: 'menu-check' }, [transparent, h('span', { text: S.header.transparent })]), sleeveCheck, backdropCheck, stageFarCheck]),
    turntableItem('webm'),
    turntableItem('gif'),
    h('div', { className: 'menu-sep', attrs: { role: 'separator' } }),
    menuItem('upload', S.header.importCard, S.header.importCardDetail, () => {
      exportMenu.close();
      exportBtn.focus({ preventScroll: true });
      fileInput.click();
    }),
  ]);
  const exportMenu = dropdown(exportBtn, exportMenuEl);
  backupBtn.addEventListener('click', () => runExport(() => intents.exportCardFile()));

  const el = h('header', { className: 'topbar' }, [
    brand,
    h('div', { className: 'topbar-nav' }, [libraryBtn, newCardBtn]),
    h('div', { className: 'topbar-center' }, [h('div', { className: 'card-name-box' }, [nameBtn, nameInput]), status]),
    h('div', { className: 'history-btns' }, [undoBtn, redoBtn]),
    langMenu.wrap,
    helpBtn,
    exportMenu.wrap,
    fileInput,
  ]);

  return {
    el,
    render(state) {
      if (state.card.id !== cardId) {
        cardId = state.card.id;
        endRename(false);
      }
      cardName = state.card.name;
      setText(nameText, cardName);
      nameBtn.title = S.header.renameNameTip(cardName);
      undoBtn.disabled = !state.canUndo;
      redoBtn.disabled = !state.canRedo;
      updateStatus(state.saveStatus);
      setHidden(sleeveCheck, !sleeveOn(state.card));
      const hasForeground = foregroundOf(state.card) !== null;
      setHidden(backdropCheck, state.card.view.backdrop === undefined && !hasForeground);
      setHidden(stageFarCheck, !stageFarExportShown(state.card));
      const tip = hasForeground ? FOREGROUND_EXPORT_TIP : BACKDROP_EXPORT_TIP;
      if (backdropCheck.title !== tip) backdropCheck.title = tip;
    },
    menuOpen: () => dropdowns.some((d) => d.isOpen()),
    closeMenus() {
      for (const d of dropdowns) {
        if (!d.isOpen()) continue;
        d.close();
        d.button.focus();
      }
    },
    startRename: beginRename,
    helpButton: helpBtn,
    exportButton: exportBtn,
    setHelpOpen(open) {
      toggleClass(helpBtn, 'is-open', open);
      helpBtn.setAttribute('aria-expanded', String(open));
    },
  };
}
