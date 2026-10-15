// 編輯器狀態（main 組裝用）：把畫面的意圖對到 model 的動作與復原堆疊。全部是純函式，不碰 DOM、不改輸入。
// 規則：
// - 一般動作（刪除、交換、置中、填滿、上傳…）＝ apply 一步；拖曳類（滑桿、顏色拖選）preview 只換畫面、commit 才記一步。
// - 每次 preview 都從「拖之前的卡」算（previewBase），所以只給這次拖的欄位就好。
// - 拖到一半換去改別的東西（不同的欄位）→ 先把進行中的拖曳記成一步，再做新的。
// - 記步時把 updatedAt 設成呼叫端給的現在時間。
// - 反光層（T-417）：左欄最上面那一列可以「選著」（foilSelected，和選圖層互斥）；改形狀、卡框也反光、換黑白圖各記一步。
// - 一鍵卡片風格（T-801）：applyStyleEdit 一次換一組鐳射與卡框設定＝一步，並顯示提示。
// - 舞台背景圖（T-814）：setBackdropEdit 加上、換一張、拿掉各記一步（選取與正在看的那一面都不動）。前景圖（T-830）的 setForegroundEdit 同樣；
//   前景圖的位置、大小、模糊走 editCard 的 view.foreground（拖滑桿 preview、放開 commit）。
// - AI（T-703、T-704）：上傳沒有透明的圖一律先問（askOpaqueUpload）；去背好的圖加成立體層；拆成立體層的幾段一次加進來＝一步（addSplitLayers）；
//   右欄〔自動去背〕（T-703b）去背好的圖換上原本那一層＝一步（replaceLayerImageEdit）。

import { MAX_PARALLAX } from '../interact/parallax';
import {
  addLayer,
  addTextLayer,
  altBlocked,
  blendAllowed,
  centerLayer,
  layerBlend,
  fillLayer,
  removeLayer,
  replaceBase,
  replaceLayerImage,
  setBackdrop,
  setForeground,
  swapDepth,
  updateCard,
  updateFoil,
  updateLayer,
  updateTextLayer,
  type CardPatch,
  type FoilPatch,
  type LayerPatch,
  type NewLayerInput,
  type NewTextLayerInput,
} from '../model/actions';
import { isDisc } from '../model/aspect';
import { newCard } from '../model/create';
import { cardImages, faceFoil } from '../model/foil';
import { MAX_CARD_IMAGES } from '../model/limits';
import { apply, cancel, canRedo, canUndo, commit, createHistory, preview, redo, undo, type History } from '../model/history';
import { applyCardStyle, type CardStyle } from '../model/styles';
import { MAX_LAYERS_PER_FACE, type Aspect, type Card, type FaceSide, type Layer, type LayerAlt, type TextSpec } from '../model/types';
import { styleAppliedText, type SplitRoomProblem } from './logic';
import type { EditPhase, OpaqueUploadBlend, UiMessage, UiState } from './types';

/** 上傳了不透明圖：等使用者回答怎麼用（T-408 只在已有底圖時問；T-703 起 askOpaqueUpload 不管有沒有底圖都問）。 */
export interface PendingBase {
  face: FaceSide;
  input: NewLayerInput;
  fileName: string;
}

export interface EditorState {
  readonly history: History<Card>;
  readonly face: FaceSide;
  /**
   * 卡片正給人看哪一面（T-810b，只有 CD 光碟用）：光碟的 face 一直是正面（背面不放圖），
   * 左欄〔正面｜背面〕分頁的選中樣子改看這個；main 每次把卡片轉到某一面時用 turnedTo 記下來。一般卡的分頁看 face。
   */
  readonly viewFace: FaceSide;
  readonly selectedLayerId: string | null;
  /** 選著這一面的反光層（T-417，左欄最上面那一列；和選圖層互斥）。 */
  readonly foilSelected: boolean;
  readonly message: UiMessage | null;
  readonly pending: PendingBase | null;
  /** 進行中的拖曳在改哪個欄位（例如 layer:<id>:depth）；沒有在拖＝null。 */
  readonly previewKey: string | null;
}

export function createEditor(card: Card): EditorState {
  return {
    history: createHistory(card),
    face: 'front',
    viewFace: 'front',
    selectedLayerId: null,
    foilSelected: false,
    message: null,
    pending: null,
    previewKey: null,
  };
}

