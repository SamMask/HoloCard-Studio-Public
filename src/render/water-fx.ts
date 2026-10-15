// 舞台主題「水鏡」（T-415，DESIGN §5「舞台」）：由 stage-switch.ts 在選水鏡時建立、換掉時 dispose。
// 數字與「每格怎麼動」在 water-layout.ts（純數學、有測試），著色在 water-nodes.ts，倒影在 reflection.ts（共用模組，同展示廳）。
//
// 不擋卡片（同其他舞台）：整組在 stage-switch 的容器裡（renderOrder −1），水面不寫深度、不測深度、留在「不透明」那一批，
// 卡片最後蓋上去——任何角度都完整可見，破框層伸出卡外的部分也一樣（倒影裡也有破框層：倒影是同一批網格再畫一次）。
// 水面放在 STAGE_LAYER：倒影的鏡頭只看卡片那一層，水面不會映進自己。
//
// 遠景（T-814 舞台背景圖，stage-switch 的 setBackdrop）：有圖時多一片直立的平面（water-layout.ts 的 waterBackdropPlane：
// 卡片後面、下緣貼水平線、左右鋪滿畫面，鏡頭或畫面一變就重算〔輸入沒變的影格不算，T-814b〕；圖照 cover 從上面裁、下緣對齊水平線，亮度同預覽區約 85%），
// 放在 BACKDROP_LAYER、倒影的鏡頭這時也打開這一層 → 水裡映得出遠景、跟著波紋與漣漪晃、越往下（越近）越淡；
// 水面這時不淡出（一路接到遠景的下緣）。null＝沒有這片（和以前一模一樣：網格、倒影的鏡頭、水面的淡出都照舊）。
// 三種遠景（T-815，setScene）：同一片平面、同一套倒影，畫這張卡選的遠景圖（湖光山峰／水墨山／富士山，亮度 WATER_SCENE_DIM；
// 圖的下緣是霧，接進水面）。自己的背景圖優先（water-layout.ts 的 waterFar）；兩個都沒有＝沒有這片（圖還沒讀好時就是這樣）。
// 遠景的位置與大小（T-822，setFarPan）：圖在平面上的裁切照 backdrop.ts 的 farPanRect（'bottom'：下緣貼水平線、只用 x 與 zoom，
// 放大以下緣為基準）；{0,0,1}＝T-814 的 cover 一模一樣。x 或 zoom 變了才重排（y 水鏡不用，變了不重排）；換圖、換遠景照同一個位置。
// 貼圖都歸 card-view 管（建立與釋放），這裡只拿來畫。
//
// 水面樣子（T-825，setLook，卡片的 view.waterLook；換算在 water-layout.ts 最下面一段）：著色程式的 uniform（霧、倒影拉長、閃光、
// 波紋、兩個顏色）、水面高度（〔卡片高度〕→ waterGap）；遠景平面混進霧裡的天空（farMist：越靠水平線越濃，霧 100 整片都是；
// 天空＝霧色 × mistSky，卡片後面亮、上面與四角偏暗偏冷，T-825c；〔霧〕0 時混 0＝和以前一樣）。
// 水面流動的時間（T-825c，uniforms.flow）：每格照 waterFlow 加「舞台時間走了多少 × 波紋倍數」，波紋 0＝完全平靜。
// 〔地平線〕由 card-view 移鏡頭（鏡頭往下＋lens shift）：遠景平面照鏡頭的高度與平移蓋滿水平線以上（layoutFar 多比對鏡頭高度）。
// 〔夜色〕（建好時就是）＝以前的數字，畫面逐位元相同。
//
// 每影格的 draw call：水面＝1 個（有遠景再加 1 個）；倒影多一個 pass（卡片在半解析度 render target 再畫一次）。T-825 沒有多 draw call。
// 擷取時整組藏起來，倒影也不畫。

