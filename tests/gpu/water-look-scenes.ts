// 水面樣子（T-825）的 GPU 回歸用場景：同一組水鏡畫面（卡片＋舞台切換，同 card-view 的呼叫順序）。
// blend-gpu.ts 第 18 節用它比「省略 waterLook＝T-825 以前」：T-825 動工前用同一份場景程式在這台電腦取過整張畫面的雜湊
// （WATER_LOOK_BASELINE），之後省略 waterLook（或明寫〔夜色〕預設值）畫出來要逐位元組相同。
// 換了 GPU、驅動或瀏覽器版本，雜湊可能不同：那時用 T-825 之前的版本（git stash 或另一個工作樹）跑同一個場景重取。
// look：給了就 setWaterLook（舞台建好、給遠景之前，同 stage-switch 的順序），地平線照 card-view 的做法移鏡頭（往下＋setViewOffset）。
// 預設的卡片是黃藍格子的立體層（雜湊基準用它，不能改）；card: 'band'＝深色底卡靠下緣一條紅色色塊（看倒影往哪個方向延伸，T-825d）、
// 'plain'＝同一張深色底卡但沒有色塊（和 'band' 兩張相減，剩下的就是色塊的倒影）。
// later：第一張畫完之後，同一個場景（卡片、鏡頭都不動）再依序 sw.update(dt)、重畫（回傳在 later，T-817c：時間往前走水面還動不動）。
// samples：MSAA 取樣數（省略＝4）；要逐位元組比對（差 0）的用 0（見 gpu-harness 的 render）。

import { PerspectiveCamera, Scene, SRGBColorSpace, Texture } from 'three/webgpu';
import { aspectHeight } from '../../src/model/aspect';
import type { FarPan, WaterLook } from '../../src/model/types';
import { createCardObject, type GetImage } from '../../src/render/card-mesh';
import type { GalleryThumb } from '../../src/render/card-view';
import { cameraDistance, cardBox } from '../../src/render/fit';
import { BACKDROP_LAYER, STAGE_LAYER } from '../../src/render/reflection';
import { createStageSwitch, stageReach, type StageBackdrop, type StageSwitch } from '../../src/render/stage-switch';
import { createWaterFx } from '../../src/render/water-fx';
import { horizonCameraY, horizonShift, horizonViewOffset, waterGap } from '../../src/render/water-layout';
import { layer, loadImage, makeImage, testCard, type Gpu } from './gpu-harness';

const RAD = Math.PI / 180;

/** 一張畫面：遠景（沒有／湖光山峰／富士山）、卡片的左右角度、舞台時間（秒）、遠景位置。 */
export interface WaterLookShot {
  name: string;
  far: 'none' | 'lake' | 'fuji';
  yaw: number;
  time: number;
  pan?: FarPan;
}

export const WATER_LOOK_SHOTS: readonly WaterLookShot[] = [
  { name: '沒有遠景、正面、時間 0', far: 'none', yaw: 0, time: 0 },
  { name: '湖光山峰、正面、時間 0', far: 'lake', yaw: 0, time: 0 },
  { name: '湖光山峰、轉 25°、時間 2.5 秒', far: 'lake', yaw: 25, time: 2.5 },
  { name: '富士山、大小 2 左右 0.4、轉 −15°、時間 1 秒', far: 'fuji', yaw: -15, time: 1, pan: { x: 0.4, y: 0, zoom: 2 } },
];