/** 新卡片：換成新的復原堆疊（M2 還沒有存檔，舊卡不留）。 */
export function startNewCard(aspect: Aspect, id: string, now: string): EditorState {
  return createEditor(newCard(aspect, id, now));
}

export function currentCard(s: EditorState): Card {
  return s.history.present;
}

// ---- 內部工具 ----

function faceOf(card: Card, layerId: string): FaceSide | null {
  if (card.front.layers.some((l) => l.id === layerId)) return 'front';
  if (card.back.layers.some((l) => l.id === layerId)) return 'back';
  return null;
}

/** 選取只能指到目前這一面存在的圖層。 */
function fixSelection(s: EditorState): EditorState {
  const id = s.selectedLayerId;
  if (id === null) return s;
  return s.history.present[s.face].layers.some((l) => l.id === id) ? s : { ...s, selectedLayerId: null };
}

function stamp(card: Card, now: string): Card {
  return card.updatedAt === now ? card : { ...card, updatedAt: now };
}

/** 把進行中的拖曳記成一步（有改變才記，記的時候更新 updatedAt）。 */
function commitPending(h: History<Card>, now: string): History<Card> {
  if (h.previewBase === null) return h;
  if (h.present === h.previewBase) return commit(h);
  return commit({ ...h, present: stamp(h.present, now) });
}

/** 一般動作：先收掉進行中的拖曳，再對目前的卡做 action，有改變就記一步。 */
function act(s: EditorState, now: string, action: (card: Card) => Card): EditorState {
  const h = commitPending(s.history, now);
  const next = action(h.present);
  const history = next === h.present ? h : apply(h, stamp(next, now));
  return fixSelection({ ...s, history, previewKey: null });
}

/** 拖曳類：preview 從拖之前的卡算、只換畫面；commit 記一步。換了欄位就先把上一個拖曳記起來。 */
function drag(s: EditorState, key: string, phase: EditPhase, now: string, action: (card: Card) => Card): EditorState {
  let h = s.history;
  if (h.previewBase !== null && s.previewKey !== key) h = commitPending(h, now);
  const next = action(h.previewBase ?? h.present);
  h = preview(h, next);
  if (phase === 'preview') return fixSelection({ ...s, history: h, previewKey: key });
  return fixSelection({ ...s, history: commitPending(h, now), previewKey: null });
}

/** 欄位名稱（巢狀的用點連起來），用來分辨是不是同一個拖曳。 */
function patchKey(patch: object): string {
  return Object.entries(patch)
    .flatMap(([k, v]) => (v !== null && typeof v === 'object' ? Object.keys(v as object).map((sub) => `${k}.${sub}`) : [k]))
    .sort()
    .join(',');
}

// ---- 復原／重做 ----

export function undoEdit(s: EditorState): EditorState {
  return fixSelection({ ...s, history: undo(commitPending(s.history, s.history.present.updatedAt)), previewKey: null });
}

export function redoEdit(s: EditorState): EditorState {
  return fixSelection({ ...s, history: redo(commitPending(s.history, s.history.present.updatedAt)), previewKey: null });
}

/** 放棄進行中的拖曳（在卡上拖圖層時按 Esc、指標被取消）：回到拖之前，不記步。沒有在拖曳就原樣回傳。 */
export function cancelEdit(s: EditorState): EditorState {
  if (s.history.previewBase === null) return s;
  return fixSelection({ ...s, history: cancel(s.history), previewKey: null });
}

// ---- 選取 ----

/**
 * 切到另一面：取消選取圖層（選中的圖層屬於原本那一面）；選著反光層就改看那一面的反光層。
 * CD 光碟（T-810）的背面是資料面、不放圖：清單一直是正面（不換面，main 照樣把卡片翻過去）；
 * 翻到背面時一樣取消圖層選取——看不到的正面圖層不能被預覽區的方向鍵移動（T-810b，同 Home／F 的規則）。
 */
export function selectFace(s: EditorState, face: FaceSide): EditorState {
  if (isDisc(s.history.present)) return face === 'back' && s.selectedLayerId !== null ? { ...s, selectedLayerId: null } : s;
  if (face === s.face) return s;
  return { ...s, face, selectedLayerId: null };
}

