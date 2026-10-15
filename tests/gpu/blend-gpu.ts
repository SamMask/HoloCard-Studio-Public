// GPU 回歸測試（T-413）：在開發伺服器打開 /tests/gpu/blend-gpu.html（加 ?webgl＝強制用 WebGL2 後端），
// 頁面自己跑完、顯示 PASS／FAIL，結果也放在 window.__gpuTest（{ done, pass, backend, checks }）給自動化讀。
// 加 ?only=15,16（節號，逗號分隔）只跑那幾節（開發時反向驗證用；驗收一定要跑全部）。各項：
//   1. 透明邊緣不變暗：亮色底上疊「不透明白色圓、透明處 RGB 是黑色」的立體層，縮小（zoom 0.45）＋斜看 40°，
//      和沒有這一層的畫面比：白色疊在亮底上，正確的結果不會比底暗；貼圖取樣沒有預乘 alpha 時，
//      透明處的黑色會混進邊緣（mipmap、斜看時更寬）。透明處 RGB 是白色的同一張圖也比一次。
//   2. 中性色在背景 > 1（鐳射光帶、閃星）時也不改變後面：發光＋黑、強光＋黑、加深＋白疊在開了鐳射的亮底上，
//      再蓋一層 50% 黑色；和沒有中性色層的畫面要一模一樣（以前會夾掉超過 1 的部分，露出一個方框）。
//      同一個背景上疊不透明的加深／發光（純黑、純白、灰）：超過 1 的部分照 compositeColor 的式子（加深乘 Cs、發光乘 1 − Cs），
//      GPU 和 TS 參考要對得上（純黑的墨擋住亮光、純白的發光不超過 1）。
//   3. 拖不透明度（同一個材質 100 → 0 → 37 → 100）畫面真的跟著變。
//   4. 七種模式在 GPU 上的結果＝blend.ts 的 compositeColor（TS 參考）。
//   5. 破框層（T-411）卡內卡外接得上：整片洋紅色的破框層（比卡大很多、最前面），各種角度下卡片輪廓兩側的像素
//      都要是不透明的洋紅色（沒有縫、沒有錯位、沒有露出卡身側邊）；關掉破框時卡外是透明的（對照組，證明真的有檢查到）；
//      轉到背面時看不到正面破框層超出的部分；全卡鐳射開到最亮時卡邊兩側也沒有色差（破框層整層不套鐳射，
//      對照組：同一層關掉破框時卡內真的有鐳射）；兩個破框層之間的景深陰影在卡邊接得上（T-411c：卡外網格也算影子，
//      對照組：卡內真的有影子）。
//   6. 反光層（T-417）：上傳黑白圖（左半黑、右半白）時右半＝整面、左半＝關，而且整面和關真的不一樣（對照）；
//      關（整面霧光）時沒有彩虹：霧光 0 時和鐳射強度 0 一模一樣，霧光開著時只多一層白（R、G、B 加得一樣多）；
//      用圖層形狀時亮面跟著圖層的位移走（亮面的範圍中心移動量＝圖層位移投影到螢幕上的量）；
//      選中反光層時的斜線（setFlash）只出現在亮面（黑白圖的白半邊），強度回到 0 時畫面和沒閃過一模一樣。
//   以前的 2.（中性色）用的是舊的「指定圖層」：改成正面的反光層「用圖層形狀」＋霧光 0（舊的範圍沒有霧光），檢查內容不變。
//   7. 卡框雕花邊角（T-416）：明寫簡約＝省略（一模一樣）；雕花邊角和簡約比，只有四個角的花紋正方形裡不一樣（外面最多差 1），
//      四個角都有花紋、正面看時四角一樣多（鏡射）；斜看、塔羅牌、背面也是；卡框關著時和簡約一模一樣；
//      整片不透明的破框層蓋住整張卡時，花紋看不到（連花紋的反鋸齒邊也不透出來：比簡約更不像破框層顏色的像素不到花紋的 1%）。
//   8. 線稿高光（T-802）：沒開線稿高光的卡和以前一模一樣（明寫 false＝省略；破框層、底圖帶了 true 不發光；鐳射強度 0 時開著也不亮：
//      都差 0；shader 結構和以前一樣另外在 tests/render-lineart-mesh.test.ts 用節點圖指紋驗）；
//      線稿層（白底黑線、加深模式、反光層「關」、霧光 0）：黑線處轉角度時顏色會變、而且變成亮線（沒開時是黑的），白底處和沒開一模一樣。
//   9. 剪裁遮色片（T-803）：沒有剪裁中的層的卡和以前一模一樣（明寫 false＝省略；下面是底圖、任一方破框時照一般層畫：都差 0；
//      shader 結構另外在 tests/render-clip-mesh.test.ts 驗）；剪裁層（整張卡大的洋紅條紋）只出現在下面那層（中間的深色方塊）的形狀裡：
//      0°、±30°（照視差公式設位移）時，方塊外面（留 0.03 卡寬的邊）和沒有剪裁層的畫面一模一樣（沒有條紋、也沒有剪裁層的影子），
//      方塊裡面＝沒剪裁時的條紋；對照組：同一層不剪裁時方塊外面真的有條紋；下面那層隱藏時照樣剪。
//  10. 雙圖光柵（T-805）：沒有變身圖＝以前（變身圖在破框層上、圖還沒準備好、只在背面：正面差 0；變身圖＝同一張圖時差 ≤ 1）；
//      純色紅 A／藍 B：0° 整個畫面＝只有 A 的卡、±20° 整個畫面＝只有 B 的卡（含影子，差 ≤ 1）；約 7° 同一排像素裡 A、B 都有、
//      而且來回交錯好幾次（條紋）；變身圖的透明邊沒有暗邊（20° 時和底色比、7° 換到一半時透明處黑／白一樣）；
//      背面照背面的角度（正對背面＝A、背面左右轉 20°＝B）；剪裁層的下面那層有變身圖時照混好的 alpha 剪；線稿高光照混好的顏色。
//  11. 透明卡套（T-806）：沒開卡套＝以前（差 0）、正面看卡片幾乎不變（差 ≤ 6）、斜看 60° 比正面亮、白邊看得到、
//      遠側從任何角度都不蓋到卡片（藏起遠側前後差 ≤ 2，MSAA 邊緣雜訊容許 EDGE_NOISE_PIXELS 個像素）、轉 30°／背面 150° 不霧、破框層伸出卡套外照樣畫（見 sleeveCheck）。
//  12. 卡片比例（T-807）：標準卡、塔羅牌和以前一樣（自訂 63:88、70:120 和標準卡、塔羅牌畫出來一模一樣，差 0；
//      改比例前後的畫面雜湊另外在施工時比過）；正方形、明信片、橫式自訂 3:2：整張卡在畫面裡（斜看也不碰畫布邊）、
//      四角圓角對稱（正面看四個角的卡片像素一樣多）、雕花邊角四角鏡射（只改四個角、四角變的一樣多）。
//  13. CD 光碟（T-810）：一般卡和以前一樣（明寫 kind 'card'＝省略、畫過光碟的物件換回卡片＝從沒畫過：都差 0）；
//      光碟孔裡與光碟外面透明（alpha 0，正面與背面）、透明圈半透明；印刷面圓環外的圖層被剪掉（比光碟大的洋紅圖層：圓環裡是洋紅、
//      透明圈不是、光碟外透明）；背面轉 180° 與 150°（＝背面轉 30°）彩虹的位置不同（扇形方向差 > 5°，GPU 量的和 disc.ts 的 CPU 算的對得上）；
//      背面在兩道扇形的方向比和它垂直的方向亮；鐳射強度 0 時沒有彩虹。
//  14. 局部動態特效（T-811）：沒開＝以前（fx 是 undefined、破框層帶 fx、三種強度 0：都差 0；shader 結構另外在
//      tests/render-lineart-mesh.test.ts 與 render-fx-mesh.test.ts 驗）；三種特效時間 0 與 1 秒畫面不同、0 與 4 秒（1.3 與 9.3 秒）
//      一模一樣（週期整除 4 秒）；形狀（圓）外面（再留 2 像素）完全不變（0°、25° 視差；剪裁到圓上的整片層開特效也一樣）；
//      減少動態時兩個時間一模一樣（effectClock），對照組不一樣。
//      T-811b 補：雙圖光柵層（0° 的特效範圍＝本來的圖、±20° ＝變身圖，另一張圖的位置不畫，對照組：沒有變身圖的層在該位置真的畫）；
//      非正常混合模式（發光的黑、加深的白那些中性色的地方不發光、其餘照樣發光，對照組：正常模式在黑色處真的發光）；
//      CD 光碟印刷面上的特效（孔裡、透明圈、光碟外面完全不變，圓環裡真的畫）；開著透明卡套時特效照樣畫（形狀外面不變）；
//      這兩項的「外面」容許 EDGE_NOISE_PIXELS 個 MSAA 邊緣雜訊像素（T-811c，特效真的畫出去是上萬個像素）。
//  15. 舞台背景圖（T-814）：水鏡沒設背景＝以前（從沒設過、設了又拿掉：整張差 0）；有背景時水平線上方是背景圖（約 85% 亮度）、
//      倒影區（水平線下面、卡片旁邊）的像素和沒背景不同而且是背景圖的顏色；星雲沒設＝以前（差 0）、設了漩渦讓出來（畫面變了）；
//      星雲加強（T-817，真的 /stages/nebula.webp）：換上大圖畫面變、換上又拿掉＝程式漩渦（差 0）；有自己的背景圖時有沒有大圖都一樣（差 0）；
//      10 秒後大圖與細絲轉了、星點閃了（畫面變），減少動態時連更新兩次一模一樣（差 0）；
//      T-817c 補：大圖轉動、細絲轉動、星點閃爍、光暈呼吸四種動畫各自分開驗（每次只讓一種動，其他固定；MSAA 0 逐位元；全固定＝差 0；
//      拿掉哪一種，對應那一項失敗）；這一節自己建的星雲大圖貼圖用完釋放；
//      匯出的「畫上背景」（card-view 的 composeCapture、轉動匯出每一格的底 paintBase）：四角是背景圖的顏色、照輸出比例置中裁
//      （左紅右藍的寬圖 → 左邊紅右邊藍；上中下三色的高圖 → 四角都是中間那色）、透明背景勾著也一樣；不勾＝和以前一樣（差 0）。
//  16. 水鏡遠景（T-815，真的三張圖 /stages/water-*.webp，經 stage-switch 組起來，同 card-view）：三種遠景水平線上方的取樣像素彼此不同、
//      不透明；倒影區（水平線下面、卡片旁邊）跟沒遠景比有變；倒影跟著波紋晃（時間走了倒影區變、水平線上方不變），減少動態時停住（差 0）；
//      有自己的背景圖時用背景圖不用遠景（背景圖＋遠景＝只有背景圖，差 0）；遠景設了又拿掉＝以前（差 0）；
//      T-815b 補：沒有遠景（從沒設過、設了又拿掉）對上 T-814 之前水鏡的固定參考數字（PARENT_WATER），有遠景的對照組對不上；
//      其他舞台（全息光環、展示廳、魔法陣、星雲、關閉）設了遠景也完全不變（差 0；MSAA 0 畫、另外多畫一張不呼叫 setter 的對照，T-811c）。
//  17. 遠景的位置與大小（T-822）：沒有 farPan＝以前（水鏡從沒設過位置 vs 設 {0,0,1}、匯出的「畫上背景」沒有 pan vs {0,0,1}：都差 0）；
//      水鏡（富士山）大小 2 時遠景跟大小 1 不同、大小 2 時 x＝1 跟 x＝0 不同、只改 y 完全不變（水鏡不用 y）；方向：四色條紋圖 x＝−1 時畫面左邊是最左那條、
//      x＝1 時右邊是最右那條；「畫上背景」的擷取照 farPan 裁：四色條紋的寬圖 x＝−1／1 四角顏色跟著變、大小 3 時四角都是最左那條，
//      三色的高圖 y＝−1 四角都是最上那色、y＝1 都是最下那色；轉動匯出每一格的底（paintBase）同一個裁法。
//  18. 水面樣子（T-825，water-look-scenes.ts 的四個水鏡畫面）：省略 waterLook＝T-825 以前（整張畫面的雜湊等於動工前在這台電腦取的
//      WATER_LOOK_BASELINE，兩種後端各一組；明寫〔夜色〕、先用霧白畫過再換回夜色也一樣）；霧 100（霧白色）時水平線上下兩邊都是霧色、
//      接縫看不出來；倒影拉長、閃光只改水面（水平線上方不變）、閃光多了暖色亮點；波紋 0 時水面幾乎不隨時間變、100 比 50 變得多；
//      卡片高度 0 只改倒影、卡片不動；地平線 0 時卡片那一塊和地平線 100 幾乎一樣、卡片腳邊上面那一帶換成遠景；
//      T-825d／T-817c 補：倒影拉長 100 時紅色色塊的倒影往下延伸、上方不延伸；波紋 0（閃光關著）時間往前走水平線下面整片差 0（逐位元，MSAA 0）。
//  19. 展示廳大廳（T-816b，真的 /stages/gallery-hall.webp、setGalleryHall(true)）：石地板讓出來換成透明的大廳地板（原本石地板蓋住的地方大多變透明）、
//      大廳地板上有卡片的倒影、卡片範圍（石地板版與大廳地板版）和只畫卡片一模一樣（差 0）、疊在大廳圖上地板範圍大多還是大廳圖本身的樣子。
//  20. 工作桌（T-832，壓克力展示座跟著卡片轉）：0°、±40°、背面、上下 ±10° 時，展示座沒蓋到的卡片和只畫卡片一模一樣（差 0，MSAA 0）、
//      夾塊蓋住的那一截隔著壓克力照樣看得到（平均差小、還是卡片的顏色）；展示座畫在卡片下面、轉 90° 時變窄（跟著卡片轉）；
//      桌上有影子、有自己的背景圖時影子讓出來（展示座照畫）；桌面映出卡片（偏紅的倒影）；破框層伸出卡外的部分照樣畫在壓克力前面
//      （卡片輪廓外的破框層連壓克力範圍裡也差 0）；開著透明卡套時卡套和展示座都畫。
//  21. 連舞台一起錄（T-850，card-view 的 captureTurntable stage，真的 createCardView）：不勾＝舊的路（魔法陣＝關閉，舞台不畫）、
//      拍過連舞台之後不勾的照舊；勾了畫面 320×180 不透明、3D 舞台真的畫進去、四角是 CSS 那層的底色、隔 0.3 秒再拍一樣（不看真的時間）、
//      水鏡的倒影每格都重畫（影格迴圈開著、預覽每格先畫正面時，正面那格的倒影仍比背面紅）。邊緣雜訊容許 EDGE_NOISE_PIXELS。
// WebGL2 的讀回靠 requestAnimationFrame：內建窗格沒顯示時會停住（WebGPU 不會）。

import { PerspectiveCamera, Scene, SRGBColorSpace, Texture, type Mesh } from 'three/webgpu';
import { aspectHeight, type CardShape } from '../../src/model/aspect';
import {
  ASPECT_HEIGHT,
  BLEND_MODES,
  type Card,
  type FaceSide,
  type FarPan,
  type Foil,
  type Frame,
  type FrameStyle,
  type Layer,
  type LayerFx,
  type StageStyle,
  type WaterScene,
} from '../../src/model/types';
import { effectClock } from '../../src/render/fx-nodes';
import { compositeColor } from '../../src/render/blend';
import { DISC_THICKNESS, discFanAngle, discOutline } from '../../src/render/disc';
import { createCardObject, type GetImage } from '../../src/render/card-mesh';
import { composeCapture, createCardView, paintBackdrop, paintBase, type BackdropImage, type GalleryThumb, type TurntableOptions } from '../../src/render/card-view';
import { paintScenery } from '../../src/render/stage-scenery';
import { createGalleryFx } from '../../src/render/gallery-fx';
import { createMagicFx } from '../../src/render/magic-fx';
import { createStageFx } from '../../src/render/stage-fx';
import { createStageSwitch, stageReach, type StageSwitch } from '../../src/render/stage-switch';
import { createNebulaFx } from '../../src/render/nebula-fx';
import { createDeskFx } from '../../src/render/desk-fx';
import { unpremultiply } from '../../src/render/pixels';
import { BACKDROP_LAYER, STAGE_LAYER } from '../../src/render/reflection';
import type { StageBackdrop } from '../../src/render/stage-switch';
import { createWaterFx } from '../../src/render/water-fx';
import { WATER_BACKDROP, waterGap, waterReach, waterY } from '../../src/render/water-layout';
import { DEFAULT_WATER_LOOK, MIST_WATER_LOOK } from '../../src/model/limits';
import { fnv1a, waterLookShots, type WaterLookShot } from './water-look-scenes';
import { cameraDistance, CARD_THICKNESS, cardBox, cardOutline, frameInner } from '../../src/render/fit';
import { ornateSize } from '../../src/render/frame';
import { projectCardPoint, type PickScene } from '../../src/render/pick';
import { parallaxOffset } from '../../src/interact/parallax';
import { createGpu, diff, layer, loadImage, makeImage, pixelAt, testCard, toDataUrl, type Diff, type Gpu, type GpuView, type Pose } from './gpu-harness';

const W = 800;
const H = 600;
/** 「明顯的暗邊」：比底色暗超過這麼多階（0～255）。 */
const DARK_EDGE = 10;
/** 修好之後允許的誤差（四捨五入、MSAA）。 */
const TOLERANCE = 3;
/**
 * 「某個東西不准畫到外面／不准蓋到卡片」這類檢查容許的邊緣雜訊像素數（T-811c）：4x MSAA 的讀回在極少數邊緣像素上不是逐位元穩定的——
 * 2026-10-15 在這台電腦實測：同一個場景、同樣的輸入、不走時間，連畫 6 張，約每 10 個場景有 1 個場景有 1 張的 6～40 個邊緣像素差 1～14 階
 * （WebGPU 與 WebGL2 都有；關掉 MSAA 後 40 個場景 × 6 張全部逐位元一樣）。真的畫出去、蓋上來的錯是成百上千個像素（特效外面至少
 * 幾萬個取樣點都會變、遠側蓋上來整張卡差幾十階），所以門檻只放在 16 個像素。要「差 0」的整張比對（其他舞台、水面不動）不用這個，
 * 改用 MSAA 0 畫（gpu.render 的 samples），雜訊的來源就沒了。
 */
const EDGE_NOISE_PIXELS = 16;
/** 倒影拉長 100（T-825d）：紅色色塊倒影最下面那列比不拉長時至少往下多幾列（實測約數十列）、最上面那列最多往上幾列（取樣誤差）。 */
const STREAK_EXTEND_MIN = 8;
const STREAK_TOP_SLACK = 2;
/**
 * 星雲四種動畫（大圖、細絲、星點、光暈）各自 10 秒前後畫面至少要差幾個位元組（T-817c）。MSAA 0 逐位元量過（2026-10-15，WebGPU）：
 * 大圖約 119 萬、細絲約 73 萬、星點約 2.2 萬、光暈約 15 萬；這裡取約一成：動畫拿掉＝差 0 一定失敗，變弱到只剩十分之一也失敗。
 */
const NEBULA_ANIM_MIN = { spin: 100_000, arms: 70_000, stars: 2_000, halo: 15_000 } as const;

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const out = document.getElementById('out')!;
const gallery = document.getElementById('gallery')!;

function log(line: string): void {
  out.textContent += `${line}\n`;
}

function show(label: string, url: string, scale = 1, width = W): void {
  const figure = document.createElement('figure');
  const img = document.createElement('img');
  img.src = url;
  img.style.width = `${width * scale}px`;
  img.style.imageRendering = 'pixelated';
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(img, caption);
  gallery.append(figure);
}

/** 中間 size×size 的一塊（放大看邊緣）。 */
function crop(px: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const x0 = Math.round(W / 2 - size / 2);
  const y0 = Math.round(H / 2 - size / 2);
  const outPx = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) outPx.set(px.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + size) * 4), y * size * 4);
  return outPx;
}

/** ref 比 x 亮的地方放大 gain 倍（白＝x 比較暗）。 */
function darkMap(ref: Uint8ClampedArray, x: Uint8ClampedArray, gain: number): Uint8ClampedArray {
  const m = new Uint8ClampedArray(ref.length);
  for (let i = 0; i < ref.length; i += 4) {
    const d = Math.max(ref[i]! - x[i]!, ref[i + 1]! - x[i + 1]!, ref[i + 2]! - x[i + 2]!, 0) * gain;
    m[i] = m[i + 1] = m[i + 2] = d;
    m[i + 3] = 255;
  }
  return m;
}

const fmt = (d: Diff) => `暗最多 ${d.darker}、最大差 ${d.maxAbs}、差 > 10 的像素 ${d.over}、平均差 ${d.meanAbs.toFixed(3)}`;

async function edgeCheck(view: GpuView): Promise<Check[]> {
  const bg = await makeImage(16, 16, () => [230, 230, 230, 255]);
  const disk = (outside: readonly [number, number, number]) =>
    makeImage(512, 512, (x, y) => ((x - 255.5) ** 2 + (y - 255.5) ** 2 <= 150 ** 2 ? [255, 255, 255, 255] : [...outside, 0]));
  const images = new Map([
    ['b000000000000000', bg],
    ['f000000000000000', await disk([0, 0, 0])],
    ['f111111111111111', await disk([255, 255, 255])],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6 });
  const card = (fig: string | null): Card => testCard(fig ? [base, layer('fig', fig, 50, { scale: 0.6 })] : [base]);

  const poses: Array<[string, Pose]> = [
    ['縮小 0.45＋斜 40°', { yaw: 40, pitch: 0, zoom: 0.45 }],
    ['縮小 0.45 正面', { yaw: 0, pitch: 0, zoom: 0.45 }],
    ['原大＋斜 40°', { yaw: 40, pitch: 0, zoom: 1 }],
  ];
  const checks: Check[] = [];
  for (const [label, pose] of poses) {
    const ref = await view.shot(card(null), getImage, pose);
    const black = await view.shot(card('f000000000000000'), getImage, pose);
    const white = await view.shot(card('f111111111111111'), getImage, pose);
    const dBlack = diff(ref, black, DARK_EDGE);
    const dWhite = diff(ref, white, DARK_EDGE);
    const dBetween = diff(white, black, DARK_EDGE);
    log(`  [${label}] 透明處黑：${fmt(dBlack)}`);
    log(`  [${label}] 透明處白：${fmt(dWhite)}`);
    log(`  [${label}] 黑 vs 白：最大差 ${dBetween.maxAbs}`);
    const pass = dBlack.darker <= TOLERANCE && dWhite.darker <= TOLERANCE && dBetween.maxAbs <= TOLERANCE;
    checks.push({ name: `1. 透明邊緣不變暗（${label}）`, pass, detail: `透明處黑暗 ${dBlack.darker}、透明處白暗 ${dWhite.darker}、黑白差 ${dBetween.maxAbs}` });
    if (pose.zoom === 0.45 && pose.yaw === 40) {
      show(`1. 縮小斜看、透明處黑（中間 160px 放大 3 倍）`, toDataUrl(crop(black, 160), 160, 160), 3, 160);
      show(`1. 比底色暗的地方 × 8（白＝暗邊）`, toDataUrl(crop(darkMap(ref, black, 8), 160), 160, 160), 3, 160);
    }
  }
  return checks;
}

async function neutralCheck(view: GpuView): Promise<Check[]> {
  const solid = (v: number) => makeImage(16, 16, () => [v, v, v, 255]);
  const images = new Map([
    ['b000000000000000', await solid(230)],
    ['k000000000000000', await solid(0)],
    ['w000000000000000', await solid(255)],
  ]);
  const getImage = (hash: string) => images.get(hash);
  // 底圖開鐳射（強度、閃星都開滿）：亮底＋光帶、閃星 → 合成時顏色超過 1
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6, holo: true });
  const half = layer('half', 'k000000000000000', 30, { scale: 2, opacity: 50 });
  const neutral = (blend: 'screen' | 'add' | 'multiply'): Layer =>
    layer(`n-${blend}`, blend === 'multiply' ? 'w000000000000000' : 'k000000000000000', 10, { scale: 2, blend, hasAlpha: false, holo: true });
  // 舊的「指定圖層」＝反光層「用圖層形狀」、卡框不反光；舊的沒有霧光，所以霧光 0（T-417）
  const card = (mid: Layer | null): Card => {
    const layers = mid ? [base, mid, half] : [base, half];
    return testCard(layers, {
      front: { layers, foil: { shape: 'layers', frame: false } },
      holo: { ...testCard([]).holo, strength: 100, sparkle: 100, matte: 0 },
    });
  };
  const pose: Pose = { yaw: 20, pitch: 10, zoom: 1, time: 1.3 };

  const ref = await view.shot(card(null), getImage, pose);
  // 背景真的超過 1 了沒：50% 黑之後還比 0.5 亮（> 130）的像素
  let bright = 0;
  for (let i = 0; i < ref.length; i += 4) if (ref[i + 3] === 255 && Math.max(ref[i]!, ref[i + 1]!, ref[i + 2]!) > 130) bright++;
  log(`  背景 > 1 的像素（50% 黑之後仍 > 130）：${bright}`);
  const checks: Check[] = [{ name: '2. 測試有效：背景真的有 > 1 的地方', pass: bright > 1000, detail: `${bright} 個像素` }];
  for (const blend of ['screen', 'add', 'multiply'] as const) {
    const x = await view.shot(card(neutral(blend)), getImage, pose);
    const d = diff(ref, x, 2);
    log(`  [${blend}] ${fmt(d)}`);
    checks.push({ name: `2. 中性色 ${blend} 不改變後面（背景 > 1）`, pass: d.maxAbs <= 2, detail: `最大差 ${d.maxAbs}、差 > 2 的像素 ${d.over}` });
    if (blend === 'screen') {
      show('2. 亮底＋鐳射＋50% 黑（沒有中性色層）', toDataUrl(ref, W, H), 0.5);
      show('2. 中間多一層發光＋純黑（要和左邊一樣）', toDataUrl(x, W, H), 0.5);
    }
  }

  // 不是中性色：不透明的加深／發光疊在同一個背景上，再蓋 50% 黑。ref＝Cb／2（螢幕上），所以 Cb≈2·ref（ref 被夾在 255 的不算）；
  // 每個像素要＝compositeColor（TS 參考：超出 1 的部分加深乘 Cs、發光乘 1 − Cs）的一半。純黑的墨＝0（擋住亮光）、純白的發光＝0.5。
  // 只看卡面中間一塊（卡身側邊不是合成出來的）
  const excessCases: Array<[blend: 'multiply' | 'screen', gray: number, label: string]> = [
    ['multiply', 0, '加深＋純黑'],
    ['multiply', 153, '加深＋0.6 灰'],
    ['screen', 255, '發光＋純白'],
    ['screen', 77, '發光＋0.3 灰'],
  ];
  for (const [blend, gray, label] of excessCases) {
    const hash = `g${gray.toString(16).padStart(2, '0')}`.padEnd(16, '0');
    if (!images.has(hash)) images.set(hash, await solid(gray));
    const top = layer(`x-${blend}-${gray}`, hash, 10, { scale: 2, blend, hasAlpha: false });
    const x = await view.shot(card(top), getImage, pose);
    const cs = { r: gray / 255, g: gray / 255, b: gray / 255 };
    let worst = 0;
    let counted = 0;
    let above = 0;
    for (let i = 0; i < ref.length; i += 4) {
      const px = (i / 4) % W;
      const py = Math.floor(i / 4 / W);
      if (Math.abs(px - W / 2) > 100 || Math.abs(py - H / 2) > 180) continue;
      if (ref[i]! >= 254 || ref[i + 1]! >= 254 || ref[i + 2]! >= 254) continue;
      const cb = { r: (2 * ref[i]!) / 255, g: (2 * ref[i + 1]!) / 255, b: (2 * ref[i + 2]!) / 255 };
      if (Math.max(cb.r, cb.g, cb.b) > 1.01) above++;
      const e = compositeColor(blend, cb, cs, 1);
      const want = [e.r, e.g, e.b].map((v) => (v / 2) * 255);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(x[i + c]! - want[c]!));
      counted++;
    }
    log(`  [${label}] 和 TS 參考最大差 ${worst.toFixed(1)}（${counted} 個像素，其中背景 > 1 的 ${above} 個）`);
    checks.push({ name: `2. ${label}在背景 > 1 時＝TS 參考（GPU＝TS）`, pass: worst <= 2.5 && above > 1000, detail: `最大差 ${worst.toFixed(1)}、背景 > 1 的像素 ${above}` });
  }
  return checks;
}

async function modeCheck(view: GpuView): Promise<Check[]> {
  const cb = [200, 120, 60] as const;
  const cs = [90, 180, 240] as const;
  const opacity = 60;
  const images = new Map([
    ['b000000000000000', await makeImage(16, 16, () => [...cb, 255])],
    ['c000000000000000', await makeImage(16, 16, () => [...cs, 255])],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6 });
  const pose: Pose = { yaw: 0, pitch: 0, zoom: 1 };
  const rgb = (c: readonly [number, number, number]) => ({ r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 });
  const checks: Check[] = [];
  for (const blend of BLEND_MODES) {
    const px = await view.shot(testCard([base, layer('top', 'c000000000000000', 50, { scale: 0.5, blend, opacity })]), getImage, pose);
    const got = pixelAt(px, W, W / 2, H / 2);
    const e = compositeColor(blend, rgb(cb), rgb(cs), opacity / 100);
    const want = [e.r, e.g, e.b].map((v) => Math.round(v * 255));
    const worst = Math.max(...got.map((v, i) => Math.abs(v - want[i]!)));
    log(`  [${blend}] GPU ${got.join(',')}／TS ${want.join(',')}`);
    checks.push({ name: `4. ${blend}：GPU＝TS 參考`, pass: worst <= 2, detail: `GPU ${got.join(',')}、TS ${want.join(',')}` });
  }
  return checks;
}

