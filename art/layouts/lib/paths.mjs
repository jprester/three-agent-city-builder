// Camera and air paths of the city layout: the flythrough spline, flying-vehicle loops,
// and lifting paths clear of buildings. Browser-safe: no Node APIs.
import * as G from './geom.mjs';
import { r3 } from './util.mjs';

/** Oriented box of a layout instance's footprint. */
export function instanceBox(i) {
  const t = i.rotationY;
  return G.obb([i.position[0], i.position[2]], [Math.cos(t), -Math.sin(t)], i.fp[0], i.fp[1]);
}

/** Closed centripetal Catmull-Rom through P, about every 2 m: [{ p, k }] (k = segment start). */
export function sampleClosedCurve(P) {
  const n = P.length, out = [];
  const d4 = (a, b) => Math.pow((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, 0.25);
  for (let k = 0; k < n; k++) {
    const p0 = P[(k - 1 + n) % n], p1 = P[k], p2 = P[(k + 1) % n], p3 = P[(k + 2) % n];
    let dt0 = d4(p0, p1), dt1 = d4(p1, p2), dt2 = d4(p2, p3);
    if (dt1 < 1e-4) dt1 = 1;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const poly = [0, 1, 2].map((c) => {
      const x0 = p0[c], x1 = p1[c], x2 = p2[c], x3 = p3[c];
      const t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1;
      const t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1;
      return [x1, t1, -3 * x1 + 3 * x2 - 2 * t1 - t2, 2 * x1 - 2 * x2 + t1 + t2];
    });
    const steps = Math.max(8, Math.ceil(dt1 * dt1 / 2));   // dt1² is the chord length
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      out.push({ p: poly.map(([c0, c1, c2, c3]) => c0 + t * (c1 + t * (c2 + t * c3))), k });
    }
  }
  return out;
}

/**
 * Samples of the flythrough about every 2 m: centripetal Catmull-Rom through the control
 * points, the same curve three.js's CatmullRomCurve3 draws at runtime.
 */
export function sampleFlythrough(fly) {
  return fly ? sampleClosedCurve(fly.points).map((s) => s.p) : [];
}

/**
 * Lifts control points of a closed curve until the curve itself, not just its control
 * points, stays `lift` meters over every roof within `margin` meters of it. Between control
 * points a Catmull-Rom curve swings sideways (orbits, lanes bulging around towers), which a
 * check of the points or chords misses. Only heights change; the ground plan stays. A lifted
 * point raises its neighbors until no leg from it climbs steeper than `grade` (rise over run);
 * legs that were steep by design (the crane-up out of the canyon) are left alone.
 */
export function liftClear(points, instances, margin, lift, grade = 0.6, iterations = 16) {
  const boxes = instances.map((i) => ({ box: instanceBox(i), h: i.h }));
  const P = points.map((p) => [...p]);
  for (let it = 0; it < iterations; it++) {
    // Largest shortfall per control point over this pass, measured against the curve as it was
    // at the start of the pass. Adding each sample's shortfall in turn would stack the raises of
    // every blocked sample on the same segment and lift far above the needed clearance.
    const raise = new Map();
    for (const { p, k } of sampleClosedCurve(P)) {
      let need = 0;
      for (const { box, h } of boxes) {
        if (h + lift <= p[1] || h + lift <= need) continue;
        if (G.dist(box.c, [p[0], p[2]]) > Math.hypot(box.hu, box.hv) + margin) continue;
        if (G.insideConvex(G.obb(box.c, box.u, box.hu + margin, box.hv + margin).corners, [p[0], p[2]])) need = h + lift;
      }
      if (need <= p[1]) continue;
      // Both ends of the segment, by the shortfall (plus a little, to converge).
      const up = need - p[1] + 1;
      for (const j of [k, (k + 1) % P.length]) raise.set(j, Math.max(raise.get(j) ?? 0, up));
    }
    if (!raise.size) break;
    const lifted = [];
    for (const [j, up] of raise) { P[j][1] += up; lifted.push(j); }
    // Spread each lift into its neighbors (raising only), outward from the lifted points.
    const n = P.length;
    while (lifted.length) {
      const j = lifted.pop();
      for (const o of [-1, 1]) {
        const b = P[(j + o + n) % n];
        const min = P[j][1] - grade * Math.hypot(P[j][0] - b[0], P[j][2] - b[2]);
        if (b[1] < min - 0.01) { b[1] = min; lifted.push((j + o + n) % n); }
      }
    }
  }
  return P.map((p) => p.map(r3));
}

