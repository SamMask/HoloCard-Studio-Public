// 字型按鈕（四套，2×2）：文字圖層的「字型」與卡片故事（T-804）共用同一種選法。
// 每顆按鈕用那套字寫一小段預覽字；字型還沒載入（還沒用過）時先顯示名字，不為了預覽去下載字型。
// 選中的亮起來（is-selected＋aria-pressed）；一按就交給呼叫端（記不記一步由呼叫端決定）。

import { S } from '../i18n';
import { TEXT_FONT_INFO } from '../images/text-layout';
import { TEXT_FONTS } from '../model/limits';
import type { TextFont } from '../model/types';
import { button, h, setHidden, setText, toggleClass } from './dom';

export interface FontPicker {
  readonly el: HTMLElement;
  /** 選中哪一套、哪幾套已經載入（沒給＝都還沒載入）。 */
  render(selected: TextFont, loaded: readonly TextFont[] | undefined): void;
}

export function createFontPicker(options: { label: string; sample: string; onPick(font: TextFont): void }): FontPicker {
  const fonts = TEXT_FONTS.map((font) => {
    const info = TEXT_FONT_INFO[font];
    const sample = h('span', { className: 'font-sample' });
    const name = h('span', { className: 'font-name', text: info.label });
    const el = button('font-btn', [sample, name], info.fullName);
    el.setAttribute('aria-label', S.fonts.optionLabel(info.label, info.fullName));
    el.addEventListener('click', () => options.onPick(font));
    return { font, el, sample, name, loaded: null as boolean | null };
  });
  const el = h('div', { className: 'font-grid', attrs: { role: 'group', 'aria-label': options.label } }, fonts.map((f) => f.el));

  return {
    el,
    render(selected, loadedFonts) {
      const loaded = new Set<TextFont>(loadedFonts ?? []);
      for (const f of fonts) {
        const isLoaded = loaded.has(f.font);
        if (f.loaded !== isLoaded) {
          f.loaded = isLoaded;
          const info = TEXT_FONT_INFO[f.font];
          setText(f.sample, isLoaded ? options.sample : info.label);
          f.sample.style.fontFamily = isLoaded ? `"${info.family}", system-ui` : '';
          f.sample.style.fontWeight = isLoaded ? String(info.weight) : '';
          setHidden(f.name, !isLoaded);
        }
        const on = selected === f.font;
        toggleClass(f.el, 'is-selected', on);
        f.el.setAttribute('aria-pressed', String(on));
      }
    },
  };
}
