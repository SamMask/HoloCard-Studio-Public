// T-809 效能自動降級（DESIGN §8.4）：純狀態機 qualityStep（降級／恢復的時機、上下界、不算的影格、關掉回 0）、
// 等級對應的畫質設定 qualitySettings、以及把它們接起來的 createQualityGovernor（等級變了才通知 render、第一次降級提示一次）。
// 時間用「影格自己的毫秒數」累積，不依賴真的時鐘：測試直接餵 frameMs。
import { describe, expect, it, vi } from 'vitest';
import {
  createQualityGovernor,
  initialQuality,
  qualitySettings,
  qualityStep,
  QUALITY_TUNING,
  type QualityLevel,
  type QualityState,
} from '../src/interact/quality';

/** 連續餵 totalMs 毫秒、每格 frameMs 的影格；回最後的狀態。 */
function feed(state: QualityState, frameMs: number, totalMs: number, enabled = true): QualityState {
  let s = state;
  const frames = Math.round(totalMs / frameMs);
  for (let i = 0; i < frames; i++) s = qualityStep(s, frameMs, false, enabled);
  return s;
}

describe('降級：連續 3 秒平均每格超過 25 ms 降一級', () => {
  it('一開始是 0 級（完整畫質）', () => {
    expect(initialQuality().level).toBe(0);
  });

  it('每格 30 ms 跑滿 3 秒 → 1 級；沒滿 3 秒還是 0 級', () => {
    expect(feed(initialQuality(), 30, 2940).level).toBe(0);
    expect(feed(initialQuality(), 30, 3000).level).toBe(1);
  });

  it('每格剛好 25 ms 不算超過（不降）；26 ms 降', () => {
    expect(feed(initialQuality(), 25, 9000).level).toBe(0);
    expect(feed(initialQuality(), 26, 3016).level).toBe(1);
  });

  it('看的是平均不是單格：大部分很順、偶爾一兩格慢（平均 ≤ 25）不降', () => {
    let s = initialQuality();
    // 每 10 格有 1 格 120 ms、其他 12 ms → 平均約 22.8 ms
    for (let i = 0; i < 400; i++) s = qualityStep(s, i % 10 === 0 ? 120 : 12, false, true);
    expect(s.level).toBe(0);
  });

  it('降級後至少再等 3 秒才會再降（每格 40 ms：3 秒 1 級、6 秒 2 級、9 秒 3 級）', () => {
    let s = initialQuality();
    s = feed(s, 40, 3000);
    expect(s.level).toBe(1);
    s = feed(s, 40, 2960);
    expect(s.level).toBe(1);
    s = feed(s, 40, 40);
    expect(s.level).toBe(2);
    s = feed(s, 40, 3000);
    expect(s.level).toBe(3);
  });

  it('最多 3 級：一直很慢也不會超過', () => {
    expect(feed(initialQuality(), 100, 60000).level).toBe(3);
  });

  it('每個 3 秒視窗各自算：前一個視窗很慢但沒降成（平均剛好 25），後面的視窗不受影響', () => {
    let s = feed(initialQuality(), 25, 3000);
    expect(s.level).toBe(0);
    s = feed(s, 12, 3000);
    expect(s.level).toBe(0);
  });
});

describe('不算的影格：分頁隱藏、兩格間隔超過 250 ms、不是正常的數字', () => {
  it('document.hidden 時的影格不算（再慢也不降）', () => {
    let s = initialQuality();
    for (let i = 0; i < 1000; i++) s = qualityStep(s, 100, true, true);
    expect(s).toEqual(initialQuality());
  });

  it('間隔超過 250 ms 的影格不算（剛切回分頁、背景節流）；剛好 250 ms 算', () => {
    let s = initialQuality();
    for (let i = 0; i < 100; i++) s = qualityStep(s, 251, false, true);
    expect(s).toEqual(initialQuality());
    s = feed(s, 250, 3000);
    expect(s.level).toBe(1);
  });

  it('偶爾夾一格很長的間隔（切回分頁）不影響平均：只看有算的影格', () => {
    let s = initialQuality();
    for (let i = 0; i < 400; i++) {
      s = qualityStep(s, 12, false, true);
      if (i % 50 === 0) s = qualityStep(s, 4000, false, true);
    }
    expect(s.level).toBe(0);
    // 長間隔不會把視窗撐滿而湊成「3 秒」：12 ms × 400 = 4.8 秒的順暢影格、沒有被誤判
  });

  it('0、負數、NaN、Infinity（第一格沒有上一格可比）不算', () => {
    let s = initialQuality();
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) s = qualityStep(s, ms, false, true);
    expect(s).toEqual(initialQuality());
  });
});

