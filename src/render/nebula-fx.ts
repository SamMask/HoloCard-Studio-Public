// 舞台主題「星雲」（T-415，DESIGN §5「舞台」）：由 stage-switch.ts 在選星雲時建立、換掉時 dispose。
// 數字與「每格怎麼動」在 nebula-layout.ts（純數學、有測試），著色在 nebula-nodes.ts。
//
// 不擋卡片（同其他舞台）：整組在 stage-switch 的容器裡（renderOrder −1），每個東西都不寫深度、不測深度、留在「不透明」那一批，
// 卡片最後蓋上去——任何角度都完整可見。星雲與星點都在卡片後面（z < 0），卡片周圍再壓暗，卡片是畫面最亮、最清楚的東西。
// 每個東西都放在 STAGE_LAYER（和展示廳一致）。
//
// 每影格的 draw call：背景平面（漩渦＋細絲＋光暈與細光環＋星際霧）、星點＝2 個，沒有多的 pass。每格只改 uniform，不建網格、材質。
// 舞台背景圖（T-814，stage-switch 的 setBackdrop）：有圖時漩渦（大圖、細絲）與星際霧不畫（uniform far＝0，遠景讓給 CSS 那層的背景圖），
// 卡片下方的光暈、細光環與星點照舊（前景）；null＝和以前一模一樣（far＝1）。
// 畫好的漩渦大圖（T-817，stage-switch 的 setSwirl；貼圖歸 card-view，這裡不釋放）：有圖時背景平面換成畫大圖＋細絲的材質
// （nebula-nodes 的 nebulaSwirlBackdrop），舊材質釋放；null（還沒讀好、讀不到、用不到）換回 T-415 的程式漩渦。換材質只在圖換的那一次，
// 網格與 draw call 數不變。大圖與每條細絲各自的轉角在 nebula-layout 的 stepNebula；光暈亮度＝呼吸 × 轉卡越快越亮（nebulaHaloGlow）。

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  type Texture,
  type UniformNode,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import { DEFAULT_CARD_H } from './fit';
import {
  initialNebulaMotion,
  NEBULA_BACKDROP,
  nebulaHaloGlow,
  nebulaHaloY,
  nebulaStars,
  stepNebula,
  type NebulaStar,
} from './nebula-layout';
import { nebulaBackdrop, nebulaSwirlBackdrop, starLook } from './nebula-nodes';
import { STAGE_LAYER } from './reflection';
import { stageMaterial } from './stage-material';
import { initialStageMotion, stepStageMotion } from './stage-motion';
import type { MotionFork, NebulaPart, StageBackdrop } from './stage-switch';

type FloatUniform = UniformNode<'float', number>;

