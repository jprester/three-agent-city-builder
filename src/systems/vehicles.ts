import * as THREE from 'three';
import { mulberry32, weightedChoice } from '../../art/layouts/lib/rng.mjs';
import { trafficPosition } from '../../art/layouts/lib/traffic.mjs';
import type { Layout } from './layout';

const CARS: Record<string, number> = { 'vehicles/car_a': 4, 'vehicles/car_b': 4, 'vehicles/taxi': 2, 'vehicles/van': 1 };
const FLYERS: Record<string, number> = { 'vehicles/flyer_a': 2, 'vehicles/flyer_b': 1 };

type Lane = NonNullable<Layout['traffic']>[number];

/** Which vehicles exist: one slot per car / flyer, each with its asset. Deterministic from the layout seed. */
export function planVehicles(layout: Layout, density: number) {
  const rng = mulberry32((layout.seed ^ 0x7e41c1e5) >>> 0);
  const ground = (layout.traffic ?? []).map((lane) => {
    const scaled: Lane = { ...lane, count: Math.max(1, Math.round(lane.count * density)) };
    return { lane: scaled, assets: Array.from({ length: scaled.count }, () => weightedChoice(rng, CARS) as string) };
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
 * Moves the planned vehicles (instances `ids` of the facade batch, in plan order) on the
 * shared clock: cars along their lanes (faded out near junctions), flyers around their loops
 * with a slow bob. Pure function of time, so frozen-time renders are reproducible.
 */
export function createVehicleMotion(batch: THREE.BatchedMesh, ids: number[], plan: ReturnType<typeof planVehicles>) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scale = new THREE.Vector3(), tangent = new THREE.Vector3();
  return {
    update(time: number) {
      let k = 0;
      for (const g of plan.ground) {
        for (let i = 0; i < g.assets.length; i++) {
          const p = trafficPosition(g.lane, i, time);
          pos.set(p.x, 0, p.z);
          q.setFromAxisAngle(up, p.angle);
          scale.setScalar(Math.max(p.visibility, 1e-3));
          batch.setMatrixAt(ids[k++], m.compose(pos, q, scale));
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
  };
}
