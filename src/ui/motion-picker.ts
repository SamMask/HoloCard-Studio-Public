// 轉動匯出的動作（T-512，DESIGN 7.1）：〔轉一圈〕〔左右擺動〕；選擺動時多一個「擺動角度」：滑桿＋數字＋「度」＋小字「左右各轉幾度」
//   （5～60 度、整數、預設 30；使用者 2026-10-14：「左右轉動的角度給使用者自己輸入」）。
// 上下（T-812）：動作下面多一列「上下」：滑桿＋數字＋「度」＋小字「轉的時候卡片上下點頭幾度（0＝只有左右）」
//   （0～25 度、整數、預設 10；轉一圈與左右擺動都有，一直顯示）。
// 影片與 GIF 的選項小框各放一份（同一個元素不能同時在兩個地方），共用同一個 MotionChoice 物件：同一次開著工坊記住上次的選擇。
// 文字一律 textContent。

import { S } from '../i18n';
import { button, h, setHidden, toggleClass } from './dom';
import { icon } from './icons';
import { clampNodDeg, clampSwingDeg, motionLabel, MOTIONS, NOD_DEG, NOD_NOTE_TEXT, plainKey, SWING_DEG, SWING_NOTE_TEXT } from './logic';
import type { MotionChoice, TurntableMotion } from './types';

/** 第一次打開選項小框時的選擇：轉一圈、擺動角度 30、上下 10。 */
export function defaultMotion(): MotionChoice {
  return { motion: 'turn', swingDeg: SWING_DEG.default, nodDeg: NOD_DEG.default };
}

export interface MotionPicker {
  /** 兩列：動作＋（擺動時）擺動角度；下面一列「上下」。 */
  readonly el: HTMLElement;
  /** 照共用的選擇重畫（小框打開時：另一個小框可能改過）。 */
  render(): void;
}

const MOTION_ICON: Record<TurntableMotion, 'rotate' | 'showcase'> = { turn: 'rotate', swing: 'showcase' };

/**
 * choice＝共用的選擇（這裡直接改它）；onChange＝改了動作（'motion'）、擺動角度（'angle'）或上下角度（'nod'，T-812）
 * （角度拖滑桿時每動一下都會叫）。idPrefix＝這一份的 id 前綴（兩個小框各一份，id 不能重複）。
 */
