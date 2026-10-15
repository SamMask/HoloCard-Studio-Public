# SCHEMA.md — 資料模型、卡片檔格式、儲存

> 結構事實的唯一來源之一（另一份是 `ARCHITECTURE.md`）。改資料欄位或卡片檔格式 → 同一輪更新本檔與 `docs/spec-v0.1.md` §5，並寫測試。卡片檔是**對外契約**（OK_Games 抽卡遊戲之後會讀），改動要升 `formatVersion` 並保留讀舊版的能力。

## 1. Card（編輯中與存檔的卡片資料）

```ts
interface Card {
  formatVersion: 1;
  id: string;              // crypto.randomUUID()
  name: string;            // 1～60 字，預設「未命名卡片」
  createdAt: string;       // ISO 時間
  updatedAt: string;
  aspect: 'standard' | 'tarot' | 'square' | 'postcard' | 'custom';   // 標準卡 63:88、塔羅 70:120、正方形 1:1、明信片 100:148（直式）、自訂（只是比例；T-807 加後三種）
  customAspect?: { width: number; height: number };   // aspect 'custom' 時必填：使用者輸入的寬與高（整數 1～999，單位隨意，只看比例）；高／寬要在 0.5～2.0（太扁或太長的卡不給）；其他比例時不能有（T-807，可省略所以舊卡照讀、不用升 formatVersion）
  bodyColor: string;       // 卡身顏色 #rrggbb；沒有底圖的面就顯示這個顏色（預設 #1b2033）
  cornerRadius: number;    // 卡身圓角，以卡寬為 1：0～0.12（預設 0.05）；屬於卡身，和卡框開關無關
  front: Face;
  back: Face;              // 背面一層都沒有時，程式畫素色卡背（bodyColor＋淡淡的對稱花紋），不存成圖層
  frame: Frame;
  holo: Holo;
  shadow: Shadow;          // 景深陰影的濃淡與距離（使用者可調，T-310）
  view: { returnToFront: boolean; showcase: boolean; stage: 'halo' | 'gallery' | 'magic' | 'water' | 'nebula' | 'desk' | 'none' };   // 放開回正、展示擺動、卡片下方的舞台特效（全息光環／展示廳〔T-410〕／魔法陣／水鏡／星雲〔T-415〕／沒有；只在工坊裡顯示，PNG 與影片不畫）
  // view.sleeve?: boolean   // 透明卡套（T-806）：true＝卡片外面套一層透明塑膠（比卡大一圈、有厚度，邊緣與斜看時反光）；省略＝false（寫出時省略；可省略所以舊卡照讀、不用升 formatVersion）；工坊裡照開關畫；PNG、影片、GIF 由匯出選單的「包含卡套」決定（預設跟著開關）；卡片庫縮圖不畫
  // view.backdrop?: string   // 舞台背景圖（T-814）：圖片 ID（`^[0-9a-f]{16}$`、圖片要存在），工坊預覽區鋪在卡片後面、取代舞台的遠景（前景照舊）；PNG、影片、GIF 由匯出選項「畫上背景」決定；卡片庫縮圖不畫。算進每張卡最多 16 張圖（§1.1）；卡片檔 `images/` 帶著這張。省略＝沒有（寫出時省略；可省略所以舊卡照讀、不用升 formatVersion）
  // view.foreground?: { image: string; x: number; y: number; scale: number; blur: number }   // 前景圖（T-830）：image＝圖片 ID（同 backdrop 的規則、圖要存在、算進 16 張）；x、y −1～1（圖中心的位置，0＝置中、±1＝圖中心在畫面邊，y 往上為正；照 0.01 四捨五入）；scale 0.5～3（1＝長邊是畫面高的 0.6 倍）；blur 0～100 的整數（100＝畫面高的 4%）；圖在 `cardImages` 裡排在背景圖後面（16 張上限、卡片檔打包、清圖都算到）。預覽區疊在卡片前面；PNG、影片、GIF 勾「畫上背景」時一起畫；卡片庫縮圖不畫。省略＝沒有（寫出時省略；可省略所以舊卡照讀、不用升 formatVersion）
  // view.waterScene?: 'lake' | 'ink' | 'fuji'   // 水鏡的遠景（T-815）：湖光山峰／水墨山／富士山（圖在 `public/stages/`，不進卡片檔）；省略＝'lake'（寫出時 'lake' 省略）；只有 stage 'water' 時畫，其他舞台照存不畫；有 backdrop 時被背景圖取代（欄位照存）
  // view.farPan?: { x: number; y: number; zoom: number }   // 遠景的位置與大小（T-822）：套在預覽區看得到的那張遠景（使用者的背景圖，或水鏡的遠景圖）。x、y 是 −1～1（0＝置中；−1／1＝圖的左／右〔上／下〕邊對齊畫面邊，算法是「cover 之後多出來的部分」的比例，所以不管畫面寬高比怎麼變都不會露出空白）；zoom 是 1～3（1＝剛好蓋滿）。水鏡時 y 不用（遠景下緣貼水平線）、放大以下緣為基準。省略＝{0,0,1}（寫出時省略；三個值都是有限數字，x、y 照 0.01、zoom 照 0.01 四捨五入）。PNG、影片、GIF 的「畫上背景」照同樣的 x、y、zoom 裁。
  // view.waterLook?: { mist: number; mistColor: string; streak: number; glint: number; glintColor: string; ripple: number; lift: number; horizon: number }   // 水鏡的水面樣子（T-825）：mist 霧的濃淡、streak 倒影往下拉長碎成條紋、glint 閃光多寡、ripple 波紋、lift 卡片離水面多高、horizon 地平線高低，都是 0～100 的整數；mistColor 霧（天空與遠處水面）的顏色、glintColor 閃光顏色，#rrggbb。省略＝〔夜色〕預設（和 T-825 以前的水鏡一模一樣；寫出時等於預設就省略整個欄位）；只有 stage 'water' 時畫，其他舞台照存不畫；舞台不進 PNG／影片／GIF。可省略所以舊卡照讀、不用升 formatVersion
  story?: { text: string; font: 'wenkai' | 'huninn' | 'iansui' | 'notoserif' };   // 卡片故事（T-804）：一兩句詩句或設定，舞台不是「沒有」時直排顯示在預覽區卡片兩側；text 去掉前後空白後 1～60 字（含換行，最多 2 行：第 1 行在卡片右邊、第 2 行在左邊，由右往左讀）；font 同文字圖層的四套；省略＝沒有故事（寫出時清空就拿掉欄位；可省略所以舊卡照讀、不用升 formatVersion）；只在工坊裡顯示，PNG、影片、GIF、縮圖都不畫
  kind?: 'card' | 'disc';   // 物件種類（T-810）：省略＝'card'；'disc'＝CD 光碟（照真的 CD：直徑 120、中間孔 15、透明圈到 46、印刷面到 118，單位 mm、只看比例）。只在新卡片時決定、之後不能換；disc 時 aspect 一律 'square'、不能有 customAspect、背面 layers 一定是空的（背面是銀色資料面）、圓角與卡框不畫（欄位照存）；圖層只畫在印刷面圓環裡（破框層可以衝出外緣、孔裡不畫）；可省略所以舊卡照讀、不用升 formatVersion
}

interface Face { layers: Layer[] }   // 陣列依 depth 由小到大排（由後到前）；同 depth 時陣列後面的在前面

interface Layer {
  id: string;
  name: string;            // 1～60 字，預設用檔名
  role: 'base' | 'depth';  // 底圖（可不透明、永遠 depth 0、每面最多一個、在陣列第 0 個）／立體層（必須有透明，或混合模式是加深／發光／強光）
  image: string;           // 圖片雜湊（SHA-256 前 16 碼，小寫十六進位）
  visible: boolean;
  depth: number;           // 立體層 1～100；底圖固定 0。前後順序只看 depth（唯一真相）
  x: number; y: number;    // 圖中心位置；以卡寬為 1；(0,0)＝卡片中心；+x 向右、+y 向上（都以「看著這一面」的方向為準，背面不鏡像）；範圍 -1～1
  scale: number;           // 1＝圖寬等於卡寬；範圍 0.05～4
  holo: boolean;           // 反光層形狀選「用圖層形狀」時，這層算不算亮面（T-417 前是「指定圖層」範圍）
  hasAlpha: boolean;       // 上傳時偵測；false 的圖只能當底圖，或當混合模式是 multiply／screen／add 的立體層
  opacity?: number;        // 不透明度 0～100；省略＝100（T-408；可省略，所以舊卡與舊卡片檔照讀、不用升 formatVersion；寫出時預設值一律省略）；底圖不能有
  blend?: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay' | 'soft-light' | 'color';   // 混合模式；省略＝normal；底圖不能有
  breakout?: boolean;      // 破框（T-411）：true＝這層超出卡片邊緣的部分也畫（同樣的視差與景深陰影；卡片範圍外不畫卡框與其他層；**破框層整層不套鐳射**〔卡內也不套，不然卡邊會看到彩虹斷一截；主對話 2026-10-14 依子代理實測決定〕；在卡片邊緣蓋過內建金屬卡框，連影子也落在卡框上；卡外沒有後面的顏色可混，所以發光／強光層卡外黑色變透明、加深層白色變透明、其他模式照一般疊法）；省略＝false（寫出時省略；可省略所以舊卡照讀、不用升 formatVersion）；底圖不能有；超出的部分只在看得到這一面時畫
  lineart?: boolean;       // 線稿高光（T-802）：true＝這層的深色線條發出鐳射彩虹光（線條強度＝(1−亮度)×alpha，越黑越亮），淺色與白色的地方不發光；只看鐳射強度（holo.strength 0 時不亮），不受反光層形狀影響；破框層不發光（破框層整層不套鐳射）；省略＝false（寫出時省略；可省略所以舊卡照讀、不用升 formatVersion）；有的話必須是 boolean；底圖與文字層不能有（連 false 也不行）
  clip?: boolean;          // 剪裁遮色片（T-803）：true＝這層只畫在「下面那層」有東西的地方（乘那層在同一點的 alpha）。下面那層＝陣列裡往前找第一個 clip 不是 true 的層（好幾層可以剪裁到同一層）；剪裁層的 depth 一律等於下面那層（同一個視差，轉動不錯位；改下面那層的深度時剪裁層跟著改）；下面那層是底圖、或下面沒有層、或任一方是破框層 → 不剪裁（照一般層畫）；剪裁層不投自己的景深陰影；省略＝false（寫出時省略；可省略所以舊卡照讀、不用升 formatVersion）；底圖不能有
  alt?: { image: string; hasAlpha: boolean };   // 雙圖光柵的變身圖（T-805）：轉卡時正對著看是本來的圖，左右任一邊轉超過約 7° 就換成這張（參考 EverettFish lenticular-model，MIT）；畫在同一個中心、同樣的寬（高照它自己的比例）；image 是合格雜湊、圖要在卡片裡（算進每張卡最多 16 張圖、卡片檔照樣打包、圖片回收要保留）；hasAlpha＝false 時同本來的圖的混合模式限制；底圖、文字層、破框層不能有；省略＝沒有變身圖（可省略所以舊卡照讀、不用升 formatVersion）
  fx?: { kind: 'fire' | 'electric' | 'water'; color: string; strength: number; speed: number };   // 局部動態特效（T-811）：在這層的形狀裡流動的火焰／電光／水波（程序圖案，不是粒子）；color #rrggbb、strength 0～100、speed 0～100（整數）；每一面最多 2 層有 fx（第 3 層不收）；破框層不能有；底圖與文字層可以有；省略＝沒有特效（可省略所以舊卡照讀、不用升 formatVersion）
}

**混合模式**（T-408，使用者 2026-10-14：從 Photoshop 27 種挑合適的）：介面名＝正常、加深（色彩增值）、發光（濾色）、強光（線性加亮）、疊色（覆蓋）、柔光、換色（顏色）。公式照 W3C Compositing and Blending Level 1（和 Photoshop 一致），**在 sRGB 數值（0～1）上算**：Cb＝這一層後面已經合成好的顏色、Cs＝這一層的顏色、αs＝這一層的 alpha × opacity/100；Cb、Cs 在 0～1 時結果＝(1−αs)·Cb＋αs·B(Cb, Cs)。**後面的顏色可能超過 1**（鐳射光帶、閃星），非 normal 模式這樣算（T-413）：結果＝(1−αs)·Cb＋αs·(B(夾(Cb), Cs)＋k·(Cb−夾(Cb)))，夾＝夾在 0～1（B 也把 Cs 夾在 0～1），k 每個通道各算：multiply k＝夾(Cs)、screen k＝1−夾(Cs)、其他 k＝1——所以中性色（白加深、黑發光／強光、50% 灰疊色／柔光）完全不改變後面，黑色墨線用加深會擋住後面的亮光。**圖片取樣**：圖片在線性空間預乘 alpha 後才縮小與取樣（取樣後除回 alpha 得到直通顏色，再轉成 sRGB 數值去混合），透明處的顏色不會滲進邊緣變成暗邊。B：normal＝Cs；multiply＝Cb·Cs；screen＝Cb＋Cs−Cb·Cs；add＝min(1, Cb＋Cs)；overlay＝hard-light(Cs, Cb)；soft-light＝W3C soft-light；color＝SetLum(Cs, Lum(Cb))（非分離式）。別的程式（例如 OK_Games）照這個公式畫就會一樣。沒有透明的圖（`hasAlpha=false`）當立體層時只能用 multiply／screen／add（白色或黑色會「消失」，才不會整片蓋住後面）。

interface Frame { enabled: boolean; width: number; color: string; shine: number; style?: 'simple' | 'ornate' }   // style（T-416）：簡約／雕花邊角，省略＝simple、寫出時省略、有的話必須二選一（T-834 新卡框使用者 2026-10-15 決定不做）
   // width＝卡框的平面寬度，以卡寬為 1：0.01～0.08；color #rrggbb；shine 金屬光澤 0～100（0＝素色、50＝預設）
interface Holo { strength: number; bandWidth: number; sparkle: number; palette: HoloPalette; colors: string[]; matte?: number }
// matte＝霧光 0～100，省略＝35（T-417）；舊卡的 scope 由每一面的反光層 Face.foil 取代（讀進來時轉換，寫出時不再有，見下面「反光層」）
interface Face { layers: Layer[]; foil?: Foil }   // foil 省略＝{ shape: 'full', frame: true }
interface Foil { shape: 'full' | 'layers' | 'mask' | 'none'; mask?: string; frame: boolean }
type HoloPalette = 'warm' | 'classic' | 'silver' | 'gold' | 'aurora' | 'galaxy' | 'custom';   // 色彩選項；'custom' 用 colors（剛好 4 個 #rrggbb）
interface Shadow { strength: number; distance: number }   // 景深陰影：濃淡、距離都是 0～100，50＝預設（T-302 的效果），strength 0＝沒有陰影
// strength 0～100（0＝關，閃星也一起關）；bandWidth 0.1～2；sparkle＝閃星多寡 0～100（0＝沒有閃星，閃星只出現在亮面）；兩面都套用同一組鐳射設定；亮面範圍由每一面的反光層決定（T-417）
```

