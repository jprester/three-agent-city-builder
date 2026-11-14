import * as THREE from 'three';
import palette from '../../art/style/palette.json';
import { installHeightFog } from './fog';
import { createSky } from './sky';
import { lightningAt } from './lightning';
import type { Layout } from '../systems/layout';

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
  firstVertexProvokes(renderer);
  // Registered after three.js's own handler (WebGLRenderer constructor); context state is lost with the context.
  renderer.domElement.addEventListener('webglcontextrestored', () => firstVertexProvokes(renderer));
  return renderer;
}

/**
 * Take `flat` varyings from a triangle's first vertex instead of GL's default, the last.
 * Metal only knows the first-vertex rule, so under the default Chrome's Metal backend keeps a
 * rewritten copy of the index buffer for every draw of a shader with `flat` varyings: about
 * 1.3 MB of GPU memory each, 600-860 MB for this scene (docs/NOTES.md, perf A5).
 *
 * The picture does not change: every `flat` varying here is constant over its triangle
 * (per-face surface codes on unshared vertices, per-instance seeds). A shader that relies on
 * WHICH vertex provokes would have to account for this. Where the extension is missing,
 * nothing changes.
 */
function firstVertexProvokes(renderer: THREE.WebGLRenderer) {
  const ext = renderer.getContext().getExtension('WEBGL_provoking_vertex') as
    { provokingVertexWEBGL(mode: number): void; FIRST_VERTEX_CONVENTION_WEBGL: number } | null;
  ext?.provokingVertexWEBGL(ext.FIRST_VERTEX_CONVENTION_WEBGL);
}

/**
 * Night scene: height fog in the haze color, a sky dome that matches it at the horizon, and
 * cool sky illumination that reveals architectural depth. Practical lights
 * remain emissive, with their local spill supplied by the facade shaders.
 */
export function createScene(time: { value: number }, layout: Layout | null = null): THREE.Scene {
  installHeightFog();
  const scene = new THREE.Scene();
  const haze = color('haze');
  scene.background = color('sky');
  scene.fog = new THREE.FogExp2(haze, FOG_DENSITY);
  const sky = createSky(haze, time, layout);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(color('tv_blue').lerp(color('fluorescent'), 0.45), color('sodium').multiplyScalar(0.035), 0.11);
  scene.add(hemi);
  // Broad night-sky illumination reveals ribs, rails and roof planes; no shadow maps.
  const skyLight = new THREE.DirectionalLight(color('tv_blue').lerp(color('fluorescent'), 0.4), 0.26);
  skyLight.position.set(-180, 260, -90);
  scene.add(skyLight);
  // Per frame: lightning flashes the clouds and briefly lifts the sky light over the city.
  const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
  scene.userData.update = (t: number) => {
    const { flash, dir } = lightningAt(t);
    uniforms.uFlash.value = flash;
    uniforms.uFlashDir.value.set(dir[0], dir[1]);
    hemi.intensity = 0.11 + 0.5 * flash;
    skyLight.intensity = 0.26 + 1.6 * flash;
  };
  return scene;
}
