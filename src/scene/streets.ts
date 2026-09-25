import * as THREE from 'three';
import palette from '../../art/style/palette.json';
import type { Layout, Vec2 } from '../systems/layout';

const color = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/** Ground plane edge length (m). Larger than twice the camera far plane so its edge is never on screen. */
const GROUND_SIZE = 12000;
const CURB_HEIGHT = 0.15;
/** Markings float this far above the asphalt to avoid z-fighting. */
const PAINT_LIFT = 0.02;

/**
 * Asphalt ground, raised sidewalks (every block polygon, with curbs) and lane markings,
 * each merged into one mesh. Geometry is in world space; UVs are world XZ in meters.
 */
export function createStreets(layout: Layout | null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'streets';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: color('road_wet'), roughness: 0.35, metalness: 0.0 }),
  );
  ground.name = 'ground';
  group.add(ground);
  if (!layout) return group;

  const sidewalks = new THREE.Mesh(
    sidewalkGeometry(layout.blocks.map((b) => b.points)),
    new THREE.MeshStandardMaterial({ color: color('sidewalk'), roughness: 0.8 }),
  );
  sidewalks.name = 'sidewalks';
  group.add(sidewalks);

  if (layout.roads?.length) {
    const paint = new THREE.Mesh(
      markingGeometry(layout),
      new THREE.MeshStandardMaterial({ color: color('paint'), roughness: 0.7 }),
    );
    paint.name = 'markings';
    group.add(paint);
  }
  return group;
}

function sidewalkGeometry(polygons: Vec2[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const vert = (x: number, y: number, z: number, n: THREE.Vector3) => {
    pos.push(x, y, z);
    nrm.push(n.x, n.y, n.z);
    uv.push(x, z);
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (const pts of polygons) {
    // Top: fan over the convex polygon. CCW in (x, z) faces -y, so reverse the winding.
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i + 1], pts[i]]) vert(p[0], CURB_HEIGHT, p[1], up);
    }
    // Curb faces, pointing out of the polygon (right of each CCW edge in x, z).
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const n = new THREE.Vector3(b[1] - a[1], 0, -(b[0] - a[0])).normalize();
      vert(a[0], 0, a[1], n); vert(b[0], CURB_HEIGHT, b[1], n); vert(b[0], 0, b[1], n);
      vert(a[0], 0, a[1], n); vert(a[0], CURB_HEIGHT, a[1], n); vert(b[0], CURB_HEIGHT, b[1], n);
    }
  }
  return toGeometry(pos, nrm, uv);
}

/** Dashed center lines on secondary/hero streets; double center line and lane dashes on arterials. */
function markingGeometry(layout: Layout): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const quad = (a: Vec2, b: Vec2, offset: number, w: number) => {
    const d = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(d[0], d[1]);
    const n = [-d[1] / l, d[0] / l];
    const o0 = offset - w / 2, o1 = offset + w / 2;
    const c = [
      [a[0] + n[0] * o0, a[1] + n[1] * o0], [b[0] + n[0] * o0, b[1] + n[1] * o0],
      [b[0] + n[0] * o1, b[1] + n[1] * o1], [a[0] + n[0] * o1, a[1] + n[1] * o1],
    ];
    // Same winding as the sidewalk tops: CCW in (x, z) faces -y, so emit reversed.
    for (const k of [0, 2, 1, 0, 3, 2]) {
      pos.push(c[k][0], PAINT_LIFT, c[k][1]);
      nrm.push(0, 1, 0);
      uv.push(c[k][0], c[k][1]);
    }
  };
  const dashed = (a: Vec2, b: Vec2, offset: number, dash: number, gap: number, w: number) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (s: number): Vec2 => [a[0] + ((b[0] - a[0]) * s) / l, a[1] + ((b[1] - a[1]) * s) / l];
    for (let s = 0; s + dash <= l; s += dash + gap) quad(at(s), at(s + dash), offset, w);
  };
  for (const r of layout.roads ?? []) {
    const l = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    // Keep markings out of the junctions at either end.
    const trim = Math.min(12, l / 4);
    const a: Vec2 = [r.a[0] + ((r.b[0] - r.a[0]) * trim) / l, r.a[1] + ((r.b[1] - r.a[1]) * trim) / l];
    const b: Vec2 = [r.b[0] - ((r.b[0] - r.a[0]) * trim) / l, r.b[1] - ((r.b[1] - r.a[1]) * trim) / l];
    if (r.cls === 'arterial') {
      quad(a, b, -0.2, 0.15);
      quad(a, b, 0.2, 0.15);
      dashed(a, b, -r.width / 4, 3, 6, 0.15);
      dashed(a, b, r.width / 4, 3, 6, 0.15);
    } else if (r.cls === 'secondary' || r.cls === 'hero') {
      dashed(a, b, 0, 3, 5, 0.12);
    }
  }
  return toGeometry(pos, nrm, uv);
}

function toGeometry(pos: number[], nrm: number[], uv: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