**反光層**（T-417，使用者 2026-10-14：「圖層多一個反光層，沒有被反光層遮住的地方是霧光，反光層預設存在整面」→ 選「上傳遮罩＋用圖層形狀」「霧光＝柔和白色光暈」「反光層取代範圍」）：每一面一個 `Face.foil`，決定哪裡是亮面鐳射、哪裡是霧光。
- `shape`：'full' 整面（預設）；'layers' 用這一面 `Layer.holo` 為 true 的圖層形狀（跟著圖層位置與視差，就是舊的「指定圖層」）；'mask' 用 `mask` 這張黑白圖（亮度＝反光程度，白＝亮面、黑＝霧光；照 cover 拉滿卡面、置中，不跟視差）；'none' 整面霧光。
- `frame`：卡框也反光（卡框打開時才有作用）。
- 亮面＝原本的鐳射（色彩、強度、色帶、閃星照 `holo`）；霧光＝反光層沒蓋到的地方，沒有彩虹，只有很淡的柔和白光帶隨視角滑過，強度 `holo.matte`（0＝完全不反光）。`holo.strength` 0＝兩種都關。破框層（`breakout`）兩種都不套。
- **舊卡轉換**（讀進來時，`holo.scope` 存在且兩面都沒有 `foil`）：'all' → 兩面 `{ shape: 'full', frame: true }`；'layers' → 兩面 `{ shape: 'layers', frame: false }`；'frame' → 兩面 `{ shape: 'none', frame: true }`；轉換後不再寫出 `scope`。
- 驗證：`shape` 四選一；`frame` 是 boolean；`shape` 'mask' 時 `mask` 必須是合法雜湊、而且卡片檔裡有這張圖；`mask` 也算在每張卡最多 16 張圖裡、卡片檔一起打包、刪圖時不能收掉；`matte` 有的話是 0～100 的有限數字。