async function opacityCheck(view: GpuView): Promise<Check[]> {
  const images = new Map([
    ['b000000000000000', await makeImage(16, 16, () => [230, 230, 230, 255])],
    ['k000000000000000', await makeImage(16, 16, () => [0, 0, 0, 255])],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6 });
  const pose: Pose = { yaw: 0, pitch: 0, zoom: 1 };
  const front = view.obj.group.children[1] as Mesh;
  const values: Array<[number, number]> = [
    [100, 0],
    [0, 230],
    [37, Math.round(230 * (1 - 0.37))],
    [100, 0],
  ];
  let material: unknown = null;
  let sameMaterial = true;
  const seen: string[] = [];
  let pass = true;
  for (const [opacity, expected] of values) {
    const px = await view.shot(testCard([base, layer('ink', 'k000000000000000', 50, { scale: 0.4, opacity })]), getImage, pose);
    if (material === null) material = front.material;
    else if (front.material !== material) sameMaterial = false;
    const [r] = pixelAt(px, W, W / 2, H / 2);
    seen.push(`${opacity}→${r}（應 ${expected}）`);
    if (Math.abs(r - expected) > 2) pass = false;
  }
  log(`  中心像素：${seen.join('、')}；材質${sameMaterial ? '沒換' : '換了'}`);
  return [{ name: '3. 不透明度 100→0→37→100 畫面跟著變、材質不換', pass: pass && sameMaterial, detail: seen.join('、') }];
}

async function breakoutCheck(view: GpuView): Promise<Check[]> {
  // 400×500、四邊 4 像素透明的洋紅色圖（有透明才能當立體層）
  const magenta = await makeImage(400, 500, (x, y) => (x >= 4 && x < 396 && y >= 4 && y < 496 ? [255, 0, 255, 255] : [255, 0, 255, 0]));
  const images = new Map([
    ['b000000000000000', await makeImage(16, 16, () => [40, 60, 90, 255])],
    ['m000000000000000', magenta],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6 });
  const card = (breakout: boolean, holo = false) =>
    testCard(
      [base, layer('m', 'm000000000000000', 100, { scale: 2.4, breakout })],
      holo ? { holo: { ...testCard([]).holo, strength: 100, sparkle: 0 } } : {},
    );
  const outline = cardOutline(ASPECT_HEIGHT.standard, card(true).cornerRadius);
  /** 卡片輪廓直邊上的點（看著正面），各往內、往外 d（卡寬單位）。 */
  const edgePoints = (d: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let t = -0.4; t <= 0.4; t += 0.02) out.push([t, outline.halfH + d], [t, -outline.halfH - d]);
    for (let t = -0.55; t <= 0.55; t += 0.02) out.push([outline.halfW + d, t], [-outline.halfW - d, t]);
    return out;
  };
  const sample = (px: Uint8ClampedArray, pose: Pose, points: [number, number][]) => {
    const s: PickScene = {
      vFovDeg: 30,
      viewAspect: W / H,
      cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
      yawDeg: pose.yaw,
      pitchDeg: pose.pitch,
      outline,
      thickness: CARD_THICKNESS,
    };
    let worst = 0;
    let minAlpha = 255;
    let n = 0;
    for (const [x, y] of points) {
      const ndc = projectCardPoint('front', x, y, s);
      if (!ndc) continue;
      const cx = Math.floor(((ndc.x + 1) / 2) * W);
      const cy = Math.floor(((1 - ndc.y) / 2) * H);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const i = ((cy + oy) * W + cx + ox) * 4;
          worst = Math.max(worst, Math.abs(px[i]! - 255), px[i + 1]!, Math.abs(px[i + 2]! - 255));
          minAlpha = Math.min(minAlpha, px[i + 3]!);
          n++;
        }
    }
    return { worst, minAlpha, n };
  };
  const checks: Check[] = [];
  const poses: Pose[] = [
    { yaw: 0, pitch: 0, zoom: 0.6 },
    { yaw: 35, pitch: -15, zoom: 0.6 },
    { yaw: -50, pitch: 20, zoom: 0.6 },
    { yaw: 70, pitch: 0, zoom: 0.6 },
    { yaw: 10, pitch: 56, zoom: 0.6 },
  ];
  for (const pose of poses) {
    const px = await view.shot(card(true), getImage, pose);
    const seam = sample(px, pose, [...edgePoints(-0.006), ...edgePoints(0), ...edgePoints(0.006)]);
    log(`  [${pose.yaw}°／${pose.pitch}°] 輪廓兩側 ${seam.n} 點：最大色差 ${seam.worst}、最小 alpha ${seam.minAlpha}`);
    checks.push({
      name: `5. 破框層卡內卡外接得上（${pose.yaw}°／${pose.pitch}°）`,
      pass: seam.worst <= 3 && seam.minAlpha >= 252 && seam.n > 100,
      detail: `最大色差 ${seam.worst}、最小 alpha ${seam.minAlpha}`,
    });
    if (pose.yaw === 35) show(`破框 ${pose.yaw}°／${pose.pitch}°`, toDataUrl(px, W, H), 0.5);
  }
  // 對照組：關掉破框 → 卡外透明
  const offPose = poses[1]!;
  const off = sample(await view.shot(card(false), getImage, offPose), offPose, edgePoints(0.02));
  checks.push({ name: '5. 對照：關掉破框時卡外是透明的', pass: off.minAlpha === 0, detail: `卡外最小 alpha ${off.minAlpha}` });
  // 全卡鐳射開到最亮：破框層整層不套鐳射，卡邊兩側一樣是洋紅色
  for (const pose of [poses[1]!, poses[2]!]) {
    const px = await view.shot(card(true, true), getImage, pose);
    const seam = sample(px, pose, [...edgePoints(-0.006), ...edgePoints(0), ...edgePoints(0.006)]);
    log(`  [鐳射全卡 ${pose.yaw}°／${pose.pitch}°] 輪廓兩側最大色差 ${seam.worst}、最小 alpha ${seam.minAlpha}`);
    checks.push({
      name: `5. 全卡鐳射開著，卡邊兩側沒有色差（${pose.yaw}°／${pose.pitch}°）`,
      pass: seam.worst <= 3 && seam.minAlpha >= 252 && seam.n > 100,
      detail: `最大色差 ${seam.worst}、最小 alpha ${seam.minAlpha}`,
    });
  }
  // 對照組：關掉破框時，卡內靠邊的地方真的有鐳射（證明上面那項有檢查到）
  const holoPose = poses[1]!;
  const lit = sample(await view.shot(card(false, true), getImage, holoPose), holoPose, edgePoints(-0.02));
  checks.push({ name: '5. 對照：關掉破框時卡內有鐳射', pass: lit.worst > 10, detail: `卡內最大色差 ${lit.worst}` });
  // 破框層之間的景深陰影（T-411c）：後面整片洋紅（深度 1）、前面一塊白色方塊（深度 100）跨過卡片上緣，
  // 影子往右下落在洋紅上、也跨過上緣；上緣內外對稱的兩點顏色要一樣
  const white = await makeImage(64, 64, (x, y) => (x >= 2 && x < 62 && y >= 2 && y < 62 ? [255, 255, 255, 255] : [255, 255, 255, 0]));
  images.set('w000000000000000', white);
  const shadowCard = testCard(
    [
      base,
      layer('m', 'm000000000000000', 1, { scale: 2.4, breakout: true }),
      layer('w', 'w000000000000000', 100, { scale: 0.4, x: 0.05, y: 0.7, breakout: true }),
    ],
    { shadow: { strength: 100, distance: 100 } },
  );
  for (const pose of [poses[0]!, { yaw: 25, pitch: -10, zoom: 0.6 }]) {
    const px = await view.shot(shadowCard, getImage, pose);
    const s: PickScene = {
      vFovDeg: 30,
      viewAspect: W / H,
      cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
      yawDeg: pose.yaw,
      pitchDeg: pose.pitch,
      outline,
      thickness: CARD_THICKNESS,
    };
    /** 卡面上一點的像素（ox、oy＝螢幕上再偏幾個像素）。 */
    const at = (x: number, y: number, ox = 0, oy = 0) => {
      const ndc = projectCardPoint('front', x, y, s)!;
      const i = ((Math.floor(((1 - ndc.y) / 2) * H) + oy) * W + Math.floor(((ndc.x + 1) / 2) * W) + ox) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!];
    };
    let worst = 0;
    let darkest = 0;
    for (let x = -0.4; x <= 0.45; x += 0.005) {
      const inside = at(x, outline.halfH - 0.008);
      // 卡外那一點附近 3×3 裡最接近的：斜看時白色方塊的邊在螢幕上是斜的，剛好壓在邊上的點反鋸齒程度不同，不算接縫
      let best = Infinity;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const outside = at(x, outline.halfH + 0.008, ox, oy);
          best = Math.min(best, Math.max(...inside.map((v, c) => Math.abs(v - outside[c]!))));
        }
      worst = Math.max(worst, best);
      darkest = Math.max(darkest, 255 - inside[0]!);
    }
    log(`  [影子 ${pose.yaw}°／${pose.pitch}°] 上緣內外色差最多 ${worst}、卡內影子最暗壓了 ${darkest}`);
    checks.push({
      name: `5. 破框層之間的影子在卡邊接得上（${pose.yaw}°／${pose.pitch}°）`,
      pass: worst <= 6 && darkest > 40,
      detail: `內外色差最多 ${worst}、卡內影子壓暗 ${darkest}（對照：要 > 40）`,
    });
    if (pose.yaw === 25) show(`破框影子 ${pose.yaw}°／${pose.pitch}°`, toDataUrl(px, W, H), 0.5);
  }
  // 背面：看不到正面破框層超出的部分
  const back = await view.shot(card(true), getImage, { yaw: 180, pitch: 0, zoom: 0.6 });
  let magentaPx = 0;
  for (let i = 0; i < back.length; i += 4) if (back[i + 3]! > 8 && back[i]! > 200 && back[i + 1]! < 60 && back[i + 2]! > 200) magentaPx++;
  checks.push({ name: '5. 轉到背面看不到正面破框層', pass: magentaPx === 0, detail: `洋紅色像素 ${magentaPx}` });
  return checks;
}

async function foilCheck(view: GpuView): Promise<Check[]> {
  const solid = (v: number) => makeImage(16, 16, () => [v, v, v, 255]);
  // 黑白圖：左半黑、右半白（正方形；卡片 1 × 1.4 照 cover 貼滿，分界剛好在卡片正中間）
  const half = await makeImage(64, 64, (x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const images = new Map([
    ['b000000000000000', await solid(128)],
    ['m000000000000000', half],
    ['g000000000000000', await makeImage(128, 128, (x, y) => (x >= 4 && x < 124 && y >= 4 && y < 124 ? [150, 150, 150, 255] : [150, 150, 150, 0]))],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6 });
  const pose: Pose = { yaw: 22, pitch: 12, zoom: 1, time: 1.3 };
  const holoOn = (matte: number) => ({ ...testCard([]).holo, strength: 100, sparkle: 0, matte });
  const card = (foil: Foil | undefined, matte = 0, strength = 100): Card =>
    testCard([base], { front: foil ? { layers: [base], foil } : { layers: [base] }, holo: { ...holoOn(matte), strength } });
  const s: PickScene = {
    vFovDeg: 30,
    viewAspect: W / H,
    cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
    yawDeg: pose.yaw,
    pitchDeg: pose.pitch,
    outline: cardOutline(ASPECT_HEIGHT.standard, testCard([]).cornerRadius),
    thickness: CARD_THICKNESS,
  };
  /** 卡面上一塊區域（卡寬單位）裡每個點的像素差，取最大。 */
  const region = (a: Uint8ClampedArray, b: Uint8ClampedArray, x0: number, x1: number) => {
    let worst = 0;
    let n = 0;
    for (let x = x0; x <= x1; x += 0.02)
      for (let y = -0.55; y <= 0.55; y += 0.02) {
        const ndc = projectCardPoint('front', x, y, s);
        if (!ndc) continue;
        const px = pixelAt(a, W, ((ndc.x + 1) / 2) * W, ((1 - ndc.y) / 2) * H);
        const qx = pixelAt(b, W, ((ndc.x + 1) / 2) * W, ((1 - ndc.y) / 2) * H);
        worst = Math.max(worst, ...px.map((v, i) => Math.abs(v - qx[i]!)));
        n++;
      }
    return { worst, n };
  };
  const checks: Check[] = [];

  // 6a. 黑白圖：右半＝整面、左半＝關（分界附近 0.06 卡寬不算：貼圖濾波）
  const full = await view.shot(card(undefined), getImage, pose);
  const none = await view.shot(card({ shape: 'none', frame: false }), getImage, pose);
  const masked = await view.shot(card({ shape: 'mask', mask: 'm000000000000000', frame: false }), getImage, pose);
  const contrast = region(full, none, -0.45, 0.45);
  const right = region(masked, full, 0.06, 0.45);
  const left = region(masked, none, -0.45, -0.06);
  log(`  [黑白圖] 整面 vs 關最大差 ${contrast.worst}；右半 vs 整面 ${right.worst}、左半 vs 關 ${left.worst}（各 ${right.n}／${left.n} 點）`);
  checks.push({ name: '6. 對照：整面和關看得出不同', pass: contrast.worst > 20, detail: `最大差 ${contrast.worst}` });
  checks.push({
    name: '6. 黑白圖左半黑右半白：右半＝整面、左半＝關',
    pass: right.worst <= 2 && left.worst <= 2 && right.n > 100 && left.n > 100,
    detail: `右半差 ${right.worst}、左半差 ${left.worst}`,
  });
  show('6. 黑白圖（左半霧光、右半亮面）', toDataUrl(masked, W, H), 0.5);

  // 6a'. 選中反光層時的斜線：只在亮面（右半）出現；強度回 0 時和沒閃過一模一樣
  const maskCard = card({ shape: 'mask', mask: 'm000000000000000', frame: false });
  view.obj.setFlash('front', 1);
  const flashing = await view.shot(maskCard, getImage, pose);
  view.obj.setFlash('front', 0);
  const after = await view.shot(maskCard, getImage, pose);
  const leftFlash = region(flashing, masked, -0.45, -0.06);
  const rightFlash = region(flashing, masked, 0.06, 0.45);
  const back = region(after, masked, -0.45, 0.45);
  log(`  [斜線] 左半（霧光）差 ${leftFlash.worst}、右半（亮面）差 ${rightFlash.worst}；關掉後和沒閃過的差 ${back.worst}`);
  checks.push({
    name: '6. 斜線只在亮面、關掉後畫面不變',
    pass: leftFlash.worst <= 1 && rightFlash.worst > 15 && back.worst === 0,
    detail: `左半 ${leftFlash.worst}、右半 ${rightFlash.worst}、關掉後 ${back.worst}`,
  });
  show('6. 斜線（右半亮面）', toDataUrl(flashing, W, H), 0.5);

  // 6b. 關（整面霧光）：霧光 0 時和鐳射強度 0 一模一樣（沒有彩虹）；霧光 100 時只多一層白（三個通道加得一樣多）
  const off = await view.shot(card(undefined, 0, 0), getImage, pose);
  const noneMatte0 = region(none, off, -0.45, 0.45);
  const misty = await view.shot(card({ shape: 'none', frame: false }, 100), getImage, pose);
  let lifted = 0;
  let chroma = 0;
  for (let x = -0.45; x <= 0.45; x += 0.02)
    for (let y = -0.6; y <= 0.6; y += 0.02) {
      const ndc = projectCardPoint('front', x, y, s);
      if (!ndc) continue;
      const at = [((ndc.x + 1) / 2) * W, ((1 - ndc.y) / 2) * H] as const;
      const a = pixelAt(misty, W, at[0], at[1]);
      const b = pixelAt(off, W, at[0], at[1]);
      const d = a.map((v, i) => v - b[i]!);
      lifted = Math.max(lifted, Math.min(...d));
      chroma = Math.max(chroma, Math.max(...d) - Math.min(...d));
    }
  log(`  [關] 霧光 0 vs 強度 0 最大差 ${noneMatte0.worst}；霧光 100 最多亮了 ${lifted}、三通道差最多 ${chroma}`);
  checks.push({ name: '6. 關＋霧光 0：沒有彩虹（＝鐳射強度 0）', pass: noneMatte0.worst <= 1, detail: `最大差 ${noneMatte0.worst}` });
  checks.push({ name: '6. 霧光是白色的光帶（沒有顏色）', pass: lifted > 20 && chroma <= 3, detail: `最多亮 ${lifted}、三通道差 ${chroma}` });
  show('6. 整面霧光（霧光 100）', toDataUrl(misty, W, H), 0.5);

  // 6d. 中性的混合層不改亮面／霧光的比例（T-417b）：用圖層形狀、底圖勾反光，上面蓋一整片沒勾反光、不透明、50% 灰的疊色層
  // （顏色本來就不變）；霧光開滿、斜線開著，和沒有這一層的畫面要一樣。修之前這一層會把亮面比例改成 0、霧光改成 1
  images.set('n000000000000000', await solid(128));
  const litBase = layer('base', 'b000000000000000', 0, { scale: 1.6, holo: true });
  const neutralCard = (withGray: boolean): Card => {
    const layers = withGray ? [litBase, layer('gray', 'n000000000000000', 40, { scale: 2, blend: 'overlay' })] : [litBase];
    return testCard(layers, { front: { layers, foil: { shape: 'layers', frame: false } }, holo: holoOn(100) });
  };
  view.obj.setFlash('front', 1);
  const plain = await view.shot(neutralCard(false), getImage, pose);
  const covered = await view.shot(neutralCard(true), getImage, pose);
  view.obj.setFlash('front', 0);
  const neutralDiff = region(covered, plain, -0.45, 0.45);
  log(`  [中性疊色層] 有／沒有 50% 灰疊色層的最大差 ${neutralDiff.worst}（${neutralDiff.n} 點）`);
  checks.push({
    name: '6. 中性的疊色層（50% 灰）不改亮面／霧光比例',
    pass: neutralDiff.worst <= 2 && neutralDiff.n > 100,
    detail: `最大差 ${neutralDiff.worst}`,
  });

  // 6c. 用圖層形狀：亮面跟著圖層的位移走
  const fig = layer('fig', 'g000000000000000', 60, { scale: 0.4, holo: true });
  const figCard = (strength: number): Card =>
    testCard([base, fig], { front: { layers: [base, fig], foil: { shape: 'layers', frame: false } }, holo: { ...holoOn(0), strength } });
  /** 這一層位移 dx（卡寬）時，亮面（強度 100 和 0 差很多的像素）的水平中心。 */
  const centroid = async (dx: number) => {
    // 先畫一次建好材質，再設這一層的位移（shot 只更新卡片、不動位移；強度 0 只改 uniform，位移留著）
    await view.shot(figCard(100), getImage, pose);
    view.obj.offsets('front')[1]!.set(dx, 0);
    const lit = await view.shot(figCard(100), getImage, pose);
    const dark = await view.shot(figCard(0), getImage, pose);
    view.obj.offsets('front')[1]!.set(0, 0);
    let sx = 0;
    let n = 0;
    for (let i = 0; i < lit.length; i += 4) {
      const d = Math.max(Math.abs(lit[i]! - dark[i]!), Math.abs(lit[i + 1]! - dark[i + 1]!), Math.abs(lit[i + 2]! - dark[i + 2]!));
      if (d > 12) {
        sx += (i / 4) % W;
        n++;
      }
    }
    return { x: n > 0 ? sx / n : NaN, n };
  };
  const at0 = await centroid(0);
  const at15 = await centroid(0.15);
  const p0 = projectCardPoint('front', 0, 0, s)!;
  const p1 = projectCardPoint('front', 0.15, 0, s)!;
  const expected = ((p1.x - p0.x) / 2) * W;
  const moved = at15.x - at0.x;
  log(`  [用圖層形狀] 亮面像素 ${at0.n}／${at15.n}，中心移動 ${moved.toFixed(1)} px（應 ${expected.toFixed(1)} px）`);
  checks.push({
    name: '6. 用圖層形狀：亮面跟著圖層的位移走',
    pass: at0.n > 500 && at15.n > 500 && Math.abs(moved - expected) <= 4,
    detail: `移動 ${moved.toFixed(1)} px、應 ${expected.toFixed(1)} px`,
  });
  return checks;
}

// 卡框雕花邊角（T-416）與卡片比例（T-807）共用：四個角的花紋正方形、兩張圖逐角比較
type Box = { x0: number; x1: number; y0: number; y1: number };
/** 四個角的花紋正方形在畫面上的外框（像素，多留 3 像素）：左上、左下、右上、右下（看著那一面）。 */
const cornerBoxes = (pose: Pose, shape: CardShape, face: FaceSide = 'front'): Box[] => {
  const s: PickScene = {
    vFovDeg: 30,
    viewAspect: W / H,
    cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(aspectHeight(shape))),
    yawDeg: pose.yaw,
    pitchDeg: pose.pitch,
    outline: cardOutline(aspectHeight(shape), testCard([]).cornerRadius),
    thickness: CARD_THICKNESS,
  };
  const o = s.outline;
  const size = ornateSize(0.03, o);
  const boxes: Box[] = [];
  for (const sx of [-1, 1])
    for (const sy of [1, -1]) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const x of [sx * o.halfW, sx * (o.halfW - size)])
        for (const y of [sy * o.halfH, sy * (o.halfH - size)]) {
          const ndc = projectCardPoint(face, x, y, s);
          if (!ndc) continue;
          const px = ((ndc.x + 1) / 2) * W;
          const py = ((1 - ndc.y) / 2) * H;
          x0 = Math.min(x0, px);
          x1 = Math.max(x1, px);
          y0 = Math.min(y0, py);
          y1 = Math.max(y1, py);
        }
      boxes.push({ x0: Math.floor(x0) - 3, x1: Math.ceil(x1) + 3, y0: Math.floor(y0) - 3, y1: Math.ceil(y1) + 3 });
    }
  return boxes;
};
/** 兩張圖比：每個角的方框裡差超過 over 的像素數；方框外面最大差（RGBA 都算）。 */
const compare = (a: Uint8ClampedArray, b: Uint8ClampedArray, boxes: Box[], over = 12) => {
  const inBox = boxes.map(() => 0);
  let outside = 0;
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const d = Math.max(
        Math.abs(a[i]! - b[i]!),
        Math.abs(a[i + 1]! - b[i + 1]!),
        Math.abs(a[i + 2]! - b[i + 2]!),
        Math.abs(a[i + 3]! - b[i + 3]!),
      );
      const k = boxes.findIndex((q) => px >= q.x0 && px <= q.x1 && py >= q.y0 && py <= q.y1);
      if (k < 0) outside = Math.max(outside, d);
      else if (d > over) inBox[k]!++;
    }
  return { inBox, outside };
};

async function ornateCheck(view: GpuView): Promise<Check[]> {
  const magenta = await makeImage(400, 500, (x, y) => (x >= 4 && x < 396 && y >= 4 && y < 496 ? [255, 0, 255, 255] : [255, 0, 255, 0]));
  const images = new Map([
    ['b000000000000000', await makeImage(16, 16, () => [40, 60, 90, 255])],
    ['m000000000000000', magenta],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.8 });
  interface Opt {
    style?: FrameStyle;
    enabled?: boolean;
    shape?: CardShape;
    breakout?: boolean;
  }
  /** 金色卡框（寬 0.03、光澤 50），沒有鐳射；背面是素色卡背（也有卡框）。 */
  const card = (o: Opt): Card => {
    const layers = o.breakout ? [base, layer('m', 'm000000000000000', 100, { scale: 2.4, breakout: true })] : [base];
    const frame: Frame = { enabled: o.enabled ?? true, width: 0.03, color: '#d4af37', shine: 50 };
    return testCard(layers, { ...(o.shape ?? { aspect: 'standard' }), frame: o.style ? { ...frame, style: o.style } : frame });
  };
  const checks: Check[] = [];

  // 7a. 明寫簡約＝省略
  const front: Pose = { yaw: 0, pitch: 0, zoom: 1 };
  const same = compare(await view.shot(card({}), getImage, front), await view.shot(card({ style: 'simple' }), getImage, front), []);
  log(`  [簡約] 明寫 simple vs 省略：最大差 ${same.outside}`);
  checks.push({ name: '7. 明寫簡約＝省略（畫面一模一樣）', pass: same.outside === 0, detail: `最大差 ${same.outside}` });

  // 7b. 雕花邊角只改四個角（正面、斜看、塔羅牌、背面）
  const cases: { label: string; pose: Pose; shape: CardShape; face: FaceSide; min: number }[] = [
    { label: '正面', pose: front, shape: { aspect: 'standard' }, face: 'front', min: 400 },
    { label: '斜看 30°／−12°', pose: { yaw: 30, pitch: -12, zoom: 1 }, shape: { aspect: 'standard' }, face: 'front', min: 250 },
    { label: '塔羅牌', pose: front, shape: { aspect: 'tarot' }, face: 'front', min: 300 },
    { label: '背面（素色卡背）', pose: { yaw: 180, pitch: 0, zoom: 1 }, shape: { aspect: 'standard' }, face: 'back', min: 400 },
  ];
  for (const c of cases) {
    const boxes = cornerBoxes(c.pose, c.shape, c.face);
    const a = await view.shot(card({ shape: c.shape }), getImage, c.pose);
    const b = await view.shot(card({ shape: c.shape, style: 'ornate' }), getImage, c.pose);
    const r = compare(a, b, boxes);
    log(`  [雕花・${c.label}] 四角（左上、左下、右上、右下）變了 ${r.inBox.join('／')} 像素；方框外最大差 ${r.outside}`);
    let pass = r.inBox.every((n) => n >= c.min) && r.outside <= 1;
    let detail = `四角 ${r.inBox.join('／')}、外面最大差 ${r.outside}`;
    if (c.label === '正面') {
      // 正面看時四角是鏡射：變了的像素差不多一樣多。卡框的斜面與高光有光的方向，鏡射的兩角本來就不會逐像素相同，
      // 花紋縮到 0.2 卡寬（使用者 2026-10-14）後比例更容易晃（量到 13%）；鏡射的數學在 tests/render-frame-ornate.test.ts 驗
      const spread = (Math.max(...r.inBox) - Math.min(...r.inBox)) / Math.max(...r.inBox);
      pass &&= spread < 0.2;
      detail += `、四角差 ${(spread * 100).toFixed(1)}%`;
    }
    if (c.label !== '背面（素色卡背）') show(`7. 雕花邊角（${c.label}）`, toDataUrl(b, W, H), 0.5);
    checks.push({ name: `7. 雕花邊角只在四個角（${c.label}）`, pass, detail });
  }

  // 7c. 卡框關著：沒有花紋
  const off = compare(
    await view.shot(card({ enabled: false }), getImage, front),
    await view.shot(card({ enabled: false, style: 'ornate' }), getImage, front),
    [],
  );
  log(`  [卡框關] 雕花 vs 簡約最大差 ${off.outside}`);
  checks.push({ name: '7. 卡框關著時沒有花紋（和簡約一模一樣）', pass: off.outside <= 1, detail: `最大差 ${off.outside}` });

  // 7d. 破框層仍在最上面：整片不透明的洋紅色破框層蓋住整張卡 → 花紋看不到。細花紋縮小後大半是反鋸齒邊，邊上也不能透出來：
  // 每個像素離洋紅色多遠，雕花不能比簡約遠。
  const pose: Pose = { yaw: 20, pitch: 8, zoom: 0.6 };
  const boxes = cornerBoxes(pose, { aspect: 'standard' });
  const control = compare(await view.shot(card({}), getImage, pose), await view.shot(card({ style: 'ornate' }), getImage, pose), boxes);
  const visible = control.inBox.reduce((x, y) => x + y, 0);
  const coveredSimple = await view.shot(card({ breakout: true }), getImage, pose);
  const coveredOrnate = await view.shot(card({ breakout: true, style: 'ornate' }), getImage, pose);
  const offMagenta = (px: Uint8ClampedArray, i: number) => Math.max(255 - px[i]!, px[i + 1]!, 255 - px[i + 2]!);
  // T-411d：量兩側直線內緣附近一排像素，包含反鋸齒的半覆蓋像素；不透明破框層應完全蓋住框色。
  // 避開四角與卡片外緣；使用同一張未蓋住的卡作對照，證明這排像素確實掃到卡框。
  const uncoveredSimple = await view.shot(card({}), getImage, pose);
  const edgeScene: PickScene = {
    vFovDeg: 30,
    viewAspect: W / H,
    cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
    yawDeg: pose.yaw,
    pitchDeg: pose.pitch,
    outline: cardOutline(ASPECT_HEIGHT.standard, testCard([]).cornerRadius),
    thickness: CARD_THICKNESS,
  };
  const inner = frameInner(edgeScene.outline, 0.03);
  const edgePixels = new Set<number>();
  for (const sign of [-1, 1])
    for (let y = -0.45; y <= 0.45; y += 0.005) {
      const ndc = projectCardPoint('front', sign * inner.halfW, y, edgeScene);
      if (!ndc) continue;
      const px = Math.floor(((ndc.x + 1) / 2) * W);
      const py = Math.floor(((1 - ndc.y) / 2) * H);
      for (let dx = -1; dx <= 1; dx++)
        if (px + dx >= 0 && px + dx < W && py >= 0 && py < H) edgePixels.add((py * W + px + dx) * 4);
    }
  let edgeWorst = 0;
  let edgeLeaks = 0;
  let edgeMinAlpha = 255;
  let frameControl = 0;
  for (const i of edgePixels) {
    const d = offMagenta(coveredSimple, i);
    edgeWorst = Math.max(edgeWorst, d);
    if (d > TOLERANCE) edgeLeaks++;
    edgeMinAlpha = Math.min(edgeMinAlpha, coveredSimple[i + 3]!);
    const change = Math.max(...[0, 1, 2].map((k) => Math.abs(uncoveredSimple[i + k]! - coveredSimple[i + k]!)));
    if (change > 20) frameControl++;
  }
  log(`  [簡約內緣] ${edgePixels.size} 像素，離破框層顏色最多 ${edgeWorst}、透框 ${edgeLeaks}、最小 alpha ${edgeMinAlpha}；未蓋住對照不同 ${frameControl} 像素`);
  checks.push({
    name: '7. 簡約卡框＋不透明破框層，卡框內緣沒有框色細線',
    pass: edgePixels.size > 100 && frameControl > 100 && edgeLeaks === 0 && edgeMinAlpha >= 252,
    detail: `${edgePixels.size} 像素、最大色差 ${edgeWorst}、透框 ${edgeLeaks}、對照不同 ${frameControl}`,
  });
  let leak = 0;
  let worst = 0;
  let frameEdge = 0;
  for (const q of boxes)
    for (let py = Math.max(0, q.y0); py <= Math.min(H - 1, q.y1); py++)
      for (let px = Math.max(0, q.x0); px <= Math.min(W - 1, q.x1); px++) {
        const i = (py * W + px) * 4;
        const extra = offMagenta(coveredOrnate, i) - offMagenta(coveredSimple, i);
        worst = Math.max(worst, extra);
        if (extra > 3) leak++;
        if (offMagenta(coveredSimple, i) > 24) frameEdge++;
      }
  const outside = compare(coveredSimple, coveredOrnate, boxes).outside;
  log(
    `  [破框層在上面] 沒有破框時花紋 ${visible} 像素；蓋上破框層後雕花比簡約更透出來的像素 ${leak}（最多多 ${worst}）；` +
      `簡約偏離破框層顏色的像素 ${frameEdge}；方框外最大差 ${outside}`,
  );
  checks.push({
    name: '7. 破框層蓋在花紋上面',
    pass: visible > 400 && leak <= visible * 0.01 && outside <= 1,
    detail: `花紋 ${visible} 像素；蓋住後更透出來的 ${leak}、最多多 ${worst}`,
  });
  show('7. 破框層蓋住花紋', toDataUrl(coveredOrnate, W, H), 0.5);
  return checks;
}