export function createMotionPicker(choice: MotionChoice, onChange: (what: 'motion' | 'angle' | 'nod') => void, idPrefix: string): MotionPicker {
  const labelId = `${idPrefix}-motion-label`;
  const buttons = MOTIONS.map((motion) => {
    const b = button('seg-btn mo-btn', [icon(MOTION_ICON[motion], 16), motionLabel(motion)]);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => pick(motion));
    return { motion, el: b };
  });
  const group = h(
    'div',
    { className: 'segmented mo-motions', attrs: { role: 'radiogroup', 'aria-labelledby': labelId } },
    buttons.map((b) => b.el),
  );

  const range = h('input', {
    className: 'slider mo-angle-range',
    attrs: { type: 'range', min: String(SWING_DEG.min), max: String(SWING_DEG.max), step: '1', 'aria-label': S.export.swingAngleLabel },
  });
  const number = h('input', {
    className: 'vo-num mo-angle-num',
    attrs: {
      type: 'number',
      min: String(SWING_DEG.min),
      max: String(SWING_DEG.max),
      step: '1',
      inputmode: 'numeric',
      'aria-label': S.export.swingAngleUnitLabel,
    },
  });
  const angleRow = h('div', { className: 'mo-angle' }, [
    h('span', { className: 'vo-label', text: S.export.swingAngle }),
    range,
    number,
    h('span', { className: 'vo-unit', text: S.export.degrees }),
    h('span', { className: 'mo-note', text: SWING_NOTE_TEXT }),
  ]);

  const motionRow = h('div', { className: 'vo-row mo-row' }, [
    h('span', { className: 'vo-label', text: S.export.motion, attrs: { id: labelId } }),
    group,
    angleRow,
  ]);

  // ---- 上下（T-812）：轉一圈與左右擺動都有，一直顯示 ----
  const nodRange = h('input', {
    className: 'slider mo-nod-range',
    attrs: { type: 'range', min: String(NOD_DEG.min), max: String(NOD_DEG.max), step: '1', 'aria-label': S.export.nodAngleLabel },
  });
  const nodNumber = h('input', {
    className: 'vo-num mo-nod-num',
    attrs: {
      type: 'number',
      min: String(NOD_DEG.min),
      max: String(NOD_DEG.max),
      step: '1',
      inputmode: 'numeric',
      'aria-label': S.export.nodAngleUnitLabel,
    },
  });
  const nodRow = h('div', { className: 'vo-row mo-nod' }, [
    h('span', { className: 'vo-label', text: S.export.nod }),
    nodRange,
    nodNumber,
    h('span', { className: 'vo-unit', text: S.export.degrees }),
    h('span', { className: 'mo-note', text: NOD_NOTE_TEXT }),
  ]);

  const el = h('div', { className: 'mo-picker' }, [motionRow, nodRow]);

  /** 角度：滑桿、數字一起更新（數字框正在打字時不蓋掉）。 */
  const paintAngle = (fromNumber = false) => {
    range.value = String(choice.swingDeg);
    range.style.setProperty('--fill', `${((choice.swingDeg - SWING_DEG.min) / (SWING_DEG.max - SWING_DEG.min)) * 100}%`);
    if (!fromNumber) number.value = String(choice.swingDeg);
  };

  /** 上下角度：滑桿、數字一起更新（數字框正在打字時不蓋掉）。 */
  const paintNod = (fromNumber = false) => {
    nodRange.value = String(choice.nodDeg);
    nodRange.style.setProperty('--fill', `${((choice.nodDeg - NOD_DEG.min) / (NOD_DEG.max - NOD_DEG.min)) * 100}%`);
    if (!fromNumber) nodNumber.value = String(choice.nodDeg);
  };

  const render = () => {
    choice.swingDeg = clampSwingDeg(choice.swingDeg);
    choice.nodDeg = clampNodDeg(choice.nodDeg);
    for (const b of buttons) {
      const on = b.motion === choice.motion;
      toggleClass(b.el, 'is-selected', on);
      b.el.setAttribute('aria-checked', String(on));
      b.el.tabIndex = on ? 0 : -1;
    }
    setHidden(angleRow, choice.motion !== 'swing');
    paintAngle();
    paintNod();
  };

  const pick = (motion: TurntableMotion) => {
    if (motion === choice.motion) return;
    choice.motion = motion;
    render();
    onChange('motion');
  };
  // 方向鍵在兩個動作之間移動（單選的慣例）；Ctrl+→ 之類的組合鍵、輸入法選字中不換（T-703b 補上 T-607c 的 plainKey）
  group.addEventListener('keydown', (e) => {
    if (!plainKey(e)) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = MOTIONS.indexOf(choice.motion);
    const next = MOTIONS[Math.min(MOTIONS.length - 1, Math.max(0, i + step))]!;
    pick(next);
    buttons.find((b) => b.motion === next)?.el.focus();
  });

  const setAngle = (value: number, fromNumber = false) => {
    const next = clampSwingDeg(value);
    const changed = next !== choice.swingDeg;
    choice.swingDeg = next;
    paintAngle(fromNumber);
    if (changed) onChange('angle');
  };
  range.addEventListener('input', () => setAngle(Number(range.value)));
  // 打字中（例如要打 30 先打了 3）先照夾過的值用，但不蓋掉數字框；打完（離開或 Enter）才把數字框改成夾過的值
  number.addEventListener('input', () => {
    if (number.value !== '') setAngle(Number(number.value), true);
  });
  number.addEventListener('change', () => paintAngle());

  const setNod = (value: number, fromNumber = false) => {
    const next = clampNodDeg(value);
    const changed = next !== choice.nodDeg;
    choice.nodDeg = next;
    paintNod(fromNumber);
    if (changed) onChange('nod');
  };
  nodRange.addEventListener('input', () => setNod(Number(nodRange.value)));
  nodNumber.addEventListener('input', () => {
    if (nodNumber.value !== '') setNod(Number(nodNumber.value), true);
  });
  nodNumber.addEventListener('change', () => paintNod());

  render();
  return { el, render };
}
