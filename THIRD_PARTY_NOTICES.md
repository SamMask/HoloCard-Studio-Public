# 第三方授權聲明（Third-Party Notices）

本專案（HoloCard-Studio／立體卡牌工坊）移植或改寫了下列開源專案的程式碼。依照各自的授權條款，在此附上出處與授權全文。

## EverettFish/holo-card-studio

- 專案：https://github.com/EverettFish/holo-card-studio
- 用到的檔案：`assets/web-holographic/app.js`（GLSL 著色程式字串裡的鐳射演算法：`hash`／`noise`、柔和色譜 `spectrum`、視角驅動的波紋 `wave`、`overlay` 疊加混色、隨視角移動的光帶 `sweep`、Voronoi 邊緣的閃星 `star`）
- 本專案的用法：演算法移植成 three.js 的 TSL（WebGPU／WebGL2 共用），並改成「每個圖層各自套用、用該層的透明度當遮罩」；程式在 `src/render/holo-nodes.ts`，檔頭註明出處與改動。沒有複製原專案的圖片、模型或其他檔案。
- 授權：MIT（以下為該專案 `LICENSE` 檔全文，2026-10-13 取得）

```text
MIT License

Copyright (c) 2026 Holo Card Studio contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Generated artwork and user-uploaded references are not distributed with this repository and are not covered by this software license.
```

## 字型（public/fonts/）

文字圖層用的四套字型，原檔照原樣放在 `public/fonts/`（沒有修改、截字或轉檔），出處、版本、雜湊見 `public/fonts/README.md`，各自的授權全文在 `public/fonts/licenses/`：

- 霞鶩文楷 TC：https://github.com/lxgw/LxgwWenkaiTC（release v1.522）— SIL OFL 1.1，全文 `public/fonts/licenses/wenkai-OFL.txt`
- jf open 粉圓：https://github.com/justfont/open-huninn-font（release v2.1）— SIL OFL 1.1（Reserved Font Names: open huninn、huninn；漢字部分衍生自 Kosugi Maru，Apache-2.0），全文 `public/fonts/licenses/huninn-LICENSE.txt`
- 芫荽：https://github.com/ButTaiwan/iansui（release v1.020（iansui.zip 解出））— SIL OFL 1.1，全文 `public/fonts/licenses/iansui-OFL.txt`
- 思源宋體 TC（Noto Serif TC，可變字重）：https://github.com/google/fonts/tree/main/ofl/notoseriftc（google/fonts main 分支 `NotoSerifTC[wght].ttf`（檔名改成不含方括號））— SIL OFL 1.1，全文 `public/fonts/licenses/notoserif-OFL.txt`

## 執行時用到的 npm 套件

`npm install` 從 npm 取得、`npm run build` 時打包進產物；版本鎖在 `package-lock.json`，授權全文在各套件的 `node_modules/<套件>/LICENSE`：

- three.js 0.186.1：https://github.com/mrdoob/three.js — MIT
- fflate 0.8.3（卡片檔 zip 讀寫）：https://github.com/101arrowz/fflate — MIT
- gifenc 1.0.3（GIF 匯出）：https://github.com/mattdesl/gifenc — MIT

- onnxruntime-web 1.30.0（AI 去背與深度的執行套件，T-701）：https://github.com/microsoft/onnxruntime — MIT；它的 wasm 由 `npm run fetch-models` 從 node_modules 複製到 `public/ort/`（不進 git）；它的間接依賴：onnxruntime-common（MIT）、long（Apache-2.0）、platform（MIT）、protobufjs 與 @protobufjs/*（BSD-3-Clause）、flatbuffers（Apache-2.0）、guid-typescript（ISC），2026-10-14 主對話從 node_modules 實查

開發用的套件（TypeScript、Vite、Vitest、fake-indexeddb、型別定義）只在開發時用、不打包進產物。

## AI 模型（不隨本專案散布）

`npm run fetch-models` 會從 Hugging Face 下載到 `public/models/`（不進 git），下載後出處、大小、SHA-256 寫在那個資料夾的 README（下載網址與 SHA-256 也寫在 `scripts/fetch-models.mjs`）：

- IS-Net anime（`skytnt/anime-seg`）— Apache-2.0
- Depth Anything V2 Small（`onnx-community/depth-anything-v2-small`）— Apache-2.0

訓練資料的授權灰區見 `docs/refs/README.md` §3.1。

## 範例卡的圖

`public/samples/` 的六張範例卡片檔（裡面的圖層）都是本專案用 AI 生圖做的原創內容（琥根花粉獸是專案作者原創角色系列的角色）（提示詞在 `public/samples/prompts/`），不使用任何既有動畫、遊戲、卡牌的角色、名字或 Logo。範例圖和程式一樣採用 MIT 授權（見 `LICENSE`）。

`docs/images/` 是工坊實際畫面的截圖與動圖（畫面裡只有上面的範例卡），授權同範例圖。

介面用的圖（`public/brand/` 的圖示與舞台底座、`public/textures/` 的雕花邊角與素色卡背）也是本專案用 AI 生圖做的原創內容，提示詞在各資料夾的 `prompts/`，授權同範例圖。
