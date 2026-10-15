# 第二版（T-821／T-823，2026-10-15）

此段記錄第二版完整插畫與切版美術，由 Codex 內建 image_gen 生成／編輯；卡片檔已在 T-823 換成第二版（主對話用專案模組組卡、過完整匯入檢查）。**範例卡不放文字圖層**（使用者 2026-10-15：「文字可以不用上去，字型不好看」）。組卡（主對話）：標準卡、卡框關；花粉獸深度 60；沿用第一版的「金色花粉」層（深度 80、發光）。 以下工作檔位置皆相對於 repo。

## 完整插畫提示詞

References: ../ref/fairy/FEX-S4-O09-amberroot-pollenbear.webp (identity); refs/card3-pollenbear-preview.png (setting direction)

```text
A luminous woodland-folklore illustration painted with the delicacy of an antique naturalist's watercolor and the deep atmosphere of a cinematic fairy tale, one intimate encounter beside a forest stream at night. The creature must be recognizably the user's ORIGINAL amberroot pollenbear from the supplied character reference: a small sturdy four-legged forest sprite with deep moss-green charcoal fur, a soft cream muzzle, a tiny dark nose, huge glossy dark amber eyes, little leaf-shaped amber ears, a short head and rounded compact body, branching translucent golden amber antlers with broad organic rounded syrup-like tips rather than narrow deer tines, tiny gold pollen lights embedded in the mossy coat, a large glowing spherical honeycomb-pattern pollen sac hanging at the throat/chest, and delicate overlapping pale-gold leaf-shaped wings growing behind the shoulders. Preserve those defining shapes, colors and proportions; this is the same creature, not a new bear, deer, fox or dragon. It pauses with one front paw on a wet mossy stone and turns its curious face toward a drifting pollen mote, the little honeycomb lantern illuminating whiskers, damp fur and the tender underside of the jaw. Near-lens fern fronds and soft suspended pollen lead toward the creature, beyond it a narrow stream winds under ancient roots and disappearing trunks, one clearly separated deep plane of cool silver mist and scattered firefly bokeh. A low close wildlife camera at the creature's eye level, tender three-quarter full-body portrait, a quiet asymmetrical composition with organic curves, crisp shining eye and amber horn interiors, increasingly soft wet woodland behind. Amber light seems trapped in ancient resin, warm subsurface glow against black-green foliage, moon-blue light resting on river stones, muted olive and moss colors, ivory leaf veins, translucent honey-gold, tiny dew highlights, rich darks with exquisite local detail. An enchanted animal glimpsed only once, gentle, secretive and alive, wonder rather than cute toy styling. The character sheet supplies identity only: do not reproduce its parchment layout, captions, scientific symbols, border or inset panels. The old card preview supplies setting direction only; create a new immersive illustration without a card frame. Entirely original artwork. No text, letters, numbers, runes, stamps, seals, signatures, watermark or logos anywhere. Portrait aspect ratio 5:7, complete flat scene, opaque background.
```

完整插畫各生成 1 次。原生 1060×1484，等比 LANCZOS 放大為 1260×1764，PNG 與有損 WebP q85；沒有分別拉伸寬高。來源紀錄：`.art-tmp/samples-v3/prompts.md`。

## 主角來源與對齊

琥根花粉獸：上一輪以完整插畫做圖片編輯抽出，原生透明，保留角、毛、花粉囊、葉翅與腳；角色辨識來源為使用者原創設定圖。抽出共 2 次，採用 `raw/extract3-02.png`。下方為已保留的第 1 次提示；第 2 次逐字提示未見於上一輪紀錄，沒有自行補造。

```text
Use case: background-extraction. EDIT TARGET: the supplied amberroot pollenbear full forest illustration. Output a precisely registered native-transparent cutout on the SAME 1260x1764 canvas. Retain ONLY this EXACT animal: amber branching rounded antlers including bubbles, moss-green furry head and body, pale muzzle and whiskers, amber eyes, honeycomb chest sac, pale gold leaf wings, fur with embedded glowing flecks, all visible legs and claws. Keep exact original position, size, pose, colors, lighting and fine texture; do not redraw or reposition. Preserve original silhouette and proportions, no extra anatomy. REMOVE all forest, leaves, mossy rocks under feet, ferns, creek, separate floating pollen and light bokeh. Holes between antlers and around legs become native alpha transparency; fine fur and whiskers retained. No opaque backdrop, no painted checkerboard, no scene, no ground or shadow plane. Do not shrink or recenter the creature. This is surgical background removal of existing illustration, not a new character illustration.
```