**卡身厚度**是固定常數（卡寬的 1.5%），不是使用者設定。

**鐳射色彩**（使用者 2026-10-13：「讓使用者自己調，提供幾個選項及顏色表」，T-310）：色譜由 4 個色票漸變（第 1 → 第 4 → 回到第 1），色票表寫在 `src/model/types.ts` 的 `HOLO_PALETTES`：暖陽 warm（粉→橘→金→奶油，新卡預設，接近 Threads 參考影片的粉橘光）、經典彩虹 classic（原演算法的粉→金→藍→白）、銀箔 silver、金箔 gold、極光 aurora、銀河 galaxy、自訂 custom（用 `colors`）。

**文字圖層**（spec §4.1 第 12 項，2026-10-13 提前到第一版；欄位 2026-10-13 定）：就是一個立體層（`role: 'depth'`、`hasAlpha: true`）多一個 `text` 欄位。`image` 是程式依 `text` 畫出來的透明圖（走和上傳一樣的 ingest：WebP、雜湊、存進圖片表）；改文字設定就重畫、換新雜湊。所以 render、陰影、鐳射、在卡上拖曳縮放、復原重做都不用特別處理；卡片檔裡也有畫好的圖，別的程式（例如 OK_Games）沒有字型也能顯示，匯入後 `text` 還在、可以再改。