/**
 * 卡片轉到 face 了（main 每次轉卡都呼叫；T-810b）：光碟記下來，給左欄分頁畫選中的樣子。
 * 一般卡的分頁看編輯的那一面（face），不用記，原樣回傳。
 */
export function turnedTo(s: EditorState, face: FaceSide): EditorState {
  return s.viewFace === face || !isDisc(s.history.present) ? s : { ...s, viewFace: face };
}

/** 給人看的那一面（左欄〔正面｜背面〕分頁選中的那面）：一般卡＝編輯的那一面，CD 光碟＝viewFace（T-828j：換語言前記下來）。 */
export function shownFace(s: EditorState): FaceSide {
  return isDisc(s.history.present) ? s.viewFace : s.face;
}

/** 換語言回來還原到那一面（T-828j）：同點〔正面〕〔背面〕（換面、取消選中），光碟記下翻到那一面。卡片不變。 */
export function showSide(s: EditorState, face: FaceSide): EditorState {
  return turnedTo(selectFace(s, face), face);
}

/**
 * 預覽區鍵盤 Home／F（DESIGN §8.2：等同點〔正面〕〔背面〕，左欄跟著換面、取消選中；T-607c）：
 * 換到那一面，並且一定取消選中（圖層與反光層）——已經在那一面也一樣，不靠「換面」順便清掉。卡片不變。
 */
export function showFace(s: EditorState, face: FaceSide): EditorState {
  const next = selectFace(s, face);
  if (next.selectedLayerId === null && !next.foilSelected) return next;
  return { ...next, selectedLayerId: null, foilSelected: false };
}

/** 選中某層：切到它所在的那一面（反光層不再選著）；找不到或 null＝取消選取（反光層也一起取消）。 */
export function selectLayer(s: EditorState, layerId: string | null): EditorState {
  if (layerId === null) return { ...s, selectedLayerId: null, foilSelected: false };
  const face = faceOf(s.history.present, layerId);
  if (!face) return { ...s, selectedLayerId: null, foilSelected: false };
  return { ...s, face, selectedLayerId: layerId, foilSelected: false };
}

/** 選這一面的反光層（左欄最上面那一列，T-417）：圖層不再選中。 */
export function selectFoil(s: EditorState): EditorState {
  return s.foilSelected && s.selectedLayerId === null ? s : { ...s, selectedLayerId: null, foilSelected: true };
}

// ---- 圖層 ----

export function deleteLayer(s: EditorState, layerId: string, now: string): EditorState {
  const face = faceOf(s.history.present, layerId);
  if (!face) return s;
  return act(s, now, (c) => removeLayer(c, face, layerId));
}

export function swapLayers(s: EditorState, layerIdA: string, layerIdB: string, now: string): EditorState {
  const face = faceOf(s.history.present, layerIdA);
  if (!face) return s;
  return act(s, now, (c) => swapDepth(c, face, layerIdA, layerIdB));
}

export function editLayer(s: EditorState, layerId: string, patch: LayerPatch, phase: EditPhase, now: string): EditorState {
  const face = faceOf(s.history.present, layerId);
  if (!face) return s;
  return drag(s, `layer:${layerId}:${patchKey(patch)}`, phase, now, (c) => updateLayer(c, face, layerId, patch));
}

export function centerLayerEdit(s: EditorState, layerId: string, now: string): EditorState {
  const face = faceOf(s.history.present, layerId);
  if (!face) return s;
  return act(s, now, (c) => centerLayer(c, face, layerId));
}

/** 「填滿」時立體層四邊多放大的量：2 × depth/100 × MAX_PARALLAX（卡寬單位），轉到任何角度都不露出圖邊；底圖 0。 */
export function fillBleed(layer: Layer): number {
  return layer.role === 'base' ? 0 : 2 * (layer.depth / 100) * MAX_PARALLAX;
}

/** 填滿：size＝圖片像素寬高（登記簿查不到就不變）。 */
export function fillLayerEdit(
  s: EditorState,
  layerId: string,
  size: { width: number; height: number } | undefined,
  now: string,
): EditorState {
  const face = faceOf(s.history.present, layerId);
  if (!face || !size) return s;
  return act(s, now, (c) => {
    const layer = c[face].layers.find((l) => l.id === layerId);
    return layer ? fillLayer(c, face, layerId, size.width, size.height, fillBleed(layer)) : c;
  });
}