import { Color, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector2, Vector3, type Camera, type UniformNode } from 'three/webgpu';
import { float, mix, positionLocal, texture, uniform, uv } from 'three/tsl';
import { DEFAULT_WATER_LOOK } from '../model/limits';
import type { FarPan, WaterLook } from '../model/types';
import { farPanRect, type SourceRect } from './backdrop';
import { DEFAULT_CARD_H } from './fit';
import { BACKDROP_LAYER, createPlanarReflection, STAGE_LAYER, type PlanarReflection } from './reflection';
import { stageMaterial } from './stage-material';
import { initialStageMotion, stepStageMotion } from './stage-motion';
import type { MotionFork, StageBackdrop, StagePart } from './stage-switch';
import {
  horizonShift,
  needsLookShader,
  WATER_SIZE,
  waterBackdropPlane,
  waterFar,
  waterFarDim,
  waterFlow,
  waterGap,
  waterLookUniforms,
  waterY,
  type WaterFarKind,
} from './water-layout';
import { farMistNode, mistSkyNode, waterLook, type WaterLookUniforms } from './water-nodes';

type FloatUniform = UniformNode<'float', number>;
type Vec2Uniform = UniformNode<'vec2', Vector2>;
type Vec3Uniform = UniformNode<'vec3', Vector3>;

/** sRGB 色碼 → 線性的三個數字（著色程式在線性空間算）。 */
function linearRgb(hex: string, out = new Vector3()): Vector3 {
  const c = new Color(hex);
  return out.set(c.r, c.g, c.b);
}

export interface WaterDeps {
  /** 主鏡頭：倒影的鏡頭由它複製；遠景平面照它的位置、視角、寬高比鋪滿畫面（PerspectiveCamera）。 */
  camera: Camera;
}

export interface WaterFx extends StagePart {
  /** 水面的倒影（檢查用：dispose 時一起釋放 render target）。 */
  readonly reflection: PlanarReflection;
  /** 著色程式的 uniform（檢查用：時間、拖曳反應、水面高度、有沒有遠景、水面流動的時間〔T-825c〕；只讀）。 */
  readonly uniforms: {
    readonly time: FloatUniform;
    readonly energy: FloatUniform;
    readonly planeY: FloatUniform;
    readonly backdrop: FloatUniform;
    readonly flow: FloatUniform;
  };
  setBackdrop(backdrop: StageBackdrop | null): void;
  /**
   * 這張卡選的遠景圖（T-815，card-view 建好的貼圖）；null＝沒有（還沒讀好、或不需要）。有自己的背景圖時先記著，拿掉背景圖才換上。
   * 同一張再呼叫不做事。
   */
  setScene(scene: StageBackdrop | null): void;
  /** 遠景平面（檢查用；沒有遠景＝null）。 */
  backdropMesh(): Mesh | null;
  /** 遠景平面現在畫的是哪張、哪一種（檢查用；沒有＝null）。 */
  farSource(): { source: StageBackdrop; kind: WaterFarKind } | null;
  /** 遠景的位置與大小（T-822，卡片的 view.farPan）：x 或 zoom 和現在不一樣才重排（y 不用）。沒有遠景時先記著。 */
  setFarPan(pan: FarPan): void;
  /** 遠景平面現在從圖上取的那一塊（像素，檢查用；沒有遠景＝null）。 */
  farCrop(): SourceRect | null;
  /**
   * 水面樣子（T-825，卡片的 view.waterLook）：著色程式的 uniform、水面高度（〔卡片高度〕）跟著變；建好時＝〔夜色〕。
   * 〔地平線〕是鏡頭的事（card-view），這裡只照鏡頭的高度排遠景平面。
   */
  setLook(look: Readonly<WaterLook>): void;
  /** 水面樣子的 uniform（檢查用；只讀）。 */
  readonly look: Readonly<WaterLookUniforms>;
  /** 擷取用的一份動態（T-850，stage-switch 的 MotionFork）：從頭開始（含水面流動的時間），swap 和畫面那份互換。 */
  forkMotion(): MotionFork;
}

