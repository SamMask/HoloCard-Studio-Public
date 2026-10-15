// 卡片資料型別（SCHEMA.md §1 的程式版）。這是 model 對其他模組的契約：改欄位要同一輪改 SCHEMA。
// model 只放純資料與純函式，不碰 DOM、three.js、IndexedDB。

export type FaceSide = 'front' | 'back';
/** 卡片比例（T-807 加正方形、明信片、自訂）：高／寬一律用 model/aspect.ts 的 aspectHeight 算。 */
export type Aspect = 'standard' | 'tarot' | 'square' | 'postcard' | 'custom';
/** 有固定比例的四種（自訂以外）。 */
export type PresetAspect = Exclude<Aspect, 'custom'>;
export type LayerRole = 'base' | 'depth';

export interface Layer {
  id: string;
  /** 1～60 字，預設用檔名。 */
  name: string;
  role: LayerRole;
  /** 圖片雜湊：SHA-256 前 16 碼小寫十六進位。 */
  image: string;
  visible: boolean;
  /** 底圖固定 0；立體層 1～100。前後順序只看 depth。 */
  depth: number;
  /** 圖中心位置，以卡寬為 1，(0,0)＝卡片中心，+x 右、+y 上（看著這一面），範圍 -1～1。 */
  x: number;
  y: number;
  /** 1＝圖寬等於卡寬；0.05～4。 */
  scale: number;
  /** 反光層選「用圖層形狀」時，這層要不要反光（T-417 以前是鐳射範圍的「指定圖層」）。 */
  holo: boolean;
  /** 上傳時偵測；false 的圖只能當底圖，或當混合模式是 multiply／screen／add 的立體層（T-408）。 */
  hasAlpha: boolean;
  /** 有這個欄位＝文字圖層（SCHEMA §1「文字圖層」）：image 是程式依它畫出來的圖。 */
  text?: TextSpec;
  /** 不透明度 0～100（T-408）；省略＝100。底圖固定 100（不寫這個欄位）。 */
  opacity?: number;
  /** 混合模式（T-408）；省略＝'normal'。底圖固定 normal（不寫這個欄位）。公式見 SCHEMA §1「混合模式」。 */
  blend?: BlendMode;
  /**
   * 破框（T-411）：true＝這層超出卡片邊緣的部分也畫（一樣有視差，卡片範圍外不畫鐳射與卡框）；
   * 省略＝false（寫出時省略）。底圖不能有。只有正面看得到超出的部分，轉到背面時不畫。
   */
  breakout?: boolean;
  /**
   * 線稿高光（T-802）：true＝這層的深色線條發出鐳射彩虹光（線條強度＝(1−亮度)×alpha，越黑越亮），淺色與白色不發光；
   * 只看鐳射強度（holo.strength 0 不亮），和反光層形狀無關；破框層不發光。省略＝false（寫出時省略）。底圖與文字層不能有。
   */
  lineart?: boolean;
  /**
   * 剪裁遮色片（T-803）：true＝這層只畫在「下面那層」有東西的地方（乘那層在同一點的 alpha）。下面那層＝陣列裡往前找
   * 第一個 clip 不是 true 的層（actions.ts 的 clipParent）；depth 一律等於下面那層；下面是底圖、沒有下面、任一方破框 → 不剪裁
   * （照一般層畫）；剪裁層不投景深陰影。省略＝false（寫出時省略）。底圖不能有。
   */
  clip?: boolean;
  /**
   * 雙圖光柵的變身圖（T-805）：轉卡時正對著看是本來的圖（image），左右任一邊轉超過約 7° 就換成這張
   * （render/lenticular.ts；參考 EverettFish lenticular-model，MIT）；畫在同一個中心、同樣的寬（高照它自己的比例）。
   * 只有立體層能有（底圖、文字層、破框層不能有，連空的也不行）；圖算進每張卡最多 16 張圖（model/foil.ts 的 cardImages）。
   * alt.hasAlpha false 時同本來的圖的混合模式限制（actions.ts 的 blendAllowed 兩張一起看）。省略＝沒有變身圖。
   */
  alt?: LayerAlt;
  /**
   * 局部動態特效（T-811，SCHEMA Layer.fx?）：在這層的形狀裡流動的火焰／電光／水波（TSL 程序圖案，render/fx-nodes.ts）；
   * 範圍＝這層的 alpha（含剪裁、雙圖光柵混好的 alpha），跟著這層的深度與視差。每一面最多 MAX_FX_PER_FACE 層有特效；
   * 破框層不能有；底圖與文字層可以有。省略＝沒有特效（寫出時省略）。規則在 model/fx.ts。
   */
  fx?: LayerFx;
}

