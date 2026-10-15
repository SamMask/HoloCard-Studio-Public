import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardView } from '../src/render/card-view';

const shared = vi.hoisted(() => ({ options: [] as unknown[], initError: new Error('stop after renderer construction') }));

vi.mock('three/webgpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three/webgpu')>()),
  WebGPURenderer: function (options: unknown) {
    shared.options.push(options);
    return {
      init: async () => { throw shared.initError; },
      domElement: { remove() {} },
      dispose() {},
    };
  },
}));

afterEach(() => { shared.options.length = 0; });

describe('T-847 renderer 後端選項', () => {
  it.each([undefined, false, true])('forceWebGL=%s 原樣傳給 WebGPURenderer', async (forceWebGL) => {
    const deps = { plainBack: {} as HTMLImageElement, pedestal: {} as HTMLImageElement, frameCorner: null, forceWebGL };
    // 在 init 中止，這裡只驗證真正的 renderer 建構參數，不需要 GPU 或場景替身。
    await expect(createCardView({} as HTMLElement, deps)).rejects.toBe(shared.initError);
    expect(shared.options).toEqual([{ antialias: true, forceWebGL }]);
  });
});

// 隔離執行 main 真正的 createCardView 呼叫：不複製開關公式，也不啟動存檔、AI 或 DOM。
const main = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const calls: ts.CallExpression[] = [];
function findCalls(node: ts.Node): void {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createCardView') calls.push(node);
  ts.forEachChild(node, findCalls);
}
findCalls(main);

describe('T-847 main 的開發用 WebGL2 開關', () => {
  it.each([
    { dev: true, search: '?webgl', expected: true },
    { dev: true, search: '?webgl&nodownload', expected: true },
    { dev: true, search: '', expected: false },
    { dev: true, search: '?nodownload', expected: false },
    { dev: true, search: '?webgl2', expected: false },
    { dev: false, search: '?webgl', expected: false },
    { dev: false, search: '', expected: false },
  ])('DEV=$dev、網址 $search → forceWebGL=$expected', ({ dev, search, expected }) => {
    expect(calls).toHaveLength(1);
    const call = calls[0]!.getText(main).replaceAll('import.meta.env.DEV', 'dev');
    const create = vi.fn();
    const plainBack = {};
    const pedestal = {};
    const frameCorner = {};
    const ui = { previewHost: {} };
    const location = { search };
    const run = new Function('dev', 'window', 'location', 'createCardView', 'ui', 'plainBack', 'pedestal', 'frameCorner', `return ${call};`);
    run(dev, { location }, location, create, ui, plainBack, pedestal, frameCorner);
    expect(create).toHaveBeenCalledExactlyOnceWith(ui.previewHost, { plainBack, pedestal, frameCorner, forceWebGL: expected });
  });
});