/**
 * Cinematic loop, in order: glides low through the hero canyon from its open west end, rises
 * past the signs, climbs out over the rooftops where the canyon meets the tower district,
 * circles the towers while climbing, pulls out wide west of the city, then glides down over
 * open ground back into the canyon mouth. Heights are lifted to 25 m over any roof
 * within 12 m of a leg. Returns { points, look, closed }: `look` is a look-at target per
 * control point, sampled with the same parameterization as the path.
 */
export function buildFlythrough(hero, roads, instances, P, W, Dp) {
  const C = P.flythrough;
  const boxes = instances.map((i) => ({ box: instanceBox(i), h: i.h }));
  /** Highest roof within r meters (sideways) of the straight leg a → b. */
  const clearance = (a, b, r = 12) => {
    let m = 0;
    const n = Math.max(2, Math.ceil(G.dist(a, b) / 8));
    for (const { box, h } of boxes) {
      if (h <= m || G.segDist(box.c, a, b) > Math.max(box.hu, box.hv) + r) continue;
      const grown = G.obb(box.c, box.u, box.hu + r, box.hv + r).corners;
      for (let k = 0; k <= n; k++) if (G.insideConvex(grown, G.lerp(a, b, k / n))) { m = h; break; }
    }
    return m;
  };
  const f = G.norm(G.sub(hero.b, hero.a));
  const L = G.dist(hero.a, hero.b);
  const at = (s) => G.add(hero.a, G.mul(f, s));
  const pts = [];
  const look = [];
  const key = (p, y, l, ly) => { pts.push([r3(p[0]), r3(y), r3(p[1])]); look.push([r3(l[0]), r3(ly), r3(l[1])]); };
  /** Next key at p, at least y high and 25 m over any roof along the leg from the previous key. */
  const keyClear = (p, y, l, ly) => {
    const prev = pts[pts.length - 1];
    const lift = prev ? clearance([prev[0], prev[2]], p) + 25 : 0;
    key(p, Math.max(y, lift), l, ly);
  };

  // Canyon: low under the signs (footbridges keep 2.5 m headroom), then rising past them.
  const s0 = C.street;
  key(at(10), s0, at(130), s0 + 8);
  key(at(L * 0.3), s0 + 0.5, at(L * 0.3 + 140), s0 + 12);
  key(at(L * 0.58), s0 + 3, at(L * 0.58 + 140), 24);
  key(at(L * 0.8), 18, at(L * 0.8 + 140), 55);
  key(at(L * 0.94), 42, at(L + 80), 120);

  // Climb out along the road crossing the canyon's end (inside its corridor any height is
  // safe), heading away from the towers, until the leg out to the orbit clears the roofs.
  const tc = P.towers.center;
  // Orbit radius: just outside the outermost tower (the district's shape varies per seed).
  const R = C.orbitGap + instances.reduce((m, i) => i.district === 'towers'
    ? Math.max(m, Math.hypot(i.position[0] - tc[0], i.position[2] - tc[1]) + Math.hypot(...i.fp)) : m, P.towers.radius);
  const onOrbit = (p) => { const r = G.sub(p, tc); return G.add(tc, G.mul(G.norm(r), R)); };
  const cross = roads
    .filter((r) => r.id !== hero.road && G.segDist(hero.b, r.a, r.b) < r.width / 2 + 6)
    .sort((a, b) => b.width - a.width)[0];
  let p = at(L * 0.94), y = 42;
  let dir = f;
  if (cross) {
    dir = G.norm(G.sub(cross.b, cross.a));
    if (G.dot(dir, G.sub(tc, hero.b)) > 0) dir = G.mul(dir, -1);
    // Nearest centerline point to the canyon's end, then along the road.
    const t0 = G.dot(G.sub(hero.b, cross.a), G.norm(G.sub(cross.b, cross.a)));
    const c0 = G.add(cross.a, G.mul(G.norm(G.sub(cross.b, cross.a)), t0));
    const inCity = (q) => Math.abs(q[0]) < W / 2 && Math.abs(q[1]) < Dp / 2;
    // Looking at the towers the whole way: a crane-up reveal rather than a turn.
    p = c0; y = 58;
    key(p, y, tc, y + 40);
    for (let k = 1; k <= 6; k++) {
      const q = G.add(c0, G.mul(dir, 38 * k));
      if (!inCity(q) || y >= clearance(q, onOrbit(q)) + 25) break;
      p = q; y += 24;
      key(p, y, tc, y + 30);
    }
  }

  // Orbit the tower district in the direction of travel, looking in at the towers, rising.
  const r0 = G.sub(p, tc);
  const spin = G.dot(dir, [-r0[1], r0[0]]) >= 0 ? 1 : -1;
  const a0 = Math.atan2(r0[1], r0[0]) + spin * 0.3;
  const steps = 6;
  const sweep = spin * C.orbitSweep * Math.PI * 2;
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (sweep * k) / steps;
    const q = [tc[0] + Math.cos(a) * R, tc[1] + Math.sin(a) * R];
    const h = Math.max(y + 20, C.orbitHeight[0] + (C.orbitHeight[1] - C.orbitHeight[0]) * (k / steps));
    // The last two keys turn the view from the towers out over the city, toward its far west
    // edge (a target between them passed right under the camera: a straight-down frame).
    const l = k < steps - 1 ? tc : [-W / 2 - (k === steps ? 200 : 0), tc[1] * (k === steps ? 0 : 1)];
    keyClear(q, h, l, k < steps - 1 ? h * 0.75 : 40);
  }

  // Wide: out beside the hero street's axis, beyond the city's west end, looking back across
  // the city at the towers. Then a straight glide down the axis into the canyon mouth, over
  // open ground (nothing stands beyond the hero street's open end).
  const glide = C.approach;
  const side = G.perp(f);
  const toCity = G.dot(side, G.sub([0, 0], hero.a)) > 0 ? 1 : -1;
  keyClear(G.add(at(-glide), G.mul(side, toCity * 0.6 * glide)), C.wide, [tc[0] * 0.5, tc[1] * 0.5], 110);
  keyClear(at(-glide), C.wide * 0.62, at(0), 30);
  key(at(-glide * 0.55), 80, at(60), 16);
  key(at(-glide * 0.27), 24, at(90), s0 + 7);
  key(at(-glide * 0.07), s0 + 1, at(110), s0 + 7);
  return { points: pts, look, closed: true };
}