```ts
interface Layer {
  // …上面的欄位
  text?: TextSpec;         // 有這個欄位＝文字圖層
}

interface TextSpec {
  content: string;         // 1～100 字（含換行 `\n`），去掉前後空白後不能是空的
  font: 'wenkai' | 'huninn' | 'iansui' | 'notoserif';   // 霞鶩文楷 TC／jf open 粉圓／芫荽／思源宋體 TC（public/fonts/，授權見 THIRD_PARTY_NOTICES.md）
  color: string;           // 字的顏色 #rrggbb；style 'seal' 時是印章底色
  align: 'start' | 'center' | 'end';
  vertical: boolean;       // true＝直排（由上到下、由右到左）
  style: 'plain' | 'outline' | 'seal';   // 一般／描邊（自動配深或淺色邊，讓字在圖上看得清楚）／印章（方框色底、白字）
}
```

- 大小用圖層本身的 `scale`（1＝一行字高約 0.1 卡寬），所以在卡上拖角縮放就是改字大小。
- 畫出來的圖（T-306 實作後定）：寬度至少 10 個字高（字水平置中、兩旁透明），這樣 render 把圖寬當 `scale` × 卡寬時，一行字高剛好是 0.1 × scale 卡寬；一行超過約 9 個字時圖會變寬、等於自動縮小放得下。圖的長邊 ≤ 2048 像素（照 §4 匯入上限）。「對齊」只影響多行。選取框與縮圖只框住字本身。
- 新文字圖層的預設：`content`「卡片名稱」、`font` 'wenkai'、`color` #ffffff、`align` 'center'、`vertical` false、`style` 'outline'；`x` 0、`y` 0.55（卡片上方）、`scale` 1；depth 照立體層的自動規則；`name` 用內容的前 20 字（換行與連續空白併成一個空格；使用者自己改過名字後就不再跟著內容變）。
- 驗證（§1.1 追加）：有 `text` 時 role 必須是 'depth'、`hasAlpha` 必須是 true，`text` 每個欄位照上面的型別與範圍；不認得的欄位照樣報錯。
- `formatVersion: 1` 還沒發佈（卡片檔 M4 才做），直接加進第 1 版，不用升版。之後的可省略欄位（`opacity`、`blend`、`breakout`…）也照這條直接加進第 1 版。**轉公開那天第 1 版凍結**：之後再加或改任何欄位都要升 `formatVersion`、保留讀舊版、補相容測試（硬邊界 3；2026-10-14 Codex 審 T-411 時指出舊版讀不了帶新欄位的卡 → 主對話判定公開前不適用，但寫明凍結點）。

