// Asset pipeline orchestrator.
//
//   npm run assets                          rebuild changed assets, then layouts + manifest
//   npm run assets -- --only 'buildings/*'  limit to ids matching glob(s), comma-separated
//   npm run assets -- --force               ignore the cache
//   npm run assets -- --no-previews         skip preview renders
//   npm run assets -- --allow-version-mismatch
//
// Per asset: Blender (generate -> export raw GLB -> previews) -> optimize -> public/assets.
// Cache key = def + generator source and its local imports + tools/blender + palette
// + optimizer + Blender version. Output for a given key is deterministic.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { optimize } from './optimize.mjs';
import { checkBudgets, printBudgets } from './check-budgets.mjs';
import { writeManifest } from './manifest.mjs';
import { buildLayouts } from './build-layouts.mjs';
import {
  P, ROOT, assetOutPath, globToRegex, listDefs, listFiles, readJson, sha256, toPosix, writeJson,
} from './lib/common.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function resolveBlender(config) {
  const candidates = [
    process.env.BLENDER_BIN,
    config.blender?.path,
    os.platform() === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : null,
    'blender',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/Blender (\d+\.\d+(?:\.\d+)?)/);
      if (m) return { bin, version: m[1] };
    } catch { /* try next */ }
  }
  console.error('Blender not found. Set BLENDER_BIN or "blender.path" in pipeline.config.json.');
  process.exit(1);
}

function checkVersion(config, detected) {
  const majorMinor = detected.split('.').slice(0, 2).join('.');
  if (!config.blender.version) {
    config.blender.version = majorMinor;
    writeJson(P.config, config);
    console.log(`Pinned Blender ${majorMinor} in pipeline.config.json (first run).`);
    return;
  }
  if (config.blender.version !== majorMinor && !flag('--allow-version-mismatch')) {
    console.error(`Blender ${detected} does not match pinned ${config.blender.version}. ` +
      'Install the pinned version, or re-pin deliberately (edit pipeline.config.json and rebuild with --force).');
    process.exit(1);
  }
}

/** Local Python modules imported (transitively) by a generator file. */
function pythonDeps(file, seen = new Set()) {
  if (seen.has(file) || !fs.existsSync(file)) return seen;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const resolve = (mod) => {
    const base = path.join(P.generators, ...mod.split('.'));
    for (const cand of [`${base}.py`, path.join(base, '__init__.py')]) pythonDeps(cand, seen);
  };
  // [ \t] rather than \s: \s spans newlines, which let one match swallow the next import line.
  for (const m of src.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) {
    resolve(m[1]);
    const names = m[2].replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    for (const name of names) resolve(`${m[1]}.${name}`);
  }
  for (const m of src.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)$/gm)) {
    for (const mod of m[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)) resolve(mod);
  }
  return seen;
}

function assetHash(entry, blenderVersion) {
  const generatorFile = path.join(P.generators, ...entry.def.generator.split('/')) + '.py';
  if (!fs.existsSync(generatorFile)) throw new Error(`${entry.id}: generator not found: ${generatorFile}`);
  const files = [
    ...[...pythonDeps(generatorFile)].sort(),
    ...listFiles(P.blenderTools, '.py'),
    P.palette,
    path.join(ROOT, 'tools', 'optimize.mjs'),
  ];
  return sha256(
    blenderVersion,
    fs.readFileSync(entry.file),
    ...files.flatMap((f) => [toPosix(path.relative(ROOT, f)), fs.readFileSync(f)]),
  );
}

function runBlender(bin, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { cwd: ROOT });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('close', (code) => {
      const line = log.split('\n').find((l) => l.startsWith('ASSET_RESULT '));
      if (code === 0 && line) resolve(JSON.parse(line.slice('ASSET_RESULT '.length)));
      else reject(new Error(`Blender exited with ${code}\n${log.split('\n').slice(-40).join('\n')}`));
    });
  });
}

function pruneOrphans(ids) {
  const keep = new Set(ids.map(assetOutPath));
  for (const f of listFiles(P.assetsOut, '.glb')) {
    if (!keep.has(f)) {
      fs.rmSync(f);
      console.log(`  removed orphan ${toPosix(path.relative(ROOT, f))}`);
    }
  }
}

async function main() {
  const config = readJson(P.config);
  const { bin, version } = resolveBlender(config);
  checkVersion(config, version);
  const previews = config.previews?.enabled !== false && !flag('--no-previews');

  const all = listDefs();
  const only = option('--only')?.split(',').map((g) => globToRegex(g.trim()));
  const selected = only ? all.filter((e) => only.some((re) => re.test(e.id))) : all;
  if (only && !selected.length) console.warn(`No defs match --only ${option('--only')}`);

  const cache = readJson(P.cache, {});
  let built = 0;
  let failed = 0;
  console.log(`Blender ${version} | ${selected.length} asset(s) selected`);

  for (const entry of selected) {
    const hash = assetHash(entry, version);
    const out = assetOutPath(entry.id);
    if (!flag('--force') && cache[entry.id] === hash && fs.existsSync(out)) {
      console.log(`  ${entry.id.padEnd(32)} cached`);
      continue;
    }
    const raw = path.join(P.raw, ...entry.id.split('/')) + '.glb';
    const argv = [
      '--background', '--factory-startup', '--python-exit-code', '1',
      '--python', path.join(P.blenderTools, 'run.py'), '--',
      '--def', entry.file, '--id', entry.id, '--out', raw,
    ];
    if (previews) {
      argv.push('--previews', path.join(P.previews, ...entry.id.split('/')),
        '--preview-engine', config.previews.engine ?? 'workbench',
        '--preview-res', String(config.previews.resolution ?? 768));
    }
    const t0 = Date.now();
    try {
      const result = await runBlender(bin, argv);
      await optimize(raw, out);
      cache[entry.id] = hash;
      writeJson(P.cache, cache);
      built++;
      console.log(`  ${entry.id.padEnd(32)} built  ${result.triangles} tris  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      failed++;
      console.error(`  ${entry.id.padEnd(32)} FAILED\n${err.message}`);
    }
  }

  pruneOrphans(all.map((e) => e.id));
  for (const l of await buildLayouts()) console.log(`  layout ${l.name}: ${l.instances} instances`);
  const m = writeManifest();
  console.log(`  manifest: ${m.assets} assets, ${m.layouts} layouts`);
  console.log('Budgets:');
  const over = printBudgets(await checkBudgets());
  if (previews && built) console.log(`Previews: ${toPosix(path.relative(ROOT, P.previews))}/<asset id>/*.png`);
  console.log(`Done: ${built} built, ${failed} failed${over ? `, ${over} over budget` : ''}.`);
  process.exit(failed ? 1 : 0);
}

main();
