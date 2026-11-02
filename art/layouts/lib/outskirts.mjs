import * as G from './geom.mjs';

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
