// AI 功能（T-702～T-704）共用型別。模型推論（onnxruntime-web，在 Worker 裡）之外的前後處理都是純函式，放在 src/ai/。
// 模型與前處理的出處見 docs/refs/README.md §3.1。

/** 0～1 的單通道圖（遮罩、深度），列優先。 */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** 一般 RGBA 圖（直通 alpha，0～255），列優先。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 等比縮放＋置中補邊的資訊：原圖 (x, y) → 模型輸入 (x × scale + offsetX, y × scale + offsetY)。 */
export interface Letterbox {
  /** 模型輸入的邊長（正方形）。 */
  size: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** 原圖寬高。 */
  width: number;
  height: number;
}

// ---- 去背（IS-Net anime）----

/**
 * 去背前處理：長邊縮到 size（預設 1024）、置中、四周補黑 → NCHW Float32（RGB／255，不減平均；照模型作者的做法）。
 * 原圖的 alpha 忽略（當作不透明）。
 */
export type PrepareMatteInput = (image: RgbaImage, size?: number) => { tensor: Float32Array; box: Letterbox };

/** 去背後處理：模型輸出 size×size 的 0～1 遮罩 → 裁掉補邊、縮回原圖大小（雙線性）。 */
export type MatteToAlpha = (mask: GrayImage, box: Letterbox) => GrayImage;

export interface RefineOptions {
  /**
   * 邊緣柔化半徑（原圖像素，0＝不柔化）。**只往內柔化**：原本是 0 的地方維持 0（不把背景像素拉成半透明，避免白邊或灰邊）；
   * 細線保底：結果至少是原值的一半（髮絲、武器尖端不會被吃掉）。建議值約長邊的 0.2%（2048 的圖約 4px）。（T-702a 審查後改）
   */
  feather: number;
  /** 低於這個值當 0、高於 1−這個值當 1，去掉淡淡的雜訊（0～0.5，預設 0.04）。 */
  clip?: number;
}

/** 遮罩整理：clip 去雜訊、去掉很小的孤立碎塊（面積 < 總面積 0.05%）、邊緣柔化。 */
export type RefineAlpha = (alpha: GrayImage, options: RefineOptions) => GrayImage;

/** 把遮罩套到原圖：新 alpha＝原 alpha × 遮罩；透明處的顏色清成 0（避免之後縮圖滲色）。 */
export type ApplyAlpha = (image: RgbaImage, alpha: GrayImage) => RgbaImage;

// ---- 深度（Depth Anything V2 Small）----

/**
 * 深度前處理：短邊縮到 size（預設 518）、長邊照比例並取 14 的倍數（模型 patch 大小）→ NCHW Float32；
 * **長邊上限 1036**（超過就改成長邊＝1036、短邊照比例，都取 14 的倍數、最少 14），避免極端長寬比爆記憶體（T-702a 審查後加）；
 * 用 ImageNet 平均與標準差正規化（mean 0.485／0.456／0.406、std 0.229／0.224／0.225）。
 */
export type PrepareDepthInput = (image: RgbaImage, size?: number) => { tensor: Float32Array; width: number; height: number };

/**
 * 深度後處理：模型輸出（相對的「近」值，越大越近）→ 縮回 outWidth×outHeight，
 * 用第 2 與第 98 百分位數正規化到 0～1（1＝最近），夾在 0～1。
 */
export type DepthToImage = (raw: Float32Array, width: number, height: number, outWidth: number, outHeight: number) => GrayImage;

export interface SplitOptions {
  /** 切幾段（2～4，預設 3：遠、中、近）。 */
  bands?: number;
  /** 段與段之間的柔邊寬度（以 0～1 的深度值計，預設 0.06）。 */
  feather?: number;
}

export interface DepthBand {
  /** 這一段的圖（原圖顏色、alpha＝這一段的遮罩 × 原 alpha；第 0 段是背景，保留整張圖、alpha＝原 alpha）。 */
  image: RgbaImage;
  /** 建議的圖層深度：第 0 段 0（當底圖），其他段 1～100 的**整數**、由遠到近嚴格遞增。 */
  depth: number;
}

