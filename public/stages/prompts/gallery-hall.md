# gallery-hall 舞台遠景（第二版，T-821）

## 版本與來源

- 日期：2026-10-15。第二版：照 AGENTS「先美感、後切版」重畫（提示詞寫氣氛、不寫座標，附第一版與概念圖當方向），使用者看總覽後選「全換」。
- 工具：Codex 內建 imagegen，不透明輸出；生成 1 次、重生 0 次；原生尺寸較小，LANCZOS 等比縮放／微裁切到成品尺寸，有損 WebP q85。
- 原創素材；參考圖只在本機給方向，不含文字、Logo、既有作品元素。

## 第二版提示詞與紀錄

References: public/stages/gallery-hall.webp; .art-tmp/concepts/gallery-mockup-again.webp (mood, architecture and flowers only)

A breathtaking fantasy exhibition hall at blue hour, cinematic architectural illustration with the delicate atmosphere of an enchanted conservatory and the grandeur of an ancient stone sanctuary. Tall clustered blue-grey stone columns carry graceful soaring arches into dim vaults, successive archways recede through cool translucent haze, finely carved botanical capitals and worn pale mineral edges catch thin beams of silver-blue light falling from high unseen openings. Living cherry blossom branches enter naturally from both sides, their soft dusty-rose and ivory petals luminous against deep lapis shadow, a few fallen petals suspended in the light. A broad polished dark stone floor has believable subtle reflections of the columns and overhead shafts, faint fine seams, misty low bloom and a few small out-of-focus floating lights that feel like dust catching light, not a field of glitter. An immersive wide architectural view with a beautifully legible perspective and layered depth, careful asymmetry of blossom branches, soft pools of light and a serene grand scale, deep midnight blue, slate indigo, restrained cold cyan and muted mauve pink, glancing moonlight with tiny warm distant points, richly shadowed stone, smooth reflective floor, petal translucency and dreamlike aerial perspective. A quiet private museum for impossible treasures before the visitors arrive, luxurious but timeless, a soft sense of discovery. Use the supplied gallery and mockup only as references for mood, stone architecture, flowers and illumination; create a new finished scene. The illustration depicts only the hall itself, with no cards, artworks, display stands, pedestals, tables, plinths, picture frames, screens, interfaces, people or characters. Do not reproduce any application UI or objects from the mockup. Entirely original architecture and ornament, no recognizable branded design. No text, letters, numerals, calligraphy, inscriptions, seals, signatures, watermark or logos anywhere. Wide landscape aspect ratio 16:9, complete opaque painting.

## 第一版（T-818，已被取代）

## 版本與來源

- 日期：2026-10-15。
- 採用 v2；重生 1 次。首版牆地交界偏低；第二版增加地板比例並減少中央地板碎紋。
- 工具：Codex 內建 imagegen，不透明輸出（transparent_background=false）。
- 原創素材；氣氛參考只在本機目視，未上傳或作為工具輸入。
- 原圖：`.art-tmp/stages/raw/gallery-hall-v2.png`。
- 作廢首版：`.art-tmp/stages/rejected/gallery-hall-v1.png`。

## v1 提示詞

Use case: stylized-concept. Create one original opaque fantasy gallery interior background only, wide 16:9 intended 2048x1152. Deep navy blue grand hall, symmetrical arched bays and stone columns receding on left and right into depth. Camera straight ahead, vanishing point near exact center. Floor and back wall meet at EXACT y=58 percent from top, polished dark stone floor fills lower 42 percent with soft faint reflections of columns and light shafts, subtle texture not busy tiles. Tall architecture in upper 58 percent, few very faint overhead light shafts placed beside rather than through center. Upper left and upper right corners delicate hanging pale pink cherry blossom branches, blooms stay on outer edges, no floating petals. Sparse dim blue bokeh light flecks along sides. Center rectangle x35-65 percent, y20-90 percent MUST be empty quiet dark negative space, dark plain back wall recedes softly, no bright portal, no bright central shaft, no floor medallion. This reserved space will later hold a separately drawn card and metal circular pedestal; DO NOT depict either. Atmospheric cinematic painterly detail with cool blue silver stone and soft restrained pink accent, dark night workshop ambience, sophisticated rather than cluttered. Architecture fully original, not any known branded fictional hall or famous building. NO PEOPLE, NO CARD, NO DISPLAY OBJECTS, NO frames, cabinets, exhibits, platforms, pedestal, throne, plinth, billboards or UI. No text, letters, numbers, symbols, logos, signatures, watermark anywhere. Generate solely from text with no reference images.

## v2 提示詞（採用）

Use case: stylized-concept. Create one original opaque fantasy gallery interior background only, wide 16:9 intended 2048x1152. Deep navy blue grand hall, symmetrical arched bays and stone columns receding on left and right into depth. Camera straight ahead, vanishing point near exact center. Floor and back wall meet at EXACT y=58 percent from top, polished dark stone floor fills lower 42 percent with soft faint reflections of columns and light shafts, subtle texture not busy tiles. Tall architecture in upper 58 percent, few very faint overhead light shafts placed beside rather than through center. Upper left and upper right corners delicate hanging pale pink cherry blossom branches, blooms stay on outer edges, no floating petals. Sparse dim blue bokeh light flecks along sides. Center rectangle x35-65 percent, y20-90 percent MUST be empty quiet dark negative space, dark plain back wall recedes softly, no bright portal, no bright central shaft, no floor medallion. This reserved space will later hold a separately drawn card and metal circular pedestal; DO NOT depict either. Atmospheric cinematic painterly detail with cool blue silver stone and soft restrained pink accent, dark night workshop ambience, sophisticated rather than cluttered. Architecture fully original, not any known branded fictional hall or famous building. NO PEOPLE, NO CARD, NO DISPLAY OBJECTS, NO frames, cabinets, exhibits, platforms, pedestal, throne, plinth, billboards or UI. No text, letters, numbers, symbols, logos, signatures, watermark anywhere. Generate solely from text with no reference images.
Critical geometric layout: Show substantially MORE floor than a normal interior view. Back wall bottom must be at 58% of canvas height, not 65%. Polished floor occupies FULL LOWER 42% of picture. All column bases near the back lie around y=58%, foreground bases can extend slightly downward only at far outer edges. Place hanging cherry blossom branches in upper corners but inside the picture. Camera slightly higher to reveal floor. Plain floor center has low-detail muted sheen, no pronounced bright marble veins. Empty center, avoid decorative glyphs or heraldic emblems on columns.

## 輸出處理

- 腳本：`.art-tmp/stages/process_check.py`，使用已有 Pillow。
- 原生尺寸：1672×941；交付尺寸：2048×1152。
- 裁切座標 (12, 0, 1660, 927)，得 1648×927（16:9）；牆地交界約在 58% 高度。
- LANCZOS 等比例放大；原生尺寸小於指定尺寸，沒有拉伸變形。沒有重畫圖案或新增景物。
- 轉 RGB、全圖不透明；有損 WebP q85、method=6。
- 成品：`.art-tmp/stages/gallery-hall.webp`（185306 bytes）。
- 檢查圖：`.art-tmp/stages/check/gallery-hall-card.jpg`，正中央深灰半透明圓角矩形，高為圖高 45%、寬為該高 × 0.714，灰色 alpha=205。
- 五張並排總覽：`.art-tmp/stages/check/overview.jpg`。
