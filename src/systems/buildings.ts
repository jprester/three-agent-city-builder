import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetLoader, getAsset } from '../assets/registry';
import { instanceMatrix } from './instancing';
import type { LayoutInstance } from './layout';

/** Attributes the facade material reads; everything else is dropped. */
const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3 } as const;

/**
 * All facade-shaded instances in one BatchedMesh: one geometry per asset, one draw call
 * (multi-draw), per-instance frustum culling and front-to-back sorting.
 */
export async function buildFacadeBatch(instances: LayoutInstance[], loader: AssetLoader, material: THREE.Material) {
  const byAsset = new Map<string, LayoutInstance[]>();
  for (const inst of instances) {
    const list = byAsset.get(inst.asset) ?? [];
    list.push(inst);
    byAsset.set(inst.asset, list);
  }
  const geometries = new Map<string, THREE.BufferGeometry>();
  await Promise.all([...byAsset.keys()].map(async (id) => {
    const gltf = await loader.load(getAsset(id)!);
    geometries.set(id, flatten(gltf.scene));
  }));

  let vertices = 0, indices = 0;
  for (const g of geometries.values()) {
    vertices += g.getAttribute('position').count;
    indices += g.getIndex()!.count;
  }
  const batch = new THREE.BatchedMesh(instances.length, vertices, indices, material);
  batch.name = 'facade-batch';
  batch.perObjectFrustumCulled = true;
  batch.sortObjects = true;
  for (const [id, list] of byAsset) {
    const gid = batch.addGeometry(geometries.get(id)!);
    for (const inst of list) batch.setMatrixAt(batch.addInstance(gid), instanceMatrix(inst));
  }
  batch.computeBoundingSphere();
  return batch;
}

/** Merge every mesh of a glTF scene into one float, indexed geometry in scene space. */
function flatten(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const g = new THREE.BufferGeometry();
    for (const [name, size] of Object.entries(ATTRIBUTES)) {
      const a = src.getAttribute(name);
      const n = src.getAttribute('position').count;
      const out = new Float32Array(n * size);
      if (a) for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(out, size));
    }
    const index = src.getIndex();
    const count = src.getAttribute('position').count;
    g.setIndex(index ? Array.from(index.array as ArrayLike<number>) : [...Array(count).keys()]);
    // Dequantize (KHR_mesh_quantization lives in the node matrix) into scene space.
    g.applyMatrix4(mesh.matrixWorld);
    parts.push(g);
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
