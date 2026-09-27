import { describe, expect, it } from 'vitest';
import { trafficLanes, trafficPosition } from '../../art/layouts/lib/traffic.mjs';

const roads = [
  { a: [0, 0], b: [200, 100], width: 12, cls: 'secondary' },
  { a: [0, 0], b: [100, 0], width: 5, cls: 'alley' },
];
describe('traffic streams', () => {
  it('reproduces lanes and frozen-time positions from a seed', () => {
    expect(trafficLanes(roads, 42)).toEqual(trafficLanes(roads, 42));
    expect(trafficLanes(roads, 43)).not.toEqual(trafficLanes(roads, 42));
    const lane = trafficLanes(roads, 42)[0];
    expect(trafficPosition(lane, 0, 12)).toEqual(trafficPosition(lane, 0, 12 + lane.length / lane.speed));
  });
  it('keeps paired lights inside wide roads and gives traffic safe headway', () => {
    const lanes = trafficLanes(roads, 42);
    expect(lanes).toHaveLength(2);
    for (const lane of lanes) {
      expect(lane.length / lane.count).toBeGreaterThan(8);
      for (const time of [-100, 0, 12, 1000]) {
        const p = trafficPosition(lane, 0, time);
        const cross = Math.abs((p.x * 100 - p.z * 200) / lane.length);
        expect(cross + 0.79).toBeLessThan(6);
        expect(p.visibility).toBeGreaterThanOrEqual(0);
        expect(p.visibility).toBeLessThanOrEqual(1);
      }
    }
  });
});
