import * as THREE from 'three';
import { loadKtx2 } from './ktx2';
import bakedOsaka from '../../art/textures/facades/baked_osaka.json';
import bakedGlass from '../../art/textures/facades/baked_glass.json';
import bakedSky from '../../art/textures/facades/baked_sky.json';
import baked from '../../art/textures/facades/baked.json';

/** Tower facade bundles, in the order the facade shader indexes them (TOWER_FACADES). All four
 * are modelled and baked in Blender (npm run facades:bake, docs/FACADES.md); `baked_osaka`,
 * `baked_glass` and `baked_sky` took the layers of the osaka, real_glass and glass_sky photo sets.
 * The city picks among all four by seed (TOWER_CITY_BUNDLES in facade.ts). */
export const TOWER_BUNDLES: { facades: TowerFacade[] }[] = [bakedOsaka, bakedGlass, bakedSky, baked];

/** What the facade shader reads of a tower facade (atlas UV units; grid in image space, y down). */
export interface TowerFacade {
  rect: number[];
  grid: number[];
  floor: number;
  bay: number;
  wrap: number[];
  /** No column rhythm: no whole bays are fitted across. */
  ribbon?: boolean;
  /** Reflection tint of the facade's glass (linear RGB); absent: neutral. */
  tint?: number[];
  style?: string;
  floors?: number;
  bays?: number;
  /** Glass opening in the cell: left, bottom, width, height (fractions of bay and floor). */
  open?: number[];
  /** Interiors set of the rooms (office | residential). */
  rooms_set?: string;
  /** Per window, floor-major from the bottom: [warm, card, gain, index in room, windows in room, blind]; null: unlit. */
  rooms?: (number[] | null)[];
}
export const TOWER_BUNDLE_NAMES = ['baked_osaka', 'baked_glass', 'baked_sky', 'baked'];

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
].map((t) => ({ ...t, name: `${['b2', 'bg', 'bs', 'bk'][t.bundle]}${t.slot}` }));

/**
 * The tower facades' lit rooms (tools/textures/pack_facades.py) as an RGBA8 table for the room
 * parallax in src/materials/facade/surface-towers.ts: one row per facade floor (TOWER_ROOM_ROWS
 * gives each facade's first row), two texels per bay: (lit*128 + warm*64 + card, gain*255,
 * index in room, windows in room) and (blind share*255, 0, 0, 0).
 */
export const TOWER_ROOM_ROWS: number[] = TOWER_FACADES.map((_, i) =>
  TOWER_FACADES.slice(0, i).reduce((n, t) => n + (t.facade.floors ?? 1), 0));
export function createTowerRoomTexture(): THREE.DataTexture {
  const width = 2 * Math.max(1, ...TOWER_FACADES.map((t) => t.facade.bays ?? 1));
  const rows = TOWER_FACADES.reduce((n, t) => n + (t.facade.floors ?? 1), 0);
  const data = new Uint8Array(width * rows * 4);
  TOWER_FACADES.forEach((t, i) => {
    const { floors = 0, bays = 0, rooms = [] } = t.facade;
    for (let fl = 0; fl < floors; fl++) for (let b = 0; b < bays; b++) {
      const r = rooms[fl * bays + b];
      if (!r) continue;
      const [warm, card, gain, idx, n, blind] = r;
      const at = ((TOWER_ROOM_ROWS[i] + fl) * width + 2 * b) * 4;
      data.set([128 + warm * 64 + card, Math.round(Math.min(1, gain) * 255), idx, n], at);
      data[at + 4] = Math.round(blind * 255);
    }
  });
  const tex = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

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

/**
 * Street materials (GROUND_SURFACES in ./ground.ts): albedo + height and normal texture arrays,
 * one layer per surface, repeating (tools/textures/pack_ground.py, encoded by `npm run textures`).
 */
export async function loadGroundTextures(renderer: THREE.WebGLRenderer, layers: string[], anisotropy: number) {
  const [albedo, normal] = await Promise.all(['albedo', 'normal'].map((kind) => loadKtx2(renderer, layers.map((l) => `ground_${l}_${kind}`), anisotropy)));
  for (const t of [albedo, normal]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { albedo, normal };
}
