// The island the city stands on, the strait around it and the mainland shore beyond.
// Coast and far shore are polar radius tables around the origin (uniform angles), so the
// browser can rebuild terrain from the layout without re-running the generator.
// Browser-safe: no Node APIs.
import * as G from './geom.mjs';

export const SAMPLES = 360;

/** Signed distance to an axis-aligned rounded rectangle [x0, z0, x1, z1] with corner radius r. */
function roundRect(p, [x0, z0, x1, z1], r) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const qx = Math.abs(p[0] - cx) - ((x1 - x0) / 2 - r), qz = Math.abs(p[1] - cz) - ((z1 - z0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** Distance along the ray at angle `a` from the origin to the zero of `sdf` (origin inside). */
function rayHit(sdf, a, far = 4000) {
  const d = [Math.cos(a), Math.sin(a)];
  let lo = 0, hi = far;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sdf(G.mul(d, mid)) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Coast and far-shore radius tables for a city of size [W, D]. `cfg.margin` sets how far the
 * coast lies beyond each city edge (west, east, north = -z, south = +z), `corner` rounds it,
 * `wobble` adds [harmonic, meters] waves with seeded phases. `strait` is the water width to
 * the mainland per side; a side of 0 is open sea.
 */
export function islandShape(size, cfg, rng) {
  const [W, D] = size, m = cfg.margin;
  const rect = [-W / 2 - m.west, -D / 2 - m.north, W / 2 + m.east, D / 2 + m.south];
  const phases = cfg.wobble.map(() => rng() * Math.PI * 2);
  const mm = cfg.minMargin;
  const inner = [-W / 2 - mm, -D / 2 - mm, W / 2 + mm, D / 2 + mm];
  const coast = [], shore = [];
  // Open sea lies a long way out: past the fog, so the horizon is water.
  const side = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const wobble = cfg.wobble.reduce((s, [k, amp], j) => s + amp * Math.sin(k * a + phases[j]), 0);
    const floor = rayHit((p) => roundRect(p, inner, 40), a);
    const rc = Math.max(floor, rayHit((p) => roundRect(p, rect, cfg.corner), a) + wobble);
    coast.push(rc);
    // Strait width: each side's value, blended by direction so headlands and bays form.
    let ws = 0, sum = 0;
    for (const [k, ang] of Object.entries(side)) {
      const w = Math.max(0, Math.cos(a - ang)) ** 2;
      ws += w; sum += w * (cfg.strait[k] || cfg.openSea);
    }
    shore.push(rc + sum / ws + 120 * Math.sin(3 * a + phases[0]));
  }
  return { coast, shore, rect };
}

/** Linear lookup in a polar radius table at angle a. */
export function radiusAt(table, a) {
  const n = table.length;
  const f = ((a / (Math.PI * 2)) * n % n + n) % n;
  const i = Math.floor(f), t = f - i;
  return table[i] * (1 - t) + table[(i + 1) % n] * t;
}

/** Signed distance-like value to the coast: negative on the island (radial, not Euclidean). */
export function coastDistance(x, z, island) {
  return Math.hypot(x, z) - radiusAt(island.coast, Math.atan2(z, x));
}

/** Coast polygon (CCW in x, z) from the radius table. */
export function coastline(island) {
  return island.coast.map((r, i) => {
    const a = (i / island.coast.length) * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/**
 * Height of the seabed and mainland (the ground mesh; the island itself is a separate flat
 * mesh at 0). Under the strait and the island: below the water. Past the far shore: a low
 * coastal plain the metropolis lights sit on, then foothills.
 */
export function seabedHeight(x, z, island) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const u = r - radiusAt(island.shore, a);
  const t = island.terrain;
  const shore = island.water - 6 + (t.plain + 6 - island.water) * smooth((u + 40) / 120);
  const hill = Math.min(1, Math.max(0, (u - t.start) / t.rise));
  const ridge = 0.55 + 0.25 * Math.sin(x / 470 + Math.sin(z / 630)) + 0.2 * Math.sin(z / 310 + x / 710);
  return shore + t.height * hill * hill * (3 - 2 * hill) * ridge;
}

/** Walkable ground height: the island is flat at 0, everything else follows the seabed. */
export function landHeight(x, z, island) {
  return coastDistance(x, z, island) <= 0 ? 0 : seabedHeight(x, z, island);
}

function smooth(u) {
  const v = Math.min(1, Math.max(0, u));
  return v * v * (3 - 2 * v);
}
