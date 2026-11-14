import { mulberry32 } from '../../art/layouts/lib/rng.mjs';

/**
 * The city as data, streets first. A small road graph (one main street, four cross streets,
 * two back streets) defines the blocks; blocks are cut into lots; lots get buildings. The
 * vertical layers are part of the plan from the start: a suspended monorail with a station
 * over the main street, a pedestrian deck beside it, and skybridges over the cross streets.
 * Everything is axis-aligned and deterministic from the seed. Units are meters, +y up.
 */
export interface Building {
  x0: number; x1: number; z0: number; z1: number;
  h: number;
  seed: number;
  /** 0 tiled housing, 1 concrete office, 2 painted housing, 3 glass tower. */
  style: number;
  /** Which walls face a street (and get shopfronts, signs and street furniture). */
  street: { xmin: boolean; xmax: boolean; zmin: boolean; zmax: boolean };
  /** Near tier: gets kit parts (AC units, balconies, pipes, awnings, roof clutter). */
  near: boolean;
}

export interface Lane {
  /** Start point and unit direction on the ground; cars wrap after `length`. */
  x: number; z: number; dx: number; dz: number; length: number;
  /** Signal phase: 0 runs with the main street, 1 with the cross streets. */
  phase: number;
  cars: number;
  speed: number;
}

export interface Plan {
  seed: number;
  size: { x: number; z: number };
  main: { half: number; sidewalk: number };
  cross: { xs: number[]; half: number; sidewalk: number };
  back: { zs: number[]; half: number; sidewalk: number };
  /** Block rectangles (sidewalk edge to sidewalk edge): x0, x1, z0, z1. */
  blocks: [number, number, number, number][];
  buildings: Building[];
  /** Far tier: skyline boxes beyond the built area. */
  skyline: Building[];
  /** Street lamps: pole x, z and the direction the arm points (unit x, z). */
  lamps: [number, number, number, number][];
  /**
   * Suspended monorail down the median (Chiba style): two box-girder tracks at z = ±trackZ
   * carried by T-shaped piers, cars hanging beneath. `beamY` is the underside of the girders,
   * `floorY` the car floor and platform level, `roofY` the station roof.
   */
  monorail: {
    x0: number; x1: number; piers: number[]; trackZ: number; beamY: number; floorY: number; roofY: number;
    /** Station extent along x, and its side platforms' inner and outer edge (|z|). */
    station: [number, number]; platform: [number, number];
    /**
     * The cars: length, gap between cars, count, body width and height (floor to roof), and
     * the door centres along a car (from its middle) with the door width. Trains stop with
     * their middle at x = 0, so `doorXs` are where the doors stand at the platform.
     */
    car: { length: number; gap: number; count: number; width: number; height: number; doors: number[]; doorWidth: number };
    doorXs: number[];
    /** Girder section, stiffener rib spacing along it, and the span between joints. */
    girder: { width: number; height: number; ribEvery: number };
  };
  /** Every stair in the plan: riser and tread, landing length (m), and the most a flight rises before a landing. */
  stair: { riser: number; tread: number; landing: number; maxRise: number };
  /** Pedestrian deck beside the station: x0, x1, z0, z1, y. */
  deck: { x0: number; x1: number; z0: number; z1: number; y: number };
  /** Skybridges over cross streets: x0, x1, z, y (enclosed, 3.2 m tall, 4 m wide). */
  bridges: { x0: number; x1: number; z: number; y: number }[];
  lanes: Lane[];
  /** Signal cycle in seconds: green and amber per phase; the rest is red. */
  signal: { period: number; green: number; amber: number };
}

const FLOOR = 3.2;

