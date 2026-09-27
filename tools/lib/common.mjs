import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const P = {
  config: path.join(ROOT, 'pipeline.config.json'),
  defs: path.join(ROOT, 'art', 'defs'),
  generators: path.join(ROOT, 'art', 'generators'),
  palette: path.join(ROOT, 'art', 'style', 'palette.json'),
  facade: path.join(ROOT, 'art', 'style', 'facade.json'),
  layoutDefs: path.join(ROOT, 'art', 'layouts', 'defs'),
  layoutGenerators: path.join(ROOT, 'art', 'layouts'),
  blenderTools: path.join(ROOT, 'tools', 'blender'),
  build: path.join(ROOT, 'build'),
  raw: path.join(ROOT, 'build', 'raw'),
  previews: path.join(ROOT, 'build', 'previews'),
  cache: path.join(ROOT, 'build', 'cache.json'),
  assetsOut: path.join(ROOT, 'public', 'assets'),
  layoutsOut: path.join(ROOT, 'public', 'layouts'),
  manifest: path.join(ROOT, 'src', 'assets', 'manifest.gen.ts'),
};

export const readJson = (file, fallback) => {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

export const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

export const listFiles = (dir, ext) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
};

export const toPosix = (p) => p.split(path.sep).join('/');

/**
 * All asset defs: { id: 'buildings/tower_a', file, def, category, overrides }.
 * A def may list `lods`: [{ distance, ...paramOverrides }]. Each becomes an extra asset
 * `<id>.lod<n>` built by the same generator with params + { lod: n, ...overrides }; its meta
 * gets lodOf / lod / lodDistance so the runtime can swap it in by distance.
 */
export const listDefs = () =>
  listFiles(P.defs, '.json').flatMap((file) => {
    const id = toPosix(path.relative(P.defs, file)).replace(/\.json$/, '');
    const def = readJson(file);
    const category = id.split('/')[0];
    const base = { id, file, def, category, overrides: null };
    const lods = (def.lods ?? []).map(({ distance, ...params }, k) => ({
      id: `${id}.lod${k + 1}`, file, def, category,
      overrides: { params: { ...params, lod: k + 1 }, meta: { lodOf: id, lod: k + 1, lodDistance: distance } },
    }));
    return [base, ...lods];
  });

export const assetOutPath = (id) => path.join(P.assetsOut, ...id.split('/')) + '.glb';

/** Glob with `*` (within a segment) and `**` (across segments). */
export const globToRegex = (glob) =>
  new RegExp('^' + glob.split('**').map((part) =>
    part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')
  ).join('.*') + '$');

export const sha256 = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

import { pathToFileURL } from 'node:url';
/** True when the calling module was run directly with `node file.mjs`. */
export const isMain = (metaUrl) => process.argv[1] && metaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
