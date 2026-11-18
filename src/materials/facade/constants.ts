import * as THREE from 'three';
import facade from '../../../art/style/facade.json';
import palette from '../../../art/style/palette.json';
import interiors from '../../../art/textures/interiors/interiors.json';
import { GLASS_PROBE_Y } from '../../scene/environment-map';
import { TOWER_FACADES } from '../textures';

// Constants the facade shader is built from: surface type ids, cell sizes, palette colours,
// the tower facade table and the room-card tables, all as GLSL (DEFINES) generated from the
// art/ JSON files, so the shader and the generators share one source of truth.

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);
const glslColor = (name: keyof typeof palette) => {
  const col = c(name); // THREE.Color is linear once parsed from sRGB hex
  return `vec3(${col.r.toFixed(5)}, ${col.g.toFixed(5)}, ${col.b.toFixed(5)})`;
};
const f = (v: number) => v.toFixed(6);
export const T = facade.types;
export const C = facade.cells;

// Tower facade table: grid (u0, v0, u1, v1 in image space, y down; whole floors and bays,
// edges on floor/bay lines; tools/textures/facade_grid.py) and
// (floor height, bay width, wrap width, wrap height) in atlas UV units.
const towerFacades = TOWER_FACADES.map((t) => t.facade);
/** Bundles the city picks from by seed: all four baked bundles (TOWER_BUNDLES). */
export const TOWER_CITY_BUNDLES = 4;
/** Texels across a tower bundle texture (tools/textures/import_highrise.py SIZE; KTX2 keeps it). */
export const ATLAS_SIZE = 2048;
export const TF_COUNT = towerFacades.length;
const TF_RECT = towerFacades.map((t) => `vec4(${t.grid.map(f).join(', ')})`).join(',\n  ');
// A ribbon facade (no column rhythm) stores its bay negated: the shader fits no bays across it.
const TF_LAYER = TOWER_FACADES.map((t) => t.bundle).join(', ');
const TF_TINT = towerFacades.map((t) => `vec3(${(t.tint ?? [1, 1, 1]).map(f).join(', ')})`).join(',\n  ');
const TF_DIM = towerFacades.map((t) => `vec4(${f(t.floor)}, ${f(t.ribbon ? -t.bay : t.bay)}, ${f(t.wrap[0])}, ${f(t.wrap[1])})`).join(',\n  ');

// Room cards (art/textures/interiors, npm run interiors): room box (W, H, D, camera distance)
// and tile rects in texture UVs (u0, v0, u1, v1; the texture loads flipped, so v0 is the
// tile's bottom edge = the room's floor side).
const [IA_W, IA_H] = interiors.size;
const roomBox = (s: { width: number; height: number; depth: number; camera: number }) =>
  `vec4(${f(s.width)}, ${f(s.height)}, ${f(s.depth)}, ${f(s.camera)})`;
const tileList = (t: number[][]) => t.map(([x0, y0, x1, y1]) =>
  `vec4(${f(x0 / IA_W)}, ${f(1 - y1 / IA_H)}, ${f(x1 / IA_W)}, ${f(1 - y0 / IA_H)})`).join(', ');
export const RES_SET = interiors.sets.residential, OFF_SET = interiors.sets.office, SHOP_SET = interiors.sets.shops;

