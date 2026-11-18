// The waterfront: a railing along the quay edge, benches facing the water, and boats. A few
// berths near the port break the railing for mooring posts and a boat tied up alongside; more
// boats lie at anchor off the port. Runs in Node and the browser (no Node APIs).
import * as G from './geom.mjs';
import { coastDistance, coastline } from './island.mjs';
import { r3 } from './util.mjs';

/** Defaults; art/layouts/city.mjs merges its `waterfront` params over them. */
export const WATERFRONT_DEFAULTS = {
  rail: 'props/quay_rail', railLength: 6, railInset: 0.35,
  bench: 'props/bench', benchEvery: 27, benchInset: 4.5,
  mooring: 'props/mooring', mooringEvery: 9, mooringInset: 0.6,
  // Berths: [asset, weight]; the first berth takes `ferry` if it fits.
  ferry: 'vehicles/boat_ferry', boats: { 'vehicles/boat_work_a': 1, 'vehicles/boat_work_b': 1 },
  berths: 4, berthLength: 40, berthSpacing: 70, berthReach: 520,
  // Boats at anchor: count, distance off the quay (m), and how far along the coast from the port.
  anchored: 7, offshore: [70, 320], anchorReach: 700, anchorSpacing: 45,
};

/** Coast polygon walked by arc length: point, unit direction and outward normal at s. */
function walker(coast, island) {
  const n = coast.length, cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + G.dist(coast[i], coast[(i + 1) % n]));
  const total = cum[n];
  // Outward normal of a CCW polygon is (dz, -dx); check against the coast distance once.
  const d0 = G.norm(G.sub(coast[1], coast[0]));
  const mid0 = G.mul(G.add(coast[0], coast[1]), 0.5);
  const sign = coastDistance(mid0[0] + d0[1], mid0[1] - d0[0], island) > 0 ? 1 : -1;
  let i = 0;
  const at = (s) => {
    s = ((s % total) + total) % total;
    if (s < cum[i] || s > cum[i + 1]) {
      i = 0;
      while (cum[i + 1] < s) i++;
    }
    const a = coast[i], b = coast[(i + 1) % n];
    const d = G.norm(G.sub(b, a));
    return { p: G.add(a, G.mul(d, s - cum[i])), d, n: [sign * d[1], -sign * d[0]] };
  };
  return { at, total };
}

/**
 * Waterfront furniture and boats. `island` as buildIsland returns it, `lamps` the placed lamps
 * (benches keep clear of them), `port` the port's [x, z]. Returns { props, boats }.
 */
