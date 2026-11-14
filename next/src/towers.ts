import * as THREE from 'three/webgpu';
import glassSky from '../../art/external/textures/glass_sky.json';
import skyDiff from '../../art/external/textures/glass_sky/diffuse_rough.webp?url';
import skyEmit from '../../art/external/textures/glass_sky/emissive.webp?url';
import osaka from '../../art/external/textures/osaka.json';
import osakaDiff from '../../art/external/textures/osaka/diffuse_rough.webp?url';
import osakaEmit from '../../art/external/textures/osaka/emissive.webp?url';
import realGlass from '../../art/external/textures/real_glass.json';
import glassDiff from '../../art/external/textures/real_glass/diffuse_rough.webp?url';
import glassEmit from '../../art/external/textures/real_glass/emissive.webp?url';

/**
 * The photographic tower facades the main app uses (art/external/textures, licences in
 * art/external/manifest.json): three bundles of seven facades each, a diffuse map with
 * roughness in alpha and an emissive map of the lit windows. The slice leaves out the normal
 * maps to keep GPU memory down (about 135 MB for the six maps with mips).
 */
export const BUNDLES = [osaka, realGlass, glassSky];
export const FACADES = BUNDLES.flatMap((b) => b.facades);
export const FACADES_PER_BUNDLE = 7;

export interface TowerTextures { diffuse: THREE.Texture[]; emissive: THREE.Texture[] }

export async function loadTowerTextures(): Promise<TowerTextures> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string, srgb: boolean) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    return t;
  };
  const [d0, d1, d2, e0, e1, e2] = await Promise.all([
    load(osakaDiff, true), load(glassDiff, true), load(skyDiff, true), load(osakaEmit, true), load(glassEmit, true), load(skyEmit, true),
  ]);
  return { diffuse: [d0, d1, d2], emissive: [e0, e1, e2] };
}
