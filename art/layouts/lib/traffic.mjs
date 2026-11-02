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
      for (const [from, to] of [[u, v], [v, u]]) edges.push({ from, to, road: r.id, cls: r.cls, width: r.width, offset: r.width * 0.22 });
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

/**
 * Lane polyline of a loop of edges: offset to the right, rounded corners, U-turn arcs. Also
 * the stop lines before signalled junctions (3+ approaches): { idx, back, node, group }, the
 * point where the junction's curve starts and how far before it to stop, so a stopped car
 * waits clear of the crossing road. `group` is the signal phase: approaches along the
 * junction's first arriving edge (or opposite it) share phase 0, the rest phase 1.
 */
function loopPoints(nodes, edges, loop, fillet, arrivals) {
  const pts = [], stops = [];
  loop.forEach((i, k) => {
    const e = edges[i], f = edges[loop[(k + 1) % loop.length]];
    const n = nodes[e.to], ne = side(e.dir), nf = side(f.dir);
    const inc = arrivals[e.to];
    if (inc.length >= 3) {
      const cross = Math.max(...inc.filter((j) => j !== i).map((j) => edges[j].width)) / 2 + 1.5;
      const ref = edges[inc[0]].dir;
      stops.push({ idx: pts.length, cross, node: e.to, group: Math.abs(dot(e.dir, ref)) >= Math.SQRT1_2 ? 0 : 1 });
    }
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
    if (stops.length && stops.at(-1).idx === pts.length) stops.at(-1).back = Math.max(0, stops.at(-1).cross - cut);
    pts.push(...bend(sub(corner, mul(e.dir, cut)), corner, add(corner, mul(f.dir, cut)), 6));
    pts.push(add(corner, mul(f.dir, cut)));
  });
  // Straight-through junctions push their one midpoint: stop the crossing's half width before it.
  for (const st of stops) if (st.back === undefined) st.back = st.cross;
  return { pts, stops };
}

/**
 * Closed driving loops through the street network (roads at least 9 m wide, alleys excluded).
 * Each loop: { roads, points (closed lane polyline), length, stops, count, speed, phase }.
 * Browser-safe; used by the layout (art/layouts/city.mjs) and its tests.
 */
