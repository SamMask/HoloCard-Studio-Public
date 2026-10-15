import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The development script is deliberately plain JavaScript with no build step.
// @ts-expect-error No declaration file for the standalone .mjs script.
import { downloadModel, run, verifyFile } from '../../scripts/fetch-models.mjs';

const payload = Buffer.from('local test model');
const sha256 = createHash('sha256').update(payload).digest('hex');
const runtimeFiles = ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs'];
let root: string;
let server: Server;
let origin: string;
let requests: string[];
const realFetch = globalThis.fetch;

function model(overrides = {}) {
  return {
    name: 'test-model', label: '測試模型', url: `${origin}/model`,
    source: 'https://example.invalid/model-card', license: 'Apache-2.0',
    size: payload.length, sha256, file: 'test-model.onnx', ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'holocard-fetch-'));
  requests = [];
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/model' });
      res.end();
    } else if (req.url === '/error') {
      res.writeHead(503);
      res.end('unavailable');
    } else {
      res.end(payload);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local server address');
  origin = `http://127.0.0.1:${address.port}`;
  // Reject accidental external requests before they can reach the network.
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    if (new URL(String(input)).origin !== origin) throw new Error('測試禁止連外');
    return realFetch(input, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
});

async function installRuntime() {
  const dir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
  await mkdir(dir, { recursive: true });
  for (const file of runtimeFiles) await writeFile(join(dir, file), `local-${file}`);
}

describe('fetch-models development script', () => {
  it('skips an existing file only when size and hash match', async () => {
    const target = join(root, 'model.onnx');
    await writeFile(target, payload);
    expect(await verifyFile(target, payload.length, sha256)).toBe(true);
    expect(await downloadModel(model(), target, () => {})).toBe('skipped');
    expect(requests).toEqual([]);
  });

  it('removes .part on hash mismatch and preserves the previous target', async () => {
    const target = join(root, 'model.onnx');
    await writeFile(target, 'previous');
    await expect(downloadModel(model({ sha256: '0'.repeat(64) }), target, () => {})).rejects.toThrow('雜湊');
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(target, 'utf8')).toBe('previous');
  });

  it('replaces an existing same-size file when its hash is incorrect', async () => {
    const target = join(root, 'model.onnx');
    await writeFile(target, Buffer.alloc(payload.length));
    expect(await verifyFile(target, payload.length, sha256)).toBe(false);
    expect(await downloadModel(model(), target, () => {})).toBe('downloaded');
    expect(await readFile(target)).toEqual(payload);
    expect(requests).toEqual(['/model']);
  });

  it('follows a local 302 redirect and renames the verified file', async () => {
    const target = join(root, 'model.onnx');
    expect(await downloadModel(model({ url: `${origin}/redirect` }), target, () => {})).toBe('downloaded');
    expect(requests).toEqual(['/redirect', '/model']);
    expect(await readFile(target)).toEqual(payload);
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects incorrect size and cleans up .part', async () => {
    const target = join(root, 'model.onnx');
    await expect(downloadModel(model({ size: payload.length + 1 }), target, () => {})).rejects.toThrow('大小');
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects excess bytes without promoting the partial file', async () => {
    const target = join(root, 'model.onnx');
    await expect(downloadModel(model({ size: payload.length - 1 }), target, () => {})).rejects.toThrow('大小');
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('--check lists missing models and runtime without downloading or writing', async () => {
    const log = vi.fn();
    expect(await run(['--check'], { root, models: [model(), model({ name: 'second', file: 'second.onnx' })], log })).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('請先 npm install');
    expect(log.mock.calls.flat().join('\n')).toContain('second.onnx');
    expect(requests).toEqual([]);
    await expect(stat(join(root, 'public'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a nonzero result when download validation fails', async () => {
    expect(await run([], { root, models: [model({ sha256: '0'.repeat(64) })], log: () => {} })).toBe(1);
    await expect(stat(join(root, 'public/models/test-model.onnx.part'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('--only downloads one model, copies local runtime, and records provenance', async () => {
    await installRuntime();
    expect(await run(['--only=test-model'], { root, models: [model(), model({ name: 'second', file: 'second.onnx' })], log: () => {} })).toBe(0);
    expect(requests).toEqual(['/model']);
    await expect(stat(join(root, 'public/models/second.onnx'))).rejects.toMatchObject({ code: 'ENOENT' });
    const readme = await readFile(join(root, 'public/models/README.md'), 'utf8');
    expect(readme).toContain(sha256);
    expect(readme).toContain('Apache-2.0');
    expect(readme).toContain('https://example.invalid/model-card');
    expect(readme).toMatch(/下載日期：\d{4}-\d{2}-\d{2}/);
    for (const file of runtimeFiles) expect(await readFile(join(root, 'public/ort', file), 'utf8')).toBe(`local-${file}`);
    const before = await stat(join(root, 'public/ort', runtimeFiles[0]!));
    expect(await run([], { root, models: [model()], log: () => {} })).toBe(0);
    expect((await stat(join(root, 'public/ort', runtimeFiles[0]!))).mtimeMs).toBe(before.mtimeMs);
    expect(requests).toEqual(['/model']);
    expect(await run(['--check'], { root, models: [model()], log: () => {} })).toBe(0);
  });

  it('rejects unknown arguments or model names without network activity', async () => {
    for (const args of [['--unknown'], ['--only=missing'], ['--only=']]) {
      expect(await run(args, { root, models: [model()], log: () => {} })).toBe(1);
    }
    expect(requests).toEqual([]);
  });

  it('cleans up partial files on HTTP failures', async () => {
    const target = join(root, 'model.onnx');
    await writeFile(`${target}.part`, 'stale');
    await expect(downloadModel(model({ url: `${origin}/error` }), target, () => {})).rejects.toThrow('503');
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports connection failures in plain Chinese and cleans stale partial files', async () => {
    const target = join(root, 'model.onnx');
    await writeFile(`${target}.part`, 'stale');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(downloadModel(model(), target, () => {})).rejects.toThrow('連線');
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
