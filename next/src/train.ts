import * as THREE from 'three/webgpu';
import { Boxes } from './build';
import type { Plan } from './plan';
import { paletteColor } from './tsl';

const CAR = 14.5, GAP = 0.5, CARS = 3;
const WIDTH = 2.6, HEIGHT = 2.9;
/** Seconds: one full cycle, of which the train stands in the station for DWELL. */
const CYCLE = 64, DWELL = 12, RUN = 16;

/**
 * Two suspended monorail trains, one per girder, half a cycle apart. A train is a set of boxes
 * in one instanced mesh, built with the car floor at y = 0 and hung from the girder by its
 * bogie struts: white hull, a dark window band with lit panes, a cyan line along the skirt,
 * tapered ends with a headlamp bar. Position is a pure function of the clock: run in, brake
 * into the station, stand, pull away.
 */
export function createTrains(plan: Plan, material: THREE.Material): { group: THREE.Group; update(time: number): void } {
  const group = new THREE.Group();
  group.name = 'trains';
  const m = plan.monorail;
  const length = CARS * (CAR + GAP);
  const hull = paletteColor('car_white').multiplyScalar(0.62), glass = paletteColor('glass_dark').multiplyScalar(1.6);
  const fluor = paletteColor('fluorescent'), cyan = paletteColor('sign_cyan'), strut = paletteColor('metal_dark').multiplyScalar(2);
  const make = (dir: number, z: number) => {
    const boxes = new Boxes();
    for (let c = 0; c < CARS; c++) {
      const x = (c - (CARS - 1) / 2) * (CAR + GAP);
      boxes.add(x, HEIGHT / 2, 0, CAR, HEIGHT, WIDTH, hull);
      boxes.add(x, 1.75, 0, CAR - 0.5, 1.15, WIDTH + 0.02, glass);                                   // window band
      for (const s of [-1, 1]) {
        // Lit panes in the band, doors dark between them; a light line along the skirt.
        for (let w = 0; w < 5; w++) boxes.add(x + (w - 2) * 2.7, 1.75, s * (WIDTH / 2 + 0.015), 2.1, 0.95, 0.02, fluor, 0.7);
        boxes.add(x, 0.12, s * (WIDTH / 2 + 0.015), CAR - 0.4, 0.05, 0.02, cyan, 1.5);
      }
      // Two bogie struts up into the girder.
      for (const o of [-CAR * 0.3, CAR * 0.3]) boxes.add(x + o, HEIGHT + 0.4, 0, 1.6, 0.8, 0.7, strut);
    }
    // Tapered ends: two shrinking sections, a dark windscreen, a lamp bar (white ahead, red behind).
    for (const e of [-1, 1]) {
      const tip = e * length / 2 - e * GAP / 2;
      boxes.add(tip + e * 0.55, HEIGHT * 0.47, 0, 1.1, HEIGHT * 0.86, WIDTH * 0.9, hull);
      boxes.add(tip + e * 1.35, HEIGHT * 0.42, 0, 0.6, HEIGHT * 0.66, WIDTH * 0.72, hull);
      boxes.add(tip + e * 1.12, HEIGHT * 0.6, 0, 0.08, HEIGHT * 0.4, WIDTH * 0.8, glass);
      const ahead = e === dir;
      boxes.add(tip + e * 1.66, 0.55, 0, 0.04, 0.1, WIDTH * 0.6, ahead ? new THREE.Color(1, 0.96, 0.88) : paletteColor('sign_red'), ahead ? 9 : 4);
    }
    const mesh = boxes.build(material);
    mesh.position.set(0, m.floorY, z);
    group.add(mesh);
    return mesh;
  };
  const trains = [{ mesh: make(1, -m.trackZ), dir: 1, offset: 0 }, { mesh: make(-1, m.trackZ), dir: -1, offset: CYCLE / 2 }];
  const far = (m.x1 - m.x0) / 2 + length;
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