/** 動態特效的種類（T-811）：火焰、電光、水波。 */
export type FxKind = 'fire' | 'electric' | 'water';

/** 動態特效（T-811，SCHEMA Layer.fx?）：color #rrggbb、strength 0～100、speed 0～100（整數）。 */
export interface LayerFx {
  kind: FxKind;
  color: string;
  strength: number;
  speed: number;
}

/** 變身圖（T-805，SCHEMA Layer.alt?）：圖片雜湊＋有沒有透明（同 Layer 的 image／hasAlpha）。 */
export interface LayerAlt {
  image: string;
  hasAlpha: boolean;
}

/**
 * 圖層混合模式（T-408，使用者 2026-10-14 請主對話從 Photoshop 的 27 種挑合適的）：
 * normal 正常、multiply 加深（色彩增值）、screen 發光（濾色）、add 強光（線性加亮）、
 * overlay 疊色（覆蓋）、soft-light 柔光、color 換色（顏色）。
 */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay' | 'soft-light' | 'color';

export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen', 'add', 'overlay', 'soft-light', 'color'];

/** 沒有透明的圖（hasAlpha false）當立體層時只能用這幾種：黑色或白色會「消失」，才不會整片蓋住後面。 */
export const OPAQUE_LAYER_BLENDS: readonly BlendMode[] = ['multiply', 'screen', 'add'];

export type TextFont = 'wenkai' | 'huninn' | 'iansui' | 'notoserif';
export type TextAlign = 'start' | 'center' | 'end';
export type TextStyle = 'plain' | 'outline' | 'seal';

export interface TextSpec {
  /** 1～100 字（含換行），去掉前後空白後不能是空的。 */
  content: string;
  font: TextFont;
  /** #rrggbb；style 'seal' 時是印章底色。 */
  color: string;
  align: TextAlign;
  /** true＝直排。 */
  vertical: boolean;
  style: TextStyle;
}

/**
 * 反光層的形狀（T-417，使用者 2026-10-14）：
 * 'full' 整面亮面鐳射（預設）；'layers' 用這一面勾了 `Layer.holo` 的圖層形狀（跟著圖層位置與視差）；
 * 'mask' 用上傳的黑白圖（白＝反光、黑＝霧光，照 cover 拉滿卡面）；'none' 整面霧光。
 */
export type FoilShape = 'full' | 'layers' | 'mask' | 'none';

/** 反光層（T-417）：每一面一個，決定哪裡是亮面鐳射、哪裡是霧光。`Face.foil` 省略＝{ shape: 'full', frame: true }。 */
export interface Foil {
  shape: FoilShape;
  /** shape 'mask' 時必填：黑白圖的雜湊（和一般圖片一樣存、一樣算在每張卡最多 16 張圖裡）；其他形狀時可以保留（切回 mask 還在）。 */
  mask?: string;
  /** 卡框也反光（卡框打開時才有作用）。 */
  frame: boolean;
}

export interface Face {
  /** 依 depth 由小到大（由後到前）；同 depth 時陣列後面的在前面。底圖（若有）在第 0 個。 */
  layers: Layer[];
  /** 反光層（T-417）；省略＝整面反光、卡框也反光。 */
  foil?: Foil;
}

export interface Frame {
  enabled: boolean;
  /** 卡框平面寬度，以卡寬為 1：0.01～0.08。 */
  width: number;
  /** #rrggbb */
  color: string;
  /** 金屬光澤 0～100：0＝素色、50＝預設（T-303 的效果）、100＝很亮。 */
  shine: number;
  /** 樣式（T-416）：'simple' 簡約（現在的）、'ornate' 雕花邊角（四角加原創金屬浮雕花紋，跟著框色與光澤）；省略＝'simple'（寫出時省略）。 */
  style?: FrameStyle;
}

