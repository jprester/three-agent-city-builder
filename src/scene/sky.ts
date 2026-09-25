import * as THREE from 'three';
import palette from '../../art/style/palette.json';

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/**
 * Night sky dome that follows the camera: `sky` overhead, rising to a warm light-pollution
 * glow at the horizon that matches the fog color, so fogged distance melts into the sky
 * instead of meeting it at a line.
 */
export function createSky(fogColor: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: c('sky') },
      uHorizon: { value: fogColor.clone() },
      uGlow: { value: c('sodium') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;   // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGlow;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float y = max(vDir.y, 0.0);
        // Horizon equals the fog color, so fogged distance meets the sky without a line.
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.4, pow(y, 0.65)));
        // Low cloud deck faintly lit from below by the city (mostly cool, a touch of sodium).
        vec2 q = vDir.xz / max(vDir.y + 0.08, 0.02) * 1.6;
        float cloud = noise(q) * 0.6 + noise(q * 2.3) * 0.4;
        // Cloud undersides lit by the city: cool fill everywhere, a warm sodium tint low down.
        float deck = smoothstep(0.42, 0.8, cloud) * smoothstep(0.0, 0.05, y);
        col += uHorizon * 0.5 * deck * exp(-y * 3.0);
        col += uGlow * 0.045 * deck * exp(-y * 7.0);
        if (vDir.y < 0.0) col = uHorizon;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  // Follow whichever camera renders (the reflection pass uses a mirrored one); the matrix must
  // be refreshed here because world matrices were already updated for this render.
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
  };
  return sky;
}
