// 整個畫面（DESIGN §1、§5、7.1）：頁首（header.ts）＋左欄圖層＋中間 3D 預覽＋右欄設定；
// 蓋在上面的卡片庫（library.ts，7.2）與新卡片面板（new-card.ts，7.3；開一包 pack-opening.ts 在新卡片面板裡面）。面板開著時後面的編輯畫面不能按、不能用 Tab 走進去（inert），
// 但 3D 預覽、自動存照常跑。
// 工坊在另一個分頁開著（away.ts，T-409）：最上面一層遮罩，後面全部不能按、不收鍵盤與拖進來的檔案。
// 轉一圈的影片／GIF 匯出中（export-panel.ts，T-504）：同樣鎖住後面（不能編輯、不收快捷鍵與拖進來的檔案），3D 預覽照常轉。
// 匯出中或選項小框開著時被接手（T-512）：匯出面板全部停掉、遮罩開著時不能拿焦點（export-panel 的 block）。
// 第一次使用的導覽（tour.ts）與頁首〔？〕的操作說明面板（help-panel.ts，T-606）：導覽等 3D 第一格畫好（main 叫 hidePoster）才開；
// 被卡片庫、新卡片面板、匯出、另一個分頁蓋住或說明面板開著時，導覽先收起來，回來後接著原本那一步。
// AI 自動去背（T-703）：確認框、問題、進度小面板都在 stage.ts（預覽區下方）；這裡只接 Esc（問題＝取消、去背中＝取消去背）。
// 鍵盤（T-607，DESIGN §8.2）：Ctrl+Z／Y、Esc、預覽區按 Delete（直接刪，可以復原）在這裡；方向鍵轉卡與移動圖層在 interact/keys.ts（main 接線）；
// 各面板自己管開啟時的焦點、Tab 循環（focus.ts）與關掉後焦點回去；這裡補「全螢幕面板開著、焦點卻掉到頁面上」時 Tab 把焦點拉回面板，
// 以及選了範例／空白卡／匯入後把焦點放到預覽區（面板關了，原本的按鈕已經不是要用的地方）。
// ui 只讀狀態畫出來、只吐意圖（types.ts），不自己改資料；顯示文字一律 textContent。

import { aspectHeight } from '../model/aspect';
import { createAwayOverlay } from './away';
import { h, toggleClass } from './dom';
import { createExportPanel } from './export-panel';
import { focusEdge } from './focus';
import { createHeader } from './header';
import { createHelpPanel } from './help-panel';
import { createInspector } from './inspector';
import { createLayerPanel } from './layer-list';
import { createLibrary } from './library';
import { deleteKeyWanted, dropKind, escapeAction, isHolocardFile, isTextEntry, plainKey, shortcutFor, type ElementLike } from './logic';
import { createNewCardPanel } from './new-card';
import { createStage } from './stage';
import { createTour } from './tour';
import type { CreateUi, UiState } from './types';

/** 3D 第一格畫好後，等多久才開第一次使用的導覽（讓人先看到卡片，開啟時的縮圖淡出約 0.45 秒）。 */
const TOUR_DELAY_MS = 700;

