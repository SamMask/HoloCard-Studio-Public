# T-808 card-pack

## 版本與來源

- 日期：2026-10-14。
- 採用：v1（首版）；未重生。
- 工具：Codex 內建 imagegen，原生透明輸出（transparent_background=true）。
- 原創水晶、星芒與光線；未使用參考圖、既有品牌、角色或 Logo；沒有文字。
- 原圖：`.art-tmp/card-pack/raw-v1.png`。

## v1 提示詞

Use case: product-mockup. Asset: one original collectible-card foil booster packet for a deep navy desktop crafting UI. Native transparent alpha background, isolated object only.
Front facing perfectly straight-on, upright portrait, no tilt or rotation, subtle realistic thickness and gently inflated foil highlights. Rectangular packet silhouette width to height ratio exactly 480:680. Intended final canvas 544x744 with packet bounding box x=32 to 512, y=32 to 712; ample fully transparent margins on all four sides. No shadow or glow outside packet.
Premium glossy holographic aluminum foil in deep midnight blue, violet and cyan iridescent reflections. Original abstract faceted crystal shards, small geometric stars and fine radiant streaks printed on the face, with a restrained clean central composition. Dimensional foil creases and rich reflective highlights, polished stylized realistic product render. No borrowed franchise design.
Top AND bottom have visibly serrated zigzag cut edges and vertical ribbed heat-crimped seals. Upper crimped sealed strip occupies 11 percent of the whole packet height. It spans full width, is a distinct dark blue-violet ribbed band, not a tiny edge. Immediately below the upper band is ONE straight, delicate subtle horizontal tear line across full width: faint thin dashed impressed perforation, located 11.5 percent down from top of packet; keep the line horizontal and identifiable for animation slicing. Main crystals begin below the tear line. Bottom sealed strip is also ribbed with serrated edge.
Absolutely no text, letters, numbers, pseudoletters, typography, logo, barcode, watermark, text-like symbols, border labels or badge. No cards visible, no hands, no scenery, no floor, no opaque background, no fake checkerboard. Produce exactly one complete unopened packet with native transparency.

## 輸出處理

- 腳本：`.art-tmp/card-pack/process.py`；只用既有 Pillow，無新增依賴。
- 原圖 1075×1464、RGBA、alpha 0～255；alpha >8 內容範圍 (130,39,946,1414)。
- 清除 alpha ≤8；保留原生透明，未摳底、未繪製新圖案。
- 分段裁切既有封邊、間距、撕開線與袋身；轉 RGBa（預乘 alpha），以 LANCZOS 縮放，再轉 RGBA、清除 alpha ≤8。
- 原圖上封邊 y=39～155 縮為 75px；封邊至撕開線的間距壓縮為 3px。原圖撕開線 y=210～216 亮度乘以 0.65，縮為 4px；其餘袋身縮為 598px。未新增或重畫圖案。
- 內容 480×680 置中於 544×744 透明畫布；四邊各留 32px。
- 有損 WebP q85，alpha_quality=100，method=6。
- 成品：`public/brand/card-pack.webp`；544×744；124494 bytes（121.58 KiB）。

## 撕開線與本體座標

- 原點為畫布左上，y 向下；範圍右／下界不包含。
- 本體：x0=32，y0=32，x1=512，y1=712（480×680）。
- 上封邊：y=32～106，高 75px，占本體高度 11.03%。
- 撕開線细帶：y=110～113；中心 **y=112px**，占畫布高 **15.0538%**。
- 程式切割比例：`112 / 744 = 0.1505376344`；相對本體頂端為 80px，占本體高 11.7647%。
- 解碼成品後量測 x=60～483、y=109～114 的低彩度亮像素；y=112 的線條像素最多（184），與放大圖目視一致。

## 檢查

- 解碼 WebP 合成在 #0b1020，查看完整圖與上緣 2 倍放大圖；未見白邊、灰邊或外圍雜點。亮邊是鋁箔的藍紫青色反光。
- 四側 32px 透明帶均為 alpha=0；所有 alpha 均為 0 或 >8；尺寸、內容範圍斷言通過。
- 檢查圖：`.art-tmp/card-pack/dark-preview.png`、`.art-tmp/card-pack/top-edge-2x.png`；量測：`.art-tmp/card-pack/metrics.json`。
- 原生大圖與中間產物均留在 gitignore 的 `.art-tmp/card-pack/`。
- 未跑程式測試、typecheck、build 或開包動畫實測：本次僅交付美術素材，未改程式。
