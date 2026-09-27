import * as THREE from 'three';
import palette from '../../art/style/palette.json';
import { trafficLanes, trafficPosition } from '../../art/layouts/lib/traffic.mjs';
import type { Layout } from '../systems/layout';

/** Distant ground traffic represented by head/taillight pairs, two instanced draws. */
export function createTraffic(layout: Layout, density: number) {
  const lanes = trafficLanes(layout.roads ?? [], layout.seed, density);
  const count = lanes.reduce((n: number, lane: { count: number }) => n + lane.count, 0);
  const group = new THREE.Group();
  group.name = 'traffic';
  // Two lamps, with a dark gap: no individual point lights or shadow maps.
  const geometry = new THREE.BoxGeometry(0.28, 0.14, 0.08);
  const front = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.fluorescent).multiplyScalar(2.2) }), count * 2);
  const rear = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.sign_red).multiplyScalar(1.4) }), count * 2);
  front.frustumCulled = rear.frustumCulled = false;
  front.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rear.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(front, rear);
  const object = new THREE.Object3D();
  function update(time: number) {
    let index = 0;
    for (const lane of lanes) for (let i = 0; i < lane.count; i++) {
      const p = trafficPosition(lane, i, time);
      const sin = Math.sin(p.angle), cos = Math.cos(p.angle);
      object.rotation.y = p.angle;
      object.scale.setScalar(p.visibility);
      for (const side of [-1, 1]) {
        for (const [mesh, end] of [[front, 1], [rear, -1]] as const) {
          object.position.set(p.x + cos * side * 0.65 + sin * end * 1.8, 0.65, p.z - sin * side * 0.65 + cos * end * 1.8);
          object.updateMatrix();
          mesh.setMatrixAt(index, object.matrix);
        }
        index++;
      }
    }
    front.instanceMatrix.needsUpdate = rear.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}
