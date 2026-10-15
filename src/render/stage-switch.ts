// 舞台主題的切換（T-410、T-415，SCHEMA view.stage）：全息光環（stage-fx.ts）／展示廳（gallery-fx.ts）／魔法陣（magic-fx.ts）／
// 水鏡（water-fx.ts）／星雲（nebula-fx.ts）／工作桌（desk-fx.ts，T-832：壓克力展示座跟著卡片一起轉）／關閉。
// 一次只有一種舞台在場景裡：換主題時舊的整組拿掉並釋放（網格、材質、貼圖、倒影的 render target），新的才建立；
// 關閉＝什麼都不建。卡片的比例、角度、減少動態效果、展示廳的縮圖清單都記在這裡，新建的舞台一建好就套上。
// 擷取（PNG、縮圖、轉動匯出）用 hidden(fn)：整組暫時不畫。
// 取景（stageReach）：只有展示廳、水鏡要鏡頭多退一點（台子、倒影才看得到）；其他主題不影響取景。
//
// 舞台遠景的接點（T-814；T-815 水鏡遠景、T-816 展示廳大廳、T-817 星雲漩渦都接在這裡）：setBackdrop(遠景 | null) 記住、
// 交給目前的舞台，換主題時新建的舞台一建好也交給它。每種舞台自己決定怎麼用（StagePart.setBackdrop 可以不寫＝不用 3D 換）：
//   - null＝用自己本來的遠景（T-815～T-817 會把本來的換成畫好的圖）；
//   - 有圖＝換成這張：水鏡畫成水平線上方的遠景平面（倒影裡也有）、星雲讓出漩渦與星際霧（光暈、星點照舊）；
//     全息光環、展示廳、魔法陣、關閉的遠景本來就是預覽區的 CSS 那層（ui/stage.ts 換成背景圖），3D 不用動；
//     工作桌（T-832）的木桌也是 CSS 那層，有背景圖時 3D 只把桌面（影子、倒影）讓出來，展示座照畫。
// 水鏡的三種遠景（T-815）：setWaterScene(遠景 | null) 記住、只交給水鏡（WaterPart.setScene；換到水鏡時新建的一建好、在背景圖之後給）。
// 水鏡自己決定畫哪張：自己的背景圖優先，沒有才畫遠景（water-layout.ts 的 waterFar）；其他舞台收不到。
// 貼圖由 card-view 建立與釋放（同一張圖只建一次）；舞台只拿來畫，不釋放它。
// 遠景的位置與大小（T-822）：setFarPan(位置) 記住、只交給水鏡（WaterPart.setFarPan；換到水鏡時新建的一建好、在遠景圖之前給，
// 第一次排版就照位置）。其他舞台的遠景在 CSS 那層（ui/stage.ts 照同一個算法擺），3D 不用動。
// 展示廳畫好的大廳（T-816）：大廳圖在 CSS 那層（ui/stage.ts）；setGalleryHall(讀好了沒) 記住、只交給展示廳（GalleryPart.setHall；
// 換到展示廳時新建的一建好就給）：讀好之後展示廳把石地板換成只疊倒影與光的大廳地板、光柱變淡。
// 水鏡的水面樣子（T-825）：setWaterLook(樣子) 記住、只交給水鏡（WaterPart.setLook；換到水鏡時新建的一建好、在遠景之前給，
// 遠景平面第一次排版就照水面高度）。〔地平線〕的鏡頭在 card-view，取景（stageReach）不變：卡片在畫面上的位置與大小不動。
// 星雲畫好的漩渦大圖（T-817）：setNebulaSwirl(大圖 | null) 記住、只交給星雲（NebulaPart.setSwirl；換到星雲時新建的一建好、在背景圖之後給）。
// 有自己的背景圖時 main 給 null（card-view 釋放貼圖），星雲照 setBackdrop 的 far＝0 讓出遠景；貼圖歸 card-view 管，星雲不釋放。
// 連舞台一起錄（T-850）：capture() 開一份擷取用的舞台動態（StagePart.forkMotion：從頭開始的時間、轉角、能量…），
// step(角度, dt, draw) 每格換成那一份、角度設成這一格、走 dt 秒、畫，畫完換回畫面那份、角度放回畫面的——
// 預覽的動畫不跳也不被擷取帶著走；同樣的步驟走出同樣的畫面（影片與 GIF 不受電腦快慢影響）。工作桌沒有會動的東西，只跟著角度轉。

