// GPU 回歸測試的共用工具（T-413）：在瀏覽器裡用真的 WebGPURenderer（沒有 WebGPU 時 three.js 退回 WebGL2）畫卡片、讀回像素。
// vitest 跑在 node、沒有 GPU，所以這些檢查做成開發伺服器上的頁面（tests/gpu/*.html），不在 npm test 裡。
// 測試圖用手寫的 PNG：canvas 會把透明像素的 RGB 清成 0，要控制「透明處的 RGB 是什麼」只能自己編碼。

import { zlibSync } from 'fflate';
import { PerspectiveCamera, RenderTarget, Scene, SRGBColorSpace, WebGPURenderer, type Camera } from 'three/webgpu';
import { newCard } from '../../src/model/create';
import type { Card, Layer } from '../../src/model/types';
import type { CardObject, GetImage } from '../../src/render/card-mesh';
import { aspectHeight } from '../../src/model/aspect';
import { cameraDistance, cardBox } from '../../src/render/fit';
import { packRows } from '../../src/render/pixels';

const RAD = Math.PI / 180;
/** 同 card-view 的鏡頭視角。 */
const FOV_DEG = 30;

// ---- 手寫 PNG（RGBA 8 位元、不壓縮濾波） ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA（每像素 4 位元組、由上到下）→ PNG Blob；透明像素的 RGB 原樣寫進檔案。 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Blob {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // 位元深度
  ihdr[9] = 6; // RGBA
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([signature, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())], {
    type: 'image/png',
  });
}

export type Rgba = readonly [number, number, number, number];

/** 每個像素由 f(x, y) 決定的圖。 */
export async function makeImage(width: number, height: number, f: (x: number, y: number) => Rgba): Promise<HTMLImageElement> {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set(f(x, y), (y * width + x) * 4);
  return loadImage(encodePng(width, height, rgba));
}

/** 載入圖片（用 onload、不用 decode()：窗格沒顯示、頁面不畫格時 decode() 可能一直等）。 */
export function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`圖片載入失敗：${typeof source === 'string' ? source : 'blob'}`));
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  });
}

// ---- 卡片資料 ----

export function layer(id: string, image: string, depth: number, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    role: depth === 0 ? 'base' : 'depth',
    image,
    visible: true,
    depth,
    x: 0,
    y: 0,
    scale: 1,
    holo: false,
    hasAlpha: depth > 0,
    ...extra,
  };
}

/** 只有正面圖層的測試卡：沒有卡框、沒有鐳射、沒有影子（要的話再用 patch 打開）。 */
export function testCard(front: Layer[], patch: Partial<Card> = {}): Card {
  const c = newCard('standard', 'gpu-test', '2026-01-01T00:00:00.000Z');
  return {
    ...c,
    bodyColor: '#808080',
    front: { layers: front },
    frame: { ...c.frame, enabled: false },
    holo: { ...c.holo, strength: 0, sparkle: 0 },
    shadow: { strength: 0, distance: 50 },
    ...patch,
  };
}

// ---- 畫圖、讀回 ----

export interface Pose {
  yaw: number;
  pitch: number;
  zoom: number;
  time?: number;
}

export interface Gpu {
  width: number;
  height: number;
  backend: 'webgpu' | 'webgl2';
  /**
   * 建一個獨立的場景（一個卡片物件）。factory 預設 card-mesh 的 createCardObject，比對舊版時換掉；
   * frameCorner 是真的雕花邊角素材（public/textures/frame-corner.webp，T-416）。
   */
  view(factory: (plainBack: HTMLImageElement, anisotropy: number, frameCorner: HTMLImageElement) => CardObject): GpuView;
  /** 素色卡背紋樣與雕花素材（自己組場景時建卡片物件用，T-814）。 */
  readonly plainBack: HTMLImageElement;
  readonly frameCorner: HTMLImageElement;
  readonly anisotropy: number;
  /**
   * 用同一個 renderer 畫任意場景（T-814：卡片＋舞台），回 RGBA（由上到下、sRGB 位元組）。
   * samples＝MSAA 取樣數（省略＝4，同 card-view 的擷取）：要「逐位元組一模一樣」的比對（差 0）用 0——4x MSAA 的讀回在極少數邊緣像素上
   * 不是逐位元穩定的（同一個場景連畫幾張就會差 1～14 階的幾十個像素，T-811c），關掉 MSAA 之後完全穩定。
   */
  render(scene: Scene, camera: Camera, options?: { samples?: number }): Promise<Uint8ClampedArray>;
}

export interface GpuView {
  obj: CardObject;
  /** 更新卡片、擺好角度、畫一張，回 RGBA（由上到下、sRGB 位元組，和螢幕上的顏色一樣）。 */
  shot(card: Card, getImage: GetImage, pose: Pose): Promise<Uint8ClampedArray>;
}

