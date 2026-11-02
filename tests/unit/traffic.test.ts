import { describe, expect, it } from 'vitest';
import { trafficLanes, trafficPosition } from '../../art/layouts/lib/traffic.mjs';

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
  it('reproduces loops and frozen-time positions from a seed', () => {
    expect(trafficLanes(roads, 42)).toEqual(trafficLanes(roads, 42));
    const lane = trafficLanes(roads, 42)[0];
    const p = trafficPosition(lane, 0, 12), q = trafficPosition(lane, 0, 12 + lane.length / lane.speed);
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.z).toBeCloseTo(p.z, 6);
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

  it('moves cars continuously on the road, with safe headway and no vanishing', () => {
    for (const lane of trafficLanes(roads, 42)) {
      expect(lane.length / lane.count).toBeGreaterThan(8);
      let prev = trafficPosition(lane, 0, 0);
      for (let t = 0.1; t < lane.length / lane.speed; t += 0.1) {
        const p = trafficPosition(lane, 0, t);
        // No teleports: one step never moves more than the distance driven.
        expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(lane.speed * 0.1 + 1e-6);
        // Heading turns gradually, even through corners and U-turns.
        const turn = Math.abs(((p.angle - prev.angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(turn).toBeLessThan(0.6);
        // On the paved surface: inside some street's half width (U-turns stay within the end).
        const traffic = roads.filter((r) => r.cls !== 'alley');
        expect(Math.min(...traffic.map((r) => segDist([p.x, p.z], r.a, r.b) - r.width / 2))).toBeLessThan(0.5);
        prev = p;
      }
    }
  });
});