async function lineartCheck(view: GpuView): Promise<Check[]> {
  // 線稿：左半黑、右半白，不透明（沒有透明的圖當加深層，白底會消失）；底圖中間灰
  const ink = await makeImage(64, 64, (x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const images = new Map([
    ['b000000000000000', await makeImage(16, 16, () => [128, 128, 128, 255])],
    ['i000000000000000', ink],
    ['m000000000000000', await makeImage(400, 500, (x, y) => (x >= 4 && x < 396 && y >= 4 && y < 496 ? [20, 20, 20, 255] : [20, 20, 20, 0]))],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6, holo: true });
  const inkLayer = (over: Partial<Layer> = {}) => layer('ink', 'i000000000000000', 60, { scale: 2, blend: 'multiply', hasAlpha: false, ...over });
  const holo = (strength: number, matte = 0) => ({ ...testCard([]).holo, strength, sparkle: 100, matte });
  const checks: Check[] = [];

  // 8a. 沒開線稿高光＝以前：整面鐳射＋卡框＋影子＋破框層的一般卡，各種「沒開」的寫法都差 0
  const frame: Frame = { enabled: true, width: 0.03, color: '#d4af37', shine: 50 };
  const rich = (ink: Layer, fig: Layer, strength = 100): Card =>
    testCard([base, ink, fig], { holo: holo(strength, 40), frame, shadow: { strength: 80, distance: 60 } });
  const fig = (over: Partial<Layer> = {}) => layer('fig', 'm000000000000000', 90, { scale: 0.5, x: 0.1, holo: true, ...over });
  const poses: Pose[] = [
    { yaw: -25, pitch: 8, zoom: 0.8, time: 0.7 },
    { yaw: 25, pitch: -8, zoom: 0.8, time: 0.7 },
  ];
  const same: Array<[string, () => [Card, Card]]> = [
    ['明寫 lineart: false＝省略', () => [rich(inkLayer(), fig()), rich(inkLayer({ lineart: false }), fig())]],
    ['破框層帶 true 不發光', () => [rich(inkLayer(), fig({ breakout: true })), rich(inkLayer(), fig({ breakout: true, lineart: true }))]],
    ['底圖帶 true（壞資料）不發光', () => [rich(inkLayer(), fig()), testCard([{ ...base, lineart: true }, inkLayer(), fig()], { holo: holo(100, 40), frame, shadow: { strength: 80, distance: 60 } })]],
    ['鐳射強度 0：開著也不亮', () => [rich(inkLayer(), fig(), 0), rich(inkLayer({ lineart: true }), fig({ lineart: true }), 0)]],
  ];
  for (const [label, make] of same) {
    let worst = 0;
    for (const pose of poses) {
      const [a, b] = make();
      worst = Math.max(worst, diff(await view.shot(a, getImage, pose), await view.shot(b, getImage, pose), 0).maxAbs);
    }
    log(`  [沒開＝以前・${label}] 最大差 ${worst}`);
    checks.push({ name: `8. 沒開線稿高光的卡和以前一模一樣（${label}）`, pass: worst === 0, detail: `最大差 ${worst}` });
  }

  // 8b. 線稿層：反光層「關」、霧光 0（除了線條以外沒有任何鐳射），比 −25° 和 25°
  const lineCard = (on: boolean): Card =>
    testCard([base, inkLayer(on ? { lineart: true } : {})], {
      front: { layers: [base, inkLayer(on ? { lineart: true } : {})], foil: { shape: 'none', frame: false } },
      holo: holo(100),
    });
  const scene = (pose: Pose): PickScene => ({
    vFovDeg: 30,
    viewAspect: W / H,
    cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
    yawDeg: pose.yaw,
    pitchDeg: pose.pitch,
    outline: cardOutline(ASPECT_HEIGHT.standard, testCard([]).cornerRadius),
    thickness: CARD_THICKNESS,
  });
  /** 卡面上 x0～x1 那一塊（卡寬單位）每個點在這個角度的像素。 */
  const sample = (px: Uint8ClampedArray, pose: Pose, x0: number, x1: number): [number, number, number][] => {
    const s = scene(pose);
    const out: [number, number, number][] = [];
    for (let x = x0; x <= x1; x += 0.02)
      for (let y = -0.55; y <= 0.55; y += 0.02) {
        const ndc = projectCardPoint('front', x, y, s)!;
        out.push(pixelAt(px, W, ((ndc.x + 1) / 2) * W, ((1 - ndc.y) / 2) * H));
      }
    return out;
  };
  const [left, right] = [poses[0]!, poses[1]!];
  const onL = await view.shot(lineCard(true), getImage, left);
  const onR = await view.shot(lineCard(true), getImage, right);
  const offL = await view.shot(lineCard(false), getImage, left);
  const offR = await view.shot(lineCard(false), getImage, right);
  // 黑線處（左半，離分界 0.06 卡寬以上）：兩個角度同一點的顏色差；開了之後比沒開亮多少
  const lineL = sample(onL, left, -0.45, -0.06);
  const lineR = sample(onR, right, -0.45, -0.06);
  let moved = 0;
  let movedSum = 0;
  for (let i = 0; i < lineL.length; i++) {
    const d = Math.max(...lineL[i]!.map((v, c) => Math.abs(v - lineR[i]![c]!)));
    moved = Math.max(moved, d);
    movedSum += d;
  }
  const bright = (px: [number, number, number][]) => px.reduce((sum, p) => sum + Math.max(...p), 0) / px.length;
  const darkOff = Math.max(bright(sample(offL, left, -0.45, -0.06)), bright(sample(offR, right, -0.45, -0.06)));
  const litOn = Math.min(bright(lineL), bright(lineR));
  // 白底處（右半）：開和沒開一模一樣
  const whiteL = diff(onL, offL, 0);
  const whiteDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, pose: Pose) => {
    const pa = sample(a, pose, 0.06, 0.45);
    const pb = sample(b, pose, 0.06, 0.45);
    return Math.max(...pa.map((p, i) => Math.max(...p.map((v, c) => Math.abs(v - pb[i]![c]!)))));
  };
  const white = Math.max(whiteDiff(onL, offL, left), whiteDiff(onR, offR, right));
  log(
    `  [線稿層] 黑線處 −25° vs 25° 同一點最大差 ${moved}、平均 ${(movedSum / lineL.length).toFixed(1)}；` +
      `黑線亮度 沒開 ${darkOff.toFixed(1)} → 開 ${litOn.toFixed(1)}；白底處開／沒開最大差 ${white}（整張最大差 ${whiteL.maxAbs}）`,
  );
  checks.push({
    name: '8. 線稿層：黑線處轉角度時顏色會變、白底處不變',
    pass: moved > 30 && movedSum / lineL.length > 8 && litOn > darkOff + 60 && white <= 1 && lineL.length > 100,
    detail: `黑線處角度差 ${moved}、黑線亮度 ${darkOff.toFixed(0)} → ${litOn.toFixed(0)}、白底差 ${white}`,
  });
  show('8. 線稿層 −25°（左半黑線發光、右半白底）', toDataUrl(onL, W, H), 0.5);
  show('8. 線稿層 25°', toDataUrl(onR, W, H), 0.5);

  // 8c（T-802b）：鐳射強度 0 時選中反光層，線稿層的線條上不出現斜線（線條不算亮面）：開／沒開線稿高光一模一樣
  const zeroCard = (on: boolean): Card =>
    testCard([base, inkLayer(on ? { lineart: true } : {})], {
      front: { layers: [base, inkLayer(on ? { lineart: true } : {})], foil: { shape: 'none', frame: false } },
      holo: holo(0),
    });
  view.obj.setFlash('front', 1);
  const flashOn = await view.shot(zeroCard(true), getImage, left);
  const flashOff = await view.shot(zeroCard(false), getImage, left);
  view.obj.setFlash('front', 0);
  const flashDiff = diff(flashOn, flashOff, 0).maxAbs;
  log(`  [強度 0＋斜線] 開／沒開線稿高光最大差 ${flashDiff}`);
  checks.push({ name: '8. 鐳射強度 0 時選中反光層：線稿的線條上沒有斜線', pass: flashDiff <= 1, detail: `最大差 ${flashDiff}` });

  // 8d（T-802b）：灰階三段對照 CPU 公式的門檻（lineart.ts：混入比例＝smoothstep(0.2, 0.8, 線條強度)）：
  // 淺灰 217（線條強度約 0.15，低於 0.2）＝完全不變；中灰 128（約 0.5）＝變一些；黑（1）＝變最多
  images.set('g000000000000000', await makeImage(64, 64, (x) => (x < 21 ? [0, 0, 0, 255] : x < 42 ? [128, 128, 128, 255] : [217, 217, 217, 255])));
  const grayCard = (on: boolean): Card =>
    testCard([base, layer('gray', 'g000000000000000', 60, { scale: 2, blend: 'multiply', hasAlpha: false, ...(on ? { lineart: true } : {}) })], {
      front: {
        layers: [base, layer('gray', 'g000000000000000', 60, { scale: 2, blend: 'multiply', hasAlpha: false, ...(on ? { lineart: true } : {}) })],
        foil: { shape: 'none', frame: false },
      },
      holo: holo(100),
    });
  const grayOn = await view.shot(grayCard(true), getImage, left);
  const grayOff = await view.shot(grayCard(false), getImage, left);
  // 圖寬 2 卡寬：x 21／64、42／64 的分界在卡面 x≈−0.344、0.3125
  const change = (x0: number, x1: number) => {
    const a = sample(grayOn, left, x0, x1);
    const b = sample(grayOff, left, x0, x1);
    const d = a.map((p, i) => Math.max(...p.map((v, c) => Math.abs(v - b[i]![c]!))));
    return { max: Math.max(...d), mean: d.reduce((s, v) => s + v, 0) / d.length };
  };
  const light = change(0.36, 0.45);
  const mid = change(-0.25, 0.2);
  const dark = change(-0.45, -0.39);
  log(`  [灰階三段] 淺灰變化最多 ${light.max}；中灰平均 ${mid.mean.toFixed(1)}；黑平均 ${dark.mean.toFixed(1)}`);
  checks.push({
    name: '8. 線稿層灰階：淺灰不變、中灰變一些、黑變最多（門檻同 CPU 公式）',
    pass: light.max <= 1 && mid.mean > 5 && mid.mean < dark.mean,
    detail: `淺灰最多 ${light.max}、中灰 ${mid.mean.toFixed(1)}、黑 ${dark.mean.toFixed(1)}`,
  });
  return checks;
}

async function clipCheck(view: GpuView): Promise<Check[]> {
  // 下面那層：200×250 的圖，中間 u 0.25～0.75、v 0.2～0.8 是不透明的深藍方塊（scale 1 → 卡面上 ±0.25 × ±0.375），其他透明；
  // 剪裁層：不透明的洋紅／黃條紋，比卡大（scale 2）
  const images = new Map([
    ['b100000000000000', await makeImage(16, 16, () => [128, 128, 128, 255])],
    ['s100000000000000', await makeImage(200, 250, (x, y) => (x >= 50 && x < 150 && y >= 50 && y < 200 ? [20, 30, 90, 255] : [20, 30, 90, 0]))],
    ['p100000000000000', await makeImage(128, 128, (x) => ((x >> 3) % 2 === 0 ? [255, 0, 200, 255] : [255, 220, 0, 255]))],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const DEPTH = 80;
  const HALF = { x: 0.25, y: 0.375 };
  const MARGIN = 0.03;
  const base = layer('base', 'b100000000000000', 0);
  const shape = (over: Partial<Layer> = {}) => layer('shape', 's100000000000000', DEPTH, over);
  const pattern = (over: Partial<Layer> = {}) => layer('pat', 'p100000000000000', DEPTH, { scale: 2, ...over });
  const shadow = { strength: 80, distance: 60 };
  const checks: Check[] = [];

  /** 畫一張：先建好材質，每層照視差公式設位移（shot 不動位移），再畫。 */
  const shoot = async (card: Card, pose: Pose) => {
    view.obj.update(card, getImage);
    card.front.layers.forEach((l, i) => {
      const o = parallaxOffset('front', pose.yaw, pose.pitch, l.depth);
      view.obj.offsets('front')[i]!.set(o.x, o.y);
    });
    return view.shot(card, getImage, pose);
  };
  const scene = (pose: Pose): PickScene => ({
    vFovDeg: 30,
    viewAspect: W / H,
    cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
    yawDeg: pose.yaw,
    pitchDeg: pose.pitch,
    outline: cardOutline(ASPECT_HEIGHT.standard, testCard([]).cornerRadius),
    thickness: CARD_THICKNESS,
  });
  /** 卡面上的格點（卡寬單位），依「在不在下面那層的方塊裡（含位移、留邊）」分成裡外，回螢幕像素座標。 */
  const regions = (pose: Pose) => {
    const o = parallaxOffset('front', pose.yaw, pose.pitch, DEPTH);
    const s = scene(pose);
    const inside: [number, number][] = [];
    const outside: [number, number][] = [];
    for (let x = -0.46; x <= 0.46; x += 0.015)
      for (let y = -0.66; y <= 0.66; y += 0.015) {
        const dx = Math.abs(x - o.x);
        const dy = Math.abs(y - o.y);
        const ndc = projectCardPoint('front', x, y, s);
        if (!ndc) continue;
        const px: [number, number] = [((ndc.x + 1) / 2) * W, ((1 - ndc.y) / 2) * H];
        if (dx < HALF.x - MARGIN && dy < HALF.y - MARGIN) inside.push(px);
        else if (dx > HALF.x + MARGIN || dy > HALF.y + MARGIN) outside.push(px);
      }
    return { inside, outside };
  };
  const pixelDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, [x, y]: [number, number]) => {
    const pb = pixelAt(b, W, x, y);
    return Math.max(...pixelAt(a, W, x, y).map((v, c) => Math.abs(v - pb[c]!)));
  };
  const worstAt = (a: Uint8ClampedArray, b: Uint8ClampedArray, pts: [number, number][]) => Math.max(...pts.map((pt) => pixelDiff(a, b, pt)));
  const meanAt = (a: Uint8ClampedArray, b: Uint8ClampedArray, pts: [number, number][]) =>
    pts.reduce((sum, pt) => sum + pixelDiff(a, b, pt), 0) / pts.length;

  // 9a. 沒有剪裁中的層＝以前：鐳射＋霧光＋卡框＋影子都開著，各種「不剪裁」的寫法和沒寫一模一樣
  const frame: Frame = { enabled: true, width: 0.03, color: '#d4af37', shine: 50 };
  const rich = (layers: Layer[]): Card =>
    testCard(layers, { holo: { ...testCard([]).holo, strength: 100, sparkle: 100, matte: 40 }, frame, shadow });
  const richPoses: Pose[] = [
    { yaw: -25, pitch: 8, zoom: 0.8, time: 0.7 },
    { yaw: 25, pitch: -8, zoom: 0.8, time: 0.7 },
  ];
  const same: Array<[string, Card, Card]> = [
    ['明寫 clip: false＝省略', rich([base, shape({ holo: true }), pattern({ holo: true })]), rich([base, shape({ holo: true }), pattern({ holo: true, clip: false })])],
    ['下面是底圖：照一般層畫', rich([base, pattern({ holo: true })]), rich([base, pattern({ holo: true, clip: true })])],
    ['自己衝出卡片：照一般層畫', rich([base, shape(), pattern({ breakout: true, scale: 1.2 })]), rich([base, shape(), pattern({ breakout: true, scale: 1.2, clip: true })])],
    ['下面那層衝出卡片：照一般層畫', rich([base, shape({ breakout: true }), pattern()]), rich([base, shape({ breakout: true }), pattern({ clip: true })])],
  ];
  for (const [label, a, b] of same) {
    let worst = 0;
    for (const pose of richPoses) worst = Math.max(worst, diff(await shoot(a, pose), await shoot(b, pose), 0).maxAbs);
    log(`  [沒剪裁＝以前・${label}] 最大差 ${worst}`);
    checks.push({ name: `9. 沒有剪裁中的層和以前一模一樣（${label}）`, pass: worst === 0, detail: `最大差 ${worst}` });
  }

  // 9b. 剪裁層只出現在下面那層的形狀裡（0°、±30°）
  const plain = (layers: Layer[]) => testCard(layers, { shadow });
  let worstOut = 0;
  let worstIn = 0;
  let minLit = Infinity;
  let minLeak = Infinity;
  let minPts = Infinity;
  for (const yaw of [0, -30, 30]) {
    const pose: Pose = { yaw, pitch: 0, zoom: 0.8 };
    const { inside, outside } = regions(pose);
    minPts = Math.min(minPts, inside.length, outside.length);
    const clipped = await shoot(plain([base, shape(), pattern({ clip: true })]), pose);
    const without = await shoot(plain([base, shape()]), pose);
    const loose = await shoot(plain([base, shape(), pattern()]), pose);
    worstOut = Math.max(worstOut, worstAt(clipped, without, outside));
    worstIn = Math.max(worstIn, worstAt(clipped, loose, inside));
    minLit = Math.min(minLit, meanAt(clipped, without, inside));
    minLeak = Math.min(minLeak, meanAt(loose, without, outside));
    if (yaw === 30) {
      show('9. 剪裁層 30°（條紋只在方塊裡）', toDataUrl(clipped, W, H), 0.5);
      show('9. 對照：不剪裁 30°', toDataUrl(loose, W, H), 0.5);
    }
  }
  log(
    `  [剪裁] 方塊外和沒有剪裁層最大差 ${worstOut}、方塊裡和不剪裁最大差 ${worstIn}、` +
      `方塊裡有條紋（平均差 ${minLit.toFixed(0)}）、對照組方塊外有條紋（平均差 ${minLeak.toFixed(0)}）`,
  );
  checks.push({
    name: '9. 剪裁層只出現在下面那層的形狀裡（0°、±30° 都對齊，沒有影子）',
    pass: worstOut <= 1 && worstIn <= 2 && minLit > 60 && minLeak > 60 && minPts > 50,
    detail: `方塊外差 ${worstOut}、方塊裡差 ${worstIn}、條紋 ${minLit.toFixed(0)}、對照 ${minLeak.toFixed(0)}`,
  });

  // 9c. 下面那層隱藏時照樣剪（只乘 alpha，不乘顯示）
  const pose: Pose = { yaw: 30, pitch: 0, zoom: 0.8 };
  const { inside, outside } = regions(pose);
  const hidden = await shoot(plain([base, shape({ visible: false }), pattern({ clip: true })]), pose);
  const baseOnly = await shoot(plain([base]), pose);
  const hiddenOut = worstAt(hidden, baseOnly, outside);
  const hiddenIn = meanAt(hidden, baseOnly, inside);
  log(`  [下面那層隱藏] 方塊外和只有底圖最大差 ${hiddenOut}、方塊裡有條紋（平均差 ${hiddenIn.toFixed(0)}）`);
  checks.push({ name: '9. 下面那層隱藏時照樣剪', pass: hiddenOut <= 1 && hiddenIn > 60, detail: `方塊外差 ${hiddenOut}、方塊裡 ${hiddenIn.toFixed(0)}` });

  // 9d（T-803 審查）：剪裁層開線稿高光：高光照剪裁 alpha 等比例（先算線條的混入比例、再乘剪裁 alpha），
  // 不是把剪裁 alpha 放進 smoothstep（那樣下面那層 alpha 0.2 時高光整個不見、0.8 時變成滿的）
  images.set('s200000000000000', await makeImage(200, 250, (x, y) => (x >= 50 && x < 150 && y >= 50 && y < 200 ? [20, 30, 90, 51] : [20, 30, 90, 0])));
  images.set('k100000000000000', await makeImage(64, 64, () => [0, 0, 0, 255]));
  const inkCard = (shapeHash: string, on: boolean): Card => {
    const layers = [
      base,
      layer('shape', shapeHash, DEPTH),
      layer('ink', 'k100000000000000', DEPTH, { scale: 2, blend: 'multiply', hasAlpha: false, clip: true, ...(on ? { lineart: true } : {}) }),
    ];
    return testCard(layers, {
      front: { layers, foil: { shape: 'none', frame: false } },
      holo: { ...testCard([]).holo, strength: 100, sparkle: 0, matte: 0 },
      shadow,
    });
  };
  const inkPose: Pose = { yaw: 20, pitch: 0, zoom: 0.8, time: 0.7 };
  const inkIn = regions(inkPose).inside;
  const faint = meanAt(await shoot(inkCard('s200000000000000', true), inkPose), await shoot(inkCard('s200000000000000', false), inkPose), inkIn);
  const solid = meanAt(await shoot(inkCard('s100000000000000', true), inkPose), await shoot(inkCard('s100000000000000', false), inkPose), inkIn);
  log(`  [剪裁＋線稿高光] 下面那層 alpha 0.2 時高光平均差 ${faint.toFixed(1)}、alpha 1 時 ${solid.toFixed(1)}`);
  checks.push({
    name: '9. 剪裁層的線稿高光照剪裁 alpha 等比例（下面那層淡的地方高光也淡，不是不見）',
    pass: faint > 5 && faint < solid * 0.5,
    detail: `alpha 0.2：${faint.toFixed(1)}、alpha 1：${solid.toFixed(1)}`,
  });
  return checks;
}

async function lenticularCheck(view: GpuView): Promise<Check[]> {
  const A = 'a5a5a5a5a5a5a5a5';
  const B = 'b5b5b5b5b5b5b5b5';
  const RED = [220, 40, 40] as const;
  const BLUE = [40, 60, 220] as const;
  const disk = (r: number, outside: readonly [number, number, number]) =>
    makeImage(512, 512, (x, y) => ((x - 255.5) ** 2 + (y - 255.5) ** 2 <= r ** 2 ? [255, 255, 255, 255] : [...outside, 0]));
  const images = new Map([
    ['b500000000000000', await makeImage(16, 16, () => [128, 128, 128, 255])],
    ['l500000000000000', await makeImage(16, 16, () => [230, 230, 230, 255])],
    [A, await makeImage(200, 280, () => [...RED, 255])],
    [B, await makeImage(200, 280, () => [...BLUE, 255])],
    ['d1k0000000000000', await disk(150, [0, 0, 0])],
    ['d1w0000000000000', await disk(150, [255, 255, 255])],
    ['d2k0000000000000', await disk(220, [0, 0, 0])],
    ['d2w0000000000000', await disk(220, [255, 255, 255])],
    ['wa00000000000000', await makeImage(64, 64, () => [255, 255, 255, 255])],
    ['ka00000000000000', await makeImage(128, 128, (x, y) => ((x >> 3) % 2 === 0 || (y >> 3) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]))],
    ['sq00000000000000', await makeImage(200, 200, (x, y) => (x >= 70 && x < 130 && y >= 70 && y < 130 ? [20, 30, 90, 255] : [20, 30, 90, 0]))],
    // 橫條只到卡寬的 0.1～0.9（正面 0° 時卡邊那一點點混入比例碰不到它）
    ['br00000000000000', await makeImage(200, 200, (x, y) => (x >= 20 && x < 180 && y >= 85 && y < 115 ? [20, 30, 90, 255] : [20, 30, 90, 0]))],
    ['pa00000000000000', await makeImage(128, 128, (x) => ((x >> 3) % 2 === 0 ? [255, 0, 200, 255] : [255, 220, 0, 255]))],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b500000000000000', 0, { scale: 1.6 });
  const shadow = { strength: 80, distance: 60 };
  const quiet = (layers: Layer[], patch: Partial<Card> = {}): Card =>
    testCard(layers, { holo: { ...testCard([]).holo, strength: 0, sparkle: 0, matte: 0 }, shadow, ...patch });
  const hero = (image: string, over: Partial<Layer> = {}) => layer('hero', image, 50, { scale: 0.8, ...over });
  const checks: Check[] = [];

  // 10a. 沒有變身圖＝以前：鐳射＋霧光＋卡框＋影子都開著
  const frame: Frame = { enabled: true, width: 0.03, color: '#d4af37', shine: 50 };
  const rich = (front: Layer[], back: Layer[] = []): Card => {
    const c = testCard(front, { holo: { ...testCard([]).holo, strength: 100, sparkle: 100, matte: 40 }, frame, shadow });
    return { ...c, back: { layers: back } };
  };
  const richPoses: Pose[] = [
    { yaw: -12, pitch: 8, zoom: 0.8, time: 0.7 },
    { yaw: 7, pitch: -6, zoom: 0.8, time: 0.7 },
    { yaw: 25, pitch: 0, zoom: 0.8, time: 0.7 },
  ];
  const missingB = (hash: string) => (hash === B ? undefined : images.get(hash));
  const same: Array<[string, Card, Card, typeof getImage]> = [
    ['變身圖在破框層上（不畫）', rich([base, hero(A, { breakout: true, scale: 1.2 })]), rich([base, hero(A, { breakout: true, scale: 1.2, alt: { image: B, hasAlpha: true } })]), getImage],
    ['變身圖還沒準備好', rich([base, hero(A)]), rich([base, hero(A, { alt: { image: B, hasAlpha: true } })]), missingB],
    ['變身圖只在背面（看正面）', rich([base, hero(A)]), rich([base, hero(A)], [layer('bh', A, 50, { alt: { image: B, hasAlpha: true } })]), getImage],
  ];
  for (const [label, a, b, get] of same) {
    let worst = 0;
    for (const pose of richPoses) worst = Math.max(worst, diff(await view.shot(a, get, pose), await view.shot(b, get, pose), 0).maxAbs);
    log(`  [沒有變身圖＝以前・${label}] 最大差 ${worst}`);
    checks.push({ name: `10. 沒有變身圖和以前一模一樣（${label}）`, pass: worst === 0, detail: `最大差 ${worst}` });
  }
  {
    // 換到一半（7° 附近）時會稍微變暗（暗度），所以只比換完的角度：0° 是本來的、-25° 是變身圖
    const off: Pose[] = [
      { yaw: 0, pitch: 0, zoom: 0.8, time: 0.7 },
      { yaw: -25, pitch: 5, zoom: 0.8, time: 0.7 },
    ];
    let worstOff = 0;
    for (const pose of off) worstOff = Math.max(worstOff, diff(await view.shot(rich([base, hero(A)]), getImage, pose), await view.shot(rich([base, hero(A, { alt: { image: A, hasAlpha: true } })]), getImage, pose), 0).maxAbs);
    log(`  [變身圖＝同一張圖，0°／-25°] 最大差 ${worstOff}`);
    checks.push({ name: '10. 變身圖＝同一張圖：0°、-25° 和沒有變身圖一樣（差 ≤ 1）', pass: worstOff <= 1, detail: `最大差 ${worstOff}` });
  }

  // 10b. 0° 是 A、±20° 是 B（整個畫面，含影子）
  const altCard = quiet([base, hero(A, { alt: { image: B, hasAlpha: true } })]);
  const onlyA = quiet([base, hero(A)]);
  const onlyB = quiet([base, hero(B)]);
  const center = (px: Uint8ClampedArray) => pixelAt(px, W, W / 2, H / 2).join(',');
  {
    const pose: Pose = { yaw: 0, pitch: 0, zoom: 1 };
    const x = await view.shot(altCard, getImage, pose);
    const d = diff(await view.shot(onlyA, getImage, pose), x, 1).maxAbs;
    log(`  [0°] 和只有 A 最大差 ${d}，中間像素 ${center(x)}`);
    checks.push({ name: '10. 正面 0°＝本來的圖（整個畫面和只有 A 的卡一樣）', pass: d <= 1, detail: `最大差 ${d}、中間 ${center(x)}` });
  }
  for (const yaw of [20, -20]) {
    const pose: Pose = { yaw, pitch: -5, zoom: 1 };
    const x = await view.shot(altCard, getImage, pose);
    const d = diff(await view.shot(onlyB, getImage, pose), x, 1).maxAbs;
    log(`  [${yaw}°] 和只有 B 最大差 ${d}，中間像素 ${center(x)}`);
    checks.push({ name: `10. ${yaw}°＝變身圖（整個畫面和只有 B 的卡一樣，含影子）`, pass: d <= 1, detail: `最大差 ${d}、中間 ${center(x)}` });
    if (yaw === 20) show('10. 20°：變身圖（藍）', toDataUrl(x, W, H), 0.5);
  }

  // 10c. 約 7°：同一排像素裡 A、B 都有，而且交錯好幾次（條紋）
  {
    const pose: Pose = { yaw: 7, pitch: 0, zoom: 1 };
    const x = await view.shot(altCard, getImage, pose);
    show('10. 7°：條紋一條一條翻過去', toDataUrl(x, W, H), 0.5);
    show('10. 7°（中間 200px 放大 3 倍）', toDataUrl(crop(x, 200), 200, 200), 3, 200);
    // 中間那一排、這一層蓋住的像素（綠色 < 90；底圖是灰 128）：由紅色通道推回混入比例 t（紅 220＝A、40＝B），
    // 數 A（t < 0.1）、B（t > 0.9）各幾個，和 t 跨過 0.5 幾次（條紋：換到一半的地方每條條紋裡 t 由小變大再跳回來）
    let reds = 0;
    let blues = 0;
    let flips = 0;
    let last: boolean | null = null;
    for (let px = 0; px < W; px++) {
      const [r, g] = pixelAt(x, W, px, H / 2);
      if (g >= 90) continue;
      const t = Math.min(1, Math.max(0, (RED[0] - r) / (RED[0] - BLUE[0])));
      if (t < 0.1) reds++;
      if (t > 0.9) blues++;
      const isB = t > 0.5;
      if (last !== null && isB !== last) flips++;
      last = isB;
    }
    log(`  [7°] 中間那一排：A（紅）${reds} 個、B（藍）${blues} 個、跨過一半 ${flips} 次`);
    checks.push({ name: '10. 約 7°：同一排像素裡 A、B 都有，而且條紋交錯（跨過一半 ≥ 10 次）', pass: reds > 10 && blues > 10 && flips >= 10, detail: `A ${reds}、B ${blues}、跨過一半 ${flips}` });
  }

  // 10d. 變身圖的透明邊沒有暗邊
  {
    const light = layer('base', 'l500000000000000', 0, { scale: 1.6 });
    const disks = (a: string, b: string | null) => quiet([light, layer('fig', a, 50, { scale: 0.6, ...(b ? { alt: { image: b, hasAlpha: true } } : {}) })], { shadow: { strength: 0, distance: 50 } });
    const pose20: Pose = { yaw: 20, pitch: 0, zoom: 0.45 };
    const ref = await view.shot(quiet([light], { shadow: { strength: 0, distance: 50 } }), getImage, pose20);
    const altBlack = await view.shot(disks('d1k0000000000000', 'd2k0000000000000'), getImage, pose20);
    const bWhite = await view.shot(disks('d2w0000000000000', null), getImage, pose20);
    const dark = diff(ref, altBlack, DARK_EDGE).darker;
    const vsB = diff(bWhite, altBlack, DARK_EDGE).maxAbs;
    log(`  [透明邊 20°] 比底色暗 ${dark}、和只有 B（透明處白）差 ${vsB}`);
    checks.push({ name: '10. 變身圖的透明邊沒有暗邊（20°：不比底色暗、和透明處白一樣）', pass: dark <= TOLERANCE && vsB <= TOLERANCE, detail: `暗 ${dark}、差 ${vsB}` });
    const pose7: Pose = { yaw: 7, pitch: 0, zoom: 0.45 };
    const midBlack = await view.shot(disks('d1k0000000000000', 'd2k0000000000000'), getImage, pose7);
    const midWhite = await view.shot(disks('d1w0000000000000', 'd2w0000000000000'), getImage, pose7);
    const mid = diff(midWhite, midBlack, DARK_EDGE).maxAbs;
    log(`  [透明邊 7°，換到一半] 透明處黑 vs 白 最大差 ${mid}`);
    checks.push({ name: '10. 換到一半時兩張的透明處也不混進邊緣（7°：透明處黑＝透明處白）', pass: mid <= TOLERANCE, detail: `最大差 ${mid}` });
  }

  // 10e. 背面照背面的角度
  {
    const backCard = (l: Layer): Card => {
      const c = quiet([]);
      return { ...c, back: { layers: [layer('bb', 'b500000000000000', 0, { scale: 1.6 }), l] } };
    };
    const altBack = backCard(layer('bh', A, 50, { scale: 0.8, alt: { image: B, hasAlpha: true } }));
    const results: string[] = [];
    let pass = true;
    for (const [yaw, want] of [[180, 'A'], [160, 'B'], [200, 'B']] as const) {
      const pose: Pose = { yaw, pitch: 0, zoom: 1 };
      const d = diff(await view.shot(backCard(layer('bh', want === 'A' ? A : B, 50, { scale: 0.8 })), getImage, pose), await view.shot(altBack, getImage, pose), 1).maxAbs;
      results.push(`${yaw}°＝${want}（差 ${d}）`);
      if (d > 1) pass = false;
    }
    log(`  [背面] ${results.join('、')}`);
    checks.push({ name: '10. 背面照背面那一面的角度（正對背面＝A、左右轉 20°＝B）', pass, detail: results.join('、') });
  }

  // 10f. 剪裁：下面那層有變身圖時，剪裁 alpha 用混好的 alpha（0°＝照 A 的形狀、20°＝照 B 的形狀）
  {
    const pat = layer('pat', 'pa00000000000000', 50, { scale: 2, clip: true });
    const parent = (image: string, over: Partial<Layer> = {}) => layer('shape', image, 50, over);
    const clipped = quiet([base, parent('sq00000000000000', { alt: { image: 'br00000000000000', hasAlpha: true } }), pat]);
    const results: string[] = [];
    let pass = true;
    for (const [yaw, want] of [[0, 'sq00000000000000'], [20, 'br00000000000000']] as const) {
      const pose: Pose = { yaw, pitch: 0, zoom: 1 };
      const d = diff(await view.shot(quiet([base, parent(want), pat]), getImage, pose), await view.shot(clipped, getImage, pose), 1).maxAbs;
      results.push(`${yaw}°（差 ${d}）`);
      if (d > 1) pass = false;
      if (yaw === 20) show('10. 剪裁：20° 條紋照變身圖（橫條）的形狀', toDataUrl(await view.shot(clipped, getImage, pose), W, H), 0.5);
    }
    log(`  [剪裁＋變身圖] ${results.join('、')}`);
    checks.push({ name: '10. 剪裁層的下面那層有變身圖：照混好的 alpha 剪（0°＝方塊、20°＝橫條）', pass, detail: results.join('、') });
  }

  // 10g. 線稿高光照混好的顏色（A 白、B 黑線格子，加深、反光層關、霧光 0、鐳射 100）
  {
    const ink = (image: string, over: Partial<Layer> = {}) => layer('ink', image, 50, { scale: 0.8, blend: 'multiply', hasAlpha: false, lineart: true, ...over });
    const inkCard = (l: Layer): Card => {
      const layers = [base, l];
      return testCard(layers, { front: { layers, foil: { shape: 'none', frame: false } }, holo: { ...testCard([]).holo, strength: 100, sparkle: 0, matte: 0 } });
    };
    const altInk = inkCard(ink('wa00000000000000', { alt: { image: 'ka00000000000000', hasAlpha: false } }));
    const results: string[] = [];
    let pass = true;
    for (const [yaw, want] of [[0, 'wa00000000000000'], [20, 'ka00000000000000']] as const) {
      const pose: Pose = { yaw, pitch: 0, zoom: 1, time: 0.4 };
      const d = diff(await view.shot(inkCard(ink(want)), getImage, pose), await view.shot(altInk, getImage, pose), 1).maxAbs;
      results.push(`${yaw}°（差 ${d}）`);
      if (d > 1) pass = false;
    }
    // 對照：20° 時真的有線稿高光（和同一張卡關掉線稿高光不一樣）
    const pose20: Pose = { yaw: 20, pitch: 0, zoom: 1, time: 0.4 };
    const glow = diff(await view.shot(inkCard(ink('ka00000000000000', { lineart: false })), getImage, pose20), await view.shot(altInk, getImage, pose20), 10).maxAbs;
    log(`  [線稿高光＋變身圖] ${results.join('、')}、20° 和關掉線稿高光差 ${glow}`);
    checks.push({ name: '10. 線稿高光照混好的顏色（0°＝白、沒有光；20°＝黑線發光）', pass: pass && glow > 60, detail: `${results.join('、')}、對照 ${glow}` });
  }
  return checks;
}

/**
 * 11. 透明卡套（T-806）：沒開卡套＝以前（從沒開過、開了又關、明寫 false 都差 0）；正面看卡片幾乎不變（正面、背面差 ≤ 6）；
 * 斜看 60° 時卡片上比正面亮（菲涅耳）；卡套的白邊在卡片外面看得到；排序：遠側（卡片後面那片塑膠）從任何角度都不蓋到卡片
 * （藏起遠側前後卡片範圍內差 ≤ 2）、轉 30°、−35°、背面 150° 卡片不霧（亮度差的中位數：一般卡 ≤ 2、純黑卡 ≤ 6）；
 * 破框層：伸出卡套外的部分和沒開卡套一模一樣、在卡套邊距裡照樣不透明洋紅（遠側沒有蓋在破框層上面）。
 */
async function aspectCheck(view: GpuView): Promise<Check[]> {
  const images = new Map([
    ['b000000000000000', await makeImage(32, 48, (x, y) => [40 + x * 5, 60 + y * 3, 150 - x * 2, 255])],
    ['d000000000000000', await makeImage(40, 40, (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 < 300 ? [250, 200, 40, 255] : [0, 0, 0, 0]))],
    ['p000000000000000', await makeImage(16, 16, () => [40, 60, 90, 255])],
  ]);
  const getImage = (hash: string) => images.get(hash);
  /** 底圖＋一個立體層、雕花卡框、鐳射、影子都開（各種比例都在畫面裡要檢查的那張）。 */
  const rich = (shape: CardShape): Card => {
    const c = testCard(
      [layer('base', 'b000000000000000', 0, { scale: 2.2 }), layer('d', 'd000000000000000', 40, { scale: 0.5, x: 0.1, y: 0.15, holo: true })],
      shape,
    );
    return { ...c, frame: { enabled: true, width: 0.03, color: '#d4af37', shine: 50, style: 'ornate' }, holo: { ...c.holo, strength: 65, sparkle: 30 }, shadow: { strength: 50, distance: 50 } };
  };
  /** 雕花比較用：素色底圖、金色卡框（簡約／雕花）。 */
  const framed = (shape: CardShape, style: FrameStyle): Card =>
    testCard([layer('base', 'p000000000000000', 0, { scale: 2.2 })], { ...shape, frame: { enabled: true, width: 0.03, color: '#d4af37', shine: 50, style } });
  const maxByte = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
    return m;
  };
  const checks: Check[] = [];
  const front: Pose = { yaw: 0, pitch: 0, zoom: 1 };
  const tilt: Pose = { yaw: 30, pitch: -12, zoom: 1 };

  // 12a. 標準卡、塔羅牌和以前一樣：同一個比例走自訂的路也畫得一模一樣（所有位元組）
  for (const [label, preset, custom] of [
    ['標準卡', { aspect: 'standard' }, { aspect: 'custom', customAspect: { width: 63, height: 88 } }],
    ['塔羅牌', { aspect: 'tarot' }, { aspect: 'custom', customAspect: { width: 70, height: 120 } }],
  ] as [string, CardShape, CardShape][]) {
    let worst = 0;
    for (const pose of [front, tilt]) worst = Math.max(worst, maxByte(await view.shot(rich(preset), getImage, pose), await view.shot(rich(custom), getImage, pose)));
    log(`  [${label}] 和自訂同比例：最大差 ${worst}`);
    checks.push({ name: `12. ${label}：預設比例和同尺寸自訂畫得一模一樣`, pass: worst === 0, detail: `最大差 ${worst}` });
  }

  // 12b. 正方形、明信片、橫式自訂 3:2
  const shapes: [string, CardShape][] = [
    ['正方形', { aspect: 'square' }],
    ['明信片', { aspect: 'postcard' }],
    ['橫式 3:2', { aspect: 'custom', customAspect: { width: 3, height: 2 } }],
  ];
  for (const [label, shape] of shapes) {
    // 整張卡在畫面裡：正面與幾個很斜的角度，畫布最外 2 像素一圈都是透明的；卡片佔的像素夠多
    let edge = 0;
    let covered = 0;
    for (const pose of [front, { yaw: 55, pitch: -35, zoom: 1 }, { yaw: -75, pitch: 25, zoom: 1 }, { yaw: 20, pitch: 80, zoom: 1 }] as Pose[]) {
      const px = await view.shot(rich(shape), getImage, pose);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const a = px[(y * W + x) * 4 + 3]!;
          if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) edge = Math.max(edge, a);
          else if (pose === front && a > 0) covered++;
        }
      if (pose === front) show(`12. ${label}（正面）`, toDataUrl(px, W, H), 0.4);
    }
    log(`  [${label}] 畫布邊最大 alpha ${edge}；正面卡片 ${covered} 像素`);
    checks.push({ name: `12. ${label}：整張卡在畫面裡（斜看也不碰畫布邊）`, pass: edge === 0 && covered > 60000, detail: `邊 alpha ${edge}、卡片 ${covered} 像素` });

    // 四角圓角對稱：正面看（鏡頭在卡片正前方），卡片的輪廓左右、上下鏡射後一樣——每個像素和鏡射過去的像素 alpha 差不到
    // 一個多重取樣點（4x MSAA 的取樣位置本身不對稱，邊上的像素最多差 1/4）；對照：輪廓的半透明邊確實有量到
    const sil = await view.shot(rich(shape), getImage, front);
    const alpha = (x: number, y: number) => sil[(y * W + x) * 4 + 3]!;
    let asym = 0;
    let worstMirror = 0;
    let edgePx = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W / 2; x++) {
        const a = alpha(x, y);
        if (a > 0 && a < 255) edgePx++;
        for (const d of [Math.abs(a - alpha(W - 1 - x, y)), Math.abs(a - alpha(x, H - 1 - y)), Math.abs(a - alpha(W - 1 - x, H - 1 - y))]) {
          worstMirror = Math.max(worstMirror, d);
          if (d > 70) asym++;
        }
      }
    const boxes = cornerBoxes(front, shape);
    log(`  [${label}] 輪廓鏡射：差超過一個取樣點的像素 ${asym}（最大差 ${worstMirror}）；左半邊的半透明邊 ${edgePx} 像素`);
    checks.push({ name: `12. ${label}：四角圓角對稱（輪廓左右上下鏡射一樣）`, pass: asym === 0 && edgePx > 300, detail: `不對稱 ${asym} 像素、最大差 ${worstMirror}、邊 ${edgePx} 像素` });

    // 雕花四角鏡射：只有四個角的花紋方框裡不一樣，四角變的一樣多
    // 花紋的浮雕有光的方向，亮暗不會逐像素鏡射；算「有沒有變」（差 > 3）的範圍，四角應該差不多大
    const r = compare(await view.shot(framed(shape, 'simple'), getImage, front), await view.shot(framed(shape, 'ornate'), getImage, front), boxes, 3);
    const spread = (Math.max(...r.inBox) - Math.min(...r.inBox)) / Math.max(...r.inBox);
    log(`  [${label}・雕花] 四角變了 ${r.inBox.join('／')} 像素、方框外最大差 ${r.outside}、四角差 ${(spread * 100).toFixed(1)}%`);
    checks.push({
      name: `12. ${label}：雕花邊角四角鏡射`,
      pass: r.inBox.every((n) => n >= 300) && r.outside <= 1 && spread < 0.12,
      detail: `四角 ${r.inBox.join('／')}、外面 ${r.outside}、四角差 ${(spread * 100).toFixed(1)}%`,
    });
  }
  return checks;
}