/** forceWebGL：用 WebGL2 後端（沒有 WebGPU 的瀏覽器會自動退回這個）。 */
export async function createGpu(width: number, height: number, forceWebGL = false): Promise<Gpu> {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  const plainBack = await makeImage(4, 4, () => [128, 128, 128, 255]);
  const frameCorner = await loadImage('/textures/frame-corner.webp');

  /**
   * 同 card-view 的擷取：sRGB 格式、4x MSAA，讀回的位元組＝螢幕上的顏色。
   * 畫之前先 compileAsync（T-811c）：three.js 的 renderer.render 不等著色程式編譯好——同一個場景換了材質（例如水鏡〔霧白〕換回〔夜色〕、
   * 設了遠景又拿掉）、或剛建好的舞台，第一次畫時新的著色程式還沒編譯好，畫出來的東西是舊的／不對的，而且好幾張都一樣不對
   * （2026-10-15 在 16「設了又拿掉」、18「換回夜色」實測：冷啟動時固定差 88414 個位元組；compileAsync 之後差 0）。
   * 機器忙、編譯慢時完整頁面也會碰到，所以每次畫之前都等編譯好（編譯過的有快取，不花什麼時間）。
   */
  let drawing: Promise<unknown> = Promise.resolve();
  const render = async (scene: Scene, camera: Camera, options: { samples?: number } = {}): Promise<Uint8ClampedArray> => {
    const target = new RenderTarget(width, height, { samples: options.samples ?? 4, colorSpace: SRGBColorSpace });
    // 「設 render target → 編譯 → 畫」中間有 await，兩個 render 同時進來（例如 Promise.all）會搶 render target：排隊一個一個畫（讀回可以重疊）
    const turn = drawing.then(async () => {
      try {
        renderer.setRenderTarget(target);
        await renderer.compileAsync(scene, camera);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(null);
      }
    });
    drawing = turn.catch(() => {});
    await turn;
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    target.dispose();
    return packRows(data as ArrayLike<number>, width, height, !isWebGPU);
  };

  return {
    width,
    height,
    backend: isWebGPU ? 'webgpu' : 'webgl2',
    plainBack,
    frameCorner,
    anisotropy,
    render,
    view(factory) {
      const scene = new Scene();
      const obj = factory(plainBack, anisotropy, frameCorner);
      scene.add(obj.group);
      const camera = new PerspectiveCamera(FOV_DEG, width / height, 0.05, 100);
      return {
        obj,
        async shot(card, getImage, pose) {
          obj.update(card, getImage);
          obj.setView(pose.yaw, pose.pitch);
          obj.setTime(pose.time ?? 0);
          obj.group.rotation.set(pose.pitch * RAD, pose.yaw * RAD, 0);
          // 鏡頭照卡片本身退（不管卡套：卡套開關的比較要同一個鏡頭；預覽畫面開卡套時多退一點是 card-view 的事）
          camera.position.set(0, 0, cameraDistance(FOV_DEG, width / height, pose.zoom, cardBox(aspectHeight(card))));
          camera.updateProjectionMatrix();
          // 同 card-view 的擷取：sRGB 格式、4x MSAA，讀回的位元組＝螢幕上的顏色
          const target = new RenderTarget(width, height, { samples: 4, colorSpace: SRGBColorSpace });
          try {
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
          } finally {
            renderer.setRenderTarget(null);
          }
          const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
          target.dispose();
          return packRows(data as ArrayLike<number>, width, height, !isWebGPU);
        },
      };
    },
  };
}

// ---- 比對 ----

export interface Diff {
  /** x 比 ref 暗最多幾階（三個通道裡最多的，0～255）。 */
  darker: number;
  /** 最大差（三個通道裡最大的絕對值）。 */
  maxAbs: number;
  /** 差超過 threshold 的像素數。 */
  over: number;
  /** 平均絕對差（每通道）。 */
  meanAbs: number;
}

/** 只比兩張都完全不透明的像素（卡片輪廓的反鋸齒邊不算）。 */
export function diff(ref: Uint8ClampedArray, x: Uint8ClampedArray, threshold = 10): Diff {
  let darker = 0;
  let maxAbs = 0;
  let over = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < ref.length; i += 4) {
    if (ref[i + 3] !== 255 || x[i + 3] !== 255) continue;
    let pixelMax = 0;
    for (let c = 0; c < 3; c++) {
      const d = ref[i + c]! - x[i + c]!;
      darker = Math.max(darker, d);
      pixelMax = Math.max(pixelMax, Math.abs(d));
      sum += Math.abs(d);
    }
    maxAbs = Math.max(maxAbs, pixelMax);
    if (pixelMax > threshold) over++;
    n++;
  }
  return { darker, maxAbs, over, meanAbs: n > 0 ? sum / (n * 3) : 0 };
}

/** 讀某一點的 RGB。 */
export function pixelAt(px: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * width + Math.round(x)) * 4;
  return [px[i]!, px[i + 1]!, px[i + 2]!];
}

/** RGBA → data URL（放在頁面上給人看）。 */
export function toDataUrl(px: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}
