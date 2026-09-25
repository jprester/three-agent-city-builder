// City layout: road hierarchy, blocks, frontage-packed buildings, districts,
// hero street, street lamps, viewpoint anchors and the flythrough spline.
//
// Coordinates: three.js space, Y up, ground at y = 0, meters; 2D points are [x, z].
// Buildings' fronts face +Z at rotationY = 0.
//
// Method:
// 1. Split the city outline with arterials until superblocks are small enough.
// 2. Split the largest old-core superblock lengthwise: that cut is the hero street.
// 3. Split every superblock recursively (secondary streets, alleys in the core), each
//    cut slightly off-perpendicular to the block's long axis, so the net is irregular.
// 4. Inset each block by per-edge sidewalk widths, then walk every edge placing
//    buildings flush to the sidewalk, facing the street (frontage packing). The old
//    core then gets back buildings in leftover interior space.
// Browser-safe: no Node APIs (it also runs in the browser for ?seed=).
import * as G from './lib/geom.mjs';
import { mulberry32, weightedChoice } from './lib/rng.mjs';

const DISTRICT_DEFAULTS = {
  // blockArea: target block size (m²); minWidth: narrowest allowed block; secondaryFactor:
  // blocks bigger than blockArea × this are cut by secondaries, smaller ones by `smallRoad`.
  // gap: [min, max] meters between neighbors; tight: chance of no gap.
  core: { gridAngle: 8, blockArea: 4200, minWidth: 30, secondaryFactor: 5, smallRoad: 'alley', gap: [1, 3], tight: 0.85, interior: true, xzScale: [1, 1], heightRange: null, buildings: {} },
  towers: { gridAngle: 30, blockArea: 15000, minWidth: 70, secondaryFactor: 100, smallRoad: 'secondary', gap: [10, 28], tight: 0, interior: false, xzScale: [1, 1], heightRange: [150, 400], buildings: {} },
  industrial: { gridAngle: -6, blockArea: 16000, minWidth: 55, secondaryFactor: 100, smallRoad: 'secondary', gap: [4, 14], tight: 0.2, interior: false, xzScale: [1, 1], heightRange: null, buildings: {} },
};

const DEFAULTS = {
  size: [1000, 800],
  arterialArea: 150000,
  /** Angle jitter (radians) of the very first arterial: one avenue may cut across the grid. */
  diagonal: 0.35,
  roads: { arterial: 26, secondary: 14, alley: 7, hero: 12 },
  sidewalks: { arterial: 4.5, secondary: 3.5, hero: 3.5, alley: 1.2, edge: 3 },
  towers: { center: [230, -130], radius: 190 },
  portZ: 250,
  districtNoise: 60,
  heroBuildings: null,
  lampSpacing: { arterial: 30, secondary: 26, hero: 15, alley: 24 },
  flythrough: { cruise: 190, wide: 430 },
  // Signs per frontage building: hero street dense, old core sparse, elsewhere none.
  // Enclosed bridges: skybridges between nearby towers, footbridges over core streets.
  bridges: {
    sky: { max: 7, perTower: 2, dist: [30, 95], height: [0.2, 0.5], width: 4.5, depth: 4.2 },
    foot: { max: 16, hero: 2, perRoad: 2, spacing: 70, floor: [6.5, 9.0], width: 3.2, depth: 3.0, overlap: 4 },
  },
  signs: {
    hero: { blades: [2, 5], bladeChance: 1, panelChance: 0.7 },
    core: { blades: [1, 1], bladeChance: 0.16, panelChance: 0.22 },
  },
};

/** Frontage priority: edges along bigger streets get first pick of buildings. */
const EDGE_PRIORITY = { hero: 0, arterial: 1, secondary: 2, edge: 3, alley: 4 };