async function sleeveCheck(fresh: () => GpuView): Promise<Check[]> {
  // 底圖：彩色斜漸層；主角：中間一個半透明邊的圓（有透明）
  const images = new Map([
    ['b000000000000000', await makeImage(64, 90, (x, y) => [40 + x * 3, 200 - y * 2, 90 + ((x + y) % 40), 255])],
    ['h000000000000000', await makeImage(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 26 ? [240, 220, 120, 255] : [240, 220, 120, 0]))],
    ['m000000000000000', await makeImage(400, 500, (x, y) => (x >= 4 && x < 396 && y >= 4 && y < 496 ? [255, 0, 255, 255] : [255, 0, 255, 0]))],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const sleeve = (c: Card, on?: boolean): Card => (on === undefined ? c : { ...c, view: { ...c.view, sleeve: on } });
  const rich = (on?: boolean): Card =>
    sleeve(
      testCard([layer('base', 'b000000000000000', 0, { scale: 1.6 }), layer('hero', 'h000000000000000', 60, { scale: 0.6 })], {
        frame: { enabled: true, width: 0.03, color: '#d4af37', shine: 50 },
        holo: { ...testCard([]).holo, strength: 65, sparkle: 30 },
        shadow: { strength: 60, distance: 50 },
        back: { layers: [layer('bb', 'b000000000000000', 0, { scale: 1.6 })] },
      }),
      on,
    );
  // 深色卡（最容易看出白霧）：沒有圖層、卡身黑
  const dark = (on?: boolean): Card => sleeve(testCard([], { bodyColor: '#050608' }), on);
  const breakoutCard = (on?: boolean): Card =>
    sleeve(testCard([layer('base', 'b000000000000000', 0, { scale: 1.6 }), layer('m', 'm000000000000000', 100, { scale: 2.4, breakout: true })]), on);
  const bytesDiffer = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };
  /** 兩張都不透明的像素：S 比 A 亮多少（RGB 平均），回 { 平均, 中位數 }。 */
  const gain = (a: Uint8ClampedArray, s: Uint8ClampedArray) => {
    const d: number[] = [];
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] !== 255 || s[i + 3] !== 255) continue;
      d.push((s[i]! + s[i + 1]! + s[i + 2]! - a[i]! - a[i + 1]! - a[i + 2]!) / 3);
    }
    d.sort((x, y) => x - y);
    return { mean: d.reduce((t, v) => t + v, 0) / Math.max(1, d.length), median: d[Math.floor(d.length / 2)] ?? 0 };
  };
  const checks: Check[] = [];

  // 11a. 沒開卡套＝以前：從沒開過（A）、同一個物件開了又關（B）、明寫 false（C），各種角度都差 0（連 alpha）
  {
    const never = fresh();
    const toggled = fresh();
    const poses: Pose[] = [
      { yaw: 0, pitch: 0, zoom: 0.8, time: 0.4 },
      { yaw: 25, pitch: -8, zoom: 0.8, time: 0.4 },
      { yaw: -60, pitch: 10, zoom: 0.8, time: 0.4 },
      { yaw: 180, pitch: 0, zoom: 0.8, time: 0.4 },
    ];
    let worst = 0;
    for (const make of [rich, breakoutCard]) {
      for (const pose of poses) {
        const a = await never.shot(make(), getImage, pose);
        await toggled.shot(make(true), getImage, pose);
        const b = await toggled.shot(make(), getImage, pose);
        const c = await toggled.shot(make(false), getImage, pose);
        worst = Math.max(worst, bytesDiffer(a, b), bytesDiffer(a, c));
      }
    }
    log(`  [沒開卡套] 開了又關、明寫 false 和從沒開過不同的位元組 ${worst}`);
    checks.push({ name: '11. 沒開卡套＝以前（開了又關、明寫 false 都差 0）', pass: worst === 0, detail: `不同的位元組 ${worst}` });
  }

  const view = fresh();
  // 11b. 正面看卡片幾乎不變：正面、背面，一般卡與深色卡
  {
    const results: string[] = [];
    let worst = 0;
    for (const [label, make] of [['一般卡', rich], ['深色卡', dark]] as const) {
      for (const yaw of [0, 180]) {
        const pose: Pose = { yaw, pitch: 0, zoom: 0.8, time: 0.4 };
        const a = await view.shot(make(), getImage, pose);
        const s = await view.shot(make(true), getImage, pose);
        const d = diff(a, s, 6).maxAbs;
        worst = Math.max(worst, d);
        results.push(`${label} ${yaw}° ${d}`);
        if (label === '深色卡' && yaw === 0) show('卡套：深色卡正面（開著）', toDataUrl(s, W, H), 0.5);
      }
    }
    log(`  [正面看] ${results.join('、')}`);
    checks.push({ name: '11. 正面看卡片幾乎不變（差 ≤ 6）', pass: worst <= 6, detail: results.join('、') });
  }

  // 11c. 斜看 60° 時卡片上比正面亮（菲涅耳）；卡套白邊在卡片外面看得到
  {
    const front: Pose = { yaw: 0, pitch: 0, zoom: 0.8, time: 0.4 };
    const side: Pose = { yaw: 60, pitch: 0, zoom: 0.8, time: 0.4 };
    const g0 = gain(await view.shot(dark(), getImage, front), await view.shot(dark(true), getImage, front));
    const s60 = await view.shot(dark(true), getImage, side);
    const g60 = gain(await view.shot(dark(), getImage, side), s60);
    show('卡套：深色卡 60°', toDataUrl(s60, W, H), 0.5);
    log(`  [菲涅耳] 卡片上平均變亮：0° ${g0.mean.toFixed(2)}、60° ${g60.mean.toFixed(2)}`);
    checks.push({
      name: '11. 斜看 60° 時比正面亮（菲涅耳）',
      pass: g0.mean < 0.5 && g60.mean > g0.mean + 4,
      detail: `0° ${g0.mean.toFixed(2)}、60° ${g60.mean.toFixed(2)}`,
    });
    // 白邊：正面看時，沒開卡套是透明（alpha 0）、開了變成看得到（alpha ≥ 40）的像素
    const a = await view.shot(rich(), getImage, front);
    const s = await view.shot(rich(true), getImage, front);
    let rim = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i + 3] === 0 && s[i + 3]! >= 40) rim++;
    log(`  [白邊] 卡片外面看得到的卡套像素 ${rim}`);
    checks.push({ name: '11. 卡套白邊在卡片外面看得到', pass: rim > 500, detail: `${rim} 像素` });
  }

  // 11d. 排序：遠側（卡片後面那片塑膠）從任何角度都不會蓋到卡片：把遠側藏起來前後，卡片範圍內（沒開卡套時不透明的像素）
  //      一模一樣（差 0）；不霧：轉 30°、−35°、背面 150° 卡片上變亮的中位數，一般卡 ≤ 2、純黑卡 ≤ 6
  //      （黑色在 sRGB 上最容易看出一點點反光；排序錯、遠側蓋上來的話會 > 40）
  {
    const poses: Pose[] = [
      { yaw: 30, pitch: 10, zoom: 0.8, time: 0.4 },
      { yaw: -35, pitch: -12, zoom: 0.8, time: 0.4 },
      { yaw: 150, pitch: -10, zoom: 0.8, time: 0.4 },
      { yaw: 80, pitch: 5, zoom: 0.8, time: 0.4 },
      { yaw: -100, pitch: -20, zoom: 0.8, time: 0.4 },
    ];
    /** 卡套那一組的遠側網格（group 的第 4 個子物件裡 renderOrder 最小的）。 */
    const farSide = () => {
      const meshes = (view.obj.group.children[3]?.children ?? []) as Mesh[];
      return meshes.reduce((a, b) => (b.renderOrder < a.renderOrder ? b : a));
    };
    // 看得出來的差（> 2 階）最多 EDGE_NOISE_PIXELS 個像素（MSAA 的邊緣雜訊，WebGPU 80°／5° 實測過差 3～4 階的 8 個像素）；
    // 1～2 階只記下來（WebGL2 的 MSAA 在接近 90° 的卡邊有單一取樣的 1 階差）；排序錯、遠側蓋上來的話整張卡會差幾十階（上千個像素）
    let covered = 0;
    let faint = 0;
    const where: string[] = [];
    const fog: string[] = [];
    let fogBad = false;
    for (const pose of poses) {
      for (const [label, make, limit] of [['一般卡', rich, 2], ['純黑卡', dark, 6]] as const) {
        const a = await view.shot(make(), getImage, pose);
        const s = await view.shot(make(true), getImage, pose);
        const far = farSide();
        far.visible = false;
        const n = await view.shot(make(true), getImage, pose);
        far.visible = true;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i + 3] !== 255) continue;
          let d = 0;
          for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(s[i + c]! - n[i + c]!));
          if (d === 0) continue;
          if (d <= 2) faint++;
          else covered++;
          if (where.length < 6) where.push(`${label} ${pose.yaw}°/${pose.pitch}° (${(i / 4) % W},${Math.floor(i / 4 / W)}) 差 ${d}`);
        }
        if (Math.abs(pose.yaw) <= 35 || pose.yaw === 150) {
          const g = gain(a, s).median;
          if (g > limit) fogBad = true;
          fog.push(`${label} ${pose.yaw}° ${g.toFixed(1)}`);
        }
      }
    }
    const coverDetail = `差 > 2 的 ${covered} 像素（容許邊緣雜訊 ${EDGE_NOISE_PIXELS}）、差 1～2 的 ${faint} 像素${where.length ? `（${where.join('；')}）` : ''}`;
    log(`  [排序] 藏起遠側前後卡片範圍內：${coverDetail}；[不霧] 卡片上變亮的中位數 ${fog.join('、')}`);
    checks.push({
      name: `11. 遠側從任何角度都不蓋到卡片（藏起遠側前後差 ≤ 2；邊緣雜訊最多 ${EDGE_NOISE_PIXELS} 像素）`,
      pass: covered <= EDGE_NOISE_PIXELS,
      detail: coverDetail,
    });
    checks.push({ name: '11. 轉 30°、−35°、背面 150° 卡片不霧（中位數：一般卡 ≤ 2、純黑卡 ≤ 6）', pass: !fogBad, detail: fog.join('、') });
  }

  // 11e. 破框層：卡套外面和沒開一模一樣；卡套邊距裡（卡邊與卡套邊中間）照樣是不透明洋紅
  {
    const pose: Pose = { yaw: 0, pitch: 0, zoom: 0.6, time: 0.4 };
    const a = await view.shot(breakoutCard(), getImage, pose);
    const s = await view.shot(breakoutCard(true), getImage, pose);
    const outline = cardOutline(ASPECT_HEIGHT.standard, breakoutCard().cornerRadius);
    const scene: PickScene = {
      vFovDeg: 30,
      viewAspect: W / H,
      cameraZ: cameraDistance(30, W / H, pose.zoom, cardBox(ASPECT_HEIGHT.standard)),
      yawDeg: 0,
      pitchDeg: 0,
      outline,
      thickness: CARD_THICKNESS,
    };
    const at = (x: number, y: number) => {
      const ndc = projectCardPoint('front', x, y, scene)!;
      return Math.floor(((1 - ndc.y) / 2) * H) * W + Math.floor(((ndc.x + 1) / 2) * W);
    };
    let outside = 0;
    let margin = 0;
    for (let t = -0.4; t <= 0.4; t += 0.05) {
      for (const [x, y] of [
        [outline.halfW + 0.1, t],
        [-outline.halfW - 0.1, t],
      ]) {
        const i = at(x!, y!) * 4;
        for (let c = 0; c < 4; c++) outside = Math.max(outside, Math.abs(a[i + c]! - s[i + c]!));
      }
      for (const [x, y] of [
        [outline.halfW + 0.015, t],
        [-outline.halfW - 0.015, t],
      ]) {
        const i = at(x!, y!) * 4;
        margin = Math.max(margin, Math.abs(s[i]! - 255), s[i + 1]!, Math.abs(s[i + 2]! - 255), 255 - s[i + 3]!);
      }
    }
    log(`  [破框層] 卡套外面和沒開差 ${outside}、卡套邊距裡和洋紅差 ${margin}`);
    checks.push({
      name: '11. 破框層伸出卡套外照樣畫、邊距裡沒被遠側蓋住',
      pass: outside === 0 && margin <= 6,
      detail: `外面差 ${outside}、邊距裡差 ${margin}`,
    });
  }
  return checks;
}