// ---- 上傳 ----

/**
 * 上傳處理好的一張圖加到 face：成功就記一步並選中新圖層（切到那一面）；
 * 不透明圖而且已有底圖 → 記下待確認（卡片不變）；這一面滿了 → problem 'face-full'；
 * 輸入不合格（id 重複、雜湊格式不對，正常不會發生）→ problem 'invalid-input'；
 * 這張卡的圖已經 16 張（反光層的黑白圖也算，T-417）→ problem 'too-many-images'。
 * 同時有好幾張待確認時只留最後一張。
 */
export function addUploadedLayer(
  s: EditorState,
  face: FaceSide,
  input: NewLayerInput,
  fileName: string,
  now: string,
): { state: EditorState; problem: 'face-full' | 'invalid-input' | 'too-many-images' | null } {
  const h = commitPending(s.history, now);
  const result = addLayer(h.present, face, input);
  if (result.ok) {
    const state = { ...s, history: apply(h, stamp(result.card, now)), face, selectedLayerId: result.layerId, foilSelected: false, previewKey: null };
    return { state, problem: null };
  }
  const base = { ...s, history: h, previewKey: null };
  if (result.reason === 'needs-replace-base') return { state: { ...base, pending: { face, input, fileName } }, problem: null };
  return { state: fixSelection(base), problem: result.reason };
}

/**
 * 上傳了沒有透明的圖（T-703，DESIGN §4）：不管有沒有底圖都先問（當底圖／取代底圖、自動去背、拆成立體層、當發光層／加深層），
 * 卡片不變（只把進行中的拖曳記起來）。這一面已經 8 層、又沒有底圖可以換 → face-full（問了也加不進去）。
 * 同時有好幾張待確認時只留最後一張。
 */
export function askOpaqueUpload(
  s: EditorState,
  face: FaceSide,
  input: NewLayerInput,
  fileName: string,
  now: string,
): { state: EditorState; problem: 'face-full' | null } {
  const h = commitPending(s.history, now);
  const base = { ...s, history: h, previewKey: null };
  const layers = h.present[face].layers;
  if (!layers.some((l) => l.role === 'base') && layers.length >= MAX_LAYERS_PER_FACE) return { state: fixSelection(base), problem: 'face-full' };
  return { state: { ...base, pending: { face, input, fileName } }, problem: null };
}

/** 確認框按了 AI 的按鈕（T-703）：收起確認框、交出那張圖（卡片不變、不記步）。沒有待確認的圖＝pending null。 */
export function takePending(s: EditorState): { state: EditorState; pending: PendingBase | null } {
  return s.pending ? { state: { ...s, pending: null }, pending: s.pending } : { state: s, pending: null };
}

/**
 * AI 去背前先看放不放得下（T-703，DESIGN §3.1「先說」）：這一面已經 8 層 → face-full；
 * 這張卡的圖已經 16 張（反光層的黑白圖也算）→ too-many-images；放得下 → null。
 */
export function cutoutRoom(card: Card, face: FaceSide): 'face-full' | 'too-many-images' | null {
  if (card[face].layers.length >= MAX_LAYERS_PER_FACE) return 'face-full';
  if (cardImages(card).length >= MAX_CARD_IMAGES) return 'too-many-images';
  return null;
}

/**
 * 這張沒有透明的圖當 face 的底圖（T-703「找不到主角」的〔當底圖〕）：已有底圖就取代、沒有就放到最後面（陣列第 0 個）；
 * 選中它、切到那一面、記一步。加不進去（這一面 8 層又沒有底圖、或圖超過 16 張）→ problem、卡不變。
 */
export function placeBase(
  s: EditorState,
  face: FaceSide,
  input: NewLayerInput,
  now: string,
): { state: EditorState; problem: 'face-full' | 'too-many-images' | null } {
  const h = commitPending(s.history, now);
  const next = replaceBase(h.present, face, input);
  if (next === h.present) {
    const layers = h.present[face].layers;
    const full = !layers.some((l) => l.role === 'base') && layers.length >= MAX_LAYERS_PER_FACE;
    return { state: fixSelection({ ...s, history: h, previewKey: null }), problem: full ? 'face-full' : 'too-many-images' };
  }
  const state = { ...s, history: apply(h, stamp(next, now)), face, selectedLayerId: input.id, foilSelected: false, previewKey: null };
  return { state, problem: null };
}