export function trafficLanes(roads, seed, density = 1, { turn = 0.6, fillet = 7 } = {}) {
  const rng = mulberry32(seed ^ 0x74726166);
  const { nodes, edges } = streetGraph(roads.filter((r) => r.width >= 9 && r.cls !== 'alley'));
  const next = junctionPairing(nodes, edges, rng, turn);
  const arrivals = nodes.map(() => []);
  edges.forEach((e, i) => arrivals[e.to].push(i));
  const seen = new Set(), loops = [];
  edges.forEach((_, start) => {
    if (seen.has(start)) return;
    const loop = [];
    for (let i = start; !seen.has(i); i = next[i]) { seen.add(i); loop.push(i); }
    loops.push(loop);
  });
  return loops.map((loop) => {
    const { pts: points, stops: marks } = loopPoints(nodes, edges, loop, fillet, arrivals);
    const arc = [0];
    for (let k = 1; k <= points.length; k++) arc.push(arc[k - 1] + len(sub(points[k % points.length], points[k - 1])));
    const length = arc[points.length];
    // [arc position of the stop line, junction (node) id, signal phase group], by position.
    const stops = marks.map((m) => [((arc[m.idx] - m.back) % length + length) % length, m.node, m.group]).sort((a, b) => a[0] - b[0]);
    const headway = loop.reduce((s, i) => s + edges[i].length * (HEADWAY[edges[i].cls] ?? 40), 0)
      / loop.reduce((s, i) => s + edges[i].length, 0);
    return {
      roads: [...new Set(loop.map((i) => edges[i].road))],
      points, length, stops,
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

/** Position and heading at arc position `s` along a loop (any real s; wraps). */
export function trafficPose(lane, s) {
  const [x, z] = pointAt(lane, s);
  // Heading from a short chord, so corners and U-turns turn the car smoothly.
  const a = pointAt(lane, s - 1.5), b = pointAt(lane, s + 1.5);
  return { x, z, angle: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}

/** Signal cycle (seconds): phase 0 green, amber, phase 1 green, amber. */
export const SIGNAL = { period: 36, green: 15, amber: 3 };

/** Signal for junction `node`, phase `group`, at `time`: 'green' | 'amber' | 'red'. */
export function signalAt(node, group, time) {
  const { period, green, amber } = SIGNAL;
  const offset = (Math.abs(Math.sin(node * 12.9898 + 4.1) * 43758.5453) % 1) * period;
  const t = (((time + offset) % period) + period) % period - group * (green + amber);
  return t >= 0 && t < green ? 'green' : t >= green && t < green + amber ? 'amber' : 'red';
}

const CAR = 4.8;                         // bumper to bumper (m)
const IDM = { a: 1.4, b: 2.6, s0: 2.2, T: 1.1 };
const DT = 1 / 30;
/** Simulation warm-up: every state starts this long before the time it is asked for. */
const WARM = 120;

/**
 * Cars on their loops, following the car ahead (intelligent driver model) and stopping for
 * red and amber lights. Deterministic: the state at time t comes from starting evenly spaced
 * at t - WARM and stepping a fixed 1/30 s, so a frozen time always renders the same; a
 * running clock just keeps stepping. `at(time)` advances (or restarts, if time went back or
 * jumped far) and interpolates between steps.
 */
export function createTrafficSim(lanes) {
  const cars = lanes.map((lane) => ({
    lane, n: lane.count,
    s: new Float64Array(lane.count), prev: new Float64Array(lane.count),
    v: new Float32Array(lane.count), acc: new Float32Array(lane.count),
  }));
  let now = -Infinity;
  const reset = (t0) => {
    for (const c of cars) {
      for (let i = 0; i < c.n; i++) {
        c.s[i] = c.prev[i] = (c.lane.phase + i / c.n) * c.lane.length;
        c.v[i] = c.lane.speed; c.acc[i] = 0;
      }
    }
    now = t0;
  };
  const idm = (v, v0, gap, dv) => {
    const star = IDM.s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
    return IDM.a * (1 - (v / v0) ** 4 - (star / Math.max(gap, 0.1)) ** 2);
  };
  const step = (t) => {
    for (const c of cars) {
      const { lane, n, s, v, acc } = c, L = lane.length, stops = lane.stops ?? [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lead = n > 1 ? s[j] + (j === 0 ? L : 0) : s[i] + L;
        let a = idm(v[i], lane.speed, lead - s[i] - CAR, v[i] - (n > 1 ? v[j] : 0));
        if (stops.length) {
          // Next stop line ahead of the front bumper.
          const p = (((s[i] + CAR / 2) % L) + L) % L;
          let lo = 0, hi = stops.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (stops[m][0] <= p + 0.3) lo = m + 1; else hi = m; }
          const st = stops[lo % stops.length];
          const d = ((st[0] - p) % L + L) % L;
          if (d < 70) {
            const light = signalAt(st[1], st[2], t);
            // Amber: stop only if there is room to stop comfortably.
            if (light === 'red' || (light === 'amber' && d > (v[i] * v[i]) / (2 * IDM.b) + 1)) a = Math.min(a, idm(v[i], lane.speed, d, v[i]));
          }
        }
        acc[i] = Math.max(a, -8);
      }
      for (let i = 0; i < n; i++) {
        c.prev[i] = s[i];
        v[i] = Math.max(0, v[i] + acc[i] * DT);
        s[i] += v[i] * DT;
      }
    }
  };
  return {
    lanes: cars,
    /** Advance to `time`; returns the interpolation weight of the latest step. */
    at(time) {
      if (time < now - DT || time - now > 300) reset(time - WARM);
      while (now < time) { step(now); now += DT; }
      return 1 - (now - time) / DT;
    },
    /** Pose of car i on lane k (after `at`), and whether it is braking. */
    pose(k, i, w) {
      const c = cars[k];
      const s = c.prev[i] + (c.s[i] - c.prev[i]) * w;
      return { ...trafficPose(c.lane, s), brake: c.acc[i] < -0.6 || c.v[i] < 0.3 };
    },
  };
}
