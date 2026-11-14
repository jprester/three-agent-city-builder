import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../art/layouts/lib/rng.mjs';
import { Boxes } from './build';
import type { Plan } from './plan';
import { paletteColor, type PaletteName } from './tsl';

/** Seconds: one full cycle, of which the train stands in the station for DWELL. */
const CYCLE = 84, DWELL = 12, RUN = 24;
/** Heights on the car body above its floor: window sill, window and door head, ceiling. */
const SILL = 0.85, HEAD = 2.15, CEIL = 2.08;
/** Side wall thickness: deep enough that a door leaf sits in a visible recess. */
const WALL = 0.14;
/** Nose: slices along the taper and its length. */
const NOSE_SLICES = 16, NOSE = 1.9;
const col = (name: PaletteName, k = 1) => paletteColor(name).multiplyScalar(k);

/**
 * Two suspended monorail trains, one per girder, half a cycle apart. A train is a set of boxes
 * in one instanced mesh, built with the car floor at y = 0 and hung from the girder by hangers:
 * white hull with real openings (a lit interior with ceiling, seats and passengers shows
 * through the windows), recessed doors with a lit threshold, a stepped and glazed nose with a
 * destination display, a cyan line along the underframe. Position is a pure function of the
 * clock: run in, brake into the station, stand, pull away.
 */
