// T-850c（審查中等②③）：連舞台一起錄時，匯出自己重讀到的舞台圖也要交給 3D 舞台（水鏡遠景、星雲大圖、展示廳大廳），
// 接不上就這次失敗、不下載；水鏡用自己的背景圖時也要確認那張圖拿得到、已經交給 3D 的遠景。
// 情境：預覽讀圖失敗、還在 10 秒的冷卻中（預覽的讀圖狀態沒有圖），匯出時重讀成功 → provide 補進預覽的讀圖狀態 → 3D 接上同一張。
import { describe, expect, it } from 'vitest';
import { createGalleryHall } from '../src/app/gallery-hall';
import { createNebulaSwirl } from '../src/app/nebula-swirl';
import { stage3dMatches, stageSceneryFor, type Stage3dImages } from '../src/app/stage-scenery';
import { createWaterScenes } from '../src/app/water-scenes';
import { updateCard } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, StageStyle, WaterScene } from '../src/model/types';
import type { BackdropImage } from '../src/render/backdrop';
import { flush } from './ui-fake-dom';

const T0 = '2026-10-15T00:00:00.000Z';
const HASH = 'abcdef0123456789';
const card = (stage: StageStyle, over: Partial<Card['view']> = {}): Card => {
  const c = updateCard(newCard('standard', 'c1', T0), { view: { stage } });
  return { ...c, view: { ...c.view, ...over } };
};
const el = (src: string, w = 2048, h = 1024) => ({ src, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement;
const backdrop = (image: HTMLImageElement): BackdropImage => ({ image, width: image.naturalWidth, height: image.naturalHeight });

/** 讀圖一律失敗的預覽狀態（假時鐘停在冷卻中）。 */
const failing = () => ({ load: () => Promise.reject(new Error('404')), loaded() {}, failed() {}, revoke() {}, now: () => 1_000 });

describe('預覽的讀圖狀態：冷卻中也能補上匯出讀到的圖（provide）', () => {
  it('水鏡遠景：讀不到、冷卻中 → provide 之後 image 就是那張；之後 want 不再重讀', async () => {
    let loads = 0;
    const scenes = createWaterScenes({ ...failing(), load: () => (loads++, Promise.reject(new Error('404'))) });
    const water = card('water', { waterScene: 'fuji' as WaterScene });
    scenes.want(water);
    await flush();
    expect(scenes.image('fuji')).toBeNull();
    const before = loads;
    scenes.want(water);
    expect(loads).toBe(before); // 冷卻中
    const img = el('blob:fuji');
    expect(scenes.provide('fuji', img)?.image).toBe(img);
    expect(scenes.image('fuji')?.image).toBe(img);
    expect(scenes.url('fuji')).toBe('blob:fuji');
    scenes.want(water);
    expect(scenes.image('fuji')?.image).toBe(img);
    // 已經有的不換掉；空的圖不收
    expect(scenes.provide('fuji', el('blob:other'))?.image).toBe(img);
    expect(scenes.provide('ink', el('blob:empty', 0, 0))).toBeNull();
  });

  it('星雲大圖：讀不到、冷卻中 → provide 之後 image 就是那張', async () => {
    const swirl = createNebulaSwirl(failing());
    swirl.want(card('nebula'));
    await flush();
    expect(swirl.image()).toBeNull();
    const img = el('blob:nebula');
    expect(swirl.provide(img)?.image).toBe(img);
    expect(swirl.image()?.image).toBe(img);
    expect(swirl.provide(el('blob:empty', 0, 0))?.image).toBe(img);
  });

  it('展示廳大廳：讀不到、冷卻中 → provide 之後 url 就是那張的（3D 換成大廳地板、CSS 那層換上大廳）', async () => {
    const hall = createGalleryHall(failing());
    hall.want(card('gallery'));
    await flush();
    expect(hall.url()).toBeUndefined();
    expect(hall.provide(el('blob:hall'))).toBe('blob:hall');
    expect(hall.url()).toBe('blob:hall');
    expect(createGalleryHall(failing()).provide(el('blob:empty', 0, 0))).toBeUndefined();
  });
});

describe('stageSceneryFor：交給 3D 舞台、接不上就失敗', () => {
  const setup = (attach: (c: Pick<Card, 'view'>, used: Stage3dImages) => boolean = () => true, own: BackdropImage | null = backdrop(el('blob:own'))) => {
    const calls: Stage3dImages[] = [];
    const stageImages = new Map<string, BackdropImage>();
    return {
      calls,
      stageImages,
      deps: {
        image: (hash: string) => (hash === HASH ? own : null),
        stageImage: async (path: string) => {
          const b = backdrop(el(`blob:${path}`));
          stageImages.set(path, b);
          return b;
        },
        attach3d: (c: Pick<Card, 'view'>, used: Stage3dImages) => {
          calls.push(used);
          return attach(c, used);
        },
      },
    };
  };

  it('水鏡、星雲、展示廳：把這次讀到的舞台圖交給 3D（同一個物件）；工作桌、魔法陣、全息光環也問一次（沒有要交的圖）', async () => {
    for (const [stage, path] of [['water', 'stages/water-lake.webp'], ['nebula', 'stages/nebula.webp'], ['gallery', 'stages/gallery-hall.webp'], ['desk', 'stages/desk.webp']] as const) {
      const t = setup();
      await stageSceneryFor(card(stage), t.deps);
      expect(t.calls).toEqual([{ stage: { path, image: t.stageImages.get(path) }, backdrop: null }]);
    }
    const t = setup();
    await stageSceneryFor(card('magic'), t.deps);
    expect(t.calls).toEqual([{ stage: null, backdrop: null }]);
  });

  it('3D 接不上：丟錯（這次匯出失敗）', async () => {
    const t = setup(() => false);
    await expect(stageSceneryFor(card('water'), t.deps)).rejects.toThrow();
    await expect(stageSceneryFor(card('nebula'), t.deps)).rejects.toThrow();
  });

  it('水鏡＋自己的背景圖：圖拿得到 → 交給 3D 的遠景（backdrop）；CSS 那層沒有圖', async () => {
    const t = setup();
    const own = backdrop(el('blob:own'));
    const t2 = setup(undefined, own);
    const s = await stageSceneryFor(card('water', { backdrop: HASH }), t2.deps);
    expect(s.image).toBeNull();
    expect(t2.calls).toEqual([{ stage: null, backdrop: own }]);
    void t;
  });

  it('水鏡＋自己的背景圖：圖拿不到 → 丟錯（不照錄沒有遠景的替代畫面）', async () => {
    const t = setup(undefined, null);
    await expect(stageSceneryFor(card('water', { backdrop: HASH }), t.deps)).rejects.toThrow();
    expect(t.calls).toEqual([]);
  });

  it('其他舞台＋自己的背景圖：也交給 3D（遠景接點）', async () => {
    const own = backdrop(el('blob:own'));
    const t = setup(undefined, own);
    const s = await stageSceneryFor(card('gallery', { backdrop: HASH }), t.deps);
    expect(s.image?.kind).toBe('custom');
    expect(t.calls).toEqual([{ stage: null, backdrop: own }]);
  });
});

describe('stage3dMatches：main 重畫之後 3D 用的是不是這一批', () => {
  const img = backdrop(el('blob:a'));
  const other = backdrop(el('blob:b'));
  const none = { backdrop: null, waterScene: null, nebulaSwirl: null, galleryHall: false };
  const used = (path: string): Stage3dImages => ({ stage: { path, image: img }, backdrop: null });

  it('水鏡、星雲：3D 的那張要是同一張；預覽還沒有（冷卻中沒補上）＝接不上', () => {
    expect(stage3dMatches(card('water'), used('w'), { ...none, waterScene: img })).toBe(true);
    expect(stage3dMatches(card('water'), used('w'), none)).toBe(false);
    expect(stage3dMatches(card('water'), used('w'), { ...none, waterScene: other })).toBe(false);
    expect(stage3dMatches(card('nebula'), used('n'), { ...none, nebulaSwirl: { ...img } })).toBe(true);
    expect(stage3dMatches(card('nebula'), used('n'), none)).toBe(false);
  });

  it('展示廳：大廳地板要換上', () => {
    expect(stage3dMatches(card('gallery'), used('g'), { ...none, galleryHall: true })).toBe(true);
    expect(stage3dMatches(card('gallery'), used('g'), none)).toBe(false);
  });

  it('自己的背景圖：遠景接點要是同一張（水鏡也是）', () => {
    const own: Stage3dImages = { stage: null, backdrop: img };
    expect(stage3dMatches(card('water', { backdrop: HASH }), own, { ...none, backdrop: img })).toBe(true);
    expect(stage3dMatches(card('water', { backdrop: HASH }), own, none)).toBe(false);
  });

  it('全息光環、魔法陣、工作桌：3D 不用舞台的圖', () => {
    expect(stage3dMatches(card('halo'), { stage: null, backdrop: null }, none)).toBe(true);
    expect(stage3dMatches(card('desk'), used('d'), none)).toBe(true);
  });
});
