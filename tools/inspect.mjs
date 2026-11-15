// npm run inspect -- <asset id> [--night] [--overlay] [--facades=0-6] [--views=front,tier0-foot] [--tile=360x240] [--scale=0.8,1.3,0.8]
// Contact sheet of one asset under controlled light and cameras: build/inspect/<asset>.png.
// See src/debug/inspect.ts (the page) and tests/visual/inspect.spec.ts (the capture).
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const asset = args.find((a) => !a.startsWith('--'));
if (!asset) {
  console.error('usage: npm run inspect -- <asset id> [--night] [--overlay] [--facades=all|0-6,9] [--views=all|front,corner] [--tile=WxH] [--scale=sx,sy,sz]');
  process.exit(1);
}
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const env = {
  ...process.env,
  INSPECT: asset,
  LIGHT: args.includes('--night') ? 'night' : 'day',
  OVERLAY: args.includes('--overlay') ? '1' : '0',
  FACADES: opt('facades') ?? 'all',
  VIEWS: opt('views') ?? 'all',
  TILE: opt('tile') ?? '360x240',
  SCALE: opt('scale') ?? '1,1,1',
};
const run = spawnSync('npx', ['playwright', 'test', '--project=chromium', 'tests/visual/inspect.spec.ts'], { env, stdio: 'inherit' });
if (run.status === 0) console.log(`build/inspect/${asset.replace(/\//g, '_')}${env.LIGHT === 'day' ? '' : '-night'}${env.OVERLAY === '1' ? '-overlay' : ''}.png`);
process.exit(run.status ?? 1);
