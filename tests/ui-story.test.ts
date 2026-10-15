// T-804 卡片故事（DESIGN「卡片故事」、SCHEMA Card.story?）：右欄的輸入（字數、行數、輸入法、停手才記一步、字型）、
// 預覽區兩側的直排顯示（顯示條件、兩行左右位置、放不下就不顯示、卡片轉動時不動、textContent）、說明面板、擷取不畫。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanStory } from '../src/model/actions';
import { newCard } from '../src/model/create';
import type { Card, CardStory, FaceSide, StageStyle } from '../src/model/types';
import { CARD_THICKNESS, cardOutline } from '../src/render/fit';
import { ndcToClient, projectCardPoint, type PickScene } from '../src/render/pick';
import { canUndo } from '../src/model/history';
import { createEditor, currentCard, editCard, toUiState, undoEdit, type EditorState } from '../src/ui/editor';
import { createInspector } from '../src/ui/inspector';
import { HELP_SECTIONS, isTextEntry, shortcutFor, TEXT_IDLE_MS } from '../src/ui/logic';
import { createStage } from '../src/ui/stage';
import {
  createStoryView,
  frontCardRect,
  limitStoryInput,
  limitStoryLines,
  placeStory,
  STORY_CHAR_EM,
  STORY_EDGE_PX,
  STORY_GAP_EM,
  STORY_HELP,
  storyCountText,
  storyEnterBlocked,
  storyFontPx,
  storyLines,
  storyFrameKey,
  storyShown,
  storyVisible,
  STORY_ENABLED,
  type StoryBox,
} from '../src/ui/story';
import type { UiIntents, UiState } from '../src/ui/types';
import { all, byClass, FakeEvent, installFakeDom, isShown, keydown, typeInto, type FakeElement } from './ui-fake-dom';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T01:00:00.000Z';
const T2 = '2026-10-14T02:00:00.000Z';
const STORY: CardStory = { text: '一輪明月照星海\n龍鱗映出遠古的光', font: 'wenkai' };

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const intents = new Proxy({} as UiIntents, {
    get: (_t, name: string) => (...args: unknown[]) => void calls.push({ name, args }),
  });
  return { intents, calls };
}

function cardOf(story?: CardStory, stage: StageStyle = 'halo', id = 'c1'): Card {
  const c = newCard('standard', id, T0);
  return { ...c, view: { ...c.view, stage }, ...(story ? { story } : {}) };
}

const stateOf = (card: Card, loadedFonts: UiState['loadedFonts'] = ['wenkai', 'huninn', 'iansui', 'notoserif']): UiState => ({
  ...toUiState(createEditor(card), (h) => `blob:${h}`),
  loadedFonts,
});

// ---------------------------------------------------------------- 純函式