/**
 * Closed flying lanes. Each is sampled every ~2.8° around an ellipse; a sample is pushed
 * outward (up to +40%) while a building or skybridge rises within `clear` meters of it, then
 * lifted if still blocked. Heights are max-filtered over neighbors so the Catmull-Rom curve
 * through the samples stays clear between them.
 */
export function buildSkyLanes(cfg, instances, bridges, clear = 18, n = 128) {
  const boxes = instances.map((i) => ({ box: instanceBox(i), h: i.h }));
  const needAt = (p) => {
    let need = 0;
    for (const { box, h } of boxes) {
      if (G.dist(box.c, p) > Math.max(box.hu, box.hv) + clear + 5) continue;
      if (G.insideConvex(G.obb(box.c, box.u, box.hu + clear, box.hv + clear).corners, p)) need = Math.max(need, h + clear);
    }
    for (const b of bridges) {
      if (G.segDist(p, b.a, b.b) < b.width / 2 + clear) need = Math.max(need, b.y + b.depth + clear);
    }
    return need;
  };
  return cfg.map((lane) => {
    const [cx, cz] = lane.center ?? [0, 0];
    const at = (k, sc) => { const a = (k / n) * Math.PI * 2; return [cx + Math.cos(a) * lane.rx * sc, cz + Math.sin(a) * lane.rz * sc]; };
    // Outward push per sample, widened over ±3 neighbors so the loop bulges smoothly
    // around a tower instead of zigzagging (the curve between samples must stay clear too).
    const push = [];
    for (let k = 0; k < n; k++) {
      let sc = 1;
      while (needAt(at(k, sc)) > lane.alt && sc < 1.4) sc += 0.04;
      push.push(sc);
    }
    const pts = [];
    for (let k = 0; k < n; k++) {
      const sc = Math.max(...[-3, -2, -1, 0, 1, 2, 3].map((o) => push[(k + o + n) % n]));
      const p = at(k, sc);
      pts.push([p[0], Math.max(lane.alt, needAt(p)), p[1]]);
    }
    const y = pts.map((_, k) => Math.max(...[-2, -1, 0, 1, 2].map((o) => pts[(k + o + n) % n][1])));
    return {
      points: pts.map((p, k) => [r3(p[0]), r3(y[k]), r3(p[2])]),
      closed: true, count: lane.count, speed: lane.speed, direction: lane.direction,
    };
  });
}
