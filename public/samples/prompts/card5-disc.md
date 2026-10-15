# 範例卡 5：星海唱片鯨（CD 光碟）

日期：2026-10-15。

素材由 Codex 內建生圖（image_gen）生成，全部原創；透明層使用原生透明輸出，沒有從底色摳圖。圖上沒有文字、品牌或既有角色。

素材原檔在 `.art-tmp/disc-sample/`（不進 repo）；2026-10-15 已組成 `public/samples/card5-disc.holocard`（T-810：在工坊裡建立光碟、上傳三層〔經工坊自己的上傳處理，所以卡片檔裡的圖大小和原檔不同〕，三層 scale 1 置中、深度 0／50／85，卡名「星海唱片鯨」，鐳射色彩「銀河」）。

## 圖層（建議設定）

| 圖層 | 深度 | 尺寸 | 說明 |
|---|---:|---|---|
| disc-base | 0 | 1024×1024 | 深色星雲，不透明 |
| disc-whale | 50 | 1024×1024 | 宇宙鯨魚沿圓環彎曲，原生透明 |
| disc-sparkles | 85 | 1024×1024 | 隨機星光與抽象音波光點，原生透明，無出血 |

座標原點在左上，x 向右、y 向下。圓心 (512,512)，預覽外半徑 501.76px（0.49），中央孔半徑 194.56px（0.19）。

鯨魚頭部約 (225,163)～(555,365)，眼睛約 (396,237)；前景禁區 **(200,115)～(605,395)**。頭部位置由實看估計；禁區量測為全透明。

## 後製

- 底圖原生 1254×1254，轉 RGB、不透明，Lanczos 縮至 1024×1024。
- 鯨魚第 1 次未採用：身體進入中央孔，原圖存 `rejected/disc-whale-v1.png`；採第 2 次。
- 透明圖 alpha ≤ 8 清零 → 預乘 alpha（RGBa）→ Lanczos 等比縮至 870×870 → 轉回 RGBA → 再清 alpha ≤ 8 → 放入 1024×1024 透明畫布的 (77,77)。不去背、不新增圖案。
- 前景以原生 alpha 分析連通區塊：若整個光點碰到頭部禁區、半徑小於 220px／大於 448px，或只有小於 5 像素的孤立雜點，就整塊移除，不切斷光暈。
- 三層均存有損 WebP q85，method 6，透明層保留 alpha。
- 重讀最終 WebP，依背景 → 鯨魚 → 前景疊合，以 4 倍解析度抗鋸齒圓環遮罩合成，再縮回 1024×1024，深色底 RGB(7,10,23)，存 `preview.png`。
- `transparent-check.png` 分別檢查透明層在深色底的邊緣；`checks.json` 記錄量測。可在 repo 根目錄用 `python .art-tmp/disc-sample/process.py` 重做後製（需 Pillow）。
- 未檢查程式內轉角、視差、鐳射與深度，留待主對話整合驗收。

## 提示詞

### 底圖

```text
Use case: stylized-concept. Original dark cosmic nebula illustration, ONLY the fully opaque background layer of a layered circular CD artwork, square 1024x1024. Entire square filled edge-to-edge with rich deep navy midnight space, indigo violet nebula clouds and restrained turquoise dust, tiny distant stars and a few muted gold pinpricks. Annular composition centered (512,512): subtly luminous nebulous currents swirl mainly in radius 225 to 480px, center radius 210px is very dark quiet space. Cinematic painterly premium album-art mood, dark enough to support a separately overlaid luminous cosmic whale. Soft asymmetrical nebula clouds, no hard disc edges or circle outline, not a product photo. No whale or any other animals, no foreground large stars, no text, typography, musical notation, brands, logos or watermark. Entire canvas opaque, no transparent center, no borders.
```

### 鯨魚（採用第 2 次）

