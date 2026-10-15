import type { EncodeGif } from './types';
import type { GifWorkerRequest, GifWorkerResponse } from './gif-worker';

export const encodeGif: EncodeGif = (frames, options, onProgress, signal) => new Promise<Blob>((resolve, reject) => {
  let worker: Worker | undefined;
  let settled = false;
  const cleanup = () => {
    settled = true;
    signal?.removeEventListener('abort', abort);
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  const fail = (error: unknown) => {
    if (settled) return;
    cleanup();
    reject(error instanceof Error ? error : new Error(String(error)));
  };
  const abort = () => fail(new DOMException('Aborted', 'AbortError'));
  if (signal?.aborted) { abort(); return; }
  try {
    signal?.addEventListener('abort', abort, { once: true });
    worker = new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<GifWorkerResponse>) => {
      if (settled) return;
      try {
        switch (data.type) {
          case 'progress':
            onProgress?.(data.done, data.total);
            break;
          case 'result': {
            const blob = new Blob([data.bytes], { type: 'image/gif' });
            cleanup();
            resolve(blob);
            break;
          }
          case 'error':
            fail(new Error(data.message));
            break;
        }
      } catch (error) { fail(error); }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'GIF Worker failed'));
    };
    worker.onmessageerror = () => fail(new Error('GIF Worker message could not be decoded'));
    // Transfer independent, exact-sized buffers. The readonly input contract does
    // not grant ownership: callers may reuse frames for WebM or a later export.
    const buffers = frames.map((frame) => frame.slice().buffer);
    const request: GifWorkerRequest = { frames: buffers, options: { ...options } };
    worker.postMessage(request, buffers);
  } catch (error) { fail(error); }
});
