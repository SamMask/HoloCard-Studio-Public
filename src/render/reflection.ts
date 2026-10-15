// 共用的平面倒影（T-410 展示廳的地板與台面；T-415 的水鏡也會用）。
//
// 作法：three.js 的 ReflectorNode——鏡頭對鏡面翻過去、只畫卡片那一層（CARD_LAYER）到一張低解析度的 render target
// （畫布像素的 REFLECTION_SCALE 倍、半浮點），鏡面以下被斜切的近平面切掉（卡片轉斜時伸到台面下的角不會映出來）；
// 鏡面上的每一點用自己在畫面上的位置去取（左右翻過來），所以倒影跟著卡片轉、破框層、反光層、霧光都和卡片一模一樣
// （同一批網格與材質再畫一次，不另寫一份卡片 shader）。
// 為什麼不用「鏡像再畫一次卡片」：那樣是全解析度、也做不了柔化與水波扭曲；這裡多一個小 pass，卡片 shader 在
// 約 1/4 的像素上跑，倒影本來就要柔化，低解析度剛好。
//
// 只畫卡片：舞台的東西都放在 STAGE_LAYER（主鏡頭兩層都看），倒影的鏡頭只看 CARD_LAYER。
// 越往下越淡、越柔：reflectedHeight 算這一點映出的是卡片下緣往上多高的地方（鏡頭在 (0, 0, D) 看原點，卡片近似在 z＝0），
// 越高越淡（REFLECTION_FADE）、取樣半徑越大（REFLECTION_SOFTEN）。
// 水鏡（T-415）：sample 的 distort 是取樣位置的偏移（螢幕 uv），波紋算好傳進來就好；展示廳不傳。
// 水面比拋光的石地板映得更遠：look 可以換淡出的距離與柔化（不給＝展示廳用的 REFLECTION_FADE／REFLECTION_SOFTEN）。
// 倒影拉長（T-825 水鏡的〔倒影拉長〕）：stretch 在 sample 的結果之外，往畫面上方（卡片那邊）多取幾點平均，倒影往下拉長模糊；
// sample 本身一行都不改（展示廳、沒有拉長的水鏡畫面和以前一模一樣）。
// 連舞台一起錄（T-850）：three.js 的倒影（bounces: false）一個影格只重畫一次（NodeUpdateType.FRAME）；擷取在兩個影格之間畫，
// 會拿到預覽那一格的倒影（預覽的鏡頭與卡片角度）。freshReflections(fn) 的期間改成每次 render 都重畫（RENDER），結束就換回；
// 預覽照舊一個影格一次。

import { NodeUpdateType, Object3D, type Camera, type Node, type ReflectorNode } from 'three/webgpu';
import { cameraPosition, exp, float, fract, max, positionWorld, reflector, screenCoordinate, screenUV, vec2, vec3 } from 'three/tsl';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** 卡片在這一層（three.js 預設）；舞台的東西都放在 STAGE_LAYER，倒影的鏡頭看不到。 */
export const CARD_LAYER = 0;
export const STAGE_LAYER = 1;
/**
 * 水鏡的遠景（T-814 舞台背景圖）在這一層：主鏡頭看得到（card-view 打開），水面的倒影鏡頭只在有遠景時打開
 * （water-fx.ts），所以水裡映得出遠景；展示廳的倒影鏡頭不看這一層。
 */
export const BACKDROP_LAYER = 2;

/** 倒影 render target 是畫布像素的幾倍（每邊）。 */
export const REFLECTION_SCALE = 0.5;
/** 映出的高度每多這麼多（卡寬），倒影剩 1/e。 */
export const REFLECTION_FADE = 0.42;
/** 柔化半徑（螢幕 uv）：貼著卡片的地方 base，映出的高度每多 1 卡寬再加 perHeight。 */
export const REFLECTION_SOFTEN = { base: 0.0015, perHeight: 0.02 } as const;

/**
 * 鏡面上一點（世界座標 y＝planeY、z＝pointZ）映出的是卡片哪個高度（離鏡面多高，卡寬）：
 * 鏡頭在 (0, 0, cameraZ)、卡片近似在 z＝0 的平面上。光從鏡頭往下走到鏡面（降 H＝−planeY、橫走 cameraZ − pointZ），
 * 反射後用同樣的斜率往上走 pointZ 到卡片 → 高 H × pointZ ／ (cameraZ − pointZ)。鏡面在卡片後面（pointZ ≤ 0）映不到卡片＝0。
 */
