import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Layout } from '../../src/systems/layout';
import { createBridges } from '../../src/scene/bridges';

describe('enclosed bridges', () => {
  const layout = {
    bridges: [{ kind: 'sky', a: [0, 0], b: [10, 0], y: 5, width: 4, depth: 3 }],
  } as unknown as Layout;

  it('builds a closed box with outward-facing triangles', () => {
    const mesh = createBridges(layout, new THREE.MeshBasicMaterial())!;
    const pos = mesh.geometry.getAttribute('position');
    const nrm = mesh.geometry.getAttribute('normal');
    // Two long sides, roof, soffit, two end caps and four fascia strips.
    expect(pos.count).toBe(20 * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), face = new THREE.Vector3();
    const supplied = new THREE.Vector3(), sum = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      face.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      sum.set(0, 0, 0);
      for (let k = 0; k < 3; k++) sum.add(supplied.fromBufferAttribute(nrm, i + k));
      expect(face.dot(sum), `triangle ${i / 3} is wound inward`).toBeGreaterThan(0);
    }
  });

  it('caps the ends instead of leaving them open', () => {
    const mesh = createBridges(layout, new THREE.MeshBasicMaterial())!;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(10, 5);
    expect(box.min.z).toBeCloseTo(-2, 5);
    expect(box.max.z).toBeCloseTo(2, 5);
  });
});
