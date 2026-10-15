// 右欄：「選中的圖層」設定（T-840）：文字、深度、不透明度、混合模式、自動去背、位置、大小、置中／填滿；
// 「進階效果」子節（衝出卡片、沿線條反光、只畫在下面那層上、變身圖、動態特效）收起時仍照常生效，標題顯示開著幾個。＋
// 「卡片」設定（最上面是一鍵風格〔T-801〕，然後是比例、卡身色、圓角、卡框〔含樣式、光澤〕、鐳射〔含色彩〕、陰影、卡片故事〔T-804〕、
// 舞台〔六顆按鈕下面：水鏡時多「遠景」三選一〔T-815，water-scene-picker.ts〕，再下面一列「背景圖」〔T-814，backdrop-picker.ts〕，
// 看得到遠景時多「位置」〔T-822，far-pan-picker.ts〕，最下面「前景圖」〔T-830，foreground-picker.ts〕〕、
// 展示擺動、透明卡套〔T-806〕、放開後回正）。
// CD 光碟（T-810）：比例、圓角、卡框（含雕花）、透明卡套的小節不顯示。
// 選中左欄的「反光層」（T-417）時，「選中的圖層」那一塊換成反光層面板（foil-panel.ts）；鐳射小節原本的「範圍」拿掉（由反光層決定）。
// 各小節可以摺疊（T-836，collapse.ts）：選中的圖層、反光層、風格、比例、卡身（卡身顏色＋圓角）、卡框（開關照樣在標題列）、鐳射、陰影、
// 卡片故事、舞台；標題變成按鈕＋小箭頭，只有進階效果預設收起，偏好記在這台電腦（createInspector 的 sections，main 接 localStorage）。
// 展示擺動、透明卡套、放開後回正只有一個開關，不摺疊。導覽指到右欄時 reveal() 先展開看得到的那一塊（選中的圖層或反光層）。

import { S } from '../i18n';
import { clipParent, frameStyle, layerBlend, layerOpacity, sleeveOn } from '../model/actions';
import { isDisc } from '../model/aspect';
import { FX_DEFAULT_COLORS } from '../model/fx';
import { RANGE } from '../model/limits';
import type { FrameStyle, FxKind, Layer, StageStyle } from '../model/types';
import { createAspectPicker } from './aspect-picker';
import { createBackdropPicker } from './backdrop-picker';
import { createFarPanPicker } from './far-pan-picker';
import { createForegroundPicker } from './foreground-picker';
import { createWaterLookPicker } from './water-look-picker';
import { createWaterScenePicker } from './water-scene-picker';
import { createSectionPrefs, makeCollapsible, sectionBody, wrapFollowing } from './collapse';
import { attachRadioGroup, createSegmented, createSlider, createSwatches, createSwitch, type SwatchPreset } from './controls';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { createFoilPanel } from './foil-panel';
import { icon, type IconName } from './icons';
import {
  AI_CUTOUT_LABEL,
  AI_LAYER_BUSY_TEXT,
  AI_MODEL_MISSING_NOTE,
  ALT_ADD_LABEL,
  ALT_CHANGE_LABEL,
  ALT_EMPTY_HELP,
  ALT_HELP,
  ALT_REMOVE_LABEL,
  ALT_TITLE,
  altSection,
  BLEND_OPTIONS,
  blendChoices,
  BREAKOUT_HELP,
  BREAKOUT_LABEL,
  breakoutShown,
  breakoutSwitch as breakoutSwitchState,
  CLIP_FOLLOW_TEXT,
  CLIP_HELP,
  CLIP_LABEL,
  clipShown,
  clipSwitch,
  FX_HELP,
  FX_OPTIONS,
  FX_TITLE,
  fxSection,
  holoStrengthText,
  LAYER_CUTOUT_HELP,
  layerCutoutShown,
  LINEART_HELP,
  LINEART_LABEL,
  lineartShown,
  lineartSwitch,
  OPAQUE_BLEND_NOTE,
  opacityText,
  plainKey,
  scaleToSlider,
  SCALE_SLIDER_MAX,
  shadowStrengthText,
  SLEEVE_HELP,
  SLEEVE_LABEL,
  sliderToScale,
  sparkleText,
} from './logic';
import { createPalettePicker } from './palette-picker';
import { createStoryPanel } from './story-panel';
import { STORY_ENABLED } from './story';
import { createStylePicker } from './style-picker';
import { createTextPanel } from './text-panel';
import type { SectionStore, UiIntents, UiState } from './types';

const BODY_COLORS: readonly SwatchPreset[] = [
  { color: '#1b2033', name: S.colors.nightBlue },
  { color: '#101014', name: S.colors.inkBlack },
  { color: '#efe8da', name: S.colors.ivory },
  { color: '#5c1f2e', name: S.colors.wine },
  { color: '#1d3d35', name: S.colors.inkGreen },
  { color: '#3b2c5e', name: S.colors.duskPurple },
];

/** 動態特效的顏色（T-811）：三種的預設色（火焰橘紅、電光青藍、水波淡青，model/fx.ts）＋幾個常用的。 */
const FX_COLORS: readonly SwatchPreset[] = [
  { color: FX_DEFAULT_COLORS.fire, name: S.colors.orangeRed },
  { color: '#ffc83d', name: S.colors.golden },
  { color: FX_DEFAULT_COLORS.electric, name: S.colors.cyan },
  { color: FX_DEFAULT_COLORS.water, name: S.colors.paleCyan },
  { color: '#b47bff', name: S.colors.purple },
  { color: '#ff6fb5', name: S.colors.pink },
];

/** 動態特效的選項圖示（「無」用舞台「關閉」那個斜線圓）。 */
const FX_ICONS: Record<FxKind, IconName> = { fire: 'fxFire', electric: 'fxElectric', water: 'fxWater' };

const FRAME_COLORS: readonly SwatchPreset[] = [
  { color: '#d8dbe2', name: S.colors.silver },
  { color: '#d4af37', name: S.colors.gold },
  { color: '#ffffff', name: S.colors.white },
  { color: '#16161a', name: S.colors.black },
];

