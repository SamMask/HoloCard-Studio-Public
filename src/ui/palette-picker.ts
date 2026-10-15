// 右欄鐳射小節的「色彩」（T-310）：七個選項（小色塊漸層＋名字）；選「自訂」時出現 4 個顏色格，
// 點一格在下面打開顏色表（一排預設色＋自選）換那一格。選項與預設色一按就 commit；自選顏色拖動中 preview、選完 commit。
// 顏色表選好、再點同一格、按 Esc、點別的地方 → 收起來。

import { S } from '../i18n';
import type { Holo } from '../model/types';
import { attachRadioGroup, createSwatches } from './controls';
import { button, h, setHidden, toggleClass } from './dom';
import { COLOR_TABLE, HOLO_PALETTE_OPTIONS, paletteColors, paletteGradient, replaceColor } from './logic';
import type { EditPhase } from './types';

export interface PalettePicker {
  readonly el: HTMLElement;
  render(holo: Holo): void;
}

export function createPalettePicker(onChange: (patch: Partial<Holo>, phase: EditPhase) => void): PalettePicker {
  let colors: readonly string[] = [];
  /** 顏色表正在換第幾格；null＝收起來。 */
  let open: number | null = null;

  const options = HOLO_PALETTE_OPTIONS.map((o) => {
    const strip = h('span', { className: 'palette-strip' });
    const b = button('palette-opt', [strip, h('span', { className: 'palette-name', text: o.name })], o.name);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => onChange({ palette: o.value }, 'commit'));
    return { value: o.value, el: b, strip };
  });
  const grid = h('div', { className: 'palette-grid', attrs: { role: 'radiogroup', 'aria-label': S.palette.label } }, options.map((o) => o.el));
  // 單選群組的鍵盤（T-607b）：方向鍵換色彩，一按就 commit 一步（同點一下）；只有選中的那顆在 Tab 順序裡
  const radios = attachRadioGroup(grid, options.map((o) => o.el), (i) => onChange({ palette: options[i]!.value }, 'commit'));

  // ---- 自訂：4 個顏色格＋顏色表 ----
  const cells = [0, 1, 2, 3].map((i) => {
    const b = button('palette-cell', [], S.palette.cellTip(i + 1));
    b.setAttribute('aria-label', S.palette.cellLabel(i + 1));
    b.addEventListener('click', () => setOpen(open === i ? null : i));
    return b;
  });

  const table = createSwatches(S.palette.tableLabel, COLOR_TABLE, (color, phase) => {
    if (open === null) return;
    const index = open;
    onChange({ colors: replaceColor(colors, index, color) }, phase);
    if (phase === 'commit') {
      setOpen(null);
      cells[index]!.focus();
    }
  });
  const tableBox = h('div', { className: 'color-table' }, [table.el]);

  const custom = h('div', { className: 'palette-custom' }, [
    h('p', { className: 'help', text: S.palette.tableHelp }),
    h('div', { className: 'palette-cells' }, cells),
    tableBox,
  ]);

  function setOpen(next: number | null): void {
    open = next;
    cells.forEach((c, i) => {
      toggleClass(c, 'is-open', i === next);
      c.setAttribute('aria-expanded', String(i === next));
    });
    setHidden(tableBox, next === null);
    if (next !== null) {
      tableBox.style.setProperty('--caret', `calc(${(next + 0.5) * 25}% - 6px)`);
      table.set(colors[next] ?? '#ffffff');
    }
  }
  setOpen(null);

  // Esc 只收起顏色表（不往外傳，免得順便取消選取圖層）；點顏色表與顏色格以外的地方也收起來
  custom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open !== null) {
      const index = open;
      e.stopPropagation();
      setOpen(null);
      cells[index]!.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (open !== null && !custom.contains(e.target as Node)) setOpen(null);
  });

  const el = h('div', { className: 'field palette-field' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.palette.title })]),
    grid,
    custom,
  ]);

  return {
    el,
    render(holo) {
      colors = holo.colors;
      for (const o of options) {
        const on = o.value === holo.palette;
        toggleClass(o.el, 'is-selected', on);
        o.el.setAttribute('aria-checked', String(on));
        o.strip.style.setProperty('--strip', paletteGradient(paletteColors(o.value, colors)));
      }
      radios.paint(options.findIndex((o) => o.value === holo.palette));
      cells.forEach((c, i) => c.style.setProperty('--swatch', colors[i] ?? 'transparent'));
      const isCustom = holo.palette === 'custom';
      setHidden(custom, !isCustom);
      if (!isCustom && open !== null) setOpen(null);
      if (open !== null) table.set(colors[open] ?? '#ffffff');
    },
  };
}
