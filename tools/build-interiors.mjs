// Room-card atlas for lit windows: render every card in Blender, then pack the atlas.
//
//   npm run interiors
//
// art/interiors/interiors.json + art/generators/interiors/rooms.py -> build/interiors/*.png
// (tools/blender/render_interiors.py) -> art/textures/interiors/interiors.{webp,json}
// (tools/textures/pack_interiors.py). Deterministic for a given def and Blender version.
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { P, ROOT, readJson } from './lib/common.mjs';

const config = readJson(P.config);
const candidates = [process.env.BLENDER_BIN, config.blender?.path,
  os.platform() === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : null, 'blender'].filter(Boolean);
const blender = candidates.find((bin) => {
  try { return /Blender \d/.test(execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return false; }
});
if (!blender) {
  console.error('Blender not found. Set BLENDER_BIN or "blender.path" in pipeline.config.json.');
  process.exit(1);
}
const def = path.join(ROOT, 'art', 'interiors', 'interiors.json');
const cards = path.join(P.build, 'interiors');
execFileSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
  '--python', path.join(ROOT, 'tools', 'blender', 'render_interiors.py'), '--', '--def', def, '--out', cards],
{ stdio: ['ignore', 'inherit', 'inherit'] });
execFileSync('python3', [path.join(ROOT, 'tools', 'textures', 'pack_interiors.py'), def, cards,
  path.join(ROOT, 'art', 'textures', 'interiors')], { stdio: 'inherit' });
