import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../../src/systems/layout';
import { isCameraMode, obstaclesFrom, pushOut } from '../../src/systems/cameras';
import { createWalkSurface } from '../../src/systems/walk';

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

  it('never puts a walker on a roof', () => {
    const p = new THREE.Vector3(104, 1.7, 50);
    expect(pushOut(p, box, 0.35, false)).toBe(false);
    expect(p.y).toBe(1.7);
    expect(p.x).toBeCloseTo(105.35, 5);
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

describe('walking surface', () => {
  const layout = {
    blocks: [{ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
  } as unknown as Parameters<typeof createWalkSurface>[0];

  it('steps onto sidewalks and stays on the road outside them', () => {
    const surface = createWalkSurface(layout);
    expect(surface.heightAt(5, 5)).toBeCloseTo(0.15, 5);
    expect(surface.heightAt(-5, 5)).toBe(0);
    expect(surface.heightAt(10, 5)).toBeCloseTo(0.15, 5);
  });

  it('treats no layout as flat ground', () => {
    expect(createWalkSurface(null).heightAt(100, -200)).toBe(0);
  });

  it('registers walk as a camera mode', () => {
    expect(isCameraMode('walk')).toBe(true);
  });
});
