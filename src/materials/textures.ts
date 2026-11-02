import * as THREE from 'three';
import walls from '../../art/external/textures/walls.webp?url';
import interiors from '../../art/textures/interiors/interiors.webp?url';

export interface FacadeTextures {
  /** Wall materials, 4×2 cells: diffuse + roughness (A). */
  walls: THREE.Texture;
  /** Room cards behind lit windows (npm run interiors; tiles in interiors.json). */
  interiors: THREE.Texture;
}

/** Load the facade textures (wall materials, room cards) before rendering. */
export async function loadFacadeTextures(anisotropy: number): Promise<FacadeTextures> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string, srgb: boolean, repeat = false) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const [wallTex, interiorTex] = await Promise.all([load(walls, true), load(interiors, true)]);
  return { walls: wallTex, interiors: interiorTex };
}
