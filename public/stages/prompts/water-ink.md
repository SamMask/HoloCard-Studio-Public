# water-ink 舞台遠景（第二版，T-821）

## 版本與來源

- 日期：2026-10-15。第二版：照 AGENTS「先美感、後切版」重畫（提示詞寫氣氛、不寫座標，附第一版與概念圖當方向），使用者看總覽後選「全換」。
- 工具：Codex 內建 imagegen，不透明輸出；生成 1 次、重生 0 次；原生尺寸較小，LANCZOS 等比縮放／微裁切到成品尺寸，有損 WebP q85。
- 原創素材；參考圖只在本機給方向，不含文字、Logo、既有作品元素。

## 第二版提示詞與紀錄

Reference: public/stages/water-ink.webp (subject only; new ink-wash direction)

A nocturnal shan-shui ink painting in a long horizontal panorama, contemporary fine-art ink wash on subtly fibrous midnight-blue paper, quietly extraordinary mountains built from breathing brushstrokes rather than photographic rendering. Slender ancient rock towers and broad weathered ridges appear and disappear through long ribbons of unpainted cool mist, dry broken-brush pine boughs cling to cliffs, wet ink blooms bleed delicately into soft paper grain, faint silver moonlight catches only a few rocky planes. A small veiled moon hangs beyond drifting cloud, distant mountains become pale blue-grey stains while closer ridges hold deep indigo-black ink. The composition has the wandering rhythm of a scroll unrolling, asymmetric masses balanced by beautiful open night air, layered vertical peaks and horizontal cloud streams, soft atmospheric absence as important as stone, no hard digital gradients, no fantasy glow effects. Deep indigo, smoky navy, desaturated slate blue and restrained pearl-grey wash, very subtle mineral-blue pigment, tactile brush drag, elegant spontaneous edges, contemplative and ancient, the hush between wind and a distant bell. Use the supplied mountain image only as a subject reference, make this unmistakably expressive ink painting with a fresh composition. This is only a far landscape above a future water mirror: the distant bank and foot of the misty mountains meet a perfectly level horizon at the very bottom edge. Depict sky, mountain, pine and mountain mist only, with no visible water, lake, river, reflections or mirrored shapes anywhere inside the image. The water surface is added later below the picture. Quiet dark nocturnal scenery suitable behind a luminous card, retaining lovely air and tonal depth. No card, display pedestal, frame, people or architecture. No text, letters, calligraphy, inscriptions, seals, red stamps, signatures, watermark or logos. Entirely original artwork. Landscape aspect ratio 2:1, opaque finished painting.

使用內建 image_gen，各張獨立生成。完整場景候選，尚未替換 public/stages/、尚未由使用者定案。圖內的水鏡接線要求來自本次任務。

## 第一版（T-818，已被取代）

## 版本與來源

- 日期：2026-10-15。
- 採用 v2；重生 1 次。首版偏寫實，第二版加強水墨暈染與留白。
- 工具：Codex 內建 imagegen，不透明輸出（transparent_background=false）。
- 原創素材；氣氛參考只在本機目視，未上傳或作為工具輸入。
- 原圖：`.art-tmp/stages/raw/water-ink-v2.png`。
- 作廢首版：`.art-tmp/stages/rejected/water-ink-v1.png`。

## v1 提示詞

Use case: stylized-concept. One original opaque panoramic background, 2:1 intended 2048x1024. Chinese ink wash landscape, layered mountains and cloud mist painted in deep blue ink dissolving into dark navy night, NOT white paper. Elegant flowing diluted ink edges, many quiet empty areas. Restrained faint moon at upper right third. Top 55 percent is uncluttered dark night sky becoming darker upward, peaks only in bottom 45 percent, three loosely layered mountain silhouettes. Bottom 8 percent entirely subdued dark navy mist close to #0b1630, seamless calm horizontal fog at the bottom edge. Bottom edge IS horizon for a water surface added later; do not depict any water or reflection. Middle x35-65 percent dark, quiet, minimal contrast and no fine clutter for a card later, no card depicted. Cool blue monochromatic painterly atmosphere, no white background, no broad brilliant white fog. Original natural mountains only. No cards, frames, plinths, buildings, people, boats, petals or UI. No calligraphy, seals, text, letters, numbers, symbols, signatures, logos or watermark anywhere. Generate only from text, no input references.

## v2 提示詞（採用）

Create one original opaque dark-blue CHINESE INK-WASH PAINTING, hand-painted shan shui aesthetic, not photography or realistic 3D. Panoramic 2:1 intended 2048x1024. Simplified overlapping mountain forms with flowing wet ink washes, softly bleeding blue pigment, expressive loose brush texture and flat silhouette layering, cloud mist formed by empty navy negative space. Night sky and negative space are DARK NAVY rather than white paper. Three layers of mountains confined ONLY to lowest 45% of image, highest peak begins at 55% height, low gently tapering peaks on both sides and quiet low valley in center. Top 55% broad unbroken smooth night sky almost empty; very faint small moon at upper right third. Minimal tiny detail, no intricate trees or craggy photo texture. Dark indigo-blue ink, soft diluted cool slate-blue washes, pale ink restrained and never bright white. Bottom 8% hazy nearly uniform deep navy mist around #0b1630, no visible ground edge. Bottom edge is the horizon for water rendered separately, absolutely no water, shore or reflections inside this image. Center dark low-contrast and empty for a separate card later, do not depict card. No cards, frames, pedestals, people, props, buildings, birds, flowers, UI. Absolutely no text, calligraphy, seals, letters, numbers, symbols, logos, watermark or signature. All original; use this text only, no reference image.

## 輸出處理

- 腳本：`.art-tmp/stages/process_check.py`，使用已有 Pillow。
- 原生尺寸：1774×887；交付尺寸：2048×1024。
- 原圖比例已符合；無裁切。
- LANCZOS 等比例放大；原生尺寸小於指定尺寸，沒有拉伸變形。沒有重畫圖案或新增景物。
- 轉 RGB、全圖不透明；有損 WebP q85、method=6。
- 成品：`.art-tmp/stages/water-ink.webp`（39068 bytes）。
- 檢查圖：`.art-tmp/stages/check/water-ink-card.jpg`，正中央深灰半透明圓角矩形，高為圖高 45%、寬為該高 × 0.714，灰色 alpha=205。
- 倒影：`.art-tmp/stages/check/water-ink-reflection.jpg`；原圖下面接完整上下翻轉副本、亮度乘 0.5，不加接縫混色。
- 五張並排總覽：`.art-tmp/stages/check/overview.jpg`。
