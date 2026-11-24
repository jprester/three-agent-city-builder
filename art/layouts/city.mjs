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
import { parkedVehicles } from './lib/outskirts.mjs';
import { buildIsland } from './lib/island.mjs';
import { buildWaterfront } from './lib/waterfront.mjs';
import { buildFlythrough, buildSkyLanes, instanceBox, liftClear, sampleFlythrough } from './lib/paths.mjs';
import { buildBridges } from './lib/bridges.mjs';
import { buildMonorail, hitsEnvelope, hitsGround } from './lib/monorail.mjs';
import { placeProps, plantParks } from './lib/street.mjs';
import { centroidOf, globToRegex, r3 } from './lib/util.mjs';
import { mulberry32, weightedChoice } from './lib/rng.mjs';
import { createSignPlacer, signParams } from './lib/signs.mjs';
import { signalOffset, trafficLanes, trafficPose } from './lib/traffic.mjs';

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
  // Flythrough (buildFlythrough). street: camera height in the canyon; orbitGap: clearance
  // beyond the outermost tower; orbitHeight: climb while circling the towers; orbitSweep:
  // arc in turns; wide: height of the wide shot; approach: glide length back into the canyon.
  flythrough: { street: 4, orbitGap: 45, orbitHeight: [120, 280], orbitSweep: 0.8, wide: 280, approach: 440 },
  parking: { count: 10, assets: ['vehicles/van', 'vehicles/box_truck', 'vehicles/kei', 'vehicles/car_b'], junctionClear: 18, spacing: 45, curbGap: 0.5, clearance: 0.4 },
  // The island (buildIsland): the coast lies `margin` beyond each city edge (north = -z), never
  // closer than `minMargin`, rounded by `corner` and waved by `wobble` [harmonic, meters].
  // Water stands at `water`; `strait` is the water width to the mainland per side (0: open
  // sea). Between the city and the coast: a `ring` road, `avenue`s continuing the city's
  // streets to the waterfront, `street`s filling gaps over `pitch[1]`, a `promenade` and quay.
  // `height`: building height factor at the city edge and at the waterfront. `terrain`: the
  // height of the mainland's narrow shore, and where (past the far shore) the hills `start`,
  // over what distance they `rise`, and how high.
  island: {
    margin: { west: 270, east: 300, north: 290, south: 95 }, minMargin: 70, corner: 160,
    wobble: [[2, 18], [3, 14], [5, 9], [9, 5]],
    strait: { north: 520, east: 750, west: 1100, south: 0 }, openSea: 6000, water: -1.6,
    ring: 18, avenue: 12, street: 9, pitch: [70, 90], promenade: 12, lampEvery: 18, quietLamps: 34,
    height: [1.35, 0.75],
    terrain: { plain: 1.4, start: 40, rise: 1100, height: 220 },
  },
  landmarks: { count: 3, spacing: 80 },
  // Suspended monorail down one arterial (lib/monorail.mjs, MONORAIL_DEFAULTS); {} = defaults.
  monorail: {},
  // The waterfront (lib/waterfront.mjs WATERFRONT_DEFAULTS): quay railing, benches, berths, boats.
  waterfront: {},
  // Pedestrians: a loop down the middle of each downtown block's sidewalk (`inset` × the
  // edge's sidewalk width from the curb), one walker per `spacing` meters by district.
  walkers: { inset: 0.5, spacing: { core: 5, towers: 8 } },
  // Buildings on the island blocks outside the city, on lots about `lot` meters wide;
  // `lotGap` leaves yards; the mix goes from `near` (city) to `far` (waterfront).
  fringe: {
    lotGap: 0.05, setback: 1.5, lot: 30,
    near: { 'buildings/fringe_c': 1, 'buildings/fringe_d': 0.5, 'buildings/fringe_b': 1, 'buildings/fringe_e': 0.8, 'buildings/fringe_a': 0.5 },
    far: { 'buildings/fringe_a': 1.5, 'buildings/fringe_b': 1, 'buildings/fringe_e': 0.6, 'buildings/fringe_c': 0.3 },
    flyClear: 15, anchorClear: 150,
  },
  // Street furniture on sidewalks. Chances are per candidate slot; ids are asset ids.
  props: {
    kiosks: ['props/kiosk_a', 'props/kiosk_b'], kioskEvery: 45, kioskChance: { arterial: 0.35, hero: 0.5, secondary: 0.2 },
    guardrail: 'props/guardrail', guardrailChance: { arterial: 0.8, hero: 0.7, secondary: 0.5 },
    small: { 'props/cabinet': 3, 'props/bin': 4, 'props/vent': 1, 'props/bollard': 2 }, smallEvery: 16, smallChance: 0.55,
    clearLamp: 1.4, gap: 0.5,
  },
  // Flying-vehicle loops: ellipses around the city center at three altitudes, pushed out
  // around tall buildings and lifted where they still pass close to one.
  skyLanes: [
    { alt: 95, rx: 430, rz: 330, count: 5, speed: 32, direction: 1 },
    { alt: 150, rx: 260, rz: 200, center: [-190, 110], count: 4, speed: 40, direction: -1 },
    { alt: 230, rx: 540, rz: 420, count: 3, speed: 48, direction: 1 },
  ],
  // Enclosed bridges: skybridges between nearby towers, footbridges over core streets.
  bridges: {
    sky: { max: 7, perTower: 2, dist: [30, 95], height: [0.2, 0.5], width: 4.5, depth: 4.2 },
    foot: { max: 16, hero: 2, perRoad: 2, spacing: 70, floor: [6.5, 9.0], width: 3.2, depth: 3.0, overlap: 4 },
  },
  // Signs: see SIGN_DEFAULTS in lib/signs.mjs (override with params.signs).
};

