import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ASSETS } from '../assets/manifest.gen';
import { AssetLoader, getAsset } from '../assets/registry';
import type { AssetMeta } from '../assets/types';
import { instanceMatrix } from './instancing';
import type { LayoutInstance } from './layout';

/** Attributes the facade material reads; everything else is dropped. */
const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3 } as const;

/** Runtime level-of-detail and visibility control for the facade instances. */
export interface FacadeLod {
  /**
   * Pick each instance's geometry by distance from `camera` (full detail near, the asset's LOD
   * variants (meta.lodOf) beyond their meta.lodDistance × `bias`, hidden beyond its cull
   * distance × `bias`), cull instances outside the camera's view, and pack the survivors into
   * the per-geometry instanced meshes. Call before every render that uses a different camera
   * or bias. `mirror`: the pass renders the scene mirrored in the ground plane (the planar
   * reflection), so instances are tested by their mirror image against `camera`'s frustum.
   */
  update(camera: THREE.Camera, bias?: number, mirror?: boolean): void;
  /** Every instance at full detail, nothing culled: for the startup environment captures. */
  showAll(): void;
}

/** Writable per-instance transforms for moving instances (vehicles), by the ids returned. */
export interface DynamicInstances {
  setMatrixAt(id: number, matrix: THREE.Matrix4): void;
}

/** Geometry id meaning "not drawn" in an LOD ladder. */
const HIDDEN = -1;

/**
 * All facade-shaded instances, drawn as one InstancedMesh per geometry (each asset and each of
 * its LOD variants). Every pass culls instances on the CPU and packs the visible ones, so the
 * GPU sees at most one draw per geometry in view.
 *
 * This replaced a BatchedMesh (one multi-draw, one sub-draw per instance): Chrome's ANGLE
 * Metal backend kept roughly 2 MB of GPU memory per distinct sub-draw, so 4,000–8,000 sub-draws
 * pinned 8–16 GB and wide views paged the GPU (~1 s frames). Instanced draws keep that to a few
 * hundred draws.
 * `cullDistance(asset)`: meters beyond which instances of that asset are not drawn at all.
 */
export async function buildFacadeBatch(
  instances: LayoutInstance[], loader: AssetLoader, material: THREE.Material, dynamic: string[] = [],
  cullDistance: (asset: string) => number | undefined = () => undefined,
) {
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

  const group = new THREE.Group();
  group.name = 'facade-instances';
  // One instanced mesh per geometry, sized for every instance that could ever use it.
  const capacity = new Map<string, number>();
  for (const [id, list] of byAsset) {
    capacity.set(id, (capacity.get(id) ?? 0) + list.length);
    for (const l of lodsOf.get(id) ?? []) capacity.set(l.id, (capacity.get(l.id) ?? 0) + list.length);
  }
  for (const id of dynamic) capacity.set(id, (capacity.get(id) ?? 0) + 1);
  const meshes: THREE.InstancedMesh[] = [];
  const gidOf = new Map<string, number>();
  for (const id of ids) {
    const mesh = new THREE.InstancedMesh(geometries.get(id)!, material, Math.max(1, capacity.get(id) ?? 1));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;   // culled per instance on the CPU
    mesh.count = 0;
    mesh.name = id;
    gidOf.set(id, meshes.length);
    meshes.push(mesh);
    group.add(mesh);
  }

  // Per instance: transform, bounding sphere (full-detail geometry) and its LOD ladder.
  type Tracked = { matrix: THREE.Matrix4; center: THREE.Vector3; radius: number; ladder: { gid: number; d2: number }[] };
  const tracked: Tracked[] = [];
  const sphereOf = (gid: number, matrix: THREE.Matrix4) => {
    const bs = meshes[gid].geometry.boundingSphere!;
    const center = bs.center.clone().applyMatrix4(matrix);
    return { center, radius: bs.radius * matrix.getMaxScaleOnAxis() };
  };
  for (const [id, list] of byAsset) {
    const gid = gidOf.get(id)!;
    const ladder = [{ gid, d2: 0 }, ...(lodsOf.get(id) ?? []).map((l) => ({ gid: gidOf.get(l.id)!, d2: l.distance * l.distance }))];
    const cull = cullDistance(id);
    if (cull !== undefined) ladder.push({ gid: HIDDEN, d2: cull * cull });
    for (const inst of list) {
      const matrix = instanceMatrix(inst);
      tracked.push({ matrix, ...sphereOf(gid, matrix), ladder });
    }
  }
  // Moving instances (vehicles): transforms set by their motion system every frame.
  const moving = dynamic.map((id) => ({ gid: gidOf.get(id)!, matrix: new THREE.Matrix4(), radius: meshes[gidOf.get(id)!].geometry.boundingSphere!.radius }));
  const dynamicIds = moving.map((_, k) => k);
  const dynamicInstances: DynamicInstances = { setMatrixAt: (k, m) => { moving[k].matrix.copy(m); } };

  const eye = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const counts = new Int32Array(meshes.length);
  /** Draw each mesh's first counts[g] instances; upload only that range. */
  const commit = () => {
    for (let g = 0; g < meshes.length; g++) {
      const mesh = meshes[g];
      mesh.count = counts[g];
      mesh.visible = counts[g] > 0;
      if (counts[g]) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, counts[g] * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  };
  const lod: FacadeLod = {
    showAll() {
      counts.fill(0);
      for (const t of tracked) meshes[t.ladder[0].gid].setMatrixAt(counts[t.ladder[0].gid]++, t.matrix);
      for (const v of moving) meshes[v.gid].setMatrixAt(counts[v.gid]++, v.matrix);
      commit();
    },
    update(camera, bias = 1, mirror = false) {
      camera.updateMatrixWorld();
      eye.setFromMatrixPosition(camera.matrixWorld);
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const b2 = bias * bias;
      counts.fill(0);
      const push = (gid: number, matrix: THREE.Matrix4) => {
        const mesh = meshes[gid];
        mesh.setMatrixAt(counts[gid]++, matrix);
      };
      const visible = (center: THREE.Vector3, radius: number) => {
        sphere.center.copy(center);
        if (mirror) sphere.center.y = -sphere.center.y;
        sphere.radius = radius;
        return frustum.intersectsSphere(sphere);
      };
      for (const t of tracked) {
        const d2 = t.center.distanceToSquared(eye);
        let gid = t.ladder[0].gid;
        for (const step of t.ladder) if (d2 >= step.d2 * b2) gid = step.gid;
        if (gid === HIDDEN || !visible(t.center, t.radius)) continue;
        push(gid, t.matrix);
      }
      for (const v of moving) {
        sphere.center.setFromMatrixPosition(v.matrix);
        if (visible(sphere.center.clone(), v.radius)) push(v.gid, v.matrix);
      }
      commit();
    },
  };
  return { batch: group, lod, dynamicIds, dynamicInstances };
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
