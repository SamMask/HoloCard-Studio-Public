// 舞台主題「魔法陣」（T-415，DESIGN §5「舞台」）：由 stage-switch.ts 在選魔法陣時建立、換掉時 dispose。
// 數字與「每格怎麼動」在 magic-layout.ts（純數學、有測試），著色在 magic-nodes.ts。
//
// 不擋卡片（同全息光環、展示廳）：整組在 stage-switch 的容器裡（renderOrder −1），每個東西都不寫深度、不測深度、
// 留在「不透明」那一批，卡片最後蓋上去——任何角度都完整可見，光點飄到卡片前面也被卡片蓋住。
// 每個東西都放在 STAGE_LAYER（和展示廳一致；倒影的鏡頭只看卡片那一層）。
//
// 每影格的 draw call：地上的陣、光點＝2 個，沒有多的 pass。每格只改 uniform，不建網格、材質。

import { Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Sprite, SpriteNodeMaterial, type UniformNode } from 'three/webgpu';
import { positionLocal, uniform } from 'three/tsl';
import { DEFAULT_CARD_H } from './fit';
import { initialMagicMotion, MAGIC_RINGS, magicY, MOTE_COUNT, stepMagic } from './magic-layout';
import { magicCircle, moteNodes } from './magic-nodes';
import { STAGE_LAYER } from './reflection';
import { stageMaterial } from './stage-material';
import { initialStageMotion, stepStageMotion } from './stage-motion';
import type { MotionFork, StagePart } from './stage-switch';

type FloatUniform = UniformNode<'float', number>;

/** 陣的平面比最外圈大多少（留給柔光、菱形）。 */
const CIRCLE_MARGIN = 0.12;

export interface MagicFx extends StagePart {
  /** 著色程式的 uniform（檢查用：內外圈轉角、亮度、時間；只讀）。 */
  readonly uniforms: { readonly inner: FloatUniform; readonly outer: FloatUniform; readonly glow: FloatUniform; readonly time: FloatUniform };
  /** 擷取用的一份動態（T-850，stage-switch 的 MotionFork）：從頭開始，swap 和畫面那份互換。 */
  forkMotion(): MotionFork;
}

export function createMagicFx(): MagicFx {
  // 擷取（T-850）時換成另一份（forkMotion），所以是 let
  let motion = initialStageMotion();
  let spin = initialMagicMotion();
  let reduced = false;
  let yaw = 0;
  let pitch = 0;

  const group = new Group();
  group.renderOrder = -1;

  const uniforms = {
    inner: uniform(0) as FloatUniform,
    outer: uniform(0) as FloatUniform,
    glow: uniform(spin.glow) as FloatUniform,
    time: uniform(0) as FloatUniform,
  };
  const energy = uniform(0) as FloatUniform;

  // ---- 地上的陣 ----
  const size = 2 * (MAGIC_RINGS[MAGIC_RINGS.length - 1]!.radius + CIRCLE_MARGIN);
  const circleGeometry = new PlaneGeometry(size, size);
  circleGeometry.rotateX(-Math.PI / 2); // 平放：本地 (x, z)＝地上的點，+z 朝鏡頭
  const circle = new Mesh(circleGeometry, stageMaterial(new MeshBasicNodeMaterial(), magicCircle(positionLocal.xz, uniforms), 'add'));
  circle.renderOrder = 0;
  circle.layers.set(STAGE_LAYER);

  // ---- 往上飄的光點：一個 Sprite、MOTE_COUNT 顆 ----
  const mote = moteNodes({ time: uniforms.time, energy });
  const moteMaterial = stageMaterial(new SpriteNodeMaterial(), mote.look, 'add');
  moteMaterial.positionNode = mote.position;
  moteMaterial.scaleNode = mote.scale;
  const motes = new Sprite(moteMaterial);
  motes.count = MOTE_COUNT;
  motes.frustumCulled = false; // 位置在著色程式裡算
  motes.renderOrder = 1;
  motes.layers.set(STAGE_LAYER);

  group.add(circle, motes);

  const setCardHeight = (cardH: number) => {
    group.position.y = magicY(cardH);
  };
  setCardHeight(DEFAULT_CARD_H);

  const writeUniforms = () => {
    uniforms.inner.value = spin.inner;
    uniforms.outer.value = spin.outer;
    uniforms.glow.value = spin.glow;
    uniforms.time.value = motion.time;
    energy.value = motion.energy;
    motes.visible = !reduced;
  };
  writeUniforms();

  return {
    group,
    uniforms,

    setCardHeight,

    setReducedMotion(next) {
      reduced = next;
      stepMagic(spin, motion.time, motion.energy, 0, reduced);
      writeUniforms();
    },

    setPose(yawDeg, pitchDeg) {
      yaw = yawDeg;
      pitch = pitchDeg;
    },

    update(dt) {
      stepStageMotion(motion, yaw, pitch, dt, reduced);
      stepMagic(spin, motion.time, motion.energy, dt, reduced);
      writeUniforms();
    },

    forkMotion() {
      let otherMotion = initialStageMotion();
      let otherSpin = initialMagicMotion();
      // 從頭開始的那一份照減少動態的設定擺好（同 setReducedMotion）
      stepMagic(otherSpin, otherMotion.time, otherMotion.energy, 0, reduced);
      return {
        swap() {
          const liveMotion = motion;
          const liveSpin = spin;
          motion = otherMotion;
          spin = otherSpin;
          otherMotion = liveMotion;
          otherSpin = liveSpin;
          writeUniforms();
        },
      };
    },

    dispose() {
      circleGeometry.dispose();
      circle.material.dispose();
      // Sprite 的網格是 three.js 所有 Sprite 共用的，不釋放
      moteMaterial.dispose();
      group.removeFromParent();
    },
  };
}
