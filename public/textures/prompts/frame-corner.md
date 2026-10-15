# T-416 卡框雕花邊角

## 來源

原創花紋，Codex 內建生圖（原生透明輸出）生成 1 次、重生 0 次；沒有上傳使用者圖片、沒有外部素材、既有家紋或 Logo，交付圖沒有文字、簽名、浮水印。展示廳美化稿只作視覺方向參考（四角有金色雕花），花紋內容（捲草、雲紋、星與彎月、小菱形）是重新設計的。

## 提示詞

```text
Use case: stylized-concept
Asset type: original transparent grayscale embossed metal filigree texture for the TOP LEFT corner of a rounded collectible card.
Generate ONE isolated flat frontal ornament on native transparent background, square 1024x1024 canvas. No card, no scene, no background, no checkerboard painted into the image.
Composition: an elegant narrow L-shaped corner flourish, top arm runs horizontally to the right, left arm runs vertically downward, equal arm lengths. Ornament wraps a rounded top-left outer perimeter. Its outer corner is a quarter-circle rounding of radius approximately 205 pixels when the ornament occupies about 900 pixels along each arm. Transparent outside this rounded outer edge. Artwork is inset about 64 pixels from canvas top and left and extends to about 960 pixels along right and bottom; all artwork fully visible with transparent margins. The L-shaped two arms are only about 100-170 pixels thick, with a richer sculpted junction at the rounded corner. The lower-right interior majority of the canvas is TRANSPARENT negative space, not a filled triangle or plate. Ends taper smoothly into fine scroll tips, not hard cutoffs.
Subject: original highly refined embossed botanical scrolls and cloud curls, a small crescent moon nested at the corner junction, subtle tiny four-point stars and a faceted crystal diamond integrated into the scrollwork. Balanced diagonal symmetry between the horizontal and vertical arms; coherent flowing linework, delicate openwork holes, no disconnected floating particles.
Material: neutral grayscale embossed metal relief, main body middle gray, crevices dark gray, crisp near-white bevel highlights; soft directional illumination from upper left. Pure achromatic R=G=B, NO gold or any hue, no glow, no cast shadow beyond ornament silhouette.
Constraints: entirely original design, no existing crest, no franchise, no characters, no writing, no logo, no watermark. Native alpha transparency and clean antialiased edges. Orthographic frontal texture, no perspective or tilting. This will be reduced to about 139 pixels wide in a 630-pixel-wide card, so maintain readable relief, avoid microscopic lace.
```

## 處理

1. Codex 用 Pillow 處理原生透明輸出：alpha ≤ 8 清零、去掉和主花紋不相連的零散雜點、裁到花紋外框、預乘 alpha（RGBa）縮成 1024×1024、轉成 R＝G＝B 灰階、素材 (0,0) 那個角用圓角遮罩限制外緣（只作像素處理，沒有重畫花紋、沒有從底色摳圖）。7 項數值檢查全過。
2. 主對話派工（T-416）轉成交付檔：預乘 alpha（RGBa）縮成 512×512、alpha ≤ 8 清零、完全透明處 RGB 清成 0、有損 WebP quality 85（method 6）。
   - 解碼後：512×512、37,432 bytes；alpha 1～8 的像素 0 個；R、G、B 最多差 1（有損壓縮）；左上角 (0,0) 透明、右下大片透明。
   - 不透明處亮度（0～255）：最暗 8、10% 55、中位數 119、90% 193、最亮 255。

原生輸出、1024 版、處理腳本與金／銀預覽在 `.art-tmp/frame-corners/`（不進 repo）。

## 用法（render）

- 素材 (0,0) 對齊卡片左上角，程式鏡射成四角；邊長＝卡寬 0.28（框寬 0.03 時；框越粗略大，`src/render/frame.ts` 的 `ornateSize`）。
- 上色：灰階中位數附近（0.47）＝卡框顏色、更暗往黑、更亮往高光色（框色往白偏 7 成）；再加和卡框同一條隨視角流動的亮帶（`ornateMetal`）。