describe('輸入框的小規則', () => {
  it('字數「12／60」：照字元數（表情符號算一個、換行算一個）', () => {
    expect(storyCountText('')).toBe('0／60');
    expect(storyCountText('一輪明月照星海')).toBe('7／60');
    expect(storyCountText('一輪\n明月')).toBe('5／60');
    expect(storyCountText('🌙🌙')).toBe('2／60');
  });

  it('Enter：還只有 1 行可以換行；已經 2 行就不行（選取範圍蓋到原本的換行時可以，換掉它還是 2 行）', () => {
    expect(storyEnterBlocked('一輪明月', 4, 4)).toBe(false);
    expect(storyEnterBlocked('', 0, 0)).toBe(false);
    expect(storyEnterBlocked('一輪\n明月', 5, 5)).toBe(true);
    expect(storyEnterBlocked('一輪\n明月', 0, 0)).toBe(true);
    expect(storyEnterBlocked('一輪\n明月', 1, 4)).toBe(false);
    expect(storyEnterBlocked('一輪\r\n明月', 6, 6)).toBe(true);
  });

  it('只有空白的行不算一行（同 model 的 cleanStory，T-804b）：中間夾空白行不會把第二句截掉；Enter 也照有效行數擋', () => {
    expect(limitStoryLines('一\n   \n二')).toBe('一\n   \n二');
    expect(limitStoryLines('一\n\n二\n三')).toBe('一\n\n二');
    expect(limitStoryLines('\n一\n二\n三')).toBe('\n一\n二');
    expect(storyEnterBlocked('一\n   ', 4, 4)).toBe(false);
    expect(storyEnterBlocked('一\n\n二', 4, 4)).toBe(true);
  });

  it('字數上限照字元算（表情符號算一個，和 model 一樣；T-804b）：超過 60 個剪掉', () => {
    expect(Array.from(limitStoryInput('🌙'.repeat(61))).length).toBe(60);
    expect(limitStoryInput('🌙'.repeat(60))).toBe('🌙'.repeat(60));
    expect(limitStoryInput('一\n二\n三')).toBe('一\n二');
  });

  it('貼上超過 2 行：只留前 2 行（打字中不整理空白）', () => {
    expect(limitStoryLines('一\n二\n三\n四')).toBe('一\n二');
    expect(limitStoryLines(' 一 \n 二 ')).toBe(' 一 \n 二 ');
    expect(limitStoryLines('一\r\n二\r\n三')).toBe('一\r\n二');
    expect(limitStoryLines('一輪明月')).toBe('一輪明月');
  });

  it('故事拆成兩行：第 1 行（右邊）、第 2 行（左邊）', () => {
    expect(storyLines('一輪明月照星海\n龍鱗映出遠古的光')).toEqual(['一輪明月照星海', '龍鱗映出遠古的光']);
    expect(storyLines('一輪明月')).toEqual(['一輪明月']);
  });

  it('什麼時候顯示：有故事、舞台不是「沒有」', () => {
    expect(storyShown(cardOf(STORY, 'halo'))).toBe(true);
    expect(storyShown(cardOf(STORY, 'gallery'))).toBe(true);
    expect(storyShown(cardOf(STORY, 'none'))).toBe(false);
    expect(storyShown(cardOf(undefined, 'halo'))).toBe(false);
  });
});

describe('frontCardRect：卡片正面朝前時在螢幕上的範圍（卡片轉到哪裡都算得一樣）', () => {
  const canvas = { left: 260, top: 70, width: 900, height: 640 };

  /** 和 render 同一套投影（render/pick.ts）：這一格的角度、鏡頭距離。 */
  function scene(cardH: number, yawDeg: number, pitchDeg: number, cameraZ: number): PickScene {
    return {
      vFovDeg: 30,
      viewAspect: canvas.width / canvas.height,
      cameraZ,
      yawDeg,
      pitchDeg,
      outline: cardOutline(cardH, 0.05),
      thickness: CARD_THICKNESS,
    };
  }
  const project = (s: PickScene) => (face: FaceSide, x: number, y: number) => {
    const ndc = projectCardPoint(face, x, y, s);
    return ndc && ndcToClient(ndc, canvas);
  };
  /** 標準答案：yaw 0、pitch 0 時正面四角的外框。 */
  function expected(cardH: number, cameraZ: number): StoryBox {
    const s = scene(cardH, 0, 0, cameraZ);
    const pts = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => project(s)('front', sx * s.outline.halfW, sy * s.outline.halfH)!));
    return {
      left: Math.min(...pts.map((p) => p.x)),
      right: Math.max(...pts.map((p) => p.x)),
      top: Math.min(...pts.map((p) => p.y)),
      bottom: Math.max(...pts.map((p) => p.y)),
    };
  }

  // 卡高（aspectHeight）：標準卡、塔羅牌，以及 T-807 的正方形、明信片、橫式自訂 3:2 與 2:1
  it.each([
    ['標準卡', 88 / 63],
    ['塔羅牌', 120 / 70],
    ['正方形', 1],
    ['明信片', 1.48],
    ['橫式 3:2', 2 / 3],
    ['橫式 2:1', 0.5],
  ] as const)('%s：各種角度、鏡頭距離都等於正面朝前的外框（誤差 < 0.001 px）', (_label, cardH) => {
    for (const cameraZ of [2.1, 3.4, 5]) {
      const want = expected(cardH, cameraZ);
      for (const yaw of [0, 0.0005, 3, 15, 37, 80, 120, 179.9, 180, 200, -45, 300, 721]) {
        for (const pitch of [0, -8, 25, -60]) {
          const s = scene(cardH, yaw, pitch, cameraZ);
          const got = frontCardRect({ yawDeg: yaw, pitchDeg: pitch, cardH, canvas, project: project(s) });
          expect(got, `yaw ${yaw} pitch ${pitch} z ${cameraZ}`).not.toBeNull();
          for (const k of ['left', 'right', 'top', 'bottom'] as const) {
            expect(Math.abs(got![k] - want[k]), `${k} yaw ${yaw} pitch ${pitch} z ${cameraZ}`).toBeLessThan(1e-3);
          }
        }
      }
    }
  });

  it('沿用上一次外框的條件（storyFrameKey，T-804b）：比例、縮放、畫布位置大小有一個變了就不能沿用', () => {
    const canvas = { left: 10, top: 20, width: 800, height: 600 };
    const std = 88 / 63;
    const k = storyFrameKey(std, 0.85, canvas);
    expect(storyFrameKey(std, 0.85, { ...canvas })).toBe(k);
    expect(storyFrameKey(120 / 70, 0.85, canvas)).not.toBe(k);
    expect(storyFrameKey(std, 0.9, canvas)).not.toBe(k);
    expect(storyFrameKey(std, 0.85, { ...canvas, width: 700 })).not.toBe(k);
    expect(storyFrameKey(std, 0.85, { ...canvas, left: 0 })).not.toBe(k);
    // T-807：自訂比例的卡高不同也不能沿用（例如 3:2 換成 4:3）
    expect(storyFrameKey(2 / 3, 0.85, canvas)).not.toBe(storyFrameKey(3 / 4, 0.85, canvas));
  });

  it('側面剛好對著鏡頭（兩面都看不到）：null（呼叫端沿用上一次的）', () => {
    const got = frontCardRect({ yawDeg: 90, pitchDeg: 0, cardH: 88 / 63, canvas, project: () => null });
    expect(got).toBeNull();
  });
});

