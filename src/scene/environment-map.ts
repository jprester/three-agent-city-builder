import * as THREE from 'three';
import type { Layout } from '../systems/layout';

/** One startup capture supplies actual city reflections to rough glass and metal.
 * It is shared by the city, not a local reflection probe for every building. */
export function captureCityEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, layout: Layout | null) {
  const origin = layout?.anchors?.hero?.origin ?? [0, 0, 0];
  const direction = layout?.anchors?.hero?.x ?? [1, 0];
  const pmrem = new THREE.PMREMGenerator(renderer);
  const capture = pmrem.fromScene(scene, 0.025, 0.5, 2000, {
    size: 128,
    position: new THREE.Vector3(origin[0] + direction[0] * 180, 65, origin[2] + direction[1] * 180),
  });
  scene.environment = capture.texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
  return capture;
}

/**
 * Sharp city capture for tower glass: a 256 px cube (HDR, mipmapped for rough and distant
 * glass) rendered once from inside the tower district at mid-height, at the open point
 * farthest from any tower, so every tower's glass reflects lit neighbours, the city below
 * and the sky. Infinite-distance lookup: fine for glass seen from afar.
 * `hidden`: objects left out (the ground, whose reflection target is not rendered yet; rain).
 */
export function captureGlassEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, layout: Layout | null, hidden: THREE.Object3D[]) {
  const target = new THREE.WebGLCubeRenderTarget(256, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  });
  target.texture.name = 'glass-env';
  const cube = new THREE.CubeCamera(1, 4000, target);
  cube.position.copy(glassProbePosition(layout));
  const visible = hidden.map((o) => o.visible);
  hidden.forEach((o) => (o.visible = false));
  cube.update(renderer, scene);
  hidden.forEach((o, i) => (o.visible = visible[i]));
  return target.texture;
}

/** Height of the glass capture (m): mid-height of the tower district. */
const GLASS_PROBE_Y = 140;

/** The point within 150 m of the tower district's center farthest from every building taller than the probe. */
export function glassProbePosition(layout: Layout | null): THREE.Vector3 {
  const center = layout?.anchors?.towers?.origin ?? layout?.anchors?.core?.origin ?? [0, 0, 0];
  const tall = (layout?.instances ?? []).filter((i) => i.fp && (i.h ?? 0) > GLASS_PROBE_Y - 10);
  let best = new THREE.Vector3(center[0], GLASS_PROBE_Y, center[2]);
  let bestClear = -Infinity;
  for (let gx = -150; gx <= 150; gx += 10) {
    for (let gz = -150; gz <= 150; gz += 10) {
      const x = center[0] + gx, z = center[2] + gz;
      let clear = Infinity;
      for (const i of tall) {
        const dx = x - i.position[0], dz = z - i.position[2];
        const c = Math.cos(i.rotationY), s = -Math.sin(i.rotationY);
        // Distance outside the footprint box (negative inside).
        const lx = Math.abs(dx * c + dz * s) - i.fp![0], lz = Math.abs(-dx * s + dz * c) - i.fp![1];
        clear = Math.min(clear, Math.max(lx, lz));
      }
      if (clear > bestClear) { bestClear = clear; best = new THREE.Vector3(x, GLASS_PROBE_Y, z); }
    }
  }
  return best;
}
