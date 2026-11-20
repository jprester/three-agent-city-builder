// City sound files: art/external/audio/*.{opus,mp3} -> public/audio/<name>.opus + <name>.m4a.
//
//   npm run audio
//
// An Opus source is copied as it is; any other source is encoded to Opus (libopus 96 kbps). Ogg
// Opus decodes sample-exact in Chrome, Firefox and Safari 18.4+, so the generated loops repeat
// without a gap; the AAC copy is the fallback for older Safari. Needs ffmpeg with libopus on PATH.
// Outputs are committed like the GLBs. src/systems/audio.ts plays them.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/common.mjs';

const srcDir = path.join(ROOT, 'art', 'external', 'audio');
const outDir = path.join(ROOT, 'public', 'audio');
mkdirSync(outDir, { recursive: true });

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);

for (const file of readdirSync(srcDir).filter((f) => /\.(opus|mp3)$/.test(f)).sort()) {
  const ext = path.extname(file);
  const name = path.basename(file, ext);
  const src = path.join(srcDir, file);
  const opus = path.join(outDir, `${name}.opus`);
  if (ext === '.opus') copyFileSync(src, opus);
  else ffmpeg('-i', src, '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', opus);
  ffmpeg('-i', src, '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', path.join(outDir, `${name}.m4a`));
  console.log(`audio: ${file} -> public/audio/${name}.opus, .m4a`);
}
