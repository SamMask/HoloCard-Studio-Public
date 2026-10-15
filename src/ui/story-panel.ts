// 右欄「卡片」區塊的「卡片故事」小節（T-804，DESIGN「卡片故事」）：多行文字框（最多 60 字、2 行，旁邊「12／60」）＋
// 字型（和文字圖層同一個元件、同樣四套）＋說明句。
// - 打字停 0.6 秒才送一次 commit（＝記一步，同文字圖層）；離開文字框時先把還沒送的送出去；清空＝送空字串（model 拿掉欄位）。
// - 已經 2 行（有字的行；只有空白的行不算）時 Enter 不換行；貼上超過 2 行只留前 2 行；字數照字元算剪到 60（不用原生 maxlength，T-804b）。
// - 輸入法選字中不整理、不送（選完才送），Enter 也不管；選字一開始先把之前打好的送出，選字中畫面更新不覆蓋正在組的字（T-804b）。
// - 打完字直接點字型：焦點移到字型按鈕時先不送，按下去時打的字和字型合成一步（T-804b）。
// - 打字中焦點在文字框，Ctrl+Z 交給瀏覽器（app.ts 的 shortcutFor 看到文字框就不攔）。
// - 換了一張卡：還沒送的打字丟掉（不會寫到新卡上）。

import { S } from '../i18n';
import { cleanStory, DEFAULT_STORY_FONT } from '../model/actions';
import { STORY_MAX } from '../model/limits';
import type { TextFont } from '../model/types';
import { h, setHidden, setText, toggleClass } from './dom';
import { createFontPicker } from './font-picker';
import { icon } from './icons';
import { debounce, TEXT_IDLE_MS } from './logic';
import { limitStoryInput, STORY_HELP, STORY_PLACEHOLDER, STORY_STAGE_OFF_NOTE, storyCountText, storyEnterBlocked } from './story';
import type { UiIntents, UiState } from './types';

/** 字型按鈕的預覽字。 */
const FONT_SAMPLE = S.story.fontSample;

export interface StoryPanel {
  readonly el: HTMLElement;
  render(state: UiState): void;
}

export function createStoryPanel(intents: UiIntents): StoryPanel {
  /** 畫面上這張卡的 id（換卡時丟掉還沒送的打字）與故事。 */
  let cardId: string | null = null;
  let hasStory = false;
  /** 選著的字型：有故事就是故事的；還沒寫故事時先記在這裡，寫了才一起送。 */
  let font: TextFont = DEFAULT_STORY_FONT;
  let loadedFonts: UiState['loadedFonts'];

  const typing = debounce<{ cardId: string; text: string; font: TextFont }>((v) => {
    if (v.cardId === cardId) intents.editCard({ story: { text: v.text, font: v.font } }, 'commit');
  }, TEXT_IDLE_MS);

  const area = h('textarea', {
    className: 'text-input story-input',
    attrs: {
      rows: '2',
      spellcheck: 'false',
      'aria-label': S.story.title,
      placeholder: STORY_PLACEHOLDER,
    },
  });
  const count = h('span', { className: 'story-count', attrs: { 'aria-live': 'off' } });
  const paintCount = () => {
    setText(count, storyCountText(area.value));
    toggleClass(count, 'is-full', Array.from(area.value).length >= STORY_MAX);
  };

  /** 輸入法正在選字（T-804b）：畫面更新不覆蓋文字框。 */
  let composing = false;

  /** 打了字（輸入法選完）：超過 2 行、超過 60 字先剪掉，再排一次「停手才送」。 */
  const edited = () => {
    const limited = limitStoryInput(area.value);
    if (limited !== area.value) area.value = limited;
    paintCount();
    if (cardId !== null) typing.push({ cardId, text: area.value, font });
  };
  area.addEventListener('input', (e) => {
    // 輸入法選字中：只更新字數，選完（compositionend）才整理、才送
    if ((e as InputEvent).isComposing) {
      paintCount();
      return;
    }
    edited();
  });
  area.addEventListener('compositionstart', () => {
    composing = true;
    // 之前打好、還在等停手的字先送出（選字中計時器到期送出的話，畫面更新會覆蓋正在組的字）
    typing.flush();
  });
  area.addEventListener('compositionend', () => {
    composing = false;
    edited();
  });
  area.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (storyEnterBlocked(area.value, area.selectionStart ?? area.value.length, area.selectionEnd ?? area.value.length)) e.preventDefault();
  });
  area.addEventListener('blur', (e) => {
    // 焦點移到字型按鈕（打完字直接點字型）：先不送，按下去時打的字和字型合成一步；其他地方照舊馬上送
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (next && fonts.el.contains(next)) return;
    typing.flush();
  });

  const fonts = createFontPicker({
    label: S.story.fontLabel,
    sample: FONT_SAMPLE,
    onPick(next) {
      font = next;
      if (typing.pending() && cardId !== null) {
        // 打字中換字型：打的字和字型一起記成一步
        typing.push({ cardId, text: area.value, font: next });
        typing.flush();
      } else if (hasStory) {
        intents.editCard({ story: { font: next } }, 'commit');
      } else {
        // 還沒寫故事：先記著，寫了才一起送
        fonts.render(font, loadedFonts);
      }
    },
  });

  const offNote = h('div', { className: 'note story-off-note' }, [icon('info', 18), h('span', { text: STORY_STAGE_OFF_NOTE })]);
  offNote.hidden = true;

  const el = h('div', { className: 'field-group story-panel' }, [
    h('div', { className: 'group-title', text: S.story.title }),
    h('p', { className: 'help', text: STORY_HELP }),
    h('div', { className: 'field' }, [area, h('div', { className: 'story-meta' }, [count])]),
    h('div', { className: 'field' }, [h('div', { className: 'field-head' }, [h('span', { className: 'field-label', text: S.common.font })]), fonts.el]),
    offNote,
  ]);

  return {
    el,
    render(state) {
      const card = state.card;
      const switched = card.id !== cardId;
      if (switched) {
        typing.cancel();
        cardId = card.id;
      }
      const story = card.story;
      hasStory = story !== undefined;
      if (story) font = story.font;
      else if (switched) font = DEFAULT_STORY_FONT;
      loadedFonts = state.loadedFonts;

      // 換卡、或狀態的故事和文字框整理後不一樣（復原、重做）才換掉文字框；還在等著送的打字不蓋掉，
      // 整理後一樣（例如剛按了 Enter、結尾有空白）也不蓋，免得打到一半的字被吃掉
      const text = story?.text ?? '';
      if (switched || (!composing && !typing.pending() && (cleanStory(area.value) ?? '') !== text)) {
        if (area.value !== text) area.value = text;
      }
      paintCount();
      fonts.render(font, state.loadedFonts);
      setHidden(offNote, !(hasStory && card.view.stage === 'none'));
    },
  };
}
