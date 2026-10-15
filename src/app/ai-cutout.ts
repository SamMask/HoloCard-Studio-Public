// AI 自動去背（T-703）與拆成立體層（T-704）接進工坊（DESIGN §3.1、§4）：上傳確認框按〔自動去背〕〔拆成立體層〕之後的流程。
// - 開始前：空間不夠（每面 8 層、每張卡 16 張圖）→ 先說、不做；那個模型不在 → 說怎麼下載；
//   沒有圖形加速（沒有 WebGPU）→ 先問（這次開著工坊只問一次）。
// - 進行中：預覽區下方小面板（那個模型第一次用「正在載入 AI 模型」照下載比例，接著「正在去背…」／「正在拆成立體層…」）、
//   〔取消〕／Esc；可以繼續編輯。一次只做一件 AI 工作（去背和拆層共用）。
// - 去背做完：去背的圖走 encode（ingest 的 WebP、雜湊）→ 加成立體層。找不到主角（coverage < 0.005）或整張都被當成主角
//   → 開著那張卡就問〔當底圖〕〔取消〕。
// - 拆層做完：每一段走 encode → 交給組裝端一次加進去（背景段當底圖、其他段當立體層，整件事一步）。
//   只拆出 1 段或前面的段沒有透明＝分不出遠近 → 開著那張卡就問〔當底圖〕〔取消〕。
// - 右欄〔自動去背〕（T-703b，source.replaceLayerId）：同一套流程，做完交給組裝端的 replace 換掉那一層的圖（不加新層）；
//   找不到主角、整張都是主角 → 只說「沒有改」（這一層已經在卡上了，不問〔當底圖〕）；換好了說「去背好了。」；
//   那一層被刪了或圖已經被換掉 → 不用（組裝端回 layer-gone）。
// - 加到開始時那張卡那一面：開著＝記一步；換了卡＝存檔裡的那張；被刪了＝不加。
// - 錯誤：依 AiError.code 顯示白話（ui/logic 的 aiErrorText），英文原因只寫 console。
// - 被別的分頁接手（stop，T-703c）：用「停止代次」讓之前在等的非同步結果全部作廢；已經在加進卡片的那一件做完才交出（settled）。
// 這個模組不碰 DOM：runner、解碼／編碼、加進卡片、畫面更新都由組裝端（main）注入，所以能在 node 用假的 runner 測。

import type { AiModel, AiRunner, RgbaImage } from '../ai/types';
import type { StoredImage } from '../images/types';
import type { FaceSide } from '../model/types';
import {
  AI_CARD_GONE_TEXT,
  AI_FAILED_TEXT,
  AI_MODEL_MISSING_TEXT,
  AI_NO_DEPTH_GONE_TEXT,
  AI_NO_SUBJECT_GONE_TEXT,
  AI_REPLACE_CARD_GONE_TEXT,
  AI_REPLACE_LAYER_GONE_TEXT,
  AI_REPLACE_NO_BACKGROUND_TEXT,
  AI_REPLACE_NO_SUBJECT_TEXT,
  AI_REPLACED_TEXT,
  AI_SPLIT_CARD_GONE_TEXT,
  aiErrorText,
  aiReplacedStoredText,
  aiSplitStoredText,
  aiStoredText,
  problemText,
} from '../ui/logic';
import type { AiAsk, AiProgressView, AiView, UiMessage } from '../ui/types';

/** 修好的遮罩平均值低於這個＝找不到主角（src/ai/types.ts removeBackground 的契約）。 */
export const MIN_COVERAGE = 0.005;
/** 拆成幾段（遠、中、近）。 */
export const SPLIT_BANDS = 3;
/** 邊緣柔化：長邊的 0.2%（2048 的圖約 4px），至少 1px（RefineOptions.feather 的建議值）。 */
const FEATHER_RATIO = 0.002;
/** 推論大約幾秒：進度條在這段時間慢慢走（有圖形加速實測去背約 2.3 秒、拆層約 1.5 秒；沒有約一分多鐘）。 */
const FAST_SEC = 3;
const SLOW_SEC = 70;
/** 載入模型時，下載只算進度條的前 9 成：下載完還要幾秒建好模型（實測約 3.6 秒），不要卡在 99%。 */
const DOWNLOAD_SHARE = 0.9;

