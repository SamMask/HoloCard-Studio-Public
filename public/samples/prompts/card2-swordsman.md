# 第二版（T-821／T-823，2026-10-15）

此段記錄第二版完整插畫與切版美術，由 Codex 內建 image_gen 生成／編輯；卡片檔已在 T-823 換成第二版（主對話用專案模組組卡、過完整匯入檢查）。**範例卡不放文字圖層**（使用者 2026-10-15：「文字可以不用上去，字型不好看」）。組卡（主對話）：標準卡，三層 scale 1；劍士深度 65、櫻花瓣 90（前景主對話拿掉了 11 團白色浪花沫，只留花瓣）；鐳射 60、整面反光。 以下工作檔位置皆相對於 repo。

## 完整插畫提示詞

Reference: refs/card2-swordsman-preview.png

```text
An original hand-painted anime battle illustration with elegant cel shading, ink-brush contours and lacquer-and-gold paper-theatre richness, a breathtaking instant of an unsheathed sword under a cold full moon. A young adult wandering swordsman with wind-tossed charcoal hair, an expressive focused face, a loosely tied off-white robe with restrained rust-red cloud embroidery and layered black hakama, no recognizable franchise costume, pivots across a black volcanic-rock plinth inlaid with torn gold leaf. His blade has just cleared its plain dark scabbard; both hands and the weapon have grounded convincing anatomy and grip. A single brilliantly clear silver-blue cutting arc sweeps with the motion, wind snaps the robe and loose sash, droplets and gold flecks hang in the air, the expression is fierce concentration rather than a posed portrait. A moonlit temple pagoda rises through a rolling sea of clouds in a distant, softly painted plane, while sculpted foaming waves curl around the rocky paper-diorama base near the viewer. Two slim black-lacquer blank name plaques with gold rims, unmarked rice-paper lanterns and subtle pierced cloud ornaments belong to a miniature theatre framing the action. A new asymmetrical cinematic composition rather than the old preview, full-body action seen slightly from below, diagonal sword gesture, the face and drawing hand in sharp focus, airborne spray softened near the lens, layers of mist between figure and temple. Pearly moonlight and cool blue atmospheric shadows mix with warm lantern glow, bone white silk, charcoal cloth, burnt vermilion accents, deep indigo and aged gold, brush-dry texture, luminous blade edge, hand-cut paper relief and weathered lacquer. The feeling of a held breath just before thunder, beautiful controlled violence, historical-fantasy nocturne. Completely original character and imagery, no established character likeness or iconic costume motifs. No text, letters, numerals, inscriptions, seals, stamps, signatures, watermark or logos anywhere; plaques and lanterns are blank. Portrait aspect ratio 5:7, one complete finished flat illustration with opaque background.
```

完整插畫各生成 1 次。原生 1060×1484，等比 LANCZOS 放大為 1260×1764，PNG 與有損 WebP q85；沒有分別拉伸寬高。來源紀錄：`.art-tmp/samples-v3/prompts.md`。

## 主角來源與對齊

颯真：本輪改用完整插畫做圖片編輯，原生透明，保留劍士、刀與刀鞘、完整刀光水弧與水花、紅飄帶及刀穗；移除燈籠柱、名牌、海浪、黑岩台座和背景。原去背模型層沒有採用於新版。抽出共 3 次，各次逐字提示見下方及 `raw/generation-log-card2-v2.json`；候選狀態見 `check/card2-review.md`。

