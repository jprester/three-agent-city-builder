// Runs every layout def in art/layouts/defs through its generator module and
// writes instance lists to public/layouts/<name>.json. No Blender needed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCatalog } from './lib/catalog.mjs';
import { P, isMain, listFiles, readJson, writeJson } from './lib/common.mjs';

// Layout generators also run in the browser (?seed=), so they must not use Node APIs.
function assertBrowserSafe() {
  for (const file of listFiles(P.layoutGenerators, '.mjs')) {
    const src = fs.readFileSync(file, 'utf8');
    // Also catches bare builtin specifiers (`from 'fs'`), which Node resolves but browsers cannot.
    const builtins = 'fs|path|os|url|crypto|child_process|util|stream|buffer|module|worker_threads';
    const hit = src.match(new RegExp(`from\\s+['"](node:|(${builtins})(/[\\w/]*)?['"])|require\\(|\\bprocess\\b|import\\(\\s*['"](node:|(${builtins})['"])`));
    if (hit) throw new Error(`${path.relative(P.layoutGenerators, file)} uses a Node API (${hit[0]}); layout generators must be browser-safe.`);
  }
}

export async function buildLayouts() {
  assertBrowserSafe();
  const assets = await readCatalog();
  const known = new Set(Object.keys(assets));
  const written = [];
  for (const file of listFiles(P.layoutDefs, '.json')) {
    const name = path.basename(file, '.json');
    const def = readJson(file);
    const mod = await import(pathToFileURL(path.join(P.layoutGenerators, `${def.generator}.mjs`)).href);
    const layout = mod.generate({ params: def.params ?? {}, seed: def.seed ?? 0, assets });
    const unknown = [...new Set(layout.instances.map((i) => i.asset))].filter((id) => !known.has(id));
    if (unknown.length) console.warn(`  layout ${name}: references unbuilt assets: ${unknown.join(', ')}`);
    writeJson(path.join(P.layoutsOut, `${name}.json`), { name, ...layout });
    written.push({ name, instances: layout.instances.length });
  }
  return written;
}

if (isMain(import.meta.url)) {
  for (const l of await buildLayouts()) console.log(`layout ${l.name}: ${l.instances} instances`);
}
