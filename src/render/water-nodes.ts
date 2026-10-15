// 水鏡（T-415）的著色程式（TSL）。尺寸、漣漪、波紋的數字在 water-layout.ts；倒影在 reflection.ts（共用模組）。
// 一個 draw call（水面）＋倒影多一個 pass（卡片在半解析度 render target 再畫一次，同展示廳）。
// 輸出是「線性、預乘過的顏色＋不透明度」，材質用預乘 alpha 疊上去（water-fx.ts）。
//
// 水面樣子（T-825，water-layout.ts 最下面一段）：〔波紋〕乘在細波紋與漣漪上（兩份都有）。
// 〔霧〕〔倒影拉長〕〔閃光〕、波紋的流動時間（T-825c）只放在「水面樣子」那一份著色程式裡（full＝true）：water-fx.ts 平常用沒有
// 這些段的那一份，霧、拉長、閃光大於 0 或波紋不是 50（water-layout.ts 的 needsLookShader）才換成有的那一份；裡面霧、拉長、閃光
// 也各自在「大於 0 才做」的分支裡。WebGL2 後端（Windows 上經 D3D 編譯器）只要多了這些段，連沒用到的時候其他地方的四捨五入都會變
// （差 1～15 個位元組）；分成兩份，〔夜色〕和以前是同一個著色程式，兩種後端畫面都逐位元相同（GPU 回歸頁第 18 節驗）。

import type { Node, UniformNode, Vector3 } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  exp,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  If,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  saturate,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { fbm, linear, noise2, rand2 } from './gallery-nodes';
import { reflectedHeightNode, type PlanarReflection } from './reflection';
import type { StageLook } from './stage-material';
import {
  FAR_MIST,
  MIST_SKY,
  RIPPLE_ENERGY_BOOST,
  WATER_BACKDROP,
  WATER_FADE,
  WATER_FOG,
  WATER_GLINT,
  WATER_REFLECTION,
  WATER_RIPPLE,
  WATER_STREAK,
  WAVELETS,
} from './water-layout';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type FloatUniform = UniformNode<'float', number>;
type Vec3Uniform = UniformNode<'vec3', Vector3>;

/** 深水、遠處斜看時映著的夜空、月光（漣漪、水面的微光）、倒影偏冷一點。 */
const DEEP = '#030a1c';
const SKY = '#2b4d88';
const MOON = '#d4e4ff';
const COLD_TINT = [0.86, 0.94, 1.06] as const;
/** 卡片正下方水面淡淡的一片光（卡片的光映在水上）。 */
const UNDER_GLOW = 0.05;
const UNDER_RADIUS = 0.45;
const TAU = Math.PI * 2;

export interface WaterUniforms {
  /** 舞台時間（秒，減少動態效果時停住）。 */
  time: FloatUniform;
  /** 拖曳反應 0～1。 */
  energy: FloatUniform;
  /** 水面的世界高度（倒影算淡出用）。 */
  planeY: FloatUniform;
  /**
   * 有遠景（T-814 舞台背景圖、T-815 三種遠景）＝1：水面一路到遠景平面都不淡掉（遠景的下緣貼著水平線，中間不能露出 CSS 的夜色）；
   * 斜看時映的天空就是遠景的倒影，不再另外加程式的夜空色（不然水平線下面比遠景下緣的霧亮一截，看得到一條硬邊）。
   * 沒有＝0：和以前一樣遠處淡進夜色、斜看映著夜空（max(淡出, 0)＝淡出、夜空 × 1，畫面一模一樣）。
   */
  backdrop: FloatUniform;
  /** 水面流動的時間（T-825c，water-layout.ts 的 waterFlow：波紋 0 時不走）；只有「水面樣子」那份用（月光微光、橫紋）。 */
  flow: FloatUniform;
}

/** 水面樣子（T-825）的 uniform：數字見 water-layout.ts 的 waterLookUniforms，顏色是線性的。 */
export interface WaterLookUniforms {
  /** 霧 0～1。 */
  mist: FloatUniform;
  mistColor: Vec3Uniform;
  /** 倒影拉長 0～1。 */
  streak: FloatUniform;
  /** 閃光 0～1。 */
  glint: FloatUniform;
  glintColor: Vec3Uniform;
  /** 波紋的倍數（1＝以前）。 */
  ripple: FloatUniform;
}