async function discCheck(fresh: () => GpuView): Promise<Check[]> {
  const images = new Map([
    ['b000000000000000', await makeImage(64, 90, (x, y) => [40 + x * 3, 200 - y * 2, 90 + ((x + y) % 40), 255])],
    ['h000000000000000', await makeImage(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 26 ? [240, 220, 120, 255] : [240, 220, 120, 0]))],
    ['m000000000000000', await makeImage(16, 16, () => [255, 0, 255, 255])],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const bytesDiffer = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };
  const rich = (patch: Partial<Card> = {}): Card =>
    testCard([layer('base', 'b000000000000000', 0, { scale: 1.6 }), layer('hero', 'h000000000000000', 60, { scale: 0.6, holo: true })], {
      frame: { enabled: true, width: 0.03, color: '#d4af37', shine: 50 },
      holo: { ...testCard([]).holo, strength: 65, sparkle: 30 },
      shadow: { strength: 60, distance: 50 },
      ...patch,
    });
  const disc = (front: Layer[], strength = 65): Card =>
    testCard(front, { aspect: 'square', kind: 'disc', holo: { ...testCard([]).holo, strength, sparkle: 0 } });
  const poses: Pose[] = [
    { yaw: 0, pitch: 0, zoom: 0.8, time: 0.4 },
    { yaw: 30, pitch: -10, zoom: 0.8, time: 0.4 },
    { yaw: 180, pitch: 0, zoom: 0.8, time: 0.4 },
  ];
  const checks: Check[] = [];

  // 13a. 一般卡和以前一樣：明寫 kind 'card'＝省略；同一個物件畫過光碟再換回卡片＝從沒畫過光碟
  {
    const never = fresh();
    const toggled = fresh();
    let worst = 0;
    for (const pose of poses) {
      const a = await never.shot(rich(), getImage, pose);
      const b = await never.shot(rich({ kind: 'card' }), getImage, pose);
      await toggled.shot(disc([layer('base', 'b000000000000000', 0, { scale: 1.6 })]), getImage, pose);
      const c = await toggled.shot(rich(), getImage, pose);
      worst = Math.max(worst, bytesDiffer(a, b), bytesDiffer(a, c));
    }
    log(`  [一般卡] 明寫 card、畫過光碟再換回卡片和以前不同的位元組 ${worst}`);
    checks.push({ name: '13. 一般卡和以前一樣（明寫 card、畫過光碟再換回卡片都差 0）', pass: worst === 0, detail: `不同的位元組 ${worst}` });
  }

  const view = fresh();
  const zoom = 0.8;
  const cameraZ = cameraDistance(30, W / H, zoom, cardBox(1));
  const scene = (yaw: number, pitch: number): PickScene => ({
    vFovDeg: 30,
    viewAspect: W / H,
    cameraZ,
    yawDeg: yaw,
    pitchDeg: pitch,
    outline: discOutline(),
    thickness: DISC_THICKNESS,
  });
  /** 那一面上 (x, y) 在畫面上的像素 index（看不到＝-1）。 */
  const at = (face: FaceSide, x: number, y: number, yaw: number, pitch: number) => {
    const ndc = projectCardPoint(face, x, y, scene(yaw, pitch));
    if (!ndc) return -1;
    return Math.floor(((1 - ndc.y) / 2) * H) * W + Math.floor(((ndc.x + 1) / 2) * W);
  };
  const px = (shot: Uint8ClampedArray, i: number) => [shot[i * 4]!, shot[i * 4 + 1]!, shot[i * 4 + 2]!, shot[i * 4 + 3]!] as const;
  /** 半徑 r 的圓上四個方向（避開正上下左右）。 */
  const ring = (r: number) => [0, 1, 2, 3].map((k) => [r * Math.cos(k * 1.57 + 0.3), r * Math.sin(k * 1.57 + 0.3)] as const);

  // 13b. 孔裡與光碟外面透明（正面、背面），透明圈半透明
  {
    const card = disc([layer('base', 'b000000000000000', 0, { scale: 1.6 })]);
    const results: string[] = [];
    let bad = false;
    for (const [face, yaw] of [['front', 0], ['back', 180]] as const) {
      const shot = await view.shot(card, getImage, { yaw, pitch: 0, zoom, time: 0.4 });
      if (face === 'front') show('光碟：正面 0°', toDataUrl(shot, W, H), 0.5);
      const alpha = (pts: readonly (readonly [number, number])[]) => Math.max(...pts.map(([x, y]) => px(shot, at(face, x, y, yaw, 0))[3]));
      const hole = alpha([[0, 0], ...ring(0.04)]);
      const outside = alpha([...ring(0.53), ...ring(0.6)]);
      const hub = px(shot, at(face, 0.13, 0.02, yaw, 0))[3];
      results.push(`${face === 'front' ? '正面' : '背面'}：孔 alpha ${hole}、外面 ${outside}、透明圈 ${hub}`);
      if (hole !== 0 || outside !== 0 || !(hub > 0 && hub < 128)) bad = true;
    }
    log(`  [透明] ${results.join('；')}`);
    checks.push({ name: '13. 光碟孔裡與外面透明（alpha 0）、透明圈半透明', pass: !bad, detail: results.join('；') });
  }

  // 13c. 印刷面圓環外的圖層被剪掉：比光碟大很多的洋紅圖層（底圖、立體層兩種）
  {
    const results: string[] = [];
    let bad = false;
    const cases: [string, Layer[]][] = [
      ['底圖', [layer('base', 'm000000000000000', 0, { scale: 2 })]],
      ['立體層', [layer('m', 'm000000000000000', 40, { scale: 2, hasAlpha: true })]],
    ];
    for (const [label, front] of cases) {
      const shot = await view.shot(disc(front, 0), getImage, { yaw: 0, pitch: 0, zoom, time: 0.4 });
      const isMagenta = ([r, g, b]: readonly number[]) => r! > 200 && g! < 60 && b! > 200;
      const inRing = [0.25, 0.35, 0.45].every((r) => ring(r).every(([x, y]) => {
        const p = px(shot, at('front', x, y, 0, 0));
        return isMagenta(p) && p[3] === 255;
      }));
      const hubMagenta = [0.1, 0.15].flatMap((r) => ring(r)).filter(([x, y]) => {
        const p = px(shot, at('front', x, y, 0, 0));
        return isMagenta(p) && p[3] > 128;
      }).length;
      const outside = Math.max(...[0.53, 0.6].flatMap((r) => ring(r)).map(([x, y]) => px(shot, at('front', x, y, 0, 0))[3]));
      results.push(`${label}：圓環裡全是洋紅 ${inRing}、透明圈是洋紅的點 ${hubMagenta}、外面最大 alpha ${outside}`);
      if (!inRing || hubMagenta > 0 || outside !== 0) bad = true;
    }
    log(`  [剪裁] ${results.join('；')}`);
    checks.push({ name: '13. 印刷面圓環外的圖層被剪掉（透明圈、光碟外沒有）', pass: !bad, detail: results.join('；') });
  }

  // 13d／13e. 背面的彩虹：扇形方向（在半徑 0.28～0.38 每 2° 量一次亮度，兩道一起算，取最亮的方向）
  {
    const card = disc([layer('base', 'b000000000000000', 0, { scale: 1.6 })]);
    const lum = (shot: Uint8ClampedArray, a: number, yaw: number) => {
      let sum = 0;
      for (const r of [0.28, 0.33, 0.38]) {
        const [R, G, B] = px(shot, at('back', r * Math.cos(a), r * Math.sin(a), yaw, 0));
        sum += R + G + B;
      }
      return sum / 3;
    };
    const fanOf = (shot: Uint8ClampedArray, yaw: number) => {
      let best = 0;
      let bestLum = -1;
      for (let deg = 0; deg < 180; deg += 2) {
        const a = (deg * Math.PI) / 180;
        const l = lum(shot, a, yaw) + lum(shot, a + Math.PI, yaw);
        if (l > bestLum) {
          bestLum = l;
          best = a;
        }
      }
      return best;
    };
    const angleGap = (a: number, b: number) => {
      const d = Math.abs(a - b) % Math.PI;
      return (Math.min(d, Math.PI - d) * 180) / Math.PI;
    };
    const deg = (a: number) => ((a * 180) / Math.PI).toFixed(0);
    const s180 = await view.shot(card, getImage, { yaw: 180, pitch: 0, zoom, time: 0.4 });
    const s150 = await view.shot(card, getImage, { yaw: 150, pitch: 0, zoom, time: 0.4 });
    show('光碟：背面 180°', toDataUrl(s180, W, H), 0.5);
    show('光碟：背面 150°', toDataUrl(s150, W, H), 0.5);
    const f180 = fanOf(s180, 180);
    const f150 = fanOf(s150, 150);
    const c180 = discFanAngle(180, 0, cameraZ);
    const c150 = discFanAngle(150, 0, cameraZ);
    const moved = angleGap(f180, f150);
    const cpuGap = Math.max(angleGap(f180, c180), angleGap(f150, c150));
    const detail = `GPU 180° ${deg(f180)}°、150° ${deg(f150)}°（轉了 ${moved.toFixed(0)}°）；CPU 180° ${deg(c180)}°、150° ${deg(c150)}°（差最多 ${cpuGap.toFixed(0)}°）`;
    log(`  [彩虹位置] ${detail}`);
    checks.push({ name: '13. 背面轉 180° 與 150° 彩虹的位置不同（和 CPU 算的對得上）', pass: moved > 5 && cpuGap <= 8, detail });

    const along = (lum(s180, f180, 180) + lum(s180, f180 + Math.PI, 180)) / 2;
    const across = (lum(s180, f180 + Math.PI / 2, 180) + lum(s180, f180 - Math.PI / 2, 180)) / 2;
    const fanDetail = `扇形方向平均 ${along.toFixed(0)}、垂直方向 ${across.toFixed(0)}（RGB 總和）`;
    log(`  [扇形] ${fanDetail}`);
    checks.push({ name: '13. 背面在兩道扇形的方向比垂直方向亮', pass: along > across + 60, detail: fanDetail });

    // 鐳射強度 0：扇形上沒有彩虹（通道差只剩銀面的一點色偏）
    const s0 = await view.shot(disc([layer('base', 'b000000000000000', 0, { scale: 1.6 })], 0), getImage, { yaw: 180, pitch: 0, zoom, time: 0.4 });
    let chroma = 0;
    for (const r of [0.25, 0.33, 0.41]) {
      for (const a of [f180, f180 + Math.PI]) {
        const [R, G, B] = px(s0, at('back', r * Math.cos(a), r * Math.sin(a), 180, 0));
        chroma = Math.max(chroma, Math.max(R, G, B) - Math.min(R, G, B));
      }
    }
    log(`  [強度 0] 扇形上通道差最多 ${chroma}`);
    checks.push({ name: '13. 鐳射強度 0 時背面沒有彩虹（扇形上通道差 ≤ 24）', pass: chroma <= 24, detail: `通道差 ${chroma}` });
  }
  return checks;
}

async function fxCheck(view: GpuView, fresh: () => GpuView): Promise<Check[]> {
  // 底圖深灰、主角是一個圓（外面透明、透明處 RGB 0）；同形狀的洋紅圓用來找「形狀外面」；剪裁用的整片淺灰
  const disk = (rgb: readonly [number, number, number]) =>
    makeImage(256, 256, (x, y) => (Math.hypot(x - 127.5, y - 127.5) <= 100 ? [...rgb, 255] : [0, 0, 0, 0]));
  const images = new Map([
    ['b000000000000000', await makeImage(16, 16, () => [40, 44, 60, 255])],
    ['h000000000000000', await disk([120, 100, 160])],
    ['m000000000000000', await disk([255, 0, 255])],
    ['p000000000000000', await makeImage(16, 16, () => [200, 200, 200, 255])],
    // 雙圖光柵（14f）：本來的圖 A＝左邊的圓、變身圖 B＝右邊的圓（兩個圓不重疊）
    ['la00000000000000', await makeImage(256, 256, (x, y) => (Math.hypot(x - 64, y - 128) <= 60 ? [120, 100, 160, 255] : [0, 0, 0, 0]))],
    ['lb00000000000000', await makeImage(256, 256, (x, y) => (Math.hypot(x - 192, y - 128) <= 60 ? [160, 120, 100, 255] : [0, 0, 0, 0]))],
    // 非正常混合模式（14g）：整片不透明，左半是這個模式的中性色（發光的黑、加深的白）、右半是有顏色的
    ['nk00000000000000', await makeImage(256, 256, (x) => (x < 128 ? [0, 0, 0, 255] : [90, 140, 220, 255]))],
    ['nw00000000000000', await makeImage(256, 256, (x) => (x < 128 ? [255, 255, 255, 255] : [200, 150, 100, 255]))],
  ]);
  const getImage = (hash: string) => images.get(hash);
  const base = layer('base', 'b000000000000000', 0, { scale: 1.6 });
  const hero = (over: Partial<Layer> = {}) => layer('hero', 'h000000000000000', 50, { scale: 0.7, ...over });
  const fxOf = (kind: LayerFx['kind'], strength = 100, speed = 50): LayerFx => ({ kind, color: '#ff8040', strength, speed });
  const kinds = ['fire', 'electric', 'water'] as const;
  const kindName = { fire: '火焰', electric: '電光', water: '水波' } as const;
  const checks: Check[] = [];

  // 14a. 沒開＝以前（差 0）：鐳射、卡框、影子都開著的一般卡；各種「沒開」的寫法
  {
    const frame: Frame = { enabled: true, width: 0.03, color: '#d4af37', shine: 50 };
    const rich = (h: Layer): Card =>
      testCard([base, h], { holo: { ...testCard([]).holo, strength: 70, sparkle: 40 }, frame, shadow: { strength: 70, distance: 50 } });
    const poses: Pose[] = [
      { yaw: -20, pitch: 6, zoom: 0.9, time: 0.7 },
      { yaw: 25, pitch: -8, zoom: 0.9, time: 1.9 },
    ];
    const same: Array<[string, Card, Card]> = [
      ['fx 欄位是 undefined＝省略', rich(hero()), rich(hero({ fx: undefined }))],
      ['破框層帶 fx（壞資料）不畫', rich(hero({ breakout: true, scale: 1.2 })), rich(hero({ breakout: true, scale: 1.2, fx: fxOf('fire') }))],
      ...kinds.map((k): [string, Card, Card] => [`${kindName[k]}強度 0`, rich(hero()), rich(hero({ fx: fxOf(k, 0) }))]),
    ];
    for (const [label, a, b] of same) {
      let worst = 0;
      for (const pose of poses) worst = Math.max(worst, diff(await view.shot(a, getImage, pose), await view.shot(b, getImage, pose), 0).maxAbs);
      log(`  [沒開＝以前・${label}] 最大差 ${worst}`);
      checks.push({ name: `14. 沒開特效＝以前（${label}）`, pass: worst === 0, detail: `最大差 ${worst}` });
    }
  }

  // 14b～14d. 三種特效：時間 0 與 1 秒不同、0 與 4 秒一模一樣（週期整除 4 秒）、形狀外面完全不變（0° 與 25°，含剪裁層）
  const plain = (h: Layer, extra: Layer[] = []): Card => testCard([base, h, ...extra]);
  const front: Pose = { yaw: 0, pitch: 0, zoom: 1 };
  /** 像素 i 在兩張圖裡一樣嗎（RGBA 四個都一樣）。 */
  const samePx = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) =>
    a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3];
  /** 在 outside（形狀外面）的像素裡，a、b 不一樣的有幾個；另外回 outside 的像素數。 */
  const outsideChanged = (a: Uint8ClampedArray, b: Uint8ClampedArray, outside: (i: number) => boolean) => {
    let changed = 0;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (!outside(i)) continue;
      n++;
      if (!samePx(a, b, i)) changed++;
    }
    return { changed, n };
  };
  /** 形狀外面（再留 MARGIN 像素）的範圍：ref 與 mask 不一樣的像素＝形狀碰得到的地方，往外 MARGIN 像素也不算「外面」。 */
  const MARGIN = 2;
  const outsideOf = (ref: Uint8ClampedArray, mask: Uint8ClampedArray) => {
    const touched = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
      if (samePx(ref, mask, p * 4)) continue;
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -MARGIN; dy <= MARGIN; dy++)
        for (let dx = -MARGIN; dx <= MARGIN; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && xx < W && yy >= 0 && yy < H) touched[yy * W + xx] = 1;
        }
    }
    return (i: number) => touched[i / 4] === 0;
  };
  for (const k of kinds) {
    const card = plain(hero({ fx: fxOf(k) }));
    const shots = await Promise.all([0, 0.5, 1, 4].map((time) => view.shot(card, getImage, { ...front, time })));
    const [t0, t05, t1, t4] = shots as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
    show(`14. ${kindName[k]}：時間 0／0.5／1 秒（中間 300px）`, toDataUrl(crop(t0, 300), 300, 300), 0.6, 300);
    show(`14. ${kindName[k]} 0.5 秒`, toDataUrl(crop(t05, 300), 300, 300), 0.6, 300);
    show(`14. ${kindName[k]} 1 秒`, toDataUrl(crop(t1, 300), 300, 300), 0.6, 300);
    const moved = diff(t0, t1, 10);
    log(`  [${kindName[k]}] 0 vs 1 秒：${fmt(moved)}`);
    checks.push({ name: `14. ${kindName[k]}：時間 0 與 1 秒畫面不同`, pass: moved.over > 300, detail: `差 > 10 的像素 ${moved.over}` });
    const loop = diff(t0, t4, 0);
    const loop2 = diff(await view.shot(card, getImage, { ...front, time: 1.3 }), await view.shot(card, getImage, { ...front, time: 9.3 }), 0);
    log(`  [${kindName[k]}] 0 vs 4 秒：最大差 ${loop.maxAbs}；1.3 vs 9.3 秒：最大差 ${loop2.maxAbs}`);
    checks.push({ name: `14. ${kindName[k]}：時間 0 與 4 秒（1.3 與 9.3 秒）一模一樣`, pass: loop.maxAbs === 0 && loop2.maxAbs === 0, detail: `最大差 ${loop.maxAbs}、${loop2.maxAbs}` });

    // 形狀外面：沒有特效的同一張卡、把主角換成同形狀洋紅圓的卡，兩張不一樣的像素＝形狀碰得到的地方；再往外留 2 像素
    // （斜看時 mipmap／各向異性取樣讓圓的 alpha 在邊外還有一點點，洋紅疊上去四捨五入後看不出來、亮的特效卻多 1 階）
    const results: string[] = [];
    let bad = false;
    for (const yaw of [0, 25]) {
      const pose: Pose = { yaw, pitch: 0, zoom: 1, time: 0.7 };
      const ref = await view.shot(plain(hero()), getImage, pose);
      const mask = await view.shot(plain(hero({ image: 'm000000000000000' })), getImage, pose);
      const on = await view.shot(plain(hero({ fx: fxOf(k) })), getImage, pose);
      const outside = outsideOf(ref, mask);
      const out = outsideChanged(ref, on, outside);
      // 剪裁：整片淺灰的層只畫在圓裡，特效開在剪裁層上；外面一樣不變
      const clipLayer = (fx?: LayerFx) => layer('pat', 'p000000000000000', 50, { scale: 1.6, clip: true, ...(fx ? { fx } : {}) });
      const clipRef = await view.shot(plain(hero(), [clipLayer()]), getImage, pose);
      const clipOn = await view.shot(plain(hero(), [clipLayer(fxOf(k))]), getImage, pose);
      const clipOut = outsideChanged(clipRef, clipOn, outside);
      const inside = diff(clipRef, clipOn, 10).over;
      results.push(`${yaw}°：外面 ${out.n} 個像素變了 ${out.changed}、剪裁層外面變了 ${clipOut.changed}、剪裁層裡面差 > 10 的 ${inside}`);
      if (out.n < 100000 || out.changed !== 0 || clipOut.changed !== 0 || inside < 300) bad = true;
    }
    log(`  [${kindName[k]}・形狀外面] ${results.join('；')}`);
    checks.push({ name: `14. ${kindName[k]}：形狀外面完全不變（0°、25°；剪裁層也是）`, pass: !bad, detail: results.join('；') });
  }

  // 14e. 減少動態：預覽交給卡片的時間停在同一刻（effectClock），兩個時間的畫面一模一樣；對照組：沒有減少動態時不一樣
  {
    const card = plain(hero({ fx: fxOf('electric') }));
    const still0 = await view.shot(card, getImage, { ...front, time: effectClock(0.3, true) });
    const still1 = await view.shot(card, getImage, { ...front, time: effectClock(1.3, true) });
    const live0 = await view.shot(card, getImage, { ...front, time: effectClock(0.3, false) });
    const live1 = await view.shot(card, getImage, { ...front, time: effectClock(1.3, false) });
    const still = diff(still0, still1, 0).maxAbs;
    const live = diff(live0, live1, 10).over;
    const detail = `減少動態：最大差 ${still}；對照（沒有減少動態）差 > 10 的像素 ${live}`;
    log(`  [減少動態] ${detail}`);
    checks.push({ name: '14. 減少動態時兩個時間的畫面一模一樣', pass: still === 0 && live > 300, detail });
  }

  // 14f. 雙圖光柵層的特效（T-811b）：特效範圍＝混好的 alpha。0° 是 A（左邊的圓）、±20° 是 B（右邊的圓）；
  //      目前看到的那張圖的外面完全不變（含另一張圖的位置）；對照組：只有另一張圖、沒有變身圖的層，特效在那個位置真的畫
  {
    const A = 'la00000000000000';
    const B = 'lb00000000000000';
    // 圖大一點（電光是細線，圓太小時畫到的像素不多）
    const big = { scale: 0.95 };
    const hidden = plain(hero({ image: A, visible: false, ...big }));
    const altHero = (fx?: LayerFx) => hero({ image: A, alt: { image: B, hasAlpha: true }, ...big, ...(fx ? { fx } : {}) });
    const only = (image: string, fx?: LayerFx) => hero({ image, ...big, ...(fx ? { fx } : {}) });
    for (const k of kinds) {
      const results: string[] = [];
      let bad = false;
      for (const [yaw, other] of [[0, B], [20, A], [-20, A]] as const) {
        const pose: Pose = { yaw, pitch: -5, zoom: 1, time: 0.7 };
        const empty = await view.shot(hidden, getImage, pose);
        const off = await view.shot(plain(altHero()), getImage, pose);
        const on = await view.shot(plain(altHero(fxOf(k))), getImage, pose);
        const outside = outsideOf(empty, off);
        const out = outsideChanged(off, on, outside);
        const inside = diff(off, on, 10).over;
        // 對照組：沒有變身圖、只有「另一張圖」的層，特效在另一張圖的位置真的畫
        const otherOff = await view.shot(plain(only(other)), getImage, pose);
        const otherOn = await view.shot(plain(only(other, fxOf(k))), getImage, pose);
        const control = diff(otherOff, otherOn, 10).over;
        results.push(`${yaw}°：看到的圖裡差 > 10 的 ${inside}、外面 ${out.n} 個像素變了 ${out.changed}、對照組（另一張圖的位置）差 > 10 的 ${control}`);
        if (out.n < 100000 || out.changed !== 0 || inside < 100 || control < 100) bad = true;
        if (yaw === 20 && k === 'water') show('14. 雙圖光柵＋水波：20°（只有右邊的圓有特效）', toDataUrl(crop(on, 400), 400, 400), 0.5, 400);
      }
      log(`  [${kindName[k]}・雙圖光柵] ${results.join('；')}`);
      checks.push({ name: `14. ${kindName[k]}：雙圖光柵層的特效範圍跟著看到的那張圖（0° 本來的圖、±20° 變身圖）`, pass: !bad, detail: results.join('；') });
    }
  }

  // 14g. 非正常混合模式（T-811b）：發光（screen）的黑、加深（multiply）的白是中性色，那些地方不發光（和沒開特效一模一樣）；
  //      有顏色的那半照樣發光；對照組：正常模式的層在黑色處真的發光
  {
    const nk = (blend: Layer['blend'], fx?: LayerFx) => hero({ image: 'nk00000000000000', blend, ...(fx ? { fx } : {}) });
    const nw = (blend: Layer['blend'], fx?: LayerFx) => hero({ image: 'nw00000000000000', blend, ...(fx ? { fx } : {}) });
    const pose: Pose = { yaw: 0, pitch: 0, zoom: 1, time: 0.7 };
    // 方塊的範圍（正常模式下和沒有主角的畫面不同的像素）：左半、右半各留 6 像素
    const empty = await view.shot(plain(hero({ image: 'nk00000000000000', visible: false })), getImage, pose);
    const square = await view.shot(plain(nk('normal')), getImage, pose);
    let x0 = W;
    let x1 = -1;
    let y0 = H;
    let y1 = -1;
    for (let p = 0; p < W * H; p++) {
      if (samePx(empty, square, p * 4)) continue;
      const x = p % W;
      const y = (p - x) / W;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const mid = (x0 + x1) / 2;
    const half = (side: 'left' | 'right') => ({ xa: side === 'left' ? x0 + 6 : mid + 6, xb: side === 'left' ? mid - 6 : x1 - 6, ya: y0 + 6, yb: y1 - 6 });
    const changedIn = (a: Uint8ClampedArray, b: Uint8ClampedArray, r: { xa: number; xb: number; ya: number; yb: number }) => {
      let n = 0;
      for (let y = Math.ceil(r.ya); y <= r.yb; y++) for (let x = Math.ceil(r.xa); x <= r.xb; x++) if (!samePx(a, b, (y * W + x) * 4)) n++;
      return n;
    };
    log(`  [非正常混合・方塊] x ${x0}～${x1}、y ${y0}～${y1}`);
    for (const k of kinds) {
      const results: string[] = [];
      let bad = false;
      // 對照組：正常模式的層，黑色那半真的有特效
      const control = changedIn(await view.shot(plain(nk('normal')), getImage, pose), await view.shot(plain(nk('normal', fxOf(k))), getImage, pose), half('left'));
      results.push(`對照（正常模式・黑色那半）變了 ${control}`);
      if (control < 300) bad = true;
      for (const [label, make, blend] of [['發光＋黑', nk, 'screen'], ['加深＋白', nw, 'multiply']] as const) {
        const off = await view.shot(plain(make(blend)), getImage, pose);
        const on = await view.shot(plain(make(blend, fxOf(k))), getImage, pose);
        const neutral = changedIn(off, on, half('left'));
        const colored = changedIn(off, on, half('right'));
        results.push(`${label}：中性色那半變了 ${neutral}、有顏色那半變了 ${colored}`);
        if (neutral !== 0 || colored < 300) bad = true;
        if (k === 'water' && blend === 'screen') show('14. 發光模式＋水波（左半黑色不發光、右半發光）', toDataUrl(crop(on, 400), 400, 400), 0.5, 400);
      }
      log(`  [${kindName[k]}・非正常混合] ${results.join('；')}`);
      checks.push({ name: `14. ${kindName[k]}：發光、加深模式的層，中性色的地方不發光（有顏色的地方照樣發光）`, pass: !bad, detail: results.join('；') });
    }
  }

  // 14h. CD 光碟印刷面上的特效（T-811b）：圓環裡真的畫；孔裡、透明圈、光碟外面完全不變（正面 0°、斜看 30°／-10°；
  //      「外面」容許最多 EDGE_NOISE_PIXELS 個邊緣雜訊像素，T-811c）
  {
    const disc = fresh();
    const zoom = 0.8;
    const cameraZ = cameraDistance(30, W / H, zoom, cardBox(1));
    const scene = (yaw: number, pitch: number): PickScene => ({
      vFovDeg: 30,
      viewAspect: W / H,
      cameraZ,
      yawDeg: yaw,
      pitchDeg: pitch,
      outline: discOutline(),
      thickness: DISC_THICKNESS,
    });
    /** 正面 (x, y)（卡寬單位）在畫面上的像素 index（看不到＝-1）。 */
    const at = (x: number, y: number, yaw: number, pitch: number) => {
      const ndc = projectCardPoint('front', x, y, scene(yaw, pitch));
      return ndc ? Math.floor(((1 - ndc.y) / 2) * H) * W + Math.floor(((ndc.x + 1) / 2) * W) : -1;
    };
    const discCard = (k?: LayerFx['kind']): Card =>
      testCard([base, layer('pat', 'p000000000000000', 50, { scale: 2, ...(k ? { fx: fxOf(k) } : {}) })], { aspect: 'square', kind: 'disc' });
    for (const k of kinds) {
      const results: string[] = [];
      let bad = false;
      for (const [yaw, pitch] of [[0, 0], [30, -10]] as const) {
        const pose: Pose = { yaw, pitch, zoom, time: 0.7 };
        const off = await disc.shot(discCard(), getImage, pose);
        const on = await disc.shot(discCard(k), getImage, pose);
        // 印刷面圓環＝沒有特效時完全不透明的像素；圓環以外（孔、透明圈、光碟外面）再留 MARGIN 像素
        const near = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) {
          if (off[p * 4 + 3] !== 255) continue;
          const x = p % W;
          const y = (p - x) / W;
          for (let dy = -MARGIN; dy <= MARGIN; dy++)
            for (let dx = -MARGIN; dx <= MARGIN; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx >= 0 && xx < W && yy >= 0 && yy < H) near[yy * W + xx] = 1;
            }
        }
        const away = outsideChanged(off, on, (i) => near[i / 4] === 0);
        const ring = diff(off, on, 10).over;
        // 孔裡與透明圈上的點（正面 0°）：alpha 0／半透明，兩張一模一樣
        const probes = yaw === 0 ? ([[0, 0], [0.03, 0.01], [-0.03, 0.02], [0.13, 0.02], [-0.12, -0.03]] as const) : [];
        const probeChanged = probes.filter(([x, y]) => {
          const i = at(x, y, yaw, pitch);
          return i < 0 || !samePx(off, on, i * 4);
        }).length;
        results.push(`${yaw}°：圓環裡差 > 10 的 ${ring}、圓環外 ${away.n} 個像素變了 ${away.changed}（容許邊緣雜訊 ${EDGE_NOISE_PIXELS}）、孔與透明圈的取樣點變了 ${probeChanged}`);
        if (ring < 300 || away.n < 50000 || away.changed > EDGE_NOISE_PIXELS || probeChanged !== 0) bad = true;
        if (yaw === 30 && k === 'water') show('14. 光碟印刷面＋水波：30°', toDataUrl(on, W, H), 0.5);
      }
      log(`  [${kindName[k]}・光碟] ${results.join('；')}`);
      checks.push({ name: `14. ${kindName[k]}：光碟印刷面上的特效只在圓環裡（孔、透明圈、光碟外面不變；邊緣雜訊最多 ${EDGE_NOISE_PIXELS} 像素）`, pass: !bad, detail: results.join('；') });
    }
  }

  // 14i. 開著透明卡套時特效照樣畫（T-811b）：形狀裡有特效、形狀外面完全不變（正面 0°、斜看 25°；
  //      「外面」容許最多 EDGE_NOISE_PIXELS 個邊緣雜訊像素，T-811c）
  {
    const withSleeve = (c: Card): Card => ({ ...c, view: { ...c.view, sleeve: true } });
    for (const k of kinds) {
      const sv = fresh();
      const results: string[] = [];
      let bad = false;
      for (const yaw of [0, 25]) {
        const pose: Pose = { yaw, pitch: 0, zoom: 0.9, time: 0.7 };
        const ref = await sv.shot(withSleeve(plain(hero())), getImage, pose);
        const mask = await sv.shot(withSleeve(plain(hero({ image: 'm000000000000000' }))), getImage, pose);
        const on = await sv.shot(withSleeve(plain(hero({ fx: fxOf(k) }))), getImage, pose);
        const out = outsideChanged(ref, on, outsideOf(ref, mask));
        const inside = diff(ref, on, 10).over;
        results.push(`${yaw}°：形狀裡差 > 10 的 ${inside}、外面 ${out.n} 個像素變了 ${out.changed}（容許邊緣雜訊 ${EDGE_NOISE_PIXELS}）`);
        if (out.n < 100000 || out.changed > EDGE_NOISE_PIXELS || inside < 300) bad = true;
        if (yaw === 25 && k === 'electric') show('14. 開著卡套＋電光：25°', toDataUrl(on, W, H), 0.5);
      }
      log(`  [${kindName[k]}・卡套] ${results.join('；')}`);
      checks.push({ name: `14. ${kindName[k]}：開著透明卡套時特效照樣畫（形狀裡有、外面不變；邊緣雜訊最多 ${EDGE_NOISE_PIXELS} 像素）`, pass: !bad, detail: results.join('；') });
    }
  }
  return checks;
}