/** 卡框樣式（T-416，DESIGN「卡框樣式」）：每個選項一個小縮圖＋名字。 */
const FRAME_STYLE_OPTIONS: readonly { value: FrameStyle; label: string; title: string }[] = [
  { value: 'simple', label: S.card.frameSimple, title: S.card.frameSimpleTip },
  { value: 'ornate', label: S.card.frameOrnate, title: S.card.frameOrnateTip },
];
/** 雕花邊角的素材讀不到時（T-416b）：卡框樣式下面的說明。 */
const FRAME_CORNER_MISSING = S.card.frameCornerMissing;

/** 舞台（T-415、T-832，DESIGN §5「舞台」）：七個選項，照原本的三欄排（3＋3＋1），每個一個小圖示＋名字；工作桌多一句滑過說明。 */
const STAGE_OPTIONS: readonly { value: StageStyle; label: string; icon: IconName; title?: string }[] = [
  { value: 'halo', label: S.stage.halo, icon: 'stageHalo' },
  { value: 'gallery', label: S.stage.gallery, icon: 'stageGallery' },
  { value: 'magic', label: S.stage.magic, icon: 'stageMagic' },
  { value: 'water', label: S.stage.water, icon: 'stageWater' },
  { value: 'nebula', label: S.stage.nebula, icon: 'stageNebula' },
  { value: 'desk', label: S.stage.desk, icon: 'stageDesk', title: S.stage.deskTip },
  { value: 'none', label: S.stage.none, icon: 'stageNone' },
];

export interface Inspector {
  readonly el: HTMLElement;
  render(state: UiState): void;
  /** 導覽圈右欄那一步（T-836）：「選中的圖層」（選著反光層時是反光層）收著就展開。 */
  reveal(): void;
}

