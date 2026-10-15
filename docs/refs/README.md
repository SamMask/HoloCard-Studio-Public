# 參考資料（只學效果與結構，不用任何角色、Logo、名字）

## 1. Threads：全息 3D 卡牌（使用者 2026-10-08 給的連結）

- 連結：https://www.threads.com/@leofongai/post/Dc_Xg9LDq-r（2026-09-07，leofongai）
- 使用者當時只給連結，沒有貼圖，所以這裡沒有圖檔；Threads 要登入才能看完整影片。
- 貼文內容（主對話 2026-10-13 看過後摘要）：把真人或動漫圖變成全息 3D 卡牌；作者 EverettFish 把生圖與 Blender 操作包成一個 Skill，流程是「**拆圖 → 視差 → 雷射（鐳射）→ 閃星**」，一鍵跑完，並說整套流程已開源。
- 影片封面看得到：一張以動漫角色為主角的卡（只學效果，不用角色），卡片右側一排調整滑桿。
- 2026-10-09 使用者記下的效果重點（OK_Games BACKLOG）：浮世繪背景＋人物、獨立分層、即時鐳射、拖動轉卡、滾輪縮放、可調**鐳射強度／主體深度／背景深度**。
- **影片**：使用者 2026-10-13 下載到本資料夾 `leofongai-Dc_Xg9LDq-r-1.mp4`（960×720、17.8 秒；被 `.gitignore` 排除，只留本機）。主對話抽格看過，效果重點（角色屬既有作品，只學效果）：
  - 卡框：細細的亮銀色金屬框，轉動時框邊跟著反光 → M3 卡框要有隨角度的金屬高光，不只是素色線。
  - 鐳射：傾斜時整張卡掃過一大片柔和的暖色（粉橘）光，不只是細彩虹條紋 → M3 鐳射＝大面積柔光＋彩虹色帶。
  - 擺動範圍小（約 ±15～20°，不翻面）；視差適中。
  - 卡上有字：左上卡名、右上紅色印章、下方招式名 → 文字圖層目前在 BACKLOG（第二版候選），使用者要的話再提前。
  - 卡片下方一行操作提示（拖動轉卡／滾輪縮放／復位）→ 對應 DESIGN §1 的提示列。
  - 閃電特效＝粒子特效（第二版）。
- 留言裡的意見（可當 UX 提醒）：有人覺得「閃電跟角色壓成一坨」不好看 → 特效不要蓋住主角；也有人說材質還要加強、「寶可夢卡牌作者也釋出 skills」。

## 2. 寶可夢卡牌 Pocket（Pokémon TCG Pocket）抽卡時的 3D 卡

- 使用者 2026-10-08 口頭提到：抽卡時卡片可以轉、有立體效果，很好看。沒有圖檔。
- 只學效果：傾斜時的立體視差、隨角度流動的彩虹反光、開包時一張張翻。

## 3. 開源專案參考（2026-10-13 主對話審查；使用者轉貼的外部分析，授權與檔案已用 GitHub API 實查）

原則：只學做法與視覺概念；要抄程式碼必須是寬鬆授權（MIT／ISC／Apache）並在專案附上授權聲明；GPL 的程式碼一律不抄；要裝成套件照硬邊界 6 先問使用者；執行時不准從網路抓任何東西（模型、字型都要打包）。

| 專案 | 授權（實查） | 學什麼 | 用在哪 |
|---|---|---|---|
| EverettFish/holo-card-studio（Threads 影片的開源工具） | MIT（LICENSE 檔是 MIT 全文；GitHub 顯示 NOASSERTION 是格式判斷問題） | 四層做法：背景、主體、**線稿**（白底黑線，鐳射沿墨線發亮）、文字；`assets/web-holographic/app.js` 的彩虹光／線稿高光／星光／視差著色演算法；`references/lenticular-model.md` 雙圖光柵公式；`references/verification.md` 驗收方式（A／B 兩個狀態都要看、背面文字不鏡像） | M3 鐳射與閃星演算法；第二版雙圖光柵。它是 Blender＋WebGL／GLSL，我們是 WebGPU／TSL：**移植演算法，不整包搬** |
| boytchev/tsl-textures | MIT | 用 TSL 寫的程序紋理（星空、Voronoi 碎晶、噪聲、水波…），和我們的著色技術相同 | M3 閃星、碎鑽、銀河材質；第二版局部動態特效。先參考寫法，要整包裝成套件再問 |
| simeydotme/pokemon-cards-css | **GPL-3.0** | 各種稀有度卡的反光樣式（彩虹箔、閃卡、局部高光）＝視覺資料庫 | M3 對照效果。**只看效果、一行程式都不抄**；它的卡圖是既有作品，不用 |
| sawyerWeld/card-foil | package.json 寫 MIT，但沒有 LICENSE 檔；2 顆星 | 四種預設（彩虹、銀色蝕刻、星系、油膜）的參數設計與閒置動畫 | M3「一鍵卡片風格」參考；份量很輕，只看概念 |
| Vanilagy/mediabunny | MPL-2.0（檔案層級的著作權規定；不改它的檔案就能當套件用） | 瀏覽器本機影片編碼與封裝，可做 MP4、固定時間軸 | M5 和 MediaRecorder 比較；要用就是新增依賴，先問 |
| dmnsgn/canvas-record | MIT | 從 WebGPU／WebGL 畫布錄 MP4／WebM／GIF／圖片序列 | M5 候選，同上 |
| mattdesl/gifenc | MIT | GIF 編碼 | M5 已規劃 |
| DepthAnything/Depth-Anything-V2 | Apache-2.0（只有 Small 權重；Base 以上是非商用） | 單張圖估相對深度 | 第二版實驗。注意：只給深度圖、不會自動分層（還要主體分割與補背景）；模型與執行套件很大且要打包進專案 |
| fabricjs/fabric.js | MIT | 成熟的 2D 編輯器設計 | 暫不需要（文字圖層很單純，不為它加大型依賴） |
| jakearchibald/idb | ISC | IndexedDB 的 Promise 包裝 | 暫不需要（原生 API＋現有設計夠用） |
| leochanai/holo-card-studio | **沒有授權檔** | 20 張收藏卡的展示方式 | 只看設計，不碰程式碼 |