// ---- 拆成立體層（T-704，DESIGN §3.1）：背景段當底圖（已有就取代）、其他段當立體層；整件事一步 ----

/** 拆出來的一段（由遠到近）：走過 encode 的圖＋建議深度（第 0 段是背景、0）。 */
export interface SplitPart extends NewLayerInput {
  depth: number;
}

/**
 * 拆成 need 段放不放得下（每面 8 層、每張卡 16 張圖）：底圖那一格會被取代，所以算空間；
 * 舊底圖的圖會換掉，不算在 16 張裡。放得下回 null。
 */
export function splitRoom(card: Card, face: FaceSide, need: number): SplitRoomProblem | null {
  const layers = card[face].layers;
  const others = layers.filter((l) => l.role !== 'base');
  const layerSpace = MAX_LAYERS_PER_FACE - others.length;
  if (layerSpace < need) return { kind: 'layers', space: Math.max(0, layerSpace), need };
  const withoutBase: Card = { ...card, [face]: { ...card[face], layers: others } };
  const imageSpace = MAX_CARD_IMAGES - cardImages(withoutBase).length;
  if (imageSpace < need) return { kind: 'images', space: Math.max(0, imageSpace), need };
  return null;
}

/**
 * 把拆好的段加進這張卡（卡片層的純函式：開著的卡和存檔裡的卡共用）：第 0 段當 face 的底圖（已有就取代、照預設擺法填滿），
 * 其他段當立體層：深度用建議值、位置與大小和新底圖一樣（同一張圖拆的，才會對齊）。不碰 updatedAt。
 * 放不下 → problem（卡不變）；輸入不合格（id 重複、背景段有透明之類，正常不會發生）→ 'invalid-input'。
 */
export function splitIntoCard(card: Card, face: FaceSide, parts: readonly SplitPart[]): { card: Card } | { problem: SplitRoomProblem | 'invalid-input' } {
  const room = splitRoom(card, face, parts.length);
  if (room) return { problem: room };
  const [background, ...rest] = parts;
  if (!background) return { problem: 'invalid-input' };
  let next = replaceBase(card, face, background);
  const base = next[face].layers.find((l) => l.id === background.id);
  if (!base || base.role !== 'base') return { problem: 'invalid-input' };
  for (const part of rest) {
    const { depth, ...input } = part;
    const added = addLayer(next, face, input);
    if (!added.ok) return { problem: 'invalid-input' };
    next = updateLayer(added.card, face, part.id, { depth, x: base.x, y: base.y, scale: base.scale });
  }
  return { card: next };
}

/**
 * 拆成立體層的結果加進開著的卡（T-704）：整件事記一步（一次復原全部還原，含被取代的舊底圖）；
 * 切到那一面、不選中（每一層都和整張卡一樣大，選取框會框住整張卡）。放不下 → problem、卡不變。
 */
export function addSplitLayers(
  s: EditorState,
  face: FaceSide,
  parts: readonly SplitPart[],
  now: string,
): { state: EditorState; problem: SplitRoomProblem | 'invalid-input' | null } {
  const h = commitPending(s.history, now);
  const result = splitIntoCard(h.present, face, parts);
  if ('problem' in result) return { state: fixSelection({ ...s, history: h, previewKey: null }), problem: result.problem };
  const state = { ...s, history: apply(h, stamp(result.card, now)), face, selectedLayerId: null, foilSelected: false, previewKey: null };
  return { state, problem: null };
}

// ---- 右欄〔自動去背〕（T-703b，DESIGN §3.1）：去背好的圖換上這一層（同一個 id、其他設定不變）----

/** 換不上去的原因：layer-gone＝那一層不在了或圖已經被換掉；too-many-images＝換了會超過每張卡 16 張圖。 */
export type ReplaceProblem = 'layer-gone' | 'too-many-images' | 'invalid-input';

