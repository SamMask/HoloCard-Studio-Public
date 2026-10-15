// 卡片比例（T-807，DESIGN「卡片比例」、§7.3 新卡片的「空白卡」）的畫面零件：
// - aspectShape：照比例的小卡片外形（CSS 畫：寬高由 --card-hw〔高／寬〕算，不用圖檔）；
// - createAspectSizeInputs：自訂的「寬 × 高」兩個數字框（整數 1～999）；超出 1:2～2:1（或不是整數）框變紅＋說明，不送出；
// - createAspectPicker：右欄「比例」五選一（attachRadioGroup，方向鍵切換）＋選「自訂」時下面展開寬高，
//   打字停 0.6 秒才記一步（同文字圖層）；離開框時還沒送的先送出，不合格就放回這張卡現在的寬高；換了一張卡，還沒送的丟掉。
// 文字一律 textContent（硬邊界 4）。

import { S } from '../i18n';
import { aspectHeight, aspectSize } from '../model/aspect';
import type { Aspect, Card, CustomAspect } from '../model/types';
import { attachRadioGroup } from './controls';
import { button, h, setHidden, setText, toggleClass } from './dom';
import { ASPECT_CHOICES, ASPECT_CUSTOM_HELP, aspectInputError, debounce, numberOrNaN, plainKey, TEXT_IDLE_MS } from './logic';
import type { UiIntents } from './types';

/** 照比例的小卡片外形（cardH＝高／寬）；className 給外框大小（CSS 的 --shape-box）。 */
export function aspectShape(cardH: number, className = ''): HTMLElement {
  const el = h('span', { className: `aspect-shape ${className}`.trim(), attrs: { 'aria-hidden': 'true' } });
  setShapeHeight(el, cardH);
  return el;
}

/** 改小卡片外形（或任何用 --card-hw 的元素）的高／寬。 */
export function setShapeHeight(el: HTMLElement, cardH: number): void {
  const v = String(cardH);
  if (el.style.getPropertyValue('--card-hw') !== v) el.style.setProperty('--card-hw', v);
}

export interface AspectSizeInputs {
  readonly el: HTMLElement;
  readonly width: HTMLInputElement;
  readonly height: HTMLInputElement;
  /** 框裡的寬高合格就回寬高，不合格回 null。 */
  read(): CustomAspect | null;
  /** 放進寬高（清掉紅框與說明）。 */
  set(size: CustomAspect): void;
}

export interface AspectSizeOptions {
  /** 打了字（每打一個字）：合格給寬高，不合格給 null（框已經變紅、說明已經寫好）。 */
  onInput(size: CustomAspect | null): void;
  /** 在框裡按 Enter（新卡片面板＝〔建立〕）。 */
  onEnter?(): void;
  /** 焦點離開這兩個框（移到兩個框以外的地方）。 */
  onLeave?(): void;
}