describe('恢復：連續 10 秒平均每格低於 18 ms 升一級（反向）', () => {
  const at = (level: QualityLevel): QualityState => ({ ...initialQuality(), level });

  it('每格 16 ms 跑滿 10 秒 → 少一級；沒滿 10 秒不升', () => {
    expect(feed(at(2), 16, 9984).level).toBe(2);
    expect(feed(at(2), 16, 10000).level).toBe(1);
  });

  it('每格剛好 18 ms 不算低於（不升）', () => {
    expect(feed(at(2), 18, 30000).level).toBe(2);
  });

  it('升一級之後要再等 10 秒才升下一級；最低到 0 級', () => {
    let s = feed(at(3), 10, 10000);
    expect(s.level).toBe(2);
    s = feed(s, 10, 9990);
    expect(s.level).toBe(2);
    s = feed(s, 10, 10);
    expect(s.level).toBe(1);
    s = feed(s, 10, 10000);
    expect(s.level).toBe(0);
    s = feed(s, 10, 60000);
    expect(s.level).toBe(0);
  });

  it('介於 18～25 ms 之間（不夠順也不算慢）：維持原級，不升不降', () => {
    expect(feed(at(2), 21, 60000).level).toBe(2);
    expect(feed(at(0), 21, 60000).level).toBe(0);
  });

  it('剛降級時還很慢：恢復用的 10 秒視窗被清掉，不會因為降級前的舊影格馬上升回去', () => {
    let s = feed(at(1), 10, 6000);
    expect(s.level).toBe(1);
    s = feed(s, 40, 3000); // 慢了 3 秒 → 降到 2（這時恢復的視窗累積了 9 秒，降級要把它清掉）
    expect(s.level).toBe(2);
    s = feed(s, 10, 9990); // 要是沒清，1 秒後就會升回去
    expect(s.level).toBe(2);
    s = feed(s, 10, 10);
    expect(s.level).toBe(1);
  });
});

describe('關掉自動降級', () => {
  it('enabled 為 false：馬上回 0 級，之後再慢也不降', () => {
    let s = feed(initialQuality(), 40, 9000);
    expect(s.level).toBe(3);
    s = qualityStep(s, 40, false, false);
    expect(s.level).toBe(0);
    s = feed(s, 100, 60000, false);
    expect(s.level).toBe(0);
  });

  it('再打開：從頭量起（舊的慢影格不留）', () => {
    let s = feed(initialQuality(), 40, 2000);
    s = qualityStep(s, 40, false, false);
    s = feed(s, 40, 2000);
    expect(s.level).toBe(0);
  });
});

describe('等級對應的畫質（DESIGN §8.4）', () => {
  it('0 級完整（像素比不限、有景深陰影）；1 級像素比 1.25；2 級再關預覽的景深陰影；3 級像素比 1', () => {
    expect(qualitySettings(0)).toEqual({ pixelRatioCap: Number.POSITIVE_INFINITY, shadows: true });
    expect(qualitySettings(1)).toEqual({ pixelRatioCap: 1.25, shadows: true });
    expect(qualitySettings(2)).toEqual({ pixelRatioCap: 1.25, shadows: false });
    expect(qualitySettings(3)).toEqual({ pixelRatioCap: 1, shadows: false });
  });

  it('調校數字就是 DESIGN 寫的', () => {
    expect(QUALITY_TUNING).toEqual({ skipOverMs: 250, downWindowMs: 3000, downAboveMs: 25, upWindowMs: 10000, upBelowMs: 18 });
  });
});