export const DEFINES = /* glsl */ `
#define T_RES ${T.residential}
#define T_OFFICE ${T.office}
#define T_CURTAIN ${T.curtain}
#define T_PODIUM ${T.podium}
#define T_ROOF ${T.roof}
#define T_TRIM ${T.trim}
#define T_METAL ${T.metal}
#define T_CAGE ${T.cage}
#define T_SOFFIT ${T.soffit}
#define T_FIXTURE ${T.fixture}
#define T_ATLAS ${T.atlas}
#define T_SCREEN ${T.screen}
#define T_DECK ${T.deck}
#define T_TOWER_RES ${T.tower_res}
#define T_GLASS ${T.glass}
#define T_FOLIAGE ${T.foliage}
const vec4 SHOP_BOX = ${roomBox(SHOP_SET)};
const vec4 SHOP_TILES[${SHOP_SET.tiles.length}] = vec4[${SHOP_SET.tiles.length}](${tileList(SHOP_SET.tiles)});
const float SHOP_PX_M = ${f((SHOP_SET.tiles[0][2] - SHOP_SET.tiles[0][0]) / SHOP_SET.width)};
const vec4 RES_BOX = ${roomBox(RES_SET)};
const vec4 OFF_BOX = ${roomBox(OFF_SET)};
const int RES_CARDS = ${RES_SET.tiles.length};
const int OFF_CARDS = ${OFF_SET.tiles.length};
const vec4 RES_TILES[${RES_SET.tiles.length}] = vec4[${RES_SET.tiles.length}](${tileList(RES_SET.tiles)});
const vec4 OFF_TILES[${OFF_SET.tiles.length}] = vec4[${OFF_SET.tiles.length}](${tileList(OFF_SET.tiles)});
// Card pixels per meter of the room front, for the mip level.
const float RES_PX_M = ${f((RES_SET.tiles[0][2] - RES_SET.tiles[0][0]) / RES_SET.width)};
const float OFF_PX_M = ${f((OFF_SET.tiles[0][2] - OFF_SET.tiles[0][0]) / OFF_SET.width)};
const vec2 CELL_RES = vec2(${f(C.residential.w)}, ${f(C.residential.h)});
const vec2 CELL_OFFICE = vec2(${f(C.office.w)}, ${f(C.office.h)});
const vec2 CELL_CURTAIN = vec2(${f(C.curtain.w)}, ${f(C.curtain.h)});
const vec2 CELL_PODIUM = vec2(${f(C.podium.w)}, ${f(C.podium.h)});
const vec3 P_CONCRETE = ${glslColor('concrete')};
const vec3 P_CONCRETE_DARK = ${glslColor('concrete_dark')};
const vec3 P_TILE = ${glslColor('tile_stained')};
const vec3 P_METAL = ${glslColor('metal_dark')};
const vec3 P_GLASS = ${glslColor('glass_dark')};
const vec3 P_TUNGSTEN = ${glslColor('tungsten')};
const vec3 P_FLUORESCENT = ${glslColor('fluorescent')};
const vec3 OFFICE_WHITE = ${glslColor('office_white')};
const vec3 P_FOLIAGE = ${glslColor('foliage')};
// Room cards are rendered in neutral light (linear ~0.1-0.6); scales them to window brightness
// while keeping them below the tone mapper's shoulder, so the furniture stays readable.
const float INTERIOR_GAIN = 0.85;
// Height of the startup glass cube capture and the typical roof line of the old core, for the
// street-canyon reflection in glassReflection().
const float GLASS_CAPTURE_Y = ${f(GLASS_PROBE_Y)};
const float CANYON_TOP = 70.0;
const vec3 P_TV = ${glslColor('tv_blue')};
const vec3 P_SODIUM = ${glslColor('sodium')};
const vec3 P_RED = ${glslColor('sign_red')};
const vec3 P_HAZE = ${glslColor('haze')};
const vec3 P_SKY = ${glslColor('sky')};
const vec3 P_CYAN = ${glslColor('sign_cyan')};
const vec3 P_AMBER = ${glslColor('sign_amber')};
const vec3 P_PAINT[4] = vec3[4](${glslColor('paint_mint')}, ${glslColor('paint_salmon')}, ${glslColor('paint_cream')}, ${glslColor('paint_blue')});
// Car paints in CAR_PAINTS order (art/generators/vehicles/car.py); CAR_PICK weights the
// random choice toward the white / black / grey / silver of a real street.
const vec3 P_CAR[12] = vec3[12](${glslColor('car_white')}, ${glslColor('car_black')}, ${glslColor('car_grey')}, ${glslColor('car_silver')}, ${glslColor('car_navy')}, ${glslColor('car_red')}, ${glslColor('car_green')}, ${glslColor('car_beige')}, ${glslColor('car_yellow')}, ${glslColor('car_orange')}, ${glslColor('paint_mint')}, ${glslColor('paint_blue')});
const int CAR_PICK[16] = int[16](0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 11, 10);
const vec3 P_INTERIOR[4] = vec3[4](${glslColor('interior_white')}, ${glslColor('interior_fabric')}, ${glslColor('interior_carpet')}, ${glslColor('interior_wood')});
const vec3 P_CLAD[3] = vec3[3](${glslColor('clad_terracotta')}, ${glslColor('clad_cream')}, ${glslColor('clad_charcoal')});
const vec4 TF_RECT[${TF_COUNT}] = vec4[${TF_COUNT}](
  ${TF_RECT});
const int TF_LAYER[${TF_COUNT}] = int[${TF_COUNT}](${TF_LAYER});
const vec4 TF_DIM[${TF_COUNT}] = vec4[${TF_COUNT}](
  ${TF_DIM});
// Coated glass reflects in its own hue (art/facades/<bundle>.json glass, packed as tint).
const vec3 TF_TINT[${TF_COUNT}] = vec3[${TF_COUNT}](
  ${TF_TINT});
`;
