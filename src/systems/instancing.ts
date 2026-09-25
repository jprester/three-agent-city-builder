import * as THREE from 'three';
import { AssetLoader, getAsset } from '../assets/registry';
import { buildFacadeBatch } from './buildings';
import type { Layout, LayoutInstance } from './layout';

const Y = new THREE.Vector3(0, 1, 0);
const LAMP = 'props/street_lamp';

export function instanceMatrix(i: LayoutInstance): THREE.Matrix4 {
  const s = typeof i.scale === 'number' ? new THREE.Vector3(i.scale, i.scale, i.scale) : new THREE.Vector3(...i.scale);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...i.position),
    new THREE.Quaternion().setFromAxisAngle(Y, i.rotationY),
    s,
  );
}

/**
 * Facade-shaded assets (meta.shader === "facade") go into one BatchedMesh with the shared
 * facade material; anything else gets one InstancedMesh per (asset, mesh) with its own
 * glTF materials.
 */
export async function buildInstances(layout: Layout, loader: AssetLoader, facadeMaterial: THREE.Material) {
  const group = new THREE.Group();
  group.name = `layout:${layout.name}`;
  const missing = new Set<string>();

  const facade: LayoutInstance[] = [];
  const byAsset = new Map<string, LayoutInstance[]>();
  for (const inst of layout.instances) {
    const entry = getAsset(inst.asset);
    if (!entry) { missing.add(inst.asset); continue; }
    if (entry.meta.shader === 'facade') { facade.push(inst); continue; }
    const list = byAsset.get(inst.asset) ?? [];
    list.push(inst);
    byAsset.set(inst.asset, list);
  }
  // Street lamps from the layout's lamp list join the same batch.
  if (layout.lamps?.length && getAsset(LAMP)) {
    for (const [x, z, angle] of layout.lamps) facade.push({ asset: LAMP, position: [x, 0, z], rotationY: angle, scale: 1 });
  }
  if (facade.length) group.add(await buildFacadeBatch(facade, loader, facadeMaterial));

  await Promise.all(
    [...byAsset].map(async ([id, list]) => {
      const gltf = await loader.load(getAsset(id)!);
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

  return { group, missing: [...missing] };
}
