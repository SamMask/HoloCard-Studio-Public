// T-837 用詞統一（DESIGN §5.2「用詞統一」）：
//   ① 卡片最底下那層一律叫「底圖」（不寫「背景」）；② 舞台用的圖叫「背景圖」「前景圖」（不寫「舞台背景圖」）；
//   ③ 卡名外面的引號一律「」；④「長寬」一律「寬和高」；⑤ 混合模式說明一律「下面的圖」。
// 英日韓照同樣的分法：底圖＝Base image／背景レイヤー／배경 레이어，背景圖＝Background image／背景画像／배경 이미지。
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhHant } from '../src/i18n/zh-Hant';

/** 字典裡所有的字串；函式用一組樣本參數呼叫（第一個參數 NAME、其餘 3）。 */
function texts(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') {
    const fn = value as (...a: unknown[]) => unknown;
    const out = fn(...Array.from({ length: fn.length }, (_, i) => (i === 0 ? 'NAME' : 3)));
    return typeof out === 'string' ? [[path, out]] : [];
  }
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

const zh = texts(zhHant);
const hits = (list: [string, string][], pattern: RegExp) => list.filter(([, v]) => pattern.test(v)).map(([k]) => k);

describe('正體中文原文的用詞（T-837）', () => {
  it('① 卡片最底下那層叫「底圖」：圖層清單的小字、固定說明、深度滑桿的一端、右欄說明', () => {
    expect(zhHant.layers.baseSub).toBe('底圖');
    expect(zhHant.layers.baseFixed).toBe('底圖固定在最下面');
    expect(zhHant.inspector.depthNear).toBe('貼近底圖');
    expect(zhHant.inspector.baseNote).toBe('這是底圖，永遠在最後面，不會浮起來。');
  });

  it('① 「背景」只剩圖片本身有沒有透明（透明背景、去背）、舞台的「背景圖」與匯出的「畫上背景」，沒有指底圖的', () => {
    // T-849 指定的分組標題；這裡的背景指舞台，不是底圖。
    expect(zhHant.help.stageTitle).toBe('舞台與背景');
    const bare = zh.filter(([k, v]) => k !== 'help.stageTitle' && v.replace(/背景圖|透明背景|背景透明|背景變透明|沒有背景|畫上背景/g, '').includes('背景')).map(([k]) => k);
    expect(bare).toEqual([]);
  });

  it('② 舞台的圖叫「背景圖」「前景圖」：不再寫「舞台背景圖」；圖滿了的提示寫「背景圖、前景圖都算」', () => {
    expect(hits(zh, /舞台背景圖/)).toEqual([]);
    expect(zhHant.upload.tooManyImages).toContain('變身圖、背景圖、前景圖都算');
    expect(zhHant.stage.backdropHelpLine).toContain('自己的背景圖');
  });

  it('③ 引號：沒有『』（卡名一律「」；『』只留給「」裡面再引用）', () => {
    expect(hits(zh, /[『』]/)).toEqual([]);
    expect(zhHant.library.deleteConfirm('月夜')).toBe('刪掉「月夜」？刪掉後就找不回來了。');
    expect(zhHant.save.imported('月夜')).toBe('已匯入「月夜」');
    expect(zhHant.library.openLabel('月夜')).toBe('打開「月夜」');
    expect(zhHant.library.moreLabel('月夜')).toBe('「月夜」的更多動作');
  });

  it('④ 「長寬」一律「寬和高」', () => {
    expect(hits(zh, /長寬/)).toEqual([]);
    expect(zhHant.help.rotateAspect).toBe('右欄的「比例」可以換成正方形、明信片或自己輸入寬和高。');
  });

  it('⑤ 混合模式說明寫「下面的圖」，不寫「後面的圖」', () => {
    expect(zhHant.blend.help).toBe('這一層和下面的圖怎麼疊在一起。');
    expect(hits(zh, /後面的圖/)).toEqual([]);
  });
});

describe('英日韓照同樣的分法（T-837）', () => {
  it('英文：底圖叫 base image、背景圖叫 background image，講底圖時不寫 background', () => {
    expect(en.layers.baseFixed).toBe('The base image always stays at the bottom');
    expect(en.inspector.depthNear).toBe('Near base image');
    expect(en.inspector.baseNote).toBe('This is the base image. It stays behind everything and doesn’t float.');
    expect(en.upload.tooManyImages).toContain('alternate images, background images and foreground images');
    expect(en.upload.tooManyImages).not.toMatch(/stage backgrounds/);
  });

  it('日文：底圖叫 背景レイヤー、背景圖叫 背景画像', () => {
    expect(ja.layers.baseSub).toBe('背景レイヤー');
    expect(ja.layers.baseFixed).toBe('背景レイヤーは一番下に固定されます');
    expect(ja.inspector.depthNear).toBe('背景レイヤー寄り');
    expect(ja.inspector.baseNote).toBe('背景レイヤーなので、常にいちばん奥にあり、浮き上がりません。');
    expect(ja.upload.tooManyImages).not.toContain('ステージの背景画像');
    expect(ja.upload.tooManyImages).toContain('背景画像、前景画像');
  });

  it('韓文：底圖叫 배경 레이어、背景圖叫 배경 이미지', () => {
    expect(ko.layers.baseSub).toBe('배경 레이어');
    expect(ko.layers.baseFixed).toBe('배경 레이어는 맨 아래에 고정돼요');
    expect(ko.inspector.depthNear).toBe('배경 레이어 가까이');
    expect(ko.inspector.baseNote).toBe('배경 레이어예요. 항상 맨 뒤에 있고 떠오르지 않아요.');
    expect(ko.upload.tooManyImages).not.toContain('무대 배경 이미지');
    expect(ko.upload.tooManyImages).toContain('배경 이미지, 전경 이미지');
  });

  it('混合模式說明：圖在「下面」（below／下／아래），不是 behind／後ろ／뒤쪽', () => {
    expect(en.blend.help).toBe('How this layer mixes with the images below it.');
    expect(ja.blend.help).toBe('このレイヤーを下の画像にどう重ねるかを選びます。');
    expect(ko.blend.help).toBe('이 레이어를 아래쪽 이미지와 어떻게 겹칠지 정해요.');
  });
});
