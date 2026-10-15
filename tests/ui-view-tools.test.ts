// T-835（DESIGN §5.2「預覽區下方工具列」）：〔展示〕旁邊的〔−〕{縮放比例}〔＋〕與〔全螢幕〕。假 DOM 真的跑：
// - 縮放：顯示「預設大小＝100%」的整數百分比；按一下 10%（直接到位，沒有動畫，減少動態也一樣）；到上下限那顆變淡、按了不動；
//   滾輪、鍵盤改了（main 每格 setZoom）數字跟著變。
// - 全螢幕：只把預覽區（fullscreenTarget）鋪滿；再按一次或 Esc（瀏覽器自己退出）離開，按鈕的字跟著換；
//   瀏覽器根本不支援才變淡；被拒絕（T-838b）按鈕保持可按、下次再試、不丟錯。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../src/i18n';
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, zoomByKey, zoomByWheel, zoomPercent } from '../src/interact/view';
import { createViewTools, type FullscreenApi } from '../src/ui/view-tools';
import { byClass, flush, installFakeDom, type FakeDom, type FakeElement } from './ui-fake-dom';

let dom: FakeDom;

beforeEach(() => {
  dom = installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 假的 Fullscreen API：request 成功就把那個元素當全螢幕、通知 fullscreenchange；reject＝瀏覽器拒絕（rejectTimes＝只拒絕前幾次）。 */
function fakeFullscreen(options: { enabled?: boolean; reject?: boolean; rejectTimes?: number; throwSync?: boolean } = {}) {
  let active: unknown = null;
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((fn) => fn());
  const requests: unknown[] = [];
  let rejectsLeft = options.rejectTimes ?? 0;
  const api: FullscreenApi = {
    enabled: () => options.enabled ?? true,
    active: () => active as Element | null,
    request(el) {
      requests.push(el);
      if (options.throwSync) throw new TypeError('requestFullscreen is not a function');
      if (options.reject || rejectsLeft-- > 0) return Promise.reject(new TypeError('Permissions check failed'));
      active = el;
      notify();
      return Promise.resolve();
    },
    exit() {
      active = null;
      notify();
      return Promise.resolve();
    },
    onChange: (fn) => void listeners.push(fn),
  };
  return {
    api,
    requests,
    /** 使用者按 Esc：瀏覽器自己退出全螢幕（頁面收不到 Esc，只收到 fullscreenchange）。 */
    browserExit() {
      active = null;
      notify();
    },
  };
}

function make(fs = fakeFullscreen()) {
  const target = dom.document.createElement('section');
  const zoomTo = vi.fn<(zoom: number) => void>();
  const tools = createViewTools({ zoomTo, fullscreenTarget: () => target as unknown as HTMLElement }, fs.api);
  const el = tools.el as unknown as FakeElement;
  return {
    tools,
    el,
    target,
    zoomTo,
    fs,
    zoomIn: byClass(el, 'zoom-in'),
    zoomOut: byClass(el, 'zoom-out'),
    value: byClass(el, 'zoom-value'),
    fullscreen: byClass(el, 'fullscreen-btn'),
  };
}

const faded = (b: FakeElement) => b.getAttribute('aria-disabled') === 'true';

describe('縮放比例的顯示（T-835）', () => {
  it('一開始是預設大小 100%', () => {
    const { value } = make();
    expect(value.textContent).toBe('100%');
  });

  it('滾輪改了（main 每格 setZoom）數字跟著變；鍵盤 + − 也一樣', () => {
    const { tools, value } = make();
    const wheel = zoomByWheel(ZOOM_DEFAULT, -120);
    tools.setZoom(wheel);
    expect(value.textContent).toBe(`${zoomPercent(wheel)}%`);
    const key = zoomByKey(ZOOM_DEFAULT, -1);
    tools.setZoom(key);
    expect(value.textContent).toBe(`${zoomPercent(key)}%`);
  });

  it('〔−〕〔＋〕是圖示按鈕：滑過說明與朗讀名稱是「縮小」「放大」；數字所在的一組有名字', () => {
    const { zoomIn, zoomOut, el } = make();
    expect(zoomOut.tagName).toBe('BUTTON');
    expect(zoomOut.getAttribute('type')).toBe('button');
    expect(zoomOut.title).toBe(S.preview.zoomOut);
    expect(zoomOut.getAttribute('aria-label')).toBe(S.preview.zoomOut);
    expect(zoomIn.title).toBe(S.preview.zoomIn);
    expect(zoomIn.getAttribute('aria-label')).toBe(S.preview.zoomIn);
    expect(zoomOut.querySelector('svg.icon')).not.toBeNull();
    expect(zoomIn.querySelector('svg.icon')).not.toBeNull();
    expect(byClass(el, 'zoom-group').getAttribute('aria-label')).toBe(S.preview.zoomLabel);
  });
});

describe('按〔＋〕〔−〕（T-835）', () => {
  it('按一下 10%：直接到位（一次呼叫、最後的值），數字馬上變', () => {
    const { zoomIn, zoomOut, zoomTo, value } = make();
    zoomIn.click();
    expect(zoomTo).toHaveBeenCalledTimes(1);
    expect(zoomPercent(zoomTo.mock.calls[0]![0])).toBe(110);
    expect(value.textContent).toBe('110%');
    zoomOut.click();
    zoomOut.click();
    expect(zoomTo).toHaveBeenCalledTimes(3);
    expect(zoomPercent(zoomTo.mock.calls[2]![0])).toBe(90);
    expect(value.textContent).toBe('90%');
  });

  it('作業系統設了減少動態：照樣一次到位（縮放本來就沒有動畫，同滾輪）', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { zoomIn, zoomTo } = make();
    zoomIn.click();
    expect(zoomTo).toHaveBeenCalledTimes(1);
    expect(zoomPercent(zoomTo.mock.calls[0]![0])).toBe(110);
  });

  it('到最近：〔＋〕變淡、按了不動；〔−〕照常', () => {
    const { tools, zoomIn, zoomOut, zoomTo } = make();
    tools.setZoom(ZOOM_MAX);
    expect(faded(zoomIn)).toBe(true);
    expect(faded(zoomOut)).toBe(false);
    zoomIn.click();
    expect(zoomTo).not.toHaveBeenCalled();
    zoomOut.click();
    expect(zoomTo).toHaveBeenCalledTimes(1);
  });

  it('到最遠：〔−〕變淡、按了不動；離開上下限就恢復', () => {
    const { tools, zoomIn, zoomOut, zoomTo } = make();
    tools.setZoom(ZOOM_MIN);
    expect(faded(zoomOut)).toBe(true);
    expect(faded(zoomIn)).toBe(false);
    zoomOut.click();
    expect(zoomTo).not.toHaveBeenCalled();
    tools.setZoom(ZOOM_DEFAULT);
    expect(faded(zoomOut)).toBe(false);
    expect(faded(zoomIn)).toBe(false);
  });

  it('連按〔＋〕到底：按鈕變淡時焦點還留在它上面（不用 disabled，不會把焦點丟掉）', () => {
    const { zoomIn } = make();
    zoomIn.focus();
    for (let i = 0; i < 5; i++) zoomIn.click();
    expect(faded(zoomIn)).toBe(true);
    expect(zoomIn.disabled).toBe(false);
    expect(dom.document.activeElement).toBe(zoomIn);
  });
});

describe('全螢幕（T-835）', () => {
  it('按了：只把預覽區（fullscreenTarget）鋪滿；字換成「離開全螢幕」', async () => {
    const { fullscreen, fs, target } = make();
    expect(fullscreen.title).toBe(S.preview.fullscreen);
    expect(fullscreen.getAttribute('aria-label')).toBe(S.preview.fullscreen);
    fullscreen.click();
    await flush();
    expect(fs.requests).toEqual([target]);
    expect(fullscreen.title).toBe(S.preview.exitFullscreen);
    expect(fullscreen.getAttribute('aria-label')).toBe(S.preview.exitFullscreen);
  });

  it('再按一次離開；Esc（瀏覽器自己退出）也會把字換回來', async () => {
    const { fullscreen, fs } = make();
    fullscreen.click();
    await flush();
    fullscreen.click();
    await flush();
    expect(fs.api.active()).toBeNull();
    expect(fullscreen.title).toBe(S.preview.fullscreen);
    fullscreen.click();
    await flush();
    expect(fullscreen.title).toBe(S.preview.exitFullscreen);
    fs.browserExit();
    expect(fullscreen.title).toBe(S.preview.fullscreen);
  });

  it('全螢幕時縮放照樣能用', async () => {
    const { fullscreen, zoomIn, zoomTo } = make();
    fullscreen.click();
    await flush();
    zoomIn.click();
    expect(zoomTo).toHaveBeenCalledTimes(1);
  });

  it('exitFullscreen()（被另一個分頁接手時）：在全螢幕就離開，不在就不做事', async () => {
    const { tools, fullscreen, fs } = make();
    tools.exitFullscreen();
    expect(fs.api.active()).toBeNull();
    fullscreen.click();
    await flush();
    tools.exitFullscreen();
    await flush();
    expect(fs.api.active()).toBeNull();
    expect(fullscreen.title).toBe(S.preview.fullscreen);
  });

  it('瀏覽器不支援：按鈕一開始就變淡，按了不丟錯也不呼叫', async () => {
    const { fullscreen, fs } = make(fakeFullscreen({ enabled: false }));
    expect(faded(fullscreen)).toBe(true);
    expect(() => fullscreen.click()).not.toThrow();
    await flush();
    expect(fs.requests).toEqual([]);
  });

  it('被拒絕（Promise reject）：按鈕保持可按、不丟錯、console 記一筆；之後再按會再要求一次（T-838b）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fullscreen, fs } = make(fakeFullscreen({ reject: true }));
    expect(faded(fullscreen)).toBe(false);
    fullscreen.click();
    await flush();
    expect(faded(fullscreen)).toBe(false);
    expect(fullscreen.title).toBe(S.preview.fullscreen);
    expect(warn).toHaveBeenCalledTimes(1);
    fullscreen.click();
    await flush();
    expect(fs.requests).toHaveLength(2);
    expect(faded(fullscreen)).toBe(false);
  });

  it('第一次被拒、第二次瀏覽器答應：真的進全螢幕，字換成「離開全螢幕」（T-838b 實測情境）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fullscreen, fs, target } = make(fakeFullscreen({ rejectTimes: 1 }));
    fullscreen.click();
    await flush();
    expect(fs.api.active()).toBeNull();
    expect(fullscreen.title).toBe(S.preview.fullscreen);
    fullscreen.click();
    await flush();
    expect(fs.requests).toEqual([target, target]);
    expect(fs.api.active()).toBe(target);
    expect(fullscreen.title).toBe(S.preview.exitFullscreen);
    expect(faded(fullscreen)).toBe(false);
  });

  it('要求時當場丟錯：同樣不丟錯、不變淡、下次再試（支援與否看 enabled，不看這一次的結果）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fullscreen, fs } = make(fakeFullscreen({ throwSync: true }));
    expect(() => fullscreen.click()).not.toThrow();
    await flush();
    expect(faded(fullscreen)).toBe(false);
    expect(() => fullscreen.click()).not.toThrow();
    await flush();
    expect(fs.requests).toHaveLength(2);
    expect(faded(fullscreen)).toBe(false);
  });
});