export const createUi: CreateUi = (root, intents, options) => {
  // ---- 卡片庫、新卡片面板（DESIGN 7.2、7.3） ----
  const panelOpen = () => library.isOpen() || newCard.isOpen();
  const syncPanels = () => {
    const blocked = panelOpen() || away.isOpen() || exporting.isOpen();
    app.inert = blocked;
    // 操作說明面板不是全螢幕的，不在 .app 裡：被蓋住時自己也不能按、Tab 走不進去
    help.setInert(blocked);
    // 導覽：被蓋住或說明面板開著時先收起來，關掉後接著原本那一步（T-606）
    tour.suspend(blocked || help.isOpen());
    // 轉一圈匯出中：頁首與左右欄變淡，看得出現在不能改（預覽區照常亮著）
    toggleClass(app, 'is-exporting', exporting.isOpen());
    // 新卡片面板疊在卡片庫上面時，卡片庫也不能按
    library.setInert(newCard.isOpen());
  };
  /** 要換成別張卡了（新卡、範例副本、匯入）：面板全部關掉，直接看到那張卡。 */
  const closePanels = () => {
    newCard.close();
    library.close();
  };
  /** 面板關了、換卡了：焦點放到預覽區，鍵盤使用者接著就能用方向鍵轉卡（滑鼠使用者看不到焦點外框）。 */
  const focusPreview = () => stage.previewHost.focus({ preventScroll: true });
  const library = createLibrary(intents, {
    openNewCard: (focus) => newCard.open(focus),
    importFiles(files) {
      closePanels();
      focusPreview();
      for (const file of files) intents.importCardFile(file);
    },
    changed: () => syncPanels(),
  });
  const newCard = createNewCardPanel({
    blank(aspect, customAspect) {
      closePanels();
      focusPreview();
      intents.newCard(aspect, customAspect);
    },
    disc() {
      closePanels();
      focusPreview();
      intents.newDisc();
    },
    sample(index) {
      closePanels();
      focusPreview();
      intents.newFromSample(index);
    },
    preview: (index) => intents.samplePreview(index),
    changed: () => syncPanels(),
    // 開一包（T-808）：卡池用卡片庫的清單（先存好目前這張的縮圖）；抽到卡片庫的卡按〔打開這張〕＝和卡片庫點縮圖一樣
    libraryCards: () => intents.loadLibrary().then((data) => data.cards),
    openCard(id) {
      closePanels();
      focusPreview();
      if (id !== last?.card.id) intents.openCard(id);
    },
  });

  // ---- 工坊在另一個分頁開著（T-409） ----
  const away = createAwayOverlay(intents);

  // ---- 轉一圈的影片／GIF 匯出中（T-504）：蓋住整個視窗、不能編輯；小框在預覽區下方 ----
  const exporting = createExportPanel(intents, {
    changed: () => syncPanels(),
    anchor: () => stage.el,
    // 選項小框開著時，預覽區照這張卡的高度算要縮多少才不蓋到卡片（T-828h）
    cardHeight: () => (last ? aspectHeight(last.card) : undefined),
    // 連舞台一起錄（T-850）：舞台「關」時勾選變淡
    stageOn: () => last?.card.view.stage !== 'none',
  });

  // ---- 第一次使用的導覽（DESIGN §8.1，T-606）：依序圈預覽區、左欄〔上傳圖片〕、右欄、頁首〔匯出 ▾〕 ----
  const tour = createTour({
    target(step) {
      switch (step) {
        case 0:
          return stage.el;
        case 1:
          return layers.el.querySelector<HTMLElement>('.panel-foot .primary') ?? layers.el;
        case 2:
          return inspector.el;
        case 3:
          return header.exportButton;
        default:
          return null;
      }
    },
    // 圈右欄那一步：「選中的圖層」（或反光層）收著就先展開（T-836）
    reveal(step) {
      if (step === 2) inspector.reveal();
    },
    // 看完或跳過後，開導覽前的焦點沒有了就給預覽區（T-607b）
    focusFallback: () => stage.previewHost,
  });

  // ---- 操作說明面板（DESIGN §8.1，T-606）：頁首〔？〕開關；〔重新看導覽〕關掉面板後從第 1 步開始 ----
  const help = createHelpPanel({
    opener: () => header.helpButton,
    restartTour: () => tour.start(),
    // 最下面的開關「電腦跑不動時自動降低畫質」（T-809）：設定的記錄與降級在 main
    autoQuality: () => intents.getAutoQuality(),
    setAutoQuality: (on) => intents.setAutoQuality(on),
    changed(open) {
      header.setHelpOpen(open);
      syncPanels();
    },
  });

  // ---- 頁首（DESIGN §5、7.1）：我的卡片、新卡片、卡名＋存檔狀態、復原重做、操作說明、匯出 ----
  const header = createHeader(intents, {
    openLibrary: () => library.open(),
    openNewCard: () => newCard.open('blank'),
    exportTurntable: (kind, started, includeSleeve, includeBackdrop, includeStageFar) => exporting.run(kind, started, includeSleeve, includeBackdrop, includeStageFar),
    toggleHelp: () => help.toggle(),
  });

  // ---- 三欄 ----
  const layers = createLayerPanel(intents);
  const stage = createStage(intents);
  // 右欄各小節可以摺疊（T-836）：收起哪幾節記在這台電腦（options.sections，main 接 localStorage）
  const inspector = createInspector(intents, options?.sections);
  const app = h('div', { className: 'app' }, [header.el, h('main', { className: 'workspace' }, [layers.el, stage.el, inspector.el])]);
  root.append(app, help.el, tour.el, library.el, newCard.el, exporting.el, away.el);

  let last: UiState | null = null;
  /** 開啟時的靜態縮圖（object URL，淡出後收回）。 */
  const posterUrls: string[] = [];

  /** 3D 第一格畫好了（main 叫 hidePoster）：第一次使用才開導覽，稍等一下讓人先看到卡片；只問這一次。 */
  let tourChecked = false;
  const startTourSoon = () => {
    if (tourChecked) return;
    tourChecked = true;
    setTimeout(() => {
      // 3D 起不來（預覽區只有一句說明）：不導覽
      if (stage.previewHost.querySelector('.fatal')) return;
      // 面板剛好開著、被接手了：導覽照樣開始，但先收著（syncPanels 會暫停它）
      if (tour.startIfFirstTime()) syncPanels();
    }, TOUR_DELAY_MS);
  };

  // ---- 鍵盤：Ctrl+Z／Ctrl+Shift+Z／Ctrl+Y（打字時、面板開著時不攔）；Esc 的優先順序見 logic.escapeAction ----
  /** 現在蓋住整個畫面的面板（接手遮罩、轉動匯出的小框、新卡片、卡片庫）；沒有＝null。 */
  const activeModal = (): HTMLElement | null =>
    away.isOpen() ? away.el : exporting.isOpen() ? exporting.el : newCard.isOpen() ? newCard.el : library.isOpen() ? library.el : null;

  window.addEventListener('keydown', (e) => {
    // 全螢幕的面板開著、焦點卻不在裡面（例如點了面板的空白處，焦點掉到頁面上）：Tab 把焦點拉回面板，不跑到後面或瀏覽器上（T-607）
    if (e.key === 'Tab' && plainKey(e)) {
      const modal = activeModal();
      if (modal && !modal.contains(document.activeElement)) {
        e.preventDefault();
        focusEdge(modal, e.shiftKey);
      }
      return;
    }
    // 被接手了：什麼快捷鍵都不收（遮罩上的按鈕用 Tab／Enter 照常能按）
    if (away.isOpen()) return;
    // 轉一圈匯出中：不能改卡（復原／重做也不收）；Esc＝取消
    if (exporting.isOpen()) {
      if (e.key === 'Escape') exporting.cancel();
      return;
    }
    if (e.key === 'Escape') {
      // 改名輸入框自己的 Esc 會先 blur()，所以也看事件發生時的目標，不只看現在的焦點
      const typing = isTextEntry(e.target as ElementLike | null) || isTextEntry(document.activeElement);
      const action = escapeAction({
        // 圖層拖曳中的 Esc 由 interact/pointer 在捕獲階段先收（preventDefault＋停止傳遞），正常到不了這裡；
        // 萬一到了（已被別人處理）就當作拖曳中，這裡不再動作
        layerDragging: e.defaultPrevented,
        panelOpen: panelOpen(),
        menuOpen: header.menuOpen(),
        // 上傳確認框或 AI 的問題（T-703）開著：Esc＝取消（先關上傳確認框）
        confirmOpen: last?.pendingReplaceBase != null || last?.ai?.ask != null,
        typingInText: typing,
        // 選著圖層或反光層（T-417）都算：Esc＝取消選取
        layerSelected: last?.selectedLayerId != null || last?.foilSelected === true,
      });
      if (action === 'close-panel') {
        // 最上面的那一個先關
        if (newCard.isOpen()) newCard.escape();
        else library.escape();
      } else if (action === 'close-menu') {
        header.closeMenus();
      } else if (!typing && action !== 'cancel-drag' && help.escape()) {
        // 操作說明面板（T-606）：它開著時導覽是暫停的，所以 Esc 先關它
      } else if (!typing && action !== 'cancel-drag' && action !== 'keep-base' && tour.escape()) {
        // 第一次使用的導覽（T-606）：Esc＝跳過（取代底圖的確認框開著時，Esc 先留給確認框）
      } else if (action === 'keep-base') {
        if (last?.pendingReplaceBase != null) intents.answerReplaceBase(false);
        else intents.answerAiAsk(false);
      } else if (action === 'deselect') {
        intents.selectLayer(null);
      } else if (action === null && !typing && last?.ai?.progress) {
        // AI 去背中（T-703）：沒有別的東西要關、也沒選著圖層時，Esc＝取消去背（選著圖層時先取消選取，免得一不小心停掉）
        intents.cancelAi();
      }
      return;
    }
    // 面板開著時復原／重做會改到看不見的卡，不攔
    if (panelOpen()) return;
    const sc = shortcutFor(e, isTextEntry(document.activeElement));
    if (!sc) return;
    e.preventDefault();
    if (sc === 'undo') intents.undo();
    else intents.redo();
  });

  // ---- 預覽區按 Delete（T-607、T-607b）：選中了圖層（反光層不能刪）就直接刪，和左欄的垃圾桶一樣，刪了可以按 Ctrl+Z 復原 ----
  stage.previewHost.addEventListener('keydown', (e) => {
    const id = last?.foilSelected ? null : (last?.selectedLayerId ?? null);
    if (id === null || !deleteKeyWanted(e, true)) return;
    e.preventDefault();
    intents.deleteLayer(id);
  });

  // ---- 拖檔案進來：整個視窗都收，預覽區顯示「放開就加到…」；.holocard 走匯入（DESIGN 7.5） ----
  // 卡片庫開著：卡片庫顯示「放開就匯入」；面板開著時只收卡片檔（圖片要回到編輯畫面再拖）
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  let dragDepth = 0;
  const hideDrop = () => {
    stage.showDrop(null);
    library.showDrop(null);
  };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (away.isOpen() || exporting.isOpen()) return;
    dragDepth++;
    // 拖曳中拿不到檔名，只看得到類型：.holocard 系統不認得（類型是空的）
    const types = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file').map((i) => i.type);
    if (library.isOpen()) library.showDrop(dropKind(types));
    else if (!newCard.isOpen()) stage.showDrop(last?.face ?? 'front', dropKind(types));
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideDrop();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    // 一律攔下，免得瀏覽器直接把圖打開、把工坊換掉
    e.preventDefault();
    dragDepth = 0;
    hideDrop();
    // 被接手的分頁不收檔案（收了也存不進去）；轉一圈匯出中也不收（不能改卡、不能換卡）
    if (away.isOpen() || exporting.isOpen()) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const cardFiles = files.filter((f) => isHolocardFile(f.name));
    const images = files.filter((f) => !isHolocardFile(f.name));
    const fromPanel = panelOpen();
    // 匯入的卡會直接打開：面板關掉，直接看到它
    if (cardFiles.length > 0 && fromPanel) closePanels();
    for (const file of cardFiles) intents.importCardFile(file);
    if (images.length > 0 && !fromPanel) intents.uploadFiles(images);
  });

  return {
    previewHost: stage.previewHost,
    overlayHost: stage.overlayHost,
    render(state) {
      last = state;
      header.render(state);
      layers.render(state);
      stage.render(state);
      inspector.render(state);
      library.render(state);
    },
    startRename: () => header.startRename(),
    placeStory: (card) => stage.placeStory(card),
    driftForeground: (x, y) => stage.driftForeground(x, y),
    setZoom: (zoom) => stage.setZoom(zoom),
    showPoster(image, cardH) {
      const url = URL.createObjectURL(image);
      stage.showPoster(url, cardH);
      posterUrls.push(url);
    },
    hidePoster() {
      stage.hidePoster(() => {
        for (const url of posterUrls.splice(0)) URL.revokeObjectURL(url);
      });
      startTourSoon();
    },
    showTakenOver(options) {
      // 預覽區全螢幕（T-835）時遮罩看不到：先離開全螢幕
      stage.exitFullscreen();
      // 面板、選單、改名框都關掉（改名框失去焦點＝確定，會在交出去之前存好）
      closePanels();
      help.close(false);
      header.closeMenus();
      // 轉動匯出（T-512，審查中①）：遮罩會蓋住〔取消〕，所以這裡全部停掉（選項小框關掉、試聽停、匯出送出取消）
      exporting.block(true);
      away.show(options);
      syncPanels();
    },
    hideTakenOver() {
      away.hide();
      exporting.block(false);
      syncPanels();
    },
    showWaiting() {
      stage.exitFullscreen();
      closePanels();
      help.close(false);
      header.closeMenus();
      exporting.block(true);
      away.wait();
      syncPanels();
    },
  };
};
