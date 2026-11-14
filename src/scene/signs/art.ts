import * as THREE from 'three';
import catalog from '../../../art/external/textures/signs/catalog.json';
import { loadKtx2 } from '../../materials/ktx2';

/** One image sign / ad (tools/textures/import_ads.py catalog.json). Layout signs refer to it by index. */
export type ArtEntry = (typeof catalog.entries)[number];
export const ART_ENTRIES: ArtEntry[] = catalog.entries;

/** Atlas names in shader order: source code = index + 2 (0/1 are the typeset design atlas). */
export const ATLASES = ['neon_v', 'neon_h', 'posters_p', 'posters_l'] as const;
export const atlasCode = (e: ArtEntry) => ATLASES.indexOf(e.atlas as (typeof ATLASES)[number]) + 2;

export interface SignArt {
  atlases: THREE.Texture[];
  screens: THREE.Texture;
}

/** Typeset signs and illustrated campaigns, packed offline with emission in alpha. Loaded before the city renders. */
export async function loadSignArt(renderer: THREE.WebGLRenderer, anisotropy: number): Promise<SignArt> {
  const [v, h, p, l, s] = await Promise.all(['neon_v', 'neon_h', 'posters_p', 'posters_l', 'screens']
    .map((name) => loadKtx2(renderer, `signs_${name}`, anisotropy)));
  return { atlases: [v, h, p, l], screens: s };
}