```text
Use case: background-extraction. Edit the supplied finished illustration, preserving its exact artwork. Produce a genuinely transparent RGBA cutout on the SAME full portrait canvas, with EXACT same placement, scale, face, pose, brushwork and colors. KEEP ONLY the entire swordsman (all hair, clothing, shoes), his sword and scabbard, ALL red flying ribbons and sword tassels, AND THE COMPLETE silver-blue curved sword slash water arc INCLUDING all its associated spray, droplets, gold flecks and both the upper/back sweep and lower curling sweep. The big luminous sweeping water arc belongs to the subject and must be completely retained, with natural delicate semi-transparent spray. REMOVE EVERYTHING ELSE to native transparency: moon, sky, trees, temple buildings, clouds, scenery, BOTH lanterns and lacquer columns, BOTH black name plaques, all gold framing ornaments, the sculpted ocean waves at the bottom and sides, and the black rocky pedestal. Separate the floating sword arc from the stationary foaming ocean waves. Do not retain any part of the pedestal beneath his shoes. Do not retain any lantern pillar or name plaque. Do not change or redraw the swordsman. Do not crop, center, resize or reposition the retained items. Do not place a checkerboard or solid background in the image. No new elements, no text.

Use case: background-extraction. Surgical transparent extraction of THIS EXACT existing illustration, not recreation. Retain original full portrait canvas composition at exactly the original image coordinates and same scale. DO NOT make the retained artwork fill the canvas, DO NOT recenter, enlarge, complete or redraw anything. Keep the swordsman, blade, scabbard, all red ribbons and LONG red tassel reaching toward the RIGHT FRAME EDGE, and the EXACT original sweeping silver-blue water arc and its spray/gold flecks. Crucial: in the source the curved slash at LEFT runs OFF THE LEFT IMAGE EDGE and is cropped by the canvas, especially the thin blue-white blade point around lower-left; KEEP THIS LEFT-EDGE CROP. Do not move the left curve inward or create a new entire enclosed circle. The arc follows exactly the source, from temple level behind upper hand, down past left sleeve and blade tip at the left edge, then sweeps toward front ankle above the rock. Match source limb positions, sandal positions, ribbon lengths and every arc contour. All remaining pixels become genuine native alpha transparency. Remove all scenery, sky, moon, trees, pagodas, cherry branches, ALL lanterns, BOTH gold/black columns and plaques, gold cloud ornaments, stationary foaming OCEAN waves at lower outer sides, black rock pedestal. Keep the airborne sword slash water/spray only; no stationary ocean waves. Keep shoes but no rock below them. NO background of any color, NO checkerboard drawn in image. Keep original top and bottom empty regions once scenery is removed. Preserve the illustration pixels rather than inventing anatomy or water geometry. No new objects or text.

Use case: background-extraction. Remove the background from the supplied ORIGINAL image WITHOUT redrawing or recomposing the retained pixels. True native transparency, portrait 5:7, exact source camera/canvas and unchanged source arrangement. The swordsman plus his weapon, red ribbons/tassels and the entire water slash remain EXACTLY where they are in the reference. Position anchors in normalized original canvas: face eyes around (51%,31%); gold sword guard (71%,24%); forward sandal toe (77%,88%); raised sandal (40%,69%); top red ribbon (29%,18%); water slash upper tip (80%,17%); bright diagonal blade tip (4%,64%); huge slash left edge is CUT OFF at x=0%; lower blue curve runs through (40%,79%) and (67%,84%). Preserve ALL these anchors simultaneously, source scale unchanged. CRITICAL: retain the ORIGINAL water crescent geometry, NOT a newly drawn smoother oval. Preserve original cropped-off arc on the left. Do not center the subject or complete the cropped curve. Leave the same broad original empty alpha area above and below. KEEP exact original swordman identity and fine brushwork: all hair and clothing, both shoes, sword, scabbard, red ribbons including their original torn holes transparent, LONG tasseled scabbard cord reaching right edge, full jagged silver-blue water crescent with its original gold specks and water spray. REMOVE EVERYTHING ELSE to transparent alpha: both lanterns, both black/gold columns/plaques, stationary gold cloud ornaments, sky, moon, cherry trees, scenery, buildings, all STATIONARY ocean waves at the sides and bottom, and black rock pedestal. Airborne sword slash is retained; stationary ocean waves removed. No rock under feet. No background color, no drawn checkerboard, no shadow, no extra objects. This is an exact registered cutout, not a new illustration. If output resolution differs from source, scale ENTIRE original canvas uniformly; do not scale or move the subject separately within the canvas.
```

以特徵點局部灰階比對，擬合單一等比縮放＋平移：縮放 1.044984846，平移 (49.963, 166.484) px。特徵點 RMS 誤差 1.267 px，最大 1.909 px（1260×1764 畫布）；這是採用特徵點的對齊誤差，不代表整個輪廓逐像素相同。逐點數字見 `check/layer-verification.json`。

## 背景補圖編輯提示詞

