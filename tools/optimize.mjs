// Raw Blender GLB -> optimized runtime GLB. Every asset goes through the same steps.
// Textures: when image textures are introduced, add KTX2 compression here
// (gltf-transform `toktx`, requires KTX-Software installed locally).
import fs from 'node:fs';
import path from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { isMain } from './lib/common.mjs';

let ioPromise;
export async function getIO() {
  ioPromise ??= (async () => {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  })();
  return ioPromise;
}

export async function optimize(inPath, outPath) {
  const io = await getIO();
  const doc = await io.read(inPath);
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  await doc.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    // keepAttributes: UVs/colors read by custom shaders look "unused" to glTF materials.
    prune({ keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
}

if (isMain(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node tools/optimize.mjs <in.glb> <out.glb>');
    process.exit(1);
  }
  await optimize(input, output);
  console.log(`optimized ${input} -> ${output}`);
}
