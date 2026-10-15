// 舞台物件（T-314、T-316，DESIGN §5「舞台」）：卡片下方的全息展示台，由 card-view 放進場景、不放在卡片的 group 裡（不跟著卡片轉）。
// 數字與「每格怎麼動」在 stage-motion.ts（純數學、有測試），著色在 stage-fx-nodes.ts。
//
// 不擋卡片：整組 renderOrder 比卡片小、材質留在「不透明」那一批（transparent＝false），所以一定比卡片先畫；
// 舞台不寫深度、不做深度測試，卡片（不透明、不混色）畫上去就整個蓋過舞台——卡片轉到任何角度都完整可見，
// 星塵飄到卡片前面也會被卡片蓋住。舞台的光用相加混色（預乘過的顏色與不透明度都直接加），畫布透明的地方
// 也會寫進不透明度，疊在 ui 的舞台背景（正面底圖模糊）上看得到。
//
// 每格：stepStageMotion 改同一個狀態物件，再把數字寫進 uniform（光環的上下浮動改網格的 position.y）；不建網格、材質或其他物件。
// 換卡只改高度（setCardHeight）、改設定只切 visible；擷取時不畫由 stage-switch.ts 的 hidden() 負責（整組容器藏起來）。

import {
  AddEquation,
  Color,
  CustomBlending,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  OneFactor,
  PlaneGeometry,
  SpriteNodeMaterial,
  SRGBColorSpace,
  Sprite,
  Texture,
  type UniformNode,
} from 'three/webgpu';
import { positionLocal, uniform, vec3 } from 'three/tsl';
import type { StageStyle } from '../model/types';
import { DEFAULT_CARD_H } from './fit';
import type { MotionFork } from './stage-switch';
import { dustNodes, floorGlow, ringGlow, type Glow } from './stage-fx-nodes';
import {
  DUST_COUNT,
  GLOW_BOOST,
  initialStageMotion,
  outerRingPath,
  PEDESTAL,
  pedestalPlane,
  RING_HOVER,
  RINGS,
  RIPPLE_END,
  rippleShape,
  stageY,
  stepStageMotion,
} from './stage-motion';

export interface StageFx {
  readonly group: Group;
  /** 卡片比例：舞台高度跟著卡片下緣。 */
  setCardHeight(cardH: number): void;
  /** 'halo' 顯示、'none' 整個不畫（沒有任何光）。還沒呼叫前不畫。 */
  setStyle(style: StageStyle): void;
  /** 作業系統的「減少動態效果」：舞台靜止（光環不轉不呼吸不浮、底光不轉、沒有流光與漣漪、不顯示星塵），底光與光環還在。 */
  setReducedMotion(reduced: boolean): void;
  /** 卡片目前的角度（度）：量轉速（拖曳反應）、判斷翻面（漣漪）。 */
  setPose(yawDeg: number, pitchDeg: number): void;
  /** 影格迴圈每格呼叫一次（這一格的秒數）。 */
  update(dt: number): void;
  /** 擷取用的一份動態（T-850，stage-switch 的 MotionFork）：從頭開始，swap 和畫面那份互換。 */
  forkMotion(): MotionFork;
  /** 釋放網格、材質、展示台圖的貼圖（換舞台主題時，T-410）。星塵的 Sprite 網格是 three.js 共用的，不釋放。 */
  dispose(): void;
}

/** 顏色（sRGB 色碼 → 線性，著色程式在線性空間算）。 */
const RIPPLE_COLOR = '#8fe6ff';
const RING_COLOR = '#4fd0ff';
const DOT_COLOR = '#e6faff';
const DUST_COLOR = '#c4f1ff';
/** 拖曳時底光也稍微變亮。 */
const PEDESTAL_BOOST = 0.35;
/** 光環平面要比最外圈大多少（留給柔光）。 */
const RING_MARGIN = 0.15;

