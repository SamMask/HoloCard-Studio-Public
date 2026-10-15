# 範例卡 6：月下幽舞（第二版：保留使用者原圖）

底圖與舞者來自使用者於 2026-10-15 提供的原圖。使用者同意舞者用工坊的去背模型直接切出，舞者沒有重畫。
背景補圖及前景使用 Codex 內建 image_gen。前景為工具原生透明輸出，沒有從底色摳圖。卡片本身在 `../card6-moonlit.holocard`。
沒有使用既有動畫、遊戲、卡牌角色、名稱或 Logo。

## 圖層（工坊裡的樣子）

| 圖層 | 深度 | 大小（1＝卡寬） | 混合模式 | 說明 |
|---|---:|---:|---|---|
| 月夜 | 0 | 1 | 一般 | 不透明底圖，941×1672 |
| 舞者 | 50 | 1 | 一般 | 使用者原圖去背，941×1672，0 位移 |
| 鬼火 | 85 | 1 | 一般（建議） | 原生透明，941×1672，5 團鬼火＋2 縷淡霧 |

鬼火建議先用「一般」：已有亮芯與柔光，能保留淡藍、象牙白的木刻色彩。「發光」由主對話組卡實看後再決定。
比例採自訂 9:16；素材沿用原圖 941×1672。原圖左上的字框與印章在底圖裡補掉了；這一版沒有放文字圖層（卡名「月下幽舞」照樣顯示在卡片庫與新卡片面板，使用者可以自己用〔加文字〕加）。

## 後製

### 背景補圖

- 原圖：`.art-tmp/user/moonlit-dance-user.png`，941×1672 RGB；本次沒有修改原檔。
- 背景編輯完成 1 次；原始輸出 `.art-tmp/moonlit-sample/raw/base-edit-01.png`，941×1672。
- 統一到原圖尺寸；月亮、鳥居、花叢三個區塊的 ±8 px 位移搜尋，最佳位移均為 (0, 0)。不另平移、縮放或裁切構圖。
- 使用主對話提供的 `matte/fill-mask-soft.png`，不改遮罩。Pillow `Image.composite(edited, original, mask)`：白色用補圖、灰色柔邊混合、黑色保留原圖。
- `moonlit-base.png` 為保留原像素的母檔；遮罩值 0 的 903,581 個像素各 RGB 通道差值皆為 0。
- `moonlit-base.webp` 為有損 q85（method 6），壓縮後不承諾逐像素差 0；像素驗收以 PNG 為準。
- 已看完整底圖及 8 處 2 倍接縫：沒有整體平移或明顯硬接縫；細部紙紋、水紋仍交主對話視覺驗收。指定遮罩以外不補修。
- 左側幾根細髮絲（約 x205～235、y475～565）漏在原遮罩外：主對話把那一塊加進遮罩（`matte/fill-mask-v2.png`），從同一張補圖貼回；新遮罩外的像素仍和原圖差 0。

### 前景

- 第 1 次原生透明生成；第 2 次編輯縮小鬼火、淡化薄霧，兩份原始 RGBA 輸出都保留在 `raw/`。
- 取第 2 次輸出的 5 團鬼火，以原生 alpha 裁片、預乘 alpha（RGBa）縮放、重新定位；沒有畫新圖案或去背。

| 鬼火中心 (x, y) | 裁片縮放尺寸 |
|---|---|
| (165, 555) | 60×112 |
| (825, 755) | 72×140 |
| (140, 1040) | 85×150 |
| (775, 1190) | 63×120 |
| (635, 1490) | 80×145 |

- 保留 2 縷彼此分離的薄霧，中心 (175,1215)、(745,1380)，尺寸 180×28、170×25，alpha 乘 0.20；捨棄第 2 次輸出中碰到鬼火頂端的中間細帶。
- 後製：alpha ≤ 8 清零 → RGBa 縮放 → 合成透明畫布 → 再清一次 alpha ≤ 8 → 有損 WebP q85（method 6）。
- `moonlit-front.png` 透明母檔；`moonlit-front.webp` 為接入素材。WebP alpha 已與 PNG 逐像素比較相同。
- 臉部 (430,330) 半徑 140、舉手區 x450～690/y100～360、中央身體 x300～620/y400～1200 的非零 alpha 像素均為 0；四邊各 64 px 也均為 0。
- 已看深淺底與完整疊圖；沒有明顯底色矩形或黑白毛邊，保留原生柔光及木刻顆粒。
- 重做後製與數值檢查：`python .art-tmp/moonlit-sample/process-assets.py`。

## 提示詞

### 底圖補圖（原圖為編輯輸入）

```text
Use case: precise-object-edit. Input image is the edit target, an original user-owned ukiyo-e woodblock print. Remove the ENTIRE central dancing woman including all hair, ribbons, arms, hands, floral kimono, green obi, legs and feet, and remove the rectangular calligraphy placard and red seal at the upper left. Fill ONLY their former areas with seamless continuation of the adjacent scenery: upper center dark mottled forest-green night sky and faint blue-gray mist; middle and lower center flat dark water with muted pale-blue curling horizontal water ripples and reflections, and the distant small stone stair path continuing from the existing right-hand stairway. At the former upper-left placard (x35-115 y45-415 on 941x1672 canvas), continue the hanging willow twigs and thin leaves over dark green sky. Preserve EXACTLY the original full 941x1672 composition, full frame, perspective, locations and sizes of moon, cloud bands, willow branches, torii gate, existing blue ghost flames, spider lilies, rock banks, reeds and stairway. Keep all corners and edges and framing identical. No pan, zoom, crop, rotation or re-layout. Do not beautify or reinterpret. Closely match original aged paper grain, distressed ink texture, charcoal/forest green, muted dusty pale-blue and ivory woodcut palette. Background fill must be understated, flattened hand-carved woodblock texture, NOT painterly smooth and NOT glossy. No new buildings, people, body fragments, flowers, moons, ghost flames, text, lettering, signatures or seals. Opaque background-only output, portrait 9:16. The goal is seamless restoration of the scene hidden behind the woman, not a new illustration.
```

