import * as THREE from 'three/webgpu';
import { Boxes } from './build';
import type { Plan } from './plan';
import { paletteColor } from './tsl';

const CAR = 19.5, GAP = 0.6, CARS = 4;
/** Seconds: one full cycle, of which the train stands in the station for DWELL. */
const CYCLE = 64, DWELL = 12, RUN = 16;

/**
 * Two trains on the viaduct, one per track, half a cycle apart. Each is a handful of boxes
 * (bodies, lit window bands, lamps) in one instanced mesh moved as a group. Position is a pure
 * function of the clock: run in, brake into the station, stand, pull away.
 */
export function createTrains(plan: Plan, material: THREE.Material): { group: THREE.Group; update(time: number): void } {
  const group = new THREE.Group();
  group.name = 'trains';
  const v = plan.viaduct;
  const length = CARS * (CAR + GAP);
  const body = paletteColor('car_silver').multiplyScalar(0.55), stripe = paletteColor('car_green'), fluor = paletteColor('fluorescent');
  const make = (dir: number, z: number) => {
    const boxes = new Boxes();
    for (let c = 0; c < CARS; c++) {
      const x = (c - (CARS - 1) / 2) * (CAR + GAP);
      boxes.add(x, 2.15, 0, CAR, 3.1, 2.8, body);
      boxes.add(x, 1.0, 0, CAR + 0.02, 0.35, 2.84, stripe);
      // Windows: eight lit panes a side, doors dark between them.
      for (const s of [-1, 1]) for (let w = 0; w < 8; w++) boxes.add(x + (w - 3.5) * 2.25, 2.55, s * 1.41, 1.7, 0.9, 0.03, fluor, 0.75);
      boxes.add(x, 0.35, 0, CAR - 3, 0.5, 2.2, paletteColor('metal_dark'));
    }
    const front = dir * (length / 2 - GAP / 2);
    boxes.add(front + dir * 0.02, 1.3, 0, 0.05, 0.25, 1.6, new THREE.Color(1, 0.95, 0.85), 9);
    boxes.add(-front - dir * 0.02, 1.3, 0, 0.05, 0.2, 1.6, paletteColor('sign_red'), 4);
    const mesh = boxes.build(material);
    mesh.position.set(0, v.y + 0.15, z);
    group.add(mesh);
    return mesh;
  };
  const trains = [{ mesh: make(1, -2.2), dir: 1, offset: 0 }, { mesh: make(-1, 2.2), dir: -1, offset: CYCLE / 2 }];
  const far = (v.x1 - v.x0) / 2 + length;
  const ease = (t: number) => t * t * (3 - 2 * t);
  return {
    group,
    update(time) {
      for (const t of trains) {
        const phase = (((time + t.offset) % CYCLE) + CYCLE) % CYCLE;
        // Along the track: -far → 0 (arrive, easing out), stand, 0 → far (depart, easing in).
        let along: number;
        if (phase < RUN) along = -far * (1 - ease(phase / RUN) * (2 - ease(phase / RUN)));
        else if (phase < RUN + DWELL) along = 0;
        else if (phase < 2 * RUN + DWELL) along = far * ease((phase - RUN - DWELL) / RUN) ** 2;
        else along = far * 2;   // out of sight until the next cycle
        t.mesh.position.x = t.dir * along;
        t.mesh.visible = phase < 2 * RUN + DWELL;
      }
    },
  };
}