### 1.1 驗證（`model/validate.ts`，匯入與載入都要過；寫測試）

- 每個數字欄位 `Number.isFinite` 且在上面的範圍內；字串長度與 `#rrggbb` 格式；`formatVersion === 1`。
- 每張卡用到的圖（兩面圖層＋反光層黑白圖＋變身圖＋舞台背景圖，不重複）最多 16 張（T-417；變身圖 T-805、背景圖 T-814）；每面最多 8 層；最多一個 `base` 且在第 0 個；`base` 的 depth 為 0、`depth` 角色的 depth 1～100；`hasAlpha=false` 的圖當 `depth` 角色時 `blend` 必須是 multiply／screen／add（T-408）；`opacity` 是 0～100 的有限數字；`blend` 七選一；`breakout` 有的話必須是 boolean；`base` 不能有 `opacity`、`blend`、`breakout`。
- `image` 符合 `^[0-9a-f]{16}$` 且圖片存在。
- `holo.palette` 七選一；`holo.colors` 必須是剛好 4 個 `#rrggbb` 的陣列（不是陣列或個數不對整欄報錯）；`shadow.strength`／`distance`、`frame.shine` 都是 0～100。
- 名字（卡名、圖層名）去掉前後空白後不能是空的；`createdAt`／`updatedAt` 要是真的存在的日期時間（2/30 不行）。
- 錯誤清單最多列 50 條，再多就加一條「還有更多錯誤」並停止檢查；訊息裡引用到的不明欄位名截到 40 字。
- `validateCard` 只接受 `JSON.parse` 或 `structuredClone` 的結果（匯入一律先 JSON.parse 再驗）。
- 介面顯示任何名字一律用 `textContent`，禁用 `innerHTML`（匯入的卡片檔可能被改過）。

### 1.2 編輯規則

- 拖拉排序＝交換兩層的 depth 值；深度滑桿改 depth 後重新排序陣列。
- 一次拖曳（滑桿、移動、縮放）＝復原堆疊裡的一步，在放開時提交；復原堆疊至少 50 步。

### 1.3 預設值與自動處理（2026-10-13 M2 展開時定；程式在 `src/model/`）

- **新卡片**：`name`「未命名卡片」、`bodyColor` #1b2033、`cornerRadius` 0.05、兩面都沒有圖層、`frame { enabled: false, width: 0.03, color: '#d8dbe2' }`（銀色，參考卡的細亮框）、`holo { strength: 65, bandWidth: 1, sparkle: 30, palette: 'warm', colors: 暖陽的 4 色 }（不寫 `matte`＝35；兩面不寫 `foil`＝整面反光、卡框也反光）`、`shadow { strength: 50, distance: 50 }`、frame 的 `shine: 50`（強度 2026-10-13 從 40 改 65：實測 40 在深色卡上幾乎看不出反光，65＝原演算法作者的預設）、`view { returnToFront: true, showcase: false, stage: 'desk' }`（T-832c 起；以前是 `'halo'`，已經有的卡不變）。
- **上傳後自動分類**（spec §4.1 第 2 項）：
  - `hasAlpha=false` → **T-703 起一律先問**（DESIGN §4：自動去背／拆成立體層／當底圖或取代底圖／當發光層、當加深層）；選當底圖時：這一面沒有底圖就直接加；已有底圖就回報「要取代嗎」由介面詢問，同意後取代（新底圖用預設擺法重新填滿；新舊圖長寬比可能不同，不沿用舊的 x／y／scale）。T-408 起確認框多兩個選項：「當發光層（黑色變透明）」＝加進來當立體層、`blend: 'screen'`；「當加深層（白色變透明）」＝`blend: 'multiply'`（depth 規則和一般立體層一樣）。
  - `hasAlpha=true` → 立體層：depth＝這一面第一個立體層 50，之後每次＝目前最大 depth＋20（上限 100；同為 100 時陣列後面的在前面）。
  - 每面已有 8 層 → 拒絕（「每一面最多 8 層。」）。
- **圖層預設擺法**：x＝0、y＝0；底圖＝「填滿」（cover：蓋滿卡面，多的裁掉）；立體層＝「放得下」（contain：整張圖都在卡內）。`name`＝檔名去掉副檔名（截到 60 字）；`visible` true；`holo`＝立體層 true、底圖 false。
- **對齊按鈕**：「置中」＝x、y 歸 0；「填滿」＝cover，立體層另外四邊多放大「出血」＝ 2 × depth/100 × MAX_PARALLAX（`src/interact/parallax.ts`）卡寬，轉到任何角度都不露出圖邊。model 不依賴 interact：出血量由呼叫端算好傳進來。
- 換比例（`aspect`）時圖層的 x／y／scale 不變（都以卡寬為單位）。

## 2. 圖片

- 上傳：解碼前檢查檔案 ≤ 30 MB → 解碼 → 最長邊 > 2048 就等比縮到 2048 → 偵測透明（任一像素 alpha < 250 即有透明；寫成對 RGBA 陣列的純函式並測試）→ 編碼 WebP（q≈0.92，保留透明）。
- 瀏覽器編不出 WebP（例如某些 Safari 會靜默退回 PNG）→ 檢查 `blob.type`，不是 `image/webp` 就改存 PNG，副檔名照實際格式。
- 雜湊＝編碼後內容的 SHA-256 前 16 碼；同一張圖只存一份。