/** 自訂的「寬 × 高」兩個數字框；help 給了就放在框下面（說明出現時換成說明）。 */
export function createAspectSizeInputs(o: AspectSizeOptions, help?: string): AspectSizeInputs {
  const box = (label: string) =>
    h('input', {
      className: 'aspect-num',
      attrs: { type: 'number', min: '1', max: '999', step: '1', inputmode: 'numeric', 'aria-label': label },
    });
  const width = box(S.aspect.width);
  const height = box(S.aspect.height);
  const error = h('p', { className: 'aspect-error', attrs: { role: 'alert' } });
  error.hidden = true;
  const helpEl = help ? h('p', { className: 'help aspect-help', text: help }) : null;
  const row = h('div', { className: 'aspect-size' }, [
    h('span', { className: 'aspect-size-label', text: S.aspect.width }),
    width,
    h('span', { className: 'aspect-times', text: '×', attrs: { 'aria-hidden': 'true' } }),
    h('span', { className: 'aspect-size-label', text: S.aspect.height }),
    height,
  ]);
  const el = h('div', { className: 'aspect-custom' }, [row, error, helpEl]);

  /** 照框裡的字畫紅框與說明；回說明（合格＝null）。 */
  const paint = (): string | null => {
    const message = aspectInputError(width.value, height.value);
    for (const input of [width, height]) {
      toggleClass(input, 'is-invalid', message !== null);
      if (message !== null) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    setText(error, message ?? '');
    setHidden(error, message === null);
    if (helpEl) setHidden(helpEl, message !== null);
    return message;
  };
  const read = (): CustomAspect | null =>
    aspectInputError(width.value, height.value) === null ? { width: numberOrNaN(width.value), height: numberOrNaN(height.value) } : null;

  for (const input of [width, height]) {
    input.addEventListener('input', () => {
      paint();
      o.onInput(read());
    });
    input.addEventListener('keydown', (e) => {
      // 只收單按的 Enter（Ctrl／Cmd／Alt 組合、輸入法選字中不算，T-607c 的 plainKey；T-807 審查）
      if (e.key === 'Enter' && plainKey(e)) {
        e.preventDefault();
        o.onEnter?.();
      }
    });
    input.addEventListener('blur', (e) => {
      const next = (e as FocusEvent).relatedTarget;
      if (next === width || next === height) return;
      o.onLeave?.();
    });
  }

  return {
    el,
    width,
    height,
    read,
    set(size) {
      const w = String(size.width);
      const hh = String(size.height);
      if (width.value !== w) width.value = w;
      if (height.value !== hh) height.value = hh;
      paint();
    },
  };
}

export interface AspectPicker {
  readonly el: HTMLElement;
  render(card: Card): void;
}

/** 右欄「比例」：五個選項（小卡片外形＋名字）＋自訂的寬高。 */
export function createAspectPicker(intents: Pick<UiIntents, 'editCard'>): AspectPicker {
  /** 畫面上這張卡（換卡時丟掉還沒送的寬高）。 */
  let card: Card | null = null;

  const typing = debounce<{ cardId: string; size: CustomAspect }>((v) => {
    if (v.cardId === card?.id) intents.editCard({ aspect: 'custom', customAspect: v.size }, 'commit');
  }, TEXT_IDLE_MS);

  const choose = (value: Aspect) => {
    if (!card || value === card.aspect) return;
    typing.cancel();
    // 換成自訂：先用目前比例的寬高（形狀不變），再讓人改數字
    if (value === 'custom') intents.editCard({ aspect: 'custom', customAspect: aspectSize(card) }, 'commit');
    else intents.editCard({ aspect: value }, 'commit');
  };

  const options = ASPECT_CHOICES.map((c) => {
    const shape = aspectShape(c.value === 'custom' ? aspectHeight({ aspect: 'standard' }) : aspectHeight({ aspect: c.value }), 'is-small');
    if (c.value === 'custom') shape.classList.add('is-custom');
    const b = button('aspect-opt', [shape, h('span', { className: 'aspect-opt-name', text: c.name })]);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.setAttribute('aria-label', c.name);
    b.title = c.detail;
    b.addEventListener('click', () => choose(c.value));
    return { value: c.value, el: b, shape };
  });
  const group = h('div', { className: 'aspect-picker', attrs: { role: 'radiogroup', 'aria-label': S.aspect.label } }, options.map((o) => o.el));
  const radios = attachRadioGroup(group, options.map((o) => o.el), (i) => choose(options[i]!.value));

  const sizes = createAspectSizeInputs(
    {
      onInput(size) {
        if (!card) return;
        if (size) typing.push({ cardId: card.id, size });
        else typing.cancel();
      },
      onEnter: () => typing.flush(),
      onLeave() {
        typing.flush();
        // 不合格的字不會被接受：離開時放回這張卡現在的寬高
        if (card && !sizes.read()) sizes.set(aspectSize(card));
      },
    },
    ASPECT_CUSTOM_HELP,
  );
  sizes.el.hidden = true;

  const el = h('div', { className: 'aspect-field' }, [group, sizes.el]);

  return {
    el,
    render(next) {
      if (card && card.id !== next.id) typing.cancel();
      const switched = card?.id !== next.id;
      card = next;
      let at = -1;
      options.forEach((o, i) => {
        const on = o.value === next.aspect;
        if (on) at = i;
        toggleClass(o.el, 'is-selected', on);
        if (o.el.getAttribute('aria-checked') !== String(on)) o.el.setAttribute('aria-checked', String(on));
      });
      radios.paint(at);
      // 自訂選項的小外形照這張卡的比例（不是自訂時照標準卡）
      const customShape = options[options.length - 1]!.shape;
      setShapeHeight(customShape, next.aspect === 'custom' ? aspectHeight(next) : aspectHeight({ aspect: 'standard' }));
      const custom = next.aspect === 'custom';
      setHidden(sizes.el, !custom);
      if (!custom) {
        typing.cancel();
        return;
      }
      // 換卡、或卡上的寬高和框裡的不一樣（復原、重做、別處改了）才換掉框裡的數字；還在等著送的不蓋掉，
      // 正在打、還不合格的字也不蓋（離開框時才放回）
      const size = aspectSize(next);
      const typed = sizes.read();
      const focused = document.activeElement === sizes.width || document.activeElement === sizes.height;
      const differs = !typed || typed.width !== size.width || typed.height !== size.height;
      if (switched || (differs && !typing.pending() && !(focused && !typed))) sizes.set(size);
    },
  };
}
