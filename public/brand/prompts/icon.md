# T-312 icon

## 版本與來源

- 採用：v1（首版）；未重生。
- 工具：Codex 內建 imagegen，原生透明輸出（transparent_background=true）。
- 原創素材；參考稿只在本機目視參考，未上傳或作為工具輸入。
- 原圖：`.art-tmp/raw/t312-icon-v1.png`。

## v1 提示詞

Use case: logo-brand. Generate one original raster app icon only, on a genuinely transparent alpha background. Square canvas. A single slightly tilted upright rounded rectangular card, very simple bold readable silhouette at 32 pixels, centered, occupying about 80% of canvas with at least 8% fully transparent margin on every side including its soft glow. Deep navy card face with smooth cyan-blue to violet holographic sheen, crisp thick luminous cyan edges, one small clean four-point sparkle on the face. Elegant deep blue magical UI aesthetic, restrained glow, clean edges, minimal details. No enclosing app tile, no surrounding frame, no other objects. Absolutely no text, letters, numbers, logos, watermark, checkerboard pattern, opaque background, or floor. Native transparent output. The card itself is the only silhouette.

## 輸出處理

- 腳本：`.art-tmp/t312/process_check.py`，只用已有 Pillow／numpy。
- 清除 alpha ≤ 8 的像素；依透明內容邊界裁切留白；縮放前轉 RGBa（預乘 alpha），縮放後轉 RGBA，再清除 alpha ≤ 8。
- 置中於方形透明畫布，內容上限邊長 84%；同一原圖輸出 512、192、32px PNG。
- 保留原生透明；未摳底、未重畫圖案。
