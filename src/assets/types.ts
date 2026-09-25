/** Facts a generator declares about its asset (ctx.meta), embedded in the GLB. */
export interface AssetMeta {
  /** Body footprint [width (x), depth (z)] in meters, centered on the origin; excludes protrusions. */
  footprint?: readonly [number, number];
  /** Roof height in meters (excluding masts). */
  height?: number;
  /** Whether the layout may scale instances non-uniformly (facade shader compensates). */
  scalable?: boolean;
  /** Runtime material family, e.g. "facade". Absent: use the GLB's own materials. */
  shader?: string;
  [key: string]: unknown;
}

export interface AssetEntry {
  /** Path relative to the site base, e.g. "assets/buildings/tower_a.glb". */
  url: string;
  category: string;
  meta: AssetMeta;
}
