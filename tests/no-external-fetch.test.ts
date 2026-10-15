// 防呆（T-605c，硬邊界 1）：程式不准對外發請求。同源網址也可能被伺服器轉址到外站（fetch 預設會跟著轉），
// 所以 src/ 裡每一個 fetch 呼叫都要帶「只准同源、轉址就失敗」的設定：
//   ‧ 共用常數 SAME_ORIGIN_FETCH（src/app/fetch.ts），或展開它（{ ...SAME_ORIGIN_FETCH, signal }）；
//   ‧ AI 的 Worker 自己的常數 SAME_ORIGIN（src/ai/worker.ts，定義另外核對）；
//   ‧ 或直接寫在呼叫裡的物件，同時有 mode: 'same-origin' 與 redirect: 'error'。
// 以後有人寫裸的 fetch(url)，這個測試就會失敗。也不准用 XMLHttpRequest、sendBeacon、WebSocket、EventSource。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAME_ORIGIN_FETCH } from '../src/app/fetch';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

/** 允許的「直接轉交」：把收到的 init 原封不動交給 fetch 的注入預設值（真正的呼叫處另外被掃到、要帶同源設定）。 */
const PASS_THROUGH: readonly { file: string; call: string; why: string }[] = [
  { file: 'src/ai/worker.ts', call: 'fetch(url, init)', why: 'Worker 的 deps.fetch 預設值；唯一的呼叫處 deps.fetch(url, SAME_ORIGIN)' },
];

/** 帶同源設定的常數名（定義要核對）。 */
const SAFE_CONSTANTS = ['SAME_ORIGIN_FETCH', 'SAME_ORIGIN'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [path] : [];
  });
}

/**
 * 同長度的「遮罩」文字：註解換成空白、字串與樣板字串的內容換成空白（引號留著），位置和原文一一對應。
 * 用遮罩找 fetch( 與配對括號（字串、註解裡的不算），再回原文讀參數。
 */
function mask(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let k = i + 1;
      while (k < source.length && source[k] !== c) k += source[k] === '\\' ? 2 : 1;
      blank(i + 1, k);
      i = k + 1;
    } else if (c === '/' && regexCanStart(source, i)) {
      // 正規表示式（例如 /["']/）：裡面的引號不能當成字串開頭
      let k = i + 1;
      let inClass = false;
      while (k < source.length && source[k] !== '\n' && (inClass || source[k] !== '/')) {
        if (source[k] === '\\') k++;
        else if (source[k] === '[') inClass = true;
        else if (source[k] === ']') inClass = false;
        k++;
      }
      blank(i + 1, k);
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** 這個 / 是正規表示式的開頭（前一個有意義的字元是運算子或括號、或 return 之類的關鍵字），不是除號。 */
function regexCanStart(source: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && /\s/.test(source[k]!)) k--;
  if (k < 0) return true;
  if ('(,=:[!&|?{};+-*%<>~^'.includes(source[k]!)) return true;
  const word = /([A-Za-z_$]+)$/.exec(source.slice(Math.max(0, k - 10), k + 1))?.[1];
  return word === 'return' || word === 'typeof' || word === 'case' || word === 'of' || word === 'in';
}

/** 從 open（左括號的位置）找配對的右括號，回傳最上層用逗號分開的參數（原文）。 */
function callArgs(source: string, masked: string, open: number): { text: string; args: string[] } {
  let depth = 0;
  let start = open + 1;
  const args: string[] = [];
  for (let k = open; k < masked.length; k++) {
    const c = masked[k];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        args.push(source.slice(start, k).trim());
        return { text: source.slice(open, k + 1), args: args.filter((a) => a !== '') };
      }
    } else if (c === ',' && depth === 1) {
      args.push(source.slice(start, k).trim());
      start = k + 1;
    }
  }
  throw new Error('括號沒有配對');
}