export function cutoutFeather(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) * FEATHER_RATIO));
}

/** 哪一種 AI 工作：去背（T-703）或拆成立體層（T-704）。 */
export type AiJobKind = 'cutout' | 'split';

const MODEL_OF: Record<AiJobKind, AiModel> = { cutout: 'matte', split: 'depth' };

/** 要處理的那張圖與結果要加到哪。 */
export interface CutoutSource {
  /** 開始時那張卡與那一面（做完加到這裡；換了卡就加到存檔裡的那張；被刪了就不加）。 */
  cardId: string;
  face: FaceSide;
  /** 上傳的原圖（已經走過 ingest：最長邊 2048、WebP、雜湊）。 */
  image: StoredImage;
  /** 圖層名（＝檔名去掉副檔名）。 */
  name: string;
  fileName: string;
  /**
   * 右欄〔自動去背〕（T-703b）：去背好的圖換掉 face 的這一層（image＝這一層開始時的圖，做完時圖已經不是它就不換）。
   * 沒給＝上傳的〔自動去背〕（加成新的立體層）。
   */
  replaceLayerId?: string;
}

/** 拆好的一段（由遠到近）：encode 過的圖＋建議深度（第 0 段背景＝0）。 */
export interface SplitResultPart {
  image: StoredImage;
  depth: number;
}

/**
 * 加進卡片的結果：added＝開著的那張（記一步）；stored＝存檔裡的那張（已經換卡了）；missing＝那張被刪了；
 * layer-gone＝右欄〔自動去背〕要換的那一層被刪了、或圖已經被換掉（T-703b）；
 * 其他＝放不下（做的途中又加滿了）：去背給原因代碼、拆層給整句白話（no-room）。
 */
export type CutoutAdded =
  | { result: 'added' }
  | { result: 'stored'; cardName: string }
  | { result: 'missing' }
  | { result: 'layer-gone' }
  | { result: 'face-full' | 'too-many-images' | 'invalid-input' }
  | { result: 'no-room'; text: string };

export interface CutoutDeps {
  runner: Pick<AiRunner, 'available' | 'hasFastBackend' | 'removeBackground' | 'splitLayers'>;
  /** 原圖 → RGBA（直通 alpha）。 */
  decode(image: StoredImage): Promise<RgbaImage>;
  /** AI 做好的 RGBA → 可存的圖（ingest 的 storeCanvas：偵測透明、WebP、雜湊）。 */
  encode(image: RgbaImage): Promise<StoredImage>;
  /** 開始前看開著的那張卡放不放得下：放不下回要說的白話，放得下回 null。 */
  room(source: CutoutSource, kind: AiJobKind): string | null;
  /** 去背：加成立體層（名字＝source.name、深度照自動排）。 */
  add(source: CutoutSource, image: StoredImage): Promise<CutoutAdded>;
  /** 拆層：背景段當底圖（已有就取代）、其他段當立體層（建議深度、名字「檔名・遠／中／近」），整件事一步。 */
  addSplit(source: CutoutSource, parts: SplitResultPart[]): Promise<CutoutAdded>;
  /**
   * 右欄〔自動去背〕（T-703b，source.replaceLayerId 有給）：去背好的圖換掉那一層的圖（同一個 id、其他設定不變、記一步）；
   * 那一層被刪了或圖已經不是 source.image → layer-gone。換卡、卡被刪的規則同 add。
   */
  replace(source: CutoutSource, image: StoredImage): Promise<CutoutAdded>;
  /** 「找不到主角」「分不出遠近」的〔當底圖〕：原圖當那一面的底圖（開著那張卡才會問）。 */
  useAsBase(source: CutoutSource): void;
  /** 這張卡是不是開著的那張。 */
  isOpen(cardId: string): boolean;
  /** 白話訊息（提示列）。 */
  message(message: UiMessage): void;
  /** AI 的畫面狀態變了（重畫）。 */
  changed(): void;
}

