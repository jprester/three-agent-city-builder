import * as THREE from 'three';
import palette from '../../art/style/palette.json';
import { installHeightFog } from './fog';
import { createSky } from './sky';

const color = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/** Extinction per meter at street level (see src/scene/fog.ts). */
export const FOG_DENSITY = 0.0016;

export function createRenderer(maxPixelRatio: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // renderer.info counts every pass of a frame; main resets it once per frame.
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  return renderer;
}

/**
 * Night scene: height fog in the haze color, a sky dome that matches it at the horizon, and
 * cool sky illumination that reveals architectural depth. Practical lights
 * remain emissive, with their local spill supplied by the facade shaders.
 */
export function createScene(time: { value: number }): THREE.Scene {
  installHeightFog();
  const scene = new THREE.Scene();
  const haze = color('haze');
  scene.background = color('sky');
  scene.fog = new THREE.FogExp2(haze, FOG_DENSITY);
  scene.add(createSky(haze, time));
  scene.add(new THREE.HemisphereLight(color('tv_blue').lerp(color('fluorescent'), 0.45), color('sodium').multiplyScalar(0.035), 0.16));
  // Broad night-sky illumination reveals ribs, rails and roof planes; no shadow maps.
  const skyLight = new THREE.DirectionalLight(color('tv_blue').lerp(color('fluorescent'), 0.4), 0.38);
  skyLight.position.set(-180, 260, -90);
  scene.add(skyLight);
  return scene;
}
