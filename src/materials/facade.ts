import * as THREE from 'three';
import facade from '../../art/style/facade.json';
import palette from '../../art/style/palette.json';

/**
 * The one material for every facade-shaded asset (buildings, and props built from the same
 * surface types). Geometry carries only what protrudes; windows, storefronts, lit canopies
 * and fixtures are shaded here from two vertex channels written by the Blender generators
 * (art/generators/lib/surface.py):
 *   COLOR_0     r: surface type, g: fill (share of cells with a window), b: tint
 *   TEXCOORD_0  facade coordinates in meters (u along, v up; glTF-flipped v)
 *
 * Extends MeshStandardMaterial via onBeforeCompile so lighting, fog and tone mapping apply.
 */
export interface FacadeUniforms {
  uTime: { value: number };
  /** Layout seed: all window randomness derives from it plus the instance position. */
  uSeed: { value: number };
  /** Top-down street-light intensity (see src/scene/lampmap.ts). */
  uLampMap: { value: THREE.Texture | null };
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp map in world meters. */
  uLampRect: { value: THREE.Vector4 };
  /** Overall window emission multiplier (debug tuning). */
  uWindowGain: { value: number };
}

const c = (name: keyof typeof palette) => new THREE.Color(palette[name]);
const glslColor = (name: keyof typeof palette) => {
  const col = c(name); // THREE.Color is linear once parsed from sRGB hex
  return `vec3(${col.r.toFixed(5)}, ${col.g.toFixed(5)}, ${col.b.toFixed(5)})`;
};
const f = (v: number) => v.toFixed(4);
const T = facade.types;
const C = facade.cells;

const DEFINES = /* glsl */ `
#define T_RES ${T.residential}
#define T_OFFICE ${T.office}
#define T_CURTAIN ${T.curtain}
#define T_PODIUM ${T.podium}
#define T_ROOF ${T.roof}
#define T_TRIM ${T.trim}
#define T_METAL ${T.metal}
#define T_CAGE ${T.cage}
#define T_SOFFIT ${T.soffit}
#define T_FIXTURE ${T.fixture}
const vec2 CELL_RES = vec2(${f(C.residential.w)}, ${f(C.residential.h)});
const vec2 CELL_OFFICE = vec2(${f(C.office.w)}, ${f(C.office.h)});
const vec2 CELL_CURTAIN = vec2(${f(C.curtain.w)}, ${f(C.curtain.h)});
const vec2 CELL_PODIUM = vec2(${f(C.podium.w)}, ${f(C.podium.h)});
const vec3 P_CONCRETE = ${glslColor('concrete')};
const vec3 P_CONCRETE_DARK = ${glslColor('concrete_dark')};
const vec3 P_TILE = ${glslColor('tile_stained')};
const vec3 P_METAL = ${glslColor('metal_dark')};
const vec3 P_GLASS = ${glslColor('glass_dark')};
const vec3 P_TUNGSTEN = ${glslColor('tungsten')};
const vec3 P_FLUORESCENT = ${glslColor('fluorescent')};
const vec3 P_TV = ${glslColor('tv_blue')};
const vec3 P_SODIUM = ${glslColor('sodium')};
const vec3 P_RED = ${glslColor('sign_red')};
const vec3 P_HAZE = ${glslColor('haze')};
`;

const VERTEX_PARS = /* glsl */ `
uniform float uSeed;
varying vec2 vFacadeUv;
varying vec3 vSurf;
varying float vInstSeed;
varying vec3 vFWorld;
varying vec3 vFNormal;
`;

// After batching_vertex: the instance matrix is known; derive scale compensation and seed.
const VERTEX_INSTANCE = /* glsl */ `
#include <batching_vertex>
mat4 fInst = mat4(1.0);
#ifdef USE_BATCHING
  fInst = batchingMatrix;
#endif
#ifdef USE_INSTANCING
  fInst = instanceMatrix;
#endif
vec3 fScale = vec3(length(fInst[0].xyz), length(fInst[1].xyz), length(fInst[2].xyz));
// u runs along local x on faces facing ±z, along local z on faces facing ±x; v runs up
// (horizontal faces use the other horizontal axis).
bool fAlongX = abs(normal.z) >= abs(normal.x);
float fSu = fAlongX ? fScale.x : fScale.z;
float fSv = abs(normal.y) > 0.7 ? (fAlongX ? fScale.z : fScale.x) : fScale.y;
vFacadeUv = vec2(uv.x * fSu, (1.0 - uv.y) * fSv);   // glTF stores 1 - v
vSurf = color.rgb;
vInstSeed = fract(sin(dot(fInst[3].xz, vec2(12.9898, 78.233)) + uSeed * 0.0137) * 43758.5453);
vFNormal = normalize(mat3(fInst) * normal);
`;

