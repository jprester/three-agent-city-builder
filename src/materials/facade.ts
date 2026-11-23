import * as THREE from 'three';
import { FRAGMENT_COMMON } from './facade/common';
import { SURFACE_LIGHT } from './facade/surface-light';
import { SURFACE_PROPS } from './facade/surface-props';
import { SURFACE_SETUP } from './facade/surface-setup';
import { SURFACE_TOWERS } from './facade/surface-towers';
import { SURFACE_WALLS } from './facade/surface-walls';
import { VERTEX_GAIT_NORMAL, VERTEX_GAIT_POSITION, VERTEX_INSTANCE, VERTEX_PARS, VERTEX_WORLD } from './facade/vertex';
import { FRAGMENT_WINDOWS } from './facade/windows';
import { createTowerRoomTexture, type FacadeTextures } from './textures';

/**
 * The one material for every facade-shaded asset (buildings, and props built from the same
 * surface types). Geometry carries only what protrudes; windows, storefronts, lit canopies
 * and fixtures are shaded here from two vertex channels written by the Blender generators
 * (art/generators/lib/surface.py):
 *   COLOR_0     r: surface type, g: window opening pattern / type parameter, b: tint
 *   TEXCOORD_0  facade coordinates in meters (u along, v up; glTF-flipped v)
 * Three sources of detail:
 *   - "atlas" faces (tower shafts, office bodies) map the baked tower facades (modelled and
 *     rendered in Blender, docs/FACADES.md) at real scale;
 *   - residential/office windows are interior-mapped rooms with frames, sills and recesses;
 *   - walls sample image materials (tile, concrete, panels, metal) with luminance relief.
 *
 * Extends MeshStandardMaterial via onBeforeCompile so lighting, fog and tone mapping apply.
 * The GLSL lives in src/materials/facade/ (constants, vertex, common, windows, surface-*).
 */
export interface FacadeUniforms {
  uTime: { value: number };
  /** How late it is (src/scene/night.ts): lit windows and small shops switch off as it rises. */
  uNight: { value: number };
  /** Layout seed: all window randomness derives from it plus the instance position. */
  uSeed: { value: number };
  /** Top-down street-light intensity (see src/scene/lampmap.ts). */
  uLampMap: { value: THREE.Texture | null };
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp map in world meters. */
  uLampRect: { value: THREE.Vector4 };
  /** Overall window emission multiplier (debug tuning). */
  uWindowGain: { value: number };
  uCityGlow: { value: number };
  /** 1 by day (src/scene/daylight.ts): painted night light fades, walls get their albedo back. */
  uDay: { value: number };
  /** Inspect (?inspect=): force tower facade n (TOWER_FACADES index); -1 = by seed or pin. */
  uFacadePick: { value: number };
  /** Inspect: 1 draws the shader's floor (red), bay / cell (cyan) and module (yellow) lines. */
  uGridOverlay: { value: number };
  /** Tower bundles, one array layer each (src/materials/textures.ts). */
  uTowerDiff: { value: THREE.Texture | null };
  uTowerEmit: { value: THREE.Texture | null };
  uTowerNorm: { value: THREE.Texture | null };
  uWalls: { value: THREE.Texture | null };
  /** Top-down colored sign glow (same rect as the lamp map). */
  uSignMap: { value: THREE.Texture | null };
  /** Video-screen poster atlas (src/scene/screens.ts). */
  uScreens: { value: THREE.Texture | null };
  /** City cube capture reflected by tower glass (src/scene/environment-map.ts); null: sky only. */
  uGlassEnv: { value: THREE.CubeTexture | THREE.Texture | null };
  /** 1 once uGlassEnv holds a capture (0 while it is being captured). */
  uGlassOn: { value: number };
  /** Strength of the glass reflection (debug tuning). */
  uGlassGain: { value: number };
  /** Room-card atlas behind lit windows (src/materials/textures.ts). */
  uInteriors: { value: THREE.Texture | null };
  /** Tower facades' lit rooms (createTowerRoomTexture). */
  uTowerRooms: { value: THREE.Texture | null };
}

// Fragment declarations, after #include <common>.
const FRAGMENT_PARS = FRAGMENT_COMMON + FRAGMENT_WINDOWS;
// Replaces color_fragment (vertex colors are data, not albedo). One if/else-if chain over the
// surface type runs from SURFACE_TOWERS to the end of SURFACE_PROPS, so keep the order.
const FRAGMENT_SURFACE = SURFACE_SETUP + SURFACE_TOWERS + SURFACE_WALLS + SURFACE_PROPS + SURFACE_LIGHT;

export function createFacadeMaterial(uniforms: FacadeUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true });
  material.name = 'facade';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <batching_vertex>', VERTEX_INSTANCE)
      .replace('#include <beginnormal_vertex>', VERTEX_GAIT_NORMAL)
      .replace('#include <begin_vertex>', VERTEX_GAIT_POSITION)
      .replace('#include <project_vertex>', VERTEX_WORLD)
      // vColor is data here; keep three's color_vertex from multiplying anything.
      .replace('#include <color_vertex>', '');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(fNormalW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fEmit;');
  };
  material.customProgramCacheKey = () => 'facade-v22';
  return material;
}

let towerRooms: THREE.DataTexture | undefined;
export function createFacadeUniforms(time: { value: number }, seed: number, textures: FacadeTextures | null): FacadeUniforms {
  const t = textures;
  return {
    uTime: time,
    uNight: { value: 0 },
    uSeed: { value: seed },
    uLampMap: { value: null },
    uLampRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uWindowGain: { value: 1 },
    uCityGlow: { value: 0.07 },
    uDay: { value: 0 },
    uFacadePick: { value: -1 },
    uGridOverlay: { value: 0 },
    uTowerDiff: { value: t?.diffuse ?? null },
    uTowerEmit: { value: t?.emissive ?? null },
    uTowerNorm: { value: t?.normal ?? null },
    uWalls: { value: t?.walls ?? null },
    uSignMap: { value: null },
    uScreens: { value: null },
    uGlassEnv: { value: null },
    uGlassOn: { value: 0 },
    uGlassGain: { value: 1.15 },
    uInteriors: { value: t?.interiors ?? null },
    uTowerRooms: { value: towerRooms ??= createTowerRoomTexture() },
  };
}
