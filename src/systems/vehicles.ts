import * as THREE from 'three';
import { mulberry32, weightedChoice } from '../../art/layouts/lib/rng.mjs';
import { trafficPosition } from '../../art/layouts/lib/traffic.mjs';
import type { Layout } from './layout';
import type { DynamicInstances } from './buildings';

const CARS: Record<string, number> = {
  'vehicles/car_a': 4, 'vehicles/car_b': 3, 'vehicles/car_c': 2, 'vehicles/car_d': 1, 'vehicles/suv': 2,
  'vehicles/kei': 3, 'vehicles/taxi': 1.5, 'vehicles/taxi_b': 1.5, 'vehicles/van': 1, 'vehicles/box_truck': 1,
};
const FLYERS: Record<string, number> = { 'vehicles/flyer_a': 2, 'vehicles/flyer_b': 1 };

type Lane = NonNullable<Layout['traffic']>[number];

/** Which vehicles exist: one slot per car / flyer, each with its asset. Deterministic from the layout seed. */
export function planVehicles(layout: Layout, density: number) {
  const rng = mulberry32((layout.seed ^ 0x7e41c1e5) >>> 0);
  const ground = (layout.traffic ?? []).map((lane) => {
    const scaled: Lane = { ...lane, count: Math.max(1, Math.round(lane.count * density)) };
    const assets = Array.from({ length: scaled.count }, () => weightedChoice(rng, CARS) as string);
    // Paint pick per car, read by the facade shader from a height scale of 1 + paint / 64.
    return { lane: scaled, assets, paints: assets.map(() => 0.001 + 0.998 * rng()) };
  });
  const sky = (layout.skyLanes ?? []).map((lane) => {
    const curve = new THREE.CatmullRomCurve3(lane.points.map((p) => new THREE.Vector3(...p)), lane.closed);
    return {
      lane, curve, length: curve.getLength(),
      assets: Array.from({ length: lane.count }, () => weightedChoice(rng, FLYERS) as string),
      phases: Array.from({ length: lane.count }, (_, i) => (i + 0.35 * rng()) / lane.count),
    };
  });
  const assets = [...ground.flatMap((g) => g.assets), ...sky.flatMap((s) => s.assets)];
  return { ground, sky, assets };
}

/**
 * Moves the planned vehicles (instances `ids` of the facade instances, in plan order) on the
 * shared clock: cars around their street loops, flyers around their loops
 * with a slow bob. Pure function of time, so frozen-time renders are reproducible.
 */
export function createVehicleMotion(batch: DynamicInstances, ids: number[], plan: ReturnType<typeof planVehicles>) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scale = new THREE.Vector3(), tangent = new THREE.Vector3();
  const cars = plan.ground.reduce((s, g) => s + g.assets.length, 0);
  /** Ground cars this frame: x, z, heading sin, heading cos. */
  const placed = new Float32Array(cars * 4);
  const best = new Float32Array(64), bestIdx = new Int32Array(64);
  return {
    update(time: number) {
      let k = 0, c = 0;
      for (const g of plan.ground) {
        for (let i = 0; i < g.assets.length; i++) {
          const p = trafficPosition(g.lane, i, time);
          placed[4 * c] = p.x; placed[4 * c + 1] = p.z;
          placed[4 * c + 2] = Math.sin(p.angle); placed[4 * c + 3] = Math.cos(p.angle); c++;
          pos.set(p.x, 0, p.z);
          q.setFromAxisAngle(up, p.angle);
          batch.setMatrixAt(ids[k++], m.compose(pos, q, scale.set(1, 1 + g.paints[i] / 64, 1)));
        }
      }
      for (const s of plan.sky) {
        const dir = s.lane.direction;
        for (let i = 0; i < s.assets.length; i++) {
          const u = (((s.phases[i] + (dir * time * s.lane.speed) / s.length) % 1) + 1) % 1;
          s.curve.getPointAt(u, pos);
          s.curve.getTangentAt(u, tangent).multiplyScalar(dir);
          pos.y += Math.sin(time * 0.6 + i * 2.1) * 1.2;
          q.setFromAxisAngle(up, Math.atan2(tangent.x, tangent.z));
          batch.setMatrixAt(ids[k++], m.compose(pos, q, scale.setScalar(1)));
        }
      }
    },
    /** Writes the `out.length` ground cars nearest to `eye` (as of the last update) into `out`. */
    nearest(eye: THREE.Vector3, out: THREE.Vector4[]) {
      const n = Math.min(out.length, 64);
      let filled = 0;
      for (let c = 0; c < cars; c++) {
        const dx = placed[4 * c] - eye.x, dz = placed[4 * c + 1] - eye.z, d2 = dx * dx + dz * dz;
        if (filled === n && d2 >= best[n - 1]) continue;
        // Insertion into the sorted short list.
        let j = filled < n ? filled++ : n - 1;
        while (j > 0 && best[j - 1] > d2) { best[j] = best[j - 1]; bestIdx[j] = bestIdx[j - 1]; j--; }
        best[j] = d2; bestIdx[j] = c;
      }
      for (let j = 0; j < out.length; j++) {
        if (j < filled) out[j].fromArray(placed, 4 * bestIdx[j]);
        else out[j].set(0, 0, 0, 0);
      }
    },
  };
}

export type VehicleMotion = ReturnType<typeof createVehicleMotion>;