export function createTrains(plan: Plan, material: THREE.Material): { group: THREE.Group; update(time: number): void } {
  const group = new THREE.Group();
  group.name = 'trains';
  const m = plan.monorail, car = m.car;
  const L = car.length, W = car.width, H = car.height;
  const length = car.count * (L + car.gap);
  const hull = col('car_white', 0.62), under = col('car_silver', 0.32), glass = col('glass_dark', 1.6), black = col('car_black', 0.5);
  const fluor = col('fluorescent'), cyan = col('sign_cyan'), amber = col('sign_amber'), strut = col('metal_dark', 2);
  const leafColor = col('car_grey', 0.42), lining = col('interior_white', 0.75), fabric = col('interior_fabric', 0.9), floorColor = col('interior_carpet', 0.6);
  const clothes: PaletteName[] = ['car_black', 'car_navy', 'concrete_dark', 'car_grey', 'car_beige', 'clad_charcoal'];
  const hangerTop = m.beamY - m.floorY + 0.3;

  /** Parts of [a, b] left after removing `holes` (each [lo, hi]). */
  const solid = (a: number, b: number, holes: [number, number][]) => {
    const out: [number, number][] = [];
    let at = a;
    for (const [lo, hi] of [...holes].sort((p, q) => p[0] - q[0])) { if (lo > at) out.push([at, lo]); at = Math.max(at, hi); }
    if (b > at) out.push([at, b]);
    return out;
  };

  const make = (dir: number, z: number, seed: number) => {
    const boxes = new Boxes();
    const rng = mulberry32(seed);
    const hw = car.doorWidth / 2;
    const doorHoles = car.doors.map((d) => [d - hw, d + hw] as [number, number]);
    // Windows: two in the middle bay, one in each end bay, kept clear of the doors.
    const windows: [number, number][] = [];
    const [d0, d1] = car.doors;
    const mid0 = d0 + hw + 0.35, mid1 = d1 - hw - 0.35;
    windows.push([mid0, -0.2], [0.2, mid1], [-L / 2 + 0.65, d0 - hw - 0.35], [d1 + hw + 0.35, L / 2 - 0.65]);
    const piers = solid(-L / 2, L / 2, [...doorHoles, ...windows]);
    const skirts = solid(-L / 2, L / 2, doorHoles);

    for (let c = 0; c < car.count; c++) {
      const x = (c - (car.count - 1) / 2) * (L + car.gap);
      // Shell: underframe, skirt between the doors, roof band, a raised roof, end walls.
      boxes.add(x, -0.16, 0, L - 0.3, 0.32, W - 0.22, under);
      for (const s of [-1, 1]) boxes.add(x, -0.12, s * ((W - 0.22) / 2 + 0.01), L - 0.5, 0.05, 0.02, cyan, 1.5);
      for (const [a, b] of skirts) boxes.add(x + (a + b) / 2, SILL / 2, 0, b - a, SILL, W, hull);
      boxes.add(x, (HEAD + H) / 2, 0, L, H - HEAD, W, hull);
      boxes.add(x, H + 0.06, 0, L - 0.6, 0.12, W - 0.5, hull);
      for (const e of [-1, 1]) {
        boxes.add(x + e * (L / 2 - 0.05), (SILL + HEAD) / 2, 0, 0.1, HEAD - SILL, W - 0.02, hull);
        boxes.add(x + e * (L / 2 - 0.11), (SILL + CEIL) / 2, 0, 0.02, CEIL - SILL, W - 2 * WALL, lining, 0.3);
        boxes.add(x + e * (L / 2 - 0.125), 1.25, 0, 0.02, 1.7, 0.75, glass);                          // gangway door
      }
      if (c > 0) boxes.add(x - (L + car.gap) / 2, 1.1, 0, car.gap + 0.1, 2.2, W - 0.45, black);         // bellows

      for (const s of [-1, 1]) {
        const face = s * W / 2;
        // Window band: piers between openings, a lit lining behind each, dark rubber lines along the band.
        for (const [a, b] of piers) {
          boxes.add(x + (a + b) / 2, (SILL + HEAD) / 2, s * (W / 2 - WALL / 2), b - a, HEAD - SILL, WALL, hull);
          boxes.add(x + (a + b) / 2, (SILL + CEIL) / 2, s * (W / 2 - WALL - 0.015), b - a, CEIL - SILL, 0.03, lining, 0.3);
        }
        for (const [a, b] of skirts) for (const y of [SILL, HEAD]) boxes.add(x + (a + b) / 2, y, face + s * 0.008, b - a, 0.05, 0.03, black);
        // Doors: a leaf set back in the wall, two lit panes, a centre seam, a lit threshold, a lamp over it.
        for (const d of car.doors) {
          const dx = x + d;
          boxes.add(dx, HEAD / 2, s * (W / 2 - 0.12), car.doorWidth, HEAD, 0.04, leafColor);
          for (const o of [-0.3, 0.3]) boxes.add(dx + o, 1.5, s * (W / 2 - 0.095), 0.42, 0.85, 0.02, fluor.clone().lerp(lining, 0.5), 0.35);
          boxes.add(dx, HEAD / 2, s * (W / 2 - 0.095), 0.025, HEAD, 0.025, black);
          boxes.add(dx, 0.015, s * (W / 2 - 0.05), car.doorWidth, 0.03, 0.1, fluor, 2.5);
          boxes.add(dx, HEAD + 0.12, face + s * 0.01, 0.3, 0.06, 0.03, amber, 3);
        }
        // Seat backs along the walls, between the doors and in the end bays.
        for (const [a, b] of [[mid0 - 0.1, mid1 + 0.1], [-L / 2 + 0.4, d0 - hw - 0.25], [d1 + hw + 0.25, L / 2 - 0.4]]) {
          boxes.add(x + (a + b) / 2, 0.9, s * (W / 2 - WALL - 0.12), b - a, 0.62, 0.1, fabric, 0.18);
        }
        boxes.add(x, 1.95, s * 0.55, L - 1.2, 0.03, 0.03, strut);                                      // grab rail
        boxes.add(x, CEIL - 0.015, s * 0.42, L - 1.4, 0.03, 0.12, fluor, 3);                           // light strip
      }
      boxes.add(x, -0.03, 0, L - 0.2, 0.06, W - 2 * WALL, floorColor, 0.12);
      boxes.add(x, (CEIL + HEAD) / 2, 0, L - 0.2, HEAD - CEIL, W - 2 * WALL, lining, 0.55);

      // Passengers as silhouettes against the lit interior: some standing in the aisle, some seated.
      const standing = 1 + Math.floor(rng() * 4), seated = 2 + Math.floor(rng() * 4);
      for (let p = 0; p < standing + seated; p++) {
        const sit = p >= standing, tall = 1.55 + rng() * 0.3, cloth = col(clothes[Math.floor(rng() * clothes.length)], 0.55);
        const px = x + (rng() - 0.5) * (L - 2.4);
        const pz = sit ? (rng() < 0.5 ? -1 : 1) * (W / 2 - WALL - 0.42) : (rng() - 0.5) * 0.9;
        const top = sit ? tall * 0.72 : tall;
        boxes.add(px, (top - 0.25) / 2 + 0.1, pz, 0.42, top - 0.25, 0.3, cloth);
        boxes.add(px, top - 0.11, pz, 0.2, 0.24, 0.22, col('concrete_dark', 0.5));
      }

      // Hangers: a fairing on the roof, a plate up into the girder's slot, two raked links.
      for (const o of [-L * 0.3, L * 0.3]) {
        boxes.add(x + o, H + 0.22, 0, 2.2, 0.2, 1.1, strut);
        boxes.add(x + o, (H + 0.3 + hangerTop) / 2, 0, 0.36, hangerTop - H - 0.3, 0.18, strut);
        for (const e of [-1, 1]) {
          const x0 = 0.95, x1 = 0.16, y0 = H + 0.3, y1 = hangerTop - 0.25;
          const len = Math.hypot(x0 - x1, y1 - y0);
          boxes.add(x + o + e * (x0 + x1) / 2, (y0 + y1) / 2, 0, len, 0.1, 0.14, strut, 0, 0, [0, 0, -e * Math.atan2(y1 - y0, x0 - x1)]);
        }
      }
    }

    // Noses: thin slices narrowing and dropping on a curve, a raked windscreen over them, a chin
    // panel under them, a destination display in the head of the screen, and the lamps.
    // Profile: curved over the first third, then straight, so the raked panels lie along the slices' edges.
    const bend = (t: number) => (t < 0.35 ? (t * t) / 0.7 : t - 0.175) / 0.825;
    const top = (t: number) => H - 1.85 * bend(t), bottom = (t: number) => -0.32 + 0.3 * bend(t), width = (t: number) => W * (1 - 0.3 * t * t);
    for (const e of [-1, 1]) {
      const tip = e * (length / 2 - car.gap / 2);
      const step = NOSE / NOSE_SLICES;
      for (let i = 0; i < NOSE_SLICES; i++) {
        const t = (i + 0.5) / NOSE_SLICES;
        boxes.add(tip + e * (i + 0.5) * step, (top(t) + bottom(t)) / 2, 0, step + 0.002, top(t) - bottom(t), width(t), hull);
      }
      /**
       * A raked panel on the straight part of a profile, from t0 to t1, its centre at `along`
       * (0..1) of that run and `lift` off the surface (up for the top, down for the bottom).
       */
      const panel = (prof: (t: number) => number, t0: number, t1: number, along: number, span: number, lift: number, thick: number, w: number, z: number, color: THREE.Color, emit = 0) => {
        const xa = e * t0 * NOSE, ya = prof(t0), dx = e * (t1 - t0) * NOSE, dy = prof(t1) - ya, len = Math.hypot(dx, dy);
        const nx = (e * Math.abs(dy)) / len, ny = (Math.sign(lift) * Math.abs(dx)) / len;
        boxes.add(tip + xa + dx * along + nx * Math.abs(lift), ya + dy * along + ny * Math.abs(lift), z, len * span, thick, w, color, emit, 0, [0, 0, Math.atan2(dy, dx)]);
      };
      panel(top, 0.36, 0.98, 0.55, 0.88, 0.075, 0.03, width(1) * 0.94, 0, glass);
      panel(bottom, 0.36, 1, 0.5, 1, -0.04, 0.03, width(1) * 0.94, 0, under);
      panel(top, 0.36, 0.98, 0.08, 0.13, 0.095, 0.02, width(1) * 0.7, 0, black);                    // display housing
      for (let k = 0; k < 7; k++) {
        const w = 0.07 + 0.07 * ((k * 5 + seed) % 3);
        panel(top, 0.36, 0.98, 0.08, 0.06, 0.107, 0.01, w, (k - 3) * 0.17, amber, 4);                   // destination characters
      }
      const ahead = e === dir;
      const front = tip + e * (NOSE + 0.005);
      for (const zl of [-0.55, 0.55]) boxes.add(front, 0.5, zl, 0.02, 0.13, 0.36, ahead ? new THREE.Color(1, 0.96, 0.88) : col('sign_red'), ahead ? 9 : 4);
      boxes.add(front, 0.32, 0, 0.02, 0.03, width(1) * 0.8, ahead ? fluor : col('sign_red'), 2);
    }
    const mesh = boxes.build(material);
    mesh.position.set(0, m.floorY, z);
    group.add(mesh);
    return mesh;
  };
  const trains = [{ mesh: make(1, -m.trackZ, 11), dir: 1, offset: 0 }, { mesh: make(-1, m.trackZ, 23), dir: -1, offset: CYCLE / 2 }];
  const far = (m.x1 - m.x0) / 2 + length;
  const ease = (t: number) => t * t * (3 - 2 * t);
  return {
    group,
    update(time) {
      for (const t of trains) {
        const phase = (((time + t.offset) % CYCLE) + CYCLE) % CYCLE;
        // Along the track: -far → 0 (arrive, easing out), stand, 0 → far (depart, easing in).
        let along: number;
        if (phase < RUN) along = -far * (1 - ease(phase / RUN) * (2 - ease(phase / RUN)));
        else if (phase < RUN + DWELL) along = 0;
        else if (phase < 2 * RUN + DWELL) along = far * ease((phase - RUN - DWELL) / RUN) ** 2;
        else along = far * 2;   // out of sight until the next cycle
        t.mesh.position.x = t.dir * along;
        t.mesh.visible = phase < 2 * RUN + DWELL;
      }
    },
  };
}