/** 星點網格：每顆一個正對鏡頭（+z）的小方塊，attribute starInfo＝(亮度、相位、速度、顏色)。 */
export function starGeometry(stars: readonly NebulaStar[]): BufferGeometry {
  const positions = new Float32Array(stars.length * 12);
  const uvs = new Float32Array(stars.length * 8);
  const infos = new Float32Array(stars.length * 16);
  const index: number[] = [];
  const corners = [
    [-0.5, -0.5, 0, 0],
    [0.5, -0.5, 1, 0],
    [0.5, 0.5, 1, 1],
    [-0.5, 0.5, 0, 1],
  ] as const;
  stars.forEach((s, i) => {
    corners.forEach(([cx, cy, u, v], k) => {
      const at = i * 4 + k;
      positions.set([s.x + cx * s.size, s.y + cy * s.size, s.z], at * 3);
      uvs.set([u, v], at * 2);
      infos.set([s.brightness, s.phase, s.rate, s.tint], at * 4);
    });
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('starInfo', new BufferAttribute(infos, 4));
  g.setIndex(index);
  return g;
}

export interface NebulaFx extends NebulaPart {
  /** 著色程式的 uniform（檢查用：漩渦轉角、細絲轉角、光暈高度與亮度、卡片半高、星星閃爍的時間、遠景開關；只讀）。 */
  readonly uniforms: {
    readonly spin: FloatUniform;
    readonly arms: readonly FloatUniform[];
    readonly haloY: FloatUniform;
    readonly halo: FloatUniform;
    readonly cardHalfH: FloatUniform;
    readonly time: FloatUniform;
    readonly far: FloatUniform;
  };
  setBackdrop(backdrop: StageBackdrop | null): void;
  /** 畫好的漩渦大圖（T-817）：換上就畫大圖＋細絲；null＝程式漩渦。同一張貼圖再設不做事；貼圖不釋放（歸 card-view）。 */
  setSwirl(swirl: StageBackdrop | null): void;
  /** 擷取用的一份動態（T-850，stage-switch 的 MotionFork）：從頭開始，swap 和畫面那份互換。 */
  forkMotion(): MotionFork;
}

export function createNebulaFx(): NebulaFx {
  // 擷取（T-850）時換成另一份（forkMotion），所以是 let
  let motion = initialStageMotion();
  let spin = initialNebulaMotion();
  let reduced = false;
  let yaw = 0;
  let pitch = 0;

  const group = new Group();
  group.renderOrder = -1;

  const uniforms = {
    spin: uniform(0) as FloatUniform,
    arms: spin.arms.map(() => uniform(0) as FloatUniform),
    haloY: uniform(nebulaHaloY(DEFAULT_CARD_H)) as FloatUniform,
    halo: uniform(nebulaHaloGlow(0, 0)) as FloatUniform,
    cardHalfH: uniform(DEFAULT_CARD_H / 2) as FloatUniform,
    far: uniform(1) as FloatUniform,
  };
  const time = uniform(0) as FloatUniform;
  /** 目前畫的大圖貼圖（null＝程式漩渦）。 */
  let swirlTexture: Texture | null = null;

  /** 背景平面的材質：有大圖畫大圖＋細絲，沒有畫程式漩渦。 */
  const backdropMaterial = (texture: Texture | null) =>
    stageMaterial(new MeshBasicNodeMaterial(), texture ? nebulaSwirlBackdrop(uniforms, texture) : nebulaBackdrop(uniforms), 'add');

  // ---- 背景平面（最遠）：漩渦（程式或大圖＋細絲）、光暈與細光環、星際霧 ----
  const backdropGeometry = new PlaneGeometry(NEBULA_BACKDROP.width, NEBULA_BACKDROP.height);
  backdropGeometry.translate(0, 0, NEBULA_BACKDROP.z);
  const backdrop = new Mesh(backdropGeometry, backdropMaterial(null));
  backdrop.renderOrder = 0;
  backdrop.frustumCulled = false; // 永遠蓋滿畫面
  backdrop.layers.set(STAGE_LAYER);

  // ---- 星點 ----
  const starsGeometry = starGeometry(nebulaStars());
  const stars = new Mesh(starsGeometry, stageMaterial(new MeshBasicNodeMaterial(), starLook(time), 'add'));
  stars.renderOrder = 1;
  stars.layers.set(STAGE_LAYER);

  group.add(backdrop, stars);

  const writeUniforms = () => {
    uniforms.spin.value = spin.spin;
    for (let i = 0; i < uniforms.arms.length; i++) uniforms.arms[i]!.value = spin.arms[i]!;
    uniforms.halo.value = nebulaHaloGlow(motion.time, motion.energy);
    time.value = motion.time;
  };

  return {
    group,
    uniforms: { ...uniforms, time },

    setCardHeight(cardH: number) {
      uniforms.haloY.value = nebulaHaloY(cardH);
      uniforms.cardHalfH.value = cardH / 2;
    },

    setReducedMotion(next) {
      reduced = next;
    },

    setPose(yawDeg, pitchDeg) {
      yaw = yawDeg;
      pitch = pitchDeg;
    },

    setBackdrop(backdrop) {
      uniforms.far.value = backdrop ? 0 : 1;
    },

    setSwirl(next) {
      const texture = next?.texture ?? null;
      if (texture === swirlTexture) return;
      swirlTexture = texture;
      const old = backdrop.material;
      backdrop.material = backdropMaterial(texture);
      old.dispose();
    },

    forkMotion() {
      let otherMotion = initialStageMotion();
      let otherSpin = initialNebulaMotion();
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

    update(dt) {
      // 減少動態效果：stage-motion 的時間停住、能量 0；漩渦不轉、星星不閃、光暈停在當下的亮度
      stepStageMotion(motion, yaw, pitch, dt, reduced);
      stepNebula(spin, motion.energy, dt, reduced);
      writeUniforms();
    },

    dispose() {
      backdropGeometry.dispose();
      starsGeometry.dispose();
      backdrop.material.dispose();
      stars.material.dispose();
      group.removeFromParent();
    },
  };
}