```text
Use case: stylized-concept. Generate ONLY one original luminous cosmic whale on genuine NATIVE TRANSPARENT background, square 1024x1024. Premium painterly fantasy album illustration, deep indigo violet skin with cyan luminous rim, tiny star points on skin, very faint gold sound-wave curves, restrained gold details. No scene, no text, symbols, letters, logos, watermark or existing characters.
This artwork must fit a CD's circular print ring: center (512,512), inner hole radius 195, outer radius 502. CRITICAL: EVERYTHING on the whale must be OUTSIDE radius 240 and INSIDE radius 430 from center. Make a relatively SLENDER long whale curved in a C shape around the hole, about 200 degrees. Maximum body/head thickness 130px. Head is upper-left at (270,270), not stretched diagonally toward center. Face eye near (270,255); rounded whale snout near (310,225). Its long slender body curls clockwise DOWN LEFT around (175,500), then BOTTOM at (500,840), tail curves upward at lower RIGHT (805,670), forked flukes near (855,575). Fins lie close ALONG the body following the arc; NO fin sticking into center, all fins OUTSIDE radius 240. This is a whale swimming around a ring, NOT a whale lying across it. Leave central circular region radius 235 entirely transparent, generous empty donut center. All glow stays within the same silhouette bounds. All four edges have at least 80 pixels empty transparency. Single whale, no detached sparks. Elegant real whale head with one small glowing eye and subtle throat pleats, clear tail flukes, no giant head. Output native alpha, never paint a checkerboard or colored background.
```

### 前景

```text
Use case: stylized-concept. ONLY sparse foreground sparkles on genuine native transparent background, square 1024x1024, original cosmic whale CD layer. Small luminous cyan and pale gold star-like glints and a few abstract curved teardrop light flecks that suggest sound but are NOT musical notes, no actual score symbols. About 20 tiny separate glints with compact colored glow, most 4-12px cores and 12-25px glows, 97 percent canvas empty alpha. Random irregular scatter, absolutely no rows, columns, grid, symmetrical arrangement or connecting lines. Scatter in annulus centered (512,512), radius 245 to 435px, with more glints top-right, right, bottom-right and lower-left, uneven intervals and sizes. Entire center radius 220px empty transparent, outer 64px empty transparent.
CRITICAL WHALE HEAD EXCLUSION RECTANGLE in 1024 coordinates: x=200..605, y=115..395 must be COMPLETELY EMPTY alpha zero, including every glow. Do not draw any speck in this rectangle; the whale face will be there. No whale, no background, no fog sheet, no nebula, no circles or ring outlines, no text, letters, musical notes, logos, watermark, checkerboard or black matte. Restrained elegant cyan/gold pinpricks with a few indigo curved abstract light droplets. Native transparent output.
```

### 鯨魚（第 1 次，未採用）

```text
Use case: stylized-concept. Create one original luminous cosmic whale as a native-transparent PNG layer for a circular CD artwork. Square 1024x1024 canvas. NO background: genuine alpha transparency, including the center. No text, letters, numerals, logos, watermarks, music notation or recognizable franchise characters.
Painterly premium cosmic illustration, elegant graceful whale anatomy, deep indigo and violet skin, luminous turquoise edge light, scattered tiny star constellations embedded on body and very faint abstract sound-wave ripples, a few restrained gold accents. A single whale, no detached surrounding particles.
CRITICAL silhouette and composition: the whale's entire curved body swims along a circular annulus centered (512,512). Head in the upper-left near (275,265), broad friendly whale head looking tangentially upward/right, one visible bright small eye. Body sweeps from the head down the LEFT side of the ring through (175,510), around the BOTTOM at (500,830), tapering up toward the RIGHT lower side to a beautiful forked tail near (840,590). Long C-shaped swimming pose covering about 200 degrees of the ring, NOT a straight whale across the center. Keep ALL anatomy including fins and flukes within radius 235 to 440 pixels of the center. Entire center radius 210px is empty transparent: never put belly or fins through the CD hole. Keep four edges at least 72px completely transparent; no clipping. Pectoral fins follow the curved ring, they do not reach inward toward the center. Full whale silhouette entirely in-frame. Preserve richly colored edges on alpha, not white matte. Native transparent output, no checkerboard drawn, no disc, no galaxy backdrop.
```
