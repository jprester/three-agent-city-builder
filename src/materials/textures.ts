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
import osaka from '../../art/external/textures/osaka.json';
import realGlass from '../../art/external/textures/real_glass.json';
import glassSky from '../../art/external/textures/glass_sky.json';

/** Tower facade bundles, in the order the facade shader indexes them (bundle * 7 + facade). */
export const TOWER_BUNDLES = [osaka, realGlass, glassSky];

export interface FacadeTextures {
  /** Per bundle: diffuse (sRGB RGB) + roughness (A). */
  diffuse: THREE.Texture[];
  emissive: THREE.Texture[];
  normal: THREE.Texture[];
  /** Wall materials, 4×2 cells: diffuse + roughness (A). */
  walls: THREE.Texture;
}

/** Load every facade texture (imported by tools/textures/import_highrise.py) before rendering. */
export async function loadFacadeTextures(anisotropy: number): Promise<FacadeTextures> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string, srgb: boolean, repeat = false) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const [diffuse, emissive, normal, wallTex] = await Promise.all([
    Promise.all([osakaDiff, glassDiff, skyDiff].map((u) => load(u, true))),
    Promise.all([osakaEmit, glassEmit, skyEmit].map((u) => load(u, true))),
    Promise.all([osakaNorm, glassNorm, skyNorm].map((u) => load(u, false))),
    load(walls, true),
  ]);
  return { diffuse, emissive, normal, walls: wallTex };
}