const VERTEX_WORLD = /* glsl */ `
#include <project_vertex>
vFWorld = (fInst * vec4(transformed, 1.0)).xyz;
vFWorld = (modelMatrix * vec4(vFWorld, 1.0)).xyz;
vFNormal = normalize(mat3(modelMatrix) * vFNormal);
`;

const FRAGMENT_PARS = /* glsl */ `
${DEFINES}
uniform float uTime;
uniform sampler2D uLampMap;
uniform vec4 uLampRect;
uniform float uWindowGain;
varying vec2 vFacadeUv;
varying vec3 vSurf;
varying float vInstSeed;
varying vec3 vFWorld;
varying vec3 vFNormal;

float fHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
}
// Anti-aliased 1D box [a, b] with filter width w.
float fBox(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}

// Window layer for residential / office / curtain facades (cage reuses residential).
// Returns detailed emission, window mask, and the cell's expected emission for AA fading.
void windowLayer(int type, vec2 uvm, vec2 fw, float fill, float seed, out vec3 emit, out float mask, out vec3 cellEmit, out vec3 rowEmit, out vec3 avgEmit, out float windowFrac) {
  vec2 cell = type == T_OFFICE ? CELL_OFFICE : type == T_CURTAIN ? CELL_CURTAIN : CELL_RES;
  vec2 cid = floor(uvm / cell);
  vec2 p = uvm - cid * cell;           // meters inside the cell
  vec4 r; // window rect x0, x1, y0, y1
  if (type == T_OFFICE) r = vec4(0.08, cell.x - 0.08, 0.95, 2.95);
  else if (type == T_CURTAIN) r = vec4(0.05, cell.x - 0.05, 0.12, cell.y - 0.28);
  else r = vec4(0.8, 2.4, 0.9, 2.45);
  windowFrac = (r.y - r.x) * (r.w - r.z) / (cell.x * cell.y);

  float s = seed * 97.13;
  float hWin = fHash(cid + s);
  float present = step(hWin, fill);
  // Lit ratio varies per building; offices and towers are darker at 2 a.m., and whole
  // floors of an office go dark together.
  float litRatio = mix(0.18, 0.5, fract(seed * 7.31));
  float baseRatio = litRatio;
  if (type == T_OFFICE || type == T_CURTAIN) {
    litRatio *= type == T_CURTAIN ? 0.3 : 0.5;
    baseRatio = litRatio;
    // Office floors go dark or stay lit together, in runs across part of the facade.
    float floorOn = fHash(vec2(cid.y, floor(cid.x / 7.0) + s + 3.1));
    litRatio *= floorOn < 0.45 ? 0.0 : floorOn > 0.9 ? 3.0 : 1.0;
  }
  float hLit = fHash(cid + s + 17.7);
  float lit = step(hLit, litRatio) * present;
  float hTemp = fHash(cid + s + 5.3);
  float hMod = fHash(cid + s + 9.1);
  vec3 col = hTemp < 0.55 ? P_TUNGSTEN : hTemp < 0.86 ? P_FLUORESCENT : hTemp < 0.93 ? mix(P_TUNGSTEN, P_SODIUM, 0.6) : P_TV;
  float inten = mix(0.45, 1.6, fHash(cid + s + 2.9));
  if (hTemp >= 0.93) {
    // TV flicker: a few windows, driven by the shared clock.
    float t = uTime * (5.0 + 9.0 * hMod) + hMod * 40.0;
    inten *= 0.35 + 0.65 * fNoise(vec2(t, hMod * 13.0));
  }

  // Inside the window: blinds (slats), curtains (one side covered), ceiling-lamp falloff.
  vec2 q = (p - r.xz) / (r.yw - r.xz);   // 0..1 across the window
  float shade = 1.0;
  if (hMod < 0.3) shade = 0.35 + 0.65 * smoothstep(0.35, 0.65, fract(q.y * 9.0)) * step(q.y, mix(0.5, 1.0, hMod * 3.0));
  else if (hMod < 0.55) shade = mix(1.0, 0.2, fBox(q.x, hMod > 0.42 ? 0.0 : 0.55, hMod > 0.42 ? 0.45 : 1.0, 0.03));
  shade *= 0.75 + 0.35 * q.y;

  mask = fBox(p.x, r.x, r.y, fw.x) * fBox(p.y, r.z, r.w, fw.y) * present;
  // Unlit glass reflects a little haze from the sky.
  vec3 dark = P_HAZE * 0.12;
  emit = mask * (lit > 0.5 ? col * inten * shade : dark);
  cellEmit = present * windowFrac * (lit > 0.5 ? col * inten * 0.7 : dark);
  // Expected emission of this floor's run of cells, and of the whole facade.
  vec3 meanLit = mix(P_TUNGSTEN, P_FLUORESCENT, 0.35) * 0.75;
  rowEmit = fill * windowFrac * (min(litRatio, 1.0) * meanLit + (1.0 - min(litRatio, 1.0)) * dark);
  avgEmit = fill * windowFrac * (baseRatio * (type == T_RES ? 1.0 : 0.85) * meanLit + (1.0 - baseRatio) * dark);
}
`;

