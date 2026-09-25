import * as THREE from 'three';
import facade from '../../art/style/facade.json';
import type { Layout } from '../systems/layout';

/** COLOR_0 surface data, as written by art/generators/lib/surface.py. */
const surfColor = (type: keyof typeof facade.types, fill: number, tint: number) =>
  [(facade.types[type] + 0.5) / 16, fill, tint] as const;

/**
 * Enclosed bridges from the layout (skybridges between towers, footbridges over core
 * streets) as one merged mesh drawn with the facade material: glazed office windows on the
 * long sides, a roof on top and a fluorescent-lit underside. Built with the
 * same vertex data the Blender generators write (surface type in color, facade meters in uv
 * with glTF's flipped v), so the facade shader treats them like any building face.
 */
export function createBridges(layout: Layout, material: THREE.Material): THREE.Mesh | null {
  const bridges = layout.bridges ?? [];
  if (!bridges.length) return null;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [];
  const quad = (c: THREE.Vector3[], n: THREE.Vector3, uvs: [number, number][], surf: readonly number[]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(c[k].x, c[k].y, c[k].z);
      nrm.push(n.x, n.y, n.z);
      uv.push(uvs[k][0], 1 - uvs[k][1]);
      col.push(...surf);
    }
  };
  bridges.forEach((b, i) => {
    const a = new THREE.Vector3(b.a[0], b.y, b.a[1]);
    const e = new THREE.Vector3(b.b[0], b.y, b.b[1]);
    const dir = e.clone().sub(a);
    const L = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(b.width / 2);
    const up = new THREE.Vector3(0, b.depth, 0);
    const tint = (i * 0.37) % 1;
    const glazing = surfColor('office', 1, tint);
    // Corners: l/r = left/right of the centerline, 0/1 = start/end, bottom and top.
    const l0 = a.clone().add(side), r0 = a.clone().sub(side), l1 = e.clone().add(side), r1 = e.clone().sub(side);
    const [l0t, r0t, l1t, r1t] = [l0, r0, l1, r1].map((p) => p.clone().add(up));
    const nL = side.clone().normalize(), nR = nL.clone().negate();
    // Long sides: u along the bridge, v up from the floor (window cells line up with floors).
    quad([r0, r1, r1t, r0t], nR, [[0, 0], [L, 0], [L, b.depth], [0, b.depth]], glazing);
    quad([l1, l0, l0t, l1t], nL, [[0, 0], [L, 0], [L, b.depth], [0, b.depth]], glazing);
    quad([r0t, r1t, l1t, l0t], new THREE.Vector3(0, 1, 0), [[0, 0], [L, 0], [L, b.width], [0, b.width]], surfColor('roof', 0, tint));
    // Lit underside (fluorescent tubes): footbridges light the street, skybridges read at night.
    quad([l0, l1, r1, r0], new THREE.Vector3(0, -1, 0), [[0, 0], [L, 0], [L, b.width], [0, b.width]], surfColor('soffit', 0, 0));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'bridges';
  return mesh;
}
