// Suspended monorail (Chiba style) down one arterial of the city layout: a straight line of
// T-piers in a median, twin box girders, stations (`station.count`) with side platforms under a
// roof on portal frames, a pedestrian deck and open stairs. Also the trains' timetable, a pure
// function of time shared with the runtime (src/systems/vehicles.ts).
//
// Route frame: s runs along the route from its far end toward the tower district, v across it
// (v > 0 on the left, G.perp of the direction). Station pieces are built in the station's
// frame (u = s - station centre) by art/generators/props/monorail.py, which reads the same
// numbers from its defs; tests/unit/monorail.test.ts checks that the two agree.
// Browser-safe: no Node APIs.
import * as G from './geom.mjs';
import { r3 } from './util.mjs';

/** Six decimals: the route frame must place pieces 500 m away to the millimetre. */
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export const MONORAIL_DEFAULTS = {
  enabled: true,
  /** Raised median under the piers (m wide), stopping `medianGap` short of each junction. */
  median: 2.4, medianGap: 1.5,
  /** Pier spacing, the clearance kept between a pier and a junction's edge, the longest span allowed. */
  pierEvery: 30, junctionClear: 3, maxSpan: 52,
  /** Girder underside, track offset from the centre line, car floor (= platform top), station roof underside. */
  beamY: 11.7, beamH: 1.7, trackV: 2.6, floorY: 8.05, roofY: 14.6,
  /** Train: car length, gap, count, nose length beyond the end cars, half width. */
  car: { length: 14.5, gap: 0.5, count: 3, nose: 2.2, halfWidth: 1.3 },
  /** Timetable (m/s, m/s², s). `frozenStop`: a train stands at the station at this time (the shots' frozen clock). */
  timetable: { cruise: 16, accel: 0.9, dwell: 12, turn: 20, frozenStop: 12 },
  station: {
    /** Portal frames every `bay` m over `bays` bays; legs at |v| = legV on the sidewalks. */
    bays: 4, bay: 17, legV: 13.5,
    /** The deck spans this many bays in the middle of the station. */
    deckBays: 2,
    /** Platforms between |v| = platform[0] and platform[1]; the deck on the +v side at deckY between deckV. */
    platform: [4.05, 7.8], deckY: 5.6, deckV: [13.3, 17.3],
    /** Ground footprint kept clear of lamps, props and parked cars, |u| up to this. */
    clearU: 50,
    /** Junctions of these classes may not pass under the station (side streets may end under it). */
    noJunction: ['arterial', 'hero'],
    /** Stations on the line, at least `spacing` m apart (centre to centre). The first stands in
     * the old core nearest the middle of the line; each further one in the middle of the longest
     * stretch without a stop, in the core or the tower district. */
    count: 2, spacing: 180,
  },
  /** Asset ids of the static pieces. */
  assets: {
    pier: 'props/monorail_pier', girder: 'props/monorail_girder', median: 'props/monorail_median',
    platformN: 'props/monorail_platform_n', platformS: 'props/monorail_platform_s',
    screensN: 'props/monorail_screens_n', screensS: 'props/monorail_screens_s',
    roof: 'props/monorail_roof', portal: 'props/monorail_portal', deck: 'props/monorail_deck',
    accessN: 'props/monorail_access_n', accessS: 'props/monorail_access_s', deckStairs: 'props/monorail_deck_stairs',
    carEnd: 'vehicles/monorail_end', carMid: 'vehicles/monorail_mid',
  },
};

/** Girder span length the girder asset is built at (scaled to each pier gap). */
const GIRDER_SPAN = 30;

/**
 * Pick the route: the arterial with the most length in the old core, weighted toward one that
 * points at the tower district, so the towers close the view down the line. Oriented so s runs
 * toward the towers.
 */
