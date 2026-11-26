// Sign placement: every sign belongs to a tenant of its building, at the tenant's floor, or to
// a brand on a roof or tower (docs/ADS-PLAN.md). The library is art/signs/signs.def.json,
// packed by tools/textures/build_signs.py into art/textures/signs/catalog.json; the layout gets
// one fact record per catalog entry: { owner, format, aspect, floor, script, brand, jp }.
//
// Mounting types, each in its place:
//   fascia     Japanese shop: a wide lightbox on the canopy's front edge, one per shopfront
//   blade      projecting lightbox perpendicular to the street, at its tenant's floor
//   panel      upper-floor tenants' panels stacked in a tenant column at the building's edge
//   billboard  big panel over two floors of the front, for an upper tenant (food photo, floor)
//   overhang   Hong Kong neon boards cantilevered far over the street, stacked by floor
//   stand      a shop's standing sign on the pavement (its blade art, small); lantern: a row of
//              paper lanterns on the canopy edge of a food or drink shop
//   board      brand campaign in a rooftop lattice frame, floodlit
//   wide/tall  hero campaigns (fashion, luxury) on tower billboards and shafts; mark: crown lettering
// No wayfinding, no sign without a tenant. Browser-safe (runs for ?seed=).
import * as G from './geom.mjs';
import { mulberry32 } from './rng.mjs';
import { r3 } from './util.mjs';

export const SIGN_DEFAULTS = {
  // Per street frontage: shops at street level (count range, minimum shop width), share of
  // shops with a blade, share of upper floors let to a tenant (up to `maxFloor`), chance of a
  // tenant column (>= 2 upper tenants), of an upper tenant taking a billboard, of extra blades.
  hero: { shops: [2, 3], shopWidth: 5, stand: 0.6, lantern: 0.85, blade: 0.85, upper: 0.85, maxFloor: 8, column: 0.9, billboard: 0.45, upperBlade: 0.7 },
  core: { shops: [1, 2], shopWidth: 6, stand: 0.35, lantern: 0.6, blade: 0.4, upper: 0.4, maxFloor: 6, column: 0.45, billboard: 0.15, upperBlade: 0.35 },
  // Island band (Hong Kong): neon overhangs, by what the building faces (buildIsland's `frontage`).
  island: {
    ring: { shops: [1, 2], shopWidth: 6, blade: 0.5, upper: 0.55, maxFloor: 5, overhang: 0.9 },
    avenue: { shops: [1, 2], shopWidth: 6, blade: 0.45, upper: 0.45, maxFloor: 5, overhang: 0.85 },
    street: { shops: [1, 1], shopWidth: 7, blade: 0.25, upper: 0.15, maxFloor: 3, overhang: 0.5 },
  },
  // Highest floor let to signing tenants, by building family (residential slabs keep the
  // upper floors for flats); floor heights (m) from the facade cells (art/style/facade.json).
  tenantFloors: { commercial: 8, midrise: 7, slab: 5, walkup: 3, restower: 2 },
  floors: { ground: 4.8, commercial: 3.8, midrise: 3.6, slab: 3.0, walkup: 3.0, restower: 3.0 },
  // Sizes (m): fascia height cap, blade width, column panel width, overhang reach.
  size: { fascia: 1.3, blade: [0.9, 1.3], column: 2.3, overhang: [3, 6.5] },
  // Tall hotel blades up old slabs (Mong Kok / Kabukicho vertical signs).
  tall: { slabChance: 0.25, heroSlabChance: 0.5, minHeight: 40 },
  // Towers: shops on the podium fascia; brand campaigns above (English, international).
  zones: { billboard: [15, 50], billboardChance: 0.6, shaftChance: 0.85, shaftSideChance: 0.5, shaftMax: 70, shaftBase: [14, 22], shaftHighChance: 0.15, shaftWidthShare: 0.85, crownChance: 0.75, fasciaFrom: 0.69, fascia: 1.3 },
  roofBillboardChance: 0.85,
};

/** Merge a params.signs object over the defaults (one level deep, island two). */
export function signParams(p = {}) {
  const out = { ...SIGN_DEFAULTS };
  for (const k of Object.keys(p)) {
    const d = SIGN_DEFAULTS[k];
    out[k] = d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ...p[k] } : p[k];
  }
  if (p.island) for (const k of Object.keys(SIGN_DEFAULTS.island)) out.island[k] = { ...SIGN_DEFAULTS.island[k], ...(p.island[k] ?? {}) };
  return out;
}