```text
Use case: precise-object-edit. Edit the supplied ORIGINAL moonlit swordsman paper-theatre illustration. Remove the ENTIRE swordsman, all hair, white robe, hands, black trousers, shoes, red ribbons, sword tassels, sword and scabbard. ALSO remove the ENTIRE luminous SILVER-BLUE CURVED SLASH WATER ARC: the diagonal lower-left to upper-right blade streak, the thin upper/back crescent from upper right sweeping left, the broad luminous arc curving down along the left and across lower center, ALL associated bright airborne sword spray and suspended gold/water flecks. There must be ZERO residual sword light or floating slash water anywhere. Fill the vacated areas with a beautiful continuous moonlit temple landscape, indigo forested cliffs, layered clouds, distant lit pagodas and soft vertical waterfalls matching the existing illustration. Keep exact original full canvas and registration. Preserve the full moon at upper right, both side lantern columns with blank black gold-rimmed name plaques, all hanging lanterns and their red tassels, gold cloud ornaments, cherry trees, and especially the stationary carved foaming OCEAN WAVES along the bottom/outer sides and the BLACK GOLD-VEINED ROCK PEDESTAL at bottom. Ocean waves remain, floating sword water disappears. The rock top where his shoes stood is empty continuous bare black rock with gold cracks; no object or figure. Restore columns/ornaments where the removed slash occluded them. Same original ink-contour anime painting, lacquer/gold paper-theatre texture, cold moonlight with warm lanterns. Do not move, resize, redesign or crop existing framing. No replacement person, weapon, human silhouette, arc, text, letters, seals or watermark. Output a complete OPAQUE landscape-background plate.
```

本版背景編輯 1 次（另有上一輪 1 次，舊版保留為 `layers/card2-swordsman-base-v1.*`）。以原圖為輸入；只採用編輯結果的遮罩範圍，其餘保留原圖。

## 遮罩、貼回與後製

主角 alpha ≤ 8 清零；需縮放／仿射對齊時使用預乘 alpha（RGBa），避免插值黑邊。以主角 alpha > 20 轉二值 → MaxFilter 25 擴張 → GaussianBlur 6 產生柔邊遮罩，存為 `fill-mask.png`／`fill-mask-soft.png`。以柔邊遮罩把對齊後的補圖貼回原圖，公式為 `Image.composite(edit, original, mask)`。

背景編輯版先等比放回 1260×1764，再依保留的背景特徵點平移 (0, 0) px。PNG 檢查：遮罩值為 0 的 1,093,145 個像素，與原圖 RGB 最大差 0。這項差 0 不適用於有損 WebP。底圖另存有損 WebP q85。

新版遮罩完全來自新版透明主角 alpha；舊遮罩保留為 `fill-mask-isnet.png`／`fill-mask-soft-isnet.png`。深淺底檢查圖與 `check/card2-swordsman-triptych.jpg`、`check/card2-swordsman-seams-2x.png` 供主對話審查；實際接縫結論見 `check/card2-review.md`。

## 前景

颯真：另生原生透明櫻花瓣與細小水滴；上一輪輸出有 33 個散布元件，現行前景由主對話處理，本輪只讀取它來製作合成檢查圖、不修改前景檔。不排成行列，避開臉部；透明邊緣 alpha ≤ 8 清零。

```text
Use case: stylized-concept. Generate ONE delicate native-transparent foreground particle overlay matching the supplied original moonlit swordsman anime painting. Portrait 1260x1764 /5:7 canvas. ONLY sparse falling pale blush cherry-blossom petals and very fine scattered moonlit sea-foam droplets, original hand-painted ink/anime fantasy quality, cool ivory white and muted rose, a few tiny warm gold reflected flecks. Roughly 18 petals varied 9..30px at target size, naturally turned and foreshortened, sizes varied randomly, subtle motion blur on a few near lens petals; about 30 tiny separated foam droplets, NOT big waves and NOT sword energy arcs. Irregular RANDOM distribution across top-left and top-right, lower left, right edge, and lower third, no lines, rows, columns, grids or symmetric decorative frame. Large native transparent gaps. Keep exact face exclusion rectangle x450..800 y360..720 entirely transparent and sword-grip exclusion x800..1050 y280..550 clear. All outer 64px margins transparent. No person, weapon, lantern, architecture, rock, branch, blossom branch, background wash, mist sheet, shadow plane, border, text or painted checkerboard. Genuine alpha transparency in all empty areas, tiny localized highlights with soft alpha edge only. This is an unobtrusive foreground overlay, not a scene.
```

---

# 第一版（已被取代）

# 範例卡 2：颯真・雲斬（和風劍士＋紙雕小舞台）

圖層素材用 AI 內建生圖（Codex image_gen）以文字提示生成，全部原創；透明層用生圖工具原生的透明輸出，沒有從底色摳圖；
刀光特效畫在純黑底上，工坊用「發光」混合模式把黑色去掉。圖上沒有字，卡名、印章、詩句都是工坊的文字圖層。
卡片本身在 `../card2-swordsman.holocard`。

## 圖層（工坊裡的樣子）

