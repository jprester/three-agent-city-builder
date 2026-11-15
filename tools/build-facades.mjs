// npm run facades:bake [-- <style id>]
// art/facades/baked.json -> build/facades/<style>/*.png (tools/blender/bake_facades.py, Cycles,
// one straight-on render per map) -> art/textures/facades/baked/*.webp + baked.json
// (tools/textures/pack_facades.py). Then `npm run textures` for the KTX2 copies.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline.config.json'), 'utf8'));
const candidates = [process.env.BLENDER_BIN, config.blender?.path,
  os.platform() === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : null, 'blender'].filter(Boolean);
const blender = candidates.find((bin) => {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!blender) {
  console.error('Blender not found. Set BLENDER_BIN or "blender.path" in pipeline.config.json.');
  process.exit(1);
}
const def = path.join(ROOT, 'art', 'facades', 'baked.json');
const out = path.join(ROOT, 'build', 'facades');
const only = process.argv[2];
execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
  '--python', path.join(ROOT, 'tools', 'blender', 'bake_facades.py'), '--', '--def', def, '--out', out,
  ...(only ? ['--only', only] : [])], { stdio: ['ignore', 'inherit', 'inherit'] });
execFileSync('python3', [path.join(ROOT, 'tools', 'textures', 'pack_facades.py'), def, out], { stdio: 'inherit' });
