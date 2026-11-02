import * as THREE from 'three';
import { coastDistance, coastline, seabedHeight } from '../../art/layouts/lib/island.mjs';
import palette from '../../art/style/palette.json';
import { createGroundMaterial, type GroundUniforms } from '../materials/ground';
import type { Layout, Vec2 } from '../systems/layout';
import { SIDEWALK_HEIGHT } from '../systems/walk';

const color = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/** Ground plane edge length (m). Larger than twice the camera far plane so its edge is never on screen. */
const GROUND_SIZE = 12000;
/** Ground mesh cells per side (100 m): the seabed and the mainland far away. */
const GROUND_CELLS = 120;
const CURB_HEIGHT = SIDEWALK_HEIGHT;
/** Markings float this far above the asphalt to avoid z-fighting. */
const PAINT_LIFT = 0.02;

/**
 * Asphalt ground, raised sidewalks (every block polygon, with curbs) and lane markings,
 * each merged into one mesh. Geometry is in world space; UVs are world XZ in meters.
 */
export function createStreets(layout: Layout | null, uniforms: GroundUniforms): THREE.Group {
  const group = new THREE.Group();
  group.name = 'streets';

  const island = layout?.island;
  const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_CELLS, GROUND_CELLS).rotateX(-Math.PI / 2);
  if (island) {
    // Seabed under the island and strait, the mainland's coastal plain and foothills beyond.
    const positions = groundGeometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) positions.setY(i, seabedHeight(positions.getX(i), positions.getZ(i), island));
    groundGeometry.computeVertexNormals();
  }
  const groundMaterial = createGroundMaterial(color('road_wet'), 0.35, uniforms, 1, 1, true);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.name = 'ground';
  group.add(ground);
  // Shared materials: each distinct ground variant is another shader program.
  const sidewalkMaterial = createGroundMaterial(color('sidewalk'), 0.8, uniforms, 0.8, 0.35);
  if (island) group.add(...islandMeshes(island, uniforms, groundMaterial, sidewalkMaterial));
  if (!layout) return group;
  const sidewalks = new THREE.Mesh(
    sidewalkGeometry(layout.blocks.map((b) => b.points)),
    sidewalkMaterial,
  );
  sidewalks.name = 'sidewalks';
  group.add(sidewalks);

  if (layout.roads?.length) {
    const paint = new THREE.Mesh(
      markingGeometry(layout),
      createGroundMaterial(color('paint'), 0.7, uniforms, 1, 0.5),
    );
    paint.name = 'markings';
    group.add(paint);
  }
  return group;
}

type Island = NonNullable<Layout['island']>;

/**
 * The island: flat land at 0 inside the coast (a fan over the star-shaped coastline; the ground
 * material, whose mainland lights stay off below 0.3 m), a raised promenade along the
 * waterfront and the quay wall down into the water (paving), and the water itself, a dark
 * mirror out to the horizon at the island's water level.
 */
function islandMeshes(island: Island, uniforms: GroundUniforms, land: THREE.Material, paving: THREE.Material): THREE.Mesh[] {
  const coast = coastline(island) as Vec2[];
  const sdf = (x: number, z: number) => coastDistance(x, z, island);
  const normal = ([x, z]: Vec2): Vec2 => {
    const gx = sdf(x + 1, z) - sdf(x - 1, z), gz = sdf(x, z + 1) - sdf(x, z - 1), l = Math.hypot(gx, gz);
    return [gx / l, gz / l];
  };
  const inner = coast.map((p) => { const n = normal(p); return [p[0] - n[0] * island.promenade, p[1] - n[1] * island.promenade] as Vec2; });
  const landMaterial = land;
  const landPos: number[] = [], walk: number[] = [], quay: number[] = [];
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const top = CURB_HEIGHT, foot = island.water - 0.4;
  for (let i = 0; i < coast.length; i++) {
    const j = (i + 1) % coast.length;
    const [p, q, pi, qi] = [coast[i], coast[j], inner[i], inner[j]];
    // CCW in (x, z) faces -y, so each upward face is emitted reversed.
    landPos.push(0, 0, 0, qi[0], 0, qi[1], pi[0], 0, pi[1]);
    quad(walk, [pi[0], top, pi[1]], [qi[0], top, qi[1]], [q[0], top, q[1]], [p[0], top, p[1]]);
    quad(walk, [pi[0], 0, pi[1]], [pi[0], top, pi[1]], [qi[0], top, qi[1]], [qi[0], 0, qi[1]]);   // inner curb
    quad(quay, [p[0], foot, p[1]], [p[0], top, p[1]], [q[0], top, q[1]], [q[0], foot, q[1]]);
  }
  const mesh = (pos: number[], material: THREE.Material, name: string) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((_, k) => (k % 3 === 0 ? [pos[k], pos[k + 2]] : [])), 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    return m;
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2).translate(0, island.water, 0),
    createGroundMaterial(color('water'), 0.1, uniforms, 0.15, 1.3, false, true),
  );
  water.name = 'water';
  return [
    mesh(landPos, landMaterial, 'island'),
    mesh(walk, paving, 'promenade'),
    mesh(quay, paving, 'quay'),
    water,
  ];
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
