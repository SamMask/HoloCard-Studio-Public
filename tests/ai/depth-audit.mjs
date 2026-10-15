// Offline quality/performance audit; installed compiler, no network. Repo root.
// --before DIR reads saved pre-optimization depth-before.ts/image-ops-before.ts.
// --fixtures DIR selects original-size lossless local fixtures; --head reads HEAD.
// --bench runs five times per version with alternating order after warmup.
// --profile injects timers in memory only; production modules remain untouched.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const profile = process.argv.includes('--profile');
const asModule = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString('base64');
const timer = `let __stageStart = performance.now();
 const __stage = name => { const now = performance.now(); globalThis.__depthTimings[name] =
 (globalThis.__depthTimings[name] ?? 0) + now - __stageStart; __stageStart = now; };`;
function instrumentOps(source) {
  source = source.replace('const fine = unitHistogram(data);', `${timer}\nconst fine = unitHistogram(data); __stage('histogram');`)
    .replace('const peaks: number[] = [];', `__stage('platformExclusion');\nconst peaks: number[] = [];`)
    .replace('if (valleys.length === 0) return fallback();', `__stage('valleySearch');\nif (valleys.length === 0) return fallback();`)
    .replace('const levels = [', `${timer}\nconst levels = [`)
    .replace('writeFilledColors(data, width, height, levels[0], known);', `__stage('pyramid');\nwriteFilledColors(data, width, height, levels[0], known); __stage('composition');`);
  source += `\nconst __inset = insetBackground;
 insetBackground = (...args) => { const start = performance.now(); const result = __inset(...args);
 globalThis.__depthTimings.inset = (globalThis.__depthTimings.inset ?? 0) + performance.now() - start; return result; };`;
  return source;
}
function instrumentDepth(source) {
  return source.replace('const [low, high] = quantiles', `${timer}\nconst [low, high] = quantiles`)
    .replace('return { width: outWidth, height: outHeight, data };', `__stage('depthToImage');\nreturn { width: outWidth, height: outHeight, data };`)
    .replace('const areas = new Array', `${timer}\nconst areas = new Array`)
    .replace('const result: DepthBand[] = [];', `__stage('bandAreas');\nconst result: DepthBand[] = [];`)
    .replace('const knownBackground =', `__stage('outputBuffers');\nconst knownBackground =`)
    .replace('if (result.length > 1) fillBackground', `__stage('softMask');\nif (result.length > 1) fillBackground`);
}
async function load(name) {
  const before = option('--before');
  const read = file => name === 'head'
    ? execFileSync('git', ['show', `HEAD:src/ai/${file}.ts`], { encoding: 'utf8' })
    : readFileSync(name === 'before' ? join(before, `${file}-before.ts`) : `src/ai/${file}.ts`, 'utf8');
  let ops = read('image-ops'), depth = read('depth');
  if (profile && name !== 'head') { ops = instrumentOps(ops); depth = instrumentDepth(depth); }
  return import(asModule(depth.replace("'./image-ops'", JSON.stringify(asModule(ops)))));
}
const helper = readFileSync('tests/ai/real-fixtures.ts', 'utf8').replace('import.meta.url', JSON.stringify(pathToFileURL(resolve('tests/ai/real-fixtures.ts')).href));
const { readFixture, measureSplit } = await import(asModule(helper));
const names = [...(process.argv.includes('--head') ? ['head'] : []), ...(option('--before') ? ['before'] : []), 'after'];
const versions = await Promise.all(names.map(async name => [name, await load(name)]));
const directory = option('--fixtures') ? pathToFileURL(resolve(option('--fixtures')) + '/') : undefined;
if (!process.argv.includes('--bench-only')) for (let card = 1; card <= 4; card++) {
  const { image, depth, mask, metadata } = readFixture(card, directory);
  let previous;
  for (const [name, api] of versions) {
    globalThis.__depthTimings = {};
    const bands = api.splitByDepth(image, depth);
    if (name === 'before') previous = bands;
    if (name === 'after' && previous) {
      assert.equal(bands.length, previous.length);
      for (let i = 0; i < bands.length; i++) {
        assert.equal(bands[i].depth, previous[i].depth);
        assert(Buffer.from(bands[i].image.data).equals(Buffer.from(previous[i].image.data)), `card${card} band${i} pixels changed`);
      }
    }
    const metrics = measureSplit(image, mask, bands);
    if (card === 4) {
      let lowerHero = 0, lowerNear = 0;
      for (let i = Math.floor(mask.length * 0.75); i < mask.length; i++) if (mask[i]) {
        lowerHero++; lowerNear += bands.at(-1).image.data[i * 4 + 3] / 255;
      }
      metrics.lowerQuarterHeroNear = lowerNear / lowerHero;
    }
    console.log(JSON.stringify({ card, name, ...metrics }));
    if (name === 'after') {
      assert(metrics.area.at(-1) >= 0.08);
      assert(metrics.hero.slice(1).reduce((a, b) => a + b, 0) >= 0.9);
      if (metadata.lossless) assert(metrics.ghost <= metadata.baseline.ghost.ghostTotalFraction + 0.00005);
      if (card === 1) assert(metrics.hero.at(-1) >= 0.9 && metrics.nearPurity >= 0.85);
    }
  }
}
if (process.argv.includes('--bench') || process.argv.includes('--bench-only')) {
  const { depth: raw } = readFixture(2);
  const width = 4096, height = 3072, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919) & 255;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const benchmark = api => {
    globalThis.__depthTimings = {};
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    const depth = api.depthToImage(raw.data, raw.width, raw.height, width, height);
    const bands = api.splitByDepth({ width, height, data }, depth, { bands: 3 });
    const totalMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    return { totalMs, cpuMs: (cpu.user + cpu.system) / 1000, bands: bands.length, stages: globalThis.__depthTimings };
  };
  const clean = async () => { global.gc?.(); await new Promise(resolve => setImmediate(resolve)); global.gc?.(); };
  for (const [, api] of versions) { await clean(); benchmark(api); }
  const records = Object.fromEntries(names.map(name => [name, []]));
  for (let run = 0; run < 5; run++) for (const [name, api] of run % 2 ? versions.toReversed() : versions) {
    await clean();
    const result = benchmark(api); records[name].push(result);
    console.log(JSON.stringify({ name, run, ...result }));
  }
  const median = values => values.toSorted((a, b) => a - b)[2];
  for (const name of names) {
    const results = records[name];
    const stages = Object.fromEntries(Object.keys(results[0].stages).map(stage => [stage, median(results.map(result => result.stages[stage]))]));
    console.log(JSON.stringify({ summary: name, medianMs: median(results.map(result => result.totalMs)),
      slowestMs: Math.max(...results.map(result => result.totalMs)), stages }));
  }
}
