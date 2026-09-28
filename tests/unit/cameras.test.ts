import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../../src/systems/layout';
import { obstaclesFrom, pushOut } from '../../src/systems/cameras';

describe('free-fly collision', () => {
  // A 20 × 10 m footprint (half extents 10, 5), 30 m tall, rotated 90°.
  const box = obstaclesFrom([{ position: [100, 0, 50], rotationY: Math.PI / 2, fp: [10, 5], h: 30 }]);

  it('pushes the camera out through the nearest wall, in the building frame', () => {
    // Rotated 90°: the 10 m half extent runs along world z, the 5 m one along world x.
    const p = new THREE.Vector3(104, 10, 50);
    expect(pushOut(p, box)).toBe(false);
    expect(p.x).toBeCloseTo(105.8, 5);
    expect(p.z).toBeCloseTo(50, 5);
  });

  it('lifts the camera onto the roof when that is the shallowest way out', () => {
    const p = new THREE.Vector3(100, 29.5, 50);
    expect(pushOut(p, box)).toBe(true);
    expect(p.y).toBeCloseTo(30.8, 5);
  });

  it('leaves a camera outside every building where it is', async () => {
    const L = await generateLayout('city', 1);
    const obstacles = obstaclesFrom(L.instances);
    expect(obstacles.length).toBe(L.instances.length);
    // Every flythrough control point is clear of buildings, so none should move.
    for (const q of L.flythrough!.points) {
      const p = new THREE.Vector3(...q);
      pushOut(p, obstacles);
      expect(p.distanceTo(new THREE.Vector3(...q))).toBeLessThan(1e-9);
    }
  });
});