export function generate({ params, seed, assets = {} }) {
  const P = { ...DEFAULTS, ...params };
  // Nested option groups merge with their defaults instead of replacing them.
  for (const k of ['roads', 'sidewalks', 'lampSpacing', 'flythrough', 'signs', 'bridges']) P[k] = { ...DEFAULTS[k], ...(params[k] ?? {}) };
  const D = {};
  for (const k of Object.keys(DISTRICT_DEFAULTS)) D[k] = { ...DISTRICT_DEFAULTS[k], ...(params.districts?.[k] ?? {}) };
  const rng = mulberry32(seed);
  const rand = (lo, hi) => lo + (hi - lo) * rng();
  const noise = G.valueNoise(seed ^ 0x5bd1e995);
  const [W, Dp] = P.size;

  // ---- districts
  const districtAt = ([x, z]) => {
    const n = noise(x / 170, z / 170) - 0.5;
    if (z > P.portZ + n * P.districtNoise) return 'industrial';
    const t = Math.hypot(x - P.towers.center[0], z - P.towers.center[1]) / P.towers.radius;
    return t + n * 0.35 < 1 ? 'towers' : 'core';
  };

  // ---- roads and blocks
  const roads = [];
  const blocks = [];
  const tagClass = (tag) => (tag === 'edge' ? 'edge' : roads[tag].cls);
  const outline = { pts: [[-W / 2, -Dp / 2], [W / 2, -Dp / 2], [W / 2, Dp / 2], [-W / 2, Dp / 2]], tags: ['edge', 'edge', 'edge', 'edge'] };

  const JITTER = { arterial: 0.05, secondary: 0.04, alley: 0.025, hero: 0.01 };

  /**
   * Cut `poly` with a road of class `cls`. Roads follow the district's grid: mode 'across'
   * takes the grid direction most perpendicular to the block's long axis, 'along' the most
   * parallel one. `jitter` overrides the class's angle jitter.
   */
  function cut(poly, cls, mode, minWidth, jitter = JITTER[cls]) {
    const ax = G.axes(poly.pts);
    const c = G.centroid(poly.pts);
    const width = P.roads[cls];
    const id = roads.length;
    const grid = (D[districtAt(c)].gridAngle * Math.PI) / 180;
    const long = G.fromAngle(ax.angle);
    const [g0, g1] = [G.fromAngle(grid), G.fromAngle(grid + Math.PI / 2)];
    const parallel = Math.abs(G.dot(g0, long)) > Math.abs(G.dot(g1, long)) ? grid : grid + Math.PI / 2;
    const base = mode === 'along' ? parallel : parallel + Math.PI / 2;
    for (let attempt = 0; attempt < 10; attempt++) {
      const j = (rng() - 0.5) * 2 * jitter;
      const d = G.fromAngle(base + j);
      const n = G.perp(d);
      const span = G.extent(poly.pts, n);
      const o = G.add(c, G.mul(n, (rng() - 0.5) * (mode === 'along' ? 0.12 : 0.36) * span));
      const A = G.clip(poly, o, n, width / 2, id);
      const B = G.clip(poly, o, G.mul(n, -1), width / 2, id);
      if (A.pts.length < 3 || B.pts.length < 3) continue;
      if (G.axes(A.pts).min < minWidth || G.axes(B.pts).min < minWidth) continue;
      const ends = G.chord(poly.pts, o, d);
      if (!ends) continue;
      roads.push({ id, cls, width, a: ends[0], b: ends[1] });
      return [A, B];
    }
    return null;
  }

  function splitArterials(poly, out, depth = 0) {
    if (G.area(poly.pts) <= P.arterialArea) { out.push(poly); return; }
    const halves = cut(poly, 'arterial', 'across', 60, depth === 0 ? P.diagonal : JITTER.arterial);
    if (!halves) { out.push(poly); return; }
    for (const h of halves) splitArterials(h, out, depth + 1);
  }

  /** Fraction of a polygon's area in the old core, by sampling a grid of points. */
  function coreFraction(pts) {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    let inside = 0, core = 0;
    for (let i = 0; i < 12; i++) for (let k = 0; k < 12; k++) {
      const p = [G.lerp([Math.min(...xs), 0], [Math.max(...xs), 0], (i + 0.5) / 12)[0], G.lerp([0, Math.min(...zs)], [0, Math.max(...zs)], (k + 0.5) / 12)[1]];
      if (!G.insideConvex(pts, p)) continue;
      inside++;
      if (districtAt(p) === 'core') core++;
    }
    return inside ? core / inside : 0;
  }

  function subdivide(poly, depth) {
    const district = districtAt(G.centroid(poly.pts));
    const cfg = D[district];
    const a = G.area(poly.pts);
    if (depth > 14 || a < cfg.blockArea * rand(0.7, 1.3)) { blocks.push({ ...poly, district }); return; }
    const cls = a > cfg.blockArea * cfg.secondaryFactor ? 'secondary' : cfg.smallRoad;
    const halves = cut(poly, cls, 'across', cfg.minWidth);
    if (!halves) { blocks.push({ ...poly, district }); return; }
    for (const h of halves) subdivide(h, depth + 1);
  }

  const superblocks = [];
  splitArterials(outline, superblocks);
  // Hero street: lengthwise through the biggest old-core superblock.
  let hero = null;
  const coreSupers = superblocks
    .map((p, i) => ({ p, i, a: G.area(p.pts) * coreFraction(p.pts) ** 3 }))
    .sort((x, y) => y.a - x.a);
  if (coreSupers.length) {
    const { p, i } = coreSupers[0];
    const halves = cut(p, 'hero', 'along', D.core.minWidth);
    if (halves) {
      superblocks.splice(i, 1, ...halves);
      hero = roads[roads.length - 1];
    }
  }
  for (const sb of superblocks) subdivide(sb, 0);

  // ---- building catalog per district
  const buildingIds = Object.keys(assets).filter((id) => assets[id].meta?.footprint);
  const resolve = (weights) => {
    const out = {};
    for (const [pattern, w] of Object.entries(weights ?? {})) {
      const re = globToRegex(pattern);
      const hits = buildingIds.filter((id) => re.test(id));
      for (const id of hits) out[id] = (out[id] ?? 0) + w / hits.length;
    }
    return out;
  };
  const weightsFor = {};
  for (const k of Object.keys(D)) weightsFor[k] = resolve(D[k].buildings);
  const heroWeights = P.heroBuildings ? resolve(P.heroBuildings) : weightsFor.core;

  function scaleFor(id, district) {
    const meta = assets[id].meta;
    const cfg = D[district];
    if (!meta.scalable) return [1, 1, 1];
    const sxz = rand(cfg.xzScale[0], cfg.xzScale[1]);
    const sy = cfg.heightRange ? rand(cfg.heightRange[0], cfg.heightRange[1]) / meta.height : sxz;
    return [sxz, sy, sxz];
  }

  // ---- frontage packing
  const instances = [];
  const place = (id, box, rotationY, s, district, blockIndex, road, interior) => {
    const meta = assets[id].meta;
    instances.push({
      asset: id,
      position: [r3(box.c[0]), 0, r3(box.c[1])],
      rotationY: r3(rotationY),
      scale: s.map(r3),
      seed: Math.floor(rng() * 2 ** 31),
      district,
      block: blockIndex,
      road,
      interior,
      h: r3(meta.height * s[1]),
      fp: [r3(box.hu), r3(box.hv)],
    });
  };

  blocks.forEach((block, bi) => {
    const cfg = D[block.district];
    const lot = G.inset(block.pts, (i) => P.sidewalks[tagClass(block.tags[i])]);
    block.lot = lot;
    if (!lot) return;
    const placed = [];
    const edges = lot.map((_, i) => i).sort((i, j) =>
      EDGE_PRIORITY[tagClass(block.tags[i])] - EDGE_PRIORITY[tagClass(block.tags[j])]
      || G.dist(lot[j], lot[(j + 1) % lot.length]) - G.dist(lot[i], lot[(i + 1) % lot.length]));

    for (const i of edges) {
      const q0 = lot[i], q1 = lot[(i + 1) % lot.length];
      const L = G.dist(q0, q1);
      if (L < 6) continue;
      const cls = tagClass(block.tags[i]);
      const weights = cls === 'hero' ? heroWeights : weightsFor[block.district];
      if (!Object.keys(weights).length) continue;
      const t = G.norm(G.sub(q1, q0));
      const nIn = G.perp(t);
      const u = G.mul(t, -1);
      const rotationY = Math.atan2(-nIn[0], -nIn[1]);
      let pos = cfg.tight >= 1 ? 0 : rand(0, cfg.gap[1]);
      while (pos < L - 4) {
        let ok = false;
        for (let attempt = 0; attempt < 6 && !ok; attempt++) {
          const id = weightedChoice(rng, weights);
          const s = scaleFor(id, block.district);
          const [fw, fd] = assets[id].meta.footprint;
          const w = fw * s[0], d = fd * s[2];
          if (pos + w > L) continue;
          const c = G.add(G.add(q0, G.mul(t, pos + w / 2)), G.mul(nIn, d / 2));
          const box = G.obb(c, u, w / 2, d / 2);
          if (!box.corners.every((p) => G.insideConvex(lot, p, 0.01))) continue;
          // Stricter than the tests' 5 cm tolerance, so rounding in the output never creates an overlap.
          if (placed.some((b) => G.obbOverlap(b, box, 0.01))) continue;
          placed.push(box);
          place(id, box, rotationY, s, block.district, bi, block.tags[i] === 'edge' ? -1 : block.tags[i], false);
          pos += w + (rng() < cfg.tight ? 0 : rand(cfg.gap[0], cfg.gap[1]));
          ok = true;
        }
        if (!ok) pos += 3;
      }
    }

    // Back buildings in the leftover interior (old core only), aligned to the nearest edge.
    if (!cfg.interior) return;
    const lotArea = G.area(lot);
    const [minX, maxX] = [Math.min(...lot.map((p) => p[0])), Math.max(...lot.map((p) => p[0]))];
    const [minZ, maxZ] = [Math.min(...lot.map((p) => p[1])), Math.max(...lot.map((p) => p[1]))];
    const weights = weightsFor[block.district];
    for (let k = 0; k < Math.floor(lotArea / 200); k++) {
      const p = [rand(minX, maxX), rand(minZ, maxZ)];
      if (!G.insideConvex(lot, p)) continue;
      let near = 0, best = Infinity;
      lot.forEach((q, i) => {
        const dd = G.segDist(p, q, lot[(i + 1) % lot.length]);
        if (dd < best) { best = dd; near = i; }
      });
      const t = G.norm(G.sub(lot[(near + 1) % lot.length], lot[near]));
      const id = weightedChoice(rng, weights);
      const s = scaleFor(id, block.district);
      const [fw, fd] = assets[id].meta.footprint;
      const box = G.obb(p, G.mul(t, -1), (fw * s[0]) / 2, (fd * s[2]) / 2);
      if (!box.corners.every((q) => G.insideConvex(lot, q, 0.01))) continue;
      if (placed.some((b) => G.obbOverlap(b, box, 0.01))) continue;
      placed.push(box);
      const nIn = G.perp(t);
      place(id, box, Math.atan2(-nIn[0], -nIn[1]), s, block.district, bi, -1, true);
    }
  });

  // ---- street lamps: on the sidewalk just off the curb, arm pointing over the road
  const lamps = [];
  for (const road of roads) {
    const L = G.dist(road.a, road.b);
    const spacing = P.lampSpacing[road.cls];
    if (L < 24) continue;
    const d = G.norm(G.sub(road.b, road.a));
    const n = G.perp(d);
    let k = 0;
    for (let s = 10 + rng() * spacing * 0.5; s < L - 10; s += spacing, k++) {
      const sides = road.cls === 'alley' ? [k % 2 ? 1 : -1] : [-1, 1];
      for (const side of sides) {
        const p = G.add(G.add(road.a, G.mul(d, s)), G.mul(n, side * (road.width / 2 + 0.6)));
        if (!blocks.some((b) => G.insideConvex(b.pts, p))) continue; // in a side street's mouth
        lamps.push([r3(p[0]), r3(p[1]), r3(Math.atan2(-side * n[0], -side * n[1])), road.id]);
      }
    }
  }

  // ---- flythrough and bridges come before signs: bridges are structure, signs avoid them.
  const flythrough = hero ? buildFlythrough(hero, instances, P, W, Dp) : undefined;
  const bridges = buildBridges(P.bridges, instances, roads, [], lamps, hero, flythrough, rng);
  const footBoxes = bridges.filter((b) => b.kind === 'foot').map((b) => ({
    box: G.obb(G.lerp(b.a, b.b, 0.5), G.norm(G.sub(b.b, b.a)), G.dist(b.a, b.b) / 2 + 0.5, b.width / 2 + 0.6),
    y0: b.y - 0.6, y1: b.y + b.depth + 0.6,
  }));
  const hitsBridge = (pos, rotationY, size) => {
    const sb = G.obb([pos[0], pos[2]], [Math.cos(rotationY), -Math.sin(rotationY)], size[0] / 2, size[2] / 2);
    return footBoxes.some((f) => pos[1] + size[1] / 2 > f.y0 && pos[1] - size[1] / 2 < f.y1 && G.obbOverlap(f.box, sb, 0));
  };

  // ---- signs: blades project from the front face over the street, panels sit flat on it
  const signs = [];
  instances.forEach((inst, index) => {
    if (inst.interior || inst.road < 0) return;
    const onHero = hero && inst.road === hero.id;
    const cfg = onHero ? P.signs.hero : inst.district === 'core' ? P.signs.core : null;
    if (!cfg) return;
    const t = inst.rotationY;
    const u = [Math.cos(t), -Math.sin(t)], v = [Math.sin(t), Math.cos(t)];
    const [hu, hv] = inst.fp;
    const front = [inst.position[0] + v[0] * hv, inst.position[2] + v[1] * hv];
    const top = Math.min(inst.h - 3, onHero ? 34 : 22);
    const used = [];
    if (rng() < cfg.bladeChance && hu > 2 && top > 9) {
      const n = cfg.blades[0] + Math.floor(rng() * (cfg.blades[1] - cfg.blades[0] + 1));
      for (let k = 0; k < n; k++) {
        const off = rand(-hu + 1.2, hu - 1.2);
        if (used.some((o) => Math.abs(o - off) < 2.2)) continue;
        used.push(off);
        // Tall blades, or wide "arms" reaching out over the street (the Mong Kok read).
        const arm = rng() < (onHero ? 0.5 : 0.3);
        const w = arm ? rand(3.5, onHero ? 7.5 : 4.5) : rand(1.4, onHero ? 3.2 : 2.2);
        const h = Math.min(arm ? rand(1.2, 2.6) : rand(3, onHero ? 10 : 6), top - 5.4);
        if (h < 1.2) continue;
        const y = rand(5.4, top - h) + h / 2;
        const out = 0.3 + w / 2;
        const sgn = {
          building: index, kind: 'blade',
          position: [r3(front[0] + u[0] * off + v[0] * out), r3(y), r3(front[1] + u[1] * off + v[1] * out)],
          // A blade's faces look along the street: its normal is the facade's u axis.
          rotationY: r3(Math.atan2(u[0], u[1])),
          size: [r3(w), r3(h), 0.28],
          seed: Math.floor(rng() * 2 ** 31),};
        if (!hitsBridge(sgn.position, sgn.rotationY, sgn.size)) signs.push(sgn);
      }
    }
    if (rng() < cfg.panelChance && hu > 2.5) {
      const w = Math.min(rand(3, 9), 2 * hu - 1);
      const aboveCanopy = rng() < 0.5;
      const h = aboveCanopy ? rand(1.2, 2.6) : rand(0.8, 1.0);
      const y = aboveCanopy ? 5.2 + h / 2 + rand(0, 1.5) : 3.4 + h / 2;
      const off = rand(-hu + w / 2 + 0.3, hu - w / 2 - 0.3);
      const out = aboveCanopy ? 0.2 : 0.12;
      const sgn = {
        building: index, kind: 'panel',
        position: [r3(front[0] + u[0] * off + v[0] * out), r3(y), r3(front[1] + u[1] * off + v[1] * out)],
        rotationY: r3(t),
        size: [r3(w), r3(h), 0.2],
        seed: Math.floor(rng() * 2 ** 31),};
      if (!hitsBridge(sgn.position, sgn.rotationY, sgn.size)) signs.push(sgn);
    }
  });

  // ---- anchors: named frames for viewpoints ({ origin, x }: x is the frame's forward axis on the ground)
  const coreCenter = centroidOf(blocks.filter((b) => b.district === 'core').map((b) => G.centroid(b.pts))) ?? [0, 0];
  const heroDir = hero ? G.norm(G.sub(hero.b, hero.a)) : [1, 0];
  const portOrigin = [0, Dp / 2 + 60];
  const anchors = {
    center: { origin: [0, 0, 0], x: [1, 0] },
    hero: hero ? { origin: [r3(hero.a[0]), 0, r3(hero.a[1])], x: heroDir.map(r3) } : { origin: [0, 0, 0], x: [1, 0] },
    core: { origin: [r3(coreCenter[0]), 0, r3(coreCenter[1])], x: G.norm(G.sub(P.towers.center, coreCenter)).map(r3) },
    towers: { origin: [P.towers.center[0], 0, P.towers.center[1]], x: G.norm(G.sub(P.towers.center, coreCenter)).map(r3) },
    port: { origin: [portOrigin[0], 0, portOrigin[1]], x: G.norm(G.sub(P.towers.center, portOrigin)).map(r3) },
  };


  return {
    version: 2,
    generator: 'city',
    seed,
    size: [W, Dp],
    districts: { towers: P.towers, portZ: P.portZ },
    roads: roads.map((r) => ({ id: r.id, cls: r.cls, width: r.width, a: r.a.map(r3), b: r.b.map(r3) })),
    blocks: blocks.map((b) => ({ district: b.district, points: b.pts.map((p) => p.map(r3)), edges: b.tags.map((t) => (t === 'edge' ? -1 : t)) })),
    hero: hero ? { road: hero.id, width: hero.width, a: hero.a.map(r3), b: hero.b.map(r3) } : null,
    lamps,
    signs,
    anchors,
    instances,
    flythrough,
    bridges,
  };
}