export interface Cutout {
  /** 給畫面的狀態。 */
  view(): AiView;
  /** 查兩個模型在不在（上傳沒有透明的圖、顯示確認框之前）：在了就記住，不在每次都再查。 */
  checkModels(): Promise<Record<AiModel, boolean>>;
  /**
   * 〔自動去背〕（kind 省略；source.replaceLayerId 有給＝右欄的，換掉那一層的圖）／〔拆成立體層〕：放不下先說；沒有圖形加速先問；
   * 不然直接開始。正在做別的 AI 工作時不做事。
   */
  start(source: CutoutSource, kind?: AiJobKind): Promise<void>;
  /** 問題的回答：〔繼續〕／〔當底圖〕＝true、〔取消〕＝false。 */
  answer(yes: boolean): void;
  /** 〔取消〕／Esc：停掉進行中的（面板馬上收起、圖不加進來）。已經在加進卡片的那一刻就不停了。 */
  cancel(): void;
  /**
   * 被別的分頁接手（T-703c）：進行中的停掉、問題收掉；之前在等的非同步結果（查模型、查圖形加速、解碼、推論、編碼）全部作廢。
   * 已經在加進卡片的那一件停不了：用 settled 等它做完再交出編輯權。
   */
  stop(): void;
  /** 已經在加進卡片（不能取消）的工作都做完了（交接前等它，T-703c）。 */
  settled(): Promise<void>;
  /** 換卡了：問「要不要當底圖」的問題是別張卡的就收掉（不然會加錯卡）。 */
  cardOpened(cardId: string): void;
  /** 等進行中的做完（測試用）。 */
  idle(): Promise<void>;
}

interface Job {
  kind: AiJobKind;
  source: CutoutSource;
  controller: AbortController;
  progress: AiProgressView;
  /** 已經在加進卡片：取消不了了。 */
  committed: boolean;
}

interface Question {
  kind: AiAsk['kind'];
  source: CutoutSource;
  /** 'slow' 問完要做哪一種。 */
  job: AiJobKind;
}

const isAbort = (err: unknown) => typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
const isModelMissing = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AiError' && (err as { code?: unknown }).code === 'model-missing';

/** 結果還沒到、或已經取消。 */
class Stopped extends Error {}