/** sections：右欄摺疊偏好（T-836／T-840，main 接 localStorage）；沒給＝套用預設、不記。 */
export function createInspector(intents: UiIntents, sections?: SectionStore): Inspector {
  // 收起來的小節（T-836）：建右欄時讀一次，按了就整份寫回去（讀不到、寫不進去都不丟錯）
  const prefs = createSectionPrefs(
    sections && (() => sections.read()), sections && ((ids) => sections.write(ids)),
    sections && (() => sections.readExpanded?.() ?? []), sections && ((ids) => sections.writeExpanded?.(ids)),
  );
  let layer: Layer | null = null;
  const editSelected = (patch: Parameters<UiIntents['editLayer']>[1], phase: 'preview' | 'commit') => {
    if (layer) intents.editLayer(layer.id, patch, phase);
  };

  // ---- 選中的圖層 ----

  const layerName = h('span', { className: 'panel-sub' });
  const layerTitle = h('h2', { className: 'panel-title', text: S.inspector.layerTitle });
  const layerHead = h('div', { className: 'panel-head' }, [layerTitle, layerName]);
  const noSelection = h('p', { className: 'empty-note' });

  const depth = createSlider({
    label: S.inspector.depth,
    min: RANGE.depth.min,
    max: RANGE.depth.max,
    step: 1,
    valueText: (v) => String(Math.round(v)),
    ends: [S.inspector.depthNear, S.inspector.depthFar],
    onChange: (v, phase) => editSelected({ depth: v }, phase),
  });
  const depthHelp = h('p', { className: 'help', text: S.inspector.depthHelp });
  // 剪裁中的層（T-803）：深度跟著下面那層——滑桿變淡、不能拖，標題旁邊寫「跟著下面那層」
  const depthFollow = h('span', { className: 'depth-follow', text: CLIP_FOLLOW_TEXT });
  depthFollow.hidden = true;
  const depthHead = depth.el.querySelector('.field-head');
  depthHead?.insertBefore(depthFollow, depthHead.children[1] ?? null);
  const depthBlock = h('div', { className: 'field-group depth-block' }, [depth.el, depthHelp]);
  const baseNote = h('div', { className: 'note' }, [icon('info', 18), h('span', { text: S.inspector.baseNote })]);

  const posX = createSlider({
    label: S.inspector.posX,
    min: RANGE.position.min,
    max: RANGE.position.max,
    step: 0.01,
    bipolar: true,
    ends: [S.inspector.left, S.inspector.right],
    onChange: (v, phase) => editSelected({ x: v }, phase),
  });
  const posY = createSlider({
    label: S.inspector.posY,
    min: RANGE.position.min,
    max: RANGE.position.max,
    step: 0.01,
    bipolar: true,
    ends: [S.inspector.down, S.inspector.up],
    onChange: (v, phase) => editSelected({ y: v }, phase),
  });
  const size = createSlider({
    label: S.inspector.size,
    min: 0,
    max: SCALE_SLIDER_MAX,
    step: 1,
    valueText: (v) => `${Math.round(sliderToScale(v) * 100)}%`,
    onChange: (v, phase) => editSelected({ scale: sliderToScale(v) }, phase),
  });
  const centerBtn = button('btn', [icon('center', 18), S.inspector.center], S.inspector.centerTip);
  const fillBtn = button('btn', [icon('fill', 18), S.inspector.fill], S.inspector.fillTip);
  centerBtn.addEventListener('click', () => layer && intents.centerLayer(layer.id));
  fillBtn.addEventListener('click', () => layer && intents.fillLayer(layer.id));

  // ---- 衝出卡片（T-411，DESIGN §3「破框」）：底圖沒有；一按就 commit（一步、可復原）。
  //      有變身圖的層變淡、按了不改（T-805：破框層不能有變身圖），滑過說明 ----
  let breakoutLocked = false;
  const breakoutSwitch = createSwitch(BREAKOUT_LABEL, (next) => {
    if (!breakoutLocked) editSelected({ breakout: next }, 'commit');
  });
  const breakoutBlock = h('div', { className: 'field-group breakout-block' }, [
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: BREAKOUT_LABEL }), breakoutSwitch.el]),
    h('p', { className: 'help', text: BREAKOUT_HELP }),
  ]);

  // ---- 沿線條反光（T-802，DESIGN §1「線稿高光」）：立體層才有（底圖、文字層沒有）；一按就 commit（一步、可復原）。
  //      這層開了衝出卡片時變淡、按了不改（衝出卡片的層整層不反光），滑過說明；原生按鈕＋role=switch，鍵盤可用 ----
  let lineartLocked = false;
  const lineartToggle = createSwitch(LINEART_LABEL, (next) => {
    if (!lineartLocked) editSelected({ lineart: next }, 'commit');
  });
  const lineartBlock = h('div', { className: 'field-group lineart-block' }, [
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: LINEART_LABEL }), lineartToggle.el]),
    h('p', { className: 'help', text: LINEART_HELP }),
  ]);

  // ---- 只畫在下面那層上（T-803，DESIGN §3「剪裁遮色片」）：立體層與文字層有（底圖沒有）；一按就 commit（一步、可復原）。
  //      下面是底圖、這層在最下面、任一方衝出卡片時變淡、按了不改，滑過說明為什麼；原生按鈕＋role=switch，鍵盤可用 ----
  let clipLocked = false;
  const clipToggle = createSwitch(CLIP_LABEL, (next) => {
    if (!clipLocked) editSelected({ clip: next }, 'commit');
  });
  const clipBlock = h('div', { className: 'field-group clip-block' }, [
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: CLIP_LABEL }), clipToggle.el]),
    h('p', { className: 'help', text: CLIP_HELP }),
  ]);

  // ---- 變身圖（T-805，DESIGN「雙圖光柵」）：立體層（含加深層）有，底圖、文字層沒有；衝出卡片的層變淡、按了不改（滑過說明）。
  //      還沒有：〔加上變身圖〕；有了：小縮圖＋〔換一張〕〔拿掉〕＋說明句。選檔交給組裝端（ingest → 換上，一步）；
  //      〔拿掉〕一按就 commit（一步）。原生按鈕：Tab 走得到、Enter／空白鍵就是按 ----
  let altLocked = false;
  /** 按〔加上變身圖〕〔換一張〕時選中的那一層：選檔視窗開著時改選別層，圖還是加到這一層。 */
  let altTarget: string | null = null;
  /** 按下去時開著的那張卡（T-805 審查：選檔期間換了卡，main 對不上就不加）；畫面上這張卡＝shownCardId。 */
  let altCard: string | null = null;
  let shownCardId: string | null = null;
  const altFile = h('input', {
    className: 'visually-hidden alt-file',
    attrs: { type: 'file', accept: 'image/png,image/webp,image/jpeg', tabindex: '-1', 'aria-hidden': 'true' },
  });
  altFile.addEventListener('change', () => {
    const file = Array.from(altFile.files ?? [])[0];
    altFile.value = '';
    const target = altTarget;
    const card = altCard;
    altTarget = null;
    altCard = null;
    if (file && target && card) intents.uploadLayerAlt(target, file, card);
  });
  const pickAlt = () => {
    if (!layer || altLocked) return;
    altTarget = layer.id;
    altCard = shownCardId;
    altFile.click();
  };
  const altAdd = button('btn btn-block alt-add', [icon('upload', 18), ALT_ADD_LABEL]);
  altAdd.addEventListener('click', pickAlt);
  const altEmptyHelp = h('p', { className: 'help', text: ALT_EMPTY_HELP });
  const altThumb = h('img', { className: 'alt-thumb', attrs: { alt: ALT_TITLE, draggable: 'false' } });
  const altChange = button('btn alt-change', [icon('upload', 18), ALT_CHANGE_LABEL]);
  altChange.addEventListener('click', pickAlt);
  const altRemove = button('btn alt-remove', [icon('trash', 18), ALT_REMOVE_LABEL]);
  altRemove.addEventListener('click', () => {
    if (!altLocked) editSelected({ alt: null }, 'commit');
  });
  const altHelp = h('p', { className: 'help', text: ALT_HELP });
  const altRow = h('div', { className: 'alt-row' }, [
    h('span', { className: 'alt-frame' }, [altThumb]),
    h('span', { className: 'alt-actions' }, [altChange, altRemove]),
  ]);
  const altBlock = h('div', { className: 'field-group alt-block' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: ALT_TITLE })]),
    altAdd,
    altEmptyHelp,
    altRow,
    altHelp,
    altFile,
  ]);

  // ---- 動態特效（T-811，DESIGN「局部動態特效」）：底圖、立體層、文字層都有。無／火焰／電光／水波（單選群組，一按就 commit 一步；
  //      方向鍵換、跳過變淡的）＋顏色（預設幾個＋自選，拖自選色時 preview）＋強度、速度（拖動中 preview、放開 commit）。
  //      破框層整個小節變淡、按了不改；這一面已經 2 層有特效時第 3 層的火焰／電光／水波變淡（「無」照樣選著），下面一句說明 ----
  let fxLocked = false;
  const pickFx = (kind: FxKind | null) => {
    if (fxLocked) return;
    editSelected({ fx: kind === null ? null : { kind } }, 'commit');
  };
  const fxButtons = FX_OPTIONS.map((o) => {
    const el = button('seg-btn fx-opt', [icon(o.value === null ? 'stageNone' : FX_ICONS[o.value], 20), h('span', { text: o.label })], o.title);
    el.setAttribute('role', 'radio');
    // 朗讀名字＝選項名（滑過的說明句只當 title）
    el.setAttribute('aria-label', o.label);
    el.addEventListener('click', () => pickFx(o.value));
    return { value: o.value, el };
  });
  const fxList = h('div', { className: 'segmented fx-list', attrs: { role: 'radiogroup', 'aria-label': FX_TITLE } }, fxButtons.map((b) => b.el));
  // 破框層整個小節鎖住：方向鍵不走進鎖住的選項（只設 aria-disabled 時原生按鈕還是能被走到，T-811b）
  const fxRadios = attachRadioGroup(fxList, fxButtons.map((b) => b.el), (i) => pickFx(fxButtons[i]!.value), () => fxLocked);
  const fxNote = h('p', { className: 'help fx-note' });
  const fxColor = createSwatches(S.fx.color, FX_COLORS, (c, phase) => editSelected({ fx: { color: c } }, phase));
  const fxStrength = createSlider({
    label: S.fx.strength,
    min: RANGE.fxStrength.min,
    max: RANGE.fxStrength.max,
    step: 1,
    ends: [S.fx.strengthLow, S.fx.strengthHigh],
    onChange: (v, phase) => editSelected({ fx: { strength: v } }, phase),
  });
  const fxSpeed = createSlider({
    label: S.fx.speed,
    min: RANGE.fxSpeed.min,
    max: RANGE.fxSpeed.max,
    step: 1,
    ends: [S.fx.slow, S.fx.fast],
    onChange: (v, phase) => editSelected({ fx: { speed: v } }, phase),
  });
  const fxDetail = h('div', { className: 'fx-detail' }, [
    h('div', { className: 'field' }, [h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.common.color })]), fxColor.el]),
    fxStrength.el,
    fxSpeed.el,
  ]);
  const fxBlock = h('div', { className: 'field-group fx-block' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: FX_TITLE })]),
    h('p', { className: 'help', text: FX_HELP }),
    fxList,
    fxNote,
    fxDetail,
  ]);

  // 文字圖層：內容、字型、樣式…（其他圖層藏起來）
  const textPanel = createTextPanel(intents);

  // ---- 不透明度與混合模式（T-408，DESIGN §3）：底圖沒有；滑桿拖動中 preview、放開 commit；換模式一按就 commit ----
  const opacity = createSlider({
    label: S.inspector.opacity,
    min: RANGE.opacity.min,
    max: RANGE.opacity.max,
    step: 1,
    valueText: opacityText,
    ends: [S.inspector.opacityLow, S.inspector.opacityHigh],
    onChange: (v, phase) => editSelected({ opacity: v }, phase),
  });
  const blendButtons = BLEND_OPTIONS.map((o) => {
    const el = button('blend-opt', [
      h('span', { className: 'blend-name' }, [o.name, o.original ? h('span', { className: 'blend-orig', text: S.blend.originalParen(o.original) }) : null]),
      o.use ? h('span', { className: 'blend-use', text: o.use }) : null,
    ]);
    el.setAttribute('role', 'radio');
    el.addEventListener('click', () => editSelected({ blend: o.value }, 'commit'));
    return { value: o.value, el };
  });
  // 只能選三種時的說明：本來的圖沒有透明，或變身圖沒有透明（T-805）
  const blendNoteText = h('span', { text: OPAQUE_BLEND_NOTE });
  const blendNote = h('div', { className: 'note' }, [icon('info', 18), blendNoteText]);
  const blendList = h('div', { className: 'blend-list', attrs: { role: 'radiogroup', 'aria-label': S.blend.title } }, blendButtons.map((b) => b.el));
  // 單選群組的鍵盤（T-607b）：方向鍵換模式（跳過變淡不能選的），一按就 commit 一步（同點一下）；只有選中的那顆在 Tab 順序裡
  const blendRadios = attachRadioGroup(blendList, blendButtons.map((b) => b.el), (i) => editSelected({ blend: blendButtons[i]!.value }, 'commit'));
  // ---- 〔自動去背〕（T-703b，DESIGN §3.1）：沒有透明背景的立體層（例如當發光層用的圖）才有，在混合模式下面；
  //      做完換掉這一層的圖（其他設定不變、記一步）。正在做別的 AI 工作時變淡；模型不在時變淡＋說怎麼下載（同上傳確認框）。
  //      原生按鈕：Tab 走得到、Enter／空白鍵就是按 ----
  const cutoutBtn = button('btn btn-block layer-cutout-btn', [icon('sparkle', 18), AI_CUTOUT_LABEL]);
  cutoutBtn.addEventListener('click', () => layer && intents.autoCutoutLayer(layer.id));
  const cutoutNote = h('div', { className: 'note layer-cutout-note' }, [icon('info', 18), h('span', { text: AI_MODEL_MISSING_NOTE })]);
  const cutoutBlock = h('div', { className: 'field layer-cutout' }, [cutoutBtn, h('p', { className: 'help', text: LAYER_CUTOUT_HELP }), cutoutNote]);
  const lookBlock = h('div', { className: 'field-group' }, [
    opacity.el,
    h('div', { className: 'field' }, [
      h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.blend.title })]),
      h('p', { className: 'help', text: S.blend.help }),
      blendList,
      blendNote,
    ]),
    cutoutBlock,
  ]);

  const advancedCount = h('span', { className: 'layer-advanced-count' });
  advancedCount.hidden = true;
  const advancedTitle = h('div', { className: 'group-title' }, [
    h('span', { text: S.inspector.advancedTitle }), advancedCount,
  ]);
  const advancedBody = sectionBody([breakoutBlock, lineartBlock, clipBlock, altBlock, fxBlock]);
  advancedBody.classList.add('layer-advanced-body');
  const advancedBlock = h('div', { className: 'field-group layer-advanced' }, [advancedTitle, advancedBody]);
  makeCollapsible({ id: 'layer-advanced', title: advancedTitle, body: advancedBody, prefs });

  const layerControls = h('div', { className: 'panel-body' }, [
    textPanel.el,
    depthBlock,
    baseNote,
    lookBlock,
    h('div', { className: 'field-group' }, [h('div', { className: 'group-title', text: S.inspector.position }), posX.el, posY.el]),
    h('div', { className: 'field-group' }, [size.el, h('div', { className: 'btn-row' }, [centerBtn, fillBtn])]),
    advancedBlock,
  ]);
  // 可以摺疊（T-836）：收起時圖層名字照樣顯示在標題旁邊
  const layerBody = sectionBody([noSelection, layerControls]);
  const layerSection = h('section', { className: 'panel-section layer-section' }, [layerHead, layerBody]);
  const layerFold = makeCollapsible({ id: 'layer', title: layerTitle, body: layerBody, prefs });
  // 反光層（T-417）：選中左欄最上面那一列時，取代「選中的圖層」那一塊；同樣可以摺疊
  const foilPanel = createFoilPanel(intents);
  foilPanel.el.hidden = true;
  const foilFold = makeCollapsible({ id: 'foil', title: foilPanel.title, body: foilPanel.body, prefs });

  // ---- 卡片 ----

  // 比例（T-807）：五選一＋自訂寬高（aspect-picker.ts）
  const aspect = createAspectPicker(intents);
  const bodyColor = createSwatches(S.card.bodyColor, BODY_COLORS, (c, phase) => intents.editCard({ bodyColor: c }, phase));
  const corner = createSlider({
    label: S.card.corner,
    min: RANGE.cornerRadius.min,
    max: RANGE.cornerRadius.max,
    step: 0.005,
    ends: [S.card.cornerSquare, S.card.cornerRound],
    onChange: (v, phase) => intents.editCard({ cornerRadius: v }, phase),
  });

  const frameSwitch = createSwitch(S.card.frame, (next) => intents.editCard({ frame: { enabled: next } }, 'commit'));
  // 調粗細或顏色＝順便打開卡框（開著時 enabled:true 不會改變什麼；固定送同一組欄位，一次拖曳才會是一步）
  const frameWidth = createSlider({
    label: S.card.frameWidth,
    min: RANGE.frameWidth.min,
    max: RANGE.frameWidth.max,
    step: 0.005,
    ends: [S.card.frameThin, S.card.frameThick],
    onChange: (v, phase) => intents.editCard({ frame: { width: v, enabled: true } }, phase),
  });
  const frameColor = createSwatches(S.card.frameColor, FRAME_COLORS, (c, phase) => intents.editCard({ frame: { color: c, enabled: true } }, phase));
  const frameShine = createSlider({
    label: S.card.frameShine,
    min: RANGE.frameShine.min,
    max: RANGE.frameShine.max,
    step: 1,
    ends: [S.card.shinePlain, S.card.shineBright],
    onChange: (v, phase) => intents.editCard({ frame: { shine: v, enabled: true } }, phase),
  });
  // 樣式（T-416）：一按就 commit（一步、可復原）；和粗細、顏色一樣會順便打開卡框
  const frameStyleButtons = FRAME_STYLE_OPTIONS.map((o) => {
    // 小縮圖：迷你卡片＋細框；雕花邊角四個角各放一個花紋（CSS 用素材當遮罩、鏡射成四角）
    const corners = o.value === 'ornate' ? ['tl', 'tr', 'bl', 'br'].map((at) => h('span', { className: `frame-style-corner is-${at}` })) : [];
    const el = button('frame-style-opt', [
      h('span', { className: `frame-style-thumb is-${o.value}`, attrs: { 'aria-hidden': 'true' } }, corners),
      h('span', { className: 'frame-style-name', text: o.label }),
    ], o.title);
    el.setAttribute('role', 'radio');
    el.addEventListener('click', () => intents.editCard({ frame: { style: o.value, enabled: true } }, 'commit'));
    return { value: o.value, el };
  });
  /** 畫面上選著的樣式（render 時照卡片更新；方向鍵切換時先換，下一次 render 再對齊）。 */
  let shownStyle: FrameStyle = 'simple';
  /** 選中＝亮起來、aria-checked、Tab 停點只有選中的那顆（單選的慣例，T-416b）。 */
  const paintStyle = (style: FrameStyle) => {
    shownStyle = style;
    for (const b of frameStyleButtons) {
      const on = b.value === style;
      toggleClass(b.el, 'is-selected', on);
      if (b.el.getAttribute('aria-checked') !== String(on)) b.el.setAttribute('aria-checked', String(on));
      b.el.tabIndex = on ? 0 : -1;
    }
  };
  const frameStyleGroup = h('div', { className: 'frame-styles', attrs: { role: 'radiogroup', 'aria-label': S.card.frameStyle } }, frameStyleButtons.map((b) => b.el));
  // 方向鍵在兩個樣式之間移動：焦點跟過去、換樣式（一按一步，同點一下）；到頭了不動。
  // Ctrl+→ 之類的組合鍵、輸入法選字中不換（T-703b 補上 T-607c 的 plainKey）
  frameStyleGroup.addEventListener('keydown', (e) => {
    if (!plainKey(e)) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = FRAME_STYLE_OPTIONS.findIndex((o) => o.value === shownStyle);
    const next = FRAME_STYLE_OPTIONS[Math.min(FRAME_STYLE_OPTIONS.length - 1, Math.max(0, i + step))]!.value;
    frameStyleButtons.find((b) => b.value === next)?.el.focus();
    if (next === shownStyle) return;
    paintStyle(next);
    intents.editCard({ frame: { style: next, enabled: true } }, 'commit');
  });
  // 雕花素材讀不到（T-416b）：雕花邊角先畫成簡約，這裡說一句
  const frameCornerMissing = h('div', { className: 'note frame-style-missing' }, [icon('info', 18), h('span', { text: FRAME_CORNER_MISSING })]);
  frameCornerMissing.hidden = true;
  const frameStyleField = h('div', { className: 'field' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.card.frameStyleShort })]),
    frameStyleGroup,
    frameCornerMissing,
  ]);
  paintStyle('simple');
  const frameDetail = h('div', { className: 'frame-detail' }, [
    frameStyleField,
    frameWidth.el,
    h('div', { className: 'field' }, [h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.common.color })]), frameColor.el]),
    frameShine.el,
  ]);

  // ---- 鐳射（DESIGN §3）：滑桿拖動中 preview、放開 commit；色彩一按就 commit。哪裡反光由每一面的反光層決定（T-417） ----
  const holoStrength = createSlider({
    label: S.holo.strength,
    min: RANGE.holoStrength.min,
    max: RANGE.holoStrength.max,
    step: 1,
    valueText: holoStrengthText,
    ends: [S.holo.off, S.holo.brightest],
    onChange: (v, phase) => intents.editCard({ holo: { strength: v } }, phase),
  });
  const holoBand = createSlider({
    label: S.holo.bandWidth,
    min: RANGE.holoBandWidth.min,
    max: RANGE.holoBandWidth.max,
    step: 0.05,
    ends: [S.holo.bandThin, S.holo.bandWide],
    onChange: (v, phase) => intents.editCard({ holo: { bandWidth: v } }, phase),
  });
  const holoSparkle = createSlider({
    label: S.holo.sparkle,
    min: RANGE.holoSparkle.min,
    max: RANGE.holoSparkle.max,
    step: 1,
    valueText: sparkleText,
    ends: [S.holo.sparkleNone, S.holo.sparkleMany],
    onChange: (v, phase) => intents.editCard({ holo: { sparkle: v } }, phase),
  });
  const holoPalette = createPalettePicker((patch, phase) => intents.editCard({ holo: patch }, phase));
  const holoDetail = h('div', { className: 'frame-detail holo-detail' }, [holoPalette.el, holoBand.el, holoSparkle.el]);
  const holoTitle = h('div', { className: 'group-title holo-title' }, [icon('sparkle', 18), S.holo.title]);
  const holoBody = sectionBody([h('p', { className: 'help', text: S.holo.help }), holoStrength.el, holoDetail]);
  const holoGroup = h('div', { className: 'field-group' }, [holoTitle, holoBody]);
  makeCollapsible({ id: 'holo', title: holoTitle, body: holoBody, prefs });

  // ---- 陰影（T-310）：濃淡 0＝沒有（距離變淡）；滑桿拖動中 preview、放開 commit ----
  const shadowStrength = createSlider({
    label: S.shadow.strength,
    min: RANGE.shadowStrength.min,
    max: RANGE.shadowStrength.max,
    step: 1,
    valueText: shadowStrengthText,
    ends: [S.shadow.light, S.shadow.dark],
    onChange: (v, phase) => intents.editCard({ shadow: { strength: v } }, phase),
  });
  const shadowDistance = createSlider({
    label: S.shadow.distance,
    min: RANGE.shadowDistance.min,
    max: RANGE.shadowDistance.max,
    step: 1,
    ends: [S.shadow.near, S.shadow.far],
    onChange: (v, phase) => intents.editCard({ shadow: { distance: v } }, phase),
  });
  const shadowDetail = h('div', { className: 'frame-detail' }, [shadowDistance.el]);
  const shadowTitle = h('div', { className: 'group-title', text: S.shadow.title });
  const shadowBody = sectionBody([h('p', { className: 'help', text: S.shadow.help }), shadowStrength.el, shadowDetail]);
  const shadowGroup = h('div', { className: 'field-group' }, [shadowTitle, shadowBody]);
  makeCollapsible({ id: 'shadow', title: shadowTitle, body: shadowBody, prefs });

  // ---- 卡片故事（T-804，DESIGN「卡片故事」）：陰影之後、舞台之前（舞台不是「沒有」時直排顯示在卡片兩邊）；打字停手才記一步 ----
  const storyPanel = createStoryPanel(intents);
  // 卡片故事先藏起來（T-813，ui/story.ts 的 STORY_ENABLED）：小節照建、不顯示；之後打開時一樣可以摺疊（T-836）
  storyPanel.el.hidden = !STORY_ENABLED;
  const storyTitle = storyPanel.el.querySelector<HTMLElement>('.group-title');
  if (storyTitle) makeCollapsible({ id: 'story', title: storyTitle, body: wrapFollowing(storyTitle), prefs });

  // ---- 舞台（T-314、T-410、T-415、T-832）：七個場景排成三欄、每個有小圖示；一按就 commit（一步、可復原） ----
  const stageChoice = createSegmented<StageStyle>(
    S.stage.title,
    STAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: icon(o.icon, 22), title: o.title })),
    (stage) => intents.editCard({ view: { stage } }, 'commit'),
  );
  stageChoice.el.classList.add('stage-grid');
  // 水面樣子（T-825）：六顆按鈕正下面、「遠景」上面，只在水鏡顯示（快速套用一步；滑桿拖著即時看、放開記一步；選色記一步）
  const waterLookPicker = createWaterLookPicker(intents);
  // 水鏡遠景（T-815）：「水面」下面，只在水鏡顯示（三選一，每次切換記一步）
  const waterScenePicker = createWaterScenePicker(intents);
  // 舞台背景圖（T-814）：再下面一列「背景圖」（加、換、拿掉各記一步）
  const backdropPicker = createBackdropPicker(intents);
  // 遠景位置（T-822）：「遠景」「背景圖」下面；看得到遠景（有背景圖或水鏡）時才出現（拖滑桿即時看、放開記一步）
  const farPanPicker = createFarPanPicker(intents);
  // 前景圖（T-830）：「背景圖」與它的「位置」下面（加、換、拿掉各記一步；位置、大小、模糊拖滑桿即時看、放開記一步）
  const foregroundPicker = createForegroundPicker(intents);
  const stageTitle = h('div', { className: 'group-title', text: S.stage.title });
  const stageBody = sectionBody([
    h('p', { className: 'help', text: S.stage.help }),
    stageChoice.el,
    waterLookPicker.el,
    waterScenePicker.el,
    backdropPicker.el,
    farPanPicker.el,
    foregroundPicker.el,
  ]);
  const stageGroup = h('div', { className: 'field-group' }, [stageTitle, stageBody]);
  makeCollapsible({ id: 'stage', title: stageTitle, body: stageBody, prefs });

  const showcaseSwitch = createSwitch(S.card.showcase, (next) => intents.editCard({ view: { showcase: next } }, 'commit'));
  const returnSwitch = createSwitch(S.card.returnToFront, (next) => intents.editCard({ view: { returnToFront: next } }, 'commit'));
  // 透明卡套（T-806，DESIGN「透明卡套」）：展示擺動後面；一按就 commit（一步、可復原）
  const sleeveSwitch = createSwitch(SLEEVE_LABEL, (next) => intents.editCard({ view: { sleeve: next } }, 'commit'));

  // ---- 一鍵風格（T-801）：最上面；一按就套一組鐳射與卡框設定，記一步 ----
  const stylePicker = createStylePicker((style) => intents.applyStyle(style));
  const styleTitle = stylePicker.el.querySelector<HTMLElement>('.group-title');
  if (styleTitle) makeCollapsible({ id: 'style', title: styleTitle, body: wrapFollowing(styleTitle), prefs });

  // CD 光碟（T-810，DESIGN「CD 光碟」）：比例、圓角、卡框（含雕花）、透明卡套對光碟沒意義，整個小節不顯示
  const aspectLabel = h('span', { className: 'field-label', text: S.card.aspect });
  const aspectBody = sectionBody([aspect.el]);
  const aspectField = h('div', { className: 'field' }, [h('div', { className: 'field-head' }, [aspectLabel]), aspectBody]);
  makeCollapsible({ id: 'aspect', title: aspectLabel, body: aspectBody, prefs });
  corner.el.classList.add('corner-field');
  // 卡身（T-836）：卡身顏色＋圓角收成一節（標題「卡身」，顏色那一列的字和卡框一樣寫「顏色」；色票的朗讀名稱照舊「卡身顏色」）
  const bodyTitle = h('div', { className: 'group-title', text: S.card.body });
  const bodyBody = sectionBody([
    h('div', { className: 'field' }, [h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.common.color })]), bodyColor.el]),
    corner.el,
  ]);
  const bodyGroup = h('div', { className: 'field-group body-group' }, [bodyTitle, bodyBody]);
  makeCollapsible({ id: 'body', title: bodyTitle, body: bodyBody, prefs });
  // 卡框：標題列照樣有開關；收起時只藏下面的樣式、粗細、顏色、光澤
  const frameLabel = h('span', { className: 'field-label', text: S.card.frame });
  const frameBody = sectionBody([frameDetail]);
  const frameGroup = h('div', { className: 'field-group frame-group' }, [h('div', { className: 'field-row' }, [frameLabel, frameSwitch.el]), frameBody]);
  makeCollapsible({ id: 'frame', title: frameLabel, body: frameBody, prefs });
  const sleeveGroup = h('div', { className: 'field-group' }, [
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: SLEEVE_LABEL }), sleeveSwitch.el]),
    h('p', { className: 'help', text: SLEEVE_HELP }),
  ]);

  const cardSection = h('section', { className: 'panel-section' }, [
    h('div', { className: 'panel-head' }, [h('h2', { className: 'panel-title', text: S.card.title })]),
    h('div', { className: 'panel-body' }, [
      stylePicker.el,
      aspectField,
      bodyGroup,
      frameGroup,
      holoGroup,
      shadowGroup,
      storyPanel.el,
      stageGroup,
      h('div', { className: 'field-group' }, [
        h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: S.card.showcase }), showcaseSwitch.el]),
        h('p', { className: 'help', text: S.card.showcaseHelp }),
      ]),
      sleeveGroup,
      h('div', { className: 'field-group' }, [
        h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: S.card.returnToFront }), returnSwitch.el]),
        h('p', { className: 'help', text: S.card.returnHelp }),
      ]),
    ]),
  ]);

  const el = h('aside', { className: 'panel panel-right', attrs: { 'aria-label': S.inspector.settings } }, [
    layerSection,
    foilPanel.el,
    h('hr', { className: 'divider' }),
    cardSection,
  ]);

  return {
    el,
    reveal() {
      // 看得到的那一塊（選著反光層時是反光層面板）收著就展開（也記下來）
      (foilPanel.el.hidden ? layerFold : foilFold).setExpanded(true);
    },
    render(state) {
      shownCardId = state.card.id;
      const layers = state.card[state.face].layers;
      layer = layers.find((l) => l.id === state.selectedLayerId) ?? null;
      const foilShown = state.foilSelected === true;
      setHidden(layerSection, foilShown);
      setHidden(foilPanel.el, !foilShown);
      if (foilShown) foilPanel.render(state);

      setHidden(noSelection, layer !== null);
      setHidden(layerControls, layer === null);
      setText(layerName, layer ? layer.name : '');
      setText(
        noSelection,
        layers.length === 0 ? S.inspector.emptyNoLayers : S.inspector.emptyPick,
      );
      if (layer) {
        const activeEffects = [
          layer.breakout === true, layer.lineart === true, layer.clip === true,
          layer.alt !== undefined, layer.fx !== undefined,
        ].filter(Boolean).length;
        setHidden(advancedCount, activeEffects === 0);
        setText(advancedCount, activeEffects > 0 ? S.inspector.advancedCount(activeEffects) : '');
        const isBase = layer.role === 'base';
        const index = layers.indexOf(layer);
        setHidden(depthBlock, isBase);
        setHidden(baseNote, !isBase);
        if (!isBase) depth.set(layer.depth);
        // 剪裁中的層：深度跟著下面那層（T-803）
        const following = clipParent({ layers }, index) !== null;
        if (depth.input.disabled !== following) depth.input.disabled = following;
        toggleClass(depthBlock, 'is-following', following);
        setHidden(depthFollow, !following);
        posX.set(layer.x);
        posY.set(layer.y);
        size.set(scaleToSlider(layer.scale));
        // 「填滿」對文字沒有意義（會把字放大到蓋滿整張卡）
        setHidden(fillBtn, layer.text !== undefined);
        setHidden(breakoutBlock, !breakoutShown(layer));
        const bo = breakoutSwitchState(layer);
        breakoutLocked = bo.locked;
        breakoutSwitch.set(bo.on);
        toggleClass(breakoutBlock, 'is-locked', bo.locked);
        if (bo.locked) breakoutSwitch.el.setAttribute('aria-disabled', 'true');
        else breakoutSwitch.el.removeAttribute('aria-disabled');
        if (breakoutSwitch.el.title !== bo.title) breakoutSwitch.el.title = bo.title;
        if (breakoutBlock.title !== bo.title) breakoutBlock.title = bo.title;
        // 變身圖（T-805）
        const alt = altSection(layer);
        setHidden(altBlock, !alt.shown);
        if (alt.shown) {
          altLocked = alt.locked;
          toggleClass(altBlock, 'is-locked', alt.locked);
          if (altBlock.title !== alt.title) altBlock.title = alt.title;
          for (const b of [altAdd, altChange, altRemove]) {
            if (alt.locked) b.setAttribute('aria-disabled', 'true');
            else b.removeAttribute('aria-disabled');
          }
          setHidden(altAdd, alt.has);
          setHidden(altEmptyHelp, alt.has);
          setHidden(altRow, !alt.has);
          setHidden(altHelp, !alt.has);
          const url = layer.alt ? (state.imageUrl(layer.alt.image) ?? '') : '';
          if (altThumb.getAttribute('src') !== url) altThumb.setAttribute('src', url);
        }
        // 動態特效（T-811）：底圖、立體層、文字層都有
        const fx = fxSection(layers, index);
        fxLocked = fx.locked;
        toggleClass(fxBlock, 'is-locked', fx.locked);
        if (fxBlock.title !== fx.title) fxBlock.title = fx.title;
        fxButtons.forEach((b) => {
          const on = b.value === fx.kind;
          // 這一面已經滿了：這層還沒有特效時，火焰／電光／水波不能選（「無」照樣能按）
          const off = fx.full && b.value !== null;
          if (b.el.disabled !== off) b.el.disabled = off;
          if (fx.locked) b.el.setAttribute('aria-disabled', 'true');
          else b.el.removeAttribute('aria-disabled');
          toggleClass(b.el, 'is-selected', on);
          if (b.el.getAttribute('aria-checked') !== String(on)) b.el.setAttribute('aria-checked', String(on));
        });
        fxRadios.paint(fxButtons.findIndex((b) => b.value === fx.kind));
        setHidden(fxNote, fx.title === '');
        setText(fxNote, fx.title);
        setHidden(fxDetail, layer.fx === undefined);
        if (layer.fx) {
          fxColor.set(layer.fx.color);
          fxStrength.set(layer.fx.strength);
          fxSpeed.set(layer.fx.speed);
        }
        const lineartShownNow = lineartShown(layer);
        setHidden(lineartBlock, !lineartShownNow);
        if (lineartShownNow) {
          const sw = lineartSwitch(layer);
          lineartLocked = sw.locked;
          lineartToggle.set(sw.on);
          toggleClass(lineartBlock, 'is-locked', sw.locked);
          if (sw.locked) lineartToggle.el.setAttribute('aria-disabled', 'true');
          else lineartToggle.el.removeAttribute('aria-disabled');
          if (lineartToggle.el.title !== sw.title) lineartToggle.el.title = sw.title;
          if (lineartBlock.title !== sw.title) lineartBlock.title = sw.title;
        }
        const clipShownNow = clipShown(layer);
        setHidden(clipBlock, !clipShownNow);
        if (clipShownNow) {
          const sw = clipSwitch(layers, index);
          clipLocked = sw.locked;
          clipToggle.set(sw.on);
          toggleClass(clipBlock, 'is-locked', sw.locked);
          if (sw.locked) clipToggle.el.setAttribute('aria-disabled', 'true');
          else clipToggle.el.removeAttribute('aria-disabled');
          if (clipToggle.el.title !== sw.title) clipToggle.el.title = sw.title;
          if (clipBlock.title !== sw.title) clipBlock.title = sw.title;
        }
        // 不透明度與混合模式：底圖沒有；沒有透明的圖只能選三種（其他變淡＋說明）
        setHidden(lookBlock, isBase);
        if (!isBase) {
          opacity.set(layerOpacity(layer));
          const current = layerBlend(layer);
          const { choices, note } = blendChoices(layer);
          choices.forEach((c, i) => {
            const b = blendButtons[i]!;
            const on = c.option.value === current;
            if (b.el.disabled !== !c.enabled) b.el.disabled = !c.enabled;
            toggleClass(b.el, 'is-selected', on);
            if (b.el.getAttribute('aria-checked') !== String(on)) b.el.setAttribute('aria-checked', String(on));
          });
          blendRadios.paint(choices.findIndex((c) => c.option.value === current));
          setHidden(blendNote, note === null);
          if (note !== null) setText(blendNoteText, note);
        }
        // 〔自動去背〕（T-703b）：還不知道模型在不在（null）照樣能按（按了才查，不在就說怎麼下載）
        const cutShown = layerCutoutShown(layer);
        setHidden(cutoutBlock, !cutShown);
        if (cutShown) {
          const busy = state.ai?.busy === true;
          const missing = state.ai?.matteReady === false;
          if (cutoutBtn.disabled !== (busy || missing)) cutoutBtn.disabled = busy || missing;
          const title = busy ? AI_LAYER_BUSY_TEXT : '';
          if (cutoutBtn.title !== title) cutoutBtn.title = title;
          setHidden(cutoutNote, !missing);
        }
      }
      textPanel.render(layer, state);

      const card = state.card;
      const disc = isDisc(card);
      for (const part of [aspectField, corner.el, frameGroup, sleeveGroup]) setHidden(part, disc);
      stylePicker.render(card);
      aspect.render(card);
      bodyColor.set(card.bodyColor);
      corner.set(card.cornerRadius);
      frameSwitch.set(card.frame.enabled);
      toggleClass(frameDetail, 'is-off', !card.frame.enabled);
      frameWidth.set(card.frame.width);
      frameColor.set(card.frame.color);
      frameShine.set(card.frame.shine);
      paintStyle(frameStyle(card.frame));
      setHidden(frameCornerMissing, state.frameCornerMissing !== true);

      holoStrength.set(card.holo.strength);
      holoPalette.render(card.holo);
      holoBand.set(card.holo.bandWidth);
      holoSparkle.set(card.holo.sparkle);
      toggleClass(holoDetail, 'is-off', card.holo.strength <= 0);

      shadowStrength.set(card.shadow.strength);
      shadowDistance.set(card.shadow.distance);
      toggleClass(shadowDetail, 'is-off', card.shadow.strength <= 0);

      storyPanel.render(state);
      stageChoice.set(card.view.stage);
      waterLookPicker.render(state);
      waterScenePicker.render(state);
      backdropPicker.render(state);
      farPanPicker.render(state);
      foregroundPicker.render(state);
      showcaseSwitch.set(card.view.showcase);
      returnSwitch.set(card.view.returnToFront);
      sleeveSwitch.set(sleeveOn(card));
    },
  };
}
