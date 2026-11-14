import * as THREE from 'three/webgpu';
import { mulberry32, weightedChoice } from '../../art/layouts/lib/rng.mjs';
import catalog from '../../art/textures/signs/designs.json';
import { FLOOR_HEIGHT, type Building, type Plan } from './plan';
import { paletteColor, type PaletteName } from './tsl';

/** Facade grid per style: bay width, and the ground floor the shopfronts occupy. Shared with the facade shader. */
export const BAY = [3.2, 2.4, 3.2, 1.6];
export const PODIUM = 4.5;
export const SHOP_BAY = 4.5;

const col = (name: PaletteName, k = 1) => paletteColor(name).multiplyScalar(k);

/**
 * Every building, near to horizon, as one mesh: four walls and a roof per building, with
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
    const bay = BAY[b.style];
    const side = (ax: number, az: number, bx: number, bz: number, n: number[], street: boolean) => {
      const len = Math.hypot(bx - ax, bz - az);
      const bays = Math.max(1, Math.floor((len - 0.6) / bay));
      const margin = (len - bays * bay) / 2;
      quad([[ax, 0, az], [bx, 0, bz], [bx, b.h, bz], [ax, b.h, az]], n,
        [[-margin, 0], [len - margin, 0], [len - margin, b.h], [-margin, b.h]], [seed, b.style, b.h, street ? 1 : 0], [bays, len]);
    };
    // Counter-clockwise seen from outside, so u runs left to right on every wall.
    side(b.x0, b.z1, b.x1, b.z1, [0, 0, 1], b.street.zmax);
    side(b.x1, b.z0, b.x0, b.z0, [0, 0, -1], b.street.zmin);
    side(b.x1, b.z1, b.x1, b.z0, [1, 0, 0], b.street.xmax);
    side(b.x0, b.z0, b.x0, b.z1, [-1, 0, 0], b.street.xmin);
    quad([[b.x0, b.h, b.z1], [b.x1, b.h, b.z1], [b.x1, b.h, b.z0], [b.x0, b.h, b.z0]], [0, 1, 0],
      [[0, 0], [b.x1 - b.x0, 0], [b.x1 - b.x0, b.z1 - b.z0], [0, b.z1 - b.z0]], [seed, 9, b.h, 0], [1, 1]);
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
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, this.count);
    mesh.instanceMatrix.array.set(this.m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
    geometry.setAttribute('aFx', new THREE.InstancedBufferAttribute(new Float32Array(this.fx), 2));
    mesh.frustumCulled = false;
    mesh.name = 'boxes';
    return mesh;
  }
}

export interface FixtureLight { x: number; y: number; z: number; strength: number }
export interface SignLight { x: number; z: number; size: number; color: THREE.Color; strength: number }
export interface Roof { x0: number; x1: number; z0: number; z1: number; h: number }

const TUBE_COLORS: Record<string, number> = { sign_red: 32, sign_amber: 25, tungsten: 14, fluorescent: 16, sign_cyan: 5, sodium: 8 };
const BOX_COLORS: Record<string, number> = { fluorescent: 45, tungsten: 30, sign_amber: 15, sign_red: 10 };
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
  private readonly blades = catalog.designs.map((d, i) => ({ d, i })).filter((x) => x.d.kind === 'blade' && !('brand' in x.d));
  private readonly panels = catalog.designs.map((d, i) => ({ d, i })).filter((x) => x.d.kind === 'panel' && !('brand' in x.d));

  pick(kind: 'blade' | 'panel', rng: () => number) {
    const pool = kind === 'blade' ? this.blades : this.panels;
    return pool[Math.floor(rng() * pool.length)].d;
  }

  /** `rotY`: the sign's face normal is +Z rotated by it. Returns the sign's width. */
  add(d: (typeof catalog.designs)[number], x: number, y: number, z: number, height: number, rotY: number, rng: () => number, gain = 1) {
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
    this.lights.push({ x, z, size: Math.max(w, height), color: d.boxed ? back.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : tube, strength: d.boxed ? 0.6 : 1 });
    return w;
  }

  build(material: THREE.Material): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const n = this.gain.length;
    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.instanceMatrix.array.set(this.m);
    const attr = (name: string, data: number[], size: number) => geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
    attr('aRect', this.rect, 4); attr('aTube', this.tube, 3); attr('aBack', this.back, 3); attr('aParams', this.params, 4); attr('aGain', this.gain, 1);
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
  for (const [x0, x1, z0, z1] of plan.blocks) {
    const sz = (z: number) => (Math.abs(Math.abs(z) - mainEdge) < 1e-6 ? plan.main.sidewalk : Math.abs(z) < plan.size.z ? plan.back.sidewalk : 0);
    const a = x0 - (x0 > -plan.size.x ? plan.cross.sidewalk : 0), b = x1 + (x1 < plan.size.x ? plan.cross.sidewalk : 0);
    const c = z0 - sz(z0), d = z1 + sz(z1);
    boxes.add((a + b) / 2, 0.075, (c + d) / 2, b - a, 0.15, d - c, sidewalk);
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
  const BEAM_W = 1.5, BEAM_H = 1.7, beamTop = m.beamY + BEAM_H;
  const hull = col('car_silver', 0.5), glass = col('glass_dark', 2.2), trim = col('fluorescent').lerp(col('sign_cyan'), 0.35);
  boxes.add(mMid, 0.11, 0, mLen, 0.22, 2, dark);                                     // median
  for (const s of [-1, 1]) {
    boxes.add(mMid, m.beamY + BEAM_H / 2, s * m.trackZ, mLen, BEAM_H, BEAM_W, hull);                  // girder
    boxes.add(mMid, m.beamY + 0.03, s * (m.trackZ + BEAM_W / 2 + 0.03), mLen, 0.05, 0.05, trim, 1.3);  // light line
    roofs.push({ x0: m.x0, x1: m.x1, z0: s * m.trackZ - BEAM_W / 2, z1: s * m.trackZ + BEAM_W / 2, h: beamTop });
  }
  for (const x of m.piers) {
    // T pier: a shaft that narrows above a plinth, an arm across both girders, a lit collar.
    boxes.add(x, 1.4, 0, 1.7, 2.8, 1.5, concrete);
    boxes.add(x, (beamTop + 2.8) / 2, 0, 1.15, beamTop - 2.8, 1.0, hull);
    boxes.add(x, beamTop + 0.5, 0, 1.5, 1.0, 2 * m.trackZ + BEAM_W + 0.8, hull);
    boxes.add(x, 2.86, 0, 1.2, 0.05, 1.05, trim, 1.1);
    for (const s of [-1, 1]) boxes.add(x, beamTop + 1.05, s * (m.trackZ + BEAM_W / 2 + 0.2), 0.3, 0.12, 0.3, red, 5, 3 + (Math.abs(x) % 5));
  }

  // Station: side platforms slung at car-floor height under a roof on portal frames that
  // stand on the sidewalks and span the whole street. Glass screens at the platform edge.
  const [s0, s1] = m.station, sMid = (s0 + s1) / 2, sLen = s1 - s0;
  const [pIn, pOut] = m.platform, pMid = (pIn + pOut) / 2, pW = pOut - pIn;
  const platY = m.floorY, roofHalf = pOut + 0.8, legZ = plan.main.half + 0.9;
  boxes.add(sMid, m.roofY + 0.12, 0, sLen + 3, 0.24, roofHalf * 2, hull);
  for (const e of [-1, 1]) boxes.add(sMid, m.roofY + 0.12, e * (roofHalf + 0.03), sLen + 3, 0.07, 0.05, trim, 1.2);   // roof edge lines
  roofs.push({ x0: s0 - 1.5, x1: s1 + 1.5, z0: -roofHalf, z1: roofHalf, h: m.roofY + 0.24 });
  for (let x = s0; x <= s1 + 0.1; x += sLen / 4) {
    for (const s of [-1, 1]) boxes.add(x, m.roofY / 2, s * legZ, 0.8, m.roofY, 0.65, hull);
    boxes.add(x, m.roofY + 0.7, 0, 0.9, 0.95, legZ * 2 + 0.65, hull);
  }
  for (const s of [-1, 1]) {
    boxes.add(sMid, platY - 0.18, s * pMid, sLen, 0.36, pW, concrete);                              // platform
    boxes.add(sMid, platY + 0.012, s * (pIn + 0.5), sLen, 0.02, 0.22, col('car_yellow', 1.3));     // tactile strip
    boxes.add(sMid, platY - 0.34, s * (pIn + 0.06), sLen, 0.05, 0.06, trim, 0.9);                   // underside line
    // Platform screens: glass to waist height with a lit rail, in panels between door gaps.
    for (let x = s0 + 2.4; x < s1 - 2; x += 4.8) {
      boxes.add(x, platY + 0.62, s * (pIn + 0.05), 3.4, 1.24, 0.05, glass);
      boxes.add(x, platY + 1.27, s * (pIn + 0.05), 3.4, 0.05, 0.07, trim, 1.2);
    }
    // Outer edge: a glass balustrade with a rail, between the hangers that carry the platform from the roof.
    boxes.add(sMid, platY + 0.6, s * (pOut - 0.04), sLen, 1.2, 0.05, glass);
    boxes.add(sMid, platY + 1.23, s * (pOut - 0.04), sLen, 0.05, 0.07, hull);
    for (let x = s0 + 3; x <= s1 - 3; x += 6.2) boxes.add(x, (platY + m.roofY) / 2, s * (pOut - 0.1), 0.12, m.roofY - platY, 0.12, hull);
    for (let x = s0 + 5; x < s1 - 4; x += 4) boxes.tube(x, platY + 2.85, s * (pMid + 0.5), 2.4, 1.5);                   // platform lights
    for (let x = s0 + 9; x < s1 - 6; x += 16) {
      boxes.add(x, platY + 0.9, s * (pOut - 0.5), 1.1, 1.8, 0.7, col('car_navy'));                                      // vending machine
      boxes.add(x, platY + 1.05, s * (pOut - 0.86), 0.9, 1.3, 0.03, fluor, 0.8);
      boxes.add(x + 5, platY + 0.45, s * (pOut - 0.55), 2.2, 0.08, 0.5, col('interior_wood'));                          // bench
    }
    roofs.push({ x0: s0, x1: s1, z0: Math.min(s * pIn, s * pOut), z1: Math.max(s * pIn, s * pOut), h: platY });
  }
  const dk = plan.deck, dMidZ = (dk.z0 + dk.z1) / 2, dW = dk.z1 - dk.z0;
  boxes.add((dk.x0 + dk.x1) / 2, dk.y - 0.2, dMidZ, dk.x1 - dk.x0, 0.4, dW, concrete);
  boxes.add((dk.x0 + dk.x1) / 2, dk.y + 0.55, dk.z0 + 0.06, dk.x1 - dk.x0, 1.1, 0.08, steel);
  for (let x = dk.x0 + 5; x < dk.x1 - 3; x += 6) boxes.tube(x, dk.y - 0.43, dMidZ, 2.4, 1.3);
  for (let x = dk.x0 + 3; x <= dk.x1 - 3; x += 10) boxes.add(x, (dk.y - 0.4) / 2, dk.z1 - 0.4, 0.3, dk.y - 0.4, 0.3, metal);
  roofs.push({ x0: dk.x0, x1: dk.x1, z0: dk.z0, z1: dk.z1, h: dk.y });
  // A flight of steps from (x, z) at `y0`, rising toward `dir` along x until `y1`.
  const stairs = (x: number, z: number, y0: number, y1: number, dir: number, width: number) => {
    const steps = Math.round((y1 - y0) / 0.18);
    for (let i = 0; i < steps; i++) {
      const top = y0 + (i + 1) * 0.18, h = Math.min(top - y0, 0.7);   // blocks down to the flight's underside
      boxes.add(x + (i + 0.5) * 0.3 * dir, top - h / 2, z, 0.3, h, width, dark);
    }
  };
  const runOf = (rise: number) => Math.round(rise / 0.18) * 0.3;
  for (const s of [-1, 1]) {
    // Sidewalk up to the deck at both of its ends.
    stairs((s < 0 ? dk.x0 : dk.x1) + s * runOf(dk.y - 0.15), dMidZ, 0.15, dk.y, -s, dW - 0.4);
    // Deck up to the north platform: a flight in the gap between them, with a landing at each end.
    const zGap = (pOut + dk.z0) / 2 + 0.1, run = runOf(platY - dk.y);
    stairs(s * (14 + run), zGap, dk.y, platY, -s, 1.4);
    boxes.add(s * (15.5 + run), dk.y - 0.1, zGap, 3, 0.2, dk.z0 - pOut + 0.3, concrete);
    boxes.add(s * 12.5, platY - 0.1, zGap, 3, 0.2, dk.z0 - pOut + 0.3, concrete);
    // South platform: one long flight from the sidewalk, and a landing across to the platform.
    const zS = -(legZ + 1.0), runS = runOf(platY - 0.15);
    stairs(s * (9 + runS), zS, 0.15, platY, -s, 1.3);
    boxes.add(s * 7.5, platY - 0.1, (zS - 0.65 - pOut) / 2, 3, 0.2, zS - 0.65 + pOut < 0 ? -(zS - 0.65 + pOut) : 0.1, concrete);
  }

  // --- skybridges over the cross streets ---
  for (const b of plan.bridges) {
    const mx = (b.x0 + b.x1) / 2, len = b.x1 - b.x0;
    boxes.add(mx, b.y + 1.6, b.z, len, 3.2, 4, metal);
    for (const s of [-1, 1]) boxes.add(mx, b.y + 1.75, b.z + s * 2.01, len - 1.2, 1.5, 0.04, fluor, 0.9);
    boxes.tube(mx, b.y - 0.03, b.z, len - 3, 1.8, 0.2);
    roofs.push({ x0: b.x0, x1: b.x1, z0: b.z - 2, z1: b.z + 2, h: b.y + 3.2 });
  }

  // --- buildings: roofs for the rain, kit parts and signs on the near tier ---
  for (const b of [...plan.buildings, ...plan.skyline]) {
    roofs.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, h: b.h });
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // Aviation lights on anything tall, visible to the horizon.
    if (b.h > 90) for (const [x, z] of [[b.x0 + 1, b.z0 + 1], [b.x1 - 1, b.z1 - 1]]) boxes.add(x, b.h + 0.8, z, 1.3, 1.3, 1.3, red, 9, 1 + (b.seed % 7));
    if (!b.near) continue;
    const r = mulberry32(b.seed);
    const housing = b.style === 0 || b.style === 2;
    const bay = BAY[b.style];
    // Roof: parapet, stair head, water tank, mast.
    for (const [x, z, sx, szz] of [[cx, b.z0 + 0.12, b.x1 - b.x0, 0.24], [cx, b.z1 - 0.12, b.x1 - b.x0, 0.24], [b.x0 + 0.12, cz, 0.24, b.z1 - b.z0], [b.x1 - 0.12, cz, 0.24, b.z1 - b.z0]]) {
      boxes.add(x, b.h + 0.35, z, sx, 0.7, szz, dark);
    }
    boxes.add(cx + (r() - 0.5) * 4, b.h + 1.4, cz + (r() - 0.5) * 4, 3.2, 2.8, 4.2, concrete);
    if (r() < 0.6) {
      const tx = b.x0 + 2.5 + r() * 2, tz = b.z1 - 2.5 - r() * 2;
      boxes.add(tx, b.h + 1.9, tz, 2, 1.8, 2, col('paint_cream', 0.5));
      for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) boxes.add(tx + ox, b.h + 0.5, tz + oz, 0.12, 1, 0.12, metal);
    }
    if (r() < 0.35) boxes.add(b.x1 - 2, b.h + 4, b.z0 + 2, 0.1, 8, 0.1, metal);

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
        boxes.add(px, (b.h + PODIUM) / 2, pz, 0.12, b.h - PODIUM, 0.12, metal);
      }
      // Shopfront bays: awning and a sign board over most of them.
      const shops = Math.max(1, Math.floor(len / SHOP_BAY)), shopMargin = (len - shops * SHOP_BAY) / 2;
      for (let s = 0; s < shops; s++) {
        const u = shopMargin + (s + 0.5) * SHOP_BAY;
        if (r() < 0.5) {
          const [x, z] = at(u, 0.75);
          // Tilted so the outer edge drops: about X on walls facing ±z, about Z on walls facing ±x.
          boxes.add(x, 3.25, z, ux ? SHOP_BAY - 0.7 : 1.5, 0.07, ux ? 1.5 : SHOP_BAY - 0.7, col(AWNINGS[Math.floor(r() * AWNINGS.length)], 0.8), 0, 0, [nz * 0.24, 0, -nx * 0.24]);
        }
        if (r() < 0.78) {
          const d = signs.pick('panel', r);
          const h = Math.min(0.85, (SHOP_BAY - 0.9) / d.aspect);
          const [x, z] = at(u, 0.2);
          signs.add(d, x, 3.95, z, h, yaw, r);
        }
      }
      // Upper floors: AC units and balconies on housing, per bay and floor.
      const floors = Math.floor((b.h - PODIUM) / FLOOR_HEIGHT);
      if (housing) {
        for (let f = 0; f < Math.min(floors, 14); f++) {
          const y0 = PODIUM + f * FLOOR_HEIGHT;
          for (let k = 0; k < bays; k++) {
            const u = margin + (k + 0.5) * bay, h = r();
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
      // Blade signs out over the sidewalk, on arms.
      const blades = b.h < 50 ? Math.floor(r() * 3.2) : Math.floor(r() * 2);
      for (let k = 0; k < blades; k++) {
        const d = signs.pick('blade', r);
        const h = Math.min(3 + r() * 4.5, b.h - PODIUM - 2);
        const y = PODIUM + 1 + h / 2 + r() * Math.max(0, Math.min(b.h - PODIUM - 2 - h, 16));
        const u = 1.2 + r() * (len - 2.4);
        const w = h * d.aspect, out = 0.45 + w / 2;
        const [x, z] = at(u, out);
        signs.add(d, x, y, z, h, yaw + Math.PI / 2, r);
        for (const dy of [h / 2 - 0.1, -h / 2 + 0.1]) {
          const [bx, bz] = at(u, out / 2);
          boxes.add(bx, y + dy, bz, nx ? out : 0.07, 0.07, nz ? out : 0.07, metal);
        }
      }
      // A rooftop board on some of the lower buildings.
      if (b.h < 45 && len > 12 && r() < 0.3) {
        const d = signs.pick('panel', r);
        const h = Math.min(2.6, (len - 3) / d.aspect);
        const [x, z] = at(len / 2, -0.6);
        signs.add(d, x, b.h + 1.6 + h / 2, z, h, yaw, r, 1.5);
        const w = h * d.aspect;
        for (const o of [-0.4, 0.4]) {
          const [px, pz] = at(len / 2 + o * w, -0.85);
          boxes.add(px, b.h + 1.3 + h / 2, pz, 0.14, h + 1.2, 0.14, metal);
        }
      }
    }
  }
  return roofs;
}