### 前景鬼火（原圖只作風格參考；原生透明）

```text
Use case: stylized-concept. Generate ONLY a foreground VFX overlay with true NATIVE TRANSPARENT ALPHA, portrait 9:16 corresponding to a 941x1672 canvas. Input image is ONLY a style and placement reference, NOT an edit target or background to preserve. Absolutely do not include any scene, paper background, person, flowers, willow, moon, text, seal, stairs or gate from it. Draw exactly FIVE isolated small pale dusty blue / ivory-white Japanese ghost-fire flames (hitodama), fine elongated upward flowing irregular wisps with a small luminous ivory core and a restrained soft pale-blue translucent halo. Match the reference's aged woodblock print hand-carved striations and distressed ink flecks, muted dusty pale blue and cream, very subdued elegant atmosphere, NOT modern neon, glossy digital VFX or huge bright fireballs. Positions in 941x1672 coordinates: around (165,555), flame 35x85; (825,755), flame 42x112; (140,1040), flame 48x125; (775,1190), flame 35x92; (635,1490), flame 50x135. These five centers are irregularly scattered and each flame has a different curved shape, height and inclination. Keep halos contained within about 80x165 per flame. Add exactly THREE extremely faint thin tapering blue-gray mist ribbons ONLY at peripheral left/lower-right areas around (175,1215), (735,1380), (200,1545), each less than 190px wide and 25px high, irregular slight horizontal wave, much more transparent than the flames. All other pixels must be transparent. Face exclusion: circular region centered (430,330) radius 140 completely empty. Raised right-hand exclusion: x450..690 y100..360 completely empty. Central body exclusion x300..620 y400..1200 completely empty. Top area y<450 completely empty. Keep at least 64px genuine transparent margin at every edge. No straight rows, columns, evenly spaced patterns or grids. No cast ground shadows, no background fill or rectangle, no particles elsewhere. Output only the five flames and three subtle mist strips, using the tool's actual native transparency.
```

### 前景第 2 次編輯（以前一次透明輸出為輸入）

```text
Use case: precise-object-edit. Edit the referenced native transparent foreground effects layer. Preserve native transparency and the hand-carved pale dusty-blue/ivory woodblock flame style. REDUCE EACH OF THE FIVE GHOST FLAMES to about HALF its current width and height, including glow, centered around these exact 941x1672 positions: (165,555), (825,755), (140,1040), (775,1190), (635,1490). Five flames only, all thin and tapered with a very small ivory core, visually quiet and elegant rather than bright large glowing teardrops. The whole flame plus glow must fit inside 90x160 pixels per flame; irregular differing sizes around 50x110,65x140,75x155,55x120,70x150. Top half mainly transparent. Keep exactly three mist ribbons, make them HALF as wide as now and at most one quarter current opacity (alpha about 20-45 out of255), wispy and faint, no solid paper-colored band. Place mist centers at (175,1215),(745,1380),(200,1545), each entire ribbon fits within 180x25 pixels. All four edges must have at least64 pixels of empty transparency. No extra imagery, scene, background, letters or people. Face circle (430,330) radius140 empty; hand area x450..690 y100..360 empty; body x300..620 y400..1200 empty. IMPORTANT: same full canvas 941x1672, native RGBA transparency; only shrink and reposition the existing generated effects, no new background. Muted dusty blue with off-white core; avoid strong bright cyan.
```

## 檢查圖與證據

全部位於 `.art-tmp/moonlit-sample/check/`：

| 檔案 | 尺寸 | 用途 |
|---|---|---|
| base-vs-original.jpg | 1882×1672 | 左原圖、右補好的底圖 |
| seam-zoom.jpg | 640×2720 | 8 處接縫，左右各放大 2 倍 |
| stack-preview.jpg | 941×1672 | 底圖＋原舞者（0 位移）＋前景，一般模式 |
| front-dark.png | 941×1672 | 深色底毛邊檢查 |
| front-light.png | 941×1672 | 淺色底毛邊檢查 |
| hair-mask-detail.png | 630×290 | 左原圖、中補圖、右原遮罩，2 倍檢查殘留髮絲 |
| verification.json | — | 遮罩外差值、對齊、禁區、尺寸、檔案大小 |

V0：只做素材與文件，未跑程式測試。未做工坊瀏覽器、轉角、深度或混合模式實測；由主對話組卡與驗收。素材已產出；本輪完成層級為「受阻」：指定遮罩未包含全部細髮絲，不能宣稱底圖已完整移除舞者。主對話修正遮罩後需重做貼回與檢查。T-820 全任務尚未完成。

## 組卡（主對話，2026-10-15）

- 舞者：工坊的去背模型（`public/models/isnet-anime.onnx`，前處理同 `src/ai/matte.ts`）切出，alpha ≤ 8 清零，存 WebP q85（含透明）。
- 卡片檔用 node 透過 Vite 載入專案自己的模組（`model/create`、`model/actions`、`file/holocard`）產生，並跑一次完整的匯入檢查。
- 三層 scale 都和底圖一樣（約 1.0005，蓋滿 9:16 卡面），x、y 為 0；舞者深度 50、鬼火 85；底圖不反光，舞者與鬼火反光。
- 舞台：水鏡＋水墨山遠景；圓角 0.03；卡框關。
- `preview.png`：三層疊好、圓角，放在舞台底色上，最長邊 512。
