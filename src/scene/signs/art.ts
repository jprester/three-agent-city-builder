import * as THREE from 'three';
import catalog from '../../../art/textures/signs/catalog.json';
import { loadKtx2 } from '../../materials/ktx2';

/**
 * One sign or ad (tools/textures/build_signs.py, art/signs/signs.def.json): a business's fascia,
 * blade, tenant panel, billboard or neon overhang, or a brand's campaign or crown lettering.
 * Layout signs refer to it by index.
 */
export interface ArtEntry {
  id: string;
  owner: string;
  format: string;
  /** Atlas index (signs_<i>). */
  atlas: number;
  /** UV rect u0, v0, du, dv (v up). */
  rect: number[];
  aspect: number;
  /** Lettering on black, drawn additive with no board (crown wordmarks). */
  holo: boolean;
  /** Dominant light colour (linear-ish RGB 0..1) for the sign light map. */
  color: number[];
  gain: number;
  script?: string;
  brand?: boolean;
}
export const ART_ENTRIES: ArtEntry[] = catalog.entries as ArtEntry[];
/** The sign shaders bind four atlases; unused slots get the first. */
export const ATLAS_SLOTS = 4;

export interface SignArt {
  atlases: THREE.Texture[];
  screens: THREE.Texture;
}

/** The sign atlases and the screen grid, packed offline (RGB colour, alpha = emission mask). */
export async function loadSignArt(renderer: THREE.WebGLRenderer, anisotropy: number): Promise<SignArt> {
  const names = catalog.atlases.map((_, i) => `signs_${i}`);
  const textures = await Promise.all([...names, 'signs_screens'].map((name) => loadKtx2(renderer, name, anisotropy)));
  const screens = textures.pop()!;
  while (textures.length < ATLAS_SLOTS) textures.push(textures[0]);
  return { atlases: textures, screens };
}