/** 換掉這一層本來的圖之後還會用到的圖：其他層、反光層，加上這一層的變身圖（T-805：換圖只換本來的圖，變身圖還在）。 */
function imagesBesidesLayerImage(card: Card, face: FaceSide, layerId: string): string[] {
  const alt = card[face].layers.find((l) => l.id === layerId)?.alt;
  const rest = cardImages(removeLayer(card, face, layerId));
  return alt && !rest.includes(alt.image) ? [...rest, alt.image] : rest;
}

/**
 * 開始前先看換不換得上（新圖的雜湊還不知道，當作新的一張）：換掉不是新增——舊圖只有這一層在用就放得下；
 * 舊圖還有別的層或反光層在用、這張卡又已經 16 張圖 → too-many-images（這一層的變身圖也算，T-805）。
 */
export function replaceRoom(card: Card, face: FaceSide, layerId: string): 'too-many-images' | null {
  return imagesBesidesLayerImage(card, face, layerId).length >= MAX_CARD_IMAGES ? 'too-many-images' : null;
}

/**
 * 把去背好的圖換上 face 的 layerId（卡片層的純函式：開著的卡和存檔裡的卡共用）。不碰 updatedAt。
 * 那一層不在了、或圖已經不是開始時那張（oldImage；被換掉了）→ layer-gone（不蓋掉後來的改動）；
 * 換了會超過每張卡 16 張圖 → too-many-images；其他換不上（不是立體層、雜湊不合格，正常不會發生）→ invalid-input。
 */
export function replaceCutoutInCard(
  card: Card,
  face: FaceSide,
  layerId: string,
  oldImage: string,
  image: { image: string; hasAlpha: boolean },
): { card: Card } | { problem: ReplaceProblem } {
  const layer = card[face].layers.find((l) => l.id === layerId);
  if (!layer || layer.image !== oldImage) return { problem: 'layer-gone' };
  const others = imagesBesidesLayerImage(card, face, layerId);
  if (!others.includes(image.image) && others.length >= MAX_CARD_IMAGES) return { problem: 'too-many-images' };
  const next = replaceLayerImage(card, face, layerId, image);
  return next === card ? { problem: 'invalid-input' } : { card: next };
}

/**
 * 去背好的圖換上開著那張卡的這一層：記一步（復原＝回舊圖）。選取與正在看的那一面都不動
 * （原本選著這一層就還是選著；途中改選別層、換到另一面也不搶）。換不上 → problem、卡不變、不記步。
 */
export function replaceLayerImageEdit(
  s: EditorState,
  face: FaceSide,
  layerId: string,
  oldImage: string,
  image: { image: string; hasAlpha: boolean },
  now: string,
): { state: EditorState; problem: ReplaceProblem | null } {
  const h = commitPending(s.history, now);
  const result = replaceCutoutInCard(h.present, face, layerId, oldImage, image);
  if ('problem' in result) return { state: fixSelection({ ...s, history: h, previewKey: null }), problem: result.problem };
  return { state: fixSelection({ ...s, history: apply(h, stamp(result.card, now)), previewKey: null }), problem: null };
}

/** 取代底圖確認框的回答：取代 → 新底圖、選中它、切到那一面；保留 → 只關掉確認框。 */
export function answerReplaceBase(s: EditorState, replace: boolean, now: string): EditorState {
  const p = s.pending;
  if (!p) return s;
  const cleared: EditorState = { ...s, pending: null };
  if (!replace) return cleared;
  const next = act({ ...cleared, face: p.face }, now, (c) => replaceBase(c, p.face, p.input));
  return selectLayer(next, p.input.id);
}

/**
 * 確認框的〔當發光層（黑色變透明）〕〔當加深層（白色變透明）〕（T-408，SCHEMA §1.3）：
 * 待確認的那張不透明圖加成立體層、設好混合模式（depth 照一般立體層）。成功＝記一步、選中它、切到那一面；
 * 這一面滿了 → face-full。不管成不成功確認框都關掉。沒有待確認的圖 → 不做事。
 */
export function answerOpaqueLayer(
  s: EditorState,
  blend: OpaqueUploadBlend,
  now: string,
): { state: EditorState; problem: 'face-full' | 'invalid-input' | 'too-many-images' | null } {
  const p = s.pending;
  if (!p) return { state: s, problem: null };
  const h = commitPending(s.history, now);
  const result = addLayer(h.present, p.face, { ...p.input, blend });
  const cleared: EditorState = { ...s, history: h, pending: null, previewKey: null };
  if (!result.ok) {
    const problem = result.reason === 'face-full' || result.reason === 'too-many-images' ? result.reason : 'invalid-input';
    return { state: fixSelection(cleared), problem };
  }
  const state = { ...cleared, history: apply(h, stamp(result.card, now)), face: p.face, selectedLayerId: result.layerId, foilSelected: false };
  return { state, problem: null };
}

