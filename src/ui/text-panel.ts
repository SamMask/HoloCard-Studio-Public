// 右欄「文字」小節（選中文字圖層時出現在深度／位置／大小上方）：內容、字型、樣式、顏色、直排、對齊。
// 打字停 0.6 秒才送一次（main 收到才重畫並記一步）；離開輸入框、換選別層、按別的文字設定時先把還沒送的送出去。
// 字型按鈕用那套字寫「卡片名稱」當預覽；字型還沒載入（還沒用過）時先顯示名字，不為了預覽去下載字型。

import { S } from '../i18n';
import type { Layer, TextAlign, TextSpec, TextStyle } from '../model/types';
import { createSegmented, createSwatches, createSwitch, type SwatchPreset } from './controls';
import { h, setHidden, setText } from './dom';
import { createFontPicker } from './font-picker';
import { debounce, TEXT_IDLE_MS } from './logic';
import type { EditPhase, UiIntents, UiState } from './types';

const TEXT_COLORS: readonly SwatchPreset[] = [
  { color: '#ffffff', name: S.colors.white },
  { color: '#1c1a22', name: S.colors.inkBlack },
  { color: '#e6c06a', name: S.colors.gold },
  { color: '#c8322b', name: S.colors.vermilion },
  { color: '#5fd4ee', name: S.colors.cyan },
  { color: '#f4a6c1', name: S.colors.sakura },
];

/** 字型按鈕的預覽字。 */
const FONT_SAMPLE = S.text.fontSample;

export interface TextPanel {
  readonly el: HTMLElement;
  /** layer 不是文字圖層（或沒選）就藏起來。 */
  render(layer: Layer | null, state: UiState): void;
}

export function createTextPanel(intents: UiIntents): TextPanel {
  let layer: Layer | null = null;
  /** 上次從狀態放進輸入框的內容：狀態的內容變了（復原、重畫完成）才覆蓋輸入框。 */
  let shownContent: string | null = null;

  const typing = debounce<{ id: string; content: string }>((v) => intents.editText(v.id, { content: v.content }, 'commit'), TEXT_IDLE_MS);
  const send = (patch: Partial<TextSpec>, phase: EditPhase) => {
    if (!layer) return;
    typing.flush();
    intents.editText(layer.id, patch, phase);
  };

  // ---- 內容 ----
  const area = h('textarea', {
    className: 'text-input',
    attrs: { rows: '2', maxlength: '100', spellcheck: 'false', 'aria-label': S.text.contentLabel, placeholder: S.text.placeholder },
  });
  area.addEventListener('input', () => {
    if (!layer) return;
    if (area.value.trim() === '') typing.cancel();
    else typing.push({ id: layer.id, content: area.value });
  });
  area.addEventListener('blur', () => {
    typing.flush();
    // 只有空白不會被接受：離開時顯示回目前的內容
    if (layer?.text && area.value.trim() === '') area.value = layer.text.content;
  });
  const contentHelp = h('p', { className: 'help', text: S.text.contentHelp });

  // ---- 字型（四套按鈕，卡片故事也用同一個元件，T-804） ----
  const fonts = createFontPicker({ label: S.common.font, sample: FONT_SAMPLE, onPick: (font) => send({ font }, 'commit') });

  // ---- 樣式、顏色、直排、對齊 ----
  const style = createSegmented<TextStyle>(
    S.text.style,
    [
      { value: 'plain', label: S.text.plain },
      { value: 'outline', label: S.text.outline },
      { value: 'seal', label: S.text.seal },
    ],
    (v) => send({ style: v }, 'commit'),
  );
  const styleHelp = h('p', { className: 'help' });
  const colorLabel = h('span', { className: 'field-label' });
  const color = createSwatches(S.text.color, TEXT_COLORS, (c, phase) => send({ color: c }, phase));
  const vertical = createSwitch(S.text.vertical, (next) => send({ vertical: next }, 'commit'));
  const alignH = createSegmented<TextAlign>(
    S.text.align,
    [
      { value: 'start', label: S.text.left },
      { value: 'center', label: S.text.center },
      { value: 'end', label: S.text.right },
    ],
    (v) => send({ align: v }, 'commit'),
  );
  const alignV = createSegmented<TextAlign>(
    S.text.align,
    [
      { value: 'start', label: S.text.top },
      { value: 'center', label: S.text.center },
      { value: 'end', label: S.text.bottom },
    ],
    (v) => send({ align: v }, 'commit'),
  );

  const field = (label: HTMLElement | string, control: HTMLElement, extra?: HTMLElement) =>
    h('div', { className: 'field' }, [
      h('div', { className: 'field-head' }, [typeof label === 'string' ? h('span', { className: 'field-label', text: label }) : label]),
      control,
      extra ?? null,
    ]);

  const el = h('div', { className: 'field-group text-panel' }, [
    h('div', { className: 'group-title', text: S.text.title }),
    h('div', { className: 'field' }, [area, contentHelp]),
    field(S.common.font, fonts.el),
    field(S.text.style, style.el, styleHelp),
    field(colorLabel, color.el),
    h('div', { className: 'field-row' }, [h('span', { className: 'field-label', text: S.text.vertical }), vertical.el]),
    field(S.text.multiAlign, h('div', {}, [alignH.el, alignV.el]), h('p', { className: 'help', text: S.text.multiAlignHelp })),
  ]);

  return {
    el,
    render(next, state) {
      const text = next?.text ?? null;
      if (layer && layer.id !== next?.id) typing.flush();
      if (!next || !text) {
        layer = null;
        shownContent = null;
        setHidden(el, true);
        return;
      }
      const switched = layer?.id !== next.id;
      layer = next;
      setHidden(el, false);

      // 還有沒送出的打字就不覆蓋（不然打到一半的字會被吃掉）；其他時候（復原、重畫完成）跟著狀態走
      if (switched || (text.content !== shownContent && !typing.pending())) {
        if (area.value !== text.content) area.value = text.content;
        shownContent = text.content;
      }

      fonts.render(text.font, state.loadedFonts);

      style.set(text.style);
      setText(
        styleHelp,
        text.style === 'seal' ? S.text.sealHelp : text.style === 'outline' ? S.text.outlineHelp : S.text.plainHelp,
      );
      setText(colorLabel, text.style === 'seal' ? S.text.sealColor : S.common.color);
      color.set(text.color);
      vertical.set(text.vertical);
      setHidden(alignH.el, text.vertical);
      setHidden(alignV.el, !text.vertical);
      alignH.set(text.align);
      alignV.set(text.align);
    },
  };
}
