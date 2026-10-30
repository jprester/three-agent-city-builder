import * as THREE from 'three';
import osakaDiff from '../../art/external/textures/osaka/diffuse_rough.webp?url';
import osakaEmit from '../../art/external/textures/osaka/emissive.webp?url';
import osakaNorm from '../../art/external/textures/osaka/normal.webp?url';
import glassDiff from '../../art/external/textures/real_glass/diffuse_rough.webp?url';
import glassEmit from '../../art/external/textures/real_glass/emissive.webp?url';
import glassNorm from '../../art/external/textures/real_glass/normal.webp?url';
import skyDiff from '../../art/external/textures/glass_sky/diffuse_rough.webp?url';
import skyEmit from '../../art/external/textures/glass_sky/emissive.webp?url';
import skyNorm from '../../art/external/textures/glass_sky/normal.webp?url';
import walls from '../../art/external/textures/walls.webp?url';
import interiors from '../../art/textures/interiors/interiors.webp?url';
import osaka from '../../art/external/textures/osaka.json';
import realGlass from '../../art/external/textures/real_glass.json';
import glassSky from '../../art/external/textures/glass_sky.json';

/** Tower facade bundles, in the order the facade shader indexes them (bundle * 7 + facade). */
export const TOWER_BUNDLES = [osaka, realGlass, glassSky];

export interface FacadeTextures {
  /** One layer per bundle: diffuse (sRGB RGB) + roughness (A). */
  diffuse: THREE.DataArrayTexture;
  emissive: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  /** Wall materials, 4×2 cells: diffuse + roughness (A). */
  walls: THREE.Texture;
  /** Room cards behind lit windows (npm run interiors; tiles in interiors.json). */
  interiors: THREE.Texture;
}

/**
 * The tower bundles of one kind as a texture array, one layer per bundle. Three separate
 * textures per kind pushed the facade shader past 16 texture units (Apple GPUs), where the
 * extra samplers silently read nothing. three.js allocates the storage (format, mip chain,
 * filtering); the layers are uploaded straight from ImageBitmaps decoded without alpha
 * premultiplication, so roughness in A cannot damage RGB, and flipped at decode to keep the
 * shader's flipY = true convention (WebGL forbids UNPACK_FLIP_Y for 3D uploads).
 */
async function loadArray(renderer: THREE.WebGLRenderer, urls: string[], srgb: boolean, anisotropy: number) {
  const bitmaps = await Promise.all(urls.map(async (url) => createImageBitmap(await (await fetch(url)).blob(),
    { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })));
  const { width, height } = bitmaps[0];
  const tex = new THREE.DataArrayTexture(null, width, height, bitmaps.length);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.source.dataReady = false;   // allocate only; the layers come next
  tex.needsUpdate = true;
  renderer.initTexture(tex);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, (renderer.properties.get(tex) as { __webglTexture: WebGLTexture }).__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  bitmaps.forEach((b, layer) => {
    if (b.width !== width || b.height !== height) throw new Error(`Tower texture ${urls[layer]} is ${b.width}x${b.height}, expected ${width}x${height}`);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    b.close();
  });
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  renderer.resetState();   // raw GL calls above: drop three's cached bindings
  return tex;
}

/** Load every facade texture (imported by tools/textures/import_highrise.py) before rendering. */
export async function loadFacadeTextures(renderer: THREE.WebGLRenderer, anisotropy: number): Promise<FacadeTextures> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string, srgb: boolean, repeat = false) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const [diffuse, emissive, normal, wallTex, interiorTex] = await Promise.all([
    loadArray(renderer, [osakaDiff, glassDiff, skyDiff], true, anisotropy),
    loadArray(renderer, [osakaEmit, glassEmit, skyEmit], true, anisotropy),
    loadArray(renderer, [osakaNorm, glassNorm, skyNorm], false, anisotropy),
    load(walls, true),
    load(interiors, true),
  ]);
  return { diffuse, emissive, normal, walls: wallTex, interiors: interiorTex };
}