| 圖層 | 深度 | 大小（1＝卡寬） | 混合模式 | 說明 |
|---|---:|---:|---|---|
| 月夜寺塔 | 0 | 1 | 一般 | 底圖，不透明 1008×1408 |
| 名牌燈籠 | 45 | 1.27 | 一般 | 畫布 1280×1788（四邊出血），兩側黑漆名牌板＋兩盞無字燈籠 |
| 劍士 | 65 | 1 | 一般 | 角色約佔卡高 78% |
| 卡名「颯真」、紅印章「雲」 | 66 | — | — | 文字圖層，放在右邊名牌板上 |
| 刀光 | 75 | 1 | 發光 | 純黑底的特效層，對齊刀身 |
| 詩句 | 76 | — | — | 文字圖層，放在左邊名牌板上（在刀光前面才看得清楚） |
| 岩浪台座 | 95 | 1.603 | 一般 | 畫布 1616×2258（四邊出血），黑岩金箔與浪花 |

反光層：用圖層形狀，只有「名牌燈籠」會反光，其他地方是霧光。

## 後製

- 透明圖：alpha ≤ 8 設成 0 → 預乘 alpha（RGBa）縮放 → 再清一次 alpha ≤ 8 → 有損 WebP q85。
- 出血：碰到卡邊的層每邊至少多畫 2 × 深度/100 × 0.15 卡寬，畫布加大、卡片範圍置中，工坊用大小放大。
- 刀光：以角色圖當位置參考生成，再等比縮放、旋轉、平移讓亮刃對準刀身；臉部區域保持純黑。
- 名牌燈籠：把生成的兩側翼板分別縮放平移，對準名牌位置。
- 每層生成 1 次。

## 提示詞

### 底圖

```text
Use case: stylized-concept. Generate ONLY an opaque background layer for original anime paper-cut diorama trading card, portrait 63:88, final 1008x1408. Crisp clean anime cel-painted linework, vivid dark indigo violet with warm gold outlines and restrained vermilion accents. Night sky, a large warm ivory gold full moon centered around 65% width 23% height, with subtly graphic lunar surface. Far layered pagoda and temple roof silhouettes across lower and right background, tiny warm amber lamps along eaves. Distant pink cherry trees, flowing blue violet cloud ribbons with fine golden edges, receding stage-like overlapping flat planes. Scene overall DARKER than a foreground white-clothed hero; moon restrained cream gold, not a blown-out white spotlight. Sharp illustrative anime background, not photoreal, not watercolor. Plenty of visible depth cues like an intricate small paper theater. Center remains background scenery only for later character. No character, swords, slash effects, foreground podium, lanterns, name boards, frame. ABSOLUTELY NO text, pseudo lettering, calligraphy, logos, seals, crests, signature. Completely original environment. Full bleed opaque image.
```

### 名牌燈籠

```text
Use case: stylized-concept. Generate a SINGLE native transparent PNG layer of decorative SIDE PANELS and hanging lanterns for an original anime paper-cut diorama card. Portrait canvas ratio 1280:1788. Treat the centered inner rectangle x=136..1144 y=190..1598 as the 1008x1408 visible card. Peripheral artwork CONTINUES past that inner rectangle into bleed; leave at least 64px transparent at outer canvas edges. Two slender black lacquer wooden upright panels with crisp thin gold bevel borders and very subtle geometric seigaiha accents outside text areas. Right panel MUST have a completely blank flat nearly-black vertical nameplate interior covering canvas x=996..1096,y=340..810 (card x860..960,y150..620), a clear narrow 100px wide by 470px high blank rectangle. Left panel MUST have completely blank dark vertical poem plate covering canvas x=176..266,y=890..1340 (card x40..130,y700..1150). Both blank interiors entirely opaque dark charcoal with NO ornaments inside, tiny gold rim around OUTSIDE. Side uprights and layered slender gold architectural accents suggest paper-cut theater wings, do not fill middle. Two hanging warm ivory cylindrical paper lanterns at upper left, around card x85..205 y80..320, hung by delicate cords, plain paper and rib lines ONLY: NO flowers or symbols. Top border a shallow gold ruyi-cloud ornamental openwork lintel. Middle 65 percent of card is genuine transparent alpha, keep all central space empty. Clean rich anime cel shading, gold outlined shapes, sharp clean linework, warm gold and near black, restrained vermilion cords, layered papercraft edges. No scenery, no background, no character, no sword, no particles. ABSOLUTELY NO LETTERS, pseudo script, numbers, calligraphy, stamps, seals, crests, symbols or logos ANYWHERE. Native transparency, never white or black background.
```

