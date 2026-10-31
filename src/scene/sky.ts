import * as THREE from 'three';
import palette from '../../art/style/palette.json';

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);

/**
 * Night sky dome that follows the camera: `sky` overhead, rising to the fog color at the
 * horizon, so fogged distance melts into the sky instead of meeting it at a line. A low cloud
 * deck is lit warm from below by the city (`cloud_glow`, strongest low over the horizon) with
 * dark gaps, and two mountain ridges (`ridge`, a near dark one and a hazier far one) stand
 * behind the tower district, as in the Hong Kong night references.
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
      uCloudGlow: { value: c('cloud_glow') },
      uRidge: { value: c('ridge') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;   // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGlow, uTungsten, uFluor, uRed, uCloudGlow, uRidge;
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
      // Mountain ridges at infinity behind the tower district (azimuth around RIDGE_AZ, world
      // -Z/+X quadrant), fading out at the ends of their sector. Returns (near, far) heights
      // as elevation angles, 0 where there is no ridge.
      const float RIDGE_AZ = -0.9;
      const float RIDGE_HALF = 1.75;
      float ridgeNoise(float az, float f, float seed) {
        return noise(vec3(az * f, seed, 0.0)) * 0.6 + noise(vec3(az * f * 2.7, seed + 4.0, 0.0)) * 0.28
             + noise(vec3(az * f * 7.9, seed + 9.0, 0.0)) * 0.12;
      }
      vec2 ridges(float az) {
        float da = abs(mod(az - RIDGE_AZ + 3.14159265, 6.2831853) - 3.14159265);
        float sector = smoothstep(RIDGE_HALF, RIDGE_HALF * 0.55, da);
        float nearH = (0.005 + 0.065 * pow(ridgeNoise(az, 3.1, 1.0), 1.6)) * sector;
        float farH = (0.014 + 0.1 * pow(ridgeNoise(az, 1.7, 21.0), 1.4)) * sector;
        return vec2(nearH, farH);
      }

      void main() {
        float y = max(vDir.y, 0.0);
        // Horizon equals the fog color, so fogged distance meets the sky without a line.
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.4, pow(y, 0.65)));
        // Angular 3D noise avoids the stretched horizon bands of a projected flat deck.
        vec3 q = normalize(vDir) * vec3(5.0, 6.5, 5.0) + vec3(uTime * 0.0015, 0.0, 0.0);
        q += vec3(noise(q * 0.6), noise(q * 0.6 + 13.0), noise(q * 0.6 + 27.0)) * 1.2;
        float cloud = clouds(q);
        float deck = smoothstep(0.32, 0.62, cloud) * smoothstep(0.0, 0.1, y);
        float edge = max(0.0, clouds(q + vec3(0.0, -0.18, 0.0)) - cloud);
        col = mix(col, mix(uZenith, uHorizon, 0.35) * 0.62, deck * 0.65);
        col += (uHorizon * 1.5 + uGlow * 0.018) * (deck * 0.45 + edge * 3.0) * exp(-y * 2.2);
        // City light from below: cloud bases glow warm, most where they hang low over the
        // horizon; the gaps between them stay dark.
        float under = deck * (0.3 + 0.7 * exp(-y * 4.0)) + edge * 1.5 * exp(-y * 3.0);
        col += uCloudGlow * under * 0.55;
        if (vDir.y < 0.0) col = uHorizon;
        // Ridges: silhouettes against the lit cloud, the far one hazier, both lifted toward the
        // haze at their foot (the city's light in the air in front of them).
        float e = asin(clamp(vDir.y, -1.0, 1.0));
        float aa = fwidth(e) * 1.5 + 1e-5;
        // Only near the horizon (ridges stay below ~0.12 rad): atan(z, x) is undefined straight
        // up and its NaN would spread through the bloom over the whole frame.
        vec2 rh = e < 0.13 ? ridges(atan(vDir.z, vDir.x)) : vec2(0.0);
        float farM = smoothstep(rh.y + aa, rh.y - aa, e) * step(0.0, e);
        float nearM = smoothstep(rh.x + aa, rh.x - aa, e) * step(0.0, e);
        vec3 foot = mix(uHorizon, uCloudGlow * 0.35, 0.35);
        // max(e, 0): below the horizon exp(-e * k) overflows to infinity, and infinity * 0 in the
        // masked mix below is NaN.
        float ep = max(e, 0.0);
        vec3 farCol = mix(uRidge, foot, 0.55 + 0.35 * exp(-ep * 60.0));
        vec3 nearCol = mix(uRidge, foot, 0.2 + 0.5 * exp(-ep * 90.0));
        col = mix(col, farCol, farM);
        col = mix(col, nearCol, nearM);
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
