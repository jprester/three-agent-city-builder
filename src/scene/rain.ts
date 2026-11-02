import * as THREE from 'three';
import palette from '../../art/style/palette.json';

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);
const v3 = (col: THREE.Color) => `vec3(${col.r.toFixed(4)}, ${col.g.toFixed(4)}, ${col.b.toFixed(4)})`;

export interface RainOptions {
  count: number;
  time: { value: number };
  lampMap: THREE.Texture | null;
  signMap: THREE.Texture | null;
  lampRect: THREE.Vector4;
}

/**
 * Camera-relative rain: `count` streaks in a box that wraps around the camera (never
 * scattered over the world), falling on the shared clock, so a frozen time freezes the rain.
 * Each streak is a thin quad stretched along its velocity, facing the camera, lit by the
 * street lights and signs below it (lamp and sign maps) and, from higher up, by the city's
 * glow. Streaks never render thinner than a pixel (`uViewportH`, set per frame): narrower
 * ones widen and dim (by the square root), so distant rain stays a soft presence instead of
 * vanishing. Above the street the box grows with camera height (up to 10×), so elevated views see rain
 * too. One instanced draw, additive.
 */
export function createRain(opts: RainOptions): THREE.Mesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(opts.count * 3);
  // Deterministic scatter (no Math.random: screenshots must repeat exactly).
  let a = 0x9e3779b9;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  geometry.instanceCount = opts.count;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: opts.time,
      uBox: { value: new THREE.Vector3(60, 36, 60) },
      uSpeed: { value: 9.5 },
      uWind: { value: new THREE.Vector2(1.6, 0.7) },
      uLampMap: { value: opts.lampMap },
      uSignMap: { value: opts.signMap },
      uLampRect: { value: opts.lampRect },
      uViewportH: { value: 1080 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime, uSpeed;
      uniform vec3 uBox;
      uniform vec2 uWind;
      uniform float uViewportH;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vFade;
      varying float vBrightness;
      void main() {
        float speed = uSpeed * (0.8 + 0.4 * aSeed.x);
        vec3 vel = vec3(uWind.x, -speed, uWind.y);
        // Higher cameras: a bigger box (same count, so sparser) with longer streaks.
        float k = clamp(cameraPosition.y / 30.0, 1.0, 10.0);
        vec3 box = uBox * k;
        vec3 p = aSeed * box + vel * uTime;
        vec3 rel = mod(p - cameraPosition + box * 0.5, box) - box * 0.5;
        vec3 base = cameraPosition + rel;
        vec3 dir = normalize(vel);
        vec3 side = normalize(cross(dir, normalize(cameraPosition - base)));
        float len = mix(0.12, 0.5, aSeed.y * aSeed.y) * mix(1.0, k, 0.6);
        float width = mix(0.003, 0.007, aSeed.z);
        // At least one pixel wide; the widened streak dims, by less than the width factor (a
        // square root), so distant rain still reads as faint lines rather than nothing.
        float px = length(base - cameraPosition) * 2.0 / (projectionMatrix[1][1] * uViewportH);
        float drawn = max(width, px);
        vBrightness = mix(0.3, 1.0, aSeed.z * aSeed.z) * sqrt(width / drawn) * mix(1.0, 2.2, (k - 1.0) / 9.0);
        width = drawn;
        vec3 world = base + dir * position.y * len + side * position.x * width;
        vWorld = world;
        vUv = position.xy;
        // Fade at the volume's edges and right in front of the lens.
        vec3 e = abs(rel) / (box * 0.5);
        vFade = (1.0 - smoothstep(0.7, 1.0, max(max(e.x, e.y), e.z))) * smoothstep(3.5, 8.0, length(rel));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uLampMap, uSignMap;
      uniform vec4 uLampRect;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vFade;
      varying float vBrightness;
      void main() {
        if (vWorld.y < 0.0) discard;
        vec2 uv = (vWorld.xz - uLampRect.xy) * uLampRect.zw;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float lamp = texture2D(uLampMap, uv).r * inside * exp(-max(vWorld.y - 4.0, 0.0) / 12.0);
        vec3 sign = texture2D(uSignMap, uv).rgb * inside * exp(-max(vWorld.y - 8.0, 0.0) / 14.0);
        // From higher up, the city's broad glow below (coarse lamp map) lights the rain too.
        float city = textureLod(uLampMap, uv, 6.0).r * inside * exp(-max(vWorld.y, 0.0) / 450.0);
        vec3 light = ${v3(c('haze'))} * 0.8 + ${v3(c('sodium'))} * (lamp * 2.0 + city * 3.0) + sign * 1.6;
        float streak = (1.0 - abs(vUv.x)) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        gl_FragColor = vec4(light * streak * vFade * vBrightness * 0.5, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}
