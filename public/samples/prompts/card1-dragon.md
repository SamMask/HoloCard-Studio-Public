# 第二版（T-821／T-823，2026-10-15）

此段記錄第二版完整插畫與切版美術，由 Codex 內建 image_gen 生成／編輯；卡片檔已在 T-823 換成第二版（主對話用專案模組組卡、過完整匯入檢查）。**範例卡不放文字圖層**（使用者 2026-10-15：「文字可以不用上去，字型不好看」）。組卡（主對話）：卡片範圍取金框（自訂 20:33、圓角 0.03），三層 scale 1.3305、x −0.0063、y 0.0042；龍（深度 80）與水晶碎片（95）設「衝出卡片」。 以下工作檔位置皆相對於 repo。

## 完整插畫提示詞

Reference: refs/card1-dragon-preview.png

```text
An opulent original fantasy collectible-card illustration, painterly jewel-like realism with precise etched-metal detail and sweeping cinematic movement. A magnificent emerald star-crystal dragon bursts bodily through an antique gold filigree card frame as though the celestial world inside has become alive; translucent green crystal scales overlap like mineral feathers, a long expressive reptilian face, branching deer-antler horns catching starlight, powerful wings unfolding into the viewer, one foreshortened claw reaching through a shower of spinning crystal shards. The moment is a sudden upward bank, the serpentine body twisting with convincing weight and the tail trailing into the cosmic opening; wings and claws visibly cross over the sculpted frame's outer edges. Behind the creature a deep indigo star sea rolls into luminous violet dust, with distant crystalline rocks suspended at a clearly more distant atmospheric plane. Small shards and gold sparks near the lens give an intimate sense of speed. Three-quarter low viewpoint, dramatic diagonal gesture, richly readable silhouette, crisp face and talons with softer receding nebula, powerful chiaroscuro, turquoise light refracted inside crystal and warm gold light grazing engraved acanthus scrolls, malachite and viridian against midnight blue with tiny white stellar highlights. The ornate frame has a smooth blank gold nameplate above and a blank recessed metal description plaque below, both completely unmarked; carved botanical ornament rather than game symbols. Hand-painted surface variation, scratched gilding, glassy mineral edges and ancient living scale texture, epic awe at a creature escaping its miniature universe. Reimagine the provided old preview's subject and materials with a new cinematic composition, do not replicate its layout. Entirely original creature and decorative design, no existing franchise likeness, no text of any kind, no letters, numerals, stamps, signatures, watermark or logos anywhere. Portrait aspect ratio 5:7, full finished flat illustration, opaque background.
```

完整插畫各生成 1 次。原生 1060×1484，等比 LANCZOS 放大為 1260×1764，PNG 與有損 WebP q85；沒有分別拉伸寬高。來源紀錄：`.art-tmp/samples-v3/prompts.md`。

## 主角來源與對齊

星晶龍：上一輪以完整插畫做圖片編輯抽出，原生透明，保留龍身、翅、角、爪、尾；去掉卡框、星空與游離水晶。編輯 1 次。

```text
Use case: background-extraction. EDIT TARGET: the supplied emerald crystal dragon full illustration. Produce a precisely registered transparent cutout layer, same 1260x1764 canvas and exact original composition. Keep ONLY the dragon: emerald crystal scales, both wings including cropped wing edges, huge foreground talons, serpentine body, tail, golden antler horns, mouth and fine whiskers. Remove ALL gold picture frame/nameplates, all night sky and stars, all detached floating crystals, sparks and rocks. Every non-dragon pixel must be genuine native alpha transparency. Preserve original dragon identity, pose, exact pixel placement, scale, colors, light and individual crystal contours as faithfully as possible; do not redesign, reframe, shrink, recenter, expand or complete cropped wings. Dragon left wing remains cropped by original left and top canvas edges. This is background removal from existing illustration, not a new dragon drawing. Preserve holes between horns and wing feathers as transparent. No solid backdrop, no checkerboard drawing, no shadow plane, no additional objects or text.
```

以特徵點局部灰階比對，擬合單一等比縮放＋平移：縮放 1.188048026，平移 (-0.631, 0.170) px。特徵點 RMS 誤差 0.417 px，最大 0.520 px（1260×1764 畫布）；這是採用特徵點的對齊誤差，不代表整個輪廓逐像素相同。逐點數字見 `check/layer-verification.json`。

## 背景補圖編輯提示詞