/**
 * Cinematic path: starts low in the hero canyon, climbs out at its far end, sweeps around
 * the city at cruise height, pulls out wide, then drops back into the canyon from above.
 */
function buildFlythrough(hero, instances, P, W, Dp) {
  const maxH = (p, r) => instances.reduce((m, i) =>
    (Math.hypot(i.position[0] - p[0], i.position[2] - p[1]) < r + Math.max(...i.fp) ? Math.max(m, i.h) : m), 0);
  const f = G.norm(G.sub(hero.b, hero.a));
  const L = G.dist(hero.a, hero.b);
  const at = (s) => G.add(hero.a, G.mul(f, s));
  const pt = (p, y) => [r3(p[0]), r3(y), r3(p[1])];
  /** Highest roof near the straight leg from a to b. */
  const clearance = (a, b) => {
    let m = 0;
    for (let k = 0; k <= 24; k++) m = Math.max(m, maxH(G.lerp(a, b, k / 24), 70));
    return m;
  };

  // Each control point has a look-at target; the camera follows `points`, looks along `look`.
  const pts = [];
  const look = [];
  const key = (p, y, l, ly) => { pts.push(pt(p, y)); look.push(pt(l, ly)); };
  const tc = P.towers.center;
  key(at(14), 3.5, at(120), 14);
  key(at(L * 0.35), 7, at(L * 0.35 + 140), 30);
  key(at(L * 0.68), 22, at(L + 60), 90);
  const exit = at(L - 6);
  const y3 = maxH(hero.b, 90) + 25;
  key(exit, y3, G.add(hero.b, G.mul(f, 200)), y3 * 0.6);
  const out = G.add(hero.b, G.mul(f, 90));
  const y4 = Math.max(y3 + 20, maxH(out, 140) + 40);
  key(out, y4, [0, 0], 60);

  // Arc around the center, far enough out to clear the tower cluster, looking at the city.
  let R = Math.max(W, Dp) * 0.55;
  while (Math.hypot(tc[0], tc[1]) + P.towers.radius + 60 > R && Math.hypot(tc[0], tc[1]) - P.towers.radius - 60 < R) R += 40;
  const heroMid = at(L / 2);
  const start = Math.atan2(out[1], out[0]);
  const wideAngle = Math.atan2(heroMid[1] - tc[1], heroMid[0] - tc[0]);
  let sweep = wideAngle - start;
  while (sweep <= 0.5) sweep += Math.PI * 2;
  let prev = out;
  for (let k = 1; k <= 3; k++) {
    const a = start + (sweep * k) / 4;
    const p = [Math.cos(a) * R, Math.sin(a) * R];
    key(p, Math.max(P.flythrough.cruise + k * 20, clearance(prev, p) + 50), k === 2 ? tc : [0, 0], k === 2 ? 150 : 40);
    prev = p;
  }
  const wide = [Math.cos(wideAngle) * R * 1.45, Math.sin(wideAngle) * R * 1.45];
  key(wide, Math.max(P.flythrough.wide, clearance(prev, wide) + 50), [0, 0], 0);
  // Drop into the cross street at the hero street's entrance, then turn into the canyon.
  const entry = at(-10);
  key(entry, Math.max(150, clearance(wide, entry) + 40), at(40), 0);
  key(at(-7), 45, at(80), 8);
  return { points: pts, look, closed: true };
}

