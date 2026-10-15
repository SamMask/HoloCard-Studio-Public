// 新卡片面板（DESIGN 7.3；T-407）：頁首〔新卡片〕和卡片庫的〔＋ 新卡片〕都打開這一個。
//   空白卡：標準卡（63×88）、塔羅牌（70×120）、正方形（1:1）、明信片（100×148）、自訂（T-807）——各畫一個對應比例的卡片外形
//   （CSS 用 --card-hw 畫，不用圖檔）。「自訂」按下去在選項下面展開「寬 × 高」兩個數字框（預設 63 × 88）＋〔建立〕，
//   焦點放到寬；Enter 或〔建立〕建立；比例超出 1:2～2:1（或不是 1～999 的整數）時框變紅、〔建立〕不能按。
//   從範例開始：範例卡（T-605b；T-810 加第五張光碟：隨工坊附上的卡片檔）的縮圖與名字，點了建立一份副本（範例本身不會被改）。
//   縮圖＝卡片檔裡的預覽圖（組裝端讀檔、走完整檢查才給，不另外做圖、不多存一份）；第一次打開面板才讀，讀好之前顯示光澤佔位。
//   光碟（T-810，DESIGN「CD 光碟」）：空白卡最後一個，CSS 畫的圓形外形（中間有孔），點了建立 CD 光碟。
// 選了就關掉面板、建立並打開新卡（舊卡由組裝端先自動存好）。
// 「從範例開始」標題右邊〔開一包〕（T-808，pack-opening.ts）：從卡片庫的卡＋範例隨機抽 5 張、撕開卡包一張張翻；開包畫面蓋在面板上
// （面板 inert、Tab 只在開包畫面裡），Esc 先交給它（跳過 → 關掉），關掉焦點回〔開一包〕。範例縮圖和上面共用同一份。

import { S } from '../i18n';
import { aspectHeight, presetAspectSize } from '../model/aspect';
import type { Aspect, CustomAspect } from '../model/types';
import { createAspectSizeInputs, setShapeHeight } from './aspect-picker';
import { button, h } from './dom';
import { trapTab } from './focus';
import { icon } from './icons';
import { SAMPLE_NAMES } from './library-logic';
import { ASPECT_CHOICES, ASPECT_CREATE_TEXT, DISC_CHOICE } from './logic';
import { createPackOpening, packPool } from './pack-opening';
import { attachTilt } from './tilt';
import type { LibraryCard } from './types';

export interface NewCardHooks {
  /** 建立空白卡；自訂比例帶使用者打的寬高（其他比例沒有）。 */
  blank(aspect: Aspect, customAspect?: CustomAspect): void;
  /** 建立空白的 CD 光碟（T-810）。 */
  disc(): void;
  sample(index: number): void;
  /** 第 index 張範例的縮圖（卡片檔裡的預覽圖 PNG）；讀不到回 null。第一次打開面板時每張叫一次。 */
  preview(index: number): Promise<Blob | null>;
  /** 面板開關了。 */
  changed(): void;
  /** 開一包（T-808）的卡池：卡片庫的卡（含縮圖）。每次開包讀一次；讀不到就只用範例。 */
  libraryCards(): Promise<LibraryCard[]>;
  /** 開一包的〔打開這張〕抽到卡片庫的卡：打開它（面板已經關了）。 */
  openCard(id: string): void;
}

export interface NewCardPanel {
  readonly el: HTMLElement;
  isOpen(): boolean;
  /** focus＝焦點先放在哪一組（卡片庫空狀態的〔從範例開始〕放在範例）。 */
  open(focus: 'blank' | 'samples'): void;
  close(): void;
  escape(): void;
}