## 3. 瀏覽器儲存（IndexedDB，資料庫名 `holocard-studio`，版本 1）

| store | key | 值 |
|---|---|---|
| `cards` | `Card.id` | `Card`＋`thumbnail`（小縮圖 Blob，WebP 品質 0.85、保留透明，編不出 WebP 才存 PNG；給「我的卡片」） |
| `images` | 圖片雜湊 | `{ blob, type: 'image/webp' \| 'image/png', width, height, hasAlpha }` |
| `meta` | 字串 key | 小設定：`'lastOpenedId'` → 上次編輯的卡片 id；`'samplesAdded'` → 已經補過的範例與版本（T-829，JSON 文字 `{ "範例檔名": 版本號 }`〔meta 只存字串〕，只增不減；壞值、不是 `*.holocard` 的鍵、不是正整數的版本都當作沒有；用 `updateMeta` 在同一個交易裡讀、逐鍵取最大、寫回，T-829c）；（舊版的 `'sampleCopy:N'` 已不用：T-605 拿掉 `?card=N`，範例改成隨工坊附上的卡片檔；舊資料庫裡留著也沒關係） |

- 存檔時機：一次拖曳放開或一個動作完成就存；文字輸入停手 1 秒後存；`visibilitychange`（變成隱藏）與 `pagehide` 時立刻存。一次只跑一個存檔，存的過程中又改了就存完再存最新的；存失敗不動記憶體裡的卡（頁首顯示「沒存到」）。存卡前先 `saveImage` 這張卡用到的每張圖。
- 縮圖：`captureCard({ width: 320, transparent: true, pose: 'front' })`，動作停手 2 秒後、換卡與離開前拍一次，轉成 WebP（約 30 KB，PNG 約 290 KB）後跟著 `save(card, thumbnail)` 存（T-407）；舊的 PNG 縮圖下次拍時才換，混在一起沒關係。匯出沒打開的卡時，preview.png 由存著的縮圖轉回 PNG（透明底）。
- 卡片先存、縮圖後補（T-409）：只補縮圖時用 `saveThumbnail(id, updatedAt, blob)`，資料庫那張卡的 `updatedAt` 對得上才只換縮圖、不重寫卡片內容；拍不到縮圖就不寫。
- **一次只有一個分頁能寫**（T-409）：用 Web Locks 拿編輯鎖＋BroadcastChannel 協調；後開的分頁接手，先開的分頁先把卡存好、停掉自動存、才放鎖，然後蓋上遮罩；沒拿著鎖的分頁所有寫入（卡片、圖片、縮圖、meta、刪除）一律拒絕；按〔在這裡繼續〕接手時重新讀卡片庫、開 `lastOpenedId`。瀏覽器沒有 Web Locks 或 BroadcastChannel 就不擋。等鎖的分頁每 2 秒重送一次「要接手」直到拿到鎖（三個分頁也不會漏）；交接只等資料存檔與已經開始的匯入／建範例，正在拍的縮圖直接放掉（T-412）。**重新拿到鎖時記憶體裡有沒存到的版本** → 先另存成新卡「卡名（沒存到的版本）」（新 id、圖先存、不改 `lastOpenedId`），再讀卡片庫；另存也失敗就不重新讀、不收回圖，留在畫面上（換成那張新 id 的卡、清掉復原紀錄），頁首維持「沒存到」＋〔匯出備份〕。失去編輯權時被擋的寫入不算存檔失敗、也不換卡。
- 啟動時讀不到卡片庫或資料庫打不開（和「沒有卡」分開；**有卡片紀錄但一張都讀不出來也算讀不到**，用 `CardStore.hasCards()` 分辨，T-605c）：不建範例副本，給一張只在記憶體的空白卡並說明；這張卡沒改過就不存、不拍縮圖、不改 `lastOpenedId`，改了才當一般卡存。
- 瀏覽器完全不給存（IndexedDB 打不開）時，工坊照樣能用、只存在記憶體，頁首一直顯示「沒存到」＋〔匯出備份〕；只有「有存檔、但這次存失敗」才擋下換卡（避免換卡後舊卡沒存到）。
- 清掉沒用的圖片：**只在刪除整張卡片後、和程式剛啟動時**做（這兩個時間點沒有任何復原堆疊會指到它）；存檔時不清。
- `storage` 模組透過注入的介面存取資料庫，測試用 `fake-indexeddb`（T-101 允許安裝）；升級資料庫版本要寫遷移與測試。
- 容量：存檔前查 `navigator.storage.estimate()`，剩不到 10% 提醒先匯出備份。

## 4. 卡片檔 `.holocard`（對外契約）

zip（`fflate`），內容只能是：

```
card.json                    // Card（formatVersion: 1）
images/<hash>.webp 或 .png   // card.json 用到的每張圖，只放用到的
preview.png                  // 正面縮圖（最長邊 512）
```

匯入（不可信資料，全部通過才寫入）：

