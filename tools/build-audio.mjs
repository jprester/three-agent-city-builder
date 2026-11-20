// Recorded ambience: art/external/audio/*.opus -> public/audio/<name>.opus + <name>.m4a.
//
//   npm run audio
//
// The Opus file is copied as it is (Chrome, Firefox, Safari 18.4+ decode Ogg Opus); the AAC copy
// is the fallback for older Safari. src/systems/audio.ts crossfades the clips, so encoder padding
// at either end does not matter. Needs ffmpeg on PATH. Outputs are committed like the GLBs.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/common.mjs';

const srcDir = path.join(ROOT, 'art', 'external', 'audio');
const outDir = path.join(ROOT, 'public', 'audio');
mkdirSync(outDir, { recursive: true });

for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.opus')).sort()) {
  const name = path.basename(file, '.opus');
  const src = path.join(srcDir, file);
  copyFileSync(src, path.join(outDir, file));
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-map_metadata', '-1',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', path.join(outDir, `${name}.m4a`),
  ]);
  console.log(`audio: ${name} -> public/audio/${name}.opus, .m4a`);
}
