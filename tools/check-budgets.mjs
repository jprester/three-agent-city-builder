// Checks optimized assets against per-category budgets in pipeline.config.json.
// `npm run budgets` exits 1 on any violation; build-assets only reports.
import fs from 'node:fs';
import { getIO } from './optimize.mjs';
import { P, assetOutPath, isMain, listDefs, readJson } from './lib/common.mjs';

async function measure(file) {
  const io = await getIO();
  const doc = await io.read(file);
  let triangles = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // TRIANGLES only
      const idx = prim.getIndices();
      triangles += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return { triangles, kb: fs.statSync(file).size / 1024 };
}

export async function checkBudgets() {
  const budgets = readJson(P.config).budgets ?? {};
  const results = [];
  for (const { id, category } of listDefs()) {
    const file = assetOutPath(id);
    if (!fs.existsSync(file)) continue;
    const m = await measure(file);
    const b = budgets[category];
    const problems = [];
    if (!b) problems.push(`no budget defined for category "${category}"`);
    else {
      if (b.maxTriangles && m.triangles > b.maxTriangles) problems.push(`triangles ${m.triangles} > ${b.maxTriangles}`);
      if (b.maxKB && m.kb > b.maxKB) problems.push(`size ${m.kb.toFixed(1)}KB > ${b.maxKB}KB`);
    }
    results.push({ id, ...m, problems });
  }
  return results;
}

export function printBudgets(results) {
  for (const r of results) {
    const status = r.problems.length ? `OVER: ${r.problems.join('; ')}` : 'ok';
    console.log(`  ${r.id.padEnd(32)} ${String(r.triangles).padStart(7)} tris ${r.kb.toFixed(1).padStart(8)} KB  ${status}`);
  }
  return results.filter((r) => r.problems.length).length;
}

if (isMain(import.meta.url)) {
  const results = await checkBudgets();
  if (!results.length) console.log('No built assets found. Run `npm run assets` first.');
  const failures = printBudgets(results);
  process.exit(failures ? 1 : 0);
}
