// 右欄「舞台」六顆按鈕下面的「遠景」（T-815，DESIGN §5「水鏡遠景」）：只在舞台是水鏡時顯示。
// 三顆小縮圖按鈕〔湖光山峰〕〔水墨山〕〔富士山〕：同一組單選（attachRadioGroup：方向鍵切換、只有選中的在 Tab 順序裡），
// 點一顆＝editCard({ view: { waterScene } }, 'commit')（每次切換記一步）。小縮圖是那三張圖本身（main 讀好給本機的 blob 網址，
// 還沒讀好先不放圖）。這張卡有自己的背景圖時三顆變淡（不能按，選中的照樣標著）、下面說明「用了自己的背景圖（拿掉就會換回遠景）」。
// 文字一律 textContent。

import { waterSceneOf } from '../model/actions';
import type { WaterScene } from '../model/types';
import { attachRadioGroup } from './controls';
import { button, h, setHidden, toggleClass } from './dom';
import { WATER_SCENE_BACKDROP_NOTE, WATER_SCENE_OPTIONS, WATER_SCENE_TITLE, waterSceneFor } from './logic';
import type { UiIntents, UiState } from './types';

export interface WaterScenePicker {
  readonly el: HTMLElement;
  render(state: UiState): void;
}

export function createWaterScenePicker(intents: Pick<UiIntents, 'editCard'>): WaterScenePicker {
  const pick = (scene: WaterScene) => intents.editCard({ view: { waterScene: scene } }, 'commit');
  const items = WATER_SCENE_OPTIONS.map((o) => {
    const thumb = h('img', { className: 'water-scene-thumb', attrs: { alt: '', draggable: 'false' } });
    const el = button('water-scene-btn', [h('span', { className: 'water-scene-frame' }, [thumb]), h('span', { className: 'water-scene-name', text: o.label })]);
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-checked', 'false');
    el.addEventListener('click', () => pick(o.value));
    return { value: o.value, el, thumb };
  });
  const grid = h('div', { className: 'water-scene-grid', attrs: { role: 'radiogroup', 'aria-label': WATER_SCENE_TITLE } }, items.map((i) => i.el));
  const radios = attachRadioGroup(
    grid,
    items.map((i) => i.el),
    (index) => pick(items[index]!.value),
  );
  const note = h('p', { className: 'help water-scene-note', text: WATER_SCENE_BACKDROP_NOTE });

  const el = h('div', { className: 'field-group water-scene-block' }, [
    h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: WATER_SCENE_TITLE })]),
    grid,
    note,
  ]);

  return {
    el,
    render(state) {
      const card = state.card;
      const water = card.view.stage === 'water';
      setHidden(el, !water);
      if (!water) return;
      const chosen = waterSceneOf(card);
      const replaced = waterSceneFor(card) === 'backdrop';
      let at = -1;
      items.forEach((item, i) => {
        const on = item.value === chosen;
        if (on) at = i;
        toggleClass(item.el, 'is-selected', on);
        if (item.el.getAttribute('aria-checked') !== String(on)) item.el.setAttribute('aria-checked', String(on));
        item.el.disabled = replaced;
        // 小縮圖：讀好才放（水鏡第一次顯示時 main 才開始讀那三張圖）
        const url = state.waterSceneUrl?.(item.value) ?? '';
        if ((item.thumb.getAttribute('src') ?? '') !== url) {
          if (url) item.thumb.setAttribute('src', url);
          else item.thumb.removeAttribute('src');
        }
      });
      toggleClass(grid, 'is-muted', replaced);
      setHidden(note, !replaced);
      radios.paint(at);
    },
  };
}