describe('字級與擺放（純函式）', () => {
  it('字級：卡片在畫面上高度的 6.5%（13～30 px，主對話看過 1280×720 覺得 5% 太小）；一行太長就縮小到放得下卡片高度（最小 13 px）', () => {
    expect(storyFontPx(400, 8)).toBe(26);
    expect(storyFontPx(1000, 8)).toBe(30);
    expect(storyFontPx(200, 4)).toBe(13);
    expect(storyFontPx(400, 20)).toBe(16); // 400 / (20 × 1.25)
    expect(storyFontPx(400, 60)).toBe(13);
    expect(STORY_CHAR_EM).toBe(1.25);
  });

  const card: StoryBox = { left: 300, right: 500, top: 100, bottom: 380 };
  const area = { width: 800, height: 480 };

  it('第 1 行在卡片右邊、第 2 行在左邊，各自放在那一邊空地的正中間（至少離卡片 gap）、垂直置中，不蓋到卡片', () => {
    const p = placeStory({ card, area, gap: 28, right: { width: 30, height: 200 }, left: { width: 30, height: 160 } })!;
    // 右邊空地 500～800 的中間 650、左邊空地 0～300 的中間 150
    expect(p.right).toEqual({ x: 635, y: 140 });
    expect(p.left).toEqual({ x: 135, y: 160 });
    expect(p.right.x).toBeGreaterThanOrEqual(card.right);
    expect(p.left!.x + 30).toBeLessThanOrEqual(card.left);
  });

  it('只有一行：只放右邊', () => {
    const p = placeStory({ card, area, gap: 28, right: { width: 30, height: 200 }, left: null })!;
    expect(p.left).toBeNull();
    expect(p.right.x).toBe(635);
  });

  it('空地很窄時：至少離卡片 gap（不會為了置中貼到卡片上）', () => {
    const p = placeStory({ card, area: { width: 600, height: 480 }, gap: 28, right: { width: 30, height: 200 }, left: null })!;
    // 空地 500～600 的中間 550 → x 535，比 528 大，照中間
    expect(p.right.x).toBe(535);
    const tight = placeStory({ card, area: { width: 570, height: 480 }, gap: 28, right: { width: 30, height: 200 }, left: null })!;
    // 中間 535 → x 520 < 528 → 用 528
    expect(tight.right.x).toBe(528);
  });

  it('放不下（右邊或左邊超出預覽區、上下超出）→ 整個不顯示（null）', () => {
    const r = { width: 30, height: 200 };
    // 右邊：528 + 30 > 560 − 10
    expect(placeStory({ card, area: { width: 560, height: 480 }, gap: 28, right: r, left: null })).toBeNull();
    // 左邊：卡片太靠左
    expect(placeStory({ card: { ...card, left: 50, right: 250 }, area, gap: 28, right: r, left: r })).toBeNull();
    // 只有一行時不看左邊
    expect(placeStory({ card: { ...card, left: 50, right: 250 }, area, gap: 28, right: r, left: null })).not.toBeNull();
    // 上下：字比預覽區高
    expect(placeStory({ card, area: { width: 800, height: 200 }, gap: 28, right: r, left: null })).toBeNull();
    expect(STORY_EDGE_PX).toBe(10);
  });
});