export function buildWaterfront(params, island, lamps, port, assets, rng) {
  const cfg = { ...WATERFRONT_DEFAULTS, ...params };
  const has = (id) => !!assets[id];
  const coast = coastline(island);
  const { at, total } = walker(coast, island);
  const props = [], boats = [];
  // fp: half the footprint (x along the asset, z across), as the city's other instances carry it.
  const inst = (asset, p, y, rotationY, sx = 1) => {
    const [w, d] = assets[asset]?.meta?.footprint ?? [1, 1];
    const i = { asset, position: [r3(p[0]), r3(y), r3(p[1])], rotationY: r3(rotationY), scale: 1, fp: [r3((w * sx) / 2), r3(d / 2)] };
    if (Math.abs(sx - 1) > 0.002) i.scale = [r3(sx), 1, 1];
    return i;
  };
  // Local +Z of an asset faces this way (atan2 of the facing direction).
  const facing = (v) => Math.atan2(v[0], v[1]);
  const water = island.water;

  // ---- berths: arc positions nearest the port, spaced apart.
  let portS = 0, best = Infinity;
  for (let s = 0; s < total; s += 4) {
    const q = G.dist(at(s).p, port);
    if (q < best) { best = q; portS = s; }
  }
  const berths = [];
  const reach = cfg.berthReach / 2;
  const tries = [];
  for (let k = 0; k < cfg.berths * 6; k++) tries.push(portS + (rng() * 2 - 1) * reach);
  for (const s of tries) {
    if (berths.length >= cfg.berths) break;
    if (berths.some((b) => Math.abs(b - s) < cfg.berthSpacing)) continue;
    berths.push(s);
  }
  berths.sort((a, b) => Math.abs(a - portS) - Math.abs(b - portS));
  const inBerth = (s, pad = 0) => berths.some((b) => Math.abs(s - b) < cfg.berthLength / 2 + pad);

  // ---- railing: whole segments along the edge, broken at the berths.
  if (has(cfg.rail)) {
    for (let s = 0; s + cfg.railLength <= total; s += cfg.railLength) {
      if (inBerth(s + cfg.railLength / 2, cfg.railLength / 2)) continue;
      const a = at(s), b = at(s + cfg.railLength);
      const pa = G.sub(a.p, G.mul(a.n, cfg.railInset)), pb = G.sub(b.p, G.mul(b.n, cfg.railInset));
      const d = G.sub(pb, pa);
      const len = Math.hypot(d[0], d[1]);
      // Chords on the curved coast are a little shorter than the segment: x scale closes the gap.
      props.push(inst(cfg.rail, G.mul(G.add(pa, pb), 0.5), 0.15, Math.atan2(-d[1], d[0]), len / cfg.railLength));
    }
  }

  // ---- benches facing the water, clear of lamps and berths.
  if (has(cfg.bench)) {
    for (let s = cfg.benchEvery / 2; s < total; s += cfg.benchEvery) {
      if (inBerth(s, 4)) continue;
      const w = at(s);
      const p = G.sub(w.p, G.mul(w.n, cfg.benchInset));
      if (lamps.some(([x, z]) => Math.abs(x - p[0]) < 4 && Math.abs(z - p[1]) < 4)) continue;
      props.push(inst(cfg.bench, p, 0.15, facing(w.n)));
    }
  }

  // ---- berths: mooring posts on the edge and a boat alongside, bow along the coast.
  const pick = () => {
    const ids = Object.keys(cfg.boats).filter(has);
    let r = rng() * ids.reduce((t, id) => t + cfg.boats[id], 0);
    for (const id of ids) if ((r -= cfg.boats[id]) <= 0) return id;
    return ids[ids.length - 1];
  };
  const beam = (id) => (assets[id]?.meta?.footprint ?? [4, 12])[0];
  berths.forEach((s, k) => {
    for (let m = -cfg.berthLength / 2 + 2; m <= cfg.berthLength / 2 - 2; m += cfg.mooringEvery) {
      const w = at(s + m);
      if (has(cfg.mooring)) props.push(inst(cfg.mooring, G.sub(w.p, G.mul(w.n, cfg.mooringInset)), 0.15, 0));
    }
    const id = k === 0 && has(cfg.ferry) ? cfg.ferry : pick();
    if (!id) return;
    const w = at(s);
    const dir = rng() < 0.5 ? w.d : G.mul(w.d, -1);
    boats.push(inst(id, G.add(w.p, G.mul(w.n, beam(id) / 2 + 0.8)), water, facing(dir)));
  });

  // ---- boats at anchor off the port, in open water, apart from each other.
  const ids = Object.keys(cfg.boats).filter(has);
  if (ids.length) {
    let placed = 0;
    for (let k = 0; k < cfg.anchored * 8 && placed < cfg.anchored; k++) {
      const w = at(portS + (rng() * 2 - 1) * cfg.anchorReach);
      const off = cfg.offshore[0] + rng() * (cfg.offshore[1] - cfg.offshore[0]);
      const p = G.add(w.p, G.mul(w.n, off));
      if (coastDistance(p[0], p[1], island) < cfg.offshore[0] * 0.8) continue;   // a cove: too near land
      if (boats.some((b) => Math.hypot(b.position[0] - p[0], b.position[2] - p[1]) < cfg.anchorSpacing)) continue;
      // The last one is a second ferry, under way out in the strait, when there is one.
      const id = placed === cfg.anchored - 1 && has(cfg.ferry) ? cfg.ferry : pick();
      boats.push(inst(id, p, water, rng() * Math.PI * 2));
      placed++;
    }
  }
  return { props, boats };
}
