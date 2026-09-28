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
      uTungsten: { value: c('tungsten') },
      uFluor: { value: c('fluorescent') },
      uRed: { value: c('sign_red') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;   // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGlow, uTungsten, uFluor, uRed;
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
      // Distant settlements on the horizon, kilometers away across the plain: clusters of tiny
      // warm and white lights with gaps between them, a faint glow over the dense ones and a
      // few slow red aviation blinks. At infinity (no parallax); the wet ground reflects them.
      float hash2(vec2 p) { return hash(vec3(p, 17.0)); }
      vec3 distantLights(vec3 d) {
        float e = asin(clamp(d.y, -1.0, 1.0));
        if (e < -0.001 || e > 0.03) return vec3(0.0);
        float az = atan(d.z, d.x);
        // Settlement density around the horizon (0 = open country) and its skyline height.
        float town = smoothstep(0.45, 0.75, noise(vec3(az * 2.2, 3.0, 0.0)) * 0.7 + noise(vec3(az * 9.0, 7.0, 0.0)) * 0.45);
        float top = 0.001 + 0.012 * town * pow(noise(vec3(az * 40.0, 11.0, 0.0)), 2.0);
        vec3 lights = vec3(0.0);
        // Two grids of different pitch so rows never line up.
        for (int k = 0; k < 2; k++) {
          vec2 g = vec2(az, e) * (k == 0 ? vec2(260.0, 900.0) : vec2(370.0, 1300.0));
          vec2 cell = floor(g), f = fract(g) - 0.5;
          float h = hash2(cell + float(k) * 91.0);
          float lit = step(h, town * 0.32) * step(e, top);
          vec2 jit = vec2(hash2(cell + 5.3), hash2(cell + 9.1)) - 0.5;
          float r = length((f - jit * 0.6) * vec2(1.0, 0.45));
          float w = fwidth(r) + 0.02;
          float spot = smoothstep(0.16 + w, 0.16 - w, r) * lit;
          float tint = hash2(cell + 2.7);
          vec3 c = tint < 0.55 ? uGlow : (tint < 0.85 ? uTungsten : uFluor);
          lights += c * spot * (0.2 + 0.6 * hash2(cell + 4.4) * hash2(cell + 8.8));
          // Rare red aviation lights on the taller distant buildings, blinking slowly.
          float av = step(0.992, h) * step(0.004, top) * step(e, top + 0.0012);
          lights += uRed * av * smoothstep(0.2, 0.0, r) * step(0.5, fract(uTime * 0.5 + h * 7.0)) * 1.5;
        }
        // Light dome over dense settlements, fading upward.
        vec3 glow = uGlow * 0.035 * town * exp(-max(e, 0.0) * 160.0);
        return lights + glow;
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
        col += distantLights(vDir);
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