function linear(hex: string) {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** 相加混色、不寫深度、不做深度測試、留在不透明那一批（照 renderOrder 排在卡片之前）。 */
function glowMaterial<M extends NodeMaterial>(material: M, glow: Glow): M {
  material.colorNode = glow.color;
  material.opacityNode = glow.alpha;
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  material.premultipliedAlpha = false; // 顏色已經預乘過，不要再乘一次
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneFactor;
  material.blendEquationAlpha = AddEquation;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

type FloatUniform = UniformNode<'float', number>;

export function createStageFx(pedestalImage: HTMLImageElement, anisotropy: number): StageFx {
  // 擷取（T-850）時換成另一份（forkMotion），所以是 let
  let motion = initialStageMotion();
  const ripple = rippleShape(Infinity);
  let reduced = false;
  let yaw = 0;
  let pitch = 0;

  // ---- 地上：展示台圖（底光）＋漣漪 ----
  const plane = pedestalPlane();
  const pedestal = new Texture(pedestalImage);
  pedestal.colorSpace = SRGBColorSpace;
  pedestal.anisotropy = anisotropy; // 從很斜的角度看，沒有各向異性會糊成一片
  pedestal.needsUpdate = true;
  const floorUniforms = {
    pedestal: uniform(PEDESTAL.strength) as FloatUniform,
    pedestalAngle: uniform(0) as FloatUniform,
    rippleRadius: uniform(ripple.radius) as FloatUniform,
    rippleWidth: uniform(ripple.width) as FloatUniform,
    rippleStrength: uniform(0) as FloatUniform,
    cometAngle: uniform(0) as FloatUniform,
    cometStrength: uniform(0) as FloatUniform,
  };
  const floorColors = { ripple: linear(RIPPLE_COLOR), comet: linear(RING_COLOR), cometHead: linear(DOT_COLOR) };
  // 平面：寬度至少容得下漣漪；縱向剛好是整張圖（光環中心不在圖的正中間，平面往 +z 挪一點）
  const floorGeometry = new PlaneGeometry(Math.max(plane.width, RIPPLE_END * 2.3), plane.depth);
  floorGeometry.rotateX(-Math.PI / 2); // 平放：本地 (x, z)＝地上的點，+z 朝鏡頭
  floorGeometry.translate(0, 0, (plane.centerV - 0.5) * plane.depth);
  const floor = new Mesh(
    floorGeometry,
    glowMaterial(
      new MeshBasicNodeMaterial(),
      floorGlow(positionLocal.xz, pedestal, plane, outerRingPath(), floorUniforms, floorColors),
    ),
  );
  floor.renderOrder = 0;

  // ---- 懸浮光環 ----
  const ringUniforms = {
    angles: RINGS.map(() => uniform(0) as FloatUniform),
    glow: RINGS.map(() => uniform(1) as FloatUniform),
  };
  const ringSize = 2 * (Math.max(...RINGS.map((r) => r.radius)) + RING_MARGIN);
  const ringGeometry = new PlaneGeometry(ringSize, ringSize);
  ringGeometry.rotateX(-Math.PI / 2);
  const rings = new Mesh(
    ringGeometry,
    glowMaterial(new MeshBasicNodeMaterial(), ringGlow(positionLocal.xz, RINGS, ringUniforms, linear(RING_COLOR), linear(DOT_COLOR))),
  );
  rings.position.y = RING_HOVER;
  rings.renderOrder = 1;

  // ---- 星塵：一個 Sprite、DUST_COUNT 個實例 ----
  const dustUniforms = {
    time: uniform(0) as FloatUniform,
    angle: uniform(0) as FloatUniform,
    speed: uniform(0) as FloatUniform,
    energy: uniform(0) as FloatUniform,
  };
  const dustShape = dustNodes(dustUniforms, linear(DUST_COLOR));
  const dustMaterial = glowMaterial(new SpriteNodeMaterial(), dustShape.glow);
  dustMaterial.positionNode = dustShape.position;
  dustMaterial.scaleNode = dustShape.scale;
  dustMaterial.rotationNode = dustShape.rotation;
  const dust = new Sprite(dustMaterial);
  dust.count = DUST_COUNT;
  dust.frustumCulled = false; // Sprite 的剔除只看它自己的原點；星塵的位置在著色程式裡
  dust.renderOrder = 2;

  const group = new Group();
  group.add(floor, rings, dust);
  // 卡片的 group 是 0：舞台整組先畫
  group.renderOrder = -1;
  group.visible = false;
  group.position.y = stageY(DEFAULT_CARD_H);

  const writeUniforms = () => {
    floorUniforms.pedestal.value = PEDESTAL.strength * (1 + PEDESTAL_BOOST * motion.energy);
    floorUniforms.pedestalAngle.value = motion.pedestalAngle;
    rippleShape(motion.rippleAge, ripple);
    floorUniforms.rippleRadius.value = ripple.radius;
    floorUniforms.rippleWidth.value = ripple.width;
    floorUniforms.rippleStrength.value = ripple.strength * motion.rippleBoost * (1 + GLOW_BOOST * motion.energy);
    floorUniforms.cometAngle.value = motion.cometAngle;
    floorUniforms.cometStrength.value = motion.cometGlow;
    for (let i = 0; i < RINGS.length; i++) {
      ringUniforms.angles[i]!.value = motion.ringAngles[i]!;
      ringUniforms.glow[i]!.value = motion.ringGlow[i]!;
    }
    rings.position.y = RING_HOVER + motion.ringLift;
    dustUniforms.time.value = motion.time;
    dustUniforms.angle.value = motion.dustAngle;
    dustUniforms.speed.value = motion.dustSpeed;
    dustUniforms.energy.value = motion.energy;
    dust.visible = !reduced;
  };
  writeUniforms();

  return {
    group,

    setCardHeight(cardH) {
      group.position.y = stageY(cardH);
    },

    setStyle(next) {
      group.visible = next === 'halo';
    },

    setReducedMotion(next) {
      reduced = next;
      dust.visible = !reduced;
    },

    setPose(yawDeg, pitchDeg) {
      yaw = yawDeg;
      pitch = pitchDeg;
    },

    update(dt) {
      // 關著也照樣走：翻面判斷與轉速才不會在打開的那一格跳一下
      stepStageMotion(motion, yaw, pitch, dt, reduced);
      writeUniforms();
    },

    forkMotion() {
      let other = initialStageMotion();
      return {
        swap() {
          const live = motion;
          motion = other;
          other = live;
          writeUniforms();
        },
      };
    },

    dispose() {
      floorGeometry.dispose();
      ringGeometry.dispose();
      floor.material.dispose();
      rings.material.dispose();
      dustMaterial.dispose();
      pedestal.dispose();
    },
  };
}
