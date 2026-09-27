import { ASSETS } from '../assets/manifest.gen';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface LayoutInstance {
  asset: string;
  position: Vec3;
  rotationY: number;
  /** Uniform or per-axis scale. */
  scale: number | Vec3;
  /** Per-instance seed for runtime variation. */
  seed?: number;
  district?: string;
  /** Roof height (m) after scaling. */
  h?: number;
  /** Footprint half-extents [along local x, along local z] after scaling. */
  fp?: Vec2;
}

export interface LayoutRoad {
  id: number;
  cls: 'arterial' | 'secondary' | 'alley' | 'hero';
  width: number;
  a: Vec2;
  b: Vec2;
}

export interface LayoutBlock {
  district: string;
  /** Convex CCW polygon in (x, z): the sidewalk outline. */
  points: Vec2[];
  /** Road id bordering each edge (points[i] -> points[i+1]), -1 for the city edge. */
  edges?: number[];
}

export interface LayoutSign {
  /** Index into instances of the building it hangs on. */
  building: number;
  /** blade: projects from the facade, faces along the street; panel: flat on the facade. */
  kind: 'blade' | 'panel';
  /** Center, meters. */
  position: Vec3;
  /** Rotation so the sign's +Z face points along its normal. */
  rotationY: number;
  /** [width, height, depth] */
  size: Vec3;
  seed: number;
  /** Panels on a set-back tower tier: distance of that wall behind the footprint face. */
  inset?: number;
}

/** Named frame on the ground: origin and forward axis (x, z). Viewpoints can be relative to it. */
export interface LayoutAnchor {
  origin: Vec3;
  x: Vec2;
}

export interface Layout {
  name: string;
  version: number;
  seed: number;
  size: Vec2;
  blocks: LayoutBlock[];
  instances: LayoutInstance[];
  roads?: LayoutRoad[];
  hero?: { road: number; width: number; a: Vec2; b: Vec2 } | null;
  /** [x, z, arm angle, road id] */
  lamps?: [number, number, number, number][];
  /** Street furniture (same shape as instances; always facade-shaded props). */
  props?: LayoutInstance[];
  signs?: LayoutSign[];
  /** Enclosed bridges: centerline a→b on the ground plane, floor at y, `depth` tall. */
  bridges?: { kind: 'sky' | 'foot'; a: Vec2; b: Vec2; y: number; width: number; depth: number }[];
  anchors?: Record<string, LayoutAnchor>;
  /** Camera path for the cinematic flythrough; `look` holds a look-at target per control point. */
  flythrough?: { points: Vec3[]; look?: Vec3[]; closed?: boolean };
}

export async function fetchLayout(url: string): Promise<Layout> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Layout request failed (${res.status}): ${url}`);
  return (await res.json()) as Layout;
}

// In-browser regeneration for `?seed=`. Uses the same generator modules as
// tools/build-layouts.mjs, so they must stay browser-safe (enforced at build).
const layoutDefs = import.meta.glob('/art/layouts/defs/*.json', { import: 'default' });
const layoutGenerators = import.meta.glob('/art/layouts/*.mjs');

interface LayoutDef {
  generator: string;
  seed?: number;
  params?: Record<string, unknown>;
}

interface LayoutGeneratorModule {
  generate(input: { params: Record<string, unknown>; seed: number; assets: typeof ASSETS }): Omit<Layout, 'name'>;
}

export async function generateLayout(id: string, seed: number): Promise<Layout> {
  const loadDef = layoutDefs[`/art/layouts/defs/${id}.json`];
  if (!loadDef) throw new Error(`No layout def "${id}" in art/layouts/defs/`);
  const def = (await loadDef()) as LayoutDef;
  const loadGen = layoutGenerators[`/art/layouts/${def.generator}.mjs`];
  if (!loadGen) throw new Error(`Layout generator "${def.generator}" not found in art/layouts/`);
  const mod = (await loadGen()) as LayoutGeneratorModule;
  return { name: id, ...mod.generate({ params: def.params ?? {}, seed, assets: ASSETS }) };
}