/** 兩張 RGBA 有幾個位元組不一樣（含 alpha、含透明處）。 */
function bytesChanged(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

async function backdropCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const { width: w, height: h } = gpu;
  const RAD = Math.PI / 180;
  const GREEN = [40, 200, 90] as const;
  const baseImg = await makeImage(8, 8, () => [200, 70, 60, 255]);
  const getImage: GetImage = () => baseImg;
  const card = testCard([layer('bg', 'b000000000000000', 0)]);
  const cardH = aspectHeight(card);
  const greenImg = await makeImage(64, 32, () => [...GREEN, 255]);
  const backdropOf = (img: HTMLImageElement): StageBackdrop => {
    const texture = new Texture(img);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return { texture, width: img.naturalWidth, height: img.naturalHeight };
  };

  /** 卡片＋一種舞台（同 card-view：鏡頭看得到舞台與遠景那兩層；水鏡照水鏡的取景退）。 */
  const stageShot = async (kind: 'water' | 'nebula', mode: 'never' | 'set-unset' | 'set') => {
    const scene = new Scene();
    const obj = createCardObject(gpu.plainBack, gpu.anisotropy, gpu.frameCorner);
    scene.add(obj.group);
    const camera = new PerspectiveCamera(30, w / h, 0.05, 100);
    camera.layers.enable(STAGE_LAYER);
    camera.layers.enable(BACKDROP_LAYER);
    camera.position.set(0, 0, cameraDistance(30, w / h, 0.85, cardBox(cardH), kind === 'water' ? waterReach(cardH) : null));
    camera.updateProjectionMatrix();
    const part = kind === 'water' ? createWaterFx({ camera }) : createNebulaFx();
    part.setCardHeight(cardH);
    scene.add(part.group);
    obj.update(card, getImage);
    obj.setView(0, 0);
    obj.setTime(0);
    const bd = backdropOf(greenImg);
    if (mode !== 'never') part.setBackdrop(bd);
    if (mode === 'set-unset') part.setBackdrop(null);
    part.update(0);
    const px = await gpu.render(scene, camera);
    part.dispose();
    bd.texture.dispose();
    return { px, cameraZ: camera.position.z };
  };

  // ---- 水鏡 ----
  const never = await stageShot('water', 'never');
  const unset = await stageShot('water', 'set-unset');
  const set = await stageShot('water', 'set');
  const same = bytesChanged(never.px, unset.px);
  checks.push({ name: '15. 水鏡沒設背景＝以前（設了又拿掉也一樣）', pass: same === 0, detail: `整張不一樣的位元組 ${same}` });
  show('15. 水鏡＋背景圖（綠）', toDataUrl(set.px, w, h), 0.5);
  // 水平線（遠景平面的下緣）在畫面上的高度；倒影區＝水平線下面 4～40 像素、卡片左邊（畫面寬 4%～22%）
  const seamNdc = waterY(cardH) / ((set.cameraZ + WATER_BACKDROP.distance) * Math.tan(15 * RAD));
  const seamY = Math.round((h / 2) * (1 - seamNdc));
  let reflected = 0;
  let changed = 0;
  let n = 0;
  for (let y = seamY + 4; y < seamY + 40; y++) {
    for (let x = Math.round(w * 0.04); x < Math.round(w * 0.22); x++) {
      const i = (y * w + x) * 4;
      n++;
      if (Math.max(...[0, 1, 2, 3].map((c) => Math.abs(set.px[i + c]! - never.px[i + c]!))) > 10) changed++;
      const [r, g, b] = [set.px[i]!, set.px[i + 1]!, set.px[i + 2]!];
      if (g > r + 30 && g > b + 20 && set.px[i + 3] === 255) reflected++;
    }
  }
  checks.push({
    name: '15. 水鏡有背景時倒影區的像素和沒背景不同、映著背景圖的顏色',
    pass: n > 0 && changed > n * 0.9 && reflected > n * 0.6,
    detail: `水平線在第 ${seamY} 列；倒影區 ${n} 個像素：變了 ${changed}、偏綠 ${reflected}`,
  });
  // 水平線上方（左上角一塊）＝背景圖 × 約 85% 亮度、不透明；沒背景時是透明（後面是 CSS）
  const top = pixelAt(set.px, w, 6, 6);
  const want = GREEN.map((c) => c * 0.85);
  const topOk =
    top.every((c, k) => Math.abs(c - want[k]!) <= 14) && set.px[(6 * w + 6) * 4 + 3] === 255 && never.px[(6 * w + 6) * 4 + 3] === 0;
  checks.push({
    name: '15. 水鏡的遠景：水平線上方是背景圖（約 85% 亮度）',
    pass: topOk,
    detail: `左上角 ${top.join(',')}（要約 ${want.map(Math.round).join(',')}）`,
  });

  // ---- 星雲 ----
  const nNever = await stageShot('nebula', 'never');
  const nUnset = await stageShot('nebula', 'set-unset');
  const nSet = await stageShot('nebula', 'set');
  const nSame = bytesChanged(nNever.px, nUnset.px);
  const nChanged = bytesChanged(nNever.px, nSet.px);
  checks.push({
    name: '15. 星雲沒設背景＝以前（差 0）；設了漩渦讓出來',
    pass: nSame === 0 && nChanged > 5000,
    detail: `設了又拿掉差 ${nSame} 個位元組；設了差 ${nChanged} 個位元組`,
  });

  // ---- 星雲加強（T-817）：真的大圖 /stages/nebula.webp（有 mipmap，同 card-view） ----
  // 這張貼圖是這裡自己建的（part.dispose() 刻意不釋放外部貼圖）：最後一次星雲擷取之後在 finally 釋放（T-817c）
  const swirlBd = backdropOf(await loadImage('/stages/nebula.webp'));
  let swirlFreed = false;
  swirlBd.texture.addEventListener('dispose', () => (swirlFreed = true));
  try {
    /**
     * 星雲：swirl＝換上大圖、swirlUnset＝換上又拿掉、backdrop＝有自己的背景圖；steps＝依序更新的秒數；reduced＝減少動態效果；
     * samples＝MSAA 取樣數（逐位元比對用 0）；only＝只讓一種動畫動（T-817c）：每次 update 照真的程式把大圖轉角（spin）、細絲轉角（arms）、
     * 星點閃爍的時間（stars）、光暈呼吸（halo）都往前走，畫之前再把「不是 only 的那幾個」uniform 放回第一次 update 之後的值，
     * 所以畫面上只剩 only 那一種在變（none＝四種都放回去，對照：不該有第五種會動的東西）。
     */
    const nebulaShot = async (o: {
      swirl?: boolean;
      swirlUnset?: boolean;
      backdrop?: boolean;
      reduced?: boolean;
      steps?: number[];
      samples?: number;
      only?: 'spin' | 'arms' | 'stars' | 'halo' | 'none';
    }) => {
      const scene = new Scene();
      const obj = createCardObject(gpu.plainBack, gpu.anisotropy, gpu.frameCorner);
      scene.add(obj.group);
      const camera = new PerspectiveCamera(30, w / h, 0.05, 100);
      camera.layers.enable(STAGE_LAYER);
      camera.layers.enable(BACKDROP_LAYER);
      camera.position.set(0, 0, cameraDistance(30, w / h, 0.85, cardBox(cardH), null));
      camera.updateProjectionMatrix();
      const part = createNebulaFx();
      part.setCardHeight(cardH);
      part.setReducedMotion(o.reduced ?? false);
      scene.add(part.group);
      obj.update(card, getImage);
      obj.setView(0, 0);
      obj.setTime(0);
      const bd = backdropOf(greenImg);
      if (o.backdrop) part.setBackdrop(bd);
      if (o.swirl || o.swirlUnset) part.setSwirl(swirlBd);
      if (o.swirlUnset) part.setSwirl(null);
      const shots: Uint8ClampedArray[] = [];
      let first: { spin: number; arms: number[]; time: number; halo: number } | null = null;
      for (const dt of o.steps ?? [0]) {
        part.update(dt);
        if (o.only !== undefined) {
          const u = part.uniforms;
          const kept = (first ??= { spin: u.spin.value, arms: u.arms.map((a) => a.value), time: u.time.value, halo: u.halo.value });
          if (o.only !== 'spin') u.spin.value = kept.spin;
          if (o.only !== 'arms') u.arms.forEach((a, i) => (a.value = kept.arms[i]!));
          if (o.only !== 'stars') u.time.value = kept.time;
          if (o.only !== 'halo') u.halo.value = kept.halo;
        }
        shots.push(await gpu.render(scene, camera, { samples: o.samples }));
      }
      part.dispose();
      bd.texture.dispose();
      return shots;
    };
    const [sNever] = await nebulaShot({});
    const [sSwirl] = await nebulaShot({ swirl: true });
    const [sUnset] = await nebulaShot({ swirlUnset: true });
    const swirlChanged = bytesChanged(sNever!, sSwirl!);
    const swirlBack = bytesChanged(sNever!, sUnset!);
    show('15. 星雲＋大圖（T-817）', toDataUrl(sSwirl!, w, h), 0.5);
    checks.push({
      name: '15. 星雲換上大圖（T-817）畫面變了；換上又拿掉＝程式漩渦（差 0）',
      pass: swirlChanged > 5000 && swirlBack === 0,
      detail: `大圖 vs 程式漩渦差 ${swirlChanged} 個位元組；換上又拿掉差 ${swirlBack}`,
    });
    const [sBdProc] = await nebulaShot({ backdrop: true });
    const [sBdSwirl] = await nebulaShot({ backdrop: true, swirl: true });
    const yielded = bytesChanged(sBdProc!, sBdSwirl!);
    checks.push({
      name: '15. 星雲有自己的背景圖：大圖與細絲讓出來（有沒有大圖都一樣，差 0；只剩光暈、細光環、星點）',
      pass: yielded === 0 && bytesChanged(sBdSwirl!, sSwirl!) > 5000,
      detail: `有背景圖時大圖 vs 程式漩渦差 ${yielded} 個位元組；有背景圖 vs 沒有差 ${bytesChanged(sBdSwirl!, sSwirl!)}`,
    });
    const moving = await nebulaShot({ swirl: true, steps: [0, 10] });
    const still = await nebulaShot({ swirl: true, reduced: true, steps: [0, 1 / 60, 10], samples: 0 });
    const turned = bytesChanged(moving[0]!, moving[1]!);
    const frozen = bytesChanged(still[1]!, still[2]!);
    checks.push({
      name: '15. 星雲大圖慢慢轉、細絲轉、星點閃（10 秒後畫面變）；減少動態效果時連更新兩次一模一樣（差 0）',
      pass: turned > 2000 && frozen === 0,
      detail: `10 秒後差 ${turned} 個位元組；減少動態時差 ${frozen}`,
    });
    // 四種動畫分開驗（T-817c）：每種各自讓畫面變，沒有第五種會動的東西；拿掉哪一種動畫，對應那項就會失敗（MSAA 0，逐位元比對）
    const alone = async (only: 'spin' | 'arms' | 'stars' | 'halo' | 'none') => {
      const shots = await nebulaShot({ swirl: true, only, steps: [0, 10], samples: 0 });
      return bytesChanged(shots[0]!, shots[1]!);
    };
    const [aSpin, aArms, aStars, aHalo, aNone] = [await alone('spin'), await alone('arms'), await alone('stars'), await alone('halo'), await alone('none')];
    checks.push({
      name: `15. 星雲：只有大圖轉動（其他動畫固定）10 秒後畫面變（> ${NEBULA_ANIM_MIN.spin} 個位元組）`,
      pass: aSpin > NEBULA_ANIM_MIN.spin,
      detail: `差 ${aSpin} 個位元組`,
    });
    checks.push({
      name: `15. 星雲：只有細絲轉動（其他動畫固定）10 秒後畫面變（> ${NEBULA_ANIM_MIN.arms} 個位元組）`,
      pass: aArms > NEBULA_ANIM_MIN.arms,
      detail: `差 ${aArms} 個位元組`,
    });
    checks.push({
      name: `15. 星雲：只有星點閃爍（其他動畫固定）10 秒後畫面變（> ${NEBULA_ANIM_MIN.stars} 個位元組）`,
      pass: aStars > NEBULA_ANIM_MIN.stars,
      detail: `差 ${aStars} 個位元組`,
    });
    checks.push({
      name: `15. 星雲：只有光暈呼吸（其他動畫固定）10 秒後畫面變（> ${NEBULA_ANIM_MIN.halo} 個位元組）`,
      pass: aHalo > NEBULA_ANIM_MIN.halo,
      detail: `差 ${aHalo} 個位元組`,
    });
    checks.push({
      name: '15. 星雲：四種動畫都固定時，10 秒前後一模一樣（差 0；沒有第五種會動的東西，上面四項才分得開）',
      pass: aNone === 0,
      detail: `差 ${aNone} 個位元組`,
    });
  } finally {
    swirlBd.texture.dispose();
  }
  checks.push({ name: '15. 星雲大圖貼圖（這一節自己建的）用完就釋放（T-817c）', pass: swirlFreed, detail: swirlFreed ? '已釋放' : '沒有釋放' });

  // ---- 匯出的「畫上背景」（composeCapture／paintBase） ----
  const view = gpu.view(createCardObject);
  const raw = await view.shot(card, getImage, { yaw: 25, pitch: 0, zoom: 0.8 });
  const pixels = new Uint8ClampedArray(raw);
  unpremultiply(pixels);
  const image = new ImageData(pixels, w, h);
  const read = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const corners = (px: Uint8ClampedArray) =>
    [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ].map(([x, y]) => [...px.subarray((y! * w + x!) * 4, (y! * w + x!) * 4 + 4)]);
  const SOLID = [30, 160, 220, 255];
  const solid = await makeImage(32, 16, () => [30, 160, 220, 255]);
  const solidBd = { image: solid, width: 32, height: 16 };
  const onPx = read(composeCapture(image, { transparent: false, backdrop: solidBd }));
  const onTransparent = read(composeCapture(image, { transparent: true, backdrop: solidBd }));
  const cornersOk = [onPx, onTransparent].every((px) => corners(px).every((c) => c.every((v, k) => v === SOLID[k])));
  show('15. 畫上背景（PNG）', toDataUrl(onPx, w, h), 0.5);
  // 不勾＝和以前一樣：深藍漸層＋卡片、透明背景只有卡片（以前 captureCard 的寫法）
  const legacy = (transparent: boolean) => {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    if (transparent) ctx.putImageData(image, 0, 0);
    else {
      paintBackdrop(ctx, w, h);
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = w;
      layerCanvas.height = h;
      layerCanvas.getContext('2d')!.putImageData(image, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
    return read(out);
  };
  const offDiff =
    bytesChanged(read(composeCapture(image, { transparent: false })), legacy(false)) +
    bytesChanged(read(composeCapture(image, { transparent: false, backdrop: null })), legacy(false));
  const transDiff = bytesChanged(read(composeCapture(image, { transparent: true })), legacy(true));
  checks.push({
    name: '15. 畫上背景：四角是背景圖的顏色（透明背景勾著也一樣）；不勾和以前一樣',
    pass: cornersOk && offDiff === 0 && transDiff === 0,
    detail: `四角 ${JSON.stringify(corners(onPx))}；不勾差 ${offDiff}、透明背景差 ${transDiff}`,
  });
  // cover 照輸出比例置中裁：左紅右藍的寬圖（2:1，輸出 4:3）→ 左邊紅、右邊藍；上中下三色的高圖 → 四角都是中間那色
  const wide = await makeImage(200, 100, (x) => (x < 100 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const tall = await makeImage(100, 300, (_x, y) => (y < 100 ? [255, 0, 0, 255] : y < 200 ? [0, 255, 0, 255] : [0, 0, 255, 255]));
  const wideC = corners(read(composeCapture(image, { transparent: false, backdrop: { image: wide, width: 200, height: 100 } })));
  const tallC = corners(read(composeCapture(image, { transparent: false, backdrop: { image: tall, width: 100, height: 300 } })));
  const is = (c: number[], rgb: number[]) => rgb.every((v, k) => Math.abs(c[k]! - v) <= 2);
  const coverOk =
    is(wideC[0]!, [255, 0, 0]) &&
    is(wideC[2]!, [255, 0, 0]) &&
    is(wideC[1]!, [0, 0, 255]) &&
    is(wideC[3]!, [0, 0, 255]) &&
    tallC.every((c) => is(c, [0, 255, 0]));
  checks.push({ name: '15. 畫上背景照輸出比例置中裁（cover）', pass: coverOk, detail: `寬圖四角 ${JSON.stringify(wideC)}；高圖四角 ${JSON.stringify(tallC)}` });
  // 轉動匯出每一格的底（paintBase）：有背景圖＝背景圖；沒有＝深藍漸層（和以前一樣）
  const base = (bd: Parameters<typeof paintBase>[3]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paintBase(c.getContext('2d')!, w, h, bd);
    return read(c);
  };
  const gradient = (() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paintBackdrop(c.getContext('2d')!, w, h);
    return read(c);
  })();
  const turnCorners = corners(base(solidBd));
  const turnOk = turnCorners.every((c) => c.every((v, k) => v === SOLID[k])) && bytesChanged(base(null), gradient) === 0;
  checks.push({ name: '15. 轉動匯出每一格的底：畫上背景＝背景圖、不勾＝深藍漸層（和以前一樣）', pass: turnOk, detail: `四角 ${JSON.stringify(turnCorners)}` });
  return checks;
}

/**
 * 水鏡「沒有遠景」的固定參考（T-815b）：T-814 之前的水鏡（父版本 f3d4f39^，還沒有遠景平面、也沒有 setBackdrop／setScene）畫的同一個場景
 * （waterSceneCheck 的 stageScene('water')：標準比例的測試卡、鏡頭距離照 stageReach、時間 0、800×600）。
 * 取法：把 f3d4f39^ 的原始碼用 git archive 解到暫存資料夾（不動目前的 repo 與 src）、另開一個開發伺服器，
 * 在那邊用同一份場景程式（只拿掉遠景圖層）各畫一張、讀回 16 欄 × 12 列格子中心（x＝round((欄+0.5)/16×寬)、y＝round((列+0.5)/12×高））
 * 的像素；WebGPU 與 WebGL2 兩個後端讀到的數字逐位元組相同。每個數字＝0xRRGGBBAA（沒有東西的地方是 0x00000000＝透明）。
 * 新版沒設遠景（或設了又拿掉）時要和這組數字對上：不然「從沒設過」與「設了又拿掉」兩邊一起被改壞時，彼此比較還是差 0，抓不到。
 */
const PARENT_WATER_COLS = 16;
const PARENT_WATER_ROWS = 12;
const PARENT_WATER = [
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x808080ff, 0x808080ff, 0x808080ff, 0x808080ff, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x324874e7, 0x354a76e9, 0x324975eb, 0x27416fed, 0x2b4371ee, 0x2f4673ef, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0xc8463cff, 0x284170ef, 0x344a76ee, 0x243f6eec, 0x213d6deb, 0x223d6de9, 0x2a4370e7,
  0x273e6bff, 0x2e436eff, 0x2d426dff, 0x2c426dff, 0x2e436dff, 0x253d69ff, 0x808080ff, 0x808080ff, 0x808080ff, 0x808080ff, 0x273e6aff, 0x364a72ff, 0x3e5178ff, 0x3c4f76ff, 0x314670ff, 0x253d6aff,
  0x1c345eff, 0x1d345eff, 0x233861ff, 0x1e355eff, 0x1f365eff, 0x253a61ff, 0x2f4166ff, 0x36476bff, 0x35466aff, 0x2d4066ff, 0x253961ff, 0x233860ff, 0x20365fff, 0x233861ff, 0x223860ff, 0x253a62ff,
  0x1a2f56ff, 0x1a2f56ff, 0x1a2f56ff, 0x1c3056ff, 0x1e3257ff, 0x203358ff, 0x9f454cff, 0x9f454cff, 0x9f454cff, 0x9f454cff, 0x24365aff, 0x27385bff, 0x293a5dff, 0x2c3d5fff, 0x2f3f61ff, 0x2c3d60ff,
  0x1c2e51ff, 0x1d2f51ff, 0x1e3051ff, 0x1f3051ff, 0x1f3051ff, 0x203152ff, 0x9c3f47ff, 0x9c4048ff, 0x9c4048ff, 0x9c3e46ff, 0x1f2f51ff, 0x1d2f50ff, 0x1b2d50ff, 0x1b2d50ff, 0x1c2e51ff, 0x1d2f52ff,
] as const;
/** 對參考的容許誤差（每通道，0～255）：不同 GPU 的四捨五入。 */
const PARENT_WATER_TOLERANCE = 4;

/** 畫面和 PARENT_WATER 比：回最大的單通道差與超過容許誤差的取樣點數。 */
function parentWaterDiff(px: Uint8ClampedArray, width: number, height: number): { worst: number; bad: number } {
  let worst = 0;
  let bad = 0;
  for (let r = 0; r < PARENT_WATER_ROWS; r++) {
    for (let c = 0; c < PARENT_WATER_COLS; c++) {
      const want = PARENT_WATER[r * PARENT_WATER_COLS + c]!;
      const x = Math.round(((c + 0.5) / PARENT_WATER_COLS) * width);
      const y = Math.round(((r + 0.5) / PARENT_WATER_ROWS) * height);
      const i = (y * width + x) * 4;
      let point = 0;
      for (let k = 0; k < 4; k++) point = Math.max(point, Math.abs(px[i + k]! - ((want >>> (24 - 8 * k)) & 0xff)));
      worst = Math.max(worst, point);
      if (point > PARENT_WATER_TOLERANCE) bad++;
    }
  }
  return { worst, bad };
}

/** stageSceneOf 要的東西：測試卡、卡高、圖、全息光環用的展示台圖。 */
interface StageSceneContext {
  gpu: Gpu;
  card: Card;
  cardH: number;
  getImage: GetImage;
  pedestal: HTMLImageElement;
}

/**
 * 一個場景：卡片＋舞台切換（鏡頭照 card-view 的取景退；16 水鏡遠景、19 展示廳大廳共用）。shoot 每次 sw.update(dt) 再畫一張
 * （samples＝MSAA 取樣數，要逐位元比對的用 0，見 gpu-harness 的 render），可以在中間改舞台；obj 是卡片物件、sw.group 是舞台那一組
 * （把它們藏起來就只畫另一邊，鏡頭不變）。
 */
function stageSceneOf(c: StageSceneContext, style: StageStyle) {
  const { gpu, card, cardH, getImage, pedestal } = c;
  const { width: w, height: h } = gpu;
  const scene = new Scene();
  const obj = createCardObject(gpu.plainBack, gpu.anisotropy, gpu.frameCorner);
  scene.add(obj.group);
  const camera = new PerspectiveCamera(30, w / h, 0.05, 100);
  camera.layers.enable(STAGE_LAYER);
  camera.layers.enable(BACKDROP_LAYER);
  camera.position.set(0, 0, cameraDistance(30, w / h, 0.85, cardBox(cardH), stageReach(style, cardH)));
  camera.updateProjectionMatrix();
  const sw: StageSwitch<GalleryThumb> = createStageSwitch<GalleryThumb>({
    halo: () => {
      const halo = createStageFx(pedestal, gpu.anisotropy);
      halo.setStyle('halo');
      return halo;
    },
    gallery: () => createGalleryFx({ camera }),
    magic: () => createMagicFx(),
    water: () => createWaterFx({ camera }),
    nebula: () => createNebulaFx(),
    desk: () => createDeskFx({ camera }),
  });
  sw.setCardHeight(cardH);
  sw.setStyle(style);
  scene.add(sw.group);
  obj.update(card, getImage);
  obj.setView(0, 0);
  obj.setTime(0);
  return {
    sw,
    obj,
    cameraZ: camera.position.z,
    shoot: async (dt = 0, options?: { samples?: number }) => {
      sw.update(dt);
      return gpu.render(scene, camera, options);
    },
    done: () => sw.setStyle('none'),
  };
}

/** 水鏡遠景（T-815）：真的三張圖、經 stage-switch 組起來（同 card-view 的呼叫順序：setStyle → setBackdrop → setWaterScene）。 */
async function waterSceneCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const { width: w, height: h } = gpu;
  const RAD = Math.PI / 180;
  const baseImg = await makeImage(8, 8, () => [200, 70, 60, 255]);
  const getImage: GetImage = () => baseImg;
  const card = testCard([layer('bg', 'b000000000000000', 0)]);
  const cardH = aspectHeight(card);
  const pedestal = await loadImage('/brand/pedestal.webp');
  const toBackdrop = (img: HTMLImageElement): StageBackdrop => {
    const texture = new Texture(img);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return { texture, width: img.naturalWidth, height: img.naturalHeight };
  };
  const SCENES: readonly WaterScene[] = ['lake', 'ink', 'fuji'];
  const scenes = new Map<WaterScene, StageBackdrop>();
  for (const name of SCENES) scenes.set(name, toBackdrop(await loadImage(`/stages/water-${name}.webp`)));
  const lake = scenes.get('lake')!;
  const green = toBackdrop(await makeImage(64, 32, () => [40, 200, 90, 255]));

  /** 一個場景：卡片＋舞台切換（鏡頭照 card-view 的取景退）；shoot 每次畫一張，可以在中間改舞台。 */
  const stageScene = (style: StageStyle) => stageSceneOf({ gpu, card, cardH, getImage, pedestal }, style);

  // 水平線（遠景平面的下緣）在畫面上的高度
  const probe = stageScene('water');
  const seamNdc = waterY(cardH) / ((probe.cameraZ + WATER_BACKDROP.distance) * Math.tan(15 * RAD));
  const seamY = Math.round((h / 2) * (1 - seamNdc));
  const never = await probe.shoot();
  probe.done();
  /** 水平線上方、卡片左右兩側（避開卡片）的取樣點。 */
  const above: number[] = [];
  for (let y = Math.round(h * 0.04); y < seamY - 6; y += 4)
    for (let x = 2; x < w; x += 4) if (x < w * 0.27 || x > w * 0.73) above.push((y * w + x) * 4);
  /** 倒影區：水平線下面 4～40 像素、卡片左邊（畫面寬 4%～22%）。 */
  const reflection: number[] = [];
  for (let y = seamY + 4; y < seamY + 40; y++) for (let x = Math.round(w * 0.04); x < Math.round(w * 0.22); x++) reflection.push((y * w + x) * 4);
  const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray, at: number, threshold: number) =>
    [0, 1, 2, 3].some((c) => Math.abs(a[at + c]! - b[at + c]!) > threshold);
  const share = (a: Uint8ClampedArray, b: Uint8ClampedArray, points: readonly number[], threshold = 8) =>
    points.filter((i) => differs(a, b, i, threshold)).length / points.length;

  // ---- 三種遠景 ----
  const shots = new Map<WaterScene, Uint8ClampedArray>();
  for (const name of SCENES) {
    const st = stageScene('water');
    st.sw.setBackdrop(null);
    st.sw.setWaterScene(scenes.get(name)!);
    shots.set(name, await st.shoot());
    st.done();
  }
  show('16. 水鏡遠景：湖光山峰', toDataUrl(shots.get('lake')!, w, h), 0.5);
  show('16. 水鏡遠景：水墨山', toDataUrl(shots.get('ink')!, w, h), 0.5);
  show('16. 水鏡遠景：富士山', toDataUrl(shots.get('fuji')!, w, h), 0.5);
  const pairs: [WaterScene, WaterScene][] = [
    ['lake', 'ink'],
    ['lake', 'fuji'],
    ['ink', 'fuji'],
  ];
  const pairShare = pairs.map(([a, b]) => share(shots.get(a)!, shots.get(b)!, above));
  const opaque = SCENES.every((name) => above.every((i) => shots.get(name)![i + 3] === 255));
  checks.push({
    name: '16. 水鏡三種遠景：水平線上方的取樣像素彼此不同、不透明',
    pass: above.length > 1000 && pairShare.every((f) => f > 0.1) && opaque,
    detail: `水平線在第 ${seamY} 列；取樣 ${above.length} 點，兩兩不同的比例 ${pairShare.map((f) => f.toFixed(2)).join('／')}；不透明 ${opaque}`,
  });
  const reflShare = SCENES.map((name) => share(shots.get(name)!, never, reflection, 10));
  checks.push({
    name: '16. 水鏡遠景：倒影區（水平線下面、卡片旁邊）跟沒遠景比有變',
    pass: reflShare.every((f) => f > 0.9),
    detail: `倒影區 ${reflection.length} 個像素，變了的比例（湖光山峰／水墨山／富士山）${reflShare.map((f) => f.toFixed(2)).join('／')}`,
  });

  // ---- 倒影跟著波紋晃；減少動態時停住 ----
  const moving = stageScene('water');
  moving.sw.setWaterScene(lake);
  const t0 = await moving.shoot(0);
  const t1 = await moving.shoot(1.3);
  moving.done();
  const still = stageScene('water');
  still.sw.setReducedMotion(true);
  still.sw.setWaterScene(lake);
  const r0 = await still.shoot(0);
  const r1 = await still.shoot(1.3);
  still.done();
  const waveShare = share(t0, t1, reflection, 0);
  const aboveSame = share(t0, t1, above, 0);
  const reducedSame = bytesChanged(r0, r1);
  checks.push({
    name: '16. 水鏡遠景：倒影跟著波紋晃（水平線上方不動），減少動態時停住',
    pass: waveShare > 0.05 && aboveSame === 0 && reducedSame === 0,
    detail: `時間走 1.3 秒：倒影區變了 ${(waveShare * 100).toFixed(1)}%、水平線上方變了 ${(aboveSame * 100).toFixed(1)}%；減少動態差 ${reducedSame} 個位元組`,
  });

  // ---- 自己的背景圖優先；遠景拿掉＝以前 ----
  const own = stageScene('water');
  own.sw.setBackdrop(green);
  const ownOnly = await own.shoot();
  own.sw.setWaterScene(lake);
  const ownWithScene = await own.shoot();
  own.done();
  const ownSame = bytesChanged(ownOnly, ownWithScene);
  const ownVsScene = share(ownOnly, shots.get('lake')!, above);
  checks.push({
    name: '16. 有自己的背景圖時用背景圖不用遠景',
    pass: ownSame === 0 && ownVsScene > 0.9,
    detail: `背景圖＋遠景 vs 只有背景圖差 ${ownSame} 個位元組；和湖光山峰比水平線上方 ${(ownVsScene * 100).toFixed(0)}% 不同`,
  });
  const unset = stageScene('water');
  unset.sw.setWaterScene(lake);
  await unset.shoot();
  unset.sw.setWaterScene(null);
  const unsetPx = await unset.shoot();
  unset.done();
  const unsetDiff = bytesChanged(unsetPx, never);
  checks.push({ name: '16. 水鏡遠景設了又拿掉＝以前（沒有遠景）', pass: unsetDiff === 0, detail: `整張不一樣的位元組 ${unsetDiff}` });
  // 「以前」＝T-814 之前的水鏡（固定參考數字，不是新版自己畫的）：從沒設過、設了又拿掉都要對上；對照組（有遠景）要對不上
  const refNever = parentWaterDiff(never, w, h);
  const refUnset = parentWaterDiff(unsetPx, w, h);
  const refLake = parentWaterDiff(shots.get('lake')!, w, h);
  checks.push({
    name: '16. 水鏡沒有遠景＝T-814 之前的水鏡（固定參考數字，192 個取樣點）；有遠景的對照組對不上',
    pass: refNever.bad === 0 && refUnset.bad === 0 && refLake.bad >= 40,
    detail: `最大單通道差：從沒設過 ${refNever.worst}、設了又拿掉 ${refUnset.worst}（容許 ${PARENT_WATER_TOLERANCE}）；對照組（湖光山峰）有 ${refLake.bad} 個取樣點對不上（要 ≥ 40）`,
  });

  // ---- 其他舞台不受影響 ----
  // 偶發的原因（T-811c 對照實驗，2026-10-15）：同一個展示廳場景、同一個時間（dt 0）、不呼叫任何 setter，連畫 6 張，
  // 4x MSAA 時約每 10 個場景有 1 個場景有 1 張的幾十個邊緣像素差 1～14 階（光柱、台緣光環那些細邊；WebGL2 的第一張還常常和後面的
  // 差 1 階，集中在台子頂面的倒影那一帶）；關掉 MSAA（samples 0）後兩種後端 30～40 個場景 × 6 張全部逐位元一樣（第一張也和後面的一樣）。
  // 所以不是時間（dt 0）、不是亂數（程式裡沒有）、也不是倒影晚一格跟上，是 MSAA 讀回在邊緣像素上不穩定。
  // 這一項改用 MSAA 0 畫，仍然要求差 0（不放寬）；另外多畫一張「不呼叫 setter」的對照（control），畫面本身不穩定時直接指出來，
  // 不會誤判成設遠景改了舞台。
  const others: string[] = [];
  let othersOk = true;
  for (const style of ['halo', 'gallery', 'magic', 'nebula', 'none'] as const) {
    const st = stageScene(style);
    const before = await st.shoot(0, { samples: 0 });
    const control = await st.shoot(0, { samples: 0 });
    st.sw.setWaterScene(lake);
    const after = await st.shoot(0, { samples: 0 });
    st.done();
    const noise = bytesChanged(before, control);
    const n = bytesChanged(control, after);
    if (n !== 0 || noise !== 0) othersOk = false;
    others.push(`${style} ${n}${noise !== 0 ? `（對照組自己就差 ${noise}）` : ''}`);
  }
  checks.push({ name: '16. 其他舞台設了水鏡遠景也完全不變（差 0；MSAA 0 畫，同場景不呼叫 setter 的對照也差 0）', pass: othersOk, detail: `差的位元組：${others.join('、')}` });

  for (const b of [...scenes.values(), green]) b.texture.dispose();
  return checks;
}

/** 遠景的位置與大小（T-822）：水鏡的遠景平面（經 stage-switch，同 card-view）與匯出的「畫上背景」（composeCapture／paintBase）。 */
async function farPanCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const { width: w, height: h } = gpu;
  const RAD = Math.PI / 180;
  const baseImg = await makeImage(8, 8, () => [200, 70, 60, 255]);
  const getImage: GetImage = () => baseImg;
  const card = testCard([layer('bg', 'b000000000000000', 0)]);
  const cardH = aspectHeight(card);
  const toBackdrop = (img: HTMLImageElement): StageBackdrop => {
    const texture = new Texture(img);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return { texture, width: img.naturalWidth, height: img.naturalHeight };
  };
  const fuji = toBackdrop(await loadImage('/stages/water-fuji.webp'));
  /** 四條直條紋（左到右：紅、綠、藍、黃），寬高 4:1。 */
  const BANDS = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
  ] as const;
  const stripesBd = toBackdrop(await makeImage(512, 128, (x) => BANDS[Math.floor(x / 128)]!));

  /** 水鏡＋遠景（水鏡遠景或自己的背景圖），照 pan 畫一張（null＝從沒設過位置）；呼叫順序同 card-view。 */
  const waterShot = async (far: { scene?: StageBackdrop; backdrop?: StageBackdrop }, pan: FarPan | null) => {
    const scene = new Scene();
    const obj = createCardObject(gpu.plainBack, gpu.anisotropy, gpu.frameCorner);
    scene.add(obj.group);
    const camera = new PerspectiveCamera(30, w / h, 0.05, 100);
    camera.layers.enable(STAGE_LAYER);
    camera.layers.enable(BACKDROP_LAYER);
    camera.position.set(0, 0, cameraDistance(30, w / h, 0.85, cardBox(cardH), stageReach('water', cardH)));
    camera.updateProjectionMatrix();
    // 這裡只用水鏡（其他舞台的遠景在 CSS 那層，3D 不受 farPan 影響）
    const onlyWater = (): never => {
      throw new Error('17. 只用水鏡');
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
    if (pan) sw.setFarPan(pan);
    if (far.backdrop) sw.setBackdrop(far.backdrop);
    if (far.scene) sw.setWaterScene(far.scene);
    scene.add(sw.group);
    obj.update(card, getImage);
    obj.setView(0, 0);
    obj.setTime(0);
    sw.update(0);
    const px = await gpu.render(scene, camera);
    sw.setStyle('none');
    return { px, cameraZ: camera.position.z };
  };

  // ---- 沒有 farPan＝以前 ----
  const never = await waterShot({ scene: fuji }, null);
  const plain = await waterShot({ scene: fuji }, { x: 0, y: 0, zoom: 1 });
  const neverDiff = bytesChanged(never.px, plain.px);
  checks.push({ name: '17. 沒有 farPan＝以前（水鏡從沒設過位置 vs {0,0,1} 差 0）', pass: neverDiff === 0, detail: `整張不一樣的位元組 ${neverDiff}` });

  // ---- 水鏡：x、大小有作用；y 沒作用 ----
  // 水平線上方、卡片左右兩側的取樣點
  const seamNdc = waterY(cardH) / ((never.cameraZ + WATER_BACKDROP.distance) * Math.tan(15 * RAD));
  const seamY = Math.round((h / 2) * (1 - seamNdc));
  const above: number[] = [];
  for (let y = Math.round(h * 0.04); y < seamY - 6; y += 4)
    for (let x = 2; x < w; x += 4) if (x < w * 0.27 || x > w * 0.73) above.push((y * w + x) * 4);
  const share = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
    above.filter((i) => [0, 1, 2, 3].some((c) => Math.abs(a[i + c]! - b[i + c]!) > 8)).length / above.length;
  // 富士山的圖（2:1）比 4:3 畫面上的遠景平面窄：大小 1 時左右沒有多出來的部分，x 拉到 1 也不動（移到邊就停、不露空白）；
  // 放大之後左右才有多出來的部分，x 才看得出來
  const right1 = await waterShot({ scene: fuji }, { x: 1, y: 0, zoom: 1 });
  const zoomed = await waterShot({ scene: fuji }, { x: 0, y: 0, zoom: 2 });
  const right2 = await waterShot({ scene: fuji }, { x: 1, y: 0, zoom: 2 });
  const yOnly = await waterShot({ scene: fuji }, { x: 0, y: 1, zoom: 2 });
  show('17. 水鏡富士山 x＝0', toDataUrl(plain.px, w, h), 0.5);
  show('17. 水鏡富士山 大小 2', toDataUrl(zoomed.px, w, h), 0.5);
  show('17. 水鏡富士山 大小 2、x＝1', toDataUrl(right2.px, w, h), 0.5);
  const zoomShare = share(zoomed.px, plain.px);
  const rightShare = share(right2.px, zoomed.px);
  const edgeDiff = bytesChanged(right1.px, plain.px);
  const yDiff = bytesChanged(yOnly.px, zoomed.px);
  checks.push({
    name: '17. 水鏡：大小 2 和 1 不同、大小 2 時 x＝1 和 x＝0 不同；只改 y 完全不變（水鏡不用 y）',
    pass: above.length > 1000 && zoomShare > 0.3 && rightShare > 0.3 && yDiff === 0,
    detail: `水平線在第 ${seamY} 列；取樣 ${above.length} 點：大小 2 變了 ${(zoomShare * 100).toFixed(0)}%、大小 2 時 x＝1 變了 ${(rightShare * 100).toFixed(0)}%；只改 y 差 ${yDiff} 個位元組（大小 1 時 x＝1 差 ${edgeDiff} 個位元組：圖比畫面窄就不動）`,
  });
  // 方向：自己的背景圖（四色條紋）x＝−1 看到圖的左邊、x＝1 看到圖的右邊
  const dominant = (px: Uint8ClampedArray, x: number, y: number) => {
    const [r, g, b] = pixelAt(px, w, x, y);
    if (r > 120 && g > 120 && b < 60) return 'yellow';
    if (r > 120 && g < 60 && b < 60) return 'red';
    if (g > 120 && r < 60 && b < 60) return 'green';
    if (b > 120 && r < 60 && g < 60) return 'blue';
    return `?${r},${g},${b}`;
  };
  const ly = Math.round(h * 0.1);
  const lx = Math.round(w * 0.03);
  const rx = Math.round(w * 0.97);
  const sLeft = await waterShot({ backdrop: stripesBd }, { x: -1, y: 0, zoom: 1 });
  const sRight = await waterShot({ backdrop: stripesBd }, { x: 1, y: 0, zoom: 1 });
  const dirs = [dominant(sLeft.px, lx, ly), dominant(sLeft.px, rx, ly), dominant(sRight.px, lx, ly), dominant(sRight.px, rx, ly)];
  show('17. 水鏡四色條紋 x＝−1', toDataUrl(sLeft.px, w, h), 0.5);
  show('17. 水鏡四色條紋 x＝1', toDataUrl(sRight.px, w, h), 0.5);
  checks.push({
    name: '17. 水鏡的方向：x＝−1 畫面左邊是圖最左那條（紅）、x＝1 畫面右邊是最右那條（黃）',
    pass: dirs[0] === 'red' && dirs[3] === 'yellow' && dirs[2] !== 'red' && dirs[1] !== 'yellow',
    detail: `x＝−1 左 ${dirs[0]}、右 ${dirs[1]}；x＝1 左 ${dirs[2]}、右 ${dirs[3]}`,
  });

  // ---- 匯出的「畫上背景」照 farPan 裁 ----
  const view = gpu.view(createCardObject);
  const raw = await view.shot(card, getImage, { yaw: 25, pitch: 0, zoom: 0.8 });
  const pixels = new Uint8ClampedArray(raw);
  unpremultiply(pixels);
  const image = new ImageData(pixels, w, h);
  const read = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const cornerXY = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ] as const;
  const corners = (px: Uint8ClampedArray) => cornerXY.map(([x, y]) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)]);
  const is = (c: number[], rgb: readonly number[]) => rgb.slice(0, 3).every((v, k) => Math.abs(c[k]! - v) <= 2);
  const wide = await makeImage(400, 100, (x) => BANDS[Math.floor(x / 100)]!);
  const tall = await makeImage(100, 300, (_x, y) => (y < 100 ? [255, 0, 0, 255] : y < 200 ? [0, 255, 0, 255] : [0, 0, 255, 255]));
  const wideBd = (pan?: FarPan): BackdropImage => ({ image: wide, width: 400, height: 100, ...(pan ? { pan } : {}) });
  const tallBd = (pan?: FarPan): BackdropImage => ({ image: tall, width: 100, height: 300, ...(pan ? { pan } : {}) });
  const png = (bd: BackdropImage) => read(composeCapture(image, { transparent: false, backdrop: bd }));
  const exportSame =
    bytesChanged(png(wideBd()), png(wideBd({ x: 0, y: 0, zoom: 1 }))) + bytesChanged(png(tallBd()), png(tallBd({ x: 0, y: 0, zoom: 1 })));
  checks.push({ name: '17. 沒有 farPan＝以前（畫上背景：沒有 pan vs {0,0,1} 差 0）', pass: exportSame === 0, detail: `整張不一樣的位元組 ${exportSame}` });
  const [R, G, B, Y] = BANDS;
  const wl = corners(png(wideBd({ x: -1, y: 0, zoom: 1 })));
  const wr = corners(png(wideBd({ x: 1, y: 0, zoom: 1 })));
  const wz = corners(png(wideBd({ x: -1, y: 0, zoom: 3 })));
  const tt = corners(png(tallBd({ x: 0, y: -1, zoom: 1 })));
  const tb = corners(png(tallBd({ x: 0, y: 1, zoom: 1 })));
  const exportOk =
    is(wl[0]!, R) &&
    is(wl[2]!, R) &&
    is(wl[1]!, G) &&
    is(wl[3]!, G) &&
    is(wr[0]!, B) &&
    is(wr[2]!, B) &&
    is(wr[1]!, Y) &&
    is(wr[3]!, Y) &&
    wz.every((c) => is(c, R)) &&
    tt.every((c) => is(c, R)) &&
    tb.every((c) => is(c, B));
  show('17. 畫上背景 x＝1', toDataUrl(png(wideBd({ x: 1, y: 0, zoom: 1 })), w, h), 0.5);
  checks.push({
    name: '17. 畫上背景照 farPan 裁：寬圖 x＝−1／1、大小 3，高圖 y＝−1／1，四角顏色跟著變',
    pass: exportOk,
    detail: `寬圖 x−1 ${JSON.stringify(wl)}；x1 ${JSON.stringify(wr)}；x−1 大小 3 ${JSON.stringify(wz)}；高圖 y−1 ${JSON.stringify(tt)}；y1 ${JSON.stringify(tb)}`,
  });
  // 轉動匯出每一格的底（paintBase）：同一個裁法
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paintBase(c.getContext('2d')!, w, h, wideBd({ x: 1, y: 0, zoom: 1 }));
  const turn = corners(read(c));
  checks.push({
    name: '17. 轉動匯出每一格的底照同一個裁法（x＝1：左邊藍、右邊黃）',
    pass: is(turn[0]!, B) && is(turn[2]!, B) && is(turn[1]!, Y) && is(turn[3]!, Y),
    detail: `四角 ${JSON.stringify(turn)}`,
  });

  fuji.texture.dispose();
  stripesBd.texture.dispose();
  return checks;
}

