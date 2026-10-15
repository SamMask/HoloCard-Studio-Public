// 素材圖的讀取（T-416b）：同源 fetch 取 Blob 再解碼（Image.src 會跟著伺服器轉址，連到別的主機）。
// main 把 fetch 帶 SAME_ORIGIN_FETCH 交給 readImage（轉址就失敗）；render 不寫死素材檔名、不自己讀圖（素材由 main 注入）。
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAME_ORIGIN_FETCH } from '../src/app/fetch';
import { readImage } from '../src/render/read-image';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

/** 假的 Image：記下 src，decode 依 fail 成功或失敗。 */
function fakeImages(fail = false) {
  const made: { src: string }[] = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      constructor() {
        made.push(this);
      }
      decode() {
        return fail ? Promise.reject(new Error('decode failed')) : Promise.resolve();
      }
    },
  );
  const revoked: string[] = [];
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake/${++n}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u));
  return { made, revoked };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readImage：同源讀圖', () => {
  it('同源網址被轉址到別的主機 → 讀取失敗，別的主機一次都沒被連到（真的 fetch＋SAME_ORIGIN_FETCH、兩台本機伺服器）', async () => {
    const outside: string[] = [];
    const elsewhere = createServer((req, res) => {
      outside.push(req.url ?? '');
      res.end('should never be reached');
    });
    const elsewherePort = await listen(elsewhere);
    const workshop = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://localhost:${elsewherePort}/evil.webp` });
      res.end();
    });
    const port = await listen(workshop);
    try {
      const read = (url: string) => fetch(url, SAME_ORIGIN_FETCH);
      await expect(readImage(read, `http://127.0.0.1:${port}/textures/frame-corner.webp`)).rejects.toThrow();
      expect(outside).toEqual([]);
    } finally {
      workshop.close();
      elsewhere.close();
    }
  });

  it('HTTP 不是 2xx → 丟錯（訊息帶網址）', async () => {
    const read = async () => new Response('not found', { status: 404 });
    await expect(readImage(read, '/textures/frame-corner.webp')).rejects.toThrow(/frame-corner\.webp/);
  });

  it('讀到了：用讀到的內容（blob 網址）解碼，不是把原本的網址交給 Image', async () => {
    const { made } = fakeImages();
    const calls: string[] = [];
    const read = async (url: string) => {
      calls.push(url);
      return new Response(new Uint8Array([1, 2, 3]));
    };
    const img = await readImage(read, '/textures/frame-corner.webp');
    expect(calls).toEqual(['/textures/frame-corner.webp']);
    expect(made).toHaveLength(1);
    expect(img).toBe(made[0]);
    expect(made[0]!.src).toMatch(/^blob:/);
  });

  it('解碼失敗 → 丟錯，blob 網址收回', async () => {
    const { made, revoked } = fakeImages(true);
    const read = async () => new Response(new Uint8Array([1, 2, 3]));
    await expect(readImage(read, '/textures/frame-corner.webp')).rejects.toThrow();
    expect(revoked).toEqual([made[0]!.src]);
  });
});

describe('素材由 main 注入（render 不寫死檔名、不自己讀圖）', () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  /** 拿掉註解（只看程式碼）。 */
  const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('card-view 沒有素材檔名、不建 Image、不讀檔', () => {
    const cv = code('render/card-view.ts');
    expect(cv).not.toMatch(/textures\//);
    expect(cv).not.toMatch(/new Image\(/);
    expect(cv).not.toMatch(/\bfetch\s*\(/);
  });

  it('main 讀素材圖不用 Image.src（會跟著轉址）：一律經 readImage＋同源 fetch；三張素材都在這裡讀', () => {
    const main = code('main.ts');
    expect(main).not.toMatch(/new Image\(/);
    expect(main).toMatch(/readImage\(/);
    for (const file of ['textures/plain-back.webp', 'brand/pedestal.webp', 'textures/frame-corner.webp']) expect(main).toContain(file);
  });
});
