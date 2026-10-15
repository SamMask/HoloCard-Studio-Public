// 舞台主題共用的材質設定（T-410 展示廳、T-415 魔法陣／水鏡／星雲）。
// 不擋卡片：不寫深度、不測深度、留在「不透明」那一批（transparent＝false），整組照 renderOrder 排在卡片之前畫，
// 卡片最後蓋上去——卡片轉到任何角度都完整可見（破框層伸出卡外的部分也一樣）。

import {
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type Node,
  type NodeMaterial,
} from 'three/webgpu';

/** 預乘過的顏色（線性）＋不透明度。 */
export interface StageLook {
  color: Node<'vec3'>;
  alpha: Node<'float'>;
}

/** mode：add＝相加、over＝預乘 alpha 疊上去、opaque＝蓋掉。 */
export function stageMaterial<M extends NodeMaterial>(material: M, look: StageLook, mode: 'add' | 'over' | 'opaque'): M {
  material.colorNode = look.color;
  material.transparent = false;
  material.depthWrite = false;
  material.depthTest = false;
  if (mode === 'opaque') return material;
  material.opacityNode = look.alpha;
  material.premultipliedAlpha = false; // 顏色已經預乘過
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = mode === 'add' ? OneFactor : OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = AddEquation;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = mode === 'add' ? OneFactor : OneMinusSrcAlphaFactor;
  return material;
}
