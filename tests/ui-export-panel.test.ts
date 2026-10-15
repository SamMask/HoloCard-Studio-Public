import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportPanel } from '../src/ui/export-panel';
import { createGifOptions, ESTIMATE_DELAY_MS } from '../src/ui/gif-options';
import { estimateGifBytes, fileSizeText, GIF_ESTIMATING_TEXT, TURNTABLE_DONE_TEXT } from '../src/ui/logic';
import { defaultMotion } from '../src/ui/motion-picker';
import type { GifExportOptions, GifSample, MotionChoice, MotionRequest, MusicInfo, TurntableOutcome, UiIntents, VideoExportOptions } from '../src/ui/types';
import { createVideoOptions } from '../src/ui/video-options';
import { all, buttonWithText, byClass, FakeEvent, flush, installFakeDom, isShown, typeInto, type FakeDom, type FakeElement } from './ui-fake-dom';

// T-512（T-509b 審查低⑤）：真的跑選項小框與匯出面板（假 DOM），驗證生命週期：
// 解碼中取消、過期的讀取結果、換長度重新夾起始秒、試聽監聽清理、失敗後解鎖、「好了！」期間 Esc、分頁接手；
// 以及 T-512 的動作（轉一圈／左右擺動＋角度）與 GIF 選項小框（大小＋預估）。

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let dom: FakeDom;
let urls: { created: string[]; revoked: string[] };