1. 壓縮檔 ≤ 200 MB（先看檔案大小，不先讀進記憶體）；解壓**前**讀 zip 的中央目錄看宣告的大小：單檔 ≤ 30 MB、總量 ≤ 300 MB、檔案數 ≤ 18（1 個 card.json＋最多 16 張圖＋preview）。**宣告可能是假的**：解壓時一邊解一邊數（fflate `Inflate` 串流，每次餵 16 KB），實際超過單檔或總量上限立刻中止（T-402，`src/file/zip-read.ts`）。
   - **`card.json` 另有 1 MB 上限**（宣告與實際都算，超過 → `too-large`）：合法的卡片最大不到 64 KB；不設的話 30 MB 的惡意 JSON 會讓 `JSON.parse` 卡十幾秒、吃掉近 1 GB 記憶體（T-402 安全審查）。
   - ZIP64 的特徵（大小 0xffffffff、檔案數 0xffff）會先被上面的大小與檔案數上限擋下，回 `too-large`。
   - 一律當成壞檔（`bad-zip`）：加密（bit 0 或 bit 6）、分割壓縮檔、ZIP64 位置、不壓縮與 DEFLATE 以外的壓縮法、結尾目錄沒接到檔尾、本地檔頭的檔名／壓縮法（沒有 data descriptor 時還有大小與 CRC）和中央目錄不一致、檔與檔的資料重疊、實際解出的大小和宣告不同、CRC-32 不符。
2. 路徑只准 `card.json`、`preview.png`、符合 `^images/[0-9a-f]{16}\.(webp|png)$` 的圖；其他一律拒絕。檔名照原始位元組比對（非 ASCII 一律拒絕）、同名出現兩次也拒絕；檔名超過 64 位元組在轉成字串前就拒絕（合法的最長 28）。**例外**：有不認得的路徑、但 `card.json` 讀得出來而且 `formatVersion` 比程式支援的新 → 回「較新的版本」而不是「不是卡片檔」（新版可能多了新檔案）。
3. `card.json` 要是 UTF-8（可以有 BOM）、只用 `JSON.parse`；`formatVersion` 是有限數字而且大於程式支援的 → 拒絕並說「這張卡是用較新的版本做的」（在 §1.1 驗證之前判斷）；其他都要過 §1.1 驗證。
（T-605）匯入結果多回傳 `preview?: Blob`：只有全部檢查都通過才有，給新卡片面板的範例縮圖用。第一次開啟時匯入、但沒打開的範例（T-605b 的 `addToLibrary`），用這張 preview.png 原樣當卡片庫縮圖（PNG、最長邊 512，經過上面第 4 條的 PNG 檢查；卡片庫與開一包才不會是空白卡，T-808）；之後打開那張卡、停手拍縮圖時照常換成 WebP 縮圖。使用者自己〔匯入卡片檔〕的卡會直接打開，照常拍縮圖。
4. 每張圖**重新計算雜湊**，和檔名不同就拒絕（防止冒充或蓋掉已存的圖）；解碼前讀檔頭確認是 WebP／PNG、和副檔名一致、長寬 1～2048（動畫 WebP 與動畫 PNG〔有 `acTL` 區塊〕都拒絕；VP8X 畫布要和內層圖一樣大）；**檔案大小 ≤ 寬×高×4＋1 MB**（防止 4×4 的小圖塞幾十 MB 的附加區塊）；讀檔頭最多掃 64 個區塊（PNG 掃到第一個 IDAT 為止，WebP 掃 RIFF 區塊），超過就拒絕。卡片沒用到的圖也照樣檢查但不匯入。匯入圖的「有沒有透明」看檔頭宣告（PNG color type 4／6 或 tRNS、WebP 的 alpha 旗標），可能和上傳時看像素算的不同；圖層的透明與否以 card.json 的 `Layer.hasAlpha` 為準。`preview.png` 可以沒有；有的話只檢查是 PNG、長寬 1～2048，不匯入。
5. 通過後給新的 `id` 與時間（不覆蓋現有卡片）。存圖時同雜湊已經存在就保留舊的、不覆蓋（`saveImage` 已經這樣做；雜湊只取 64 位元，攻擊者自己做兩張撞車的圖約要 2^32 次運算，所以不能讓新圖蓋掉舊圖）。

匯出：用和匯入一樣的檢查與上限（card.json ≤ 1 MB、單檔 ≤ 30 MB、總量 ≤ 300 MB、產出的檔 ≤ 200 MB、每張圖過第 4 條），超過就丟錯（畫面說明哪裡太大），確保匯出的檔一定能匯入。

### 4.1 讀卡程式支援分級（T-846，2026-10-15 主對話定；公開凍結第 1 版前可再調）

分級是「讀卡程式要畫出多少」的能力分級，**不改變**欄位的必填性與驗證規則；「可忽略」不代表可以刪掉原始資料或它引用的圖片（讀進來再寫出時要原樣保留）。`Face` 指 `front`／`back` 兩面；`Layer` 指兩面的每一層。