// Replaces color_fragment (vertex colors are data, not albedo).
const FRAGMENT_SURFACE = /* glsl */ `
int fType = int(vSurf.r * 16.0);
float fFill = vSurf.g;
float fTint = vSurf.b;
vec2 fUv = vFacadeUv;
vec2 fFw = max(fwidth(fUv), vec2(1e-4));
float fSeed = vInstSeed;

// Base material: concrete tone from tint, varied per building, streaked with grime.
vec3 fBase = mix(mix(P_CONCRETE_DARK, P_CONCRETE, smoothstep(0.0, 0.5, fTint)), P_TILE, smoothstep(0.5, 1.0, fTint));
fBase *= 0.8 + 0.4 * fract(fSeed * 13.7);
float fGrime = fNoise(vec2(fUv.x * 1.7 + fSeed * 50.0, fUv.y * 0.05)) * 0.6 + fNoise(fUv * 0.35 + fSeed * 20.0) * 0.4;
fBase *= mix(0.55, 1.05, fGrime);
vec3 fEmit = vec3(0.0);
float fRough = 0.9;
float fMetal = 0.0;

if (fType == T_RES || fType == T_OFFICE || fType == T_CURTAIN || fType == T_CAGE) {
  vec3 wEmit, cellEmit, rowEmit, avgEmit; float wMask, wFrac;
  windowLayer(fType == T_CAGE ? T_RES : fType, fUv, fFw, fType == T_CAGE ? 1.0 : fFill, fSeed, wEmit, wMask, cellEmit, rowEmit, avgEmit, wFrac);
  // Anti-aliasing: fade to the cell's average when windows get small, then to the
  // building's average when cells do, so distant facades do not shimmer.
  vec2 cellSize = fType == T_OFFICE ? CELL_OFFICE : fType == T_CURTAIN ? CELL_CURTAIN : CELL_RES;
  float px = max(fFw.x / cellSize.x, fFw.y / cellSize.y);
  // A window is ~half a cell: keep it sharp until it is ~2 px wide, fade cells out below ~1.5 px.
  float toCell = smoothstep(0.22, 0.45, px);
  // Past the cell level, average along the floor first (rows are taller than cells are wide,
  // so lit office floors survive as bands), then over the whole facade.
  float toRow = smoothstep(0.5, 1.2, fFw.x / cellSize.x);
  float toAvg = smoothstep(0.5, 1.2, fFw.y / cellSize.y);
  vec3 e = mix(mix(mix(wEmit, cellEmit, toCell), rowEmit, toRow), avgEmit, toAvg);
  float m = mix(mix(wMask, wFrac * fFill, toCell), wFrac * fFill, toAvg);
  vec3 glass = fType == T_CURTAIN ? mix(P_GLASS, P_METAL, 0.3) : P_GLASS;
  if (fType == T_CURTAIN) fBase = mix(P_METAL, P_CONCRETE_DARK, 0.3 * fTint);   // mullions and spandrels
  fBase = mix(fBase, glass, m);
  fRough = mix(0.9, 0.2, m);
  fEmit = e;
  if (fType == T_CAGE) {
    // Security grille: vertical bars every 12 cm, cross bars every 40 cm, window glow behind.
    float bars = max(1.0 - fBox(fract(fUv.x / 0.12), 0.15, 0.85, fFw.x / 0.12), 1.0 - fBox(fract(fUv.y / 0.4), 0.06, 0.94, fFw.y / 0.4));
    bars = mix(bars, 0.45, smoothstep(0.1, 0.4, fFw.x / 0.12));
    fBase = mix(fBase * 0.6, P_METAL * 1.4, bars);
    fEmit *= (1.0 - bars) * 0.8;
    fRough = mix(0.7, 0.5, bars);
    fMetal = bars * 0.4;
  }
} else if (fType == T_PODIUM) {
  // Storefronts: one shop per podium cell; open shops glow, closed ones show a shutter.
  float sid = floor(fUv.x / CELL_PODIUM.x);
  float x = fUv.x - sid * CELL_PODIUM.x;
  float s = fSeed * 31.7;
  float present = step(fHash(vec2(sid, s)), fFill);
  float open = step(fHash(vec2(sid, s + 1.3)), 0.5) * present;
  float hCol = fHash(vec2(sid, s + 2.1));
  vec3 shopCol = hCol < 0.5 ? P_FLUORESCENT : hCol < 0.85 ? P_TUNGSTEN : mix(P_FLUORESCENT, P_TV, 0.5);
  float pier = 1.0 - fBox(x, 0.3, CELL_PODIUM.x - 0.3, fFw.x);
  float glassMask = fBox(fUv.y, 0.15, 3.25, fFw.y) * (1.0 - pier) * present;
  // Interior: racks as soft vertical bands, darker stock low down, a strip light at the top.
  float racks = 0.75 + 0.25 * sin(x * 7.0 + s) * sin(x * 2.3 + s * 3.0);
  float stock = mix(0.45, 1.0, smoothstep(0.3, 2.2, fUv.y)) * (0.8 + 0.2 * fNoise(vec2(x * 1.5 + s, fUv.y * 0.8)));
  float strip = 1.6 * fBox(fUv.y, 2.95, 3.1, fFw.y);
  // Counter band low down, posters in the upper glass, colored goods.
  float counter = 1.0 - 0.6 * fBox(fUv.y, 0.15, 1.05, fFw.y) * fBox(x, 0.6, 2.8 + 1.4 * fHash(vec2(sid, s + 7.0)), fFw.x);
  vec3 goods = mix(vec3(1.0), mix(P_TUNGSTEN, P_RED, fHash(vec2(floor(x / 0.7), sid + s))), 0.35 * fBox(fUv.y, 1.2, 2.6, fFw.y));
  float glow = mix(0.45, 1.3, fHash(vec2(sid, s + 4.4))) * (racks * stock * counter + strip);
  shopCol *= goods;
  float ribs = 0.6 + 0.4 * smoothstep(0.3, 0.7, abs(fract(fUv.y * 7.0) - 0.5) * 2.0);
  vec3 shutter = mix(P_METAL * 2.2, fBase, 0.3) * ribs * mix(0.6, 1.0, fGrime);
  fBase = mix(fBase, open > 0.5 ? P_GLASS : shutter, glassMask);
  fEmit = glassMask * open * shopCol * glow;
  // Fascia band above the shops stays dark: signs mount there.
  fBase *= 1.0 - 0.4 * fBox(fUv.y, 3.35, 4.5, fFw.y);
  fRough = mix(0.9, open > 0.5 ? 0.2 : 0.6, glassMask);
  fMetal = (1.0 - open) * glassMask * 0.4;
} else if (fType == T_ROOF) {
  fBase = P_CONCRETE_DARK * mix(0.5, 0.95, fGrime);
} else if (fType == T_TRIM) {
  fBase *= 1.1;
} else if (fType == T_METAL) {
  fBase = P_METAL * mix(0.7, 1.6, fNoise(fUv * 2.0 + fSeed * 9.0));
  fRough = 0.55;
  fMetal = 0.5;
} else if (fType == T_SOFFIT) {
  // Canopy underside: fluorescent tubes running along the street.
  float tubes = fBox(fract(fUv.y / 1.1), 0.46, 0.54, fFw.y / 1.1) * fBox(fract(fUv.x / 1.8), 0.08, 0.92, fFw.x / 1.8)
    * step(0.25, fHash(vec2(floor(fUv.x / 1.8), fSeed * 11.0)));
  fBase = P_CONCRETE_DARK;
  fEmit = P_FLUORESCENT * (0.04 + 1.3 * tubes);
} else if (fType == T_FIXTURE) {
  vec3 fc = fFill < 0.25 ? P_SODIUM : fFill < 0.75 ? P_FLUORESCENT : P_RED;
  float blink = fFill > 0.75 ? step(0.5, fract(uTime * 0.9 + fSeed * 3.0)) : 1.0;
  fBase = fc * 0.2;
  fEmit = fc * 4.0 * blink;
}

// Street light spilling up the lower floors: sample the lamp map a little in front of the wall.
vec2 fLampUv = (vFWorld.xz + vFNormal.xz * 2.5 - uLampRect.xy) * uLampRect.zw;
float fLamp = texture2D(uLampMap, fLampUv).r;
fEmit += fBase * P_SODIUM * fLamp * 1.5 * exp(-max(vFWorld.y - 1.0, 0.0) / 7.0);

fEmit *= fType == T_FIXTURE || fType == T_SOFFIT ? 1.0 : uWindowGain;
diffuseColor.rgb = fBase;
`;

export function createFacadeMaterial(uniforms: FacadeUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true });
  material.name = 'facade';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <batching_vertex>', VERTEX_INSTANCE)
      .replace('#include <project_vertex>', VERTEX_WORLD)
      // vColor is data here; keep three's color_vertex from multiplying anything.
      .replace('#include <color_vertex>', '');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fEmit;');
  };
  material.customProgramCacheKey = () => 'facade-v1';
  return material;
}

export function createFacadeUniforms(time: { value: number }, seed: number): FacadeUniforms {
  return {
    uTime: time,
    uSeed: { value: seed },
    uLampMap: { value: null },
    uLampRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uWindowGain: { value: 1 },
  };
}