/**
 * 水面樣子（T-825）動工前（父版本 2c8f477，還沒有 waterLook）用 water-look-scenes.ts 的 WATER_LOOK_SHOTS 在這台電腦
 * （同一個瀏覽器、兩種後端各跑兩次都一樣）取的整張畫面雜湊（FNV-1a）。省略 waterLook 的水鏡要和它逐位元組相同。
 * 換電腦、驅動或瀏覽器版本雜湊可能不同：用父版本跑同一個場景重取（見 water-look-scenes.ts 檔頭）。
 */
const WATER_LOOK_BASELINE: Record<'webgpu' | 'webgl2', readonly string[]> = {
  webgpu: ['7a3f510b', '1202199e', '9c9d59ac', 'fda67e2f'],
  webgl2: ['efd51130', '7b883eff', '816b87d7', '5e7f9e1d'],
};

/** 水面樣子（T-825）。 */
async function waterLookCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const { width: w, height: h } = gpu;
  const RAD = Math.PI / 180;
  const cardH = ASPECT_HEIGHT.standard;
  const want = WATER_LOOK_BASELINE[gpu.backend];
  const hashes = (shots: { px: Uint8ClampedArray }[]) => shots.map((s) => fnv1a(s.px));

  // ---- 〔夜色〕＝以前 ----
  const never = await waterLookShots(gpu);
  const explicit = await waterLookShots(gpu, { look: { ...DEFAULT_WATER_LOOK } });
  const back = await waterLookShots(gpu, { look: { ...MIST_WATER_LOOK }, then: { ...DEFAULT_WATER_LOOK } });
  const [hn, he, hb] = [hashes(never), hashes(explicit), hashes(back)];
  checks.push({
    name: '18. 省略 waterLook＝T-825 以前（四個水鏡畫面的整張雜湊＝動工前取的）',
    pass: hn.every((x, i) => x === want[i]),
    detail: `現在 ${hn.join(' ')}；動工前 ${want.join(' ')}（${gpu.backend}）`,
  });
  const diffs = (a: { px: Uint8ClampedArray }[], b: { px: Uint8ClampedArray }[]) => a.map((s, i) => bytesChanged(s.px, b[i]!.px));
  const de = diffs(explicit, never);
  const db = diffs(back, never);
  checks.push({
    name: '18. 明寫〔夜色〕、先用霧白畫過再換回夜色：和省略一模一樣（差 0）',
    pass: [...de, ...db].every((d) => d === 0) && he.join() === hn.join() && hb.join() === hn.join(),
    detail: `明寫 ${de.join('／')}、換回 ${db.join('／')} 個位元組`,
  });

  // ---- 各個滑桿 ----
  const lake: WaterLookShot[] = [{ name: '湖光山峰、正面、時間 0', far: 'lake', yaw: 0, time: 0 }];
  const one = async (look: typeof DEFAULT_WATER_LOOK, shot: WaterLookShot[] = lake, extra: Parameters<typeof waterLookShots>[1] = {}) =>
    (await waterLookShots(gpu, { ...extra, look, shots: shot }))[0]!;
  const base = await one({ ...DEFAULT_WATER_LOOK });
  const t = Math.tan(15 * RAD);
  const seamRow = (cameraZ: number, gap: number) => Math.round((h / 2) * (1 - waterY(cardH, gap) / ((cameraZ + WATER_BACKDROP.distance) * t)));
  const seam = seamRow(base.cameraZ, waterGap(DEFAULT_WATER_LOOK.lift));
  /** 卡片在畫面上的列（卡片平面 z＝0，地平線怎麼移都一樣）。 */
  const cardRow = (y: number) => Math.round((h / 2) * (1 - y / (base.cameraZ * t)));
  const feetRow = cardRow(-cardH / 2);
  const pts = (x0: number, x1: number, y0: number, y1: number, step = 3) => {
    const out: number[] = [];
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y += step)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(w, Math.round(x1)); x += step) out.push((y * w + x) * 4);
    return out;
  };
  const above = pts(w * 0.02, w * 0.26, h * 0.05, seam - 6);
  const water = pts(w * 0.3, w * 0.7, Math.max(seam, feetRow) + 4, h - 2);
  const cardBody = pts(w * 0.46, w * 0.54, cardRow(cardH * 0.3), cardRow(-cardH * 0.3));
  const share = (a: Uint8ClampedArray, b: Uint8ClampedArray, points: readonly number[], threshold = 8) =>
    points.filter((i) => [0, 1, 2, 3].some((c) => Math.abs(a[i + c]! - b[i + c]!) > threshold)).length / points.length;
  const mean = (px: Uint8ClampedArray, points: readonly number[]) =>
    [0, 1, 2].map((c) => points.reduce((sum, i) => sum + px[i + c]!, 0) / points.length);

  // 霧 100（霧白的顏色）：水平線上下都是霧色，接縫看不出來
  const MIST_RGB = [0xd3, 0xd8, 0xcf];
  const misty = await one({ ...DEFAULT_WATER_LOOK, mist: 100, mistColor: '#d3d8cf' });
  const bandAbove = pts(w * 0.02, w * 0.26, seam - 8, seam - 2, 1);
  const bandBelow = pts(w * 0.02, w * 0.26, seam + 1, seam + 4, 1);
  const ma = mean(misty.px, bandAbove);
  const mb = mean(misty.px, bandBelow);
  const seamGap = Math.max(...ma.map((v, c) => Math.abs(v - mb[c]!)));
  const towardMist = Math.max(...ma.map((v, c) => Math.abs(v - MIST_RGB[c]!)));
  show('18. 霧 100（霧白色）', toDataUrl(misty.px, w, h), 0.5);
  checks.push({
    name: '18. 霧 100：水平線上方的遠景接近霧色、水平線上下兩邊顏色接得上（看不到那條線）',
    pass: towardMist < 14 && seamGap < 8,
    detail: `水平線上方 ${ma.map((v) => v.toFixed(0)).join(',')}、下方 ${mb.map((v) => v.toFixed(0)).join(',')}（霧色 ${MIST_RGB.join(',')}）：上下差 ${seamGap.toFixed(1)}、離霧色 ${towardMist.toFixed(1)}`,
  });

  // 倒影拉長、閃光：只改水面
  const streak = await one({ ...DEFAULT_WATER_LOOK, streak: 100 });
  const glint = await one({ ...DEFAULT_WATER_LOOK, glint: 100 });
  const warm = (px: Uint8ClampedArray) => water.filter((i) => px[i]! > 150 && px[i]! > px[i + 2]! + 40).length;
  show('18. 倒影拉長 100', toDataUrl(streak.px, w, h), 0.5);
  show('18. 閃光 100', toDataUrl(glint.px, w, h), 0.5);
  checks.push({
    name: '18. 倒影拉長 100：水面變了、水平線上方完全不變；閃光 100：水面多了暖色亮點、水平線上方完全不變',
    pass:
      share(streak.px, base.px, water) > 0.2 &&
      share(streak.px, base.px, above, 0) === 0 &&
      warm(glint.px) > warm(base.px) + 20 &&
      share(glint.px, base.px, above, 0) === 0,
    detail: `拉長：水面變了 ${(share(streak.px, base.px, water) * 100).toFixed(0)}%、上方 ${(share(streak.px, base.px, above, 0) * 100).toFixed(1)}%；閃光：暖色亮點 ${warm(base.px)} → ${warm(glint.px)}、上方 ${(share(glint.px, base.px, above, 0) * 100).toFixed(1)}%`,
  });

  // 倒影拉長的方向（T-825d）：深色底卡靠下緣一條紅色色塊（'band'），和沒有色塊的同一張卡（'plain'）在同樣的水面樣子下相減，
  // 剩下的就是色塊的倒影（腳邊以下、卡片中間那一欄）；拉長 100 時倒影往下（遠離卡片）延伸，上方（卡片那邊）不延伸
  {
    const x0 = Math.round(w * 0.42);
    const x1 = Math.round(w * 0.58);
    /** 色塊倒影佔的列：那一列中間那一欄至少 3 個像素和沒有色塊的卡差 > 12。 */
    const reflectionRows = (withBand: Uint8ClampedArray, without: Uint8ClampedArray) => {
      const rows: number[] = [];
      for (let y = feetRow + 2; y < h; y++) {
        let n = 0;
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          if ([0, 1, 2, 3].some((c) => Math.abs(withBand[i + c]! - without[i + c]!) > 12)) n++;
        }
        if (n >= 3) rows.push(y);
      }
      return rows.length > 0 ? { top: rows[0]!, bottom: rows[rows.length - 1]!, count: rows.length } : null;
    };
    const extent = async (streakAmount: number) => {
      const look = { ...DEFAULT_WATER_LOOK, streak: streakAmount };
      const [withBand, without] = [await one(look, lake, { card: 'band' }), await one(look, lake, { card: 'plain' })];
      return reflectionRows(withBand.px, without.px);
    };
    const [e0, e100] = [await extent(0), await extent(100)];
    const fmtExtent = (e: typeof e0) => (e ? `第 ${e.top}～${e.bottom} 列（${e.count} 列）` : '沒有');
    checks.push({
      name: `18. 倒影拉長 100：紅色色塊的倒影往下延伸（最下面那列往下多 ≥ ${STREAK_EXTEND_MIN} 列）、上方不延伸（最上面那列不往上超過 ${STREAK_TOP_SLACK} 列）`,
      pass: e0 !== null && e100 !== null && e0.count >= 6 && e100.bottom >= e0.bottom + STREAK_EXTEND_MIN && e100.top >= e0.top - STREAK_TOP_SLACK,
      detail: `色塊倒影（腳在第 ${feetRow} 列）：拉長 0 ${fmtExtent(e0)}；拉長 100 ${fmtExtent(e100)}`,
    });
  }

  // 波紋：100 比 50 變得多（0 完全不動另外逐像素驗，在下一項）
  const moving = (ripple: number) =>
    Promise.all([0, 2.5].map((time) => one({ ...DEFAULT_WATER_LOOK, ripple }, [{ name: '', far: 'lake', yaw: 0, time }]))).then(([a, b]) => share(a!.px, b!.px, water, 2));
  const [m50, m100] = [await moving(50), await moving(100)];
  checks.push({
    name: '18. 波紋：100 比 50 變得多（時間 0 → 2.5 秒水面變的比例）',
    pass: m50 > 0.05 && m100 >= m50,
    detail: `時間 0 → 2.5 秒水面變了：波紋 50 ${(m50 * 100).toFixed(1)}%、100 ${(m100 * 100).toFixed(1)}%`,
  });
  // 波紋 0（閃光關著）：同一個場景、卡片與鏡頭都不動，時間往前走（再更新 1.7 秒、再 2.5 秒），水平線下面整片（含倒影、月光微光、細波紋、
  // 漣漪）一個位元組都不變（T-817c：以前只驗「< 50 時的三成」，月光微光接回舞台時間時抓不到）；對照：波紋 50 同樣走時間，水面真的會變。
  // 逐位元比對，用 MSAA 0 畫
  {
    const calmLook = { ...DEFAULT_WATER_LOOK, ripple: 0, glint: 0 };
    const surface = (px: Uint8ClampedArray, other: Uint8ClampedArray) => {
      let n = 0;
      for (let y = seam + 1; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) if (px[(y * w + x) * 4 + c] !== other[(y * w + x) * 4 + c]) n++;
      return n;
    };
    const calm = await one(calmLook, lake, { later: [1.7, 2.5], samples: 0 });
    const live = await one({ ...DEFAULT_WATER_LOOK, glint: 0 }, lake, { later: [1.7, 2.5], samples: 0 });
    const calmChanged = calm.later.map((px) => surface(calm.px, px));
    const liveChanged = live.later.map((px) => surface(live.px, px));
    checks.push({
      name: '18. 波紋 0（閃光關著）：卡片、鏡頭不動，時間往前走兩次，水平線下面整片差 0（波紋 50 的對照組會變）',
      pass: calmChanged.every((n) => n === 0) && liveChanged.every((n) => n > 500),
      detail: `水平線在第 ${seam} 列；波紋 0 更新 1.7、再 2.5 秒後水面差 ${calmChanged.join('／')} 個位元組；對照（波紋 50）差 ${liveChanged.join('／')}`,
    });
  }

  // 卡片高度 0：卡片不動、倒影跟著往上
  const lift0 = await one({ ...DEFAULT_WATER_LOOK, lift: 0 });
  checks.push({
    name: '18. 卡片高度 0：卡片那一塊完全不變、倒影變了（水面往上貼到卡片下緣）',
    pass: share(lift0.px, base.px, cardBody, 0) === 0 && share(lift0.px, base.px, water) > 0.1,
    detail: `卡片 ${(share(lift0.px, base.px, cardBody, 0) * 100).toFixed(1)}%、倒影區 ${(share(lift0.px, base.px, water) * 100).toFixed(0)}%`,
  });

  // 地平線 0：卡片在畫面上不動，卡片腳邊上面那一帶（左邊）換成遠景
  const low = await one({ ...DEFAULT_WATER_LOOK, horizon: 0 });
  const beside = pts(w * 0.02, w * 0.26, seam + 4, feetRow - 4);
  show('18. 地平線 0', toDataUrl(low.px, w, h), 0.5);
  checks.push({
    name: '18. 地平線 0：鏡頭往下移（卡片那一塊和地平線 100 幾乎一樣：差 > 8 的 < 3%）、卡片腳邊上面那一帶（原本的水面）換成遠景',
    pass: low.cameraY < 0 && share(low.px, base.px, cardBody) < 0.03 && beside.length > 50 && share(low.px, base.px, beside) > 0.5,
    detail: `鏡頭高度 ${low.cameraY.toFixed(3)}；卡片 ${(share(low.px, base.px, cardBody) * 100).toFixed(1)}%；腳邊上面 ${beside.length} 點變了 ${(share(low.px, base.px, beside) * 100).toFixed(0)}%（水平線原本在第 ${seam} 列、腳在第 ${feetRow} 列）`,
  });

  // 霧白整組（兩種後端都編得過、畫得出來）
  const mistLook = await one({ ...MIST_WATER_LOOK });
  show('18. 霧白', toDataUrl(mistLook.px, w, h), 0.5);
  checks.push({
    name: '18. 霧白整組：畫得出來（和夜色不同、不是空白）',
    pass: share(mistLook.px, base.px, above) > 0.5 && mistLook.px.some((v, i) => i % 4 === 3 && v > 0),
    detail: `水平線上方變了 ${(share(mistLook.px, base.px, above) * 100).toFixed(0)}%`,
  });
  return checks;
}

