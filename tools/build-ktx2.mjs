// GPU-compressed textures: encode the app's large textures to KTX2 (Basis Universal UASTC).
//
//   npm run textures            encode what changed
//   npm run textures -- --force re-encode everything
//
// art/textures/ktx2.def.json -> public/textures/<id>.ktx2 + public/basis/ (three's transcoder,
// copied so the app makes no network request outside its own origin). The GPU holds UASTC as
// ASTC or BC7 at 8 bits per pixel instead of RGBA8 at 32. Outputs are generated and committed
// like the GLBs; an entry is skipped when its source, settings and the encoder version are unchanged.
//
// Images are flipped vertically here: compressed textures cannot be flipped at upload, and the
// shaders expect three's flipY = true convention.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { encodeToKTX2 } from 'ktx2-encoder';
import { read, write } from 'ktx-parse';
import sharp from 'sharp';
import { ROOT, readJson } from './lib/common.mjs';

const force = process.argv.includes('--force');
const def = readJson(path.join(ROOT, 'art', 'textures', 'ktx2.def.json'));
const outDir = path.join(ROOT, 'public', 'textures');
const stampPath = path.join(outDir, 'stamps.json');
mkdirSync(outDir, { recursive: true });

// The transcoder must match the three version; copy it every run (two small files).
const basisSrc = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
const basisOut = path.join(ROOT, 'public', 'basis');
mkdirSync(basisOut, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) copyFileSync(path.join(basisSrc, f), path.join(basisOut, f));

const encoderVersion = readJson(path.join(ROOT, 'node_modules', 'ktx2-encoder', 'package.json')).version;
const stamps = existsSync(stampPath) ? readJson(stampPath) : {};

/** Encode raw RGBA rows (already flipped) with the shared settings. */
async function encode(raw, kind, mips, zstd) {
  const quiet = console.log;
  console.log = () => {};   // the WebAssembly encoder prints every slice
  try {
    return await encodeToKTX2(new Uint8Array(0), {
      isUASTC: true, isKTX2File: true, uastcLDRQualityLevel: def.uastcLevel, needSupercompression: zstd,
      generateMipmap: mips, isNormalMap: kind === 'normal', isPerceptual: kind === 'color',
      isSetKTX2SRGBTransferFunc: kind === 'color', imageDecoder: async () => raw,
    });
  } finally { console.log = quiet; }
}

/** Half-size copy, averaging 2x2 texels: colour in linear light, alpha and data as stored. */
function halve({ data, width, height }, kind) {
  const w = width >> 1, h = height >> 1, out = new Uint8Array(w * h * 4);
  const toLinear = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const toSrgb = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const i = (y * 2 * width + x * 2) * 4 + c, a = data[i], b = data[i + 4], d = data[i + width * 4], e = data[i + width * 4 + 4];
    out[(y * w + x) * 4 + c] = kind === 'color' && c < 3 ? toSrgb((toLinear[a] + toLinear[b] + toLinear[d] + toLinear[e]) / 4) : Math.round((a + b + d + e) / 4);
  }
  return { data: out, width: w, height: h };
}

/**
 * The encoder takes at most ~12 megapixels per call. A larger image has its top level encoded
 * in horizontal bands (UASTC blocks are independent, so the bands' blocks simply concatenate)
 * and the remaining levels from a half-size copy; the levels are then joined into one file.
 */
async function encodeLarge(raw, kind) {
  const { data, width, height } = raw;
  if (width % 8 || height % 8) throw new Error(`${width}x${height}: a texture over the encoder limit needs sides divisible by 8`);
  const bands = Math.ceil((width * height) / def.maxEncodePixels), rows = Math.ceil(height / bands / 4) * 4, parts = [];
  for (let y = 0; y < height; y += rows) {
    const h = Math.min(rows, height - y);
    const band = read(await encode({ data: data.subarray(y * width * 4, (y + h) * width * 4), width, height: h }, kind, false, false));
    parts.push(band.levels[0].levelData);
  }
  const top = Buffer.concat(parts);
  const container = read(await encode(halve(raw, kind), kind, true, def.zstd));
  container.pixelWidth = width;
  container.pixelHeight = height;
  container.levels.unshift({ levelData: def.zstd ? new Uint8Array(zstdCompressSync(top)) : new Uint8Array(top), uncompressedByteLength: top.length });
  return write(container);
}

let built = 0, bytes = 0;
for (const t of def.textures) {
  const src = readFileSync(path.join(ROOT, t.src));
  const out = path.join(outDir, `${t.id}.ktx2`);
  const stamp = createHash('sha256').update(src).update(JSON.stringify([t.kind, def.uastcLevel, def.zstd, def.maxEncodePixels, encoderVersion])).digest('hex');
  if (!force && stamps[t.id] === stamp && existsSync(out)) { bytes += readFileSync(out).length; continue; }
  const started = Date.now();
  const { data, info } = await sharp(src).flip().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  if (raw.width % 4 || raw.height % 4) throw new Error(`${t.src}: ${raw.width}x${raw.height}, sides must be divisible by 4 for block compression`);
  const file = raw.width * raw.height > def.maxEncodePixels ? await encodeLarge(raw, t.kind) : await encode(raw, t.kind, true, def.zstd);
  writeFileSync(out, file);
  stamps[t.id] = stamp;
  writeFileSync(stampPath, JSON.stringify(stamps, null, 2) + '\n');
  built++; bytes += file.length;
  console.log(`${t.id}: ${raw.width}x${raw.height} -> ${(file.length / 1e6).toFixed(1)} MB (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
console.log(`textures: ${built} encoded, ${def.textures.length - built} up to date, ${(bytes / 1e6).toFixed(0)} MB in public/textures/`);