const smooth01 = (t: F): F => t.mul(t).mul(float(3).sub(t.mul(2)));

/** 霧：遠景平面上 v（0＝水平線、1＝上緣）、〔霧〕m 的濃淡，同 water-layout.ts 的 farMist（m＝0 時＝0）。 */
export function farMistNode(v: F, m: F): F {
  const s = smooth01(saturate(v.div(FAR_MIST.reach)));
  const k = float(FAR_MIST.boost).mul(float(1).sub(s)).sub(s.mul(FAR_MIST.thin));
  return saturate(m.mul(float(1).add(float(1).sub(m).mul(k))));
}

/** 霧：水平線上的濃淡，同 water-layout.ts 的 mistHorizon。 */
function mistHorizonNode(m: F): F {
  return min(m.mul(float(1).sub(m).mul(FAR_MIST.boost).add(1)), 1);
}

/** 霧裡的天空：霧色 × water-layout.ts 的 mistSky(u, v)（卡片後面亮、上面與四角偏暗偏冷）。 */
export function mistSkyNode(u: F, v: F, mistColor: V3): V3 {
  const S = MIST_SKY;
  const hx = u.sub(0.5).mul(2);
  const top = smoothstep(S.topFrom, 1, v).mul(S.top);
  const side = hx.mul(hx).mul(smoothstep(0, S.sideReach, v).mul(1 - S.sideLow).add(S.sideLow)).mul(S.side);
  const dark = top.add(side);
  const gx = u.sub(S.glowAt[0]).div(S.glowSize[0]);
  const gy = v.sub(S.glowAt[1]).div(S.glowSize[1]);
  const glow = exp(gx.mul(gx).add(gy.mul(gy)).negate());
  const b = float(1).sub(dark).mul(glow.mul(S.glow).add(1));
  const c = min(dark.div(S.coolAt), 1);
  const cool = mix(vec3(1, 1, 1), vec3(...S.cool), c);
  const warm = mix(vec3(1, 1, 1), vec3(...S.warm), glow);
  return mistColor.mul(cool).mul(warm).mul(b);
}

/**
 * 閃光（T-825、T-825c）：「倒影在卡片平面上的 x（cx）× 倒影裡的高度 height」上的格子每格最多一顆小亮點（WATER_GLINT），
 * 各自一閃一閃；集中在卡片倒影那一條、靠腳邊又多又大又亮（water-layout.ts 的 glintDensity、glintBoost，照格子中心算：
 * 同一顆不會被切一半）；只在卡片前面的水面。兩層大小不同的格子（第二層小一點、暗一點、每一排錯開半格），亮點在格子裡隨機擺，
 * 才不會排成一格一格。倒影拉長時亮點也上下拉長一點。回加上去的顏色（線性）。
 */
function glints(cx: F, z: F, height: F, time: F, look: WaterLookUniforms): V3 {
  const G = WATER_GLINT;
  const pixelX = fwidth(cx).mul(0.9);
  const pixelH = fwidth(height).mul(0.9);
  let level: F = float(0);
  G.layers.forEach((layer, n) => {
    const cell = vec2(G.cell[0] * layer.scale, G.cell[1] * layer.scale);
    const p = vec2(cx, height).div(cell);
    // 每一排錯開半格（不排成直排）
    const row = floor(p.y);
    const shift = row.mul(0.5).add(layer.seed);
    const q = vec2(p.x.add(shift), p.y);
    const id = floor(q);
    const f = fract(q).sub(0.5);
    const h1 = rand2(id.add(layer.seed));
    const h2 = rand2(id.add(vec2(17.13 + n, 3.71)));
    const h3 = rand2(id.add(vec2(5.27, 41.93 + n)));
    // 格子中心（cx、高度）：集中的那一條、靠腳邊多又大又亮都照它算
    const centerX = id.x.add(0.5).sub(shift).mul(cell.x);
    const centerH = id.y.add(0.5).mul(cell.y);
    const feet = exp(max(centerH, 0).div(G.feet).negate());
    const column = float(1).sub(smoothstep(G.column[0], G.column[1], abs(centerX)));
    const density = column.mul(feet.mul(1 - G.far).add(G.far));
    // 出現的機率跟著〔閃光〕
    const chance = look.glint.mul(G.density).mul(density);
    const on = smoothstep(float(1).sub(chance), float(1.02).sub(chance), h1);
    // 在格子裡隨機擺（留一點邊）；亮點最大 fit 格（在自己的格子裡就淡完，不會被格子切成方塊）
    const pos = vec2(h2.sub(0.5), h3.sub(0.5)).mul(G.jitter);
    const d = f.sub(pos).mul(cell);
    const size = float(G.size * layer.size).mul(feet.mul(G.feetSize).add(1));
    const dx = d.x.div(max(min(size, cell.x.mul(G.fit)), pixelX));
    const dz = d.y.div(max(min(size.mul(look.streak.mul(G.stretch).add(1)), cell.y.mul(G.fit)), pixelH));
    const spot = exp(dx.mul(dx).add(dz.mul(dz)).negate());
    const rate = mix(float(G.rate[0]), float(G.rate[1]), h2);
    const twinkle = pow(sin(time.mul(rate).add(h3.mul(TAU))).mul(0.5).add(0.5), mix(float(G.sharp[0]), float(G.sharp[1]), feet));
    level = level.add(on.mul(spot).mul(twinkle).mul(feet.mul(G.feetGain).add(1)).mul(layer.gain));
  });
  // 卡片前面的水面
  const front = smoothstep(-0.02, 0.03, z);
  return look.glintColor.mul(level.mul(front).mul(G.gain));
}