export function createCutout(deps: CutoutDeps): Cutout {
  const { runner } = deps;
  const ready: Record<AiModel, boolean | null> = { matte: null, depth: null };
  /** 有沒有圖形加速（查一次就記住）。 */
  let fast: boolean | null = null;
  /** 沒有圖形加速時，這次開著工坊已經按過〔繼續〕。 */
  let slowOk = false;
  /** 模型已經載入過（第二次不再說「正在載入 AI 模型」）；兩個模型分開記。 */
  const warm: Record<AiModel, boolean> = { matte: false, depth: false };
  /** 正在查、正在開始（還沒有 job）：避免連按兩次開兩件。 */
  let starting = false;
  let job: Job | null = null;
  let question: Question | null = null;
  let work: Promise<void> = Promise.resolve();
  /** 停止代次（T-703c）：stop 一次加 1；開始時記下來，之後每個 await 回來代次變了就作廢。 */
  let epoch = 0;
  /** 已經在加進卡片的工作（不能取消；交接前要等它）。 */
  let committedWork: Promise<void> = Promise.resolve();

  const track = (p: Promise<void>) => {
    work = Promise.all([work, p]).then(() => {});
    return p;
  };

  const checkOne = async (model: AiModel): Promise<boolean> => {
    if (ready[model]) return true;
    const ok = await runner.available(model).catch(() => false);
    if (ready[model] !== ok) {
      ready[model] = ok;
      deps.changed();
    }
    return ok;
  };

  const ask = (kind: Question['kind'], source: CutoutSource, jobKind: AiJobKind) => {
    question = { kind, source, job: jobKind };
    deps.changed();
  };

  /** 做不成立體層：開著那張卡就問要不要當底圖；已經換卡了只說一聲（當底圖會加錯卡）。 */
  const cannotUse = (kind: 'no-subject' | 'no-background' | 'no-depth', source: CutoutSource, jobKind: AiJobKind) => {
    if (deps.isOpen(source.cardId)) ask(kind, source, jobKind);
    else deps.message({ kind: 'info', text: kind === 'no-depth' ? AI_NO_DEPTH_GONE_TEXT : AI_NO_SUBJECT_GONE_TEXT });
  };

  /** replacing＝右欄〔自動去背〕換掉那一層（T-703b）：換好了也說一聲（沒有新層被選中，看不出來）。 */
  const report = (added: CutoutAdded, kind: AiJobKind, replacing = false) => {
    switch (added.result) {
      case 'added':
        if (replacing) deps.message({ kind: 'info', text: AI_REPLACED_TEXT });
        return;
      case 'stored':
        deps.message({
          kind: 'info',
          text: replacing ? aiReplacedStoredText(added.cardName) : kind === 'split' ? aiSplitStoredText(added.cardName) : aiStoredText(added.cardName),
        });
        return;
      case 'missing':
        deps.message({ kind: 'info', text: replacing ? AI_REPLACE_CARD_GONE_TEXT : kind === 'split' ? AI_SPLIT_CARD_GONE_TEXT : AI_CARD_GONE_TEXT });
        return;
      case 'layer-gone':
        deps.message({ kind: 'info', text: AI_REPLACE_LAYER_GONE_TEXT });
        return;
      case 'no-room':
        deps.message({ kind: 'error', text: added.text });
        return;
      default:
        deps.message({ kind: 'error', text: problemText(added.result) });
    }
  };

  /** 加進卡片這一步：記下來，交接前 settled 要等它。 */
  const commit = <T,>(adding: Promise<T>): Promise<T> => {
    committedWork = Promise.all([committedWork, adding.catch(() => {})]).then(() => {});
    return adding;
  };

  const run = async (source: CutoutSource, kind: AiJobKind, runEpoch = epoch): Promise<void> => {
    if (runEpoch !== epoch) return;
    const model = MODEL_OF[kind];
    const working: AiProgressView['step'] = kind === 'split' ? 'split' : 'cut';
    const controller = new AbortController();
    const current: Job = {
      kind,
      source,
      controller,
      progress: { step: warm[model] ? working : 'load', fraction: warm[model] ? null : 0, expectSec: fast === false ? SLOW_SEC : FAST_SEC },
      committed: false,
    };
    job = current;
    deps.changed();
    const stopped = () => controller.signal.aborted || job !== current || epoch !== runEpoch;
    const check = () => {
      if (stopped()) throw new Stopped();
    };
    const setProgress = (next: AiProgressView) => {
      const p = current.progress;
      if (stopped() || (p.step === next.step && p.fraction === next.fraction)) return;
      current.progress = next;
      deps.changed();
    };
    const onProgress = (stage: 'load' | 'run' | 'post', done: number, total: number) => {
      const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
      // 第一次：載入模型照下載比例；之後（或已經在推論、後處理）不知道比例，進度條照預估時間慢慢走
      if (stage === 'load' && !warm[model]) setProgress({ ...current.progress, step: 'load', fraction: ratio * DOWNLOAD_SHARE });
      else setProgress({ ...current.progress, step: working, fraction: null });
    };
    try {
      const pixels = await deps.decode(source.image);
      check();
      if (kind === 'cutout') {
        const result = await runner.removeBackground(pixels, { feather: cutoutFeather(pixels.width, pixels.height) }, controller.signal, onProgress);
        warm[model] = true;
        check();
        // 右欄〔自動去背〕（T-703b）：這一層已經在卡上了，做不成只說「沒有改」，不問〔當底圖〕
        const replacing = source.replaceLayerId !== undefined;
        if (!(result.coverage >= MIN_COVERAGE)) {
          if (replacing) deps.message({ kind: 'info', text: AI_REPLACE_NO_SUBJECT_TEXT });
          else cannotUse('no-subject', source, kind);
          return;
        }
        const image = await deps.encode(result.image);
        check();
        // 整張都被當成主角：沒有透明就不能當立體層（只能當底圖）
        if (!image.hasAlpha) {
          if (replacing) deps.message({ kind: 'info', text: AI_REPLACE_NO_BACKGROUND_TEXT });
          else cannotUse('no-background', source, kind);
          return;
        }
        current.committed = true;
        if (replacing) report(await commit(deps.replace(source, image)), kind, true);
        else report(await commit(deps.add(source, image)), kind);
      } else {
        const { bands } = await runner.splitLayers(pixels, { bands: SPLIT_BANDS }, controller.signal, onProgress);
        warm[model] = true;
        check();
        if (bands.length < 2) return cannotUse('no-depth', source, kind);
        const parts: SplitResultPart[] = [];
        for (const band of bands) {
          parts.push({ image: await deps.encode(band.image), depth: band.depth });
          check();
        }
        // 前面的段沒有透明（整段都是同一個遠近）：當立體層會蓋住整張，等於分不出遠近
        if (parts.slice(1).some((p) => !p.image.hasAlpha)) return cannotUse('no-depth', source, kind);
        current.committed = true;
        report(await commit(deps.addSplit(source, parts)), kind);
      }
    } catch (err) {
      if (err instanceof Stopped || (isAbort(err) && !current.committed)) return;
      console.error(err);
      if (isModelMissing(err)) {
        ready[model] = false;
        deps.message({ kind: 'error', text: AI_MODEL_MISSING_TEXT });
      } else {
        deps.message({ kind: 'error', text: aiErrorText(err) ?? AI_FAILED_TEXT });
      }
    } finally {
      if (job === current) job = null;
      deps.changed();
    }
  };

  const cutout: Cutout = {
    view() {
      return {
        matteReady: ready.matte,
        depthReady: ready.depth,
        busy: job !== null || starting || question?.kind === 'slow',
        progress: job ? { ...job.progress } : null,
        ask: question ? { kind: question.kind, fileName: question.source.fileName } : null,
      };
    },

    async checkModels() {
      const [matte, depth] = await Promise.all([checkOne('matte'), checkOne('depth')]);
      return { matte, depth };
    },

    start(source, kind = 'cutout') {
      if (job || starting || question?.kind === 'slow') return Promise.resolve();
      starting = true;
      // 馬上告訴畫面在忙（查模型、查圖形加速要一下子）：右欄〔自動去背〕當下就變淡，不會看起來還能按（T-703b 審查）
      deps.changed();
      const startEpoch = epoch;
      return track(
        (async () => {
          try {
            const problem = deps.room(source, kind);
            if (problem) {
              deps.message({ kind: 'error', text: problem });
              return;
            }
            const ok = await checkOne(MODEL_OF[kind]);
            if (startEpoch !== epoch) return; // 查的途中被接手了
            if (!ok) {
              deps.message({ kind: 'error', text: AI_MODEL_MISSING_TEXT });
              return;
            }
            const isFast = fast ?? (await runner.hasFastBackend().catch(() => false));
            fast = isFast;
            if (startEpoch !== epoch) return;
            // 新的一件開始了：上一件「找不到主角」之類的問題不用再留
            question = null;
            if (!isFast && !slowOk) {
              ask('slow', source, kind);
              return;
            }
          } finally {
            starting = false;
            deps.changed();
          }
          await run(source, kind, startEpoch);
        })(),
      );
    },

    answer(yes) {
      const q = question;
      if (!q) return;
      question = null;
      deps.changed();
      if (q.kind === 'slow') {
        if (!yes) return;
        slowOk = true;
        void track(run(q.source, q.job));
      } else if (yes) {
        deps.useAsBase(q.source);
      }
    },

    cancel() {
      if (!job || job.committed) return;
      job.controller.abort();
      job = null;
      deps.changed();
    },

    stop() {
      epoch += 1;
      cutout.cancel();
      if (question) {
        question = null;
        deps.changed();
      }
    },

    settled: () => committedWork,

    cardOpened(cardId) {
      if (question && question.kind !== 'slow' && question.source.cardId !== cardId) {
        question = null;
        deps.changed();
      }
    },

    idle: () => work,
  };
  return cutout;
}
