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