export function reflectedHeight(planeY: number, pointZ: number, cameraZ: number): number {
  if (!(pointZ > 0) || !(cameraZ > pointZ)) return 0;
  return (-planeY * pointZ) / (cameraZ - pointZ);
}

/** 映出的高度 → 倒影剩幾成（0～1）。 */
export function reflectionFade(height: number): number {
  return Math.exp(-Math.max(0, height) / REFLECTION_FADE);
}

/** 倒影怎麼淡、怎麼柔（水鏡用；不給的欄位用展示廳的預設）。 */
export interface ReflectionLook {
  /** 映出的高度每多這麼多（卡寬），倒影剩 1/e。 */
  fade?: number;
  /** 柔化半徑（螢幕 uv）：貼著卡片的地方 base，映出的高度每多 1 卡寬再加 perHeight。 */
  soften?: { base: number; perHeight: number };
}

/** 倒影的一次取樣：線性、預乘過的顏色＋覆蓋率（0＝這裡沒有映到卡片）。 */
export interface ReflectionSample {
  color: V3;
  alpha: F;
}

export interface PlanarReflection {
  /** 鏡面：放進場景（位置＝鏡面上一點）；本地 +z 是鏡面的法線，建立時已轉成朝上（水平鏡面）。 */
  readonly target: Object3D;
  /** three.js 的 ReflectorNode（倒影的鏡頭與 render target 在它的 reflector 裡；檢查用）。 */
  readonly node: ReflectorNode;
  /**
   * 鏡面上這個片段看到的倒影（已乘上越往下越淡）。planeY＝鏡面的世界高度（倒影的鏡面在 target，但台面、地板
   * 可以借同一張倒影，各自用自己的高度算淡出）；distort＝取樣位置再偏移多少（螢幕 uv；水鏡的波紋用，展示廳不傳）；
   * look＝淡出與柔化（水鏡映得比較遠；不給＝展示廳的預設）。
   */
  sample(planeY: F, distort?: V2, look?: ReflectionLook): ReflectionSample;
  /**
   * 倒影拉長（T-825）：plain＝同一點的 sample(planeY, distort, look) 結果；再往畫面上方（卡片那邊）取 stretch.taps 點
   * （距離 0～len，每個像素錯開一點免得一格一格；len＝amount ×（base ＋ perHeight × 映出的高度）螢幕 uv），和 plain 一起平均
   * （plain 佔一份、每點一份），越往下拉得越長。只在要拉長時呼叫（取樣數＝sample 的 5 點＋taps 點）。
   */
  stretch(planeY: F, distort: V2, look: ReflectionLook, plain: ReflectionSample, stretch: StretchOptions): ReflectionSample;
  /** 釋放倒影的 render target。 */
  dispose(): void;
}

/**
 * 鏡面上這個片段映出的是卡片下緣往上多高的地方（卡寬，同 reflectedHeight；鏡面在卡片後面＝0）。著色程式版：倒影拉長、
 * 水鏡的閃光與橫紋（T-825）用它當「倒影裡的高度」——在畫面上和倒影一起等比例排開，地平線高低都一樣（不像水面上的 z 會被透視壓扁）。
 * sample 裡面另外照同一個式子算（那段不動，畫面和以前逐位元相同）。
 */
export function reflectedHeightNode(planeY: F): F {
  const toPoint = positionWorld.sub(cameraPosition);
  const t = planeY.sub(cameraPosition.y).div(toPoint.y.min(-1e-4));
  const hitZ = cameraPosition.z.add(toPoint.z.mul(t));
  return max(cameraPosition.y.sub(planeY).mul(hitZ).div(max(cameraPosition.z.sub(hitZ), 1e-3)), 0);
}

/** 倒影拉長的參數（T-825，見 PlanarReflection.stretch）。 */
export interface StretchOptions {
  /** 0～1：拉長多少（〔倒影拉長〕／100）。 */
  amount: F;
  /** 多取幾點（整數）。 */
  taps: number;
  /** 拉長的距離（螢幕 uv）＝amount ×（base ＋ perHeight × 映出的高度）。 */
  base: number;
  perHeight: number;
  /** 每一點再左右偏多少（螢幕 uv；水面的橫紋讓倒影的邊碎一點）。 */
  wobble?: F;
  /** 已經算好的映出高度（reflectedHeightNode；不給就自己算）。 */
  height?: F;
}