import { Group, type Object3D, type Texture } from 'three/webgpu';
import { DEFAULT_WATER_LOOK } from '../model/limits';
import type { FarPan, StageStyle, WaterLook } from '../model/types';
import { DEFAULT_CARD_H } from './fit';
import { galleryReach } from './gallery-layout';
import { waterReach } from './water-layout';

/** 舞台的遠景圖（T-814）：已經建好的貼圖（sRGB）＋原圖寬高（算 cover 用）。貼圖歸 card-view 管，舞台不釋放。 */
export interface StageBackdrop {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
}

/** 擷取用的一份舞台動態（T-850）：swap() 和舞台目前用的那份互換並重寫 uniform（不建新物件）；換進來之後 setPose／update 都動它，再 swap() 一次換回去。 */
export interface MotionFork {
  swap(): void;
}

/** 一種舞台：放進場景的一組物件＋每影格的更新＋釋放。 */
export interface StagePart {
  readonly group: Object3D;
  /** 卡高（aspectHeight，卡寬＝1）：舞台放在卡片下緣下面，比例改了跟著移。 */
  setCardHeight(cardH: number): void;
  setReducedMotion(reduced: boolean): void;
  setPose(yawDeg: number, pitchDeg: number): void;
  update(dt: number): void;
  /**
   * 遠景換成這張圖（T-814）；null＝用自己本來的遠景。沒寫＝這種舞台的遠景在 CSS 那層（3D 不用換）。
   * 同一張再呼叫不做事；換主題時新建的舞台一建好就會收到目前的遠景。
   */
  setBackdrop?(backdrop: StageBackdrop | null): void;
  /**
   * 擷取用的動態（T-850）：另一份從頭開始的動態（時間 0、沒有轉速），回傳互換的開關（見 MotionFork）。
   * 沒寫＝沒有會隨時間動的東西（工作桌）。
   */
  forkMotion?(): MotionFork;
  /** 釋放這組用到的 GPU 資源（呼叫後不再使用）。 */
  dispose(): void;
}

/** 擷取時的舞台（T-850，StageSwitch.capture）。 */
export interface StageCapture {
  /**
   * 用擷取那份動態走一格：角度＝yaw／pitch（工作桌的展示座也擺成這個角度）、走 dt 秒（≤ 0＝只記角度），有 draw 就在這個狀態下畫；
   * 最後換回畫面那份、角度放回畫面的（含丟例外）。舞台關閉或已經換了主題（建立時那組已釋放）：只畫。
   */
  step<R>(yawDeg: number, pitchDeg: number, dt: number, draw?: () => R): R | undefined;
}

/** 展示廳多一個：浮在兩側的縮圖；畫好的大廳讀好了沒（T-816；沒寫＝不管）。 */
export interface GalleryPart<T> extends StagePart {
  setThumbs(thumbs: readonly T[]): void;
  setHall?(shown: boolean): void;
}

/** 星雲多一個：畫好的漩渦大圖（T-817；null＝還沒讀好、讀不到、用不到 → 照程式漩渦畫）。沒寫＝不管。 */
export interface NebulaPart extends StagePart {
  setSwirl?(swirl: StageBackdrop | null): void;
}

/** 水鏡多三個：這張卡選的遠景圖（T-815；null＝沒有）、遠景的位置與大小（T-822）、水面樣子（T-825）。 */
export interface WaterPart extends StagePart {
  setScene(scene: StageBackdrop | null): void;
  setFarPan(pan: FarPan): void;
  setLook(look: Readonly<WaterLook>): void;
}

export interface StageMakers<T> {
  halo(): StagePart;
  gallery(): GalleryPart<T>;
  magic(): StagePart;
  water(): WaterPart;
  nebula(): NebulaPart;
  desk(): StagePart;
}

