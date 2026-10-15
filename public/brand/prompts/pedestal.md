# T-312 pedestal

## 版本與來源

- 採用：v1（首版）；未重生。
- 工具：Codex 內建 imagegen，原生透明輸出（transparent_background=true）。
- 原創素材；參考稿只在本機目視參考，未上傳或作為工具輸入。
- 原圖：`.art-tmp/raw/t312-pedestal-v1.png`。

## v1 提示詞

Use case: stylized-concept. Asset: a standalone holographic display pedestal composited directly below a floating card in a deep navy magical desktop UI. Generate with a genuinely transparent native alpha background. Very wide composition, intended final canvas 1600 x 480 (10:3). Only a low, flat elliptical platform of cyan-blue light seen from obliquely above: 2 or 3 clean concentric elliptical luminous rings, small sparse faint luminous dots along rings. Center remains dark and almost transparent, no opaque solid disc. Brightest inner ring, softer outer ring, delicate atmospheric bloom fading smoothly to fully transparent in every direction. All light including bloom fully contained with generous completely transparent margins on all four sides. Calm elegant restrained cyan and blue with a subtle cool violet undertone. No background, no floor, no card, no beam, no column, no upright structure, no scenery. No rectangular haze or bounding box, no hard outer edge, no enclosing frame. Absolutely no text, letters, numbers, logo, watermark or checkerboard. Keep elliptical vertical thickness around one quarter of its width, viewed from slanted above rather than edge-on. Deliver one isolated platform.

## 輸出處理

- 腳本：`.art-tmp/t312/process_check.py`，只用已有 Pillow／numpy。
- 清除 alpha ≤ 8 的像素；依透明內容邊界裁切留白；縮放前轉 RGBa（預乘 alpha），縮放後轉 RGBA，再清除 alpha ≤ 8。
- 置中於 1600×480 透明畫布，內容上限 1504×384；有損 WebP q85，alpha_quality=100。
- 保留原生透明；未摳底、未重畫圖案。
