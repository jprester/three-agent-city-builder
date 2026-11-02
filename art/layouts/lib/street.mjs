// Street furniture and parks of the city layout. Browser-safe: no Node APIs.
import * as G from './geom.mjs';
import { weightedChoice } from './rng.mjs';
import { r3 } from './util.mjs';

/**
 * Street furniture along every block edge that fronts a road: guardrails near junctions on
 * the curb, kiosks and small items (cabinets, bins, vents, bollards) spaced along the
 * sidewalk. Everything stays inside the sidewalk band (between curb and lot), faces the
 * road, and keeps clear of lamps and of each other.
 * Returns [{ asset, position, rotationY, scale, fp }].
 */
export function placeProps(cfg, blocks, roads, lamps, sidewalks, tagClass, assets, rng) {
  const rand = (lo, hi) => lo + (hi - lo) * rng();
  const out = [];
  const boxes = [];
  const fp = (id) => assets[id]?.meta?.footprint;
  const tryPlace = (id, q0, t, nIn, s, inset) => {
    const f = fp(id);
    if (!f) return false;
    const c = G.add(G.add(q0, G.mul(t, s)), G.mul(nIn, inset + f[1] / 2));
    const box = G.obb(c, G.mul(t, -1), f[0] / 2, f[1] / 2);
    const grown = G.obb(c, box.u, box.hu + cfg.gap, box.hv + cfg.gap);
    if (boxes.some((b) => G.obbOverlap(b, grown, 0))) return false;
    if ((lamps ?? []).some((l) => G.insideConvex(G.obb(c, box.u, box.hu + cfg.clearLamp, box.hv + cfg.clearLamp).corners, [l[0], l[1]]))) return false;
    boxes.push(box);
    out.push({ asset: id, position: [r3(c[0]), 0, r3(c[1])], rotationY: r3(Math.atan2(-nIn[0], -nIn[1])), scale: 1, fp: [r3(box.hu), r3(box.hv)] });
    return true;
  };
  for (const block of blocks) {
    const pts = block.pts;
    for (let i = 0; i < pts.length; i++) {
      const tag = block.tags[i];
      if (tag === 'edge') continue;
      const cls = tagClass(tag);
      const sw = sidewalks[cls];
      const q0 = pts[i], q1 = pts[(i + 1) % pts.length];
      const L = G.dist(q0, q1);
      if (L < 14) continue;
      const t = G.norm(G.sub(q1, q0)), nIn = G.perp(t);
      // Guardrails on the curb near both junctions.
      if (cfg.guardrailChance[cls]) {
        const gl = fp(cfg.guardrail)?.[0] ?? 6;
        for (const end of [0, 1]) {
          if (rng() > cfg.guardrailChance[cls]) continue;
          const n = 1 + Math.floor(rng() * 2);
          for (let k = 0; k < n; k++) {
            const s = end === 0 ? 3 + gl * (k + 0.5) : L - 3 - gl * (k + 0.5);
            if (s - gl / 2 < 2 || s + gl / 2 > L - 2) continue;
            tryPlace(cfg.guardrail, q0, t, nIn, s, 0.3);
          }
        }
      }
      // Kiosks: wide sidewalks only, leaving ≥ 1.4 m to walk past.
      const kioskChance = cfg.kioskChance[cls] ?? 0;
      if (kioskChance && sw >= 3.4) {
        for (let s = cfg.kioskEvery * rand(0.4, 1); s < L - 8; s += cfg.kioskEvery) {
          if (rng() > kioskChance) continue;
          const id = cfg.kiosks[Math.floor(rng() * cfg.kiosks.length)];
          if (sw - 0.5 - fp(id)[1] >= 1.4) tryPlace(id, q0, t, nIn, s, 0.5);
        }
      }
      // Small items just off the curb.
      for (let s = rand(4, cfg.smallEvery); s < L - 4; s += cfg.smallEvery * rand(0.6, 1.4)) {
        if (rng() > cfg.smallChance) continue;
        const id = weightedChoice(rng, cfg.small);
        if (fp(id) && fp(id)[1] + 0.45 < sw) tryPlace(id, q0, t, nIn, s, 0.45);
      }
    }
  }
  return out;
}

/**
 * Trees for the park blocks: a jittered grid over each lot with an open plaza in the middle
 * and random gaps, variants weighted by `trees`, plus a ring of path lamps around the plaza
 * (they also light the ground through the lamp map). Returns { trees: props ({ asset,
 * position, rotationY, scale, fp }), lamps: [x, z, angle] }.
 */
export function plantParks(cfg, blocks, parkBlocks, sidewalks, tagClass, assets, rng) {
  const out = [], parkLamps = [];
  if (!cfg) return { trees: out, lamps: parkLamps };
  const ids = Object.entries(cfg.trees ?? {}).filter(([id]) => assets[id]);
  if (!ids.length) return { trees: out, lamps: parkLamps };
  const total = ids.reduce((s, [, w]) => s + w, 0);
  const pick = () => { let r = rng() * total; for (const [id, w] of ids) if ((r -= w) <= 0) return id; return ids[0][0]; };
  for (const bi of parkBlocks) {
    const block = blocks[bi];
    const lot = G.inset(block.pts, (i) => sidewalks[tagClass(block.tags[i])]);
    if (!lot) continue;
    const c = G.centroid(lot);
    for (let k = 0; k < cfg.plazaLamps; k++) {
      const a = (k / cfg.plazaLamps) * Math.PI * 2;
      const r = cfg.plaza + 1.2;
      parkLamps.push([r3(c[0] + Math.cos(a) * r), r3(c[1] + Math.sin(a) * r), r3(Math.atan2(Math.cos(a), Math.sin(a)))]);
    }
    const xs = lot.map((p) => p[0]), zs = lot.map((p) => p[1]);
    const step = cfg.treeSpacing;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) {
        const p = [x + (rng() - 0.5) * step * 0.7, z + (rng() - 0.5) * step * 0.7];
        const id = pick();
        const s = 0.8 + rng() * 0.5;
        const rot = rng() * Math.PI * 2;
        if (rng() < cfg.gaps || G.dist(p, c) < cfg.plaza) continue;
        const r = (assets[id].meta.footprint?.[0] ?? 4) * 0.5 * s;
        if (!G.insideConvex(G.inset(lot, () => r) ?? [], p, 0)) continue;
        out.push({ asset: id, position: [r3(p[0]), 0, r3(p[1])], rotationY: r3(rot), scale: r3(s), fp: [r3(r), r3(r)] });
      }
    }
  }
  return { trees: out, lamps: parkLamps };
}