/** Oriented box of a layout instance's footprint. */
function instanceBox(i) {
  const t = i.rotationY;
  return G.obb([i.position[0], i.position[2]], [Math.cos(t), -Math.sin(t)], i.fp[0], i.fp[1]);
}

/** Dense samples of the flythrough (uniform Catmull-Rom through the control points). */
function sampleFlythrough(fly) {
  if (!fly) return [];
  const P = fly.points, n = P.length, out = [];
  for (let k = 0; k < n; k++) {
    const p0 = P[(k - 1 + n) % n], p1 = P[k], p2 = P[(k + 1) % n], p3 = P[(k + 2) % n];
    for (let s = 0; s < 1; s += 0.02) {
      const s2 = s * s, s3 = s2 * s;
      out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * s + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * s2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * s3)));
    }
  }
  return out;
}

/**
 * Enclosed bridges. Each is { kind, a, b, y, width, depth }: centerline from a to b ([x, z]),
 * floor at y, `depth` tall, `width` wide. Skybridges run between tower centers (their ends are
 * hidden inside the towers); footbridges run from one shopfront across the street to the one
 * opposite. Rejected when they would hit another building, a sign, a lamp, another bridge or
 * the flythrough.
 */
function buildBridges(cfg, instances, roads, signs, lamps, hero, fly, rng) {
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

function centroidOf(pts) {
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function globToRegex(glob) {
  return new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
}

const r3 = (v) => Math.round(v * 1000) / 1000;
