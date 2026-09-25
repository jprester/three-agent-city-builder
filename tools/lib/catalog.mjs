// Asset catalog: every built asset with the metadata its generator declared (ctx.meta),
// read back from the GLB root extras. Layout generators receive this as `assets`.
import fs from 'node:fs';
import { getIO } from '../optimize.mjs';
import { assetOutPath, listDefs } from './common.mjs';

/** { [id]: { category, meta } } for every def whose GLB exists. */
export async function readCatalog() {
  const io = await getIO();
  const catalog = {};
  for (const { id, category } of listDefs()) {
    const file = assetOutPath(id);
    if (!fs.existsSync(file)) continue;
    const doc = await io.read(file);
    catalog[id] = { category, meta: doc.getRoot().getExtras()?.meta ?? {} };
  }
  return catalog;
}
