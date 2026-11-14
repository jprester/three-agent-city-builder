import * as THREE from 'three/webgpu';
import { mulberry32, weightedChoice } from '../../art/layouts/lib/rng.mjs';
import catalog from '../assets/signs.json';
import { FLOOR_HEIGHT, HOUSING_PODIUM, SIDEWALK_HEIGHT, buildingSections, sidewalks, type Building, type Plan } from './plan';
import { paletteColor, type PaletteName } from './tsl';

/** Facade grid per style: bay width, and the ground floor the shopfronts occupy. Shared with the facade shader. */
export const BAY = [3.2, 2.4, 3.2, 1.6, 3.2];
export const PODIUM = 4.5;
export const SHOP_BAY = 4.5;

const col = (name: PaletteName, k = 1) => paletteColor(name).multiplyScalar(k);
const DECORATIVE_TOWER_LIGHTS = false;

/**
 * Every building, near to horizon, as one mesh: four walls and a roof per section, with
 * facade coordinates in meters. No windows are modelled; the facade material draws them and
 * reduces them with distance, so the three tiers (street, mid-rise field, skyline) are one
 * draw call and the tier is decided per pixel.
 *   uv       meters along the wall (0 at the first bay), meters up
 *   bdata    seed 0..1, style (9 = roof), building height, 1 on walls that face a street
 *   bwall    bays on this wall, wall length
 */
