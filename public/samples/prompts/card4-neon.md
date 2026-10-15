# 第二版（T-821／T-823，2026-10-15）

此段記錄第二版完整插畫與切版美術，由 Codex 內建 image_gen 生成／編輯；卡片檔已在 T-823 換成第二版（主對話用專案模組組卡、過完整匯入檢查）。**範例卡不放文字圖層**（使用者 2026-10-15：「文字可以不用上去，字型不好看」）。組卡（主對話）：標準卡；信使深度 70（去背模型切出）；沿用第一版的「雨絲」層（深度 95）。 以下工作檔位置皆相對於 repo。

## 完整插畫提示詞

Reference: refs/card4-neon-preview.png

```text
A cinematic rain-soaked cyberpunk illustration with painterly photographic lighting and tactile street-level detail, an original adult female night courier caught in a sudden turn as she runs through a narrow neon city lane. Her short uneven indigo hair flashes electric teal at the tips, rain beads cling to her cheek, clear bronze-tinted goggles pushed above her forehead, an alert warm human expression glancing back over one shoulder, a weathered cropped charcoal courier jacket, practical dark cargo trousers and gloves, a worn compact messenger bag swinging with her momentum. One hand protects a small luminous faceted delivery capsule, the other balances her sprint; the body has convincing athletic weight, natural hands and a strong readable gesture. A gust lifts her jacket hem and hair as diagonal rain streaks cross the lens, a sharp splash breaks from her boot. Old steel shopfronts, exposed conduits, humming glass neon tubes mounted on substantial brackets and overhead cables recede into a dense blue-purple city canyon. Every illuminated sign is an abstract wordless geometric light sculpture: concentric circles, broken arcs, diamond outlines and flowing waves, no glyphs or pseudo-writing. Wet asphalt pools and mirrors the cyan, violet and sparse hot coral glow, with a warm distant doorway adding human depth behind the cool figure. A dynamic three-quarter full-body tracking shot from low street height, slight cinematic cant, intimate sharp face and delivery hand, nearest rain drops and far city lamps soft with shallow atmospheric depth, the sense of a fleeting frame from a larger story rather than a fashion pose. Cyan rim light on wet leather, plum reflected shadow on skin, deep cobalt rain haze, restrained magenta glow and tiny amber accents, misty volumetric lamp beams, subtle analog-film grain, believable weathered metal, glossy puddles and translucent wet fabric. Urgency with a spark of private joy in a lonely city, luminous but richly shadowed. Use the old preview only for subject direction and palette; invent a new composition and original adult character. No existing franchise imagery, brands or logos. No text, letters, digits, ideograms, labels, captions, stamps, signatures or watermark anywhere, all clothing and signs unmarked. Portrait aspect ratio 5:7, complete flat illustration, opaque background.
```

完整插畫各生成 1 次。原生 1060×1484，等比 LANCZOS 放大為 1260×1764，PNG 與有損 WebP q85；沒有分別拉伸寬高。來源紀錄：`.art-tmp/samples-v3/prompts.md`。

## 主角來源與對齊

霓虹信使：主對話以專案的 `public/models/isnet-anime.onnx` 去背模型從完整插畫切出，前處理依 `src/ai/matte.ts`；不是重新生成透明人物。本輪不修改 `matte/card4-neon/`。沿原畫布保留原圖像素位置，不套圖片編輯抽出所需的縮放平移；未另量測特徵點 RMS，不能記成測量誤差 0。主角最終修邊由主對話處理。

## 背景補圖編輯提示詞

```text
Use case: precise-object-edit. Edit the supplied ORIGINAL rain-soaked neon courier illustration. Remove the ENTIRE courier woman: all hair, goggles, face, torso, jacket, hands, glowing delivery cube, messenger bag and straps, trousers and boots. Reconstruct the rainy city street naturally behind her, including plausible rear alley walls, receding buildings, service pipes, distant lights, wet asphalt with cyan/violet/amber neon reflections and ground splash without any human-shaped remainder. Preserve EXACT original 1260x1764 canvas, low street camera and original architecture framing, composition, lighting and registration. Keep all existing visible architectural detail untouched wherever possible: left metal wall pipes and pink circular sign, cyan diamond sign below, right cyan wave oval sign and lower violet arcs sign, overhead black cables, distant cobalt towers, warm lit doorway at lower right. Signs are abstract WORDLESS geometric tubes, no lettering. Keep original distant seated silhouette by warm doorway if it lies outside courier silhouette. Same dark cinematic rain, tactile wet surfaces and purple/cyan reflections. No replacement foreground person, no new focal object, no face, no courier-shaped shadow. No text, lettering, symbols resembling writing, logos or watermark. Background inpainting only, do not move signs, crop or redesign the scene.
```

