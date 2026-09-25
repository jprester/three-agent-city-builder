// Runs every layout def in art/layouts/defs through its generator module and
// writes instance lists to public/layouts/<name>.json. No Blender needed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { P, isMain, listDefs, listFiles, readJson, writeJson } from './lib/common.mjs';

// Layout generators also run in the browser (?seed=), so they must not use Node APIs.
function assertBrowserSafe() {
  for (const file of listFiles(P.layoutGenerators, '.mjs')) {
    const src = fs.readFileSync(file, 'utf8');
    const hit = src.match(/from\s+['"]node:|require\(|\bprocess\.|import\(['"]node:/);
    if (hit) throw new Error(`${path.relative(P.layoutGenerators, file)} uses a Node API (${hit[0]}); layout generators must be browser-safe.`);
  }
}

export async function buildLayouts() {
  assertBrowserSafe();
  const known = new Set(listDefs().map((d) => d.id));
  const written = [];
  for (const file of listFiles(P.layoutDefs, '.json')) {
    const name = path.basename(file, '.json');
    const def = readJson(file);
    const mod = await import(pathToFileURL(path.join(P.layoutGenerators, `${def.generator}.mjs`)).href);
    const layout = mod.generate({ params: def.params ?? {}, seed: def.seed ?? 0 });
    const unknown = [...new Set(layout.instances.map((i) => i.asset))].filter((id) => !known.has(id));
    if (unknown.length) console.warn(`  layout ${name}: references assets with no def: ${unknown.join(', ')}`);
    writeJson(path.join(P.layoutsOut, `${name}.json`), { name, ...layout });
    written.push({ name, instances: layout.instances.length });
  }
  return written;
}

if (isMain(import.meta.url)) {
  for (const l of await buildLayouts()) console.log(`layout ${l.name}: ${l.instances} instances`);
}
