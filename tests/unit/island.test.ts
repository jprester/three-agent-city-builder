import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWalkSurface } from '../../src/systems/walk';
import { coastDistance, landHeight, seabedHeight } from '../../art/layouts/lib/island.mjs';
import { generateLayout } from '../../src/systems/layout';

describe('island', () => {
  it('holds the city and every building on flat land, with water and mainland hills around it', async () => {
    const layout = await generateLayout('city', 20260925);
    const isle = layout.island!;
    const [W, D] = layout.size;
    // The whole city rectangle is on the island, with room for the ring road.
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]]) {
      expect(coastDistance(x, z, isle)).toBeLessThan(-40);
    }
    for (const i of [...layout.instances, ...layout.fringe!]) expect(landHeight(i.position[0], i.position[2], isle)).toBe(0);
    // The camera path never dips under the land or the water.
    const curve = new THREE.CatmullRomCurve3(layout.flythrough!.points.map((p) => new THREE.Vector3(...p)), true);
    for (let i = 0; i < 2000; i++) {
      const p = curve.getPointAt(i / 2000);
      expect(p.y).toBeGreaterThan(Math.max(landHeight(p.x, p.z, isle), isle.water));
    }
    // Just off the coast the seabed is under water; the south opens to the sea.
    expect(seabedHeight(0, D / 2 + 300, isle)).toBeLessThan(isle.water);
    expect(seabedHeight(0, 3000, isle)).toBeLessThan(isle.water);
    // Across the northern strait: a mainland plain, then hills.
    const north = Array.from({ length: 80 }, (_, i) => seabedHeight(0, -1200 - i * 50, isle));
    expect(Math.max(...north)).toBeGreaterThan(100);
    expect(north.some((h) => h > isle.water && h < 3)).toBe(true);
    // Walking: flat on the island's streets, raised on sidewalks.
    const surface = createWalkSurface(layout);
    expect(surface.heightAt(-W / 2 - 9, 0)).toBe(0);
  });
});