export type FrameStyle = 'simple' | 'ornate';

export type HoloPalette = 'warm' | 'classic' | 'silver' | 'gold' | 'aurora' | 'galaxy' | 'custom';

/**
 * 鐳射設定（兩面共用）。T-417 拿掉舊的範圍 `scope`（由每一面的反光層 `Face.foil` 取代）：
 * 舊卡讀進來時由 model/foil.ts 的 migrateCard 轉換（'all' → 兩面整面＋卡框、'layers' → 用圖層形狀、卡框不反光、
 * 'frame' → 整面霧光、卡框反光），之後不再寫出。
 */
export interface Holo {
  /** 0～100，0＝關（閃星、霧光也一起關）。 */
  strength: number;
  /** 0.1～2 */
  bandWidth: number;
  /** 閃星多寡 0～100，0＝沒有。 */
  sparkle: number;
  /** 霧光（T-417）：反光層沒蓋到的地方的柔和白色光暈 0～100，0＝完全不反光；省略＝35。兩面共用。 */
  matte?: number;
  /** 色彩選項（SCHEMA §1「鐳射色彩」）；'custom' 時用 colors。 */
  palette: HoloPalette;
  /** 自訂色彩：剛好 4 個 #rrggbb（色譜由第 1 色漸變到第 4 色）。不是 custom 時也保留，切回 custom 時還在。 */
  colors: string[];
}

/** 景深陰影（使用者可調）。50＝預設（T-302 的效果）。 */
export interface Shadow {
  /** 濃淡 0～100：0＝沒有陰影、100＝預設的兩倍濃。 */
  strength: number;
  /** 距離 0～100：0＝貼著、100＝預設的兩倍遠。 */
  distance: number;
}

/** 卡片下方的舞台特效（T-314）：'halo' 全息光環（預設）、'none' 沒有。只在工坊裡顯示，擷取與匯出不畫。 */
/** 'gallery'＝展示廳（T-410）：金屬圓台、地板倒影、浮著卡片庫其他卡的縮圖、光柱、飄落花瓣。 */
/** T-415：'magic' 旋轉魔法陣、'water' 水鏡倒影、'nebula' 星雲漩渦。 */
/** T-832：'desk' 工作桌（卡片插在透明壓克力展示座上、放在木桌上，整座跟著卡片轉；照 T-415 的先例不升 formatVersion）。 */
export type StageStyle = 'halo' | 'gallery' | 'magic' | 'water' | 'nebula' | 'desk' | 'none';

/** 水鏡的遠景（T-815）：湖光山峰、水墨山、富士山（畫好的圖在 public/stages/water-*.webp，不進卡片檔）。 */
export type WaterScene = 'lake' | 'ink' | 'fuji';

