import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import * as G from '../../art/layouts/lib/geom.mjs';
import def from '../../art/layouts/defs/city.json';
import { ASSETS } from '../../src/assets/manifest.gen';
import { FlythroughPath } from '../../src/systems/flythrough';
import { SIGN_ART, generateLayout, type Layout, type LayoutInstance, type Vec2 } from '../../src/systems/layout';

const box = (i: LayoutInstance) => {
  const t = i.rotationY;
  return G.obb([i.position[0], i.position[2]], [Math.cos(t), -Math.sin(t)], i.fp![0], i.fp![1]);
};
const roadBox = (r: NonNullable<Layout['roads']>[number]) => {
  const d = G.norm(G.sub(r.b, r.a));
  return G.obb(G.lerp(r.a, r.b, 0.5), d, G.dist(r.a, r.b) / 2, r.width / 2);
};

describe.each([def.seed, 1, 777])('city layout, seed %i', (seed) => {
  let layout: Layout;
  const get = async () => (layout ??= await generateLayout('city', seed));

  it('has buildings, roads, a hero street and a flythrough', async () => {
    const L = await get();
    expect(L.instances.length).toBeGreaterThan(300);
    expect(L.roads!.length).toBeGreaterThan(20);
    expect(L.hero).toBeTruthy();
    expect(L.flythrough!.points.length).toBeGreaterThan(5);
  });

  it('places only full-detail assets (LOD variants are swapped in at runtime)', async () => {
    const L = await get();
    const lods = L.instances.filter((i) => (ASSETS[i.asset as keyof typeof ASSETS].meta as { lodOf?: string }).lodOf);
    expect(lods.map((i) => i.asset)).toEqual([]);
  });

  it('keeps street props on sidewalks: off roads, clear of buildings, lamps and each other', async () => {
    const L = await get();
    const props = L.props!;
    expect(props.length).toBeGreaterThan(200);
    const pb = props.map(box);
    const roads = L.roads!.map(roadBox);
    const buildings = L.instances.map(box);
    const bad: string[] = [];
    pb.forEach((b, k) => {
      const id = props[k].asset;
      if (!L.blocks.some((bl) => b.corners.every((p) => G.insideConvex(bl.points, p, 0.05)))) bad.push(`${id} outside sidewalks`);
      if (roads.some((r) => G.obbOverlap(r, b, 0.01))) bad.push(`${id} on a road`);
      if (buildings.some((bx) => G.dist(bx.c, b.c) < 120 && G.obbOverlap(bx, b, 0.01))) bad.push(`${id} inside a building`);
      if (L.lamps!.some(([x, z]) => G.insideConvex(b.corners, [x, z], 0))) bad.push(`${id} on a lamp`);
      for (let j = k + 1; j < pb.length; j++) if (G.dist(pb[j].c, b.c) < 20 && G.obbOverlap(pb[j], b, 0.01)) bad.push(`${id} overlaps ${props[j].asset}`);
    });
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('flies vehicles clear of buildings and skybridges, and has traffic lanes', async () => {
    const L = await get();
    expect(L.traffic!.length).toBeGreaterThan(20);
    expect(L.skyLanes!.length).toBe(3);
    const boxes = L.instances.map((i) => ({ b: G.obb([i.position[0], i.position[2]], [Math.cos(i.rotationY), -Math.sin(i.rotationY)], i.fp![0] + 8, i.fp![1] + 8), h: i.h! }));
    const hits: string[] = [];
    L.skyLanes!.forEach((lane, li) => {
      const curve = new THREE.CatmullRomCurve3(lane.points.map((p) => new THREE.Vector3(...p)), true);
      for (let k = 0; k < 3000; k++) {
        const p = curve.getPointAt(k / 3000);
        for (const { b, h } of boxes) if (p.y < h + 8 && G.insideConvex(b.corners, [p.x, p.z])) { hits.push(`lane ${li} t=${(k / 3000).toFixed(3)} y=${p.y.toFixed(0)} h=${h}`); break; }
        for (const br of L.bridges!) if (Math.abs(p.y - (br.y + br.depth / 2)) < 8 && G.segDist([p.x, p.z], br.a, br.b) < br.width / 2 + 8) hits.push(`lane ${li} hits a bridge`);
      }
    });
    expect(hits.slice(0, 10)).toEqual([]);
  });

  it('puts the hero street in the old core', async () => {
    const L = await get();
    const along = L.blocks.filter((b) => b.edges?.includes(L.hero!.road));
    expect(along.length).toBeGreaterThan(1);
    expect(along.filter((b) => b.district === 'core').length / along.length).toBeGreaterThanOrEqual(0.75);
  });

  it('keeps every building footprint off every road', async () => {
    const L = await get();
    const roads = L.roads!.map(roadBox);
    const bad = L.instances.filter((i) => roads.some((r) => G.obbOverlap(box(i), r, 0.01)));
    expect(bad.map((i) => i.position)).toEqual([]);
  });

  it('keeps every footprint inside a block and clear of its neighbors', async () => {
    const L = await get();
    const boxes = L.instances.map(box);
    const outside = L.instances.filter((_i, k) => !L.blocks.some((b) => boxes[k].corners.every((p) => G.insideConvex(b.points, p, 0.05))));
    expect(outside.map((i) => i.position)).toEqual([]);
    const overlaps: number[][] = [];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      if (G.dist(boxes[a].c, boxes[b].c) < 200 && G.obbOverlap(boxes[a], boxes[b], 0.05)) overlaps.push([a, b]);
    }
    expect(overlaps).toEqual([]);
  });

  it('faces every frontage building toward the street it stands on', async () => {
    const L = await get();
    const wrong = L.instances.filter((i) => {
      const road = (i as { road?: number }).road;
      if (road === undefined || road < 0) return false;
      const r = L.roads![road];
      const front: Vec2 = [Math.sin(i.rotationY), Math.cos(i.rotationY)];
      const c: Vec2 = [i.position[0], i.position[2]];
      const d = G.norm(G.sub(r.b, r.a));
      const toRoad = G.sub(G.add(r.a, G.mul(d, G.dot(G.sub(c, r.a), d))), c);
      return G.dot(front, G.norm(toRoad)) < 0.98;
    });
    expect(wrong.map((i) => i.position)).toEqual([]);
  });

  it('mounts every sign on a building face that fronts a street', async () => {
    const L = await get();
    expect(L.signs!.length).toBeGreaterThan(50);
    // Side-face tower ads are checked by the zone and tier tests instead.
    // Side-face and rooftop/crown signs are checked by their own tests.
    const bad = L.signs!.filter((s) => !s.roof && !s.side && s.zone !== 'crown').filter((s) => {
      const b = L.instances[s.building] as LayoutInstance & { road?: number; interior?: boolean };
      if (!b || b.interior || b.road === undefined || b.road < 0) return true;
      const t = b.rotationY;
      const u: Vec2 = [Math.cos(t), -Math.sin(t)], v: Vec2 = [Math.sin(t), Math.cos(t)];
      const [hu, hv] = b.fp!;
      const rel = G.sub([s.position[0], s.position[2]], [b.position[0], b.position[2]]);
      const out = G.dot(rel, v) - hv;          // distance of the sign center in front of the face
      const along = G.dot(rel, u);
      // Blades start just off the wall and reach out by their width; panels hug the wall.
      // Blades hang on an arm clearing balconies/AC units (s.arm); panels sit on the wall or
      // stand on the canopy's front edge (up to its depth).
      const meta = ASSETS[b.asset as keyof typeof ASSETS].meta as { depth?: number; canopy?: number };
      const gap = s.kind === 'blade' ? out - s.size[0] / 2 : out + (s.inset ?? 0);
      const maxGap = s.kind === 'blade' ? (s.arm ?? 0.3) + 0.05 : Math.max(0.5, (meta.canopy ?? 0) + 0.05, (meta.depth ?? 0) + 0.3);
      const minGap = s.kind === 'blade' ? Math.max(0.05, (meta.depth ?? 0) + 0.25) : 0.05;
      return gap < minGap || gap > maxGap || Math.abs(along) > hu || s.position[1] + s.size[1] / 2 > b.h!;
    });
    expect(bad.map((s) => s.position)).toEqual([]);
  });

  it('sizes every sign to its artwork aspect (no cropping or stretching)', async () => {
    const L = await get();
    const stroke = { blade: 130 / 472, panel: 472 / 88 };
    const wrong = L.signs!.filter((s) => {
      const want = s.art !== undefined ? SIGN_ART[s.art].aspect : s.stroke ? stroke[s.stroke] : null;
      return want === null || Math.abs(s.size[0] / s.size[1] / want - 1) > 0.02;
    });
    expect(wrong.map((s) => [s.size, s.art, s.stroke])).toEqual([]);
  });

  it('keeps tower signs in their zones (street, billboard 15–50 m, tall campaigns low, mostly below mid-height, crown)', async () => {
    const L = await get();
    const wrong = L.signs!.filter((s) => s.zone).filter((s) => {
      const b = L.instances[s.building];
      const y0 = s.position[1] - s.size[1] / 2, y1 = s.position[1] + s.size[1] / 2;
      switch (s.zone) {
        case 'street': return y1 > 12 + 0.01 || y0 < 4;
        case 'billboard': return y0 < 15 - 0.01 || y1 > 50 + 0.01;
        case 'shaft': return y0 < 12 || y0 > Math.max(22, b.h! * 0.25) + 0.01 || s.size[0] / s.size[1] > 0.46 || y1 > b.h! * 0.75 + 0.01;
        case 'crown': {
          // On the top tier (tower height also counts spires and masts above it).
          // Standing on the roof (above the parapet), inside the footprint.
          const roof = (ASSETS[b.asset as keyof typeof ASSETS].meta as { roof: number }).roof;
          const sy = Array.isArray(b.scale) ? b.scale[1] : b.scale;
          return Math.abs(y0 - (roof * sy + (s.legs ?? 0))) > 0.02 || (s.legs ?? 0) < 1 || s.brand === undefined
            || !G.insideConvex(box(b).corners, [s.position[0], s.position[2]], 0.05);
        }
        default: return true;
      }
    });
    expect(wrong.map((s) => [s.zone, s.position[1], s.size])).toEqual([]);
    // Most tall campaigns end by mid-height (human review).
    const shafts = L.signs!.filter((s) => s.zone === 'shaft');
    const low = shafts.filter((s) => s.position[1] + s.size[1] / 2 <= L.instances[s.building].h! * 0.5 + 0.01);
    expect(low.length / shafts.length).toBeGreaterThan(0.7);
    expect(L.signs!.filter((s) => s.stroke && s.brand === undefined)).toEqual([]);
  });

  it('keeps signs from overlapping each other or reaching into other buildings', async () => {
    const L = await get();
    const sb = L.signs!.map((s) => ({ s, b: G.obb([s.position[0], s.position[2]], [Math.cos(s.rotationY), -Math.sin(s.rotationY)], s.size[0] / 2, s.size[2] / 2), y0: s.position[1] - s.size[1] / 2, y1: s.position[1] + s.size[1] / 2 }));
    const boxes = L.instances.map(box);
    const bad: string[] = [];
    sb.forEach((a, i) => {
      for (let j = i + 1; j < sb.length; j++) {
        const c = sb[j];
        if (a.y0 < c.y1 && c.y0 < a.y1 && G.dist(a.b.c, c.b.c) < 40 && G.obbOverlap(a.b, c.b, 0.01)) bad.push(`signs ${i} and ${j} overlap`);
      }
      boxes.forEach((bx, k) => {
        if (k !== a.s.building && L.instances[k].h! > a.y0 && G.dist(bx.c, a.b.c) < 120 && G.obbOverlap(bx, a.b, 0.06)) bad.push(`sign ${i} enters building ${k}`);
      });
    });
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('puts rooftop billboards above their building, inside its footprint', async () => {
    const L = await get();
    const roof = L.signs!.filter((s) => s.roof);
    expect(roof.length).toBeGreaterThan(3);
    const bad = roof.filter((s) => {
      const b = L.instances[s.building];
      const bx = box(b);
      return s.position[1] - s.size[1] / 2 < b.h! - 1.5 || !G.insideConvex(bx.corners, [s.position[0], s.position[2]], 0.05);
    });
    expect(bad.map((s) => s.position)).toEqual([]);
  });

  it('mounts tall tower panels on the set-back tier wall they overlap', async () => {
    const L = await get();
    const tall = L.signs!.filter((s) => s.inset !== undefined);
    expect(tall.length).toBeGreaterThan(3);
    const wrong = tall.filter((s) => {
      const b = L.instances[s.building];
      const meta = ASSETS[b.asset as keyof typeof ASSETS].meta as { tiers?: number[][] };
      const sy = Array.isArray(b.scale) ? b.scale[1] : b.scale, sz = Array.isArray(b.scale) ? b.scale[2] : b.scale;
      const tier = meta.tiers!.find(([z0, z1]) => s.position[1] - s.size[1] / 2 >= z0 * sy - 0.01 && s.position[1] + s.size[1] / 2 <= z1 * sy + 0.01);
      return !tier || Math.abs(tier[2] * sz - s.inset!) > 0.01;
    });
    expect(wrong.map((s) => s.position)).toEqual([]);
  });

  it('keeps bridges clear of other buildings and the flythrough', async () => {
    const L = await get();
    expect(L.bridges!.length).toBeGreaterThan(5);
    const boxes = L.instances.map(box);
    const fly = L.flythrough!;
    const curve = new THREE.CatmullRomCurve3(fly.points.map((p) => new THREE.Vector3(...p)), fly.closed ?? true);
    const hits: string[] = [];
    for (const b of L.bridges!) {
      const d = G.norm(G.sub(b.b, b.a));
      // Ends sit inside the buildings they connect: test the middle stretch only.
      const inner = G.obb(G.lerp(b.a, b.b, 0.5), d, Math.max(G.dist(b.a, b.b) / 2 - (b.kind === 'sky' ? 0 : 1.0), 0.5), b.width / 2);
      const ends = [b.a, b.b];
      boxes.forEach((bx, k) => {
        if (L.instances[k].h! < b.y) return;
        if (ends.some((e) => G.insideConvex(bx.corners, e, 0.01))) return;   // a connected building
        if (G.obbOverlap(bx, inner, 0.05)) hits.push(`${b.kind} bridge hits ${L.instances[k].asset}`);
      });
      for (let k = 0; k < 2000; k++) {
        const p = curve.getPointAt(k / 2000);
        if (p.y > b.y - 1.5 && p.y < b.y + b.depth + 3 && G.insideConvex(G.obb(inner.c, inner.u, inner.hu + 3, inner.hv + 3).corners, [p.x, p.z])) {
          hits.push(`flythrough t=${(k / 2000).toFixed(3)} passes through a ${b.kind} bridge`);
          break;
        }
      }
    }
    expect(hits.slice(0, 10)).toEqual([]);
  });

  it('flies the camera around buildings, never through them', async () => {
    const L = await get();
    const fly = L.flythrough!;
    const curve = new THREE.CatmullRomCurve3(fly.points.map((p) => new THREE.Vector3(...p)), fly.closed ?? true);
    const boxes = [...L.instances, ...(L.fringe ?? [])].map((i) => ({ i, b: G.obb([i.position[0], i.position[2]], [Math.cos(i.rotationY), -Math.sin(i.rotationY)], i.fp![0] + 3, i.fp![1] + 3) }));
    const hits: string[] = [];
    for (let k = 0; k < 4000; k++) {
      const p = curve.getPointAt(k / 4000);
      for (const { i, b } of boxes) {
        if (p.y < i.h! + 3 && G.insideConvex(b.corners, [p.x, p.z])) hits.push(`t=${(k / 4000).toFixed(3)} y=${p.y.toFixed(1)} in ${i.asset} (h ${i.h})`);
      }
    }
    expect(hits.slice(0, 10)).toEqual([]);
    expect(curve.points.every((p) => p.y > 1)).toBe(true);
  });

  it('rings the city with a low-rise fringe: outside it, not overlapping, clear of the port view', async () => {
    const L = await get();
    const F = L.fringe!;
    expect(F.length).toBeGreaterThan(500);
    const [W, Dp] = L.size;
    const bad: string[] = [];
    const fb = F.map(box);
    fb.forEach((b, k) => {
      const f = F[k];
      if (f.district !== 'fringe' || (ASSETS[f.asset as keyof typeof ASSETS].meta as { lodOf?: string }).lodOf) bad.push(`${k}: ${f.asset} not a fringe asset`);
      // Every corner clears the city rectangle.
      if (b.corners.some(([x, z]) => Math.abs(x) < W / 2 + 5 && Math.abs(z) < Dp / 2 + 5)) bad.push(`${k} inside the city`);
      if (f.h! > 100) bad.push(`${k} too tall (${f.h})`);
      for (let j = k + 1; j < fb.length; j++) if (G.dist(fb[j].c, b.c) < 90 && G.obbOverlap(fb[j], b, 0.5)) bad.push(`${k} overlaps ${j}`);
    });
    const port = L.anchors!.port.origin;
    if (F.some((f) => Math.hypot(f.position[0] - port[0], f.position[2] - port[2]) < 140)) bad.push('fringe at the port viewpoint');
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('keeps the flythrough above ground, clear of signs, and gently climbing', async () => {
    const L = await get();
    const path = new FlythroughPath(L.flythrough!);
    const signs = L.signs!.map((s) => ({ b: G.obb([s.position[0], s.position[2]], [Math.cos(s.rotationY), -Math.sin(s.rotationY)], s.size[0] / 2 + 2, s.size[2] / 2 + 2), y0: s.position[1] - s.size[1] / 2 - (s.legs ?? 0) - 2, y1: s.position[1] + s.size[1] / 2 + 2 }));
    const p = new THREE.Vector3(), q = new THREE.Vector3(), l = new THREE.Vector3();
    const bad: string[] = [];
    const n = 4000;
    path.sampleAt(0, q, l);
    for (let k = 1; k <= n; k++) {
      path.sampleAt(k / n, p, l);
      const u = (k / n).toFixed(3);
      if (p.y < 2.5) bad.push(`u=${u} y=${p.y.toFixed(1)} too low`);
      const run = Math.hypot(p.x - q.x, p.z - q.z);
      if (Math.abs(p.y - q.y) > Math.tan((42 * Math.PI) / 180) * run + 0.05) bad.push(`u=${u} climbs steeper than 42°`);
      for (const s of signs) if (p.y > s.y0 && p.y < s.y1 && G.insideConvex(s.b.corners, [p.x, p.z])) bad.push(`u=${u} within 2 m of a sign`);
      q.copy(p);
    }
    expect([...new Set(bad)].slice(0, 10)).toEqual([]);
  });

  it('paces the flythrough: a slow canyon, a loop of a few minutes, no whip pans', async () => {
    const L = await get();
    const path = new FlythroughPath(L.flythrough!);
    expect(path.duration).toBeGreaterThan(90);
    expect(path.duration).toBeLessThan(300);
    const p = new THREE.Vector3(), l = new THREE.Vector3();
    const dir = new THREE.Vector3(), prev = new THREE.Vector3();
    const dt = 0.1;
    let low = 0, worst = 0;
    for (let t = 0; t < path.duration; t += dt) {
      path.sample(t, p, l);
      if (p.y < 30) low += dt;
      dir.subVectors(l, p).normalize();
      if (t > 0) worst = Math.max(worst, (prev.angleTo(dir) * 180) / Math.PI / dt);
      prev.copy(dir);
    }
    // At least a quarter of the loop at street level; the view never turns faster than 30°/s.
    expect(low / path.duration).toBeGreaterThan(0.25);
    expect(worst).toBeLessThan(30);
    // A seamless loop: one full period later is the same frame.
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    path.sample(37, a, l);
    path.sample(37 + path.duration, b, l);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });
});
