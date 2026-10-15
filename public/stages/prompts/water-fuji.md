# water-fuji 舞台遠景（第二版，T-821）

## 版本與來源

- 日期：2026-10-15。第二版：照 AGENTS「先美感、後切版」重畫（提示詞寫氣氛、不寫座標，附第一版與概念圖當方向），使用者看總覽後選「全換」。
- 工具：Codex 內建 imagegen，不透明輸出；生成 1 次、重生 0 次；原生尺寸較小，LANCZOS 等比縮放／微裁切到成品尺寸，有損 WebP q85。
- 原創素材；參考圖只在本機給方向，不含文字、Logo、既有作品元素。

## 第二版提示詞與紀錄

Reference: public/stages/water-fuji.webp (subject only)

An exquisite moonlit Japanese volcanic landscape, a wide cinematic nocturne with the luminous restraint of a hand-painted film background and the graceful simplicity of a woodblock mountain study. A majestic solitary Fuji-like snow-capped stratovolcano rises above distant blue-black foothills, its beautiful broad conical silhouette softened by a fine wind-blown plume of cloud. The snow has delicate pale silver-blue ridgelines and deep cobalt gullies, no daylight white, while a low belt of mist wraps the dark wooded base. A slender cloud sweeps across a small ivory moon, a few stars breathe through the velvety indigo sky, nearer ridgelines overlap with faint silhouettes of pines and the far mountain seems suspended in cool night air. A new asymmetrical panoramic composition with a tranquil, spacious rhythm, subtle sweeping cloud movement, fine brush textures and softly readable atmospheric planes. Midnight blue, smoke violet, muted blue-grey, touches of pearl and deep forest navy, gentle moonlight rather than a spotlight, hushed and lucid, the serenity of a sacred mountain seen after everyone has gone home. Use the supplied former stage for subject direction only and improve its atmosphere and painterly depth. This is remote scenery ABOVE a water mirror rendered later: the distant foothill bank terminates at a straight horizontal shoreline exactly along the image's bottom edge, with only sky, clouds, mountain and land visible. Absolutely no visible water surface, lake, river, reflected moon, reflections or mirrored scenery inside the picture. No foreground platform or display objects, no card, pedestal or frame, no human figures, buildings or landmarks with branding. Entirely original artwork without text, calligraphy, letters, numbers, stamps, signatures, watermark or logos. Landscape aspect ratio 2:1, complete opaque panorama, subdued nocturnal luminosity suitable behind a brighter art object.

## 第一版（T-818，已被取代）

## 版本與來源

- 日期：2026-10-15。
- 首版；重生 0 次。
- 工具：Codex 內建 imagegen，不透明輸出（transparent_background=false）。
- 原創素材；氣氛參考只在本機目視，未上傳或作為工具輸入。
- 原圖：`.art-tmp/stages/raw/water-fuji-v1.png`。

## v1 提示詞（採用）

Use case: stylized-concept. Generate a single original opaque panoramic landscape painting exact 2:1, intended 2048x1024. A solitary elegant symmetrical snow-capped stratovolcano with the recognizable natural silhouette of Mount Fuji in a dark blue moonlit night, no buildings. Entire mountain confined to bottom 45 percent: summit at y55 percent of canvas, foothills fade into very dark blue thin mist. The lower 8 percent is uniform subtle fog near #0b1630 with no visible ground strip. Bottom image edge IS horizon where a separate rendered water plane will join later. NO WATER, no lake, no shore, no reflections. Top 55 percent quiet gradient night sky darkest at top, few tiny distant stars. Restrained moon upper left third, cool silver-blue lighting on snow cap, soft subdued contrast. Center dark and quiet around mountain, no spotlight and no central moon. Fine painterly natural realism with still restrained serene mood. No cards, frames, pedestals, people, boats, torii, shrines, landmarks of architecture, flowers, props, UI. No existing fictional property or branded content. Absolutely no text, numbers, letters, symbols, calligraphy, logos, watermark or signatures. Entirely text-generated without reference images.

## 輸出處理

- 腳本：`.art-tmp/stages/process_check.py`，使用已有 Pillow。
- 原生尺寸：1774×887；交付尺寸：2048×1024。
- 原圖比例已符合；無裁切。
- LANCZOS 等比例放大；原生尺寸小於指定尺寸，沒有拉伸變形。沒有重畫圖案或新增景物。
- 轉 RGB、全圖不透明；有損 WebP q85、method=6。
- 成品：`.art-tmp/stages/water-fuji.webp`（47494 bytes）。
- 檢查圖：`.art-tmp/stages/check/water-fuji-card.jpg`，正中央深灰半透明圓角矩形，高為圖高 45%、寬為該高 × 0.714，灰色 alpha=205。
- 倒影：`.art-tmp/stages/check/water-fuji-reflection.jpg`；原圖下面接完整上下翻轉副本、亮度乘 0.5，不加接縫混色。
- 五張並排總覽：`.art-tmp/stages/check/overview.jpg`。
