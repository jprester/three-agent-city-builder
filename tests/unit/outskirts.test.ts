import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWalkSurface } from '../../src/systems/walk';
import { terrainHeight, terrainSurfaceHeight } from '../../art/layouts/lib/outskirts.mjs';
import { generateLayout } from '../../src/systems/layout';

describe('outskirts terrain', () => {
  it('leaves the city, all fringe buildings and the camera path in the flat basin', async () => {
    const layout = await generateLayout('city', 20260925);
    const height = (x: number, z: number) => terrainHeight(x, z, layout.size, layout.terrain!);
    for (const i of [...layout.instances, ...layout.fringe!]) {
      const radius = Math.hypot(...i.fp!);
      for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) {
        expect(height(i.position[0] + dx, i.position[2] + dz)).toBe(0);
      }
    }
    const curve = new THREE.CatmullRomCurve3(layout.flythrough!.points.map((p) => new THREE.Vector3(...p)), true);
    for (let i = 0; i < 4000; i++) {
      const p = curve.getPointAt(i / 4000);
      expect(p.y).toBeGreaterThan(height(p.x, p.z));
    }
    const surface = createWalkSurface(layout);
    for (const [x,z] of [[2310,1050], [2325,1065], [2340,1080]]) {
      expect(surface.heightAt(x,z)).toBeCloseTo(terrainSurfaceHeight(x,z,layout.size,layout.terrain!));
      expect(surface.heightAt(x,z)).toBeGreaterThan(0);
    }
    const hills = Array.from({ length: 100 }, (_, i) => height(2300, i * 40 - 2000));
    expect(Math.max(...hills)).toBeGreaterThan(100);
    expect(Math.min(...hills)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...hills)).toBeLessThanOrEqual(layout.terrain!.height);
  });
});
