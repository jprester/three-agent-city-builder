// 2D geometry on the ground plane. Points are [x, z] in three.js meters.
// Polygons are convex and counter-clockwise in (x, z) (positive signed area),
// so the interior is to the left of each edge. Browser-safe: no Node APIs.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const norm = (a) => mul(a, 1 / (len(a) || 1));
/** Left-hand perpendicular: the inward normal of a CCW edge direction. */
export const perp = (a) => [-a[1], a[0]];
export const dist = (a, b) => len(sub(a, b));
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const fromAngle = (t) => [Math.cos(t), Math.sin(t)];

export function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return s / 2;
}

export function centroid(pts) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = cross(p, q);
    a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) return pts[0];
  return [cx / (3 * a), cz / (3 * a)];
}

/** Width of the polygon measured along unit direction `d`. */
export function extent(pts, d) {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const s = dot(p, d); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  return hi - lo;
}

/** Direction (angle in radians, [0, π)) of the polygon's largest extent, and min/max extents. */
export function axes(pts, samples = 36) {
  let best = 0, max = -Infinity, min = Infinity;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI;
    const e = extent(pts, fromAngle(t));
    if (e > max) { max = e; best = t; }
    min = Math.min(min, e);
  }
  return { angle: best, max, min };
}

/**
 * Keep the part of a tagged convex polygon where dot(p - o, n) >= off.
 * `poly` is { pts, tags }, tags[i] labels edge pts[i] -> pts[i+1]; the new
 * edge along the cut gets `cutTag`.
 */
export function clip(poly, o, n, off, cutTag) {
  const pts = [], tags = [];
  const k = poly.pts.length;
  const f = (p) => dot(sub(p, o), n) - off;
  for (let i = 0; i < k; i++) {
    const a = poly.pts[i], b = poly.pts[(i + 1) % k], ta = poly.tags[i];
    const fa = f(a), fb = f(b);
    if (fa >= 0) { pts.push(a); tags.push(ta); }
    if ((fa >= 0) !== (fb >= 0)) {
      pts.push(lerp(a, b, fa / (fa - fb)));
      tags.push(fa >= 0 ? cutTag : ta);
    }
  }
  return dedupe({ pts, tags });
}

function dedupe(poly) {
  const pts = [], tags = [];
  for (let i = 0; i < poly.pts.length; i++) {
    const p = poly.pts[i], q = poly.pts[(i + 1) % poly.pts.length];
    if (dist(p, q) < 1e-6) continue;
    pts.push(p); tags.push(poly.tags[i]);
  }
  return { pts, tags };
}

/** The two points where the line through `o` with direction `d` crosses a convex polygon's boundary. */
export function chord(pts, o, d) {
  const n = perp(d);
  const hits = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const fa = dot(sub(a, o), n), fb = dot(sub(b, o), n);
    if ((fa >= 0) !== (fb >= 0)) hits.push(lerp(a, b, fa / (fa - fb)));
  }
  if (hits.length < 2) return null;
  hits.sort((p, q) => dot(sub(p, o), d) - dot(sub(q, o), d));
  return [hits[0], hits[hits.length - 1]];
}

/** Line intersection: p + t*r with q + u*s. Returns the point or null if parallel. */
export function intersectLines(p, r, q, s) {
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  return add(p, mul(r, cross(sub(q, p), s) / den));
}

/**
 * Move every edge of a convex CCW polygon inward by its own distance `d(i)`.
 * Returns the new points (edge i stays edge i) or null if it collapses.
 */
export function inset(pts, d) {
  const k = pts.length;
  const lines = pts.map((p, i) => {
    const dir = norm(sub(pts[(i + 1) % k], p));
    return { p: add(p, mul(perp(dir), d(i))), dir };
  });
  const out = [];
  for (let i = 0; i < k; i++) {
    const prev = lines[(i + k - 1) % k], cur = lines[i];
    const x = intersectLines(prev.p, prev.dir, cur.p, cur.dir);
    if (!x) return null;
    out.push(x);
  }
  // Every edge must keep its direction, otherwise the polygon turned inside out.
  for (let i = 0; i < k; i++) {
    if (dot(sub(out[(i + 1) % k], out[i]), lines[i].dir) <= 0.5) return null;
  }
  return area(out) > 1 ? out : null;
}

export function insideConvex(pts, p, eps = 1e-6) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (cross(sub(b, a), sub(p, a)) < -eps) return false;
  }
  return true;
}

/** Oriented box: center c, unit axes u (half-size hu) and v (half-size hv). */
export function obb(c, u, hu, hv) {
  const v = perp(u);
  return { c, u, v, hu, hv, corners: [
    add(add(c, mul(u, -hu)), mul(v, -hv)), add(add(c, mul(u, hu)), mul(v, -hv)),
    add(add(c, mul(u, hu)), mul(v, hv)), add(add(c, mul(u, -hu)), mul(v, hv)),
  ] };
}

/** Separating-axis test for two OBBs; touching within `eps` does not count as overlap. */
export function obbOverlap(a, b, eps = 0.05) {
  for (const axis of [a.u, a.v, b.u, b.v]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of a.corners) { const s = dot(p, axis); a0 = Math.min(a0, s); a1 = Math.max(a1, s); }
    for (const p of b.corners) { const s = dot(p, axis); b0 = Math.min(b0, s); b1 = Math.max(b1, s); }
    if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
  }
  return true;
}

/** Distance from point p to segment ab. */
export function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, mul(ab, t)));
}

/** Seeded 2D value noise in [0, 1]. */
export function valueNoise(seed) {
  const h = (x, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = s(x - x0), fz = s(z - z0);
    const a = h(x0, z0), b = h(x0 + 1, z0), c = h(x0, z0 + 1), d = h(x0 + 1, z0 + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}
