import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import * as G from '../../art/layouts/lib/geom.mjs';
import def from '../../art/layouts/defs/city.json';
import { ASSETS } from '../../src/assets/manifest.gen';
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
    const bad = L.signs!.filter((s) => !s.roof).filter((s) => {
      const b = L.instances[s.building] as LayoutInstance & { road?: number; interior?: boolean };
      if (!b || b.interior || b.road === undefined || b.road < 0) return true;
      const t = b.rotationY;
      const u: Vec2 = [Math.cos(t), -Math.sin(t)], v: Vec2 = [Math.sin(t), Math.cos(t)];
      const [hu, hv] = b.fp!;
      const rel = G.sub([s.position[0], s.position[2]], [b.position[0], b.position[2]]);
      const out = G.dot(rel, v) - hv;          // distance of the sign center in front of the face
      const along = G.dot(rel, u);
      // Blades start just off the wall and reach out by their width; panels hug the wall.
      const gap = s.kind === 'blade' ? out - s.size[0] / 2 : out + (s.inset ?? 0);
      return gap < 0.05 || gap > 0.5 || Math.abs(along) > hu || s.position[1] + s.size[1] / 2 > b.h!;
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

  it('keeps tower signs in their zones (street, billboard 15–65 m, shaft, crown)', async () => {
    const L = await get();
    const wrong = L.signs!.filter((s) => s.zone).filter((s) => {
      const b = L.instances[s.building];
      const y0 = s.position[1] - s.size[1] / 2, y1 = s.position[1] + s.size[1] / 2;
      switch (s.zone) {
        case 'street': return y1 > 12 + 0.01 || y0 < 4;
        case 'billboard': return y0 < 15 - 0.01 || y1 > 65 + 0.01;
        case 'shaft': return y0 < 65 || s.size[0] / s.size[1] > 0.46 || y1 > b.h! - 5;
        case 'crown': {
          // On the top tier (tower height also counts spires and masts above it).
          const tiers = (ASSETS[b.asset as keyof typeof ASSETS].meta as { tiers: number[][] }).tiers;
          const sy = Array.isArray(b.scale) ? b.scale[1] : b.scale;
          const top = tiers[tiers.length - 1];
          return y0 < top[0] * sy - 0.01 || y1 > top[1] * sy + 0.01 || s.brand === undefined;
        }
        default: return true;
      }
    });
    expect(wrong.map((s) => [s.zone, s.position[1], s.size])).toEqual([]);
    expect(L.signs!.filter((s) => s.stroke && s.brand === undefined)).toEqual([]);
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
    const boxes = L.instances.map((i) => ({ i, b: G.obb([i.position[0], i.position[2]], [Math.cos(i.rotationY), -Math.sin(i.rotationY)], i.fp![0] + 3, i.fp![1] + 3) }));
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
});
