import { describe, expect, it } from 'vitest';
import * as G from '../../art/layouts/lib/geom.mjs';
import { sampleFlythrough } from '../../art/layouts/lib/paths.mjs';
import { MONORAIL_DEFAULTS, hitsEnvelope, hitsGround, routeJunctions, toRoute, trainAt, trainCars } from '../../art/layouts/lib/monorail.mjs';
import def from '../../art/layouts/defs/city.json';
import { ASSETS } from '../../src/assets/manifest.gen';
import { generateLayout, type Layout, type Monorail } from '../../src/systems/layout';

const meta = (id: string) => (ASSETS[id as keyof typeof ASSETS]?.meta ?? {}) as Record<string, unknown>;

describe.each([def.seed, 1, 777])('monorail, seed %i', (seed) => {
  let layout: Layout;
  const get = async () => (layout ??= await generateLayout('city', seed));
  const line = async () => (await get()).monorail as Monorail;

  it('runs straight down one arterial, between end piers just inside its junctions', async () => {
    const L = await get(), m = await line();
    expect(m).toBeTruthy();
    const road = L.roads!.find((r) => r.id === m.road)!;
    expect(road.cls).toBe('arterial');
    // Every piece sits on the route's centre line or within the station's width of it.
    for (const p of m.parts) {
      const [s, v] = toRoute(m, p.position[0], p.position[2]);
      expect(s).toBeGreaterThan(-1);
      expect(s).toBeLessThan(m.length + 1);
      expect(Math.abs(v)).toBeLessThan(0.005);
    }
    const piers = m.piers;
    for (let k = 1; k < piers.length; k++) {
      expect(piers[k] - piers[k - 1]).toBeGreaterThanOrEqual(12);
      expect(piers[k] - piers[k - 1]).toBeLessThanOrEqual(MONORAIL_DEFAULTS.maxSpan + 0.01);
    }
    expect(piers[piers.length - 1] - piers[0]).toBeGreaterThan(m.length * 0.8);
  });

  it('keeps every pier out of junctions', async () => {
    const L = await get(), m = await line();
    const road = L.roads!.find((r) => r.id === m.road)!;
    const a = m.origin, b = G.add(m.origin, G.mul(m.dir, m.length));
    const junctions = routeJunctions({ a, b, road: { ...road, a, b } }, L.roads!);
    const bad = m.piers.filter((s) => junctions.some(([js, jh]) => Math.abs(s - js) < jh + MONORAIL_DEFAULTS.junctionClear - 0.01));
    expect(bad).toEqual([]);
    // Medians stop short of junctions too.
    for (const [s0, s1] of m.medians) expect(junctions.some(([js, jh]) => js + jh > s0 + 0.5 && js - jh < s1 - 0.5)).toBe(false);
  });

  it('stands the station on sidewalks, in the old core, with no main road under it', async () => {
    const L = await get(), m = await line();
    const { s, flip } = m.station;
    const at = (u: number, v: number) => G.add(G.add(m.origin, G.mul(m.dir, s + flip * u)), G.mul(G.perp(m.dir), flip * v));
    const ground = m.parts.flatMap((p) => {
      const g = (meta(p.asset).ground ?? []) as number[][];
      const [ps] = toRoute(m, p.position[0], p.position[2]);
      return g.map(([u0, u1, v0, v1]) => [u0 + flip * (ps - s), u1 + flip * (ps - s), v0, v1]);
    });
    expect(ground.length).toBeGreaterThan(10);
    const off: string[] = [];
    for (const [u0, u1, v0, v1] of ground) {
      for (const u of [u0, (u0 + u1) / 2, u1]) for (const v of [v0, v1]) {
        if (!L.blocks.some((bl) => G.insideConvex(bl.points, at(u, v), 0.05))) off.push(`${u.toFixed(1)},${v.toFixed(1)}`);
      }
    }
    expect(off).toEqual([]);
  });

  it('leaves nothing inside its envelope: signs, footbridges, lamps, props, parked cars, signals', async () => {
    const L = await get(), m = await line();
    const fp = (i: { asset: string; fp?: number[] }) => i.fp ?? ((meta(i.asset).footprint as number[]) ?? [1, 1]).map((x) => x / 2);
    const bad: string[] = [];
    for (const sg of L.signs ?? []) if (hitsEnvelope(m, sg.position, sg.rotationY, [sg.size[0] + 2 * (sg.arm ?? 0), sg.size[1] + 2 * (sg.legs ?? 0), sg.size[2]])) bad.push(`sign at ${sg.position.map(Math.round)}`);
    for (const b of L.bridges ?? []) {
      const d = G.sub(b.b, b.a), c = G.lerp(b.a, b.b, 0.5);
      if (hitsEnvelope(m, [c[0], b.y + b.depth / 2, c[1]], Math.atan2(-d[1], d[0]), [G.len(d), b.depth, b.width])) bad.push('footbridge');
    }
    for (const [x, z] of L.lamps ?? []) if (hitsGround(m, x, z, 0, 0.4, 0.4)) bad.push(`lamp at ${Math.round(x)},${Math.round(z)}`);
    for (const p of [...(L.props ?? []), ...(L.parked ?? []), ...(L.trees ?? [])]) {
      if (hitsGround(m, p.position[0], p.position[2], p.rotationY, ...(fp(p) as [number, number]))) bad.push(`${p.asset} at ${p.position.map(Math.round)}`);
    }
    for (const [x, z] of L.signals ?? []) if (hitsGround(m, x, z, 0, 0.3, 0.3)) bad.push('signal');
    expect(bad).toEqual([]);
  });

  it('keeps the flythrough out of the structure', async () => {
    const L = await get(), m = await line();
    const pts = sampleFlythrough(L.flythrough);
    const hits = pts.filter((p) => hitsEnvelope(m, p, 0, [1.5, 1.5, 1.5]));
    expect(hits.length).toBe(0);
  });

  it('runs its trains as a pure function of time, standing at the station at the frozen time', async () => {
    const m = await line();
    for (const t of [0, 7.5, 33, 140, 1e4]) expect(trainCars(m, 1, t)).toEqual(trainCars(m, 1, t));
    const stop = trainAt(m, 0, m.trains.frozenStop);
    expect(stop.s).toBeCloseTo(m.station.s, 6);
    // On the station's south platform side (station frame v < 0).
    expect(Math.sign(stop.v) * m.station.flip).toBe(-1);
    // Within the line at all times, and the two trains on different girders.
    for (let t = 0; t < 400; t += 3.7) {
      for (const k of [0, 1]) {
        const p = trainAt(m, k, t);
        expect(p.s).toBeGreaterThanOrEqual(m.trains.ends[0] - 1e-6);
        expect(p.s).toBeLessThanOrEqual(m.trains.ends[1] + 1e-6);
      }
      expect(trainAt(m, 0, t).v).toBe(-trainAt(m, 1, t).v);
    }
    // Moves smoothly: never more than cruise speed between samples.
    for (let t = 0; t < 300; t += 0.5) expect(Math.abs(trainAt(m, 1, t + 0.5).s - trainAt(m, 1, t).s)).toBeLessThanOrEqual(m.trains.cruise * 0.5 + 1e-6);
  });
});

