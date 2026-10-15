# nebula 舞台遠景（第二版，T-821）

## 版本與來源

- 日期：2026-10-15。第二版：照 AGENTS「先美感、後切版」重畫（提示詞寫氣氛、不寫座標，附第一版與概念圖當方向），使用者看總覽後選「全換」。
- 工具：Codex 內建 imagegen，不透明輸出；生成 1 次、重生 0 次；原生尺寸較小，LANCZOS 等比縮放／微裁切到成品尺寸，有損 WebP q85。
- 原創素材；參考圖只在本機給方向，不含文字、Logo、既有作品元素。

## 第二版提示詞與紀錄

References: public/stages/nebula.webp; .art-tmp/concepts/stage-nebula.webp (atmosphere and spiral motion only)

A mesmerizing cosmic nebula vortex seen perfectly face-on from directly above, an original astronomical-fantasy painting of luminous silk-thin gas filaments spiraling through a deep star field. Several delicate, irregular spiral arms curl around a quiet dark central depth, strands of blue-violet ionized cloud interlace with translucent cyan wisps and just a trace of dusty rose, tiny newborn stellar knots glow like grains of cold diamond. The structure has the flowing elegance of ink in clear water and the immense scale of interstellar dust, fine branching threads, soft volumetric gas and sharply varied pinprick stars, graceful asymmetrical detail held within an unmistakably circular whirl. The eye can follow individual filaments and dark lanes through multiple overlapping depths, brighter silver-blue threads surrounded by diffuse cobalt vapor and plum shadows, no solid rings, no thick luminous doughnut, no lens flare spikes. Perfectly overhead orthographic cosmic view, no tilted galaxy disk, no horizon or gravity direction, no identifiable up or down; a balanced rotational composition that remains beautiful when slowly turned around its center. Toward every outer edge the faint nebular haze dies away smoothly into near-black space, with only a sparse scattering of very faint stars, soft natural vignette without a hard boundary. Midnight blue, rich indigo and violet, restrained glacial cyan, minimal pale pink, tiny white stellar sparks, luminous local detail in vast dark space. The feeling of witnessing a slow impossible tide, spacious, mysterious, quietly alive rather than explosive. Use the supplied nebula references for atmosphere and ethereal spiral motion only; the concept's card and stage must not appear. No card, pedestal, platform, frame, objects, planets, spacecraft, buildings or figures. Completely original imagery, no text, letters, numerals, symbols, signatures, watermark or logos. Square aspect ratio 1:1, one complete opaque nebula texture, seamless-feeling dark edges for rotation.

## 第一版（T-818，已被取代）

## 版本與來源

- 日期：2026-10-15。
- 首版；重生 0 次。
- 工具：Codex 內建 imagegen，不透明輸出（transparent_background=false）。
- 原創素材；氣氛參考只在本機目視，未上傳或作為工具輸入。
- 原圖：`.art-tmp/stages/raw/nebula-v1.png`。

## v1 提示詞（採用）

Use case: stylized-concept. Single original opaque SQUARE 1:1 intended 2048x2048 nebula background texture, directly top-down view of a centered cosmic spiral. Many slender spiral arms and delicate filamentary gaseous clouds in violet, cobalt blue and cyan with very little pink. Irregular star points varied sizes, a few subdued golden stars. Spiral exact center at 50%,50%; central circular disk radius 12% of image WIDTH stays DARK low-detail near-black navy, NOT luminous, with no central star, no white core and no black-hole ring. Luminous slender wisps concentrated in mid-radius annulus outside dark center; many filaments rather than broad heavy bands. All four edges and corners fade progressively to near-black #05060f, outermost 8 percent of each edge almost empty dark with negligible stars, suitable for rotating texture so corners blend. Radial even illumination, no directional light, no horizon, no up or down, no perspective disk tilt. Soft elegant detailed celestial cloud painting, restrained glowing accents, card will later sit at center, do NOT depict it. Original non-branded content only. No cards, frames, platform, people, objects, planets, typography, UI. Absolutely no text, letters, numbers, symbols, emblems, logo, signatures or watermark. Generate only from this text with no reference images.

## 輸出處理

- 腳本：`.art-tmp/stages/process_check.py`，使用已有 Pillow。
- 原生尺寸：1254×1254；交付尺寸：2048×2048。
- 原圖比例已符合；無裁切。
- LANCZOS 等比例放大；原生尺寸小於指定尺寸，沒有拉伸變形。沒有重畫圖案或新增景物。
- 轉 RGB、全圖不透明；有損 WebP q85、method=6。
- 成品：`.art-tmp/stages/nebula.webp`（317620 bytes）。
- 檢查圖：`.art-tmp/stages/check/nebula-card.jpg`，正中央深灰半透明圓角矩形，高為圖高 45%、寬為該高 × 0.714，灰色 alpha=205。
- 旋轉：`.art-tmp/stages/check/nebula-rotate45.jpg`；以中心旋轉 45°，保持同尺寸，空白角填 #05060f。
- 五張並排總覽：`.art-tmp/stages/check/overview.jpg`。

- 邊緣補色：`.art-tmp/stages/refine_nebula_edge.py`；最外 8% 以平滑遮罩接到 #05060f，減少旋轉後與底色的色差。不新增圖案、不改中心及旋臂構圖。