export function createPlan(seed = 7): Plan {
  const rng = mulberry32(seed);
  const size = { x: 250, z: 185 };
  const main = { half: 9, sidewalk: 4 };
  const cross = { xs: [-150, -50, 50, 150], half: 5, sidewalk: 3 };
  const back = { zs: [-95, 95], half: 4, sidewalk: 2.5 };

  // Blocks: the rectangles left between the streets.
  const cut = (centers: number[], half: number, lo: number, hi: number) => {
    const out: [number, number][] = [];
    let a = lo;
    for (const c of centers) { out.push([a, c - half]); a = c + half; }
    out.push([a, hi]);
    return out;
  };
  const xRanges = cut(cross.xs, cross.half + cross.sidewalk, -size.x, size.x);
  const mainEdge = main.half + main.sidewalk, backEdge = back.half + back.sidewalk;
  const zRanges: [number, number][] = [
    [-size.z, back.zs[0] - backEdge], [back.zs[0] + backEdge, -mainEdge], [mainEdge, back.zs[1] - backEdge], [back.zs[1] + backEdge, size.z],
  ];
  const blocks: Plan['blocks'] = [];
  for (const [x0, x1] of xRanges) for (const [z0, z1] of zRanges) blocks.push([x0, x1, z0, z1]);

  // Lots: each block is two rows of frontages, one on each of its long streets.
  const buildings: Building[] = [];
  const GAP = 0.5;
  for (const [x0, x1, z0, z1] of blocks) {
    const inner = Math.abs(z0) < 100 && Math.abs(z1) < 100;   // touches the main street
    const mid = (z0 + z1) / 2 + (rng() - 0.5) * 6;
    for (const [r0, r1] of [[z0, mid], [mid, z1]] as const) {
      const onMain = Math.abs(r0) === mainEdge || Math.abs(r1) === mainEdge;
      let x = x0;
      while (x < x1 - 1) {
        let w = 14 + rng() * 12;
        if (x1 - (x + w) < 12) w = x1 - x;
        const roll = rng();
        let h: number, style: number;
        if (onMain) {
          // Old core on the main street: low and mixed, with the odd slim tower.
          h = roll < 0.12 ? 60 + rng() * 45 : 16 + rng() * 26;
          style = roll < 0.12 ? (rng() < 0.5 ? 3 : 1) : [0, 0, 2, 2, 1][Math.floor(rng() * 5)];
        } else if (inner) {
          h = 30 + rng() * 60;
          style = [0, 1, 1, 2, 3][Math.floor(rng() * 5)];
        } else {
          h = 50 + rng() * rng() * 150;
          style = rng() < 0.55 ? 3 : 1;
        }
        buildings.push({
          x0: x + GAP / 2, x1: x + w - GAP / 2, z0: r0 + GAP / 2, z1: r1 - GAP / 2,
          h: Math.round(h / FLOOR) * FLOOR + 1.1,
          seed: Math.floor(rng() * 1e6), style,
          street: { xmin: x === x0, xmax: x + w >= x1 - 1e-6, zmin: r0 === z0, zmax: r1 === z1 },
          near: onMain || (inner && (x === x0 || x + w >= x1 - 1e-6)),
        });
        x += w;
      }
    }
  }

  // Far tier: a ring of towers out to the horizon, denser near the city.
  const skyline: Building[] = [];
  for (let i = 0; i < 520; i++) {
    const a = rng() * Math.PI * 2, r = 330 + rng() * rng() * 1300;
    const cx = Math.cos(a) * r * 1.25, cz = Math.sin(a) * r;
    if (Math.abs(cx) < size.x + 30 && Math.abs(cz) < size.z + 30) continue;
    const w = 24 + rng() * 34, d = 24 + rng() * 34;
    const h = (50 + rng() * rng() * 330) * (1 - Math.min(r / 2600, 0.5));
    skyline.push({
      x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h: Math.round(h / FLOOR) * FLOOR,
      seed: Math.floor(rng() * 1e6), style: rng() < 0.6 ? 3 : 1,
      street: { xmin: false, xmax: false, zmin: false, zmax: false }, near: false,
    });
  }

  // Street lamps at the curb, arms over the road.
  const lamps: Plan['lamps'] = [];
  for (let x = -size.x + 14; x < size.x; x += 28) {
    if (cross.xs.some((c) => Math.abs(x - c) < cross.half + 5)) continue;
    lamps.push([x, -(main.half + 0.6), 0, 1], [x + 14, main.half + 0.6, 0, -1]);
  }
  for (const cx of cross.xs) {
    for (let z = -size.z + 16; z < size.z; z += 32) {
      if (Math.abs(z) < mainEdge + 4 || back.zs.some((c) => Math.abs(z - c) < backEdge + 3)) continue;
      lamps.push([cx - cross.half - 0.5, z, 1, 0]);
    }
  }
  for (const bz of back.zs) {
    for (let x = -size.x + 20; x < size.x; x += 36) {
      if (cross.xs.some((c) => Math.abs(x - c) < cross.half + 5)) continue;
      lamps.push([x, bz - back.half - 0.4, 0, 1]);
    }
  }

  // Suspended monorail down the median, with a station between the two middle cross streets.
  // Piers every 30 m, kept clear of the junctions.
  const piers: number[] = [];
  for (let x = -size.x - 15; x <= size.x + 16; x += 30) if (!cross.xs.some((c) => Math.abs(x - c) < cross.half + 2)) piers.push(x);
  const beamY = 11.7, floorY = beamY - 0.75 - 2.9;
  const car = { length: 14.5, gap: 0.5, count: 3, width: 2.6, height: 2.9, doors: [-3.6, 3.6], doorWidth: 1.3 };
  const doorXs: number[] = [];
  for (let c = 0; c < car.count; c++) for (const d of car.doors) doorXs.push((c - (car.count - 1) / 2) * (car.length + car.gap) + d);
  const monorail = {
    x0: -size.x - 20, x1: size.x + 20, piers, trackZ: 2.6, beamY, floorY, roofY: 14.3, station: [-34, 34] as [number, number], platform: [4.05, 7.8] as [number, number],
    car, doorXs, girder: { width: 1.5, height: 1.7, ribEvery: 7.5 },
  };
  const stair = { riser: 0.18, tread: 0.3, landing: 1.6, maxRise: 4 };
  const deck = { x0: -38, x1: 38, z0: main.half + 0.3, z1: mainEdge - 0.2, y: 5.6 };

  const bridges: Plan['bridges'] = [];
  for (const cx of cross.xs) {
    for (const side of [-1, 1]) {
      if (rng() < 0.4) continue;
      const z = side * (30 + rng() * 45);
      bridges.push({ x0: cx - cross.half - cross.sidewalk - 0.2, x1: cx + cross.half + cross.sidewalk + 0.2, z, y: 13.6 + Math.floor(rng() * 4) * FLOOR });
    }
  }

  const lanes: Lane[] = [];
  const L = 2 * size.x + 40;
  for (const [z, d] of [[-6.6, 1], [-3.4, 1], [3.4, -1], [6.6, -1]] as const) {
    lanes.push({ x: -d * L / 2, z, dx: d, dz: 0, length: L, phase: 0, cars: 14, speed: 9 + rng() * 3 });
  }
  const Lz = 2 * size.z + 40;
  for (const cx of cross.xs) {
    for (const d of [-1, 1]) lanes.push({ x: cx - d * 2.3, z: -d * Lz / 2, dx: 0, dz: d, length: Lz, phase: 1, cars: 6, speed: 7 + rng() * 2 });
  }

  return { seed, size, main, cross, back, blocks, buildings, skyline, lamps, monorail, stair, deck, bridges, lanes, signal: { period: 44, green: 18, amber: 3 } };
}

export const FLOOR_HEIGHT = FLOOR;