```text
Use case: precise-object-edit. Edit the supplied original emerald star-crystal dragon card illustration. REMOVE THE ENTIRE DRAGON: wings, head, antler horns, body, legs/talons, tail, ALL dragon scales. Reconstruct the previously occluded background convincingly. Keep EXACT original 1260x1764 canvas, gold frame bounds and perspective, original placement, style, texture, lighting and palette of every surviving feature. Fully restore the antique ornate GOLD CARD FRAME all the way around its existing rectangle (roughly x160..1110 y105..1670): continuous carved acanthus outer borders and inner rails, top blank gold nameplate y165..265 and bottom blank gold description plaque y1445..1580; plaques remain entirely blank with no text/symbols. Inside frame: deep indigo/violet luminous celestial nebula and distant floating crystal rocks consistent with original visible cosmos. Outside frame: same deep midnight-blue backdrop and a few detached floating green crystal shards and tiny gold stars. Restore frame behind upper left wing, right antlers and wings and left claw. No dragon, no creature, no silhouette, no new subject. Preserve ALL visible original background and frame pixels and alignment wherever possible; do not redesign or move frame, don't change crop, no letters, logos, watermark.
```

本版背景編輯 1 次。以原圖為輸入；只採用編輯結果的遮罩範圍，其餘保留原圖。

## 遮罩、貼回與後製

主角 alpha ≤ 8 清零；需縮放／仿射對齊時使用預乘 alpha（RGBa），避免插值黑邊。以主角 alpha > 20 轉二值 → MaxFilter 25 擴張 → GaussianBlur 6 產生柔邊遮罩，存為 `fill-mask.png`／`fill-mask-soft.png`。以柔邊遮罩把對齊後的補圖貼回原圖，公式為 `Image.composite(edit, original, mask)`。

背景編輯版先等比放回 1260×1764，再依保留的背景特徵點平移 (0, 0) px。PNG 檢查：遮罩值為 0 的 839,930 個像素，與原圖 RGB 最大差 0。這項差 0 不適用於有損 WebP。底圖另存有損 WebP q85。

## 前景

星晶龍：另生原生透明水晶碎片與小星光；上一輪以連通區切出碎片，預乘 alpha 縮放，固定隨機散布 19 個元件。不排成行列，避開臉部；透明邊緣 alpha ≤ 8 清零。

```text
Use case: stylized-concept. ONE sparse foreground overlay for the supplied original emerald dragon card, using it only as material/color reference. TRUE NATIVE TRANSPARENT alpha background, portrait 5:7, intended 1260x1764. Only about 12 individually separated emerald/turquoise faceted crystal splinters with tiny warm-gold and white stellar glints, varied sizes (small 12..30px, a few 45..100px at target canvas) and varied rotations, irregular random distribution with asymmetric large gaps, NEVER rows, columns, grids or symmetric framing. Some shards slightly near-lens blurred; jewel-realistic light refracted through translucent green glass with fine gold edges matching dragon scales. No dragon, no gold frame, no rocks, no scenery, no text. Sparse delicate constellation-like glints, localized glow only with alpha fading to zero. Keep face/horns exclusion rectangle x790..1210 y200..740 entirely transparent on target canvas. Keep center body x400..1000 y720..1250 mostly open. Scatter mainly left outer edge, lower-left and lower-right, a few high-left isolated flecks. All four outer 64px margins fully transparent. No backdrop, colored wash, shadow plane or painted checkerboard. This is detached foreground particles, not a composition replacing the card.
```

---

# 第一版（已被取代）

# 範例卡 1：星晶龍（卡牌遊戲風＋破框）

圖層素材用 AI 內建生圖（Codex image_gen）以文字提示生成，全部原創；透明層用生圖工具原生的透明輸出，沒有從底色摳圖。
卡片本身（圖層、深度、文字、反光層）在 `../card1-dragon.holocard`，用工坊打開就能看到每一層的設定。

## 圖層（工坊裡的樣子）

| 圖層 | 深度 | 大小（1＝卡寬） | 說明 |
|---|---:|---:|---|
| 星海夜空 | 0 | 1 | 底圖，不透明 1008×1408 |
| 水晶碎石 | 15 | 1 | 中景，散落的水晶與符石 |
| 金色卡框 | 30 | 1.052 | 窗戶透明、名牌與說明板留空（字由工坊的文字圖層寫） |
| 卡名「星晶龍」、說明 | 31 | — | 文字圖層 |
| 星晶龍 | 80 | 1.5 | **破框層**：畫布 1512×2112，卡片範圍在中間 (252,352)～(1260,1760)，頭、角、翅膀衝出卡外 |
| 星光 | 95 | 1 | 前景光點 |

## 後製

- 透明圖：alpha ≤ 8 設成 0 → 預乘 alpha（RGBa）縮放 → 再清一次 alpha ≤ 8 → 有損 WebP q85。
- 卡框：金屬部分 alpha ≥ 230 補成 255，窗戶邊保留原生的抗鋸齒。
- 中景縮成 880×1280 放在 (64,64)、前景縮成 996×1396 放在 (6,6)，四邊留透明；角色等比縮放後置中。
- 角色生成 2 次（第一次頭的位置太低，沒採用）；卡框生成 2 次（第一次外緣是鏤空的，沒採用）；其他各 1 次。