本版背景編輯 1 次。以原圖為輸入；只採用編輯結果的遮罩範圍，其餘保留原圖。

## 遮罩、貼回與後製

主角 alpha ≤ 8 清零；需縮放／仿射對齊時使用預乘 alpha（RGBa），避免插值黑邊。以主角 alpha > 20 轉二值 → MaxFilter 25 擴張 → GaussianBlur 6 產生柔邊遮罩，存為 `fill-mask.png`／`fill-mask-soft.png`。以柔邊遮罩把對齊後的補圖貼回原圖，公式為 `Image.composite(edit, original, mask)`。

背景編輯版先等比放回 1260×1764，再依保留的背景特徵點平移 (1, 0) px。PNG 檢查：遮罩值為 0 的 1,486,235 個像素，與原圖 RGB 最大差 0。這項差 0 不適用於有損 WebP。底圖另存有損 WebP q85。

## 前景

沿用第一版原生透明雨絲層，沒有另生新前景。第一版採用第 2 次生成及預乘 alpha 模糊 0.65 px；完整提示詞保留在下方。

---

# 第一版（已被取代）

# 範例卡 4：霓虹信使（賽博霓虹）

圖層素材用 AI 內建生圖（Codex image_gen）以文字提示生成，全部原創；透明層用生圖工具原生的透明輸出，沒有從底色摳圖；
霓虹燈管畫在純黑底上，工坊用「相加」混合模式把黑色去掉。圖上沒有字，卡名與說明是工坊的文字圖層。
卡片本身在 `../card4-neon.holocard`（鐳射用自訂的霓虹四色：青、洋紅、紫、藍）。

## 圖層（工坊裡的樣子）

| 圖層 | 深度 | 大小（1＝卡寬） | 混合模式 | 說明 |
|---|---:|---:|---|---|
| 雨夜街景 | 0 | 1 | 一般 | 底圖，不透明 1008×1408 |
| 建築招牌 | 25 | 1.25 | 一般 | 畫布 1260×1760（四邊出血），兩側建築＋四個不亮的招牌外殼 |
| 霓虹燈管 | 45 | 1 | 相加 | 純黑底，四組燈管對準招牌外殼 |
| 信使 | 70 | 1 | 一般 | 畫布 1008×1700：卡片範圍在上方 1008×1408，腿往下多畫 292 px 出血（y 往下移 0.145 卡寬） |
| 卡名「霓虹信使」、說明 | 85 | — | — | 文字圖層 |
| 雨絲 | 95 | 1.625 | 一般 | 畫布 1638×2288（四邊出血），細斜雨絲 |

## 後製

- 透明圖：alpha ≤ 8 設成 0 → 預乘 alpha（RGBa）縮放 → 再清一次 alpha ≤ 8 → 有損 WebP q85。
- 信使：原圖腿在大腿處截斷，用「延長褲腿」的編輯生成往下補，y 1210～1300 柔邊接回，上半身保留原圖。
- 招牌：中景用編輯生成加上四個不亮的金屬外殼（背板、框、支架、電線管），只取外殼部分用柔邊遮罩貼回原圖。
- 燈管：另外生成四組燈管素材（純黑底），裁下每一組、仿射對位到外殼內側；RGB ≤ 4 清成純黑。
- 雨絲生成 2 次（第一次太粗，沒採用），預乘 alpha 模糊 0.65 px。

## 提示詞

### 雨夜街景（底圖）

```text
Use case: stylized-concept. Original premium illustrated trading-card layer, painterly cinematic detailed semi-realism, purple/cyan rainy-night lighting. Absolutely no text, glyphs, letters, numbers, watermarks, brands or logos. Portrait composition. Generate ONLY opaque background layer. Portrait 63:88 rainy nighttime futuristic city street viewed slightly upward: distant tall asymmetrical terraced towers, suspended fine rain, wet street reflecting subdued violet and cyan, purple cyan mist. Dark and atmospheric with luminous windows but no signage or readable marks, no people, vehicles or focal foreground objects. Central x25%-75% area relatively quiet dark haze for later character. Upper left x10%-65% y6%-18% quiet dark title space. Original architecture: tiered offset glazed towers, service gantries and slim light accents, not recognizable film cities. Restrained brightness, no bright yellow UI. Full bleed image.
```

