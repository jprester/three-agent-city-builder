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
  /** City rectangle (minX, minZ, maxX, maxZ): the sprawl of lights starts outside it. */
  uCity: { value: THREE.Vector4 };
}

const sodium = new THREE.Color(palette.sodium);
const tungsten = new THREE.Color(palette.tungsten);
const fluorescent = new THREE.Color(palette.fluorescent);
const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * Asphalt, sidewalk and paint: MeshStandardMaterial plus
 *  - sodium light pools read from the lamp map (additive falloffs, no real lights);
 *  - a wet-street reflection: the planar reflection, distorted by a noise normal and
 *    smeared vertically into long streaks, strongest in puddles and at grazing angles.
 * `pool` and `wet` scale both effects per surface. `sprawl` (the ground plane only) adds the
 * lights of the surrounding metropolis outside the city rectangle (see SPRAWL below).
 */
export function createGroundMaterial(color: THREE.Color, roughness: number, uniforms: GroundUniforms, pool = 1, wet = 1, sprawl = false): THREE.MeshStandardMaterial {
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
uniform vec4 uCity;
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
totalEmissiveRadiance += gRefl * gGrain * mix(0.16, 1.0, gPuddle) * (0.25 + 0.75 * gFresnel) * uWet * ${wet.toFixed(2)};
${sprawl ? SPRAWL : ''}`);
  };
  material.customProgramCacheKey = () => `ground-${pool}-${wet}-${sprawl}`;
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
    uCity: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/**
 * The metropolis around the city, as light on the ground only (no buildings, so the city
 * keeps its compact shape): past a sparse fringe, 520 m patches of street grid, each with its own
 * angle, block size and density, lit by a warm glow along the streets, lamp dots every 28 m
 * and scattered window dots inside the blocks. Points keep a minimum size so they sparkle,
 * and fade to their average before they could alias; fog carries the sprawl into the
 * horizon lights of the sky.
 */
const SPRAWL = /* glsl */ `
{
  vec2 sp = vGWorld.xz;
  vec2 sq = max(max(uCity.xy - sp, sp - uCity.zw), 0.0);
  float sOut = length(sq);
  // Right at the city edge the ground stays dark; then a sparse fringe (yards, parks) that
  // fills in to full density over ~200 m, so there is no moat around the city.
  float sBand = smoothstep(10.0, 45.0, sOut) * mix(0.3, 1.0, smoothstep(60.0, 260.0, sOut));
  if (sBand > 0.0) {
    // Pixel footprint on the ground: long axis (for fading to the average) and short axis
    // (minimum point size), so points stay round at grazing angles instead of smearing.
    float fwA = length(dFdx(sp)), fwB = length(dFdy(sp));
    float fw = max(max(fwA, fwB), 1e-3);
    float fwMin = max(min(fwA, fwB), 1e-3);
    vec2 patchId = floor(sp / 520.0);
    float h1 = gHash(patchId), h2 = gHash(patchId + 7.7), h3 = gHash(patchId + 3.3);
    float ang = (h1 - 0.5) * 1.6;
    vec2 gp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * sp;
    // A gentle warp: streets bend instead of running ruler-straight for kilometers.
    gp += (vec2(gNoise(sp / 300.0), gNoise(sp / 300.0 + 9.0)) - 0.5) * 36.0;
    float B = mix(55.0, 95.0, h2);
    vec2 cellF = fract(gp / B);
    vec2 cellI = floor(gp / B);
    vec2 dEdge = min(cellF, 1.0 - cellF) * B;           // meters to the nearest street centerlines
    float halfW = 3.5;                                   // street half width
    // Density: busier and quieter districts, never empty, thinning slowly outward.
    float dens = mix(0.35, 1.0, smoothstep(0.15, 0.65, gNoise(sp / 900.0 + 4.0))) * (0.7 + 0.3 * h3) * exp(-sOut / 6000.0);
    // Street glow: a soft warm band along every street (lamps on wet asphalt), the grid that
    // reads from above. Averaged once a pixel spans the band.
    float dS = min(dEdge.x, dEdge.y);
    // Each block-length stretch of street has its own brightness: dim lanes, some arterials.
    float segX = gHash(vec2(floor(gp.x / B + 0.5), cellI.y) + patchId * 5.3);
    float segZ = gHash(vec2(cellI.x, floor(gp.y / B + 0.5)) + patchId * 7.1 + 3.0);
    segX = segX > 0.85 ? 2.0 : 0.15 + 0.6 * segX;
    segZ = segZ > 0.85 ? 2.0 : 0.15 + 0.6 * segZ;
    float glow = max(exp(-dEdge.x * dEdge.x / 18.0) * segX, exp(-dEdge.y * dEdge.y / 18.0) * segZ);
    glow = mix(glow, 2.0 * 7.5 / B * 0.6, smoothstep(3.0, 10.0, fw));
    // Point lights stay at least ~a pixel wide and keep most of their brightness (they read
    // as sparkle), then fade to their mean once neighbours are closer than a few pixels.
    // Lamps: every 28 m along both street directions.
    float ly = abs(fract(gp.y / 28.0 + 0.5) - 0.5) * 28.0;
    float lx = abs(fract(gp.x / 28.0 + 0.5) - 0.5) * 28.0;
    float dl = min(length(vec2(dEdge.x, ly)), length(vec2(dEdge.y, lx)));
    float lr = max(1.3, fwMin * 0.6);
    float lamp = smoothstep(lr, lr * 0.3, dl) * (1.3 / lr);
    lamp = mix(lamp, 0.02, smoothstep(6.0, 14.0, fw));
    // Windows: a 9 m sub-grid inside the blocks, 40 % lit, warm or white.
    vec2 wg = gp / 9.0;
    vec2 wi = floor(wg);
    float inBlock = step(halfW + 2.0, dS);
    float wLit = step(gHash(wi + patchId * 1.7), 0.5) * inBlock;
    vec2 wo = vec2(gHash(wi + 2.3), gHash(wi + 5.9)) * 5.0 + 2.0;
    float wr = max(0.8, fwMin * 0.6);
    float wd = length((wg - wi) * 9.0 - wo);
    float win = smoothstep(wr, wr * 0.25, wd) * wLit * (0.8 / wr) * (0.6 + 0.8 * gHash(wi + 3.7));
    win = mix(win, 0.07, smoothstep(2.5, 5.0, fw));
    vec3 wCol = mix(${v3(tungsten)}, ${v3(fluorescent)}, step(0.7, gHash(wi + 11.0)));
    vec3 sprawlLight = ${v3(sodium)} * (glow * 0.2 + lamp * 3.0) + wCol * win * 2.6;
    // Painted lights on flat ground only hold up from a distance: fade in away from the camera.
    float sNear = smoothstep(60.0, 220.0, distance(cameraPosition, vGWorld));
    totalEmissiveRadiance += sprawlLight * dens * sBand * sNear * 0.75;
  }
}`;
