import { mulberry32 } from './rng.mjs';

/** Sparse opposing streams on wider roads. Fixed headway prevents same-lane overlap. */
export function trafficLanes(roads, seed, density = 1) {
  const rng = mulberry32(seed ^ 0x74726166);
  return roads.filter(r => r.width >= 9 && r.cls !== 'alley').flatMap(r => {
    const length = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    if (length < 35) return [];
    return [-1, 1].map(direction => ({
      a: r.a, b: r.b, length, direction, offset: r.width * 0.22,
      count: Math.max(1, Math.floor(length / (85 / density))),
      speed: 5 + rng() * 4, phase: rng(),
    }));
  });
}

export function trafficPosition(lane, index, time) {
  const travel = ((lane.phase + index / lane.count + time * lane.speed / lane.length) % 1 + 1) % 1;
  const t = lane.direction === 1 ? travel : 1 - travel;
  const dx = (lane.b[0] - lane.a[0]) / lane.length, dz = (lane.b[1] - lane.a[1]) / lane.length;
  return {
    x: lane.a[0] + dx * t * lane.length - dz * lane.offset * lane.direction,
    z: lane.a[1] + dz * t * lane.length + dx * lane.offset * lane.direction,
    angle: Math.atan2(dx * lane.direction, dz * lane.direction),
    // Fade streams at junction endpoints rather than visibly teleporting them.
    visibility: Math.min(1, t * lane.length / 8, (1 - t) * lane.length / 8),
  };
}
