import { mulberry32 } from './rng.mjs';

/** Meters between cars in one lane, by road class (divided by density). */
const HEADWAY = { arterial: 24, hero: 30, secondary: 34 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / len(a));
/** Right-hand side of travel direction t; lanes sit this side of the centerline. */
const side = (t) => [-t[1], t[0]];

/**
 * The street network as a graph. Streets end at the curb of the road they meet, so each end
 * within half a road width of another road's line is extended to that line and splits it
 * there; crossings split both roads. Returns nodes and directed edges (both ways per piece).
 */
function streetGraph(roads) {
  const cuts = roads.map(() => [0, 1]);
  const ends = roads.map((r) => [r.a, r.b]);
  roads.forEach((r, i) => {
    const d = sub(r.b, r.a), l2 = dot(d, d);
    roads.forEach((o, j) => {
      if (i === j) return;
      [o.a, o.b].forEach((p, k) => {
        const t = dot(sub(p, r.a), d) / l2, q = add(r.a, mul(d, t));
        if (t > 0.001 && t < 0.999 && len(sub(p, q)) < r.width / 2 + 1.5) { cuts[i].push(t); ends[j][k] = q; }
      });
      const e = sub(o.b, o.a), den = cross(d, e);
      if (Math.abs(den) < 1e-9) return;
      const w = sub(o.a, r.a), t = cross(w, e) / den, u = cross(w, d) / den;
      if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) cuts[i].push(t);
    });
  });
  const nodes = [];
  const nodeAt = (p) => {
    let n = nodes.findIndex((q) => len(sub(q, p)) < 2);
    if (n < 0) n = nodes.push(p) - 1;
    return n;
  };
  const edges = [];
  roads.forEach((r, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e5) / 1e5))].sort((a, b) => a - b);
    const at = (t) => (t === 0 ? ends[i][0] : t === 1 ? ends[i][1] : add(r.a, mul(sub(r.b, r.a), t)));
    for (let k = 0; k < ts.length - 1; k++) {
      const u = nodeAt(at(ts[k])), v = nodeAt(at(ts[k + 1]));
      if (u === v) continue;
      for (const [from, to] of [[u, v], [v, u]]) edges.push({ from, to, road: r.id, cls: r.cls, offset: r.width * 0.22 });
    }
  });
  for (const e of edges) {
    const d = sub(nodes[e.to], nodes[e.from]);
    e.length = len(d);
    e.dir = norm(d);
  }
  return { nodes, edges };
}

