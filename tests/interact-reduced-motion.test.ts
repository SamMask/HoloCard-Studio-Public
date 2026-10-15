// 減少動態效果（T-608，DESIGN §8.3）的轉卡數學：回正、翻面直接到位；調深度不自動擺；展示擺動預設關、使用者打開就照擺。
// main 每影格用 MediaQueryList 的 matches（設定一改就跟著變）呼叫這些函式；舞台、取景、閃星在 render-reduced-motion.test.ts。
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SAMPLE_FILES } from '../src/app/samples';
import {
  beginDrag,
  depthWiggle,
  dragBy,
  endDrag,
  initialShowcase,
  initialView,
  stepShowcase,
  tick,
  turnToFace,
  WIGGLE_FADE_SEC,
  type ShowcaseInput,
  type ViewState,
} from '../src/interact/view';
import { newCard } from '../src/model/create';

const FRAME = 1 / 60;

describe('回正、翻面：減少動態時直接到位（一格就到，不經過動畫）', () => {
  const dragged = (): ViewState => dragBy(beginDrag(initialView()), 200, 60); // yaw 70°、pitch 21°

  it('滑鼠放開後回正：下一格就停在最近的一面、pitch 0、不再動', () => {
    const released = endDrag(dragged());
    const next = tick(released, FRAME, true);
    expect(next.mode).toBe('idle');
    expect(next.yaw).toBe(0);
    expect(next.pitch).toBe(0);
    expect(next.yawVel).toBe(0);
    expect(next.pitchVel).toBe(0);
    // 沒設減少動態：照舊是一格一格轉回去
    const smooth = tick(released, FRAME, false);
    expect(smooth.mode).toBe('returning');
    expect(smooth.yaw).toBeGreaterThan(0);
  });

  it('點〔背面〕〔正面〕翻面（turnToFace）：下一格就到那一面', () => {
    const toBack = turnToFace(initialView(), 'back');
    const back = tick(toBack, FRAME, true);
    expect(back.mode).toBe('idle');
    expect(back.yaw).toBe(180);
    const front = tick(turnToFace(back, 'front'), FRAME, true);
    expect(front.mode).toBe('idle');
    expect(front.yaw % 360).toBe(0); // 最近的正面（0° 或 360°）
    expect(front.pitch).toBe(0);
  });

  it('轉到一半才打開減少動態：下一格就直接停到目標（設定改了立刻跟著變）', () => {
    let s = endDrag(dragged());
    for (let i = 0; i < 5; i++) s = tick(s, FRAME, false);
    expect(s.mode).toBe('returning');
    s = tick(s, FRAME, true);
    expect(s).toMatchObject({ mode: 'idle', yaw: 0, pitch: 0 });
  });

  it('拖曳中、停著的：不受影響（原樣回傳）', () => {
    const dragging = dragged();
    expect(tick(dragging, FRAME, true)).toBe(dragging);
    const idle = initialView();
    expect(tick(idle, FRAME, true)).toBe(idle);
  });
});

describe('調深度時不自動小幅擺動', () => {
  it('減少動態：任何時間都是 0', () => {
    for (let t = 0; t < WIGGLE_FADE_SEC; t += 0.05) {
      expect(depthWiggle(t, 0, true)).toBe(0);
      expect(depthWiggle(t + 0.3, t / 2, true)).toBe(0);
    }
  });

  it('沒設減少動態：照舊會擺（對照）', () => {
    expect(Math.abs(depthWiggle(0.3, 0, false))).toBeGreaterThan(1);
    expect(Math.abs(depthWiggle(0.3, 0))).toBeGreaterThan(1);
  });
});

describe('展示擺動：預設關，使用者自己打開就照擺', () => {
  it('新卡片預設關', () => {
    expect(newCard('standard', 'id', '2026-10-14T00:00:00.000Z').view.showcase).toBe(false);
    expect(newCard('tarot', 'id', '2026-10-14T00:00:00.000Z').view.showcase).toBe(false);
  });

  it('隨工坊附上的範例卡都是關的（第一次打開工坊不會自己擺）', () => {
    for (const file of SAMPLE_FILES) {
      const bytes = new Uint8Array(readFileSync(new URL(`../public/samples/${file}`, import.meta.url)));
      const card = JSON.parse(strFromU8(unzipSync(bytes)['card.json']!)) as { view: { showcase: boolean } };
      expect(card.view.showcase, file).toBe(false);
    }
  });

  const input = (enabled: boolean): ShowcaseInput => ({ enabled, layerSelected: false, depthWiggling: false });
  const run = (enabled: boolean, seconds: number) => {
    let sc = initialShowcase();
    let view = initialView();
    for (let t = 0; t < seconds; t += FRAME) ({ showcase: sc, view } = stepShowcase(sc, view, input(enabled), FRAME));
    return view;
  };

  it('開關關著：卡片不動', () => {
    expect(run(false, 5)).toMatchObject({ yaw: 0, pitch: 0 });
  });

  it('使用者自己打開（減少動態時也一樣）：照擺（尊重使用者的選擇）', () => {
    const v = run(true, 3);
    expect(Math.abs(v.yaw) + Math.abs(v.pitch)).toBeGreaterThan(1);
  });
});
