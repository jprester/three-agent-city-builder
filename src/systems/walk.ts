import { insideConvex } from '../../art/layouts/lib/geom.mjs';
import type { Layout } from './layout';

/** Top of the raised sidewalks, matching the curb geometry in src/scene/streets.ts. */
export const SIDEWALK_HEIGHT = 0.15;

/** Height of the walkable surface at world (x, z): road at 0, sidewalk at SIDEWALK_HEIGHT. */
export interface WalkSurface {
  heightAt(x: number, z: number): number;
}

/**
 * The layout's block polygons are its sidewalks (src/scene/streets.ts builds the same
 * polygons). Walking therefore steps up 0.15 m onto a pavement and back down at the curb.
 */
export function createWalkSurface(layout: Layout | null, sidewalkHeight = SIDEWALK_HEIGHT): WalkSurface {
  const blocks = layout?.blocks ?? [];
  return {
    heightAt(x: number, z: number): number {
      for (const block of blocks) {
        if (insideConvex(block.points, [x, z], 0)) return sidewalkHeight;
      }
      return 0;
    },
  };
}