/** All permutations of [0..n), for the small junction degrees of a street grid. */
function permutations(n) {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/**
 * At each junction, a one-to-one pairing of arriving and leaving edges (no U-turns except at
 * dead ends), favoring straight through with `turn` randomness. Pairings at every junction
 * make the successor map a permutation of the edges, so they decompose into closed loops that
 * use every lane exactly once: no car ever has to vanish, and no two loops share a lane.
 */
function junctionPairing(nodes, edges, rng, turn) {
  const next = new Array(edges.length).fill(-1);
  nodes.forEach((_, n) => {
    const inc = [], out = [];
    edges.forEach((e, i) => { if (e.to === n) inc.push(i); if (e.from === n) out.push(i); });
    if (inc.length === 1) { next[inc[0]] = out[0]; return; }   // dead end: turn around
    const noise = inc.map(() => out.map(() => rng() * turn));
    let best = null, bestScore = -Infinity;
    for (const perm of permutations(Math.min(out.length, 6))) {
      let score = 0;
      for (let a = 0; a < perm.length && score > -Infinity; a++) {
        const e = edges[inc[a]], f = edges[out[perm[a]]];
        score = f.to === e.from ? -Infinity : score + dot(e.dir, f.dir) + noise[a][perm[a]];
      }
      if (score > bestScore) { bestScore = score; best = perm; }
    }
    best.forEach((o, a) => { next[inc[a]] = out[o]; });
  });
  return next;
}

/** Points of a quadratic Bezier p0 → p2 bending toward c (excluding p2). */
function bend(p0, c, p2, steps) {
  const out = [];
  for (let k = 0; k < steps; k++) {
    const t = k / steps, s = 1 - t;
    out.push(add(add(mul(p0, s * s), mul(c, 2 * s * t)), mul(p2, t * t)));
  }
  return out;
}

/** Lane polyline of a loop of edges: offset to the right, rounded corners, U-turn arcs. */
function loopPoints(nodes, edges, loop, fillet) {
  const pts = [];
  loop.forEach((i, k) => {
    const e = edges[i], f = edges[loop[(k + 1) % loop.length]];
    const n = nodes[e.to], ne = side(e.dir), nf = side(f.dir);
    if (dot(e.dir, f.dir) < -0.99) {
      // Dead end: a half circle around the end of the road.
      for (let s = 0; s < 9; s++) {
        const a = (Math.PI * s) / 8;
        pts.push(add(n, add(mul(ne, e.offset * Math.cos(a)), mul(e.dir, e.offset * Math.sin(a)))));
      }
      return;
    }
    const p = add(n, mul(ne, e.offset)), q = add(n, mul(nf, f.offset));
    const den = cross(e.dir, f.dir);
    if (Math.abs(den) < 0.05) { pts.push(mul(add(p, q), 0.5)); return; }
    const corner = add(p, mul(e.dir, cross(sub(q, p), f.dir) / den));
    const cut = Math.min(fillet, 0.4 * e.length, 0.4 * f.length);
    pts.push(...bend(sub(corner, mul(e.dir, cut)), corner, add(corner, mul(f.dir, cut)), 6));
    pts.push(add(corner, mul(f.dir, cut)));
  });
  return pts;
}

/**
 * Closed driving loops through the street network (roads at least 9 m wide, alleys excluded).
 * Each loop: { roads, points (closed lane polyline), length, count, speed, phase }.
 * Browser-safe; used by the layout (art/layouts/city.mjs) and its tests.
 */
export function trafficLanes(roads, seed, density = 1, { turn = 0.6, fillet = 7 } = {}) {
  const rng = mulberry32(seed ^ 0x74726166);
  const { nodes, edges } = streetGraph(roads.filter((r) => r.width >= 9 && r.cls !== 'alley'));
  const next = junctionPairing(nodes, edges, rng, turn);
  const seen = new Set(), loops = [];
  edges.forEach((_, start) => {
    if (seen.has(start)) return;
    const loop = [];
    for (let i = start; !seen.has(i); i = next[i]) { seen.add(i); loop.push(i); }
    loops.push(loop);
  });
  return loops.map((loop) => {
    const points = loopPoints(nodes, edges, loop, fillet);
    const length = points.reduce((s, p, k) => s + len(sub(points[(k + 1) % points.length], p)), 0);
    const headway = loop.reduce((s, i) => s + edges[i].length * (HEADWAY[edges[i].cls] ?? 40), 0)
      / loop.reduce((s, i) => s + edges[i].length, 0);
    return {
      roads: [...new Set(loop.map((i) => edges[i].road))],
      points, length,
      count: Math.max(1, Math.floor(length / (headway / density))),
      speed: 5 + rng() * 4, phase: rng(),
    };
  });
}

/** Cumulative arc length per point of a closed polyline (cached on the lane). */
function arcLengths(lane) {
  if (!lane._arc) {
    const p = lane.points, arc = [0];
    for (let k = 1; k <= p.length; k++) arc.push(arc[k - 1] + len(sub(p[k % p.length], p[k - 1])));
    Object.defineProperty(lane, '_arc', { value: arc, enumerable: false });
  }
  return lane._arc;
}

function pointAt(lane, s) {
  const arc = arcLengths(lane), p = lane.points, total = arc[arc.length - 1];
  s = ((s % total) + total) % total;
  let lo = 0, hi = arc.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid] <= s) lo = mid; else hi = mid; }
  const a = p[lo], b = p[(lo + 1) % p.length], t = (s - arc[lo]) / Math.max(arc[lo + 1] - arc[lo], 1e-9);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Position and heading of car `index` on its loop at `time`; a pure function of time. */
export function trafficPosition(lane, index, time) {
  const total = arcLengths(lane).at(-1);
  const s = (lane.phase + index / lane.count) * total + time * lane.speed;
  const [x, z] = pointAt(lane, s);
  // Heading from a short chord, so corners and U-turns turn the car smoothly.
  const a = pointAt(lane, s - 1.5), b = pointAt(lane, s + 1.5);
  return { x, z, angle: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}