function initIsSafe(init: string | undefined): boolean {
  if (init === undefined) return false;
  if (SAFE_CONSTANTS.includes(init)) return true;
  if (!init.startsWith('{')) return false;
  if (SAFE_CONSTANTS.some((name) => new RegExp(`\\.\\.\\.${name}\\b`).test(init))) return true;
  return /mode:\s*'same-origin'/.test(init) && /redirect:\s*'error'/.test(init);
}

interface FetchCall {
  file: string;
  line: number;
  call: string;
  init: string | undefined;
}

function fetchCalls(): FetchCall[] {
  const calls: FetchCall[] = [];
  for (const path of sourceFiles(SRC)) {
    const source = readFileSync(path, 'utf8');
    const masked = mask(source);
    const file = relative(ROOT, path).replaceAll('\\', '/');
    for (const match of masked.matchAll(/\bfetch\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      const { text, args } = callArgs(source, masked, open);
      calls.push({ file, line: source.slice(0, match.index).split('\n').length, call: `fetch${text}`, init: args[1] });
    }
  }
  return calls;
}

describe('程式不對外發請求（硬邊界 1，T-605c）', () => {
  it('共用常數 SAME_ORIGIN_FETCH：只准同源、轉址就失敗、只帶同源的 cookie；不能被改', () => {
    expect(SAME_ORIGIN_FETCH).toEqual({ mode: 'same-origin', redirect: 'error', credentials: 'same-origin' });
    expect(Object.isFrozen(SAME_ORIGIN_FETCH)).toBe(true);
  });

  it('AI Worker 自己的 SAME_ORIGIN 常數也是同源＋轉址就失敗', () => {
    const source = readFileSync(join(SRC, 'ai', 'worker.ts'), 'utf8');
    const definition = /const SAME_ORIGIN\b[^=]*=\s*(\{[^}]*\})/.exec(source)?.[1];
    expect(definition).toBeDefined();
    expect(initIsSafe(definition)).toBe(true);
  });

  it('src/ 裡每一個 fetch 呼叫都帶同源＋不跟轉址的設定（共用常數、展開它、或寫明 mode／redirect）', () => {
    const calls = fetchCalls();
    // 至少掃到範例卡與 AI 的呼叫（掃描本身壞掉、什麼都沒找到時不能算過）
    expect(calls.some((c) => c.file === 'src/app/samples.ts')).toBe(true);
    expect(calls.some((c) => c.file.startsWith('src/ai/'))).toBe(true);
    const bad = calls.filter((c) => !initIsSafe(c.init) && !PASS_THROUGH.some((p) => p.file === c.file && p.call === c.call));
    expect(bad.map((c) => `${c.file}:${c.line} ${c.call}`)).toEqual([]);
  });

  it('允許直接轉交的那幾處還在（不在了就把清單刪掉，不要留著當後門）', () => {
    const calls = fetchCalls();
    for (const p of PASS_THROUGH) expect(calls.some((c) => c.file === p.file && c.call === p.call), `${p.file} ${p.call}（${p.why}）`).toBe(true);
  });

  it('不用其他會連網的 API（XMLHttpRequest、sendBeacon、WebSocket、EventSource）', () => {
    const found: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const masked = mask(readFileSync(path, 'utf8'));
      for (const api of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) {
        if (new RegExp(`\\b${api}\\b`).test(masked)) found.push(`${relative(ROOT, path)} ${api}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('掃描本身：裸的 fetch(url)、只帶 method 的不算；註解與字串裡的 fetch( 不算', () => {
    const source = [
      "// fetch(url) 註解不算",
      "const a = 'fetch(url)';",
      'await fetch(url);',
      "await fetch(url, { method: 'HEAD' });",
      "await fetch(url, { ...SAME_ORIGIN_FETCH, signal });",
      "await deps.fetch(url, SAME_ORIGIN);",
    ].join('\n');
    const masked = mask(source);
    const inits = [...masked.matchAll(/\bfetch\s*\(/g)].map((m) => callArgs(source, masked, m.index + m[0].length - 1).args[1]);
    expect(inits.map(initIsSafe)).toEqual([false, false, true, true]);
  });
});