/**
 * 展示廳畫好的大廳（T-816b）：大廳圖在 CSS 那層（ui/stage.ts），3D 這邊讀好之後 setGalleryHall(true) 把石地板換成只疊倒影與光的
 * 透明大廳地板。照 card-view 的呼叫順序（setStyle('gallery') → setGalleryHall）畫，都用 MSAA 0（要逐位元比對）：
 * 石地板版（還沒讀好）、大廳地板版、大廳地板版但卡片藏起來（看倒影是不是真的來自卡片）、只畫卡片（舞台藏起來，鏡頭不變）。
 */
async function galleryHallCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const { width: w, height: h } = gpu;
  const baseImg = await makeImage(8, 8, () => [200, 70, 60, 255]);
  const getImage: GetImage = () => baseImg;
  const card = testCard([layer('bg', 'b000000000000000', 0)]);
  const cardH = aspectHeight(card);
  const pedestal = await loadImage('/brand/pedestal.webp');
  const hallImg = await loadImage('/stages/gallery-hall.webp');
  const context = { gpu, card, cardH, getImage, pedestal };
  const shoot = async (o: { hall?: boolean; hideCard?: boolean; hideStage?: boolean }) => {
    const st = stageSceneOf(context, 'gallery');
    if (o.hall) st.sw.setGalleryHall(true);
    if (o.hideCard) st.obj.group.visible = false;
    if (o.hideStage) st.sw.group.visible = false;
    const px = await st.shoot(0, { samples: 0 });
    const hallOn = st.sw.galleryHall();
    st.done();
    return { px, hallOn };
  };
  const stone = await shoot({});
  const hall = await shoot({ hall: true });
  const noCard = await shoot({ hall: true, hideCard: true });
  const alone = await shoot({ hideStage: true });
  const n = w * h;

  // 卡片範圍＝只畫卡片時完全不透明的像素；地板範圍＝石地板版不透明、而且不是卡片的像素（台子也算在裡面，只看「石地板換成大廳地板」前後）
  const cardPx: number[] = [];
  const floorPx: number[] = [];
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (alone.px[i + 3] === 255) cardPx.push(i);
    else if (stone.px[i + 3] === 255) floorPx.push(i);
  }
  const opaqueShare = (px: Uint8ClampedArray, points: readonly number[]) => points.filter((i) => px[i + 3] === 255).length / points.length;
  const stoneOpaque = opaqueShare(stone.px, floorPx);
  const hallOpaque = opaqueShare(hall.px, floorPx);
  checks.push({
    name: '19. 大廳圖讀好（setGalleryHall(true)）：石地板讓出來，原本石地板蓋住的地方大多變透明（透出 CSS 那層的大廳）',
    pass: hall.hallOn && !stone.hallOn && floorPx.length > 30000 && stoneOpaque === 1 && hallOpaque < 0.5,
    detail: `地板範圍 ${floorPx.length} 個像素；不透明的比例：石地板 ${(stoneOpaque * 100).toFixed(0)}%、大廳地板 ${(hallOpaque * 100).toFixed(0)}%`,
  });

  // 倒影：卡片在和藏起來時，大廳地板那一塊（地板範圍裡大廳地板版不是不透明的像素；台子的頂面是不透明的、它自己也映卡片，不算）
  // 不一樣的像素＝大廳地板上的倒影；倒影是卡片的紅色（偏紅，不是大廳地板自己的青色光）
  let reflected = 0;
  let redder = 0;
  for (const i of floorPx) {
    if (hall.px[i + 3] === 255 && noCard.px[i + 3] === 255) continue;
    const d = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(hall.px[i + c]! - noCard.px[i + c]!)));
    if (d <= 8) continue;
    reflected++;
    if (hall.px[i]! - noCard.px[i]! > hall.px[i + 2]! - noCard.px[i + 2]!) redder++;
  }
  checks.push({
    name: '19. 大廳地板上有卡片的倒影（卡片藏起來倒影就沒了，多出來的是偏紅的卡片顏色）',
    pass: reflected > 500 && redder > reflected * 0.8,
    detail: `大廳地板那一塊裡有卡片和沒有卡片不一樣的像素 ${reflected}、其中偏紅的 ${redder}`,
  });

  // 卡片完整：卡片範圍（只畫卡片時不透明的像素）在石地板版與大廳地板版都和只畫卡片一模一樣（舞台全在卡片後面）
  const cardDiff = (px: Uint8ClampedArray) => cardPx.filter((i) => [0, 1, 2, 3].some((c) => px[i + c] !== alone.px[i + c])).length;
  const [cardStone, cardHall] = [cardDiff(stone.px), cardDiff(hall.px)];
  checks.push({
    name: '19. 展示廳（石地板、大廳地板兩種）卡片範圍和只畫卡片一模一樣：卡片完整、沒被地板或倒影蓋到（差 0）',
    pass: cardPx.length > 30000 && cardStone === 0 && cardHall === 0,
    detail: `卡片範圍 ${cardPx.length} 個像素；不一樣的：石地板版 ${cardStone}、大廳地板版 ${cardHall}`,
  });

  // 疊在大廳圖上的樣子（CSS 那層：cover 鋪滿、再疊 3D 這張）：給人看，並確認地板範圍的大部分還是大廳圖本身的樣子
  const layered = document.createElement('canvas');
  layered.width = w;
  layered.height = h;
  const ctx = layered.getContext('2d')!;
  const cover = Math.max(w / hallImg.naturalWidth, h / hallImg.naturalHeight);
  ctx.drawImage(hallImg, (w - hallImg.naturalWidth * cover) / 2, (h - hallImg.naturalHeight * cover) / 2, hallImg.naturalWidth * cover, hallImg.naturalHeight * cover);
  const hallOnly = ctx.getImageData(0, 0, w, h).data;
  const over = new Uint8ClampedArray(hall.px);
  unpremultiply(over);
  const overCanvas = document.createElement('canvas');
  overCanvas.width = w;
  overCanvas.height = h;
  overCanvas.getContext('2d')!.putImageData(new ImageData(over, w, h), 0, 0);
  ctx.drawImage(overCanvas, 0, 0);
  const composed = ctx.getImageData(0, 0, w, h).data;
  show('19. 展示廳：大廳圖（CSS 那層）＋透明大廳地板', toDataUrl(composed, w, h), 0.5);
  const near = floorPx.filter((i) => Math.max(...[0, 1, 2].map((c) => Math.abs(composed[i + c]! - hallOnly[i + c]!))) <= 40).length / floorPx.length;
  checks.push({
    name: '19. 疊在大廳圖上：地板範圍大多還是大廳圖本身的樣子（差 ≤ 40 的像素過半）、卡片範圍是卡片',
    pass: near > 0.5 && cardPx.every((i, k) => k % 97 !== 0 || composed[i + 3] === 255),
    detail: `地板範圍裡和純大廳圖差 ≤ 40 的比例 ${(near * 100).toFixed(0)}%`,
  });
  return checks;
}

/**
 * 工作桌（T-832）：卡片＋舞台切換（同 card-view），卡片與展示座擺成同一個角度（card-view 的 setPose：卡片 rotation.set(pitch, yaw, 0)、
 * 舞台 setPose(yaw, pitch)）。每個角度畫三張（MSAA 0，要逐位元比對）：全部、只畫卡片（舞台藏起來＝擷取時的樣子）、只畫舞台（卡片藏起來）。
 */
async function deskCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const { width: w, height: h } = gpu;
  const RAD = Math.PI / 180;
  const images = new Map([
    ['b000000000000000', await makeImage(8, 8, () => [200, 70, 60, 255])],
    ['m000000000000000', await makeImage(400, 500, (x, y) => (x >= 4 && x < 396 && y >= 4 && y < 496 ? [255, 0, 255, 255] : [255, 0, 255, 0]))],
  ]);
  const getImage: GetImage = (hash) => images.get(hash);
  // 底圖放大到蓋滿整張卡（卡片上下也是紅的，夾塊後面那一截、倒影才看得出是卡片的顏色）
  const plain = testCard([layer('bg', 'b000000000000000', 0, { scale: 1.6 })]);
  const pedestal = await loadImage('/brand/pedestal.webp');
  const shots = async (card: Card, yaw: number, pitch: number, setup?: (sw: StageSwitch<GalleryThumb>) => void) => {
    const st = stageSceneOf({ gpu, card, cardH: aspectHeight(card), getImage, pedestal }, 'desk');
    setup?.(st.sw);
    st.obj.group.rotation.set(pitch * RAD, yaw * RAD, 0);
    st.obj.setView(yaw, pitch);
    st.sw.setPose(yaw, pitch);
    const full = await st.shoot(0, { samples: 0 });
    st.sw.group.visible = false;
    const alone = await st.shoot(0, { samples: 0 });
    st.sw.group.visible = true;
    st.obj.group.visible = false;
    const stand = await st.shoot(0, { samples: 0 });
    st.done();
    return { full, alone, stand };
  };
  const n = w * h;
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) =>
    a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3];
  /** 卡片最下面那一列（只畫卡片時不透明的像素裡最下面的）。 */
  const cardBottomRow = (alone: Uint8ClampedArray) => {
    let bottom = 0;
    for (let p = 0; p < n; p++) if (alone[p * 4 + 3] === 255) bottom = Math.max(bottom, Math.floor(p / w));
    return bottom;
  };
  /** 只畫舞台那張裡的壓克力（看得到白；影子是黑的）：顏色最亮的分量 > 25。 */
  const isAcrylic = (stand: Uint8ClampedArray, i: number) => stand[i + 3]! > 0 && Math.max(stand[i]!, stand[i + 1]!, stand[i + 2]!) > 25;
  /** 卡片下面的壓克力：像素數與左右範圍。 */
  const standBelow = (alone: Uint8ClampedArray, stand: Uint8ClampedArray) => {
    const bottom = cardBottomRow(alone);
    let count = 0;
    let minX = w;
    let maxX = 0;
    for (let y = bottom + 1; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!isAcrylic(stand, (y * w + x) * 4)) continue;
        count++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    return { count, width: maxX - minX };
  };

  // ---- 卡片完整、展示座在下面 ----
  const poses: [number, number][] = [
    [0, 0],
    [40, 0],
    [-40, 0],
    [180, 0],
    [20, 10],
    [-20, -10],
  ];
  let width0 = 0;
  for (const [yaw, pitch] of poses) {
    const { full, alone, stand } = await shots(plain, yaw, pitch);
    if (yaw === 0 && pitch === 0) show('20. 工作桌 0°（只畫 3D，木桌是 CSS 那層）', toDataUrl(full, w, h), 0.5);
    if (yaw === 40) show('20. 工作桌 40°', toDataUrl(full, w, h), 0.5);
    let outside = 0;
    let outsideBad = 0;
    let inside = 0;
    let insideSum = 0;
    let insideRed = 0;
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (alone[i + 3] !== 255) continue;
      // 壓克力蓋到的（白）；只有桌面（卡片後面的影子，黑）的地方卡片蓋在上面，也算「沒蓋到」
      if (!isAcrylic(stand, i)) {
        outside++;
        if (!same(full, alone, i)) outsideBad++;
      } else {
        inside++;
        insideSum += (Math.abs(full[i]! - alone[i]!) + Math.abs(full[i + 1]! - alone[i + 1]!) + Math.abs(full[i + 2]! - alone[i + 2]!)) / 3;
        if (full[i]! > full[i + 1]! + 60) insideRed++;
      }
    }
    const below = standBelow(alone, stand);
    if (yaw === 0 && pitch === 0) width0 = below.width;
    const insideMean = insideSum / Math.max(1, inside);
    // 背面是素色卡背（灰），不看紅
    const redOk = yaw === 180 || insideRed > inside * 0.9;
    checks.push({
      name: `20. 工作桌 ${yaw}°／${pitch}°：展示座沒蓋到的卡片＝只畫卡片（差 0）；夾塊那一截隔著壓克力看得到（平均差 ≤ 30、正面還是卡片的紅）；展示座在卡片下面`,
      pass: outside > 20000 && outsideBad === 0 && inside > 500 && insideMean <= 30 && redOk && below.count > 1500,
      detail: `展示座外的卡片 ${outside} 像素、不一樣 ${outsideBad}；夾塊後面的卡片 ${inside} 像素、平均差 ${insideMean.toFixed(1)}、還是紅色 ${((insideRed / Math.max(1, inside)) * 100).toFixed(0)}%；卡片下面的壓克力 ${below.count} 像素`,
    });
  }

  // ---- 跟著卡片轉 ----
  {
    const { alone, stand } = await shots(plain, 90, 0);
    const width90 = standBelow(alone, stand).width;
    checks.push({
      name: '20. 展示座跟著卡片轉：轉 90° 時底座看起來比正面窄（底座寬 1.36、深 0.52 卡寬）',
      pass: width0 > 200 && width90 > 30 && width90 < width0 * 0.65,
      detail: `底座在畫面上的寬：0° ${width0} 像素、90° ${width90} 像素`,
    });
  }

  // ---- 影子、倒影、自己的背景圖 ----
  {
    const { full, alone, stand } = await shots(plain, 0, 0);
    const withBd = await shots(plain, 0, 0, (sw) => sw.setBackdrop({ texture: new Texture(), width: 16, height: 9 }));
    const dark = (px: Uint8ClampedArray) => {
      let c = 0;
      for (let p = 0; p < n; p++) {
        const i = p * 4;
        if (px[i + 3]! > 40 && Math.max(px[i]!, px[i + 1]!, px[i + 2]!) < 12) c++;
      }
      return c;
    };
    const [shadowOn, shadowOff] = [dark(stand), dark(withBd.stand)];
    let acrylicBd = 0;
    for (let p = 0; p < n; p++) if (isAcrylic(withBd.stand, p * 4)) acrylicBd++;
    checks.push({
      name: '20. 桌上有柔和的影子（深色、半透明）；有自己的背景圖時影子讓出來、展示座照畫',
      pass: shadowOn > 1500 && shadowOff < shadowOn * 0.05 && acrylicBd > 3000,
      detail: `影子像素：沒有背景圖 ${shadowOn}、有背景圖 ${shadowOff}；有背景圖時的壓克力像素 ${acrylicBd}`,
    });
    let reflected = 0;
    let redder = 0;
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (alone[i + 3] !== 0) continue;
      const d = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(full[i + c]! - stand[i + c]!)));
      if (d <= 4) continue;
      reflected++;
      if (full[i]! - stand[i]! > full[i + 2]! - stand[i + 2]!) redder++;
    }
    checks.push({
      name: '20. 桌面映出卡片（卡片藏起來倒影就沒了，多出來的是偏紅的卡片顏色）',
      pass: reflected > 300 && redder > reflected * 0.8,
      detail: `卡片外面有卡片和沒有卡片不一樣的像素 ${reflected}、其中偏紅的 ${redder}`,
    });
  }

  // ---- 破框層衝出來（在壓克力前面）：伸出卡外的部分（卡片輪廓外的洋紅）全部和只畫卡片一模一樣，連壓克力範圍裡也是（差 0） ----
  {
    const breakout = testCard([layer('base', 'b000000000000000', 0, { scale: 1.6 }), layer('m', 'm000000000000000', 100, { scale: 2.4, breakout: true })]);
    for (const yaw of [0, 30]) {
      const { full, alone, stand } = await shots(breakout, yaw, 0);
      // 卡片輪廓：同一個角度只畫一般的卡（沒有破框層）時不透明的像素
      const outline = (await shots(plain, yaw, 0)).alone;
      if (yaw === 0) show('20. 工作桌＋破框層', toDataUrl(full, w, h), 0.5);
      let ring = 0;
      let ringBad = 0;
      let overAcrylic = 0;
      for (let p = 0; p < n; p++) {
        const i = p * 4;
        const magenta = alone[i + 3] === 255 && alone[i]! > 200 && alone[i + 1]! < 60 && alone[i + 2]! > 200;
        if (!magenta || outline[i + 3] !== 0) continue;
        ring++;
        if (!same(full, alone, i)) ringBad++;
        if (isAcrylic(stand, i)) overAcrylic++;
      }
      checks.push({
        name: `20. 破框層 ${yaw}°：伸出卡外的部分畫在壓克力前面（卡片輪廓外的破框層和只畫卡片一模一樣，連壓克力範圍裡也差 0）`,
        pass: ring > 20000 && ringBad === 0 && overAcrylic > 2000,
        detail: `卡外的洋紅 ${ring} 像素、不一樣 ${ringBad}；其中疊在壓克力上的 ${overAcrylic}`,
      });
    }
  }

  // ---- 透明卡套開著：卡套和展示座都畫 ----
  {
    const sleeved: Card = { ...plain, view: { ...plain.view, sleeve: true } };
    const a = await shots(sleeved, 35, 0);
    const b = await shots(plain, 35, 0);
    let deskOnly = 0;
    let sleeveOnly = 0;
    for (let i = 0; i < a.full.length; i++) {
      if (a.full[i] !== a.alone[i]) deskOnly++;
      if (a.full[i] !== b.full[i]) sleeveOnly++;
    }
    show('20. 工作桌＋透明卡套 35°', toDataUrl(a.full, w, h), 0.5);
    checks.push({
      name: '20. 開著透明卡套：卡套和展示座都畫（有展示座≠只有卡套、有卡套≠只有展示座）',
      pass: deskOnly > 5000 && sleeveOnly > 2000,
      detail: `和只有卡套（舞台藏起來）差 ${deskOnly} 位元組、和沒開卡套差 ${sleeveOnly} 位元組`,
    });
  }
  return checks;
}

/**
 * 21. 連舞台一起錄（T-850，card-view 的 captureTurntable stage）：用真的 createCardView（自己的 renderer、放在畫面外的容器；不開影格迴圈）。
 *   - 不勾＝舊的路：舞台是魔法陣和關閉時一樣（舊的路不畫舞台）；拍過一次連舞台的之後再拍不勾的，和拍之前一樣（容許 MSAA 邊緣雜訊）。
 *   - 勾了：畫面 320×180、每格不透明；魔法陣真的畫進去（和舞台關閉、同一個 CSS 那層比，差很多像素）；
 *     四角是 CSS 那層的底色（paintScenery 照算的，差 ≤ 2）；隔 0.3 秒再拍一次一樣（舞台照每格時間走，不看真的時間；容許邊緣雜訊）。
 *   - 水鏡的倒影每次 render 都重畫：卡片正面（紅）那一格，卡片下方水面那一帶比背面（灰）那一格紅（倒影沒重畫時兩格一樣）。
 */
async function stageRecordCheck(gpu: Gpu): Promise<Check[]> {
  const checks: Check[] = [];
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-2000px;top:0;width:640px;height:480px;';
  document.body.append(host);
  try {
    const pedestal = await loadImage('/brand/pedestal.webp');
    const view = await createCardView(host, { forceWebGL: gpu.backend === 'webgl2', plainBack: gpu.plainBack, pedestal, frameCorner: gpu.frameCorner });
    const images = new Map([['r000000000000000', await makeImage(8, 8, () => [220, 40, 40, 255])]]);
    const getImage: GetImage = (hash) => images.get(hash);
    view.setCard(testCard([layer('bg', 'r000000000000000', 0, { scale: 1.6 })]), getImage);
    view.setPose({ yawDeg: 0, pitchDeg: 0, zoom: 0.85, front: [{ x: 0, y: 0 }], back: [] });
    const SW = 320;
    const SH = 180;
    const base: TurntableOptions = {
      width: SW,
      frames: 4,
      seconds: 4,
      pitchDeg: -8,
      startTime: 0,
      timeSpan: 4,
      offsetsAt: () => ({ front: [{ x: 0, y: 0 }], back: [] }),
    };
    const withStage = (scenery: StageStyle): TurntableOptions => ({ ...base, stage: { height: SH, zoom: 0.85, scenery: { stage: scenery, image: null }, foreground: null } });
    const grab = async (o: TurntableOptions) => {
      const frames: Uint8ClampedArray[] = [];
      const size = await view.captureTurntable(o, (f) => void frames.push(f));
      return { frames, size };
    };
    /** 兩支裡最多一格有幾個像素不一樣。 */
    const worstPixels = (a: Uint8ClampedArray[], b: Uint8ClampedArray[]) =>
      Math.max(
        ...a.map((fa, k) => {
          const fb = b[k]!;
          let n = 0;
          for (let i = 0; i < fa.length; i += 4) if (fa[i] !== fb[i] || fa[i + 1] !== fb[i + 1] || fa[i + 2] !== fb[i + 2] || fa[i + 3] !== fb[i + 3]) n++;
          return n;
        }),
      );

    // ---- 不勾＝舊的路 ----
    view.setStage('magic');
    const plainMagic = await grab(base);
    view.setStage('none');
    const plainNone = await grab(base);
    const d1 = worstPixels(plainMagic.frames, plainNone.frames);
    checks.push({ name: 'T-850 不勾：舊的路不畫舞台（魔法陣＝關閉）', pass: d1 <= EDGE_NOISE_PIXELS, detail: `最多一格差 ${d1} 個像素（容許 ${EDGE_NOISE_PIXELS}）` });

    // ---- 勾了 ----
    view.setStage('magic');
    const staged = await grab(withStage('magic'));
    const opaque = staged.frames.every((f) => f.every((v, i) => i % 4 !== 3 || v === 255));
    checks.push({
      name: 'T-850 勾了：畫面 320×180、每格不透明',
      pass: staged.size.width === SW && staged.size.height === SH && staged.frames.every((f) => f.length === SW * SH * 4) && opaque,
      detail: `${staged.size.width}×${staged.size.height}、${staged.frames.length} 格、不透明 ${opaque}（這個 createCardView 的後端：${view.backend()}）`,
    });
    view.setStage('none');
    const stagedNone = await grab(withStage('magic'));
    const drawn = worstPixels(staged.frames, stagedNone.frames);
    checks.push({ name: 'T-850 勾了：3D 舞台（魔法陣）畫進去了', pass: drawn > 500, detail: `和舞台關閉比，最多一格差 ${drawn} 個像素（要 > 500）` });

    // 四角＝CSS 那層的底色
    const ref = document.createElement('canvas');
    ref.width = SW;
    ref.height = SH;
    const rctx = ref.getContext('2d')!;
    paintScenery(rctx, SW, SH, { stage: 'magic', image: null });
    const scenery = rctx.getImageData(0, 0, SW, SH).data;
    const corners = [
      [2, 2],
      [SW - 3, 2],
      [2, SH - 3],
      [SW - 3, SH - 3],
    ] as const;
    let cornerWorst = 0;
    for (const f of staged.frames)
      for (const [x, y] of corners) {
        const i = (y * SW + x) * 4;
        for (let c = 0; c < 3; c++) cornerWorst = Math.max(cornerWorst, Math.abs(f[i + c]! - scenery[i + c]!));
      }
    checks.push({ name: 'T-850 勾了：四角是 CSS 那層的底色', pass: cornerWorst <= 2, detail: `最大差 ${cornerWorst} 階` });

    // 舞台照每格時間走：隔 0.3 秒再拍一次一樣
    view.setStage('magic');
    await new Promise((r) => setTimeout(r, 300));
    const again = await grab(withStage('magic'));
    const d2 = worstPixels(staged.frames, again.frames);
    checks.push({ name: 'T-850 勾了：舞台不看真的時間（隔 0.3 秒再拍一樣）', pass: d2 <= EDGE_NOISE_PIXELS, detail: `最多一格差 ${d2} 個像素（容許 ${EDGE_NOISE_PIXELS}）` });

    // 拍過連舞台的之後，不勾的照舊
    const plainAfter = await grab(base);
    const d3 = worstPixels(plainMagic.frames, plainAfter.frames);
    checks.push({ name: 'T-850 拍過連舞台之後，不勾的和之前一樣', pass: d3 <= EDGE_NOISE_PIXELS, detail: `最多一格差 ${d3} 個像素（容許 ${EDGE_NOISE_PIXELS}）` });

    // 水鏡的倒影每次都重畫：正面（紅）那一格卡片下方比背面（灰）那一格紅。
    // 先開影格迴圈（同工坊：每個影格預覽先畫一次，倒影照預覽的角度——卡片正面——畫好）；倒影沒有每次重畫的話，
    // 擷取在同一個影格裡拿到的是預覽那張（正面的紅），背面那一格也一樣紅。這一節是最後一節，迴圈開著不影響別節。
    view.start(() => {});
    view.setStage('water');
    const water = await grab(withStage('water'));
    const redness = (f: Uint8ClampedArray) => {
      let sum = 0;
      let n = 0;
      for (let y = Math.round(SH * 0.82); y < Math.round(SH * 0.97); y++)
        for (let x = Math.round(SW * 0.44); x < Math.round(SW * 0.56); x++) {
          const i = (y * SW + x) * 4;
          sum += f[i]! - f[i + 2]!;
          n++;
        }
      return sum / n;
    };
    const front = redness(water.frames[0]!);
    const back = redness(water.frames[2]!);
    checks.push({
      name: 'T-850 勾了：水鏡的倒影每格都重畫（正面那格的倒影比背面紅）',
      pass: front - back > 4,
      detail: `卡片下方（R − B）平均：正面 ${front.toFixed(1)}、背面 ${back.toFixed(1)}（要多 4 以上）`,
    });

    show('T-850 連舞台（魔法陣）第 0 格', toDataUrl(staged.frames[0]!, SW, SH), 1, SW);
    show('T-850 連舞台（水鏡）第 0 格', toDataUrl(water.frames[0]!, SW, SH), 1, SW);
  } finally {
    host.remove();
  }
  return checks;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const gpu = await createGpu(W, H, params.has('webgl'));
  log(`後端：${gpu.backend}`);
  const only = new Set((params.get('only') ?? '').split(',').filter(Boolean));
  const checks: Check[] = [];
  const sections: [string, string, () => Promise<Check[]>][] = [
    ['1', '1. 透明邊緣', () => edgeCheck(gpu.view(createCardObject))],
    ['2', '2. 中性色（背景 > 1）', () => neutralCheck(gpu.view(createCardObject))],
    ['3', '3. 不透明度', () => opacityCheck(gpu.view(createCardObject))],
    ['4', '4. 七種模式＝TS 參考', () => modeCheck(gpu.view(createCardObject))],
    ['5', '5. 破框層（T-411）', () => breakoutCheck(gpu.view(createCardObject))],
    ['6', '6. 反光層（T-417）', () => foilCheck(gpu.view(createCardObject))],
    ['7', '7. 卡框雕花邊角（T-416）', () => ornateCheck(gpu.view(createCardObject))],
    ['8', '8. 線稿高光（T-802）', () => lineartCheck(gpu.view(createCardObject))],
    ['9', '9. 剪裁遮色片（T-803）', () => clipCheck(gpu.view(createCardObject))],
    ['10', '10. 雙圖光柵（T-805）', () => lenticularCheck(gpu.view(createCardObject))],
    ['11', '11. 透明卡套（T-806）', () => sleeveCheck(() => gpu.view(createCardObject))],
    ['12', '12. 卡片比例（T-807）', () => aspectCheck(gpu.view(createCardObject))],
    ['13', '13. CD 光碟（T-810）', () => discCheck(() => gpu.view(createCardObject))],
    ['14', '14. 局部動態特效（T-811）', () => fxCheck(gpu.view(createCardObject), () => gpu.view(createCardObject))],
    ['15', '15. 舞台背景圖（T-814）', () => backdropCheck(gpu)],
    ['16', '16. 水鏡遠景（T-815）', () => waterSceneCheck(gpu)],
    ['17', '17. 遠景位置（T-822）', () => farPanCheck(gpu)],
    ['18', '18. 水面樣子（T-825）', () => waterLookCheck(gpu)],
    ['19', '19. 展示廳大廳（T-816b）', () => galleryHallCheck(gpu)],
    ['20', '20. 工作桌（T-832）', () => deskCheck(gpu)],
    ['21', '21. 連舞台一起錄（T-850）', () => stageRecordCheck(gpu)],
  ];
  for (const [id, title, run] of sections) {
    if (only.size > 0 && !only.has(id)) continue;
    log(title);
    checks.push(...(await run()));
  }
  const pass = checks.every((c) => c.pass);
  log('');
  for (const c of checks) log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}：${c.detail}`);
  log(pass ? '\n全部通過' : '\n有失敗');
  document.title = `${pass ? 'PASS' : 'FAIL'} GPU 合成`;
  window.__gpuTest = { done: true, pass, backend: gpu.backend, checks };
}

declare global {
  interface Window {
    __gpuTest?: { done: boolean; pass: boolean; backend: string; checks: Check[]; error?: string };
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  log(`錯誤：${message}`);
  window.__gpuTest = { done: true, pass: false, backend: '?', checks: [], error: message };
});
