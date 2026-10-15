// T-848: exercise the real main.ts upload queue with fake browser, storage and AI boundaries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCard } from '../src/model/create';
import type { UiIntents, UiState } from '../src/ui/types';

const shared = vi.hoisted(() => ({
  intents: null as UiIntents | null,
  state: null as UiState | null,
  ready: false,
  models: { matte: false, depth: false } as { matte: boolean | undefined; depth: boolean | undefined },
  checked: 0,
  ingested: 0,
  hasAlpha: false,
  errors: [] as unknown[],
}));
const quiet = <T extends object>(known: T): T => new Proxy(known, {
  get: (target, key) => key in target ? (target as Record<PropertyKey, unknown>)[key] : key === 'then' ? undefined : () => undefined,
});
const fakeHost = () => quiet({ addEventListener() {}, append() {}, style: {}, clientWidth: 800, clientHeight: 500 });
vi.mock('../src/ui/app', () => ({ createUi: (_root: unknown, intents: UiIntents) => {
  shared.intents = intents;
  return quiet({ previewHost: fakeHost(), overlayHost: fakeHost(), render: (state: UiState) => { shared.state = state; } });
} }));
vi.mock('../src/ui/overlay', () => ({ createOverlay: () => quiet({}) }));
vi.mock('../src/render/read-image', () => ({ readImage: async () => ({ naturalWidth: 8, naturalHeight: 8 }) }));
vi.mock('../src/render/card-view', async (original) => ({
  ...(await original<typeof import('../src/render/card-view')>()),
  createCardView: async () => quiet({ start: () => { shared.ready = true; } }),
}));
vi.mock('../src/images/registry', () => ({ createImageRegistry: () => quiet({}) }));
vi.mock('../src/images/ingest', () => ({ ingestFile: async () => {
  shared.ingested++;
  return { ok: true, name: 'upload', image: {
    hash: shared.ingested.toString(16).padStart(16, '0'), blob: new Blob(), type: 'image/webp',
    width: 64, height: 96, hasAlpha: shared.hasAlpha,
  } };
} }));
vi.mock('../src/app/ai-cutout', async (original) => ({ ...(await original<typeof import('../src/app/ai-cutout')>()), createCutout: () => quiet({
  checkModels: async () => { shared.checked++; return shared.models; },
  view: () => ({ busy: false, ask: null }),
}) }));
vi.mock('../src/app/session', () => ({ createSession: (deps: { show(card: unknown): void }) => quiet({
  chooseStart: async () => ({ card: newCard('standard', 'upload-card', '2026-10-15T00:00:00.000Z'), thumbnail: null }),
  openStart: async (card: unknown) => deps.show(card), saver: quiet({}),
}) }));
vi.mock('../src/app/tab-lock', () => ({
  browserLocks: () => ({}), browserChannel: () => ({}),
  createTabLock: () => quiet({ acquire: async () => {}, holding: () => true }), guardWrites: (store: unknown) => store,
}));
vi.mock('../src/storage/store', () => ({ openCardStore: async () => ({}) }));
vi.mock('../src/app/samples', async (original) => ({ ...(await original<typeof import('../src/app/samples')>()), addNewSamples: async () => [] }));
vi.mock('../src/interact/pointer', () => ({ attachPointer: () => {} }));
vi.mock('../src/interact/keys', () => ({ attachPreviewKeys: () => quiet({}) }));
vi.mock('../src/ai/runner', () => ({ createAiRunner: () => quiet({}) }));

beforeEach(async () => {
  vi.resetModules();
  Object.assign(shared, { intents: null, state: null, ready: false, models: { matte: false, depth: false }, checked: 0, ingested: 0, hasAlpha: false, errors: [] });
  vi.stubGlobal('window', { navigator: { languages: ['zh-Hant'] }, location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), devicePixelRatio: 1 });
  vi.stubGlobal('document', quiet({ getElementById: () => fakeHost(), addEventListener() {}, hidden: false, visibilityState: 'visible', body: quiet({}) }));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { shared.errors.push(args); });
  await import('../src/main');
  await vi.waitFor(() => expect(shared.ready).toBe(true));
  expect(shared.errors).toEqual([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function upload() {
  const checked = shared.checked;
  const ingested = shared.ingested;
  shared.intents!.uploadFiles([new File(['image'], 'picture.jpg', { type: 'image/jpeg' })]);
  await vi.waitFor(() => {
    expect(shared.ingested).toBe(ingested + 1);
    if (!shared.hasAlpha) expect(shared.checked).toBe(checked + 1);
    expect(shared.state!.pendingReplaceBase !== null || shared.state!.card[shared.state!.face].layers.length > 0).toBe(true);
  });
  expect(shared.errors).toEqual([]);
}

describe('T-848 不透明圖上傳', () => {
  it('沒底圖且兩個模型都不在：直接加底圖、提示、一步復原與重做', async () => {
    await upload();
    expect(shared.state!.pendingReplaceBase).toBeNull();
    expect(shared.state!.card.front.layers).toMatchObject([{ role: 'base', depth: 0 }]);
    expect(shared.state!.message).toEqual({ kind: 'info', text: '當成底圖了。' });
    shared.intents!.undo();
    expect(shared.state!.card.front.layers).toEqual([]);
    expect(shared.state!.canUndo).toBe(false);
    shared.intents!.redo();
    expect(shared.state!.card.front.layers).toHaveLength(1);
  });
  it.each([{ matte: true, depth: false }, { matte: false, depth: true }, { matte: true, depth: true }, { matte: undefined, depth: false }, { matte: false, depth: undefined }])('沒底圖，模型狀態 %j：照舊問', async (models) => {
    shared.models = models;
    await upload();
    expect(shared.state!.pendingReplaceBase).not.toBeNull();
    expect(shared.state!.card.front.layers).toEqual([]);
    expect(shared.state!.canUndo).toBe(false);
  });
  it('有底圖且兩個模型都不在：照舊問要不要取代', async () => {
    await upload();
    const base = shared.state!.card.front.layers[0];
    await upload();
    expect(shared.state!.pendingReplaceBase).toMatchObject({ hasBase: true });
    expect(shared.state!.card.front.layers).toEqual([base]);
  });
  it('正面有底圖、背面沒有：背面直接加，不影響正面', async () => {
    await upload();
    const front = shared.state!.card.front;
    shared.intents!.selectFace('back');
    await upload();
    expect(shared.state!.pendingReplaceBase).toBeNull();
    expect(shared.state!.card.front).toEqual(front);
    expect(shared.state!.card.back.layers).toMatchObject([{ role: 'base' }]);
  });
  it('透明圖照舊加成立體層、不查模型', async () => {
    shared.hasAlpha = true;
    await upload();
    expect(shared.checked).toBe(0);
    expect(shared.state!.pendingReplaceBase).toBeNull();
    expect(shared.state!.card.front.layers).toMatchObject([{ role: 'depth' }]);
  });
  it('沒有底圖但已滿八層：不加入、不顯示成功提示', async () => {
    shared.hasAlpha = true;
    for (let i = 0; i < 8; i++) await upload();
    const card = shared.state!.card;
    shared.hasAlpha = false;
    await upload();
    expect(shared.state!.card).toBe(card);
    expect(shared.state!.pendingReplaceBase).toBeNull();
    expect(shared.state!.message).toEqual({ kind: 'error', text: '每一面最多 8 層。' });
  });
});
