# 用 AI 生圖做分層卡：提示詞範例

立體卡牌工坊的立體感來自「分層」：背景在最後、角色浮在中間、前景在最前面，轉動時越前面的層移得越多。這份指南教你用 AI 生圖工具（ChatGPT／GPT Image、Midjourney、Stable Diffusion…）做出好疊的分層圖。下面的提示詞整理自工坊範例卡實際用過、效果好的寫法（四張範例卡的完整紀錄在 `public/samples/prompts/`）。

> 提示詞用英文通常比較準；中文說明在每段上面。`[方括號]` 的地方換成你的內容。

## 先記住這 8 條

1. **透明圖要「原生透明」**：生圖時直接要透明背景（PNG、transparent background）。先生在白底或綠底再去背，邊緣容易留白邊、毛邊。工坊第一版只把有透明的圖當立體層。
2. **一層只放一種東西**：背景一張、角色一張、前景粒子一張。不要把角色和背景畫在同一張。
3. **角色整個入畫、四邊留空**：頭髮、手、腳、武器都不能碰到圖邊。轉動時圖層會移動，碰到邊的地方會露出斷口。
4. **前景別擋臉**：花瓣、光點、蝴蝶放四周和角落，中間（角色的臉和身體）留空。
5. **不要排得太整齊**：AI 很愛把東西排成左右兩條直線。要寫「隨機散落、大小不一、不要排成列或格子」。
6. **碰邊的東西要「畫出界」**：從畫面邊伸進來的樹枝、樹幹、地面、近景草叢，要寫「一路延伸到畫布邊緣、被邊緣切斷」，並把畫布做大一點（見下面「出血」）。
7. **光源與色調一致**：每張都寫同一個光源方向和色調（例如「月光從左上來、深藍綠的夜」）。最好先生背景，再拿背景當參考生角色。
8. **圖上不要字**：寫 no text、no signature、no watermark、no frame。卡名、印章用工坊的〔加文字〕打，字才清楚、能改。也不要用既有動畫、遊戲角色的名字或樣子。

## 比例與大小

- 標準卡是 63:88，塔羅牌是 70:120。生圖工具多半給 2:3 直式（例如 1024×1536），直接用就好，工坊會照比例放進卡裡。
- **出血**（給碰到卡邊的層用）：越前面的層，轉動時移得越多，畫布就要比卡片大越多。大約是：

| 這層的深度 | 每邊多畫 | 例子 |
|---|---|---|
| 20（中景） | 卡寬的 6% | 兩側樹幹 |
| 45 | 卡寬的 14% | 角色腳下的地面 |
| 75（近景） | 卡寬的 23% | 角落失焦草叢 |

畫布做大後，把卡片範圍放在正中間，碰邊的東西一路畫到畫布邊；放進工坊後用「大小」把它放大到斷口超出卡片就好。

## 範本

### 1. 背景（不透明、最後面，深度 0）

只放遠景，近處的地面、樹幹、草叢另外做成一層，立體感會更好。

```text
Original [style, e.g. ukiyo-e woodblock / photoreal / watercolor] background illustration, portrait 1024x1536, opaque full-bleed.
[Scene, e.g. a misty midnight pine forest far away, soft bokeh light orbs, faint moonbeams].
Only distant scenery: no character, no close-up ground, no foreground plants, no tree trunks at the edges.
Keep the middle and lower center calm and uncluttered for a character that will be placed in front.
Light from upper left, [palette, e.g. deep blue-green darkness with soft lime glow].
No text, no letters, no signature, no watermark, no logo, no frame or border.
Do not imitate any existing artwork or famous composition.
```

### 2. 角色（原生透明，深度 50）

```text
Create ONE original full-body character with NATIVE TRANSPARENT BACKGROUND, portrait 1024x1536.
[Character: appearance, outfit, pose, expression].
[Style, e.g. clean anime illustration with ink outlines / photoreal tactile textures].
The ENTIRE character is inside the canvas: hair, hands, sleeves, feet and props never touch any edge.
Leave at least 120 pixels of empty transparent space on every side. Character about 75% of the canvas height, centered.
Light from upper left, matching a [palette] night scene.
No background, no floor, no shadow plate, no glow haze filling the canvas.
No text, no signature, no watermark, no frame. Original character, not resembling any existing anime, game or card character.
```

（想讓角色和你畫過的某張圖一模一樣：把那張圖當參考圖一起給，寫「recreate the same character from scratch; do not cut out or crop the reference」。）

