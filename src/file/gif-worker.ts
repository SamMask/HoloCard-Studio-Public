import { encodeGifFrames } from './gif-encode';
import type { GifOptions } from './types';

export interface GifWorkerRequest {
  frames: ArrayBuffer[];
  options: GifOptions;
}

export type GifWorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

// The project includes DOM lib, not WebWorker lib. Describe only the Worker APIs
// used here, avoiding conflicting Window/Worker ambient declarations.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GifWorkerRequest>) => void) | null;
  postMessage(message: GifWorkerResponse, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data }) => {
  try {
    const frames = data.frames.map((buffer) => new Uint8ClampedArray(buffer));
    const bytes = encodeGifFrames(frames, data.options, (done, total) => {
      scope.postMessage({ type: 'progress', done, total });
    });
    scope.postMessage({ type: 'result', bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
