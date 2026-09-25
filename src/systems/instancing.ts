import * as THREE from 'three';
import { AssetLoader, getAsset } from '../assets/registry';
import type { Layout, LayoutInstance } from './layout';

const Y = new THREE.Vector3(0, 1, 0);

function instanceMatrix(i: LayoutInstance): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...i.position),
    new THREE.Quaternion().setFromAxisAngle(Y, i.rotationY),
    new THREE.Vector3(i.scale, i.scale, i.scale),
  );
}

/**
 * One InstancedMesh per (asset, mesh) pair. A layout with 100 towers of 3 kinds
 * costs a handful of draw calls, not 100.
 */
export async function buildInstances(layout: Layout, loader: AssetLoader) {
  const group = new THREE.Group();
  group.name = `layout:${layout.name}`;
  const missing: string[] = [];

  const byAsset = new Map<string, LayoutInstance[]>();
  for (const inst of layout.instances) {
    const list = byAsset.get(inst.asset) ?? [];
    list.push(inst);
    byAsset.set(inst.asset, list);
  }

  await Promise.all(
    [...byAsset].map(async ([id, list]) => {
      const entry = getAsset(id);
      if (!entry) {
        missing.push(id);
        return;
      }
      const gltf = await loader.load(entry);
      gltf.scene.updateMatrixWorld(true);
      const matrices = list.map(instanceMatrix);
      const tmp = new THREE.Matrix4();

      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
        matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, mesh.matrixWorld)));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.name = `${id}:${mesh.name}`;
        group.add(im);
      });
    }),
  );

  return { group, missing };
}