export function chooseRoute(roads, districtAt, towersCenter) {
  let best = null;
  for (const r of roads) {
    if (r.cls !== 'arterial') continue;
    const L = G.dist(r.a, r.b);
    let core = 0;
    for (let k = 0; k < 40; k++) if (districtAt(G.lerp(r.a, r.b, (k + 0.5) / 40)) === 'core') core++;
    const nearB = G.dist(r.b, towersCenter) < G.dist(r.a, towersCenter);
    const [a, b] = nearB ? [r.a, r.b] : [r.b, r.a];
    const aim = G.dot(G.norm(G.sub(b, a)), G.norm(G.sub(towersCenter, b)));
    const score = L * (core / 40) * (0.6 + 0.4 * Math.max(0, aim));
    if (!best || score > best.score) best = { road: r, a, b, score };
  }
  return best;
}

/** Junctions along the route: [s centre, half length along s, road class], sorted. */
export function routeJunctions(route, roads) {
  const { a, b, road } = route;
  const d = G.norm(G.sub(b, a)), n = G.perp(d), L = G.dist(a, b);
  const out = [];
  for (const r of roads) {
    if (r.id === road.id) continue;
    const rd = G.norm(G.sub(r.b, r.a));
    const sin = Math.max(0.3, Math.abs(G.cross(rd, d)));
    const half = r.width / 2 / sin;
    // A road ending on the route (T-junction) or crossing it.
    for (const p of [r.a, r.b]) {
      const s = G.dot(G.sub(p, a), d), v = G.dot(G.sub(p, a), n);
      if (Math.abs(v) < road.width / 2 + 2 && s > -half && s < L + half) out.push([s, half, r.cls]);
    }
    // Crossing: both segments' parameters strictly inside (ends are handled above).
    const R = G.sub(b, a), Q = G.sub(r.b, r.a), den = G.cross(R, Q);
    if (Math.abs(den) > 1e-9) {
      const t = G.cross(G.sub(r.a, a), Q) / den, u = G.cross(G.sub(r.a, a), R) / den;
      if (t > 0 && t < 1 && u > 0.02 && u < 0.98) out.push([t * L, half, r.cls]);
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  return out.filter((j, k) => k === 0 || Math.abs(j[0] - out[k - 1][0]) > 0.5);
}

/**
 * The monorail: route, piers, medians, station and every static piece as instances. `blocks`
 * are the city's sidewalk polygons (block outlines); ground parts must stand inside them.
 * Returns null when no arterial qualifies or no station site fits.
 */
export function buildMonorail(cfg, roads, blocks, districtAt, towersCenter, assets) {
  const C = { ...MONORAIL_DEFAULTS, ...cfg, car: { ...MONORAIL_DEFAULTS.car, ...cfg.car }, timetable: { ...MONORAIL_DEFAULTS.timetable, ...cfg.timetable }, station: { ...MONORAIL_DEFAULTS.station, ...cfg.station }, assets: { ...MONORAIL_DEFAULTS.assets, ...cfg.assets } };
  if (!C.enabled) return null;
  const A = C.assets;
  if (!Object.values(A).every((id) => assets[id])) return null;
  const route = chooseRoute(roads, districtAt, towersCenter);
  if (!route) return null;
  const { a, b, road } = route;
  const d = G.norm(G.sub(b, a)), n = G.perp(d), L = G.dist(a, b);
  const angle = Math.atan2(-d[1], d[0]);   // rotationY that turns an asset's +x along the route
  const at = (s, v) => G.add(G.add(a, G.mul(d, s)), G.mul(n, v));
  const half = road.width / 2;
  const junctions = routeJunctions(route, roads);
  const inJunction = (s, pad) => junctions.some(([js, jh]) => Math.abs(s - js) < jh + pad);
  const onSidewalk = (s, v) => blocks.some((bl) => G.insideConvex(bl.pts, at(s, v), 0.05));

  // ---- piers: about every pierEvery m (18–40 m), never in a junction; the line runs between
  // the end piers, which stand just inside the junctions at the route's ends.
  const first = Math.max(...junctions.filter(([js]) => js < 20).map(([js, jh]) => js + jh + C.junctionClear + 3), 8);
  const last = Math.min(...junctions.filter(([js]) => js > L - 20).map(([js, jh]) => js - jh - C.junctionClear - 3), L - 8);
  const free = (p) => !inJunction(p, C.junctionClear);
  let p = first;
  while (p < last && !free(p)) p += 0.5;
  const piers = p < last ? [p] : [];
  while (piers.length) {
    const target = p + C.pierEvery;
    let best = null;
    for (let q = p + 18; q <= Math.min(p + 40, last) + 1e-6; q += 0.5) {
      if (free(q) && (best === null || Math.abs(q - target) < Math.abs(best - target))) best = q;
    }
    // A wide junction (or two close together) may need a longer span.
    for (let q = p + 40.5; best === null && q <= Math.min(p + C.maxSpan, last) + 1e-6; q += 0.5) if (free(q)) best = q;
    if (best === null || (target > last && last - p < 18)) break;
    if (target > last) {   // the end pier: as far out as the last junction allows
      for (let q = last; q >= p + 12; q -= 0.5) if (free(q)) { best = q; break; }
    }
    piers.push(best);
    p = best;
  }
  if (piers.length < 4) return null;

  // ---- station: every piece is built in the station's frame (u along, v across, origin at its
  // centre); repeated pieces sit at offsets along u. Each declares where it touches the ground
  // (meta.ground: [u0, u1, v0, v1] rects), which must lie on sidewalks; no main road may pass
  // under it, and it stays clear of the end piers. The station may stand either way round
  // (`flip` -1 turns it, putting the deck on the -v side). Nearest the middle of the line wins.
  const S = C.station, len = S.bays * S.bay, legs = [];
  for (let k = 0; k <= S.bays; k++) legs.push(-len / 2 + k * S.bay);
  const bayCentres = legs.slice(1).map((u) => u - S.bay / 2);
  const deckCentres = bayCentres.filter((u) => Math.abs(u) < S.deckBays * S.bay / 2);
  const stationParts = [
    ...[A.platformN, A.platformS, A.screensN, A.screensS, A.accessN, A.accessS, A.deckStairs].map((id) => [id, 0]),
    ...legs.map((u) => [A.portal, u]),
    ...bayCentres.map((u) => [A.roof, u]),
    ...deckCentres.map((u) => [A.deck, u]),
  ];
  const groundRects = stationParts.flatMap(([id, u]) => (assets[id].meta.ground ?? []).map(([u0, u1, v0, v1]) => [u0 + u, u1 + u, v0, v1]));
  const groundPoints = (sc, flip) => groundRects.flatMap(([u0, u1, v0, v1]) => {
    const pts = [];
    const nu = Math.max(1, Math.ceil((u1 - u0) / 2));
    for (let i = 0; i <= nu; i++) for (const v of [v0, v1]) pts.push([sc + flip * (u0 + (u1 - u0) * i / nu), flip * v]);
    return pts;
  });
  const reach = Math.max(len / 2 + 1, ...groundRects.map(([u0, u1]) => Math.max(-u0, u1))) + 2;
  const fits = (sc, districts) => {
    if (sc - reach < piers[0] + 20 || sc + reach > piers[piers.length - 1] - 20) return undefined;
    if (junctions.some(([js, jh, cls]) => S.noJunction.includes(cls) && Math.abs(js - sc) < len / 2 + jh + 2)) return undefined;
    if (!districts.includes(districtAt(at(sc, 0)))) return undefined;
    return [1, -1].find((k) => groundPoints(sc, k).every(([s, v]) => onSidewalk(s, v)));
  };
  /** The site nearest `target` (`step` m outward) that fits and keeps `spacing` from `taken`.
   * Side streets every 40-50 m leave windows of a metre or two where every leg and stair lands
   * on a sidewalk, so further stations search finely; the first keeps its original 1 m steps. */
  const nearest = (target, districts, taken, step = 1) => {
    for (let off = 0; off < L; off += step) {
      for (const sc of off ? [target - off, target + off] : [target]) {
        if (taken.some((t) => Math.abs(t.s - sc) < S.spacing)) continue;
        const f = fits(sc, districts);
        if (f !== undefined) return { s: sc, flip: f };
      }
    }
    return null;
  };
  const mid = (piers[0] + piers[piers.length - 1]) / 2;
  const home = nearest(mid, ['core'], []);
  if (home === null) return null;
  const stations = [home];
  while (stations.length < S.count) {
    // The middle of the longest stretch between stops (the line's end piers count as stops).
    const stops = [piers[0], ...stations.map((t) => t.s).sort((x, y) => x - y), piers[piers.length - 1]];
    let gap = 0;
    for (let k = 1; k < stops.length; k++) if (stops[k] - stops[k - 1] > stops[gap + 1] - stops[gap]) gap = k - 1;
    const next = nearest((stops[gap] + stops[gap + 1]) / 2, ['core', 'towers'], stations, 0.25);
    if (next === null) break;
    stations.push(next);
  }
  const station = home.s, flip = home.flip;

  // ---- static pieces
  const parts = [];
  const put = (asset, s, v, y = 0, rot = 0, scale = 1) => {
    const p = at(s, v);
    parts.push({ asset, position: [r3(p[0]), r3(y), r3(p[1])], rotationY: r3(angle + rot), scale: Array.isArray(scale) ? scale.map(r3) : scale });
  };
  for (const p of piers) put(A.pier, p, 0);
  for (let k = 0; k + 1 < piers.length; k++) put(A.girder, (piers[k] + piers[k + 1]) / 2, 0, 0, 0, [(piers[k + 1] - piers[k]) / GIRDER_SPAN, 1, 1]);
  // Medians between junctions, out to the end piers: the free stretches between merged
  // junction intervals (a wide junction may overlap its narrow neighbours).
  const blocked = junctions.map(([js, jh]) => [js - jh - C.medianGap, js + jh + C.medianGap]).sort((x, y) => x[0] - y[0]);
  const medians = [];
  let from = piers[0] - 6;
  const end = piers[piers.length - 1] + 6;
  for (const [b0, b1] of [...blocked, [end, end]]) {
    const to = Math.min(b0, end);
    if (to - from > 4) medians.push([from, to]);
    from = Math.max(from, b1);
  }
  for (const [s0, s1] of medians) put(A.median, (s0 + s1) / 2, 0, 0, 0, [s1 - s0, 1, 1]);
  // Stations: platforms, screens and the stairs span each; portals, roof bays and deck segments repeat.
  for (const st of stations) for (const [id, u] of stationParts) put(id, st.s + st.flip * u, 0, 0, st.flip > 0 ? 0 : Math.PI);

  // ---- light it through the lamp map (src/scene/lampmap.ts): [x, z, radius, strength].
  const lights = [];
  const sA = piers[0], sB = piers[piers.length - 1];
  for (let s = sA + 5; s < sB; s += 10) for (const v of [-C.trackV - 0.9, C.trackV + 0.9]) { const p = at(s, v); lights.push([r3(p[0]), r3(p[1]), 7, 0.1]); }
  for (const s of piers) { const p = at(s, 0); lights.push([r3(p[0]), r3(p[1]), 4, 0.3]); }
  for (const st of stations) {
    for (let u = -len / 2 + 3; u <= len / 2 - 3; u += 6) {
      for (const v of [-6, 6]) { const p = at(st.s + u, v); lights.push([r3(p[0]), r3(p[1]), 9, 0.22]); }
      if (Math.abs(u) < S.deckBays * S.bay / 2) { const p = at(st.s + u, st.flip * (S.deckV[0] + S.deckV[1]) / 2); lights.push([r3(p[0]), r3(p[1]), 6, 0.3]); }
    }
  }

  // ---- what the line displaces: 3D boxes in the route frame ([s0, s1], [v0, v1], [y0, y1]).
  const env = [
    // Girders, cars and their hangers along the whole line.
    { s: [sA - 3, sB + 3], v: [-C.trackV - C.car.halfWidth - 0.8, C.trackV + C.car.halfWidth + 0.8], y: [C.floorY - 0.6, C.beamY + C.beamH + 1.4] },
    // Each station and its stairs, from the ground to above the portal beams.
    ...stations.map((st) => ({ s: [st.s - reach, st.s + reach], v: st.flip > 0 ? [-S.legV - 1.4, S.deckV[1] + 0.25] : [-S.deckV[1] - 0.25, S.legV + 1.4], y: [0, C.roofY + 2] })),
  ];
  // On the ground: each station's sidewalk band (lamps, props, parked cars, signals, trees).
  const ground = [
    ...stations.flatMap((st) => [
      { s: [st.s - S.clearU, st.s + S.clearU], v: [-half - 6, -half + 0.01] },
      { s: [st.s - S.clearU, st.s + S.clearU], v: [half - 0.01, half + 6] },
    ]),
    { s: [sA - 3, sB + 3], v: [-C.median / 2 - 0.6, C.median / 2 + 0.6] },
  ];

  // ---- trains: one per girder, shuttling between the end piers and stopping at every station.
  const trainLen = C.car.count * (C.car.length + C.car.gap) - C.car.gap + 2 * C.car.nose;
  const ends = [sA + trainLen / 2 + 1.5, sB - trainLen / 2 - 1.5];
  return {
    road: road.id,
    origin: a.map(r6), dir: d.map(r6), angle: r6(angle), length: r3(L),
    beamY: C.beamY, floorY: C.floorY, roofY: C.roofY, trackV: C.trackV,
    piers: piers.map(r3), medians: medians.map((m) => m.map(r3)),
    // `station`: the first (the anchor and viewpoints use it); `stations`: all of them, along s.
    station: { s: r3(station), flip, length: len, legs, platform: S.platform, deckY: S.deckY, deckV: S.deckV, legV: S.legV },
    stations: [...stations].sort((x, y) => x.s - y.s).map((st) => ({ s: r3(st.s), flip: st.flip })),
    parts, lights,
    envelope: env.map((e) => ({ s: e.s.map(r3), v: e.v.map(r3), y: e.y.map(r3) })),
    ground: ground.map((e) => ({ s: e.s.map(r3), v: e.v.map(r3) })),
    trains: {
      ends: ends.map(r3), car: C.car, ...C.timetable,
      assets: [A.carEnd, A.carMid, A.carEnd],
    },
  };
}

/** Route-frame coordinates [s, v] of a world point. */
export function toRoute(m, x, z) {
  const dx = x - m.origin[0], dz = z - m.origin[1];
  return [dx * m.dir[0] + dz * m.dir[1], -dx * m.dir[1] + dz * m.dir[0]];
}

/** True if a world-space box (centre, rotation, size) reaches into any of the monorail's 3D envelopes. */
export function hitsEnvelope(m, pos, rotationY, size) {
  const box = G.obb([pos[0], pos[2]], [Math.cos(rotationY), -Math.sin(rotationY)], size[0] / 2, size[2] / 2);
  const y0 = pos[1] - size[1] / 2, y1 = pos[1] + size[1] / 2;
  return m.envelope.some((e) => y1 > e.y[0] && y0 < e.y[1] && G.obbOverlap(envBox(m, e), box, 0));
}

/** True if a ground footprint (centre, rotation, half extents) overlaps the monorail's ground clearance. */
export function hitsGround(m, x, z, rotationY = 0, hu = 0.3, hv = 0.3) {
  const box = G.obb([x, z], [Math.cos(rotationY), -Math.sin(rotationY)], hu, hv);
  return m.ground.some((e) => G.obbOverlap(envBox(m, e), box, 0));
}

function envBox(m, e) {
  const s = (e.s[0] + e.s[1]) / 2, v = (e.v[0] + e.v[1]) / 2;
  const c = [m.origin[0] + m.dir[0] * s - m.dir[1] * v, m.origin[1] + m.dir[1] * s + m.dir[0] * v];
  return G.obb(c, m.dir, (e.s[1] - e.s[0]) / 2, (e.v[1] - e.v[0]) / 2);
}

/** Distance covered after time t on a run of length D (accelerate, cruise, brake to a stop). */
function runDistance(D, vmax, acc, t) {
  const ta = Math.min(vmax / acc, Math.sqrt(D / acc));   // time to top speed (or to half way)
  const v = acc * ta, da = 0.5 * acc * ta * ta, tc = (D - 2 * da) / v;
  if (t <= 0) return 0;
  if (t < ta) return 0.5 * acc * t * t;
  if (t < ta + tc) return da + v * (t - ta);
  const tb = Math.min(t - ta - tc, ta);
  return D - 0.5 * acc * (ta - tb) * (ta - tb);
}
function runTime(D, vmax, acc) {
  const ta = Math.min(vmax / acc, Math.sqrt(D / acc));
  return 2 * ta + (D - acc * ta * ta) / (acc * ta);
}

/**
 * Train `k` (0 or 1) at `time`: its middle's position s along the route, the side v of its
 * girder and the direction it faces (+1 toward the route's end). Each train shuttles between
 * the end piers on its own girder and stops at every station both ways; the second train runs
 * half a cycle behind. A pure function of time, so frozen times stay reproducible.
 */
export function trainAt(m, k, time) {
  const T = m.trains, [sA, sB] = T.ends;
  const halts = (m.stations ?? [m.station]).map((st) => st.s);
  // Out from sA through every station to sB and back: a dwell at stations, a turn at the ends.
  const path = [sA, ...halts, sB, ...[...halts].reverse(), sA];
  const legs = path.slice(1).map((q, i) => [path[i], q]);
  const runs = legs.map(([p, q]) => runTime(Math.abs(q - p), T.cruise, T.accel));
  const stops = legs.map(([, q]) => (q === sA || q === sB ? T.turn : T.dwell));
  const cycle = runs.reduce((x, y) => x + y, 0) + stops.reduce((x, y) => x + y, 0);
  // Train 0 stands mid-dwell at the first station (m.station) at `frozenStop` on its way out,
  // beside that station's south platform (station frame v < 0).
  let toStop = 0;
  for (let i = 0; i < legs.length; i++) {
    toStop += runs[i];
    if (legs[i][1] === m.station.s) break;
    toStop += stops[i];
  }
  const shift = toStop + T.dwell / 2 - T.frozenStop;
  const side = (k ? 1 : -1) * (m.station.flip ?? 1) * m.trackV;
  let t = ((((time + shift + k * cycle / 2) % cycle) + cycle) % cycle);
  for (let i = 0; i < legs.length; i++) {
    const [p, q] = legs[i], dir = Math.sign(q - p);
    if (t < runs[i]) return { s: p + dir * runDistance(Math.abs(q - p), T.cruise, T.accel, t), v: side, dir };
    t -= runs[i];
    if (t < stops[i]) return { s: q, v: side, dir };
    t -= stops[i];
  }
  return { s: sA, v: side, dir: 1 };
}

/** World pose of each car of train `k`: [x, y, z, rotationY] per car, in `trains.assets` order. */
export function trainCars(m, k, time) {
  const { s, v, dir } = trainAt(m, k, time);
  const c = m.trains.car, pitch = c.length + c.gap, n = c.count;
  const out = [];
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * pitch * dir;
    const ss = s + off, x = m.origin[0] + m.dir[0] * ss - m.dir[1] * v, z = m.origin[1] + m.dir[1] * ss + m.dir[0] * v;
    // End cars carry their nose at +x: the leading car faces the direction of travel, the trailing one away.
    const rot = m.angle + (i === n - 1 ? (dir > 0 ? 0 : Math.PI) : i === 0 ? (dir > 0 ? Math.PI : 0) : 0);
    out.push([x, m.floorY, z, rot]);
  }
  return out;
}
