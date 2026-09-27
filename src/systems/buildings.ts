import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ASSETS } from '../assets/manifest.gen';
import { AssetLoader, getAsset } from '../assets/registry';
import type { AssetMeta } from '../assets/types';
import { instanceMatrix } from './instancing';
import type { LayoutInstance } from './layout';

/** Attributes the facade material reads; everything else is dropped. */
const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3 } as const;

/** Runtime level-of-detail control for the facade batch. */
export interface FacadeLod {
  /**
   * Pick each instance's geometry by distance from `camera`: full detail near, the asset's
   * LOD variants (meta.lodOf) beyond their meta.lodDistance × `bias`. Call before every
   * render that uses a different camera or bias (e.g. the reflection pass with bias < 1).
   */
  update(camera: THREE.Camera, bias?: number): void;
}

/**
 * All facade-shaded instances in one BatchedMesh: one geometry per asset (plus its LOD
 * variants), one draw call (multi-draw), per-instance frustum culling and sorting.
 */
export async function buildFacadeBatch(instances: LayoutInstance[], loader: AssetLoader, material: THREE.Material, dynamic: string[] = []) {
  const byAsset = new Map<string, LayoutInstance[]>();
  for (const inst of instances) {
    const list = byAsset.get(inst.asset) ?? [];
    list.push(inst);
    byAsset.set(inst.asset, list);
  }
  // LOD variants built by the pipeline for each placed asset, nearest first.
  const lodsOf = new Map<string, { id: string; distance: number }[]>();
  for (const id of byAsset.keys()) {
    const lods = Object.entries(ASSETS)
      .filter(([, e]) => (e.meta as AssetMeta).lodOf === id)
      .map(([lid, e]) => ({ id: lid, distance: Number((e.meta as AssetMeta).lodDistance ?? Infinity) }))
      .sort((a, b) => a.distance - b.distance);
    if (lods.length) lodsOf.set(id, lods);
  }
  const ids = [...new Set([...byAsset.keys(), ...[...lodsOf.values()].flat().map((l) => l.id), ...dynamic])];
  const geometries = new Map<string, THREE.BufferGeometry>();
  await Promise.all(ids.map(async (id) => {
    const gltf = await loader.load(getAsset(id)!);
    geometries.set(id, flatten(gltf.scene));
  }));

  let vertices = 0, indices = 0;
  for (const g of geometries.values()) {
    vertices += g.getAttribute('position').count;
    indices += g.getIndex()!.count;
  }
  const batch = new THREE.BatchedMesh(instances.length + dynamic.length, vertices, indices, material);
  batch.name = 'facade-batch';
  batch.perObjectFrustumCulled = true;
  batch.sortObjects = true;
  const gidOf = new Map<string, number>();
  for (const id of ids) gidOf.set(id, batch.addGeometry(geometries.get(id)!));
  // Per instance: position and the (geometry id, switch distance²) ladder, full detail first.
  const tracked: { instance: number; pos: THREE.Vector3; ladder: { gid: number; d2: number }[]; current: number }[] = [];
  for (const [id, list] of byAsset) {
    const gid = gidOf.get(id)!;
    const ladder = [{ gid, d2: 0 }, ...(lodsOf.get(id) ?? []).map((l) => ({ gid: gidOf.get(l.id)!, d2: l.distance * l.distance }))];
    for (const inst of list) {
      const instance = batch.addInstance(gid);
      batch.setMatrixAt(instance, instanceMatrix(inst));
      if (ladder.length > 1) tracked.push({ instance, pos: new THREE.Vector3(...inst.position), ladder, current: gid });
    }
  }
  // Moving instances (vehicles), placed by their motion system every frame. Their paths
  // leave the static bounding sphere, so the batch as a whole is never culled.
  const dynamicIds = dynamic.map((id) => batch.addInstance(gidOf.get(id)!));
  batch.computeBoundingSphere();
  if (dynamic.length) batch.frustumCulled = false;

  const eye = new THREE.Vector3();
  const lod: FacadeLod = {
    update(camera, bias = 1) {
      eye.setFromMatrixPosition(camera.matrixWorld);
      const b2 = bias * bias;
      for (const t of tracked) {
        const d2 = t.pos.distanceToSquared(eye);
        let gid = t.ladder[0].gid;
        for (const step of t.ladder) if (d2 >= step.d2 * b2) gid = step.gid;
        if (gid !== t.current) {
          batch.setGeometryIdAt(t.instance, gid);
          t.current = gid;
        }
      }
    },
  };
  return { batch, lod, dynamicIds };
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
