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
  /** Nearest road vehicles to the camera: x, z, heading sin, heading cos (zero = none). */
  uCars: { value: THREE.Vector4[] };
}

/** Vehicles whose headlights light the road (nearest to the camera; see src/systems/vehicles.ts). */
export const CAR_LIGHTS = 24;

const sodium = new THREE.Color(palette.sodium);
const signRed = new THREE.Color(palette.sign_red);
const tungsten = new THREE.Color(palette.tungsten);
const fluorescent = new THREE.Color(palette.fluorescent);
const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * Asphalt, sidewalk and paint: MeshStandardMaterial plus
 *  - sodium light pools read from the lamp map (additive falloffs, no real lights);
 *  - a wet-street reflection: the planar reflection, distorted by a noise normal and
 *    smeared vertically into long streaks, strongest in puddles and at grazing angles.
 * `pool` and `wet` scale both effects per surface. `sprawl` (the ground plane only) adds the
 * lights of the mainland metropolis across the water (see SPRAWL below). `water` makes the
 * surface one clean mirror broken by slow swell, with long vertical streaks of light.
 */
export function createGroundMaterial(color: THREE.Color, roughness: number, uniforms: GroundUniforms, pool = 1, wet = 1, sprawl = false, water = false): THREE.MeshStandardMaterial {
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
uniform vec4 uCars[${CAR_LIGHTS}];
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
${water ? 'gPuddle = 1.0;' : ''}
// Wet asphalt is darker, puddles darkest.
diffuseColor.rgb *= mix(0.8, 0.45, gPuddle);
${sprawl ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(new THREE.Color(palette.ridge))}, smoothstep(2.0, 35.0, vGWorld.y));` : ''}`)
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
${water ? `// Swell: slow waves stretched across the view wobble the mirror sideways, more upward.
vec2 gSwell = vec2(gNoise(vGWorld.xz * vec2(0.3, 0.09) + vec2(uTime * 0.22, 0.0)), gNoise(vGWorld.xz * vec2(0.09, 0.3) + vec2(0.0, uTime * 0.18))) - 0.5;
gRuv += gSwell * vec2(0.008, 0.03) * (1.0 - 0.7 * smoothstep(0.5, 6.0, length(fwidth(vGWorld.xz))));
gSpan = 0.06;` : ''}
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
totalEmissiveRadiance += gRefl * gGrain * mix(0.16, 1.0, gPuddle) * (0.25 + 0.75 * gFresnel) * uWet * ${wet.toFixed(2)} * (1.0 - smoothstep(0.5, 8.0, vGWorld.y));
${water ? '' : `// Car lights: a widening headlight cone ahead of each nearby car, a small red glow behind,
// and on the wet road the glare streak a lamp facing the viewer leaves toward them.
float gHead = 0.0, gTail = 0.0, gHeadGlare = 0.0, gTailGlare = 0.0;
for (int i = 0; i < ${CAR_LIGHTS}; i++) {
  vec4 c = uCars[i];
  vec2 d = vGWorld.xz - c.xy;
  if (dot(c.zw, c.zw) < 0.5 || dot(d, d) > 900.0) continue;
  float al = dot(d, c.zw), si = dot(d, vec2(-c.w, c.z));
  float w = 0.7 + max(al, 0.0) * 0.3;
  gHead += exp(-si * si / (w * w)) * smoothstep(2.0, 4.5, al) * pow(max(1.0 - al / 30.0, 0.0), 2.0) * 6.0 / (1.0 + max(al, 0.0) * 0.25);
  gTail += exp(-si * si / 1.4) * smoothstep(-1.8, -2.6, al) * max(1.0 - (-al - 2.3) / 5.0, 0.0);
  vec2 toCam = cameraPosition.xz - c.xy;
  float camDist = length(toCam);
  vec2 u = toCam / max(camDist, 1e-3);
  float facing = dot(c.zw, u);
  // From the lamp end facing the viewer, along the line to them.
  vec2 lampEnd = c.xy + c.zw * sign(facing) * 2.3;
  vec2 q = vGWorld.xz - lampEnd;
  float along = dot(q, u), lat = dot(q, vec2(-u.y, u.x));
  float streak = exp(-lat * lat / 0.35) * smoothstep(0.0, 1.0, along) * exp(-along / 14.0) * step(along, camDist - 2.3);
  gHeadGlare += streak * max(facing, 0.0) * max(facing, 0.0);
  gTailGlare += streak * max(-facing, 0.0) * max(-facing, 0.0);
}
gHead *= 1.0 - smoothstep(0.3, 2.0, vGWorld.y);
gTail *= 1.0 - smoothstep(0.3, 2.0, vGWorld.y);
totalEmissiveRadiance += diffuseColor.rgb * (vec3(1.0, 0.95, 0.85) * gHead * 7.0 + ${v3(signRed)} * gTail * 4.0) * ${pool.toFixed(2)};
float gGlare = mix(0.25, 1.0, gPuddle) * (0.3 + 0.7 * gFresnel) * ${wet.toFixed(2)} * (1.0 - smoothstep(0.3, 2.0, vGWorld.y));
totalEmissiveRadiance += (vec3(1.0, 0.95, 0.85) * gHeadGlare * 0.9 + ${v3(signRed)} * gTailGlare * 0.7) * gGlare;`}
${sprawl ? SPRAWL : ''}`);
  };
  material.customProgramCacheKey = () => `ground-${pool}-${wet}-${sprawl}-${water}`;
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
    uCars: { value: Array.from({ length: CAR_LIGHTS }, () => new THREE.Vector4()) },
  };
}

/**
 * Towns on the mainland hills across the water, as light on the ground only (no buildings):
 * scattered clusters on the lower slopes, laid out on 520 m patches of street grid (each with
 * its own angle, block size and density) as lamp dots every 28 m along the streets and window
 * dots inside the blocks; no lit street bands, which read as a flat road map. Points keep a minimum size so they sparkle,
 * and fade to their average before they could alias; fog carries the sprawl into the
 * horizon lights of the sky.
 */
const SPRAWL = /* glsl */ `
{
  vec2 sp = vGWorld.xz;
  float sOut = length(sp);
  // Mainland slopes only (the seabed stays under the water), thinning out up the hills, and
  // only in scattered clusters: hillside towns, not a continuous street grid.
  float sBand = smoothstep(0.3, 3.0, vGWorld.y) * (1.0 - smoothstep(20.0, 80.0, vGWorld.y))
    * smoothstep(0.42, 0.68, gNoise(sp / 380.0 + 2.0));
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
    float dS = min(dEdge.x, dEdge.y);
    // Point lights stay at least ~a pixel wide and keep most of their brightness (they read
    // as sparkle), then fade to their mean once neighbours are closer than a few pixels.
    // Lamps: every 28 m along both street directions.
    float ly = abs(fract(gp.y / 28.0 + 0.5) - 0.5) * 28.0;
    float lx = abs(fract(gp.x / 28.0 + 0.5) - 0.5) * 28.0;
    float dl = min(length(vec2(dEdge.x, ly)), length(vec2(dEdge.y, lx)));
    float lr = max(0.9, fwMin * 0.5);
    float lamp = smoothstep(lr, lr * 0.3, dl) * (0.9 / lr);
    lamp = mix(lamp, 0.01, smoothstep(6.0, 14.0, fw));
    // Windows: a 9 m sub-grid inside the blocks, 40 % lit, warm or white.
    vec2 wg = gp / 9.0;
    vec2 wi = floor(wg);
    float inBlock = step(halfW + 2.0, dS);
    float wLit = step(gHash(wi + patchId * 1.7), 0.5) * inBlock;
    vec2 wo = vec2(gHash(wi + 2.3), gHash(wi + 5.9)) * 5.0 + 2.0;
    float wr = max(0.8, fwMin * 0.6);
    float wd = length((wg - wi) * 9.0 - wo);
    float win = smoothstep(wr, wr * 0.25, wd) * wLit * (0.8 / wr) * (0.6 + 0.8 * gHash(wi + 3.7));
    win = mix(win, 0.03, smoothstep(2.5, 5.0, fw));
    vec3 wCol = mix(${v3(tungsten)}, ${v3(fluorescent)}, step(0.7, gHash(wi + 11.0)));
    // Points only: lit street bands drew a flat road map on the plain.
    vec3 sprawlLight = ${v3(sodium)} * lamp * 2.2 + wCol * win * 2.6;
    // Painted lights on flat ground only hold up from a distance: fade in away from the camera.
    float sNear = smoothstep(60.0, 220.0, distance(cameraPosition, vGWorld));
    totalEmissiveRadiance += sprawlLight * dens * sBand * sNear * 1.2;
  }
}`;
