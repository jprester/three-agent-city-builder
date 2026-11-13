import * as THREE from 'three/webgpu';
import osakaDiff from '../../art/external/textures/osaka/diffuse_rough.webp?url';
import osakaEmit from '../../art/external/textures/osaka/emissive.webp?url';
import glassDiff from '../../art/external/textures/real_glass/diffuse_rough.webp?url';
import glassEmit from '../../art/external/textures/real_glass/emissive.webp?url';
import skyDiff from '../../art/external/textures/glass_sky/diffuse_rough.webp?url';
import skyEmit from '../../art/external/textures/glass_sky/emissive.webp?url';
import walls from '../../art/external/textures/walls.webp?url';
import interiors from '../../art/textures/interiors/interiors.webp?url';

export interface PocFacadeTextures {
  /** One layer per tower bundle: diffuse (sRGB) + roughness (A). */
  diffuse: THREE.DataArrayTexture;
  emissive: THREE.DataArrayTexture;
  /** Wall materials, 4×2 cells: diffuse + roughness (A). */
  walls: THREE.Texture;
  /** Room cards behind lit windows (tiles in interiors.json). */
  interiors: THREE.Texture;
}

interface ImageDecoderLike {
  decode(): Promise<{ image: { codedWidth: number; codedHeight: number; copyTo(dst: Uint8Array, o: { format: string }): Promise<unknown>; close(): void } }>;
}
declare const ImageDecoder: new (init: { data: ArrayBuffer; type: string; premultiplyAlpha: string; colorSpaceConversion: string }) => ImageDecoderLike;

/**
 * Decode an image to straight (unpremultiplied) RGBA bytes, bottom row first. WebCodecs'
 * ImageDecoder is the one browser path that hands back the stored bytes: a 2D canvas
 * premultiplies, which would damage RGB wherever the roughness in alpha is low.
 */
async function decodeRGBA(url: string): Promise<{ width: number; height: number; data: Uint8Array }> {
  const decoder = new ImageDecoder({ data: await (await fetch(url)).arrayBuffer(), type: 'image/webp', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const { image } = await decoder.decode();
  const width = image.codedWidth, height = image.codedHeight;
  const top = new Uint8Array(width * height * 4);
  await image.copyTo(top, { format: 'RGBA' });
  image.close();
  const data = new Uint8Array(top.length), row = width * 4;
  for (let y = 0; y < height; y++) data.set(top.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return { width, height, data };
}

/**
 * The tower bundles of one kind as a texture array. The WebGL loader uploads ImageBitmaps
 * layer by layer with raw GL calls; WebGPU's array upload takes CPU data, so the layers are
 * decoded to bytes and three allocates, uploads and mipmaps the texture itself.
 */
async function loadArray(urls: string[], srgb: boolean, anisotropy: number): Promise<THREE.DataArrayTexture> {
  const layers = await Promise.all(urls.map(decodeRGBA));
  const { width, height } = layers[0];
  const data = new Uint8Array(width * height * 4 * layers.length);
  layers.forEach((l, i) => {
    if (l.width !== width || l.height !== height) throw new Error(`Tower texture ${urls[i]} is ${l.width}x${l.height}, expected ${width}x${height}`);
    data.set(l.data, i * width * height * 4);
  });
  const tex = new THREE.DataArrayTexture(data, width, height, layers.length);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export async function loadFacadeTextures(anisotropy: number): Promise<PocFacadeTextures> {
  const load = (url: string) => new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  });
  const [diffuse, emissive, wallTex, interiorTex] = await Promise.all([
    loadArray([osakaDiff, glassDiff, skyDiff], true, anisotropy),
    loadArray([osakaEmit, glassEmit, skyEmit], true, anisotropy),
    load(walls),
    load(interiors),
  ]);
  return { diffuse, emissive, walls: wallTex, interiors: interiorTex };
}
