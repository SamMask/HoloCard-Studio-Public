# water-lake 舞台遠景（第二版，T-821）

## 版本與來源

- 日期：2026-10-15。第二版：照 AGENTS「先美感、後切版」重畫（提示詞寫氣氛、不寫座標，附第一版與概念圖當方向），使用者看總覽後選「全換」。
- 工具：Codex 內建 imagegen，不透明輸出；生成 1 次、重生 0 次；原生尺寸較小，LANCZOS 等比縮放／微裁切到成品尺寸，有損 WebP q85。
- 原創素材；參考圖只在本機給方向，不含文字、Logo、既有作品元素。

## 第二版提示詞與紀錄

Reference: public/stages/water-lake.webp (mood only)

A quiet cinematic alpine nocturne painted with the layered atmospheric subtlety of a fine-art landscape, a wide mountain sanctuary under a silver moon. Jagged old granite summits rise around a remote glacial valley, one great snow-dusted massif catching a narrow rim of moonlight while lower forested ridges dissolve into long blue veils of mist. A few wind-torn clouds pass beneath a small luminous moon and sparse crisp stars; the sky has velvety depth, not a flat gradient. Distant peaks overlap like slow waves of stone, intimate dark spruce silhouettes at the far shores give scale, silver light touches broken rock and fine drifting vapor. A panoramic shore-level view looking outward toward mountains, restrained sweeping asymmetry, delicate separation of near ridge, middle peaks and far haze, nocturnal blues, slate, desaturated teal and tiny ivory moonlit edges. Subtle painterly texture with believable geological detail, cool deep shadows and gentle localized light, peaceful grandeur, a secluded place heard before it is seen. The provided old mountain panorama is only a mood reference; invent a more evocative landscape and composition. This is the distant scenery above a later digitally rendered water mirror: the image ends exactly at the distant horizontal shoreline along its bottom edge, all visible pixels are land, sky or atmospheric mist ABOVE that shoreline. Do not depict any lake surface, river, water plane, reflections or reflected mountains; the water will be supplied separately below the image. A subdued dark night background behind a luminous art object, rich atmospheric detail rather than a bright wallpaper. No card, pedestal, frame, people, buildings or foreground display objects. Completely original landscape artwork, no text, letters, digits, inscriptions, signatures, watermark or logos. Landscape aspect ratio 2:1, opaque complete panorama.

## 第一版（T-818，已被取代）

## 版本與來源

- 日期：2026-10-15。
- 首版；重生 0 次。
- 工具：Codex 內建 imagegen，不透明輸出（transparent_background=false）。
- 原創素材；氣氛參考只在本機目視，未上傳或作為工具輸入。
- 原圖：`.art-tmp/stages/raw/water-lake-v1.png`。

## v1 提示詞（採用）

Use case: stylized-concept. Create one original opaque background painting, landscape exact 2:1 aspect ratio intended 2048x1024, NOT a UI or mockup. Moonlit alpine mountain ranges in cool deep navy, cold blue and silver blue. Two or three overlapping ridgelines with restrained snow and subtle moonlight rim light, distant feet veiled by mist. COMPOSITION: top 55 percent is calm night sky gradient darkest at top; all mountains confined to lower 45 percent. Tallest peak at y=55 percent, mountains extend down out of frame into fog. Bottom edge of image IS the horizon where a separate runtime water surface will start. Bottom 8 percent a quiet low contrast dark blue fog band close to #0b1630, with no visible land strip. Absolutely NO water, NO lake, NO reflections. Small restrained moon at upper left third, never central. Middle x=35-65 percent must remain dark and low-detail to support a foreground card later; do not depict this card. Fine atmospheric painterly realism, serene restrained light, mountain highlights primarily toward sides. Original nature only. No cards, frames, billboards, pedestals, people, buildings, petals, props, UI. Absolutely no text, letters, numbers, symbols, logos, signatures or watermarks. No reference images; generate entirely from this text.

## 輸出處理

- 腳本：`.art-tmp/stages/process_check.py`，使用已有 Pillow。
- 原生尺寸：1774×887；交付尺寸：2048×1024。
- 原圖比例已符合；無裁切。
- LANCZOS 等比例放大；原生尺寸小於指定尺寸，沒有拉伸變形。沒有重畫圖案或新增景物。
- 轉 RGB、全圖不透明；有損 WebP q85、method=6。
- 成品：`.art-tmp/stages/water-lake.webp`（52686 bytes）。
- 檢查圖：`.art-tmp/stages/check/water-lake-card.jpg`，正中央深灰半透明圓角矩形，高為圖高 45%、寬為該高 × 0.714，灰色 alpha=205。
- 倒影：`.art-tmp/stages/check/water-lake-reflection.jpg`；原圖下面接完整上下翻轉副本、亮度乘 0.5，不加接縫混色。
- 五張並排總覽：`.art-tmp/stages/check/overview.jpg`。