### 建築（中景，第一步）

```text
Use case: stylized-concept. Original premium illustrated trading-card layer, painterly cinematic detailed semi-realism, purple/cyan rainy-night lighting. Absolutely no text, glyphs, letters, numbers, watermarks, brands or logos. Portrait composition. Generate ONLY isolated architectural SIDE FRAME with genuine native transparent background. Portrait 63:88. Near building side facades, dark wet metal pipes, one small air conditioner exterior unit, sparse crossing cables up high. Left architecture confined x0%-20%, right architecture x84%-100%, with diagonal few overhead cables confined y0%-18%. Entire middle x22%-82%, y20%-90% EMPTY transparent, NO haze filling center. Facades extend to outer edges for bleed; narrow silhouettes, not a whole alley or scene. Dim purple/cyan reflections, no neon signs, no people, NO lettering on machinery. This artwork will be enlarged on a 1260x1760 bleed canvas with central card rectangle (126,176) to (1134,1584), so place some buildings inside that rectangle but keep its center entirely open. Dark moderately detailed close architecture, sharper than distant towers.
```

### 建築招牌（中景，第二步：加上招牌外殼的編輯）

```text
Use case: precise-object-edit. Edit image 1, the native-transparent cyberpunk architecture mid-layer, 1260x1760. Preserve original architecture, all cables, air-conditioner, pipes, palette and framing. Add ONLY FOUR UNLIT physical neon sign housings attached to the existing side building walls. Maintain genuine transparent empty middle, native alpha output, NO black background. Image 2 is the old neon layout reference (1008x1408); map its coordinates into image1 by adding (126,176). NO LIT TUBES in this output. Photoreal cinematic rainy weathered dark gunmetal metal, rivets, recessed very dark opaque backing, slim raised rims, plausible visible bolted L-brackets, power conduit connected to building, subtle wet edge highlights, no emissive surfaces.
1 pink sign housing upper left: tilted quadrilateral backing corners in this 1260x1760 image approx (214,492),(410,515),(344,790),(145,765), actual dark opaque backing filling interior. Anchor its left side to wall x140..220 with two short metal arms and triangular bolted braces. It sits just below the existing air conditioner. Its recessed usable face contains old pink rectangle and circle.
2 cyan wave sign housing upper right: broad oval dark metal opaque face, bbox (820,354)-(1117,597), center (973,475), modest tilted ellipse; its right edge firmly bolted to right wall pipe at x1110 via two short braces and conduit. Face must be opaque dark unlit metal.
3 orange lightning housing right middle: tall slim dark opaque rectangular face bbox (928,804)-(1120,1191), attach right side to wall x1110 with upper and lower L brackets. No lightning light here, just unlit panel.
4 violet geometric housing lower left: dark opaque narrow tilted parallelogram / vertical board bbox (168,1097)-(449,1400), attached to left wall x210 with two metal brackets and electrical conduit, usable face big enough for two slanted abstract stripes. Never any letters, text, numbers, brands, watermark. Keep central face exclusion card x450..635 y390..600 -> full canvas x576..761 y566..776 perfectly unmodified and transparent. Do not intrude into raised hand card x190..360 y600..760 -> full canvas x316..486 y776..936. Preserve the original 1260:1760 aspect and alpha. FOUR attached unlit casings, no glowing tube shapes.
```

### 霓虹燈管（純黑底）

```text
Use case: stylized-concept / photographic product detail. Generate an isolated atlas of FOUR REALISTIC NEON GLASS TUBE assemblies on exact pure RGB(0,0,0) background, portrait 1200x1600 aspect. No buildings, no metal backing, no brackets, no scenery, no words, letters, digits, brands, logos, watermark. Four clearly separated cells, 100px minimum black margin between assemblies, each glow entirely within its cell.
Top LEFT cell x0..600 y0..800: magenta pink rounded rectangular tube border with a broken circular tube inside. Front-facing rectangle (not tilted), small ceramic tube electrodes and tiny intentional gaps. Rectangle centered at (300,400), bounding approx x100..500 y130..670; circle centered (300,400) diameter270.
Top RIGHT cell x600..1200 y0..800: cyan neon broad horizontal oval containing three gently flowing wave tubes, front-facing symmetrical ellipse, centered (900,400) approx x680..1120 y245..555. Short electrical connector breaks. Do NOT include any box.
Bottom LEFT cell x0..600 y800..1600: orange amber thin-tube outlined ABSTRACT lightning bolt, centered (300,1200), x170..430 y940..1460, smooth rounded bends, closed outline with small electrode break, not a filled solid bolt.
Bottom RIGHT cell x600..1200 y800..1600: TWO horizontal violet rounded capsule outline tubes, stacked at y1110 and y1290, centered x900, each x680..1120 width440 height65. They will later be perspective-mapped onto a slanted board, so here do NOT tilt the bars.
All four: real physical narrow GLASS tubing seen as twin edge highlights and pale bright luminous gas core, tiny dark coupler interruptions at tube joins, rounded corners and subtle glass specular highlights, restrained soft outer colored halo, high-end rainy-night cinematic realism rather than flat vector sticker. Real glass edges, not thick fuzzy solid lines. Exact black void outside localized glow RGB<=4. No mounting hardware. Keep atlas proportions and exact 2x2 layout, each item fully contained in its own cell.
```

