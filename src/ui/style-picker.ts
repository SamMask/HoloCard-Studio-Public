// 右欄「卡片」最上面的一鍵風格（T-801，DESIGN §3）：六顆小按鈕排成 3×2，每顆＝斜的小色票＋名字。
// 一按就套一組現有設定（記一步、提示列說一聲，由組裝端處理）。它不是持續的單選：微調過之後就沒有哪一顆是選中的，
// 所以用「按下去的按鈕」（aria-pressed）而不是 radiogroup；每顆都是一般按鈕，Tab 走得到，Enter／空白鍵就是按。

import { matchCardStyle, type CardStyle } from '../model/styles';
import type { Card } from '../model/types';
import { button, h, toggleClass } from './dom';
import { CARD_STYLE_HELP, CARD_STYLE_LABEL, CARD_STYLE_OPTIONS, CARD_STYLE_TITLE, styleSwatch } from './logic';

export interface StylePicker {
  readonly el: HTMLElement;
  /** 目前的設定剛好等於哪個風格，那顆亮起來；微調過就都不亮。 */
  render(card: Card): void;
}

export function createStylePicker(onApply: (style: CardStyle) => void): StylePicker {
  const options = CARD_STYLE_OPTIONS.map((o) => {
    const swatch = h('span', { className: 'card-style-swatch', attrs: { 'aria-hidden': 'true' } });
    swatch.style.setProperty('--swatch', styleSwatch(o.value));
    const b = button('card-style-opt', [swatch, h('span', { className: 'card-style-name', text: o.name })], o.title);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onApply(o.value));
    return { value: o.value, el: b };
  });
  const grid = h('div', { className: 'card-styles', attrs: { role: 'toolbar', 'aria-label': CARD_STYLE_LABEL } }, options.map((o) => o.el));

  const el = h('div', { className: 'field-group card-style-group' }, [
    h('div', { className: 'group-title', text: CARD_STYLE_TITLE }),
    h('p', { className: 'help', text: CARD_STYLE_HELP }),
    grid,
  ]);

  return {
    el,
    render(card) {
      const current = matchCardStyle(card);
      for (const o of options) {
        const on = o.value === current;
        toggleClass(o.el, 'is-selected', on);
        if (o.el.getAttribute('aria-pressed') !== String(on)) o.el.setAttribute('aria-pressed', String(on));
      }
    },
  };
}