/** 斜向四點＋中心，權重和＝1：取樣半徑內的平均，看起來像稍微模糊。 */
const TAPS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.36],
  [0.7, 0.7, 0.16],
  [-0.7, 0.7, 0.16],
  [0.7, -0.7, 0.16],
  [-0.7, -0.7, 0.16],
];

/** freshReflections 進行中（巢狀也算）。 */
let freshDepth = 0;

/**
 * fn 執行期間，所有倒影每次 render 都重畫（T-850 擷取用；見檔頭）。結束（含丟例外）換回一個影格一次。
 */
export function freshReflections<R>(fn: () => R): R {
  freshDepth++;
  try {
    return fn();
  } finally {
    freshDepth--;
  }
}

/** camera：主鏡頭（倒影的鏡頭由它複製、只看卡片那一層）。 */
export function createPlanarReflection(camera: Camera, resolutionScale = REFLECTION_SCALE): PlanarReflection {
  const target = new Object3D();
  target.rotation.x = -Math.PI / 2; // 本地 +z → 世界 +y
  // bounces false：每一影格最多更新一次（台面與地板共用同一張）
  const node = reflector({ target, resolutionScale, bounces: false });
  // ReflectorNode 的鏡頭是主鏡頭的 clone（連 layers 一起複製）：先建好、改成只看卡片
  node.reflector.getVirtualCamera(camera).layers.set(CARD_LAYER);
  // 擷取時（freshReflections）每次 render 都重畫；平常照 three.js 原本的（bounces false＝一個影格一次）
  const base = node.reflector;
  const perFrame = base.getUpdateBeforeType.bind(base);
  base.getUpdateBeforeType = () => (freshDepth > 0 ? NodeUpdateType.RENDER : perFrame());

  return {
    target,
    node,

    sample(planeY, distort, look) {
      const fadeLength = look?.fade ?? REFLECTION_FADE;
      const soften = look?.soften ?? REFLECTION_SOFTEN;
      // 這一點映出的高度：視線先打到鏡面（世界 y＝planeY）的那一點 z，再照 reflectedHeight 換算
      const toPoint = positionWorld.sub(cameraPosition);
      const t = planeY.sub(cameraPosition.y).div(toPoint.y.min(-1e-4));
      const hitZ = cameraPosition.z.add(toPoint.z.mul(t));
      const height = max(cameraPosition.y.sub(planeY).mul(hitZ).div(max(cameraPosition.z.sub(hitZ), 1e-3)), 0);
      const fade = exp(height.negate().div(fadeLength));
      const radius = float(soften.base).add(height.mul(soften.perHeight));

      const base = distort ? screenUV.flipX().add(distort) : screenUV.flipX();
      let color: V3 = vec3(0, 0, 0);
      let alpha: F = float(0);
      for (const [dx, dy, w] of TAPS) {
        const tap = node.sample(dx === 0 && dy === 0 ? base : base.add(vec2(dx, dy).mul(radius)));
        color = color.add(tap.rgb.mul(w));
        alpha = alpha.add(tap.a.mul(w));
      }
      return { color: color.mul(fade), alpha: alpha.mul(fade) };
    },

    stretch(planeY, distort, look, plain, opt) {
      // 映出的高度與淡出：同 sample
      const fadeLength = look.fade ?? REFLECTION_FADE;
      const height = opt.height ?? reflectedHeightNode(planeY);
      const fade = exp(height.negate().div(fadeLength));
      const len = opt.amount.mul(float(opt.base).add(height.mul(opt.perHeight)));
      // 每個像素錯開一點（interleaved gradient noise）：取樣點不會排成一格一格的
      const jitter = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189));
      const base = screenUV.flipX().add(distort).add(vec2(opt.wobble ?? 0, 0));
      let color: V3 = vec3(0, 0, 0);
      let alpha: F = float(0);
      for (let i = 0; i < opt.taps; i++) {
        // 螢幕 uv 的 y 往下變大：往上（卡片那邊）＝減
        const at = jitter.add(i).div(opt.taps);
        const tap = node.sample(base.sub(vec2(0, len.mul(at))));
        color = color.add(tap.rgb);
        alpha = alpha.add(tap.a);
      }
      const share = 1 / (opt.taps + 1);
      return {
        color: plain.color.add(color.mul(fade)).mul(share),
        alpha: plain.alpha.add(alpha.mul(fade)).mul(share),
      };
    },

    dispose() {
      node.dispose();
    },
  };
}