/**
 * 一張圖變立體：依深度圖把原圖切成幾段，由遠到近。
 * - 分界點照深度的**斷層**（T-704b：深度直方圖的谷底／多閾值 Otsu，同一個物體不被切成兩段）；
 *   找不到明顯斷層時退回分位數（每段面積差不多）；有明顯斷層但不夠要求的段數時，可以少於要求的段數（最少 2 段，例如角色和背景乾淨分開的圖就是遠／近兩層；T-704d）。
 *   深度兩端被正規化夾成剛好 0 與 1 的平台不算山峰（T-704d）。
 * - **背景段被前面段蓋住的地方要填補**（T-704b：用周圍背景擴散填補或模糊，前面段移開時不會看到同一個主體的重影）。
 * - 段的遮罩在分界處柔邊。
 * - 背景段保留整張圖，所以前面的段移開時後面不會露洞。
 * - 每一段都有「至少 0.5% 面積」才保留，太小的併進前一段。
 * - 柔邊寬度不超過相鄰分界點距離的一半。
 * - **尊重輸入圖自己的 alpha**：每段的 alpha＝段遮罩 × 原 alpha（背景段保留原 alpha），已經去背的圖也能再拆層。
 * - 分位數用直方圖算（深度已經在 0～1），大圖也要在 1 秒級完成。（以上三點 T-702a 審查後加）
 */
export type SplitByDepth = (image: RgbaImage, depth: GrayImage, options?: SplitOptions) => DepthBand[];

// ---- 推論執行器（T-702：onnxruntime-web 在 Web Worker 裡跑，模型與 wasm 都從同源讀，執行時不連外）----

export type AiModel = 'matte' | 'depth';

/** 推論進度：'load' 下載並載入模型（第一次比較久）、'run' 推論、'post' 後處理。done／total 是 0～1 的比例時 total＝1。 */
export type AiProgress = (stage: 'load' | 'run' | 'post', done: number, total: number) => void;

export interface AiRunInfo {
  /** 實際用的後端：'webgpu' 或 'wasm'（WebGPU 不能用時自動退回）。 */
  backend: 'webgpu' | 'wasm';
  /** 各階段毫秒數（給測試頁與除錯用）。 */
  loadMs: number;
  runMs: number;
  postMs: number;
}

export interface AiRunner {
  /** 模型檔在不在（同源 HEAD `/models/<檔名>`）；不在回 false，介面說明怎麼取得。 */
  available(model: AiModel): Promise<boolean>;
  /** 去背：回傳原圖大小、0～1 的遮罩（已經 matteToAlpha，還沒 refineAlpha）。signal abort → 以 'AbortError' reject。 */
  matte(image: RgbaImage, signal?: AbortSignal, onProgress?: AiProgress): Promise<{ alpha: GrayImage; info: AiRunInfo }>;
  /** 深度：回傳原圖大小、0～1 的深度圖（已經 depthToImage，1＝最近）。 */
  depth(image: RgbaImage, signal?: AbortSignal, onProgress?: AiProgress): Promise<{ depth: GrayImage; info: AiRunInfo }>;
  /**
   * 去背成品（T-702c）：推論＋matteToAlpha＋refineAlpha＋applyAlpha 全在 Worker 裡做（主執行緒不頓）。
   * coverage＝修好的遮罩平均值（0～1）；< 0.005 代表找不到主角（介面說「這張圖找不到主角，換一張試試」）。
   */
  removeBackground(image: RgbaImage, refine: RefineOptions, signal?: AbortSignal, onProgress?: AiProgress): Promise<{ image: RgbaImage; coverage: number; info: AiRunInfo }>;
  /** 一張圖變立體（T-702c）：推論＋depthToImage＋splitByDepth 全在 Worker 裡做。 */
  splitLayers(image: RgbaImage, options: SplitOptions, signal?: AbortSignal, onProgress?: AiProgress): Promise<{ bands: DepthBand[]; info: AiRunInfo }>;
  /** 這台電腦能不能用 WebGPU（不載入模型、結果快取）。false＝只能用 WASM，一張大約要一分多鐘，介面先提醒再讓使用者選。 */
  hasFastBackend(): Promise<boolean>;
  /** 關掉 Worker、釋放模型。 */
  dispose(): void;
}

/**
 * runner 丟出的錯誤（T-702c）：name 'AiError'、帶 code；原始原因（英文）放在 cause，只給 console，介面依 code 顯示白話。
 * 取消一律是 name 'AbortError'。
 * - 'model-missing'：模型檔不在（還沒跑 npm run fetch-models）
 * - 'load-failed'：模型或執行檔載入失敗（壞檔、記憶體不夠）
 * - 'run-failed'：推論或後處理失敗
 * - 'bad-output'：模型輸出的形狀或數值不對（NaN、範圍外）
 */
export type AiErrorCode = 'model-missing' | 'load-failed' | 'run-failed' | 'bad-output';

export interface AiRunnerOptions {
  /** 模型資料夾的網址前綴，預設 `${import.meta.env.BASE_URL}models/`。 */
  modelBase?: string;
  /** onnxruntime 的 wasm 資料夾，預設 `${import.meta.env.BASE_URL}ort/`。 */
  ortBase?: string;
  /** 強制後端（測試用）；省略＝先試 WebGPU、不行用 WASM。 */
  backend?: 'webgpu' | 'wasm';
}

export type CreateAiRunner = (options?: AiRunnerOptions) => AiRunner;