// ---------------------------------------------------------------- 預覽區兩側的直排（DOM）

describe('預覽區的故事層', () => {
  beforeEach(() => {
    installFakeDom();
    Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** 預覽區 800×600（假 DOM 的 getBoundingClientRect）；卡片在中間 200×280。 */
  const box: StoryBox = { left: 300, right: 500, top: 160, bottom: 440 };

  function setup(card: Card, loaded?: UiState['loadedFonts']) {
    const view = createStoryView();
    const root = view.el as unknown as FakeElement;
    const right = byClass(root, 'story-line', 'is-right');
    const left = byClass(root, 'story-line', 'is-left');
    // 量字的大小（假 DOM 沒有排版）
    Object.assign(right, { offsetWidth: 21, offsetHeight: 130 });
    Object.assign(left, { offsetWidth: 21, offsetHeight: 150 });
    view.render(stateOf(card, loaded));
    return { view, root, right, left };
  }

  it('兩行：右邊第 1 行、左邊第 2 行，文字用 textContent、直排的字級與最大高度照卡片', () => {
    const { view, right, left } = setup(cardOf(STORY));
    view.place(box);
    expect(right.textContent).toBe('一輪明月照星海');
    expect(left.textContent).toBe('龍鱗映出遠古的光');
    expect(right.hidden).toBe(false);
    expect(left.hidden).toBe(false);
    const px = storyFontPx(280, 8);
    expect(right.style.getPropertyValue('font-size')).toBe(`${px}px`);
    expect(right.style.getPropertyValue('max-height')).toBe('280px');
    const p = placeStory({ card: box, area: { width: 800, height: 600 }, gap: STORY_GAP_EM * px, right: { width: 21, height: 130 }, left: { width: 21, height: 150 } })!;
    expect(right.style.getPropertyValue('transform')).toBe(`translate(${Math.round(p.right.x)}px, ${Math.round(p.right.y)}px)`);
    expect(left.style.getPropertyValue('transform')).toBe(`translate(${Math.round(p.left!.x)}px, ${Math.round(p.left!.y)}px)`);
    // 右邊那一行在卡片右邊外面、左邊那一行在卡片左邊外面
    expect(p.right.x).toBeGreaterThan(box.right);
    expect(p.left!.x + 21).toBeLessThan(box.left);
  });

  it('字型用那一套（同源字型，已經載入）', () => {
    const { view, right } = setup(cardOf({ ...STORY, font: 'huninn' }));
    view.place(box);
    expect(right.style.getPropertyValue('font-family')).toContain('HoloTextHuninn');
  });

  it('看起來像 HTML 的字照原樣顯示（textContent，不會變成元素）', () => {
    const { view, right } = setup(cardOf({ text: '<b>龍</b><img src=x onerror=alert(1)>', font: 'wenkai' }));
    view.place(box);
    expect(right.textContent).toBe('<b>龍</b><img src=x onerror=alert(1)>');
    expect(right.children).toHaveLength(0);
  });

  it('一行：只有右邊', () => {
    const { view, right, left } = setup(cardOf({ text: '一輪明月', font: 'wenkai' }));
    view.place(box);
    expect(right.hidden).toBe(false);
    expect(left.hidden).toBe(true);
  });

  it('不顯示：舞台「沒有」、沒有故事、還不知道卡片在哪（3D 還沒好）、字型還沒載入好', () => {
    for (const [card, rect, loaded] of [
      [cardOf(STORY, 'none'), box, undefined],
      [cardOf(undefined), box, undefined],
      [cardOf(STORY), null, undefined],
      [cardOf(STORY), box, ['huninn']],
    ] as const) {
      const { view, right, left } = setup(card, loaded as UiState['loadedFonts']);
      view.place(rect);
      expect(right.hidden && left.hidden).toBe(true);
    }
  });

  it('舞台改成「沒有」：馬上消失（不用等下一格）；改回來又出現', () => {
    const { view, right } = setup(cardOf(STORY));
    view.place(box);
    expect(right.hidden).toBe(false);
    view.render(stateOf(cardOf(STORY, 'none')));
    expect(right.hidden).toBe(true);
    view.render(stateOf(cardOf(STORY, 'gallery')));
    expect(right.hidden).toBe(false);
  });

  it('放不下（預覽區太窄，左邊沒地方）→ 兩行都不顯示', () => {
    const { view, right, left } = setup(cardOf(STORY));
    view.place({ left: 20, right: 760, top: 160, bottom: 440 });
    expect(right.hidden && left.hidden).toBe(true);
  });

  it('卡片轉動時字不動：同一個外框 → 位置一樣；縮放、改比例（外框變）→ 重排', () => {
    const { view, right } = setup(cardOf(STORY));
    view.place(box);
    const before = right.style.getPropertyValue('transform');
    view.place({ ...box });
    expect(right.style.getPropertyValue('transform')).toBe(before);
    view.place({ left: 330, right: 470, top: 200, bottom: 400 });
    expect(right.style.getPropertyValue('transform')).not.toBe(before);
    expect(right.style.getPropertyValue('font-size')).toBe(`${storyFontPx(200, 8)}px`);
  });

  it('在預覽區裡：3D 預覽上面、選取框下面，不接滑鼠（CSS pointer-events: none）', () => {
    const { intents } = recorder();
    const stage = createStage(intents);
    const view = byClass(stage.el, 'stage-view');
    const kids = view.children.map((c) => c.className.split(' ')[0]);
    expect(kids.indexOf('story-layer')).toBeGreaterThan(kids.indexOf('preview-host'));
    expect(kids.indexOf('story-layer')).toBeLessThan(kids.indexOf('overlay-host'));
    expect(typeof stage.placeStory).toBe('function');
  });
});

// ---------------------------------------------------------------- CSS

describe('樣式', () => {
  const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`找不到 ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };

  it('直排（vertical-rl）、淡白色帶外光、不接滑鼠', () => {
    expect(rule('.story-line')).toMatch(/writing-mode:\s*vertical-rl/);
    expect(rule('.story-line')).toMatch(/text-shadow:/);
    expect(rule('.story-layer')).toMatch(/pointer-events:\s*none/);
  });

  it('匯出錄影中（.app.is-exporting）不顯示', () => {
    expect(rule('.app.is-exporting .story-layer')).toMatch(/display:\s*none/);
  });

  it('沒有淡入動畫（減少動態）：故事的規則裡沒有 transition／animation', () => {
    const story = css.slice(css.indexOf('T-804'));
    for (const m of story.matchAll(/\.story[^{]*\{[^}]*\}/g)) expect(m[0]).not.toMatch(/transition|animation/);
  });
});

// ---------------------------------------------------------------- 右欄的輸入

describe('右欄「卡片故事」', () => {
  beforeEach(() => {
    installFakeDom();
    Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(card = cardOf()) {
    const { intents, calls } = recorder();
    const inspector = createInspector(intents);
    inspector.render(stateOf(card));
    const root = inspector.el as unknown as FakeElement;
    const panel = byClass(root, 'story-panel');
    // T-813 先藏起來（STORY_ENABLED false 時小節 hidden）：這一段測小節本身，照開關打開時的樣子看
    panel.hidden = false;
    const area = byClass(panel, 'story-input');
    const count = byClass(panel, 'story-count');
    const fontButtons = byClass(panel, 'font-grid').querySelectorAll('button');
    const edits = () => calls.filter((c) => c.name === 'editCard').map((c) => c.args);
    return { inspector, root, panel, area, count, fontButtons, calls, edits };
  }

  it('在「卡片」區塊：陰影之後、舞台之前；標題「卡片故事」＋說明句照 DESIGN', () => {
    const { root, panel } = setup();
    const body = panel.parentNode!;
    const titles = body.children.map((c) => c.querySelector('.group-title')?.textContent ?? '');
    const at = body.children.indexOf(panel);
    expect(titles[at]).toBe('卡片故事');
    expect(titles[at - 1]).toBe('陰影');
    expect(titles[at + 1]).toBe('舞台');
    expect(panel.textContent).toContain(STORY_HELP);
    expect(STORY_HELP).toBe('寫一兩句詩或設定，會直排顯示在卡片兩邊。');
    expect(root.contains(panel)).toBe(true);
  });

  it('多行文字框：2 列高；沒有原生 maxlength（它算的是 UTF-16，表情符號會只打得下一半；T-804b）；是打字的地方（Ctrl+Z 交給瀏覽器）', () => {
    const { area } = setup();
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.getAttribute('maxlength')).toBeNull();
    expect(area.getAttribute('rows')).toBe('2');
    expect(area.getAttribute('aria-label')).toBe('卡片故事');
    expect(isTextEntry(area as never)).toBe(true);
    expect(shortcutFor({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, true)).toBeNull();
  });

  it('字數「12／60」跟著打字變', () => {
    const { area, count } = setup();
    expect(count.textContent).toBe('0／60');
    typeInto(area, '一輪明月照星海');
    expect(count.textContent).toBe('7／60');
  });

  it('打字停手 0.6 秒才送一次（commit＝記一步）；字型一起送', () => {
    const { area, edits } = setup();
    typeInto(area, '一輪');
    typeInto(area, '一輪明月');
    expect(edits()).toEqual([]);
    vi.advanceTimersByTime(TEXT_IDLE_MS - 1);
    expect(edits()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(edits()).toEqual([[{ story: { text: '一輪明月', font: 'wenkai' } }, 'commit']]);
  });

  it('離開文字框：還沒送的馬上送', () => {
    const { area, edits } = setup();
    area.focus();
    typeInto(area, '一輪明月');
    area.blur();
    expect(edits()).toEqual([[{ story: { text: '一輪明月', font: 'wenkai' } }, 'commit']]);
  });

  it('清空＝送空字串（model 拿掉欄位）', () => {
    const { area, edits } = setup(cardOf(STORY));
    expect(area.value).toBe(STORY.text);
    typeInto(area, '');
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits()).toEqual([[{ story: { text: '', font: 'wenkai' } }, 'commit']]);
  });

  it('Enter：1 行時可以換行；已經 2 行時不換行（擋下）；輸入法選字中按 Enter 不管', () => {
    const { area } = setup();
    typeInto(area, '一輪明月');
    expect(keydown(area, 'Enter').defaultPrevented).toBe(false);
    typeInto(area, '一輪明月\n龍鱗');
    expect(keydown(area, 'Enter').defaultPrevented).toBe(true);
    expect(keydown(area, 'Enter', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(keydown(area, 'Enter', { isComposing: true }).defaultPrevented).toBe(false);
    expect(keydown(area, 'a').defaultPrevented).toBe(false);
  });

  it('打 61 個表情符號：文字框剪到 60 個、字數「60／60」（T-804b）', () => {
    const { area, count } = setup();
    typeInto(area, '🌙'.repeat(61));
    expect(Array.from(area.value).length).toBe(60);
    expect(count.textContent).toBe('60／60');
  });

  it('貼上中間夾空白行的兩句：兩句都留著（T-804b）', () => {
    const { area, edits } = setup();
    typeInto(area, '一\n   \n二');
    expect(area.value).toBe('一\n   \n二');
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits()).toEqual([[{ story: { text: '一\n   \n二', font: 'wenkai' } }, 'commit']]);
  });

  it('打完字馬上開始輸入法選字：先把打好的送出；選字中畫面更新不覆蓋正在組的字（T-804b）', () => {
    const { inspector, area, edits } = setup();
    typeInto(area, '一輪');
    area.dispatchEvent(new FakeEvent('compositionstart'));
    expect(edits()).toEqual([[{ story: { text: '一輪', font: 'wenkai' } }, 'commit']]);
    area.value = '一輪ㄇ';
    area.dispatchEvent(new FakeEvent('input', { isComposing: true }));
    inspector.render(stateOf(cardOf({ text: '一輪', font: 'wenkai' })));
    expect(area.value).toBe('一輪ㄇ');
    vi.advanceTimersByTime(TEXT_IDLE_MS * 2);
    expect(edits()).toHaveLength(1);
    area.value = '一輪明';
    area.dispatchEvent(new FakeEvent('compositionend'));
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits()).toEqual([
      [{ story: { text: '一輪', font: 'wenkai' } }, 'commit'],
      [{ story: { text: '一輪明', font: 'wenkai' } }, 'commit'],
    ]);
  });

  it('打字後直接點字型（焦點從文字框移到字型按鈕）：打的字和字型合成一步（T-804b）', () => {
    const { fontButtons, area, edits } = setup(cardOf(STORY));
    area.focus();
    typeInto(area, '新的故事');
    fontButtons[2]!.focus();
    expect(edits()).toEqual([]);
    fontButtons[2]!.click();
    expect(edits()).toEqual([[{ story: { text: '新的故事', font: 'iansui' } }, 'commit']]);
  });

  it('貼上 3 行以上：文字框只留前 2 行', () => {
    const { area, edits } = setup();
    typeInto(area, '一\n二\n三');
    expect(area.value).toBe('一\n二');
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits()).toEqual([[{ story: { text: '一\n二', font: 'wenkai' } }, 'commit']]);
  });

  it('輸入法選字中：不整理、不送；選完（compositionend）才送', () => {
    const { area, edits } = setup();
    area.value = 'ㄧ\nㄌ\nㄕ';
    area.dispatchEvent(new FakeEvent('input', { isComposing: true }));
    expect(area.value).toBe('ㄧ\nㄌ\nㄕ');
    vi.advanceTimersByTime(TEXT_IDLE_MS * 3);
    expect(edits()).toEqual([]);
    area.value = '一輪明月';
    area.dispatchEvent(new FakeEvent('compositionend'));
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits()).toEqual([[{ story: { text: '一輪明月', font: 'wenkai' } }, 'commit']]);
  });

  it('送出後畫面更新：整理後一樣就不覆蓋文字框（剛按的 Enter 不會被吃掉）；復原之類讓內容不同才換', () => {
    const { inspector, area } = setup();
    typeInto(area, '一輪明月\n');
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    inspector.render(stateOf(cardOf({ text: cleanStory('一輪明月\n')!, font: 'wenkai' })));
    expect(area.value).toBe('一輪明月\n');
    inspector.render(stateOf(cardOf()));
    expect(area.value).toBe('');
  });

  it('還沒送出的打字不會被畫面更新蓋掉', () => {
    const { inspector, area } = setup(cardOf(STORY));
    typeInto(area, '新的');
    inspector.render(stateOf(cardOf(STORY)));
    expect(area.value).toBe('新的');
  });

  it('換了一張卡：還沒送的打字丟掉（不會寫到新卡），文字框換成新卡的故事', () => {
    const { inspector, area, edits } = setup(cardOf(STORY));
    typeInto(area, '舊卡打到一半');
    inspector.render(stateOf(cardOf({ text: '另一張', font: 'iansui' }, 'halo', 'c2')));
    vi.advanceTimersByTime(TEXT_IDLE_MS * 2);
    expect(edits()).toEqual([]);
    expect(area.value).toBe('另一張');
  });

  it('字型：沿用文字圖層的四套（同樣的按鈕）；有故事時一按就記一步；選中的亮起來', () => {
    const { inspector, fontButtons, edits } = setup(cardOf(STORY));
    expect(fontButtons.map((b) => b.querySelector('.font-name')!.textContent)).toEqual(['楷書', '圓體', '手寫', '宋體']);
    expect(fontButtons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    fontButtons[1]!.click();
    expect(edits()).toEqual([[{ story: { font: 'huninn' } }, 'commit']]);
    inspector.render(stateOf(cardOf({ ...STORY, font: 'huninn' })));
    expect(fontButtons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
  });

  it('還沒寫故事時先選字型：不記步，之後打字帶著這套字型', () => {
    const { fontButtons, area, edits } = setup();
    fontButtons[3]!.click();
    expect(edits()).toEqual([]);
    expect(fontButtons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true']);
    typeInto(area, '一輪明月');
    vi.advanceTimersByTime(TEXT_IDLE_MS);
    expect(edits()).toEqual([[{ story: { text: '一輪明月', font: 'notoserif' } }, 'commit']]);
  });

  it('打字中換字型：打的字和字型一起記成一步', () => {
    const { fontButtons, area, edits } = setup(cardOf(STORY));
    typeInto(area, '新的故事');
    fontButtons[2]!.click();
    expect(edits()).toEqual([[{ story: { text: '新的故事', font: 'iansui' } }, 'commit']]);
  });

  it('舞台是「關閉」而且有故事：說一句看不到的原因；其他時候不說', () => {
    const { inspector, panel } = setup(cardOf(STORY, 'none'));
    const note = byClass(panel, 'story-off-note');
    expect(isShown(note)).toBe(true);
    inspector.render(stateOf(cardOf(STORY, 'halo')));
    expect(isShown(note)).toBe(false);
    inspector.render(stateOf(cardOf(undefined, 'none')));
    expect(isShown(note)).toBe(false);
  });
});

describe('記一步（editor）', () => {
  it('寫故事＝一步，復原就回到沒有故事；清空＝一步', () => {
    let s: EditorState = createEditor(cardOf());
    s = editCard(s, { story: { text: '一輪明月', font: 'wenkai' } }, 'commit', T1);
    expect(currentCard(s).story).toEqual({ text: '一輪明月', font: 'wenkai' });
    expect(canUndo(s.history)).toBe(true);
    s = editCard(s, { story: { text: '', font: 'wenkai' } }, 'commit', T2);
    expect('story' in currentCard(s)).toBe(false);
    s = undoEdit(s);
    expect(currentCard(s).story).toEqual({ text: '一輪明月', font: 'wenkai' });
    s = undoEdit(s);
    expect('story' in currentCard(s)).toBe(false);
  });
});

// ---------------------------------------------------------------- 說明面板、擷取不畫、沒有 innerHTML

describe('其他', () => {
  it('說明面板「轉卡與縮放」：故事藏起來時不提（T-813）；打開時多一句卡片故事', () => {
    const lines = HELP_SECTIONS.find((s) => s.title === '轉卡與縮放')!.lines;
    const line = '右欄的「卡片故事」可以寫一兩句話，展示時會直排在卡片兩邊。';
    if (STORY_ENABLED) expect(lines).toContain(line);
    else expect(lines).not.toContain(line);
  });

  it('PNG、影片、GIF、縮圖都不畫：3D、檔案匯出、縮圖的程式都不碰 story（故事只是預覽區上面的一層 DOM）', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const files = [
      ...readdirSync(join(src, 'render')).map((f) => join(src, 'render', f)),
      ...readdirSync(join(src, 'file')).map((f) => join(src, 'file', f)),
      join(src, 'app', 'thumbnail.ts'),
      join(src, 'app', 'turntable-export.ts'),
      join(src, 'app', 'gallery-thumbs.ts'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bstory\b/i);
  });

  it('新增的畫面檔不用 innerHTML（硬邊界 4）', () => {
    for (const name of ['story.ts', 'story-panel.ts', 'font-picker.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`../src/ui/${name}`, import.meta.url)), 'utf8');
      expect(source, name).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });
});

// ---------------------------------------------------------------- T-813 先藏起來

describe('T-813 卡片故事先藏起來（使用者 2026-10-15：「卡片故事可以去掉，不好看」→ 先藏起來）', () => {
  beforeEach(() => {
    installFakeDom();
    Object.assign(document, { addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('開關是關的（之後要再開只改 STORY_ENABLED）', () => {
    expect(STORY_ENABLED).toBe(false);
  });

  it('預覽區不顯示：有故事、舞台不是「沒有」也不顯示（storyVisible）；資料照樣在（storyShown 照舊判斷）', () => {
    const card = cardOf(STORY, 'halo');
    expect(storyShown(card)).toBe(true);
    expect(storyVisible(card)).toBe(false);
    expect(card.story).toEqual(STORY);
  });

  it('右欄的「卡片故事」小節藏起來（hidden），有故事的卡也一樣', () => {
    const { intents } = recorder();
    const inspector = createInspector(intents);
    inspector.render(stateOf(cardOf(STORY)));
    const panel = byClass(inspector.el as unknown as FakeElement, 'story-panel');
    expect(isShown(panel)).toBe(false);
  });
});
