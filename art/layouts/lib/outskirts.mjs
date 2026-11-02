import * as G from './geom.mjs';

/** Flat settlement basin, rising into irregular foothills beyond the last building lots. */
export function terrainHeight(x, z, size, cfg) {
  const d = Math.hypot(Math.max(Math.abs(x) - size[0] / 2, 0), Math.max(Math.abs(z) - size[1] / 2, 0));
  const u = Math.min(1, Math.max(0, (d - cfg.start) / cfg.rise));
  const ridge = 0.55 + 0.25 * Math.sin(x / 470 + Math.sin(z / 630)) + 0.2 * Math.sin(z / 310 + x / 710);
  return cfg.height * u * u * (3 - 2 * u) * ridge;
}

/** Matches the two triangles in each 100 m cell of the rendered ground mesh. */
export function terrainSurfaceHeight(x, z, size, cfg, step = 100) {
  const x0 = Math.floor(x / step) * step, z0 = Math.floor(z / step) * step;
  const u = (x - x0) / step, v = (z - z0) / step;
  const h00 = terrainHeight(x0, z0, size, cfg);
  const h10 = terrainHeight(x0 + step, z0, size, cfg);
  const h01 = terrainHeight(x0, z0 + step, size, cfg);
  if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
  const h11 = terrainHeight(x0 + step, z0 + step, size, cfg);
  return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

/** Continue actual arterial endpoints into the basin; the first tangent stays continuous. */
export function approachRoads(roads, size, depth) {
  const out = [];
  for (const road of roads.filter((r) => r.cls === 'arterial')) {
    for (const [end, other] of [[road.a, road.b], [road.b, road.a]]) {
      if (Math.min(Math.abs(Math.abs(end[0]) - size[0] / 2), Math.abs(Math.abs(end[1]) - size[1] / 2)) > 1) continue;
      const dir = G.norm(G.sub(end, other)), normal = G.perp(dir);
      let prev = end;
      const length = depth + 700, steps = Math.ceil(length / 35);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, s = t * length;
        const bend = Math.sin(s / 330 + road.id) * 75 * t * t;
        const next = G.add(G.add(end, G.mul(dir, s)), G.mul(normal, bend));
        out.push({ a: prev, b: next, width: Math.max(8, road.width * (1 - 0.6 * Math.min(1, t * 4))) * (1 - t ** 6) });
        prev = next;
      }
    }
  }
  return out;
}

/** Delivery vehicles on wide industrial verges, leaving a pedestrian strip and junction clearance. */
export function parkedVehicles(blocks, roads, instances, props, lamps, assets, cfg) {
  const out = [], occupied = [...instances, ...props].map((i) => G.obb([i.position[0], i.position[2]], [Math.cos(i.rotationY), -Math.sin(i.rotationY)], i.fp[0], i.fp[1]));
  for (const block of blocks.filter((b) => b.district === 'industrial')) {
    for (let e = 0; e < block.pts.length && out.length < cfg.count; e++) {
      const road = roads[block.tags[e]];
      if (!road || road.cls !== 'arterial') continue;
      const a = block.pts[e], b = block.pts[(e + 1) % block.pts.length];
      const dir = G.norm(G.sub(b, a)), inward = G.perp(dir);
      for (let s = cfg.junctionClear; s < G.dist(a, b) - cfg.junctionClear && out.length < cfg.count; s += cfg.spacing) {
        // Alternate the models per vehicle, not per street edge.
        const id = cfg.assets[out.length % cfg.assets.length], meta = assets[id]?.meta;
        if (!meta) continue;
        const [w, l] = meta.footprint;
        const c = G.add(G.add(a, G.mul(dir, s)), G.mul(inward, w / 2 + cfg.curbGap));
        const rotationY = Math.atan2(dir[0], dir[1]);
        const box = G.obb(c, [Math.cos(rotationY), -Math.sin(rotationY)], w / 2 + cfg.clearance, l / 2 + cfg.clearance);
        if (!box.corners.every((p) => G.insideConvex(block.pts, p))) continue;
        if (occupied.some((o) => G.dist(o.c, c) < 150 && G.obbOverlap(o, box, 0))) continue;
        if (lamps.some(([x,z]) => G.insideConvex(box.corners, [x,z]))) continue;
        occupied.push(box);
        out.push({asset:id, position:[c[0],0.15,c[1]],rotationY,scale:1,fp:[w/2,l/2],h:meta.height+0.15,district:'delivery'});
      }
    }
  }
  return out;
}
