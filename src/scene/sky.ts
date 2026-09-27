import * as THREE from 'three';
import palette from '../../art/style/palette.json';

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/**
 * Night sky dome that follows the camera: `sky` overhead, rising to a warm light-pollution
 * glow at the horizon that matches the fog color, so fogged distance melts into the sky
 * instead of meeting it at a line.
 */
export function createSky(fogColor: THREE.Color, time: { value: number }): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: time,
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
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float clouds(vec3 q) {
        float n = 0.0, amplitude = 0.55;
        for (int i=0; i<4; i++) { n += noise(q) * amplitude; q = q * 2.13 + vec3(7.1, 3.7, 9.2); amplitude *= 0.48; }
        return n;
      }
      void main() {
        float y = max(vDir.y, 0.0);
        // Horizon equals the fog color, so fogged distance meets the sky without a line.
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.4, pow(y, 0.65)));
        // Angular 3D noise avoids the stretched horizon bands of a projected flat deck.
        vec3 q = normalize(vDir) * vec3(5.0, 6.5, 5.0) + vec3(uTime * 0.0015, 0.0, 0.0);
        q += vec3(noise(q * 0.6), noise(q * 0.6 + 13.0), noise(q * 0.6 + 27.0)) * 1.2;
        float cloud = clouds(q);
        float deck = smoothstep(0.36, 0.66, cloud) * smoothstep(0.0, 0.08, y);
        float edge = max(0.0, clouds(q + vec3(0.0, -0.18, 0.0)) - cloud);
        col = mix(col, uZenith * 0.4, deck * 0.7);
        col += (uHorizon * 1.5 + uGlow * 0.022) * (deck * 0.45 + edge * 3.0) * exp(-y * 2.2);
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
