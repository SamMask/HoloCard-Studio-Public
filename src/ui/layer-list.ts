// 左欄：正面｜背面分頁、圖層清單（最前面在最上面）、上傳圖片＋加文字按鈕。
// 清單最上面固定一列「反光層」（T-417，DESIGN「反光層」）：彩虹小圖示＋目前形狀的小縮圖、名字與形狀、眼睛（關＝整面霧光）；
// 點它選反光層（右欄顯示反光層面板）；不能刪、不能拖、不算在 8 層裡；每一面各一個。
// 清單每列：拖拉把手、縮圖（混合模式不是正常時角落有模式的白話名，T-408）、名字（可改）、
// 〔反光星星：反光層選「用圖層形狀」時才出現（和右欄的勾選同步）；衝出卡片的層變淡、不能按（T-411b）〕、顯示開關、刪除。
// 拖拉＝和放下的那一列交換深度；底圖固定在最下面。
// 剪裁遮色片（T-803，DESIGN「剪裁遮色片」）：剪裁中的層往右縮一格、前面一個小箭頭 ↳；不能拖（拖把手變淡，滑過說明跟著下面那層），
// 拖下面那層時它的剪裁層一起移動；放到剪裁層上＝和它下面那層換（logic.ts 的 swapTarget）。
// 雙圖光柵（T-805）：有變身圖的層縮圖右上角一個小「雙」字（CSS 畫底、textContent 寫字）。
// 鍵盤（T-607，DESIGN §8.2）：焦點在反光層那一列或某個圖層那一列（li 本身）時，↑ ↓ 在列之間移動（Home／End 頭尾，到頭停住），
// Enter 選中、空白鍵顯示／隱藏（眼睛）；反光層那一列照舊（Enter／空白鍵＝選它）。Tab 停點只有一列（選中的那列、或焦點最後在的那列），
// 那一列裡面的名字、星星、眼睛、刪除才在 Tab 順序裡（用 ↑ ↓ 換列後再 Tab 進去），免得 8 層圖層要按 30 幾次 Tab。
// 組合鍵與輸入法選字中不攔（T-607c）；焦點所在的那一列被拿掉（按垃圾桶、復原）時焦點移到補上它位置的列，不掉到頁面最前面。
// 第三行（T-833）：立體層的名字下面除了「深度 N」，再一行小字淡色的「混合模式・不透明度 N%」（logic.ts 的 layerLookText）；底圖與反光層那一列沒有。
// 名字欄只有約 84px 寬，放不下這一行：它是列的最後一個子元素、跨過名字欄與按鈕欄排在整列的最下面（縮圖與拖把手跨兩行；CSS 的 .has-look）。
// CD 光碟（T-810）：「背面」分頁灰掉（aria-disabled）＋滑過說明「光碟背面是資料面，不放圖」；按了清單不換面，卡片照樣翻過去。

import { S } from '../i18n';
import { clipParent, clipRunEnd } from '../model/actions';
import { isDisc } from '../model/aspect';
import { faceFoil } from '../model/foil';
import { MAX_LAYERS_PER_FACE, type FaceSide, type FoilShape, type Layer } from '../model/types';
import { createSegmented } from './controls';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { foilThumb, setFoilEye } from './foil-panel';
import { icon, swapIcon } from './icons';
import {
  CLIP_FOLLOW_TEXT,
  CLIP_LABEL,
  DISC_BACK_TITLE,
  displayOrder,
  FOIL_TITLE,
  foilShapeText,
  indexAtY,
  layerAltTag,
  layerBlendTag,
  layerHoloToggle,
  layerLookText,
  layerRowKey,
  layerSubText,
  listStep,
  plainKey,
  swapTarget,
} from './logic';
import type { UiIntents, UiState } from './types';

const DRAG_START_PX = 4;

