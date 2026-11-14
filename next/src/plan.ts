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
  /** 0 tiled housing, 1 concrete office, 2 painted housing, 3 glass block, 4 tower with a photographic facade. */
  style: number;
  /**
   * The massing, bottom up: each tier is the footprint inset by `inset` metres, rising to `top`.
   * One tier is a plain box; towers stand on a podium, step back, and end in a crown.
   */
  tiers: { inset: number; top: number }[];
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

/** Podium, shaft, setbacks and a crown for a building of height h on a w x d lot. */
function massing(rng: () => number, w: number, d: number, h: number, style: number): Building['tiers'] {
  const room = Math.min(w, d) / 2 - 5;             // how far a tier may step in and keep a usable floor
  const snap = (y: number) => Math.round(y / FLOOR) * FLOOR + 1.1;
  if (style === 4 && room > 1) {
    const tiers: Building['tiers'] = [];
    let inset = 0;
    if (rng() < 0.7) { tiers.push({ inset: 0, top: snap(9 + rng() * 9) }); inset = Math.min(room * 0.6, 1.5 + rng() * 3); }
    const steps = rng() < 0.55 ? 2 : 1;
    for (let k = 0; k < steps; k++) {
      const top = k === steps - 1 ? h : snap(h * (0.55 + rng() * 0.25));
      tiers.push({ inset, top });
      inset = Math.min(room, inset + 1.5 + rng() * 3);
    }
    // A crown: a narrower plant storey or two on top.
    if (rng() < 0.6) tiers.push({ inset: Math.min(room, inset + 1), top: h + 3 + rng() * 6 });
    return tiers;
  }
  if (h > 30 && room > 0 && rng() < 0.3) {
    // Housing with its top floors stepped back.
    return [{ inset: 0, top: snap(h - FLOOR * (1 + Math.floor(rng() * 3))) }, { inset: Math.min(room, 1.2 + rng()), top: h }];
  }
  return [{ inset: 0, top: h }];
}

