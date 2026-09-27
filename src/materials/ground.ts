import * as THREE from 'three';
import palette from '../../art/style/palette.json';

export interface GroundUniforms {
  uLampMap: { value: THREE.Texture | null };
  uLampRect: { value: THREE.Vector4 };
  uReflection: { value: THREE.Texture | null };
  uReflMatrix: { value: THREE.Matrix4 };
  /** Overall reflection strength (debug tuning; 0 disables). */
  uWet: { value: number };
  /** Top-down colored sign glow (see src/scene/lampmap.ts). */
  uSignMap: { value: THREE.Texture | null };
  /** Shared clock (rain ripples). */
  uTime: { value: number };
}

const sodium = new THREE.Color(palette.sodium);
const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * Asphalt, sidewalk and paint: MeshStandardMaterial plus
 *  - sodium light pools read from the lamp map (additive falloffs, no real lights);
 *  - a wet-street reflection: the planar reflection, distorted by a noise normal and
 *    smeared vertically into long streaks, strongest in puddles and at grazing angles.
 * `pool` and `wet` scale both effects per surface.
 */
export function createGroundMaterial(color: THREE.Color, roughness: number, uniforms: GroundUniforms, pool = 1, wet = 1): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uLampMap;
uniform vec4 uLampRect;
uniform sampler2D uReflection;
uniform mat4 uReflMatrix;
uniform float uWet;
uniform sampler2D uSignMap;
uniform float uTime;
varying vec3 vGWorld;
float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float gPuddle = smoothstep(0.55, 0.66, gNoise(vGWorld.xz * 0.12) * 0.65 + gNoise(vGWorld.xz * 0.5) * 0.35);
// Far away the puddle pattern is sub-pixel: fade to its mean coverage instead of mottling.
gPuddle = mix(gPuddle, 0.25, smoothstep(0.03, 0.15, length(fwidth(vGWorld.xz * 0.12))));
// Wet asphalt is darker, puddles darkest.
diffuseColor.rgb *= mix(0.8, 0.45, gPuddle);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.08, gPuddle);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float gLamp = texture2D(uLampMap, (vGWorld.xz - uLampRect.xy) * uLampRect.zw).r;
totalEmissiveRadiance += diffuseColor.rgb * ${v3(sodium)} * gLamp * gLamp * ${(6 * pool).toFixed(2)};
totalEmissiveRadiance += diffuseColor.rgb * texture2D(uSignMap, (vGWorld.xz - uLampRect.xy) * uLampRect.zw).rgb * ${(3 * pool).toFixed(2)};

// Wet reflection. The noise normal breaks the mirror up; taps spread along the reflection
// image's vertical axis give the long smears of lights on wet roads.
vec4 gRp = uReflMatrix * vec4(vGWorld.x, 0.0, vGWorld.z, 1.0);
vec2 gRuv = gRp.xy / gRp.w;
vec2 gN = vec2(gNoise(vGWorld.xz * 1.9), gNoise(vGWorld.xz * 1.9 + 11.3)) - 0.5;
// Barely any sideways wobble (that reads as water); mostly vertical jitter and smear.
// Rain ripples: rings expanding in a jittered 0.7 m grid, each on its own cycle (puddles only).
vec2 gCell = floor(vGWorld.xz / 0.7);
vec2 gOff = vec2(gHash(gCell), gHash(gCell + 5.1)) * 0.5 + 0.1;
float gPh = fract(uTime * 1.1 + gHash(gCell + 9.7));
float gD = length(vGWorld.xz - (gCell + gOff) * 0.7);
float gRing = exp(-pow((gD - gPh * 0.3) / 0.018, 2.0)) * (1.0 - gPh) * gPuddle;
gRing *= 1.0 - smoothstep(0.02, 0.08, length(fwidth(vGWorld.xz)));   // gone before it aliases
gRuv += gRing * 0.012;
gRuv += gN * vec2(mix(0.003, 0.0012, gPuddle), mix(0.012, 0.003, gPuddle));
float gSpan = mix(0.08, 0.018, gPuddle);
vec3 gRefl = vec3(0.0);
float gW = 0.0;
for (int i = -6; i <= 6; i++) {
  float o = float(i) / 6.0;
  float w = exp(-abs(o) * 2.2);
  gRefl += texture2D(uReflection, clamp(gRuv + vec2(0.0, o * gSpan), 0.001, 0.999)).rgb * w;
  gW += w;
}
gRefl /= gW;
vec3 gView = normalize(cameraPosition - vGWorld);
float gFresnel = 0.04 + 0.96 * pow(1.0 - clamp(gView.y, 0.0, 1.0), 5.0);
// Asphalt grain breaks up the dull wet film; puddles stay clean.
float gGrain = mix(0.45 + 0.9 * gNoise(vGWorld.xz * 7.0) * gNoise(vGWorld.xz * 2.1 + 3.0), 1.0, gPuddle);
totalEmissiveRadiance += gRefl * gGrain * mix(0.16, 1.0, gPuddle) * (0.25 + 0.75 * gFresnel) * uWet * ${wet.toFixed(2)};`);
  };
  material.customProgramCacheKey = () => `ground-${pool}-${wet}`;
  return material;
}

export function createGroundUniforms(lampRect: { value: THREE.Vector4 }): GroundUniforms {
  return {
    uLampMap: { value: null },
    uLampRect: lampRect,
    uReflection: { value: null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uWet: { value: 1 },
    uSignMap: { value: null },
    uTime: { value: 0 },
  };
}