export interface CardView {
  returnToFront: boolean;
  showcase: boolean;
  stage: StageStyle;
  /**
   * 透明卡套（T-806，SCHEMA view.sleeve?）：true＝卡片外面套一層透明塑膠（比卡大一圈、有厚度，邊緣與斜看時反光）。
   * 省略＝false（寫出時省略；關掉時拿掉欄位，不寫 undefined）。工坊裡照開關畫；PNG、影片、GIF 由匯出選單的「包含卡套」決定；
   * 卡片庫縮圖不畫。
   */
  sleeve?: boolean;
  /**
   * 舞台背景圖（T-814，SCHEMA view.backdrop?）：圖片雜湊（圖要在卡片裡）。工坊預覽區鋪在卡片後面、取代舞台的遠景（前景照舊）；
   * PNG、影片、GIF 由匯出選單的「畫上背景」決定；卡片庫縮圖不畫。算進每張卡最多 16 張圖（model/foil.ts 的 cardImages）。
   * 省略＝沒有（寫出時省略；拿掉時拿掉欄位，不寫 undefined）。只能用 actions.ts 的 setBackdrop 改（updateCard 的 view 不動它）。
   */
  backdrop?: string;
  /**
   * 水鏡的遠景（T-815，SCHEMA view.waterScene?）：省略＝'lake'（選回湖光山峰時拿掉欄位、寫出時 'lake' 省略）。
   * 只有舞台是水鏡時畫，其他舞台照存不畫；有 backdrop 時被背景圖取代（欄位照存）。用 updateCard 的 view 改（每次切換一步）。
   */
  waterScene?: WaterScene;
  /**
   * 遠景的位置與大小（T-822，SCHEMA view.farPan?）：套在預覽區看得到的那張遠景（自己的背景圖，或水鏡的遠景圖）；
   * 匯出的「畫上背景」也照它裁。省略＝{ x: 0, y: 0, zoom: 1 }（回到這個值時拿掉欄位、寫出時省略）。
   * 讀用 actions.ts 的 farPanOf；改用 updateCard 的 view.farPan（只給要改的欄位、夾範圍、照 0.01 四捨五入）。
   */
  farPan?: FarPan;
  /**
   * 水鏡的水面樣子（T-825，SCHEMA view.waterLook?）：省略＝〔夜色〕預設（limits.ts 的 DEFAULT_WATER_LOOK＝T-825 以前的水鏡；
   * 回到預設時拿掉欄位、寫出時省略）。只有舞台是水鏡時畫，其他舞台照存不畫。
   * 讀用 actions.ts 的 waterLookOf；改用 updateCard 的 view.waterLook（只給要改的欄位、夾範圍、四捨五入成整數、顏色存小寫）。
   */
  waterLook?: WaterLook;
  /**
   * 前景圖（T-830，SCHEMA view.foreground?）：預覽區疊在卡片前面的一張圖（滑鼠穿過它）；PNG、影片、GIF 勾「畫上背景」時一起畫；
   * 卡片庫縮圖、卡片檔預覽圖不畫。圖算進每張卡最多 16 張（model/foil.ts 的 cardImages）。省略＝沒有（拿掉時拿掉欄位，不寫 undefined）。
   * 加、換、拿掉用 actions.ts 的 setForeground；位置、大小、模糊用 updateCard 的 view.foreground（只給要改的欄位，image 不理）；
   * 讀用 foregroundOf。
   */
  foreground?: Foreground;
}

/**
 * 前景圖（T-830）：image＝圖片雜湊（圖要在卡片裡）；x、y 是 −1～1（0＝圖的中心在畫面正中間；±1＝在左／右〔下／上〕邊上，
 * y 往上是正的）；scale 0.5～3（1＝圖的長邊是畫面高的 FOREGROUND_BASE 倍）；blur 0～100 的整數（相機景深那種模糊）。
 * 預覽區 CSS 那層與匯出共用 render/backdrop.ts 的 foregroundRect／foregroundCss（照畫面的寬高比例擺，同一個焦點）。
 */
export interface Foreground {
  image: string;
  x: number;
  y: number;
  scale: number;
  blur: number;
}

/**
 * 水鏡的水面樣子（T-825）：六個 0～100 的整數＋兩個 #rrggbb。
 * mist 霧的濃淡、streak 倒影往下拉長碎成條紋、glint 倒影裡靠近卡片的閃光多寡、ripple 波紋（漣漪與細波紋）、
 * lift 卡片下緣離水面多高、horizon 地平線高低（0＝貼近水面、落在卡片腳邊；100＝卡片中間高度）；
 * mistColor 霧（天空與遠處水面）的顏色、glintColor 閃光的顏色。怎麼畫在 render/water-layout.ts。
 */
export interface WaterLook {
  mist: number;
  mistColor: string;
  streak: number;
  glint: number;
  glintColor: string;
  ripple: number;
  lift: number;
  horizon: number;
}

/**
 * 遠景的位置與大小（T-822）：x、y 是 −1～1（0＝置中；−1／1＝圖的左／右〔上／下〕邊對齊畫面邊：
 * cover 之後「多出來的部分」的比例，所以任何畫面寬高比都不露空白）；zoom 是 1～3（1＝剛好蓋滿）。
 * 水鏡時 y 不用（遠景下緣貼水平線）、放大以下緣為基準。算法在 render/backdrop.ts 的 farPanRect。
 */
