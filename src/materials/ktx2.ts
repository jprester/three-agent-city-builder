import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * GPU-compressed textures (npm run textures: art/textures/ktx2.def.json -> public/textures/).
 * The files are UASTC, transcoded at load to whatever block format the GPU has (ASTC on Apple
 * GPUs, BC7 on desktop cards): 8 bits per pixel on the GPU instead of the 32 of RGBA8.
 *
 * The files carry their own mip chain and are stored flipped, matching three's flipY = true
 * convention for images, so shaders sample them exactly like the WebP files they replace.
 *
 * The transcoded blocks are dropped once uploaded, so the textures exist only on the GPU.
 * After a WebGL context loss they are fetched and transcoded again when the context returns.
 */
let loader: KTX2Loader | null = null;

const url = (id: string) => `${import.meta.env.BASE_URL}textures/${id}.ktx2`;

function ktx2(renderer: THREE.WebGLRenderer) {
  loader ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
  return loader;
}

type Mip = { data: Uint8Array; width: number; height: number };

async function fetchMips(renderer: THREE.WebGLRenderer, ids: string[]) {
  let layers: THREE.CompressedTexture[];
  try {
    layers = await Promise.all(ids.map((id) => ktx2(renderer).loadAsync(url(id))));
  } catch (err) {
    throw new Error(`Compressed textures missing or unreadable (${ids.join(', ')}). Run \`npm run textures\`, then reload.`, { cause: err });
  }
  const first = layers[0];
  for (const [i, l] of layers.entries()) {
    if (l.format !== first.format || l.image.width !== first.image.width || l.image.height !== first.image.height || l.mipmaps.length !== first.mipmaps.length) {
      throw new Error(`Texture ${ids[i]} does not match ${ids[0]} (size, format or mip count)`);
    }
  }
  // An array texture's level is its layers' blocks back to back.
  const mips: Mip[] = first.mipmaps.map((m, level) => {
    if (layers.length === 1) return m as Mip;
    const parts = layers.map((l) => l.mipmaps[level].data as Uint8Array);
    const data = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) { data.set(p, at); at += p.byteLength; }
    return { data, width: m.width, height: m.height };
  });
  return { mips, first };
}

/** Upload once, then free the CPU copy; `dataReady = false` makes any later re-allocation skip the upload. */
function releaseAfterUpload(tex: THREE.CompressedTexture) {
  tex.onUpdate = () => {
    tex.onUpdate = null as unknown as THREE.CompressedTexture['onUpdate'];
    tex.source.dataReady = false;
    for (const m of tex.mipmaps as Mip[]) m.data = new Uint8Array(0);
  };
}

/**
 * One texture from `public/textures/<id>.ktx2`; several ids give a texture array with one
 * layer per id (all the same size). Colour space comes from the file.
 */
export async function loadKtx2(renderer: THREE.WebGLRenderer, ids: string | string[], anisotropy = 1) {
  const list = Array.isArray(ids) ? ids : [ids];
  const { mips, first } = await fetchMips(renderer, list);
  const { width, height } = first.image;
  const tex = Array.isArray(ids)
    ? new THREE.CompressedArrayTexture(mips as unknown as ImageData[], width, height, list.length, first.format as THREE.CompressedPixelFormat, first.type)
    : new THREE.CompressedTexture(mips as unknown as ImageData[], width, height, first.format as THREE.CompressedPixelFormat, first.type);
  tex.colorSpace = first.colorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  releaseAfterUpload(tex);
  // Registered after three.js's own handler (WebGLRenderer constructor): until the blocks are
  // back, three only re-allocates the storage (dataReady is false), then this fills it.
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    fetchMips(renderer, list).then(({ mips: again }) => {
      (tex.mipmaps as unknown as Mip[]).forEach((m, i) => { m.data = again[i].data; });
      tex.source.dataReady = true;
      tex.needsUpdate = true;
      releaseAfterUpload(tex);
    }).catch((err) => console.error('Compressed textures not restored:', err));
  });
  return tex;
}