describe('createQualityGovernor：接起來用', () => {
  function make(over: { enabled?: boolean; hidden?: () => boolean; notice?: () => boolean | void; pixelRatio?: () => number } = {}) {
    const applied: { level: QualityLevel; settings: ReturnType<typeof qualitySettings> }[] = [];
    const notice = vi.fn(over.notice ?? (() => {}));
    const gov = createQualityGovernor({
      enabled: over.enabled ?? true,
      hidden: over.hidden ?? (() => false),
      apply: (settings, level) => applied.push({ level, settings }),
      notice,
      ...(over.pixelRatio ? { pixelRatio: over.pixelRatio } : {}),
    });
    /** 餵 totalMs 毫秒、每格 frameMs（用秒給，和影格迴圈一樣）。 */
    const run = (frameMs: number, totalMs: number) => {
      for (let i = 0; i < Math.round(totalMs / frameMs); i++) gov.frame(frameMs / 1000);
    };
    return { gov, applied, notice, run };
  }

  it('螢幕像素比 1：像素比的那幾級沒有效果就跳過（0 → 直接 2 關陰影；升回來 2 → 1 → 0 畫面才有變），提示照常說一次（主對話 T-809 驗收時決定）', () => {
    const { gov, applied, notice, run } = make({ pixelRatio: () => 1 });
    run(30, 3000);
    expect(gov.level()).toBe(2);
    expect(applied.map((a) => a.level)).toEqual([2]);
    expect(notice).toHaveBeenCalledTimes(1);
    run(30, 3000);
    // 3 級（像素比 1）在像素比 1 的螢幕上和 2 級一樣：不降
    expect(gov.level()).toBe(2);
    run(10, 10000);
    expect(gov.level()).toBe(1);
  });

  it('像素比 1 已經在 2 級：想再降但沒效果時不清掉恢復的累積（快慢交替、整體夠快就升回來；T-809 審查）', () => {
    const { gov, run } = make({ pixelRatio: () => 1 });
    run(30, 3000);
    expect(gov.level()).toBe(2);
    for (let i = 0; i < 4 && gov.level() === 2; i++) {
      run(10, 6000);
      run(30, 3000);
    }
    expect(gov.level()).toBeLessThan(2);
  });

  it('螢幕像素比 2：每一級都有效果，照常一級一級降', () => {
    const { gov, applied, run } = make({ pixelRatio: () => 2 });
    run(30, 3000);
    run(30, 3000);
    run(30, 3000);
    expect(gov.level()).toBe(3);
    expect(applied.map((a) => a.level)).toEqual([1, 2, 3]);
  });

  it('等級變了才通知 render（附上設定），沒變不通知', () => {
    const { gov, applied, run } = make();
    run(10, 6000);
    expect(applied).toEqual([]);
    run(40, 3000);
    expect(gov.level()).toBe(1);
    expect(applied).toEqual([{ level: 1, settings: qualitySettings(1) }]);
    run(40, 3000);
    expect(applied.map((a) => a.level)).toEqual([1, 2]);
  });

  it('第一次降級提示一次；之後再降、恢復後又降都不再說', () => {
    const { gov, notice, run } = make();
    run(40, 3000);
    expect(notice).toHaveBeenCalledTimes(1);
    run(40, 6000);
    expect(gov.level()).toBe(3);
    expect(notice).toHaveBeenCalledTimes(1);
    run(10, 30000);
    expect(gov.level()).toBe(0);
    run(40, 3000);
    expect(gov.level()).toBe(1);
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('升回去（恢復）不提示', () => {
    const { gov, notice, run } = make();
    run(40, 3000);
    notice.mockClear();
    run(10, 10000);
    expect(gov.level()).toBe(0);
    expect(notice).not.toHaveBeenCalled();
  });

  it('提示沒說成（notice 回 false，例如還沒有可以顯示的地方）→ 下一次降級再說，說成了就不再說', () => {
    let ok = false;
    const { notice, run } = make({ notice: () => ok });
    run(40, 3000);
    expect(notice).toHaveBeenCalledTimes(1);
    ok = true;
    run(40, 3000);
    expect(notice).toHaveBeenCalledTimes(2);
    run(40, 3000);
    expect(notice).toHaveBeenCalledTimes(2);
  });

  it('開關關掉：馬上回 0 級並通知 render（完整畫質），之後不降、不提示；再打開重新量', () => {
    const { gov, applied, notice, run } = make();
    run(40, 6000);
    expect(gov.level()).toBe(2);
    gov.setEnabled(false);
    expect(gov.level()).toBe(0);
    expect(applied.at(-1)).toEqual({ level: 0, settings: qualitySettings(0) });
    const count = applied.length;
    run(100, 60000);
    expect(gov.level()).toBe(0);
    expect(applied.length).toBe(count);
    gov.setEnabled(true);
    run(40, 2900);
    expect(gov.level()).toBe(0);
    run(40, 200);
    expect(gov.level()).toBe(1);
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('本來就在 0 級時關掉：不多通知', () => {
    const { gov, applied } = make();
    gov.setEnabled(false);
    expect(applied).toEqual([]);
  });

  it('一開始就是關的（上次存的設定）：再慢也不降', () => {
    const { gov, applied, run } = make({ enabled: false });
    run(100, 30000);
    expect(gov.level()).toBe(0);
    expect(applied).toEqual([]);
  });

  it('分頁隱藏時的影格不算', () => {
    let hidden = true;
    const { gov, run } = make({ hidden: () => hidden });
    run(100, 30000);
    expect(gov.level()).toBe(0);
    hidden = false;
    run(100, 3000);
    expect(gov.level()).toBe(1);
  });
});