/** Frontage priority: edges along bigger streets get first pick of buildings. */
const EDGE_PRIORITY = { hero: 0, arterial: 1, secondary: 2, edge: 3, alley: 4 };

export function generate({ params, seed, assets = {}, art = [] }) {
  const P = { ...DEFAULTS, ...params };
  // Nested option groups merge with their defaults instead of replacing them.
  for (const k of ['roads', 'sidewalks', 'lampSpacing', 'flythrough', 'bridges', 'props', 'fringe', 'landmarks', 'parking', 'island', 'walkers', 'monorail', 'waterfront']) P[k] = { ...DEFAULTS[k], ...(params[k] ?? {}) };
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
  // LOD variants (meta.lodOf) are swapped in at runtime by distance, never placed.
  const buildingIds = Object.keys(assets).filter((id) => assets[id].meta?.footprint && !assets[id].meta.lodOf && !assets[id].meta.landmark);
  const landmarkIds = Object.keys(assets).filter((id) => assets[id].meta?.footprint && !assets[id].meta.lodOf && assets[id].meta.landmark).sort();
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
  const parkBlocks = new Set();
  const discarded = [];
  const place = (id, box, rotationY, s, district, blockIndex, road, interior) => {
    const meta = assets[id].meta;
    // Park blocks still draw their buildings (same random draws as before) but keep none.
    (parkBlocks.has(blockIndex) ? discarded : instances).push({
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

  // ---- landmarks
  // The ordinary tower palette is capped lower; a handful of fixed-height landmark towers
  // get a unique crown/silhouette and a reserved tower-district block. They are excluded
  // from the weighted catalogue above so they cannot be repeated as ordinary towers.
  if (landmarkIds.length) {
    const candidates = blocks
      .map((block, bi) => {
        if (block.district !== 'towers') return null;
        const lot = G.inset(block.pts, (i) => P.sidewalks[tagClass(block.tags[i])]);
        if (!lot) return null;
        const c = G.centroid(lot);
        return { block, bi, lot, c, dist: G.dist(c, P.towers.center) };
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist);

    const used = new Set();
    const centers = [];
    for (const id of landmarkIds.slice(0, P.landmarks.count)) {
      const meta = assets[id].meta;
      const [fw, fd] = meta.footprint;
      let found = null;
      // Some seeds have no free block at full spacing for the last landmark; relax the spacing
      // rather than drop it (the default seed places all of them on the first pass).
      for (const relax of [1, 0.75, 0.5]) {
        if (found) break;
        for (const cand of candidates) {
          if (used.has(cand.bi)) continue;
          if (centers.some((c) => G.dist(c, cand.c) < P.landmarks.spacing * relax)) continue;
          const lot = cand.lot;
          let best = null;
          for (let i = 0; i < lot.length; i++) {
            const q0 = lot[i], q1 = lot[(i + 1) % lot.length];
            const L = G.dist(q0, q1);
            if (L < fw + 2) continue;
            const t = G.norm(G.sub(q1, q0));
            const nIn = G.perp(t);
            const u = G.mul(t, -1);
            const c = G.add(G.add(q0, G.mul(t, L / 2)), G.mul(nIn, fd / 2));
            const box = G.obb(c, u, fw / 2, fd / 2);
            if (!box.corners.every((p) => G.insideConvex(lot, p, 0.01))) continue;
            if (!best || L > best.L) best = { L, box, rotationY: Math.atan2(-nIn[0], -nIn[1]), road: cand.block.tags[i] === 'edge' ? -1 : cand.block.tags[i] };
          }
          if (best) { found = { cand, ...best, id }; break; }
        }
      }
      if (!found) continue;
      used.add(found.cand.bi);
      centers.push(found.cand.c);
      found.cand.block.landmark = found;
    }
  }

  // ---- parks: a few old-core blocks left open and planted (the dark tree masses of the Hong
  // Kong photos), away from the hero street and from each other. Own random stream.
  const parkRng = mulberry32((seed ^ 0x51a7e7ee) >>> 0);
  if (P.parks?.count) {
    const cands = blocks.map((b, bi) => ({ b, bi, a: G.area(b.pts) }))
      .filter(({ b, a }) => b.district === 'core' && !b.landmark && a >= P.parks.minArea && a <= P.parks.maxArea
        && !b.tags.some((t) => t !== 'edge' && roads[t].cls === 'hero'));
    while (parkBlocks.size < P.parks.count && cands.length) {
      const { b, bi } = cands.splice(Math.floor(parkRng() * cands.length), 1)[0];
      const c = G.centroid(b.pts);
      if ([...parkBlocks].some((j) => G.dist(G.centroid(blocks[j].pts), c) < P.parks.spacing)) continue;
      parkBlocks.add(bi);
      b.park = true;
    }
  }

  blocks.forEach((block, bi) => {
    const cfg = D[block.district];
    const lot = block.lot ?? (block.lot = G.inset(block.pts, (i) => P.sidewalks[tagClass(block.tags[i])]));
    if (!lot) return;
    const placed = [];
    if (block.landmark) {
      const l = block.landmark;
      const s = [1, 1, 1];
      place(l.id, l.box, l.rotationY, s, block.district, bi, l.road, false);
      placed.push(l.box);
    }
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

  // ---- street props on the sidewalk band between curb and building lots. Own random stream,
  // so adding or tuning props never moves signs, bridges or anything else.
  const props = placeProps(P.props, blocks, roads, lamps, P.sidewalks, tagClass, assets, mulberry32((seed ^ 0x9a0b5eed) >>> 0));
  const { trees, lamps: parkLamps } = plantParks(P.parks, blocks, parkBlocks, P.sidewalks, tagClass, assets, parkRng);
  if (lamps) lamps.push(...parkLamps);

  // ---- flythrough and bridges come before signs: bridges are structure, signs avoid them.
  const flythrough = hero ? buildFlythrough(hero, roads, instances, P, W, Dp) : undefined;
  if (flythrough) flythrough.points = liftClear(flythrough.points, instances, 5, 6);
  const bridges = buildBridges(P.bridges, instances, roads, [], lamps, hero, flythrough, rng);
  // ---- fringe: the low-rise far field around the city, clear of the flythrough and of the
  // port viewpoint. Own random stream, so it never moves anything inside the city.
  const portOrigin = [0, Dp / 2 + 60];
  const parked = parkedVehicles(blocks, roads, instances, props, lamps, assets, P.parking);
  const isle = buildIsland(P.island, P.fringe, W, Dp, roads, blocks, assets, flythrough, [portOrigin], P.lampSpacing,
    mulberry32((seed ^ 0x0f21a9e5) >>> 0));
  const fringe = isle.instances;
  roads.push(...isle.roads);
  lamps.push(...isle.lamps);
  // ---- waterfront: quay railing, benches, berths and boats. Own random stream.
  const waterfront = buildWaterfront(P.waterfront, isle.island, isle.lamps, portOrigin, assets, mulberry32((seed ^ 0x6b0a7c11) >>> 0));
  const skyLanes = buildSkyLanes(P.skyLanes, [...instances, ...fringe], bridges);
  for (const lane of skyLanes) lane.points = liftClear(lane.points, [...instances, ...fringe], 12, 14);
  const traffic = trafficLanes(roads.map((r) => ({ id: r.id, cls: r.cls, width: r.width, a: r.a.map(r3), b: r.b.map(r3) })), seed)
    .map((l) => ({ ...l, points: l.points.map((p) => p.map(r3)), stops: l.stops.map(([s, n, g, w]) => [r3(s), n, g, w]), speed: r3(l.speed), phase: r3(l.phase), length: r3(l.length) }));
  // Sidewalk loops for pedestrians (the runtime walks them; src/systems/vehicles.ts).
  const walkways = [];
  for (const b of blocks) {
    const spacing = P.walkers.spacing[b.district];
    if (!spacing) continue;
    const pts = G.inset(b.pts, (i) => (P.sidewalks[tagClass(b.tags[i])] ?? P.sidewalks.edge) * P.walkers.inset);
    if (!pts) continue;
    const L = pts.reduce((s, p, k) => s + G.dist(p, pts[(k + 1) % pts.length]), 0);
    const count = Math.floor(L / spacing);
    if (count > 0) walkways.push({ points: pts.map((p) => p.map(r3)), count });
  }
  // Signal heads: one per signalled approach, on the right-hand curb at the stop line, facing
  // the approaching cars: [x, z, rotationY, junction cycle offset (0..1), phase].
  const signals = [];
  for (const lane of traffic) {
    for (const [s, node, group, width] of lane.stops) {
      const p = trafficPose(lane, s);
      const curb = width / 2 - width * 0.22 + 0.7;   // lane centre → just onto the sidewalk
      const at = [p.x - Math.cos(p.angle) * curb, p.z + Math.sin(p.angle) * curb];
      if ([...lamps, ...signals].some((o) => Math.hypot(o[0] - at[0], o[1] - at[1]) < 1.2)) continue;
      signals.push([r3(at[0]), r3(at[1]), r3(p.angle + Math.PI), r3(signalOffset(node)), group]);
    }
  }
  const footBoxes = bridges.filter((b) => b.kind === 'foot').map((b) => ({
    box: G.obb(G.lerp(b.a, b.b, 0.5), G.norm(G.sub(b.b, b.a)), G.dist(b.a, b.b) / 2 + 0.5, b.width / 2 + 0.6),
    y0: b.y - 0.6, y1: b.y + b.depth + 0.6,
  }));
  const hitsBridge = (pos, rotationY, size) => {
    const sb = G.obb([pos[0], pos[2]], [Math.cos(rotationY), -Math.sin(rotationY)], size[0] / 2, size[2] / 2);
    return footBoxes.some((f) => pos[1] + size[1] / 2 > f.y0 && pos[1] - size[1] / 2 < f.y1 && G.obbOverlap(f.box, sb, 0));
  };

  // ---- signs (lib/signs.mjs): every sign belongs to a tenant of its building at the tenant's
  // floor, or to a brand on a roof or tower. Street frontages first (they win the clash pass).
  const S = signParams(params.signs);
  const placer = createSignPlacer({ S, seed, assets, art: art ?? [], hitsBridge });
  const signs = placer.signs;
  instances.forEach((inst, index) => {
    if (inst.interior || inst.road < 0) return;
    const onHero = hero && inst.road === hero.id;
    const cfg = onHero ? S.hero : inst.district === 'core' ? S.core : null;
    if (cfg) placer.street(inst, index, cfg, 'ja');
  });
  instances.forEach((inst, index) => {
    if (inst.interior || inst.road < 0) return;
    placer.building(inst, index, hero && inst.road === hero.id);
  });

  // ---- clash pass: drop any sign overlapping an earlier sign, reaching into a building
  // other than its own (narrow alleys, corners, neighbors' walls), or hanging within 2.5 m of
  // the flythrough (the camera flies under the canyon's blades, never through them).
  const bld = instances.map((i) => ({ box: instanceBox(i), h: i.h }));
  const flyPts = sampleFlythrough(flythrough);
  const nearFly = (box, y0, y1) => flyPts.some((p) => p[1] > y0 - 2.5 && p[1] < y1 + 2.5 &&
    Math.abs(p[0] - box.c[0]) < 60 && Math.abs(p[2] - box.c[1]) < 60 &&
    G.insideConvex(G.obb(box.c, box.u, box.hu + 2.5, box.hv + 2.5).corners, [p[0], p[2]]));
  const kept = [];
  const clashPass = (list, buildings) => {
    for (const s of list) {
      const r = s.rotationY;
      const box = G.obb([s.position[0], s.position[2]], [Math.cos(r), -Math.sin(r)], s.size[0] / 2 + 0.15, s.size[2] / 2 + 0.15);
      const y0 = s.position[1] - s.size[1] / 2, y1 = s.position[1] + s.size[1] / 2;
      const clashSign = kept.some((k) => k.y0 < y1 + 0.2 && k.y1 > y0 - 0.2 && G.dist(k.box.c, box.c) < 40 && G.obbOverlap(k.box, box, 0));
      const clashBld = !clashSign && buildings && bld.some((b, k) => k !== s.building && b.h > y0 && G.dist(b.box.c, box.c) < 120 && G.obbOverlap(b.box, box, 0.05));
      if (!clashSign && !clashBld && !nearFly(box, y0 - (s.legs ?? 0), y1)) kept.push({ s, box, y0, y1 });
    }
    signs.length = 0;
    for (const k of kept) signs.push(k.s);
  };
  clashPass([...signs], true);

  // Island band (last, so it never shifts the city's random stream): shops along the ring road and avenues, a few on quiet streets.
  fringe.forEach((inst, index) => {
    const cfg = S.island[inst.frontage];
    if (cfg) placer.street(inst, instances.length + index, cfg, 'zh', inst.scale);
  });
  // Island signs clash with each other too (stacked overhangs reach far over the street).
  clashPass(signs.slice(kept.length), false);

  // ---- monorail (after everything that draws random numbers, so the city comes out the same):
  // the line, its station and pieces, then whatever stands in its way is removed.
  const monorail = buildMonorail(P.monorail, roads, blocks, districtAt, P.towers.center, assets);
  if (monorail) {
    const fp = (i) => i.fp ?? (assets[i.asset]?.meta?.footprint ?? [1, 1]).map((v) => v / 2);
    const onGround = (i) => hitsGround(monorail, i.position[0], i.position[2], i.rotationY, ...fp(i));
    const drop = (list, hit) => { const keep = list.filter((x) => !hit(x)); list.length = 0; list.push(...keep); };
    drop(lamps, ([x, z]) => hitsGround(monorail, x, z, 0, 0.4, 0.4));
    drop(props, onGround);
    drop(trees, onGround);
    drop(parked, onGround);
    drop(signals, ([x, z]) => hitsGround(monorail, x, z, 0, 0.3, 0.3));
    drop(signs, (s) => hitsEnvelope(monorail, s.position, s.rotationY, [s.size[0] + 2 * (s.arm ?? 0) + 0.3, s.size[1] + (s.legs ?? 0) * 2, s.size[2] + 0.3]));
    drop(bridges, (b) => {
      const d = G.sub(b.b, b.a), c = G.lerp(b.a, b.b, 0.5);
      return hitsEnvelope(monorail, [c[0], b.y + b.depth / 2, c[1]], Math.atan2(-d[1], d[0]), [G.len(d), b.depth, b.width]);
    });
  }


  // ---- anchors: named frames for viewpoints ({ origin, x }: x is the frame's forward axis on the ground)
  const coreCenter = centroidOf(blocks.filter((b) => b.district === 'core').map((b) => G.centroid(b.pts))) ?? [0, 0];
  const heroDir = hero ? G.norm(G.sub(hero.b, hero.a)) : [1, 0];
  const anchors = {
    center: { origin: [0, 0, 0], x: [1, 0] },
    hero: hero ? { origin: [r3(hero.a[0]), 0, r3(hero.a[1])], x: heroDir.map(r3) } : { origin: [0, 0, 0], x: [1, 0] },
    core: { origin: [r3(coreCenter[0]), 0, r3(coreCenter[1])], x: G.norm(G.sub(P.towers.center, coreCenter)).map(r3) },
    towers: { origin: [P.towers.center[0], 0, P.towers.center[1]], x: G.norm(G.sub(P.towers.center, coreCenter)).map(r3) },
    port: { origin: [portOrigin[0], 0, portOrigin[1]], x: G.norm(G.sub(P.towers.center, portOrigin)).map(r3) },
  };
  if (monorail) {
    const st = G.add(monorail.origin, G.mul(monorail.dir, monorail.station.s));
    anchors.monorail = { origin: [r3(st[0]), 0, r3(st[1])], x: monorail.dir.map((c) => r3(c * monorail.station.flip)) };
    // Further stations: monorail2, monorail3, ... in route order after the first.
    monorail.stations.filter((x) => x.s !== monorail.station.s).forEach((x, i) => {
      const p = G.add(monorail.origin, G.mul(monorail.dir, x.s));
      anchors[`monorail${i + 2}`] = { origin: [r3(p[0]), 0, r3(p[1])], x: monorail.dir.map((c) => r3(c * x.flip)) };
    });
  }
  if (parked.length) anchors.delivery = { origin: parked[0].position, x: [Math.sin(parked[0].rotationY), Math.cos(parked[0].rotationY)] };

  return {
    version: 2,
    generator: 'city',
    seed,
    size: [W, Dp],
    districts: { towers: P.towers, portZ: P.portZ },
    roads: roads.map((r) => ({ id: r.id, cls: r.cls, width: r.width, a: r.a.map(r3), b: r.b.map(r3) })),
    blocks: [...blocks, ...isle.blocks].map((b) => ({ district: b.district, points: b.pts.map((p) => p.map(r3)), edges: b.tags.map((t) => (typeof t === 'number' ? t : -1)) })),
    hero: hero ? { road: hero.id, width: hero.width, a: hero.a.map(r3), b: hero.b.map(r3) } : null,
    lamps,
    props,
    trees,
    signs,
    anchors,
    instances,
    fringe,
    parked,
    quay: waterfront.props,
    boats: waterfront.boats,
    island: isle.island,
    flythrough,
    bridges,
    traffic,
    signals,
    walkways,
    skyLanes,
    monorail,
  };
}