/**
 * Sign placer over one catalog. `hitsBridge(position, rotationY, size)` rejects signs in a
 * footbridge. All randomness from its own stream (seeded from the layout seed), so signs
 * never shift the rest of the city.
 */
export function createSignPlacer({ S, seed, assets, art, hitsBridge }) {
  const rng = mulberry32((seed ^ 0x51a7e5) >>> 0);
  const rand = (lo, hi) => lo + (hi - lo) * rng();
  const signs = [];

  // ---- the library, by owner
  const owners = new Map();
  art.forEach((e, i) => {
    if (!owners.has(e.owner)) owners.set(e.owner, { owner: e.owner, floor: e.floor ?? 1, script: e.script, brand: !!e.brand, jp: !!e.jp, tall: !!e.tall, lantern: e.lantern, f: {}, v: {} });
    const o = owners.get(e.owner);
    o.f[e.format] ??= i;
    (o.v[e.format] ??= []).push(i);   // campaign variants (wide2, tall2: docs/ADVERTISING.md)
  });
  const all = [...owners.values()];
  const pools = {
    shops: all.filter((o) => o.script === 'ja' && o.floor === 1 && !o.tall && (o.f.fascia !== undefined || o.f.blade !== undefined)),
    fascias: all.filter((o) => o.script === 'ja' && o.floor === 1 && o.f.fascia !== undefined),
    hotels: all.filter((o) => o.tall && o.f.blade !== undefined),
    upper: (f) => all.filter((o) => o.script === 'ja' && o.floor === f && o.f.panel !== undefined),
    hk: all.filter((o) => o.script === 'zh' && o.f.overhang !== undefined),
    brands: all.filter((o) => o.brand && !o.jp),
    roof: all.filter((o) => o.brand && o.f.board !== undefined),
  };
  const uses = new Map();
  /** Least-used owner of `pool` not already on this building (`taken`), or null. `zone` keeps
   *  its own count, so brands spread evenly over each tower zone. */
  const pick = (pool, taken = new Set(), zone = '') => {
    const n = (o) => uses.get(zone + o.owner) ?? 0;
    const free = pool.filter((o) => !taken.has(o.owner));
    if (!free.length) return null;
    const least = Math.min(...free.map(n));
    const few = free.filter((o) => n(o) <= least);
    const o = few[Math.floor(rng() * few.length)];
    uses.set(zone + o.owner, n(o) + 1);
    taken.add(o.owner);
    return o;
  };
  /** Largest size of aspect `a` within w <= wMax, h <= hMax. */
  const fit = (a, wMax, hMax) => {
    const w = Math.min(wMax, hMax * a);
    return { w, h: w / a };
  };
  const seedOf = () => Math.floor(rng() * 2 ** 31);
  /** One of the owner's variants of `format` (a brand may run two campaigns). */
  const variant = (o, format) => o.v[format][Math.floor(rng() * o.v[format].length)];

  /** The street face of a building: point on the front at offset `off` (along it), `out` (off it). */
  const frame = (inst) => {
    const t = inst.rotationY;
    const u = [Math.cos(t), -Math.sin(t)], v = [Math.sin(t), Math.cos(t)];
    const [hu, hv] = inst.fp;
    const front = [inst.position[0] + v[0] * hv, inst.position[2] + v[1] * hv];
    const at = (off, out, y) => [r3(front[0] + u[0] * off + v[0] * out), r3(y), r3(front[1] + u[1] * off + v[1] * out)];
    return { t, u, v, hu, hv, front, at, along: r3(Math.atan2(u[0], u[1])) };
  };

  /** A projecting sign (faces look along the street) at `off`, bottom at `y0`. */
  const blade = (F, index, idx, o, { w, h }, off, y0, arm, extra = {}) => {
    const s = {
      building: index, kind: 'blade', art: idx, owner: o.owner, arm: r3(arm), ...extra,
      position: F.at(off, arm + w / 2, y0 + h / 2), rotationY: F.along, size: [r3(w), r3(h), 0.28], seed: seedOf(),
    };
    if (!hitsBridge(s.position, s.rotationY, s.size)) signs.push(s);
  };
  /** A flat sign on the front at `off`, `out` off the wall, bottom at `y0`. */
  const flat = (F, index, idx, o, { w, h }, off, y0, out, extra = {}) => {
    const s = {
      building: index, kind: 'panel', art: idx, owner: o.owner, ...extra,
      position: F.at(off, out, y0 + h / 2), rotationY: r3(F.t), size: [r3(w), r3(h), 0.25], seed: seedOf(),
    };
    if (!hitsBridge(s.position, s.rotationY, s.size)) signs.push(s);
  };

  /**
   * Street frontage of a low or mid-rise building: shops at street level, tenants above.
   * `script` ja (Japanese lightboxes) or zh (Hong Kong neon); k: the building's scale.
   */
  const street = (inst, index, cfg, script, k = [1, 1, 1]) => {
    const meta = assets[inst.asset]?.meta ?? {};
    const fam = meta.family;
    if (!(fam in S.tenantFloors)) return;
    const F = frame(inst);
    const { hu } = F;
    if (hu < 2.5) return;
    const gh = S.floors.ground * k[1], fh = (S.floors[fam] ?? 3) * k[1];
    const floorY = (f) => gh + (f - 2) * fh;   // bottom of floor f (f >= 2)
    const depth = (meta.depth ?? 0.3) * k[2];
    const canopy = (meta.canopy ?? 0) * k[2];
    const roofY = inst.h - 2;
    const taken = new Set();
    const bladeOffs = [];
    const freeOff = (off, gap = 2.2) => Math.abs(off) <= hu - 0.6 && !bladeOffs.some((o) => Math.abs(o - off) < gap);
    const zh = script === 'zh';
    const [bw0, bw1] = S.size.blade;

    // Street level: the front split into shopfronts, each one business.
    const maxShops = Math.max(1, Math.min(cfg.shops[1], Math.floor((2 * hu) / cfg.shopWidth)));
    const nShops = Math.min(maxShops, cfg.shops[0] + Math.floor(rng() * (cfg.shops[1] - cfg.shops[0] + 1)));
    const shopW = (2 * hu) / nShops;
    for (let j = 0; j < nShops; j++) {
      const o = pick(zh ? pools.hk : pools.shops, taken);
      if (!o) break;
      const c = -hu + (j + 0.5) * shopW;
      if (!zh && o.f.fascia !== undefined) {
        // Fascia: stands on the canopy's front edge (or on the wall over the shop window).
        const e = art[o.f.fascia];
        const sz = fit(e.aspect, shopW - 0.8, S.size.fascia * k[1]);
        const y0 = canopy > 0 ? gh - 0.1 : gh * 0.69;
        flat(F, index, o.f.fascia, o, sz, c, y0, canopy > 0 ? canopy - 0.12 : depth + 0.12, { floor: 1 });
      }
      if (!zh && o.lantern && canopy > 0.8 && cfg.lantern && rng() < cfg.lantern) {
        // Paper lanterns in a row along the canopy's front edge (food and drink shops).
        const n = Math.max(2, Math.min(4, Math.floor((shopW - 1.2) / 0.8)));
        const idx = o.f.fascia ?? o.f.blade;
        signs.push({
          building: index, kind: 'lantern', lantern: o.lantern, count: n, art: idx, owner: o.owner, floor: 1,
          position: F.at(c, canopy - 0.35, gh - 0.95 * k[1]), rotationY: r3(F.t), size: [r3(n * 0.75), r3(0.6 * k[1]), 0.42], seed: seedOf(),
        });
      }
      if (!zh && o.f.blade !== undefined && cfg.stand && rng() < cfg.stand) {
        // A standing sign (置き看板) on the pavement by the door: the shop's blade, small.
        const sz = fit(art[o.f.blade].aspect, 0.5, 1.3);
        const off = c + (rng() < 0.5 ? -1 : 1) * (shopW / 2 - 0.9);
        signs.push({
          building: index, kind: 'stand', art: o.f.blade, owner: o.owner, floor: 1,
          position: F.at(off, depth + 0.55, 0.14 + sz.h / 2), rotationY: F.along, size: [r3(sz.w), r3(sz.h), 0.2], seed: seedOf(),
        });
      }
      if (rng() < cfg.blade) {
        // Its blade at the shopfront's edge, above the canopy.
        const off = c + (rng() < 0.5 ? -1 : 1) * (shopW / 2 - 0.6);
        const idx = zh ? o.f.hkblade : o.f.blade;
        if (idx !== undefined && freeOff(off)) {
          const sz = fit(art[idx].aspect, rand(bw0, bw1) * k[0], Math.min(6.5 * k[1], roofY - gh - 1.6));
          if (sz.h > 1.5) {
            bladeOffs.push(off);
            blade(F, index, idx, o, sz, off, gh + 1.6 * k[1], depth + 0.3, { floor: 1 });
          }
        }
      }
      if (zh && rng() < cfg.overhang) {
        // Hong Kong overhang over its own shop, just above the canopy, reaching out over the street.
        const off = c + rand(-shopW / 4, shopW / 4);
        if (freeOff(off, 1.2)) {
          const e = art[o.f.overhang];
          const sz = fit(e.aspect, rand(...S.size.overhang), 3.6 * k[1]);
          bladeOffs.push(off);
          blade(F, index, o.f.overhang, o, sz, off, gh + 0.5 * k[1], depth + rand(0.4, 1.6), { floor: 1 });
        }
      }
    }

    // Upper floors: tenants, each at its own floor, up to the family's limit and the roof.
    const top = Math.min(cfg.maxFloor, S.tenantFloors[fam]);
    const upper = [];
    for (let f = 2; f <= top; f++) {
      if (floorY(f) + fh > roofY || rng() >= cfg.upper) continue;
      const o = pick(zh ? pools.hk : pools.upper(f), taken);
      if (o) upper.push({ o, f });
    }
    if (zh) {
      // Stacked neon overhangs, one per upper tenant, overlapping in depth along the street.
      for (const { o, f } of upper) {
        const off = rand(-hu + 1, hu - 1);
        const useBlade = o.f.hkblade !== undefined && (rng() < 0.35 || !freeOff(off, 1.2));
        const idx = useBlade ? o.f.hkblade : o.f.overhang;
        const sz = useBlade
          ? fit(art[idx].aspect, rand(bw0, bw1) * 1.2 * k[0], Math.min(2.6 * fh, roofY - floorY(f)))
          : fit(art[idx].aspect, rand(...S.size.overhang), Math.min(fh * 1.1, 3.6 * k[1]));
        const o2 = useBlade ? rand(-hu + 0.8, hu - 0.8) : off;
        if (!freeOff(o2, 1.2)) continue;
        bladeOffs.push(o2);
        blade(F, index, idx, o, sz, o2, floorY(f) + 0.3, depth + (useBlade ? 0.3 : rand(0.4, 1.8)), { floor: f });
      }
      return;
    }
    // Tenant column at one edge of the front: one panel per upper tenant, at its floor.
    const inColumn = new Set();
    if (upper.length >= 2 && rng() < cfg.column && hu > 4) {
      const side = rng() < 0.5 ? -1 : 1;
      const cw = S.size.column * k[0];
      const off = side * (hu - 0.7);
      if (freeOff(off)) {
        bladeOffs.push(off);
        for (const { o, f } of upper) {
          const e = art[o.f.panel];
          const sz = fit(e.aspect, cw, fh - 0.2 * k[1]);
          // `span`: the floor height; the column's frame rails run through it, joining the panels.
          blade(F, index, o.f.panel, o, sz, off, floorY(f) + (fh - sz.h) / 2, depth + 0.3, { floor: f, column: true, span: r3(fh) });
          inColumn.add(o.owner);
        }
      }
    }
    // Billboards: an upper tenant's big panel over its floor and the next.
    for (const { o, f } of upper) {
      if (o.f.billboard === undefined || rng() >= cfg.billboard || floorY(f) + 2 * fh > roofY) continue;
      const e = art[o.f.billboard];
      const sz = fit(e.aspect, 2 * hu - 3, 2 * fh - 0.6 * k[1]);
      if (sz.w < 4) continue;
      const off = rand(-hu + 1.5 + sz.w / 2, hu - 1.5 - sz.w / 2);
      flat(F, index, o.f.billboard, o, sz, off, floorY(f) + 0.3 * k[1], depth + 0.15, { floor: f });
    }
    // Blades at their floors: tenants outside the column, and some inside it as well.
    for (const { o, f } of upper) {
      if (o.f.blade === undefined || (inColumn.has(o.owner) && rng() >= cfg.upperBlade)) continue;
      const off = rand(-hu + 0.8, hu - 0.8);
      if (!freeOff(off)) continue;
      const sz = fit(art[o.f.blade].aspect, rand(bw0, bw1) * k[0], Math.min(1.8 * fh, roofY - floorY(f)));
      if (sz.h < 1.5) continue;
      bladeOffs.push(off);
      blade(F, index, o.f.blade, o, sz, off, floorY(f) + 0.2, depth + 0.3, { floor: f });
    }
  };

  /** Brand campaign or rooftop board on a building (roof frames, towers, hotel blades). */
  const building = (inst, index, onHero) => {
    const meta = assets[inst.asset]?.meta ?? {};
    const F = frame(inst);
    const { u, v, hu, hv, front } = F;
    const s3 = Array.isArray(inst.scale) ? inst.scale : [inst.scale, inst.scale, inst.scale];
    if (meta.billboard && rng() < S.roofBillboardChance) {
      // A brand board in the rooftop frame, floodlit from the top edge.
      const b = meta.billboard;
      const o = pick(pools.roof);
      if (o) {
        const e = art[o.f.board];
        const sz = fit(e.aspect, b.width, b.height);
        // Blender space → three.js: local x stays, Blender -y is the front (+z along v).
        const out = -(b.y + 0.25);
        signs.push({
          building: index, kind: 'panel', roof: true, flood: true, art: o.f.board, owner: o.owner,
          legs: r3((b.legs ?? 2) + (b.height - sz.h) / 2),
          position: [r3(inst.position[0] + v[0] * out), r3(b.z + b.height / 2), r3(inst.position[2] + v[1] * out)],
          rotationY: r3(F.t), size: [r3(sz.w), r3(sz.h), 0.25], seed: seedOf(),
        });
      }
    }
    if (meta.family === 'tower' && meta.tiers?.length) {
      // Tower zones (human review 2026-09-27), on the street-facing face:
      //   street     shops on the podium fascia, one fascia per shopfront
      //   billboard  15-50 m: a brand campaign; shaft: tall campaigns rising with the shaft
      //   crown      the tower's brand lettering on the roof
      const Z = S.zones;
      const sy = s3[1];
      const tiers = meta.tiers;
      const faceOf = (tier) => 2 * (hu - tier[2] * s3[0]);
      const tierAt = (y) => tiers.find(([z0, z1]) => y >= z0 * sy && y <= z1 * sy);
      const sideOf = (tier, side) => side === 0
        ? { n: v, tan: u, half: hu - tier[2] * s3[0], dist: hv, setback: tier[2] * s3[2] }
        : { n: [u[0] * side, u[1] * side], tan: [-v[0] * side, -v[1] * side], half: hv - tier[2] * s3[2], dist: hu, setback: tier[2] * s3[0] };
      const place = (idx, o, { w, h }, yBottom, zone, side = 0) => {
        const tier = tierAt(yBottom);
        if (!tier) return false;
        const f = sideOf(tier, side);
        const faceW = 2 * f.half - 3;
        if (yBottom + h > tier[1] * sy - 1 || w > faceW) return false;
        const off = rand(-faceW / 2 + w / 2, faceW / 2 - w / 2);
        const out = f.dist - f.setback + 0.25;
        const c0 = [inst.position[0], inst.position[2]];
        signs.push({
          building: index, kind: 'panel', inset: r3(f.setback), zone, ...(side ? { side } : {}), art: idx, owner: o.owner,
          position: [r3(c0[0] + f.tan[0] * off + f.n[0] * out), r3(yBottom + h / 2), r3(c0[1] + f.tan[1] * off + f.n[1] * out)],
          rotationY: r3(Math.atan2(f.n[0], f.n[1])), size: [r3(w), r3(h), 0.3], seed: seedOf(),
        });
        return true;
      };
      // Podium shops: the front split into shopfronts, a fascia over each.
      const podiumTop = (meta.podium ?? 4.8) * sy;
      const band = [podiumTop * Z.fasciaFrom, podiumTop - 0.15];
      const nShops = Math.max(1, Math.min(4, Math.floor((2 * hu - 2) / 8)));
      const shopW = (2 * hu - 2) / nShops;
      const taken = new Set();
      for (let j = 0; j < nShops; j++) {
        if (rng() < 0.25) continue;   // a lobby or an empty unit
        const o = pick(pools.fascias, taken);
        if (!o) break;
        const sz = fit(art[o.f.fascia].aspect, shopW - 1.2, Math.min(Z.fascia, band[1] - band[0]));
        const c = -hu + 1 + (j + 0.5) * shopW;
        signs.push({
          building: index, kind: 'panel', zone: 'street', art: o.f.fascia, owner: o.owner, floor: 1,
          position: F.at(c, 0.2, band[0] + (band[1] - band[0]) / 2), rotationY: r3(F.t), size: [r3(sz.w), r3(sz.h), 0.2], seed: seedOf(),
        });
      }
      let frontUsed = false;
      if (!meta.landmark && rng() < Z.billboardChance) {
        const lo = Math.max(Z.billboard[0], tiers[0][0] * sy + 1);
        const o = pick(pools.brands.filter((b) => b.f.wide !== undefined), new Set(), 'wide:');
        if (o) {
          const idx = variant(o, 'wide');
          const sz = fit(art[idx].aspect, faceOf(tiers[0]) - 3, Math.min(26, Z.billboard[1] - lo));
          if (sz.h >= 10) frontUsed = place(idx, o, sz, rand(lo, Z.billboard[1] - sz.h), 'billboard');
        }
      }
      if (!meta.landmark && rng() < Z.shaftChance) {
        const tier = tiers[0];
        const H = inst.h;
        const a = Math.max(tier[0] * sy + 1, rand(Z.shaftBase[0], Math.max(Z.shaftBase[1], H * 0.25)));
        const topCap = H * (rng() < Z.shaftHighChance ? 0.75 : 0.5);
        const b = Math.min(tier[1] * sy - 4, topCap);
        if (b - a > 40) {
          const sides = frontUsed ? [rng() < 0.5 ? 1 : -1] : rng() < Z.shaftSideChance ? [0, rng() < 0.5 ? 1 : -1] : [0];
          for (const side of sides) {
            const f = sideOf(tier, side);
            const o = pick(pools.brands.filter((b) => b.f.tall !== undefined), new Set(), 'tall:');
            if (!o) break;
            const idx = variant(o, 'tall');
            const hMax = Math.min(Z.shaftMax, b - a);
            const sz = fit(art[idx].aspect, (2 * f.half - 3) * Z.shaftWidthShare, rand(hMax * 0.7, hMax));
            if (sz.h >= 30) place(idx, o, sz, a, 'shaft', side);
          }
        }
      }
      if (meta.crownSigns !== false && rng() < Z.crownChance && meta.roof) {
        // Crown: the brand lettering stands on the roof, set back 1 m, on posts.
        const topTier = tiers[tiers.length - 1];
        const f = sideOf(topTier, 0);
        const o = pick(pools.brands.filter((b) => b.f.mark !== undefined), new Set(), 'mark:');
        if (o) {
          const e = art[o.f.mark];
          const w = Math.min(2 * f.half - 4, 34);
          const h = w / e.aspect;
          const legs = 1.2;
          const out = f.dist - f.setback - 1.0;
          signs.push({
            building: index, kind: 'panel', zone: 'crown', legs, art: o.f.mark, owner: o.owner,
            position: [r3(front[0] - v[0] * f.dist + v[0] * out), r3(meta.roof * sy + legs + h / 2), r3(front[1] - v[1] * f.dist + v[1] * out)],
            rotationY: r3(F.t), size: [r3(w), r3(h), 0.3], seed: seedOf(),
          });
        }
      }
    } else if (meta.family === 'slab' && inst.h >= S.tall.minHeight && hu >= 3) {
      // A hotel occupying the upper floors: its tall blade climbs the front.
      if (rng() > (onHero ? S.tall.heroSlabChance : S.tall.slabChance)) return;
      const o = pick(pools.hotels);
      if (!o) return;
      const sz = fit(art[o.f.blade].aspect, rand(1.6, 2.4), Math.min(16, inst.h - 14));
      const clear = (meta.depth ?? 0.3) + 0.3;
      blade(F, index, o.f.blade, o, sz, rand(-hu + 1.5, hu - 1.5), rand(9, Math.max(9, inst.h - 3 - sz.h)), clear, { zone: 'tall' });
    }
  };

  return { signs, street, building };
}
