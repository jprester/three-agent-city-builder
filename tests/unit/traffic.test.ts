import { describe, expect, it } from 'vitest';
import { createTrafficSim, signalAt, trafficLanes } from '../../art/layouts/lib/traffic.mjs';

// An arterial with side streets ending at its curb (a crossing and a T), a top street the
// side streets meet, and an alley that carries no traffic.
const roads = [
  { id: 0, a: [-150, 0], b: [150, 0], width: 20, cls: 'arterial' },
  { id: 1, a: [0, 10], b: [0, 107], width: 14, cls: 'secondary' },
  { id: 2, a: [0, -10], b: [0, -120], width: 14, cls: 'secondary' },
  { id: 3, a: [-90, 10], b: [-90, 107], width: 14, cls: 'secondary' },
  { id: 4, a: [-150, 114], b: [150, 114], width: 14, cls: 'secondary' },
  { id: 5, a: [60, 10], b: [60, 107], width: 5, cls: 'alley' },
];

const segDist = (p: number[], a: number[], b: number[]) => {
  const d = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2)));
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t);
};

describe('traffic loops', () => {
  it('reproduces loops, and the same frozen-time state from a fresh simulation', () => {
    expect(trafficLanes(roads, 42)).toEqual(trafficLanes(roads, 42));
    const lanes = trafficLanes(roads, 42);
    const a = createTrafficSim(lanes), b = createTrafficSim(lanes);
    const wa = a.at(12), wb = b.at(12);
    for (let k = 0; k < lanes.length; k++) for (let i = 0; i < lanes[k].count; i++) expect(a.pose(k, i, wa)).toEqual(b.pose(k, i, wb));
  });

  it('puts stop lines before the signalled junctions, with two signal phases', () => {
    const lanes = trafficLanes(roads, 42);
    const stops = lanes.flatMap((l) => l.stops);
    // The arterial crossing and T-junctions are signalled; plain corners are not.
    expect(stops.length).toBeGreaterThan(6);
    expect(new Set(stops.map((st) => st[2]))).toEqual(new Set([0, 1]));
    // The two phases are never green at once.
    for (let t = 0; t < 36; t += 0.5) expect(signalAt(3, 0, t) === 'green' && signalAt(3, 1, t) === 'green').toBe(false);
  });

  it('drives every lane of every street once, alleys never', () => {
    const lanes = trafficLanes(roads, 42);
    const used = lanes.flatMap((l) => l.roads);
    expect(new Set(used)).toEqual(new Set([0, 1, 2, 3, 4]));
    // Both directions of every street, about once: loop length ≈ twice the street lengths.
    const streets = 300 + 107 + 120 + 97 + 300;
    const total = lanes.reduce((s, l) => s + l.length, 0);
    expect(total).toBeGreaterThan(2 * streets * 0.9);
    expect(total).toBeLessThan(2 * streets * 1.15);
  });

  it('moves cars continuously on the road, keeps them apart and stops them at red lights', () => {
    const lanes = trafficLanes(roads, 42);
    const sim = createTrafficSim(lanes);
    const traffic = roads.filter((r) => r.cls !== 'alley');
    const prev = lanes.map((l, k) => Array.from({ length: l.count }, (_, i) => sim.pose(k, i, sim.at(0))));
    const front = (k: number, i: number) => sim.lanes[k].s[i] + 2.4;
    let redRuns = 0;
    for (let t = 1 / 30; t < 90; t += 1 / 30) {
      const before = lanes.map((_, k) => Array.from(sim.lanes[k].s, (_, i) => front(k, i)));
      const w = sim.at(t);
      lanes.forEach((lane, k) => {
        const c = sim.lanes[k];
        for (let i = 0; i < lane.count; i++) {
          const p = sim.pose(k, i, w), q = prev[k][i];
          // No teleports, gentle turns, on the paved surface.
          expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(20 / 30);
          expect(Math.abs(((p.angle - q.angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThan(0.6);
          expect(Math.min(...traffic.map((r) => segDist([p.x, p.z], r.a, r.b) - r.width / 2))).toBeLessThan(0.5);
          // Never closer than a car length to the car ahead.
          if (lane.count > 1) {
            const j = (i + 1) % lane.count;
            expect(c.s[j] + (j === 0 ? lane.length : 0) - c.s[i]).toBeGreaterThan(4.8);
          }
          // Crossing a stop line on red, more than a second after the light turned: a red run.
          const L = lane.length, f0 = ((before[k][i] % L) + L) % L, f1 = f0 + (front(k, i) - before[k][i]);
          for (const [st, node, group] of lane.stops) {
            const sAt = st < f0 ? st + L : st;
            if (sAt > f0 && sAt <= f1 && signalAt(node, group, t) === 'red' && signalAt(node, group, t - 1) === 'red') redRuns++;
          }
          prev[k][i] = p;
        }
      });
    }
    expect(redRuns).toBe(0);
  });
});