/** p：水面上一點（卡寬，相對卡片正下方；x 右、y＝世界的 +z 朝鏡頭）。full：「水面樣子」那一份（霧、拉長、閃光、流動時間；省略＝平常那份）。 */
export function waterLook(p: V2, u: WaterUniforms, reflection: PlanarReflection, look: WaterLookUniforms, full = false): StageLook {
  const out = Fn(() => {
    const x = p.x;
    const z = p.y;
    const r = length(p);

    // ---- 細波紋：倒影左右偏一點（兩道波長、相位用雜訊打亂，才不是一條條整齊的橫紋）；乘〔波紋〕倍數 ----
    const amp = mix(float(WAVELETS.near), float(WAVELETS.far), saturate(z.div(WAVELETS.reach)));
    const phase = noise2(vec2(x.mul(1.6), z.mul(4.5))).mul(3.5);
    const w1 = sin(z.mul(WAVELETS.frequency[0]).add(u.time.mul(WAVELETS.speed[0])).add(phase));
    const w2 = sin(z.mul(WAVELETS.frequency[1]).add(x.mul(2.1)).add(u.time.mul(WAVELETS.speed[1])));
    const shiftX = amp.mul(w1.mul(0.62).add(w2.mul(0.38))).mul(look.ripple);

    // ---- 漣漪：同 water-layout.ts 的 waterRipple（count 圈錯開）；亮度與扭曲乘〔波紋〕倍數 ----
    const R = WATER_RIPPLE;
    const pixel = max(fwidth(r), 1e-5);
    let rippleA: F = float(0);
    let rippleShift: F = float(0);
    for (let k = 0; k < R.count; k++) {
      const age = fract(u.time.div(R.period).add(k / R.count));
      const ease = float(1).sub(pow(float(1).sub(age), 2));
      const radius = float(R.start).add(ease.mul(R.end - R.start));
      const width = float(R.width[0]).add(age.mul(R.width[1] - R.width[0]));
      const strength = min(age.div(0.08), 1).mul(pow(float(1).sub(age), 1.5)).mul(R.gain);
      const w = max(width, pixel.mul(0.8));
      const d = r.sub(radius).div(w);
      const profile = exp(d.mul(d).negate());
      rippleA = rippleA.add(profile.mul(width.div(w)).mul(strength));
      rippleShift = rippleShift.add(d.mul(profile).mul(strength));
    }
    rippleA = rippleA.mul(u.energy.mul(RIPPLE_ENERGY_BOOST).add(1)).mul(look.ripple);

    // ---- 倒影（已經越往下越淡）；〔倒影拉長〕大於 0 才多取樣、切成橫紋 ----
    const distort = vec2(shiftX, rippleShift.mul(R.distort / R.gain).mul(look.ripple));
    const reflLook = { fade: WATER_REFLECTION.fade, soften: WATER_REFLECTION.soften };
    const plain = reflection.sample(u.planeY, distort, reflLook);
    const reflColor = plain.color.toVar();
    const reflAlpha = plain.alpha.toVar();
    // 倒影裡的高度、倒影在卡片平面上的 x（water-layout.ts 的 reflectedX）：「水面樣子」那份才有
    const height = full ? reflectedHeightNode(u.planeY) : float(0);
    const cx = full ? x.mul(cameraPosition.z).div(max(cameraPosition.z.sub(z), 1e-3)) : float(0);
    // 濕的水面（「水面樣子」那份才有）：越靠近看的人整片越暗
    const wetness = full ? float(1).toVar() : null;
    if (wetness) {
      If(look.streak.greaterThan(0), () => {
        const S = WATER_STREAK;
        // 橫紋：倒影裡的高度方向很密、左右疏一點的雜訊（像濕柏油路的一條條反光），跟著水面流動的時間慢慢流
        const band = smoothstep(S.bandSoft[0], S.bandSoft[1], noise2(vec2(cx.mul(S.bandX), height.mul(S.band).add(u.flow.mul(0.35)))));
        const wobble = band.sub(0.5).mul(look.streak).mul(S.wobble);
        const long = reflection.stretch(u.planeY, distort, reflLook, plain, {
          amount: look.streak,
          taps: S.taps,
          base: S.base,
          perHeight: S.perHeight,
          wobble,
          height,
        });
        const lines = mix(float(1), mix(float(S.floor), float(S.peak), band), look.streak);
        reflColor.assign(long.color.mul(lines));
        reflAlpha.assign(long.alpha);
        // 同 water-layout.ts 的 waterWet
        const wet = pow(smoothstep(S.wetFrom, S.wetTo, height), S.wetCurve);
        wetness.assign(float(1).sub(wet.mul(S.wet).mul(sqrt(look.streak))));
      });
    }

    // ---- 水面：深色，斜看時映著夜空（菲涅耳），遠處一點點月光的微光（「水面樣子」那份跟著流動時間：波紋 0 時不動） ----
    const view = normalize(positionWorld.sub(cameraPosition));
    const grazing = float(1).sub(abs(view.y));
    const fresnel = pow(grazing, 5).mul(0.85).add(0.04);
    let color: V3 = mix(linear(DEEP), linear(SKY), fresnel.mul(float(1).sub(u.backdrop)));
    const sheen = pow(fbm(vec2(x.mul(0.7), z.mul(2.2).add((full ? u.flow : u.time).mul(0.05)))), 3);
    color = color.add(linear(MOON).mul(sheen.mul(fresnel).mul(0.25)));

    const gain = WATER_REFLECTION.gain;
    color = color.mul(float(1).sub(reflAlpha.mul(gain))).add(reflColor.mul(vec3(...COLD_TINT)).mul(gain));
    color = color.add(linear(MOON).mul(rippleA));
    color = color.add(linear(MOON).mul(exp(r.div(UNDER_RADIUS).pow(2).negate()).mul(UNDER_GLOW)));
    const shaded = color.toVar();
    if (wetness) shaded.mulAssign(wetness);

    if (full) {
      // ---- 閃光：〔閃光〕大於 0 才算 ----
      If(look.glint.greaterThan(0), () => {
        shaded.addAssign(glints(cx, z, height, u.time, look));
      });

      // ---- 霧：〔霧〕大於 0 才算；同 water-layout.ts 的 waterFog × mistHorizon，混進同一條直線上水平線那裡的天空 ----
      If(look.mist.greaterThan(0), () => {
        const run = cameraPosition.z.sub(z);
        const t = saturate(run.div(cameraPosition.z.add(WATER_BACKDROP.distance)));
        const fog = max(pow(t, WATER_FOG.power), float(1).sub(smoothstep(0, WATER_FOG.band, abs(view.y))));
        const farU = screenUV.x.sub(0.5).div(1 + WATER_BACKDROP.margin).add(0.5);
        const sky = mistSkyNode(farU, float(0), look.mistColor);
        shaded.assign(mix(shaded, sky, fog.mul(mistHorizonNode(look.mist))));
      });
    }

    // ---- 遠處淡進夜色（畫布透明，後面是 CSS 的水鏡底色）；有遠景時不淡（水面接到遠景平面的下緣，T-814） ----
    const dist = length(positionWorld.xz.sub(cameraPosition.xz));
    const alpha = max(float(1).sub(smoothstep(WATER_FADE[0], WATER_FADE[1], dist)), u.backdrop);
    return vec4(shaded.mul(alpha), alpha);
  })();
  return { color: out.xyz, alpha: out.w };
}