// ---- 文字圖層（圖由 main 依設定畫好、走過 ingest、進了登記簿才呼叫） ----

/** 加文字圖層：成功就記一步並選中新圖層（切到那一面）；這一面滿了 → face-full；輸入不合格 → invalid-input。 */
export function addTextLayerEdit(
  s: EditorState,
  face: FaceSide,
  input: NewTextLayerInput,
  now: string,
): { state: EditorState; problem: 'face-full' | 'invalid-input' | 'too-many-images' | null } {
  const h = commitPending(s.history, now);
  const result = addTextLayer(h.present, face, input);
  if (result.ok) {
    const state = { ...s, history: apply(h, stamp(result.card, now)), face, selectedLayerId: result.layerId, foilSelected: false, previewKey: null };
    return { state, problem: null };
  }
  return {
    state: fixSelection({ ...s, history: h, previewKey: null }),
    problem: result.reason === 'face-full' || result.reason === 'too-many-images' ? result.reason : 'invalid-input',
  };
}

/** 改文字圖層後重畫好的圖與完整設定。 */
export interface DrawnText {
  text: TextSpec;
  image: string;
  width: number;
  height: number;
}

/**
 * 改文字圖層：patch＝這次改了哪些設定（用來分辨是不是同一個拖曳，例如拖自選顏色）；drawn＝整理好的完整設定與新圖。
 * commit 記一步（打字停手一次＝一步）；preview 只換畫面，放開 commit 才記一步。
 */
export function editTextLayer(
  s: EditorState,
  layerId: string,
  patch: Partial<TextSpec>,
  drawn: DrawnText,
  phase: EditPhase,
  now: string,
): EditorState {
  const face = faceOf(s.history.present, layerId);
  if (!face) return s;
  return drag(s, `text:${layerId}:${patchKey(patch)}`, phase, now, (c) => updateTextLayer(c, face, layerId, drawn));
}

// ---- 雙圖光柵的變身圖（T-805，DESIGN「雙圖光柵」）----

/**
 * 變身圖加不上去的原因：layer-gone＝那一層不在了或不能有變身圖（底圖、文字層、衝出卡片）；
 * needs-alpha＝圖沒有透明背景、這層的混合模式只能給有透明的圖用；too-many-images＝會超過每張卡 16 張圖。
 */
export type AltProblem = 'layer-gone' | 'needs-alpha' | 'too-many-images';

/**
 * 加上或換一張變身圖（圖由 main 走過 ingest、進了登記簿才呼叫）／拿掉（null）：一步（復原＝回到上一張或沒有）。
 * 選取與正在看的那一面都不動。和現在一樣 → 不記步、沒有問題。加不上去 → problem、卡不變、不記步。
 */
export function setLayerAlt(s: EditorState, layerId: string, alt: LayerAlt | null, now: string): { state: EditorState; problem: AltProblem | null } {
  const face = faceOf(s.history.present, layerId);
  if (!face) return { state: s, problem: 'layer-gone' };
  const state = act(s, now, (c) => updateLayer(c, face, layerId, { alt }));
  const layer = state.history.present[face].layers.find((l) => l.id === layerId);
  if (alt === null || (layer?.alt?.image === alt.image && layer.alt.hasAlpha === alt.hasAlpha)) return { state, problem: null };
  if (!layer || altBlocked(layer) !== null) return { state, problem: 'layer-gone' };
  if (!blendAllowed({ role: layer.role, hasAlpha: layer.hasAlpha, alt }, layerBlend(layer))) return { state, problem: 'needs-alpha' };
  return { state, problem: 'too-many-images' };
}

// ---- 反光層（T-417，SCHEMA §1「反光層」）----

/** 改這一面的反光層（形狀、卡框也反光）：一步。霧光是卡片設定（兩面共用），用 editCard({ holo: { matte } })。 */
export function editFoil(s: EditorState, face: FaceSide, patch: FoilPatch, now: string): EditorState {
  return act(s, now, (c) => updateFoil(c, face, patch));
}