採納的方向（排進對應里程碑時再展開，不現在打斷 M2）：
- **M3**：鐳射做成幾種「材質」（彩虹箔、銀箔、碎鑽、銀河…），不只一條強度滑桿；加「**一鍵卡片風格**」（普通／銀箔／彩虹／銀河…一鍵換材質＋卡框＋反光），比讓使用者調十幾條參數好玩，符合產品原則；評估「線稿高光層」。
- **M5**：MediaRecorder 和 mediabunny／canvas-record 實際比較（固定幀率、MP4、GIF 色彩、離屏錄影）。
- **第二版**：雙圖光柵變身、局部動態特效（用某一層當遮罩，先用 TSL 程序圖案做輕量版）、單圖自動景深實驗。

## 3.1 AI 模型（T-701，2026-10-14 子代理調查；使用者睡前「照推薦直接做」）

條件：只用 MIT／Apache-2.0；模型不進 git（`public/models/`，`npm run fetch-models` 下載並驗 SHA-256）；執行時不連外（模型與 onnxruntime 的 wasm 都從本機同源讀）。

| 用途 | 模型 | 程式／權重授權 | 大小 | 出處 |
|---|---|---|---|---|
| 自動去背 | IS-Net anime（`isnetis.onnx`，專為動漫角色訓練） | Apache-2.0／Apache-2.0 | 176 MB（只有 fp32） | https://huggingface.co/skytnt/anime-seg （commit 釘在 `493cb608`） |
| 一張圖變立體（深度） | Depth Anything V2 **Small**（只有 Small 是 Apache-2.0；Base／Large 是 CC-BY-NC，不能用） | Apache-2.0／Apache-2.0 | 99 MB（fp32） | https://huggingface.co/onnx-community/depth-anything-v2-small （commit 釘在 `4472b736`） |
| 執行套件 | onnxruntime-web 1.30.0，用 `onnxruntime-web/webgpu` 入口（新的 WebGPU 後端；只服務 `ort-wasm-simd-threaded.asyncify.wasm`／`.mjs`，從 node_modules 複製到 `public/ort/`）。**不用預設的 JSEP 版**：T-702 實測它的 WebGPU 不支援 IS-Net 的 MaxPool `ceil_mode`，去背退 WASM 一張 70 秒，還把同一個 Worker 的深度 session 弄壞；新版兩個模型都在 WebGPU 跑（去背約 1.8 秒、深度約 1.3 秒，內建窗格背景分頁） | MIT | 26.8 MB wasm | npm |

排除：BRIA RMBG-1.4（非商用）、RMBG-2.0（CC BY-NC 4.0）、Depth Pro（只限研究）、DA2 Base／Large（CC-BY-NC）、transformers.js（依賴太重、預設走 CDN）、BiRefNet_lite（MIT，但官方 ONNX 在 onnxruntime-web 會記憶體不足）。

灰區（未完全查證）：很多通用去背模型（IS-Net general-use、BiRefNet、BEN2）用 DIS5K 資料集訓練，該資料集條款限非商用；IS-Net anime 用作者自己的動漫資料集（卡片標 CC0，上游來源未查證），沒看到含 DIS5K。模型不隨本專案散布，由使用者自己下載。

風險（要在 T-702 實測）：都還沒在瀏覽器跑過；int8 在 WebGPU 可能出錯（所以用 fp32）；three.js 與 onnxruntime 同時用 WebGPU 會不會卡；isnet-anime 前處理以作者為準（RGB／255、不減 mean、長邊 1024 置中補黑）。完整調查原文只留本機（`.art-tmp/ai-models-research.md`）。

## 4. 待補（使用者）

Threads 影片已補（2026-10-13）；寶可夢卡還沒有。請把截圖或螢幕錄影放在這個資料夾（例如 `pokemon-pocket-01.png`），T-104 原型會和它們並排比較。這些參考圖可以留在本機、不一定要進 git（版權屬原作者）。