| 分級 | 欄位 |
|---|---|
| 必須 | `formatVersion`、`id`、`name`、`createdAt`、`updatedAt` |
| 必須 | `kind`、`aspect`、`customAspect.width`／`height`、`bodyColor`、`cornerRadius` |
| 必須 | 兩面的 `layers`（照陣列順序與深度規則畫） |
| 必須 | `Layer.id`、`name`、`role`、`image`、`visible`、`depth`、`x`、`y`、`scale`、`hasAlpha`、`opacity`、`blend` |
| 必須 | `frame.enabled`、`width`、`color` |
| 建議 | `frame.shine`、`style` |
| 建議 | `holo.strength`、`bandWidth`、`sparkle`、`palette`、`colors`、`matte`；`Layer.holo` |
| 建議 | `Face.foil.shape`、`mask`、`frame` |
| 建議 | `shadow.strength`、`distance` |
| 建議 | `Layer.breakout`、`clip`、`lineart` |
| 建議 | `Layer.alt.image`、`hasAlpha` |
| 建議 | `Layer.fx.kind`、`color`、`strength`、`speed` |
| 建議 | `Layer.text.content`、`font`、`color`、`align`、`vertical`、`style`（`image` 已是畫好的字，讀卡程式可以只當一般圖片畫） |
| 可忽略 | `view.returnToFront`、`showcase`、`stage`、`sleeve`、`backdrop`、`waterScene` |
| 可忽略 | `view.foreground.*`、`view.farPan.*`、`view.waterLook.*` |
| 可忽略 | `story.text`、`font` |

全功能固定資料：`tests/fixtures/full-feature-card.json`（一張自訂比例卡＋一張光碟，合起來用到 §1 的每個欄位），`tests/file-holocard-full.test.ts` 驗證它、匯出再匯入後只有 `id`／時間不同，並對 `Card` 型別的欄位清單做快照——**新增欄位時快照測試會失敗，必須同步更新本表與固定資料**。

## 5. 匯出的其他檔案

- 「畫上舞台的遠景」（T-842）只是那一次匯出的選項，不存進 Card 或 `.holocard`，不變更 `formatVersion`。
- 「連舞台一起錄」（T-850）也只是那一次匯出的選項，不存進 Card 或 `.holocard`；勾了時影片 1280×720、GIF 寬 480／600／720（16:9），其他固定設定（格數、秒數、每格時間、調色盤）照下面不變；GIF 預估試編寬 480 與 720 各 8 格。

| 檔案 | 內容 |
|---|---|
| `<卡名>.png` | 目前角度；輸出畫布固定寬 1500 px（卡寬約 1000 px）；可選透明背景 |
| `<卡名>.webm` | 轉一圈或左右擺動（T-511），長度 4／8／12 秒（＝1～3 個來回，T-509b），可配一段音樂（Opus 音軌，只在匯出時用、不存進卡片，T-509）；離屏逐格渲染；**瀏覽器內建 WebCodecs `VideoEncoder`（VP9，不支援就 VP8）＋自己寫的最小 WebM 封裝**（每格時間戳＝i／fps、寫入 Duration；不靠實際經過的時間，所以長度準、比即時快、切分頁不受影響；2026-10-14 主對話實測 `MediaRecorder` 開頭會吃掉約 0.5 秒、電腦忙時只剩 2.3 秒 → 改掉）；瀏覽器沒有 WebCodecs 就請使用者改用 GIF；限制：iPhone 與部分社群平台播不了 WebM（所以另有 GIF，T-514 起另有 MP4、影片選項預設 MP4） |
| `<卡名>.gif` | 轉一圈或左右擺動（T-511），固定 4 秒、沒有聲音；離屏逐格渲染（固定步進，不受分頁切換影響），`gifenc`；寬度讓使用者選 320／400／480（第一次預設 400），選項旁顯示預估檔案大小（T-512；上限 480；勾「連舞台一起錄」時寬 480／600／720、上限 720，T-850：編碼器的 `GIF_MAX_WIDTH`＝720，舊入口 `TURNTABLE.gifWidth` 固定 480）。預估（T-512b 改）：打開選項時用這張卡、選的動作，寬 480 與 320 各拍 8 格實際編一次（寬的先拍，拍完馬上編、同時拍下一個），假設每格大小和寬度的 k 次方成正比、用兩點算 k 再內插到選的寬度，× 80 格；只有一筆時照像素數推；顯示用 1 MB＝1024² 位元組；實測純色、漸層、範例卡 × 標準／塔羅 × 轉一圈／擺動都在 ±11% 內（只照像素數推時純色卡會高估 33%）；打開到三個數字出來約 0.7 秒 |
| `<卡名>.mp4` | （T-513 錄影模組、T-514 接到匯出選單；BACKLOG「MP4 匯出」，使用者睡前授權做）和 `.webm` 同樣的動作、長度、配樂、離屏逐格；**WebCodecs `VideoEncoder` 的 H.264**（依序試 High／Main／Baseline）＋**`AudioEncoder` 的 AAC-LC**（不支援就 Opus）＋自己寫的 MP4 封裝（moov 在 mdat 前面，邊下載邊能播；長度＝格數／fps；音訊前置延遲用 edit list 扣掉）；目的：iPhone 與社群平台都能播 |

轉動的固定設定（T-504，`src/app/files.ts`）：一個來回 4 秒、80 格；左右擺動幅度由使用者輸入 5～60°、預設 30°（先往左）；俯仰 −8°（稍微從上往下看）、`startTime` 0、`timeSpan`＝最接近 4 秒的閃星週期整數倍（GIF 循環接縫不跳）；WebM 寬 720、每秒 20 格；GIF 寬由使用者選（預設 400）、每格 50 毫秒、全部格共用一組調色盤。月夜卡實測：WebM 約 2.5 MB、GIF 寬 480 轉一圈約 8.5 MB。