export interface FarPan {
  x: number;
  y: number;
  zoom: number;
}

/**
 * 卡片故事（T-804，SCHEMA Card.story?）：一兩句詩句或設定，舞台不是「沒有」時直排顯示在預覽區卡片兩側
 * （第 1 行在右邊、第 2 行在左邊，由右往左讀）。只在工坊裡顯示，PNG、影片、GIF、縮圖都不畫。
 */
export interface CardStory {
  /** 去掉前後空白後 1～60 字（含換行），最多 2 行（actions.ts 的 cleanStory 整理）。 */
  text: string;
  /** 同文字圖層的四套字型。 */
  font: TextFont;
}

/** 自訂比例的寬與高（T-807，SCHEMA Card.customAspect?）。 */
export interface CustomAspect {
  width: number;
  height: number;
}

/**
 * 物件種類（T-810，SCHEMA Card.kind?）：'card' 卡片（預設）、'disc' CD 光碟（圓形、中間有孔，照真的 CD 的比例；
 * 印刷面＝正面放圖層、背面是銀色資料面〔不放圖層〕）。只在新卡片時決定、之後不能換。
 */
export type CardKind = 'card' | 'disc';

export interface Card {
  formatVersion: 1;
  id: string;
  /** 1～60 字。 */
  name: string;
  createdAt: string;
  updatedAt: string;
  aspect: Aspect;
  /** aspect 'custom' 時必填（T-807）：使用者輸入的寬與高（整數 1～999，只看比例；高／寬 0.5～2.0）；其他比例時沒有這個欄位。 */
  customAspect?: CustomAspect;
  /** #rrggbb */
  bodyColor: string;
  /** 以卡寬為 1：0～0.12。 */
  cornerRadius: number;
  front: Face;
  back: Face;
  frame: Frame;
  holo: Holo;
  shadow: Shadow;
  view: CardView;
  /** 卡片故事（T-804）；省略＝沒有故事（清空時拿掉欄位，不寫 undefined）。 */
  story?: CardStory;
  /**
   * 物件種類（T-810）：省略＝'card'（寫出時明寫的 'card' 拿掉）。'disc' 時 aspect 一律 'square'、沒有 customAspect、
   * back.layers 一定是空的；圓角、卡框、卡套不畫（欄位照存）。判斷用 model/aspect.ts 的 isDisc。
   */
  kind?: CardKind;
}

/** 鐳射色彩選項的 4 個色票（SCHEMA §1「鐳射色彩」）。色譜由第 1 色漸變到第 4 色再回到第 1 色。 */
export const HOLO_PALETTES: Record<Exclude<HoloPalette, 'custom'>, readonly [string, string, string, string]> = {
  warm: ['#ff6b9d', '#ff9f5a', '#ffd36b', '#fff4e0'],
  classic: ['#ff529e', '#ffd952', '#389eff', '#ffffff'],
  silver: ['#c9d3e0', '#ffffff', '#9fb0c6', '#eef3fa'],
  gold: ['#b8862b', '#ffd76a', '#fff1c1', '#e0a940'],
  aurora: ['#39ffc3', '#4aa8ff', '#b26bff', '#ff7ad9'],
  galaxy: ['#6b4dff', '#2fd0ff', '#ff6bd6', '#ffffff'],
};

/** 預設比例的高／寬（以卡寬為 1）。程式裡要卡高一律用 model/aspect.ts 的 aspectHeight（自訂也算在裡面）。 */
export const ASPECT_HEIGHT: Record<PresetAspect, number> = {
  standard: 88 / 63,
  tarot: 120 / 70,
  square: 1,
  postcard: 148 / 100,
};

export const MAX_LAYERS_PER_FACE = 8;

/** 每一面最多幾層有動態特效（T-811，SCHEMA Layer.fx?；第 3 層不收）。 */
export const MAX_FX_PER_FACE = 2;