### 信使（角色，第一步）

```text
Use case: stylized-concept. Original premium illustrated trading-card layer, painterly cinematic detailed semi-realism, purple/cyan rainy-night lighting. Absolutely no text, glyphs, letters, numbers, watermarks, brands or logos. Portrait composition. Generate ONLY an isolated original young adult female hacker courier with native transparent background, NOT a scene. Full visible silhouette from head to mid-thigh, both arms and hands fully within image. Shoulder-length asymmetric hair deep violet transitioning to electric cyan, thin glowing line prosthetic behind one ear; translucent AMBER goggles pushed up on forehead, confident warm smile. Cropped dark waterproof technical jacket, high collar, reflected tiny raindrops, slender cyan cuff strips; dark practical trousers, no bodysuit, no white hair. One hand supports a SMALL floating translucent holographic plane with only a few abstract geometric light lines, NO text. Face roughly centered x50%, y37%. Entire silhouette inside x15%-85%, y23%-93%, generous fully transparent margin on every edge. Height of silhouette ~70% of canvas, positioned middle/lower. Cyan/pink subtle rim lighting, skin natural, original distinctive face. Request portrait canvas 1008x1408 or equivalent aspect 63:88. No floor, no shadow plane, no random rain around figure.
```

### 信使（第二步：延長褲腿的編輯）

```text
Edit this native-transparent 1008x1700 canvas. Preserve EXACT framing and pixel positions of all existing artwork above y=1200: face, hair, hands, jacket, belt and hips unchanged. Only extend the two black technical trouser legs downward from the existing abruptly flat mid-thigh cutoff at y=1310. Continue the existing leg contours and material naturally through knees and lower legs, matching magenta lighting on left and cyan on right. The original card ends at y=1408; actual opaque trouser legs must continue to y=1690 (282 pixels bleed), naturally going out through bottom image edge, NO feet needed. Legs approximately x=370..505 and x=515..665 where they meet the old cutoff, continue same pose. No horizontal cutoff at y=1310, no fog, no rectangle, no floor/shadow, no background, no new symbols/text. Keep original upper silhouette and transparent empty canvas. Output portrait aspect exactly 1008:1700, actual native alpha transparency. This is a local extension patch; avoid any recomposition or shrinking the person.
```

### 雨絲（前景，採用第 2 次）

```text
Create sparse realistic falling RAIN, isolated native transparent alpha overlay, portrait 1638x2288 aspect. Think photographic raindrops moving very fast: extremely fine short diagonal LINE SEGMENTS, not illustrated objects. 24 scattered thin dim gray-cyan-magenta rain lines, each ONLY 1 to 3 pixels wide and 30 to 80 pixels long at 1638 width. No stroke wider than 5 pixels. Slight blur. Tiny droplets at most 4x9 pixels, only 3 droplets. Rain lines diagonal down-left, same wind direction, random irregular spacing. NO oval shapes, NO glowing leaves, NO thick streaks, NO comets, NO bubbles, NO spheres, NO rainbow rings, NO large halos. Quiet low-opacity rain, 99% image empty native transparency, NO background, NO fog, NO black backdrop. Scatter throughout outer and middle areas, include several lines near x25% y55%, x70% y65%, x35% y75%, x78% y30%. Keep rectangle x44%-62% y34%-48% completely transparent for face. Outer 4% margins empty. Avoid symmetric columns. Photo-real optical raindrop motion blur with very faint neon reflected highlights ONLY. No text/logos, no scene, no person. Every streak MUST be as thin as a hair, not broad brush strokes.
```