export function buildShell(buildings: Building[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], data: number[] = [], wall: number[] = [];
  const quad = (p: number[][], n: number[], uvs: number[][], d: number[], w: number[]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...p[k]); nrm.push(...n); uv.push(...uvs[k]); data.push(...d); wall.push(...w); }
  };
  for (const b of buildings) {
    const seed = (b.seed % 9973) / 9973;
    for (const { x0, x1, z0, z1, bottom, top, style, frontage } of buildingSections(b)) {
      const bay = BAY[style];
      // Only the bottom tier meets the street (shopfronts); upper tiers are set back from it.
      const street = frontage ? b.street : { xmin: false, xmax: false, zmin: false, zmax: false };
      const side = (ax: number, az: number, bx: number, bz: number, n: number[], onStreet: boolean) => {
        const len = Math.hypot(bx - ax, bz - az);
        const bays = Math.max(1, Math.floor((len - 0.6) / bay));
        const margin = (len - bays * bay) / 2;
        quad([[ax, bottom, az], [bx, bottom, bz], [bx, top, bz], [ax, top, az]], n,
          [[-margin, bottom], [len - margin, bottom], [len - margin, top], [-margin, top]], [seed, style, top, onStreet ? 1 : 0], [bays, len]);
      };
      // Counter-clockwise seen from outside, so u runs left to right on every wall.
      side(x0, z1, x1, z1, [0, 0, 1], street.zmax);
      side(x1, z0, x0, z0, [0, 0, -1], street.zmin);
      side(x1, z1, x1, z0, [1, 0, 0], street.xmax);
      side(x0, z0, x0, z1, [-1, 0, 0], street.xmin);
      quad([[x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0]], [0, 1, 0],
        [[0, 0], [x1 - x0, 0], [x1 - x0, z1 - z0], [0, z1 - z0]], [seed, 9, top, 0], [1, 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('bdata', new THREE.Float32BufferAttribute(data, 4));
  g.setAttribute('bwall', new THREE.Float32BufferAttribute(wall, 2));
  g.computeBoundingSphere();
  return g;
}

/**
 * Everything built from boxes (the kit, street furniture, the railway, decks and bridges) as
 * one instanced draw: a unit cube per part with a transform, a colour, and an emission pair
 * (strength, blink). The parts are the modular kit; the plan decides where they go.
 */
export class Boxes {
  private readonly m: number[] = [];
  private readonly c: number[] = [];
  private readonly fx: number[] = [];
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  /** Box centered at (x, y, z) with size (sx, sy, sz); `rot` = Euler XYZ in radians. */
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, emit = 0, blink = 0, rot: [number, number, number] = [0, 0, 0]) {
    this.tmp.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2])), new THREE.Vector3(sx, sy, sz));
    this.m.push(...this.tmp.elements);
    this.c.push(color.r, color.g, color.b);
    this.fx.push(emit, blink);
  }

  /** Fluorescent fixtures feed the height-sampled spill map as well as visible geometry. */
  readonly fixtures: FixtureLight[] = [];

  /** A tube along x. Its light is registered every ~3 m, in proportion to its length (a 2.4 m tube = `emission`). */
  tube(x: number, y: number, z: number, length: number, emission: number, width = 0.12) {
    this.add(x, y, z, length, 0.05, width, col('fluorescent'), emission);
    const samples = Math.max(1, Math.ceil(length / 3));
    for (let i = 0; i < samples; i++) {
      this.fixtures.push({ x: x + ((i + 0.5) / samples - 0.5) * length, y, z, strength: emission * Math.max(length / samples, 1.2) / 2.4 });
    }
  }

  get count() { return this.fx.length / 2; }

  build(material: THREE.Material): THREE.InstancedMesh {
    return this.mesh(material, [...Array(this.count).keys()]);
  }

  private mesh(material: THREE.Material, ids: number[]): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, ids.length);
    const m = new Float32Array(ids.length * 16), c = new Float32Array(ids.length * 3), fx = new Float32Array(ids.length * 2);
    ids.forEach((id, k) => {
      m.set(this.m.slice(id * 16, id * 16 + 16), k * 16);
      c.set(this.c.slice(id * 3, id * 3 + 3), k * 3);
      fx.set(this.fx.slice(id * 2, id * 2 + 2), k * 2);
    });
    mesh.instanceMatrix.array.set(m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(c, 3);
    geometry.setAttribute('aFx', new THREE.InstancedBufferAttribute(fx, 2));
    mesh.frustumCulled = false;
    mesh.name = 'boxes';
    return mesh;
  }

  /** Horizontal bounds of static kit that overlaps a street-level walker. */
  walkingObstacles() {
    const obstacles = [];
    for (let i = 0; i < this.m.length; i += 16) {
      const extent = (row: number) => (Math.abs(this.m[i + row]) + Math.abs(this.m[i + row + 4]) + Math.abs(this.m[i + row + 8])) / 2;
      const y = this.m[i + 13], ey = extent(1);
      if (y + ey <= 0.33 || y - ey >= 1.95) continue;
      const x = this.m[i + 12], z = this.m[i + 14], ex = extent(0), ez = extent(2);
      obstacles.push({ x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez });
    }
    return obstacles;
  }

  /**
   * The kit for a city this size: one instanced draw per `cell` × `cell` square, each with its
   * own bounds so the renderer can skip it outside the view, and hidden beyond `reach` by
   * `cullChunks`. Lit parts and parts longer than half a cell (girders, kerbs, the median) go in
   * one mesh that is always drawn, so lamps and aviation lights still dot the far city.
   */
  buildChunked(material: THREE.Material, cell: number): THREE.Group {
    const group = new THREE.Group();
    group.name = 'kit';
    const always: number[] = [], cells = new Map<string, number[]>();
    for (let id = 0; id < this.count; id++) {
      const e = this.m.slice(id * 16, id * 16 + 16);
      const extent = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
      if (this.fx[id * 2] > 2 || extent > cell / 2) { always.push(id); continue; }
      const key = `${Math.floor(e[12] / cell)},${Math.floor(e[14] / cell)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(id);
    }
    const lit = this.mesh(material, always);
    lit.name = 'kit-always';
    group.add(lit);
    for (const [key, ids] of cells) {
      const mesh = this.mesh(material, ids);
      mesh.name = `kit-${key}`;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      mesh.userData.chunk = true;
      group.add(mesh);
    }
    return group;
  }
}

/** Hide kit chunks whose bounds are further than `reach` from the camera (fog has them by then). */
export function cullChunks(group: THREE.Object3D, eye: THREE.Vector3, reach: number) {
  for (const mesh of group.children as THREE.InstancedMesh[]) {
    if (!mesh.userData.chunk || !mesh.boundingSphere) continue;
    mesh.visible = mesh.boundingSphere.center.distanceTo(eye) - mesh.boundingSphere.radius < reach;
  }
}

export interface FixtureLight { x: number; y: number; z: number; strength: number }
export interface SignLight { x: number; z: number; size: number; color: THREE.Color; strength: number }
export interface Roof { x0: number; x1: number; z0: number; z1: number; h: number }

const TUBE_COLORS: Record<string, number> = { sign_red: 32, sign_amber: 25, tungsten: 14, fluorescent: 16, sign_cyan: 5, sodium: 8 };
const BOX_COLORS: Record<string, number> = { fluorescent: 45, tungsten: 30, sign_amber: 15, sign_red: 10 };
const BANDS: PaletteName[] = ['concrete_dark', 'car_navy', 'car_black', 'clad_charcoal', 'car_red', 'paint_cream', 'car_green'];
const AWNINGS: PaletteName[] = ['car_red', 'car_green', 'car_navy', 'paint_cream', 'car_orange', 'concrete_dark'];

/** Signs as instance data for the sign material (one unit box each, the design on its ±Z faces). */
export class Signs {
  private readonly m: number[] = [];
  private readonly rect: number[] = [];
  private readonly tube: number[] = [];
  private readonly back: number[] = [];
  private readonly params: number[] = [];
  private readonly gain: number[] = [];
  readonly lights: SignLight[] = [];
  private readonly pools = new Map<string, { plain: (typeof catalog.designs)[number][]; all: (typeof catalog.designs)[number][] }>();

  /** A design of `kind` (blade, panel, fascia, tower, letters); `brands` lets brand marks in. */
  pick(kind: string, rng: () => number, brands = false) {
    if (!this.pools.has(kind)) {
      const all = catalog.designs.filter((d) => d.kind === kind);
      this.pools.set(kind, { all, plain: all.filter((d) => !('brand' in d)) });
    }
    const pool = this.pools.get(kind)!;
    const list = brands || !pool.plain.length ? pool.all : pool.plain;
    // Neighbours should not repeat: skip a design picked in the last few picks of this kind.
    const recent = this.recent.get(kind) ?? [];
    let d = list[Math.floor(rng() * list.length)];
    for (let tries = 0; tries < 6 && recent.includes(d.text); tries++) d = list[Math.floor(rng() * list.length)];
    this.recent.set(kind, [...recent, d.text].slice(-Math.min(8, list.length >> 1)));
    return d;
  }

  private readonly recent = new Map<string, string[]>();

  get count() { return this.gain.length; }

  /** `rotY`: the sign's face normal is +Z rotated by it. Returns the sign's width. */
  add(d: (typeof catalog.designs)[number], x: number, y: number, z: number, height: number, rotY: number, rng: () => number, gain = 1, light = true) {
    const w = height * d.aspect;
    const tmp = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(w, height, 0.22));
    this.m.push(...tmp.elements);
    this.rect.push(...d.rect);
    const tube = col(weightedChoice(rng, TUBE_COLORS) as PaletteName), back = col(weightedChoice(rng, BOX_COLORS) as PaletteName);
    this.tube.push(tube.r, tube.g, tube.b);
    this.back.push(back.r, back.g, back.b);
    const quiet = d.dim < 1;
    const broken = !quiet && rng() < 0.3 ? 0.15 + 0.35 * rng() : 0;
    const flicker = !quiet && rng() < 0.2 ? 0.1 + 0.3 * rng() : 0;
    this.params.push(d.boxed ? 1 : 0, rng(), broken, flicker);
    this.gain.push(d.dim * gain);
    if (light) this.lights.push({ x, z, size: Math.max(w, height), color: d.boxed ? back.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : tube, strength: d.boxed ? 0.6 : 1 });
    return w;
  }

  build(material: THREE.Material): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const n = this.gain.length;
    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.instanceMatrix.array.set(this.m);
    const attr = (name: string, data: number[], size: number) => geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
    // Four instance attributes at most: with the matrix that is WebGPU's limit of eight vertex buffers. Gain rides in aBack.w.
    const backGain: number[] = [];
    for (let i = 0; i < n; i++) backGain.push(this.back[i * 3], this.back[i * 3 + 1], this.back[i * 3 + 2], this.gain[i]);
    attr('aRect', this.rect, 4); attr('aTube', this.tube, 3); attr('aBack', backGain, 4); attr('aParams', this.params, 4);
    mesh.frustumCulled = false;
    mesh.name = 'signs';
    return mesh;
  }
}

/** Fill `boxes` and `signs` from the plan; returns the roofs rain can land on. */
export function assemble(plan: Plan, boxes: Boxes, signs: Signs): Roof[] {
  const roofs: Roof[] = [];
  const concrete = col('concrete', 0.55), dark = col('concrete_dark', 0.7), metal = col('metal_dark', 1.6), steel = col('metal_dark', 2.6);
  const sidewalk = col('sidewalk', 1.25), paint = col('paint', 1.1), sodium = col('sodium'), fluor = col('fluorescent'), red = col('sign_red');
  const mainEdge = plan.main.half + plan.main.sidewalk;

  // --- ground level: sidewalks under every block, lane markings, the median, crossings ---
  for (const { x0, x1, z0, z1 } of sidewalks(plan)) {
    boxes.add((x0 + x1) / 2, SIDEWALK_HEIGHT / 2, (z0 + z1) / 2, x1 - x0, SIDEWALK_HEIGHT, z1 - z0, sidewalk);
  }
  const atCross = (x: number, pad: number) => plan.cross.xs.some((c) => Math.abs(x - c) < plan.cross.half + plan.cross.sidewalk + pad);
  for (let x = -plan.size.x - 20; x < plan.size.x + 20; x += 9) {
    if (atCross(x + 1.5, 3)) continue;
    for (const z of [-5, 5]) boxes.add(x + 1.5, 0.012, z, 3, 0.02, 0.14, paint);
  }
  for (const cx of plan.cross.xs) {
    const edge = plan.cross.half + plan.cross.sidewalk;
    // Zebra crossings on both sides of the junction, stop lines behind them.
    for (const s of [-1, 1]) {
      for (let z = -plan.main.half + 0.6; z < plan.main.half; z += 1.1) boxes.add(cx + s * (edge + 2.2), 0.012, z, 3, 0.02, 0.5, paint);
      for (let x = -plan.cross.half + 0.5; x < plan.cross.half; x += 1.1) boxes.add(cx + x, 0.012, s * (mainEdge + 2), 0.5, 0.02, 3, paint);
    }
    for (let z = -plan.size.z; z < plan.size.z; z += 8) {
      if (Math.abs(z) < mainEdge + 6 || plan.back.zs.some((b) => Math.abs(z - b) < 10)) continue;
      boxes.add(cx, 0.012, z + 1.5, 0.12, 0.02, 3, paint);
    }
  }

  // --- street lamps: pole, arm, lit head ---
  for (const [x, z, dx, dz] of plan.lamps) {
    boxes.add(x, 4, z, 0.16, 8, 0.16, metal);
    boxes.add(x + dx * 0.9, 7.9, z + dz * 0.9, dx ? 1.9 : 0.1, 0.1, dz ? 1.9 : 0.1, metal);
    boxes.add(x + dx * 1.8, 7.8, z + dz * 1.8, dx ? 0.7 : 0.3, 0.1, dz ? 0.7 : 0.3, sodium, 7);
  }

  // --- the suspended monorail: piers, twin box girders with a light line, the station ---
  const m = plan.monorail, mLen = m.x1 - m.x0, mMid = (m.x0 + m.x1) / 2;
  const { width: BEAM_W, height: BEAM_H, ribEvery } = m.girder, beamTop = m.beamY + BEAM_H;
  const hull = col('car_silver', 0.5), rib = col('car_silver', 0.42), glass = col('glass_dark', 2.2), trim = col('fluorescent').lerp(col('sign_cyan'), 0.35);
  const black = col('car_black', 0.5), lit = col('interior_white');
  const ARM = 1.5;
  const nearPier = (x: number, pad: number) => m.piers.some((p) => Math.abs(x - p) < ARM / 2 + pad);
  /** Parts of [a, b] left after removing `holes` (each [lo, hi]). */
  const solid = (a: number, b: number, holes: [number, number][]) => {
    const out: [number, number][] = [];
    let at = a;
    for (const [lo, hi] of [...holes].sort((p, q) => p[0] - q[0])) { if (lo > at) out.push([at, Math.min(lo, b)]); at = Math.max(at, hi); }
    if (b > at) out.push([at, b]);
    return out.filter(([p, q]) => q - p > 0.05);
  };
  boxes.add(mMid, 0.11, 0, mLen, 0.22, 2, dark);                                     // median
  for (const s of [-1, 1]) {
    const gz = s * m.trackZ, outer = gz + s * BEAM_W / 2, inner = gz - s * BEAM_W / 2;
    boxes.add(mMid, m.beamY + BEAM_H / 2, gz, mLen, BEAM_H, BEAM_W, hull);                         // girder
    boxes.add(mMid, m.beamY - 0.012, gz, mLen, 0.025, 0.34, black);                                // the slot the hangers run in
    boxes.add(mMid, m.beamY + 0.03, outer + s * 0.03, mLen, 0.05, 0.05, trim, 1.3);                // light line
    roofs.push({ x0: m.x0, x1: m.x1, z0: gz - BEAM_W / 2, z1: gz + BEAM_W / 2, h: beamTop });
    // Stiffener ribs down both faces, kept clear of the pier arms.
    for (let x = m.x0 + ribEvery / 2; x < m.x1; x += ribEvery) {
      if (nearPier(x, 0.6)) continue;
      for (const f of [outer, inner]) boxes.add(x, m.beamY + BEAM_H / 2, f + Math.sign(f - gz) * 0.02, 0.12, BEAM_H - 0.12, 0.04, rib);
    }
    // On top: a cable tray on the inner edge, a walkway rail on the outer edge.
    boxes.add(mMid, beamTop + 0.08, inner + s * 0.22, mLen, 0.16, 0.34, metal);
    for (const y of [0.55, 1.05]) boxes.add(mMid, beamTop + y, outer - s * 0.06, mLen, 0.05, 0.05, steel);
    for (let x = m.x0 + 2; x < m.x1; x += 4) if (!nearPier(x, 0.2)) boxes.add(x, beamTop + 0.53, outer - s * 0.06, 0.05, 1.06, 0.05, steel);
  }
  for (const x of m.piers) {
    // T pier: a footing on the median, a plinth with a cap and an access door, a shaft, an arm
    // across both girders, a lit collar, beacons.
    boxes.add(x, 0.31, 0, 2.4, 0.18, 1.95, concrete);
    boxes.add(x, 1.4, 0, 1.7, 2.8, 1.5, concrete);
    boxes.add(x, 2.75, 0, 1.86, 0.12, 1.66, col('concrete_light', 0.45));
    for (const s of [-1, 1]) boxes.add(x, 1.25, s * 0.755, 0.6, 1.3, 0.02, metal);
    boxes.add(x, (beamTop + 2.8) / 2, 0, 1.15, beamTop - 2.8, 1.0, hull);
    boxes.add(x, beamTop + 0.5, 0, ARM, 1.0, 2 * m.trackZ + BEAM_W + 0.8, hull);
    boxes.add(x, 2.86, 0, 1.2, 0.05, 1.05, trim, 1.1);
    for (const s of [-1, 1]) {
      boxes.add(x, beamTop + 1.05, s * (m.trackZ + BEAM_W / 2 + 0.2), 0.3, 0.12, 0.3, red, 5, 3 + (Math.abs(x) % 5));
      // Where each girder hangs from the arm: side plates over its upper half, a bearing pad, a joint.
      const gz = s * m.trackZ;
      for (const f of [-1, 1]) boxes.add(x, beamTop - 0.5, gz + f * (BEAM_W / 2 + 0.04), 1.3, 1.1, 0.08, rib);
      boxes.add(x, beamTop, gz, ARM + 0.14, 0.1, BEAM_W + 0.2, black);
      boxes.add(x + ARM / 2 + 0.35, m.beamY + BEAM_H / 2, gz, 0.04, BEAM_H + 0.03, BEAM_W + 0.03, black);
      // Knee brace from the shaft up to the arm, inside the inner girder.
      const z0 = 0.5, z1 = m.trackZ - BEAM_W / 2 - 0.15, y0 = beamTop - 1.6, y1 = beamTop + 0.05;
      boxes.add(x, (y0 + y1) / 2, s * (z0 + z1) / 2, 0.45, 0.22, Math.hypot(z1 - z0, y1 - y0), hull, 0, 0, [-s * Math.atan2(y1 - y0, z1 - z0), 0, 0]);
    }
  }

  // Station: side platforms slung at car-floor height under a roof on portal frames that
  // stand on the sidewalks and span the whole street. Glass screens at the platform edge.
  const [s0, s1] = m.station, sMid = (s0 + s1) / 2, sLen = s1 - s0;
  const [pIn, pOut] = m.platform, pMid = (pIn + pOut) / 2, pW = pOut - pIn;
  const platY = m.floorY, roofHalf = pOut + 0.8, legZ = plan.main.half + 0.9;
  const legXs: number[] = [];
  for (let x = s0; x <= s1 + 0.1; x += sLen / 4) legXs.push(x);
  boxes.add(sMid, m.roofY + 0.12, 0, sLen + 3, 0.24, roofHalf * 2, hull);
  for (const e of [-1, 1]) boxes.add(sMid, m.roofY + 0.12, e * (roofHalf + 0.03), sLen + 3, 0.07, 0.05, trim, 1.2);   // roof edge lines
  roofs.push({ x0: s0 - 1.5, x1: s1 + 1.5, z0: -roofHalf, z1: roofHalf, h: m.roofY + 0.24 });
  for (const x of legXs) {
    for (const s of [-1, 1]) boxes.add(x, m.roofY / 2, s * legZ, 0.8, m.roofY, 0.65, hull);
    boxes.add(x, m.roofY + 0.7, 0, 0.9, 0.95, legZ * 2 + 0.65, hull);
  }

  // Stairs: open flights of separate treads on two stringers, handrails on posts, a landing
  // wherever a flight would rise more than `stair.maxRise`, carried on columns to the ground.
  const st = plan.stair;
  const flightRun = (rise: number) => Math.round(rise / st.riser) * st.tread;
  const stairRun = (rise: number) => {
    const flights = Math.ceil(rise / st.maxRise - 1e-6);
    return flights * flightRun(rise / flights) + (flights - 1) * st.landing;
  };
  /** From (x, z) at `y0`, rising toward `dir` along x to `y1`. */
  const openStair = (x: number, z: number, y0: number, y1: number, dir: number, width: number) => {
    const flights = Math.ceil((y1 - y0) / st.maxRise - 1e-6), rise = (y1 - y0) / flights;
    const steps = Math.round(rise / st.riser), r = rise / steps, run = steps * st.tread, slope = Math.atan2(rise, run), len = Math.hypot(rise, run);
    const sides = [-1, 1].map((k) => z + k * (width / 2 + 0.05));
    let at = x, y = y0;
    for (let f = 0; f < flights; f++) {
      for (let i = 0; i < steps; i++) boxes.add(at + dir * (i + 0.5) * st.tread, y + (i + 1) * r - 0.03, z, st.tread + 0.03, 0.06, width, concrete);
      for (const sz of sides) {
        // Stringer under the tread ends, rail 0.9 m above the nosings, posts between.
        boxes.add(at + dir * run / 2, y + rise / 2 - 0.08, sz, len + 0.1, 0.32, 0.08, metal, 0, 0, [0, 0, dir * slope]);
        boxes.add(at + dir * run / 2, y + rise / 2 + 0.95, sz, len, 0.05, 0.05, steel, 0, 0, [0, 0, dir * slope]);
        for (let k = 1; k < 4; k++) boxes.add(at + dir * run * k / 4, y + rise * k / 4 + 0.5, sz, 0.04, 0.9, 0.04, steel);
      }
      at += dir * run;
      y += rise;
      if (f < flights - 1) {
        // Landing, its rail on the outer side, and two columns to the ground.
        boxes.add(at + dir * st.landing / 2, y - 0.1, z, st.landing, 0.2, width + 0.2, concrete);
        for (const sz of sides) {
          boxes.add(at + dir * st.landing / 2, y + 0.95, sz, st.landing, 0.05, 0.05, steel);
          boxes.add(at + dir * (st.landing - 0.15), (y - 0.2) / 2, sz, 0.14, y - 0.2, 0.14, metal);
        }
        at += dir * st.landing;
      }
    }
    return at;
  };

  // Openings in the platforms' outer balustrade where the stairs arrive: |x| ranges, per platform side.
  const zGap = (pOut + plan.deck.z0) / 2 + 0.1, zS = -(legZ + 1.15), stairW = 1.3;
  const openings: Record<number, [number, number]> = { [-1]: [6, 9], [1]: [11, 14] };
  const doorGaps = m.doorXs.map((d) => [d - 0.9, d + 0.9] as [number, number]);
  for (const s of [-1, 1]) {
    const [oa, ob] = openings[s];
    const holes: [number, number][] = [[-ob, -oa], [oa, ob]];
    boxes.add(sMid, platY - 0.18, s * pMid, sLen, 0.36, pW, concrete);                              // platform
    boxes.add(sMid, platY + 0.012, s * (pIn + 0.5), sLen, 0.02, 0.22, col('car_yellow', 1.3));     // tactile strip
    boxes.add(sMid, platY - 0.34, s * (pIn + 0.06), sLen, 0.05, 0.06, trim, 0.9);                   // underside line
    // Platform screens between the door positions: glass to waist height with a lit rail, posts.
    for (const [a, b] of solid(s0 + 1, s1 - 1, doorGaps)) {
      const panels = Math.ceil((b - a) / 3.6), pl = (b - a) / panels;
      for (let k = 0; k < panels; k++) {
        const x = a + (k + 0.5) * pl;
        boxes.add(x, platY + 0.62, s * (pIn + 0.05), pl - 0.06, 1.24, 0.05, glass);
        boxes.add(x, platY + 1.27, s * (pIn + 0.05), pl - 0.06, 0.05, 0.07, trim, 1.2);
      }
      for (const x of [a, b]) boxes.add(x, platY + 0.66, s * (pIn + 0.05), 0.1, 1.32, 0.12, steel);
    }
    // At every door: queue lines on the floor, a lit threshold at the edge, a door number lamp.
    for (const d of m.doorXs) {
      for (const o of [-0.75, 0.75]) boxes.add(d + o, platY + 0.012, s * (pIn + 1.6), 0.1, 0.02, 1.6, paint);
      boxes.add(d, platY + 0.012, s * (pIn + 2.45), 1.6, 0.02, 0.1, paint);
      boxes.add(d, platY + 0.008, s * (pIn + 0.12), 1.6, 0.02, 0.12, fluor, 1.4);
      boxes.add(d + 0.86, platY + 1.38, s * (pIn + 0.05), 0.08, 0.14, 0.14, col('sign_cyan'), 2.5);
    }
    // Outer edge: a glass balustrade with a rail, open where the stair lands; hangers carry the platform from the roof.
    for (const [a, b] of solid(s0, s1, holes)) {
      boxes.add((a + b) / 2, platY + 0.6, s * (pOut - 0.04), b - a, 1.2, 0.05, glass);
      boxes.add((a + b) / 2, platY + 1.23, s * (pOut - 0.04), b - a, 0.05, 0.07, hull);
    }
    for (let x = s0 + 3; x <= s1 - 3; x += 6.2) {
      if (holes.some(([a, b]) => x > a - 0.3 && x < b + 0.3)) continue;
      boxes.add(x, (platY + m.roofY) / 2, s * (pOut - 0.1), 0.12, m.roofY - platY, 0.12, hull);
    }
    for (let x = s0 + 5; x < s1 - 4; x += 4) boxes.tube(x, platY + 2.85, s * (pMid + 0.5), 2.4, 1.5);                   // platform lights
    // A line of tubes over the track edge under a fascia: it lights the platform edge and the
    // side of a train standing at it, at the platform lights' height so it shares their layer.
    boxes.add(sMid, platY + 3.05, s * (pIn + 0.25), sLen - 2, 0.3, 0.06, hull);
    for (let x = s0 + 2.5; x < s1 - 2; x += 3.5) boxes.tube(x, platY + 2.85, s * (pIn + 0.32), 3, 1.6, 0.1);
    for (let x = s0 + 6; x < s1 - 3; x += 12) boxes.add(x, (platY + 3.2 + m.roofY) / 2, s * (pIn + 0.25), 0.06, m.roofY - platY - 3.2, 0.06, metal);

    // Furniture along the back: two vending machine styles with a recycling bin, benches.
    const clear = (a: number, b: number) => !holes.some(([p, q]) => b > p - 0.4 && a < q + 0.4);
    let k = 0;
    for (let x = s0 + 9; x < s1 - 6; x += 16, k++) {
      const zb = s * (pOut - 0.5), face = s * (pOut - 0.86);
      if (!clear(x - 1.9, x + 0.6)) { /* the stair lands here */ } else if ((k + (s > 0 ? 1 : 0)) % 2 === 0) {
        boxes.add(x, platY + 0.9, zb, 1.1, 1.8, 0.7, col('car_navy'));
        boxes.add(x, platY + 1.05, face, 0.9, 1.3, 0.03, fluor, 0.8);
      } else {
        // Drinks machine: red body, a lit display of three shelves, a dark slot, a button strip.
        boxes.add(x, platY + 0.92, zb, 1.0, 1.84, 0.72, col('car_red', 0.8));
        boxes.add(x, platY + 1.3, face, 0.84, 0.82, 0.03, lit, 0.9);
        for (const y of [1.05, 1.3, 1.55]) boxes.add(x, platY + y, face - s * 0.012, 0.8, 0.12, 0.02, col('car_grey', 0.6));
        boxes.add(x, platY + 0.84, face, 0.84, 0.05, 0.03, col('sign_cyan'), 2);
        boxes.add(x, platY + 0.3, face, 0.6, 0.18, 0.03, black);
      }
      // Recycling bin: three bodies with coloured lids and dark slots.
      for (let b = 0; b < 3 && clear(x - 1.9, x + 0.6); b++) {
        const bx = x - 1.25 + (b - 1) * 0.4;
        boxes.add(bx, platY + 0.45, s * (pOut - 0.35), 0.36, 0.9, 0.38, col('car_silver', 0.55));
        boxes.add(bx, platY + 0.92, s * (pOut - 0.35), 0.37, 0.05, 0.39, col((['car_green', 'car_yellow', 'paint_blue'] as const)[b]));
        boxes.add(bx, platY + 0.78, s * (pOut - 0.55), 0.18, 0.05, 0.02, black);
      }
      if (!clear(x + 3.9, x + 6.1)) continue;
      boxes.add(x + 5, platY + 0.45, s * (pOut - 0.55), 2.2, 0.08, 0.5, col('interior_wood'));                          // bench
      for (const o of [-0.9, 0.9]) boxes.add(x + 5 + o, platY + 0.22, s * (pOut - 0.55), 0.08, 0.44, 0.4, metal);
    }

    // Station name board on the balustrade, facing the track, and two hanging along the platform.
    const glyphs = mulberry32(s > 0 ? 401 : 409);
    const board = (x: number, y: number, z: number, w: number, h: number, nx: number, nz: number) => {
      const along = (u: number, v: number, du: number, dv: number, color: THREE.Color, emit = 0) => {
        const out = 0.035;
        boxes.add(x + (nz ? u : 0) + nx * out, y + v, z + (nx ? u : 0) + nz * out, nz ? du : 0.01, dv, nx ? du : 0.01, color, emit);
      };
      boxes.add(x, y, z, nz ? w : 0.06, h, nx ? w : 0.06, lit, 0.9);
      along(0, -h / 2 + h * 0.1, w, h * 0.12, col('sign_cyan'), 1.6);
      // Three large characters of strokes on a 3x3 grid, a line of small text beneath.
      const cw = h * 0.42;
      for (let c = 0; c < 3; c++) {
        const cu = (c - 1) * cw * 1.25;
        const strokes = new Set<number>();
        while (strokes.size < 4) strokes.add(Math.floor(glyphs() * 6));
        for (const k2 of strokes) {
          const p = (k2 % 3) / 2 - 0.5;
          if (k2 < 3) along(cu, h * 0.12 + p * cw, cw, 0.06 * h, black);
          else along(cu + p * cw, h * 0.12, 0.07 * h, cw, black);
        }
      }
      for (let c = 0; c < 9; c++) along((c - 4) * cw * 0.32, -h * 0.22, cw * (0.14 + 0.12 * glyphs()), 0.05 * h, black);
    };
    board(3.1, platY + 1.9, s * (pOut - 0.12), 3.6, 0.95, 0, -s);
    for (const o of [-1.5, 1.5]) boxes.add(3.1 + o, platY + 1.33, s * (pOut - 0.1), 0.06, 0.2, 0.06, metal);
    for (const bx of [-20, 21]) {
      board(bx, platY + 2.55, s * pMid, 1.7, 0.45, 1, 0);
      board(bx, platY + 2.55, s * pMid, 1.7, 0.45, -1, 0);
      for (const o of [-0.7, 0.7]) boxes.add(bx, (platY + 2.8 + m.roofY) / 2, s * pMid + o, 0.04, m.roofY - platY - 2.8, 0.04, metal);
    }
    // Timetable case on a post, facing the track; a clock hanging over the platform, readable along it.
    const tz = s * (pOut - 0.3);
    boxes.add(-15.5, platY + 0.6, tz, 0.12, 1.2, 0.12, metal);
    boxes.add(-15.5, platY + 1.75, tz, 0.95, 1.25, 0.12, col('car_silver', 0.4));
    boxes.add(-15.5, platY + 1.75, tz - s * 0.065, 0.85, 1.12, 0.01, lit, 0.7);
    for (let r = 0; r < 6; r++) boxes.add(-15.5, platY + 1.28 + r * 0.19, tz - s * 0.072, 0.82, 0.015, 0.01, black);
    boxes.add(-15.5 - 0.15, platY + 1.75, tz - s * 0.072, 0.015, 1.1, 0.01, black);
    const cx = 9.5, cy = platY + 2.65, cz = s * pMid;
    boxes.add(cx, (cy + 0.3 + m.roofY) / 2, cz, 0.04, m.roofY - cy - 0.3, 0.04, metal);
    for (const a of [0, Math.PI / 4]) {
      boxes.add(cx, cy, cz, 0.14, 0.5, 0.5, col('car_black', 0.6), 0, 0, [a, 0, 0]);
      boxes.add(cx, cy, cz, 0.16, 0.44, 0.44, lit, 0.8, 0, [a, 0, 0]);
    }
    for (const [a, len] of [[-1.05, 0.13], [1.05, 0.2]]) {
      // Hands at ten past ten, on both faces.
      boxes.add(cx, cy + Math.cos(a) * len / 2, cz + Math.sin(a) * len / 2, 0.18, len, 0.025, black, 0, 0, [a, 0, 0]);
    }
    roofs.push({ x0: s0, x1: s1, z0: Math.min(s * pIn, s * pOut), z1: Math.max(s * pIn, s * pOut), h: platY });
  }

  // Pedestrian deck, notched round the portal legs that pass through it.
  const dk = plan.deck, dMidZ = (dk.z0 + dk.z1) / 2, dW = dk.z1 - dk.z0;
  const notch = legZ + 0.325 + 0.15, deckHoles = legXs.map((x) => [x - 0.55, x + 0.55] as [number, number]);
  boxes.add((dk.x0 + dk.x1) / 2, dk.y - 0.2, (notch + dk.z1) / 2, dk.x1 - dk.x0, 0.4, dk.z1 - notch, concrete);
  for (const [a, b] of solid(dk.x0, dk.x1, deckHoles)) boxes.add((a + b) / 2, dk.y - 0.2, (dk.z0 + notch) / 2, b - a, 0.4, notch - dk.z0, concrete);
  for (const x of legXs) {
    if (x < dk.x0 || x > dk.x1) continue;
    for (const o of [-0.55, 0.55]) boxes.add(x + o, dk.y + 0.06, (dk.z0 + notch) / 2, 0.06, 0.12, notch - dk.z0, steel);
    boxes.add(x, dk.y + 0.06, notch - 0.03, 1.16, 0.12, 0.06, steel);
  }
  // Deck rail on the street side, open where the north flights leave it.
  const northRun = flightRun(platY - dk.y);
  const deckLanding: [number, number] = [14 + northRun, 17 + northRun];
  for (const [a, b] of solid(dk.x0, dk.x1, [[-deckLanding[1], -deckLanding[0]], deckLanding])) {
    boxes.add((a + b) / 2, dk.y + 0.55, dk.z0 + 0.06, b - a, 1.1, 0.08, steel);
  }
  for (let x = dk.x0 + 5; x < dk.x1 - 3; x += 6) boxes.tube(x, dk.y - 0.43, dMidZ, 2.4, 1.3);
  for (let x = dk.x0 + 3; x <= dk.x1 - 3; x += 10) boxes.add(x, (dk.y - 0.4) / 2, dk.z1 - 0.4, 0.3, dk.y - 0.4, 0.3, metal);
  roofs.push({ x0: dk.x0, x1: dk.x1, z0: dk.z0, z1: dk.z1, h: dk.y });
  for (const s of [-1, 1]) {
    // Sidewalk up to the deck at both of its ends.
    openStair((s < 0 ? dk.x0 : dk.x1) + s * stairRun(dk.y - 0.15), dMidZ, 0.15, dk.y, -s, dW - 0.4);
    // Deck up to the north platform: one open flight in the gap between them, a landing at each end.
    const landW = dk.z0 - pOut + 0.3;
    openStair(s * (14 + northRun), zGap, dk.y, platY, -s, 1.4);
    boxes.add(s * (15.5 + northRun), dk.y - 0.1, zGap, 3, 0.2, landW, concrete);
    boxes.add(s * 12.5, platY - 0.1, zGap, 3, 0.2, landW, concrete);
    // South platform: an open stair with a landing halfway, from the sidewalk to a bridge across to the platform.
    openStair(s * (9 + stairRun(platY - 0.15)), zS, 0.15, platY, -s, stairW);
    const zb0 = zS - stairW / 2 - 0.1, zb1 = -pOut;
    boxes.add(s * 7.5, platY - 0.1, (zb0 + zb1) / 2, 3, 0.2, zb1 - zb0, concrete);
    boxes.add(s * 6, platY + 0.55, (zb0 + zb1) / 2, 0.05, 1.1, zb1 - zb0, glass);
    boxes.add(s * 6, platY + 1.12, (zb0 + zb1) / 2, 0.06, 0.05, zb1 - zb0, steel);
    boxes.add(s * 7.5, platY + 0.55, zb0, 3, 1.1, 0.05, glass);
    boxes.add(s * 7.5, platY + 1.12, zb0, 3, 0.05, 0.06, steel);
    const za = zS + stairW / 2 + 0.1;
    boxes.add(s * 9, platY + 0.55, (za + zb1) / 2, 0.05, 1.1, zb1 - za, glass);
    boxes.add(s * 9, platY + 1.12, (za + zb1) / 2, 0.06, 0.05, zb1 - za, steel);
  }

  // --- skybridges over the cross streets ---
  for (const b of plan.bridges) {
    const mx = (b.x0 + b.x1) / 2, len = b.x1 - b.x0;
    boxes.add(mx, b.y + 1.6, b.z, len, 3.2, 4, metal);
    for (const s of [-1, 1]) boxes.add(mx, b.y + 1.75, b.z + s * 2.01, len - 1.2, 1.5, 0.04, fluor, 0.9);
    boxes.tube(mx, b.y - 0.03, b.z, len - 3, 1.8, 0.2);
    roofs.push({ x0: b.x0, x1: b.x1, z0: b.z - 2, z1: b.z + 2, h: b.y + 3.2 });
  }

  // --- buildings: roofs for the rain, roof kit and crowns, and the street kit on the near tier ---
  const inCity = new Set(plan.buildings);
  for (const b of [...plan.buildings, ...plan.skyline]) {
    const sections = buildingSections(b);
    const top = sections.reduce((highest, section) => section.top >= highest.top ? section : highest);
    for (const section of sections) {
      roofs.push({ x0: section.x0, x1: section.x1, z0: section.z0, z1: section.z1, h: section.top });
    }
    const { x0: tx0, x1: tx1, z0: tz0, z1: tz1, top: th } = top;
    const cx = (tx0 + tx1) / 2, cz = (tz0 + tz1) / 2, tw = tx1 - tx0, td = tz1 - tz0;
    const r = mulberry32(b.seed);
    const tall = !b.housingForm && (b.style === 4 || b.h > 60);
    // Aviation lights on anything tall, visible to the horizon.
    if (th > 90) for (const [x, z] of [[tx0 + 1, tz0 + 1], [tx1 - 1, tz1 - 1]]) boxes.add(x, th + 0.24, z, 0.28, 0.28, 0.28, red, 5, 1 + (b.seed % 7));
    const city = inCity.has(b);
    if (!city && !(tall && r() < 0.35)) continue;

    // Roof: a parapet, a stair head, a water tank on legs, sometimes a mast.
    if (city) {
      // The full set close to the monorail; further out a stair head and a tank, which is what reads from a distance.
      if (b.near) for (const [x, z, sx, szz] of [[cx, tz0 + 0.12, tw, 0.24], [cx, tz1 - 0.12, tw, 0.24], [tx0 + 0.12, cz, 0.24, td], [tx1 - 0.12, cz, 0.24, td]]) {
        boxes.add(x, th + 0.35, z, sx, 0.7, szz, dark);
      }
      boxes.add(cx + (r() - 0.5) * Math.min(4, tw - 4), th + 1.4, cz + (r() - 0.5) * Math.min(4, td - 5), 3.2, 2.8, 4.2, concrete);
      if (!tall && r() < 0.7) {
        const wx = tx0 + 2.5 + r() * 2, wz = tz1 - 2.5 - r() * 2;
        boxes.add(wx, th + 2.2, wz, 2.2, 2, 2.2, col(r() < 0.5 ? 'paint_cream' : 'car_silver', 0.5));
        boxes.add(wx, th + 3.25, wz, 1.6, 0.1, 1.6, metal);
        if (b.near) for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) boxes.add(wx + ox, th + 0.6, wz + oz, 0.12, 1.2, 0.12, metal);
        else boxes.add(wx, th + 0.6, wz, 1.9, 1.2, 1.9, metal);
      }
      if (b.near && r() < 0.35) boxes.add(tx1 - 2, th + 4, tz0 + 2, 0.1, 8, 0.1, metal);
    }

    // Crowns on the towers, after the old app's skyline: spires, LED edge lines, lit lattice tops, cranes, brand letters.
    if (tall) {
      const roll = r();
      const led = [col('fluorescent'), col('sign_cyan'), col('office_white'), col('sign_red')][Math.floor(r() * 4)];
      if (roll < 0.4) {
        // A spire or antenna mast with a beacon.
        const mh = 12 + r() * 35, mw = r() < 0.5 ? 0.5 : 1.4;
        boxes.add(cx, th + mh / 2, cz, mw, mh, mw, metal);
        boxes.add(cx, th + mh + 0.4, cz, 0.7, 0.7, 0.7, red, 9, 2 + (b.seed % 5));
      }
      const edgeLights = city && r() < 0.35;
      if (edgeLights) {
        // LED lines up the corners of the top tier.
        const y0 = th * (0.45 + r() * 0.3);
        if (DECORATIVE_TOWER_LIGHTS) for (const [x, z] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) boxes.add(x, (y0 + th) / 2, z, 0.18, th - y0, 0.18, led, 3);
      }
      if (city && th > 80 && tw < 34 && td < 34 && r() < 0.25) {
        // A lit lattice crown on a slim tower: a frame round the roof edge and crossed braces on its faces.
        const ch = 4 + r() * 6, y = th + ch / 2;
        if (DECORATIVE_TOWER_LIGHTS) {
          for (const yy of [th + 0.1, th + ch]) {
            boxes.add(cx, yy, tz0, tw, 0.14, 0.14, led, 2.2); boxes.add(cx, yy, tz1, tw, 0.14, 0.14, led, 2.2);
            boxes.add(tx0, yy, cz, 0.14, 0.14, td, led, 2.2); boxes.add(tx1, yy, cz, 0.14, 0.14, td, led, 2.2);
          }
          for (const [x, z] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) boxes.add(x, y, z, 0.14, ch, 0.14, led, 2.2);
          for (const s2 of [-1, 1]) {
            boxes.add(cx, y, tz0, Math.hypot(tw, ch), 0.12, 0.12, led, 2.2, 0, [0, 0, s2 * Math.atan2(ch, tw)]);
            boxes.add(cx, y, tz1, Math.hypot(tw, ch), 0.12, 0.12, led, 2.2, 0, [0, 0, s2 * Math.atan2(ch, tw)]);
            boxes.add(tx0, y, cz, 0.12, 0.12, Math.hypot(td, ch), led, 2.2, 0, [s2 * Math.atan2(ch, td), 0, 0]);
            boxes.add(tx1, y, cz, 0.12, 0.12, Math.hypot(td, ch), led, 2.2, 0, [s2 * Math.atan2(ch, td), 0, 0]);
          }
        }
      }
      if (city && r() < 0.06) {
        // A tower crane, still building the next floor.
        const mh = 22 + r() * 12, jib = 28 + r() * 12, yaw = r() * Math.PI;
        const kx = tx0 + 3, kz = tz0 + 3;
        boxes.add(kx, th + mh / 2, kz, 1.2, mh, 1.2, col('car_yellow', 0.5));
        boxes.add(kx + Math.cos(yaw) * jib * 0.3, th + mh, kz + Math.sin(yaw) * jib * 0.3, jib, 0.9, 0.9, col('car_yellow', 0.5), 0, 0, [0, -yaw, 0]);
        boxes.add(kx, th + mh + 0.9, kz, 0.6, 0.6, 0.6, red, 8, 3);
      }
      if (city && th > 70 && r() < 0.55) {
        // Brand letters on the roof edge that faces the main street.
        const d = signs.pick('letters', r, true);
        const face = cz > 0 ? -1 : 1, len = tw;
        const h = Math.min(4.5, (len - 4) / d.aspect);
        if (h > 1.2) {
          const z = face < 0 ? tz0 + 0.4 : tz1 - 0.4;
          signs.add(d, cx, th + 1 + h / 2, z, h, face < 0 ? Math.PI : 0, r, 0.85, false);
          boxes.add(cx, th + 1 + h * 0.15, z - face * 0.3, h * d.aspect * 0.95, 0.12, 0.12, metal);
        }
      }
    }
    if (!b.near) continue;
    if (b.housingForm) {
      // Two repeated balcony stacks frame the slab's recessed stair core. Keeping the ledge and
      // fascia in the existing kit batch also keeps the road reflection on the same draw path.
      for (const section of sections.slice(1)) {
        if (section.style === 1 || (b.housingForm === 'wing' && section === top)) continue;
        const x = (section.x0 + section.x1) / 2;
        const width = Math.min(b.housingForm === 'slab' ? 5.4 : 3.2, section.x1 - section.x0 - 0.6);
        const spacing = b.housingForm === 'slab' ? FLOOR_HEIGHT : FLOOR_HEIGHT * 2;
        for (let y = section.bottom + 0.45; y < section.top - 1.3; y += spacing) {
          boxes.add(x, y, section.z0 - 0.42, width, 0.24, 0.9, concrete);
          boxes.add(x, y + 0.52, section.z0 - 0.82, width, 0.84, 0.09, steel);
        }
      }
    }
    const housing = b.style === 0 || b.style === 2;
    const bay = BAY[b.style];
    // Street-wall kit stops at the podium of a stepped building: the tiers above are set back.
    const wallTop = b.housingForm ? HOUSING_PODIUM
      : b.tiers.length > 1 && b.tiers[1].inset > 0 ? b.tiers[0].top : b.h;

    // Walls: start point, direction along the wall, outward normal, whether it faces a street.
    const walls: [number, number, number, number, number, number, number, boolean][] = [
      [b.x0, b.z1, 1, 0, 0, 1, b.x1 - b.x0, b.street.zmax], [b.x1, b.z0, -1, 0, 0, -1, b.x1 - b.x0, b.street.zmin],
      [b.x1, b.z1, 0, -1, 1, 0, b.z1 - b.z0, b.street.xmax], [b.x0, b.z0, 0, 1, -1, 0, b.z1 - b.z0, b.street.xmin],
    ];
    for (const [ax, az, ux, uz, nx, nz, len, street] of walls) {
      if (!street) continue;
      const at = (u: number, out: number): [number, number] => [ax + ux * u + nx * out, az + uz * u + nz * out];
      const yaw = Math.atan2(nx, nz);          // rotation that turns +Z into the wall normal
      const bays = Math.max(1, Math.floor((len - 0.6) / bay)), margin = (len - bays * bay) / 2;
      // Podium ledge and a drain pipe or two.
      const [lx, lz] = at(len / 2, 0.14);
      boxes.add(lx, PODIUM + 0.12, lz, ux ? len : 0.28, 0.24, uz ? len : 0.28, dark);
      for (let k = 0; k < 1 + Math.floor(r() * 2); k++) {
        const [px, pz] = at(margin * 0.5 + (k ? len - margin : 0), 0.09);
        boxes.add(px, (wallTop + PODIUM) / 2, pz, 0.12, wallTop - PODIUM, 0.12, metal);
      }
      // Shopfront bays: an awning over some, and either a board per bay or one fascia across the frontage.
      const shops = Math.max(1, Math.floor(len / SHOP_BAY)), shopMargin = (len - shops * SHOP_BAY) / 2;
      const fascia = shops >= 2 && r() < 0.4;
      for (let s = 0; s < shops; s++) {
        const u = shopMargin + (s + 0.5) * SHOP_BAY;
        if (r() < 0.5) {
          const [x, z] = at(u, 0.75);
          // Tilted so the outer edge drops: about X on walls facing ±z, about Z on walls facing ±x.
          boxes.add(x, 3.25, z, ux ? SHOP_BAY - 0.7 : 1.5, 0.07, ux ? 1.5 : SHOP_BAY - 0.7, col(AWNINGS[Math.floor(r() * AWNINGS.length)], 0.8), 0, 0, [nz * 0.24, 0, -nx * 0.24]);
        }
        if (!fascia) {
          // The shop's signboard band across its bay, and the sign on it: a short word does not leave a bare wall.
          const [bx, bz] = at(u, 0.08);
          boxes.add(bx, 3.92, bz, ux ? SHOP_BAY - 0.3 : 0.12, 0.95, uz ? SHOP_BAY - 0.3 : 0.12, col(BANDS[Math.floor(r() * BANDS.length)], 0.55));
          if (r() < 0.85) {
            const d = signs.pick('panel', r);
            const h = Math.min(0.78, (SHOP_BAY - 0.9) / d.aspect);
            const [x, z] = at(u, 0.25);
            signs.add(d, x, 3.92, z, h, yaw, r);
          }
        }
      }
      if (fascia) {
        // One lit board across the shopfronts, as tall as the gap under the podium ledge allows.
        const d = signs.pick('fascia', r);
        const h = Math.min(1.0, (len - 1.2) / d.aspect);
        const [x, z] = at(len / 2, 0.2);
        signs.add(d, x, 3.85, z, h, yaw, r);
      }

      // Signs up the facade hang from the piers between window bays, never across a window, and
      // the bays beside them on the floors they span keep no balconies or AC units.
      const floors = Math.floor((wallTop - PODIUM) / FLOOR_HEIGHT);
      const blocked = new Set<number>();
      const block = (k: number, y0: number, y1: number) => {
        for (let f = 0; f < floors; f++) {
          const fy = PODIUM + f * FLOOR_HEIGHT;
          if (fy < y1 + 0.3 && fy + FLOOR_HEIGHT > y0 - 0.3) blocked.add(f * 1000 + k);
        }
      };
      /** A vertical board at u standing out from the wall, with an arm every 2.5 m. */
      const hang = (d: (typeof catalog.designs)[number], u: number, y: number, h: number, gain = 1) => {
        const w = h * d.aspect, out = 0.45 + w / 2;
        const [x, z] = at(u, out);
        signs.add(d, x, y, z, h, yaw + Math.PI / 2, r, gain, y < 30);
        const arms = Math.max(2, Math.round(h / 2.5) + 1);
        for (let k = 0; k < arms; k++) {
          const [bx, bz] = at(u, out / 2);
          boxes.add(bx, y - h / 2 + 0.12 + (k / (arms - 1)) * (h - 0.24), bz, nx ? out : 0.07, 0.07, nz ? out : 0.07, metal);
        }
      };
      // Over the pedestrian deck the signs start above head height on the deck, not on the podium.
      const dk = plan.deck;
      const overDeck = nz === -1 && Math.abs(b.z0 - dk.z1) < 1 && b.x1 > dk.x0 && b.x0 < dk.x1;
      const base = overDeck ? dk.y + 3 : PODIUM + 1;
      const room = wallTop - base - 1;
      // A multi-floor LED tower at a corner of some taller buildings.
      if (DECORATIVE_TOWER_LIGHTS && room > 13 && r() < 0.35) {
        const d = signs.pick('tower', r);
        const h = Math.min(8 + r() * 8, room - 1, 2.4 / d.aspect);
        const y = base + 0.2 + h / 2;
        const corner = r() < 0.5 ? 0 : bays - 1;
        hang(d, corner === 0 ? margin * 0.5 + 0.1 : len - margin * 0.5 - 0.1, y, h, 1.15);
        block(corner, y - h / 2, y + h / 2);
      }
      // Blades on the piers between bays.
      const piers = Array.from({ length: Math.max(0, bays - 1) }, (_, k) => k + 1);
      for (let k = piers.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [piers[k], piers[j]] = [piers[j], piers[k]]; }
      const blades = Math.min(piers.length, wallTop < 50 ? Math.floor(r() * 3.8) : Math.floor(r() * 2.5));
      for (let k = 0; k < blades; k++) {
        const d = signs.pick('blade', r);
        const h = Math.min(2.4 + r() * 4, room, 2.0 / d.aspect);
        if (h < 1.5) continue;
        const y = base + h / 2 + r() * Math.max(0, Math.min(room - h, 16));
        const p = piers[k];
        hang(d, margin + p * bay, y, h);
        block(p - 1, y - h / 2, y + h / 2);
        block(p, y - h / 2, y + h / 2);
      }

      // Upper floors: AC units and balconies on housing, per bay and floor, clear of the signs.
      if (housing && !b.housingForm) {
        for (let f = 0; f < Math.min(floors, 14); f++) {
          const y0 = PODIUM + f * FLOOR_HEIGHT;
          for (let k = 0; k < bays; k++) {
            const u = margin + (k + 0.5) * bay, h = r();
            if (blocked.has(f * 1000 + k)) continue;
            if (b.style === 2 && h < 0.45) {
              const [x, z] = at(u, 0.5);
              boxes.add(x, y0 + 0.5, z, ux ? 2.5 : 1, 0.12, uz ? 2.5 : 1, concrete);
              const [rx, rz] = at(u, 0.97);
              boxes.add(rx, y0 + 1.05, rz, ux ? 2.5 : 0.06, 1, uz ? 2.5 : 0.06, steel);
            } else if (h < 0.5) {
              const [x, z] = at(u + (r() < 0.5 ? -1 : 1) * (bay * 0.5 - 0.5), 0.24);
              boxes.add(x, y0 + 0.55, z, ux ? 0.8 : 0.42, 0.56, uz ? 0.8 : 0.42, col('car_silver', 0.45));
            }
          }
        }
      }

      // On the roof: a lit board or free-standing channel letters on a frame, along the street edge.
      if (wallTop === b.h && b.h < 70 && len > 10 && r() < (b.h < 45 ? 0.35 : 0.5)) {
        const letters = b.h >= 45 || r() < 0.5;
        const d = signs.pick(letters ? 'letters' : 'panel', r, letters);
        const h = Math.min(letters ? (b.h >= 45 ? 3.2 : 2.2) : 2.4, (len - 3) / d.aspect);
        const [x, z] = at(len / 2, -0.6);
        const y = b.h + (letters ? 0.9 : 1.6) + h / 2;
        signs.add(d, x, y, z, h, yaw, r, letters ? 1.3 : 1.5, b.h < 30);
        const w = h * d.aspect;
        for (const o of [-0.4, 0, 0.4]) {
          if (!letters && o === 0) continue;
          const [px, pz] = at(len / 2 + o * w, -0.85);
          boxes.add(px, b.h + (y - b.h) / 2 + 0.2, pz, 0.12, y - b.h + 0.2, 0.12, metal);
        }
        // Channel letters stand on a rail behind them rather than on a backing board.
        if (letters) { const [rx, rz] = at(len / 2, -0.85); boxes.add(rx, y - h * 0.35, rz, ux ? w * 0.95 : 0.1, 0.1, uz ? w * 0.95 : 0.1, metal); }
      }
    }
  }
  return roofs;
}
