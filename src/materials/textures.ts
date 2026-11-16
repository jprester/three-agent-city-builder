import * as THREE from 'three';
import { loadKtx2 } from './ktx2';
import bakedOsaka from '../../art/textures/facades/baked_osaka.json';
import realGlass from '../../art/external/textures/real_glass.json';
import glassSky from '../../art/external/textures/glass_sky.json';
import baked from '../../art/textures/facades/baked.json';

/** Tower facade bundles, in the order the facade shader indexes them (TOWER_FACADES).
 * `baked_osaka` took the osaka photo set's place (its generated maps did not depict its photo).
 * `baked` is modelled and baked in Blender (npm run facades:bake); the city picks among all four
 * by seed (TOWER_CITY_BUNDLES in facade.ts). */
export const TOWER_BUNDLES: { facades: TowerFacade[] }[] = [bakedOsaka, realGlass, glassSky, baked];

/** What the facade shader reads of a tower facade (atlas UV units; grid in image space, y down). */
export interface TowerFacade {
  rect: number[];
  grid: number[];
  floor: number;
  bay: number;
  wrap: number[];
  /** No column rhythm: no whole bays are fitted across. */
  ribbon?: boolean;
}
export const TOWER_BUNDLE_NAMES = ['baked_osaka', 'real_glass', 'glass_sky', 'baked'];

/** Facades per bundle that the city draws from by seed (bundle * 7 + facade). */
export const TOWER_POOL = 7;
/**
 * Every tower facade in the shader's index order: the city's pool first (TOWER_POOL per
 * bundle), then each bundle's further facades, which no seed picks; an asset pins one by
 * index (lib.surface atlas_pin: a landmark's own style). `name` is the inspect label.
 */
export const TOWER_FACADES: { bundle: number; slot: number; name: string; facade: TowerFacade }[] = [
  ...TOWER_BUNDLES.flatMap((b, bundle) => b.facades.slice(0, TOWER_POOL).map((facade, slot) => ({ bundle, slot, facade }))),
  ...TOWER_BUNDLES.flatMap((b, bundle) => b.facades.slice(TOWER_POOL).map((facade, i) => ({ bundle, slot: TOWER_POOL + i, facade }))),
].map((t) => ({ ...t, name: `${['b2', 're', 'gl', 'bk'][t.bundle]}${t.slot}` }));

export interface FacadeTextures {
  /** One layer per bundle: diffuse (sRGB RGB) + roughness (A). */
  diffuse: THREE.Texture;
  emissive: THREE.Texture;
  normal: THREE.Texture;
  /** Wall materials, 4×2 cells: diffuse + roughness (A). */
  walls: THREE.Texture;
  /** Room cards behind lit windows (npm run interiors; tiles in interiors.json). */
  interiors: THREE.Texture;
}

/**
 * Load every facade texture before rendering. All are GPU-compressed (./ktx2.ts; sources
 * imported by tools/textures/import_highrise.py, encoded by `npm run textures`).
 *
 * The tower bundles of one kind share a texture array, one layer per bundle: three separate
 * textures per kind pushed the facade shader past 16 texture units (Apple GPUs), where the
 * extra samplers silently read nothing.
 */
export async function loadFacadeTextures(renderer: THREE.WebGLRenderer, anisotropy: number): Promise<FacadeTextures> {
  const towers = (kind: string) => loadKtx2(renderer, TOWER_BUNDLE_NAMES.map((b) => `tower_${b}_${kind}`), anisotropy);
  const [diffuse, emissive, normal, walls, interiors] = await Promise.all([
    towers('diffuse'), towers('emissive'), towers('normal'),
    loadKtx2(renderer, 'walls', anisotropy),
    loadKtx2(renderer, 'interiors', anisotropy),
  ]);
  return { diffuse, emissive, normal, walls, interiors };
}