以特徵點局部灰階比對，擬合單一等比縮放＋平移：縮放 1.155271850，平移 (12.521, 19.119) px。特徵點 RMS 誤差 5.788 px，最大 7.370 px（1260×1764 畫布）；這是採用特徵點的對齊誤差，不代表整個輪廓逐像素相同。逐點數字見 `check/layer-verification.json`。

## 背景補圖編輯提示詞

```text
Use case: precise-object-edit. Edit target is the supplied ORIGINAL full amberroot pollenbear forest illustration. REMOVE the entire animal including all amber horns, whiskers, furry body, glowing chest honeycomb sac, leaf wings, legs, toes and creature-attached flecks. Naturally reconstruct the hidden mossy stream bank and rainy nocturnal forest. Keep exact original 1260x1764 canvas, crop, camera, all original visible forest details and alignment: distant moon in upper right, hanging wet leaves above, dark trunks and mossy roots, little creek cascading from right rear into reflective winding water at lower right, existing moss-covered dark rocks at lower left and center and tiny white creek flowers, near-lens blurry fern fronds, scattered small warm golden pollen lights. Fill where animal stood with coherent damp moss stone surfaces, ferns and stream consistent with existing landscape; no new animal, face, antlers, wings or creature silhouette. Preserve original surroundings, not a redesigned scene. Same dark moss-green and moon-blue cinematic naturalist illustration and amber highlights. No text, symbols, letters, logos or watermark.
```

本版背景編輯 1 次。以原圖為輸入；只採用編輯結果的遮罩範圍，其餘保留原圖。

## 遮罩、貼回與後製

主角 alpha ≤ 8 清零；需縮放／仿射對齊時使用預乘 alpha（RGBa），避免插值黑邊。以主角 alpha > 20 轉二值 → MaxFilter 25 擴張 → GaussianBlur 6 產生柔邊遮罩，存為 `fill-mask.png`／`fill-mask-soft.png`。以柔邊遮罩把對齊後的補圖貼回原圖，公式為 `Image.composite(edit, original, mask)`。

背景編輯版先等比放回 1260×1764，再依保留的背景特徵點平移 (1, 0) px。PNG 檢查：遮罩值為 0 的 1,451,000 個像素，與原圖 RGB 最大差 0。這項差 0 不適用於有損 WebP。底圖另存有損 WebP q85。

## 前景

沿用第一版金色花粉層（純黑底＋發光混合），沒有另生新前景。第一版完整提示詞與後製保留在下方；其近黑 RGB ≤ 8 清零處理沿用。

---

# 第一版（已被取代）

# 範例卡 3：琥根花粉獸（小妖精系列）

角色來源：使用者原創角色系列。生圖時附上角色設定圖當辨識度參考，**分層重新生成**同一個角色（不是從平面圖摳出來的）；
場景（夜晚溪邊森林）是為了立體疊層重新設計的。圖層素材用 AI 內建生圖（Codex image_gen），透明層用原生的透明輸出；
花粉光點畫在純黑底上，工坊用「發光」混合模式把黑色去掉。圖上沒有字，卡名與說明是工坊的文字圖層。
卡片本身在 `../card3-pollenbear.holocard`（另外開了工坊內建的金色卡框）。

## 圖層（工坊裡的樣子）

| 圖層 | 深度 | 大小（1＝卡寬） | 混合模式 | 說明 |
|---|---:|---:|---|---|
| 夜林溪流 | 0 | 1 | 一般 | 底圖，不透明 1008×1408 |
| 苔石 | 30 | 1.25 | 一般 | 畫布 1260×1760（四邊出血），苔石上緣接住角色的腳 |
| 說明 | 40 | — | — | 文字圖層 |
| 花粉獸 | 60 | 1 | 一般 | 角色約佔卡高 64%，臉在 (300,700) 附近 |
| 金色花粉 | 80 | 1 | 發光 | 純黑底的光點層，避開臉 |
| 卡名「琥根花粉獸」 | 88 | — | — | 文字圖層 |
| 蕨葉 | 95 | 1.625 | 一般 | 畫布 1638×2288（四邊出血），左下與右上的近景蕨葉，輕微景深模糊 |

## 後製

- 透明圖：alpha ≤ 8 設成 0 → 預乘 alpha（RGBa）縮放 → 再清一次 alpha ≤ 8 → 有損 WebP q85。
- 苔石等比縮放後往下移 100 px，讓上緣接住角色三隻落地的腳。
- 蕨葉：只把右上那片放大 1.2 倍、靠右上對齊，最後預乘 alpha 高斯模糊半徑 2.2 px（近景景深）。
- 花粉：近黑的值（RGB 各 ≤ 8）清成 0，光暈以外保持純黑。
- 每層生成 1 次。

## 提示詞

（角色那一段的第一句原本描述參考圖的版面，這裡只留「附設定圖當辨識度參考」的意思。）

