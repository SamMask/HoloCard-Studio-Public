// 卡片庫與新卡片面板的縮圖：滑鼠移上去微微傾斜、光澤跟著滑鼠跑（呼應立體卡，DESIGN 7.2）。
// 只設 CSS 變數（--rx、--ry、--gx、--gy），轉法與「減少動態效果」時不轉都寫在 style.css。

import { tiltFromPointer } from './library-logic';

/** 滑鼠在 target 上移動時，讓 art 跟著傾斜；離開就回正。 */
export function attachTilt(target: HTMLElement, art: HTMLElement): void {
  const set = (rx: number, ry: number, gx: number, gy: number) => {
    art.style.setProperty('--rx', `${rx}deg`);
    art.style.setProperty('--ry', `${ry}deg`);
    art.style.setProperty('--gx', `${gx}%`);
    art.style.setProperty('--gy', `${gy}%`);
  };
  target.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const t = tiltFromPointer(e.clientX, e.clientY, target.getBoundingClientRect());
    set(t.rx, t.ry, t.gx, t.gy);
  });
  target.addEventListener('pointerleave', () => {
    for (const name of ['--rx', '--ry', '--gx', '--gy']) art.style.removeProperty(name);
  });
}