/** FNV-1a 32 位元：整張畫面的雜湊（十六進位 8 碼）。 */
export function fnv1a(px: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < px.length; i++) {
    h ^= px[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 畫 shots（省略＝WATER_LOOK_SHOTS）每一張（卡片＋水鏡，鏡頭照 card-view 的取景退、800×600 那種畫面比例）。
 * look：水面樣子（省略＝從沒設過，和 T-825 以前一樣）；before(sw)：舞台建好、給遠景之前再呼叫一次（例如先設霧白再設回夜色）。
 */
export async function waterLookShots(
  gpu: Gpu,
  options: {
    look?: WaterLook;
    /** 照 look 畫過一次之後換成這個樣子再畫（回傳的是第二張）：檢查換回〔夜色〕時著色程式與鏡頭都回到以前。 */
    then?: WaterLook;
    before?: (sw: StageSwitch<GalleryThumb>, shot: WaterLookShot) => void;
    shots?: readonly WaterLookShot[];
    card?: 'checker' | 'band' | 'plain';
    later?: readonly number[];
    samples?: number;
  } = {},
): Promise<{ shot: WaterLookShot; px: Uint8ClampedArray; cameraZ: number; cameraY: number; later: Uint8ClampedArray[] }[]> {
  const { look, then, before, shots = WATER_LOOK_SHOTS, card: cardKind = 'checker', later = [], samples } = options;
  const { width: w, height: h } = gpu;
  const band = cardKind !== 'checker';
  const baseImg = await makeImage(8, 8, () => (band ? [70, 80, 100, 255] : [200, 70, 60, 255]));
  const topImg = band
    ? await makeImage(16, 16, (_x, y) => (cardKind === 'band' && y >= 13 && y <= 14 ? [255, 60, 30, 255] : [0, 0, 0, 0]))
    : await makeImage(16, 16, (x, y) => ((x + y) % 4 < 2 ? [250, 220, 90, 255] : [40, 140, 230, 0]));
  const getImage: GetImage = (hash) => (hash === 'b000000000000000' ? baseImg : topImg);
  const card = testCard([layer('bg', 'b000000000000000', 0), layer('top', 't000000000000000', 40)]);
  const cardH = aspectHeight(card);
  const toBackdrop = (img: HTMLImageElement): StageBackdrop => {
    const texture = new Texture(img);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return { texture, width: img.naturalWidth, height: img.naturalHeight };
  };
  const lake = toBackdrop(await loadImage('/stages/water-lake.webp'));
  const fuji = toBackdrop(await loadImage('/stages/water-fuji.webp'));
  const out: { shot: WaterLookShot; px: Uint8ClampedArray; cameraZ: number; cameraY: number; later: Uint8ClampedArray[] }[] = [];
  for (const shot of shots) {
    const scene = new Scene();
    const obj = createCardObject(gpu.plainBack, gpu.anisotropy, gpu.frameCorner);
    scene.add(obj.group);
    const camera = new PerspectiveCamera(30, w / h, 0.05, 100);
    camera.layers.enable(STAGE_LAYER);
    camera.layers.enable(BACKDROP_LAYER);
    camera.position.set(0, 0, cameraDistance(30, w / h, 0.85, cardBox(cardH), stageReach('water', cardH)));
    camera.updateProjectionMatrix();
    // 地平線（同 card-view）：鏡頭往下移、畫面往下平移，卡片所在的平面在畫面上不動
    const cameraY = look ? horizonCameraY(cardH, waterGap(look.lift), look.horizon) : 0;
    if (cameraY !== 0) {
      camera.position.y = cameraY;
      const v = horizonViewOffset(horizonShift(cameraY, camera.position.z, 30), camera.aspect);
      camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
    }
    const onlyWater = (): never => {
      throw new Error('只用水鏡');
    };
    const sw = createStageSwitch<GalleryThumb>({
      halo: onlyWater,
      gallery: onlyWater,
      magic: onlyWater,
      water: () => createWaterFx({ camera }),
      nebula: onlyWater,
      desk: onlyWater,
    });
    sw.setCardHeight(cardH);
    sw.setStyle('water');
    if (look) sw.setWaterLook(look);
    before?.(sw, shot);
    if (shot.pan) sw.setFarPan(shot.pan);
    if (shot.far !== 'none') sw.setWaterScene(shot.far === 'lake' ? lake : fuji);
    scene.add(sw.group);
    obj.update(card, getImage);
    obj.setView(shot.yaw, 0);
    obj.setTime(0);
    obj.group.rotation.set(0, shot.yaw * RAD, 0);
    sw.setPose(shot.yaw, 0);
    sw.update(0);
    if (shot.time > 0) sw.update(shot.time);
    let px = await gpu.render(scene, camera, { samples });
    if (then) {
      // 先照 look 畫過一次（著色程式真的編譯、用過），再換成 then（地平線照 then 擺鏡頭）重畫
      sw.setWaterLook(then);
      const y = horizonCameraY(cardH, waterGap(then.lift), then.horizon);
      camera.position.y = y;
      if (y === 0) camera.clearViewOffset();
      else {
        const v = horizonViewOffset(horizonShift(y, camera.position.z, 30), camera.aspect);
        camera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height);
      }
      sw.update(0);
      px = await gpu.render(scene, camera, { samples });
    }
    const laterPx: Uint8ClampedArray[] = [];
    for (const dt of later) {
      sw.update(dt);
      laterPx.push(await gpu.render(scene, camera, { samples }));
    }
    out.push({ shot, px, cameraZ: camera.position.z, cameraY, later: laterPx });
    sw.setStyle('none');
  }
  lake.texture.dispose();
  fuji.texture.dispose();
  return out;
}