interface Row {
  layer: Layer;
  el: HTMLLIElement;
  thumb: HTMLImageElement;
  /** 縮圖角落的混合模式標示（T-408；正常模式藏起來）。 */
  tag: HTMLElement;
  /** 縮圖右上角的「雙」（T-805；沒有變身圖藏起來）。 */
  altTag: HTMLElement;
  name: HTMLInputElement;
  sub: HTMLElement;
  /** 第三行「混合模式・不透明度 N%」（T-833；底圖藏起來）。 */
  look: HTMLElement;
  grip: HTMLElement;
  /** 剪裁中的層前面的小箭頭（T-803）。 */
  clipArrow: HTMLElement;
  /** 剪裁中（T-803，clipParent）：不能拖。 */
  clipped: boolean;
  holo: HTMLButtonElement;
  eye: HTMLButtonElement;
  remove: HTMLButtonElement;
}

export interface LayerPanel {
  readonly el: HTMLElement;
  render(state: UiState): void;
}

export function createLayerPanel(intents: UiIntents): LayerPanel {
  const frontCount = h('span', { className: 'seg-count' });
  const backCount = h('span', { className: 'seg-count' });
  const tabs = createSegmented<FaceSide>(
    S.layers.faceLabel,
    [
      { value: 'front', label: S.layers.front, extra: frontCount },
      { value: 'back', label: S.layers.back, extra: backCount },
    ],
    (face) => intents.selectFace(face),
  );
  // CD 光碟（T-810）：背面是資料面、不放圖——分頁灰掉＋說明；按了照樣送 selectFace（卡片翻過去，清單留在正面、圖層取消選取；分頁選中的樣子跟著 state.viewFace，T-810b）
  const backTab = tabs.el.children[1] as HTMLElement;
  let backLocked = false;
  const lockBack = (locked: boolean) => {
    if (locked === backLocked) return;
    backLocked = locked;
    toggleClass(backTab, 'is-locked', locked);
    if (locked) backTab.setAttribute('aria-disabled', 'true');
    else backTab.removeAttribute('aria-disabled');
    backTab.title = locked ? DISC_BACK_TITLE : '';
  };

  const count = h('span', { className: 'panel-count' });
  const head = h('div', { className: 'panel-head' }, [h('h2', { className: 'panel-title' }, [icon('layers', 18), S.layers.title]), count]);
  const list = h('ol', { className: 'layer-list', attrs: { 'aria-label': S.layers.listLabel } });
  const emptyText = h('p', { className: 'empty-note' });
  const empty = h('div', { className: 'list-empty' }, [icon('image', 28), emptyText]);

  const fileInput = h('input', {
    className: 'visually-hidden',
    attrs: { type: 'file', multiple: '', accept: 'image/png,image/webp,image/jpeg', tabindex: '-1', 'aria-hidden': 'true' },
  });
  const upload = button('btn primary btn-block', [icon('upload', 20), S.layers.upload]);
  const addText = button('btn btn-block add-text', [icon('text', 20), S.layers.addText]);
  addText.addEventListener('click', () => intents.addText());
  const uploadHelp = h('p', { className: 'help', text: S.layers.uploadHelp });
  upload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length > 0) intents.uploadFiles(files);
  });

  // ---- 反光層（T-417）：清單最上面固定一列 ----
  const foilPic = foilThumb();
  const foilSub = h('span', { className: 'layer-sub foil-sub' });
  const foilEye = button('btn-icon layer-eye foil-eye', [icon('eye')]);
  const foilRow = h(
    'div',
    { className: 'foil-row', attrs: { role: 'button', tabindex: '0', 'aria-label': S.layers.foilRowLabel(FOIL_TITLE) } },
    [
      h('span', { className: 'foil-icon' }, [icon('rainbow', 18)]),
      h('span', { className: 'layer-thumb-wrap foil-thumb-wrap' }, [foilPic.el]),
      h('span', { className: 'layer-text' }, [h('span', { className: 'foil-name', text: FOIL_TITLE }), foilSub]),
      h('span', { className: 'layer-actions' }, [foilEye]),
    ],
  );
  /** 眼睛關了再打開時回到哪個形狀：這次開著工坊看過的（每一面各記一個），沒看過就整面。 */
  const lastShape: Record<FaceSide, Exclude<FoilShape, 'none'>> = { front: 'full', back: 'full' };
  foilRow.addEventListener('click', (e) => {
    if ((e.target as Element).closest('button')) return;
    intents.selectFoil();
  });
  foilRow.addEventListener('keydown', (e) => {
    // 只管焦點在這一列本身時：眼睛按鈕上的 Enter／空白冒泡上來要留給按鈕自己（T-417b）；
    // Ctrl＋空白鍵（切輸入法）之類的組合鍵、輸入法選字中不選（T-703b 補上 T-607c 的 plainKey）
    if (e.target !== foilRow || !plainKey(e)) return;
    const key = (e as KeyboardEvent).key;
    if (key !== 'Enter' && key !== ' ') return;
    e.preventDefault();
    intents.selectFoil();
  });
  foilEye.addEventListener('click', () => {
    if (!last) return;
    const foil = faceFoil(last.card[last.face]);
    if (foil.shape !== 'none') {
      intents.editFoil({ shape: 'none' });
      return;
    }
    const back = lastShape[last.face];
    intents.editFoil({ shape: back === 'mask' && foil.mask === undefined ? 'full' : back });
  });

  const el = h('aside', { className: 'panel panel-left', attrs: { 'aria-label': S.layers.title } }, [
    tabs.el,
    head,
    h('div', { className: 'list-scroll' }, [foilRow, list, empty]),
    h('div', { className: 'panel-foot' }, [h('div', { className: 'foot-btns' }, [upload, addText]), uploadHelp, fileInput]),
  ]);

  const rows = new Map<string, Row>();
  /** 焦點最後在哪一列（id）；焦點離開清單就清掉（Tab 停點回到選中的那列）。 */
  let focusRow: string | null = null;
  let last: UiState | null = null;
  let dragging: {
    id: string;
    startY: number;
    moved: boolean;
    rects: { top: number; bottom: number }[];
    order: Layer[];
    /** 這一面的資料陣列（swapTarget 用來找剪裁層的下面那層）。 */
    layers: Layer[];
    /** 跟著一起移動的剪裁層（T-803）。 */
    followers: Row[];
  } | null = null;
  let justDragged = false;

  // ---- 每一列 ----

  const makeRow = (layer: Layer): Row => {
    const grip = h('span', { className: 'layer-grip', title: S.layers.dragTip }, [icon('grip', 18)]);
    const thumb = h('img', { className: 'layer-thumb', attrs: { alt: '', draggable: 'false' } });
    const tag = h('span', { className: 'layer-tag' });
    tag.hidden = true;
    const altTag = h('span', { className: 'layer-alt-tag', attrs: { 'aria-hidden': 'true' } });
    altTag.hidden = true;
    const name = h('input', {
      className: 'layer-name',
      attrs: { type: 'text', maxlength: '60', spellcheck: 'false', 'aria-label': S.layers.nameLabel },
    });
    const sub = h('span', { className: 'layer-sub' });
    const look = h('span', { className: 'layer-look' });
    look.hidden = true;
    const holo = button('btn-icon layer-holo', [icon('sparkle')]);
    const eye = button('btn-icon layer-eye', [icon('eye')]);
    const remove = button('btn-icon layer-remove', [icon('trash')], S.layers.removeTip);
    remove.setAttribute('aria-label', S.layers.removeLabel);
    const clipArrow = h('span', { className: 'layer-clip-arrow', attrs: { 'aria-hidden': 'true' } }, [icon('clipArrow', 16)]);
    clipArrow.hidden = true;
    const li = h('li', { className: 'layer-row', attrs: { tabindex: '-1' } }, [
      clipArrow,
      grip,
      h('span', { className: 'layer-thumb-wrap' }, [thumb, tag, altTag]),
      h('span', { className: 'layer-text' }, [name, sub]),
      h('span', { className: 'layer-actions' }, [holo, eye, remove]),
      look,
    ]);
    const row: Row = { layer, el: li, thumb, tag, altTag, name, sub, look, grip, clipArrow, clipped: false, holo, eye, remove };

    li.addEventListener('click', (e) => {
      if (justDragged) return;
      if ((e.target as Element).closest('button')) return;
      intents.selectLayer(row.layer.id);
    });
    holo.addEventListener('click', () => {
      // 衝出卡片的層整層不反光：開關沒有作用（T-411b，變淡、滑過說明）
      if (layerHoloToggle(row.layer).state === 'locked') return;
      intents.editLayer(row.layer.id, { holo: !row.layer.holo }, 'commit');
    });
    eye.addEventListener('click', () => intents.editLayer(row.layer.id, { visible: !row.layer.visible }, 'commit'));
    remove.addEventListener('click', () => intents.deleteLayer(row.layer.id));

    // 改名：Enter 或離開輸入框就存；Esc 還原。
    // 以前焦點一進輸入框就選中這一層；現在不選了（T-607）：用 Tab 走過清單時不會順手選到一層（選了之後方向鍵就變成移動它，不是轉卡）。
    // 用滑鼠點輸入框照樣選中（列的 click），鍵盤用 Enter 選中。
    name.addEventListener('change', () => intents.editLayer(row.layer.id, { name: name.value }, 'commit'));
    name.addEventListener('keydown', (e) => {
      // 用輸入法選字時的 Enter／Esc 是給輸入法的（同卡名、卡片庫改名；T-703b）
      if (e.isComposing) return;
      if (e.key === 'Enter') name.blur();
      if (e.key === 'Escape') {
        name.value = row.layer.name;
        name.blur();
      }
    });
    name.addEventListener('blur', () => {
      // 空白名字不會被接受：離開時顯示回目前的名字
      const current = last?.card[last.face].layers.find((l) => l.id === row.layer.id);
      if (current && name.value !== current.name) name.value = current.name;
    });

    // 拖拉排序：從把手或縮圖按下
    const startDrag = (e: PointerEvent) => {
      // 剪裁中的層不能拖（T-803：跟著下面那層；按一下照樣選中，由列的 click 處理）
      if (e.button !== 0 || row.layer.role === 'base' || row.clipped || !last) return;
      e.preventDefault();
      const layers = last.card[last.face].layers;
      const order = displayOrder(layers);
      const rects = order.map((l) => {
        const r = rows.get(l.id)!.el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      // 這層的剪裁層跟著一起移動（畫面上在它上面那幾列）：範圍和 model 的 swapDepth 一樣（clipRunEnd）
      const index = layers.findIndex((l) => l.id === row.layer.id);
      const followers: Row[] = [];
      for (let k = index + 1; k < clipRunEnd(layers, index); k++) {
        const f = rows.get(layers[k]!.id);
        if (f) followers.push(f);
      }
      dragging = { id: row.layer.id, startY: e.clientY, moved: false, rects, order, layers, followers };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const moveDrag = (e: PointerEvent) => {
      if (!dragging || dragging.id !== row.layer.id) return;
      const dy = e.clientY - dragging.startY;
      if (!dragging.moved && Math.abs(dy) < DRAG_START_PX) return;
      dragging.moved = true;
      for (const r of [row, ...dragging.followers]) {
        r.el.classList.add('is-dragging');
        r.el.style.setProperty('--drag-y', `${dy}px`);
      }
      const target = swapTarget(dragging.order, dragging.id, indexAtY(e.clientY, dragging.rects), dragging.layers);
      for (const r of rows.values()) toggleClass(r.el, 'is-swap-target', r.layer.id === target);
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging || dragging.id !== row.layer.id) return;
      const d = dragging;
      dragging = null;
      const target = d.moved ? swapTarget(d.order, d.id, indexAtY(e.clientY, d.rects), d.layers) : null;
      for (const r of [row, ...d.followers]) {
        r.el.classList.remove('is-dragging');
        r.el.style.removeProperty('--drag-y');
      }
      for (const r of rows.values()) r.el.classList.remove('is-swap-target');
      if (d.moved) {
        // click 事件緊接在 pointerup 之後：這一下不算「點一列」
        justDragged = true;
        setTimeout(() => (justDragged = false), 0);
      }
      if (target) intents.swapLayers(d.id, target);
      else if (!d.moved) intents.selectLayer(row.layer.id);
    };
    for (const handle of [grip, thumb]) {
      handle.addEventListener('pointerdown', startDrag);
      handle.addEventListener('pointermove', moveDrag);
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    }
    return row;
  };

  const updateRow = (row: Row, layer: Layer, state: UiState) => {
    row.layer = layer;
    const faceLayers = state.card[state.face].layers;
    row.clipped = clipParent({ layers: faceLayers }, faceLayers.indexOf(layer)) !== null;
    const url = state.imageUrl(layer.image) ?? '';
    if (row.thumb.getAttribute('src') !== url) row.thumb.setAttribute('src', url);
    // 文字圖層的圖兩旁有透明邊：縮圖只顯示字的部分
    const box = layer.text ? state.textContentBox?.(layer.image) : undefined;
    const viewBox = box ? `inset(0% ${((1 - box.w) / 2) * 100}% 0% ${((1 - box.w) / 2) * 100}%)` : '';
    if (row.thumb.style.getPropertyValue('object-view-box') !== viewBox) row.thumb.style.setProperty('object-view-box', viewBox);
    if (document.activeElement !== row.name && row.name.value !== layer.name) row.name.value = layer.name;
    setText(row.sub, layerSubText(layer));
    // 第三行（T-833）：混合模式白話名・不透明度；底圖沒有
    const lookText = layerLookText(layer);
    setHidden(row.look, lookText === null);
    toggleClass(row.el, 'has-look', lookText !== null);
    setText(row.look, lookText ?? '');
    // 混合模式不是正常：縮圖角落標模式的白話名（T-408）
    const tagText = layerBlendTag(layer);
    setHidden(row.tag, tagText === null);
    setText(row.tag, tagText ?? '');
    // 有變身圖：縮圖右上角「雙」（T-805）
    const altText = layerAltTag(layer);
    setHidden(row.altTag, altText === null);
    setText(row.altTag, altText ?? '');
    const isBase = layer.role === 'base';
    toggleClass(row.el, 'is-base', isBase);
    toggleClass(row.el, 'is-selected', layer.id === state.selectedLayerId);
    toggleClass(row.el, 'is-hidden', !layer.visible);
    if (layer.id === state.selectedLayerId) row.el.setAttribute('aria-current', 'true');
    else row.el.removeAttribute('aria-current');
    row.grip.title = isBase ? S.layers.baseFixed : row.clipped ? S.layers.clipDragTip(CLIP_FOLLOW_TEXT) : S.layers.dragTip;
    // 剪裁中的層（T-803）：往右縮一格、前面一個小箭頭、拖把手變淡
    toggleClass(row.el, 'is-clipped', row.clipped);
    setHidden(row.clipArrow, !row.clipped);
    // 列本身可以拿焦點（T-607）：朗讀圖層名字，隱藏中的、剪裁中的說一聲
    const notes = [layer.visible ? '' : S.layers.hiddenNote, row.clipped ? CLIP_LABEL : '', layer.alt ? S.layers.hasAlt : ''].filter(Boolean).join(S.layers.noteSeparator);
    row.el.setAttribute('aria-label', notes ? S.layers.rowLabel(layer.name, notes) : layer.name);
    // 反光星星：只在反光層選「用圖層形狀」時出現（T-417）；開＝填色的星星、關＝空心加斜線；
    // 衝出卡片的層整層不反光（T-411）＝空心加斜線、變淡、按了不改，滑過說明（T-411b）
    setHidden(row.holo, faceFoil(state.card[state.face]).shape !== 'layers');
    const holo = layerHoloToggle(layer);
    if (row.holo.dataset.state !== holo.state) {
      row.holo.dataset.state = holo.state;
      swapIcon(row.holo, holo.state === 'on' ? 'sparkle' : 'sparkleOff');
      row.holo.title = holo.title;
      row.holo.setAttribute('aria-label', holo.title);
      if (holo.state === 'locked') {
        row.holo.setAttribute('aria-disabled', 'true');
        row.holo.removeAttribute('aria-pressed');
      } else {
        row.holo.removeAttribute('aria-disabled');
        row.holo.setAttribute('aria-pressed', String(layer.holo));
      }
    }
    const eyeState = layer.visible ? 'on' : 'off';
    if (row.eye.dataset.state !== eyeState) {
      row.eye.dataset.state = eyeState;
      swapIcon(row.eye, layer.visible ? 'eye' : 'eyeOff');
      row.eye.title = layer.visible ? S.layers.eyeOn : S.layers.eyeOff;
      row.eye.setAttribute('aria-label', row.eye.title);
      row.eye.setAttribute('aria-pressed', String(!layer.visible));
    }
  };

  // ---- 鍵盤：Tab 停點只有一列；↑ ↓ 換列、Enter 選中、空白鍵顯示／隱藏 ----
  /** 現在的 Tab 停點是哪一列：焦點最後在的那列，沒有就選中的那列，再沒有就最上面那列。 */
  const rovingId = (): string | null => {
    if (focusRow !== null && rows.has(focusRow)) return focusRow;
    const selected = last?.selectedLayerId;
    if (selected != null && rows.has(selected)) return selected;
    const first = list.children[0];
    for (const row of rows.values()) if (row.el === first) return row.layer.id;
    return null;
  };
  const updateRoving = () => {
    const active = rovingId();
    for (const row of rows.values()) {
      const on = row.layer.id === active;
      row.el.tabIndex = on ? 0 : -1;
      for (const control of [row.name, row.holo, row.eye, row.remove]) control.tabIndex = on ? 0 : -1;
    }
  };
  const rowOf = (target: unknown) => {
    for (const row of rows.values()) if (row.el === target) return row;
    return undefined;
  };
  el.addEventListener('keydown', (e) => {
    // Ctrl+空白鍵（切輸入法）、Ctrl+↑ 之類的組合鍵、輸入法選字中不攔（T-607c）
    if (!plainKey(e)) return;
    const target = e.target as HTMLElement;
    const row = rowOf(target);
    // 只管焦點在「列本身」的按鍵：名字輸入框、眼睛按鈕上的按鍵留給它們自己
    if (!row && target !== foilRow) return;
    const items = [foilRow, ...(Array.from(list.children) as HTMLElement[])];
    const to = listStep(e.key, items.indexOf(target), items.length);
    if (to !== null) {
      e.preventDefault();
      const next = items[to]!;
      const nextRow = rowOf(next);
      if (nextRow) {
        focusRow = nextRow.layer.id;
        updateRoving();
      }
      next.focus();
      return;
    }
    if (!row) return;
    const action = layerRowKey(e.key);
    if (action === 'select') {
      e.preventDefault();
      intents.selectLayer(row.layer.id);
    } else if (action === 'toggle-visible') {
      e.preventDefault();
      intents.editLayer(row.layer.id, { visible: !row.layer.visible }, 'commit');
    }
  });
  el.addEventListener('focusin', (e) => {
    const row = rowAround(e.target as HTMLElement | null);
    focusRow = row ? row.layer.id : null;
    updateRoving();
  });
  el.addEventListener('focusout', (e) => {
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (!to || !list.contains(to)) {
      focusRow = null;
      updateRoving();
    }
  });
  /** 這個元素在哪一列裡面（列本身或裡面的名字、按鈕）。 */
  function rowAround(target: HTMLElement | null): Row | undefined {
    for (let n: HTMLElement | null = target; n && n !== list; n = n.parentNode as HTMLElement | null) {
      const row = rowOf(n);
      if (row) return row;
    }
    return undefined;
  }

  return {
    el,
    render(state) {
      last = state;
      // 光碟的清單一直是正面：分頁的選中樣子改看卡片正給人看哪一面（T-810b：方向鍵 → ← 才能往返）
      tabs.set(isDisc(state.card) ? (state.viewFace ?? 'front') : state.face);
      lockBack(isDisc(state.card));
      setText(frontCount, String(state.card.front.layers.length));
      setText(backCount, String(state.card.back.layers.length));

      const layers = state.card[state.face].layers;
      setText(count, S.layers.count(layers.length, MAX_LAYERS_PER_FACE));
      toggleClass(count, 'is-full', layers.length >= MAX_LAYERS_PER_FACE);
      setHidden(empty, layers.length > 0);
      const foil = faceFoil(state.card[state.face]);
      toggleClass(list, 'show-holo', foil.shape === 'layers');

      // 反光層那一列
      if (foil.shape !== 'none') lastShape[state.face] = foil.shape;
      foilPic.set(foil.shape, foil.mask !== undefined ? (state.imageUrl(foil.mask) ?? '') : '');
      setText(foilSub, foilShapeText(foil.shape));
      setFoilEye(foilEye, foil.shape !== 'none');
      toggleClass(foilRow, 'is-selected', state.foilSelected === true);
      toggleClass(foilRow, 'is-hidden', foil.shape === 'none');
      if (state.foilSelected) foilRow.setAttribute('aria-current', 'true');
      else foilRow.removeAttribute('aria-current');
      setText(
        emptyText,
        state.face === 'back'
          ? S.layers.emptyBack
          : S.layers.emptyFront,
      );
      upload.disabled = layers.length >= MAX_LAYERS_PER_FACE;
      upload.title = upload.disabled ? S.layers.faceFull : (state.face === 'front' ? S.layers.uploadToFront : S.layers.uploadToBack);
      addText.disabled = upload.disabled;
      addText.title = addText.disabled ? S.layers.faceFull : (state.face === 'front' ? S.layers.addTextToFront : S.layers.addTextToBack);

      // 拖拉中不重排，免得列在手底下跳走
      if (dragging?.moved) return;

      const order = displayOrder(layers);
      const keep = new Set(order.map((l) => l.id));
      // 焦點在要拿掉的那一列裡（用鍵盤按了垃圾桶、復原把這層拿掉）：記下它在第幾列，重排後焦點給補上那個位置的列（T-607c）
      const focused = document.activeElement as HTMLElement | null;
      let refocusAt = -1;
      for (const [id, row] of rows) {
        if (!keep.has(id)) {
          if (focused && row.el.contains(focused)) refocusAt = Array.from(list.children).indexOf(row.el);
          row.el.remove();
          rows.delete(id);
        }
      }
      order.forEach((layer, i) => {
        let row = rows.get(layer.id);
        if (!row) {
          row = makeRow(layer);
          rows.set(layer.id, row);
        }
        updateRow(row, layer, state);
        if (list.children[i] !== row.el) list.insertBefore(row.el, list.children[i] ?? null);
      });
      if (refocusAt >= 0) {
        // 補上它位置的那一列（刪的是最下面那列就上一列）；清單空了就反光層那一列。不掉到頁面最前面（body）
        const next = (list.children[Math.min(refocusAt, list.children.length - 1)] as HTMLElement | undefined) ?? foilRow;
        focusRow = rowOf(next)?.layer.id ?? null;
        next.focus({ preventScroll: true });
      }
      updateRoving();
    },
  };
}