beforeEach(() => {
  dom = installFakeDom();
  urls = { created: [], revoked: [] };
  let next = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:fake/${next++}`;
    urls.created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    urls.revoked.push(url);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const music = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'audio/wav' });

/** 在選項小框裡選一個音樂檔（同按〔選音樂…〕選好檔）。 */
function pickMusic(box: unknown, file: File) {
  const input = byClass(box, 'vo-file');
  input.files = [file];
  input.dispatchEvent(new FakeEvent('change'));
}

/** 選項小框平常由匯出面板打開（取消 hidden）；單獨測時自己打開。 */
function shown<T extends { el: HTMLElement }>(box: T): T {
  box.el.hidden = false;
  return box;
}

// 試編兩種寬度（T-512b）
const SAMPLE: GifSample[] = [
  { bytes: 8 * 320 * 448 * 0.4, frames: 8, width: 320, height: 448 },
  { bytes: 8 * 480 * 672 * 0.35, frames: 8, width: 480, height: 672 },
];
const estimateText = (width: number, sample = SAMPLE) => fileSizeText(estimateGifBytes(sample, width)!);

// ---------------------------------------------------------------------------------------------

describe('影片選項小框：音樂的讀取與起始秒（審查低⑤）', () => {
  it('解碼中按取消：讀完的結果丟掉、不留下音樂與網址；再打開是乾淨的', async () => {
    const read = deferred<MusicInfo>();
    const box = shown(createVideoOptions({ readMusic: () => read.promise }));
    const asked = box.ask();
    pickMusic(box.el, music('long-song.mp3'));
    expect(byClass(box.el, 'vo-music-length').textContent).toBe('讀取中…');
    expect(byClass(box.el, 'vo-go').disabled).toBe(true);
    box.cancel();
    expect(await asked).toBeNull();
    read.resolve({ ok: true, durationSec: 30 });
    await flush();
    expect(urls.created).toEqual([]);

    const again = box.ask();
    expect(isShown(byClass(box.el, 'vo-music'))).toBe(false);
    expect(isShown(byClass(box.el, 'vo-pick'))).toBe(true);
    expect(byClass(box.el, 'vo-go').disabled).toBe(false);
    byClass(box.el, 'vo-go').click();
    expect(await again).toEqual({ format: 'mp4', laps: 1, music: null, motion: 'turn', swingDeg: 30, nodDeg: 10 });
  });

  it('過期的讀取結果：讀第一首時換成第二首，第一首晚到也不會蓋掉', async () => {
    const reads = new Map<string, ReturnType<typeof deferred<MusicInfo>>>();
    const box = shown(createVideoOptions({
      readMusic: (file) => {
        const d = deferred<MusicInfo>();
        reads.set(file.name, d);
        return d.promise;
      },
    }));
    const asked = box.ask();
    const a = music('a.mp3');
    const b = music('b.mp3');
    pickMusic(box.el, a);
    byClass(box.el, 'vo-remove').click();
    pickMusic(box.el, b);
    reads.get('b.mp3')!.resolve({ ok: true, durationSec: 40 });
    await flush();
    reads.get('a.mp3')!.resolve({ ok: true, durationSec: 10 });
    await flush();
    expect(byClass(box.el, 'vo-music-name').textContent).toBe('b.mp3');
    expect(byClass(box.el, 'vo-music-length').textContent).toBe('0:40');
    expect(urls.created).toHaveLength(1);
    byClass(box.el, 'vo-go').click();
    const result = await asked;
    expect(result?.music?.file).toBe(b);
    // 關掉時收回試聽用的網址
    expect(urls.revoked).toEqual(urls.created);
  });

  it('換長度時重新夾起始秒（數字框、滑桿一起更新）', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 20 }) }));
    const asked = box.ask();
    pickMusic(box.el, music('song.wav'));
    await flush();
    const num = byClass(byClass(box.el, 'vo-start'), 'vo-num');
    const range = byClass(box.el, 'vo-range-input');
    expect(num.max).toBe('16');
    typeInto(num, '16', true);
    expect(range.value).toBe('16');
    // 12 秒的影片：起點最多 8 秒
    buttonWithText(box.el, '12 秒').click();
    expect(num.value).toBe('8');
    expect(range.value).toBe('8');
    expect(range.max).toBe('8');
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.music?.startSec).toBe(8);
  });

  it('讀不出來：紅字、可以再選別首；開始匯出照樣可以按（沒有音樂）', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: false, text: '這個音樂檔讀不出來' }) }));
    const asked = box.ask();
    pickMusic(box.el, music('bad.mp3'));
    await flush();
    expect(byClass(box.el, 'vo-error').textContent).toBe('這個音樂檔讀不出來');
    expect(isShown(byClass(box.el, 'vo-pick'))).toBe(true);
    expect(byClass(box.el, 'vo-go').disabled).toBe(false);
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.music).toBeNull();
  });
});

describe('試聽：停止或換音樂時，等待中的監聽器要清掉（審查低④）', () => {
  async function withMusic() {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 30 }) }));
    const asked = box.ask();
    pickMusic(box.el, music('song.wav'));
    await flush();
    const audio = dom.audios[0]!;
    return { box, asked, audio, preview: byClass(box.el, 'vo-preview') };
  }

  it('還沒讀到長度就按停止：loadedmetadata／error 監聽器拿掉，之後讀到也不會播', async () => {
    const { audio, preview } = await withMusic();
    expect(audio.readyState).toBe(0);
    preview.click();
    expect(audio.listenerCount('loadedmetadata')).toBe(1);
    expect(audio.listenerCount('error')).toBe(1);
    preview.click(); // 停止
    await flush();
    expect(audio.listenerCount('loadedmetadata')).toBe(0);
    expect(audio.listenerCount('error')).toBe(0);
    audio.readyState = 1;
    audio.fire(new FakeEvent('loadedmetadata'));
    await flush();
    expect(audio.plays).toBe(0);
    expect(byClass(preview, 'icon')).toBeDefined();
    expect(preview.textContent).toContain('試聽');
  });

  it('等待中移除音樂、或關掉小框：監聽器也拿掉', async () => {
    const first = await withMusic();
    first.preview.click();
    byClass(first.box.el, 'vo-remove').click();
    await flush();
    expect(first.audio.listenerCount('loadedmetadata')).toBe(0);
    expect(first.audio.listenerCount('error')).toBe(0);

    pickMusic(first.box.el, music('again.wav'));
    await flush();
    first.preview.click();
    expect(first.audio.listenerCount('loadedmetadata')).toBe(1);
    first.box.cancel();
    await flush();
    expect(first.audio.listenerCount('loadedmetadata')).toBe(0);
    expect(await first.asked).toBeNull();
  });

  it('讀到長度：從起始秒開始播，播完影片那麼長就停', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { audio, preview } = await withMusic();
    preview.click();
    audio.readyState = 1;
    audio.fire(new FakeEvent('loadedmetadata'));
    await flush();
    expect(audio.plays).toBe(1);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(audio.paused).toBe(true);
  });
});

describe('動作：轉一圈／左右擺動（T-512）', () => {
  it('選左右擺動：出現擺動角度（5～60、預設 30），長度按鈕改寫「擺 n 次」', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    const asked = box.ask();
    const angleRow = byClass(box.el, 'mo-angle');
    expect(isShown(angleRow)).toBe(false);
    expect(all(box.el, 'vo-len-detail').map((d) => d.textContent)).toEqual(['轉 1 圈', '轉 2 圈', '轉 3 圈']);
    buttonWithText(box.el, '左右擺動').click();
    expect(isShown(angleRow)).toBe(true);
    expect(byClass(box.el, 'mo-angle-num').value).toBe('30');
    expect(byClass(box.el, 'mo-angle-range').value).toBe('30');
    expect(angleRow.textContent).toContain('左右各轉幾度');
    expect(all(box.el, 'vo-len-detail').map((d) => d.textContent)).toEqual(['擺 1 次', '擺 2 次', '擺 3 次']);
    typeInto(byClass(box.el, 'mo-angle-num'), '45', true);
    expect(byClass(box.el, 'mo-angle-range').value).toBe('45');
    buttonWithText(box.el, '8 秒').click();
    byClass(box.el, 'vo-go').click();
    expect(await asked).toEqual({ format: 'mp4', laps: 2, music: null, motion: 'swing', swingDeg: 45, nodDeg: 10 });
  });

  it('角度打超出範圍：夾回 5～60', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    const asked = box.ask();
    buttonWithText(box.el, '左右擺動').click();
    const num = byClass(box.el, 'mo-angle-num');
    typeInto(num, '75', true);
    expect(num.value).toBe('60');
    typeInto(num, '2', true);
    expect(num.value).toBe('5');
    typeInto(byClass(box.el, 'mo-angle-range'), '17');
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.swingDeg).toBe(17);
  });

  it('同一次開著工坊記住上次的動作、角度、長度', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    let asked = box.ask();
    buttonWithText(box.el, '左右擺動').click();
    typeInto(byClass(box.el, 'mo-angle-num'), '20', true);
    buttonWithText(box.el, '12 秒').click();
    byClass(box.el, 'vo-go').click();
    await asked;
    asked = box.ask();
    expect(isShown(byClass(box.el, 'mo-angle'))).toBe(true);
    expect(byClass(box.el, 'mo-angle-num').value).toBe('20');
    byClass(box.el, 'vo-go').click();
    expect(await asked).toEqual({ format: 'mp4', laps: 3, music: null, motion: 'swing', swingDeg: 20, nodDeg: 10 });
  });
});

// ---------------------------------------------------------------------------------------------

describe('GIF 選項小框：大小＋預估檔案大小（T-512）', () => {
  function gifBox(estimate: (choice: MotionRequest, signal: AbortSignal) => Promise<GifSample[] | null>, motion = defaultMotion()) {
    const calls: { choice: MotionRequest; signal: AbortSignal }[] = [];
    const box = shown(createGifOptions(
      {
        estimateGif: (choice, signal) => {
          calls.push({ choice: { ...choice }, signal });
          return estimate(choice, signal);
        },
      },
      motion,
    ));
    const texts = () => all(box.el, 'go-size-est').map((e) => e.textContent);
    return { box, calls, texts };
  }

  it('打開就用這張卡試編來估：先顯示「估算中…」，估好三種大小旁邊都有「約 X MB」', async () => {
    const d = deferred<GifSample[] | null>();
    const { box, calls, texts } = gifBox(() => d.promise);
    const asked = box.ask();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.choice).toEqual({ motion: 'turn', swingDeg: 30, nodDeg: 10 });
    expect(texts()).toEqual([GIF_ESTIMATING_TEXT, GIF_ESTIMATING_TEXT, GIF_ESTIMATING_TEXT]);
    d.resolve(SAMPLE);
    await flush();
    expect(texts()).toEqual([estimateText(320), estimateText(400), estimateText(480)]);
    for (const t of texts()) expect(t).toMatch(/^約 \d+\.\d MB$/);
    box.cancel();
    expect(await asked).toBeNull();
  });

  it('預設「中」；選「大」開始匯出 → 傳出動作與大小；下次打開還是「大」', async () => {
    const { box } = gifBox(async () => SAMPLE);
    let asked = box.ask();
    const selected = () => all(box.el, 'go-size').filter((b) => b.classList.contains('is-selected')).map((b) => b.textContent);
    expect(selected()[0]).toContain('中（寬 400）');
    buttonWithText(box.el, '大（寬 480）').click();
    byClass(box.el, 'go-go').click();
    expect(await asked).toEqual({ size: 'large', motion: 'turn', swingDeg: 30, nodDeg: 10 });
    asked = box.ask();
    expect(selected()[0]).toContain('大（寬 480）');
    box.cancel();
    await asked;
  });

  it('換動作：上一次估算送出取消、重新估；舊的結果晚到也不用', async () => {
    const pending: ReturnType<typeof deferred<GifSample[] | null>>[] = [];
    const { box, calls, texts } = gifBox(() => {
      const d = deferred<GifSample[] | null>();
      pending.push(d);
      return d.promise;
    });
    const asked = box.ask();
    buttonWithText(box.el, '左右擺動').click();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.choice).toEqual({ motion: 'swing', swingDeg: 30, nodDeg: 10 });
    expect(texts()[0]).toBe(GIF_ESTIMATING_TEXT);
    const swingSample = SAMPLE.map((s) => ({ ...s, height: (s.width * 5) / 4, bytes: s.bytes * 1.5 }));
    pending[1]!.resolve(swingSample);
    await flush();
    pending[0]!.resolve(SAMPLE);
    await flush();
    expect(texts()).toEqual([320, 400, 480].map((w) => estimateText(w, swingSample)));
    box.cancel();
    await asked;
  });

  it('改擺動角度：停手 0.4 秒才重新估（拖滑桿時不會一直估）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(ESTIMATE_DELAY_MS).toBe(400);
    const motion: MotionChoice = { motion: 'swing', swingDeg: 30, nodDeg: 10 };
    const { box, calls } = gifBox(async () => SAMPLE, motion);
    const asked = box.ask();
    expect(calls).toHaveLength(1);
    const range = byClass(box.el, 'mo-angle-range');
    typeInto(range, '35');
    await vi.advanceTimersByTimeAsync(200);
    typeInto(range, '40');
    await vi.advanceTimersByTimeAsync(200);
    typeInto(range, '45');
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.choice).toEqual({ motion: 'swing', swingDeg: 45, nodDeg: 10 });
    box.cancel();
    await asked;
  });

  it('估算失敗：不顯示數字，照樣能匯出', async () => {
    const { box, texts } = gifBox(async () => null);
    const asked = box.ask();
    await flush();
    expect(texts()).toEqual(['', '', '']);
    byClass(box.el, 'go-go').click();
    expect(await asked).toEqual({ size: 'medium', motion: 'turn', swingDeg: 30, nodDeg: 10 });

    const thrown = gifBox(() => Promise.reject(new Error('GPU lost')));
    const again = thrown.box.ask();
    await flush();
    expect(thrown.texts()).toEqual(['', '', '']);
    byClass(thrown.box.el, 'go-go').click();
    expect((await again)?.size).toBe('medium');
  });

  it('關掉（取消或開始匯出）：進行中的估算送出取消、等著的重估也不做', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { box, calls } = gifBox(() => new Promise<GifSample[] | null>(() => {}), { motion: 'swing', swingDeg: 30, nodDeg: 10 });
    const asked = box.ask();
    typeInto(byClass(box.el, 'mo-angle-range'), '50');
    byClass(box.el, 'go-go').click();
    expect(calls[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect((await asked)?.swingDeg).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------

type Intents = Pick<UiIntents, 'exportVideo' | 'exportGif' | 'estimateGif' | 'readMusic'>;

function panelSetup(overrides: Partial<Intents> = {}) {
  const jobs: { kind: 'webm' | 'gif'; options: VideoExportOptions | GifExportOptions; signal: AbortSignal; done: ReturnType<typeof deferred<TurntableOutcome>> }[] = [];
  const job = (kind: 'webm' | 'gif') => (options: VideoExportOptions | GifExportOptions, _p: (f: number) => void, signal: AbortSignal) => {
    const done = deferred<TurntableOutcome>();
    jobs.push({ kind, options, signal, done });
    return done.promise;
  };
  const estimates: AbortSignal[] = [];
  const intents: Intents = {
    exportVideo: job('webm'),
    exportGif: job('gif'),
    estimateGif: (_choice, signal) => {
      estimates.push(signal);
      return Promise.resolve(SAMPLE);
    },
    readMusic: async () => ({ ok: true, durationSec: 30 }),
    ...overrides,
  };
  let changes = 0;
  const anchor = document.createElement('div') as unknown as HTMLElement;
  const panel = createExportPanel(intents, { changed: () => changes++, anchor: () => anchor });
  const el = panel.el as unknown as FakeElement;
  const progressBox = all(el, 'export-box').find((b) => !b.classList.contains('video-options') && !b.classList.contains('gif-options'))!;
  return { panel, el, jobs, estimates, progressBox, changes: () => changes };
}

describe('匯出面板：生命週期（審查低⑤）', () => {
  it('GIF：先出現選項小框（不馬上做），按開始匯出才做；匯出的是選的大小與動作', async () => {
    const t = panelSetup();
    const run = t.panel.run('gif');
    expect(t.panel.isOpen()).toBe(true);
    expect(isShown(byClass(t.el, 'gif-options'))).toBe(true);
    expect(isShown(t.progressBox)).toBe(false);
    expect(t.jobs).toHaveLength(0);
    buttonWithText(t.el, '小（寬 320）').click();
    byClass(t.el, 'go-go').click();
    await flush();
    expect(t.jobs).toHaveLength(1);
    expect(t.jobs[0]!.kind).toBe('gif');
    expect(t.jobs[0]!.options).toEqual({ size: 'small', motion: 'turn', swingDeg: 30, nodDeg: 10 });
    expect(isShown(t.progressBox)).toBe(true);
    expect(isShown(byClass(t.el, 'gif-options'))).toBe(false);
    t.jobs[0]!.done.resolve('cancelled');
    await run;
    expect(t.panel.isOpen()).toBe(false);
  });

  it('「好了！」期間按 Esc（cancel）：直接關，不用等', async () => {
    const t = panelSetup();
    const run = t.panel.run('gif');
    byClass(t.el, 'go-go').click();
    await flush();
    t.jobs[0]!.done.resolve('done');
    await flush();
    expect(byClass(t.el, 'export-title').textContent).toBe(TURNTABLE_DONE_TEXT);
    expect(t.panel.isOpen()).toBe(true);
    t.panel.cancel();
    await flush();
    expect(t.panel.isOpen()).toBe(false);
    await run;
  });

  it('失敗後解鎖：小框關掉、可以再開始一次', async () => {
    const t = panelSetup();
    const first = t.panel.run('webm');
    byClass(t.el, 'vo-go').click();
    await flush();
    t.jobs[0]!.done.reject(new Error('encoder broke'));
    await first;
    expect(t.panel.isOpen()).toBe(false);
    expect(t.el.hidden).toBe(true);
    const second = t.panel.run('webm');
    expect(t.panel.isOpen()).toBe(true);
    byClass(t.el, 'vo-go').click();
    await flush();
    expect(t.jobs).toHaveLength(2);
    t.jobs[1]!.done.resolve('failed');
    await second;
    expect(t.panel.isOpen()).toBe(false);
  });

  it('匯出中按取消：送出取消、按鈕變「取消中…」，做完才關', async () => {
    const t = panelSetup();
    const run = t.panel.run('gif');
    byClass(t.el, 'go-go').click();
    await flush();
    t.panel.cancel();
    expect(t.jobs[0]!.signal.aborted).toBe(true);
    expect(byClass(t.el, 'export-cancel').textContent).toBe('取消中…');
    expect(t.panel.isOpen()).toBe(true);
    t.jobs[0]!.done.resolve('cancelled');
    await run;
    expect(t.panel.isOpen()).toBe(false);
  });

  it('影片與 GIF 共用動作：在影片選了擺動，打開 GIF 也是擺動（估算照擺動估）', async () => {
    const choices: MotionRequest[] = [];
    const t = panelSetup({
      estimateGif: async (choice) => {
        choices.push({ ...choice });
        return SAMPLE;
      },
    });
    const video = t.panel.run('webm');
    buttonWithText(byClass(t.el, 'video-options'), '左右擺動').click();
    typeInto(byClass(byClass(t.el, 'video-options'), 'mo-angle-num'), '24', true);
    byClass(t.el, 'vo-cancel').click();
    await video;
    const gif = t.panel.run('gif');
    expect(choices).toEqual([{ motion: 'swing', swingDeg: 24, nodDeg: 10 }]);
    expect(byClass(byClass(t.el, 'gif-options'), 'mo-angle-num').value).toBe('24');
    t.panel.cancel();
    await gif;
  });
});

describe('分頁接手（審查中①）', () => {
  it('選項小框開著（正在試聽）：關掉、試聽停掉、不匯出；接手遮罩開著時面板不能拿焦點', async () => {
    const t = panelSetup();
    const run = t.panel.run('webm');
    const options = byClass(t.el, 'video-options');
    pickMusic(options, music('song.wav'));
    await flush();
    const audio = dom.audios[0]!;
    audio.readyState = 1;
    byClass(options, 'vo-preview').click();
    await flush();
    expect(audio.paused).toBe(false);

    t.panel.block(true);
    await run;
    expect(audio.paused).toBe(true);
    expect(t.jobs).toHaveLength(0);
    expect(t.panel.isOpen()).toBe(false);
    expect(urls.revoked).toEqual(urls.created);
    expect(t.el.inert).toBe(true);
    // 被接手時從選單再按也不會打開
    await t.panel.run('gif');
    expect(t.panel.isOpen()).toBe(false);
    t.panel.block(false);
    expect(t.el.inert).toBe(false);
  });

  it('GIF 選項開著：關掉、估算送出取消', async () => {
    const signals: AbortSignal[] = [];
    const t = panelSetup({
      estimateGif: (_c, signal) => {
        signals.push(signal);
        return new Promise<GifSample[] | null>(() => {});
      },
    });
    const run = t.panel.run('gif');
    t.panel.block(true);
    await run;
    expect(signals[0]!.aborted).toBe(true);
    expect(t.jobs).toHaveLength(0);
    expect(t.panel.isOpen()).toBe(false);
  });

  it('匯出中：送出取消（不下載）；面板不能拿焦點，做完就關', async () => {
    const t = panelSetup();
    const run = t.panel.run('gif');
    byClass(t.el, 'go-go').click();
    await flush();
    const cancelBtn = byClass(t.el, 'export-cancel');
    t.panel.block(true);
    expect(t.jobs[0]!.signal.aborted).toBe(true);
    // （瀏覽器在整層變 inert 時會自己把焦點拿掉；假 DOM 不會，先清掉再試）
    dom.document.activeElement = null;
    cancelBtn.focus();
    expect(dom.document.activeElement).not.toBe(cancelBtn);
    t.jobs[0]!.done.resolve('cancelled');
    await run;
    expect(t.panel.isOpen()).toBe(false);
  });

  it('「好了！」期間被接手：直接關', async () => {
    const t = panelSetup();
    const run = t.panel.run('webm');
    byClass(t.el, 'vo-go').click();
    await flush();
    t.jobs[0]!.done.resolve('done');
    await flush();
    expect(t.panel.isOpen()).toBe(true);
    t.panel.block(true);
    // 不用等「好了！」的 1.1 秒
    await flush();
    expect(t.panel.isOpen()).toBe(false);
    await run;
  });
});

// ---------------------------------------------------------------------------------------------

// T-812：動作下面一列「上下」（0～25 度、預設 10；轉一圈與左右擺動都有；影片與 GIF 共用、同一次開著工坊記住；改了 GIF 停手 0.4 秒重估）
describe('上下角度（T-812）', () => {
  const nodUi = (box: { el: unknown }) => ({
    row: byClass(box.el, 'mo-nod'),
    range: byClass(box.el, 'mo-nod-range'),
    num: byClass(box.el, 'mo-nod-num'),
  });

  it('影片小框：動作下面多一列「上下」，轉一圈、左右擺動都顯示；預設 10，小字說明', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    const asked = box.ask();
    const { row, range, num } = nodUi(box);
    expect(isShown(row)).toBe(true);
    expect(num.value).toBe('10');
    expect(range.value).toBe('10');
    expect(range.getAttribute('min')).toBe('0');
    expect(range.getAttribute('max')).toBe('25');
    expect(row.textContent).toContain('上下');
    expect(row.textContent).toContain('轉的時候卡片上下點頭幾度（0＝只有左右）');
    buttonWithText(box.el, '左右擺動').click();
    expect(isShown(row)).toBe(true);
    // 「上下」在「動作」那一列後面（DOM 順序）
    const picker = row.parentNode as unknown as { children: unknown[] };
    expect(picker.children.indexOf(byClass(box.el, 'mo-row'))).toBeLessThan(picker.children.indexOf(row));
    box.cancel();
    await asked;
  });

  it('數字與滑桿一起動；超出範圍夾回 0～25；開始匯出帶出 nodDeg（轉一圈、擺動都帶）', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    let asked = box.ask();
    const { range, num } = nodUi(box);
    typeInto(num, '18', true);
    expect(range.value).toBe('18');
    typeInto(num, '40', true);
    expect(num.value).toBe('25');
    expect(range.value).toBe('25');
    typeInto(num, '-4', true);
    expect(num.value).toBe('0');
    typeInto(range, '7');
    expect(num.value).toBe('7');
    byClass(box.el, 'vo-go').click();
    expect(await asked).toMatchObject({ motion: 'turn', nodDeg: 7 });
    asked = box.ask();
    buttonWithText(box.el, '左右擺動').click();
    byClass(box.el, 'vo-go').click();
    expect(await asked).toMatchObject({ motion: 'swing', swingDeg: 30, nodDeg: 7 });
  });

  it('0 度也是合法的選擇（只有左右）：帶出 nodDeg 0，不會被當成沒填而變回預設', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    const asked = box.ask();
    typeInto(nodUi(box).num, '0', true);
    expect(nodUi(box).num.value).toBe('0');
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.nodDeg).toBe(0);
  });

  it('數字框打字中（清空、打到一半）不蓋掉；離開才改成夾過的值', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    const asked = box.ask();
    const { num } = nodUi(box);
    typeInto(num, '');
    expect(num.value).toBe('');
    typeInto(num, '2');
    typeInto(num, '29');
    expect(num.value).toBe('29');
    num.dispatchEvent(new FakeEvent('change'));
    expect(num.value).toBe('25');
    box.cancel();
    await asked;
  });

  it('同一次開著工坊記住上次的上下角度（再打開還在）', async () => {
    const box = shown(createVideoOptions({ readMusic: async () => ({ ok: true, durationSec: 1 }) }));
    let asked = box.ask();
    typeInto(nodUi(box).num, '21', true);
    byClass(box.el, 'vo-go').click();
    await asked;
    asked = box.ask();
    expect(nodUi(box).num.value).toBe('21');
    expect(nodUi(box).range.value).toBe('21');
    byClass(box.el, 'vo-go').click();
    expect((await asked)?.nodDeg).toBe(21);
  });

  it('GIF 小框：估算帶 nodDeg；改上下角度先顯示「估算中…」、停手 0.4 秒才重估（拖滑桿時不會一直估）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls: MotionRequest[] = [];
    const box = shown(createGifOptions({ estimateGif: async (choice) => (calls.push({ ...choice }), SAMPLE) }, defaultMotion()));
    const asked = box.ask();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ motion: 'turn', swingDeg: 30, nodDeg: 10 });
    await vi.advanceTimersByTimeAsync(1);
    const { range } = nodUi(box);
    typeInto(range, '15');
    expect(all(box.el, 'go-size-est').map((e) => e.textContent)).toEqual([GIF_ESTIMATING_TEXT, GIF_ESTIMATING_TEXT, GIF_ESTIMATING_TEXT]);
    await vi.advanceTimersByTimeAsync(200);
    typeInto(range, '20');
    await vi.advanceTimersByTimeAsync(200);
    typeInto(range, '24');
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ motion: 'turn', swingDeg: 30, nodDeg: 24 });
    // 數字沒變（夾到同一個值）不重估
    typeInto(nodUi(box).num, '24', true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    byClass(box.el, 'go-go').click();
    expect(await asked).toEqual({ size: 'medium', motion: 'turn', swingDeg: 30, nodDeg: 24 });
  });

  it('GIF 小框關掉（開始匯出）：等著的重估不做', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls: MotionRequest[] = [];
    const box = shown(createGifOptions({ estimateGif: (choice) => (calls.push({ ...choice }), new Promise<GifSample[] | null>(() => {})) }, defaultMotion()));
    const asked = box.ask();
    typeInto(nodUi(box).range, '3');
    byClass(box.el, 'go-go').click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect((await asked)?.nodDeg).toBe(3);
  });

  it('匯出面板：影片和 GIF 共用同一個上下角度（在影片改了，GIF 打開就是它，估算與匯出都帶它）', async () => {
    const estimates: MotionRequest[] = [];
    const t = panelSetup({
      estimateGif: async (choice) => {
        estimates.push({ ...choice });
        return SAMPLE;
      },
    });
    const video = t.panel.run('webm');
    typeInto(byClass(byClass(t.el, 'video-options'), 'mo-nod-num'), '6', true);
    byClass(t.el, 'vo-cancel').click();
    await video;
    const gif = t.panel.run('gif');
    expect(estimates).toEqual([{ motion: 'turn', swingDeg: 30, nodDeg: 6 }]);
    expect(byClass(byClass(t.el, 'gif-options'), 'mo-nod-num').value).toBe('6');
    byClass(t.el, 'go-go').click();
    await flush();
    expect(t.jobs[0]!.options).toMatchObject({ size: 'medium', nodDeg: 6 });
    t.jobs[0]!.done.resolve('cancelled');
    await gif;
  });
});
