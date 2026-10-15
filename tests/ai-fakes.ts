// AI 流程測試共用的假東西（T-703、T-704）：結果可以從外面決定的 runner（removeBackground／splitLayers 各自一串 deferred）、
// 假的組裝端（記下加了什麼、換了哪一層的圖〔T-703b〕、訊息、當底圖）。不是測試檔（檔名不是 .test.ts）。
import { expect } from 'vitest';
import type { AiModel, AiProgress, AiRunner, DepthBand, RefineOptions, RgbaImage, SplitOptions } from '../src/ai/types';
import { createCutout, type CutoutAdded, type CutoutDeps, type CutoutSource, type SplitResultPart } from '../src/app/ai-cutout';
import type { StoredImage } from '../src/images/types';
import type { UiMessage } from '../src/ui/types';

export const hashOf = (n: number) => n.toString(16).padStart(16, '0');

export function stored(n: number, hasAlpha: boolean, width = 40, height = 60): StoredImage {
  return { hash: hashOf(n), blob: new Blob([`img-${n}`], { type: 'image/webp' }), type: 'image/webp', width, height, hasAlpha };
}

export const rgba = (width: number, height: number, alpha = 0): RgbaImage => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = alpha;
  return { width, height, data };
};

export function source(cardId = 'card-1', overrides: Partial<CutoutSource> = {}): CutoutSource {
  return { cardId, face: 'front', image: stored(1, false, 2048, 1024), name: 'hero', fileName: 'hero.jpg', ...overrides };
}

interface Deferred<T> {
  signal?: AbortSignal;
  progress?: AiProgress;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export interface CutCall extends Deferred<{ image: RgbaImage; coverage: number }> {
  image: RgbaImage;
  refine: RefineOptions;
}

export interface SplitCall extends Deferred<{ bands: DepthBand[] }> {
  image: RgbaImage;
  options: SplitOptions;
}

const INFO = { backend: 'webgpu', loadMs: 1, runMs: 1, postMs: 1 } as const;

export function fakeRunner(options: { fast?: boolean; available?: boolean | Partial<Record<AiModel, boolean>> } = {}) {
  const calls: CutCall[] = [];
  const splits: SplitCall[] = [];
  const asked = { matte: 0, depth: 0, fast: 0 };
  const deferred = <T,>(signal: AbortSignal | undefined, push: (d: Deferred<T>) => void) =>
    new Promise<T>((resolve, reject) => {
      // 和真的 runner 一樣：取消就立刻以 AbortError reject
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      push({ signal, resolve, reject });
    });
  const runner: Pick<AiRunner, 'available' | 'hasFastBackend' | 'removeBackground' | 'splitLayers'> = {
    async available(model) {
      expect(['matte', 'depth']).toContain(model);
      asked[model]++;
      const a = options.available;
      return typeof a === 'boolean' ? a : (a?.[model] ?? true);
    },
    async hasFastBackend() {
      asked.fast++;
      return options.fast ?? true;
    },
    removeBackground(image, refine, signal, progress) {
      return deferred<{ image: RgbaImage; coverage: number }>(signal, (d) => calls.push({ ...d, image, refine, progress })).then((v) => ({ ...v, info: INFO }));
    },
    splitLayers(image, split, signal, progress) {
      return deferred<{ bands: DepthBand[] }>(signal, (d) => splits.push({ ...d, image, options: split, progress })).then((v) => ({ ...v, info: INFO }));
    },
  };
  return { runner, calls, splits, asked };
}

export interface HarnessOptions {
  fast?: boolean;
  available?: boolean | Partial<Record<AiModel, boolean>>;
  room?: CutoutDeps['room'];
  added?: CutoutAdded;
  addedSplit?: CutoutAdded;
  /** 右欄〔自動去背〕換掉那一層的圖（T-703b）時組裝端回什麼；沒給＝added。 */
  replaced?: CutoutAdded;
  open?: string;
}

/** 假的組裝端：記下加了什麼、訊息、當底圖。encode 依序給雜湊 100、101…；alpha 照圖裡有沒有小於 250 的值。 */
export function harness(options: HarnessOptions = {}) {
  const fake = fakeRunner(options);
  const added: { source: CutoutSource; image: StoredImage }[] = [];
  const splitAdded: { source: CutoutSource; parts: SplitResultPart[] }[] = [];
  const replaced: { source: CutoutSource; image: StoredImage }[] = [];
  const bases: CutoutSource[] = [];
  const messages: UiMessage[] = [];
  let encodeAlpha: boolean | null = true;
  let nextHash = 100;
  const state = { open: options.open ?? 'card-1' };
  const deps: CutoutDeps = {
    runner: fake.runner,
    decode: async (image) => rgba(image.width, image.height, 255),
    async encode(image) {
      let alpha = encodeAlpha;
      if (alpha === null) {
        alpha = false;
        for (let i = 3; i < image.data.length; i += 4) if (image.data[i]! < 250) alpha = true;
      }
      return stored(nextHash++, alpha, image.width, image.height);
    },
    room: options.room ?? (() => null),
    async add(src, image) {
      added.push({ source: src, image });
      return options.added ?? { result: 'added' };
    },
    async addSplit(src, parts) {
      splitAdded.push({ source: src, parts });
      return options.addedSplit ?? { result: 'added' };
    },
    async replace(src, image) {
      replaced.push({ source: src, image });
      return options.replaced ?? { result: 'added' };
    },
    useAsBase: (src) => void bases.push(src),
    isOpen: (cardId) => cardId === state.open,
    message: (m) => void messages.push(m),
    changed: () => {},
  };
  const cutout = createCutout(deps);
  return {
    ...fake, deps, cutout, added, splitAdded, replaced, bases, messages, state,
    /** true／false＝encode 一律回這個 hasAlpha；null＝照圖裡的 alpha 算。 */
    setEncodeAlpha(v: boolean | null) {
      encodeAlpha = v;
    },
  };
}

/** 等 Promise 的後續都跑完。 */
export async function flush(rounds = 16): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
