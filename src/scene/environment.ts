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
 * dim ambient light tinted by the city (warm from below, haze from above). Everything
 * else is emissive.
 */
export function createScene(): THREE.Scene {
  installHeightFog();
  const scene = new THREE.Scene();
  const haze = color('haze');
  scene.background = color('sky');
  scene.fog = new THREE.FogExp2(haze, FOG_DENSITY);
  scene.add(createSky(haze));
  scene.add(new THREE.HemisphereLight(haze.clone().multiplyScalar(1.6), color('sodium').multiplyScalar(0.06), 0.14));
  return scene;
}
