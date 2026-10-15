// 共用的小控制項：滑桿、開關、色塊、分段按鈕。只負責畫面與送出事件，不碰資料。
// 拖曳類（滑桿、自選顏色）拖動中送 preview、放開送 commit；拖動中不接受外部改值（不然滑桿會跳、拖不動）。

import { S } from '../i18n';
import type { EditPhase } from './types';
import { button, h, setText, toggleClass } from './dom';
import { plainKey, radioStep } from './logic';

// ---- 滑桿 ----

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  /** 置中型（例如位置 -1～1）：軌道不從左邊填色、中間有刻度。 */
  bipolar?: boolean;
  /** 數值旁的白話（不給就不顯示數字）。 */
  valueText?: (v: number) => string;
  /** 兩端的白話標籤，例如「細」「粗」。 */
  ends?: [string, string];
  onChange(value: number, phase: EditPhase): void;
}

export interface Slider {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  set(value: number): void;
  setDisabled(disabled: boolean): void;
}

export function createSlider(o: SliderOptions): Slider {
  const input = h('input', {
    className: o.bipolar ? 'slider bipolar' : 'slider',
    attrs: { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), 'aria-label': o.label },
  });
  const value = h('span', { className: 'field-value' });
  const head = h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: o.label }), o.valueText ? value : null]);
  const ends = o.ends
    ? h('div', { className: 'field-ends' }, [h('span', { text: o.ends[0] }), h('span', { text: o.ends[1] })])
    : null;
  const el = h('div', { className: 'field' }, [head, input, ends]);

  /** 拖動中（送過 preview 還沒 commit）。 */
  let active = false;
  const paint = () => {
    const v = Number(input.value);
    const pct = ((v - o.min) / (o.max - o.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
    if (o.valueText) setText(value, o.valueText(v));
  };
  const finish = () => {
    if (!active) return;
    active = false;
    o.onChange(Number(input.value), 'commit');
  };

  input.addEventListener('input', () => {
    active = true;
    paint();
    o.onChange(Number(input.value), 'preview');
  });
  input.addEventListener('change', finish);
  // 拖回原值時瀏覽器不送 change：放開後補一次，確保不會一直卡在「拖動中」
  input.addEventListener('pointerup', () => setTimeout(finish, 0));
  input.addEventListener('blur', finish);

  return {
    el,
    input,
    set(v) {
      if (active) return;
      const s = String(v);
      if (input.value !== s) input.value = s;
      paint();
    },
    setDisabled(disabled) {
      input.disabled = disabled;
      toggleClass(el, 'is-disabled', disabled);
    },
  };
}

// ---- 開關（開／關一眼分得出來：軌道顏色、圓點位置、文字三個都不同） ----

export interface Switch {
  readonly el: HTMLButtonElement;
  set(on: boolean): void;
}

export function createSwitch(label: string, onToggle: (next: boolean) => void): Switch {
  const state = h('span', { className: 'switch-state' });
  const el = button('switch', [h('span', { className: 'switch-track' }, [h('span', { className: 'switch-knob' })]), state]);
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-label', label);
  let on = false;
  el.addEventListener('click', () => onToggle(!on));
  const sw: Switch = {
    el,
    set(next) {
      on = next;
      el.setAttribute('aria-checked', String(next));
      toggleClass(el, 'is-on', next);
      setText(state, next ? S.common.on : S.common.off);
    },
  };
  sw.set(false);
  return sw;
}

// ---- 色塊（幾個預設＋自選） ----

export interface SwatchPreset {
  color: string;
  name: string;
}

export interface Swatches {
  readonly el: HTMLElement;
  set(color: string): void;
}

export function createSwatches(label: string, presets: readonly SwatchPreset[], onChange: (color: string, phase: EditPhase) => void): Swatches {
  const presetButtons = presets.map((p) => {
    const b = button('swatch', [], p.name);
    b.style.setProperty('--swatch', p.color);
    b.setAttribute('aria-label', p.name);
    b.addEventListener('click', () => onChange(p.color, 'commit'));
    return { color: p.color.toLowerCase(), el: b };
  });

  // 自選：彩虹圈，中間顯示目前的自選色；真正的 <input type=color> 透明蓋在上面
  const picker = h('input', { className: 'swatch-picker', attrs: { type: 'color', 'aria-label': S.common.customColorLabel(label) } });
  const custom = h('label', { className: 'swatch swatch-custom', title: S.common.customColor }, [h('span', { className: 'swatch-custom-dot' }), picker]);
  let active = false;
  picker.addEventListener('input', () => {
    active = true;
    onChange(picker.value, 'preview');
  });
  picker.addEventListener('change', () => {
    active = false;
    onChange(picker.value, 'commit');
  });

  const el = h('div', { className: 'swatches', attrs: { role: 'group', 'aria-label': label } }, [...presetButtons.map((p) => p.el), custom]);
  return {
    el,
    set(color) {
      const c = color.toLowerCase();
      let matched = false;
      for (const p of presetButtons) {
        const on = p.color === c;
        matched ||= on;
        toggleClass(p.el, 'is-selected', on);
        p.el.setAttribute('aria-pressed', String(on));
      }
      toggleClass(custom, 'is-selected', !matched);
      custom.style.setProperty('--swatch', matched ? 'transparent' : c);
      if (!active && picker.value !== c) picker.value = c;
    },
  };
}

// ---- 單選群組的鍵盤（T-607、T-607b）：分段按鈕、混合模式、鐳射色彩共用 ----
// 語意是 radiogroup／radio（不是分頁）：焦點與 aria-checked 同步，只有選中的那顆在 Tab 順序裡，
// ← → ↑ ↓ 在選項之間移動並選中（一按一步，同點一下），到頭停住不繞回、跳過不能選的（disabled；呼叫端另外給 skip 時也跳過，
// 例如破框層鎖住的動態特效，T-811b）（T-416b 卡框樣式的寫法）。只有 aria-disabled 的選項不跳過（光碟的〔背面〕分頁灰掉但方向鍵還是要翻過去，T-810b）。

export interface RadioGroup {
  /** 畫面上選中的是第幾個（-1＝沒有）：只有它在 Tab 順序裡（沒有選中時第一個能按的先當停點）。按方向鍵時從這裡算起。 */
  paint(selectedIndex: number): void;
}

/**
 * 掛上單選群組的方向鍵。buttons 的 role／aria-checked 由呼叫端設（render 時），這裡管 tabindex 與按鍵：
 * 方向鍵移動焦點，移到和選中不同的那顆就呼叫 pick(index)（選中的更新由呼叫端 render 後 paint）。
 * skip（選用）：第 i 個現在不能選（鎖住）→ 方向鍵跳過它（原生 disabled 的一律跳過）；沒給＝只看原生 disabled，和以前一樣。
 */
export function attachRadioGroup(
  group: HTMLElement,
  buttons: readonly HTMLButtonElement[],
  pick: (index: number) => void,
  skip: (index: number) => boolean = () => false,
): RadioGroup {
  /** 畫面上選著的（下一次 paint 再對齊）。第一次 paint 之前＝第一顆。 */
  let shown = 0;
  const off = (i: number) => buttons[i]!.disabled || skip(i);
  const stops = (selected: number) => {
    const at = selected >= 0 ? selected : Math.max(0, buttons.findIndex((_, i) => !off(i)));
    buttons.forEach((b, i) => (b.tabIndex = i === at ? 0 : -1));
  };
  stops(0);
  group.addEventListener('keydown', (e) => {
    // Ctrl+→ 之類的組合鍵、輸入法選字中不換（T-607c）
    if (!plainKey(e)) return;
    const focused = buttons.findIndex((b) => b === document.activeElement);
    const from = focused >= 0 ? focused : Math.max(0, shown);
    const to = radioStep(e.key, from, buttons.length, off);
    if (to === null) return;
    e.preventDefault();
    if (to === from) return;
    buttons[to]!.focus();
    if (to !== shown) pick(to);
  });
  return {
    paint(selectedIndex) {
      shown = selectedIndex;
      stops(selectedIndex);
    },
  };
}

// ---- 分段按鈕（正面｜背面、標準卡｜塔羅牌、舞台六選一…）：單選群組 ----

export interface Segmented<T extends string> {
  readonly el: HTMLElement;
  set(value: T): void;
}

export function createSegmented<T extends string>(
  label: string,
  /** title＝滑過的說明（T-832 舞台〔工作桌〕；沒給＝沒有）。 */
  options: readonly { value: T; label: string; icon?: SVGElement; extra?: HTMLElement; title?: string }[],
  /** via＝怎麼選的：'click' 點（或在選項上按 Enter／空白鍵）、'key' 用方向鍵移過去（選了會跳出視窗的選項，方向鍵經過時不該跳）。 */
  onPick: (value: T, via: 'click' | 'key') => void,
): Segmented<T> {
  const buttons = options.map((o) => {
    const b = button('seg-btn', [o.icon ?? null, h('span', { text: o.label }), o.extra ?? null], o.title);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.addEventListener('click', () => onPick(o.value, 'click'));
    return { value: o.value, el: b };
  });
  const el = h('div', { className: 'segmented', attrs: { role: 'radiogroup', 'aria-label': label } }, buttons.map((b) => b.el));
  const radios = attachRadioGroup(el, buttons.map((b) => b.el), (i) => onPick(buttons[i]!.value, 'key'));
  const set = (value: T) => {
    let at = -1;
    buttons.forEach((b, i) => {
      const on = b.value === value;
      if (on) at = i;
      toggleClass(b.el, 'is-selected', on);
      if (b.el.getAttribute('aria-checked') !== String(on)) b.el.setAttribute('aria-checked', String(on));
    });
    radios.paint(at);
  };
  return { el, set };
}
