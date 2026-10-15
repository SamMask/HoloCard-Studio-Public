// 開發端手動下載；工坊執行時不匯入、不執行這個腳本。
export const MODELS = [
  {
    name: 'isnet-anime', label: '去背', file: 'isnet-anime.onnx',
    url: 'https://huggingface.co/skytnt/anime-seg/resolve/493cb60893f47441b26ec4fb9a306bce9e342982/isnetis.onnx',
    source: 'https://huggingface.co/skytnt/anime-seg', license: 'Apache-2.0',
    size: 176069933,
    sha256: 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99',
  },
  {
    name: 'depth-anything-v2-small', label: '深度', file: 'depth-anything-v2-small.onnx',
    url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx',
    source: 'https://huggingface.co/onnx-community/depth-anything-v2-small', license: 'Apache-2.0',
    size: 99060839,
    sha256: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c',
  },
];

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// T-702：用 onnxruntime-web/webgpu（新的 WebGPU 後端），它讀的是 asyncify 版的 wasm／mjs。
const RUNTIME_FILES = ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs'];

async function fileStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyFile(file, size, sha256) {
  const info = await fileStat(file);
  return Boolean(info?.isFile() && info.size === size && await fileHash(file) === sha256);
}

export async function needsDownload(file, size, sha256) {
  return !await verifyFile(file, size, sha256);
}

export async function downloadModel(model, target, log = console.log) {
  if (!await needsDownload(target, model.size, model.sha256)) {
    log(`${model.label}：${model.file} 大小與雜湊正確，跳過。`);
    return 'skipped';
  }

  const partial = `${target}.part`;
  let handle;
  let response;
  try {
    await mkdir(dirname(target), { recursive: true });
    log(`${model.label}：開始下載 ${model.file}。`);
    response = await fetch(model.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`下載失敗（HTTP ${response.status}），請稍後再試。`);
    handle = await open(partial, 'w');
    let received = 0;
    let lastPercent = 0;
    let lastBytes = 0;
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > model.size) throw new Error('檔案大小不符，已取消下載；請確認模型來源。');
      await handle.writeFile(chunk);
      const percent = Math.floor(received / model.size * 100);
      if (percent >= lastPercent + 5 || received - lastBytes >= 10_000_000 || received === model.size) {
        log(`${model.label}：已下載 ${percent}%（${received} / ${model.size} 位元組）。`);
        lastPercent = Math.floor(percent / 5) * 5;
        lastBytes = received;
      }
    }
    await handle.close();
    handle = undefined;
    if (received !== model.size) throw new Error('檔案大小不符，下載可能不完整；請重試。');
    if (!await verifyFile(partial, model.size, model.sha256)) {
      throw new Error('檔案雜湊不符，內容與指定版本不同；請確認模型來源。');
    }
    await rename(partial, target);
    log(`${model.label}：下載完成，大小與雜湊驗證通過。`);
    return 'downloaded';
  } catch (error) {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    if (handle) await handle.close();
    await rm(partial, { force: true });
    if (error instanceof TypeError) {
      throw new Error('下載連線失敗或中斷，請檢查網路後重試。', { cause: error });
    }
    throw error;
  }
}

function parseArgs(args, models) {
  let check = false;
  let only;
  for (const arg of args) {
    if (arg === '--check') check = true;
    else if (arg.startsWith('--only=') && only === undefined) only = arg.slice('--only='.length);
    else throw new Error(`不認得參數「${arg}」。請使用 --check 或 --only=<名稱>。`);
  }
  if (only !== undefined && !models.some((model) => model.name === only)) {
    throw new Error(`不認得模型名稱「${only}」。可用名稱：${models.map((model) => model.name).join('、')}。`);
  }
  return { check, selected: only === undefined ? models : models.filter((model) => model.name === only) };
}

async function syncRuntime(root, check, log) {
  let valid = true;
  for (const file of RUNTIME_FILES) {
    const source = join(root, 'node_modules', 'onnxruntime-web', 'dist', file);
    const target = join(root, 'public', 'ort', file);
    const sourceInfo = await fileStat(source);
    if (!sourceInfo?.isFile()) {
      log(`缺少 onnxruntime-web/dist/${file}，請先 npm install。`);
      valid = false;
      continue;
    }
    const targetInfo = await fileStat(target);
    if (targetInfo?.isFile() && targetInfo.size === sourceInfo.size) {
      log(`執行檔：${file} 大小相同，跳過。`);
    } else if (check) {
      log(`缺少或大小不符：public/ort/${file}。請執行 npm run fetch-models。`);
      valid = false;
    } else {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      log(`執行檔：已複製 ${file}。`);
    }
  }
  return valid;
}

async function writeReadme(root, models, verified) {
  const lines = ['# 本機 AI 模型', '', '這個資料夾不進 git。模型只由開發端手動下載，工坊執行時不連外。', '',
    '取得方式：`npm run fetch-models`；檢查：`npm run fetch-models -- --check`。', '',
    '下載日期採 UTC，使用驗證通過檔案的最後修改日期；跳過既有檔案時保留原日期。', ''];
  for (const model of models) {
    const file = join(root, 'public', 'models', model.file);
    const valid = verified.has(model.name) || await verifyFile(file, model.size, model.sha256);
    const date = valid ? (await stat(file)).mtime.toISOString().slice(0, 10) : '尚未下載或驗證未通過';
    lines.push(`## ${model.label}（${model.file}）`, '', `- 名稱：${model.name}`,
      `- 出處：[模型卡](${model.source})`, `- 下載網址：${model.url}`, `- 授權：${model.license}`,
      `- 大小：${model.size} bytes`, `- SHA-256：\`${model.sha256}\``, `- 下載日期：${date}`, '');
  }
  await writeFile(join(root, 'public', 'models', 'README.md'), `${lines.join('\n')}\n`, 'utf8');
}

export async function run(args = [], options = {}) {
  const { models = MODELS, log = console.log } = options;
  try {
    const { check, selected } = parseArgs(args, models);
    const root = options.root ?? await realpath(new URL('../', import.meta.url));
    const verified = new Set();
    let valid = true;
    for (const model of selected) {
      const target = join(root, 'public', 'models', model.file);
      if (check) {
        if (await verifyFile(target, model.size, model.sha256)) log(`${model.label}：${model.file} 大小與雜湊正確。`);
        else {
          log(`缺少或驗證未通過：public/models/${model.file}。請執行 npm run fetch-models。`);
          valid = false;
        }
      } else {
        await downloadModel(model, target, log);
        verified.add(model.name);
      }
    }
    if (!check) await writeReadme(root, models, verified);
    const runtimeValid = await syncRuntime(root, check, log);
    return valid && runtimeValid ? 0 : 1;
  } catch (error) {
    log(`無法完成：${error instanceof Error ? error.message : '發生未知錯誤，請重試。'}`);
    return 1;
  }
}

// 比對實際入口檔，匯入小函式做測試時不會下載或寫入任何檔案。
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(new URL(import.meta.url))) {
  process.exitCode = await run(process.argv.slice(2));
}