export function createNewCardPanel(hooks: NewCardHooks): NewCardPanel {
  let openState = false;
  let returnFocus: HTMLElement | null = null;

  const option = (art: HTMLElement, name: string, detail: string, onPick: () => void): HTMLButtonElement => {
    const b = button('nc-opt', [h('span', { className: 'nc-stage' }, [art]), h('span', { className: 'nc-name', text: name }), h('span', { className: 'nc-detail', text: detail })]);
    b.addEventListener('click', onPick);
    attachTilt(b, art);
    return b;
  };

  // ---- 空白卡：五種比例；自訂另外展開寬高 ----
  /** 自訂的預設寬高（DESIGN：63 × 88）。 */
  const customDefault = () => presetAspectSize('standard');
  let customArt: HTMLElement | null = null;
  const blankButtons = ASPECT_CHOICES.map((c) => {
    const cardH = aspectHeight(c.value === 'custom' ? { aspect: 'custom', customAspect: customDefault() } : { aspect: c.value });
    const art = h('span', { className: 'nc-art nc-blank' }, [icon('plus', 30), h('span', { className: 'lib-sheen', attrs: { 'aria-hidden': 'true' } })]);
    setShapeHeight(art, cardH);
    if (c.value === 'custom') {
      art.classList.add('is-custom');
      customArt = art;
    }
    const b = option(art, c.name, c.detail, () => (c.value === 'custom' ? openCustom() : pick(() => hooks.blank(c.value))));
    b.classList.add('nc-blank-opt');
    if (c.value === 'custom') {
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('aria-controls', 'nc-custom');
    }
    return b;
  });
  const customButton = blankButtons[blankButtons.length - 1]!;
  // 光碟（T-810）：圓形外形、中間一個孔（CSS 畫，不用圖檔）；小加號放在印刷面上
  const discArt = h('span', { className: 'nc-art nc-blank nc-disc' }, [
    icon('plus', 14),
    h('span', { className: 'nc-disc-hole', attrs: { 'aria-hidden': 'true' } }),
    h('span', { className: 'lib-sheen', attrs: { 'aria-hidden': 'true' } }),
  ]);
  setShapeHeight(discArt, 1);
  const discButton = option(discArt, DISC_CHOICE.name, DISC_CHOICE.detail, () => pick(() => hooks.disc()));
  discButton.classList.add('nc-blank-opt');

  const createBtn = button('btn primary nc-create', [ASPECT_CREATE_TEXT], S.newCard.createTip);
  const customSizes = createAspectSizeInputs({
    onInput(size) {
      createBtn.disabled = size === null;
      if (size && customArt) setShapeHeight(customArt, aspectHeight({ aspect: 'custom', customAspect: size }));
    },
    onEnter: () => createCustom(),
  });
  const customBox = h('div', { className: 'nc-custom', attrs: { id: 'nc-custom' } }, [customSizes.el, createBtn]);
  customBox.hidden = true;
  createBtn.addEventListener('click', () => createCustom());

  /** 展開「自訂」：寬高框出現（第一次是 63 × 88），焦點放到寬。 */
  function openCustom(): void {
    if (customBox.hidden) {
      customBox.hidden = false;
      customButton.setAttribute('aria-expanded', 'true');
      customButton.classList.add('is-open');
    }
    customSizes.width.focus();
    customSizes.width.select?.();
  }
  /** 收起「自訂」並放回預設寬高（每次打開面板都從 63 × 88 開始）。 */
  function resetCustom(): void {
    customBox.hidden = true;
    customButton.setAttribute('aria-expanded', 'false');
    customButton.classList.remove('is-open');
    const size = customDefault();
    customSizes.set(size);
    createBtn.disabled = false;
    if (customArt) setShapeHeight(customArt, aspectHeight({ aspect: 'custom', customAspect: size }));
  }
  function createCustom(): void {
    const size = customSizes.read();
    if (!size) return;
    pick(() => hooks.blank('custom', size));
  }
  resetCustom();

  /**
   * 第 index 張範例的縮圖：讀好的留著，面板和開一包共用（讀不到、出錯都是 null）。
   * 讀不到的不留：下次開一包抽到再讀一次（例如分頁在背景時讀太久被放棄）。
   */
  const previews = new Map<number, Promise<Blob | null>>();
  const samplePreview = (index: number): Promise<Blob | null> => {
    let read = previews.get(index);
    if (!read) {
      try {
        read = hooks.preview(index);
      } catch (err) {
        read = Promise.reject(err);
      }
      read = read
        .catch((err: unknown) => {
          console.error(err);
          return null;
        })
        .then((blob) => {
          if (!blob) previews.delete(index);
          return blob;
        });
      previews.set(index, read);
    }
    return read;
  };

  /** 範例的縮圖框：第一次打開面板才開始讀縮圖。 */
  const sampleArts: HTMLElement[] = [];
  const sampleButtons = SAMPLE_NAMES.map((name, index) => {
    const art = h('span', { className: 'nc-art nc-sample' }, [h('span', { className: 'lib-sheen', attrs: { 'aria-hidden': 'true' } })]);
    sampleArts.push(art);
    return option(art, name, S.newCard.sampleTip, () => pick(() => hooks.sample(index)));
  });
  let samplesLoaded = false;
  const loadSamples = () => {
    if (samplesLoaded) return;
    samplesLoaded = true;
    sampleArts.forEach((art, index) => {
      // 讀檔＋檢查＋圖解碼完才淡入（讀不到就拿掉佔位，只留深色底）
      art.classList.add('is-loading');
      const done = () => art.classList.remove('is-loading');
      void samplePreview(index).then((blob) => {
        if (!blob) return done();
        const url = URL.createObjectURL(blob);
        const img = h('img', { className: 'nc-preview', attrs: { src: url, alt: '', draggable: 'false', decoding: 'async' } });
        // 圖載好（或載入失敗）就收回 object URL（T-605c）：載好的圖留在 <img> 裡，面板關了再開也照樣顯示
        const settle = () => {
          img.removeEventListener('load', settle);
          img.removeEventListener('error', settle);
          URL.revokeObjectURL(url);
          done();
        };
        img.addEventListener('load', settle);
        img.addEventListener('error', settle);
        art.prepend(img);
      });
    });
  };

  const closeBtn = button('btn-icon nc-close', [icon('close', 22)], S.common.closeEsc);
  closeBtn.setAttribute('aria-label', S.common.closeLabel);
  closeBtn.addEventListener('click', () => close());

  const group = (iconName: 'cardStandard' | 'cards', title: string, tip: string, options: HTMLElement[], extra?: HTMLElement, headExtra?: HTMLElement) =>
    h('section', { className: 'nc-group' }, [
      h('div', { className: 'nc-group-head' }, [h('h3', { className: 'nc-group-title' }, [icon(iconName, 20), h('span', { text: title })]), headExtra ?? null]),
      h('p', { className: 'nc-group-tip', text: tip }),
      h('div', { className: 'nc-options' }, options),
      extra ?? null,
    ]);

  // ---- 開一包（T-808） ----
  const pack = createPackOpening({
    async pool() {
      const cards = await hooks.libraryCards().catch((err: unknown) => {
        console.error(err);
        return [] as LibraryCard[];
      });
      return packPool(cards, SAMPLE_NAMES, samplePreview);
    },
    pick(card) {
      panel.inert = false;
      const source = card.source;
      pick(() => (source.kind === 'card' ? hooks.openCard(source.id) : hooks.sample(source.index)));
    },
    closed() {
      panel.inert = false;
      packBtn.focus();
    },
  });
  // 〔開一包〕放在「從範例開始」標題的右邊（主對話 T-808 驗收時改：放最下面一整列，720 高的視窗要捲動才看得到）
  const packBtn = button('btn nc-pack-btn', [icon('sparkle', 18), h('span', { text: S.newCard.pack })], S.newCard.packTip);
  packBtn.addEventListener('click', () => {
    // 面板留在後面但不能按，Tab 只在開包畫面裡
    panel.inert = true;
    pack.open();
  });

  const panel = h('div', { className: 'nc-panel' }, [
    h('div', { className: 'nc-head' }, [
      h('div', {}, [
        h('h2', { className: 'nc-title', text: S.header.newCard, attrs: { id: 'nc-title' } }),
        h('p', { className: 'nc-sub', text: S.newCard.sub }),
      ]),
      closeBtn,
    ]),
    h('div', { className: 'nc-body' }, [
      group('cardStandard', S.newCard.blank, S.newCard.blankDetail, [...blankButtons, discButton], customBox),
      h('div', { className: 'nc-divider', attrs: { 'aria-hidden': 'true' } }),
      group('cards', S.newCard.fromSample, S.newCard.fromSampleDetail, sampleButtons, undefined, packBtn),
    ]),
  ]);

  const el = h('div', { className: 'nc-overlay', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nc-title' } }, [panel, pack.el]);
  el.hidden = true;
  // Tab 只在面板裡循環（T-607）
  trapTab(el);
  // 點面板外面＝關掉
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) close();
  });

  function close(): void {
    if (!openState) return;
    openState = false;
    // 開包畫面開著就一起收起（計時器停掉、縮圖收回）
    pack.hide();
    panel.inert = false;
    el.hidden = true;
    hooks.changed();
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  /** 選好了：先關面板（不把焦點還給原本的按鈕：畫面要換成新卡了），再建立。 */
  const pick = (create: () => void) => {
    returnFocus = null;
    close();
    create();
  };

  return {
    el,
    isOpen: () => openState,
    open(focus) {
      if (openState) return;
      openState = true;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetCustom();
      loadSamples();
      el.hidden = false;
      hooks.changed();
      (focus === 'samples' ? sampleButtons[0] : blankButtons[0])?.focus();
    },
    close,
    // 開包畫面開著：Esc 先給它（還沒到扇形＝跳過，已經是扇形＝關掉開包畫面），再一次才關面板
    escape: () => (pack.isOpen() ? pack.escape() : close()),
  };
}
