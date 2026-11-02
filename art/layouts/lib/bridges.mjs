// Enclosed bridges of the city layout: skybridges between towers, footbridges over streets.
// Browser-safe: no Node APIs.
import * as G from './geom.mjs';
import { instanceBox, sampleFlythrough } from './paths.mjs';
import { r3 } from './util.mjs';

/**
 * Enclosed bridges. Each is { kind, a, b, y, width, depth }: centerline from a to b ([x, z]),
 * floor at y, `depth` tall, `width` wide. Skybridges run between tower centers (their ends are
 * hidden inside the towers); footbridges run from one shopfront across the street to the one
 * opposite. Rejected when they would hit another building, a sign, a lamp, another bridge or
 * the flythrough.
 */
export function buildBridges(cfg, instances, roads, signs, lamps, hero, fly, rng) {
  const rand = (lo, hi) => lo + (hi - lo) * rng();
  const flyPts = sampleFlythrough(fly);
  const boxes = instances.map(instanceBox);
  const out = [];
  const bridgeBox = (a, b, w) => G.obb(G.lerp(a, b, 0.5), G.norm(G.sub(b, a)), G.dist(a, b) / 2, w / 2);
  const clearOf = (box, y0, y1, skip) => {
    for (let k = 0; k < instances.length; k++) {
      if (skip.includes(k) || instances[k].h < y0 - 0.5) continue;
      if (G.dist(boxes[k].c, box.c) < 400 && G.obbOverlap(boxes[k], box, 0.3)) return false;
    }
    for (const o of out) {
      if (o.y < y1 + 3 && o.y + o.depth > y0 - 3 && G.obbOverlap(bridgeBox(o.a, o.b, o.width + 2), box, 0)) return false;
    }
    for (const p of flyPts) {
      // The camera may pass under a bridge with 2.5 m headroom, never through or just over it.
      if (p[1] > y0 - 2.5 && p[1] < y1 + 5 && G.insideConvex(G.obb(box.c, box.u, box.hu + 4, box.hv + 4).corners, [p[0], p[2]])) return false;
    }
    return true;
  };

  // Skybridges between towers.
  const towers = instances.map((i, k) => ({ i, k })).filter(({ i }) => i.district === 'towers' && i.h > 120);
  const pairs = [];
  for (let x = 0; x < towers.length; x++) for (let y = x + 1; y < towers.length; y++) {
    const d = G.dist([towers[x].i.position[0], towers[x].i.position[2]], [towers[y].i.position[0], towers[y].i.position[2]]);
    if (d >= cfg.sky.dist[0] && d <= cfg.sky.dist[1]) pairs.push([towers[x], towers[y], d + rng() * 20]);
  }
  pairs.sort((p, q) => p[2] - q[2]);
  const uses = new Map();
  for (const [A, B] of pairs) {
    if (out.length >= cfg.sky.max) break;
    if ((uses.get(A.k) ?? 0) >= cfg.sky.perTower || (uses.get(B.k) ?? 0) >= cfg.sky.perTower) continue;
    const a = [A.i.position[0], A.i.position[2]], b = [B.i.position[0], B.i.position[2]];
    const y = Math.min(A.i.h, B.i.h) * rand(cfg.sky.height[0], cfg.sky.height[1]);
    if (!clearOf(bridgeBox(a, b, cfg.sky.width), y, y + cfg.sky.depth, [A.k, B.k])) continue;
    out.push({ kind: 'sky', a: a.map(r3), b: b.map(r3), y: r3(y), width: cfg.sky.width, depth: cfg.sky.depth });
    uses.set(A.k, (uses.get(A.k) ?? 0) + 1);
    uses.set(B.k, (uses.get(B.k) ?? 0) + 1);
  }

  // Footbridges over core streets, between facing shopfronts.
  const nSky = out.length;
  const perRoad = new Map();
  const front = instances.map((i, k) => ({ i, k })).filter(({ i }) => !i.interior && i.road >= 0 && i.district === 'core' && i.h >= 14);
  // Visit hero-street buildings first, then the rest in a seeded order.
  const order = front.map((f) => ({ f, key: (hero && f.i.road === hero.id ? 0 : 1) + rng() })).sort((p, q) => p.key - q.key).map((o) => o.f);
  const signBoxes = signs.map((sg) => ({ box: G.obb([sg.position[0], sg.position[2]], [Math.cos(sg.rotationY), -Math.sin(sg.rotationY)], sg.size[0] / 2 + 0.4, sg.size[2] / 2 + 0.4), y0: sg.position[1] - sg.size[1] / 2, y1: sg.position[1] + sg.size[1] / 2 }));
  let heroCount = 0;
  for (const B of order) {
    if (out.length - nSky >= cfg.foot.max) break;
    const r = roads[B.i.road];
    if (!r || r.cls === 'arterial' || r.cls === 'alley') continue;
    const isHero = hero && r.id === hero.id;
    if (isHero && heroCount >= cfg.foot.hero) continue;
    const list = perRoad.get(r.id) ?? [];
    if (list.length >= cfg.foot.perRoad) continue;
    const d = G.norm(G.sub(r.b, r.a)), n = G.perp(d);
    const at = (i) => G.dot(G.sub([i.position[0], i.position[2]], r.a), d);
    const side = (i) => Math.sign(G.dot(G.sub([i.position[0], i.position[2]], r.a), n));
    const faceOff = (i) => {
      const t = i.rotationY;
      const v = [Math.sin(t), Math.cos(t)];
      return G.dot(G.sub(G.add([i.position[0], i.position[2]], G.mul(v, i.fp[1])), r.a), n);
    };
    const sB = at(B.i), sideB = side(B.i);
    let best = null;
    for (const C of front) {
      if (C.i.road !== r.id || side(C.i) === sideB) continue;
      const lo = Math.max(sB - B.i.fp[0], at(C.i) - C.i.fp[0]), hi = Math.min(sB + B.i.fp[0], at(C.i) + C.i.fp[0]);
      if (hi - lo >= cfg.foot.overlap && (!best || hi - lo > best.span)) best = { C, s: (lo + hi) / 2, span: hi - lo };
    }
    if (!best) continue;
    if (list.some((s0) => Math.abs(s0 - best.s) < cfg.foot.spacing)) continue;
    const base = G.add(r.a, G.mul(d, best.s));
    const oB = faceOff(B.i), oC = faceOff(best.C.i);
    const a = G.add(base, G.mul(n, oB - Math.sign(oB) * 0.4)), b = G.add(base, G.mul(n, oC - Math.sign(oC) * 0.4));
    const y = rand(cfg.foot.floor[0], cfg.foot.floor[1]);
    const y1 = y + cfg.foot.depth;
    const box = bridgeBox(a, b, cfg.foot.width);
    if (y1 > Math.min(B.i.h, best.C.i.h) - 3) continue;
    if (signBoxes.some((sb) => sb.y1 > y - 0.3 && sb.y0 < y1 + 0.3 && G.obbOverlap(sb.box, box, 0))) continue;
    if ((lamps ?? []).some((l) => G.segDist([l[0], l[1]], a, b) < cfg.foot.width / 2 + 2.6)) continue;
    // The bridge ends sit 0.4 m inside the two facades; clearance ignores those two buildings.
    if (!clearOf(G.obb(box.c, box.u, Math.max(box.hu - 1.0, 0.5), box.hv), y, y1, [B.k, best.C.k])) continue;
    out.push({ kind: 'foot', a: a.map(r3), b: b.map(r3), y: r3(y), width: cfg.foot.width, depth: cfg.foot.depth });
    list.push(best.s);
    perRoad.set(r.id, list);
    if (isHero) heroCount++;
  }
  return out;
}