## 提示詞

### 底圖

```text
Use case: stylized-concept. Create ONLY the opaque background layer for an original luxury fantasy layered card. Portrait ratio 63:88, ideally 1008x1408. Edge to edge mysterious deep violet and midnight navy night sky, distant luminous indigo clouds, tiny gold stars, subtle magical cyan light near lower center. Rich painterly game illustration, very dark subdued backdrop to contrast a teal dragon added later. No dragon, creatures, frame, crystals in foreground, text, glyph letters, logos, existing franchise references. No border. Entire canvas opaque.
```

### 中景

```text
Use case: stylized-concept. Only a sparse middle layer of floating luminous cyan crystals and antique gold-edged dark stone shards for a fantasy card, native transparent background, portrait 63:88. Upper 45% entirely empty transparent. Seven separated irregular clusters, randomly scattered at unequal heights in middle and lower region, some near left x15% y56%, right x83% y48%, left x28% y75%, right x72% y82%, bottom x45% y90%. NOT lines or grid. Faceted turquoise crystals, a few levitating rune stones with abstract curved grooves (no real writing). Deep teal gold premium painted illustration. No creature, no frame, no text, no logo, no ground, no background haze connecting objects. Restrained compact local glows; at least 64px transparent outer padding.
```

### 卡框（採用第 2 次）

```text
Use case: stylized-concept. ONLY an original ornate gold fantasy card FRAME on native transparent background. Portrait 63:88 ideally 1008x1408. Outer gold frame fills whole canvas, straight continuous outer sides, thick beveled polished antique gold with delicate engraved abstract crescents, pointed crystal motifs and sparse individual stars in four corners. Absolutely no star level row, no attack-defense stat design, no logos, no text, no letters, no symbols resembling writing. At top a wide EMPTY gold name plaque y=55..170, at bottom an EMPTY opaque dark gold explanation panel y=1140..1350. Large central window x=95..913,y=210..1100 must be COMPLETELY TRANSPARENT, no illustration or glass in window. Everything outside window must be OPAQUE gold or dark gold solid framing/panels. Front-on orthographic, symmetric elegant luxury collectible frame, crisp bevel highlights, not a floating perspective object. NO background, no drop shadow outside, no dragon. CRITICAL: the OUTER silhouette must be an EXACT solid rectangular card, not a scalloped cutout. Solid dark antique gold metal fills the rectangular corners and all outer-edge gaps behind ornaments, all the way to x0,x1008,y0,y1408. Only the single big center WINDOW is transparent; no transparency outside the window. Raised ornament must stay entirely inside rectangular perimeter. Flat straight outer edge on all sides. Keep top and bottom plaques blank and fully opaque.
```

### 星晶龍（破框層，採用第 2 次）

```text
Use case: stylized-concept. Generate an ORIGINAL dark emerald teal STAR CRYSTAL DRAGON, only isolated character on native transparent canvas, portrait 1512:1980 ratio. Majestic dragon lunging OUT toward viewer, head at upper center (face around x650,y300 in 1512x1980 canvas), antlers reach y100. Body descends diagonally from neck to hip near y1050, talons extend to y1500, curling tail right toward y1600. Two wings spread to x100 and x1400, raised RIGHT wing tip near y150, left wing near y650. Full body shown, not bust. Mix clearly visible dark teal feathers with turquoise crystalline wing blades. Deep emerald faceted scales with delicate golden veins, branching golden stag antlers, gold eyes, sharp elegant snout. Head should be HIGH ABOVE wings roots, like a proud upright lunging dragon; NO huge horns pushing face down the canvas. Face and head in TOP QUARTER, chest middle, claw feet bottom. Premium highly detailed painterly fantasy illustration with gold rim lighting. Invisible card occupies x252..1260,y286..1694: actual head and right wing protrude outside it, claws remain near lower edge. At least 80px genuinely transparent padding on ALL four sides, no cropped appendages. No background, card frame, rectangle haze, smoke, platform, text, logo, no known character, not a white/blue-white dragon, not a bird. Maintain coherent two wing dragon anatomy.
```

### 星光（前景）

```text
Use case: stylized-concept. Only sparse tiny gold and cyan magical light specks and delicate four-point star glints on TRUE transparent background, portrait 63:88 ideally1008x1408. For original crystal-dragon fantasy card. About 16 small isolated glints randomly scattered near edges and corners, uneven non-grid placement, small highlights near x100 y380, x850 y200, x120 y960, x820 y850, x780 y1250, x230 y1180. Keep ENTIRE top middle region x300..700,y0..430 totally transparent for dragon face. Keep middle largely clear. Restrained short local glow around each point, no connecting haze, no bokeh background, no border, no creature, no crystals, no text or logo. At least64px clear transparent padding all edges. Extremely sparse, not a dense starfield.
```
