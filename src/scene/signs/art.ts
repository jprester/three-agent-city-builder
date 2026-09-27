import * as THREE from 'three';
import catalog from '../../../art/textures/advertising/catalog.json';
import neonV from '../../../art/textures/advertising/neon_v.webp?url';
import neonH from '../../../art/textures/advertising/neon_h.webp?url';
import posterP from '../../../art/textures/advertising/posters_p.webp?url';
import posterL from '../../../art/textures/advertising/posters_l.webp?url';
import screens from '../../../art/textures/advertising/screens.webp?url';

/** One image sign / ad (tools/textures/build_advertising.py catalog.json). Layout signs refer to it by index. */
export type ArtEntry = (typeof catalog.entries)[number];
export const ART_ENTRIES: ArtEntry[] = catalog.entries;

/** Atlas names in shader order: source code = index + 2 (0/1 are the stroke atlas). */
export const ATLASES = ['neon_v', 'neon_h', 'posters_p', 'posters_l'] as const;
export const atlasCode = (e: ArtEntry) => ATLASES.indexOf(e.atlas as (typeof ATLASES)[number]) + 2;

export interface SignArt {
  atlases: THREE.Texture[];
  screens: THREE.Texture;
}

/** Typeset signs and illustrated campaigns, packed offline with emission in alpha. Loaded before the city renders. */
export async function loadSignArt(anisotropy: number): Promise<SignArt> {
  const loader = new THREE.TextureLoader();
  const load = async (url: string) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };
  const [v, h, p, l, s] = await Promise.all([neonV, neonH, posterP, posterL, screens].map(load));
  return { atlases: [v, h, p, l], screens: s };
}