### 劍士

```text
Use case: stylized-concept. A single original anime film keyframe character asset, native transparent background, portrait 63:88 canvas. Full body airborne teenage swordsman age 17, low camera angle, explosively dynamic descending diagonal jump slash from upper right to lower left, bent airborne legs, dramatically billowing white haori. Clear focused gritted-teeth face amber eyes around 52% width 33% height. Tousled dark brown-black hair with low ponytail, vermilion long forehead headband with TWO windblown tails. Deep navy kimono, black hakama, white haori with ornate rounded auspicious ruyi CLOUD motifs on cuffs and hem, gold graduating to vermilion (NOT flames). Vermilion lacquer scabbard at waist and golden cloud-shaped sword guard. Both hands gripping a coherent katana above left side of head; blade extends diagonally toward lower left, shiny clean straight silver blade, no magical slash effects yet. Distinct crisp beautiful anime lineart, rich saturated cel shading and restrained cinematic soft light, strongest contrast, striking foreshortening, lavish cloth motion, legible anatomy. Entire character INCLUDING sword, feet and ribbon tails inside canvas, occupies 78 percent canvas height; at least 64 px transparent on every edge of eventual 1008x1408. No ground, shadows, scenery, particles, text, logos, stamps. Completely original character: no resemblance to existing anime, no checkered or tortoiseshell pattern, no half-patterned haori, no flame hem, no earrings, facial scars, butterfly ornament, white spiky hair, no dragons/tigers/lightning. Actual transparent alpha.
```

### 刀光（純黑底）

```text
Use case: stylized-concept. Input reference is ONLY a precise spatial alignment guide, NOT content to keep. Generate ONLY isolated magical sword slash VFX on absolutely pure RGB(0,0,0) opaque background, same portrait 1008x1408 63:88 canvas. REMOVE the entire referenced character, clothes, hands, sword and face; final image has effects only. Align a thin gold luminous leading edge exactly along referenced blade from guard (630,305) down to blade tip (85,1100). A giant sweeping crescent arc follows this descending upper-right to lower-left sword stroke, broadens OUTSIDE and to LEFT of blade toward x50-300 y700-1100, curls BELOW the blade tip across bottom to x820 y1180. Huge spectacular gold-to-vermilion animated slash wave; curling golden auspicious ruyi CLOUD heads merging with ukiyo-e WAVE foam linework at its tail. Elegant thick cel-graphic contours, brilliant golden edges, crimson internal bands, fine gold sparks. Keep face box x400-570 y320-460 completely pure black; keep torso center and top 18% corners black. Large graphic dramatic cinema attack keyframe, not a dragon, not a tiger, not blue water, not lightning, not flame patterned clothing. No character, objects, letters, glyphs, stamps, text, signature, watermark. No gray haze on black background. Effect must touch exact blade line, not be a detached circular halo.
```

### 岩浪台座（前景）

```text
Use case: stylized-concept. ONLY foreground platform layer of an original anime paper-cut diorama trading card. Portrait native TRANSPARENT canvas ratio 1616:2258. Centered visible card rectangle x304..1312 y425..1833 corresponds to 1008x1408 card. Draw an intricate LOW multi-tier pedestal from layered angular BLACK ROCK slabs with thin GOLD FOIL veins, and small curling ivory white ukiyo-e foam waves on deep indigo water. Place pedestal mostly across canvas y1600..2110, broad across x80..1536. Tops of foam should not rise above canvas y1530 (card y1105), center tops lower around card y1230; keep the complete upper 68 percent of canvas transparent. This is a paper-cut small stage base, waves are overlapping sculptural flat shapes, not a dragon, not giant spirals. Lower left cherry blossom branch intrudes from canvas x140,y1760 and curves toward x500,y1610, light pink blossoms with clear anime outlines. A few randomly scattered pink petals only along BOTTOM and lower side edges, no grid or straight rows. Ivory waves have crisp navy lines and thin golden tips, cel shading, vivid warm gold-black-white-pink-indigo palette, coherent with a white haori and vermilion-gold sword-light hero to be composited later. Leave face card(485,395) completely empty. Keep all area card y<1100 empty except tiny side petals at x<35 or x>980. No character, sword, slash glow, architecture, lantern, name board, sky, moon, background. Fully native transparent alpha across upper and middle. Outer canvas at least 64 px transparent margin, but art must continue through visible card edges and into bleed. Absolutely no text, pseudo calligraphy, seals, crests, logos, writing or symbols.
```