### 3. 前景粒子（原生透明，深度 90）

```text
Create ONE sparse foreground layer with NATIVE TRANSPARENT BACKGROUND, portrait 1024x1536.
About 15-20 [particles, e.g. falling cherry blossom petals / glowing spores / small butterflies], varied sizes,
only 3 large and mostly small, a few softly out of focus, drifting diagonally from upper left to lower right,
irregular spacing and uneven clusters.
Natural random scatter: NOT a border, NOT two vertical columns, no rows, no grid, no symmetry.
The center area (where the character's face and body are) must stay completely empty and transparent.
Keep at least 80 pixels of empty transparent margin on every side; nothing touches the edges.
Every blank area is fully transparent, no faint haze or stray pixels.
```

### 4. 兩側中景（原生透明、碰邊，深度 20，出血 6%）

```text
Create ONE side-frame layer with NATIVE TRANSPARENT BACKGROUND, portrait canvas a bit larger than the card.
One or two [elements, e.g. moss-covered tree trunks with hanging moss] along the extreme LEFT and RIGHT edges,
continuing off the LEFT, RIGHT and TOP canvas edges (cut by the canvas edge, no visible cut ends inside).
They occupy only the outer 20% on each side; the middle 55% of the canvas is completely empty transparent from top to bottom.
Same light and palette as the background. No text, no frame.
```

### 5. 近景失焦（原生透明、碰邊，深度 75，出血 23%）

```text
Create ONE close foreground corner layer with NATIVE TRANSPARENT BACKGROUND, portrait canvas much larger than the card.
Only two separate clusters at the extreme bottom LEFT and bottom RIGHT corners: [e.g. big fern fronds and 2-3 small glowing mushrooms],
strongly out of focus (shallow depth of field, soft blur), continuing off the canvas edges.
Each cluster stays within the outer 24% of the width; the middle 52% is completely empty transparent from top to bottom.
No text, no frame.
```

### 6. 卡背（不透明、對稱）

```text
Create ONE opaque full-bleed portrait 1024x1536 original collectible card BACK design.
[Background color, e.g. deep midnight teal], with fine [line colors, e.g. pale gold and lime] lines.
A central original emblem made of [motif, e.g. mushrooms, moss and leaf veins] and delicate edge ornaments of the same motif.
Exactly mirror-symmetric left/right AND top/bottom. Elegant, quiet, premium engraving feel.
No text, no letters, no logo, no existing crest or brand mark, no watermark.
```

## 放進工坊

1. 開一張新卡 → 先上傳背景（不透明的圖會自動變成底圖）→ 再上傳角色、前景（透明圖會自動浮起來，後上傳的在前面）。
2. 用右邊的「深度」調前後：背景 0、中景 20 左右、地面 45、角色 50、近景 75、粒子 90 是好用的起點。
3. 碰邊的層選中後按〔填滿〕，工坊會自動放大到轉動時不露邊。
4. 卡名、印章用〔加文字〕打。
5. 轉轉看：哪裡露出斷口，就回去生圖時把那邊「畫出界」。

## 範例卡用了什麼

| 範例卡 | 層 | 重點 |
|---|---|---|
| 星晶龍 | 星海夜空＋水晶碎石＋金色雕花卡框（圖）＋**衝出卡片的龍**（大畫布、卡片範圍置中）＋星光 | 破框層的畫布比卡大，頭與翅膀畫在卡片範圍外；卡框圖沒有出血時深度放淺一點、稍微放大，轉動才不露邊 |
| 颯真・雲斬 | 月夜寺塔＋名牌燈籠板（紙雕感）＋劍士＋**黑底刀光**＋岩浪台座 | 刀光畫在純黑底、用「發光」混合；名牌留空，直排字用工坊的文字圖層寫；字的深度要比刀光淺才不被蓋 |
| 琥根花粉獸 | 夜林溪流＋苔石＋角色＋**黑底花粉**＋蕨葉 | 角色站的石頭頂面對齊腳底；花粉用「發光」；前景蕨葉畫出血 |
| 霓虹信使 | 雨夜街景＋建築與招牌外殼＋**黑底霓虹燈管**＋角色＋雨絲 | 燈管對準中景的招牌外殼，用「強光」；角色下半身畫到卡片外（出血），不要在半空切平 |

每張圖的完整提示詞與修改紀錄在 `public/samples/prompts/`。