/**
 * 換上黑白圖並切到「上傳黑白圖」（圖由 main 走過 ingest、進了登記簿才呼叫）：一步。
 * 會超過每張卡 16 張圖 → problem 'too-many-images'、卡不變。
 */
export function setFoilMask(
  s: EditorState,
  face: FaceSide,
  mask: string,
  now: string,
): { state: EditorState; problem: 'too-many-images' | null } {
  const state = act(s, now, (c) => updateFoil(c, face, { shape: 'mask', mask }));
  const foil = faceFoil(state.history.present[face]);
  return { state, problem: foil.shape === 'mask' && foil.mask === mask ? null : 'too-many-images' };
}

// ---- 舞台背景圖（T-814，SCHEMA view.backdrop?）----

/**
 * 加上或換一張背景圖（圖由 main 走過 ingest、進了登記簿才呼叫）／拿掉（null）：一步（復原＝回到上一張或沒有）。
 * 選取與正在看的那一面都不動。和現在一樣 → 不記步、沒有問題。會超過每張卡 16 張圖 → problem 'too-many-images'、卡不變、不記步。
 */
export function setBackdropEdit(s: EditorState, image: string | null, now: string): { state: EditorState; problem: 'too-many-images' | null } {
  const state = act(s, now, (c) => setBackdrop(c, image));
  const shown = state.history.present.view.backdrop;
  return { state, problem: image === null || shown === image ? null : 'too-many-images' };
}

/**
 * 前景圖（T-830，SCHEMA view.foreground?）：加上、換一張（位置、大小、模糊照舊）／拿掉（null），各一步；規則同 setBackdropEdit
 * （和現在一樣不記步；會超過每張卡 16 張圖 → problem 'too-many-images'、卡不變、不記步）。
 */
export function setForegroundEdit(s: EditorState, image: string | null, now: string): { state: EditorState; problem: 'too-many-images' | null } {
  const state = act(s, now, (c) => setForeground(c, image));
  const shown = state.history.present.view.foreground?.image;
  return { state, problem: image === null || shown === image ? null : 'too-many-images' };
}

// ---- 卡片 ----

export function editCard(s: EditorState, patch: CardPatch, phase: EditPhase, now: string): EditorState {
  return drag(s, `card:${patchKey(patch)}`, phase, now, (c) => updateCard(c, patch));
}

/**
 * 一鍵卡片風格（T-801）：把一組鐳射與卡框設定一次換上去（model/styles.ts），整組記一步（Ctrl+Z 一次整組還原）；
 * 提示列說「套用了「銀箔」風格，可以再微調。」。已經是這個風格就不多記一步（提示照樣顯示）。
 */
export function applyStyleEdit(s: EditorState, style: CardStyle, now: string): EditorState {
  const next = act(s, now, (c) => applyCardStyle(c, style));
  return { ...next, message: { kind: 'info', text: styleAppliedText(style) } };
}

/** 開發用（__holo.setCard／setLayer）：直接換成這張卡，算一步。 */
export function replaceCard(s: EditorState, card: Card): EditorState {
  return act(s, card.updatedAt, () => card);
}

// ---- 訊息 ----

export function setMessage(s: EditorState, message: UiMessage | null): EditorState {
  return { ...s, message };
}

export function dismissMessage(s: EditorState): EditorState {
  return s.message === null ? s : { ...s, message: null };
}

// ---- 給畫面的狀態 ----

export function toUiState(
  s: EditorState,
  imageUrl: (hash: string) => string | undefined,
  text: Pick<UiState, 'loadedFonts' | 'textContentBox'> = {},
): UiState {
  return {
    ...text,
    card: s.history.present,
    face: s.face,
    viewFace: s.viewFace,
    selectedLayerId: s.selectedLayerId,
    foilSelected: s.foilSelected,
    canUndo: canUndo(s.history),
    canRedo: canRedo(s.history),
    message: s.message,
    pendingReplaceBase: s.pending
      ? { fileName: s.pending.fileName, hasBase: s.history.present[s.pending.face].layers.some((l) => l.role === 'base') }
      : null,
    imageUrl,
  };
}