describe('monorail pieces agree with the layout', () => {
  it('builds the dimensions the layout assumes', () => {
    const D = MONORAIL_DEFAULTS, c = D.car;
    const doorXs: number[] = [];
    for (let k = 0; k < c.count; k++) for (const d of [-3.6, 3.6]) doorXs.push((k - (c.count - 1) / 2) * (c.length + c.gap) + d);
    expect(meta(D.assets.screensN).door_xs).toEqual(doorXs);
    expect(meta(D.assets.carEnd).length).toBe(c.length);
    expect(meta(D.assets.carEnd).nose).toBe(c.nose);
    expect(meta(D.assets.carMid).length).toBe(c.length);
    expect(meta(D.assets.girder).span).toBe(30);
    // Balustrade openings where the stairs arrive.
    (meta(D.assets.platformS).opening as number[]).forEach((x, i) => expect(x).toBeCloseTo((meta(D.assets.accessS).opening as number[])[i], 6));
    const [low0] = meta(D.assets.accessN).landing_u as number[];
    const north = meta(D.assets.platformN).opening as number[];
    expect(low0 - (meta(D.assets.accessN).stair_run as number)).toBeCloseTo(north[1], 6);
    // The trains hang from the girder: hangers reach into it, the car's underside clears 7.7 m.
    expect(meta(D.assets.carEnd).height as number).toBeGreaterThan(D.beamY - D.floorY);
    expect(D.floorY - 0.3).toBeGreaterThanOrEqual(7.7);
  });
});