export function createWaterFx(deps: WaterDeps): WaterFx {
  // 擷取（T-850）時換成另一份（forkMotion），所以是 let
  let motion = initialStageMotion();
  let reduced = false;
  let yaw = 0;
  let pitch = 0;

  const group = new Group();
  group.renderOrder = -1;

  const uniforms = {
    time: uniform(0) as FloatUniform,
    energy: uniform(0) as FloatUniform,
    planeY: uniform(waterY(DEFAULT_CARD_H)) as FloatUniform,
    backdrop: uniform(0) as FloatUniform,
    flow: uniform(0) as FloatUniform,
  };
  // 水面樣子（T-825）：一開始＝〔夜色〕
  const start = waterLookUniforms(DEFAULT_WATER_LOOK);
  const lookUniforms: WaterLookUniforms = {
    mist: uniform(start.mist) as FloatUniform,
    mistColor: uniform(linearRgb(DEFAULT_WATER_LOOK.mistColor)) as Vec3Uniform,
    streak: uniform(start.streak) as FloatUniform,
    glint: uniform(start.glint) as FloatUniform,
    glintColor: uniform(linearRgb(DEFAULT_WATER_LOOK.glintColor)) as Vec3Uniform,
    ripple: uniform(start.ripple) as FloatUniform,
  };
  /** 卡高與卡片下緣到水面（〔卡片高度〕）：水面高度＝waterY(cardH, gap)。 */
  let cardH = DEFAULT_CARD_H;
  let gap = waterGap(DEFAULT_WATER_LOOK.lift);

  // ---- 倒影：鏡面就是水面（水鏡整組的原點） ----
  const reflection = createPlanarReflection(deps.camera);
  group.add(reflection.target);
  const mirrorCamera = reflection.node.reflector.getVirtualCamera(deps.camera);

  // ---- 水面：往鏡頭伸到鏡頭下面、往遠處伸到淡進夜色 ----
  const geometry = new PlaneGeometry(WATER_SIZE.width, WATER_SIZE.near + WATER_SIZE.far);
  geometry.rotateX(-Math.PI / 2); // 平放：本地 (x, z)＝水面上的點，+z 朝鏡頭
  geometry.translate(0, 0, (WATER_SIZE.near - WATER_SIZE.far) / 2);
  // 著色程式兩份（T-825、T-825c，見 water-nodes.ts 檔頭）：平常用沒有霧、拉長、閃光、流動時間那幾段的（〔夜色〕＝以前的著色程式）；
  // needsLookShader（霧、拉長、閃光大於 0 或波紋不是 50）才建有那幾段的（第一次換過去時編譯一次），之後兩份留著、照樣子換
  const waterMaterial = (full: boolean) =>
    stageMaterial(new MeshBasicNodeMaterial(), waterLook(positionLocal.xz, uniforms, reflection, lookUniforms, full), 'over');
  const plainMaterial = waterMaterial(false);
  let fullMaterial: MeshBasicNodeMaterial | null = null;
  const water = new Mesh(geometry, plainMaterial);
  water.renderOrder = 0;
  water.layers.set(STAGE_LAYER);
  group.add(water);

  // ---- 遠景（T-814 背景圖、T-815 三種遠景）：有圖時才建；backdrop／scene＝收到的兩張，畫哪張照 waterFar ----
  let backdrop: StageBackdrop | null = null;
  let scene: StageBackdrop | null = null;
  /** 遠景的位置與大小（T-822）：只用 x 與 zoom（水鏡的遠景貼著水平線）。 */
  let pan: FarPan = { x: 0, y: 0, zoom: 1 };
  let far: {
    source: StageBackdrop;
    kind: WaterFarKind;
    mesh: Mesh;
    geometry: PlaneGeometry;
    material: MeshBasicNodeMaterial;
    uvScale: Vec2Uniform;
    uvOffset: Vec2Uniform;
    /**
     * 上一次排版用的輸入（T-814b；T-822 加遠景位置的 x、zoom；T-825 加鏡頭的高度〔地平線〕）：沒變就不重算。
     * 新建的平面一開始是 null＝一定排一次。
     */
    laid: { z: number; fov: number; aspect: number; y: number; width: number; height: number; panX: number; zoom: number; camY: number } | null;
    /** 上一次排版從圖上取的那一塊（檢查用）。 */
    crop: SourceRect | null;
  } | null = null;

  /**
   * 遠景平面照鏡頭重算大小（蓋滿水平線以上）與圖的裁切（cover、下緣對齊水平線）。
   * 只在輸入變了才算（T-814b）：鏡頭距離（縮放、取景動畫期間每格都在變，照常即時跟上）、視角、寬高比、水面高度、遠景圖的寬高、
   * 遠景位置的 x 與 zoom（T-822）；
   * 靜止時（含減少動態）每影格只比對幾個數字，不重算、也不寫變換與 uniform。
   */
  const layoutFar = () => {
    if (!far) return;
    // 鏡頭的視角與寬高比（PerspectiveCamera 才有；沒有就當 30°、1:1）
    const cam = deps.camera as Camera & { fov?: number; aspect?: number };
    const z = cam.position.z;
    const fov = cam.fov ?? 30;
    const aspect = cam.aspect ?? 1;
    const y = group.position.y;
    // 地平線（T-825）：card-view 把鏡頭往下移、畫面照 horizonShift 平移（0＝以前）
    const camY = cam.position.y;
    const { width, height } = far.source;
    const { x: panX, zoom } = pan;
    const last = far.laid;
    if (
      last &&
      last.z === z &&
      last.fov === fov &&
      last.aspect === aspect &&
      last.y === y &&
      last.width === width &&
      last.height === height &&
      last.panX === panX &&
      last.zoom === zoom &&
      last.camY === camY
    ) {
      return;
    }
    if (last) {
      last.z = z;
      last.fov = fov;
      last.aspect = aspect;
      last.y = y;
      last.width = width;
      last.height = height;
      last.panX = panX;
      last.zoom = zoom;
      last.camY = camY;
    } else {
      far.laid = { z, fov, aspect, y, width, height, panX, zoom, camY };
    }
    const plane = camY === 0 ? waterBackdropPlane(z, fov, aspect, y) : waterBackdropPlane(z, fov, aspect, y, camY, horizonShift(camY, z, fov));
    far.mesh.scale.set(plane.width, plane.height, 1);
    far.mesh.position.set(0, 0, plane.z);
    // 下緣貼水平線、從上面裁；左右與大小照遠景位置（T-822，{0,0,1}＝T-814 的 cover）
    const r = farPanRect(width, height, plane.width, plane.height, pan, 'bottom');
    far.crop = r;
    // 貼圖的 uv 由下往上（v＝0 是圖的下緣）：取的那一塊的下緣在 1 −（sy＋sh）／高
    far.uvScale.value.set(r.sw / width, r.sh / height);
    far.uvOffset.value.set(r.sx / width, 1 - (r.sy + r.sh) / height);
  };

  const dropFar = () => {
    if (!far) return;
    group.remove(far.mesh);
    far.geometry.dispose();
    far.material.dispose();
    far = null;
  };

  /** 照收到的背景圖與遠景換上該畫的那張（waterFar）；和現在畫的一樣就不動（不重建）。 */
  const showFar = () => {
    const want = waterFar(backdrop, scene);
    if (want?.source === far?.source && want?.kind === far?.kind) return;
    dropFar();
    if (!want) {
      uniforms.backdrop.value = 0;
      mirrorCamera.layers.disable(BACKDROP_LAYER);
      return;
    }
    const { source, kind } = want;
    const planeGeometry = new PlaneGeometry(1, 1);
    planeGeometry.translate(0, 0.5, 0); // 原點在下緣中間：下緣貼水平線
    const uvScale = uniform(new Vector2(1, 1)) as Vec2Uniform;
    const uvOffset = uniform(new Vector2(0, 0)) as Vec2Uniform;
    const shown = texture(source.texture, uv().mul(uvScale).add(uvOffset)).rgb.mul(waterFarDim(kind));
    // 霧（T-825、T-825c）：混進霧裡的天空（霧色 × mistSky），越靠水平線越濃、霧 100 整片都是（farMist）；〔霧〕0 時混 0＝和以前一樣的顏色
    const sky = mistSkyNode(uv().x, uv().y, lookUniforms.mistColor);
    const color = mix(shown, sky, farMistNode(uv().y, lookUniforms.mist));
    const material = stageMaterial(new MeshBasicNodeMaterial(), { color, alpha: float(1) }, 'opaque');
    const mesh = new Mesh(planeGeometry, material);
    // 水面之後畫：比遠景平面更遠的那一截水面被它蓋掉（不測深度，照順序）
    mesh.renderOrder = 1;
    mesh.layers.set(BACKDROP_LAYER);
    mesh.frustumCulled = false;
    far = { source, kind, mesh, geometry: planeGeometry, material, uvScale, uvOffset, laid: null, crop: null };
    group.add(mesh);
    uniforms.backdrop.value = 1;
    mirrorCamera.layers.enable(BACKDROP_LAYER);
    layoutFar();
  };

  const placeWater = () => {
    const y = waterY(cardH, gap);
    group.position.y = y;
    uniforms.planeY.value = y;
    layoutFar();
  };
  const setCardHeight = (next: number) => {
    cardH = next;
    placeWater();
  };
  setCardHeight(DEFAULT_CARD_H);

  const writeUniforms = (dTime: number) => {
    uniforms.time.value = motion.time;
    uniforms.energy.value = motion.energy;
    // 水面流動的時間（T-825c）：舞台時間走了多少 × 波紋倍數（波紋 0＝不走；減少動態時舞台時間停住，這裡也停住）
    if (dTime !== 0) uniforms.flow.value = waterFlow(uniforms.flow.value, dTime, lookUniforms.ripple.value);
  };

  return {
    group,
    reflection,
    uniforms,

    setCardHeight,

    setReducedMotion(next) {
      reduced = next;
    },

    setPose(yawDeg, pitchDeg) {
      yaw = yawDeg;
      pitch = pitchDeg;
    },

    setBackdrop(next) {
      backdrop = next;
      showFar();
    },

    setScene(next) {
      scene = next;
      showFar();
    },

    backdropMesh: () => far?.mesh ?? null,

    farSource: () => (far ? { source: far.source, kind: far.kind } : null),

    setFarPan(next) {
      pan = { x: next.x, y: next.y, zoom: next.zoom };
      // x、zoom 沒變（含只改 y）時 layoutFar 比對完就回去，不重排
      layoutFar();
    },

    farCrop: () => (far?.crop ? { ...far.crop } : null),

    look: lookUniforms,

    setLook(next) {
      const v = waterLookUniforms(next);
      lookUniforms.mist.value = v.mist;
      lookUniforms.streak.value = v.streak;
      lookUniforms.glint.value = v.glint;
      lookUniforms.ripple.value = v.ripple;
      linearRgb(next.mistColor, lookUniforms.mistColor.value);
      linearRgb(next.glintColor, lookUniforms.glintColor.value);
      // 霧、拉長、閃光大於 0 或波紋不是 50：換成「水面樣子」那份著色程式（第一次才建）；〔夜色〕：換回平常那份
      if (needsLookShader(v)) {
        fullMaterial ??= waterMaterial(true);
        water.material = fullMaterial;
      } else {
        water.material = plainMaterial;
      }
      const nextGap = waterGap(next.lift);
      if (nextGap !== gap) {
        gap = nextGap;
        placeWater();
      }
    },

    forkMotion() {
      let otherMotion = initialStageMotion();
      let otherFlow = 0;
      return {
        swap() {
          const liveMotion = motion;
          const liveFlow = uniforms.flow.value;
          motion = otherMotion;
          uniforms.flow.value = otherFlow;
          otherMotion = liveMotion;
          otherFlow = liveFlow;
          writeUniforms(0);
        },
      };
    },

    update(dt) {
      // 減少動態效果：stage-motion 的時間停住、能量 0 → 漣漪與波紋停在當下
      const before = motion.time;
      stepStageMotion(motion, yaw, pitch, dt, reduced);
      writeUniforms(motion.time - before);
      // 鏡頭會因縮放、取景、預覽區大小而前後移：遠景跟著蓋滿（輸入沒變就不重算）
      layoutFar();
    },

    dispose() {
      dropFar();
      mirrorCamera.layers.disable(BACKDROP_LAYER);
      geometry.dispose();
      plainMaterial.dispose();
      fullMaterial?.dispose();
      reflection.dispose();
      group.removeFromParent();
    },
  };
}