export function createPlan(seed = 7): Plan {
  const rng = mulberry32(seed);
  // The same footprint as the main app's city (1000 x 800 m): a grid of cross streets every
  // 100 m and three back streets either side of the main street.
  const size = { x: 500, z: 400 };
  const main = { half: 9, sidewalk: 4 };
  const cross = { xs: [-450, -350, -250, -150, -50, 50, 150, 250, 350, 450], half: 5, sidewalk: 3 };
  const back = { zs: [-300, -195, -95, 95, 195, 300], half: 4, sidewalk: 2.5 };

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
  const zCuts = [...back.zs.map((z) => [z, backEdge]), [0, mainEdge]].sort((a, b) => a[0] - b[0]);
  const zRanges: [number, number][] = [];
  let zAt = -size.z;
  for (const [c, e] of zCuts) { zRanges.push([zAt, c - e]); zAt = c + e; }
  zRanges.push([zAt, size.z]);
  const blocks: Plan['blocks'] = [];
  for (const [x0, x1] of xRanges) for (const [z0, z1] of zRanges) blocks.push([x0, x1, z0, z1]);

  // Lots: each block is two rows of frontages, one on each of its long streets.
  const buildings: Building[] = [];
  const GAP = 0.5;
  for (const [x0, x1, z0, z1] of blocks) {
    const mid = (z0 + z1) / 2 + (rng() - 0.5) * 6;
    for (const [r0, r1] of [[z0, mid], [mid, z1]] as const) {
      const onMain = Math.abs(r0) === mainEdge || Math.abs(r1) === mainEdge;
      let x = x0;
      while (x < x1 - 1) {
        let w = 14 + rng() * 12;
        if (x1 - (x + w) < 12) w = x1 - x;
        const roll = rng();
        let h: number, style: number;
        const cx = x + w / 2, cz = (r0 + r1) / 2;
        if (onMain) {
          // Old core on the main street: low and mixed, with the odd slim tower.
          h = roll < 0.12 ? 60 + rng() * 45 : 16 + rng() * 26;
          style = roll < 0.12 ? 4 : [0, 0, 2, 2, 1][Math.floor(rng() * 5)];
        } else if (cx > 240 && Math.abs(cz) < 260) {
          // The business district at the east end of the main street: towers with photographic facades.
          h = 70 + rng() * rng() * 190;
          style = rng() < 0.8 ? 4 : 1;
        } else {
          // Everywhere else, dense housing blocks of ten to twenty-five floors, higher away from the old core.
          const lift = Math.min(1, Math.abs(cz) / 200);
          h = 28 + lift * 14 + rng() * (32 + lift * 18);
          style = roll < 0.06 ? 4 : roll < 0.09 ? 3 : [0, 0, 2, 2, 2, 1][Math.floor(rng() * 6)];
          if (style === 4) h += 20 + rng() * 40;
        }
        const hs = Math.round(h / FLOOR) * FLOOR + 1.1;
        buildings.push({
          x0: x + GAP / 2, x1: x + w - GAP / 2, z0: r0 + GAP / 2, z1: r1 - GAP / 2,
          h: hs, tiers: massing(rng, w - GAP, Math.abs(r1 - r0) - GAP, hs, style),
          seed: Math.floor(rng() * 1e6), style,
          street: { xmin: x === x0, xmax: x + w >= x1 - 1e-6, zmin: r0 === z0, zmax: r1 === z1 },
          // Kit geometry (balconies, AC units, signs) close to the monorail; further out the facade draws them.
          near: onMain || (Math.abs(cx) < 170 && Math.abs(cz) < 110),
        });
        x += w;
      }
    }
  }

  // Far tier, out to the horizon: dense mid-rise housing right up to the city's edge, then towers.
  const skyline: Building[] = [];
  for (let i = 0; i < 1300; i++) {
    // Even density by area out to ~2 km, so lit windows run all the way to the hills.
    const a = rng() * Math.PI * 2, r = 330 + Math.sqrt(rng()) * 1700;
    const cx = Math.cos(a) * r * 1.3, cz = Math.sin(a) * r;
    if (Math.abs(cx) < size.x + 25 && Math.abs(cz) < size.z + 25) continue;
    const edge = Math.max(Math.abs(cx) - size.x, Math.abs(cz) - size.z);
    const w = 24 + rng() * 34, d = 24 + rng() * 34;
    const tower = edge > 260 && rng() < 0.45;
    const h = tower ? (90 + rng() * rng() * 300) * (1 - Math.min(r / 3000, 0.45)) : 30 + rng() * 55;
    const style = tower ? (rng() < 0.75 ? 4 : 1) : [0, 2, 2, 1][Math.floor(rng() * 4)];
    const hs = Math.round(h / FLOOR) * FLOOR;
    skyline.push({
      x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h: hs, tiers: massing(rng, w, d, hs, style),
      seed: Math.floor(rng() * 1e6), style,
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
    lanes.push({ x: -d * L / 2, z, dx: d, dz: 0, length: L, phase: 0, cars: 20, speed: 9 + rng() * 3 });
  }
  for (const bz of back.zs) {
    for (const d of [-1, 1]) lanes.push({ x: -d * L / 2, z: bz + d * 1.9, dx: d, dz: 0, length: L, phase: 0, cars: 5, speed: 7 + rng() * 2 });
  }
  const Lz = 2 * size.z + 40;
  for (const cx of cross.xs) {
    for (const d of [-1, 1]) lanes.push({ x: cx - d * 2.3, z: -d * Lz / 2, dx: 0, dz: d, length: Lz, phase: 1, cars: 5, speed: 7 + rng() * 2 });
  }

  return { seed, size, main, cross, back, blocks, buildings, skyline, lamps, monorail, stair, deck, bridges, lanes, signal: { period: 44, green: 18, amber: 3 } };
}

export const FLOOR_HEIGHT = FLOOR;

/** The top tier's footprint and height: where roofs carry their kit, crowns and signs. */
export function topTier(b: Building) {
  const t = b.tiers[b.tiers.length - 1];
  return { x0: b.x0 + t.inset, x1: b.x1 - t.inset, z0: b.z0 + t.inset, z1: b.z1 - t.inset, h: t.top };
}