export interface StageSwitch<T> {
  /** 放進場景的容器（renderOrder −1：整組比卡片先畫）。 */
  readonly group: Group;
  /** 目前顯示的主題（還沒設定＝null）。 */
  style(): StageStyle | null;
  setStyle(style: StageStyle): void;
  /** 卡高（aspectHeight，卡寬＝1）：舞台放在卡片下緣下面，比例改了跟著移。 */
  setCardHeight(cardH: number): void;
  setReducedMotion(reduced: boolean): void;
  setPose(yawDeg: number, pitchDeg: number): void;
  update(dt: number): void;
  /** 展示廳兩側浮著的縮圖（記住；切到展示廳時才用）。 */
  setThumbs(thumbs: readonly T[]): void;
  /** 舞台遠景（T-814，見檔頭）：記住、交給目前的舞台；換主題時新建的也交給它。null＝各舞台本來的遠景。 */
  setBackdrop(backdrop: StageBackdrop | null): void;
  /** 目前記住的遠景（還沒設定＝null）。 */
  backdrop(): StageBackdrop | null;
  /** 水鏡的遠景圖（T-815）：記住、只交給水鏡（換到水鏡時新建的也交給它）。null＝沒有。 */
  setWaterScene(scene: StageBackdrop | null): void;
  /** 目前記住的水鏡遠景（還沒設定＝null）。 */
  waterScene(): StageBackdrop | null;
  /** 遠景的位置與大小（T-822）：記住、只交給水鏡（換到水鏡時新建的也交給它）。值一樣（x、y、zoom 都相同）不做事。 */
  setFarPan(pan: FarPan): void;
  /** 目前記住的遠景位置（還沒設定＝{0,0,1}）。 */
  farPan(): FarPan;
  /** 展示廳畫好的大廳（CSS 那層）讀好了沒（T-816）：記住、只交給展示廳（換到展示廳時新建的也交給它）。 */
  setGalleryHall(shown: boolean): void;
  /** 目前記住的（還沒設定＝false）。 */
  galleryHall(): boolean;
  /** 水鏡的水面樣子（T-825）：記住、只交給水鏡（換到水鏡時新建的也交給它）。值一樣（八個欄位都相同）不做事。 */
  setWaterLook(look: Readonly<WaterLook>): void;
  /** 目前記住的水面樣子（還沒設定＝〔夜色〕）。 */
  waterLook(): WaterLook;
  /** 星雲畫好的漩渦大圖（T-817）：記住、只交給星雲（換到星雲時新建的也交給它）。同一張再設不做事；null＝照程式漩渦畫。 */
  setNebulaSwirl(swirl: StageBackdrop | null): void;
  /** 目前記住的大圖（還沒設定＝null）。 */
  nebulaSwirl(): StageBackdrop | null;
  /** fn 執行期間不畫舞台（擷取畫面用），結束後（含丟例外）還原。 */
  hidden<R>(fn: () => R): R;
  /** 連舞台一起錄（T-850）：開一份擷取用的舞台動態（從頭開始），見 StageCapture。 */
  capture(): StageCapture;
}

/**
 * 這個主題要鏡頭多退多少（給 fit.ts cameraDistance 的 reach；card-view 和破框層要的取較大的）：
 * 展示廳（台子與台面倒影）、水鏡（水面倒影）才有；全息光環、魔法陣、星雲、工作桌（T-832：卡片和別的舞台一樣大，
 * 預設縮放下整座展示座放得進畫面）、關閉、還沒設定＝null（不影響取景）。
 */
export function stageReach(style: StageStyle | null, cardH: number): { x: number; y: number } | null {
  if (style === 'gallery') return galleryReach(cardH);
  if (style === 'water') return waterReach(cardH);
  return null;
}