### 花粉獸（角色）

```text
Use case: stylized-concept. Create ONE new isolated full-body character asset with native transparent background for a layered portrait fantasy card, using the supplied character design image ONLY as character identity reference. Recreate precisely the Amberroot Pollenbear: small gentle quadruped, shaggy black forest-green moss fur with scattered glowing gold amber specks, two large translucent amber resin branching antlers with rounded melted tips and trapped bubbles, huge glossy amber eyes, pale warm muzzle, luminous honeycomb-pattern amber pollen sac at chest, one pair of pale gold translucent leaf-veined small wings on back, pale front claws. Body turned three-quarter side, head toward viewer, one forepaw raised taking a step, all four limbs anatomically coherent. Preserve its distinctive creature design; not a deer, not a cat, no added accessories. Hand-painted detailed fantasy illustration with organic textures and warm amber glow. Entire body, antlers and wings fully visible; nothing cropped. Centered isolated character, no rocks, no ground, no scenery, no paper, no text, no borders or inset illustrations. Portrait canvas, lots of transparent breathing room all sides, creature from antler tip to paws occupies about 80 percent of source height. Later placed at 63 percent card height in lower middle. True native alpha transparency including between branches, fine fur and semi-transparent wings. No opaque background or checkerboard painted into image.
```

### 夜林溪流（底圖）

```text
Use case: stylized-concept. ONE background painting for a 63:88 portrait fantasy layered card, no character. A newly designed tranquil nocturnal forest creek, distant towering trunks in near-black silhouettes, deep forest green and ink blue foliage, winding creek glistening with restrained amber reflections, numerous soft distant golden pollen bokeh, luminous mist in distance. Detailed hand-painted fantasy atmosphere, painterly organic textures, full bleed opaque picture no paper grain or parchment. Dark overall, reserve a dark quiet open area across central lower-middle for a small magical creature later; creek runs behind its perch at 82 percent height. Lower stream reflections stay subtle. Top left has dark quiet title space. No foreground fern framing, no large central rocks, no creature, no text, no frames, no panels, no symbols. Portrait canvas.
```

### 苔石（中景）

```text
Use case: stylized-concept. ONE isolated midground scenery layer on genuine native transparent background for portrait 63:88 fantasy forest card. Only a cluster of mossy dark slate creekside rocks with a few small fern clumps. Rich detailed painterly forest green and warm subtle amber highlights matching a dark nocturnal fantasy creek. Mostly transparent: all upper 65 percent empty. A wide gently sloping flat moss-covered central rock ledge at y=80 percent provides a stable perch for an animal's feet; small staggered damp stones below and a few short ferns toward outer lower corners. Rock cluster occupies lower quarter, extends beyond left and right sides and beyond bottom to create bleed. No water background, no creature, no floating light dots, no ground rectangle, no text or border, native alpha including holes between ferns. Source will be fitted into 1260x1760 oversized canvas with centered card rectangle x126..1134 y176..1584. Need rocks along bottom with ledge about source y1320 (card y1144), mostly clear central upper area.
```

### 金色花粉（純黑底）

```text
Use case: stylized-concept. ONE portrait 63:88 light-effect texture on a truly PURE BLACK opaque background RGB 0,0,0. Sparse magical airborne warm amber-gold pollen grains and small glowing orbs with soft localized light halos, different sizes and brightness, irregular random scattered distribution, never rows or columns or grid. Tiny specks with a handful medium soft orbs mainly right side, top, and low near edges. Large dark empty central-left face exclusion area normalized x22..63 percent y40..66 percent. Subtle sophisticated warm amber color, no large blazing flares. Absolutely pure black between localized light halos: no fog, no background wash, no gradient, no texture, no illustration scene, no shapes, no plants, no character, no lettering, no border. Designed for screen blend over dark forest. Portrait canvas.
```

### 蕨葉（前景）

```text
Use case: stylized-concept. ONE isolated foreground decorative fern layer with true native transparent background, portrait canvas. Only two richly textured deep forest-green fern fronds with restrained warm gold rim light, painterly fantasy organic detail, slightly out of focus as near-lens foliage. Fronds enter diagonally from extreme LOWER LEFT and UPPER RIGHT outer corners, their stems and leaf mass extend out past the outer edges for generous bleed. Huge empty transparent central area and upper left title area. Upper right frond curls along the right edge, not into central face area; lower left frond confined bottom-left, no plants across middle. No creature, stones, forest background, paper, text, frame or glow specks. Canvas will become 1638x2288; central card area x315..1323 y440..1848. Visible tips should enter near card lower left x0..220 y1130..1408 and upper right x850..1008 y70..420; central face exclusion card x220..630 y570..920 entirely transparent.
```
