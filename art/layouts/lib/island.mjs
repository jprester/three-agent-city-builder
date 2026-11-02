// The island the city stands on, the strait around it and the mainland shore beyond.
// Coast and far shore are polar radius tables around the origin (uniform angles), so the
// browser can rebuild terrain from the layout without re-running the generator.
// Browser-safe: no Node APIs.
import * as G from './geom.mjs';
import { sampleFlythrough } from './paths.mjs';
import { weightedChoice } from './rng.mjs';
import { r3 } from './util.mjs';

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

/**
 * The island around the city: coast and far shore (lib/island.mjs), then the band between the
 * city edge and the waterfront, laid out as real streets so buildings and asphalt agree:
 * a ring road hugging the city, avenues continuing the city's streets out to the promenade,
 * filler streets so no block is longer than `pitch[1]`, and blocks (raised sidewalks) clipped
 * to the coast with buildings facing their streets (fringe defs, taller near the city). The
 * ring and avenues are drivable roads; lamps line them and the waterfront promenade.
 * Returns { island, roads, blocks, instances, lamps }.
 */
export function buildIsland(cfg, fcfg, W, Dp, roads, cityBlocks, assets, fly, keepClear, lampSpacing, rng) {
  const shape = islandShape([W, Dp], cfg, rng);
  const island = { coast: shape.coast, shore: shape.shore, water: cfg.water, promenade: cfg.promenade, terrain: cfg.terrain };
  const sdf = (p) => coastDistance(p[0], p[1], island);
  const grad = (p) => G.norm([sdf([p[0] + 1, p[1]]) - sdf([p[0] - 1, p[1]]), sdf([p[0], p[1] + 1]) - sdf([p[0], p[1] - 1])]);
  const coast = coastline(island);
  const xsAll = coast.map((p) => p[0]), zsAll = coast.map((p) => p[1]);
  const bounds = [Math.min(...xsAll), Math.min(...zsAll), Math.max(...xsAll), Math.max(...zsAll)];
  const inset = cfg.promenade + 1;
  const rectDist = (p) => Math.hypot(Math.max(Math.abs(p[0]) - W / 2, 0), Math.max(Math.abs(p[1]) - Dp / 2, 0));

  // ---- street lines: the ring, continuations of city streets ending on the edge, fillers.
  const e = cfg.ring / 2 + 0.5, rx = W / 2 + e, rz = Dp / 2 + e;
  const xs = [{ v: -rx, w: cfg.ring, kind: 'ring' }, { v: rx, w: cfg.ring, kind: 'ring' }];
  const zs = [{ v: -rz, w: cfg.ring, kind: 'ring' }, { v: rz, w: cfg.ring, kind: 'ring' }];
  for (const r of roads) {
    if (r.cls === 'alley') continue;
    for (const p of [r.a, r.b]) {
      if (Math.abs(Math.abs(p[1]) - Dp / 2) < 1) xs.push({ v: p[0], w: cfg.avenue, kind: 'avenue', side: Math.sign(p[1]) });
      if (Math.abs(Math.abs(p[0]) - W / 2) < 1) zs.push({ v: p[1], w: cfg.avenue, kind: 'avenue', side: Math.sign(p[0]) });
    }
  }
  const settle = (lines, lo, hi) => {
    const rank = { ring: 0, avenue: 1 };
    const kept = [];
    for (const l of [...lines].sort((a, b) => rank[a.kind] - rank[b.kind])) {
      if (!kept.some((k) => Math.abs(k.v - l.v) < 40)) kept.push(l);
    }
    kept.sort((a, b) => a.v - b.v);
    const out = [];
    const stops = [{ v: lo, w: 0, kind: 'bound' }, ...kept, { v: hi, w: 0, kind: 'bound' }];
    for (let i = 0; i < stops.length - 1; i++) {
      if (i > 0) out.push(stops[i]);
      const gap = stops[i + 1].v - stops[i].v;
      const n = gap > cfg.pitch[1] ? Math.round(gap / ((cfg.pitch[0] + cfg.pitch[1]) / 2)) : 1;
      for (let k = 1; k < n; k++) out.push({ v: stops[i].v + (gap * k) / n, w: cfg.street, kind: 'street' });
    }
    return [{ v: lo, w: 0, kind: 'bound' }, ...out, { v: hi, w: 0, kind: 'bound' }];
  };
  const gx = settle(xs, bounds[0] - 1, bounds[2] + 1), gz = settle(zs, bounds[1] - 1, bounds[3] + 1);

  // ---- drivable roads: the ring (four sides) and each avenue out to the promenade.
  const out = { roads: [], blocks: [], instances: [], lamps: [] };
  let id = roads.length;
  const corners = [[-rx, -rz], [rx, -rz], [rx, rz], [-rx, rz]];
  for (let i = 0; i < 4; i++) out.roads.push({ id: id++, cls: 'secondary', width: cfg.ring, a: corners[i], b: corners[(i + 1) % 4] });
  const reach = (from, dir) => {
    // Bisect along dir for the promenade's inner edge.
    let lo = 0, hi = 2000;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (sdf(G.add(from, G.mul(dir, m))) < -inset) lo = m; else hi = m; }
    return G.add(from, G.mul(dir, lo));
  };
  for (const l of gx.filter((l) => l.kind === 'avenue')) {
    const a = [l.v, l.side * rz];
    out.roads.push({ id: id++, cls: 'secondary', width: cfg.avenue, a, b: reach(a, [0, l.side]) });
  }
  for (const l of gz.filter((l) => l.kind === 'avenue')) {
    const a = [l.side * rx, l.v];
    out.roads.push({ id: id++, cls: 'secondary', width: cfg.avenue, a, b: reach(a, [l.side, 0]) });
  }
  for (const r of out.roads) { r.a = r.a.map(r3); r.b = r.b.map(r3); }

  // ---- blocks: grid cells between the lines, outside the ring, clipped to the promenade.
  const flyPts = sampleFlythrough(fly);
  const placed = [];
  for (let i = 0; i < gx.length - 1; i++) {
    for (let j = 0; j < gz.length - 1; j++) {
      const x0 = gx[i].v + gx[i].w / 2, x1 = gx[i + 1].v - gx[i + 1].w / 2;
      const z0 = gz[j].v + gz[j].w / 2, z1 = gz[j + 1].v - gz[j + 1].w / 2;
      const c = [(x0 + x1) / 2, (z0 + z1) / 2];
      if (Math.abs(c[0]) < rx && Math.abs(c[1]) < rz) continue;   // the city and its ring
      if (x1 - x0 < 15 || z1 - z0 < 15) continue;
      let poly = { pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], tags: ['band', 'band', 'band', 'band'] };
      // Clip by the promenade line at the corner reaching furthest out, until all are inside.
      for (let k = 0; k < 4 && poly.pts.length >= 3; k++) {
        const worst = poly.pts.reduce((a, b) => (sdf(b) > sdf(a) ? b : a));
        if (sdf(worst) <= -inset + 0.5) break;
        const n = grad(worst);
        poly = G.clip(poly, G.sub(worst, G.mul(n, sdf(worst) + inset)), G.mul(n, -1), 0, 'coast');
      }
      if (poly.pts.length < 3 || G.area(poly.pts) < 400 || G.axes(poly.pts).min < 14) continue;
      const block = { pts: poly.pts, tags: poly.tags, district: 'island' };
      out.blocks.push(block);

      // Lots about `lot` meters wide, each building facing the street of an edge its lot
      // touches; lots touching none are courtyards.
      const t = Math.min(1, rectDist(c) / Math.max(1, rectDist(c) - sdf(c)));
      const nx = Math.max(1, Math.round((x1 - x0) / fcfg.lot)), nz = Math.max(1, Math.round((z1 - z0) / fcfg.lot));
      const lw = (x1 - x0) / nx, ld = (z1 - z0) / nz;
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          // Fixed number of draws per lot, so skipping one never shifts the next.
          const gapR = rng(), nearR = rng(), sxr = rng(), szr = rng(), syr = rng(), sideR = rng();
          const asset = weightedChoice(rng, nearR > t ? fcfg.near : fcfg.far);
          const seed = Math.floor(rng() * 2 ** 31);
          if (gapR < fcfg.lotGap) continue;   // yards, car parks
          const meta = assets[asset]?.meta;
          if (!meta) continue;
          const lc = [x0 + lw * (a + 0.5), z0 + ld * (b + 0.5)];
          const faces = [a === 0 && [1, 0], a === nx - 1 && [-1, 0], b === 0 && [0, 1], b === nz - 1 && [0, -1]].filter(Boolean);
          if (!faces.length) continue;
          const nIn = faces[Math.floor(sideR * faces.length)];
          const xSide = nIn[0] !== 0;
          const along = xSide ? ld : lw, deep = xSide ? lw : ld;
          const [fw, fd] = meta.footprint;
          const clampS = (v) => Math.min(2.6, Math.max(0.55, v));
          let sx = clampS(((along - 2 * fcfg.setback) / fw) * (0.88 + 0.12 * sxr));
          let sz = clampS(((deep - 2 * fcfg.setback) / fd) * (0.8 + 0.2 * szr));
          const sy = (0.85 + 0.35 * syr) * (cfg.height[0] + (cfg.height[1] - cfg.height[0]) * t);
          const rotationY = Math.atan2(-nIn[0], -nIn[1]);
          const axis = [Math.cos(rotationY), -Math.sin(rotationY)];
          // Shrink to fit where the coast clipped the block; give up if it still does not.
          let fp = null;
          for (let tries = 0; tries < 3; tries++, sx *= 0.8, sz *= 0.8) {
            const f = [(fw * sx) / 2, (fd * sz) / 2];
            if (G.obb(lc, axis, f[0] + fcfg.setback, f[1] + fcfg.setback).corners.every((p) => G.insideConvex(block.pts, p))) { fp = f; break; }
          }
          if (!fp || sx < 0.55 * 0.8 ** 2) continue;
          const h = meta.height * sy;
          if (keepClear.some((p) => G.dist(p, lc) < fcfg.anchorClear)) continue;
          // Neighbors on the same block stand 2 × setback apart; pad less than that.
          const footprint = G.obb(lc, axis, fp[0] + 0.5, fp[1] + 0.5);
          if (placed.some((o) => G.dist(o.c, lc) < 150 && G.obbOverlap(o, footprint, 0))) continue;
          const grown = G.obb(lc, axis, fp[0] + fcfg.flyClear, fp[1] + fcfg.flyClear).corners;
          const far = Math.hypot(fp[0] + fcfg.flyClear, fp[1] + fcfg.flyClear);
          if (flyPts.some((p) => p[1] < h + fcfg.flyClear && Math.abs(p[0] - lc[0]) < far && Math.abs(p[2] - lc[1]) < far && G.insideConvex(grown, [p[0], p[2]]))) continue;
          placed.push(footprint);
          // What the front faces: the ring, an avenue, a quiet street, or the waterfront.
          const line = nIn[0] === 1 ? gx[i] : nIn[0] === -1 ? gx[i + 1] : nIn[1] === 1 ? gz[j] : gz[j + 1];
          const frontPt = G.sub(lc, G.mul(nIn, (xSide ? lw : ld) / 2 + 2));
          const frontage = sdf(frontPt) > -inset - 1 || line.kind === 'bound' ? 'coast' : line.kind;
          out.instances.push({
            asset, position: [r3(lc[0]), 0, r3(lc[1])], rotationY: r3(rotationY),
            scale: [sx, sy, sz].map(r3), seed, district: 'fringe', h: r3(h), fp: fp.map(r3), frontage,
          });
        }
      }
    }
  }

  // ---- lamps along the ring and avenues (where there is pavement), and the waterfront.
  const paved = (p) => [...cityBlocks, ...out.blocks].some((b) => G.insideConvex(b.pts, p));
  for (const road of out.roads) {
    const L = G.dist(road.a, road.b), d = G.norm(G.sub(road.b, road.a)), n = G.perp(d);
    for (let s = 12; s < L - 12; s += lampSpacing.secondary) {
      for (const side of [-1, 1]) {
        const p = G.add(G.add(road.a, G.mul(d, s)), G.mul(n, side * (road.width / 2 + 0.6)));
        if (paved(p)) out.lamps.push([r3(p[0]), r3(p[1]), r3(Math.atan2(-side * n[0], -side * n[1])), road.id]);
      }
    }
  }
  // Quiet streets: block edges facing a street (not the coast), sparser, one side.
  for (const b of out.blocks) {
    const c = G.centroid(b.pts);
    b.pts.forEach((p, k) => {
      if (b.tags[k] === 'coast') return;
      const q = b.pts[(k + 1) % b.pts.length], L = G.dist(p, q);
      const d = G.norm(G.sub(q, p));
      let n = G.perp(d);
      if (G.dot(n, G.sub(G.lerp(p, q, 0.5), c)) < 0) n = G.mul(n, -1);   // outward, toward the street
      for (let s = cfg.quietLamps / 2; s < L - 4; s += cfg.quietLamps) {
        const at = G.sub(G.add(p, G.mul(d, s)), G.mul(n, 0.6));
        if (sdf(at) > -inset - 1) continue;
        if (out.lamps.some(([x, z]) => Math.abs(x - at[0]) < 14 && Math.abs(z - at[1]) < 14)) continue;
        out.lamps.push([r3(at[0]), r3(at[1]), r3(Math.atan2(n[0], n[1])), -1]);
      }
    });
  }
  let run = 0;
  for (let i = 0; i < coast.length; i++) {
    const p = coast[i], q = coast[(i + 1) % coast.length];
    run += G.dist(p, q);
    if (run < cfg.lampEvery) continue;
    run = 0;
    const n = grad(p), at = G.sub(p, G.mul(n, sdf(p) + 1.2));
    out.lamps.push([r3(at[0]), r3(at[1]), r3(Math.atan2(-n[0], -n[1])), -1]);
  }

  island.coast = island.coast.map(r3);
  island.shore = island.shore.map(r3);
  island.bounds = bounds.map(r3);
  return { island, ...out };
}