export function createStageSwitch<T>(make: StageMakers<T>): StageSwitch<T> {
  const group = new Group();
  // 卡片的 group 是 0：舞台整組先畫
  group.renderOrder = -1;
  let current: StageStyle | null = null;
  let part: StagePart | null = null;
  let gallery: GalleryPart<T> | null = null;
  let water: WaterPart | null = null;
  let nebula: NebulaPart | null = null;
  let cardH = DEFAULT_CARD_H;
  let reduced = false;
  let pose = { yaw: 0, pitch: 0 };
  let thumbs: readonly T[] = [];
  let backdrop: StageBackdrop | null = null;
  let waterScene: StageBackdrop | null = null;
  let farPan: FarPan = { x: 0, y: 0, zoom: 1 };
  let hall = false;
  let look: WaterLook = { ...DEFAULT_WATER_LOOK };
  let swirl: StageBackdrop | null = null;

  const build = (style: Exclude<StageStyle, 'none'>): StagePart => {
    switch (style) {
      case 'gallery':
        gallery = make.gallery();
        gallery.setThumbs(thumbs);
        gallery.setHall?.(hall);
        return gallery;
      case 'magic':
        return make.magic();
      case 'water':
        return make.water();
      case 'nebula':
        return make.nebula();
      case 'desk':
        return make.desk();
      case 'halo':
        return make.halo();
    }
  };

  return {
    group,

    style: () => current,

    setStyle(next) {
      if (next === current) return;
      current = next;
      if (part) {
        group.remove(part.group);
        part.dispose();
      }
      part = null;
      gallery = null;
      water = null;
      nebula = null;
      if (next === 'none') return;
      part = build(next);
      water = next === 'water' ? (part as WaterPart) : null;
      nebula = next === 'nebula' ? (part as NebulaPart) : null;
      part.setCardHeight(cardH);
      part.setReducedMotion(reduced);
      part.setPose(pose.yaw, pose.pitch);
      // 遠景的位置（T-822）、水面樣子（T-825）在遠景圖之前給：水鏡一建好遠景平面就照位置與水面高度排
      water?.setFarPan(farPan);
      water?.setLook(look);
      // 沒設過遠景就不叫（舞台一建好就是本來的遠景）
      if (backdrop) part.setBackdrop?.(backdrop);
      // 水鏡的遠景（T-815）在背景圖之後給：有背景圖時水鏡不用先建一次遠景
      if (waterScene) water?.setScene(waterScene);
      // 星雲的大圖（T-817）在背景圖之後給；沒設過就不叫（一建好就是程式漩渦）
      if (swirl) nebula?.setSwirl?.(swirl);
      group.add(part.group);
    },

    setCardHeight(next) {
      cardH = next;
      part?.setCardHeight(next);
    },

    setReducedMotion(next) {
      reduced = next;
      part?.setReducedMotion(next);
    },

    setPose(yawDeg, pitchDeg) {
      pose = { yaw: yawDeg, pitch: pitchDeg };
      part?.setPose(yawDeg, pitchDeg);
    },

    update(dt) {
      part?.update(dt);
    },

    setThumbs(next) {
      thumbs = next;
      gallery?.setThumbs(next);
    },

    setBackdrop(next) {
      if (next === backdrop) return;
      backdrop = next;
      part?.setBackdrop?.(next);
    },

    backdrop: () => backdrop,

    setWaterScene(next) {
      if (next === waterScene) return;
      waterScene = next;
      water?.setScene(next);
    },

    waterScene: () => waterScene,

    setFarPan(next) {
      if (next.x === farPan.x && next.y === farPan.y && next.zoom === farPan.zoom) return;
      farPan = { x: next.x, y: next.y, zoom: next.zoom };
      water?.setFarPan(farPan);
    },

    farPan: () => ({ ...farPan }),

    setGalleryHall(next) {
      if (next === hall) return;
      hall = next;
      gallery?.setHall?.(next);
    },

    galleryHall: () => hall,

    setWaterLook(next) {
      const same = (Object.keys(look) as (keyof WaterLook)[]).every((k) => next[k] === look[k]);
      if (same) return;
      look = { ...next };
      water?.setLook(look);
    },

    waterLook: () => ({ ...look }),

    setNebulaSwirl(next) {
      if (next === swirl) return;
      swirl = next;
      nebula?.setSwirl?.(next);
    },

    nebulaSwirl: () => swirl,

    hidden(fn) {
      const was = group.visible;
      group.visible = false;
      try {
        return fn();
      } finally {
        group.visible = was;
      }
    },

    capture() {
      const owner = part;
      const fork = owner?.forkMotion?.() ?? null;
      return {
        step(yawDeg, pitchDeg, dt, draw) {
          // 舞台關閉、或擷取途中換了主題（建立時那組已經釋放）：不動舞台，照畫
          if (!owner || owner !== part) return draw?.();
          fork?.swap();
          try {
            owner.setPose(yawDeg, pitchDeg);
            owner.update(dt);
            return draw?.();
          } finally {
            fork?.swap();
            owner.setPose(pose.yaw, pose.pitch);
          }
        },
      };
    },
  };
}
